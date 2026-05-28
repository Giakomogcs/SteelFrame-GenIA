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

export function TerrainEditClient({
  id,
  initialPolygon,
  initialCenter,
}: Props) {
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
    <div>
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
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "var(--space-3) var(--space-4)",
            borderTop: "1px solid var(--color-stroke)",
            background: "var(--color-surface)",
          }}
        >
          <button
            onClick={save}
            disabled={saving}
            className="btn btn-primary btn-sm"
          >
            {saving ? "Salvando…" : "Salvar alterações"}
          </button>
        </div>
      )}
    </div>
  );
}
