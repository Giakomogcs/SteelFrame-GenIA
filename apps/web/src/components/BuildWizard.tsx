"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WizardParams } from "@/lib/steelframe";

const defaults: WizardParams = {
  material: "steel-frame-light",
  budget: 1_500_000,
  occupancyRate: 0.7,
  height: 8,
  bayDepth: 6,
  roofPitchDeg: 10,
  doors: 2,
  mezzanine: false,
};

interface Props {
  terrainId: string;
}

export function BuildWizard({ terrainId }: Props) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardParams>(defaults);
  const [name, setName] = useState("Galpão 01");
  const [loadingAI, setLoadingAI] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof WizardParams>(k: K, v: WizardParams[K]) =>
    setData((d) => ({ ...d, [k]: v }));

  const steps = ["Identificação", "Material & Orçamento", "Geometria", "Revisão"];

  async function suggestWithAI() {
    setLoadingAI(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terrainId, current: data }),
      });
      if (!res.ok) throw new Error("Falha na sugestão");
      const json = (await res.json()) as Partial<WizardParams>;
      setData((d) => ({ ...d, ...json }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingAI(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/terrenos/${terrainId}/construcoes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, params: data }),
      });
      if (!res.ok) throw new Error("Falha ao gerar construção");
      const json = (await res.json()) as { id: string };
      router.push(`/terrenos/${terrainId}/construcoes/${json.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 rounded-xl border border-white/10 bg-slate-900/60 p-6">
      <ol className="flex flex-wrap gap-3 text-xs">
        {steps.map((s, i) => (
          <li
            key={s}
            className={`rounded-full px-3 py-1 ${
              i === step
                ? "bg-brand-600 text-white"
                : i < step
                  ? "bg-emerald-600/30 text-emerald-300"
                  : "bg-white/5 text-slate-400"
            }`}
          >
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-3">
          <Field label="Nome da construção">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
            />
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Material">
            <select
              value={data.material}
              onChange={(e) => update("material", e.target.value as WizardParams["material"])}
              className={inputCls}
            >
              <option value="steel-frame-light">Steel frame leve (logístico)</option>
              <option value="steel-frame-heavy">Steel frame pesado (industrial)</option>
              <option value="hybrid">Híbrido (steel + concreto)</option>
            </select>
          </Field>
          <Field label={`Orçamento: R$ ${data.budget.toLocaleString("pt-BR")}`}>
            <input
              type="range"
              min={300_000}
              max={20_000_000}
              step={50_000}
              value={data.budget}
              onChange={(e) => update("budget", Number(e.target.value))}
              className="w-full"
            />
          </Field>
          <Field label="Mezanino">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={data.mezzanine}
                onChange={(e) => update("mezzanine", e.target.checked)}
              />{" "}
              Incluir pavimento mezanino
            </label>
          </Field>
          <Field label="Portões frontais">
            <input
              type="number"
              min={1}
              max={10}
              value={data.doors}
              onChange={(e) => update("doors", Number(e.target.value))}
              className={inputCls}
            />
          </Field>
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`Taxa de ocupação: ${Math.round(data.occupancyRate * 100)}%`}>
            <input
              type="range"
              min={0.2}
              max={0.95}
              step={0.05}
              value={data.occupancyRate}
              onChange={(e) => update("occupancyRate", Number(e.target.value))}
              className="w-full"
            />
          </Field>
          <Field label="Pé direito (m)">
            <input
              type="number"
              min={4}
              max={20}
              step={0.5}
              value={data.height}
              onChange={(e) => update("height", Number(e.target.value))}
              className={inputCls}
            />
          </Field>
          <Field label="Espaçamento entre pórticos (m)">
            <input
              type="number"
              min={3}
              max={12}
              step={0.5}
              value={data.bayDepth}
              onChange={(e) => update("bayDepth", Number(e.target.value))}
              className={inputCls}
            />
          </Field>
          <Field label="Inclinação do telhado (°)">
            <input
              type="number"
              min={3}
              max={30}
              step={1}
              value={data.roofPitchDeg}
              onChange={(e) => update("roofPitchDeg", Number(e.target.value))}
              className={inputCls}
            />
          </Field>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-2 text-sm">
          <Row k="Nome" v={name} />
          <Row k="Material" v={data.material} />
          <Row k="Orçamento" v={`R$ ${data.budget.toLocaleString("pt-BR")}`} />
          <Row k="Ocupação" v={`${Math.round(data.occupancyRate * 100)}%`} />
          <Row k="Pé direito" v={`${data.height} m`} />
          <Row k="Pórticos" v={`${data.bayDepth} m`} />
          <Row k="Telhado" v={`${data.roofPitchDeg}°`} />
          <Row k="Portões" v={data.doors} />
          <Row k="Mezanino" v={data.mezzanine ? "Sim" : "Não"} />
        </div>
      )}

      {error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <button
          type="button"
          onClick={suggestWithAI}
          disabled={loadingAI}
          className="rounded-md border border-brand-500/50 px-3 py-2 text-sm text-brand-300 hover:bg-brand-500/10 disabled:opacity-50"
        >
          {loadingAI ? "Consultando IA…" : "✨ Sugerir com IA"}
        </button>

        <div className="flex gap-2">
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="rounded-md bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
            >
              Voltar
            </button>
          )}
          {step < steps.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium hover:bg-brand-500"
            >
              Próximo
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
            >
              {submitting ? "Gerando 3D…" : "Gerar modelo 3D"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-brand-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b border-white/5 py-1">
      <span className="text-slate-400">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
