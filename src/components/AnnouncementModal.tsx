import { Bell, ExternalLink } from "lucide-react";
import { openUrl } from "../lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

interface AnnouncementModalProps {
  open: boolean;
  onClose: () => void;
  appVersion: string;
}

export const LATEST_ANNOUNCEMENT_ID = "v1.0.65";

const ANNOUNCEMENTS = [
  {
    id: "v1.0.65",
    title: "AI Helper v1.0.65 全新工作台与设置中心上线",
    date: "2026-10-16",
    content:
      "本次版本全面升级了客户端左侧导航栏：引入一体化工作台将四大工具（Codex、Claude Code、WorkBuddy、Accio Work）整合展示；新增独立设置中心，支持 Windows 开机自动启动、最小化至托盘与多语言切换设置；优化了各工具间的配置流转体验。",
    tag: "重大更新",
  },
  {
    id: "v1.0.62",
    title: "Accio Work Bridge 智能反代与通道多分组健康监控发布",
    date: "2026-10-10",
    content:
      "支持本地自动化唤起 Accio Work 专属网关 Bridge，并引入多维度通道监控大盘，支持实时观测 API 请求成功率与延迟响应。",
    tag: "功能升级",
  },
];

export function AnnouncementModal({
  open,
  onClose,
  appVersion,
}: AnnouncementModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col p-6 gap-0">
        {/* 头部 */}
        <DialogHeader className="pb-4 border-b border-slate-100 dark:border-white/5 flex flex-row items-center justify-between text-left pr-6">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Bell size={16} />
            </div>
            <div>
              <DialogTitle className="text-sm font-bold text-slate-900 dark:text-white">
                公告中心与更新历史
              </DialogTitle>
              <DialogDescription className="text-[11px] text-slate-400 dark:text-gray-500 mt-0.5">
                当前运行版本: v{appVersion}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* 公告列表 */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1 my-1">
          {ANNOUNCEMENTS.map((item) => (
            <div
              key={item.id}
              className="p-4 rounded-2xl border border-slate-200/70 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02]"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  {item.title}
                </span>
                <Badge variant="default" className="text-[10px] px-2 py-0.2 shrink-0">
                  {item.tag}
                </Badge>
              </div>
              <p className="text-xs text-slate-600 dark:text-gray-300 leading-relaxed">
                {item.content}
              </p>
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-200/40 dark:border-white/5 text-[10px] text-slate-400 dark:text-gray-500">
                <span>发布日期: {item.date}</span>
                <span>版本: {item.id}</span>
              </div>
            </div>
          ))}
        </div>

        {/* 底部关闭与官网跳转 */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-white/5">
          <button
            type="button"
            onClick={() => void openUrl("https://bob-api.com")}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
          >
            <span>访问官网查看更多</span>
            <ExternalLink size={12} />
          </button>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onClose}
          >
            我知道了
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
