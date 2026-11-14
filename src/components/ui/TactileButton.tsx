import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { cn } from "../../lib/utils";
import { createLiquidLensMap, supportsLiquidLens, type LiquidLensMap } from "./liquid-glass";
import "./tactile-button.css";

export interface LiquidGlassOptions {
  /**
   * 透镜曲率：文字中部放大倍数 = 1 / (1 − lens × 倍率)，默认 0.08（静止时约 1.09 倍）。
   * 与悬停/按下倍率相乘后不超过 0.85（超过会自动限制），以免笔画折叠重复。
   */
  lens?: number;
  /**
   * 置换后的抗锯齿模糊半径（px），默认 0.35。
   * feDisplacementMap 按最近像素重采样，笔画边缘会出现台阶；原版 liquid-glass 同样以 blur(0.25px) 处理。
   */
  smoothing?: number;
  /** 玻璃高光层（纯 CSS，所有平台可用），默认 true */
  sheen?: boolean;
  /** 悬停（下沉）时的透镜倍率，默认 1.4 */
  hoverIntensity?: number;
  /** 按下时的透镜倍率，默认 1.9 */
  pressIntensity?: number;
}

export interface TactileButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  /** 文字左侧图标（扩展能力，参考实现中没有） */
  icon?: React.ReactNode;
  /** 流体玻璃效果（扩展能力）：true 使用默认参数，或传入参数对象 */
  liquidGlass?: boolean | LiquidGlassOptions;
  /**
   * 配色主题（扩展能力）：
   * - "reference"（默认）：参考实现的银灰金属配色
   * - "clear"：全透明玻璃，表面几乎无填充，仅以高光边与投影勾勒轮廓
   */
  theme?: "reference" | "clear";
  children?: React.ReactNode;
}

const DEFAULT_GLASS: Required<LiquidGlassOptions> = {
  lens: 0.08,
  smoothing: 0.35,
  sheen: true,
  hoverIntensity: 1.4,
  pressIntensity: 1.9,
};

/** 与参考实现中裁剪/缩放过渡一致：250ms */
const LENS_TRANSITION_MS = 250;

/**
 * Tactile Push Button —— 与参考实现保持同一 DOM 结构与类名：
 *   button.tactile-button > span.button-outer > span.button-inner > span
 * 外观通过参考中定义的 CSS 变量调整（--button-font-size、--button-padding-x/y、
 * --button-surface-start/end、--button-text-start/end、--button-press-scale 等），
 * 可经 style 或 Tailwind 任意属性类（如 [--button-font-size:12px]）覆盖。
 *
 * liquidGlass 开启后叠加流体玻璃（表面、内阴影、下沉/按下效果保持参考实现原样）：
 * - 透镜：SVG 置换滤镜仅作用于文字层，像透过玻璃柱面看文字——中部放大、两端收缩；
 *   悬停下沉/按下时曲率加深，与表面下沉同步（仅 Chromium 内核，即 Windows WebView2）
 * - 高光：表面顶部的玻璃反光与底部焦散（纯 CSS，所有平台可用）
 */
