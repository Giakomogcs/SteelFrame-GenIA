"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { isIndustrialShed, type IndustrialShed } from "@/lib/shedSchema";
import { SitePlanSchema, type SitePlan } from "@/lib/sitePlanSchema";
import { DeleteBuildingButton } from "@/components/DeleteBuildingButton";
import type { LngLat } from "@/lib/geo";
import { COST_PER_M2, STEEL_KG_PER_M2 } from "@/lib/shedDefaults";

/** Heurísticas de fallback (espelham `generateFallbackShed`). */
const BAY_SPACING_BY_USE: Record<string, number> = {
  logistics: 8,
  distribution_center: 8,
  cross_dock: 8,
  cold_storage: 8,
  industrial: 7,
  manufacturing: 7,
};
const CLEAR_HEIGHT_BY_USE: Record<string, number> = {
  logistics: 10,
  distribution_center: 10,
  cross_dock: 10,
  cold_storage: 12,
  industrial: 8,
  manufacturing: 8,
};

/** Área (m²) de um polígono local (ENU) via shoelace. */
function polygonAreaLocal(poly: { x: number; z: number }[]): number {
  if (!poly || poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a) / 2;
}

// 3D viewers carregam só no client e só quando há seleção
const ShedViewer = dynamic(() => import("@/components/ShedViewer"), {
  ssr: false,
  loading: () => <ViewerSkeleton label="Carregando visualização 3D…" />,
});
const SitePlanViewer3D = dynamic(
  () => import("@/components/SitePlanViewer3D.client"),
  {
    ssr: false,
    loading: () => <ViewerSkeleton label="Carregando SitePlan 3D…" />,
  },
);

/** Detecta um SitePlan persistido como Building.model (briefings/accept). */
function parseSitePlan(model: unknown): SitePlan | null {
  if (!model || typeof model !== "object") return null;
  const maybe = model as { schemaVersion?: unknown };
  if (maybe.schemaVersion !== "site-1") return null;
  const parsed = SitePlanSchema.safeParse(model);
  return parsed.success ? parsed.data : null;
}

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

