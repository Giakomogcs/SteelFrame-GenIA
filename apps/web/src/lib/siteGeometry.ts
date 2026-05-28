// ============================================================
// siteGeometry — pure geometric helpers used to populate the
// SitePlan from a Terrain polygon: lot projection, street edge
// detection, perimeter defaults and gate placement.
//
// No IO inside. OSM fetching lives at the API boundary and is
// fed here as already-projected street polylines.
// ============================================================
import { toLocalMeters, type LngLat } from "./geo";
import { SITE_CONSTRAINTS } from "./siteConstraints";
import type { Gate, PerimeterSegment } from "./sitePlanSchema";

export type V = { x: number; z: number };

// ---- Lot projection ------------------------------------------------------

export interface LotProjection {
  /** Local ENU polygon in meters, vertices in the same order as the input. */
  local: V[];
  /** Reference lng/lat used as the (0,0) origin of the local frame. */
  ref: LngLat;
}

/**
 * Projects a geographic polygon ([lng,lat][]) to local ENU meters using the
 * polygon's first vertex as origin. Maps geo Y (north) to local Z.
 */
export function projectLotToLocal(
  lotGeo: LngLat[],
  ref?: LngLat,
): LotProjection {
  const origin = ref ?? lotGeo[0];
  const xy = toLocalMeters(lotGeo, origin);
  return {
    local: xy.map((p) => ({ x: p.x, z: p.y })),
    ref: origin,
  };
}

// ---- Edge primitives -----------------------------------------------------

export interface Edge {
  index: number;
  a: V;
  b: V;
  /** Outward normal (unit) for the edge assuming CCW polygon orientation. */
  normal: V;
  length: number;
  /** Midpoint of the edge. */
  mid: V;
}

function polygonSignedArea(poly: readonly V[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.z - b.x * a.z;
  }
  return s * 0.5;
}

/** Absolute area (m²) of a polygon in local coords. */
export function polygonAreaLocal(poly: readonly V[]): number {
  return Math.abs(polygonSignedArea(poly));
}

/** Ensures polygon is CCW (positive signed area in x/z plane). */
export function ensureCCW(poly: readonly V[]): V[] {
  return polygonSignedArea(poly) >= 0 ? poly.slice() : poly.slice().reverse();
}

export function getEdges(poly: readonly V[]): Edge[] {
  const ccw = polygonSignedArea(poly) >= 0;
  const edges: Edge[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz) || 1;
    // For CCW polygons in (x,z), outward normal is (dz, -dx) / length.
    // For CW polygons it is the opposite.
    const nx = (ccw ? dz : -dz) / length;
    const nz = (ccw ? -dx : dx) / length;
    edges.push({
      index: i,
      a,
      b,
      normal: { x: nx, z: nz },
      length,
      mid: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 },
    });
  }
  return edges;
}

// ---- Street edge detection ----------------------------------------------

export interface DetectStreetOptions {
  /** Max average perpendicular distance from edge midpoint to street line (m). */
  maxDistanceM?: number;
  /** Max angle deviation (radians) to count as parallel. */
  maxAngleRad?: number;
}

/**
 * Returns indices of edges that align with one of the provided street
 * polylines. Streets must already be projected into the same local frame as
 * `localPolygon` (use `toLocalMeters` with the same `ref`).
 *
 * An edge is street when:
 *   - the perpendicular distance from its midpoint to the closest street
 *     segment is ≤ `maxDistanceM` (default 5 m), AND
 *   - the angle between edge and street segment is ≤ `maxAngleRad`
 *     (default 20°).
 */
