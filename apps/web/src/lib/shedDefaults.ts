// Fallback determinístico + heurísticas para o IndustrialShed.
import type { IndustrialShed } from "./shedSchema";
import type { BuildingPlacement } from "./sitePlanSchema";
import { COST_PER_M2_BY_STATE } from "./knowledge";

export interface FallbackContext {
  /** Área disponível no lote (m²) — usada para escalar o galpão. */
  areaM2?: number;
  /** Padrão construtivo desejado. */
  standard?: "economico" | "medio" | "alto";
  /** Uso principal. */
  use?: IndustrialShed["use"];
}

// Custo paramétrico R$/m² por padrão — fonte única em knowledge/costs (UF=BR).
export const COST_PER_M2: Record<"economico" | "medio" | "alto", number> =
  COST_PER_M2_BY_STATE.BR;

// Peso de aço (kg/m² coberto) por sistema estrutural
export const STEEL_KG_PER_M2: Record<string, number> = {
  steel_frame_light: 28,
  porticos_aco: 45,
  trelicado: 38,
};

export function generateFallbackShed(
  ctx: FallbackContext = {},
): IndustrialShed {
  const standard = ctx.standard ?? "medio";
  const use = ctx.use ?? "logistics";
  const lotArea = Math.max(2000, ctx.areaM2 ?? 6000);

  // Galpão ocupa ~65% da área disponível, com proporção 1:2.
  const occ = 0.65;
  const ratio = 2;
  const depthGuess = Math.sqrt((lotArea * occ) / ratio) * ratio;
  const widthGuess = depthGuess / ratio;
  const width = Math.min(60, Math.round(widthGuess));
  const depth = Math.min(150, Math.round(depthGuess));
  const baySpacing = use === "industrial" ? 7 : 8;
  const bayCount = Math.max(3, Math.round(depth / baySpacing));
  const clearHeight =
    use === "logistics" ? 10 : use === "cold_storage" ? 12 : 8;

  const coveredArea = width * depth;
  const costPerM2 = COST_PER_M2[standard];
  const steelKg = Math.round(coveredArea * STEEL_KG_PER_M2.porticos_aco);

  const shed: IndustrialShed = {
    schemaVersion: "shed-1",
    use,
    standard,
    lot: {
      width: Math.round(Math.sqrt(lotArea)),
      depth: Math.round(Math.sqrt(lotArea)),
      slopePct: 0,
    },
    setbacks: { front: 8, sides: 3, back: 3 },
    footprint: { width, depth },
    structure: {
      system: "porticos_aco",
      bayCount,
      baySpacing: Number((depth / bayCount).toFixed(2)),
      freeSpan: width,
      clearHeight,
      columnProfile: "W310x52",
      roofStructure: "trelica",
    },
    roof: {
      type: "gable",
      slopePct: 10,
      overhang: 0.6,
      cover: standard === "alto" ? "sandwich_PIR" : "telha_termoacustica",
      skylightPct: 5,
      gutters: true,
    },
    envelope: {
      walls: "alvenaria_baixa_telha",
      insulation:
        standard === "alto"
          ? "alto_desempenho"
          : standard === "medio"
            ? "intermediario"
            : "basico",
      wallBaseHeight: 2.5,
    },
    zones: [
      {
        name: "Armazenagem principal",
        type: "armazenagem",
        x: 0,
        z: 0,
        width,
        depth: depth - 12,
        height: clearHeight,
        floorLoad_kN_m2: 50,
      },
      {
        name: "Expedição / Recebimento",
        type: "expedicao",
        x: 0,
        z: depth - 12,
        width,
        depth: 12,
        height: clearHeight,
        floorLoad_kN_m2: 50,
      },
      {
        name: "Escritório administrativo",
        type: "escritorio",
        x: width - 10,
        z: 0,
        width: 10,
        depth: 8,
        height: 3,
        floorLoad_kN_m2: 5,
      },
    ],
    docks: Array.from({ length: Math.min(6, Math.round(width / 8)) }).map(
      (_, i) => ({
        x: 4 + i * 8,
        z: depth,
        wall: "north" as const,
        type: "nivelada" as const,
        levelers: true,
        seal: true,
      }),
    ),
    craneRails: [],
    openings: [
      {
        type: "portao_seccional",
        wall: "south",
        xAlongWall: width / 2 - 3,
        width: 6,
        height: 5,
        elevation: 0,
      },
      {
        type: "porta_pessoal",
        wall: "south",
        xAlongWall: width - 2,
        width: 1,
        height: 2.2,
        elevation: 0,
      },
      {
        type: "porta_corta_fogo",
        wall: "east",
        xAlongWall: depth / 2,
        width: 1.2,
        height: 2.2,
        elevation: 0,
      },
    ],
    floor: {
      type: "industrial_polido",
      load_kN_m2: 50,
      thickness_cm: 18,
    },
    utilities: {
      power_kVA: 225,
      water: true,
      sewage: true,
      compressedAir: use === "industrial" || use === "manufacturing",
      firePump: coveredArea > 1500,
      sprinklers: coveredArea > 5000,
      hydrants: Math.max(2, Math.round(coveredArea / 750)),
    },
    safety: {
      occupancyClass: use === "logistics" ? "J-3" : "I-1",
      fireLoad_MJ_m2: use === "logistics" ? 1200 : 800,
      exitsCount: Math.max(2, Math.round(coveredArea / 1500)),
      exitsWidthTotal: Math.max(2.2, coveredArea / 1500),
      maxTravelDistance_m: 30,
      avcbRequired: coveredArea > 750,
    },
    yard: {
      truckCircle_m: use === "logistics" ? 28 : 18,
      parkingCars: Math.max(5, Math.round(coveredArea / 200)),
      parkingTrucks: Math.max(2, Math.round(coveredArea / 1500)),
      retentionPond: lotArea > 5000,
    },
    perimeter: {
      fenceHeight: 2.5,
      fenceType: "muro",
      gate: true,
      guardhouse: lotArea > 4000,
    },
    compliance: {
      norms: [
        "NBR 16970",
        "NBR 15575",
        "NBR 6120",
        "NBR 6123",
        "NBR 8800",
        "NBR 14762",
        "NBR 5410",
        "NBR 5626",
        "NBR 9077",
      ],
      costSources: ["SINAPI", "CUB Sinduscon-SP", "GeoSampa"],
    },
    estimate: {
      costPerM2,
      totalCost: Math.round(coveredArea * costPerM2),
      steelKg,
      coveredAreaM2: Math.round(coveredArea),
    },
    assumptions: [
      "Estimativa preliminar baseada em SINAPI/CUB e tipologia padrão.",
      "Vento conforme NBR 6123 (não tabulado por região nesta versão).",
      "Sondagem e topografia não consideradas — aplicada contingência mínima.",
    ],
    confidence: 0.5,
  };

  return shed;
}