/** Extrai campos comuns de qualquer formato de modelo (SitePlan, shed industrial ou legado). */
function summarize(model: unknown) {
  const site = parseSitePlan(model);
  if (site) {
    const sheds: IndustrialShed[] = site.buildings
      .map((b) => b.shed)
      .filter((s): s is IndustrialShed => !!s && isIndustrialShed(s));
    // KPIs agregados: custo, aço, pórticos e pé-direito. Sempre exibe um
    // valor — quando o `BuildingPlacement` ainda não tem `shed` sintetizado,
    // calculamos uma estimativa paramétrica a partir do footprint e do uso.
    let totalCost = 0;
    let steelKg = 0;
    let bays = 0;
    let height = 0;
    for (const b of site.buildings) {
      const s = b.shed;
      const footprintArea = polygonAreaLocal(b.footprintPolygon);
      // bbox local do footprint para inferir profundidade.
      let bMinX = Infinity,
        bMaxX = -Infinity,
        bMinZ = Infinity,
        bMaxZ = -Infinity;
      for (const p of b.footprintPolygon) {
        if (p.x < bMinX) bMinX = p.x;
        if (p.x > bMaxX) bMaxX = p.x;
        if (p.z < bMinZ) bMinZ = p.z;
        if (p.z > bMaxZ) bMaxZ = p.z;
      }
      const bDepth = Number.isFinite(bMinZ) ? bMaxZ - bMinZ : 0;
      const areaB = footprintArea > 0 ? footprintArea : b.targetAreaM2 || 0;
      const use = (s?.use ?? b.use) as string;
      const spacing = BAY_SPACING_BY_USE[use] ?? 8;
      const fallbackDepth =
        bDepth > 0 ? bDepth : areaB > 0 ? Math.sqrt(areaB * 2) : 0;

      if (s && isIndustrialShed(s) && s.estimate.totalCost > 0) {
        totalCost += s.estimate.totalCost;
      } else {
        totalCost += Math.round(areaB * COST_PER_M2.medio);
      }
      if (s && isIndustrialShed(s) && s.estimate.steelKg > 0) {
        steelKg += s.estimate.steelKg;
      } else {
        steelKg += Math.round(areaB * STEEL_KG_PER_M2.porticos_aco);
      }
      if (s && isIndustrialShed(s) && s.structure.bayCount > 0) {
        bays += s.structure.bayCount;
      } else if (fallbackDepth > 0) {
        bays += Math.max(3, Math.round(fallbackDepth / spacing));
      }
      const hB =
        s && isIndustrialShed(s) && s.structure.clearHeight > 0
          ? s.structure.clearHeight
          : (CLEAR_HEIGHT_BY_USE[use] ?? 10);
      if (hB > height) height = hB;
    }
    // Área coberta: prefere estimate dos sheds embarcados; cai para a área
    // real do footprint (ou targetAreaM2) quando não há shed sintetizado.
    const areaFromSheds = sheds.reduce(
      (acc, s) =>
        acc +
        (s.estimate.coveredAreaM2 || s.footprint.width * s.footprint.depth),
      0,
    );
    const areaFromPlacements = site.buildings.reduce((acc, b) => {
      const fp = polygonAreaLocal(b.footprintPolygon);
      return acc + (fp > 0 ? fp : b.targetAreaM2 || 0);
    }, 0);
    const areaM2 = areaFromSheds > 0 ? areaFromSheds : areaFromPlacements;
    const costPerM2 = areaM2 > 0 ? totalCost / areaM2 : 0;
    // Bounding box dos footprints locais para apresentar dimensões agregadas.
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const b of site.buildings) {
      for (const p of b.footprintPolygon) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
      }
    }
    const bboxW = Number.isFinite(minX) ? maxX - minX : 0;
    const bboxD = Number.isFinite(minZ) ? maxZ - minZ : 0;
    const dominantUse = sheds[0]?.use ?? site.buildings[0]?.use ?? "—";
    const dominantStd = sheds[0]?.standard;
    return {
      kind: "site" as const,
      use: USE_LABEL[dominantUse] ?? dominantUse,
      standard: dominantStd
        ? (STANDARD_LABEL[dominantStd] ?? dominantStd)
        : "—",
      width: bboxW,
      depth: bboxD,
      areaM2,
      totalCost,
      costPerM2,
      steelKg,
      bays,
      height,
      shed: null,
      site,
      buildingCount: site.buildings.length,
    };
  }
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
      site: null as SitePlan | null,
      buildingCount: 1,
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
  const areaLegacy =
    m?.estimate?.coveredAreaM2 ?? m?.footprint?.areaM2 ?? width * depth;
  const useLegacy = m?.use ?? "logistics";
  const spacingLegacy = BAY_SPACING_BY_USE[useLegacy] ?? 8;
  const fallbackDepth =
    depth > 0 ? depth : areaLegacy > 0 ? Math.sqrt(areaLegacy * 2) : 0;
  const baysLegacy =
    m?.bays && m.bays > 0
      ? m.bays
      : fallbackDepth > 0
        ? Math.max(3, Math.round(fallbackDepth / spacingLegacy))
        : 0;
  const heightLegacy =
    m?.height && m.height > 0
      ? m.height
      : (CLEAR_HEIGHT_BY_USE[useLegacy] ?? 10);
  const steelLegacy =
    m?.estimate?.steelKg ??
    m?.estimatedSteelKg ??
    (areaLegacy > 0
      ? Math.round(areaLegacy * STEEL_KG_PER_M2.porticos_aco)
      : 0);
  const costLegacy =
    m?.estimate?.totalCost ??
    m?.estimatedCost ??
    (areaLegacy > 0 ? Math.round(areaLegacy * COST_PER_M2.medio) : 0);
  return {
    kind: "legacy" as const,
    use: m?.use ?? "—",
    standard: "—",
    width,
    depth,
    areaM2: areaLegacy,
    totalCost: costLegacy,
    costPerM2: areaLegacy > 0 ? costLegacy / areaLegacy : 0,
    steelKg: steelLegacy,
    bays: baysLegacy,
    height: heightLegacy,
    shed: null,
    site: null as SitePlan | null,
    buildingCount: 0,
  };
}

