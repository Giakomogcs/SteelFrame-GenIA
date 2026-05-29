"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export interface ReportRowData {
  id: string;
  code: string;
  version: number;
  status: string;
  date: string; // ISO
  buildingId: string | null;
  buildingName: string;
  cost: number;
}

export interface BriefingGroupData {
  id: string;
  title: string;
  statusLabel: string;
  reports: ReportRowData[];
}

export interface ReportTerrainGroup {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  briefings: BriefingGroupData[];
  legacyReports: ReportRowData[];
}

type StatusKey = "all" | "issued" | "superseded" | "draft";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR");
}

function fmtCost(cost: number) {
  if (!cost) return "—";
  return `R$ ${(cost / 1_000_000).toLocaleString("pt-BR", {
    maximumFractionDigits: 2,
  })} M`;
}

function statusPillClass(status: string) {
  if (status === "issued") return "pill-success";
  if (status === "superseded") return "pill-neutral";
  return "pill-info";
}

const STATUS_LABEL: Record<string, string> = {
  issued: "Emitido",
  superseded: "Substituído",
  draft: "Rascunho",
};

function statusLabel(status: string) {
  return STATUS_LABEL[status] ?? status;
}

function ReportTable({
  rows,
  terrainId,
}: {
  rows: ReportRowData[];
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
          <th style={{ width: 150 }}></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="mono">
              {r.code} · v{r.version}
            </td>
            <td>{r.buildingName}</td>
            <td className="mono">{fmtCost(r.cost)}</td>
            <td>
              <span className={`pill ${statusPillClass(r.status)}`}>
                {statusLabel(r.status)}
              </span>
            </td>
            <td className="text-xs muted">{fmtDate(r.date)}</td>
            <td>
              <div className="report-row-actions">
                <Link
                  href={`/relatorios/${r.id}`}
                  className="btn btn-primary btn-sm"
                >
                  Abrir
                </Link>
                {r.buildingId && (
                  <Link
                    href={`/terrenos/${terrainId}/construcoes/${r.buildingId}`}
                    className="btn btn-ghost btn-sm"
                  >
                    3D ↗
                  </Link>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ReportsExplorer({ groups }: { groups: ReportTerrainGroup[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusKey>("all");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");

  const states = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) if (g.state) set.add(g.state);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [groups]);

  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) {
      if (!g.city) continue;
      if (state && g.state !== state) continue;
      set.add(g.city);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [groups, state]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchStatus = (rows: ReportRowData[]) =>
      status === "all" ? rows : rows.filter((r) => r.status === status);
    const matchQuery = (g: ReportTerrainGroup, rows: ReportRowData[]) => {
      if (!q) return rows;
      const terrainMatch = [g.name, g.city ?? "", g.state ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
      if (terrainMatch) return rows;
      return rows.filter((r) =>
        [r.code, r.buildingName].join(" ").toLowerCase().includes(q),
      );
    };

    return groups
      .filter((g) => {
        if (state && g.state !== state) return false;
        if (city && g.city !== city) return false;
        return true;
      })
      .map((g) => {
        const briefings = g.briefings
          .map((b) => ({
            ...b,
            reports: matchQuery(g, matchStatus(b.reports)),
          }))
          .filter((b) => b.reports.length > 0);
        const legacyReports = matchQuery(g, matchStatus(g.legacyReports));
        return { ...g, briefings, legacyReports };
      })
      .filter((g) => g.briefings.length > 0 || g.legacyReports.length > 0);
  }, [groups, query, status, state, city]);

  const visibleReports = filtered.reduce(
    (s, g) =>
      s +
      g.legacyReports.length +
      g.briefings.reduce((ss, b) => ss + b.reports.length, 0),
    0,
  );

  const activeFilters = status !== "all" || !!state || !!city || !!query.trim();

  return (
    <>
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
            placeholder="Buscar por terreno, código, galpão, cidade…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="filter-group">
          <span className="filter-label">Estado</span>
          <select
            className="filter-select"
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setCity("");
            }}
          >
            <option value="">Todos</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <span className="filter-label">Cidade</span>
          <select
            className="filter-select"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            disabled={cities.length === 0}
          >
            <option value="">Todas</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <span className="filter-label">Status</span>
          <button
            type="button"
            className={`chip ${status === "all" ? "active" : ""}`}
            onClick={() => setStatus("all")}
          >
            Todos
          </button>
          <button
            type="button"
            className={`chip ${status === "issued" ? "active" : ""}`}
            onClick={() => setStatus("issued")}
          >
            Emitidos
          </button>
          <button
            type="button"
            className={`chip ${status === "superseded" ? "active" : ""}`}
            onClick={() => setStatus("superseded")}
          >
            Substituídos
          </button>
        </div>

        {activeFilters && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setQuery("");
              setStatus("all");
              setState("");
              setCity("");
            }}
          >
            Limpar filtros
          </button>
        )}
      </section>

      {filtered.length === 0 ? (
        <div className="card empty">
          <div className="empty-icon">🔍</div>
          <div className="empty-title">Nenhum relatório encontrado</div>
          <div className="empty-desc">
            Ajuste a busca ou os filtros para ver mais resultados.
          </div>
        </div>
      ) : (
        <>
          {activeFilters && (
            <p className="text-xs muted" style={{ margin: "0 0 -8px" }}>
              {visibleReports} relatório{visibleReports === 1 ? "" : "s"} em{" "}
              {filtered.length} terreno{filtered.length === 1 ? "" : "s"}
            </p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {filtered.map((g) => (
              <section key={g.id} className="card report-group">
                <header className="report-group__head">
                  <div>
                    <h2 className="report-group__title">
                      <Link href={`/terrenos/${g.id}`}>{g.name}</Link>
                    </h2>
                    {(g.city || g.state) && (
                      <div className="text-xs muted">
                        {[g.city, g.state].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                  <span className="text-xs muted">
                    {g.briefings.length} briefing(s)
                    {g.legacyReports.length > 0
                      ? ` · ${g.legacyReports.length} legado(s)`
                      : ""}
                  </span>
                </header>

                {g.briefings.map((b) => (
                  <article key={b.id} className="report-briefing">
                    <div className="report-briefing__head">
                      <div>
                        <div style={{ fontWeight: 600 }}>{b.title}</div>
                        <div className="text-xs muted">{b.statusLabel}</div>
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
        </>
      )}
    </>
  );
}
