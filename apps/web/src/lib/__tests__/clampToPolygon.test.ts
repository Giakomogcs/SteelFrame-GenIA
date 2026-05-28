// ============================================================
// clampToPolygon.test.ts — PRD §16 / AC4
// Garante que nenhuma geometria 3D ultrapassa o polígono do
// lote em N fixtures variando lado/quantidade de galpões.
// ============================================================
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { SitePlanSchema, type SitePlan } from "../sitePlanSchema";
import { buildBuildableRegion } from "../siteGeometry";
import { fitBuildings } from "../siteLayout";
import { sitePlanTo3D, findOutsideLot } from "../sitePlanTo3D";

function squareLot(side: number) {
  return [
    { x: 0, z: 0 },
    { x: side, z: 0 },
    { x: side, z: side },
    { x: 0, z: side },
  ];
}

function rectLot(w: number, d: number) {
  return [
    { x: 0, z: 0 },
    { x: w, z: 0 },
    { x: w, z: d },
    { x: 0, z: d },
  ];
}

function siteFor(
  lot: { x: number; z: number }[],
  count: number,
  area: number,
): SitePlan {
  const buildable = buildBuildableRegion(lot, {
    setbacks: { front: 5, sides: 1.5, back: 3 },
    streetEdges: [0],
    laneBufferM: 6,
  });
  const fit = fitBuildings({
    buildable,
    requests: Array.from({ length: count }, (_, i) => ({
      id: `B${i + 1}`,
      name: `G${i + 1}`,
      targetAreaM2: area,
    })),
  });
  if (!fit.ok) throw new Error(`fit failed: ${fit.reason}`);
  return SitePlanSchema.parse({
    schemaVersion: "site-1",
    terrainId: "T",
    lotPolygon: lot.map((p, i) => [-46.6 + i * 0.0001, -23.5 + p.z * 1e-5]),
    lotPolygonLocal: lot,
    streetEdges: [0],
    setbacks: { front: 5, sides: 1.5, back: 3 },
    perimeter: { segments: [] },
    gates: [],
    buildings: fit.placements,
    parking: [],
    circulation: [],
    greenAreas: [],
  });
}

describe("clampToPolygon (AC4)", () => {
  const fixtures: Array<{
    name: string;
    lot: { x: number; z: number }[];
    count: number;
    area: number;
  }> = [
    {
      name: "square 100m × 1 galpão 1200m²",
      lot: squareLot(100),
      count: 1,
      area: 1200,
    },
    {
      name: "square 100m × 2 galpões 800m²",
      lot: squareLot(100),
      count: 2,
      area: 800,
    },
    {
      name: "square 150m × 4 galpões 1500m²",
      lot: squareLot(150),
      count: 4,
      area: 1500,
    },
    {
      name: "square 200m × 4 galpões 4000m²",
      lot: squareLot(200),
      count: 4,
      area: 4000,
    },
    {
      name: "rect 120×80 × 1 galpão 1500m²",
      lot: rectLot(120, 80),
      count: 1,
      area: 1500,
    },
    {
      name: "rect 200×100 × 2 galpões 3000m²",
      lot: rectLot(200, 100),
      count: 2,
      area: 3000,
    },
  ];
  for (const fx of fixtures) {
    it(fx.name, () => {
      const site = siteFor(fx.lot, fx.count, fx.area);
      const group = sitePlanTo3D(site, { lod: "structural" });
      const buildings = group.getObjectByName("layer:buildings") as THREE.Group;
      const offenders = findOutsideLot(buildings, fx.lot);
      expect(offenders).toEqual([]);
    });
  }
});
