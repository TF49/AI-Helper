import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
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
  Search,
  Copy,
  CheckCheck,
  Eye,
  EyeOff,
  ShieldCheck,
  Zap,
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
import { SpotlightCard } from "../react-bits/SpotlightCard";
import { ShinyText } from "../react-bits/ShinyText";
import { DecryptedText } from "../react-bits/DecryptedText";
import { StarBorder } from "../react-bits/StarBorder";

export interface TokenSelectModalProps {
  open: boolean;
  selectedTokenId?: number | null;
  onSelectKey: (apiKey: string, token: TokenItem) => void;
  onClose: () => void;
  toolName?: string;
  accentColor?: "blue" | "purple" | "emerald" | "orange";
}

export function TokenSelectModal({
  open,
  selectedTokenId,
  onSelectKey,
  onClose,
  toolName = "当前工具",
  accentColor = "blue",
}: TokenSelectModalProps) {
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchingKeyId, setFetchingKeyId] = useState<number | null>(null);
  const [syncingKeyId, setSyncingKeyId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 搜索与过滤状态
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "active" | "selected">("all");

  // 查看真实明文 Key 缓存映射 (tokenId -> plainKey)
  const [revealedKeys, setRevealedKeys] = useState<Record<number, string>>({});
  const [revealingId, setRevealingId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // 新建 Token 表单状态
  const [showCreate, setShowCreate] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [creating, setCreating] = useState(false);

  // DOM 引用（供 GSAP 流畅动效）
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cardsContainerRef = useRef<HTMLDivElement>(null);
  const refreshIconRef = useRef<SVGSVGElement>(null);

  // 控制挂载生命周期以便于 GSAP 播放平滑退出动画
  const [isRendered, setIsRendered] = useState(open);
  const [isClosing, setIsClosing] = useState(false);

  // 颜色主题配置映射
  const theme = useMemo(() => {
    switch (accentColor) {
      case "purple":
        return {
          glowColor: "rgba(168, 85, 247, 0.16)",
          spotlightColor: "rgba(168, 85, 247, 0.14)",
          bgBadge: "bg-purple-500/10 text-purple-600 dark:text-purple-300 border-purple-500/25",
          btnPrimary: "bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-purple-500/20",
          cardSelected: "border-purple-500/90 bg-purple-50/70 dark:bg-purple-500/10 shadow-lg shadow-purple-500/10",
          accentText: "text-purple-600 dark:text-purple-400",
          ringColor: "focus:ring-purple-500/40",
          starColor: "#c084fc",
        };
      case "emerald":
        return {
          glowColor: "rgba(16, 185, 129, 0.16)",
          spotlightColor: "rgba(16, 185, 129, 0.14)",
          bgBadge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/25",
          btnPrimary: "bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-500/20",
          cardSelected: "border-emerald-500/90 bg-emerald-50/70 dark:bg-emerald-500/10 shadow-lg shadow-emerald-500/10",
          accentText: "text-emerald-600 dark:text-emerald-400",
          ringColor: "focus:ring-emerald-500/40",
          starColor: "#34d399",
        };
      case "orange":
        return {
          glowColor: "rgba(249, 115, 22, 0.16)",
          spotlightColor: "rgba(249, 115, 22, 0.14)",
          bgBadge: "bg-orange-500/10 text-orange-600 dark:text-orange-300 border-orange-500/25",
          btnPrimary: "bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white shadow-orange-500/20",
          cardSelected: "border-orange-500/90 bg-orange-50/70 dark:bg-orange-500/10 shadow-lg shadow-orange-500/10",
          accentText: "text-orange-600 dark:text-orange-400",
          ringColor: "focus:ring-orange-500/40",
          starColor: "#fb923c",
        };
      case "blue":
      default:
        return {
          glowColor: "rgba(59, 130, 246, 0.16)",
          spotlightColor: "rgba(59, 130, 246, 0.14)",
          bgBadge: "bg-blue-500/10 text-blue-600 dark:text-blue-300 border-blue-500/25",
          btnPrimary: "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-500/20",
          cardSelected: "border-blue-500/90 bg-blue-50/70 dark:bg-blue-500/10 shadow-lg shadow-blue-500/10",
          accentText: "text-blue-600 dark:text-blue-400",
          ringColor: "focus:ring-blue-500/40",
          starColor: "#60a5fa",
        };
    }
  }, [accentColor]);

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

  // 平滑关闭弹窗动画
  const handleSmoothClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);

    if (dialogRef.current && overlayRef.current) {
      const tl = gsap.timeline({
        onComplete: () => {
          setIsClosing(false);
          setIsRendered(false);
          onClose();
        },
      });

      tl.to(dialogRef.current, {
        opacity: 0,
        scale: 0.94,
        y: 18,
        duration: 0.22,
        ease: "power2.in",
      });

      tl.to(
        overlayRef.current,
        {
          opacity: 0,
          duration: 0.2,
          ease: "power2.in",
        },
        "-=0.12",
      );
    } else {
      setIsClosing(false);
      setIsRendered(false);
      onClose();
    }
  }, [isClosing, onClose]);

  // 监听 open 变化，控制渲染与 GSAP 打开动画
  useEffect(() => {
    if (open) {
      setIsRendered(true);
      setIsClosing(false);
      void loadTokens();
      setShowCreate(false);
      setNewTokenName("");
      setSearchQuery("");
      setFilterMode("all");
    } else if (isRendered && !isClosing) {
      handleSmoothClose();
    }
  }, [open, loadTokens]);

  // 执行 GSAP 打开弹窗的平滑弹性动画
  useEffect(() => {
    if (isRendered && !isClosing && overlayRef.current && dialogRef.current) {
      gsap.killTweensOf([overlayRef.current, dialogRef.current]);

      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });

      // 遮罩渐显与模糊
      tl.fromTo(
        overlayRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.28, ease: "power2.out" },
      );

      // 弹窗本体平滑滑入并带有细腻的弹性阻尼
      tl.fromTo(
        dialogRef.current,
        { opacity: 0, scale: 0.92, y: 26 },
        { opacity: 1, scale: 1, y: 0, duration: 0.42, ease: "back.out(1.18)" },
        "-=0.18",
      );
    }
  }, [isRendered, isClosing]);

  // 当卡片列表加载完成时，执行细腻的级联入场动效
  useEffect(() => {
    if (tokens.length > 0 && cardsContainerRef.current) {
      const items = cardsContainerRef.current.querySelectorAll(".token-card-item");
      if (items.length > 0) {
        gsap.fromTo(
          items,
          { opacity: 0, y: 14, scale: 0.98 },
          {
            opacity: 1,
            y: 0,
            scale: 1,
            stagger: 0.035,
            duration: 0.32,
            ease: "power2.out",
          },
        );
      }
    }
  }, [tokens.length, filterMode, searchQuery]);

  // 键盘 ESC 监听
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isRendered && !isClosing) {
        handleSmoothClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRendered, isClosing, handleSmoothClose]);

  // 点击刷新按钮的旋转动效
  const handleRefreshClick = () => {
    if (refreshIconRef.current) {
      gsap.to(refreshIconRef.current, {
        rotation: "+=360",
        duration: 0.65,
        ease: "power2.inOut",
      });
    }
    void loadTokens();
  };

  // 选择某个 Token
  const handleSelectToken = async (token: TokenItem) => {
    setFetchingKeyId(token.id);
    try {
      // 1. 获取明文 Key
      const plainKey = await getTokenKey(token.id);

      // 2. 记录当前选中状态
      await setSelectedToken(token.id, token.name);

      toast.success(`已为「${toolName}」成功关联 API Key：${token.name}`);
      onSelectKey(plainKey, token);
      handleSmoothClose();
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : "读取该 API Key 明文失败";
      toast.error(msg);
    } finally {
      setFetchingKeyId(null);
    }
  };

  // 一键全套同步至所有 Agent
  const handleApplyToAll = async (token: TokenItem) => {
    setSyncingKeyId(token.id);
    try {
      const plainKey = await getTokenKey(token.id);
      await setSelectedToken(token.id, token.name);

      const results = await applyApiKeyToAgents(plainKey);
      const successCount = Object.values(results).filter(Boolean).length;
      toast.success(
        `全套同步成功！已将「${token.name}」配置到 ${successCount} 个本地 Agent！`,
      );

      onSelectKey(plainKey, token);
      handleSmoothClose();
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : "全套同步失败";
      toast.error(msg);
    } finally {
      setSyncingKeyId(null);
    }
  };

  // 快速复制 Key 明文
  const handleCopyKey = async (token: TokenItem) => {
    try {
      let keyToCopy = revealedKeys[token.id];
      if (!keyToCopy) {
        keyToCopy = await getTokenKey(token.id);
        setRevealedKeys((prev) => ({ ...prev, [token.id]: keyToCopy }));
      }
      await navigator.clipboard.writeText(keyToCopy);
      setCopiedId(token.id);
      setTimeout(() => setCopiedId(null), 1800);
      toast.success(`已复制 ${token.name} 的 API Key`);
    } catch {
      toast.error("复制 API Key 失败");
    }
  };

  // 预览/隐藏明文 Key
  const handleToggleReveal = async (token: TokenItem) => {
    if (revealedKeys[token.id]) {
      setRevealedKeys((prev) => {
        const next = { ...prev };
        delete next[token.id];
        return next;
      });
      return;
    }

    setRevealingId(token.id);
    try {
      const plainKey = await getTokenKey(token.id);
      setRevealedKeys((prev) => ({ ...prev, [token.id]: plainKey }));
    } catch {
      toast.error("获取明文失败");
    } finally {
      setRevealingId(null);
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
      // 自动选中并绑定
      void handleSelectToken(created);
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : "创建 API Key 失败";
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  };

  // 过滤后的 Token 列表
  const filteredTokens = useMemo(() => {
    return tokens.filter((t) => {
      // 搜索词过滤
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = t.name.toLowerCase().includes(q);
        const matchesKey = t.key && t.key.toLowerCase().includes(q);
        if (!matchesName && !matchesKey) return false;
      }
      // 状态选项卡过滤
      if (filterMode === "active") return t.status === 1;
      if (filterMode === "selected") return selectedTokenId === t.id;
      return true;
    });
  }, [tokens, searchQuery, filterMode, selectedTokenId]);

  if (!isRendered || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/65 backdrop-blur-md select-none overflow-hidden"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleSmoothClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        className={cn(
          "relative w-full max-w-[620px] max-h-[88vh] bg-white/95 dark:bg-[#111320]/95 backdrop-blur-2xl",
          "border border-slate-200/90 dark:border-white/10 rounded-3xl shadow-2xl shadow-black/40",
          "flex flex-col overflow-hidden text-slate-800 dark:text-gray-200 transition-all duration-300",
        )}
        style={{
          boxShadow: `0 25px 60px -15px rgba(0, 0, 0, 0.4), 0 0 45px -10px ${theme.glowColor}`,
        }}
      >
        {/* 顶部环境光晕层 */}
        <div
          className="pointer-events-none absolute -top-24 -left-20 w-80 h-80 rounded-full blur-[90px] opacity-40 dark:opacity-30 transition-all"
          style={{ background: theme.glowColor }}
        />
        <div
          className="pointer-events-none absolute -bottom-24 -right-20 w-80 h-80 rounded-full blur-[90px] opacity-35 dark:opacity-20 transition-all"
          style={{ background: theme.glowColor }}
        />

        {/* ── 顶部栏：标题与操作 ── */}
        <div className="relative z-10 flex items-center justify-between px-6 py-4.5 border-b border-slate-100 dark:border-white/[0.07] flex-shrink-0 bg-white/50 dark:bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "w-10 h-10 rounded-2xl flex items-center justify-center font-bold shadow-md shadow-black/5 transition-transform duration-300 hover:scale-105",
                theme.bgBadge,
              )}
            >
              <KeyRound size={20} className="animate-pulse" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-1.5">
                  <DecryptedText
                    text="选择并关联 API Key"
                    speed={25}
                    maxIterations={8}
                    className="text-slate-900 dark:text-white"
                    encryptedClassName="text-slate-400 dark:text-gray-500"
                  />
                </h3>
                <span
                  className={cn(
                    "text-[11px] font-semibold px-2 py-0.5 rounded-full border",
                    theme.bgBadge,
                  )}
                >
                  目标: {toolName}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-0.5">
                点击卡片即可流畅绑定至 {toolName}，支持一键全套同步所有客户端 Agent
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={loading}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/10 active:scale-95 transition-all disabled:opacity-40 cursor-pointer"
              title="刷新列表"
            >
              <RefreshCw
                ref={refreshIconRef}
                size={16}
                className={loading ? "animate-spin text-blue-500" : ""}
              />
            </button>
            <button
              type="button"
              onClick={handleSmoothClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
              title="关闭"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* ── 搜索过滤与快捷新建工具条 ── */}
        <div className="relative z-10 px-6 py-3 bg-slate-50/80 dark:bg-black/25 border-b border-slate-100 dark:border-white/[0.06] flex flex-wrap items-center justify-between gap-2.5 text-xs">
          {/* 搜索框与标签选项卡 */}
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <div className="relative flex-1">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500 pointer-events-none"
              />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索 Key 名称或特征码..."
                className="h-8 pl-8 pr-7 text-xs bg-white dark:bg-black/40 border-slate-200/80 dark:border-white/10 rounded-xl"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-gray-300"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <div className="flex items-center p-0.5 rounded-lg bg-slate-200/60 dark:bg-white/5 border border-slate-200/50 dark:border-white/5 text-[11px]">
              <button
                type="button"
                onClick={() => setFilterMode("all")}
                className={cn(
                  "px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer",
                  filterMode === "all"
                    ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-2xs font-semibold"
                    : "text-slate-500 hover:text-slate-800 dark:text-gray-400 dark:hover:text-gray-200",
                )}
              >
                全部 ({tokens.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode("active")}
                className={cn(
                  "px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer",
                  filterMode === "active"
                    ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-2xs font-semibold"
                    : "text-slate-500 hover:text-slate-800 dark:text-gray-400 dark:hover:text-gray-200",
                )}
              >
                仅可用
              </button>
              {selectedTokenId && (
                <button
                  type="button"
                  onClick={() => setFilterMode("selected")}
                  className={cn(
                    "px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer",
                    filterMode === "selected"
                      ? "bg-white dark:bg-white/15 text-slate-900 dark:text-white shadow-2xs font-semibold"
                      : "text-slate-500 hover:text-slate-800 dark:text-gray-400 dark:hover:text-gray-200",
                  )}
                >
                  当前已关联
                </button>
              )}
            </div>
          </div>

          {/* 新建与外部通道按钮 */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCreate((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-semibold text-xs transition-all active:scale-95 cursor-pointer border shadow-2xs",
                showCreate
                  ? "bg-slate-200 text-slate-700 dark:bg-white/10 dark:text-gray-200 border-slate-300 dark:border-white/10"
                  : theme.bgBadge,
              )}
            >
              <Plus
                size={13}
                className={cn("transition-transform duration-200", showCreate && "rotate-45")}
              />
              <span>{showCreate ? "取消创建" : "新建 Key"}</span>
            </button>

            <button
              type="button"
              onClick={() => void openUrl("https://bob-api.com/keys")}
              className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700 dark:hover:text-gray-300 px-2 py-1 rounded-lg transition-colors cursor-pointer"
              title="前往 bob-api.com 网页控制台查看更多额度与日志"
            >
              <span>网页控制台</span>
              <ExternalLink size={11} />
            </button>
          </div>
        </div>

        {/* ── 新建 Token 展开表单（平滑折叠） ── */}
        <AnimatePresence>
          {showCreate && (
            <motion.form
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.24, ease: "easeOut" }}
              onSubmit={handleCreateToken}
              className="relative z-10 px-6 py-3.5 bg-gradient-to-r from-slate-100/90 to-slate-50/90 dark:from-white/[0.04] dark:to-white/[0.02] border-b border-slate-200/80 dark:border-white/[0.08] flex items-center gap-2.5 overflow-hidden"
            >
              <Input
                type="text"
                value={newTokenName}
                onChange={(e) => setNewTokenName(e.target.value)}
                placeholder={`输入新 Key 名称 (例如: ${toolName}-Special-Key)`}
                autoFocus
                className="flex-1 text-xs h-9 bg-white dark:bg-black/40 border-slate-300 dark:border-white/15 rounded-xl shadow-inner"
              />
              <StarBorder
                as="button"
                type="submit"
                disabled={creating || !newTokenName.trim()}
                color={theme.starColor}
                speed="3.5s"
                className="flex-shrink-0"
                innerClassName="px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              >
                {creating ? (
                  <div className="flex items-center gap-1.5">
                    <Loader2 size={13} className="animate-spin" />
                    <span>创建中...</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Zap size={13} className="text-amber-300" />
                    <span>创建并关联</span>
                  </div>
                )}
              </StarBorder>
            </motion.form>
          )}
        </AnimatePresence>

        {/* ── 令牌展示区域（核心内容区，内置 SpotlightCard） ── */}
        <div
          ref={cardsContainerRef}
          className="flex-1 overflow-y-auto p-5 space-y-3 min-h-[260px] max-h-[56vh] relative z-10"
        >
          {loading && tokens.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-gray-500 gap-3">
              <div className="relative">
                <Loader2 size={32} className="animate-spin text-blue-500" />
                <div
                  className="absolute inset-0 blur-lg opacity-40 rounded-full"
                  style={{ background: theme.glowColor }}
                />
              </div>
              <span className="text-xs font-medium tracking-wide">
                正在流畅加载您的 API Key 凭据列表...
              </span>
            </div>
          ) : errorMsg ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <AlertCircle size={28} className="text-rose-500" />
              <span className="text-xs text-rose-500 max-w-sm leading-relaxed">{errorMsg}</span>
              <button
                type="button"
                onClick={() => void loadTokens()}
                className="mt-1 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-md shadow-blue-500/20 cursor-pointer active:scale-95 transition-all"
              >
                重新加载
              </button>
            </div>
          ) : filteredTokens.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center text-slate-400 dark:text-gray-500 gap-2.5">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-white/5 flex items-center justify-center text-slate-300 dark:text-gray-600">
                <KeyRound size={26} />
              </div>
              <span className="text-xs font-semibold text-slate-600 dark:text-gray-300">
                {searchQuery ? "未找到匹配的 API Key" : "当前账号下暂无 API Key"}
              </span>
              <p className="text-[11px] max-w-xs text-slate-400 dark:text-gray-500">
                {searchQuery
                  ? "请尝试调整搜索关键词或重置筛选条件"
                  : "点击上方「新建 Key」，即可快速创建并在本工具中即刻生效。"}
              </p>
              {!searchQuery && (
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="mt-2 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 active:scale-95 transition-all shadow-md shadow-blue-500/20 cursor-pointer"
                >
                  <Plus size={13} />
                  <span>立即新建首个 Key</span>
                </button>
              )}
            </div>
          ) : (
            filteredTokens.map((token) => {
              const isSelected = selectedTokenId === token.id;
              const isFetchingThis = fetchingKeyId === token.id;
              const isSyncingThis = syncingKeyId === token.id;
              const isUsable = token.status === 1;
              const plainRevealedKey = revealedKeys[token.id];
              const isCopied = copiedId === token.id;

              return (
                <SpotlightCard
                  key={token.id}
                  spotlightColor={theme.spotlightColor}
                  className={cn(
                    "token-card-item p-3.5 rounded-2xl border transition-all duration-200 flex flex-col gap-2.5 group relative",
                    isSelected
                      ? theme.cardSelected
                      : "border-slate-200/80 dark:border-white/[0.07] bg-white/70 dark:bg-white/[0.03] hover:border-slate-300 dark:hover:border-white/20 hover:shadow-md",
                    !isUsable && "opacity-60",
                  )}
                >
                  {/* 卡片顶部：名称、状态、关联标识 */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-xs text-slate-900 dark:text-white tracking-wide truncate max-w-[240px]">
                          {token.name}
                        </span>

                        {/* 状态徽标 */}
                        {token.status === 1 ? (
                          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-100/90 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400 border border-emerald-300/40 dark:border-emerald-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            正常可用
                          </span>
                        ) : token.status === 2 ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400 border border-rose-300/40">
                            已禁用
                          </span>
                        ) : token.status === 3 ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 border border-amber-300/40">
                            已过期
                          </span>
                        ) : (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-400 border border-rose-300/40">
                            额度耗尽
                          </span>
                        )}

                        {/* 若当前工具关联了此 Key */}
                        {isSelected && (
                          <span
                            className={cn(
                              "text-[10px] px-2 py-0.5 rounded-full font-semibold border flex items-center gap-1 shadow-2xs",
                              theme.bgBadge,
                            )}
                          >
                            <Check size={11} className="stroke-[3]" />
                            <ShinyText text="当前工具已关联" speed={3} />
                          </span>
                        )}
                      </div>

                      {/* 详细指标行：额度、有效期、分组 */}
                      <div className="flex items-center gap-3.5 mt-2 text-[11px] text-slate-400 dark:text-gray-400 font-mono flex-wrap">
                        <span className="flex items-center gap-1 text-slate-600 dark:text-gray-300 font-medium">
                          <Coins size={12} className="text-amber-500" />
                          {token.unlimited_quota ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                              无限额度 ♾️
                            </span>
                          ) : (
                            <span>
                              剩余:{" "}
                              <strong className="text-slate-800 dark:text-white font-semibold">
                                ${(token.remain_quota / 500000).toFixed(2)}
                              </strong>
                            </span>
                          )}
                        </span>

                        <span className="flex items-center gap-1">
                          <Clock size={12} className="opacity-70" />
                          {token.expired_time === -1 ? (
                            "永久有效"
                          ) : (
                            <span>
                              {new Date(token.expired_time * 1000).toLocaleDateString("zh-CN")} 到期
                            </span>
                          )}
                        </span>

                        {token.group && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 border border-slate-200/50 dark:border-white/5">
                            分组: {token.group}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* 卡片快捷操作按钮组 */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* 主操作：关联到当前工具 */}
                      <button
                        type="button"
                        disabled={isFetchingThis || !isUsable}
                        onClick={() => void handleSelectToken(token)}
                        className={cn(
                          "px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all duration-200 active:scale-95 cursor-pointer shadow-sm",
                          isSelected
                            ? "bg-slate-200/80 dark:bg-white/10 text-slate-700 dark:text-gray-200 hover:bg-slate-300 dark:hover:bg-white/20 border border-slate-300/60 dark:border-white/10"
                            : theme.btnPrimary,
                        )}
                        title={`选择此 Key 并自动填入 ${toolName}`}
                      >
                        {isFetchingThis ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : isSelected ? (
                          <Check size={13} className="text-emerald-500 stroke-[3]" />
                        ) : (
                          <Check size={13} />
                        )}
                        <span>{isSelected ? "已关联当前" : "关联当前"}</span>
                      </button>

                      {/* 次操作：一键全套同步至 4 大 Agent */}
                      <button
                        type="button"
                        disabled={isSyncingThis || !isUsable}
                        onClick={() => void handleApplyToAll(token)}
                        title="一键将该 API Key 同步配置给 ChatGPT、Claude、Workbuddy、Accio 全套 4 大本地 Agent"
                        className="px-2.5 py-1.5 rounded-xl text-xs font-medium border border-slate-200 dark:border-white/10 bg-slate-50/60 dark:bg-white/[0.04] hover:bg-amber-50 hover:border-amber-300/80 dark:hover:bg-amber-500/10 dark:hover:border-amber-500/30 text-slate-600 hover:text-amber-700 dark:text-gray-300 dark:hover:text-amber-300 transition-all flex items-center gap-1 active:scale-95 cursor-pointer shadow-2xs"
                      >
                        {isSyncingThis ? (
                          <Loader2 size={12} className="animate-spin text-amber-500" />
                        ) : (
                          <Sparkles size={12} className="text-amber-500" />
                        )}
                        <span>全套同步</span>
                      </button>
                    </div>
                  </div>

                  {/* 卡片下半部：密钥显示栏、查看明文与一键复制 */}
                  <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-slate-100/70 dark:bg-black/30 border border-slate-200/60 dark:border-white/[0.05] text-[11px] font-mono">
                    <div className="flex items-center gap-2 truncate flex-1">
                      <KeyRound size={12} className="text-slate-400 dark:text-gray-500 flex-shrink-0" />
                      <span className="truncate text-slate-700 dark:text-gray-300 select-all">
                        {plainRevealedKey
                          ? plainRevealedKey
                          : token.key
                            ? `${token.key.substring(0, 8)}••••••••••••••••${token.key.substring(token.key.length - 4)}`
                            : "sk-••••••••••••••••••••••••"}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 flex-shrink-0">
                      {/* 查看明文切换按钮 */}
                      <button
                        type="button"
                        disabled={revealingId === token.id}
                        onClick={() => void handleToggleReveal(token)}
                        className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:text-gray-500 dark:hover:text-gray-200 hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
                        title={plainRevealedKey ? "隐藏明文" : "窥视完整 Key"}
                      >
                        {revealingId === token.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : plainRevealedKey ? (
                          <EyeOff size={13} />
                        ) : (
                          <Eye size={13} />
                        )}
                      </button>

                      {/* 复制按钮 */}
                      <button
                        type="button"
                        onClick={() => void handleCopyKey(token)}
                        className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:text-gray-500 dark:hover:text-gray-200 hover:bg-slate-200/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
                        title="复制 API Key 到剪贴板"
                      >
                        {isCopied ? (
                          <CheckCheck size={13} className="text-emerald-500" />
                        ) : (
                          <Copy size={13} />
                        )}
                      </button>
                    </div>
                  </div>
                </SpotlightCard>
              );
            })
          )}
        </div>

        {/* ── 底部控制栏与说明 ── */}
        <div className="relative z-10 px-6 py-3.5 border-t border-slate-100 dark:border-white/[0.07] bg-slate-50/70 dark:bg-black/25 flex items-center justify-between text-xs text-slate-500 dark:text-gray-400">
          <div className="flex items-center gap-1.5 text-[11px]">
            <ShieldCheck size={14} className={theme.accentText} />
            <span>凭据直接与节点专线通信，绝不上报云端。支持一键快速同步给全部 4 款 Agent。</span>
          </div>

          <button
            type="button"
            onClick={handleSmoothClose}
            className="px-4 py-1.5 rounded-xl font-medium text-xs text-slate-700 hover:text-slate-900 dark:text-gray-300 dark:hover:text-white bg-slate-200/80 hover:bg-slate-300/80 dark:bg-white/10 dark:hover:bg-white/15 transition-all active:scale-95 cursor-pointer"
          >
            完成
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default TokenSelectModal;
