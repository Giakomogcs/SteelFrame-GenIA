# Backlog — Briefing v2

> Gerado em 28/05/2026 com base na análise do wizard de 6 passos (`BriefingClient`),
> preview SVG (`LotPreviewSvg`), design system (`tokens.css` / `app.css`) e dashboard principal.

---

## 1. Preview 2D reativa às edições do briefing

O `candidate` (SitePlan derivado do `state`) é recalculado via `useMemo` a cada
mudança de estado. O SVG recebe `buildings`, `gates`, `streetEdges` deste
derivado. Hoje o preview reage a **alguns** campos, mas falta feedback visual
para a maioria das decisões e informações de contexto.

### 1.1 Campos que já afetam a planta (funcional)

| Campo           | Efeito no SVG                                       |
| --------------- | --------------------------------------------------- |
| `targetAreaM2`  | Footprint do galpão redimensiona                    |
| `qty`           | Número de retângulos muda                           |
| `streetEdges[]` | Aresta fica amarela (`.edge--street`)               |
| `setbacks`      | `buildBuildableRegion` muda → footprint reposiciona |
| `truckAccess`   | `laneBufferM` muda (12 m vs 6 m) → buildable shrink |

### 1.2 Campos que NÃO afetam a planta hoje (devem afetar)

| #   | Campo                       | Efeito esperado no SVG                                                                               |
| --- | --------------------------- | ---------------------------------------------------------------------------------------------------- |
| A   | `use` (tipologia)           | Cor ou hachura do footprint por uso (logística=ciano, industrial=laranja, cross-dock=verde, CD=roxo) |
| B   | `standard`                  | Opacidade ou estilo de borda do footprint (econômico=tracejado, médio=sólido, alto=sólido+glow)      |
| C   | `clearHeight`               | Label de texto no footprint ("PD 8 m")                                                               |
| D   | `perimeterHeight`           | Linha de muro com espessura proporcional ao redor do lote                                            |
| E   | `gateWidth`                 | Gate representado como abertura no muro com largura proporcional (hoje é circle fixo)                |
| F   | `carStalls` / `truckStalls` | Área de estacionamento estimada posicionada no lote                                                  |

### 1.3 Informações de contexto ausentes no SVG

| #   | Item                  | Descrição                                                                                                                  |
| --- | --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| G   | **Região buildable**  | Polígono tracejado mostrando a área útil após recuos + lane buffer. Hoje `buildBuildableRegion` calcula mas não renderiza. |
| H   | **Cotas de dimensão** | Labels com largura × profundidade de cada galpão (ex: "45 × 32 m")                                                         |
| I   | **Área construída**   | Label com a soma das áreas dos footprints (ex: "2.000 m²")                                                                 |
| J   | **Barra de escala**   | Barra horizontal com referência em metros (ex: "0 — 20 — 40 m")                                                            |
| K   | **Norte**             | Seta ou "N" indicando orientação                                                                                           |
| L   | **Labels de recuo**   | Valores dos recuos (front/sides/back) como cotas nas arestas                                                               |
| M   | **Tooltip/hover**     | Ao passar o mouse no galpão, mostrar: área, uso, dimensões                                                                 |

### 1.4 Bugs / Edge Cases

| #   | Bug                          | Descrição                                                                                                                                                     |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N   | **Overflow visual**          | Quando `targetAreaM2` é grande demais, o footprint ultrapassa o polígono do lote sem feedback visual claro (deveria ficar vermelho ou mostrar warning inline) |
| O   | **Parking placeholder**      | `parking[].polygon` é um quadrado fixo 5×5 m — deveria ser posicionado e dimensionado com base em `stallCount`                                                |
| P   | **fitBuildings grid rígido** | Com 2+ galpões, o grid `cols×rows` não otimiza orientação — galpões ficam quadrados em vez de retangulares (ratio fixo)                                       |

---

## 2. Briefing no padrão de design do projeto

O design system do projeto usa CSS vars de `tokens.css` com tema dark (`#121212`),
cor primária `#D72042`, fontes Barlow/DM Sans/JetBrains Mono, e grid 8pt.
O briefing v2 usa mistura de Tailwind colors, inline styles, e classes próprias
que divergem do padrão visual da dashboard e viewer 3D.

### 2.1 Cores

| #   | Divergência             | Atual                                                   | Esperado                                                          |
| --- | ----------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| a   | Botão ativo (segmented) | `#0ea5e9` (blue-400)                                    | `var(--color-primary)` = `#D72042` ou variante contextual         |
| b   | Fundo de inputs         | `#0b1220` (slate-950)                                   | `var(--color-surface)` = `#1d1c22`                                |
| c   | Texto secundário        | `#94a3b8` / `#cbd5e1` (Tailwind)                        | `var(--color-text-secondary)` = `#9b9b9b`                         |
| d   | Stroke de panels        | `rgba(255,255,255,0.06)`                                | `var(--color-stroke)` = `#2a2d34`                                 |
| e   | Aresta de rua (amarelo) | `#f59e0b` (amber-500) — OK como accent mas não há token | Definir `--color-accent-street` em tokens                         |
| f   | Building fill           | `rgba(34,211,238,0.18)` — ciano Tailwind                | Usar `var(--color-primary)` com alpha ou criar `--color-building` |

