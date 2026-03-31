import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
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

  createdAt: string;
  updatedAt: string;

  asset: {
    code: string;
    type: string;
    network: string | null;
    decimals?: number;
  };
}

const WalletDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [wallet, setWallet] = useState<WalletDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);

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
          <InfoField label="Wallet ID" value={wallet.id} mono />
        </DetailCard>
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
