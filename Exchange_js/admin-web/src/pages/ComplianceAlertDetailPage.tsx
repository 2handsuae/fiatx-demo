import { useEffect, useMemo, useState } from 'react';
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
type AlertHandlingAction =
  | 'ASSIGN'
  | 'REASSIGN'
  | 'FALSE_POSITIVE'
  | 'DIRECT_DISPOSITION'
  | 'ESCALATE_TO_CASE';
type DirectProposalCode = 'REJECT' | 'REQUIRE_EDD' | 'FREEZE_TRANSACTION';
type ResolutionAction = Extract<
  AlertHandlingAction,
  'FALSE_POSITIVE' | 'DIRECT_DISPOSITION' | 'ESCALATE_TO_CASE'
>;

const ASSIGNMENT_ACTIONS = new Set<AlertHandlingAction>(['ASSIGN', 'REASSIGN']);
const RESOLUTION_ACTIONS = new Set<AlertHandlingAction>([
  'FALSE_POSITIVE',
  'DIRECT_DISPOSITION',
  'ESCALATE_TO_CASE',
]);

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

interface PrimaryObject {
  type: 'ONBOARDING_JOURNEY' | 'PERIODIC_REVIEW_CYCLE' | 'DEPOSIT' | string;
  id?: string | null;
  no?: string | null;
  label: string;
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
  primaryObject?: PrimaryObject | null;
  availableHandlingActions?: AlertHandlingAction[];
  availableDirectProposals?: DirectProposalCode[];
  events: AlertEvent[];
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

interface ResolutionModalState {
  action: ResolutionAction;
  reason: string;
  proposalCode: DirectProposalCode | '';
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

const handlingActionLabelMap: Record<AlertHandlingAction, string> = {
  ASSIGN: 'Assign',
  REASSIGN: 'Reassign',
  FALSE_POSITIVE: 'False Positive',
  DIRECT_DISPOSITION: 'Direct Disposition',
  ESCALATE_TO_CASE: 'Escalate to Case',
};

const getProposalLabel = (
  detail: AlertDetail | null,
  proposalCode: DirectProposalCode,
): string => {
  const primaryObjectType = String(detail?.primaryObject?.type || '').trim().toUpperCase();

  if (proposalCode === 'REQUIRE_EDD') {
    return 'Require EDD';
  }

  if (proposalCode === 'FREEZE_TRANSACTION') {
    return 'Freeze Deposit';
  }

  if (primaryObjectType === 'ONBOARDING_JOURNEY') {
    return 'Reject Journey';
  }

  if (primaryObjectType === 'PERIODIC_REVIEW_CYCLE') {
    return 'Reject Review';
  }

  return 'Reject Deposit';
};

const getResolutionModalTitle = (action: ResolutionAction): string => {
  if (action === 'FALSE_POSITIVE') return 'Mark as False Positive';
  if (action === 'DIRECT_DISPOSITION') return 'Apply Direct Disposition';
  return 'Escalate to Case';
};

const getResolutionModalDescription = (action: ResolutionAction): string => {
  if (action === 'FALSE_POSITIVE') {
    return 'This records the alert as a false positive and automatically lets the primary workflow continue.';
  }
  if (action === 'DIRECT_DISPOSITION') {
    return 'Choose the fixed primary object proposal for this alert. Object selection is locked by alert type.';
  }
  return 'This hands the alert off to a compliance case for formal investigation.';
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
  const [resolutionModal, setResolutionModal] = useState<ResolutionModalState | null>(
    null,
  );

  const canManageAlertWorkItem = hasPermission(PERMISSIONS.ALERTS_WRITE);
  const canResolveAlerts = hasPermission(PERMISSIONS.ALERTS_RESOLVE);
  const canWriteCases = hasPermission(PERMISSIONS.CASES_WRITE);
  const canReadRiskDecisionRecords = hasPermission(
    PERMISSIONS.RISK_DECISION_RECORDS_READ,
  );
  const from =
    new URLSearchParams(location.search).get('from') || '/dashboard/compliance/alerts';

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
      setSelectedAssigneeUserId(
        detail.assigneeUserId || session?.id || candidates[0]?.id || '',
      );
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

  const closeAssignModal = () => {
    if (acting === 'ASSIGN') return;
    setAssignModalOpen(false);
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

  const handlingActions = useMemo(() => {
    if (!detail) return [] as AlertHandlingAction[];
    return normalizeActionList<AlertHandlingAction>(
      detail.availableHandlingActions,
    ).filter((action) => {
      if (ASSIGNMENT_ACTIONS.has(action)) {
        return canManageAlertWorkItem;
      }
      if (!RESOLUTION_ACTIONS.has(action) || !canResolveAlerts) {
        return false;
      }
      return action !== 'ESCALATE_TO_CASE' || canWriteCases;
    });
  }, [canManageAlertWorkItem, canResolveAlerts, canWriteCases, detail]);

  const directProposals = useMemo(
    () => normalizeActionList<DirectProposalCode>(detail?.availableDirectProposals),
    [detail?.availableDirectProposals],
  );

  const recommendedDecisions = normalizeRecommendedDecisions(
    detail?.recommendedDecisions,
  );
  const providerResponseLink = detail ? getProviderResponseLink(detail) : null;
  const decisionRecordIds = normalizeStringList(detail?.decisionRecordIds);
  const linkedCaseIds = normalizeStringList(detail?.linkedCaseIds);
  const reasonCodes = normalizeStringList(detail?.reasonCodes);
  const metadata = getMetadataRecord(detail?.metadata);
  const canonicalRiskBand = String(metadata.riskBand || '').trim();
  const canonicalRiskReason = String(metadata.riskReason || '').trim();
  const compatibilityRiskBand = String(metadata.simulationRiskLevel || '').trim();
  const compatibilityRiskReason = String(metadata.simulationRiskReason || '').trim();
  const riskBand = canonicalRiskBand;
  const riskReason = canonicalRiskReason;
  const hasHistoricalRiskCompatibility =
    Boolean(compatibilityRiskBand) || Boolean(compatibilityRiskReason);
  const riskSnapshotSource =
    canonicalRiskBand || canonicalRiskReason ? 'Canonical alert metadata' : '-';

  const openResolutionModal = (action: ResolutionAction) => {
    setError('');
    setMessage('');
    setResolutionModal({
      action,
      reason: '',
      proposalCode:
        action === 'DIRECT_DISPOSITION' ? directProposals[0] || '' : '',
    });
  };

  const closeResolutionModal = () => {
    if (acting) return;
    setResolutionModal(null);
  };

  const handleHandlingAction = async (action: AlertHandlingAction) => {
    if (action === 'ASSIGN' || action === 'REASSIGN') {
      await openAssignModal();
      return;
    }

    openResolutionModal(action);
  };

  const submitResolution = async () => {
    if (!detail || !resolutionModal) return;

    const trimmedReason = resolutionModal.reason.trim();
    if (
      (resolutionModal.action === 'DIRECT_DISPOSITION' ||
        resolutionModal.action === 'ESCALATE_TO_CASE') &&
      !trimmedReason
    ) {
      setError(
        resolutionModal.action === 'DIRECT_DISPOSITION'
          ? 'Direct disposition requires a reason.'
          : 'Escalation requires a reason.',
      );
      return;
    }

    if (
      resolutionModal.action === 'DIRECT_DISPOSITION' &&
      !resolutionModal.proposalCode
    ) {
      setError('Direct disposition requires a proposal.');
      return;
    }

    setActing(resolutionModal.action);
    setError('');
    setMessage('');

    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/alerts/${detail.id}/resolve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resolutionType: resolutionModal.action,
            proposalCode:
              resolutionModal.action === 'DIRECT_DISPOSITION'
                ? resolutionModal.proposalCode
                : undefined,
            reason: trimmedReason || undefined,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to resolve alert.'));
      }

      const updated = (await response.json()) as AlertDetail;
      setDetail(updated);
      setResolutionModal(null);

      if (resolutionModal.action === 'FALSE_POSITIVE') {
        setMessage('False positive recorded. The primary workflow can continue automatically.');
      } else if (resolutionModal.action === 'DIRECT_DISPOSITION') {
        setMessage(
          `Direct disposition applied: ${getProposalLabel(
            updated,
            resolutionModal.proposalCode as DirectProposalCode,
          )}.`,
        );
      } else {
        setMessage('Alert escalated to case. Continue the investigation from the case queue.');
      }
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to resolve alert.');
    } finally {
      setActing(null);
    }
  };

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
      />

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
            <span
              className={`inline-flex rounded-full px-2 py-1 text-xs ${getSeverityClass(
                detail.severity,
              )}`}
            >
              {detail.severity}
            </span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-gray-500">Status</div>
          <div className="mt-1">
            <span
              className={`inline-flex rounded-full px-2 py-1 text-xs ${getStatusClass(
                detail.status,
              )}`}
            >
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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <DetailCard title="Source Context" columns={2}>
          <InfoField label="Module" value={detail.sourceModule} />
          <InfoField label="Source Type" value={detail.sourceType} />
          <InfoField label="Source" value={detail.sourceNo || detail.sourceId} mono />
          <InfoField label="Entity" value={detail.entityNo || detail.entityType || '-'} />
          <InfoField label="Customer" value={detail.customerNo || '-'} />
          <InfoField label="Reason Codes" value={reasonCodes.join(', ') || '-'} />
          <InfoField label="Risk Band" value={riskBand || '-'} />
          <InfoField label="Risk Reason" value={riskReason || '-'} />
          <InfoField label="Risk Snapshot Source" value={riskSnapshotSource} />
          <InfoField label="Hit Count" value={detail.hitCount} />
          <InfoField label="Message" value={detail.message} />
        </DetailCard>

