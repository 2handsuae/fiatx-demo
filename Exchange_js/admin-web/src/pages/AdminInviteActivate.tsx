import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Lock, ArrowRight, ArrowLeft, AlertCircle, CheckCircle, Eye, EyeOff } from 'lucide-react';

export default function AdminInviteActivate() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';

  const [email, setEmail] = useState('');
  const [userNo, setUserNo] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [loadError, setLoadError] = useState('');
  const [tokenLoading, setTokenLoading] = useState(true);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<'form' | 'success' | 'error'>('form');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    if (!token) {
      setLoadError('No invitation token found in the URL.');
      setTokenLoading(false);
      return;
    }
    const run = async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_API_URL}/auth/admin-invitations/${encodeURIComponent(token)}`,
        );
        const payload = await res.json();
        if (!res.ok) throw new Error(payload?.message || 'Invitation link is unavailable.');
        setEmail(payload.email || '');
        setUserNo(payload.userNo || '');
        setExpiresAt(payload.expiresAt || '');
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Invitation link is unavailable.');
      } finally {
        setTokenLoading(false);
      }
    };
    void run();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setErrorMsg('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/admin-invitations/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password: newPassword }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Activation failed');
      }
      setStatus('success');
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message || 'Link is invalid or expired');
    } finally {
      setLoading(false);
    }
  };

  /* ── Shared layout ── */
  const renderCard = (children: React.ReactNode) => (
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
        <img
          src="https://images.unsplash.com/photo-1639762681485-074b7f938ba0?q=80&w=2832&auto=format&fit=crop"
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/50 to-black/80" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 70% 60% at 40% 60%, rgba(245,158,11,0.08) 0%, transparent 70%)',
          }}
        />

        <div className="relative z-10 flex flex-col justify-between h-full p-12 w-full">
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

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.6 }}
            className="space-y-5"
          >
            <div className="w-10 h-[2px] bg-adm-amber" />
            <h2 className="font-mono text-3xl font-semibold text-white leading-snug">
              Account<br />Activation
            </h2>
            <p className="font-mono text-[11px] text-white/40 uppercase tracking-[0.12em] leading-relaxed max-w-xs">
              Secure account setup.<br />
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

        <div className="absolute inset-y-0 right-0 w-16 bg-gradient-to-r from-transparent to-adm-panel pointer-events-none" />
      </motion.div>

      {/* ── Right: Form panel (45%) ── */}
      <div className="w-full lg:w-[45%] flex flex-col justify-center items-center relative bg-adm-panel border-l border-adm-border">
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
          <div className="h-[2px] w-full bg-adm-amber" />
          <div className="bg-adm-bg border border-adm-border border-t-0">
            {children}
          </div>
        </motion.div>
      </div>
    </div>
  );

  /* ── Invalid / missing token ── */
  if (!token || loadError) {
    return renderCard(
      <>
        <div className="px-8 pt-8 pb-6 border-b border-adm-border">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
            <h1 className="font-mono text-[16px] font-semibold text-adm-t1 leading-snug">
              Invalid Link
            </h1>
            <p className="font-mono text-[10px] text-adm-t3 mt-1.5 tracking-wide">
              {!token ? 'No invitation token found in the URL' : 'This invitation link is unavailable'}
            </p>
          </motion.div>
        </div>
        <div className="px-8 py-7">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="text-center space-y-4"
          >
            <div className="flex justify-center">
              <div className="w-10 h-10 rounded-full bg-adm-red/10 border border-adm-red/20 flex items-center justify-center">
                <AlertCircle size={18} className="text-adm-red" />
              </div>
            </div>
            <p className="font-mono text-[10px] text-adm-t3 leading-relaxed">
              {loadError || 'The link you followed is missing or malformed.'}<br />
              Please contact your administrator for a new invitation.
            </p>
          </motion.div>
          <div className="mt-5 pt-4 border-t border-adm-border">
            <button
              type="button"
              onClick={() => navigate('/admin/login')}
              className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3 hover:text-adm-amber transition-colors"
            >
              <ArrowLeft size={10} />
              Back to Login
            </button>
          </div>
        </div>
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
    );
  }

  /* ── Token loading ── */
  if (tokenLoading) {
    return renderCard(
      <div className="px-8 py-12 text-center">
        <div className="flex justify-center mb-4">
          <div className="w-5 h-5 border-2 border-adm-border border-t-adm-amber rounded-full animate-spin" />
        </div>
        <p className="font-mono text-[10px] text-adm-t3 uppercase tracking-[0.12em]">
          Validating invitation…
        </p>
      </div>
    );
  }

  /* ── Success ── */
  if (status === 'success') {
    return renderCard(
      <>
        <div className="px-8 pt-8 pb-6 border-b border-adm-border">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
            <h1 className="font-mono text-[16px] font-semibold text-adm-t1 leading-snug">
              Account Activated
            </h1>
            <p className="font-mono text-[10px] text-adm-t3 mt-1.5 tracking-wide">
              Your admin account is ready
            </p>
          </motion.div>
        </div>
        <div className="px-8 py-7">
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
              Activation complete
            </p>
            <p className="font-mono text-[9px] text-adm-t3 leading-relaxed">
              You can now sign in with your new password.
            </p>
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mt-6"
          >
            <button
              type="button"
              onClick={() => navigate('/admin/login')}
              className="w-full flex items-center justify-center gap-2 py-3 bg-adm-amber font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-gray-950 hover:opacity-90 active:opacity-80 transition-opacity"
            >
              <ArrowLeft size={12} /> Back to Login
            </button>
          </motion.div>
        </div>
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
    );
  }

  /* ── Form (default) ── */
  return renderCard(
    <>
      <div className="px-8 pt-8 pb-6 border-b border-adm-border">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
          <h1 className="font-mono text-[16px] font-semibold text-adm-t1 leading-snug">
            Set Your Password
          </h1>
          <p className="font-mono text-[10px] text-adm-t3 mt-1.5 tracking-wide">
            Complete your account activation
          </p>
        </motion.div>
      </div>

      <div className="px-8 py-7">
        {/* Invitation context */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="mb-5 rounded px-3 py-2.5 border border-adm-border bg-adm-panel"
        >
          <div className="space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-adm-t3">Account</span>
              <span className="font-mono text-[10px] text-adm-t2">{email}</span>
            </div>
            {userNo && (
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-adm-t3">User No</span>
                <span className="font-mono text-[10px] text-adm-t2">{userNo}</span>
              </div>
            )}
            {expiresAt && (
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-adm-t3">Expires</span>
                <span className="font-mono text-[10px] text-adm-t2">
                  {new Date(expiresAt).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </motion.div>

        {(status === 'error' || errorMsg) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="mb-5 rounded px-3 py-2.5 border border-adm-red/30 bg-adm-red/8"
          >
            <div className="flex items-center gap-2">
              <AlertCircle size={12} className="text-adm-red flex-shrink-0" />
              <span className="font-mono text-[10px] text-adm-red">
                {errorMsg || 'Invalid or expired invitation token'}
              </span>
            </div>
          </motion.div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
          >
            <label className="block font-mono text-[8.5px] uppercase tracking-[0.16em] text-adm-t3 mb-1.5">
              New Password
            </label>
            <div className="relative group">
              <Lock size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-adm-t3 group-focus-within:text-adm-amber transition-colors" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setErrorMsg(''); }}
                placeholder="••••••••••"
                className="w-full pl-8 pr-9 py-2.5 bg-adm-panel border border-adm-border font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none transition-colors"
                minLength={8}
                required
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-adm-t3 hover:text-adm-t2 transition-colors"
              >
                {showPassword ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.35 }}
          >
            <label className="block font-mono text-[8.5px] uppercase tracking-[0.16em] text-adm-t3 mb-1.5">
              Confirm Password
            </label>
            <div className="relative group">
              <Lock size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-adm-t3 group-focus-within:text-adm-amber transition-colors" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setErrorMsg(''); }}
                placeholder="••••••••••"
                className="w-full pl-8 pr-3 py-2.5 bg-adm-panel border border-adm-border font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none transition-colors"
                minLength={8}
                required
              />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.42 }}
          >
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 bg-adm-amber font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-gray-950 hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-gray-950/30 border-t-gray-950 rounded-full animate-spin" />
              ) : (
                <>Activate Account <ArrowRight size={12} /></>
              )}
            </button>
          </motion.div>
        </form>

        <div className="mt-5 pt-4 border-t border-adm-border">
          <button
            type="button"
            onClick={() => navigate('/admin/login')}
            className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3 hover:text-adm-amber transition-colors"
          >
            <ArrowLeft size={10} />
            Back to Login
          </button>
        </div>
      </div>

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
  );
}
