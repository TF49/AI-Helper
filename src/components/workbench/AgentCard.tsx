import React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export type AgentStatusType = "installed" | "uninstalled" | "unconfigured";

export interface AgentCardItem {
  id: string;
  name: string;
  subtitle: string;
  category: "cli" | "desktop" | "ide";
  icon: React.ElementType;
  status: AgentStatusType;
  toolKey?: "claude" | "chatgpt" | "cursor" | "workbuddy" | "acciowork";
  /** 已安装状态下操作按钮的文案，默认「一键配置」 */
  actionLabel?: string;
}

interface AgentCardProps {
  agent: AgentCardItem;
  index?: number;
  onAction: (agent: AgentCardItem) => void;
  onOpenDetail?: (agent: AgentCardItem) => void;
}

/**
 * 现代高质感 Agent 矩阵卡片 (深度适配全屏大屏与小屏自适应)
 * - 纯白微通透圆角卡片 (rounded-[24px] xl:rounded-3xl)
 * - 左上角品牌 Logo 微底座 + 右上角微点状态徽章
 * - 中部标题与副标题描述 (大屏自适应排版)
 * - 底部精巧胶囊 Pill 按钮 (支持 active 缩放交互)
 */
export const AgentCard: React.FC<AgentCardProps> = ({
  agent,
  index = 0,
  onAction,
  onOpenDetail,
}) => {
  const Icon = agent.icon;

  const statusConfigMap: Record<
    AgentStatusType,
    { label: string; dotColor: string }
  > = {
    installed: {
      label: "已安装",
      dotColor: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]",
    },
    uninstalled: {
      label: "未安装",
      dotColor: "bg-slate-300 dark:bg-slate-600",
    },
    unconfigured: {
      label: "未配置",
      dotColor: "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]",
    },
  };

  const categoryLabelMap: Record<AgentCardItem["category"], string> = {
    cli: "命令行工具",
    desktop: "官方客户端",
    ide: "开发编辑器",
  };

  const isUninstalled = agent.status === "uninstalled";
  const statusConfig = statusConfigMap[agent.status];

  return (
    <div
      onClick={() => onOpenDetail?.(agent)}
      className={cn(
        "group relative flex flex-col justify-between p-4 sm:p-5 xl:p-6 rounded-[22px] xl:rounded-[26px] transition-all duration-250 cursor-pointer select-none h-full",
        "bg-white/85 dark:bg-slate-900/80 backdrop-blur-xl",
        "border border-white/90 dark:border-white/10",
        "shadow-[0_4px_20px_rgba(0,0,0,0.025)] hover:shadow-[0_12px_32px_rgba(0,0,0,0.06)] hover:-translate-y-0.5",
        "overflow-hidden"
      )}
    >
      {/* 柔和的悬停微光晕 */}
      <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-gradient-to-bl from-sky-400/5 via-purple-400/5 to-transparent pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      {/* ── 顶部 Logo 与高阶状态标识 ── */}
      <div className="flex items-center justify-between relative z-10">
        <div className="w-8 h-8 sm:w-9 sm:h-9 xl:w-10 xl:h-10 rounded-xl xl:rounded-2xl flex items-center justify-center bg-slate-50 dark:bg-white/5 border border-slate-100/80 dark:border-white/5 transition-transform duration-300 group-hover:scale-105">
          <Icon size={22} className="w-[20px] h-[20px] sm:w-[22px] sm:h-[22px] xl:w-[24px] xl:h-[24px]" />
        </div>

        <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-400 font-normal">
          <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", statusConfig.dotColor)} />
          <span className="text-[11px] xl:text-xs">{statusConfig.label}</span>
        </div>
      </div>

      {/* ── 中部 Agent 名称、副标题描述与类别标签 (全屏大屏自适应) ── */}
      <div className="my-2 sm:my-2.5 xl:my-3 relative z-10">
        <div className="flex items-center gap-2">
          <h3 className="text-sm xl:text-[15px] font-bold text-slate-900 dark:text-white tracking-tight">
            {agent.name}
          </h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100/80 dark:bg-white/5 text-slate-400 dark:text-slate-400 border border-slate-200/50 dark:border-white/5 font-medium hidden sm:inline-block">
            {categoryLabelMap[agent.category]}
          </span>
        </div>
        <p className="text-xs xl:text-[13px] text-slate-400 dark:text-slate-400 mt-0.5 sm:mt-1 truncate">
          {agent.subtitle}
        </p>
      </div>

      {/* ── 底部行动胶囊按钮 (全局统一弹性弹跳微动效与触觉反馈) ── */}
      <div className="flex items-center justify-start pt-1 relative z-10">
        {isUninstalled ? (
          <motion.button
            key="btn-uninstalled"
            type="button"
            initial={{ scale: 0.86, opacity: 0.7 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{
              type: "spring",
              stiffness: 440,
              damping: 15,
              mass: 0.6,
              delay: index * 0.035,
            }}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.94 }}
            onClick={(e) => {
              e.stopPropagation();
              onAction(agent);
            }}
            className="px-4 py-1.5 xl:px-5 xl:py-2 rounded-full bg-white hover:bg-slate-50 border border-slate-200/90 dark:bg-white/10 dark:hover:bg-white/15 dark:border-white/10 text-slate-800 dark:text-slate-200 text-xs xl:text-[13px] font-semibold shadow-2xs transition-colors cursor-pointer"
          >
            安装 Agent
          </motion.button>
        ) : (
          <motion.button
            key="btn-configured"
            type="button"
            initial={{ scale: 0.86, opacity: 0.7 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{
              type: "spring",
              stiffness: 440,
              damping: 15,
              mass: 0.6,
              delay: index * 0.035,
            }}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.94 }}
            onClick={(e) => {
              e.stopPropagation();
              onAction(agent);
            }}
            className="px-5 py-1.5 xl:px-6 xl:py-2 rounded-full bg-[#18181b] hover:bg-black text-white text-xs xl:text-[13px] font-semibold shadow-sm transition-colors cursor-pointer dark:bg-white dark:hover:bg-slate-100 dark:text-black"
          >
            {agent.actionLabel ?? "一键配置"}
          </motion.button>
        )}
      </div>
    </div>
  );
};
