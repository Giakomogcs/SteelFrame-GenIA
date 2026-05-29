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
import { extractUF } from "@/lib/knowledge";

/** Subset do objeto `address` retornado pelo Nominatim. */
interface NominatimAddress {
  state?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  suburb?: string;
  neighbourhood?: string;
  city_district?: string;
  road?: string;
  house_number?: string;
  postcode?: string;
}

function parseNominatimAddress(addr?: NominatimAddress): ResolvedLocation {
  if (!addr) return {};
  const stateName = addr.state;
  const uf = stateName ? extractUF(stateName) : "BR";
  return {
    uf: uf !== "BR" ? uf : undefined,
    stateName,
    city: addr.city ?? addr.town ?? addr.village ?? addr.municipality,
    district: addr.suburb ?? addr.neighbourhood ?? addr.city_district,
    street: addr.road,
    houseNumber: addr.house_number,
    postcode: addr.postcode,
  };
}

// Ícone padrão dos vértices (Leaflet exige reset de paths em bundlers)
const vertexIcon = L.divIcon({
  className: "",
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  html: `<div style="
    width:14px;height:14px;border-radius:50%;
    background:#0ea5e9;border:2px solid #fff;
    box-shadow:0 0 0 2px rgba(14,165,233,0.35);
    cursor:grab;"></div>`,
});

// Ícone do "ponto-médio" entre dois vértices: clique insere vértice nesse índice.
const midpointIcon = L.divIcon({
  className: "",
  iconSize: [12, 12],
  iconAnchor: [6, 6],
  html: `<div style="
    width:12px;height:12px;border-radius:50%;
    background:rgba(14,165,233,0.55);
    border:1.5px dashed #fff;
    cursor:copy;
    transition:transform .12s ease;"
    onmouseover="this.style.transform='scale(1.35)'"
    onmouseout="this.style.transform='scale(1)'"></div>`,
});

/** Componentes estruturados do endereço (Nominatim `address` object). */
export interface ResolvedLocation {
  /** UF em sigla (ex.: "SP"). Mapeado a partir de `address.state`. */
  uf?: string;
  /** Nome completo do estado retornado pelo Nominatim. */
  stateName?: string;
  city?: string;
  district?: string;
  street?: string;
  houseNumber?: string;
  postcode?: string;
}

interface Props {
  initialPolygon?: LngLat[]; // [lng, lat]
  initialCenter?: LngLat;
  editable?: boolean;
  onChange?: (polygon: LngLat[], areaM2: number, errors?: string[]) => void;
  /** Recebe endereço quando o usuário busca (`source: "search"`) ou quando a
   *  forma fecha (reverse-geocoding, `source: "reverse"`). A origem permite ao
   *  consumidor priorizar o endereço buscado e nunca sobrescrevê-lo. */
  onAddressResolved?: (address: string, source: "search" | "reverse") => void;
  /** Recebe os componentes estruturados (UF, cidade, bairro) — usados para
   *  alimentar tabelas paramétricas (SINAPI/CUB) por estado. */
  onLocationResolved?: (loc: ResolvedLocation) => void;
}

function MapClickHandler({
  drawing,
  onAddPoint,
}: {
  drawing: boolean;
  onAddPoint: (p: LngLat) => void;
}) {
  useMapEvents({
    click(e) {
      if (!drawing) return;
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

/**
 * Mantém o mapa enquadrado no polígono atual e revalida o tamanho do
 * container quando ele é redimensionado (sidebar abre/fecha, painel
 * preview muda de aba, etc.). Sem isso o Leaflet preserva o zoom inicial
 * e o lote acaba aparecendo recortado ou minúsculo.
 *
 * IMPORTANTE: quando `active=false` (usuário está desenhando) não
 * re-enquadra a cada clique — isso atrapalhava o desenho contínuo,
 * porque o mapa "pulava" e o cursor saa do próximo ponto.
 */
function FitPolygon({
  polygon,
  active,
}: {
  polygon: LngLat[];
  active: boolean;
}) {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(container);
    return () => ro.disconnect();
  }, [map]);
  useEffect(() => {
    if (!active) return;
    if (polygon.length < 2) return;
    const bounds = L.latLngBounds(
      polygon.map(([lng, lat]) => [lat, lng] as [number, number]),
    );
    map.invalidateSize();
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: MAX_MAP_ZOOM });
  }, [map, polygon, active]);
  return null;
}

