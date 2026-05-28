import { notFound } from "next/navigation";
import { prisma } from "@sfg/db";
import type { LngLat } from "@/lib/geo";
import BriefingClient from "./BriefingClient";

export const dynamic = "force-dynamic";

export default async function BriefingPage({
  params,
}: {
  params: { id: string };
}) {
  const terrain = await prisma.terrain.findUnique({ where: { id: params.id } });
  if (!terrain) notFound();

  const polygon = terrain.polygon as unknown as LngLat[];

  return (
    <BriefingClient
      terrainId={terrain.id}
      terrainName={terrain.name}
      terrainAddress={terrain.address}
      areaM2={terrain.areaM2}
      polygon={polygon}
    />
  );
}
