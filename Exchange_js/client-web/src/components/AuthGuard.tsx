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

  const isApproved = user?.publicStatus === 'ACTIVE';

  if (!isApproved) {
    return (
      <div className="absolute inset-0 z-10 bg-slate-50/80 backdrop-blur-md flex items-center justify-center p-6">
        <div className="relative overflow-hidden rounded-[2.5rem] border border-white/60 bg-white/95 px-10 py-12 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.15)] backdrop-blur-xl max-w-lg w-full text-center">
            {/* Ambient Background */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-1/2 -left-1/2 w-[200%] h-[200%] bg-gradient-to-br from-blue-50/80 via-transparent to-indigo-50/60"></div>
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-100/50 rounded-full blur-3xl"></div>
                <div className="absolute bottom-0 left-0 w-32 h-32 bg-violet-100/50 rounded-full blur-3xl"></div>
            </div>

            <div className="relative z-10">
                {/* Icon Container */}
                <div className="relative inline-flex mb-8">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-400 to-indigo-500 rounded-3xl blur-xl opacity-30 animate-pulse"></div>
                    <div className="relative w-20 h-20 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-[1.25rem] rotate-6 flex items-center justify-center text-blue-600 shadow-xl border border-white/80">
                        <div className="-rotate-6">
                            <Lock size={36} strokeWidth={1.5} />
                        </div>
                    </div>
                </div>
                
                {/* Title */}
                <h2 className="text-3xl font-bold text-slate-900 mb-4 tracking-tight">
                    Verification Required
                </h2>
                
                {/* Description */}
                <p className="text-slate-500 mb-8 text-base leading-relaxed max-w-sm mx-auto">
                    Complete your identity verification to unlock full access to trading features.
                </p>

                {/* CTA Button */}
                <button 
                    onClick={() => navigate('/verification')}
                    className="w-full py-4 bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-600 text-white font-bold rounded-2xl shadow-xl shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2.5 text-base"
                >
                    <ShieldAlert size={20} strokeWidth={2} />
                    Start Verification
                </button>

                {/* Footer Note */}
                <p className="mt-6 text-xs text-slate-400">
                    Takes approximately 3-5 minutes to complete
                </p>
            </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default AuthGuard;
