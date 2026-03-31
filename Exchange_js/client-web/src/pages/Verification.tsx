import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronRight,
  Clock3,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { useCustomerProfile } from '../hooks/useCustomerProfile';
import {
  normalizeCanonicalOnboardingStatus,
  normalizeCanonicalOperatingStatus,
} from '../utils/customerOnboarding';
import { useSimulationMode } from '../utils/simulationMode';
import { customerFetch } from '../utils/customerFetch';

interface UboItem {
  id: string;
  fullName: string;
  ownershipPercent?: number | null;
  nationality?: string | null;
  pepFlag?: boolean;
  status?: string;
}

interface OnboardingAction {
  type: string;
  payload?: Record<string, unknown>;
}

interface OnboardingSnapshot {
  id: string;
  customerType: 'INDIVIDUAL' | 'CORPORATE' | 'UNKNOWN';
  companyName?: string | null;
  onboardingStatus?: string;
  operatingStatus?: string;
  restrictionStatus?: string;
  actions?: OnboardingAction[];
  blockedReason?: string | null;
  amlRiskTier: string;
  eddRequired: boolean;
  cddDocumentExpiresAt?: string | null;
  investorClassification?: string | null;
  corporateProfile?: {
    companyName?: string;
    registrationNo?: string;
    incorporationCountry?: string;
  } | null;
  uboProfiles?: UboItem[];
}

interface PeriodicReviewSnapshot {
  activePeriodicReviewCycleId?: string | null;
  periodicReviewOverdueAt?: string | null;
  periodicReviewOverdueReason?: string | null;
  nextReviewAt?: string | null;
  restrictionStatus?: string;
  complianceHoldStatus?: string;
  cycle?: {
    id: string;
    cycleNo: string;
    status: string;
    dueAt: string;
    triggeredAt?: string | null;
    clearedAt?: string | null;
    rejectedAt?: string | null;
    currentCddResponseId?: string | null;
    currentEddResponseId?: string | null;
    primaryAlertId?: string | null;
    primaryIncidentId?: string | null;
    resolutionReason?: string | null;
  } | null;
  status?: string | null;
  actions?: OnboardingAction[];
  blockedReason?: string | null;
  activeCaseId?: string | null;
  requiresEdd?: boolean;
}

interface NextStepPayload {
  actions: OnboardingAction[];
  blockedReason: string | null;
  activeCaseId: string | null;
  requiresEdd: boolean;
}

interface PeriodicReviewNextStepPayload {
  status: string | null;
  actions: OnboardingAction[];
  blockedReason: string | null;
  activeCaseId: string | null;
  requiresEdd: boolean;
}

interface ResponseSession {
  id?: string;
  sessionId?: string;
  responseType?: 'CDD' | 'EDD';
  status: string;
  qrCodeUrl: string;
  providerSessionId: string;
  expiresAt: string;
}

interface ResponseItem {
  id: string;
  responseNo: string;
  responseType: 'CDD' | 'EDD';
  status: string;
  subjectKind: string;
  subjectRefId?: string;
  latestSession?: ResponseSession | null;
}

type IntroStage = 'INTRO' | 'GUIDE' | 'FLOW';
type VerificationStep = 'ENTITY_INFO' | 'CDD' | 'WAIT_REVIEW' | 'EDD' | 'REINITIATE' | 'COMPLETED';
type VerificationAction =
  | 'SAVE_ENTITY'
  | 'START_CDD'
  | 'COMPLETE_CDD'
  | 'COMPLETE_EDD'
  | 'WAIT'
  | 'REINITIATE_CDD'
  | 'REINITIATE_EDD'
  | 'NONE';

interface VerificationStepState {
  step: VerificationStep;
  action: VerificationAction;
  blockedReason: string | null;
  activeCaseId: string | null;
  requiresEdd: boolean;
  actions: OnboardingAction[];
}

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const resolveSessionId = (session?: ResponseSession | null): string | null => {
  if (!session) return null;
  const value = String(session.sessionId || session.id || '').trim();
  return value || null;
};

