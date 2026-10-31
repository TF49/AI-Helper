import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, ArrowLeft } from "lucide-react";
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
import { AgentMatrixLobby } from "../workbench/AgentMatrixLobby";
import { cn } from "../../lib/utils";
import type { AgentTool } from "../../types";

interface WorkspaceViewProps {
  activeTool: AgentTool;
  onSelectTool: (tool: AgentTool) => void;
  onOpenEnvironmentCheck?: () => void;
}

const TOOLS: {
  id: AgentTool;
  name: string;
  icon: React.ElementType;
  activeColor: string;
}[] = [
  {
    id: "chatgpt",
    name: "Codex / ChatGPT",
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

export function WorkspaceView({
  activeTool,
  onSelectTool,
  onOpenEnvironmentCheck,
}: WorkspaceViewProps) {
  // 视图模式：默认展示极具沉浸感的 Agent 接入大厅 (与参考设计图 100% 对齐)
  const [viewMode, setViewMode] = useState<"matrix" | "detail">("matrix");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const currentTool = TOOLS.find((t) => t.id === activeTool) || TOOLS[0];
  const CurrentIcon = currentTool.icon;

  const handleOpenToolDetail = (tool: AgentTool) => {
    onSelectTool(tool);
    setViewMode("detail");
  };

  return (
    <div className="w-full flex-1 flex flex-col min-h-0 h-full">
      {/* ── 仅在进入单工具深度配置详情时展示顶部返回栏 ── */}
      {viewMode === "detail" && (
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200/60 dark:border-white/10 flex-shrink-0 select-none">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setViewMode("matrix")}
              className="flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold bg-white/80 hover:bg-white dark:bg-white/10 dark:hover:bg-white/15 border border-slate-200/60 dark:border-white/10 text-slate-800 dark:text-gray-200 transition-all cursor-pointer shadow-2xs group"
              title="返回 Agent 矩阵大厅"
            >
              <ArrowLeft size={13} className="transition-transform group-hover:-translate-x-0.5" />
              <span>返回大厅</span>
            </button>

            <span className="text-slate-400 dark:text-gray-500 text-xs">/</span>

            {/* 当前工具下拉框选择器 */}
            <Popover.Root open={dropdownOpen} onOpenChange={setDropdownOpen}>
              <Popover.Trigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold bg-white/60 hover:bg-white dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200/60 dark:border-white/10 text-slate-800 dark:text-gray-200 transition-all cursor-pointer shadow-2xs"
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
        </div>
      )}

      {/* ── 主体内容呈现区 ── */}
      <div className="w-full flex-1 min-h-0 flex flex-col h-full">
        <AnimatePresence mode="wait">
          {viewMode === "matrix" ? (
            <motion.div
              key="matrix"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="w-full flex-1 flex flex-col min-h-0 h-full"
            >
              <AgentMatrixLobby
                onSelectTool={handleOpenToolDetail}
                onOpenEnvironmentCheck={
                  onOpenEnvironmentCheck || (() => {})
                }
              />
            </motion.div>
          ) : (
            <motion.div
              key={`detail-${activeTool}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="w-full flex-1 min-h-0 overflow-y-auto"
            >
              {activeTool === "chatgpt" ? (
                <ChatGPTPanel />
              ) : activeTool === "claude" ? (
                <ClaudePanel />
              ) : activeTool === "workbuddy" ? (
                <WorkbuddyPanel />
              ) : activeTool === "acciowork" ? (
                <AccioWorkPanel />
              ) : (
                <CursorPanel />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
