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

interface JournalLine {
  lineNo: number;
  accountCode: string;
  drCr: 'DR' | 'CR';
  amountSource: string;
  assetSource: string;
  ownerTypeSource: string;
  conditionExpr?: string;
  description?: string;
}

interface JournalHeader {
  templateCode: string;
  eventCode: string;
  version: number;
  status: string;
}

interface ReleaseItem {
  businessKey: string;
  revisionNo: number;
  payload: {
    header: Record<string, unknown>;
    lines: JournalLine[];
  };
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

function deriveAssetType(eventCode: string): 'CRYPTO' | 'FIAT' | 'ALL' {
  if (eventCode.endsWith('__CRYPTO')) return 'CRYPTO';
  if (eventCode.endsWith('__FIAT')) return 'FIAT';
  return 'ALL';
}

const fmtDate = (v?: string | number | null): string => {
  if (v === null || v === undefined || v === '') return '—';
  const d = typeof v === 'number' ? new Date(v) : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
};

/* ── Expandable template row ─────────────────────────────────────
   Header row shows templateCode, eventCode, assetType, status, lineCount.
   Expand to reveal the DR/CR line detail table.
   ─────────────────────────────────────────────────────────────── */

const TemplateAccordionRow = ({
  item,
}: {
  item: ReleaseItem;
}) => {
  const [open, setOpen] = useState(false);

  const h = (item.payload.header ?? {}) as Record<string, unknown>;
  const header: JournalHeader = {
    templateCode: String(h.templateCode ?? item.businessKey),
    eventCode: String(h.eventCode ?? ''),
    version: Number(h.version ?? 1),
    status: String(h.status ?? 'UNKNOWN'),
  };
  const lines: JournalLine[] = Array.isArray(item.payload.lines) ? item.payload.lines : [];
  const assetType = deriveAssetType(header.eventCode);
  const isActive = header.status === 'ACTIVE';
  const drCount = lines.filter((l) => l.drCr === 'DR').length;
  const crCount = lines.filter((l) => l.drCr === 'CR').length;

  const accentCls =
    assetType === 'CRYPTO'
      ? 'bg-adm-amber'
      : assetType === 'FIAT'
        ? 'bg-adm-blue'
        : 'bg-adm-t3/50';

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

        {/* Template Code */}
        <td className="px-3 py-3 font-mono text-[11px] font-semibold text-adm-amber whitespace-nowrap">
          {header.templateCode}
        </td>

        {/* Event Code */}
        <td className="px-3 py-3 font-mono text-[10px] text-adm-t2 whitespace-nowrap max-w-[200px]">
          <span className="block truncate" title={header.eventCode}>{header.eventCode}</span>
        </td>

        {/* Asset type */}
        <td className="px-3 py-3">
          <span
            className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest ${
              assetType === 'CRYPTO'
                ? 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber'
                : assetType === 'FIAT'
                  ? 'border-adm-blue/25 bg-adm-blue/10 text-adm-blue'
                  : 'border-adm-border bg-adm-bg text-adm-t3'
            }`}
          >
            {assetType}
          </span>
        </td>

        {/* Lines */}
        <td className="px-3 py-3 font-mono text-[11px] text-adm-t2 tabular-nums">
          {lines.length}
        </td>

        {/* DR / CR count */}
        <td className="px-3 py-3">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] text-adm-amber">DR {drCount}</span>
            <span className="text-adm-t3">·</span>
            <span className="font-mono text-[9px] text-adm-blue">CR {crCount}</span>
          </div>
        </td>

        {/* Status */}
        <td className="px-3 py-3">
          <AdminBadge value={isActive ? 'ACTIVE' : 'DISABLED'} />
        </td>
      </tr>

      {/* Expanded lines */}
      {open && (
        <tr className="border-b border-adm-border bg-adm-bg/50">
          <td colSpan={8} className="p-0">
            <div className="px-8 py-3">
              {lines.length === 0 ? (
                <p className="font-mono text-[10px] text-adm-t3">No lines in this template.</p>
              ) : (
                <table className="w-full border-collapse overflow-hidden rounded border border-adm-border">
                  <thead>
                    <tr>
                      {['#', 'DR/CR', 'Account', 'Amount Source', 'Asset Source', 'Owner Type', 'Condition'].map(
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
                    {lines.map((l) => (
                      <tr
                        key={l.lineNo}
                        className={`border-b border-adm-border/50 last:border-b-0 ${
                          l.drCr === 'DR' ? 'border-l-2 border-l-adm-amber/40' : 'border-l-2 border-l-adm-blue/40'
                        }`}
                      >
                        <td className="px-3 py-1.5 font-mono text-[9px] text-adm-t3">{l.lineNo}</td>
                        <td className="px-3 py-1.5">
                          <span
                            className={`font-mono text-[9px] font-bold ${
                              l.drCr === 'DR' ? 'text-adm-amber' : 'text-adm-blue'
                            }`}
                          >
                            {l.drCr}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[10px] font-semibold text-adm-t1 whitespace-nowrap">
                          {l.accountCode}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[9px] text-adm-t2 whitespace-nowrap">
                          {l.amountSource || <span className="text-adm-t3">—</span>}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[9px] text-adm-t2 whitespace-nowrap">
                          {l.assetSource || <span className="text-adm-t3">—</span>}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[9px] text-adm-t2 whitespace-nowrap">
                          {l.ownerTypeSource || <span className="text-adm-t3">—</span>}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[9px] text-adm-t3 max-w-[180px]">
                          {l.conditionExpr ? (
                            <span className="block truncate" title={l.conditionExpr}>
                              {l.conditionExpr}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
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

const HEADER_COLS = ['', '', 'Template Code', 'Event Code', 'Asset', 'Lines', 'DR / CR', 'Status'] as const;

const JournalTemplateSnapshot = () => {
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
          `${import.meta.env.VITE_API_URL}/admin/business-config/releases?subjectType=JOURNAL_TEMPLATE&take=50`,
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
            ? 'Journal Templates · Current Release'
            : 'Journal Templates · Historical Snapshot'
        }
        subtitle={releaseNo ?? ''}
        onBack={() => navigate('/dashboard/system/journal-header-templates/history')}
        onRefresh={() => void fetchData()}
        refreshing={loading}
        backLabel="Version History"
      >
        <div className="flex items-center gap-2">
          {release && <AdminBadge value={release.status} />}
          {release && !isActive && (
            <button
              onClick={() => navigate('/dashboard/system/journal-header-templates')}
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
            <SidebarKV label="Release No" value={release?.releaseNo} mono />
            <SidebarKV
              label="Items"
              value={release ? String(release.itemCount) : undefined}
              mono
            />
            <SidebarKV label="Based On" value={release?.basedOnReleaseNo ?? undefined} mono />
            <SidebarKV label="Published By" value={release?.publishedBy ?? undefined} />
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
            <SidebarKV label="Created" value={fmtDate(release?.createdAt)} mono />
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
              <SidebarKV
                label="Validated At"
                value={fmtDate(validation.validatedAt)}
                mono
              />
              {hasIssues &&
                validation.issues?.map((issue, i) => (
                  <div
                    key={i}
                    className="font-mono text-[9px] text-adm-red leading-relaxed"
                  >
                    · {issue}
                  </div>
                ))}
              {(validation.warnings ?? []).length > 0 && (
                <>
                  <SidebarKV
                    label="Warnings"
                    value={String((validation.warnings ?? []).length)}
                  />
                  {(validation.warnings ?? []).map((w, i) => (
                    <div
                      key={i}
                      className="font-mono text-[9px] text-adm-yellow leading-relaxed"
                    >
                      · {w}
                    </div>
                  ))}
                </>
              )}
            </SidebarGroup>
          )}

          {(release?.changeTicketId ?? release?.approvalCaseId) && (
            <SidebarGroup title="Governance">
              <SidebarKV
                label="Change Ticket"
                value={release?.changeTicketId ?? undefined}
                mono
              />
              <SidebarKV
                label="Approval Case"
                value={release?.approvalCaseId ?? undefined}
                mono
              />
            </SidebarGroup>
          )}

        </div>
      </div>

    </div>
  );
};

export default JournalTemplateSnapshot;
