import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@sfg/db";
import { z } from "zod";

export const runtime = "nodejs";

const PatchBriefingSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  status: z
    .enum([
      "draft",
      "active",
      "paused",
      "ready_to_generate",
      "generating",
      "preview",
      "refining",
      "accepted",
      "complete",
      "cancelled",
    ])
    .optional(),
  progress: z.number().int().min(0).max(6).optional(),
  total: z.number().int().min(1).max(20).optional(),
  assumptions: z.array(z.unknown()).optional(),
  messages: z.array(z.unknown()).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const briefing = await prisma.briefing.findUnique({
    where: { id: params.id },
    include: {
      sitePlans: { orderBy: { version: "desc" }, take: 1 },
    },
  });
  if (!briefing) {
    return NextResponse.json(
      { error: "Briefing não encontrado" },
      { status: 404 },
    );
  }
  return NextResponse.json({ briefing });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = PatchBriefingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const existing = await prisma.briefing.findUnique({
    where: { id: params.id },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "Briefing não encontrado" },
      { status: 404 },
    );
  }

  const updated = await prisma.briefing.update({
    where: { id: params.id },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.status !== undefined
        ? { status: parsed.data.status }
        : {}),
      ...(parsed.data.progress !== undefined
        ? { progress: parsed.data.progress }
        : {}),
      ...(parsed.data.total !== undefined ? { total: parsed.data.total } : {}),
      ...(parsed.data.assumptions !== undefined
        ? { assumptions: parsed.data.assumptions as object }
        : {}),
      ...(parsed.data.messages !== undefined
        ? { messages: parsed.data.messages as object }
        : {}),
    },
  });
  return NextResponse.json({ briefing: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const existing = await prisma.briefing.findUnique({
    where: { id: params.id },
  });
  if (!existing) {
    return NextResponse.json(
      { error: "Briefing não encontrado" },
      { status: 404 },
    );
  }
  await prisma.briefing.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
