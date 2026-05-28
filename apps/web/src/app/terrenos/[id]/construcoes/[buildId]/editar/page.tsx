import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@sfg/db";
import { Breadcrumb } from "@/components/Breadcrumb";
import ShedInlineEditor from "@/components/ShedInlineEditor";
import { isIndustrialShed, type IndustrialShed } from "@/lib/shedSchema";
import type { LngLat } from "@/lib/geo";

export const dynamic = "force-dynamic";

export default async function EditBuildingPage({
  params,
}: {
  params: { id: string; buildId: string };
}) {
  const building = await prisma.building.findUnique({
    where: { id: params.buildId },
    include: { terrain: true },
  });
  if (!building || building.terrainId !== params.id) notFound();
  const raw = building.model as unknown;
  if (!isIndustrialShed(raw)) notFound();
  const shed = raw as IndustrialShed;
  const polygon = building.terrain.polygon as unknown as LngLat[];

  return (
    <>
      <header className="page-header">
        <div className="stack-sm">
          <Breadcrumb
            items={[
              { label: "Meus terrenos", href: "/" },
              {
                label: building.terrain.name,
                href: `/terrenos/${building.terrainId}`,
              },
              {
                label: building.name,
                href: `/terrenos/${building.terrainId}/construcoes/${building.id}`,
              },
              { label: "Editor inline" },
            ]}
          />
          <div className="page-title-row">
            <h1>Editar medidas · {building.name}</h1>
            <span className="pill pill-warning">
              <span className="dot" />
              Modo edição
            </span>
          </div>
        </div>
        <div className="row">
          <Link
            href={`/terrenos/${building.terrainId}/construcoes/${building.id}`}
            className="btn btn-ghost"
          >
            ← Voltar
          </Link>
        </div>
      </header>

      <ShedInlineEditor
        terrainId={building.terrainId}
        buildingId={building.id}
        initial={shed}
        polygon={polygon}
      />
    </>
  );
}
