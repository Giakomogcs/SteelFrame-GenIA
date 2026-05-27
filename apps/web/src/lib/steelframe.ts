import type { LngLat } from "./geo";
import { localBBox, polygonCenter, toLocalMeters } from "./geo";

export type Material = "steel-frame-light" | "steel-frame-heavy" | "hybrid";

export interface WizardParams {
  material: Material;
  budget: number; // R$
  occupancyRate: number; // 0..1 — fração do terreno ocupada
  height: number; // pé direito (m)
  bayDepth: number; // espaçamento entre pórticos (m)
  roofPitchDeg: number; // inclinação do telhado em graus
  doors: number; // qtd de portões frontais
  mezzanine: boolean;
}

export interface Column {
  x: number;
  z: number;
  height: number;
}

export interface Truss {
  z: number;
  span: number;
  height: number;
  pitchDeg: number;
}

export interface SteelFrameModel {
  origin: LngLat; // referência geográfica
  rotationDeg: number;
  footprint: { width: number; depth: number; areaM2: number }; // dimensões do galpão
  height: number;
  bayDepth: number;
  bays: number;
  pitchDeg: number;
  columns: Column[];
  trusses: Truss[];
  mezzanine: boolean;
  doors: number;
  estimatedCost: number;
  estimatedSteelKg: number;
}

/**
 * Gera um modelo paramétrico de galpão steel frame inscrito no polígono.
 * Estratégia: pega bbox alinhado, aplica taxa de ocupação, distribui pórticos.
 */
export function generateSteelFrameModel(
  polygon: LngLat[],
  params: WizardParams,
): SteelFrameModel {
  const center = polygonCenter(polygon);
  const local = toLocalMeters(polygon, center);
  const bbox = localBBox(local);

  const occ = Math.max(0.2, Math.min(0.95, params.occupancyRate));
  const widthFull = Math.max(8, bbox.width * Math.sqrt(occ));
  const depthFull = Math.max(8, bbox.depth * Math.sqrt(occ));

  // Largura = vão livre (perpendicular aos pórticos)
  // Profundidade = direção dos pórticos
  const width = Math.round(widthFull * 10) / 10;
  const depth = Math.round(depthFull * 10) / 10;

  const bayDepth = Math.max(3, Math.min(12, params.bayDepth));
  const bays = Math.max(1, Math.round(depth / bayDepth));
  const actualBay = depth / bays;

  // Colunas: 2 por pórtico (uma de cada lado), nos extremos e a cada bay
  const columns: Column[] = [];
  for (let i = 0; i <= bays; i++) {
    const z = -depth / 2 + i * actualBay;
    columns.push({ x: -width / 2, z, height: params.height });
    columns.push({ x: width / 2, z, height: params.height });
  }

  const trusses: Truss[] = [];
  for (let i = 0; i <= bays; i++) {
    trusses.push({
      z: -depth / 2 + i * actualBay,
      span: width,
      height: (width / 2) * Math.tan((params.roofPitchDeg * Math.PI) / 180),
      pitchDeg: params.roofPitchDeg,
    });
  }

  // Estimativas grosseiras (placeholder)
  const areaM2 = width * depth;
  const steelKgPerM2 =
    params.material === "steel-frame-light"
      ? 35
      : params.material === "steel-frame-heavy"
        ? 65
        : 50;
  const estimatedSteelKg = Math.round(areaM2 * steelKgPerM2);
  const costPerM2 =
    params.material === "steel-frame-light"
      ? 1800
      : params.material === "steel-frame-heavy"
        ? 2800
        : 2200;
  const mezzExtra = params.mezzanine ? areaM2 * 0.4 * 1200 : 0;
  const estimatedCost = Math.round(areaM2 * costPerM2 + mezzExtra);

  return {
    origin: center,
    rotationDeg: 0,
    footprint: { width, depth, areaM2: Math.round(areaM2) },
    height: params.height,
    bayDepth: actualBay,
    bays,
    pitchDeg: params.roofPitchDeg,
    columns,
    trusses,
    mezzanine: params.mezzanine,
    doors: params.doors,
    estimatedCost,
    estimatedSteelKg,
  };
}
