// ============================================================
// sitePlanTo3D — pure deterministic builder turning a SitePlan
// into a THREE.Group. No IO, no randomness, no DOM. Safe to
// run in tests (Node) and in the browser viewer.
//
// Layer order (PRD §9):
//   1. Terrain shell (flat for v1, extruded lot polygon)
//   2. Pavement (recuos + circulação) — placeholder (skipped)
//   3. Perimeter walls (per segment) with gate gaps
//   4. Gates (frame only)
//   5. Parking stripes (skipped in v1)
//   6. Buildings (one Group per placement via buildShedMesh)
//   7. Steel-frame skeleton (uses bayCount/baySpacing/freeSpan)
//   8. Openings (skipped in v1, envelope LOD)
//
// Every child mesh is named `layer:<name>` so tests/UI can diff.
// ============================================================
import * as THREE from "three";
import type { IndustrialShed } from "./shedSchema";
import { generateFallbackShed } from "./shedDefaults";
import type {
  BuildingPlacement,
  Gate,
  PerimeterSegment,
  SitePlan,
} from "./sitePlanSchema";
import { getEdges, type V } from "./siteGeometry";

// ---- Materials (kept module-scoped to avoid recreating per call) --------

const MAT_GROUND = new THREE.MeshStandardMaterial({
  color: 0x2c3e50,
  roughness: 0.95,
  metalness: 0,
  side: THREE.DoubleSide,
});
const MAT_PERIMETER = new THREE.MeshStandardMaterial({
  color: 0x6b7280,
  roughness: 0.85,
  metalness: 0,
});
const MAT_GATE = new THREE.MeshStandardMaterial({
  color: 0x0ea5e9,
  roughness: 0.4,
  metalness: 0.6,
});
const MAT_COLUMN = new THREE.MeshStandardMaterial({
  color: 0x94a3b8,
  roughness: 0.4,
  metalness: 0.6,
});
const MAT_BEAM = new THREE.MeshStandardMaterial({
  color: 0xcbd5e1,
  roughness: 0.3,
  metalness: 0.7,
});
const MAT_ROOF = new THREE.MeshStandardMaterial({
  color: 0x475569,
  roughness: 0.6,
  metalness: 0.3,
  side: THREE.DoubleSide,
});
const MAT_WALL = new THREE.MeshStandardMaterial({
  color: 0x1e293b,
  roughness: 0.8,
  metalness: 0.2,
  transparent: true,
  opacity: 0.85,
});
const MAT_FLOOR = new THREE.MeshStandardMaterial({
  color: 0x334155,
  roughness: 0.9,
});
const MAT_WALL_BASE = new THREE.MeshStandardMaterial({
  color: 0xe7e2d8,
  roughness: 0.9,
  metalness: 0.0,
});
const MAT_WALL_METAL = new THREE.MeshStandardMaterial({
  color: 0xbcc4cc,
  roughness: 0.55,
  metalness: 0.45,
});
const MAT_ROOF_RIDGE = new THREE.MeshStandardMaterial({
  color: 0x1f2937,
  roughness: 0.6,
  metalness: 0.3,
});
const MAT_SKYLIGHT = new THREE.MeshStandardMaterial({
  color: 0x9ad7ff,
  roughness: 0.2,
  metalness: 0.1,
  transparent: true,
  opacity: 0.55,
  emissive: 0x4a90c9,
  emissiveIntensity: 0.25,
  side: THREE.DoubleSide,
});
const MAT_DOCK = new THREE.MeshStandardMaterial({
  color: 0x111827,
  roughness: 0.4,
  metalness: 0.2,
});
const MAT_DOCK_FRAME = new THREE.MeshStandardMaterial({
  color: 0xfacc15,
  roughness: 0.5,
  metalness: 0.3,
});
const MAT_PORTAL = new THREE.MeshStandardMaterial({
  color: 0x1e293b,
  roughness: 0.4,
  metalness: 0.5,
});
const MAT_OFFICE_WALL = new THREE.MeshStandardMaterial({
  color: 0xeaeaea,
  roughness: 0.7,
});
const MAT_OFFICE_SLAB = new THREE.MeshStandardMaterial({
  color: 0x9ca3af,
  roughness: 0.85,
});
const MAT_OFFICE_GLASS = new THREE.MeshStandardMaterial({
  color: 0x60a5fa,
  roughness: 0.15,
  metalness: 0.4,
  transparent: true,
  opacity: 0.55,
  emissive: 0x1d4ed8,
  emissiveIntensity: 0.12,
});
const ZONE_COLORS: Record<string, number> = {
  escritorio: 0x60a5fa,
  vestiario: 0xa78bfa,
  refeitorio: 0xf472b6,
  area_tecnica: 0x6b7280,
  avcb_hidrante: 0xef4444,
  recebimento: 0xfacc15,
  expedicao: 0xfb923c,
  picking: 0x34d399,
  armazenagem: 0x475569,
  producao: 0x06b6d4,
};

/** Visual palette per BuildingUse — keeps neighboring sheds distinguishable. */
const USE_PALETTE: Record<
  string,
  { wallBase: number; wallMetal: number; roof: number }
