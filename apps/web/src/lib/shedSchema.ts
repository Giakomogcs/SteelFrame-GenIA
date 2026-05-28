// IndustrialShedSchema — modelo canônico para galpões logísticos/industriais.
// A IA gera JSON conforme este schema; o viewer 3D paramétrico consome-o.
import { z } from "zod";

// ---- Sub-schemas ---------------------------------------------------------

export const LotSchema = z.object({
  width: z.number().min(10).max(800).describe("Largura do lote (m)"),
  depth: z.number().min(10).max(1500).describe("Profundidade do lote (m)"),
  slopePct: z
    .number()
    .min(0)
    .max(40)
    .default(0)
    .describe("Inclinação média (%)"),
});

export const SetbacksSchema = z.object({
  front: z.number().min(0).max(50).default(8),
  sides: z.number().min(0).max(50).default(3),
  back: z.number().min(0).max(50).default(3),
});

export const FootprintSchema = z.object({
  width: z
    .number()
    .min(6)
    .max(500)
    .describe("Largura (m) — vão livre principal"),
  depth: z
    .number()
    .min(6)
    .max(800)
    .describe("Profundidade (m) — eixo dos pórticos"),
});

export const StructureSchema = z.object({
  system: z
    .enum(["steel_frame_light", "porticos_aco", "trelicado"])
    .default("porticos_aco"),
  bayCount: z.number().int().min(1).max(60).describe("Nº de pórticos"),
  baySpacing: z
    .number()
    .min(4)
    .max(12)
    .describe("Espaçamento entre pórticos (m)"),
  freeSpan: z.number().min(6).max(80).describe("Vão livre (m)"),
  clearHeight: z.number().min(4).max(20).describe("Pé-direito útil (m)"),
  columnProfile: z.string().default("W250x32").describe("Perfil das colunas"),
  roofStructure: z
    .enum(["tesoura", "trelica", "viga_alma_cheia"])
    .default("trelica"),
});

export const RoofSchema = z.object({
  type: z.enum(["gable", "shed", "sawtooth", "arch", "flat"]).default("gable"),
  slopePct: z.number().min(0).max(40).default(10).describe("Inclinação (%)"),
  overhang: z.number().min(0).max(3).default(0.6),
  cover: z
    .enum([
      "telha_metalica",
      "telha_termoacustica",
      "sandwich_PIR",
      "fibrocimento",
    ])
    .default("telha_termoacustica"),
  skylightPct: z
    .number()
    .min(0)
    .max(20)
    .default(4)
    .describe("% de iluminação zenital (lanternins/skylights)"),
  gutters: z.boolean().default(true),
});

export const EnvelopeSchema = z.object({
  walls: z
    .enum([
      "telha_lateral",
      "alvenaria_baixa_telha",
      "sandwich",
      "ACM",
      "concreto_pre_moldado",
    ])
    .default("alvenaria_baixa_telha"),
  insulation: z
    .enum(["nenhum", "basico", "intermediario", "alto_desempenho"])
    .default("basico"),
  wallBaseHeight: z
    .number()
    .min(0)
    .max(10)
    .default(2.5)
    .describe("Altura de alvenaria de base (m)"),
});

export const ZoneSchema = z.object({
  name: z.string(),
  type: z.enum([
    "armazenagem",
    "picking",
    "expedicao",
    "recebimento",
    "escritorio",
    "vestiario",
    "refeitorio",
    "area_tecnica",
    "avcb_hidrante",
    "producao",
  ]),
  x: z.number(),
  z: z.number(),
  width: z.number().min(1).max(500),
  depth: z.number().min(1).max(800),
  height: z.number().min(2.2).max(20).default(3),
  floorLoad_kN_m2: z.number().min(2).max(150).default(30),
});

export const DockSchema = z.object({
  x: z.number(),
  z: z.number(),
  wall: z.enum(["north", "south", "east", "west"]).default("south"),
  type: z.enum(["nivelada", "elevada", "rebaixada"]).default("nivelada"),
  levelers: z.boolean().default(true),
  seal: z.boolean().default(true),
});

export const MezzanineSchema = z.object({
  x: z.number(),
  z: z.number(),
  width: z.number().min(2).max(200),
  depth: z.number().min(2).max(200),
  height: z.number().min(2.2).max(8).default(3),
  load_kN_m2: z.number().min(2).max(20).default(5),
});

export const CraneRailSchema = z.object({
  capacity_t: z.number().min(0.5).max(50).default(5),
  span: z.number().min(4).max(60).default(15),
  height: z.number().min(4).max(20).default(8),
});

export const OpeningSchema = z.object({
  type: z.enum([
    "portao_seccional",
    "portao_enrolar",
    "porta_pessoal",
    "porta_corta_fogo",
    "janela_alta",
    "exaustor_eolico",
    "lanternim",
  ]),
  wall: z.enum(["north", "south", "east", "west"]),
  xAlongWall: z.number().min(0),
  width: z.number().min(0.6).max(20),
  height: z.number().min(0.6).max(8),
  elevation: z.number().min(0).max(15).default(0),
});

