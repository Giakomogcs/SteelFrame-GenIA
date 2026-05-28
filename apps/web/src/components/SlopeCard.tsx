"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Analysis {
  slopePct: number;
  elevationDelta: number;
  elevationMean: number;
  classification: "plano" | "suave" | "moderado" | "acentuado";
  needsLeveling: boolean;
  earthworksM3: number;
  profile: { d: number; h: number }[];
}

interface Props {
  terrainId: string;
  initial: {
    slopePct: number | null;
    elevationDelta: number | null;
    elevationMean: number | null;
    profile: { d: number; h: number }[] | null;
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

export default function SlopeCard({ terrainId, initial }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(
    initial.slopePct != null
      ? {
          slopePct: initial.slopePct,
          elevationDelta: initial.elevationDelta ?? 0,
          elevationMean: initial.elevationMean ?? 0,
          classification: classifyFromPct(initial.slopePct),
          needsLeveling: initial.slopePct > 3 || (initial.elevationDelta ?? 0) > 1.5,
          earthworksM3: 0,
          profile: initial.profile ?? [],
        }
      : null,
  );

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
              : "Medir relevo (open-elevation)"}
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
                {analysis.needsLeveling
                  ? `≈ ${analysis.earthworksM3.toLocaleString("pt-BR")} m³`
                  : "não necessária"}
              </strong>
            </div>
          </div>

          {analysis.profile.length > 1 && (
            <ProfileChart profile={analysis.profile} />
          )}

          <div
            className={`slope-banner ${
              analysis.needsLeveling ? "warn" : "ok"
            }`}
          >
            {analysis.needsLeveling ? (
              <>
                <strong>⚠ Terraplenagem recomendada.</strong> Inclinação{" "}
                {analysis.slopePct.toFixed(2)} % e desnível de{" "}
                {analysis.elevationDelta.toFixed(2)} m exigem corte/aterro para
                receber a laje do galpão. A IA já considera isso no orçamento.
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

function ProfileChart({ profile }: { profile: { d: number; h: number }[] }) {
  const W = 520;
  const H = 110;
  const padL = 32;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const dMin = profile[0].d;
  const dMax = profile[profile.length - 1].d;
  const hs = profile.map((p) => p.h);
  const hMin = Math.min(...hs);
  const hMax = Math.max(...hs);
  const hRange = Math.max(0.5, hMax - hMin); // evita div/0 em terreno plano
  const x = (d: number) =>
    padL + ((d - dMin) / Math.max(1, dMax - dMin)) * innerW;
  const y = (h: number) => padT + (1 - (h - hMin) / hRange) * innerH;
  const linePath = profile
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.d).toFixed(1)},${y(p.h).toFixed(1)}`)
    .join(" ");
  const areaPath =
    `M${x(dMin).toFixed(1)},${(padT + innerH).toFixed(1)} ` +
    profile
      .map((p) => `L${x(p.d).toFixed(1)},${y(p.h).toFixed(1)}`)
      .join(" ") +
    ` L${x(dMax).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;
  return (
    <svg
      className="slope-chart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Perfil AA'"
    >
      <path d={areaPath} fill="rgba(215,32,66,0.16)" />
      <path d={linePath} fill="none" stroke="#D72042" strokeWidth={1.5} />
      {profile.map((p, i) => (
        <circle key={i} cx={x(p.d)} cy={y(p.h)} r={2} fill="#D72042" />
      ))}
      <text x={padL} y={H - 6} fontSize={9} fill="rgba(255,255,255,0.5)">
        A
      </text>
      <text
        x={W - padR}
        y={H - 6}
        fontSize={9}
        textAnchor="end"
        fill="rgba(255,255,255,0.5)"
      >
        A&apos; · {Math.round(dMax - dMin)} m
      </text>
      <text x={2} y={padT + 4} fontSize={9} fill="rgba(255,255,255,0.5)">
        {hMax.toFixed(0)} m
      </text>
      <text
        x={2}
        y={padT + innerH}
        fontSize={9}
        fill="rgba(255,255,255,0.5)"
      >
        {hMin.toFixed(0)} m
      </text>
    </svg>
  );
}
