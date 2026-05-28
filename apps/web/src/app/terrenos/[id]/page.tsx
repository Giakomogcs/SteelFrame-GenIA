import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@sfg/db";
import TerrainMap from "@/components/TerrainMap";
import { TerrainEditClient } from "./TerrainEditClient";
import type { LngLat } from "@/lib/geo";

export const dynamic = "force-dynamic";

export default async function TerrainPage({
  params,
}: {
  params: { id: string };
}) {
  const terrain = await prisma.terrain.findUnique({
    where: { id: params.id },
    include: { buildings: { orderBy: { createdAt: "desc" } } },
  });
  if (!terrain) notFound();

  const polygon = terrain.polygon as unknown as LngLat[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{terrain.name}</h1>
          {terrain.address && (
            <p className="text-sm text-slate-400">{terrain.address}</p>
          )}
          <p className="text-sm text-brand-400">
            {terrain.areaM2.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} m²
            · {terrain.buildings.length} construção(ões)
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/terrenos/${terrain.id}/briefing`}
            className="dt-btn-primary text-sm"
          >
            ✨ Briefing com IA
          </Link>
          <Link
            href={`/terrenos/${terrain.id}/construir`}
            className="rounded-md bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20"
          >
            Wizard rápido
          </Link>
        </div>
      </div>

      <TerrainEditClient
        id={terrain.id}
        initialPolygon={polygon}
        initialCenter={[terrain.centerLng, terrain.centerLat]}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Construções neste terreno</h2>
        {terrain.buildings.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 bg-slate-900/40 p-6 text-center text-slate-400">
            Nenhuma construção gerada. Clique em <b>Construir</b> para iniciar o wizard.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {terrain.buildings.map((b) => (
              <Link
                key={b.id}
                href={`/terrenos/${terrain.id}/construcoes/${b.id}`}
                className="rounded-xl border border-white/10 bg-slate-900/60 p-4 hover:border-brand-500/60"
              >
                <h3 className="font-medium">{b.name}</h3>
                <p className="mt-1 text-xs text-slate-400">
                  Criado em {new Date(b.createdAt).toLocaleDateString("pt-BR")}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
