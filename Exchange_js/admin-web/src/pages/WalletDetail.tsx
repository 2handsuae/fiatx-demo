import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Link2,
  Plus,
  Repeat,
  Wallet,
  User,
  Banknote,
  Activity,
  MapPin,
} from 'lucide-react';
import { copyToClipboard } from '../utils/clipboard';
import { formatAssetAmount } from '../utils/number-format';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { DetailCard, DetailPageHeader, InfoField } from '../components/compliance/DetailPageComponents';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';

interface WalletDetailData {
  id: string;
  walletNo: string;
  walletRole?: string;
  surfaceCategory?: string;
  ownerType: string;
  ownerId: string | null;
  ownerNo: string | null;
  ownerName?: string | null;
  type: string;
  direction: string;
  assetId: string;

  availableBalance?: string;
  restrictedBalance?: string;
  totalBalance?: string;
  totalAedEquivalent?: string | null;
  balanceUpdatedAt?: string | null;

  address: string | null;
  memo: string | null;
  beneficiaryName: string | null;
  counterpartyVasp: string | null;

  bankName: string | null;
  bankAccount: string | null;
  bankCode: string | null;
  accountName: string | null;
  iban: string | null;

  status: string;
  regulatoryEnablementStatus?: string | null;
  regulatoryEnabledAt?: string | null;
  regulatoryGateSummary?: {
    gateId: string;
    gateNo: string;
    gateType: string;
    gateResult: string;
    filingStatus: string;
    receiptStatus: string;
    effectivenessStatus: string;
  } | null;

  createdAt: string;
  updatedAt: string;

