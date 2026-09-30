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
} from "./api";
import type { CurrentAuthState, UserInfo, TokenItem } from "../types";

interface AuthContextType {
  authState: CurrentAuthState;
  refreshState: () => Promise<void>;
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
  refreshState: async () => {},
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
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);

  const refreshState = useCallback(async () => {
    try {
      const state = await getAuthState();
      setAuthState(state);
    } catch (err) {
      console.warn("Failed to get auth state:", err);
    }
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const logout = async () => {
    try {
      await logoutAccount();
      await refreshState();
      toast.info("已退出 bob-api.com 登录");
    } catch {
      toast.error("退出登录异常");
    }
  };

  const onLoginSuccess = (_user: UserInfo) => {
    void refreshState();
    // 登录成功后，如果还没有选中的 Token，自动弹出 Token 选择列表供用户选择！
    setTokenModalOpen(true);
  };

  const onTokenSelected = (_key: string, token: TokenItem) => {
    void apiSetSelectedToken(token.id, token.name);
    setAuthState((prev) => ({
      ...prev,
      selected_token_id: token.id,
      selected_token_name: token.name,
    }));
  };

  return (
    <AuthContext.Provider
      value={{
        authState,
        refreshState,
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
