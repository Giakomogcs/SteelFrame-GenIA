import Link from "next/link";
import { prisma } from "@sfg/db";
import { TerrainCard } from "@/components/TerrainCard";
import { Breadcrumb } from "@/components/Breadcrumb";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const terrains = await prisma.terrain.findMany({
    include: { buildings: true },
    orderBy: { createdAt: "desc" },
  });

  const totalArea = terrains.reduce((s, t) => s + t.areaM2, 0);
  const totalCost = terrains.reduce(
    (s, t) =>
      s +
      t.buildings.reduce((bs, b) => {
        const m = b.model as { estimate?: { totalCost?: number } } | null;
        return bs + (m?.estimate?.totalCost ?? 0);
      }, 0),
    0,
  );
  const totalBuildings = terrains.reduce((s, t) => s + t.buildings.length, 0);
  const totalCovered = terrains.reduce(
    (s, t) =>
      s +
      t.buildings.reduce((bs, b) => {
        const m = b.model as { estimate?: { coveredAreaM2?: number } } | null;
        return bs + (m?.estimate?.coveredAreaM2 ?? 0);
      }, 0),
    0,
  );
  const avgPerM2 = totalCovered > 0 ? Math.round(totalCost / totalCovered) : 0;

  const viaveis = terrains.filter((t) => t.buildings.length > 0).length;
  const briefings = terrains.length - viaveis;

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
            {briefings > 0 && (
              <span className="pill pill-warning">
                <span className="dot" />
                {briefings} em briefing
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

      {/* Filter rail */}
      <section className="filter-rail">
        <div className="search-wrap">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="search"
            placeholder="Buscar por endereço, bairro, ID…"
          />
        </div>
        <div className="filter-group">
          <span className="filter-label">Status</span>
          <button className="chip active">Todos</button>
          <button className="chip">Viável ({viaveis})</button>
          <button className="chip">Em briefing ({briefings})</button>
        </div>
      </section>

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
        <section className="terrain-grid">
          {terrains.map((t) => (
            <TerrainCard key={t.id} terrain={t} />
          ))}
        </section>
      )}
    </>
  );
}