  asset: {
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

const WalletDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();
  const [wallet, setWallet] = useState<WalletDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [collectionSubmitting, setCollectionSubmitting] = useState(false);
  const [collectionResult, setCollectionResult] = useState<CollectionActionResult | null>(null);

  const fetchWallet = async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError('');
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/wallets/${id}`);

      if (response.ok) {
        const data = await response.json();
        setWallet(data);
      } else {
        setError(await getApiErrorMessage(response, 'Failed to fetch wallet details.'));
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      setError(error instanceof Error ? error.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchWallet();
  }, [id]);

  const handleCopy = (text: string, field: string) => {
    copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary"></div>
      </div>
    );
  }

  if (error || !wallet) {
    return (
      <div className="p-8 text-center bg-white rounded-xl shadow-sm border border-admin-border">
        <div className="text-red-500 mb-4">{error || 'Wallet not found'}</div>
        <button
          onClick={() => navigate(-1)}
          className={adminButtonClass('detailUtility')}
        >
          Back
        </button>
      </div>
    );
  }

  const isCrypto = wallet.type === 'CRYPTO_ADDRESS';
  const isFiat = wallet.type === 'FIAT_BANK';
  const isCustBank = wallet.walletRole === 'CUST_BANK';
  const isDepositWallet = wallet.walletRole === 'DEPOSIT';
  const canReadGate = hasAnyPermission([PERMISSIONS.GOV_REGULATORY_GATE_DETAIL_READ]);
  const canCreateGate = hasAnyPermission([PERMISSIONS.GOV_REGULATORY_GATE_CREATE]);
  const canCreateCollection = hasAnyPermission([PERMISSIONS.INTERNAL_COLLECTIONS_RECONCILE]);
  const ownerLabel =
    wallet.ownerName || wallet.ownerNo || wallet.ownerId || '-';
  const surfaceLabel =
    {
      CUSTOMER_POOL: 'Customer Pool',
      PLATFORM_POOL: 'Platform Pool',
      CUSTOMER_DEPOSIT: 'Customer Deposit Surface',
      CUSTOMER_PAYOUT_TARGET: 'Customer Payout Target',
      LIQUIDITY_PROVIDER_ACCOUNT: 'Liquidity Provider Account',
      OTHER: 'Other Wallet',
    }[wallet.surfaceCategory || 'OTHER'] || 'Other Wallet';

  const handleCreateCollection = async () => {
    setCollectionSubmitting(true);
    setCollectionResult(null);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/internal-transactions/collection-wallets/${wallet.id}/reconcile`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ dryRun: false }),
        },
      );

      if (!response.ok) {
        const message = await getApiErrorMessage(
          response,
          'Failed to create wallet-driven collection.',
        );
        alert(message);
        return;
      }

      const payload = (await response.json()) as CollectionActionResult;
      setCollectionResult(payload);
      if (
        payload.internalTransactionId &&
        (payload.action === 'CREATED' || payload.action === 'IDEMPOTENT')
      ) {
        navigate(`/exchange/internal-transactions/${payload.internalTransactionId}`);
        return;
      }
      alert(payload.reason || payload.action || 'Collection request completed.');
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      alert(e instanceof Error ? e.message : 'Failed to create wallet-driven collection.');
    } finally {
      setCollectionSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <DetailPageHeader
        title="Wallet Detail"
        subtitle={`${wallet.walletNo || 'N/A'} · ${wallet.asset.code}/${wallet.asset.network || 'NA'}`}
        onBack={() => navigate(-1)}
        onRefresh={() => void fetchWallet()}
        refreshing={loading}
      >
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
            wallet.status === 'ACTIVE'
              ? 'bg-green-100 text-green-700'
              : wallet.status === 'DISABLED'
                ? 'bg-red-100 text-red-700'
                : 'bg-yellow-100 text-yellow-700'
          }`}
        >
          {wallet.status}
        </span>
      </DetailPageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DetailCard title="Summary" icon={<Wallet size={18} />}>
          <InfoField label="Wallet No" value={wallet.walletNo} highlight mono />
          <InfoField
            label="Wallet Role"
            value={wallet.walletRole || 'GENERAL'}
          />
          <InfoField label="Surface Category" value={surfaceLabel} />
          <InfoField
            label="Owner"
            value={ownerLabel}
            icon={<User size={14} />}
          />
          <InfoField label="Owner Type" value={wallet.ownerType} />
          <InfoField label="Owner ID" value={wallet.ownerId} mono />
          <InfoField label="Owner No" value={wallet.ownerNo} mono accent />
          <InfoField label="Direction" value={wallet.direction} />
          <InfoField
            label="Asset"
            value={`${wallet.asset.code} (${wallet.asset.type})`}
          />
          <InfoField label="Network" value={wallet.asset.network || 'NA'} />
          <InfoField label="Asset ID" value={wallet.assetId} mono />
        </DetailCard>

        <DetailCard title="Balance" icon={<Banknote size={18} />}>
          <InfoField
            label="Available Balance"
            value={`${formatAssetAmount(wallet.availableBalance ?? '0', wallet.asset.decimals)} ${wallet.asset.code}`}
            highlight
          />
          <InfoField
            label="Restricted Balance"
            value={`${formatAssetAmount(wallet.restrictedBalance ?? '0', wallet.asset.decimals)} ${wallet.asset.code}`}
          />
          <InfoField
            label="Total Balance"
            value={`${formatAssetAmount(wallet.totalBalance ?? '0', wallet.asset.decimals)} ${wallet.asset.code}`}
          />
          <InfoField
            label="Total AED Equivalent"
            value={
              wallet.totalAedEquivalent
                ? `${wallet.totalAedEquivalent} AED`
                : 'N/A'
            }
          />
          <InfoField
            label="Balance Updated At"
            value={
              wallet.balanceUpdatedAt
                ? formatDate(wallet.balanceUpdatedAt)
                : '-'
            }
          />
        </DetailCard>

        <DetailCard title="Address / Bank" icon={<MapPin size={18} />}>
          {isCrypto ? (
            <>
              <InfoField
                label="Address"
                value={wallet.address}
                mono
                copyable
                copied={copiedField === 'address'}
                onCopy={(value) => handleCopy(value, 'address')}
              />
              <InfoField label="Memo / Tag" value={wallet.memo} />
              <InfoField
                label="Beneficiary Name"
                value={wallet.beneficiaryName}
              />
              <InfoField
                label="Counterparty VASP"
                value={wallet.counterpartyVasp}
              />
            </>
          ) : isFiat ? (
            <>
              <InfoField label="Bank Name" value={wallet.bankName} />
              <InfoField label="Account Holder" value={wallet.accountName} />
              <InfoField label="Account Number" value={wallet.bankAccount} />
              <InfoField label="IBAN" value={wallet.iban} />
              <InfoField
                label="Bank Code (SWIFT/BIC)"
                value={wallet.bankCode}
              />
            </>
          ) : (
            <div className="col-span-full text-sm text-gray-400 italic">
              No specific details for this wallet type
            </div>
          )}
        </DetailCard>

        <DetailCard title="Audit / Metadata" icon={<Activity size={18} />}>
          <InfoField
            label="Status"
            value={wallet.status}
            highlight={wallet.status === 'ACTIVE'}
          />
          <InfoField label="Created At" value={formatDate(wallet.createdAt)} />
          <InfoField label="Updated At" value={formatDate(wallet.updatedAt)} />
          <InfoField
            label="Regulatory Enablement"
            value={wallet.regulatoryEnablementStatus || 'N/A'}
          />
          <InfoField
            label="Regulatory Enabled At"
            value={wallet.regulatoryEnabledAt ? formatDate(wallet.regulatoryEnabledAt) : 'N/A'}
          />
          <InfoField label="Wallet ID" value={wallet.id} mono />
        </DetailCard>

        {isDepositWallet ? (
          <DetailCard title="Deposit Collection" icon={<Repeat size={18} />}>
            <InfoField
              label="Collection Amount"
              value={`${formatAssetAmount(wallet.availableBalance ?? '0', wallet.asset.decimals)} ${wallet.asset.code}`}
              highlight
            />
            <InfoField
              label="Execution Rule"
              value="Create full-balance DEPOSIT_COLLECTION when triggered from wallet detail"
            />
            {collectionResult ? (
              <div className="col-span-full rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <div className="font-semibold">
                  Collection result: {collectionResult.action || 'UNKNOWN'}
                </div>
                <div className="mt-1">
                  {collectionResult.reason || 'Collection request completed.'}
                </div>
                {collectionResult.expectedCollectionAmount ? (
                  <div className="mt-1 text-xs">
                    Expected amount: {collectionResult.expectedCollectionAmount} {wallet.asset.code}
                  </div>
                ) : null}
                {collectionResult.existingPendingAmount ? (
                  <div className="mt-1 text-xs">
                    Existing pending amount: {collectionResult.existingPendingAmount} {wallet.asset.code}
                  </div>
                ) : null}
                {collectionResult.internalTransactionId ? (
                  <button
                    type="button"
                    onClick={() =>
                      navigate(`/exchange/internal-transactions/${collectionResult.internalTransactionId}`)
                    }
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100"
                  >
                    <Link2 size={14} />
                    View Existing Collection
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="col-span-full">
              {canCreateCollection ? (
                <button
                  onClick={() => void handleCreateCollection()}
                  disabled={collectionSubmitting}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90 disabled:opacity-60"
                >
                  <Repeat size={16} />
                  {collectionSubmitting ? 'Creating...' : 'Create Collection'}
                </button>
              ) : (
                <div className="text-sm text-gray-500">
                  You do not have permission to trigger wallet-driven collection.
                </div>
              )}
            </div>
          </DetailCard>
        ) : null}

        {isCustBank ? (
          <DetailCard title="Regulatory Gate" icon={<Link2 size={18} />}>
            <InfoField
              label="Gate No"
              value={wallet.regulatoryGateSummary?.gateNo || 'N/A'}
            />
            <InfoField
              label="Gate Type"
              value={wallet.regulatoryGateSummary?.gateType || 'N/A'}
            />
            <InfoField
              label="Gate Result"
              value={wallet.regulatoryGateSummary?.gateResult || 'N/A'}
            />
            <div className="col-span-full flex flex-wrap gap-3">
              {wallet.regulatoryGateSummary && canReadGate ? (
                <button
                  onClick={() =>
                    navigate(
                      `/dashboard/governance/regulatory-gates/${wallet.regulatoryGateSummary?.gateId}`,
                    )
                  }
                  className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-brand-primary hover:bg-gray-50"
                >
                  <Link2 size={16} />
                  View Gate
                </button>
              ) : null}
              {!wallet.regulatoryGateSummary && canCreateGate ? (
                <button
                  onClick={() => {
                    const params = new URLSearchParams({
                      gateType: 'CLIENT_BANK_ACCOUNT_ENABLEMENT',
                      subjectType: 'WALLET',
                      subjectId: wallet.id,
                      subjectNo: wallet.walletNo,
                    });
                    navigate(`/dashboard/governance/regulatory-gates/create?${params.toString()}`);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-4 py-2 text-sm font-medium text-white hover:bg-brand-primary/90"
                >
                  <Plus size={16} />
                  Create Regulatory Gate
                </button>
              ) : null}
            </div>
          </DetailCard>
        ) : null}
      </div>
    </div>
  );
};

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

export default WalletDetail;
