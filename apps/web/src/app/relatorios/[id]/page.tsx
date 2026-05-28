import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@sfg/db";
import { Breadcrumb } from "@/components/Breadcrumb";
import SitePlanViewer3D from "@/components/SitePlanViewer3D.client";
import { SitePlanSchema, type SitePlan } from "@/lib/sitePlanSchema";
import { isIndustrialShed, type IndustrialShed } from "@/lib/shedSchema";
import {
  computeViability,
  baseCostPerM2,
  CUB_BAND_BY_STATE,
  getCostState,
  extractUF,
  NORMS,
  SOURCES,
  type ViabilityEstimate,
  type Range,
} from "@/lib/knowledge";

const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

// Rótulos PT-BR para os fatores devolvidos pelo estimador.
const FACTOR_LABEL: Record<string, string> = {
  terreno_plano: "Terreno plano (<3%)",
  terreno_leve: "Inclinação leve (3–10%)",
  terreno_muito: "Inclinação acentuada (>10%)",
  terreno_desconhecido: "Topografia desconhecida",
  padrao_economico: "Padrão construtivo econômico",
  padrao_medio: "Padrão construtivo médio",
  padrao_alto: "Padrão construtivo alto",
  isolamento_basico: "Isolamento térmico básico",
  isolamento_intermediario: "Isolamento intermediário",
  isolamento_alto_desempenho: "Isolamento de alto desempenho",
  cobertura_telha_metalica: "Cobertura telha metálica",
  cobertura_telha_termoacustica: "Cobertura termoacústica",
  cobertura_sandwich_PIR: "Cobertura sandwich PIR",
  cobertura_fibrocimento: "Cobertura fibrocimento",
  fachada_pouco: "Fachada simples",
  fachada_medio: "Fachada com recortes médios",
  fachada_muito: "Fachada com muitos recortes",
  vao_livre: "Vão livre (NBR 8800/14762)",
  pavimentos: "Múltiplos pavimentos",
  pe_direito: "Pé-direito elevado",
  piso_industrial: "Piso industrial (NBR 6120)",
  docas: "Docas de carga/descarga",
  avcb: "AVCB obrigatório (NBR 9077)",
  sem_sondagem: "Sem sondagem SPT (contingência)",
  sem_topografia: "Sem topografia (contingência)",
};

// Justificativa curta por fator — explica POR QUE o agente aplicou o ajuste.
const FACTOR_RATIONALE: Record<string, string> = {
  terreno_plano:
    "Movimentação de terra mínima conforme perfil topográfico (NBR 6457).",
  terreno_leve:
    "Cortes e aterros moderados; contenção pontual. Composições de movimentação SINAPI.",
  terreno_muito:
    "Demanda contenções e fundações reforçadas (NBR 6122) — encarece estrutura e infra.",
  terreno_desconhecido:
    "Sem perfil topográfico confirmado; aplica contingência conservadora (boa prática).",
  padrao_economico: "Acabamento e esquadrias básicos — banda inferior do CUB.",
  padrao_medio: "Padrão médio do CUB Sinduscon estadual — referência neutra.",
  padrao_alto: "Acabamentos de alto padrão; CUB R-8/A — banda superior.",
  isolamento_basico: "Sem exigência adicional de NBR 15575.",
  isolamento_intermediario:
    "Atende NBR 15575 nível intermediário (térmico/acústico).",
  isolamento_alto_desempenho:
    "Atende NBR 15575 nível superior — fechamentos e cobertura com isolamento térmico-acústico.",
  cobertura_telha_metalica:
    "Cobertura simples — composição SINAPI de telha metálica.",
  cobertura_telha_termoacustica:
    "Telha sanduíche com EPS/PUR — ganho térmico e acústico.",
  cobertura_sandwich_PIR:
    "Painel sandwich PIR — alta eficiência térmica para cold storage / NBR 15575 superior.",
  cobertura_fibrocimento: "Solução mais barata mas com menor desempenho.",
  fachada_pouco: "Fachada limpa, pouco retrabalho.",
  fachada_medio: "Esquadrias e recortes geram retrabalho de fechamento.",
  fachada_muito: "Muitos recortes/esquadrias — aumenta horas de instalação.",
  vao_livre: "Vãos > 15 m exigem perfis mais robustos (NBR 8800/NBR 14762).",
  pavimentos:
    "Entrepiso steel deck + transmissão de cargas — NBR 8800/NBR 6120.",
  pe_direito: "Pé-direito > 6 m exige colunas e fechamentos maiores.",
  piso_industrial:
    "Pisos > 30 kN/m² (porta-paletes/manufatura) — composição reforçada NBR 6120.",
  docas:
    "Cada doca soma nivelador, selo e rebaixo — composição SINAPI específica.",
  avcb: "Hidrantes, sprinklers, rotas e sinalização conforme NBR 9077 e IT do CBPM.",
  sem_sondagem:
    "Sem SPT confirmado — fundação superdimensionada por segurança (NBR 6484/6122).",
  sem_topografia: "Sem levantamento planialtimétrico — contingência aplicada.",
};

