import Link from "next/link";
import { prisma } from "@sfg/db";
import { Breadcrumb } from "@/components/Breadcrumb";
import { isIndustrialShed } from "@/lib/shedSchema";

export const dynamic = "force-dynamic";

export default async function RelatoriosPage() {
  const buildings = await prisma.building.findMany({
    include: { terrain: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <header className="page-header">
        <div className="stack-sm">
          <Breadcrumb items={[{ label: "Relatórios" }]} />
          <div className="page-title-row">
            <h1>
              {buildings.length} relatório{buildings.length === 1 ? "" : "s"}{" "}
              gerado{buildings.length === 1 ? "" : "s"}
            </h1>
            <span className="pill pill-success">
              <span className="dot" />
              Disponíveis
            </span>
          </div>
          <p className="text-sm muted" style={{ maxWidth: "64ch" }}>
            Galpões paramétricos estudados pelo agente em todos os terrenos
            da carteira.
          </p>
        </div>
      </header>

      {buildings.length === 0 ? (
        <div className="card empty">
          <div className="empty-icon">📑</div>
          <div className="empty-title">Nenhum relatório ainda</div>
          <div className="empty-desc">
            Estude um galpão em algum terreno para gerar o primeiro relatório.
          </div>
          <Link href="/" className="btn btn-primary">
            Ver carteira
          </Link>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table className="ds-table">
            <thead>
              <tr>
                <th>Galpão</th>
                <th>Terreno</th>
                <th style={{ width: 140 }}>Custo total</th>
                <th style={{ width: 120 }}>Padrão</th>
                <th style={{ width: 100 }}>Data</th>
                <th style={{ width: 80 }}></th>
              </tr>
            </thead>
            <tbody>
              {buildings.map((b) => {
                const raw = b.model as unknown;
                const shed = isIndustrialShed(raw) ? raw : null;
                const cost = shed?.estimate.totalCost ?? 0;
                return (
                  <tr key={b.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{b.name}</div>
                      <div className="text-xs muted mono">
                        #R-{b.id.slice(-6).toUpperCase()}
                      </div>
                    </td>
                    <td>
                      <Link
                        href={`/terrenos/${b.terrainId}`}
                        style={{ color: "var(--color-primary-500)" }}
                      >
                        {b.terrain.name}
                      </Link>
                    </td>
                    <td className="mono">
                      {cost
                        ? `R$ ${(cost / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} M`
                        : "—"}
                    </td>
                    <td>
                      {shed ? (
                        <span className="pill pill-info">{shed.standard}</span>
                      ) : (
                        <span className="pill pill-neutral">legado</span>
                      )}
                    </td>
                    <td className="text-xs muted">
                      {new Date(b.createdAt).toLocaleDateString("pt-BR")}
                    </td>
                    <td>
                      <Link
                        href={`/terrenos/${b.terrainId}/construcoes/${b.id}`}
                        className="btn btn-ghost btn-sm"
                      >
                        Abrir
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
