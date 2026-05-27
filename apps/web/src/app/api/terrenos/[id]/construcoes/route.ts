import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@sfg/db";
import { generateSteelFrameModel } from "@/lib/steelframe";
import type { LngLat } from "@/lib/geo";

const ParamsSchema = z.object({
  material: z.enum(["steel-frame-light", "steel-frame-heavy", "hybrid"]),
  budget: z.number().positive(),
  occupancyRate: z.number().min(0.1).max(1),
  height: z.number().min(3).max(25),
  bayDepth: z.number().min(2).max(15),
  roofPitchDeg: z.number().min(1).max(45),
  doors: z.number().int().min(0).max(20),
  mezzanine: z.boolean(),
});

const Body = z.object({
  name: z.string().min(1).max(120),
  params: ParamsSchema,
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json();
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const terrain = await prisma.terrain.findUnique({ where: { id: params.id } });
  if (!terrain) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const polygon = terrain.polygon as unknown as LngLat[];
  const model = generateSteelFrameModel(polygon, parsed.data.params);

  const created = await prisma.building.create({
    data: {
      terrainId: terrain.id,
      name: parsed.data.name,
      params: parsed.data.params,
      model: model as unknown as object,
    },
  });

  return NextResponse.json(created, { status: 201 });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const list = await prisma.building.findMany({
    where: { terrainId: params.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(list);
}
