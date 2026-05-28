# Plano — Geração 3D paramétrica a partir da planta baixa (Steel-Frame)

> **Status:** proposta de arquitetura · **Data:** 28/05/2026
> **Escopo:** transformar a planta baixa do lote (com perímetro, muros, portões, vagas, vias e N galpões steel-frame) em um modelo 3D determinístico, vinculado bidirecionalmente à planta. Sem dados mockados, sem números mágicos, com validação contra os limites reais do terreno.

---

## 1. Princípio orientador

**A planta baixa 2D é a fonte da verdade.** O 3D é uma projeção determinística dela, gerada por uma pipeline pura. Editar a planta → re-gerar o 3D. Mesma entrada → mesma cena. Não há divergência possível entre 2D e 3D porque o 3D nunca é editado diretamente.

Todas as regras dimensionais (mín/máx, recuos, raios de giro, vão estrutural) vivem em **um único arquivo de constantes** e são aplicadas tanto na UI (sliders limitados) quanto no validador (bloqueia o salvamento).

---

## 2. Modelo canônico

Hoje existe [shedSchema.ts](apps/web/src/lib/shedSchema.ts) com `IndustrialShedSchema` (lote, footprint, estrutura, telhado, docas, perímetro etc.). Ele descreve **um** galpão. Falta o **SitePlan**: a planta do lote inteiro, com N galpões, muros, portões, vagas e arruamento interno.

### 2.1 Novo schema `SitePlan` (`apps/web/src/lib/sitePlanSchema.ts`)

```ts
SitePlan {
  schemaVersion: "site-1"
  terrainId: string
  lotPolygon: [lng,lat][]              // herdado do Terrain
  lotPolygonLocal: {x,z}[]             // metros, projeção ENU local
  northAngleRad: number                // rotação norte → +Z
  streetEdges: number[]                // índices das arestas voltadas à rua
  setbacks: { front, sides, back }
  perimeter: {
    segments: PerimeterSegment[]       // por aresta: muro/alambrado/portão
  }
  gates: Gate[]                        // posição ao longo de aresta de rua
  buildings: BuildingPlacement[]       // N galpões (cada um → IndustrialShed)
  parking: ParkingArea[]               // polígonos + nº vagas (carros/caminhões)
  circulation: Lane[]                  // eixos de via interna (centerline + largura)
  greenAreas: Polygon[]
  validations: ValidationReport        // resultado da última checagem
}

BuildingPlacement {
  id, name, shedId               // FK p/ IndustrialShed
  footprintPolygon: {x,z}[]      // no espaço local do lote
  rotationRad: number
  z0: number                     // cota do piso (do relevo)
}
```

### 2.2 Persistência (Prisma)

Adicionar em [schema.prisma](packages/db/prisma/schema.prisma):

