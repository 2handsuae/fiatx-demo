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

interface ClearingHeader {
  code: string;
  clearingType: string;
  sourceType: string;
  description: string;
  isEnabled: boolean;
  feeMethod: 'CONFIGURED_FEE' | 'ACTUAL_FEE';
  lineTemplates: ClearingLine[];
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

const fmtDate = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const lineTypeColor = (t: LineType) => {
  if (t === 'INCOMING') return { text: 'text-adm-green', border: 'border-adm-green/40', bg: 'bg-adm-green/8', accent: 'bg-adm-green' };
  if (t === 'FEE')      return { text: 'text-adm-amber', border: 'border-adm-amber/40', bg: 'bg-adm-amber/8', accent: 'bg-adm-amber' };
  if (t === 'OUTGOING') return { text: 'text-adm-blue',  border: 'border-adm-blue/40',  bg: 'bg-adm-blue/8',  accent: 'bg-adm-blue' };
  return { text: 'text-adm-t2', border: 'border-adm-border', bg: 'bg-adm-bg', accent: 'bg-adm-t3' };
};

const ClearingTypeBadge = ({ type }: { type: string }) => {
  const cls =
    type === 'WITHDRAWAL'
      ? 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber'
      : type === 'INTERNAL_COLLECTION'
        ? 'border-adm-blue/25 bg-adm-blue/10 text-adm-blue'
        : 'border-adm-border bg-adm-bg text-adm-t3';
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest ${cls}`}>
      {type}
    </span>
  );
};

/* ── Clearing Flow Pipeline — signature element ──────────────────
   Visualises the fund movement path:
   INCOMING lanes → Pool node → FEE + OUTGOING lanes
   Each lane card: lineNo, partyType, amountSource, assetSource.
   ─────────────────────────────────────────────────────────────── */

const FlowArrow = () => (
  <div className="flex shrink-0 items-center">
    <div className="h-px w-6 bg-adm-border" />
    <svg width="8" height="8" viewBox="0 0 8 8" className="text-adm-t3">
      <path
        d="M0 4 L6 4 M3 1.5 L6 4 L3 6.5"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </div>
);

const LaneCard = ({ line }: { line: ClearingLine }) => {
  const c = lineTypeColor(line.lineType);
  return (
    <div
      className={`relative flex flex-col gap-1 rounded border ${c.border} ${c.bg} px-3 py-2.5 min-w-[140px] max-w-[180px]`}
    >
      {/* Type tag */}
      <div className="flex items-center justify-between">
        <span className={`font-mono text-[8px] font-bold uppercase tracking-widest ${c.text}`}>
          {line.lineType}
        </span>
        <span className="font-mono text-[8px] text-adm-t3">#{line.lineNo}</span>
      </div>

      {/* Party */}
      <p className={`font-mono text-[10px] font-semibold leading-snug ${c.text}`}>
        {line.partyType}
      </p>
      {line.partyIdSource && (
        <p className="font-mono text-[8.5px] text-adm-t3 leading-snug truncate" title={line.partyIdSource}>
          {line.partyIdSource}
        </p>
      )}

      {/* Amount + asset */}
      <div className="mt-0.5 border-t border-adm-border/50 pt-1">
        <p className="font-mono text-[9px] text-adm-t2 leading-snug">{line.amountSource}</p>
        <p className="font-mono text-[8.5px] text-adm-t3 leading-snug">{line.assetSource}</p>
      </div>

      {/* Enabled dot */}
      {!line.isEnabled && (
        <div className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-adm-t3" title="Disabled" />
      )}
    </div>
  );
};

const PoolNode = () => (
  <div className="flex shrink-0 flex-col items-center gap-1">
    <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-adm-border bg-adm-panel">
      <svg width="16" height="16" viewBox="0 0 16 16" className="text-adm-t3">
        <circle cx="8" cy="8" r="3" fill="currentColor" opacity="0.4" />
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1" fill="none" opacity="0.3" />
      </svg>
    </div>
    <span className="font-mono text-[7.5px] uppercase tracking-[0.1em] text-adm-t3">Pool</span>
  </div>
);

const ClearingFlowPipeline = ({ lines }: { lines: ClearingLine[] }) => {
  const incoming = lines.filter((l) => l.lineType === 'INCOMING').sort((a, b) => a.lineNo - b.lineNo);
  const fee      = lines.filter((l) => l.lineType === 'FEE').sort((a, b) => a.lineNo - b.lineNo);
  const outgoing = lines.filter((l) => l.lineType === 'OUTGOING').sort((a, b) => a.lineNo - b.lineNo);
  const other    = lines.filter((l) => !['INCOMING', 'FEE', 'OUTGOING'].includes(l.lineType));

  const maxRows = Math.max(incoming.length, fee.length + outgoing.length, 1);

  if (lines.length === 0) {
    return (
      <div className="mt-4 rounded border border-adm-border bg-adm-bg px-4 py-6 text-center font-mono text-[10px] text-adm-t3">
        No line templates defined.
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto">
      {/* Pipeline row */}
      <div className="flex min-w-max items-start gap-0 pb-2">

        {/* INCOMING column */}
        <div className="flex flex-col gap-2">
          <p className="mb-1 font-mono text-[8px] font-semibold uppercase tracking-[0.14em] text-adm-green">
            Incoming
          </p>
          {incoming.length > 0
            ? incoming.map((l) => <LaneCard key={l.lineNo} line={l} />)
            : <div className="flex h-12 w-[140px] items-center justify-center rounded border border-dashed border-adm-border font-mono text-[9px] text-adm-t3">—</div>}
        </div>

        {/* Arrow → Pool */}
        <div className="flex flex-col justify-center" style={{ marginTop: `calc(${Math.floor(incoming.length / 2)} * 72px + 28px)` }}>
          <FlowArrow />
        </div>

        {/* Pool */}
        <div className="flex flex-col justify-center" style={{ marginTop: `calc(${Math.floor(Math.max(incoming.length, 1) / 2)} * 72px + 4px)` }}>
          <PoolNode />
        </div>

        {/* Arrow Pool → outputs */}
        <div className="flex flex-col justify-center" style={{ marginTop: `calc(${Math.floor(Math.max(incoming.length, 1) / 2)} * 72px + 28px)` }}>
          <FlowArrow />
        </div>

        {/* FEE + OUTGOING columns */}
        <div className="flex flex-col gap-3">
          {/* Fee section */}
          {fee.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="mb-1 font-mono text-[8px] font-semibold uppercase tracking-[0.14em] text-adm-amber">
                Fee
              </p>
              {fee.map((l) => <LaneCard key={l.lineNo} line={l} />)}
            </div>
          )}

          {/* Outgoing section */}
          {outgoing.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="mb-1 font-mono text-[8px] font-semibold uppercase tracking-[0.14em] text-adm-blue">
                Outgoing
              </p>
              {outgoing.map((l) => <LaneCard key={l.lineNo} line={l} />)}
            </div>
          )}

          {/* Other types */}
          {other.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="mb-1 font-mono text-[8px] font-semibold uppercase tracking-[0.14em] text-adm-t3">
                Other
              </p>
              {other.map((l) => <LaneCard key={l.lineNo} line={l} />)}
            </div>
          )}

          {fee.length === 0 && outgoing.length === 0 && other.length === 0 && (
            <div className="flex h-12 w-[140px] items-center justify-center rounded border border-dashed border-adm-border font-mono text-[9px] text-adm-t3">—</div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-2 flex items-center gap-3">
        {(['INCOMING', 'FEE', 'OUTGOING'] as const).map((t) => {
          const c = lineTypeColor(t);
          return (
            <div key={t} className="flex items-center gap-1">
              <div className={`h-1.5 w-1.5 rounded-full ${c.accent}`} />
              <span className={`font-mono text-[8.5px] ${c.text}`}>{t}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ── Full line details table ────────────────────────────────────── */

const LineTable = ({ lines }: { lines: ClearingLine[] }) => (
  <div className="mt-3 overflow-auto rounded border border-adm-border">
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {['#', 'Type', 'Party', 'Party ID Source', 'Amount Source', 'Asset Source', 'Memo', 'Enabled'].map((h) => (
            <th
              key={h}
              className="border-b border-adm-border bg-adm-panel px-3 py-1.5 text-left font-mono text-[8.5px] font-semibold uppercase tracking-[0.1em] text-adm-t3 whitespace-nowrap"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => {
          const c = lineTypeColor(l.lineType);
          return (
            <tr key={l.lineNo} className={`border-b border-adm-border/50 last:border-b-0 border-l-2 ${c.border}`}>
              <td className="px-3 py-2 font-mono text-[10px] text-adm-t3">{l.lineNo}</td>
              <td className="px-3 py-2">
                <span className={`font-mono text-[9px] font-bold ${c.text}`}>{l.lineType}</span>
              </td>
              <td className="px-3 py-2 font-mono text-[10px] font-semibold text-adm-t1 whitespace-nowrap">
                {l.partyType}
              </td>
              <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                {l.partyIdSource || <span className="text-adm-t3">—</span>}
              </td>
              <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                {l.amountSource || <span className="text-adm-t3">—</span>}
              </td>
              <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                {l.assetSource || <span className="text-adm-t3">—</span>}
              </td>
              <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 max-w-[140px]">
                <span className="block truncate" title={l.memoTemplate ?? ''}>
                  {l.memoTemplate || <span className="text-adm-t3">—</span>}
                </span>
              </td>
              <td className="px-3 py-2">
                <span
                  className={`inline-flex items-center gap-1 font-mono text-[10px] font-medium ${
                    l.isEnabled ? 'text-adm-green' : 'text-adm-t3'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${l.isEnabled ? 'bg-adm-green' : 'bg-adm-t3'}`}
                  />
                  {l.isEnabled ? 'On' : 'Off'}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

/* ── Component ─────────────────────────────────────────────────── */

const ClearingHeaderTemplateDetail = () => {
  const { templateCode } = useParams<{ templateCode: string }>();
  const navigate = useNavigate();

  const [template, setTemplate] = useState<ClearingHeader | null>(null);
  const [release, setRelease] = useState<ReleaseContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const relRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases?subjectType=CLEARING_TEMPLATE&status=ACTIVE&take=1`,
      );
      if (!relRes.ok)
        throw new Error(await getApiErrorMessage(relRes, 'Failed to fetch releases.'));

      const listData = await relRes.json();
      const first = listData?.items?.[0];
      if (!first?.releaseNo) throw new Error('No active CLEARING_TEMPLATE release found.');

      const detailRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases/${first.releaseNo as string}`,
      );
      if (!detailRes.ok)
        throw new Error(await getApiErrorMessage(detailRes, 'Failed to fetch release detail.'));

      const detail = await detailRes.json();
      const item = (
        detail.items as Array<{ businessKey: string; payload: Record<string, unknown> }> | undefined
      )?.find((i) => String(i.payload.code ?? i.businessKey) === templateCode);

      if (!item)
        throw new Error(`Template "${templateCode ?? ''}" not found in current release.`);

      const p = item.payload;
      setTemplate({
        code: String(p.code ?? item.businessKey),
        clearingType: String(p.clearingType ?? ''),
        sourceType: String(p.sourceType ?? ''),
        description: String(p.description ?? ''),
        isEnabled: Boolean(p.isEnabled),
        feeMethod: (p.feeMethod as 'CONFIGURED_FEE' | 'ACTUAL_FEE') ?? 'CONFIGURED_FEE',
        lineTemplates: Array.isArray(p.lineTemplates)
          ? (p.lineTemplates as ClearingLine[])
          : [],
      });
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

  if (loading && !template) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-[11px] text-adm-t3">Loading…</p>
      </div>
    );
  }

  if (error && !template) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4 flex items-center">
          <button
            onClick={() => navigate('/dashboard/system/clearing-header-templates')}
            className="inline-flex items-center gap-1.5 rounded border border-adm-border bg-adm-panel px-3 py-1.5 font-mono text-[11px] text-adm-t2 hover:bg-adm-hover"
          >
            ← Clearing Templates
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

  if (!template) return null;

  const effectiveDate = release?.effectiveFrom ?? release?.publishedAt;
  const lines = template.lineTemplates;
  const incomingCount = lines.filter((l) => l.lineType === 'INCOMING').length;
  const feeCount = lines.filter((l) => l.lineType === 'FEE').length;
  const outgoingCount = lines.filter((l) => l.lineType === 'OUTGOING').length;

  const accentCls =
    template.clearingType === 'WITHDRAWAL'
      ? 'bg-adm-amber'
      : template.clearingType === 'INTERNAL_COLLECTION'
        ? 'bg-adm-blue'
        : 'bg-adm-t3/50';

  return (
    <div className="flex h-full flex-col overflow-hidden">

      <DetailPageHeader
        title="Clearing Templates · Template Detail"
        subtitle={template.code}
        onBack={() => navigate('/dashboard/system/clearing-header-templates')}
        onRefresh={() => void fetchData()}
        refreshing={loading}
        backLabel="Clearing Templates"
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
              <div className={`h-10 w-1 shrink-0 rounded-full ${accentCls}`} />
              <p className="font-mono text-[16px] font-bold leading-snug tracking-tight text-adm-amber break-all">
                {template.code}
              </p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ClearingTypeBadge type={template.clearingType} />
              <AdminBadge value={template.isEnabled ? 'ACTIVE' : 'DISABLED'} />
            </div>
            {template.description && (
              <p className="mt-3 text-[12px] text-adm-t2 leading-relaxed">{template.description}</p>
            )}
            <div className="mt-3 flex items-center gap-6">
              <div>
                <p className="mb-0.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Source Type</p>
                <p className="font-mono text-[10px] text-adm-t2">{template.sourceType || '—'}</p>
              </div>
              <div>
                <p className="mb-0.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Fee Method</p>
                <p className="font-mono text-[10px] text-adm-t2">{template.feeMethod}</p>
              </div>
              <div>
                <p className="mb-0.5 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Lines</p>
                <p className="font-mono text-[10px] text-adm-t2">{lines.length}</p>
              </div>
            </div>
          </section>

          {/* ② Clearing Flow Pipeline — signature element */}
          <section className="px-6 py-5">
            <Cap>Clearing Flow</Cap>
            <ClearingFlowPipeline lines={lines} />
          </section>

          {/* ③ Full line details */}
          {lines.length > 0 && (
            <section className="px-6 py-5">
              <Cap>Line Details</Cap>
              <LineTable lines={lines} />
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
            <SidebarKV label="Total" value={String(lines.length)} mono />
            <SidebarKV label="Incoming" value={<span className="text-adm-green">{incomingCount}</span>} />
            <SidebarKV label="Fee"      value={<span className="text-adm-amber">{feeCount}</span>} />
            <SidebarKV label="Outgoing" value={<span className="text-adm-blue">{outgoingCount}</span>} />
          </SidebarGroup>

          <SidebarGroup title="Configuration">
            <SidebarKV label="Fee Method" value={template.feeMethod} mono />
            <SidebarKV label="Source Type" value={template.sourceType} mono />
          </SidebarGroup>

          <SidebarGroup title="History">
            <button
              onClick={() => navigate('/dashboard/system/clearing-header-templates/history')}
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

export default ClearingHeaderTemplateDetail;
