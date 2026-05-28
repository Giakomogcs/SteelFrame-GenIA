// Pipeline IA: prompt PT-BR → IndustrialShed JSON validado.
// Usa Azure AI Foundry (chat completions com response_format=json_object + stream).
import { IndustrialShedSchema, type IndustrialShed } from "./shedSchema";
import { normalizeRawShed, findShedValidationErrors } from "./shedValidation";
import {
  generateFallbackShed,
  recomputeEstimate,
  type FallbackContext,
} from "./shedDefaults";

const MAX_RETRIES = 3;

export const SHED_SYSTEM_PROMPT = `Você é um agente de pré-projeto especializado em galpões logísticos e industriais em Steel Frame / pórticos de aço no Brasil.
Converta o briefing do usuário em UM ÚNICO JSON VÁLIDO conforme o schema "IndustrialShed".

REGRAS RÍGIDAS:
- Responda APENAS com JSON válido (sem markdown, sem comentários, sem prosa).
- Foco: galpões LOGÍSTICOS, INDUSTRIAIS, CD, cross-dock, cold storage e manufatura.
- Todas as dimensões em METROS.
- "schemaVersion" deve ser exatamente "shed-1".
- footprint deve caber no lote depois dos recuos (lot - 2*setbacks.sides ≥ footprint.width; lot.depth - setbacks.front - setbacks.back ≥ footprint.depth).
- structure.bayCount × structure.baySpacing ≈ footprint.depth (tolerância ≤ 10%).
- structure.freeSpan ≤ footprint.width.
- Vão livre típico 12–30m; pé-direito útil 8–14m para logística moderna; 6–9m industrial leve.
- Inclinação telhado: 8–15% para telha metálica/termoacústica; 2–5% para sandwich PIR.
- zones devem ter coordenadas x,z em [0..footprint.width] × [0..footprint.depth] e NÃO podem se sobrepor.
- Para uso logístico/cross_dock inclua DOCAS (mínimo 1, geralmente na parede norte ou sul).
- Skylight (% iluminação zenital) entre 3% e 8%.
- Carga de piso: logística leve 30 kN/m²; porta-paletes 50–80 kN/m²; manufatura pesada 80–150 kN/m².
- AVCB (NBR 9077): exigido para área > 750m². Rota máxima 30–40m.
- Aberturas: xAlongWall em metros a partir da extremidade esquerda da parede; xAlongWall + width ≤ comprimento da parede (footprint.width para north/south, footprint.depth para east/west).
- Inclua portão_seccional (>5×4m) para movimentação de carga; porta_pessoal junto ao escritório; porta_corta_fogo para saídas de emergência.
- Inclua "assumptions" listando premissas adotadas e "confidence" entre 0 e 1.
- Considere as normas: NBR 16970 (Steel Framing), 15575 (desempenho), 6120 (cargas), 6123 (vento), 8800/14762 (aço), 5410 (elétrica), 5626 (hidráulica), 9077 (saídas).
- Custos referenciam SINAPI e CUB Sinduscon-SP.

SCHEMA RESUMIDO (campos obrigatórios em negrito conceitual):
{
  "schemaVersion": "shed-1",
  "use": "logistics"|"industrial"|"distribution_center"|"cold_storage"|"cross_dock"|"manufacturing",
  "standard": "economico"|"medio"|"alto",
  "lot": { "width": number, "depth": number, "slopePct": number },
  "setbacks": { "front": number, "sides": number, "back": number },
  "footprint": { "width": number, "depth": number },
  "structure": {
    "system": "steel_frame_light"|"porticos_aco"|"trelicado",
    "bayCount": int, "baySpacing": number, "freeSpan": number, "clearHeight": number,
    "columnProfile": string, "roofStructure": "tesoura"|"trelica"|"viga_alma_cheia"
  },
  "roof": { "type": "gable"|"shed"|"sawtooth"|"arch"|"flat", "slopePct": number,
            "overhang": number, "cover": "telha_metalica"|"telha_termoacustica"|"sandwich_PIR"|"fibrocimento",
            "skylightPct": number, "gutters": boolean },
  "envelope": { "walls": "telha_lateral"|"alvenaria_baixa_telha"|"sandwich"|"ACM"|"concreto_pre_moldado",
                "insulation": "nenhum"|"basico"|"intermediario"|"alto_desempenho",
                "wallBaseHeight": number },
  "zones": [{ "name": string, "type": "armazenagem"|"picking"|"expedicao"|"recebimento"
              |"escritorio"|"vestiario"|"refeitorio"|"area_tecnica"|"avcb_hidrante"|"producao",
              "x": number, "z": number, "width": number, "depth": number, "height": number,
              "floorLoad_kN_m2": number }],
  "docks": [{ "x": number, "z": number, "wall": "north"|"south"|"east"|"west",
              "type": "nivelada"|"elevada"|"rebaixada", "levelers": boolean, "seal": boolean }],
  "mezzanine": { "x": number, "z": number, "width": number, "depth": number,
                 "height": number, "load_kN_m2": number } | null,
  "craneRails": [{ "capacity_t": number, "span": number, "height": number }],
  "openings": [{ "type": "portao_seccional"|"portao_enrolar"|"porta_pessoal"
                 |"porta_corta_fogo"|"janela_alta"|"exaustor_eolico"|"lanternim",
                 "wall": "north"|"south"|"east"|"west",
                 "xAlongWall": number, "width": number, "height": number, "elevation": number }],
  "floor": { "type": "industrial_polido"|"concreto_armado"|"epoxi_antiderrapante"|"intertravado",
             "load_kN_m2": number, "thickness_cm": number },
  "utilities": { "power_kVA": number, "water": boolean, "sewage": boolean,
                 "compressedAir": boolean, "firePump": boolean, "sprinklers": boolean,
                 "hydrants": int },
  "safety": { "occupancyClass": string, "fireLoad_MJ_m2": number,
              "exitsCount": int, "exitsWidthTotal": number,
              "maxTravelDistance_m": number, "avcbRequired": boolean },
  "yard": { "truckCircle_m": number, "parkingCars": int, "parkingTrucks": int,
            "retentionPond": boolean },
  "perimeter": { "fenceHeight": number, "fenceType": "muro"|"alambrado"|"concertina"|"concreto_pre_moldado",
                 "gate": boolean, "guardhouse": boolean },
  "compliance": { "norms": string[], "costSources": string[] },
  "estimate": { "costPerM2": number, "totalCost": number, "steelKg": number, "coveredAreaM2": number },
  "assumptions": string[],
  "confidence": number (0..1)
}`;

