import { useEffect, useState } from "react";
import {
  X,
  Bug,
  Lightbulb,
  HelpCircle,
  Send,
  Copy,
  Check,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import {
  getSystemDiagnosticInfo,
  submitFeishuFeedback,
  refreshAuthSession,
} from "../lib/api";
import type { FeedbackType, UserInfo } from "../types";
import { cn } from "../lib/utils";
import { ButtonToLoaderToSuccess } from "./ui/ButtonToLoaderToSuccess";

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
  appVersion: string;
  activeTab: "chatgpt" | "claude" | "workbuddy" | "acciowork" | "cursor" | "paths";
  networkState: "checking" | "reachable" | "unreachable";
  currentUser?: UserInfo | null;
  onRefreshAuth?: () => Promise<void>;
}

export function FeedbackModal({
  open,
  onClose,
  appVersion,
  activeTab,
  networkState,
  currentUser,
  onRefreshAuth,
}: FeedbackModalProps) {
  const [feedbackType, setFeedbackType] = useState<FeedbackType>("feature");
  const [content, setContent] = useState("");
  const [email, setEmail] = useState(() => {
    return currentUser?.email || localStorage.getItem("ai_helper_feedback_email") || "";
  });
  const [autoFilledEmail, setAutoFilledEmail] = useState<string | null>(
    () => currentUser?.email || null,
  );
  const [isFetchingEmail, setIsFetchingEmail] = useState(false);
  const [isEmailModifiedByUser, setIsEmailModifiedByUser] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [osInfo, setOsInfo] = useState("Windows 10");

  const targetName =
    activeTab === "claude"
      ? "Claude Code"
      : activeTab === "workbuddy"
        ? "WorkBuddy"
        : activeTab === "acciowork"
          ? "Accio Work"
          : activeTab === "paths"
            ? "应用与 CLI 路径"
            : "ChatGPT (Codex)";

  // 获取真实的操作系统诊断信息
  useEffect(() => {
    if (open) {
      void getSystemDiagnosticInfo()
        .then((info) => {
          if (info) setOsInfo(info);
        })
        .catch(() => {
          setOsInfo(navigator.platform || "Windows 10");
        });
    }
  }, [open]);

  // 根据类型生成对应的预填模板
  const getTemplate = (type: FeedbackType, os: string) => {
    if (type === "bug") {
      return `1. 软件版本: v${appVersion} | 系统版本: ${os} | 当前配置目标: ${targetName}\n2. BUG发生场景与复现步骤:\n   \n3. 预期行为与实际现象:\n   `;
    }
    if (type === "feature") {
      return `1. 软件版本: v${appVersion} | 系统版本: ${os}\n2. 您的建议与期望功能:\n   `;
    }
    return `1. 软件版本: v${appVersion} | 系统版本: ${os}\n2. 反馈内容:\n   `;
  };

  // 首次打开或模板状态同步
  useEffect(() => {
    if (open) {
      setContent(getTemplate(feedbackType, osInfo));
    }
  }, [open, feedbackType, osInfo]);

  // 打开弹窗时自动获取并预填用户登录邮箱 (支持 bob-api refresh 接口获取)，同时允许用户后续按需修改
  useEffect(() => {
    if (!open) return;

    setIsEmailModifiedByUser(false);

    // 1. 若当前登录用户已有 email，优先自动预填
    if (currentUser?.email) {
      setEmail(currentUser.email);
      setAutoFilledEmail(currentUser.email);
      setIsFetchingEmail(false);
      return;
    }

    // 2. 若用户已登录但当前对象尚未同步到 email，调用 refreshAuthSession (https://bob-api.com/api/user/auth/refresh)
    if (currentUser?.username) {
      setIsFetchingEmail(true);
      void refreshAuthSession()
        .then((res) => {
          if (res?.user?.email) {
            setEmail((prev) => (isEmailModifiedByUser ? prev : res.user.email || ""));
            setAutoFilledEmail(res.user.email);
            void onRefreshAuth?.();
          } else {
            const saved = localStorage.getItem("ai_helper_feedback_email");
            if (saved) setEmail((prev) => (prev ? prev : saved));
          }
        })
        .catch(() => {
          const saved = localStorage.getItem("ai_helper_feedback_email");
          if (saved) setEmail((prev) => (prev ? prev : saved));
        })
        .finally(() => {
          setIsFetchingEmail(false);
        });
      return;
    }

    // 3. 未登录用户，读取本地历史保存的邮箱
    setAutoFilledEmail(null);
    setIsFetchingEmail(false);
    const saved = localStorage.getItem("ai_helper_feedback_email");
    if (saved) setEmail(saved);
  }, [open, currentUser?.email, currentUser?.username]);

  if (!open) return null;

  const handleTypeChange = (newType: FeedbackType) => {
    setFeedbackType(newType);
    setContent(getTemplate(newType, osInfo));
  };

  // 组装格式化全文文本 (用于复制兜底或直接查看)
  const formatFullFeedbackText = () => {
    const typeLabel =
      feedbackType === "bug"
        ? "🐞 BUG反馈"
        : feedbackType === "feature"
          ? "💡 功能建议"
          : "❓ 其他";
    return `【${typeLabel}】
联系邮箱: ${email.trim() || "未填写"}
软件版本: v${appVersion}
系统环境: ${osInfo}
当前配置目标: ${targetName}
登录用户: ${currentUser?.username ? `@${currentUser.username}` : "未登录"}
官方网络: ${networkState === "reachable" ? "正常" : "异常"}

反馈内容:
${content.trim()}
`;
  };

  // 复制反馈全文到系统剪贴板
  const handleCopyOnly = async () => {
    try {
      await navigator.clipboard.writeText(formatFullFeedbackText());
      setCopied(true);
      toast.success("已将反馈内容完整复制到剪贴板");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("复制到剪贴板失败，请手动选取复制");
    }
  };

  const handleFeedbackAction = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      toast.error("请输入联系邮箱，方便我们与您跟进处理结果");
      throw new Error("Missing email");
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      toast.error("请输入有效格式的邮箱地址");
      throw new Error("Invalid email");
    }

    if (!content.trim()) {
      toast.error("请输入反馈内容");
      throw new Error("Missing content");
    }

    localStorage.setItem("ai_helper_feedback_email", trimmedEmail);

    try {
      const res = await submitFeishuFeedback({
        feedback_type: feedbackType,
        content: content.trim(),
        email: trimmedEmail,
        app_version: appVersion,
        os_info: osInfo,
        active_target: targetName,
        network_status: networkState === "reachable" ? "正常" : "异常",
        logged_in_user: currentUser?.username,
      });

      if (res.success) {
        toast.success(res.message || "反馈提交成功，感谢您的支持！");
      } else {
        await navigator.clipboard.writeText(formatFullFeedbackText());
        toast.warning(
          res.message || "飞书发送未成功，已自动将反馈内容复制到剪贴板！",
          { duration: 6000 },
        );
        throw new Error(res.message);
      }
    } catch (err: unknown) {
      console.error("提交反馈异常:", err);
      try {
        await navigator.clipboard.writeText(formatFullFeedbackText());
      } catch {}
      toast.error("提交异常，已将反馈内容复制到剪贴板备用", { duration: 4000 });
      throw err;
    }
  };

  // 直接提交到开发者的飞书机器人
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
  };

  return (
    <div className="fixed inset-0 top-11 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/75 backdrop-blur-md animate-fade-in select-none">
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121524] text-slate-800 dark:text-gray-200 shadow-2xl overflow-hidden animate-slide-up flex flex-col">
        {/* ── 弹窗头部 Header ── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-white/10 bg-slate-50/80 dark:bg-[#16192a]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-600 dark:text-cyan-400">
              <MessageSquare size={16} />
            </div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white tracking-wide">
              意见反馈
            </h3>
          </div>

          {/* 关闭按钮 */}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── 表单主体 Form ── */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* 1. 反馈类型选择器 */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-gray-300 mb-2">
              反馈类型
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              {/* BUG反馈 */}
              <button
                type="button"
                onClick={() => handleTypeChange("bug")}
                className={cn(
                  "py-2.5 px-3 rounded-xl border flex items-center justify-center gap-1.5 text-xs font-medium transition-all cursor-pointer",
                  feedbackType === "bug"
                    ? "border-cyan-500/80 bg-cyan-50/80 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 shadow-xs ring-1 ring-cyan-500/40"
                    : "border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/5 text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white",
                )}
              >
                <Bug
                  size={14}
                  className={
                    feedbackType === "bug"
                      ? "text-cyan-600 dark:text-cyan-400"
                      : "opacity-70"
                  }
                />
                <span>BUG反馈</span>
              </button>

              {/* 功能建议 */}
              <button
                type="button"
                onClick={() => handleTypeChange("feature")}
                className={cn(
                  "py-2.5 px-3 rounded-xl border flex items-center justify-center gap-1.5 text-xs font-medium transition-all cursor-pointer",
                  feedbackType === "feature"
                    ? "border-cyan-500/80 bg-cyan-50/80 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 shadow-xs ring-1 ring-cyan-500/40"
                    : "border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/5 text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white",
                )}
              >
                <Lightbulb
                  size={14}
                  className={
                    feedbackType === "feature"
                      ? "text-cyan-600 dark:text-cyan-400"
                      : "opacity-70"
                  }
                />
                <span>功能建议</span>
              </button>

              {/* 其他 */}
              <button
                type="button"
                onClick={() => handleTypeChange("other")}
                className={cn(
                  "py-2.5 px-3 rounded-xl border flex items-center justify-center gap-1.5 text-xs font-medium transition-all cursor-pointer",
                  feedbackType === "other"
                    ? "border-cyan-500/80 bg-cyan-50/80 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 shadow-xs ring-1 ring-cyan-500/40"
                    : "border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/5 text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white",
                )}
              >
                <HelpCircle
                  size={14}
                  className={
                    feedbackType === "other"
                      ? "text-cyan-600 dark:text-cyan-400"
                      : "opacity-70"
                  }
                />
                <span>其他</span>
              </button>
            </div>
          </div>

          {/* 2. 反馈内容输入框 (带高亮边框还原截图) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-600 dark:text-gray-300">
                反馈内容
              </label>
              <span className="text-[10px] text-slate-400 dark:text-gray-500">
                已自动填入当前客户端环境
              </span>
            </div>
            <textarea
              rows={7}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="请输入您的具体反馈或复现细节..."
              className="w-full p-3 rounded-xl text-xs font-sans leading-relaxed border border-cyan-500/60 dark:border-cyan-500/70 bg-white dark:bg-[#0c0e18]/90 text-slate-800 dark:text-gray-200 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition-all resize-none shadow-inner"
            />
          </div>

          {/* 3. 联系邮箱输入区 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-gray-300">
                邮箱{" "}
                <span className="text-rose-500 dark:text-rose-400 font-normal">
                  (必填)
                </span>
              </label>
              {autoFilledEmail ? (
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-gray-500">
                  <span>已自动填入登录邮箱，可按需修改</span>
                  {autoFilledEmail !== email.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        setEmail(autoFilledEmail);
                        setIsEmailModifiedByUser(false);
                      }}
                      className="text-cyan-600 dark:text-cyan-400 hover:underline cursor-pointer"
                    >
                      恢复原邮箱
                    </button>
                  )}
                </div>
              ) : null}
            </div>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setIsEmailModifiedByUser(true);
              }}
              placeholder={
                isFetchingEmail
                  ? "正在获取登录账号邮箱..."
                  : "请输入邮箱（必填，方便回复）"
              }
              className="w-full px-3.5 py-2.5 rounded-xl text-xs border border-slate-300 dark:border-white/10 bg-white dark:bg-[#0c0e18]/80 text-slate-800 dark:text-gray-200 placeholder:text-slate-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition-all shadow-inner"
            />
          </div>

          {/* ── 底部操作栏 Footer ── */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-200/80 dark:border-white/10">
            <span className="text-[11px] text-slate-400 dark:text-gray-500">
              感谢您的反馈，我们会认真处理
            </span>

            <div className="flex items-center gap-2">
              {/* 仅复制反馈内容按键 */}
              <button
                type="button"
                onClick={() => void handleCopyOnly()}
                className="h-8 px-2.5 rounded-xl text-xs font-medium border border-slate-200 dark:border-white/10 text-slate-600 hover:text-slate-900 dark:text-gray-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-colors flex items-center gap-1.5 cursor-pointer"
                title="复制格式化反馈信息到剪贴板"
              >
                {copied ? (
                  <Check size={12} className="text-emerald-500" />
                ) : (
                  <Copy size={12} />
                )}
                <span>{copied ? "已复制" : "仅复制内容"}</span>
              </button>

              {/* 取消按钮 */}
              <button
                type="button"
                onClick={onClose}
                className="h-8 px-3 rounded-xl text-xs font-medium text-slate-600 hover:text-slate-900 dark:text-gray-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
              >
                取消
              </button>

              {/* 提交按钮（状态形变链） */}
              <ButtonToLoaderToSuccess
                accent="blue"
                disabled={submitting || !content.trim()}
                className="h-8 px-4 rounded-xl text-xs font-semibold min-w-[110px]"
                idleLabel={
                  <>
                    <Send size={13} />
                    <span>提交反馈</span>
                  </>
                }
                successLabel="反馈已送达"
                resetAfterMs={null}
                holdMs={800}
                onAction={handleFeedbackAction}
                onBusyChange={setSubmitting}
                onComplete={onClose}
              />
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
