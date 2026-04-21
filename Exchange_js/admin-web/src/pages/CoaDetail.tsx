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

type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

interface CoaPayload {
  code: string;
  type: AccountType;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
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

/* ── Display helpers ─────────────────────────────────────────────── */

const TYPE_BADGE_CLS: Record<AccountType, string> = {
  ASSET:     'border-adm-blue/25 bg-adm-blue/10 text-adm-blue',
  LIABILITY: 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber',
  EQUITY:    'border-adm-green/25 bg-adm-green/10 text-adm-green',
  REVENUE:   'border-adm-green/25 bg-adm-green/10 text-adm-green',
  EXPENSE:   'border-adm-red/25 bg-adm-red/10 text-adm-red',
};

const ACCENT_COLOR: Record<AccountType, string> = {
  ASSET:     'bg-adm-blue',
  EQUITY:    'bg-adm-blue',
  LIABILITY: 'bg-adm-amber',
  REVENUE:   'bg-adm-green',
  EXPENSE:   'bg-adm-red',
};

const TypeBadge = ({ type }: { type: AccountType }) => (
  <span className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest ${TYPE_BADGE_CLS[type]}`}>
    {type}
  </span>
);

const fmtDate = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── T-Account Diagram ───────────────────────────────────────────
   The signature element: visualises which side carries the normal balance.
   ASSET / EXPENSE → DR normal.   LIABILITY / EQUITY / REVENUE → CR normal.
   ─────────────────────────────────────────────────────────────── */

const NORMAL_BALANCE: Record<AccountType, 'DR' | 'CR'> = {
  ASSET:     'DR',
  EXPENSE:   'DR',
  LIABILITY: 'CR',
  EQUITY:    'CR',
  REVENUE:   'CR',
};

const ACCOUNTING_DESC: Record<AccountType, string> = {
  ASSET:     'Resources controlled by the entity',
  LIABILITY: 'Obligations owed to third parties',
  EQUITY:    'Residual interest of the owners',
  REVENUE:   'Income earned from operations',
  EXPENSE:   'Costs incurred to generate revenue',
};

const TAccountDiagram = ({ type }: { type: AccountType }) => {
  const normalSide = NORMAL_BALANCE[type];
  const drActive = normalSide === 'DR';
  const crActive = normalSide === 'CR';

  return (
    <div className="mt-4 flex flex-col items-start gap-2">
      <Cap>Normal Balance</Cap>
      {/* T-structure */}
      <div className="overflow-hidden rounded border border-adm-border">
        {/* Top bar (account name area above the T horizontal line) */}
        <div className="border-b border-adm-border bg-adm-bg px-4 py-1.5 text-center">
          <span className="font-mono text-[9px] text-adm-t3 tracking-[0.1em]">ACCOUNT</span>
        </div>
        {/* DR / CR halves */}
        <div className="flex divide-x divide-adm-border">
          {/* Debit side */}
          <div className={`flex w-28 flex-col items-center gap-1 px-4 py-3 ${drActive ? 'bg-adm-amber/8' : 'bg-adm-bg'}`}>
            <span className={`font-mono text-[11px] font-bold tracking-widest ${drActive ? 'text-adm-amber' : 'text-adm-t3/40'}`}>
              DR
            </span>
            {drActive ? (
              <>
                <div className="mt-1 h-px w-8 bg-adm-amber/40" />
                <span className="font-mono text-[8px] text-adm-amber/80">normal ↑</span>
              </>
            ) : (
              <div className="mt-1 h-px w-8 bg-adm-border/40" />
            )}
          </div>
          {/* Credit side */}
          <div className={`flex w-28 flex-col items-center gap-1 px-4 py-3 ${crActive ? 'bg-adm-blue/8' : 'bg-adm-bg'}`}>
            <span className={`font-mono text-[11px] font-bold tracking-widest ${crActive ? 'text-adm-blue' : 'text-adm-t3/40'}`}>
              CR
            </span>
            {crActive ? (
              <>
                <div className="mt-1 h-px w-8 bg-adm-blue/40" />
                <span className="font-mono text-[8px] text-adm-blue/80">normal ↑</span>
              </>
            ) : (
              <div className="mt-1 h-px w-8 bg-adm-border/40" />
            )}
          </div>
        </div>
      </div>
      <p className="font-mono text-[9px] text-adm-t3 leading-relaxed">
        {ACCOUNTING_DESC[type]}
      </p>
    </div>
  );
};

/* ── Component ─────────────────────────────────────────────────── */

const CoaDetail = () => {
  const { accountCode } = useParams<{ accountCode: string }>();
  const navigate = useNavigate();

  const [payload, setPayload] = useState<CoaPayload | null>(null);
  const [release, setRelease] = useState<ReleaseContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const relListRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases?subjectType=COA&status=ACTIVE&take=1`,
      );
      if (!relListRes.ok)
        throw new Error(await getApiErrorMessage(relListRes, 'Failed to fetch releases.'));

