// Cliente fino para o endpoint de inferência do Azure AI Foundry / Cognitive Services.
// Suporta modelos como "Kimi-K2.5" e "gpt-5.4-mini" via a rota `/models/chat/completions`.
//
// Documentação: https://learn.microsoft.com/azure/ai-studio/reference/reference-model-inference-chat-completions

export interface AzureChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AzureChatOptions {
  messages: AzureChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Quando true, exige resposta em JSON. */
  jsonObject?: boolean;
  /** Sobrescreve o modelo padrão da env. */
  model?: string;
  signal?: AbortSignal;
}

export interface AzureChatResult {
  content: string;
  raw: unknown;
}

export class AzureAIError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function getConfig() {
  const endpoint = process.env.AZURE_AI_ENDPOINT?.replace(/\/+$/, "");
  const apiKey = process.env.AZURE_AI_API_KEY;
  const model = process.env.AZURE_AI_MODEL || "gpt-5.4-mini";
  const apiVersion = process.env.AZURE_AI_API_VERSION || "2024-05-01-preview";
  return { endpoint, apiKey, model, apiVersion };
}

export function isAzureAIConfigured(): boolean {
  const { endpoint, apiKey } = getConfig();
  return Boolean(endpoint && apiKey);
}

export async function azureChatCompletion(
  opts: AzureChatOptions,
): Promise<AzureChatResult> {
  const { endpoint, apiKey, model, apiVersion } = getConfig();
  if (!endpoint || !apiKey) {
    throw new AzureAIError(
      "Azure AI não configurado (AZURE_AI_ENDPOINT / AZURE_AI_API_KEY).",
      0,
      "",
    );
  }

  const url = `${endpoint}/models/chat/completions?api-version=${apiVersion}`;
  const body: Record<string, unknown> = {
    model: opts.model ?? model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.4,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.jsonObject) body.response_format = { type: "json_object" };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new AzureAIError(
      `Azure AI ${res.status} ${res.statusText}`,
      res.status,
      text,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AzureAIError("Resposta não-JSON do Azure AI", res.status, text);
  }

  const content =
    (parsed as { choices?: { message?: { content?: string } }[] })?.choices?.[0]
      ?.message?.content ?? "";

  return { content, raw: parsed };
}
