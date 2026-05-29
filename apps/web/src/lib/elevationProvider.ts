/**
 * Provider de elevação real do terreno.
 *
 * Prioridade:
 *  1. OpenTopography Global DEM API (demtype COP30 — Copernicus 30 m)
 *     se OPENTOPOGRAPHY_API_KEY estiver definido. Faz UMA única requisição
 *     baixando um AAIGrid do bbox e interpola bilinearmente em cada ponto.
 *  2. OpenTopoData público (api.opentopodata.org/v1/srtm30m) — sem chave,
 *     limite de 100 pontos por requisição, ~1 req/s. Usa SRTM 30 m.
 *
 * Configurável via env:
 *   OPENTOPOGRAPHY_API_KEY      → habilita rota OT (recomendado).
 *   OPENTOPOGRAPHY_DEMTYPE      → default "COP30". Outras: SRTMGL1, SRTMGL3.
 *   OPENTOPODATA_URL            → default https://api.opentopodata.org/v1/srtm30m
 */

export type ElevationProvider = "opentopography" | "opentopodata";

export interface ElevationResult {
  elevations: number[];
  provider: ElevationProvider;
}

interface BBox {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}

/**
 * Busca elevação (m) para um conjunto de pontos [lng, lat].
 * @param points lista de pontos [lng, lat]
 * @param bbox bbox cobrindo todos os pontos — usado pelo provider raster
 *             para pedir o DEM da região em uma única requisição.
 */
export async function fetchElevations(
  points: Array<[number, number]>,
  bbox: BBox,
): Promise<ElevationResult> {
  const key = process.env.OPENTOPOGRAPHY_API_KEY?.trim();
  if (key) {
    try {
      const elevations = await fetchFromOpenTopography(points, bbox, key);
      return { elevations, provider: "opentopography" };
    } catch (err) {
      console.warn(
        `[elevation] OpenTopography falhou, caindo para OpenTopoData:`,
        (err as Error).message,
      );
    }
  }
  const elevations = await fetchFromOpenTopoData(points);
  return { elevations, provider: "opentopodata" };
}

// ---------------------------------------------------------------------------
// OpenTopography — globaldem AAIGrid + interpolação bilinear
// ---------------------------------------------------------------------------

async function fetchFromOpenTopography(
  points: Array<[number, number]>,
  bbox: BBox,
  apiKey: string,
): Promise<number[]> {
  const demtype = process.env.OPENTOPOGRAPHY_DEMTYPE?.trim() || "COP30";
  // bufferiza ~150 m em cada lado para sempre incluir células vizinhas
  const latBuf = 150 / 111_320;
  const lngBuf =
    150 /
    (111_320 * Math.cos((((bbox.minLat + bbox.maxLat) / 2) * Math.PI) / 180));
  const south = bbox.minLat - latBuf;
  const north = bbox.maxLat + latBuf;
  const west = bbox.minLng - lngBuf;
  const east = bbox.maxLng + lngBuf;

  const url =
    `https://portal.opentopography.org/API/globaldem` +
    `?demtype=${encodeURIComponent(demtype)}` +
    `&south=${south}&north=${north}&west=${west}&east=${east}` +
    `&outputFormat=AAIGrid&API_Key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenTopography ${res.status}: ${body.slice(0, 200)}`);
  }
  const text = await res.text();
  const dem = parseAAIGrid(text);
  return points.map(([lng, lat]) => bilinearSample(dem, lng, lat));
}

interface DEM {
  ncols: number;
  nrows: number;
  xllcorner: number;
  yllcorner: number;
  cellsize: number;
  nodata: number;
  /** valores armazenados linha por linha, ÍNDICE 0 = SUL (já invertido) */
  values: Float32Array;
}

