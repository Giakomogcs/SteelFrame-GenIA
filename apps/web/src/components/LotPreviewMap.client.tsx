"use client";

import { useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Polygon,
  Polyline,
  Tooltip,
  Marker,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import type { LngLat } from "@/lib/geo";
import { fromLocalMeters, toLocalMeters, MAX_MAP_ZOOM } from "@/lib/geo";
import type { BuildingUse } from "@/lib/sitePlanSchema";
import type { Edge } from "@/lib/siteGeometry";
import { polygonBBox } from "@/lib/siteGeometry";

// ---- Types ---------------------------------------------------------------

interface PreviewBuilding {
  id: string;
  polygon: { x: number; z: number }[];
  use: BuildingUse;
  name: string;
}

export interface LotPreviewMapProps {
  polygon: LngLat[];
  lotRef: LngLat;
  polygonLocal: { x: number; z: number }[];
  edges: Edge[];
  streetEdges: number[];
  buildable: { x: number; z: number }[] | null;
  setbacks: { front: number; sides: number; back: number };
  buildings: PreviewBuilding[];
  gates: { edgeIndex: number; tAlongEdge: number; width: number }[];
  hasFitError: boolean;
  clearHeight: number;
  /** Called when a building is dragged. dx/dz are incremental local meters. */
  onBuildingMove?: (id: string, dx: number, dz: number) => void;
  /** Called when a building is clicked. */
  onBuildingSelect?: (id: string) => void;
  /** Currently selected building id for highlight. */
  selectedBuildingId?: string | null;
}

// ---- Helpers -------------------------------------------------------------

function localToGeo(
  pts: { x: number; z: number }[],
  ref: LngLat,
): [number, number][] {
  const geo = fromLocalMeters(
    pts.map((p) => ({ x: p.x, y: p.z })),
    ref,
  );
  return geo.map(([lng, lat]) => [lat, lng]);
}

const BUILDING_COLORS: Record<string, string> = {
  logistics: "#2196f3",
  industrial: "#ff7524",
  cross_dock: "#17a34a",
  distribution_center: "#d72042",
  cold_storage: "#6366f1",
  manufacturing: "#f59e0b",
};

function centroidLocal(poly: { x: number; z: number }[]): { x: number; z: number } {
  const n = poly.length || 1;
  const s = poly.reduce((a, p) => ({ x: a.x + p.x, z: a.z + p.z }), { x: 0, z: 0 });
  return { x: s.x / n, z: s.z / n };
}

const DRAG_ICON = L.divIcon({
  className: "building-drag-handle",
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

// ---- Sub-components ------------------------------------------------------

function FitBounds({ bounds }: { bounds: L.LatLngBounds }) {
  const map = useMap();
  useEffect(() => {
    const fit = () => {
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: MAX_MAP_ZOOM });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map, bounds]);
  return null;
}

// ---- Main component ------------------------------------------------------

export default function LotPreviewMapClient({
  polygon,
  lotRef,
  polygonLocal,
  edges,
  streetEdges,
  buildable,
  setbacks,
  buildings,
  gates,
  hasFitError,
  clearHeight,
  onBuildingMove,
  onBuildingSelect,
  selectedBuildingId,
}: LotPreviewMapProps) {
  const terrainPositions = useMemo(
    () => polygon.map(([lng, lat]) => [lat, lng] as [number, number]),
    [polygon],
  );

  const bounds = useMemo(
    () => L.latLngBounds(terrainPositions),
    [terrainPositions],
  );

  const streetSet = useMemo(() => new Set(streetEdges), [streetEdges]);

  const buildablePositions = useMemo(
    () => (buildable && buildable.length >= 3 ? localToGeo(buildable, lotRef) : null),
    [buildable, lotRef],
  );

  const buildingLayers = useMemo(
    () =>
      buildings.map((b) => ({
        positions: localToGeo(b.polygon, lotRef),
        color: BUILDING_COLORS[b.use] ?? "#2196f3",
        use: b.use,
        name: b.name,
        bbox: polygonBBox(b.polygon),
      })),
    [buildings, lotRef],
  );

  const setbackByEdge = (edgeIdx: number): number => {
    if (streetSet.has(edgeIdx)) return setbacks.front;
    if (streetSet.size > 0) {
      const streetMids = edges
        .filter((e) => streetSet.has(e.index))
        .map((e) => e.mid);
      const avg = streetMids.reduce(
        (a, m) => ({
          x: a.x + m.x / streetMids.length,
          z: a.z + m.z / streetMids.length,
        }),
        { x: 0, z: 0 },
      );
      const others = edges.filter((o) => !streetSet.has(o.index));
      const farthest = others.reduce((a, b) => {
        const da = Math.hypot(a.mid.x - avg.x, a.mid.z - avg.z);
        const db = Math.hypot(b.mid.x - avg.x, b.mid.z - avg.z);
        return db > da ? b : a;
      }, others[0]);
      if (farthest && farthest.index === edgeIdx) return setbacks.back;
    }
    return setbacks.sides;
  };

  return (
    <MapContainer
      bounds={bounds}
      boundsOptions={{ padding: [24, 24] }}
      style={{ width: "100%", height: "100%" }}
      dragging={false}
      scrollWheelZoom={false}
      doubleClickZoom={false}
      touchZoom={false}
      keyboard={false}
      zoomControl={false}
      attributionControl={false}
      maxZoom={MAX_MAP_ZOOM}
    >
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        maxZoom={MAX_MAP_ZOOM}
      />
      <FitBounds bounds={bounds} />

      {/* Terrain polygon */}
      <Polygon
        positions={terrainPositions}
        pathOptions={{
          color: "#ffffff",
          fillColor: "#121212",
          fillOpacity: 0.35,
          weight: 2,
          dashArray: "6 4",
        }}
      />

      {/* Buildable region */}
      {buildablePositions && (
        <Polygon
          positions={buildablePositions}
          pathOptions={{
            color: "#d72042",
            fillColor: "#d72042",
            fillOpacity: 0.08,
            weight: 1,
            dashArray: "4 4",
          }}
        />
      )}

      {/* Edges with street highlight + setback labels */}
      {edges.map((e) => {
        const pos = localToGeo([e.a, e.b], lotRef);
        const isStreet = streetSet.has(e.index);
        const sb = setbackByEdge(e.index);
        return (
          <Polyline
            key={e.index}
            positions={pos}
            pathOptions={{
              color: isStreet ? "#f59e0b" : "rgba(255,255,255,0.5)",
              weight: isStreet ? 4 : 2,
            }}
          >
            <Tooltip
              permanent
              direction="center"
              className="lot-preview-label"
            >
              {sb} m
            </Tooltip>
          </Polyline>
        );
      })}

      {/* Building footprints */}
      {buildingLayers.map((b, i) => {
        const area = b.bbox.width * b.bbox.depth;
        const bld = buildings[i];
        const isSelected = bld && selectedBuildingId === bld.id;
        // Position-dependent key forces Tooltip remount at new center
        const posKey = b.positions.length
          ? `${b.positions[0][0].toFixed(6)},${b.positions[0][1].toFixed(6)}`
          : "";
        return (
          <Polygon
            key={`${bld?.id ?? i}-${posKey}`}
            positions={b.positions}
            pathOptions={{
              color: isSelected
                ? "#ffffff"
                : hasFitError
                  ? "#ef4444"
                  : b.color,
              fillColor: b.color,
              fillOpacity: isSelected ? 0.55 : hasFitError ? 0.35 : 0.45,
              weight: isSelected ? 3 : hasFitError ? 2 : 1.5,
              dashArray: hasFitError && !isSelected ? "6 3" : undefined,
            }}
            eventHandlers={{
              click: () => bld && onBuildingSelect?.(bld.id),
            }}
          >
            {/* <Tooltip
              permanent
              direction="center"
              className="lot-preview-building-label"
            >
              <div style={{ textAlign: "center", lineHeight: 1.3 }}>
                <div style={{ fontSize: 11, opacity: 0.8 }}>
                  {b.bbox.width.toFixed(0)} × {b.bbox.depth.toFixed(0)} m
                </div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  {area.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}{" "}
                  m² · PD {clearHeight} m
                </div>
              </div>
            </Tooltip> */}
          </Polygon>
        );
      })}

      {/* Draggable building handles */}
      {onBuildingMove &&
        buildings.map((b) => {
          const c = centroidLocal(b.polygon);
          const pos = localToGeo([c], lotRef)[0];
          return (
            <Marker
              key={`drag-${b.id}`}
              position={pos}
              icon={DRAG_ICON}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const ll = (e.target as L.Marker).getLatLng();
                  const [pt] = toLocalMeters([[ll.lng, ll.lat]], lotRef);
                  onBuildingMove(b.id, pt.x - c.x, pt.y - c.z);
                },
                click: () => onBuildingSelect?.(b.id),
              }}
            />
          );
        })}

      {/* Gates */}
      {gates.map((g, i) => {
        const e = edges[g.edgeIndex];
        if (!e) return null;
        const ux = (e.b.x - e.a.x) / e.length;
        const uz = (e.b.z - e.a.z) / e.length;
        const cx = e.a.x + (e.b.x - e.a.x) * g.tAlongEdge;
        const cz = e.a.z + (e.b.z - e.a.z) * g.tAlongEdge;
        const hw = g.width / 2;
        const gateLocal = [
          { x: cx - ux * hw, z: cz - uz * hw },
          { x: cx + ux * hw, z: cz + uz * hw },
        ];
        const pos = localToGeo(gateLocal, lotRef);
        return (
          <Polyline
            key={`gate-${i}`}
            positions={pos}
            pathOptions={{
              color: "#f59e0b",
              weight: 5,
              lineCap: "round",
            }}
          />
        );
      })}
    </MapContainer>
  );
}
