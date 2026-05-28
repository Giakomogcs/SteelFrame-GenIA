// Estrutura formal das perguntas do agente Pré-Projeto.
// O briefing pode usar este catálogo para gerar UIs/chips dinamicamente e
// também é exposto na página Base de Conhecimento.

export type QuestionKind =
  | "text"
  | "number"
  | "single_choice"
  | "multi_choice"
  | "boolean"
  | "address";

export interface AgentQuestion {
  id: string;
  group:
    | "localizacao"
    | "tipo_construcao"
    | "terreno"
    | "padrao"
    | "ambientes"
    | "especiais"
    | "documentos";
  label: string;
  kind: QuestionKind;
  options?: string[];
  optional?: boolean;
  helper?: string;
}

export const AGENT_QUESTIONS: AgentQuestion[] = [
  // Localização
  {
    id: "endereco",
    group: "localizacao",
    kind: "address",
    label: "Endereço completo do terreno.",
  },
  {
    id: "terreno_proprio",
    group: "localizacao",
    kind: "boolean",
    label: "O terreno já é seu?",
  },
  {
    id: "tipo_area",
    group: "localizacao",
    kind: "single_choice",
    label: "A obra será em:",
    options: ["urbana", "rural", "condomínio", "loteamento fechado", "não sei"],
  },

  // Tipo de construção
  {
    id: "tipo_obra",
    group: "tipo_construcao",
    kind: "single_choice",
    label: "O que deseja construir?",
    options: [
      "galpão industrial",
      "centro de distribuição",
      "cross-dock",
      "cold storage",
      "manufatura",
      "edícula",
      "ampliação",
      "comercial",
    ],
  },
  {
    id: "area_nova",
    group: "tipo_construcao",
    kind: "number",
    label: "Área aproximada da nova construção (m²).",
  },
  {
    id: "pavimentos",
    group: "tipo_construcao",
    kind: "number",
    label: "Quantos pavimentos? (1 = térrea)",
  },
  {
    id: "pe_direito",
    group: "tipo_construcao",
    kind: "single_choice",
    label: "Pé-direito desejado:",
    options: ["até 2,80 m", "3 a 4 m", "4 a 6 m", "acima de 6 m", "não sei"],
  },

  // Terreno e demolição
  {
    id: "estado_terreno",
    group: "terreno",
    kind: "single_choice",
    label: "O terreno está:",
    options: [
      "vazio",
      "com casa",
      "com galpão",
      "com construção antiga",
      "não sei",
    ],
  },
  {
    id: "considerar_demolicao",
    group: "terreno",
    kind: "single_choice",
    label: "Considerar custo de demolição?",
    options: ["sim", "não", "mostrar os dois cenários"],
  },
  {
    id: "area_existente",
    group: "terreno",
    kind: "number",
    optional: true,
    label: "Área aproximada da construção existente (m²).",
  },
  {
    id: "topografia_visual",
    group: "terreno",
    kind: "single_choice",
    label: "O terreno parece:",
    options: ["plano", "levemente inclinado", "muito inclinado", "não sei"],
  },

  // Padrão da obra
  {
    id: "padrao",
    group: "padrao",
    kind: "single_choice",
    label: "Padrão construtivo:",
    options: ["econômico", "médio", "alto padrão"],
  },
  {
    id: "isolamento",
    group: "padrao",
    kind: "single_choice",
    label: "Isolamento térmico/acústico:",
    options: ["básico", "intermediário", "alto desempenho", "não sei"],
  },
  {
    id: "cobertura",
    group: "padrao",
    kind: "single_choice",
    label: "Tipo de cobertura preferido:",
    options: [
      "telha metálica simples",
      "telha termoacústica",
      "sandwich PIR",
      "telhado embutido",
      "não sei",
    ],
  },

  // Ambientes
  {
    id: "dormitorios_salas",
    group: "ambientes",
    kind: "number",
    optional: true,
    label: "Quantos dormitórios ou salas?",
  },
  {
    id: "banheiros",
    group: "ambientes",
    kind: "number",
    optional: true,
    label: "Quantos banheiros?",
  },
  {
    id: "areas_molhadas",
    group: "ambientes",
    kind: "boolean",
    optional: true,
    label: "Terá cozinha ou área molhada?",
  },
  {
    id: "anexos",
    group: "ambientes",
    kind: "multi_choice",
    optional: true,
    label: "Terá:",
    options: [
      "garagem",
      "varanda",
      "mezanino",
      "área técnica",
      "escritório interno",
    ],
  },
  {
    id: "vidros",
    group: "ambientes",
    kind: "single_choice",
    optional: true,
    label: "Vidros/esquadrias:",
    options: ["pouco", "médio", "muito"],
  },

  // Requisitos especiais
  {
    id: "grandes_vaos",
    group: "especiais",
    kind: "boolean",
    label: "Haverá grandes vãos livres (> 15 m)?",
  },
  {
    id: "carga_especial",
    group: "especiais",
    kind: "single_choice",
    label: "Haverá carga especial?",
    options: [
      "caixa d'água elevada",
      "equipamento",
      "estoque pesado",
      "ponte rolante",
      "nenhuma",
      "não sei",
    ],
  },
  {
    id: "comercial_extras",
    group: "especiais",
    kind: "multi_choice",
    optional: true,
    label: "Para galpão/comercial:",
    options: ["AVCB", "docas", "escritório interno", "área de estoque"],
  },

  // Documentos existentes
  {
    id: "planta",
    group: "documentos",
    kind: "boolean",
    label: "Já existe planta ou croqui?",
  },
  {
    id: "topografia",
    group: "documentos",
    kind: "boolean",
    label: "Já existe levantamento topográfico?",
  },
  {
    id: "sondagem",
    group: "documentos",
    kind: "boolean",
    label: "Já existe sondagem do solo?",
  },
  {
    id: "projeto_aprovado",
    group: "documentos",
    kind: "boolean",
    label: "Já existe projeto aprovado na prefeitura?",
  },
];

export const questionsByGroup = (g: AgentQuestion["group"]) =>
  AGENT_QUESTIONS.filter((q) => q.group === g);

export const GROUP_LABELS: Record<AgentQuestion["group"], string> = {
  localizacao: "Localização",
  tipo_construcao: "Tipo de construção",
  terreno: "Terreno e demolição",
  padrao: "Padrão da obra",
  ambientes: "Ambientes",
  especiais: "Requisitos especiais",
  documentos: "Documentos existentes",
};
