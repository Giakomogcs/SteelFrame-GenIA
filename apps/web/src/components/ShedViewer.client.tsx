"use client";

/**
 * ShedViewer.client.tsx
 * --------------------------------------------------------------
 * Visualizador 3D paramétrico do galpão (réplica funcional do
 * protótipo `Steel-Frame/viewer-3d.html`).
 *
 *  • 6 camadas construtivas agrupadas (L1 fundação → L6 cobertura)
 *  • Layer-rail à esquerda com isolate / toggle visibility
 *  • Modo "Explodir" (0–120) com stagger por camada
 *  • Ambiente (Satélite/Relevo/Ruas/Off) + opacidade
 *  • HUD com peso de aço, custo, área, vão·pé-direito
 *  • Anotações de cotagem nas faces frente/lateral
 *  • Presets de câmera (planta/frente/lado/iso)
 *  • Atalho Esc para sair do modo isolado
 */

import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid, Html } from "@react-three/drei";
import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "react";
import type { IndustrialShed } from "@/lib/shedSchema";
import type { LngLat } from "@/lib/geo";
import {
  deriveLayers,
  LAYER_COLOR,
  EXPLODE_OFFSET,
  LAYER_ORDER,
  type LayerId,
  type LayerSpec,
} from "@/lib/shedLayers";

interface Props {
  shed: IndustrialShed;
  polygon?: LngLat[];
  height?: string;
  /** Modo compacto: esconde overlays (layer-rail, hud, env-control, bottom bar, FAB). Usado em previews dentro de outras pages. */
  compact?: boolean;
}

type EnvMode = "satellite" | "relief" | "streets" | "off";
type ViewPreset = "iso" | "plan" | "front" | "side";

const BRL = (n: number) =>
  n >= 1_000_000
    ? `R$ ${(n / 1_000_000).toFixed(2).replace(".", ",")} M`
    : n >= 1_000
      ? `R$ ${Math.round(n / 1_000)} mil`
      : `R$ ${n.toFixed(0)}`;

const fmtInt = (n: number) =>
  n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

// =============================================================
// CENA 3D
// =============================================================

function LayerGroup({
  layer,
  visible,
  isolated,
  explode,
  xray = false,
  children,
}: {
  layer: LayerId;
  visible: boolean;
  isolated: LayerId | null;
  explode: number;
  xray?: boolean;
  children: React.ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const offset = EXPLODE_OFFSET[layer];
  const targetY = (explode / 120) * offset * 6;
  // Raio-X: cobertura e vedação ficam translúcidas para ver a estrutura
  // interna (treliças, colunas, mezanino). Outras camadas não afetadas.
  const xrayMult =
    xray && (layer === "roof" || layer === "cladding") ? 0.18 : 1;
  const dim = (isolated && isolated !== layer ? 0.08 : 1) * xrayMult;

  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.position.y = THREE.MathUtils.lerp(
      groupRef.current.position.y,
      targetY,
      0.18,
    );
  });

  return (
    <group ref={groupRef} visible={visible} userData={{ layer }}>
      {/* Dim non-isolated layers by wrapping children with material adjustments via group opacity through traversal. */}
      <DimWrap dim={dim}>{children}</DimWrap>
    </group>
  );
}

/** Aplica fade nos materiais quando outra camada está isolada. */
function DimWrap({
  dim,
  children,
}: {
  dim: number;
  children: React.ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      mats.forEach((m) => {
        const mat = m as THREE.MeshStandardMaterial;
        if (!mat) return;
        mat.transparent = dim < 1;
        mat.opacity = dim;
        mat.needsUpdate = true;
      });
    });
  });
  return <group ref={ref}>{children}</group>;
}

