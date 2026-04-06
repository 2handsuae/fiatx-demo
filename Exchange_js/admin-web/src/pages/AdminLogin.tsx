import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, User, ShieldCheck, ArrowRight, Eye, EyeOff, LayoutDashboard, AlertCircle, Zap, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { notifyAdminAuthChanged } from '../contexts/AdminSessionContext';

const SEED_ACCOUNTS = [
  { role: 'SUPER_ADMIN',               label: 'Super Admin',               email: 'admin@fiatx.com',            userNo: 'ADMIN-001',  color: '#F59E0B', bg: '#FEF3C7' },
  { role: 'SENIOR_MANAGEMENT_OFFICER', label: 'Senior Management Officer',  email: 'sm@fiatx.com',              userNo: 'ADMIN-SMO',  color: '#6366F1', bg: '#EEF2FF' },
  { role: 'CISO',                       label: 'CISO',                       email: 'ciso@fiatx.com',             userNo: 'ADMIN-CISO', color: '#EF4444', bg: '#FEF2F2' },
  { role: 'MLRO',                       label: 'MLRO',                       email: 'mlro@fiatx.com',             userNo: 'ADMIN-MLRO', color: '#8B5CF6', bg: '#F5F3FF' },
  { role: 'DPO',                        label: 'DPO',                        email: 'dpo@fiatx.com',              userNo: 'ADMIN-DPO',  color: '#14B8A6', bg: '#F0FDFA' },
  { role: 'COMPLIANCE_OFFICER',         label: 'Compliance Officer',         email: 'compliance_lead@fiatx.com', userNo: 'ADMIN-COMP', color: '#22C55E', bg: '#F0FDF4' },
  { role: 'TECH_OFFICER',              label: 'Tech Officer',               email: 'tech_admin@fiatx.com',       userNo: 'ADMIN-TECH', color: '#0EA5E9', bg: '#F0F9FF' },
  { role: 'OPS_OFFICER',              label: 'Ops Officer',                email: 'ops_officer@fiatx.com',      userNo: 'ADMIN-OPS',  color: '#F97316', bg: '#FFF7ED' },
];