> = {
  logistics: { wallBase: 0xe7e2d8, wallMetal: 0xbcc4cc, roof: 0x475569 },
  industrial: { wallBase: 0xdcd3c1, wallMetal: 0x8a8f96, roof: 0x3f3f46 },
  cross_dock: { wallBase: 0xece2cf, wallMetal: 0xa3c4e0, roof: 0x1e3a5f },
  distribution_center: {
    wallBase: 0xe2dcce,
    wallMetal: 0xb8a07a,
    roof: 0x5b4636,
  },
  cold_storage: { wallBase: 0xe8edf2, wallMetal: 0xd4e4ef, roof: 0x4b6b7a },
  manufacturing: { wallBase: 0xd6cdba, wallMetal: 0x9aa6ad, roof: 0x4a5360 },
};

function paletteForUse(use: string | undefined) {
  return USE_PALETTE[use ?? "logistics"] ?? USE_PALETTE.logistics;
}

function cloneStandard(
  base: THREE.MeshStandardMaterial,
  color: number,
): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.color = new THREE.Color(color);
  return m;
}

// ---- Builder options -----------------------------------------------------

export type Lod = "structural" | "architectural";

export interface BuildSiteOptions {
  /** IndustrialShed instances indexed by id, referenced by `BuildingPlacement.shedId`. */
  shedsById?: Record<string, IndustrialShed>;
  /** Render envelope (walls + roof) when "architectural"; only skeleton when "structural". */
  lod?: Lod;
  /**
   * When true, buildings without a linked IndustrialShed receive an in-memory
   * shed derived from `placement.targetAreaM2` + `placement.use` so the viewer
   * can render walls, roof, docks, office annex, etc. The synthesized shed is
   * NEVER persisted — it only feeds the renderer.
   */
  synthesizeShed?: boolean;
}

/**
 * Returns an in-memory IndustrialShed derived from the placement metadata.
 * Used by the viewer and by UI panels when the placement has no shedId yet.
 */
export function deriveShedForPlacement(
  placement: BuildingPlacement,
): IndustrialShed {
  const { w, d } = footprintLocalSize(
    placement.footprintPolygon,
    placement.rotationRad ?? 0,
  );
  const areaM2 = Math.max(placement.targetAreaM2 ?? 0, Math.round(w * d));
  const shed = generateFallbackShed({
    areaM2,
    use: placement.use,
    standard: "medio",
  });
  // Force the synthesized footprint to match the actual placement polygon so
  // walls/roof/dock positions line up with the 2D editor.
  shed.footprint = {
    width: Math.max(6, Math.round(w)),
    depth: Math.max(6, Math.round(d)),
  };
  shed.structure.freeSpan = Math.min(
    shed.structure.freeSpan,
    shed.footprint.width,
  );
  const bayCount = Math.max(
    2,
    Math.round(shed.footprint.depth / shed.structure.baySpacing),
  );
  shed.structure.bayCount = bayCount;
  shed.structure.baySpacing = Number(
    (shed.footprint.depth / bayCount).toFixed(2),
  );
  return shed;
}

// ---- Helpers -------------------------------------------------------------

function lotShape(polygon: readonly V[]): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(polygon[0].x, polygon[0].z);
  for (let i = 1; i < polygon.length; i++) {
    shape.lineTo(polygon[i].x, polygon[i].z);
  }
  shape.closePath();
  return shape;
}

function centroidXZ(poly: readonly V[]): V {
  const c = poly.reduce((acc, v) => ({ x: acc.x + v.x, z: acc.z + v.z }), {
    x: 0,
    z: 0,
  });
  return { x: c.x / poly.length, z: c.z / poly.length };
}

function footprintSize(poly: readonly V[]): { w: number; d: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const v of poly) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.z < minZ) minZ = v.z;
    if (v.z > maxZ) maxZ = v.z;
  }
  return { w: maxX - minX, d: maxZ - minZ };
}

/**
 * Real (local-frame) width × depth of the building. The persisted
 * `footprintPolygon` is already rotated to its final orientation, but the
 * Three.js group is *also* rotated by `placement.rotationRad`, so reading the
 * AABB of the rotated polygon yields a box bigger than the actual rectangle
 * — that previously made the rendered shed visibly larger than the wizard
 * requested. Un-rotate around the centroid first to recover the original
 * dimensions used to build walls, roof and skeleton.
 */
function footprintLocalSize(
  poly: readonly V[],
  rotationRad: number,
): { w: number; d: number } {
  if (!rotationRad) return footprintSize(poly);
  const c = centroidXZ(poly);
  const cos = Math.cos(-rotationRad);
  const sin = Math.sin(-rotationRad);
  const local = poly.map((p) => {
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
  });
  return footprintSize(local);
}

// ---- Layer 1 — terrain ---------------------------------------------------

export function buildTerrainLayer(site: SitePlan): THREE.Group {
  const g = new THREE.Group();
  g.name = "layer:terrain";
  // Flat lot pad (extruded polygon) — relief comes later (F8).
  // Build vertices directly in the XZ plane (polygon.x → world.x,
  // polygon.z → world.z) so the pad matches the same orientation used by
  // perimeter walls, gates and building placements. A previous version
  // rotated by -π/2 which mirrored the lot relative to everything else.
  const shape = lotShape(site.lotPolygonLocal);
  const geom = new THREE.ShapeGeometry(shape);
  geom.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geom, MAT_GROUND);
  mesh.name = "terrain:lot-pad";
  mesh.receiveShadow = true;
  g.add(mesh);
  return g;
}

