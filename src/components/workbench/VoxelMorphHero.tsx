import React, { useState, useCallback, useEffect } from "react";
import {
  VoxelMorphScene,
  VOXEL_MODELS,
  type ModelInfo,
} from "../three/VoxelMorphScene";
import { HolographicBrandLogo } from "../react-bits/HolographicBrandLogo";
import { cn } from "@/lib/utils";

interface VoxelMorphHeroProps {
  className?: string;
}

// 检测当前环境 WebGL 支持情况
function isWebGLSupported(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

export const VoxelMorphHero: React.FC<VoxelMorphHeroProps> = ({
  className = "",
}) => {
  const [activeModel, setActiveModel] = useState<ModelInfo>(VOXEL_MODELS[0]);
  const [hasWebGL, setHasWebGL] = useState(true);

  useEffect(() => {
    setHasWebGL(isWebGLSupported());
  }, []);

  const handleModelChange = useCallback((_index: number, model: ModelInfo) => {
    setActiveModel(model);
  }, []);

  return (
    <div className={cn("relative flex flex-col items-start select-none w-full", className)}>
      {/* ── 3D 全息体素交互舞台：加大视口高度与相机近景比例，饱满呈现细节 ── */}
      <div className="relative w-full h-[215px] sm:h-[235px] xl:h-[255px] [@media(max-height:640px)]:h-[150px] flex items-center justify-center overflow-visible">
        {/* 背景氛围柔光场（自适应明暗模式） */}
        <div
          className="absolute inset-0 pointer-events-none flex items-center justify-center"
          aria-hidden="true"
        >
          {/* 核心径向渐变辉光 */}
          <div className="w-[88%] h-[84%] rounded-full bg-gradient-to-tr from-blue-500/12 via-indigo-500/10 to-cyan-400/12 dark:from-sky-500/18 dark:via-purple-600/18 dark:to-cyan-400/14 blur-3xl" />

          {/* 3D 底座投影光环 (Cybernetic base) */}
          <div
            className="absolute bottom-1 w-56 h-12 pointer-events-none opacity-45 dark:opacity-65"
            style={{
              background:
                "radial-gradient(ellipse at center, rgba(56, 189, 248, 0.45) 0%, rgba(124, 58, 237, 0.2) 50%, transparent 75%)",
              transform: "rotateX(65deg)",
            }}
          />
        </div>

        {/* 核心 3D WebGL 体素多形态自动平滑相变画布 */}
        {hasWebGL ? (
          <div className="relative w-full h-full z-10">
            <VoxelMorphScene
              className="w-full h-full"
              onModelChange={handleModelChange}
            />
          </div>
        ) : (
          <div className="relative z-10 py-2">
            <HolographicBrandLogo size={142} />
          </div>
        )}
      </div>

      {/* ── 底部状态微胶囊：与当前自动相变模型动态联动，无多余按钮干扰 ── */}
      <div className="flex items-center gap-2 pt-1 z-20">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-50 dark:bg-sky-500/10 border border-sky-200/60 dark:border-sky-400/20 text-[10px] font-semibold text-sky-700 dark:text-sky-300 transition-colors">
          <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
          <span>AI-Helper Engine Ready</span>
        </div>
        <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate transition-opacity duration-300">
          · {activeModel.name}
        </span>
      </div>
    </div>
  );
};
