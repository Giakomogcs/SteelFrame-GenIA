# PRD — Briefing → SitePlan 2D → 3D paramétrico → Relatórios

**Produto:** SteelFrame GenIA
**Módulos:** Briefing (Pré-Projeto), SitePlan Editor, Viewer 3D paramétrico, Relevo, Relatórios
**Status:** Draft v2 (consolida PRD v1 + [PLAN-SitePlan-2D-to-3D](docs/PLAN-SitePlan-2D-to-3D.md))
**Owner:** Time SteelFrame GenIA
**Data:** 2026-05-28

---

## 0. Princípio orientador (single source of truth)

> **A planta baixa 2D (`SitePlan`) é a fonte da verdade. O 3D é uma projeção determinística dela.**

- Editar a planta ⇒ re-gerar o 3D. Mesma entrada ⇒ mesma cena.
- Não existe edição direta no 3D — o viewer é read-only de geometria.
- Todas as regras dimensionais vivem em **um único** arquivo de constantes (`siteConstraints.ts`) e são aplicadas tanto na UI (sliders limitados) quanto no validador (bloqueia salvar/gerar).
- **Zero mock, zero números mágicos, zero `Math.random`** na pipeline de geração.

---

## 1. Contexto

Fluxo atual em [apps/web/src/app/terrenos/[id]/briefing/BriefingClient.tsx](apps/web/src/app/terrenos/[id]/briefing/BriefingClient.tsx):

- Wizard com chips/tags e steps no footer (visualmente amador).
- `ShedViewer` montado desde o início → galpão mockado antes do briefing terminar.
- Galpão desconectado da planta e do polígono do lote (vaza, encavala).
- Relevo dentro do mapa, com baixa fidelidade.
- Relatórios em [apps/web/src/app/relatorios/page.tsx](apps/web/src/app/relatorios/page.tsx) não consomem o 3D do briefing e não agrupam por estudo.
- Schema atual ([packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma)) tem `Building.briefingId @unique`, impedindo múltiplos estudos por terreno.

Este PRD unifica o redesenho de UX (wizard horizontal, tela de Estudo, painel de Relevo, Relatórios v2) com a **nova arquitetura de geração paramétrica baseada em `SitePlan`**.

---

## 2. Problemas (verbatim do usuário)

| #   | Problema                                                                                                                                                                                                                   | Severidade |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| P1  | Ao iniciar um briefing **já mostra um galpão por padrão** — deve ser gerado **apenas no último passo do wizard**.                                                                                                          | Bloqueador |
| P2  | Wizard "amador": chips/tags + steps no footer. Deveria ser **stepper horizontal** com inputs ricos (botões, scroll, selects).                                                                                              | Alto       |
| P3  | Volume 3D deveria aparecer **apenas após gerar 3D ao finalizar o wizard**, com **aceite**, **chat de refinamento** e **edição via planta baixa** (arrastar galpão, estacionamentos etc.). Hoje está sobreposto/encavalado. | Bloqueador |
| P4  | Relevo está visualmente pobre e fica dentro do mapa — deve ser **separado, abaixo do mapa**.                                                                                                                               | Médio      |
| P5  | Relatórios não exibem o **3D do briefing**, dashboards não são profissionais e **não separam por estudo**.                                                                                                                 | Alto       |
| P6  | Um terreno deve poder ter **vários relatórios, um por briefing**.                                                                                                                                                          | Alto       |
| P7  | Galpão está **mockado** — precisa ser **derivado da planta**, sempre respeitando a **demarcação do terreno**.                                                                                                              | Bloqueador |

---

## 3. Objetivos & Não-objetivos

### Objetivos