function rangePill(r: Range) {
  const pct = (v: number) => `${((v - 1) * 100).toFixed(0)}%`;
  const sign = (v: number) => (v >= 1 ? "+" : "");
  return `${sign(r.low)}${pct(r.low)} … ${sign(r.high)}${pct(r.high)}`;
}

const tableStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 13,
  borderCollapse: "collapse",
};
const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid var(--color-border)",
  color: "var(--color-text-2)",
  fontWeight: 600,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

function buildViabilityFromShed(
  shed: IndustrialShed,
  uf?: string | null,
): ViabilityEstimate {
  return computeViability({
    uf: uf ?? undefined,
    standard: shed.standard,
    areaM2: shed.footprint.width * shed.footprint.depth,
    storeys: shed.mezzanine ? 2 : 1,
    insulation:
      shed.envelope.insulation === "nenhum"
        ? "basico"
        : shed.envelope.insulation,
    roofCover: shed.roof.cover,
    freeSpanM: shed.structure.freeSpan,
    clearHeightM: shed.structure.clearHeight,
    floorLoadKnM2: shed.floor.load_kN_m2,
    docksCount: shed.docks.length,
    avcbRequired: shed.safety.avcbRequired,
    slopePct: shed.lot.slopePct ?? null,
    hasSounding: undefined,
    hasTopo: shed.lot.slopePct != null,
  });
}

/**
 * Soma totais de várias viabilidades preservando os fatores do edifício
 * dominante (maior área) para a tabela de explicação. Recalcula R$/m² médio
 * ponderado pela área coberta.
 */