      const listData = await relListRes.json();
      const first = listData?.items?.[0];
      if (!first?.releaseNo) throw new Error('No active COA release found.');

      const detailRes = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/business-config/releases/${first.releaseNo as string}`,
      );
      if (!detailRes.ok)
        throw new Error(await getApiErrorMessage(detailRes, 'Failed to fetch release detail.'));

      const detail = await detailRes.json();
      const item = (detail.items as Array<{ businessKey: string; payload: unknown }> | undefined)?.find(
        (i) => i.businessKey === accountCode,
      );
      if (!item) throw new Error(`Account "${accountCode ?? ''}" not found in current release.`);

      setPayload(item.payload as CoaPayload);
      setRelease({
        releaseNo: detail.releaseNo as string,
        publishedAt: (detail.publishedAt ?? null) as string | null,
        effectiveFrom: (detail.effectiveFrom ?? null) as string | null,
      });
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load account.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [accountCode]);

  /* ── Loading ── */
  if (loading && !payload) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-[11px] text-adm-t3">Loading…</p>
      </div>
    );
  }

  /* ── Error (no data yet) ── */
  if (error && !payload) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4 flex items-center gap-2">
          <button
            onClick={() => navigate('/ledger/coa')}
            className="inline-flex items-center gap-1.5 rounded border border-adm-border bg-adm-panel px-3 py-1.5 font-mono text-[11px] text-adm-t2 hover:bg-adm-hover"
          >
            ← Chart of Accounts
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

  if (!payload) return null;

  const effectiveDate = release?.effectiveFrom ?? release?.publishedAt;

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Header ── */}
      <DetailPageHeader
        title="Chart of Accounts · Account Detail"
        subtitle={payload.code}
        onBack={() => navigate('/ledger/coa')}
        onRefresh={() => void fetchData()}
        refreshing={loading}
        backLabel="Chart of Accounts"
      />

      {/* ── Inline error ── */}
      {error && (
        <div className="shrink-0 px-6 pt-3 pb-1">
          <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ① Identity */}
          <section className="bg-adm-card px-6 py-5">
            <Cap>Account</Cap>
            <div className="mt-1.5 flex items-center gap-3">
              {/* Type colour accent bar */}
              <div className={`h-10 w-1 shrink-0 rounded-full ${ACCENT_COLOR[payload.type]}`} />
              <p className="font-mono text-[22px] font-bold leading-none tracking-tight text-adm-amber">
                {payload.code}
              </p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <TypeBadge type={payload.type} />
              <AdminBadge value={payload.status} />
            </div>
            <p className="mt-3 text-[13px] text-adm-t1 leading-snug">
              {payload.name}
            </p>
          </section>

          {/* ② T-Account diagram */}
          <section className="px-6 py-5">
            <TAccountDiagram type={payload.type} />
          </section>

          {/* ③ Classification */}
          <section className="px-6 py-5">
            <Cap>Classification</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <div>
                <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Account Type</p>
                <TypeBadge type={payload.type} />
              </div>
              <div>
                <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Status</p>
                <AdminBadge value={payload.status} />
              </div>
              <div className="col-span-2">
                <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Full Name</p>
                <p className="text-[11px] text-adm-t2 leading-relaxed">{payload.name}</p>
              </div>
              <div className="col-span-2">
                <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Account Code</p>
                <p className="font-mono text-[11px] text-adm-t2">{payload.code}</p>
              </div>
            </div>
          </section>

        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {release && (
            <SidebarGroup title="Release">
              <SidebarKV label="Release No"  value={release.releaseNo}          mono />
              <SidebarKV label="Effective"   value={fmtDate(effectiveDate)}     mono />
              <SidebarKV label="Published"   value={fmtDate(release.publishedAt)} mono />
            </SidebarGroup>
          )}

          <SidebarGroup title="History">
            <button
              onClick={() => navigate('/ledger/coa/history')}
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

export default CoaDetail;
