import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock3, QrCode, ShieldCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { useCustomerProfile } from '../hooks/useCustomerProfile';

interface UboItem {
  id: string;
  fullName: string;
  ownershipPercent?: number | null;
  nationality?: string | null;
  pepFlag?: boolean;
  status?: string;
}

interface OnboardingSnapshot {
  id: string;
  customerType: 'INDIVIDUAL' | 'CORPORATE' | 'UNKNOWN';
  companyName?: string | null;
  cddStatus: string;
  amlRiskTier: string;
  eddRequired: boolean;
  eddStatus: string;
  complianceStatus: string;
  cddDocumentExpiresAt?: string | null;
  finalApprovalStatus?: string;
  currentCddCaseId?: string | null;
  currentEddCaseId?: string | null;
  investorClassification?: string | null;
  corporateProfile?: {
    companyName?: string;
    registrationNo?: string;
    incorporationCountry?: string;
  } | null;
  uboProfiles?: UboItem[];
}

interface NextStepPayload {
  step: 'ENTITY_INFO' | 'CDD' | 'WAIT_REVIEW' | 'EDD' | 'REINITIATE' | 'COMPLETED';
  action:
    | 'SAVE_ENTITY'
    | 'START_CDD'
    | 'COMPLETE_CDD'
    | 'COMPLETE_EDD'
    | 'WAIT'
    | 'REINITIATE_CDD'
    | 'REINITIATE_EDD'
    | 'NONE';
  blockedReason: string | null;
  activeCaseId: string | null;
  requiresEdd: boolean;
}

interface CaseSession {
  id: string;
  status: string;
  qrCodeUrl: string;
  providerSessionId: string;
  expiresAt: string;
}

interface CaseItem {
  id: string;
  caseNo: string;
  caseType: 'CDD' | 'EDD';
  status: string;
  subjectKind: string;
  subjectRefId: string;
  latestSession?: CaseSession | null;
}

type IntroStage = 'INTRO' | 'GUIDE' | 'FLOW';

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const stepGuides = [
  {
    title: 'Step 1',
    text: 'Provide your basic profile details.',
  },
  {
    title: 'Step 2',
    text: 'Complete face verification.',
  },
  {
    title: 'Step 3',
    text: 'Verify your residential address.',
  },
  {
    title: 'Step 4',
    text: 'Pass background and screening checks.',
  },
  {
    title: 'Step 5',
    text: 'Additional EDD may be required based on risk signals.',
  },
];

const primaryButtonClass =
  'mx-auto flex w-full max-w-md items-center justify-center rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 px-7 py-4 text-base font-semibold text-white shadow-[0_8px_18px_rgba(37,99,235,0.22)] transition-colors hover:from-blue-600 hover:to-blue-600 disabled:opacity-60';

const cardClass =
  'rounded-3xl border border-slate-200/70 bg-white px-10 py-10 shadow-[0_8px_24px_rgba(15,23,42,0.06)]';

const statCardClass = 'rounded-2xl border border-slate-200 bg-slate-50/80 px-5 py-4';

const statLabelClass = 'text-sm font-semibold uppercase tracking-wide text-blue-700';

