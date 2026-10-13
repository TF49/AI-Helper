import { Check, Pencil, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/utils";
import { SpotlightCard } from "./react-bits/SpotlightCard";

export type ConfirmAccent = "blue" | "purple" | "emerald" | "orange";

export interface ConfigConfirmItem {
  label: string;
  value: string;
  detail?: string;
  /** 标题旁可选标签，如 API Key 所属分组 */
  badge?: string;
  icon: ReactNode;
  stepIndex: number;
}

interface ConfigConfirmStepProps {
  items: ConfigConfirmItem[];
  confirmed: boolean;
  onConfirmedChange: (next: boolean) => void;
  onEditStep: (stepIndex: number) => void;
  accentColor: ConfirmAccent;
  spotlightColor: string;
  totalSteps: number;
}

const ACCENT: Record<
  ConfirmAccent,
  {
    icon: string;
    value: string;
    checkbox: string;
    box: string;
    edit: string;
    badge: string;
  }
> = {
  blue: {
    icon: "text-blue-500",
    value: "text-blue-600 dark:text-blue-400",
    checkbox:
      "text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-white/20 dark:bg-white/5",
    box: "bg-blue-50/70 dark:bg-blue-500/10 border-blue-200/70 dark:border-blue-500/20",
    edit: "text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10",
    badge:
      "bg-blue-50 text-blue-600 border-blue-200/80 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/25",
  },
  purple: {
    icon: "text-purple-500",
    value: "text-purple-600 dark:text-purple-400",
    checkbox:
      "text-purple-600 focus:ring-purple-500 border-slate-300 dark:border-white/20 dark:bg-white/5",
    box: "bg-purple-50/70 dark:bg-purple-500/10 border-purple-200/70 dark:border-purple-500/20",
    edit: "text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-500/10",
    badge:
      "bg-purple-50 text-purple-600 border-purple-200/80 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/25",
  },
  emerald: {
    icon: "text-emerald-500",
    value: "text-emerald-600 dark:text-emerald-400",
    checkbox:
      "text-emerald-600 focus:ring-emerald-500 border-slate-300 dark:border-white/20 dark:bg-white/5",
    box: "bg-emerald-50/70 dark:bg-emerald-500/10 border-emerald-200/70 dark:border-emerald-500/20",
    edit: "text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10",
    badge:
      "bg-emerald-50 text-emerald-600 border-emerald-200/80 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/25",
  },
  orange: {
    icon: "text-orange-500",
    value: "text-orange-600 dark:text-orange-400",
    checkbox:
      "text-orange-600 focus:ring-orange-500 border-slate-300 dark:border-white/20 dark:bg-white/5",
    box: "bg-orange-50/70 dark:bg-orange-500/10 border-orange-200/70 dark:border-orange-500/20",
    edit: "text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-500/10",
    badge:
      "bg-orange-50 text-orange-600 border-orange-200/80 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/25",
  },
};

export function ConfigConfirmStep({
  items,
  confirmed,
  onConfirmedChange,
  onEditStep,
  accentColor,
  spotlightColor,
  totalSteps,
}: ConfigConfirmStepProps) {
  const c = ACCENT[accentColor];

  return (
    <SpotlightCard
      className="p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-[#161324]/60 shadow-sm"
      spotlightColor={spotlightColor}
    >
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-white/5">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className={c.icon} />
          <span className="text-sm font-semibold text-slate-900 dark:text-white">
            确认配置
          </span>
        </div>
        <span className="text-[11px] text-slate-400 dark:text-gray-500">
          第 {totalSteps} 步 / 共 {totalSteps} 步
        </span>
      </div>

      <p className="text-xs text-slate-500 dark:text-gray-400 mb-3 leading-relaxed">
        请核对前面各步已选择的配置。勾选确认后，才能进入保存与连通性测试。
      </p>

      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div
            key={`${item.stepIndex}-${item.label}`}
            className="flex items-start gap-3 p-3 rounded-xl bg-slate-50/80 dark:bg-white/[0.02] border border-slate-200/60 dark:border-white/5"
          >
            <div className={cn("mt-0.5 shrink-0", c.icon)}>{item.icon}</div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-slate-400 dark:text-gray-500 mb-0.5">
                第 {item.stepIndex + 1} 步 · {item.label}
              </div>
              {item.badge ? (
                <div className="mb-1 min-w-0">
                  <span
                    className={cn(
                      "inline-block max-w-full px-1.5 py-0.5 rounded-md border text-[10px] font-medium leading-snug break-words",
                      c.badge,
                    )}
                    title={`所属分组：${item.badge}`}
                  >
                    {item.badge}
                  </span>
                </div>
              ) : null}
              <div
                className={cn(
                  "text-xs font-mono truncate",
                  item.value && item.value !== "未配置"
                    ? cn("font-medium", c.value)
                    : "text-slate-400 dark:text-gray-500 font-normal",
                )}
                title={item.detail || item.value}
              >
                {item.value || "未配置"}
              </div>
              {item.detail && item.detail !== item.value ? (
                <div
                  className="text-[10px] font-mono text-slate-400 dark:text-gray-500 truncate mt-0.5"
                  title={item.detail}
                >
                  {item.detail}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => onEditStep(item.stepIndex)}
              className={cn(
                "shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer",
                c.edit,
              )}
              title={`返回第 ${item.stepIndex + 1} 步修改`}
            >
              <Pencil size={11} />
              <span>修改</span>
            </button>
          </div>
        ))}
      </div>

      <label
        className={cn(
          "mt-4 flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors",
          c.box,
        )}
      >
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirmedChange(e.target.checked)}
          className={cn("mt-0.5 w-3.5 h-3.5 rounded shrink-0", c.checkbox)}
        />
        <span className="text-xs text-slate-700 dark:text-gray-200 leading-relaxed">
          我已核对以上配置，确认无误，可以进入保存与连通性测试。
        </span>
      </label>

      {confirmed ? (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
          <Check size={12} strokeWidth={3} />
          <span>已确认，可继续下一步</span>
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-slate-400 dark:text-gray-500">
          勾选确认后，底部按钮才会进入保存与测试环节。
        </p>
      )}
    </SpotlightCard>
  );
}

export default ConfigConfirmStep;
