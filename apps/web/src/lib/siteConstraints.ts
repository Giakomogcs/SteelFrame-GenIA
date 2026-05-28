// ============================================================
// siteConstraints — single source of truth for dimensional rules
// applied to the SitePlan, both in the UI (clamped sliders) and
// in the deterministic validator `validateSitePlan`.
//
// Zero magic numbers elsewhere: import from this file.
// ============================================================
import type { IndustrialShed } from "./shedSchema";
import type {
  BuildingPlacement,
  Gate,
  SitePlan,
  ValidationIssue,
  ValidationReport,
} from "./sitePlanSchema";

// ---- Constants -----------------------------------------------------------

export const SITE_CONSTRAINTS = {
  setbacks: {
    /** Minimum setback in meters when zoning does not specify one. */
    frontDefault: 5,
    /** NBR 14432 — bombeiros. */
    sidesMin: 1.5,
    /** NBR 14432 — bombeiros. */
    backMin: 3,
  },
  circulation: {
    /** Internal lane width for cars (m). */
    carLaneMin: 6,
    /** Internal lane width for trucks (m). */
    truckLaneMin: 12,
    /** Truck turning radius required in yards (m). */
    truckTurningRadiusMin: 13,
  },
  parking: {
    car: { stallW: 2.5, stallL: 5, aisleW: 6 },
    truck: { stallW: 3.5, stallL: 16, turningRadius: 25 },
    /** Minimum stalls per built m² (1 car per X m² of covered area). */
    minCarStallsPerCoveredArea: 1 / 75,
  },
  building: {
    /** Minimum footprint dimension in meters (FootprintSchema). */
    minSideM: 6,
    /** Minimum gap between two buildings (NBR 14432). */
    minGapBetweenM: 6,
    /** Useful clear height (StructureSchema). */
    clearHeight: { min: 4, max: 20 },
    /** Maximum free span (m) per structural system. */
    maxFreeSpanBySystem: {
      steel_frame_light: 12,
      porticos_aco: 40,
      trelicado: 80,
    } as const,
  },
  gates: {
    /** Minimum gate width per kind (m). */
    minWidthByKind: { pedestre: 1.2, leve: 4, caminhao: 6 } as const,
  },
  openings: {
    /** Minimum clear height (m) for a sectional door to operate. */
    sectionalDoorMinClearHeight: 4.5,
  },
} as const;

export type StructuralSystem =
  keyof typeof SITE_CONSTRAINTS.building.maxFreeSpanBySystem;

// ---- Geometry helpers (kept local & pure) --------------------------------

type V = { x: number; z: number };

function area2(p: readonly V[]): number {
  let s = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    s += a.x * b.z - b.x * a.z;
  }
  return s * 0.5;
}

function centroid(p: readonly V[]): V {
  const a = area2(p);
  if (a === 0) {
    const c = p.reduce((acc, v) => ({ x: acc.x + v.x, z: acc.z + v.z }), {
      x: 0,
      z: 0,
    });
    return { x: c.x / p.length, z: c.z / p.length };
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const v1 = p[i];
    const v2 = p[(i + 1) % n];
    const cross = v1.x * v2.z - v2.x * v1.z;
    cx += (v1.x + v2.x) * cross;
    cz += (v1.z + v2.z) * cross;
  }
  const f = 1 / (6 * a);
  return { x: cx * f, z: cz * f };
}

