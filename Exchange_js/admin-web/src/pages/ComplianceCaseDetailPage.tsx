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

type IncidentSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type IncidentStatus =
  | 'OPEN'
  | 'ASSIGNED'
  | 'INVESTIGATING'
  | 'PENDING_MLRO_REVIEW'
  | 'CLOSED';
type FreezeStatus = 'ACTIVE' | 'FROZEN';
type FilingStatus =
  | 'NOT_REQUIRED'
  | 'REQUIRED'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'RETURNED'
  | 'CLOSED';
type CaseReportStatus = 'DRAFT' | 'FINALIZED' | 'SUPERSEDED';
type CaseAction = 'ASSIGN' | 'REASSIGN' | 'LINK_ALERT';
type RecommendedDecision = 'CLEAR' | 'REJECT' | 'REQUIRE_EDD';
type CaseType = 'ONBOARDING' | 'PERIODIC_REVIEW' | 'TRANSACTION' | 'GENERIC';
type CaseDispositionCode = 'CLEAR' | 'FALSE_POSITIVE' | 'RISK_CONFIRMED';
type InterimMeasure = 'FREEZE' | 'UNFREEZE' | 'RESTRICT' | 'UNRESTRICT';
type WorkflowAction = 'CLEAR' | 'REJECT' | 'REQUIRE_EDD';
type MlroAction = 'RETURN_FOR_INVESTIGATION' | 'APPROVE_FINAL_DISPOSITION';
type FilingAction = 'SUBMIT' | 'ACKNOWLEDGE' | 'RETURN' | 'CLOSE';

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
  filingRequired?: boolean | null;
  filingType?: string | null;
  filingAuthority?: string | null;
  createdByUserNo?: string | null;
  finalizedByUserNo?: string | null;
  finalizedAt?: string | null;
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
  filingRequired: boolean;
  filingType: string;
  filingAuthority: string;
}

interface ExternalFilingEvent {
  id: string;
  eventType: string;
  eventAt: string;
  actorNo?: string | null;
  actorRole?: string | null;
  note?: string | null;
  statusFrom?: string | null;
  statusTo?: string | null;
  externalRefNo?: string | null;
  feedback?: string | null;
}

interface ExternalFiling {
  id: string;
  filingNo: string;
  filingType?: string | null;
  filingAuthority?: string | null;
  status: FilingStatus | string;
  requiredAt?: string | null;
  requiredByNo?: string | null;
  requiredByRole?: string | null;
  submittedAt?: string | null;
  submittedByNo?: string | null;
  submittedByRole?: string | null;
  externalRefNo?: string | null;
  latestFeedback?: string | null;
  latestFeedbackAt?: string | null;
  latestFeedbackByNo?: string | null;
  latestFeedbackByRole?: string | null;
  closedAt?: string | null;
  closedByNo?: string | null;
  closedByRole?: string | null;
  metadata?: unknown;
  events?: ExternalFilingEvent[];
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
  reason?: string | null;
  isFinal?: boolean;
  actorNo?: string | null;
  actorRole?: string | null;
  source?: string | null;
  sourceRefId?: string | null;
  createdAt: string;
}

interface IncidentDetail {
  id: string;
  caseNo?: string;
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
  freezeStatus?: FreezeStatus;
  frozenAt?: string | null;
  freezeReason?: string | null;
  filingStatus?: FilingStatus | string | null;
  overdueMarkedAt?: string | null;
  alertCount: number;
  dueAt: string;
  lastActionAt?: string | null;
  sourceModule?: string | null;
  sourceType?: string | null;
  entityType?: string | null;
  entityNo?: string | null;
  assignedAt?: string | null;
  resolvedAt?: string | null;
  closedAt?: string | null;
  closeReason?: string | null;
  currentDispositionCode?: CaseDispositionCode | string | null;
  currentDispositionReason?: string | null;
  currentDispositionAt?: string | null;
  proposedWorkflowDecision?: WorkflowAction | string | null;
  proposedWorkflowReason?: string | null;
  proposedFinalDispositionCode?: CaseDispositionCode | string | null;
  proposedFinalDispositionReason?: string | null;
  proposedFilingRequired?: boolean | null;
  proposedFilingType?: string | null;
  proposedFilingAuthority?: string | null;
  submittedForMlroAt?: string | null;
  submittedForMlroByNo?: string | null;
  submittedForMlroByRole?: string | null;
  mlroReviewOutcome?: MlroAction | string | null;
  mlroReviewNote?: string | null;
  mlroReviewedAt?: string | null;
  mlroReviewedByNo?: string | null;
  mlroReviewedByRole?: string | null;
  finalDispositionCode?: CaseDispositionCode | string | null;
  finalDispositionReason?: string | null;
  finalDispositionAt?: string | null;
  metadata?: unknown;
  recommendedDecisions?: string[];
  reasonCodes?: string[];
  dispositionHistory?: DispositionRecord[];
  currentReport?: IncidentReport | null;
  reportHistory?: IncidentReport[];
  reportLocked?: boolean;
  currentFiling?: ExternalFiling | null;
  filingHistory?: ExternalFilingEvent[];
  availableCaseActions?: CaseAction[];
  availableInterimMeasures?: InterimMeasure[];
  availableWorkflowActions?: WorkflowAction[];
  availableMlroActions?: MlroAction[];
  availableFilingActions?: FilingAction[];
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
}

