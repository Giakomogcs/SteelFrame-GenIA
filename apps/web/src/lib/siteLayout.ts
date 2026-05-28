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
import { pointInPolygon, polygonBBox, type V } from "./siteGeometry";
import type { BuildingPlacement, BuildingUse } from "./sitePlanSchema";

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
  /** Gap between adjacent buildings in the same row (m). Defaults to constraint minimum (6 m). */
  gapM?: number;
  /** Rotation angle (radians) to apply to all building footprints. */
  rotationRad?: number;
}

export type FitResult =
  | { ok: true; placements: BuildingPlacement[] }
  | { ok: false; reason: string; placements: BuildingPlacement[] };

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

function footprintInside(
  footprint: readonly V[],
  region: readonly V[],
): boolean {
  return footprint.every((v) => pointInPolygon(v, region));
}

function rotatePolygon(poly: V[], cx: number, cz: number, rad: number): V[] {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return poly.map((p) => {
    const dx = p.x - cx;
    const dz = p.z - cz;
    return { x: cx + dx * cos - dz * sin, z: cz + dx * sin + dz * cos };
  });
}

/** Picks width/depth so that w*d ≈ target, respecting min side and ratio. */
function dimensionsFor(
  targetArea: number,
  preferredRatio: number,
  minSide: number,
): { w: number; d: number } {
  // Clamp ratio to industrial-shed proportions so a very wide buildable cell
  // doesn't produce a 100×8 "barraco" when the user asked for a 1000 m² shed.
  const ratio = Math.min(Math.max(preferredRatio, 1), 2.5);
  let d = Math.sqrt(targetArea / ratio);
  let w = targetArea / d;
  // Honor the structural minimum side. If both sides hit the floor, the area
  // necessarily grows beyond the target — that's the cleanest signal to the
  // caller that the program is too small for the constraints.
  if (d < minSide) d = minSide;
  if (w < minSide) w = minSide;
  // Renormalise so w*d stays ≈ target when only one side was clamped.
  if (d * w > targetArea && d > minSide && w === minSide) {
    d = Math.max(minSide, targetArea / w);
  } else if (d * w > targetArea && w > minSide && d === minSide) {
    w = Math.max(minSide, targetArea / d);
  }
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
    return {
      ok: false,
      reason: "Buildable region is empty after setbacks.",
      placements: [],
    };
  }

  const gap = Math.max(
    SITE_CONSTRAINTS.building.minGapBetweenM,
    opts.gapM ?? SITE_CONSTRAINTS.building.minGapBetweenM,
  );
  const truckGap = opts.truckGapM ?? SITE_CONSTRAINTS.circulation.truckLaneMin;
  const minSide = SITE_CONSTRAINTS.building.minSideM;
  const rotationRad = opts.rotationRad ?? 0;

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

  let fitError: string | null = null;
  if (cellW < minSide || cellD < minSide) {
    fitError = `Região construtível insuficiente para ${n} galpões (célula ${cellW.toFixed(1)}×${cellD.toFixed(1)} m < mínimo ${minSide} m).`;
  }

  const originX = bb.minX;
  const originZ = bb.minZ;

  const placements: BuildingPlacement[] = [];
  for (let i = 0; i < opts.requests.length; i++) {
    const req = opts.requests[i];
    const col = i % cols;
    const row = Math.floor(i / cols);

    const effectiveCellW = Math.max(cellW, minSide);
    const effectiveCellD = Math.max(cellD, minSide);
    const preferredRatio =
      req.preferredRatio ?? effectiveCellW / effectiveCellD;
    const { w: targetW, d: targetD } = dimensionsFor(
      req.targetAreaM2,
      preferredRatio,
      minSide,
    );
    // Use full requested size — don't clamp to cell.
    const w = targetW;
    const d = targetD;

    const cx = originX + col * (effectiveCellW + gap) + effectiveCellW / 2;
    const cz = originZ + row * (effectiveCellD + truckGap) + effectiveCellD / 2;
    let footprint = rectFootprint(cx, cz, w, d);

    // Apply rotation around centroid if specified.
    if (rotationRad !== 0) {
      footprint = rotatePolygon(footprint, cx, cz, rotationRad);
    }

    if (!footprintInside(footprint, opts.buildable)) {
      fitError =
        fitError ??
        `Galpão "${req.name}" ultrapassa a região construtível. Reduza área, nº de galpões ou ajuste a rotação.`;
    }

    placements.push({
      id: req.id,
      name: req.name,
      shedId: req.shedId ?? null,
      use: req.use ?? "logistics",
      targetAreaM2: req.targetAreaM2,
      footprintPolygon: footprint,
      rotationRad,
      z0: 0,
    });
  }

  if (fitError) {
    return { ok: false, reason: fitError, placements };
  }
  return { ok: true, placements };
}
