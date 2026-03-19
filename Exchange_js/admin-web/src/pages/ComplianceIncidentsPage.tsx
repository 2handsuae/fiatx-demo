import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search, X } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import { PERMISSIONS } from '../rbac/permissions';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { useAdminSession } from '../contexts/AdminSessionContext';

type IncidentSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type IncidentStatus = 'OPEN' | 'ASSIGNED' | 'RESOLVED' | 'CLOSED';
type FreezeStatus = 'ACTIVE' | 'FROZEN';
type ReportStatus = 'NOT_REPORTED' | 'REPORTED';
type CaseReportStatus = 'DRAFT' | 'FINALIZED' | 'SUPERSEDED';
type CaseWorkItemAction =
  | 'ASSIGN'
  | 'REASSIGN'
  | 'LINK_ALERT'
  | 'CLOSE';
type RecommendedDecision = 'APPROVE' | 'REJECT' | 'REQUIRE_EDD';
type CaseType = 'ONBOARDING' | 'TRANSACTION' | 'GENERIC';
type CaseDispositionCode =
  | 'APPROVE_STAGE'
  | 'REJECT_STAGE'
  | 'REQUIRE_EDD'
  | 'CLEAR'
  | 'RESTRICT'
  | 'REPORT'
  | 'FALSE_POSITIVE';
type CaseComplianceAction =
  | 'APPROVE_STAGE'
  | 'REJECT_STAGE'
  | 'REQUIRE_EDD'
  | 'FREEZE'
  | 'UNFREEZE'
  | 'RESTRICT'
  | 'UNRESTRICT'
  | 'REPORT'
  | 'FALSE_POSITIVE';

