"use client";

/**
 * BriefingClient — Agente Pré-Projeto (chat + preview + premissas).
 * Fluxo "5 essenciais" guiado por chips, com fallback freeform.
 * Quando todos os essenciais estão preenchidos (ou o usuário clica
 * "Gerar relatório agora"), dispara o endpoint `/api/ai/generate`
 * em streaming SSE — mesmo backend já existente.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { IndustrialShed } from "@/lib/shedSchema";
import type { LngLat } from "@/lib/geo";
import { generateFallbackShed } from "@/lib/shedDefaults";

const ShedViewer = dynamic(() => import("@/components/ShedViewer"), {
  ssr: false,
  loading: () => (
    <div className="preview-empty">Carregando viewer 3D…</div>
  ),
});
const TerrainThumb = dynamic(() => import("@/components/TerrainThumb"), {
  ssr: false,
  loading: () => null,
});

interface Props {
  terrainId: string;
  terrainName: string;
  terrainAddress?: string | null;
  areaM2: number;
  polygon: LngLat[];
}

// ============================================================
// Fluxo dos 5 essenciais
// ============================================================

type Tipologia =
  | "logistics"
  | "industrial"
  | "cross_dock"
  | "distribution_center";

type OperacaoChoice =
  | "recommended"
  | "mezanino"
  | "tall"
  | "fewer_docks"
  | "crane_heavy"
  | "no_docks";

type PlantaChoice =
  | "longitudinal_office_front"
  | "cross_dock"
  | "office_side_l"
  | "u_shape_patio"
  | "compact_single_span";

interface Essentials {
  tipologia?: Tipologia;
  escalaM2?: number;
  operacao?: OperacaoChoice;
  planta?: PlantaChoice;
  plantaNote?: string;
  prazoMeses?: number;
  orcamentoBRL?: number;
}

interface ChatMsg {
  id: string;
  role: "agent" | "user";
  step?: number;
  // ChatMsg ainda existe pra compat com pushAgent/pushUser (stubs no-op).
  content: React.ReactNode;
  ts: string;
}
void 0 as unknown as ChatMsg; // suppress unused

interface LedgerItem {
  label: string;
  value: string;
  status: "done" | "pending" | "live";
}

const TIPOLOGIA_LABELS: Record<Tipologia, string> = {
  logistics: "Logístico / CD",
  industrial: "Industrial leve",
  cross_dock: "Cross-docking",
  distribution_center: "Híbrido + escritório",
};

const OPERACAO_LABELS: Record<OperacaoChoice, string> = {
  recommended: "Vão 25 m · pé-direito 12 m · 8 docas",
  mezanino: "+ Mezanino escritório",
  tall: "Pé-direito 14 m (6 níveis porta-paletes)",
  fewer_docks: "Menos docas (4–6)",
  crane_heavy: "+ Ponte rolante 20 t",
  no_docks: "Sem docas (mont./fluxo lateral)",
};

interface PlantaOption {
  id: PlantaChoice;
  title: string;
  short: string;
  detail: string;
  /** SVG do partido arquitetônico (viewBox 0 0 160 100). */
  diagram: React.ReactNode;
}

function plantaOptions(t: Tipologia | undefined): PlantaOption[] {
  // Cores compartilhadas
  const lot = "rgba(215,32,66,0.55)";
  const shed = "rgba(215,32,66,0.18)";
  const shedStroke = "#D72042";
  const office = "rgba(120,170,255,0.35)";
  const officeStroke = "#5b8dff";
  const dock = "#FF7524";
  const patio = "rgba(255,255,255,0.06)";

  const base: PlantaOption[] = [
    {
      id: "longitudinal_office_front",
      title: "Longitudinal · escritório na frente",
      short: "Escritório frente · docas atrás",
      detail:
        "Galpão retângulo 1:2,5 com bloco administrativo (200–400 m²) na fachada frontal e docas na fachada oposta. Fluxo simples, visível da via.",
      diagram: (
        <svg viewBox="0 0 160 100" preserveAspectRatio="none">
          <rect x="4" y="4" width="152" height="92" fill={patio} stroke={lot} strokeDasharray="3 3" />
          <rect x="18" y="20" width="124" height="60" fill={shed} stroke={shedStroke} />
          <rect x="18" y="20" width="124" height="12" fill={office} stroke={officeStroke} />
          {[0,1,2,3,4,5,6,7].map(i => (
            <rect key={i} x={26 + i*14} y={76} width="8" height="6" fill={dock} />
          ))}
        </svg>
      ),
    },
    {
      id: "cross_dock",
      title: "Cross-dock · docas dos dois lados",
      short: "Docas paralelas (in/out)",
      detail:
        "Retângulo estreito (vaos 18–22 m). Docas em ambas as fachadas longas — entrada e saída separadas. Maior produtividade logística.",
      diagram: (
        <svg viewBox="0 0 160 100" preserveAspectRatio="none">
          <rect x="4" y="4" width="152" height="92" fill={patio} stroke={lot} strokeDasharray="3 3" />
          <rect x="14" y="30" width="132" height="40" fill={shed} stroke={shedStroke} />
          {[0,1,2,3,4,5,6,7].map(i => (
            <rect key={`t${i}`} x={22 + i*16} y={24} width="10" height="6" fill={dock} />
          ))}
          {[0,1,2,3,4,5,6,7].map(i => (
            <rect key={`b${i}`} x={22 + i*16} y={70} width="10" height="6" fill={dock} />
          ))}
        </svg>
      ),
    },
    {
      id: "office_side_l",
      title: "L · escritório anexo lateral",
      short: "Anexo administrativo em L",
      detail:
        "Galpão principal + anexo administrativo em L na lateral. Bom para times maiores ou operação com SAC/atendimento separado da logística.",
      diagram: (
        <svg viewBox="0 0 160 100" preserveAspectRatio="none">
          <rect x="4" y="4" width="152" height="92" fill={patio} stroke={lot} strokeDasharray="3 3" />
          <rect x="18" y="22" width="104" height="60" fill={shed} stroke={shedStroke} />
          <rect x="122" y="22" width="24" height="60" fill={office} stroke={officeStroke} />
          {[0,1,2,3,4,5].map(i => (
            <rect key={i} x={26 + i*14} y={78} width="8" height="6" fill={dock} />
          ))}
        </svg>
      ),
    },
    {
      id: "u_shape_patio",
      title: "U · pátio interno de manobra",
      short: "Pátio interno protegido",
      detail:
        "Dois galpões paralelos ligados por bloco menor, formando U com pátio interno. Pátio fica protegido visualmente — bom para CD urbano ou cargas sensíveis.",
      diagram: (
        <svg viewBox="0 0 160 100" preserveAspectRatio="none">
          <rect x="4" y="4" width="152" height="92" fill={patio} stroke={lot} strokeDasharray="3 3" />
          <rect x="16" y="18" width="40" height="64" fill={shed} stroke={shedStroke} />
          <rect x="104" y="18" width="40" height="64" fill={shed} stroke={shedStroke} />
          <rect x="56" y="18" width="48" height="18" fill={office} stroke={officeStroke} />
          <rect x="60" y="44" width="40" height="30" fill="none" stroke="rgba(255,255,255,0.35)" strokeDasharray="2 3" />
          <text x="80" y="62" textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.55)">pátio</text>
        </svg>
      ),
    },
    {
      id: "compact_single_span",
      title: "Compacto · vão único sem anexo",
      short: "Vão único minimalista",
      detail:
        "Só o galpão, sem bloco administrativo dedicado. Escritório cabe num mezanino interno. Maximiza área útil e reduz custo.",
      diagram: (
        <svg viewBox="0 0 160 100" preserveAspectRatio="none">
          <rect x="4" y="4" width="152" height="92" fill={patio} stroke={lot} strokeDasharray="3 3" />
          <rect x="14" y="18" width="132" height="64" fill={shed} stroke={shedStroke} />
          <rect x="110" y="22" width="30" height="18" fill={office} stroke={officeStroke} strokeDasharray="2 2" />
          <text x="125" y="34" textAnchor="middle" fontSize="7" fill="rgba(255,255,255,0.6)">mez.</text>
        </svg>
      ),
    },
  ];

  if (t === "industrial") {
    // Industrial leve raramente usa docas niveladoras na linha;
    // priorizamos compacto / L / U. Removemos cross-dock.
    return base.filter((o) => o.id !== "cross_dock");
  }
  return base;
}