- O1. Briefing nunca renderiza 3D antes do passo final.
- O2. Wizard horizontal de 6 steps com inputs estruturados e validação por step.
- O3. Pipeline determinístico **Briefing → SitePlan 2D → 3D paramétrico → Aceite → Report**.
- O4. `SitePlan` cobre **N galpões + perímetro + portões + vagas + circulação + áreas verdes**, ancorado ao polígono real do terreno.
- O5. Editor 2D ⇔ Viewer 3D lado a lado, com regeneração debounced (300 ms) e câmera preservada por diff de mesh.
- O6. Validação determinística (E001–E006, W101–W102) bloqueia salvar/gerar.
- O7. Estrutura steel-frame visível usa `bayCount`, `baySpacing`, `columnProfile` reais — não decorativa.
- O8. Painel de Relevo dedicado, abaixo do mapa.
- O9. Relatórios indexados por `briefingId`, embarcando snapshot 3D + dashboards profissionais.
- O10. 1 Terrain → N Briefings → 1 SitePlan/Briefing → 1 Report/Briefing (versionável).

### Não-objetivos (v1)

- Editor CAD livre com vértices arbitrários (apenas drag/rotate/scale de zonas pré-definidas).
- Simulação estrutural real (mantém estimativas L1–L6).
- Multiusuário simultâneo no mesmo SitePlan.
- LOD arquitetônico completo (envelope) — v1 entrega esqueleto estrutural + envelope simplificado.

---

## 4. Personas e jornada-alvo

**Persona:** Incorporador/arquiteto avaliando viabilidade industrial.

1. Cadastra terreno → vê **mapa** + **painel de Relevo separado abaixo**.
2. Abre **Novo Briefing** → wizard horizontal de 6 steps (sem 3D).
3. A partir do step 2, vê o **`SitePlanEditor` 2D** (SVG) à direita, atualizado a cada passo.
4. Step 6 (Revisão) → `ValidationReport` consolidado → CTA **"Gerar estudo 3D"**.
5. Tela **Estudo**: 2D editor ⇔ 3D viewer lado a lado + chat de refinamento + premissas.
6. Edita planta (drag/snap) → 3D regenera em ≤ 300 ms (debounce).
7. **Aceitar estudo** → cria `Report` vinculado ao Briefing, materializa `SitePlan vN`.
8. **Relatórios**: lista por Terreno → Briefing → Reports[].

---

## 5. Modelo canônico — `SitePlan`

Novo arquivo: `apps/web/src/lib/sitePlanSchema.ts` (Zod).

```ts
SitePlan {
  schemaVersion: "site-1"
  terrainId: string
  lotPolygon: [lng,lat][]              // herdado do Terrain
  lotPolygonLocal: {x,z}[]             // metros, projeção ENU local
  northAngleRad: number                // rotação norte → +Z
  streetEdges: number[]                // índices das arestas voltadas à rua
  setbacks: { front, sides, back }     // metros
  perimeter: {
    segments: PerimeterSegment[]       // por aresta: muro/alambrado/portão, height
  }
  gates: Gate[]                        // posição ao longo de aresta de rua, width
  buildings: BuildingPlacement[]       // N galpões (cada um → IndustrialShed)
  parking: ParkingArea[]               // polígonos + nº vagas (carros/caminhões)
  circulation: Lane[]                  // eixos de via interna (centerline + largura)
  greenAreas: Polygon[]
  validations: ValidationReport
}

BuildingPlacement {
  id, name, shedId               // FK p/ IndustrialShed
  footprintPolygon: {x,z}[]      // espaço local do lote
  rotationRad: number
  z0: number                     // cota do piso (do relevo)
}
```

`IndustrialShed` existente em [shedSchema.ts](apps/web/src/lib/shedSchema.ts) descreve **um** galpão; o `SitePlan` o agrega N vezes via `BuildingPlacement`.

---

## 6. Restrições — `siteConstraints.ts` (single source of truth)

