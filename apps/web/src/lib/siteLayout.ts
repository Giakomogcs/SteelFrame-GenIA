// ============================================================
// siteLayout — deterministic building placements inside a
// buildable region. Pure: no IO, no randomness, no fallbacks.
//
// Strategy: align buildings along the principal axis of the
// buildable bounding box, place in a linear row along the
// longest direction with configurable gap, then apply group
// rotation around the buildable center.
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
  /** Gap between adjacent buildings (m). Defaults to constraint minimum (6 m). */
  gapM?: number;
  /** Rotation of the entire group of buildings around the buildable center (radians). */
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
  const d = Math.max(minSide, Math.sqrt(targetArea / preferredRatio));
  const w = Math.max(minSide, targetArea / d);
  return { w, d };
}

// ---- Public API ----------------------------------------------------------

/**
 * Deterministic layout. Places buildings along the principal axis of the
 * buildable region with the user-specified gap, then rotates the entire
 * group around the buildable center.
 *
 * Returns `ok=false` with `placements` populated so the UI can always
 * render buildings (even when they overflow).
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
  const minSide = SITE_CONSTRAINTS.building.minSideM;
  const rotationRad = opts.rotationRad ?? 0;
  const n = opts.requests.length;

  // Principal axis: align buildings along the longest dimension.
  const horizontal = bb.width >= bb.depth; // true = line up along X axis
  const mainLen = horizontal ? bb.width : bb.depth;
  const crossLen = horizontal ? bb.depth : bb.width;

  // For N buildings along the main axis: total gap = (N-1)*gap,
  // each building gets (mainLen - totalGap) / N along main axis.
  const cellMain = (mainLen - gap * (n - 1)) / n;
  const cellCross = crossLen;

  let fitError: string | null = null;
  if (cellMain < minSide || cellCross < minSide) {
    fitError = `Região construtível insuficiente para ${n} galpões (${cellMain.toFixed(1)}×${cellCross.toFixed(1)} m < mínimo ${minSide} m).`;
  }

  // Center of the buildable region (used as rotation pivot).
  const centerX = bb.minX + bb.width / 2;
  const centerZ = bb.minZ + bb.depth / 2;

  const placements: BuildingPlacement[] = [];
  for (let i = 0; i < n; i++) {
    const req = opts.requests[i];

    // Building dimensions: use preferred ratio aligned to terrain direction.
    const effectiveCellMain = Math.max(cellMain, minSide);
    const effectiveCellCross = Math.max(cellCross, minSide);
    const preferredRatio =
      req.preferredRatio ??
      (horizontal
        ? effectiveCellMain / effectiveCellCross
        : effectiveCellCross / effectiveCellMain);
    const { w: targetW, d: targetD } = dimensionsFor(
      req.targetAreaM2,
      preferredRatio,
      minSide,
    );

    // Position along the main axis, centered on the cross axis.
    let cx: number;
    let cz: number;
    if (horizontal) {
      cx = bb.minX + i * (effectiveCellMain + gap) + effectiveCellMain / 2;
      cz = centerZ;
    } else {
      cx = centerX;
      cz = bb.minZ + i * (effectiveCellMain + gap) + effectiveCellMain / 2;
    }

    let footprint = rectFootprint(cx, cz, targetW, targetD);

    // Apply group rotation around the buildable center.
    if (rotationRad !== 0) {
      footprint = rotatePolygon(footprint, centerX, centerZ, rotationRad);
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
