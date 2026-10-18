import { Check, Pencil, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/utils";
import { SpotlightCard } from "./react-bits/SpotlightCard";

export type ConfirmAccent = string;

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
  accentColor?: string;
  spotlightColor?: string;
  totalSteps: number;
}

const MONO_ACCENT = {
  icon: "text-neutral-700 dark:text-neutral-300",
  value: "text-black dark:text-white",
  checkbox:
    "text-black focus:ring-black border-neutral-300 dark:border-neutral-700 dark:bg-black",
  box: "bg-neutral-50/80 dark:bg-neutral-900/60 border-neutral-200 dark:border-neutral-800",
  edit: "text-neutral-600 dark:text-neutral-400 hover:text-black dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800",
  badge:
    "bg-neutral-100 text-neutral-800 border-neutral-200 dark:bg-neutral-900 dark:text-neutral-200 dark:border-neutral-800",
};

export function ConfigConfirmStep({
  items,
  confirmed,
  onConfirmedChange,
  onEditStep,
  spotlightColor,
  totalSteps,
}: ConfigConfirmStepProps) {
  const c = MONO_ACCENT;

  return (
    <SpotlightCard
      className="p-5 rounded-2xl border border-neutral-200/90 dark:border-neutral-800 bg-white dark:bg-[#0a0a0a] shadow-xs"
      spotlightColor={spotlightColor}
    >
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-neutral-100 dark:border-neutral-900">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className={c.icon} />
          <span className="text-sm font-semibold text-black dark:text-white">
            确认配置
          </span>
        </div>
        <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
          第 {totalSteps} 步 / 共 {totalSteps} 步
        </span>
      </div>

      <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-3 leading-relaxed">
        请核对前面各步已选择的配置。勾选确认后，才能进入保存与连通性测试。
      </p>

      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div
            key={`${item.stepIndex}-${item.label}`}
            className="flex items-start gap-3 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-900/40 border border-neutral-200/80 dark:border-neutral-800"
          >
            <div className={cn("mt-0.5 shrink-0", c.icon)}>{item.icon}</div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-neutral-400 dark:text-neutral-500 mb-0.5">
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
                    : "text-neutral-400 dark:text-neutral-500 font-normal",
                )}
                title={item.detail || item.value}
              >
                {item.value || "未配置"}
              </div>
              {item.detail && item.detail !== item.value ? (
                <div
                  className="text-[10px] font-mono text-neutral-400 dark:text-neutral-500 truncate mt-0.5"
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
        <span className="text-xs text-neutral-700 dark:text-neutral-200 leading-relaxed">
          我已核对以上配置，确认无误，可以进入保存与连通性测试。
        </span>
      </label>

      {confirmed ? (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
          <Check size={12} strokeWidth={3} />
          <span>已确认，可继续下一步</span>
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-neutral-400 dark:text-neutral-500">
          勾选确认后，底部按钮才会进入保存与测试环节。
        </p>
      )}
    </SpotlightCard>
  );
}

export default ConfigConfirmStep;