// ---- Layer 3 — perimeter -------------------------------------------------

export function buildPerimeterLayer(
  site: SitePlan,
  segments: readonly PerimeterSegment[],
  gates: readonly Gate[],
): THREE.Group {
  const g = new THREE.Group();
  g.name = "layer:perimeter";
  const edges = getEdges(site.lotPolygonLocal);
  const gatesByEdge = new Map<number, Gate[]>();
  for (const ga of gates) {
    const arr = gatesByEdge.get(ga.edgeIndex) ?? [];
    arr.push(ga);
    gatesByEdge.set(ga.edgeIndex, arr);
  }

  for (const seg of segments) {
    if (seg.kind === "vazio" || seg.height <= 0) continue;
    const edge = edges[seg.edgeIndex];
    if (!edge) continue;
    const edgeGates = (gatesByEdge.get(seg.edgeIndex) ?? [])
      .slice()
      .sort((a, b) => a.tAlongEdge - b.tAlongEdge);
    // Split edge into sub-segments around each gate (gap = gate.width).
    let cursor = 0;
    for (const gate of edgeGates) {
      const gateT = gate.tAlongEdge;
      const gapHalf = gate.width / 2 / edge.length;
      const segEnd = Math.max(cursor, gateT - gapHalf);
      if (segEnd > cursor) {
        addWallSection(g, edge, seg.height, cursor, segEnd);
      }
      cursor = Math.min(1, gateT + gapHalf);
    }
    if (cursor < 1) {
      addWallSection(g, edge, seg.height, cursor, 1);
    }
  }
  return g;
}

function addWallSection(
  parent: THREE.Group,
  edge: ReturnType<typeof getEdges>[number],
  height: number,
  t0: number,
  t1: number,
): void {
  const dx = edge.b.x - edge.a.x;
  const dz = edge.b.z - edge.a.z;
  const len = edge.length * (t1 - t0);
  if (len <= 1e-3) return;
  const cx = edge.a.x + dx * (t0 + t1) * 0.5;
  const cz = edge.a.z + dz * (t0 + t1) * 0.5;
  const angle = Math.atan2(dz, dx);
  const geom = new THREE.BoxGeometry(len, height, 0.2);
  const mesh = new THREE.Mesh(geom, MAT_PERIMETER);
  mesh.position.set(cx, height / 2, cz);
  mesh.rotation.y = -angle;
  mesh.name = `perimeter:edge${edge.index}:t${t0.toFixed(2)}-${t1.toFixed(2)}`;
  parent.add(mesh);
}

// ---- Layer 4 — gates -----------------------------------------------------

export function buildGatesLayer(
  site: SitePlan,
  gates: readonly Gate[],
): THREE.Group {
  const g = new THREE.Group();
  g.name = "layer:gates";
  const edges = getEdges(site.lotPolygonLocal);
  for (const gate of gates) {
    const edge = edges[gate.edgeIndex];
    if (!edge) continue;
    const cx = edge.a.x + (edge.b.x - edge.a.x) * gate.tAlongEdge;
    const cz = edge.a.z + (edge.b.z - edge.a.z) * gate.tAlongEdge;
    const angle = Math.atan2(edge.b.z - edge.a.z, edge.b.x - edge.a.x);
    const frameH = 3;
    const geom = new THREE.BoxGeometry(gate.width, frameH, 0.1);
    const mesh = new THREE.Mesh(geom, MAT_GATE);
    mesh.position.set(cx, frameH / 2, cz);
    mesh.rotation.y = -angle;
    mesh.name = `gate:${gate.id}`;
    g.add(mesh);
  }
  return g;
}

// ---- Layer 6/7 — shed (skeleton + envelope) -----------------------------

/**
 * Pure shed builder. Creates a Group centered at (0,0) sized by the
 * placement's footprint — caller is responsible for translating/rotating
 * the result into world space.
 *
 * When `shed` is provided, the structural grid uses real `bayCount`,
 * `baySpacing` and `freeSpan`. Otherwise dimensions fall back to the
 * footprint bbox (skeleton only — used until a shed is materialized).
 */
