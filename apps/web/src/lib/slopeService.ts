/**
 * Serviço de medição de relevo.
 * Consulta open-elevation.com para N pontos amostrais do polígono,
 * computa a análise de slope e persiste no terreno.
 * Reutilizado por POST /api/terrenos (auto, ao criar) e
 * POST /api/terrenos/[id]/slope (recálculo manual).
 */
import { prisma } from "@sfg/db";
import {
  diagonalSamples,
  haversineM,
  computeSlopeAnalysis,
  type LngLat,
  type ElevationSample,
  type SlopeAnalysis,
} from "@/lib/geo";

interface ElevationApiResponse {
  results: { latitude: number; longitude: number; elevation: number }[];
}

export async function measureAndPersistSlope(
  terrainId: string,
): Promise<SlopeAnalysis> {
  const terrain = await prisma.terrain.findUnique({ where: { id: terrainId } });
  if (!terrain) throw new Error("Terreno não encontrado");
  const polygon = terrain.polygon as unknown as LngLat[];
  if (!polygon || polygon.length < 3) throw new Error("Polígono inválido");

  const samples = diagonalSamples(polygon, 9);
  const locations = samples.map(([lng, lat]) => `${lat},${lng}`).join("|");

  const res = await fetch(
    `https://api.open-elevation.com/api/v1/lookup?locations=${locations}`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok) throw new Error(`open-elevation ${res.status}`);
  const api = (await res.json()) as ElevationApiResponse;

  const enriched: ElevationSample[] = [];
  let acc = 0;
  for (let i = 0; i < samples.length; i++) {
    if (i > 0) acc += haversineM(samples[i - 1], samples[i]);
    enriched.push({
      d: acc,
      h: api.results[i]?.elevation ?? 0,
      lat: samples[i][1],
      lng: samples[i][0],
    });
  }

  const analysis = computeSlopeAnalysis(enriched, terrain.areaM2);

  await prisma.terrain.update({
    where: { id: terrain.id },
    data: {
      slopePct: analysis.slopePct,
      elevationMean: analysis.elevationMean,
      elevationDelta: analysis.elevationDelta,
      elevationProfile: analysis.profile,
    },
  });

  return analysis;
}
