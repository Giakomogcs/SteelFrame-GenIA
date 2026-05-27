import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@sfg/db";
import SteelFrameViewer from "@/components/SteelFrameViewer";
import type { SteelFrameModel } from "@/lib/steelframe";
import type { LngLat } from "@/lib/geo";

export const dynamic = "force-dynamic";

export default async function BuildingPage({
  params,
}: {
  params: { id: string; buildId: string };
}) {
  const building = await prisma.building.findUnique({
    where: { id: params.buildId },
    include: { terrain: true },
  });
  if (!building || building.terrainId !== params.id) notFound();

  const model = building.model as unknown as SteelFrameModel;
  const polygon = building.terrain.polygon as unknown as LngLat[];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/terrenos/${building.terrainId}`}
            className="text-xs text-brand-400 hover:underline"
          >
            ← Voltar para {building.terrain.name}
          </Link>
          <h1 className="text-2xl font-semibold">{building.name}</h1>
          <p className="text-sm text-slate-400">
            {model.footprint.width.toFixed(1)} × {model.footprint.depth.toFixed(1)} m ·{" "}
            {model.footprint.areaM2.toLocaleString("pt-BR")} m² · {model.bays} pórticos
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-slate-900/60 px-4 py-3 text-right text-sm">
          <div className="text-slate-400">Custo estimado</div>
          <div className="text-lg font-semibold text-emerald-400">
            R$ {model.estimatedCost.toLocaleString("pt-BR")}
          </div>
          <div className="text-xs text-slate-500">
            ~{model.estimatedSteelKg.toLocaleString("pt-BR")} kg de aço
          </div>
        </div>
      </div>

      <SteelFrameViewer model={model} polygon={polygon} />

      <div className="text-xs text-slate-500">
        Use o mouse para orbitar, scroll para zoom e botão direito para pan.
      </div>
    </div>
  );
}
