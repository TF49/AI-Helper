import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import gsap from "gsap";
import { cn } from "../../lib/utils";

/** 圆环画在 100 视口里，随按钮高度等比缩放 */
const VIEW = 100;
const RING_STROKE = 8;
const RING_RADIUS = (VIEW - RING_STROKE) / 2 - 6;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const ACCENT = {
  teal: {
    idle: "#0d9488",
    hover: "#0f766e",
    success: "#059669",
    className: "bg-teal-600 hover:bg-teal-700 active:bg-teal-800",
  },
  blue: {
    idle: "#2563eb",
    hover: "#1d4ed8",
    success: "#059669",
    className: "bg-blue-600 hover:bg-blue-700 active:bg-blue-800",
  },
  purple: {
    idle: "#9333ea",
    hover: "#7e22ce",
    success: "#059669",
    className: "bg-purple-600 hover:bg-purple-700 active:bg-purple-800",
  },
  emerald: {
    idle: "#059669",
    hover: "#047857",
    success: "#059669",
    className: "bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800",
  },
  orange: {
    idle: "#ea580c",
    hover: "#c2410c",
    success: "#059669",
    className: "bg-orange-600 hover:bg-orange-700 active:bg-orange-800",
  },
} as const;

export interface ButtonToLoaderToSuccessProps {
  idleLabel: ReactNode;
  successLabel: ReactNode;
  onAction: () => void | Promise<void>;
  disabled?: boolean;
  accent?: keyof typeof ACCENT;
  className?: string;
  type?: "button" | "submit";
  title?: string;
  /** 成功条停留后是否复原；弹窗关闭场景传 null */
  resetAfterMs?: number | null;
  holdMs?: number;
  onComplete?: () => void;
  onBusyChange?: (busy: boolean) => void;
}