function pointInPolygon(pt: V, poly: readonly V[]): boolean {
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

function polygonArea(p: readonly V[]): number {
  return Math.abs(area2(p));
}

/** Approx min distance between two convex polygons (centroids fallback). */
function approxMinDistance(a: readonly V[], b: readonly V[]): number {
  let best = Infinity;
  for (const va of a) {
    for (const vb of b) {
      const dx = va.x - vb.x;
      const dz = va.z - vb.z;
      const d = Math.hypot(dx, dz);
      if (d < best) best = d;
    }
  }
  return best;
}

// ---- Issue helpers -------------------------------------------------------

function err(
  code: ValidationIssue["code"],
  message: string,
  extras: Partial<ValidationIssue> = {},
): ValidationIssue {
  return { code, severity: "error", message, ...extras };
}

function warn(
  code: ValidationIssue["code"],
  message: string,
  extras: Partial<ValidationIssue> = {},
): ValidationIssue {
  return { code, severity: "warning", message, ...extras };
}

// ---- Public API ----------------------------------------------------------

export interface ValidateOptions {
  /**
   * Optional sheds keyed by id, used to validate E006 (max free span per
   * structural system) and W102 (clear height vs sectional door).
   */
  shedsById?: Record<string, IndustrialShed>;
}

/**
 * Deterministic validator. Returns ValidationReport with `ok=false` whenever
 * any error code is present. Pure: no IO, no randomness.
 */
export function validateSitePlan(
  site: SitePlan,
  opts: ValidateOptions = {},
): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const sheds = opts.shedsById ?? {};

  // ---- E001: every building footprint must lie inside lot polygon ------
  for (const b of site.buildings) {
    const outside = b.footprintPolygon.find(
      (v) => !pointInPolygon(v, site.lotPolygonLocal),
    );
    if (outside) {
      errors.push(
        err("E001", `Galpão "${b.name}" ultrapassa o polígono do lote.`, {
          where: outside,
          ref: b.id,
        }),
      );
    }
  }

  // ---- E002: minimum gap between buildings -----------------------------
  for (let i = 0; i < site.buildings.length; i++) {
    for (let j = i + 1; j < site.buildings.length; j++) {
      const a = site.buildings[i];
      const c = site.buildings[j];
      const d = approxMinDistance(a.footprintPolygon, c.footprintPolygon);
      if (d < SITE_CONSTRAINTS.building.minGapBetweenM) {
        errors.push(
          err(
            "E002",
            `Distância entre "${a.name}" e "${c.name}" (${d.toFixed(2)} m) < mínimo ${SITE_CONSTRAINTS.building.minGapBetweenM} m.`,
            { ref: `${a.id}|${c.id}`, where: centroid(a.footprintPolygon) },
          ),
        );
      }
    }
  }

  // ---- E003: TO/CA exceeded --------------------------------------------
  const lotArea = polygonArea(site.lotPolygonLocal);
  if (lotArea > 0 && site.zoning) {
    const totalFootprint = site.buildings.reduce(
      (acc, b) => acc + polygonArea(b.footprintPolygon),
      0,
    );
    if (site.zoning.to != null) {
      const occupancy = totalFootprint / lotArea;
      if (occupancy > site.zoning.to + 1e-6) {
        errors.push(
          err(
            "E003",
            `Taxa de ocupação ${(occupancy * 100).toFixed(1)}% excede o limite ${(site.zoning.to * 100).toFixed(1)}%.`,
          ),
        );
      }
    }
    if (site.zoning.ca != null) {
      // V1: assume single floor; CA == TO.
      const usedCA = totalFootprint / lotArea;
      if (usedCA > site.zoning.ca + 1e-6) {
        errors.push(
          err(
            "E003",
            `Coeficiente de aproveitamento ${usedCA.toFixed(2)} excede ${site.zoning.ca.toFixed(2)}.`,
          ),
        );
      }
    }
  }

  // ---- E004: gates must sit on a "street" edge -------------------------
  const streetSet = new Set(site.streetEdges);
  for (const g of site.gates) {
    if (!streetSet.has(g.edgeIndex)) {
      errors.push(
        err(
          "E004",
          `Portão "${g.id}" está na aresta ${g.edgeIndex}, que não é classificada como rua.`,
          { ref: g.id },
        ),
      );
    }
    const minW = SITE_CONSTRAINTS.gates.minWidthByKind[g.kind];
    if (g.width < minW) {
      errors.push(
        err(
          "E004",
          `Portão "${g.id}" largura ${g.width} m < mínimo ${minW} m para ${g.kind}.`,
          { ref: g.id },
        ),
      );
    }
  }

  // ---- E005: truck turning radius feasibility --------------------------
  for (const lane of site.circulation) {
    if (lane.kind !== "truck") continue;
    if (lane.widthM < SITE_CONSTRAINTS.circulation.truckLaneMin) {
      errors.push(
        err(
          "E005",
          `Faixa de caminhão "${lane.id}" tem ${lane.widthM} m; mínimo ${SITE_CONSTRAINTS.circulation.truckLaneMin} m.`,
          { ref: lane.id },
        ),
      );
      continue;
    }
    // Smallest segment-angle along centerline must allow turningRadiusMin.
    const pts = lane.centerline;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const c = pts[i + 1];
      const ux = b.x - a.x;
      const uz = b.z - a.z;
      const vx = c.x - b.x;
      const vz = c.z - b.z;
      const lu = Math.hypot(ux, uz);
      const lv = Math.hypot(vx, vz);
      if (lu === 0 || lv === 0) continue;
      const cos = (ux * vx + uz * vz) / (lu * lv);
      const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
      // Chord radius proxy: min(lu, lv) / (2*sin(angle/2)) when angle > 0.
      if (angle > 1e-3) {
        const radius = Math.min(lu, lv) / (2 * Math.sin(angle / 2));
        if (radius < SITE_CONSTRAINTS.circulation.truckTurningRadiusMin) {
          errors.push(
            err(
              "E005",
              `Curva na via "${lane.id}" tem raio ${radius.toFixed(1)} m; mínimo ${SITE_CONSTRAINTS.circulation.truckTurningRadiusMin} m.`,
              { ref: lane.id, where: b },
            ),
          );
        }
      }
    }
  }

  // ---- E006: free span > limit of Structure.system ---------------------
  for (const b of site.buildings) {
    const shed = b.shedId ? sheds[b.shedId] : undefined;
    if (!shed) continue;
    const limit =
      SITE_CONSTRAINTS.building.maxFreeSpanBySystem[
        shed.structure.system as StructuralSystem
      ];
    if (limit != null && shed.structure.freeSpan > limit) {
      errors.push(
        err(
          "E006",
          `Galpão "${b.name}": vão livre ${shed.structure.freeSpan} m excede ${limit} m para ${shed.structure.system}.`,
          { ref: b.id },
        ),
      );
    }
  }

  // ---- W101: parking stalls below recommended minimum ------------------
  const coveredArea = site.buildings.reduce(
    (acc, b) => acc + polygonArea(b.footprintPolygon),
    0,
  );
  const carStalls = site.parking
    .filter((p) => p.kind === "car")
    .reduce((acc, p) => acc + p.stallCount, 0);
  const minCarStalls = Math.ceil(
    coveredArea * SITE_CONSTRAINTS.parking.minCarStallsPerCoveredArea,
  );
  if (coveredArea > 0 && carStalls < minCarStalls) {
    warnings.push(
      warn(
        "W101",
        `Vagas de carro (${carStalls}) abaixo do recomendado (${minCarStalls} para ${coveredArea.toFixed(0)} m² cobertos).`,
      ),
    );
  }

  // ---- W102: clear height incompatible with sectional doors ------------
  for (const b of site.buildings) {
    const shed = b.shedId ? sheds[b.shedId] : undefined;
    if (!shed) continue;
    const hasSectional = shed.openings.some(
      (o) => o.type === "portao_seccional",
    );
    if (
      hasSectional &&
      shed.structure.clearHeight <
        SITE_CONSTRAINTS.openings.sectionalDoorMinClearHeight
    ) {
      warnings.push(
        warn(
          "W102",
          `Galpão "${b.name}": pé-direito ${shed.structure.clearHeight} m incompatível com portão seccional (mín ${SITE_CONSTRAINTS.openings.sectionalDoorMinClearHeight} m).`,
          { ref: b.id },
        ),
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

// ---- Slider clamps (re-exported for UI) ----------------------------------

/**
 * Helpers used by wizard sliders to enforce constraint ranges without
 * relying on ad-hoc magic numbers.
 */
export const SLIDER_RANGES = {
  setback: { min: 0, max: 50, step: 0.5 },
  clearHeight: SITE_CONSTRAINTS.building.clearHeight,
  buildingSide: { min: SITE_CONSTRAINTS.building.minSideM, max: 500 },
  truckLane: { min: SITE_CONSTRAINTS.circulation.truckLaneMin, max: 30 },
  carLane: { min: SITE_CONSTRAINTS.circulation.carLaneMin, max: 20 },
  gateWidth: { min: 1.2, max: 20 },
} as const;

export function freeSpanLimit(system: string): number | undefined {
  return (
    SITE_CONSTRAINTS.building.maxFreeSpanBySystem as Record<string, number>
  )[system];
}

/** Compatible with selecting placements/gates by id from a SitePlan. */
export function findBuilding(
  site: SitePlan,
  id: string,
): BuildingPlacement | undefined {
  return site.buildings.find((b) => b.id === id);
}

export function findGate(site: SitePlan, id: string): Gate | undefined {
  return site.gates.find((g) => g.id === id);
}
