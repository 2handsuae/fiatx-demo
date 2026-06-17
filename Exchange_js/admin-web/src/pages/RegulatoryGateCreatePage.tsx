import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, RefreshCw, Save, ShieldPlus } from 'lucide-react';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { toIsoDateTime, toPrettyJson } from '../components/governance/governanceUtils';
import { getRegistryDetailPath } from './governanceRegistryConfig';

type GateType =
  | 'CONTROL_CHANGE'
  | 'REGULATED_APPOINTMENT_CHANGE'
  | 'CLIENT_BANK_ACCOUNT_ENABLEMENT';
type SubjectType =
  | 'SHAREHOLDING_REGISTRY_VERSION'
  | 'APPOINTMENT_RECORD'
  | 'WALLET';

type SubjectOption = {
  id: string;
  subjectNo: string;
  summary: string;
};

const GATE_TYPE_OPTIONS: GateType[] = [
  'CONTROL_CHANGE',
  'REGULATED_APPOINTMENT_CHANGE',
  'CLIENT_BANK_ACCOUNT_ENABLEMENT',
];

const parseMetadataJson = (value: string) => {
  const normalized = value.trim();
  if (!normalized) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error('Metadata JSON must be a valid JSON object.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Metadata JSON must be a JSON object.');
  }

  return parsed as Record<string, unknown>;
};

const deriveGateType = (subjectType: string | null): GateType | '' => {
  if (subjectType === 'SHAREHOLDING_REGISTRY_VERSION') return 'CONTROL_CHANGE';
  if (subjectType === 'APPOINTMENT_RECORD') return 'REGULATED_APPOINTMENT_CHANGE';
  if (subjectType === 'WALLET') return 'CLIENT_BANK_ACCOUNT_ENABLEMENT';
  return '';
};

