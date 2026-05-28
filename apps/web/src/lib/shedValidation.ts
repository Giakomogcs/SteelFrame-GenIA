// Normalização (clamp) e validação geométrica do IndustrialShed.
import type { IndustrialShed } from "./shedSchema";

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeRawShed(raw: any): any {
  if (!raw || typeof raw !== "object") return raw;

  raw.schemaVersion = "shed-1";

  if (raw.lot) {
    raw.lot.width = clamp(Number(raw.lot.width) || 30, 10, 800);
    raw.lot.depth = clamp(Number(raw.lot.depth) || 50, 10, 1500);
    raw.lot.slopePct = clamp(Number(raw.lot.slopePct) || 0, 0, 40);
  }

  if (raw.footprint) {
    raw.footprint.width = clamp(Number(raw.footprint.width) || 20, 6, 500);
    raw.footprint.depth = clamp(Number(raw.footprint.depth) || 40, 6, 800);
  }

  if (raw.structure) {
    raw.structure.baySpacing = clamp(
      Number(raw.structure.baySpacing) || 7,
      4,
      12,
    );
    raw.structure.freeSpan = clamp(
      Number(raw.structure.freeSpan) || raw.footprint?.width || 20,
      6,
      80,
    );
    raw.structure.clearHeight = clamp(
      Number(raw.structure.clearHeight) || 8,
      4,
      20,
    );
    // Recalcula bayCount a partir do espaçamento se inconsistente
    if (raw.footprint?.depth) {
      raw.structure.bayCount = Math.max(
        1,
        Math.round(raw.footprint.depth / raw.structure.baySpacing),
      );
    } else {
      raw.structure.bayCount = clamp(
        Math.round(Number(raw.structure.bayCount) || 5),
        1,
        60,
      );
    }
  }

  if (raw.roof) {
    raw.roof.slopePct = clamp(Number(raw.roof.slopePct) || 10, 0, 40);
    raw.roof.overhang = clamp(Number(raw.roof.overhang) || 0.6, 0, 3);
    raw.roof.skylightPct = clamp(Number(raw.roof.skylightPct) || 4, 0, 20);
  }

  if (Array.isArray(raw.zones)) {
    raw.zones = raw.zones.map((zone: Record<string, unknown>) => ({
      ...zone,
      x: Number(zone.x) || 0,
      z: Number(zone.z) || 0,
      width: clamp(Number(zone.width) || 3, 1, 500),
      depth: clamp(Number(zone.depth) || 3, 1, 800),
      height: clamp(Number(zone.height) || 3, 2.2, 20),
      floorLoad_kN_m2: clamp(Number(zone.floorLoad_kN_m2) || 30, 2, 150),
    }));
  } else {
    raw.zones = [];
  }

  if (Array.isArray(raw.docks)) {
    raw.docks = raw.docks.map((d: Record<string, unknown>) => ({
      ...d,
      x: Number(d.x) || 0,
      z: Number(d.z) || 0,
    }));
  } else {
    raw.docks = [];
  }

  if (raw.mezzanine && typeof raw.mezzanine === "object") {
    raw.mezzanine.x = Number(raw.mezzanine.x) || 0;
    raw.mezzanine.z = Number(raw.mezzanine.z) || 0;
    raw.mezzanine.width = clamp(Number(raw.mezzanine.width) || 5, 2, 200);
    raw.mezzanine.depth = clamp(Number(raw.mezzanine.depth) || 5, 2, 200);
    raw.mezzanine.height = clamp(Number(raw.mezzanine.height) || 3, 2.2, 8);
  }

  if (Array.isArray(raw.craneRails)) {
    raw.craneRails = raw.craneRails.map((c: Record<string, unknown>) => ({
      capacity_t: clamp(Number(c.capacity_t) || 5, 0.5, 50),
      span: clamp(Number(c.span) || 15, 4, 60),
      height: clamp(Number(c.height) || 8, 4, 20),
    }));
  } else {
    raw.craneRails = [];
  }

  if (Array.isArray(raw.openings)) {
    raw.openings = raw.openings.map((o: Record<string, unknown>) => ({
      ...o,
      xAlongWall: Math.max(0, Number(o.xAlongWall) || 0),
      width: clamp(Number(o.width) || 1, 0.6, 20),
      height: clamp(Number(o.height) || 2.2, 0.6, 8),
      elevation: clamp(Number(o.elevation) || 0, 0, 15),
    }));
  } else {
    raw.openings = [];
  }

  if (raw.floor) {
    raw.floor.load_kN_m2 = clamp(Number(raw.floor.load_kN_m2) || 30, 2, 150);
    raw.floor.thickness_cm = clamp(Number(raw.floor.thickness_cm) || 15, 8, 40);
  }

  if (raw.confidence != null) {
    raw.confidence = clamp(Number(raw.confidence) || 0.6, 0, 1);
  }

  if (!Array.isArray(raw.assumptions)) raw.assumptions = [];

  return raw;
}

