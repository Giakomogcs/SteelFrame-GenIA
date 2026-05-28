// Utilidades geográficas para polígonos em (lng, lat)
export type LngLat = [number, number]; // [lng, lat]

const EARTH_RADIUS = 6378137; // metros

/** Limites operacionais para a área de um terreno cadastrável. */
export const MIN_TERRAIN_AREA_M2 = 200; // 200 m² (10 × 20 m)
export const MAX_TERRAIN_AREA_M2 = 500_000; // 50 ha — recusa "cidade inteira"
export const MAX_MAP_ZOOM = 19; // Esri/OSM perdem detalhe acima disso
export const MIN_MAP_ZOOM = 5;

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
      toRad(lng2 - lng1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
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

/** Inverso de `toLocalMeters`: metros locais → lat/lng. */
export function fromLocalMeters(
  pts: { x: number; y: number }[],
  ref: LngLat,
): LngLat[] {
  const [refLng, refLat] = ref;
  const cosLat = Math.cos(toRad(refLat));
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  return pts.map(({ x, y }) => [
    refLng + toDeg(x / (EARTH_RADIUS * cosLat)),
    refLat + toDeg(y / EARTH_RADIUS),
  ]);
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
// ============================================================
// Relevo / inclinacao
// ============================================================

export interface ElevationSample {
  /** distancia acumulada do primeiro ponto, em metros */
  d: number;
  /** altitude no ponto, em metros */
  h: number;
  lat: number;
  lng: number;
}

export type EarthworksKey = "cut" | "fill" | "balanced";

export interface EarthworksOption {
  key: EarthworksKey;
  label: string;
  /** altitude da plataforma final (m) */
  platformH: number;
  /** volume de corte (m³) */
  cutM3: number;
  /** volume de aterro/empréstimo (m³) */
  fillM3: number;
  /** custo unitário ponderado (R$/m³) */
  unitCost: number;
  /** custo total estimado (R$) */
  totalCost: number;
  /** texto curto da estratégia */
  description: string;
}

export interface SlopeAnalysis {
  /** inclinacao media (%) = desnivel / extensao do perfil */
  slopePct: number;
  /** maior diferenca de altura entre quaisquer dois pontos amostrados (m) */
  elevationDelta: number;
  /** altitude media (m) */
  elevationMean: number;
  /** perfil para grafico AA' */
  profile: { d: number; h: number }[];
  /** classificacao textual */
  classification: "plano" | "suave" | "moderado" | "acentuado";
  /** se vale a pena terraplenar antes do galpao */
  needsLeveling: boolean;
  /** estimativa de volume de corte/aterro (m3) — opção recomendada */
  earthworksM3: number;
  /** as três opções de plataforma comparadas */
  earthworksOptions: EarthworksOption[];
  /** chave da opção mais barata */
  earthworksRecommended: EarthworksKey;
}

/**
 * Tabela de referência (R$/m³) — SINAPI/CUB médio Brasil 2025/26.
 * Reajuste em um único lugar caso a base mude.
 */
export const EARTHWORKS_RATES = {
  /** escavação mecanizada + carga + transporte + bota-fora */
  cutHaul: 45,
  /** material de empréstimo + lançamento + compactação */
  fillImport: 65,
  /** movimentação interna (corte + aterro no próprio lote) */
  balanced: 25,
} as const;

/** Computa as três estratégias de plataforma e devolve já ordenadas por custo. */
export function computeEarthworksOptions(
  samples: { h: number }[],
  areaM2: number,
): { options: EarthworksOption[]; recommended: EarthworksKey } {
  const hs = samples.map((s) => s.h);
  const n = hs.length || 1;
  const hMin = Math.min(...hs);
  const hMax = Math.max(...hs);
  const hMean = hs.reduce((s, h) => s + h, 0) / n;
  const Ai = areaM2 / n; // fração da área representada por cada amostra

  const sumCut = (H: number) =>
    hs.reduce((s, h) => s + Math.max(0, h - H) * Ai, 0);
  const sumFill = (H: number) =>
    hs.reduce((s, h) => s + Math.max(0, H - h) * Ai, 0);

  // 1) Corte total → plataforma na cota mínima (só remove terra)
  const cutVol = sumCut(hMin);
  const cut: EarthworksOption = {
    key: "cut",
    label: "Só corte (rebaixar)",
    platformH: hMin,
    cutM3: Math.round(cutVol),
    fillM3: 0,
    unitCost: EARTHWORKS_RATES.cutHaul,
    totalCost: Math.round(cutVol * EARTHWORKS_RATES.cutHaul),
    description:
      "Rebaixa o terreno até a cota mais baixa e descarta o material.",
  };

  // 2) Aterro total → plataforma na cota máxima (só importa material)
  const fillVol = sumFill(hMax);
  const fill: EarthworksOption = {
    key: "fill",
    label: "Só aterro (elevar)",
    platformH: hMax,
    cutM3: 0,
    fillM3: Math.round(fillVol),
    unitCost: EARTHWORKS_RATES.fillImport,
    totalCost: Math.round(fillVol * EARTHWORKS_RATES.fillImport),
    description:
      "Importa material para chegar à cota mais alta — sem bota-fora.",
  };

  // 3) Compensado → plataforma na cota média; movimenta corte+aterro internos
  const balCut = sumCut(hMean);
  const balFill = sumFill(hMean);
  const balVol = balCut + balFill;
  const balanced: EarthworksOption = {
    key: "balanced",
    label: "Corte + aterro compensado",
    platformH: hMean,
    cutM3: Math.round(balCut),
    fillM3: Math.round(balFill),
    unitCost: EARTHWORKS_RATES.balanced,
    totalCost: Math.round(balVol * EARTHWORKS_RATES.balanced),
    description:
      "Plataforma na cota média — quase sem transporte, mais barato.",
  };

  const options = [balanced, cut, fill];
  const recommended = [...options].sort((a, b) => a.totalCost - b.totalCost)[0]
    .key;
  return { options, recommended };
}

/**
 * Gera N pontos amostrais ao longo da diagonal do polygon (extremos do bbox).
 */
export function diagonalSamples(polygon: LngLat[], n = 8): LngLat[] {
  if (polygon.length < 3) return [];
  let minLng = Infinity,
    maxLng = -Infinity,
    minLat = Infinity,
    maxLat = -Infinity;
  for (const [lng, lat] of polygon) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const out: LngLat[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    out.push([minLng + (maxLng - minLng) * t, minLat + (maxLat - minLat) * t]);
  }
  return out;
}

/** Distancia em metros entre dois pontos lat/lng (Haversine). */
export function haversineM(a: LngLat, b: LngLat): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dphi = toRad(lat2 - lat1);
  const dlam = toRad(lng2 - lng1);
  const s =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(s));
}

