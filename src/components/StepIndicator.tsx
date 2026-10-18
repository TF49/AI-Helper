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
  accentColor?: string;
  /** 允许点击跳转的最大步骤索引，默认等于 currentStep */
  maxStepReached?: number;
}

const MONO_STYLE = {
  filled:
    "bg-black border-black text-white dark:bg-white dark:border-white dark:text-black",
  ring: "ring-2 ring-black/20 ring-offset-1 ring-offset-white dark:ring-white/30 dark:ring-offset-black",
  connector: "bg-black dark:bg-white",
  activeLabel: "text-black dark:text-white font-semibold",
  doneLabel: "text-neutral-700 dark:text-neutral-300",
  doneSummary: "text-neutral-900 dark:text-neutral-200 font-medium",
};

export function StepIndicator({
  steps,
  currentStep,
  onStepClick,
  maxStepReached,
}: StepIndicatorProps) {
  const c = MONO_STYLE;
  const effectiveMax =
    maxStepReached !== undefined ? maxStepReached : currentStep;

  return (
    <div className="flex items-start w-full overflow-x-auto">
      {steps.map((step, i) => {
        const isActive = i === currentStep;
        const isDone = i < currentStep;
        const canClick = (i <= effectiveMax || isDone) && !isActive;
        const isConnectorFilled = i < currentStep || i < effectiveMax;

        return (
          <React.Fragment key={i}>
            {/* ── 步骤节点 ── */}
            <div className="flex flex-col items-center flex-shrink-0 w-[64px] sm:w-[76px] lg:w-[84px]">
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
                      "cursor-pointer hover:opacity-90 hover:shadow-xs",
                    ),
                  isActive && cn(c.filled, c.ring, "cursor-default shadow-xs"),
                  !isDone &&
                    !isActive &&
                    canClick &&
                    "border-neutral-400 dark:border-neutral-600 text-neutral-700 dark:text-neutral-300 cursor-pointer hover:border-black dark:hover:border-white bg-white dark:bg-black",
                  !isDone &&
                    !isActive &&
                    !canClick &&
                    "border-neutral-200 dark:border-neutral-800 text-neutral-300 dark:text-neutral-700 cursor-default bg-neutral-50 dark:bg-black",
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
                      "text-neutral-400 dark:text-neutral-600 cursor-default",
                  )}
                  title={step.label}
                >
                  {step.label}
                </button>

                {/* 显示微摘要 */}
                {(isDone || canClick || isActive) && step.summary && (
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
                {/* 底轨 */}
                <div className="absolute inset-0 bg-neutral-200 dark:bg-neutral-800 rounded-full" />
                {/* 填充 */}
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
