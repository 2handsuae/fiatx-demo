import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Mail, ArrowRight, Eye, EyeOff, AlertCircle, Zap, X } from 'lucide-react';
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
    // Force dark mode so adm-* CSS variables resolve to dark values
    document.documentElement.classList.add('dark');
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
    <div
      className="min-h-screen flex items-center justify-center relative overflow-hidden bg-adm-bg"
      style={{ fontFamily: '"JetBrains Mono", "SF Mono", monospace' }}
    >
      {/* Background: dot grid + amber radial glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            radial-gradient(ellipse 60% 50% at 50% 50%, rgba(245,158,11,0.05) 0%, transparent 70%),
            radial-gradient(var(--adm-border) 1px, transparent 1px)
          `,
          backgroundSize: '100% 100%, 24px 24px',
        }}
      />

      {/* Login panel */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-[380px] mx-4"
      >
        {/* Amber top accent bar */}
        <div className="h-[2px] w-full bg-adm-amber rounded-t-sm" />

        <div className="bg-adm-panel border border-adm-border border-t-0 rounded-b-sm">

          {/* Header */}
          <div className="px-8 pt-8 pb-6 border-b border-adm-border">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="flex items-center gap-3 mb-6"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded bg-adm-amber flex-shrink-0">
                <span className="font-mono text-[12px] font-bold text-gray-950">E</span>
              </div>
              <div>
                <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.22em] text-adm-t1">
                  FiatX Admin
                </div>
                <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-adm-t3 mt-0.5">
                  Control Center
                </div>
              </div>
              {/* Live indicator */}
              <div className="ml-auto flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-adm-green opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-adm-green" />
                </span>
                <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-adm-t3">Secure</span>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
            >
              <h1 className="font-mono text-[15px] font-semibold text-adm-t1 leading-snug">
                Administrator Sign In
              </h1>
              <p className="font-mono text-[10px] text-adm-t3 mt-1 tracking-wide">
                Authorized personnel only
              </p>
            </motion.div>
          </div>

          {/* Form body */}
          <div className="px-8 py-6">
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mb-5 flex items-center gap-2 rounded px-3 py-2.5 border border-adm-red/30 bg-adm-red/8"
              >
                <AlertCircle size={12} className="text-adm-red flex-shrink-0" />
                <span className="font-mono text-[10px] text-adm-red">{error}</span>
              </motion.div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email */}
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
              >
                <label className="block font-mono text-[8.5px] uppercase tracking-[0.16em] text-adm-t3 mb-1.5">
                  Email
                </label>
                <div className="relative group">
                  <Mail
                    size={12}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-adm-t3 group-focus-within:text-adm-amber transition-colors"
                  />
                  <input
                    type="text"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="admin@fiatx.com"
                    className="w-full pl-8 pr-3 py-2.5 bg-adm-bg border border-adm-border rounded font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none transition-colors"
                  />
                </div>
              </motion.div>

              {/* Password */}
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.25 }}
              >
                <label className="block font-mono text-[8.5px] uppercase tracking-[0.16em] text-adm-t3 mb-1.5">
                  Password
                </label>
                <div className="relative group">
                  <Lock
                    size={12}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-adm-t3 group-focus-within:text-adm-amber transition-colors"
                  />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••••"
                    className="w-full pl-8 pr-9 py-2.5 bg-adm-bg border border-adm-border rounded font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-adm-t3 hover:text-adm-t2 transition-colors"
                  >
                    {showPassword ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>

                {/* Quick Login link */}
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setQuickLoginOpen(true)}
                    className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3 hover:text-adm-amber transition-colors"
                  >
                    <Zap size={9} />
                    Quick Login
                  </button>
                </div>
              </motion.div>

              {/* Submit */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.32 }}
              >
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-adm-amber rounded font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-gray-950 hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                >
                  {isLoading ? (
                    <div className="w-4 h-4 border-2 border-gray-950/30 border-t-gray-950 rounded-full animate-spin" />
                  ) : (
                    <>Authenticate <ArrowRight size={12} /></>
                  )}
                </button>
              </motion.div>
            </form>
          </div>

          {/* Footer */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="px-8 py-4 border-t border-adm-border"
          >
            <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-adm-t3 text-center">
              All activity is monitored and logged · 256-bit SSL
            </p>
          </motion.div>
        </div>
      </motion.div>

      {/* Quick Login Modal */}
      <AnimatePresence>
        {quickLoginOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
              onClick={() => setQuickLoginOpen(false)}
            />

            <motion.div
              ref={modalRef}
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="fixed z-50 inset-0 flex items-center justify-center pointer-events-none"
            >
              <div
                className="pointer-events-auto w-full max-w-sm mx-4 bg-adm-panel border border-adm-border rounded-sm overflow-hidden"
                style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
                onClick={e => e.stopPropagation()}
              >
                {/* Amber top bar */}
                <div className="h-[2px] bg-adm-amber" />

                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-adm-border">
                  <div className="flex items-center gap-2">
                    <Zap size={11} className="text-adm-amber" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-adm-t1 font-semibold">
                      Demo Quick Login
                    </span>
                  </div>
                  <button
                    onClick={() => setQuickLoginOpen(false)}
                    className="text-adm-t3 hover:text-adm-t1 transition-colors"
                  >
                    <X size={13} />
                  </button>
                </div>

                {/* Hint */}
                <div className="px-5 py-2 bg-adm-amber/8 border-b border-adm-border">
                  <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-amber/70">
                    All accounts · password: 123456
                  </p>
                </div>

                {/* Account list */}
                <div className="p-2 space-y-0.5 max-h-[60vh] overflow-y-auto">
                  {SEED_ACCOUNTS.map((account, i) => (
                    <motion.button
                      key={account.role}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03, duration: 0.15 }}
                      onClick={() => handleQuickLogin(account)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded hover:bg-adm-hover active:bg-adm-card transition-colors text-left group"
                    >
                      <div
                        className="w-7 h-7 rounded flex-shrink-0 flex items-center justify-center font-mono text-[9px] font-bold"
                        style={{ backgroundColor: account.color + '20', color: account.color }}
                      >
                        {account.role === 'SUPER_ADMIN' ? 'SA'
                          : account.role === 'SENIOR_MANAGEMENT_OFFICER' ? 'SM'
                          : account.role.replace('_OFFICER', '').slice(0, 2)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] text-adm-t1 truncate">{account.label}</span>
                          <span
                            className="font-mono text-[8px] px-1.5 py-0.5 rounded flex-shrink-0"
                            style={{ backgroundColor: account.color + '20', color: account.color }}
                          >
                            {account.userNo}
                          </span>
                        </div>
                        <p className="font-mono text-[9px] text-adm-t3 truncate mt-0.5">{account.email}</p>
                      </div>

                      <ArrowRight
                        size={11}
                        className="text-adm-t3 group-hover:text-adm-amber group-hover:translate-x-0.5 transition-all flex-shrink-0"
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
