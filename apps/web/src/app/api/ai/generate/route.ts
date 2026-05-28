import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@sfg/db";
import { promptToShedStream } from "@/lib/shedPromptToProject";
import { generateFallbackShed, recomputeEstimate } from "@/lib/shedDefaults";
import type { IndustrialShed } from "@/lib/shedSchema";

export const runtime = "nodejs";

// POST /api/ai/generate
// Body: { prompt: string, terrainId?: string, use?, standard? }
// Resposta: SSE com eventos `thinking | content | result | error`
//           (ou JSON puro se ?fallback=1)
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length === 0) {
    return NextResponse.json(
      { error: "Campo 'prompt' é obrigatório." },
      { status: 400 },
    );
  }
  if (prompt.length > 4000) {
    return NextResponse.json(
      { error: "Prompt muito longo (>4000 caracteres)." },
      { status: 400 },
    );
  }

  const terrainId = typeof body.terrainId === "string" ? body.terrainId : null;
  const use = body.use as IndustrialShed["use"] | undefined;
  const standard = body.standard as IndustrialShed["standard"] | undefined;

  // FR-G1 (PRD §10.2): 3D generation only at the final wizard step. We
  // require both `briefingId` and `step === 6` in the request, and refuse
  // earlier calls with 422. The legacy non-briefing flow (e.g. /briefings
  // landing page demo) is still allowed for backwards compatibility only
  // when neither `briefingId` nor `step` is supplied.
  const briefingId =
    typeof body.briefingId === "string" ? body.briefingId : null;
  const step = typeof body.step === "number" ? body.step : null;
  if (briefingId !== null || step !== null) {
    if (!briefingId) {
      return NextResponse.json(
        { error: "Briefing obrigatório quando 'step' for informado." },
        { status: 422 },
      );
    }
    if (step !== 6) {
      return NextResponse.json(
        {
          error: "Geração 3D só é permitida no passo 6 do wizard (FR-G1).",
          step,
        },
        { status: 422 },
      );
    }
    const briefing = await prisma.briefing.findUnique({
      where: { id: briefingId },
    });
    if (!briefing) {
      return NextResponse.json(
        { error: "Briefing não encontrado." },
        { status: 404 },
      );
    }
  }

  let terrainContext:
    | {
        areaM2: number;
        address?: string;
        centerLat?: number;
        centerLng?: number;
        slopePct?: number;
        uf?: string;
        city?: string;
        zoneamento?: string;
      }
    | undefined;

  if (terrainId) {
    const terrain = await prisma.terrain.findUnique({
      where: { id: terrainId },
    });
    if (terrain) {
      terrainContext = {
        areaM2: terrain.areaM2,
        address: terrain.address ?? undefined,
        centerLat: terrain.centerLat,
        centerLng: terrain.centerLng,
        slopePct: terrain.slopePct ?? undefined,
        uf: terrain.state ?? undefined,
        city: terrain.city ?? undefined,
        zoneamento: terrain.zoneamento ?? undefined,
      };
    }
  }

  const forceFallback =
    new URL(req.url).searchParams.get("fallback") === "1" ||
    !process.env.AZURE_AI_API_KEY;

  if (forceFallback) {
    const shed = recomputeEstimate(
      generateFallbackShed({
        areaM2: terrainContext?.areaM2,
        standard,
        use,
      }),
    );
    return NextResponse.json({
      shed,
      source: "fallback",
      error: process.env.AZURE_AI_API_KEY
        ? "Fallback forçado por query string."
        : "AZURE_AI_API_KEY não configurada — usando fallback determinístico.",
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of promptToShedStream({
          prompt,
          terrainContext,
          use,
          standard,
        })) {
          const line = `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
          controller.enqueue(encoder.encode(line));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Erro interno";
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`,
          ),
        );
        const fallback = {
          shed: recomputeEstimate(
            generateFallbackShed({
              areaM2: terrainContext?.areaM2,
              standard,
              use,
            }),
          ),
          source: "fallback" as const,
          error: `Erro no stream: ${msg}. Usando fallback.`,
        };
        controller.enqueue(
          encoder.encode(
            `event: result\ndata: ${JSON.stringify(fallback)}\n\n`,
          ),
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
