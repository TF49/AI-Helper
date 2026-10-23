import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import {
  OpenAIIcon,
  ClaudeIcon,
  WorkbuddyIcon,
  AccioWorkIcon,
  CursorIcon,
} from "../BrandIcons";
import { cn } from "../../lib/utils";
import type { AgentTool } from "../../types";

export interface WorkbenchHeaderProps {
  activeTool: AgentTool;
  onSelectTool: (tool: AgentTool) => void;
  className?: string;
}

const TOOLS_CONFIG: Array<{
  id: AgentTool;
  name: string;
  icon: React.FC<{ size?: number; className?: string }>;
  color: string;
  activeBg: string;
  activeBorder: string;
  activeText: string;
}> = [
  {
    id: "chatgpt",
    name: "Codex",
    icon: OpenAIIcon,
    color: "text-blue-500",
    activeBg: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    activeBorder: "border-blue-500/50 shadow-xs ring-1 ring-blue-500/20",
    activeText: "text-blue-600 dark:text-blue-400",
  },
  {
    id: "claude",
    name: "Claude Code",
    icon: ClaudeIcon,
    color: "text-purple-500",
    activeBg: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
    activeBorder: "border-purple-500/50 shadow-xs ring-1 ring-purple-500/20",
    activeText: "text-purple-600 dark:text-purple-400",
  },
  {
    id: "workbuddy",
    name: "WorkBuddy",
    icon: WorkbuddyIcon,
    color: "text-emerald-500",
    activeBg: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    activeBorder: "border-emerald-500/50 shadow-xs ring-1 ring-emerald-500/20",
    activeText: "text-emerald-600 dark:text-emerald-400",
  },
  {
    id: "acciowork",
    name: "Accio Work",
    icon: AccioWorkIcon,
    color: "text-orange-500",
    activeBg: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
    activeBorder: "border-orange-500/50 shadow-xs ring-1 ring-orange-500/20",
    activeText: "text-orange-600 dark:text-orange-400",
  },
  {
    id: "cursor",
    name: "Cursor",
    icon: CursorIcon,
    color: "text-neutral-800 dark:text-neutral-200",
    activeBg: "bg-neutral-800/15 text-neutral-900 dark:text-neutral-100",
    activeBorder: "border-neutral-500/50 shadow-xs ring-1 ring-neutral-500/20",
    activeText: "text-neutral-900 dark:text-neutral-100",
  },
];

export const WorkbenchHeader: React.FC<WorkbenchHeaderProps> = ({
  activeTool,
  onSelectTool,
  className,
}) => {
  const [open, setOpen] = useState(false);
  const current = TOOLS_CONFIG.find((t) => t.id === activeTool) || TOOLS_CONFIG[0];
  const CurrentIcon = current.icon;

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-200/80 dark:border-white/10 select-none",
        className,
      )}
    >
      {/* 左侧：面包屑与下拉选择 */}
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-gray-400">
        <span className="font-semibold text-slate-800 dark:text-gray-200 text-sm">
          工作台
        </span>
        <span className="text-slate-400 dark:text-gray-600">/</span>

        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold bg-slate-100/80 hover:bg-slate-200/80 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200/60 dark:border-white/10 text-slate-800 dark:text-gray-200 transition-all cursor-pointer shadow-2xs"
            >
              <CurrentIcon size={14} className={current.color} />
              <span>{current.name}</span>
              <ChevronDown
                size={12}
                className={cn(
                  "text-slate-400 dark:text-gray-500 transition-transform duration-200",
                  open && "rotate-180",
                )}
              />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="bottom"
              align="start"
              sideOffset={6}
              className="z-[110] w-48 p-1.5 rounded-2xl bg-white/95 dark:bg-[#121626]/95 backdrop-blur-xl border border-slate-200/90 dark:border-white/10 shadow-xl animate-in fade-in-0 zoom-in-95 select-none"
            >
              <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-wider border-b border-slate-100 dark:border-white/5 mb-1">
                选择 AI 工具
              </div>
              <div className="space-y-0.5">
                {TOOLS_CONFIG.map((t) => {
                  const Icon = t.icon;
                  const isActive = activeTool === t.id;

                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        onSelectTool(t.id);
                        setOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer text-left",
                        isActive
                          ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 font-semibold"
                          : "text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/5",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Icon size={14} className={isActive ? t.color : "opacity-75"} />
                        <span>{t.name}</span>
                      </div>
                      {isActive && (
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                      )}
                    </button>
                  );
                })}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>

      <div className="text-xs text-slate-400 dark:text-gray-500 hidden sm:block">
        工具配置与智能网关
      </div>
    </div>
  );
};
