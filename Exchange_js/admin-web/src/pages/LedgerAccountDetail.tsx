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
import { TB_CODE_LABELS } from './ledger-account.constants';

/* ── Interfaces ──────────────────────────────────────────────── */

interface LedgerAccountDetailData {
  tbAccountId: string;
  code: number;
  ledger: number;
  ownerType: string;
  ownerUuid: string | null;
  ownerNo: string | null;
  ownerName: string | null;
  assetCode: string;
  status: string;
  description: string | null;
  flags: number;
  createdAt: string;
  debitsPosted: string | null;
  creditsPosted: string | null;
  debitsPending: string | null;
  creditsPending: string | null;
  netBalance: string | null;
}

/* ── Layout primitives (Pattern B) ── */

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

const BalanceField = ({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: string | null;
  colorClass: string;
}) => (
  <div className="min-w-0">
    <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">{label}</div>
    {value !== null ? (
      <div className={`mt-1 font-mono text-[11px] break-all ${colorClass}`}>{value}</div>
    ) : (
      <div className="mt-1 font-mono text-[11px] text-adm-t3">TB unavailable</div>
    )}
  </div>
);

/* ── Main Component ──────────────────────────────────────────── */

export default function LedgerAccountDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<LedgerAccountDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const seqRef = useRef(0);

  const fetchData = async () => {
    if (!id) return;
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/tb/accounts/${id}`,
      );
      if (seq !== seqRef.current) return;
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to load ledger account.'));
        return;
      }
      setDetail(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (seq !== seqRef.current) return;
      setError('Failed to load ledger account.');
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [id]);

  const handleCopy = (text: string) => {
    copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const codeLabel = detail ? (TB_CODE_LABELS[detail.code] ?? `CODE_${detail.code}`) : '';

  const netBalanceColor = (() => {
    if (!detail?.netBalance) return '';
    return BigInt(detail.netBalance) >= 0n ? 'text-adm-green' : 'text-adm-red';
  })();

  /* ── Loading state ── */

  if (loading && !detail) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-4">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-adm-amber border-t-transparent" />
        <p className="mt-1 font-mono text-[11px] text-adm-t3">Loading ledger account…</p>
        <button onClick={() => navigate('/admin/ledger/accounts')} className={adminButtonClass('detailUtility')}>
          ← Back to Accounts
        </button>
      </div>
    );
  }

  /* ── Error state ── */

  if (!detail) {
    return (
      <div className="space-y-4 rounded border border-adm-red/30 bg-adm-red/10 p-8 text-center">
        <div className="font-mono text-[11px] text-adm-red">{error || 'Ledger account not found'}</div>
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => navigate('/admin/ledger/accounts')} className={adminButtonClass('detailUtility')}>
            Back to Accounts
          </button>
          <button onClick={() => void fetchData()} className={adminButtonClass('detailUtility')}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <DetailPageHeader
        backLabel="Ledger Accounts"
        onBack={() => navigate('/admin/ledger/accounts')}
        onRefresh={() => void fetchData()}
        refreshing={loading}
      />

      {/* ── Body: two-column layout ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ① Identity */}
          <section className="bg-adm-card px-6 py-5">
            <p className="font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {codeLabel} · {detail.assetCode}
            </p>
            <div className="mt-3 flex items-center gap-4 flex-wrap">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Status</div>
                <div className="mt-1"><AdminBadge value={detail.status} /></div>
              </div>
              <button
                onClick={() => navigate(`/admin/ledger/account-statement?account=${detail.tbAccountId}`)}
                className={adminButtonClass('detailUtility')}
                title="View this account's ledger activity"
              >
                View Statement (流水) →
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-2">
              <InfoField label="Code" value={String(detail.code)} mono />
              <InfoField label="Ledger" value={String(detail.ledger)} mono />
              <InfoField label="Owner Type" value={detail.ownerType} />
            </div>
          </section>

          {/* ② Balance (Real-Time) */}
          <section className="px-6 py-5">
            <Cap>Balance (Real-Time)</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <BalanceField label="Debits Posted" value={detail.debitsPosted} colorClass="text-adm-amber" />
              <BalanceField label="Credits Posted" value={detail.creditsPosted} colorClass="text-adm-blue" />
              <BalanceField label="Debits Pending" value={detail.debitsPending} colorClass="text-adm-amber/60" />
              <BalanceField label="Credits Pending" value={detail.creditsPending} colorClass="text-adm-blue/60" />
              <BalanceField label="Net Balance" value={detail.netBalance} colorClass={netBalanceColor} />
            </div>
          </section>

          {/* ③ Details */}
          <section className="px-6 py-5">
            <Cap>Details</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField
                label="Owner Type"
                value={detail.ownerType}
              />
              {detail.ownerType === 'CUSTOMER' ? (
                <>
                  <div className="min-w-0">
                    <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Customer No</div>
                    <div className="mt-1 text-[13px]">
                      {detail.ownerNo && detail.ownerUuid ? (
                        <button
                          onClick={() => navigate(`/admin/customers/${detail.ownerUuid}`)}
                          className="text-adm-amber hover:underline font-mono text-[11px]"
                          title="Open customer"
                        >
                          {detail.ownerNo}
                        </button>
                      ) : (
                        <span className="text-adm-t3">—</span>
                      )}
                    </div>
                  </div>
                  <InfoField
                    label="Customer Name"
                    value={detail.ownerName ?? '—'}
                  />
                </>
              ) : (
                <InfoField
                  label="Owner No"
                  value={detail.ownerNo ?? '—'}
                  mono
                />
              )}
              <InfoField
                label="Flags"
                value={`0x${detail.flags.toString(16).padStart(2, '0')}`}
                mono
              />
              <InfoField
                label="Description"
                value={detail.description ?? '—'}
              />
            </div>
          </section>

          {/* ④ Audit */}
          <section className="px-6 py-5">
            <Cap>Audit</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField
                label="Created"
                value={formatDate(detail.createdAt)}
                mono
              />
            </div>
          </section>

        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          <SidebarGroup title="Identity Summary">
            <SidebarKV label="Account" value={`${codeLabel} · ${detail.assetCode}`} />
            <SidebarKV label="Status" value={<AdminBadge value={detail.status} />} />
            <SidebarKV label="Owner Type" value={detail.ownerType} />
            {detail.ownerNo ? (
              <SidebarKV
                label={detail.ownerType === 'CUSTOMER' ? 'Customer No' : 'Owner No'}
                value={detail.ownerNo}
                mono
              />
            ) : null}
            {detail.ownerType === 'CUSTOMER' && detail.ownerName ? (
              <SidebarKV label="Customer Name" value={detail.ownerName} />
            ) : null}
            <SidebarKV label="Asset" value={detail.assetCode} mono />
            <SidebarKV
              label="TB ID"
              mono
              value={
                <span className="inline-flex items-center gap-1">
                  <span className="truncate max-w-[100px]" title={detail.tbAccountId}>
                    {detail.tbAccountId}
                  </span>
                  <button
                    onClick={() => handleCopy(detail.tbAccountId)}
                    className="shrink-0 text-adm-t3 hover:text-adm-t1 transition-colors"
                    title="Copy TB ID"
                  >
                    {copied ? <Check size={10} /> : <Copy size={10} />}
                  </button>
                </span>
              }
            />
          </SidebarGroup>

          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={formatDate(detail.createdAt)} mono />
          </SidebarGroup>

        </div>
      </div>
    </div>
  );
}
