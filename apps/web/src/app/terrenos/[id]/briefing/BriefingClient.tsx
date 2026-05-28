"use client";

/**
 * BriefingClient (v2 — PRD §10.1)
 *
 * Wizard horizontal de 6 passos. AC1: nunca monta `ShedViewer` nem cria
 * `Building`/`SitePlan` materializado antes do submit do step 6. A coluna
 * direita exibe apenas o `LotPreviewSvg` (planta 2D) até o estudo ser
 * gerado. Persistência incremental em `assumptions` via PATCH
 * `/api/briefings/:id` (FR-W4).
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { LngLat } from "@/lib/geo";
import { Breadcrumb } from "@/components/Breadcrumb";
import { BriefingStepper, type StepDef } from "@/components/BriefingStepper";
import {
  SITE_CONSTRAINTS,
  SLIDER_RANGES,
  validateSitePlan,
} from "@/lib/siteConstraints";
import {
  buildBuildableRegion,
  detectStreetEdges,
  getEdges,
  placeGates,
  polygonAreaLocal,
  polygonBBox,
  projectLotToLocal,
} from "@/lib/siteGeometry";
import { fitBuildings } from "@/lib/siteLayout";
import type { IndustrialShed } from "@/lib/shedSchema";
import {
  SitePlanSchema,
  type BuildingUse,
  type SitePlan,
  type ValidationReport,
} from "@/lib/sitePlanSchema";
import LotPreviewMap from "@/components/LotPreviewMap";

const STEPS: StepDef[] = [
  { id: "terreno", label: "Terreno & rua", description: "Arestas e recuos" },
  { id: "perimetro", label: "Perímetro", description: "Muros e portões" },
  { id: "programa", label: "Programa", description: "Nº de galpões, uso" },
  { id: "galpoes", label: "Galpões", description: "Dimensões e tipologia" },
  { id: "circulacao", label: "Circulação", description: "Vagas e vias" },
  { id: "revisao", label: "Revisão", description: "Validar e gerar 3D" },
];

const USES = [
  { id: "logistics", label: "Logística" },
  { id: "industrial", label: "Industrial" },
  { id: "cross_dock", label: "Cross-dock" },
  { id: "distribution_center", label: "Centro de Dist." },
] as const;

interface Programa {
  qty: number;
  use: (typeof USES)[number]["id"];
  targetAreaM2: number;
  standard: "economico" | "medio" | "alto";
}

interface BriefingState {
  programa: Programa;
  setbacks: { front: number; sides: number; back: number };
  streetEdges: number[];
  perimeterHeight: number;
  gateWidth: number;
  truckAccess: boolean;
  clearHeight: number;
  carStalls: number;
  truckStalls: number;
  rotationDeg: number;
  gapM: number;
}

const initial = (): BriefingState => ({
  programa: { qty: 1, use: "logistics", targetAreaM2: 2000, standard: "medio" },
  setbacks: { front: 5, sides: 1.5, back: 3 },
  streetEdges: [],
  perimeterHeight: 2.2,
  gateWidth: SITE_CONSTRAINTS.gates.minWidthByKind.caminhao,
  truckAccess: true,
  clearHeight: 8,
  carStalls: 0,
  truckStalls: 0,
  rotationDeg: 0,
  gapM: SITE_CONSTRAINTS.building.minGapBetweenM,
});

interface Props {
  terrainId: string;
  terrainName: string;
  terrainAddress: string | null;
  areaM2: number;
  polygon: LngLat[];
  /** Pre-existing active/draft briefing to resume. */
  initialBriefingId?: string | null;
}