function Foundation({ shed }: { shed: IndustrialShed }) {
  const { footprint, structure } = shed;
  const w = footprint.width;
  const d = footprint.depth;
  const bays = structure.bayCount;
  const spacing = structure.baySpacing;
  const blocks: JSX.Element[] = [];
  // Sapatas isoladas: 2 por pórtico.
  for (let i = 0; i < bays; i++) {
    const z = -d / 2 + (i + 0.5) * spacing;
    blocks.push(
      <mesh key={`fl-${i}`} position={[-w / 2 + 0.6, -0.35, z]}>
        <boxGeometry args={[1.4, 0.6, 1.4]} />
        <meshStandardMaterial color={LAYER_COLOR.foundation} roughness={0.85} />
      </mesh>,
    );
    blocks.push(
      <mesh key={`fr-${i}`} position={[w / 2 - 0.6, -0.35, z]}>
        <boxGeometry args={[1.4, 0.6, 1.4]} />
        <meshStandardMaterial color={LAYER_COLOR.foundation} roughness={0.85} />
      </mesh>,
    );
  }
  // Viga baldrame (perímetro).
  return (
    <group>
      {blocks}
      <mesh position={[0, -0.05, -d / 2]}>
        <boxGeometry args={[w, 0.2, 0.4]} />
        <meshStandardMaterial color={LAYER_COLOR.foundation} roughness={0.9} />
      </mesh>
      <mesh position={[0, -0.05, d / 2]}>
        <boxGeometry args={[w, 0.2, 0.4]} />
        <meshStandardMaterial color={LAYER_COLOR.foundation} roughness={0.9} />
      </mesh>
      <mesh position={[-w / 2, -0.05, 0]}>
        <boxGeometry args={[0.4, 0.2, d]} />
        <meshStandardMaterial color={LAYER_COLOR.foundation} roughness={0.9} />
      </mesh>
      <mesh position={[w / 2, -0.05, 0]}>
        <boxGeometry args={[0.4, 0.2, d]} />
        <meshStandardMaterial color={LAYER_COLOR.foundation} roughness={0.9} />
      </mesh>
    </group>
  );
}

function Structure({ shed }: { shed: IndustrialShed }) {
  const { footprint, structure, roof } = shed;
  const w = footprint.width;
  const d = footprint.depth;
  const bays = structure.bayCount;
  const spacing = structure.baySpacing;
  const ch = structure.clearHeight;
  const rise = roof.type === "gable" ? (w / 2) * (roof.slopePct / 100) : 0.3;
  const col = 0.32;
  const beam = 0.22;
  const elements: JSX.Element[] = [];

  for (let i = 0; i < bays; i++) {
    const z = -d / 2 + (i + 0.5) * spacing;
    // colunas
    elements.push(
      <mesh key={`cl-${i}`} position={[-w / 2 + col / 2, ch / 2, z]}>
        <boxGeometry args={[col, ch, col]} />
        <meshStandardMaterial
          color={LAYER_COLOR.structure}
          metalness={0.4}
          roughness={0.5}
        />
      </mesh>,
      <mesh key={`cr-${i}`} position={[w / 2 - col / 2, ch / 2, z]}>
        <boxGeometry args={[col, ch, col]} />
        <meshStandardMaterial
          color={LAYER_COLOR.structure}
          metalness={0.4}
          roughness={0.5}
        />
      </mesh>,
    );
    // duas águas (gable): duas vigas inclinadas
    if (roof.type === "gable") {
      const half = w / 2;
      const len = Math.sqrt(half * half + rise * rise);
      const angle = Math.atan2(rise, half);
      elements.push(
        <mesh
          key={`bl-${i}`}
          position={[-half / 2, ch + rise / 2, z]}
          rotation={[0, 0, -angle]}
        >
          <boxGeometry args={[len, beam, beam]} />
          <meshStandardMaterial
            color={LAYER_COLOR.structure}
            metalness={0.4}
            roughness={0.5}
          />
        </mesh>,
        <mesh
          key={`br-${i}`}
          position={[half / 2, ch + rise / 2, z]}
          rotation={[0, 0, angle]}
        >
          <boxGeometry args={[len, beam, beam]} />
          <meshStandardMaterial
            color={LAYER_COLOR.structure}
            metalness={0.4}
            roughness={0.5}
          />
        </mesh>,
      );
    } else {
      // viga horizontal (shed/flat)
      elements.push(
        <mesh key={`bb-${i}`} position={[0, ch + beam / 2, z]}>
          <boxGeometry args={[w, beam, beam]} />
          <meshStandardMaterial
            color={LAYER_COLOR.structure}
            metalness={0.4}
            roughness={0.5}
          />
        </mesh>,
      );
    }
  }

  // terças (longitudinais)
  const purlinCount = 5;
  for (let p = 0; p < purlinCount; p++) {
    const x = -w / 2 + ((p + 0.5) * w) / purlinCount;
    const yTop =
      roof.type === "gable"
        ? ch + rise * (1 - Math.abs(x) / (w / 2))
        : ch + beam;
    elements.push(
      <mesh key={`pu-${p}`} position={[x, yTop, 0]}>
        <boxGeometry args={[0.1, 0.1, d]} />
        <meshStandardMaterial
          color={LAYER_COLOR.structure}
          metalness={0.5}
          roughness={0.4}
        />
      </mesh>,
    );
  }
  return <group>{elements}</group>;
}

