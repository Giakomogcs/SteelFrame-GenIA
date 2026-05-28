import dynamic from "next/dynamic";
import type { LotPreviewMapProps } from "./LotPreviewMap.client";

const Inner = dynamic(() => import("./LotPreviewMap.client"), {
  ssr: false,
  loading: () => <div className="map-placeholder" />,
});

export type { LotPreviewMapProps };

export default function LotPreviewMap(props: LotPreviewMapProps) {
  return <Inner {...props} />;
}
