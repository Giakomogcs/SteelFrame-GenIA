"use client";

import dynamic from "next/dynamic";
import type { LngLat } from "@/lib/geo";

const Inner = dynamic(() => import("./MapBackground.client"), {
  ssr: false,
  loading: () => <div className="map-placeholder" />,
});

interface Props {
  bounds: [LngLat, LngLat];
}

export default function MapBackground(props: Props) {
  return <Inner {...props} />;
}
