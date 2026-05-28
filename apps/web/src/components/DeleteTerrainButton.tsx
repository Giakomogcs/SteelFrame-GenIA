"use client";

import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";

interface Props {
  terrainId: string;
  terrainName: string;
}

export function DeleteTerrainButton({ terrainId, terrainName }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    const ok = window.confirm(
      `Apagar o terreno "${terrainName}"?\n\nEssa ação também removerá todos os galpões vinculados e não pode ser desfeita.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/terrenos/${terrainId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `Falha ao apagar (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      console.error(err);
      window.alert(
        err instanceof Error ? err.message : "Erro ao apagar o terreno.",
      );
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="terrain-delete-btn"
      aria-label={`Apagar terreno ${terrainName}`}
      title="Apagar terreno"
    >
      {busy ? (
        <svg
          className="icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      ) : (
        <svg
          className="icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
        </svg>
      )}
    </button>
  );
}
