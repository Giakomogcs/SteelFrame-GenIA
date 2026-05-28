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

  const activeBriefing = await prisma.briefing.findFirst({
    where: {
      terrainId: terrain.id,
      status: { in: ["active", "draft", "paused"] },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });

  const polygon = terrain.polygon as unknown as LngLat[];

  return (
    <BriefingClient
      terrainId={terrain.id}
      terrainName={terrain.name}
      terrainAddress={terrain.address}
      areaM2={terrain.areaM2}
      polygon={polygon}
      initialBriefingId={activeBriefing?.id ?? null}
    />
  );
}
