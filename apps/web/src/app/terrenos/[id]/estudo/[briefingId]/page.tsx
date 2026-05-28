import { notFound } from "next/navigation";
import { prisma } from "@sfg/db";
import StudyShell from "@/components/StudyShell";
import { hashSitePlan } from "@/lib/sitePlanHash";
import { SitePlanSchema, type SitePlan } from "@/lib/sitePlanSchema";

export const dynamic = "force-dynamic";

export default async function StudyPage({
  params,
}: {
  params: { id: string; briefingId: string };
}) {
  const briefing = await prisma.briefing.findUnique({
    where: { id: params.briefingId },
    include: { terrain: true },
  });
  if (!briefing || briefing.terrainId !== params.id) notFound();

  const sitePlanRow = await prisma.sitePlan.findFirst({
    where: { briefingId: briefing.id },
    orderBy: { version: "desc" },
  });
  if (!sitePlanRow) notFound();

  const parsed = SitePlanSchema.safeParse(sitePlanRow.data);
  if (!parsed.success) notFound();
  const site: SitePlan = parsed.data;
  const hash = sitePlanRow.hash || hashSitePlan(site);

  return (
    <StudyShell
      terrainId={briefing.terrainId}
      terrainName={briefing.terrain.name}
      briefingId={briefing.id}
      briefingTitle={briefing.title}
      initialSite={site}
      initialHash={hash}
      acceptedAt={briefing.acceptedAt?.toISOString() ?? null}
    />
  );
}
