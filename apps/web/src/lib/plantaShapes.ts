/**
 * Projeção do polígono do lote para SVG (viewBox 0..160 × 0..100),
 * orientando o terreno pelo seu maior eixo (rotacionando para horizontal).
 * Usado pelos diagramas de planta-baixa no wizard.
 */
import { toLocalMeters, type LngLat } from "./geo";

export interface LotProjection {
  /** Path SVG "M x y L x y … Z" do polígono já projetado e centrado. */
  polygonPath: string;
  /** Vértices projetados no viewBox (para overlays customizados). */
  points: { x: number; y: number }[];
  /** Bounding-box do polígono já no espaço do viewBox. */
  bbox: { x: number; y: number; w: number; h: number };
  /** Largura/profundidade reais do lote (m) no eixo principal. */
  realW: number;
  realD: number;
  /** Conversor metros → unidades de viewBox (escala uniforme). */
  pxPerMeter: number;
}

export const PLANTA_VIEW_W = 200;
export const PLANTA_VIEW_H = 130;

function rotate(p: { x: number; y: number }, c: number, s: number) {
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/**
 * Projeta o polígono no viewBox. Encontra a aresta mais longa, rotaciona
 * o polígono para alinhar essa aresta com o eixo X, depois escala para
 * caber no viewBox preservando aspect-ratio.
 */
export function buildLotProjection(
  polygon: LngLat[],
  margin = 10,
): LotProjection {
  if (polygon.length < 3) {
    return {
      polygonPath: "",
      points: [],
      bbox: { x: 0, y: 0, w: PLANTA_VIEW_W, h: PLANTA_VIEW_H },
      realW: 0,
      realD: 0,
      pxPerMeter: 1,
    };
  }
  const local = toLocalMeters(polygon, polygon[0]);

  // Aresta mais longa → ângulo de rotação
  let bestLen = -1;
  let bestAng = 0;
  for (let i = 0; i < local.length; i++) {
    const a = local[i];
    const b = local[(i + 1) % local.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len > bestLen) {
      bestLen = len;
      bestAng = Math.atan2(dy, dx);
    }
  }
  const c = Math.cos(-bestAng);
  const s = Math.sin(-bestAng);
  const rotated = local.map((p) => rotate(p, c, s));

  // BBox real (metros) após rotação
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of rotated) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const W = maxX - minX;
  const D = maxY - minY;

  // Escala uniforme para caber no viewBox
  const innerW = PLANTA_VIEW_W - margin * 2;
  const innerH = PLANTA_VIEW_H - margin * 2;
  const scale = Math.min(innerW / Math.max(0.1, W), innerH / Math.max(0.1, D));
  const offsetX = (PLANTA_VIEW_W - W * scale) / 2;
  const offsetY = (PLANTA_VIEW_H - D * scale) / 2;

  const points = rotated.map((p) => ({
    x: offsetX + (p.x - minX) * scale,
    // Invertemos Y para que "norte" do mapa fique para cima no SVG.
    y: PLANTA_VIEW_H - (offsetY + (p.y - minY) * scale),
  }));

  const polygonPath =
    points
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ") + " Z";

  // BBox no viewBox
  let bx0 = Infinity,
    bx1 = -Infinity,
    by0 = Infinity,
    by1 = -Infinity;
  for (const p of points) {
    if (p.x < bx0) bx0 = p.x;
    if (p.x > bx1) bx1 = p.x;
    if (p.y < by0) by0 = p.y;
    if (p.y > by1) by1 = p.y;
  }

  return {
    polygonPath,
    points,
    bbox: { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 },
    realW: W,
    realD: D,
    pxPerMeter: scale,
  };
}

/**
 * Retorna a faixa de inscrição (em viewBox px) dentro da bbox do lote,
 * deixando um recuo (em metros) reservado para circulação/estacionamento.
 */
export function inscribedShedRect(
  proj: LotProjection,
  setbackM = 8,
): { x: number; y: number; w: number; h: number } {
  const pad = setbackM * proj.pxPerMeter;
  const r = {
    x: proj.bbox.x + pad,
    y: proj.bbox.y + pad,
    w: Math.max(20, proj.bbox.w - pad * 2),
    h: Math.max(14, proj.bbox.h - pad * 2),
  };
  return r;
}
