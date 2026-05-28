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
        error?: string;
      };
      if (!res.ok || !json.proposedSitePlan) {
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      const proposedSite = json.proposedSitePlan;
      const validations = json.validations ?? { ok: true, errors: [], warnings: [] };
      const turn: ChatTurn = {
        role: "assistant",
        text:
          validations.ok === false
            ? "Patch proposto contém erros — revise antes de aplicar."
            : "Patch proposto pronto para aplicação.",
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
    <div className="refine-chat" style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%" }}>
      <div
        className="refine-chat__log"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: 8,
          background: "#0b1220",
          borderRadius: 6,
          fontSize: 13,
        }}
      >
        {turns.length === 0 && (
          <div style={{ color: "#64748b", fontSize: 12 }}>
            Descreva ajustes (ex.: "afaste o galpão 2 da rua", "aumente o vão livre").
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <div
              style={{
                fontWeight: 600,
                color: t.role === "user" ? "#60a5fa" : "#fbbf24",
                fontSize: 11,
              }}
            >
              {t.role === "user" ? "você" : "agente"}
            </div>
            <div style={{ color: "#cbd5e1" }}>{t.text}</div>
            {t.proposal && (
              <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => t.proposal && onApply(t.proposal.site)}
                  disabled={!t.proposal.validations.ok}
                  style={{ fontSize: 11, padding: "4px 10px" }}
                >
                  Aplicar
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() =>
                    setTurns((arr) =>
                      arr.map((x, j) =>
                        j === i ? { ...x, proposal: undefined, text: x.text + " (descartado)" } : x,
                      ),
                    )
                  }
                  style={{ fontSize: 11, padding: "4px 10px" }}
                >
                  Descartar
                </button>
                {!t.proposal.validations.ok && (
                  <span style={{ color: "#fca5a5", fontSize: 11 }}>
                    {t.proposal.validations.errors.length} erro(s)
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
        {err && <div style={{ color: "#fca5a5", fontSize: 12 }}>{err}</div>}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
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
          style={{
            flex: 1,
            padding: "6px 10px",
            background: "#0b1220",
            border: "1px solid #1f2937",
            borderRadius: 6,
            color: "#e2e8f0",
          }}
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
