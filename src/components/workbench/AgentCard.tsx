import React from "react";
import { motion } from "motion/react";
import { Loader2, RotateCw, Layers, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/useAuth";
import { useBoundTokenGroup } from "@/lib/useBoundTokenGroup";
import { TactileButton } from "@/components/ui/TactileButton";

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
  /** 当前已配置的 API Key（若未配置为 null 或空） */
  configuredKey?: string | null;
  /** 当前已配置的模型名称（若未配置为 null 或空） */
  configuredModel?: string | null;
}

/**
 * 脱敏展示 API Key，格式对齐终端日志 sk-...XXXX
 */
export function maskApiKey(key?: string | null): string {
  if (!key) return "未配置";
  const trimmed = key.trim();
  if (!trimmed) return "未配置";
  if (trimmed.length <= 8) {
    return "••••••••";
  }
  if (trimmed.startsWith("sk-")) {
    return `sk-...${trimmed.slice(-4)}`;
  }
  const prefix = trimmed.slice(0, 3);
  const suffix = trimmed.slice(-4);
  return `${prefix}...${suffix}`;
}

/**
 * 立体按压按钮尺寸：只通过参考实现定义的 CSS 变量调整。
 * - 字号：默认紧凑排版 12px，tall 断点 13px（与原胶囊按钮一致）；阴影等 em 尺寸随之等比缩放
 * - 使用 ! 前缀保证覆盖不受 CSS 注入顺序影响（参考默认字号为 48px）
 * - 内边距：tall 断点使用参考默认值（1em / 1.5em）；默认紧凑排版下卡片高度有限，
 *   纵向留白收窄为 0.5em、横向 1.25em，保证 1040×680 窗口下按钮完整可见
 */
const tactileSizeClass =
  "![--button-font-size:12px] ![--button-padding-y:0.5em] ![--button-padding-x:1.25em] " +
  "tall:![--button-font-size:13px] tall:![--button-padding-y:1em] tall:![--button-padding-x:1.5em]";

interface AgentCardProps {
  agent: AgentCardItem;
  index?: number;
  onAction: (agent: AgentCardItem) => void;
  onRestart?: (agent: AgentCardItem) => void;
  onOpenDetail?: (agent: AgentCardItem) => void;
  actionDisabled?: boolean;
  restartDisabled?: boolean;
  restarting?: boolean;
}

/**
 * 现代高质感 Agent 矩阵卡片 (深度适配全屏大屏与小屏自适应)
 * - 纯白微通透圆角卡片，默认紧凑排版（约 160px 即可完整显示所有元素与按钮）
 * - 首行：品牌 Logo + 名称/副标题 + 状态徽章
 * - 中部：密钥分组与 Model 信息区
 * - 底部：胶囊 Pill 按钮
 * - 窗口高度 ≥ 820px（tall 断点）时切换为宽松排版
 */
