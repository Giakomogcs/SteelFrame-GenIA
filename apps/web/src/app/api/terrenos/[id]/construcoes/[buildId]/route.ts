import { NextResponse } from "next/server";
import { prisma } from "@sfg/db";
import { IndustrialShedSchema } from "@/lib/shedSchema";
import { recomputeEstimate } from "@/lib/shedDefaults";

// PATCH /api/terrenos/[id]/construcoes/[buildId]
// Atualiza o modelo paramétrico (usado pelo editor inline).
export async function PATCH(
  req: Request,
  { params }: { params: { id: string; buildId: string } },
) {
  const body = await req.json().catch(() => null);
  if (!body?.shed) {
    return NextResponse.json({ error: "Missing shed" }, { status: 400 });
  }
  const parsed = IndustrialShedSchema.safeParse(body.shed);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid shed", issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }
  const existing = await prisma.building.findFirst({
    where: { id: params.buildId, terrainId: params.id },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const recomputed = recomputeEstimate(parsed.data);
  await prisma.building.update({
    where: { id: existing.id },
    data: {
      model: recomputed as unknown as object,
      ...(body.name ? { name: String(body.name).slice(0, 120) } : {}),
    },
  });
  return NextResponse.json({ ok: true, shed: recomputed });
}

// DELETE /api/terrenos/[id]/construcoes/[buildId]
// Remove um galpão (Building) específico de um terreno.
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; buildId: string } },
) {
  const building = await prisma.building.findFirst({
    where: { id: params.buildId, terrainId: params.id },
    select: { id: true },
  });
  if (!building) {
    return NextResponse.json(
      { error: "Galpão não encontrado para este terreno" },
      { status: 404 },
    );
  }

  await prisma.building.delete({ where: { id: building.id } });
  return NextResponse.json({ ok: true });
}
