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
import {
  polygonAreaM2,
  polygonCenter,
  MIN_TERRAIN_AREA_M2,
  MAX_TERRAIN_AREA_M2,
  MAX_MAP_ZOOM,
  MIN_MAP_ZOOM,
} from "@/lib/geo";

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
  onChange?: (polygon: LngLat[], areaM2: number, errors?: string[]) => void;
  /** Recebe endereço quando o usuário busca ou quando a forma fecha (reverse-geocoding). */
  onAddressResolved?: (address: string) => void;
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
    if (target) {
      const z = Math.min(18, MAX_MAP_ZOOM);
      map.flyTo([target[1], target[0]], z, { duration: 0.8 });
    }
  }, [target, map]);
  return null;
}

export default function TerrainMapClient({
  initialPolygon = [],
  initialCenter,
  editable = true,
  onChange,
  onAddressResolved,
}: Props) {
  const [polygon, setPolygon] = useState<LngLat[]>(initialPolygon);
  const [closed, setClosed] = useState(initialPolygon.length >= 3);
  const [drawing, setDrawing] = useState(
    editable && initialPolygon.length === 0,
  );
  const [search, setSearch] = useState("");
  const [searchTarget, setSearchTarget] = useState<LngLat | null>(null);
  const [searching, setSearching] = useState(false);
  const [baseLayer, setBaseLayer] = useState<"satellite" | "street" | "relief">(
    "satellite",
  );
  const [showHillshade, setShowHillshade] = useState(false);

  const area = useMemo(() => polygonAreaM2(polygon), [polygon]);

  const areaErrors = useMemo<string[]>(() => {
    const errs: string[] = [];
    if (polygon.length >= 3) {
      if (area < MIN_TERRAIN_AREA_M2) {
        errs.push(
          `Área muito pequena (${Math.round(area)} m²). Mínimo ${MIN_TERRAIN_AREA_M2} m².`,
        );
      }
      if (area > MAX_TERRAIN_AREA_M2) {
        errs.push(
          `Área muito grande (${(area / 10_000).toFixed(1)} ha). Máximo ${(
            MAX_TERRAIN_AREA_M2 / 10_000
          ).toFixed(0)} ha — selecione um lote, não uma região.`,
        );
      }
    }
    return errs;
  }, [polygon.length, area]);

  useEffect(() => {
    onChange?.(polygon, area, areaErrors);
  }, [polygon, area, areaErrors, onChange]);

  // Reverse-geocoding ao fechar a forma (preenche endereço automaticamente).
  useEffect(() => {
    if (!closed || polygon.length < 3 || !onAddressResolved) return;
    const [lng, lat] = polygonCenter(polygon);
    const ctrl = new AbortController();
    fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}`,
      { headers: { Accept: "application/json" }, signal: ctrl.signal },
    )
      .then((r) => r.json())
      .then((data: { display_name?: string } | null) => {
        if (data?.display_name) onAddressResolved(data.display_name);
      })
      .catch(() => {
        /* offline ou bloqueado — ignora */
      });
    return () => ctrl.abort();
  }, [closed, polygon, onAddressResolved]);

  const center: [number, number] = initialCenter
    ? [initialCenter[1], initialCenter[0]]
    : polygon[0]
      ? [polygon[0][1], polygon[0][0]]
      : [-23.5505, -46.6333]; // São Paulo default

  const handleAddPoint = (p: LngLat) => setPolygon((prev) => [...prev, p]);

  const closeShape = () => {
    if (polygon.length < 3) return;
    if (area < MIN_TERRAIN_AREA_M2 || area > MAX_TERRAIN_AREA_M2) return;
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
      const data = (await res.json()) as {
        lat: string;
        lon: string;
        display_name?: string;
      }[];
      if (data[0]) {
        setSearchTarget([parseFloat(data[0].lon), parseFloat(data[0].lat)]);
        if (data[0].display_name) onAddressResolved?.(data[0].display_name);
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
                  disabled={polygon.length < 3 || areaErrors.length > 0}
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
          minZoom={MIN_MAP_ZOOM}
          maxZoom={MAX_MAP_ZOOM}
        >
          {baseLayer === "satellite" && (
            <>
              <TileLayer
                attribution="Tiles &copy; Esri"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                maxZoom={MAX_MAP_ZOOM}
              />
              <TileLayer
                url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
                maxZoom={MAX_MAP_ZOOM}
                opacity={0.7}
              />
            </>
          )}
          {baseLayer === "street" && (
            <TileLayer
              attribution="&copy; OpenStreetMap"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={MAX_MAP_ZOOM}
            />
          )}
          {baseLayer === "relief" && (
            <>
              {/* OpenTopoMap: curvas de nível + relevo sombreado (SRTM) */}
              <TileLayer
                attribution="Map data: &copy; OpenStreetMap, SRTM | Style: &copy; OpenTopoMap (CC-BY-SA)"
                url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
                maxZoom={17}
              />
            </>
          )}
          {showHillshade && (
            <TileLayer
              attribution="Hillshade &copy; Esri"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}"
              maxZoom={MAX_MAP_ZOOM}
              opacity={0.5}
            />
          )}

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

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-300">
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
        <div className="flex items-center gap-2 text-xs">
          <div className="inline-flex overflow-hidden rounded-md border border-white/10">
            {(["satellite", "street", "relief"] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setBaseLayer(opt)}
                className={`px-2 py-1 ${
                  baseLayer === opt
                    ? "bg-[#dd1c4a] text-white"
                    : "bg-white/5 text-white/70 hover:bg-white/10"
                }`}
              >
                {opt === "satellite"
                  ? "Satélite"
                  : opt === "street"
                    ? "Ruas"
                    : "Relevo (OpenTopoMap)"}
              </button>
            ))}
          </div>
          <label className="inline-flex items-center gap-1 text-white/70">
            <input
              type="checkbox"
              checked={showHillshade}
              onChange={(e) => setShowHillshade(e.target.checked)}
            />
            Hillshade
          </label>
        </div>
      </div>
      <div className="text-[11px] text-slate-500">
        {editable
          ? closed
            ? "Arraste os vértices para ajustar · clique direito remove vértice"
            : "Clique no mapa para adicionar vértices · feche a forma para confirmar"
          : "Visualização"}
      </div>
      {areaErrors.length > 0 && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {areaErrors.map((e) => (
            <div key={e}>⚠ {e}</div>
          ))}
        </div>
      )}
    </div>
  );
}
