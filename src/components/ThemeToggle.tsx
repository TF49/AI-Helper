import { useCallback, useMemo } from "react";
import { cn } from "../lib/utils";
import { PixelToggle } from "./pixel-toggle/PixelToggle";
import type { PixelToggleOptions } from "./pixel-toggle/PixelToggleEngine.js";
import { useTheme } from "./theme-provider";

interface ThemeToggleProps {
  className?: string;
}

/** 标题栏浅色/深色切换开关；「跟随系统」在设置页 → 外观中配置。 */
export function ThemeToggle({ className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const handleThemeChange = useCallback(
    (isDay: boolean) => setTheme(isDay ? "light" : "dark"),
    [setTheme],
  );
  const options = useMemo<PixelToggleOptions>(
    () => ({
      checked: resolvedTheme === "light",
      sound: false,
      onCheckedChange: handleThemeChange,
    }),
    [handleThemeChange, resolvedTheme],
  );

  return (
    <PixelToggle
      options={options}
      className={cn("theme-toggle-canvas", className)}
    />
  );
}

export default ThemeToggle;
