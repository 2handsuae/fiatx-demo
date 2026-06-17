import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { DetailPageHeader } from '../components/compliance/DetailPageComponents';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';

/* ── Interfaces ──────────────────────────────────────────────── */

interface AssessmentDetail {
  id: string;
  assessmentNo?: string;
  customerId: string;
  status: string;
  triggerType: string;
  previousTier?: string | null;
  resultingTier?: string | null;
  scoreSuggestedTier?: string | null;
  signoffMethod?: string | null;
  signedBy?: string | null;
  signedAt?: string | null;
  recommendedAction?: string | null;
  policyVersion?: string | null;
  reasoning?: string | null;
  reviewAnswer?: string | null;
  rejectLabels?: string | null;
  riskScore?: number | null;
  sumsubSnapshotAt?: string | null;
  sumsubAmlCheckInspectionId?: string | null;
  phase1ApprovalCaseId?: string | null;
  phase2ApprovalCaseId?: string | null;
  approvalCaseId?: string | null;
  triggeredAt?: string | null;
  sumsubAmlCheckRequestedAt?: string | null;
  traceId?: string | null;
  createdAt: string;
  customer: {
    id: string;
    customerNo: string;
    email?: string | null;
    riskTier?: string | null;
    complianceStatus?: string | null;
    sumsubCurrentLevelName?: string | null;
    adminStatus?: string | null;
  };
}

/* ── Layout primitives (mirrors RefreshCycleDetailPage) ──────── */

const Cap = ({ children }: { children: ReactNode }) => (
  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    {children}
  </p>
);

const Field = ({
  label,
  value,
  mono = false,
  amber = false,
  full = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  amber?: boolean;
  full?: boolean;
}) => {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  return (
    <div className={full ? 'col-span-2' : ''}>
      <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
        {label}
      </p>
      <p
        className={[
          'break-all leading-relaxed',
          mono ? 'font-mono text-[10px]' : 'text-[11px]',
          amber ? 'font-semibold text-adm-amber' : 'text-adm-t2',
        ].join(' ')}
      >
        {value}
      </p>
    </div>
  );
};

const SidebarGroup = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="border-b border-adm-border py-4 last:border-b-0">
    <Cap>{title}</Cap>
    <div className="mt-2.5 flex flex-col gap-1.5">{children}</div>
  </div>
);

