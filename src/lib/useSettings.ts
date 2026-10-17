import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { getAutoStartStatus, setAutoStartStatus, isTauri } from "./api";
import type { AppSettings } from "../types";

const STORAGE_KEY = "ai_helper_app_settings";

const defaultSettings: AppSettings = {
  autoStart: false,
  minimizeToTray: true,
  startupPage: "workspace",
  showAnnouncementModal: true,
  language: "zh-CN",
  enableAurora: true,
};

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.startupPage === "models" || parsed.startupPage === "keys") {
          parsed.startupPage = "workspace";
        }
        return { ...defaultSettings, ...parsed };
      }
    } catch (e) {
      console.warn("Failed to load settings from localStorage:", e);
    }
    return defaultSettings;
  });

  const [loadingAutoStart, setLoadingAutoStart] = useState(false);

  // 初始化时从系统读取真实的开机自启状态
  useEffect(() => {
    let cancelled = false;
    const fetchAutoStart = async () => {
      if (!isTauri) return;
      try {
        setLoadingAutoStart(true);
        const enabled = await getAutoStartStatus();
        if (!cancelled) {
          setSettings((prev) => {
            if (prev.autoStart !== enabled) {
              const updated = { ...prev, autoStart: enabled };
              localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
              return updated;
            }
            return prev;
          });
        }
      } catch (err) {
        console.warn("Failed to check autostart status:", err);
      } finally {
        if (!cancelled) setLoadingAutoStart(false);
      }
    };

    void fetchAutoStart();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSetting = useCallback(
    async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      if (key === "autoStart") {
        const boolVal = Boolean(value);
        try {
          setLoadingAutoStart(true);
          await setAutoStartStatus(boolVal);
          setSettings((prev) => {
            const next = { ...prev, autoStart: boolVal };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            return next;
          });
          toast.success(
            boolVal
              ? "已开启开机自动启动，系统登录后将自动运行 AI Helper"
              : "已取消开机自动启动",
          );
        } catch (err) {
          console.error("Failed to set autostart:", err);
          toast.error(`设置开机自启动失败: ${err}`);
        } finally {
          setLoadingAutoStart(false);
        }
        return;
      }

      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [],
  );

  return {
    settings,
    loadingAutoStart,
    updateSetting,
  };
}
