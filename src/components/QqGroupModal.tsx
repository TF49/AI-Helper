import { Users, X, Copy, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import qqGroupQrcode from "../assets/qq-group-qrcode.jpg";

export const QQ_GROUP_DISMISSED_KEY = "ai_helper_qq_group_dismissed";
export const QQ_GROUP_NAME = "Bob API售后群";
export const QQ_GROUP_NUMBER = "1014463150";

interface QqGroupModalProps {
  open: boolean;
  onClose: () => void;
}

export function QqGroupModal({ open, onClose }: QqGroupModalProps) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const handleCopyGroupNumber = async () => {
    try {
      await navigator.clipboard.writeText(QQ_GROUP_NUMBER);
      setCopied(true);
      toast.success("群号已复制");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("复制失败，请手动抄写群号");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md select-none animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-3xl border border-slate-200/90 dark:border-white/10 bg-white dark:bg-[#121526] p-6 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center">
              <Users size={16} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                售后服务群
              </h3>
              <p className="text-[11px] text-slate-400 dark:text-gray-500">
                扫码加入 QQ 群获取支持
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

        <div className="pt-5 flex flex-col items-center gap-3">
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">
              {QQ_GROUP_NAME}
            </p>
            <button
              type="button"
              onClick={() => void handleCopyGroupNumber()}
              className="mt-1 inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400 hover:text-slate-800 dark:hover:text-gray-200 transition-colors cursor-pointer"
              title="点击复制群号"
            >
              <span>群号：{QQ_GROUP_NUMBER}</span>
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>

          <div className="rounded-2xl border border-slate-100 dark:border-white/10 bg-white p-2 shadow-sm">
            <img
              src={qqGroupQrcode}
              alt={`${QQ_GROUP_NAME} QQ 群二维码，群号 ${QQ_GROUP_NUMBER}`}
              className="w-56 h-auto rounded-xl block"
              draggable={false}
            />
          </div>

          <p className="text-[11px] text-slate-400 dark:text-gray-500 text-center">
            使用手机 QQ 扫一扫二维码，加入售后服务群
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
