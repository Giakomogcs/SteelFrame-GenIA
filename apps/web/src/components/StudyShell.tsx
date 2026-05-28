"use client";

/**
 * StudyShell — tela /terrenos/[id]/estudo/[briefingId].
 * 2 colunas: esquerda (Premissas + RefineChat), direita (tabs
 * SitePlan 2D · Volume 3D). CTA `Aceitar estudo` no header.
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { IndustrialShed } from "@/lib/shedSchema";
import type { SitePlan } from "@/lib/sitePlanSchema";
import { SitePlanSchema } from "@/lib/sitePlanSchema";
import { validateSitePlan } from "@/lib/siteConstraints";
import SitePlanEditor from "./SitePlanEditor";
import SitePlanViewer3D from "./SitePlanViewer3D.client";
import RefineChat from "./RefineChat";

interface Props {
  terrainId: string;
  terrainName: string;
  briefingId: string;
  briefingTitle: string;
  initialSite: SitePlan;
  initialHash: string;
  shedsById?: Record<string, IndustrialShed>;
  acceptedAt: string | null;
}

type Tab = "2d" | "3d" | "premissas";

export default function StudyShell({
  terrainId,
  terrainName,
  briefingId,
  briefingTitle,
  initialSite,
  initialHash,
  shedsById,
  acceptedAt,
}: Props) {
  const router = useRouter();
  const [site, setSite] = useState<SitePlan>(initialSite);
  const [hash, setHash] = useState<string>(initialHash);
  const [tab, setTab] = useState<Tab>("2d");
  const [saving, setSaving] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pristine, setPristine] = useState(true);

  const report = useMemo(() => validateSitePlan(site), [site]);

  // Debounced save (FR-G3: 300 ms after last edit).
  useEffect(() => {
    if (pristine) return;
    const t = window.setTimeout(async () => {
      setSaving(true);
      try {
        const res = await fetch(`/api/terrenos/${terrainId}/site-plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ briefingId, data: site }),
        });
        if (res.ok) {
          const json = (await res.json()) as { sitePlan: { hash: string } };
          setHash(json.sitePlan.hash);
          setPristine(true);
        }
      } catch {
        /* keep dirty */
      } finally {
        setSaving(false);
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [site, pristine, briefingId, terrainId]);

  function applyChange(next: SitePlan) {
    const parsed = SitePlanSchema.safeParse(next);
    if (!parsed.success) return;
    const v = validateSitePlan(parsed.data);
    setSite({ ...parsed.data, validations: v });
    setPristine(false);
  }

  async function accept() {
    setErr(null);
    setAccepting(true);
    try {
      const res = await fetch(`/api/briefings/${briefingId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { report: { id: string } };
      router.push(`/relatorios/${json.report.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div className="study-shell">
      <header className="study-shell__header">
        <div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>{terrainName}</div>
          <h1 style={{ margin: 0, fontSize: 18 }}>{briefingTitle}</h1>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span
            className="pill"
            style={{
              background: report.ok ? "#064e3b" : "#7f1d1d",
              color: "#e2e8f0",
              padding: "4px 10px",
              borderRadius: 12,
              fontSize: 11,
            }}
          >
            {report.ok ? "✓ válido" : `${report.errors.length} erro(s)`}
          </span>
          {saving && (
            <span style={{ fontSize: 11, color: "#94a3b8" }}>salvando…</span>
          )}
          {!acceptedAt && (
            <button
              type="button"
              className="btn btn--accept"
              disabled={!report.ok || accepting || !pristine}
              onClick={() => void accept()}
              title={
                acceptedAt
                  ? "Já aceito"
                  : !report.ok
                    ? "Corrija os erros antes de aceitar."
                    : !pristine
                      ? "Aguarde salvar…"
                      : ""
              }
            >
              {accepting ? "Aceitando…" : "Aceitar estudo"}
            </button>
          )}
          {acceptedAt && (
            <span
              className="pill"
              style={{
                background: "#1e3a8a",
                color: "#fff",
                padding: "4px 10px",
                borderRadius: 12,
              }}
            >
              Aceito · {new Date(acceptedAt).toLocaleDateString("pt-BR")}
            </span>
          )}
        </div>
      </header>

      {!acceptedAt && (
        <div className="study-shell__banner" role="status">
          Pré-visualização — não publicado.
        </div>
      )}
      {err && (
        <div
          className="study-shell__banner"
          style={{ background: "#7f1d1d" }}
          role="alert"
        >
          {err}
        </div>
      )}

      <div className="study-shell__body">
        <aside className="study-shell__left">
          <section className="card" style={{ padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Premissas</h3>
            <ul style={{ fontSize: 12, lineHeight: 1.6, paddingLeft: 18 }}>
              <li>
                Galpões: <strong>{site.buildings.length}</strong>
              </li>
              <li>
                Recuos: frente {site.setbacks.front}m · lados{" "}
                {site.setbacks.sides}m · fundo {site.setbacks.back}m
              </li>
              <li>
                Portões: <strong>{site.gates.length}</strong>
              </li>
              <li>Arestas de rua: {site.streetEdges.join(", ") || "—"}</li>
              <li>
                Vagas: carro{" "}
                <strong>
                  {site.parking
                    .filter((p) => p.kind === "car")
                    .reduce((s, p) => s + p.stallCount, 0)}
                </strong>
                {" · "}
                caminhão{" "}
                <strong>
                  {site.parking
                    .filter((p) => p.kind === "truck")
                    .reduce((s, p) => s + p.stallCount, 0)}
                </strong>
              </li>
            </ul>
            {report.errors.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div
                  style={{ fontSize: 11, color: "#fca5a5", fontWeight: 600 }}
                >
                  Erros:
                </div>
                <ul
                  style={{
                    fontSize: 11,
                    color: "#fca5a5",
                    paddingLeft: 18,
                    margin: 0,
                  }}
                >
                  {report.errors.map((e, i) => (
                    <li key={i}>
                      [{e.code}] {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {report.warnings.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div
                  style={{ fontSize: 11, color: "#fbbf24", fontWeight: 600 }}
                >
                  Avisos:
                </div>
                <ul
                  style={{
                    fontSize: 11,
                    color: "#fbbf24",
                    paddingLeft: 18,
                    margin: 0,
                  }}
                >
                  {report.warnings.map((w, i) => (
                    <li key={i}>
                      [{w.code}] {w.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <section
            className="card"
            style={{
              padding: 12,
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minHeight: 240,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Chat de refinamento</h3>
            <div style={{ flex: 1, minHeight: 0 }}>
              <RefineChat
                briefingId={briefingId}
                currentSite={site}
                currentHash={hash}
                onApply={(next) => applyChange(next)}
              />
            </div>
          </section>
        </aside>

        <main className="study-shell__right">
          <div className="study-shell__tabs" role="tablist">
            {(
              [
                { id: "2d", label: "SitePlan 2D" },
                { id: "3d", label: "Volume 3D" },
                { id: "premissas", label: "Detalhes" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={tab === t.id ? "active" : ""}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="study-shell__canvas">
            {tab === "2d" && (
              <SitePlanEditor
                site={site}
                onChange={applyChange}
                debounceMs={300}
              />
            )}
            {tab === "3d" && (
              <SitePlanViewer3D
                site={site}
                shedsById={shedsById}
                lod="structural"
              />
            )}
            {tab === "premissas" && (
              <pre
                style={{
                  fontSize: 11,
                  color: "#cbd5e1",
                  padding: 12,
                  overflow: "auto",
                  margin: 0,
                  height: "100%",
                  background: "#0b1220",
                }}
              >
                {JSON.stringify(site, null, 2)}
              </pre>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
