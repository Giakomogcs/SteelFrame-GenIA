"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  computeEarthworksOptions,
  type EarthworksOption,
  type EarthworksKey,
} from "@/lib/geo";

/** Forma persistida em terrain.elevationProfile (Json). */
type StoredProfile =
  | { d: number; h: number }[]
  | {
      profile: { d: number; h: number }[];
      earthworksOptions?: EarthworksOption[];
      earthworksRecommended?: EarthworksKey;
    }
  | null;

interface Analysis {
  slopePct: number;
  elevationDelta: number;
  elevationMean: number;
  classification: "plano" | "suave" | "moderado" | "acentuado";
  needsLeveling: boolean;
  earthworksM3: number;
  profile: { d: number; h: number }[];
  earthworksOptions?: EarthworksOption[];
  earthworksRecommended?: EarthworksKey;
}

interface Props {
  terrainId: string;
  areaM2: number;
  initial: {
    slopePct: number | null;
    elevationDelta: number | null;
    elevationMean: number | null;
    /** Conteúdo cru de terrain.elevationProfile (Json) — pode ser array legado
     *  ou objeto novo com profile + earthworksOptions. */
    profile: StoredProfile;
  };
}

const CLASS_LABEL: Record<Analysis["classification"], string> = {
  plano: "Plano",
  suave: "Suave",
  moderado: "Moderado",
  acentuado: "Acentuado",
};
const CLASS_PILL: Record<Analysis["classification"], string> = {
  plano: "pill-success",
  suave: "pill-success",
  moderado: "pill-warning",
  acentuado: "pill-danger",
};

function classifyFromPct(p: number): Analysis["classification"] {
  if (p < 2) return "plano";
  if (p < 5) return "suave";
  if (p < 10) return "moderado";
  return "acentuado";
}

/**
 * Normaliza o conteúdo persistido em terrain.elevationProfile.
 * - Formato novo: { profile, earthworksOptions, earthworksRecommended }.
 * - Formato legado: array puro [{ d, h }, ...] (recalculado com a função
 *   antiga — números são imprecisos até o próximo "Recalcular").
 */
function hydrateFromStored(stored: StoredProfile, areaM2: number) {
  if (!stored) return { profile: [] as { d: number; h: number }[] };
  if (Array.isArray(stored)) {
    if (stored.length < 2) return { profile: stored };
    const legacy = computeEarthworksOptions(stored, areaM2);
    return {
      profile: stored,
      earthworksOptions: legacy.options,
      earthworksRecommended: legacy.recommended,
    };
  }
  return {
    profile: stored.profile ?? [],
    earthworksOptions: stored.earthworksOptions,
    earthworksRecommended: stored.earthworksRecommended,
  };
}

