// Cenários e custos de demolição + remoção de entulho.
// Calcula faixa para o agente Pré-Projeto apresentar Cenário A (sem
// demolição) e Cenário B (com demolição).

import { DEMOLITION_COST_PER_M2 } from "./costs";

export type ExistingType =
  | "casa_terrea"
  | "sobrado"
  | "galpao_metalico"
  | "alvenaria_antiga"
  | "generico";

export interface DemolitionInput {
  /** Tipo da construção existente. */
  existingType: ExistingType;
  /** Área existente em m². */
  areaM2: number;
  /** Densidade urbana/acessibilidade do lote. */
  urbanDensity?: "baixa" | "media" | "alta";
  /** Quantidade estimada de entulho. */
  debrisLevel?: "baixo" | "medio" | "alto";
  /** Acesso ao terreno. */
  access?: "facil" | "medio" | "dificil";
}

/** Fator multiplicador composto baseado em densidade, entulho e acesso. */
function computeComplexityFactor(input: DemolitionInput) {
  let low = 1.0;
  let high = 1.0;
  switch (input.urbanDensity) {
    case "media": low *= 1.05; high *= 1.15; break;
    case "alta":  low *= 1.10; high *= 1.25; break;
  }
  switch (input.debrisLevel) {
    case "medio": low *= 1.03; high *= 1.08; break;
    case "alto":  low *= 1.05; high *= 1.15; break;
  }
  switch (input.access) {
    case "medio":   low *= 1.05; high *= 1.10; break;
    case "dificil": low *= 1.10; high *= 1.20; break;
  }
  return { low, high };
}

export interface DemolitionEstimate {
  areaM2: number;
  existingType: ExistingType;
  costPerM2: { low: number; high: number };
  totalCost: { low: number; high: number };
  complexity: { low: number; high: number };
  notes: string[];
}

export function estimateDemolition(input: DemolitionInput): DemolitionEstimate {
  const base = DEMOLITION_COST_PER_M2[input.existingType] ?? DEMOLITION_COST_PER_M2.generico;
  const cx = computeComplexityFactor(input);
  const lowM2 = base.low * cx.low;
  const highM2 = base.high * cx.high;

  const notes: string[] = [
    `Base SINAPI/composições para demolição de ${input.existingType.replace("_", " ")}.`,
  ];
  if (input.urbanDensity === "alta") notes.push("Acréscimo por região urbana densa (logística, ruído, descarte).");
  if (input.debrisLevel === "alto") notes.push("Volume elevado de entulho — caçambas e transporte adicionais.");
  if (input.access === "dificil") notes.push("Acesso restrito — equipamentos menores e mais ciclos de carga.");

  return {
    areaM2: input.areaM2,
    existingType: input.existingType,
    costPerM2: { low: Math.round(lowM2), high: Math.round(highM2) },
    totalCost: {
      low: Math.round(lowM2 * input.areaM2),
      high: Math.round(highM2 * input.areaM2),
    },
    complexity: cx,
    notes,
  };
}
