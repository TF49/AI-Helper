import { useEffect, useState } from "react";
import {
  X,
  Terminal,
  BookOpen,
  Key,
  Copy,
  Check,
  ExternalLink,
  Palette,
} from "lucide-react";
import { toast } from "sonner";
import { openUrl } from "../lib/api";
import { OpenAIIcon, ClaudeIcon } from "./BrandIcons";
import { ThemeToggle } from "./ThemeToggle";

interface QuickToolsModalProps {
  open: boolean;
  onClose: () => void;
  activeTab: "chatgpt" | "claude";
  currentUrl: string;
  currentKey: string;
  currentModel: string;
}

export function QuickToolsModal({
  open,
  onClose,
  activeTab,
  currentUrl,
  currentKey,
  currentModel,
}: QuickToolsModalProps) {
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [selectedProtocol, setSelectedProtocol] = useState<"chatgpt" | "claude">(activeTab);

  useEffect(() => {
    setSelectedProtocol(activeTab);
  }, [activeTab, open]);

  if (!open) return null;

  const effectiveKey = currentKey || "YOUR_API_KEY";
  const effectiveModel =
    currentModel ||
    (selectedProtocol === "chatgpt" ? "gpt-4o" : "claude-3-7-sonnet-20250219");
  const base = currentUrl.endsWith("/") ? currentUrl : `${currentUrl}/`;

  const curlCommand =
    selectedProtocol === "chatgpt"
      ? `curl ${base}v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${effectiveKey}" \\\n  -d '{\n    "model": "${effectiveModel}",\n    "messages": [{"role": "user", "content": "Hi!"}]\n  }'`
      : `curl ${base}v1/messages \\\n  -H "Content-Type: application/json" \\\n  -H "x-api-key: ${effectiveKey}" \\\n  -H "anthropic-version: 2023-06-01" \\\n  -d '{\n    "model": "${effectiveModel}",\n    "max_tokens": 100,\n    "messages": [{"role": "user", "content": "Hi!"}]\n  }'`;

  const handleCopyCurl = async () => {
    try {
      await navigator.clipboard.writeText(curlCommand);
      setCopiedCurl(true);
      toast.success("已复制 cURL 测试脚本");
      setTimeout(() => setCopiedCurl(false), 2000);
    } catch {
      toast.error("复制失败");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121420] text-slate-800 dark:text-gray-200 shadow-2xl overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#161927]">
          <div className="flex items-center gap-2">
            <Terminal size={17} className="text-blue-600 dark:text-blue-400" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              工具箱与系统设置
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/10 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Section 0: Theme Switcher */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-gray-300 flex items-center gap-1.5">
                <Palette size={14} className="text-blue-500" />
                外观主题切换 (Theme)
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-gray-400">
              选择应用外观主题，支持浅色明亮模式、深色极客模式与跟随操作系统。
            </p>
            <ThemeToggle variant="pills" className="w-full justify-between" />
          </div>

          {/* Section 1: cURL Test snippet */}
          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-white/5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-gray-300 flex items-center gap-1.5">
                <Terminal
                  size={13}
                  className="text-emerald-600 dark:text-emerald-400"
                />
                终端测试命令 (cURL)
              </span>
              <div className="flex items-center gap-1.5">
                <div className="flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px]">
                  <button
                    type="button"
                    onClick={() => setSelectedProtocol("chatgpt")}
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer ${
                      selectedProtocol === "chatgpt"
                        ? "bg-blue-600 text-white shadow-2xs"
                        : "text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    <OpenAIIcon size={11} />
                    OpenAI
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedProtocol("claude")}
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-medium transition-colors cursor-pointer ${
                      selectedProtocol === "claude"
                        ? "bg-purple-600 text-white shadow-2xs"
                        : "text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    <ClaudeIcon size={11} />
                    Claude
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleCopyCurl}
                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:text-gray-300 dark:hover:text-white transition-colors border border-slate-200 dark:border-white/10 cursor-pointer"
                >
                  {copiedCurl ? (
                    <Check
                      size={12}
                      className="text-emerald-600 dark:text-emerald-400"
                    />
                  ) : (
                    <Copy size={12} />
                  )}
                  {copiedCurl ? "已复制" : "复制命令"}
                </button>
              </div>
            </div>
            <pre className="p-3 rounded-xl bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-white/5 font-mono text-[11px] text-slate-800 dark:text-gray-300 overflow-x-auto leading-relaxed">
              {curlCommand}
            </pre>
          </div>

          {/* Section 2: Environment Variables Reference */}
          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-white/5">
            <span className="text-xs font-semibold text-slate-700 dark:text-gray-300 flex items-center gap-1.5">
              <Key size={13} className="text-amber-600 dark:text-amber-400" />
              环境变量与配置说明
            </span>
            <div className="text-xs text-slate-600 dark:text-gray-400 space-y-2 bg-slate-50 dark:bg-[#161928]/60 p-3 rounded-xl border border-slate-200 dark:border-white/5">
              <p>
                •{" "}
                <strong className="text-slate-800 dark:text-gray-200">
                  ChatGPT (Codex)
                </strong>
                : API Key 会自动保存至 Windows 当前用户环境变量{" "}
                <code className="text-blue-600 dark:text-blue-300 font-mono font-medium">
                  CUSTOM_OPENAI_API_KEY
                </code>
                。
              </p>
              <p>
                •{" "}
                <strong className="text-slate-800 dark:text-gray-200">
                  Claude Code
                </strong>
                : API Key 会保存在用户目录下的{" "}
                <code className="text-amber-600 dark:text-amber-300 font-mono font-medium">
                  ~/.claude/settings.json
                </code>{" "}
                中的 <code className="font-mono">env.ANTHROPIC_AUTH_TOKEN</code>
                。
              </p>
              <p className="text-slate-400 dark:text-gray-500 text-[11px]">
                提示：修改配置后，请彻底关闭并重启对应的客户端（Codex / Claude
                CLI）以重新加载新配置。
              </p>
            </div>
          </div>

          {/* Section 3: Official Links */}
          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-white/5">
            <span className="text-xs font-semibold text-slate-700 dark:text-gray-300 flex items-center gap-1.5">
              <BookOpen
                size={13}
                className="text-purple-600 dark:text-purple-400"
              />
              快速入口
            </span>
            <div className="grid grid-cols-2 gap-2">
              <a
                href="https://bob-api.com"
                onClick={(e) => {
                  e.preventDefault();
                  void openUrl("https://bob-api.com");
                }}
                target="_blank"
                rel="noreferrer"
                title="在默认浏览器中打开 BobAPI 官方网站 (https://bob-api.com)"
                className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-white/[0.03] dark:hover:bg-white/[0.07] border border-slate-200 dark:border-white/5 text-xs text-slate-700 dark:text-gray-300 hover:text-slate-900 dark:hover:text-white transition-all active:scale-[0.98] cursor-pointer"
              >
                <span>BobAPI 官方网站</span>
                <ExternalLink
                  size={12}
                  className="text-slate-400 dark:text-gray-500"
                />
              </a>
              <a
                href="https://taijiai.online"
                onClick={(e) => {
                  e.preventDefault();
                  void openUrl("https://taijiai.online");
                }}
                target="_blank"
                rel="noreferrer"
                title="在默认浏览器中打开 TaijiAI 备用专线 (https://taijiai.online)"
                className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-white/[0.03] dark:hover:bg-white/[0.07] border border-slate-200 dark:border-white/5 text-xs text-slate-700 dark:text-gray-300 hover:text-slate-900 dark:hover:text-white transition-all active:scale-[0.98] cursor-pointer"
              >
                <span>TaijiAI 备用专线</span>
                <ExternalLink
                  size={12}
                  className="text-slate-400 dark:text-gray-500"
                />
              </a>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#141724] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-medium text-white transition-colors shadow-sm"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}

export default QuickToolsModal;
