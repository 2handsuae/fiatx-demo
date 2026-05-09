import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
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

interface VerificationProjection {
  provider?: string | null;
  applicantId?: string | null;
  currentLevelName?: string | null;
  latestReviewId?: string | null;
  latestAttemptId?: string | null;
  substatus?: string | null;
  customerActionRequired?: boolean;
  canContinue?: boolean;
  latestEventType?: string | null;
  latestEventAt?: string | null;
  experiencedLevel2?: boolean;
  sdkToken?: string | null;
}

interface OnboardingSnapshot {
  id: string;
  customerType: 'INDIVIDUAL' | 'CORPORATE' | 'UNKNOWN';
  companyName?: string | null;
  onboardingStatus?: string;
  adminStatus?: string;
  restrictions?: string[];
  actions?: OnboardingAction[];
  blockedReason?: string | null;
  riskRating: string;
  eddRequired: boolean;
  cddDocumentExpiresAt?: string | null;
  investorTier?: string | null;
  corporateProfile?: {
    companyName?: string;
    registrationNo?: string;
    incorporationCountry?: string;
  } | null;
  uboProfiles?: UboItem[];
  verification?: VerificationProjection | null;
}

interface PeriodicReviewSnapshot {
  activePeriodicReviewCycleId?: string | null;
  nextReviewAt?: string | null;
  restrictions?: string[];
  complianceStatus?: string;
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
  verification?: VerificationProjection | null;
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
type VerificationStep =
  | 'ENTITY_INFO'
  | 'CDD'
  | 'WAIT_REVIEW'
  | 'EDD'
  | 'REINITIATE'
  | 'COMPLETED'
  | 'START_VERIFICATION'
  | 'VERIFY'
  | 'FINAL_APPROVAL';
type VerificationAction =
  | 'SAVE_ENTITY'
  | 'START_CDD'
  | 'COMPLETE_CDD'
  | 'COMPLETE_EDD'
  | 'WAIT'
  | 'REINITIATE_CDD'
  | 'REINITIATE_EDD'
  | 'START_VERIFICATION'
  | 'CONTINUE_VERIFICATION'
  | 'WAIT_VERIFICATION'
  | 'WAIT_FINAL_APPROVAL'
  | 'REINITIATE_VERIFICATION'
  | 'NONE';

interface VerificationStepState {
  step: VerificationStep;
  action: VerificationAction;
  blockedReason: string | null;
  activeCaseId: string | null;
  requiresEdd: boolean;
  actions: OnboardingAction[];
  verification: VerificationProjection | null;
}

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const normalizeVerificationProjection = (
  value?: VerificationProjection | null,
): VerificationProjection | null => {
  if (!value) {
    return null;
  }

  return {
    provider: value.provider || null,
    applicantId: value.applicantId || null,
    currentLevelName: value.currentLevelName || null,
    latestReviewId: value.latestReviewId || null,
    latestAttemptId: value.latestAttemptId || null,
    substatus: value.substatus || null,
    customerActionRequired: !!value.customerActionRequired,
    canContinue: !!value.canContinue,
    latestEventType: value.latestEventType || null,
    latestEventAt: value.latestEventAt || null,
    experiencedLevel2: !!value.experiencedLevel2,
    sdkToken: value.sdkToken || null,
  };
};

const formatVerificationLabel = (value?: string | null) =>
  String(value || '')
    .trim()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');

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
    adminStatus?: string;
    actions?: OnboardingAction[];
    eddRequired?: boolean;
  } | null,
): VerificationStepState => {
  const onboardingStatus = normalizeCanonicalOnboardingStatus(
    onboarding?.onboardingStatus ?? profile?.onboardingStatus,
  );
  const verification = normalizeVerificationProjection(
    nextStep?.verification ?? onboarding?.verification ?? null,
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

  if (onboardingStatus === 'APPROVED') {
    return {
      step: 'COMPLETED',
      action: 'NONE',
      blockedReason,
      activeCaseId,
      requiresEdd,
      actions,
      verification,
    };
  }

  if (
    onboardingStatus === 'REJECTED' ||
    onboardingStatus === 'WITHDRAWN' ||
    hasAction('REINITIATE_VERIFICATION')
  ) {
    return {
      step: 'REINITIATE',
      action: 'REINITIATE_VERIFICATION',
      blockedReason,
      activeCaseId,
      requiresEdd,
      actions,
      verification,
    };
  }

  if (onboardingStatus === 'FINAL_APPROVAL' || hasAction('WAIT_FINAL_APPROVAL')) {
    return {
      step: 'FINAL_APPROVAL',
      action: 'WAIT_FINAL_APPROVAL',
      blockedReason,
      activeCaseId,
      requiresEdd: true,
      actions,
      verification,
    };
  }

  if (
    onboardingStatus === 'PENDING_VERIFICATION' ||
    hasAction('CONTINUE_VERIFICATION') ||
    hasAction('WAIT_VERIFICATION')
  ) {
    const shouldContinueVerification =
      verification?.customerActionRequired ||
      verification?.canContinue ||
      hasAction('CONTINUE_VERIFICATION');
    return {
      step: shouldContinueVerification ? 'VERIFY' : 'WAIT_REVIEW',
      action: shouldContinueVerification ? 'CONTINUE_VERIFICATION' : 'WAIT_VERIFICATION',
      blockedReason,
      activeCaseId,
      requiresEdd: Boolean(verification?.experiencedLevel2 || requiresEdd),
      actions,
      verification,
    };
  }

  if (onboardingStatus === 'NONE' || hasAction('START_VERIFICATION')) {
    return {
      step: 'START_VERIFICATION',
      action: 'START_VERIFICATION',
      blockedReason,
      activeCaseId,
      requiresEdd,
      actions,
      verification,
    };
  }

  return {
    step: 'ENTITY_INFO',
    action: 'SAVE_ENTITY',
    blockedReason,
    activeCaseId,
    requiresEdd,
    actions,
    verification,
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
      verification: null,
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
      verification: null,
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
      verification: null,
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
      verification: null,
    };
  }

  return {
    step: 'CDD',
    action: hasAction('START_CDD') ? 'START_CDD' : 'COMPLETE_CDD',
    blockedReason,
    activeCaseId,
    requiresEdd: false,
    actions,
    verification: null,
  };
};

