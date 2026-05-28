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
import {
  BriefingStepper,
  type StepDef,
} from "@/components/BriefingStepper";
import { SITE_CONSTRAINTS, SLIDER_RANGES, validateSitePlan } from "@/lib/siteConstraints";
import {
  buildBuildableRegion,
  detectStreetEdges,
  getEdges,
  placeGates,
  polygonBBox,
  projectLotToLocal,
} from "@/lib/siteGeometry";
import { fitBuildings } from "@/lib/siteLayout";
import {
  SitePlanSchema,
  type SitePlan,
  type ValidationReport,
} from "@/lib/sitePlanSchema";

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
  const [briefingId, setBriefingId] = useState<string | null>(initialBriefingId);
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

  // ---- Derive SitePlan from current state (deterministic) ---------------

  const candidate = useMemo<{
    site: SitePlan | null;
    report: ValidationReport;
    error?: string;
  }>(() => {
    try {
      const buildable = buildBuildableRegion(lot.local, {
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
      return { site: draft, report };
    } catch (e) {
      return {
        site: null,
        report: { ok: false, errors: [], warnings: [] },
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [
    edges,
    lot.local,
    polygon,
    state,
    terrainId,
  ]);

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
      const save = await fetch(
        `/api/terrenos/${terrainId}/site-plan`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ briefingId: id, data: candidate.site }),
        },
      );
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

  return (
    <div
      className="briefing-shell"
      style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}
    >
      <BriefingStepper
        steps={STEPS}
        current={step}
        furthest={furthest}
        onChange={go}
      />

      <div className="briefing-v2" style={{ flex: 1 }}>
        <section className="briefing-v2__panel" aria-labelledby={`step-${step}`}>
          <header>
            <h3 id={`step-${step}`}>
              {step + 1}. {STEPS[step].label}
            </h3>
            {terrainAddress && (
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                {terrainAddress} · {areaM2.toFixed(0)} m²
              </div>
            )}
          </header>

          {step === 0 && (
            <StepProgram value={state.programa} onChange={(p) => setState((s) => ({ ...s, programa: p }))} />
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
          {step === 5 && <StepReview report={candidate.report} error={candidate.error} />}

          {error && (
            <p style={{ color: "#fca5a5", fontSize: 12 }} role="alert">
              {error}
            </p>
          )}
        </section>

        <aside className="briefing-v2__panel" aria-label="Pré-visualização da planta">
          <h3>Planta 2D (preview)</h3>
          <LotPreviewSvg
            polygonLocal={lot.local}
            edges={edges}
            streetEdges={state.streetEdges}
            buildings={candidate.site?.buildings.map((b) => b.footprintPolygon) ?? []}
            gates={candidate.site?.gates ?? []}
          />
          <div style={{ fontSize: 11, color: "#64748b" }}>
            O modelo 3D só é gerado ao final do passo 6.
          </div>
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
            title={!candidate.report.ok ? "Corrija os erros antes de gerar." : ""}
          >
            {submitting ? "Gerando estudo…" : "Gerar estudo 3D"}
          </button>
        )}
      </footer>
    </div>
  );
}

// ---- Step components ----------------------------------------------------

