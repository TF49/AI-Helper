import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TactileButton } from "@/components/ui/TactileButton";

export type AgentStatusType = "installed" | "uninstalled" | "unconfigured";

/** 卡片上显示的模型类别：界面只说类别，不展示模型 ID、分组等技术细节。 */
export type ModelFamily = "国产" | "Claude" | "GPT";

export interface AgentCardItem {
  id: string;
  name: string;
  subtitle: string;
  category: "cli" | "desktop" | "ide";
  icon: React.ElementType;
  /**
   * installed = 已配置好模型；unconfigured = 软件已安装但未配置；
   * uninstalled = 软件未安装且没有配置。
   */
  status: AgentStatusType;
  toolKey?: "claude" | "chatgpt" | "cursor" | "workbuddy" | "acciowork" | "dsh";
  modelFamily: ModelFamily;
  /** 当前已配置的 API Key（若未配置为 null 或空） */
  configuredKey?: string | null;
  /** 当前已配置的模型名称（若未配置为 null 或空） */
  configuredModel?: string | null;
  /** 一并配置的模型总数（WorkBuddy 会写入分组下的全部模型）；只有一个时不填 */
  configuredModelCount?: number;
  /** 本机是否检测到这款软件（已卸载但留有配置时为 false） */
  appExists?: boolean;
  /** 软件当前是否正在运行 */
  running?: boolean;
  /** 未安装时主按钮的文案；默认「去官网下载」，走应用内安装引导的软件用「查看安装方法」 */
  installLabel?: string;
  /** 配置好之后，告诉用户去软件的哪里使用（可选） */
  doneHint?: string;
  /** 配置已保存、但还差一步才能用（例如本地连接服务没有就绪） */
  attention?: { text: string; actionLabel: string } | null;
}

/** 一次配置任务在卡片内的进度：进行中，或失败后等待用户重试。 */
export type CardPhase = { kind: "working"; text: string } | { kind: "failed"; text: string };

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
 * 立体按压按钮尺寸：只通过参考实现定义的 CSS 变量调整（! 前缀保证覆盖默认的 48px 字号）。
 */
const tactileCompact =
  "![--button-font-size:12px] ![--button-padding-y:0.5em] ![--button-padding-x:1.25em]";
const tactilePrimary =
  "![--button-font-size:13px] ![--button-padding-y:0.7em] ![--button-padding-x:1.5em] " +
  "tall:![--button-font-size:14px] tall:![--button-padding-y:0.9em]";

interface AgentCardProps {
  agent: AgentCardItem;
  index?: number;
  /** primary = 首屏主推的大卡；compact =「更多软件」里的小卡 */
  size?: "primary" | "compact";
  phase?: CardPhase | null;
  /** 首页有其他任务在进行时禁用主操作 */
  disabled?: boolean;
  /** 正在打开或重新打开这款软件 */
  opening?: boolean;
  /** 正在恢复为官方 */
  restoring?: boolean;
  onConfigure: (agent: AgentCardItem) => void;
  onOpenApp: (agent: AgentCardItem) => void;
  onInstall: (agent: AgentCardItem) => void;
  onRestore: (agent: AgentCardItem) => void;
  onResolveAttention: (agent: AgentCardItem) => void;
  /** 查看本次配置的技术日志 */
  onShowDetails?: (agent: AgentCardItem) => void;
  /** 打开这款软件的高级设置面板 */
  onOpenAdvanced?: (agent: AgentCardItem) => void;
}

interface CardView {
  badge: string;
  badgeDot: string;
  sentence: string;
  tone: "normal" | "good" | "warn";
  mainLabel: string;
  mainAction: "configure" | "open" | "install" | "attention" | "none";
  busy?: boolean;
}

