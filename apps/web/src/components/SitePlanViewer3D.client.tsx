"use client";

/**
 * SitePlanViewer3D — read-only Three.js viewer powered by the pure
 * `sitePlanTo3D` builder. The canvas is mounted once; on every `site`
 * change we dispose the previous root and swap in the new one,
 * preserving the camera (FR-G3).
 *
 * View modes (overlay buttons):
 *  - Câmera: "iso" (default), "top" (planta de cima), "front" (lateral)
 *  - "Raio-X": deixa paredes/teto translúcidos para revelar a estrutura
 *  - "Sem teto": esconde telhado + paredes para mostrar o interior
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { IndustrialShed } from "@/lib/shedSchema";
import type { SitePlan } from "@/lib/sitePlanSchema";
import { sitePlanTo3D, type Lod } from "@/lib/sitePlanTo3D";

type CameraMode = "iso" | "top" | "front";
type MapStyle = "off" | "satellite" | "relief" | "streets";

/** Camadas construtivas que o usuário pode isolar/ocultar/explodir. */
type LayerKey =
  | "foundation"
  | "structure"
  | "floor"
  | "services"
  | "cladding"
  | "roof";

const LAYER_PREFIXES: Record<LayerKey, readonly string[]> = {
  foundation: ["terrain:"],
  structure: ["column:", "truss:"],
  floor: ["floor:"],
  services: ["dock:", "opening:", "gate:", "perimeter:"],
  cladding: ["wall:", "zone:", "mezzanine:"],
  roof: ["roof:", "skylight:"],
};

const LAYER_META: Array<{
  key: LayerKey;
  idx: string;
  name: string;
  tag: string;
}> = [
  { key: "roof", idx: "L1", name: "Cobertura", tag: "Telhas + skylights" },
  { key: "cladding", idx: "L2", name: "Fechamentos", tag: "Paredes + zonas" },
  {
    key: "services",
    idx: "L3",
    name: "Instalações & docas",
    tag: "Docas, portões, perímetro",
  },
  { key: "floor", idx: "L4", name: "Piso", tag: "Contrapiso industrial" },
  {
    key: "structure",
    idx: "L5",
    name: "Estrutura SF",
    tag: "Pilares + tesouras",
  },
  { key: "foundation", idx: "L6", name: "Fundação", tag: "Terraplenagem" },
];

/** Offset relativo (multiplicado pelo span Y) ao explodir as camadas. */
const EXPLODE_OFFSETS: Record<LayerKey, number> = {
  roof: 1.6,
  cladding: 0.9,
  services: 0.4,
  floor: -0.1,
  structure: 0.55,
  foundation: -0.6,
};

/** Esri public REST endpoints — sem token, ok para uso interno. */
const MAP_STYLES: Record<
  Exclude<MapStyle, "off">,
  { label: string; service: string; title: string }
> = {
  satellite: {
    label: "Satélite",
    service: "World_Imagery",
    title: "Imagem de satélite (Esri World Imagery)",
  },
  relief: {
    label: "Relevo",
    service: "World_Shaded_Relief",
    title: "Relevo sombreado (Esri World Shaded Relief)",
  },
  streets: {
    label: "Ruas",
    service: "World_Street_Map",
    title: "Mapa de ruas (Esri World Street Map)",
  },
};

interface Props {
  site: SitePlan;
  shedsById?: Record<string, IndustrialShed>;
  lod?: Lod;
  /**
   * When true (default), buildings without a linked shed are rendered with
   * an in-memory shed derived from their footprint/use so walls, roof, docks,
   * skylights, office annex etc. show up.
   */
  synthesizeShed?: boolean;
  /**
   * Estilo do plano de fundo cartográfico. Quando definido, mostra o mapa
   * Esri correspondente abaixo do terreno; "off" desliga o mapa.
   * Default: "satellite".
   */
  mapStyle?: MapStyle;
  /** Backwards-compat: equivalente a `mapStyle="satellite"` quando true. */
  mapBackground?: boolean;
  /** When true, shows an "Expandir" button that toggles browser fullscreen. */
  allowFullscreen?: boolean;
  /**
   * Compact mode: hides the layer rail, env-control and bottom camera pill,
   * keeping only the HUD toolbar + stats. Use on small containers (e.g. the
   * read-only viewer inside the relatório card).
   */
  compact?: boolean;
}