const RegulatoryGateCreatePage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefilledSubjectType = searchParams.get('subjectType');
  const prefilledSubjectId = searchParams.get('subjectId');
  const prefilledSubjectNo = searchParams.get('subjectNo');
  const prefilledGateType =
    (searchParams.get('gateType') as GateType | null) || deriveGateType(prefilledSubjectType);

  const lockedSubject =
    Boolean(prefilledSubjectId) &&
    (prefilledSubjectType === 'SHAREHOLDING_REGISTRY_VERSION' ||
      prefilledSubjectType === 'APPOINTMENT_RECORD' ||
      prefilledSubjectType === 'WALLET');

  const [formData, setFormData] = useState({
    gateType: GATE_TYPE_OPTIONS.includes(prefilledGateType as GateType)
      ? (prefilledGateType as GateType)
      : ('CONTROL_CHANGE' as GateType),
    authority: 'VARA',
    scopeSummary: '',
    linkedApprovalId: '',
    proposedEffectiveAt: '',
    metadataJson: '{}',
    traceId: '',
    subjectId: prefilledSubjectId || '',
    subjectNo: prefilledSubjectNo || '',
  });
  const [subjectOptions, setSubjectOptions] = useState<SubjectOption[]>([]);
  const [subjectLoading, setSubjectLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const metadataPreview = useMemo(() => {
    try {
      return toPrettyJson(parseMetadataJson(formData.metadataJson));
    } catch {
      return 'Invalid JSON object';
    }
  }, [formData.metadataJson]);

  const activeSubjectType: SubjectType =
    formData.gateType === 'CONTROL_CHANGE'
      ? 'SHAREHOLDING_REGISTRY_VERSION'
      : formData.gateType === 'REGULATED_APPOINTMENT_CHANGE'
        ? 'APPOINTMENT_RECORD'
        : 'WALLET';

  const backPath = useMemo(() => {
    if (lockedSubject && prefilledSubjectId && prefilledSubjectType === 'SHAREHOLDING_REGISTRY_VERSION') {
      return getRegistryDetailPath('shareholding-versions', prefilledSubjectId);
    }
    if (lockedSubject && prefilledSubjectId && prefilledSubjectType === 'APPOINTMENT_RECORD') {
      return getRegistryDetailPath('appointments', prefilledSubjectId);
    }
    if (lockedSubject && prefilledSubjectId && prefilledSubjectType === 'WALLET') {
      return `/dashboard/treasury/wallets/${prefilledSubjectId}`;
    }
    return '/admin/registries/regulatory-gates';
  }, [lockedSubject, prefilledSubjectId, prefilledSubjectType]);

  useEffect(() => {
    if (lockedSubject) {
      return;
    }

    const fetchCandidates = async () => {
      setSubjectLoading(true);
      setError(null);
      try {
        const endpoint =
          formData.gateType === 'CONTROL_CHANGE'
            ? `${import.meta.env.VITE_API_URL}/admin/governance/registries/shareholding-versions?take=200`
            : formData.gateType === 'REGULATED_APPOINTMENT_CHANGE'
              ? `${import.meta.env.VITE_API_URL}/admin/governance/registries/appointments?take=200`
              : `${import.meta.env.VITE_API_URL}/wallets?take=200&walletRole=CUST_BANK`;
        const response = await adminFetch(endpoint);
        if (!response.ok) {
          throw new Error(await getApiErrorMessage(response, 'Failed to load registry candidates.'));
        }

        const result = (await response.json()) as { items?: Array<Record<string, unknown>> };
        const items = Array.isArray(result.items) ? result.items : [];
        const nextOptions =
          formData.gateType === 'CONTROL_CHANGE'
            ? items.map((item) => ({
                id: String(item.id),
                subjectNo: String(item.registryNo || item.subjectNo || item.id),
                summary: `${String(item.versionLabel || 'Unlabeled version')} · ${String(item.status || '-')}`,
              }))
            : formData.gateType === 'REGULATED_APPOINTMENT_CHANGE'
              ? items
                  .filter((item) => Boolean(item.regulatedFlag))
                  .map((item) => ({
                    id: String(item.id),
                    subjectNo: String(item.appointmentNo || item.subjectNo || item.id),
                    summary: `${String(item.roleType || 'Role')} · ${String(item.personName || 'Unknown person')}`,
                  }))
                : items.map((item) => ({
                    id: String(item.id),
                    subjectNo: String(item.walletNo || item.subjectNo || item.id),
                    summary: `${String(item.walletRole || 'Wallet')} · ${String(((item.asset as { code?: string } | undefined)?.code) || item.assetId || '-')}`,
                  }));
        setSubjectOptions(nextOptions);
        setFormData((prev) => ({
          ...prev,
          subjectId: nextOptions.some((option) => option.id === prev.subjectId) ? prev.subjectId : '',
          subjectNo: nextOptions.find((option) => option.id === prev.subjectId)?.subjectNo || '',
        }));
      } catch (e: unknown) {
        if (e instanceof AdminSessionError) return;
        setError(e instanceof Error ? e.message : 'Failed to load registry candidates.');
        setSubjectOptions([]);
      } finally {
        setSubjectLoading(false);
      }
    };

    void fetchCandidates();
  }, [formData.gateType, lockedSubject]);

  const handleGateTypeChange = (gateType: GateType) => {
    setFormData((prev) => ({
      ...prev,
      gateType,
      subjectId: '',
      subjectNo: '',
    }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!formData.subjectId.trim()) {
      setError('A linked governance registry subject is required.');
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        gateType: formData.gateType,
        authority: formData.authority,
        metadataJson: parseMetadataJson(formData.metadataJson),
      };

      if (formData.scopeSummary.trim()) payload.scopeSummary = formData.scopeSummary.trim();
      if (formData.linkedApprovalId.trim()) payload.linkedApprovalId = formData.linkedApprovalId.trim();
      const proposedEffectiveAt = toIsoDateTime(formData.proposedEffectiveAt);
      if (proposedEffectiveAt) payload.proposedEffectiveAt = proposedEffectiveAt;
      if (formData.traceId.trim()) payload.traceId = formData.traceId.trim();

      if (formData.gateType === 'CONTROL_CHANGE') {
        payload.shareholdingRegistryVersionId = formData.subjectId;
      } else if (formData.gateType === 'REGULATED_APPOINTMENT_CHANGE') {
        payload.appointmentRecordId = formData.subjectId;
      } else {
        payload.walletId = formData.subjectId;
      }

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/governance/regulatory-gates`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to create regulatory gate.'));
      }

      const created = (await response.json()) as { id: string };
      navigate(`/admin/registries/regulatory-gates/${created.id}`);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to create regulatory gate.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate(backPath)}
          className="rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Create Regulatory Gate</h1>
          <p className="mt-1 text-sm text-gray-500">
            Create a regulatory gate and let the back end enforce filing, receipt, and effectiveness rules.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error ? (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="rounded-xl border border-admin-border bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-2">
            <ShieldPlus size={18} className="text-brand-primary" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Gate Basics</h2>
              <p className="mt-1 text-sm text-gray-500">
                Select the gate type, bind the correct subject, and keep optional trace fields explicit.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Gate Type <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.gateType}
                onChange={(event) => handleGateTypeChange(event.target.value as GateType)}
                disabled={lockedSubject}
                className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20 disabled:bg-gray-50 disabled:text-gray-500"
              >
                {GATE_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Authority</label>
              <input
                value={formData.authority}
                onChange={(event) =>
                  setFormData((prev) => ({ ...prev, authority: event.target.value }))
                }
                className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="block text-sm font-medium text-gray-700">
                Linked Subject <span className="text-red-500">*</span>
              </label>
              {lockedSubject ? (
                <div className="rounded-lg border border-admin-border bg-gray-50 px-4 py-3 text-sm text-gray-700">
                  <div className="font-mono text-xs text-brand-primary">{formData.subjectNo || formData.subjectId}</div>
                  <div className="mt-1 text-xs text-gray-500">{activeSubjectType}</div>
                </div>
              ) : subjectLoading ? (
                <div className="flex items-center gap-2 rounded-lg border border-admin-border bg-gray-50 px-4 py-3 text-sm text-gray-500">
                  <RefreshCw size={16} className="animate-spin" />
                  Loading eligible registry candidates...
                </div>
              ) : (
                <select
                  value={formData.subjectId}
                  onChange={(event) => {
                    const nextSubject = subjectOptions.find(
                      (option) => option.id === event.target.value,
                    );
                    setFormData((prev) => ({
                      ...prev,
                      subjectId: event.target.value,
                      subjectNo: nextSubject?.subjectNo || '',
                    }));
                  }}
                  className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
                >
                  <option value="">Select a subject</option>
                  {subjectOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.subjectNo} - {option.summary}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="block text-sm font-medium text-gray-700">Scope Summary</label>
              <textarea
                value={formData.scopeSummary}
                onChange={(event) =>
                  setFormData((prev) => ({ ...prev, scopeSummary: event.target.value }))
                }
                rows={4}
                className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Linked Approval Id</label>
              <input
                value={formData.linkedApprovalId}
                onChange={(event) =>
                  setFormData((prev) => ({ ...prev, linkedApprovalId: event.target.value }))
                }
                className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Proposed Effective At</label>
              <input
                type="datetime-local"
                value={formData.proposedEffectiveAt}
                onChange={(event) =>
                  setFormData((prev) => ({ ...prev, proposedEffectiveAt: event.target.value }))
                }
                className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
              />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-admin-border bg-white p-6 shadow-sm">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-gray-900">Traceability</h2>
            <p className="mt-1 text-sm text-gray-500">
              Keep metadata and trace identifiers explicit so the gate demo remains easy to inspect in audit logs.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Metadata JSON</label>
              <textarea
                value={formData.metadataJson}
                onChange={(event) =>
                  setFormData((prev) => ({ ...prev, metadataJson: event.target.value }))
                }
                rows={8}
                className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Trace ID</label>
              <input
                value={formData.traceId}
                onChange={(event) =>
                  setFormData((prev) => ({ ...prev, traceId: event.target.value }))
                }
                className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:border-brand-primary focus:outline-none focus:ring-1 focus:ring-brand-primary/20"
              />
              <div className="rounded-lg border border-admin-border bg-gray-50 px-4 py-3 text-xs text-gray-500">
                Default metadata preview:
                <pre className="mt-2 overflow-auto text-[11px] text-gray-700">{metadataPreview}</pre>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-admin-border pt-4">
          <button
            type="button"
            onClick={() => navigate(backPath)}
            className="rounded-lg border border-admin-border bg-white px-4 py-2 text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-6 py-2 text-white hover:bg-brand-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <Save size={16} />
            )}
            Create Gate
          </button>
        </div>
      </form>
    </div>
  );
};

export default RegulatoryGateCreatePage;
