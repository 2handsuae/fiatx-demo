import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

export interface AdminSession {
  id: string;
  userNo: string;
  email: string;
  status: string;
  lastLoginAt: string | null;
  roles: string[];
  permissions: string[];
}

interface AdminSessionContextValue {
  session: AdminSession | null;
  isLoading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  refreshSession: () => Promise<void>;
  clearSession: () => void;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
}

const AdminSessionContext = createContext<AdminSessionContextValue | undefined>(
  undefined,
);

export const notifyAdminAuthChanged = () => {
  window.dispatchEvent(new Event('admin-auth-changed'));
};

export const AdminSessionProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      setSession(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/auth/me`);
      if (!response.ok) {
        setSession(null);
        setError(await getApiErrorMessage(response, 'Failed to load admin session.'));
        return;
      }

      const payload = await response.json();
      setSession({
        id: payload.id,
        userNo: payload.userNo || '',
        email: payload.email || '',
        status: payload.status || 'UNKNOWN',
        lastLoginAt: payload.lastLoginAt || null,
        roles: Array.isArray(payload.roles) ? payload.roles : [],
        permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
      });
    } catch (err) {
      if (err instanceof AdminSessionError) {
        setSession(null);
      } else if (err instanceof AdminPermissionError) {
        setSession(null);
        setError(err.message);
      } else {
        setSession(null);
        setError('Failed to load admin session.');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const handleAuthChanged = () => {
      void refreshSession();
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'admin_token') {
        void refreshSession();
      }
    };

    void refreshSession();

    window.addEventListener('admin-auth-changed', handleAuthChanged);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener('admin-auth-changed', handleAuthChanged);
      window.removeEventListener('storage', handleStorage);
    };
  }, [refreshSession]);

  const permissionSet = useMemo(
    () => new Set(session?.permissions || []),
    [session?.permissions],
  );

  const hasPermission = useCallback(
    (permission: string) => permissionSet.has(permission),
    [permissionSet],
  );

  const hasAnyPermission = useCallback(
    (permissions: string[]) => permissions.length === 0 || permissions.some((permission) => permissionSet.has(permission)),
    [permissionSet],
  );

  const clearSession = useCallback(() => {
    localStorage.removeItem('admin_token');
    setSession(null);
    setError(null);
    notifyAdminAuthChanged();
  }, []);

  const value = useMemo<AdminSessionContextValue>(
    () => ({
      session,
      isLoading,
      error,
      isAuthenticated: !!session,
      refreshSession,
      clearSession,
      hasPermission,
      hasAnyPermission,
    }),
    [session, isLoading, error, refreshSession, clearSession, hasPermission, hasAnyPermission],
  );

  return (
    <AdminSessionContext.Provider value={value}>
      {children}
    </AdminSessionContext.Provider>
  );
};

export const useAdminSession = (): AdminSessionContextValue => {
  const ctx = useContext(AdminSessionContext);
  if (!ctx) {
    throw new Error('useAdminSession must be used inside AdminSessionProvider');
  }
  return ctx;
};
