import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
  Globe,
  FileText,
  Banknote,
  MapPin,
  Clock,
  Activity,
  User,
  CircleDashed,
  ShieldAlert,
  CheckCircle2,
  Waves,
  Landmark,
} from 'lucide-react';
import { copyToClipboard } from '../utils/clipboard';
import { formatAssetAmount } from '../utils/number-format';
import { SimulationRail, type SimulationRailItem } from '../components/SimulationRail';
import { useSimulationMode } from '../utils/simulationMode';

interface PayinDetail {
  id: string;
  payinNo: string;
  
  // Owner Info
  ownerType: string;
  ownerId: string | null;
  ownerNo: string | null;
  customer?: {
    customerNo: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  };

  // Transaction Links
  transactionType: string; // DEPOSIT
  transactionId: string | null;
  transactionNo: string | null;
  depositId: string | null;

  type: string; // CRYPTO / FIAT
  status: string;
  
  // Asset & Amount
  assetId: string;
  asset: { code: string; type: string; network: string | null; decimals: number; description: string | null };
  amount: string;
  
  // Destination
  toWalletId: string | null;
  toWalletNo: string | null;
  toWallet: { 
      id: string;
      ownerType: string; 
      ownerId: string | null; 
      address: string | null; 
      accountName: string | null;
      type: string;
      bankName: string | null;
      bankAccount: string | null;
      iban: string | null;
  } | null;
  toAddress: string | null;
  toIban: string | null;

  // Source / Path
  fromWalletId: string | null;
  fromWalletNo: string | null;
  fromAddress: string | null;
  fromIban: string | null;
  txHash: string | null;
  confirmations: number;
  referenceNo: string | null;
  providerTxnId: string | null;
  
  // Timestamps
  receivedAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
  
  // Audit
  statusHistory: string | null;
  simulationProfile?: {
    signalId: string;
    signalNo: string;
    riskLevel: string;
    riskReason: string | null;
  } | null;
}

const PayinDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [payin, setPayin] = useState<PayinDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [railSubmitting, setRailSubmitting] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const { enabled: simulationModeEnabled } = useSimulationMode();

  useEffect(() => {
    const fetchPayin = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('admin_token');
        const response = await fetch(`${import.meta.env.VITE_API_URL}/treasury/payins/${id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
          const data = await response.json();
          setPayin(data);
        } else {
          if (response.status === 401) {
             localStorage.removeItem('admin_token');
             navigate('/admin/login');
          } else {
             alert('Failed to load payin details');
             navigate('/dashboard/treasury/payins');
          }
        }
      } catch (error) {
        console.error('Failed to fetch payin', error);
      } finally {
        setLoading(false);
      }
    };

    if (id) fetchPayin();
  }, [id, navigate]);

  const handleCopy = (text: string, field: string) => {
    copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleMockEvent = async (event: string) => {
    setRailSubmitting(true);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/admin/treasury/payins/${id}/mock-event`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ event })
      });
      
      if (response.ok) {
        const updated = await response.json();
        setPayin(prev => prev ? { ...prev, ...updated, customer: prev.customer || updated.customer } : updated);
      } else {
        const err = await response.json();
        alert(`Action failed: ${err.message}`);
      }
    } catch (error) {
      console.error('Action failed', error);
    } finally {
      setRailSubmitting(false);
    }
  };

  const renderStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      DETECTED: 'bg-blue-100 text-blue-800',
      CONFIRMING: 'bg-yellow-100 text-yellow-800',
      CONFIRMED: 'bg-indigo-100 text-indigo-800',
      CLEARED: 'bg-green-100 text-green-800',
      FAILED: 'bg-red-100 text-red-800',
    };
    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
        {status}
      </span>
    );
  };

  const getPayinRailItems = (detail: PayinDetail): SimulationRailItem[] => {
    const status = String(detail.status || '').toUpperCase();
    const type = String(detail.type || '').toLowerCase();

    if (type === 'fiat') {
      return [
        {
          id: 'detected',
          label: 'Detected',
          icon: <CircleDashed size={14} />,
          state:
            status === 'DETECTED'
              ? 'current'
              : ['CONFIRMED', 'CLEARED', 'FAILED'].includes(status)
                ? 'completed'
                : 'readonly',
          helperText: '监听到法币入账候选',
        },
        {
          id: 'confirmed',
          label: 'Fiat Confirmed',
          icon: <Landmark size={14} />,
          state:
            status === 'CONFIRMED'
              ? 'current'
              : status === 'CLEARED'
                ? 'completed'
                : status === 'DETECTED'
                  ? 'available'
                  : 'readonly',
          onClick: status === 'DETECTED' ? () => handleMockEvent('FIAT_CONFIRMED') : undefined,
          disabled: railSubmitting,
          helperText: '确认到账后进入 CONFIRMED',
        },
        {
          id: 'cleared',
          label: 'Cleared',
          icon: <CheckCircle2 size={14} />,
          state: status === 'CLEARED' ? 'current' : 'readonly',
          tone: 'success',
          helperText: 'confirmed 侧记账成功后自动出现',
        },
        {
          id: 'failed',
          label: 'Fail',
          icon: <ShieldAlert size={14} />,
          state: status === 'FAILED' ? 'current' : status === 'DETECTED' ? 'available' : 'readonly',
          tone: 'danger',
          onClick: status === 'DETECTED' ? () => handleMockEvent('FIAT_FAILED') : undefined,
          disabled: railSubmitting,
          helperText: '监听失败时进入 FAILED',
        },
      ];
    }

    return [
      {
        id: 'detected',
        label: 'Detected',
        icon: <CircleDashed size={14} />,
        state:
          status === 'DETECTED'
            ? 'current'
            : ['CONFIRMING', 'CONFIRMED', 'CLEARED', 'FAILED'].includes(status)
              ? 'completed'
              : 'readonly',
        helperText: '监听到链上候选入账',
      },
      {
        id: 'confirming',
        label: 'Mempool Seen',
        icon: <Waves size={14} />,
        state:
          status === 'CONFIRMING'
            ? 'current'
            : ['CONFIRMED', 'CLEARED', 'FAILED'].includes(status)
              ? 'completed'
              : status === 'DETECTED'
                ? 'available'
                : 'readonly',
        onClick: status === 'DETECTED' ? () => handleMockEvent('MEMPOOL_SEEN') : undefined,
        disabled: railSubmitting,
        helperText: '模拟看到 mempool 后推进到 CONFIRMING',
      },
      {
        id: 'confirmed',
        label: 'Chain Confirmed',
        icon: <CheckCircle2 size={14} />,
        state:
          status === 'CONFIRMED'
            ? 'current'
            : status === 'CLEARED'
              ? 'completed'
              : status === 'CONFIRMING'
                ? 'available'
                : 'readonly',
        onClick:
          status === 'CONFIRMING' ? () => handleMockEvent('CHAIN_CONFIRMED') : undefined,
        disabled: railSubmitting,
        helperText: '到达确认条件后进入 CONFIRMED',
      },
      {
        id: 'cleared',
        label: 'Cleared',
        icon: <CheckCircle2 size={14} />,
        state: status === 'CLEARED' ? 'current' : 'readonly',
        tone: 'success',
        helperText: '记账成功后自动出现，不提供模拟按钮',
      },
      {
        id: 'failed',
        label: 'Dropped',
        icon: <ShieldAlert size={14} />,
        state: status === 'FAILED' ? 'current' : status === 'CONFIRMING' ? 'available' : 'readonly',
        tone: 'danger',
        onClick: status === 'CONFIRMING' ? () => handleMockEvent('DROPPED') : undefined,
        disabled: railSubmitting,
        helperText: '当前模型中的掉链分支',
      },
    ];
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <RefreshCw className="animate-spin mb-4 text-brand-primary" size={32} />
        <p className="text-gray-500">Loading payin details...</p>
      </div>
    );
  }

  if (!payin) return null;

  const payinRailItems = getPayinRailItems(payin);
  const showAccountingBlockedHint = payin.status === 'CONFIRMED';

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Header Panel */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-admin-border shadow-sm">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/dashboard/treasury/payins')}
            className="p-2 hover:bg-gray-100 rounded-lg border border-admin-border transition-colors text-gray-600"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Payin Details</h1>
              {renderStatusBadge(payin.status)}
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 font-mono">
              <span className="text-brand-primary font-bold">No: {payin.payinNo || '-'}</span>
              <span>ID: {payin.id}</span>
              <span className="flex items-center gap-1"><Clock size={14}/> Created: {formatDate(payin.createdAt)}</span>
            </div>
          </div>
        </div>
      </div>

      {simulationModeEnabled ? (
        <SimulationRail
          title="Payin Simulation Rail"
          description="Payin 属于监听/系统派生节点，这里用 icon rail 模拟链上或银行监听事件。CLEARED 只做结果回显。"
          items={payinRailItems}
        />
      ) : null}

      {showAccountingBlockedHint ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Payin 目前停在 `CONFIRMED`。这通常表示 confirmed-side accounting 仍未把它自动清到 `CLEARED`。
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        {payin.simulationProfile ? (
          <DetailCard title="Inbound Signal Profile" icon={<ShieldAlert size={18} />}>
            <InfoField label="Signal No" value={payin.simulationProfile.signalNo} source="main" />
            <InfoField label="Signal Risk Level" value={payin.simulationProfile.riskLevel} highlight source="main" />
            <InfoField label="Signal Risk Reason" value={payin.simulationProfile.riskReason || 'LOW has no reason'} source="main" />
            <InfoField label="Signal ID" value={payin.simulationProfile.signalId} source="main" />
            <InfoField
              label="Interpretation"
              value="Compatibility signal only. Final TX_DEPOSIT_FINAL outcome is decided in Risk Policy Executions."
              source="main"
            />
          </DetailCard>
        ) : null}

        {/* 1. 基础识别 (Basic Identification) */}
        <DetailCard title="Basic Identification" icon={<FileText size={18}/>}>
            <InfoField label="ID" value={payin.id} highlight source="main" />
            <InfoField label="Payin No" value={payin.payinNo} highlight source="main" />
            
            <InfoField label="Owner Type" value={payin.ownerType} source="main" />
            <InfoField label="Owner ID" value={payin.ownerId} icon={<User size={14}/>} source="main" />
            <InfoField label="Owner No" value={payin.ownerNo} source="main" />
            {payin.customer && (
                <InfoField 
                    label="Customer Info" 
                    value={`${payin.customer.firstName || ''} ${payin.customer.lastName || ''} (${payin.customer.email})`} 
                    source="main" 
                />
            )}

            <InfoField label="Transaction Type" value={payin.transactionType} source="main" />
            <InfoField label="Transaction ID" value={payin.transactionId} source="main" />
            <InfoField label="Transaction No" value={payin.transactionNo} source="main" />
            <InfoField label="Type" value={payin.type} source="main" />
        </DetailCard>

        {/* 2. 资产与金额 (Assets & Amount) */}
        <DetailCard title="Assets & Amount" icon={<Banknote size={18}/>}>
            <InfoField label="Asset ID (Symbol)" value={payin.asset.code} source="main" />
            <InfoField label="Asset Name" value={payin.asset.description || payin.asset.code} source="main" />
            <InfoField label="Amount" value={formatAssetAmount(payin.amount, payin.asset.decimals)} highlight source="main" />
            <InfoField label="Decimals" value={payin.asset.decimals.toString()} source="main" />
        </DetailCard>

        {/* 3. 目的地信息 (Destination Info) */}
        <DetailCard title="Destination Info" icon={<MapPin size={18}/>}>
            <InfoField label="To Wallet ID" value={payin.toWalletId} source="main" />
            <InfoField label="To Wallet No" value={payin.toWalletNo} source="main" />
            <InfoField label="To Address" value={payin.toAddress || 'N/A'} copyable onCopy={(v) => handleCopy(v, 'toAddress')} isCopied={copiedField === 'toAddress'} source="main" />
            <InfoField label="To IBAN" value={payin.toIban || 'N/A'} copyable onCopy={(v) => handleCopy(v, 'toIban')} isCopied={copiedField === 'toIban'} source="main" />
        </DetailCard>

        {/* 4. 始发地信息 (Source Info) */}
        <DetailCard title="Source Info" icon={<Activity size={18}/>}>
            <InfoField label="From Wallet ID" value={payin.fromWalletId} source="main" />
            <InfoField label="From Wallet No" value={payin.fromWalletNo} source="main" />
            <InfoField label="From Address" value={payin.fromAddress || 'N/A'} copyable onCopy={(v) => handleCopy(v, 'fromAddress')} isCopied={copiedField === 'fromAddress'} source="main" />
            <InfoField label="From IBAN" value={payin.fromIban || 'N/A'} copyable onCopy={(v) => handleCopy(v, 'fromIban')} isCopied={copiedField === 'fromIban'} source="main" />
        </DetailCard>

        {/* 5. 外部交易号 (External Transaction Info) */}
        <DetailCard title="External Transaction Info" icon={<Globe size={18}/>}>
            <InfoField 
                label="Tx Hash" 
                value={payin.txHash || 'N/A'} 
                copyable 
                onCopy={(v) => handleCopy(v, 'txHash')} 
                isCopied={copiedField === 'txHash'}
                link={payin.txHash && payin.asset.network !== 'fiat' ? `https://etherscan.io/tx/${payin.txHash}` : undefined}
                source="main" 
            />
            <InfoField label="Confirmations" value={payin.confirmations.toString()} source="main" />
            <InfoField label="Reference No" value={payin.referenceNo || 'N/A'} copyable onCopy={(v) => handleCopy(v, 'refNo')} isCopied={copiedField === 'refNo'} source="main" />
        </DetailCard>

        {/* 6. 状态与时效 (Status & Timings) */}
        <DetailCard title="Status & Timings" icon={<Clock size={18}/>}>
            <InfoField label="Current Status" value={payin.status} highlight source="main" />
            <InfoField label="Created At" value={formatDate(payin.createdAt)} source="main" />
            <InfoField label="Updated At" value={formatDate(payin.updatedAt)} source="main" />
            <InfoField label="Received At" value={formatDate(payin.receivedAt)} source="main" />
            <InfoField label="Confirmed At" value={formatDate(payin.confirmedAt)} source="main" />
        </DetailCard>

        {/* 6. 审计与历史 (Audit & History) */}
        <DetailCard title="Status History & Audit" icon={<Activity size={18}/>} columns={1}>
             <StatusTimeline historyJson={payin.statusHistory} />
        </DetailCard>
      </div>
    </div>
  );
};

