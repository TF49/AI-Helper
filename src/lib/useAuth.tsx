import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { toast } from "sonner";
import {
  getAuthState,
  logoutAccount,
  setSelectedToken as apiSetSelectedToken,
  getUserWallet,
} from "./api";
import type { CurrentAuthState, UserInfo, TokenItem, UserWalletInfo } from "../types";
import { isUserAdmin } from "../types";

interface AuthContextType {
  authState: CurrentAuthState;
  isAdmin: boolean;
  isAuthReady: boolean;
  refreshState: () => Promise<void>;
  wallet: UserWalletInfo | null;
  isLoadingWallet: boolean;
  walletError: string | null;
  refreshWallet: () => Promise<void>;
  loginModalOpen: boolean;
  setLoginModalOpen: (open: boolean) => void;
  tokenModalOpen: boolean;
  setTokenModalOpen: (open: boolean) => void;
  logout: () => Promise<void>;
  onLoginSuccess: (user: UserInfo) => void;
  onTokenSelected: (key: string, token: TokenItem) => void;
}

const defaultState: CurrentAuthState = {
  is_logged_in: false,
  user: null,
  selected_token_id: null,
  selected_token_name: null,
  access_token_expires_at: null,
};

const AuthContext = createContext<AuthContextType>({
  authState: defaultState,
  isAdmin: false,
  isAuthReady: false,
  refreshState: async () => {},
  wallet: null,
  isLoadingWallet: false,
  walletError: null,
  refreshWallet: async () => {},
  loginModalOpen: false,
  setLoginModalOpen: () => {},
  tokenModalOpen: false,
  setTokenModalOpen: () => {},
  logout: async () => {},
  onLoginSuccess: () => {},
  onTokenSelected: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<CurrentAuthState>(defaultState);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [wallet, setWallet] = useState<UserWalletInfo | null>(null);
  const [isLoadingWallet, setIsLoadingWallet] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  const refreshState = useCallback(async () => {
    try {
      const state = await getAuthState();
      setAuthState(state);
    } catch (err) {
      console.warn("Failed to get auth state:", err);
    } finally {
      setIsAuthReady(true);
    }
  }, []);

  const refreshWallet = useCallback(async () => {
    if (!authState.is_logged_in) {
      setWallet(null);
      setWalletError(null);
      return;
    }
    setIsLoadingWallet(true);
    setWalletError(null);
    try {
      const data = await getUserWallet();
      setWallet(data);
      // Rust 后端在 get_user_wallet 中会同步从 /api/user/self 获取并持久化用户的 role (role >= 10 为管理员)
      // 同步刷新前端 authState，确保 session 恢复或初次加载时 isAdmin 立即生效，无须重新登录
      const latestState = await getAuthState();
      setAuthState(latestState);
    } catch (err: unknown) {
      const msg = typeof err === "string" ? err : (err as Error)?.message || "获取账号余额失败";
      setWalletError(msg);
      if (
        msg.includes("登录") ||
        msg.includes("Unauthorized") ||
        msg.includes("凭据") ||
        msg.includes("过期")
      ) {
        setWallet(null);
        void refreshState();
      }
      console.warn("Failed to get wallet balance:", err);
    } finally {
      setIsLoadingWallet(false);
    }
  }, [authState.is_logged_in, refreshState]);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  useEffect(() => {
    if (authState.is_logged_in) {
      void refreshWallet();
    } else {
      setWallet(null);
      setWalletError(null);
    }
  }, [authState.is_logged_in, authState.user?.id, refreshWallet]);

  const logout = async () => {
    try {
      await logoutAccount();
      setWallet(null);
      setWalletError(null);
      await refreshState();
      toast.info("已退出 bob-api.com 登录");
    } catch {
      toast.error("退出登录异常");
    }
  };

  const onLoginSuccess = (_user: UserInfo) => {
    void refreshState();
    void refreshWallet();
  };

  const onTokenSelected = (_key: string, token: TokenItem) => {
    void apiSetSelectedToken(token.id, token.name);
    setAuthState((prev) => ({
      ...prev,
      selected_token_id: token.id,
      selected_token_name: token.name,
    }));
  };

  const isAdmin = isUserAdmin(authState.user);

  return (
    <AuthContext.Provider
      value={{
        authState,
        isAdmin,
        isAuthReady,
        refreshState,
        wallet,
        isLoadingWallet,
        walletError,
        refreshWallet,
        loginModalOpen,
        setLoginModalOpen,
        tokenModalOpen,
        setTokenModalOpen,
        logout,
        onLoginSuccess,
        onTokenSelected,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
export default useAuth;