const AdminLogin = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [quickLoginOpen, setQuickLoginOpen] = useState(false);
  const navigate = useNavigate();
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loginError = localStorage.getItem('admin_login_error');
    if (loginError) {
      setError(loginError);
      localStorage.removeItem('admin_login_error');
    }
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setQuickLoginOpen(false); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  const decodeTokenPayload = (token: string): Record<string, any> | null => {
    try {
      const payload = token.split('.')[1];
      if (!payload) return null;
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
      const decoded = atob(padded);
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  };

  const doLogin = async (loginEmail: string, loginPassword: string) => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      if (response.ok) {
        const data = await response.json();
        const payload = decodeTokenPayload(data.access_token);
        if (!payload || payload.type !== 'ADMIN') {
          localStorage.removeItem('admin_token');
          notifyAdminAuthChanged();
          setError('Invalid admin token. Please contact support.');
          return;
        }
        localStorage.setItem('admin_token', data.access_token);
        notifyAdminAuthChanged();
        navigate('/dashboard');
      } else {
        const err = await response.json();
        setError(err.message || 'Login failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await doLogin(email, password);
  };

  const handleQuickLogin = async (account: typeof SEED_ACCOUNTS[number]) => {
    setQuickLoginOpen(false);
    setEmail(account.email);
    setPassword('123456');
    await doLogin(account.email, '123456');
  };

  return (
    <div className="min-h-screen flex font-['Noto_Sans_SC'] bg-gray-50">
      {/* Left: Brand Image Section */}
      <div className="hidden lg:flex lg:w-[40%] relative overflow-hidden bg-gray-900">
        <motion.div
          initial={{ scale: 1.1, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 1.5 }}
          className="absolute inset-0"
        >
          <img
            src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=2940&auto=format&fit=crop"
            alt="Admin Visual"
            className="w-full h-full object-cover opacity-40 grayscale"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-brand-primary/40 to-gray-900/90 mix-blend-overlay"></div>
        </motion.div>
        <div className="relative z-10 p-12 flex flex-col justify-between text-white h-full">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/10 backdrop-blur border border-white/20 rounded-lg flex items-center justify-center text-white font-bold text-xl">
              <ShieldCheck size={24} />
            </div>
            <span className="text-xl font-bold tracking-tight opacity-90">ADMIN PORTAL</span>
          </div>
          <div className="space-y-4">
            <div className="w-16 h-1 bg-brand-primary rounded-full"></div>
            <h2 className="text-3xl font-bold leading-tight">System Control Center</h2>
            <p className="text-gray-300 text-sm max-w-xs leading-relaxed">
              Authorized personnel only. All activities are monitored and logged for security purposes.
            </p>
          </div>
          <div className="text-xs text-gray-500 font-mono">V 2.5.0 • BUILD 2026.01</div>
        </div>
      </div>

      {/* Right: Login Form Section */}
      <div className="w-full lg:w-[60%] flex flex-col justify-center items-center p-6 sm:p-12 relative">
        <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl border border-gray-100">
          <div className="text-center mb-10">
            <div className="mx-auto w-16 h-16 bg-brand-primary/5 rounded-full flex items-center justify-center mb-4 text-brand-primary">
              <LayoutDashboard size={32} />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Administrator Sign In</h1>
            <p className="text-sm text-gray-500 mt-2">Enter your credentials to access the dashboard</p>
          </div>

          {error && (
            <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-600">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Admin ID / Email</label>
              <div className="relative group">
                <User className="absolute left-4 top-3.5 w-5 h-5 text-gray-400 group-focus-within:text-brand-primary transition-colors" />
                <input
                  type="text"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary outline-none transition-all font-medium text-gray-900"
                  placeholder="admin@exchange.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Password</label>
              <div className="relative group">
                <Lock className="absolute left-4 top-3.5 w-5 h-5 text-gray-400 group-focus-within:text-brand-primary transition-colors" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full pl-12 pr-12 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-brand-primary/20 focus:border-brand-primary outline-none transition-all font-medium text-gray-900"
                  placeholder="••••••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {/* Quick Login link */}
              <div className="mt-2 text-right">
                <button
                  type="button"
                  onClick={() => setQuickLoginOpen(true)}
                  className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-brand-primary transition-colors"
                >
                  <Zap size={11} />
                  Quick Login
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3.5 bg-gray-900 text-white font-bold rounded-lg hover:bg-black transition-all flex items-center justify-center gap-2 shadow-lg shadow-gray-900/20 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                <>Authenticate <ArrowRight size={18} /></>
              )}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-gray-100">
            <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
              <ShieldCheck className="w-5 h-5 text-brand-primary mt-0.5" />
              <p className="text-xs text-blue-800 leading-relaxed">
                This system is restricted to authorized users. Unauthorized access attempts will be recorded and prosecuted.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 text-center text-xs text-gray-400">
          Secure Connection • 256-bit SSL Encrypted
        </div>
      </div>

      {/* Quick Login Modal */}
      <AnimatePresence>
        {quickLoginOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-40 bg-gray-950/60 backdrop-blur-sm"
              onClick={() => setQuickLoginOpen(false)}
            />

            {/* Panel */}
            <motion.div
              ref={modalRef}
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="fixed z-50 inset-0 flex items-center justify-center pointer-events-none"
            >
              <div
                className="pointer-events-auto w-full max-w-sm mx-4 bg-gray-950 border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
                  <div className="flex items-center gap-2">
                    <Zap size={14} className="text-yellow-400" />
                    <span className="text-sm font-semibold text-white tracking-tight">Demo Quick Login</span>
                  </div>
                  <button
                    onClick={() => setQuickLoginOpen(false)}
                    className="w-6 h-6 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-300 hover:bg-white/8 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>

                {/* Hint */}
                <div className="px-5 py-2.5 bg-yellow-500/8 border-b border-white/5">
                  <p className="text-[11px] text-yellow-400/80 font-mono">All accounts use password: 123456</p>
                </div>

                {/* Account list */}
                <div className="p-3 space-y-1 max-h-[60vh] overflow-y-auto">
                  {SEED_ACCOUNTS.map((account, i) => (
                    <motion.button
                      key={account.role}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03, duration: 0.18 }}
                      onClick={() => handleQuickLogin(account)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/6 active:bg-white/10 transition-colors text-left group"
                    >
                      {/* Role dot */}
                      <div
                        className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-[10px] font-bold tracking-tight"
                        style={{ backgroundColor: account.color + '22', color: account.color }}
                      >
                        {account.role === 'SUPER_ADMIN' ? 'SA'
                          : account.role === 'SENIOR_MANAGEMENT_OFFICER' ? 'SM'
                          : account.role.replace('_OFFICER', '').slice(0, 2)}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold text-white/90 truncate">{account.label}</span>
                          <span
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded-md flex-shrink-0"
                            style={{ backgroundColor: account.color + '22', color: account.color }}
                          >
                            {account.userNo}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500 font-mono truncate mt-0.5">{account.email}</p>
                      </div>

                      {/* Arrow */}
                      <ArrowRight
                        size={13}
                        className="text-gray-600 group-hover:text-gray-300 group-hover:translate-x-0.5 transition-all flex-shrink-0"
                      />
                    </motion.button>
                  ))}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AdminLogin;