function aggregateViability(
  estimates: ViabilityEstimate[],
  dominant: ViabilityEstimate,
): ViabilityEstimate {
  const totalArea = estimates.reduce((a, e) => a + e.areaM2, 0) || 1;
  const sum = (key: "low" | "base" | "high") =>
    estimates.reduce((a, e) => a + e.totalCost[key], 0);
  const totalCost = { low: sum("low"), base: sum("base"), high: sum("high") };
  const costPerM2 = {
    low: Math.round(totalCost.low / totalArea),
    base: Math.round(totalCost.base / totalArea),
    high: Math.round(totalCost.high / totalArea),
  };
  // Macroetapas: soma direta das contribuições.
  const macroStages = dominant.macroStages.map((s, i) => ({
    stage: s.stage,
    label: s.label,
    low: estimates.reduce((a, e) => a + (e.macroStages[i]?.low ?? 0), 0),
    base: estimates.reduce((a, e) => a + (e.macroStages[i]?.base ?? 0), 0),
    high: estimates.reduce((a, e) => a + (e.macroStages[i]?.high ?? 0), 0),
  }));
  return {
    ...dominant,
    areaM2: totalArea,
    costPerM2,
    totalCost,
    macroStages,
    notes: [
      `Total composto por ${estimates.length} edificações — fatores exibidos referem-se ao galpão dominante.`,
      ...dominant.notes,
    ],
  };
}

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

  // Sheds que efetivamente compõem o projeto:
  // 1) shed embutido em cada BuildingPlacement do SitePlan (caso novo),
  // 2) fallback: o próprio building.model quando ainda é um IndustrialShed puro.
  const embeddedSheds: IndustrialShed[] = (site?.buildings ?? [])
    .map((b) => b.shed)
    .filter((s): s is IndustrialShed => !!s && isIndustrialShed(s));
  const sheds: IndustrialShed[] =
    embeddedSheds.length > 0 ? embeddedSheds : shed ? [shed] : [];

  const coveredArea = sheds.reduce(
    (acc, s) =>
      acc + (s.estimate.coveredAreaM2 || s.footprint.width * s.footprint.depth),
    0,
  );
  const cost = sheds.reduce((acc, s) => acc + (s.estimate.totalCost || 0), 0); // Reconstrói a viabilidade com fatores SINAPI/CUB para evidenciar decisões.
  // Para múltiplos galpões, computa por edifício e soma os totais; usa o
  // edifício de maior área como referência de fatores na tabela.
  // UF resolvida com fallback: campo estruturado → endereço livre → "BR".
  // Isso protege relatórios de terrenos antigos cadastrados antes do campo
  // `state` ser persistido pelo cadastro.
  const ufResolved = extractUF(
    report.terrain.state ?? report.terrain.address ?? null,
  );
  const uf: string | undefined = ufResolved === "BR" ? undefined : ufResolved;
  const perBuildingViability = sheds.map((s) => ({
    shed: s,
    estimate: buildViabilityFromShed(s, uf),
  }));
  const dominant = perBuildingViability
    .slice()
    .sort((a, b) => b.estimate.areaM2 - a.estimate.areaM2)[0];
  const viability: ViabilityEstimate | null = dominant
    ? perBuildingViability.length === 1
      ? dominant.estimate
      : aggregateViability(
          perBuildingViability.map((p) => p.estimate),
          dominant.estimate,
        )
    : null;
  const ufState = getCostState(uf);
  const sinapiSeed = viability ? baseCostPerM2(uf, viability.standard) : null;
  const cubBand = CUB_BAND_BY_STATE[ufState] ?? null;

  // Normas citadas — união dos sheds, com fallback para o catálogo completo.
  const citedCodes = new Set<string>(
    sheds.length > 0
      ? sheds.flatMap((s) => s.compliance.norms)
      : NORMS.map((n) => n.code),
  );
  const citedNorms = NORMS.filter((n) => citedCodes.has(n.code));

  const costSourceIds = ["sinapi", "cub", "abnt"];
  const linkedSources = SOURCES.filter((s) => costSourceIds.includes(s.id));

  // Map building.id → embedded shed, for the 3D viewer to render full detail.
  const shedsById: Record<string, IndustrialShed> = {};
  (site?.buildings ?? []).forEach((b) => {
    if (b.shed && isIndustrialShed(b.shed)) shedsById[b.id] = b.shed;
  });

  return (
    <>
      <style>{`
        .rpt-table td { padding: 8px 10px; border-bottom: 1px solid var(--color-border); vertical-align: top; }
        .rpt-table tr:last-child td { border-bottom: 0; }
      `}</style>
      <header className="page-header">
        <div className="stack-sm">
          <Breadcrumb
            items={[
              { label: "Relatórios", href: "/relatorios" },
              { label: `${report.code} · v${report.version}` },
            ]}
          />
          <div className="page-title-row">
            <h1>
              {report.code} · v{report.version}
            </h1>
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
            <Link
              href={`/terrenos/${report.terrainId}`}
              style={{ color: "var(--color-primary-500)" }}
            >
              {report.terrain.name}
            </Link>
            {report.briefing && (
              <>
                {" "}
                · Briefing:{" "}
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
            {(() => {
              const total = cost > 0 ? cost : (viability?.totalCost.base ?? 0);
              return total > 0
                ? (total / 1_000_000).toLocaleString("pt-BR", {
                    maximumFractionDigits: 2,
                  })
                : "—";
            })()}
            <span className="unit">M</span>
          </div>
          {viability && (
            <div className="kpi-delta">
              faixa R${" "}
              {(viability.totalCost.low / 1_000_000).toLocaleString("pt-BR", {
                maximumFractionDigits: 2,
              })}
              –
              {(viability.totalCost.high / 1_000_000).toLocaleString("pt-BR", {
                maximumFractionDigits: 2,
              })}
              M
            </div>
          )}
        </div>
        <div className="kpi">
          <div className="kpi-label">Versão</div>
          <div className="kpi-value">v{report.version}</div>
          <div className="kpi-delta">
            {new Date(report.createdAt).toLocaleDateString("pt-BR")}
          </div>
        </div>
      </section>

      <section
        className="card"
        style={{ padding: 0, overflow: "hidden", marginTop: 16, height: 560, borderRadius: 12 }}
      >
        {site ? (
          <SitePlanViewer3D
            site={site}
            shedsById={shedsById}
            lod="architectural"
            synthesizeShed
            mapBackground
            allowFullscreen
            compact
          />
        ) : (
          <div className="empty" style={{ padding: 32 }}>
            <div className="empty-icon">🚧</div>
            <div className="empty-title">SitePlan indisponível</div>
            <div className="empty-desc">
              Este relatório foi gerado antes da introdução do SitePlan.
            </div>
          </div>
        )}
      </section>

      {sheds.length > 0 && (
        <section className="card" style={{ padding: 16, marginTop: 16 }}>
          <h2
            style={{ marginTop: 0, marginBottom: 4, fontSize: "var(--fs-md)" }}
          >
            Edificações do projeto
          </h2>
          <p className="text-sm muted" style={{ margin: 0, marginBottom: 12 }}>
            {sheds.length === 1
              ? "1 galpão dimensionado pelo agente."
              : `${sheds.length} galpões dimensionados pelo agente — totais somados nas seções a seguir.`}
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="rpt-table" style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>#</th>
                  <th style={thStyle}>Uso</th>
                  <th style={thStyle}>Sistema</th>
                  <th style={thStyle}>Padrão</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Área (m²)</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>R$/m²</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {perBuildingViability.map((p, i) => {
                  const placement = site?.buildings?.[i];
                  const name = placement?.name ?? `Galpão ${i + 1}`;
                  return (
                    <tr key={i}>
                      <td>{name}</td>
                      <td>{p.shed.use}</td>
                      <td>{p.shed.structure.system}</td>
                      <td>{p.shed.standard}</td>
                      <td style={{ textAlign: "right" }}>
                        {BRL(p.estimate.areaM2)}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        R$ {BRL(p.estimate.costPerM2.base)}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <strong>R$ {BRL(p.estimate.totalCost.base)}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {viability && sinapiSeed && (
        <section className="card" style={{ padding: 16, marginTop: 16 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h2
                style={{
                  marginTop: 0,
                  marginBottom: 4,
                  fontSize: "var(--fs-md)",
                }}
              >
                Como chegamos no custo — SINAPI, CUB e fatores de obra
              </h2>
              <p className="text-sm muted" style={{ margin: 0 }}>
                Banda paramétrica derivada de SINAPI (Caixa/IBGE) por UF,
                validada contra CUB Sinduscon
                {ufState !== "BR" ? `-${ufState}` : ""}, e ajustada por fatores
                normativos do projeto (NBR 6120, NBR 6123, NBR 8800, NBR 14762,
                NBR 9077).
              </p>
            </div>
            <span className="pill pill-info">UF: {ufState}</span>
          </div>

          <div
            className="kpi-grid"
            style={{ marginTop: 12, gridTemplateColumns: "repeat(3,1fr)" }}
          >
            <div className="kpi">
              <div className="kpi-label">Base SINAPI ({ufState})</div>
              <div className="kpi-value">
                R$ {BRL(sinapiSeed.base)}
                <span className="unit">/m²</span>
              </div>
              <div className="kpi-delta">
                faixa R$ {BRL(sinapiSeed.low)}–{BRL(sinapiSeed.high)}/m²
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Banda CUB Sinduscon</div>
              <div className="kpi-value">
                {cubBand ? (
                  <>
                    R$ {BRL(cubBand.low)}
                    <span className="unit">–{BRL(cubBand.high)}/m²</span>
                  </>
                ) : (
                  <>
                    —<span className="unit">UF sem CUB calibrado</span>
                  </>
                )}
              </div>
              <div className="kpi-delta">
                referência macro do padrão construtivo
              </div>
            </div>
            <div className="kpi accent">
              <div className="kpi-label">R$/m² final (com fatores)</div>
              <div className="kpi-value">
                R$ {BRL(viability.costPerM2.base)}
                <span className="unit">/m²</span>
              </div>
              <div className="kpi-delta">
                faixa R$ {BRL(viability.costPerM2.low)}–
                {BRL(viability.costPerM2.high)}/m² · padrão{" "}
                <strong>{viability.standard}</strong>
              </div>
            </div>
          </div>

          <h3
            style={{
              marginTop: 20,
              marginBottom: 8,
              fontSize: "var(--fs-sm)",
              color: "var(--color-text-2)",
            }}
          >
            Composição por macroetapa
            <span className="muted" style={{ fontWeight: 400 }}>
              {" "}
              · faixas % conforme SINAPI/CUB
            </span>
          </h3>
          <div style={{ overflowX: "auto" }}>
            <table className="rpt-table" style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Etapa</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Mínimo</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Base</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Máximo</th>
                </tr>
              </thead>
              <tbody>
                {viability.macroStages.map((s) => (
                  <tr key={s.stage}>
                    <td>{s.label}</td>
                    <td style={{ textAlign: "right" }}>R$ {BRL(s.low)}</td>
                    <td style={{ textAlign: "right" }}>
                      <strong>R$ {BRL(s.base)}</strong>
                    </td>
                    <td style={{ textAlign: "right" }}>R$ {BRL(s.high)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td>
                    <strong>Total estimado</strong>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    R$ {BRL(viability.totalCost.low)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <strong>R$ {BRL(viability.totalCost.base)}</strong>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    R$ {BRL(viability.totalCost.high)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3
            style={{
              marginTop: 20,
              marginBottom: 8,
              fontSize: "var(--fs-sm)",
              color: "var(--color-text-2)",
            }}
          >
            Fatores aplicados pelo agente
            <span className="muted" style={{ fontWeight: 400 }}>
              {" "}
              · cada multiplicador acima/abaixo de 1,00 está justificado
            </span>
          </h3>
          <div style={{ overflowX: "auto" }}>
            <table className="rpt-table" style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Fator</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>
                    Ajuste (low–high)
                  </th>
                  <th style={thStyle}>Por que foi aplicado</th>
                </tr>
              </thead>
              <tbody>
                {viability.factors
                  .filter(
                    (f) =>
                      !(
                        f.range.low === 1 &&
                        f.range.base === 1 &&
                        f.range.high === 1
                      ),
                  )
                  .map((f) => (
                    <tr key={f.name}>
                      <td>{FACTOR_LABEL[f.name] ?? f.name}</td>
                      <td
                        style={{
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {rangePill(f.range)}
                      </td>
                      <td className="muted">
                        {FACTOR_RATIONALE[f.name] ??
                          "Ajuste paramétrico derivado da Base de Conhecimento."}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {viability.notes.length > 0 && (
            <ul
              className="muted"
              style={{ marginTop: 12, fontSize: 12, lineHeight: 1.5 }}
            >
              {viability.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}

          <div
            style={{
              marginTop: 12,
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            {linkedSources.map((s) => (
              <a
                key={s.id}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="pill pill-neutral"
                style={{ textDecoration: "none" }}
                title={s.use}
              >
                {s.name} ↗
              </a>
            ))}
          </div>
        </section>
      )}

      {citedNorms.length > 0 && (
        <section className="card" style={{ padding: 16, marginTop: 16 }}>
          <h2
            style={{ marginTop: 0, marginBottom: 4, fontSize: "var(--fs-md)" }}
          >
            Normas técnicas ABNT aplicáveis
          </h2>
          <p className="text-sm muted" style={{ margin: 0, marginBottom: 12 }}>
            Cada decisão estrutural, de cargas, vento, instalações e segurança
            está ancorada nas NBRs abaixo. Consulte o texto integral no Catálogo
            ABNT.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="rpt-table" style={tableStyle}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 110 }}>Código</th>
                  <th style={thStyle}>Título</th>
                  <th style={thStyle}>Quando aplica</th>
                  <th style={thStyle}>Verificação rápida</th>
                </tr>
              </thead>
              <tbody>
                {citedNorms.map((n) => (
                  <tr key={n.code}>
                    <td>
                      {n.url ? (
                        <a
                          href={n.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "var(--color-primary-500)" }}
                        >
                          {n.code}
                        </a>
                      ) : (
                        n.code
                      )}
                    </td>
                    <td>{n.title}</td>
                    <td className="muted">{n.appliesWhen}</td>
                    <td className="muted">{n.quickCheck ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card" style={{ padding: 16, marginTop: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 4,
          }}
        >
          <h2 style={{ margin: 0, fontSize: "var(--fs-md)" }}>
            Premissas & validações
          </h2>
          {(() => {
            const blk = (report.blocks ?? {}) as {
              validations?: {
                ok?: boolean;
                errors?: { code: string; message: string }[];
                warnings?: { code: string; message: string }[];
              };
            };
            const v = blk.validations ?? {};
            const errs = v.errors?.length ?? 0;
            const warns = v.warnings?.length ?? 0;
            if (errs > 0)
              return (
                <span className="pill pill-danger">
                  {errs} erro{errs > 1 ? "s" : ""} bloqueante
                  {errs > 1 ? "s" : ""}
                </span>
              );
            if (warns > 0)
              return (
                <span className="pill pill-warning">
                  Aprovado com {warns} aviso{warns > 1 ? "s" : ""}
                </span>
              );
            return (
              <span className="pill pill-success">
                Aprovado · sem ressalvas
              </span>
            );
          })()}
        </div>
        <p className="text-sm muted" style={{ marginTop: 0, marginBottom: 12 }}>
          Premissas projetuais extraídas do SitePlan e checagens automáticas
          executadas no momento da emissão.
        </p>

        {/* Premissas chave do projeto */}
        {site && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 8,
              marginBottom: 16,
            }}
          >
            {[
              {
                label: "Recuos (frente/lados/fundo)",
                value: `${site.setbacks.front} / ${site.setbacks.sides} / ${site.setbacks.back} m`,
              },
              {
                label: "Taxa de ocupação (TO máx)",
                value:
                  site.zoning?.to != null
                    ? `${(site.zoning.to * 100).toFixed(0)}%`
                    : "—",
              },
              {
                label: "Coef. aproveitamento (CA)",
                value:
                  site.zoning?.ca != null ? site.zoning.ca.toFixed(2) : "—",
              },
              {
                label: "Edificações",
                value: `${site.buildings.length}`,
              },
              {
                label: "Vagas planejadas (carro / caminhão)",
                value: (() => {
                  const car = site.parking
                    .filter((p) => p.kind === "car")
                    .reduce((a, p) => a + p.stallCount, 0);
                  const truck = site.parking
                    .filter((p) => p.kind === "truck")
                    .reduce((a, p) => a + p.stallCount, 0);
                  return `${car} / ${truck}`;
                })(),
              },
              {
                label: "Portões",
                value: `${site.gates.length}`,
              },
              ...(dominant
                ? [
                    {
                      label: "Sistema (galpão dominante)",
                      value: dominant.shed.structure.system,
                    },
                    {
                      label: "Pé-direito · Vão livre",
                      value: `${dominant.shed.structure.clearHeight} m · ${dominant.shed.structure.freeSpan} m`,
                    },
                    {
                      label: "Cobertura · Fechamento",
                      value: `${dominant.shed.roof.cover.replace(/_/g, " ")} · ${dominant.shed.envelope.walls.replace(/_/g, " ")}`,
                    },
                    {
                      label: "AVCB requerido",
                      value: dominant.shed.safety.avcbRequired ? "Sim" : "Não",
                    },
                  ]
                : []),
            ].map((kv) => (
              <div
                key={kv.label}
                style={{
                  background: "var(--color-surface-elevated)",
                  border: "1px solid var(--color-stroke)",
                  borderRadius: 8,
                  padding: "8px 10px",
                }}
              >
                <div
                  className="muted"
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                  }}
                >
                  {kv.label}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>
                  {kv.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Erros e avisos das validações */}
        {(() => {
          const blk = (report.blocks ?? {}) as {
            validations?: {
              errors?: { code: string; message: string }[];
              warnings?: { code: string; message: string }[];
            };
          };
          const errs = blk.validations?.errors ?? [];
          const warns = blk.validations?.warnings ?? [];
          if (errs.length === 0 && warns.length === 0) {
            return (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 12px",
                  background: "var(--color-success-soft)",
                  border: "1px solid var(--color-success)",
                  borderRadius: 8,
                  fontSize: 13,
                }}
              >
                <span style={{ color: "var(--color-success)" }}>✓</span>
                Todas as regras de zoneamento, recuos, ocupação e acessos foram
                atendidas.
              </div>
            );
          }
          return (
            <div style={{ display: "grid", gap: 8 }}>
              {errs.map((e, i) => (
                <div
                  key={`e${i}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr",
                    gap: 10,
                    padding: "10px 12px",
                    background: "var(--color-danger-soft)",
                    border: "1px solid var(--color-danger)",
                    borderRadius: 8,
                    fontSize: 13,
                    alignItems: "start",
                  }}
                >
                  <span
                    className="pill pill-danger"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {e.code}
                  </span>
                  <span>{e.message}</span>
                </div>
              ))}
              {warns.map((w, i) => (
                <div
                  key={`w${i}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr",
                    gap: 10,
                    padding: "10px 12px",
                    background: "var(--color-warning-soft)",
                    border: "1px solid var(--color-warning)",
                    borderRadius: 8,
                    fontSize: 13,
                    alignItems: "start",
                  }}
                >
                  <span
                    className="pill pill-warning"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {w.code}
                  </span>
                  <span>{w.message}</span>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Metadados de rastreabilidade */}
        {(() => {
          const blk = (report.blocks ?? {}) as {
            sitePlanId?: string;
            sitePlanHash?: string;
            sitePlanVersion?: number;
          };
          return (
            <div
              style={{
                marginTop: 14,
                paddingTop: 10,
                borderTop: "1px solid var(--color-stroke)",
                display: "flex",
                flexWrap: "wrap",
                gap: 16,
                fontSize: 11,
                color: "var(--color-text-secondary)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {blk.sitePlanVersion != null && (
                <span>SitePlan v{blk.sitePlanVersion}</span>
              )}
              {blk.sitePlanId && <span>id: {blk.sitePlanId}</span>}
              {blk.sitePlanHash && (
                <span title={blk.sitePlanHash}>
                  hash: {blk.sitePlanHash.slice(0, 12)}…
                </span>
              )}
            </div>
          );
        })()}
      </section>
    </>
  );
}
