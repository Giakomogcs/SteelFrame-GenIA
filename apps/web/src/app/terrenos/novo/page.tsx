"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TerrainMap from "@/components/TerrainMap";
import type { LngLat } from "@/lib/geo";
import { polygonCenter } from "@/lib/geo";
import { Breadcrumb } from "@/components/Breadcrumb";

export default function NewTerrainPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [address, setAddress] = useState("");
  const [polygon, setPolygon] = useState<LngLat[]>([]);
  const [area, setArea] = useState(0);
  const [areaErrors, setAreaErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Quando o mapa resolve um endereço (busca ou reverse-geocoding), preenche
   *  o campo de endereço e — se o usuário ainda não tocou no nome — deriva
   *  um nome curto a partir das duas primeiras partes (ex.: "Rua X, 123 · Bairro"). */
  function handleAddressResolved(full: string) {
    setAddress(full);
    if (!nameTouched) {
      const parts = full.split(",").map((p) => p.trim()).filter(Boolean);
      const short = parts.slice(0, 2).join(" · ");
      setName(short || full);
    }
  }

  async function handleSave() {
    if (polygon.length < 3) {
      setError("Desenhe o terreno no mapa (mín. 3 vértices).");
      return;
    }
    if (areaErrors.length > 0) {
      setError(areaErrors.join(" · "));
      return;
    }
    if (!name.trim()) {
      setError("Dê um nome ao terreno.");
      return;
    }
    setSaving(true);
    setError(null);
    const [centerLng, centerLat] = polygonCenter(polygon);
    try {
      const res = await fetch("/api/terrenos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          address,
          polygon,
          centerLng,
          centerLat,
          areaM2: area,
        }),
      });
      if (!res.ok) throw new Error("Falha ao salvar");
      const json = (await res.json()) as { id: string };
      router.push(`/terrenos/${json.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const canSave =
    polygon.length >= 3 &&
    name.trim().length > 0 &&
    areaErrors.length === 0 &&
    !saving;

  return (
    <>
      <header className="page-header">
        <div className="stack-sm">
          <Breadcrumb
            items={[
              { label: "Meus terrenos", href: "/" },
              { label: "Novo terreno" },
            ]}
          />
          <div className="page-title-row">
            <h1>Cadastrar novo terreno</h1>
            <span className="pill pill-primary">
              <span className="dot" />
              Passo 1 · Geometria
            </span>
          </div>
          <p className="text-sm muted" style={{ maxWidth: "64ch" }}>
            Busque o endereço no mapa, clique para marcar cada vértice e feche o
            polígono. A área é calculada automaticamente.
          </p>
        </div>
        <div className="row">
          <Link href="/" className="btn btn-secondary">
            Cancelar
          </Link>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="btn btn-primary"
          >
            {saving ? "Salvando…" : "Salvar terreno"}
          </button>
        </div>
      </header>

      {/* Stepper */}
      <div className="stepper">
        <div className="step active">
          <span className="step-num">1</span>
          Geometria do lote
        </div>
        <div className="step-divider" />
        <div className="step">
          <span className="step-num">2</span>
          Briefing com IA
        </div>
        <div className="step-divider" />
        <div className="step">
          <span className="step-num">3</span>
          Modelo 3D + relatório
        </div>
      </div>

      <div className="grid-2-1">
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <TerrainMap
            onChange={(p, a, errs) => {
              setPolygon(p);
              setArea(a);
              setAreaErrors(errs ?? []);
            }}
            onAddressResolved={handleAddressResolved}
          />
        </div>

        <div className="stack">
          <div className="card">
            <div className="card-title">Identificação</div>
            <div className="card-subtitle">
              Dê um nome reconhecível e o endereço (opcional).
            </div>
            <div className="stack">
              <div className="field">
                <label>
                  Nome do terreno <span className="req">*</span>
                </label>
                <input
                  className="input"
                  placeholder="Auto-preenchido com o endereço (editável)"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setNameTouched(true);
                  }}
                />
              </div>
              <div className="field">
                <label>Endereço (opcional)</label>
                <input
                  className="input"
                  placeholder="Rua, número, bairro, cidade"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">Métricas do lote</div>
            <div className="card-subtitle">
              Atualizadas em tempo real conforme você desenha.
            </div>
            <div className="grid-2">
              <div className="kpi">
                <div className="kpi-label">Área</div>
                <div className="kpi-value">
                  {Math.round(area).toLocaleString("pt-BR")}
                  <span className="unit">m²</span>
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Vértices</div>
                <div className="kpi-value">
                  {polygon.length}
                  <span className="unit">pts</span>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="toast toast-danger">
              <div>
                <div className="toast-title">Não foi possível salvar</div>
                <div className="toast-desc">{error}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
