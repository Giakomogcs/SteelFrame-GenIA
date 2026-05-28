import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@sfg/db";
import type { LngLat } from "@/lib/geo";
import BriefingClient from "./BriefingClient";

export const dynamic = "force-dynamic";

export default async function BriefingPage({
  params,
}: {
  params: { id: string };
}) {
  const terrain = await prisma.terrain.findUnique({ where: { id: params.id } });
  if (!terrain) notFound();

  const polygon = terrain.polygon as unknown as LngLat[];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            href={`/terrenos/${terrain.id}`}
            className="text-xs text-[#ff3d6a] hover:underline"
          >
            ← Voltar para {terrain.name}
          </Link>
          <span className="dt-status-pill mt-2 mb-2 inline-flex">
            Agente Pré-Projeto · Steel Frame Industrial
          </span>
          <h1 className="text-3xl font-extrabold uppercase tracking-tight text-white">
            Briefing com IA
          </h1>
          <p className="text-sm text-white/60">
            Descreva o galpão e o agente gera o modelo 3D paramétrico,
            estimativa de custo (SINAPI/CUB) e conformidade NBR.
          </p>
        </div>
      </div>

      <BriefingClient
        terrainId={terrain.id}
        terrainName={terrain.name}
        terrainAddress={terrain.address}
        areaM2={terrain.areaM2}
        polygon={polygon}
      />

      <p className="rounded-md border border-white/10 bg-white/5 p-3 text-[11px] text-white/60">
        ⚠️ Esta estimativa é preliminar e serve para estudo de viabilidade. Não
        substitui projeto arquitetônico, estrutural, ART/RRT, orçamento
        executivo, sondagem, levantamento topográfico, aprovação legal ou
        consulta formal a fornecedores.
      </p>
    </div>
  );
}