function Floor({ shed }: { shed: IndustrialShed }) {
  const w = shed.footprint.width;
  const d = shed.footprint.depth;
  return (
    <mesh position={[0, 0.05, 0]} receiveShadow>
      <boxGeometry args={[w - 0.6, 0.1, d - 0.6]} />
      <meshStandardMaterial color={LAYER_COLOR.floor} roughness={0.7} />
    </mesh>
  );
}

function Services({ shed }: { shed: IndustrialShed }) {
  const w = shed.footprint.width;
  const d = shed.footprint.depth;
  const docks = shed.docks ?? [];
  const meshes: JSX.Element[] = [];
  docks.forEach((dk, i) => {
    let x = 0;
    let z = 0;
    if (dk.wall === "south") {
      x = (dk.x ?? 0) - w / 2;
      z = d / 2 - 1.6;
    } else if (dk.wall === "north") {
      x = (dk.x ?? 0) - w / 2;
      z = -d / 2 + 1.6;
    } else if (dk.wall === "east") {
      x = w / 2 - 1.6;
      z = (dk.z ?? 0) - d / 2;
    } else {
      x = -w / 2 + 1.6;
      z = (dk.z ?? 0) - d / 2;
    }
    meshes.push(
      <mesh key={`dk-${i}`} position={[x, 0.6, z]}>
        <boxGeometry args={[3, 1.2, 2.4]} />
        <meshStandardMaterial color={LAYER_COLOR.services} roughness={0.6} />
      </mesh>,
    );
  });
  // hidrantes ao longo da fachada principal
  const hyd = Math.min(shed.utilities?.hydrants ?? 0, 8);
  for (let i = 0; i < hyd; i++) {
    const x = -w / 2 + ((i + 1) * w) / (hyd + 1);
    meshes.push(
      <mesh key={`hy-${i}`} position={[x, 0.5, d / 2 + 0.6]}>
        <cylinderGeometry args={[0.15, 0.15, 1, 12]} />
        <meshStandardMaterial color={LAYER_COLOR.services} roughness={0.5} />
      </mesh>,
    );
  }
  return <group>{meshes}</group>;
}

function Cladding({ shed }: { shed: IndustrialShed }) {
  const w = shed.footprint.width;
  const d = shed.footprint.depth;
  const ch = shed.structure.clearHeight;
  const base = shed.envelope.wallBaseHeight ?? 2.5;
  const wallThk = 0.12;

  return (
    <group>
      {/* base (alvenaria) — tonalidade mais escura */}
      <mesh position={[0, base / 2, -d / 2]}>
        <boxGeometry args={[w, base, wallThk]} />
        <meshStandardMaterial color="#5e1a2a" roughness={0.85} />
      </mesh>
      <mesh position={[0, base / 2, d / 2]}>
        <boxGeometry args={[w, base, wallThk]} />
        <meshStandardMaterial color="#5e1a2a" roughness={0.85} />
      </mesh>
      <mesh position={[-w / 2, base / 2, 0]}>
        <boxGeometry args={[wallThk, base, d]} />
        <meshStandardMaterial color="#5e1a2a" roughness={0.85} />
      </mesh>
      <mesh position={[w / 2, base / 2, 0]}>
        <boxGeometry args={[wallThk, base, d]} />
        <meshStandardMaterial color="#5e1a2a" roughness={0.85} />
      </mesh>
      {/* telha lateral acima da base */}
      <mesh position={[0, base + (ch - base) / 2, -d / 2]}>
        <boxGeometry args={[w, ch - base, wallThk]} />
        <meshStandardMaterial
          color={LAYER_COLOR.cladding}
          roughness={0.55}
          metalness={0.2}
        />
      </mesh>
      <mesh position={[0, base + (ch - base) / 2, d / 2]}>
        <boxGeometry args={[w, ch - base, wallThk]} />
        <meshStandardMaterial
          color={LAYER_COLOR.cladding}
          roughness={0.55}
          metalness={0.2}
        />
      </mesh>
      <mesh position={[-w / 2, base + (ch - base) / 2, 0]}>
        <boxGeometry args={[wallThk, ch - base, d]} />
        <meshStandardMaterial
          color={LAYER_COLOR.cladding}
          roughness={0.55}
          metalness={0.2}
        />
      </mesh>
      <mesh position={[w / 2, base + (ch - base) / 2, 0]}>
        <boxGeometry args={[wallThk, ch - base, d]} />
        <meshStandardMaterial
          color={LAYER_COLOR.cladding}
          roughness={0.55}
          metalness={0.2}
        />
      </mesh>
    </group>
  );
}

