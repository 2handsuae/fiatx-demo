import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Clock, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { QRCodeSVG } from 'qrcode.react';
import { useCustomerProfile } from '../hooks/useCustomerProfile';

interface VerificationProps {
  isModal?: boolean;
  onClose?: () => void;
}

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
  onboardingStage: string;
  onboardingRejectReason?: string | null;
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
  providerStatus?: string;
  latestSession?: CaseSession | null;
}

interface UboDraft {
  id?: string;
  fullName: string;
  ownershipPercent: string;
  nationality: string;
  pepFlag: boolean;
}

type EntityPayload =
  | {
      customerType: 'INDIVIDUAL';
    }
  | {
      customerType: 'CORPORATE';
      corporateProfile: {
        companyName: string;
        registrationNo: string;
        incorporationCountry: string;
      };
      ubos: Array<{
        fullName: string;
        ownershipPercent: number;
        nationality?: string;
        pepFlag: boolean;
      }>;
    };

const emptyUbo: UboDraft = {
  fullName: '',
  ownershipPercent: '',
  nationality: '',
  pepFlag: false,
};

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const Verification = ({ isModal = false, onClose }: VerificationProps) => {
  const { profile, loading, error, refreshProfile } = useCustomerProfile();
  const navigate = useNavigate();

  const [onboarding, setOnboarding] = useState<OnboardingSnapshot | null>(null);
  const [nextStep, setNextStep] = useState<NextStepPayload | null>(null);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [casesLoading, setCasesLoading] = useState(false);
  const [corporateForm, setCorporateForm] = useState({
    companyName: '',
    registrationNo: '',
    incorporationCountry: '',
  });
  const [ubos, setUbos] = useState<UboDraft[]>([emptyUbo]);

  const token = localStorage.getItem('customer_token');

  const closePanel = () => {
    if (onClose) onClose();
    else navigate('/profile');
  };

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
    if (!response.ok) {
      throw new Error('Failed to load onboarding profile');
    }

    const data = (await response.json()) as OnboardingSnapshot;
    setOnboarding(data);

    if (data.corporateProfile) {
      setCorporateForm({
        companyName: data.corporateProfile.companyName || data.companyName || '',
        registrationNo: data.corporateProfile.registrationNo || '',
        incorporationCountry: data.corporateProfile.incorporationCountry || '',
      });
    } else {
      setCorporateForm((prev) => ({
        ...prev,
        companyName: data.companyName || prev.companyName,
      }));
    }

    if (Array.isArray(data.uboProfiles) && data.uboProfiles.length > 0) {
      setUbos(
        data.uboProfiles.map((ubo) => ({
          id: ubo.id,
          fullName: ubo.fullName || '',
          ownershipPercent:
            typeof ubo.ownershipPercent === 'number' ? String(ubo.ownershipPercent) : '',
          nationality: ubo.nationality || '',
          pepFlag: !!ubo.pepFlag,
        })),
      );
    }
  };

  const loadNextStep = async () => {
    if (!token) return;
    const response = await withAuth(`${import.meta.env.VITE_API_URL}/onboarding/next-step`);
    if (!response.ok) {
      throw new Error('Failed to load next step');
    }
    setNextStep((await response.json()) as NextStepPayload);
  };

  const loadCases = async () => {
    if (!token) return;
    setCasesLoading(true);
    try {
      const response = await withAuth(`${import.meta.env.VITE_API_URL}/onboarding/cases`);
      if (!response.ok) {
        throw new Error('Failed to load onboarding cases');
      }
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
      setMessage(getErrorMessage(e, 'Load failed'));
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
        setMessage(err.message || 'Operation failed');
        return;
      }
      setMessage(successMessage);
      await refreshAll();
    } catch (e: unknown) {
      setMessage(getErrorMessage(e, 'Network error'));
    } finally {
      setSaving(false);
    }
  };

  const saveEntity = async () => {
    if (!onboarding) return;
    if (onboarding.customerType !== 'INDIVIDUAL' && onboarding.customerType !== 'CORPORATE') {
      setMessage('Invalid customer type');
      return;
    }

    let payload: EntityPayload = {
      customerType: onboarding.customerType,
    };

    if (onboarding.customerType === 'CORPORATE') {
      payload = {
        customerType: onboarding.customerType,
        corporateProfile: {
          companyName: corporateForm.companyName,
          registrationNo: corporateForm.registrationNo,
          incorporationCountry: corporateForm.incorporationCountry,
        },
        ubos: ubos
          .filter((ubo) => ubo.fullName.trim())
          .map((ubo) => ({
            fullName: ubo.fullName,
            ownershipPercent: Number(ubo.ownershipPercent || 0),
            nationality: ubo.nationality || undefined,
            pepFlag: ubo.pepFlag,
          })),
      };
    }

    await runAction(
      () =>
        withAuth(`${import.meta.env.VITE_API_URL}/onboarding/entity`, {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      'Entity profile saved.',
    );
  };

  const bootstrapCdd = async (successMessage: string) => {
    await runAction(
      () =>
        withAuth(`${import.meta.env.VITE_API_URL}/onboarding/cdd-cases/bootstrap`, {
          method: 'POST',
          body: JSON.stringify({}),
        }),
      successMessage,
    );
  };

  const createSession = async (item: CaseItem) => {
    await runAction(
      () =>
        withAuth(`${import.meta.env.VITE_API_URL}/onboarding/cases/${item.id}/sessions`, {
          method: 'POST',
          body: JSON.stringify({
            caseType: item.caseType,
            provider: 'MOCK',
          }),
        }),
      `${item.caseType} QR session created.`,
    );
  };

  const mockComplete = async (sessionId: string) => {
    await runAction(
      () =>
        withAuth(`${import.meta.env.VITE_API_URL}/onboarding/sessions/${sessionId}/mock-complete`, {
          method: 'POST',
          body: JSON.stringify({ result: 'PASS' }),
        }),
      'Mock scan completed and case moved to review queue.',
    );
  };

  const stage = onboarding?.onboardingStage || profile?.onboardingStage || 'REGISTERED';
  const approved = stage === 'ONBOARDING_APPROVED';
  const rejected = stage === 'ONBOARDING_REJECTED';
  const inReview = ['CDD_UNDER_REVIEW', 'EDD_UNDER_REVIEW', 'EDD_MLRO_APPROVED'].includes(stage);

  const currentCaseType: 'CDD' | 'EDD' = nextStep?.step === 'EDD' ? 'EDD' : 'CDD';
  const currentCaseCandidates = useMemo(
    () => cases.filter((item) => item.caseType === currentCaseType),
    [cases, currentCaseType],
  );
  const activeCase =
    currentCaseCandidates.find((item) => item.id === nextStep?.activeCaseId) ||
    currentCaseCandidates.find((item) => ['DRAFT', 'NEED_INFO', 'SUBMITTED'].includes(item.status)) ||
    currentCaseCandidates[0] ||
    null;

  const subjectLabel = (item: CaseItem) => {
    if (item.subjectKind === 'UBO_PERSON') {
      const ubo = onboarding?.uboProfiles?.find((u) => u.id === item.subjectRefId);
      return ubo?.fullName || 'UBO';
    }
    if (item.subjectKind === 'CORPORATE_ENTITY') {
      return onboarding?.corporateProfile?.companyName || onboarding?.companyName || 'Corporate Entity';
    }
    return profile?.firstName || profile?.lastName
      ? `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim()
      : 'Individual Customer';
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;
  if (!profile) return null;

  return (
    <div
      className={
        isModal
          ? 'fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm'
          : 'relative min-h-[calc(100vh-100px)] bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden'
      }
    >
      <motion.div
        initial={isModal ? { opacity: 0, scale: 0.95 } : { opacity: 1 }}
        animate={isModal ? { opacity: 1, scale: 1 } : { opacity: 1 }}
        className={
          isModal
            ? 'bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[820px] relative overflow-hidden flex flex-col'
            : 'h-full py-8 px-6 overflow-y-auto'
        }
      >
        {isModal && (
          <button
            onClick={closePanel}
            className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition-colors z-30"
          >
            <X size={20} />
          </button>
        )}

        <div className={isModal ? 'h-full overflow-y-auto p-6 space-y-6' : 'space-y-6 max-w-4xl mx-auto'}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-11 h-11 rounded-full flex items-center justify-center ${
                  approved
                    ? 'bg-green-100 text-green-600'
                    : rejected
                      ? 'bg-red-100 text-red-600'
                      : 'bg-blue-100 text-blue-600'
                }`}
              >
                {approved ? (
                  <CheckCircle2 size={22} />
                ) : inReview ? (
                  <Clock size={22} />
                ) : (
                  <ShieldCheck size={22} />
                )}
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Onboarding Center</h1>
                <p className="text-sm text-gray-500">
                  Current stage: {stage.replace(/_/g, ' ')} | Entity: {onboarding?.customerType || profile.customerType}
                </p>
              </div>
            </div>

            <button
              onClick={refreshAll}
              className="p-2 text-gray-500 hover:text-brand-primary"
              disabled={saving || casesLoading}
              title="Refresh"
            >
              <RefreshCw size={18} className={casesLoading ? 'animate-spin' : ''} />
            </button>
          </div>

          {message && (
            <div className="p-3 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-sm">{message}</div>
          )}

          {approved && (
            <div className="p-4 rounded-xl border border-green-200 bg-green-50 text-green-700 text-sm">
              Onboarding approved. Trading permissions are now enabled.
            </div>
          )}

          {nextStep && (
            <section className="rounded-xl border border-gray-200 p-4 space-y-3">
              <h2 className="font-semibold text-gray-900">Current Path</h2>
              <div className="text-sm text-gray-700">
                Step: <span className="font-semibold">{nextStep.step}</span>
              </div>
              {nextStep.blockedReason && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                  {nextStep.blockedReason}
                </div>
              )}
            </section>
          )}

          {nextStep?.step === 'ENTITY_INFO' && onboarding?.customerType === 'CORPORATE' && (
            <section className="rounded-xl border border-gray-200 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">Corporate Profile</h2>
                <button
                  onClick={saveEntity}
                  disabled={saving}
                  className="px-3 py-2 text-sm font-medium rounded-lg bg-brand-primary text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  Save Profile
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  value={corporateForm.companyName}
                  onChange={(e) => setCorporateForm((prev) => ({ ...prev, companyName: e.target.value }))}
                  placeholder="Company Name"
                  className="px-3 py-2 border border-gray-200 rounded-lg"
                />
                <input
                  value={corporateForm.registrationNo}
                  onChange={(e) =>
                    setCorporateForm((prev) => ({ ...prev, registrationNo: e.target.value }))
                  }
                  placeholder="Registration No"
                  className="px-3 py-2 border border-gray-200 rounded-lg"
                />
                <input
                  value={corporateForm.incorporationCountry}
                  onChange={(e) =>
                    setCorporateForm((prev) => ({ ...prev, incorporationCountry: e.target.value }))
                  }
                  placeholder="Incorporation Country"
                  className="px-3 py-2 border border-gray-200 rounded-lg"
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-gray-800">UBO List</h3>
                  <button
                    onClick={() => setUbos((prev) => [...prev, { ...emptyUbo }])}
                    className="text-sm px-2 py-1 rounded border border-gray-200 hover:bg-gray-50"
                  >
                    Add UBO
                  </button>
                </div>

                {ubos.map((ubo, index) => (
                  <div key={`${ubo.id || 'new'}-${index}`} className="grid grid-cols-1 md:grid-cols-5 gap-2">
                    <input
                      value={ubo.fullName}
                      onChange={(e) => {
                        const value = e.target.value;
                        setUbos((prev) => prev.map((item, i) => (i === index ? { ...item, fullName: value } : item)));
                      }}
                      placeholder="UBO Full Name"
                      className="px-3 py-2 border border-gray-200 rounded-lg"
                    />
                    <input
                      value={ubo.ownershipPercent}
                      onChange={(e) => {
                        const value = e.target.value;
                        setUbos((prev) =>
                          prev.map((item, i) => (i === index ? { ...item, ownershipPercent: value } : item)),
                        );
                      }}
                      placeholder="Ownership %"
                      className="px-3 py-2 border border-gray-200 rounded-lg"
                    />
                    <input
                      value={ubo.nationality}
                      onChange={(e) => {
                        const value = e.target.value;
                        setUbos((prev) =>
                          prev.map((item, i) => (i === index ? { ...item, nationality: value } : item)),
                        );
                      }}
                      placeholder="Nationality"
                      className="px-3 py-2 border border-gray-200 rounded-lg"
                    />
                    <label className="px-3 py-2 border border-gray-200 rounded-lg text-sm flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={ubo.pepFlag}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setUbos((prev) => prev.map((item, i) => (i === index ? { ...item, pepFlag: checked } : item)));
                        }}
                      />
                      PEP
                    </label>
                    <button
                      onClick={() => setUbos((prev) => prev.filter((_, i) => i !== index))}
                      disabled={ubos.length === 1}
                      className="px-3 py-2 border border-red-200 text-red-600 rounded-lg disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {nextStep?.step === 'CDD' && (
            <JourneyCasePanel
              title="CDD"
              item={activeCase}
              loading={casesLoading}
              saving={saving}
              subjectLabel={subjectLabel}
              onCreateSession={createSession}
              onMockComplete={mockComplete}
              onStart={() => bootstrapCdd('CDD journey initialized.')}
            />
          )}

          {nextStep?.step === 'EDD' && (
            <JourneyCasePanel
              title="EDD"
              item={activeCase}
              loading={casesLoading}
              saving={saving}
              subjectLabel={subjectLabel}
              onCreateSession={createSession}
              onMockComplete={mockComplete}
              onStart={() => Promise.resolve()}
            />
          )}

          {nextStep?.step === 'WAIT_REVIEW' && (
            <section className="rounded-xl border border-gray-200 p-4 space-y-3">
              <h2 className="font-semibold text-gray-900">Waiting For Review</h2>
              <p className="text-sm text-gray-600">
                Compliance is reviewing your {nextStep.requiresEdd ? 'EDD' : 'CDD'} case. Please refresh for latest status.
              </p>
              <CaseSummaryList items={cases} caseType={nextStep.requiresEdd ? 'EDD' : 'CDD'} />
            </section>
          )}

          {nextStep?.step === 'REINITIATE' && (
            <section className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-4">
              <h2 className="font-semibold text-red-900">Onboarding Rejected</h2>
              <p className="text-sm text-red-700">
                {nextStep.blockedReason || onboarding?.onboardingRejectReason || 'Please re-initiate verification.'}
              </p>
              <button
                onClick={() => bootstrapCdd('New CDD journey created. Please continue verification.')}
                disabled={saving}
                className="px-3 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              >
                Re-initiate CDD
              </button>
            </section>
          )}

          {!approved && (
            <div className="p-4 rounded-xl border border-yellow-200 bg-yellow-50 text-yellow-700 text-sm flex gap-2">
              <AlertCircle size={16} className="mt-0.5" />
              <div>
                Trading stays blocked until onboarding reaches <span className="font-semibold">ONBOARDING_APPROVED</span>.
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

const JourneyCasePanel = ({
  title,
  item,
  loading,
  saving,
  subjectLabel,
  onCreateSession,
  onMockComplete,
  onStart,
}: {
  title: 'CDD' | 'EDD';
  item: CaseItem | null;
  loading: boolean;
  saving: boolean;
  subjectLabel: (item: CaseItem) => string;
  onCreateSession: (item: CaseItem) => Promise<void>;
  onMockComplete: (sessionId: string) => Promise<void>;
  onStart: () => Promise<void>;
}) => {
  if (loading) {
    return (
      <section className="rounded-xl border border-gray-200 p-4 text-sm text-gray-500">
        Loading {title} case...
      </section>
    );
  }

  if (!item) {
    return (
      <section className="rounded-xl border border-gray-200 p-4 space-y-3">
        <h2 className="font-semibold text-gray-900">{title} Verification</h2>
        <p className="text-sm text-gray-600">No active {title} case found.</p>
        {title === 'CDD' && (
          <button
            onClick={onStart}
            disabled={saving}
            className="px-3 py-2 text-sm font-medium rounded-lg bg-brand-primary text-white hover:bg-blue-700 disabled:opacity-60"
          >
            Start CDD
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-gray-200 p-4 space-y-3">
      <h2 className="font-semibold text-gray-900">{title} Verification</h2>
      <div className="border border-gray-200 rounded-lg p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-gray-900">{item.caseNo}</div>
            <div className="text-xs text-gray-500">
              Subject: {subjectLabel(item)} ({item.subjectKind})
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700">{item.status}</span>
            <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700">
              Provider: {item.providerStatus || 'NOT_STARTED'}
            </span>
          </div>
        </div>

        {item.latestSession?.qrCodeUrl && (
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="p-2 border border-gray-200 rounded-lg bg-white w-fit">
              <QRCodeSVG value={item.latestSession.qrCodeUrl} size={96} />
            </div>
            <div className="text-xs text-gray-600 space-y-1">
              <div>Session: {item.latestSession.providerSessionId}</div>
              <div>Status: {item.latestSession.status}</div>
              <div>Expires: {new Date(item.latestSession.expiresAt).toLocaleString()}</div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onCreateSession(item)}
            disabled={saving}
            className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-60"
          >
            Create QR Session
          </button>
          {item.latestSession?.status === 'PENDING' && (
            <button
              onClick={() => onMockComplete(item.latestSession!.id)}
              disabled={saving}
              className="px-3 py-1.5 text-xs rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-60"
            >
              Mock Complete Scan
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
    return <div className="text-sm text-gray-500">No {caseType} cases.</div>;
  }

  return (
    <div className="space-y-2">
      {filtered.map((item) => (
        <div key={item.id} className="border border-gray-200 rounded-lg px-3 py-2 text-sm flex justify-between gap-2">
          <span className="font-medium text-gray-800">{item.caseNo}</span>
          <span className="text-gray-500">{item.status}</span>
        </div>
      ))}
    </div>
  );
};

export default Verification;
