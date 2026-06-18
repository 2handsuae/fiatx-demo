import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Copy, Check } from 'lucide-react';
import { AdminBadge } from '../components/ui/AdminBadge';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
import { copyToClipboard } from '../utils/clipboard';

/* ── Interfaces ──────────────────────────────────────────────── */

interface TransferEvidenceData {
  tbTransferId: string;
  sourceType: string;
  sourceNo: string;
  eventCode: string;
  debitCode: string;
  creditCode: string;
  amount: string;
  assetCode: string;
  transferType: string;
  traceId: string;
  actorType: string;
  actorId: string;
  memo: string | null;
  pendingId: string | null;
  debitTbAccountId: string | null;
  creditTbAccountId: string | null;
  createdAt: string;
}

/* ── Layout primitives ──────────────────────────────────────── */

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

const formatDate = (d: string) =>
  new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

const SOURCE_ROUTES: Record<string, string> = {
  DEPOSIT: '/admin/trading/deposits',
  WITHDRAWAL: '/admin/trading/withdrawals',
  SWAP: '/admin/trading/swaps',
  INTERNAL: '/admin/funds/transfers',
};

function buildSourceLink(sourceType: string, sourceNo: string): string | null {
  const base = SOURCE_ROUTES[sourceType];
  return base ? `${base}/${sourceNo}` : null;
}

/** TB account code → human-readable COA label */
const CODE_TO_COA: Record<string, string> = {
  '1': 'A.CLIENT_BANK',
  '10': 'A.CLIENT_CUSTODY',
  '50': 'A.FIRM_TREASURY',
  '60': 'A.FX_POSITION',
  '100': 'L.CLIENT_PAYABLE',
  '101': 'L.DEPOSIT_SUSPENSE',
  '110': 'L.TRADE_CLEARING',
  '200': 'E.PAID_IN_CAPITAL',
  '210': 'E.RETAINED_EARNINGS',
  '300': 'R.FEE_INCOME',
  '310': 'R.SPREAD_INCOME',
  '320': 'R.FX_UNREALIZED_PNL',
  '330': 'R.FX_REALIZED_PNL',
};

function coaLabel(code: string): string {
  return CODE_TO_COA[code] ?? code;
}

/** Asset decimals for formatting raw TB integer amounts */
const ASSET_DECIMALS: Record<string, number> = { USDT: 6, AED: 2 };

