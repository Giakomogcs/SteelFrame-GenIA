// ============================================================
// refineIntent — interpreta mensagens em português do RefineChat
// e devolve um SitePlan completo (proposta) já ajustado. Puro,
// sem IO; usado tanto pelo endpoint /refine quanto por testes.
//
// Cobre as intenções mais comuns do MVP:
//   • "adicione/adicionar/crie/mais N galpão|galpões"
//   • "remova/remover/excluir galpão N"
//   • "aumente/diminua a área do galpão N para X m²"
//   • "recuo frente|lados|fundo X m"
//
// Para qualquer mensagem não reconhecida devolve null para que
// a camada superior decida (ex.: tentar Azure AI ou apenas devolver
// o plano atual sem mudanças).
// ============================================================
import { buildBuildableRegion, polygonBBox } from "./siteGeometry";
import { fitBuildings, type BuildingRequest } from "./siteLayout";
import type {
  BuildingPlacement,
  BuildingUse,
  SitePlan,
} from "./sitePlanSchema";

export interface RefineOutcome {
  next: SitePlan;
  summary: string;
}

const WORD_TO_NUMBER: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
};

function parseCount(token: string | undefined): number {
  if (!token) return 1;
  const n = Number(token);
  if (Number.isFinite(n) && n > 0) return Math.min(n, 10);
  return WORD_TO_NUMBER[token.toLowerCase()] ?? 1;
}

function normalize(msg: string): string {
  return msg
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Recalcula a posição de TODOS os galpões a partir das premissas atuais,
 * mantendo nomes/ids/áreas. Útil quando adicionamos/removemos galpão.
 */
function relayout(
  site: SitePlan,
  requests: BuildingRequest[],
): BuildingPlacement[] {
  const buildable = buildBuildableRegion(site.lotPolygonLocal, {
    setbacks: site.setbacks,
    streetEdges: site.streetEdges,
  });
  if (!buildable) return [];
  const bbox = polygonBBox(site.lotPolygonLocal);
  const rotationRad = bbox.width >= bbox.depth ? 0 : Math.PI / 2;
  const fit = fitBuildings({ buildable, requests, rotationRad });
  // Em caso de overflow devolvemos o que coube — a UI mostra a validação.
  return fit.placements;
}

function buildingsToRequests(
  buildings: readonly BuildingPlacement[],
): BuildingRequest[] {
  return buildings.map((b) => ({
    id: b.id,
    name: b.name,
    use: b.use,
    targetAreaM2: b.targetAreaM2,
    shedId: b.shedId,
  }));
}

/**
 * Tenta interpretar `message`. Devolve `null` quando não souber o que fazer.
 * Sempre devolve um SitePlan novo (imutável) — não muta `site`.
 */
export function applyRefineIntent(
  site: SitePlan,
  message: string,
): RefineOutcome | null {
  const txt = normalize(message);

  // --- Adicionar galpões ----------------------------------------------
  const addMatch =
    txt.match(
      /(?:adicion\w+|cri\w+|mais|outr[oa]|faz|faca|fazer)\s+(\d+|um|uma|dois|duas|tres|quatro|cinco)?\s*galp/,
    ) ?? txt.match(/(\d+)\s*galp[ãa]o.*(?:a\s*mais|adicion)/);
  if (addMatch) {
    const count = parseCount(addMatch[1]);
    const newRequests: BuildingRequest[] = [
      ...buildingsToRequests(site.buildings),
    ];
    const avgArea =
      site.buildings.length > 0
        ? Math.round(
            site.buildings.reduce((s, b) => s + b.targetAreaM2, 0) /
              site.buildings.length,
          )
        : 2000;
    const baseUse: BuildingUse = site.buildings[0]?.use ?? "logistics";
    const takenIds = new Set(newRequests.map((r) => r.id));
    const takenNames = new Set(newRequests.map((r) => r.name.toLowerCase()));
    for (let i = 0; i < count; i++) {
      let n = newRequests.length + 1;
      let id = `b${n}`;
      while (takenIds.has(id)) {
        n++;
        id = `b${n}`;
      }
      takenIds.add(id);
      let nameIdx = 1;
      let name = `Galpão ${nameIdx}`;
      while (takenNames.has(name.toLowerCase())) {
        nameIdx++;
        name = `Galpão ${nameIdx}`;
      }
      takenNames.add(name.toLowerCase());
      newRequests.push({
        id,
        name,
        use: baseUse,
        targetAreaM2: avgArea,
        shedId: null,
      });
    }
    const placements = relayout(site, newRequests);
    return {
      next: { ...site, buildings: placements },
      summary: `Adicionei ${count} galpão${count > 1 ? "es" : ""} (área ~${avgArea} m² cada). Layout recalculado.`,
    };
  }

  // --- Remover galpão N -----------------------------------------------
  const removeMatch = txt.match(
    /(?:remov\w+|exclu\w+|deleta\w+|tira\w+|apag\w+).*galp[ãa]o\s*(\d+)?/,
  );
  if (removeMatch) {
    if (site.buildings.length === 0) {
      return { next: site, summary: "Nenhum galpão para remover." };
    }
    const idx = removeMatch[1]
      ? Math.max(
          0,
          Math.min(site.buildings.length - 1, Number(removeMatch[1]) - 1),
        )
      : site.buildings.length - 1;
    const kept = site.buildings.filter((_, i) => i !== idx);
    const placements = relayout(site, buildingsToRequests(kept));
    return {
      next: { ...site, buildings: placements },
      summary: `Removi o galpão ${idx + 1}. Restam ${placements.length}.`,
    };
  }

  // --- Ajustar área do galpão N ---------------------------------------
  const areaMatch = txt.match(
    /(?:aument\w+|diminu\w+|mud\w+|ajust\w+).*galp[ãa]o\s*(\d+).*?(\d+(?:[\.,]\d+)?)\s*m/,
  );
  if (areaMatch) {
    const idx = Math.max(
      0,
      Math.min(site.buildings.length - 1, Number(areaMatch[1]) - 1),
    );
    const area = Math.round(Number(areaMatch[2].replace(",", ".")));
    if (!Number.isFinite(area) || area <= 0) return null;
    const newBuildings = site.buildings.map((b, i) =>
      i === idx ? { ...b, targetAreaM2: area } : b,
    );
    const placements = relayout(site, buildingsToRequests(newBuildings));
    return {
      next: { ...site, buildings: placements },
      summary: `Galpão ${idx + 1} ajustado para ~${area} m². Layout recalculado.`,
    };
  }

  // --- Recuos ---------------------------------------------------------
  const setbackMatch = txt.match(
    /recuo\s+(frente|lados?|fundo)\s+(?:para\s+|de\s+)?(\d+(?:[\.,]\d+)?)\s*m/,
  );
  if (setbackMatch) {
    const which = setbackMatch[1];
    const val = Number(setbackMatch[2].replace(",", "."));
    if (!Number.isFinite(val) || val < 0) return null;
    const setbacks = { ...site.setbacks };
    if (which === "frente") setbacks.front = val;
    else if (which.startsWith("lado")) setbacks.sides = val;
    else if (which === "fundo") setbacks.back = val;
    const next: SitePlan = { ...site, setbacks };
    const placements = relayout(next, buildingsToRequests(site.buildings));
    return {
      next: { ...next, buildings: placements },
      summary: `Recuo ${which} = ${val} m. Layout recalculado.`,
    };
  }

  return null;
}

/** Test-only re-exports. */
export const __test = { normalize, parseCount };
