"use client";

import dynamic from "next/dynamic";
import type { LngLat } from "@/lib/geo";
import type { BuildingFootprint } from "./TerrainThumb.client";

const Inner = dynamic(() => import("./TerrainThumb.client"), {
  ssr: false,
  loading: () => <div className="map-placeholder" />,
});

interface Props {
  polygon: LngLat[];
  building?: BuildingFootprint | null;
  interactive?: boolean;
  /** Hide Leaflet polygons (useful when an SVG overlay draws them). */
  showPolygon?: boolean;
}

export default function TerrainThumb(props: Props) {
  return <Inner {...props} />;
}
