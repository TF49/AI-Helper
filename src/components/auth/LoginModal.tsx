import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  User,
  Lock,
  Loader2,
  X,
  ShieldCheck,
  KeyRound,
  ExternalLink,
  AlertCircle,
  ArrowRight,
  Power,
} from "lucide-react";
import { toast } from "sonner";
import { exit } from "@tauri-apps/plugin-process";
import { Input } from "../ui/input";
import { SlideCaptchaModal } from "./SlideCaptchaModal";
import {
  getSiteStatus,
  getEncryptionKey,
  encryptPasswordWithRsa,
  loginAccount,
  login2fa,
  openUrl,
  isTauri,
} from "../../lib/api";
import type { UserInfo, LoginPayload } from "../../types";

interface LoginModalProps {
  open: boolean;
  mandatory?: boolean;
  onSuccess: (user: UserInfo) => void;
  onClose: () => void;
  onExitApp?: () => void;
}

export function LoginModal({
  open,
  mandatory = false,
  onSuccess,
  onClose,
  onExitApp,
}: LoginModalProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 滑块弹窗状态
  const [captchaOpen, setCaptchaOpen] = useState(false);
  const [preparedLoginPayload, setPreparedLoginPayload] =
    useState<LoginPayload | null>(null);
  const preparedLoginPayloadRef = useRef<LoginPayload | null>(null);

  // 2FA 流程状态
  const [twoFaFlowToken, setTwoFaFlowToken] = useState<string | null>(null);
  const [twoFaCode, setTwoFaCode] = useState("");
  const [twoFaSubmitting, setTwoFaSubmitting] = useState(false);

  if (!open || typeof document === "undefined") return null;

  // 提交第一阶段登录预备（检查密码加密并唤起滑块）
  const handleStartLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!username.trim() || !password) {
      toast.warning("请输入用户名和密码");
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      // 1. 检查站点配置
      const status = await getSiteStatus();
      if (!status.password_login_enabled) {
        throw new Error("站点已关闭密码登录入口，请联系管理员");
      }

      // 2. 密码加密适配
      let encryptedPwd: string | undefined;
      let kid: string | undefined;

      if (status.password_login_encryption_enabled) {
        const encData = await getEncryptionKey();
        if (encData.enabled && encData.public_key) {
          encryptedPwd = await encryptPasswordWithRsa(
            password,
            encData.public_key,
          );
          kid = encData.kid;
        }
      }

      const payload: LoginPayload = {
        username: username.trim(),
        password: encryptedPwd ? undefined : password,
        password_encrypted: encryptedPwd,
        encryption_key_id: kid,
      };

      preparedLoginPayloadRef.current = payload;
      setPreparedLoginPayload(payload);

      // 3. 判断是否需要完成 GO 滑块
      if (status.slide_captcha_check) {
        setCaptchaOpen(true);
      } else {
        // 不需要滑块则直接提交登录
        await doExecuteLogin(payload);
      }
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || "登录请求准备失败";
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // 执行真实登录接口调用
  const doExecuteLogin = async (payload: LoginPayload) => {
    setLoading(true);
    setErrorMsg(null);

    try {
      const result = await loginAccount(payload);

      if (result.type === "require_2fa") {
        setTwoFaFlowToken(result.flow_token);
        toast.info("当前账号开启了 2FA 双因素认证，请输入验证码");
      } else if (result.type === "success") {
        toast.success(`欢迎回来，${result.user.display_name || result.user.username}！`);
        onSuccess(result.user);
        onClose();
      }
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : "登录失败，请检查账号密码";
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // 滑块通过后的回调
  const handleCaptchaSuccess = () => {
    setCaptchaOpen(false);
    const payload = preparedLoginPayloadRef.current || preparedLoginPayload;
    if (payload) {
      void doExecuteLogin(payload);
    }
  };

  // 提交 2FA 验证码
  const handle2FaSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!twoFaFlowToken || !twoFaCode.trim()) {
      toast.warning("请输入 2FA 验证码");
      return;
    }

    setTwoFaSubmitting(true);
    setErrorMsg(null);

    try {
      const successData = await login2fa(twoFaFlowToken, twoFaCode.trim());
      toast.success(`2FA 验证成功，欢迎回来 ${successData.user.username}！`);
      onSuccess(successData.user);
      onClose();
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : "2FA 验证码错误或已过期";
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setTwoFaSubmitting(false);
    }
  };

  const handleExitApp = async () => {
    if (onExitApp) {
      onExitApp();
      return;
    }
    try {
      if (isTauri) {
        await exit(0);
      } else {
        window.close();
      }
    } catch (e) {
      console.error("Exit failed:", e);
    }
  };

  return createPortal(
    <>
      <AnimatePresence>
        <div
          className={`fixed inset-0 top-11 flex items-center justify-center p-4 select-none ${
            mandatory
              ? "z-[95] bg-slate-950/85 backdrop-blur-md"
              : "z-[90] bg-black/60 backdrop-blur-xs"
          }`}
          onClick={(e) => {
            // 强制模式下点击遮罩不关闭
            if (!mandatory && e.target === e.currentTarget) {
              onClose();
            }
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-[400px] bg-white dark:bg-[#141724] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl overflow-hidden p-6 text-slate-800 dark:text-gray-200"
          >
            {/* 顶栏控制 */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-white/5 mb-5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      {twoFaFlowToken
                        ? "二次身份验证 (2FA)"
                        : "登录 bob-api.com"}
                    </h3>
                    {mandatory && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-500/30">
                        强制登录
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 dark:text-gray-500">
                    {twoFaFlowToken
                      ? "请输入验证器动态码或备用码"
                      : mandatory
                        ? "客户端已启用强制登录，验证后方可使用"
                        : "登录以同步并选择您在平台上创建的 API Key"}
                  </p>
                </div>
              </div>
              {mandatory ? (
                <button
                  type="button"
                  onClick={handleExitApp}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-400 hover:text-red-500 hover:bg-red-500/10 dark:hover:bg-red-500/20 transition-colors cursor-pointer"
                  title="退出客户端程序"
                >
                  <Power size={13} />
                  <span>退出程序</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
                  title="关闭"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {/* 错误提示条 */}
            {errorMsg && (
              <div className="mb-4 text-xs text-red-500 bg-red-50 dark:bg-red-500/10 px-3 py-2 rounded-xl flex items-center gap-2 border border-red-200/50 dark:border-red-500/20">
                <AlertCircle size={14} className="flex-shrink-0" />
                <span className="truncate">{errorMsg}</span>
              </div>
            )}

            {/* 2FA 输入视图 */}
            {twoFaFlowToken ? (
              <form onSubmit={handle2FaSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-700 dark:text-gray-300">
                    6 位身份验证码 / 备用恢复码
                  </label>
                  <div className="relative">
                    <KeyRound
                      size={15}
                      className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <Input
                      type="text"
                      value={twoFaCode}
                      onChange={(e) => setTwoFaCode(e.target.value)}
                      placeholder="例如: 123456"
                      autoFocus
                      maxLength={16}
                      className="pl-10 font-mono tracking-widest text-center text-sm font-semibold rounded-xl h-10 bg-slate-50 dark:bg-black/30 border-slate-200 dark:border-white/10"
                    />
                  </div>
                </div>

                <div className="pt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTwoFaFlowToken(null);
                      setTwoFaCode("");
                    }}
                    className="flex-1 py-2 px-3 rounded-xl border border-slate-200 dark:border-white/10 text-xs font-medium text-slate-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer"
                  >
                    返回登录
                  </button>
                  <button
                    type="submit"
                    disabled={twoFaSubmitting || !twoFaCode.trim()}
                    className="flex-1 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-md shadow-blue-500/20 disabled:opacity-50 cursor-pointer"
                  >
                    {twoFaSubmitting && (
                      <Loader2 size={13} className="animate-spin" />
                    )}
                    确认验证
                  </button>
                </div>
              </form>
            ) : (
              /* 普通账号密码登录视图 */
              <form onSubmit={handleStartLogin} className="space-y-4">
                {/* 用户名 */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-700 dark:text-gray-300">
                    用户名 / 账号
                  </label>
                  <div className="relative">
                    <User
                      size={15}
                      className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <Input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="输入您在 bob-api 的用户名"
                      autoFocus
                      disabled={loading}
                      className="pl-10 text-xs rounded-xl h-10 bg-slate-50 dark:bg-black/30 border-slate-200 dark:border-white/10"
                    />
                  </div>
                </div>

                {/* 密码 */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-700 dark:text-gray-300">
                      密码
                    </label>
                    <button
                      type="button"
                      onClick={() => void openUrl("https://bob-api.com/reset")}
                      className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      忘记密码?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock
                      size={15}
                      className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="输入登录密码"
                      disabled={loading}
                      className="pl-10 text-xs rounded-xl h-10 bg-slate-50 dark:bg-black/30 border-slate-200 dark:border-white/10"
                    />
                  </div>
                </div>

                {/* 登录提交按钮 */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={loading || captchaOpen || !username.trim() || !password}
                    className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-md shadow-blue-500/20 disabled:opacity-50 transition-all cursor-pointer"
                  >
                    {loading ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        <span>准备验证...</span>
                      </>
                    ) : (
                      <>
                        <span>下一步 (滑块验证)</span>
                        <ArrowRight size={14} />
                      </>
                    )}
                  </button>
                </div>

                {/* 底部注册通道 */}
                <div className="pt-2 text-center text-[11px] text-slate-400 dark:text-gray-500">
                  还没有账号？{" "}
                  <button
                    type="button"
                    onClick={() => void openUrl("https://bob-api.com/register")}
                    className="text-blue-600 dark:text-blue-400 hover:underline font-medium inline-flex items-center gap-0.5 cursor-pointer"
                  >
                    前往 bob-api.com 注册
                    <ExternalLink size={10} />
                  </button>
                </div>
              </form>
            )}
          </motion.div>
        </div>
      </AnimatePresence>

      {/* 滑块验证组件 */}
      <SlideCaptchaModal
        open={captchaOpen}
        onSuccess={handleCaptchaSuccess}
        onClose={() => setCaptchaOpen(false)}
      />
    </>,
    document.body,
  );
}

export default LoginModal;
