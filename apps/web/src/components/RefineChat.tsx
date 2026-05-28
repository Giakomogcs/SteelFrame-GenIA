"use client";

/**
 * RefineChat — text refinement panel for the Study screen.
 * Sends user messages to POST /api/briefings/:id/refine. Receives
 * `{ proposedSitePlan, proposedHash, baseHash, validations }`.
 * User clicks Apply to push to the parent or Discard to drop.
 */
import { useState } from "react";
import type { SitePlan, ValidationReport } from "@/lib/sitePlanSchema";

interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  proposal?: {
    site: SitePlan;
    baseHash: string;
    proposedHash: string;
    validations: ValidationReport;
  };
}

interface Props {
  briefingId: string;
  currentSite: SitePlan;
  currentHash: string;
  onApply: (next: SitePlan) => void;
}

export default function RefineChat({
  briefingId,
  currentSite,
  currentHash,
  onApply,
}: Props) {
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send() {
    if (!input.trim() || busy) return;
    const text = input.trim();
    setInput("");
    setErr(null);
    setTurns((t) => [...t, { role: "user", text }]);
    setBusy(true);
    try {
      const res = await fetch(`/api/briefings/${briefingId}/refine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          baseHash: currentHash,
          currentSite,
        }),
      });
      const json = (await res.json()) as {
        proposedSitePlan?: SitePlan;
        proposedHash?: string;
        baseHash?: string;
        validations?: ValidationReport;
        summary?: string | null;
        error?: string;
      };
      if (!res.ok || !json.proposedSitePlan) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      const proposedSite = json.proposedSitePlan;
      const validations = json.validations ?? {
        ok: true,
        errors: [],
        warnings: [],
      };
      const summary =
        json.summary ??
        (validations.ok === false
          ? "Patch proposto contém erros — revise antes de aplicar."
          : "Patch proposto pronto para aplicação.");
      const turn: ChatTurn = {
        role: "assistant",
        text: summary,
        proposal: {
          site: proposedSite,
          baseHash: json.baseHash ?? currentHash,
          proposedHash: json.proposedHash ?? "",
          validations,
        },
      };
      setTurns((t) => [...t, turn]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="refine-chat">
      <div className="refine-chat__log">
        {turns.length === 0 && (
          <div className="refine-chat__empty">
            Descreva ajustes (ex.: &quot;afaste o galpão 2 da rua&quot;,
            &quot;aumente o vão livre&quot;).
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="refine-chat__turn">
            <div
              className={`refine-chat__role refine-chat__role--${t.role === "user" ? "user" : "agent"}`}
            >
              {t.role === "user" ? "você" : "agente"}
            </div>
            <div className="refine-chat__text">{t.text}</div>
            {t.proposal && (
              <div className="refine-chat__actions">
                <button
                  type="button"
                  className="btn btn--primary btn-sm"
                  onClick={() => t.proposal && onApply(t.proposal.site)}
                  disabled={!t.proposal.validations.ok}
                >
                  Aplicar
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn-sm"
                  onClick={() =>
                    setTurns((arr) =>
                      arr.map((x, j) =>
                        j === i
                          ? {
                              ...x,
                              proposal: undefined,
                              text: x.text + " (descartado)",
                            }
                          : x,
                      ),
                    )
                  }
                >
                  Descartar
                </button>
                {!t.proposal.validations.ok && (
                  <span
                    className="study-shell__pill study-shell__pill--err"
                    style={{ marginLeft: "auto" }}
                  >
                    {t.proposal.validations.errors.length} erro(s)
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
        {err && <div className="refine-chat__error">{err}</div>}
      </div>
      <div className="refine-chat__input-row">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Refinar estudo…"
          disabled={busy}
          className="refine-chat__input"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          className="btn btn--primary"
        >
          {busy ? "…" : "Enviar"}
        </button>
      </div>
    </div>
  );
}
