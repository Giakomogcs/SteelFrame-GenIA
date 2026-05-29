import Link from "next/link";
import { notFound } from "next/navigation";
import type { ComponentProps } from "react";
import { prisma } from "@sfg/db";
import { TerrainEditClient } from "./TerrainEditClient";
import { Breadcrumb } from "@/components/Breadcrumb";
import BuildingsGallery from "@/components/BuildingsGallery";
import ReliefPanel from "@/components/ReliefPanel";
import type { LngLat } from "@/lib/geo";
import { summarizeBuildingCost } from "@/lib/buildingCost";

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
  const shortId = terrain.id.slice(-6).toUpperCase();
  const { buildingsTotalCost, coveredArea } = terrain.buildings.reduce(
    (acc, b) => {
      const { cost, covered } = summarizeBuildingCost(b.model);
      acc.buildingsTotalCost += cost;
      acc.coveredArea += covered;
      return acc;
    },
    { buildingsTotalCost: 0, coveredArea: 0 },
  );

  return (
    <>
      <header className="page-header">
        <div className="stack-sm">
          <Breadcrumb
            items={[
              { label: "Meus terrenos", href: "/" },
              { label: `${terrain.name} · #SF-${shortId}` },
            ]}
          />
          <div className="page-title-row">
            <h1>{terrain.name}</h1>
            <span className="pill pill-success">
              <span className="dot" />
              {terrain.buildings.length > 0
                ? `${terrain.buildings.length} estudo(s)`
                : "Aguardando briefing"}
            </span>
            <span className="pill pill-neutral mono">#SF-{shortId}</span>
          </div>
          {terrain.address && (
            <p className="text-sm muted">{terrain.address}</p>
          )}
        </div>
        <div className="row">
          <Link href="/" className="btn btn-ghost">
            ← Carteira
          </Link>
          <Link
            href={`/terrenos/${terrain.id}/briefing`}
            className="btn btn-primary"
          >
            <svg
              className="icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7.4-6.3-4.6-6.3 4.6 2.3-7.4-6-4.6h7.6z" />
            </svg>
            Novo briefing com IA
          </Link>
        </div>
      </header>

      {/* KPI strip */}
      <section className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Área do lote</div>
          <div className="kpi-value">
            {Math.round(terrain.areaM2).toLocaleString("pt-BR")}
            <span className="unit">m²</span>
          </div>
          <div className="kpi-delta">{polygon.length} vértices</div>
        </div>
        <div className="kpi accent">
          <div className="kpi-label">Custo consolidado</div>
          <div className="kpi-value">
            R${" "}
            {buildingsTotalCost > 0
              ? (buildingsTotalCost / 1_000_000).toLocaleString("pt-BR", {
                  maximumFractionDigits: 2,
                })
              : "—"}
            <span className="unit">M</span>
          </div>
          <div className="kpi-delta">SINAPI / CUB · prévia</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Área coberta</div>
          <div className="kpi-value">
            {Math.round(coveredArea).toLocaleString("pt-BR")}
            <span className="unit">m²</span>
          </div>
          <div className="kpi-delta">soma dos galpões estudados</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Construções</div>
          <div className="kpi-value">
            {terrain.buildings.length}
            <span className="unit">estudos</span>
          </div>
          <div className="kpi-delta">
            {terrain.buildings.length > 0
              ? `último: ${new Date(terrain.buildings[0].createdAt).toLocaleDateString("pt-BR")}`
              : "aguardando"}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Relevo</div>
          <div className="kpi-value">
            {terrain.slopePct != null ? terrain.slopePct.toFixed(1) : "—"}
            <span className="unit">%</span>
          </div>
          <div className="kpi-delta">
            {terrain.elevationDelta != null
              ? `desnível ${terrain.elevationDelta.toFixed(2)} m`
              : "medir abaixo"}
          </div>
        </div>
      </section>

      {/* Mapa do terreno */}
      <section className="terrain-map-section">
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <TerrainEditClient
            id={terrain.id}
            initialPolygon={polygon}
            initialCenter={[terrain.centerLng, terrain.centerLat]}
          />
        </div>
      </section>

      {/* Galeria de construções: thumb visual + 3D + dash de custos */}
      <BuildingsGallery
        terrainId={terrain.id}
        terrainName={terrain.name}
        polygon={polygon}
        buildings={terrain.buildings.map((b) => ({
          id: b.id,
          name: b.name,
          createdAt: b.createdAt.toISOString(),
          model: b.model,
        }))}
      />

      <ReliefPanel
        terrainId={terrain.id}
        areaM2={terrain.areaM2}
        initial={{
          slopePct: terrain.slopePct,
          elevationDelta: terrain.elevationDelta,
          elevationMean: terrain.elevationMean,
          profile:
            (terrain.elevationProfile as ComponentProps<
              typeof ReliefPanel
            >["initial"]["profile"]) ?? null,
        }}
      />
    </>
  );
}
