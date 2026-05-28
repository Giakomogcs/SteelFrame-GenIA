// ============================================================
// siteLayout — deterministic building placements inside a
// buildable region. Pure: no IO, no randomness, no fallbacks.
//
// Strategy (v1): rotate footprints to align with the buildable
// bounding box, lay out in a regular grid (1 → centered,
// 2 → side-by-side with 6 m gap, N → rows/cols with truck gap),
// reject anything that would leak outside the buildable region.
// ============================================================
import { SITE_CONSTRAINTS } from "./siteConstraints";
import {
  pointInPolygon,
  polygonBBox,
  type V,
} from "./siteGeometry";
import type {
  BuildingPlacement,
  BuildingUse,
} from "./sitePlanSchema";

// ---- Inputs --------------------------------------------------------------

export interface BuildingRequest {
  id: string;
  name: string;
  use?: BuildingUse;
  /** Target gross area in m². */
  targetAreaM2: number;
  /** Optional preferred width/depth ratio (width / depth). */
  preferredRatio?: number;
  /** Optional shed id for downstream rendering. */
  shedId?: string | null;
}

export interface FitOptions {
  /** Buildable polygon already inset by setbacks (use `buildBuildableRegion`). */
  buildable: V[];
  /** Briefing requests, one per desired building. */
  requests: BuildingRequest[];
  /** Truck turning circle radius (m). Defaults to constraint minimum. */
  truckGapM?: number;
}

export type FitResult =
  | { ok: true; placements: BuildingPlacement[] }
  | { ok: false; reason: string };

// ---- Helpers -------------------------------------------------------------

function rectFootprint(cx: number, cz: number, w: number, d: number): V[] {
  const hx = w / 2;
  const hz = d / 2;
  return [
    { x: cx - hx, z: cz - hz },
    { x: cx + hx, z: cz - hz },
    { x: cx + hx, z: cz + hz },
    { x: cx - hx, z: cz + hz },
  ];
}

function footprintInside(footprint: readonly V[], region: readonly V[]): boolean {
  return footprint.every((v) => pointInPolygon(v, region));
}

/** Picks width/depth so that w*d ≈ target, respecting min side and ratio. */
function dimensionsFor(
  targetArea: number,
  preferredRatio: number,
  minSide: number,
): { w: number; d: number } {
  const d = Math.max(minSide, Math.sqrt(targetArea / preferredRatio));
  const w = Math.max(minSide, targetArea / d);
  return { w, d };
}

// ---- Public API ----------------------------------------------------------

/**
 * Deterministic grid layout. Returns ok=false with a structured reason when
 * the requested program does not fit — never silently shrinks.
 */
export function fitBuildings(opts: FitOptions): FitResult {
  if (opts.requests.length === 0) {
    return { ok: true, placements: [] };
  }

  const bb = polygonBBox(opts.buildable);
  if (!isFinite(bb.width) || bb.width <= 0 || bb.depth <= 0) {
    return { ok: false, reason: "Buildable region is empty after setbacks." };
  }

  const gap = SITE_CONSTRAINTS.building.minGapBetweenM;
  const truckGap = opts.truckGapM ?? SITE_CONSTRAINTS.circulation.truckLaneMin;
  const minSide = SITE_CONSTRAINTS.building.minSideM;

  // Layout grid (cols × rows). Prefer columns when buildable is wider.
  const n = opts.requests.length;
  let cols: number;
  let rows: number;
  if (n === 1) {
    cols = 1;
    rows = 1;
  } else if (n === 2) {
    if (bb.width >= bb.depth) {
      cols = 2;
      rows = 1;
    } else {
      cols = 1;
      rows = 2;
    }
  } else {
    cols = Math.ceil(Math.sqrt(n));
    rows = Math.ceil(n / cols);
    if (bb.depth > bb.width) {
      [cols, rows] = [rows, cols];
    }
  }

  // Available cell size (subtracting inter-building gaps).
  const cellW = (bb.width - gap * (cols - 1)) / cols;
  const cellD = (bb.depth - truckGap * (rows - 1)) / rows;
  if (cellW < minSide || cellD < minSide) {
    return {
      ok: false,
      reason: `Buildable region too small for ${n} galpões (célula ${cellW.toFixed(1)}×${cellD.toFixed(1)} m < mínimo ${minSide} m).`,
    };
  }

  const originX = bb.minX;
  const originZ = bb.minZ;

  const placements: BuildingPlacement[] = [];
  for (let i = 0; i < opts.requests.length; i++) {
    const req = opts.requests[i];
    const col = i % cols;
    const row = Math.floor(i / cols);

    const preferredRatio = req.preferredRatio ?? cellW / cellD;
    const { w: targetW, d: targetD } = dimensionsFor(
      req.targetAreaM2,
      preferredRatio,
      minSide,
    );
    // Clamp to cell.
    const w = Math.min(targetW, cellW);
    const d = Math.min(targetD, cellD);

    const cx = originX + col * (cellW + gap) + cellW / 2;
    const cz = originZ + row * (cellD + truckGap) + cellD / 2;
    const footprint = rectFootprint(cx, cz, w, d);

    if (!footprintInside(footprint, opts.buildable)) {
      return {
        ok: false,
        reason: `Galpão "${req.name}" não cabe na região construtível após recuos. Reduza nº/área.`,
      };
    }

    placements.push({
      id: req.id,
      name: req.name,
      shedId: req.shedId ?? null,
      use: req.use ?? "logistics",
      targetAreaM2: req.targetAreaM2,
      footprintPolygon: footprint,
      rotationRad: 0,
      z0: 0,
    });
  }

  return { ok: true, placements };
}