| Restrição                          | Valor padrão                | Origem                     |
| ---------------------------------- | --------------------------- | -------------------------- | ---- | ---------------- |
| Recuo frontal                      | `zoneamento.front           |                            | 5 m` | Lei uso/ocupação |
| Recuo lateral                      | ≥ 1.5 m                     | NBR 14432 (bombeiros)      |
| Recuo fundo                        | ≥ 3 m                       | NBR 14432                  |
| Faixa circulação carro             | ≥ 6 m                       | —                          |
| Faixa circulação caminhão          | ≥ 12 m                      | raio giro 13 m             |
| Vaga carro                         | 2.5 × 5 m + 6 m corredor    | —                          |
| Vaga caminhão                      | 3.5 × 16 m + 25 m raio      | `YardSchema.truckCircle_m` |
| Galpão width/depth                 | ≥ 6 m                       | `FootprintSchema`          |
| TO / CA                            | `Terrain.to` / `Terrain.ca` | zoneamento                 |
| Pé-direito útil                    | 4–20 m                      | `StructureSchema`          |
| Distância entre galpões            | ≥ 6 m                       | NBR 14432                  |
| Vão livre máx. `steel_frame_light` | 12 m                        | `StructureSchema.system`   |
| Vão livre máx. `porticos_aco`      | 40 m                        | idem                       |
| Vão livre máx. `trelicado`         | 80 m                        | idem                       |

**`validateSitePlan(site): ValidationReport`** retorna `{ ok, errors[], warnings[] }` com `{ code, message, where:{x,z} }`. Salvar e gerar 3D ficam bloqueados se `errors.length > 0`.

### Códigos

| Código | Significado                                        |
| ------ | -------------------------------------------------- |
| E001   | Galpão fora do polígono do lote (após setbacks).   |
| E002   | Distância mínima entre galpões violada.            |
| E003   | TO/CA excedidos.                                   |
| E004   | Portão fora de aresta `street`.                    |
| E005   | Raio de giro de caminhão inviável.                 |
| E006   | `freeSpan` > limite do `Structure.system`.         |
| W101   | Nº de vagas abaixo do mínimo legal (configurável). |
| W102   | Pé-direito incompatível com porta seccional.       |

---

## 7. Detecção determinística de rua, perímetro e portão

Arquivo: `apps/web/src/lib/siteGeometry.ts` (funções puras).

1. **Projeção local** do polígono em metros (ENU) — reaproveitar `toLocalMeters` de [plantaShapes.ts](apps/web/src/lib/plantaShapes.ts).
2. **`detectStreetEdges`**: para cada aresta, consultar polilinhas de via via Overpass/OSM. Aresta com distância média ≤ 5 m **e** paralelismo > cos(20°) ⇒ `street`.
3. **Override manual**: usuário marca/desmarca arestas no step 2 do wizard (clique no SVG). Override sempre prevalece.
4. **`buildPerimeterSegments`**: default → arestas internas: muro 2.2 m; arestas de rua: muro 2.2 m com portão.
5. **`placeGates`**: aresta de rua mais longa, centralizado. Largura mín 4 m (leve) ou 6 m (caminhão), derivada de `shed.docks.length > 0`. Múltiplas arestas de rua → 1 portão por aresta principal.

---

## 8. Posicionamento de galpões — `fitBuildings`

Arquivo: `apps/web/src/lib/siteLayout.ts`. **Determinístico, sem fallback aproximado.**

1. **Polígono inscrito** = lote ⊖ setbacks ⊖ faixa de circulação (Minkowski erosion via `polygon-clipping`).
2. Para cada galpão do briefing (`n`, `targetArea`, `preferredRatio`):
   - `width ∈ [structure.freeSpan_min, structure.freeSpan_max]`
   - `depth = baySpacing × bayCount`, `baySpacing ∈ [4, 12] m`
   - `area = width × depth` próxima do alvo
3. Layout em grade: 1 → centralizado; 2 → lado a lado com gap 6 m; ≥3 → linhas/colunas com `truckCircle_m` entre filas.
4. Polygon-in-polygon: **rejeita** qualquer placement que vaze. Se não couber, retorna erro estruturado pedindo reduzir nº/área.

