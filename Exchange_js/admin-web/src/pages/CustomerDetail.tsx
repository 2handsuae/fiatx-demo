import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import RestrictionOpenModal from '../components/RestrictionOpenModal';
import RestrictionReleaseModal from '../components/RestrictionReleaseModal';
import MaterialRequestPanel, { type AdminMaterialRequestRow } from '../components/MaterialRequestPanel';
import MaterialRequestIssueModal from '../components/MaterialRequestIssueModal';
import { DetailPageHeader } from '../components/compliance/DetailPageComponents';
import { ViewAuditTrailButton } from '../components/common/ViewAuditTrailButton';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { AdminBadge } from '../components/ui/AdminBadge';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { scopeLabel, type AdminRestrictionRow } from '../utils/restrictionCauseMeta';
import { useSimulationMode } from '../utils/simulationMode';

/* ── Interfaces ──────────────────────────────────────────────── */

interface PeriodicReviewCycleSummary {
  id: string;
  cycleNo: string;
  status: string;
  dueAt?: string | null;
  triggeredAt?: string | null;
  clearedAt?: string | null;
  rejectedAt?: string | null;
  currentCddResponseId?: string | null;
  currentEddResponseId?: string | null;
  primaryAlertId?: string | null;
  primaryIncidentId?: string | null;
  resolutionReason?: string | null;
}

interface CustomerDetailData {
  id: string;
  customerNo: string;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  customerType: string;
  lifecycle: string;
  riskRating?: string | null;
  eddRequired?: boolean;
  activePeriodicReviewCycleId?: string | null;
  activePeriodicReviewCycle?: PeriodicReviewCycleSummary | null;
  createdAt: string;
  updatedAt?: string | null;
  // Verification (Sumsub) snapshot
  sumsubApplicantId?: string | null;
  sumsubCurrentLevelName?: string | null;
  // CDD (入驻波二 Task 10)
  dateOfBirth?: string | null;
  nationality?: string | null;
  idDocType?: string | null;
  idDocNumber?: string | null;
  residentialAddress?: string | null;
  onboardingSubmittedAt?: string | null;
  onboardingFinalRejectedAt?: string | null;
}

/* ── Customer Tags ───────────────────────────────────────────── */

