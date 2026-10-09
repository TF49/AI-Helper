import React from "react";

export interface StarBorderProps {
  as?: React.ElementType;
  className?: string;
  innerClassName?: string;
  children?: React.ReactNode;
  color?: string;
  speed?: string;
  thickness?: number;
  backgroundColor?: string;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
}

export const StarBorder: React.FC<StarBorderProps> = ({
  as: Component = "button",
  className = "",
  innerClassName = "",
  color = "#3b82f6",
  speed = "4s",
  thickness = 1,
  backgroundColor,
  disabled = false,
  children,
  onClick,
  type = "button",
  ...rest
}) => {
  return (
    <Component
      type={Component === "button" ? type : undefined}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className={`relative inline-flex items-center justify-center overflow-hidden rounded-xl group transition-all duration-200 active:scale-[0.98] ${
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "cursor-pointer hover:shadow-lg"
      } ${className}`}
      style={{
        padding: `${thickness}px`,
      }}
      {...rest}
    >


      {/* 内部按钮实体容器 */}
      <div
        className={`relative z-10 w-full h-full flex items-center justify-center rounded-[11px] px-4 py-2.5 font-medium text-sm transition-colors ${
          !backgroundColor
            ? "bg-blue-600 text-white hover:bg-blue-700 dark:bg-[#0e1726] dark:text-blue-100"
            : ""
        } ${innerClassName}`}
        style={backgroundColor ? { background: backgroundColor } : undefined}
      >
        {children}
      </div>
    </Component>
  );
};

export default StarBorder;
