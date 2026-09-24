import React from "react";

export interface AuroraBackgroundProps {
  theme?: "chatgpt" | "claude";
  className?: string;
  children?: React.ReactNode;
}

export const AuroraBackground: React.FC<AuroraBackgroundProps> = ({
  theme = "chatgpt",
  className = "",
  children,
}) => {
  const isChatGPT = theme === "chatgpt";

  return (
    <div
      className={`relative flex-1 flex flex-col overflow-hidden transition-colors duration-300 bg-[#f8fafc] dark:bg-[#090a0f] ${className}`}
    >
      {/* 极光发光光晕层 */}
      <div
        className="pointer-events-none absolute -top-[20%] -left-[10%] w-[75vw] h-[50vh] rounded-full blur-[110px] opacity-35 dark:opacity-25 transition-all duration-700 ease-in-out"
        style={{
          background: isChatGPT
            ? "radial-gradient(circle, #38bdf8 0%, #60a5fa 40%, transparent 70%)"
            : "radial-gradient(circle, #fbbf24 0%, #f472b6 40%, transparent 70%)",
        }}
      />
      <div
        className="pointer-events-none absolute -bottom-[20%] -right-[10%] w-[65vw] h-[50vh] rounded-full blur-[120px] opacity-30 dark:opacity-20 transition-all duration-700 ease-in-out"
        style={{
          background: isChatGPT
            ? "radial-gradient(circle, #34d399 0%, #3b82f6 50%, transparent 70%)"
            : "radial-gradient(circle, #c084fc 0%, #fb7185 50%, transparent 70%)",
        }}
      />

      {/* 细腻点阵网格 */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.035] dark:opacity-[0.04]"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)`,
          backgroundSize: "24px 24px",
        }}
      />

      {/* 前景内容 */}
      <div className="flex-1 flex flex-col relative z-10">
        {children}
      </div>
    </div>
  );
};

export default AuroraBackground;