interface CustomerTagDefinition {
  tagCode: string;
  displayName: string;
  type: 'STATIC' | 'DERIVED';
  description?: string | null;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const displayName = (c: CustomerDetailData): string => {
  if (c.customerType === 'CORPORATE') {
    return (
      c.companyName ||
      `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() ||
      c.customerNo
    );
  }
  return `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || c.companyName || c.customerNo;
};

/* ── Shared layout primitives (copy-pasted per contract §4.2) ─ */

const Cap = ({ children }: { children: ReactNode }) => (
  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    {children}
  </p>
);

const FieldGrid = ({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 }) => (
  <div
    className={[
      'grid gap-x-8 gap-y-4',
      cols === 1 ? 'grid-cols-1' : 'grid-cols-2',
    ].join(' ')}
  >
    {children}
  </div>
);

const Field = ({
  label,
  value,
  mono = false,
  amber = false,
  full = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  amber?: boolean;
  full?: boolean;
}) => {
  if (!value) return null;
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

/* ─────────────────────────────────────────────────────────────── */

const CustomerDetail = () => {
  const { customerNo } = useParams<{ customerNo: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();

  const [detail, setDetail] = useState<CustomerDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [restrictionModalOpen, setRestrictionModalOpen] = useState(false);
  const [materialRequestModalOpen, setMaterialRequestModalOpen] = useState(false);
  const [materialRequestsRefreshKey, setMaterialRequestsRefreshKey] = useState(0);
  const [materialRequestRows, setMaterialRequestRows] = useState<AdminMaterialRequestRow[]>([]);
  const [releaseTarget, setReleaseTarget] = useState<AdminRestrictionRow | null>(null);
  const [restrictions, setRestrictions] = useState<AdminRestrictionRow[]>([]);
  const [restrictionsLoading, setRestrictionsLoading] = useState(false);
  const [showReleased, setShowReleased] = useState(false);

  /* ── Restrictions permissions ── */
  const canReadRestrictions = hasPermission(PERMISSIONS.CUSTOMER_RESTRICTIONS_READ);
  const canWriteRestrictions = hasPermission(PERMISSIONS.CUSTOMER_RESTRICTIONS_WRITE);
  const canReleaseRestrictions = hasPermission(PERMISSIONS.CUSTOMER_RESTRICTIONS_RELEASE);

  /* ── Onboarding acceptance permission ── */
  const canReadAcceptanceCase = hasPermission(PERMISSIONS.CUSTOMER_ONBOARDING_ACCEPTANCE_READ);

  /* ── Tags state ── */
  const canViewTags = hasPermission(PERMISSIONS.CUSTOMER_TAGS_READ);
  const canManageTags = hasPermission(PERMISSIONS.CUSTOMER_TAGS_ASSIGN);
  const [tagCatalog, setTagCatalog] = useState<CustomerTagDefinition[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagBusyCode, setTagBusyCode] = useState<string | null>(null);
  const [tagAddValue, setTagAddValue] = useState('');
  const [tagError, setTagError] = useState<string | null>(null);
  const [removeTagTarget, setRemoveTagTarget] = useState<string | null>(null);
  const [removeTagReason, setRemoveTagReason] = useState('');

  const [tierMessage, setTierMessage] = useState<string | null>(null);

  /* ── Onboarding acceptance + ⚡ simulation state ── */
  const { enabled: simEnabled } = useSimulationMode();
  const [acceptanceCase, setAcceptanceCase] = useState<{ approvalNo: string; status: string } | null>(null);
  const [acceptanceSubmitting, setAcceptanceSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [simBusy, setSimBusy] = useState<string | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

  /* ── Tier upgrade + ⚡ simulation state（波三 Task 13，语义对齐上面入驻一段） ── */
  const [tierUpgrade, setTierUpgrade] = useState<{
    tradingTier: string;
    application: { upgradeNo: string; status: string; materialsSubmittedAt: string | null; createdAt: string; decidedAt: string | null } | null;
    acceptanceCase: { approvalNo: string; status: string } | null;
  } | null>(null);
  const [tierUpgradeSubmitting, setTierUpgradeSubmitting] = useState(false);
  const [tierUpgradeSimBusy, setTierUpgradeSimBusy] = useState<string | null>(null);
  const [tierUpgradeError, setTierUpgradeError] = useState<string | null>(null);

  /* ── Risk Assessment trigger state ── */

  /* ── Fetching ── */

  const fetchDetail = async () => {
    if (!customerNo) {
      setError('Customer number is required.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/customers/${customerNo}`);
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load customer.'));
      setDetail((await res.json()) as CustomerDetailData);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      if (e instanceof AdminPermissionError) {
        setError('Permission denied. You cannot view this customer.');
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load customer.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerNo]);

  /* Auto-dismiss notice */
  useEffect(() => {
    if (!notice) return undefined;
    const t = window.setTimeout(
      () => setNotice((c) => (c === notice ? null : c)),
      4000,
    );
    return () => window.clearTimeout(t);
  }, [notice]);

  /* Auto-dismiss tier message */
  useEffect(() => {
    if (!tierMessage) return undefined;
    const t = window.setTimeout(
      () => setTierMessage((c) => (c === tierMessage ? null : c)),
      5000,
    );
    return () => window.clearTimeout(t);
  }, [tierMessage]);

  /* ── Tags fetching ── */
  const fetchTagCatalog = () => {
    adminFetch(`${import.meta.env.VITE_API_URL}/admin/customer-tags/catalog`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: CustomerTagDefinition[]) => setTagCatalog(Array.isArray(d) ? d : []))
      .catch(() => {});
  };

  const fetchTags = (customerNo: string) => {
    setTagsLoading(true);
    adminFetch(`${import.meta.env.VITE_API_URL}/admin/customers/${customerNo}/effective-tags`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: string[]) => setTags(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setTagsLoading(false));
  };

  useEffect(() => {
    if (canViewTags) fetchTagCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewTags]);

  useEffect(() => {
    if (canViewTags && detail?.customerNo) fetchTags(detail.customerNo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewTags, detail?.customerNo]);

  /* ── Restrictions fetching ── */
  const fetchRestrictions = (customerNo: string) => {
    setRestrictionsLoading(true);
    adminFetch(`${import.meta.env.VITE_API_URL}/admin/customers/${customerNo}/restrictions`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: AdminRestrictionRow[]) => setRestrictions(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setRestrictionsLoading(false));
  };

  useEffect(() => {
    if (canReadRestrictions && detail?.customerNo) fetchRestrictions(detail.customerNo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReadRestrictions, detail?.customerNo]);

  /* ── Onboarding acceptance case fetching（spec §5/§7：单子提了没，从关联审批单推导展示） ── */
  const fetchAcceptanceCase = (customerNo: string) => {
    adminFetch(`${import.meta.env.VITE_API_URL}/admin/customers/${customerNo}/onboarding-acceptance`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { approvalNo: string; status: string } | null) => setAcceptanceCase(d))
      .catch(() => {});
  };

  useEffect(() => {
    if (canReadAcceptanceCase && detail?.customerNo) fetchAcceptanceCase(detail.customerNo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReadAcceptanceCase, detail?.customerNo]);

  /* ── Tier upgrade fetching（波三 Task 13：当前档 + 申请单 + 关联审批单，随详情加载） ── */
  const fetchTierUpgrade = (customerNo: string) => {
    adminFetch(`${import.meta.env.VITE_API_URL}/admin/customers/${customerNo}/tier-upgrade`)
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          d: {
            tradingTier: string;
            application: { upgradeNo: string; status: string; materialsSubmittedAt: string | null; createdAt: string; decidedAt: string | null } | null;
            acceptanceCase: { approvalNo: string; status: string } | null;
          } | null,
        ) => setTierUpgrade(d),
      )
      .catch(() => {});
  };

  useEffect(() => {
    if (detail?.customerNo) fetchTierUpgrade(detail.customerNo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.customerNo]);

  const handleAddTag = async () => {
    if (!detail || !tagAddValue) return;
    setTagBusyCode(tagAddValue);
    setTagError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/customers/${detail.customerNo}/tags`,
        { method: 'POST', body: JSON.stringify({ tagCode: tagAddValue }) },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to add tag.'));
      setTagAddValue('');
      fetchTags(detail.customerNo);
    } catch (e: unknown) {
      if (e instanceof AdminPermissionError) {
        setTagError('Permission denied. You cannot add tags.');
      } else {
        setTagError(e instanceof Error ? e.message : 'Failed to add tag.');
      }
    } finally {
      setTagBusyCode(null);
    }
  };

  const handleRemoveTag = async () => {
    if (!detail || !removeTagTarget || !removeTagReason.trim()) return;
    const tagCode = removeTagTarget;
    setTagBusyCode(tagCode);
    setTagError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/customers/${detail.customerNo}/tags/${tagCode}`,
        {
          method: 'DELETE',
          body: JSON.stringify({ reason: removeTagReason.trim() }),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to remove tag.'));
      setRemoveTagTarget(null);
      setRemoveTagReason('');
      fetchTags(detail.customerNo);
    } catch (e: unknown) {
      if (e instanceof AdminPermissionError) {
        setTagError('Permission denied. You cannot remove tags.');
      } else {
        setTagError(e instanceof Error ? e.message : 'Failed to remove tag.');
      }
    } finally {
      setTagBusyCode(null);
    }
  };

  /* ── Onboarding acceptance (maker→checker 提单) ── */
  const submitAcceptance = async () => {
    if (!detail) return;
    const reason = window.prompt('Reason for acceptance request');
    if (!reason) return;
    setAcceptanceSubmitting(true);
    setActionError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/customers/${detail.customerNo}/onboarding-acceptance`,
        { method: 'POST', body: JSON.stringify({ reason }) },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to submit acceptance request.'));
      await res.json();
      if (canReadAcceptanceCase) fetchAcceptanceCase(detail.customerNo);
      void fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      if (e instanceof AdminPermissionError) {
        setActionError('Permission denied. You cannot submit this request.');
      } else {
        setActionError(e instanceof Error ? e.message : 'Failed to submit acceptance request.');
      }
    } finally {
      setAcceptanceSubmitting(false);
    }
  };

  /* ── ⚡ Onboarding simulation ── */
  const runOnboardingVerdict = async (
    reviewAnswer: 'GREEN' | 'RED',
    reviewRejectType?: 'RETRY' | 'FINAL',
  ) => {
    if (!detail) return;
    const key = reviewAnswer === 'GREEN' ? 'APPROVE' : `REJECT_${reviewRejectType}`;
    setSimBusy(key);
    setSimError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/sumsub/simulate/onboarding-review-result`,
        {
          method: 'POST',
          body: JSON.stringify({ customerNo: detail.customerNo, reviewAnswer, reviewRejectType }),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Verdict run failed.'));
      void fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setSimError(e instanceof Error ? e.message : 'Verdict run failed.');
    } finally {
      setSimBusy(null);
    }
  };

  const runEscalateToEdd = async () => {
    if (!detail) return;
    setSimBusy('ESCALATE');
    setSimError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/sumsub/simulate/onboarding-level-change`,
        { method: 'POST', body: JSON.stringify({ customerNo: detail.customerNo }) },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Escalation failed.'));
      void fetchDetail();
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setSimError(e instanceof Error ? e.message : 'Escalation failed.');
    } finally {
      setSimBusy(null);
    }
  };

  /* ── Tier upgrade acceptance submit（运营提单，maker→checker，语义对齐上面 submitAcceptance） ── */
  const submitTierUpgradeAcceptance = async () => {
    if (!detail) return;
    const reason = window.prompt('Reason for tier upgrade acceptance request');
    if (!reason) return;
    setTierUpgradeSubmitting(true);
    setTierUpgradeError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/customers/${detail.customerNo}/tier-upgrade-acceptance`,
        { method: 'POST', body: JSON.stringify({ reason }) },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to submit tier upgrade acceptance request.'));
      await res.json();
      fetchTierUpgrade(detail.customerNo);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      if (e instanceof AdminPermissionError) {
        setTierUpgradeError('Permission denied. You cannot submit this request.');
      } else {
        setTierUpgradeError(e instanceof Error ? e.message : 'Failed to submit tier upgrade acceptance request.');
      }
    } finally {
      setTierUpgradeSubmitting(false);
    }
  };

  /* ── ⚡ Tier upgrade simulation ── */
  const runTierUpgradeVerdict = async (
    reviewAnswer: 'GREEN' | 'RED',
    reviewRejectType?: 'RETRY' | 'FINAL',
  ) => {
    if (!detail) return;
    const key = reviewAnswer === 'GREEN' ? 'TIER_APPROVE' : `TIER_REJECT_${reviewRejectType}`;
    setTierUpgradeSimBusy(key);
    setTierUpgradeError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/sumsub/simulate/tier-upgrade-review-result`,
        {
          method: 'POST',
          body: JSON.stringify({ customerNo: detail.customerNo, reviewAnswer, reviewRejectType }),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Verdict run failed.'));
      fetchTierUpgrade(detail.customerNo);
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setTierUpgradeError(e instanceof Error ? e.message : 'Verdict run failed.');
    } finally {
      setTierUpgradeSimBusy(null);
    }
  };

  /* ── Derived booleans ── */

  const hasPeriodicReview = useMemo(
    () =>
      !!detail?.activePeriodicReviewCycle ||
      !!detail?.activePeriodicReviewCycleId,
    [detail],
  );
  const hasVerification = useMemo(() => !!detail?.sumsubApplicantId, [detail]);

  /* ── Loading / error stubs ── */

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-3">
        <RefreshCw size={24} className="animate-spin text-adm-amber" />
        <p className="font-mono text-[11px] text-adm-t3">Loading…</p>
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4 flex items-center gap-2">
          <button
            onClick={() => navigate('/admin/customers')}
            className={adminButtonClass('detailUtility')}
          >
            ← Back
          </button>
          <button onClick={() => void fetchDetail()} className={adminButtonClass('detailUtility')}>
            <RefreshCw size={13} />
            Retry
          </button>
        </div>
        <div className="px-6 py-6">
          <div className="rounded-lg border border-adm-red/30 bg-adm-red/10 px-4 py-3 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4 flex items-center gap-2">
          <button
            onClick={() => navigate('/admin/customers')}
            className={adminButtonClass('detailUtility')}
          >
            ← Back
          </button>
        </div>
        <div className="px-6 py-6 font-mono text-[11px] text-adm-t3">
          Customer not found.
        </div>
      </div>
    );
  }

  const name = displayName(detail);
  const isCorporate = detail.customerType === 'CORPORATE';
  const openRestrictions = restrictions.filter((r) => r.status === 'OPEN');
  const releasedRestrictions = restrictions.filter((r) => r.status === 'RELEASED');
  // 材料终拒 = 离场出口（decisions.md 2026-09-06 业主拍板）：任一材料请求走到
  // REJECTED（RED · FINAL）即触发，RETRY 不算——见 material-request.constant.ts。
  const hasFinalMaterialRejection = materialRequestRows.some((r) => r.status === 'REJECTED');
  // ⚡ 入驻模拟按钮可用性（task-10-brief.md Step 3）。
  const canVerdict = detail.lifecycle === 'IN_VERIFICATION' && detail.onboardingSubmittedAt != null;
  const canEscalate = canVerdict && detail.sumsubCurrentLevelName === 'basic-cdd-level';
  const canRequestAcceptance = hasPermission(PERMISSIONS.CUSTOMER_ONBOARDING_ACCEPT_WRITE);
  const canRequestTierUpgradeAcceptance = hasPermission(PERMISSIONS.CUSTOMER_TIER_UPGRADE_ACCEPT_WRITE);
  // 「单子提了没」展示口径（spec §5）：PENDING_APPROVAL 待提/审批中、ACTIVE/REJECTED 是裁决后的落点；
  // 已有关联单（acceptanceCase 非空）时其余 lifecycle 也一并显示，不藏历史单据。
  const showAcceptanceStatus =
    ['PENDING_APPROVAL', 'ACTIVE', 'REJECTED'].includes(detail.lifecycle) || acceptanceCase !== null;
  // ⚡ 档位升级模拟按钮可用性（task-13-brief.md Step 3，语义对齐上面 canVerdict）。
  const canTierVerdict =
    tierUpgrade?.application?.status === 'IN_REVIEW' && tierUpgrade.application.materialsSubmittedAt != null;
  // 提单钮可用性：申请单已到 MATERIALS_CLEARED，且没有一张在批（DRAFT/PENDING）的关联审批单——
  // 与后端 submitAcceptance 的 open-case 校验（tier-upgrade-workflow.service.ts）口径一致。
  const canSubmitTierUpgradeAcceptance =
    tierUpgrade?.application?.status === 'MATERIALS_CLEARED' &&
    !(tierUpgrade?.acceptanceCase && ['DRAFT', 'PENDING'].includes(tierUpgrade.acceptanceCase.status));

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Sticky header ── */}
      <DetailPageHeader
        title="Customer"
        onBack={() => navigate('/admin/customers')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Customer Management"
      >
        <ViewAuditTrailButton params={{ ownerCustomerNo: customerNo! }} />
      </DetailPageHeader>

      {/* ── Inline notices ── */}
      {(notice || error) && (
        <div className="shrink-0 px-6 pt-3 pb-1 space-y-2">
          {notice && (
            <div className="rounded border border-adm-green/30 bg-adm-green/10 px-4 py-2 font-mono text-[11px] text-adm-green">
              {notice}
            </div>
          )}
          {error && (
            <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
              {error}
            </div>
          )}
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ① Identity (hero) */}
          <section className="bg-adm-card px-6 py-5">
            <Cap>Customer</Cap>
            <p className="mt-1.5 font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {detail.customerNo}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <AdminBadge value={detail.lifecycle} />
              {openRestrictions.length > 0 && (
                <span className="inline-flex items-center rounded border border-adm-red/25 bg-adm-red/10 px-1.5 py-px font-mono text-[9px] font-semibold text-adm-red">
                  {openRestrictions.length} RESTRICTION{openRestrictions.length === 1 ? '' : 'S'}
                </span>
              )}
              {/* 材料终拒待离场（第二幕波一；decisions.md 2026-09-06）：只读展示，无按钮 */}
              {hasFinalMaterialRejection && (
                <span className="inline-flex items-center rounded border border-adm-red/25 bg-adm-red/10 px-1.5 py-px font-mono text-[9px] font-semibold text-adm-red">
                  Due diligence incomplete · pending offboarding
                </span>
              )}
              {/* 入驻终拒（第二幕波二 Task 10）：与上面材料终拒同样式的只读徽章，
                  语境不同——这是入驻裁决本身走到 FINAL，不可再申请。 */}
              {detail.onboardingFinalRejectedAt && (
                <span className="inline-flex items-center rounded border border-adm-red/25 bg-adm-red/10 px-1.5 py-px font-mono text-[9px] font-semibold text-adm-red">
                  Due diligence final rejection · cannot reapply
                </span>
              )}
            </div>
            <div className="mt-4 border-t border-adm-border pt-4">
              <p className="font-mono text-[11px] text-adm-t2">{name}</p>
            </div>
          </section>

          {/* Onboarding —— 入驻状态卡（第二幕波二 Task 10）。准入核准走
              maker(运营)→checker(高管) 单步审批；关联单状态经
              GET :customerNo/onboarding-acceptance 推导展示，刷新不丢（终审补齐）。 */}
          <section className="px-6 py-5">
            <Cap>Onboarding</Cap>
            <div className="mt-3">
              <FieldGrid>
                <Field label="Verification Level" value={detail.sumsubCurrentLevelName || '—'} mono />
                <Field label="EDD Required" value={detail.eddRequired ? 'YES' : 'NO'} />
                <Field label="Submitted At" value={fmt(detail.onboardingSubmittedAt)} mono />
              </FieldGrid>
            </div>
            {actionError && (
              <div className="mt-3 rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
                {actionError}
              </div>
            )}
            {canReadAcceptanceCase && showAcceptanceStatus && (
              <p className="mt-3 font-mono text-[10px] text-adm-t2">
                Acceptance approval:{' '}
                <span className="font-semibold text-adm-amber">
                  {acceptanceCase ? `${acceptanceCase.approvalNo} (${acceptanceCase.status})` : 'Not requested'}
                </span>
              </p>
            )}
            {detail.lifecycle === 'PENDING_APPROVAL' && canRequestAcceptance && (
              <div className="mt-4">
                <button
                  onClick={() => void submitAcceptance()}
                  disabled={acceptanceSubmitting}
                  className={adminButtonClass('workflowPrimary')}
                >
                  {acceptanceSubmitting ? 'Submitting…' : 'Submit for Approval'}
                </button>
              </div>
            )}
          </section>

          {/* Tier Upgrade —— 档位升级状态卡（第二幕波三 Task 13）。核准同样走
              maker(运营)→checker(高管) 单步审批，语义与上面 Onboarding 完全对齐；
              关联单状态经 GET :customerNo/tier-upgrade 推导展示。 */}
          <section className="px-6 py-5">
            <Cap>Tier Upgrade</Cap>
            <div className="mt-3">
              <FieldGrid>
                <Field label="Current Tier" value={tierUpgrade?.tradingTier || '—'} mono />
                <Field
                  label="Application"
                  value={
                    tierUpgrade?.application
                      ? `${tierUpgrade.application.upgradeNo} · ${tierUpgrade.application.status}`
                      : 'No upgrade application'
                  }
                  mono
                />
                <Field label="Materials Submitted At" value={fmt(tierUpgrade?.application?.materialsSubmittedAt)} mono />
              </FieldGrid>
            </div>
            {tierUpgradeError && (
              <div className="mt-3 rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
                {tierUpgradeError}
              </div>
            )}
            <p className="mt-3 font-mono text-[10px] text-adm-t2">
              Acceptance approval:{' '}
              <span className="font-semibold text-adm-amber">
                {tierUpgrade?.acceptanceCase
                  ? `${tierUpgrade.acceptanceCase.approvalNo} (${tierUpgrade.acceptanceCase.status})`
                  : 'Not requested'}
              </span>
            </p>
            {canSubmitTierUpgradeAcceptance && canRequestTierUpgradeAcceptance && (
              <div className="mt-4">
                <button
                  onClick={() => void submitTierUpgradeAcceptance()}
                  disabled={tierUpgradeSubmitting}
                  className={adminButtonClass('workflowPrimary')}
                >
                  {tierUpgradeSubmitting ? 'Submitting…' : 'Submit for Approval'}
                </button>
              </div>
            )}
          </section>

          {/* ⚡ Onboarding Simulation —— 模拟 Sumsub 入驻回调；用色/字号/按钮态对齐
              三域交易详情共用 SimulationPanel（DepositTransactionDetail.tsx 等），
              但入驻的按钮集合、可用性条件都不一样，也没有对应的后端
              verdict-buttons 元数据端点，故本页直接写死四个按钮。 */}
          {simEnabled && (
            <section className="px-6 py-5">
              <Cap>⚡ Onboarding Simulation</Cap>
              <p className="mt-1 mb-4 font-mono text-[9px] text-adm-t3">
                Feed a simulated Sumsub applicant-review verdict for this customer's onboarding.
              </p>
              {simError && (
                <div className="mb-3 rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
                  {simError}
                </div>
              )}
              <div className="mb-3">
                {!canVerdict && (
                  <p className="mb-1.5 font-mono text-[9px] text-adm-amber">
                    Verdict buttons are unavailable — the customer is not under onboarding review or has not submitted materials yet.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => void runOnboardingVerdict('GREEN')}
                    disabled={!canVerdict || simBusy !== null}
                    className={adminButtonClass('simulationAction')}
                  >
                    {simBusy === 'APPROVE' ? 'Running…' : 'Approve (GREEN)'}
                  </button>
                  <button
                    onClick={() => void runOnboardingVerdict('RED', 'RETRY')}
                    disabled={!canVerdict || simBusy !== null}
                    className={adminButtonClass('simulationAction')}
                  >
                    {simBusy === 'REJECT_RETRY' ? 'Running…' : 'Reject – Retry'}
                  </button>
                  <button
                    onClick={() => void runOnboardingVerdict('RED', 'FINAL')}
                    disabled={!canVerdict || simBusy !== null}
                    className={adminButtonClass('simulationAction')}
                  >
                    {simBusy === 'REJECT_FINAL' ? 'Running…' : 'Reject – Final'}
                  </button>
                </div>
              </div>
              <div>
                {!canEscalate && (
                  <p className="mb-1.5 font-mono text-[9px] text-adm-amber">
                    {canVerdict
                      ? 'Escalate to EDD is unavailable — the customer is not at the basic-cdd-level tier.'
                      : 'Escalate to EDD is unavailable — the customer is not under onboarding review or has not submitted materials yet.'}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => void runEscalateToEdd()}
                    disabled={!canEscalate || simBusy !== null}
                    className={adminButtonClass('simulationAction')}
                  >
                    {simBusy === 'ESCALATE' ? 'Running…' : 'Escalate to EDD'}
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* ⚡ Tier Upgrade Simulation —— 模拟 Sumsub 档位升级回调；语义与
              上面 ⚡ Onboarding Simulation 完全对齐（GREEN 转 MATERIALS_CLEARED，
              RED+RETRY 停留 IN_REVIEW 重开会话，RED+FINAL 转 REJECTED）。 */}
          {simEnabled && (
            <section className="px-6 py-5">
              <Cap>⚡ Tier Upgrade Simulation</Cap>
              <p className="mt-1 mb-4 font-mono text-[9px] text-adm-t3">
                Feed a simulated Sumsub applicant-review verdict for this customer's tier upgrade.
              </p>
              {tierUpgradeError && (
                <div className="mb-3 rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
                  {tierUpgradeError}
                </div>
              )}
              {!canTierVerdict && (
                <p className="mb-1.5 font-mono text-[9px] text-adm-amber">
                  Verdict buttons are unavailable — the customer has no tier upgrade application under review or has not submitted materials yet.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void runTierUpgradeVerdict('GREEN')}
                  disabled={!canTierVerdict || tierUpgradeSimBusy !== null}
                  className={adminButtonClass('simulationAction')}
                >
                  {tierUpgradeSimBusy === 'TIER_APPROVE' ? 'Running…' : 'Approve (GREEN)'}
                </button>
                <button
                  onClick={() => void runTierUpgradeVerdict('RED', 'RETRY')}
                  disabled={!canTierVerdict || tierUpgradeSimBusy !== null}
                  className={adminButtonClass('simulationAction')}
                >
                  {tierUpgradeSimBusy === 'TIER_REJECT_RETRY' ? 'Running…' : 'Reject – Retry'}
                </button>
                <button
                  onClick={() => void runTierUpgradeVerdict('RED', 'FINAL')}
                  disabled={!canTierVerdict || tierUpgradeSimBusy !== null}
                  className={adminButtonClass('simulationAction')}
                >
                  {tierUpgradeSimBusy === 'TIER_REJECT_FINAL' ? 'Running…' : 'Reject – Final'}
                </button>
              </div>
            </section>
          )}

          {/* Tags */}
          {canViewTags && (
            <section className="px-6 py-5">
              <Cap>Tags</Cap>
              <p className="mt-1 mb-4 font-mono text-[9px] text-adm-t3">
                Manual tags plus system-derived classifications
              </p>
              {tagError && (
                <div className="mb-3 rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
                  {tagError}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {tagsLoading && tags.length === 0 ? (
                  <span className="font-mono text-[10px] text-adm-t3">Loading…</span>
                ) : tags.length === 0 ? (
                  <span className="font-mono text-[10px] text-adm-t3">No tags.</span>
                ) : (
                  tags.map((tagCode) => {
                    const def = tagCatalog.find((t) => t.tagCode === tagCode);
                    const label = def?.displayName || tagCode;
                    if (def?.type === 'DERIVED') {
                      return (
                        <span
                          key={tagCode}
                          title={def.description ?? undefined}
                          className="inline-flex items-center rounded border border-adm-t3/25 bg-adm-t3/10 px-2 py-0.5 font-mono text-[10px] text-adm-t3"
                        >
                          {label}
                        </span>
                      );
                    }
                    return (
                      <span
                        key={tagCode}
                        title={def?.description ?? undefined}
                        className="inline-flex items-center gap-1.5 rounded border border-adm-blue/25 bg-adm-blue/10 px-2 py-0.5 font-mono text-[10px] text-adm-blue"
                      >
                        {label}
                        {canManageTags && (
                          <button
                            onClick={() => { setRemoveTagTarget(tagCode); setRemoveTagReason(''); setTagError(null); }}
                            disabled={tagBusyCode === tagCode}
                            aria-label={`Remove ${label}`}
                            className="text-adm-blue/70 hover:text-adm-red disabled:opacity-40"
                          >
                            ×
                          </button>
                        )}
                      </span>
                    );
                  })
                )}
              </div>
              {canManageTags && (
                <div className="mt-4 flex items-center gap-2">
                  <select
                    value={tagAddValue}
                    onChange={(e) => setTagAddValue(e.target.value)}
                    className="rounded border border-adm-border bg-adm-bg px-2 py-1.5 font-mono text-[10px] text-adm-t2 focus:border-adm-amber focus:outline-none"
                  >
                    <option value="">Add tag…</option>
                    {tagCatalog
                      .filter((t) => t.type === 'STATIC' && !tags.includes(t.tagCode))
                      .map((t) => (
                        <option key={t.tagCode} value={t.tagCode}>
                          {t.displayName}
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={() => void handleAddTag()}
                    disabled={!tagAddValue || tagBusyCode === tagAddValue}
                    className={adminButtonClass('detailUtility')}
                  >
                    {tagBusyCode && tagBusyCode === tagAddValue ? 'Adding…' : 'Add'}
                  </button>
                </div>
              )}
            </section>
          )}

          {/* ② Profile */}
          <section className="px-6 py-5">
            <Cap>Profile</Cap>
            <div className="mt-3">
              <FieldGrid>
                <Field label="Customer Type" value={detail.customerType} />
                <Field label="Display Name" value={name} />
                <Field label="Email" value={detail.email ?? undefined} mono />
                <Field label="Phone" value={detail.phone ?? undefined} mono />
                {!isCorporate && (
                  <>
                    <Field label="First Name" value={detail.firstName ?? undefined} />
                    <Field label="Last Name" value={detail.lastName ?? undefined} />
                  </>
                )}
                {isCorporate && (
                  <Field
                    label="Company Name"
                    value={detail.companyName ?? undefined}
                    full
                  />
                )}
                {/* CDD 五字段（第二幕波二 Task 10）：空值显 — */}
                <Field label="Date of Birth" value={detail.dateOfBirth || '—'} />
                <Field label="Nationality" value={detail.nationality || '—'} />
                <Field label="ID Type" value={detail.idDocType || '—'} />
                <Field label="ID Number" value={detail.idDocNumber || '—'} mono />
                <Field label="Residential Address" value={detail.residentialAddress || '—'} full />
              </FieldGrid>
            </div>
          </section>

          {/* ③ Compliance Snapshot */}
          <section className="px-6 py-5">
            <Cap>Compliance</Cap>
            <p className="mt-1 mb-4 font-mono text-[9px] text-adm-t3">
              Canonical lifecycle and risk snapshot
            </p>
            <div className="mt-3">
              <FieldGrid>
                <Field label="Lifecycle" value={detail.lifecycle} />
                <Field label="Risk Rating" value={detail.riskRating || undefined} />
                <Field label="EDD Required" value={detail.eddRequired ? 'YES' : 'NO'} />
              </FieldGrid>
            </div>
          </section>

          {/* ④ Verification (Sumsub) */}
          {hasVerification && (
            <section className="px-6 py-5">
              <Cap>Verification</Cap>
              <p className="mt-1 mb-4 font-mono text-[9px] text-adm-t3">
                Identity provider snapshot — SDK identifiers
              </p>
              <FieldGrid>
                <Field label="Current Level" value={detail.sumsubCurrentLevelName ?? undefined} />
                <Field label="Applicant ID" value={detail.sumsubApplicantId ?? undefined} mono />
              </FieldGrid>
            </section>
          )}

          {/* 客户名下交易入口（第二幕③联动走查用；铁律⑥ 参数用业务键） */}
          <section className="px-6 py-5">
            <Cap>Transactions</Cap>
            <p className="mt-1 mb-3 font-mono text-[9px] text-adm-t3">
              Jump to this customer's transactions in each trading domain.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                to={`/admin/trading/deposits?ownerNo=${detail.customerNo}`}
                className={adminButtonClass('detailUtility')}
              >
                Deposits →
              </Link>
              <Link
                to={`/admin/trading/withdrawals?ownerNo=${detail.customerNo}`}
                className={adminButtonClass('detailUtility')}
              >
                Withdrawals →
              </Link>
              <Link
                to={`/admin/trading/swaps?ownerNo=${detail.customerNo}`}
                className={adminButtonClass('detailUtility')}
              >
                Swaps →
              </Link>
            </div>
          </section>

          {/* ⑤ Restrictions —— 一行一张便签；🔇 = SILENT，后台可见客户不可见 */}
          {canReadRestrictions && (
            <section className="px-6 py-5">
              <div className="flex items-baseline justify-between gap-3">
                <Cap>Restrictions</Cap>
                <span className="font-mono text-[10px] text-adm-t3">
                  {restrictionsLoading ? 'Loading…' : `${openRestrictions.length} open`}
                </span>
              </div>
              <p className="mt-1 mb-3 font-mono text-[9px] text-adm-t3">
                One row = one restriction. 🔇 marks SILENT — visible here, never to the customer.
              </p>

              {openRestrictions.length === 0 ? (
                <p className="font-mono text-[10px] text-adm-t3">No open restrictions.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        {(['Restriction No', 'Blocked', 'Cause', 'Opened', 'Opened By', ''] as string[]).map(
                          (h, i) => (
                            <th
                              key={h || `open-col-${i}`}
                              className="border-b border-adm-border bg-adm-panel px-3 py-1.5 text-left font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                            >
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {openRestrictions.map((r) => (
                        <Fragment key={r.restrictionNo}>
                          <tr>
                            <td className="px-3 pt-2 font-mono text-[11px] font-semibold text-adm-amber whitespace-nowrap">
                              {r.restrictionNo}
                            </td>
                            <td className="px-3 pt-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                              {scopeLabel(r.scopes)}
                            </td>
                            <td className="px-3 pt-2 whitespace-nowrap">
                              <span
                                className={[
                                  'inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[10px] font-semibold',
                                  r.visibility === 'SILENT'
                                    ? 'border-adm-red/25 bg-adm-red/10 text-adm-red'
                                    : 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber',
                                ].join(' ')}
                              >
                                {r.cause}
                                {r.visibility === 'SILENT' && (
                                  <span title="SILENT — never shown to the customer">🔇</span>
                                )}
                              </span>
                            </td>
                            <td className="px-3 pt-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                              {fmt(r.openedAt)}
                            </td>
                            <td className="px-3 pt-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                              {r.openedBy || '—'}
                            </td>
                            <td className="px-3 pt-2 text-right whitespace-nowrap">
                              {canReleaseRestrictions ? (
                                <button
                                  className={adminButtonClass('rowLink')}
                                  onClick={() => setReleaseTarget(r)}
                                >
                                  Release →
                                </button>
                              ) : (
                                <span className="font-mono text-[10px] text-adm-t3">—</span>
                              )}
                            </td>
                          </tr>
                          <tr className="border-b border-adm-border">
                            <td
                              colSpan={6}
                              className="px-3 pb-2 font-mono text-[9px] leading-relaxed text-adm-t3"
                            >
                              {r.reason}
                              {r.caseRef ? ` · ${r.caseRef}` : ''}
                            </td>
                          </tr>
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {releasedRestrictions.length > 0 && (
                <div className="mt-3">
                  <button
                    className={adminButtonClass('rowSecondaryUtility')}
                    onClick={() => setShowReleased((v) => !v)}
                  >
                    Released ({releasedRestrictions.length}) {showReleased ? '▾' : '▸'}
                  </button>
                  {showReleased && (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr>
                            {(['Restriction No', 'Blocked', 'Cause', 'Released', 'Approval', 'Mode'] as string[]).map(
                              (h) => (
                                <th
                                  key={h}
                                  className="border-b border-adm-border bg-adm-panel px-3 py-1.5 text-left font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                                >
                                  {h}
                                </th>
                              ),
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {releasedRestrictions.map((r) => (
                            <tr key={r.restrictionNo} className="border-b border-adm-border">
                              <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                                {r.restrictionNo}
                              </td>
                              <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                                {scopeLabel(r.scopes)}
                              </td>
                              <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                                {r.cause}
                                {r.visibility === 'SILENT' ? ' 🔇' : ''}
                              </td>
                              <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                                {fmt(r.releasedAt)} · {r.releasedBy || '—'}
                              </td>
                              <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                                {r.releaseApprovalNo || '—'}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap">
                                <AdminBadge value={r.releaseMode || 'MANUAL'} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ⑥ Verification Requests —— 这个客户当前所有的材料下发（含终态） */}
          <section className="px-6 py-5">
            <div className="flex items-baseline justify-between gap-3">
              <Cap>Verification Requests</Cap>
              {hasPermission(PERMISSIONS.MATERIAL_REQUESTS_WRITE) && (
                <button
                  onClick={() => setMaterialRequestModalOpen(true)}
                  className={adminButtonClass('rowSecondaryUtility')}
                >
                  Request Documents
                </button>
              )}
            </div>
            <p className="mt-1 mb-3 font-mono text-[9px] text-adm-t3">
              One row = one issuance. Rows without a restriction are reminders only.
            </p>
            <MaterialRequestPanel
              mode="customer"
              customerNo={detail.customerNo}
              refreshKey={materialRequestsRefreshKey}
              onChanged={() => fetchRestrictions(detail.customerNo)}
              onRowsChange={setMaterialRequestRows}
            />
          </section>

          {/* ⑧ Periodic Review */}
          {hasPeriodicReview && (
            <section className="px-6 py-5">
              <Cap>Periodic Review</Cap>
              <div className="mt-3">
                <FieldGrid>
                  <Field
                    label="Active Cycle"
                    value={
                      detail.activePeriodicReviewCycle?.cycleNo ||
                      detail.activePeriodicReviewCycleId ||
                      undefined
                    }
                    mono
                  />
                  <Field
                    label="Cycle Status"
                    value={detail.activePeriodicReviewCycle?.status ?? undefined}
                  />
                  <Field
                    label="Due At"
                    value={fmt(detail.activePeriodicReviewCycle?.dueAt)}
                    mono
                  />
                  <Field
                    label="Triggered At"
                    value={fmt(detail.activePeriodicReviewCycle?.triggeredAt)}
                    mono
                  />
                </FieldGrid>
              </div>
            </section>
          )}

          {/* ⑫ Corporate Profile (only for CORPORATE) */}
          
          {/* ⑪ UBO List (only for CORPORATE) */}
                  </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {/* Actions */}
          <div className="border-b border-adm-border py-4">
            <Cap>Actions</Cap>
            <div className="mt-2.5 flex flex-col gap-2">
              {canWriteRestrictions && (
                <button
                  onClick={() => setRestrictionModalOpen(true)}
                  className={adminButtonClass('workflowNegative')}
                >
                  Add Restriction
                </button>
              )}
              <span title="Not implemented" className="block">
                <button disabled className={adminButtonClass('workflowSecondary', 'w-full')}>
                  Offboard
                </button>
              </span>
            </div>
          </div>

          {/* Identity */}
          <SidebarGroup title="Identity">
            <SidebarKV label="Customer No" value={detail.customerNo} mono />
            <SidebarKV label="Type" value={detail.customerType} />
            <SidebarKV label="Email" value={detail.email} mono />
            <SidebarKV label="Phone" value={detail.phone} mono />
          </SidebarGroup>

          {/* Status */}
          <SidebarGroup title="Status">
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 font-mono text-[9px] text-adm-t3">Lifecycle</span>
              <AdminBadge value={detail.lifecycle} />
            </div>
            <SidebarKV
              label="Restrictions"
              value={
                openRestrictions.length > 0 ? (
                  <span className="font-mono text-[10px] font-semibold text-adm-red">
                    {openRestrictions.length} OPEN
                  </span>
                ) : (
                  'NONE'
                )
              }
            />
          </SidebarGroup>

          {/* Verification */}
          <SidebarGroup title="Verification">
            <SidebarKV label="Level" value={detail.sumsubCurrentLevelName} mono />
          </SidebarGroup>

          {/* Risk */}
          <SidebarGroup title="Risk">
            <SidebarKV label="Risk Rating" value={detail.riskRating} />
            <SidebarKV label="EDD Required" value={detail.eddRequired ? 'YES' : 'NO'} />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={fmt(detail.createdAt)} mono />
            <SidebarKV label="Updated" value={fmt(detail.updatedAt)} mono />
          </SidebarGroup>
        </div>
      </div>

      {/* ── Restriction modals ── */}
      <RestrictionOpenModal
        open={restrictionModalOpen}
        customerNo={detail.customerNo}
        customerLabel={name}
        onClose={() => setRestrictionModalOpen(false)}
        onSubmitted={async (restrictionNo, created) => {
          setNotice(
            created
              ? `Restriction ${restrictionNo} added.`
              : `Restriction ${restrictionNo} already open — no change.`,
          );
          fetchRestrictions(detail.customerNo);
        }}
      />
      <RestrictionReleaseModal
        open={!!releaseTarget}
        customerNo={detail.customerNo}
        restriction={releaseTarget}
        onClose={() => setReleaseTarget(null)}
        onSubmitted={async (approvalNo) => {
          setNotice(`Release approval ${approvalNo} opened — restriction stays OPEN until approved.`);
          fetchRestrictions(detail.customerNo);
        }}
      />
      <MaterialRequestIssueModal
        open={materialRequestModalOpen}
        customerNo={detail.customerNo}
        customerLabel={name}
        onClose={() => setMaterialRequestModalOpen(false)}
        onSubmitted={async (requestNo, restrictionNo) => {
          setNotice(
            restrictionNo
              ? `Material request ${requestNo} issued — restriction ${restrictionNo} opened.`
              : `Material request ${requestNo} issued — reminder only.`,
          );
          fetchRestrictions(detail.customerNo);
          setMaterialRequestsRefreshKey((k) => k + 1);
        }}
      />

      {/* ── Remove tag modal ── */}
      {removeTagTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl border border-adm-border bg-adm-panel shadow-xl">
            <div className="border-b border-adm-border px-6 py-4">
              <h2 className="text-base font-semibold text-adm-t1">Remove Tag</h2>
              <p className="mt-1 text-xs text-adm-t3">
                Remove {tagCatalog.find((t) => t.tagCode === removeTagTarget)?.displayName ?? removeTagTarget} from this customer.
              </p>
            </div>
            <div className="px-6 py-4">
              <label className="block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 mb-1.5">
                Reason
              </label>
              <textarea
                value={removeTagReason}
                onChange={(e) => setRemoveTagReason(e.target.value)}
                placeholder="e.g. Pilot program ended"
                className="w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 text-xs text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber h-20 resize-none"
              />
            </div>
            <div className="flex justify-end gap-3 border-t border-adm-border px-6 py-4">
              <button
                onClick={() => { setRemoveTagTarget(null); setRemoveTagReason(''); }}
                className={adminButtonClass('modalCancel')}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleRemoveTag()}
                disabled={!removeTagReason.trim() || tagBusyCode === removeTagTarget}
                className={adminButtonClass('modalConfirm')}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerDetail;
