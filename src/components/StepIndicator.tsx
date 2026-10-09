import { Check } from "lucide-react";
import React from "react";
import { cn } from "../lib/utils";

export interface StepDef {
  /** 步骤标题（显示在圆圈下方） */
  label: string;
  /** 步骤完成后在标题下方展示的摘要文字（简短，如 "bob-api.com"） */
  summary?: string;
}

interface StepIndicatorProps {
  steps: StepDef[];
  /** 当前激活步骤索引，0-based */
  currentStep: number;
  /** 点击已到达/已完成步骤时触发 */
  onStepClick: (index: number) => void;
  accentColor?: "blue" | "purple" | "emerald" | "orange";
  /** 允许点击跳转的最大步骤索引，默认等于 currentStep */
  maxStepReached?: number;
}

const COLORS: Record<
  string,
  {
    filled: string;
    ring: string;
    connector: string;
    activeLabel: string;
    doneLabel: string;
    doneSummary: string;
  }
> = {
  blue: {
    filled:
      "bg-blue-600 border-blue-600 text-white dark:bg-blue-500 dark:border-blue-500",
    ring: "ring-2 ring-blue-500/30 ring-offset-1 ring-offset-white dark:ring-offset-transparent",
    connector: "bg-blue-500 dark:bg-blue-400",
    activeLabel: "text-slate-900 dark:text-white font-semibold",
    doneLabel: "text-slate-700 dark:text-gray-200",
    doneSummary: "text-blue-600 dark:text-blue-400 font-medium",
  },
  purple: {
    filled:
      "bg-purple-600 border-purple-600 text-white dark:bg-purple-500 dark:border-purple-500",
    ring: "ring-2 ring-purple-500/30 ring-offset-1 ring-offset-white dark:ring-offset-transparent",
    connector: "bg-purple-500 dark:bg-purple-400",
    activeLabel: "text-slate-900 dark:text-white font-semibold",
    doneLabel: "text-slate-700 dark:text-gray-200",
    doneSummary: "text-purple-600 dark:text-purple-400 font-medium",
  },
  emerald: {
    filled:
      "bg-emerald-600 border-emerald-600 text-white dark:bg-emerald-500 dark:border-emerald-500",
    ring: "ring-2 ring-emerald-500/30 ring-offset-1 ring-offset-white dark:ring-offset-transparent",
    connector: "bg-emerald-500 dark:bg-emerald-400",
    activeLabel: "text-slate-900 dark:text-white font-semibold",
    doneLabel: "text-slate-700 dark:text-gray-200",
    doneSummary: "text-emerald-600 dark:text-emerald-400 font-medium",
  },
  orange: {
    filled:
      "bg-orange-600 border-orange-600 text-white dark:bg-orange-500 dark:border-orange-500",
    ring: "ring-2 ring-orange-500/30 ring-offset-1 ring-offset-white dark:ring-offset-transparent",
    connector: "bg-orange-500 dark:bg-orange-400",
    activeLabel: "text-slate-900 dark:text-white font-semibold",
    doneLabel: "text-slate-700 dark:text-gray-200",
    doneSummary: "text-orange-600 dark:text-orange-400 font-medium",
  },
};

export function StepIndicator({
  steps,
  currentStep,
  onStepClick,
  accentColor = "blue",
  maxStepReached,
}: StepIndicatorProps) {
  const c = COLORS[accentColor];
  const effectiveMax =
    maxStepReached !== undefined ? maxStepReached : currentStep;

  return (
    <div className="flex items-start w-full">
      {steps.map((step, i) => {
        const isActive = i === currentStep;
        const isDone = i < currentStep;
        const canClick = (i <= effectiveMax || isDone) && !isActive;
        const isConnectorFilled = i < currentStep || i < effectiveMax;

        return (
          <React.Fragment key={i}>
            {/* ── 步骤节点 ── */}
            <div className="flex flex-col items-center flex-shrink-0 w-[72px] sm:w-[84px]">
              <button
                type="button"
                onClick={() => canClick && onStepClick(i)}
                disabled={!canClick}
                title={
                  canClick
                    ? `跳转至第 ${i + 1} 步: ${step.label}`
                    : isActive
                      ? `当前步骤: ${step.label}`
                      : undefined
                }
                className={cn(
                  "w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all duration-200 select-none",
                  isDone &&
                    cn(
                      c.filled,
                      "cursor-pointer hover:scale-110 hover:shadow-sm",
                    ),
                  isActive && cn(c.filled, c.ring, "scale-110 cursor-default"),
                  !isDone &&
                    !isActive &&
                    canClick &&
                    "border-slate-400 dark:border-white/40 text-slate-700 dark:text-gray-200 cursor-pointer hover:scale-105 hover:border-slate-600 bg-white dark:bg-white/5",
                  !isDone &&
                    !isActive &&
                    !canClick &&
                    "border-slate-200 dark:border-white/10 text-slate-300 dark:text-gray-600 cursor-default bg-slate-50 dark:bg-transparent",
                )}
              >
                {isDone ? (
                  <Check size={12} strokeWidth={3} />
                ) : (
                  <span>{i + 1}</span>
                )}
              </button>

              {/* 步骤文字区域 */}
              <div className="mt-1.5 text-center w-full px-0.5">
                <button
                  type="button"
                  onClick={() => canClick && onStepClick(i)}
                  disabled={!canClick}
                  className={cn(
                    "text-[11px] leading-tight w-full text-center transition-colors truncate block",
                    isActive && c.activeLabel,
                    canClick &&
                      cn(
                        c.doneLabel,
                        "cursor-pointer hover:underline underline-offset-2 font-medium",
                      ),
                    !canClick &&
                      !isActive &&
                      "text-slate-400 dark:text-gray-500 cursor-default",
                  )}
                  title={step.label}
                >
                  {step.label}
                </button>

                {/* 显示微摘要 */}
                {(isDone || canClick) && step.summary && (
                  <div
                    className={cn(
                      "text-[10px] font-mono truncate mt-0.5 max-w-full px-0.5",
                      c.doneSummary,
                    )}
                    title={step.summary}
                  >
                    {step.summary}
                  </div>
                )}
              </div>
            </div>

            {/* ── 连接线（最后一步后不渲染） ── */}
            {i < steps.length - 1 && (
              <div className="flex-1 mt-[13px] mx-1 relative h-[2px]">
                {/* 灰色底轨 */}
                <div className="absolute inset-0 bg-slate-200 dark:bg-white/10 rounded-full" />
                {/* 彩色填充 */}
                <div
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full transition-all duration-500",
                    c.connector,
                  )}
                  style={{ width: isConnectorFilled ? "100%" : "0%" }}
                />
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default StepIndicator;
