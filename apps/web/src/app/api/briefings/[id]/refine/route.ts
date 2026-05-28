import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@sfg/db";
import { z } from "zod";
import { SitePlanSchema } from "@/lib/sitePlanSchema";
import { validateSitePlan } from "@/lib/siteConstraints";
import { hashSitePlan } from "@/lib/sitePlanHash";
import { applyRefineIntent } from "@/lib/refineIntent";

export const runtime = "nodejs";

// POST /api/briefings/:id/refine
// Body: { message: string, baseHash?: string, patch?: Partial<SitePlan> }
//
// Quando `patch` é informado, fazemos um merge raso sobre o SitePlan vigente
// (mesmo comportamento antigo). Caso contrário, tentamos interpretar a
// `message` em português via `applyRefineIntent` para gerar a proposta.
// A persistência continua sendo feita pelo `/site-plan` (POST) — este
// endpoint só devolve a proposta.
const RefineSchema = z.object({
  message: z.string().min(1).max(2000),
  baseHash: z.string().optional(),
  patch: z.record(z.unknown()).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = RefineSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const briefing = await prisma.briefing.findUnique({
    where: { id: params.id },
  });
  if (!briefing) {
    return NextResponse.json(
      { error: "Briefing não encontrado" },
      { status: 404 },
    );
  }

  const latest = await prisma.sitePlan.findFirst({
    where: { briefingId: params.id },
    orderBy: { version: "desc" },
  });
  if (!latest) {
    return NextResponse.json(
      { error: "Nenhum SitePlan persistido ainda para este briefing." },
      { status: 409 },
    );
  }

  if (parsed.data.baseHash && parsed.data.baseHash !== latest.hash) {
    return NextResponse.json(
      {
        error: "Conflito otimista — o SitePlan foi atualizado por outro autor.",
        currentHash: latest.hash,
      },
      { status: 409 },
    );
  }

  // Merge patch shallowly (top-level keys). The full SitePlanSchema parse
  // below catches any structural error.
  const base = latest.data as Record<string, unknown>;
  let candidate: Record<string, unknown>;
  let intentSummary: string | null = null;
  if (parsed.data.patch && Object.keys(parsed.data.patch).length > 0) {
    candidate = { ...base, ...parsed.data.patch };
  } else {
    // Sem patch explícito — tenta interpretar a mensagem em PT-BR.
    const parsedBase = SitePlanSchema.safeParse(base);
    if (!parsedBase.success) {
      return NextResponse.json(
        {
          error: "SitePlan persistido inválido — não consigo refinar.",
          issues: parsedBase.error.issues,
        },
        { status: 422 },
      );
    }
    const outcome = applyRefineIntent(parsedBase.data, parsed.data.message);
    if (outcome) {
      candidate = outcome.next as unknown as Record<string, unknown>;
      intentSummary = outcome.summary;
    } else {
      return NextResponse.json(
        {
          error:
            "Não entendi a instrução. Tente algo como “adicione 2 galpões”, “remova o galpão 1”, “recuo frente 8 m” ou “aumente o galpão 1 para 3000 m²”.",
        },
        { status: 422 },
      );
    }
  }
  const reparsed = SitePlanSchema.safeParse(candidate);
  if (!reparsed.success) {
    return NextResponse.json(
      {
        error: "Patch resulta em SitePlan inválido.",
        issues: reparsed.error.issues,
      },
      { status: 422 },
    );
  }

  const validation = validateSitePlan(reparsed.data);
  const proposed = { ...reparsed.data, validations: validation };
  const nextHash = hashSitePlan(proposed);

  return NextResponse.json({
    proposedSitePlan: proposed,
    proposedHash: nextHash,
    baseHash: latest.hash,
    validations: validation,
    message: parsed.data.message,
    summary: intentSummary,
  });
}