function Roof({ shed }: { shed: IndustrialShed }) {
  const { footprint, structure, roof } = shed;
  const w = footprint.width;
  const d = footprint.depth;
  const ch = structure.clearHeight;
  const overhang = roof.overhang ?? 0.6;

  if (roof.type === "gable") {
    const half = w / 2;
    const rise = half * (roof.slopePct / 100);
    const len = Math.sqrt(half * half + rise * rise);
    const angle = Math.atan2(rise, half);
    return (
      <group>
        <mesh
          position={[-half / 2, ch + rise / 2 + 0.05, 0]}
          rotation={[0, 0, -angle]}
        >
          <boxGeometry args={[len + overhang, 0.12, d + overhang * 2]} />
          <meshStandardMaterial
            color={LAYER_COLOR.roof}
            roughness={0.5}
            metalness={0.3}
          />
        </mesh>
        <mesh
          position={[half / 2, ch + rise / 2 + 0.05, 0]}
          rotation={[0, 0, angle]}
        >
          <boxGeometry args={[len + overhang, 0.12, d + overhang * 2]} />
          <meshStandardMaterial
            color={LAYER_COLOR.roof}
            roughness={0.5}
            metalness={0.3}
          />
        </mesh>
        {/* cumeeira */}
        <mesh position={[0, ch + rise + 0.08, 0]}>
          <boxGeometry args={[0.4, 0.08, d + overhang * 2]} />
          <meshStandardMaterial
            color="#ff924a"
            roughness={0.4}
            metalness={0.4}
          />
        </mesh>
      </group>
    );
  }

  // shed / flat / sawtooth simplificados como laje inclinada
  const rise = w * (roof.slopePct / 100);
  const angle = Math.atan2(rise, w);
  return (
    <mesh position={[0, ch + rise / 2 + 0.05, 0]} rotation={[0, 0, angle]}>
      <boxGeometry args={[w + overhang * 2, 0.12, d + overhang * 2]} />
      <meshStandardMaterial
        color={LAYER_COLOR.roof}
        roughness={0.5}
        metalness={0.3}
      />
    </mesh>
  );
}

