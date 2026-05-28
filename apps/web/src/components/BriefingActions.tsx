"use client";

import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";
import { useAlertDialog } from "./AlertDialog";

interface Props {
  briefingId: string;
  terrainName: string;
}

export function BriefingActions({ briefingId, terrainName }: Props) {
  const router = useRouter();
  const { confirm, alert } = useAlertDialog();
  const [busy, setBusy] = useState<"cancel" | "delete" | null>(null);

  function stop(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  async function cancel(e: MouseEvent<HTMLButtonElement>) {
    stop(e);
    if (busy) return;
    const ok = await confirm({
      title: `Cancelar o briefing de "${terrainName}"?`,
      message:
        "Ele deixa de aparecer na lista de pendentes, mas o histórico fica preservado.",
      confirmLabel: "Cancelar briefing",
      cancelLabel: "Voltar",
    });
    if (!ok) return;
    setBusy("cancel");
    try {
      const res = await fetch(`/api/briefings/${briefingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `Falha ao cancelar (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      console.error(err);
      await alert({
        title: "Erro ao cancelar o briefing",
        message: err instanceof Error ? err.message : "Tente novamente.",
        variant: "danger",
      });
      setBusy(null);
    }
  }

  async function remove(e: MouseEvent<HTMLButtonElement>) {
    stop(e);
    if (busy) return;
    const ok = await confirm({
      title: `Excluir o briefing de "${terrainName}"?`,
      message:
        "Essa ação remove o histórico de conversa e premissas. Galpões e relatórios já gerados a partir dele são mantidos. Não pode ser desfeita.",
      confirmLabel: "Excluir",
      variant: "danger",
    });
    if (!ok) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/briefings/${briefingId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `Falha ao excluir (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      console.error(err);
      await alert({
        title: "Erro ao excluir o briefing",
        message: err instanceof Error ? err.message : "Tente novamente.",
        variant: "danger",
      });
      setBusy(null);
    }
  }

  return (
    <div className="briefing-actions" onClick={stop}>
      <button
        type="button"
        onClick={cancel}
        disabled={busy !== null}
        className="briefing-action-btn"
        title="Cancelar briefing (mantém histórico)"
      >
        {busy === "cancel" ? "…" : "Cancelar"}
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={busy !== null}
        className="briefing-action-btn danger"
        title="Excluir briefing"
        aria-label={`Excluir briefing de ${terrainName}`}
      >
        {busy === "delete" ? (
          "…"
        ) : (
          <svg
            className="icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            width="14"
            height="14"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
          </svg>
        )}
      </button>
    </div>
  );
}
