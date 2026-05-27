"use client";

import { useState } from "react";
import TerrainMap from "@/components/TerrainMap";
import type { LngLat } from "@/lib/geo";
import { polygonCenter } from "@/lib/geo";

interface Props {
  id: string;
  initialPolygon: LngLat[];
  initialCenter: LngLat;
}

export function TerrainEditClient({ id, initialPolygon, initialCenter }: Props) {
  const [polygon, setPolygon] = useState<LngLat[]>(initialPolygon);
  const [area, setArea] = useState(0);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function save() {
    if (polygon.length < 3) return;
    setSaving(true);
    const [centerLng, centerLat] = polygonCenter(polygon);
    await fetch(`/api/terrenos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        polygon,
        centerLng,
        centerLat,
        areaM2: area,
      }),
    });
    setSaving(false);
    setDirty(false);
  }

  return (
    <div className="space-y-3">
      <TerrainMap
        initialPolygon={initialPolygon}
        initialCenter={initialCenter}
        onChange={(p, a) => {
          setPolygon(p);
          setArea(a);
          setDirty(true);
        }}
      />
      {dirty && (
        <div className="flex justify-end">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium hover:bg-brand-500 disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Salvar alterações"}
          </button>
        </div>
      )}
    </div>
  );
}
