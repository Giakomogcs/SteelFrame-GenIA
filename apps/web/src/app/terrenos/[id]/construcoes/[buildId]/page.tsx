import Link from "next/link";
import { notFound } from "next/navigation";
import nextDynamic from "next/dynamic";
import { prisma } from "@sfg/db";
import SteelFrameViewer from "@/components/SteelFrameViewer";
import ShedViewer from "@/components/ShedViewer";
import { Breadcrumb } from "@/components/Breadcrumb";
import type { SteelFrameModel } from "@/lib/steelframe";
import { isIndustrialShed, type IndustrialShed } from "@/lib/shedSchema";
import { SitePlanSchema } from "@/lib/sitePlanSchema";
import type { LngLat } from "@/lib/geo";

const SitePlanViewer3D = nextDynamic(
  () => import("@/components/SitePlanViewer3D.client"),
  { ssr: false },
);

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
  const shortId = building.id.slice(-6).toUpperCase();

  // Modelo paramétrico industrial novo
  if (isIndustrialShed(raw)) {
    const shed = raw as IndustrialShed;
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
                  label: `${building.name}`,
                  href: `/terrenos/${building.terrainId}/construcoes/${building.id}`,
                },
                { label: "Visualizador 3D" },
              ]}
            />
            <div className="page-title-row">
              <h1>{building.name} · Visualizador 3D</h1>
              <span className="pill pill-success">
                <span className="dot" />
                {shed.use} · {shed.standard}
              </span>
              <span className="pill pill-neutral mono">#R-{shortId}</span>
            </div>
            <p className="text-sm muted">
              {shed.footprint.width.toFixed(1)} ×{" "}
              {shed.footprint.depth.toFixed(1)} m ·{" "}
              {shed.estimate.coveredAreaM2.toLocaleString("pt-BR")} m² cobertos
              · {shed.structure.bayCount} pórticos · pé-direito{" "}
              {shed.structure.clearHeight} m
            </p>
          </div>
          <div className="row">
            <Link
              href={`/terrenos/${building.terrainId}`}
              className="btn btn-ghost"
            >
              ← Terreno
            </Link>
            <Link
              href={`/terrenos/${building.terrainId}/construcoes/${building.id}/editar`}
              className="btn btn-secondary"
            >
              ✎ Editar medidas
            </Link>
            <Link
              href={`/terrenos/${building.terrainId}/construcoes/${building.id}/relatorio`}
              className="btn btn-secondary"
            >
              📄 Relatório
            </Link>
            <Link
              href={`/terrenos/${building.terrainId}/briefing`}
              className="btn btn-secondary"
            >
              Re-rodar com IA
            </Link>
          </div>
        </header>

        <section className="viewer-shell">
          <ShedViewer shed={shed} polygon={polygon} height="100%" />

          <aside className="params-pane">
            <div className="params-section">
              <div className="ps-title">Identificação</div>
              <div className="param-row">
                <span className="pr-label">Uso</span>
                <span className="pr-value">{shed.use}</span>
              </div>
              <div className="param-row">
                <span className="pr-label">Padrão</span>
                <span className="pr-value">{shed.standard}</span>
              </div>
              <div className="param-row">
                <span className="pr-label">Confiança IA</span>
                <span className="pr-value">
                  {(shed.confidence * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            <div className="params-section">
              <div className="ps-title">Geometria</div>
              <div className="param-row">
                <span className="pr-label">Footprint</span>
                <span className="pr-value">
                  {shed.footprint.width}×{shed.footprint.depth} m
                </span>
              </div>
              <div className="param-row">
                <span className="pr-label">Vão livre</span>
                <span className="pr-value">{shed.structure.freeSpan} m</span>
              </div>
              <div className="param-row">
                <span className="pr-label">Pé-direito</span>
                <span className="pr-value">{shed.structure.clearHeight} m</span>
              </div>
              <div className="param-row">
                <span className="pr-label">Pórticos</span>
                <span className="pr-value">
                  {shed.structure.bayCount} · {shed.structure.baySpacing} m
                </span>
              </div>
            </div>

            <div className="params-section">
              <div className="ps-title">Sistemas</div>
              <div className="param-row">
                <span className="pr-label">Estrutura</span>
                <span className="pr-value">
                  {shed.structure.system.replace(/_/g, " ")}
                </span>
              </div>
              <div className="param-row">
                <span className="pr-label">Cobertura</span>
                <span className="pr-value">
                  {shed.roof.type} · {shed.roof.slopePct}%
                </span>
              </div>
              <div className="param-row">
                <span className="pr-label">Fechamento</span>
                <span className="pr-value">
                  {shed.envelope.walls.replace(/_/g, " ")}
                </span>
              </div>
              <div className="param-row">
                <span className="pr-label">Piso</span>
                <span className="pr-value">
                  {shed.floor.type.replace(/_/g, " ")} · {shed.floor.load_kN_m2}{" "}
                  kN/m²
                </span>
              </div>
            </div>

            <div className="params-section">
              <div className="ps-title">Operação</div>
              <div className="param-row">
                <span className="pr-label">Docas</span>
                <span className="pr-value">{shed.docks.length}</span>
              </div>
              <div className="param-row">
                <span className="pr-label">Aberturas</span>
                <span className="pr-value">{shed.openings.length}</span>
              </div>
              <div className="param-row">
                <span className="pr-label">Mezanino</span>
                <span className="pr-value">
                  {shed.mezzanine ? "Sim" : "Não"}
                </span>
              </div>
              <div className="param-row">
                <span className="pr-label">AVCB</span>
                <span className="pr-value">
                  {shed.safety.avcbRequired ? "Obrigatório" : "Dispensado"}
                </span>
              </div>
            </div>

            <div className="params-section">
              <div className="ps-title">Saídas</div>
              <div className="param-row">
                <span className="pr-label">Custo total</span>
                <span className="pr-value">
                  R${" "}
                  {(shed.estimate.totalCost / 1_000_000).toLocaleString(
                    "pt-BR",
                    {
                      maximumFractionDigits: 2,
                    },
                  )}{" "}
                  M
                </span>
              </div>
              <div className="param-row">
                <span className="pr-label">Custo /m²</span>
                <span className="pr-value">
                  R$ {shed.estimate.costPerM2.toLocaleString("pt-BR")}
                </span>
              </div>
              <div className="param-row">
                <span className="pr-label">Aço estrutural</span>
                <span className="pr-value">
                  {(shed.estimate.steelKg / 1000).toFixed(1)} t
                </span>
              </div>
              <div className="param-row">
                <span className="pr-label">Área coberta</span>
                <span className="pr-value">
                  {shed.estimate.coveredAreaM2.toLocaleString("pt-BR")} m²
                </span>
              </div>
            </div>

            {shed.assumptions.length > 0 && (
              <div className="params-section">
                <div className="ps-title">
                  Premissas ({shed.assumptions.length})
                </div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: 18,
                    color: "var(--color-text-secondary)",
                    fontSize: 12,
                  }}
                >
                  {shed.assumptions.map((a, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>
                      {a}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </section>

        <div className="toast toast-warning" style={{ maxWidth: "none" }}>
          <div>
            <div className="toast-title">⚠️ Aviso técnico obrigatório</div>
            <div className="toast-desc">
              Estimativa preliminar baseada em SINAPI/CUB e NBR{" "}
              {shed.compliance.norms.join(" · ")}. Não substitui projeto
              executivo, ART/RRT, sondagem geotécnica, levantamento topográfico
              ou aprovação legal junto à prefeitura/Corpo de Bombeiros.
            </div>
          </div>
        </div>
      </>
    );
  }

  // SitePlan completo (gerado via briefing/IA): renderiza o viewer de site.
  const sitePlanParsed = SitePlanSchema.safeParse(raw);
  if (sitePlanParsed.success) {
    const site = sitePlanParsed.data;
    const shedsById: Record<string, IndustrialShed> = {};
    for (const b of site.buildings) {
      if (b.shed && isIndustrialShed(b.shed)) shedsById[b.id] = b.shed;
    }
    const sheds = Object.values(shedsById);
    const totalCovered = sheds.reduce(
      (a, s) =>
        a + (s.estimate.coveredAreaM2 || s.footprint.width * s.footprint.depth),
      0,
    );
    const totalCost = sheds.reduce(
      (a, s) => a + (s.estimate.totalCost || 0),
      0,
    );
    const totalSteel = sheds.reduce((a, s) => a + (s.estimate.steelKg || 0), 0);
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
                { label: "Visualizador 3D" },
              ]}
            />
            <div className="page-title-row">
              <h1>{building.name} · Visualizador 3D</h1>
              <span className="pill pill-success">
                <span className="dot" />
                SitePlan · {site.buildings.length}{" "}
                {site.buildings.length === 1 ? "edificação" : "edificações"}
              </span>
              <span className="pill pill-neutral mono">#R-{shortId}</span>
            </div>
            <p className="text-sm muted">
              {totalCovered > 0
                ? `${totalCovered.toLocaleString("pt-BR")} m² cobertos · `
                : ""}
              {totalCost > 0
                ? `R$ ${(totalCost / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} M`
                : "Custo em refino"}
              {totalSteel > 0
                ? ` · ${(totalSteel / 1000).toFixed(1)} t de aço`
                : ""}
            </p>
          </div>
          <div className="row">
            <Link
              href={`/terrenos/${building.terrainId}`}
              className="btn btn-ghost"
            >
              ← Terreno
            </Link>
            <Link
              href={`/terrenos/${building.terrainId}/briefing`}
              className="btn btn-secondary"
            >
              Re-rodar com IA
            </Link>
          </div>
        </header>

        <section
          className="card"
          style={{ padding: 0, overflow: "hidden", height: 680 }}
        >
          <SitePlanViewer3D
            site={site}
            shedsById={shedsById}
            lod="architectural"
            synthesizeShed
            mapBackground
            allowFullscreen
          />
        </section>

        <p className="text-xs muted">
          SitePlan gerado pelo briefing. Use os controles do viewer para mudar
          câmera, ocultar camadas e explorar a planta.
        </p>
      </>
    );
  }

  // Compatibilidade: modelos heurísticos legados
  const model = raw as SteelFrameModel;
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
              { label: building.name },
            ]}
          />
          <div className="page-title-row">
            <h1>{building.name}</h1>
            <span className="pill pill-warning">
              <span className="dot" />
              Modelo legado
            </span>
          </div>
          <p className="text-sm muted">
            {model.footprint.width.toFixed(1)} ×{" "}
            {model.footprint.depth.toFixed(1)} m ·{" "}
            {model.footprint.areaM2.toLocaleString("pt-BR")} m² · {model.bays}{" "}
            pórticos
          </p>
        </div>
        <div className="row">
          <Link
            href={`/terrenos/${building.terrainId}`}
            className="btn btn-ghost"
          >
            ← Voltar
          </Link>
        </div>
      </header>

      <section className="kpi-grid">
        <div className="kpi accent">
          <div className="kpi-label">Custo estimado</div>
          <div className="kpi-value">
            R${" "}
            {(model.estimatedCost / 1_000_000).toLocaleString("pt-BR", {
              maximumFractionDigits: 2,
            })}
            <span className="unit">M</span>
          </div>
          <div className="kpi-delta">
            ~{model.estimatedSteelKg.toLocaleString("pt-BR")} kg de aço
          </div>
        </div>
      </section>

      <section className="card" style={{ padding: 0, overflow: "hidden" }}>
        <SteelFrameViewer model={model} polygon={polygon} />
      </section>

      <p className="text-xs muted">
        Use o mouse para orbitar, scroll para zoom e botão direito para pan.
      </p>
    </>
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
    <div
      style={{
        padding: "var(--space-3)",
        background: "var(--color-surface-elevated)",
        border: "1px solid var(--color-stroke)",
        borderRadius: "var(--radius-md)",
      }}
    >
      <div
        className="text-xs muted mono"
        style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}
      >
        {title}
      </div>
      <div style={{ marginTop: 4, fontWeight: 600, fontSize: 13 }}>
        {children}
      </div>
    </div>
  );
}
