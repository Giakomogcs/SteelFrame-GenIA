import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@sfg/db";
import { TerrainEditClient } from "./TerrainEditClient";
import { Breadcrumb } from "@/components/Breadcrumb";
import { DeleteBuildingButton } from "@/components/DeleteBuildingButton";
import ReliefPanel from "@/components/ReliefPanel";
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
  const shortId = terrain.id.slice(-6).toUpperCase();
  const buildingsTotalCost = terrain.buildings.reduce((s, b) => {
    const m = b.model as { estimate?: { totalCost?: number } } | null;
    return s + (m?.estimate?.totalCost ?? 0);
  }, 0);
  const coveredArea = terrain.buildings.reduce((s, b) => {
    const m = b.model as { estimate?: { coveredAreaM2?: number } } | null;
    return s + (m?.estimate?.coveredAreaM2 ?? 0);
  }, 0);

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

      {/* Mapa + galpões estudados (rail lateral) */}
      <section className="terrain-workspace">
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <TerrainEditClient
            id={terrain.id}
            initialPolygon={polygon}
            initialCenter={[terrain.centerLng, terrain.centerLat]}
          />
        </div>

        <aside className="buildings-rail">
          <div className="row-between">
            <h2 style={{ fontSize: "var(--fs-md)", margin: 0 }}>
              Galpões estudados
              <span
                className="muted mono"
                style={{ marginLeft: 8, fontSize: "var(--fs-xs)" }}
              >
                {terrain.buildings.length}
              </span>
            </h2>
            <Link
              href={`/terrenos/${terrain.id}/briefing`}
              className="btn btn-secondary btn-sm"
            >
              + Novo
            </Link>
          </div>

          {terrain.buildings.length === 0 ? (
            <div className="card empty" style={{ padding: "var(--space-4)" }}>
              <div className="empty-icon">🏗️</div>
              <div className="empty-title" style={{ fontSize: "var(--fs-sm)" }}>
                Nenhum estudo
              </div>
              <div className="empty-desc" style={{ fontSize: "var(--fs-xs)" }}>
                Inicie um briefing com a IA para gerar o primeiro modelo 3D.
              </div>
              <Link
                href={`/terrenos/${terrain.id}/briefing`}
                className="btn btn-primary btn-sm"
              >
                Iniciar briefing
              </Link>
            </div>
          ) : (
            <div className="buildings-list">
              {terrain.buildings.map((b) => {
                const m = b.model as {
                  estimate?: { totalCost?: number; coveredAreaM2?: number };
                  footprint?: { width?: number; depth?: number };
                  use?: string;
                } | null;
                return (
                  <div key={b.id} className="building-card">
                    <Link
                      href={`/terrenos/${terrain.id}/construcoes/${b.id}`}
                      className="building-card-body"
                    >
                      <div className="card-row">
                        <div style={{ minWidth: 0 }}>
                          <div
                            className="card-title"
                            style={{ fontSize: "var(--fs-sm)" }}
                          >
                            {b.name}
                          </div>
                          <div className="card-subtitle">
                            {new Date(b.createdAt).toLocaleDateString("pt-BR", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </div>
                        </div>
                        <span className="pill pill-success">
                          <span className="dot" />
                          Ativo
                        </span>
                      </div>
                      <div className="grid-2" style={{ gap: "var(--space-2)" }}>
                        <div>
                          <div className="text-xs muted mono">Footprint</div>
                          <div className="mono" style={{ fontWeight: 600 }}>
                            {m?.footprint?.width?.toFixed(0) ?? "—"} ×{" "}
                            {m?.footprint?.depth?.toFixed(0) ?? "—"} m
                          </div>
                        </div>
                        <div>
                          <div className="text-xs muted mono">Custo est.</div>
                          <div className="mono" style={{ fontWeight: 600 }}>
                            R${" "}
                            {(m?.estimate?.totalCost ?? 0).toLocaleString(
                              "pt-BR",
                            )}
                          </div>
                        </div>
                      </div>
                    </Link>
                    <DeleteBuildingButton
                      terrainId={terrain.id}
                      buildingId={b.id}
                      buildingName={b.name}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </section>

      <ReliefPanel
        terrainId={terrain.id}
        areaM2={terrain.areaM2}
        initial={{
          slopePct: terrain.slopePct,
          elevationDelta: terrain.elevationDelta,
          elevationMean: terrain.elevationMean,
          profile:
            (terrain.elevationProfile as { d: number; h: number }[] | null) ??
            null,
        }}
      />
    </>
  );
}
