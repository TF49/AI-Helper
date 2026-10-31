import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/50 select-none",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-blue-600 text-white shadow-xs hover:bg-blue-700",
        secondary:
          "border-transparent bg-slate-100 text-slate-800 dark:bg-white/10 dark:text-gray-200",
        destructive:
          "border-transparent bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20",
        outline:
          "border-slate-200 dark:border-white/10 text-slate-700 dark:text-gray-300",
        success:
          "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        error:
          "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400",
        warning:
          "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
