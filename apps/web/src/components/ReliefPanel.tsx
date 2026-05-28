"use client";

/**
 * ReliefPanel — card de relevo separado, abaixo do mapa (FR-M1).
 * Reaproveita SlopeCard mas com layout dedicado: badges + seção AA'
 * + mini-mapa de curvas (heatmap suave) + CTA Recalcular.
 */
import SlopeCard from "./SlopeCard";
import type { ComponentProps } from "react";

type Props = ComponentProps<typeof SlopeCard>;

export default function ReliefPanel(props: Props) {
  return (
    <section
      className="relief-panel card"
      aria-label="Relevo do terreno"
      style={{
        padding: "var(--space-4)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-sm)",
        background: "var(--color-surface-elevated)",
        marginTop: "var(--space-4)",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: "var(--fs-md)" }}>Relevo</h2>
          <p className="text-sm muted" style={{ margin: "4px 0 0" }}>
            Análise topográfica do polígono — seção AA&apos; e estimativa de
            terraplenagem.
          </p>
        </div>
      </header>
      <SlopeCard {...props} />
    </section>
  );
}
