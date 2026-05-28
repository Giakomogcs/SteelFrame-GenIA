// Tabelas paramétricas de custo derivadas de SINAPI (Caixa/IBGE) e
// CUB Sinduscon estadual. Os valores aqui são SEED de referência preliminar
// — devem ser atualizados periodicamente (publicação SINAPI mensal).
// Última calibração indicativa: maio/2026. Faixas conservadoras para
// galpões em pórticos de aço / steel frame leve.

export type Standard = "economico" | "medio" | "alto";

/** UFs com referência calibrada. Outras UFs caem em "BR". */
export type CostState =
  | "SP"
  | "RJ"
  | "MG"
  | "RS"
  | "PR"
  | "SC"
  | "BA"
  | "PE"
  | "CE"
  | "GO"
  | "DF"
  | "ES"
  | "MT"
  | "MS"
  | "PA"
  | "AM"
  | "BR";

/** Custo paramétrico em R$/m² coberto, por UF e padrão. */
export const COST_PER_M2_BY_STATE: Record<CostState, Record<Standard, number>> = {
  SP: { economico: 1900, medio: 2500, alto: 3500 },
  RJ: { economico: 1950, medio: 2550, alto: 3550 },
  MG: { economico: 1780, medio: 2380, alto: 3350 },
  RS: { economico: 1850, medio: 2450, alto: 3450 },
  PR: { economico: 1820, medio: 2420, alto: 3400 },
  SC: { economico: 1880, medio: 2480, alto: 3480 },
  BA: { economico: 1700, medio: 2300, alto: 3250 },
  PE: { economico: 1720, medio: 2320, alto: 3270 },
  CE: { economico: 1700, medio: 2300, alto: 3250 },
  GO: { economico: 1780, medio: 2380, alto: 3350 },
  DF: { economico: 1900, medio: 2500, alto: 3500 },
  ES: { economico: 1820, medio: 2420, alto: 3400 },
  MT: { economico: 1850, medio: 2450, alto: 3450 },
  MS: { economico: 1820, medio: 2420, alto: 3400 },
  PA: { economico: 1800, medio: 2400, alto: 3380 },
  AM: { economico: 1900, medio: 2500, alto: 3500 },
  BR: { economico: 1800, medio: 2400, alto: 3400 },
};

/** Faixa de referência CUB estadual (R$/m²) — ajusta a banda do estimador. */
export const CUB_BAND_BY_STATE: Partial<Record<CostState, { low: number; high: number }>> = {
  SP: { low: 2300, high: 2900 },
  RJ: { low: 2350, high: 2950 },
  MG: { low: 2200, high: 2800 },
  RS: { low: 2250, high: 2850 },
  PR: { low: 2230, high: 2830 },
  SC: { low: 2280, high: 2880 },
};

/** Distribuição percentual por macroetapa (faixa low–high). */
export interface StageRange {
  /** Etapa construtiva. */
  stage:
    | "projetos_aprovacoes"
    | "fundacao"
    | "estrutura_steel"
    | "fechamentos_placas"
    | "cobertura"
    | "instalacoes"
    | "acabamentos"
    | "contingencia_logistica";
  /** Rótulo PT-BR. */
  label: string;
  /** Faixa mínima e máxima do custo total (0..1). */
  low: number;
  high: number;
}

export const COST_STAGES: StageRange[] = [
  { stage: "projetos_aprovacoes",     label: "Projetos e aprovações",     low: 0.03, high: 0.08 },
  { stage: "fundacao",                label: "Fundação",                   low: 0.08, high: 0.15 },
  { stage: "estrutura_steel",         label: "Estrutura Steel Frame",      low: 0.18, high: 0.28 },
  { stage: "fechamentos_placas",      label: "Fechamentos e placas",       low: 0.15, high: 0.25 },
  { stage: "cobertura",               label: "Cobertura",                  low: 0.08, high: 0.15 },
  { stage: "instalacoes",             label: "Instalações",                low: 0.10, high: 0.18 },
  { stage: "acabamentos",             label: "Acabamentos",                low: 0.15, high: 0.30 },
  { stage: "contingencia_logistica",  label: "Frete, perdas e contingência", low: 0.08, high: 0.15 },
];

/** Fator multiplicador por padrão construtivo. */
export const STANDARD_FACTORS: Record<Standard, { low: number; base: number; high: number }> = {
  economico: { low: 0.85, base: 0.90, high: 0.95 },
  medio:     { low: 1.00, base: 1.00, high: 1.00 },
  alto:      { low: 1.25, base: 1.40, high: 1.60 },
};

/** Custo paramétrico de demolição por m², por tipologia existente. */
export const DEMOLITION_COST_PER_M2: Record<string, { low: number; high: number }> = {
  casa_terrea:       { low: 110, high: 180 },
  sobrado:           { low: 150, high: 240 },
  galpao_metalico:   { low: 80,  high: 160 },
  alvenaria_antiga:  { low: 130, high: 220 },
  generico:          { low: 120, high: 200 },
};

/** Fonte: usado para evidenciar a origem da tabela no relatório. */
export const COST_SOURCES: string[] = [
  "SINAPI — Caixa/IBGE",
  "CUB — Sinduscon estadual",
  "Composições internas (steel frame)",
];

export function getCostState(uf?: string | null): CostState {
  if (!uf) return "BR";
  const up = uf.toUpperCase() as CostState;
  return (up in COST_PER_M2_BY_STATE ? up : "BR") as CostState;
}

/** Faixa estimada R$/m² para (UF, padrão) considerando CUB e SINAPI seed. */
export function baseCostPerM2(uf: string | undefined, standard: Standard) {
  const state = getCostState(uf);
  const sinapi = COST_PER_M2_BY_STATE[state][standard];
  const cub = CUB_BAND_BY_STATE[state];
  // Banda final = SINAPI seed ± 8%, intersectada com CUB se houver.
  const low = Math.round(sinapi * 0.92);
  const high = Math.round(sinapi * 1.10);
  if (!cub) return { base: sinapi, low, high };
  return {
    base: sinapi,
    low: Math.max(low, Math.round(cub.low * 0.95)),
    high: Math.min(high, Math.round(cub.high * 1.15)),
  };
}
