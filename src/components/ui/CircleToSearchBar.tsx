import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  type InputHTMLAttributes,
} from "react";
import { Search, X } from "lucide-react";
import { cn } from "../../lib/utils";

export interface CircleToSearchBarProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "onChange"> {
  /** 自定义左侧/圆形图标 (默认为 Search 放大镜) */
  icon?: React.ReactNode;
  /** 当前搜索关键字 */
  value: string;
  /** 搜索内容变更回调 */
  onChange: (value: string) => void;
  /** 点击清空内容回调 (可选) */
  onClear?: () => void;
  /** 占位文字 */
  placeholder?: string;
  /** 提示按钮在收起状态下的 hover title 提示 */
  title?: string;
  /** 按钮基础尺寸 (默认 36px，可选 28 / 32 / 36 / 40 或 'sm' | 'md' | 'lg') */
  size?: "sm" | "md" | "lg" | number;
  /**
   * 展开后的宽度样式：
   * - "full" (自适应撑满父级剩余空间)
   * - 具体数字 (如 180, 260, 320)
   * - Tailwind 宽度类名 (如 "w-64", "w-72", "w-80", "w-96")
   */
  expandedWidth?: "full" | string | number;
  /** 圆角插值目标大小 (展开后)，默认 12px (rounded-xl) */
  expandedRadiusPx?: number;
  /** 是否允许当失焦且无输入时自动收拢 (默认 true) */
  autoCollapseOnBlur?: boolean;
  /** 外层容器自定义类名 */
  className?: string;
  /** input 元素自定义类名 */
  inputClassName?: string;
  /** 外部直接强制控制展开状态 (可选) */
  isExpandedControlled?: boolean;
  /** 展开状态变化通知 */
  onExpandedChange?: (expanded: boolean) => void;
}

/** 提示词指定动效贝塞尔曲线与时长：360ms 连续插值 */
const BEZIER_CURVE = "cubic-bezier(0.2, 0.9, 0.22, 1)";
const ANIMATION_DURATION_MS = 360;

/** 解析 Tailwind 宽度类名为像素值，确保纯数值 CSS 连续插值 */
function parseExpandedWidthToPx(width: string | number | undefined, parentWidth: number | null): string {
  if (typeof width === "number") {
    return `${width}px`;
  }
  if (!width || width === "full") {
    return parentWidth ? `${parentWidth}px` : "100%";
  }
  // 解析 Tailwind 类名，如 w-64 -> 256px
  const match = width.match(/^w-(\d+(\.\d+)?)$/);
  if (match) {
    const val = parseFloat(match[1]);
    return `${val * 4}px`;
  }
  if (width.endsWith("px") || width.endsWith("%") || width.endsWith("rem")) {
    return width;
  }
  return width;
}

export const CircleToSearchBar = React.forwardRef<
  HTMLInputElement,
  CircleToSearchBarProps