export function buildShedMesh(
  placement: BuildingPlacement,
  shed: IndustrialShed | undefined,
  lod: Lod = "structural",
): THREE.Group {
  const g = new THREE.Group();
  g.name = `shed:${placement.id}`;
  g.userData = {
    kind: "building",
    placementId: placement.id,
    placementName: placement.name,
    use: placement.use,
    shed,
  };
  // Use the un-rotated rectangle dimensions so we don't double-count the
  // rotation that the parent group will apply via `g.rotation.y` below.
  const { w, d } = footprintLocalSize(
    placement.footprintPolygon,
    placement.rotationRad ?? 0,
  );
  const height = shed?.structure.clearHeight ?? 8;
  const baySpacing = shed?.structure.baySpacing ?? 6;
  const bayCount =
    shed?.structure.bayCount ?? Math.max(1, Math.round(d / baySpacing));

  // Floor slab.
  const floorGeom = new THREE.PlaneGeometry(w, d);
  floorGeom.rotateX(-Math.PI / 2);
  const floor = new THREE.Mesh(floorGeom, MAT_FLOOR);
  floor.position.y = 0.02;
  floor.name = `floor:${placement.id}`;
  g.add(floor);

  // Steel-frame skeleton. `bayCount` no schema é "Nº de pórticos". Os pórticos
  // são apoiados na LINHA DA PAREDE (±w/2) e as águas (rafters) seguem
  // EXATAMENTE a mesma inclinação do telhado (roof.slopePct), de modo que a
  // estrutura acompanhe o formato real do galpão — colunas, água e cumeeira
  // coincidem com vedação e cobertura. Vigas longitudinais (eave/cumeeira) e
  // terças amarram os pórticos entre si.
  const portalCount = Math.max(2, Math.min(60, bayCount));
  const roofPitch = shed?.roof?.slopePct ?? 10;
  addSteelFrame(g, w, d, height, roofPitch, portalCount, placement.id);

  if (lod === "architectural") {
    const baseH = Math.min(
      Math.max(0, shed?.envelope.wallBaseHeight ?? 2.5),
      height - 0.5,
    );
    const palette = paletteForUse(placement.use);
    addLayeredWalls(g, w, d, height, baseH, placement.id, palette);
    addGableEnds(g, w, d, height, roofPitch, placement.id, palette);
    addGableRoof(
      g,
      w,
      d,
      height,
      shed?.roof.slopePct ?? 10,
      placement.id,
      palette,
    );
    if ((shed?.roof.skylightPct ?? 0) > 0) {
      addSkylightStrips(
        g,
        w,
        d,
        height,
        shed?.roof.slopePct ?? 10,
        shed?.roof.skylightPct ?? 4,
        placement.id,
      );
    }
    if (shed) {
      addDocks(g, shed, w, d, placement.id);
      addOpenings(g, shed, w, d, placement.id);
      addZoneFloors(g, shed, w, d, placement.id);
      addZoneVolumes(g, shed, w, d, placement.id);
      if (shed.mezzanine) {
        addMezzanine(g, shed, w, d, placement.id);
      }
    }
  }

  return g;
}

/** Small helper: an axis-aligned box mesh with a layer-prefixed name. */
function addNamedBox(
  parent: THREE.Group,
  size: [number, number, number],
  pos: [number, number, number],
  mat: THREE.Material,
  name: string,
  rotZ = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), mat);
  mesh.position.set(...pos);
  if (rotZ) mesh.rotation.z = rotZ;
  mesh.name = name;
  parent.add(mesh);
  return mesh;
}

/**
 * Realistic single-span steel portal frame skeleton.
 *
 * • Columns sit on the wall line (±width/2) so the frame footprint equals the
 *   envelope footprint.
 * • Rafters follow the SAME gable pitch as the roof (rise = halfWidth·pitch%),
 *   meeting at the ridge — the steel now matches the real shed shape.
 * • Knee braces stiffen each eave joint; an apex post supports the ridge.
 * • Longitudinal members (eave beams + ridge beam) and roof purlins (terças)
 *   tie the portals together, giving a believable industrial skeleton.
 *
 * Every mesh keeps the `column:`/`truss:` name prefixes so the viewer's
 * "Estrutura" layer toggle continues to work.
 */
