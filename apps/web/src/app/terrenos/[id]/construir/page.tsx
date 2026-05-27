import { notFound } from "next/navigation";
import { prisma } from "@sfg/db";
import { BuildWizard } from "@/components/BuildWizard";

export const dynamic = "force-dynamic";

export default async function BuildPage({
  params,
}: {
  params: { id: string };
}) {
  const terrain = await prisma.terrain.findUnique({ where: { id: params.id } });
  if (!terrain) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Construir em {terrain.name}</h1>
        <p className="text-sm text-slate-400">
          Configure os parâmetros para gerar o modelo 3D do galpão steel frame.
        </p>
      </div>
      <BuildWizard terrainId={terrain.id} />
    </div>
  );
}