export function ButtonToLoaderToSuccess({
  idleLabel,
  successLabel,
  onAction,
  disabled = false,
  accent = "blue",
  className,
  type = "button",
  title,
  resetAfterMs = 2200,
  holdMs = 900,
  onComplete,
  onBusyChange,
}: ButtonToLoaderToSuccessProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const idleRef = useRef<HTMLSpanElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const ringWrapRef = useRef<SVGSVGElement>(null);
  const checkWrapRef = useRef<SVGSVGElement>(null);
  const checkPathRef = useRef<SVGPathElement>(null);
  const successRef = useRef<HTMLSpanElement>(null);
  const busyRef = useRef(false);
  const slotSizeRef = useRef({ width: 0, height: 0 });
  const colors = ACCENT[accent];

  useLayoutEffect(() => {
    const btn = btnRef.current;
    const slot = slotRef.current;
    if (!btn || !slot) return;
    const rect = btn.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      slotSizeRef.current = { width: rect.width, height: rect.height };
      slot.style.width = `${rect.width}px`;
      slot.style.height = `${rect.height}px`;
      gsap.set(btn, { width: rect.width, height: rect.height });
      gsap.set(idleRef.current, { position: "absolute", inset: 0 });
    }
  }, []);

  useEffect(() => {
    return () => {
      gsap.killTweensOf([
        btnRef.current,
        slotRef.current,
        idleRef.current,
        ringRef.current,
        ringWrapRef.current,
        checkWrapRef.current,
        checkPathRef.current,
        successRef.current,
      ]);
    };
  }, []);

  const revertToIdle = useCallback(() => {
    const btn = btnRef.current;
    const slot = slotRef.current;
    const { width, height } = slotSizeRef.current;
    if (!btn) return;

    gsap.killTweensOf([
      btn,
      slot,
      idleRef.current,
      ringRef.current,
      ringWrapRef.current,
      checkWrapRef.current,
      checkPathRef.current,
      successRef.current,
    ]);

    gsap.set(ringWrapRef.current, { opacity: 0 });
    gsap.set(checkWrapRef.current, {
      opacity: 0,
      scale: 1,
      left: "50%",
      xPercent: -50,
      x: 0,
    });
    gsap.set(successRef.current, { opacity: 0 });
    gsap.set(ringRef.current, { strokeDashoffset: RING_CIRCUMFERENCE });
    if (slot && width > 0) {
      gsap.to(slot, { width, height, duration: 0.35, ease: "power2.inOut" });
    }
    gsap.to(btn, {
      width,
      height,
      minWidth: width,
      borderRadius: 12,
      backgroundColor: colors.idle,
      duration: 0.35,
      ease: "power2.inOut",
      onComplete: () => {
        if (btnRef.current) {
          btnRef.current.style.backgroundColor = "";
          btnRef.current.style.minWidth = "";
          btnRef.current.style.borderRadius = "";
        }
      },
    });
    gsap.to(idleRef.current, { opacity: 1, duration: 0.18 });
    busyRef.current = false;
    onBusyChange?.(false);
  }, [colors.idle, onBusyChange]);

  const handleClick = async () => {
    if (disabled || busyRef.current) return;
    const btn = btnRef.current;
    const slot = slotRef.current;
    const ring = ringRef.current;
    const checkPath = checkPathRef.current;
    if (!btn || !slot || !ring || !checkPath) return;

    const rect = btn.getBoundingClientRect();
    const circle = rect.height;
    slotSizeRef.current = { width: rect.width, height: rect.height };
    slot.style.width = `${rect.width}px`;
    slot.style.height = `${rect.height}px`;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    busyRef.current = true;
    onBusyChange?.(true);

    const runAction = Promise.resolve()
      .then(() => onAction())
      .then(() => true)
      .catch(() => false);

    if (reduceMotion) {
      const ok = await runAction;
      if (!ok) {
        revertToIdle();
        return;
      }
      gsap.set(idleRef.current, { opacity: 0 });
      gsap.set(successRef.current, { opacity: 1 });
      gsap.set(checkWrapRef.current, { opacity: 1 });
      btn.style.backgroundColor = colors.success;
      await sleep(holdMs);
      onComplete?.();
      if (resetAfterMs != null) {
        await sleep(resetAfterMs);
        revertToIdle();
      } else {
        busyRef.current = false;
        onBusyChange?.(false);
      }
      return;
    }

    gsap.set(btn, { width: rect.width, height: rect.height });
    gsap.to(idleRef.current, { opacity: 0, duration: 0.12, ease: "power1.out" });

    await gsap.to(btn, {
      width: circle,
      height: circle,
      minWidth: circle,
      borderRadius: circle / 2,
      duration: 0.45,
      ease: "power2.inOut",
    });

    gsap.set(ring, {
      strokeDasharray: RING_CIRCUMFERENCE,
      strokeDashoffset: RING_CIRCUMFERENCE,
    });
    gsap.set(ringWrapRef.current, { opacity: 1 });

    const ringTween = gsap.to(ring, {
      strokeDashoffset: 0,
      duration: 1.15,
      ease: "power1.inOut",
    });

    const [ok] = await Promise.all([runAction, ringTween.then()]);

    if (!ok) {
      await gsap.to(btn, {
        x: -4,
        duration: 0.05,
        repeat: 3,
        yoyo: true,
        ease: "power1.inOut",
      });
      gsap.set(btn, { x: 0 });
      revertToIdle();
      return;
    }

    const checkLen = checkPath.getTotalLength();
    gsap.set(checkPath, {
      strokeDasharray: checkLen,
      strokeDashoffset: checkLen,
    });
    gsap.set(checkWrapRef.current, {
      opacity: 1,
      scale: 1,
      left: "50%",
      top: "50%",
      xPercent: -50,
      yPercent: -50,
      x: 0,
    });
    await gsap.to(checkPath, {
      strokeDashoffset: 0,
      duration: 0.38,
      ease: "power2.out",
    });
    await sleep(160);

    gsap.to(ringWrapRef.current, { opacity: 0, duration: 0.2 });
    gsap.to(checkWrapRef.current, {
      left: 10,
      xPercent: 0,
      x: 0,
      scale: 0.85,
      duration: 0.5,
      ease: "power2.inOut",
    });
    gsap.to(successRef.current, {
      opacity: 1,
      duration: 0.28,
      delay: 0.16,
      ease: "power2.out",
    });
    const neededWidth = (successRef.current?.scrollWidth || 0) + 36;
    const targetWidth = Math.max(slotSizeRef.current.width, neededWidth);

    if (slot && targetWidth !== slotSizeRef.current.width) {
      gsap.to(slot, {
        width: targetWidth,
        duration: 0.5,
        ease: "power2.inOut",
      });
    }

    await gsap.to(btn, {
      width: targetWidth,
      height: slotSizeRef.current.height,
      minWidth: targetWidth,
      borderRadius: 12,
      backgroundColor: colors.success,
      duration: 0.5,
      ease: "power2.inOut",
    });

    await sleep(holdMs);
    onComplete?.();

    if (resetAfterMs != null) {
      await sleep(resetAfterMs);
      revertToIdle();
    } else {
      busyRef.current = false;
      onBusyChange?.(false);
    }
  };

  return (
    <div
      ref={slotRef}
      className="relative inline-flex shrink-0 items-center justify-center overflow-visible"
    >
      <button
        ref={btnRef}
        type={type}
        title={title}
        disabled={disabled}
        onClick={() => void handleClick()}
        className={cn(
          "relative z-10 flex items-center justify-center gap-2 overflow-hidden px-6 py-2.5",
          "rounded-xl text-xs font-semibold text-white shadow-xs cursor-pointer",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          colors.className,
          className,
        )}
      >
        <span
          ref={idleRef}
          className="flex items-center justify-center gap-2 whitespace-nowrap"
        >
          {idleLabel}
        </span>

        <svg
          ref={ringWrapRef}
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
          aria-hidden
        >
          <circle
            cx={VIEW / 2}
            cy={VIEW / 2}
            r={RING_RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.22)"
            strokeWidth={RING_STROKE}
          />
          <circle
            ref={ringRef}
            cx={VIEW / 2}
            cy={VIEW / 2}
            r={RING_RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.95)"
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={RING_CIRCUMFERENCE}
            transform={`rotate(-90 ${VIEW / 2} ${VIEW / 2})`}
          />
        </svg>

        <svg
          ref={checkWrapRef}
          width={16}
          height={16}
          viewBox="0 0 28 28"
          className="pointer-events-none absolute top-1/2 opacity-0"
          aria-hidden
        >
          <path
            ref={checkPathRef}
            d="M6.5 14.2 L11.4 19.1 L21.5 8.6"
            fill="none"
            stroke="white"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>

        <span
          ref={successRef}
          className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 pl-6 opacity-0 whitespace-nowrap"
        >
          {successLabel}
        </span>
      </button>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
