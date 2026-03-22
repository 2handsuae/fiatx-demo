import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import {
  ActionSection,
  DetailCard,
  DetailPageHeader,
  InfoField,
  JsonBlock,
} from '../components/compliance/DetailPageComponents';

type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type AlertStatus = 'OPEN' | 'ASSIGNED' | 'ESCALATED' | 'CLOSED';
type RecommendedDecision = 'CLEAR' | 'REJECT' | 'REQUIRE_EDD';
type AlertDispositionCode =
  | 'ESCALATE_TO_CASE'
  | 'FALSE_POSITIVE'
  | 'RESOLVED_BY_WORKFLOW';
type AlertAction = 'ASSIGN' | 'REASSIGN' | 'ESCALATE_TO_CASE' | 'FALSE_POSITIVE';
type WorkflowAction = RecommendedDecision;

interface AlertEvent {
  id: string;
  eventType: string;
  eventAt: string;
  actorType: string;
  actorNo?: string | null;
  actorRole?: string | null;
  note?: string | null;
  payload?: unknown;
}

interface DispositionRecord {
  id: string;
  dispositionCode: AlertDispositionCode | string;
  decision?: string | null;
  reason?: string | null;
  isFinal?: boolean;
  actorNo?: string | null;
  actorRole?: string | null;
  source?: string | null;
  sourceRefId?: string | null;
  createdAt: string;
}

interface AlertDetail {
  id: string;
  alertNo: string;
  workflow?: string | null;
  stage?: string | null;
  rule?: string | null;
  ruleCode: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string;
  sourceModule: string;
  sourceType: string;
  sourceId: string;
  sourceNo?: string | null;
  customerNo?: string | null;
  entityType?: string | null;
  entityNo?: string | null;
  assigneeUserId?: string | null;
  assigneeUserNo?: string | null;
  decisionRecommendation?: string | null;
  decision?: string | null;
  recommendedDecisions?: string[];
  reasonCodes?: string[];
  hitCount: number;
  dueAt: string;
  overdueMarkedAt?: string | null;
  lastOccurredAt: string;
  closedAt?: string | null;
  currentDispositionCode?: AlertDispositionCode | string | null;
  currentDispositionReason?: string | null;
  currentDispositionAt?: string | null;
  finalDispositionCode?: AlertDispositionCode | string | null;
  finalDispositionReason?: string | null;
  finalDispositionAt?: string | null;
  metadata?: unknown;
  linkedCaseIds?: string[] | null;
  decisionRecordIds?: string[] | null;
  dispositionHistory?: DispositionRecord[];
  availableAlertActions?: AlertAction[];
  availableWorkflowActions?: WorkflowAction[];
  events: AlertEvent[];
}

interface CaseFromAlertResponse {
  id: string;
  caseNo?: string;
}

interface OnboardingAlertDecisionResponse {
  alert: AlertDetail;
  customer: {
    id: string;
    onboardingStatus?: string | null;
    operatingStatus?: string | null;
  };
  eddResponse?: {
    id: string;
    responseNo?: string | null;
  } | null;
}

interface UserListItem {
  id: string;
  userNo: string;
  email: string;
  status: string;
}

interface ProviderResponseLink {
  label: string;
  path: string;
  description: string;
}

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
};

const normalizeActionList = <T extends string>(value: unknown): T[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim().toUpperCase())
    .filter(Boolean) as T[];
};

const normalizeRecommendedDecisions = (values?: string[]): RecommendedDecision[] => {
  const allowed = new Set<RecommendedDecision>(['CLEAR', 'REJECT', 'REQUIRE_EDD']);
  const normalized = Array.isArray(values)
    ? values
        .map((item) => String(item || '').trim().toUpperCase())
        .filter((item): item is RecommendedDecision =>
          allowed.has(item as RecommendedDecision),
        )
    : [];
  return Array.from(new Set(normalized));
};

const getMetadataRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const getOnboardingDecisionSummary = (customer: {
  onboardingStatus?: string | null;
  operatingStatus?: string | null;
}) => {
  const onboardingStatus = String(customer.onboardingStatus || '').trim().toUpperCase();
  const operatingStatus = String(customer.operatingStatus || '').trim().toUpperCase();

  if (onboardingStatus === 'APPROVED' && operatingStatus === 'ACTIVE') return 'active onboarding';
  if (onboardingStatus === 'FINAL_APPROVAL') return 'final approval';
  if (onboardingStatus === 'PENDING_EDD_INPUT') return 'EDD input';
  if (onboardingStatus === 'EDD_UNDER_REVIEW') return 'EDD review';
  if (onboardingStatus === 'CDD_UNDER_REVIEW') return 'CDD review';
  if (onboardingStatus === 'REJECTED') return 'rejected';
  if (onboardingStatus === 'WITHDRAWN') return 'withdrawn';
  if (onboardingStatus === 'PENDING_CDD_INPUT') return 'CDD input';
  return onboardingStatus || 'updated onboarding state';
};

const getProviderResponseLink = (detail: AlertDetail): ProviderResponseLink | null => {
  const metadata = getMetadataRecord(detail.metadata);
  const contextType = String(metadata.contextType || '').trim().toUpperCase();

  if (contextType === 'ONBOARDING_EDD') {
    return {
      label: 'EDD Evidence',
      path: '/dashboard/compliance/edd-responses',
      description: 'Read-only provider response container for onboarding EDD evidence.',
    };
  }

  if (contextType === 'ONBOARDING_CDD' || detail.ruleCode.startsWith('ONB_')) {
    return {
      label: 'CDD Evidence',
      path: '/dashboard/compliance/cdd-responses',
      description: 'Read-only provider response container for onboarding CDD evidence.',
    };
  }

  return null;
};

const getSeverityClass = (severity: AlertSeverity) => {
  if (severity === 'CRITICAL') return 'bg-red-100 text-red-800';
  if (severity === 'HIGH') return 'bg-orange-100 text-orange-800';
  if (severity === 'MEDIUM') return 'bg-yellow-100 text-yellow-800';
  return 'bg-gray-100 text-gray-700';
};

const getStatusClass = (status: AlertStatus) => {
  if (status === 'OPEN') return 'bg-blue-100 text-blue-800';
  if (status === 'ASSIGNED') return 'bg-indigo-100 text-indigo-800';
  if (status === 'ESCALATED') return 'bg-orange-100 text-orange-800';
  return 'bg-gray-200 text-gray-800';
};

const alertActionLabelMap: Record<AlertAction, string> = {
  ASSIGN: 'Assign',
  REASSIGN: 'Reassign',
  ESCALATE_TO_CASE: 'Escalate to Case',
  FALSE_POSITIVE: 'False Positive',
};

const workflowActionLabelMap: Record<WorkflowAction, string> = {
  CLEAR: 'Clear',
  REJECT: 'Reject',
  REQUIRE_EDD: 'Require EDD',
};

