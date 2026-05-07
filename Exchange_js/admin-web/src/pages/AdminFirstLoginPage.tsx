import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { notifyAdminAuthChanged } from '../contexts/AdminSessionContext';

const API = import.meta.env.VITE_API_URL as string;

function firstLoginFetch(path: string, method = 'GET', body?: object) {
  const token = sessionStorage.getItem('firstLoginToken');
  return fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

const STATUS_TO_STEP: Record<string, number> = {
  PENDING_IDENTITY_CONFIRM: 0,
  MFA_BINDING: 1,
  POLICY_ACK_PENDING: 2,
  COMPLETED: 2,
};

const SECURITY_RULES = [
  'MFA verification is required at every login',
  'Password must be changed every 90 days',
  'Sharing accounts or MFA devices is strictly prohibited',
  'All operations are recorded and audited by the system',
  'Any security anomaly must be reported to the CISO immediately',
];

const STEP_LABELS = [
  'Identity',
  'MFA Setup',
  'Security',
  'Complete',
];

// ── Progress Bar ──────────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEP_LABELS.map((label, i) => {
        const isActive = i === step;
        const isDone = i < step;
        return (
          <div key={i} className="flex-1 flex flex-col items-center">
            <div className="w-full flex items-center">
              {i > 0 && (
                <div
                  className={`h-[2px] flex-1 transition-colors ${
                    isDone || isActive ? 'bg-adm-amber' : 'bg-adm-border'
                  }`}
                />
              )}
              <div
                className={`w-6 h-6 flex items-center justify-center rounded-full border-2 font-mono text-[10px] font-bold transition-colors flex-shrink-0 ${
                  isDone
                    ? 'bg-adm-amber border-adm-amber text-gray-950'
                    : isActive
                    ? 'bg-adm-bg border-adm-amber text-adm-amber'
                    : 'bg-adm-bg border-adm-border text-adm-t3'
                }`}
              >
                {isDone ? '✓' : i + 1}
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div
                  className={`h-[2px] flex-1 transition-colors ${
                    i < step - 1 || (isDone && step > i + 1)
                      ? 'bg-adm-amber'
                      : 'bg-adm-border'
                  }`}
                />
              )}
            </div>
            <span
              className={`mt-1.5 font-mono text-[9px] uppercase tracking-[0.12em] ${
                isActive ? 'text-adm-amber' : isDone ? 'text-adm-t2' : 'text-adm-t3'
              }`}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Step 0: Identity Confirm ──────────────────────────────────────────────────

interface MeInfo {
  email: string;
  role: string;
  userNo: string;
}

function IdentityConfirmStep({ onNext }: { onNext: () => void }) {
  const [meInfo, setMeInfo] = useState<MeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await firstLoginFetch('/auth/first-login/me');
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError((data as { message?: string }).message || 'Unable to load user info.');
          return;
        }
        const data = await res.json() as MeInfo;
        setMeInfo(data);
      } catch {
        setError('Network error. Please try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleConfirm = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await firstLoginFetch('/auth/first-login/confirm-identity', 'POST');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { message?: string }).message || 'Identity confirmation failed. Please try again.');
        return;
      }
      onNext();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-mono text-[15px] font-semibold text-adm-t1">Complete Your First-Login Setup</h2>
        <p className="font-mono text-[11px] text-adm-t3 mt-2 leading-relaxed">
          First-time login requires MFA binding and security acknowledgement. Takes about 2 minutes.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded px-3 py-2.5 border border-adm-red/30 bg-adm-red/8">
          <span className="font-mono text-[10px] text-adm-red">{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-6">
          <div className="w-5 h-5 border-2 border-adm-border border-t-adm-amber rounded-full animate-spin" />
        </div>
      ) : meInfo ? (
        <div className="bg-adm-panel border border-adm-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-adm-t3">User No.</span>
            <span className="font-mono text-[11px] text-adm-amber">{meInfo.userNo}</span>
          </div>
          <div className="border-t border-adm-border" />
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-adm-t3">Email</span>
            <span className="font-mono text-[11px] text-adm-t1">{meInfo.email}</span>
          </div>
          <div className="border-t border-adm-border" />
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-adm-t3">Role</span>
            <span className="font-mono text-[11px] text-adm-t1">{meInfo.role}</span>
          </div>
        </div>
      ) : null}

      <button
        onClick={handleConfirm}
        disabled={submitting || loading || !!error}
        className="w-full flex items-center justify-center gap-2 py-3 bg-adm-amber font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-gray-950 hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? (
          <div className="w-4 h-4 border-2 border-gray-950/30 border-t-gray-950 rounded-full animate-spin" />
        ) : (
          'Begin Setup →'
        )}
      </button>
    </div>
  );
}

// ── Step 1: MFA Binding ───────────────────────────────────────────────────────

interface MfaInitData {
  qrDataUrl: string;
  manualKey: string;
}