export const FloorSchema = z.object({
  type: z
    .enum([
      "industrial_polido",
      "concreto_armado",
      "epoxi_antiderrapante",
      "intertravado",
    ])
    .default("industrial_polido"),
  load_kN_m2: z.number().min(2).max(150).default(30),
  thickness_cm: z.number().min(8).max(40).default(15),
});

export const UtilitiesSchema = z.object({
  power_kVA: z.number().min(0).max(5000).default(150),
  water: z.boolean().default(true),
  sewage: z.boolean().default(true),
  compressedAir: z.boolean().default(false),
  firePump: z.boolean().default(false),
  sprinklers: z.boolean().default(false),
  hydrants: z.number().int().min(0).max(50).default(2),
});

export const SafetySchema = z.object({
  occupancyClass: z
    .string()
    .default("J-2 / J-3")
    .describe("Classificação NBR 9077"),
  fireLoad_MJ_m2: z.number().min(0).max(8000).default(1000),
  exitsCount: z.number().int().min(1).max(20).default(2),
  exitsWidthTotal: z.number().min(1).max(40).default(2.2),
  maxTravelDistance_m: z.number().min(5).max(80).default(30),
  avcbRequired: z.boolean().default(true),
});

export const YardSchema = z.object({
  truckCircle_m: z.number().min(0).max(50).default(25),
  parkingCars: z.number().int().min(0).max(2000).default(10),
  parkingTrucks: z.number().int().min(0).max(500).default(3),
  retentionPond: z.boolean().default(false),
});

export const PerimeterSchema = z.object({
  fenceHeight: z.number().min(0).max(6).default(2.2),
  fenceType: z
    .enum(["muro", "alambrado", "concertina", "concreto_pre_moldado"])
    .default("muro"),
  gate: z.boolean().default(true),
  guardhouse: z.boolean().default(false),
});

export const ComplianceSchema = z.object({
  norms: z
    .array(z.string())
    .default([
      "NBR 16970",
      "NBR 15575",
      "NBR 6120",
      "NBR 6123",
      "NBR 8800",
      "NBR 14762",
      "NBR 5410",
      "NBR 5626",
      "NBR 9077",
    ]),
  costSources: z.array(z.string()).default(["SINAPI", "CUB Sinduscon-SP"]),
});

// ---- Main schema --------------------------------------------------------

export const IndustrialShedSchema = z.object({
  schemaVersion: z.literal("shed-1").default("shed-1"),
  use: z
    .enum([
      "logistics",
      "industrial",
      "distribution_center",
      "cold_storage",
      "cross_dock",
      "manufacturing",
    ])
    .default("logistics"),
  standard: z
    .enum(["economico", "medio", "alto"])
    .default("medio")
    .describe("Padrão construtivo"),
  lot: LotSchema,
  setbacks: SetbacksSchema.default({ front: 8, sides: 3, back: 3 }),
  footprint: FootprintSchema,
  structure: StructureSchema,
  roof: RoofSchema,
  envelope: EnvelopeSchema,
  zones: z.array(ZoneSchema).default([]),
  docks: z.array(DockSchema).default([]),
  mezzanine: MezzanineSchema.optional(),
  craneRails: z.array(CraneRailSchema).default([]),
  openings: z.array(OpeningSchema).default([]),
  floor: FloorSchema,
  utilities: UtilitiesSchema,
  safety: SafetySchema,
  yard: YardSchema,
  perimeter: PerimeterSchema,
  compliance: ComplianceSchema,
  estimate: z
    .object({
      costPerM2: z.number().min(500).max(15000).default(2200),
      totalCost: z.number().min(0).default(0),
      steelKg: z.number().min(0).default(0),
      coveredAreaM2: z.number().min(0).default(0),
    })
    .default({ costPerM2: 2200, totalCost: 0, steelKg: 0, coveredAreaM2: 0 }),
  assumptions: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.7),
});

export type Lot = z.infer<typeof LotSchema>;
export type Footprint = z.infer<typeof FootprintSchema>;
export type Structure = z.infer<typeof StructureSchema>;
export type Roof = z.infer<typeof RoofSchema>;
export type Envelope = z.infer<typeof EnvelopeSchema>;
export type Zone = z.infer<typeof ZoneSchema>;
export type Dock = z.infer<typeof DockSchema>;
export type Mezzanine = z.infer<typeof MezzanineSchema>;
export type CraneRail = z.infer<typeof CraneRailSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type IndustrialShed = z.infer<typeof IndustrialShedSchema>;

export function isIndustrialShed(value: unknown): value is IndustrialShed {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { schemaVersion?: string }).schemaVersion === "shed-1"
  );
}
