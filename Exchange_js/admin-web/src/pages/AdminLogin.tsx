import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Mail, ArrowRight, ArrowLeft, Eye, EyeOff, AlertCircle, Zap, X, CheckCircle, ShieldCheck } from 'lucide-react';
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
  const [showMfaInput, setShowMfaInput] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaSubmitting, setMfaSubmitting] = useState(false);
  const [quickLoginOpen, setQuickLoginOpen] = useState(false);
  const [forgotStep, setForgotStep] = useState<'none' | 'email' | 'mfa' | 'sent'>('none');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotMfaCode, setForgotMfaCode] = useState('');
  const [forgotMfaSessionToken, setForgotMfaSessionToken] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState('');
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

        if (data.status === 'FIRST_LOGIN_REQUIRED') {
          sessionStorage.setItem('mfaBindingToken', data.firstLoginToken);
          navigate('/admin/mfa-binding');
          return;
        }

        if (data.status === 'MFA_REQUIRED') {
          sessionStorage.setItem('mfaSessionToken', data.mfaSessionToken);
          setShowMfaInput(true);
          return;
        }

        const payload = decodeTokenPayload(data.access_token);
        if (!payload || payload.type !== 'ADMIN') {
          localStorage.removeItem('admin_token');
          notifyAdminAuthChanged();
          setError('Invalid admin token. Please contact support.');
          return;
        }
        localStorage.setItem('admin_token', data.access_token);
        notifyAdminAuthChanged();
        navigate('/admin');
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

  const handleMfaVerify = async () => {
    if (mfaCode.length !== 6) return;
    setMfaSubmitting(true);
    setError('');
    try {
      const token = sessionStorage.getItem('mfaSessionToken');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/mfa/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: mfaCode }),
      });
      if (response.ok) {
        const data = await response.json();
        sessionStorage.removeItem('mfaSessionToken');
        localStorage.setItem('admin_token', data.accessToken);
        notifyAdminAuthChanged();
        navigate('/admin');
      } else {
        const err = await response.json();
        setError(err.message || 'MFA verification failed');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setMfaSubmitting(false);
    }
  };

  const handleForgotEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotLoading(true);
    setForgotError('');
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      });
      const data = await response.json();
      if (data.mfaSessionToken) {
        setForgotMfaSessionToken(data.mfaSessionToken);
        setForgotStep('mfa');
      } else {
        // Anti-enumeration: no token means email not found, but show success anyway
        setForgotStep('sent');
      }
    } catch {
      setForgotError('Network error. Please try again.');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleForgotMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (forgotMfaCode.length !== 6) return;
    setForgotLoading(true);
    setForgotError('');
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/password-reset/verify-mfa`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${forgotMfaSessionToken}`,
        },
        body: JSON.stringify({ code: forgotMfaCode }),
      });
      if (response.ok) {
        setForgotStep('sent');
      } else {
        const err = await response.json();
        setForgotError(err.message || 'Verification failed. Please try again.');
      }
    } catch {
      setForgotError('Network error. Please try again.');
    } finally {
      setForgotLoading(false);
    }
  };

  const resetForgotFlow = () => {
    setForgotStep('none');
    setForgotEmail('');
    setForgotMfaCode('');
    setForgotMfaSessionToken('');
    setForgotError('');
  };

  return (
    <div
      className="min-h-screen flex overflow-hidden bg-adm-bg"
      style={{ fontFamily: '"JetBrains Mono", "SF Mono", monospace' }}
    >
      {/* ── Left: Hero image panel (55%) ── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.2 }}
        className="hidden lg:flex lg:w-[55%] relative overflow-hidden"
      >
        {/* Photo */}
        <img
          src="https://images.unsplash.com/photo-1639762681485-074b7f938ba0?q=80&w=2832&auto=format&fit=crop"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Dark gradient overlay — heavier on right so panel reads cleanly */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/50 to-black/80" />
        {/* Bottom gradient for text */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

        {/* Amber radial glow in centre */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 70% 60% at 40% 60%, rgba(245,158,11,0.08) 0%, transparent 70%)',
          }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between h-full p-12 w-full">
          {/* Top: Logo */}
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="flex items-center gap-3"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded bg-adm-amber">
              <span className="font-mono text-[13px] font-bold text-gray-950">E</span>
            </div>
            <div>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-white">
                FiatX Admin
              </div>
              <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-white/40 mt-0.5">
                Control Center
              </div>
            </div>
          </motion.div>

          {/* Bottom: Copy */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.6 }}
            className="space-y-5"
          >
            <div className="w-10 h-[2px] bg-adm-amber" />
            <h2 className="font-mono text-3xl font-semibold text-white leading-snug">
              System<br />Control Center
            </h2>
            <p className="font-mono text-[11px] text-white/40 uppercase tracking-[0.12em] leading-relaxed max-w-xs">
              Authorized personnel only.<br />
              All activities are monitored<br />
              and logged for compliance.
            </p>
            <div className="flex items-center gap-2 pt-2">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-adm-green opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-adm-green" />
              </span>
              <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-white/30">
                Secure · 256-bit SSL · V 2.5.0
              </span>
            </div>
          </motion.div>
        </div>

        {/* Right-edge fade to match panel bg */}
        <div className="absolute inset-y-0 right-0 w-16 bg-gradient-to-r from-transparent to-adm-panel pointer-events-none" />
      </motion.div>

      {/* ── Right: Login panel (45%) ── */}
      <div className="w-full lg:w-[45%] flex flex-col justify-center items-center relative bg-adm-panel border-l border-adm-border">

        {/* Dot grid on panel */}
        <div
          className="absolute inset-0 pointer-events-none opacity-40"
          style={{
            backgroundImage: 'radial-gradient(var(--adm-border) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />

        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10 w-full max-w-[360px] px-4"
        >
          {/* Amber top accent bar */}
          <div className="h-[2px] w-full bg-adm-amber" />

          <div className="bg-adm-bg border border-adm-border border-t-0">
            {forgotStep === 'none' ? (
              <>
                {/* Header */}
                <div className="px-8 pt-8 pb-6 border-b border-adm-border">
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.25 }}
                  >
                    <h1 className="font-mono text-[16px] font-semibold text-adm-t1 leading-snug">
                      Administrator Sign In
                    </h1>
                    <p className="font-mono text-[10px] text-adm-t3 mt-1.5 tracking-wide">
                      Enter your credentials to continue
                    </p>
                  </motion.div>
                </div>

                {/* Form */}
                <div className="px-8 py-7">
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

                  <form onSubmit={handleSubmit} className="space-y-5">
                    <motion.div
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.3 }}
                    >
                      <label className="block font-mono text-[8.5px] uppercase tracking-[0.16em] text-adm-t3 mb-1.5">
                        Email
                      </label>
                      <div className="relative group">
                        <Mail size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-adm-t3 group-focus-within:text-adm-amber transition-colors" />
                        <input
                          type="text"
                          required
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          placeholder="admin@fiatx.com"
                          className="w-full pl-8 pr-3 py-2.5 bg-adm-panel border border-adm-border font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none transition-colors"
                        />
                      </div>
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.35 }}
                    >
                      <label className="block font-mono text-[8.5px] uppercase tracking-[0.16em] text-adm-t3 mb-1.5">
                        Password
                      </label>
                      <div className="relative group">
                        <Lock size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-adm-t3 group-focus-within:text-adm-amber transition-colors" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          placeholder="••••••••••"
                          className="w-full pl-8 pr-9 py-2.5 bg-adm-panel border border-adm-border font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-adm-t3 hover:text-adm-t2 transition-colors"
                        >
                          {showPassword ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => { setError(''); setForgotStep('email'); }}
                          className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3 hover:text-adm-amber transition-colors"
                        >
                          Forgot Password?
                        </button>
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

                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.42 }}
                    >
                      <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-adm-amber font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-gray-950 hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
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
                  transition={{ delay: 0.5 }}
                  className="px-8 py-4 border-t border-adm-border"
                >
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-adm-t3 text-center">
                    All activity is monitored and logged · 256-bit SSL
                  </p>
                </motion.div>
              </>
            ) : (
              <>
                {/* Forgot Password Header */}
                <div className="px-8 pt-8 pb-6 border-b border-adm-border">
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.3 }}
                  >
                    <h1 className="font-mono text-[16px] font-semibold text-adm-t1 leading-snug">
                      {forgotStep === 'email' && 'Reset Password'}
                      {forgotStep === 'mfa' && 'Verify Identity'}
                      {forgotStep === 'sent' && 'Check Your Email'}
                    </h1>
                    <p className="font-mono text-[10px] text-adm-t3 mt-1.5 tracking-wide">
                      {forgotStep === 'email' && 'Enter the email associated with your account'}
                      {forgotStep === 'mfa' && 'Enter the 6-digit code from your authenticator'}
                      {forgotStep === 'sent' && 'A password reset link has been sent'}
                    </p>
                  </motion.div>
                </div>

                {/* Forgot Password Body */}
                <div className="px-8 py-7">
                  {forgotError && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="mb-5 flex items-center gap-2 rounded px-3 py-2.5 border border-adm-red/30 bg-adm-red/8"
                    >
                      <AlertCircle size={12} className="text-adm-red flex-shrink-0" />
                      <span className="font-mono text-[10px] text-adm-red">{forgotError}</span>
                    </motion.div>
                  )}

                  {forgotStep === 'email' && (
                    <form onSubmit={handleForgotEmailSubmit} className="space-y-5">
                      <motion.div
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3 }}
                      >
                        <label className="block font-mono text-[8.5px] uppercase tracking-[0.16em] text-adm-t3 mb-1.5">
                          Email Address
                        </label>
                        <div className="relative group">
                          <Mail size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-adm-t3 group-focus-within:text-adm-amber transition-colors" />
                          <input
                            type="email"
                            required
                            value={forgotEmail}
                            onChange={e => setForgotEmail(e.target.value)}
                            placeholder="admin@fiatx.com"
                            className="w-full pl-8 pr-3 py-2.5 bg-adm-panel border border-adm-border font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none transition-colors"
                            autoFocus
                          />
                        </div>
                      </motion.div>

                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.1 }}
                      >
                        <button
                          type="submit"
                          disabled={forgotLoading}
                          className="w-full flex items-center justify-center gap-2 py-3 bg-adm-amber font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-gray-950 hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {forgotLoading ? (
                            <div className="w-4 h-4 border-2 border-gray-950/30 border-t-gray-950 rounded-full animate-spin" />
                          ) : (
                            <>Continue <ArrowRight size={12} /></>
                          )}
                        </button>
                      </motion.div>
                    </form>
                  )}

                  {forgotStep === 'mfa' && (
                    <form onSubmit={handleForgotMfaSubmit} className="space-y-5">
                      <motion.div
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3 }}
                      >
                        <label className="block font-mono text-[8.5px] uppercase tracking-[0.16em] text-adm-t3 mb-1.5">
                          Verification Code
                        </label>
                        <div className="relative group">
                          <ShieldCheck size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-adm-t3 group-focus-within:text-adm-amber transition-colors" />
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            required
                            value={forgotMfaCode}
                            onChange={e => setForgotMfaCode(e.target.value.replace(/\D/g, ''))}
                            placeholder="000000"
                            className="w-full pl-8 pr-3 py-2.5 bg-adm-panel border border-adm-border font-mono text-[15px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none transition-colors tracking-[0.4em]"
                            autoFocus
                          />
                        </div>
                      </motion.div>

                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.1 }}
                      >
                        <button
                          type="submit"
                          disabled={forgotMfaCode.length !== 6 || forgotLoading}
                          className="w-full flex items-center justify-center gap-2 py-3 bg-adm-amber font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-gray-950 hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {forgotLoading ? (
                            <div className="w-4 h-4 border-2 border-gray-950/30 border-t-gray-950 rounded-full animate-spin" />
                          ) : (
                            <>Verify <ArrowRight size={12} /></>
                          )}
                        </button>
                      </motion.div>
                    </form>
                  )}

                  {forgotStep === 'sent' && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4 }}
                      className="text-center space-y-4"
                    >
                      <div className="flex justify-center">
                        <div className="w-10 h-10 rounded-full bg-adm-green/10 border border-adm-green/20 flex items-center justify-center">
                          <CheckCircle size={18} className="text-adm-green" />
                        </div>
                      </div>
                      <p className="font-mono text-[11px] text-adm-t1 leading-relaxed">
                        Reset link sent to your email
                      </p>
                      <p className="font-mono text-[9px] text-adm-t3 leading-relaxed">
                        If an account exists for that email, you will receive a password reset link shortly.
                      </p>
                    </motion.div>
                  )}

                  {/* Back to Login link */}
                  <div className="mt-5 pt-4 border-t border-adm-border">
                    <button
                      type="button"
                      onClick={resetForgotFlow}
                      className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3 hover:text-adm-amber transition-colors"
                    >
                      <ArrowLeft size={10} />
                      Back to Login
                    </button>
                  </div>
                </div>

                {/* Footer */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="px-8 py-4 border-t border-adm-border"
                >
                  <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-adm-t3 text-center">
                    All activity is monitored and logged · 256-bit SSL
                  </p>
                </motion.div>
              </>
            )}
          </div>
        </motion.div>
      </div>

      {/* MFA Verification Modal */}
      {showMfaInput && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="w-full max-w-[340px] mx-4">
            {/* Amber top accent bar */}
            <div className="h-[2px] w-full bg-adm-amber" />

            <div className="bg-adm-bg border border-adm-border border-t-0">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-adm-border">
                <div>
                  <p className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-adm-t3 mb-0.5">
                    Security Verification
                  </p>
                  <h2 className="font-mono text-[13px] font-semibold text-adm-t1">
                    Two-Factor Authentication
                  </h2>
                </div>
                <button
                  onClick={() => { setShowMfaInput(false); setMfaCode(''); setError(''); }}
                  className="text-adm-t3 hover:text-adm-t1 transition-colors"
                >
                  <X size={13} />
                </button>
              </div>

              {/* Body */}
              <div className="px-6 py-5 space-y-4">
                <p className="font-mono text-[10px] text-adm-t3 leading-relaxed">
                  Enter the 6-digit code from your authenticator app to continue.
                </p>

                <div>
                  <label className="block font-mono text-[8.5px] uppercase tracking-[0.16em] text-adm-t3 mb-1.5">
                    Verification Code
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="w-full px-3 py-2.5 bg-adm-panel border border-adm-border font-mono text-[15px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none transition-colors tracking-[0.4em] text-center"
                    autoFocus
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 px-3 py-2 border border-adm-red/30 bg-adm-red/8">
                    <AlertCircle size={11} className="text-adm-red flex-shrink-0" />
                    <span className="font-mono text-[10px] text-adm-red">{error}</span>
                  </div>
                )}

                <button
                  onClick={handleMfaVerify}
                  disabled={mfaCode.length !== 6 || mfaSubmitting}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-adm-amber font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-gray-950 hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {mfaSubmitting ? (
                    <div className="w-3.5 h-3.5 border-2 border-gray-950/30 border-t-gray-950 rounded-full animate-spin" />
                  ) : (
                    <>Verify <ArrowRight size={11} /></>
                  )}
                </button>
              </div>

              {/* Footer */}
              <div className="px-6 py-3 border-t border-adm-border">
                <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-adm-t3 text-center">
                  All activity is monitored and logged · 256-bit SSL
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

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
