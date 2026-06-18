import { useEffect, useState, type ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Repeat, RotateCcw } from 'lucide-react';
import { copyToClipboard } from '../utils/clipboard';
import { formatAssetAmount } from '../utils/number-format';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
import { AdminBadge } from '../components/ui/AdminBadge';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { WalletRoleBadge, WALLET_ROLE_LABEL } from '../utils/walletRole.util';

/* ── Interfaces ──────────────────────────────────────────────── */

interface WalletDetailData {
  id: string;
  walletNo: string;
  walletRole: string;
  ownerType: string;
  ownerId: string | null;
  ownerNo: string | null;
  ownerName?: string | null;
  type: string;
  assetId: string;
  balance: string;

  address: string | null;

  bankName: string | null;
  accountName: string | null;
  iban: string | null;

  vaultId: string | null;

  status: string;
  regulatoryGateSummary?: {
    gateId: string;
    gateNo: string;
    gateType: string;
    gateResult: string;
  } | null;

  createdAt: string;
  updatedAt: string;

  asset: {
    currency: string;
    code: string;
    type: string;
    network: string | null;
    decimals?: number;
  };
}

interface CollectionActionResult {
  action?: string;
  reason?: string;
  internalTransactionId?: string;
  internalFundId?: string;
  existingPendingAmount?: string;
  expectedCollectionAmount?: string;
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
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();

  const [wallet, setWallet] = useState<WalletDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [collectionSubmitting, setCollectionSubmitting] = useState(false);
  const [collectionResult, setCollectionResult] = useState<CollectionActionResult | null>(null);

