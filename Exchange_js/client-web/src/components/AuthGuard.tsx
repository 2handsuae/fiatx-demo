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
      <div className="absolute inset-0 z-10 bg-slate-50/50 backdrop-blur-sm flex items-center justify-center p-4 rounded-xl">
        <div className="relative overflow-hidden rounded-[2rem] border border-white/60 bg-white/90 px-8 py-10 shadow-[0_20px_40px_-12px_rgba(0,0,0,0.1)] backdrop-blur-xl max-w-md w-full text-center">
            {/* Ambient Background */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
                <div className="absolute -top-[50%] -left-[50%] w-[200%] h-[200%] bg-gradient-to-br from-blue-50/50 via-transparent to-violet-50/50 opacity-60"></div>
            </div>

            <div className="relative z-10">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl rotate-3 flex items-center justify-center text-blue-600 mx-auto mb-6 shadow-inner border border-white">
                    <div className="-rotate-3">
                        <Lock size={32} />
                    </div>
                </div>
                <h2 className="text-2xl font-bold text-slate-900 mb-3">Verification Required</h2>
                <p className="text-slate-500 mb-8 text-sm leading-relaxed">
                    Please complete onboarding (CDD/EDD) to access this feature.
                    Trading is allowed only when compliance status is ACTIVE.
                </p>
                <button 
                    onClick={() => navigate('/verification')}
                    className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                    <ShieldAlert size={18} />
                    Complete Verification
                </button>
            </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default AuthGuard;