---

## 9. Pipeline planta → 3D paramétrico

Arquivo: `apps/web/src/lib/sitePlanTo3D.ts` — **pura, sem IO, sem `Math.random`**.
Entrada: `SitePlan` validado. Saída: `THREE.Group` (ou descrição declarativa).

**Camadas (ordem):**

1. **Terreno** — malha do lote extrudada com perfil real (`Terrain.elevationProfile`), triangulação Delaunay constrita (`d3-delaunay`).
2. **Pavimentação** — piso interno (recuos + vias + pátios), material asfalto/intertravado conforme `YardSchema`.
3. **Perímetro** — extrusão de cada `PerimeterSegment` (muro/alambrado/concertina) com altura real; vãos nos `gates`.
4. **Portões** — paramétricos (folha + pilares), pivot Y para animação.
5. **Vagas/demarcação** — stripes via instancing.
6. **Galpões** — `buildShedMesh(shed)` por placement (refactor puro do atual [SteelFrameViewer.tsx](apps/web/src/components/SteelFrameViewer.tsx)).
7. **Estrutura steel-frame visível** — pórticos (colunas + tesouras/treliças) gerados a partir de `Structure.bayCount × baySpacing`, perfis reais (`columnProfile` → seção W/I extrudada). Terças e contraventamentos como tubos finos.
   - LOD `structural` → só esqueleto.
   - LOD `architectural` → envelope (telhas, alvenaria base).
8. **Aberturas** — recortar painel de envelope na parede correspondente para cada `Opening`; inserir portão/porta/janela.

Cada item: função pura `build*(spec): THREE.Group`.

---

## 10. Requisitos funcionais

### 10.1 Wizard de 6 passos (substitui [BuildWizard.tsx](apps/web/src/components/BuildWizard.tsx))

**FR-W1. Stepper horizontal**

- Header sticky: 6 nós numerados + label + barra de progresso; estados `done` ✓ / `current` pulsando / `locked`.
- Teclado: ←/→/Enter/Tab; `aria-current="step"`; foco visível.
- Footer: apenas `Voltar` / `Próximo` / (step 6) `Gerar estudo 3D`. **Sem chips no footer.**

**FR-W2. Steps**

| Step                   | Conteúdo                                                                                                                                                                                  | Inputs                                                   | Escrita no `SitePlan`        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------- |
| 1. Programa            | nº galpões, uso (logistics/industrial/cross_dock/DC), faixa orçamento, padrão                                                                                                             | **SegmentedControl** + **NumericStepper** + **Slider**   | `buildings[].targetArea/use` |
| 2. Terreno & rua       | confirma arestas de rua e setbacks sobre OSM                                                                                                                                              | **SVG clicável** + sliders limitados                     | `streetEdges`, `setbacks`    |
| 3. Perímetro & acessos | muros por aresta + portões drag sobre aresta de rua                                                                                                                                       | **Select por aresta** + **drag handle**                  | `perimeter`, `gates`         |
| 4. Galpões             | dimensões com sliders limitados (mín/máx schema **e** polígono inscrito), pé-direito, telhado, docas, mezanino, ponte rolante; layout sugerido por `fitBuildings`, editável (drag/rotate) | **Sliders clampados** + **Multiselect chips** + **drag** | `buildings[]`                |
| 5. Circulação & vagas  | vagas calculadas (ex.: 1/75 m² coberto); vias com raio 13 m garantido                                                                                                                     | **NumericStepper** + **toggle**                          | `parking`, `circulation`     |
| 6. Revisão             | `ValidationReport` consolidado + lista de premissas                                                                                                                                       | **read-only** + CTA `Gerar estudo 3D`                    | persiste `SitePlan`          |

**FR-W3. Estado zero do preview**

- Steps 1–5: coluna direita exibe **`SitePlanEditor` 2D** (SVG), **nunca** o `ShedViewer 3D`.
- `ShedViewer` só é **montado** após o submit do step 6.