        {hasHistoricalRiskCompatibility ? (
          <DetailCard title="Historical Compatibility" columns={2}>
            <InfoField
              label="Simulation Risk Level"
              value={compatibilityRiskBand || '-'}
            />
            <InfoField
              label="Simulation Risk Reason"
              value={compatibilityRiskReason || '-'}
            />
            <div className="xl:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
              Historical simulation metadata is retained for read-only traceability.
              Current alert truth should be interpreted from canonical risk metadata,
              decision records, alerts, and case callbacks.
            </div>
          </DetailCard>
        ) : null}

        <DetailCard title="Lifecycle" columns={2}>
          <InfoField label="Due" value={formatDateTime(detail.dueAt)} />
          <InfoField
            label="Overdue Flagged At"
            value={formatDateTime(detail.overdueMarkedAt)}
          />
          <InfoField label="Last Seen" value={formatDateTime(detail.lastOccurredAt)} />
          <InfoField label="Assignee" value={detail.assigneeUserNo || '-'} />
          <InfoField label="Closed At" value={formatDateTime(detail.closedAt)} />
          <InfoField
            label="Recommended Decisions"
            value={recommendedDecisions.join(', ') || '-'}
          />
        </DetailCard>
      </div>

      <DetailCard title="Primary Object" columns={2}>
        <InfoField label="Label" value={detail.primaryObject?.label || '-'} />
        <InfoField label="Type" value={detail.primaryObject?.type || '-'} />
        <InfoField
          label="Object"
          value={detail.primaryObject?.no || detail.primaryObject?.id || '-'}
          mono
        />
        <InfoField
          label="Primary Object ID"
          value={detail.primaryObject?.id || '-'}
          mono
        />
      </DetailCard>