/** Parser de Arc/Info ASCII Grid (AAIGrid). */
function parseAAIGrid(text: string): DEM {
  const lines = text.split(/\r?\n/);
  const header: Record<string, number> = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const m = line.match(/^([a-zA-Z_]+)\s+(\S+)$/);
    if (!m) break;
    header[m[1].toLowerCase()] = Number(m[2]);
  }
  const ncols = header.ncols;
  const nrows = header.nrows;
  const cellsize = header.cellsize;
  const xllcorner = header.xllcorner ?? header.xllcenter;
  const yllcorner = header.yllcorner ?? header.yllcenter;
  const nodata = header.nodata_value ?? -9999;
  if (!ncols || !nrows || !cellsize) {
    throw new Error(`AAIGrid header inválido: ${JSON.stringify(header)}`);
  }
  // restante é a matriz de valores (linha 0 = NORTE)
  const tokens = lines.slice(i).join(" ").trim().split(/\s+/);
  if (tokens.length < ncols * nrows) {
    throw new Error(
      `AAIGrid: esperava ${ncols * nrows} valores, recebeu ${tokens.length}`,
    );
  }
  // invertemos para que row 0 corresponda ao SUL (alinhado com yllcorner)
  const values = new Float32Array(ncols * nrows);
  for (let r = 0; r < nrows; r++) {
    const srcRow = nrows - 1 - r; // linha norte -> índice baixo no arquivo
    for (let c = 0; c < ncols; c++) {
      values[r * ncols + c] = Number(tokens[srcRow * ncols + c]);
    }
  }
  return { ncols, nrows, xllcorner, yllcorner, cellsize, nodata, values };
}

function bilinearSample(dem: DEM, lng: number, lat: number): number {
  const { ncols, nrows, xllcorner, yllcorner, cellsize, nodata, values } = dem;
  // converte para coords de célula (centro da célula 0 está em xllcorner+0.5*cellsize)
  const fx = (lng - xllcorner) / cellsize - 0.5;
  const fy = (lat - yllcorner) / cellsize - 0.5;
  const x0 = Math.max(0, Math.min(ncols - 1, Math.floor(fx)));
  const x1 = Math.max(0, Math.min(ncols - 1, x0 + 1));
  const y0 = Math.max(0, Math.min(nrows - 1, Math.floor(fy)));
  const y1 = Math.max(0, Math.min(nrows - 1, y0 + 1));
  const tx = Math.max(0, Math.min(1, fx - x0));
  const ty = Math.max(0, Math.min(1, fy - y0));
  const q = (c: number, r: number) => {
    const v = values[r * ncols + c];
    return v === nodata ? NaN : v;
  };
  const v00 = q(x0, y0);
  const v10 = q(x1, y0);
  const v01 = q(x0, y1);
  const v11 = q(x1, y1);
  const vals = [v00, v10, v01, v11].filter((v) => Number.isFinite(v));
  if (vals.length === 0) return 0;
  const safe = (v: number) => (Number.isFinite(v) ? v : vals[0]);
  const a = safe(v00) * (1 - tx) + safe(v10) * tx;
  const b = safe(v01) * (1 - tx) + safe(v11) * tx;
  return a * (1 - ty) + b * ty;
}

// ---------------------------------------------------------------------------
// OpenTopoData (fallback público — datasets do próprio OpenTopography)
// ---------------------------------------------------------------------------

async function fetchFromOpenTopoData(
  points: Array<[number, number]>,
): Promise<number[]> {
  const base =
    process.env.OPENTOPODATA_URL?.trim() ||
    "https://api.opentopodata.org/v1/srtm30m";

  // OpenTopoData público aceita até 100 locations por requisição.
  const CHUNK = 100;
  const out: number[] = [];
  for (let i = 0; i < points.length; i += CHUNK) {
    const slice = points.slice(i, i + CHUNK);
    const locations = slice.map(([lng, lat]) => `${lat},${lng}`).join("|");
    // interpolation=bilinear é o default da API, mas tornamos explícito
    // para garantir suavização entre células do DEM (SRTM30m). Sem isso,
    // pontos muito próximos retornam a MESMA altitude (snap à célula),
    // o que produz o efeito de "platô-degrau-platô" no perfil AA'.
    const url =
      `${base}?locations=${encodeURIComponent(locations)}` +
      `&interpolation=bilinear`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenTopoData ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      results: { elevation: number | null }[];
    };
    for (const r of json.results) out.push(r.elevation ?? 0);
  }
  return out;
}