export function detectStreetEdges(
  localPolygon: readonly V[],
  streets: readonly V[][],
  opts: DetectStreetOptions = {},
): number[] {
  const maxD = opts.maxDistanceM ?? 5;
  const maxAng = opts.maxAngleRad ?? (20 * Math.PI) / 180;
  const cosLimit = Math.cos(maxAng);

  const edges = getEdges(localPolygon);
  const result: number[] = [];

  for (const e of edges) {
    let matched = false;
    for (const street of streets) {
      for (let i = 0; i < street.length - 1; i++) {
        const sa = street[i];
        const sb = street[i + 1];
        const d = pointToSegmentDistance(e.mid, sa, sb);
        if (d > maxD) continue;
        const cos = Math.abs(unitDot(e.a, e.b, sa, sb));
        if (cos >= cosLimit) {
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
    if (matched) result.push(e.index);
  }
  return result;
}

function pointToSegmentDistance(p: V, a: V, b: V): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.z - a.z);
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

function unitDot(a1: V, a2: V, b1: V, b2: V): number {
  const ux = a2.x - a1.x;
  const uz = a2.z - a1.z;
  const vx = b2.x - b1.x;
  const vz = b2.z - b1.z;
  const lu = Math.hypot(ux, uz) || 1;
  const lv = Math.hypot(vx, vz) || 1;
  return (ux * vx + uz * vz) / (lu * lv);
}

// ---- Perimeter defaults --------------------------------------------------

/**
 * Builds default perimeter segments: a 2.2 m muro on every edge. Street edges
 * keep the same default — gates are placed via `placeGates`.
 */
export function buildPerimeterSegments(
  localPolygon: readonly V[],
): PerimeterSegment[] {
  const edges = getEdges(localPolygon);
  return edges.map((e) => ({
    edgeIndex: e.index,
    kind: "muro" as const,
    height: 2.2,
  }));
}

// ---- Gate placement ------------------------------------------------------

export interface PlaceGatesOptions {
  /** When true, at least one gate must be wide enough for trucks. */
  truckAccess?: boolean;
  /** Maximum number of gates to place. */
  maxGates?: number;
}

/**
 * Places one gate at the midpoint of each street edge, sized for trucks (or
 * cars when `truckAccess` is false). Returns at most `maxGates` gates (default
 * = streetEdges.length).
 */
export function placeGates(
  localPolygon: readonly V[],
  streetEdges: readonly number[],
  opts: PlaceGatesOptions = {},
): Gate[] {
  const truck = opts.truckAccess ?? true;
  const kind = truck ? "caminhao" : "leve";
  const minWidth = SITE_CONSTRAINTS.gates.minWidthByKind[kind];

  // Order street edges by length so the longest one is the "main" gate.
  const edges = getEdges(localPolygon);
  const ranked = streetEdges
    .slice()
    .sort((a, b) => edges[b].length - edges[a].length);

  const limit = opts.maxGates ?? ranked.length;
  const out: Gate[] = [];
  for (let i = 0; i < Math.min(limit, ranked.length); i++) {
    const ei = ranked[i];
    out.push({
      id: `gate-${ei}`,
      edgeIndex: ei,
      tAlongEdge: 0.5,
      width: minWidth,
      kind,
    });
  }
  return out;
}

// ---- Convex inset (Minkowski erosion for convex polygons) ----------------

/**
 * Returns the polygon shrunk inward by `distance` meters. Works for convex
 * polygons via half-plane intersection. Throws when the resulting region is
 * empty.
 *
 * Non-convex lots are out of scope for v1 (PRD §3 Não-objetivos).
 */
export function insetConvexPolygon(
  localPolygon: readonly V[],
  distance: number,
): V[] | null {
  if (distance <= 0) return localPolygon.slice();
  const edges = getEdges(localPolygon);
  // Each edge defines a half-plane: n · p ≤ c, after shrink: c -= distance.
  // We intersect successive edges by solving 2×2 linear systems on the
  // *shifted* lines, then keep only vertices that satisfy all constraints.
  const lines = edges.map((e) => ({
    nx: e.normal.x,
    nz: e.normal.z,
    c: e.normal.x * e.a.x + e.normal.z * e.a.z - distance,
  }));

  const out: V[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l1 = lines[i];
    const l2 = lines[(i + 1) % lines.length];
    const det = l1.nx * l2.nz - l1.nz * l2.nx;
    if (Math.abs(det) < 1e-9) continue; // parallel edges → skip
    const x = (l1.c * l2.nz - l1.nz * l2.c) / det;
    const z = (l1.nx * l2.c - l1.c * l2.nx) / det;
    out.push({ x, z });
  }
  // Validate: every vertex must respect all half-planes.
  for (const v of out) {
    for (const l of lines) {
      if (l.nx * v.x + l.nz * v.z > l.c + 1e-6) {
        return null; // distance too large — polygon collapses
      }
    }
  }
  if (out.length < 3) {
    return null; // degenerate result
  }
  return out;
}

// ---- Buildable region ----------------------------------------------------

export interface BuildableOptions {
  setbacks: { front: number; sides: number; back: number };
  /** Edge indices facing the street (front). */
  streetEdges: readonly number[];
  /** Extra inset to reserve perimeter circulation lanes (m). */
  laneBufferM?: number;
}

/**
 * Computes the buildable region inside the lot, applying per-edge setbacks
 * (front on `streetEdges`, back on the opposite edge, sides on the rest)
 * plus an optional uniform `laneBufferM` for internal circulation.
 *
 * Edge-aware setbacks are achieved by selecting the worst-case (max) setback
 * and then inset uniformly — a conservative, deterministic approximation
 * suitable for v1 convex lots. The chosen distance is `max(front, sides,
 * back) + laneBufferM` so we never undercut any rule.
 */
export function buildBuildableRegion(
  localPolygon: readonly V[],
  opts: BuildableOptions,
): V[] | null {
  const lane = opts.laneBufferM ?? 0;
  const worst = Math.max(
    opts.setbacks.front,
    opts.setbacks.sides,
    opts.setbacks.back,
  );
  return insetConvexPolygon(localPolygon, worst + lane);
}

// ---- Public helpers ------------------------------------------------------

export function polygonBBox(poly: readonly V[]) {
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
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
  };
}

export function pointInPolygon(pt: V, poly: readonly V[]): boolean {
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