export default function SlopeCard({ terrainId, areaM2, initial }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(() => {
    if (initial.slopePct == null) return null;
    const hydrated = hydrateFromStored(initial.profile, areaM2);
    const rec = hydrated.earthworksOptions?.find(
      (o) => o.key === hydrated.earthworksRecommended,
    );
    return {
      slopePct: initial.slopePct,
      elevationDelta: initial.elevationDelta ?? 0,
      elevationMean: initial.elevationMean ?? 0,
      classification: classifyFromPct(initial.slopePct),
      needsLeveling:
        initial.slopePct > 3 || (initial.elevationDelta ?? 0) > 1.5,
      earthworksM3: rec ? rec.cutM3 + rec.fillM3 : 0,
      profile: hydrated.profile,
      earthworksOptions: hydrated.earthworksOptions,
      earthworksRecommended: hydrated.earthworksRecommended,
    };
  });

  async function fetchSlope() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/terrenos/${terrainId}/slope`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setAnalysis(json.analysis);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const recommended = analysis?.earthworksOptions?.find(
    (o) => o.key === analysis.earthworksRecommended,
  );

  return (
    <div className="slope-card">
      <div className="slope-head">
        <div>
          <div className="slope-tag">Relevo e terraplenagem</div>
          <div className="slope-title">
            {analysis
              ? `${analysis.slopePct.toFixed(2)} %`
              : "Inclinação não medida"}
          </div>
        </div>
        <div className="slope-actions">
          {analysis && (
            <span className={`pill ${CLASS_PILL[analysis.classification]}`}>
              <span className="dot" />
              {CLASS_LABEL[analysis.classification]}
            </span>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={fetchSlope}
            disabled={loading}
          >
            {loading
              ? "Consultando…"
              : analysis
                ? "Recalcular"
                : "Medir relevo"}
          </button>
        </div>
      </div>

      {analysis && (
        <>
          <div className="slope-stats">
            <div className="slope-stat">
              <span className="slope-stat-lbl">Desnível</span>
              <strong>{analysis.elevationDelta.toFixed(2)} m</strong>
            </div>
            <div className="slope-stat">
              <span className="slope-stat-lbl">Altitude média</span>
              <strong>{analysis.elevationMean.toFixed(1)} m</strong>
            </div>
            <div className="slope-stat">
              <span className="slope-stat-lbl">Terraplenagem</span>
              <strong>
                {recommended
                  ? `≈ ${(recommended.cutM3 + recommended.fillM3).toLocaleString("pt-BR")} m³`
                  : "—"}
              </strong>
            </div>
            <div className="slope-stat">
              <span className="slope-stat-lbl">Custo estimado</span>
              <strong>
                {recommended
                  ? `R$ ${(recommended.totalCost / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} k`
                  : "—"}
              </strong>
            </div>
          </div>

          {analysis.profile.length > 1 && (
            <ProfileChart
              profile={analysis.profile}
              platformH={recommended?.platformH}
            />
          )}

          {analysis.earthworksOptions && (
            <EarthworksGrid
              options={analysis.earthworksOptions}
              recommended={analysis.earthworksRecommended ?? "balanced"}
            />
          )}

          <div
            className={`slope-banner ${analysis.needsLeveling ? "warn" : "ok"}`}
          >
            {analysis.needsLeveling ? (
              <>
                <strong>⚠ Terraplenagem recomendada.</strong> Inclinação{" "}
                {analysis.slopePct.toFixed(2)} % e desnível de{" "}
                {analysis.elevationDelta.toFixed(2)} m exigem corte/aterro. A
                opção mais barata está destacada acima e já entra no orçamento
                que a IA gera.
              </>
            ) : (
              <>
                <strong>✓ Terreno aceita laje direta.</strong> Inclinação dentro
                do limite prático (≤ 3 %) — basta regularização superficial.
              </>
            )}
          </div>
        </>
      )}

      {error && (
        <div className="toast toast-danger" style={{ marginTop: 12 }}>
          <div>
            <div className="toast-title">Erro</div>
            <div className="toast-desc">{error}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Cartões de comparação corte / aterro / compensado
// ============================================================

function fmtR$(n: number) {
  return n >= 1_000_000
    ? `R$ ${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} M`
    : `R$ ${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} k`;
}

function EarthworksGrid({
  options,
  recommended,
}: {
  options: EarthworksOption[];
  recommended: EarthworksKey;
}) {
  return (
    <div className="earth-grid">
      {options.map((o) => {
        const isReco = o.key === recommended;
        return (
          <div
            key={o.key}
            className={`earth-opt${isReco ? " earth-opt-reco" : ""}`}
          >
            <div className="earth-opt-head">
              <span className="earth-opt-label">{o.label}</span>
              {isReco && (
                <span className="pill pill-success">
                  <span className="dot" />
                  Mais barata
                </span>
              )}
            </div>
            <div className="earth-opt-cost">{fmtR$(o.totalCost)}</div>
            <div className="earth-opt-rows">
              <div>
                <span className="earth-opt-lbl">Corte</span>
                <span className="earth-opt-val">
                  {o.cutM3.toLocaleString("pt-BR")} m³
                </span>
              </div>
              <div>
                <span className="earth-opt-lbl">Aterro</span>
                <span className="earth-opt-val">
                  {o.fillM3.toLocaleString("pt-BR")} m³
                </span>
              </div>
              <div>
                <span className="earth-opt-lbl">R$/m³</span>
                <span className="earth-opt-val">{o.unitCost}</span>
              </div>
            </div>
            <div className="earth-opt-desc">{o.description}</div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Gráfico AA' melhorado — grid, eixos, sombreado cut/fill
// ============================================================

/**
 * Rampa hipsométrica padrão (azul-mar → verde → amarelo → laranja → marrom
 * → branco), usada em mapas topográficos. Interpolação RGB linear.
 * Entrada: t ∈ [0, 1], onde 0 = ponto mais baixo do perfil, 1 = mais alto.
 */
const ELEV_STOPS: Array<{ t: number; rgb: [number, number, number] }> = [
  { t: 0.0, rgb: [27, 102, 156] }, // água/baixada — azul
  { t: 0.15, rgb: [56, 148, 232] }, // azul claro
  { t: 0.3, rgb: [42, 145, 84] }, // verde mata
  { t: 0.5, rgb: [206, 196, 90] }, // amarelo savana
  { t: 0.7, rgb: [192, 124, 56] }, // laranja terra
  { t: 0.85, rgb: [134, 76, 36] }, // marrom
  { t: 1.0, rgb: [240, 232, 220] }, // pico — quase branco
];

function elevColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < ELEV_STOPS.length; i++) {
    const a = ELEV_STOPS[i - 1];
    const b = ELEV_STOPS[i];
    if (x <= b.t) {
      const k = (x - a.t) / Math.max(1e-9, b.t - a.t);
      const r = Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * k);
      const g = Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * k);
      const bl = Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * k);
      return `rgb(${r},${g},${bl})`;
    }
  }
  const last = ELEV_STOPS[ELEV_STOPS.length - 1].rgb;
  return `rgb(${last[0]},${last[1]},${last[2]})`;
}

function ProfileChart({
  profile,
  platformH,
}: {
  profile: { d: number; h: number }[];
  platformH?: number;
}) {
  const W = 960;
  const H = 260;
  const padL = 56;
  const padR = 64; // espaço reservado p/ legenda da escala de relevo
  const padT = 20;
  const padB = 36;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const [hover, setHover] = useState<{
    i: number;
    cx: number;
    cy: number;
  } | null>(null);

  const dMin = profile[0].d;
  const dMax = profile[profile.length - 1].d;
  const hs = profile.map((p) => p.h);
  const hMinRaw = Math.min(...hs);
  const hMaxRaw = Math.max(...hs);
  const span = Math.max(2, hMaxRaw - hMinRaw);
  // padding vertical para não colar no topo/base
  const hMin = hMinRaw - span * 0.1;
  const hMax = hMaxRaw + span * 0.1;
  const hRange = hMax - hMin;

  const x = (d: number) =>
    padL + ((d - dMin) / Math.max(1, dMax - dMin)) * innerW;
  const y = (h: number) => padT + (1 - (h - hMin) / hRange) * innerH;

  const linePath = profile
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${x(p.d).toFixed(1)},${y(p.h).toFixed(1)}`,
    )
    .join(" ");

  // 5 gridlines horizontais
  const gridLines = Array.from({ length: 5 }, (_, i) => {
    const h = hMin + (hRange * i) / 4;
    return { h, y: y(h) };
  });

  // sombreado de corte (acima da plataforma) e aterro (abaixo)
  let cutPath: string | null = null;
  let fillPath: string | null = null;
  if (platformH != null) {
    const yP = y(platformH);
    cutPath =
      `M${x(dMin).toFixed(1)},${yP.toFixed(1)} ` +
      profile
        .map(
          (p) =>
            `L${x(p.d).toFixed(1)},${y(Math.max(p.h, platformH)).toFixed(1)}`,
        )
        .join(" ") +
      ` L${x(dMax).toFixed(1)},${yP.toFixed(1)} Z`;
    fillPath =
      `M${x(dMin).toFixed(1)},${yP.toFixed(1)} ` +
      profile
        .map(
          (p) =>
            `L${x(p.d).toFixed(1)},${y(Math.min(p.h, platformH)).toFixed(1)}`,
        )
        .join(" ") +
      ` L${x(dMax).toFixed(1)},${yP.toFixed(1)} Z`;
  }

  return (
    <div className="slope-chart-wrap">
      <svg
        className="slope-chart"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Perfil AA' com plataforma recomendada"
        onMouseLeave={() => setHover(null)}
      >
        {/*
          Gradiente vertical alinhado ao eixo Y: como Y = elevação,
          cada pixel da curva fica tingido pela rampa hipsométrica.
          Topo do gráfico = pico (claro) / base = vale (azul).
        */}
        <defs>
          <linearGradient
            id="elevRamp"
            x1={0}
            y1={padT}
            x2={0}
            y2={padT + innerH}
            gradientUnits="userSpaceOnUse"
          >
            {ELEV_STOPS.map((s) => (
              <stop
                key={s.t}
                offset={`${(1 - s.t) * 100}%`}
                stopColor={`rgb(${s.rgb[0]},${s.rgb[1]},${s.rgb[2]})`}
              />
            ))}
          </linearGradient>
        </defs>
        <rect
          x={padL}
          y={padT}
          width={innerW}
          height={innerH}
          fill="rgba(255,255,255,0.015)"
        />
        {gridLines.map((g, i) => (
          <g key={i}>
            <line
              x1={padL}
              y1={g.y}
              x2={padL + innerW}
              y2={g.y}
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={1}
            />
            <text
              x={padL - 6}
              y={g.y + 3}
              fontSize={11}
              textAnchor="end"
              fill="rgba(255,255,255,0.55)"
              fontFamily="ui-monospace, monospace"
            >
              {g.h.toFixed(0)} m
            </text>
          </g>
        ))}

        {cutPath && <path d={cutPath} fill="rgba(215,32,66,0.22)" />}
        {fillPath && <path d={fillPath} fill="rgba(56,148,232,0.22)" />}

        <path
          d={linePath}
          fill="none"
          stroke="url(#elevRamp)"
          strokeWidth={2.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {profile.map((p, i) => {
          const t = (p.h - hMinRaw) / Math.max(1e-6, hMaxRaw - hMinRaw);
          return (
            <circle
              key={i}
              cx={x(p.d)}
              cy={y(p.h)}
              r={3.5}
              fill={elevColor(t)}
              stroke="rgba(0,0,0,0.45)"
              strokeWidth={0.8}
            />
          );
        })}

        {platformH != null && (
          <>
            <line
              x1={padL}
              y1={y(platformH)}
              x2={padL + innerW}
              y2={y(platformH)}
              stroke="#17A34A"
              strokeWidth={1.6}
              strokeDasharray="5 4"
            />
            <text
              x={padL + innerW - 4}
              y={y(platformH) - 6}
              fontSize={11}
              textAnchor="end"
              fill="#17A34A"
              fontFamily="ui-monospace, monospace"
            >
              plataforma {platformH.toFixed(1)} m
            </text>
          </>
        )}

        <line
          x1={padL}
          y1={padT + innerH}
          x2={padL + innerW}
          y2={padT + innerH}
          stroke="rgba(255,255,255,0.18)"
        />

        {/* Legenda da rampa hipsométrica */}
        {(() => {
          const lx = padL + innerW + 16;
          const lw = 12;
          return (
            <g>
              <rect
                x={lx}
                y={padT}
                width={lw}
                height={innerH}
                fill="url(#elevRamp)"
                stroke="rgba(255,255,255,0.18)"
                strokeWidth={0.5}
                rx={2}
              />
              <text
                x={lx + lw + 4}
                y={padT + 8}
                fontSize={10}
                fill="rgba(255,255,255,0.65)"
                fontFamily="ui-monospace, monospace"
              >
                {hMaxRaw.toFixed(0)} m
              </text>
              <text
                x={lx + lw + 4}
                y={padT + innerH}
                fontSize={10}
                fill="rgba(255,255,255,0.65)"
                fontFamily="ui-monospace, monospace"
              >
                {hMinRaw.toFixed(0)} m
              </text>
              <text
                x={lx + lw / 2}
                y={padT + innerH + 18}
                fontSize={10}
                textAnchor="middle"
                fill="rgba(255,255,255,0.55)"
                fontFamily="ui-monospace, monospace"
              >
                relevo
              </text>
            </g>
          );
        })()}
        <text
          x={padL}
          y={H - 10}
          fontSize={12}
          fill="rgba(255,255,255,0.65)"
          fontFamily="ui-monospace, monospace"
        >
          A
        </text>
        <text
          x={padL + innerW}
          y={H - 10}
          fontSize={12}
          textAnchor="end"
          fill="rgba(255,255,255,0.65)"
          fontFamily="ui-monospace, monospace"
        >
          A&apos; · {Math.round(dMax - dMin)} m
        </text>

        <g transform={`translate(${padL + 8}, ${padT + 8})`}>
          <rect width={12} height={12} fill="rgba(215,32,66,0.45)" rx={2} />
          <text
            x={18}
            y={10}
            fontSize={11}
            fill="rgba(255,255,255,0.75)"
            fontFamily="ui-monospace, monospace"
          >
            corte
          </text>
          <rect
            x={70}
            width={12}
            height={12}
            fill="rgba(56,148,232,0.45)"
            rx={2}
          />
          <text
            x={88}
            y={10}
            fontSize={11}
            fill="rgba(255,255,255,0.75)"
            fontFamily="ui-monospace, monospace"
          >
            aterro
          </text>
        </g>

        {/* Hit areas para hover por amostra */}
        {profile.map((p, i) => {
          const cx = x(p.d);
          const cy = y(p.h);
          const prevX = i === 0 ? cx : (cx + x(profile[i - 1].d)) / 2;
          const nextX =
            i === profile.length - 1 ? cx : (cx + x(profile[i + 1].d)) / 2;
          return (
            <rect
              key={`hit-${i}`}
              x={prevX}
              y={padT}
              width={Math.max(1, nextX - prevX)}
              height={innerH}
              fill="transparent"
              style={{ cursor: "crosshair" }}
              onMouseEnter={() => setHover({ i, cx, cy })}
            />
          );
        })}

        {hover && (
          <g pointerEvents="none">
            <line
              x1={hover.cx}
              y1={padT}
              x2={hover.cx}
              y2={padT + innerH}
              stroke="rgba(255,255,255,0.35)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle
              cx={hover.cx}
              cy={hover.cy}
              r={5}
              fill="#fff"
              stroke={elevColor(
                (profile[hover.i].h - hMinRaw) /
                  Math.max(1e-6, hMaxRaw - hMinRaw),
              )}
              strokeWidth={2}
            />
          </g>
        )}
      </svg>

      {hover &&
        (() => {
          const p = profile[hover.i];
          const delta = platformH != null ? p.h - platformH : null;
          const action =
            delta == null
              ? null
              : delta > 0.05
                ? { label: "corte", color: "#D72042", value: delta }
                : delta < -0.05
                  ? { label: "aterro", color: "#3894E8", value: -delta }
                  : { label: "no nível", color: "#17A34A", value: 0 };
          // Posicionar tooltip relativo à largura do SVG (percentual)
          const leftPct = (hover.cx / W) * 100;
          return (
            <div
              className="slope-tooltip"
              style={{
                left: `${leftPct}%`,
                transform:
                  leftPct > 75
                    ? "translate(-100%, -50%)"
                    : leftPct < 25
                      ? "translate(0%, -50%)"
                      : "translate(-50%, -50%)",
              }}
            >
              <div className="slope-tooltip-row">
                <span className="slope-tooltip-lbl">Distância</span>
                <strong>{p.d.toFixed(0)} m</strong>
              </div>
              <div className="slope-tooltip-row">
                <span className="slope-tooltip-lbl">Altitude</span>
                <strong>{p.h.toFixed(2)} m</strong>
              </div>
              {action && (
                <div className="slope-tooltip-row">
                  <span className="slope-tooltip-lbl">vs. plataforma</span>
                  <strong style={{ color: action.color }}>
                    {action.value > 0 ? `${action.value.toFixed(2)} m` : "—"}{" "}
                    <span style={{ opacity: 0.7, fontWeight: 400 }}>
                      {action.label}
                    </span>
                  </strong>
                </div>
              )}
            </div>
          );
        })()}
    </div>
  );
}
