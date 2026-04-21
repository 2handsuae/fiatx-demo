import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DetailPageHeader } from '../components/compliance/DetailPageComponents';
import { AdminBadge } from '../components/ui/AdminBadge';
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
  ownerIdSource?: string;
  dimensionsRule?: string;
  description?: string;
  conditionExpr?: string;
  fxRateSource?: string;
  referenceSource?: string;
}

interface JournalHeader {
  templateCode: string;
  eventCode: string;
  version: number;
  status: string;
  description?: string;
}

interface ReleaseContext {
  releaseNo: string;
  publishedAt: string | null;
  effectiveFrom: string | null;
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

const AssetBadge = ({ type }: { type: 'CRYPTO' | 'FIAT' | 'ALL' }) => {
  const cls =
    type === 'CRYPTO'
      ? 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber'
      : type === 'FIAT'
        ? 'border-adm-blue/25 bg-adm-blue/10 text-adm-blue'
        : 'border-adm-border bg-adm-bg text-adm-t3';
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest ${cls}`}
    >
      {type}
    </span>
  );
};

const fmtDate = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── DR/CR Ledger — signature element ───────────────────────────
   Renders journal lines as a double-entry ledger table.
   DR entries have an amber left accent; CR entries have a blue accent.
   Each line shows: lineNo, accountCode, amountSource, asset, condition.
   ─────────────────────────────────────────────────────────────── */

const LedgerTable = ({ lines }: { lines: JournalLine[] }) => {
  const drLines = lines.filter((l) => l.drCr === 'DR');
  const crLines = lines.filter((l) => l.drCr === 'CR');

  const LineRow = ({ line, side }: { line: JournalLine; side: 'DR' | 'CR' }) => {
    const isDr = side === 'DR';
    return (
      <div
        className={`relative flex flex-col gap-0.5 border-b border-adm-border/50 px-3 py-2.5 last:border-b-0 ${
          isDr ? 'border-l-2 border-l-adm-amber/60' : 'border-l-2 border-l-adm-blue/60'
        }`}
      >
        {/* Line number + account */}
        <div className="flex items-center justify-between gap-2">
          <span
            className={`font-mono text-[10px] font-semibold ${isDr ? 'text-adm-amber' : 'text-adm-blue'}`}
          >
            {line.accountCode}
          </span>
          <span className="font-mono text-[9px] text-adm-t3">#{line.lineNo}</span>
        </div>

        {/* Amount + asset */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[9px] text-adm-t2">{line.amountSource}</span>
          {line.assetSource && (
            <>
              <span className="text-adm-t3">·</span>
              <span className="font-mono text-[9px] text-adm-t3">{line.assetSource}</span>
            </>
          )}
        </div>

        {/* Description */}
        {line.description && (
          <p className="font-mono text-[8.5px] italic text-adm-t3 leading-snug">
            {line.description}
          </p>
        )}

        {/* Condition */}
        {line.conditionExpr && (
          <div className="mt-0.5 rounded bg-adm-bg px-1.5 py-0.5">
            <span className="font-mono text-[8px] text-adm-t3">if </span>
            <span className="font-mono text-[8px] text-adm-t2">{line.conditionExpr}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mt-4">
      {/* Header bar */}
      <div className="grid grid-cols-2 overflow-hidden rounded-t border border-adm-border">
        <div className="border-r border-adm-border bg-adm-amber/8 px-3 py-1.5">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-adm-amber">
            Debit · DR
          </span>
          <span className="ml-2 font-mono text-[9px] text-adm-amber/60">
            {drLines.length} line{drLines.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="bg-adm-blue/8 px-3 py-1.5">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-adm-blue">
            Credit · CR
          </span>
          <span className="ml-2 font-mono text-[9px] text-adm-blue/60">
            {crLines.length} line{crLines.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Two-column ledger body */}
      <div className="grid grid-cols-2 overflow-hidden rounded-b border border-t-0 border-adm-border">
        {/* DR column */}
        <div className="border-r border-adm-border">
          {drLines.length === 0 ? (
            <p className="px-3 py-4 text-center font-mono text-[10px] text-adm-t3">—</p>
          ) : (
            drLines.map((l) => <LineRow key={l.lineNo} line={l} side="DR" />)
          )}
        </div>

        {/* CR column */}
        <div>
          {crLines.length === 0 ? (
            <p className="px-3 py-4 text-center font-mono text-[10px] text-adm-t3">—</p>
          ) : (
            crLines.map((l) => <LineRow key={l.lineNo} line={l} side="CR" />)
          )}
        </div>
      </div>

      {/* Balance indicator */}
      <div
        className={`mt-2 flex items-center justify-end gap-1.5 font-mono text-[9px] ${
          drLines.length === crLines.length ? 'text-adm-green' : 'text-adm-amber'
        }`}
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            drLines.length === crLines.length ? 'bg-adm-green' : 'bg-adm-amber'
          }`}
        />
        {drLines.length === crLines.length
          ? 'DR / CR lines balanced'
          : `DR ${drLines.length} · CR ${crLines.length} — asymmetric`}
      </div>
    </div>
  );
};

