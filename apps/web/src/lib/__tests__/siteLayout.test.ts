import { describe, it, expect } from "vitest";
import { buildBuildableRegion } from "../siteGeometry";
import { fitBuildings } from "../siteLayout";
import { validateSitePlan } from "../siteConstraints";
import { SitePlanSchema } from "../sitePlanSchema";

function square(side = 100) {
  return [
    { x: 0, z: 0 },
    { x: side, z: 0 },
    { x: side, z: side },
    { x: 0, z: side },
  ];
}

function siteWith(placements: ReturnType<typeof fitBuildings>, lotSide = 100) {
  if (placements.ok === false) throw new Error(placements.reason);
  return SitePlanSchema.parse({
    schemaVersion: "site-1",
    terrainId: "T1",
    lotPolygon: [
      [0, 0],
      [0.001, 0],
      [0.001, 0.001],
      [0, 0.001],
    ],
    lotPolygonLocal: square(lotSide),
    northAngleRad: 0,
    streetEdges: [0],
    setbacks: { front: 5, sides: 1.5, back: 3 },
    buildings: placements.placements,
  });
}

describe("fitBuildings — single", () => {
  it("centers one building inside the buildable region", () => {
    const buildable = buildBuildableRegion(square(100), {
      setbacks: { front: 5, sides: 1.5, back: 3 },
      streetEdges: [0],
      laneBufferM: 6,
    });
    const r = fitBuildings({
      buildable,
      requests: [{ id: "B1", name: "G1", targetAreaM2: 2000 }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.placements).toHaveLength(1);
    const v = validateSitePlan(siteWith(r));
    expect(v.errors.filter((e) => e.code === "E001")).toHaveLength(0);
  });
});

describe("fitBuildings — two side-by-side", () => {
  it("fits two galpões respecting the min gap", () => {
    const buildable = buildBuildableRegion(square(150), {
      setbacks: { front: 5, sides: 1.5, back: 3 },
      streetEdges: [0],
      laneBufferM: 6,
    });
    const r = fitBuildings({
      buildable,
      requests: [
        { id: "A", name: "A", targetAreaM2: 1500 },
        { id: "B", name: "B", targetAreaM2: 1500 },
      ],
    });
    expect(r.ok).toBe(true);
    const site = siteWith(r, 150);
    const v = validateSitePlan(site);
    expect(
      v.errors.filter((e) => ["E001", "E002"].includes(e.code)),
    ).toHaveLength(0);
  });
});

describe("fitBuildings — four in a grid", () => {
  it("places 4 galpões without overflow or overlap", () => {
    const buildable = buildBuildableRegion(square(200), {
      setbacks: { front: 5, sides: 1.5, back: 3 },
      streetEdges: [0],
      laneBufferM: 6,
    });
    const r = fitBuildings({
      buildable,
      requests: [
        { id: "A", name: "A", targetAreaM2: 1200 },
        { id: "B", name: "B", targetAreaM2: 1200 },
        { id: "C", name: "C", targetAreaM2: 1200 },
        { id: "D", name: "D", targetAreaM2: 1200 },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.placements).toHaveLength(4);
    const v = validateSitePlan(siteWith(r, 200));
    expect(
      v.errors.filter((e) => ["E001", "E002"].includes(e.code)),
    ).toHaveLength(0);
  });
});

describe("fitBuildings — rejects when it does not fit", () => {
  it("returns ok=false with reason for impossible programs", () => {
    const buildable = buildBuildableRegion(square(40), {
      setbacks: { front: 5, sides: 1.5, back: 3 },
      streetEdges: [0],
      laneBufferM: 6,
    });
    const r = fitBuildings({
      buildable,
      requests: [
        { id: "A", name: "A", targetAreaM2: 800 },
        { id: "B", name: "B", targetAreaM2: 800 },
        { id: "C", name: "C", targetAreaM2: 800 },
        { id: "D", name: "D", targetAreaM2: 800 },
      ],
    });
    expect(r.ok).toBe(false);
  });
});
