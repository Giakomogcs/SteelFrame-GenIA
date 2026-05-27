import Link from "next/link";
import type { Terrain, Building } from "@sfg/db";

interface Props {
  terrain: Terrain & { buildings: Building[] };
}

export function TerrainCard({ terrain }: Props) {
  return (
    <div className="dt-card group flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-2 pl-2">
        <div>
          <h3 className="font-semibold leading-tight tracking-tight text-white">
            {terrain.name}
          </h3>
          {terrain.address && (
            <p className="text-xs text-white/60">{terrain.address}</p>
          )}
        </div>
        <span className="rounded-full border border-brand-500/40 bg-brand-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-brand-400">
          {terrain.areaM2.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} m²
        </span>
      </div>

      <div className="pl-2 text-xs uppercase tracking-wider text-white/50">
        {terrain.buildings.length} construção(ões) gerada(s)
      </div>

      <div className="mt-auto flex gap-2 pt-2 pl-2">
        <Link
          href={`/terrenos/${terrain.id}`}
          className="dt-btn-ghost flex-1 text-sm"
        >
          Abrir
        </Link>
        <Link
          href={`/terrenos/${terrain.id}/construir`}
          className="dt-btn-primary flex-1 text-sm"
        >
          Construir
        </Link>
      </div>
    </div>
  );
}
