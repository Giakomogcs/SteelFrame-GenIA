import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@sfg/db";
import { z } from "zod";

export const runtime = "nodejs";

const CreateBriefingSchema = z.object({
  terrainId: z.string().min(1),
  title: z.string().min(1).max(120).optional(),
});

// POST /api/briefings — creates a briefing WITHOUT materializing a Building
// or SitePlan (AC1: nothing 3D until step 6).
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = CreateBriefingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const terrain = await prisma.terrain.findUnique({
    where: { id: parsed.data.terrainId },
  });
  if (!terrain) {
    return NextResponse.json({ error: "Terreno não encontrado" }, { status: 404 });
  }

  const briefing = await prisma.briefing.create({
    data: {
      terrainId: terrain.id,
      title: parsed.data.title ?? `Briefing — ${terrain.name}`,
      status: "active",
      progress: 0,
      total: 6,
    },
  });

  return NextResponse.json({ briefing }, { status: 201 });
}

// GET /api/briefings?terrainId=…
export async function GET(req: NextRequest) {
  const terrainId = req.nextUrl.searchParams.get("terrainId");
  const where = terrainId ? { terrainId } : {};
  const briefings = await prisma.briefing.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      terrainId: true,
      title: true,
      status: true,
      progress: true,
      total: true,
      acceptedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ briefings });
}
