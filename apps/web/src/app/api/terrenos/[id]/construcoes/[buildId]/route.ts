import { NextResponse } from "next/server";
import { prisma } from "@sfg/db";

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
