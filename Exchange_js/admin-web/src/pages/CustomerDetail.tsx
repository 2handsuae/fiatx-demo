import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Link2, RefreshCw } from 'lucide-react';
import RestrictionOpenModal from '../components/RestrictionOpenModal';
import RestrictionReleaseModal from '../components/RestrictionReleaseModal';
import MaterialRequestPanel from '../components/MaterialRequestPanel';
import MaterialRequestIssueModal from '../components/MaterialRequestIssueModal';
import { DetailPageHeader } from '../components/compliance/DetailPageComponents';
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

interface RiskApprovalSummary {
  id: string;
  approvalNo: string;
  status: string;
  decidedAt?: string | null;
  decisionByRole?: string | null;
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
  riskTier?: string | null;
  riskRating?: string | null;
  eddRequired?: boolean;
  cddDocumentExpiresAt?: string | null;
  latestRiskApprovalId?: string | null;
  latestRiskApprovalStatus?: string | null;
  latestRiskApproval?: RiskApprovalSummary | null;
  nextReviewAt?: string | null;
  activePeriodicReviewCycleId?: string | null;
  activePeriodicReviewCycle?: PeriodicReviewCycleSummary | null;
  investorTier?: string | null;
  investorTierUpdatedAt?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  // Verification (Sumsub) snapshot
  verificationSubstatus?: string | null;
  verificationCustomerActionRequired?: boolean;
  verificationCanContinue?: boolean;
  verificationLatestEventType?: string | null;
  verificationLatestEventAt?: string | null;
  sumsubApplicantId?: string | null;
  sumsubCurrentLevelName?: string | null;
  sumsubLatestReviewId?: string | null;
  sumsubLatestAttemptId?: string | null;
  sumsubExperiencedLevel2?: boolean;
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

/* ── Material Holding (summary) ─────────────────────────────── */

interface MaterialHoldingSummary {
  id: string;
  materialType: string;
  status: string;
  expiresAt?: string | null;
  daysFromExpiry?: number | null;
  activeRefreshCycle?: {
    id: string;
    cycleNo: string;
  } | null;
}

/* ── DaysLeftCell (inline, compact) ─────────────────────────── */

const DaysLeftCell = ({ days }: { days?: number | null }) => {
  if (days === null || days === undefined) {
    return <span className="font-mono text-[10px] text-adm-t3">—</span>;
  }
  if (days < 0) {
    return (
      <span className="font-mono text-[10px] font-bold text-adm-red">
        {days}d (exp)
      </span>
    );
  }
  if (days < 7) {
    return <span className="font-mono text-[10px] font-bold text-adm-red">{days}d</span>;
  }
  if (days <= 30) {
    return <span className="font-mono text-[10px] font-semibold text-adm-amber">{days}d</span>;
  }
  return <span className="font-mono text-[10px] text-adm-t2">{days}d</span>;
};

/* ─────────────────────────────────────────────────────────────── */

const CustomerDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAdminSession();

  const [detail, setDetail] = useState<CustomerDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [restrictionModalOpen, setRestrictionModalOpen] = useState(false);
  const [materialRequestModalOpen, setMaterialRequestModalOpen] = useState(false);
  const [materialRequestsRefreshKey, setMaterialRequestsRefreshKey] = useState(0);
  const [releaseTarget, setReleaseTarget] = useState<AdminRestrictionRow | null>(null);
  const [restrictions, setRestrictions] = useState<AdminRestrictionRow[]>([]);
  const [restrictionsLoading, setRestrictionsLoading] = useState(false);
  const [showReleased, setShowReleased] = useState(false);

  /* ── Restrictions permissions ── */
  const canReadRestrictions = hasPermission(PERMISSIONS.CUSTOMER_RESTRICTIONS_READ);
  const canWriteRestrictions = hasPermission(PERMISSIONS.CUSTOMER_RESTRICTIONS_WRITE);
  const canReleaseRestrictions = hasPermission(PERMISSIONS.CUSTOMER_RESTRICTIONS_RELEASE);

  /* ── Tags state ── */
  const canViewTags = hasPermission(PERMISSIONS.CUSTOMER_TAGS_READ);
  const canManageTags = hasPermission(PERMISSIONS.CUSTOMER_TAGS_ASSIGN);
  const [tagCatalog, setTagCatalog] = useState<CustomerTagDefinition[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagBusyCode, setTagBusyCode] = useState<string | null>(null);
  const [tagAddValue, setTagAddValue] = useState('');
  const [tagError, setTagError] = useState<string | null>(null);

  /* ── Material holdings state ── */
  const [holdings, setHoldings] = useState<MaterialHoldingSummary[]>([]);
  const [tierMessage, setTierMessage] = useState<string | null>(null);

  /* ── Risk Assessment trigger state ── */

  /* ── Fetching ── */

