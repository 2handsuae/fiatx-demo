import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Wallet,
  User,
  Banknote,
  Clock,
  Activity,
  MapPin,
  Copy,
  Check,
} from 'lucide-react';
import { copyToClipboard } from '../utils/clipboard';
import { formatAssetAmount } from '../utils/number-format';

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

  useEffect(() => {
    const fetchWallet = async () => {
      try {
        const token = localStorage.getItem('admin_token');
        if (!token) {
          navigate('/admin/login');
          return;
        }

        const response = await fetch(
          `${import.meta.env.VITE_API_URL}/wallets/${id}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        if (response.ok) {
          const data = await response.json();
          setWallet(data);
        } else {
          setError('Failed to fetch wallet details');
        }
      } catch {
        setError('Network error');
      } finally {
        setLoading(false);
      }
    };

    if (id) fetchWallet();
  }, [id, navigate]);

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
          className="text-brand-primary hover:underline font-medium"
        >
          Go Back
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
      CUSTOMER_POOL: '客户资金池',
      PLATFORM_POOL: '公司资金池',
      CUSTOMER_DEPOSIT: '客户充值载体',
      CUSTOMER_PAYOUT_TARGET: '客户提现目标',
      LIQUIDITY_PROVIDER_ACCOUNT: '流动性对手账户',
      OTHER: '其他钱包',
    }[wallet.surfaceCategory || 'OTHER'] || '其他钱包';

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-admin-border shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-gray-100 rounded-lg border border-admin-border transition-colors"
          >
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                Wallet Details
              </h1>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                  wallet.status === 'ACTIVE'
                    ? 'bg-green-100 text-green-700'
                    : wallet.status === 'DISABLED'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-yellow-100 text-yellow-700'
                }`}
              >
                {wallet.status}
              </span>
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 font-mono">
              <span className="text-brand-primary font-bold">
                No: {wallet.walletNo || 'N/A'}
              </span>
              <span>ID: {wallet.id}</span>
              <span className="flex items-center gap-1">
                <Clock size={14} /> Created: {formatDate(wallet.createdAt)}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <QuickTag
            label="Asset"
            value={`${wallet.asset.code}/${wallet.asset.network || 'NA'}`}
          />
          <QuickTag label="Role" value={wallet.walletRole || 'GENERAL'} />
          <QuickTag label="Surface" value={surfaceLabel} />
          <QuickTag label="Type" value={wallet.type} />
          <QuickTag label="Owner" value={wallet.ownerType} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DetailCard title="Summary" icon={<Wallet size={18} />}>
          <InfoField label="Wallet No" value={wallet.walletNo} highlight />
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
          <InfoField label="Owner ID" value={wallet.ownerId} />
          <InfoField label="Owner No" value={wallet.ownerNo} />
          <InfoField label="Direction" value={wallet.direction} />
          <InfoField
            label="Asset"
            value={`${wallet.asset.code} (${wallet.asset.type})`}
          />
          <InfoField label="Network" value={wallet.asset.network || 'NA'} />
          <InfoField label="Asset ID" value={wallet.assetId} />
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
              <CopyableCodeField
                label="Address"
                value={wallet.address}
                copiedField={copiedField}
                copyKey="address"
                onCopy={handleCopy}
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
          <InfoField label="Wallet ID" value={wallet.id} />
        </DetailCard>
      </div>
    </div>
  );
};

const QuickTag = ({ label, value }: { label: string; value: string }) => (
  <div className="px-3 py-2 bg-gray-50 border border-admin-border rounded-lg text-center min-w-[120px]">
    <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">
      {label}
    </div>
    <div className="text-sm font-bold text-gray-700 mt-1">{value}</div>
  </div>
);

const DetailCard = ({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
    <div className="px-6 py-4 border-b border-admin-border flex items-center gap-3 bg-gray-50/50">
      <div className="p-1.5 bg-white rounded-md text-gray-500 border border-admin-border shadow-sm">
        {icon}
      </div>
      <h3 className="text-sm font-bold text-gray-900 uppercase tracking-tight">
        {title}
      </h3>
    </div>
    <div className="p-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
        {children}
      </div>
    </div>
  </div>
);

const InfoField = ({
  label,
  value,
  highlight = false,
  icon,
}: {
  label: string;
  value: string | null | undefined;
  highlight?: boolean;
  icon?: React.ReactNode;
}) => (
  <div>
    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">
      {label}
    </label>
    <div
      className={`text-sm break-all flex items-center gap-1.5 ${
        highlight ? 'font-semibold text-brand-primary' : 'text-gray-800'
      }`}
    >
      {icon}
      {value || 'N/A'}
    </div>
  </div>
);

const CopyableCodeField = ({
  label,
  value,
  copiedField,
  copyKey,
  onCopy,
}: {
  label: string;
  value: string | null;
  copiedField: string | null;
  copyKey: string;
  onCopy: (text: string, field: string) => void;
}) => (
  <div className="col-span-full">
    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">
      {label}
    </label>
    <div className="flex items-center gap-2 bg-gray-50 p-2 rounded border border-gray-100">
      <code className="text-sm font-mono text-gray-900 break-all flex-1">
        {value || 'N/A'}
      </code>
      {value ? (
        <button
          onClick={() => onCopy(value, copyKey)}
          className="text-gray-400 hover:text-brand-primary p-1"
        >
          {copiedField === copyKey ? (
            <Check size={14} className="text-green-500" />
          ) : (
            <Copy size={14} />
          )}
        </button>
      ) : null}
    </div>
  </div>
);

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  const pad = (num: number) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

export default WalletDetail;
