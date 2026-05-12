import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Copy, Check } from 'lucide-react';
import { adminIconButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { copyToClipboard } from '../utils/clipboard';
import { TB_CODE_LABELS } from './tb-account.constants';

interface TbAccountDetailData {
  tbAccountId: string;
  code: number;
  ledger: number;
  ownerType: string;
  ownerUuid: string | null;
  ownerNo: string | null;
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

const BalanceCard = ({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: string | null;
  colorClass: string;
}) => (
  <div className="rounded border border-adm-border bg-adm-card p-4">
    <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
      {label}
    </p>
    {value !== null ? (
      <p className={`mt-1.5 font-mono text-[18px] font-bold ${colorClass}`}>
        {value}
      </p>
    ) : (
      <p className="mt-1.5 font-mono text-[12px] text-adm-t3">TB unavailable</p>
    )}
  </div>
);

const formatDate = (d: string) =>
  new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

const TbAccountDetail = () => {
  const { tbAccountId } = useParams<{ tbAccountId: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<TbAccountDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const seqRef = useRef(0);

  const fetchData = async () => {
    if (!tbAccountId) return;
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/tb/accounts/${tbAccountId}`,
      );
      if (seq !== seqRef.current) return;
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to load TB account.'));
        return;
      }
      setDetail(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      if (seq !== seqRef.current) return;
      setError('Failed to load TB account.');
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [tbAccountId]);

  const handleCopy = (text: string) => {
    copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const codeLabel = detail ? (TB_CODE_LABELS[detail.code] ?? `CODE_${detail.code}`) : '';
  const title = detail
    ? `TB Account · ${codeLabel} · ${detail.assetCode}`
    : 'TB Account';

  const netBalanceColor = (() => {
    if (!detail?.netBalance) return '';
    return BigInt(detail.netBalance) >= 0n ? 'text-adm-green' : 'text-adm-red';
  })();

  if (loading && !detail) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-adm-border bg-adm-panel px-5 py-3">
          <button onClick={() => navigate('/ledger/tb-accounts')} className={adminIconButtonClass()}>
            <ArrowLeft size={14} />
          </button>
          <span className="font-mono text-[11px] text-adm-t3">Loading…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-adm-border bg-adm-panel px-5 py-3">
          <button onClick={() => navigate('/ledger/tb-accounts')} className={adminIconButtonClass()}>
            <ArrowLeft size={14} />
          </button>
          <span className="font-mono text-[11px] text-adm-t1">{title}</span>
        </div>
        <div className="px-5 py-6 font-mono text-[11px] text-adm-red">{error}</div>
      </div>
    );
  }

  if (!detail) return null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-adm-border bg-adm-panel px-5 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/ledger/tb-accounts')} className={adminIconButtonClass()}>
            <ArrowLeft size={14} />
          </button>
          <div>
            <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
              TB Account
            </p>
            <p className="font-mono text-[13px] font-bold text-adm-amber">
              {codeLabel} · {detail.assetCode}
            </p>
          </div>
        </div>
        <button
          onClick={() => void fetchData()}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Body: main + sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main area */}
        <div className="flex-1 overflow-y-auto p-5">
          <Cap>Balance</Cap>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <BalanceCard label="Debits Posted" value={detail.debitsPosted} colorClass="text-adm-amber" />
            <BalanceCard label="Credits Posted" value={detail.creditsPosted} colorClass="text-adm-blue" />
            <BalanceCard label="Debits Pending" value={detail.debitsPending} colorClass="text-adm-amber/60" />
            <BalanceCard label="Credits Pending" value={detail.creditsPending} colorClass="text-adm-blue/60" />
            <BalanceCard label="Net Balance" value={detail.netBalance} colorClass={netBalanceColor} />
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-[272px] shrink-0 overflow-y-auto border-l border-adm-border bg-adm-panel px-5">
          <SidebarGroup title="Account Identity">
            <SidebarKV
              label="TB Account ID"
              mono
              value={
                <span className="inline-flex items-center gap-1">
                  <span className="truncate max-w-[120px]" title={detail.tbAccountId}>
                    {detail.tbAccountId}
                  </span>
                  <button
                    onClick={() => handleCopy(detail.tbAccountId)}
                    className="shrink-0 text-adm-t3 hover:text-adm-t1 transition-colors"
                    title="Copy"
                  >
                    {copied ? <Check size={10} /> : <Copy size={10} />}
                  </button>
                </span>
              }
            />
            <SidebarKV label="Code" mono value={`${detail.code} · ${codeLabel}`} />
            <SidebarKV label="Ledger" mono value={String(detail.ledger)} />
            <SidebarKV label="Asset" mono value={detail.assetCode} />
          </SidebarGroup>

          <SidebarGroup title="Ownership & Status">
            <SidebarKV label="Owner Type" value={<AdminBadge value={detail.ownerType} />} />
            <SidebarKV label="Owner No" mono value={detail.ownerNo} />
            <SidebarKV label="Status" value={<AdminBadge value={detail.status} />} />
            <SidebarKV label="Flags" mono value={`0x${detail.flags.toString(16).padStart(2, '0')}`} />
            <SidebarKV label="Description" value={detail.description} />
            <SidebarKV label="Created" mono value={formatDate(detail.createdAt)} />
          </SidebarGroup>
        </div>
      </div>
    </div>
  );
};

export default TbAccountDetail;