      <DetailCard title="Evidence & Linked Objects" columns={2}>
        <div className="min-w-0 space-y-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">
              Provider Response
            </div>
            <div className="mt-1 text-sm font-medium text-gray-900">
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
            <div className="text-xs uppercase tracking-wide text-gray-500">
              Risk Engine Trace
            </div>
            <div className="mt-1 text-sm font-medium text-gray-900">
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
        title="Alert Handling"
        description="Assign the alert or resolve it against its fixed primary object."
        emptyText="No alert handling actions are available in the current status."
      >
        {handlingActions.length === 0 ? (
          <div className="text-sm text-gray-500">
            No alert handling actions are available in the current status.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {handlingActions.map((action) => (
              <button
                key={action}
                onClick={() => {
                  void handleHandlingAction(action);
                }}
                disabled={acting !== null || assignCandidatesLoading}
                className="rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {acting === action ? 'Processing...' : handlingActionLabelMap[action]}
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-xl rounded-xl border border-admin-border bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-admin-border px-4 py-3">
              <div>
                <h4 className="text-base font-semibold text-gray-900">
                  {detail.status === 'ASSIGNED' ? 'Reassign Alert' : 'Assign Alert'}
                </h4>
                <p className="text-xs text-gray-500">{detail.alertNo}</p>
              </div>
              <button
                onClick={closeAssignModal}
                className="p-2 text-gray-500 hover:text-gray-700"
                disabled={acting === 'ASSIGN'}
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 p-4">
              {assignCandidatesLoading ? (
                <div className="text-sm text-gray-500">Loading assignees...</div>
              ) : (
                <>
                  <label className="block text-sm text-gray-700">Assignee</label>
                  <select
                    className="w-full rounded border border-admin-border px-3 py-2 text-sm"
                    value={selectedAssigneeUserId}
                    onChange={(event) => setSelectedAssigneeUserId(event.target.value)}
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

            <div className="flex justify-end gap-2 border-t border-admin-border px-4 py-3">
              <button
                onClick={closeAssignModal}
                className="rounded border border-admin-border px-3 py-1.5 text-sm hover:bg-gray-50"
                disabled={acting === 'ASSIGN'}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void submitAssign();
                }}
                className="rounded bg-brand-primary px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-60"
                disabled={
                  acting === 'ASSIGN' ||
                  assignCandidatesLoading ||
                  !selectedAssigneeUserId
                }
              >
                {acting === 'ASSIGN' ? 'Processing...' : 'Confirm Assign'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {resolutionModal ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-admin-border bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-admin-border px-4 py-3">
              <div>
                <h4 className="text-base font-semibold text-gray-900">
                  {getResolutionModalTitle(resolutionModal.action)}
                </h4>
                <p className="text-xs text-gray-500">{detail.alertNo}</p>
              </div>
              <button
                onClick={closeResolutionModal}
                className="p-2 text-gray-500 hover:text-gray-700"
                disabled={acting === resolutionModal.action}
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 p-4">
              <div className="rounded-lg border border-admin-border bg-gray-50 p-3">
                <div className="text-xs uppercase tracking-wide text-gray-500">
                  Primary Object
                </div>
                <div className="mt-1 text-sm font-medium text-gray-900">
                  {detail.primaryObject?.label || '-'}
                </div>
                <div className="mt-1 text-sm text-gray-500">
                  {detail.primaryObject?.no || detail.primaryObject?.id || '-'}
                </div>
              </div>

              <p className="text-sm text-gray-600">
                {getResolutionModalDescription(resolutionModal.action)}
              </p>

              {resolutionModal.action === 'DIRECT_DISPOSITION' ? (
                <div className="space-y-2">
                  <label className="block text-sm text-gray-700">Proposal</label>
                  <select
                    className="w-full rounded border border-admin-border px-3 py-2 text-sm"
                    value={resolutionModal.proposalCode}
                    onChange={(event) =>
                      setResolutionModal((current) =>
                        current
                          ? {
                              ...current,
                              proposalCode: event.target.value as DirectProposalCode,
                            }
                          : current,
                      )
                    }
                    disabled={acting === resolutionModal.action}
                  >
                    <option value="">Select proposal</option>
                    {directProposals.map((proposalCode) => (
                      <option key={proposalCode} value={proposalCode}>
                        {getProposalLabel(detail, proposalCode)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="space-y-2">
                <label className="block text-sm text-gray-700">
                  Reason
                  {resolutionModal.action === 'FALSE_POSITIVE' ? ' (Optional)' : ''}
                </label>
                <textarea
                  className="min-h-[120px] w-full rounded border border-admin-border px-3 py-2 text-sm"
                  value={resolutionModal.reason}
                  onChange={(event) =>
                    setResolutionModal((current) =>
                      current
                        ? {
                            ...current,
                            reason: event.target.value,
                          }
                        : current,
                    )
                  }
                  disabled={acting === resolutionModal.action}
                  placeholder={
                    resolutionModal.action === 'FALSE_POSITIVE'
                      ? 'Optional audit note'
                      : 'Required reason'
                  }
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-admin-border px-4 py-3">
              <button
                onClick={closeResolutionModal}
                className="rounded border border-admin-border px-3 py-1.5 text-sm hover:bg-gray-50"
                disabled={acting === resolutionModal.action}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void submitResolution();
                }}
                className="rounded bg-brand-primary px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-60"
                disabled={acting === resolutionModal.action}
              >
                {acting === resolutionModal.action ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ComplianceAlertDetailPage;
