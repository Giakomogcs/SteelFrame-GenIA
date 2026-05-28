// ============================================================
// SitePlanSchema — single source of truth for the 2D site plan.
// The 3D scene is a deterministic projection of this model.
//
// schemaVersion: "site-1"
// ============================================================
import { z } from "zod";

// ---- Primitive geometry --------------------------------------------------

/** Local ENU point in meters, ground plane = (x, z), Y is up. */
export const Vec2Schema = z.object({
  x: z.number().finite(),
  z: z.number().finite(),
});

/** Lng/lat pair as in Terrain.polygon: [lng, lat]. */
export const LngLatSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

export const PolygonLocalSchema = z
  .array(Vec2Schema)
  .min(3)
  .describe("Closed polygon in local ENU meters (no repeated last vertex).");

export const PolygonGeoSchema = z
  .array(LngLatSchema)
  .min(3)
  .describe("Closed polygon as [lng, lat] vertices.");

// ---- Setbacks & street ---------------------------------------------------

export const SiteSetbacksSchema = z.object({
  front: z.number().min(0).max(50).default(5),
  sides: z.number().min(0).max(50).default(1.5),
  back: z.number().min(0).max(50).default(3),
});
export type SiteSetbacks = z.infer<typeof SiteSetbacksSchema>;

// ---- Perimeter & gates ---------------------------------------------------

export const PerimeterSegmentSchema = z.object({
  /** Index of the lot edge this segment belongs to (0..N-1). */
  edgeIndex: z.number().int().min(0),
  kind: z
    .enum(["muro", "alambrado", "concertina", "vazio"])
    .default("muro"),
  height: z.number().min(0).max(6).default(2.2),
});
export type PerimeterSegment = z.infer<typeof PerimeterSegmentSchema>;

export const GateSchema = z.object({
  id: z.string().min(1),
  /** Index of the street edge the gate sits on. */
  edgeIndex: z.number().int().min(0),
  /** Position along the edge, normalized 0..1 from edge start to end. */
  tAlongEdge: z.number().min(0).max(1),
  width: z.number().min(2).max(20).default(6),
  kind: z.enum(["pedestre", "leve", "caminhao"]).default("caminhao"),
});
export type Gate = z.infer<typeof GateSchema>;

// ---- Buildings (placements) ---------------------------------------------

export const BuildingUseSchema = z.enum([
  "logistics",
  "industrial",
  "cross_dock",
  "distribution_center",
  "cold_storage",
  "manufacturing",
]);
export type BuildingUse = z.infer<typeof BuildingUseSchema>;

export const BuildingPlacementSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Reference to the IndustrialShed describing this building's program. */
  shedId: z.string().min(1).nullable().default(null),
  use: BuildingUseSchema.default("logistics"),
  /** Target gross area in m² (used by fitBuildings). */
  targetAreaM2: z.number().min(50).max(500_000).default(2000),
  /** Footprint polygon in local ENU meters (m). Convex, oriented CCW. */
  footprintPolygon: PolygonLocalSchema,
  /** Rotation of the footprint around its centroid (radians). */
  rotationRad: z.number().default(0),
  /** Floor elevation derived from the terrain (m above local datum). */
  z0: z.number().default(0),
});
export type BuildingPlacement = z.infer<typeof BuildingPlacementSchema>;

// ---- Parking, circulation, green ----------------------------------------

export const ParkingAreaSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["car", "truck"]).default("car"),
  polygon: PolygonLocalSchema,
  stallCount: z.number().int().min(0).max(5000).default(0),
});
export type ParkingArea = z.infer<typeof ParkingAreaSchema>;

export const LaneSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["car", "truck"]).default("truck"),
  centerline: z.array(Vec2Schema).min(2),
  widthM: z.number().min(3).max(30).default(12),
});
export type Lane = z.infer<typeof LaneSchema>;

export const GreenAreaSchema = z.object({
  id: z.string().min(1),
  polygon: PolygonLocalSchema,
});

// ---- Validation report ---------------------------------------------------

export const ValidationCodeSchema = z.enum([
  "E001",
  "E002",
  "E003",
  "E004",
  "E005",
  "E006",
  "W101",
  "W102",
]);
export type ValidationCode = z.infer<typeof ValidationCodeSchema>;

export const ValidationIssueSchema = z.object({
  code: ValidationCodeSchema,
  severity: z.enum(["error", "warning"]),
  message: z.string().min(1),
  where: Vec2Schema.optional(),
  /** Optional reference to the offending entity id (gate/building/etc). */
  ref: z.string().optional(),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const ValidationReportSchema = z.object({
  ok: z.boolean(),
  errors: z.array(ValidationIssueSchema).default([]),
  warnings: z.array(ValidationIssueSchema).default([]),
});
export type ValidationReport = z.infer<typeof ValidationReportSchema>;

// ---- Main SitePlan -------------------------------------------------------

export const SitePlanSchema = z.object({
  schemaVersion: z.literal("site-1").default("site-1"),
  terrainId: z.string().min(1),

  lotPolygon: PolygonGeoSchema,
  lotPolygonLocal: PolygonLocalSchema,
  /** Rotation that aligns geographic north with +Z (radians). */
  northAngleRad: z.number().default(0),
  /** Indices of edges classified as "street". */
  streetEdges: z.array(z.number().int().min(0)).default([]),

  setbacks: SiteSetbacksSchema.default({ front: 5, sides: 1.5, back: 3 }),

  perimeter: z
    .object({ segments: z.array(PerimeterSegmentSchema).default([]) })
    .default({ segments: [] }),

  gates: z.array(GateSchema).default([]),
  buildings: z.array(BuildingPlacementSchema).default([]),
  parking: z.array(ParkingAreaSchema).default([]),
  circulation: z.array(LaneSchema).default([]),
  greenAreas: z.array(GreenAreaSchema).default([]),

  /**
   * Optional zoning context (echoed from Terrain.to / Terrain.ca).
   * Used by validateSitePlan to enforce E003.
   */
  zoning: z
    .object({
      to: z.number().min(0).max(1).optional(),
      ca: z.number().min(0).max(20).optional(),
    })
    .optional(),

  validations: ValidationReportSchema.default({
    ok: true,
    errors: [],
    warnings: [],
  }),
});

export type SitePlan = z.infer<typeof SitePlanSchema>;
