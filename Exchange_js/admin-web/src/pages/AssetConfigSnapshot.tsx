import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { DetailPageHeader } from '../components/compliance/DetailPageComponents';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

/* ── Types ─────────────────────────────────────────────────────── */

interface AssetPayload {
  assetNo: string;
  code: string;
  type: 'FIAT' | 'CRYPTO';
  network: string;
  depositEnabled: boolean;
  withdrawEnabled: boolean;
  depositMinAmount: string;
  depositMaxAmount: string | null;
  withdrawMinAmount: string;
  withdrawMaxAmount: string | null;
  minConfirmations: number | null;
}

interface ReleaseItem {
  businessKey: string;
  revisionNo: number;
  payload: AssetPayload;
}

interface ValidationSummary {
  ok: boolean;
  issues?: string[];
  warnings?: string[];
  validatedAt?: string;
}

interface Release {
  releaseNo: string;
  status: string;
  publishedAt: string | null;
  effectiveFrom: string | null;
  publishedBy: string | null;
  basedOnReleaseNo: string | null;
  changeTicketId: string | null;
  approvalCaseId: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  items: ReleaseItem[];
  validationSummary: ValidationSummary | null;
}

/* ── Local layout primitives ────────────────────────────────────── */

const Cap = ({ children }: { children: ReactNode }) => (
  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    {children}
  </p>
);

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
  value?: ReactNode;
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

/* ── Display helpers ────────────────────────────────────────────── */

const TypeBadge = ({ type }: { type: 'FIAT' | 'CRYPTO' }) => (
  <span
    className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest ${
      type === 'FIAT'
        ? 'border-adm-blue/25 bg-adm-blue/10 text-adm-blue'
        : 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber'
    }`}
  >
    {type}
  </span>
);

const EnabledDot = ({ v }: { v: boolean }) => (
  <span
    className={`inline-flex items-center gap-1 font-mono text-[11px] font-medium ${
      v ? 'text-adm-green' : 'text-adm-t3'
    }`}
  >
    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${v ? 'bg-adm-green' : 'bg-adm-t3'}`} />
    {v ? 'On' : 'Off'}
  </span>
);

const AmtRange = ({ min, max }: { min: string; max: string | null }) => (
  <span className="font-mono text-[11px] text-adm-t2 tabular-nums">
    {min}
    <span className="mx-1 text-adm-t3">/</span>
    <span className={max ? 'text-adm-t2' : 'text-adm-t3'}>{max ?? '∞'}</span>
  </span>
);

const fmtDate = (v?: string | number | null): string => {
  if (v === null || v === undefined || v === '') return '—';
  const d = typeof v === 'number' ? new Date(v) : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
};

const COLS = [
  'Asset',
  'Network',
  'Deposit',
  'Dep. Min / Max',
  'Withdraw',
  'Wtd. Min / Max',
  'Confirmations',
] as const;

/* ── Component ─────────────────────────────────────────────────── */

