import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@sfg/db";
import { SitePlanSchema } from "@/lib/sitePlanSchema";
import { validateSitePlan } from "@/lib/siteConstraints";
import { hashSitePlan } from "@/lib/sitePlanHash";

export const runtime = "nodejs";

// GET /api/terrenos/:id/site-plan?briefingId=…&latest=1
// Returns the latest SitePlan for the (terrain, briefing) pair, or all
// versions when `latest` is omitted.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const briefingId = req.nextUrl.searchParams.get("briefingId");
  const latest = req.nextUrl.searchParams.get("latest");

  const where: { terrainId: string; briefingId?: string } = {
    terrainId: params.id,
  };
  if (briefingId) where.briefingId = briefingId;

  if (latest === "1") {
    const plan = await prisma.sitePlan.findFirst({
      where,
      orderBy: { version: "desc" },
    });
    return NextResponse.json({ sitePlan: plan });
  }

  const plans = await prisma.sitePlan.findMany({
    where,
    orderBy: { version: "desc" },
  });
  return NextResponse.json({ sitePlans: plans });
}

// POST /api/terrenos/:id/site-plan
// Body: { briefingId?: string, data: SitePlan }
// Validates with Zod + validateSitePlan and persists a new version. Errors
// in the validation report respond 422 — we do not store an invalid plan
// (PRD §6: salvar é bloqueado se errors.length > 0).
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const rec = body as { briefingId?: string; data?: unknown };
  const parsed = SitePlanSchema.safeParse(rec.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "SitePlan inválido (schema).", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const site = parsed.data;
  if (site.terrainId !== params.id) {
    return NextResponse.json(
      { error: "terrainId do SitePlan não bate com a rota." },
      { status: 400 },
    );
  }

  const terrain = await prisma.terrain.findUnique({ where: { id: params.id } });
  if (!terrain) {
    return NextResponse.json(
      { error: "Terreno não encontrado" },
      { status: 404 },
    );
  }
  if (rec.briefingId) {
    const briefing = await prisma.briefing.findUnique({
      where: { id: rec.briefingId },
    });
    if (!briefing || briefing.terrainId !== params.id) {
      return NextResponse.json(
        { error: "Briefing inválido para este terreno." },
        { status: 400 },
      );
    }
  }

  const report = validateSitePlan(site);
  if (!report.ok) {
    return NextResponse.json(
      {
        error: "SitePlan inválido (validações geométricas).",
        validations: report,
      },
      { status: 422 },
    );
  }

  // Stamp the validation report and hash, increment version per briefing/terrain.
  const stamped = { ...site, validations: report };
  const hash = hashSitePlan(stamped);
  const last = await prisma.sitePlan.findFirst({
    where: { terrainId: params.id, briefingId: rec.briefingId ?? null },
    orderBy: { version: "desc" },
  });
  const nextVersion = (last?.version ?? 0) + 1;

  const created = await prisma.sitePlan.create({
    data: {
      terrainId: params.id,
      briefingId: rec.briefingId ?? null,
      version: nextVersion,
      data: stamped as object,
      validations: report as object,
      hash,
    },
  });

  return NextResponse.json({ sitePlan: created }, { status: 201 });
}
