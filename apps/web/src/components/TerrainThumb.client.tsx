"use client";

/**
 * TerrainThumb.client.tsx — miniatura satélite com polígono do terreno
 * (e silhueta opcional do galpão) usada em cards e seções de listagem.
 * Não-interativo (drag/zoom desligados) para servir como "imagem".
 */
import { MapContainer, TileLayer, Polygon } from "react-leaflet";
import L from "leaflet";
import type { LngLat } from "@/lib/geo";
import { MAX_MAP_ZOOM } from "@/lib/geo";

export interface BuildingFootprint {
  width: number; // m, eixo leste-oeste
  depth: number; // m, eixo norte-sul
}

interface Props {
  polygon: LngLat[];
  building?: BuildingFootprint | null;
  /** Permite arrastar/zoom (default false = miniatura estática). */
  interactive?: boolean;
}

const METERS_PER_DEG_LAT = 111_320;

function metersToLatDeg(m: number) {
  return m / METERS_PER_DEG_LAT;
}
function metersToLngDeg(m: number, lat: number) {
  return m / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
}

export default function TerrainThumbClient({ polygon, building, interactive = false }: Props) {
  if (!polygon || polygon.length < 3) {
    return <div className="map-placeholder" />;
  }
  const positions = polygon.map(([lng, lat]) => [lat, lng] as [number, number]);
  const bounds = L.latLngBounds(positions);
  const cLat = (bounds.getNorth() + bounds.getSouth()) / 2;
  const cLng = (bounds.getEast() + bounds.getWest()) / 2;

  let buildingPositions: [number, number][] | null = null;
  if (building && building.width > 0 && building.depth > 0) {
    const halfLat = metersToLatDeg(building.depth / 2);
    const halfLng = metersToLngDeg(building.width / 2, cLat);
    buildingPositions = [
      [cLat - halfLat, cLng - halfLng],
      [cLat + halfLat, cLng - halfLng],
      [cLat + halfLat, cLng + halfLng],
      [cLat - halfLat, cLng + halfLng],
    ];
  }

  return (
    <MapContainer
      bounds={bounds}
      boundsOptions={{ padding: [12, 12] }}
      style={{ width: "100%", height: "100%" }}
      dragging={interactive}
      scrollWheelZoom={interactive}
      doubleClickZoom={interactive}
      touchZoom={interactive}
      keyboard={interactive}
      zoomControl={interactive}
      attributionControl={interactive}
      maxZoom={MAX_MAP_ZOOM}
    >
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        maxZoom={MAX_MAP_ZOOM}
      />
      <Polygon
        positions={positions}
        pathOptions={{
          color: "#D72042",
          fillColor: "#D72042",
          fillOpacity: 0.12,
          weight: 2,
          dashArray: "6 4",
        }}
      />
      {buildingPositions && (
        <Polygon
          positions={buildingPositions}
          pathOptions={{
            color: "#FF7524",
            fillColor: "#FF7524",
            fillOpacity: 0.55,
            weight: 1.4,
          }}
        />
      )}
    </MapContainer>
  );
}
