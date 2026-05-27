# SteelFrame GenIA

Monorepo para cadastrar terrenos via mapa de satélite (Leaflet), gerar modelos 3D paramétricos de galpões steel frame (Three.js / react-three-fiber) e sugerir parâmetros com IA (OpenAI).

> Inspirado em fluxos do tipo *viabilidade* (ex.: arqgen.com.br/viabilidade).

## Stack

- **Monorepo**: pnpm workspaces + Turborepo
- **Frontend + API**: Next.js 14 (App Router) + TypeScript + TailwindCSS
- **Mapa**: react-leaflet + Leaflet (satélite via Esri World Imagery, geocoding via Nominatim)
- **3D**: react-three-fiber + drei + Three.js
- **DB**: PostgreSQL + Prisma
- **IA**: Azure AI Foundry / Cognitive Services (modelos `Kimi-K2.5`, `gpt-5.4-mini`) — com fallback heurístico se não houver chave
- **Infra**: Docker Compose

## Estrutura

```
.
├── apps/
│   └── web/                    # Next.js 14 (UI + API routes)
├── packages/
│   └── db/                     # Prisma client compartilhado
├── docker-compose.yml
├── pnpm-workspace.yaml
├── turbo.json
└── .env.example
```

## Funcionalidades

1. **Cadastro de terrenos** (`/terrenos/novo`)
   - Busca de endereço (Nominatim/OpenStreetMap)
   - Mapa em satélite (Esri)
   - Desenho do perímetro clicando vértice por vértice
   - Fechamento da forma → cálculo automático da área (m²)
2. **Lista de terrenos** (`/`) em cards com área e nº de construções
3. **Edição do terreno** (`/terrenos/[id]`)
   - Arrastar vértices, clique direito para remover
   - Persistência da nova geometria
4. **Wizard de construção** (`/terrenos/[id]/construir`)
   - Identificação → Material/Orçamento → Geometria → Revisão
   - Botão **✨ Sugerir com IA** pré-preenche os campos
5. **Visualização 3D** (`/terrenos/[id]/construcoes/[buildId]`)
   - Galpão paramétrico (colunas, pórticos/treliças, telhado em duas águas, paredes, portões, opcional mezanino)
   - Contorno do terreno em escala real
   - Orbit controls, estimativa de custo e peso de aço

## Como rodar

### Pré-requisitos
- Node.js 20+
- pnpm 9+
- Docker + Docker Compose

### 1. Instalar dependências

```powershell
pnpm install
```

### 2. Subir o Postgres

```powershell
Copy-Item .env.example .env
pnpm docker:up
```

### 3. Rodar migrations

```powershell
pnpm db:migrate
```

### 4. (Opcional) Configurar IA

Edite `.env` e preencha as variáveis do Azure AI:

```
AZURE_AI_ENDPOINT="https://dt-modelos-ia-resource.cognitiveservices.azure.com"
AZURE_AI_API_KEY="<sua-chave>"
AZURE_AI_MODEL="gpt-5.4-mini"   # ou "Kimi-K2.5"
AZURE_AI_API_VERSION="2024-05-01-preview"
```

> Se ficar vazio, o endpoint `/api/ai/suggest` usa uma heurística determinística baseada na área do terreno.
> A chamada é feita em `POST {endpoint}/models/chat/completions?api-version=...` com o header `api-key`, compatível com o Azure AI Inference (Foundry).

### 5. Rodar em desenvolvimento

```powershell
pnpm dev
```

Abra http://localhost:3000.

### Rodar tudo via Docker (Postgres + Web)

```powershell
docker compose --profile full up --build
```

## Comandos úteis

| Comando | Descrição |
|---|---|
| `pnpm dev` | Sobe o app web em modo dev |
| `pnpm build` | Build de produção |
| `pnpm db:studio` | Abre Prisma Studio |
| `pnpm db:migrate` | Cria/aplica nova migration |
| `pnpm docker:up` | Sobe apenas o Postgres |
| `pnpm docker:down` | Derruba os containers |

## Endpoints REST

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/terrenos` | Lista terrenos |
| POST | `/api/terrenos` | Cria terreno |
| GET | `/api/terrenos/:id` | Detalha terreno |
| PATCH | `/api/terrenos/:id` | Atualiza terreno (polígono, nome, etc.) |
| DELETE | `/api/terrenos/:id` | Remove terreno |
| GET | `/api/terrenos/:id/construcoes` | Lista construções |
| POST | `/api/terrenos/:id/construcoes` | Gera nova construção (calcula modelo) |
| POST | `/api/ai/suggest` | Sugere parâmetros do wizard |

## Próximos passos (sugestões)

- [ ] Snap dos vértices na rotação do polígono para extrair OBB (oriented bounding box) e alinhar o galpão à melhor direção do terreno
- [ ] Exportar GLTF do modelo 3D (drei `useGLTF` + GLTFExporter)
- [ ] Render fotorrealístico via React Three Fiber + path tracing (`@react-three/postprocessing`)
- [ ] Múltiplos galpões por terreno com layout automático
- [ ] Autenticação (next-auth) e multi-tenant
- [ ] CAM/BIM export (IFC) para o setor de engenharia

## Licença

Privado / proprietário.