function formatTbAmount(rawAmount: string, assetCode: string): string {
  const decimals = ASSET_DECIMALS[assetCode] ?? 6;
  const num = Number(rawAmount) / Math.pow(10, decimals);
  return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function truncateHex(hex: string | null): string {
  if (!hex) return '—';
  return hex.length > 16 ? `${hex.slice(0, 8)}…${hex.slice(-8)}` : hex;
}

/* ── Main Component ──────────────────────────────────────────── */

export default function TransferEvidenceDetail() {
  const { tbTransferId } = useParams<{ tbTransferId: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<TransferEvidenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const seqRef = useRef(0);

  const fetchData = async () => {
    if (!tbTransferId) return;
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/tb/transfers/${tbTransferId}`,
      );
      if (seq !== seqRef.current) return;
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to load transfer evidence.'));
        return;
      }
      setDetail(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (seq !== seqRef.current) return;
      setError('Failed to load transfer evidence.');
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [tbTransferId]);

  const handleCopy = (text: string, field: string) => {
    copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const CopyBtn = ({ text, field }: { text: string; field: string }) => (
    <button
      onClick={() => handleCopy(text, field)}
      className="shrink-0 text-adm-t3 hover:text-adm-t1 transition-colors"
      title="Copy"
    >
      {copiedField === field ? <Check size={10} /> : <Copy size={10} />}
    </button>
  );

  /* ── Loading state ── */

  if (loading && !detail) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-4">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-adm-amber border-t-transparent" />
        <p className="mt-1 font-mono text-[11px] text-adm-t3">Loading transfer evidence…</p>
        <button onClick={() => navigate('/admin/ledger/transfer-evidence')} className={adminButtonClass('detailUtility')}>
          ← Back to Transfers
        </button>
      </div>
    );
  }

  /* ── Error state ── */

  if (!detail) {
    return (
      <div className="space-y-4 rounded border border-adm-red/30 bg-adm-red/10 p-8 text-center">
        <div className="font-mono text-[11px] text-adm-red">{error || 'Transfer evidence not found'}</div>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => navigate('/admin/ledger/transfer-evidence')} className={adminButtonClass('detailUtility')}>
            Back to Transfers
          </button>
          <button onClick={() => void fetchData()} className={adminButtonClass('detailUtility')}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const sourceLink = buildSourceLink(detail.sourceType, detail.sourceNo);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <DetailPageHeader
        backLabel="Transfer Evidence"
        onBack={() => navigate('/admin/ledger/transfer-evidence')}
        onRefresh={() => void fetchData()}
        refreshing={loading}
      />

      {/* ── Body: two-column layout ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ① Hero — Amount + Type */}
          <section className="bg-adm-card px-6 py-5">
            <p className="font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {formatTbAmount(detail.amount, detail.assetCode)} <span className="text-[14px] text-adm-t2">{detail.assetCode}</span>
            </p>
            <div className="mt-3 flex items-center gap-4">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Transfer Type</div>
                <div className="mt-1"><AdminBadge value={detail.transferType} /></div>
              </div>
            </div>
          </section>

          {/* ② Source Info */}
          <section className="px-6 py-5">
            <Cap>Source Info</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Source Type" value={detail.sourceType} />
              <InfoField label="Source No" value={detail.sourceNo} mono accent link={sourceLink ?? undefined} />
              <InfoField label="Event Code" value={detail.eventCode} mono />
            </div>
          </section>

          {/* ③ Accounting Entry */}
          <section className="px-6 py-5">
            <Cap>Accounting Entry</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Debit" value={coaLabel(detail.debitCode)} mono />
              <InfoField label="Credit" value={coaLabel(detail.creditCode)} mono />
              <InfoField
                label="Debit Account"
                value={truncateHex(detail.debitTbAccountId)}
                mono
                link={detail.debitTbAccountId ? `/admin/ledger/accounts/${detail.debitTbAccountId}` : undefined}
              />
              <InfoField
                label="Credit Account"
                value={truncateHex(detail.creditTbAccountId)}
                mono
                link={detail.creditTbAccountId ? `/admin/ledger/accounts/${detail.creditTbAccountId}` : undefined}
              />
              <InfoField label="Amount" value={formatTbAmount(detail.amount, detail.assetCode)} mono />
              <InfoField label="Asset" value={detail.assetCode} />
            </div>
          </section>

          {/* ④ Actor & Trace */}
          <section className="px-6 py-5">
            <Cap>Actor &amp; Trace</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Actor Type" value={detail.actorType} />
              <InfoField label="Actor ID" value={detail.actorId} mono />
              <InfoField
                label="Trace ID"
                value={detail.traceId}
                mono
                copyable
                onCopy={(v) => handleCopy(v, 'traceId')}
                isCopied={copiedField === 'traceId'}
              />
              <InfoField label="Memo" value={detail.memo} />
            </div>
          </section>

        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          <SidebarGroup title="Identity">
            <SidebarKV
              label="Transfer ID"
              mono
              value={
                <span className="inline-flex items-center gap-1">
                  <span className="truncate max-w-[100px]" title={detail.tbTransferId}>
                    {detail.tbTransferId}
                  </span>
                  <CopyBtn text={detail.tbTransferId} field="tbTransferId" />
                </span>
              }
            />
            <SidebarKV label="Type" value={<AdminBadge value={detail.transferType} />} />
            <SidebarKV label="Pending ID" value={detail.pendingId ?? '—'} mono />
          </SidebarGroup>

          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={formatDate(detail.createdAt)} mono />
          </SidebarGroup>

        </div>
      </div>
    </div>
  );
}
