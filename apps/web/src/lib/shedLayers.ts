// shedLayers.ts — deriva camadas construtivas L1–L6 a partir de um
// IndustrialShed. Retorna metadados (cor, custo, quantidade, descrição)
// usados pelo layer-rail do visualizador 3D e pelo painel de parâmetros.
import type { IndustrialShed } from "./shedSchema";

export type LayerId =
  | "foundation"
  | "structure"
  | "floor"
  | "services"
  | "cladding"
  | "roof";

export interface LayerSpec {
  id: LayerId;
  idx: "L1" | "L2" | "L3" | "L4" | "L5" | "L6";
  name: string;
  color: string;
  costBRL: number;
  costPct: number;
  meta: string;
  quantityLabel: string;
}

// Cores de identidade L1–L6 (idênticas ao protótipo viewer-3d.html).
export const LAYER_COLOR: Record<LayerId, string> = {
  foundation: "#8a8f96",
  structure: "#5fb7ff",
  floor: "#b8a06b",
  services: "#17a34a",
  cladding: "#D72042",
  roof: "#FF7524",
};

// Stagger usado pelo modo "explodir" (multiplicador da altura útil).
export const EXPLODE_OFFSET: Record<LayerId, number> = {
  foundation: 0.8,
  floor: 0.2,
  structure: -0.4,
  services: -0.3,
  cladding: -0.7,
  roof: -1.4,
};

const BRL = (n: number) =>
  n >= 1_000_000
    ? `R$ ${(n / 1_000_000).toFixed(2).replace(".", ",")} M`
    : n >= 1_000
      ? `R$ ${(n / 1_000).toFixed(0)} mil`
      : `R$ ${n.toFixed(0)}`;

// Distribuição típica de custo (galpão industrial steel frame). Ajustada
// por padrão construtivo no `apply()`.
const BASE_DIST: Record<LayerId, number> = {
  foundation: 0.14,
  structure: 0.28,
  floor: 0.12,
  services: 0.18,
  cladding: 0.16,
  roof: 0.12,
};

export function deriveLayers(shed: IndustrialShed): LayerSpec[] {
  const total = Math.max(0, shed.estimate?.totalCost ?? 0);
  const area = Math.max(
    1,
    shed.estimate?.coveredAreaM2 ?? shed.footprint.width * shed.footprint.depth,
  );
  const steelKg = Math.max(0, shed.estimate?.steelKg ?? 0);
  const steelT = steelKg / 1000;
  const bays = shed.structure.bayCount;
  const span = shed.structure.freeSpan;
  const clear = shed.structure.clearHeight;
  const roofPct = shed.roof.skylightPct ?? 0;
  const docks = shed.docks?.length ?? 0;
  const power = shed.utilities?.power_kVA ?? 0;
  const hydrants = shed.utilities?.hydrants ?? 0;
  const wallBase = shed.envelope.wallBaseHeight ?? 0;
  const floorThk = shed.floor.thickness_cm ?? 15;
  const floorLoad = shed.floor.load_kN_m2 ?? 30;
  const standard = shed.standard;

  // Ajuste leve de distribuição por padrão.
  const tweak: Record<LayerId, number> =
    standard === "alto"
      ? {
          foundation: 0,
          structure: +0.02,
          floor: 0,
          services: +0.02,
          cladding: -0.02,
          roof: -0.02,
        }
      : standard === "economico"
        ? {
            foundation: 0,
            structure: -0.02,
            floor: -0.01,
            services: -0.02,
            cladding: +0.03,
            roof: +0.02,
          }
        : {
            foundation: 0,
            structure: 0,
            floor: 0,
            services: 0,
            cladding: 0,
            roof: 0,
          };

  const dist = (id: LayerId) => BASE_DIST[id] + tweak[id];
  const cost = (id: LayerId) => Math.round(total * dist(id));
  const pct = (id: LayerId) => Math.round(dist(id) * 100);

  const list: LayerSpec[] = [
    {
      id: "foundation",
      idx: "L1",
      name: "Fundação",
      color: LAYER_COLOR.foundation,
      costBRL: cost("foundation"),
      costPct: pct("foundation"),
      quantityLabel: `${Math.round(area * 0.9)} m² · ${bays * 2} sapatas`,
      meta: `${bays * 2} sapatas · radier ${floorLoad} kN/m² · ${BRL(cost("foundation"))}`,
    },
    {
      id: "structure",
      idx: "L2",
      name: "Estrutura",
      color: LAYER_COLOR.structure,
      costBRL: cost("structure"),
      costPct: pct("structure"),
      quantityLabel: `${bays} pórticos · ${steelT.toFixed(1)} t aço`,
      meta: `${bays} pórticos · vão ${span} m · ${steelT.toFixed(0)} t aço · ${BRL(cost("structure"))}`,
    },
    {
      id: "floor",
      idx: "L3",
      name: "Piso",
      color: LAYER_COLOR.floor,
      costBRL: cost("floor"),
      costPct: pct("floor"),
      quantityLabel: `${Math.round(area)} m² · ${floorThk} cm`,
      meta: `${shed.floor.type.replace(/_/g, " ")} · ${floorLoad} kN/m² · ${BRL(cost("floor"))}`,
    },
    {
      id: "services",
      idx: "L4",
      name: "Sistemas",
      color: LAYER_COLOR.services,
      costBRL: cost("services"),
      costPct: pct("services"),
      quantityLabel: `${power} kVA · ${hydrants} hidr. · ${docks} docas`,
      meta: `Elétrica ${power} kVA · ${hydrants} hidrantes · ${docks} docas · ${BRL(cost("services"))}`,
    },
    {
      id: "cladding",
      idx: "L5",
      name: "Vedação",
      color: LAYER_COLOR.cladding,
      costBRL: cost("cladding"),
      costPct: pct("cladding"),
      quantityLabel: `${shed.envelope.walls.replace(/_/g, " ")} · base ${wallBase} m`,
      meta: `${shed.envelope.walls.replace(/_/g, " ")} · base ${wallBase} m · ${BRL(cost("cladding"))}`,
    },
    {
      id: "roof",
      idx: "L6",
      name: "Cobertura",
      color: LAYER_COLOR.roof,
      costBRL: cost("roof"),
      costPct: pct("roof"),
      quantityLabel: `${shed.roof.type} · ${roofPct}% zenital`,
      meta: `${shed.roof.cover.replace(/_/g, " ")} · ${shed.roof.slopePct}% · ${roofPct}% zenital · ${BRL(cost("roof"))}`,
    },
  ];

  return list;
}

export const LAYER_ORDER: LayerId[] = [
  "foundation",
  "structure",
  "floor",
  "services",
  "cladding",
  "roof",
];
