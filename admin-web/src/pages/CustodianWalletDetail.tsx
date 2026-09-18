import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { copyToClipboard } from '../utils/clipboard';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
import { AdminBadge } from '../components/ui/AdminBadge';
import { WalletRoleBadge } from '../utils/walletRole.util';

/* ── Interfaces ──────────────────────────────────────────────── */

interface WalletDetailData {
  id: string;
  walletNo: string;
  vaultCode: string;
  walletRole: string;
  ownerType: string;
  ownerNo: string | null;
  ownerName?: string | null;
  network: string;

  address: string | null;
  iban: string | null;
  custodianRef: string | null;

  status: string;

  createdAt: string;
  updatedAt: string;

  networkInfo: {
    kind: string;
    custodian: string;
    bankName: string | null;
    accountName: string | null;
    explorerUrl: string | null;
  } | null;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Layout primitives (Pattern B — same as PlatformMemberDetailPage) ── */

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

/* ── Main Component ──────────────────────────────────────────── */

export default function CustodianWalletDetail() {
  const { walletNo } = useParams<{ walletNo: string }>();
  const navigate = useNavigate();

  const [wallet, setWallet] = useState<WalletDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const fetchWallet = async () => {
    if (!walletNo) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/wallets/${walletNo}`);
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to fetch wallet details.'));
      setWallet(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchWallet(); }, [walletNo]);

  const handleCopy = (text: string, field: string) => {
    copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  /* ── Loading / Error states ── */

  if (loading && !wallet) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center gap-4">
        <div className="animate-spin rounded-full h-6 w-6 border-2 border-adm-amber border-t-transparent" />
        <p className="mt-1 font-mono text-[11px] text-adm-t3">Loading wallet…</p>
        <button onClick={() => navigate('/admin/custody/wallets')} className={adminButtonClass('detailUtility')}>
          ← Back to Custodian Wallets
        </button>
      </div>
    );
  }

  if (!wallet) {
    return (
      <div className="space-y-4 rounded border border-adm-red/30 bg-adm-red/10 p-8 text-center">
        <div className="font-mono text-[11px] text-adm-red">{error || 'Wallet not found'}</div>
        <button onClick={() => navigate(-1)} className={adminButtonClass('detailUtility')}>
          Back
        </button>
      </div>
    );
  }

  /* ── Derived state ── */

  const isChain = wallet.networkInfo?.kind === 'CHAIN';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <DetailPageHeader
        backLabel="Custodian Wallets"
        onBack={() => navigate('/admin/custody/wallets')}
        onRefresh={() => void fetchWallet()}
        refreshing={loading}
      />

      {/* ── Notices ── */}
      {error && (
        <div className="shrink-0 px-6 pt-3 pb-1">
          <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      )}

      {/* ── Body: two-column layout ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ① Identity */}
          <section className="bg-adm-card px-6 py-5">
            <p className="font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {wallet.walletNo}
            </p>
            <div className="mt-3 flex items-center gap-4 flex-wrap">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Status</div>
                <div className="mt-1"><AdminBadge value={wallet.status} /></div>
              </div>
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Role</div>
                <div className="mt-1"><WalletRoleBadge role={wallet.walletRole} /></div>
              </div>
            </div>
          </section>

          {/* ② Identity */}
          <section className="px-6 py-5">
            <Cap>Identity</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <div className="min-w-0">
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Owner No</div>
                <div className="mt-1 text-[13px]">
                  {wallet.ownerType === 'CUSTOMER' && wallet.ownerNo ? (
                    <button
                      onClick={() => navigate(`/admin/customers/${wallet.ownerNo}`)}
                      className="text-adm-amber hover:underline font-mono text-[11px]"
                      title="Open customer"
                    >
                      {wallet.ownerNo}
                    </button>
                  ) : (
                    <span className="font-mono text-[11px] text-adm-t2">{wallet.ownerNo ?? '—'}</span>
                  )}
                </div>
              </div>
              <InfoField label="Owner Name" value={wallet.ownerName ?? '—'} />
              <InfoField label="Vault" value={wallet.vaultCode} />
              <InfoField label="Network" value={wallet.network} />
              <InfoField label="Custodian" value={wallet.networkInfo?.custodian} />
              <InfoField label="Custodian Ref" value={wallet.custodianRef} mono />
            </div>
          </section>

          {/* ③ Balance — 余额不在钱包表上,账本才是唯一真相 */}
          <section className="px-6 py-5">
            <Cap>Balance</Cap>
            <div className="mt-3 space-y-3">
              <p className="text-[12px] text-adm-t2">
                Balances are not kept on wallet rows — the ledger is the single source of truth.
              </p>
              <button
                onClick={() => navigate(`/admin/ledger/accounts?ownerNo=${wallet.ownerNo ?? ''}`)}
                className={adminButtonClass('detailUtility')}
              >
                Open ledger accounts
              </button>
            </div>
          </section>

          {/* ④ Address / Bank */}
          <section className="px-6 py-5">
            <Cap>{isChain ? 'Crypto Address' : 'Bank Account'}</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              {isChain ? (
                <>
                  <InfoField
                    label="Address"
                    value={wallet.address}
                    mono
                    copyable
                    copied={copiedField === 'address'}
                    onCopy={(v) => handleCopy(v, 'address')}
                  />
                  {wallet.networkInfo?.explorerUrl && (
                    <InfoField
                      label="Explorer"
                      value={wallet.networkInfo.explorerUrl}
                      link={wallet.networkInfo.explorerUrl}
                      mono
                    />
                  )}
                </>
              ) : (
                <>
                  <InfoField label="Bank Name" value={wallet.networkInfo?.bankName} />
                  <InfoField label="Account Holder" value={wallet.networkInfo?.accountName} />
                  <InfoField label="IBAN" value={wallet.iban} mono />
                </>
              )}
            </div>
          </section>

          {/* ⑤ Audit */}
          <section className="px-6 py-5">
            <Cap>Audit</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Created" value={fmt(wallet.createdAt)} mono />
              <InfoField label="Updated" value={fmt(wallet.updatedAt)} mono />
            </div>
          </section>

        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {/* Quick Reference */}
          <SidebarGroup title="Quick Reference">
            <SidebarKV label="Wallet No" value={wallet.walletNo} mono />
            <SidebarKV label="Status" value={<AdminBadge value={wallet.status} />} />
            <SidebarKV label="Vault" value={wallet.vaultCode} mono />
            <SidebarKV label="Role" value={wallet.walletRole} mono />
            <SidebarKV label="Network" value={wallet.network} mono />
            <SidebarKV label="Owner No" value={wallet.ownerNo} mono />
            <SidebarKV label="Owner Name" value={wallet.ownerName} />
          </SidebarGroup>

          {/* Lifecycle */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Created" value={fmt(wallet.createdAt)} mono />
            <SidebarKV label="Updated" value={fmt(wallet.updatedAt)} mono />
          </SidebarGroup>

        </div>
      </div>
    </div>
  );
}