**FR-W4. Persistência incremental**

- Cada mudança válida ⇒ `PATCH /api/briefings/:id` salva `assumptions`, `progress` e snapshot parcial do `SitePlan`. Sem materializar `Building` 3D.

### 10.2 Geração & Tela de Estudo

**FR-G1. Gatilho único**

- `Gerar estudo 3D` só existe no step 6 e dispara **uma única vez por briefing**: `POST /api/ai/generate` (SSE) exige `briefingId` + `step === 6`; recusa antecipações com 422.

**FR-G2. Pipeline determinística**

1. `validateSitePlan` → se errors, **bloqueia** geração.
2. `fitBuildings` finaliza placements.
3. `sitePlanTo3D` extruda a cena.
4. Clamp ao polígono validado por teste geométrico (CI).

**FR-G3. Tela de Estudo (`/terrenos/[id]/estudo/[briefingId]`)**

- Layout 2 colunas: **esquerda** chat + premissas; **direita** tabs:
  - `SitePlan 2D` — `SitePlanEditor` (SVG drag/rotate/scale; snap 0.5 m + eixos do lote + frente).
  - `Volume 3D` — `SitePlanViewer3D` consumindo o mesmo `SitePlan`. Re-gen **debounce 300 ms** ao editar; **câmera preservada** por diff de mesh id.
  - `Premissas` — lista editável.
  - `Chat` — refinamento textual; cada mensagem pode propor patch (RFC 6902 simplificado) sobre `SitePlan`, com botão `Aplicar`.
- Banner: `Pré-visualização — não publicado` + CTA `Aceitar estudo`.

**FR-G4. Aceite**

- `Aceitar estudo` → `POST /api/briefings/:id/accept` → grava `SitePlan vN` (Prisma), `Building.status = viable`, cria `Report` (FR-R3), navega para `/relatorios/:reportId`.

### 10.3 Mapa + Relevo

**FR-M1.** Painel "Mapa & relevo" dividido verticalmente:

1. **Mapa do terreno** ([TerrainMap.client.tsx](apps/web/src/components/TerrainMap.client.tsx)) — **sem overlays de relevo**.
2. **`ReliefPanel`** — card dedicado abaixo, com:
   - badges `Slope médio`, `Δh`, `Cortes/Aterros`;
   - **gráfico de seção AA'** (área preenchida) com eixos legendados;
   - **mini-mapa de curvas de nível** (heatmap suave);
   - CTA `Recalcular` (aciona [slopeService.ts](apps/web/src/lib/slopeService.ts)).

- Tokens: `--color-surface-elevated`, `--radius-md`, `--shadow-sm`.

### 10.4 Relatórios

**FR-R1. Listagem** `/relatorios`: agrupada por **Terreno → Briefing → Reports[]**. Card mostra: code/version, thumb do 3D, verdict, KPIs (área construída, custo L1–L6, prazo).

**FR-R2. Detalhe** `/relatorios/:id` — tabs:

- `Resumo` — dashboard 12-col com KPIs grandes + comparativo vs terreno.
- `Volume 3D` — embed `SitePlanViewer3D` read-only.
- `SitePlan 2D` — SVG read-only.
- `Custos` — tabela L1–L6 + stacked bar.
- `Premissas & fontes` — do briefing.

**FR-R3. 1:1 com Briefing.** Cada aceite gera 1 `Report` versionável; reprocessar incrementa `version` e marca anterior como `superseded`.

**FR-R4. Navegação.** Em `/terrenos/:id`, seção `Estudos` lista briefings; cada linha aponta para o report mais recente.

---

## 11. Modelo de dados (Prisma)

Arquivo: [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma).

