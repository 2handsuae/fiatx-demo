import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Eye, EyeOff } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/* ────────────────────────────────────────────────────────────────
 *  Sign in — FIATX
 *  No splashy illustrations. Just an editorial column and a form.
 * ──────────────────────────────────────────────────────────────── */

const MASTHEAD = ['F', 'I', 'A', 'T', 'X'];

function MiniMasthead() {
  return (
    <Link to="/" className="inline-flex items-end gap-1.5">
      {MASTHEAD.map((l, i) => (
        <span key={i} className="inline-flex items-end">
          <span className="fx-display font-light text-[22px] leading-none text-fx-sand">{l}</span>
          {i < MASTHEAD.length - 1 && (
            <span className="w-[3px] h-[3px] rounded-full bg-fx-brass mx-2 mb-[0.25em] shrink-0" />
          )}
        </span>
      ))}
    </Link>
  );
}

const CustomerLogin = () => {
  const [method, setMethod] = useState<'email' | 'phone'>('email');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const navigate = useNavigate();
  const { refreshProfile } = useAuth();

  const [formData, setFormData] = useState({
    email: '',
    phone: '',
    password: '',
  });

  useEffect(() => {
    const raw = sessionStorage.getItem('customer_login_notice');
    if (!raw) return;
    sessionStorage.removeItem('customer_login_notice');
    try {
      const parsed = JSON.parse(raw) as { code?: string; message?: string };
      if (String(parsed?.code || '').toUpperCase() === 'CUSTOMER_ACCOUNT_FROZEN') {
        setToastMessage(
          parsed?.message || 'Account frozen. Please contact compliance support.',
        );
      }
    } catch {
      /* ignore */
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const loginData: Record<string, string> = { password: formData.password };
      if (method === 'email') {
        loginData.email = formData.email.trim();
      } else {
        loginData.phone = formData.phone.trim();
      }

      const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/customer/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginData),
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem('customer_token', data.access_token);
        await refreshProfile();
        navigate('/profile');
      } else {
        const err = await response.json().catch(() => ({}));
        const code = String(err?.code || '').trim().toUpperCase();
        if (code === 'CUSTOMER_ACCOUNT_FROZEN') {
          setError('');
          setToastMessage('Account frozen. Please contact compliance support.');
        } else {
          setError(
            typeof err?.message === 'string' && err.message ? err.message : 'Login failed',
          );
        }
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-fx-obsidian text-fx-sand flex flex-col">
      {/* ── Slim header ──────────────────────────────────────── */}
      <header className="border-b border-fx-rule">
        <div className="mx-auto max-w-[1400px] px-6 md:px-10 h-[72px] flex items-center justify-between">
          <MiniMasthead />
          <div className="flex items-center gap-8">
            <span className="hidden sm:inline fx-cap">Member sign in</span>
            <Link to="/register" className="fx-btn-ghost">
              Open account
            </Link>
          </div>
        </div>
      </header>

      {/* ── Toast banner ─────────────────────────────────────── */}
      {toastMessage && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-b border-fx-rust/30 bg-fx-rust/10 px-6 py-3"
        >
          <div className="mx-auto max-w-[1400px] font-mono text-[11px] text-fx-rust">
            {toastMessage}
          </div>
        </motion.div>
      )}

      {/* ── Body — editorial two-column ──────────────────────── */}
      <main className="flex-1">
        <div className="mx-auto max-w-[1400px] px-6 md:px-10 grid grid-cols-12 gap-x-6 md:gap-x-10 pt-16 md:pt-24 pb-20">
          {/* ── Left: editorial gutter ────────────────────── */}
          <motion.aside
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.9, ease: [0.19, 1, 0.22, 1] }}
            className="hidden lg:flex lg:col-span-5 xl:col-span-6 flex-col justify-between lg:pr-16 lg:border-r lg:border-fx-rule min-h-[560px]"
          >
            <div>
              <div className="fx-cap mb-8">§ Member sign in</div>
              <h1 className="fx-display font-light text-[72px] xl:text-[92px] leading-[0.9] text-fx-sand">
                Welcome
                <br />
                <span className="italic fx-serif text-fx-brass">back.</span>
              </h1>
              <p className="mt-8 fx-serif text-[16px] leading-[1.7] text-fx-dune max-w-md">
                Your desk, your positions, your onboarding status — kept under the same
                eight-year retention clock we apply to every other audit event.
              </p>
            </div>

            {/* Vertical ornament: rate pair with rule */}
            <div className="border-t border-fx-rule pt-6 space-y-2">
              <div className="fx-cap">Reference rate</div>
              <div className="flex items-baseline gap-4">
                <span className="font-mono text-[13px] text-fx-dust">AED / USDT</span>
                <span className="font-mono text-[22px] text-fx-sand tabular-nums">3.6725</span>
                <span className="font-mono text-[11px] text-fx-sage tabular-nums">+0.0012</span>
              </div>
              <div className="fx-cap text-fx-dust/60">
                Indicative · sourced from aggregated OTC desk
              </div>
            </div>
          </motion.aside>

          {/* ── Right: the form ───────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.9, ease: [0.19, 1, 0.22, 1] }}
            className="col-span-12 lg:col-span-7 xl:col-span-6 lg:pl-16"
          >
            {/* Mobile header */}
            <div className="lg:hidden mb-10">
              <div className="fx-cap mb-4">§ Member sign in</div>
              <h1 className="fx-display font-light text-[48px] leading-[0.95] text-fx-sand">
                Welcome <span className="italic text-fx-brass">back.</span>
              </h1>
            </div>

            {/* Method toggle — hairline segmented control */}
            <div className="mb-10 flex border-b border-fx-rule">
              {(['email', 'phone'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`font-mono text-[11px] uppercase tracking-[0.18em] px-6 py-3 transition-colors border-b-2 -mb-[1px] ${
                    method === m
                      ? 'text-fx-brass border-fx-brass'
                      : 'text-fx-dust border-transparent hover:text-fx-dune'
                  }`}
                >
                  {m === 'email' ? 'Email' : 'Phone'}
                </button>
              ))}
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-8 border-l-2 border-fx-rust bg-fx-rust/5 px-4 py-3 font-mono text-[11px] text-fx-rust"
              >
                {error}
              </motion.div>
            )}

            <form onSubmit={handleSubmit} className="space-y-8">
              {/* ── Identifier field ──────────────────────── */}
              <div>
                <label className="fx-cap block mb-3">
                  {method === 'email' ? 'Email address' : 'Phone number'}
                </label>
                {method === 'email' ? (
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                    placeholder="name@fiatx.ae"
                    className="fx-input"
                  />
                ) : (
                  <input
                    type="tel"
                    required
                    value={formData.phone}
                    onChange={(e) =>
                      setFormData({ ...formData, phone: e.target.value })
                    }
                    placeholder="+971 50 123 4567"
                    className="fx-input"
                  />
                )}
              </div>

              {/* ── Password field ────────────────────────── */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="fx-cap">Password</label>
                  <a href="#" className="fx-cap text-fx-dust hover:text-fx-brass transition-colors">
                    Forgot?
                  </a>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={formData.password}
                    onChange={(e) =>
                      setFormData({ ...formData, password: e.target.value })
                    }
                    placeholder="••••••••"
                    className="fx-input pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-0 top-3 text-fx-dust hover:text-fx-brass transition-colors"
                    aria-label="Toggle password visibility"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* ── Submit ─────────────────────────────────── */}
              <div className="pt-6">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="fx-btn-primary w-full"
                >
                  {isLoading ? (
                    <>
                      <span className="w-3 h-3 border border-fx-obsidian border-t-transparent rounded-full animate-spin" />
                      Authenticating
                    </>
                  ) : (
                    <>Sign in →</>
                  )}
                </button>
              </div>
            </form>

            {/* ── Footer links ───────────────────────────── */}
            <div className="mt-14 pt-6 border-t border-fx-rule flex items-center justify-between">
              <span className="fx-cap text-fx-dust">
                New to FIATX?
              </span>
              <Link
                to="/register"
                className="fx-cap text-fx-brass hover:text-fx-ember transition-colors"
              >
                Open an account →
              </Link>
            </div>

            {/* ── Regulatory watermark ─────────────────── */}
            <div className="mt-20 pt-6 border-t border-fx-rule">
              <div className="font-mono text-[10px] leading-relaxed text-fx-dust/70 tracking-wider">
                VARA VASP · LICENCE No. 2025/DXB-••••
                <br />
                All activity is logged, retained for 8 years and subject to MLRO review.
              </div>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
};

export default CustomerLogin;
