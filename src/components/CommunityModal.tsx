import { Users, X, Copy, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  COMMUNITY_CHANNEL_META,
  type CommunityChannel,
  type CommunityChannelId,
} from "../lib/communityConfig";

/** 沿用旧版「售后 QQ 群」的键名：已经关掉过自动提示的用户不会再被打扰 */
export const COMMUNITY_DISMISSED_KEY = "ai_helper_qq_group_dismissed";

interface CommunityModalProps {
  open: boolean;
  onClose: () => void;
  /** 后台配置的、带二维码的渠道；为空时弹窗不显示 */
  channels: CommunityChannel[];
}

/**
 * 加入社群：QQ 群、微信群、抖音。名称、账号和二维码由管理员在后台配置，
 * 这里只把它们当作文字和图片展示。
 */
export function CommunityModal({ open, onClose, channels }: CommunityModalProps) {
  const [activeId, setActiveId] = useState<CommunityChannelId>("qq");
  const [copied, setCopied] = useState(false);

  // 当前选中的渠道被后台停用后，回到第一个可用渠道
  const active = channels.find((channel) => channel.id === activeId) ?? channels[0];

  useEffect(() => {
    setCopied(false);
  }, [activeId, open]);

  if (!open || !active) return null;

  const meta = COMMUNITY_CHANNEL_META[active.id];

  const handleCopyAccount = async () => {
    try {
      await navigator.clipboard.writeText(active.account);
      setCopied(true);
      toast.success(`${meta.accountLabel}已复制`);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(`复制失败，请手动抄写${meta.accountLabel}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md select-none animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="加入社群"
        className="relative w-full max-w-sm rounded-3xl border border-slate-200/90 dark:border-white/10 bg-white dark:bg-[#121526] p-6 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center">
              <Users size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">加入社群</h3>
              <p className="text-[11px] text-slate-400 dark:text-gray-500">
                扫码找到我们，获取帮助和最新消息
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="关闭"
          >
            <X size={15} />
          </button>
        </div>

        {channels.length > 1 && (
          <div
            role="tablist"
            aria-label="社群渠道"
            className="mt-4 flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-white/5"
          >
            {channels.map((channel) => {
              const selected = channel.id === active.id;
              return (
                <button
                  key={channel.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveId(channel.id)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    selected
                      ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-sm"
                      : "text-slate-500 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-200"
                  }`}
                >
                  {COMMUNITY_CHANNEL_META[channel.id].title}
                </button>
              );
            })}
          </div>
        )}

        <div className="pt-5 flex flex-col items-center gap-3">
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{active.name}</p>
            {active.account && (
              <button
                type="button"
                onClick={() => void handleCopyAccount()}
                className="mt-1 inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-200 transition-colors cursor-pointer"
                title={`点击复制${meta.accountLabel}`}
              >
                <span>
                  {meta.accountLabel}：{active.account}
                </span>
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            )}
          </div>

          <div className="rounded-2xl border border-slate-100 dark:border-white/10 bg-white p-2 shadow-sm">
            <img
              src={active.qrImage}
              alt={`${active.name} ${meta.title}二维码`}
              className="w-56 h-56 object-contain rounded-xl block"
              draggable={false}
            />
          </div>

          <p className="text-[11px] text-slate-400 dark:text-gray-500 text-center">
            {active.hint || meta.defaultHint}
          </p>
        </div>

        <div className="flex justify-end pt-5 mt-1 border-t border-slate-100 dark:border-white/5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 text-slate-700 dark:text-gray-200 text-xs font-semibold transition-colors cursor-pointer"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  );
}