const PLANTA_LABELS: Record<PlantaChoice, string> = {
  longitudinal_office_front: "Longitudinal · escritório frontal",
  cross_dock: "Cross-dock · docas paralelas",
  office_side_l: "L · anexo lateral",
  u_shape_patio: "U · pátio interno",
  compact_single_span: "Compacto · vão único",
};

/**
 * Configuração de operação por tipologia. Galpão industrial leve não
 * tem perfil logístico: a referência são pontes rolantes, pé-direito menor
 * e pátio de carga lateral — não docas niveladoras.
 */
function operacaoConfig(t: Tipologia | undefined): {
  referenceLine: React.ReactNode;
  chips: { id: OperacaoChoice; label: string }[];
  hudLabel: string;
  hudValue: (op: OperacaoChoice | undefined, shedDocks: number) => string;
} {
  if (t === "industrial") {
    return {
      referenceLine: (
        <>
          <strong>vão 20 m · pé-direito 9 m · ponte rolante 10 t</strong>
        </>
      ),
      chips: [
        { id: "recommended", label: "✓ Bate, segue assim" },
        { id: "crane_heavy", label: "+ Ponte rolante 20 t" },
        { id: "tall", label: "↑ Pé-direito 12 m" },
        { id: "mezanino", label: "+ Mezanino técnico" },
      ],
      hudLabel: "Ponte rolante",
      hudValue: (op) =>
        op === "crane_heavy" ? "20 t" : op === "no_docks" ? "—" : "10 t",
    };
  }
  // logístico / CD / cross-dock / híbrido
  return {
    referenceLine: (
      <>
        <strong>vão 25 m · pé-direito 12 m · 8 docas niveladoras</strong>
      </>
    ),
    chips: [
      { id: "recommended", label: "✓ Bate, segue assim" },
      { id: "mezanino", label: "+ Mezanino escritório" },
      { id: "tall", label: "↑ Pé-direito 14 m" },
      { id: "fewer_docks", label: "↓ Menos docas (4–6)" },
    ],
    hudLabel: "Docas",
    hudValue: (op, shedDocks) =>
      `${op === "fewer_docks" ? 5 : shedDocks || 8} niveladoras`,
  };
}