// --- Validação semântica ----------------------------------------------------

export function findShedValidationErrors(shed: IndustrialShed): string[] {
  const errors: string[] = [];
  const { footprint, structure, roof, zones, docks, openings, lot, setbacks } =
    shed;

  // Vão livre deve caber no footprint
  if (structure.freeSpan > footprint.width + 0.5) {
    errors.push(
      `vão livre (${structure.freeSpan}m) maior que largura do footprint (${footprint.width}m)`,
    );
  }

  // Bay count × spacing ≈ depth
  const expectedDepth = structure.bayCount * structure.baySpacing;
  if (Math.abs(expectedDepth - footprint.depth) > Math.max(2, footprint.depth * 0.1)) {
    errors.push(
      `bayCount(${structure.bayCount}) × baySpacing(${structure.baySpacing}) ≠ depth(${footprint.depth})`,
    );
  }

  // Footprint deve caber no lote considerando recuos
  const lotInnerW = lot.width - (setbacks.sides * 2);
  const lotInnerD = lot.depth - setbacks.front - setbacks.back;
  if (footprint.width > lotInnerW + 0.5) {
    errors.push(
      `footprint largura (${footprint.width}m) maior que lote útil (${lotInnerW.toFixed(1)}m) após recuos`,
    );
  }
  if (footprint.depth > lotInnerD + 0.5) {
    errors.push(
      `footprint profundidade (${footprint.depth}m) maior que lote útil (${lotInnerD.toFixed(1)}m) após recuos`,
    );
  }

  // Zonas dentro do footprint e sem sobreposição
  for (const z of zones) {
    if (z.x < -0.1 || z.z < -0.1) {
      errors.push(`zona "${z.name}" com coordenada negativa`);
    }
    if (z.x + z.width > footprint.width + 0.5) {
      errors.push(`zona "${z.name}" extrapola largura do footprint`);
    }
    if (z.z + z.depth > footprint.depth + 0.5) {
      errors.push(`zona "${z.name}" extrapola profundidade do footprint`);
    }
  }
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i];
      const b = zones[j];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapZ = Math.min(a.z + a.depth, b.z + b.depth) - Math.max(a.z, b.z);
      if (overlapX > 0.2 && overlapZ > 0.2) {
        errors.push(`zonas sobrepostas: "${a.name}" × "${b.name}"`);
      }
    }
  }

  // Aberturas com xAlongWall dentro da parede correspondente
  for (const op of openings) {
    const wallLen =
      op.wall === "north" || op.wall === "south"
        ? footprint.width
        : footprint.depth;
    if (op.xAlongWall + op.width > wallLen + 0.5) {
      errors.push(
        `abertura ${op.type} extrapola parede ${op.wall} (${(op.xAlongWall + op.width).toFixed(1)}m > ${wallLen}m)`,
      );
    }
  }

  // Docas: pelo menos 1 para logística/cross_dock
  if ((shed.use === "logistics" || shed.use === "cross_dock") && docks.length === 0) {
    errors.push("uso logístico exige pelo menos 1 doca");
  }

  // Skylight razoável
  if (roof.skylightPct > 15) {
    errors.push(`skylightPct=${roof.skylightPct} excessivo (>15%)`);
  }

  // AVCB: rotas ≤ 30m
  if (shed.safety.avcbRequired && shed.safety.maxTravelDistance_m > 40) {
    errors.push("rota de fuga > 40m com AVCB exigido (NBR 9077)");
  }

  return errors;
}