const SidebarKV = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) => {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 font-mono text-[9px] text-adm-t3">{label}</span>
      <span
        className={[
          'min-w-0 break-all text-right text-adm-t2',
          mono ? 'font-mono text-[10px]' : 'text-[11px]',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
};

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const parseLabels = (v?: string | null): string => {
  if (!v) return '';
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr.join(', ') : v;
  } catch {
    return v;
  }
};

const parseReasoning = (v?: string | null): string => {
  if (!v) return '';
  try {
    const obj = JSON.parse(v);
    if (obj && typeof obj === 'object') {
      if (obj.ruleId) return `Rule: ${obj.ruleId}`;
      return JSON.stringify(obj, null, 2);
    }
    return v;
  } catch {
    return v;
  }
};

/* ── Page ────────────────────────────────────────────────────── */

const RiskAssessmentDetailPage = () => {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<AssessmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  /* ── Fetch ── */

  const fetchDetail = async () => {
    if (!assessmentId) {
      setError('Assessment ID is required.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/compliance/risk-assessments/${assessmentId}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load assessment.'));
      setDetail((await res.json()) as AssessmentDetail);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      if (e instanceof AdminPermissionError) {
        setError('Permission denied.');
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load assessment detail.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
  }, [assessmentId]);

  /* ── Loading / error ── */

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-3">
        <RefreshCw size={24} className="animate-spin text-adm-amber" />
        <p className="font-mono text-[11px] text-adm-t3">Loading…</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <DetailPageHeader
          title="Risk Assessment"
          onBack={() => navigate('/admin/compliance/risk-assessments')}
          onRefresh={() => void fetchDetail()}
          refreshing={loading}
          backLabel="Risk Assessments"
        />
        <div className="px-6 py-6">
          {error ? (
            <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-3 font-mono text-[11px] text-adm-red">
              {error}
            </div>
          ) : (
            <p className="font-mono text-[11px] text-adm-t3">Assessment not found.</p>
          )}
        </div>
      </div>
    );
  }

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <DetailPageHeader
        title="Risk Assessment"
        onBack={() => navigate('/admin/compliance/risk-assessments')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Risk Assessments"
      />

      {/* ── Notices ── */}
      {error && (
        <div className="shrink-0 px-6 pt-3 pb-1 space-y-2">
          <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      )}

      {/* ── Body: two-column layout ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* LEFT MAIN */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">
          {/* Section 1 - Identity */}
          <section className="bg-adm-card px-6 py-5">
            <Cap>Risk Assessment</Cap>
            <p className="mt-1.5 font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {detail.assessmentNo || detail.id.slice(0, 12)}
            </p>
            <p className="mt-1 font-mono text-[13px] text-adm-t2">
              {detail.triggerType}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <AdminBadge value={detail.status} />
              {detail.signoffMethod && <AdminBadge value={detail.signoffMethod} />}
            </div>
            <button
              className={adminButtonClass('rowLink')}
              onClick={() =>
                navigate(`/admin/customers/${detail.customer.id}`)
              }
            >
              {detail.customer.customerNo}
            </button>
          </section>

          {/* Section 2 - AML Result */}
          <section className="px-6 py-5">
            <Cap>AML Result</Cap>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <Field
                label="Review Answer"
                value={
                  detail.reviewAnswer ? (
                    <AdminBadge value={detail.reviewAnswer} />
                  ) : null
                }
              />
              <Field label="Risk Score" value={detail.riskScore != null ? String(detail.riskScore) : null} mono />
              <Field label="Reject Labels" value={parseLabels(detail.rejectLabels)} full />
              <Field label="Snapshot At" value={fmt(detail.sumsubSnapshotAt)} mono />
            </div>
          </section>

          {/* Section 3 - Policy Decision */}
          <section className="px-6 py-5">
            <Cap>Policy Decision</Cap>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <Field
                label="Resulting Tier"
                value={
                  detail.resultingTier ? (
                    <AdminBadge value={detail.resultingTier} />
                  ) : null
                }
              />
              <Field
                label="Previous Tier"
                value={
                  detail.previousTier ? (
                    <AdminBadge value={detail.previousTier} />
                  ) : null
                }
              />
              <Field label="Score Suggested Tier" value={detail.scoreSuggestedTier} />
              <Field label="Recommended Action" value={detail.recommendedAction} />
              <Field label="Signoff Method" value={detail.signoffMethod} />
              <Field label="Policy Version" value={detail.policyVersion} mono />
              <Field label="Reasoning" value={parseReasoning(detail.reasoning)} full />
            </div>
          </section>

          {/* Section 4 - Approval Links (conditional) */}
          {(detail.phase1ApprovalCaseId || detail.phase2ApprovalCaseId || detail.approvalCaseId) && (
            <section className="px-6 py-5">
              <Cap>Approval Links</Cap>
              <div className="mt-3 flex flex-col gap-2">
                {detail.phase1ApprovalCaseId && (
                  <button
                    className={adminButtonClass('rowLink')}
                    onClick={() =>
                      navigate(`/admin/governance/approvals/${detail.phase1ApprovalCaseId}`)
                    }
                  >
                    Phase 1 Approval →
                  </button>
                )}
                {detail.phase2ApprovalCaseId && (
                  <button
                    className={adminButtonClass('rowLink')}
                    onClick={() =>
                      navigate(`/admin/governance/approvals/${detail.phase2ApprovalCaseId}`)
                    }
                  >
                    Phase 2 Approval →
                  </button>
                )}
                {detail.approvalCaseId && !detail.phase1ApprovalCaseId && !detail.phase2ApprovalCaseId && (
                  <button
                    className={adminButtonClass('rowLink')}
                    onClick={() =>
                      navigate(`/admin/governance/approvals/${detail.approvalCaseId}`)
                    }
                  >
                    Approval →
                  </button>
                )}
              </div>
            </section>
          )}

          {/* Section 5 - Timestamps timeline */}
          <section className="px-6 py-5">
            <Cap>Timeline</Cap>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <Field label="Triggered At" value={fmt(detail.triggeredAt)} mono />
              <Field label="AML Check Requested At" value={fmt(detail.sumsubAmlCheckRequestedAt)} mono />
              <Field label="Sumsub Snapshot At" value={fmt(detail.sumsubSnapshotAt)} mono />
              <Field label="Signed At" value={fmt(detail.signedAt)} mono />
            </div>
          </section>
        </div>

        {/* RIGHT SIDEBAR */}
        <div className="hidden w-72 shrink-0 flex-col divide-y divide-adm-border overflow-y-auto border-l border-adm-border bg-adm-panel px-5 pt-5 lg:flex">
          {/* Customer */}
          <SidebarGroup title="Customer">
            <SidebarKV label="Customer No" value={detail.customer.customerNo} />
            <SidebarKV label="Email" value={detail.customer.email} mono />
            <SidebarKV label="Risk Tier" value={detail.customer.riskTier} />
            <SidebarKV
              label="Compliance"
              value={
                detail.customer.complianceStatus &&
                detail.customer.complianceStatus !== 'CLEAR'
                  ? detail.customer.complianceStatus
                  : null
              }
            />
          </SidebarGroup>

          {/* Assessment */}
          <SidebarGroup title="Assessment">
            <SidebarKV label="Assessment No" value={detail.assessmentNo} mono />
            <SidebarKV label="Trigger" value={detail.triggerType} />
            <SidebarKV label="Policy Version" value={detail.policyVersion} mono />
            <SidebarKV label="Trace ID" value={detail.traceId} mono />
          </SidebarGroup>

          {/* Sumsub */}
          <SidebarGroup title="Sumsub">
            <SidebarKV label="Inspection ID" value={detail.sumsubAmlCheckInspectionId} mono />
            <SidebarKV label="Risk Score" value={detail.riskScore != null ? String(detail.riskScore) : null} mono />
            <SidebarKV label="AML Answer" value={detail.reviewAnswer} />
          </SidebarGroup>
        </div>
      </div>
    </div>
  );
};

export default RiskAssessmentDetailPage;