function describe(agent: AgentCardItem, phase: CardPhase | null, opening: boolean): CardView {
  const configured = agent.status === "installed";
  const grey = "bg-slate-300 dark:bg-slate-600";
  const amber = "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]";
  const green = "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]";

  if (phase?.kind === "working") {
    return {
      badge: "正在配置",
      badgeDot: amber,
      sentence: phase.text,
      tone: "normal",
      mainLabel: "正在配置…",
      mainAction: "none",
      busy: true,
    };
  }
  if (phase?.kind === "failed") {
    return {
      badge: configured ? "已配置" : "未配置",
      badgeDot: amber,
      sentence: phase.text,
      tone: "warn",
      mainLabel: "重试",
      mainAction: "configure",
    };
  }
  if (configured) {
    const count = agent.configuredModelCount ?? 0;
    const model = agent.configuredModel
      ? `「${agent.configuredModel}」${count > 1 ? `等 ${count} 个模型` : ""}`
      : "";
    if (agent.attention) {
      return {
        badge: "差一步",
        badgeDot: amber,
        sentence: agent.attention.text,
        tone: "warn",
        mainLabel: agent.attention.actionLabel,
        mainAction: "attention",
      };
    }
    if (agent.appExists === false) {
      return {
        badge: "未安装",
        badgeDot: grey,
        sentence: `模型已配置好，但还没有安装 ${agent.name}`,
        tone: "normal",
        mainLabel: agent.installLabel ?? "去官网下载",
        mainAction: "install",
      };
    }
    const where = agent.doneHint ? `${agent.doneHint}` : "";
    return {
      badge: "已配置",
      badgeDot: green,
      sentence: agent.running
        ? `已配置好${model}。${where || `重新打开 ${agent.name} 后生效`}`
        : `已配置好${model}。${where}`,
      tone: "good",
      mainLabel: opening
        ? "正在打开…"
        : agent.running
          ? `重新打开 ${agent.name}`
          : `打开 ${agent.name}`,
      mainAction: "open",
      busy: opening,
    };
  }
  if (agent.status === "unconfigured") {
    return {
      badge: "未配置",
      badgeDot: amber,
      // 中英文之间留空格：「使用 Claude 模型」「使用国产模型」
      sentence: `在 ${agent.name} 里使用${
        agent.modelFamily === "国产" ? "国产" : ` ${agent.modelFamily} `
      }模型`,
      tone: "normal",
      mainLabel: "一键配置模型",
      mainAction: "configure",
    };
  }
  return {
    badge: "未安装",
    badgeDot: grey,
    sentence: `还没有安装 ${agent.name}`,
    tone: "normal",
    mainLabel: agent.installLabel ?? "去官网下载",
    mainAction: "install",
  };
}

/**
 * 首页软件卡片：一句状态、一个主按钮、少量次要操作。
 * 服务地址、密钥、分组、端口等技术细节不在这里出现，统一收在「高级设置」里。
 */