function GroundEnv({
  envMode,
  envOpacity,
  shed,
}: {
  envMode: EnvMode;
  envOpacity: number;
  shed: IndustrialShed;
}) {
  const size = Math.max(shed.lot.width, shed.lot.depth, 80) * 1.5;
  if (envMode === "off") return null;

  const color =
    envMode === "satellite"
      ? "#3a4232"
      : envMode === "relief"
        ? "#5a5142"
        : "#2a2d33";

  return (
    <group>
      <mesh
        position={[0, -0.7, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={envOpacity}
          roughness={1}
        />
      </mesh>
      {/* vizinhos */}
      <NeighborBoxes shed={shed} opacity={envOpacity} />
    </group>
  );
}

function NeighborBoxes({
  shed,
  opacity,
}: {
  shed: IndustrialShed;
  opacity: number;
}) {
  const w = shed.footprint.width;
  const d = shed.footprint.depth;
  const boxes: [number, number, number, number, number][] = [
    [-w * 0.9, 4, -d * 0.7, 14, 22],
    [w * 0.95, 5, -d * 0.4, 16, 18],
    [-w * 0.7, 3.5, d * 0.85, 12, 14],
    [w * 0.6, 4.2, d * 0.95, 18, 12],
  ];
  return (
    <group>
      {boxes.map(([x, h, z, bw, bd], i) => (
        <mesh key={i} position={[x, h / 2, z]}>
          <boxGeometry args={[bw, h, bd]} />
          <meshStandardMaterial
            color="#3d4148"
            transparent
            opacity={opacity * 0.6}
            roughness={0.9}
          />
        </mesh>
      ))}
    </group>
  );
}

function DimensionAnnotations({ shed }: { shed: IndustrialShed }) {
  const w = shed.footprint.width;
  const d = shed.footprint.depth;
  const ch = shed.structure.clearHeight;
  const labelStyle: React.CSSProperties = {
    background: "rgba(18,18,18,0.88)",
    border: "1px solid rgba(215,32,66,0.5)",
    color: "#fff",
    padding: "3px 8px",
    borderRadius: 6,
    fontFamily: "var(--font-mono, ui-monospace)",
    fontSize: 11,
    whiteSpace: "nowrap",
    pointerEvents: "none",
  };
  return (
    <group>
      <Html position={[0, -0.6, d / 2 + 2]} center>
        <div style={labelStyle}>{w.toFixed(1)} m</div>
      </Html>
      <Html position={[w / 2 + 2, -0.6, 0]} center>
        <div style={labelStyle}>{d.toFixed(1)} m</div>
      </Html>
      <Html position={[w / 2 + 1.4, ch / 2, d / 2 + 1.4]} center>
        <div style={labelStyle}>pé-direito {ch.toFixed(1)} m</div>
      </Html>
    </group>
  );
}

function CameraRig({ preset }: { preset: ViewPreset }) {
  const { camera } = useThree();
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    // Posições enquadram um galpão de até ~60×150×12 m com folga.
    const targets: Record<ViewPreset, [number, number, number]> = {
      iso: [70, 50, 90],
      plan: [0, 180, 0.001], // topo, quase ortográfico
      front: [0, 25, 140],
      side: [140, 25, 0],
    };
    const t = targets[preset];
    cam.position.set(t[0], t[1], t[2]);
    cam.lookAt(0, 6, 0);
    cam.updateProjectionMatrix();
  }, [preset, camera]);
  return null;
}

// =============================================================
// OVERLAY UI (camadas, HUD, ambiente, presets, AI fab)
// =============================================================

function LayerRail({
  layers,
  visible,
  isolated,
  explode,
  onToggle,
  onIsolate,
  onExplode,
}: {
  layers: LayerSpec[];
  visible: Record<LayerId, boolean>;
  isolated: LayerId | null;
  explode: number;
  onToggle: (id: LayerId) => void;
  onIsolate: (id: LayerId | null) => void;
  onExplode: (v: number) => void;
}) {
  return (
    <div className="layer-rail">
      <div className="layer-rail-head">
        <span className="lr-title">Camadas</span>
        <span className="lr-sub">isolar · esconder · explodir</span>
      </div>
      <div className="layer-chips">
        {/* renderiza de cima → baixo: roof → foundation (como no protótipo) */}
        {[...layers].reverse().map((L) => {
          const isVisible = visible[L.id];
          const isActive = isolated === L.id;
          return (
            <button
              key={L.id}
              className={`layer-chip lc-${L.id} ${isActive ? "active" : ""}`}
              aria-pressed={isVisible}
              onClick={() => onIsolate(isActive ? null : L.id)}
              style={{ ["--lc-color" as any]: L.color }}
            >
              <span className="lc-tag" style={{ background: L.color }}>
                {L.idx}
              </span>
              <span>
                <span className="lc-name">{L.name}</span>
                <br />
                <span className="lc-meta">{L.meta}</span>
              </span>
              <span
                className="lc-toggle"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(L.id);
                }}
                title={isVisible ? "Ocultar" : "Mostrar"}
              >
                {isVisible ? "●" : "○"}
              </span>
            </button>
          );
        })}
      </div>
      <div className="layer-explode">
        <label htmlFor="explode">Explodir</label>
        <input
          type="range"
          id="explode"
          min={0}
          max={120}
          value={explode}
          onChange={(e) => onExplode(parseInt(e.target.value, 10))}
        />
        <output>{explode}</output>
      </div>
    </div>
  );
}

function LayerFocus({
  layer,
  spec,
  onClose,
}: {
  layer: LayerId;
  spec: LayerSpec;
  onClose: () => void;
}) {
  return (
    <div className="layer-focus" style={{ ["--lf-color" as any]: spec.color }}>
      <span className="lf-tag" style={{ background: spec.color }}>
        {spec.idx}
      </span>
      <div className="lf-info">
        <div className="lf-name">{spec.name}</div>
        <div className="lf-meta">{spec.meta}</div>
      </div>
      <button
        className="lf-close"
        onClick={onClose}
        aria-label="Sair do isolamento"
      >
        ✕
      </button>
    </div>
  );
}

