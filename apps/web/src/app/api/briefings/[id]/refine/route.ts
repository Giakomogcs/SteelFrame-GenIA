import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@sfg/db";
import { z } from "zod";
import { SitePlanSchema } from "@/lib/sitePlanSchema";
import { validateSitePlan } from "@/lib/siteConstraints";
import { hashSitePlan } from "@/lib/sitePlanHash";

export const runtime = "nodejs";

// POST /api/briefings/:id/refine
// Body: { message: string, baseHash?: string, patch?: Partial<SitePlan> }
//
// V1 (PRD Open Question 1): request/response síncrono, sem SSE. O cliente
// envia `patch` opcional já calculado (a UI gera o patch determinístico a
// partir da edição manual / chat); o servidor aplica sobre o SitePlan
// vigente e devolve o próximo plano validado, sem persistir. A persistência
// fica para `/site-plan` (POST).
const RefineSchema = z.object({
  message: z.string().min(1).max(2000),
  baseHash: z.string().optional(),
  patch: z.record(z.unknown()).optional(),
});

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
  const parsed = RefineSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const briefing = await prisma.briefing.findUnique({
    where: { id: params.id },
  });
  if (!briefing) {
    return NextResponse.json(
      { error: "Briefing não encontrado" },
      { status: 404 },
    );
  }

  const latest = await prisma.sitePlan.findFirst({
    where: { briefingId: params.id },
    orderBy: { version: "desc" },
  });
  if (!latest) {
    return NextResponse.json(
      { error: "Nenhum SitePlan persistido ainda para este briefing." },
      { status: 409 },
    );
  }

  if (parsed.data.baseHash && parsed.data.baseHash !== latest.hash) {
    return NextResponse.json(
      {
        error: "Conflito otimista — o SitePlan foi atualizado por outro autor.",
        currentHash: latest.hash,
      },
      { status: 409 },
    );
  }

  // Merge patch shallowly (top-level keys). The full SitePlanSchema parse
  // below catches any structural error.
  const base = latest.data as Record<string, unknown>;
  const merged = { ...base, ...(parsed.data.patch ?? {}) };
  const reparsed = SitePlanSchema.safeParse(merged);
  if (!reparsed.success) {
    return NextResponse.json(
      {
        error: "Patch resulta em SitePlan inválido.",
        issues: reparsed.error.issues,
      },
      { status: 422 },
    );
  }

  const validation = validateSitePlan(reparsed.data);
  const proposed = { ...reparsed.data, validations: validation };
  const nextHash = hashSitePlan(proposed);

  return NextResponse.json({
    proposedSitePlan: proposed,
    proposedHash: nextHash,
    baseHash: latest.hash,
    validations: validation,
    message: parsed.data.message,
  });
}
