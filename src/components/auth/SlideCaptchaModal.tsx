import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { Loader2, RefreshCw, X, ShieldCheck, AlertCircle } from "lucide-react";
import { generateCaptcha, verifyCaptcha } from "../../lib/api";
import type { CaptchaGenerateData } from "../../types";

interface SlideCaptchaModalProps {
  open: boolean;
  onSuccess: () => void;
  onClose: () => void;
}

export function SlideCaptchaModal({
  open,
  onSuccess,
  onClose,
}: SlideCaptchaModalProps) {
  const [captchaData, setCaptchaData] = useState<CaptchaGenerateData | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 内部坐标始终保存在“原图坐标系”中：x 范围 [0, master_width - tile_width]
  const [originX, setOriginX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartXRef = useRef(0);
  const dragStartOriginXRef = useRef(0);
  const currentXRef = useRef(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const [displayScale, setDisplayScale] = useState(1);

  // 加载滑块挑战
  const loadChallenge = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    setOriginX(0);
    currentXRef.current = 0;
    try {
      const data = await generateCaptcha();
      setCaptchaData(data);
    } catch (err: unknown) {
      setErrorMsg(
        typeof err === "string" ? err : "获取滑块验证码失败，请重试",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadChallenge();
    } else {
      setCaptchaData(null);
      setErrorMsg(null);
      setOriginX(0);
      currentXRef.current = 0;
    }
  }, [open, loadChallenge]);

  // 根据容器计算缩放比例 s = display_width / master_width
  useEffect(() => {
    if (!containerRef.current || !captchaData) return;
    if (containerRef.current.clientWidth > 0 && captchaData.master_width > 0) {
      setDisplayScale(containerRef.current.clientWidth / captchaData.master_width);
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width > 0 && captchaData.master_width > 0) {
          setDisplayScale(width / captchaData.master_width);
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [captchaData]);

  const maxX = captchaData
    ? Math.max(0, captchaData.master_width - captchaData.tile_width)
    : 250;

  // 提交滑块校验
  const submitVerification = async (finalX: number) => {
    if (!captchaData || verifying) return;
    setVerifying(true);
    setErrorMsg(null);

    try {
      await verifyCaptcha(captchaData.captcha_id, finalX, captchaData.thumb_display_y);
      onSuccess();
    } catch (err: unknown) {
      setErrorMsg(typeof err === "string" ? err : "验证失败，请重新尝试");
      // 按照 PRD 规范：校验失败后必须换新图
      void loadChallenge();
    } finally {
      setVerifying(false);
    }
  };

  // 处理拖动滑块条
  const handlePointerDown = (e: React.PointerEvent) => {
    if (verifying || loading || !captchaData) return;
    setIsDragging(true);
    dragStartXRef.current = e.clientX;
    dragStartOriginXRef.current = originX;
    currentXRef.current = originX;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !captchaData) return;
    const deltaPixel = e.clientX - dragStartXRef.current;
    // 换算成原图位移量：deltaOrigin = deltaPixel / displayScale
    const deltaOrigin = deltaPixel / (displayScale || 1);
    const newX = Math.max(
      0,
      Math.min(maxX, Math.round(dragStartOriginXRef.current + deltaOrigin)),
    );
    currentXRef.current = newX;
    setOriginX(newX);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    // 未发生有效拖动时不重复提交
    if (currentXRef.current <= 0) return;
    void submitVerification(currentXRef.current);
  };

  if (!open || typeof document === "undefined") return null;

  const displayHeight = captchaData
    ? captchaData.master_height * displayScale
    : 180;
  const tileDisplayWidth = captchaData
    ? captchaData.tile_width * displayScale
    : 50;
  const tileDisplayHeight = captchaData
    ? captchaData.tile_height * displayScale
    : 50;
  const tileDisplayTop = captchaData
    ? captchaData.thumb_display_y * displayScale
    : 40;
  const tileDisplayLeft = originX * displayScale;

  const sliderPercent = maxX > 0 ? (originX / maxX) * 100 : 0;

  return createPortal(
    <AnimatePresence>
      <div
        className="fixed inset-0 top-11 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none"
        onClick={(e) => {
          if (!verifying && e.target === e.currentTarget) {
            onClose();
          }
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.15 }}
          className="relative w-full max-w-[360px] bg-white dark:bg-[#141724] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden p-5 flex flex-col gap-4 text-slate-800 dark:text-gray-200"
        >
          {/* 顶栏：标题与换一张、关闭 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-blue-500" />
              <span className="text-sm font-semibold text-slate-900 dark:text-white">
                完成安全滑块验证
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void loadChallenge()}
                disabled={loading || verifying}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors disabled:opacity-40 cursor-pointer"
                title="换一张"
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={verifying}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
                title="取消"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* 图片展示与拼图区域 */}
          <div
            ref={containerRef}
            className="relative w-full bg-slate-100 dark:bg-black/40 rounded-xl overflow-hidden border border-slate-200/80 dark:border-white/10 flex items-center justify-center min-h-[180px]"
            style={{ height: displayHeight || 180 }}
          >
            {loading ? (
              <div className="flex flex-col items-center gap-2 text-slate-400 dark:text-gray-500">
                <Loader2 size={24} className="animate-spin text-blue-500" />
                <span className="text-xs">加载验证码图片...</span>
              </div>
            ) : captchaData ? (
              <>
                {/* 背景大图 */}
                <img
                  src={captchaData.master_image}
                  alt="Captcha Master"
                  className="w-full h-full object-cover block pointer-events-none"
                  draggable={false}
                />

                {/* 浮动拼图块 */}
                <div
                  className="absolute pointer-events-none drop-shadow-md"
                  style={{
                    width: tileDisplayWidth,
                    height: tileDisplayHeight,
                    top: tileDisplayTop,
                    left: tileDisplayLeft,
                  }}
                >
                  <img
                    src={captchaData.tile_image}
                    alt="Captcha Tile"
                    className="w-full h-full object-contain pointer-events-none"
                    draggable={false}
                  />
                </div>

                {/* 校验中遮罩 */}
                {verifying && (
                  <div className="absolute inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center gap-2 text-white text-xs font-medium">
                    <Loader2 size={16} className="animate-spin" />
                    <span>校验中...</span>
                  </div>
                )}
              </>
            ) : errorMsg ? (
              <div className="flex flex-col items-center gap-2 p-4 text-center">
                <AlertCircle size={20} className="text-red-500" />
                <span className="text-xs text-red-500">{errorMsg}</span>
                <button
                  type="button"
                  onClick={() => void loadChallenge()}
                  className="mt-1 px-3 py-1 bg-blue-500 text-white rounded-lg text-xs font-medium cursor-pointer"
                >
                  重试
                </button>
              </div>
            ) : null}
          </div>

          {/* 错误提示条 */}
          {errorMsg && !loading && (
            <div className="text-[11px] text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-500/10 px-2.5 py-1.5 rounded-lg flex items-center gap-1.5">
              <AlertCircle size={13} className="flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* 下方拖动滑块轨道 */}
          <div className="space-y-1.5">
            <div
              className="relative w-full h-10 bg-slate-100 dark:bg-black/30 border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden flex items-center select-none touch-none"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              {/* 已经拖动的进度条高亮 */}
              <div
                className={`absolute left-0 top-0 bottom-0 bg-blue-500/20 dark:bg-blue-500/30 pointer-events-none ${
                  isDragging ? "" : "transition-all duration-200"
                }`}
                style={{ width: `${sliderPercent}%` }}
              />

              {/* 轨道中央引导提示文字 */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-400 dark:text-gray-500 text-xs">
                {isDragging ? "松开完成验证" : "按住滑块向右拖动完成拼图"}
              </div>

              {/* 滑块手柄 */}
              <div
                className={`absolute top-1 bottom-1 w-10 bg-white dark:bg-blue-600 rounded-lg shadow-md border border-slate-200 dark:border-blue-400 flex items-center justify-center text-slate-600 dark:text-white cursor-grab active:cursor-grabbing hover:scale-105 active:scale-95 ${
                  isDragging ? "transition-transform" : "transition-all duration-200"
                }`}
                style={{
                  left: `calc(${sliderPercent}% - ${sliderPercent * 0.4}px)`,
                }}
              >
                <div className="flex items-center gap-0.5 pointer-events-none">
                  <div className="w-0.5 h-3 bg-slate-300 dark:bg-white/60 rounded-full" />
                  <div className="w-0.5 h-3 bg-slate-300 dark:bg-white/60 rounded-full" />
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  );
}
export default SlideCaptchaModal;
