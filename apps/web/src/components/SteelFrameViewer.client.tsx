"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, Environment, Html } from "@react-three/drei";
import * as THREE from "three";
import { useMemo } from "react";
import type { SteelFrameModel } from "@/lib/steelframe";
import type { LngLat } from "@/lib/geo";
import { toLocalMeters } from "@/lib/geo";

interface Props {
  model: SteelFrameModel;
  polygon: LngLat[];
}

const COLUMN_SIZE = 0.3;

function Column({ x, z, height }: { x: number; z: number; height: number }) {
  return (
    <mesh position={[x, height / 2, z]} castShadow receiveShadow>
      <boxGeometry args={[COLUMN_SIZE, height, COLUMN_SIZE]} />
      <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.4} />
    </mesh>
  );
}

function Truss({
  z,
  span,
  height,
  baseY,
}: {
  z: number;
  span: number;
  height: number;
  baseY: number;
}) {
  // Banzo inferior + duas inclinadas + montante central (simplificado)
  const halfSpan = span / 2;
  return (
    <group position={[0, baseY, z]}>
      {/* Banzo inferior */}
      <mesh>
        <boxGeometry args={[span, 0.15, 0.15]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Águas */}
      {[-1, 1].map((dir) => {
        const len = Math.sqrt(halfSpan * halfSpan + height * height);
        const angle = Math.atan2(height, halfSpan) * dir;
        return (
          <mesh
            key={dir}
            position={[(halfSpan / 2) * dir, height / 2, 0]}
            rotation={[0, 0, -angle]}
          >
            <boxGeometry args={[len, 0.15, 0.15]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.7} roughness={0.3} />
          </mesh>
        );
      })}
      {/* Montante central */}
      <mesh position={[0, height / 2, 0]}>
        <boxGeometry args={[0.12, height, 0.12]} />
        <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
}

function Roof({
  width,
  depth,
  baseY,
  pitchDeg,
}: {
  width: number;
  depth: number;
  baseY: number;
  pitchDeg: number;
}) {
  const halfWidth = width / 2;
  const rise = halfWidth * Math.tan((pitchDeg * Math.PI) / 180);
  const slopeLen = Math.sqrt(halfWidth * halfWidth + rise * rise);

  return (
    <group position={[0, baseY, 0]}>
      {[-1, 1].map((dir) => {
        const angle = Math.atan2(rise, halfWidth) * dir;
        return (
          <mesh
            key={dir}
            position={[(halfWidth / 2) * dir, rise / 2, 0]}
            rotation={[0, 0, -angle]}
            castShadow
          >
            <boxGeometry args={[slopeLen, 0.05, depth]} />
            <meshStandardMaterial
              color="#475569"
              metalness={0.3}
              roughness={0.6}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function Walls({
  width,
  depth,
  height,
  doors,
}: {
  width: number;
  depth: number;
  height: number;
  doors: number;
}) {
  const doorWidth = 4;
  const doorHeight = Math.min(height * 0.8, 6);
  const wallMat = (
    <meshStandardMaterial color="#1e293b" metalness={0.2} roughness={0.8} transparent opacity={0.85} />
  );

  return (
    <group>
      {/* Parede trás */}
      <mesh position={[0, height / 2, -depth / 2]}>
        <boxGeometry args={[width, height, 0.1]} />
        {wallMat}
      </mesh>
      {/* Paredes laterais */}
      <mesh position={[-width / 2, height / 2, 0]}>
        <boxGeometry args={[0.1, height, depth]} />
        {wallMat}
      </mesh>
      <mesh position={[width / 2, height / 2, 0]}>
        <boxGeometry args={[0.1, height, depth]} />
        {wallMat}
      </mesh>
      {/* Fachada com portões */}
      <group position={[0, 0, depth / 2]}>
        <mesh position={[0, height / 2, 0]}>
          <boxGeometry args={[width, height, 0.1]} />
          {wallMat}
        </mesh>
        {Array.from({ length: doors }).map((_, i) => {
          const step = width / (doors + 1);
          const x = -width / 2 + step * (i + 1);
          return (
            <mesh key={i} position={[x, doorHeight / 2, 0.06]}>
              <boxGeometry args={[doorWidth, doorHeight, 0.05]} />
              <meshStandardMaterial color="#0ea5e9" metalness={0.4} roughness={0.5} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

function TerrainOutline({ polygon, origin }: { polygon: LngLat[]; origin: LngLat }) {
  const points = useMemo(() => {
    const local = toLocalMeters(polygon, origin);
    const closed = [...local, local[0]];
    return closed.map((p) => new THREE.Vector3(p.x, 0.01, -p.y));
  }, [polygon, origin]);

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints(points);
    return g;
  }, [points]);

  return (
    <line>
      <primitive object={geom} attach="geometry" />
      <lineBasicMaterial color="#22d3ee" linewidth={2} />
    </line>
  );
}

export default function SteelFrameViewer({ model, polygon }: Props) {
  const { footprint, height, pitchDeg, columns, trusses, doors, mezzanine } = model;
  const camDist = Math.max(footprint.width, footprint.depth) * 1.3 + 20;

  return (
    <div className="h-[70vh] overflow-hidden rounded-xl border border-white/10 bg-slate-950">
      <Canvas
        shadows
        camera={{ position: [camDist, camDist * 0.7, camDist], fov: 45 }}
      >
        <color attach="background" args={["#0c1f33"]} />
        <ambientLight intensity={0.4} />
        <directionalLight
          position={[40, 60, 30]}
          intensity={1.1}
          castShadow
          shadow-mapSize={[2048, 2048]}
        />
        <Environment preset="city" />

        <Grid
          args={[300, 300]}
          cellSize={1}
          cellThickness={0.5}
          cellColor="#1e3a5f"
          sectionSize={10}
          sectionThickness={1}
          sectionColor="#0ea5e9"
          fadeDistance={200}
          fadeStrength={1}
          infiniteGrid
        />

        <TerrainOutline polygon={polygon} origin={model.origin} />

        {/* Piso do galpão */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
          receiveShadow
        >
          <planeGeometry args={[footprint.width, footprint.depth]} />
          <meshStandardMaterial color="#334155" roughness={0.9} />
        </mesh>

        {/* Estrutura */}
        {columns.map((c, i) => (
          <Column key={i} {...c} />
        ))}
        {trusses.map((t, i) => (
          <Truss
            key={i}
            z={t.z}
            span={t.span}
            height={t.height}
            baseY={height}
          />
        ))}

        <Roof
          width={footprint.width}
          depth={footprint.depth}
          baseY={height}
          pitchDeg={pitchDeg}
        />

        <Walls
          width={footprint.width}
          depth={footprint.depth}
          height={height}
          doors={doors}
        />

        {mezzanine && (
          <mesh position={[0, height * 0.4, -footprint.depth / 4]}>
            <boxGeometry
              args={[footprint.width * 0.95, 0.15, footprint.depth * 0.45]}
            />
            <meshStandardMaterial color="#64748b" />
          </mesh>
        )}

        <Html position={[0, height + 5, 0]} center>
          <div className="rounded bg-slate-900/80 px-2 py-1 text-xs text-slate-200">
            {footprint.width.toFixed(1)} × {footprint.depth.toFixed(1)} m
          </div>
        </Html>

        <OrbitControls makeDefault enableDamping />
      </Canvas>
    </div>
  );
}
