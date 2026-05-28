"use client";

import { useEffect, useRef } from "react";

export interface StepDef {
  id: string;
  label: string;
  description?: string;
}

interface Props {
  steps: StepDef[];
  /** Zero-based index of the active step. */
  current: number;
  /** Zero-based index of the furthest step the user has reached (unlocked). */
  furthest: number;
  onChange: (next: number) => void;
}

/**
 * Horizontal accessible stepper (FR-W1). Roving-tabindex with arrow keys,
 * `aria-current="step"` on the active node, locked steps non-interactive.
 */
export function BriefingStepper({ steps, current, furthest, onChange }: Props) {
  const containerRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const node = containerRef.current?.querySelector<HTMLButtonElement>(
      `[data-step-index="${current}"]`,
    );
    node?.focus({ preventScroll: true });
  }, [current]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = Math.min(furthest, current + 1);
      if (next !== current) onChange(next);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const next = Math.max(0, current - 1);
      if (next !== current) onChange(next);
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onChange(furthest);
    }
  }

  const progress = steps.length > 1 ? (current / (steps.length - 1)) * 100 : 0;

  return (
    <nav aria-label="Etapas do briefing" className="briefing-stepper">
      <div
        className="briefing-stepper__progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={current + 1}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      <ol
        ref={containerRef}
        onKeyDown={handleKey}
        className="briefing-stepper__list"
      >
        {steps.map((s, i) => {
          const state =
            i === current
              ? "current"
              : i < current
                ? "done"
                : i <= furthest
                  ? "available"
                  : "locked";
          const disabled = state === "locked";
          return (
            <li
              key={s.id}
              className={`briefing-stepper__item briefing-stepper__item--${state}`}
            >
              <button
                type="button"
                data-step-index={i}
                aria-current={i === current ? "step" : undefined}
                aria-disabled={disabled}
                disabled={disabled}
                tabIndex={i === current ? 0 : -1}
                onClick={() => !disabled && onChange(i)}
                className="briefing-stepper__btn"
              >
                <span className="briefing-stepper__bullet" aria-hidden="true">
                  {state === "done" ? "✓" : i + 1}
                </span>
                <span className="briefing-stepper__label">
                  <span className="briefing-stepper__title">{s.label}</span>
                  {s.description && (
                    <span className="briefing-stepper__sub">{s.description}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
