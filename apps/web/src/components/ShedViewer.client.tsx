"use client";

import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  Grid,
  Environment,
  Html,
  GizmoHelper,
  GizmoViewport,
} from "@react-three/drei";
import * as THREE from "three";
import { useMemo } from "react";
import type { IndustrialShed } from "@/lib/shedSchema";
import { getShedMaterial, type PBRMaterialDef } from "@/lib/shedMaterials";
import type { LngLat } from "@/lib/geo";
import { toLocalMeters } from "@/lib/geo";

interface Props {
  shed: IndustrialShed;
  polygon?: LngLat[];
  height?: string;
}

const COLUMN = 0.35; // seção da coluna (m)
const BEAM = 0.2;

function mat(name?: string) {
  return getShedMaterial(name);
}

function PBRMat({ def, side }: { def: PBRMaterialDef; side?: THREE.Side }) {
  return (
    <meshStandardMaterial
      color={def.color}
      roughness={def.roughness}
      metalness={def.metalness}
      opacity={def.opacity ?? 1}
      transparent={def.transparent ?? false}
      side={side}
    />
  );
}

// ---- Estrutura: colunas + tesouras ---------------------------------------
function Frames({ shed }: { shed: IndustrialShed }) {
  const { footprint, structure, roof } = shed;
  const m = mat("aco_pintado_cinza");
  const cols: JSX.Element[] = [];
  const beams: JSX.Element[] = [];
  const rise = (footprint.width / 2) * (roof.slopePct / 100);

  for (let i = 0; i <= structure.bayCount; i++) {
    const z = i * structure.baySpacing;
    // 2 colunas por pórtico
    [-1, 1].forEach((side) => {
      const x = footprint.width / 2 + (side * footprint.width) / 2;
      cols.push(
        <mesh
          key={`c-${i}-${side}`}
          position={[x, structure.clearHeight / 2, z]}
          castShadow
        >
          <boxGeometry args={[COLUMN, structure.clearHeight, COLUMN]} />
          <PBRMat def={m} />
        </mesh>,
      );
    });

    // Tesoura (banzo inferior + 2 inclinadas + montante central)
    const span = footprint.width;
    beams.push(
      <group
        key={`t-${i}`}
        position={[footprint.width / 2, structure.clearHeight, z]}
      >
        <mesh>
          <boxGeometry args={[span, BEAM, BEAM]} />
          <PBRMat def={mat("aco_galvanizado")} />
        </mesh>
        {[-1, 1].map((dir) => {
          const half = span / 2;
          const len = Math.sqrt(half * half + rise * rise);
          const angle = Math.atan2(rise, half) * dir;
          return (
            <mesh
              key={dir}
              position={[(half / 2) * dir, rise / 2, 0]}
              rotation={[0, 0, -angle]}
            >
              <boxGeometry args={[len, BEAM, BEAM]} />
              <PBRMat def={mat("aco_galvanizado")} />
            </mesh>
          );
        })}
        {rise > 0.3 && (
          <mesh position={[0, rise / 2, 0]}>
            <boxGeometry args={[BEAM * 0.8, rise, BEAM * 0.8]} />
            <PBRMat def={mat("aco_pintado_cinza")} />
          </mesh>
        )}
      </group>,
    );
  }

  return (
    <>
      {cols}
      {beams}
    </>
  );
}

