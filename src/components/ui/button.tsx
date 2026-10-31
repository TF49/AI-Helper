import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer active:scale-[0.98]",
  {
    variants: {
      variant: {
        default:
          "bg-blue-600 text-white shadow-sm hover:bg-blue-500 active:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500",
        destructive:
          "bg-red-500 text-white shadow-sm hover:bg-red-600 active:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500",
        outline:
          "border border-slate-200 bg-white/80 text-slate-700 shadow-2xs hover:bg-slate-100 hover:text-slate-900 dark:border-white/10 dark:bg-[#141724]/60 dark:text-gray-300 dark:hover:bg-white/10 dark:hover:text-white",
        secondary:
          "bg-slate-100 text-slate-900 hover:bg-slate-200/80 dark:bg-white/10 dark:text-gray-100 dark:hover:bg-white/15",
        ghost:
          "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-100",
        link: "text-blue-600 underline-offset-4 hover:underline dark:text-blue-400",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        md: "h-10 px-4 text-sm",
        lg: "h-11 rounded-xl px-6 text-base",
        icon: "h-9 w-9 p-0",
        "icon-sm": "h-8 w-8 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin text-current" />}
        {children}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
