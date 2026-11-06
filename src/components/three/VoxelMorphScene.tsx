import React, { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { useTheme } from "../theme-provider";
import { useThreeScene } from "./useThreeScene";
import {
  VOXEL_COLORS,
  createVoxelLayer,
  createVoxelSet,
  mortonSort,
  quintic,
  toSlots,
  voxelizeSurface,
  type VoxelCell,
  type VoxelSlots,
} from "./voxelKit";
import { isLand } from "./worldMap";

const U = 0.55; // 体素边长（世界单位）
const R = 17;   // 地球半径（体素）

export interface ModelInfo {
  id: string;
  name: string;
  shortName: string;
  sub: string;
  iconName: string;
}

export const VOXEL_MODELS: ModelInfo[] = [
  { id: "globe", name: "全球 Anycast 网关", shortName: "全球网关", sub: "全球边缘加速 · 跨洋低延时路由", iconName: "Globe" },
  { id: "mobius", name: "AI-Helper 无限环", shortName: "无限环", sub: "莫比乌斯流光 · 循环自省协同", iconName: "Infinity" },
  { id: "chipset", name: "神经算力芯片", shortName: "算力芯片", sub: "端侧沙盒加密 · HBM 3D 算力阵列", iconName: "Cpu" },
  { id: "cube", name: "超维张量矩阵", shortName: "张量矩阵", sub: "多维嵌入空间 · 量子晶格核心", iconName: "Box" },
];

const edgeNodes = [
  { id: "hkg", name: "中国香港", lat: 22.3, lon: 114.2 },
  { id: "tyo", name: "日本东京", lat: 35.7, lon: 139.7 },
  { id: "sin", name: "新加坡", lat: 1.35, lon: 103.8 },
  { id: "sjc", name: "硅谷", lat: 37.4, lon: -122.0 },
  { id: "fra", name: "法兰克福", lat: 50.1, lon: 8.7 },
  { id: "syd", name: "悉尼", lat: -33.9, lon: 151.2 },
];

function latLonToXYZ(lat: number, lon: number, r: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

// 1. 全球 Anycast 网关地球：真实陆地轮廓 + 浮凸一层体素 + 极地冰盖
function buildGlobe(threeLib: typeof THREE): VoxelCell[] {
  const ocean = new threeLib.Color(VOXEL_COLORS.glass);
  const land = new threeLib.Color("#3b82f6"); // 高纯度科技蓝
  const ice = new threeLib.Color(VOXEL_COLORS.glassLight);

  const landAt = (x: number, y: number, z: number, d: number) => {
    const lat = (Math.asin(y / d) * 180) / Math.PI;
    let lon = (Math.atan2(z, -x) * 180) / Math.PI - 180;
    if (lon < -180) lon += 360;
    return { hit: isLand(lon, lat), lat };
  };

  const inside = (x: number, y: number, z: number) => {
    const d = Math.hypot(x, y, z);
    if (d <= R) return true;
    if (d > R + 1.25) return false;
    return landAt(x, y, z, d).hit;
  };

  const B = R + 2;
  return voxelizeSurface([-B, -B, -B, B, B, B], inside, (x, y, z) => {
    const d = Math.hypot(x, y, z);
    if (d <= R) return { color: ocean };
    const { lat } = landAt(x, y, z, d);
    return { color: lat < -66 || lat > 74 ? ice : land };
  });
}

// 2. AI Helper 无限环：伯努利双纽线 + 180° 莫比乌斯空间扭转 + 流光参数
function buildMobius(threeLib: typeof THREE): VoxelCell[] {
  const set = createVoxelSet();
  const A = 25;
  const Bv = 14;
  const Cz = 7.4;
  const glass = new threeLib.Color(VOXEL_COLORS.glass);

  const curve = (t: number) => {
    const den = 1 + Math.sin(t) ** 2;
    return [(A * Math.cos(t)) / den, (Bv * Math.sin(t) * Math.cos(t)) / den, Cz * Math.sin(t)];
  };

  const STEPS = 1600;
  for (let s = 0; s < STEPS; s++) {
    const t = (s / STEPS) * Math.PI * 2;
    const p = curve(t);
    const q = curve(t + 0.001);
    let tx = q[0] - p[0];
    let ty = q[1] - p[1];
    let tz = q[2] - p[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;

    // 参考法线 N0 与副法线 B0 = T × N0
    let nx = -ty;
    let ny = tx;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    const bx = -tz * ny;
    const by = tz * nx;
    const bz = tx * ny - ty * nx;

    // 莫比乌斯半角扭转 180°
    const tw = t / 2;
    const rx = nx * Math.cos(tw) + bx * Math.sin(tw);
    const ry = ny * Math.cos(tw) + by * Math.sin(tw);
    const rz = bz * Math.sin(tw);

    // 厚度方向 O = T × Rv
    const ox = ty * rz - tz * ry;
    const oy = tz * rx - tx * rz;
    const oz = tx * ry - ty * rx;

    for (let w = -3.7; w <= 3.7; w += 0.5) {
      for (let h = -0.6; h <= 0.6; h += 0.6) {
        set.add(
          Math.round(p[0] + rx * w + ox * h),
          Math.round(p[1] + ry * w + oy * h),
          Math.round(p[2] + rz * w + oz * h),
          { color: glass, param: s / STEPS }
        );
      }
    }
  }
  return set.values();
}

// 3. 神经算力芯片：PCB 基板 + 封装基座 + 中央 Die + 4 组 HBM 堆叠 + 引脚金手指
function buildChip(threeLib: typeof THREE): VoxelCell[] {
  const set = createVoxelSet();
  const board = new threeLib.Color(VOXEL_COLORS.glassLight);
  const trace = new threeLib.Color(VOXEL_COLORS.periwinkle);
  const pkg = new threeLib.Color(VOXEL_COLORS.glassDeep);
  const die = new threeLib.Color(VOXEL_COLORS.accent);
  const hbm = new threeLib.Color("#60a5fa"); // 浅科技天蓝
  const pin = new threeLib.Color("#38bdf8"); // 青蓝引脚

  const S = 17;
  for (let x = -S; x <= S; x++) {
    for (let z = -S; z <= S; z++) {
      const isFinger = z === S && Math.abs(x) <= 12 && x % 2 === 0;
      const isTrace =
        (Math.abs(z) === 5 && Math.abs(x) > 10 && Math.abs(x) < 15) ||
        (Math.abs(x) === 5 && Math.abs(z) > 10 && Math.abs(z) < 15);
      set.add(x, 0, z, { color: isFinger ? trace : isTrace ? trace : board });
    }
  }

  for (let x = -9; x <= 9; x++) {
    for (let z = -9; z <= 9; z++) set.add(x, 1, z, { color: pkg });
  }

  // 封装四周引脚
  for (let k = -9; k <= 9; k += 2) {
    [[k, -10], [k, 10], [-10, k], [10, k]].forEach(([x, z]) => set.add(x, 1, z, { color: pin }));
  }

  // 中央 Die 核心
  for (let y = 2; y <= 3; y++) {
    for (let x = -4; x <= 4; x++) {
      for (let z = -4; z <= 4; z++) set.add(x, y, z, { color: die });
    }
  }

  // 4 组 HBM 高带宽显存堆叠
  [[6, 8], [-8, -6]].forEach(([xa, xb]) => {
    [[-4, -1], [1, 4]].forEach(([za, zb]) => {
      for (let y = 2; y <= 4; y++) {
        for (let x = xa; x <= xb; x++) {
          for (let z = za; z <= zb; z++) set.add(x, y, z, { color: hbm });
        }
      }
    });
  });

  // 板载表面贴装元器件
  [
    [12, 14, -14, -13],
    [-14, -12, 12, 13],
    [12, 13, 11, 14],
    [-14, -13, -14, -11],
    [12, 15, 0, 1],
    [-15, -12, -1, 0],
  ].forEach(([xa, xb, za, zb]) => {
    for (let x = xa; x <= xb; x++) {
      for (let z = za; z <= zb; z++) set.add(x, 1, z, { color: pkg });
    }
  });

  return set.values();
}

// 4. 超维张量矩阵：加粗立体棱框 + 表面稀疏晶格 + 中心高能张量核
function buildCube(threeLib: typeof THREE): VoxelCell[] {
  const edgeC = new threeLib.Color(VOXEL_COLORS.periwinkle);
  const lattice = new threeLib.Color(VOXEL_COLORS.glass);
  const core = new threeLib.Color(VOXEL_COLORS.accent);
  const H = 11;
  const cells: VoxelCell[] = [];

  for (let x = -H; x <= H; x++) {
    for (let y = -H; y <= H; y++) {
      for (let z = -H; z <= H; z++) {
        const ax = Math.abs(x);
        const ay = Math.abs(y);
        const az = Math.abs(z);
        const m = Math.max(ax, ay, az);
        const nearEdge = Number(ax >= H - 1) + Number(ay >= H - 1) + Number(az >= H - 1);
        if (m === H && nearEdge >= 2) {
          const corner = ax === H && ay === H && az === H;
          cells.push({ x, y, z, color: corner ? core : edgeC });
        } else if (m === H) {
          // 面晶格：每 3 格一条网格线
          const [u, v] = ax === H ? [y, z] : ay === H ? [x, z] : [x, y];
          if (u % 3 === 0 || v % 3 === 0) cells.push({ x, y, z, color: lattice });
        } else if (m === 4) {
          cells.push({ x, y, z, color: core });
        }
      }
    }
  }
  return cells;
}

interface ShapeConfig {
  name: string;
  cells: VoxelCell[];
  axis: [number, number, number];
  band: number;
  flow?: boolean;
}

interface Topology extends ShapeConfig, VoxelSlots {
  axisVec: THREE.Vector3;
  range: [number, number];
}

export interface VoxelMorphSceneProps {
  className?: string;
  onModelChange?: (index: number, model: ModelInfo) => void;
  onProgress?: (progress: number, isMorphing: boolean) => void;
  activeTargetIndex?: number;
}

export interface VoxelMorphSceneHandle {
  switchTo: (index: number) => void;
}

export const VoxelMorphScene = React.forwardRef<VoxelMorphSceneHandle, VoxelMorphSceneProps>(
  ({ className = "", onModelChange, onProgress, activeTargetIndex }, forwardedRef) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const { theme } = useTheme();
    const isDark =
      theme === "dark" ||
      (theme === "system" &&
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);

    const isDarkRef = useRef(isDark);
    useEffect(() => {
      isDarkRef.current = isDark;
    }, [isDark]);

    const explodeRef = useRef(0);
    const rippleRef = useRef<{ active: boolean; time: number; origin: { x: number; y: number; z: number } | null }>({
      active: false,
      time: 0,
      origin: null,
    });

    // 鼠标点击/拖拽防抖过滤：仅在按下与抬起位移极小时判定为点击激发冲击波
    const pointerDownPos = useRef<{ x: number; y: number } | null>(null);

    // 外部主动切换控制指针
    const manualTargetRef = useRef<number | null>(null);
    const currentModelIdxRef = useRef(0);

    const handlePointerDown = (e: React.MouseEvent<HTMLDivElement>) => {
      pointerDownPos.current = { x: e.clientX, y: e.clientY };
    };

    const handlePointerUp = (e: React.MouseEvent<HTMLDivElement>) => {
      if (!pointerDownPos.current) return;
      const dx = Math.abs(e.clientX - pointerDownPos.current.x);
      const dy = Math.abs(e.clientY - pointerDownPos.current.y);
      pointerDownPos.current = null;

      // 仅在微小位移内判定为单击（避免长距离拖拽旋转时误触发爆炸）
      if (dx < 6 && dy < 6) {
        const rect = e.currentTarget.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 16;
        const ny = -((e.clientY - rect.top) / rect.height - 0.5) * 16;
        rippleRef.current = { active: true, time: 0, origin: { x: nx, y: ny, z: 8 } };
        explodeRef.current = Math.min(1.1, explodeRef.current + 0.52);
      }
    };

    // 暴露 switchTo 给外部
    React.useImperativeHandle(forwardedRef, () => ({
      switchTo: (index: number) => {
        if (index >= 0 && index < VOXEL_MODELS.length) {
          manualTargetRef.current = index;
        }
      },
    }));

    // 响应外部 activeTargetIndex
    useEffect(() => {
      if (typeof activeTargetIndex === "number" && activeTargetIndex !== currentModelIdxRef.current) {
        manualTargetRef.current = activeTargetIndex;
      }
    }, [activeTargetIndex]);

    const build = useCallback(
      (scene: THREE.Scene, camera: THREE.PerspectiveCamera, threeLib: typeof THREE) => {
        const shapes: ShapeConfig[] = [
          { name: "globe", cells: buildGlobe(threeLib), axis: [0, 1, 0], band: 0 },
          { name: "mobius", cells: buildMobius(threeLib), axis: [1, 0, 0], band: 0, flow: true },
          { name: "chipset", cells: buildChip(threeLib), axis: [0, 0, 1], band: 1 },
          { name: "cube", cells: buildCube(threeLib), axis: [0, 1, 0], band: 1 },
        ];

        const N = Math.max(...shapes.map((s) => s.cells.length));
        const topologies: Topology[] = shapes.map((s) => {
          const slots = toSlots(mortonSort(s.cells), N, U);
          const axisVec = new threeLib.Vector3(...s.axis);
          let lo = Infinity;
          let hi = -Infinity;
          for (let i = 0; i < N; i++) {
            const v = slots.pos[i * 3] * axisVec.x + slots.pos[i * 3 + 1] * axisVec.y + slots.pos[i * 3 + 2] * axisVec.z;
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
          }
          return { ...s, ...slots, axisVec, range: [lo, hi] };
        });

        // 莫比乌斯环流光色带（极光渐变：紫 → 品牌经典蓝 → 青 → 霓虹粉 → 紫）
        const flowStops = [
          VOXEL_COLORS.violet,
          VOXEL_COLORS.accent,
          VOXEL_COLORS.cyan,
          VOXEL_COLORS.neonPink,
          VOXEL_COLORS.violet,
        ].map((h) => new threeLib.Color(h));

        const flowLUT = new Float32Array(256 * 3);
        const tmp = new threeLib.Color();
        for (let k = 0; k < 256; k++) {
          const f = (k / 256) * (flowStops.length - 1);
          const a = Math.floor(f);
          tmp.copy(flowStops[a]).lerp(flowStops[Math.min(a + 1, flowStops.length - 1)], f - a);
          flowLUT[k * 3] = tmp.r;
          flowLUT[k * 3 + 1] = tmp.g;
          flowLUT[k * 3 + 2] = tmp.b;
        }

        const layer = createVoxelLayer(threeLib, N, {
          opacity: isDarkRef.current ? 0.44 : 0.36,
          isDark: isDarkRef.current,
        });
        layer.mesh.renderOrder = 1;
        const mat = layer.material;

        // 动态临时起始位置与缩放（用于支持相变中途点击切换时 100% 平滑过渡无跳动）
        const tempStartPos = new Float32Array(N * 3);
        const tempStartScale = new Float32Array(N);
        const tempStartCol = new Float32Array(N * 3);
        let hasTempStart = false;

        // 每个槽位固定随机扰动（用于点击炸开方向）
        const jitter = new Float32Array(N * 3);
        for (let i = 0; i < N * 3; i++) jitter[i] = (Math.random() - 0.5) * 0.6;

        const group = new threeLib.Group();
        group.add(layer.mesh);
        group.rotation.set(0.35, -0.4, 0.12);

        // Anycast 边缘节点：墨色/高亮体素标记 + 科技脉冲环 + 飞线与数据包
        const anycastGroup = new threeLib.Group();
        const nodeCoords: Record<string, THREE.Vector3> = {};
        const nodeMeshes: { id: string; marker: THREE.Mesh; ring: THREE.Mesh; lat: number; lon: number }[] = [];
        const markerGeo = new threeLib.BoxGeometry(0.62, 0.62, 0.62);
        const ringGeo = new threeLib.RingGeometry(0.55, 0.72, 4, 1);
        const packetGeo = new threeLib.BoxGeometry(0.36, 0.36, 0.36);
        const fadeMaterials: { m: THREE.Material; base: number }[] = [];

        const fadeMat = <T extends THREE.Material>(m: T, base: number): T => {
          fadeMaterials.push({ m, base });
          return m;
        };

        const markerMat = fadeMat(
          new threeLib.MeshBasicMaterial({ color: VOXEL_COLORS.ink, transparent: true, opacity: 1 }),
          1
        );
        const ringMat = fadeMat(
          new threeLib.MeshBasicMaterial({
            color: VOXEL_COLORS.accent,
            transparent: true,
            opacity: 0.85,
            side: threeLib.DoubleSide,
          }),
          0.85
        );
        const packetMat = fadeMat(
          new threeLib.MeshBasicMaterial({ color: VOXEL_COLORS.accent, transparent: true, opacity: 1 }),
          1
        );
        const surfaceR = (R + 1.6) * U;

        edgeNodes.forEach((node) => {
          const pos = latLonToXYZ(node.lat, node.lon, surfaceR);
          nodeCoords[node.id] = pos;

          const marker = new threeLib.Mesh(markerGeo, markerMat);
          marker.position.copy(pos);
          marker.lookAt(0, 0, 0);
          anycastGroup.add(marker);

          const ring = new threeLib.Mesh(ringGeo, ringMat);
          ring.position.copy(pos);
          ring.lookAt(0, 0, 0);
          ring.rotateZ(Math.PI / 4);
          anycastGroup.add(ring);

          nodeMeshes.push({ id: node.id, marker, ring, lat: node.lat, lon: node.lon });
        });

        const arcPairs = [
          ["hkg", "tyo"],
          ["tyo", "sjc"],
          ["sjc", "fra"],
          ["fra", "hkg"],
          ["hkg", "sin"],
          ["sin", "syd"],
        ];
        const arcs: { curve: THREE.QuadraticBezierCurve3; packet: THREE.Mesh; offset: number; geo: THREE.BufferGeometry }[] = [];
        const arcMat = fadeMat(
          new threeLib.LineBasicMaterial({ color: VOXEL_COLORS.accent, transparent: true, opacity: 0.55 }),
          0.55
        );

        arcPairs.forEach(([fromId, toId], idx) => {
          const p1 = nodeCoords[fromId];
          const p2 = nodeCoords[toId];
          if (!p1 || !p2) return;
          const mid = p1.clone().add(p2).multiplyScalar(0.5);
          mid.normalize().multiplyScalar(surfaceR + Math.max(1.2, p1.distanceTo(p2) * 0.22));
          const curve = new threeLib.QuadraticBezierCurve3(p1, mid, p2);
          const geo = new threeLib.BufferGeometry().setFromPoints(curve.getPoints(32));
          anycastGroup.add(new threeLib.Line(geo, arcMat));

          const packet = new threeLib.Mesh(packetGeo, packetMat);
          anycastGroup.add(packet);
          arcs.push({ curve, packet, offset: idx * 0.16, geo });
        });

        group.add(anycastGroup);
        scene.add(group);
        camera.position.z = 45;

        // 相变状态机：平滑自适应时间（稳态停留 5.2 秒，丝滑相变 2.8 秒）
        const TRANSITION = 2.8;
        const HOLD = 5.2;
        let phaseTime = TRANSITION; // 首屏先完整展示地球稳态
        let fromIdx = 3;
        let toIdx = 0;
        let lastClock: number | null = null;
        let reportedIdx = -1;

        function orientation(idx: number, t: number) {
          if (idx === 0) return { x: 0.35, y: -0.4 + t * 0.16 };
          if (idx === 1) return { x: 0.12 + Math.cos(t * 0.25) * 0.08, y: Math.sin(t * 0.3) * 0.28 };
          if (idx === 2) return { x: 0.72, y: -0.35 + t * 0.12 };
          return { x: 0.48, y: t * 0.16 };
        }

        const colorOf = (topo: Topology, i: number, time: number, out: number[]) => {
          const o = i * 3;
          out[0] = topo.col[o];
          out[1] = topo.col[o + 1];
          out[2] = topo.col[o + 2];
          if (topo.flow) {
            const p = topo.param[i];
            const d = (((p - time * 0.11) % 1) + 1) % 1;
            const pulse = Math.max(Math.exp(-((d - 0.5) ** 2) / 0.006), 0.18);
            const k = Math.floor(p * 255) * 3;
            out[0] += (flowLUT[k] - out[0]) * pulse;
            out[1] += (flowLUT[k + 1] - out[1]) * pulse;
            out[2] += (flowLUT[k + 2] - out[2]) * pulse;
          }
        };
        const cA = [0, 0, 0];
        const cB = [0, 0, 0];

        return {
          update(time: number, pointer: { x: number; y: number }) {
            const dark = isDarkRef.current;

            // 暗黑模式与亮色模式动态自适应
            if (mat.uniforms.uIsDark) {
              mat.uniforms.uIsDark.value = dark ? 1.0 : 0.0;
            }
            if (mat.uniforms.uAccent) {
              mat.uniforms.uAccent.value.set(dark ? VOXEL_COLORS.accentDark : VOXEL_COLORS.accent);
            }

            // 同步 Anycast 节点颜色（深色模式用明亮银白与天蓝光环，浅色模式用深墨色）
            (markerMat as THREE.MeshBasicMaterial).color.set(dark ? "#f8fafc" : VOXEL_COLORS.ink);
            (ringMat as THREE.MeshBasicMaterial).color.set(dark ? VOXEL_COLORS.accentDark : VOXEL_COLORS.accent);
            (packetMat as THREE.MeshBasicMaterial).color.set(dark ? VOXEL_COLORS.accentDark : VOXEL_COLORS.accent);
            (arcMat as THREE.LineBasicMaterial).color.set(dark ? VOXEL_COLORS.accentDark : VOXEL_COLORS.accent);

            if (lastClock === null) lastClock = time;
            const dt = Math.min(0.05, Math.max(0.001, time - lastClock));
            lastClock = time;

            // 检查外部手动指定切换
            if (manualTargetRef.current !== null) {
              const target = manualTargetRef.current;
              manualTargetRef.current = null;
              if (target !== toIdx) {
                // 如果当前正处于变形中途，把当前插值位置捕获为无缝起始态，避免画面闪跳
                if (phaseTime < TRANSITION) {
                  for (let i = 0; i < N * 3; i++) {
                    tempStartPos[i] = layer.px[Math.floor(i / 3) * 3 + (i % 3)];
                    tempStartCol[i] = layer.col[i];
                  }
                  for (let i = 0; i < N; i++) {
                    tempStartScale[i] = layer.ps[i];
                  }
                  hasTempStart = true;
                } else {
                  hasTempStart = false;
                }
                fromIdx = toIdx;
                toIdx = target;
                phaseTime = 0;
              }
            }

            phaseTime += dt;
            if (phaseTime >= TRANSITION + HOLD) {
              phaseTime = 0;
              fromIdx = toIdx;
              toIdx = (toIdx + 1) % topologies.length;
              hasTempStart = false;
            }

            const morphing = phaseTime < TRANSITION;
            const g = morphing ? phaseTime / TRANSITION : 1;
            const eg = quintic(g);
            const A = topologies[fromIdx];
            const B = topologies[toIdx];

            // 阶段进度通知给外层 UI
            onProgress?.(g, morphing);

            // 当进入稳态或相变过半时同步通知当前主模型
            const currentEffectiveIdx = g >= 0.5 ? toIdx : fromIdx;
            if (reportedIdx !== currentEffectiveIdx) {
              reportedIdx = currentEffectiveIdx;
              currentModelIdxRef.current = currentEffectiveIdx;
              onModelChange?.(currentEffectiveIdx, VOXEL_MODELS[currentEffectiveIdx]);
            }

            // 扫描带：相变中点淡出并切换轴向
            const active = eg < 0.5 ? A : B;
            const fade = morphing ? Math.abs(1 - 2 * eg) ** 2 : 1;
            const sweep = (time * 0.16) % 1;
            mat.uniforms.uBandAxis.value.copy(active.axisVec);
            mat.uniforms.uBand.value = active.range[0] - 2 + (active.range[1] - active.range[0] + 4) * sweep;
            mat.uniforms.uBandStrength.value = active.band * fade;

            // Anycast 图层只在地球形态平滑淡入淡出
            let anyOpacity = 0;
            if (toIdx === 0) anyOpacity = morphing ? Math.min(1, Math.max(0, (g - 0.55) * 2.2)) : 1;
            else if (fromIdx === 0) anyOpacity = Math.max(0, 1 - g * 1.6);
            anycastGroup.visible = anyOpacity > 0.01;
            fadeMaterials.forEach(({ m, base }) => {
              (m as THREE.MeshBasicMaterial).opacity = base * anyOpacity;
            });

            // 姿态：在两个形态的理想朝向之间平滑插值
            const ra = orientation(fromIdx, time);
            const rb = orientation(toIdx, time);
            const trX = ra.x + (rb.x - ra.x) * eg;
            const trY = ra.y + (rb.y - ra.y) * eg;

            group.rotation.x += (trX + pointer.y * 0.15 - group.rotation.x) * 0.05;
            group.rotation.y += (trY + pointer.x * 0.25 - group.rotation.y) * 0.05;
            group.position.y = Math.sin(time * 0.8) * 0.4;

            const explode = explodeRef.current;
            explodeRef.current = explode > 0.001 ? explode * 0.92 : 0;

            const ripple = rippleRef.current;
            let rippleDist = 0;
            if (ripple.active) {
              ripple.time += 0.045;
              rippleDist = ripple.time * 8.5;
              if (ripple.time > 2.6) ripple.active = false;
            }

            const { px, py, pz, ps, col } = layer;
            for (let i = 0; i < N; i++) {
              const o = i * 3;
              const fx = hasTempStart ? tempStartPos[o] : A.pos[o];
              const fy = hasTempStart ? tempStartPos[o + 1] : A.pos[o + 1];
              const fz = hasTempStart ? tempStartPos[o + 2] : A.pos[o + 2];
              const fScale = hasTempStart ? tempStartScale[i] : A.scale[i];

              const tx = B.pos[o];
              const ty = B.pos[o + 1];
              const tz = B.pos[o + 2];

              // 自下而上的级联延迟 + 五次平滑
              const delay = Math.min(1, Math.max(0, (fy + 12) / 24)) * 0.3;
              const local = Math.max(0, Math.min(1, (g - delay) / 0.7));
              const e = quintic(local);

              // 弧线外展，避免直线对穿碰撞
              const arc = Math.sin(e * Math.PI) * 1.6;
              const mx = (fx + tx) * 0.5;
              const my = (fy + ty) * 0.5 + 0.6;
              const mz = (fz + tz) * 0.5;
              const ml = Math.hypot(mx, my, mz) || 1;

              let x = fx + (tx - fx) * e + (mx / ml) * arc;
              let y = fy + (ty - fy) * e + (my / ml) * arc;
              let z = fz + (tz - fz) * e + (mz / ml) * arc;
              if (!morphing) y += Math.sin(time * 1.6 + i * 0.05) * 0.04;

              if (explode > 0.001) {
                const l = Math.hypot(x, y, z) || 1;
                x += (x / l + jitter[o]) * explode * 18;
                y += (y / l + jitter[o + 1]) * explode * 18;
                z += (z / l + jitter[o + 2]) * explode * 18;
              }

              if (ripple.active && ripple.origin) {
                const dist = Math.hypot(x - ripple.origin.x, y - ripple.origin.y, z - ripple.origin.z);
                const delta = dist - rippleDist;
                if (Math.abs(delta) < 4.2) {
                  const wave =
                    Math.sin(delta * 1.4) * Math.exp(-(delta ** 2) / 4.5) * Math.max(0, 1 - ripple.time / 2.6) * 2.4;
                  const l = Math.hypot(x, y, z) || 1;
                  x += (x / l) * wave;
                  y += (y / l) * wave;
                  z += (z / l) * wave;
                }
              }

              px[i] = x;
              py[i] = y;
              pz[i] = z;
              ps[i] = fScale + (B.scale[i] - fScale) * e;

              if (hasTempStart) {
                cA[0] = tempStartCol[o];
                cA[1] = tempStartCol[o + 1];
                cA[2] = tempStartCol[o + 2];
              } else {
                colorOf(A, i, time, cA);
              }
              colorOf(B, i, time, cB);
              col[o] = cA[0] + (cB[0] - cA[0]) * e;
              col[o + 1] = cA[1] + (cB[1] - cA[1]) * e;
              col[o + 2] = cA[2] + (cB[2] - cA[2]) * e;
            }
            layer.commit(camera);

            if (anycastGroup.visible) {
              nodeMeshes.forEach((n, i) => {
                const pulse = (Math.sin(time * 3 + i) + 1) * 0.5;
                n.ring.scale.setScalar(1 + pulse * 0.7);
              });
              arcs.forEach((a) => {
                a.packet.position.copy(a.curve.getPointAt((time * 0.45 + a.offset) % 1));
              });
            }
          },
          dispose() {
            layer.dispose();
            markerGeo.dispose();
            ringGeo.dispose();
            packetGeo.dispose();
            fadeMaterials.forEach(({ m }) => m.dispose());
            arcs.forEach((a) => a.geo.dispose());
          },
        };
      },
      [onModelChange, onProgress]
    );

    useThreeScene(containerRef, build, { fov: 35, z: 45 });

    return (
      <div
        className={`relative w-full h-full cursor-grab active:cursor-grabbing select-none ${className}`}
        onMouseDown={handlePointerDown}
        onMouseUp={handlePointerUp}
        title="拖拽可 3D 旋转视角 · 点击激发全息量子冲击波"
      >
        <div ref={containerRef} className="w-full h-full" aria-hidden="true" />
      </div>
    );
  }
);

VoxelMorphScene.displayName = "VoxelMorphScene";
