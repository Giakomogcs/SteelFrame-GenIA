"use client";

import dynamic from "next/dynamic";
import type { IndustrialShed } from "@/lib/shedSchema";
import type { LngLat } from "@/lib/geo";

const ShedViewer = dynamic(() => import("./ShedViewer.client"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[70vh] items-center justify-center rounded-xl border border-white/10 bg-slate-900 text-slate-400">
      Carregando viewer 3D…
    </div>
  ),
});

export interface ShedViewerProps {
  shed: IndustrialShed;
  polygon?: LngLat[];
  height?: string;
}

export default function ShedViewerEntry(props: ShedViewerProps) {
  return <ShedViewer {...props} />;
}
