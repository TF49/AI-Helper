import React, { useState, useRef, useCallback } from "react";
import { motion, useMotionValue, useSpring, useTransform, AnimatePresence } from "motion/react";
import brandLogoImg from "@/assets/brand-logo.png";
import brandLogoDarkImg from "@/assets/brand-logo-darkmode.png";
import { useTheme } from "../theme-provider";
import { cn } from "@/lib/utils";

interface HolographicBrandLogoProps {
  size?: number;
  className?: string;
  interactive?: boolean;
}

interface ClickParticle {
  id: number;
  angle: number;
  distance: number;
  size: number;
  color: string;
}

interface ClickWave {
  id: number;
  x: number;
  y: number;
}

/**
 * AI-Helper 3D 全息品牌 Logo 精细动画组件
 * 
 * 核心特性：
 * 1. 3D 全息空间多层视差：鼠标位置映射莫比乌斯环倾角与全息投射透视
 * 2. 丰富动态全息光效：
 *    - 垂直光子扫描线（Vertical Hologram Scanline）循环扫过
 *    - 棱镜光学色散流光（Prismatic Iridescent Sheen）随角度转动
 *    - 动态镜面反射光斑（Specular Highlight Tracking）
 * 3. 增强型赛博全息底座（Cybernetic Holographic Emitter）：
 *    - 倾斜 3D 透视底座，双向旋转刻度光环
 *    - 同心全息能量波纹（Concentric Ripple Pulse）自内向外周期发散
 *    - 垂直全息投影光椎（Volumetric Light Rays）向上承托
 * 4. 空间全息量子微粒场（Quantum Stardust）：常驻轨道微光呼吸漂浮
 * 5. 沉浸式鼠标点击动画（Interactive Click & Haptic Recoil）：
 *    - 3D 触觉弹性下潜与弹跳回振（Recoil Spring）
 *    - 点击全息能量爆发冲击波（Holographic Shockwave Blast）
 *    - 8 向全息光子溅射粒子（Quantum Particle Burst）
 *    - 点击过曝全息能量闪光（Energy Surge Bloom）
 */
