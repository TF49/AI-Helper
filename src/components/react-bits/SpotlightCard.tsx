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
        "relative rounded-2xl border border-neutral-200/80 dark:border-neutral-800/80 bg-white dark:bg-[#0a0a0a] shadow-2xs dark:shadow-none overflow-hidden transition-colors duration-200 text-neutral-900 dark:text-neutral-100 hover:border-neutral-300 dark:hover:border-neutral-700",
        className,
      )}
    >
      {children}
    </div>
  );
};

export default SpotlightCard;
