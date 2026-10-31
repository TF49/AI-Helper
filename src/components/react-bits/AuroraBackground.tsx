import React from "react";

export interface AuroraBackgroundProps {
  theme?: "chatgpt" | "claude" | "workbuddy" | "acciowork" | "cursor";
  className?: string;
  children?: React.ReactNode;
}

/**
 * 全局现代微质感极光/弥散网格背景 (复刻参考图)
 * - 浅色模式为极高通透度的冰川蓝与淡天青渐变
 * - 深色模式为沉浸式曜石暗夜渐变
 * - 包含两组非侵入式柔和环境光晕
 */
export const AuroraBackground: React.FC<AuroraBackgroundProps> = ({
  className = "",
  children,
}) => {
  return (
    <div
      className={`relative flex-1 h-full min-h-0 flex flex-col overflow-hidden transition-colors duration-500 bg-gradient-to-br from-[#f1f5fa] via-[#edf3f8] to-[#e7eef6] dark:from-[#0b0f19] dark:via-[#0c101a] dark:to-[#070a10] ${className}`}
    >
      {/* ── 顶部环境漫反射微光晕 ── */}
      <div className="pointer-events-none absolute -top-40 -left-40 w-[550px] h-[550px] rounded-full bg-sky-200/40 dark:bg-sky-500/10 blur-[120px] transition-opacity duration-700" />
      <div className="pointer-events-none absolute top-1/3 left-1/4 w-[480px] h-[480px] rounded-full bg-indigo-200/30 dark:bg-purple-500/10 blur-[130px] transition-opacity duration-700" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 w-[600px] h-[600px] rounded-full bg-blue-100/40 dark:bg-blue-600/10 blur-[140px] transition-opacity duration-700" />

      {/* 细腻极简点阵网格 */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025] dark:opacity-[0.04]"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)`,
          backgroundSize: "28px 28px",
        }}
      />

      {/* 前景内容 */}
      <div className="flex-1 min-h-0 h-full flex flex-col relative z-10">
        {children}
      </div>
    </div>
  );
};

export default AuroraBackground;
