// Utilidades geográficas para polígonos em (lng, lat)
export type LngLat = [number, number]; // [lng, lat]

const EARTH_RADIUS = 6378137; // metros

const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Área (m²) de polígono geográfico fechado usando a fórmula esférica
 * (L'Huilier / Shoelace adaptada). Aceita polígono aberto ou fechado.
 */
export function polygonAreaM2(points: LngLat[]): number {
  if (!points || points.length < 3) return 0;
  const pts =
    points[0][0] === points.at(-1)![0] && points[0][1] === points.at(-1)![1]
      ? points
      : [...points, points[0]];

  let area = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [lng1, lat1] = pts[i];
    const [lng2, lat2] = pts[i + 1];
    area +=
      toRad(lng2 - lng1) *
      (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  return Math.abs((area * EARTH_RADIUS * EARTH_RADIUS) / 2);
}

/** Centróide simples (média) — suficiente para focar mapa */
export function polygonCenter(points: LngLat[]): LngLat {
  const n = points.length || 1;
  const [sx, sy] = points.reduce(
    ([ax, ay], [x, y]) => [ax + x, ay + y],
    [0, 0],
  );
  return [sx / n, sy / n];
}

/** Converte lat/lng para metros locais (projeção equiretangular) com referência */
export function toLocalMeters(
  points: LngLat[],
  ref: LngLat,
): { x: number; y: number }[] {
  const [refLng, refLat] = ref;
  const cosLat = Math.cos(toRad(refLat));
  return points.map(([lng, lat]) => ({
    x: toRad(lng - refLng) * EARTH_RADIUS * cosLat,
    y: toRad(lat - refLat) * EARTH_RADIUS,
  }));
}

/** Bounding box alinhado a eixos do polígono em metros locais */
export function localBBox(localPts: { x: number; y: number }[]) {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of localPts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    depth: maxY - minY,
  };
}
