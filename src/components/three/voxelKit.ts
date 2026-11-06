import * as THREE from "three";

/**
 * AI-Helper 高性能 3D 体素渲染工具集
 * - 磨砂半透明全息玻璃方块材质：浅色面 + 亮边高光 + 激光扫描带 + 暗黑模式光子映射
 * - 整数网格体素化 + 表面提取：杜绝方块重叠与内部不可见几何体开销
 * - Morton 空间空间填充曲线排序：相变时相邻体素平滑映射
 * - 每帧按视距由远及近写入 InstancedMesh，确保半透明混合排序正确
 */

export const VOXEL_COLORS = {
  accent: "#2548f6",       // 经典品牌蓝
  accentDark: "#38bdf8",   // 暗黑模式科技天蓝
  glass: "#c9cef6",        // 磨砂浅蓝玻璃
  glassLight: "#dde0fa",   // 浅色反光玻璃
  glassDeep: "#b3baee",    // 深质感玻璃
  periwinkle: "#8d9af4",   // 长春花蓝
  violet: "#7b6cf0",       // 算力紫
  cyan: "#4cc3f0",         // 青色流光
  ink: "#21222c",          // 墨色深灰
  neonPink: "#ec4899",     // 霓虹粉
  gold: "#f59e0b",         // 算力金手指
};