// --- Reused Components ---

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
  source = 'main',
  copyable = false,
  isCopied = false,
  onCopy,
  link
}: { 
  label: string, 
  value: string | null | undefined, 
  highlight?: boolean, 
  icon?: React.ReactNode,
  source?: 'main' | 'kyc' | 'edd',
  copyable?: boolean,
  isCopied?: boolean,
  onCopy?: (val: string) => void,
  link?: string
}) => {
    const placeholder = source === 'kyc' ? 'KYC no data' : source === 'edd' ? 'EDD no data' : 'N/A';
    const displayValue = value || placeholder;
    
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
            <div className={`text-sm font-medium break-all flex items-center gap-2 ${highlight ? 'text-brand-primary' : 'text-gray-900'}`}>
                {icon && <span className="text-gray-400">{icon}</span>}
                {link ? (
                    <a href={link} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline flex items-center gap-1">
                        {displayValue} <ExternalLink size={12}/>
                    </a>
                ) : (
                    <span>{displayValue}</span>
                )}
                {copyable && value && (
                    <button 
                        onClick={() => onCopy && onCopy(value)}
                        className="text-gray-400 hover:text-brand-primary p-1 transition-colors"
                        title="Copy to clipboard"
                    >
                        {isCopied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                    </button>
                )}
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

// --- Timeline Component ---
const StatusTimeline = ({ historyJson }: { historyJson: string | null }) => {
    if (!historyJson) return <div className="text-gray-400 text-sm italic p-4 text-center">No history available</div>;

    let history: any[] = [];
    try {
        history = JSON.parse(historyJson);
        // Ensure sorted by date descending (newest first)
        history.sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime());
    } catch (e) {
        return <div className="text-red-400 text-sm p-4">Error parsing history data</div>;
    }

    if (history.length === 0) return <div className="text-gray-400 text-sm italic p-4 text-center">No history events</div>;

    return (
        <div className="relative border-l-2 border-gray-100 ml-4 space-y-8 my-2">
            {history.map((item, idx) => (
                <div key={idx} className="ml-8 relative">
                    {/* Dot on the line */}
                    <span className="absolute flex items-center justify-center w-6 h-6 bg-white rounded-full -left-[44px] top-0 ring-4 ring-white">
                        <div className={`w-3 h-3 rounded-full ${getStatusColor(item.status)} shadow-sm`}></div>
                    </span>
                    
                    {/* Content Card */}
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start bg-gray-50/50 p-4 rounded-lg border border-gray-100 hover:bg-white hover:shadow-sm transition-all duration-200">
                        <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded text-xs font-bold border ${getStatusBadgeStyle(item.status)}`}>
                                    {item.status}
                                </span>
                            </div>
                            <p className="text-sm text-gray-600 leading-relaxed">{item.reason || 'No reason provided'}</p>
                            
                            <div className="flex items-center gap-2 text-xs text-gray-400 pt-1">
                                <User size={12} />
                                <span className="font-mono">{item.operatorId || 'SYSTEM'}</span>
                            </div>
                        </div>
                        
                        <div className="mt-3 sm:mt-0 sm:ml-4 text-right shrink-0">
                            <time className="block text-xs font-mono text-gray-500 bg-white px-2 py-1 rounded border border-gray-100">
                                {new Date(item.changedAt).toLocaleString()}
                            </time>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

const getStatusColor = (status: string) => {
    switch (status) {
        case 'CLEARED': return 'bg-green-500';
        case 'FAILED': return 'bg-red-500';
        case 'CONFIRMED': return 'bg-indigo-500';
        case 'CONFIRMING': return 'bg-yellow-500';
        case 'DETECTED': return 'bg-blue-500';
        default: return 'bg-gray-300';
    }
};

const getStatusBadgeStyle = (status: string) => {
    switch (status) {
        case 'CLEARED': return 'bg-green-50 text-green-700 border-green-200';
        case 'FAILED': return 'bg-red-50 text-red-700 border-red-200';
        case 'CONFIRMED': return 'bg-indigo-50 text-indigo-700 border-indigo-200';
        case 'CONFIRMING': return 'bg-yellow-50 text-yellow-700 border-yellow-200';
        case 'DETECTED': return 'bg-blue-50 text-blue-700 border-blue-200';
        default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
};

export default PayinDetail;
