import * as React from "react";
import { cn } from "../../lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  inputSize?: "sm" | "md" | "lg";
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, inputSize = "md", ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        className={cn(
          "flex w-full rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/5 px-3 text-slate-900 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-gray-500 transition-all",
          "focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 focus:bg-white dark:focus:bg-[#161a2e]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          {
            "h-8 text-xs px-2.5": inputSize === "sm",
            "h-9 text-xs": inputSize === "md",
            "h-11 text-sm": inputSize === "lg",
          },
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
