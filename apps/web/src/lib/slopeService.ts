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
  type LngLat,
  type SlopeAnalysis,
} from "@/lib/geo";
import { fetchElevations } from "@/lib/elevationProvider";

/** Quantidade de células por lado da grade. 10×10 = 100 → 1 req OpenTopoData. */
const GRID_N = 10;

export async function measureAndPersistSlope(
  terrainId: string,
): Promise<SlopeAnalysis> {
  const terrain = await prisma.terrain.findUnique({ where: { id: terrainId } });
  if (!terrain) throw new Error("Terreno não encontrado");
  const polygon = terrain.polygon as unknown as LngLat[];
  if (!polygon || polygon.length < 3) throw new Error("Polígono inválido");

  const grid = gridSamples(polygon, GRID_N);
  const points: Array<[number, number]> = grid.samples.map((s) => [
    s.lng,
    s.lat,
  ]);

  const { elevations } = await fetchElevations(points, grid.bbox);
  const analysis = computeSlopeFromGrid(grid, elevations, polygon);

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