/** Mini-thumbnail de um SitePlan: lote + footprints das construções. */
function SiteThumb({
  site,
  selected,
  W,
  H,
}: {
  site: SitePlan;
  selected: boolean;
  W: number;
  H: number;
}) {
  const pad = 8;
  const lot = site.lotPolygonLocal;
  if (!lot || lot.length < 3) {
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
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const p of lot) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const lotW = Math.max(1e-3, maxX - minX);
  const lotD = Math.max(1e-3, maxZ - minZ);
  const innerW = W - pad * 2;
  const innerH = H - pad * 2;
  const scale = Math.min(innerW / lotW, innerH / lotD);
  const drawW = lotW * scale;
  const drawH = lotD * scale;
  const ox = (W - drawW) / 2;
  const oy = (H - drawH) / 2;
  const project = (p: { x: number; z: number }) => ({
    x: ox + (p.x - minX) * scale,
    y: oy + (p.z - minZ) * scale,
  });
  const lotPath =
    lot
      .map((p, i) => {
        const q = project(p);
        return `${i === 0 ? "M" : "L"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
      })
      .join(" ") + " Z";
  const buildingPaths = site.buildings.map((b) => {
    const pts = b.footprintPolygon.map(project);
    return (
      pts
        .map(
          (q, i) => `${i === 0 ? "M" : "L"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`,
        )
        .join(" ") + " Z"
    );
  });
  const stroke = selected ? "#D72042" : "rgba(255,255,255,0.45)";
  const fill = selected ? "rgba(215,32,66,0.22)" : "rgba(255,255,255,0.10)";
  return (
    <svg
      className="building-thumb"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
    >
      <path
        d={lotPath}
        fill="rgba(56,148,232,0.06)"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth={1}
      />
      {buildingPaths.map((d, i) => (
        <path key={i} d={d} fill={fill} stroke={stroke} strokeWidth={1.4} />
      ))}
      <text
        x={W / 2}
        y={H - 2}
        fontSize={9}
        textAnchor="middle"
        fill="rgba(255,255,255,0.5)"
        fontFamily="ui-monospace, monospace"
      >
        {site.buildings.length}{" "}
        {site.buildings.length === 1 ? "edificação" : "edificações"}
      </text>
    </svg>
  );
}

/** Mini-thumbnail top-down em SVG do galpão (footprint + zonas + docas). */
function ShedThumb({ model, selected }: { model: unknown; selected: boolean }) {
  const sum = summarize(model);
  const W = 240;
  const H = 140;
  const pad = 10;
  const innerW = W - pad * 2;
  const innerH = H - pad * 2;

  // SitePlan: desenha lote + footprints reais das construções (top-down).
  if (sum.kind === "site" && sum.site) {
    return <SiteThumb site={sum.site} selected={selected} W={W} H={H} />;
  }

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
        ? Array.from({ length: sum.shed.structure.bayCount + 1 }).map(
            (_, i) => {
              const t = i / sum.shed!.structure.bayCount;
              const x = ox + t * drawW;
              return (
                <line
                  key={i}
                  x1={x}
                  y1={oy}
                  x2={x}
                  y2={oy + drawH}
                  stroke={
                    selected ? "rgba(215,32,66,0.4)" : "rgba(255,255,255,0.15)"
                  }
                  strokeWidth={0.6}
                />
              );
            },
          )
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
              {selectedSum.use} · {selectedSum.standard}
              {selectedSum.kind === "site" && selectedSum.buildingCount > 0 && (
                <>
                  {" · "}
                  <strong>{selectedSum.buildingCount}</strong>{" "}
                  {selectedSum.buildingCount === 1
                    ? "edificação"
                    : "edificações"}
                </>
              )}
              {selectedSum.width > 0 && selectedSum.depth > 0 && (
                <>
                  {" · "}
                  {selectedSum.width.toFixed(1)} ×{" "}
                  {selectedSum.depth.toFixed(1)} m
                </>
              )}
              {selectedSum.areaM2 > 0 && (
                <>
                  {" · "}
                  {Math.round(selectedSum.areaM2).toLocaleString("pt-BR")} m²
                  cobertos
                </>
              )}
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
            {selectedSum.kind === "site" && selectedSum.site ? (
              <SitePlanViewer3D
                site={selectedSum.site}
                shedsById={Object.fromEntries(
                  selectedSum.site.buildings
                    .filter((b) => b.shed && isIndustrialShed(b.shed))
                    .map((b) => [b.id, b.shed as IndustrialShed]),
                )}
                lod="architectural"
                synthesizeShed
                mapBackground
              />
            ) : selectedSum.kind === "shed" && selectedSum.shed ? (
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
              <div className="dash-kpi-val">{fmtR$(selectedSum.totalCost)}</div>
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
