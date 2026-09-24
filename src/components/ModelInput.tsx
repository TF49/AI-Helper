import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import {
  ChevronDown,
  Download,
  Loader2,
  Search,
  Cpu,
} from "lucide-react";
import type { FetchedModel } from "../types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { cn } from "../lib/utils";

export interface ModelInputProps {
  value: string;
  onChange: (value: string) => void;
  models: FetchedModel[];
  placeholder: string;
  id: string;
  onRefresh: () => void;
  refreshing: boolean;
  accentColor?: "blue" | "purple";
}

export function ModelInput({
  value,
  onChange,
  models,
  placeholder,
  id,
  onRefresh,
  refreshing,
  accentColor = "blue",
}: ModelInputProps) {
  const [open, setOpen] = useState(false);
  const grouped = new Map<string, FetchedModel[]>();
  for (const model of models) {
    const vendor = model.ownedBy || "Other";
    const group = grouped.get(vendor) || [];
    group.push(model);
    grouped.set(vendor, group);
  }

  const isBlue = accentColor === "blue";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={id}
          className="text-xs font-semibold text-slate-700 dark:text-gray-300 flex items-center gap-1.5"
        >
          <Cpu
            size={14}
            className={
              isBlue
                ? "text-blue-500 dark:text-blue-400"
                : "text-purple-500 dark:text-purple-400"
            }
          />
          测试模型
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={refreshing}
          className={cn(
            "h-7 shrink-0 gap-1.5 text-xs rounded-lg transition-all",
            "border-slate-200 bg-white hover:bg-slate-50 text-slate-700",
            "dark:border-white/10 dark:bg-[#141724]/60 dark:hover:bg-[#1c2033] dark:text-gray-300",
            refreshing && "opacity-75 cursor-not-allowed",
          )}
        >
          {refreshing ? (
            <Loader2 size={13} className="animate-spin text-blue-500" />
          ) : (
            <Download
              size={13}
              className="text-slate-500 dark:text-gray-400 group-hover:text-slate-800 dark:group-hover:text-white"
            />
          )}
          获取模型列表
        </Button>
      </div>

      <div className="flex gap-1.5">
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          className={cn(
            "min-w-0 flex-1 font-mono text-xs rounded-xl h-10 tracking-wide",
            "bg-slate-50/80 dark:bg-[#141724]/80 border-slate-200 dark:border-white/10 text-slate-900 dark:text-gray-200",
            isBlue
              ? "focus:bg-white dark:focus:bg-[#141724] focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
              : "focus:bg-white dark:focus:bg-[#141724] focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30",
          )}
        />
        {models.length > 0 && (
          <Popover.Root modal open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
              <Button
                type="button"
                variant="outline"
                aria-label="选择模型"
                title="选择模型"
                className="w-10 h-10 shrink-0 px-0 rounded-xl border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 dark:border-white/10 dark:bg-[#141724]/80 dark:hover:bg-[#1d2136] dark:text-gray-400 dark:hover:text-white"
              >
                <ChevronDown size={15} />
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="end"
                sideOffset={6}
                collisionPadding={10}
                className="z-[200] w-80 max-w-[calc(100vw-20px)] overflow-hidden rounded-xl border border-slate-200 dark:border-white/10 bg-white/95 dark:bg-[#121522]/95 backdrop-blur-xl text-slate-800 dark:text-gray-200 shadow-2xl"
              >
                <Command label="搜索模型">
                  <div className="flex items-center gap-2 border-b border-slate-200 dark:border-white/10 px-3 py-1 bg-slate-50 dark:bg-transparent">
                    <Search
                      size={14}
                      className="shrink-0 text-slate-400 dark:text-gray-400"
                    />
                    <Command.Input
                      placeholder="搜索模型名称..."
                      className="h-9 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-slate-400 dark:placeholder:text-gray-500 font-mono text-slate-800 dark:text-gray-200"
                    />
                  </div>
                  <Command.List className="max-h-60 overflow-y-auto overscroll-contain p-1.5">
                    <Command.Empty className="py-6 text-center text-xs text-slate-500 dark:text-gray-500">
                      未找到匹配的模型
                    </Command.Empty>
                    {[...grouped.keys()].sort().map((vendor) => (
                      <Command.Group
                        key={vendor}
                        heading={vendor}
                        className="[&_[cmdk-group-heading]]:break-words [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-slate-400 dark:[&_[cmdk-group-heading]]:text-gray-500"
                      >
                        {grouped.get(vendor)!.map((m, index) => (
                          <Command.Item
                            key={`${m.id}-${index}`}
                            value={m.id}
                            keywords={[vendor]}
                            onSelect={() => {
                              onChange(m.id);
                              setOpen(false);
                            }}
                            className="cursor-pointer break-all rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-700 dark:text-gray-300 hover:text-slate-950 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 data-[selected=true]:bg-blue-50 data-[selected=true]:text-blue-600 dark:data-[selected=true]:bg-blue-500/20 dark:data-[selected=true]:text-blue-300 transition-colors"
                          >
                            {m.id}
                          </Command.Item>
                        ))}
                      </Command.Group>
                    ))}
                  </Command.List>
                </Command>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
      </div>
    </div>
  );
}

export default ModelInput;
