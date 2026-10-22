import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import {
  OpenAIIcon,
  ClaudeIcon,
  WorkbuddyIcon,
  AccioWorkIcon,
  CursorIcon,
} from "../BrandIcons";
import { ChatGPTPanel } from "../ChatGPTPanel";
import { ClaudePanel } from "../ClaudePanel";
import { WorkbuddyPanel } from "../WorkbuddyPanel";
import { AccioWorkPanel } from "../AccioWorkPanel";
import { CursorPanel } from "../CursorPanel";
import { cn } from "../../lib/utils";
import type { AgentTool } from "../../types";

interface WorkspaceViewProps {
  activeTool: AgentTool;
  onSelectTool: (tool: AgentTool) => void;
}

const TOOLS: {
  id: AgentTool;
  name: string;
  icon: React.ElementType;
  activeColor: string;
}[] = [
  {
    id: "chatgpt",
    name: "Codex",
    icon: OpenAIIcon,
    activeColor: "text-black dark:text-white",
  },
  {
    id: "claude",
    name: "Claude Code",
    icon: ClaudeIcon,
    activeColor: "text-black dark:text-white",
  },
  {
    id: "workbuddy",
    name: "WorkBuddy",
    icon: WorkbuddyIcon,
    activeColor: "text-black dark:text-white",
  },
  {
    id: "acciowork",
    name: "Accio Work",
    icon: AccioWorkIcon,
    activeColor: "text-black dark:text-white",
  },
  {
    id: "cursor",
    name: "Cursor",
    icon: CursorIcon,
    activeColor: "text-black dark:text-white",
  },
];

export function WorkspaceView({ activeTool, onSelectTool }: WorkspaceViewProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const currentTool = TOOLS.find((t) => t.id === activeTool) || TOOLS[0];
  const CurrentIcon = currentTool.icon;

  return (
    <div className="w-full flex-1 flex flex-col min-h-0">
      {/* ── 顶部面包屑与工具下拉切换 (取消图二顶部横向Tab，改为下拉框形式) ── */}
      <div className="flex items-center justify-between mb-5 pb-3 border-b border-slate-200/80 dark:border-white/10 flex-shrink-0">
        {/* 左侧面包屑 */}
        <div className="flex items-center gap-2 select-none">
          <span className="text-sm font-semibold text-slate-800 dark:text-gray-200">
            工作台
          </span>
          <span className="text-slate-400 dark:text-gray-500 text-xs">/</span>

          {/* 当前工具下拉框选择器 */}
          <Popover.Root open={dropdownOpen} onOpenChange={setDropdownOpen}>
            <Popover.Trigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold bg-slate-100/80 hover:bg-slate-200/80 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200/60 dark:border-white/10 text-slate-800 dark:text-gray-200 transition-all cursor-pointer shadow-2xs group"
                title="点击切换当前 AI 工具"
              >
                <div
                  className={cn(
                    "flex items-center justify-center transition-colors",
                    currentTool.activeColor,
                  )}
                >
                  <CurrentIcon size={14} />
                </div>
                <span>{currentTool.name}</span>
                <ChevronDown
                  size={12}
                  className={cn(
                    "text-slate-400 dark:text-gray-500 transition-transform duration-200",
                    dropdownOpen && "rotate-180",
                  )}
                />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="bottom"
                align="start"
                sideOffset={6}
                className="z-[110] w-48 p-1.5 rounded-2xl bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl border border-slate-200/90 dark:border-white/10 shadow-xl animate-in fade-in-0 zoom-in-95 select-none"
              >
                <div className="px-2.5 py-1 text-[10px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-wider border-b border-slate-100 dark:border-white/5 mb-1">
                  选择 AI 工具
                </div>
                <div className="space-y-0.5">
                  {TOOLS.map((tool) => {
                    const Icon = tool.icon;
                    const isActive = activeTool === tool.id;

                    return (
                      <button
                        key={tool.id}
                        type="button"
                        onClick={() => {
                          onSelectTool(tool.id);
                          setDropdownOpen(false);
                        }}
                        className={cn(
                          "w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer text-left",
                          isActive
                            ? "bg-neutral-100 text-black dark:bg-white/10 dark:text-white font-semibold"
                            : "text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/5",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Icon
                            size={14}
                            className={
                              isActive ? tool.activeColor : "opacity-75"
                            }
                          />
                          <span>{tool.name}</span>
                        </div>
                        {isActive && (
                          <span className="w-1.5 h-1.5 rounded-full bg-black dark:bg-white" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>

        {/* 右侧：提示说明 */}
        <div className="text-xs text-slate-400 dark:text-gray-500 hidden sm:block">
          工具配置与智能网关
        </div>
      </div>

      {/* ── 主体内容区：对应工具的配置展台 ── */}
      <div className="w-full flex-1 min-h-0">
        <AnimatePresence mode="wait">
          {activeTool === "chatgpt" ? (
            <motion.div
              key="chatgpt"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              <ChatGPTPanel />
            </motion.div>
          ) : activeTool === "claude" ? (
            <motion.div
              key="claude"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              <ClaudePanel />
            </motion.div>
          ) : activeTool === "workbuddy" ? (
            <motion.div
              key="workbuddy"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              <WorkbuddyPanel />
            </motion.div>
          ) : activeTool === "acciowork" ? (
            <motion.div
              key="acciowork"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              <AccioWorkPanel />
            </motion.div>
          ) : (
            <motion.div
              key="cursor"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              <CursorPanel />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