function nowTime() {
  return new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function fmtBRLm(v: number) {
  return `R$ ${(v / 1_000_000).toFixed(2).replace(".", ",")} M`;
}

// ============================================================

export default function BriefingClient({
  terrainId,
  terrainName,
  terrainAddress,
  areaM2,
  polygon,
}: Props) {
  const router = useRouter();
  const constructiveM2 = Math.round(areaM2 * 0.7);

  const preExtracted: LedgerItem[] = useMemo(
    () => [
      {
        label: "Terreno",
        value: `${Math.round(areaM2).toLocaleString("pt-BR")} m²`,
        status: "done",
      },
      {
        label: "Endereço",
        value: (terrainAddress ?? terrainName).slice(0, 32),
        status: "done",
      },
      { label: "TO efetiva", value: "70% (assumido)", status: "done" },
      {
        label: "Construtível",
        value: `${constructiveM2.toLocaleString("pt-BR")} m²`,
        status: "done",
      },
      { label: "Fundação", value: "Sapatas + baldrames", status: "done" },
      { label: "Cobertura", value: "Sandwich PIR 50 mm", status: "done" },
      { label: "Fechamento", value: "Aço trapezoidal + isol.", status: "done" },
      { label: "Piso", value: "Concreto polido 20 cm", status: "done" },
      { label: "BDI (CUB-SP)", value: "26%", status: "done" },
    ],
    [areaM2, constructiveM2, terrainName, terrainAddress]
  );

  const [essentials, setEssentials] = useState<Essentials>({});
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [input, setInput] = useState("");

  const [streaming, setStreaming] = useState(false);
  const [shed, setShed] = useState<IndustrialShed | null>(null);
  const [source, setSource] = useState<"ai" | "fallback" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [tab, setTab] = useState<"map" | "3d" | "premissas">("map");

  // Galpão único realista: cap em ~9.000 m² (60 × 150 m, limite do steel-frame
  // sem juntas de dilatação). Para lotes muito maiores oferecemos múltiplos
  // módulos numa próxima iteração; por enquanto evitamos sugerir 150k m².
  const SINGLE_SHED_MAX_M2 = 9000;
  const recommendedScale = useMemo(() => {
    const ideal = constructiveM2 * 0.45; // 45% do construtível como ponto-doce
    const capped = Math.min(SINGLE_SHED_MAX_M2, Math.max(800, ideal));
    return Math.round(capped / 100) * 100;
  }, [constructiveM2]);
  const isLargeLot = constructiveM2 > SINGLE_SHED_MAX_M2 * 1.5;

  // Galpão de preview determinístico — usado enquanto a IA não gerou nada,
  // pra "Volume estimado" mostrar um 3D real (não a caixa CSS feia).
  const previewShed = useMemo<IndustrialShed>(() => {
    const targetM2 =
      essentials.escalaM2 ?? Math.min(SINGLE_SHED_MAX_M2, recommendedScale);
    return generateFallbackShed({
      areaM2: targetM2 / 0.65, // generateFallbackShed ocupa 65% da área
      use: essentials.tipologia ?? "logistics",
      standard:
        essentials.orcamentoBRL && essentials.orcamentoBRL > 6_000_000
          ? "alto"
          : essentials.orcamentoBRL && essentials.orcamentoBRL < 2_500_000
          ? "economico"
          : "medio",
    });
  }, [
    essentials.escalaM2,
    essentials.tipologia,
    essentials.orcamentoBRL,
    recommendedScale,
  ]);

  // Stubs no-op: o wizard substituiu o chat, mas mantemos as assinaturas
  // pra não invasivamente alterar chamadores (choose*, generate, etc.).
  const pushAgent = useCallback(
    (_step: number | undefined, _content: React.ReactNode) => {},
    [],
  );
  const pushUser = useCallback((_content: React.ReactNode) => {}, []);
  void pushAgent; void pushUser; // silenciar lint quando todos os calls forem podados

  // (boot/scroll do chat removidos: o wizard renderiza só a etapa atual.)

  function chooseTipologia(t: Tipologia) {
    setEssentials((e) => ({ ...e, tipologia: t }));
    pushUser(TIPOLOGIA_LABELS[t]);
    setCurrentStep(2);
    pushAgent(
      2,
      <>
        Com TO 70% sobram{" "}
        <strong>{constructiveM2.toLocaleString("pt-BR")} m²</strong>{" "}
        construíveis.{" "}
        {isLargeLot ? (
          <>
            O lote é grande — vou propor um <strong>galpão único</strong> de
            até <strong>{SINGLE_SHED_MAX_M2.toLocaleString("pt-BR")} m²</strong>{" "}
            (60×150 m, limite estrutural sem juntas). O excedente fica como
            pátio/manobra. Qual escala alvo?
          </>
        ) : (
          <>Qual escala alvo?</>
        )}
      </>
    );
  }
  function chooseEscala(m2: number, label: string) {
    setEssentials((e) => ({ ...e, escalaM2: m2 }));
    pushUser(label);
    setCurrentStep(3);
    const cfg = operacaoConfig(essentials.tipologia);
    pushAgent(
      3,
      <>
        Para {m2.toLocaleString("pt-BR")} m², a referência é {cfg.referenceLine}.
        Bate com sua operação?
      </>
    );
  }
  function chooseOperacao(o: OperacaoChoice) {
    setEssentials((e) => ({ ...e, operacao: o }));
    setCurrentStep(4);
  }
  function choosePlanta(p: PlantaChoice, note?: string) {
    setEssentials((e) => ({
      ...e,
      planta: p,
      plantaNote: note ?? e.plantaNote,
    }));
    setCurrentStep(5);
  }
  function setPlantaNote(note: string) {
    setEssentials((e) => ({ ...e, plantaNote: note }));
  }
  function choosePrazo(meses: number, _label: string) {
    setEssentials((e) => ({ ...e, prazoMeses: meses }));
    setCurrentStep(6);
  }
  function chooseOrcamento(brl: number, _label: string) {
    setEssentials((e) => ({ ...e, orcamentoBRL: brl }));
    setCurrentStep(7);
  }

  function buildPrompt(): string {
    const e = essentials;
    const parts: string[] = [];
    parts.push(
      `Lote ${Math.round(areaM2)} m² em ${terrainAddress ?? terrainName}.`
    );
    if (e.tipologia) parts.push(`Uso: ${TIPOLOGIA_LABELS[e.tipologia]}.`);
    if (e.escalaM2) parts.push(`Área construída alvo: ${e.escalaM2} m².`);
    if (e.operacao) parts.push(OPERACAO_LABELS[e.operacao] + ".");
    if (e.planta) {
      parts.push(
        `Partido de planta escolhido: ${PLANTA_LABELS[e.planta]} — ${
          plantaOptions(e.tipologia).find((o) => o.id === e.planta)?.detail ??
          ""
        }`,
      );
      if (e.plantaNote && e.plantaNote.trim()) {
        parts.push(`Ajustes do usuário para a planta: “${e.plantaNote.trim()}”.`);
      }
    }
    if (e.prazoMeses) parts.push(`Prazo: ${e.prazoMeses} meses.`);
    if (e.orcamentoBRL)
      parts.push(`Orçamento-teto: ${fmtBRLm(e.orcamentoBRL)}.`);
    parts.push(
      "Adote padrão construtivo coerente com o orçamento, sandwich PIR, piso polido, AVCB obrigatório."
    );
    parts.push(
      `Restrições do lote: footprint máximo de um único galpão = ${SINGLE_SHED_MAX_M2} m² (60×150 m). O modelo deve caber dentro do polígono do terreno (${Math.round(areaM2)} m², ${polygon.length} vértices), respeitando recuos e taxa de ocupação razoável.`,
    );
    if (extraNotes.length > 0) {
      parts.push(
        "Pedidos extras do usuário: " +
          extraNotes.map((n) => `“${n}”`).join("; ") +
          ".",
      );
    }
    return parts.join(" ");
  }

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  const generate = useCallback(
    async (overridePrompt?: string) => {
      if (streaming) return;
      const prompt = overridePrompt ?? buildPrompt();
      setError(null);
      setStreaming(true);
      pushAgent(undefined, <>Gerando modelo 3D paramétrico…</>);

      const tipologiaUse: IndustrialShed["use"] =
        essentials.tipologia ?? "logistics";
      const stdGuess: IndustrialShed["standard"] = essentials.orcamentoBRL
        ? essentials.orcamentoBRL > 6_000_000
          ? "alto"
          : essentials.orcamentoBRL < 2_500_000
          ? "economico"
          : "medio"
        : "medio";

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/ai/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            terrainId,
            use: tipologiaUse,
            standard: stdGuess,
          }),
          signal: controller.signal,
        });

        const ctype = res.headers.get("Content-Type") ?? "";
        if (!ctype.includes("text/event-stream")) {
          const json = (await res.json()) as {
            shed?: IndustrialShed;
            source?: "ai" | "fallback";
            error?: string;
          };
          if (json.shed) setShed(json.shed);
          if (json.source) setSource(json.source);
          if (json.error) setError(json.error);
          if (json.shed) setTab("3d");
          pushAgent(
            undefined,
            json.shed ? (
              <>
                Pronto. Modelo gerado
                {json.source === "fallback" ? " (fallback determinístico)" : ""}.
              </>
            ) : (
              <>Não consegui gerar agora — {json.error ?? "erro"}.</>
            )
          );
          setStreaming(false);
          return;
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() || "";
          for (const evt of events) {
            if (!evt.trim()) continue;
            let eventName = "message";
            let dataStr = "";
            for (const line of evt.split("\n")) {
              if (line.startsWith("event:")) eventName = line.slice(6).trim();
              else if (line.startsWith("data:"))
                dataStr += line.slice(5).trim();
            }
            if (!dataStr) continue;
            let data: unknown;
            try {
              data = JSON.parse(dataStr);
            } catch {
              continue;
            }
            if (eventName === "error") {
              const d = data as { error?: string };
              setError(d.error ?? "Erro desconhecido");
            } else if (eventName === "result") {
              const d = data as {
                shed?: IndustrialShed;
                source?: "ai" | "fallback";
                error?: string;
              };
              if (d.shed) setShed(d.shed);
              if (d.source) setSource(d.source);
              if (d.shed) setTab("3d");
              if (d.error) setError(d.error);
              pushAgent(
                undefined,
                d.shed ? (
                  <>
                    Pronto. Modelo paramétrico{" "}
                    {d.source === "ai" ? "gerado pela IA" : "via fallback"} —
                    você pode salvar ou refinar.
                  </>
                ) : (
                  <>Falha na geração: {d.error ?? "erro desconhecido"}.</>
                )
              );
            }
          }
        }
      } catch (err) {
        if ((err as { name?: string }).name !== "AbortError") {
          setError((err as Error).message);
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [streaming, essentials, terrainId, terrainName, terrainAddress, areaM2]
  );

  const save = useCallback(async () => {
    if (!shed) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/terrenos/${terrainId}/sheds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `Galpão ${shed.use} ${shed.footprint.width}×${shed.footprint.depth}m`,
          shed,
        }),
      });
      if (!res.ok) throw new Error("Falha ao salvar");
      const json = (await res.json()) as { id: string };
      setSavedId(json.id);
      router.push(`/terrenos/${terrainId}/construcoes/${json.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [shed, terrainId, router]);

  // Lista de "pedidos extras" digitados, que entram no prompt SÓ quando o
  // usuário clicar explicitamente em "Gerar relatório agora". Evita disparar
  // a geração 3D só por digitar uma frase no chat.
  const [extraNotes, setExtraNotes] = useState<string[]>([]);

  function handleInputSubmit(e: React.FormEvent) {
    e.preventDefault();
    const txt = input.trim();
    if (!txt) return;
    setExtraNotes((prev) => [...prev, txt]);
    setInput("");
  }

  const stepsDone =
    (essentials.tipologia ? 1 : 0) +
    (essentials.escalaM2 ? 1 : 0) +
    (essentials.operacao ? 1 : 0) +
    (essentials.planta ? 1 : 0) +
    (essentials.prazoMeses ? 1 : 0) +
    (essentials.orcamentoBRL ? 1 : 0);
  const TOTAL_STEPS = 6;
  const progressPct = (stepsDone / TOTAL_STEPS) * 100;

  const essentialLedger: LedgerItem[] = [
    {
      label: "Tipologia",
      value: essentials.tipologia
        ? TIPOLOGIA_LABELS[essentials.tipologia]
        : "— a perguntar",
      status: essentials.tipologia
        ? "done"
        : currentStep === 1
        ? "live"
        : "pending",
    },
    {
      label: "Área construída",
      value: essentials.escalaM2
        ? `${essentials.escalaM2.toLocaleString("pt-BR")} m²`
        : "— a perguntar",
      status: essentials.escalaM2
        ? "done"
        : currentStep === 2
        ? "live"
        : "pending",
    },
    {
      label: "Vão · pé-direito · docas",
      value: essentials.operacao
        ? essentials.operacao === "tall"
          ? "25 m · 14 m · 8"
          : essentials.operacao === "fewer_docks"
          ? "25 m · 12 m · 5"
          : "25 m · 12 m · 8"
        : "— a perguntar",
      status: essentials.operacao
        ? "done"
        : currentStep === 3
        ? "live"
        : "pending",
    },
    {
      label: "Planta baixa",
      value: essentials.planta
        ? PLANTA_LABELS[essentials.planta]
        : "— a perguntar",
      status: essentials.planta
        ? "done"
        : currentStep === 4
        ? "live"
        : "pending",
    },
    {
      label: "Prazo desejado",
      value: essentials.prazoMeses
        ? `${essentials.prazoMeses} meses`
        : "— a perguntar",
      status: essentials.prazoMeses
        ? "done"
        : currentStep === 5
        ? "live"
        : "pending",
    },
    {
      label: "Orçamento-teto",
      value: essentials.orcamentoBRL
        ? fmtBRLm(essentials.orcamentoBRL)
        : "— a perguntar",
      status: essentials.orcamentoBRL
        ? "done"
        : currentStep === 6
        ? "live"
        : "pending",
    },
  ];

  const sourceLabel =
    source === "ai" ? "Gerado por IA" : source === "fallback" ? "Fallback" : null;

  return (
    <>
      <header className="page-header">
        <div className="stack-sm">
          <nav className="breadcrumb">
            <a href="/">Meus terrenos</a>
            <span className="sep">/</span>
            <a href={`/terrenos/${terrainId}`}>{terrainName}</a>
            <span className="sep">/</span>
            <span className="crumb-current">Briefing · Agente Pré-Projeto</span>
          </nav>
          <div className="page-title-row">
            <h1>Agente Pré-Projeto · Galpão</h1>
            <span className="pill pill-primary">
              <span className="dot" />
              {streaming ? "Gerando…" : "Conversação ativa"}
            </span>
            <span className="pill pill-success mono">
              <span className="dot" />
              {stepsDone} de {TOTAL_STEPS} essenciais
            </span>
            {sourceLabel && (
              <span
                className={`pill ${
                  source === "ai" ? "pill-success" : "pill-warning"
                }`}
              >
                <span className="dot" />
                {sourceLabel}
              </span>
            )}
          </div>
        </div>
        <div className="row">
          <a href={`/terrenos/${terrainId}`} className="btn btn-ghost">
            Salvar e sair
          </a>
          {shed ? (
            <button
              type="button"
              onClick={save}
              disabled={saving || !!savedId}
              className="btn btn-primary"
            >
              {savedId
                ? "✓ Salvo"
                : saving
                ? "Salvando…"
                : "Salvar construção"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => generate()}
              disabled={streaming || stepsDone < 3}
              className="btn btn-primary"
              title={
                stepsDone < 3
                  ? "Preencha ao menos 3 essenciais"
                  : "Gerar relatório agora"
              }
            >
              Gerar relatório agora
            </button>
          )}
        </div>
      </header>

      <div className="briefing-shell">
        <section className="wizard-pane">
          <header className="chat-head">
            <div className="agent">
              <div className="agent-avatar">AI</div>
              <div>
                <div className="agent-name">
                  Agente Pré-Projeto · GenIA
                  <span className="ai-badge" title="Este wizard é conduzido pela IA">
                    <span className="dot" /> IA conduzindo
                  </span>
                </div>
                <div className="agent-sub">
                  Wizard guiado · {preExtracted.length} premissas pré-extraídas
                </div>
              </div>
            </div>
            <div className="chat-progress">
              <div className="progress-row">
                <span>Essenciais</span>
                <div className="essentials-dots">
                  {[1, 2, 3, 4, 5, 6].map((s) => (
                    <span
                      key={s}
                      className={`dot-step ${
                        s < currentStep
                          ? "done"
                          : s === currentStep
                          ? "current"
                          : ""
                      }`}
                    />
                  ))}
                </div>
              </div>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="progress-row">
                <span>Falta</span>
                <span>
                  {TOTAL_STEPS - stepsDone === 0
                    ? "Pronto para gerar"
                    : `${TOTAL_STEPS - stepsDone} ${
                        TOTAL_STEPS - stepsDone === 1
                          ? "pergunta"
                          : "perguntas"
                      }`}
                </span>
              </div>
            </div>
          </header>

          <div className="prefill-banner">
            <svg
              className="pf-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            <div>
              Já preenchi <strong>{preExtracted.length} premissas</strong> a
              partir do terreno ({Math.round(areaM2).toLocaleString("pt-BR")} m²
              · TO 70% · CUB-SP). A IA vai te guiar por{" "}
              <strong>5 decisões essenciais</strong> — uma de cada vez.
            </div>
          </div>

          <div className="wizard-body">
            {currentStep <= TOTAL_STEPS ? (
              <WizardStep
                step={currentStep}
                essentials={essentials}
                recommendedScale={recommendedScale}
                isLargeLot={isLargeLot}
                constructiveM2={constructiveM2}
                singleShedMaxM2={SINGLE_SHED_MAX_M2}
                onTipologia={chooseTipologia}
                onEscala={chooseEscala}
                onOperacao={chooseOperacao}
                onPlanta={choosePlanta}
                onPlantaNote={setPlantaNote}
                onPrazo={choosePrazo}
                onOrcamento={chooseOrcamento}
                onBack={() =>
                  setCurrentStep((s) => Math.max(1, s - 1))
                }
                onSkipToReview={
                  stepsDone >= 4 ? () => setCurrentStep(TOTAL_STEPS + 1) : undefined
                }
              />
            ) : (
              <WizardReview
                essentials={essentials}
                extraNotes={extraNotes}
                streaming={streaming}
                onBack={() => setCurrentStep(TOTAL_STEPS)}
                onGenerate={() => generate()}
                onEditStep={(s) => setCurrentStep(s)}
              />
            )}

            <form className="wizard-freeform" onSubmit={handleInputSubmit}>
              <label>
                <span className="ff-label">
                  Observação livre para a IA
                </span>
                <span className="ff-hint">
                  Entra no prompt quando você tocar <b>Gerar</b>.
                </span>
              </label>
              <div className="ff-row">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ex: telha branca, prefiro mezanino no fundo, ponte rolante futura…"
                  disabled={streaming}
                />
                <button
                  type="submit"
                  className="btn btn-ghost"
                  disabled={!input.trim() || streaming}
                >
                  Anotar
                </button>
              </div>
              {extraNotes.length > 0 && (
                <ul className="wizard-notes">
                  {extraNotes.map((n, i) => (
                    <li key={i}>
                      <span>📝 {n}</span>
                      <button
                        type="button"
                        aria-label="Remover"
                        onClick={() =>
                          setExtraNotes((p) =>
                            p.filter((_, j) => j !== i),
                          )
                        }
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </form>

            {streaming && (
              <div className="wizard-streaming">
                <span className="d" />
                <span className="d" />
                <span className="d" />
                <span>IA gerando o modelo 3D paramétrico…</span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={stopStream}
                >
                  Parar
                </button>
              </div>
            )}

            {error && (
              <div className="toast toast-danger">
                <div>
                  <div className="toast-title">Erro</div>
                  <div className="toast-desc">{error}</div>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="preview-pane">
          <header className="preview-head">
            <div className="preview-tabs">
              <button
                className={`preview-tab ${tab === "map" ? "active" : ""}`}
                onClick={() => setTab("map")}
              >
                Mapa & relevo
              </button>
              <button
                className={`preview-tab ${tab === "3d" ? "active" : ""}`}
                onClick={() => setTab("3d")}
              >
                Volume 3D
              </button>
              <button
                className={`preview-tab ${
                  tab === "premissas" ? "active" : ""
                }`}
                onClick={() => setTab("premissas")}
              >
                Premissas ({preExtracted.length + stepsDone})
              </button>
            </div>
            <span
              className={`pill ${streaming ? "pill-primary" : "pill-success"}`}
            >
              <span className="dot" />
              {streaming ? "Gerando" : "Ao vivo"}
            </span>
          </header>

          <div
            className="preview-stage"
            style={
              tab === "premissas" || tab === "3d"
                ? { gridTemplateRows: "1fr" }
                : undefined
            }
          >
            {tab === "map" && (
              <>
                <div className="stage-map">
                  <TerrainThumb
                    polygon={polygon}
                    building={shed?.footprint ?? null}
                    interactive
                  />
                  <div className="stage-label">
                    <span className="pulse" />
                    Lote · {Math.round(areaM2).toLocaleString("pt-BR")} m²
                  </div>
                </div>
                <div className="stage-3d">
                  <ShedViewer
                    shed={shed ?? previewShed}
                    polygon={polygon}
                    height="100%"
                    compact
                  />
                  <div className="stage-label">
                    <span className="pulse" />
                    {shed ? "Volume gerado" : "Volume estimado (preview)"}
                  </div>
                  <HUDPreview
                    essentials={essentials}
                    recommendedScale={recommendedScale}
                    shed={shed}
                  />
                </div>
              </>
            )}

            {tab === "3d" && (
              <div style={{ position: "relative", width: "100%", height: "100%" }}>
                <ShedViewer
                  shed={shed ?? previewShed}
                  polygon={polygon}
                  height="100%"
                />
                {!shed && (
                  <div
                    className="stage-label"
                    style={{ left: 12, bottom: 12 }}
                  >
                    <span className="pulse" />
                    Preview determinístico — toque <b>Gerar</b> para a IA refinar
                  </div>
                )}
              </div>
            )}

            {tab === "premissas" && (
              <div
                style={{
                  overflowY: "auto",
                  padding: "var(--space-4)",
                  background: "var(--color-background)",
                }}
              >
                <h3
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--color-text-secondary)",
                    marginBottom: 12,
                  }}
                >
                  Pré-extraídas ({preExtracted.length})
                </h3>
                <div className="assumption-list" style={{ marginBottom: 16 }}>
                  {preExtracted.map((p) => (
                    <AssumptionRow key={p.label} item={p} />
                  ))}
                </div>
                <h3
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--color-text-secondary)",
                    marginBottom: 12,
                  }}
                >
                  Premissas ({stepsDone}/{TOTAL_STEPS})
                </h3>
                <div className="assumption-list">
                  {essentialLedger.map((p) => (
                    <AssumptionRow key={p.label} item={p} />
                  ))}
                </div>
                {shed?.assumptions && shed.assumptions.length > 0 && (
                  <>
                    <h3
                      style={{
                        fontSize: 11,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        color: "var(--color-text-secondary)",
                        margin: "16px 0 12px",
                      }}
                    >
                      Adotadas pela IA ({shed.assumptions.length})
                    </h3>
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: 18,
                        color: "var(--color-text-secondary)",
                        fontSize: 12,
                      }}
                    >
                      {shed.assumptions.map((a, i) => (
                        <li key={i} style={{ marginBottom: 4 }}>
                          {a}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>

          {tab !== "premissas" && (
            <aside className="assumptions-pane">
              <h3>
                Premissas · {preExtracted.length} auto · {stepsDone}{" "}
                confirmadas · {TOTAL_STEPS - stepsDone} a pedir
              </h3>
              <div className="assumption-list">
                {essentialLedger.map((p) => (
                  <AssumptionRow key={p.label} item={p} />
                ))}
              </div>
            </aside>
          )}
        </section>
      </div>
    </>
  );
}

// ============================================================

function AssumptionRow({ item }: { item: LedgerItem }) {
  return (
    <div className={`assumption ${item.status}`}>
      <div className="check">
        {item.status === "pending" ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4l3 2" />
          </svg>
        ) : item.status === "live" ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          >
            <circle cx="12" cy="12" r="5" />
          </svg>
        ) : (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </div>
      <span className="label">{item.label}</span>
      <span className="value">{item.value}</span>
    </div>
  );
}

// ============================================================
// Wizard
// ============================================================

const STEP_META: Record<
  number,
  { tag: string; title: string }
> = {
  1: { tag: "Tipologia", title: "Que tipo de galpão você quer?" },
  2: { tag: "Escala", title: "Qual a escala alvo?" },
  3: { tag: "Operação", title: "Como será a operação?" },
  4: { tag: "Planta baixa", title: "Que partido de planta faz mais sentido?" },
  5: { tag: "Prazo", title: "Qual o prazo para entrar em operação?" },
  6: { tag: "Orçamento-teto", title: "Qual o orçamento-teto?" },
};

function WizardStep(props: {
  step: number;
  essentials: Essentials;
  recommendedScale: number;
  isLargeLot: boolean;
  constructiveM2: number;
  singleShedMaxM2: number;
  onTipologia: (t: Tipologia) => void;
  onEscala: (m: number, label: string) => void;
  onOperacao: (o: OperacaoChoice) => void;
  onPlanta: (p: PlantaChoice, note?: string) => void;
  onPlantaNote: (note: string) => void;
  onPrazo: (m: number, label: string) => void;
  onOrcamento: (b: number, label: string) => void;
  onBack: () => void;
  onSkipToReview?: () => void;
}) {
  const meta = STEP_META[props.step];
  const explanation = wizardExplanation(props);
  return (
    <div className="wizard-step">
      <div className="wizard-step-tag">
        <span>Passo {props.step} de 6</span>
        <span>·</span>
        <span>{meta.tag}</span>
      </div>
      <h2 className="wizard-question">{meta.title}</h2>

      <div className="wizard-ai-bubble">
        <div className="av">AI</div>
        <div className="bubble">{explanation}</div>
      </div>

      {props.step === 4 ? (
        <PlantaPicker
          tipologia={props.essentials.tipologia}
          selected={props.essentials.planta}
          note={props.essentials.plantaNote ?? ""}
          onSelect={props.onPlanta}
          onNote={props.onPlantaNote}
        />
      ) : (
        <StepChips
          step={props.step}
          essentials={props.essentials}
          recommendedScale={props.recommendedScale}
          onTipologia={props.onTipologia}
          onEscala={props.onEscala}
          onOperacao={props.onOperacao}
          onPrazo={props.onPrazo}
          onOrcamento={props.onOrcamento}
        />
      )}

      <div className="wizard-nav">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={props.onBack}
          disabled={props.step === 1}
        >
          ← Voltar
        </button>
        {props.onSkipToReview && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={props.onSkipToReview}
            title="Ir direto para a revisão e geração"
          >
            Pular para revisão →
          </button>
        )}
      </div>
    </div>
  );
}

function wizardExplanation(p: {
  step: number;
  essentials: Essentials;
  recommendedScale: number;
  isLargeLot: boolean;
  constructiveM2: number;
  singleShedMaxM2: number;
}): React.ReactNode {
  const { step, essentials, isLargeLot, constructiveM2, singleShedMaxM2 } = p;
  if (step === 1) {
    return (
      <>
        Pelo tamanho do lote e localização, <strong>logístico/CD</strong> é o
        padrão estatístico. Mas você decide — eu re-calculo a operação a partir
        disso.
      </>
    );
  }
  if (step === 2) {
    return (
      <>
        Com TO 70% sobram{" "}
        <strong>{constructiveM2.toLocaleString("pt-BR")} m²</strong>{" "}
        construíveis.{" "}
        {isLargeLot ? (
          <>
            O lote é grande — vou propor um <strong>galpão único</strong> de
            até{" "}
            <strong>{singleShedMaxM2.toLocaleString("pt-BR")} m²</strong> (60×150
            m, limite estrutural sem juntas). O excedente vira pátio/manobra.
          </>
        ) : (
          <>Escolha a fatia do construtível que vamos cobrir.</>
        )}
      </>
    );
  }
  if (step === 3) {
    const cfg = operacaoConfig(essentials.tipologia);
    const m2 = essentials.escalaM2;
    return (
      <>
        Para {m2 ? m2.toLocaleString("pt-BR") : "essa"} m², a referência é{" "}
        {cfg.referenceLine}. Ajuste se sua operação pede algo diferente.
      </>
    );
  }
  if (step === 4) {
    return (
      <>
        Selecione o <strong>partido arquitetônico</strong> que mais combina
        com sua operação. Eu desenhei {essentials.tipologia === "industrial" ? "4" : "5"} opções típicas
        — cada uma muda como docas, escritório e pátio se distribuem no lote.
        Você ainda pode <strong>descrever em texto</strong> qualquer ajuste.
      </>
    );
  }
  if (step === 5) {
    return (
      <>
        O prazo baliza o ritmo de mobilização, a escolha do sistema construtivo
        e o esquema de financiamento. Sem isso, eu adoto 9 meses.
      </>
    );
  }
  return (
    <>
      O orçamento-teto define o <strong>padrão construtivo</strong> (sandwich
      PIR vs telha simples, piso, esquadrias). Se preferir não dizer, adoto{" "}
      <strong>médio</strong>.
    </>
  );
}

function WizardReview({
  essentials,
  extraNotes,
  streaming,
  onBack,
  onGenerate,
  onEditStep,
}: {
  essentials: Essentials;
  extraNotes: string[];
  streaming: boolean;
  onBack: () => void;
  onGenerate: () => void;
  onEditStep: (s: number) => void;
}) {
  const rows: { step: number; label: string; value: string }[] = [
    {
      step: 1,
      label: "Tipologia",
      value: essentials.tipologia
        ? TIPOLOGIA_LABELS[essentials.tipologia]
        : "—",
    },
    {
      step: 2,
      label: "Escala alvo",
      value: essentials.escalaM2
        ? `${essentials.escalaM2.toLocaleString("pt-BR")} m²`
        : "—",
    },
    {
      step: 3,
      label: "Operação",
      value: essentials.operacao ? OPERACAO_LABELS[essentials.operacao] : "—",
    },
    {
      step: 4,
      label: "Planta baixa",
      value: essentials.planta
        ? PLANTA_LABELS[essentials.planta] +
          (essentials.plantaNote ? " · “" + essentials.plantaNote.slice(0, 40) + (essentials.plantaNote.length > 40 ? "…" : "") + "”" : "")
        : "—",
    },
    {
      step: 5,
      label: "Prazo",
      value: essentials.prazoMeses ? `${essentials.prazoMeses} meses` : "—",
    },
    {
      step: 6,
      label: "Orçamento-teto",
      value: essentials.orcamentoBRL
        ? fmtBRLm(essentials.orcamentoBRL)
        : "—",
    },
  ];
  return (
    <div className="wizard-step">
      <div className="wizard-step-tag">
        <span>Revisão final</span>
        <span>·</span>
        <span>IA pronta para gerar</span>
      </div>
      <h2 className="wizard-question">Confere o que vou enviar pra IA</h2>

      <div className="wizard-ai-bubble">
        <div className="av">AI</div>
        <div className="bubble">
          Com essas decisões eu monto o galpão paramétrico, dimensiono a
          estrutura, estimo aço/custo e gero o relatório de viabilidade.
        </div>
      </div>

      <div className="wizard-review-list">
        {rows.map((r) => (
          <button
            type="button"
            key={r.step}
            className="wizard-review-row"
            onClick={() => onEditStep(r.step)}
            title="Editar"
          >
            <span className="wr-label">{r.label}</span>
            <span className="wr-value">{r.value}</span>
            <span className="wr-edit">editar</span>
          </button>
        ))}
        {extraNotes.length > 0 && (
          <div className="wizard-review-row notes">
            <span className="wr-label">Observações</span>
            <span className="wr-value">
              {extraNotes.length} anotação(ões) livre(s)
            </span>
          </div>
        )}
      </div>

      <div className="wizard-nav">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          ← Voltar
        </button>
        <button
          type="button"
          className="btn btn-primary wizard-cta"
          onClick={onGenerate}
          disabled={streaming}
        >
          {streaming ? "Gerando…" : "Gerar modelo 3D + relatório"}
        </button>
      </div>
    </div>
  );
}

function StepChips({
  step,
  essentials,
  recommendedScale,
  onTipologia,
  onEscala,
  onOperacao,
  onPrazo,
  onOrcamento,
}: {
  step: number;
  essentials: Essentials;
  recommendedScale: number;
  onTipologia: (t: Tipologia) => void;
  onEscala: (m: number, label: string) => void;
  onOperacao: (o: OperacaoChoice) => void;
  onPrazo: (m: number, label: string) => void;
  onOrcamento: (b: number, label: string) => void;
}) {
  if (step === 1) {
    const opts: { id: Tipologia; label: string }[] = [
      { id: "logistics", label: "🚚 Logístico / CD" },
      { id: "industrial", label: "🏭 Industrial leve" },
      { id: "cross_dock", label: "📦 Cross-docking" },
      { id: "distribution_center", label: "🏢 Híbrido + escritório" },
    ];
    return (
      <div className="quickchips">
        {opts.map((o) => (
          <button
            key={o.id}
            className={`chip ${essentials.tipologia === o.id ? "active" : ""}`}
            onClick={() => onTipologia(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  if (step === 2) {
    const r = recommendedScale;
    const opts = [
      { m: Math.max(400, Math.round((r * 0.7) / 100) * 100), label: "enxuto" },
      { m: r, label: "recomendado" },
      { m: Math.round((r * 1.25) / 100) * 100, label: "máximo" },
    ];
    return (
      <div className="quickchips">
        {opts.map((o) => (
          <button
            key={o.m}
            className={`chip ${essentials.escalaM2 === o.m ? "active" : ""}`}
            onClick={() =>
              onEscala(o.m, `≈ ${o.m.toLocaleString("pt-BR")} m² · ${o.label}`)
            }
          >
            ≈ {o.m.toLocaleString("pt-BR")} m² · {o.label}
          </button>
        ))}
      </div>
    );
  }
  if (step === 3) {
    const cfg = operacaoConfig(essentials.tipologia);
    return (
      <div className="quickchips">
        {cfg.chips.map((o) => (
          <button
            key={o.id}
            className={`chip ${essentials.operacao === o.id ? "active" : ""}`}
            onClick={() => onOperacao(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  if (step === 4) {
    // step 4 (planta) é renderizado pelo PlantaPicker; chips não se aplicam.
    return null;
  }
  if (step === 5) {
    const opts = [
      { m: 6, label: "6 meses · agressivo" },
      { m: 9, label: "9 meses · padrão" },
      { m: 12, label: "12 meses · folgado" },
    ];
    return (
      <div className="quickchips">
        {opts.map((o) => (
          <button
            key={o.m}
            className={`chip ${essentials.prazoMeses === o.m ? "active" : ""}`}
            onClick={() => onPrazo(o.m, o.label)}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  if (step === 6) {
    const opts = [
      { v: 2_500_000, label: "até R$ 2,5 M · econômico" },
      { v: 5_000_000, label: "≈ R$ 5 M · médio" },
      { v: 8_000_000, label: "R$ 8 M+ · alto" },
    ];
    return (
      <div className="quickchips">
        {opts.map((o) => (
          <button
            key={o.v}
            className={`chip ${essentials.orcamentoBRL === o.v ? "active" : ""}`}
            onClick={() => onOrcamento(o.v, o.label)}
          >
            {o.label}
          </button>
        ))}
      </div>
    );
  }
  return null;
}

// ============================================================
// Planta picker
// ============================================================

function PlantaPicker({
  tipologia,
  selected,
  note,
  onSelect,
  onNote,
}: {
  tipologia: Tipologia | undefined;
  selected: PlantaChoice | undefined;
  note: string;
  onSelect: (p: PlantaChoice, note?: string) => void;
  onNote: (note: string) => void;
}) {
  const opts = plantaOptions(tipologia);
  const sel = opts.find((o) => o.id === selected) ?? null;
  return (
    <div className="planta-picker">
      <div className="planta-grid">
        {opts.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`planta-card ${selected === o.id ? "active" : ""}`}
            onClick={() => onSelect(o.id)}
          >
            <div className="planta-diagram">{o.diagram}</div>
            <div className="planta-title">{o.title}</div>
            <div className="planta-short">{o.short}</div>
          </button>
        ))}
      </div>
      {sel && (
        <div className="planta-detail">
          <strong>{sel.title}</strong>
          <p>{sel.detail}</p>
        </div>
      )}
      <label className="planta-note">
        <span>
          Quer descrever melhor? (opção, posicionamento, anexos…)
        </span>
        <textarea
          rows={3}
          value={note}
          onChange={(e) => onNote(e.target.value)}
          placeholder="Ex: prefiro escritório voltado pra rua principal, com janelão; docas do lado norte para evitar incidência solar nas portas; reservar 1.000 m² pra expansão futura…"
        />
      </label>
    </div>
  );
}

function HUDPreview({
  essentials,
  recommendedScale,
  shed,
}: {
  essentials: Essentials;
  recommendedScale: number;
  shed: IndustrialShed | null;
}) {
  const cfg = operacaoConfig(essentials.tipologia);
  const area =
    shed?.estimate?.coveredAreaM2 ?? essentials.escalaM2 ?? recommendedScale;
  const span = shed?.structure?.freeSpan ?? (essentials.tipologia === "industrial" ? 20 : 25);
  const ch =
    shed?.structure?.clearHeight ??
    (essentials.operacao === "tall"
      ? essentials.tipologia === "industrial"
        ? 12
        : 14
      : essentials.tipologia === "industrial"
      ? 9
      : 12);
  const steelT = shed ? (shed.estimate.steelKg / 1000).toFixed(0) : "~142";
  return (
    <div className="hud">
      <div className="hud-row highlight">
        <span>Área constr.</span>
        <strong>{Math.round(area).toLocaleString("pt-BR")} m²</strong>
      </div>
      <div className="hud-row">
        <span>Vão livre</span>
        <strong>{span} m</strong>
      </div>
      <div className="hud-row">
        <span>Pé-direito</span>
        <strong>{ch} m</strong>
      </div>
      <div className="hud-row">
        <span>{cfg.hudLabel}</span>
        <strong>{cfg.hudValue(essentials.operacao, shed?.docks?.length ?? 0)}</strong>
      </div>
      <div className="hud-row">
        <span>Peso aço</span>
        <strong>{steelT} t</strong>
      </div>
    </div>
  );
}
