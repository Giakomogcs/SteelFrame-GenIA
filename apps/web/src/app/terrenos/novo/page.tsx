"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import TerrainMap from "@/components/TerrainMap";
import type { LngLat } from "@/lib/geo";
import { polygonCenter } from "@/lib/geo";

export default function NewTerrainPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [polygon, setPolygon] = useState<LngLat[]>([]);
  const [area, setArea] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (polygon.length < 3) {
      setError("Desenhe o terreno no mapa (mín. 3 vértices).");
      return;
    }
    if (!name.trim()) {
      setError("Dê um nome ao terreno.");
      return;
    }
    setSaving(true);
    setError(null);
    const [centerLng, centerLat] = polygonCenter(polygon);
    try {
      const res = await fetch("/api/terrenos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          address,
          polygon,
          centerLng,
          centerLat,
          areaM2: area,
        }),
      });
      if (!res.ok) throw new Error("Falha ao salvar");
      const json = (await res.json()) as { id: string };
      router.push(`/terrenos/${json.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Novo terreno</h1>
        <p className="text-sm text-slate-400">
          Busque o endereço, clique para marcar os vértices e feche a forma.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <input
          placeholder="Nome (ex: Terreno Guarulhos)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <input
          placeholder="Endereço (opcional)"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
      </div>

      <TerrainMap
        onChange={(p, a) => {
          setPolygon(p);
          setArea(a);
        }}
      />

      {error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-emerald-600 px-5 py-2 font-medium hover:bg-emerald-500 disabled:opacity-50"
        >
          {saving ? "Salvando…" : "Salvar terreno"}
        </button>
      </div>
    </div>
  );
}
