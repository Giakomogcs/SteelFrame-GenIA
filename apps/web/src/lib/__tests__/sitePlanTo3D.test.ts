import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  buildPerimeterLayer,
  buildShedMesh,
  findOutsideLot,
  sitePlanTo3D,
} from "../sitePlanTo3D";
import { SitePlanSchema, type SitePlan } from "../sitePlanSchema";
import { buildBuildableRegion } from "../siteGeometry";
import { fitBuildings } from "../siteLayout";

function squareLot(side = 100) {
  return [
    { x: 0, z: 0 },
    { x: side, z: 0 },
    { x: side, z: side },
    { x: 0, z: side },
  ];
}

function siteFor(
  lotSide: number,
  requests: { id: string; name: string; area: number }[],
) {
  const lot = squareLot(lotSide);
  const buildable = buildBuildableRegion(lot, {
    setbacks: { front: 5, sides: 1.5, back: 3 },
    streetEdges: [0],
    laneBufferM: 6,
  });
  const fit = fitBuildings({
    buildable,
    requests: requests.map((r) => ({
      id: r.id,
      name: r.name,
      targetAreaM2: r.area,
    })),
  });
  if (!fit.ok) throw new Error(fit.reason);
  const site: SitePlan = SitePlanSchema.parse({
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
    streetEdges: [0],
    setbacks: { front: 5, sides: 1.5, back: 3 },
    buildings: fit.placements,
    perimeter: {
      segments: [
        { edgeIndex: 0, kind: "muro", height: 2.2 },
        { edgeIndex: 1, kind: "muro", height: 2.2 },
        { edgeIndex: 2, kind: "muro", height: 2.2 },
        { edgeIndex: 3, kind: "muro", height: 2.2 },
      ],
    },
    gates: [
      {
        id: "G1",
        edgeIndex: 0,
        tAlongEdge: 0.5,
        width: 6,
        kind: "caminhao",
      },
    ],
  });
  return site;
}

describe("sitePlanTo3D — group structure", () => {
  it("emits the expected top-level layers", () => {
    const site = siteFor(100, [{ id: "B1", name: "G1", area: 1500 }]);
    const g = sitePlanTo3D(site);
    expect(g.name).toBe("site");
    const childNames = g.children.map((c) => c.name);
    expect(childNames).toEqual([
      "layer:terrain",
      "layer:perimeter",
      "layer:gates",
      "layer:buildings",
    ]);
  });

  it("creates one shed group per placement", () => {
    const site = siteFor(150, [
      { id: "A", name: "A", area: 1200 },
      { id: "B", name: "B", area: 1200 },
    ]);
    const g = sitePlanTo3D(site);
    const buildings = g.getObjectByName("layer:buildings") as THREE.Group;
    expect(buildings.children).toHaveLength(2);
    expect(buildings.children.map((c) => c.name)).toEqual(["shed:A", "shed:B"]);
  });

  it("uses bayCount/baySpacing/freeSpan from the IndustrialShed", () => {
    const site = siteFor(150, [{ id: "B1", name: "G1", area: 1500 }]);
    const placement = site.buildings[0];
    placement.shedId = "S1";
    const shed = {
      schemaVersion: "shed-1",
      structure: {
        system: "porticos_aco",
        bayCount: 4,
        baySpacing: 6,
        freeSpan: 20,
        clearHeight: 8,
        columnProfile: "W250x32",
        roofStructure: "trelica",
      },
      // minimal stub: only fields used by buildShedMesh
    } as never;
    const g = buildShedMesh(placement, shed);
    const trusses = g.children.filter((c) => c.name.startsWith("truss:"));
    // bayCount = "Nº de pórticos" (schema): criamos exatamente esse número
    // de pórticos, distribuídos sobre a profundidade real do placement.
    expect(trusses).toHaveLength(4);
    const columns = g.children.filter((c) => c.name.startsWith("column:"));
    expect(columns).toHaveLength(2 * 4); // L + R por pórtico
  });
});

describe("sitePlanTo3D — perimeter gate gap", () => {
  it("splits the street edge wall around the gate", () => {
    const site = siteFor(100, [{ id: "B1", name: "G1", area: 1500 }]);
    const g = buildPerimeterLayer(site, site.perimeter.segments, site.gates);
    const edge0Walls = g.children.filter((c) =>
      c.name.startsWith("perimeter:edge0"),
    );
    expect(edge0Walls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("clampToPolygon — buildings stay inside lot (AC4)", () => {
  const fixtures = [
    { side: 100, reqs: [{ id: "B1", name: "G1", area: 1500 }] },
    {
      side: 150,
      reqs: [
        { id: "A", name: "A", area: 1500 },
        { id: "B", name: "B", area: 1500 },
      ],
    },
    {
      side: 200,
      reqs: [
        { id: "A", name: "A", area: 1500 },
        { id: "B", name: "B", area: 1500 },
        { id: "C", name: "C", area: 1500 },
        { id: "D", name: "D", area: 1500 },
      ],
    },
  ];
  for (const f of fixtures) {
    it(`fixture lot=${f.side}m with ${f.reqs.length} buildings`, () => {
      const site = siteFor(f.side, f.reqs);
      const root = sitePlanTo3D(site);
      const buildings = root.getObjectByName("layer:buildings") as THREE.Group;
      const offenders = findOutsideLot(buildings, site.lotPolygonLocal);
      expect(offenders).toEqual([]);
    });
  }
});