```prisma
model SitePlan {
  id          String   @id @default(cuid())
  terrainId   String
  terrain     Terrain  @relation(fields: [terrainId], references: [id], onDelete: Cascade)
  briefingId  String?
  briefing    Briefing? @relation(fields: [briefingId], references: [id], onDelete: SetNull)
  version     Int      @default(1)
  data        Json     // SitePlan completo (schemaVersion="site-1")
  validations Json     // último ValidationReport
  hash        String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([terrainId])
  @@index([briefingId])
  @@index([hash])
}

model Briefing {
  // ...campos atuais...
  acceptedAt  DateTime?
  sitePlans   SitePlan[]
  building    Building?
  report      Report?
}

model Building {
  // REMOVER @unique de briefingId — vira FK indexada.
  briefingId   String?
  briefing     Briefing? @relation(fields: [briefingId], references: [id], onDelete: SetNull)
  sitePlanId   String?
  sitePlanHash String?

  @@index([briefingId])
  @@index([sitePlanId])
}

model Report {
  // ...campos atuais...
  briefingId  String?
  briefing    Briefing? @relation(fields: [briefingId], references: [id], onDelete: SetNull)

  @@index([briefingId])
}
```

Migration: `add_siteplan_and_report_briefing_link`.

---

## 12. API

| Método         | Rota                           | Mudança                                                                                                  |
| -------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `POST`         | `/api/briefings`               | Cria briefing **sem** building, **sem** SitePlan.                                                        |
| `PATCH`        | `/api/briefings/:id`           | Persiste `progress`, `assumptions`, snapshot parcial de `SitePlan`.                                      |
| `GET/POST/PUT` | `/api/terrenos/[id]/site-plan` | **Novo.** CRUD do `SitePlan` versionado; retorna `version`.                                              |
| `POST`         | `/api/ai/generate`             | Exige `briefingId` + `step === 6`; recusa antecipações (422). Retorna `SitePlan` + `shedModel` derivado. |
| `POST`         | `/api/briefings/:id/refine`    | **Novo.** Chat: recebe `message`, devolve `patch` sobre `SitePlan`.                                      |
| `POST`         | `/api/briefings/:id/accept`    | **Novo.** Materializa `Report` + `Building.status=viable`.                                               |
| `GET`          | `/api/terrenos/:id/reports`    | **Novo.** Lista reports agrupados por briefing.                                                          |

---

## 13. UI / Componentes (mapa de mudanças)

**Criar:**

- `lib/sitePlanSchema.ts` — Zod do `SitePlan`.
- `lib/siteConstraints.ts` — constantes + `validateSitePlan`.
- `lib/siteGeometry.ts` — `detectStreetEdges`, `buildPerimeterSegments`, `placeGates`.
- `lib/siteLayout.ts` — `fitBuildings`.
- `lib/sitePlanTo3D.ts` — builder Three.js puro.
- `components/SitePlanEditor.tsx` — editor 2D (SVG + drag/rotate/scale com snap).
- `components/SitePlanViewer3D.client.tsx` — wrapper do builder (diff por mesh id).
- `components/BriefingStepper.tsx` — stepper horizontal acessível.
- `components/StudyShell.tsx` — layout 2D⇔3D + chat + aceite.
- `components/RefineChat.tsx` — chat com apply/discard de patch.
- `components/ReliefPanel.tsx` — card de relevo (FR-M1).
- `app/api/terrenos/[id]/site-plan/route.ts`.
- `app/api/briefings/[id]/refine/route.ts`.
- `app/api/briefings/[id]/accept/route.ts`.
- `app/relatorios/[id]/page.tsx`.

**Modificar:**

