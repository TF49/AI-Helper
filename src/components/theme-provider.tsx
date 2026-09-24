import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type Theme = "light" | "dark" | "system";

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeProviderContext = createContext<ThemeContextValue | undefined>(
  undefined,
);

export function ThemeProvider({
  children,
  defaultTheme = "light",
  storageKey = "ai-helper-theme",
}: ThemeProviderProps) {
  const getInitialTheme = (): Theme => {
    if (typeof window === "undefined") {
      return defaultTheme;
    }

    const stored = (window.localStorage.getItem(storageKey) ||
      (storageKey === "ai-helper-theme"
        ? window.localStorage.getItem("bobapi-theme")
        : null)) as Theme | null;
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }

    return defaultTheme;
  };

  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined")
      return defaultTheme === "dark" ? "dark" : "light";
    const init = getInitialTheme();
    if (init === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    return init;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, theme);
  }, [theme, storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const root = window.document.documentElement;
    const isDark =
      theme === "dark" ||
      (theme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);

    root.classList.remove("light", "dark");
    root.classList.add(isDark ? "dark" : "light");
    setResolvedTheme(isDark ? "dark" : "light");
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (theme !== "system") return;
      const root = window.document.documentElement;
      const isDark = mediaQuery.matches;
      root.classList.remove("light", "dark");
      root.classList.add(isDark ? "dark" : "light");
      setResolvedTheme(isDark ? "dark" : "light");
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme: (nextTheme: Theme) => {
        setThemeState(nextTheme);
      },
      toggleTheme: () => {
        setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
      },
    }),
    [theme, resolvedTheme],
  );

  return (
    <ThemeProviderContext.Provider value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) {
    // 优雅降级：如果未在 ThemeProvider 内，从 DOM 或 localStorage 获取，避免崩溃
    const isDark =
      typeof window !== "undefined" &&
      (document.documentElement.classList.contains("dark") ||
        window.localStorage.getItem("ai-helper-theme") === "dark" ||
        window.localStorage.getItem("bobapi-theme") === "dark");
    return {
      theme: (isDark ? "dark" : "light") as Theme,
      resolvedTheme: (isDark ? "dark" : "light") as "light" | "dark",
      setTheme: (t: Theme) => {
        if (typeof window === "undefined") return;
        window.localStorage.setItem("ai-helper-theme", t);
        const dark =
          t === "dark" ||
          (t === "system" &&
            window.matchMedia("(prefers-color-scheme: dark)").matches);
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.classList.toggle("light", !dark);
      },
      toggleTheme: () => {
        if (typeof window === "undefined") return;
        const currentDark = document.documentElement.classList.contains("dark");
        const next = currentDark ? "light" : "dark";
        window.localStorage.setItem("ai-helper-theme", next);
        document.documentElement.classList.toggle("dark", !currentDark);
        document.documentElement.classList.toggle("light", currentDark);
      },
    };
  }
  return context;
}