### 2.2 Tipografia

| #   | Divergência            | Atual                                                                            | Esperado                                                           |
| --- | ---------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| g   | Título do panel (`h3`) | `font-size:14px; letter-spacing:0.02em; text-transform:uppercase; color:#94a3b8` | `var(--font-display); var(--text-xs); var(--color-text-secondary)` |
| h   | Labels de campo        | `font-size:13px; color:#cbd5e1`                                                  | `var(--text-sm); var(--font-body); var(--color-text-secondary)`    |
| i   | Valores numéricos      | Sem mono                                                                         | `var(--font-mono)` para inputs numéricos e dimensões               |
| j   | Botões segmentados     | `font-size:12px`                                                                 | `var(--text-xs); font-weight:var(--font-medium)`                   |

### 2.3 Espaçamento

| #   | Divergência      | Atual            | Esperado                                       |
| --- | ---------------- | ---------------- | ---------------------------------------------- |
| k   | Gap do grid      | `gap: 14px`      | `var(--space-4)` = 16px (grid 8pt)             |
| l   | Padding do panel | `padding: 18px`  | `var(--space-5)` = 20px                        |
| m   | Gap entre campos | `gap: 14px`      | `var(--space-4)` = 16px                        |
| n   | Footer padding   | `14px 24px 18px` | `var(--space-4) var(--space-6) var(--space-5)` |

### 2.4 Componentes

| #   | Divergência           | Descrição                                                                                                         |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| o   | **Inline styles**     | Step components usam `style={{...}}` extensivamente — migrar para classes CSS em `globals.css` ou módulo dedicado |
| p   | **Segmented buttons** | Implementação manual com `aria-pressed` — criar componente `<SegmentedControl>` reutilizável usando tokens        |
| q   | **Sliders**           | Range inputs nativos sem customização — estilizar com `::-webkit-slider-thumb` usando `--color-primary`           |
| r   | **Number inputs**     | Estilo básico sem spin buttons customizados                                                                       |
| s   | **Stepper**           | `BriefingStepper` está OK mas usa cores inline — migrar para CSS vars                                             |
| t   | **Cards de terreno**  | Dashboard usa cards com imagem + métricas + status — briefing não tem card de resumo do terreno                   |

### 2.5 Layout

| #   | Divergência             | Descrição                                                                                    |
| --- | ----------------------- | -------------------------------------------------------------------------------------------- |
| u   | **Breadcrumb**          | Dashboard tem breadcrumb (Meus terrenos / Nome / Briefing) — briefing v2 não tem             |
| v   | **Header com contexto** | Dashboard mostra nome do terreno com destaque — briefing só mostra endereço em texto pequeno |
| w   | **Responsividade**      | `@media (max-width: 1100px)` colapsa para 1 coluna — testar e validar em mobile              |
| x   | **SVG aspect-ratio**    | Fixo em `4/3` — deveria se adaptar ao ratio real do polígono                                 |

---

## Priorização sugerida

### P0 — Crítico (funcionalidade core)

| ID  | Tarefa                                       |
| --- | -------------------------------------------- |
| G   | Renderizar região buildable (recuos) no SVG  |
| H   | Cotas de dimensão nos galpões                |
| I   | Label de área construída total               |
| N   | Feedback visual quando footprint excede lote |
| a   | Cor primária nos botões ativos (`#D72042`)   |
| b   | Background de inputs com token               |

### P1 — Importante (UX profissional)

| ID  | Tarefa                                |
| --- | ------------------------------------- |
| A   | Cor do footprint por tipologia        |
| C   | Label de pé-direito no footprint      |
| E   | Gate como abertura no muro            |
| J   | Barra de escala                       |
| L   | Labels de recuo nas arestas           |
| o   | Migrar inline styles para classes CSS |
| p   | Componente `<SegmentedControl>`       |
| u   | Breadcrumb                            |
| v   | Header com contexto do terreno        |

### P2 — Nice to have (polish)

| ID  | Tarefa                                     |
| --- | ------------------------------------------ |
| B   | Estilo do footprint por padrão construtivo |
| D   | Muro com espessura proporcional            |
| F   | Área de estacionamento posicionada         |
| K   | Indicador de norte                         |
| M   | Tooltip/hover nos galpões                  |
| O   | Parking polygon calculado                  |
| P   | Otimizar grid de fitBuildings              |
| q   | Estilizar range inputs                     |
| s   | Stepper com CSS vars                       |
| t   | Card de resumo do terreno                  |
| x   | SVG aspect-ratio adaptativo                |