- [components/BuildWizard.tsx](apps/web/src/components/BuildWizard.tsx) — substituir por `BriefingStepper` + 6 steps; gravar `SitePlan`.
- [components/SteelFrameViewer.tsx](apps/web/src/components/SteelFrameViewer.tsx) — extrair `buildShedMesh(shed)` puro, reaproveitado por `sitePlanTo3D`.
- [components/ShedViewer.client.tsx](apps/web/src/components/ShedViewer.client.tsx) — aceitar `SitePlan` como única fonte; remover defaults mockados.
- [app/terrenos/[id]/briefing/BriefingClient.tsx](apps/web/src/app/terrenos/[id]/briefing/BriefingClient.tsx) — remover montagem precoce do `ShedViewer`; coluna direita usa `SitePlanEditor`.
- [app/relatorios/page.tsx](apps/web/src/app/relatorios/page.tsx) — agrupamento Terreno→Briefing→Reports.
- [lib/shedPromptToProject.ts](apps/web/src/lib/shedPromptToProject.ts) — emitir `SitePlan` canônico, não `IndustrialShed` direto.

**Dependências novas:**

- `polygon-clipping` (booleanas + Minkowski offset).
- `d3-delaunay` (triangulação do terreno).
- (opcional) `@react-three/test-renderer` para testes headless.

---

## 14. Estados e máquinas

- **Briefing:** `draft → active → ready_to_generate → generating → preview → refining → accepted` (paused permitido em `active|preview|refining`).
- **SitePlan:** versão imutável; nova edição cria `vN+1`.
- **Building.status:** `preview → viable` (aceite) ou `superseded`.
- **Report.status:** `draft → issued → superseded`.

---

## 15. Requisitos não funcionais

- **Performance:** geração 3D ≤ 4 s p95 (lote ≤ 50k m²). Re-gen debounce 300 ms; viewer não re-mount; câmera preservada via diff de mesh id.
- **Acessibilidade:** stepper navegável por teclado, ARIA correto, foco visível.
- **i18n:** pt-BR.
- **Telemetria:** `briefing.step_completed`, `siteplan.validated`, `study.generated`, `study.accepted`, `report.viewed`.
- **Segurança:** validação Zod em todas as APIs novas.

---

## 16. Testes (não-negociável)

Local: `apps/web/src/lib/__tests__/`.

| Arquivo                             | Cobertura                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `siteGeometry.test.ts`              | Lotes L, U, retangulares com rua em 1/2 lados → `streetEdges` corretas.              |
| `siteLayout.test.ts`                | Encaixar 1/2/4 galpões em lotes diversos → 0 violações.                              |
| `siteConstraints.test.ts`           | Cada código E001–E006 e W101–W102 disparando.                                        |
| `sitePlanTo3D.test.ts`              | Render headless (`@react-three/test-renderer`); contar meshes esperados por fixture. |
| `clampToPolygon.test.ts`            | Nenhuma mesh ultrapassa o polígono em 20 fixtures.                                   |
| `briefing.e2e.spec.ts` (Playwright) | Jornada §4; assert `briefing.no_3d_before_step6`.                                    |

---

## 17. Critérios de aceitação (DoD)

- [ ] AC1 (P1): Abrir briefing **não monta `ShedViewer`** nem cria `Building`/`SitePlan` materializado até o submit do step 6.
- [ ] AC2 (P2): Stepper horizontal de 6 nós, navegável por teclado, validação por step, footer só `Voltar/Próximo/Gerar`.
- [ ] AC3 (P3): Geração 3D só via CTA do step 6. Tela de estudo com tabs `SitePlan 2D · 3D · Premissas · Chat`. Edição na planta regenera 3D em ≤ 300 ms.
- [ ] AC4 (P3/P7): Nenhuma geometria 3D ultrapassa o polígono do lote em nenhum cenário de teste (E001 + `clampToPolygon.test.ts`).
- [ ] AC5 (P4): `ReliefPanel` renderizado **abaixo** do mapa, separado, com seção AA' + métricas.
- [ ] AC6 (P5/P6): `/relatorios` agrupa Terreno → Briefing → Reports[]; detalhe mostra 3D do briefing; migration aplicada.
- [ ] AC7 (P7): `ShedViewer`/`SitePlanViewer3D` recusam render sem `SitePlan` validado; [shedDefaults.ts](apps/web/src/lib/shedDefaults.ts) só permitido em testes.
- [ ] AC8: Sliders do wizard nunca permitem valores fora de `siteConstraints`.
- [ ] AC9: `validateSitePlan` cobre todos os códigos E001–E006 com teste passando.
- [ ] AC10: Estrutura steel-frame visível usa `bayCount`, `baySpacing`, `columnProfile` reais (não decorativa).
- [ ] AC11: Portões existem **somente** em arestas `street` (validação geométrica).
- [ ] AC12: Raio de giro de caminhão respeitado no pátio (E005 validado, não visual).
- [ ] AC13: Snapshot determinístico — editar planta e salvar; 3D persistido é exatamente o que o editor mostrava.
- [ ] AC14: `tsc --noEmit` limpo; Prisma migrate aplicada; smoke E2E Playwright verde.

