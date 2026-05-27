import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@sfg/db";
import type { WizardParams } from "@/lib/steelframe";
import {
  azureChatCompletion,
  isAzureAIConfigured,
  AzureAIError,
} from "@/lib/azureAI";

const Body = z.object({
  terrainId: z.string(),
  current: z
    .object({
      material: z.string().optional(),
      budget: z.number().optional(),
      occupancyRate: z.number().optional(),
      height: z.number().optional(),
      bayDepth: z.number().optional(),
      roofPitchDeg: z.number().optional(),
      doors: z.number().optional(),
      mezzanine: z.boolean().optional(),
    })
    .partial(),
});

/**
 * Sugere parâmetros do wizard com base no terreno.
 * - Se Azure AI estiver configurado, usa AZURE_AI_MODEL.
 * - Caso contrário, retorna heurística determinística.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const terrain = await prisma.terrain.findUnique({
    where: { id: parsed.data.terrainId },
  });
  if (!terrain) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const area = terrain.areaM2;
  const fallback: Partial<WizardParams> = heuristic(area);

  if (!isAzureAIConfigured()) {
    return NextResponse.json({ ...fallback, _source: "heuristic" });
  }

  const prompt = `Você é um engenheiro estrutural e arquiteto especialista em galpões steel frame logísticos/industriais no Brasil.
Sugira parâmetros realistas em JSON para um galpão dentro de um terreno de ${area.toFixed(0)} m².
Considere boas práticas: pé direito 8-12m para logístico; vãos de pórtico 5-8m; telhado 8-15°; taxa de ocupação 0.6-0.85.
Valores atuais do usuário (use como dica, pode ajustar): ${JSON.stringify(parsed.data.current)}.
Responda APENAS com um JSON contendo EXATAMENTE as chaves:
material ("steel-frame-light"|"steel-frame-heavy"|"hybrid"),
budget (BRL inteiro),
occupancyRate (0..1),
height (m),
bayDepth (m),
roofPitchDeg (graus),
doors (int),
mezzanine (bool).`;

  try {
    const { content } = await azureChatCompletion({
      messages: [
        { role: "system", content: "Responda apenas com JSON válido, sem markdown." },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
      jsonObject: true,
    });

    const json = extractJson(content) as Partial<WizardParams>;
    return NextResponse.json({
      ...fallback,
      ...json,
      _source: `azure:${process.env.AZURE_AI_MODEL ?? "default"}`,
    });
  } catch (e) {
    if (e instanceof AzureAIError) {
      console.error("Azure AI error:", e.status, e.body);
    } else {
      console.error("Azure AI unexpected error:", e);
    }
    return NextResponse.json({ ...fallback, _source: "heuristic-fallback" });
  }
}

function extractJson(text: string): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return {};
      }
    }
    return {};
  }
}

function heuristic(areaM2: number): Partial<WizardParams> {
  const isLarge = areaM2 > 5000;
  const isHuge = areaM2 > 20000;
  return {
    material: isHuge ? "steel-frame-heavy" : "steel-frame-light",
    budget: Math.round(areaM2 * (isHuge ? 2200 : 1900)),
    occupancyRate: isLarge ? 0.75 : 0.65,
    height: isHuge ? 11 : isLarge ? 9 : 7,
    bayDepth: isHuge ? 8 : 6,
    roofPitchDeg: 10,
    doors: isHuge ? 4 : isLarge ? 3 : 2,
    mezzanine: !isHuge,
  };
}
