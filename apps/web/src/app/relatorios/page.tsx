import Link from "next/link";
import { prisma } from "@sfg/db";
import { Breadcrumb } from "@/components/Breadcrumb";
import {
  ReportsExplorer,
  type ReportRowData,
  type ReportTerrainGroup,
} from "@/components/ReportsExplorer";
import { isIndustrialShed, type IndustrialShed } from "@/lib/shedSchema";
import { SitePlanSchema } from "@/lib/sitePlanSchema";
import { synthesizeShedFromPlacement } from "@/lib/shedDefaults";
import { computeViability, extractUF } from "@/lib/knowledge";

export const dynamic = "force-dynamic";

/** Reconstrói a viabilidade SINAPI/CUB de um galpão (mesma lógica do relatório). */
function shedCost(shed: IndustrialShed, uf?: string): number {
  const est = computeViability({
    uf,
    standard: shed.standard,
    areaM2: shed.footprint.width * shed.footprint.depth,
    storeys: shed.mezzanine ? 2 : 1,
    insulation:
      shed.envelope.insulation === "nenhum"
        ? "basico"
        : shed.envelope.insulation,
    roofCover: shed.roof.cover,
    freeSpanM: shed.structure.freeSpan,
    clearHeightM: shed.structure.clearHeight,
    floorLoadKnM2: shed.floor.load_kN_m2,
    docksCount: shed.docks.length,
    avcbRequired: shed.safety.avcbRequired,
    slopePct: shed.lot.slopePct ?? null,
    hasSounding: undefined,
    hasTopo: shed.lot.slopePct != null,
  });
  return est.totalCost.base;
}

/**
 * Custo total do galpão de um relatório. Igual ao card "Custo total" da
 * página de detalhe / viewer 3D: usa o valor estimado salvo se houver, senão
 * recalcula a viabilidade a partir do(s) shed(s) do SitePlan (sintetizando
 * quando o placement só guarda o footprint) ou do model direto.
 */
function readCost(
  buildingModel: unknown,
  sitePlanData: unknown,
  state?: string | null,
): number {
  // 1) Coleta os sheds: SitePlan referenciado → model como SitePlan → model como shed.
  let sheds: IndustrialShed[] = [];
  const fromSitePlan = (data: unknown): IndustrialShed[] => {
    const parsed = SitePlanSchema.safeParse(data);
    if (!parsed.success) return [];
    return (parsed.data.buildings ?? []).map((b) =>
      b.shed && isIndustrialShed(b.shed)
        ? b.shed
        : synthesizeShedFromPlacement(b),
    );
  };

  if (sitePlanData) sheds = fromSitePlan(sitePlanData);
  if (sheds.length === 0) sheds = fromSitePlan(buildingModel);
  if (sheds.length === 0 && isIndustrialShed(buildingModel)) {
    sheds = [buildingModel];
  }
  if (sheds.length === 0) return 0;

  // 2) Soma o custo salvo; se zerado, recalcula a viabilidade.
  const stored = sheds.reduce((acc, s) => acc + (s.estimate.totalCost || 0), 0);
  if (stored > 0) return stored;

  const ufResolved = extractUF(state ?? null);
  const uf = ufResolved === "BR" ? undefined : ufResolved;
  return sheds.reduce((acc, s) => acc + shedCost(s, uf), 0);
}

function mapReport(
  r: {
    id: string;
    code: string;
    version: number;
    status: string;
    createdAt: Date;
    blocks: unknown;
    building: { id: string; name: string; model: unknown } | null;
  },
  state: string | null,
  sitePlanById: Map<string, unknown>,
): ReportRowData {
  const blocks = r.blocks as { sitePlanId?: string } | null;
  const sitePlanData = blocks?.sitePlanId
    ? (sitePlanById.get(blocks.sitePlanId) ?? null)
    : null;
  return {
    id: r.id,
    code: r.code,
    version: r.version,
    status: r.status,
    date: r.createdAt.toISOString(),
    buildingId: r.building?.id ?? null,
    buildingName: r.building?.name ?? "—",
    cost: readCost(r.building?.model ?? null, sitePlanData, state),
  };
}

export default async function RelatoriosPage() {
  const terrains = await prisma.terrain.findMany({
    include: {
      briefings: {
        orderBy: { createdAt: "desc" },
        include: {
          reports: {
            orderBy: { version: "desc" },
            include: { building: true },
          },
        },
      },
      reports: {
        where: { briefingId: null },
        orderBy: { createdAt: "desc" },
        include: { building: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Recupera os SitePlans referenciados em report.blocks.sitePlanId — alguns
  // relatórios guardam o galpão no SitePlan separado, não em building.model.
  const sitePlanIds = new Set<string>();
  for (const t of terrains) {
    const collect = (blocks: unknown) => {
      const b = blocks as { sitePlanId?: string } | null;
      if (b?.sitePlanId) sitePlanIds.add(b.sitePlanId);
    };
    for (const b of t.briefings) for (const r of b.reports) collect(r.blocks);
    for (const r of t.reports) collect(r.blocks);
  }
  const sitePlanById = new Map<string, unknown>();
  if (sitePlanIds.size > 0) {
    const plans = await prisma.sitePlan.findMany({
      where: { id: { in: Array.from(sitePlanIds) } },
      select: { id: true, data: true },
    });
    for (const p of plans) sitePlanById.set(p.id, p.data);
  }

  const groups: ReportTerrainGroup[] = terrains
    .map((t) => ({
      id: t.id,
      name: t.name,
      city: t.city,
      state: t.state,
      briefings: t.briefings
        .filter((b) => b.reports.length > 0)
        .map((b) => ({
          id: b.id,
          title: b.title,
          statusLabel: b.acceptedAt
            ? `aceito em ${new Date(b.acceptedAt).toLocaleDateString("pt-BR")}`
            : `status: ${b.status}`,
          reports: b.reports.map((r) => mapReport(r, t.state, sitePlanById)),
        })),
      legacyReports: t.reports.map((r) => mapReport(r, t.state, sitePlanById)),
    }))
    .filter((g) => g.briefings.length > 0 || g.legacyReports.length > 0);

  const totalReports = groups.reduce(
    (s, g) =>
      s +
      g.legacyReports.length +
      g.briefings.reduce((ss, b) => ss + b.reports.length, 0),
    0,
  );

  return (
    <>
      <header className="page-header">
        <div className="stack-sm">
          <Breadcrumb items={[{ label: "Relatórios" }]} />
          <div className="page-title-row">
            <h1>
              {totalReports} relatório{totalReports === 1 ? "" : "s"} ·{" "}
              {groups.length} terreno{groups.length === 1 ? "" : "s"}
            </h1>
            <span className="pill pill-success">
              <span className="dot" />
              Agrupados por Terreno → Briefing
            </span>
          </div>
          <p className="text-sm muted" style={{ maxWidth: "64ch" }}>
            Cada briefing pode gerar múltiplos relatórios versionados.
          </p>
        </div>
      </header>

      {groups.length === 0 ? (
        <div className="card empty">
          <div className="empty-icon">📑</div>
          <div className="empty-title">Nenhum relatório ainda</div>
          <div className="empty-desc">
            Conclua um briefing e aceite o estudo para gerar o primeiro
            relatório.
          </div>
          <Link href="/" className="btn btn-primary">
            Ver carteira
          </Link>
        </div>
      ) : (
        <ReportsExplorer groups={groups} />
      )}
    </>
  );
}