---

## 18. Plano de entrega (fases)

| Fase                        | Escopo                                                                                         | Branch                  |
| --------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------- |
| F1 — Schema                 | Prisma `SitePlan` + migration + relaxar `Building.briefingId @unique`; FK `Report.briefingId`. | `feat/siteplan-schema`  |
| F2 — Constantes & validação | `sitePlanSchema.ts`, `siteConstraints.ts`, `validateSitePlan` + testes.                        | `feat/site-constraints` |
| F3 — Geometria & layout     | `siteGeometry.ts` (rua/setbacks/offset), `siteLayout.ts` (`fitBuildings`) + testes.            | `feat/site-geometry`    |
| F4 — Builder 3D puro        | Refator `SteelFrameViewer` → `buildShedMesh` puro; novo `sitePlanTo3D.ts`; testes headless.    | `feat/siteplan-to-3d`   |
| F5 — APIs                   | `/site-plan` (CRUD versionado), `/refine`, `/accept`; gate `step === 6` em `/api/ai/generate`. | `feat/siteplan-api`     |
| F6 — Wizard                 | `BriefingStepper` + 6 steps gravando `SitePlan`; remover preview 3D precoce.                   | `feat/briefing-stepper` |
| F7 — Editor 2D ⇔ 3D         | `SitePlanEditor` + `SitePlanViewer3D` com debounce 300 ms e diff; `StudyShell` + `RefineChat`. | `feat/study-shell`      |
| F8 — Relevo                 | `ReliefPanel` abaixo do mapa.                                                                  | `feat/relief-panel`     |
| F9 — Relatórios             | Listagem agrupada + detalhe v2 com 3D + dashboards.                                            | `feat/reports-v2`       |
| F10 — QA & E2E              | Playwright + clamp test + telemetria.                                                          | RC                      |

---

## 19. Riscos e mitigações

| Risco                                             | Mitigação                                                                     |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| Drag/snap do editor consumir tempo > planejado    | v1: handles fixos (mover/rotacionar footprint + zonas), sem vértices livres.  |
| Re-gen 3D piscar a viewport                       | Viewer montado uma vez; trocar geometria por dispose+swap; diff por mesh id.  |
| Conflito entre patch do chat e edição manual      | Lock otimista por `SitePlan.hash`; divergência exibe diff e pede confirmação. |
| Reports legados sem `briefingId`                  | Migration mantém `NULL`; UI agrupa em "Sem briefing (legado)".                |
| OSM indisponível para `detectStreetEdges`         | Fallback: usuário marca arestas manualmente no step 2 (já previsto).          |
| `polygon-clipping` performance em lotes complexos | Pré-simplificar lote (Douglas-Peucker 0.5 m) antes de Minkowski erosion.      |

---

## 20. Open questions

1. Chat de refinamento: SSE (como `/api/ai/generate`) ou request/response simples?
2. Rotação do footprint: ângulo livre ou snap 15°?
3. Stack de charts dos Relatórios: SVG inline atual ou introduzir Recharts/Visx?
4. Aceitação de estudo é reversível (voltar para `preview`)?
5. LOD `architectural` (envelope completo) entra na v1 ou fica para v1.1?

> Responder antes do início da F1.