const EMPTY_REPORT_DRAFT: ReportDraftState = {
  factsSummary: '',
  investigationScope: '',
  evidenceSummary: '',
  containmentSummary: '',
  analystConclusion: '',
  recommendedActions: '',
  finalDispositionCode: '',
  finalDispositionReason: '',
  filingRequired: false,
  filingType: '',
  filingAuthority: '',
};

const CASE_REPORT_DISPOSITIONS: CaseDispositionCode[] = [
  'CLEAR',
  'FALSE_POSITIVE',
  'RISK_CONFIRMED',
];

const formatDateTime = (value?: string | null): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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
    filingRequired: report.filingRequired === true,
    filingType: report.filingType || '',
    filingAuthority: report.filingAuthority || '',
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
  if (status === 'INVESTIGATING') return 'bg-sky-100 text-sky-800';
  if (status === 'PENDING_MLRO_REVIEW') return 'bg-fuchsia-100 text-fuchsia-800';
  return 'bg-gray-200 text-gray-800';
};

const getFreezeStatusClass = (status?: FreezeStatus) => {
  if (status === 'FROZEN') return 'bg-red-100 text-red-800';
  return 'bg-emerald-100 text-emerald-800';
};

const getFilingStatusClass = (status?: FilingStatus | string | null) => {
  if (status === 'REQUIRED') return 'bg-amber-100 text-amber-800';
  if (status === 'SUBMITTED') return 'bg-violet-100 text-violet-800';
  if (status === 'ACKNOWLEDGED') return 'bg-emerald-100 text-emerald-800';
  if (status === 'RETURNED') return 'bg-rose-100 text-rose-800';
  if (status === 'CLOSED') return 'bg-slate-200 text-slate-800';
  return 'bg-gray-100 text-gray-700';
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

const caseActionLabelMap: Record<CaseAction, string> = {
  ASSIGN: 'Assign',
  REASSIGN: 'Reassign',
  LINK_ALERT: 'Link Alert',
};

const interimMeasureLabelMap: Record<InterimMeasure, string> = {
  FREEZE: 'Freeze',
  UNFREEZE: 'Unfreeze',
  RESTRICT: 'Restrict',
  UNRESTRICT: 'Unrestrict',
};

const workflowActionLabelMap: Record<WorkflowAction, string> = {
  CLEAR: 'Clear',
  REJECT: 'Reject',
  REQUIRE_EDD: 'Require EDD',
};

const mlroActionLabelMap: Record<MlroAction, string> = {
  RETURN_FOR_INVESTIGATION: 'Return For Investigation',
  APPROVE_FINAL_DISPOSITION: 'Approve Final Disposition',
};

const filingActionLabelMap: Record<FilingAction, string> = {
  SUBMIT: 'Submit Filing',
  ACKNOWLEDGE: 'Mark Acknowledged',
  RETURN: 'Record Return',
  CLOSE: 'Close Filing',
};

const normalizeWorkflowProposal = (value?: string | null): WorkflowAction | null => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'CLEAR' || normalized === 'REJECT' || normalized === 'REQUIRE_EDD') {
    return normalized as WorkflowAction;
  }
  return null;
};

const normalizeCaseDisposition = (value?: string | null): CaseDispositionCode | null => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'CLEAR' || normalized === 'FALSE_POSITIVE' || normalized === 'RISK_CONFIRMED') {
    return normalized as CaseDispositionCode;
  }
  return null;
};

const normalizeFilingStatus = (value?: string | null): FilingStatus => {
  const normalized = String(value || '').trim().toUpperCase();
  if (
    normalized === 'REQUIRED' ||
    normalized === 'SUBMITTED' ||
    normalized === 'ACKNOWLEDGED' ||
    normalized === 'RETURNED' ||
    normalized === 'CLOSED'
  ) {
    return normalized as FilingStatus;
  }
  return 'NOT_REQUIRED';
};

