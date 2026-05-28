import { describe, it, expect } from "vitest";
import { validateSitePlan, SITE_CONSTRAINTS } from "../siteConstraints";
import { SitePlanSchema, type SitePlan } from "../sitePlanSchema";
import type { IndustrialShed } from "../shedSchema";

// ---- Fixture helpers -----------------------------------------------------

/** 100m × 100m square lot, edges in CCW order:
 *   edge 0: south (z=0), 1: east (x=100), 2: north (z=100), 3: west (x=0).
 */
function squareLot(side = 100) {
  return [
    { x: 0, z: 0 },
    { x: side, z: 0 },
    { x: side, z: side },
    { x: 0, z: side },
  ];
}

/** Axis-aligned rectangle footprint centered at (cx, cz). */
function rectFootprint(cx: number, cz: number, w: number, d: number) {
  const hx = w / 2;
  const hz = d / 2;
  return [
    { x: cx - hx, z: cz - hz },
    { x: cx + hx, z: cz - hz },
    { x: cx + hx, z: cz + hz },
    { x: cx - hx, z: cz + hz },
  ];
}

function baseSite(overrides: Partial<SitePlan> = {}): SitePlan {
  const lot = squareLot(100);
  return SitePlanSchema.parse({
    schemaVersion: "site-1",
    terrainId: "T1",
    lotPolygon: [
      [0, 0],
      [0.001, 0],
      [0.001, 0.001],
      [0, 0.001],
    ],
    lotPolygonLocal: lot,
    northAngleRad: 0,
    streetEdges: [0], // south edge is the street
    setbacks: { front: 5, sides: 1.5, back: 3 },
    perimeter: { segments: [] },
    gates: [],
    buildings: [],
    parking: [],
    circulation: [],
    greenAreas: [],
    ...overrides,
  });
}

function baseShed(o: Partial<IndustrialShed> = {}): IndustrialShed {
  return {
    schemaVersion: "shed-1",
    use: "logistics",
    standard: "medio",
    lot: { width: 100, depth: 100, slopePct: 0 },
    setbacks: { front: 5, sides: 1.5, back: 3 },
    footprint: { width: 30, depth: 60 },
    structure: {
      system: "porticos_aco",
      bayCount: 10,
      baySpacing: 6,
      freeSpan: 30,
      clearHeight: 8,
      columnProfile: "W250x32",
      roofStructure: "trelica",
    },
    roof: {
      type: "gable",
      slopePct: 10,
      overhang: 0.6,
      cover: "telha_termoacustica",
      skylightPct: 4,
      gutters: true,
    },
    envelope: {
      walls: "alvenaria_baixa_telha",
      insulation: "basico",
      wallBaseHeight: 2.5,
    },
    zones: [],
    docks: [],
    craneRails: [],
    openings: [],
    floor: { type: "industrial_polido", load_kN_m2: 30, thickness_cm: 15 },
    utilities: {
      power_kVA: 150,
      water: true,
      sewage: true,
      compressedAir: false,
      firePump: false,
      sprinklers: false,
      hydrants: 2,
    },
    safety: {
      occupancyClass: "J-2 / J-3",
      fireLoad_MJ_m2: 1000,
      exitsCount: 2,
      exitsWidthTotal: 2.2,
      maxTravelDistance_m: 30,
      avcbRequired: true,
    },
    yard: {
      truckCircle_m: 25,
      parkingCars: 10,
      parkingTrucks: 3,
      retentionPond: false,
    },
    perimeter: {
      fenceHeight: 2.2,
      fenceType: "muro",
      gate: true,
      guardhouse: false,
    },
    compliance: { norms: [], costSources: [] },
    estimate: { costPerM2: 2200, totalCost: 0, steelKg: 0, coveredAreaM2: 0 },
    assumptions: [],
    confidence: 0.7,
    ...o,
  } as IndustrialShed;
}

// ---- Tests ---------------------------------------------------------------

describe("validateSitePlan — happy path", () => {
  it("returns ok=true with no buildings", () => {
    const r = validateSitePlan(baseSite());
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });
});

describe("E001 — building outside lot polygon", () => {
  it("flags a footprint whose vertex falls outside the lot", () => {
    const site = baseSite({
      buildings: [
        {
          id: "B1",
          name: "G1",
          shedId: null,
          use: "logistics",
          targetAreaM2: 1000,
          footprintPolygon: rectFootprint(150, 50, 40, 40), // outside x∈[0,100]
          rotationRad: 0,
          z0: 0,
        },
      ],
    });
    const r = validateSitePlan(site);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "E001")).toBe(true);
  });
});

describe("E002 — minimum gap between buildings", () => {
  it("flags two buildings closer than min gap", () => {
    const site = baseSite({
      buildings: [
        {
          id: "A",
          name: "A",
          shedId: null,
          use: "logistics",
          targetAreaM2: 400,
          footprintPolygon: rectFootprint(30, 50, 20, 20),
          rotationRad: 0,
          z0: 0,
        },
        {
          id: "B",
          name: "B",
          shedId: null,
          use: "logistics",
          targetAreaM2: 400,
          // 1 m gap on x axis between right edge of A (40) and left of B (41)
          footprintPolygon: rectFootprint(51, 50, 20, 20),
          rotationRad: 0,
          z0: 0,
        },
      ],
    });
    const r = validateSitePlan(site);
    expect(r.errors.some((e) => e.code === "E002")).toBe(true);
  });

  it("accepts gap >= min", () => {
    const site = baseSite({
      buildings: [
        {
          id: "A",
          name: "A",
          shedId: null,
          use: "logistics",
          targetAreaM2: 400,
          footprintPolygon: rectFootprint(20, 50, 20, 20),
          rotationRad: 0,
          z0: 0,
        },
        {
          id: "B",
          name: "B",
          shedId: null,
          use: "logistics",
          targetAreaM2: 400,
          footprintPolygon: rectFootprint(
            20 + 10 + SITE_CONSTRAINTS.building.minGapBetweenM + 10 + 0.1,
            50,
            20,
            20,
          ),
          rotationRad: 0,
          z0: 0,
        },
      ],
    });
    const r = validateSitePlan(site);
    expect(r.errors.some((e) => e.code === "E002")).toBe(false);
  });
});

