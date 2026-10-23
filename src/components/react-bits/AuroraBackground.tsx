import React from "react";

export interface AuroraBackgroundProps {
  theme?: "chatgpt" | "claude" | "workbuddy" | "acciowork" | "cursor";
  className?: string;
  children?: React.ReactNode;
}

export const AuroraBackground: React.FC<AuroraBackgroundProps> = ({
  className = "",
  children,
}) => {
  return (
    <div
      className={`relative flex-1 h-full min-h-0 flex flex-col overflow-hidden transition-colors duration-300 bg-white dark:bg-black ${className}`}
    >
      {/* 细腻极简点阵网格 */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03] dark:opacity-[0.04]"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)`,
          backgroundSize: "24px 24px",
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