function addSteelFrame(
  parent: THREE.Group,
  width: number,
  depth: number,
  eaveHeight: number,
  pitchPct: number,
  portalCount: number,
  id: string,
): void {
  const halfW = width / 2;
  const rise = halfW * (pitchPct / 100);
  const count = Math.max(2, Math.min(60, portalCount));
  const spacing = depth / (count - 1);
  const colW = Math.min(0.55, Math.max(0.3, eaveHeight * 0.045));
  const rafterH = Math.max(0.24, colW * 0.85);
  const rafLen = Math.hypot(halfW, rise);
  const rafAng = Math.atan2(rise, halfW);

  for (let i = 0; i < count; i++) {
    const z = -depth / 2 + i * spacing;
    // Columns on the wall line + base plates.
    for (const dir of [-1, 1] as const) {
      const cx = dir * (halfW - colW / 2);
      const side = dir < 0 ? "L" : "R";
      addNamedBox(
        parent,
        [colW, eaveHeight, colW],
        [cx, eaveHeight / 2, z],
        MAT_COLUMN,
        `column:${id}:b${i}:${side}`,
      );
      addNamedBox(
        parent,
        [colW * 2.1, 0.12, colW * 2.1],
        [cx, 0.06, z],
        MAT_BEAM,
        `column:${id}:b${i}:${side}:base`,
      );
      // Rafter (top chord) following the roof pitch.
      addNamedBox(
        parent,
        [rafLen, rafterH, 0.16],
        [(halfW / 2) * dir, eaveHeight + rise / 2, z],
        MAT_BEAM,
        `truss:${id}:b${i}:rafter${dir > 0 ? "R" : "L"}`,
        -rafAng * dir,
      );
      // Knee brace at the eave joint (45°-ish gusset strut).
      const braceLen = Math.min(2.2, eaveHeight * 0.35);
      addNamedBox(
        parent,
        [braceLen, 0.14, 0.12],
        [
          dir * (halfW - braceLen * 0.55),
          eaveHeight - braceLen * 0.4,
          z,
        ],
        MAT_BEAM,
        `truss:${id}:b${i}:knee${dir > 0 ? "R" : "L"}`,
        dir * (Math.PI / 4),
      );
    }
    // Apex post tying both rafters at the ridge.
    addNamedBox(
      parent,
      [0.16, Math.max(0.6, rise * 0.9), 0.16],
      [0, eaveHeight + rise - Math.max(0.6, rise * 0.9) / 2, z],
      MAT_COLUMN,
      `truss:${id}:b${i}:apex`,
    );
  }

  // Longitudinal eave beams (both walls) + ridge beam tie portals along Z.
  for (const dir of [-1, 1] as const) {
    addNamedBox(
      parent,
      [0.2, 0.24, depth],
      [dir * (halfW - colW / 2), eaveHeight - 0.12, 0],
      MAT_BEAM,
      `truss:${id}:eave${dir > 0 ? "R" : "L"}`,
    );
  }
  addNamedBox(
    parent,
    [0.2, 0.22, depth],
    [0, eaveHeight + rise - 0.11, 0],
    MAT_BEAM,
    `truss:${id}:ridge`,
  );

  // Roof purlins (terças) running along Z on each slope.
  const purlinsPerSlope = Math.max(2, Math.round(rafLen / 1.6));
  for (const dir of [-1, 1] as const) {
    for (let p = 1; p <= purlinsPerSlope; p++) {
      const t = p / (purlinsPerSlope + 1); // 0..1 from eave to ridge
      const px = dir * halfW * (1 - t);
      const py = eaveHeight + rise * t + rafterH * 0.6;
      addNamedBox(
        parent,
        [0.09, 0.12, depth],
        [px, py, 0],
        MAT_COLUMN,
        `truss:${id}:purlin${dir > 0 ? "R" : "L"}:${p}`,
      );
    }
  }
}

function addWalls(
  parent: THREE.Group,
  width: number,
  depth: number,
  height: number,
  id: string,
): void {
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, 0.1),
    MAT_WALL,
  );
  back.position.set(0, height / 2, -depth / 2);
  back.name = `wall:${id}:back`;
  parent.add(back);

  const front = back.clone();
  front.position.z = depth / 2;
  front.name = `wall:${id}:front`;
  parent.add(front);

  const left = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, height, depth),
    MAT_WALL,
  );
  left.position.set(-width / 2, height / 2, 0);
  left.name = `wall:${id}:left`;
  parent.add(left);

  const right = left.clone();
  right.position.x = width / 2;
  right.name = `wall:${id}:right`;
  parent.add(right);
}

/** Walls split into a base (alvenaria) and an upper sheet metal cladding. */
function addLayeredWalls(
  parent: THREE.Group,
  width: number,
  depth: number,
  height: number,
  baseH: number,
  id: string,
  palette?: { wallBase: number; wallMetal: number },
): void {
  const upperH = Math.max(0, height - baseH);
  const baseMat = palette
    ? cloneStandard(MAT_WALL_BASE, palette.wallBase)
    : MAT_WALL_BASE;
  const metalMat = palette
    ? cloneStandard(MAT_WALL_METAL, palette.wallMetal)
    : MAT_WALL_METAL;
  const walls = [
    { name: "front", w: width, d: 0.18, x: 0, z: depth / 2, ry: 0 },
    { name: "back", w: width, d: 0.18, x: 0, z: -depth / 2, ry: 0 },
    { name: "left", w: 0.18, d: depth, x: -width / 2, z: 0, ry: 0 },
    { name: "right", w: 0.18, d: depth, x: width / 2, z: 0, ry: 0 },
  ];
  for (const wlObj of walls) {
    if (baseH > 0) {
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(wlObj.w, baseH, wlObj.d),
        baseMat,
      );
      base.position.set(wlObj.x, baseH / 2, wlObj.z);
      base.name = `wall:${id}:${wlObj.name}:base`;
      parent.add(base);
    }
    if (upperH > 0) {
      const upper = new THREE.Mesh(
        new THREE.BoxGeometry(wlObj.w, upperH, wlObj.d),
        metalMat,
      );
      upper.position.set(wlObj.x, baseH + upperH / 2, wlObj.z);
      upper.name = `wall:${id}:${wlObj.name}:upper`;
      parent.add(upper);
    }
  }
}

/** Triangular gable-end infill closing the wall under the roof peak on the
 * front and back faces (avoids a visible open triangle between eave and ridge). */
