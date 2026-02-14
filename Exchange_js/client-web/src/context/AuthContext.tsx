import { createContext, useContext } from 'react';
import { useCustomerProfile } from '../hooks/useCustomerProfile';
import type { CustomerProfileData } from '../hooks/useCustomerProfile';

interface AuthContextType {
  user: CustomerProfileData | null;
  loading: boolean;
  error: string;
  refreshProfile: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile, loading, error, refreshProfile } = useCustomerProfile();

  return (
    <AuthContext.Provider value={{ 
      user: profile, 
      loading, 
      error, 
      refreshProfile,
      isAuthenticated: !!profile 
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
