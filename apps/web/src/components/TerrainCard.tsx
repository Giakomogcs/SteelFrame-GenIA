import Link from "next/link";
import type { Terrain, Building } from "@sfg/db";

interface Props {
  terrain: Terrain & { buildings: Building[] };
}

export function TerrainCard({ terrain }: Props) {
  return (
    <div className="group flex flex-col gap-3 rounded-xl border border-white/10 bg-slate-900/60 p-5 transition hover:border-brand-500/60 hover:bg-slate-900">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold leading-tight">{terrain.name}</h3>
          {terrain.address && (
            <p className="text-xs text-slate-400">{terrain.address}</p>
          )}
        </div>
        <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-xs text-brand-500">
          {terrain.areaM2.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} m²
        </span>
      </div>

      <div className="text-xs text-slate-400">
        {terrain.buildings.length} construção(ões) gerada(s)
      </div>

      <div className="mt-auto flex gap-2 pt-2">
        <Link
          href={`/terrenos/${terrain.id}`}
          className="flex-1 rounded-md bg-white/5 px-3 py-2 text-center text-sm hover:bg-white/10"
        >
          Abrir
        </Link>
        <Link
          href={`/terrenos/${terrain.id}/construir`}
          className="flex-1 rounded-md bg-brand-600 px-3 py-2 text-center text-sm font-medium hover:bg-brand-500"
        >
          Construir
        </Link>
      </div>
    </div>
  );
}
