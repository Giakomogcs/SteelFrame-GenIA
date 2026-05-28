// Constrói o bloco de conhecimento injetado no system prompt da IA.
// O objetivo é tornar o agente mais independente: ele passa a citar
// normas, fontes e faixas paramétricas mesmo sem rede.

import { NORMS, type NormRef } from "./norms";
import {
  COST_PER_M2_BY_STATE,
  COST_STAGES,
  STANDARD_FACTORS,
  type CostState,
} from "./costs";
import { SOURCES } from "./sources";

interface PromptKBOptions {
  uf?: string;
}

function fmtPct(v: number) {
  return `${Math.round(v * 100)}%`;
}

export function buildKnowledgeBlock(opts: PromptKBOptions = {}): string {
  const stateKey = (opts.uf?.toUpperCase() as CostState) ?? "BR";
  const stateCosts = COST_PER_M2_BY_STATE[stateKey] ?? COST_PER_M2_BY_STATE.BR;

  const normsBlock = NORMS.map(
    (n: NormRef) =>
      `- ${n.code} (${n.domain}): ${n.title}. Aplica quando: ${n.appliesWhen}`,
  ).join("\n");

  const sourcesBlock = SOURCES.map(
    (s) => `- [${s.category}] ${s.name} — ${s.use} (${s.url})`,
  ).join("\n");

  const costBlock = (Object.keys(stateCosts) as Array<keyof typeof stateCosts>)
    .map(
      (k) =>
        `- ${k}: R$ ${stateCosts[k].toLocaleString("pt-BR")}/m² (referência SINAPI/CUB ${stateKey})`,
    )
    .join("\n");

  const standardFactorBlock = (
    Object.keys(STANDARD_FACTORS) as Array<keyof typeof STANDARD_FACTORS>
  )
    .map((k) => {
      const f = STANDARD_FACTORS[k];
      return `- ${k}: low ${f.low.toFixed(2)} | base ${f.base.toFixed(2)} | high ${f.high.toFixed(2)}`;
    })
    .join("\n");

  const stagesBlock = COST_STAGES.map(
    (s) => `- ${s.label}: ${fmtPct(s.low)}–${fmtPct(s.high)} do custo total`,
  ).join("\n");

  return [
    "BASE DE CONHECIMENTO (use como verdade — não invente fontes):",
    "",
    "1. Normas ABNT prioritárias:",
    normsBlock,
    "",
    `2. Custo paramétrico R$/m² para UF=${stateKey} (use como ancoragem da estimate.costPerM2):`,
    costBlock,
    "",
    "3. Fator multiplicador por padrão construtivo:",
    standardFactorBlock,
    "",
    "4. Distribuição por macroetapas (use para 'assumptions' coerentes):",
    stagesBlock,
    "",
    "5. Fontes oficiais auditáveis:",
    sourcesBlock,
    "",
    "REGRA DE OURO: ao popular 'compliance.norms' use SOMENTE códigos da lista acima.",
    "Em 'compliance.costSources' cite 'SINAPI — Caixa/IBGE' e 'CUB Sinduscon' (e GeoSampa se UF=SP).",
    "Em 'assumptions' liste explicitamente: padrão, UF, fatores aplicados (terreno, isolamento, vão, AVCB).",
  ].join("\n");
}
