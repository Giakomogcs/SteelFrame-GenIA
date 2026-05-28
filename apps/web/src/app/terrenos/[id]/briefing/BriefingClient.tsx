"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ShedViewer from "@/components/ShedViewer";
import type { IndustrialShed } from "@/lib/shedSchema";
import type { LngLat } from "@/lib/geo";

interface Props {
  terrainId: string;
  terrainName: string;
  terrainAddress?: string | null;
  areaM2: number;
  polygon: LngLat[];
}

interface ChatTurn {
  role: "user" | "assistant" | "system";
  content: string;
}

const QUICK_PROMPTS = [
  "Galpão logístico 30×60m, pé-direito 10m, 4 docas niveladas, padrão médio, escritório de 80m².",
  "Centro de distribuição 50×100m, padrão alto, mezanino, sprinklers, AVCB obrigatório.",
  "Galpão industrial leve 24×40m com ponte rolante 5t, piso 80 kN/m².",
  "Cross-dock 20×80m com 8 docas em cada lateral, telhado sawtooth.",
];

export default function BriefingClient({
  terrainId,
  terrainName,
  terrainAddress,
  areaM2,
  polygon,
}: Props) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [use, setUse] = useState<IndustrialShed["use"]>("logistics");
  const [standard, setStandard] = useState<IndustrialShed["standard"]>("medio");
  const [streaming, setStreaming] = useState(false);
  const [thinkingText, setThinkingText] = useState("");
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shed, setShed] = useState<IndustrialShed | null>(null);
  const [source, setSource] = useState<"ai" | "fallback" | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const totalCost = shed?.estimate?.totalCost ?? 0;
  const coveredArea = shed?.estimate?.coveredAreaM2 ?? 0;
  const costPerM2 = shed?.estimate?.costPerM2 ?? 0;

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  const generate = useCallback(async () => {
    if (!prompt.trim() || streaming) return;
    setError(null);
    setThinkingText("");
    setStreamText("");
    setValidationErrors([]);
    setStreaming(true);
    setTurns((prev) => [...prev, { role: "user", content: prompt.trim() }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, terrainId, use, standard }),
        signal: controller.signal,
      });

      // Caso retorne JSON puro (fallback sem chave / erro 400)
      const contentType = res.headers.get("Content-Type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        const json = (await res.json()) as {
          shed?: IndustrialShed;
          source?: "ai" | "fallback";
          error?: string;
        };
        if (json.shed) setShed(json.shed);
        if (json.source) setSource(json.source);
        if (json.error) setError(json.error);
        setTurns((prev) => [
          ...prev,
          {
            role: "assistant",
            content: json.error ?? "Projeto gerado (fallback).",
          },
        ]);
        setStreaming(false);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const evt of events) {
          if (!evt.trim()) continue;
          const lines = evt.split("\n");
          let eventName = "message";
          let dataStr = "";
          for (const line of lines) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
          }
          if (!dataStr) continue;
          let data: unknown;
          try {
            data = JSON.parse(dataStr);
          } catch {
            continue;
          }
          if (eventName === "thinking") {
            const d = data as { content?: string };
            setThinkingText((t) => t + (d.content ?? ""));
          } else if (eventName === "content") {
            const d = data as { content?: string };
            setStreamText((t) => t + (d.content ?? ""));
          } else if (eventName === "error") {
            const d = data as { error?: string };
            setError(d.error ?? "Erro desconhecido");
          } else if (eventName === "result") {
            const d = data as {
              shed?: IndustrialShed;
              source?: "ai" | "fallback";
              error?: string;
              validationErrors?: string[];
            };
            if (d.shed) setShed(d.shed);
            if (d.source) setSource(d.source);
            if (d.error) setError(d.error);
            if (d.validationErrors) setValidationErrors(d.validationErrors);
            setTurns((prev) => [
              ...prev,
              {
                role: "assistant",
                content:
                  d.source === "ai"
                    ? "Projeto gerado pela IA. Você pode salvar ou refinar."
                    : (d.error ??
                      "Projeto gerado por fallback determinístico."),
              },
            ]);
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") {
        setError("Geração cancelada.");
      } else {
        setError((err as Error).message);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      setPrompt("");
    }
  }, [prompt, streaming, terrainId, use, standard]);

  const save = useCallback(async () => {
    if (!shed) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/terrenos/${terrainId}/sheds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Galpão ${shed.use} ${shed.footprint.width}×${shed.footprint.depth}m`,
          shed,
        }),
      });
      if (!res.ok) throw new Error("Falha ao salvar (" + res.status + ")");
      const json = (await res.json()) as { id: string };
      setSavedId(json.id);
      router.push(`/terrenos/${terrainId}/construcoes/${json.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [shed, terrainId, router]);

  const stats = useMemo(() => {
    if (!shed) return null;
    return [
      { label: "Uso", value: shed.use },
      { label: "Padrão", value: shed.standard },
      {
        label: "Área coberta",
        value: `${coveredArea.toLocaleString("pt-BR")} m²`,
      },
      {
        label: "Pé-direito",
        value: `${shed.structure.clearHeight} m`,
      },
      {
        label: "Pórticos",
        value: `${shed.structure.bayCount} × ${shed.structure.baySpacing.toFixed(1)} m`,
      },
      {
        label: "Telhado",
        value: `${shed.roof.type} · ${shed.roof.slopePct}% · skylight ${shed.roof.skylightPct}%`,
      },
      {
        label: "Docas",
        value: `${shed.docks.length}`,
      },
      {
        label: "AVCB",
        value: shed.safety.avcbRequired ? "Sim" : "Não",
      },
    ];
  }, [shed, coveredArea]);

  return (
    <div className="grid gap-6 lg:grid-cols-[420px,1fr]">
      {/* Coluna chat */}
      <div className="flex flex-col gap-4">
        <div className="dt-card p-4">
          <div className="text-xs uppercase tracking-wide text-white/60">
            Terreno
          </div>
          <div className="mt-1 text-lg font-semibold">{terrainName}</div>
          {terrainAddress && (
            <div className="text-xs text-white/60">{terrainAddress}</div>
          )}
          <div className="mt-2 text-xs text-white/60">
            Área:{" "}
            <b>
              {areaM2.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} m²
            </b>
          </div>
        </div>

        <div className="dt-card p-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs uppercase tracking-wide text-white/60">
              Uso
              <select
                value={use}
                onChange={(e) =>
                  setUse(e.target.value as IndustrialShed["use"])
                }
                className="mt-1 w-full rounded-md border border-white/10 bg-[#1f1c23] px-2 py-1.5 text-sm text-white"
                disabled={streaming}
              >
                <option value="logistics">Logístico</option>
                <option value="distribution_center">
                  Centro de Distribuição
                </option>
                <option value="cross_dock">Cross-dock</option>
                <option value="industrial">Industrial</option>
                <option value="manufacturing">Manufatura</option>
                <option value="cold_storage">Cold storage</option>
              </select>
            </label>
            <label className="text-xs uppercase tracking-wide text-white/60">
              Padrão
              <select
                value={standard}
                onChange={(e) =>
                  setStandard(e.target.value as IndustrialShed["standard"])
                }
                className="mt-1 w-full rounded-md border border-white/10 bg-[#1f1c23] px-2 py-1.5 text-sm text-white"
                disabled={streaming}
              >
                <option value="economico">Econômico</option>
                <option value="medio">Médio</option>
                <option value="alto">Alto</option>
              </select>
            </label>
          </div>

          <div className="max-h-[28vh] space-y-2 overflow-y-auto rounded-md border border-white/5 bg-[#16131a] p-2 text-sm">
            {turns.length === 0 && (
              <div className="text-xs text-white/40">
                Descreva o galpão que precisa. Ex.: dimensões, uso, docas, ponte
                rolante, padrão, AVCB.
              </div>
            )}
            {turns.map((t, i) => (
              <div
                key={i}
                className={`rounded-md px-2 py-1.5 text-xs ${
                  t.role === "user"
                    ? "bg-[#dd1c4a]/15 text-white"
                    : "bg-white/5 text-white/80"
                }`}
              >
                <div className="mb-0.5 text-[10px] uppercase tracking-wide text-white/40">
                  {t.role === "user" ? "Você" : "Agente"}
                </div>
                <div>{t.content}</div>
              </div>
            ))}
            {streaming && streamText && (
              <div className="rounded-md bg-white/5 px-2 py-1.5 text-xs text-white/80">
                <div className="mb-0.5 text-[10px] uppercase tracking-wide text-white/40">
                  Agente (transmitindo)…
                </div>
                <pre className="whitespace-pre-wrap font-mono text-[10px] leading-tight text-white/60">
                  {streamText.slice(-600)}
                </pre>
              </div>
            )}
            {streaming && thinkingText && (
              <div className="rounded-md bg-[#1f1c23] px-2 py-1.5 text-[10px] italic text-white/40">
                💭 {thinkingText.slice(-240)}
              </div>
            )}
          </div>

          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Descreva o galpão (área, pé-direito, docas, padrão, ponte rolante, AVCB…)"
            rows={3}
            disabled={streaming}
            className="w-full rounded-md border border-white/10 bg-[#1f1c23] px-3 py-2 text-sm text-white outline-none focus:border-[#dd1c4a]"
          />

          <div className="flex flex-wrap gap-1">
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q}
                type="button"
                disabled={streaming}
                onClick={() => setPrompt(q)}
                className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white/70 hover:border-[#dd1c4a]/60 hover:text-white"
              >
                {q.slice(0, 50)}…
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            {streaming ? (
              <button
                type="button"
                onClick={stopStream}
                className="flex-1 rounded-md bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/20"
              >
                Parar
              </button>
            ) : (
              <button
                type="button"
                onClick={generate}
                disabled={!prompt.trim()}
                className="dt-btn-primary flex-1 text-sm disabled:opacity-40"
              >
                ✨ Gerar com IA
              </button>
            )}
          </div>

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-xs text-red-200">
              {error}
            </div>
          )}
          {validationErrors.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">
              <div className="font-semibold">Validações:</div>
              <ul className="ml-3 list-disc">
                {validationErrors.slice(0, 6).map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {shed && stats && (
          <div className="dt-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wide text-white/60">
                Projeto atual
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                  source === "ai"
                    ? "bg-emerald-500/20 text-emerald-200"
                    : "bg-amber-500/20 text-amber-200"
                }`}
              >
                {source === "ai" ? "IA" : "fallback"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {stats.map((s) => (
                <div key={s.label} className="rounded bg-white/5 px-2 py-1.5">
                  <div className="text-[10px] uppercase text-white/50">
                    {s.label}
                  </div>
                  <div className="font-semibold text-white">{s.value}</div>
                </div>
              ))}
            </div>
            <div className="rounded-md border border-white/10 bg-[#1f1c23] p-3 text-sm">
              <div className="text-xs text-white/60">Custo estimado</div>
              <div className="text-lg font-bold text-[#ff3d6a]">
                R$ {totalCost.toLocaleString("pt-BR")}
              </div>
              <div className="text-[11px] text-white/50">
                ~R$ {costPerM2.toLocaleString("pt-BR")} /m² ·{" "}
                {shed.estimate.steelKg.toLocaleString("pt-BR")} kg de aço
              </div>
            </div>
            {shed.assumptions.length > 0 && (
              <details className="rounded-md bg-white/5 px-2 py-1.5 text-xs text-white/70">
                <summary className="cursor-pointer text-white/80">
                  Premissas ({shed.assumptions.length})
                </summary>
                <ul className="mt-1 ml-3 list-disc">
                  {shed.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </details>
            )}
            <button
              type="button"
              onClick={save}
              disabled={saving || !!savedId}
              className="dt-btn-primary w-full text-sm disabled:opacity-50"
            >
              {savedId
                ? "✓ Salvo — abrindo viewer…"
                : saving
                  ? "Salvando…"
                  : "Salvar construção"}
            </button>
          </div>
        )}
      </div>

      {/* Coluna viewer */}
      <div className="space-y-3">
        {shed ? (
          <ShedViewer shed={shed} polygon={polygon} height="78vh" />
        ) : (
          <div className="flex h-[78vh] items-center justify-center rounded-xl border border-dashed border-white/10 bg-[#16131a] text-center text-white/40">
            <div>
              <div className="text-base font-semibold text-white/70">
                Aguardando briefing
              </div>
              <div className="mt-1 text-xs">
                Descreva o galpão para que o agente gere o modelo 3D
                paramétrico.
              </div>
            </div>
          </div>
        )}
        {shed && (
          <div className="dt-card grid grid-cols-2 gap-3 p-3 text-xs sm:grid-cols-4">
            <div>
              <div className="text-white/50">Footprint</div>
              <div className="font-semibold">
                {shed.footprint.width} × {shed.footprint.depth} m
              </div>
            </div>
            <div>
              <div className="text-white/50">Estrutura</div>
              <div className="font-semibold">
                {shed.structure.system.replace(/_/g, " ")}
              </div>
            </div>
            <div>
              <div className="text-white/50">Telhado</div>
              <div className="font-semibold">
                {shed.roof.type} · {shed.roof.cover.replace(/_/g, " ")}
              </div>
            </div>
            <div>
              <div className="text-white/50">Confiança IA</div>
              <div className="font-semibold">
                {(shed.confidence * 100).toFixed(0)}%
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