function MfaBindingStep({ onNext }: { onNext: () => void }) {
  const [mfaData, setMfaData] = useState<MfaInitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [lockMessage, setLockMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await firstLoginFetch('/auth/first-login/mfa/init', 'POST');
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError((data as { message?: string }).message || 'Failed to initialise MFA.');
          return;
        }
        const data = await res.json() as MfaInitData;
        setMfaData(data);
      } catch {
        setError('Network error. Please try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleVerify = async () => {
    if (code.length !== 6) {
      setError('Please enter a 6-digit code.');
      return;
    }
    setSubmitting(true);
    setError('');
    setLockMessage('');
    try {
      const res = await firstLoginFetch('/auth/first-login/mfa/verify', 'POST', { code });
      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        setLockMessage((data as { message?: string }).message || 'Too many attempts. Account temporarily locked. Please try again later.');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const typed = data as { message?: string; attemptsRemaining?: number };
        const msg = typed.message || 'Incorrect code. Please try again.';
        const remaining = typed.attemptsRemaining;
        setError(remaining !== undefined ? `${msg} (${remaining} attempts remaining)` : msg);
        return;
      }
      onNext();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-mono text-[15px] font-semibold text-adm-t1">Bind MFA Authenticator</h2>
        <p className="font-mono text-[11px] text-adm-t3 mt-2 leading-relaxed">
          Scan the QR code with Google Authenticator or any TOTP app
        </p>
      </div>

      {lockMessage && (
        <div className="flex items-center gap-2 rounded px-3 py-2.5 border border-adm-red/30 bg-adm-red/8">
          <span className="font-mono text-[10px] text-adm-red">{lockMessage}</span>
        </div>
      )}

      {error && !lockMessage && (
        <div className="flex items-center gap-2 rounded px-3 py-2.5 border border-adm-red/30 bg-adm-red/8">
          <span className="font-mono text-[10px] text-adm-red">{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-6">
          <div className="w-5 h-5 border-2 border-adm-border border-t-adm-amber rounded-full animate-spin" />
        </div>
      ) : mfaData ? (
        <div className="space-y-4">
          {/* QR Code */}
          <div className="flex justify-center">
            <div className="bg-white p-3 rounded border border-adm-border">
              <img
                src={mfaData.qrDataUrl}
                alt="MFA QR Code"
                className="w-40 h-40 block"
              />
            </div>
          </div>

          {/* Manual key */}
          <div className="bg-adm-panel border border-adm-border p-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-adm-t3 mb-1.5">
              Manual Entry Key
            </p>
            <p className="font-mono text-[11px] text-adm-amber break-all">{mfaData.manualKey}</p>
          </div>

          {/* Code input */}
          <div>
            <label className="block font-mono text-[8.5px] uppercase tracking-[0.16em] text-adm-t3 mb-1.5">
              Verification Code (6 digits)
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              disabled={!!lockMessage}
              className="w-full px-3 py-2.5 bg-adm-panel border border-adm-border font-mono text-[13px] text-adm-t1 placeholder:text-adm-t3 focus:border-adm-amber focus:outline-none transition-colors tracking-[0.3em] disabled:opacity-50"
            />
          </div>
        </div>
      ) : null}

      <button
        onClick={handleVerify}
        disabled={submitting || loading || !!lockMessage || code.length !== 6}
        className="w-full flex items-center justify-center gap-2 py-3 bg-adm-amber font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-gray-950 hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? (
          <div className="w-4 h-4 border-2 border-gray-950/30 border-t-gray-950 rounded-full animate-spin" />
        ) : (
          'Verify & Bind'
        )}
      </button>
    </div>
  );
}

// ── Step 2: Policy Acknowledge ────────────────────────────────────────────────

function PolicyAckStep({ onNext }: { onNext: () => void }) {
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleAck = async () => {
    setSubmitting(true);
    setError('');
    try {
      const res = await firstLoginFetch('/auth/first-login/policy/acknowledge', 'POST');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { message?: string }).message || 'Confirmation failed. Please try again.');
        return;
      }
      const data = await res.json() as { accessToken?: string };
      sessionStorage.removeItem('firstLoginToken');
      if (data.accessToken) {
        localStorage.setItem('admin_token', data.accessToken);
        notifyAdminAuthChanged();
      }
      onNext();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-mono text-[15px] font-semibold text-adm-t1">Security Policy</h2>
        <p className="font-mono text-[11px] text-adm-t3 mt-2 leading-relaxed">
          Please read the security rules carefully before accessing the system.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded px-3 py-2.5 border border-adm-red/30 bg-adm-red/8">
          <span className="font-mono text-[10px] text-adm-red">{error}</span>
        </div>
      )}

      {/* Security rules */}
      <div className="bg-adm-panel border border-adm-border p-4">
        <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-adm-t3 mb-3">Security Rules</p>
        <ul className="space-y-2.5">
          {SECURITY_RULES.map((rule, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className="font-mono text-[9px] text-adm-amber mt-0.5 flex-shrink-0">{i + 1}.</span>
              <span className="font-mono text-[11px] text-adm-t1 leading-relaxed">{rule}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Checkbox */}
      <label className="flex items-start gap-3 cursor-pointer group">
        <div className="relative mt-0.5 flex-shrink-0">
          <input
            type="checkbox"
            className="sr-only"
            checked={agreed}
            onChange={e => setAgreed(e.target.checked)}
          />
          <div
            className={`w-4 h-4 border flex items-center justify-center transition-colors ${
              agreed
                ? 'bg-adm-amber border-adm-amber'
                : 'bg-adm-panel border-adm-border group-hover:border-adm-amber'
            }`}
          >
            {agreed && (
              <svg className="w-2.5 h-2.5 text-gray-950" fill="none" viewBox="0 0 10 10" stroke="currentColor" strokeWidth={2}>
                <polyline points="1.5,5.5 4,8 8.5,2" />
              </svg>
            )}
          </div>
        </div>
        <span className="font-mono text-[11px] text-adm-t2 leading-relaxed">
          I have read and agree to comply with the security rules above
        </span>
      </label>

      <button
        onClick={handleAck}
        disabled={!agreed || submitting}
        className="w-full flex items-center justify-center gap-2 py-3 bg-adm-amber font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-gray-950 hover:opacity-90 active:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? (
          <div className="w-4 h-4 border-2 border-gray-950/30 border-t-gray-950 rounded-full animate-spin" />
        ) : (
          'Confirm & Enter System'
        )}
      </button>
    </div>
  );
}

