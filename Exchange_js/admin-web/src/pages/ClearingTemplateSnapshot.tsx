import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import { DetailPageHeader } from '../components/compliance/DetailPageComponents';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';

/* ── Types ─────────────────────────────────────────────────────── */

type LineType = 'INCOMING' | 'FEE' | 'OUTGOING' | string;

interface ClearingLine {
  lineNo: number;
  lineType: LineType;
  partyType: string;
  partyIdSource?: string | null;
  assetSource: string;
  amountSource: string;
  memoTemplate?: string | null;
  isEnabled: boolean;
}

interface ReleaseItem {
  businessKey: string;
  revisionNo: number;
  payload: Record<string, unknown>;
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

/* ── Layout primitives ──────────────────────────────────────────── */

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

const fmtDate = (v?: string | number | null): string => {
  if (v === null || v === undefined || v === '') return '—';
  const d = typeof v === 'number' ? new Date(v) : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
};

const lineTypeColor = (t: LineType) => {
  if (t === 'INCOMING') return { text: 'text-adm-green', border: 'border-l-adm-green/40' };
  if (t === 'FEE')      return { text: 'text-adm-amber', border: 'border-l-adm-amber/40' };
  if (t === 'OUTGOING') return { text: 'text-adm-blue',  border: 'border-l-adm-blue/40' };
  return { text: 'text-adm-t2', border: 'border-l-adm-border' };
};

/* ── Expandable template accordion row ──────────────────────────── */

const TemplateAccordionRow = ({ item }: { item: ReleaseItem }) => {
  const [open, setOpen] = useState(false);

  const p = item.payload;
  const code = String(p.code ?? item.businessKey);
  const clearingType = String(p.clearingType ?? '');
  const sourceType = String(p.sourceType ?? '');
  const feeMethod = String(p.feeMethod ?? '');
  const isEnabled = Boolean(p.isEnabled);
  const lines: ClearingLine[] = Array.isArray(p.lineTemplates)
    ? (p.lineTemplates as ClearingLine[])
    : [];

  const incomingCount = lines.filter((l) => l.lineType === 'INCOMING').length;
  const feeCount      = lines.filter((l) => l.lineType === 'FEE').length;
  const outgoingCount = lines.filter((l) => l.lineType === 'OUTGOING').length;

  const accentCls =
    clearingType === 'WITHDRAWAL'
      ? 'bg-adm-amber'
      : clearingType === 'INTERNAL_COLLECTION'
        ? 'bg-adm-blue'
        : 'bg-adm-t3/50';

  const typeBadgeCls =
    clearingType === 'WITHDRAWAL'
      ? 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber'
      : clearingType === 'INTERNAL_COLLECTION'
        ? 'border-adm-blue/25 bg-adm-blue/10 text-adm-blue'
        : 'border-adm-border bg-adm-bg text-adm-t3';

  return (
    <>
      {/* Header row */}
      <tr
        className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
        onClick={() => setOpen((v) => !v)}
      >
        {/* Accent strip */}
        <td className="py-3 pl-3 w-1">
          <div className={`h-5 w-0.5 rounded-full ${accentCls}`} />
        </td>

        {/* Chevron */}
        <td className="py-3 pl-2 pr-1 w-6 text-adm-t3">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </td>

        {/* Code */}
        <td className="px-3 py-3 font-mono text-[11px] font-semibold text-adm-amber whitespace-nowrap">
          {code}
        </td>

        {/* Clearing Type */}
        <td className="px-3 py-3">
          <span
            className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest ${typeBadgeCls}`}
          >
            {clearingType}
          </span>
        </td>

        {/* Source Type */}
        <td className="px-3 py-3 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
          {sourceType || <span className="text-adm-t3">—</span>}
        </td>

        {/* Fee Method */}
        <td className="px-3 py-3 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
          {feeMethod || <span className="text-adm-t3">—</span>}
        </td>

        {/* Lines */}
        <td className="px-3 py-3 font-mono text-[11px] text-adm-t2 tabular-nums">
          {lines.length}
        </td>

        {/* Flow summary */}
        <td className="px-3 py-3">
          <div className="flex items-center gap-1.5">
            {incomingCount > 0 && <span className="font-mono text-[9px] text-adm-green">IN {incomingCount}</span>}
            {feeCount > 0      && <span className="font-mono text-[9px] text-adm-amber">FEE {feeCount}</span>}
            {outgoingCount > 0 && <span className="font-mono text-[9px] text-adm-blue">OUT {outgoingCount}</span>}
            {lines.length === 0 && <span className="font-mono text-[9px] text-adm-t3">—</span>}
          </div>
        </td>

        {/* Enabled */}
        <td className="px-3 py-3">
          <AdminBadge value={isEnabled ? 'ACTIVE' : 'DISABLED'} />
        </td>
      </tr>

      {/* Expanded lines */}
      {open && (
        <tr className="border-b border-adm-border bg-adm-bg/50">
          <td colSpan={9} className="p-0">
            <div className="px-8 py-3">
              {lines.length === 0 ? (
                <p className="font-mono text-[10px] text-adm-t3">No line templates defined.</p>
              ) : (
                <table className="w-full border-collapse overflow-hidden rounded border border-adm-border">
                  <thead>
                    <tr>
                      {['#', 'Type', 'Party', 'Party ID Source', 'Amount Source', 'Asset Source', 'Memo', 'Enabled'].map(
                        (col) => (
                          <th
                            key={col}
                            className="border-b border-adm-border bg-adm-panel px-3 py-1.5 text-left font-mono text-[8.5px] font-semibold uppercase tracking-[0.1em] text-adm-t3 whitespace-nowrap"
                          >
                            {col}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {lines
                      .slice()
                      .sort((a, b) => a.lineNo - b.lineNo)
                      .map((l) => {
                        const c = lineTypeColor(l.lineType);
                        return (
                          <tr
                            key={l.lineNo}
                            className={`border-b border-adm-border/50 last:border-b-0 border-l-2 ${c.border}`}
                          >
                            <td className="px-3 py-1.5 font-mono text-[9px] text-adm-t3">{l.lineNo}</td>
                            <td className="px-3 py-1.5">
                              <span className={`font-mono text-[9px] font-bold ${c.text}`}>{l.lineType}</span>
                            </td>
                            <td className="px-3 py-1.5 font-mono text-[10px] font-semibold text-adm-t1 whitespace-nowrap">
                              {l.partyType}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-[9px] text-adm-t2 whitespace-nowrap">
                              {l.partyIdSource || <span className="text-adm-t3">—</span>}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-[9px] text-adm-t2 whitespace-nowrap">
                              {l.amountSource || <span className="text-adm-t3">—</span>}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-[9px] text-adm-t2 whitespace-nowrap">
                              {l.assetSource || <span className="text-adm-t3">—</span>}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-[9px] text-adm-t2 max-w-[140px]">
                              <span className="block truncate" title={l.memoTemplate ?? ''}>
                                {l.memoTemplate || <span className="text-adm-t3">—</span>}
                              </span>
                            </td>
                            <td className="px-3 py-1.5">
                              <span
                                className={`inline-flex items-center gap-1 font-mono text-[9px] font-medium ${
                                  l.isEnabled ? 'text-adm-green' : 'text-adm-t3'
                                }`}
                              >
                                <span
                                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                    l.isEnabled ? 'bg-adm-green' : 'bg-adm-t3'
                                  }`}
                                />
                                {l.isEnabled ? 'On' : 'Off'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

/* ── Component ─────────────────────────────────────────────────── */

const HEADER_COLS = [
  '', '', 'Code', 'Clearing Type', 'Source Type', 'Fee Method', 'Lines', 'Flow', 'Status',
] as const;

const ClearingTemplateSnapshot = () => {
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
      const [detailRes, listRes] = await Promise.all([
        adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/business-config/releases/${releaseNo}`,
        ),
        adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/business-config/releases?subjectType=CLEARING_TEMPLATE&take=50`,
        ),
      ]);

      if (!detailRes.ok)
        throw new Error(await getApiErrorMessage(detailRes, 'Failed to fetch release.'));

      const detail = (await detailRes.json()) as Release;
      setRelease(detail);

      if (listRes.ok) {
        const listData = await listRes.json();
        const all: Array<{
          releaseNo: string;
          effectiveFrom: string | null;
          publishedAt: string | null;
        }> = listData?.items ?? [];
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

      <DetailPageHeader
        title={
          isActive
            ? 'Clearing Templates · Current Release'
            : 'Clearing Templates · Historical Snapshot'
        }
        subtitle={releaseNo ?? ''}
        onBack={() => navigate('/dashboard/system/clearing-header-templates/history')}
        onRefresh={() => void fetchData()}
        refreshing={loading}
        backLabel="Version History"
      >
        <div className="flex items-center gap-2">
          {release && <AdminBadge value={release.status} />}
          {release && !isActive && (
            <button
              onClick={() => navigate('/dashboard/system/clearing-header-templates')}
              className={adminButtonClass('listSecondary')}
            >
              View current →
            </button>
          )}
        </div>
      </DetailPageHeader>

      {error && (
        <div className="shrink-0 px-6 pt-3 pb-1">
          <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT: expandable template table ════ */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {HEADER_COLS.map((label, i) => (
                    <th
                      key={`${label}-${i}`}
                      className="border-b border-adm-border bg-adm-panel px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td
                      colSpan={HEADER_COLS.length}
                      className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3"
                    >
                      Loading…
                    </td>
                  </tr>
                )}
                {!loading && (release?.items ?? []).length === 0 && (
                  <tr>
                    <td
                      colSpan={HEADER_COLS.length}
                      className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3"
                    >
                      No items in this release.
                    </td>
                  </tr>
                )}
                {!loading &&
                  (release?.items ?? []).map((item) => (
                    <TemplateAccordionRow key={item.businessKey} item={item} />
                  ))}
              </tbody>
            </table>
          </div>

          {!loading && release && (
            <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
              <span className="font-mono text-[10px] text-adm-t3">
                {release.itemCount} template{release.itemCount !== 1 ? 's' : ''} · click row to
                expand lines
              </span>
            </div>
          )}
        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          <SidebarGroup title="Release">
            <SidebarKV label="Release No"   value={release?.releaseNo}                              mono />
            <SidebarKV label="Items"        value={release ? String(release.itemCount) : undefined} mono />
            <SidebarKV label="Based On"     value={release?.basedOnReleaseNo ?? undefined}          mono />
            <SidebarKV label="Published By" value={release?.publishedBy ?? undefined}               />
          </SidebarGroup>

          <SidebarGroup title="Timeline">
            <SidebarKV label="Effective" value={fmtDate(effectiveDate)} mono />
            <SidebarKV
              label="Until"
              value={
                isActive ? (
                  <span className="text-adm-green">Ongoing</span>
                ) : fmtDate(effectiveUntil) !== '—' ? (
                  fmtDate(effectiveUntil)
                ) : undefined
              }
              mono={!isActive}
            />
            <SidebarKV label="Published" value={fmtDate(release?.publishedAt)} mono />
            <SidebarKV label="Created"   value={fmtDate(release?.createdAt)}   mono />
          </SidebarGroup>

          {validation && (
            <SidebarGroup title="Validation">
              <SidebarKV
                label="Result"
                value={
                  validation.ok ? (
                    <span className="text-adm-green">OK</span>
                  ) : (
                    <span className="text-adm-red">
                      {validation.issues?.length ?? 0} issue
                      {(validation.issues?.length ?? 0) !== 1 ? 's' : ''}
                    </span>
                  )
                }
              />
              <SidebarKV label="Validated At" value={fmtDate(validation.validatedAt)} mono />
              {hasIssues &&
                validation.issues?.map((issue, i) => (
                  <div key={i} className="font-mono text-[9px] text-adm-red leading-relaxed">
                    · {issue}
                  </div>
                ))}
              {(validation.warnings ?? []).length > 0 && (
                <>
                  <SidebarKV label="Warnings" value={String((validation.warnings ?? []).length)} />
                  {(validation.warnings ?? []).map((w, i) => (
                    <div key={i} className="font-mono text-[9px] text-adm-yellow leading-relaxed">
                      · {w}
                    </div>
                  ))}
                </>
              )}
            </SidebarGroup>
          )}

          {(release?.changeTicketId ?? release?.approvalCaseId) && (
            <SidebarGroup title="Governance">
              <SidebarKV label="Change Ticket" value={release?.changeTicketId ?? undefined} mono />
              <SidebarKV label="Approval Case" value={release?.approvalCaseId ?? undefined} mono />
            </SidebarGroup>
          )}

        </div>
      </div>

    </div>
  );
};

export default ClearingTemplateSnapshot;
