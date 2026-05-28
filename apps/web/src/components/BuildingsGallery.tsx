"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { isIndustrialShed, type IndustrialShed } from "@/lib/shedSchema";
import { DeleteBuildingButton } from "@/components/DeleteBuildingButton";
import type { LngLat } from "@/lib/geo";

// 3D viewers carregam só no client e só quando há seleção
const ShedViewer = dynamic(() => import("@/components/ShedViewer"), {
  ssr: false,
  loading: () => <ViewerSkeleton label="Carregando visualização 3D…" />,
});

interface BuildingDTO {
  id: string;
  name: string;
  createdAt: string;
  model: unknown;
}

interface Props {
  terrainId: string;
  terrainName: string;
  polygon: LngLat[];
  buildings: BuildingDTO[];
}

const USE_LABEL: Record<string, string> = {
  logistics: "Logística",
  industrial: "Industrial",
  distribution_center: "Distribuição",
  cold_storage: "Câmara fria",
  cross_dock: "Cross-dock",
  manufacturing: "Manufatura",
};

const STANDARD_LABEL: Record<string, string> = {
  economico: "Econômico",
  medio: "Médio",
  alto: "Alto padrão",
};

function fmtR$(n: number) {
  if (n >= 1_000_000)
    return `R$ ${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} M`;
  if (n >= 1_000)
    return `R$ ${(n / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} k`;
  return `R$ ${n.toLocaleString("pt-BR")}`;
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Extrai campos comuns de qualquer formato de modelo (industrial novo ou legado). */
function summarize(model: unknown) {
  if (isIndustrialShed(model)) {
    const s = model as IndustrialShed;
    return {
      kind: "shed" as const,
      use: USE_LABEL[s.use] ?? s.use,
      standard: STANDARD_LABEL[s.standard] ?? s.standard,
      width: s.footprint.width,
      depth: s.footprint.depth,
      areaM2: s.estimate.coveredAreaM2 || s.footprint.width * s.footprint.depth,
      totalCost: s.estimate.totalCost,
      costPerM2: s.estimate.costPerM2,
      steelKg: s.estimate.steelKg,
      bays: s.structure.bayCount,
      height: s.structure.clearHeight,
      shed: s,
    };
  }
  // Legado (SteelFrameModel ou formato antigo)
  const m = model as {
    footprint?: { width?: number; depth?: number; areaM2?: number };
    estimate?: {
      totalCost?: number;
      coveredAreaM2?: number;
      steelKg?: number;
      costPerM2?: number;
    };
    estimatedCost?: number;
    estimatedSteelKg?: number;
    height?: number;
    bays?: number;
    use?: string;
  } | null;
  const width = m?.footprint?.width ?? 0;
  const depth = m?.footprint?.depth ?? 0;
  return {
    kind: "legacy" as const,
    use: m?.use ?? "—",
    standard: "—",
    width,
    depth,
    areaM2: m?.estimate?.coveredAreaM2 ?? m?.footprint?.areaM2 ?? width * depth,
    totalCost: m?.estimate?.totalCost ?? m?.estimatedCost ?? 0,
    costPerM2: m?.estimate?.costPerM2 ?? 0,
    steelKg: m?.estimate?.steelKg ?? m?.estimatedSteelKg ?? 0,
    bays: m?.bays ?? 0,
    height: m?.height ?? 0,
    shed: null,
  };
}

/** Mini-thumbnail top-down em SVG do galpão (footprint + zonas + docas). */
function ShedThumb({ model, selected }: { model: unknown; selected: boolean }) {
  const sum = summarize(model);
  const W = 240;
  const H = 140;
  const pad = 10;
  const innerW = W - pad * 2;
  const innerH = H - pad * 2;

  if (!sum.width || !sum.depth) {
    return (
      <div className="building-thumb-empty">
        <svg viewBox="0 0 24 24" width={28} height={28}>
          <path
            d="M3 21V8l9-5 9 5v13H3z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      </div>
    );
  }

  // Escalar para preencher
  const aspect = sum.width / sum.depth;
  let drawW = innerW;
  let drawH = innerW / aspect;
  if (drawH > innerH) {
    drawH = innerH;
    drawW = innerH * aspect;
  }
  const ox = (W - drawW) / 2;
  const oy = (H - drawH) / 2;

  const stroke = selected ? "#D72042" : "rgba(255,255,255,0.45)";
  const fill = selected ? "rgba(215,32,66,0.18)" : "rgba(255,255,255,0.04)";

  // Pintar zonas se houver
  const zones =
    sum.kind === "shed" && sum.shed
      ? sum.shed.zones.map((z) => {
          const zx = ox + ((z.x + sum.width / 2) / sum.width) * drawW;
          const zy = oy + ((z.z + sum.depth / 2) / sum.depth) * drawH;
          const zw = (z.width / sum.width) * drawW;
          const zh = (z.depth / sum.depth) * drawH;
          return { x: zx, y: zy, w: zw, h: zh };
        })
      : [];

  return (
    <svg
      className="building-thumb"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <pattern
          id={`grid-${selected ? "sel" : "off"}`}
          width={12}
          height={12}
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M12 0H0V12"
            fill="none"
            stroke="rgba(255,255,255,0.04)"
            strokeWidth={1}
          />
        </pattern>
      </defs>
      <rect
        x={0}
        y={0}
        width={W}
        height={H}
        fill={`url(#grid-${selected ? "sel" : "off"})`}
      />
      {/* footprint */}
      <rect
        x={ox}
        y={oy}
        width={drawW}
        height={drawH}
        fill={fill}
        stroke={stroke}
        strokeWidth={1.8}
        rx={2}
      />
      {/* zonas */}
      {zones.map((z, i) => (
        <rect
          key={i}
          x={z.x}
          y={z.y}
          width={z.w}
          height={z.h}
          fill="rgba(56,148,232,0.18)"
          stroke="rgba(56,148,232,0.55)"
          strokeWidth={0.8}
        />
      ))}
      {/* eixo dos pórticos (linhas verticais) */}
      {sum.kind === "shed" && sum.shed && sum.shed.structure.bayCount > 1
        ? Array.from({ length: sum.shed.structure.bayCount + 1 }).map((_, i) => {
            const t = i / sum.shed!.structure.bayCount;
            const x = ox + t * drawW;
            return (
              <line
                key={i}
                x1={x}
                y1={oy}
                x2={x}
                y2={oy + drawH}
                stroke={selected ? "rgba(215,32,66,0.4)" : "rgba(255,255,255,0.15)"}
                strokeWidth={0.6}
              />
            );
          })
        : null}
      {/* cota largura no rodapé */}
      <text
        x={W / 2}
        y={H - 2}
        fontSize={9}
        textAnchor="middle"
        fill="rgba(255,255,255,0.5)"
        fontFamily="ui-monospace, monospace"
      >
        {sum.width.toFixed(0)} × {sum.depth.toFixed(0)} m
      </text>
    </svg>
  );
}

function ViewerSkeleton({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        minHeight: 360,
        background: "var(--color-surface)",
        color: "var(--color-text-secondary)",
        borderRadius: "var(--radius-md)",
      }}
    >
      {label}
    </div>
  );
}