export default function BriefingClient({
  terrainId,
  terrainName,
  terrainAddress,
  areaM2,
  polygon,
  initialBriefingId = null,
}: Props) {
  const router = useRouter();
  const [briefingId, setBriefingId] = useState<string | null>(
    initialBriefingId,
  );
  const [state, setState] = useState<BriefingState>(initial);
  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Lot projection (local meters) and edges, memoized.
  const lot = useMemo(() => projectLotToLocal(polygon), [polygon]);
  const edges = useMemo(() => getEdges(lot.local), [lot.local]);

  // Auto-detect street edges on mount (heuristic: the edge closest to the
  // bbox bottom is the front). OSM integration arrives via API in a later
  // phase — for v1 we expose a manual toggle on step 2.
  useEffect(() => {
    if (state.streetEdges.length > 0) return;
    const bb = polygonBBox(lot.local);
    // pick edge whose midpoint has the smallest z (closest to "south").
    let bestIdx = 0;
    let bestZ = Infinity;
    for (const e of edges) {
      if (e.mid.z < bestZ) {
        bestZ = e.mid.z;
        bestIdx = e.index;
      }
    }
    setState((s) => ({ ...s, streetEdges: [bestIdx] }));
    void bb; // silence unused
  }, [edges, lot.local, state.streetEdges.length]);

  // Create a briefing on first interaction (AC1: no 3D, no Building yet).
  async function ensureBriefing(): Promise<string> {
    if (briefingId) return briefingId;
    const res = await fetch("/api/briefings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        terrainId,
        title: `Estudo — ${terrainName}`,
      }),
    });
    if (!res.ok) throw new Error("Falha ao criar briefing.");
    const json = (await res.json()) as { briefing: { id: string } };
    setBriefingId(json.briefing.id);
    return json.briefing.id;
  }

  // Persist `assumptions` snapshot (PATCH) every time `state` changes —
  // debounced via microtask. No SitePlan materialization here.
  useEffect(() => {
    if (!briefingId) return;
    const handle = window.setTimeout(() => {
      void fetch(`/api/briefings/${briefingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          progress: step,
          assumptions: [state],
        }),
      }).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [state, step, briefingId]);

  // ---- Buildable area (m²) and per-building max --------------------------

  const buildableRegion = useMemo(
    () =>
      buildBuildableRegion(lot.local, {
        setbacks: state.setbacks,
        streetEdges: state.streetEdges,
        laneBufferM: state.truckAccess
          ? SITE_CONSTRAINTS.circulation.truckLaneMin
          : SITE_CONSTRAINTS.circulation.carLaneMin,
      }),
    [lot.local, state.setbacks, state.streetEdges, state.truckAccess],
  );

  const buildableAreaM2 = useMemo(
    () => (buildableRegion.length >= 3 ? polygonAreaLocal(buildableRegion) : 0),
    [buildableRegion],
  );

  /** Max target area per building = buildable area ÷ qty (rounded down to step). */
  const maxTargetArea = useMemo(() => {
    const raw = buildableAreaM2 / Math.max(1, state.programa.qty);
    return Math.max(300, Math.floor(raw / 100) * 100);
  }, [buildableAreaM2, state.programa.qty]);

  // Clamp targetAreaM2 when max shrinks below current value.
  useEffect(() => {
    if (state.programa.targetAreaM2 > maxTargetArea) {
      setState((s) => ({
        ...s,
        programa: { ...s.programa, targetAreaM2: maxTargetArea },
      }));
    }
  }, [maxTargetArea, state.programa.targetAreaM2]);

  // ---- Derive SitePlan from current state (deterministic) ---------------

  /** Max number of sheds that can fit given the target area. */
  const maxQty = useMemo(() => {
    if (buildableAreaM2 <= 0 || state.programa.targetAreaM2 <= 0) return 1;
    const gap = SITE_CONSTRAINTS.building.minGapBetweenM;
    // Rough estimate: each shed needs targetArea + proportional gap
    const perShed = state.programa.targetAreaM2;
    const raw = Math.floor(buildableAreaM2 / perShed);
    return Math.max(1, Math.min(6, raw));
  }, [buildableAreaM2, state.programa.targetAreaM2]);

  const candidate = useMemo<{
    site: SitePlan | null;
    report: ValidationReport;
    buildable: { x: number; z: number }[] | null;
    error?: string;
  }>(() => {
    let buildable: { x: number; z: number }[] | null = null;
    try {
      buildable = buildBuildableRegion(lot.local, {
        setbacks: state.setbacks,
        streetEdges: state.streetEdges,
        laneBufferM: state.truckAccess
          ? SITE_CONSTRAINTS.circulation.truckLaneMin
          : SITE_CONSTRAINTS.circulation.carLaneMin,
      });
      const rotationRad = (state.rotationDeg * Math.PI) / 180;
      const fit = fitBuildings({
        buildable,
        requests: Array.from({ length: state.programa.qty }, (_, i) => ({
          id: `B${i + 1}`,
          name: `Galpão ${i + 1}`,
          targetAreaM2: state.programa.targetAreaM2,
          use: state.programa.use,
        })),
        rotationRad,
        gapM: state.gapM,
      });
      // Always use placements (even on overflow) so user sees the buildings.
      const fitError = fit.ok ? undefined : fit.reason;
      const gates = placeGates(lot.local, state.streetEdges, {
        truckAccess: state.truckAccess,
      });
      const draft = SitePlanSchema.parse({
        schemaVersion: "site-1",
        terrainId,
        lotPolygon: polygon,
        lotPolygonLocal: lot.local,
        northAngleRad: 0,
        streetEdges: state.streetEdges,
        setbacks: state.setbacks,
        perimeter: {
          segments: edges.map((e) => ({
            edgeIndex: e.index,
            kind: "muro" as const,
            height: state.perimeterHeight,
          })),
        },
        gates: gates.map((g) => ({ ...g, width: state.gateWidth })),
        buildings: fit.placements,
        parking: [
          state.carStalls > 0
            ? {
                id: "P-car",
                kind: "car" as const,
                polygon: [
                  { x: 0, z: 0 },
                  { x: 5, z: 0 },
                  { x: 5, z: 5 },
                  { x: 0, z: 5 },
                ],
                stallCount: state.carStalls,
              }
            : null,
          state.truckStalls > 0
            ? {
                id: "P-truck",
                kind: "truck" as const,
                polygon: [
                  { x: 0, z: 0 },
                  { x: 5, z: 0 },
                  { x: 5, z: 5 },
                  { x: 0, z: 5 },
                ],
                stallCount: state.truckStalls,
              }
            : null,
        ].filter((p): p is NonNullable<typeof p> => p !== null),
        circulation: [],
        greenAreas: [],
      });
      const report = validateSitePlan(draft);
      return { site: draft, report, buildable, error: fitError };
    } catch (e) {
      return {
        site: null,
        buildable,
        report: { ok: false, errors: [], warnings: [] },
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [edges, lot.local, polygon, state, terrainId]);

  function go(next: number) {
    setStep(next);
    setFurthest((f) => Math.max(f, next));
  }
  function nextStep() {
    void ensureBriefing();
    go(Math.min(STEPS.length - 1, step + 1));
  }
  function prevStep() {
    go(Math.max(0, step - 1));
  }

  async function handleGenerate() {
    setError(null);
    setSubmitting(true);
    try {
      if (!candidate.site) {
        throw new Error(candidate.error ?? "SitePlan ainda inválido.");
      }
      if (!candidate.report.ok) {
        throw new Error(
          "Corrija os erros de validação antes de gerar o estudo.",
        );
      }
      const id = await ensureBriefing();

      // ---- Per-building AI generation (FR-G1, gated at step 6) ----------
      // Each placement gets its own IndustrialShed with different size /
      // style / zones so we never end up with N identical clones.
      const placements = candidate.site.buildings;
      const sheds = await Promise.all(
        placements.map((p, idx) =>
          generateShedForPlacement({
            placement: p,
            index: idx,
            total: placements.length,
            terrainId,
            terrainName,
            briefingId: id,
            standard: state.programa.standard,
            clearHeight: state.clearHeight,
          }),
        ),
      );

      // Embed each generated shed into its placement so the 3D viewer and
      // the Details panel render the real AI output.
      const enriched: SitePlan = {
        ...candidate.site,
        buildings: placements.map((p, idx) => ({
          ...p,
          shed: sheds[idx] ?? null,
        })),
      };

      const save = await fetch(`/api/terrenos/${terrainId}/site-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ briefingId: id, data: enriched }),
      });
      if (!save.ok) {
        const j = (await save.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Falha ao salvar SitePlan.");
      }
      router.push(`/terrenos/${terrainId}/estudo/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  // Total built area for preview stats
  const builtAreaM2 = useMemo(
    () =>
      (candidate.site?.buildings ?? []).reduce(
        (acc, b) => acc + polygonAreaLocal(b.footprintPolygon),
        0,
      ),
    [candidate.site],
  );

  return (
    <>
      <header className="page-header">
        <div className="stack-sm">
          <Breadcrumb
            items={[
              { label: "Meus terrenos", href: "/terrenos" },
              { label: terrainName, href: `/terrenos/${terrainId}` },
              { label: "Briefing" },
            ]}
          />
          <div className="page-title-row">
            <h1>{terrainName}</h1>
            <span className="pill pill-neutral mono">
              {areaM2.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} m²
            </span>
          </div>
          {terrainAddress && (
            <p className="text-sm muted">{terrainAddress}</p>
          )}
        </div>
      </header>

      <BriefingStepper
        steps={STEPS}
        current={step}
        furthest={furthest}
        onChange={go}
      />

      <div className="briefing-v2">
        <section
          className="briefing-v2__panel"
          aria-labelledby={`step-${step}`}
        >
          <div className="briefing-v2__panel-header">
            <h3 id={`step-${step}`}>
              {String(step + 1).padStart(2, "0")} · {STEPS[step].label}
            </h3>
            {STEPS[step].description && (
              <span className="briefing-v2__panel-sub">
                {STEPS[step].description}
              </span>
            )}
          </div>

          {step === 0 && (
            <StepTerrain
              edges={edges}
              streetEdges={state.streetEdges}
              setbacks={state.setbacks}
              onToggleEdge={(idx) =>
                setState((s) => ({
                  ...s,
                  streetEdges: s.streetEdges.includes(idx)
                    ? s.streetEdges.filter((i) => i !== idx)
                    : [...s.streetEdges, idx],
                }))
              }
              onSetbacks={(sb) => setState((s) => ({ ...s, setbacks: sb }))}
            />
          )}
          {step === 1 && (
            <StepPerimeter
              perimeterHeight={state.perimeterHeight}
              gateWidth={state.gateWidth}
              truckAccess={state.truckAccess}
              onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
            />
          )}
          {step === 2 && (
            <StepProgram
              value={state.programa}
              onChange={(p) => setState((s) => ({ ...s, programa: p }))}
              maxTargetArea={maxTargetArea}
              buildableAreaM2={buildableAreaM2}
              maxQty={maxQty}
              rotationDeg={state.rotationDeg}
              onRotation={(deg) => setState((s) => ({ ...s, rotationDeg: deg }))}
            />
          )}
          {step === 3 && (
            <StepBuildings
              clearHeight={state.clearHeight}
              programa={state.programa}
              gapM={state.gapM}
              onClearHeight={(v) => setState((s) => ({ ...s, clearHeight: v }))}
              onProgram={(p) => setState((s) => ({ ...s, programa: p }))}
              onGap={(v) => setState((s) => ({ ...s, gapM: v }))}
            />
          )}
          {step === 4 && (
            <StepCirculation
              carStalls={state.carStalls}
              truckStalls={state.truckStalls}
              onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
            />
          )}
          {step === 5 && (
            <StepReview report={candidate.report} error={candidate.error} />
          )}

          {error && (
            <p className="briefing-v2__error" role="alert">
              {error}
            </p>
          )}
        </section>

        <aside
          className="briefing-v2__panel"
          aria-label="Pré-visualização da planta"
        >
          <div className="briefing-v2__panel-header">
            <h3>Planta 2D · preview</h3>
            <span className="briefing-v2__panel-sub">
              Atualiza em tempo real conforme você edita o briefing.
            </span>
          </div>
          <div className={`briefing-v2__map-wrap${candidate.error ? " briefing-v2__svg--error" : ""}`}>
            <LotPreviewMap
              polygon={polygon}
              lotRef={lot.ref}
              polygonLocal={lot.local}
              edges={edges}
              streetEdges={state.streetEdges}
              buildable={candidate.buildable}
              setbacks={state.setbacks}
              buildings={
                (candidate.site?.buildings ?? []).map((b) => ({
                  polygon: b.footprintPolygon,
                  use: b.use,
                  name: b.name,
                }))
              }
              gates={candidate.site?.gates ?? []}
              hasFitError={Boolean(candidate.error)}
              clearHeight={state.clearHeight}
            />
          </div>
          <div className="briefing-v2__preview-stats">
            <span>
              Área útil:
              <strong>
                {" "}
                {buildableAreaM2.toLocaleString("pt-BR", {
                  maximumFractionDigits: 0,
                })}{" "}
                m²
              </strong>
            </span>
            <span>
              Área construída:
              <strong>
                {" "}
                {builtAreaM2.toLocaleString("pt-BR", {
                  maximumFractionDigits: 0,
                })}{" "}
                m²
              </strong>
            </span>
            <span>
              Galpões:<strong> {state.programa.qty}</strong>
            </span>
          </div>
          {candidate.error && (
            <div className="briefing-v2__preview-error" role="alert">
              <strong>Não cabe:</strong> {candidate.error}
            </div>
          )}
          <p className="briefing-v2__preview-hint">
            O modelo 3D só é gerado ao final do passo 6.
          </p>
        </aside>
      </div>

      <footer className="briefing-v2__footer">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={prevStep}
          disabled={step === 0}
        >
          ← Voltar
        </button>
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn btn--primary" onClick={nextStep}>
            Próximo →
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--accept"
            onClick={handleGenerate}
            disabled={submitting || !candidate.report.ok || !candidate.site}
            title={
              !candidate.report.ok ? "Corrija os erros antes de gerar." : ""
            }
          >
            {submitting ? "Gerando estudo…" : "Gerar estudo 3D"}
          </button>
        )}
      </footer>
    </>
  );
}

// ---- Step components ----------------------------------------------------

function StepProgram({
  value,
  onChange,
  maxTargetArea,
  buildableAreaM2,
  maxQty,
  rotationDeg,
  onRotation,
}: {
  value: Programa;
  onChange: (v: Programa) => void;
  maxTargetArea: number;
  buildableAreaM2: number;
  maxQty: number;
  rotationDeg: number;
  onRotation: (deg: number) => void;
}) {
  return (
    <div className="briefing-v2__fields">
      <div className="briefing-v2__field">
        <span>Uso principal</span>
        <div className="briefing-v2__seg" role="group">
          {USES.map((u) => (
            <button
              key={u.id}
              type="button"
              aria-pressed={value.use === u.id}
              onClick={() => onChange({ ...value, use: u.id })}
            >
              {u.label}
            </button>
          ))}
        </div>
      </div>
      <label className="briefing-v2__field">
        <span className="briefing-v2__field-label">
          Área alvo por galpão
          <span className="briefing-v2__field-value">
            {value.targetAreaM2.toLocaleString("pt-BR")} m² · máx{" "}
            {maxTargetArea.toLocaleString("pt-BR")} m² · útil{" "}
            {buildableAreaM2.toLocaleString("pt-BR", {
              maximumFractionDigits: 0,
            })}{" "}
            m²
          </span>
        </span>
        <input
          type="range"
          min={300}
          max={maxTargetArea}
          step={100}
          value={Math.min(value.targetAreaM2, maxTargetArea)}
          onChange={(e) =>
            onChange({ ...value, targetAreaM2: Number(e.target.value) })
          }
        />
      </label>
      <label className="briefing-v2__field">
        <span className="briefing-v2__field-label">
          Número de galpões
          <span className="briefing-v2__field-value">
            {value.qty}
            {maxQty < 6 && (
              <span style={{ opacity: 0.6, marginLeft: 8 }}>
                (máx {maxQty} para esta área)
              </span>
            )}
          </span>
        </span>
        <input
          type="number"
          min={1}
          max={6}
          value={value.qty}
          onChange={(e) =>
            onChange({
              ...value,
              qty: Math.max(1, Math.min(6, Number(e.target.value))),
            })
          }
        />
      </label>
      <label className="briefing-v2__field">
        <span className="briefing-v2__field-label">
          Rotação dos galpões
          <span className="briefing-v2__field-value">{rotationDeg}°</span>
        </span>
        <input
          type="range"
          min={0}
          max={360}
          step={5}
          value={rotationDeg}
          onChange={(e) => onRotation(Number(e.target.value))}
        />
      </label>
      <div className="briefing-v2__field">
        <span>Padrão construtivo</span>
        <div className="briefing-v2__seg" role="group">
          {([ "economico", "medio", "alto"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={value.standard === s}
              onClick={() => onChange({ ...value, standard: s })}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StepTerrain({
  edges,
  streetEdges,
  setbacks,
  onToggleEdge,
  onSetbacks,
}: {
  edges: ReturnType<typeof getEdges>;
  streetEdges: number[];
  setbacks: { front: number; sides: number; back: number };
  onToggleEdge: (idx: number) => void;
  onSetbacks: (sb: { front: number; sides: number; back: number }) => void;
}) {
  const labels = { front: "frontal", sides: "laterais", back: "fundos" } as const;
  return (
    <div className="briefing-v2__fields">
      <div className="briefing-v2__field">
        <span>Arestas voltadas à rua (clique para alternar)</span>
        <div className="briefing-v2__edges">
          {edges.map((e) => (
            <button
              key={e.index}
              type="button"
              aria-pressed={streetEdges.includes(e.index)}
              onClick={() => onToggleEdge(e.index)}
              className="briefing-v2__edge-chip"
            >
              Aresta {e.index} · {e.length.toFixed(1)} m
            </button>
          ))}
        </div>
      </div>
      {(["front", "sides", "back"] as const).map((k) => (
        <label key={k} className="briefing-v2__field">
          <span className="briefing-v2__field-label">
            Recuo {labels[k]}
            <span className="briefing-v2__field-value">{setbacks[k]} m</span>
          </span>
          <input
            type="range"
            min={SLIDER_RANGES.setback.min}
            max={SLIDER_RANGES.setback.max}
            step={SLIDER_RANGES.setback.step}
            value={setbacks[k]}
            onChange={(e) =>
              onSetbacks({ ...setbacks, [k]: Number(e.target.value) })
            }
          />
        </label>
      ))}
    </div>
  );
}

function StepPerimeter({
  perimeterHeight,
  gateWidth,
  truckAccess,
  onChange,
}: {
  perimeterHeight: number;
  gateWidth: number;
  truckAccess: boolean;
  onChange: (
    patch: Partial<{
      perimeterHeight: number;
      gateWidth: number;
      truckAccess: boolean;
    }>,
  ) => void;
}) {
  return (
    <div className="briefing-v2__fields">
      <label className="briefing-v2__field">
        <span className="briefing-v2__field-label">
          Altura do muro
          <span className="briefing-v2__field-value">{perimeterHeight} m</span>
        </span>
        <input
          type="range"
          min={1.5}
          max={4}
          step={0.1}
          value={perimeterHeight}
          onChange={(e) =>
            onChange({ perimeterHeight: Number(e.target.value) })
          }
        />
      </label>
      <div className="briefing-v2__field">
        <span>Acesso de caminhões</span>
        <div className="briefing-v2__seg" role="group">
          <button
            type="button"
            aria-pressed={truckAccess}
            onClick={() => onChange({ truckAccess: true })}
          >
            Sim
          </button>
          <button
            type="button"
            aria-pressed={!truckAccess}
            onClick={() => onChange({ truckAccess: false })}
          >
            Não
          </button>
        </div>
      </div>
      <label className="briefing-v2__field">
        <span className="briefing-v2__field-label">
          Largura do portão
          <span className="briefing-v2__field-value">{gateWidth} m</span>
        </span>
        <input
          type="range"
          min={SLIDER_RANGES.gateWidth.min}
          max={SLIDER_RANGES.gateWidth.max}
          step={0.5}
          value={gateWidth}
          onChange={(e) => onChange({ gateWidth: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}

function StepBuildings({
  clearHeight,
  programa,
  gapM,
  onClearHeight,
  onProgram,
  onGap,
}: {
  clearHeight: number;
  programa: Programa;
  gapM: number;
  onClearHeight: (v: number) => void;
  onProgram: (p: Programa) => void;
  onGap: (v: number) => void;
}) {
  return (
    <div className="briefing-v2__fields">
      <label className="briefing-v2__field">
        <span className="briefing-v2__field-label">
          Pé-direito útil
          <span className="briefing-v2__field-value">{clearHeight} m</span>
        </span>
        <input
          type="range"
          min={SLIDER_RANGES.clearHeight.min}
          max={SLIDER_RANGES.clearHeight.max}
          step={0.5}
          value={clearHeight}
          onChange={(e) => onClearHeight(Number(e.target.value))}
        />
      </label>
      <label className="briefing-v2__field">
        <span>Área alvo por galpão (m²)</span>
        <input
          type="number"
          min={300}
          max={20000}
          step={50}
          value={programa.targetAreaM2}
          onChange={(e) =>
            onProgram({ ...programa, targetAreaM2: Number(e.target.value) })
          }
        />
      </label>
      <label className="briefing-v2__field">
        <span className="briefing-v2__field-label">
          Espaçamento entre galpões
          <span className="briefing-v2__field-value">{gapM} m</span>
        </span>
        <input
          type="range"
          min={SITE_CONSTRAINTS.building.minGapBetweenM}
          max={30}
          step={0.5}
          value={gapM}
          onChange={(e) => onGap(Number(e.target.value))}
        />
      </label>
    </div>
  );
}

function StepCirculation({
  carStalls,
  truckStalls,
  onChange,
}: {
  carStalls: number;
  truckStalls: number;
  onChange: (
    patch: Partial<{ carStalls: number; truckStalls: number }>,
  ) => void;
}) {
  return (
    <div className="briefing-v2__fields">
      <label className="briefing-v2__field">
        <span>Vagas de carro</span>
        <input
          type="number"
          min={0}
          max={500}
          value={carStalls}
          onChange={(e) => onChange({ carStalls: Number(e.target.value) })}
        />
      </label>
      <label className="briefing-v2__field">
        <span>Vagas de caminhão</span>
        <input
          type="number"
          min={0}
          max={100}
          value={truckStalls}
          onChange={(e) => onChange({ truckStalls: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}

function StepReview({
  report,
  error,
}: {
  report: ValidationReport;
  error?: string;
}) {
  return (
    <div className="briefing-v2__validation">
      {error && (
        <div className="row error">
          <span className="code">FIT</span>
          <span>{error}</span>
        </div>
      )}
      {report.ok && report.warnings.length === 0 && (
        <div className="row ok">
          ✓ SitePlan validado — pronto para gerar o estudo 3D.
        </div>
      )}
      {report.errors.map((e, i) => (
        <div key={i} className="row error">
          <span className="code">{e.code}</span>
          <span>{e.message}</span>
        </div>
      ))}
      {report.warnings.map((w, i) => (
        <div key={`w-${i}`} className="row warning">
          <span className="code">{w.code}</span>
          <span>{w.message}</span>
        </div>
      ))}
    </div>
  );
}

// Helper bridging detectStreetEdges (currently unused by the auto-detect
// fallback). Kept here as a future hook for OSM-fed street polylines.
export const _detectStreetEdges = detectStreetEdges;

// =========================================================================
// AI generation — per-building.
// =========================================================================

interface PlacementGenInput {
  placement: {
    id: string;
    name: string;
    use: BuildingUse;
    targetAreaM2: number;
    footprintPolygon: { x: number; z: number }[];
  };
  index: number;
  total: number;
  terrainId: string;
  terrainName: string;
  briefingId: string;
  standard: "economico" | "medio" | "alto";
  clearHeight: number;
}

/** Heuristic variation hints so each building in a multi-shed study differs. */
const VARIATIONS: Array<{
  label: string;
  detail: string;
  standardOverride?: "economico" | "medio" | "alto";
}> = [
  {
    label: "operação principal com mezanino administrativo",
    detail:
      "Inclua um mezanino de escritório (≥ 60 m²) no canto frontal, salas de gerência, sala de reunião e copa.",
  },
  {
    label: "expedição cross-dock com docas dos dois lados",
    detail:
      "Distribua docas em paredes opostas (norte e sul), pé-direito ≥ 11 m, área de staging ampliada.",
    standardOverride: "alto",
  },
  {
    label: "manufatura/produção com ponte rolante",
    detail:
      "Inclua ponte rolante (5–10 t) e zona de produção contínua; reduza skylight, reforce área técnica e oficinas.",
  },
  {
    label: "cold storage refrigerado",
    detail:
      "Envoltória sandwich PIR, baixa skylight, antecâmara + casa de máquinas, doca rebaixada com seal.",
    standardOverride: "alto",
  },
  {
    label: "anexo administrativo com vestiários ampliados",
    detail:
      "Escritórios em 2 pavimentos (≥ 120 m²/piso), vestiários masculino/feminino completos, refeitório com cozinha.",
  },
  {
    label: "centro de distribuição com alta rotatividade",
    detail:
      "Múltiplas docas niveladas no fundo, picking + armazenagem segregados, AVCB com sprinklers.",
    standardOverride: "alto",
  },
];

function variationFor(
  index: number,
  total: number,
): (typeof VARIATIONS)[number] {
  if (total <= 1) return VARIATIONS[0];
  return VARIATIONS[index % VARIATIONS.length];
}

async function generateShedForPlacement(
  input: PlacementGenInput,
): Promise<IndustrialShed | null> {
  const { placement, index, total, terrainId, terrainName, briefingId } = input;
  const v = variationFor(index, total);
  const bbox = polygonBBox(placement.footprintPolygon);
  const footW = Math.max(6, Math.round(bbox.maxX - bbox.minX));
  const footD = Math.max(6, Math.round(bbox.maxZ - bbox.minZ));
  const standard = v.standardOverride ?? input.standard;
  const prompt = [
    `Projeto: ${placement.name} (${index + 1}/${total}) no terreno "${terrainName}".`,
    `Uso principal: ${placement.use}.`,
    `Área alvo: ${Math.round(placement.targetAreaM2)} m².`,
    `Footprint disponível (já posicionado no lote): largura ${footW} m × profundidade ${footD} m.`,
    `Pé-direito útil desejado: ~${input.clearHeight} m.`,
    `Padrão construtivo: ${standard}.`,
    `Característica obrigatória deste galpão: ${v.label}.`,
    `Detalhe: ${v.detail}`,
    total > 1
      ? `Importante: este é o galpão #${index + 1} de ${total}; ele deve ser claramente diferente dos demais em programa, tipologia de cobertura, layout de zonas e abertura de docas.`
      : "",
    `O JSON deve usar exatamente footprint.width=${footW} e footprint.depth=${footD} para casar com o posicionamento já fixado pelo wizard.`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await fetch("/api/ai/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        terrainId,
        briefingId,
        step: 6,
        use: placement.use,
        standard,
      }),
    });
    if (!res.ok || !res.body) return null;
    const shed = await readShedFromSse(res.body);
    if (!shed) return null;
    // Force footprint to the placement's actual size so the renderer aligns.
    return {
      ...shed,
      footprint: { width: footW, depth: footD },
    };
  } catch {
    return null;
  }
}

/** Reads an SSE stream from /api/ai/generate and returns the final shed. */
async function readShedFromSse(
  body: ReadableStream<Uint8Array>,
): Promise<IndustrialShed | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let shed: IndustrialShed | null = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const raw of events) {
        const lines = raw.split("\n");
        let evName = "";
        let dataLine = "";
        for (const ln of lines) {
          if (ln.startsWith("event:")) evName = ln.slice(6).trim();
          else if (ln.startsWith("data:")) dataLine += ln.slice(5).trim();
        }
        if (evName === "result" && dataLine) {
          try {
            const parsed = JSON.parse(dataLine) as { shed?: IndustrialShed };
            if (parsed.shed) shed = parsed.shed;
          } catch {
            // ignore
          }
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }
  return shed;
}
