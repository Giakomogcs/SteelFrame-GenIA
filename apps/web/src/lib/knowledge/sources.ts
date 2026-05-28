// Registro único das fontes oficiais que o agente consulta.
// Esta é a "fonte da verdade" usada pela página Base de Conhecimento e
// pelo bloco de evidências do relatório.

export interface KnowledgeSource {
  id: string;
  name: string;
  url: string;
  use: string;
  category: "topo" | "custo" | "urbano" | "norma" | "geo";
}

export const SOURCES: KnowledgeSource[] = [
  // Topografia / Mapa
  {
    id: "opentopography",
    category: "topo",
    name: "OpenTopography",
    url: "https://opentopography.org/home",
    use: "Modelos digitais de elevação (SRTM, ALOS), curvas de nível e perfil AA'.",
  },
  {
    id: "opentopomap",
    category: "topo",
    name: "OpenTopoMap",
    url: "https://opentopomap.org/",
    use: "Camada de relevo + curvas de nível usada no mapa interativo.",
  },
  {
    id: "esri-hillshade",
    category: "topo",
    name: "Esri World Hillshade",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer",
    use: "Relevo sombreado para realçar inclinação do terreno.",
  },
  {
    id: "open-elevation",
    category: "topo",
    name: "Open-Elevation",
    url: "https://open-elevation.com/",
    use: "API gratuita usada pela rota /slope para perfil topográfico do lote.",
  },
  {
    id: "nominatim",
    category: "geo",
    name: "Nominatim (OSM)",
    url: "https://nominatim.openstreetmap.org",
    use: "Geocoding/reverse-geocoding gratuito para endereço estruturado.",
  },
  // Custos
  {
    id: "sinapi",
    category: "custo",
    name: "SINAPI — Caixa/IBGE",
    url: "https://www.caixa.gov.br/poder-publico/modernizacao-gestao/sinapi/Paginas/default.aspx",
    use: "Composições, insumos e mão-de-obra por estado — base do custo R$/m².",
  },
  {
    id: "cub",
    category: "custo",
    name: "CUB — Sinduscon-SP",
    url: "https://sindusconsp.com.br/servicos/cub/",
    use: "Validação macro do custo por m² conforme padrão construtivo e UF.",
  },
  // Urbano / legal
  {
    id: "geosampa",
    category: "urbano",
    name: "GeoSampa",
    url: "https://geosampa.prefeitura.sp.gov.br/",
    use: "Zoneamento, lote, cadastro fiscal e restrições urbanísticas (SP).",
  },
  {
    id: "abnt",
    category: "norma",
    name: "Catálogo ABNT",
    url: "https://www.abntcatalogo.com.br/",
    use: "Consulta oficial às normas técnicas brasileiras citadas no relatório.",
  },
];

export const sourcesByCategory = (cat: KnowledgeSource["category"]) =>
  SOURCES.filter((s) => s.category === cat);
