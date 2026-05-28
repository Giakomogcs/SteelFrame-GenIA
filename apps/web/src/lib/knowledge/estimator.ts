// Estimador de viabilidade preliminar — combina custo base SINAPI/CUB com
// fatores de padrão, terreno, steel frame, galpão e demolição.
// Saída tipada para alimentar relatório e/ou ser citada pela IA.

import {
  baseCostPerM2,
  COST_STAGES,
  STANDARD_FACTORS,
  COST_SOURCES,
  type Standard,
  type StageRange,
} from "./costs";
import {
  classifySlope,
  TERRAIN_FACTOR,
  NO_SOUNDING_FACTOR,
  NO_TOPO_FACTOR,
  INSULATION_FACTOR,
  ROOF_COVER_FACTOR,
  FACADE_COMPLEXITY_FACTOR,
  largeSpanFactor,
  multiStoreyFactor,
  tallClearHeightFactor,
  industrialFloorFactor,
  docksFactor,
  avcbFactor,
  composeFactors,
  NEUTRAL,
  type Range,
  type Insulation,
} from "./factors";
import {
  estimateDemolition,
  type DemolitionEstimate,
  type ExistingType,
} from "./demolition";

export interface ViabilityInput {
  // Localização
  uf?: string;
  // Programa
  standard: Standard;
  areaM2: number;
  /** Pavimentos (1 = térrea). */
  storeys?: number;
  // Steel frame / fechamento
  insulation?: Insulation;
  roofCover?: keyof typeof ROOF_COVER_FACTOR;
  facadeComplexity?: "pouco" | "medio" | "muito";
  freeSpanM?: number;
  // Galpão
  clearHeightM?: number;
  floorLoadKnM2?: number;
  docksCount?: number;
  avcbRequired?: boolean;
  // Terreno
  slopePct?: number | null;
  hasSounding?: boolean;
  hasTopo?: boolean;
  // Demolição (opcional)
  existing?: {
    type: ExistingType;
    areaM2: number;
    urbanDensity?: "baixa" | "media" | "alta";
    debrisLevel?: "baixo" | "medio" | "alto";
    access?: "facil" | "medio" | "dificil";
  };
}

export interface MacroStageCost {
  stage: StageRange["stage"];
  label: string;
  low: number;
  base: number;
  high: number;
}

export interface ViabilityEstimate {
  uf: string;
  areaM2: number;
  standard: Standard;
  costPerM2: { low: number; base: number; high: number };
  totalCost: { low: number; base: number; high: number };
  macroStages: MacroStageCost[];
  /** Cenário com demolição se aplicável. */
  demolition?: DemolitionEstimate;
  totalWithDemolition?: { low: number; base: number; high: number };
  factors: { name: string; range: Range }[];
  sources: string[];
  notes: string[];
}

export function computeViability(input: ViabilityInput): ViabilityEstimate {
  const base = baseCostPerM2(input.uf, input.standard);
  const std = STANDARD_FACTORS[input.standard];

  // Fatores nomeados — preservados para auditoria/explicação.
  const slopeBucket = classifySlope(input.slopePct);
  const factors: { name: string; range: Range }[] = [
    { name: `terreno_${slopeBucket}`, range: TERRAIN_FACTOR[slopeBucket] },
    { name: "padrao_" + input.standard, range: std },
    { name: "isolamento_" + (input.insulation ?? "basico"), range: INSULATION_FACTOR[input.insulation ?? "basico"] },
    { name: "cobertura_" + (input.roofCover ?? "telha_metalica"), range: ROOF_COVER_FACTOR[input.roofCover ?? "telha_metalica"] ?? NEUTRAL },
    { name: "fachada_" + (input.facadeComplexity ?? "pouco"), range: FACADE_COMPLEXITY_FACTOR[input.facadeComplexity ?? "pouco"] },
    { name: "vao_livre", range: largeSpanFactor(input.freeSpanM) },
    { name: "pavimentos", range: multiStoreyFactor(input.storeys) },
    { name: "pe_direito", range: tallClearHeightFactor(input.clearHeightM) },
    { name: "piso_industrial", range: industrialFloorFactor(input.floorLoadKnM2) },
    { name: "docas", range: docksFactor(input.docksCount) },
    { name: "avcb", range: avcbFactor(input.avcbRequired, input.areaM2) },
  ];
  if (input.hasSounding === false) factors.push({ name: "sem_sondagem", range: NO_SOUNDING_FACTOR });
  if (input.hasTopo === false) factors.push({ name: "sem_topografia", range: NO_TOPO_FACTOR });

  const composed = composeFactors(...factors.map((f) => f.range));

  const costPerM2 = {
    low: Math.round(base.low * composed.low),
    base: Math.round(base.base * composed.base),
    high: Math.round(base.high * composed.high),
  };
  const totalCost = {
    low: Math.round(costPerM2.low * input.areaM2),
    base: Math.round(costPerM2.base * input.areaM2),
    high: Math.round(costPerM2.high * input.areaM2),
  };

  const macroStages: MacroStageCost[] = COST_STAGES.map((s) => ({
    stage: s.stage,
    label: s.label,
    low: Math.round(totalCost.low * s.low),
    base: Math.round(totalCost.base * ((s.low + s.high) / 2)),
    high: Math.round(totalCost.high * s.high),
  }));

  const notes: string[] = [
    "Estimativa preliminar para estudo de viabilidade — não substitui orçamento executivo.",
  ];
  if (slopeBucket === "desconhecido") notes.push("Topografia desconhecida — aplicada contingência conservadora.");
  if (input.hasSounding === false) notes.push("Sem sondagem — fundação estimada com contingência adicional.");

  let demolition: DemolitionEstimate | undefined;
  let totalWithDemolition: ViabilityEstimate["totalWithDemolition"];
  if (input.existing && input.existing.areaM2 > 0) {
    demolition = estimateDemolition({
      existingType: input.existing.type,
      areaM2: input.existing.areaM2,
      urbanDensity: input.existing.urbanDensity,
      debrisLevel: input.existing.debrisLevel,
      access: input.existing.access,
    });
    totalWithDemolition = {
      low: totalCost.low + demolition.totalCost.low,
      base: totalCost.base + Math.round((demolition.totalCost.low + demolition.totalCost.high) / 2),
      high: totalCost.high + demolition.totalCost.high,
    };
  }

  return {
    uf: input.uf?.toUpperCase() ?? "BR",
    areaM2: input.areaM2,
    standard: input.standard,
    costPerM2,
    totalCost,
    macroStages,
    demolition,
    totalWithDemolition,
    factors,
    sources: COST_SOURCES,
    notes,
  };
}