const mapOnboardingToStep = (
  nextStep: NextStepPayload | null,
  onboarding: OnboardingSnapshot | null,
  profile: {
    onboardingStatus?: string;
    operatingStatus?: string;
    actions?: OnboardingAction[];
    eddRequired?: boolean;
  } | null,
): VerificationStepState => {
  const onboardingStatus = normalizeCanonicalOnboardingStatus(
    onboarding?.onboardingStatus ?? profile?.onboardingStatus,
  );
  const operatingStatus = normalizeCanonicalOperatingStatus(
    onboarding?.operatingStatus ?? profile?.operatingStatus,
  );
  const actions =
    nextStep?.actions || onboarding?.actions || profile?.actions || [];
  const blockedReason = nextStep?.blockedReason || onboarding?.blockedReason || null;
  const requiresEdd =
    nextStep?.requiresEdd ?? onboarding?.eddRequired ?? profile?.eddRequired ?? false;
  const hasAction = (actionType: string) =>
    actions.some((item) => String(item?.type || '').toUpperCase() === actionType);
  const activeCaseId =
    nextStep?.activeCaseId || null;

  if (onboardingStatus === 'APPROVED' && operatingStatus === 'ACTIVE') {
    return {
      step: 'COMPLETED',
      action: 'NONE',
      blockedReason,
      activeCaseId,
      requiresEdd,
      actions,
    };
  }

  if (
    onboardingStatus === 'REJECTED' ||
    onboardingStatus === 'WITHDRAWN' ||
    hasAction('REINITIATE_CDD')
  ) {
    return {
      step: 'REINITIATE',
      action: hasAction('REINITIATE_EDD') ? 'REINITIATE_EDD' : 'REINITIATE_CDD',
      blockedReason,
      activeCaseId,
      requiresEdd,
      actions,
    };
  }

  if (onboardingStatus === 'FINAL_APPROVAL' || hasAction('WAIT_FINAL_APPROVAL')) {
    return {
      step: 'WAIT_REVIEW',
      action: 'WAIT',
      blockedReason,
      activeCaseId,
      requiresEdd: true,
      actions,
    };
  }

  if (
    onboardingStatus === 'CDD_UNDER_REVIEW' ||
    onboardingStatus === 'EDD_UNDER_REVIEW' ||
    hasAction('WAIT_REVIEW')
  ) {
    return {
      step: 'WAIT_REVIEW',
      action: 'WAIT',
      blockedReason,
      activeCaseId,
      requiresEdd: onboardingStatus === 'EDD_UNDER_REVIEW' || requiresEdd,
      actions,
    };
  }

  if (onboardingStatus === 'PENDING_EDD_INPUT' || hasAction('COMPLETE_EDD')) {
    return {
      step: 'EDD',
      action: 'COMPLETE_EDD',
      blockedReason,
      activeCaseId,
      requiresEdd: true,
      actions,
    };
  }

  if (onboardingStatus === 'PENDING_CDD_INPUT' || hasAction('COMPLETE_CDD')) {
    return {
      step: 'CDD',
      action: hasAction('START_CDD') && !activeCaseId ? 'START_CDD' : 'COMPLETE_CDD',
      blockedReason,
      activeCaseId,
      requiresEdd,
      actions,
    };
  }

  if (onboardingStatus === 'NONE' || hasAction('START_CDD')) {
    return {
      step: 'CDD',
      action: 'START_CDD',
      blockedReason,
      activeCaseId,
      requiresEdd,
      actions,
    };
  }

  return {
    step: 'ENTITY_INFO',
    action: 'SAVE_ENTITY',
    blockedReason,
    activeCaseId,
    requiresEdd,
    actions,
  };
};

const mapPeriodicReviewNextStepToLegacy = (
  nextStep: PeriodicReviewNextStepPayload | null,
  periodicReview: PeriodicReviewSnapshot | null,
): VerificationStepState => {
  const status = String(nextStep?.status || periodicReview?.status || '').trim().toUpperCase();
  const actions = nextStep?.actions || periodicReview?.actions || [];
  const blockedReason = nextStep?.blockedReason || periodicReview?.blockedReason || null;
  const activeCaseId =
    nextStep?.activeCaseId ||
    periodicReview?.activeCaseId ||
    periodicReview?.cycle?.currentEddResponseId ||
    periodicReview?.cycle?.currentCddResponseId ||
    null;
  const requiresEdd =
    nextStep?.requiresEdd ??
    periodicReview?.requiresEdd ??
    ['PENDING_EDD_INPUT', 'EDD_UNDER_REVIEW'].includes(status);

  const hasAction = (actionType: string) =>
    actions.some((item) => String(item?.type || '').toUpperCase() === actionType);

  if (status === 'REJECTED') {
    return {
      step: 'WAIT_REVIEW',
      action: 'WAIT',
      blockedReason: blockedReason || 'Periodic review rejected.',
      activeCaseId,
      requiresEdd,
      actions,
    };
  }

  if (status === 'CDD_UNDER_REVIEW') {
    return {
      step: 'WAIT_REVIEW',
      action: 'WAIT',
      blockedReason: blockedReason,
      activeCaseId,
      requiresEdd: false,
      actions,
    };
  }

  if (status === 'EDD_UNDER_REVIEW') {
    return {
      step: 'WAIT_REVIEW',
      action: 'WAIT',
      blockedReason: blockedReason,
      activeCaseId,
      requiresEdd: true,
      actions,
    };
  }

  if (status === 'PENDING_EDD_INPUT' || hasAction('COMPLETE_EDD')) {
    return {
      step: 'EDD',
      action: 'COMPLETE_EDD',
      blockedReason,
      activeCaseId,
      requiresEdd: true,
      actions,
    };
  }

  return {
    step: 'CDD',
    action: hasAction('START_CDD') ? 'START_CDD' : 'COMPLETE_CDD',
    blockedReason,
    activeCaseId,
    requiresEdd: false,
    actions,
  };
};

