import Link from "next/link";

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

function Card({
  title,
  items,
}: {
  title: string;
  items: Source[];
}) {
  return (
    <section className="dt-card p-5">
      <h2 className="text-sm font-bold uppercase tracking-wide text-white/80">
        {title}
      </h2>
      <ul className="mt-3 space-y-2">
        {items.map((s) => (
          <li key={s.url} className="rounded-md bg-white/5 p-3">
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-[#ff3d6a] hover:underline"
            >
              {s.name} ↗
            </a>
            <div className="mt-0.5 text-xs text-white/60">{s.use}</div>
            <div className="mt-1 break-all font-mono text-[10px] text-white/40">
              {s.url}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function KnowledgePage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-xs text-[#ff3d6a] hover:underline">
          ← Voltar
        </Link>
        <span className="dt-status-pill mt-2 mb-2 inline-flex">
          Base do agente · SINAPI · CUB · GeoSampa · ABNT · OpenTopography
        </span>
        <h1 className="text-3xl font-extrabold uppercase tracking-tight text-white">
          Base de conhecimento
        </h1>
        <p className="text-sm text-white/60">
          Fontes oficiais consultadas pelo Agente Pré-Projeto para gerar
          estimativas, validar viabilidade e aplicar normas brasileiras.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Topografia & Mapa" items={TOPO} />
        <Card title="Custos" items={COSTS} />
        <Card title="Legislação urbana" items={URBAN} />
      </div>

      <section className="dt-card p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-white/80">
          Normas prioritárias (ABNT)
        </h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {NORMS.map((n) => (
            <div
              key={n.code}
              className="flex items-center justify-between rounded-md border border-white/10 bg-white/5 px-3 py-2"
            >
              <span className="font-mono text-xs font-bold text-[#ff3d6a]">
                {n.code}
              </span>
              <span className="text-xs text-white/70">{n.use}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-white/50">
          Consulta oficial:{" "}
          <a
            href="https://www.abntcatalogo.com.br/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#ff3d6a] hover:underline"
          >
            abntcatalogo.com.br
          </a>
        </p>
      </section>

      <p className="rounded-md border border-white/10 bg-white/5 p-3 text-[11px] text-white/60">
        ⚠️ Esta plataforma entrega estimativas preliminares. Decisões finais
        devem ser embasadas por projetos executivos, ART/RRT, sondagem,
        levantamento topográfico e aprovação legal.
      </p>
    </div>
  );
}