const VERT = /* glsl */ `
uniform float uBand;
uniform float uBandWidth;
uniform vec3 uBandAxis;
varying vec3 vLocal;
varying vec3 vNormalW;
varying vec3 vViewDir;
varying vec3 vColor;
varying float vBand;

void main() {
  vLocal = position;
  vec3 center = instanceMatrix[3].xyz;
  vBand = 1.0 - smoothstep(0.0, uBandWidth, abs(dot(center, uBandAxis) - uBand));
  #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
  #else
    vColor = vec3(1.0);
  #endif
  vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uAccent;
uniform vec3 uLightDir;
uniform float uOpacity;
uniform float uBandStrength;
uniform float uIsDark;
varying vec3 vLocal;
varying vec3 vNormalW;
varying vec3 vViewDir;
varying vec3 vColor;
varying float vBand;

void main() {
  // 方块棱边：第二大的轴向坐标接近边界即为棱
  vec3 a = abs(vLocal) * 2.0;
  float mx = max(a.x, max(a.y, a.z));
  float mn = min(a.x, min(a.y, a.z));
  float mid = a.x + a.y + a.z - mx - mn;
  float edge = smoothstep(0.8, 0.95, mid);

  vec3 n = normalize(vNormalW);
  float diff = clamp(dot(n, uLightDir), 0.0, 1.0);
  float sky = n.y * 0.5 + 0.5;
  float fres = pow(1.0 - clamp(dot(n, normalize(vViewDir)), 0.0, 1.0), 2.2);

  float band = vBand * uBandStrength;
  vec3 base = mix(vColor, uAccent, band);

  // 饱和色（强调色）更实，浅色玻璃更透
  float sat = max(base.r, max(base.g, base.b)) - min(base.r, min(base.g, base.b));
  float solid = smoothstep(0.28, 0.72, sat);

  vec3 col;
  float alpha;
  if (uIsDark > 0.5) {
    // 暗黑模式下：色彩更具霓虹荧光自发光质感
    col = base * (0.85 + 0.35 * diff + 0.25 * sky);
    col = mix(col, vec3(1.0), edge * 0.55 + fres * 0.25);
    alpha = mix(uOpacity * 1.25, 0.96, solid) + edge * 0.25 + fres * 0.15;
  } else {
    // 明亮模式下：干净晶莹的冷磨砂玻璃质感
    col = base * (0.66 + 0.24 * diff + 0.16 * sky);
    col = mix(col, vec3(1.0), edge * mix(0.6, 0.3, solid) + fres * 0.1);
    alpha = mix(uOpacity, 0.92, solid) + edge * 0.18 + fres * 0.08;
  }

  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

export interface VoxelMaterialOptions {
  accent?: string;
  opacity?: number;
  isDark?: boolean;
}

export function createVoxelMaterial(
  THREE_LIB: typeof THREE,
  { accent = VOXEL_COLORS.accent, opacity = 0.4, isDark = false }: VoxelMaterialOptions = {}
) {
  return new THREE_LIB.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uAccent: { value: new THREE_LIB.Color(accent) },
      uLightDir: { value: new THREE_LIB.Vector3(-0.45, 0.85, 0.5).normalize() },
      uOpacity: { value: opacity },
      uBand: { value: -999 },
      uBandWidth: { value: 0.8 },
      uBandAxis: { value: new THREE_LIB.Vector3(0, 1, 0) },
      uBandStrength: { value: 0 },
      uIsDark: { value: isDark ? 1.0 : 0.0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}

export interface VoxelLayer {
  mesh: THREE.InstancedMesh;
  material: THREE.ShaderMaterial;
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  ps: Float32Array;
  col: Float32Array;
  commit: (camera: THREE.Camera) => void;
  dispose: () => void;
}

/**
 * 体素图层：持有 SoA 数据（位置 / 缩放 / 颜色），commit 时按视距排序写入 InstancedMesh。
 */
export function createVoxelLayer(
  THREE_LIB: typeof THREE,
  count: number,
  materialOptions?: VoxelMaterialOptions
): VoxelLayer {
  const geo = new THREE_LIB.BoxGeometry(1, 1, 1);
  const mat = createVoxelMaterial(THREE_LIB, materialOptions);
  const mesh = new THREE_LIB.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE_LIB.DynamicDrawUsage);
  mesh.instanceColor = new THREE_LIB.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  mesh.instanceColor.setUsage(THREE_LIB.DynamicDrawUsage);
  mesh.frustumCulled = false;

  const px = new Float32Array(count);
  const py = new Float32Array(count);
  const pz = new Float32Array(count);
  const ps = new Float32Array(count);
  const col = new Float32Array(count * 3);
  const depth = new Float32Array(count);
  const order = Array.from({ length: count }, (_, i) => i);
  const camLocal = new THREE_LIB.Vector3();
  const byDepth = (a: number, b: number) => depth[b] - depth[a];

  function commit(camera: THREE.Camera) {
    mesh.updateWorldMatrix(true, false);
    camLocal.copy(camera.position);
    mesh.worldToLocal(camLocal);
    for (let i = 0; i < count; i++) {
      const dx = px[i] - camLocal.x;
      const dy = py[i] - camLocal.y;
      const dz = pz[i] - camLocal.z;
      depth[i] = dx * dx + dy * dy + dz * dz;
    }
    // 上一帧顺序基本有序，近有序数据排序极快
    order.sort(byDepth);

    const m = mesh.instanceMatrix.array as Float32Array;
    const c = mesh.instanceColor!.array as Float32Array;
    for (let k = 0; k < count; k++) {
      const i = order[k];
      const o = k * 16;
      const s = ps[i];
      m[o] = s; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0;
      m[o + 4] = 0; m[o + 5] = s; m[o + 6] = 0; m[o + 7] = 0;
      m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = s; m[o + 11] = 0;
      m[o + 12] = px[i]; m[o + 13] = py[i]; m[o + 14] = pz[i]; m[o + 15] = 1;
      c[k * 3] = col[i * 3];
      c[k * 3 + 1] = col[i * 3 + 1];
      c[k * 3 + 2] = col[i * 3 + 2];
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor!.needsUpdate = true;
  }

  return {
    mesh,
    material: mat,
    px,
    py,
    pz,
    ps,
    col,
    commit,
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

export interface VoxelCell {
  x: number;
  y: number;
  z: number;
  color: THREE.Color;
  param?: number;
  [key: string]: unknown;
}

/**
 * 整数网格体素化：遍历包围盒，只保留至少有一个 6 邻域在形体外的表面体素。
 */
export function voxelizeSurface(
  [x0, y0, z0, x1, y1, z1]: [number, number, number, number, number, number],
  inside: (x: number, y: number, z: number) => boolean,
  paint: (x: number, y: number, z: number) => { color: THREE.Color; [key: string]: unknown }
): VoxelCell[] {
  const out: VoxelCell[] = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        if (!inside(x, y, z)) continue;
        const exposed =
          !inside(x + 1, y, z) ||
          !inside(x - 1, y, z) ||
          !inside(x, y + 1, z) ||
          !inside(x, y - 1, z) ||
          !inside(x, y, z + 1) ||
          !inside(x, y, z - 1);
        if (exposed) out.push({ x, y, z, ...paint(x, y, z) });
      }
    }
  }
  return out;
}

/** 体素集合（去重），用于沿曲线扫掠生成的形体 */
export function createVoxelSet() {
  const map = new Map<string, VoxelCell>();
  return {
    add(x: number, y: number, z: number, data: { color: THREE.Color; param?: number; [key: string]: unknown }) {
      const key = `${x},${y},${z}`;
      if (!map.has(key)) map.set(key, { x, y, z, ...data });
    },
    has(x: number, y: number, z: number) {
      return map.has(`${x},${y},${z}`);
    },
    values(): VoxelCell[] {
      return Array.from(map.values());
    },
  };
}

function spread10(v: number): number {
  let x = v & 1023;
  x = (x | (x << 16)) & 0x030000ff;
  x = (x | (x << 8)) & 0x0300f00f;
  x = (x | (x << 4)) & 0x030c30c3;
  x = (x | (x << 2)) & 0x09249249;
  return x;
}

/** 按 Morton（Z 序）码排序，保持空间局部性 */
export function mortonSort(cells: VoxelCell[]): VoxelCell[] {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  cells.forEach((c) => {
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
    minZ = Math.min(minZ, c.z); maxZ = Math.max(maxZ, c.z);
  });
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1);
  const q = (v: number, lo: number) => Math.round(((v - lo) / span) * 1023);
  const withKeys = cells.map((c) => ({
    ...c,
    mortonKey: spread10(q(c.x, minX)) | (spread10(q(c.y, minY)) << 1) | (spread10(q(c.z, minZ)) << 2),
  }));
  return withKeys.sort((a, b) => a.mortonKey - b.mortonKey);
}

export interface VoxelSlots {
  pos: Float32Array;
  scale: Float32Array;
  col: Float32Array;
  param: Float32Array;
  count: number;
}

/**
 * 把任意数量的体素映射到固定 N 个实例槽位：
 * 槽位 i 对应排序后的第 floor(i*count/N) 个体素，重复映射的槽位缩放为 0（相变时从体素内部生长/收缩）。
 */
export function toSlots(cells: VoxelCell[], N: number, unit: number, gap = 0.9): VoxelSlots {
  const pos = new Float32Array(N * 3);
  const scale = new Float32Array(N);
  const col = new Float32Array(N * 3);
  const param = new Float32Array(N);
  const count = cells.length;
  let last = -1;
  for (let i = 0; i < N; i++) {
    const j = Math.min(count - 1, Math.floor((i * count) / N));
    const c = cells[j];
    pos[i * 3] = c.x * unit;
    pos[i * 3 + 1] = c.y * unit;
    pos[i * 3 + 2] = c.z * unit;
    scale[i] = j === last ? 0 : unit * gap;
    col[i * 3] = c.color.r;
    col[i * 3 + 1] = c.color.g;
    col[i * 3 + 2] = c.color.b;
    param[i] = c.param ?? 0;
    last = j;
  }
  return { pos, scale, col, param, count };
}

/** 确定性哈希噪声（0~1） */
export function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** 平滑值噪声（0~1） */
export function valueNoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export const quintic = (p: number): number => p * p * p * (p * (p * 6 - 15) + 10);
