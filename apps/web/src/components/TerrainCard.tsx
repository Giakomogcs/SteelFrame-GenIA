import Link from "next/link";
import type { Terrain, Building, Briefing } from "@sfg/db";
import type { LngLat } from "@/lib/geo";
import { DeleteTerrainButton } from "./DeleteTerrainButton";
import TerrainThumb from "./TerrainThumb";

interface Props {
  terrain: Terrain & { buildings: Building[]; briefings?: Briefing[] };
}

/** Extrai a maior pegada (footprint) dentre os galpões salvos no terreno. */
function pickFootprint(buildings: Building[]) {
  for (const b of buildings) {
    const m = b.model as {
      footprint?: { width?: number; depth?: number };
    } | null;
    if (m?.footprint?.width && m?.footprint?.depth) {
      return { width: m.footprint.width, depth: m.footprint.depth };
    }
  }
  return null;
}

function hasActiveBriefing(briefings?: Briefing[]) {
  if (!briefings || briefings.length === 0) return false;
  return briefings.some(
    (b) =>
      b.status === "active" || b.status === "draft" || b.status === "paused",
  );
}

function statusPill(
  t: Terrain & { buildings: Building[]; briefings?: Briefing[] },
) {
  if (t.buildings.length > 0) return { cls: "pill-success", label: "Viável" };
  if (hasActiveBriefing(t.briefings))
    return { cls: "pill-warning", label: "Em briefing" };
  return { cls: "pill-neutral", label: "Sem briefing" };
}

/** Data do último briefing concluído (= último galpão gerado) ou do último briefing salvo. */
function lastBriefingDate(
  t: Terrain & { buildings: Building[]; briefings?: Briefing[] },
): Date | null {
  const fromBuildings = t.buildings.reduce<Date | null>((acc, b) => {
    const d = new Date(b.createdAt);
    return !acc || d > acc ? d : acc;
  }, null);
  const fromBriefings = (t.briefings ?? []).reduce<Date | null>((acc, b) => {
    const d = new Date(b.updatedAt);
    return !acc || d > acc ? d : acc;
  }, null);
  if (fromBuildings && fromBriefings)
    return fromBuildings > fromBriefings ? fromBuildings : fromBriefings;
  return fromBuildings ?? fromBriefings;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

export function TerrainCard({ terrain }: Props) {
  const polygon = (terrain.polygon ?? []) as unknown as LngLat[];
  const building = pickFootprint(terrain.buildings);
  const { cls, label } = statusPill(terrain);
  const shortId = terrain.id.slice(-6).toUpperCase();
  const created = fmtDate(new Date(terrain.createdAt));
  const lastBrief = lastBriefingDate(terrain);
  const lastBriefLabel = lastBrief ? fmtDate(lastBrief) : null;
  const costEst = terrain.buildings.reduce((acc, b) => {
    const m = b.model as { estimate?: { totalCost?: number } } | null;
    return acc + (m?.estimate?.totalCost ?? 0);
  }, 0);
  const costLabel =
    costEst > 0
      ? `R$ ${(costEst / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} M`
      : "— prévia";

  return (
    <Link href={`/terrenos/${terrain.id}`} className="terrain-card">
      <div className="terrain-thumb">
        <TerrainThumb polygon={polygon} building={building} />
        <div className="terrain-thumb-overlay">
          <span className={`pill ${cls}`}>
            <span className="dot" />
            {label}
          </span>
          <span className="pill pill-neutral mono">#SF-{shortId}</span>
        </div>
        <div className="terrain-thumb-meta">
          Sat ·{" "}
          {lastBriefLabel
            ? `briefing ${lastBriefLabel}`
            : `cadastro ${created}`}
        </div>
        <DeleteTerrainButton
          terrainId={terrain.id}
          terrainName={terrain.name}
        />
      </div>
      <div className="terrain-body">
        <div>
          <div className="addr">{terrain.name}</div>
          {terrain.address && (
            <div className="addr-sub">{terrain.address.toUpperCase()}</div>
          )}
        </div>
        <div className="terrain-stats">
          <div className="stat">
            <span className="lbl">Área</span>
            <span className="val">
              {terrain.areaM2.toLocaleString("pt-BR", {
                maximumFractionDigits: 0,
              })}{" "}
              m²
            </span>
          </div>
          <div className="stat">
            <span className="lbl">Galpões</span>
            <span className="val">{terrain.buildings.length}</span>
          </div>
          <div className="stat">
            <span className="lbl">Custo est.</span>
            <span className="val">{costLabel}</span>
          </div>
        </div>
        <div className="terrain-footer">
          <span className="obras">
            {terrain.buildings.length === 0
              ? hasActiveBriefing(terrain.briefings)
                ? "Briefing em andamento"
                : "Nenhum briefing iniciado"
              : `${terrain.buildings.length} construção(ões) estudada(s)`}
          </span>
          <span className="text-xs muted mono">
            {lastBriefLabel ? `últ. briefing ${lastBriefLabel}` : created}
          </span>
        </div>
      </div>
    </Link>
  );
}
