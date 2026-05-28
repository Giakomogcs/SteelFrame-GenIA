// Biblioteca PBR procedural para galpões industriais. Sem texturas externas.

export interface PBRMaterialDef {
  color: string;
  roughness: number;
  metalness: number;
  opacity?: number;
  transparent?: boolean;
  emissive?: string;
  emissiveIntensity?: number;
}

export const SHED_MATERIALS: Record<string, PBRMaterialDef> = {
  // Coberturas
  telha_metalica: { color: "#9aa3ad", roughness: 0.45, metalness: 0.7 },
  telha_termoacustica: { color: "#c8ccd1", roughness: 0.55, metalness: 0.55 },
  sandwich_PIR: { color: "#e6e7ea", roughness: 0.6, metalness: 0.3 },
  fibrocimento: { color: "#aeb3b8", roughness: 0.9, metalness: 0.05 },

  // Fachadas / fechamentos
  ACM: { color: "#1f2937", roughness: 0.25, metalness: 0.85 },
  sandwich: { color: "#d0d3d8", roughness: 0.55, metalness: 0.4 },
  alvenaria_baixa_telha: { color: "#b9b3a4", roughness: 0.9, metalness: 0 },
  telha_lateral: { color: "#9aa3ad", roughness: 0.5, metalness: 0.6 },
  concreto_pre_moldado: { color: "#a8a8a8", roughness: 0.85, metalness: 0 },

  // Estrutura
  aco_galvanizado: { color: "#a9b2bd", roughness: 0.35, metalness: 0.85 },
  aco_pintado_branco: { color: "#eef2f5", roughness: 0.4, metalness: 0.6 },
  aco_pintado_cinza: { color: "#5d6671", roughness: 0.4, metalness: 0.7 },

  // Pisos
  industrial_polido: { color: "#7d818a", roughness: 0.35, metalness: 0.05 },
  concreto_armado: { color: "#8e9298", roughness: 0.85, metalness: 0 },
  epoxi_antiderrapante: { color: "#3b6ea5", roughness: 0.5, metalness: 0.05 },
  intertravado: { color: "#a8a097", roughness: 0.95, metalness: 0 },

  // Vidros / esquadrias
  vidro_clear: {
    color: "#cfe5ee",
    roughness: 0.05,
    metalness: 0.1,
    opacity: 0.35,
    transparent: true,
  },
  vidro_fume: {
    color: "#3b4a55",
    roughness: 0.08,
    metalness: 0.15,
    opacity: 0.55,
    transparent: true,
  },
  esquadria_aluminio: { color: "#1a1a1a", roughness: 0.3, metalness: 0.9 },

  // Portões
  portao_seccional: { color: "#dd1c4a", roughness: 0.5, metalness: 0.4 },
  portao_enrolar: { color: "#7e8a96", roughness: 0.55, metalness: 0.6 },

  // Skylights / lanternins
  policarbonato: {
    color: "#f6fbff",
    roughness: 0.2,
    metalness: 0.0,
    opacity: 0.65,
    transparent: true,
  },

  // Terreno / pátio
  asfalto: { color: "#2a2d33", roughness: 0.95, metalness: 0 },
  grama: { color: "#3f6d3a", roughness: 0.95, metalness: 0 },
  brita: { color: "#7c7973", roughness: 0.95, metalness: 0 },
  paver_industrial: { color: "#8e857a", roughness: 0.9, metalness: 0 },

  // Perímetro
  muro: { color: "#9a8f80", roughness: 0.9, metalness: 0 },
  alambrado: { color: "#5b6470", roughness: 0.5, metalness: 0.7 },

  default: { color: "#cfd3d7", roughness: 0.7, metalness: 0.1 },
};

export function getShedMaterial(name?: string | null): PBRMaterialDef {
  if (!name) return SHED_MATERIALS.default;
  if (SHED_MATERIALS[name]) return SHED_MATERIALS[name];
  const normalized = name.toLowerCase().replace(/[\s-]+/g, "_");
  if (SHED_MATERIALS[normalized]) return SHED_MATERIALS[normalized];
  const partial = Object.keys(SHED_MATERIALS).find(
    (k) => normalized.includes(k) || k.includes(normalized),
  );
  if (partial) return SHED_MATERIALS[partial];
  return SHED_MATERIALS.default;
}
