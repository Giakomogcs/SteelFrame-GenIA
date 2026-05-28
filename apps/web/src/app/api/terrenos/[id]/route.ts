import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@sfg/db";

const UpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  address: z.string().max(255).optional().nullable(),
  polygon: z
    .array(z.tuple([z.number(), z.number()]))
    .min(3)
    .optional(),
  centerLng: z.number().optional(),
  centerLat: z.number().optional(),
  areaM2: z.number().nonnegative().optional(),
  state: z.string().length(2).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  district: z.string().max(120).optional().nullable(),
  addressStreet: z.string().max(255).optional().nullable(),
  addressNumber: z.string().max(20).optional().nullable(),
  cep: z.string().max(20).optional().nullable(),
});

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const data = await prisma.terrain.findUnique({
    where: { id: params.id },
    include: { buildings: true },
  });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const body = await req.json();
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = { ...parsed.data };
  if (data.state) data.state = data.state.toUpperCase();
  const updated = await prisma.terrain.update({
    where: { id: params.id },
    data,
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  await prisma.terrain.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
