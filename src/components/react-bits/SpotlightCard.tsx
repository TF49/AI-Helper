import React from "react";
import { cn } from "../../lib/utils";

export interface SpotlightCardProps extends React.PropsWithChildren {
  className?: string;
  spotlightColor?: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

export const SpotlightCard: React.FC<SpotlightCardProps> = ({
  children,
  className = "",
  onClick,
}) => {
  return (
    <div
      onClick={onClick}
      className={cn(
        "relative rounded-2xl border border-slate-200/80 dark:border-white/10 bg-white/85 dark:bg-[#121524]/65 backdrop-blur-md shadow-sm dark:shadow-none overflow-hidden transition-colors duration-200 text-slate-800 dark:text-gray-200 hover:border-slate-300 dark:hover:border-white/20",
        className,
      )}
    >
      {children}
    </div>
  );
};

export default SpotlightCard;
