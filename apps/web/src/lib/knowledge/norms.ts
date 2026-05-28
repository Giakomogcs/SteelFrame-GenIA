// Catálogo estruturado de normas técnicas brasileiras (ABNT) aplicáveis a
// pré-projeto de galpões em Steel Frame / pórticos de aço.
// Cada entrada inclui aplicabilidade legível pela IA e por humanos para que
// possa ser citada no relatório com rastreabilidade (Catálogo ABNT).

export interface NormRef {
  /** Código oficial ABNT (ex.: "NBR 16970"). */
  code: string;
  /** Título curto. */
  title: string;
  /** Domínio de aplicação. */
  domain:
    | "estrutura"
    | "desempenho"
    | "cargas"
    | "vento"
    | "aco"
    | "perfis_frio"
    | "eletrica"
    | "hidraulica"
    | "incendio"
    | "acessibilidade"
    | "acustica"
    | "termica";
  /** Quando o agente DEVE citar / aplicar. */
  appliesWhen: string;
  /** Métrica/critério de checagem rápida (se houver). */
  quickCheck?: string;
  /** URL oficial ou catálogo. */
  url?: string;
}

export const NORMS: NormRef[] = [
  {
    code: "NBR 16970",
    title: "Edificações em Light Steel Framing — Projeto",
    domain: "estrutura",
    appliesWhen: "Sempre que o sistema usar perfis leves galvanizados (LSF) ou paredes/lajes em steel frame.",
    quickCheck: "Diafragmas, ancoragens e contraventamentos definidos por painel.",
    url: "https://www.abntcatalogo.com.br/",
  },
  {
    code: "NBR 15575",
    title: "Edificações habitacionais — Desempenho",
    domain: "desempenho",
    appliesWhen: "Quando há uso habitacional, escritório administrativo permanente ou vestiário/refeitório regulares.",
    quickCheck: "Conforto térmico, acústico, estanqueidade e durabilidade ≥ Nível Mínimo.",
    url: "https://www.abntcatalogo.com.br/",
  },
  {
    code: "NBR 6120",
    title: "Cargas para o cálculo de estruturas de edificações",
    domain: "cargas",
    appliesWhen: "Sempre. Define cargas permanentes, sobrecargas de piso e cargas variáveis.",
    quickCheck: "Sobrecarga de armazenagem ≥ 30 kN/m² (logística), 50–80 kN/m² (porta-paletes), 80–150 kN/m² (manufatura pesada).",
    url: "https://www.abntcatalogo.com.br/",
  },
  {
    code: "NBR 6123",
    title: "Forças devidas ao vento em edificações",
    domain: "vento",
    appliesWhen: "Sempre. Galpões altos e leves são sensíveis a vento (V0 por região, Categoria de rugosidade, fator topográfico).",
    quickCheck: "V0 entre 30 e 50 m/s no Brasil; verificar zona conforme mapa isopletas.",
    url: "https://www.abntcatalogo.com.br/",
  },
  {
    code: "NBR 8800",
    title: "Projeto de estruturas de aço e mistas de aço e concreto",
    domain: "aco",
    appliesWhen: "Pórticos, vigas e pilares de aço laminado/soldado (sistemas porticos_aco e trelicado).",
    url: "https://www.abntcatalogo.com.br/",
  },
  {
    code: "NBR 14762",
    title: "Dimensionamento de estruturas de aço constituídas por perfis formados a frio",
    domain: "perfis_frio",
    appliesWhen: "Estruturas em perfis formados a frio (LSF, terças, longarinas).",
    url: "https://www.abntcatalogo.com.br/",
  },
  {
    code: "NBR 5410",
    title: "Instalações elétricas de baixa tensão",
    domain: "eletrica",
    appliesWhen: "Sempre. Define carga, condutores, proteções e aterramento.",
    quickCheck: "Dimensionar QGBT, ramais e SPDA conforme NBR 5419.",
    url: "https://www.abntcatalogo.com.br/",
  },
  {
    code: "NBR 5626",
    title: "Sistemas prediais de água fria e água quente",
    domain: "hidraulica",
    appliesWhen: "Quando há banheiros, vestiários, refeitório, cozinha ou processo industrial.",
    url: "https://www.abntcatalogo.com.br/",
  },
  {
    code: "NBR 9077",
    title: "Saídas de emergência em edifícios",
    domain: "incendio",
    appliesWhen: "Quando área coberta > 750 m² ou ocupação J/I/H/F com lotação relevante.",
    quickCheck: "Distância máxima a percorrer 30–40 m; nº mínimo de saídas conforme classificação.",
    url: "https://www.abntcatalogo.com.br/",
  },
  {
    code: "NBR 9050",
    title: "Acessibilidade a edificações, mobiliário, espaços e equipamentos urbanos",
    domain: "acessibilidade",
    appliesWhen: "Áreas com acesso de público, escritórios, vestiários e estacionamento.",
    url: "https://www.abntcatalogo.com.br/",
  },
];

/** Lista compacta de códigos para uso direto em arrays de compliance. */
export const NORM_CODES = NORMS.map((n) => n.code);

/** Seleciona normas a citar conforme uso/ocupação. */
export function selectNormsForUse(
  use:
    | "logistics"
    | "industrial"
    | "distribution_center"
    | "cold_storage"
    | "cross_dock"
    | "manufacturing",
): NormRef[] {
  // Sempre aplicáveis a galpões em steel frame / pórticos.
  const base = NORMS.filter((n) =>
    [
      "NBR 16970",
      "NBR 6120",
      "NBR 6123",
      "NBR 8800",
      "NBR 14762",
      "NBR 5410",
      "NBR 5626",
      "NBR 9077",
    ].includes(n.code),
  );
  // Desempenho exigido quando há ocupação permanente (manufatura, CD com escritório).
  if (
    use === "manufacturing" ||
    use === "distribution_center" ||
    use === "industrial"
  ) {
    const desempenho = NORMS.find((n) => n.code === "NBR 15575");
    if (desempenho) base.push(desempenho);
  }
  return base;
}