const Verification = () => {
  const { profile, loading, error, refreshProfile } = useCustomerProfile();
  const navigate = useNavigate();

  const [onboarding, setOnboarding] = useState<OnboardingSnapshot | null>(null);
  const [nextStep, setNextStep] = useState<NextStepPayload | null>(null);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [introStage, setIntroStage] = useState<IntroStage>('INTRO');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [casesLoading, setCasesLoading] = useState(false);
  const [autoStartedEddCaseId, setAutoStartedEddCaseId] = useState<string | null>(null);

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
    if (!response.ok) throw new Error('Failed to load onboarding profile');
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

  const runAction = async (action: () => Promise<Response>, successMessage: string) => {
    setSaving(true);
    setMessage('');
    try {
      const response = await action();
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

  const bootstrapCdd = async () =>
    runAction(
      () =>
        withAuth(`${import.meta.env.VITE_API_URL}/onboarding/cdd-cases/bootstrap`, {
          method: 'POST',
          body: JSON.stringify({}),
        }),
      'CDD case and QR session are ready.',
    );

  const reinitiateCdd = async () =>
    runAction(
      () =>
        withAuth(`${import.meta.env.VITE_API_URL}/onboarding/cdd-cases/reinitiate`, {
          method: 'POST',
          body: JSON.stringify({}),
        }),
      'A new CDD case and QR session have been created.',
    );

  const reinitiateEdd = async () =>
    runAction(
      () =>
        withAuth(`${import.meta.env.VITE_API_URL}/onboarding/edd-cases/reinitiate`, {
          method: 'POST',
          body: JSON.stringify({}),
        }),
      'A new EDD case and QR session have been created.',
    );

  const startEdd = async () =>
    runAction(
      () =>
        withAuth(`${import.meta.env.VITE_API_URL}/onboarding/edd-cases/start`, {
          method: 'POST',
          body: JSON.stringify({}),
        }),
      'EDD QR session is ready.',
    );

  const createSession = async (item: CaseItem) =>
    runAction(
      () =>
        withAuth(`${import.meta.env.VITE_API_URL}/onboarding/cases/${item.id}/sessions`, {
          method: 'POST',
          body: JSON.stringify({ caseType: item.caseType, provider: 'MOCK' }),
        }),
      `${item.caseType} QR session regenerated.`,
    );

  const mockComplete = async (sessionId: string) =>
    runAction(
      () =>
        withAuth(`${import.meta.env.VITE_API_URL}/onboarding/sessions/${sessionId}/mock-complete`, {
          method: 'POST',
          body: JSON.stringify({ result: 'PASS' }),
        }),
      'Mock completion submitted. Your case is now in review.',
    );

  const complianceStatus = onboarding?.complianceStatus || profile?.complianceStatus || 'NONE';
  const approved = complianceStatus === 'ACTIVE';
  const pendingFinalApproval =
    (onboarding?.finalApprovalStatus || profile?.finalApprovalStatus) === 'PENDING';
  const showIntroFlow =
    nextStep?.step === 'CDD' && nextStep.action === 'START_CDD' && introStage !== 'FLOW';

  const currentCaseType: 'CDD' | 'EDD' = nextStep?.step === 'EDD' ? 'EDD' : 'CDD';
  const currentCaseCandidates = useMemo(
    () => cases.filter((item) => item.caseType === currentCaseType),
    [cases, currentCaseType],
  );

  const activeCase =
    currentCaseCandidates.find((item) => item.id === nextStep?.activeCaseId) ||
    currentCaseCandidates.find((item) => ['PENDING', 'SUBMITTED'].includes(item.status)) ||
    currentCaseCandidates[0] ||
    null;

  useEffect(() => {
    if (nextStep?.step === 'CDD' && nextStep.action === 'START_CDD') {
      setIntroStage((prev) => (prev === 'FLOW' ? 'INTRO' : prev));
      return;
    }
    setIntroStage('FLOW');
  }, [nextStep?.step, nextStep?.action]);

  useEffect(() => {
    if (!approved) return;
    navigate('/profile', { replace: true });
  }, [approved, navigate]);

  useEffect(() => {
    if (nextStep?.step !== 'EDD') {
      setAutoStartedEddCaseId(null);
      return;
    }
    if (!activeCase || activeCase.caseType !== 'EDD') return;
    if (autoStartedEddCaseId === activeCase.id) return;

    const hasUsableSession =
      !!activeCase.latestSession?.qrCodeUrl &&
      activeCase.latestSession.status !== 'FAILED' &&
      new Date(activeCase.latestSession.expiresAt).getTime() > Date.now();
    if (hasUsableSession) return;

    setAutoStartedEddCaseId(activeCase.id);
    startEdd().catch(() => undefined);
  }, [
    nextStep?.step,
    activeCase?.id,
    activeCase?.latestSession?.status,
    activeCase?.latestSession?.expiresAt,
    autoStartedEddCaseId,
  ]);

  if (loading) return <div className="p-10 text-center text-slate-500">Loading onboarding status...</div>;
  if (error) return <div className="p-10 text-center text-red-500">{error}</div>;
  if (!profile) return null;
  if (approved) return null;

  const isCorporate = onboarding?.customerType === 'CORPORATE' || profile.customerType === 'CORPORATE';
  const reviewCardContent = pendingFinalApproval
    ? {
        title: 'Waiting for Final Approval',
        description: 'EDD has been approved and is now waiting for final management confirmation.',
      }
    : nextStep?.requiresEdd
      ? {
          title: 'Pending Review',
          description: 'Your EDD submission is under compliance review.',
        }
      : {
          title: 'Pending Review',
          description: 'Your CDD submission is under compliance review.',
        };

  return (
    <div className="min-h-[calc(100vh-140px)] bg-slate-50/50">
      <div className="mx-auto max-w-4xl space-y-8 px-8 py-14 lg:px-10 lg:py-16">
        {message && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.14 }}
            className="rounded-3xl border border-blue-200/80 bg-blue-50/80 px-6 py-4 text-sm leading-6 text-blue-700"
          >
            {message}
          </motion.div>
        )}

        {isCorporate && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16 }}
            className="rounded-3xl border border-amber-200/80 bg-amber-50/70 px-10 py-10 shadow-[0_8px_24px_rgba(15,23,42,0.05)]"
          >
            <h2 className="text-2xl font-bold text-amber-900">Corporate onboarding via support</h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-amber-800">
              Corporate self-service onboarding is temporarily unavailable on client web. Please contact
              compliance support to continue the KYB and UBO onboarding process.
            </p>
          </motion.section>
        )}

        {!isCorporate && showIntroFlow && introStage === 'INTRO' && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16 }}
            className={cardClass}
          >
            <div className="mx-auto max-w-2xl text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <ShieldCheck size={20} />
              </div>
              <h2 className="mt-6 text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">
                You are about to start KYC verification
              </h2>
              <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600">
                This process validates your identity, address, and risk profile before full trading
                access is enabled for your account.
              </p>
              <div className="mt-10 space-y-4 text-left">
                <div className={statCardClass}>
                  <div className={statLabelClass}>Estimated time</div>
                  <div className="mt-2 text-2xl font-semibold text-slate-800">3-5 minutes</div>
                </div>
                <div className={statCardClass}>
                  <div className={statLabelClass}>Requirement</div>
                  <div className="mt-2 text-2xl font-semibold text-slate-800">Valid identification</div>
                </div>
                <div className={statCardClass}>
                  <div className={statLabelClass}>Result</div>
                  <div className="mt-2 text-2xl font-semibold text-slate-800">Compliance review queue</div>
                </div>
              </div>
              <button
                onClick={() => setIntroStage('GUIDE')}
                disabled={saving}
                className={`${primaryButtonClass} mt-10`}
              >
                Continue
              </button>
            </div>
          </motion.section>
        )}

        {!isCorporate && showIntroFlow && introStage === 'GUIDE' && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16 }}
            className={cardClass}
          >
            <div className="mx-auto max-w-2xl">
              <h2 className="text-4xl font-black tracking-tight text-slate-900 text-center">Verification steps</h2>
              <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-slate-600 text-center">
                Follow the five-step path below. After submission, your case enters review automatically.
              </p>
              <div className="mt-8 space-y-4">
                {stepGuides.map((item, index) => (
                  <div
                    key={item.title}
                    className="flex items-start gap-4 rounded-2xl border border-slate-200 bg-slate-50/80 px-5 py-4"
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-semibold text-blue-700">
                      {index + 1}
                    </div>
                    <div className="text-base leading-7 text-slate-700">{item.text}</div>
                  </div>
                ))}
              </div>
              <button
                onClick={async () => {
                  const ok = await bootstrapCdd();
                  if (ok) setIntroStage('FLOW');
                }}
                disabled={saving}
                className={`${primaryButtonClass} mt-10`}
              >
                Start Verification
              </button>
            </div>
          </motion.section>
        )}

        {!isCorporate && nextStep?.step === 'CDD' && !showIntroFlow && (
          <JourneyCasePanel
            title="CDD"
            subtitle="Scan the QR code and complete your CDD verification session."
            item={activeCase}
            loading={casesLoading}
            saving={saving}
            onCreateSession={createSession}
            onMockComplete={mockComplete}
            onStart={bootstrapCdd}
          />
        )}

        {!isCorporate && nextStep?.step === 'EDD' && (
          <section className="space-y-6">
            <div className="rounded-3xl border border-violet-200/80 bg-violet-50/70 px-8 py-5 text-sm leading-7 text-violet-900">
              Additional Enhanced Due Diligence (EDD) is required for this onboarding journey.
            </div>
            <JourneyCasePanel
              title="EDD"
              subtitle="Scan the QR code and complete your EDD verification session."
              item={activeCase}
              loading={casesLoading}
              saving={saving}
              onCreateSession={createSession}
              onMockComplete={mockComplete}
              onStart={startEdd}
            />
          </section>
        )}

        {!isCorporate && nextStep?.step === 'WAIT_REVIEW' && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16 }}
            className={cardClass}
          >
            <h2 className="flex items-center justify-center gap-2 text-center text-3xl font-black tracking-tight text-slate-900">
              <Clock3 size={22} className="text-blue-600" />
              {reviewCardContent.title}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-base leading-7 text-slate-600">
              {reviewCardContent.description}
            </p>
            <CaseSummaryList items={cases} caseType={nextStep.requiresEdd ? 'EDD' : 'CDD'} />
          </motion.section>
        )}

        {!isCorporate && nextStep?.step === 'REINITIATE' && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16 }}
            className="rounded-3xl border border-red-200/80 bg-red-50/60 px-10 py-10 shadow-[0_8px_24px_rgba(15,23,42,0.05)]"
          >
            <h2 className="text-center text-4xl font-black tracking-tight text-red-900">
              Verification Rejected
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-center text-base leading-7 text-red-700">
              {nextStep.blockedReason || 'Please re-initiate verification to continue onboarding.'}
            </p>
            <button
              onClick={() =>
                nextStep.action === 'REINITIATE_EDD'
                  ? reinitiateEdd().catch(() => undefined)
                  : reinitiateCdd().catch(() => undefined)
              }
              disabled={saving}
              className={`${primaryButtonClass} mt-10`}
            >
              {nextStep.action === 'REINITIATE_EDD' ? 'Re-initiate EDD' : 'Re-initiate CDD'}
            </button>
          </motion.section>
        )}

        {!isCorporate && nextStep?.step === 'ENTITY_INFO' && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16 }}
            className="rounded-3xl border border-amber-200/80 bg-amber-50/70 px-10 py-10 shadow-[0_8px_24px_rgba(15,23,42,0.05)]"
          >
            <h2 className="text-2xl font-bold text-amber-900">Manual setup required</h2>
            <p className="mt-4 text-sm leading-7 text-amber-800">
              Your onboarding setup requires support assistance before CDD can start. Please contact support.
            </p>
          </motion.section>
        )}
      </div>
    </div>
  );
};