  const fetchWallet = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/wallets/${id}`);
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to fetch wallet details.'));
      setWallet(await res.json());
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchWallet(); }, [id]);

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

  const isCrypto = wallet.type === 'CRYPTO_ADDRESS';
  const isFiat = wallet.type === 'FIAT_BANK';
  const isDepositWallet = wallet.walletRole === 'C_DEP';
  const canCreateCollection = hasAnyPermission([PERMISSIONS.INTERNAL_COLLECTIONS_RECONCILE]);
  const canRetry = hasAnyPermission([PERMISSIONS.CUSTODIAN_WALLET_RETRY]);

  /* ── Status toggle ── */

  const handleStatusChange = async (newStatus: string) => {
    if (!window.confirm(`${newStatus === 'DISABLED' ? 'Disable' : 'Enable'} wallet ${wallet.walletNo}?`)) return;
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/wallets/${wallet.id}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        },
      );
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to update wallet status.'));
        return;
      }
      setNotice(`Wallet ${newStatus === 'ACTIVE' ? 'enabled' : 'disabled'} successfully.`);
      void fetchWallet();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to update wallet status.');
    }
  };

  /* ── Collection action ── */

  const handleCreateCollection = async () => {
    setCollectionSubmitting(true);
    setCollectionResult(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/internal-transactions/collection-wallets/${wallet.id}/reconcile`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dryRun: false }),
        },
      );
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to create wallet-driven collection.'));
        return;
      }
      const payload = (await res.json()) as CollectionActionResult;
      setCollectionResult(payload);
      if (payload.internalTransactionId && (payload.action === 'CREATED' || payload.action === 'IDEMPOTENT')) {
        navigate('/admin/funds/transfers');
        return;
      }
      setNotice(payload.reason || payload.action || 'Collection request completed.');
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to create collection.');
    } finally {
      setCollectionSubmitting(false);
    }
  };

  const handleRetryCreation = async () => {
    if (!wallet.walletNo || !window.confirm(`Retry vault creation for wallet ${wallet.walletNo}?`)) return;
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/custodian-wallets/${wallet.walletNo}/retry`,
        { method: 'POST' },
      );
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Retry failed.'));
        return;
      }
      setNotice('Vault creation retried successfully.');
      void fetchWallet();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Retry failed.');
    }
  };

  /* ── Sidebar action visibility ── */

  const canToggleStatus = wallet.status !== 'FROZEN';
  const isFailed = wallet.status === 'FAILED';
  const showActions = canToggleStatus || isFailed || (isDepositWallet && canCreateCollection);

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
      {(notice || error) && (
        <div className="shrink-0 px-6 pt-3 pb-1 space-y-2">
          {notice && (
            <div className="rounded border border-adm-green/30 bg-adm-green/10 px-4 py-2 font-mono text-[11px] text-adm-green">
              {notice}
            </div>
          )}
          {error && (
            <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
              {error}
            </div>
          )}
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

          {/* ② Details */}
          <section className="px-6 py-5">
            <Cap>Details</Cap>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoField label="Owner Type" value={wallet.ownerType} />
              <div className="min-w-0">
                <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">Owner No</div>
                <div className="mt-1 text-[13px]">
                  {wallet.ownerType === 'CUSTOMER' && wallet.ownerNo && wallet.ownerId ? (
                    <button
                      onClick={() => navigate(`/admin/customers/${wallet.ownerId}`)}
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
              <InfoField label="Asset" value={wallet.asset.code} />
              <InfoField label="Network" value={wallet.asset.network || '—'} />
              <InfoField
                label="Custodian"
                value={wallet.type === 'FIAT_BANK' ? 'ZandBank' : 'HexTrust'}
              />
            </div>
          </section>

          {/* ③ Balance */}
          <section className="px-6 py-5">
            <Cap>Balance (mock)</Cap>
            <div className="mt-3">
              <InfoField
                label="Balance (mock)"
                value={`${formatAssetAmount(wallet.balance ?? '0', wallet.asset.decimals)} ${wallet.asset.currency}`}
                highlight
              />
            </div>
          </section>

          {/* ④ Address / Bank (conditional) */}
          {(isCrypto || isFiat) && (
            <section className="px-6 py-5">
              <Cap>{isCrypto ? 'Crypto Address' : 'Bank Account'}</Cap>
              <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
                {isCrypto ? (
                  <>
                    <InfoField
                      label="Address"
                      value={wallet.address}
                      mono
                      copyable
                      copied={copiedField === 'address'}
                      onCopy={(v) => handleCopy(v, 'address')}
                    />
                    <InfoField label="Vault ID" value={wallet.vaultId} mono />
                  </>
                ) : (
                  <>
                    <InfoField label="Bank Name" value={wallet.bankName} />
                    <InfoField label="Account Holder" value={wallet.accountName} />
                    <InfoField label="IBAN" value={wallet.iban} />
                  </>
                )}
              </div>
            </section>
          )}

          {/* ⑤ Deposit Collection (conditional: C_DEP only) */}
          {isDepositWallet && (
            <section className="px-6 py-5">
              <Cap>Deposit Collection</Cap>
              <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4">
                <InfoField
                  label="Collection Amount"
                  value={`${formatAssetAmount(wallet.balance ?? '0', wallet.asset.decimals)} ${wallet.asset.currency}`}
                  highlight
                />
                <InfoField
                  label="Execution Rule"
                  value="Create full-balance DEPOSIT_COLLECTION when triggered"
                />
              </div>
              {collectionResult && (
                <div className="mt-3 rounded border border-adm-amber/30 bg-adm-amber/10 px-4 py-3 font-mono text-[11px] text-adm-amber">
                  <div className="font-semibold">Collection result: {collectionResult.action || 'UNKNOWN'}</div>
                  <div className="mt-1">{collectionResult.reason || 'Collection request completed.'}</div>
                  {collectionResult.expectedCollectionAmount && (
                    <div className="mt-1 text-[10px]">
                      Expected: {collectionResult.expectedCollectionAmount} {wallet.asset.currency}
                    </div>
                  )}
                  {collectionResult.internalTransactionId && (
                    <div className="mt-1 text-[10px]">
                      Transaction: {collectionResult.internalTransactionId}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ⑥ Audit */}
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

          {/* Actions */}
          {showActions && (
            <div className="border-b border-adm-border py-4">
              <Cap>Actions</Cap>
              <div className="mt-2.5 flex flex-col gap-2">
                {isFailed && canRetry && (
                  <button
                    onClick={() => void handleRetryCreation()}
                    className={adminButtonClass('workflowPrimary')}
                  >
                    <RotateCcw size={13} />
                    Retry Creation
                  </button>
                )}
                {canToggleStatus && wallet.status === 'ACTIVE' && (
                  <button
                    onClick={() => void handleStatusChange('DISABLED')}
                    className={adminButtonClass('workflowNegative')}
                  >
                    Disable Wallet
                  </button>
                )}
                {canToggleStatus && wallet.status === 'DISABLED' && (
                  <button
                    onClick={() => void handleStatusChange('ACTIVE')}
                    className={adminButtonClass('workflowPrimary')}
                  >
                    Enable Wallet
                  </button>
                )}
                {isDepositWallet && canCreateCollection && (
                  <button
                    onClick={() => void handleCreateCollection()}
                    disabled={collectionSubmitting}
                    className={adminButtonClass('workflowPrimary')}
                  >
                    <Repeat size={13} />
                    {collectionSubmitting ? 'Creating…' : 'Create Collection'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Quick Reference */}
          <SidebarGroup title="Quick Reference">
            <SidebarKV label="Wallet No" value={wallet.walletNo} mono />
            <SidebarKV label="Status" value={<AdminBadge value={wallet.status} />} />
            <SidebarKV label="Role" value={wallet.walletRole} mono />
            <SidebarKV label="Role Name" value={WALLET_ROLE_LABEL[wallet.walletRole] || wallet.walletRole} />
            <SidebarKV label="Asset" value={wallet.asset.code} />
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