interface IncidentReport {
  id: string;
  version: number;
  isCurrent: boolean;
  status: CaseReportStatus;
  workflow: string;
  stage?: string | null;
  ruleCode?: string | null;
  factsSummary?: string | null;
  investigationScope?: string | null;
  evidenceSummary?: string | null;
  containmentSummary?: string | null;
  analystConclusion?: string | null;
  recommendedActions?: unknown;
  finalDispositionCode?: CaseDispositionCode | string | null;
  finalDispositionReason?: string | null;
  linkedAlertSnapshot?: unknown;
  decisionRecordSnapshot?: unknown;
  providerResponseSnapshot?: unknown;
  createdByUserNo?: string | null;
  finalizedByUserNo?: string | null;
  finalizedAt?: string | null;
  supersededAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ReportDraftState {
  factsSummary: string;
  investigationScope: string;
  evidenceSummary: string;
  containmentSummary: string;
  analystConclusion: string;
  recommendedActions: string;
  finalDispositionCode: string;
  finalDispositionReason: string;
}

interface IncidentItem {
  id: string;
  caseNo?: string;
  incidentNo: string;
  workflow?: string | null;
  stage?: string | null;
  rule?: string | null;
  ruleCode?: string | null;
  caseType?: CaseType;
  status: IncidentStatus;
  severity: IncidentSeverity;
  title: string;
  summary: string;
  primaryAlertNo?: string | null;
  customerNo?: string | null;
  assigneeUserId?: string | null;
  assigneeUserNo?: string | null;
  ownerUserId?: string | null;
  ownerUserNo?: string | null;
  freezeStatus?: FreezeStatus;
  frozenAt?: string | null;
  freezeReason?: string | null;
  reportStatus?: ReportStatus;
  reportRefNo?: string | null;
  reportedAt?: string | null;
  reportReason?: string | null;
  overdueMarkedAt?: string | null;
  alertCount: number;
  dueAt: string;
  lastActionAt?: string | null;
  recommendedDecisions?: string[];
  reasonCodes?: string[];
}

interface IncidentAlertLink {
  id: string;
  alertId: string;
  alertNo: string;
  relationType: 'PRIMARY' | 'RELATED';
  linkedAt: string;
  linkedByNo?: string | null;
  note?: string | null;
  alert?: {
    id: string;
    alertNo: string;
    workflow?: string | null;
    stage?: string | null;
    rule?: string | null;
    ruleCode: string;
    severity: string;
    status: string;
    title: string;
    sourceType: string;
    sourceId: string;
    sourceNo?: string | null;
    dueAt: string;
    lastOccurredAt: string;
  } | null;
}

interface IncidentEvent {
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
  dispositionCode: CaseDispositionCode | string;
  decision?: string | null;
  reason?: string | null;
  isFinal?: boolean;
  actorNo?: string | null;
  actorRole?: string | null;
  source?: string | null;
  sourceRefId?: string | null;
  createdAt: string;
}

interface IncidentDetail extends IncidentItem {
  customerId?: string | null;
  entityType?: string | null;
  entityNo?: string | null;
  sourceModule?: string | null;
  sourceType?: string | null;
  assigneeUserId?: string | null;
  assigneeUserNo?: string | null;
  ownerUserId?: string | null;
  assignedAt?: string | null;
  resolvedAt?: string | null;
  closedAt?: string | null;
  closeReason?: string | null;
  currentDispositionCode?: CaseDispositionCode | string | null;
  currentDispositionReason?: string | null;
  currentDispositionAt?: string | null;
  finalDispositionCode?: CaseDispositionCode | string | null;
  finalDispositionReason?: string | null;
  finalDispositionAt?: string | null;
  rootCauseCategory?: string | null;
  resolutionSummary?: string | null;
  containmentSummary?: string | null;
  closureChecklist?: unknown;
  metadata?: unknown;
  recommendedDecisions?: string[];
  dispositionHistory?: DispositionRecord[];
  currentReport?: IncidentReport | null;
  reportHistory?: IncidentReport[];
  reportLocked?: boolean;
  availableWorkItemActions?: CaseWorkItemAction[];
  availableComplianceActions?: CaseComplianceAction[];
  alerts: IncidentAlertLink[];
  events: IncidentEvent[];
}

interface UserListItem {
  id: string;
  userNo: string;
  email: string;
  status: string;
  role?: string;
  roles?: string[];
}

interface OnboardingIncidentDecisionResponse {
  case?: IncidentDetail;
  incident: IncidentDetail;
  alert: {
    id: string;
    decision?: string | null;
  };
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

interface IncidentListResponse {
  total: number;
  skip: number;
  take: number;
  items: IncidentItem[];
}

interface FilterState {
  caseNo: string;
  status: '' | IncidentStatus;
  severity: '' | IncidentSeverity;
  customerNo: string;
  assigneeUserId: string;
  alertNo: string;
  keyword: string;
  overdueOnly: boolean;
}

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  caseNo: '',
  status: '',
  severity: '',
  customerNo: '',
  assigneeUserId: '',
  alertNo: '',
  keyword: '',
  overdueOnly: false,
};

const CLOSED_STATUSES: IncidentStatus[] = ['CLOSED'];

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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

const CASE_CLOSE_DISPOSITIONS: CaseDispositionCode[] = [
  'APPROVE_STAGE',
  'REJECT_STAGE',
  'REQUIRE_EDD',
  'RESTRICT',
  'REPORT',
  'FALSE_POSITIVE',
];

const EMPTY_REPORT_DRAFT: ReportDraftState = {
  factsSummary: '',
  investigationScope: '',
  evidenceSummary: '',
  containmentSummary: '',
  analystConclusion: '',
  recommendedActions: '',
  finalDispositionCode: '',
  finalDispositionReason: '',
};

const toPrettyJson = (value: unknown): string => {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const toTextAreaValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean).join('\n');
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const buildReportDraftState = (report?: IncidentReport | null): ReportDraftState => {
  if (!report) return { ...EMPTY_REPORT_DRAFT };
  return {
    factsSummary: report.factsSummary || '',
    investigationScope: report.investigationScope || '',
    evidenceSummary: report.evidenceSummary || '',
    containmentSummary: report.containmentSummary || '',
    analystConclusion: report.analystConclusion || '',
    recommendedActions: toTextAreaValue(report.recommendedActions),
    finalDispositionCode: String(report.finalDispositionCode || '').trim(),
    finalDispositionReason: report.finalDispositionReason || '',
  };
};

const getSeverityClass = (severity: IncidentSeverity) => {
  if (severity === 'CRITICAL') return 'bg-red-100 text-red-800';
  if (severity === 'HIGH') return 'bg-orange-100 text-orange-800';
  if (severity === 'MEDIUM') return 'bg-yellow-100 text-yellow-800';
  return 'bg-gray-100 text-gray-700';
};

const getStatusClass = (status: IncidentStatus) => {
  if (status === 'OPEN') return 'bg-blue-100 text-blue-800';
  if (status === 'ASSIGNED') return 'bg-indigo-100 text-indigo-800';
  if (status === 'RESOLVED') return 'bg-green-100 text-green-800';
  if (status === 'CLOSED') return 'bg-gray-200 text-gray-800';
  return 'bg-gray-100 text-gray-700';
};

const getFreezeStatusClass = (status?: FreezeStatus) => {
  if (status === 'FROZEN') return 'bg-red-100 text-red-800';
  return 'bg-emerald-100 text-emerald-800';
};

const getReportStatusClass = (status?: ReportStatus) => {
  if (status === 'REPORTED') return 'bg-violet-100 text-violet-800';
  return 'bg-gray-100 text-gray-700';
};

const isOverdue = (item: IncidentItem) =>
  !CLOSED_STATUSES.includes(item.status) &&
  new Date(item.dueAt).getTime() < Date.now();

const normalizeRecommendedDecisions = (
  values?: string[],
): RecommendedDecision[] => {
  const allowed = new Set<RecommendedDecision>(['APPROVE', 'REJECT', 'REQUIRE_EDD']);
  const normalized = Array.isArray(values)
    ? values
        .map((item) => String(item || '').trim().toUpperCase())
        .filter((item): item is RecommendedDecision =>
          allowed.has(item as RecommendedDecision),
        )
    : [];
  return Array.from(new Set(normalized));
};

const caseWorkItemActionLabelMap: Record<CaseWorkItemAction, string> = {
  ASSIGN: 'Assign',
  REASSIGN: 'Reassign',
  LINK_ALERT: 'Link Alert',
  CLOSE: 'Close',
};

const caseComplianceActionLabelMap: Record<CaseComplianceAction, string> = {
  APPROVE_STAGE: 'Approve Stage',
  REJECT_STAGE: 'Reject Stage',
  REQUIRE_EDD: 'Require EDD',
  FREEZE: 'Freeze',
  UNFREEZE: 'Unfreeze',
  RESTRICT: 'Restrict',
  UNRESTRICT: 'Unrestrict',
  REPORT: 'Report',
  FALSE_POSITIVE: 'False Positive',
};

const normalizeActionList = <T extends string>(value: unknown): T[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim().toUpperCase())
    .filter(Boolean) as T[];
};

