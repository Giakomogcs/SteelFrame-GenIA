import Link from "next/link";
import { prisma } from "@sfg/db";
import { Breadcrumb } from "@/components/Breadcrumb";
import { isIndustrialShed } from "@/lib/shedSchema";

export const dynamic = "force-dynamic";

interface ReportLite {
  id: string;
  code: string;
  version: number;
  status: string;
  verdict: string;
  createdAt: Date;
  building: { id: string; name: string; model: unknown } | null;
}

interface BriefingGroup {
  id: string;
  title: string;
  status: string;
  acceptedAt: Date | null;
  reports: ReportLite[];
}

interface TerrainGroup {
  id: string;
  name: string;
  briefings: BriefingGroup[];
  legacyReports: ReportLite[];
}

export default async function RelatoriosPage() {
  const terrains = await prisma.terrain.findMany({
    include: {
      briefings: {
        orderBy: { createdAt: "desc" },
        include: {
          reports: {
            orderBy: { version: "desc" },
            include: { building: true },
          },
        },
      },
      reports: {
        where: { briefingId: null },
        orderBy: { createdAt: "desc" },
        include: { building: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const groups: TerrainGroup[] = terrains
    .map((t) => ({
      id: t.id,
      name: t.name,
      briefings: t.briefings
        .filter((b) => b.reports.length > 0)
        .map((b) => ({
          id: b.id,
          title: b.title,
          status: b.status,
          acceptedAt: b.acceptedAt,
          reports: b.reports,
        })),
      legacyReports: t.reports,
    }))
    .filter((g) => g.briefings.length > 0 || g.legacyReports.length > 0);

  const totalReports = groups.reduce(
    (s, g) =>
      s +
      g.legacyReports.length +
      g.briefings.reduce((ss, b) => ss + b.reports.length, 0),
    0,
  );

  return (
    <>
      <header className="page-header">
        <div className="stack-sm">
          <Breadcrumb items={[{ label: "Relatórios" }]} />
          <div className="page-title-row">
            <h1>
              {totalReports} relatório{totalReports === 1 ? "" : "s"} ·{" "}
              {groups.length} terreno{groups.length === 1 ? "" : "s"}
            </h1>
            <span className="pill pill-success">
              <span className="dot" />
              Agrupados por Terreno → Briefing
            </span>
          </div>
          <p className="text-sm muted" style={{ maxWidth: "64ch" }}>
            Cada briefing pode gerar múltiplos relatórios versionados.
          </p>
        </div>
      </header>

      {groups.length === 0 ? (
        <div className="card empty">
          <div className="empty-icon">📑</div>
          <div className="empty-title">Nenhum relatório ainda</div>
          <div className="empty-desc">
            Conclua um briefing e aceite o estudo para gerar o primeiro
            relatório.
          </div>
          <Link href="/" className="btn btn-primary">
            Ver carteira
          </Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {groups.map((g) => (
            <section key={g.id} className="card" style={{ padding: 16 }}>
              <header
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 12,
                }}
              >
                <h2 style={{ margin: 0, fontSize: "var(--fs-md)" }}>
                  <Link
                    href={`/terrenos/${g.id}`}
                    style={{ color: "var(--color-primary-500)" }}
                  >
                    {g.name}
                  </Link>
                </h2>
                <span className="text-xs muted">
                  {g.briefings.length} briefing(s) · {g.legacyReports.length}{" "}
                  legado(s)
                </span>
              </header>

              {g.briefings.map((b) => (
                <article
                  key={b.id}
                  style={{
                    padding: 12,
                    background: "var(--color-surface-elevated)",
                    borderRadius: "var(--radius-md)",
                    marginBottom: 10,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 8,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>{b.title}</div>
                      <div className="text-xs muted">
                        {b.acceptedAt
                          ? `aceito em ${new Date(b.acceptedAt).toLocaleDateString("pt-BR")}`
                          : `status: ${b.status}`}
                      </div>
                    </div>
                    <Link
                      href={`/terrenos/${g.id}/estudo/${b.id}`}
                      className="btn btn-ghost btn-sm"
                    >
                      Abrir estudo
                    </Link>
                  </div>
                  <ReportTable rows={b.reports} terrainId={g.id} />
                </article>
              ))}

              {g.legacyReports.length > 0 && (
                <article style={{ marginTop: 10 }}>
                  <h3 className="text-sm muted" style={{ margin: "0 0 8px" }}>
                    Sem briefing (legado)
                  </h3>
                  <ReportTable rows={g.legacyReports} terrainId={g.id} />
                </article>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function ReportTable({
  rows,
  terrainId,
}: {
  rows: ReportLite[];
  terrainId: string;
}) {
  if (rows.length === 0)
    return <p className="text-xs muted">Sem relatórios.</p>;
  return (
    <table className="ds-table" style={{ width: "100%" }}>
      <thead>
        <tr>
          <th>Código · v</th>
          <th>Galpão</th>
          <th style={{ width: 140 }}>Custo total</th>
          <th style={{ width: 110 }}>Status</th>
          <th style={{ width: 100 }}>Data</th>
          <th style={{ width: 80 }}></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const raw = r.building?.model as unknown;
          const shed = isIndustrialShed(raw) ? raw : null;
          const cost = shed?.estimate.totalCost ?? 0;
          return (
            <tr key={r.id}>
              <td className="mono">
                {r.code} · v{r.version}
              </td>
              <td>{r.building?.name ?? "—"}</td>
              <td className="mono">
                {cost
                  ? `R$ ${(cost / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} M`
                  : "—"}
              </td>
              <td>
                <span
                  className={`pill ${
                    r.status === "issued"
                      ? "pill-success"
                      : r.status === "superseded"
                        ? "pill-neutral"
                        : "pill-info"
                  }`}
                >
                  {r.status}
                </span>
              </td>
              <td className="text-xs muted">
                {new Date(r.createdAt).toLocaleDateString("pt-BR")}
              </td>
              <td>
                <Link
                  href={`/relatorios/${r.id}`}
                  className="btn btn-ghost btn-sm"
                >
                  Abrir
                </Link>
                {r.building?.id && (
                  <Link
                    href={`/terrenos/${terrainId}/construcoes/${r.building.id}`}
                    className="text-xs muted"
                    style={{ display: "block", marginTop: 2 }}
                  >
                    3D ↗
                  </Link>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