// ── Step 3: Completion ────────────────────────────────────────────────────────

function CompletionStep() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6 text-center">
      <div className="flex justify-center">
        <div className="w-16 h-16 rounded-full bg-adm-amber/10 border-2 border-adm-amber flex items-center justify-center">
          <span className="text-2xl">✅</span>
        </div>
      </div>

      <div>
        <h2 className="font-mono text-[15px] font-semibold text-adm-t1">Setup Complete</h2>
        <p className="font-mono text-[11px] text-adm-t3 mt-2">
          MFA Bound · Security Policy Accepted
        </p>
      </div>

      <div className="bg-adm-panel border border-adm-border p-4 space-y-2">
        <div className="flex items-center gap-2 justify-center">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-adm-green opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-adm-green" />
          </span>
          <span className="font-mono text-[10px] text-adm-t2 uppercase tracking-[0.12em]">Account Ready</span>
        </div>
      </div>

      <button
        onClick={() => navigate('/dashboard')}
        className="w-full flex items-center justify-center gap-2 py-3 bg-adm-amber font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-gray-950 hover:opacity-90 active:opacity-80 transition-opacity"
      >
        Enter Admin Console →
      </button>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminFirstLoginPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<number | null>(null); // null = loading status

  useEffect(() => {
    document.documentElement.classList.add('dark');

    const token = sessionStorage.getItem('firstLoginToken');
    if (!token) {
      navigate('/admin/login', { replace: true });
      return;
    }

    // Recover current step from server
    void (async () => {
      try {
        const res = await firstLoginFetch('/auth/first-login/status');
        if (!res.ok) {
          sessionStorage.removeItem('firstLoginToken');
          localStorage.setItem('admin_login_error', 'Your setup session has expired. Please sign in again to continue.');
          navigate('/admin/login', { replace: true });
          return;
        }
        const data = await res.json() as { status: string };
        const recovered = STATUS_TO_STEP[data.status];
        setStep(recovered !== undefined ? recovered : 0);
      } catch {
        // On network error, start from 0
        setStep(0);
      }
    })();
  }, [navigate]);

  if (step === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-adm-bg">
        <div className="w-5 h-5 border-2 border-adm-border border-t-adm-amber rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex overflow-hidden bg-adm-bg"
      style={{ fontFamily: '"JetBrains Mono", "SF Mono", monospace' }}
    >
      {/* Dot grid background */}
      <div
        className="fixed inset-0 pointer-events-none opacity-30"
        style={{
          backgroundImage: 'radial-gradient(var(--adm-border) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="relative z-10 w-full flex flex-col items-center justify-center px-4 py-12">
        {/* Header */}
        <div className="w-full max-w-md mb-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-adm-amber">
              <span className="font-mono text-[13px] font-bold text-gray-950">E</span>
            </div>
            <div>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-adm-t1">
                FiatX Admin
              </div>
              <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-adm-t3 mt-0.5">
                First-Login Setup
              </div>
            </div>
          </div>

          {/* Progress */}
          <ProgressBar step={step} />
        </div>

        {/* Card */}
        <div className="w-full max-w-md">
          {/* Amber top accent bar */}
          <div className="h-[2px] w-full bg-adm-amber" />

          <div className="bg-adm-bg border border-adm-border border-t-0 px-8 py-7">
            {step === 0 && (
              <IdentityConfirmStep onNext={() => setStep(1)} />
            )}
            {step === 1 && (
              <MfaBindingStep onNext={() => setStep(2)} />
            )}
            {step === 2 && (
              <PolicyAckStep onNext={() => setStep(3)} />
            )}
            {step === 3 && (
              <CompletionStep />
            )}
          </div>

          {/* Footer */}
          <div className="px-8 py-4 border border-t-0 border-adm-border bg-adm-bg">
            <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-adm-t3 text-center">
              All activity is audited and logged · 256-bit SSL
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
