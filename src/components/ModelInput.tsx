import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { ChevronDown, Download, Loader2, Search, Cpu } from "lucide-react";
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
  accentColor?: "blue" | "purple" | "emerald" | "orange";
}

export function ModelInput({
  value,
  onChange,
  models,
  placeholder,
  id,
  onRefresh,
  refreshing,
  accentColor: _accentColor,
}: ModelInputProps) {
  const [open, setOpen] = useState(false);
  const grouped = new Map<string, FetchedModel[]>();
  for (const model of models) {
    const vendor = model.ownedBy || "Other";
    const group = grouped.get(vendor) || [];
    group.push(model);
    grouped.set(vendor, group);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={id}
          className="text-xs font-semibold text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5"
        >
          <Cpu
            size={14}
            className="text-neutral-600 dark:text-neutral-400"
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
            "border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700",
            "dark:border-neutral-800 dark:bg-[#0a0a0a] dark:hover:bg-neutral-900 dark:text-neutral-300",
            refreshing && "opacity-75 cursor-not-allowed",
          )}
        >
          {refreshing ? (
            <Loader2 size={13} className="animate-spin text-black dark:text-white" />
          ) : (
            <Download
              size={13}
              className="text-neutral-500 dark:text-neutral-400 group-hover:text-black dark:group-hover:text-white"
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
            "bg-neutral-50/80 dark:bg-[#0a0a0a] border-neutral-200 dark:border-neutral-800 text-black dark:text-white",
            "focus:bg-white dark:focus:bg-black focus:border-black dark:focus:border-white focus:ring-1 focus:ring-black/20 dark:focus:ring-white/30",
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
                className="w-10 h-10 shrink-0 px-0 rounded-xl border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-600 hover:text-black dark:border-neutral-800 dark:bg-[#0a0a0a] dark:hover:bg-neutral-900 dark:text-neutral-400 dark:hover:text-white"
              >
                <ChevronDown size={15} />
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="end"
                sideOffset={6}
                collisionPadding={10}
                className="z-[200] w-80 max-w-[calc(100vw-20px)] overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#0a0a0a] text-neutral-900 dark:text-neutral-100 shadow-2xl"
              >
                <Command label="搜索模型">
                  <div className="flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 px-3 py-1 bg-neutral-50 dark:bg-black">
                    <Search
                      size={14}
                      className="shrink-0 text-neutral-400 dark:text-neutral-500"
                    />
                    <Command.Input
                      placeholder="搜索模型名称..."
                      className="h-9 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-neutral-400 dark:placeholder:text-neutral-600 font-mono text-black dark:text-white"
                    />
                  </div>
                  <Command.List className="max-h-60 overflow-y-auto overscroll-contain p-1.5">
                    <Command.Empty className="py-6 text-center text-xs text-neutral-500 dark:text-neutral-500">
                      未找到匹配的模型
                    </Command.Empty>
                    {[...grouped.keys()].sort().map((vendor) => (
                      <Command.Group
                        key={vendor}
                        heading={vendor}
                        className="[&_[cmdk-group-heading]]:break-words [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-neutral-400 dark:[&_[cmdk-group-heading]]:text-neutral-500"
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
                            className={cn(
                              "cursor-pointer break-all rounded-lg px-2.5 py-1.5 text-xs font-mono text-neutral-700 dark:text-neutral-300 hover:text-black dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors",
                              "data-[selected=true]:bg-black data-[selected=true]:text-white dark:data-[selected=true]:bg-white dark:data-[selected=true]:text-black",
                            )}
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
