import Link from "next/link";
import { prisma } from "@sfg/db";
import { Breadcrumb } from "@/components/Breadcrumb";
import { BriefingActions } from "@/components/BriefingActions";

export const dynamic = "force-dynamic";

const PENDING_STATUSES = new Set(["active", "draft", "paused"]);

export default async function BriefingsPage() {
  const terrains = await prisma.terrain.findMany({
    include: {
      buildings: true,
      briefings: { orderBy: { updatedAt: "desc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  const pending = terrains
    .map((t) => ({
      terrain: t,
      briefing: t.briefings.find((b) => PENDING_STATUSES.has(b.status)),
    }))
    .filter(
      (
        x,
      ): x is { terrain: (typeof terrains)[number]; briefing: NonNullable<typeof x.briefing> } =>
        x.terrain.buildings.length === 0 && x.briefing != null,
    );

  return (
    <>
      <header className="page-header">
        <div className="stack-sm">
          <Breadcrumb items={[{ label: "Briefings ativos" }]} />
          <div className="page-title-row">
            <h1>
              {pending.length} briefing{pending.length === 1 ? "" : "s"}{" "}
              aguardando
            </h1>
            <span className="pill pill-warning">
              <span className="dot" />
              {pending.length} pendente{pending.length === 1 ? "" : "s"}
            </span>
          </div>
          <p className="text-sm muted" style={{ maxWidth: "64ch" }}>
            Terrenos cadastrados que ainda não tiveram nenhum galpão estudado
            pelo agente de IA.
          </p>
        </div>
      </header>

      {pending.length === 0 ? (
        <div className="card empty">
          <div className="empty-icon">✅</div>
          <div className="empty-title">Sem briefings pendentes</div>
          <div className="empty-desc">
            Todos os terrenos da carteira já têm pelo menos um galpão estudado.
          </div>
          <Link href="/" className="btn btn-primary">
            Ver carteira
          </Link>
        </div>
      ) : (
        <div className="grid-3">
          {pending.map(({ terrain: t, briefing: b }) => (
            <div key={t.id} className="briefing-card-wrap">
              <BriefingActions briefingId={b.id} terrainName={t.name} />
              <Link
                href={`/terrenos/${t.id}/briefing`}
                className="card"
                style={{ display: "block" }}
              >
                <div className="card-row">
                  <div>
                    <div className="card-title">{t.name}</div>
                    <div className="card-subtitle">
                      {t.address ?? "Sem endereço"}
                    </div>
                  </div>
                  <span className="pill pill-warning">
                    <span className="dot" />
                    Aguardando
                  </span>
                </div>
                <div className="row-between">
                  <span className="text-xs muted mono">
                    {Math.round(t.areaM2).toLocaleString("pt-BR")} m²
                  </span>
                  <span
                    className="text-xs"
                    style={{ color: "var(--color-primary-500)" }}
                  >
                    Iniciar briefing →
                  </span>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
