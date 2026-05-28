import { describe, it, expect } from "vitest";
import {
  buildBuildableRegion,
  buildPerimeterSegments,
  detectStreetEdges,
  ensureCCW,
  getEdges,
  insetConvexPolygon,
  placeGates,
  polygonBBox,
  projectLotToLocal,
} from "../siteGeometry";

function square(side = 100) {
  // CCW in (x, z): south, east, north, west.
  return [
    { x: 0, z: 0 },
    { x: side, z: 0 },
    { x: side, z: side },
    { x: 0, z: side },
  ];
}

describe("projectLotToLocal", () => {
  it("maps the first vertex to the origin", () => {
    const lot = projectLotToLocal([
      [-46.6, -23.5],
      [-46.601, -23.5],
      [-46.601, -23.501],
      [-46.6, -23.501],
    ]);
    expect(lot.local[0].x).toBeCloseTo(0, 6);
    expect(lot.local[0].z).toBeCloseTo(0, 6);
    expect(lot.local).toHaveLength(4);
  });
});

describe("getEdges + ensureCCW", () => {
  it("computes outward normals for a CCW square", () => {
    const edges = getEdges(ensureCCW(square()));
    // south edge → outward normal points -Z
    expect(edges[0].normal.z).toBeCloseTo(-1, 6);
    // east edge → +X
    expect(edges[1].normal.x).toBeCloseTo(1, 6);
    // north edge → +Z
    expect(edges[2].normal.z).toBeCloseTo(1, 6);
    // west edge → -X
    expect(edges[3].normal.x).toBeCloseTo(-1, 6);
  });
});

describe("detectStreetEdges", () => {
  it("matches the south edge when the street runs parallel to it", () => {
    const lot = square(100);
    const street = [
      { x: -50, z: -3 },
      { x: 150, z: -3 },
    ];
    const idx = detectStreetEdges(lot, [street]);
    expect(idx).toEqual([0]);
  });

  it("returns empty when streets are far away", () => {
    const lot = square(100);
    const street = [
      { x: -50, z: -50 },
      { x: 150, z: -50 },
    ];
    expect(detectStreetEdges(lot, [street])).toEqual([]);
  });
});

describe("buildPerimeterSegments + placeGates", () => {
  it("creates one segment per edge with default muro 2.2 m", () => {
    const segs = buildPerimeterSegments(square());
    expect(segs).toHaveLength(4);
    expect(segs[0]).toMatchObject({ kind: "muro", height: 2.2 });
  });

  it("places a truck-sized gate centered on the longest street edge", () => {
    const gates = placeGates(square(100), [0], { truckAccess: true });
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatchObject({
      edgeIndex: 0,
      tAlongEdge: 0.5,
      kind: "caminhao",
    });
    expect(gates[0].width).toBeGreaterThanOrEqual(6);
  });
});

describe("insetConvexPolygon + buildBuildableRegion", () => {
  it("shrinks a square by the inset distance", () => {
    const inner = insetConvexPolygon(square(100), 5);
    expect(inner).not.toBeNull();
    const bb = polygonBBox(inner!);
    expect(bb.width).toBeCloseTo(90, 3);
    expect(bb.depth).toBeCloseTo(90, 3);
  });

  it("returns null when inset collapses polygon", () => {
    expect(insetConvexPolygon(square(10), 6)).toBeNull();
  });

  it("applies worst-case setback + lane buffer", () => {
    const region = buildBuildableRegion(square(100), {
      setbacks: { front: 5, sides: 1.5, back: 3 },
      streetEdges: [0],
      laneBufferM: 6,
    });
    // worst = 5, plus lane 6 ⇒ inset 11
    const bb = polygonBBox(region);
    expect(bb.width).toBeCloseTo(78, 3);
    expect(bb.depth).toBeCloseTo(78, 3);
  });
});
