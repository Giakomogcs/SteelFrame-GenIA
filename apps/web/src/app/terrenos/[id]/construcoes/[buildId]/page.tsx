import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@sfg/db";
import SteelFrameViewer from "@/components/SteelFrameViewer";
import ShedViewer from "@/components/ShedViewer";
import type { SteelFrameModel } from "@/lib/steelframe";
import { isIndustrialShed, type IndustrialShed } from "@/lib/shedSchema";
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

  const polygon = building.terrain.polygon as unknown as LngLat[];
  const raw = building.model as unknown;

  // Novo: galpão paramétrico industrial gerado pela IA
  if (isIndustrialShed(raw)) {
    const shed = raw as IndustrialShed;
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link
              href={`/terrenos/${building.terrainId}`}
              className="text-xs text-[#ff3d6a] hover:underline"
            >
              ← Voltar para {building.terrain.name}
            </Link>
            <h1 className="text-2xl font-bold uppercase tracking-tight text-white">
              {building.name}
            </h1>
            <p className="text-sm text-white/60">
              {shed.footprint.width.toFixed(1)} ×{" "}
              {shed.footprint.depth.toFixed(1)} m ·{" "}
              {shed.estimate.coveredAreaM2.toLocaleString("pt-BR")} m² ·{" "}
              {shed.structure.bayCount} pórticos · pé-direito{" "}
              {shed.structure.clearHeight} m
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-[#1f1c23] px-4 py-3 text-right text-sm">
            <div className="text-white/60">Custo estimado</div>
            <div className="text-lg font-bold text-[#ff3d6a]">
              R$ {shed.estimate.totalCost.toLocaleString("pt-BR")}
            </div>
            <div className="text-xs text-white/50">
              R$ {shed.estimate.costPerM2.toLocaleString("pt-BR")} /m² ·{" "}
              {shed.estimate.steelKg.toLocaleString("pt-BR")} kg aço
            </div>
          </div>
        </div>

        <ShedViewer shed={shed} polygon={polygon} />

        <section className="grid gap-3 text-xs text-white/70 sm:grid-cols-2 lg:grid-cols-4">
          <Block title="Uso">{shed.use}</Block>
          <Block title="Padrão">{shed.standard}</Block>
          <Block title="Cobertura">
            {shed.roof.type} · {shed.roof.cover.replace(/_/g, " ")}
          </Block>
          <Block title="Fechamento">
            {shed.envelope.walls.replace(/_/g, " ")} · isolamento{" "}
            {shed.envelope.insulation}
          </Block>
          <Block title="Docas">{shed.docks.length}</Block>
          <Block title="Mezanino">{shed.mezzanine ? "Sim" : "Não"}</Block>
          <Block title="Aberturas">{shed.openings.length}</Block>
          <Block title="AVCB">
            {shed.safety.avcbRequired ? "Obrigatório" : "Dispensado"}
          </Block>
        </section>

        {shed.assumptions.length > 0 && (
          <details className="rounded-md border border-white/10 bg-white/5 p-3 text-xs text-white/70">
            <summary className="cursor-pointer font-semibold text-white/80">
              Premissas adotadas pelo agente ({shed.assumptions.length})
            </summary>
            <ul className="mt-2 ml-4 list-disc space-y-1">
              {shed.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </details>
        )}

        <p className="rounded-md border border-white/10 bg-white/5 p-3 text-[11px] text-white/60">
          ⚠️ Estimativa preliminar (SINAPI/CUB · NBR{" "}
          {shed.compliance.norms.join(" · ")}). Não substitui projeto executivo,
          ART/RRT, sondagem, levantamento topográfico ou aprovação legal.
        </p>
      </div>
    );
  }

  // Compatibilidade: modelos antigos (steel-frame heurístico)
  const model = raw as SteelFrameModel;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/terrenos/${building.terrainId}`}
            className="text-xs text-[#ff3d6a] hover:underline"
          >
            ← Voltar para {building.terrain.name}
          </Link>
          <h1 className="text-2xl font-semibold">{building.name}</h1>
          <p className="text-sm text-slate-400">
            {model.footprint.width.toFixed(1)} ×{" "}
            {model.footprint.depth.toFixed(1)} m ·{" "}
            {model.footprint.areaM2.toLocaleString("pt-BR")} m² · {model.bays}{" "}
            pórticos
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

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-[#1f1c23] p-3">
      <div className="text-[10px] uppercase tracking-wide text-white/50">
        {title}
      </div>
      <div className="mt-1 text-sm font-semibold text-white">{children}</div>
    </div>
  );
}
