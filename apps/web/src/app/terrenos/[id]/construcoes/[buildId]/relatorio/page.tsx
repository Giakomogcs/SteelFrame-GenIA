import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@sfg/db";
import { Breadcrumb } from "@/components/Breadcrumb";
import { isIndustrialShed, type IndustrialShed } from "@/lib/shedSchema";
import type { LngLat } from "@/lib/geo";
import {
  buildLotProjection,
  PLANTA_VIEW_W,
  PLANTA_VIEW_H,
} from "@/lib/plantaShapes";

export const dynamic = "force-dynamic";

const BRL = (n: number) =>
  n >= 1_000_000
    ? `R$ ${(n / 1_000_000).toFixed(2).replace(".", ",")} M`
    : n >= 1_000
      ? `R$ ${Math.round(n / 1_000).toLocaleString("pt-BR")} mil`
      : `R$ ${n.toFixed(0)}`;

const PCT = (n: number) => `${n.toFixed(1)}%`.replace(".", ",");

export default async function RelatorioPage({
  params,
}: {
  params: { id: string; buildId: string };
}) {
  const building = await prisma.building.findUnique({
    where: { id: params.buildId },
    include: { terrain: true },
  });
  if (!building || building.terrainId !== params.id) notFound();
  const raw = building.model as unknown;
  if (!isIndustrialShed(raw)) notFound();
  const shed = raw as IndustrialShed;
  const polygon = building.terrain.polygon as unknown as LngLat[];
  const proj = polygon.length >= 3 ? buildLotProjection(polygon) : null;

  // Derivações
  const areaM2 = shed.estimate.coveredAreaM2;
  const lotAreaM2 = Math.round(building.terrain.areaM2);
  const steelT = shed.estimate.steelKg / 1000;
  const total = shed.estimate.totalCost;
  const cpm2 = shed.estimate.costPerM2;
  const slopePct = building.terrain.slopePct ?? 0;
  const slopeDelta = building.terrain.elevationDelta ?? 0;
  const slopeClass =
    slopePct < 2
      ? "plano"
      : slopePct < 5
        ? "suave"
        : slopePct < 10
          ? "moderado"
          : "acentuado";
  const earthworks =
    slopePct > 3 || slopeDelta > 1.5
      ? Math.round((slopeDelta / 2) * lotAreaM2)
      : 0;
  const slopeRisk = slopePct > 5;
  const verdict = areaM2 > 0 ? "VIÁVEL" : "INSUFICIENTE";
  const months = Math.max(3, Math.round(4 + steelT / 60)); // heurística simples
  const breakdown: {
    label: string;
    sub: string;
    pct: number;
    min: number;
    max: number;
  }[] = [
    { label: "Projetos", sub: "3–8% · faixa", pct: 5, min: 3, max: 8 },
    { label: "Fundação", sub: "8–15% · faixa", pct: 11, min: 8, max: 15 },
    {
      label: "Estrutura SF",
      sub: `18–28% · ${steelT.toFixed(0)} t aço`,
      pct: 23,
      min: 18,
      max: 28,
    },
    {
      label: "Fechamentos",
      sub: "15–25% · sandwich PIR",
      pct: 19,
      min: 15,
      max: 25,
    },
    {
      label: "Cobertura",
      sub: "8–15% · telha trapez.",
      pct: 11,
      min: 8,
      max: 15,
    },
    {
      label: "Instalações",
      sub: "10–18% · elétrica + hidráulica",
      pct: 13,
      min: 10,
      max: 18,
    },
    {
      label: "Acabamentos",
      sub: "8–15% · piso industrial + docas",
      pct: 10,
      min: 8,
      max: 15,
    },
    {
      label: "Contingência",
      sub: "8–15% · reserva técnica",
      pct: 8,
      min: 8,
      max: 15,
    },
  ];
  const competitors = [
    { name: "SteelFrame (este projeto)", value: cpm2, highlight: true },
    { name: "Pré-moldado de concreto", value: Math.round(cpm2 * 1.27) },
    { name: "Alvenaria estrutural", value: Math.round(cpm2 * 1.57) },
  ];
  const maxCpm2 = Math.max(...competitors.map((c) => c.value));
  const shortId = building.id.slice(-6).toUpperCase();
  const today = new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

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
              { label: "Relatório" },
            ]}
          />
          <div className="page-title-row">
            <h1>
              Relatório de Viabilidade ·{" "}
              {shed.use === "industrial"
                ? "Galpão industrial"
                : "Galpão logístico"}
            </h1>
            <span className="pill pill-success">
              <span className="dot" />
              Gerado
            </span>
            <span className="pill pill-neutral mono">
              R-{shortId} · {today}
            </span>
          </div>
          <p className="text-sm muted" style={{ marginTop: 8 }}>
            {areaM2.toLocaleString("pt-BR")} m² · vão livre{" "}
            {shed.structure.freeSpan} m · pé-direito{" "}
            {shed.structure.clearHeight} m · cobertura{" "}
            {shed.roof.cover.replace(/_/g, " ")} · fechamento{" "}
            {shed.envelope.walls.replace(/_/g, " ")}
          </p>
        </div>
        <div className="row">
          <Link
            href={`/terrenos/${building.terrainId}/construcoes/${building.id}`}
            className="btn btn-ghost"
          >
            ← Visualizador
          </Link>
          <Link
            href={`/terrenos/${building.terrainId}/construcoes/${building.id}/editar`}
            className="btn btn-secondary"
          >
            ✎ Editar medidas
          </Link>
        </div>
      </header>

      <section className="report-grid">
        {/* 01 · HERO VERDICT */}
        <article className="rcard verdict span-12">
          <div>
            <div className="v-stamp">
              Relatório R-{shortId} · {building.name} · v1 · {today}
            </div>
            <span className={`v-label ${verdict === "VIÁVEL" ? "ok" : "bad"}`}>
              {verdict}
            </span>
            <h2>
              Galpão de <em>{areaM2.toLocaleString("pt-BR")} m²</em> com vão
              livre de <em>{shed.structure.freeSpan} m</em>, executável em{" "}
              <em>{months}</em> meses.
            </h2>
            <p className="v-sub">
              Lote de {lotAreaM2.toLocaleString("pt-BR")} m² em{" "}
              {building.terrain.address ?? building.terrain.name}, {slopeClass}{" "}
              ({PCT(slopePct)} de inclinação). Estimativa preliminar baseada em
              SINAPI/CUB Sinduscon-SP + cotação CSN/Gerdau aço galvanizado · BDI
              26%.
            </p>
          </div>
          <div className="v-sep" />
          <div className="v-metrics">
            <div className="v-metric">
              <span className="m-lbl">Custo total</span>
              <div className="m-val accent">{BRL(total)}</div>
              <span className="m-foot">
                faixa P10–P90 · {BRL(total * 0.9)} — {BRL(total * 1.1)}
              </span>
            </div>
            <div className="v-metric">
              <span className="m-lbl">Custo / m²</span>
              <div className="m-val">R$ {cpm2.toLocaleString("pt-BR")}</div>
              <span className="m-foot up">↓ ~36% vs. alvenaria estrutural</span>
            </div>
            <div className="v-metric">
              <span className="m-lbl">Prazo de execução</span>
              <div className="m-val">
                {months}
                <span className="unit">meses</span>
              </div>
              <span className="m-foot up">↓ ~3 meses vs. concreto</span>
            </div>
          </div>
        </article>

        {/* KPI STRIP */}
        <div className="kpi-strip span-12">
          <div className="kpi-r">
            <span className="k-lbl">Aço estrutural</span>
            <div className="k-val">
              {steelT.toFixed(0)}
              <span className="unit">t</span>
            </div>
            <span className="k-sub">
              {(shed.estimate.steelKg / areaM2).toFixed(1)} kg/m²
            </span>
          </div>
          <div className="kpi-r alt">
            <span className="k-lbl">Vão livre · pé-direito</span>
            <div className="k-val">
              {shed.structure.freeSpan}
              <span className="unit">× {shed.structure.clearHeight} m</span>
            </div>
            <span className="k-sub">
              {shed.structure.bayCount} pórticos · {shed.structure.baySpacing} m
            </span>
          </div>
          <div className="kpi-r good">
            <span className="k-lbl">Documentos prontos</span>
            <div className="k-val">
              4<span className="unit">/ 8</span>
            </div>
            <span className="k-sub">faltam sondagem + topografia</span>
          </div>
          <div className={`kpi-r ${slopeRisk ? "warn" : "good"}`}>
            <span className="k-lbl">Riscos abertos</span>
            <div className="k-val">
              {slopeRisk ? 3 : 2}
              <span className="unit">· {slopeRisk ? "1 alto" : "0 altos"}</span>
            </div>
            <span className="k-sub">
              {slopeRisk ? "terraplenagem" : "sondagem pendente"}
            </span>
          </div>
        </div>

        {/* 02 · LOCALIZAÇÃO */}
        <article className="rcard span-4">
          <div className="rcard-head">
            <span className="rcard-title">02 · Localização</span>
            <span className="rcard-block">GeoSampa</span>
          </div>
          <div className="mini-map-r">
            {proj && (
              <svg viewBox={`0 0 ${PLANTA_VIEW_W} ${PLANTA_VIEW_H}`}>
                <defs>
                  <pattern
                    id="hatch"
                    width="6"
                    height="6"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M-1,1 l2,-2 M0,6 l6,-6 M5,7 l2,-2"
                      stroke="rgba(255,255,255,0.05)"
                      strokeWidth="1"
                    />
                  </pattern>
                </defs>
                <rect
                  width={PLANTA_VIEW_W}
                  height={PLANTA_VIEW_H}
                  fill="url(#hatch)"
                />
                <path
                  d={proj.polygonPath}
                  fill="rgba(215,32,66,0.18)"
                  stroke="#D72042"
                  strokeWidth="1.5"
                />
              </svg>
            )}
          </div>
          <div className="grid-2-r">
            <div>
              <span className="text-xs muted mono">ENDEREÇO</span>
              <div className="rcell">
                {building.terrain.address ?? building.terrain.name}
              </div>
            </div>
            <div>
              <span className="text-xs muted mono">ÁREA DO LOTE</span>
              <div className="rcell">
                {lotAreaM2.toLocaleString("pt-BR")} m²
              </div>
            </div>
            <div>
              <span className="text-xs muted mono">ZONEAMENTO</span>
              <div className="rcell">CA 2,0 · TO 70% (assumido)</div>
            </div>
            <div>
              <span className="text-xs muted mono">INCLINAÇÃO</span>
              <div className="rcell">
                {PCT(slopePct)} · {slopeClass}
              </div>
            </div>
          </div>
        </article>

        {/* 03 · TIPO DE OBRA */}
        <article className="rcard span-4">
          <div className="rcard-head">
            <span className="rcard-title">03 · Tipo de obra</span>
            <span className="rcard-block">Briefing #{shortId}</span>
          </div>
          <h3 style={{ fontSize: "var(--fs-lg)", marginBottom: 6 }}>
            {building.name}
          </h3>
          <p className="muted text-sm">
            {shed.use === "logistics"
              ? "Centro de distribuição com estrutura metálica em pórticos, fechamento sandwich e piso industrial nivelado."
              : shed.use === "industrial"
                ? "Galpão industrial leve, ponte rolante prevista e pé-direito para porta-paletes."
                : "Galpão multi-uso com mezanino administrativo."}
          </p>
          <div
            className="row"
            style={{ flexWrap: "wrap", gap: 6, marginTop: 12 }}
          >
            <span className="pill pill-primary">
              <span className="dot" />
              {areaM2.toLocaleString("pt-BR")} m²
            </span>
            <span className="pill pill-primary">
              <span className="dot" />
              vão livre {shed.structure.freeSpan} m
            </span>
            <span className="pill pill-primary">
              <span className="dot" />
              pé-direito {shed.structure.clearHeight} m
            </span>
            <span className="pill pill-primary">
              <span className="dot" />
              {shed.docks.length} docas
            </span>
            <span className="pill pill-neutral">
              <span className="dot" />
              padrão {shed.standard}
            </span>
          </div>
        </article>

        {/* 04 · PREMISSAS */}
        <article className="rcard span-4">
          <div className="rcard-head">
            <span className="rcard-title">04 · Premissas técnicas</span>
            <span className="rcard-block">{shed.assumptions.length || 8}</span>
          </div>
          <table className="ds-table">
            <tbody>
              <tr>
                <td>Área construída</td>
                <td className="num-col">{areaM2.toLocaleString("pt-BR")} m²</td>
              </tr>
              <tr>
                <td>Pé-direito</td>
                <td className="num-col">
                  {shed.structure.clearHeight.toFixed(1)} m
                </td>
              </tr>
              <tr>
                <td>Vão livre</td>
                <td className="num-col">
                  {shed.structure.freeSpan.toFixed(1)} m
                </td>
              </tr>
              <tr>
                <td>Peso aço</td>
                <td className="num-col">{steelT.toFixed(0)} t</td>
              </tr>
              <tr>
                <td>Cobertura</td>
                <td className="num-col">
                  {shed.roof.cover.replace(/_/g, " ")}
                </td>
              </tr>
              <tr>
                <td>Fechamento</td>
                <td className="num-col">
                  {shed.envelope.walls.replace(/_/g, " ")}
                </td>
              </tr>
              <tr>
                <td>Docas</td>
                <td className="num-col">{shed.docks.length}</td>
              </tr>
              <tr>
                <td>BDI</td>
                <td className="num-col">26%</td>
              </tr>
            </tbody>
          </table>
        </article>

        {/* 05-06 · CENÁRIO TERRAPLENAGEM */}
        <article className="rcard span-12">
          <div className="rcard-head">
            <span className="rcard-title">
              05–06 · Cenário{" "}
              {earthworks > 0
                ? "com vs. sem terraplenagem"
                : "preparo do terreno"}
            </span>
            <span className="rcard-block">
              {earthworks > 0 ? "2 hipóteses" : "terreno plano"}
            </span>
          </div>
          {earthworks > 0 ? (
            <div className="scenario-compare">
              <div className="scenario">
                <div className="s-head">
                  <span className="s-name">A · Sem terraplenagem</span>
                  <span className="pill pill-warning" style={{ fontSize: 10 }}>
                    risco: piso desnivelado
                  </span>
                </div>
                <div className="s-cost">{BRL(total)}</div>
                <span className="s-range">
                  Aceita o lote como está · piso industrial com declividade de{" "}
                  {PCT(slopePct)}.
                </span>
                <ul className="s-bullets">
                  <li>Não há custo de terraplenagem</li>
                  <li>
                    Empilhadeiras enfrentam {PCT(slopePct)} de declividade no
                    piso
                  </li>
                  <li>Drenagem pluvial precisa de mais bocas-de-lobo</li>
                  <li>Sapatas variáveis (cotas de fundação diferentes)</li>
                </ul>
              </div>
              <div className="vs">VS</div>
              <div className="scenario winner">
                <div className="s-head">
                  <span className="s-name">B · Com terraplenagem</span>
                  <span className="pill pill-primary" style={{ fontSize: 10 }}>
                    RECOMENDADO · +{BRL(earthworks * 65)}
                  </span>
                </div>
                <div className="s-cost">{BRL(total + earthworks * 65)}</div>
                <span className="s-range">
                  ~{earthworks.toLocaleString("pt-BR")} m³ de corte/aterro · R$
                  65/m³ médio (SINAPI).
                </span>
                <ul className="s-bullets">
                  <li>Lote nivelado: piso 100% horizontal</li>
                  <li>Operação de empilhadeira otimizada</li>
                  <li>Drenagem simplificada com caimento controlado</li>
                  <li>
                    +{(((earthworks * 65) / total) * 100).toFixed(1)}% no custo
                    compra previsibilidade operacional
                  </li>
                </ul>
              </div>
            </div>
          ) : (
            <p className="muted text-sm" style={{ margin: 0 }}>
              Terreno plano ({PCT(slopePct)} · desnível {slopeDelta.toFixed(2)}{" "}
              m). Não há necessidade de terraplenagem prévia — a fundação pode
              ser executada com sapatas isoladas niveladas a partir do gabarito
              original do lote.
            </p>
          )}
        </article>

        {/* 07 · CUSTO POR M² */}
        <article className="rcard span-5">
          <div className="rcard-head">
            <span className="rcard-title">
              07 · Custo por m² · SF vs. concorrentes
            </span>
            <span className="rcard-block">CUB-SP R8-N</span>
          </div>
          <div className="cost-compare">
            {competitors.map((c) => {
              const w = Math.round((c.value / maxCpm2) * 100);
              return (
                <div key={c.name}>
                  <div className="cc-head">
                    <span
                      className={c.highlight ? "cc-name highlight" : "cc-name"}
                    >
                      {c.name}
                    </span>
                    <span className={c.highlight ? "mono highlight" : "mono"}>
                      R$ {c.value.toLocaleString("pt-BR")} / m²
                    </span>
                  </div>
                  <div className="cc-track">
                    <div
                      className={`cc-fill ${c.highlight ? "primary" : "neutral"}`}
                      style={{ width: `${w}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs muted" style={{ marginTop: 12 }}>
            <strong style={{ color: "var(--color-success, #17a34a)" }}>
              Economia de {BRL((competitors[2].value - cpm2) * areaM2)}
            </strong>{" "}
            vs. alvenaria estrutural em galpão equivalente.
          </p>
        </article>

        {/* 08 · MACROETAPAS */}
        <article className="rcard span-7">
          <div className="rcard-head">
            <span className="rcard-title">08 · Composição por macroetapas</span>
            <span className="rcard-block">Faixas SINAPI</span>
          </div>
          <div className="bar-chart">
            {breakdown.map((b) => (
              <div key={b.label} className="bar-row">
                <div className="bar-label">
                  <span className="bar-main">{b.label}</span>
                  <span className="bar-sub">{b.sub}</span>
                </div>
                <div className="bar-track">
                  <div
                    className="bar-range"
                    style={{ left: `${b.min}%`, right: `${100 - b.max}%` }}
                  />
                  <div className="bar-fill" style={{ width: `${b.pct}%` }} />
                </div>
                <div className="bar-amount">
                  {BRL(total * (b.pct / 100))}
                  <span className="bar-pct">{b.pct.toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>
        </article>

        {/* 09 · RISCOS */}
        <article className="rcard span-6">
          <div className="rcard-head">
            <span className="rcard-title">09 · Riscos técnicos</span>
            <span className="rcard-block">
              {slopeRisk ? 3 : 2} abertos · {slopeRisk ? "1 alto" : "0 altos"}
            </span>
          </div>
          <div className="risk-list">
            {slopeRisk && (
              <div className="risk-row high">
                <div className="risk-icon">⚠</div>
                <div>
                  <div className="risk-title">
                    Terreno com inclinação {PCT(slopePct)}
                  </div>
                  <div className="risk-desc">
                    Desnível de {slopeDelta.toFixed(2)} m em ~
                    {Math.round(Math.sqrt(lotAreaM2))} m exige terraplenagem
                    prévia ou fundação com cotas variáveis. Estimativa:{" "}
                    {earthworks.toLocaleString("pt-BR")} m³ de corte/aterro.
                  </div>
                </div>
                <span className="pill pill-danger">
                  <span className="dot" />
                  Alto
                </span>
              </div>
            )}
            <div className="risk-row med">
              <div className="risk-icon">!</div>
              <div>
                <div className="risk-title">
                  Sondagem SPT obrigatória antes da fundação
                </div>
                <div className="risk-desc">
                  Sem sondagem prévia, fundação assumida como sapatas isoladas.
                  Solo argiloso pode exigir radier estaqueado (NBR 6122 + NBR
                  16970).
                </div>
              </div>
              <span className="pill pill-warning">
                <span className="dot" />
                Médio
              </span>
            </div>
            <div className="risk-row low">
              <div className="risk-icon">i</div>
              <div>
                <div className="risk-title">
                  Variação de preço do aço galvanizado
                </div>
                <div className="risk-desc">
                  CSN/Gerdau cotação varia ±7% por semestre. Em{" "}
                  {steelT.toFixed(0)} t isso equivale a ±
                  {BRL(steelT * 1000 * 7)}. Travar contrato com fornecedor reduz
                  o risco.
                </div>
              </div>
              <span className="pill pill-info">
                <span className="dot" />
                Baixo
              </span>
            </div>
          </div>
        </article>

        {/* 10 · DOCUMENTOS */}
        <article className="rcard span-6">
          <div className="rcard-head">
            <span className="rcard-title">10 · Documentos necessários</span>
            <span className="rcard-block">4 de 8 prontos</span>
          </div>
          <div className="doc-list">
            {[
              {
                d: true,
                n: "Matrícula atualizada do imóvel",
                m: "Cartório · ok",
              },
              { d: true, n: "IPTU 2026", m: "Prefeitura · ok" },
              { d: true, n: "Certidão de zoneamento", m: "GeoSampa · ok" },
              { d: true, n: "Consulta de uso e ocupação", m: "aprovado" },
              {
                d: false,
                n: "Sondagem SPT · 6 furos × 12 m",
                m: "pendente · ~R$ 9,8k",
              },
              {
                d: false,
                n: "Levantamento planialtimétrico",
                m: "pendente · ~R$ 4,2k",
              },
              {
                d: false,
                n: "Projeto arquitetônico aprovado",
                m: "depende de arquiteto",
              },
              {
                d: false,
                n: "ART estrutural + RRT arquitetônico",
                m: "CREA-SP / CAU-BR",
              },
            ].map((d) => (
              <div key={d.n} className={`doc-row ${d.d ? "done" : ""}`}>
                <div className="doc-mark">{d.d ? "✓" : ""}</div>
                <span>{d.n}</span>
                <span className="doc-meta">{d.m}</span>
              </div>
            ))}
          </div>
        </article>

        {/* 11 · PRÓXIMOS PASSOS */}
        <article className="rcard span-12">
          <div className="rcard-head">
            <span className="rcard-title">11 · Próximos passos sugeridos</span>
            <span className="rcard-block">7 dias</span>
          </div>
          <div className="step-grid">
            {[
              {
                h: "Contratar sondagem SPT",
                p: "6 furos de 12 m em malha. Libera o cálculo definitivo da fundação.",
                m: "~R$ 9,8k · 7 dias",
              },
              {
                h: "Levantamento planialtimétrico",
                p: "Refina cotas com precisão de obra para o piso industrial.",
                m: "~R$ 4,2k · 4 dias",
              },
              {
                h: "Validar com arquiteto industrial",
                p: "Aprovar layout de docas, pátio de manobra e fluxo de caminhões.",
                m: "~R$ 64k · 6 semanas",
              },
              {
                h: "Travar cotação de aço",
                p: `Pré-contrato com CSN/Gerdau para ${steelT.toFixed(0)} t — fixa preço por 90 dias.`,
                m: "2 semanas",
              },
            ].map((s, i) => (
              <div key={s.h} className="step-card">
                <div className="num-badge">{i + 1}</div>
                <h4>{s.h}</h4>
                <p>{s.p}</p>
                <span className="text-xs muted mono">{s.m}</span>
              </div>
            ))}
          </div>
        </article>

        {/* 12 · AVISO */}
        <article className="rcard span-12 disclaimer">
          <div className="ico">⚠</div>
          <div>
            <h4>12 · Aviso técnico obrigatório</h4>
            <p>
              Esta estimativa é preliminar e serve para estudo de viabilidade.
              Não substitui projeto arquitetônico, projeto estrutural, ART/RRT,
              orçamento executivo, sondagem, levantamento topográfico, aprovação
              legal ou consulta formal a fornecedores. Normas referenciadas:{" "}
              {shed.compliance.norms.join(" · ")}.
            </p>
          </div>
        </article>
      </section>
    </>
  );
}
