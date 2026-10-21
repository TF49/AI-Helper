import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
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
  authSessionGeneration: number;
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
  authSessionGeneration: 0,
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
  const [authSessionGeneration, setAuthSessionGeneration] = useState(0);
  const authStateRef = useRef(authState);
  const mounted = useRef(true);
  const sessionGeneration = useRef(0);
  const authRequestGeneration = useRef(0);
  const authMutationGeneration = useRef(0);
  const authMutationPending = useRef(false);
  const walletRequestGeneration = useRef(0);

  // Invalidate before notifying consumers, including a fresh login to the same account.
  const invalidateSession = useCallback((userId: number | null) => {
    sessionGeneration.current += 1;
    authRequestGeneration.current += 1;
    walletRequestGeneration.current += 1;
    setAuthSessionGeneration(sessionGeneration.current);
    setWallet(null);
    setWalletError(null);
    setIsLoadingWallet(false);
    setTokenModalOpen(false);
    window.dispatchEvent(new CustomEvent("ai_helper_auth_changed", {
      detail: { userId, sessionGeneration: sessionGeneration.current },
    }));
  }, []);

  const commitAuthState = useCallback((state: CurrentAuthState, newSession = false) => {
    const previous = authStateRef.current;
    const previousId = previous.is_logged_in ? previous.user?.id ?? null : null;
    const nextId = state.is_logged_in ? state.user?.id ?? null : null;
    authStateRef.current = state;
    if (newSession || previousId !== nextId || previous.is_logged_in !== state.is_logged_in) {
      invalidateSession(nextId);
    }
    setAuthState(state);
  }, [invalidateSession]);

  const refreshState = useCallback(async () => {
    if (authMutationPending.current) return;
    const session = sessionGeneration.current;
    const request = ++authRequestGeneration.current;
    const isCurrent = () => mounted.current && session === sessionGeneration.current &&
      request === authRequestGeneration.current;
    try {
      const state = await getAuthState();
      if (!isCurrent()) return;
      setIsAuthReady(true);
      commitAuthState(state);
    } catch (err) {
      if (!isCurrent()) return;
      console.warn("Failed to get auth state:", err);
      setIsAuthReady(true);
    }
  }, [commitAuthState]);

  const refreshWallet = useCallback(async () => {
    const requestUserId = authState.user?.id ?? null;
    const session = authSessionGeneration;
    if (!authState.is_logged_in || requestUserId === null ||
      session !== sessionGeneration.current ||
      authStateRef.current.user?.id !== requestUserId || !authStateRef.current.is_logged_in) return;
    const requestGeneration = ++walletRequestGeneration.current;
    const isCurrent = () => mounted.current && session === sessionGeneration.current &&
      requestGeneration === walletRequestGeneration.current &&
      authStateRef.current.is_logged_in && authStateRef.current.user?.id === requestUserId;
    setIsLoadingWallet(true);
    setWalletError(null);
    try {
      const data = await getUserWallet();
      if (!isCurrent()) return;
      setWallet(data);
      // Role refresh uses the same session and latest-request protections as other auth reads.
      await refreshState();
    } catch (err: unknown) {
      if (!isCurrent()) return;
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
      if (isCurrent()) setIsLoadingWallet(false);
    }
  }, [authState.is_logged_in, authState.user?.id, authSessionGeneration, refreshState]);

  useEffect(() => {
    mounted.current = true;
    void refreshState();
    return () => {
      mounted.current = false;
      sessionGeneration.current += 1;
      authRequestGeneration.current += 1;
      walletRequestGeneration.current += 1;
    };
  }, [refreshState]);

  useEffect(() => {
    if (authState.is_logged_in) {
      void refreshWallet();
    } else {
      setWallet(null);
      setWalletError(null);
    }
  }, [authState.is_logged_in, authState.user?.id, authSessionGeneration, refreshWallet]);

  const logout = async () => {
    if (authSessionGeneration !== sessionGeneration.current) return;
    const mutation = ++authMutationGeneration.current;
    authMutationPending.current = true;
    commitAuthState(defaultState, true);
    const session = sessionGeneration.current;
    const isCurrent = () => mounted.current && mutation === authMutationGeneration.current &&
      session === sessionGeneration.current;
    try {
      await logoutAccount();
      if (!isCurrent()) return;
      authMutationPending.current = false;
      await refreshState();
      if (!isCurrent()) return;
      toast.info("已退出 bob-api.com 登录");
    } catch {
      if (!isCurrent()) return;
      authMutationPending.current = false;
      toast.error("退出登录异常");
      void refreshState();
    }
  };

  const onLoginSuccess = (user: UserInfo) => {
    authMutationGeneration.current += 1;
    authMutationPending.current = false;
    commitAuthState({ ...defaultState, is_logged_in: true, user }, true);
    void refreshState();
  };

  const onTokenSelected = (_key: string, token: TokenItem) => {
    const session = authSessionGeneration;
    if (session !== sessionGeneration.current || !authStateRef.current.is_logged_in) return;
    void apiSetSelectedToken(token.id, token.name).then(() => {
      if (!mounted.current || session !== sessionGeneration.current) return;
      commitAuthState({
        ...authStateRef.current,
        selected_token_id: token.id,
        selected_token_name: token.name,
      });
    }).catch(() => {
      if (mounted.current && session === sessionGeneration.current) toast.error("记录选中凭据失败");
    });
  };

  const isAdmin = isUserAdmin(authState.user);

  return (
    <AuthContext.Provider
      value={{
        authState,
        isAdmin,
        isAuthReady,
        authSessionGeneration,
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
