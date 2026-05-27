"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Polygon,
  Marker,
  useMapEvents,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import type { LngLat } from "@/lib/geo";
import { polygonAreaM2 } from "@/lib/geo";

// Ícone padrão dos vértices (Leaflet exige reset de paths em bundlers)
const vertexIcon = L.divIcon({
  className: "",
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  html: `<div style="
    width:14px;height:14px;border-radius:50%;
    background:#0ea5e9;border:2px solid #fff;
    box-shadow:0 0 0 2px rgba(14,165,233,0.35);"></div>`,
});

interface Props {
  initialPolygon?: LngLat[]; // [lng, lat]
  initialCenter?: LngLat;
  editable?: boolean;
  onChange?: (polygon: LngLat[], areaM2: number) => void;
}

function MapClickHandler({
  drawing,
  closed,
  onAddPoint,
}: {
  drawing: boolean;
  closed: boolean;
  onAddPoint: (p: LngLat) => void;
}) {
  useMapEvents({
    click(e) {
      if (!drawing || closed) return;
      onAddPoint([e.latlng.lng, e.latlng.lat]);
    },
  });
  return null;
}

function FlyTo({ target }: { target: LngLat | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target[1], target[0]], 18, { duration: 0.8 });
  }, [target, map]);
  return null;
}

export default function TerrainMapClient({
  initialPolygon = [],
  initialCenter,
  editable = true,
  onChange,
}: Props) {
  const [polygon, setPolygon] = useState<LngLat[]>(initialPolygon);
  const [closed, setClosed] = useState(initialPolygon.length >= 3);
  const [drawing, setDrawing] = useState(editable && initialPolygon.length === 0);
  const [search, setSearch] = useState("");
  const [searchTarget, setSearchTarget] = useState<LngLat | null>(null);
  const [searching, setSearching] = useState(false);

  const area = useMemo(() => polygonAreaM2(polygon), [polygon]);

  useEffect(() => {
    if (closed) onChange?.(polygon, area);
  }, [polygon, area, closed, onChange]);

  const center: [number, number] = initialCenter
    ? [initialCenter[1], initialCenter[0]]
    : polygon[0]
      ? [polygon[0][1], polygon[0][0]]
      : [-23.5505, -46.6333]; // São Paulo default

  const handleAddPoint = (p: LngLat) => setPolygon((prev) => [...prev, p]);

  const closeShape = () => {
    if (polygon.length < 3) return;
    setClosed(true);
    setDrawing(false);
  };

  const resetShape = () => {
    setPolygon([]);
    setClosed(false);
    setDrawing(true);
  };

  const onVertexDrag = (idx: number, lng: number, lat: number) => {
    setPolygon((prev) => {
      const next = prev.slice();
      next[idx] = [lng, lat];
      return next;
    });
  };

  const removeVertex = (idx: number) => {
    if (!editable) return;
    setPolygon((prev) => prev.filter((_, i) => i !== idx));
  };

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!search.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(search)}`,
        { headers: { Accept: "application/json" } },
      );
      const data = (await res.json()) as { lat: string; lon: string }[];
      if (data[0]) {
        setSearchTarget([parseFloat(data[0].lon), parseFloat(data[0].lat)]);
      }
    } finally {
      setSearching(false);
    }
  }

  const positions = polygon.map(([lng, lat]) => [lat, lng] as [number, number]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={handleSearch} className="flex flex-1 gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar endereço (rua, cidade, CEP)…"
            className="flex-1 rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <button
            type="submit"
            disabled={searching}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium hover:bg-brand-500 disabled:opacity-50"
          >
            {searching ? "…" : "Buscar"}
          </button>
        </form>

        {editable && (
          <div className="flex gap-2">
            {!closed && (
              <>
                <button
                  type="button"
                  onClick={() => setDrawing((d) => !d)}
                  className={`rounded-md px-3 py-2 text-sm ${
                    drawing
                      ? "bg-emerald-600 hover:bg-emerald-500"
                      : "bg-white/10 hover:bg-white/20"
                  }`}
                >
                  {drawing ? "Desenhando…" : "Desenhar terreno"}
                </button>
                <button
                  type="button"
                  onClick={closeShape}
                  disabled={polygon.length < 3}
                  className="rounded-md bg-brand-600 px-3 py-2 text-sm hover:bg-brand-500 disabled:opacity-40"
                >
                  Fechar forma
                </button>
              </>
            )}
            <button
              type="button"
              onClick={resetShape}
              className="rounded-md bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
            >
              Limpar
            </button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10">
        <MapContainer
          center={center}
          zoom={initialPolygon.length ? 18 : 13}
          style={{ height: "60vh", width: "100%" }}
          scrollWheelZoom
        >
          {/* Camada satélite (Esri) */}
          <TileLayer
            attribution='Tiles &copy; Esri'
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxZoom={20}
          />
          {/* Rótulos por cima */}
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
            maxZoom={20}
            opacity={0.7}
          />

          <FlyTo target={searchTarget} />

          <MapClickHandler
            drawing={drawing}
            closed={closed}
            onAddPoint={handleAddPoint}
          />

          {positions.length >= 2 && (
            <Polygon
              positions={positions}
              pathOptions={{
                color: closed ? "#0ea5e9" : "#38bdf8",
                fillColor: "#0ea5e9",
                fillOpacity: closed ? 0.25 : 0.1,
                dashArray: closed ? undefined : "6 6",
                weight: 2,
              }}
            />
          )}

          {editable &&
            polygon.map((p, i) => (
              <Marker
                key={i}
                position={[p[1], p[0]]}
                draggable={closed}
                icon={vertexIcon}
                eventHandlers={{
                  dragend(e) {
                    const m = e.target as L.Marker;
                    const ll = m.getLatLng();
                    onVertexDrag(i, ll.lng, ll.lat);
                  },
                  contextmenu() {
                    removeVertex(i);
                  },
                }}
              />
            ))}
        </MapContainer>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-300">
        <span>
          Vértices: <b>{polygon.length}</b>
          {polygon.length >= 3 && (
            <>
              {" · "}Área:{" "}
              <b>
                {area.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} m²
              </b>
            </>
          )}
        </span>
        <span className="text-xs text-slate-500">
          {editable
            ? closed
              ? "Arraste os vértices para ajustar · clique direito remove vértice"
              : "Clique no mapa para adicionar vértices · feche a forma para confirmar"
            : "Visualização"}
        </span>
      </div>
    </div>
  );
}
