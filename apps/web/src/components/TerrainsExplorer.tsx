"use client";

import { useMemo, useState } from "react";
import type { Terrain, Building, Briefing } from "@sfg/db";
import { TerrainCard } from "./TerrainCard";

type TerrainWithRel = Terrain & {
  buildings: Building[];
  briefings: Briefing[];
};

type StatusKey = "all" | "viable" | "briefing" | "none";

function hasActiveBriefing(briefings: Briefing[]) {
  return briefings.some(
    (b) =>
      b.status === "active" || b.status === "draft" || b.status === "paused",
  );
}

function statusOf(t: TerrainWithRel): Exclude<StatusKey, "all"> {
  if (t.buildings.length > 0) return "viable";
  if (hasActiveBriefing(t.briefings)) return "briefing";
  return "none";
}

export function TerrainsExplorer({ terrains }: { terrains: TerrainWithRel[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusKey>("all");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");

  const counts = useMemo(() => {
    let viable = 0;
    let briefing = 0;
    let none = 0;
    for (const t of terrains) {
      const s = statusOf(t);
      if (s === "viable") viable++;
      else if (s === "briefing") briefing++;
      else none++;
    }
    return { viable, briefing, none };
  }, [terrains]);

  const states = useMemo(() => {
    const set = new Set<string>();
    for (const t of terrains) if (t.state) set.add(t.state);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [terrains]);

  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const t of terrains) {
      if (!t.city) continue;
      if (state && t.state !== state) continue;
      set.add(t.city);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [terrains, state]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return terrains.filter((t) => {
      if (status !== "all" && statusOf(t) !== status) return false;
      if (state && t.state !== state) return false;
      if (city && t.city !== city) return false;
      if (q) {
        const haystack = [
          t.name,
          t.address ?? "",
          t.district ?? "",
          t.city ?? "",
          t.state ?? "",
          t.id.slice(-6),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [terrains, query, status, state, city]);

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
            placeholder="Buscar por endereço, bairro, cidade, ID…"
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
            Todos ({terrains.length})
          </button>
          <button
            type="button"
            className={`chip ${status === "viable" ? "active" : ""}`}
            onClick={() => setStatus("viable")}
          >
            Viável ({counts.viable})
          </button>
          <button
            type="button"
            className={`chip ${status === "briefing" ? "active" : ""}`}
            onClick={() => setStatus("briefing")}
          >
            Em briefing ({counts.briefing})
          </button>
          <button
            type="button"
            className={`chip ${status === "none" ? "active" : ""}`}
            onClick={() => setStatus("none")}
          >
            Sem briefing ({counts.none})
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
          <div className="empty-title">Nenhum terreno encontrado</div>
          <div className="empty-desc">
            Ajuste a busca ou os filtros para ver mais resultados.
          </div>
        </div>
      ) : (
        <>
          {activeFilters && (
            <p className="text-xs muted" style={{ margin: "0 0 -8px" }}>
              {filtered.length} de {terrains.length} terreno
              {terrains.length === 1 ? "" : "s"}
            </p>
          )}
          <section className="terrain-grid">
            {filtered.map((t) => (
              <TerrainCard key={t.id} terrain={t} />
            ))}
          </section>
        </>
      )}
    </>
  );
}