function addGableEnds(
  parent: THREE.Group,
  width: number,
  depth: number,
  eaveHeight: number,
  pitchPct: number,
  id: string,
  palette?: { wallMetal: number },
): void {
  const halfW = width / 2;
  const rise = halfW * (pitchPct / 100);
  if (rise < 0.05) return;
  const mat = palette
    ? cloneStandard(MAT_WALL_METAL, palette.wallMetal)
    : MAT_WALL_METAL.clone();
  mat.side = THREE.DoubleSide;
  const shape = new THREE.Shape();
  shape.moveTo(-halfW, 0);
  shape.lineTo(halfW, 0);
  shape.lineTo(0, rise);
  shape.closePath();
  const geom = new THREE.ShapeGeometry(shape);
  for (const dir of [-1, 1] as const) {
    const m = new THREE.Mesh(geom.clone(), mat);
    m.position.set(0, eaveHeight, dir * (depth / 2));
    m.name = `wall:${id}:gable${dir > 0 ? "F" : "B"}`;
    parent.add(m);
  }
  geom.dispose();
}

/** Colored floor patches marking each functional program area (zoneamento).
 * Renders one thin translucent slab per zone so the user can read the
 * intended use of every part of the shed floor. */
function addZoneFloors(
  parent: THREE.Group,
  shed: IndustrialShed,
  width: number,
  depth: number,
  id: string,
): void {
  if (!shed.zones || shed.zones.length === 0) return;
  const halfW = width / 2;
  const halfD = depth / 2;
  const sx = width / Math.max(1, shed.footprint.width);
  const sz = depth / Math.max(1, shed.footprint.depth);
  let i = 0;
  for (const zone of shed.zones) {
    const zw = Math.max(1, zone.width * sx);
    const zd = Math.max(1, zone.depth * sz);
    const zx = -halfW + zone.x * sx + zw / 2;
    const zz = -halfD + zone.z * sz + zd / 2;
    const color = ZONE_COLORS[zone.type] ?? 0x9ca3af;
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.85,
      metalness: 0.05,
      transparent: true,
      opacity: 0.38,
      emissive: new THREE.Color(color),
      emissiveIntensity: 0.12,
    });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(zw, 0.06, zd), mat);
    slab.position.set(zx, 0.07, zz);
    slab.name = `zone:${id}:${zone.type}:${i}:floor`;
    parent.add(slab);
    i++;
  }
}

function addGableRoof(
  parent: THREE.Group,
  width: number,
  depth: number,
  baseY: number,
  pitchPct: number,
  id: string,
  palette?: { roof: number },
): void {
  const halfWidth = width / 2;
  const rise = halfWidth * (pitchPct / 100);
  const slopeLen = Math.hypot(halfWidth, rise);
  const g = new THREE.Group();
  g.position.y = baseY;
  g.name = `roof:${id}`;
  const roofMat = palette ? cloneStandard(MAT_ROOF, palette.roof) : MAT_ROOF;
  for (const dir of [-1, 1] as const) {
    const angle = Math.atan2(rise, halfWidth) * dir;
    const slope = new THREE.Mesh(
      new THREE.BoxGeometry(slopeLen, 0.05, depth),
      roofMat,
    );
    slope.position.set((halfWidth / 2) * dir, rise / 2, 0);
    slope.rotation.z = -angle;
    slope.castShadow = true;
    slope.name = `roof:${id}:${dir > 0 ? "R" : "L"}`;
    g.add(slope);
  }
  // Ridge cap.
  const ridge = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.18, depth + 0.4),
    MAT_ROOF_RIDGE,
  );
  ridge.position.y = rise + 0.05;
  ridge.name = `roof:${id}:ridge`;
  g.add(ridge);
  parent.add(g);
}

/** Skylight strips along the roof slopes (sized by `skylightPct`). */
function addSkylightStrips(
  parent: THREE.Group,
  width: number,
  depth: number,
  baseY: number,
  pitchPct: number,
  skylightPct: number,
  id: string,
): void {
  const halfWidth = width / 2;
  const rise = halfWidth * (pitchPct / 100);
  const slopeLen = Math.hypot(halfWidth, rise);
  // Skylight = fraction of roof area split into 2 strips on each slope.
  const stripWidth = Math.max(0.6, (slopeLen * skylightPct) / 100 / 2);
  const g = new THREE.Group();
  g.position.y = baseY;
  g.name = `roof:${id}:skylights`;
  for (const dir of [-1, 1] as const) {
    const angle = Math.atan2(rise, halfWidth) * dir;
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(stripWidth, 0.06, depth * 0.8),
      MAT_SKYLIGHT,
    );
    // Place at ~60% up the slope from the eave.
    const t = 0.6;
    const x = halfWidth * (1 - t) * dir;
    const y = rise * t + 0.04;
    strip.position.set(x, y, 0);
    strip.rotation.z = -angle;
    strip.name = `skylight:${id}:${dir > 0 ? "R" : "L"}`;
    g.add(strip);
  }
  parent.add(g);
}