// ---- Telhado ---------------------------------------------------------------
function Roof({ shed }: { shed: IndustrialShed }) {
  const { footprint, structure, roof } = shed;
  const w = footprint.width;
  const d = footprint.depth;
  const cover = mat(roof.cover);
  const baseY = structure.clearHeight;
  const rise = (w / 2) * (roof.slopePct / 100);

  if (roof.type === "flat") {
    return (
      <mesh position={[w / 2, baseY + 0.05, d / 2]} receiveShadow castShadow>
        <boxGeometry
          args={[w + roof.overhang * 2, 0.1, d + roof.overhang * 2]}
        />
        <PBRMat def={cover} side={THREE.DoubleSide} />
      </mesh>
    );
  }

  if (roof.type === "shed") {
    const slope = Math.atan2(rise * 2, w);
    const len = Math.sqrt(w * w + rise * 2 * (rise * 2));
    return (
      <mesh
        position={[w / 2, baseY + rise, d / 2]}
        rotation={[0, 0, -slope]}
        castShadow
      >
        <boxGeometry args={[len, 0.08, d + roof.overhang * 2]} />
        <PBRMat def={cover} side={THREE.DoubleSide} />
      </mesh>
    );
  }

  if (roof.type === "sawtooth") {
    const teeth = Math.max(2, Math.round(d / 8));
    const toothDepth = d / teeth;
    const items: JSX.Element[] = [];
    for (let i = 0; i < teeth; i++) {
      const z = i * toothDepth + toothDepth / 2;
      const slope = Math.atan2(rise * 1.4, toothDepth);
      const len = Math.sqrt(
        toothDepth * toothDepth + rise * 1.4 * (rise * 1.4),
      );
      items.push(
        <mesh
          key={i}
          position={[w / 2, baseY + rise * 0.7, z]}
          rotation={[slope, 0, 0]}
          castShadow
        >
          <boxGeometry args={[w + roof.overhang * 2, 0.08, len]} />
          <PBRMat def={cover} side={THREE.DoubleSide} />
        </mesh>,
      );
      // janela vertical (clerestory)
      items.push(
        <mesh
          key={`g-${i}`}
          position={[w / 2, baseY + rise * 1.4, z - toothDepth / 2 + 0.05]}
        >
          <boxGeometry args={[w, rise * 1.4, 0.05]} />
          <PBRMat def={mat("vidro_clear")} />
        </mesh>,
      );
    }
    return <>{items}</>;
  }

  // gable (default)
  return (
    <group position={[w / 2, baseY, d / 2]}>
      {[-1, 1].map((dir) => {
        const half = w / 2;
        const slope = Math.atan2(rise, half);
        const len = Math.sqrt(half * half + rise * rise);
        return (
          <mesh
            key={dir}
            position={[(half / 2) * dir, rise / 2, 0]}
            rotation={[0, 0, -slope * dir]}
            castShadow
          >
            <boxGeometry args={[len, 0.08, d + roof.overhang * 2]} />
            <PBRMat def={cover} side={THREE.DoubleSide} />
          </mesh>
        );
      })}
    </group>
  );
}

// ---- Lanternins / skylights ----------------------------------------------
function Skylights({ shed }: { shed: IndustrialShed }) {
  const { footprint, structure, roof } = shed;
  if (roof.skylightPct <= 0 || roof.type === "sawtooth") return null;
  const baseY = structure.clearHeight;
  const total = roof.skylightPct / 100;
  const stripeArea = footprint.width * footprint.depth * total;
  const count = Math.max(1, Math.round(footprint.depth / 12));
  const stripeLen = footprint.width * 0.6;
  const stripeWidth = stripeArea / count / stripeLen;
  const rise = (footprint.width / 2) * (roof.slopePct / 100);

  return (
    <>
      {Array.from({ length: count }).map((_, i) => {
        const z = footprint.depth * ((i + 1) / (count + 1));
        return (
          <mesh
            key={i}
            position={[footprint.width / 2, baseY + rise + 0.05, z]}
          >
            <boxGeometry args={[stripeLen, 0.02, Math.max(0.8, stripeWidth)]} />
            <PBRMat def={mat("policarbonato")} />
          </mesh>
        );
      })}
    </>
  );
}