const stepGuides = [
  {
    title: 'Basic Profile',
    text: 'Provide your basic details.',
  },
  {
    title: 'Face Verification',
    text: 'Complete liveness check.',
  },
  {
    title: 'Address Check',
    text: 'Verify your residential address.',
  },
  {
    title: 'Screening',
    text: 'Pass background checks.',
  },
  {
    title: 'Review',
    text: 'Compliance team review.',
  },
];

const primaryButtonClass =
  'relative overflow-hidden group w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition-all hover:shadow-indigo-500/50 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed disabled:shadow-none';

const secondaryButtonClass =
  'w-full flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-6 py-3.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-50 hover:border-slate-300 active:bg-slate-100 disabled:opacity-60';

const cardClass =
  'relative w-full overflow-hidden rounded-[2rem] border border-white/60 bg-white/80 px-12 py-16 shadow-[0_20px_40px_-12px_rgba(0,0,0,0.1)] backdrop-blur-xl';

const SimulationModeNotice = ({ message }: { message: string }) => (
  <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-800">
    {message}
  </div>
);

const Verification = () => {
  const { profile, loading, error, refreshProfile } = useCustomerProfile();
  const navigate = useNavigate();
  const { enabled: simulationModeEnabled } = useSimulationMode();

  const [onboarding, setOnboarding] = useState<OnboardingSnapshot | null>(null);
  const [periodicReview, setPeriodicReview] = useState<PeriodicReviewSnapshot | null>(null);
  const [nextStep, setNextStep] = useState<NextStepPayload | null>(null);
  const [periodicNextStep, setPeriodicNextStep] =
    useState<PeriodicReviewNextStepPayload | null>(null);
  const [responses, setResponses] = useState<ResponseItem[]>([]);
  const [introStage, setIntroStage] = useState<IntroStage>('INTRO');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [casesLoading, setCasesLoading] = useState(false);

  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = `
      @keyframes scan {
        0% { transform: translateY(0); opacity: 0; }
        15% { opacity: 1; }
        85% { opacity: 1; }
        100% { transform: translateY(200px); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  const verificationMode =
    profile?.activePeriodicReviewCycleId || profile?.periodicReviewOverdueAt
      ? 'PERIODIC_REVIEW'
      : 'ONBOARDING';

  const withAuth = async (url: string, init?: RequestInit) => customerFetch(url, init);

  const loadOnboarding = async () => {
    const response = await withAuth(`${import.meta.env.VITE_API_URL}/onboarding/me`);
    if (!response.ok) throw new Error('Failed to load onboarding profile');
    setOnboarding((await response.json()) as OnboardingSnapshot);
  };

  const loadPeriodicReview = async () => {
    const response = await withAuth(`${import.meta.env.VITE_API_URL}/periodic-review/me`);
    if (!response.ok) throw new Error('Failed to load periodic review profile');
    setPeriodicReview((await response.json()) as PeriodicReviewSnapshot);
  };

  const loadNextStep = async () => {
    if (verificationMode === 'PERIODIC_REVIEW') {
      const response = await withAuth(
        `${import.meta.env.VITE_API_URL}/periodic-review/next-step`,
      );
      if (!response.ok) throw new Error('Failed to load periodic review next step');
      const data = (await response.json()) as PeriodicReviewNextStepPayload;
      setPeriodicNextStep({
        ...data,
        actions: Array.isArray(data.actions) ? data.actions : [],
        blockedReason: data.blockedReason || null,
        activeCaseId: data.activeCaseId || null,
        requiresEdd: !!data.requiresEdd,
      });
      setNextStep(null);
      return;
    }

    const response = await withAuth(`${import.meta.env.VITE_API_URL}/onboarding/next-step`);
    if (!response.ok) throw new Error('Failed to load next step');
    const data = (await response.json()) as NextStepPayload;
    setNextStep({
      ...data,
      actions: Array.isArray(data.actions) ? data.actions : [],
      blockedReason: data.blockedReason || null,
      activeCaseId: data.activeCaseId || null,
      requiresEdd: !!data.requiresEdd,
    });
    setPeriodicNextStep(null);
  };

  const loadResponses = async () => {
    setCasesLoading(true);
    try {
      const response = await withAuth(
        `${import.meta.env.VITE_API_URL}/${
          verificationMode === 'PERIODIC_REVIEW' ? 'periodic-review' : 'onboarding'
        }/responses`,
      );
      if (!response.ok) {
        throw new Error(
          verificationMode === 'PERIODIC_REVIEW'
            ? 'Failed to load periodic review responses'
            : 'Failed to load onboarding responses',
        );
      }
      const data = await response.json();
      const normalized = (Array.isArray(data.items) ? data.items : []).map((item: any) => {
        const latestSession = item.latestSession
          ? {
              id: item.latestSession.id,
              sessionId: item.latestSession.sessionId || item.latestSession.id,
              responseType: item.latestSession.responseType || item.responseType,
              status: item.latestSession.status,
              qrCodeUrl: item.latestSession.qrCodeUrl,
              providerSessionId: item.latestSession.providerSessionId,
              expiresAt: item.latestSession.expiresAt,
            }
          : null;

        return {
          ...item,
          responseNo: item.responseNo,
          responseType: item.responseType,
          latestSession,
        } as ResponseItem;
      });

      setResponses(normalized);
    } finally {
      setCasesLoading(false);
    }
  };

  const refreshAll = async () => {
    try {
      await Promise.all([
        verificationMode === 'PERIODIC_REVIEW' ? loadPeriodicReview() : loadOnboarding(),
        loadNextStep(),
        loadResponses(),
        refreshProfile(),
      ]);
    } catch (e: unknown) {
      setMessage(
        getErrorMessage(
          e,
          verificationMode === 'PERIODIC_REVIEW'
            ? 'Failed to load periodic review data.'
            : 'Failed to load onboarding data.',
        ),
      );
    }
  };

  useEffect(() => {
    if (profile) {
      refreshAll().catch(() => undefined);
    }
  }, [profile?.id, profile?.activePeriodicReviewCycleId, profile?.periodicReviewOverdueAt]);

  useEffect(() => {
    const hasPending = responses.some((item) => item.latestSession?.status === 'PENDING');
    if (!hasPending) return;
    const timer = window.setInterval(() => {
      Promise.all([loadResponses(), loadNextStep()]).catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [responses]);

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
        withAuth(
          `${import.meta.env.VITE_API_URL}/${
            verificationMode === 'PERIODIC_REVIEW'
              ? 'periodic-review/cdd-responses/start'
              : 'onboarding/cdd-responses/bootstrap'
          }`,
          {
          method: 'POST',
          body: JSON.stringify({}),
          },
        ),
      verificationMode === 'PERIODIC_REVIEW'
        ? 'Periodic review CDD session is ready.'
        : 'CDD response and QR session are ready.',
    );

  const reinitiateCdd = async () =>
    runAction(
      () =>
        withAuth(`${import.meta.env.VITE_API_URL}/onboarding/cdd-responses/reinitiate`, {
          method: 'POST',
          body: JSON.stringify({}),
        }),
      'A new CDD response and QR session have been created.',
    );

  const reinitiateEdd = async () =>
    runAction(
      () =>
        withAuth(`${import.meta.env.VITE_API_URL}/onboarding/edd-responses/reinitiate`, {
          method: 'POST',
          body: JSON.stringify({}),
        }),
      'A new EDD response and QR session have been created.',
    );

  const startEdd = async () =>
    runAction(
      () =>
        withAuth(
          `${import.meta.env.VITE_API_URL}/${
            verificationMode === 'PERIODIC_REVIEW'
              ? 'periodic-review/edd-responses/start'
              : 'onboarding/edd-responses/start'
          }`,
          {
          method: 'POST',
          body: JSON.stringify({}),
          },
        ),
      verificationMode === 'PERIODIC_REVIEW'
        ? 'Periodic review EDD QR session is ready.'
        : 'EDD QR session is ready.',
    );

  const createSession = async (item: ResponseItem) =>
    runAction(
      () =>
        withAuth(
          `${import.meta.env.VITE_API_URL}/${
            verificationMode === 'PERIODIC_REVIEW' ? 'periodic-review' : 'onboarding'
          }/responses/${item.id}/sessions`,
          {
            method: 'POST',
            body: JSON.stringify({ responseType: item.responseType, provider: 'MOCK' }),
          },
        ),
      `${item.responseType} QR session regenerated.`,
    );

  const mockCompleteEdd = async (sessionId: string) =>
    runAction(
      () =>
        withAuth(
          `${import.meta.env.VITE_API_URL}/${
            verificationMode === 'PERIODIC_REVIEW' ? 'periodic-review' : 'onboarding'
          }/response-sessions/${sessionId}/mock-complete`,
          {
            method: 'POST',
            body: JSON.stringify({ result: 'PASS' }),
          },
        ),
      verificationMode === 'PERIODIC_REVIEW'
        ? 'Periodic review EDD mock callback simulated.'
        : 'EDD mock callback simulated.',
    );

  const handleMockComplete = async (session: ResponseSession, responseType: 'CDD' | 'EDD') => {
    const sessionId = resolveSessionId(session);
    if (!sessionId) {
      setMessage('Session id is missing. Please regenerate QR code first.');
      return false;
    }

    if (responseType === 'CDD') {
      return runAction(
        () =>
          withAuth(
            `${import.meta.env.VITE_API_URL}/${
              verificationMode === 'PERIODIC_REVIEW' ? 'periodic-review' : 'onboarding'
            }/response-sessions/${sessionId}/mock-complete`,
            {
              method: 'POST',
              body: JSON.stringify({}),
            },
          ),
        verificationMode === 'PERIODIC_REVIEW'
          ? 'Periodic review CDD mock callback simulated. Continue the manual risk simulation from Admin.'
          : 'CDD mock callback simulated. Continue the manual risk simulation from Admin.',
      );
    }

    return mockCompleteEdd(sessionId);
  };

  const currentStep = useMemo(
    () =>
      verificationMode === 'PERIODIC_REVIEW'
        ? mapPeriodicReviewNextStepToLegacy(periodicNextStep, periodicReview)
        : mapOnboardingToStep(nextStep, onboarding, profile),
    [verificationMode, periodicNextStep, periodicReview, nextStep, onboarding, profile],
  );

  const onboardingStatus = normalizeCanonicalOnboardingStatus(
    onboarding?.onboardingStatus ?? profile?.onboardingStatus,
  );
  const operatingStatus = normalizeCanonicalOperatingStatus(
    onboarding?.operatingStatus ?? profile?.operatingStatus,
  );
  const approved =
    verificationMode === 'ONBOARDING' &&
    onboardingStatus === 'APPROVED' &&
    operatingStatus === 'ACTIVE';
  const pendingFinalApproval =
    verificationMode === 'ONBOARDING' && onboardingStatus === 'FINAL_APPROVAL';
  const showIntroFlow =
    currentStep.step === 'CDD' &&
    currentStep.action === 'START_CDD' &&
    introStage !== 'FLOW';
  const simulationModeNotice =
    verificationMode === 'PERIODIC_REVIEW'
      ? 'Simulation Mode is off. Enable it from admin to run periodic review demo actions on this page.'
      : 'Simulation Mode is off. Enable it from admin to run onboarding demo actions on this page.';

  const currentResponseType: 'CDD' | 'EDD' = currentStep.step === 'EDD' ? 'EDD' : 'CDD';
  const currentResponseCandidates = useMemo(
    () => responses.filter((item) => item.responseType === currentResponseType),
    [responses, currentResponseType],
  );

  const activeResponse =
    currentResponseCandidates.find((item) => item.id === currentStep.activeCaseId) ||
    currentResponseCandidates.find((item) => ['PENDING', 'SUBMITTED'].includes(item.status)) ||
    currentResponseCandidates[0] ||
    null;

  const hasUsableActiveSession =
    !!activeResponse?.latestSession?.qrCodeUrl &&
    activeResponse.latestSession.status !== 'FAILED' &&
    new Date(activeResponse.latestSession.expiresAt).getTime() > Date.now();

  useEffect(() => {
    if (currentStep.step === 'CDD' && currentStep.action === 'START_CDD') {
      setIntroStage((prev) => (prev === 'FLOW' ? 'INTRO' : prev));
      return;
    }
    setIntroStage('FLOW');
  }, [currentStep.step, currentStep.action]);

  useEffect(() => {
    if (!approved) return;
    navigate('/profile', { replace: true });
  }, [approved, navigate]);

  if (loading)
    return <div className="flex h-screen items-center justify-center text-slate-400">Loading...</div>;
  if (error) return <div className="flex h-screen items-center justify-center text-red-500">{error}</div>;
  if (!profile) return null;
  if (approved) return null;

  const isCorporate =
    onboarding?.customerType === 'CORPORATE' || profile.customerType === 'CORPORATE';
  const reviewCardContent = pendingFinalApproval
    ? {
        title: 'Final Approval',
        description: 'EDD has been approved. Waiting for final management confirmation.',
      }
    : currentStep.requiresEdd
      ? {
          title: verificationMode === 'PERIODIC_REVIEW' ? 'Periodic Review' : 'Under Review',
          description:
            verificationMode === 'PERIODIC_REVIEW'
              ? 'Your periodic review EDD submission is under compliance review.'
              : 'Your EDD submission is under compliance review.',
        }
      : {
          title: verificationMode === 'PERIODIC_REVIEW' ? 'Periodic Review' : 'Under Review',
          description:
            verificationMode === 'PERIODIC_REVIEW'
              ? 'Your periodic review CDD submission is under compliance review.'
              : 'Your CDD submission is under compliance review.',
        };

  return (
    <div className="relative min-h-[calc(100vh-80px)] w-full overflow-hidden bg-slate-50 font-['Noto_Sans_SC']">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-[10%] top-[20%] h-[500px] w-[500px] rounded-full bg-blue-100/40 blur-[100px]" />
        <div className="absolute -right-[10%] bottom-[20%] h-[500px] w-[500px] rounded-full bg-violet-100/40 blur-[100px]" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100vh-140px)] max-w-5xl flex-col items-center justify-center px-6 py-12">
        <AnimatePresence mode="wait">
          {message && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute top-4 z-50 w-full max-w-sm rounded-xl border border-blue-100 bg-white/90 px-4 py-3 text-sm font-medium text-blue-700 shadow-lg backdrop-blur-md"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                  <ShieldCheck size={14} />
                </div>
                {message}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {isCorporate && (
          <motion.section
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className={cardClass}
          >
            <div className="flex flex-col items-center text-center">
              <div className="mb-6 rounded-2xl bg-amber-50 p-4 text-amber-600">
                <AlertTriangle size={32} />
              </div>
              <h2 className="text-2xl font-bold text-slate-900">Corporate Verification</h2>
              <p className="mt-4 text-slate-600 leading-relaxed">
                Corporate self-service onboarding is temporarily unavailable. Please contact our
                compliance support team to continue the KYB and UBO onboarding process.
              </p>
              <button
                className={`${secondaryButtonClass} mt-8 border-amber-200 text-amber-700 hover:bg-amber-50`}
              >
                Contact Support
              </button>
            </div>
          </motion.section>
        )}

        {!isCorporate && (
          <AnimatePresence mode="wait">
            {showIntroFlow && introStage === 'INTRO' && (
              <motion.section
                key="intro"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className={cardClass}
              >
                <div className="flex flex-col items-center text-center">
                  <div className="mb-8 relative">
                    <div className="absolute inset-0 bg-blue-500/20 blur-2xl rounded-full" />
                    <div className="relative rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 p-5 text-white shadow-xl shadow-blue-500/30">
                      <ShieldCheck size={40} />
                    </div>
                  </div>

                  <h2 className="text-3xl font-bold tracking-tight text-slate-900">
                    Identity Verification
                  </h2>
                  <p className="mt-4 text-slate-500 leading-relaxed max-w-xs">
                    We need to verify your identity to ensure the security of your account and
                    comply with regulations.
                  </p>

                  <div className="mt-8 grid w-full grid-cols-3 gap-3">
                    <div className="flex flex-col items-center rounded-2xl bg-slate-50 p-3">
                      <Clock3 size={20} className="mb-2 text-indigo-500" />
                      <span className="text-xs font-semibold text-slate-900">~3 min</span>
                      <span className="text-[10px] text-slate-400">Time</span>
                    </div>
                    <div className="flex flex-col items-center rounded-2xl bg-slate-50 p-3">
                      <Smartphone size={20} className="mb-2 text-indigo-500" />
                      <span className="text-xs font-semibold text-slate-900">Mobile</span>
                      <span className="text-[10px] text-slate-400">Device</span>
                    </div>
                    <div className="flex flex-col items-center rounded-2xl bg-slate-50 p-3">
                      <ShieldCheck size={20} className="mb-2 text-indigo-500" />
                      <span className="text-xs font-semibold text-slate-900">Secure</span>
                      <span className="text-[10px] text-slate-400">Data</span>
                    </div>
                  </div>

                  <button onClick={() => setIntroStage('GUIDE')} className={`${primaryButtonClass} mt-10`}>
                    Start Verification
                  </button>
                </div>
              </motion.section>
            )}

            {showIntroFlow && introStage === 'GUIDE' && (
              <motion.section
                key="guide"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.4 }}
                className={cardClass}
              >
                <div className="flex flex-col">
                  <h2 className="text-2xl font-bold text-slate-900 text-center mb-2">
                    Process Overview
                  </h2>
                  <p className="text-center text-slate-500 text-sm mb-8">
                    Complete these steps to unlock full access
                  </p>

                  <div className="space-y-4">
                    {stepGuides.map((item, index) => (
                      <motion.div
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.1 }}
                        key={item.title}
                        className="flex items-center gap-4 rounded-xl border border-slate-100 bg-slate-50/50 p-3"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-indigo-600 shadow-sm border border-slate-100">
                          {index + 1}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                          <div className="text-xs text-slate-500">{item.text}</div>
                        </div>
                      </motion.div>
                    ))}
                  </div>

                  {simulationModeEnabled ? (
                    <button
                      onClick={async () => {
                        const ok = await bootstrapCdd();
                        if (ok) setIntroStage('FLOW');
                      }}
                      disabled={saving}
                      className={`${primaryButtonClass} mt-10`}
                    >
                      {saving ? 'Initializing...' : 'Continue to Scan'}
                      {!saving && <ChevronRight size={16} />}
                    </button>
                  ) : (
                    <SimulationModeNotice message={simulationModeNotice} />
                  )}
                </div>
              </motion.section>
            )}

            {currentStep.step === 'CDD' && !showIntroFlow && (
              <motion.div
                key="cdd"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
                transition={{ duration: 0.4 }}
              >
                <JourneyResponsePanel
                  title="Verify Identity"
                  subtitle="Scan with your mobile device to complete verification securely."
                  item={activeResponse}
                  loading={casesLoading}
                  saving={saving}
                  onCreateSession={createSession}
                  onMockComplete={handleMockComplete}
                  onStart={bootstrapCdd}
                  simulationModeEnabled={simulationModeEnabled}
                  simulationModeMessage={simulationModeNotice}
                />
              </motion.div>
            )}

            {currentStep.step === 'EDD' && (
              <motion.div
                key="edd"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
                className="space-y-6 w-full"
              >
                <div className="rounded-2xl border border-violet-200 bg-violet-50/80 px-5 py-4 text-sm font-medium text-violet-800 flex items-center gap-3">
                  <ShieldCheck size={18} />
                  Enhanced Due Diligence Required
                </div>

                {!hasUsableActiveSession ? (
                  <motion.section
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cardClass}
                  >
                    <div className="flex flex-col items-center text-center">
                      <div className="mb-6 rounded-2xl bg-violet-50 p-5 text-violet-600">
                        <QrCode size={40} />
                      </div>
                      <h2 className="text-2xl font-bold text-slate-900">Start EDD Verification</h2>
                      <p className="mt-3 text-slate-500 leading-relaxed max-w-md">
                        Your EDD response is ready. Generate your verification link first, then scan QR
                        to continue.
                      </p>
                      {simulationModeEnabled ? (
                        <button
                          onClick={() => startEdd().catch(() => undefined)}
                          disabled={saving}
                          className={`${primaryButtonClass} mt-8`}
                        >
                          <QrCode size={18} />
                          Start EDD
                        </button>
                      ) : (
                        <SimulationModeNotice message={simulationModeNotice} />
                      )}
                    </div>
                  </motion.section>
                ) : (
                  <JourneyResponsePanel
                    title="Additional Check"
                    subtitle="Please complete this additional verification step."
                    item={activeResponse}
                    loading={casesLoading}
                    saving={saving}
                    onCreateSession={createSession}
                    onMockComplete={handleMockComplete}
                    onStart={startEdd}
                    simulationModeEnabled={simulationModeEnabled}
                    simulationModeMessage={simulationModeNotice}
                  />
                )}
              </motion.div>
            )}

            {currentStep.step === 'WAIT_REVIEW' && (
              <motion.section
                key="wait"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={cardClass}
              >
                <div className="flex flex-col items-center text-center">
                  <div className="mb-6 relative">
                    <div className="absolute inset-0 bg-amber-400/20 blur-xl rounded-full animate-pulse" />
                    <div className="relative rounded-2xl bg-amber-50 p-5 text-amber-500">
                      <Clock3 size={40} />
                    </div>
                  </div>

                  <h2 className="text-2xl font-bold text-slate-900">{reviewCardContent.title}</h2>
                  <p className="mt-3 text-slate-500 leading-relaxed max-w-lg">
                    {reviewCardContent.description}
                  </p>

                  <div className="mt-8 w-full border-t border-slate-100 pt-6">
                    <ResponseSummaryList
                      items={responses}
                      responseType={currentStep.requiresEdd ? 'EDD' : 'CDD'}
                    />
                  </div>
                </div>
              </motion.section>
            )}

            {currentStep.step === 'REINITIATE' && (
              <motion.section
                key="rejected"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={cardClass}
              >
                <div className="flex flex-col items-center text-center">
                  <div className="mb-6 rounded-2xl bg-red-50 p-5 text-red-500">
                    <AlertTriangle size={40} />
                  </div>

                  <h2 className="text-2xl font-bold text-slate-900">Verification Failed</h2>
                  <p className="mt-3 text-red-600/80 font-medium bg-red-50 px-4 py-2 rounded-lg text-sm">
                    {currentStep.blockedReason || 'Verification could not be completed.'}
                  </p>
                  <p className="mt-4 text-slate-500 text-sm">
                    Please try again. Ensure your documents are clear and details match.
                  </p>

                  {simulationModeEnabled ? (
                    <button
                      onClick={() =>
                        currentStep.action === 'REINITIATE_EDD'
                          ? reinitiateEdd().catch(() => undefined)
                          : reinitiateCdd().catch(() => undefined)
                      }
                      disabled={saving}
                      className={`${primaryButtonClass} mt-8 bg-gradient-to-r from-red-500 to-orange-600 shadow-red-500/30 hover:shadow-red-500/50`}
                    >
                      <RefreshCw size={18} />
                      {currentStep.action === 'REINITIATE_EDD' ? 'Retry EDD' : 'Retry Verification'}
                    </button>
                  ) : (
                    <SimulationModeNotice message={simulationModeNotice} />
                  )}
                </div>
              </motion.section>
            )}

            {currentStep.step === 'ENTITY_INFO' && (
              <motion.section
                key="manual"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={cardClass}
              >
                <div className="flex flex-col items-center text-center">
                  <div className="mb-6 rounded-2xl bg-amber-50 p-5 text-amber-500">
                    <AlertTriangle size={40} />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900">Setup Required</h2>
                  <p className="mt-3 text-slate-500 leading-relaxed">
                    Your account requires manual configuration. Please contact support.
                  </p>
                  <button className={`${secondaryButtonClass} mt-8`}>Contact Support</button>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        )}
      </div>

    </div>
  );
};

const JourneyResponsePanel = ({
  title,
  subtitle,
  item,
  loading,
  saving,
  onCreateSession,
  onMockComplete,
  onStart,
  simulationModeEnabled,
  simulationModeMessage,
}: {
  title: string;
  subtitle: string;
  item: ResponseItem | null;
  loading: boolean;
  saving: boolean;
  onCreateSession: (item: ResponseItem) => Promise<boolean>;
  onMockComplete: (session: ResponseSession, responseType: 'CDD' | 'EDD') => Promise<boolean>;
  onStart: () => Promise<boolean>;
  simulationModeEnabled: boolean;
  simulationModeMessage: string;
}) => {
  if (loading) {
    return (
      <section className={cardClass + ' flex items-center justify-center min-h-[400px]'}>
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-600" />
          <p className="text-sm font-medium text-slate-400">Loading details...</p>
        </div>
      </section>
    );
  }

  if (!item) {
    return (
      <section className={cardClass}>
        <div className="flex flex-col items-center text-center">
          <div className="mb-6 rounded-2xl bg-slate-50 p-5 text-slate-400">
            <QrCode size={40} />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
          <p className="mt-3 text-slate-500 leading-relaxed max-w-xs">{subtitle}</p>
          {simulationModeEnabled ? (
            <button
              onClick={() => onStart().catch(() => undefined)}
              disabled={saving}
              className={`${primaryButtonClass} mt-8`}
            >
              Start Now
            </button>
          ) : (
            <SimulationModeNotice message={simulationModeMessage} />
          )}
        </div>
      </section>
    );
  }

  const hasUsableSession =
    !!item.latestSession?.qrCodeUrl &&
    item.latestSession.status !== 'FAILED' &&
    new Date(item.latestSession.expiresAt).getTime() > Date.now();
  const sessionId = resolveSessionId(item.latestSession);

  return (
    <section className={cardClass}>
      <div className="flex flex-col items-center text-center">
        <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
        <p className="mt-2 text-slate-500 text-sm max-w-xs">{subtitle}</p>

        <div className="mt-8 relative group">
          {item.latestSession?.qrCodeUrl ? (
            <div className="relative overflow-hidden rounded-3xl bg-white p-4 shadow-xl shadow-indigo-500/10 border border-indigo-50">
              <QRCodeSVG value={item.latestSession.qrCodeUrl} size={200} />

              <div className="absolute inset-0 pointer-events-none">
                <div
                  className="h-1 w-full bg-indigo-500/50 blur-[2px] shadow-[0_0_15px_rgba(99,102,241,0.6)]"
                  style={{ animation: 'scan 2s linear infinite' }}
                />
              </div>

              <div className="absolute top-3 left-3 w-4 h-4 border-l-2 border-t-2 border-indigo-500 rounded-tl-md" />
              <div className="absolute top-3 right-3 w-4 h-4 border-r-2 border-t-2 border-indigo-500 rounded-tr-md" />
              <div className="absolute bottom-3 left-3 w-4 h-4 border-l-2 border-b-2 border-indigo-500 rounded-bl-md" />
              <div className="absolute bottom-3 right-3 w-4 h-4 border-r-2 border-b-2 border-indigo-500 rounded-br-md" />
            </div>
          ) : (
            <div className="flex h-[200px] w-[200px] items-center justify-center rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50">
              <span className="text-xs font-medium text-slate-400">QR Expired</span>
            </div>
          )}
        </div>

        {item.latestSession && (
          <div className="mt-6 flex items-center gap-2 rounded-full border border-slate-100 bg-slate-50/50 px-4 py-1.5">
            <div
              className={`h-2 w-2 rounded-full ${
                hasUsableSession ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
              }`}
            />
            <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
              {hasUsableSession ? 'Ready to Scan' : 'Session Expired'}
            </span>
          </div>
        )}

        <div className="mt-8 w-full max-w-xs space-y-3">
          {!hasUsableSession && simulationModeEnabled && (
            <button
              onClick={() => onCreateSession(item).catch(() => undefined)}
              disabled={saving}
              className={secondaryButtonClass}
            >
              <RefreshCw size={16} />
              Regenerate QR Code
            </button>
          )}

          {!hasUsableSession && !simulationModeEnabled && (
            <SimulationModeNotice message={simulationModeMessage} />
          )}

          {item.latestSession?.status === 'PENDING' && simulationModeEnabled && (
            <button
              onClick={() => {
                if (!item.latestSession || !sessionId) {
                  return;
                }
                onMockComplete(item.latestSession, item.responseType).catch(() => undefined);
              }}
              disabled={saving || !sessionId}
              className="w-full text-center text-xs font-medium text-slate-300 hover:text-indigo-400 transition-colors py-2 cursor-pointer disabled:cursor-not-allowed disabled:hover:text-slate-300"
            >
              [Dev] Mock Complete
            </button>
          )}
        </div>
      </div>
    </section>
  );
};

const ResponseSummaryList = ({
  items,
  responseType,
}: {
  items: ResponseItem[];
  responseType: 'CDD' | 'EDD';
}) => {
  const filtered = items.filter((item) => item.responseType === responseType).slice(0, 3);

  if (filtered.length === 0) return null;

  return (
    <div className="w-full space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 text-center">
        Recent Activity
      </div>
      {filtered.map((item) => (
        <div
          key={item.id}
          className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 px-4 py-3 text-sm transition-colors hover:bg-white hover:border-indigo-100"
        >
          <div className="flex items-center gap-3">
            <div
              className={`h-2 w-2 rounded-full ${
                item.status === 'APPROVED'
                  ? 'bg-emerald-500'
                  : item.status === 'REJECTED'
                    ? 'bg-red-500'
                    : 'bg-amber-500'
              }`}
            />
            <span className="font-medium text-slate-700">{item.responseNo}</span>
          </div>
          <span className="text-xs font-medium text-slate-500 bg-white px-2 py-1 rounded border border-slate-100">
            {item.status}
          </span>
        </div>
      ))}
    </div>
  );
};

export default Verification;