/** Dock doors rendered as colored rectangles flush with the chosen wall. */
function addDocks(
  parent: THREE.Group,
  shed: IndustrialShed,
  width: number,
  depth: number,
  id: string,
): void {
  if (!shed.docks || shed.docks.length === 0) return;
  const dockWidth = 3;
  const dockHeight = 3.5;
  // Treat shed's local north (z=depth) as our +Z front.
  const halfW = width / 2;
  const halfD = depth / 2;
  let i = 0;
  for (const dock of shed.docks) {
    let x = 0;
    let z = 0;
    let rotY = 0;
    if (dock.wall === "north" || dock.wall === "south") {
      // Map shed.x in [0..shed.footprint.width] → local [-halfW..halfW].
      const relX = (dock.x / Math.max(1, shed.footprint.width)) * width;
      x = -halfW + relX;
      z = dock.wall === "north" ? halfD - 0.11 : -halfD + 0.11;
      rotY = 0;
    } else {
      const relZ = (dock.z / Math.max(1, shed.footprint.depth)) * depth;
      z = -halfD + relZ;
      x = dock.wall === "east" ? halfW - 0.11 : -halfW + 0.11;
      rotY = Math.PI / 2;
    }
    // Door + frame.
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(dockWidth, dockHeight, 0.05),
      MAT_DOCK,
    );
    door.position.set(x, dockHeight / 2 + 0.1, z);
    door.rotation.y = rotY;
    door.name = `dock:${id}:${i}`;
    parent.add(door);
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(dockWidth + 0.4, 0.15, 0.05),
      MAT_DOCK_FRAME,
    );
    frame.position.set(x, dockHeight + 0.1, z);
    frame.rotation.y = rotY;
    frame.name = `dock:${id}:${i}:lintel`;
    parent.add(frame);
    i++;
  }
}

/** Sectional portals + man-doors as visible openings on the chosen wall. */
function addOpenings(
  parent: THREE.Group,
  shed: IndustrialShed,
  width: number,
  depth: number,
  id: string,
): void {
  if (!shed.openings || shed.openings.length === 0) return;
  const halfW = width / 2;
  const halfD = depth / 2;
  let i = 0;
  for (const op of shed.openings) {
    if (
      op.type !== "portao_seccional" &&
      op.type !== "portao_enrolar" &&
      op.type !== "porta_pessoal"
    ) {
      i++;
      continue;
    }
    const w = Math.min(op.width, width * 0.5);
    const h = Math.min(op.height, 6);
    let x = 0;
    let z = 0;
    let rotY = 0;
    if (op.wall === "north" || op.wall === "south") {
      const wallLen = width;
      const relX =
        (op.xAlongWall / Math.max(1, shed.footprint.width)) * wallLen;
      x = -halfW + relX + w / 2;
      z = op.wall === "north" ? halfD - 0.11 : -halfD + 0.11;
    } else {
      const wallLen = depth;
      const relZ =
        (op.xAlongWall / Math.max(1, shed.footprint.depth)) * wallLen;
      z = -halfD + relZ + w / 2;
      x = op.wall === "east" ? halfW - 0.11 : -halfW + 0.11;
      rotY = Math.PI / 2;
    }
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.07), MAT_PORTAL);
    m.position.set(x, h / 2 + (op.elevation || 0), z);
    m.rotation.y = rotY;
    m.name = `opening:${id}:${op.type}:${i}`;
    parent.add(m);
    i++;
  }
}

/** Office / vestiário / refeitório blocks — multi-floor when zone.height fits. */
function addZoneVolumes(
  parent: THREE.Group,
  shed: IndustrialShed,
  width: number,
  depth: number,
  id: string,
): void {
  if (!shed.zones || shed.zones.length === 0) return;
  const halfW = width / 2;
  const halfD = depth / 2;
  const sx = width / Math.max(1, shed.footprint.width);
  const sz = depth / Math.max(1, shed.footprint.depth);
  let i = 0;
  for (const zone of shed.zones) {
    // Only render closed-program zones as solid blocks (skip armazenagem/picking that are open floor).
    const closed = [
      "escritorio",
      "vestiario",
      "refeitorio",
      "area_tecnica",
      "avcb_hidrante",
    ].includes(zone.type);
    if (!closed) {
      i++;
      continue;
    }
    const zw = Math.max(1.5, zone.width * sx);
    const zd = Math.max(1.5, zone.depth * sz);
    const zx = -halfW + zone.x * sx + zw / 2;
    const zz = -halfD + zone.z * sz + zd / 2;
    const floorH = 3;
    const totalH = Math.max(
      floorH,
      Math.min(zone.height, shed.structure.clearHeight),
    );
    const floors = Math.max(1, Math.floor(totalH / floorH));
    const wallMat =
      zone.type === "escritorio" ? MAT_OFFICE_GLASS : MAT_OFFICE_WALL;
    const blockColor = ZONE_COLORS[zone.type] ?? 0x9ca3af;
    for (let f = 0; f < floors; f++) {
      const yBase = f * floorH;
      // Slab.
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(zw, 0.18, zd),
        MAT_OFFICE_SLAB,
      );
      slab.position.set(zx, yBase + 0.09, zz);
      slab.name = `zone:${id}:${zone.type}:${i}:slab:${f}`;
      parent.add(slab);
      // Walls envelope.
      const wallH = floorH - 0.2;
      const tinted = wallMat.clone();
      tinted.color = new THREE.Color(blockColor);
      tinted.opacity = wallMat.opacity;
      tinted.transparent = wallMat.transparent;
      tinted.metalness = wallMat.metalness;
      tinted.roughness = wallMat.roughness;
      tinted.emissive = wallMat.emissive
        ? wallMat.emissive.clone()
        : new THREE.Color(0x000000);
      tinted.emissiveIntensity = wallMat.emissiveIntensity ?? 0;
      // four thin walls
      const wallFront = new THREE.Mesh(
        new THREE.BoxGeometry(zw, wallH, 0.08),
        tinted,
      );
      wallFront.position.set(zx, yBase + 0.18 + wallH / 2, zz + zd / 2);
      wallFront.name = `zone:${id}:${zone.type}:${i}:wall:f:${f}`;
      parent.add(wallFront);
      const wallBack = wallFront.clone();
      wallBack.position.z = zz - zd / 2;
      wallBack.name = `zone:${id}:${zone.type}:${i}:wall:b:${f}`;
      parent.add(wallBack);
      const wallLeft = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, wallH, zd),
        tinted,
      );
      wallLeft.position.set(zx - zw / 2, yBase + 0.18 + wallH / 2, zz);
      wallLeft.name = `zone:${id}:${zone.type}:${i}:wall:l:${f}`;
      parent.add(wallLeft);
      const wallRight = wallLeft.clone();
      wallRight.position.x = zx + zw / 2;
      wallRight.name = `zone:${id}:${zone.type}:${i}:wall:r:${f}`;
      parent.add(wallRight);
    }
    i++;
  }
}

