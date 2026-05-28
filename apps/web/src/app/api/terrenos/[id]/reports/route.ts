import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@sfg/db";

export const runtime = "nodejs";

// GET /api/terrenos/:id/reports
// Returns reports grouped by briefing for the given terrain (FR-R1).
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const briefings = await prisma.briefing.findMany({
    where: { terrainId: params.id },
    orderBy: { createdAt: "desc" },
    include: {
      reports: { orderBy: { version: "desc" } },
    },
  });

  const orphanReports = await prisma.report.findMany({
    where: { terrainId: params.id, briefingId: null },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    groups: briefings.map((b) => ({
      briefingId: b.id,
      title: b.title,
      status: b.status,
      acceptedAt: b.acceptedAt,
      reports: b.reports,
    })),
    legacy: orphanReports,
  });
}
