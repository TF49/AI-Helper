/**
 * 流体玻璃透镜（Liquid Glass Lens）
 *
 * 思路来自 shuding/liquid-glass（MIT, https://github.com/shuding/liquid-glass）：
 * 在 JS 中逐像素计算“采样偏移”，写入 canvas 的 R/G 通道，作为 SVG
 * <feImage> + <feDisplacementMap> 的置换贴图。
 *
 * 与原项目的差异：
 * - 原项目用 backdrop-filter 折射元素“背后”的内容；按钮位于带 backdrop-blur 的卡片内，
 *   背后只有近乎纯白的卡片底色，折射不可见，且 WKWebView（macOS）不支持该写法。
 *   这里改为 filter 只作用在按钮的文字层上。
 * - 不作用于整个表面：实测透镜会把参考实现沿胶囊内缘的亮边与内阴影“拉走”，
 *   抹平立体边缘。因此表面、内阴影、下沉/按下效果保持参考实现原样。
 * - 透镜形态为“玻璃柱面放大镜”：文字中部放大、两端收缩，总尺寸不变；
 *   原项目的编码在 |偏移| > 最大值 1/4 时会被截断，这里使用无损的线性编码。
 */

export interface LiquidLensMap {
  /** 置换贴图（PNG data URL），尺寸为 (w + 2·margin) × (h + 2·margin) */
  url: string;
  /** 贴图在元素四周额外覆盖的边距（CSS 像素），用于容纳文字阴影等溢出内容 */
  margin: number;
  /** intensity = 1 时 feDisplacementMap 的 scale 值 */
  baseScale: number;
  /** 保证采样单调（不折叠出重复笔画）的最大倍率 */
  maxIntensity: number;
}

export interface LiquidLensShape {
  /**
   * 透镜曲率 k：中心放大倍数 = 1 / (1 − k × 倍率)。
   * k × 倍率须 < 1 才能保持单调，组件会自动限制在 LENS_FOLD_LIMIT 以内。
   */
  lens: number;
}

/** 采样映射 f(u) = u(1 − k) + k·u³ 的导数 1 − k + 3k·u² 在 k < 1 时恒正；留出余量 */
export const LENS_FOLD_LIMIT = 0.85;

/**
 * 为宽 w、高 h（CSS 像素）的文字层生成置换贴图。
 * 以元素中心为原点、按椭圆归一化距离 u ∈ [0, 1]：
 *   采样点 = 中心 + (p − 中心) × (1 − k(1 − u²))
 * u = 0（中心）放大最多，u = 1（边界）无偏移，椭圆外不偏移，与周围自然衔接。
 */
export function createLiquidLensMap(
  w: number,
  h: number,
  shape: LiquidLensShape,
  dpr = 1,
): LiquidLensMap | null {
  if (w < 2 || h < 2 || typeof document === "undefined") return null;

  const k = Math.max(0.001, Math.min(LENS_FOLD_LIMIT, shape.lens));
  const margin = Math.ceil(Math.min(w, h) * 0.2);
  const fw = w + margin * 2;
  const fh = h + margin * 2;
  const pw = Math.max(1, Math.round(fw * dpr));
  const ph = Math.max(1, Math.round(fh * dpr));
  const hw = w / 2;
  const hh = h / 2;

  // 偏移幅值 |u·k(1 − u²)|·半轴 的最大值出现在 u = 1/√3
  const maxOffset = Math.max(hw, hh) * k * (2 / (3 * Math.sqrt(3)));
  const scale = Math.max(0.01, maxOffset * 2);

  const data = new Uint8ClampedArray(pw * ph * 4);
  for (let j = 0; j < ph; j++) {
    const y = (j + 0.5) / dpr - margin - hh; // 相对元素中心
    for (let i = 0; i < pw; i++) {
      const x = (i + 0.5) / dpr - margin - hw;
      const u2 = (x / hw) * (x / hw) + (y / hh) * (y / hh);

      let dx = 0;
      let dy = 0;
      if (u2 < 1) {
        const factor = -k * (1 - u2); // 采样点 = p + (p − c) × factor，向中心收拢 → 放大
        dx = x * factor;
        dy = y * factor;
      }

      const o = (j * pw + i) * 4;
      // feDisplacementMap: P'(x) = P(x + scale × (C − 0.5))，C ∈ [0, 1]
      data[o] = (dx / scale + 0.5) * 255;
      data[o + 1] = (dy / scale + 0.5) * 255;
      data[o + 2] = 0;
      data[o + 3] = 255;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(data, pw, ph), 0, 0);
  return {
    url: canvas.toDataURL("image/png"),
    margin,
    baseScale: scale,
    maxIntensity: LENS_FOLD_LIMIT / k,
  };
}

/**
 * CSS filter 引用含 feImage 的 SVG 滤镜，目前仅在 Chromium 内核中表现稳定
 * （Windows 上的 WebView2 属于此类）。WebKit（macOS WKWebView / Linux WebKitGTK）
 * 中若 feImage 加载失败，文字会被错误平移，因此非 Chromium 环境只保留 CSS 高光层。
 */
export function supportsLiquidLens(): boolean {
  if (typeof navigator === "undefined") return false;
  // 优先使用 UA Client Hints（WebView2 / Chrome / Edge 均提供 "Chromium" 品牌）
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } })
    .userAgentData?.brands;
  if (brands?.some((b) => b.brand === "Chromium")) return true;
  // 回退到 UA 字符串；不加单词边界，以兼容 "HeadlessChrome/"
  return /Chrome\/\d+/.test(navigator.userAgent);
}