const JourneyCasePanel = ({
  title,
  subtitle,
  item,
  loading,
  saving,
  onCreateSession,
  onMockComplete,
  onStart,
}: {
  title: 'CDD' | 'EDD';
  subtitle: string;
  item: CaseItem | null;
  loading: boolean;
  saving: boolean;
  onCreateSession: (item: CaseItem) => Promise<boolean>;
  onMockComplete: (sessionId: string) => Promise<boolean>;
  onStart: () => Promise<boolean>;
}) => {
  if (loading) {
    return (
      <section className={cardClass + ' text-center text-sm text-slate-500'}>
        Loading {title} case...
      </section>
    );
  }

  if (!item) {
    return (
      <section className={cardClass}>
        <h2 className="text-center text-3xl font-black tracking-tight text-slate-900">{title} Verification</h2>
        <p className="mx-auto mt-5 max-w-2xl text-center text-base leading-7 text-slate-600">
          No active {title} case is available yet. Start now to generate your verification session.
        </p>
        <button
          onClick={() => onStart().catch(() => undefined)}
          disabled={saving}
          className={`${primaryButtonClass} mt-10`}
        >
          Start {title}
        </button>
      </section>
    );
  }

  const hasUsableSession =
    !!item.latestSession?.qrCodeUrl &&
    item.latestSession.status !== 'FAILED' &&
    new Date(item.latestSession.expiresAt).getTime() > Date.now();

  return (
    <section className={cardClass}>
      <h2 className="text-center text-4xl font-black tracking-tight text-slate-900">{title} Verification</h2>
      <p className="mx-auto mt-5 max-w-2xl text-center text-base leading-7 text-slate-600">{subtitle}</p>

      <div className="mt-8 rounded-3xl border border-slate-200 bg-slate-50/75 p-7">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold tracking-wide text-slate-900">{item.caseNo}</div>
            <div className="text-xs text-slate-500">Status: {item.status}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600">
            <QrCode size={20} />
          </div>
        </div>

        {item.latestSession?.qrCodeUrl ? (
          <div className="mt-8 grid grid-cols-1 items-center justify-items-center gap-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_6px_20px_rgba(15,23,42,0.08)]">
              <QRCodeSVG value={item.latestSession.qrCodeUrl} size={192} />
            </div>
            <div className="space-y-1 text-center text-xs leading-6 text-slate-600">
              <div>Session ID: {item.latestSession.providerSessionId}</div>
              <div>Session Status: {item.latestSession.status}</div>
              <div>Expires At: {new Date(item.latestSession.expiresAt).toLocaleString()}</div>
            </div>
          </div>
        ) : (
          <div className="mt-6 text-center text-sm leading-7 text-slate-500">
            No QR session yet. Generate one to continue.
          </div>
        )}

        <div className="mt-8 flex flex-col items-center gap-4">
          {!hasUsableSession && (
            <button
              onClick={() => onCreateSession(item).catch(() => undefined)}
              disabled={saving}
              className="mx-auto flex w-full max-w-md items-center justify-center rounded-2xl border border-slate-300 bg-white px-7 py-4 text-base font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60"
            >
              {item.latestSession ? 'Regenerate QR' : 'Generate QR'}
            </button>
          )}
          {item.latestSession?.status === 'PENDING' && (
            <button
              onClick={() => onMockComplete(item.latestSession!.id).catch(() => undefined)}
              disabled={saving}
              className={primaryButtonClass}
            >
              Mock Complete
            </button>
          )}
        </div>
      </div>
    </section>
  );
};

const CaseSummaryList = ({
  items,
  caseType,
}: {
  items: CaseItem[];
  caseType: 'CDD' | 'EDD';
}) => {
  const filtered = items.filter((item) => item.caseType === caseType).slice(0, 5);
  if (filtered.length === 0) {
    return <div className="mt-5 text-center text-sm leading-7 text-slate-500">No {caseType} cases found.</div>;
  }

  return (
    <div className="mt-7 space-y-3">
      {filtered.map((item) => (
        <div
          key={item.id}
          className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm"
        >
          <span className="font-semibold text-slate-800">{item.caseNo}</span>
          <span className="text-slate-500">{item.status}</span>
        </div>
      ))}
    </div>
  );
};

export default Verification;
