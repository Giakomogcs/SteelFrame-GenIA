/**
 * Serviço de medição de relevo (real, baseado em DEM global).
 *
 * Amostra uma grade 2D (10×10 = 100 pontos) dentro do bbox do polígono,
 * consulta elevações reais via OpenTopography (Copernicus 30 m) — ou
 * OpenTopoData como fallback — e integra cut/fill usando a área real
 * de cada célula. O resultado é persistido no Terrain e devolvido para
 * a UI.
 */
import { prisma } from "@sfg/db";
import {
  gridSamples,
  computeSlopeFromGrid,
  profileLineSamples,
  buildProfile,
  type LngLat,
  type SlopeAnalysis,
} from "@/lib/geo";
import { fetchElevations } from "@/lib/elevationProvider";

/** Quantidade de células por lado da grade. 10×10 = 100 → 1 req OpenTopoData. */
const GRID_N = 10;
/** Pontos densos ao longo do eixo principal do polígono para o perfil AA'.
 *  Mantemos GRID_N²+PROFILE_N ≤ 200 (2 chunks de OpenTopoData ou 1 req de OT). */
const PROFILE_N = 60;

export async function measureAndPersistSlope(
  terrainId: string,
): Promise<SlopeAnalysis> {
  const terrain = await prisma.terrain.findUnique({ where: { id: terrainId } });
  if (!terrain) throw new Error("Terreno não encontrado");
  const polygon = terrain.polygon as unknown as LngLat[];
  if (!polygon || polygon.length < 3) throw new Error("Polígono inválido");

  const grid = gridSamples(polygon, GRID_N);
  const profileLine = profileLineSamples(polygon, PROFILE_N);

  const gridPoints: Array<[number, number]> = grid.samples.map((s) => [
    s.lng,
    s.lat,
  ]);
  const profilePoints: Array<[number, number]> = profileLine.points.map((p) => [
    p[0],
    p[1],
  ]);
  const allPoints = [...gridPoints, ...profilePoints];

  // bbox cobrindo grid + linha do perfil (caso a corda exceda o bbox do grid)
  const allLngs = allPoints.map((p) => p[0]);
  const allLats = allPoints.map((p) => p[1]);
  const bbox = {
    minLng: Math.min(...allLngs),
    maxLng: Math.max(...allLngs),
    minLat: Math.min(...allLats),
    maxLat: Math.max(...allLats),
  };

  const { elevations } = await fetchElevations(allPoints, bbox);
  const gridElev = elevations.slice(0, gridPoints.length);
  const profileElev = elevations.slice(gridPoints.length);

  const profile = buildProfile(profileLine.points, profileElev);
  const analysis = computeSlopeFromGrid(grid, gridElev, polygon, profile);

  await prisma.terrain.update({
    where: { id: terrain.id },
    data: {
      slopePct: analysis.slopePct,
      elevationMean: analysis.elevationMean,
      elevationDelta: analysis.elevationDelta,
      // Persistimos perfil + opções de terraplenagem juntos para que o
      // SSR mostre os mesmos números do último cálculo sem precisar de
      // uma migration nova. Formato legado (array puro) ainda é aceito
      // por SlopeCard, mas é sobrescrito no primeiro Recalcular.
      elevationProfile: {
        profile: analysis.profile,
        earthworksOptions: analysis.earthworksOptions,
        earthworksRecommended: analysis.earthworksRecommended,
      } as unknown as object,
    },
  });

  return analysis;
}
