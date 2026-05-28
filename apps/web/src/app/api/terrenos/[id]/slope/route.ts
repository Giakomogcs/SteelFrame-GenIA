/**
 * POST /api/terrenos/[id]/slope
 * Recalcula relevo via open-elevation e persiste no terreno.
 * A criação inicial do terreno já dispara essa medição automaticamente
 * em POST /api/terrenos.
 */
import { NextResponse } from "next/server";
import { measureAndPersistSlope } from "@/lib/slopeService";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const analysis = await measureAndPersistSlope(params.id);
    return NextResponse.json({ ok: true, analysis });
  } catch (err) {
    const msg = (err as Error).message;
    const status =
      msg.includes("não encontrado") ? 404 : msg.includes("inválido") ? 400 : 502;
    return NextResponse.json(
      {
        error:
          status === 502
            ? `Não consegui obter altimetria agora (${msg}). Tente novamente em alguns segundos.`
            : msg,
      },
      { status },
    );
  }
}
