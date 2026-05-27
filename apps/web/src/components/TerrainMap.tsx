"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type TerrainMapClient from "./TerrainMap.client";

// Leaflet só roda no client — carregamos com dynamic + ssr:false
const TerrainMap = dynamic(() => import("./TerrainMap.client"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[60vh] w-full items-center justify-center rounded-xl border border-white/10 bg-slate-900 text-slate-400">
      Carregando mapa…
    </div>
  ),
});

export type TerrainMapProps = ComponentProps<typeof TerrainMapClient>;
export default TerrainMap;
