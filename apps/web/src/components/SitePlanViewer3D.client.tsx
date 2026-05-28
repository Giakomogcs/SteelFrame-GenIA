"use client";

/**
 * SitePlanViewer3D — read-only Three.js viewer powered by the pure
 * `sitePlanTo3D` builder. The canvas is mounted once; on every `site`
 * change we dispose the previous root and swap in the new one,
 * preserving the camera (FR-G3).
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { IndustrialShed } from "@/lib/shedSchema";
import type { SitePlan } from "@/lib/sitePlanSchema";
import { sitePlanTo3D, type Lod } from "@/lib/sitePlanTo3D";

interface Props {
  site: SitePlan;
  shedsById?: Record<string, IndustrialShed>;
  lod?: Lod;
}

function disposeRoot(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if ((mesh as { isMesh?: boolean }).isMesh) {
      mesh.geometry?.dispose?.();
    }
  });
}

export default function SitePlanViewer3D({ site, shedsById, lod = "structural" }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const currentGroupRef = useRef<THREE.Group | null>(null);
  const rafRef = useRef<number | null>(null);

  // Mount once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.setClearColor(0x0b1220, 1);
    host.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b1220, 200, 800);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      host.clientWidth / host.clientHeight,
      0.5,
      4000,
    );
    camera.position.set(120, 90, 120);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    const hemi = new THREE.HemisphereLight(0xfff3e0, 0x202833, 0.7);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(80, 120, 60);
    scene.add(dir);
    const grid = new THREE.GridHelper(400, 40, 0x1f2937, 0x111827);
    grid.position.y = -0.01;
    scene.add(grid);

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
    const group = sitePlanTo3D(site, { shedsById, lod });
    currentGroupRef.current = group;
    scene.add(group);
  }, [site, shedsById, lod]);

  return (
    <div
      ref={hostRef}
      style={{ width: "100%", height: "100%", minHeight: 400, position: "relative" }}
    />
  );
}
