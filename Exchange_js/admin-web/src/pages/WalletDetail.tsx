import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Wallet, User, Banknote, Clock, Activity, MapPin, Copy, Check } from 'lucide-react';
import { copyToClipboard } from '../utils/clipboard';

interface WalletDetailData {
  id: string;
  walletNo: string;
  ownerType: string;
  ownerId: string | null;
  ownerNo: string | null;
  type: string;
  direction: string;
  assetId: string;
  assetCode: string;
  
  // Balance fields
  balance: string;
  lockedBalance: string;
  
  // Crypto specific
  address: string | null;
  memo: string | null;
  beneficiaryName: string | null;
  counterpartyVasp: string | null;
  
  // Fiat specific
  bankName: string | null;
  bankAccount: string | null;
  bankCode: string | null;
  accountName: string | null;
  iban: string | null;
  
  status: string;
  
  createdAt: string;
  updatedAt: string;

  // Relations
  asset: {
    code: string;
    type: string;
    network: string | null;
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

        const response = await fetch(`${import.meta.env.VITE_API_URL}/wallets/${id}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          setWallet(data);
        } else {
          setError('Failed to fetch wallet details');
        }
      } catch (err) {
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
        <button onClick={() => navigate(-1)} className="text-brand-primary hover:underline font-medium">
          Go Back
        </button>
      </div>
    );
  }

  const isCrypto = wallet.type === 'CRYPTO_ADDRESS';
  const isFiat = wallet.type === 'FIAT_BANK';

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Header Panel */}
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
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                wallet.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 
                wallet.status === 'DISABLED' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
              }`}>
                {wallet.status}
              </span>
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 font-mono">
              <span className="text-brand-primary font-bold">No: {wallet.walletNo || 'N/A'}</span>
              <span>ID: {wallet.id}</span>
              <span className="flex items-center gap-1"><Clock size={14}/> Created: {formatDate(wallet.createdAt)}</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="px-4 py-2 bg-gray-50 border border-admin-border rounded-lg text-center min-w-[100px]">
             <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Asset</div>
             <div className="text-sm font-bold text-brand-primary flex items-center justify-center gap-1">
                {wallet.asset.code}
                <span className="text-xs text-gray-500 font-normal">({wallet.asset.type})</span>
             </div>
          </div>
          <div className="px-4 py-2 bg-gray-50 border border-admin-border rounded-lg text-center min-w-[100px]">
             <div className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Type</div>
             <div className="text-sm font-bold text-gray-700">{wallet.type}</div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {/* 1. 基础识别 (Basic Identification) */}
        <DetailCard title="Basic Identification" icon={<Wallet size={18}/>}>
            <InfoField label="ID" value={wallet.id} highlight source="main" />
            <InfoField label="Wallet No" value={wallet.walletNo} highlight source="main" />
            <InfoField label="Owner Type" value={wallet.ownerType} source="main" />
            <InfoField label="Owner ID" value={wallet.ownerId} icon={<User size={14}/>} source="main" />
            <InfoField label="Owner No" value={wallet.ownerNo} source="main" />
            <InfoField label="Type" value={wallet.type} source="main" />
            <InfoField label="Direction" value={wallet.direction} source="main" />
        </DetailCard>

        {/* 2. 资产与余额 (Assets & Balance) */}
        <DetailCard title="Assets & Balance" icon={<Banknote size={18}/>}>
            <InfoField label="Asset Code" value={wallet.asset.code} source="main" />
            <InfoField label="Asset ID" value={wallet.assetId} source="main" />
            <InfoField label="Balance" value={`${wallet.balance} ${wallet.asset.code}`} highlight source="main" />
            <InfoField label="Locked Balance" value={`${wallet.lockedBalance} ${wallet.asset.code}`} source="main" />
        </DetailCard>

        {/* 3. 账户/地址详情 (Account/Address Details) */}
        <DetailCard title="Account/Address Details" icon={<MapPin size={18}/>}>
            {isCrypto ? (
              <>
                <div className="col-span-full">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1.5">Address</label>
                    <div className="flex items-center gap-2 bg-gray-50 p-2 rounded border border-gray-100">
                        <code className="text-sm font-mono text-gray-900 break-all flex-1">
                            {wallet.address || 'N/A'}
                        </code>
                        {wallet.address && (
                            <button 
                                onClick={() => handleCopy(wallet.address || '', 'address')}
                                className="text-gray-400 hover:text-brand-primary p-1"
                            >
                                {copiedField === 'address' ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                            </button>
                        )}
                    </div>
                </div>
                <InfoField label="Memo / Tag" value={wallet.memo} source="main" />
                <InfoField label="Beneficiary Name" value={wallet.beneficiaryName} source="main" />
                <InfoField label="Counterparty VASP" value={wallet.counterpartyVasp} source="main" />
              </>
            ) : isFiat ? (
              <>
                <InfoField label="Bank Name" value={wallet.bankName} source="main" />
                <InfoField label="Account Holder" value={wallet.accountName} source="main" />
                <InfoField label="Account Number" value={wallet.bankAccount} source="main" />
                <InfoField label="IBAN" value={wallet.iban} source="main" />
                <InfoField label="Bank Code (SWIFT/BIC)" value={wallet.bankCode} source="main" />
              </>
            ) : (
                <div className="col-span-full text-sm text-gray-400 italic">No specific details for this wallet type</div>
            )}
        </DetailCard>

        {/* 4. 状态与审计 (Status & Audit) */}
        <DetailCard title="Status & Audit" icon={<Activity size={18}/>}>
            <InfoField label="Status" value={wallet.status} highlight={wallet.status === 'ACTIVE'} source="main" />
            <InfoField label="Created At" value={formatDate(wallet.createdAt)} source="main" />
            <InfoField label="Updated At" value={formatDate(wallet.updatedAt)} source="main" />
        </DetailCard>
      </div>
    </div>
  );
};

const DetailCard = ({ title, icon, children, columns = 2 }: { title: string, icon: React.ReactNode, children: React.ReactNode, columns?: number }) => (
  <div className="bg-white rounded-xl shadow-sm border border-admin-border overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
     <div className="px-6 py-4 border-b border-admin-border flex items-center gap-3 bg-gray-50/50">
        <div className="p-1.5 bg-white rounded-md text-gray-500 border border-admin-border shadow-sm">
           {icon}
        </div>
        <h3 className="text-sm font-bold text-gray-900 uppercase tracking-tight">{title}</h3>
     </div>
     <div className="p-6">
        <div className={`grid grid-cols-1 ${columns === 2 ? 'sm:grid-cols-2' : ''} gap-x-8 gap-y-6`}>
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
  source = 'main' 
}: { 
  label: string, 
  value: string | null | undefined, 
  highlight?: boolean, 
  icon?: React.ReactNode,
  source?: 'main' | 'kyc' | 'edd'
}) => {
    const placeholder = source === 'kyc' ? 'KYC no data' : source === 'edd' ? 'EDD no data' : 'N/A';
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
            <div className={`text-sm font-medium break-all flex items-center gap-2 ${highlight ? 'text-brand-primary' : 'text-gray-900'}`}>
                {icon && <span className="text-gray-400">{icon}</span>}
                {value || placeholder}
            </div>
        </div>
    );
};

const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
};

export default WalletDetail;