function StepProgram({
  value,
  onChange,
}: {
  value: Programa;
  onChange: (v: Programa) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <label className="briefing-v2__field">
        <span>Número de galpões</span>
        <input
          type="number"
          min={1}
          max={6}
          value={value.qty}
          onChange={(e) =>
            onChange({ ...value, qty: Math.max(1, Math.min(6, Number(e.target.value))) })
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
        <span>Área alvo por galpão: {value.targetAreaM2.toLocaleString("pt-BR")} m²</span>
        <input
          type="range"
          min={300}
          max={20000}
          step={100}
          value={value.targetAreaM2}
          onChange={(e) => onChange({ ...value, targetAreaM2: Number(e.target.value) })}
        />
      </label>
      <div className="briefing-v2__field">
        <span>Padrão construtivo</span>
        <div className="briefing-v2__seg" role="group">
          {(["economico", "medio", "alto"] as const).map((s) => (
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
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="briefing-v2__field">
        <span>Arestas voltadas à rua (clique para alternar)</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {edges.map((e) => (
            <button
              key={e.index}
              type="button"
              aria-pressed={streetEdges.includes(e.index)}
              onClick={() => onToggleEdge(e.index)}
              className="briefing-v2__seg"
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                fontSize: 12,
                background: streetEdges.includes(e.index)
                  ? "#f59e0b"
                  : "#0b1220",
                color: streetEdges.includes(e.index) ? "#0b1220" : "#cbd5e1",
                border: "1px solid rgba(255,255,255,0.08)",
                cursor: "pointer",
              }}
            >
              Aresta {e.index} · {e.length.toFixed(1)} m
            </button>
          ))}
        </div>
      </div>
      {(["front", "sides", "back"] as const).map((k) => (
        <label key={k} className="briefing-v2__field">
          <span>
            Recuo {k} (m): {setbacks[k]}
          </span>
          <input
            type="range"
            min={SLIDER_RANGES.setback.min}
            max={SLIDER_RANGES.setback.max}
            step={SLIDER_RANGES.setback.step}
            value={setbacks[k]}
            onChange={(e) => onSetbacks({ ...setbacks, [k]: Number(e.target.value) })}
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
    <div style={{ display: "grid", gap: 14 }}>
      <label className="briefing-v2__field">
        <span>Altura do muro (m): {perimeterHeight}</span>
        <input
          type="range"
          min={1.5}
          max={4}
          step={0.1}
          value={perimeterHeight}
          onChange={(e) => onChange({ perimeterHeight: Number(e.target.value) })}
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
        <span>Largura do portão (m): {gateWidth}</span>
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
    <div style={{ display: "grid", gap: 14 }}>
      <label className="briefing-v2__field">
        <span>Pé-direito útil (m): {clearHeight}</span>
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
  onChange: (patch: Partial<{ carStalls: number; truckStalls: number }>) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
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

function LotPreviewSvg({
  polygonLocal,
  edges,
  streetEdges,
  buildings,
  gates,
}: {
  polygonLocal: { x: number; z: number }[];
  edges: ReturnType<typeof getEdges>;
  streetEdges: number[];
  buildings: { x: number; z: number }[][];
  gates: { edgeIndex: number; tAlongEdge: number; width: number }[];
}) {
  const bb = useMemo(() => polygonBBox(polygonLocal), [polygonLocal]);
  const pad = Math.max(bb.width, bb.depth) * 0.08;
  const vbX = bb.minX - pad;
  const vbZ = bb.minZ - pad;
  const vbW = bb.width + pad * 2;
  const vbH = bb.depth + pad * 2;
  const pts = (poly: { x: number; z: number }[]) =>
    poly.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`).join(" ");
  const streetSet = new Set(streetEdges);
  return (
    <svg
      className="briefing-v2__svg"
      viewBox={`${vbX} ${vbZ} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Planta esquemática do terreno"
    >
      <polygon className="lot" points={pts(polygonLocal)} />
      {edges.map((e) => (
        <line
          key={e.index}
          className={`edge${streetSet.has(e.index) ? " edge--street" : ""}`}
          x1={e.a.x}
          y1={e.a.z}
          x2={e.b.x}
          y2={e.b.z}
        />
      ))}
      {buildings.map((poly, i) => (
        <polygon key={i} className="building" points={pts(poly)} />
      ))}
      {gates.map((g, i) => {
        const e = edges[g.edgeIndex];
        if (!e) return null;
        const cx = e.a.x + (e.b.x - e.a.x) * g.tAlongEdge;
        const cz = e.a.z + (e.b.z - e.a.z) * g.tAlongEdge;
        const r = Math.max(0.5, g.width / 4);
        return <circle key={i} className="gate" cx={cx} cy={cz} r={r} />;
      })}
    </svg>
  );
}

// Helper bridging detectStreetEdges (currently unused by the auto-detect
// fallback). Kept here as a future hook for OSM-fed street polylines.
export const _detectStreetEdges = detectStreetEdges;
