// Resumo de custo e área coberta de um Building, robusto aos vários formatos
// de `model` persistidos no banco:
//  - IndustrialShed  → model.estimate.{totalCost,coveredAreaM2} (+ footprint)
//  - SteelFrameModel → model.estimatedCost + model.footprint.areaM2
//  - SitePlan        → model.buildings[] (cada placement com shed/footprint)
import { COST_PER_M2_BY_STATE } from "./knowledge";

/** Custo paramétrico de fallback (R$/m² coberto) quando o modelo não traz
 *  estimativa própria — média nacional padrão "médio". */
const FALLBACK_COST_PER_M2 = COST_PER_M2_BY_STATE.BR.medio;

export interface BuildingCostSummary {
  /** Custo total estimado (R$). */
  cost: number;
  /** Área coberta total (m²). */
  covered: number;
}

type AnyRecord = Record<string, unknown>;

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Área de um polígono local (ENU, metros) pela fórmula do shoelace. */
function polygonArea(poly: unknown): number {
  if (!Array.isArray(poly) || poly.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as AnyRecord;
    const q = poly[(i + 1) % poly.length] as AnyRecord;
    area += num(p?.x) * num(q?.z) - num(q?.x) * num(p?.z);
  }
  return Math.abs(area) / 2;
}

/** Custo + área de um único IndustrialShed (com ou sem estimate gravada). */
function shedSummary(shed: AnyRecord, fallbackArea = 0): BuildingCostSummary {
  const footprint = shed.footprint as AnyRecord | undefined;
  const estimate = shed.estimate as AnyRecord | undefined;

  let covered = num(estimate?.coveredAreaM2);
  if (!covered && footprint)
    covered = num(footprint.width) * num(footprint.depth);
  if (!covered) covered = fallbackArea;

  const costPerM2 = num(estimate?.costPerM2) || FALLBACK_COST_PER_M2;
  const cost = num(estimate?.totalCost) || Math.round(covered * costPerM2);

  return { cost: Math.round(cost), covered: Math.round(covered) };
}

/** Calcula custo total e área coberta de um Building.model em qualquer formato. */
export function summarizeBuildingCost(model: unknown): BuildingCostSummary {
  if (!model || typeof model !== "object") return { cost: 0, covered: 0 };
  const m = model as AnyRecord;

  // SitePlan — soma de todas as edificações do lote.
  if (Array.isArray(m.buildings)) {
    return (m.buildings as AnyRecord[]).reduce<BuildingCostSummary>(
      (acc, placement) => {
        const shed = placement?.shed as AnyRecord | undefined;
        const fallbackArea = polygonArea(placement?.footprintPolygon);
        const part = shed
          ? shedSummary(shed, fallbackArea)
          : {
              covered: Math.round(fallbackArea),
              cost: Math.round(fallbackArea * FALLBACK_COST_PER_M2),
            };
        return {
          cost: acc.cost + part.cost,
          covered: acc.covered + part.covered,
        };
      },
      { cost: 0, covered: 0 },
    );
  }

  // IndustrialShed.
  if (m.estimate && typeof m.estimate === "object") {
    return shedSummary(m);
  }

  // SteelFrameModel.
  const footprint = m.footprint as AnyRecord | undefined;
  if (typeof m.estimatedCost === "number" || footprint?.areaM2) {
    const covered = num(footprint?.areaM2);
    const cost =
      num(m.estimatedCost) || Math.round(covered * FALLBACK_COST_PER_M2);
    return { cost: Math.round(cost), covered: Math.round(covered) };
  }

  return { cost: 0, covered: 0 };
}