/**
 * Computa a analise de slope dado um array de samples com altitude.
 */
export function computeSlopeAnalysis(
  samples: ElevationSample[],
  areaM2: number,
): SlopeAnalysis {
  if (samples.length < 2) {
    const empty = computeEarthworksOptions(
      samples.length ? samples : [{ h: 0 }],
      areaM2,
    );
    return {
      slopePct: 0,
      elevationDelta: 0,
      elevationMean: samples[0]?.h ?? 0,
      profile: samples.map((s) => ({ d: s.d, h: s.h })),
      classification: "plano",
      needsLeveling: false,
      earthworksM3: 0,
      earthworksOptions: empty.options,
      earthworksRecommended: empty.recommended,
    };
  }
  const hs = samples.map((s) => s.h);
  const hMin = Math.min(...hs);
  const hMax = Math.max(...hs);
  const elevationDelta = hMax - hMin;
  const elevationMean = hs.reduce((s, h) => s + h, 0) / hs.length;
  const totalDist = samples[samples.length - 1].d - samples[0].d;
  const slopePct = totalDist > 0 ? (elevationDelta / totalDist) * 100 : 0;
  const classification: SlopeAnalysis["classification"] =
    slopePct < 2
      ? "plano"
      : slopePct < 5
        ? "suave"
        : slopePct < 10
          ? "moderado"
          : "acentuado";
  const needsLeveling = slopePct > 3 || elevationDelta > 1.5;
  const earth = computeEarthworksOptions(samples, areaM2);
  const recommendedOpt = earth.options.find(
    (o) => o.key === earth.recommended,
  )!;
  const earthworksM3 = needsLeveling
    ? recommendedOpt.cutM3 + recommendedOpt.fillM3
    : 0;
  return {
    slopePct: Number(slopePct.toFixed(2)),
    elevationDelta: Number(elevationDelta.toFixed(2)),
    elevationMean: Number(elevationMean.toFixed(1)),
    profile: samples.map((s) => ({
      d: Math.round(s.d),
      h: Number(s.h.toFixed(2)),
    })),
    classification,
    needsLeveling,
    earthworksM3,
    earthworksOptions: earth.options,
    earthworksRecommended: earth.recommended,
  };
}