export const HolographicBrandLogo: React.FC<HolographicBrandLogoProps> = ({
  size = 140,
  className = "",
  interactive = true,
}) => {
  const { theme } = useTheme();
  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [clickWaves, setClickWaves] = useState<ClickWave[]>([]);
  const [clickParticles, setClickParticles] = useState<ClickParticle[]>([]);
  const [isEnergySurge, setIsEnergySurge] = useState(false);

  // 鼠标交互 3D 视差弹性动画
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const springConfig = { damping: 18, stiffness: 200, mass: 0.5 };
  const rotateX = useSpring(useTransform(mouseY, [-0.5, 0.5], [16, -16]), springConfig);
  const rotateY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-20, 20]), springConfig);
  const lightX = useTransform(mouseX, [-0.5, 0.5], ["20%", "80%"]);
  const lightY = useTransform(mouseY, [-0.5, 0.5], ["20%", "80%"]);

  // 鼠标移动
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!interactive || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    mouseX.set(x);
    mouseY.set(y);
  };

  const handleMouseEnter = () => {
    if (!interactive) return;
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    if (!interactive) return;
    setIsHovered(false);
    setIsPressed(false);
    mouseX.set(0);
    mouseY.set(0);
  };

  // 鼠标按下与弹起 (3D 按压触觉反馈)
  const handleMouseDown = () => {
    if (!interactive) return;
    setIsPressed(true);
  };

  const handleMouseUp = () => {
    if (!interactive) return;
    setIsPressed(false);
  };

  // 鼠标点击瞬间：激发全息能量波纹 + 光子飞溅粒子 + 过曝闪光
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!interactive || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const waveId = Date.now();
    setClickWaves((prev) => [...prev.slice(-3), { id: waveId, x: clickX, y: clickY }]);

    // 生成 8 颗全息光子溅射粒子
    const colors = [
      "#38bdf8", // cyan
      "#c084fc", // purple
      "#f472b6", // pink
      "#67e8f9", // sky
      "#fde047", // amber
      "#a78bfa", // violet
      "#4ade80", // emerald
      "#ffffff", // pure white
    ];
    const newParticles: ClickParticle[] = Array.from({ length: 8 }).map((_, i) => ({
      id: waveId + i,
      angle: (i * 45 + (Math.random() * 20 - 10)) * (Math.PI / 180),
      distance: 38 + Math.random() * 32,
      size: 3 + Math.random() * 2.5,
      color: colors[i % colors.length],
    }));

    setClickParticles((prev) => [...prev.slice(-16), ...newParticles]);

    // 触发过曝能量潮汐
    setIsEnergySurge(true);
    const surgeTimer = setTimeout(() => {
      setIsEnergySurge(false);
    }, 450);

    // 自动清理过期波纹与粒子
    const clearTimer = setTimeout(() => {
      setClickWaves((prev) => prev.filter((w) => w.id !== waveId));
      setClickParticles((prev) => prev.filter((p) => !newParticles.some((np) => np.id === p.id)));
    }, 900);

    return () => {
      clearTimeout(surgeTimer);
      clearTimeout(clearTimer);
    };
  }, [interactive]);

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onClick={handleClick}
      style={{
        width: size,
        height: size,
        perspective: 1000,
      }}
      className={cn(
        "relative flex items-center justify-center select-none cursor-pointer group active:cursor-grabbing",
        className
      )}
      title="点击体验 AI-Helper 3D 全息能量交互"
    >
      {/* ── 1. 底部赛博全息发射基座与同心微光波纹 ── */}
      <div
        className="absolute -bottom-4 inset-x-0 h-14 pointer-events-none flex items-center justify-center"
        style={{ perspective: 600, transformStyle: "preserve-3d" }}
      >
        {/* 柔和的环境极光光晕 */}
        <div
          className={cn(
            "w-4/5 h-8 rounded-full blur-xl transition-all duration-500",
            isEnergySurge ? "opacity-90 scale-125" : isHovered ? "opacity-75 scale-105" : "opacity-50 dark:opacity-40"
          )}
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(56, 189, 248, 0.65), rgba(168, 85, 247, 0.5), transparent 70%)",
          }}
        />

        {/* 垂直全息投影光束 (Volumetric Projection Beam) */}
        <div
          className="absolute bottom-2 w-28 h-20 pointer-events-none opacity-25 dark:opacity-35"
          style={{
            background:
              "linear-gradient(to top, rgba(56, 189, 248, 0.4) 0%, rgba(168, 85, 247, 0.15) 60%, transparent 100%)",
            clipPath: "polygon(20% 100%, 80% 100%, 100% 0%, 0% 0%)",
            filter: "blur(4px)",
          }}
        />

        {/* 3D 倾斜地面发射盘系统 */}
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ transform: "rotateX(75deg)" }}
        >
          {/* 外层大光环：科技虚线自转 */}
          <div
            className={cn(
              "w-32 h-32 rounded-full border border-sky-400/40 dark:border-sky-400/35 border-dashed transition-all duration-300",
              isEnergySurge && "scale-115 border-sky-300 border-solid shadow-[0_0_15px_rgba(56,189,248,0.8)]"
            )}
            style={{
              animation: isEnergySurge
                ? "spin 3s linear infinite"
                : isHovered
                ? "spin 8s linear infinite"
                : "spin 14s linear infinite",
            }}
          />

          {/* 中层光环：逆时针细密刻度 */}
          <div
            className={cn(
              "absolute w-24 h-24 rounded-full border border-purple-400/50 dark:border-purple-400/40 border-dotted transition-all duration-300",
              isEnergySurge && "border-purple-300 shadow-[0_0_12px_rgba(192,132,252,0.8)]"
            )}
            style={{
              animation: isEnergySurge
                ? "spin 2s linear infinite reverse"
                : isHovered
                ? "spin 5s linear infinite reverse"
                : "spin 9s linear infinite reverse",
            }}
          />

          {/* 内层中心微光聚焦核 */}
          <div
            className={cn(
              "absolute w-12 h-12 rounded-full bg-cyan-400/30 blur-xs transition-all duration-300",
              isEnergySurge ? "scale-150 bg-cyan-300/60" : "animate-pulse"
            )}
          />

          {/* 周期性向外扩散的全息底座脉冲波 */}
          <motion.div
            className="absolute rounded-full border border-sky-400/60 dark:border-sky-400/50"
            animate={{
              width: ["30px", "110px"],
              height: ["30px", "110px"],
              opacity: [0.8, 0],
            }}
            transition={{
              duration: 2.6,
              repeat: Infinity,
              ease: "easeOut",
            }}
          />
        </div>
      </div>

      {/* ── 2. 悬浮的 3D 全息 Logo 主体 (受鼠标倾角、呼吸与物理点击驱动) ── */}
      <motion.div
        style={{
          rotateX: interactive ? rotateX : 0,
          rotateY: interactive ? rotateY : 0,
          transformStyle: "preserve-3d",
        }}
        animate={{
          y: isPressed ? 4 : [-6, 5, -6],
          rotateZ: isPressed ? 0 : [-1.5, 1.5, -1.5],
          scale: isPressed ? 0.91 : isHovered ? 1.05 : 1,
          z: isPressed ? -25 : 0,
        }}
        transition={{
          y: isPressed
            ? { duration: 0.1, ease: "easeOut" }
            : { duration: 4.5, repeat: Infinity, ease: "easeInOut" },
          rotateZ: isPressed
            ? { duration: 0.1 }
            : { duration: 6.2, repeat: Infinity, ease: "easeInOut" },
          scale: isPressed
            ? { type: "spring", damping: 12, stiffness: 400 }
            : { type: "spring", damping: 16, stiffness: 220 },
          z: { duration: 0.1 },
        }}
        className="relative w-full h-full flex items-center justify-center"
      >
        {/* 后置全息能量星云辉光层 (景深纵深) */}
        <div
          className={cn(
            "absolute inset-2 rounded-full blur-2xl transition-all duration-500 pointer-events-none",
            isEnergySurge
              ? "opacity-95 scale-120"
              : isHovered
              ? "opacity-80 scale-105"
              : "opacity-55 dark:opacity-45"
          )}
          style={{
            background:
              "radial-gradient(circle, rgba(14, 165, 233, 0.45) 0%, rgba(217, 70, 239, 0.4) 45%, rgba(99, 102, 241, 0.25) 75%, transparent 100%)",
            transform: "translateZ(-30px)",
          }}
        />

        {/* 莫比乌斯环高精度品牌透明图形 */}
        <img
          src={isDark ? brandLogoDarkImg : brandLogoImg}
          alt="AI-Helper 3D Hologram Logo"
          width={size}
          height={size}
          draggable={false}
          className={cn(
            "relative z-10 w-full h-full object-contain transition-all duration-300",
            isEnergySurge
              ? "drop-shadow-[0_0_30px_rgba(56,189,248,0.7)]"
              : "drop-shadow-[0_12px_24px_rgba(56,189,248,0.24)] dark:drop-shadow-[0_12px_28px_rgba(168,85,247,0.38)]"
          )}
          style={{
            transform: "translateZ(20px)",
          }}
        />

        {/* ── 3. 全息动态炫彩流光与激光扫描线层 (Prismatic & Laser Scanline) ── */}
        <div
          className="absolute inset-0 z-20 pointer-events-none mix-blend-color-dodge opacity-80 dark:opacity-90 overflow-hidden"
          style={{
            transform: "translateZ(35px)",
            WebkitMaskImage: `url("${isDark ? brandLogoDarkImg : brandLogoImg}")`,
            maskImage: `url("${isDark ? brandLogoDarkImg : brandLogoImg}")`,
            WebkitMaskSize: "contain",
            maskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
          }}
        >
          {/* 棱镜光谱流光 (不断流转的 360° 全息彩虹) */}
          <div
            className="w-[200%] h-[200%] absolute -top-1/2 -left-1/2"
            style={{
              animation: isEnergySurge ? "spin 2.5s linear infinite" : "spin 6s linear infinite",
              background: `
                conic-gradient(
                  from 0deg,
                  rgba(255, 255, 255, 0) 0deg,
                  rgba(56, 189, 248, 0.5) 60deg,
                  rgba(217, 70, 239, 0.65) 120deg,
                  rgba(250, 204, 21, 0.5) 180deg,
                  rgba(45, 212, 191, 0.55) 240deg,
                  rgba(99, 102, 241, 0.65) 300deg,
                  rgba(255, 255, 255, 0) 360deg
                )
              `,
            }}
          />

          {/* 垂直激光扫描线 (Vertical Laser Scanline Beam) */}
          <motion.div
            className="absolute inset-x-0 h-4 bg-gradient-to-b from-transparent via-cyan-200/90 to-transparent pointer-events-none"
            animate={{
              top: ["-20%", "120%"],
            }}
            transition={{
              duration: 2.8,
              repeat: Infinity,
              ease: "linear",
            }}
          />

          {/* 鼠标高光镜面反射跟踪 */}
          <motion.div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: useTransform(
                [lightX, lightY],
                ([x, y]) =>
                  `radial-gradient(circle 65px at ${x} ${y}, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 80%)`
              ),
            }}
          />

          {/* 点击瞬间全息过曝闪光 (Energy Surge Flash) */}
          {isEnergySurge && (
            <motion.div
              initial={{ opacity: 0.95 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="absolute inset-0 bg-white/90"
            />
          )}
        </div>

        {/* ── 4. 空间全息量子星尘微粒 (Ambient Quantum Sparkles) ── */}
        <motion.div
          animate={{
            opacity: [0.3, 1, 0.3],
            scale: [0.8, 1.25, 0.8],
            y: [-3, 3, -3],
          }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-1 right-2 w-2 h-2 rounded-full bg-cyan-300 dark:bg-cyan-200 shadow-[0_0_8px_#38bdf8] pointer-events-none z-30"
          style={{ transform: "translateZ(42px)" }}
        />
        <motion.div
          animate={{
            opacity: [0.8, 0.2, 0.8],
            scale: [1.15, 0.75, 1.15],
            y: [3, -3, 3],
          }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
          className="absolute bottom-6 -left-1 w-1.5 h-1.5 rounded-full bg-purple-300 dark:bg-purple-200 shadow-[0_0_8px_#c084fc] pointer-events-none z-30"
          style={{ transform: "translateZ(32px)" }}
        />
        <motion.div
          animate={{
            opacity: [0.2, 0.95, 0.2],
            scale: [0.7, 1.3, 0.7],
            x: [-2, 2, -2],
          }}
          transition={{ duration: 2.9, repeat: Infinity, ease: "easeInOut", delay: 1.1 }}
          className="absolute top-9 -right-2 w-1.5 h-1.5 rounded-full bg-amber-200 shadow-[0_0_7px_#fde047] pointer-events-none z-30"
          style={{ transform: "translateZ(38px)" }}
        />
        <motion.div
          animate={{
            opacity: [0.4, 0.9, 0.4],
            scale: [0.8, 1.2, 0.8],
          }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut", delay: 0.8 }}
          className="absolute -bottom-1 right-4 w-1 h-1 rounded-full bg-sky-200 shadow-[0_0_6px_#38bdf8] pointer-events-none z-30"
          style={{ transform: "translateZ(28px)" }}
        />
      </motion.div>

      {/* ── 5. 鼠标点击：全息能量冲击波爆炸 (Holographic Shockwave Rings) ── */}
      <AnimatePresence>
        {clickWaves.map((wave) => (
          <motion.div
            key={wave.id}
            initial={{
              width: 20,
              height: 20,
              opacity: 0.95,
              scale: 0.6,
            }}
            animate={{
              width: size * 1.8,
              height: size * 1.8,
              opacity: 0,
              scale: 1,
            }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 0.75,
              ease: [0.16, 1, 0.3, 1], // 精细的指数衰减曲线
            }}
            className="absolute rounded-full pointer-events-none z-40 border-2 border-cyan-400 dark:border-cyan-300 shadow-[0_0_16px_rgba(56,189,248,0.7)]"
            style={{
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
            }}
          />
        ))}
      </AnimatePresence>

      {/* ── 6. 鼠标点击：全息光子溅射粒子群 (Quantum Particle Burst) ── */}
      <AnimatePresence>
        {clickParticles.map((particle) => {
          const targetX = Math.cos(particle.angle) * particle.distance;
          const targetY = Math.sin(particle.angle) * particle.distance;

          return (
            <motion.div
              key={particle.id}
              initial={{
                x: 0,
                y: 0,
                scale: 1,
                opacity: 1,
              }}
              animate={{
                x: targetX,
                y: targetY,
                scale: 0,
                opacity: 0,
              }}
              exit={{ opacity: 0 }}
              transition={{
                duration: 0.65,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="absolute rounded-full pointer-events-none z-40"
              style={{
                left: "50%",
                top: "50%",
                width: particle.size,
                height: particle.size,
                backgroundColor: particle.color,
                boxShadow: `0 0 8px ${particle.color}`,
              }}
            />
          );
        })}
      </AnimatePresence>
    </div>
  );
};