>(
  (
    {
      value,
      onChange,
      onClear,
      placeholder = "搜索...",
      title = "点击搜索",
      size = "md",
      expandedWidth = "full",
      expandedRadiusPx = 12,
      autoCollapseOnBlur = true,
      className,
      inputClassName,
      isExpandedControlled,
      onExpandedChange,
      disabled,
      autoFocus,
      icon,
      ...props
    },
    forwardedRef,
  ) => {
    // 基础尺寸数值解析
    const sizePx =
      typeof size === "number"
        ? size
        : size === "sm"
          ? 30
          : size === "lg"
            ? 40
            : 36;
    const collapsedRadiusPx = Math.round(sizePx / 2);
    const iconSize = sizePx <= 30 ? 12 : sizePx <= 32 ? 13 : 14;
    // 展开状态下的左内边距
    const expandedPaddingLeftPx = sizePx <= 30 ? 9 : sizePx <= 32 ? 10 : 12;
    // 展开状态下输入文字的起始左边距（图标左内边距 + 图标自身宽度 + 呼吸间距，彻底杜绝图标与文字/占位符重叠）
    const inputPaddingLeftPx = expandedPaddingLeftPx + iconSize + (sizePx <= 30 ? 7 : 8);
    // 右侧清除按钮预留间距
    const inputPaddingRightPx = sizePx <= 30 ? 24 : 28;

    // 内部输入框 ref 与容器 ref
    const innerInputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // 展开状态：当有初始值时默认保持展开
    const [internalExpanded, setInternalExpanded] = useState<boolean>(() => {
      if (typeof isExpandedControlled === "boolean") return isExpandedControlled;
      return Boolean(value && value.trim().length > 0);
    });

    const isExpanded =
      typeof isExpandedControlled === "boolean"
        ? isExpandedControlled
        : internalExpanded;

    // 是否已经完成 360ms 宽度插值落定 (用于占位文字与光标优雅淡入)
    const [isSettled, setIsSettled] = useState<boolean>(() => isExpanded);

    // 自动测量父容器可用宽度像素值 (用于 expandedWidth="full" 场景下的纯像素精准平滑插值)
    const [measuredParentWidth, setMeasuredParentWidth] = useState<number | null>(null);

    // 同步受控展开状态
    useEffect(() => {
      if (typeof isExpandedControlled === "boolean") {
        setInternalExpanded(isExpandedControlled);
      }
    }, [isExpandedControlled]);

    // 监测外部 value：若外部填入了内容且当前未展开，则自动展开保持同步
    useEffect(() => {
      if (value && value.trim().length > 0 && !isExpanded) {
        setInternalExpanded(true);
        onExpandedChange?.(true);
      }
    }, [value, isExpanded, onExpandedChange]);

    // 测量父级容器宽度
    useLayoutEffect(() => {
      if (!containerRef.current) return;
      const parent = containerRef.current.parentElement;
      if (!parent) return;

      const updateWidth = () => {
        const pWidth = parent.clientWidth;
        if (pWidth > sizePx) {
          setMeasuredParentWidth(pWidth);
        }
      };

      updateWidth();
      const observer = new ResizeObserver(updateWidth);
      observer.observe(parent);
      return () => observer.disconnect();
    }, [sizePx]);

    // 展开/收起切换时的落定与光标聚焦控制
    useEffect(() => {
      let timer: ReturnType<typeof setTimeout>;
      let focusTimer: ReturnType<typeof setTimeout>;

      if (isExpanded) {
        setIsSettled(false);
        // 接近落定时聚焦 (避免宽度扩张期间 IME 候选框飘移)，360ms 宽度落定后优雅淡入光标与占位文字
        focusTimer = setTimeout(() => {
          innerInputRef.current?.focus();
        }, 280);

        timer = setTimeout(() => {
          setIsSettled(true);
        }, ANIMATION_DURATION_MS);
      } else {
        // 收起时瞬间隐藏文字与光标，避免宽度收窄过程中文字发生折行
        setIsSettled(false);
      }
      return () => {
        clearTimeout(timer);
        clearTimeout(focusTimer);
      };
    }, [isExpanded]);

    // 点击展开处理
    const handleExpand = useCallback(() => {
      if (disabled || isExpanded) return;
      setInternalExpanded(true);
      onExpandedChange?.(true);
    }, [disabled, isExpanded, onExpandedChange]);

    // 清空操作
    const handleClear = useCallback(
      (e: React.MouseEvent) => {
        e.stopPropagation();
        onChange("");
        onClear?.();
        innerInputRef.current?.focus();
      },
      [onChange, onClear],
    );

    // 点击外部处理 (Click Outside)
    useEffect(() => {
      if (!autoCollapseOnBlur || !isExpanded) return;

      const handlePointerDownOutside = (event: MouseEvent | TouchEvent) => {
        if (!containerRef.current) return;
        if (containerRef.current.contains(event.target as Node)) {
          return;
        }

        // 仅在当前无输入内容时自动收拢
        if (!value || value.trim().length === 0) {
          setInternalExpanded(false);
          onExpandedChange?.(false);
        }
      };

      document.addEventListener("mousedown", handlePointerDownOutside);
      document.addEventListener("touchstart", handlePointerDownOutside);
      return () => {
        document.removeEventListener("mousedown", handlePointerDownOutside);
        document.removeEventListener("touchstart", handlePointerDownOutside);
      };
    }, [autoCollapseOnBlur, isExpanded, value, onExpandedChange]);

    // 键盘事件：Esc 键清空或平滑收起
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (value) {
          onChange("");
          onClear?.();
        } else if (autoCollapseOnBlur) {
          innerInputRef.current?.blur();
          setInternalExpanded(false);
          onExpandedChange?.(false);
        }
      }
      props.onKeyDown?.(e);
    };

    // 目标宽度计算
    const targetWidth = !isExpanded
      ? `${sizePx}px`
      : parseExpandedWidthToPx(expandedWidth, measuredParentWidth);

    // 合并 ref
    const setRefs = useCallback(
      (node: HTMLInputElement | null) => {
        (innerInputRef as React.MutableRefObject<HTMLInputElement | null>).current =
          node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          (forwardedRef as React.MutableRefObject<HTMLInputElement | null>).current =
            node;
        }
      },
      [forwardedRef],
    );

    // 计算图标在圆形时的精确水平居中坐标，与展开后的左内边距坐标
    const collapsedIconLeftPx = Math.round((sizePx - iconSize) / 2);

    return (
      <div
        ref={containerRef}
        onClick={handleExpand}
        title={!isExpanded ? title : undefined}
        role={!isExpanded ? "button" : undefined}
        tabIndex={!isExpanded ? 0 : undefined}
        aria-label={!isExpanded ? title : undefined}
        aria-expanded={isExpanded}
        onKeyDown={(e) => {
          if (!isExpanded && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            handleExpand();
          }
        }}
        className={cn(
          "relative flex items-center overflow-hidden select-none shrink-0",
          !isExpanded &&
            "cursor-pointer group hover:scale-[1.03] active:scale-[0.97]",
          isExpanded
            ? "bg-slate-50/80 dark:bg-white/5 border border-slate-200/90 dark:border-white/10 shadow-2xs focus-within:ring-1 focus-within:ring-blue-500/40 focus-within:border-blue-500"
            : "bg-slate-100/90 hover:bg-slate-200/80 text-slate-600 hover:text-slate-900 dark:bg-white/5 dark:hover:bg-white/10 dark:text-gray-400 dark:hover:text-white border border-slate-200/80 dark:border-white/10",
          className,
        )}
        style={{
          width: targetWidth,
          height: `${sizePx}px`,
          borderRadius: isExpanded
            ? `${expandedRadiusPx}px`
            : `${collapsedRadiusPx}px`,
          // 核心动效：同一条 cubic-bezier(.2,.9,.22,1) 在 360ms 内对尺寸、圆角与质感进行连续插值
          transitionProperty:
            "width, border-radius, background-color, border-color, box-shadow, transform",
          transitionDuration: `${ANIMATION_DURATION_MS}ms`,
          transitionTimingFunction: BEZIER_CURVE,
        }}
      >
        {/* ── 图标：同步左移到内边距处 (同一条贝塞尔曲线与 360ms 插值) ── */}
        <div
          className="absolute top-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center text-slate-400 dark:text-gray-400 shrink-0"
          style={{
            width: `${iconSize}px`,
            height: `${iconSize}px`,
            left: `${isExpanded ? expandedPaddingLeftPx : collapsedIconLeftPx}px`,
            transitionProperty: "left, color",
            transitionDuration: `${ANIMATION_DURATION_MS}ms`,
            transitionTimingFunction: BEZIER_CURVE,
          }}
        >
          {icon ? (
            icon
          ) : (
            <Search
              size={iconSize}
              className={cn(
                "transition-colors duration-200",
                isExpanded
                  ? "text-slate-500 dark:text-gray-400"
                  : "group-hover:text-slate-900 dark:group-hover:text-white",
              )}
            />
          )}
        </div>

        {/* ── 原生输入框：全程不切换组件，占位文字和光标等宽度落定后再淡入 ── */}
        <input
          ref={setRefs}
          type="text"
          value={value}
          disabled={disabled || !isExpanded}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus={autoFocus}
          placeholder={isSettled ? placeholder : ""}
          className={cn(
            "w-full h-full bg-transparent text-xs font-normal border-0 outline-none focus:outline-none tracking-normal",
            "text-slate-800 dark:text-gray-200",
            !isExpanded && "pointer-events-none cursor-pointer",
            inputClassName,
          )}
          style={{
            paddingLeft: `${inputPaddingLeftPx}px`,
            paddingRight: `${inputPaddingRightPx}px`,
            // 占位文字、内容与光标：未落定前 opacity: 0 且光标透明，360ms 后优雅淡入
            opacity: isSettled ? 1 : 0,
            caretColor: isSettled ? "currentColor" : "transparent",
            transitionProperty: "opacity",
            transitionDuration: isExpanded ? "180ms" : "60ms",
            transitionTimingFunction: "ease-out",
            ...props.style,
          }}
          {...props}
        />

        {/* ── 清除内容按钮：仅在展开且有值时淡入 ── */}
        {isExpanded && Boolean(value && value.length > 0) && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 hover:bg-slate-200/50 dark:hover:bg-white/10 transition-colors cursor-pointer"
            title="清空搜索"
          >
            <X size={12} />
          </button>
        )}
      </div>
    );
  },
);

CircleToSearchBar.displayName = "CircleToSearchBar";
