import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface AuthGuardProps {
  children: ReactNode;
}

const AuthGuard = ({ children }: AuthGuardProps) => {
  const { user, loading, isAuthenticated, error } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !isAuthenticated && !error) {
      navigate('/login');
    }
  }, [loading, isAuthenticated, error, navigate]);

  if (loading) {
      return (
          <div className="w-full h-[400px] flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary"></div>
          </div>
      );
  }

  if (error) {
      return (
          <div className="w-full h-[400px] flex items-center justify-center flex-col gap-4">
              <div className="text-red-500 font-medium">Failed to verify session</div>
              <p className="text-gray-500 text-sm">{error}</p>
              <button 
                  onClick={() => window.location.reload()} 
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
              >
                  Retry
              </button>
          </div>
      );
  }

  if (!isAuthenticated) {
      return null;
  }

  const isApproved = user?.complianceStatus === 'ACTIVE';

  if (!isApproved) {
    return (
      <div className="absolute inset-0 z-10 bg-white/80 backdrop-blur-sm flex items-center justify-center p-4 rounded-xl">
        <div className="bg-white p-8 rounded-2xl shadow-xl border border-gray-100 max-w-md w-full text-center">
            <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center text-brand-primary mx-auto mb-6">
            <Lock size={32} />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Verification Required</h2>
            <p className="text-gray-500 mb-8 text-sm leading-relaxed">
            Please complete onboarding (CDD/EDD) to access this feature.
            Trading is allowed only when compliance status is ACTIVE.
            </p>
            <button 
            onClick={() => navigate('/verification')}
            className="w-full py-3 bg-brand-primary text-white font-semibold rounded-xl shadow-lg shadow-blue-500/20 hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
            >
            <ShieldAlert size={18} />
            Complete Verification
            </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default AuthGuard;