export interface ShedGenerateResult {
  shed: IndustrialShed;
  source: "ai" | "fallback";
  error?: string;
  attempts?: number;
  validationErrors?: string[];
}

export type ShedSSEEvent =
  | { event: "thinking"; data: { content: string } }
  | { event: "content"; data: { content: string } }
  | { event: "result"; data: ShedGenerateResult }
  | { event: "error"; data: { error: string } };

function getAzureConfig() {
  const endpoint = process.env.AZURE_AI_ENDPOINT?.replace(/\/+$/, "");
  const apiKey = process.env.AZURE_AI_API_KEY;
  const model = process.env.AZURE_AI_MODEL || "gpt-5.4-mini";
  const apiVersion = process.env.AZURE_AI_API_VERSION || "2024-05-01-preview";
  return { endpoint, apiKey, model, apiVersion };
}

function buildUrl() {
  const { endpoint, apiVersion } = getAzureConfig();
  return `${endpoint}/models/chat/completions?api-version=${apiVersion}`;
}

interface StreamChunk {
  type: "thinking" | "content" | "done";
  text?: string;
  content?: string;
}

async function* azureStream(
  messages: Array<{ role: string; content: string }>,
): AsyncGenerator<StreamChunk> {
  const { endpoint, apiKey, model } = getAzureConfig();
  if (!endpoint || !apiKey) throw new Error("Azure AI não configurado");

  const res = await fetch(buildUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      response_format: { type: "json_object" },
      stream: true,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Azure AI ${res.status}: ${txt.slice(0, 400)}`);
  }
  if (!res.body) throw new Error("Resposta sem body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue;
      if (trimmed === "data: [DONE]") continue;
      if (!trimmed.startsWith("data: ")) continue;

      try {
        const chunk = JSON.parse(trimmed.slice(6));
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        const thinking =
          delta.reasoning_content ??
          delta.reasoning ??
          delta.thinking_content ??
          delta.thinking;
        if (thinking) yield { type: "thinking", text: String(thinking) };
        if (delta.content) {
          content += delta.content;
          yield { type: "content", text: delta.content };
        }
      } catch {
        // ignora linhas malformadas
      }
    }
  }

  yield { type: "done", content };
}

export interface ShedPromptOptions extends FallbackContext {
  /** Prompt livre do usuário (briefing). */
  prompt: string;
  /** Contexto do terreno persistido (área, endereço, polígono resumido). */
  terrainContext?: {
    areaM2: number;
    address?: string;
    centerLat?: number;
    centerLng?: number;
    slopePct?: number;
  };
}

function buildUserMessage(opts: ShedPromptOptions): string {
  const ctx = opts.terrainContext;
  const parts: string[] = [];
  if (ctx) {
    parts.push(
      `CONTEXTO DO TERRENO: área ≈ ${ctx.areaM2.toFixed(0)} m² | endereço: ${ctx.address ?? "não informado"} | inclinação: ${ctx.slopePct ?? 0}%`,
    );
    if (typeof ctx.centerLat === "number" && typeof ctx.centerLng === "number") {
      parts.push(
        `Coordenadas: ${ctx.centerLat.toFixed(5)}, ${ctx.centerLng.toFixed(5)}`,
      );
    }
  }
  parts.push("BRIEFING DO USUÁRIO:\n" + opts.prompt);
  parts.push(
    "Gere o JSON conforme o schema. Lembre: docas + AVCB + pé-direito coerente com o uso.",
  );
  return parts.join("\n\n");
}

async function tryParse(content: string): Promise<
  | { ok: true; shed: IndustrialShed }
  | { ok: false; errors: string[]; raw: unknown }
> {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (err) {
    return {
      ok: false,
      errors: [
        `JSON inválido: ${(err as Error).message}`,
      ],
      raw: null,
    };
  }
  const normalized = normalizeRawShed(raw);
  const parsed = IndustrialShedSchema.safeParse(normalized);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join(".")}: ${i.message}`),
      raw: normalized,
    };
  }
  const validation = findShedValidationErrors(parsed.data);
  if (validation.length > 0) {
    return { ok: false, errors: validation, raw: parsed.data };
  }
  return { ok: true, shed: recomputeEstimate(parsed.data) };
}