export default function BuildingsGallery({
  terrainId,
  polygon,
  buildings,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(
    buildings[0]?.id ?? null,
  );

  const selected = useMemo(
    () => buildings.find((b) => b.id === selectedId) ?? buildings[0] ?? null,
    [buildings, selectedId],
  );

  const selectedSum = selected ? summarize(selected.model) : null;

  if (buildings.length === 0) {
    return (
      <section className="buildings-section">
        <div className="buildings-header">
          <div>
            <div className="buildings-eyebrow">
              <span className="dot" /> Construções neste terreno
            </div>
            <h2 className="buildings-title">Nenhum estudo ainda</h2>
            <p className="buildings-sub">
              Gere o primeiro modelo 3D conversando com a IA — em minutos você
              tem footprint, custo SINAPI e relatório.
            </p>
          </div>
          <Link
            href={`/terrenos/${terrainId}/briefing`}
            className="btn btn-primary"
          >
            ✨ Iniciar primeiro briefing
          </Link>
        </div>
        <div className="buildings-empty-art">
          <svg viewBox="0 0 80 64" width={120} height={96}>
            <path
              d="M4 60h72M12 60V28l28-18 28 18v32M24 60V42h12v18M44 60V42h12v18M22 32h16M42 32h16"
              fill="none"
              stroke="rgba(255,255,255,0.18)"
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
          </svg>
          <span className="muted text-sm">
            Suas construções aparecerão aqui, com 3D, custo e dimensões.
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="buildings-section">
      <div className="buildings-header">
        <div>
          <div className="buildings-eyebrow">
            <span className="dot" /> Construções neste terreno ·{" "}
            <strong>{buildings.length}</strong>{" "}
            {buildings.length === 1 ? "estudo" : "estudos"}
          </div>
          <h2 className="buildings-title">
            {selected?.name ?? "Selecione um estudo"}
          </h2>
          {selectedSum && (
            <p className="buildings-sub">
              {selectedSum.use} · {selectedSum.standard} ·{" "}
              {selectedSum.width.toFixed(1)} × {selectedSum.depth.toFixed(1)} m
              · {Math.round(selectedSum.areaM2).toLocaleString("pt-BR")} m²
              cobertos
            </p>
          )}
        </div>
        <div className="row">
          {selected && (
            <>
              <Link
                href={`/terrenos/${terrainId}/construcoes/${selected.id}`}
                className="btn btn-secondary"
              >
                🔍 Abrir 3D completo
              </Link>
              <Link
                href={`/terrenos/${terrainId}/construcoes/${selected.id}/relatorio`}
                className="btn btn-secondary"
              >
                📄 Relatório
              </Link>
            </>
          )}
          <Link
            href={`/terrenos/${terrainId}/briefing`}
            className="btn btn-primary"
          >
            ✨ Novo briefing
          </Link>
        </div>
      </div>

      {/* HERO: 3D viewer + dashboard de custos lado a lado */}
      {selected && selectedSum && (
        <div className="building-hero">
          <div className="building-hero-viewer">
            {selectedSum.kind === "shed" && selectedSum.shed ? (
              <ShedViewer
                shed={selectedSum.shed}
                polygon={polygon}
                height="100%"
                compact
              />
            ) : (
              <div className="building-hero-fallback">
                <ShedThumb model={selected.model} selected />
                <span className="muted text-sm">
                  Estudo legado — abra o 3D completo para visualizar.
                </span>
              </div>
            )}
          </div>

          <div className="building-hero-dash">
            <div className="dash-kpi dash-kpi-hero">
              <div className="dash-kpi-lbl">Custo estimado</div>
              <div className="dash-kpi-val">
                {fmtR$(selectedSum.totalCost)}
              </div>
              <div className="dash-kpi-foot">
                {selectedSum.costPerM2 > 0
                  ? `${fmtR$(selectedSum.costPerM2)}/m² · SINAPI/CUB`
                  : "SINAPI / CUB · prévia"}
              </div>
            </div>
            <div className="dash-grid">
              <div className="dash-kpi">
                <div className="dash-kpi-lbl">Área coberta</div>
                <div className="dash-kpi-val">
                  {Math.round(selectedSum.areaM2).toLocaleString("pt-BR")}
                  <span className="unit">m²</span>
                </div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-lbl">Aço estimado</div>
                <div className="dash-kpi-val">
                  {selectedSum.steelKg > 0
                    ? Math.round(selectedSum.steelKg / 1000).toLocaleString(
                        "pt-BR",
                      )
                    : "—"}
                  <span className="unit">t</span>
                </div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-lbl">Pórticos</div>
                <div className="dash-kpi-val">
                  {selectedSum.bays || "—"}
                  <span className="unit">vãos</span>
                </div>
              </div>
              <div className="dash-kpi">
                <div className="dash-kpi-lbl">Pé-direito</div>
                <div className="dash-kpi-val">
                  {selectedSum.height || "—"}
                  <span className="unit">m</span>
                </div>
              </div>
            </div>
            <div className="dash-meta">
              Criado em {fmtDate(selected.createdAt)} · Versão mais recente
              deste estudo
            </div>
          </div>
        </div>
      )}

      {/* GALERIA: cards seletores */}
      <div className="buildings-strip-header">
        <span className="muted text-xs mono uppercase">Todos os estudos</span>
        <span className="muted text-xs">clique para visualizar acima</span>
      </div>
      <div className="buildings-strip">
        {buildings.map((b) => {
          const sum = summarize(b.model);
          const isSel = b.id === selected?.id;
          return (
            <div
              key={b.id}
              className={`building-tile${isSel ? " is-selected" : ""}`}
            >
              <button
                type="button"
                onClick={() => setSelectedId(b.id)}
                className="building-tile-btn"
                aria-pressed={isSel}
              >
                <div className="building-tile-thumb">
                  <ShedThumb model={b.model} selected={isSel} />
                  {isSel && (
                    <span className="building-tile-badge">
                      <span className="dot" /> selecionado
                    </span>
                  )}
                </div>
                <div className="building-tile-body">
                  <div className="building-tile-title">{b.name}</div>
                  <div className="building-tile-meta">
                    {sum.use !== "—" ? sum.use : "Estudo"} ·{" "}
                    {fmtDate(b.createdAt)}
                  </div>
                  <div className="building-tile-cost">
                    {fmtR$(sum.totalCost)}
                  </div>
                  <div className="building-tile-foot">
                    {sum.width.toFixed(0)}×{sum.depth.toFixed(0)} m ·{" "}
                    {Math.round(sum.areaM2).toLocaleString("pt-BR")} m²
                  </div>
                </div>
              </button>
              <div className="building-tile-actions">
                <DeleteBuildingButton
                  terrainId={terrainId}
                  buildingId={b.id}
                  buildingName={b.name}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
