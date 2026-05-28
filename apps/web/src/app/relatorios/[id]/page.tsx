import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@sfg/db";
import { Breadcrumb } from "@/components/Breadcrumb";
import SitePlanViewer3D from "@/components/SitePlanViewer3D.client";
import { SitePlanSchema, type SitePlan } from "@/lib/sitePlanSchema";
import { isIndustrialShed, type IndustrialShed } from "@/lib/shedSchema";

export const dynamic = "force-dynamic";

export default async function ReportDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const report = await prisma.report.findUnique({
    where: { id: params.id },
    include: {
      terrain: true,
      briefing: true,
      building: true,
    },
  });
  if (!report) notFound();

  // Try to recover the SitePlan for the 3D embed.
  let site: SitePlan | null = null;
  const blocks = report.blocks as { sitePlanId?: string } | null;
  if (blocks?.sitePlanId) {
    const row = await prisma.sitePlan.findUnique({
      where: { id: blocks.sitePlanId },
    });
    if (row) {
      const parsed = SitePlanSchema.safeParse(row.data);
      if (parsed.success) site = parsed.data;
    }
  }
  if (!site && report.building?.model) {
    const parsed = SitePlanSchema.safeParse(report.building.model);
    if (parsed.success) site = parsed.data;
  }

  const shed: IndustrialShed | null = isIndustrialShed(report.building?.model)
    ? (report.building?.model as IndustrialShed)
    : null;
  const cost = shed?.estimate.totalCost ?? 0;
  const coveredArea = shed?.estimate.coveredAreaM2 ?? 0;

  return (
    <>
      <header className="page-header">
        <div className="stack-sm">
          <Breadcrumb
            items={[
              { label: "Relatórios", href: "/relatorios" },
              { label: `${report.code} · v${report.version}` },
            ]}
          />
          <div className="page-title-row">
            <h1>{report.code} · v{report.version}</h1>
            <span
              className={`pill ${
                report.status === "issued"
                  ? "pill-success"
                  : report.status === "superseded"
                    ? "pill-neutral"
                    : "pill-info"
              }`}
            >
              {report.status}
            </span>
            <span className="pill pill-info">{report.verdict}</span>
          </div>
          <p className="text-sm muted">
            Terreno:{" "}
            <Link href={`/terrenos/${report.terrainId}`} style={{ color: "var(--color-primary-500)" }}>
              {report.terrain.name}
            </Link>
            {report.briefing && (
              <>
                {" "}· Briefing:{" "}
                <Link
                  href={`/terrenos/${report.terrainId}/estudo/${report.briefing.id}`}
                  style={{ color: "var(--color-primary-500)" }}
                >
                  {report.briefing.title}
                </Link>
              </>
            )}
          </p>
        </div>
      </header>

      <section className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Área coberta</div>
          <div className="kpi-value">
            {Math.round(coveredArea).toLocaleString("pt-BR")}
            <span className="unit">m²</span>
          </div>
        </div>
        <div className="kpi accent">
          <div className="kpi-label">Custo total</div>
          <div className="kpi-value">
            R${" "}
            {cost > 0
              ? (cost / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })
              : "—"}
            <span className="unit">M</span>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Versão</div>
          <div className="kpi-value">v{report.version}</div>
          <div className="kpi-delta">{new Date(report.createdAt).toLocaleDateString("pt-BR")}</div>
        </div>
      </section>

      <section className="card" style={{ padding: 0, overflow: "hidden", marginTop: 16, height: 480 }}>
        {site ? (
          <SitePlanViewer3D site={site} lod="structural" />
        ) : (
          <div className="empty" style={{ padding: 32 }}>
            <div className="empty-icon">🚧</div>
            <div className="empty-title">SitePlan indisponível</div>
            <div className="empty-desc">Este relatório foi gerado antes da introdução do SitePlan.</div>
          </div>
        )}
      </section>

      <section className="card" style={{ padding: 16, marginTop: 16 }}>
        <h2 style={{ marginTop: 0, fontSize: "var(--fs-md)" }}>Premissas & validações</h2>
        <pre
          style={{
            fontSize: 11,
            color: "#cbd5e1",
            background: "#0b1220",
            padding: 12,
            borderRadius: 6,
            overflow: "auto",
          }}
        >
          {JSON.stringify(report.blocks, null, 2)}
        </pre>
      </section>
    </>
  );
}