```prisma
model SitePlan {
  id         String   @id @default(cuid())
  terrainId  String   @unique
  terrain    Terrain  @relation(fields: [terrainId], references: [id], onDelete: Cascade)
  version    Int      @default(1)
  data       Json     // SitePlan completo
  validations Json    // último ValidationReport
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

`Building.sitePlanId` opcional para amarrar cada galpão à versão da planta que o originou.

---

## 3. Detecção determinística de rua, perímetro e portão

Algoritmo (sem heurística vaga, sem mock):

1. **Projeção local** do polígono do lote em metros (ENU) — já existe parcialmente em [plantaShapes.ts](apps/web/src/lib/plantaShapes.ts) (`toLocalMeters`).
2. **Arestas de rua (`streetEdges`)**: para cada aresta do lote, buscar a polilinha de via mais próxima via Overpass/OSM. Aresta com distância média ≤ 5 m **e** paralelismo > cos(20°) é classificada `street`.
3. **Override manual**: o usuário pode marcar/desmarcar arestas de rua no passo 2 do wizard (clique no SVG). O override sempre prevalece.
4. **Perímetro segmentado**: para cada aresta, atribuir `PerimeterSegment { type: muro|alambrado|concertina, height, gate? }`. Default: arestas internas → muro 2.2 m; arestas de rua → muro 2.2 m com 1 portão.
5. **Portão**: posicionado na aresta de rua mais longa, centralizado por padrão; largura mín. 4 m (pedestre+leve) ou 6 m (caminhão), derivada de `shed.docks.length > 0`. Múltiplas arestas de rua → 1 portão por aresta principal.

Tudo em `apps/web/src/lib/siteGeometry.ts` (funções puras): `detectStreetEdges`, `buildPerimeterSegments`, `placeGates`.

---

## 4. Restrições e limites (single source of truth)

Arquivo `apps/web/src/lib/siteConstraints.ts`:

| Restrição | Valor padrão | Origem |
|---|---|---|
| Recuo frontal | `zoneamento.front || 5 m` | Lei de uso e ocupação |
| Recuo lateral | ≥ 1.5 m | NBR 14432 acesso bombeiros |
| Recuo fundo | ≥ 3 m | idem |
| Faixa de circulação carro | ≥ 6 m | — |
| Faixa de circulação caminhão | ≥ 12 m | raio giro 13 m |
| Vaga carro | 2.5 × 5 m + 6 m corredor | — |
| Vaga caminhão | 3.5 × 16 m + 25 m raio | `YardSchema.truckCircle_m` |
| Galpão width/depth | ≥ 6 m | `FootprintSchema` |
| TO / CA | `Terrain.to` / `Terrain.ca` | zoneamento |
| Pé-direito útil | 4–20 m | `StructureSchema` |
| Distância entre galpões | ≥ 6 m | NBR 14432 |
| Vão livre máx. (steel_frame_light) | 12 m | `StructureSchema.system` |
| Vão livre máx. (porticos_aco) | 40 m | idem |
| Vão livre máx. (trelicado) | 80 m | idem |

A função `validateSitePlan(site): ValidationReport` retorna `{ ok, errors[], warnings[] }` com `{ code, message, where:{x,z} }`. **Salvar e gerar 3D ficam bloqueados se `errors.length > 0`.**

### 4.1 Códigos de erro/warning

| Código | Significado |
|---|---|
| E001 | galpão fora do polígono do lote (após setbacks) |
| E002 | distância mínima entre galpões violada |
| E003 | TO/CA excedidos |
| E004 | portão fora de aresta `street` |
| E005 | raio de giro de caminhão inviável no pátio |
| E006 | `freeSpan` > limite do `Structure.system` escolhido |
| W101 | nº de vagas abaixo do mínimo legal (configurável por cidade) |
| W102 | pé-direito incompatível com porta seccional declarada |

---

## 5. Posicionamento e dimensionamento dos galpões

`apps/web/src/lib/siteLayout.ts` — função `fitBuildings(site, briefing): BuildingPlacement[]`.

1. Calcular **polígono inscrito** = lote ⊖ setbacks ⊖ faixa de circulação reservada (Minkowski erosion via `polygon-clipping` / `clipper-lib`).
2. Para cada galpão pedido no briefing (`n`, `targetArea`, `preferredRatio`), resolver dimensões respeitando os mín/máx do schema:
   - `width ∈ [structure.freeSpan_min, structure.freeSpan_max]`
   - `depth = baySpacing × bayCount`, com `baySpacing ∈ [4, 12] m`
   - `area = width × depth` próxima do alvo
3. Layout em grade: 1 galpão → centralizado; 2 → lado a lado com gap 6 m; ≥3 → linhas/colunas com `truckCircle_m` entre filas.
4. Verificar interseção com polígono inscrito (polygon-in-polygon). **Rejeitar** qualquer placement que vaze.

Sem fallback aproximado: se não couber, retorna erro estruturado pedindo reduzir nº de galpões ou área.

---

## 6. Pipeline planta → 3D (determinística)

`apps/web/src/lib/sitePlanTo3D.ts` — **pura, sem IO, sem `Math.random`**. Entrada: `SitePlan` validado. Saída: `THREE.Group` (ou descrição declarativa consumida pelo viewer).

Camadas, na ordem:

1. **Terreno** — malha do lote extrudada com perfil de elevação real (`Terrain.elevationProfile`), triangulada por Delaunay constrita.
2. **Pavimentação** — piso interno (recuos + vias + pátios) como mesh plano com material asfalto/intertravado conforme `YardSchema`.
3. **Perímetro** — para cada `PerimeterSegment`, extrudar muro/alambrado com altura real; abrir vão nos `gates`.
4. **Portões** — malha paramétrica (folha + pilares), com pivot para animação Y.
5. **Vagas e demarcação** — stripes do estacionamento por instancing.
6. **Galpões** — para cada `BuildingPlacement`, chamar `buildShedMesh(shed)` (refator do atual [SteelFrameViewer.tsx](apps/web/src/components/SteelFrameViewer.tsx) em builder puro).
7. **Estrutura steel-frame visível** — pórticos (colunas + tesouras/treliças) gerados a partir de `Structure.bayCount × baySpacing`, com perfis reais (`columnProfile` → seção W/I extrudada). Terças e contraventamentos como tubos finos.
   - LOD “estrutural”: só esqueleto.
   - LOD “arquitetônico”: envelope (telhas, alvenaria base) aplicado.
8. **Aberturas** — para cada `Opening`, recortar painel de envelope na parede correspondente e inserir portão/porta/janela.

Cada item é uma função pura `build*(spec): THREE.Group`.

---

## 7. Wizard (planta-baixa primeiro, 3D no fim)

Refatorar [BuildWizard.tsx](apps/web/src/components/BuildWizard.tsx) em 6 passos. A planta editável aparece desde o passo 1.

| Passo | Conteúdo | Saída no `SitePlan` |
|---|---|---|
| 1. Programa | nº de galpões, uso, faixa de orçamento, padrão | `buildings[].targetArea/use` |
| 2. Terreno e rua | confirma arestas de rua e setbacks sobre OSM | `streetEdges`, `setbacks` |
| 3. Perímetro e acessos | desenha muros por aresta, posiciona portões (drag sobre aresta de rua) | `perimeter`, `gates` |
| 4. Galpões | dimensões com sliders limitados pelos mín/máx do schema **e** pelo polígono inscrito; pé-direito; telhado; docas; mezanino; pontes rolantes. Layout sugerido por `fitBuildings`, editável (drag/rotate) | `buildings[]` |
| 5. Circulação e vagas | vagas calculadas (ex. 1 vaga / 75 m² coberto); vias com raio 13 m garantido | `parking`, `circulation` |
| 6. Revisão | `ValidationReport` consolidado + botão **Gerar 3D** | persiste `SitePlan` e abre viewer |

Cada passo escreve no mesmo objeto `SitePlan` (controlled state). Sem payloads opacos.

---

## 8. Vínculo planta ⇄ 3D (re-geração automática)

- Página `/terrenos/[id]/construir`: dois painéis lado a lado — **editor 2D** (SVG sobre `LotProjection`) à esquerda, **viewer 3D** à direita.
- Edição na planta → debounce 300 ms → `validateSitePlan` → se ok, `sitePlanTo3D` re-monta a cena (diff por id de mesh para preservar câmera). Preview local, sem round-trip.
- **Salvar** → `POST /api/terrenos/[id]/site-plan` → grava nova versão, retorna `version`.
- Editar a planta depois → carrega `SitePlan vN`, edita, salva → `vN+1`. Histórico permite rollback.

---

## 9. Arquivos a criar / modificar

**Criar:**

- `apps/web/src/lib/sitePlanSchema.ts` — Zod do `SitePlan`.
- `apps/web/src/lib/siteConstraints.ts` — constantes numéricas + validador.
- `apps/web/src/lib/siteGeometry.ts` — detecção de rua, setbacks, offset de polígono.
- `apps/web/src/lib/siteLayout.ts` — `fitBuildings`.
- `apps/web/src/lib/sitePlanTo3D.ts` — builder Three.js puro.
- `apps/web/src/components/SitePlanEditor.tsx` — editor 2D (SVG + interações).
- `apps/web/src/components/SitePlanViewer3D.client.tsx` — wrapper do builder.
- `apps/web/src/app/api/terrenos/[id]/site-plan/route.ts` — GET/POST/PUT.

**Modificar:**

- [BuildWizard.tsx](apps/web/src/components/BuildWizard.tsx) — passos novos, gravar `SitePlan`.
- [SteelFrameViewer.tsx](apps/web/src/components/SteelFrameViewer.tsx) — extrair `buildShedMesh(shed)` puro, reaproveitado pelo novo viewer.
- [schema.prisma](packages/db/prisma/schema.prisma) — adicionar `model SitePlan`.

**Dependências novas:**

- `polygon-clipping` (ou `martinez-polygon-clipping`) — booleanas e offset.
- `d3-delaunay` — triangulação do terreno.

---

## 10. Testes (não-negociável)

Em `apps/web/src/lib/__tests__/`:

- `siteGeometry.test.ts` — lotes em L, U, retangulares com rua em 1/2 lados, validar `streetEdges`.
- `siteLayout.test.ts` — encaixar 1/2/4 galpões em lotes diversos, garantir 0 violações.
- `siteConstraints.test.ts` — cada código E001–E006 disparando.
- `sitePlanTo3D.test.ts` — render headless (`@react-three/test-renderer`), contar meshes esperados por fixture.

---

## 11. Sequência de implementação

1. Prisma model `SitePlan` + migração.
2. `sitePlanSchema.ts` + `siteConstraints.ts` + testes.
3. `siteGeometry.ts` (rua, setbacks, offset) + testes.
4. `siteLayout.ts` (`fitBuildings`) + testes.
5. Refator do builder de galpão para função pura.
6. `sitePlanTo3D.ts` (terreno → perímetro → galpões) + teste smoke.
7. API routes `/api/terrenos/[id]/site-plan`.
8. Novo `BuildWizard` (6 passos) gravando `SitePlan`.
9. `SitePlanEditor.tsx` + binding ao viewer 3D (debounce + diff).
10. Página `/terrenos/[id]/construir` com layout 2D ⇄ 3D.

---

## 12. Critérios de aceite

- [ ] Nenhum galpão ultrapassa o polígono do lote (após setbacks) em qualquer cenário de teste.
- [ ] Sliders do wizard nunca permitem valores fora dos limites do `siteConstraints`.
- [ ] `validateSitePlan` cobre todos os códigos E001–E006 com teste.
- [ ] Editar a planta e salvar → 3D persistido é exatamente o que o editor mostrava (snapshot determinístico).
- [ ] Estrutura steel-frame visível no 3D usa `bayCount`, `baySpacing`, `columnProfile` reais — não decorativa.
- [ ] Portões existem somente em arestas classificadas `street`.
- [ ] Raio de giro de caminhão respeitado no pátio (validação geométrica, não visual).
