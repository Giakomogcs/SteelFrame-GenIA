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
import { fromLocalMeters } from "@/lib/geo";
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
import {
  SitePlanSchema,
  type BuildingUse,
  type SitePlan,
  type ValidationReport,
} from "@/lib/sitePlanSchema";
import MapBackground from "@/components/MapBackground";

const STEPS: StepDef[] = [
  { id: "programa", label: "Programa", description: "Nº de galpões, uso" },
  { id: "terreno", label: "Terreno & rua", description: "Arestas e recuos" },
  { id: "perimetro", label: "Perímetro", description: "Muros e portões" },
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
      const fit = fitBuildings({
        buildable,
        requests: Array.from({ length: state.programa.qty }, (_, i) => ({
          id: `B${i + 1}`,
          name: `Galpão ${i + 1}`,
          targetAreaM2: state.programa.targetAreaM2,
          use: state.programa.use,
        })),
      });
      if (!fit.ok) {
        return {
          site: null,
          buildable,
          report: { ok: false, errors: [], warnings: [] },
          error: fit.reason,
        };
      }
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
      return { site: draft, report, buildable };
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
      const save = await fetch(`/api/terrenos/${terrainId}/site-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ briefingId: id, data: candidate.site }),
      });
      if (!save.ok) {
        const j = (await save.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "Falha ao salvar SitePlan.");
      }
      // Trigger AI generation gated at step 6 (FR-G1).
      await fetch("/api/ai/generate?fallback=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: `Galpão de ${state.programa.use} para o terreno ${terrainName}`,
          terrainId,
          briefingId: id,
          step: 6,
          use: state.programa.use,
          standard: state.programa.standard,
        }),
      }).catch(() => undefined);
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
            <StepProgram
              value={state.programa}
              onChange={(p) => setState((s) => ({ ...s, programa: p }))}
              maxTargetArea={maxTargetArea}
              buildableAreaM2={buildableAreaM2}
            />
          )}
          {step === 1 && (
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
          {step === 2 && (
            <StepPerimeter
              perimeterHeight={state.perimeterHeight}
              gateWidth={state.gateWidth}
              truckAccess={state.truckAccess}
              onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
            />
          )}
          {step === 3 && (
            <StepBuildings
              clearHeight={state.clearHeight}
              programa={state.programa}
              onClearHeight={(v) => setState((s) => ({ ...s, clearHeight: v }))}
              onProgram={(p) => setState((s) => ({ ...s, programa: p }))}
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
          <LotPreviewSvg
            polygon={polygon}
            lotRef={lot.ref}
            polygonLocal={lot.local}
            edges={edges}
            streetEdges={state.streetEdges}
            buildable={candidate.buildable}
            setbacks={state.setbacks}
            buildings={
              candidate.site?.buildings.map((b) => ({
                polygon: b.footprintPolygon,
                use: b.use,
                name: b.name,
              })) ?? []
            }
            gates={candidate.site?.gates ?? []}
            hasFitError={Boolean(candidate.error)}
            clearHeight={state.clearHeight}
          />
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
}: {
  value: Programa;
  onChange: (v: Programa) => void;
  maxTargetArea: number;
  buildableAreaM2: number;
}) {
  return (
    <div className="briefing-v2__fields">
      <label className="briefing-v2__field">
        <span className="briefing-v2__field-label">
          Número de galpões
          <span className="briefing-v2__field-value">{value.qty}</span>
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
  onClearHeight,
  onProgram,
}: {
  clearHeight: number;
  programa: Programa;
  onClearHeight: (v: number) => void;
  onProgram: (p: Programa) => void;
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

// ---- SVG preview --------------------------------------------------------

interface PreviewBuilding {
  polygon: { x: number; z: number }[];
  use: BuildingUse;
  name: string;
}

function LotPreviewSvg({
  polygon,
  lotRef,
  polygonLocal,
  edges,
  streetEdges,
  buildable,
  setbacks,
  buildings,
  gates,
  hasFitError,
  clearHeight,
}: {
  polygon: LngLat[];
  lotRef: LngLat;
  polygonLocal: { x: number; z: number }[];
  edges: ReturnType<typeof getEdges>;
  streetEdges: number[];
  buildable: { x: number; z: number }[] | null;
  setbacks: { front: number; sides: number; back: number };
  buildings: PreviewBuilding[];
  gates: { edgeIndex: number; tAlongEdge: number; width: number }[];
  hasFitError: boolean;
  clearHeight: number;
}) {
  const bb = useMemo(() => polygonBBox(polygonLocal), [polygonLocal]);
  const pad = Math.max(bb.width, bb.depth) * 0.12;
  const vbX = bb.minX - pad;
  const vbZ = bb.minZ - pad;
  const vbW = bb.width + pad * 2;
  const vbH = bb.depth + pad * 2;
  // Flip Y: norte (z crescente) deve aparecer no topo do SVG (y menor).
  const Y = (z: number) => -z;
  const vbMinY = -(vbZ + vbH);

  // Bounds geográficos do viewBox (mesma origem da projeção local em
  // BriefingClient) — usados pela camada satélite para alinhar pixel a
  // pixel com o SVG.
  const mapBounds = useMemo<[LngLat, LngLat]>(() => {
    const corners = fromLocalMeters(
      [
        { x: vbX, y: vbZ },
        { x: vbX + vbW, y: vbZ + vbH },
      ],
      lotRef,
    );
    const [sw, ne] = corners;
    return [sw, ne];
  }, [vbX, vbZ, vbW, vbH, lotRef]);

  const pts = (poly: { x: number; z: number }[]) =>
    poly.map((p) => `${p.x.toFixed(2)},${Y(p.z).toFixed(2)}`).join(" ");
  const streetSet = new Set(streetEdges);

  // Pick a nice scale-bar length (≈ 20% of view width, snapped to 5/10/20/50/100 m).
  const scaleTarget = vbW * 0.2;
  const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500];
  const scaleM =
    nice.find((n) => n >= scaleTarget) ?? nice[nice.length - 1];

  // Setback labels: classify edges as front/back/sides based on streetEdges
  // and pick midpoints. For brevity we render the setback value as a tiny
  // label slightly offset inward along the edge normal.
  const setbackByEdge = (edgeIdx: number): { value: number; key: string } => {
    if (streetSet.has(edgeIdx)) return { value: setbacks.front, key: "frente" };
    if (streetSet.size > 0) {
      const streetMids = edges
        .filter((e) => streetSet.has(e.index))
        .map((e) => e.mid);
      const avg = streetMids.reduce(
        (a, m) => ({ x: a.x + m.x / streetMids.length, z: a.z + m.z / streetMids.length }),
        { x: 0, z: 0 },
      );
      const e = edges[edgeIdx];
      const others = edges.filter((o) => !streetSet.has(o.index));
      const farthest = others.reduce((a, b) => {
        const da = Math.hypot(a.mid.x - avg.x, a.mid.z - avg.z);
        const db = Math.hypot(b.mid.x - avg.x, b.mid.z - avg.z);
        return db > da ? b : a;
      }, others[0] ?? e);
      if (farthest && farthest.index === edgeIdx)
        return { value: setbacks.back, key: "fundos" };
    }
    return { value: setbacks.sides, key: "lateral" };
  };

  // North arrow position (top-right of viewbox, em coords locais antes do flip).
  const northX = vbX + vbW - pad * 0.5;
  const northZ = vbZ + vbH - pad * 0.7; // norte = maior z (após flip vira topo)

  // Scale bar position (bottom-left visual = menor z após flip).
  const scaleX = vbX + pad * 0.5;
  const scaleZ = vbZ + pad * 0.4;

  return (
    <div className={`briefing-v2__map-wrap${hasFitError ? " briefing-v2__svg--error" : ""}`}>
      <MapBackground bounds={mapBounds} />
      <svg
        className="briefing-v2__svg"
        viewBox={`${vbX} ${vbMinY} ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Planta esquemática do terreno"
      >
        <polygon className="lot" points={pts(polygonLocal)} />

        {/* Buildable region (after setbacks + lane buffer) */}
        {buildable && buildable.length >= 3 && (
          <polygon className="buildable" points={pts(buildable)} />
        )}

        {/* Lot edges with street highlight */}
        {edges.map((e) => (
          <line
            key={e.index}
            className={`edge${streetSet.has(e.index) ? " edge--street" : ""}`}
            x1={e.a.x}
            y1={Y(e.a.z)}
            x2={e.b.x}
            y2={Y(e.b.z)}
          />
        ))}

        {/* Setback labels on each edge (small inward offset) */}
        {edges.map((e) => {
          const sb = setbackByEdge(e.index);
          const off = Math.min(vbW, vbH) * 0.025;
          const tx = e.mid.x - e.normal.x * off;
          const tz = e.mid.z - e.normal.z * off;
          return (
            <text
              key={`sb-${e.index}`}
              className="setback-label"
              x={tx}
              y={Y(tz)}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {sb.value} m
            </text>
          );
        })}

        {/* Buildings colored by typology, with dimension/area labels */}
        {buildings.map((b, i) => {
          const bbox = polygonBBox(b.polygon);
          const cx = bbox.minX + bbox.width / 2;
          const cz = bbox.minZ + bbox.depth / 2;
          const area = bbox.width * bbox.depth;
          return (
            <g key={i}>
              <polygon
                className={`building building--${b.use}`}
                points={pts(b.polygon)}
              />
              <text
                className="dim-label"
                x={cx}
                y={Y(cz) - 6}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {bbox.width.toFixed(0)} × {bbox.depth.toFixed(0)} m
              </text>
              <text
                className="area-label"
                x={cx}
                y={Y(cz) + 6}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {area.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} m²
                · PD {clearHeight} m
              </text>
            </g>
          );
        })}

        {/* Gates as wall openings (line segment proportional to gate width) */}
        {gates.map((g, i) => {
          const e = edges[g.edgeIndex];
          if (!e) return null;
          const ux = (e.b.x - e.a.x) / e.length;
          const uz = (e.b.z - e.a.z) / e.length;
          const cx = e.a.x + (e.b.x - e.a.x) * g.tAlongEdge;
          const cz = e.a.z + (e.b.z - e.a.z) * g.tAlongEdge;
          const hw = g.width / 2;
          return (
            <line
              key={i}
              className="gate"
              x1={cx - ux * hw}
              y1={Y(cz - uz * hw)}
              x2={cx + ux * hw}
              y2={Y(cz + uz * hw)}
            />
          );
        })}

        {/* North indicator */}
        <g>
          <text
            className="north"
            x={northX}
            y={Y(northZ)}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            N
          </text>
          <line
            className="north-arrow"
            x1={northX}
            y1={Y(northZ) + pad * 0.15}
            x2={northX}
            y2={Y(northZ) + pad * 0.55}
          />
        </g>

        {/* Scale bar */}
        <g>
          <line
            className="scale-bar"
            x1={scaleX}
            y1={Y(scaleZ)}
            x2={scaleX + scaleM}
            y2={Y(scaleZ)}
          />
          <line
            className="scale-bar"
            x1={scaleX}
            y1={Y(scaleZ) - pad * 0.08}
            x2={scaleX}
            y2={Y(scaleZ) + pad * 0.08}
          />
          <line
            className="scale-bar"
            x1={scaleX + scaleM}
            y1={Y(scaleZ) - pad * 0.08}
            x2={scaleX + scaleM}
            y2={Y(scaleZ) + pad * 0.08}
          />
          <text
            className="scale-bar-label"
            x={scaleX + scaleM / 2}
            y={Y(scaleZ) - pad * 0.28}
            textAnchor="middle"
          >
            {scaleM} m
          </text>
        </g>
      </svg>
    </div>
  );
}

// Helper bridging detectStreetEdges (currently unused by the auto-detect
// fallback). Kept here as a future hook for OSM-fed street polylines.
export const _detectStreetEdges = detectStreetEdges;