  const fetchDetail = async () => {
    if (!id) {
      setError('Customer id is required.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/customers/${id}`);
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
  }, [id]);

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

  /* ── Load material holdings whenever customer id is available ── */
  const fetchHoldings = (customerId: string) => {
    adminFetch(`${import.meta.env.VITE_API_URL}/admin/material-management/holdings?customerId=${customerId}`)
      .then((r) => r.json())
      .then((d: { items?: MaterialHoldingSummary[] }) => setHoldings(d.items || []))
      .catch(() => {});
  };

  useEffect(() => {
    if (detail?.id) fetchHoldings(detail.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id]);

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

  const handleRemoveTag = async (tagCode: string) => {
    if (!detail) return;
    setTagBusyCode(tagCode);
    setTagError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/customers/${detail.customerNo}/tags/${tagCode}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to remove tag.'));
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

  /* ── Derived booleans ── */

  const hasPeriodicReview = useMemo(
    () =>
      !!detail?.activePeriodicReviewCycle ||
      !!detail?.activePeriodicReviewCycleId,
    [detail],
  );
  const hasRiskApproval = useMemo(
    () => !!detail?.latestRiskApprovalId || !!detail?.latestRiskApproval,
    [detail],
  );
  const hasVerification = useMemo(
    () =>
      !!detail?.verificationSubstatus ||
      !!detail?.sumsubApplicantId,
    [detail],
  );

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
  const riskApprovalStatus =
    detail.latestRiskApprovalStatus || detail.latestRiskApproval?.status || null;
  const openRestrictions = restrictions.filter((r) => r.status === 'OPEN');
  const releasedRestrictions = restrictions.filter((r) => r.status === 'RELEASED');

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
      />

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
            </div>
            <div className="mt-4 border-t border-adm-border pt-4">
              <p className="font-mono text-[11px] text-adm-t2">{name}</p>
              <p className="mt-1.5 break-all font-mono text-[9px] text-adm-t3">{detail.id}</p>
            </div>
          </section>

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
                            onClick={() => void handleRemoveTag(tagCode)}
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
                <Field label="Risk Rating" value={detail.riskTier || detail.riskRating || undefined} />
                <Field label="EDD Required" value={detail.eddRequired ? 'YES' : 'NO'} />
                <Field label="CDD Document Expires" value={fmt(detail.cddDocumentExpiresAt)} mono />
                <Field label="Next Review" value={fmt(detail.nextReviewAt)} mono />
              </FieldGrid>
            </div>
          </section>

          {/* ④ Verification (Sumsub) */}
          {hasVerification && (
            <section className="px-6 py-5">
              <Cap>Verification</Cap>
              <p className="mt-1 mb-4 font-mono text-[9px] text-adm-t3">
                Identity provider snapshot — latest webhook event and SDK identifiers
              </p>
              <div className="mt-3 mb-4 flex flex-wrap items-center gap-2">
                <AdminBadge value={detail.verificationSubstatus || 'CREATED'} />
                {detail.sumsubExperiencedLevel2 && (
                  <span className="inline-flex items-center rounded border border-adm-blue/25 bg-adm-blue/10 px-1.5 py-px font-mono text-[9px] text-adm-blue">
                    EDD level2
                  </span>
                )}
              </div>
              <FieldGrid>
                <Field label="Current Level" value={detail.sumsubCurrentLevelName ?? undefined} />
                <Field
                  label="Latest Event"
                  value={detail.verificationLatestEventType ?? undefined}
                  mono
                />
                <Field
                  label="Latest Event At"
                  value={fmt(detail.verificationLatestEventAt)}
                  mono
                />
                <Field
                  label="Customer Action Required"
                  value={
                    detail.verificationCustomerActionRequired === undefined
                      ? undefined
                      : detail.verificationCustomerActionRequired
                        ? 'YES'
                        : 'NO'
                  }
                />
                <Field
                  label="Can Continue"
                  value={
                    detail.verificationCanContinue === undefined
                      ? undefined
                      : detail.verificationCanContinue
                        ? 'YES'
                        : 'NO'
                  }
                />
                <Field label="Applicant ID" value={detail.sumsubApplicantId ?? undefined} mono />
                <Field label="Latest Review ID" value={detail.sumsubLatestReviewId ?? undefined} mono />
                <Field label="Latest Attempt ID" value={detail.sumsubLatestAttemptId ?? undefined} mono />
              </FieldGrid>
            </section>
          )}

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
            />
          </section>

          {/* ⑦ Risk Approval (as linked card) */}
          {hasRiskApproval && (
            <section className="px-6 py-5">
              <Cap>Risk Approval</Cap>
              <p className="mt-1 mb-4 font-mono text-[9px] text-adm-t3">
                Latest onboarding risk approval workflow
              </p>
              <button
                onClick={() =>
                  navigate(`/admin/governance/approvals/${detail.latestRiskApprovalId}`)
                }
                className="flex w-full items-center justify-between gap-3 rounded border border-adm-border bg-adm-bg px-4 py-2.5 text-left transition-colors hover:border-adm-bhi hover:bg-adm-hover"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                    Onboarding Risk Approval
                  </span>
                  <span className="truncate font-mono text-[11px] font-semibold text-adm-amber">
                    {detail.latestRiskApproval?.approvalNo || detail.latestRiskApprovalId}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {riskApprovalStatus && <AdminBadge value={riskApprovalStatus} />}
                  <Link2 size={13} className="text-adm-t3" />
                </div>
              </button>
              {(detail.latestRiskApproval?.decidedAt ||
                detail.latestRiskApproval?.decisionByRole) && (
                <div className="mt-3">
                  <FieldGrid>
                    <Field
                      label="Decided At"
                      value={fmt(detail.latestRiskApproval?.decidedAt)}
                      mono
                    />
                    <Field
                      label="Decided By Role"
                      value={detail.latestRiskApproval?.decisionByRole ?? undefined}
                    />
                  </FieldGrid>
                </div>
              )}
            </section>
          )}

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

          {/* Investor Classification */}
          <section className="px-6 py-5">
            <Cap>Investor Tier</Cap>
            <div className="mt-3">
              <FieldGrid>
                <Field label="Tier" value={detail.investorTier ?? 'RETAIL'} />
                <Field
                  label="Updated At"
                  value={fmt(detail.investorTierUpdatedAt)}
                  mono
                />
              </FieldGrid>
            </div>
          </section>

          {/* ⑩ Material Holdings Summary */}
          <section className="px-6 py-5">
            <Cap>Material Holdings</Cap>
            <p className="mt-1 mb-3 font-mono text-[9px] text-adm-t3">
              Active KYC material holdings for this customer
            </p>
            {holdings.length === 0 ? (
              <p className="font-mono text-[10px] text-adm-t3">No holdings found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      {(['Material', 'Status', 'Expires', 'Days Left', 'Cycle'] as string[]).map((h) => (
                        <th
                          key={h}
                          className="border-b border-adm-border bg-adm-panel px-3 py-1.5 text-left font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {holdings.map((h) => (
                      <tr
                        key={h.id}
                        className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                        onClick={() => navigate(`/admin/customers/material-holdings/${h.id}`)}
                      >
                        <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                          {h.materialType}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <AdminBadge value={h.status} />
                        </td>
                        <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                          {h.expiresAt
                            ? new Date(h.expiresAt).toLocaleDateString()
                            : '—'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <DaysLeftCell days={h.daysFromExpiry} />
                        </td>
                        <td className="px-3 py-2 font-mono text-[10px] whitespace-nowrap">
                          {h.activeRefreshCycle ? (
                            <button
                              className={adminButtonClass('rowLink')}
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/admin/customers/material-holdings/${h.id}`);
                              }}
                            >
                              {h.activeRefreshCycle.cycleNo} →
                            </button>
                          ) : (
                            <span className="text-adm-t3">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-3">
              <button
                className={adminButtonClass('rowLink')}
                onClick={() =>
                  navigate(
                    `/admin/customers/material-holdings?customerId=${detail.id}`,
                  )
                }
              >
                View All →
              </button>
            </div>
          </section>

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
            <SidebarKV label="Customer ID" value={detail.id} mono />
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
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 font-mono text-[9px] text-adm-t3">Substatus</span>
              <AdminBadge value={detail.verificationSubstatus || 'CREATED'} />
            </div>
            <SidebarKV label="Level" value={detail.sumsubCurrentLevelName} mono />
            <SidebarKV label="Last Event" value={detail.verificationLatestEventType} mono />
            <SidebarKV label="Updated" value={fmt(detail.verificationLatestEventAt)} mono />
            <SidebarKV
              label="EDD Level2"
              value={detail.sumsubExperiencedLevel2 ? 'YES' : 'NO'}
            />
          </SidebarGroup>

          {/* Risk */}
          <SidebarGroup title="Risk">
            <SidebarKV label="Risk Rating" value={detail.riskTier || detail.riskRating} />
            <SidebarKV label="EDD Required" value={detail.eddRequired ? 'YES' : 'NO'} />
            <SidebarKV
              label="Investor Tier"
              value={detail.investorTier || 'RETAIL'}
            />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={fmt(detail.createdAt)} mono />
            <SidebarKV label="Updated" value={fmt(detail.updatedAt)} mono />
            <SidebarKV
              label="CDD Expires"
              value={fmt(detail.cddDocumentExpiresAt)}
              mono
            />
            <SidebarKV label="Next Review" value={fmt(detail.nextReviewAt)} mono />
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
    </div>
  );
};

export default CustomerDetail;