function HudStats({ shed }: { shed: IndustrialShed }) {
  const area = Math.max(
    shed.estimate.coveredAreaM2 || shed.footprint.width * shed.footprint.depth,
    1,
  );
  const steelT = (shed.estimate.steelKg || 0) / 1000;
  const total = shed.estimate.totalCost || area * shed.estimate.costPerM2;
  return (
    <div className="hud-stats">
      <div className="hud-card accent">
        <div className="hud-label">Peso aço</div>
        <div className="hud-value">{steelT.toFixed(1)} t</div>
      </div>
      <div className="hud-card accent">
        <div className="hud-label">Custo total</div>
        <div className="hud-value">{BRL(total)}</div>
      </div>
      <div className="hud-card">
        <div className="hud-label">Área coberta</div>
        <div className="hud-value">{fmtInt(area)} m²</div>
      </div>
      <div className="hud-card">
        <div className="hud-label">Dimensões</div>
        <div className="hud-value">
          {shed.footprint.width.toFixed(0)} × {shed.footprint.depth.toFixed(0)}{" "}
          m
        </div>
      </div>
      <div className="hud-card">
        <div className="hud-label">Vão · pé-direito</div>
        <div className="hud-value">
          {shed.structure.freeSpan.toFixed(0)} ·{" "}
          {shed.structure.clearHeight.toFixed(1)} m
        </div>
      </div>
    </div>
  );
}