export const AgentCard: React.FC<AgentCardProps> = ({
  agent,
  index = 0,
  size = "compact",
  phase = null,
  disabled = false,
  opening = false,
  restoring = false,
  onConfigure,
  onOpenApp,
  onInstall,
  onRestore,
  onResolveAttention,
  onShowDetails,
  onOpenAdvanced,
}) => {
  const Icon = agent.icon;
  const isPrimary = size === "primary";
  const view = describe(agent, phase, opening);
  const configured = agent.status === "installed";
  const working = phase?.kind === "working";

  const runMain = () => {
    if (view.mainAction === "configure") onConfigure(agent);
    else if (view.mainAction === "open") onOpenApp(agent);
    else if (view.mainAction === "install") onInstall(agent);
    else if (view.mainAction === "attention") onResolveAttention(agent);
  };

  const linkClass =
    "text-[11px] tall:text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white underline-offset-2 hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline transition-colors";

  return (
    <div
      data-agent-card={agent.id}
      className={cn(
        "group relative flex flex-col justify-between rounded-[20px] tall:rounded-[24px] transition-all duration-250 select-none h-full min-h-0",
        isPrimary ? "gap-3 p-4 tall:p-5" : "gap-2 p-3 tall:p-4",
        "bg-white/85 dark:bg-slate-900/80 backdrop-blur-xl",
        "border border-white/90 dark:border-white/10",
        "shadow-[0_4px_20px_rgba(0,0,0,0.025)] hover:shadow-[0_12px_32px_rgba(0,0,0,0.06)]",
        "overflow-hidden",
      )}
    >
      {/* ── 顶部：Logo + 名称 + 状态 ── */}
      <div className="flex items-center gap-2.5 relative z-10 min-w-0">
        <div
          className={cn(
            "flex-shrink-0 rounded-xl tall:rounded-2xl flex items-center justify-center bg-slate-50 dark:bg-white/5 border border-slate-100/80 dark:border-white/5",
            isPrimary ? "w-11 h-11" : "w-8 h-8 tall:w-9 tall:h-9",
          )}
        >
          <Icon size={isPrimary ? 26 : 20} />
        </div>
        <div className="flex-1 min-w-0">
          <h3
            className={cn(
              "font-bold text-slate-900 dark:text-white tracking-tight truncate",
              isPrimary ? "text-base tall:text-[17px] leading-6" : "text-sm leading-5",
            )}
            title={agent.name}
          >
            {agent.name}
          </h3>
          <p className="text-[11px] tall:text-xs leading-4 text-slate-400 dark:text-slate-400 truncate">
            {agent.subtitle}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 self-start pt-1 text-slate-400 dark:text-slate-400">
          <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", view.badgeDot)} />
          <span className="text-[11px] leading-4 whitespace-nowrap">{view.badge}</span>
        </div>
      </div>

      {/* ── 一句状态 ── */}
      <p
        role="status"
        className={cn(
          "relative z-10 leading-relaxed",
          isPrimary ? "text-[13px] tall:text-sm min-h-[2.75rem]" : "text-xs min-h-[2.25rem]",
          view.tone === "good" && "text-emerald-700 dark:text-emerald-400",
          view.tone === "warn" && "text-amber-700 dark:text-amber-400",
          view.tone === "normal" && "text-slate-600 dark:text-slate-300",
        )}
      >
        {view.sentence}
      </p>

      {/* ── 主按钮 + 次要操作 ── */}
      <div className="flex flex-col gap-2 relative z-10">
        <div className="flex items-center flex-wrap gap-x-3 gap-y-2">
          <TactileButton
            initial={{ scale: 0.92, opacity: 0.7 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{
              type: "spring",
              stiffness: 440,
              damping: 18,
              mass: 0.6,
              delay: index * 0.035,
            }}
            disabled={disabled || view.mainAction === "none" || view.busy || restoring}
            onClick={(e) => {
              e.stopPropagation();
              runMain();
            }}
            icon={view.busy ? <Loader2 size="1em" className="animate-spin" /> : undefined}
            className={isPrimary ? tactilePrimary : tactileCompact}
            theme="clear"
            liquidGlass
          >
            {view.mainLabel}
          </TactileButton>

          {phase?.kind === "failed" && onShowDetails && (
            <button type="button" className={linkClass} onClick={() => onShowDetails(agent)}>
              查看详情
            </button>
          )}
          {configured && !working && (
            <>
              <button
                type="button"
                className={linkClass}
                disabled={disabled || restoring}
                onClick={() => onRestore(agent)}
              >
                {restoring ? "正在恢复…" : "恢复为官方"}
              </button>
              {phase?.kind !== "failed" && (
                <button
                  type="button"
                  className={linkClass}
                  disabled={disabled || restoring}
                  onClick={() => onConfigure(agent)}
                >
                  重新配置
                </button>
              )}
            </>
          )}
          {onOpenAdvanced && agent.toolKey && !working && (
            <button type="button" className={linkClass} onClick={() => onOpenAdvanced(agent)}>
              高级设置
            </button>
          )}
        </div>

        {isPrimary && agent.status === "unconfigured" && !phase && (
          <p className="text-[11px] leading-4 text-slate-400 dark:text-slate-500">
            会用你的 Bob API 账号检查一次模型，消耗少量额度。
          </p>
        )}
      </div>
    </div>
  );
};
