import { Breadcrumb } from "@/components/Breadcrumb";

export const metadata = {
  title: "Base de Conhecimento — SteelFrame GenIA",
};

interface Source {
  name: string;
  url: string;
  use: string;
}

const TOPO: Source[] = [
  {
    name: "OpenTopography",
    url: "https://opentopography.org/home",
    use: "Modelos digitais de elevação (SRTM, ALOS), curvas de nível e perfil de elevação do lote.",
  },
  {
    name: "OpenTopoMap",
    url: "https://opentopomap.org/",
    use: "Camada de relevo + curvas de nível usada na visualização do mapa (toggle 'Relevo').",
  },
  {
    name: "Esri World Hillshade",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer",
    use: "Relevo sombreado para realçar inclinação do terreno.",
  },
  {
    name: "Nominatim (OSM)",
    url: "https://nominatim.openstreetmap.org",
    use: "Geocoding gratuito de endereços.",
  },
];

const COSTS: Source[] = [
  {
    name: "SINAPI — Caixa/IBGE",
    url: "https://www.caixa.gov.br/poder-publico/modernizacao-gestao/sinapi",
    use: "Composições, insumos e mão-de-obra por estado.",
  },
  {
    name: "CUB Sinduscon-SP",
    url: "https://sindusconsp.com.br/servicos/cub/",
    use: "Validação macro do custo por m² conforme padrão construtivo.",
  },
];

const URBAN: Source[] = [
  {
    name: "GeoSampa",
    url: "https://geosampa.prefeitura.sp.gov.br/",
    use: "Zoneamento, lote, cadastro e restrições urbanísticas (SP).",
  },
  {
    name: "Catálogo ABNT",
    url: "https://www.abntcatalogo.com.br/",
    use: "Consulta oficial às normas técnicas brasileiras.",
  },
];

const NORMS: { code: string; use: string }[] = [
  { code: "NBR 16970", use: "Light Steel Framing" },
  { code: "NBR 15575", use: "Desempenho de edificações" },
  { code: "NBR 6120", use: "Cargas para cálculo estrutural" },
  { code: "NBR 6123", use: "Ações do vento" },
  { code: "NBR 8800", use: "Estruturas de aço" },
  { code: "NBR 14762", use: "Perfis formados a frio" },
  { code: "NBR 5410", use: "Instalações elétricas BT" },
  { code: "NBR 5626", use: "Instalações hidráulicas" },
  { code: "NBR 9077", use: "Saídas de emergência" },
];

function KbCard({ title, items }: { title: string; items: Source[] }) {
  return (
    <section className="card">
      <div className="card-row">
        <div>
          <div className="card-title">{title}</div>
          <div className="card-subtitle">Fontes oficiais consultadas pelo agente</div>
        </div>
      </div>
      <div className="stack-sm">
        {items.map((s) => (
          <a
            key={s.url}
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
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ color: "var(--color-primary-500)", fontWeight: 600 }}>
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
            <h1>Fontes que alimentam o agente</h1>
            <span className="pill pill-primary">
              <span className="dot" />
              Auditável
            </span>
          </div>
          <p className="text-sm muted" style={{ maxWidth: "72ch" }}>
            Esta base lista TODAS as fontes oficiais que o Agente Pré-Projeto
            consulta para gerar estimativas, validar viabilidade e aplicar normas
            brasileiras. Cada premissa em um relatório é rastreável até uma
            destas referências.
          </p>
        </div>
      </header>

      <div className="grid-3">
        <KbCard title="Topografia & Mapa" items={TOPO} />
        <KbCard title="Custos" items={COSTS} />
        <KbCard title="Legislação urbana" items={URBAN} />
      </div>

      <section className="card">
        <div className="card-row">
          <div>
            <div className="card-title">Normas técnicas aplicáveis (ABNT)</div>
            <div className="card-subtitle">
              Referências prioritárias para galpões steel frame industriais
            </div>
          </div>
        </div>
        <table className="ds-table">
          <thead>
            <tr>
              <th style={{ width: 160 }}>Código</th>
              <th>Aplicação</th>
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
                <td>{n.use}</td>
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
            style={{ color: "var(--color-primary-500)", textDecoration: "underline" }}
          >
            abntcatalogo.com.br
          </a>
        </p>
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
          é registrada na seção <b>premissas</b> do relatório. Cada custo
          remete a uma faixa SINAPI/CUB, cada norma citada pode ser conferida
          no Catálogo ABNT, e cada camada topográfica indica sua fonte
          (OpenTopography, OpenTopoMap ou Esri).
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
