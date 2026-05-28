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
import { deriveShedForPlacement } from "@/lib/sitePlanTo3D";

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
          <div className="eyebrow">{terrainName}</div>
          <h1>{briefingTitle}</h1>
        </div>
        <div
          style={{
            display: "flex",
            gap: "var(--space-2)",
            alignItems: "center",
          }}
        >
          <span
            className={`study-shell__pill ${
              report.ok ? "study-shell__pill--ok" : "study-shell__pill--err"
            }`}
          >
            {report.ok ? "✓ válido" : `${report.errors.length} erro(s)`}
          </span>
          {saving && (
            <span className="study-shell__saving">salvando…</span>
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
            <span className="study-shell__pill study-shell__pill--info">
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
          className="study-shell__banner study-shell__banner--error"
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
                lod="architectural"
                synthesizeShed
              />
            )}
            {tab === "premissas" && (
              <BuildingDetailsPanel site={site} shedsById={shedsById} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BuildingDetailsPanel — structured properties view shown in the "Detalhes"
// tab. Replaces the raw JSON dump with a per-building program card.
// ---------------------------------------------------------------------------

interface DetailsProps {
  site: SitePlan;
  shedsById?: Record<string, IndustrialShed>;
}

function BuildingDetailsPanel({ site, shedsById }: DetailsProps) {
  const enriched = useMemo(
    () =>
      site.buildings.map((b) => {
        const embedded = b.shed ?? undefined;
        const linked = b.shedId ? shedsById?.[b.shedId] : undefined;
        const shed = embedded ?? linked ?? deriveShedForPlacement(b);
        const source: "embedded" | "linked" | "derived" = embedded
          ? "embedded"
          : linked
            ? "linked"
            : "derived";
        return { placement: b, shed, source };
      }),
    [site.buildings, shedsById],
  );

  return (
    <div
      style={{
        padding: 16,
        overflow: "auto",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        background: "#0b1220",
        color: "#e2e8f0",
      }}
    >
      <header
        style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
      >
        <div>
          <div style={{ fontSize: 11, color: "#64748b", letterSpacing: 1 }}>
            DETALHES DO ESTUDO
          </div>
          <h2 style={{ margin: 0, fontSize: 18 }}>
            {site.buildings.length} galpão
            {site.buildings.length === 1 ? "" : "es"} · {site.gates.length}{" "}
            portão{site.gates.length === 1 ? "" : "ões"}
          </h2>
        </div>
        <div
          style={{ display: "flex", gap: 8, fontSize: 11, color: "#94a3b8" }}
        >
          <span>
            Recuos F/L/T: {site.setbacks.front}/{site.setbacks.sides}/
            {site.setbacks.back} m
          </span>
        </div>
      </header>

      {enriched.length === 0 && (
        <div style={{ color: "#94a3b8", fontSize: 13 }}>
          Nenhum galpão posicionado.
        </div>
      )}

      {enriched.map(({ placement, shed, source }) => {
        const area = Math.round(shed.footprint.width * shed.footprint.depth);
        return (
          <article
            key={placement.id}
            style={{
              border: "1px solid #1f2937",
              borderRadius: 10,
              background: "#0f172a",
              padding: 14,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
            }}
          >
            <div
              style={{
                gridColumn: "1 / -1",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
              }}
            >
              <h3 style={{ margin: 0, fontSize: 15 }}>
                {placement.name}{" "}
                <span style={{ fontSize: 11, color: "#64748b" }}>
                  · {placement.use}
                </span>
              </h3>
              <span
                style={{
                  fontSize: 10,
                  color:
                    source === "embedded"
                      ? "#38bdf8"
                      : source === "linked"
                        ? "#10b981"
                        : "#fbbf24",
                  border: `1px solid ${
                    source === "embedded"
                      ? "#0c4a6e"
                      : source === "linked"
                        ? "#065f46"
                        : "#78350f"
                  }`,
                  padding: "2px 6px",
                  borderRadius: 6,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
                title={
                  source === "embedded"
                    ? "Galpão gerado pela IA e embutido no SitePlan"
                    : source === "linked"
                      ? "Galpão vinculado"
                      : "Programa derivado automaticamente do footprint"
                }
              >
                {source === "embedded"
                  ? "IA"
                  : source === "linked"
                    ? "Vinculado"
                    : "Derivado"}
              </span>
            </div>

            <Section title="Dimensões">
              <Row k="Área coberta" v={`${area.toLocaleString("pt-BR")} m²`} />
              <Row
                k="Largura × profundidade"
                v={`${shed.footprint.width} × ${shed.footprint.depth} m`}
              />
              <Row k="Pé-direito útil" v={`${shed.structure.clearHeight} m`} />
              <Row k="Padrão" v={shed.standard} />
            </Section>

            <Section title="Estrutura">
              <Row k="Sistema" v={shed.structure.system} />
              <Row
                k="Pórticos"
                v={`${shed.structure.bayCount} × ${shed.structure.baySpacing} m`}
              />
              <Row k="Vão livre" v={`${shed.structure.freeSpan} m`} />
              <Row k="Cobertura" v={shed.structure.roofStructure} />
              <Row k="Perfil colunas" v={shed.structure.columnProfile} />
            </Section>

            <Section title="Telhado">
              <Row k="Tipo" v={shed.roof.type} />
              <Row k="Inclinação" v={`${shed.roof.slopePct}%`} />
              <Row k="Cobertura" v={shed.roof.cover} />
              <Row k="Skylight" v={`${shed.roof.skylightPct}%`} />
            </Section>

            <Section title="Envoltória / Piso">
              <Row k="Paredes" v={shed.envelope.walls} />
              <Row k="Base alvenaria" v={`${shed.envelope.wallBaseHeight} m`} />
              <Row k="Isolamento" v={shed.envelope.insulation} />
              <Row
                k="Piso"
                v={`${shed.floor.type} · ${shed.floor.load_kN_m2} kN/m²`}
              />
            </Section>

            <Section title="Zonas / Programa">
              {shed.zones.length === 0 ? (
                <Row k="—" v="sem zonas" />
              ) : (
                shed.zones.map((z, i) => (
                  <Row
                    key={i}
                    k={`${z.type}`}
                    v={`${z.name} · ${Math.round(z.width * z.depth)} m² · h=${z.height} m`}
                  />
                ))
              )}
              {shed.mezzanine && (
                <Row
                  k="mezanino"
                  v={`${Math.round(shed.mezzanine.width * shed.mezzanine.depth)} m² · cota ${shed.mezzanine.height} m · ${shed.mezzanine.load_kN_m2} kN/m²`}
                />
              )}
            </Section>

            <Section title="Operação">
              <Row k="Docas" v={`${shed.docks.length}`} />
              <Row
                k="Aberturas"
                v={shed.openings.map((o) => o.type).join(", ") || "—"}
              />
              <Row k="Vagas (carro)" v={`${shed.yard.parkingCars}`} />
              <Row k="Vagas (caminhão)" v={`${shed.yard.parkingTrucks}`} />
              <Row k="Raio caminhão" v={`${shed.yard.truckCircle_m} m`} />
            </Section>

            <Section title="Segurança / Utilidades">
              <Row
                k="AVCB"
                v={shed.safety.avcbRequired ? "exigido" : "não exigido"}
              />
              <Row
                k="Saídas"
                v={`${shed.safety.exitsCount} · ${shed.safety.exitsWidthTotal} m`}
              />
              <Row k="Hidrantes" v={`${shed.utilities.hydrants}`} />
              <Row k="Potência" v={`${shed.utilities.power_kVA} kVA`} />
              <Row
                k="Sprinklers"
                v={shed.utilities.sprinklers ? "sim" : "não"}
              />
            </Section>

            <Section title="Estimativa">
              <Row
                k="Custo /m²"
                v={`R$ ${shed.estimate.costPerM2.toLocaleString("pt-BR")}`}
              />
              <Row
                k="Custo total"
                v={`R$ ${shed.estimate.totalCost.toLocaleString("pt-BR")}`}
              />
              <Row
                k="Aço"
                v={`${shed.estimate.steelKg.toLocaleString("pt-BR")} kg`}
              />
              <Row k="Confiança" v={`${Math.round(shed.confidence * 100)}%`} />
            </Section>
          </article>
        );
      })}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div
        style={{
          fontSize: 10,
          letterSpacing: 1,
          color: "#64748b",
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      <dl style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>{children}</dl>
    </section>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <dt style={{ color: "#94a3b8" }}>{k}</dt>
      <dd style={{ margin: 0, color: "#e2e8f0", textAlign: "right" }}>{v}</dd>
    </div>
  );
}