const AssetConfigSnapshot = () => {
  const { releaseNo } = useParams<{ releaseNo: string }>();
  const navigate = useNavigate();

  const [release, setRelease] = useState<Release | null>(null);
  const [effectiveUntil, setEffectiveUntil] = useState<string | number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch this release + the full list to derive the "until" date
      const [detailRes, listRes] = await Promise.all([
        adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/business-config/releases/${releaseNo}`,
        ),
        adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/business-config/releases?subjectType=ASSET_CONFIG&take=50`,
        ),
      ]);

      if (!detailRes.ok) throw new Error(await getApiErrorMessage(detailRes, 'Failed to fetch release.'));
      const detail = await detailRes.json() as Release;
      setRelease(detail);

      // Derive effectiveUntil: find the release that came right after this one
      if (listRes.ok) {
        const listData = await listRes.json();
        const all: Array<{ releaseNo: string; effectiveFrom: string | null; publishedAt: string | null; createdAt: string }> =
          listData?.items ?? [];
        // Sorted newest-first; find index of this release, then [idx-1] is the superseding one
        const idx = all.findIndex((r) => r.releaseNo === releaseNo);
        if (idx > 0) {
          const newer = all[idx - 1];
          setEffectiveUntil(newer.effectiveFrom ?? newer.publishedAt ?? null);
        }
      }
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load snapshot.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [releaseNo]);

  const isActive = release?.status === 'ACTIVE';
  const effectiveDate = release?.effectiveFrom ?? release?.publishedAt;
  const validation = release?.validationSummary;
  const hasIssues = validation && !validation.ok && (validation.issues?.length ?? 0) > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Header ── */}
      <DetailPageHeader
        title={isActive ? 'Asset Config · Current Release' : 'Asset Config · Historical Snapshot'}
        subtitle={releaseNo ?? ''}
        onBack={() => navigate('/dashboard/system/asset-configs/history')}
        onRefresh={() => void fetchData()}
        refreshing={loading}
        backLabel="Version History"
      >
        <div className="flex items-center gap-2">
          {release && <AdminBadge value={release.status} />}
          {release && !isActive && (
            <button
              onClick={() => navigate('/dashboard/system/asset-configs')}
              className={adminButtonClass('listSecondary')}
            >
              View current →
            </button>
          )}
        </div>
      </DetailPageHeader>

      {/* ── Error ── */}
      {error && (
        <div className="shrink-0 px-6 pt-3 pb-1">
          <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT: asset table ════ */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="w-1 border-b border-adm-border bg-adm-panel" />
                  {COLS.map((label) => (
                    <th
                      key={label}
                      className="border-b border-adm-border bg-adm-panel px-4 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={COLS.length + 1} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                      Loading…
                    </td>
                  </tr>
                )}
                {!loading && (release?.items ?? []).length === 0 && (
                  <tr>
                    <td colSpan={COLS.length + 1} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                      No items in this release.
                    </td>
                  </tr>
                )}
                {!loading && (release?.items ?? []).map((item) => {
                  const p = item.payload;
                  const isCrypto = p.type === 'CRYPTO';
                  return (
                    <tr key={item.businessKey} className="border-b border-adm-border">
                      {/* Type accent strip */}
                      <td className="py-3 pl-3">
                        <div
                          className={`h-5 w-0.5 rounded-full ${
                            isCrypto ? 'bg-adm-amber' : 'bg-adm-blue'
                          }`}
                        />
                      </td>
                      {/* Asset */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <TypeBadge type={p.type} />
                          <span className="font-mono text-[11px] font-semibold text-adm-amber">
                            {p.code}
                          </span>
                          <span className="font-mono text-[10px] text-adm-t3">{p.assetNo}</span>
                        </div>
                      </td>
                      {/* Network */}
                      <td className="px-4 py-3 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                        {p.network || <span className="text-adm-t3">—</span>}
                      </td>
                      {/* Deposit enabled */}
                      <td className="px-4 py-3">
                        <EnabledDot v={p.depositEnabled} />
                      </td>
                      {/* Deposit range */}
                      <td className="px-4 py-3">
                        <AmtRange min={p.depositMinAmount} max={p.depositMaxAmount} />
                      </td>
                      {/* Withdraw enabled */}
                      <td className="px-4 py-3">
                        <EnabledDot v={p.withdrawEnabled} />
                      </td>
                      {/* Withdraw range */}
                      <td className="px-4 py-3">
                        <AmtRange min={p.withdrawMinAmount} max={p.withdrawMaxAmount} />
                      </td>
                      {/* Min confirmations */}
                      <td className="px-4 py-3 font-mono text-[11px] tabular-nums whitespace-nowrap">
                        {isCrypto && p.minConfirmations != null ? (
                          <span className="text-adm-t2">{p.minConfirmations}</span>
                        ) : (
                          <span className="text-adm-t3">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Table footer */}
          {!loading && release && (
            <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
              <span className="font-mono text-[10px] text-adm-t3">
                {release.itemCount} asset{release.itemCount !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        {/* ════ RIGHT SIDEBAR: release metadata ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {/* Release */}
          <SidebarGroup title="Release">
            <SidebarKV label="Release No"   value={release?.releaseNo}       mono />
            <SidebarKV label="Items"        value={release ? String(release.itemCount) : undefined} mono />
            <SidebarKV label="Based On"     value={release?.basedOnReleaseNo ?? undefined} mono />
            <SidebarKV label="Published By" value={release?.publishedBy ?? undefined}      />
          </SidebarGroup>

          {/* Timeline */}
          <SidebarGroup title="Timeline">
            <SidebarKV label="Effective"  value={fmtDate(effectiveDate)}           mono />
            <SidebarKV
              label="Until"
              value={
                isActive
                  ? <span className="text-adm-green">Ongoing</span>
                  : fmtDate(effectiveUntil) !== '—'
                    ? fmtDate(effectiveUntil)
                    : undefined
              }
              mono={!isActive}
            />
            <SidebarKV label="Published"  value={fmtDate(release?.publishedAt)}    mono />
            <SidebarKV label="Created"    value={fmtDate(release?.createdAt)}      mono />
          </SidebarGroup>

          {/* Validation */}
          {validation && (
            <SidebarGroup title="Validation">
              <SidebarKV
                label="Result"
                value={
                  validation.ok ? (
                    <span className="text-adm-green">OK</span>
                  ) : (
                    <span className="text-adm-red">
                      {validation.issues?.length ?? 0} issue{(validation.issues?.length ?? 0) !== 1 ? 's' : ''}
                    </span>
                  )
                }
              />
              <SidebarKV label="Validated At" value={fmtDate(validation.validatedAt)} mono />
              {hasIssues && validation.issues?.map((issue, i) => (
                <div key={i} className="font-mono text-[9px] text-adm-red leading-relaxed">
                  · {issue}
                </div>
              ))}
              {validation.warnings && validation.warnings.length > 0 && (
                <>
                  <SidebarKV label="Warnings" value={String(validation.warnings.length)} />
                  {validation.warnings.map((w, i) => (
                    <div key={i} className="font-mono text-[9px] text-adm-yellow leading-relaxed">
                      · {w}
                    </div>
                  ))}
                </>
              )}
            </SidebarGroup>
          )}

          {/* Governance */}
          {(release?.changeTicketId || release?.approvalCaseId) && (
            <SidebarGroup title="Governance">
              <SidebarKV label="Change Ticket" value={release.changeTicketId ?? undefined} mono />
              <SidebarKV label="Approval Case" value={release.approvalCaseId ?? undefined} mono />
            </SidebarGroup>
          )}

        </div>
      </div>

    </div>
  );
};

export default AssetConfigSnapshot;