/** Largura/profundidade reais (frame local) do footprint de um placement. */
function footprintLocalSize(
  poly: { x: number; z: number }[],
  rotationRad = 0,
): { w: number; d: number } {
  const pts =
    rotationRad && poly.length
      ? (() => {
          const c = poly.reduce((a, p) => ({ x: a.x + p.x, z: a.z + p.z }), {
            x: 0,
            z: 0,
          });
          const cx = c.x / poly.length;
          const cz = c.z / poly.length;
          const cos = Math.cos(-rotationRad);
          const sin = Math.sin(-rotationRad);
          return poly.map((p) => {
            const dx = p.x - cx;
            const dz = p.z - cz;
            return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
          });
        })()
      : poly;
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const v of pts) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.z < minZ) minZ = v.z;
    if (v.z > maxZ) maxZ = v.z;
  }
  return { w: maxX - minX, d: maxZ - minZ };
}

/**
 * Galpão sintetizado (em memória, nunca persistido) a partir do placement —
 * mesma lógica do viewer 3D (`deriveShedForPlacement`), porém sem dependência
 * do Three.js para poder rodar em Server Components. Útil para somar custos /
 * área coberta quando o placement guarda apenas o footprint.
 */
export function synthesizeShedFromPlacement(
  placement: BuildingPlacement,
): IndustrialShed {
  const { w, d } = footprintLocalSize(
    placement.footprintPolygon,
    placement.rotationRad ?? 0,
  );
  const areaM2 = Math.max(placement.targetAreaM2 ?? 0, Math.round(w * d));
  const shed = generateFallbackShed({
    areaM2,
    use: placement.use,
    standard: "medio",
  });
  shed.footprint = {
    width: Math.max(6, Math.round(w)),
    depth: Math.max(6, Math.round(d)),
  };
  shed.structure.freeSpan = Math.min(
    shed.structure.freeSpan,
    shed.footprint.width,
  );
  const bayCount = Math.max(
    2,
    Math.round(shed.footprint.depth / shed.structure.baySpacing),
  );
  shed.structure.bayCount = bayCount;
  shed.structure.baySpacing = Number(
    (shed.footprint.depth / bayCount).toFixed(2),
  );
  return shed;
}

export function recomputeEstimate(shed: IndustrialShed): IndustrialShed {
  const covered = shed.footprint.width * shed.footprint.depth;
  const factorStandard =
    shed.standard === "alto" ? 1.15 : shed.standard === "economico" ? 0.9 : 1;
  const factorSlope = 1 + Math.min(0.25, shed.lot.slopePct / 100);
  const factorInsulation =
    shed.envelope.insulation === "alto_desempenho"
      ? 1.12
      : shed.envelope.insulation === "intermediario"
        ? 1.05
        : 1;
  const costPerM2 = Math.round(
    COST_PER_M2[shed.standard] *
      factorStandard *
      factorSlope *
      factorInsulation,
  );
  const steelKg = Math.round(
    covered * (STEEL_KG_PER_M2[shed.structure.system] ?? 45),
  );
  return {
    ...shed,
    estimate: {
      costPerM2,
      totalCost: Math.round(covered * costPerM2),
      steelKg,
      coveredAreaM2: Math.round(covered),
    },
  };
}
