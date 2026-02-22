import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Clock3, QrCode, RefreshCw, ShieldCheck } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { motion } from 'framer-motion';
import { useCustomerProfile } from '../hooks/useCustomerProfile';

interface OnboardingAction {
  type: string;
  payload?: Record<string, unknown>;
}

interface OnboardingSnapshot {
  id: string;
  customerType: 'INDIVIDUAL' | 'CORPORATE' | 'UNKNOWN';
  publicStatus: string;
  actions?: OnboardingAction[];
  blockedReason?: string | null;
  currentCddCaseId?: string | null;
  currentEddCaseId?: string | null;
  activeCaseId?: string | null;
  activeJourneyId?: string | null;
  eddRequired?: boolean;
}

interface NextStepPayload {
  publicStatus: string;
  actions: OnboardingAction[];
  blockedReason: string | null;
  activeCaseId: string | null;
  requiresEdd: boolean;
}

interface CaseSession {
  sessionId: string;
  providerSessionId: string;
  status: string;
  qrCodeUrl: string;
  expiresAt: string;
}

interface CaseItem {
  id: string;
  caseNo: string;
  caseType: 'CDD' | 'EDD';
  status: string;
  subjectKind: string;
  latestSession?: CaseSession | null;
  createdAt: string;
}

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const buttonClass =
  'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60 disabled:cursor-not-allowed';

