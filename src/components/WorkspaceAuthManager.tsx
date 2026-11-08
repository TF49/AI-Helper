import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, FolderLock, Loader2, ShieldAlert, ShieldCheck, Undo2, X } from "lucide-react";
import {
  denyAgentWorkspaceRequest,
  grantAgentWorkspace,
  listAgentWorkspaceGrants,
  listAgentWorkspaceRequests,
  revokeAgentWorkspace,
} from "../lib/api";
import type { AgentWorkspaceGrant, AgentWorkspaceRequest } from "../types";

/**
 * 待授权请求只保存在后端内存中，由 Agent 的写入工具在被拒绝时登记。
 * 面板打开期间每 3 秒轮询一次：列表读取是纯内存操作，代价很低；
 * 相比后端主动推送 Tauri 事件，轮询不需要让 Agent 模块持有 AppHandle，
 * 面板关闭后也不会有任何监听残留。
 */
const REQUEST_POLL_INTERVAL_MS = 3000;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function WorkspaceAuthManager() {
  const [requests, setRequests] = useState<AgentWorkspaceRequest[]>([]);
  const [grants, setGrants] = useState<AgentWorkspaceGrant[]>([]);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const mounted = useRef(true);

  const refreshRequests = useCallback(async () => {
    try {
      const next = await listAgentWorkspaceRequests();
      if (!mounted.current) return;
      setRequests((prev) =>
        prev.length === next.length && prev.every((item, i) => item.path === next[i].path)
          ? prev
          : next,
      );
    } catch {
      // 轮询失败时保留当前列表，下次轮询再试
    }
  }, []);

  const refreshGrants = useCallback(async () => {
    try {
      const next = await listAgentWorkspaceGrants();
      if (mounted.current) setGrants(next);
    } catch (error) {
      if (mounted.current) toast.error(`读取工作区授权失败：${errorText(error)}`);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshRequests();
    void refreshGrants();
    const timer = setInterval(() => void refreshRequests(), REQUEST_POLL_INTERVAL_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refreshRequests, refreshGrants]);

  const runAction = async (path: string, action: () => Promise<void>, success: string) => {
    setBusyPath(path);
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      if (mounted.current) setBusyPath(null);
      await Promise.all([refreshRequests(), refreshGrants()]);
    }
  };

  const rowClass =
    "flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-slate-200/80 dark:border-white/10 bg-white/70 dark:bg-white/5";
  const buttonClass =
    "flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="w-full p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 bg-white/80 dark:bg-black/60 shadow-sm flex flex-col gap-4">
      <div className="flex items-start gap-2 pb-3 border-b border-slate-100 dark:border-white/5">
        <FolderLock size={18} className="text-slate-700 dark:text-gray-200 mt-0.5 flex-shrink-0" />
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-white">
            Agent 工作区授权
          </div>
          <p className="text-[11px] text-slate-500 dark:text-gray-400 mt-0.5 leading-relaxed">
            Cursor Agent 可以读取当前工作区；写入、替换、新建目录和删除（移入回收站）需要先在这里允许。
            .git 目录始终禁止修改。
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-gray-300">
          <ShieldAlert size={13} className="text-amber-500" />
          <span>待授权请求</span>
          {requests.length > 0 && (
            <span className="text-[10px] font-mono px-1.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30">
              {requests.length}
            </span>
          )}
        </div>
        {requests.length === 0 ? (
          <p className="text-[11px] text-slate-400 dark:text-gray-500 px-1">
            暂无请求。Agent 尝试修改未授权工作区时，请求会出现在这里。
          </p>
        ) : (
          requests.map((request) => (
            <div key={request.path} className={rowClass}>
              <span
                className="text-xs font-mono text-slate-700 dark:text-gray-200 truncate"
                title={request.path}
              >
                {request.path}
              </span>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  type="button"
                  disabled={busyPath !== null}
                  onClick={() =>
                    void runAction(
                      request.path,
                      () => grantAgentWorkspace(request.path),
                      "已允许 Agent 修改该工作区",
                    )
                  }
                  className={`${buttonClass} bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-700 dark:text-emerald-400`}
                >
                  {busyPath === request.path ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Check size={11} />
                  )}
                  <span>允许</span>
                </button>
                <button
                  type="button"
                  disabled={busyPath !== null}
                  onClick={() =>
                    void runAction(
                      request.path,
                      () => denyAgentWorkspaceRequest(request.path),
                      "已拒绝该工作区请求",
                    )
                  }
                  className={`${buttonClass} bg-white hover:bg-slate-50 border-slate-200 text-slate-700 dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/10 dark:text-gray-300`}
                >
                  <X size={11} />
                  <span>拒绝</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-gray-300">
          <ShieldCheck size={13} className="text-emerald-500" />
          <span>已授权工作区</span>
        </div>
        {grants.length === 0 ? (
          <p className="text-[11px] text-slate-400 dark:text-gray-500 px-1">尚未授权任何工作区。</p>
        ) : (
          grants.map((grant) => (
            <div key={grant.path} className={rowClass}>
              <span
                className="text-xs font-mono text-slate-700 dark:text-gray-200 truncate"
                title={grant.path}
              >
                {grant.path}
              </span>
              <button
                type="button"
                disabled={busyPath !== null}
                onClick={() =>
                  void runAction(
                    grant.path,
                    () => revokeAgentWorkspace(grant.path),
                    "已撤销该工作区的写入授权",
                  )
                }
                className={`${buttonClass} flex-shrink-0 bg-white hover:bg-red-50 border-slate-200 text-red-600 dark:bg-white/5 dark:hover:bg-red-500/10 dark:border-white/10 dark:text-red-400`}
              >
                {busyPath === grant.path ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Undo2 size={11} />
                )}
                <span>撤销</span>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
