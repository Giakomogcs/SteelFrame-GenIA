"use client";

/**
 * TerrainThumb.client.tsx — miniatura satélite com polígono do terreno
 * (e silhueta opcional do galpão) usada em cards e seções de listagem.
 * Não-interativo (drag/zoom desligados) para servir como "imagem".
 */
import { useEffect } from "react";
import { MapContainer, TileLayer, Polygon, useMap } from "react-leaflet";
import L from "leaflet";
import type { LngLat } from "@/lib/geo";
import { MAX_MAP_ZOOM } from "@/lib/geo";

/**
 * Reenquadra o mapa nos bounds passados sempre que o container muda de
 * tamanho (flex/grid layouts comuns) ou os bounds mudam. Sem isso o
 * Leaflet mantém o zoom inicial e o terreno aparece minúsculo ou
 * recortado depois que a área final do painel é definida.
 */
function FitBounds({ bounds }: { bounds: L.LatLngBounds }) {
  const map = useMap();
  useEffect(() => {
    const fit = () => {
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [16, 16], maxZoom: MAX_MAP_ZOOM });
    };
    fit();
    const container = map.getContainer();
    const ro = new ResizeObserver(fit);
    ro.observe(container);
    return () => ro.disconnect();
  }, [map, bounds]);
  return null;
}

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

export default function TerrainThumbClient({
  polygon,
  building,
  interactive = false,
}: Props) {
  if (!polygon || polygon.length < 3) {
    return <div className="map-placeholder" />;
  }
  const positions = polygon.map(([lng, lat]) => [lat, lng] as [number, number]);
  const polyBounds = L.latLngBounds(positions);
  const cLat = (polyBounds.getNorth() + polyBounds.getSouth()) / 2;
  const cLng = (polyBounds.getEast() + polyBounds.getWest()) / 2;

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

  // Garante que o footprint do galpão (quando maior que o lote em algum
  // eixo) também caiba dentro do enquadramento.
  const bounds = buildingPositions
    ? L.latLngBounds(positions).extend(L.latLngBounds(buildingPositions))
    : polyBounds;

  return (
    <MapContainer
      bounds={bounds}
      boundsOptions={{ padding: [16, 16] }}
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
      <FitBounds bounds={bounds} />
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
