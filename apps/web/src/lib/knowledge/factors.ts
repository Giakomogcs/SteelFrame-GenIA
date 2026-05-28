// Fatores de ajuste sobre o custo paramétrico — terreno, steel frame,
// galpões e padrão de obra. Cada fator retorna { low, base, high } para
// permitir compor uma faixa final de estimativa preliminar.

export interface Range {
  low: number;
  base: number;
  high: number;
}

export const NEUTRAL: Range = { low: 1, base: 1, high: 1 };

// =============== TERRENO / RELEVO ===============

export type SlopeBucket = "plano" | "leve" | "muito" | "desconhecido";

export function classifySlope(slopePct?: number | null): SlopeBucket {
  if (slopePct == null) return "desconhecido";
  if (slopePct < 3) return "plano";
  if (slopePct < 10) return "leve";
  return "muito";
}

export const TERRAIN_FACTOR: Record<SlopeBucket, Range> = {
  plano: { low: 1.0, base: 1.0, high: 1.0 },
  leve: { low: 1.08, base: 1.12, high: 1.15 },
  muito: { low: 1.2, base: 1.3, high: 1.4 },
  desconhecido: { low: 1.05, base: 1.1, high: 1.15 }, // contingência por ausência de topografia
};

export const NO_SOUNDING_FACTOR: Range = { low: 1.08, base: 1.12, high: 1.15 };
export const NO_TOPO_FACTOR: Range = { low: 1.05, base: 1.07, high: 1.1 };

// =============== STEEL FRAME ===============

export type Insulation = "basico" | "intermediario" | "alto_desempenho";
export const INSULATION_FACTOR: Record<Insulation, Range> = {
  basico: { low: 1.0, base: 1.0, high: 1.0 },
  intermediario: { low: 1.05, base: 1.06, high: 1.08 },
  alto_desempenho: { low: 1.08, base: 1.12, high: 1.15 },
};

/** Cobertura: telha termoacústica ou sandwich PIR encarece. */
export const ROOF_COVER_FACTOR: Record<string, Range> = {
  telha_metalica: NEUTRAL,
  telha_termoacustica: { low: 1.04, base: 1.06, high: 1.08 },
  sandwich_PIR: { low: 1.08, base: 1.12, high: 1.18 },
  fibrocimento: { low: 0.96, base: 0.98, high: 1.0 },
};

/** Muitos recortes e esquadrias geram retrabalho de fechamento/instalação. */
export const FACADE_COMPLEXITY_FACTOR: Record<
  "pouco" | "medio" | "muito",
  Range
> = {
  pouco: NEUTRAL,
  medio: { low: 1.03, base: 1.05, high: 1.07 },
  muito: { low: 1.05, base: 1.08, high: 1.12 },
};

/** Grandes vãos livres exigem perfis mais robustos. */
export function largeSpanFactor(freeSpanM?: number): Range {
  if (!freeSpanM) return NEUTRAL;
  if (freeSpanM < 15) return NEUTRAL;
  if (freeSpanM < 25) return { low: 1.05, base: 1.08, high: 1.12 };
  return { low: 1.1, base: 1.15, high: 1.2 };
}

/** Mais de um pavimento — entrepiso steel deck + transmissão de cargas. */
export function multiStoreyFactor(pavs?: number): Range {
  if (!pavs || pavs <= 1) return NEUTRAL;
  if (pavs === 2) return { low: 1.1, base: 1.15, high: 1.18 };
  return { low: 1.18, base: 1.22, high: 1.25 };
}

// =============== GALPÃO ===============

/** Pé-direito acima de 6 m encarece estrutura e fechamentos. */
export function tallClearHeightFactor(clearHeightM?: number): Range {
  if (!clearHeightM) return NEUTRAL;
  if (clearHeightM <= 6) return NEUTRAL;
  if (clearHeightM <= 10) return { low: 1.08, base: 1.12, high: 1.15 };
  return { low: 1.12, base: 1.16, high: 1.18 };
}

/** Piso industrial pesado (porta-paletes, manufatura). */
export function industrialFloorFactor(loadKnM2?: number): Range {
  if (!loadKnM2 || loadKnM2 <= 30) return NEUTRAL;
  if (loadKnM2 <= 60) return { low: 1.05, base: 1.1, high: 1.15 };
  return { low: 1.15, base: 1.2, high: 1.25 };
}

/** Docas instaladas (cada doca + nivelador + selo). */
export function docksFactor(docksCount?: number): Range {
  if (!docksCount) return NEUTRAL;
  if (docksCount <= 2) return { low: 1.03, base: 1.05, high: 1.08 };
  return { low: 1.08, base: 1.12, high: 1.15 };
}

/** AVCB obrigatório (NBR 9077) — hidrantes, sprinklers, rotas. */
export function avcbFactor(required?: boolean, area?: number): Range {
  if (!required) return NEUTRAL;
  if (!area || area < 1500) return { low: 1.03, base: 1.05, high: 1.08 };
  if (area < 5000) return { low: 1.05, base: 1.08, high: 1.1 };
  return { low: 1.08, base: 1.1, high: 1.12 };
}

// =============== COMPOSIÇÃO ===============

/** Multiplica várias faixas (low por low, base por base, high por high). */
export function composeFactors(...ranges: Range[]): Range {
  return ranges.reduce<Range>(
    (acc, r) => ({
      low: acc.low * r.low,
      base: acc.base * r.base,
      high: acc.high * r.high,
    }),
    { low: 1, base: 1, high: 1 },
  );
}
