import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  KeyRound,
  RefreshCw,
  Plus,
  Check,
  ExternalLink,
  X,
  Loader2,
  AlertCircle,
  Clock,
  Coins,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "../ui/input";
import {
  getUserTokens,
  getTokenKey,
  createUserToken,
  setSelectedToken,
  applyApiKeyToAgents,
  openUrl,
} from "../../lib/api";
import type { TokenItem } from "../../types";
import { cn } from "../../lib/utils";

interface TokenSelectModalProps {
  open: boolean;
  selectedTokenId?: number | null;
  onSelectKey: (apiKey: string, token: TokenItem) => void;
  onClose: () => void;
}

export function TokenSelectModal({
  open,
  selectedTokenId,
  onSelectKey,
  onClose,
}: TokenSelectModalProps) {
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchingKeyId, setFetchingKeyId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 新建 Token 表单状态
  const [showCreate, setShowCreate] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [creating, setCreating] = useState(false);

  // 加载令牌列表
  const loadTokens = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const items = await getUserTokens();
      setTokens(items);
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : "获取 API Key 列表失败，请确认是否已登录";
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadTokens();
      setShowCreate(false);
      setNewTokenName("");
    }
  }, [open, loadTokens]);

  // 选择某个 Token
  const handleSelectToken = async (
    token: TokenItem,
    applyToAll: boolean = false,
  ) => {
    setFetchingKeyId(token.id);
    try {
      // 1. 获取明文 Key
      const plainKey = await getTokenKey(token.id);

      // 2. 记录当前选中状态
      await setSelectedToken(token.id, token.name);

      // 3. 若用户勾选或选择一键应用到全部 Agent
      if (applyToAll) {
        const results = await applyApiKeyToAgents(plainKey);
        const successCount = Object.values(results).filter(Boolean).length;
        toast.success(
          `已成功将「${token.name}」配置到 ${successCount} 个本地 Agent！`,
        );
      } else {
        toast.success(`已选定 API Key: ${token.name}`);
      }

      onSelectKey(plainKey, token);
      onClose();
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : "读取该 API Key 明文失败";
      toast.error(msg);
    } finally {
      setFetchingKeyId(null);
    }
  };

  // 创建新 Token
  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTokenName.trim()) {
      toast.warning("请输入 Token 名称");
      return;
    }

    setCreating(true);
    try {
      const created = await createUserToken(newTokenName.trim());
      toast.success(`新 API Key「${created.name}」创建成功！`);
      setShowCreate(false);
      setNewTokenName("");
      // 自动选中新创建的 Key
      void handleSelectToken(created, false);
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : "创建 API Key 失败";
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.15 }}
          className="relative w-full max-w-[540px] max-h-[85vh] bg-white dark:bg-[#141724] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-800 dark:text-gray-200"
        >
          {/* 顶栏 */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-white/5 flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
                <KeyRound size={17} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span>选择 bob-api.com API Key</span>
                  <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-500">
                    共 {tokens.length} 个
                  </span>
                </h3>
                <p className="text-[11px] text-slate-400 dark:text-gray-500">
                  选择您在平台上创建的凭据，自动填入并配置调用环境
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void loadTokens()}
                disabled={loading}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors disabled:opacity-40 cursor-pointer"
                title="刷新列表"
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* 快捷操作条：新建与外部管理 */}
          <div className="px-5 py-2.5 bg-slate-50/70 dark:bg-black/20 border-b border-slate-100 dark:border-white/5 flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => setShowCreate((v) => !v)}
              className="flex items-center gap-1.5 font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors cursor-pointer"
            >
              <Plus size={14} />
              <span>{showCreate ? "取消创建" : "在此新建 API Key"}</span>
            </button>

            <button
              type="button"
              onClick={() => void openUrl("https://bob-api.com/keys")}
              className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-gray-300 transition-colors cursor-pointer"
            >
              <span>前往网页端管理</span>
              <ExternalLink size={11} />
            </button>
          </div>

          {/* 新建 Token 展开输入表单 */}
          {showCreate && (
            <motion.form
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              onSubmit={handleCreateToken}
              className="px-5 py-3 bg-blue-50/50 dark:bg-blue-500/5 border-b border-blue-100 dark:border-blue-500/10 flex items-center gap-2"
            >
              <Input
                type="text"
                value={newTokenName}
                onChange={(e) => setNewTokenName(e.target.value)}
                placeholder="输入新 Key 名称 (例如: AI-Helper-Mac)"
                autoFocus
                className="flex-1 text-xs h-9 bg-white dark:bg-black/30 border-blue-200 dark:border-blue-500/30"
              />
              <button
                type="submit"
                disabled={creating || !newTokenName.trim()}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 transition-colors cursor-pointer"
              >
                {creating ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                创建并选择
              </button>
            </motion.form>
          )}

          {/* 令牌列表区域 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2.5 min-h-[220px]">
            {loading && tokens.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400 dark:text-gray-500 gap-2">
                <Loader2 size={24} className="animate-spin text-blue-500" />
                <span className="text-xs">正在获取您在 bob-api 的 API Key 列表...</span>
              </div>
            ) : errorMsg ? (
              <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                <AlertCircle size={24} className="text-red-500" />
                <span className="text-xs text-red-500 max-w-sm">{errorMsg}</span>
                <button
                  type="button"
                  onClick={() => void loadTokens()}
                  className="mt-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium cursor-pointer"
                >
                  重试
                </button>
              </div>
            ) : tokens.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-slate-400 dark:text-gray-500 gap-2">
                <KeyRound size={28} className="opacity-30" />
                <span className="text-xs font-medium">当前账号下暂无 API Key</span>
                <p className="text-[11px] max-w-xs">
                  您可以点击上方「在此新建 API Key」，或者前往 bob-api.com 控制台生成。
                </p>
              </div>
            ) : (
              tokens.map((token) => {
                const isSelected = selectedTokenId === token.id;
                const isFetchingThis = fetchingKeyId === token.id;
                const isUsable = token.status === 1;

                return (
                  <div
                    key={token.id}
                    className={cn(
                      "p-3 rounded-xl border transition-all flex flex-col gap-2 relative group",
                      isSelected
                        ? "border-blue-500/80 bg-blue-50/70 dark:bg-blue-500/10 dark:border-blue-500/40"
                        : "border-slate-200/90 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] hover:bg-slate-100/80 dark:hover:bg-white/5",
                      !isUsable && "opacity-60",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-slate-900 dark:text-white truncate">
                            {token.name}
                          </span>
                          {/* 状态徽标 */}
                          {token.status === 1 ? (
                            <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                              正常
                            </span>
                          ) : token.status === 2 ? (
                            <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400">
                              已禁用
                            </span>
                          ) : token.status === 3 ? (
                            <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                              已过期
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400">
                              额度耗尽
                            </span>
                          )}
                          {isSelected && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded font-medium bg-blue-600 text-white flex items-center gap-0.5">
                              <Check size={10} />
                              当前使用中
                            </span>
                          )}
                        </div>

                        {/* 掩码 Key 与详细信息 */}
                        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-400 dark:text-gray-500 font-mono">
                          <span className="bg-slate-200/60 dark:bg-white/5 px-1.5 py-0.5 rounded text-[10px]">
                            {token.key || "sk-***"}
                          </span>
                          <span className="flex items-center gap-1">
                            <Coins size={11} />
                            {token.unlimited_quota
                              ? "无限额度"
                              : `剩余: $${(token.remain_quota / 500000).toFixed(2)}`}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock size={11} />
                            {token.expired_time === -1 ? "永久有效" : "限期有效"}
                          </span>
                        </div>
                      </div>

                      {/* 操作按钮组 */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {/* 按钮 1: 仅应用到当前输入项 */}
                        <button
                          type="button"
                          disabled={isFetchingThis}
                          onClick={() => void handleSelectToken(token, false)}
                          className={cn(
                            "px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer",
                            isSelected
                              ? "bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-gray-200 hover:bg-slate-300 dark:hover:bg-white/20"
                              : "bg-blue-600 hover:bg-blue-700 text-white shadow-xs shadow-blue-500/20",
                          )}
                        >
                          {isFetchingThis ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Check size={12} />
                          )}
                          <span>{isSelected ? "已选定" : "选择"}</span>
                        </button>

                        {/* 按钮 2: 一键同步到所有 Agent */}
                        <button
                          type="button"
                          disabled={isFetchingThis}
                          onClick={() => void handleSelectToken(token, true)}
                          title="一键将该 API Key 同步配置给 ChatGPT、Claude、WorkBuddy、Accio 所有本地 Agent"
                          className="px-2 py-1 rounded-lg text-xs font-medium border border-slate-200 dark:border-white/10 hover:bg-blue-50 hover:border-blue-300 dark:hover:bg-blue-500/10 dark:hover:border-blue-500/30 text-slate-600 dark:text-gray-300 transition-colors flex items-center gap-1 cursor-pointer"
                        >
                          <Sparkles size={11} className="text-amber-500" />
                          <span>全套同步</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 底栏说明 */}
          <div className="px-5 py-3 border-t border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-black/20 flex items-center justify-between text-[11px] text-slate-400 dark:text-gray-500">
            <span>
              💡 提示：点击「全套同步」可自动将选中的 Key 写入所有本地 Agent 的配置文件。
            </span>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-600 dark:text-gray-300 hover:underline font-medium cursor-pointer"
            >
              完成
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

export default TokenSelectModal;
