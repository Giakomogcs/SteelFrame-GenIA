"use client";

import dynamic from "next/dynamic";

const SteelFrameViewer = dynamic(() => import("./SteelFrameViewer.client"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[70vh] items-center justify-center rounded-xl border border-white/10 bg-slate-900 text-slate-400">
      Carregando 3D…
    </div>
  ),
});

export default SteelFrameViewer;