const stepGuides = [
  { title: 'Basic Profile',     text: 'Provide your basic details.' },
  { title: 'Face Verification', text: 'Complete liveness check.' },
  { title: 'Address Check',     text: 'Verify your residential address.' },
  { title: 'Screening',         text: 'Pass background checks.' },
  { title: 'Review',            text: 'Compliance team review.' },
];

/* ── FIATX Desert Monolith button + card tokens ─────────────────── */
const primaryButtonClass =
  'group inline-flex items-center justify-center gap-2 bg-fx-brass text-fx-obsidian font-mono text-[11px] tracking-[0.18em] uppercase px-6 py-3 transition-colors hover:bg-fx-ember disabled:opacity-50 disabled:cursor-not-allowed';

const secondaryButtonClass =
  'inline-flex items-center justify-center gap-2 border border-fx-rule-strong bg-transparent text-fx-sand font-mono text-[11px] tracking-[0.18em] uppercase px-6 py-3 transition-colors hover:border-fx-brass hover:text-fx-brass disabled:opacity-50 disabled:cursor-not-allowed';

/* Editorial halt frame — hairline ruled panel, never round, calm. */
const cardClass =
  'relative w-full max-w-[640px] border border-fx-rule bg-fx-ink/40 px-10 md:px-14 py-14';

const SimulationModeNotice = ({ message }: { message: string }) => (
  <div className="mt-6 border border-fx-brass/20 bg-fx-brass/[0.04] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-fx-brass/90 leading-relaxed">
    <span className="text-fx-brass">§ </span>
    {message}
  </div>
);

/* Editorial byline — brass hairline + chapter label */
const FrameByline = ({ chapter, label }: { chapter: string; label: string }) => (
  <div className="flex items-center gap-3 mb-7">
    <span className="h-[1px] w-6 bg-fx-brass" />
    <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-fx-dust">
      {chapter}
    </span>
    <span className="text-fx-rule-strong">·</span>
    <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-fx-dust">
      {label}
    </span>
  </div>
);

/* Small tonal marker — replaces the pastel gradient icon pills */
const ToneMark = ({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'brass' | 'sage' | 'rust' | 'dust';
}) => {
  const cls =
    tone === 'sage'
      ? 'border-fx-sage/30 bg-fx-sage/5 text-fx-sage'
      : tone === 'rust'
        ? 'border-fx-rust/30 bg-fx-rust/5 text-fx-rust'
        : tone === 'dust'
          ? 'border-fx-rule-strong bg-fx-ink/30 text-fx-dust'
          : 'border-fx-brass/30 bg-fx-brass/5 text-fx-brass';
  return (
    <div
      className={`inline-flex h-12 w-12 items-center justify-center border ${cls}`}
    >
      {children}
    </div>
  );
};

const formatVerificationTime = (value?: string | null) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString();
};