function addMezzanine(
  parent: THREE.Group,
  shed: IndustrialShed,
  width: number,
  depth: number,
  id: string,
): void {
  const m = shed.mezzanine;
  if (!m) return;
  const sx = width / Math.max(1, shed.footprint.width);
  const sz = depth / Math.max(1, shed.footprint.depth);
  const halfW = width / 2;
  const halfD = depth / 2;
  const mw = Math.max(1.5, m.width * sx);
  const md = Math.max(1.5, m.depth * sz);
  const mx = -halfW + m.x * sx + mw / 2;
  const mz = -halfD + m.z * sz + md / 2;
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(mw, 0.2, md),
    MAT_OFFICE_SLAB,
  );
  slab.position.set(mx, m.height, mz);
  slab.name = `mezzanine:${id}`;
  parent.add(slab);
  // Guard rail (thin upper edge).
  const rail = new THREE.Mesh(new THREE.BoxGeometry(mw, 1.0, 0.04), MAT_BEAM);
  rail.position.set(mx, m.height + 0.6, mz + md / 2);
  rail.name = `mezzanine:${id}:rail`;
  parent.add(rail);
}

// ---- Top-level builder ---------------------------------------------------

/**
 * Builds the entire site as a THREE.Group. Deterministic and pure.
 */
export function sitePlanTo3D(
  site: SitePlan,
  opts: BuildSiteOptions = {},
): THREE.Group {
  const lod: Lod = opts.lod ?? "structural";
  const sheds = opts.shedsById ?? {};
  const root = new THREE.Group();
  root.name = "site";

  root.add(buildTerrainLayer(site));
  root.add(buildPerimeterLayer(site, site.perimeter.segments, site.gates));
  root.add(buildGatesLayer(site, site.gates));

  // Buildings layer.
  const buildingsGroup = new THREE.Group();
  buildingsGroup.name = "layer:buildings";
  const synth = opts.synthesizeShed ?? false;
  for (const placement of site.buildings) {
    // Priority: embedded shed > linked shed via shedId > synthesized fallback.
    let shed: IndustrialShed | undefined =
      placement.shed ??
      (placement.shedId ? sheds[placement.shedId] : undefined);
    if (!shed && synth) shed = deriveShedForPlacement(placement);
    const g = buildShedMesh(placement, shed, lod);
    const c = centroidXZ(placement.footprintPolygon);
    g.position.set(c.x, placement.z0, c.z);
    g.rotation.y = placement.rotationRad;
    buildingsGroup.add(g);
  }
  root.add(buildingsGroup);
  return root;
}

// ---- Clamp test helper ---------------------------------------------------

/**
 * Iterates every Mesh in `group` and asserts that all of its world-space
 * vertices (projected to the XZ plane) lie inside `lotPolygon`. Returns the
 * list of offending mesh names — empty when fully contained.
 */
export function findOutsideLot(
  group: THREE.Object3D,
  lotPolygon: readonly V[],
): string[] {
  const offenders: string[] = [];
  group.updateMatrixWorld(true);
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!(mesh as { isMesh?: boolean }).isMesh) return;
    const geom = mesh.geometry as THREE.BufferGeometry;
    const pos = geom.getAttribute("position") as
      | THREE.BufferAttribute
      | undefined;
    if (!pos) return;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      tmp.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (!pointInLot({ x: tmp.x, z: tmp.z }, lotPolygon)) {
        offenders.push(mesh.name || mesh.uuid);
        return;
      }
    }
  });
  return offenders;
}

function pointInLot(pt: V, poly: readonly V[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const zi = poly[i].z;
    const xj = poly[j].x;
    const zj = poly[j].z;
    const intersect =
      zi > pt.z !== zj > pt.z &&
      pt.x < ((xj - xi) * (pt.z - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