// ---- Paredes externas com fechamento ------------------------------------
function Walls({ shed }: { shed: IndustrialShed }) {
  const { footprint, structure, envelope, openings } = shed;
  const w = footprint.width;
  const d = footprint.depth;
  const h = structure.clearHeight;

  const baseMat = mat(envelope.walls);
  const upperMat = mat("telha_lateral");
  const baseH = Math.min(envelope.wallBaseHeight, h);

  // Render base de alvenaria (até wallBaseHeight) e fechamento superior em telha
  function wall(
    key: string,
    wall: "north" | "south" | "east" | "west",
    px: number,
    pz: number,
    length: number,
    rotY: number,
  ) {
    const wallOpenings = openings.filter((o) => o.wall === wall);

    // Função auxiliar para criar segmento subtraindo aberturas
    type Seg = [number, number]; // start, end ao longo da parede
    let base: Seg[] = [[0, length]];
    let top: Seg[] = [[0, length]];

    for (const op of wallOpenings) {
      const s = op.xAlongWall;
      const e = Math.min(length, op.xAlongWall + op.width);
      const opTop = op.elevation + op.height;
      // Corta base se a abertura toca a faixa [0..baseH]
      if (op.elevation < baseH) {
        base = base.flatMap((seg): Seg[] => {
          if (e <= seg[0] || s >= seg[1]) return [seg];
          const out: Seg[] = [];
          if (s > seg[0]) out.push([seg[0], s]);
          if (e < seg[1]) out.push([e, seg[1]]);
          return out;
        });
      }
      // Corta topo se a abertura toca a faixa [baseH..h]
      if (opTop > baseH) {
        top = top.flatMap((seg): Seg[] => {
          if (e <= seg[0] || s >= seg[1]) return [seg];
          const out: Seg[] = [];
          if (s > seg[0]) out.push([seg[0], s]);
          if (e < seg[1]) out.push([e, seg[1]]);
          return out;
        });
      }
    }

    return (
      <group key={key} position={[px, 0, pz]} rotation={[0, rotY, 0]}>
        {base.map(([s, e], i) => (
          <mesh
            key={`b-${i}`}
            position={[(s + e) / 2, baseH / 2, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[Math.max(0.01, e - s), baseH, 0.18]} />
            <PBRMat def={baseMat} />
          </mesh>
        ))}
        {top.map(([s, e], i) => (
          <mesh
            key={`t-${i}`}
            position={[(s + e) / 2, baseH + (h - baseH) / 2, 0]}
            castShadow
          >
            <boxGeometry
              args={[Math.max(0.01, e - s), Math.max(0.01, h - baseH), 0.12]}
            />
            <PBRMat def={upperMat} />
          </mesh>
        ))}
        {/* Aberturas: render visual dos portões/janelas */}
        {wallOpenings.map((op, i) => (
          <OpeningMesh key={i} op={op} wallLen={length} />
        ))}
      </group>
    );
  }

  return (
    <>
      {wall("S", "south", 0, 0, w, 0)}
      {wall("N", "north", w, d, w, Math.PI)}
      {wall("W", "west", 0, d, d, -Math.PI / 2)}
      {wall("E", "east", w, 0, d, Math.PI / 2)}
    </>
  );
}

function OpeningMesh({
  op,
  wallLen,
}: {
  op: IndustrialShed["openings"][number];
  wallLen: number;
}) {
  void wallLen;
  const isPortao =
    op.type === "portao_seccional" || op.type === "portao_enrolar";
  const isPorta = op.type.startsWith("porta");
  const isJanela = op.type === "janela_alta" || op.type === "lanternim";
  const material = isPortao
    ? mat("portao_seccional")
    : isPorta
      ? mat("aco_pintado_branco")
      : isJanela
        ? mat("vidro_clear")
        : mat("esquadria_aluminio");
  const cx = op.xAlongWall + op.width / 2;
  const cy = op.elevation + op.height / 2;
  return (
    <mesh position={[cx, cy, 0.01]}>
      <boxGeometry args={[op.width, op.height, 0.05]} />
      <PBRMat def={material} />
    </mesh>
  );
}

// ---- Zonas internas (chão colorido + caixa fina demarcando) -------------
function Zones({ shed }: { shed: IndustrialShed }) {
  const colorByType: Record<string, string> = {
    armazenagem: "#3b82f6",
    picking: "#22d3ee",
    expedicao: "#f59e0b",
    recebimento: "#fb923c",
    escritorio: "#a78bfa",
    vestiario: "#10b981",
    refeitorio: "#10b981",
    area_tecnica: "#6b7280",
    avcb_hidrante: "#ef4444",
    producao: "#dd1c4a",
  };

  return (
    <>
      {shed.zones.map((z, i) => {
        const color = colorByType[z.type] ?? "#94a3b8";
        const cx = z.x + z.width / 2;
        const cz = z.z + z.depth / 2;
        return (
          <group key={i}>
            <mesh
              position={[cx, 0.03, cz]}
              rotation={[-Math.PI / 2, 0, 0]}
              receiveShadow
            >
              <planeGeometry args={[z.width, z.depth]} />
              <meshStandardMaterial color={color} transparent opacity={0.18} />
            </mesh>
            {/* moldura */}
            <lineSegments position={[cx, 0.04, cz]}>
              <edgesGeometry
                args={[new THREE.BoxGeometry(z.width, 0.01, z.depth)]}
              />
              <lineBasicMaterial color={color} />
            </lineSegments>
            <Html position={[cx, z.height * 0.5, cz]} center>
              <div
                className="rounded bg-black/70 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white"
                style={{ borderLeft: `3px solid ${color}` }}
              >
                {z.name}
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}

// ---- Mezanino -----------------------------------------------------------
function Mezzanine({ shed }: { shed: IndustrialShed }) {
  if (!shed.mezzanine) return null;
  const m = shed.mezzanine;
  return (
    <mesh
      position={[m.x + m.width / 2, m.height, m.z + m.depth / 2]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[m.width, 0.2, m.depth]} />
      <PBRMat def={mat("aco_pintado_branco")} />
    </mesh>
  );
}

// ---- Docas (plataformas externas) ---------------------------------------
function Docks({ shed }: { shed: IndustrialShed }) {
  const items: JSX.Element[] = [];
  const w = shed.footprint.width;
  const d = shed.footprint.depth;
  for (let i = 0; i < shed.docks.length; i++) {
    const dock = shed.docks[i];
    const W = 3.5;
    const D = 1.5;
    const H = dock.type === "elevada" ? 1.4 : 1.1;
    let px = dock.x;
    let pz = dock.z;
    if (dock.wall === "north") {
      px = dock.x;
      pz = d + D / 2;
    } else if (dock.wall === "south") {
      pz = -D / 2;
    } else if (dock.wall === "west") {
      px = -D / 2;
    } else if (dock.wall === "east") {
      px = w + D / 2;
    }
    items.push(
      <mesh key={i} position={[px, H / 2, pz]} castShadow receiveShadow>
        <boxGeometry args={[W, H, D]} />
        <PBRMat def={mat("concreto_armado")} />
      </mesh>,
    );
  }
  return <>{items}</>;
}

// ---- Pátio + perímetro --------------------------------------------------
function Yard({ shed }: { shed: IndustrialShed }) {
  const { lot, footprint, setbacks, perimeter } = shed;
  const offset = {
    x: -setbacks.sides - (lot.width - footprint.width - 2 * setbacks.sides) / 2,
    z: -setbacks.front,
  };
  return (
    <group position={[offset.x, 0, offset.z]}>
      {/* asfalto/pátio */}
      <mesh
        position={[lot.width / 2, -0.005, lot.depth / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[lot.width, lot.depth]} />
        <PBRMat def={mat("asfalto")} />
      </mesh>
      {/* muro perimetral */}
      {(["N", "S", "E", "W"] as const).map((side) => {
        const h = perimeter.fenceHeight;
        if (side === "N")
          return (
            <mesh
              key="N"
              position={[lot.width / 2, h / 2, lot.depth]}
              castShadow
            >
              <boxGeometry args={[lot.width, h, 0.2]} />
              <PBRMat def={mat(perimeter.fenceType)} />
            </mesh>
          );
        if (side === "S")
          return (
            <mesh key="S" position={[lot.width / 2, h / 2, 0]} castShadow>
              <boxGeometry args={[lot.width, h, 0.2]} />
              <PBRMat def={mat(perimeter.fenceType)} />
            </mesh>
          );
        if (side === "E")
          return (
            <mesh
              key="E"
              position={[lot.width, h / 2, lot.depth / 2]}
              castShadow
            >
              <boxGeometry args={[0.2, h, lot.depth]} />
              <PBRMat def={mat(perimeter.fenceType)} />
            </mesh>
          );
        return (
          <mesh key="W" position={[0, h / 2, lot.depth / 2]} castShadow>
            <boxGeometry args={[0.2, h, lot.depth]} />
            <PBRMat def={mat(perimeter.fenceType)} />
          </mesh>
        );
      })}
    </group>
  );
}

// ---- Contorno do polígono do terreno ------------------------------------
function PolygonOutline({
  polygon,
  origin,
  offset,
}: {
  polygon: LngLat[];
  origin: LngLat;
  offset: { x: number; z: number };
}) {
  const points = useMemo(() => {
    const local = toLocalMeters(polygon, origin);
    const closed = [...local, local[0]];
    return closed.map(
      (p) => new THREE.Vector3(p.x + offset.x, 0.05, -p.y + offset.z),
    );
  }, [polygon, origin, offset]);
  const geom = useMemo(
    () => new THREE.BufferGeometry().setFromPoints(points),
    [points],
  );
  return (
    <line>
      <primitive object={geom} attach="geometry" />
      <lineBasicMaterial color="#22d3ee" />
    </line>
  );
}

export default function ShedViewer({ shed, polygon, height }: Props) {
  const { footprint } = shed;
  const camDist =
    Math.max(footprint.width, footprint.depth, shed.lot.width, shed.lot.depth) *
      1.1 +
    25;

  return (
    <div
      className="overflow-hidden rounded-xl border border-white/10 bg-[#0e0c11]"
      style={{ height: height ?? "70vh" }}
    >
      <Canvas
        shadows
        camera={{ position: [camDist, camDist * 0.65, camDist], fov: 42 }}
      >
        <color attach="background" args={["#0e0c11"]} />
        <fog attach="fog" args={["#0e0c11", camDist * 0.8, camDist * 4]} />
        <ambientLight intensity={0.45} />
        <directionalLight
          position={[camDist * 0.6, camDist * 0.9, camDist * 0.4]}
          intensity={1.05}
          castShadow
          shadow-mapSize={[2048, 2048]}
        />
        <Environment preset="warehouse" />

        <Grid
          args={[400, 400]}
          cellSize={1}
          cellThickness={0.4}
          cellColor="#33222b"
          sectionSize={10}
          sectionThickness={1}
          sectionColor="#dd1c4a"
          fadeDistance={250}
          fadeStrength={1.2}
          infiniteGrid
        />

        <Yard shed={shed} />

        {/* Laje do galpão */}
        <mesh
          position={[footprint.width / 2, 0.01, footprint.depth / 2]}
          rotation={[-Math.PI / 2, 0, 0]}
          receiveShadow
        >
          <planeGeometry args={[footprint.width, footprint.depth]} />
          <PBRMat def={getShedMaterial(shed.floor.type)} />
        </mesh>

        <Zones shed={shed} />
        <Frames shed={shed} />
        <Walls shed={shed} />
        <Roof shed={shed} />
        <Skylights shed={shed} />
        <Mezzanine shed={shed} />
        <Docks shed={shed} />

        {polygon && polygon.length >= 3 && (
          <PolygonOutline
            polygon={polygon}
            origin={[shed.lot.width / 2, shed.lot.depth / 2] as LngLat}
            offset={{ x: 0, z: 0 }}
          />
        )}

        <Html
          position={[
            footprint.width / 2,
            shed.structure.clearHeight + 5,
            footprint.depth / 2,
          ]}
          center
        >
          <div className="rounded-md bg-[#1f1c23]/95 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-white shadow-lg">
            {footprint.width.toFixed(1)} × {footprint.depth.toFixed(1)} m ·
            pé-direito {shed.structure.clearHeight} m
          </div>
        </Html>

        <OrbitControls
          makeDefault
          enableDamping
          target={[footprint.width / 2, 0, footprint.depth / 2]}
        />
        <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
          <GizmoViewport
            axisColors={["#dd1c4a", "#22d3ee", "#10b981"]}
            labelColor="white"
          />
        </GizmoHelper>
      </Canvas>
    </div>
  );
}