/** Names emitted by `sitePlanTo3D` we want to toggle from the UI. */
const ROOF_PREFIXES = ["roof:", "skylight:"];
const WALL_PREFIXES = ["wall:"];
const XRAY_PREFIXES = ["wall:", "roof:", "zone:"];

function nameStartsWithAny(name: string, prefixes: readonly string[]) {
  for (const p of prefixes) if (name.startsWith(p)) return true;
  return false;
}

function disposeRoot(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if ((mesh as { isMesh?: boolean }).isMesh) {
      mesh.geometry?.dispose?.();
    }
  });
}

export default function SitePlanViewer3D({
  site,
  shedsById,
  lod = "architectural",
  synthesizeShed = true,
  mapStyle,
  mapBackground,
  allowFullscreen = false,
  compact = false,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const currentGroupRef = useRef<THREE.Group | null>(null);
  const mapPlaneRef = useRef<THREE.Mesh | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const rafRef = useRef<number | null>(null);
  /**
   * Bounding box "real" da cena (pós-build do site). Recalculada após cada
   * troca de geometria e usada pelos efeitos de câmera para garantir que o
   * frame inicial enquadre o galpão de verdade, não o lote inteiro.
   */
  const sceneBoxRef = useRef<THREE.Box3 | null>(null);

  const [cameraMode, setCameraMode] = useState<CameraMode>("iso");
  const [xRay, setXRay] = useState(false);
  /** Bumped after each geometry rebuild — used to re-run the camera framing
   *  effect once `sceneBoxRef` is populated. */
  const [sceneVersion, setSceneVersion] = useState(0);
  const [hideRoof, setHideRoof] = useState(false);
  // Default to satellite so the lote real é mostrado como contexto. Caller
  // pode forçar "off" via mapStyle ou usar mapBackground=false (legacy) para
  // manter o comportamento antigo.
  const initialMapStyle: MapStyle =
    mapStyle ?? (mapBackground === false ? "off" : "satellite");
  const [currentMapStyle, setCurrentMapStyle] =
    useState<MapStyle>(initialMapStyle);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  // Visibilidade independente por camada construtiva.
  const [layerVisible, setLayerVisible] = useState<Record<LayerKey, boolean>>({
    foundation: true,
    structure: true,
    floor: true,
    services: true,
    cladding: true,
    roof: true,
  });
  const [isolatedLayer, setIsolatedLayer] = useState<LayerKey | null>(null);
  const [explodeAmount, setExplodeAmount] = useState(0); // 0..1
  const [mapOpacity, setMapOpacity] = useState(0.65); // 0..1

  // Mount once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.setClearColor(0x0b1220, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    host.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    // Fog desabilitado por padrão — era a causa de o galpão sumir quando a
    // câmera estava distante do alvo. O efeito de mapa volta a manipular
    // `scene.fog` se necessário no futuro.
    scene.fog = null;
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      host.clientWidth / host.clientHeight,
      0.5,
      20000,
    );
    // Camera lives in the (-X, +Z) quadrant so the rendered scene matches the
    // 2D editor orientation: +X grows to the right of the screen and +Z grows
    // downward (south). Without this, +X ends up mirrored to the left.
    camera.position.set(-120, 90, 120);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.minPolarAngle = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    // Os limites de min/max distance são recalculados em runtime pelo efeito
    // de framing (depende do tamanho da cena). Valores iniciais conservadores.
    controls.minDistance = 2;
    controls.maxDistance = 5000;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // Iluminação melhorada: hemisférica suave + key light + fill light leve.
    const hemi = new THREE.HemisphereLight(0xfff3e0, 0x222b3a, 0.9);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(-120, 180, 90);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xb3d9ff, 0.35);
    fill.position.set(120, 60, -90);
    scene.add(fill);
    const grid = new THREE.GridHelper(800, 80, 0x1f2937, 0x111827);
    grid.position.y = -0.01;
    (grid.material as THREE.Material).opacity = 0.45;
    (grid.material as THREE.Material).transparent = true;
    scene.add(grid);
    gridRef.current = grid;

    const onResize = () => {
      if (!host || !rendererRef.current || !cameraRef.current) return;
      const w = host.clientWidth;
      const h = host.clientHeight;
      rendererRef.current.setSize(w, h);
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(host);

    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      if (currentGroupRef.current) {
        disposeRoot(currentGroupRef.current);
        scene.remove(currentGroupRef.current);
      }
    };
  }, []);

  // Swap geometry when `site` changes; preserve camera by NOT touching it.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (currentGroupRef.current) {
      disposeRoot(currentGroupRef.current);
      scene.remove(currentGroupRef.current);
      currentGroupRef.current = null;
    }
    const group = sitePlanTo3D(site, { shedsById, lod, synthesizeShed });
    currentGroupRef.current = group;
    scene.add(group);
    // Compute o bbox real da geometria renderizada (ignora mapa/grid). Esse
    // bbox é a fonte de verdade para a câmera — evita o bug de enquadrar o
    // lote inteiro quando os galpões ocupam só uma fração do terreno.
    group.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const tmp = new THREE.Box3();
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!(mesh as { isMesh?: boolean }).isMesh) return;
      if (!mesh.geometry) return;
      mesh.geometry.computeBoundingBox?.();
      const bb = mesh.geometry.boundingBox;
      if (!bb) return;
      tmp.copy(bb).applyMatrix4(mesh.matrixWorld);
      box.union(tmp);
    });
    if (!box.isEmpty()) {
      sceneBoxRef.current = box;
      const sizeVec = new THREE.Vector3();
      box.getSize(sizeVec);
      const span = Math.max(80, Math.max(sizeVec.x, sizeVec.z) * 1.6);
      const grid = gridRef.current;
      if (grid) {
        const center = new THREE.Vector3();
        box.getCenter(center);
        grid.position.set(center.x, -0.01, center.z);
        // Substitui a grid por uma do tamanho certo (cheap recreate).
        const newGrid = new THREE.GridHelper(
          span,
          Math.min(80, Math.max(20, Math.round(span / 10))),
          0x1f2937,
          0x111827,
        );
        newGrid.position.copy(grid.position);
        (newGrid.material as THREE.Material).opacity = 0.45;
        (newGrid.material as THREE.Material).transparent = true;
        scene.remove(grid);
        (grid.material as THREE.Material).dispose?.();
        grid.geometry?.dispose?.();
        scene.add(newGrid);
        gridRef.current = newGrid;
      }
    }
    // Notifica o efeito de framing que o bbox está disponível.
    setSceneVersion((v) => v + 1);
  }, [site, shedsById, lod, synthesizeShed]);

  // Apply X-ray / hide-roof toggles by traversing meshes and tweaking
  // their material/visibility. Cheap to redo on every toggle since
  // sitePlanTo3D names every layer.
  useEffect(() => {
    const root = currentGroupRef.current;
    if (!root) return;
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!(mesh as { isMesh?: boolean }).isMesh) return;
      const name = mesh.name || "";
      const isRoof = nameStartsWithAny(name, ROOF_PREFIXES);
      const isWall = nameStartsWithAny(name, WALL_PREFIXES);
      // Visibility: hide roof (and ceiling walls' upper sheet) when requested.
      if (hideRoof && isRoof) {
        mesh.visible = false;
      } else {
        mesh.visible = true;
      }
      // X-ray: make walls/roof/zones translucent.
      const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
      if (!mat || Array.isArray(mat)) return;
      const shouldXRay = xRay && nameStartsWithAny(name, XRAY_PREFIXES);
      if (shouldXRay) {
        if (mat.userData.__origOpacity === undefined) {
          mat.userData.__origOpacity = mat.opacity;
          mat.userData.__origTransparent = mat.transparent;
        }
        mat.transparent = true;
        mat.opacity = 0.25;
        mat.depthWrite = false;
        mat.needsUpdate = true;
      } else if (mat.userData.__origOpacity !== undefined) {
        mat.opacity = mat.userData.__origOpacity as number;
        mat.transparent = mat.userData.__origTransparent as boolean;
        mat.depthWrite = true;
        delete mat.userData.__origOpacity;
        delete mat.userData.__origTransparent;
        mat.needsUpdate = true;
      }
    });
  }, [xRay, hideRoof, site]);

  // Layer visibility + isolate + explode. Re-applied whenever any of
  // the inputs change. Original Y is cached on `mesh.userData.__y0` so
  // toggling explode back to 0 returns each mesh to its baseline.
  useEffect(() => {
    const root = currentGroupRef.current;
    if (!root) return;
    // Compute Y span once per pass — used to scale the explode offsets.
    let minY = Infinity;
    let maxY = -Infinity;
    root.traverse((obj) => {
      if (!(obj as { isMesh?: boolean }).isMesh) return;
      const m = obj as THREE.Mesh;
      const y = m.position.y;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
    const spanY = Math.max(6, isFinite(maxY - minY) ? maxY - minY : 6);
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!(mesh as { isMesh?: boolean }).isMesh) return;
      const name = mesh.name || "";
      let layer: LayerKey | null = null;
      for (const k of Object.keys(LAYER_PREFIXES) as LayerKey[]) {
        if (nameStartsWithAny(name, LAYER_PREFIXES[k])) {
          layer = k;
          break;
        }
      }
      if (mesh.userData.__y0 === undefined) {
        mesh.userData.__y0 = mesh.position.y;
      }
      const baseY = mesh.userData.__y0 as number;
      if (!layer) {
        mesh.position.y = baseY;
        return;
      }
      // Hide-roof tem precedência (já tratado no efeito acima); aqui só
      // aplicamos visibilidade da camada e isolamento.
      const layerOn = layerVisible[layer];
      const isolated = isolatedLayer == null || isolatedLayer === layer;
      const roofForcedHidden = hideRoof && layer === "roof";
      mesh.visible = !roofForcedHidden && layerOn && isolated;
      mesh.position.y = baseY + EXPLODE_OFFSETS[layer] * explodeAmount * spanY;
    });
  }, [layerVisible, isolatedLayer, explodeAmount, hideRoof, site]);

  // Map plane opacity slider — fades the basemap without disposing it.
  useEffect(() => {
    const plane = mapPlaneRef.current;
    if (!plane) return;
    const mat = plane.material as THREE.MeshBasicMaterial;
    mat.transparent = mapOpacity < 0.999;
    mat.opacity = mapOpacity;
    mat.needsUpdate = true;
  }, [mapOpacity, currentMapStyle, site]);

  // Move the camera when the user picks a preset view.
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    // Preferência: bbox real da cena renderizada (calculado após
    // sitePlanTo3D). Cai para footprint dos prédios e, por último, para o lote.
    const box = sceneBoxRef.current;
    let cx: number,
      cy: number,
      cz: number,
      width: number,
      depth: number,
      maxY: number;
    if (box && !box.isEmpty()) {
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      cx = center.x;
      cz = center.z;
      // O centro do enquadramento usa o pé-direito médio: assim a câmera olha
      // para o meio da edificação em vez de mirar no chão.
      cy = (box.min.y + box.max.y) / 2;
      width = Math.max(8, size.x);
      depth = Math.max(8, size.z);
      maxY = Math.max(4, size.y);
    } else {
      // Fallback: bbox dos polygons do lote.
      let minX = Infinity,
        maxX = -Infinity,
        minZ = Infinity,
        maxZ = -Infinity;
      for (const p of site.lotPolygonLocal) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
      }
      if (!isFinite(minX)) {
        minX = -20;
        maxX = 20;
        minZ = -20;
        maxZ = 20;
      }
      cx = (minX + maxX) / 2;
      cz = (minZ + maxZ) / 2;
      cy = 4;
      width = Math.max(8, maxX - minX);
      depth = Math.max(8, maxZ - minZ);
      maxY = 12;
    }

    const sceneSpan = Math.max(width, depth, maxY * 2);

    // Distance derivada do FOV + aspect ratio do viewport, com margem.
    const aspect = camera.aspect || 1;
    const halfH = sceneSpan / 2;
    const halfW = Math.max(width, depth) / 2;
    const vFov = (camera.fov * Math.PI) / 180;
    const distV = halfH / Math.tan(vFov / 2);
    const distH = halfW / Math.tan(vFov / 2) / Math.max(aspect, 0.5);
    // Margem maior no modo n\u00e3o-compacto porque os overlays laterais
    // (camadas, HUD, env) comem ~30% da \u00e1rea \u00fatil. No compact, margem padr\u00e3o.
    const margin = compact ? 1.25 : 1.45;
    const distance = Math.max(distV, distH) * margin;

    controls.target.set(cx, cy, cz);
    if (cameraMode === "top") {
      camera.up.set(0, 0, -1); // +Z appears as "down" on screen → matches 2D editor.
      camera.position.set(cx, cy + distance, cz + 0.01);
    } else if (cameraMode === "front") {
      camera.up.set(0, 1, 0);
      camera.position.set(cx, cy + distance * 0.35, cz + distance);
    } else {
      camera.up.set(0, 1, 0);
      // Isométrica SW: +X → direita da tela, +Z → baixo.
      const d = distance * 0.6;
      camera.position.set(cx - d, cy + distance * 0.55, cz + d);
    }
    // Limites de zoom proporcionais à cena.
    controls.minDistance = Math.max(2, sceneSpan * 0.06);
    controls.maxDistance = Math.max(distance * 5, sceneSpan * 12);
    // Far plane > maxDistance + extensão da cena para evitar clipping.
    camera.far = Math.max(2000, controls.maxDistance * 4);
    camera.near = Math.max(0.2, controls.minDistance * 0.05);
    camera.updateProjectionMatrix();
    controls.update();
  }, [cameraMode, site, shedsById, sceneVersion, compact]);

  // Satellite ground plane (Esri World Imagery) — opt-in.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    // Dispose existing plane.
    if (mapPlaneRef.current) {
      const m = mapPlaneRef.current.material as THREE.MeshBasicMaterial;
      m.map?.dispose?.();
      m.dispose();
      mapPlaneRef.current.geometry.dispose();
      scene.remove(mapPlaneRef.current);
      mapPlaneRef.current = null;
    }
    if (currentMapStyle === "off") {
      // Restore the dark fog for the abstract view.
      if (scene.fog) (scene.fog as THREE.Fog).near = 200;
      return;
    }
    // Push fog far away so the basemap stays visible from the planta camera.
    if (scene.fog) (scene.fog as THREE.Fog).near = 2000;
    // Local bbox (meters) → plane size; geo bbox → Esri export.
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const p of site.lotPolygonLocal) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    let minLng = Infinity,
      maxLng = -Infinity,
      minLat = Infinity,
      maxLat = -Infinity;
    for (const [lng, lat] of site.lotPolygon) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    if (!isFinite(minX) || !isFinite(minLng)) return;
    // Expand a bit so neighborhood context is visible.
    const padX = (maxX - minX) * 0.4;
    const padZ = (maxZ - minZ) * 0.4;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const width = maxX - minX + 2 * padX;
    const depth = maxZ - minZ + 2 * padZ;
    const padLng = (maxLng - minLng) * 0.4;
    const padLat = (maxLat - minLat) * 0.4;
    const bbox = [
      minLng - padLng,
      minLat - padLat,
      maxLng + padLng,
      maxLat + padLat,
    ].join(",");
    const tileSize = 1024;
    const styleCfg = MAP_STYLES[currentMapStyle];
    const url =
      `https://server.arcgisonline.com/arcgis/rest/services/${styleCfg.service}/MapServer/export` +
      `?bbox=${bbox}&bboxSR=4326&imageSR=3857&size=${tileSize},${tileSize}` +
      `&format=jpg&transparent=false&f=image`;

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      url,
      (texture) => {
        if (!sceneRef.current) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        const geom = new THREE.PlaneGeometry(width, depth);
        const mat = new THREE.MeshBasicMaterial({
          map: texture,
          depthWrite: false,
          // Render below everything else.
          transparent: false,
        });
        const plane = new THREE.Mesh(geom, mat);
        plane.rotation.x = -Math.PI / 2;
        // Flip so geographic north (top of Esri image) lies on the -Z side
        // (matches the SitePlan convention where +Z grows southward).
        plane.rotation.z = Math.PI;
        plane.position.set(cx, -0.05, cz);
        // Apply northAngleRad correction if the local frame is rotated.
        if (site.northAngleRad) plane.rotation.z += -site.northAngleRad;
        plane.renderOrder = -1;
        sceneRef.current.add(plane);
        mapPlaneRef.current = plane;
      },
      undefined,
      () => {
        // Silent failure: keep the grid visible.
      },
    );
  }, [site, currentMapStyle]);

  // Fullscreen toggle: prefer the native Fullscreen API; if it rejects (common
  // in embedded iframes like VS Code's Simple Browser), fall back to a
  // CSS-only "pseudo-fullscreen" so the button always does something useful.
  useEffect(() => {
    const onChange = () => {
      const native = document.fullscreenElement === hostRef.current;
      setIsFullscreen(native || pseudoFullscreen);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [pseudoFullscreen]);

  // Esc clears the layer isolation, mirroring the mockup's "Esc" hint.
  useEffect(() => {
    if (isolatedLayer == null && !pseudoFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isolatedLayer != null) setIsolatedLayer(null);
      if (pseudoFullscreen) setPseudoFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isolatedLayer, pseudoFullscreen]);

  const toggleFullscreen = () => {
    const host = hostRef.current;
    if (!host) return;
    if (document.fullscreenElement === host) {
      void document.exitFullscreen?.();
      return;
    }
    if (pseudoFullscreen) {
      setPseudoFullscreen(false);
      return;
    }
    const req = host.requestFullscreen?.();
    if (req && typeof req.then === "function") {
      req
        .then(() => setIsFullscreen(true))
        .catch(() => setPseudoFullscreen(true));
    } else {
      // No Fullscreen API at all → use pseudo mode.
      setPseudoFullscreen(true);
    }
  };

  // Estatísticas do projeto exibidas no HUD (peso, custo, área, vão).
  const stats = useMemo(() => {
    const polygonArea = (poly: { x: number; z: number }[]) => {
      let a = 0;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        a += p.x * q.z - q.x * p.z;
      }
      return Math.abs(a) / 2;
    };
    let totalArea = 0;
    let maxArea = 0;
    let largest = site.buildings[0];
    let docks = 0;
    for (const b of site.buildings) {
      const area = polygonArea(b.footprintPolygon);
      totalArea += area;
      if (area > maxArea) {
        maxArea = area;
        largest = b;
      }
      const shed = b.shed ?? shedsById?.[b.shedId ?? ""];
      docks += shed?.docks?.length ?? 0;
    }
    // Maior galpão: largura/profundidade do retângulo real (un-rotacionado).
    let dims = { w: 0, d: 0 };
    if (largest) {
      const rot = largest.rotationRad ?? 0;
      const cx =
        largest.footprintPolygon.reduce((a, p) => a + p.x, 0) /
        largest.footprintPolygon.length;
      const cz =
        largest.footprintPolygon.reduce((a, p) => a + p.z, 0) /
        largest.footprintPolygon.length;
      const cos = Math.cos(-rot);
      const sin = Math.sin(-rot);
      let mnx = Infinity,
        mxx = -Infinity,
        mnz = Infinity,
        mxz = -Infinity;
      for (const p of largest.footprintPolygon) {
        const dx = p.x - cx;
        const dz = p.z - cz;
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        if (lx < mnx) mnx = lx;
        if (lx > mxx) mxx = lx;
        if (lz < mnz) mnz = lz;
        if (lz > mxz) mxz = lz;
      }
      dims = { w: mxx - mnx, d: mxz - mnz };
    }
    const span = Math.min(dims.w, dims.d);
    // Estimativa simples de peso de aço: ~32 kg/m² de área coberta.
    const steelTon = (totalArea * 32) / 1000;
    // Custo aproximado por m² (R$): R$ 1.450 (SF galpão industrial padrão).
    const costBRL = totalArea * 1450;
    const eaveHeight = (() => {
      const shed = largest
        ? (largest.shed ?? shedsById?.[largest.shedId ?? ""])
        : undefined;
      return shed?.structure?.clearHeight ?? 8;
    })();
    return {
      steelTon,
      costBRL,
      totalArea,
      dims,
      span,
      eaveHeight,
      docks,
      buildings: site.buildings.length,
    };
  }, [site, shedsById]);

  const fmtNum = (n: number, d = 0) =>
    n.toLocaleString("pt-BR", {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  const fmtCurrency = (n: number) => {
    if (n >= 1_000_000)
      return `R$ ${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}M`;
    if (n >= 1_000)
      return `R$ ${(n / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}k`;
    return `R$ ${fmtNum(n)}`;
  };

  const focusedLayer =
    isolatedLayer != null
      ? LAYER_META.find((l) => l.key === isolatedLayer)
      : undefined;

  const rootClass = [
    "viewer-3d",
    compact ? "viewer-3d--compact" : null,
    pseudoFullscreen ? "viewer-3d--pseudo-full" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={hostRef} className={rootClass}>
      {/* ----- HUD (top-right): toolbar enxuto + cards de stats ---------- */}
      <div className="viewer-3d__hud" aria-label="Indicadores e visualização">
        <div
          className="viewer-3d__panel viewer-3d__hud-toolbar"
          role="toolbar"
          aria-label="Visualização"
        >
          <button
            type="button"
            onClick={() => setXRay((v) => !v)}
            className="viewer-3d__btn"
            aria-pressed={xRay}
            title="Raio-X: paredes/teto translúcidos para ver a estrutura"
          >
            Raio-X
          </button>
          <button
            type="button"
            onClick={() => setHideRoof((v) => !v)}
            className="viewer-3d__btn"
            aria-pressed={hideRoof}
            title="Esconde o telhado para mostrar o interior do galpão"
          >
            Sem teto
          </button>{" "}
          {compact &&
            (
              [
                { id: "iso", label: "Iso", title: "Câmera isométrica" },
                {
                  id: "top",
                  label: "Planta",
                  title: "Câmera de cima (planta)",
                },
                { id: "front", label: "Lateral", title: "Câmera lateral" },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setCameraMode(m.id)}
                className="viewer-3d__btn"
                aria-pressed={cameraMode === m.id}
                title={m.title}
              >
                {m.label}
              </button>
            ))}{" "}
          {allowFullscreen && (
            <button
              type="button"
              onClick={toggleFullscreen}
              className="viewer-3d__btn"
              aria-pressed={isFullscreen}
              title={
                isFullscreen
                  ? "Sair da tela cheia (Esc)"
                  : "Abrir visualizador em tela cheia"
              }
            >
              {isFullscreen ? "↙" : "⛶"}
            </button>
          )}
        </div>
        <div className="viewer-3d__panel viewer-3d__hud-card viewer-3d__hud-card--accent">
          <div className="label">Peso aço</div>
          <div className="value">{fmtNum(stats.steelTon, 1)} t</div>
        </div>
        <div className="viewer-3d__panel viewer-3d__hud-card viewer-3d__hud-card--accent">
          <div className="label">Custo estimado</div>
          <div className="value">{fmtCurrency(stats.costBRL)}</div>
        </div>
        <div className="viewer-3d__panel viewer-3d__hud-card">
          <div className="label">Área · pé-direito</div>
          <div className="value">
            {fmtNum(stats.totalArea)} m² · {fmtNum(stats.eaveHeight, 1)} m
          </div>
        </div>
        <div className="viewer-3d__panel viewer-3d__hud-card">
          <div className="label">Maior galpão (L × P)</div>
          <div className="value">
            {fmtNum(stats.dims.w, 1)} × {fmtNum(stats.dims.d, 1)} m
          </div>
        </div>
      </div>

      {/* ----- Layer rail (esquerda, centralizado verticalmente) ---------- */}
      {!compact && (
        <div
          className="viewer-3d__panel viewer-3d__layer-rail"
          aria-label="Camadas construtivas"
        >
          <div className="viewer-3d__panel-head">
            <span>Camadas</span>
            <strong>{LAYER_META.length}</strong>
          </div>
          {LAYER_META.map((l) => {
            const visible = layerVisible[l.key];
            const isActive = isolatedLayer === l.key;
            return (
              <button
                key={l.key}
                type="button"
                className={`viewer-3d__layer-chip lc-${l.key}`}
                aria-pressed={visible}
                data-active={isActive}
                onClick={() =>
                  setIsolatedLayer((cur) => (cur === l.key ? null : l.key))
                }
                title={`${l.name} — clique para isolar (Esc para voltar)`}
              >
                <span className="viewer-3d__lc-idx">{l.idx}</span>
                <span>
                  <div className="viewer-3d__lc-name">{l.name}</div>
                  <div className="viewer-3d__lc-meta">{l.tag}</div>
                </span>
                <span
                  className="viewer-3d__lc-toggle"
                  role="checkbox"
                  aria-checked={visible}
                  onClick={(e) => {
                    e.stopPropagation();
                    setLayerVisible((cur) => ({
                      ...cur,
                      [l.key]: !cur[l.key],
                    }));
                  }}
                  title={visible ? "Ocultar camada" : "Mostrar camada"}
                >
                  {visible ? "✓" : ""}
                </span>
              </button>
            );
          })}
          <div className="viewer-3d__layer-rail-foot">
            <label
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--color-text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Explodir
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(explodeAmount * 100)}
              onChange={(e) => setExplodeAmount(Number(e.target.value) / 100)}
              style={{ flex: 1, accentColor: "var(--color-primary-500)" }}
              aria-label="Explodir camadas"
            />
            <output
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--color-text-primary)",
                minWidth: 32,
                textAlign: "right",
              }}
            >
              {Math.round(explodeAmount * 100)}%
            </output>
          </div>
          <button
            type="button"
            className="viewer-3d__layer-reset"
            onClick={() => {
              setLayerVisible({
                foundation: true,
                structure: true,
                floor: true,
                services: true,
                cladding: true,
                roof: true,
              });
              setIsolatedLayer(null);
              setExplodeAmount(0);
            }}
          >
            Restaurar todas
          </button>
        </div>
      )}

      {/* ----- Env-control: basemap + opacidade (bottom-left) ------------- */}
      {!compact && (
        <div
          className="viewer-3d__panel viewer-3d__env"
          aria-label="Contexto cartográfico"
        >
          <div className="viewer-3d__panel-head">
            <span>Contexto</span>
            <strong>
              {currentMapStyle === "off"
                ? "Off"
                : MAP_STYLES[currentMapStyle].label}
            </strong>
          </div>
          <div className="viewer-3d__env-pills" role="tablist">
            <button
              type="button"
              className="viewer-3d__env-pill"
              aria-pressed={currentMapStyle === "off"}
              onClick={() => setCurrentMapStyle("off")}
              title="Sem mapa (grid abstrato)"
            >
              Off
            </button>
            {(Object.keys(MAP_STYLES) as Array<keyof typeof MAP_STYLES>).map(
              (key) => (
                <button
                  key={key}
                  type="button"
                  className="viewer-3d__env-pill"
                  aria-pressed={currentMapStyle === key}
                  onClick={() => setCurrentMapStyle(key)}
                  title={MAP_STYLES[key].title}
                >
                  {MAP_STYLES[key].label}
                </button>
              ),
            )}
          </div>
          <div className="viewer-3d__slider-row">
            <label htmlFor="viewer-3d-opacity">Opacidade</label>
            <input
              id="viewer-3d-opacity"
              type="range"
              min={0}
              max={100}
              value={Math.round(mapOpacity * 100)}
              onChange={(e) => setMapOpacity(Number(e.target.value) / 100)}
              disabled={currentMapStyle === "off"}
            />
            <output>{Math.round(mapOpacity * 100)}%</output>
          </div>
        </div>
      )}

      {/* ----- Layer focus callout (top-center quando isolado) ------------ */}
      {!compact && focusedLayer && (
        <div className="viewer-3d__panel viewer-3d__focus" role="status">
          <span className="viewer-3d__focus-tag">{focusedLayer.idx}</span>
          <div>
            <div className="viewer-3d__focus-name">{focusedLayer.name}</div>
            <div className="viewer-3d__focus-meta">{focusedLayer.tag}</div>
          </div>
          <button
            type="button"
            className="viewer-3d__focus-close"
            onClick={() => setIsolatedLayer(null)}
          >
            Ver tudo · Esc
          </button>
        </div>
      )}

      {/* ----- Bottom-center camera pill (Iso/Planta/Lateral) ------------- */}
      {!compact && (
        <div
          className="viewer-3d__camera-pill"
          role="toolbar"
          aria-label="Câmera"
        >
          {(
            [
              { id: "iso", label: "Iso", title: "Câmera isométrica" },
              { id: "top", label: "Planta", title: "Câmera de cima (planta)" },
              { id: "front", label: "Lateral", title: "Câmera lateral" },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setCameraMode(m.id)}
              className="viewer-3d__btn"
              aria-pressed={cameraMode === m.id}
              title={m.title}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
