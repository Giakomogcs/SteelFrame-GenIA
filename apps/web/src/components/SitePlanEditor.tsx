"use client";

/**
 * SitePlanEditor — SVG 2D editor (drag + rotate of building footprints).
 *
 * Per PRD §3 non-objective: no arbitrary vertex editing in v1. Each
 * building is a polygon translated/rotated as a rigid body. Snap to
 * 0.5 m. Emits a debounced `onChange(site)` with the patched SitePlan.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { SitePlan, BuildingPlacement } from "@/lib/sitePlanSchema";
import { polygonBBox, getEdges } from "@/lib/siteGeometry";
import { validateSitePlan } from "@/lib/siteConstraints";

interface Props {
  site: SitePlan;
  onChange: (next: SitePlan) => void;
  /** Debounce window for onChange in ms (PRD: 300). */
  debounceMs?: number;
}

const SNAP = 0.5;

function centroid(poly: { x: number; z: number }[]) {
  let sx = 0;
  let sz = 0;
  for (const p of poly) {
    sx += p.x;
    sz += p.z;
  }
  return { x: sx / poly.length, z: sz / poly.length };
}

function translatePoly(
  poly: { x: number; z: number }[],
  dx: number,
  dz: number,
) {
  return poly.map((p) => ({ x: p.x + dx, z: p.z + dz }));
}

function rotatePoly(
  poly: { x: number; z: number }[],
  pivot: { x: number; z: number },
  rad: number,
) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return poly.map((p) => {
    const dx = p.x - pivot.x;
    const dz = p.z - pivot.z;
    return {
      x: pivot.x + dx * c - dz * s,
      z: pivot.z + dx * s + dz * c,
    };
  });
}

export default function SitePlanEditor({ site, onChange, debounceMs = 300 }: Props) {
  const lot = site.lotPolygonLocal;
  const edges = useMemo(() => getEdges(lot), [lot]);
  const bb = useMemo(() => polygonBBox(lot), [lot]);
  const pad = Math.max(bb.width, bb.depth) * 0.1;
  const vb = { x: bb.minX - pad, z: bb.minZ - pad, w: bb.width + pad * 2, h: bb.depth + pad * 2 };

  const [local, setLocal] = useState<SitePlan>(site);
  const [drag, setDrag] = useState<{
    id: string;
    startX: number;
    startZ: number;
    origPoly: { x: number; z: number }[];
    mode: "move" | "rotate";
    pivot: { x: number; z: number };
    startAngle?: number;
    origRot: number;
  } | null>(null);

  useEffect(() => setLocal(site), [site]);

  // Debounced emit.
  useEffect(() => {
    if (local === site) return;
    const t = window.setTimeout(() => onChange(local), debounceMs);
    return () => window.clearTimeout(t);
  }, [local, site, onChange, debounceMs]);

  const svgRef = useRef<SVGSVGElement | null>(null);

  function svgPoint(evt: React.PointerEvent): { x: number; z: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, z: p.y };
  }

  function startDrag(
    evt: React.PointerEvent,
    b: BuildingPlacement,
    mode: "move" | "rotate",
  ) {
    const p = svgPoint(evt);
    if (!p) return;
    const pivot = centroid(b.footprintPolygon);
    setDrag({
      id: b.id,
      startX: p.x,
      startZ: p.z,
      origPoly: b.footprintPolygon,
      mode,
      pivot,
      startAngle: mode === "rotate" ? Math.atan2(p.z - pivot.z, p.x - pivot.x) : undefined,
      origRot: b.rotationRad,
    });
    (evt.target as Element).setPointerCapture?.(evt.pointerId);
  }

  function onMove(evt: React.PointerEvent) {
    if (!drag) return;
    const p = svgPoint(evt);
    if (!p) return;
    setLocal((prev) => {
      const buildings = prev.buildings.map((b) => {
        if (b.id !== drag.id) return b;
        if (drag.mode === "move") {
          let dx = p.x - drag.startX;
          let dz = p.z - drag.startZ;
          dx = Math.round(dx / SNAP) * SNAP;
          dz = Math.round(dz / SNAP) * SNAP;
          return { ...b, footprintPolygon: translatePoly(drag.origPoly, dx, dz) };
        } else {
          const a = Math.atan2(p.z - drag.pivot.z, p.x - drag.pivot.x);
          const delta = a - (drag.startAngle ?? a);
          // Snap 15°.
          const snap = (Math.PI / 180) * 15;
          const snapped = Math.round(delta / snap) * snap;
          return {
            ...b,
            footprintPolygon: rotatePoly(drag.origPoly, drag.pivot, snapped),
            rotationRad: drag.origRot + snapped,
          };
        }
      });
      const candidate = { ...prev, buildings };
      const report = validateSitePlan(candidate);
      return { ...candidate, validations: report };
    });
  }

  function endDrag() {
    setDrag(null);
  }

  const pts = (poly: { x: number; z: number }[]) =>
    poly.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`).join(" ");

  const streetSet = new Set(local.streetEdges);

  return (
    <svg
      ref={svgRef}
      className="site-editor"
      viewBox={`${vb.x} ${vb.z} ${vb.w} ${vb.h}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      style={{ width: "100%", height: "100%", touchAction: "none" }}
      role="img"
      aria-label="Editor da planta baixa"
    >
      <polygon
        points={pts(lot)}
        fill="#0f172a"
        stroke="#475569"
        strokeWidth={Math.max(0.2, vb.w * 0.001)}
      />
      {edges.map((e) => (
        <line
          key={e.index}
          x1={e.a.x}
          y1={e.a.z}
          x2={e.b.x}
          y2={e.b.z}
          stroke={streetSet.has(e.index) ? "#f59e0b" : "#475569"}
          strokeWidth={Math.max(0.3, vb.w * 0.002)}
        />
      ))}
      {local.gates.map((g) => {
        const e = edges[g.edgeIndex];
        if (!e) return null;
        const cx = e.a.x + (e.b.x - e.a.x) * g.tAlongEdge;
        const cz = e.a.z + (e.b.z - e.a.z) * g.tAlongEdge;
        return (
          <circle key={g.id} cx={cx} cy={cz} r={Math.max(0.5, g.width / 4)} fill="#0ea5e9" />
        );
      })}
      {local.buildings.map((b) => {
        const c = centroid(b.footprintPolygon);
        return (
          <g key={b.id}>
            <polygon
              points={pts(b.footprintPolygon)}
              fill="#3b82f6"
              fillOpacity={0.55}
              stroke="#60a5fa"
              strokeWidth={Math.max(0.2, vb.w * 0.0015)}
              style={{ cursor: "move" }}
              onPointerDown={(e) => startDrag(e, b, "move")}
            />
            <circle
              cx={c.x}
              cy={c.z}
              r={Math.max(0.8, vb.w * 0.005)}
              fill="#fbbf24"
              style={{ cursor: "alias" }}
              onPointerDown={(e) => startDrag(e, b, "rotate")}
            >
              <title>Arrastar para rotacionar (snap 15°)</title>
            </circle>
            <text
              x={c.x}
              y={c.z}
              fontSize={Math.max(1.5, vb.w * 0.012)}
              fill="#fff"
              textAnchor="middle"
              dominantBaseline="central"
              pointerEvents="none"
            >
              {b.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