function EnvControl({
  envMode,
  envOpacity,
  onMode,
  onOpacity,
}: {
  envMode: EnvMode;
  envOpacity: number;
  onMode: (m: EnvMode) => void;
  onOpacity: (v: number) => void;
}) {
  const modes: { id: EnvMode; label: string }[] = [
    { id: "satellite", label: "Satélite" },
    { id: "relief", label: "Relevo" },
    { id: "streets", label: "Ruas" },
    { id: "off", label: "Off" },
  ];
  return (
    <div className="env-control">
      <div className="env-pills">
        {modes.map((m) => (
          <button
            key={m.id}
            className={`env-pill ${envMode === m.id ? "active" : ""}`}
            onClick={() => onMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="env-opacity-row">
        <span>Opacidade</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(envOpacity * 100)}
          onChange={(e) => onOpacity(parseInt(e.target.value, 10) / 100)}
        />
        <output>{Math.round(envOpacity * 100)}%</output>
      </div>
    </div>
  );
}

function ViewportBottomBar({
  preset,
  onPreset,
  xray,
  onXray,
}: {
  preset: ViewPreset;
  onPreset: (p: ViewPreset) => void;
  xray: boolean;
  onXray: (v: boolean) => void;
}) {
  const presets: { id: ViewPreset; label: string }[] = [
    { id: "iso", label: "Isométrica" },
    { id: "plan", label: "Planta" },
    { id: "front", label: "Frente" },
    { id: "side", label: "Lado" },
  ];
  return (
    <div className="viewport-bottom-bar">
      {presets.map((p) => (
        <button
          key={p.id}
          className={`vp-btn ${preset === p.id ? "active" : ""}`}
          onClick={() => onPreset(p.id)}
        >
          {p.label}
        </button>
      ))}
      <div
        style={{ width: 1, height: 18, background: "var(--color-stroke)" }}
      />
      <button
        className={`vp-btn ${xray ? "active" : ""}`}
        onClick={() => onXray(!xray)}
        title="Raio-X: cobertura e vedação translúcidas (ver estrutura interna)"
      >
        Raio-X
      </button>
    </div>
  );
}

// =============================================================
// COMPONENTE PRINCIPAL
// =============================================================

export default function ShedViewerClient({
  shed,
  height = "70vh",
  compact = false,
}: Props) {
  const layers = useMemo(() => deriveLayers(shed), [shed]);
  const layerMap = useMemo(
    () =>
      layers.reduce<Record<LayerId, LayerSpec>>(
        (acc, l) => {
          acc[l.id] = l;
          return acc;
        },
        {} as Record<LayerId, LayerSpec>,
      ),
    [layers],
  );

  const [visible, setVisible] = useState<Record<LayerId, boolean>>(() =>
    LAYER_ORDER.reduce(
      (acc, id) => ({ ...acc, [id]: true }),
      {} as Record<LayerId, boolean>,
    ),
  );
  const [isolated, setIsolated] = useState<LayerId | null>(null);
  const [explode, setExplode] = useState(0);
  const [envMode, setEnvMode] = useState<EnvMode>("satellite");
  const [envOpacity, setEnvOpacity] = useState(0.6);
  const [preset, setPreset] = useState<ViewPreset>("iso");
  const [xray, setXray] = useState(false);

  // Esc → sair do isolamento
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isolated) setIsolated(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isolated]);

  const onToggle = (id: LayerId) =>
    setVisible((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <div className="viewport" style={{ height, position: "relative" }}>
      <Canvas
        shadows
        camera={{ position: [55, 38, 65], fov: 38 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
        style={{
          background: "linear-gradient(180deg, #1d1c22 0%, #121212 100%)",
        }}
      >
        <ambientLight intensity={0.55} />
        <directionalLight
          position={[40, 60, 30]}
          intensity={1.1}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
        <directionalLight position={[-30, 20, -20]} intensity={0.35} />

        <Grid
          position={[0, -0.69, 0]}
          args={[200, 200]}
          cellSize={1}
          cellThickness={0.6}
          cellColor="#2b2b32"
          sectionSize={10}
          sectionThickness={1.2}
          sectionColor="#3a3a44"
          fadeDistance={140}
          fadeStrength={1.2}
          infiniteGrid
        />

        <GroundEnv envMode={envMode} envOpacity={envOpacity} shed={shed} />

        <LayerGroup
          layer="foundation"
          visible={visible.foundation}
          isolated={isolated}
          explode={explode}
        >
          <Foundation shed={shed} />
        </LayerGroup>
        <LayerGroup
          layer="structure"
          visible={visible.structure}
          isolated={isolated}
          explode={explode}
        >
          <Structure shed={shed} />
        </LayerGroup>
        <LayerGroup
          layer="floor"
          visible={visible.floor}
          isolated={isolated}
          explode={explode}
        >
          <Floor shed={shed} />
        </LayerGroup>
        <LayerGroup
          layer="services"
          visible={visible.services}
          isolated={isolated}
          explode={explode}
        >
          <Services shed={shed} />
        </LayerGroup>
        <LayerGroup
          layer="cladding"
          visible={visible.cladding}
          isolated={isolated}
          explode={explode}
          xray={xray}
        >
          <Cladding shed={shed} />
        </LayerGroup>
        <LayerGroup
          layer="roof"
          visible={visible.roof}
          isolated={isolated}
          explode={explode}
          xray={xray}
        >
          <Roof shed={shed} />
        </LayerGroup>

        <DimensionAnnotations shed={shed} />

        <CameraRig preset={preset} />
        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          target={[0, 6, 0]}
          // Permite rotacionar livremente — inclusive olhar de baixo para
          // contar treliças/colunas a partir da planta invertida.
          minPolarAngle={0}
          maxPolarAngle={Math.PI}
          // Zoom amplo: chega bem perto para inspecionar conexões e bem longe
          // para enquadrar o lote inteiro.
          minDistance={3}
          maxDistance={600}
          // Pan livre (atalho Shift+drag ou botão direito).
          enablePan
          zoomSpeed={1.1}
          rotateSpeed={0.9}
        />
      </Canvas>

      {/* Overlays HTML (fora do canvas) — omitidos no modo compacto */}
      {!compact && (
        <>
          <LayerRail
            layers={layers}
            visible={visible}
            isolated={isolated}
            explode={explode}
            onToggle={onToggle}
            onIsolate={setIsolated}
            onExplode={setExplode}
          />

          <HudStats shed={shed} />

          {isolated && (
            <LayerFocus
              layer={isolated}
              spec={layerMap[isolated]}
              onClose={() => setIsolated(null)}
            />
          )}

          <EnvControl
            envMode={envMode}
            envOpacity={envOpacity}
            onMode={setEnvMode}
            onOpacity={setEnvOpacity}
          />

          <ViewportBottomBar
            preset={preset}
            onPreset={setPreset}
            xray={xray}
            onXray={setXray}
          />

          <button
            className="ai-fab"
            title="Pergunte à GenIA sobre este galpão"
            onClick={() => {
              const ev = new CustomEvent("sfg:ai-fab");
              window.dispatchEvent(ev);
            }}
          >
            <span className="ai-fab-dot" />
            Perguntar à GenIA
          </button>
        </>
      )}
    </div>
  );
}