const ComplianceAlertDetailPage = () => {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { session, hasPermission } = useAdminSession();

  const [detail, setDetail] = useState<AlertDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [acting, setActing] = useState<string | null>(null);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignCandidates, setAssignCandidates] = useState<UserListItem[]>([]);
  const [assignCandidatesLoading, setAssignCandidatesLoading] = useState(false);
  const [assignCandidatesError, setAssignCandidatesError] = useState('');
  const [selectedAssigneeUserId, setSelectedAssigneeUserId] = useState('');
  const [lastEscalatedCase, setLastEscalatedCase] = useState<CaseFromAlertResponse | null>(null);

  const canWriteAlerts = hasPermission(PERMISSIONS.ALERTS_WRITE);
  const canWriteCases = hasPermission(PERMISSIONS.CASES_WRITE);
  const canReadRiskDecisionRecords = hasPermission(PERMISSIONS.RISK_DECISION_RECORDS_READ);
  const from = new URLSearchParams(location.search).get('from') || '/dashboard/compliance/alerts';

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/alerts/${id}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load alert detail.'));
      }
      setDetail((await response.json()) as AlertDetail);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load alert detail.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
  }, [id]);

  const fetchAssignCandidates = async (): Promise<UserListItem[]> => {
    const response = await adminFetch(`${import.meta.env.VITE_API_URL}/users?take=200`);
    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, 'Failed to load assignees.'));
    }
    const payload = (await response.json()) as UserListItem[];
    const users = Array.isArray(payload) ? payload : [];
    return users
      .filter((item) => item.status === 'ACTIVE')
      .sort((a, b) => (a.userNo || '').localeCompare(b.userNo || ''));
  };

  const openAssignModal = async () => {
    if (!detail) return;
    setAssignModalOpen(true);
    setAssignCandidatesLoading(true);
    setAssignCandidatesError('');

    try {
      const candidates = await fetchAssignCandidates();
      setAssignCandidates(candidates);
      setSelectedAssigneeUserId(detail.assigneeUserId || session?.id || candidates[0]?.id || '');
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setAssignCandidatesError(
        e instanceof Error ? e.message : 'Failed to load assignees.',
      );
      setSelectedAssigneeUserId('');
    } finally {
      setAssignCandidatesLoading(false);
    }
  };

  const submitAssign = async () => {
    if (!detail || !selectedAssigneeUserId) return;
    setActing('ASSIGN');
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/alerts/${detail.id}/action`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'ASSIGN',
            assigneeUserId: selectedAssigneeUserId,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Assign failed.'));
      }
      setDetail((await response.json()) as AlertDetail);
      setAssignModalOpen(false);
      setMessage('Assignee updated.');
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Assign failed.');
    } finally {
      setActing(null);
    }
  };

  const applyOnboardingDecision = async (
    decision: RecommendedDecision,
    options?: { alertOutcome?: 'FALSE_POSITIVE' },
  ) => {
    if (!detail) return;
    if (!detail.assigneeUserId) {
      setError('Current alert has no assignee.');
      return;
    }

    const reasonInput =
      decision === 'REJECT' || options?.alertOutcome === 'FALSE_POSITIVE'
        ? window.prompt('Reason (optional)', '') || ''
        : '';

    setActing(decision);
    setError('');
    setMessage('');
    setLastEscalatedCase(null);
    try {
      const isPeriodicReview =
        String(detail.workflow || '').trim().toUpperCase() === 'PERIODIC_REVIEW';
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/alerts/${detail.id}/${
          isPeriodicReview ? 'periodic-review-decision' : 'onboarding-decision'
        }`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision,
            alertOutcome: options?.alertOutcome,
            reason: reasonInput.trim() || undefined,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(
            response,
            isPeriodicReview
              ? 'Failed to apply periodic review decision.'
              : 'Failed to apply onboarding decision.',
          ),
        );
      }
      const data = (await response.json()) as OnboardingAlertDecisionResponse;
      setDetail(data.alert);
      if (options?.alertOutcome === 'FALSE_POSITIVE') {
        setMessage(
          `False positive recorded. ${
            isPeriodicReview ? 'Periodic review' : 'Onboarding'
          } moved to ${getOnboardingDecisionSummary(data.customer)}.`,
        );
      } else if (decision === 'REQUIRE_EDD' && data.eddResponse?.responseNo) {
        setMessage(
          `Decision applied. ${
            isPeriodicReview ? 'Periodic review' : 'Onboarding'
          } moved to ${getOnboardingDecisionSummary(data.customer)}. EDD response ${data.eddResponse.responseNo} created.`,
        );
      } else {
        setMessage(
          `Decision applied. ${
            isPeriodicReview ? 'Periodic review' : 'Onboarding'
          } moved to ${getOnboardingDecisionSummary(data.customer)}.`,
        );
      }
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to apply onboarding decision.');
    } finally {
      setActing(null);
    }
  };

  const handleAlertAction = async (action: AlertAction) => {
    if (!detail) return;
    if (action === 'ASSIGN' || action === 'REASSIGN') {
      await openAssignModal();
      return;
    }
    if (action === 'ESCALATE_TO_CASE') {
      setActing(action);
      setError('');
      setMessage('');
      setLastEscalatedCase(null);
      try {
        const reason = window.prompt('Escalation reason', '') || '';
        if (!reason.trim()) {
          throw new Error('Escalation requires a reason.');
        }
        const response = await adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/compliance/cases/from-alert/${detail.id}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: reason.trim() }),
          },
        );
        if (!response.ok) {
          throw new Error(await getApiErrorMessage(response, 'Escalation failed.'));
        }
        const data = (await response.json()) as CaseFromAlertResponse;
        setLastEscalatedCase(data);
        setMessage(
          data.caseNo
            ? `Case ${data.caseNo} created. Continue investigation in the cases queue.`
            : 'Case created. Continue investigation in the cases queue.',
        );
        await fetchDetail();
      } catch (e: unknown) {
        if (e instanceof AdminSessionError) return;
        setError(e instanceof Error ? e.message : 'Escalation failed.');
      } finally {
        setActing(null);
      }
      return;
    }
    if (action === 'FALSE_POSITIVE') {
      await applyOnboardingDecision('CLEAR', { alertOutcome: 'FALSE_POSITIVE' });
    }
  };

  const handleWorkflowAction = async (decision: WorkflowAction) => {
    await applyOnboardingDecision(decision);
  };

  const alertActions =
    detail && canWriteAlerts
      ? normalizeActionList<AlertAction>(detail.availableAlertActions).filter(
          (action) => action !== 'ESCALATE_TO_CASE' || canWriteCases,
        )
      : [];
  const workflowActions =
    detail && canWriteAlerts
      ? normalizeActionList<WorkflowAction>(detail.availableWorkflowActions)
      : [];
  const recommendedDecisions = normalizeRecommendedDecisions(detail?.recommendedDecisions);
  const providerResponseLink = detail ? getProviderResponseLink(detail) : null;
  const decisionRecordIds = normalizeStringList(detail?.decisionRecordIds);
  const linkedCaseIds = normalizeStringList(detail?.linkedCaseIds);
  const reasonCodes = normalizeStringList(detail?.reasonCodes);

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center text-sm text-gray-500">
        Loading alert detail...
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="space-y-6">
        <DetailPageHeader
          title="Alert Detail"
          subtitle={id}
          onBack={() => navigate(from)}
          onRefresh={() => void fetchDetail()}
        />
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div className="space-y-6">
      <DetailPageHeader
        title="Alert Detail"
        subtitle={detail.alertNo}
        onBack={() => navigate(from)}
        onRefresh={() => void fetchDetail()}
      >
        {lastEscalatedCase ? (
          <button
            onClick={() =>
              navigate(
                `/dashboard/compliance/cases/${lastEscalatedCase.id}?from=${encodeURIComponent(
                  `${location.pathname}${location.search}`,
                )}`,
              )
            }
            className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Open Case
          </button>
        ) : null}
      </DetailPageHeader>

      {message ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <DetailCard title="Overview">
        <InfoField label="Alert No" value={detail.alertNo} mono />
        <InfoField label="Title" value={detail.title} />
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-gray-500">Severity</div>
          <div className="mt-1">
            <span className={`inline-flex px-2 py-1 rounded-full text-xs ${getSeverityClass(detail.severity)}`}>
              {detail.severity}
            </span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-gray-500">Status</div>
          <div className="mt-1">
            <span className={`inline-flex px-2 py-1 rounded-full text-xs ${getStatusClass(detail.status)}`}>
              {detail.status}
            </span>
          </div>
        </div>
        <InfoField label="Workflow" value={detail.workflow || 'ONBOARDING'} />
        <InfoField label="Stage" value={detail.stage || '-'} />
        <InfoField label="Rule" value={detail.rule || detail.ruleCode} />
        <InfoField label="Recommendation" value={detail.decisionRecommendation || '-'} />
        <InfoField label="Decision" value={detail.decision || '-'} />
      </DetailCard>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <DetailCard title="Source Context" columns={2}>
          <InfoField label="Module" value={detail.sourceModule} />
          <InfoField label="Source Type" value={detail.sourceType} />
          <InfoField label="Source" value={detail.sourceNo || detail.sourceId} mono />
          <InfoField label="Entity" value={detail.entityNo || detail.entityType || '-'} />
          <InfoField label="Customer" value={detail.customerNo || '-'} />
          <InfoField label="Reason Codes" value={reasonCodes.join(', ') || '-'} />
          <InfoField label="Hit Count" value={detail.hitCount} />
          <InfoField label="Message" value={detail.message} />
        </DetailCard>

        <DetailCard title="Lifecycle" columns={2}>
          <InfoField label="Due" value={formatDateTime(detail.dueAt)} />
          <InfoField label="Overdue Flagged At" value={formatDateTime(detail.overdueMarkedAt)} />
          <InfoField label="Last Seen" value={formatDateTime(detail.lastOccurredAt)} />
          <InfoField label="Assignee" value={detail.assigneeUserNo || '-'} />
          <InfoField label="Closed At" value={formatDateTime(detail.closedAt)} />
          <InfoField label="Recommended Decisions" value={recommendedDecisions.join(', ') || '-'} />
        </DetailCard>
      </div>

      <DetailCard title="Evidence & Linked Objects" columns={2}>
        <div className="min-w-0 space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Provider Response</div>
            <div className="mt-1 text-sm text-gray-900 font-medium">
              {providerResponseLink?.label || 'No mapped provider response page'}
            </div>
            <div className="mt-1 text-sm text-gray-500">
              {providerResponseLink?.description ||
                'This alert does not currently map to a dedicated provider response page.'}
            </div>
          </div>
          {providerResponseLink ? (
            <button
              onClick={() => navigate(providerResponseLink.path)}
              className="inline-flex items-center rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Open Evidence Page
            </button>
          ) : null}
        </div>

        <div className="min-w-0 space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Risk Engine Trace</div>
            <div className="mt-1 text-sm text-gray-900 font-medium">
              {decisionRecordIds.join(', ') || 'No linked decision records'}
            </div>
            <div className="mt-1 text-sm text-gray-500">
              Review canonical decision record payloads in Risk Policy Executions.
            </div>
          </div>
          <button
            onClick={() => navigate('/dashboard/risk/policy-executions')}
            disabled={!canReadRiskDecisionRecords}
            className={`inline-flex items-center rounded-lg border px-4 py-2 text-sm ${
              canReadRiskDecisionRecords
                ? 'border-admin-border bg-white text-gray-700 hover:bg-gray-50'
                : 'border-gray-200 bg-gray-50 text-gray-400'
            }`}
          >
            Open Risk Policy Executions
          </button>
        </div>

        <div className="min-w-0 xl:col-span-2">
          <div className="text-xs uppercase tracking-wide text-gray-500">Linked Cases</div>
          {linkedCaseIds.length === 0 ? (
            <div className="mt-1 text-sm text-gray-500">No linked cases.</div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {linkedCaseIds.map((caseId) => (
                <button
                  key={caseId}
                  onClick={() =>
                    navigate(
                      `/dashboard/compliance/cases/${caseId}?from=${encodeURIComponent(
                        `${location.pathname}${location.search}`,
                      )}`,
                    )
                  }
                  className="inline-flex items-center rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  {caseId}
                </button>
              ))}
            </div>
          )}
        </div>
      </DetailCard>

      <DetailCard title="Disposition" columns={2}>
        <InfoField label="Current Code" value={detail.currentDispositionCode || '-'} />
        <InfoField label="Current Reason" value={detail.currentDispositionReason || '-'} />
        <InfoField label="Current At" value={formatDateTime(detail.currentDispositionAt)} />
        <InfoField label="Final Code" value={detail.finalDispositionCode || '-'} />
        <InfoField label="Final Reason" value={detail.finalDispositionReason || '-'} />
        <InfoField label="Final At" value={formatDateTime(detail.finalDispositionAt)} />
      </DetailCard>

      <ActionSection
        title="Alert Actions"
        description="Alert actions control alert state and triage outcome."
        emptyText="No alert actions available in the current alert status."
      >
        {alertActions.length === 0 ? (
          <div className="text-sm text-gray-500">No alert actions available in the current alert status.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {alertActions.map((action) => (
              <button
                key={action}
                onClick={() => {
                  void handleAlertAction(action);
                }}
                disabled={acting !== null || assignCandidatesLoading}
                className="rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {acting === action ? 'Processing...' : alertActionLabelMap[action]}
              </button>
            ))}
          </div>
        )}
      </ActionSection>

      <ActionSection
        title="Workflow Actions"
        description="Workflow actions move the embedded review workflow forward."
        emptyText="No workflow actions available in the current workflow stage."
      >
        {workflowActions.length === 0 ? (
          <div className="text-sm text-gray-500">No workflow actions available in the current workflow stage.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {workflowActions.map((decision) => (
              <button
                key={decision}
                onClick={() => {
                  void handleWorkflowAction(decision);
                }}
                disabled={acting !== null}
                className="rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {acting === decision ? 'Processing...' : workflowActionLabelMap[decision]}
              </button>
            ))}
          </div>
        )}
      </ActionSection>

      <DetailCard title="Audit" columns={2}>
        <JsonBlock title="Disposition History" value={detail.dispositionHistory || []} compact />
        <JsonBlock title="Metadata" value={detail.metadata} compact />
        <div className="xl:col-span-2">
          <JsonBlock title="Event Timeline" value={detail.events || []} />
        </div>
      </DetailCard>

      {assignModalOpen ? (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white rounded-xl shadow-xl border border-admin-border">
            <div className="px-4 py-3 border-b border-admin-border flex items-center justify-between">
              <div>
                <h4 className="text-base font-semibold text-gray-900">
                  {detail.status === 'ASSIGNED' ? 'Reassign Alert' : 'Assign Alert'}
                </h4>
                <p className="text-xs text-gray-500">{detail.alertNo}</p>
              </div>
              <button
                onClick={() => setAssignModalOpen(false)}
                className="p-2 text-gray-500 hover:text-gray-700"
                disabled={acting === 'ASSIGN'}
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-3">
              {assignCandidatesLoading ? (
                <div className="text-sm text-gray-500">Loading assignees...</div>
              ) : (
                <>
                  <label className="block text-sm text-gray-700">Assignee</label>
                  <select
                    className="w-full border border-admin-border rounded px-3 py-2 text-sm"
                    value={selectedAssigneeUserId}
                    onChange={(e) => setSelectedAssigneeUserId(e.target.value)}
                    disabled={acting === 'ASSIGN'}
                  >
                    <option value="">Select assignee</option>
                    {assignCandidates.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.userNo} - {item.email}
                      </option>
                    ))}
                  </select>
                </>
              )}

              {assignCandidatesError ? (
                <div className="text-sm text-red-700">{assignCandidatesError}</div>
              ) : null}
            </div>

            <div className="px-4 py-3 border-t border-admin-border flex justify-end gap-2">
              <button
                onClick={() => setAssignModalOpen(false)}
                className="px-3 py-1.5 rounded border border-admin-border text-sm hover:bg-gray-50"
                disabled={acting === 'ASSIGN'}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void submitAssign();
                }}
                className="px-3 py-1.5 rounded bg-brand-primary text-white text-sm hover:opacity-90 disabled:opacity-60"
                disabled={acting === 'ASSIGN' || assignCandidatesLoading || !selectedAssigneeUserId}
              >
                {acting === 'ASSIGN' ? 'Processing...' : 'Confirm Assign'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ComplianceAlertDetailPage;
