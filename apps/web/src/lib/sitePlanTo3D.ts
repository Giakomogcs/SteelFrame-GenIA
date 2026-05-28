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

// ---- Builder options -----------------------------------------------------

export type Lod = "structural" | "architectural";

export interface BuildSiteOptions {
  /** IndustrialShed instances indexed by id, referenced by `BuildingPlacement.shedId`. */
  shedsById?: Record<string, IndustrialShed>;
  /** Render envelope (walls + roof) when "architectural"; only skeleton when "structural". */
  lod?: Lod;
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
  const c = poly.reduce(
    (acc, v) => ({ x: acc.x + v.x, z: acc.z + v.z }),
    { x: 0, z: 0 },
  );
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

// ---- Layer 1 — terrain ---------------------------------------------------

export function buildTerrainLayer(site: SitePlan): THREE.Group {
  const g = new THREE.Group();
  g.name = "layer:terrain";
  // Flat lot pad (extruded polygon) — relief comes later (F8).
  const shape = lotShape(site.lotPolygonLocal);
  const geom = new THREE.ShapeGeometry(shape);
  geom.rotateX(-Math.PI / 2);
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
    const edgeGates = (gatesByEdge.get(seg.edgeIndex) ?? []).slice().sort(
      (a, b) => a.tAlongEdge - b.tAlongEdge,
    );
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

const COLUMN_SIZE = 0.3;

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
  const { w, d } = footprintSize(placement.footprintPolygon);
  const height = shed?.structure.clearHeight ?? 8;
  const freeSpan = shed?.structure.freeSpan ?? Math.min(w, d);
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

  // Steel-frame skeleton: pairs of columns along Z, trusses on top.
  const halfSpan = Math.min(freeSpan, w) / 2;
  const usedBayCount = Math.max(1, bayCount);
  // Centered along Z so the building lines up with footprint centroid.
  const totalDepth = baySpacing * usedBayCount;
  const startZ = -totalDepth / 2;
  for (let i = 0; i <= usedBayCount; i++) {
    const z = startZ + i * baySpacing;
    addColumn(g, -halfSpan, z, height, placement.id, i, "L");
    addColumn(g, halfSpan, z, height, placement.id, i, "R");
    addTruss(g, z, halfSpan * 2, Math.max(1, height * 0.18), height, placement.id, i);
  }

  if (lod === "architectural") {
    addWalls(g, w, d, height, placement.id);
    addGableRoof(g, w, d, height, shed?.roof.slopePct ?? 10, placement.id);
  }

  return g;
}

function addColumn(
  parent: THREE.Group,
  x: number,
  z: number,
  height: number,
  id: string,
  bay: number,
  side: "L" | "R",
): void {
  const geom = new THREE.BoxGeometry(COLUMN_SIZE, height, COLUMN_SIZE);
  const m = new THREE.Mesh(geom, MAT_COLUMN);
  m.position.set(x, height / 2, z);
  m.name = `column:${id}:b${bay}:${side}`;
  parent.add(m);
}

function addTruss(
  parent: THREE.Group,
  z: number,
  span: number,
  rise: number,
  baseY: number,
  id: string,
  bay: number,
): void {
  const group = new THREE.Group();
  group.position.set(0, baseY, z);
  group.name = `truss:${id}:b${bay}`;
  // Bottom chord.
  const bot = new THREE.Mesh(
    new THREE.BoxGeometry(span, 0.15, 0.15),
    MAT_BEAM,
  );
  bot.name = `truss:${id}:b${bay}:bottom`;
  group.add(bot);
  // Two top slopes.
  const halfSpan = span / 2;
  for (const dir of [-1, 1] as const) {
    const len = Math.hypot(halfSpan, rise);
    const angle = Math.atan2(rise, halfSpan) * dir;
    const slope = new THREE.Mesh(
      new THREE.BoxGeometry(len, 0.15, 0.15),
      MAT_BEAM,
    );
    slope.position.set((halfSpan / 2) * dir, rise / 2, 0);
    slope.rotation.z = -angle;
    slope.name = `truss:${id}:b${bay}:slope${dir > 0 ? "R" : "L"}`;
    group.add(slope);
  }
  parent.add(group);
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

function addGableRoof(
  parent: THREE.Group,
  width: number,
  depth: number,
  baseY: number,
  pitchPct: number,
  id: string,
): void {
  const halfWidth = width / 2;
  const rise = halfWidth * (pitchPct / 100);
  const slopeLen = Math.hypot(halfWidth, rise);
  const g = new THREE.Group();
  g.position.y = baseY;
  g.name = `roof:${id}`;
  for (const dir of [-1, 1] as const) {
    const angle = Math.atan2(rise, halfWidth) * dir;
    const slope = new THREE.Mesh(
      new THREE.BoxGeometry(slopeLen, 0.05, depth),
      MAT_ROOF,
    );
    slope.position.set((halfWidth / 2) * dir, rise / 2, 0);
    slope.rotation.z = -angle;
    slope.castShadow = true;
    slope.name = `roof:${id}:${dir > 0 ? "R" : "L"}`;
    g.add(slope);
  }
  parent.add(g);
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
  root.add(
    buildPerimeterLayer(site, site.perimeter.segments, site.gates),
  );
  root.add(buildGatesLayer(site, site.gates));

  // Buildings layer.
  const buildingsGroup = new THREE.Group();
  buildingsGroup.name = "layer:buildings";
  for (const placement of site.buildings) {
    const shed = placement.shedId ? sheds[placement.shedId] : undefined;
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
