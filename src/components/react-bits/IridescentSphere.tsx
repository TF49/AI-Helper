import React, { useRef } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import sphereImg from "@/assets/iridescent-sphere.png";
import { cn } from "@/lib/utils";

interface IridescentSphereProps {
  size?: number;
  className?: string;
}

/**
 * 3D 梦幻全息彩虹流光泡泡/球体组件 (像素级复刻参考设计图)
 * - 柔和的粉/青/紫全息流光与半透明珍珠球体质感
 * - 细腻的微浮动呼吸动画
 * - 3D 鼠标微视差高光随动
 */
export const IridescentSphere: React.FC<IridescentSphereProps> = ({
  size = 115,
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // 鼠标交互微视差
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const springConfig = { damping: 25, stiffness: 200, mass: 0.5 };
  const rotateX = useSpring(useTransform(mouseY, [-0.5, 0.5], [10, -10]), springConfig);
  const rotateY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-12, 12]), springConfig);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    mouseX.set(x);
    mouseY.set(y);
  };

  const handleMouseLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
  };

  return (
    <motion.div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      animate={{ y: [-3, 3, -3] }}
      transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
      style={{
        width: size,
        height: size,
        perspective: 800,
      }}
      className={cn(
        "relative flex items-center justify-center select-none cursor-pointer group",
        className
      )}
    >
      {/* 底部与后方漫反射彩色微光晕 */}
      <div
        className="pointer-events-none absolute inset-0 rounded-full blur-2xl opacity-60 dark:opacity-40 transition-opacity duration-700"
        style={{
          background:
            "radial-gradient(circle at 40% 40%, rgba(244, 180, 218, 0.6), rgba(165, 222, 248, 0.5) 45%, rgba(196, 181, 253, 0.4) 70%, transparent 80%)",
        }}
      />

      {/* 3D 旋转球体主体 */}
      <motion.div
        style={{
          rotateX,
          rotateY,
          transformStyle: "preserve-3d",
        }}
        className="relative w-full h-full rounded-full flex items-center justify-center transition-transform duration-300 group-hover:scale-105"
      >
        <img
          src={sphereImg}
          alt="AI Agent Sphere"
          width={size}
          height={size}
          className="w-full h-full object-contain pointer-events-none drop-shadow-[0_8px_24px_rgba(168,85,247,0.18)]"
          draggable={false}
        />

        {/* 悬浮微反光薄膜 */}
        <div className="absolute inset-0 rounded-full pointer-events-none ring-1 ring-white/40 dark:ring-white/20 shadow-[inset_0_2px_8px_rgba(255,255,255,0.7)]" />
      </motion.div>
    </motion.div>
  );
};

export default IridescentSphere;