// ============================================================
// Amostragem por GRID 2D dentro do polígono — base do cálculo real
// de terraplenagem (integra cut/fill sobre área de cada célula).
// ============================================================

/** Ponto-em-polígono (ray casting). Polígono em [lng, lat]. */
export function pointInPolygon(pt: LngLat, poly: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect =
      yi > pt[1] !== yj > pt[1] &&
      pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export interface GridCell {
  lng: number;
  lat: number;
  row: number;
  col: number;
  inside: boolean;
}

export interface GridSampling {
  n: number;
  samples: GridCell[];
  /** área (m²) de uma célula da grade — todas iguais na projeção local */
  cellAreaM2: number;
  bbox: { minLng: number; maxLng: number; minLat: number; maxLat: number };
}

/**
 * Gera grade NxN de pontos cobrindo o bbox do polígono, marcando inside.
 * Cada célula representa uma área real (m²) que será multiplicada
 * pela altura de corte/aterro para volume.
 */
export function gridSamples(polygon: LngLat[], n: number): GridSampling {
  let minLng = Infinity,
    maxLng = -Infinity,
    minLat = Infinity,
    maxLat = -Infinity;
  for (const [lng, lat] of polygon) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const dLng = (maxLng - minLng) / n;
  const dLat = (maxLat - minLat) / n;
  const midLat = (minLat + maxLat) / 2;
  const cellW = haversineM([minLng, midLat], [minLng + dLng, midLat]);
  const cellH = haversineM([minLng, minLat], [minLng, minLat + dLat]);
  const cellAreaM2 = cellW * cellH;

  const samples: GridCell[] = [];
  for (let r = 0; r < n; r++) {
    const lat = minLat + dLat * (r + 0.5);
    for (let c = 0; c < n; c++) {
      const lng = minLng + dLng * (c + 0.5);
      samples.push({
        lng,
        lat,
        row: r,
        col: c,
        inside: pointInPolygon([lng, lat], polygon),
      });
    }
  }
  return {
    n,
    samples,
    cellAreaM2,
    bbox: { minLng, maxLng, minLat, maxLat },
  };
}

/**
 * Calcula análise de relevo a partir de um GRID 2D amostrado com elevações
 * reais. Integração de corte/aterro usa a área real de cada célula.
 *
 * Para a opção compensada usamos a **mediana** das elevações das células
 * dentro do polígono — para grids regulares (células com área igual),
 * a mediana minimiza Σ|h-H| (mass-balance verdadeiro), enquanto a média
 * minimiza Σ(h-H)² (não é a métrica de volume).
 */
export function computeSlopeFromGrid(
  grid: GridSampling,
  elevations: number[],
  polygon: LngLat[],
): SlopeAnalysis {
  const { samples, cellAreaM2 } = grid;
  const cells = samples
    .map((s, i) => ({ ...s, h: elevations[i] }))
    .filter((s) => Number.isFinite(s.h));
  const insideCells = cells.filter((s) => s.inside);
  const usedCells = insideCells.length >= 3 ? insideCells : cells;

  if (usedCells.length === 0) {
    return {
      slopePct: 0,
      elevationDelta: 0,
      elevationMean: 0,
      profile: [],
      classification: "plano",
      needsLeveling: false,
      earthworksM3: 0,
      earthworksOptions: computeEarthworksOptions([{ h: 0 }], 0).options,
      earthworksRecommended: "balanced",
    };
  }

  const hs = usedCells.map((s) => s.h);
  const hMin = Math.min(...hs);
  const hMax = Math.max(...hs);
  const hMean = hs.reduce((a, b) => a + b, 0) / hs.length;
  const sorted = [...hs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hMedian =
    sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;

  const sumCut = (H: number) =>
    hs.reduce((s, h) => s + Math.max(0, h - H) * cellAreaM2, 0);
  const sumFill = (H: number) =>
    hs.reduce((s, h) => s + Math.max(0, H - h) * cellAreaM2, 0);

  const cutVol = sumCut(hMin);
  const fillVol = sumFill(hMax);
  const balCut = sumCut(hMedian);
  const balFill = sumFill(hMedian);

  const balanced: EarthworksOption = {
    key: "balanced",
    label: "Corte + aterro compensado",
    platformH: Number(hMedian.toFixed(2)),
    cutM3: Math.round(balCut),
    fillM3: Math.round(balFill),
    unitCost: EARTHWORKS_RATES.balanced,
    totalCost: Math.round((balCut + balFill) * EARTHWORKS_RATES.balanced),
    description:
      "Plataforma na cota mediana (mass-balance) — quase tudo se move dentro do lote.",
  };
  const cut: EarthworksOption = {
    key: "cut",
    label: "Só corte (rebaixar)",
    platformH: Number(hMin.toFixed(2)),
    cutM3: Math.round(cutVol),
    fillM3: 0,
    unitCost: EARTHWORKS_RATES.cutHaul,
    totalCost: Math.round(cutVol * EARTHWORKS_RATES.cutHaul),
    description:
      "Rebaixa o terreno até a cota mais baixa e descarta o material.",
  };
  const fillOpt: EarthworksOption = {
    key: "fill",
    label: "Só aterro (elevar)",
    platformH: Number(hMax.toFixed(2)),
    cutM3: 0,
    fillM3: Math.round(fillVol),
    unitCost: EARTHWORKS_RATES.fillImport,
    totalCost: Math.round(fillVol * EARTHWORKS_RATES.fillImport),
    description:
      "Importa material para chegar à cota mais alta — sem bota-fora.",
  };
  const options = [balanced, cut, fillOpt];
  const recommended = [...options].sort((a, b) => a.totalCost - b.totalCost)[0]
    .key;

  // Perfil AA': diagonal SW→NE da grade.
  const N = grid.n;
  const profileCells: { lng: number; lat: number; h: number }[] = [];
  for (let i = 0; i < N; i++) {
    const s = cells.find((c) => c.row === i && c.col === i);
    if (s) profileCells.push({ lng: s.lng, lat: s.lat, h: s.h });
  }
  let accD = 0;
  const profile: { d: number; h: number }[] = [];
  for (let i = 0; i < profileCells.length; i++) {
    if (i > 0) {
      const a = profileCells[i - 1];
      const b = profileCells[i];
      accD += haversineM([a.lng, a.lat], [b.lng, b.lat]);
    }
    profile.push({
      d: Math.round(accD),
      h: Number(profileCells[i].h.toFixed(2)),
    });
  }

  const totalDist =
    profile.length > 1 ? profile[profile.length - 1].d - profile[0].d : 0;
  const elevationDelta = hMax - hMin;
  const slopePct = totalDist > 0 ? (elevationDelta / totalDist) * 100 : 0;
  const classification: SlopeAnalysis["classification"] =
    slopePct < 2
      ? "plano"
      : slopePct < 5
        ? "suave"
        : slopePct < 10
          ? "moderado"
          : "acentuado";
  const needsLeveling = slopePct > 3 || elevationDelta > 1.5;
  const recOpt = options.find((o) => o.key === recommended)!;
  const earthworksM3 = needsLeveling ? recOpt.cutM3 + recOpt.fillM3 : 0;

  return {
    slopePct: Number(slopePct.toFixed(2)),
    elevationDelta: Number(elevationDelta.toFixed(2)),
    elevationMean: Number(hMean.toFixed(1)),
    profile,
    classification,
    needsLeveling,
    earthworksM3,
    earthworksOptions: options,
    earthworksRecommended: recommended,
  };
}