const ComplianceCasesPage = () => {
  const navigate = useNavigate();
  const { session, hasPermission } = useAdminSession();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<IncidentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [reportDraft, setReportDraft] = useState<ReportDraftState>(EMPTY_REPORT_DRAFT);
  const [reportSaving, setReportSaving] = useState(false);
  const [reportFinalizing, setReportFinalizing] = useState(false);
  const [reportRevisionArmed, setReportRevisionArmed] = useState(false);

  const canWriteCases = hasPermission(PERMISSIONS.CASES_WRITE);
  const canReadCaseExports = hasPermission(PERMISSIONS.CASE_EVIDENCE_EXPORTS_READ);

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignCandidates, setAssignCandidates] = useState<UserListItem[]>([]);
  const [assignCandidatesLoading, setAssignCandidatesLoading] = useState(false);
  const [assignCandidatesError, setAssignCandidatesError] = useState('');
  const [selectedAssigneeUserId, setSelectedAssigneeUserId] = useState('');

  const hasFilters = useMemo(() => {
    return (
      !!filters.caseNo.trim() ||
      !!filters.status ||
      !!filters.severity ||
      !!filters.customerNo.trim() ||
      !!filters.assigneeUserId.trim() ||
      !!filters.alertNo.trim() ||
      !!filters.keyword.trim() ||
      filters.overdueOnly
    );
  }, [filters]);

  const fetchIncidents = async (
    targetPage: number,
    activeFilters: FilterState = filters,
  ) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      params.set('skip', String((targetPage - 1) * PAGE_SIZE));
      params.set('take', String(PAGE_SIZE));

      if (activeFilters.caseNo.trim()) params.set('caseNo', activeFilters.caseNo.trim());
      if (activeFilters.status) params.set('status', activeFilters.status);
      if (activeFilters.severity) params.set('severity', activeFilters.severity);
      if (activeFilters.customerNo.trim()) params.set('customerNo', activeFilters.customerNo.trim());
      if (activeFilters.assigneeUserId.trim()) params.set('assigneeUserId', activeFilters.assigneeUserId.trim());
      if (activeFilters.alertNo.trim()) params.set('alertNo', activeFilters.alertNo.trim());
      if (activeFilters.keyword.trim()) params.set('keyword', activeFilters.keyword.trim());
      if (activeFilters.overdueOnly) params.set('overdueOnly', 'true');

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases?${params.toString()}`,
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load cases.'));
      }

      const data = (await response.json()) as IncidentListResponse;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(targetPage);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load cases.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchIncidents(1);
  }, []);

  useEffect(() => {
    setReportDraft(buildReportDraftState(detail?.currentReport));
    setReportRevisionArmed(false);
  }, [detail?.id, detail?.currentReport?.id, detail?.currentReport?.updatedAt]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setError('');
    setAssignModalOpen(false);
    setAssignCandidates([]);
    setAssignCandidatesError('');
    setSelectedAssigneeUserId('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases/${id}`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load case detail.'));
      }
      const data = (await response.json()) as IncidentDetail;
      setDetail(data);
      setReportDraft(buildReportDraftState(data.currentReport));
      setReportRevisionArmed(false);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load case detail.');
    } finally {
      setDetailLoading(false);
    }
  };

  const fetchAssignCandidates = async (): Promise<UserListItem[]> => {
    const response = await adminFetch(
      `${import.meta.env.VITE_API_URL}/users?take=200`,
    );

    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, 'Failed to load assignees.'));
    }

    const payload = (await response.json()) as UserListItem[];
    const users = Array.isArray(payload) ? payload : [];

    return users
      .filter((item) => item.status === 'ACTIVE')
      .filter((item) => {
        const roleCodes = Array.from(
          new Set(
            [
              String(item.role || '').trim().toUpperCase(),
              ...(Array.isArray(item.roles)
                ? item.roles.map((code) => String(code || '').trim().toUpperCase())
                : []),
            ].filter(Boolean),
          ),
        );
        return (
          roleCodes.includes('SUPER_ADMIN') ||
          roleCodes.includes('MLRO') ||
          roleCodes.includes('COMPLIANCE_LEAD')
        );
      })
      .sort((a, b) => {
        const aNo = (a.userNo || '').toUpperCase();
        const bNo = (b.userNo || '').toUpperCase();
        return aNo.localeCompare(bNo);
      });
  };

  const openAssignModal = async () => {
    if (!detail) return;
    setAssignModalOpen(true);
    setAssignCandidatesLoading(true);
    setAssignCandidatesError('');

    try {
      const candidates = await fetchAssignCandidates();
      setAssignCandidates(candidates);
      const defaultAssignee =
        detail.assigneeUserId ||
        detail.ownerUserId ||
        session?.id ||
        (candidates.length > 0 ? candidates[0].id : '');
      setSelectedAssigneeUserId(defaultAssignee || '');
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
    if (!detail) return;
    if (!selectedAssigneeUserId) {
      setAssignCandidatesError('Please select an assignee.');
      return;
    }

    setActing('ASSIGN');
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases/${detail.id}/action`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'ASSIGN',
            assigneeUserId: selectedAssigneeUserId,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Assign failed.'));
      }

      const updated = (await response.json()) as IncidentDetail;
      setDetail(updated);
      setAssignModalOpen(false);
      setMessage('Assignee updated.');
      await fetchIncidents(currentPage);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Assign failed.');
    } finally {
      setActing(null);
    }
  };

  const submitCaseAction = async (
    action: 'CLOSE' | 'FREEZE' | 'UNFREEZE' | 'RESTRICT' | 'UNRESTRICT' | 'REPORT',
    options?: {
      reason?: string;
      dispositionCode?: CaseDispositionCode;
    },
  ) => {
    if (!detail) return;
    setActing(action);
    setError('');
    setMessage('');

    try {
      const payload: Record<string, unknown> = { action };
      if (options?.reason) payload.reason = options.reason;
      if (options?.dispositionCode) payload.dispositionCode = options.dispositionCode;

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases/${detail.id}/action`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Action failed.'));
      }

      const updated = (await response.json()) as IncidentDetail;
      setDetail(updated);
      if (action === 'REPORT' && updated.reportRefNo) {
        setMessage(`Report recorded as ${updated.reportRefNo}.`);
      } else if (action === 'FREEZE') {
        setMessage('Customer compliance hold enabled from this case.');
      } else if (action === 'UNFREEZE') {
        setMessage('Customer compliance hold released.');
      } else if (action === 'RESTRICT') {
        setMessage('Customer restriction enabled from this case.');
      } else if (action === 'UNRESTRICT') {
        setMessage('Customer restriction released.');
      } else {
        setMessage(`Action ${action} completed.`);
      }
      await fetchIncidents(currentPage);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setActing(null);
    }
  };

  const saveCaseReportDraft = async () => {
    if (!detail) return;
    setReportSaving(true);
    setError('');
    setMessage('');

    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases/${detail.id}/report/draft`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(reportDraft),
        },
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to save draft.'));
      }

      await openDetail(detail.id);
      await fetchIncidents(currentPage);
      setMessage('Investigation report draft saved.');
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to save draft.');
    } finally {
      setReportSaving(false);
    }
  };

  const finalizeCaseReport = async () => {
    if (!detail) return;
    setReportFinalizing(true);
    setError('');
    setMessage('');

    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases/${detail.id}/report/finalize`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        },
      );

      if (!response.ok) {
        throw new Error(
          await getApiErrorMessage(response, 'Failed to finalize report.'),
        );
      }

      await openDetail(detail.id);
      await fetchIncidents(currentPage);
      setMessage('Investigation report finalized.');
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to finalize report.');
    } finally {
      setReportFinalizing(false);
    }
  };

  const applyOnboardingDecision = async (decision: RecommendedDecision) => {
    if (!detail) return;
    const isPeriodicReview = String(detail.workflow || '').trim().toUpperCase() === 'PERIODIC_REVIEW';
    const reasonInput =
      decision === 'REJECT'
        ? window.prompt('Reason (optional)', '') || ''
        : '';

    setActing(decision);
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases/${detail.id}/${
          isPeriodicReview ? 'periodic-review-decision' : 'onboarding-decision'
        }`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            decision,
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

      const data = (await response.json()) as OnboardingIncidentDecisionResponse;
      setDetail(data.case || data.incident);
      if (decision === 'REQUIRE_EDD' && data.eddResponse?.responseNo) {
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
      await fetchIncidents(currentPage);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(
        e instanceof Error
          ? e.message
          : isPeriodicReview
            ? 'Failed to apply periodic review decision.'
            : 'Failed to apply onboarding decision.',
      );
    } finally {
      setActing(null);
    }
  };

  const handleLinkAlert = async () => {
    if (!detail) return;
    setLinking(true);
    setError('');
    setMessage('');

    try {
      const alertId = window.prompt('Alert ID to link', '') || '';
      if (!alertId.trim()) {
        throw new Error('alertId is required.');
      }
      const note = window.prompt('Link note (optional)', '') || '';

      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases/${detail.id}/alerts`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            alertId: alertId.trim(),
            note: note.trim() || undefined,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to link alert.'));
      }

      const updated = (await response.json()) as IncidentDetail;
      setDetail(updated);
      setMessage('Alert linked successfully.');
      await fetchIncidents(currentPage);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to link alert.');
    } finally {
      setLinking(false);
    }
  };

  const handleWorkItemAction = async (action: CaseWorkItemAction) => {
    if (!detail) return;
    if (action === 'ASSIGN' || action === 'REASSIGN') {
      await openAssignModal();
      return;
    }
    if (action === 'LINK_ALERT') {
      await handleLinkAlert();
      return;
    }

    const reason = window.prompt('Close reason', '') || '';
    if (!reason.trim()) {
      setError('Closing case requires a reason.');
      return;
    }

    let dispositionCode: CaseDispositionCode | undefined;
    if (!detail.currentDispositionCode) {
      const promptValue =
        window.prompt(
          `Disposition code (${CASE_CLOSE_DISPOSITIONS.join(' / ')})`,
          'FALSE_POSITIVE',
        ) || '';
      if (!promptValue.trim()) {
        setError('Closing without an existing disposition requires a disposition code.');
        return;
      }
      dispositionCode = promptValue.trim().toUpperCase() as CaseDispositionCode;
    }

    await submitCaseAction('CLOSE', {
      reason: reason.trim(),
      dispositionCode,
    });
  };

  const handleComplianceAction = async (action: CaseComplianceAction) => {
    if (!detail) return;

    if (action === 'APPROVE_STAGE') {
      await applyOnboardingDecision('APPROVE');
      return;
    }
    if (action === 'REJECT_STAGE') {
      await applyOnboardingDecision('REJECT');
      return;
    }
    if (action === 'REQUIRE_EDD') {
      await applyOnboardingDecision('REQUIRE_EDD');
      return;
    }
    if (action === 'FALSE_POSITIVE') {
      const reason = window.prompt('Please provide reason', '') || '';
      if (!reason.trim()) {
        setError('False Positive requires a reason.');
        return;
      }
      await submitCaseAction('CLOSE', {
        reason: reason.trim(),
        dispositionCode: 'FALSE_POSITIVE',
      });
      return;
    }

    const promptTitle =
      action === 'FREEZE'
        ? 'Freeze reason'
        : action === 'UNFREEZE'
          ? 'Unfreeze reason'
          : action === 'RESTRICT'
            ? 'Restriction reason'
            : action === 'UNRESTRICT'
              ? 'Unrestriction reason'
          : 'Internal report reason';
    const reason = window.prompt(promptTitle, '') || '';
    if (!reason.trim()) {
      setError(`${caseComplianceActionLabelMap[action]} requires a reason.`);
      return;
    }

    await submitCaseAction(
      action as 'FREEZE' | 'UNFREEZE' | 'RESTRICT' | 'UNRESTRICT' | 'REPORT',
      {
      reason: reason.trim(),
      },
    );
  };

  const resetFilters = async () => {
    setFilters(DEFAULT_FILTERS);
    await fetchIncidents(1, DEFAULT_FILTERS);
  };

  const workItemActions =
    detail && canWriteCases
      ? normalizeActionList<CaseWorkItemAction>(detail.availableWorkItemActions)
      : [];
  const complianceActions =
    detail && canWriteCases
      ? normalizeActionList<CaseComplianceAction>(detail.availableComplianceActions)
      : [];
  const recommendedDecisions = normalizeRecommendedDecisions(
    detail?.recommendedDecisions,
  );
  const reasonCodes = normalizeActionList<string>(detail?.reasonCodes);
  const currentReportStatus = detail?.currentReport?.status || null;
  const reportLocked = !!detail?.reportLocked;
  const canEditDraft =
    canWriteCases &&
    !!detail &&
    !reportLocked &&
    (!detail.currentReport ||
      currentReportStatus === 'DRAFT' ||
      reportRevisionArmed);
  const canFinalizeReport =
    canWriteCases &&
    !!detail &&
    !reportLocked &&
    currentReportStatus === 'DRAFT';
  const canReviseReport =
    canWriteCases &&
    !!detail &&
    !reportLocked &&
    currentReportStatus === 'FINALIZED' &&
    !reportRevisionArmed;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Compliance Center - Cases</h1>
          <p className="text-sm text-gray-500 mt-1">
            Investigate onboarding review escalations through a canonical workflow / stage / rule queue.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canReadCaseExports && (
            <button
              onClick={() => navigate('/dashboard/compliance/case-evidence-exports')}
              className="px-3 py-2 rounded border border-admin-border text-sm hover:bg-gray-50"
            >
              Case Evidence Exports
            </button>
          )}
          <button
            onClick={() => fetchIncidents(currentPage)}
            className="p-2 text-gray-500 hover:text-brand-primary disabled:opacity-60"
            title="Refresh"
            disabled={loading}
          >
            <RefreshCw size={20} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {message && (
        <div className="px-4 py-3 border border-blue-200 bg-blue-50 rounded-lg text-blue-700 text-sm">
          {message}
        </div>
      )}
      {error && (
        <div className="px-4 py-3 border border-red-200 bg-red-50 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
      <div className="px-4 py-3 border border-slate-200 bg-slate-50 rounded-lg text-sm text-slate-700">
        {canWriteCases
          ? 'Cases are onboarding-only investigation objects. Work item actions manage ownership and linkage; compliance actions express the investigation outcome.'
          : 'You currently have read-only access to onboarding compliance cases created from alert escalation.'}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <input
            className="border border-admin-border rounded px-3 py-2 text-sm"
            placeholder="Case no"
            value={filters.caseNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, caseNo: e.target.value }))}
          />
          <div className="border border-admin-border rounded px-3 py-2 text-sm bg-gray-50 text-gray-700">
            Workflow: ONBOARDING
          </div>
          <select
            className="border border-admin-border rounded px-3 py-2 text-sm"
            value={filters.status}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, status: e.target.value as FilterState['status'] }))
            }
          >
            <option value="">All status</option>
            <option value="OPEN">OPEN</option>
            <option value="ASSIGNED">ASSIGNED</option>
            <option value="CLOSED">CLOSED</option>
          </select>
          <select
            className="border border-admin-border rounded px-3 py-2 text-sm"
            value={filters.severity}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, severity: e.target.value as FilterState['severity'] }))
            }
          >
            <option value="">All severity</option>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
          <input
            className="border border-admin-border rounded px-3 py-2 text-sm"
            placeholder="Customer no"
            value={filters.customerNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, customerNo: e.target.value }))}
          />
          <input
            className="border border-admin-border rounded px-3 py-2 text-sm"
            placeholder="Assignee user id"
            value={filters.assigneeUserId}
            onChange={(e) => setFilters((prev) => ({ ...prev, assigneeUserId: e.target.value }))}
          />
          <input
            className="border border-admin-border rounded px-3 py-2 text-sm"
            placeholder="Alert no"
            value={filters.alertNo}
            onChange={(e) => setFilters((prev) => ({ ...prev, alertNo: e.target.value }))}
          />
          <input
            className="border border-admin-border rounded px-3 py-2 text-sm md:col-span-2"
            placeholder="Keyword"
            value={filters.keyword}
            onChange={(e) => setFilters((prev) => ({ ...prev, keyword: e.target.value }))}
          />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={filters.overdueOnly}
              onChange={(e) => setFilters((prev) => ({ ...prev, overdueOnly: e.target.checked }))}
            />
            Overdue only
          </label>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchIncidents(1)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded bg-brand-primary text-white text-sm hover:opacity-90"
            disabled={loading}
          >
            <Search size={14} />
            Search
          </button>
          <button
            onClick={resetFilters}
            className="inline-flex items-center gap-2 px-3 py-2 rounded border border-admin-border text-sm hover:bg-gray-50"
            disabled={loading || !hasFilters}
          >
            <X size={14} />
            Reset
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-admin-content-bg border-b border-admin-border">
              <tr>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Case</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Severity</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Workflow / Stage / Rule</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Freeze</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Report</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Customer</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Primary Alert</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Assignee</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Due</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Last Action</th>
                <th className="px-4 py-3 text-xs uppercase text-gray-500">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-admin-border">
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-gray-500">
                    No cases found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900">{item.caseNo || item.incidentNo}</div>
                      <div className="text-xs text-gray-500">{item.title}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs ${getStatusClass(item.status)}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs ${getSeverityClass(item.severity)}`}>
                        {item.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      <div>{item.workflow || 'ONBOARDING'}</div>
                      <div className="text-xs text-gray-500">{item.stage || '-'}</div>
                      <div className="text-xs text-gray-500">{item.rule || '-'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span
                          className={`inline-flex w-fit px-2 py-1 rounded-full text-xs ${getFreezeStatusClass(item.freezeStatus)}`}
                        >
                          {item.freezeStatus || 'ACTIVE'}
                        </span>
                        {item.frozenAt && (
                          <span className="text-xs text-gray-500">
                            {formatDateTime(item.frozenAt)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span
                          className={`inline-flex w-fit px-2 py-1 rounded-full text-xs ${getReportStatusClass(item.reportStatus)}`}
                        >
                          {item.reportStatus || 'NOT_REPORTED'}
                        </span>
                        <span className="text-xs text-gray-500">
                          {item.reportRefNo || formatDateTime(item.reportedAt)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{item.customerNo || '-'}</td>
                    <td className="px-4 py-3 text-gray-700">{item.primaryAlertNo || '-'}</td>
                    <td className="px-4 py-3 text-gray-700">{item.assigneeUserNo || item.ownerUserNo || '-'}</td>
                    <td className="px-4 py-3">
                      <div className={isOverdue(item) ? 'text-red-700 font-medium' : 'text-gray-700'}>
                        {formatDateTime(item.dueAt)}
                      </div>
                      {item.overdueMarkedAt && (
                        <div className="text-xs text-red-600 mt-1">
                          Flagged {formatDateTime(item.overdueMarkedAt)}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{formatDateTime(item.lastActionAt)}</td>
                    <td className="px-4 py-3">
                      <button
                        className="text-xs border border-gray-200 px-2 py-1 rounded hover:bg-gray-50"
                        onClick={() => openDetail(item.id)}
                      >
                        View Detail
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          currentPage={currentPage}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPageChange={(page) => fetchIncidents(page)}
        />
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-5xl bg-white rounded-xl shadow-xl border border-admin-border max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-admin-border px-4 py-3 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Case Detail - {detail.caseNo || detail.incidentNo}</h3>
                <p className="text-xs text-gray-500">{detail.id}</p>
              </div>
              <button
                onClick={() => setDetail(null)}
                className="p-2 text-gray-500 hover:text-gray-700"
              >
                <X size={18} />
              </button>
            </div>

            {detailLoading ? (
              <div className="p-6 text-sm text-gray-500">Loading detail...</div>
            ) : (
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <InfoCard
                      title="Summary"
                      rows={[
                        ['Status', detail.status],
                        ['Severity', detail.severity],
                        ['Workflow', detail.workflow || 'ONBOARDING'],
                        ['Stage', detail.stage || '-'],
                        ['Rule', detail.rule || detail.ruleCode || '-'],
                        ['Freeze Status', detail.freezeStatus || 'ACTIVE'],
                        ['Report Status', detail.reportStatus || 'NOT_REPORTED'],
                        ['Customer', detail.customerNo || '-'],
                        ['Primary Alert', detail.primaryAlertNo || '-'],
                        ['Recommended Decisions', recommendedDecisions.join(', ') || '-'],
                        ['Summary', detail.summary],
                      ]}
                    />
                  <InfoCard
                      title="Source"
                      rows={[
                        ['Source Module', detail.sourceModule || '-'],
                        ['Source Type', detail.sourceType || '-'],
                        ['Entity', detail.entityNo || detail.entityType || '-'],
                        ['Reason Codes', reasonCodes.join(', ') || '-'],
                        ['Alert Count', String(detail.alertCount || 0)],
                        ['Assignee', detail.assigneeUserNo || detail.ownerUserNo || '-'],
                        ['Report Ref', detail.reportRefNo || '-'],
                      ]}
                  />
                  <InfoCard
                    title="Lifecycle"
                    rows={[
                      ['Due', formatDateTime(detail.dueAt)],
                      ['Overdue Flagged At', formatDateTime(detail.overdueMarkedAt)],
                      ['Assigned At', formatDateTime(detail.assignedAt)],
                      ['Frozen At', formatDateTime(detail.frozenAt)],
                      ['Reported At', formatDateTime(detail.reportedAt)],
                      ['Resolved At (legacy)', formatDateTime(detail.resolvedAt)],
                      ['Closed At', formatDateTime(detail.closedAt)],
                      ['Close Reason', detail.closeReason || '-'],
                    ]}
                  />
                </div>

                <div className="border border-admin-border rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-3">Work Item Actions</h4>
                  {workItemActions.length === 0 ? (
                    <div className="text-sm text-gray-500">
                      No work item actions available for current user in this status.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {workItemActions.map((action) => (
                        <button
                          key={action}
                          onClick={() => {
                            void handleWorkItemAction(action);
                          }}
                          disabled={
                            acting !== null || assignCandidatesLoading || linking
                          }
                          className="px-3 py-1.5 rounded border border-admin-border text-sm hover:bg-gray-50 disabled:opacity-60"
                        >
                          {acting === action || (linking && action === 'LINK_ALERT')
                            ? 'Processing...'
                            : caseWorkItemActionLabelMap[action]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border border-admin-border rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-3">Compliance Actions</h4>
                  {complianceActions.length === 0 ? (
                    <div className="text-sm text-gray-500">
                      No compliance actions available for current user in this status.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {complianceActions.map((action) => (
                        <button
                          key={action}
                          onClick={() => {
                            void handleComplianceAction(action);
                          }}
                          disabled={acting !== null || linking}
                          className="px-3 py-1.5 rounded border border-admin-border text-sm hover:bg-gray-50 disabled:opacity-60"
                        >
                          {acting === action
                            ? 'Processing...'
                            : caseComplianceActionLabelMap[action]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border border-admin-border rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-3">Compliance Disposition</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <InfoCard
                      title="Current"
                      rows={[
                        ['Code', detail.currentDispositionCode || '-'],
                        ['Reason', detail.currentDispositionReason || '-'],
                        ['At', formatDateTime(detail.currentDispositionAt)],
                      ]}
                    />
                    <InfoCard
                      title="Final"
                      rows={[
                        ['Code', detail.finalDispositionCode || '-'],
                        ['Reason', detail.finalDispositionReason || '-'],
                        ['At', formatDateTime(detail.finalDispositionAt)],
                      ]}
                    />
                  </div>
                  <div className="mt-4">
                    <div className="text-sm font-medium text-gray-900 mb-2">
                      Disposition History
                    </div>
                    <pre className="text-xs bg-gray-50 border border-admin-border rounded p-3 overflow-auto max-h-56">
                      {toPrettyJson(detail.dispositionHistory || [])}
                    </pre>
                  </div>
                  <div className="mt-4 border-t border-admin-border pt-4">
                    <div className="text-sm font-medium text-gray-900 mb-2">
                      Freeze / Report Snapshot
                    </div>
                    <pre className="text-xs bg-gray-50 border border-admin-border rounded p-3 overflow-auto max-h-56">
                      {toPrettyJson({
                        freezeStatus: detail.freezeStatus || 'ACTIVE',
                        frozenAt: detail.frozenAt,
                        freezeReason: detail.freezeReason,
                        reportStatus: detail.reportStatus || 'NOT_REPORTED',
                        reportRefNo: detail.reportRefNo,
                        reportedAt: detail.reportedAt,
                        reportReason: detail.reportReason,
                        overdueMarkedAt: detail.overdueMarkedAt,
                      })}
                    </pre>
                  </div>
                </div>

                <div className="border border-admin-border rounded-lg p-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-gray-900">Investigation Report</h4>
                      <p className="text-xs text-gray-500 mt-1">
                        Finalize a case report before REPORT or CLOSE becomes available.
                      </p>
                    </div>
                    <div className="text-xs">
                      <span
                        className={`inline-flex px-2 py-1 rounded-full ${
                          reportLocked
                            ? 'bg-gray-200 text-gray-800'
                            : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {reportLocked ? 'Locked' : 'Editable'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="text-sm text-gray-700">
                      <div className="mb-1 font-medium">Facts Summary</div>
                      <textarea
                        value={reportDraft.factsSummary}
                        onChange={(e) =>
                          setReportDraft((prev) => ({
                            ...prev,
                            factsSummary: e.target.value,
                          }))
                        }
                        disabled={!canEditDraft || reportSaving || reportFinalizing}
                        className="w-full min-h-24 border border-admin-border rounded px-3 py-2 text-sm disabled:bg-gray-50"
                      />
                    </label>
                    <label className="text-sm text-gray-700">
                      <div className="mb-1 font-medium">Investigation Scope</div>
                      <textarea
                        value={reportDraft.investigationScope}
                        onChange={(e) =>
                          setReportDraft((prev) => ({
                            ...prev,
                            investigationScope: e.target.value,
                          }))
                        }
                        disabled={!canEditDraft || reportSaving || reportFinalizing}
                        className="w-full min-h-24 border border-admin-border rounded px-3 py-2 text-sm disabled:bg-gray-50"
                      />
                    </label>
                    <label className="text-sm text-gray-700">
                      <div className="mb-1 font-medium">Evidence Summary</div>
                      <textarea
                        value={reportDraft.evidenceSummary}
                        onChange={(e) =>
                          setReportDraft((prev) => ({
                            ...prev,
                            evidenceSummary: e.target.value,
                          }))
                        }
                        disabled={!canEditDraft || reportSaving || reportFinalizing}
                        className="w-full min-h-24 border border-admin-border rounded px-3 py-2 text-sm disabled:bg-gray-50"
                      />
                    </label>
                    <label className="text-sm text-gray-700">
                      <div className="mb-1 font-medium">Containment Summary</div>
                      <textarea
                        value={reportDraft.containmentSummary}
                        onChange={(e) =>
                          setReportDraft((prev) => ({
                            ...prev,
                            containmentSummary: e.target.value,
                          }))
                        }
                        disabled={!canEditDraft || reportSaving || reportFinalizing}
                        className="w-full min-h-24 border border-admin-border rounded px-3 py-2 text-sm disabled:bg-gray-50"
                      />
                    </label>
                    <label className="text-sm text-gray-700">
                      <div className="mb-1 font-medium">Analyst Conclusion</div>
                      <textarea
                        value={reportDraft.analystConclusion}
                        onChange={(e) =>
                          setReportDraft((prev) => ({
                            ...prev,
                            analystConclusion: e.target.value,
                          }))
                        }
                        disabled={!canEditDraft || reportSaving || reportFinalizing}
                        className="w-full min-h-24 border border-admin-border rounded px-3 py-2 text-sm disabled:bg-gray-50"
                      />
                    </label>
                    <label className="text-sm text-gray-700">
                      <div className="mb-1 font-medium">
                        Recommended Actions
                      </div>
                      <textarea
                        value={reportDraft.recommendedActions}
                        onChange={(e) =>
                          setReportDraft((prev) => ({
                            ...prev,
                            recommendedActions: e.target.value,
                          }))
                        }
                        disabled={!canEditDraft || reportSaving || reportFinalizing}
                        className="w-full min-h-24 border border-admin-border rounded px-3 py-2 text-sm disabled:bg-gray-50"
                      />
                    </label>
                    <label className="text-sm text-gray-700">
                      <div className="mb-1 font-medium">Final Disposition</div>
                      <select
                        value={reportDraft.finalDispositionCode}
                        onChange={(e) =>
                          setReportDraft((prev) => ({
                            ...prev,
                            finalDispositionCode: e.target.value,
                          }))
                        }
                        disabled={!canEditDraft || reportSaving || reportFinalizing}
                        className="w-full border border-admin-border rounded px-3 py-2 text-sm disabled:bg-gray-50"
                      >
                        <option value="">Select disposition</option>
                        {CASE_CLOSE_DISPOSITIONS.map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm text-gray-700">
                      <div className="mb-1 font-medium">
                        Final Disposition Reason
                      </div>
                      <textarea
                        value={reportDraft.finalDispositionReason}
                        onChange={(e) =>
                          setReportDraft((prev) => ({
                            ...prev,
                            finalDispositionReason: e.target.value,
                          }))
                        }
                        disabled={!canEditDraft || reportSaving || reportFinalizing}
                        className="w-full min-h-24 border border-admin-border rounded px-3 py-2 text-sm disabled:bg-gray-50"
                      />
                    </label>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {canEditDraft && (
                      <button
                        onClick={() => {
                          void saveCaseReportDraft();
                        }}
                        disabled={reportSaving || reportFinalizing}
                        className="px-3 py-1.5 rounded border border-admin-border text-sm hover:bg-gray-50 disabled:opacity-60"
                      >
                        {reportSaving ? 'Saving...' : 'Save Draft'}
                      </button>
                    )}
                    {canFinalizeReport && (
                      <button
                        onClick={() => {
                          void finalizeCaseReport();
                        }}
                        disabled={reportSaving || reportFinalizing}
                        className="px-3 py-1.5 rounded border border-admin-border text-sm hover:bg-gray-50 disabled:opacity-60"
                      >
                        {reportFinalizing ? 'Finalizing...' : 'Finalize Report'}
                      </button>
                    )}
                    {canReviseReport && (
                      <button
                        onClick={() => {
                          setReportDraft(buildReportDraftState(detail.currentReport));
                          setReportRevisionArmed(true);
                        }}
                        className="px-3 py-1.5 rounded border border-admin-border text-sm hover:bg-gray-50"
                      >
                        Revise Report
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <InfoCard
                      title="Current Report"
                      rows={[
                        ['Version', String(detail.currentReport?.version || '-')],
                        ['Status', detail.currentReport?.status || '-'],
                        ['Final Disposition', detail.currentReport?.finalDispositionCode || '-'],
                        ['Finalized At', formatDateTime(detail.currentReport?.finalizedAt)],
                        ['Finalized By', detail.currentReport?.finalizedByUserNo || '-'],
                      ]}
                    />
                    <InfoCard
                      title="Report Lock Status"
                      rows={[
                        ['Locked', reportLocked ? 'YES' : 'NO'],
                        ['Current Report Id', detail.currentReport?.id || '-'],
                        ['Mirror Resolution', detail.resolutionSummary || '-'],
                        ['Mirror Containment', detail.containmentSummary || '-'],
                        ['Mirror Snapshot', toPrettyJson(detail.closureChecklist)],
                      ]}
                    />
                  </div>

                  <div>
                    <div className="text-sm font-medium text-gray-900 mb-2">
                      Report History
                    </div>
                    <pre className="text-xs bg-gray-50 border border-admin-border rounded p-3 overflow-auto max-h-56">
                      {toPrettyJson(detail.reportHistory || [])}
                    </pre>
                  </div>
                </div>

                <div className="border border-admin-border rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-3">Related Alerts</h4>
                  {detail.alerts.length === 0 ? (
                    <div className="text-sm text-gray-500">No linked alerts</div>
                  ) : (
                    <div className="space-y-3">
                      {detail.alerts.map((link) => (
                        <div key={link.id} className="border border-admin-border rounded p-3">
                          <div className="flex items-center justify-between text-xs text-gray-500">
                            <span>{link.relationType}</span>
                            <span>{formatDateTime(link.linkedAt)}</span>
                          </div>
                          <div className="text-sm text-gray-800 mt-1">
                            {link.alertNo} {link.alert?.title ? `- ${link.alert.title}` : ''}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {(link.alert?.workflow || 'ONBOARDING')} / {(link.alert?.stage || '-')} / {(link.alert?.rule || link.alert?.ruleCode || '-')}
                          </div>
                          <div className="text-xs text-gray-500 mt-1">
                            {link.alert?.status || '-'} / {link.alert?.severity || '-'}
                          </div>
                          {link.note && <div className="text-sm text-gray-700 mt-1">{link.note}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border border-admin-border rounded-lg p-4">
                  <h4 className="font-semibold text-gray-900 mb-3">Case Timeline</h4>
                  {detail.events.length === 0 ? (
                    <div className="text-sm text-gray-500">No events</div>
                  ) : (
                    <div className="space-y-3">
                      {detail.events.map((event) => (
                        <div key={event.id} className="border border-admin-border rounded p-3">
                          <div className="flex items-center justify-between text-xs text-gray-500">
                            <span>{event.eventType}</span>
                            <span>{formatDateTime(event.eventAt)}</span>
                          </div>
                          <div className="text-sm text-gray-800 mt-1">
                            Actor: {event.actorNo || event.actorType}{' '}
                            {event.actorRole ? `(${event.actorRole})` : ''}
                          </div>
                          {event.note && <div className="text-sm text-gray-700 mt-1">{event.note}</div>}
                          <pre className="text-xs bg-gray-50 border border-admin-border rounded p-2 mt-2 overflow-auto max-h-40">
                            {toPrettyJson(event.payload)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {assignModalOpen && detail && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white rounded-xl shadow-xl border border-admin-border">
            <div className="px-4 py-3 border-b border-admin-border flex items-center justify-between">
              <div>
                <h4 className="text-base font-semibold text-gray-900">
                  {detail.status === 'ASSIGNED' ? 'Reassign Case' : 'Assign Case'}
                </h4>
                <p className="text-xs text-gray-500">{detail.caseNo || detail.incidentNo}</p>
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
                  <label className="block text-sm text-gray-700">
                    Assignee (SUPER_ADMIN / COMPLIANCE_LEAD / MLRO)
                  </label>
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
                  {assignCandidates.length === 0 && (
                    <div className="text-sm text-gray-500">
                      No eligible active assignees available.
                    </div>
                  )}
                </>
              )}

              {assignCandidatesError && (
                <div className="text-sm text-red-700">{assignCandidatesError}</div>
              )}
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
      )}
    </div>
  );
};

const InfoCard = ({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, string]>;
}) => (
  <div className="border border-admin-border rounded-lg p-4">
    <h4 className="font-semibold text-gray-900 mb-3">{title}</h4>
    <div className="space-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-4">
          <span className="text-gray-500">{label}</span>
          <span className="text-gray-900 text-right break-all">{value}</span>
        </div>
      ))}
    </div>
  </div>
);

export default ComplianceCasesPage;
