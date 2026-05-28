import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@sfg/db";

export const runtime = "nodejs";

// POST /api/briefings/:id/accept
// Materializes the briefing's latest SitePlan into a Report (versioned)
// and a Building marked viable. Implements FR-G4 / FR-R3.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const briefing = await prisma.briefing.findUnique({
    where: { id: params.id },
  });
  if (!briefing) {
    return NextResponse.json(
      { error: "Briefing não encontrado" },
      { status: 404 },
    );
  }

  const sitePlan = await prisma.sitePlan.findFirst({
    where: { briefingId: params.id },
    orderBy: { version: "desc" },
  });
  if (!sitePlan) {
    return NextResponse.json(
      {
        error:
          "Nenhum SitePlan persistido para este briefing — salve antes de aceitar.",
      },
      { status: 409 },
    );
  }

  const validations = sitePlan.validations as { ok?: boolean } | null;
  if (validations && validations.ok === false) {
    return NextResponse.json(
      {
        error: "SitePlan possui erros de validação — corrija antes de aceitar.",
      },
      { status: 422 },
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    // Supersede any previous accepted reports/buildings for this briefing.
    await tx.report.updateMany({
      where: { briefingId: params.id, status: "issued" },
      data: { status: "superseded" },
    });
    await tx.building.updateMany({
      where: { briefingId: params.id, status: "viable" },
      data: { status: "superseded" },
    });

    const previousReport = await tx.report.findFirst({
      where: { briefingId: params.id },
      orderBy: { version: "desc" },
    });
    const nextVersion = (previousReport?.version ?? 0) + 1;
    const code =
      previousReport?.code ?? `RPT-${briefing.id.slice(-6).toUpperCase()}`;

    const building = await tx.building.create({
      data: {
        terrainId: briefing.terrainId,
        name: briefing.title,
        params: { briefingId: briefing.id } as object,
        model: sitePlan.data as object,
        status: "viable",
        briefingId: briefing.id,
        sitePlanId: sitePlan.id,
        sitePlanHash: sitePlan.hash,
      },
    });

    const report = await tx.report.create({
      data: {
        terrainId: briefing.terrainId,
        buildingId: building.id,
        briefingId: briefing.id,
        code,
        version: nextVersion,
        status: "issued",
        verdict: "viable",
        blocks: {
          sitePlanId: sitePlan.id,
          sitePlanHash: sitePlan.hash,
          sitePlanVersion: sitePlan.version,
          validations: sitePlan.validations,
        } as object,
      },
    });

    await tx.briefing.update({
      where: { id: params.id },
      data: { status: "accepted", acceptedAt: new Date() },
    });

    return { building, report };
  });

  return NextResponse.json(result, { status: 201 });
}
