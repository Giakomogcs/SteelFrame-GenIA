"use client";

/**
 * ShedInlineEditor
 * --------------------------------------------------------------
 * Painel de edição paramétrica ao vivo. Mostra sliders para:
 *  - Vão livre / largura (footprint.width = freeSpan)
 *  - Profundidade (footprint.depth)
 *  - Pé-direito (clearHeight)
 *  - Modulação (baySpacing) → bayCount recalculado
 *  - Inclinação cobertura (roof.slopePct)
 *  - Nº docas
 *  - Padrão construtivo (economico/medio/alto)
 *
 * Mudanças locais recomputam estimate (aço/custo) e atualizam o
 * preview do ShedViewer ao vivo. Salvar persiste via PATCH.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { IndustrialShed } from "@/lib/shedSchema";
import { recomputeEstimate } from "@/lib/shedDefaults";
import ShedViewer from "./ShedViewer";
import type { LngLat } from "@/lib/geo";

interface Props {
  terrainId: string;
  buildingId: string;
  initial: IndustrialShed;
  polygon: LngLat[];
}

const BRL = (n: number) =>
  n >= 1_000_000
    ? `R$ ${(n / 1_000_000).toFixed(2).replace(".", ",")} M`
    : n >= 1_000
      ? `R$ ${Math.round(n / 1_000).toLocaleString("pt-BR")} mil`
      : `R$ ${n.toFixed(0)}`;

export default function ShedInlineEditor({
  terrainId,
  buildingId,
  initial,
  polygon,
}: Props) {
  const router = useRouter();
  const [shed, setShed] = useState<IndustrialShed>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Aplica patch parcial recomputando aço/custo. */
  function patch(updater: (s: IndustrialShed) => IndustrialShed) {
    setShed((prev) => recomputeEstimate(updater(prev)));
  }

  function setWidth(v: number) {
    patch((s) => ({
      ...s,
      footprint: { ...s.footprint, width: v },
      structure: { ...s.structure, freeSpan: v },
    }));
  }
  function setDepth(v: number) {
    patch((s) => {
      const bayCount = Math.max(3, Math.round(v / s.structure.baySpacing));
      return {
        ...s,
        footprint: { ...s.footprint, depth: v },
        structure: {
          ...s.structure,
          bayCount,
          baySpacing: Number((v / bayCount).toFixed(2)),
        },
      };
    });
  }
  function setClearHeight(v: number) {
    patch((s) => ({ ...s, structure: { ...s.structure, clearHeight: v } }));
  }
  function setBaySpacing(v: number) {
    patch((s) => {
      const bayCount = Math.max(3, Math.round(s.footprint.depth / v));
      return {
        ...s,
        structure: {
          ...s.structure,
          baySpacing: v,
          bayCount,
        },
      };
    });
  }
  function setRoofSlope(v: number) {
    patch((s) => ({ ...s, roof: { ...s.roof, slopePct: v } }));
  }
  function setNumDocks(n: number) {
    patch((s) => {
      const w = s.footprint.width;
      const docks = Array.from({ length: n }).map((_, i) => ({
        x: 4 + i * Math.max(4, (w - 8) / Math.max(1, n - 1)),
        z: s.footprint.depth,
        wall: "north" as const,
        type: "nivelada" as const,
        levelers: true,
        seal: true,
      }));
      return { ...s, docks };
    });
  }
  function setStandard(std: IndustrialShed["standard"]) {
    patch((s) => ({ ...s, standard: std }));
  }
  function setLotSlope(v: number) {
    patch((s) => ({ ...s, lot: { ...s.lot, slopePct: v } }));
  }

  const dirty = useMemo(
    () => JSON.stringify(shed) !== JSON.stringify(initial),
    [shed, initial],
  );

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/terrenos/${terrainId}/construcoes/${buildingId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shed }),
        },
      );
      if (!res.ok) throw new Error("Falha ao salvar");
      setSavedAt(Date.now());
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setShed(initial);
  }

  return (
    <div className="shed-editor-shell">
      <div className="shed-editor-viewer">
        <ShedViewer shed={shed} polygon={polygon} height="100%" />
      </div>

      <aside className="shed-editor-panel">
        <header className="se-head">
          <div>
            <div className="se-tag">Editor inline · ao vivo</div>
            <h2 className="se-title">Ajustar geometria & estimar</h2>
          </div>
          <div className="se-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={reset}
              disabled={!dirty || saving}
            >
              ↺ Desfazer
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={save}
              disabled={!dirty || saving}
            >
              {saving ? "Salvando…" : savedAt && !dirty ? "✓ Salvo" : "Salvar"}
            </button>
          </div>
        </header>

        {error && (
          <div className="toast toast-danger" style={{ marginBottom: 12 }}>
            <div>
              <div className="toast-title">Erro</div>
              <div className="toast-desc">{error}</div>
            </div>
          </div>
        )}

        <div className="se-kpis">
          <div className="se-kpi accent">
            <span className="se-kpi-lbl">Área coberta</span>
            <strong>
              {shed.estimate.coveredAreaM2.toLocaleString("pt-BR")} m²
            </strong>
          </div>
          <div className="se-kpi accent">
            <span className="se-kpi-lbl">Custo total</span>
            <strong>{BRL(shed.estimate.totalCost)}</strong>
          </div>
          <div className="se-kpi">
            <span className="se-kpi-lbl">Aço</span>
            <strong>{(shed.estimate.steelKg / 1000).toFixed(1)} t</strong>
          </div>
          <div className="se-kpi">
            <span className="se-kpi-lbl">R$/m²</span>
            <strong>
              R$ {shed.estimate.costPerM2.toLocaleString("pt-BR")}
            </strong>
          </div>
        </div>

        <Section title="Geometria">
          <Slider
            label="Largura · vão livre"
            unit="m"
            min={10}
            max={60}
            step={1}
            value={shed.footprint.width}
            onChange={setWidth}
          />
          <Slider
            label="Profundidade"
            unit="m"
            min={20}
            max={200}
            step={1}
            value={shed.footprint.depth}
            onChange={setDepth}
          />
          <Slider
            label="Pé-direito"
            unit="m"
            min={6}
            max={18}
            step={0.5}
            value={shed.structure.clearHeight}
            onChange={setClearHeight}
          />
        </Section>

        <Section title="Estrutura · cobertura">
          <Slider
            label="Modulação (entre pórticos)"
            unit="m"
            min={6}
            max={12}
            step={0.5}
            value={shed.structure.baySpacing}
            onChange={setBaySpacing}
            hint={`${shed.structure.bayCount} pórticos`}
          />
          <Slider
            label="Inclinação cobertura"
            unit="%"
            min={2}
            max={25}
            step={1}
            value={shed.roof.slopePct}
            onChange={setRoofSlope}
          />
        </Section>

        <Section title="Operação">
          <Slider
            label="Docas niveladoras"
            unit=""
            min={0}
            max={16}
            step={1}
            value={shed.docks.length}
            onChange={setNumDocks}
          />
          <Slider
            label="Inclinação do terreno"
            unit="%"
            min={0}
            max={15}
            step={0.5}
            value={shed.lot.slopePct}
            onChange={setLotSlope}
            hint={shed.lot.slopePct > 3 ? "⚠ terraplenagem provável" : "OK"}
          />
        </Section>

        <Section title="Padrão construtivo">
          <div className="quickchips">
            {(["economico", "medio", "alto"] as const).map((s) => (
              <button
                key={s}
                type="button"
                className={`chip ${shed.standard === s ? "active" : ""}`}
                onClick={() => setStandard(s)}
              >
                {s === "economico"
                  ? "Econômico · R$ 1.8k/m²"
                  : s === "medio"
                    ? "Médio · R$ 2.4k/m²"
                    : "Alto · R$ 3.4k/m²"}
              </button>
            ))}
          </div>
        </Section>

        <p className="se-help">
          As mudanças refletem no 3D em tempo real e recalculam aço/custo. Toque{" "}
          <strong>Salvar</strong> para persistir.
        </p>
      </aside>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="se-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Slider({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
  hint,
}: {
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <label className="se-slider">
      <div className="se-slider-head">
        <span className="se-slider-lbl">{label}</span>
        <span className="se-slider-val">
          {value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
          {unit && <span className="se-slider-unit"> {unit}</span>}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <span className="se-slider-hint">{hint}</span>}
    </label>
  );
}
