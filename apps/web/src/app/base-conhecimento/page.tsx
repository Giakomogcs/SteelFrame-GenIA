import { Breadcrumb } from "@/components/Breadcrumb";
import {
  SOURCES,
  sourcesByCategory,
  NORMS,
  AGENT_QUESTIONS,
  GROUP_LABELS,
  questionsByGroup,
  COST_STAGES,
  STANDARD_FACTORS,
  COST_PER_M2_BY_STATE,
  TERRAIN_FACTOR,
} from "@/lib/knowledge";

export const metadata = {
  title: "Base de Conhecimento — SteelFrame GenIA",
};

const CATEGORY_TITLE = {
  topo: "Topografia & Mapa",
  custo: "Custos (SINAPI / CUB)",
  urbano: "Legislação urbana",
  norma: "Normas técnicas",
  geo: "Geocoding & APIs",
} as const;

function SourceCard({
  title,
  category,
}: {
  title: string;
  category: keyof typeof CATEGORY_TITLE;
}) {
  const items = sourcesByCategory(category);
  if (items.length === 0) return null;
  return (
    <section className="card">
      <div className="card-row">
        <div>
          <div className="card-title">{title}</div>
          <div className="card-subtitle">
            Fontes oficiais consultadas pelo agente
          </div>
        </div>
      </div>
      <div className="stack-sm">
        {items.map((s) => (
          <a
            key={s.id}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "block",
              padding: "var(--space-3) var(--space-4)",
              background: "var(--color-surface-elevated)",
              border: "1px solid var(--color-stroke)",
              borderRadius: "var(--radius-md)",
              transition: "border-color 0.15s ease",
            }}
            className="kb-source"
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span
                style={{ color: "var(--color-primary-500)", fontWeight: 600 }}
              >
                {s.name}
              </span>
              <span className="text-xs muted">↗</span>
            </div>
            <div className="text-sm muted" style={{ marginTop: 4 }}>
              {s.use}
            </div>
            <div
              className="mono text-xs"
              style={{
                marginTop: 6,
                color: "var(--color-text-muted)",
                wordBreak: "break-all",
              }}
            >
              {s.url}
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

const FEATURED_STATES: Array<keyof typeof COST_PER_M2_BY_STATE> = [
  "SP",
  "RJ",
  "MG",
  "RS",
  "PR",
  "SC",
  "BA",
  "PE",
  "GO",
  "DF",
];

export default function KnowledgePage() {
  return (
    <>
      <header className="page-header">
        <div className="stack-sm">
          <Breadcrumb
            items={[
              { label: "SteelFrame GenIA", href: "/" },
              { label: "Base de conhecimento" },
            ]}
          />
          <div className="page-title-row">
            <h1>Fontes e regras que alimentam o agente</h1>
            <span className="pill pill-primary">
              <span className="dot" />
              Auditável
            </span>
          </div>
          <p className="text-sm muted" style={{ maxWidth: "72ch" }}>
            Esta página lista TODAS as fontes oficiais, normas técnicas, fatores
            paramétricos e perguntas estruturadas que o Agente Pré-Projeto usa
            para gerar estimativas de viabilidade. Cada item é injetado
            diretamente no system prompt da IA — tornando o relatório auditável
            e o agente independente.
          </p>
          <div className="text-xs muted">
            {SOURCES.length} fontes oficiais · {NORMS.length} normas ABNT ·{" "}
            {AGENT_QUESTIONS.length} perguntas estruturadas ·{" "}
            {COST_STAGES.length} macroetapas paramétricas
          </div>
        </div>
      </header>

      <div className="grid-3">
        <SourceCard title={CATEGORY_TITLE.topo} category="topo" />
        <SourceCard title={CATEGORY_TITLE.custo} category="custo" />
        <SourceCard title={CATEGORY_TITLE.urbano} category="urbano" />
      </div>

      <section className="card">
        <div className="card-row">
          <div>
            <div className="card-title">Normas técnicas aplicáveis (ABNT)</div>
            <div className="card-subtitle">
              Catálogo machine-readable usado pelo agente para preencher{" "}
              <span className="mono">compliance.norms</span>
            </div>
          </div>
        </div>
        <table className="ds-table">
          <thead>
            <tr>
              <th style={{ width: 140 }}>Código</th>
              <th style={{ width: 130 }}>Domínio</th>
              <th>Aplica quando</th>
            </tr>
          </thead>
          <tbody>
            {NORMS.map((n) => (
              <tr key={n.code}>
                <td
                  className="mono"
                  style={{ color: "var(--color-primary-500)", fontWeight: 700 }}
                >
                  {n.code}
                </td>
                <td className="text-sm muted">{n.domain}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{n.title}</div>
                  <div className="text-sm muted" style={{ marginTop: 2 }}>
                    {n.appliesWhen}
                  </div>
                  {n.quickCheck && (
                    <div
                      className="text-xs"
                      style={{ marginTop: 4, color: "var(--color-text-muted)" }}
                    >
                      ✓ {n.quickCheck}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs muted" style={{ marginTop: "var(--space-3)" }}>
          Consulta oficial:{" "}
          <a
            href="https://www.abntcatalogo.com.br/"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "var(--color-primary-500)",
              textDecoration: "underline",
            }}
          >
            abntcatalogo.com.br
          </a>
        </p>
      </section>

      <section className="card">
        <div className="card-row">
          <div>
            <div className="card-title">
              Custo paramétrico R$/m² (seed SINAPI/CUB)
            </div>
            <div className="card-subtitle">
              Tabela de ancoragem por UF e padrão construtivo — atualizada
              periodicamente.
            </div>
          </div>
        </div>
        <table className="ds-table">
          <thead>
            <tr>
              <th style={{ width: 80 }}>UF</th>
              <th>Econômico</th>
              <th>Médio</th>
              <th>Alto padrão</th>
            </tr>
          </thead>
          <tbody>
            {FEATURED_STATES.map((uf) => {
              const row = COST_PER_M2_BY_STATE[uf];
              return (
                <tr key={uf}>
                  <td className="mono" style={{ fontWeight: 700 }}>
                    {uf}
                  </td>
                  <td>R$ {row.economico.toLocaleString("pt-BR")}</td>
                  <td>R$ {row.medio.toLocaleString("pt-BR")}</td>
                  <td>R$ {row.alto.toLocaleString("pt-BR")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="grid-3">
        <section className="card">
          <div className="card-row">
            <div>
              <div className="card-title">Fator por padrão</div>
              <div className="card-subtitle">Aplicado sobre o R$/m² base</div>
            </div>
          </div>
          <table className="ds-table">
            <thead>
              <tr>
                <th>Padrão</th>
                <th>low</th>
                <th>base</th>
                <th>high</th>
              </tr>
            </thead>
            <tbody>
              {(
                Object.keys(STANDARD_FACTORS) as Array<
                  keyof typeof STANDARD_FACTORS
                >
              ).map((k) => {
                const f = STANDARD_FACTORS[k];
                return (
                  <tr key={k}>
                    <td className="mono">{k}</td>
                    <td>{f.low.toFixed(2)}</td>
                    <td>{f.base.toFixed(2)}</td>
                    <td>{f.high.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="card">
          <div className="card-row">
            <div>
              <div className="card-title">Fator por terreno (inclinação)</div>
              <div className="card-subtitle">Classificação via slope %</div>
            </div>
          </div>
          <table className="ds-table">
            <thead>
              <tr>
                <th>Bucket</th>
                <th>low</th>
                <th>base</th>
                <th>high</th>
              </tr>
            </thead>
            <tbody>
              {(
                Object.keys(TERRAIN_FACTOR) as Array<
                  keyof typeof TERRAIN_FACTOR
                >
              ).map((k) => {
                const f = TERRAIN_FACTOR[k];
                return (
                  <tr key={k}>
                    <td className="mono">{k}</td>
                    <td>{f.low.toFixed(2)}</td>
                    <td>{f.base.toFixed(2)}</td>
                    <td>{f.high.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="card">
          <div className="card-row">
            <div>
              <div className="card-title">Distribuição por macroetapa</div>
              <div className="card-subtitle">Faixa low–high do custo total</div>
            </div>
          </div>
          <table className="ds-table">
            <thead>
              <tr>
                <th>Etapa</th>
                <th>low</th>
                <th>high</th>
              </tr>
            </thead>
            <tbody>
              {COST_STAGES.map((s) => (
                <tr key={s.stage}>
                  <td>{s.label}</td>
                  <td>{Math.round(s.low * 100)}%</td>
                  <td>{Math.round(s.high * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="card">
        <div className="card-row">
          <div>
            <div className="card-title">Perguntas estruturadas do agente</div>
            <div className="card-subtitle">
              Roteiro do Agente Pré-Projeto em Steel Frame — usado pelo briefing
              e exposto via <span className="mono">AGENT_QUESTIONS</span>.
            </div>
          </div>
        </div>
        <div className="stack-md">
          {(Object.keys(GROUP_LABELS) as Array<keyof typeof GROUP_LABELS>).map(
            (g) => (
              <div key={g}>
                <div
                  className="text-xs"
                  style={{
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: "var(--color-text-muted)",
                    marginBottom: 6,
                  }}
                >
                  {GROUP_LABELS[g]}
                </div>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {questionsByGroup(g).map((q) => (
                    <li key={q.id} style={{ marginBottom: 4 }}>
                      <span>{q.label}</span>{" "}
                      {q.options && (
                        <span className="text-xs muted">
                          — {q.options.join(" / ")}
                        </span>
                      )}
                      {q.optional && (
                        <span
                          className="text-xs"
                          style={{
                            marginLeft: 6,
                            color: "var(--color-text-muted)",
                          }}
                        >
                          (opcional)
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-row">
          <div>
            <div className="card-title">Como o agente cita</div>
            <div className="card-subtitle">Contrato de evidência</div>
          </div>
        </div>
        <p className="text-sm muted">
          Toda hipótese adotada que não foi explicitamente informada no briefing
          é registrada na seção <b>premissas</b> do relatório. Cada custo remete
          a uma faixa SINAPI/CUB, cada norma citada pode ser conferida no
          Catálogo ABNT, e cada camada topográfica indica sua fonte
          (OpenTopography, OpenTopoMap ou Esri). O agente NUNCA cita norma ou
          fonte que não esteja neste catálogo.
        </p>
      </section>

      <div className="toast toast-warning" style={{ maxWidth: "none" }}>
        <div>
          <div className="toast-title">⚠️ Aviso técnico</div>
          <div className="toast-desc">
            Esta plataforma entrega estimativas preliminares. Decisões finais
            devem ser embasadas por projetos executivos, ART/RRT, sondagem,
            levantamento topográfico e aprovação legal.
          </div>
        </div>
      </div>
    </>
  );
}