export const AgentCard: React.FC<AgentCardProps> = ({
  agent,
  index = 0,
  onAction,
  onRestart,
  onOpenDetail,
  actionDisabled = false,
  restartDisabled = false,
  restarting = false,
}) => {
  const Icon = agent.icon;

  // 首页只展示密钥所属分组，不展示密钥本身
  const { authState } = useAuth();
  const { group: keyGroup } = useBoundTokenGroup(
    agent.toolKey ?? "default",
    agent.configuredKey ?? undefined,
    { preserveWhileResolving: true },
  );
  const hasKey = Boolean(agent.configuredKey);
  const groupText = !hasKey
    ? "未配置"
    : keyGroup
      ? keyGroup
      : authState.is_logged_in
        ? "未识别分组"
        : "登录后显示";
  const groupTitle = !hasKey
    ? "未配置 API Key"
    : keyGroup
      ? `当前密钥所属分组: ${keyGroup}`
      : authState.is_logged_in
        ? "未能匹配到当前密钥所属的分组"
        : "登录 Bob API 账号后可显示当前密钥所属分组";

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
        // 默认紧凑排版：1040×680 默认窗口下单卡高度仅约 184px，必须保证按钮可见；窗口足够高时再放宽
        "group relative flex flex-col justify-between gap-2 tall:gap-3 p-3 tall:p-5 rounded-[20px] tall:rounded-[26px] transition-all duration-250 cursor-pointer select-none h-full min-h-0",
        "bg-white/85 dark:bg-slate-900/80 backdrop-blur-xl",
        "border border-white/90 dark:border-white/10",
        "shadow-[0_4px_20px_rgba(0,0,0,0.025)] hover:shadow-[0_12px_32px_rgba(0,0,0,0.06)] hover:-translate-y-0.5",
        "overflow-hidden"
      )}
    >
      {/* 柔和的悬停微光晕 */}
      <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-gradient-to-bl from-sky-400/5 via-purple-400/5 to-transparent pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      {/* ── 顶部：Logo + 名称/副标题 + 状态（单行合并，节省纵向空间） ── */}
      <div className="flex items-center gap-2.5 relative z-10 min-w-0">
        <div className="w-8 h-8 tall:w-10 tall:h-10 flex-shrink-0 rounded-xl tall:rounded-2xl flex items-center justify-center bg-slate-50 dark:bg-white/5 border border-slate-100/80 dark:border-white/5 transition-transform duration-300 group-hover:scale-105">
          <Icon size={22} className="w-[18px] h-[18px] tall:w-[24px] tall:h-[24px]" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-sm tall:text-[15px] leading-5 font-bold text-slate-900 dark:text-white tracking-tight truncate">
                {agent.name}
              </h3>
              {/* 类别标签仅在窗口足够高（宽松排版）时展示，副标题已包含类别信息 */}
              <span className="hidden tall:inline-block flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-md bg-slate-100/80 dark:bg-white/5 text-slate-400 dark:text-slate-400 border border-slate-200/50 dark:border-white/5 font-medium">
                {categoryLabelMap[agent.category]}
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0 text-slate-400 dark:text-slate-400 font-normal">
              <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", statusConfig.dotColor)} />
              <span className="text-[11px] leading-4">{statusConfig.label}</span>
            </div>
          </div>
          <p className="text-[11px] tall:text-[13px] leading-4 tall:leading-5 text-slate-400 dark:text-slate-400 truncate">
            {agent.subtitle}
          </p>
        </div>
      </div>

      {/* ── 当前密钥分组与 Model 同步展示区 ── */}
      <div
        className={cn(
          "p-2 tall:p-2.5 rounded-xl tall:rounded-2xl bg-slate-50/75 dark:bg-white/[0.04] border border-slate-100/90 dark:border-white/[0.06] flex flex-col gap-1 tall:gap-1.5 relative z-10 transition-colors",
          isUninstalled && "opacity-60",
        )}
      >
        {/* 密钥分组行：显示当前配置的密钥属于哪个分组 */}
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500 text-[11px] leading-4 tall:text-xs">
            <Layers size={12} className="text-amber-500/80 flex-shrink-0" />
            <span>分组</span>
          </div>
          <div
            className={cn(
              "text-[11px] leading-4 tall:text-xs font-medium tracking-tight truncate min-w-0",
              hasKey && keyGroup
                ? "text-slate-700 dark:text-slate-200"
                : "text-slate-400 dark:text-slate-600 italic",
            )}
            title={groupTitle}
          >
            {groupText}
          </div>
        </div>

        {/* Model 行 */}
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500 text-[11px] leading-4 tall:text-xs">
            <Cpu size={12} className="text-sky-500/80 flex-shrink-0" />
            <span>Model</span>
          </div>
          <div
            className={cn(
              "text-[11px] leading-4 tall:text-xs font-mono font-medium tracking-tight truncate min-w-0",
              agent.configuredModel
                ? "text-slate-800 dark:text-slate-100 font-semibold"
                : "text-slate-400 dark:text-slate-600 font-sans italic",
            )}
            title={
              agent.configuredModel
                ? `当前生效模型: ${agent.configuredModel}`
                : "未配置模型"
            }
          >
            {agent.configuredModel || "--"}
          </div>
        </div>
      </div>

      {/* ── 底部行动胶囊按钮 (全局统一弹性弹跳微动效与触觉反馈) ── */}
      <div className="flex items-center justify-start gap-2 relative z-10">
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
            disabled={actionDisabled}
            onClick={(e) => {
              e.stopPropagation();
              onAction(agent);
            }}
            className="px-3 py-1 tall:px-5 tall:py-2 rounded-full bg-white hover:bg-slate-50 border border-slate-200/90 dark:bg-white/10 dark:hover:bg-white/15 dark:border-white/10 text-slate-800 dark:text-slate-200 text-xs tall:text-[13px] font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            安装 Agent
          </motion.button>
        ) : (
          <>
            <TactileButton
              key="btn-configured"
              initial={{ scale: 0.86, opacity: 0.7 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                type: "spring",
                stiffness: 440,
                damping: 15,
                mass: 0.6,
                delay: index * 0.035,
              }}
              disabled={actionDisabled}
              onClick={(e) => {
                e.stopPropagation();
                onAction(agent);
              }}
              className={tactileSizeClass}
              theme="clear"
              liquidGlass
            >
              {agent.actionLabel ?? "一键配置"}
            </TactileButton>

            {onRestart && (
              <TactileButton
                key="btn-restart"
                initial={{ scale: 0.86, opacity: 0.7 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 440,
                  damping: 15,
                  mass: 0.6,
                  delay: index * 0.035 + 0.03,
                }}
                disabled={restartDisabled}
                onClick={(e) => {
                  e.stopPropagation();
                  onRestart(agent);
                }}
                title={`仅重启 ${agent.name}`}
                icon={
                  restarting ? (
                    <Loader2 size="1em" className="animate-spin" />
                  ) : (
                    <RotateCw size="1em" />
                  )
                }
                className={tactileSizeClass}
                theme="clear"
                liquidGlass
              >
                一键重启
              </TactileButton>
            )}
          </>
        )}
      </div>
    </div>
  );
};
