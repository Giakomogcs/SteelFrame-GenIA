import Link from "next/link";
import { prisma } from "@sfg/db";
import { TerrainsExplorer } from "@/components/TerrainsExplorer";
import { Breadcrumb } from "@/components/Breadcrumb";
import { summarizeBuildingCost } from "@/lib/buildingCost";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const terrains = await prisma.terrain.findMany({
    include: { buildings: true, briefings: true },
    orderBy: { createdAt: "desc" },
  });

  const totalArea = terrains.reduce((s, t) => s + t.areaM2, 0);
  const { totalCost, totalCovered } = terrains.reduce(
    (acc, t) => {
      for (const b of t.buildings) {
        const { cost, covered } = summarizeBuildingCost(b.model);
        acc.totalCost += cost;
        acc.totalCovered += covered;
      }
      return acc;
    },
    { totalCost: 0, totalCovered: 0 },
  );
  const totalBuildings = terrains.reduce((s, t) => s + t.buildings.length, 0);
  const avgPerM2 = totalCovered > 0 ? Math.round(totalCost / totalCovered) : 0;

  const viaveis = terrains.filter((t) => t.buildings.length > 0).length;
  const emBriefing = terrains.filter(
    (t) =>
      t.buildings.length === 0 &&
      t.briefings.some(
        (b) =>
          b.status === "active" ||
          b.status === "draft" ||
          b.status === "paused",
      ),
  ).length;
  const semBriefing = terrains.length - viaveis - emBriefing;

  return (
    <>
      <header className="page-header">
        <div className="stack-sm">
          <Breadcrumb items={[{ label: "Meus terrenos" }]} />
          <div className="page-title-row">
            <h1>
              {terrains.length} terreno{terrains.length === 1 ? "" : "s"} em
              estudo
            </h1>
            {viaveis > 0 && (
              <span className="pill pill-success">
                <span className="dot" />
                {viaveis} viável{viaveis === 1 ? "" : "is"}
              </span>
            )}
            {emBriefing > 0 && (
              <span className="pill pill-warning">
                <span className="dot" />
                {emBriefing} em briefing
              </span>
            )}
            {semBriefing > 0 && (
              <span className="pill pill-neutral">
                <span className="dot" />
                {semBriefing} sem briefing
              </span>
            )}
          </div>
          <p
            className="text-sm muted"
            style={{ marginTop: "var(--space-2)", maxWidth: "64ch" }}
          >
            Carteira focada em galpões steel frame para uso logístico e
            industrial — cadastre terrenos pelo mapa de satélite e gere modelos
            3D paramétricos com IA.
          </p>
        </div>
        <div className="row">
          <Link href="/terrenos/novo" className="btn btn-primary">
            <svg
              className="icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Novo terreno
          </Link>
        </div>
      </header>

      {/* KPI summary */}
      <section className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Área total dos terrenos</div>
          <div className="kpi-value">
            {Math.round(totalArea).toLocaleString("pt-BR")}
            <span className="unit">m²</span>
          </div>
          <div className="kpi-delta">
            {terrains.length} lote{terrains.length === 1 ? "" : "s"} cadastrado
            {terrains.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="kpi accent">
          <div className="kpi-label">Custo estimado consolidado</div>
          <div className="kpi-value">
            R${" "}
            {totalCost > 0
              ? (totalCost / 1_000_000).toLocaleString("pt-BR", {
                  maximumFractionDigits: 1,
                })
              : "0"}
            <span className="unit">M</span>
          </div>
          <div className="kpi-delta">SINAPI / CUB · prévia</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Custo médio / m² coberto</div>
          <div className="kpi-value">
            R$ {avgPerM2 > 0 ? (avgPerM2 / 1000).toFixed(2) : "—"}
            <span className="unit">k</span>
          </div>
          <div className="kpi-delta">
            base {totalCovered.toLocaleString("pt-BR")} m² cobertos
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Galpões em pipeline</div>
          <div className="kpi-value">
            {totalBuildings}
            <span className="unit">galpões</span>
          </div>
          <div className="kpi-delta">em {terrains.length} terreno(s)</div>
        </div>
      </section>

      {/* Filter rail + grid (busca, estado, cidade, status) */}
      {terrains.length === 0 ? (
        <div className="card empty">
          <div className="empty-icon">🗺️</div>
          <div className="empty-title">Nenhum terreno cadastrado ainda</div>
          <div className="empty-desc">
            Cadastre seu primeiro lote pelo mapa de satélite para gerar
            estimativas, briefings e modelos 3D com IA.
          </div>
          <Link href="/terrenos/novo" className="btn btn-primary">
            Cadastrar primeiro terreno
          </Link>
        </div>
      ) : (
        <TerrainsExplorer terrains={terrains} />
      )}
    </>
  );
}