const CORRECTION_PROMPT = (errors: string[], json: string) =>
  `O JSON anterior tem problemas. Corrija APENAS o necessário para passar nas validações, sem mudar a intenção do briefing.

ERROS:
${errors.map((e) => `- ${e}`).join("\n")}

JSON ANTERIOR:
${json}

Responda APENAS com o JSON corrigido completo (schemaVersion "shed-1").`;

export async function* promptToShedStream(
  opts: ShedPromptOptions,
): AsyncGenerator<ShedSSEEvent> {
  const { endpoint, apiKey } = getAzureConfig();
  if (!endpoint || !apiKey) {
    yield {
      event: "result",
      data: {
        shed: recomputeEstimate(
          generateFallbackShed({
            areaM2: opts.terrainContext?.areaM2,
            standard: opts.standard,
            use: opts.use,
          }),
        ),
        source: "fallback",
        error: "Azure AI não configurado. Usando fallback determinístico.",
      },
    };
    return;
  }

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: SHED_SYSTEM_PROMPT },
    { role: "user", content: buildUserMessage(opts) },
  ];

  let attempt = 0;
  let lastErrors: string[] = [];
  let lastJson = "";

  try {
    while (attempt <= MAX_RETRIES) {
      attempt++;
      if (attempt > 1) {
        yield {
          event: "thinking",
          data: {
            content: `\n--- Tentativa ${attempt}/${MAX_RETRIES + 1}: corrigindo (${lastErrors.length} erro(s)) ---\n`,
          },
        };
      }

      let content = "";
      for await (const chunk of azureStream(messages)) {
        if (chunk.type === "thinking" && chunk.text) {
          yield { event: "thinking", data: { content: chunk.text } };
        } else if (chunk.type === "content" && chunk.text) {
          yield { event: "content", data: { content: chunk.text } };
        } else if (chunk.type === "done") {
          content = chunk.content ?? "";
        }
      }

      if (!content) {
        yield {
          event: "result",
          data: {
            shed: recomputeEstimate(
              generateFallbackShed({
                areaM2: opts.terrainContext?.areaM2,
                standard: opts.standard,
                use: opts.use,
              }),
            ),
            source: "fallback",
            error: "Resposta vazia do modelo. Usando fallback.",
            attempts: attempt,
          },
        };
        return;
      }

      lastJson = content;
      const result = await tryParse(content);

      if (result.ok) {
        yield {
          event: "result",
          data: {
            shed: result.shed,
            source: "ai",
            attempts: attempt,
          },
        };
        return;
      }

      lastErrors = result.errors;
      if (attempt > MAX_RETRIES) break;

      // Re-prompt com correção
      messages.push({ role: "assistant", content });
      messages.push({ role: "user", content: CORRECTION_PROMPT(result.errors, content) });
    }

    yield {
      event: "result",
      data: {
        shed: recomputeEstimate(
          generateFallbackShed({
            areaM2: opts.terrainContext?.areaM2,
            standard: opts.standard,
            use: opts.use,
          }),
        ),
        source: "fallback",
        error: `Validação falhou após ${attempt} tentativa(s). Usando fallback.`,
        attempts: attempt,
        validationErrors: lastErrors,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { event: "error", data: { error: message } };
    yield {
      event: "result",
      data: {
        shed: recomputeEstimate(
          generateFallbackShed({
            areaM2: opts.terrainContext?.areaM2,
            standard: opts.standard,
            use: opts.use,
          }),
        ),
        source: "fallback",
        error: `Erro na geração: ${message}. Usando fallback. (último JSON: ${lastJson.slice(0, 80)}...)`,
      },
    };
  }
}