const ComplianceCaseDetailPage = () => {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { session, hasPermission } = useAdminSession();

  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [acting, setActing] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [reportDraft, setReportDraft] = useState<ReportDraftState>(EMPTY_REPORT_DRAFT);
  const [reportSaving, setReportSaving] = useState(false);
  const [reportFinalizing, setReportFinalizing] = useState(false);
  const [reportSubmittingToMlro, setReportSubmittingToMlro] = useState(false);
  const [reportRevisionArmed, setReportRevisionArmed] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignCandidates, setAssignCandidates] = useState<UserListItem[]>([]);
  const [assignCandidatesLoading, setAssignCandidatesLoading] = useState(false);
  const [assignCandidatesError, setAssignCandidatesError] = useState('');
  const [selectedAssigneeUserId, setSelectedAssigneeUserId] = useState('');

  const from = new URLSearchParams(location.search).get('from') || '/dashboard/compliance/cases';
  const canWriteCases = hasPermission(PERMISSIONS.CASES_WRITE);
  const canMlroReviewCases = hasPermission(PERMISSIONS.CASE_MLRO_REVIEW_WRITE);
  const detailRecord = detail as unknown as Record<string, unknown>;

  const fetchDetail = async () => {
    if (!id) return;
    setLoading(true);
    setError('');
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
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
  }, [id]);

  useEffect(() => {
    setReportDraft(buildReportDraftState(detail?.currentReport));
    setReportRevisionArmed(false);
  }, [detail?.id, detail?.currentReport?.id, detail?.currentReport?.updatedAt]);

  const fetchAssignCandidates = async (): Promise<UserListItem[]> => {
    const response = await adminFetch(`${import.meta.env.VITE_API_URL}/users?take=200`);
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

  const submitAssign = async () => {
    if (!detail || !selectedAssigneeUserId) return;
    setActing('ASSIGN');
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases/${detail.id}/action`,
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
      setDetail((await response.json()) as IncidentDetail);
      setAssignModalOpen(false);
      setMessage('Assignee updated.');
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Assign failed.');
    } finally {
      setActing(null);
    }
  };

  const submitCaseAction = async (action: InterimMeasure, options?: { reason?: string }) => {
    if (!detail) return;
    setActing(action);
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases/${detail.id}/action`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            reason: options?.reason,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Action failed.'));
      }
      setDetail((await response.json()) as IncidentDetail);
      setMessage(`${interimMeasureLabelMap[action]} completed.`);
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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reportDraft),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to save draft.'));
      }
      await fetchDetail();
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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to finalize report.'));
      }
      await fetchDetail();
      setMessage('Investigation report finalized.');
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to finalize report.');
    } finally {
      setReportFinalizing(false);
    }
  };

  const submitCaseToMlro = async () => {
    if (!detail) return;
    setReportSubmittingToMlro(true);
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases/${detail.id}/report/submit-to-mlro`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to submit case to MLRO.'));
      }
      setDetail((await response.json()) as IncidentDetail);
      setMessage('Case submitted to MLRO review.');
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to submit case to MLRO.');
    } finally {
      setReportSubmittingToMlro(false);
    }
  };

  const reviewCaseByMlro = async (decision: MlroAction) => {
    if (!detail) return;
    const note =
      decision === 'RETURN_FOR_INVESTIGATION'
        ? window.prompt('Return note (optional)', '') || ''
        : window.prompt('Approval note (optional)', '') || '';
    setActing(decision);
    setError('');
    setMessage('');
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases/${detail.id}/mlro-review`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision,
            note: note.trim() || undefined,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to review case as MLRO.'));
      }
      setDetail((await response.json()) as IncidentDetail);
      setMessage(
        decision === 'RETURN_FOR_INVESTIGATION'
          ? 'Case returned to investigation.'
          : 'Final disposition approved and case closed.',
      );
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to review case as MLRO.');
    } finally {
      setActing(null);
    }
  };

  const handleFilingAction = async (action: FilingAction) => {
    if (!detail) return;
    setActing(action);
    setError('');
    setMessage('');
    try {
      if (action === 'SUBMIT') {
        const externalRefNo = window.prompt('External reference no (optional)', '') || '';
        const note = window.prompt('Submission note (optional)', '') || '';
        const response = await adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/compliance/cases/${detail.id}/filing/submit`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              externalRefNo: externalRefNo.trim() || undefined,
              note: note.trim() || undefined,
            }),
          },
        );
        if (!response.ok) {
          throw new Error(await getApiErrorMessage(response, 'Failed to submit filing.'));
        }
        setDetail((await response.json()) as IncidentDetail);
        setMessage('External filing submitted.');
        return;
      }
      if (action === 'ACKNOWLEDGE' || action === 'RETURN') {
        const feedback =
          window.prompt(
            action === 'ACKNOWLEDGE' ? 'Acknowledgement feedback' : 'Return feedback',
            '',
          ) || '';
        if (!feedback.trim()) {
          throw new Error('Feedback is required.');
        }
        const externalRefNo = window.prompt('External reference no (optional)', '') || '';
        const note = window.prompt('Follow-up note (optional)', '') || '';
        const response = await adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/compliance/cases/${detail.id}/filing/feedback`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: action === 'ACKNOWLEDGE' ? 'ACKNOWLEDGED' : 'RETURNED',
              feedback: feedback.trim(),
              externalRefNo: externalRefNo.trim() || undefined,
              note: note.trim() || undefined,
            }),
          },
        );
        if (!response.ok) {
          throw new Error(await getApiErrorMessage(response, 'Failed to record filing feedback.'));
        }
        setDetail((await response.json()) as IncidentDetail);
        setMessage(
          action === 'ACKNOWLEDGE'
            ? 'External filing marked as acknowledged.'
            : 'External filing marked as returned.',
        );
        return;
      }
      const note = window.prompt('Closure note (optional)', '') || '';
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/cases/${detail.id}/filing/close`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            note: note.trim() || undefined,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to close filing.'));
      }
      setDetail((await response.json()) as IncidentDetail);
      setMessage('External filing closed.');
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Filing action failed.');
    } finally {
      setActing(null);
    }
  };

  const applyOnboardingDecision = async (decision: RecommendedDecision) => {
    if (!detail) return;
    const isPeriodicReview = String(detail.workflow || '').trim().toUpperCase() === 'PERIODIC_REVIEW';
    const reasonInput = decision === 'REJECT' ? window.prompt('Reason (optional)', '') || '' : '';
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
          headers: { 'Content-Type': 'application/json' },
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
      setMessage(
        `${isPeriodicReview ? 'Periodic review' : 'Onboarding'} workflow proposal recorded. Final disposition will only take effect after MLRO approval.`,
      );
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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            alertId: alertId.trim(),
            note: note.trim() || undefined,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to link alert.'));
      }
      setDetail((await response.json()) as IncidentDetail);
      setMessage('Alert linked successfully.');
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to link alert.');
    } finally {
      setLinking(false);
    }
  };

  const handleCaseAction = async (action: CaseAction) => {
    if (action === 'ASSIGN' || action === 'REASSIGN') {
      await openAssignModal();
      return;
    }
    if (action === 'LINK_ALERT') {
      await handleLinkAlert();
    }
  };

  const handleWorkflowAction = async (action: WorkflowAction) => {
    await applyOnboardingDecision(action);
  };

  const handleInterimMeasure = async (action: InterimMeasure) => {
    const promptTitle =
      action === 'FREEZE'
        ? 'Freeze reason'
        : action === 'UNFREEZE'
          ? 'Unfreeze reason'
          : action === 'RESTRICT'
            ? 'Restriction reason'
            : 'Unrestriction reason';
    const reason = window.prompt(promptTitle, '') || '';
    if (!reason.trim()) {
      setError(`${interimMeasureLabelMap[action]} requires a reason.`);
      return;
    }
    await submitCaseAction(action, { reason: reason.trim() });
  };

  const caseActions =
    detail && canWriteCases ? normalizeActionList<CaseAction>(detail.availableCaseActions) : [];
  const interimMeasures =
    detail && canWriteCases
      ? normalizeActionList<InterimMeasure>(detail.availableInterimMeasures)
      : [];
  const workflowActions =
    detail && canWriteCases
      ? normalizeActionList<WorkflowAction>(detail.availableWorkflowActions)
      : [];
  const mlroActions =
    detail && canMlroReviewCases
      ? normalizeActionList<MlroAction>(detail.availableMlroActions)
      : [];
  const filingActions =
    detail && canWriteCases
      ? normalizeActionList<FilingAction>(detail.availableFilingActions)
      : [];
  const recommendedDecisions = normalizeRecommendedDecisions(detail?.recommendedDecisions);
  const reasonCodes = normalizeActionList<string>(detail?.reasonCodes);
  const currentReportStatus = detail?.currentReport?.status || null;
  const currentFilingStatus = normalizeFilingStatus(
    detail?.currentFiling?.status || detail?.filingStatus || null,
  );
  const reportLocked = !!detail?.reportLocked;
  const canEditDraft =
    canWriteCases &&
    !!detail &&
    !reportLocked &&
    (!detail.currentReport || currentReportStatus === 'DRAFT' || reportRevisionArmed);
  const canFinalizeReport =
    canWriteCases && !!detail && !reportLocked && currentReportStatus === 'DRAFT';
  const canReviseReport =
    canWriteCases &&
    !!detail &&
    !reportLocked &&
    currentReportStatus === 'FINALIZED' &&
    !reportRevisionArmed;
  const workflowBoundCase =
    String(detail?.workflow || '').trim().toUpperCase() === 'ONBOARDING' ||
    String(detail?.workflow || '').trim().toUpperCase() === 'PERIODIC_REVIEW';
  const proposedWorkflowDecision = normalizeWorkflowProposal(detail?.proposedWorkflowDecision || null);
  const reportFinalDisposition = normalizeCaseDisposition(reportDraft.finalDispositionCode);
  const filingRequired = reportDraft.filingRequired === true;
  const hasValidWorkflowProposal = !workflowBoundCase || !!proposedWorkflowDecision;
  const hasValidDispositionForWorkflow =
    !workflowBoundCase ||
    !proposedWorkflowDecision ||
    (proposedWorkflowDecision === 'CLEAR'
      ? reportFinalDisposition === 'CLEAR' || reportFinalDisposition === 'FALSE_POSITIVE'
      : reportFinalDisposition === 'RISK_CONFIRMED');
  const hasValidFilingProposal =
    !filingRequired ||
    (reportFinalDisposition === 'RISK_CONFIRMED' &&
      !!reportDraft.filingType.trim() &&
      !!reportDraft.filingAuthority.trim());
  const canSubmitToMlro =
    canWriteCases &&
    !!detail &&
    detail.status !== 'PENDING_MLRO_REVIEW' &&
    !reportLocked &&
    currentReportStatus === 'FINALIZED' &&
    !!reportFinalDisposition &&
    hasValidWorkflowProposal &&
    hasValidDispositionForWorkflow &&
    hasValidFilingProposal;
  const showFilingProposalFields = reportFinalDisposition === 'RISK_CONFIRMED' || filingRequired;

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center text-sm text-gray-500">
        Loading case detail...
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="space-y-6">
        <DetailPageHeader
          title="Case Detail"
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
        title="Case Detail"
        subtitle={detail.caseNo || '-'}
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
        <InfoField label="Case No" value={detail.caseNo || '-'} mono />
        <InfoField label="Title" value={detail.title} />
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-gray-500">Status</div>
          <div className="mt-1">
            <span className={`inline-flex px-2 py-1 rounded-full text-xs ${getStatusClass(detail.status)}`}>
              {detail.status}
            </span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-gray-500">Severity</div>
          <div className="mt-1">
            <span className={`inline-flex px-2 py-1 rounded-full text-xs ${getSeverityClass(detail.severity)}`}>
              {detail.severity}
            </span>
          </div>
        </div>
        <InfoField label="Workflow" value={detail.workflow || detail.caseType || 'GENERIC'} />
        <InfoField label="Stage" value={detail.stage || '-'} />
        <InfoField label="Rule" value={detail.rule || detail.ruleCode || '-'} />
        <InfoField label="Summary" value={detail.summary} />
        <InfoField label="Recommended Decisions" value={recommendedDecisions.join(', ') || '-'} />
      </DetailCard>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <DetailCard title="Case Context" columns={2}>
          <InfoField label="Customer" value={detail.customerNo || '-'} />
          <InfoField label="Primary Alert" value={detail.primaryAlertNo || '-'} />
          <InfoField label="Source Module" value={detail.sourceModule || '-'} />
          <InfoField label="Source Type" value={detail.sourceType || '-'} />
          <InfoField label="Entity" value={detail.entityNo || detail.entityType || '-'} />
          <InfoField label="Alert Count" value={detail.alertCount} />
          <InfoField label="Assignee" value={detail.assigneeUserNo || '-'} />
          <InfoField label="Reason Codes" value={reasonCodes.join(', ') || '-'} />
        </DetailCard>

        <DetailCard title="Lifecycle & Investigation Phase" columns={2}>
          <InfoField label="Due" value={formatDateTime(detail.dueAt)} />
          <InfoField label="Overdue Flagged At" value={formatDateTime(detail.overdueMarkedAt)} />
          <InfoField label="Assigned At" value={formatDateTime(detail.assignedAt)} />
          <InfoField label="Last Action At" value={formatDateTime(detail.lastActionAt)} />
          <InfoField label="Closed At" value={formatDateTime(detail.closedAt)} />
          <InfoField label="Close Reason" value={detail.closeReason || '-'} />
          <InfoField label="Filing Status" value={currentFilingStatus} />
          <InfoField
            label="Investigation Phase"
            value={
              detail.status === 'INVESTIGATING'
                ? 'INVESTIGATING'
                : detail.status === 'PENDING_MLRO_REVIEW'
                  ? 'PENDING_MLRO_REVIEW'
                  : detail.status
            }
          />
        </DetailCard>
      </div>

      <ActionSection
        title="Case Actions"
        description="Case actions manage ownership and linkage."
        emptyText="No case actions available."
      >
        {caseActions.length === 0 ? (
          <div className="text-sm text-gray-500">No case actions available.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {caseActions.map((action) => (
              <button
                key={action}
                onClick={() => {
                  void handleCaseAction(action);
                }}
                disabled={acting !== null || linking}
                className="rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {acting === action ? 'Processing...' : caseActionLabelMap[action]}
              </button>
            ))}
          </div>
        )}
      </ActionSection>

      <ActionSection
        title="Interim Measures"
        description="Interim measures apply temporary customer controls."
        emptyText="No interim measures available."
      >
        {interimMeasures.length === 0 ? (
          <div className="text-sm text-gray-500">No interim measures available.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {interimMeasures.map((action) => (
              <button
                key={action}
                onClick={() => {
                  void handleInterimMeasure(action);
                }}
                disabled={acting !== null}
                className="rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {acting === action ? 'Processing...' : interimMeasureLabelMap[action]}
              </button>
            ))}
          </div>
        )}
      </ActionSection>

      <DetailCard title="Case Controls" columns={2}>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-gray-500">Freeze Status</div>
          <div className="mt-1">
            <span className={`inline-flex px-2 py-1 rounded-full text-xs ${getFreezeStatusClass(detail.freezeStatus)}`}>
              {detail.freezeStatus || 'ACTIVE'}
            </span>
          </div>
        </div>
        <InfoField label="Frozen At" value={formatDateTime(detail.frozenAt)} />
        <InfoField label="Freeze Reason" value={detail.freezeReason || '-'} />
        <InfoField label="Filing Status" value={currentFilingStatus} />
        <div className="xl:col-span-2">
          <JsonBlock
            title="Freeze / Restriction Snapshot"
            value={{
              freezeStatus: detail.freezeStatus || 'ACTIVE',
              frozenAt: detail.frozenAt,
              freezeReason: detail.freezeReason,
              restrictionCaseId: detailRecord.restrictionCaseId,
              restrictionStatus: detailRecord.restrictionStatus,
              filingStatus: currentFilingStatus,
              filingNo: detail.currentFiling?.filingNo || null,
              filingType: detail.currentFiling?.filingType || null,
              filingAuthority: detail.currentFiling?.filingAuthority || null,
              externalRefNo: detail.currentFiling?.externalRefNo || null,
              submittedAt: detail.currentFiling?.submittedAt || null,
              latestFeedback: detail.currentFiling?.latestFeedback || null,
              overdueMarkedAt: detail.overdueMarkedAt,
            }}
            compact
          />
        </div>
      </DetailCard>

      <ActionSection
        title="Workflow Proposal"
        description="Workflow proposals are recorded first and only take effect after explicit MLRO approval."
        emptyText="No workflow actions available."
      >
        {workflowActions.length === 0 ? (
          <div className="text-sm text-gray-500">No workflow actions available.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {workflowActions.map((action) => (
              <button
                key={action}
                onClick={() => {
                  void handleWorkflowAction(action);
                }}
                disabled={acting !== null}
                className="rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {acting === action ? 'Processing...' : workflowActionLabelMap[action]}
              </button>
            ))}
          </div>
        )}
      </ActionSection>

      <ActionSection
        title="MLRO Review"
        description="MLRO review is the final governance gate before the disposition takes effect."
        emptyText="No MLRO review actions available."
      >
        {mlroActions.length === 0 ? (
          <div className="text-sm text-gray-500">No MLRO review actions available.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {mlroActions.map((action) => (
              <button
                key={action}
                onClick={() => {
                  void reviewCaseByMlro(action);
                }}
                disabled={acting !== null}
                className="rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {acting === action ? 'Processing...' : mlroActionLabelMap[action]}
              </button>
            ))}
          </div>
        )}
      </ActionSection>

      <DetailCard title="Workflow & Governance" columns={2}>
        <InfoField label="Current Disposition" value={detail.currentDispositionCode || '-'} />
        <InfoField label="Current Reason" value={detail.currentDispositionReason || '-'} />
        <InfoField label="Current At" value={formatDateTime(detail.currentDispositionAt)} />
        <InfoField label="Final Disposition" value={detail.finalDispositionCode || '-'} />
        <InfoField label="Final Reason" value={detail.finalDispositionReason || '-'} />
        <InfoField label="Final At" value={formatDateTime(detail.finalDispositionAt)} />
        <InfoField label="Proposed Workflow" value={detail.proposedWorkflowDecision || '-'} />
        <InfoField label="Workflow Reason" value={detail.proposedWorkflowReason || '-'} />
        <InfoField label="Proposed Disposition" value={detail.proposedFinalDispositionCode || '-'} />
        <InfoField label="Disposition Reason" value={detail.proposedFinalDispositionReason || '-'} />
        <InfoField label="Filing Required" value={detail.proposedFilingRequired === true ? 'YES' : 'NO'} />
        <InfoField label="Filing Type" value={detail.proposedFilingType || '-'} />
        <InfoField label="Filing Authority" value={detail.proposedFilingAuthority || '-'} />
        <InfoField label="Submitted For MLRO" value={formatDateTime(detail.submittedForMlroAt)} />
        <InfoField label="Submitted By" value={detail.submittedForMlroByNo || detail.submittedForMlroByRole || '-'} />
        <InfoField label="MLRO Outcome" value={detail.mlroReviewOutcome || '-'} />
        <InfoField label="MLRO Note" value={detail.mlroReviewNote || '-'} />
        <InfoField label="Reviewed At" value={formatDateTime(detail.mlroReviewedAt)} />
        <InfoField label="Reviewed By" value={detail.mlroReviewedByNo || detail.mlroReviewedByRole || '-'} />
        <div className="xl:col-span-2">
          <JsonBlock title="Disposition History" value={detail.dispositionHistory || []} compact />
        </div>
      </DetailCard>

      <DetailCard title="Investigation Report" columns={2}>
        <InfoField label="Current Report Status" value={detail.currentReport?.status || '-'} />
        <InfoField label="Locked" value={reportLocked ? 'YES' : 'NO'} />

        <label className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-gray-500">Facts Summary</div>
          <textarea
            value={reportDraft.factsSummary}
            onChange={(e) => setReportDraft((prev) => ({ ...prev, factsSummary: e.target.value }))}
            disabled={!canEditDraft || reportSaving || reportFinalizing || reportSubmittingToMlro}
            className="mt-1 w-full min-h-24 rounded-lg border border-admin-border px-3 py-2 text-sm disabled:bg-gray-50"
          />
        </label>
        <label className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-gray-500">Investigation Scope</div>
          <textarea
            value={reportDraft.investigationScope}
            onChange={(e) =>
              setReportDraft((prev) => ({ ...prev, investigationScope: e.target.value }))
            }
            disabled={!canEditDraft || reportSaving || reportFinalizing || reportSubmittingToMlro}
            className="mt-1 w-full min-h-24 rounded-lg border border-admin-border px-3 py-2 text-sm disabled:bg-gray-50"
          />
        </label>
        <label className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-gray-500">Evidence Summary</div>
          <textarea
            value={reportDraft.evidenceSummary}
            onChange={(e) => setReportDraft((prev) => ({ ...prev, evidenceSummary: e.target.value }))}
            disabled={!canEditDraft || reportSaving || reportFinalizing || reportSubmittingToMlro}
            className="mt-1 w-full min-h-24 rounded-lg border border-admin-border px-3 py-2 text-sm disabled:bg-gray-50"
          />
        </label>
        <label className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-gray-500">Containment Summary</div>
          <textarea
            value={reportDraft.containmentSummary}
            onChange={(e) =>
              setReportDraft((prev) => ({ ...prev, containmentSummary: e.target.value }))
            }
            disabled={!canEditDraft || reportSaving || reportFinalizing || reportSubmittingToMlro}
            className="mt-1 w-full min-h-24 rounded-lg border border-admin-border px-3 py-2 text-sm disabled:bg-gray-50"
          />
        </label>
        <label className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-gray-500">Analyst Conclusion</div>
          <textarea
            value={reportDraft.analystConclusion}
            onChange={(e) =>
              setReportDraft((prev) => ({ ...prev, analystConclusion: e.target.value }))
            }
            disabled={!canEditDraft || reportSaving || reportFinalizing || reportSubmittingToMlro}
            className="mt-1 w-full min-h-24 rounded-lg border border-admin-border px-3 py-2 text-sm disabled:bg-gray-50"
          />
        </label>
        <label className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-gray-500">Recommended Actions</div>
          <textarea
            value={reportDraft.recommendedActions}
            onChange={(e) =>
              setReportDraft((prev) => ({ ...prev, recommendedActions: e.target.value }))
            }
            disabled={!canEditDraft || reportSaving || reportFinalizing || reportSubmittingToMlro}
            className="mt-1 w-full min-h-24 rounded-lg border border-admin-border px-3 py-2 text-sm disabled:bg-gray-50"
          />
        </label>
        <label className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-gray-500">Final Disposition</div>
          <select
            value={reportDraft.finalDispositionCode}
            onChange={(e) =>
              setReportDraft((prev) => ({
                ...prev,
                finalDispositionCode: e.target.value,
                filingRequired: e.target.value === 'RISK_CONFIRMED' ? prev.filingRequired : false,
                filingType: e.target.value === 'RISK_CONFIRMED' ? prev.filingType : '',
                filingAuthority: e.target.value === 'RISK_CONFIRMED' ? prev.filingAuthority : '',
              }))
            }
            disabled={!canEditDraft || reportSaving || reportFinalizing || reportSubmittingToMlro}
            className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm disabled:bg-gray-50"
          >
            <option value="">Select disposition</option>
            {CASE_REPORT_DISPOSITIONS.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-gray-500">Final Disposition Reason</div>
          <textarea
            value={reportDraft.finalDispositionReason}
            onChange={(e) =>
              setReportDraft((prev) => ({ ...prev, finalDispositionReason: e.target.value }))
            }
            disabled={!canEditDraft || reportSaving || reportFinalizing || reportSubmittingToMlro}
            className="mt-1 w-full min-h-24 rounded-lg border border-admin-border px-3 py-2 text-sm disabled:bg-gray-50"
          />
        </label>
        {showFilingProposalFields ? (
          <>
            <label className="min-w-0 flex items-center gap-2">
              <input
                type="checkbox"
                checked={reportDraft.filingRequired}
                onChange={(e) =>
                  setReportDraft((prev) => ({
                    ...prev,
                    filingRequired: e.target.checked,
                    filingType: e.target.checked ? prev.filingType : '',
                    filingAuthority: e.target.checked ? prev.filingAuthority : '',
                  }))
                }
                disabled={!canEditDraft || reportSaving || reportFinalizing || reportSubmittingToMlro}
              />
              <span className="text-sm text-gray-700">Filing Required</span>
            </label>
            <label className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-gray-500">Filing Type</div>
              <input
                value={reportDraft.filingType}
                onChange={(e) =>
                  setReportDraft((prev) => ({ ...prev, filingType: e.target.value }))
                }
                disabled={
                  !canEditDraft ||
                  !reportDraft.filingRequired ||
                  reportSaving ||
                  reportFinalizing ||
                  reportSubmittingToMlro
                }
                className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm disabled:bg-gray-50"
                placeholder="e.g. SUSPICIOUS_ACTIVITY"
              />
            </label>
            <label className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-gray-500">Filing Authority</div>
              <input
                value={reportDraft.filingAuthority}
                onChange={(e) =>
                  setReportDraft((prev) => ({ ...prev, filingAuthority: e.target.value }))
                }
                disabled={
                  !canEditDraft ||
                  !reportDraft.filingRequired ||
                  reportSaving ||
                  reportFinalizing ||
                  reportSubmittingToMlro
                }
                className="mt-1 w-full rounded-lg border border-admin-border px-3 py-2 text-sm disabled:bg-gray-50"
                placeholder="e.g. FIU / VARA"
              />
            </label>
          </>
        ) : null}
        {!hasValidDispositionForWorkflow ? (
          <div className="xl:col-span-2 text-sm text-amber-700">
            Current workflow proposal and final disposition do not match. `CLEAR` can only pair with `CLEAR` or `FALSE_POSITIVE`; `REJECT / REQUIRE_EDD` must pair with `RISK_CONFIRMED`.
          </div>
        ) : null}
        {!hasValidFilingProposal ? (
          <div className="xl:col-span-2 text-sm text-amber-700">
            Filing type and authority are required when `Filing Required` is enabled.
          </div>
        ) : null}
        <div className="xl:col-span-2 flex flex-wrap gap-2">
          {canEditDraft ? (
            <button
              onClick={() => void saveCaseReportDraft()}
              disabled={reportSaving || reportFinalizing || reportSubmittingToMlro}
              className="rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {reportSaving ? 'Saving...' : 'Save Draft'}
            </button>
          ) : null}
          {canFinalizeReport ? (
            <button
              onClick={() => void finalizeCaseReport()}
              disabled={reportSaving || reportFinalizing || reportSubmittingToMlro}
              className="rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {reportFinalizing ? 'Finalizing...' : 'Finalize Report'}
            </button>
          ) : null}
          {canReviseReport ? (
            <button
              onClick={() => {
                setReportDraft(buildReportDraftState(detail.currentReport));
                setReportRevisionArmed(true);
              }}
              disabled={reportSubmittingToMlro}
              className="rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              Revise Report
            </button>
          ) : null}
          {canSubmitToMlro ? (
            <button
              onClick={() => void submitCaseToMlro()}
              disabled={reportSaving || reportFinalizing || reportSubmittingToMlro}
              className="rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {reportSubmittingToMlro ? 'Submitting...' : 'Submit to MLRO'}
            </button>
          ) : null}
        </div>
        <JsonBlock title="Report History" value={detail.reportHistory || []} compact />
      </DetailCard>

      <ActionSection
        title="External Filing"
        description="External filing is a follow-up track separate from report finalize and MLRO review."
        emptyText="No filing actions available."
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className={`inline-flex px-2 py-1 rounded-full text-xs ${getFilingStatusClass(currentFilingStatus)}`}>
              {currentFilingStatus}
            </span>
          </div>
          {filingActions.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {filingActions.map((action) => (
                <button
                  key={action}
                  onClick={() => {
                    void handleFilingAction(action);
                  }}
                  disabled={acting !== null}
                  className="rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  {acting === action ? 'Processing...' : filingActionLabelMap[action]}
                </button>
              ))}
            </div>
          ) : null}
          <DetailCard title="Current Filing" columns={2}>
            <InfoField label="Status" value={currentFilingStatus} />
            <InfoField label="Filing No" value={detail.currentFiling?.filingNo || '-'} />
            <InfoField label="Type" value={detail.currentFiling?.filingType || '-'} />
            <InfoField label="Authority" value={detail.currentFiling?.filingAuthority || '-'} />
            <InfoField label="External Ref" value={detail.currentFiling?.externalRefNo || '-'} />
            <InfoField label="Required At" value={formatDateTime(detail.currentFiling?.requiredAt)} />
            <InfoField label="Submitted At" value={formatDateTime(detail.currentFiling?.submittedAt)} />
            <InfoField label="Closed At" value={formatDateTime(detail.currentFiling?.closedAt)} />
          </DetailCard>
          <JsonBlock title="Filing History" value={detail.filingHistory || detail.currentFiling?.events || []} compact />
        </div>
      </ActionSection>

      <DetailCard title="Related Alerts & Audit" columns={1}>
        <div className="space-y-6">
          <div>
            <div className="mb-2 text-sm font-medium text-gray-900">Related Alerts</div>
            {detail.alerts.length === 0 ? (
              <div className="text-sm text-gray-500">No linked alerts.</div>
            ) : (
              <div className="space-y-3">
                {detail.alerts.map((link) => (
                  <div
                    key={link.id}
                    className="rounded-lg border border-admin-border p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900">{link.alertNo}</div>
                      <div className="text-sm text-gray-500">
                        {(link.alert?.workflow || detail.workflow || detail.caseType || 'GENERIC')} /{' '}
                        {link.alert?.stage || '-'} / {link.alert?.rule || link.alert?.ruleCode || '-'}
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        navigate(
                          `/dashboard/compliance/alerts/${link.alertId}?from=${encodeURIComponent(
                            `${location.pathname}${location.search}`,
                          )}`,
                        )
                      }
                      className="inline-flex items-center rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      View Alert
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <JsonBlock title="Event Timeline" value={detail.events || []} compact />
          <JsonBlock title="Metadata" value={detail.metadata} compact />
        </div>
      </DetailCard>

      {assignModalOpen ? (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white rounded-xl shadow-xl border border-admin-border">
            <div className="px-4 py-3 border-b border-admin-border flex items-center justify-between">
              <div>
                <h4 className="text-base font-semibold text-gray-900">
                  {detail.status === 'ASSIGNED' || detail.status === 'INVESTIGATING'
                    ? 'Reassign Case'
                    : 'Assign Case'}
                </h4>
                <p className="text-xs text-gray-500">{detail.caseNo || '-'}</p>
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
                onClick={() => void submitAssign()}
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

export default ComplianceCaseDetailPage;
