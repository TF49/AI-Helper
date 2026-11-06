import { useEffect, type RefObject } from "react";
import * as THREE from "three";

export interface ThreeSceneHandle {
  update: (time: number, pointer: { x: number; y: number }) => void;
  dispose?: () => void;
  setTargetShape?: (index: number) => void;
}

export interface UseThreeSceneOptions {
  fov?: number;
  z?: number;
  isDark?: boolean;
}

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * 通用 Three.js 场景挂载 hook：
 * 负责 WebGL 渲染器初始化、设备像素比自适应、离屏可见性感知、指针视差与内存清理。
 */
export function useThreeScene(
  ref: RefObject<HTMLDivElement | null>,
  build: (
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    threeLib: typeof THREE
  ) => ThreeSceneHandle,
  { fov = 35, z = 40 }: UseThreeSceneOptions = {}
) {
  useEffect(() => {
    const host = ref.current;
    if (!host) return undefined;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
    } catch {
      return undefined;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 500);
    camera.position.set(0, 0, z);

    const handle = build(scene, camera, THREE);

    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const onPointer = (e: MouseEvent) => {
      const r = host.getBoundingClientRect();
      pointer.tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
      pointer.ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    const still = prefersReducedMotion();
    let visible = true;
    let raf = 0;
    const t0 = performance.now();

    const frame = () => {
      raf = 0;
      pointer.x += (pointer.tx - pointer.x) * 0.05;
      pointer.y += (pointer.ty - pointer.y) * 0.05;
      handle.update(still ? 0 : (performance.now() - t0) / 1000, pointer);
      renderer.render(scene, camera);
      if (visible && !still) raf = requestAnimationFrame(frame);
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !raf) raf = requestAnimationFrame(frame);
    });
    io.observe(host);
    frame();

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onPointer);
      handle.dispose?.();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [ref, build, fov, z]);
}
