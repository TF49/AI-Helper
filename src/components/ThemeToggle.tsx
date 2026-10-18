import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "./theme-provider";
import { cn } from "../lib/utils";

interface ThemeToggleProps {
  variant?: "icon" | "pills";
  className?: string;
}

export function ThemeToggle({ variant = "icon", className }: ThemeToggleProps) {
  const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();

  if (variant === "pills") {
    return (
      <div
        className={cn(
          "inline-flex gap-1 rounded-xl border p-1 bg-neutral-100 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800",
          className,
        )}
      >
        <button
          type="button"
          onClick={() => setTheme("light")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer",
            theme === "light"
              ? "bg-white text-black shadow-xs font-semibold border border-neutral-200"
              : "text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white",
          )}
        >
          <Sun size={14} />
          纯白
        </button>
        <button
          type="button"
          onClick={() => setTheme("dark")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer",
            theme === "dark"
              ? "bg-white text-black dark:bg-white dark:text-black shadow-xs font-semibold"
              : "text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white",
          )}
        >
          <Moon size={14} />
          纯黑
        </button>
        <button
          type="button"
          onClick={() => setTheme("system")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer",
            theme === "system"
              ? "bg-black text-white dark:bg-white dark:text-black shadow-xs font-semibold"
              : "text-neutral-500 hover:text-black dark:text-neutral-400 dark:hover:text-white",
          )}
        >
          <Monitor size={14} />
          系统
        </button>
      </div>
    );
  }

  // Quick icon button for titlebar
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cn(
        "w-7 h-7 flex items-center justify-center rounded-lg border transition-all cursor-pointer",
        "border-neutral-200 dark:border-white/10",
        "bg-neutral-100 hover:bg-neutral-200 text-black",
        "dark:bg-white/10 dark:hover:bg-white/20 dark:text-white",
        className,
      )}
      title={`当前为${isDark ? "纯黑模式" : "纯白模式"}，点击切换`}
    >
      {isDark ? (
        <Sun
          size={14}
          className="text-white transition-transform hover:rotate-45"
        />
      ) : (
        <Moon
          size={14}
          className="text-black transition-transform hover:-rotate-12"
        />
      )}
    </button>
  );
}

export default ThemeToggle;