const OnboardingVerificationDetails = ({
  verification,
}: {
  verification: VerificationProjection | null;
}) => {
  if (!verification) {
    return null;
  }

  const items = [
    {
      label: 'Provider',
      value: verification.provider ? formatVerificationLabel(verification.provider) : null,
    },
    {
      label: 'Status',
      value: verification.substatus ? formatVerificationLabel(verification.substatus) : null,
    },
    {
      label: 'Level',
      value: verification.currentLevelName || null,
    },
    {
      label: 'Latest Event',
      value: verification.latestEventType
        ? formatVerificationLabel(verification.latestEventType)
        : null,
    },
    {
      label: 'Updated',
      value: formatVerificationTime(verification.latestEventAt),
    },
  ].filter((item) => item.value);

  if (!items.length) {
    return null;
  }

  return (
    <div className="mt-10 w-full text-left border-t border-fx-rule">
      {items.map((item) => (
        <div
          key={item.label}
          className="grid grid-cols-12 gap-4 py-3 border-b border-fx-rule"
        >
          <div className="col-span-4 font-mono text-[9px] uppercase tracking-[0.18em] text-fx-dust pt-[2px]">
            {item.label}
          </div>
          <div className="col-span-8 font-mono text-[11px] text-fx-sand">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────
 *  MaterialRefreshVerificationMode
 *  Shown when the customer is APPROVED and arrives at /verification
 *  with ?cycleId=<id>. Fetches the refresh-cycle and a SDK token,
 *  then presents a QR for the mobile Sumsub flow.
 * ──────────────────────────────────────────────────────────────── */

interface RefreshCycle {
  id: string;
  cycleNo: string;
  materialType?: string;
  status: string;
  dueAt?: string | null;
  mockActionId?: string | null;
}

interface RefreshSdkToken {
  sdkToken?: string | null;
  mockActionId?: string | null;
}

const MaterialRefreshVerificationMode = ({ cycleId }: { cycleId: string }) => {
  const navigate = useNavigate();
  const [cycle, setCycle] = useState<RefreshCycle | null>(null);
  const [sdkInfo, setSdkInfo] = useState<RefreshSdkToken | null>(null);
  const [loadingData, setLoadingData] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoadingData(true);
      setFetchError(null);
      try {
        const base = `${import.meta.env.VITE_API_URL}/onboarding/refresh-cycles/${cycleId}`;

        const cycleRes = await customerFetch(base);
        if (!cycleRes.ok) throw new Error('Failed to load refresh cycle.');
        const cycleData = (await cycleRes.json()) as RefreshCycle;
        setCycle(cycleData);

        // sdk-token may 403 when cycle is already CLEARED/REJECTED — don't kick to login
        try {
          const tokenRes = await customerFetch(
            `${base}/sdk-token`,
            { method: 'POST', body: JSON.stringify({}) },
            { redirectOnAuthFailure: false },
          );
          if (tokenRes.ok) {
            const tokenData = (await tokenRes.json()) as RefreshSdkToken;
            setSdkInfo(tokenData);
          }
        } catch {
          // non-fatal: cycle might be CLEARED/PENDING_SUMSUB_REVIEW
        }
      } catch (e: unknown) {
        setFetchError(getErrorMessage(e, 'Failed to load material refresh data.'));
      } finally {
        setLoadingData(false);
      }
    };
    void load();
  }, [cycleId]);

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await customerFetch(
        `${import.meta.env.VITE_API_URL}/onboarding/refresh-cycles/${cycleId}/submit`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      if (!res.ok) throw new Error('Submission failed.');
      setCycle((prev) => prev ? { ...prev, status: 'PENDING_SUMSUB_REVIEW' } : prev);
    } catch (e: unknown) {
      setSubmitError(getErrorMessage(e, 'Failed to submit material.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingData) {
    return (
      <div className="flex h-screen items-center justify-center gap-3 bg-fx-obsidian">
        <RefreshCw size={14} className="animate-spin text-fx-brass" />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fx-dust">
          Loading review cycle
        </span>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="flex h-screen items-center justify-center px-6 bg-fx-obsidian">
        <div className="max-w-md border border-fx-rust/30 bg-fx-rust/5 px-6 py-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-fx-rust mb-2">
            § Error
          </div>
          <div className="font-mono text-[11px] text-fx-dune">{fetchError}</div>
          <button
            onClick={() => navigate('/profile')}
            className="mt-6 fx-btn-ghost"
          >
            Back to profile
          </button>
        </div>
      </div>
    );
  }

  const qrValue = sdkInfo?.sdkToken || sdkInfo?.mockActionId || cycleId;
  const status = cycle?.status || '';

  /* ── PENDING_SUMSUB_REVIEW: full-page "Under Review" card (matches onboarding WAIT_REVIEW) ── */
  if (status === 'PENDING_SUMSUB_REVIEW') {
    return (
      <div className="relative min-h-[calc(100vh-56px)] w-full bg-fx-obsidian">
        <div className="relative mx-auto flex min-h-[calc(100vh-56px)] max-w-5xl flex-col items-center justify-center px-6 py-12">
          <section className={cardClass}>
            <FrameByline chapter="§ Material Refresh" label="Compliance review" />
            <div className="flex items-start gap-6">
              <ToneMark tone="brass">
                <Clock3 size={20} />
              </ToneMark>
              <div className="flex-1">
                <h2 className="fx-display font-light text-[36px] leading-[1.05] text-fx-sand">
                  Under Review
                  <br />
                  <span className="fx-serif italic text-fx-brass">in progress.</span>
                </h2>
                <p className="mt-5 fx-serif text-[14px] leading-[1.7] text-fx-dune max-w-[460px]">
                  Your material submission has been sent to the verification provider and is now
                  waiting for review. We will update the status once the result arrives.
                </p>
                <div className="mt-8 grid grid-cols-2 gap-4">
                  {cycle?.cycleNo && (
                    <div>
                      <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-fx-dust/70 mb-1">Cycle</div>
                      <div className="font-mono text-[11px] text-fx-sand tabular-nums">{cycle.cycleNo}</div>
                    </div>
                  )}
                  <div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-fx-dust/70 mb-1">Material</div>
                    <div className="font-mono text-[11px] text-fx-sand">{cycle?.materialType?.replace(/_/g, ' ') || '—'}</div>
                  </div>
                </div>
                <SimulationModeNotice message="Waiting for admin to simulate webhook result (GREEN / RED) via Sumsub Events." />
                <button onClick={() => navigate('/profile')} className="mt-8 fx-btn-ghost">
                  ← Back to profile
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  /* ── CLEARED: success page ── */
  if (status === 'CLEARED') {
    return (
      <div className="relative min-h-[calc(100vh-56px)] w-full bg-fx-obsidian">
        <div className="relative mx-auto flex min-h-[calc(100vh-56px)] max-w-5xl flex-col items-center justify-center px-6 py-12">
          <section className={cardClass}>
            <FrameByline chapter="§ Material Refresh" label="Complete" />
            <div className="flex items-start gap-6">
              <ToneMark tone="sage">
                <CheckCircle2 size={20} />
              </ToneMark>
              <div className="flex-1">
                <h2 className="fx-display font-light text-[36px] leading-[1.05] text-fx-sand">
                  Verified
                  <br />
                  <span className="fx-serif italic text-fx-sage">successfully.</span>
                </h2>
                <p className="mt-5 fx-serif text-[14px] leading-[1.7] text-fx-dune max-w-[460px]">
                  Your material has been verified. Your compliance record has been renewed.
                </p>
                <button onClick={() => navigate('/profile')} className="mt-8 fx-btn-ghost">
                  ← Back to profile
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  /* ── PENDING_CUSTOMER_EVIDENCE: QR scan page with mock submit link ── */
  return (
    <div className="relative min-h-[calc(100vh-56px)] w-full bg-fx-obsidian flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[560px]">
        <FrameByline chapter="§ Material Refresh" label={`Cycle ${cycle?.cycleNo || cycleId}`} />

        <h1 className="fx-display font-light text-[38px] leading-[1.05] text-fx-sand mb-3">
          Identity refresh required.
        </h1>
        <p className="fx-serif italic text-fx-brass text-[15px] leading-[1.6] mb-10">
          Complete the scan below to renew your compliance record.
        </p>

        {/* QR panel */}
        <div className="border border-fx-rule bg-fx-ink/40 px-10 py-10 flex flex-col items-center gap-6">
          <div className="bg-white p-3">
            <QRCodeSVG value={qrValue} size={180} />
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-fx-dust text-center">
            Scan with your mobile device to begin
          </p>

          {/* Metadata strip */}
          <div className="w-full border-t border-fx-rule pt-5 grid grid-cols-2 gap-4">
            {cycle?.cycleNo && (
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-fx-dust/70 mb-1">Cycle</div>
                <div className="font-mono text-[11px] text-fx-sand tabular-nums">{cycle.cycleNo}</div>
              </div>
            )}
            {cycle?.status && (
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-fx-dust/70 mb-1">Status</div>
                <div className="font-mono text-[11px] text-fx-sand uppercase">{cycle.status.replace(/_/g, ' ')}</div>
              </div>
            )}
            {(sdkInfo?.mockActionId || cycle?.mockActionId) && (
              <div className="col-span-2">
                <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-fx-dust/70 mb-1">Mock action id</div>
                <div className="font-mono text-[11px] text-fx-dune break-all">{sdkInfo?.mockActionId || cycle?.mockActionId}</div>
              </div>
            )}
          </div>
        </div>

        {/* Dev mock submit — small text link, matching onboarding pattern */}
        <button
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className="mt-8 font-mono text-[10px] uppercase tracking-[0.18em] text-fx-dust underline-offset-4 hover:text-fx-brass hover:underline disabled:opacity-50"
        >
          {submitting ? 'Submitting…' : '[ Dev ] Mock submit completed on mobile'}
        </button>
        {submitError && (
          <div className="mt-3 border border-fx-rust/30 bg-fx-rust/5 px-4 py-3 font-mono text-[11px] text-fx-rust">
            {submitError}
          </div>
        )}

        <div className="mt-4">
          <button onClick={() => navigate('/profile')} className="fx-btn-ghost">
            ← Back to profile
          </button>
        </div>
      </div>
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────
 *  Verification — root component.
 *  Routes between MaterialRefreshVerificationMode (APPROVED + cycleId)
 *  and the existing onboarding / periodic-review flow.
 * ──────────────────────────────────────────────────────────────── */

const Verification = () => {
  const { profile, loading, error, refreshProfile } = useCustomerProfile();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const cycleId = searchParams.get('cycleId');
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
  const [complianceStatus, setComplianceStatus] = useState<{
    requiresLevel2: boolean;
    restrictions: string[] | null;
    tierUpgradeCase: { caseNo: string; status: string } | null;
  } | null>(null);

  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = `
      @keyframes fx-scan {
        0% { transform: translateY(0); opacity: 0; }
        15% { opacity: 0.9; }
        85% { opacity: 0.9; }
        100% { transform: translateY(200px); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  const fetchComplianceStatus = async () => {
    try {
      const res = await customerFetch(`${import.meta.env.VITE_API_URL}/compliance/me`);
      if (res.ok) {
        const data = await res.json();
        setComplianceStatus(data);
      }
    } catch {
      // ignore — non-critical
    }
  };

  useEffect(() => {
    fetchComplianceStatus().catch(() => undefined);
  }, []);

  const verificationMode =
    profile?.activePeriodicReviewCycleId
      ? 'PERIODIC_REVIEW'
      : 'ONBOARDING';

  const withAuth = async (url: string, init?: RequestInit) => customerFetch(url, init);

  const loadOnboarding = async () => {
    const response = await withAuth(`${import.meta.env.VITE_API_URL}/onboarding/me`);
    if (!response.ok) throw new Error('Failed to load onboarding profile');
    const data = (await response.json()) as OnboardingSnapshot;
    setOnboarding({
      ...data,
      actions: Array.isArray(data.actions) ? data.actions : [],
      blockedReason: data.blockedReason || null,
      verification: normalizeVerificationProjection(data.verification),
    });
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
      verification: normalizeVerificationProjection(data.verification),
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
      if (verificationMode === 'PERIODIC_REVIEW') {
        await Promise.all([loadPeriodicReview(), loadNextStep(), loadResponses(), refreshProfile()]);
        return;
      }

      setResponses([]);
      await Promise.all([loadOnboarding(), loadNextStep(), refreshProfile()]);
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
  }, [profile?.id, profile?.activePeriodicReviewCycleId]);

  useEffect(() => {
    if (verificationMode !== 'PERIODIC_REVIEW') {
      return;
    }
    const hasPending = responses.some((item) => item.latestSession?.status === 'PENDING');
    if (!hasPending) return;
    const timer = window.setInterval(() => {
      Promise.all([loadResponses(), loadNextStep()]).catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [responses, verificationMode]);

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

  const startOnboardingVerification = async (successMessage: string) =>
    runAction(
      () =>
        withAuth(`${import.meta.env.VITE_API_URL}/onboarding/verification/start`, {
          method: 'POST',
          body: JSON.stringify({}),
        }),
      successMessage,
    );

  const mockSubmitVerification = async () =>
    runAction(
      () =>
        withAuth(`${import.meta.env.VITE_API_URL}/onboarding/verification/mock-submit`, {
          method: 'POST',
          body: JSON.stringify({}),
        }),
      'Verification form submitted. Awaiting review.',
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

  const showIntroFlow =
    ((verificationMode === 'ONBOARDING' &&
      currentStep.step === 'START_VERIFICATION' &&
      currentStep.action === 'START_VERIFICATION') ||
      (verificationMode === 'PERIODIC_REVIEW' &&
        currentStep.step === 'CDD' &&
        currentStep.action === 'START_CDD')) &&
    introStage !== 'FLOW';
  const simulationModeNotice =
    verificationMode === 'PERIODIC_REVIEW'
      ? 'Simulation Mode is off. Enable it from admin to run periodic review demo actions on this page.'
      : 'Simulation Mode is off. Enable it from admin to run onboarding Sumsub event simulations on this page.';

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
    if (
      (currentStep.step === 'START_VERIFICATION' &&
        currentStep.action === 'START_VERIFICATION') ||
      (currentStep.step === 'CDD' && currentStep.action === 'START_CDD')
    ) {
      setIntroStage((prev) => (prev === 'FLOW' ? 'INTRO' : prev));
      return;
    }
    setIntroStage('FLOW');
  }, [currentStep.step, currentStep.action]);

  if (loading)
    return (
      <div className="flex h-screen items-center justify-center gap-3">
        <RefreshCw size={14} className="animate-spin text-fx-brass" />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fx-dust">
          Loading verification
        </span>
      </div>
    );
  if (error)
    return (
      <div className="flex h-screen items-center justify-center px-6">
        <div className="max-w-md border border-fx-rust/30 bg-fx-rust/5 px-6 py-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-fx-rust mb-2">
            § Error
          </div>
          <div className="font-mono text-[11px] text-fx-dune">{error}</div>
        </div>
      </div>
    );
  if (!profile) return null;

  // Route: APPROVED customer with cycleId → material refresh mode
  const onboardingStatus = String(profile.onboardingStatus || 'NONE').toUpperCase();
  if (onboardingStatus === 'APPROVED' && cycleId) {
    return <MaterialRefreshVerificationMode cycleId={cycleId} />;
  }

  // Route: APPROVED customer with no cycleId → nothing to do here
  if (onboardingStatus === 'APPROVED' && !cycleId) {
    return <Navigate to="/profile" replace />;
  }

  const isCorporate =
    onboarding?.customerType === 'CORPORATE' || profile.customerType === 'CORPORATE';
  const reviewCardContent = currentStep.requiresEdd
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
    <div className="relative min-h-[calc(100vh-56px)] w-full bg-fx-obsidian">
      <div className="relative mx-auto flex min-h-[calc(100vh-56px)] max-w-5xl flex-col items-center justify-center px-6 py-12">
        <AnimatePresence mode="wait">
          {message && (
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="absolute top-4 z-50 w-full max-w-sm border border-fx-brass/30 bg-fx-ink/90 px-4 py-3 text-[11px] font-mono text-fx-sand backdrop-blur"
            >
              <div className="flex items-center gap-3">
                <span className="text-fx-brass font-mono text-[10px] tracking-[0.2em]">§</span>
                <span className="leading-relaxed">{message}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {complianceStatus?.requiresLevel2 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-[640px] mb-8 border border-fx-brass/40 bg-fx-brass/[0.06] px-6 py-5"
          >
            <div className="flex items-center gap-3 mb-3">
              <AlertTriangle size={14} className="text-fx-brass flex-shrink-0" />
              <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-fx-brass">
                Enhanced Verification Required
              </span>
            </div>
            <p className="fx-serif text-[13px] leading-[1.7] text-fx-dune mb-2">
              Your account has been flagged for enhanced due diligence. Please complete Level 2
              verification to restore full account access.
            </p>
            {complianceStatus.tierUpgradeCase?.caseNo && (
              <p className="font-mono text-[10px] text-fx-dust/70 mb-5">
                Upgrade case:{' '}
                <span className="text-fx-sand">{complianceStatus.tierUpgradeCase.caseNo}</span>
              </p>
            )}
            <button
              className={primaryButtonClass}
              onClick={async () => {
                try {
                  const res = await customerFetch(
                    `${import.meta.env.VITE_API_URL}/compliance/verification/mock-complete-level2`,
                    { method: 'POST' },
                  );
                  if (res.ok) {
                    setMessage('Level 2 verification submitted. Awaiting final compliance approval.');
                    await fetchComplianceStatus();
                  } else {
                    const err = (await res.json().catch(() => ({}))) as { message?: string };
                    setMessage(`Error: ${err.message || 'Submission failed'}`);
                  }
                } catch {
                  setMessage('Request failed. Please try again.');
                }
              }}
            >
              Mock Complete Level 2 Verification
            </button>
          </motion.div>
        )}

        {isCorporate && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className={cardClass}
          >
            <FrameByline chapter="§ Chapter I" label="Corporate onboarding" />
            <div className="flex items-start gap-6">
              <ToneMark tone="brass">
                <AlertTriangle size={20} />
              </ToneMark>
              <div className="flex-1">
                <h2 className="fx-display font-light text-[34px] leading-[1.05] text-fx-sand">
                  Corporate
                  <br />
                  <span className="fx-serif italic text-fx-brass">verification.</span>
                </h2>
                <p className="mt-5 fx-serif text-[14px] leading-[1.7] text-fx-dune max-w-[440px]">
                  Corporate self-service onboarding is temporarily unavailable. Please contact
                  our compliance support team to continue the KYB and UBO onboarding process.
                </p>
                <button className={`${secondaryButtonClass} mt-8`}>Contact support →</button>
              </div>
            </div>
          </motion.section>
        )}

        {!isCorporate && (
          <AnimatePresence mode="wait">
            {showIntroFlow && introStage === 'INTRO' && (
              <motion.section
                key="intro"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.5 }}
                className={cardClass}
              >
                <FrameByline chapter="§ Chapter II" label="Identity verification" />

                <h2 className="fx-display font-light text-[44px] md:text-[52px] leading-[0.95] text-fx-sand">
                  Verify
                  <br />
                  <span className="fx-serif italic text-fx-brass">your identity.</span>
                </h2>
                <p className="mt-6 fx-serif text-[15px] leading-[1.7] text-fx-dune max-w-[460px]">
                  We verify your identity to keep your account safe and comply with VARA
                  regulation. It takes about three minutes on your phone.
                </p>

                {/* Meta ledger — three columns, hairline dividers, no cards */}
                <div className="mt-10 grid grid-cols-3 border-t border-b border-fx-rule">
                  {[
                    { icon: <Clock3 size={14} />,      label: 'Duration',  value: '≈ 3 min' },
                    { icon: <Smartphone size={14} />,  label: 'Device',    value: 'Mobile' },
                    { icon: <ShieldCheck size={14} />, label: 'Partner',   value: 'Sumsub' },
                  ].map((it, idx) => (
                    <div
                      key={it.label}
                      className={`py-5 px-4 ${idx < 2 ? 'border-r border-fx-rule' : ''}`}
                    >
                      <div className="flex items-center gap-2 text-fx-brass">
                        {it.icon}
                        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-fx-dust">
                          {it.label}
                        </span>
                      </div>
                      <div className="mt-2 font-mono text-[13px] text-fx-sand tabular-nums">
                        {it.value}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-10">
                  <button onClick={() => setIntroStage('GUIDE')} className={primaryButtonClass}>
                    Begin verification →
                  </button>
                </div>
              </motion.section>
            )}

            {showIntroFlow && introStage === 'GUIDE' && (
              <motion.section
                key="guide"
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.45 }}
                className={cardClass}
              >
                <FrameByline chapter="§ Chapter II" label="Process overview" />

                <h2 className="fx-display font-light text-[38px] leading-[1] text-fx-sand">
                  Five steps
                  <br />
                  <span className="fx-serif italic text-fx-brass">to full access.</span>
                </h2>

                {/* Editorial ledger — Roman numerals, hairline rows */}
                <ol className="mt-10">
                  {stepGuides.map((item, index) => (
                    <motion.li
                      key={item.title}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.06 }}
                      className="grid grid-cols-12 gap-4 py-4 border-t border-fx-rule last:border-b"
                    >
                      <div className="col-span-2">
                        <span className="fx-display font-light text-[24px] leading-none text-fx-brass">
                          {String.fromCharCode(0x2160 + index)}
                        </span>
                      </div>
                      <div className="col-span-10">
                        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-fx-sand mb-1">
                          {item.title}
                        </div>
                        <div className="fx-serif text-[12px] leading-relaxed text-fx-dune/80">
                          {item.text}
                        </div>
                      </div>
                    </motion.li>
                  ))}
                </ol>

                <div className="mt-10">
                  {verificationMode === 'ONBOARDING' ? (
                    <button
                      onClick={async () => {
                        const ok = await startOnboardingVerification('Verification started.');
                        if (ok) setIntroStage('FLOW');
                      }}
                      disabled={saving}
                      className={primaryButtonClass}
                    >
                      {saving ? 'Initializing…' : 'Begin verification'}
                      {!saving && <ChevronRight size={14} />}
                    </button>
                  ) : simulationModeEnabled ? (
                    <button
                      onClick={async () => {
                        const ok = await bootstrapCdd();
                        if (ok) setIntroStage('FLOW');
                      }}
                      disabled={saving}
                      className={primaryButtonClass}
                    >
                      {saving ? 'Initializing…' : 'Continue to scan'}
                      {!saving && <ChevronRight size={14} />}
                    </button>
                  ) : (
                    <SimulationModeNotice message={simulationModeNotice} />
                  )}
                </div>
              </motion.section>
            )}

            {verificationMode === 'PERIODIC_REVIEW' && currentStep.step === 'CDD' && !showIntroFlow && (
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

            {verificationMode === 'PERIODIC_REVIEW' && currentStep.step === 'EDD' && (
              <motion.div
                key="edd"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45 }}
                className="flex w-full flex-col items-center gap-6"
              >
                <div className="w-full max-w-[640px] border border-fx-brass/25 bg-fx-brass/5 px-5 py-4 font-mono text-[10px] uppercase tracking-[0.18em] text-fx-brass flex items-center gap-3">
                  <ShieldCheck size={14} />
                  Enhanced due diligence required
                </div>

                {!hasUsableActiveSession ? (
                  <motion.section
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cardClass}
                  >
                    <FrameByline chapter="§ Chapter III" label="Enhanced due diligence" />
                    <div className="flex items-start gap-6">
                      <ToneMark tone="brass">
                        <QrCode size={20} />
                      </ToneMark>
                      <div className="flex-1">
                        <h2 className="fx-display font-light text-[34px] leading-[1.05] text-fx-sand">
                          Start
                          <br />
                          <span className="fx-serif italic text-fx-brass">EDD verification.</span>
                        </h2>
                        <p className="mt-5 fx-serif text-[14px] leading-[1.7] text-fx-dune max-w-[440px]">
                          Your EDD response is ready. Generate your verification link, then scan
                          the QR on your phone to continue.
                        </p>
                        {simulationModeEnabled ? (
                          <button
                            onClick={() => startEdd().catch(() => undefined)}
                            disabled={saving}
                            className={`${primaryButtonClass} mt-8`}
                          >
                            <QrCode size={14} />
                            Start EDD
                          </button>
                        ) : (
                          <SimulationModeNotice message={simulationModeNotice} />
                        )}
                      </div>
                    </div>
                  </motion.section>
                ) : (
                  <JourneyResponsePanel
                    title="Additional check"
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

            {verificationMode === 'ONBOARDING' && currentStep.step === 'VERIFY' && (
              <motion.section
                key="verify"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                className={cardClass}
              >
                <FrameByline chapter="§ Chapter II" label="Scan to continue" />
                <div className="grid grid-cols-12 gap-8 md:gap-10">
                  <div className="col-span-12 md:col-span-6">
                    <h2 className="fx-display font-light text-[38px] leading-[1] text-fx-sand">
                      Scan
                      <br />
                      <span className="fx-serif italic text-fx-brass">to verify.</span>
                    </h2>
                    <p className="mt-5 fx-serif text-[14px] leading-[1.7] text-fx-dune max-w-[360px]">
                      Open your phone camera and scan this code. Verification happens through
                      our VARA-approved partner, Sumsub.
                    </p>

                    <div className="mt-6 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-fx-dust">
                      <Smartphone size={12} />
                      Mobile device required
                    </div>

                    <button
                      onClick={() => mockSubmitVerification().catch(() => undefined)}
                      disabled={saving}
                      className="mt-8 font-mono text-[10px] uppercase tracking-[0.18em] text-fx-dust underline-offset-4 hover:text-fx-brass hover:underline disabled:opacity-50"
                    >
                      {saving ? 'Submitting…' : '[ Dev ] Mark completed on mobile'}
                    </button>
                  </div>

                  <div className="col-span-12 md:col-span-6 flex justify-center md:justify-end">
                    {/* QR slab — light background for scannability, brass corner marks */}
                    <div className="relative inline-block bg-fx-sand p-5">
                      <QRCodeSVG
                        value={
                          currentStep.verification?.applicantId
                            ? `https://verify.sumsub.com/idensic/l/#/applicants/${currentStep.verification.applicantId}`
                            : `https://verify.sumsub.com/idensic/l/#/onboarding/${profile?.id || 'pending'}`
                        }
                        size={200}
                        level="M"
                        fgColor="#0B0908"
                        bgColor="#F5EDE0"
                      />
                      {/* Brass corners */}
                      <span className="absolute -top-[1px] -left-[1px] w-3 h-3 border-l-2 border-t-2 border-fx-brass" />
                      <span className="absolute -top-[1px] -right-[1px] w-3 h-3 border-r-2 border-t-2 border-fx-brass" />
                      <span className="absolute -bottom-[1px] -left-[1px] w-3 h-3 border-l-2 border-b-2 border-fx-brass" />
                      <span className="absolute -bottom-[1px] -right-[1px] w-3 h-3 border-r-2 border-b-2 border-fx-brass" />
                    </div>
                  </div>
                </div>

                <OnboardingVerificationDetails verification={currentStep.verification} />
              </motion.section>
            )}

            {currentStep.step === 'WAIT_REVIEW' && (
              <motion.section
                key="wait"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                className={cardClass}
              >
                <FrameByline
                  chapter="§ Chapter III"
                  label={verificationMode === 'PERIODIC_REVIEW' ? 'Periodic review' : 'Compliance review'}
                />
                <div className="flex items-start gap-6">
                  <ToneMark tone="brass">
                    <Clock3 size={20} />
                  </ToneMark>
                  <div className="flex-1">
                    <h2 className="fx-display font-light text-[36px] leading-[1.05] text-fx-sand">
                      {reviewCardContent.title}
                      <br />
                      <span className="fx-serif italic text-fx-brass">in progress.</span>
                    </h2>
                    <p className="mt-5 fx-serif text-[14px] leading-[1.7] text-fx-dune max-w-[460px]">
                      {verificationMode === 'PERIODIC_REVIEW'
                        ? reviewCardContent.description
                        : 'Your verification has been submitted to the provider and is now waiting for review. We will update the status once the result arrives.'}
                    </p>

                    {verificationMode === 'PERIODIC_REVIEW' ? (
                      <div className="mt-8">
                        <ResponseSummaryList
                          items={responses}
                          responseType={currentStep.requiresEdd ? 'EDD' : 'CDD'}
                        />
                      </div>
                    ) : (
                      <OnboardingVerificationDetails verification={currentStep.verification} />
                    )}
                  </div>
                </div>
              </motion.section>
            )}

            {verificationMode === 'ONBOARDING' && currentStep.step === 'FINAL_APPROVAL' && (
              <motion.section
                key="final-approval"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                className={cardClass}
              >
                <FrameByline chapter="§ Chapter IV" label="Awaiting final approval" />
                <div className="flex items-start gap-6">
                  <ToneMark tone="brass">
                    <Clock3 size={20} />
                  </ToneMark>
                  <div className="flex-1">
                    <h2 className="fx-display font-light text-[36px] leading-[1.05] text-fx-sand">
                      Final approval
                      <br />
                      <span className="fx-serif italic text-fx-brass">pending.</span>
                    </h2>
                    <p className="mt-5 fx-serif text-[14px] leading-[1.7] text-fx-dune max-w-[460px]">
                      Provider verification is complete. A compliance officer is signing off your
                      file before account activation. Usually 1–2 business days.
                    </p>
                    <OnboardingVerificationDetails verification={currentStep.verification} />
                  </div>
                </div>
              </motion.section>
            )}

            {currentStep.step === 'REINITIATE' && (
              <motion.section
                key="rejected"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                className={cardClass}
              >
                <FrameByline chapter="§ Chapter II" label="Verification halted" />
                <div className="flex items-start gap-6">
                  <ToneMark tone="rust">
                    <AlertTriangle size={20} />
                  </ToneMark>
                  <div className="flex-1">
                    <h2 className="fx-display font-light text-[36px] leading-[1.05] text-fx-sand">
                      Verification
                      <br />
                      <span className="fx-serif italic text-fx-rust">could not continue.</span>
                    </h2>
                    <div className="mt-5 border-l-2 border-fx-rust/40 pl-4 font-mono text-[11px] text-fx-dune leading-relaxed">
                      {currentStep.blockedReason || 'Verification could not be completed.'}
                    </div>
                    <p className="mt-5 fx-serif text-[14px] leading-[1.7] text-fx-dune max-w-[460px]">
                      Please try again. Ensure your documents are clear and your details match.
                    </p>

                    <div className="mt-8">
                      {verificationMode === 'ONBOARDING' ? (
                        <button
                          onClick={() =>
                            startOnboardingVerification('Verification restarted.').catch(
                              () => undefined,
                            )
                          }
                          disabled={saving}
                          className={primaryButtonClass}
                        >
                          <RefreshCw size={14} />
                          Retry verification
                        </button>
                      ) : simulationModeEnabled ? (
                        <button
                          onClick={() =>
                            currentStep.action === 'REINITIATE_EDD'
                              ? reinitiateEdd().catch(() => undefined)
                              : reinitiateCdd().catch(() => undefined)
                          }
                          disabled={saving}
                          className={primaryButtonClass}
                        >
                          <RefreshCw size={14} />
                          {currentStep.action === 'REINITIATE_EDD'
                            ? 'Retry EDD'
                            : 'Retry verification'}
                        </button>
                      ) : (
                        <SimulationModeNotice message={simulationModeNotice} />
                      )}
                    </div>
                  </div>
                </div>
              </motion.section>
            )}

            {verificationMode === 'ONBOARDING' && currentStep.step === 'COMPLETED' && (
              <motion.section
                key="completed"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                className={cardClass}
              >
                <FrameByline chapter="§ Chapter IV" label="Account active" />
                <div className="flex items-start gap-6">
                  <ToneMark tone="sage">
                    <ShieldCheck size={20} />
                  </ToneMark>
                  <div className="flex-1">
                    <h2 className="fx-display font-light text-[36px] leading-[1.05] text-fx-sand">
                      Verification
                      <br />
                      <span className="fx-serif italic text-fx-sage">complete.</span>
                    </h2>
                    <p className="mt-5 fx-serif text-[14px] leading-[1.7] text-fx-dune max-w-[460px]">
                      Your onboarding verification has been approved and your account is ready.
                    </p>
                    <OnboardingVerificationDetails verification={currentStep.verification} />
                    <div className="mt-8">
                      <button onClick={() => navigate('/profile')} className={primaryButtonClass}>
                        Go to profile →
                      </button>
                    </div>
                  </div>
                </div>
              </motion.section>
            )}

            {currentStep.step === 'ENTITY_INFO' && (
              <motion.section
                key="manual"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                className={cardClass}
              >
                <FrameByline chapter="§ Chapter I" label="Manual setup" />
                <div className="flex items-start gap-6">
                  <ToneMark tone="brass">
                    <AlertTriangle size={20} />
                  </ToneMark>
                  <div className="flex-1">
                    <h2 className="fx-display font-light text-[36px] leading-[1.05] text-fx-sand">
                      Setup
                      <br />
                      <span className="fx-serif italic text-fx-brass">required.</span>
                    </h2>
                    <p className="mt-5 fx-serif text-[14px] leading-[1.7] text-fx-dune max-w-[460px]">
                      Your account requires manual configuration. Please contact support.
                    </p>
                    <button className={`${secondaryButtonClass} mt-8`}>Contact support →</button>
                  </div>
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
      <section className={cardClass + ' flex items-center justify-center min-h-[360px]'}>
        <div className="flex items-center gap-3">
          <RefreshCw size={14} className="animate-spin text-fx-brass" />
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fx-dust">
            Loading details
          </span>
        </div>
      </section>
    );
  }

  if (!item) {
    return (
      <section className={cardClass}>
        <FrameByline chapter="§ Chapter II" label={title} />
        <div className="flex items-start gap-6">
          <ToneMark tone="dust">
            <QrCode size={20} />
          </ToneMark>
          <div className="flex-1">
            <h2 className="fx-display font-light text-[34px] leading-[1.05] text-fx-sand">
              {title}
              <br />
              <span className="fx-serif italic text-fx-brass">not ready.</span>
            </h2>
            <p className="mt-5 fx-serif text-[14px] leading-[1.7] text-fx-dune max-w-[440px]">
              {subtitle}
            </p>
            {simulationModeEnabled ? (
              <button
                onClick={() => onStart().catch(() => undefined)}
                disabled={saving}
                className={`${primaryButtonClass} mt-8`}
              >
                Start now →
              </button>
            ) : (
              <SimulationModeNotice message={simulationModeMessage} />
            )}
          </div>
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
      <FrameByline chapter="§ Chapter II" label={title} />
      <div className="grid grid-cols-12 gap-8 md:gap-10">
        <div className="col-span-12 md:col-span-6">
          <h2 className="fx-display font-light text-[36px] leading-[1] text-fx-sand">
            Scan
            <br />
            <span className="fx-serif italic text-fx-brass">to continue.</span>
          </h2>
          <p className="mt-5 fx-serif text-[14px] leading-[1.7] text-fx-dune max-w-[360px]">
            {subtitle}
          </p>

          {item.latestSession && (
            <div className="mt-6 inline-flex items-center gap-2 border border-fx-rule px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.18em]">
              <span
                className={`h-[6px] w-[6px] rounded-full ${
                  hasUsableSession ? 'bg-fx-sage animate-pulse' : 'bg-fx-rust'
                }`}
              />
              <span className={hasUsableSession ? 'text-fx-sage' : 'text-fx-rust'}>
                {hasUsableSession ? 'Ready to scan' : 'Session expired'}
              </span>
            </div>
          )}

          <div className="mt-8 space-y-3">
            {!hasUsableSession && simulationModeEnabled && (
              <button
                onClick={() => onCreateSession(item).catch(() => undefined)}
                disabled={saving}
                className={secondaryButtonClass}
              >
                <RefreshCw size={12} />
                Regenerate QR
              </button>
            )}

            {!hasUsableSession && !simulationModeEnabled && (
              <SimulationModeNotice message={simulationModeMessage} />
            )}

            {item.latestSession?.status === 'PENDING' && simulationModeEnabled && (
              <div>
                <button
                  onClick={() => {
                    if (!item.latestSession || !sessionId) {
                      return;
                    }
                    onMockComplete(item.latestSession, item.responseType).catch(() => undefined);
                  }}
                  disabled={saving || !sessionId}
                  className="font-mono text-[10px] uppercase tracking-[0.18em] text-fx-dust underline-offset-4 hover:text-fx-brass hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  [ Dev ] Mock complete
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="col-span-12 md:col-span-6 flex justify-center md:justify-end">
          {item.latestSession?.qrCodeUrl ? (
            <div className="relative inline-block bg-fx-sand p-5 overflow-hidden">
              <QRCodeSVG
                value={item.latestSession.qrCodeUrl}
                size={200}
                fgColor="#0B0908"
                bgColor="#F5EDE0"
              />
              {/* Brass scan line */}
              <div className="pointer-events-none absolute inset-x-5 top-5">
                <div
                  className="h-[1px] w-[200px] bg-fx-brass"
                  style={{ animation: 'fx-scan 2.2s linear infinite' }}
                />
              </div>
              {/* Brass corners */}
              <span className="absolute -top-[1px] -left-[1px] w-3 h-3 border-l-2 border-t-2 border-fx-brass" />
              <span className="absolute -top-[1px] -right-[1px] w-3 h-3 border-r-2 border-t-2 border-fx-brass" />
              <span className="absolute -bottom-[1px] -left-[1px] w-3 h-3 border-l-2 border-b-2 border-fx-brass" />
              <span className="absolute -bottom-[1px] -right-[1px] w-3 h-3 border-r-2 border-b-2 border-fx-brass" />
            </div>
          ) : (
            <div className="flex h-[240px] w-[240px] items-center justify-center border border-dashed border-fx-rule-strong font-mono text-[10px] uppercase tracking-[0.18em] text-fx-dust">
              QR expired
            </div>
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
    <div className="w-full">
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-fx-dust mb-3">
        § Recent activity
      </div>
      <div className="border-t border-fx-rule">
        {filtered.map((item) => {
          const dot =
            item.status === 'APPROVED'
              ? 'bg-fx-sage'
              : item.status === 'REJECTED'
                ? 'bg-fx-rust'
                : 'bg-fx-brass';
          const statusTone =
            item.status === 'APPROVED'
              ? 'text-fx-sage'
              : item.status === 'REJECTED'
                ? 'text-fx-rust'
                : 'text-fx-brass';
          return (
            <div
              key={item.id}
              className="flex items-center justify-between border-b border-fx-rule py-3"
            >
              <div className="flex items-center gap-3">
                <span className={`h-[6px] w-[6px] rounded-full ${dot}`} />
                <span className="font-mono text-[11px] text-fx-sand">{item.responseNo}</span>
              </div>
              <span className={`font-mono text-[9px] uppercase tracking-[0.18em] ${statusTone}`}>
                {item.status}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Verification;