/* ── Extra line details table ───────────────────────────────────── */

const LineDetailsTable = ({ lines }: { lines: JournalLine[] }) => (
  <div className="mt-3 overflow-auto rounded border border-adm-border">
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {['#', 'DR/CR', 'Account', 'Amount Source', 'Asset Source', 'Owner Type', 'FX Rate', 'Reference'].map(
            (h) => (
              <th
                key={h}
                className="border-b border-adm-border bg-adm-panel px-3 py-1.5 text-left font-mono text-[8.5px] font-semibold uppercase tracking-[0.1em] text-adm-t3 whitespace-nowrap"
              >
                {h}
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.lineNo} className="border-b border-adm-border/50 last:border-b-0">
            <td className="px-3 py-2 font-mono text-[10px] text-adm-t3">{l.lineNo}</td>
            <td className="px-3 py-2">
              <span
                className={`font-mono text-[9px] font-bold ${l.drCr === 'DR' ? 'text-adm-amber' : 'text-adm-blue'}`}
              >
                {l.drCr}
              </span>
            </td>
            <td className="px-3 py-2 font-mono text-[10px] font-semibold text-adm-t1 whitespace-nowrap">
              {l.accountCode}
            </td>
            <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
              {l.amountSource || <span className="text-adm-t3">—</span>}
            </td>
            <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
              {l.assetSource || <span className="text-adm-t3">—</span>}
            </td>
            <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
              {l.ownerTypeSource || <span className="text-adm-t3">—</span>}
            </td>
            <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
              {l.fxRateSource || <span className="text-adm-t3">—</span>}
            </td>
            <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
              {l.referenceSource || <span className="text-adm-t3">—</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/* ── Component ─────────────────────────────────────────────────── */

const JournalHeaderTemplateDetail = () => {
  const { templateCode } = useParams<{ templateCode: string }>();
  const navigate = useNavigate();

  const [header, setHeader] = useState<JournalHeader | null>(null);
  const [lines, setLines] = useState<JournalLine[]>([]);
  const [release, setRelease] = useState<ReleaseContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const relRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases?subjectType=JOURNAL_TEMPLATE&status=ACTIVE&take=1`,
      );
      if (!relRes.ok)
        throw new Error(await getApiErrorMessage(relRes, 'Failed to fetch releases.'));

      const listData = await relRes.json();
      const first = listData?.items?.[0];
      if (!first?.releaseNo) throw new Error('No active JOURNAL_TEMPLATE release found.');

      const detailRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases/${first.releaseNo as string}`,
      );
      if (!detailRes.ok)
        throw new Error(await getApiErrorMessage(detailRes, 'Failed to fetch release detail.'));

      const detail = await detailRes.json();
      const item = (
        detail.items as Array<{ businessKey: string; payload: Record<string, unknown> }> | undefined
      )?.find((i) => {
        const h = (i.payload.header ?? {}) as Record<string, unknown>;
        return String(h.templateCode ?? i.businessKey) === templateCode;
      });

      if (!item)
        throw new Error(`Template "${templateCode ?? ''}" not found in current release.`);

      const p = item.payload;
      const h = (p.header ?? {}) as Record<string, unknown>;
      setHeader({
        templateCode: String(h.templateCode ?? item.businessKey),
        eventCode: String(h.eventCode ?? ''),
        version: Number(h.version ?? 1),
        status: String(h.status ?? 'UNKNOWN'),
        description: h.description ? String(h.description) : undefined,
      });
      setLines(Array.isArray(p.lines) ? (p.lines as JournalLine[]) : []);
      setRelease({
        releaseNo: detail.releaseNo as string,
        publishedAt: (detail.publishedAt ?? null) as string | null,
        effectiveFrom: (detail.effectiveFrom ?? null) as string | null,
      });
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load template.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [templateCode]);

  if (loading && !header) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-[11px] text-adm-t3">Loading…</p>
      </div>
    );
  }

  if (error && !header) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4 flex items-center">
          <button
            onClick={() => navigate('/dashboard/system/journal-header-templates')}
            className="inline-flex items-center gap-1.5 rounded border border-adm-border bg-adm-panel px-3 py-1.5 font-mono text-[11px] text-adm-t2 hover:bg-adm-hover"
          >
            ← Journal Templates
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

  if (!header) return null;

  const assetType = deriveAssetType(header.eventCode);
  const isActive = header.status === 'ACTIVE';
  const effectiveDate = release?.effectiveFrom ?? release?.publishedAt;
  const drCount = lines.filter((l) => l.drCr === 'DR').length;
  const crCount = lines.filter((l) => l.drCr === 'CR').length;

  return (
    <div className="flex h-full flex-col overflow-hidden">

      <DetailPageHeader
        title="Journal Templates · Template Detail"
        subtitle={header.templateCode}
        onBack={() => navigate('/dashboard/system/journal-header-templates')}
        onRefresh={() => void fetchData()}
        refreshing={loading}
        backLabel="Journal Templates"
      />

      {error && (
        <div className="shrink-0 px-6 pt-3 pb-1">
          <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ① Identity */}
          <section className="bg-adm-card px-6 py-5">
            <Cap>Template</Cap>
            <div className="mt-1.5 flex items-center gap-3">
              <div
                className={`h-10 w-1 shrink-0 rounded-full ${
                  assetType === 'CRYPTO'
                    ? 'bg-adm-amber'
                    : assetType === 'FIAT'
                      ? 'bg-adm-blue'
                      : 'bg-adm-t3/50'
                }`}
              />
              <p className="font-mono text-[16px] font-bold leading-snug tracking-tight text-adm-amber break-all">
                {header.templateCode}
              </p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <AssetBadge type={assetType} />
              <AdminBadge value={isActive ? 'ACTIVE' : 'DISABLED'} />
            </div>
            {header.description && (
              <p className="mt-3 text-[12px] text-adm-t2 leading-relaxed">
                {header.description}
              </p>
            )}
            <div className="mt-3 flex items-center gap-4">
              <div>
                <p className="mb-0.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Event Code
                </p>
                <p className="font-mono text-[10px] text-adm-t2">{header.eventCode}</p>
              </div>
              <div>
                <p className="mb-0.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Version
                </p>
                <p className="font-mono text-[10px] text-adm-t2">{header.version}</p>
              </div>
              <div>
                <p className="mb-0.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
                  Lines
                </p>
                <p className="font-mono text-[10px] text-adm-t2">{lines.length}</p>
              </div>
            </div>
          </section>

          {/* ② DR/CR Ledger — the signature element */}
          <section className="px-6 py-5">
            <Cap>Double-Entry Ledger</Cap>
            <LedgerTable lines={lines} />
          </section>

          {/* ③ Full line details */}
          {lines.length > 0 && (
            <section className="px-6 py-5">
              <Cap>Line Details</Cap>
              <LineDetailsTable lines={lines} />
            </section>
          )}

        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {release && (
            <SidebarGroup title="Release">
              <SidebarKV label="Release No" value={release.releaseNo} mono />
              <SidebarKV label="Effective" value={fmtDate(effectiveDate)} mono />
              <SidebarKV label="Published" value={fmtDate(release.publishedAt)} mono />
            </SidebarGroup>
          )}

          <SidebarGroup title="Lines">
            <SidebarKV
              label="Total"
              value={String(lines.length)}
              mono
            />
            <SidebarKV
              label="DR"
              value={<span className="text-adm-amber">{drCount}</span>}
            />
            <SidebarKV
              label="CR"
              value={<span className="text-adm-blue">{crCount}</span>}
            />
            <SidebarKV
              label="Balanced"
              value={
                drCount === crCount ? (
                  <span className="text-adm-green">Yes</span>
                ) : (
                  <span className="text-adm-amber">No</span>
                )
              }
            />
          </SidebarGroup>

          <SidebarGroup title="History">
            <button
              onClick={() => navigate('/dashboard/system/journal-header-templates/history')}
              className="text-left font-mono text-[10px] text-adm-amber underline transition-opacity hover:opacity-75"
            >
              View all versions →
            </button>
          </SidebarGroup>

        </div>
      </div>

    </div>
  );
};

export default JournalHeaderTemplateDetail;
