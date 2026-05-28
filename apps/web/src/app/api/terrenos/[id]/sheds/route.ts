import { NextResponse } from "next/server";
import { prisma } from "@sfg/db";
import { IndustrialShedSchema } from "@/lib/shedSchema";
import { normalizeRawShed } from "@/lib/shedValidation";
import { recomputeEstimate } from "@/lib/shedDefaults";

// POST /api/terrenos/[id]/sheds
// Body: { name: string, shed: IndustrialShed }
// Persiste como Building (params=shed, model=shed) — mantém compat com viewer.
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const name =
    typeof body.name === "string" && body.name.trim().length > 0
      ? body.name.trim()
      : "Galpão gerado por IA";

  const normalized = normalizeRawShed(body.shed);
  const parsed = IndustrialShedSchema.safeParse(normalized);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Shed inválido", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const terrain = await prisma.terrain.findUnique({ where: { id: params.id } });
  if (!terrain)
    return NextResponse.json(
      { error: "Terreno não encontrado" },
      { status: 404 },
    );

  const shed = recomputeEstimate(parsed.data);

  const created = await prisma.building.create({
    data: {
      terrainId: terrain.id,
      name,
      params: shed as unknown as object,
      model: shed as unknown as object,
    },
  });

  return NextResponse.json(created, { status: 201 });
}