const Verification = () => {
  const navigate = useNavigate();
  const { profile, loading, error, refreshProfile } = useCustomerProfile();

  const [onboarding, setOnboarding] = useState<OnboardingSnapshot | null>(null);
  const [nextStep, setNextStep] = useState<NextStepPayload | null>(null);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const token = localStorage.getItem('customer_token');

  const withAuth = async (url: string, init?: RequestInit) => {
    if (!token) throw new Error('No auth token');
    return fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
  };

  const loadOnboarding = async () => {
    if (!token) return;
    const response = await withAuth(`${import.meta.env.VITE_API_URL}/onboarding/me`);
    if (!response.ok) throw new Error('Failed to load onboarding snapshot');
    setOnboarding((await response.json()) as OnboardingSnapshot);
  };

  const loadNextStep = async () => {
    if (!token) return;
    const response = await withAuth(`${import.meta.env.VITE_API_URL}/onboarding/next-step`);
    if (!response.ok) throw new Error('Failed to load next step');
    setNextStep((await response.json()) as NextStepPayload);
  };

  const loadCases = async () => {
    if (!token) return;
    setCasesLoading(true);
    try {
      const response = await withAuth(`${import.meta.env.VITE_API_URL}/onboarding/cases`);
      if (!response.ok) throw new Error('Failed to load onboarding cases');
      const data = await response.json();
      setCases(Array.isArray(data.items) ? data.items : []);
    } finally {
      setCasesLoading(false);
    }
  };

  const refreshAll = async () => {
    try {
      await Promise.all([loadOnboarding(), loadNextStep(), loadCases(), refreshProfile()]);
    } catch (e: unknown) {
      setMessage(getErrorMessage(e, 'Failed to load onboarding data.'));
    }
  };

  useEffect(() => {
    if (profile && token) {
      refreshAll().catch(() => undefined);
    }
  }, [profile?.id]);

  useEffect(() => {
    const hasPending = cases.some((item) => item.latestSession?.status === 'PENDING');
    if (!hasPending) return;

    const timer = window.setInterval(() => {
      Promise.all([loadCases(), loadNextStep()]).catch(() => undefined);
    }, 8000);

    return () => window.clearInterval(timer);
  }, [cases]);

  const runAction = async (request: () => Promise<Response>, successMessage: string) => {
    setSaving(true);
    setMessage('');
    try {
      const response = await request();
      if (!response.ok) {
        const err = (await response.json().catch(() => ({}))) as { message?: string };
        setMessage(err.message || 'Operation failed.');
        return false;
      }
      setMessage(successMessage);
      await refreshAll();
      return true;
    } catch (e: unknown) {
      setMessage(getErrorMessage(e, 'Network error.'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const startCdd = async () =>
    runAction(
      () =>
        withAuth(`${import.meta.env.VITE_API_URL}/onboarding/cdd-cases/bootstrap`, {
          method: 'POST',
          body: JSON.stringify({}),
        }),
      'CDD case has been started.',
    );

  const reinitiateCdd = async () =>
    runAction(
      () =>
        withAuth(`${import.meta.env.VITE_API_URL}/onboarding/cdd-cases/reinitiate`, {
          method: 'POST',
          body: JSON.stringify({}),
        }),
      'CDD has been re-initiated.',
    );

  const startEdd = async () =>
    runAction(
      () =>
        withAuth(`${import.meta.env.VITE_API_URL}/onboarding/edd-cases/start`, {
          method: 'POST',
          body: JSON.stringify({}),
        }),
      'EDD session has been started.',
    );

  const reinitiateEdd = async () =>
    runAction(
      () =>
        withAuth(`${import.meta.env.VITE_API_URL}/onboarding/edd-cases/reinitiate`, {
          method: 'POST',
          body: JSON.stringify({}),
        }),
      'EDD has been re-initiated.',
    );

  const createSession = async (item: CaseItem) =>
    runAction(
      () =>
        withAuth(`${import.meta.env.VITE_API_URL}/onboarding/cases/${item.id}/sessions`, {
          method: 'POST',
          body: JSON.stringify({ caseType: item.caseType, provider: 'MOCK' }),
        }),
      `${item.caseType} session created.`,
    );

  const mockComplete = async (sessionId: string) =>
    runAction(
      () =>
        withAuth(`${import.meta.env.VITE_API_URL}/onboarding/sessions/${sessionId}/mock-complete`, {
          method: 'POST',
          body: JSON.stringify({ result: 'PASS' }),
        }),
      'Session callback simulated.',
    );

  const publicStatus =
    nextStep?.publicStatus || onboarding?.publicStatus || profile?.publicStatus || 'NONE';
  const actions =
    nextStep?.actions || onboarding?.actions || profile?.actions || [];

  const approved = publicStatus === 'ACTIVE';
  const hasAction = (type: string) => actions.some((item) => item.type === type);

  const activeCase = useMemo(() => {
    const targetCaseId = nextStep?.activeCaseId || onboarding?.activeCaseId || null;
    if (targetCaseId) {
      const matched = cases.find((item) => item.id === targetCaseId);
      if (matched) return matched;
    }

    if (hasAction('COMPLETE_EDD')) {
      return (
        cases.find((item) => item.caseType === 'EDD' && item.status === 'CREATED') ||
        cases.find((item) => item.caseType === 'EDD') ||
        null
      );
    }

    if (hasAction('COMPLETE_CDD')) {
      return (
        cases.find((item) => item.caseType === 'CDD' && item.status === 'CREATED') ||
        cases.find((item) => item.caseType === 'CDD') ||
        null
      );
    }

    return cases[0] || null;
  }, [cases, nextStep?.activeCaseId, onboarding?.activeCaseId, actions]);

  useEffect(() => {
    if (approved) {
      navigate('/profile', { replace: true });
    }
  }, [approved, navigate]);

  if (loading) return <div className="flex h-screen items-center justify-center text-slate-500">Loading...</div>;
  if (error) return <div className="flex h-screen items-center justify-center text-red-500">{error}</div>;
  if (!profile) return null;
  if (approved) return null;

  return (
    <div className="min-h-[calc(100vh-80px)] bg-slate-50 px-6 py-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Onboarding Verification</h1>
              <p className="mt-1 text-sm text-slate-500">
                Public status: <span className="font-semibold text-slate-700">{publicStatus}</span>
              </p>
            </div>
            <button
              onClick={() => refreshAll()}
              className={`${buttonClass} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
              disabled={saving || casesLoading}
            >
              <RefreshCw size={16} className={saving || casesLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          {(nextStep?.blockedReason || onboarding?.blockedReason) && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {nextStep?.blockedReason || onboarding?.blockedReason}
            </div>
          )}

          {message && (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              {message}
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            {hasAction('START_CDD') && (
              <button
                onClick={() => startCdd()}
                disabled={saving}
                className={`${buttonClass} bg-indigo-600 text-white hover:bg-indigo-700`}
              >
                <ShieldCheck size={16} />
                Start CDD
              </button>
            )}

            {hasAction('REINITIATE_CDD') && (
              <button
                onClick={() => reinitiateCdd()}
                disabled={saving}
                className={`${buttonClass} bg-red-600 text-white hover:bg-red-700`}
              >
                <AlertCircle size={16} />
                Re-initiate CDD
              </button>
            )}

            {hasAction('COMPLETE_EDD') && (
              <>
                <button
                  onClick={() => startEdd()}
                  disabled={saving}
                  className={`${buttonClass} bg-purple-600 text-white hover:bg-purple-700`}
                >
                  <QrCode size={16} />
                  Start EDD Session
                </button>
                <button
                  onClick={() => reinitiateEdd()}
                  disabled={saving}
                  className={`${buttonClass} border border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100`}
                >
                  Re-initiate EDD
                </button>
              </>
            )}

            {(hasAction('WAIT_REVIEW') || hasAction('WAIT_FINAL_APPROVAL')) && (
              <div className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm text-slate-700">
                <Clock3 size={16} />
                Waiting for compliance handling
              </div>
            )}
          </div>
        </div>

        {activeCase && (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Active Case</h2>
                <p className="text-sm text-slate-500">
                  {activeCase.caseType} / {activeCase.caseNo} / {activeCase.status}
                </p>
              </div>
              <button
                onClick={() => createSession(activeCase)}
                disabled={saving || activeCase.status !== 'CREATED'}
                className={`${buttonClass} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
              >
                <QrCode size={16} />
                Create Session
              </button>
            </div>

            {activeCase.latestSession?.qrCodeUrl ? (
              <div className="mt-5 grid gap-6 md:grid-cols-[220px_1fr]">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <QRCodeSVG
                    value={activeCase.latestSession.qrCodeUrl}
                    size={180}
                    bgColor="#f8fafc"
                    fgColor="#0f172a"
                  />
                </div>
                <div className="space-y-3 text-sm text-slate-600">
                  <div>
                    Session: <span className="font-mono text-slate-800">{activeCase.latestSession.providerSessionId}</span>
                  </div>
                  <div>
                    Status: <span className="font-semibold text-slate-800">{activeCase.latestSession.status}</span>
                  </div>
                  <div>
                    Expires At: <span className="text-slate-800">{new Date(activeCase.latestSession.expiresAt).toLocaleString()}</span>
                  </div>
                  <button
                    onClick={() => mockComplete(activeCase.latestSession!.sessionId)}
                    disabled={saving || activeCase.latestSession.status !== 'PENDING'}
                    className={`${buttonClass} bg-green-600 text-white hover:bg-green-700`}
                  >
                    Mock Complete
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                No active session. Create one to continue verification.
              </div>
            )}
          </motion.section>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Case History</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-3">Case</th>
                  <th className="py-3">Type</th>
                  <th className="py-3">Status</th>
                  <th className="py-3">Session</th>
                  <th className="py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {casesLoading ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-500">
                      Loading cases...
                    </td>
                  </tr>
                ) : cases.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-500">
                      No cases yet.
                    </td>
                  </tr>
                ) : (
                  cases.map((item) => (
                    <tr key={item.id} className="border-b border-slate-100">
                      <td className="py-3 font-medium text-slate-900">{item.caseNo}</td>
                      <td className="py-3 text-slate-700">{item.caseType}</td>
                      <td className="py-3 text-slate-700">{item.status}</td>
                      <td className="py-3 text-slate-600">
                        {item.latestSession
                          ? `${item.latestSession.status} (${item.latestSession.providerSessionId})`
                          : 'No session'}
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => createSession(item)}
                            disabled={saving || item.status !== 'CREATED'}
                            className={`${buttonClass} border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50`}
                          >
                            Create
                          </button>
                          {item.latestSession?.status === 'PENDING' && (
                            <button
                              onClick={() => mockComplete(item.latestSession!.sessionId)}
                              disabled={saving}
                              className={`${buttonClass} bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700`}
                            >
                              Mock Complete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};

export default Verification;