export const TactileButton = React.forwardRef<HTMLButtonElement, TactileButtonProps>(
  (
    { icon, children, className, type = "button", liquidGlass, theme = "reference", ...props },
    forwardedRef,
  ) => {
    const glass = liquidGlass
      ? { ...DEFAULT_GLASS, ...(liquidGlass === true ? {} : liquidGlass) }
      : null;
    const lensEnabled = Boolean(glass) && supportsLiquidLens();

    // useId 生成的 ":r1:" 含冒号，在 url(#...) 中需转义，这里直接替换为安全字符
    const filterId = "tactile-lens-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");

    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const textRef = useRef<HTMLSpanElement | null>(null);
    const displacementRef = useRef<SVGFEDisplacementMapElement | null>(null);
    const [lensMap, setLensMap] = useState<LiquidLensMap | null>(null);
    const [size, setSize] = useState<{ w: number; h: number } | null>(null);

    const setButtonRef = useCallback(
      (node: HTMLButtonElement | null) => {
        buttonRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    // ── 尺寸跟踪：offsetWidth/Height 为布局尺寸，不受悬停/按下缩放、入场动画的 transform 影响 ──
    useLayoutEffect(() => {
      const inner = textRef.current;
      if (!lensEnabled || !inner) {
        setSize(null);
        return;
      }
      const measure = () => {
        const w = inner.offsetWidth;
        const h = inner.offsetHeight;
        setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(inner);
      return () => observer.disconnect();
    }, [lensEnabled]);

    // ── 置换贴图：仅在尺寸或形状参数变化时重新计算（约百×数十像素，开销可忽略） ──
    const lens = glass?.lens;
    useEffect(() => {
      if (!lensEnabled || !size || lens === undefined) {
        setLensMap(null);
        return;
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      setLensMap(createLiquidLensMap(size.w, size.h, { lens }, dpr));
    }, [lensEnabled, size, lens]);

    // ── 透镜倍率动画：只修改 feDisplacementMap 的 scale 属性，不触发 React 重渲染 ──
    const intensity = useRef(1);
    const frame = useRef(0);
    const baseScale = lensMap?.baseScale ?? 0;
    const maxIntensity = lensMap?.maxIntensity ?? 1;

    const applyScale = useCallback(() => {
      const safe = Math.min(intensity.current, maxIntensity);
      displacementRef.current?.setAttribute("scale", String(baseScale * safe));
    }, [baseScale, maxIntensity]);

    const animateTo = useCallback(
      (target: number) => {
        cancelAnimationFrame(frame.current);
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const from = intensity.current;
        if (reduced || from === target) {
          intensity.current = target;
          applyScale();
          return;
        }
        const start = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / LENS_TRANSITION_MS);
          const eased = 1 - Math.pow(1 - t, 3);
          intensity.current = from + (target - from) * eased;
          applyScale();
          if (t < 1) frame.current = requestAnimationFrame(step);
        };
        frame.current = requestAnimationFrame(step);
      },
      [applyScale],
    );

    useEffect(() => () => cancelAnimationFrame(frame.current), []);

    // 贴图更新后，立即同步一次 scale
    useEffect(() => {
      applyScale();
    }, [applyScale]);

    // ── 交互状态：与 CSS 的 :hover / :active 保持同步 ──
    const hoverIntensity = glass?.hoverIntensity ?? 1;
    const pressIntensity = glass?.pressIntensity ?? 1;
    useEffect(() => {
      const button = buttonRef.current;
      if (!lensEnabled || !button) return;

      const rest = () => animateTo(button.matches(":hover") ? hoverIntensity : 1);
      const onEnter = () => animateTo(hoverIntensity);
      const onLeave = () => animateTo(1);
      const onDown = () => animateTo(pressIntensity);
      const onKeyDown = (e: KeyboardEvent) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) animateTo(pressIntensity);
      };

      button.addEventListener("pointerenter", onEnter);
      button.addEventListener("pointerleave", onLeave);
      button.addEventListener("pointerdown", onDown);
      button.addEventListener("pointerup", rest);
      button.addEventListener("pointercancel", onLeave);
      button.addEventListener("keydown", onKeyDown);
      button.addEventListener("keyup", rest);
      button.addEventListener("blur", onLeave);
      return () => {
        button.removeEventListener("pointerenter", onEnter);
        button.removeEventListener("pointerleave", onLeave);
        button.removeEventListener("pointerdown", onDown);
        button.removeEventListener("pointerup", rest);
        button.removeEventListener("pointercancel", onLeave);
        button.removeEventListener("keydown", onKeyDown);
        button.removeEventListener("keyup", rest);
        button.removeEventListener("blur", onLeave);
      };
    }, [lensEnabled, animateTo, hoverIntensity, pressIntensity]);

    const lensActive = lensEnabled && lensMap && size;

    return (
      <motion.button
        ref={setButtonRef}
        type={type}
        className={cn(
          "tactile-button",
          glass?.sheen && "tactile-button--glass",
          theme === "clear" && "tactile-button--theme-clear",
          className,
        )}
        {...props}
      >
        {lensActive && (
          <svg className="tactile-button__lens-defs" aria-hidden="true" focusable="false">
            <defs>
              {/* 滤镜区域四周外扩 margin，容纳文字阴影（0.1em）等溢出内容，避免被裁切 */}
              <filter
                id={filterId}
                filterUnits="userSpaceOnUse"
                colorInterpolationFilters="sRGB"
                x={-lensMap.margin}
                y={-lensMap.margin}
                width={size.w + lensMap.margin * 2}
                height={size.h + lensMap.margin * 2}
              >
                <feImage
                  href={lensMap.url}
                  x={-lensMap.margin}
                  y={-lensMap.margin}
                  width={size.w + lensMap.margin * 2}
                  height={size.h + lensMap.margin * 2}
                  preserveAspectRatio="none"
                  result="lensMap"
                />
                <feDisplacementMap
                  ref={displacementRef}
                  in="SourceGraphic"
                  in2="lensMap"
                  scale={lensMap.baseScale * Math.min(intensity.current, lensMap.maxIntensity)}
                  xChannelSelector="R"
                  yChannelSelector="G"
                  result="displaced"
                />
                {(glass?.smoothing ?? 0) > 0 && (
                  <feGaussianBlur in="displaced" stdDeviation={glass?.smoothing} />
                )}
              </filter>
            </defs>
          </svg>
        )}
        <span className="button-outer">
          <span className="button-inner">
            <span
              ref={textRef}
              className={icon ? "button-text--with-icon" : undefined}
              style={lensActive ? { filter: `url(#${filterId})` } : undefined}
            >
              {icon}
              {children}
            </span>
          </span>
        </span>
      </motion.button>
    );
  },
);
TactileButton.displayName = "TactileButton";
