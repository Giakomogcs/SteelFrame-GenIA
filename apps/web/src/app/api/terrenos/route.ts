import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@sfg/db";

const CreateTerrainSchema = z.object({
  name: z.string().min(1).max(120),
  address: z.string().max(255).optional().nullable(),
  polygon: z.array(z.tuple([z.number(), z.number()])).min(3),
  centerLng: z.number(),
  centerLat: z.number(),
  areaM2: z.number().nonnegative(),
});

export async function GET() {
  const data = await prisma.terrain.findMany({
    include: { buildings: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = CreateTerrainSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const created = await prisma.terrain.create({
    data: {
      name: parsed.data.name,
      address: parsed.data.address ?? null,
      polygon: parsed.data.polygon,
      centerLng: parsed.data.centerLng,
      centerLat: parsed.data.centerLat,
      areaM2: parsed.data.areaM2,
    },
  });
  return NextResponse.json(created, { status: 201 });
}
