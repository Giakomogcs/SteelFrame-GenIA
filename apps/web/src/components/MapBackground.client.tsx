"use client";

/**
 * MapBackground.client.tsx — camada de tiles satélite (Leaflet) que se
 * enquadra exatamente nos bounds lat/lng fornecidos, sem polígonos,
 * controles ou padding. Usada como pano de fundo de SVGs georreferenciados
 * (ex.: pré-visualização 2D do briefing) para que satellite e SVG fiquem
 * com a mesma escala e orientação.
 */
import { useEffect } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { LngLat } from "@/lib/geo";
import { MAX_MAP_ZOOM } from "@/lib/geo";

interface Props {
  /** [southWest, northEast] em [lng, lat]. */
  bounds: [LngLat, LngLat];
}

function FitExact({ bounds }: { bounds: L.LatLngBounds }) {
  const map = useMap();
  useEffect(() => {
    const fit = () => {
      map.invalidateSize();
      // padding 0 e animação desativada — alinhamento pixel-perfect ao SVG
      map.fitBounds(bounds, {
        padding: [0, 0],
        animate: false,
        maxZoom: MAX_MAP_ZOOM,
      });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map, bounds]);
  return null;
}

export default function MapBackgroundClient({ bounds }: Props) {
  const [sw, ne] = bounds;
  const llBounds = L.latLngBounds(
    [sw[1], sw[0]],
    [ne[1], ne[0]],
  );
  return (
    <MapContainer
      bounds={llBounds}
      boundsOptions={{ padding: [0, 0] }}
      style={{ width: "100%", height: "100%" }}
      dragging={false}
      scrollWheelZoom={false}
      doubleClickZoom={false}
      touchZoom={false}
      keyboard={false}
      zoomControl={false}
      attributionControl={false}
      zoomSnap={0}
      zoomDelta={0.1}
      maxZoom={MAX_MAP_ZOOM}
    >
      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        maxZoom={MAX_MAP_ZOOM}
      />
      <FitExact bounds={llBounds} />
    </MapContainer>
  );
}
