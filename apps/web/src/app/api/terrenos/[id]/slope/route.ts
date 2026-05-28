/**
 * POST /api/terrenos/[id]/slope
 *
 * Consulta a API pública open-elevation.com para N pontos amostrais
 * ao longo do polígono e computa inclinação, desnível, classificação,
 * recomendação de terraplenagem e volume de corte/aterro estimado.
 * Persiste os campos `slopePct`, `elevationMean`, `elevationDelta`,
 * `elevationProfile` no terreno.
 */
import { NextResponse } from "next/server";
import { prisma } from "@sfg/db";
import {
  diagonalSamples,
  haversineM,
  computeSlopeAnalysis,
  type LngLat,
  type ElevationSample,
} from "@/lib/geo";

interface ElevationApiResponse {
  results: { latitude: number; longitude: number; elevation: number }[];
}

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const terrain = await prisma.terrain.findUnique({ where: { id: params.id } });
  if (!terrain) {
    return NextResponse.json(
      { error: "Terreno não encontrado" },
      { status: 404 },
    );
  }
  const polygon = terrain.polygon as unknown as LngLat[];
  if (!polygon || polygon.length < 3) {
    return NextResponse.json({ error: "Polígono inválido" }, { status: 400 });
  }

  // 9 pontos ao longo da diagonal do bbox = boa cobertura sem estourar API.
  const samples = diagonalSamples(polygon, 9);
  const locations = samples.map(([lng, lat]) => `${lat},${lng}`).join("|");

  let api: ElevationApiResponse;
  try {
    const res = await fetch(
      `https://api.open-elevation.com/api/v1/lookup?locations=${locations}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) throw new Error(`open-elevation ${res.status}`);
    api = (await res.json()) as ElevationApiResponse;
  } catch (err) {
    return NextResponse.json(
      {
        error:
          "Não consegui obter altimetria agora (" +
          (err as Error).message +
          "). Tente novamente em alguns segundos.",
      },
      { status: 502 },
    );
  }

  // Reconstrói samples com distância acumulada
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

  return NextResponse.json({ ok: true, analysis });
}