export default function TerrainMapClient({
  initialPolygon = [],
  initialCenter,
  editable = true,
  onChange,
  onAddressResolved,
  onLocationResolved,
}: Props) {
  const [polygon, setPolygon] = useState<LngLat[]>(initialPolygon);
  // Modo de desenho: cliques no mapa adicionam vértice no final.
  // Após "Finalizar" o usuário continua podendo arrastar vértices e
  // inserir vértices novos clicando nos pontos-médios.
  const [drawing, setDrawing] = useState(
    editable && initialPolygon.length === 0,
  );
  const closed = polygon.length >= 3;
  const [search, setSearch] = useState("");
  const [searchTarget, setSearchTarget] = useState<LngLat | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [baseLayer, setBaseLayer] = useState<"satellite" | "street" | "relief">(
    "satellite",
  );
  const [hillshadeOpacity, setHillshadeOpacity] = useState(0); // 0 = off

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

  // Reverse-geocoding quando o polígono tem forma válida (preenche endereço).
  useEffect(() => {
    if (!closed || (!onAddressResolved && !onLocationResolved)) return;
    const [lng, lat] = polygonCenter(polygon);
    const ctrl = new AbortController();
    fetch(`/api/geocode?q=${lat},${lng}`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then(
        (
          data:
            | {
                displayName?: string | null;
                address?: NominatimAddress | null;
              }[]
            | null,
        ) => {
          const first = data?.[0];
          if (first?.displayName)
            onAddressResolved?.(first.displayName, "reverse");
          if (first?.address)
            onLocationResolved?.(parseNominatimAddress(first.address));
        },
      )
      .catch(() => {
        /* offline ou bloqueado — ignora */
      });
    return () => ctrl.abort();
  }, [closed, polygon, onAddressResolved, onLocationResolved]);

  // Ctrl+Z / Cmd+Z desfaz último vértice enquanto estiver desenhando.
  useEffect(() => {
    if (!editable) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setPolygon((prev) => (prev.length === 0 ? prev : prev.slice(0, -1)));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editable]);

  const center: [number, number] = initialCenter
    ? [initialCenter[1], initialCenter[0]]
    : polygon[0]
      ? [polygon[0][1], polygon[0][0]]
      : [-23.5505, -46.6333]; // São Paulo default

  const handleAddPoint = (p: LngLat) => setPolygon((prev) => [...prev, p]);

  const undoLast = () => {
    setPolygon((prev) => (prev.length === 0 ? prev : prev.slice(0, -1)));
  };

  const finishShape = () => {
    if (polygon.length < 3) return;
    setDrawing(false);
  };

  const resetShape = () => {
    setPolygon([]);
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
    setPolygon((prev) =>
      prev.length <= 3 ? prev : prev.filter((_, i) => i !== idx),
    );
  };

  // Insere um vértice em `insertAt` (posição entre dois vértices existentes).
  const insertVertex = (insertAt: number, lng: number, lat: number) => {
    setPolygon((prev) => {
      const next = prev.slice();
      next.splice(insertAt, 0, [lng, lat]);
      return next;
    });
  };

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!search.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(search)}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error("Falha ao buscar endereço.");
      }
      const data = (await res.json()) as {
        lat: string;
        lon: string;
        displayName?: string | null;
        address?: NominatimAddress | null;
      }[];
      if (data[0]) {
        setSearchTarget([parseFloat(data[0].lon), parseFloat(data[0].lat)]);
        if (data[0].displayName)
          onAddressResolved?.(data[0].displayName, "search");
        if (data[0].address)
          onLocationResolved?.(parseNominatimAddress(data[0].address));
      } else {
        setSearchError("Nenhum endereço encontrado.");
      }
    } catch {
      setSearchError("Não foi possível buscar o endereço. Tente novamente.");
    } finally {
      setSearching(false);
    }
  }

  const positions = polygon.map(([lng, lat]) => [lat, lng] as [number, number]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={handleSearch}
          className="flex flex-1 gap-2 min-w-[260px]"
        >
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
            <button
              type="button"
              onClick={() => {
                if (drawing && polygon.length >= 3) {
                  finishShape();
                } else {
                  setDrawing((d) => !d);
                }
              }}
              disabled={drawing && polygon.length > 0 && polygon.length < 3}
              className={`rounded-md px-3 py-2 text-sm transition ${
                drawing
                  ? "bg-brand-600 hover:bg-brand-500"
                  : "bg-white/10 hover:bg-white/20"
              } disabled:opacity-40`}
              title={
                drawing
                  ? polygon.length >= 3
                    ? "Finalizar e parar de adicionar vértices"
                    : "Adicione pelo menos 3 vértices"
                  : polygon.length >= 3
                    ? "Continuar adicionando vértices"
                    : "Ativar para adicionar vértices clicando no mapa"
              }
            >
              {drawing
                ? "✓ Finalizar"
                : polygon.length >= 3
                  ? "✏️ Continuar desenhando"
                  : "✏️ Adicionar vértices"}
            </button>
            <button
              type="button"
              onClick={undoLast}
              disabled={polygon.length === 0}
              className="rounded-md bg-white/10 px-3 py-2 text-sm hover:bg-white/20 disabled:opacity-40"
              title="Desfazer último vértice (Ctrl+Z)"
            >
              ↶ Desfazer
            </button>
            <button
              type="button"
              onClick={resetShape}
              disabled={polygon.length === 0}
              className="rounded-md bg-white/10 px-3 py-2 text-sm hover:bg-white/20 disabled:opacity-40"
            >
              Limpar
            </button>
          </div>
        )}
      </div>

      {searchError && (
        <p className="text-sm text-red-400">{searchError}</p>
      )}

      <div className="relative overflow-hidden rounded-xl border border-white/10">
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
          {hillshadeOpacity > 0 && (
            <TileLayer
              attribution="Hillshade &copy; Esri"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}"
              maxZoom={MAX_MAP_ZOOM}
              opacity={hillshadeOpacity}
            />
          )}

          <FlyTo target={searchTarget} />
          <FitPolygon polygon={polygon} active={!drawing} />

          <MapClickHandler drawing={drawing} onAddPoint={handleAddPoint} />

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
                key={`v-${i}`}
                position={[p[1], p[0]]}
                draggable
                icon={vertexIcon}
                eventHandlers={{
                  drag(e) {
                    // arrasto contínuo: reflete em tempo real no polígono
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

          {editable &&
            closed &&
            polygon.map((p, i) => {
              // Ponto-médio entre vértice i e (i+1) — clique insere vértice nesse ponto.
              const next = polygon[(i + 1) % polygon.length];
              const midLng = (p[0] + next[0]) / 2;
              const midLat = (p[1] + next[1]) / 2;
              const insertAt = i + 1;
              return (
                <Marker
                  key={`m-${i}`}
                  position={[midLat, midLng]}
                  icon={midpointIcon}
                  eventHandlers={{
                    click() {
                      insertVertex(insertAt, midLng, midLat);
                    },
                  }}
                />
              );
            })}
        </MapContainer>

        {/* HUD flutuante: m\u00e9tricas em tempo real (deslocado para n\u00e3o sobrepor o controle de zoom do Leaflet) */}
        <div
          className="pointer-events-none absolute left-14 top-3 z-[400] rounded-lg border border-white/15 bg-black/65 px-3 py-2 text-xs text-white shadow-lg backdrop-blur"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          <div className="text-[10px] uppercase tracking-wider text-white/55">
            {drawing ? "Desenhando" : closed ? "Polígono editado" : "Sem forma"}
          </div>
          <div className="mt-0.5 text-base font-semibold">
            {polygon.length >= 3
              ? `${area.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} m²`
              : `${polygon.length} vértice${polygon.length === 1 ? "" : "s"}`}
          </div>
          {polygon.length >= 3 && (
            <div className="text-[11px] text-white/65">
              {polygon.length} vértices · {(area / 10000).toFixed(2)} ha
            </div>
          )}
        </div>

        {/* Painel flutuante de camadas */}
        <div className="absolute right-3 top-3 z-[400] w-[180px] space-y-2 rounded-lg border border-white/15 bg-black/65 p-2 text-xs text-white shadow-lg backdrop-blur">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/55">
            Base
          </div>
          <div className="grid grid-cols-3 overflow-hidden rounded-md border border-white/10">
            {(
              [
                ["satellite", "Satélite"],
                ["street", "Ruas"],
                ["relief", "Topo"],
              ] as const
            ).map(([opt, label]) => (
              <button
                key={opt}
                type="button"
                onClick={() => setBaseLayer(opt)}
                className={`px-2 py-1 text-[11px] transition ${
                  baseLayer === opt
                    ? "bg-[#dd1c4a] text-white"
                    : "bg-white/5 text-white/70 hover:bg-white/10"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-white/55">
                Sombreamento
              </span>
              <span className="font-mono text-[10px] text-white/55">
                {Math.round(hillshadeOpacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={hillshadeOpacity}
              onChange={(e) => setHillshadeOpacity(parseFloat(e.target.value))}
              className="w-full accent-[#dd1c4a]"
              aria-label="Intensidade do sombreamento do relevo"
            />
          </div>

          {(baseLayer === "relief" || hillshadeOpacity > 0) && (
            <div className="pt-1">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/55">
                Altitude
              </div>
              <div
                className="h-2 w-full rounded"
                style={{
                  background:
                    "linear-gradient(90deg,#1f6b3a 0%,#5f9c3a 20%,#c8b96e 45%,#9c6a39 70%,#7a4a2b 85%,#ffffff 100%)",
                }}
              />
              <div className="mt-0.5 flex justify-between font-mono text-[9px] text-white/55">
                <span>baixo</span>
                <span>alto</span>
              </div>
            </div>
          )}
        </div>

        {/* Dica contextual no rodapé do mapa */}
        {editable && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-[400] -translate-x-1/2 rounded-md bg-black/65 px-3 py-1.5 text-[11px] text-white/85 shadow-lg backdrop-blur">
            {drawing
              ? "Clique para adicionar vértices · Ctrl+Z desfaz · botão direito remove"
              : closed
                ? "Arraste vértices ou clique no ○ tracejado da linha para inserir um novo"
                : "Use ✏️ Adicionar vértices para começar a desenhar"}
          </div>
        )}
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