describe("E003 — TO/CA exceeded", () => {
  it("flags occupancy above zoning.to", () => {
    const site = baseSite({
      zoning: { to: 0.5 },
      buildings: [
        {
          id: "B1",
          name: "G1",
          shedId: null,
          use: "logistics",
          targetAreaM2: 8000,
          footprintPolygon: rectFootprint(50, 50, 90, 90), // 8100 m² of 10 000
          rotationRad: 0,
          z0: 0,
        },
      ],
    });
    const r = validateSitePlan(site);
    expect(r.errors.some((e) => e.code === "E003")).toBe(true);
  });
});

describe("E004 — gate must sit on a street edge", () => {
  it("flags gate on non-street edge", () => {
    const site = baseSite({
      streetEdges: [0],
      gates: [
        {
          id: "G1",
          edgeIndex: 2, // north edge, not street
          tAlongEdge: 0.5,
          width: 6,
          kind: "caminhao",
        },
      ],
    });
    const r = validateSitePlan(site);
    expect(r.errors.some((e) => e.code === "E004")).toBe(true);
  });

  it("flags too-narrow gate even on street", () => {
    const site = baseSite({
      streetEdges: [0],
      gates: [
        {
          id: "G1",
          edgeIndex: 0,
          tAlongEdge: 0.5,
          width: 3,
          kind: "caminhao",
        },
      ],
    });
    const r = validateSitePlan(site);
    expect(r.errors.some((e) => e.code === "E004")).toBe(true);
  });
});

describe("E005 — truck turning radius", () => {
  it("flags truck lane narrower than minimum", () => {
    const site = baseSite({
      circulation: [
        {
          id: "L1",
          kind: "truck",
          centerline: [
            { x: 10, z: 10 },
            { x: 90, z: 10 },
          ],
          widthM: 6,
        },
      ],
    });
    const r = validateSitePlan(site);
    expect(r.errors.some((e) => e.code === "E005")).toBe(true);
  });

  it("flags sharp corner below truck turning radius", () => {
    const site = baseSite({
      circulation: [
        {
          id: "L1",
          kind: "truck",
          centerline: [
            { x: 10, z: 10 },
            { x: 20, z: 10 },
            { x: 20, z: 20 }, // 90° turn with 10 m legs → radius ~5 m
          ],
          widthM: 12,
        },
      ],
    });
    const r = validateSitePlan(site);
    expect(r.errors.some((e) => e.code === "E005")).toBe(true);
  });
});

describe("E006 — free span exceeds structural system limit", () => {
  it("flags steel_frame_light with span > 12 m", () => {
    const shed = baseShed({
      structure: {
        ...baseShed().structure,
        system: "steel_frame_light",
        freeSpan: 20,
      },
    });
    const site = baseSite({
      buildings: [
        {
          id: "B1",
          name: "G1",
          shedId: "S1",
          use: "logistics",
          targetAreaM2: 400,
          footprintPolygon: rectFootprint(50, 50, 20, 20),
          rotationRad: 0,
          z0: 0,
        },
      ],
    });
    const r = validateSitePlan(site, { shedsById: { S1: shed } });
    expect(r.errors.some((e) => e.code === "E006")).toBe(true);
  });
});

describe("W101 — minimum car stalls", () => {
  it("warns when car stalls below the recommended ratio", () => {
    const site = baseSite({
      buildings: [
        {
          id: "B1",
          name: "G1",
          shedId: null,
          use: "logistics",
          targetAreaM2: 3000,
          footprintPolygon: rectFootprint(50, 50, 60, 50), // 3000 m² covered
          rotationRad: 0,
          z0: 0,
        },
      ],
      parking: [
        {
          id: "P1",
          kind: "car",
          polygon: rectFootprint(10, 10, 5, 5),
          stallCount: 2,
        },
      ],
    });
    const r = validateSitePlan(site);
    expect(r.warnings.some((w) => w.code === "W101")).toBe(true);
    expect(r.ok).toBe(true); // warnings don't break ok
  });
});

describe("W102 — clear height vs sectional door", () => {
  it("warns when sectional door is present and clearHeight < 4.5 m", () => {
    const shed = baseShed({
      structure: { ...baseShed().structure, clearHeight: 4 },
      openings: [
        {
          type: "portao_seccional",
          wall: "south",
          xAlongWall: 5,
          width: 4,
          height: 4,
          elevation: 0,
        },
      ],
    });
    const site = baseSite({
      buildings: [
        {
          id: "B1",
          name: "G1",
          shedId: "S1",
          use: "logistics",
          targetAreaM2: 400,
          footprintPolygon: rectFootprint(50, 50, 20, 20),
          rotationRad: 0,
          z0: 0,
        },
      ],
    });
    const r = validateSitePlan(site, { shedsById: { S1: shed } });
    expect(r.warnings.some((w) => w.code === "W102")).toBe(true);
  });
});
