import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, RefreshCw, Copy, Check, ExternalLink, 
  FileText, User, CreditCard, Activity, Clock, Server, Shield, Scale, MapPin
} from 'lucide-react';
import { copyToClipboard } from '../utils/clipboard';

interface WithdrawTransactionDetail {
  id: string;
  withdrawNo: string;
  payoutId: string | null;
  payoutNo: string | null;
  ownerType: string;
  ownerId: string;
  ownerNo: string | null;
  type: string;
  status: string;
  assetId: string;
  amount: string;
  netAmount: string;
  feeAmount: string;
  
  // Destination
  toWalletId: string | null;
  toWalletNo: string | null;
  toAddress: string | null;
  toIban: string | null;
  
  // Source
  fromWalletId: string | null;
  fromWalletNo: string | null;
  fromAddress: string | null;
  fromIban: string | null;
  
  // External
  providerTxnId: string | null;
  txHash: string | null;
  confirmations: number;
  referenceNo: string | null;
  
  // Compliance (Pre-KYT)
  preKytStatus: string;
  preKytId: string | null;
  preKytRiskScore: number | null;
  preKytCheckedAt: string | null;
  
  // Compliance (KYT)
  kytStatus: string;
  kytScreeningId: string | null;
  kytRiskScore: number | null;
  kytCheckedAt: string | null;
  
  // Regulation (Travel Rule)
  travelRuleRequired: boolean;
  counterpartyVasp: string | null;
  travelRuleStatus: string;
  travelRuleTransferId: string | null;
  travelRuleCheckedAt: string | null;
  
  // Compliance Overall
  complianceStatus: string;
  complianceReviewedAt: string | null;
  
  // Internal
  parentType: string | null;
  parentId: string | null;
  
  // Timings
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  payoutRequestedAt: string | null;
  completedAt: string | null;
  
  // Audit
  statusHistory: string | null;

  // Relations
  asset: {
    code: string;
    type: string;
    network: string | null;
    decimals: number;
  };
  customer?: {
    firstName: string | null;
    lastName: string | null;
    customerNo: string;
  };
  payout?: {
    payoutNo: string;
    status: string;
    clearings?: Array<{
        id: string;
        status: string;
        createdAt: string;
        lines: Array<{
            id: string;
            partyType: string;
            partyId: string;
            amount: string;
            lineType: string;
            description: string | null;
        }>
    }>
  };
  auditLogs?: Array<{
    id: string;
    oldStatus: string;
    newStatus: string;
    reason: string | null;
    createdAt: string;
    operatorId: string;
  }>;
}

const WithdrawTransactionDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<WithdrawTransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('admin_token');
        const response = await fetch(`${import.meta.env.VITE_API_URL}/withdraw-transactions/${id}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
          const result = await response.json();
          setData(result);
        } else {
           if (response.status === 401) {
             localStorage.removeItem('admin_token');
             navigate('/admin/login');
           } else {
             alert('Failed to load detail');
             navigate('/exchange/withdraw-transactions');
           }
        }
      } catch (error) {
        console.error('Failed to fetch detail', error);
      } finally {
        setLoading(false);
      }
    };

    if (id) fetchData();
  }, [id, navigate]);

  const handleCopy = (text: string, field: string) => {
    copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const renderStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      CREATED: 'bg-gray-100 text-gray-800',
      PENDING_COMPLIANCE: 'bg-blue-100 text-blue-800',
      UNDER_REVIEW: 'bg-yellow-100 text-yellow-800',
      APPROVED: 'bg-green-100 text-green-800',
      PAYOUT_PENDING: 'bg-indigo-100 text-indigo-800',
      SUCCESS: 'bg-emerald-100 text-emerald-800',
      FAILED: 'bg-red-100 text-red-800',
      REJECTED: 'bg-red-100 text-red-800',
      CANCELLED: 'bg-gray-400 text-white',
      RETURNED: 'bg-purple-100 text-purple-800',
    };
    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
        {status}
      </span>
    );
  };

  const handleAction = async (action: string) => {
    if (!data) return;
    if (!window.confirm(`Are you sure you want to perform action: ${action.toUpperCase()}?`)) return;

    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/withdraw-transactions/${id}/status`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action })
      });
      
      if (response.ok) {
        window.location.reload();
      } else {
        const err = await response.json();
        alert(`Action failed: ${err.message}`);
      }
    } catch (error) {
      console.error('Action failed', error);
    }
  };

  const getAvailableActions = (status: string) => {
    const actions = [];
    switch (status) {
      case 'CREATED':
        actions.push({ action: 'check', label: 'Submit to Compliance', style: 'bg-blue-600 hover:bg-blue-700 text-white' });
        actions.push({ action: 'cancel', label: 'Cancel', style: 'bg-gray-600 hover:bg-gray-700 text-white' });
        break;
      case 'PENDING_COMPLIANCE':
        actions.push({ action: 'flag', label: 'Flag for Review', style: 'bg-orange-600 hover:bg-orange-700 text-white' });
        actions.push({ action: 'reject', label: 'Reject', style: 'bg-red-600 hover:bg-red-700 text-white' });
        actions.push({ action: 'approve', label: 'Approve', style: 'bg-green-600 hover:bg-green-700 text-white' });
        actions.push({ action: 'cancel', label: 'Cancel', style: 'bg-gray-600 hover:bg-gray-700 text-white' });
        break;
      case 'UNDER_REVIEW':
        actions.push({ action: 'approve', label: 'Approve', style: 'bg-green-600 hover:bg-green-700 text-white' });
        actions.push({ action: 'reject', label: 'Reject', style: 'bg-red-600 hover:bg-red-700 text-white' });
        actions.push({ action: 'cancel', label: 'Cancel', style: 'bg-gray-600 hover:bg-gray-700 text-white' });
        break;
      case 'PAYOUT_PENDING':
        actions.push({ action: 'success', label: 'Mark Success', style: 'bg-green-600 hover:bg-green-700 text-white' });
        actions.push({ action: 'fail', label: 'Mark Fail', style: 'bg-red-600 hover:bg-red-700 text-white' });
        break;
      case 'SUCCESS':
        actions.push({ action: 'return', label: 'Return Funds', style: 'bg-orange-600 hover:bg-orange-700 text-white' });
        break;
    }
    return actions;
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <RefreshCw className="animate-spin mb-4 text-brand-primary" size={32} />
        <p className="text-gray-500">Loading details...</p>
      </div>
    );
  }

  if (!data) return null;

  const ownerNo = data.ownerNo || data.customer?.customerNo || 'N/A';
  const payoutNo = data.payoutNo || data.payout?.payoutNo || 'N/A';

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-admin-border shadow-sm">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/exchange/withdraw-transactions')}
            className="p-2 hover:bg-gray-100 rounded-lg border border-admin-border transition-colors text-gray-600"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Withdraw Details</h1>
              {renderStatusBadge(data.status)}
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 font-mono">
              <span className="text-brand-primary font-bold">No: {data.withdrawNo || '-'}</span>
              <span>ID: {data.id}</span>
              <span className="flex items-center gap-1"><Clock size={14}/> Created: {new Date(data.createdAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 items-center">
            {getAvailableActions(data.status).map(action => (
                <button
                    key={action.action}
                    onClick={() => handleAction(action.action)}
                    className={`px-4 py-2 rounded-lg text-white text-sm font-medium shadow-sm transition-colors ${action.style}`}
                >
                    {action.label}
                </button>
            ))}
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {/* 1. Basic Identification */}
        <DetailCard title="Basic Identification" icon={<FileText size={18} />}>
            <InfoField label="ID" value={data.id} source="main" />
            <InfoField label="Withdraw No" value={data.withdrawNo} highlight source="main" />
            <InfoField label="Payout ID" value={data.payoutId} source="main" />
            <InfoField label="Payout No" value={payoutNo} source="main" />
            <InfoField label="Owner Type" value={data.ownerType} source="main" />
            <InfoField label="Owner ID" value={data.ownerId} icon={<User size={14}/>} source="main" />
            <InfoField label="Owner No" value={ownerNo} source="main" />
            <InfoField label="Type" value={data.type} source="main" />
        </DetailCard>

        {/* 2. Assets & Amount */}
        <DetailCard title="Assets & Amount" icon={<CreditCard size={18} />}>
            <InfoField label="Asset ID" value={data.assetId} source="main" />
            <InfoField label="Asset Code" value={data.asset.code} highlight source="main" />
            <InfoField label="Asset Network" value={data.asset.network} source="main" />
            <InfoField label="Amount" value={`${Number(data.amount).toLocaleString()}`} highlight source="main" />
            <InfoField label="Fee Amount" value={`${Number(data.feeAmount).toLocaleString()}`} source="main" />
            <InfoField label="Net Amount" value={`${Number(data.netAmount).toLocaleString()}`} highlight source="main" />
        </DetailCard>

        {/* 3. Destination Info */}
        <DetailCard title="Destination Info" icon={<MapPin size={18} />}>
            <InfoField label="To Wallet ID" value={data.toWalletId} source="main" />
            <InfoField label="To Wallet No" value={data.toWalletNo} source="main" />
            <InfoField 
                label="To Address" 
                value={data.toAddress || 'N/A'} 
                copyable 
                onCopy={(v) => handleCopy(v, 'toAddress')} 
                isCopied={copiedField === 'toAddress'} 
                source="main" 
            />
            <InfoField 
                label="To IBAN" 
                value={data.toIban || 'N/A'} 
                copyable 
                onCopy={(v) => handleCopy(v, 'toIban')} 
                isCopied={copiedField === 'toIban'} 
                source="main" 
            />
        </DetailCard>

        {/* 4. Source Info */}
        <DetailCard title="Source Info" icon={<Server size={18} />}>
            <InfoField label="From Wallet ID" value={data.fromWalletId} source="main" />
            <InfoField label="From Wallet No" value={data.fromWalletNo} source="main" />
            <InfoField 
                label="From Address" 
                value={data.fromAddress || 'N/A'} 
                copyable 
                onCopy={(v) => handleCopy(v, 'fromAddress')} 
                isCopied={copiedField === 'fromAddress'} 
                source="main" 
            />
            <InfoField 
                label="From IBAN" 
                value={data.fromIban || 'N/A'} 
                copyable 
                onCopy={(v) => handleCopy(v, 'fromIban')} 
                isCopied={copiedField === 'fromIban'} 
                source="main" 
            />
        </DetailCard>

        {/* 5. External Transaction Info */}
        <DetailCard title="External Transaction Info" icon={<Activity size={18} />}>
            <InfoField 
                label="Tx Hash" 
                value={data.txHash || 'N/A'} 
                copyable 
                onCopy={(v) => handleCopy(v, 'txHash')} 
                isCopied={copiedField === 'txHash'}
                link={data.txHash ? `https://etherscan.io/tx/${data.txHash}` : undefined}
                source="main" 
            />
            <InfoField label="Confirmations" value={data.confirmations?.toString() || '0'} source="main" />
            <InfoField label="Reference No" value={data.referenceNo || 'N/A'} copyable onCopy={(v) => handleCopy(v, 'refNo')} isCopied={copiedField === 'refNo'} source="main" />
            <InfoField label="Provider Txn ID" value={data.providerTxnId} source="main" />
        </DetailCard>

        {/* 6. Compliance (Pre-KYT) */}
        <DetailCard title="Compliance (Pre-KYT)" icon={<Shield size={18} />}>
            <InfoField label="Pre-KYT Status" value={data.preKytStatus} highlight source="main" />
            <InfoField label="Pre-KYT ID" value={data.preKytId} source="main" />
            <InfoField label="Risk Score" value={data.preKytRiskScore?.toString()} source="main" />
            <InfoField label="Checked At" value={data.preKytCheckedAt ? new Date(data.preKytCheckedAt).toLocaleString() : 'N/A'} source="main" />
        </DetailCard>

        {/* 7. Compliance (KYT) */}
        <DetailCard title="Compliance (KYT)" icon={<Shield size={18} />}>
            <InfoField label="KYT Status" value={data.kytStatus} highlight source="main" />
            <InfoField label="Screening ID" value={data.kytScreeningId} source="main" />
            <InfoField label="Risk Score" value={data.kytRiskScore?.toString()} source="main" />
            <InfoField label="Checked At" value={data.kytCheckedAt ? new Date(data.kytCheckedAt).toLocaleString() : 'N/A'} source="main" />
        </DetailCard>

        {/* 8. Regulation (Travel Rule) */}
        <DetailCard title="Regulation (Travel Rule)" icon={<Scale size={18} />}>
            <InfoField label="Travel Rule Required" value={data.travelRuleRequired ? 'Yes' : 'No'} source="main" />
            <InfoField label="Status" value={data.travelRuleStatus} highlight source="main" />
            <InfoField label="Counterparty VASP" value={data.counterpartyVasp} source="main" />
            <InfoField label="Transfer ID" value={data.travelRuleTransferId} source="main" />
            <InfoField label="Checked At" value={data.travelRuleCheckedAt ? new Date(data.travelRuleCheckedAt).toLocaleString() : 'N/A'} source="main" />
        </DetailCard>

        {/* 9. Status & Timings */}
        <DetailCard title="Status & Timings" icon={<Clock size={18} />}>
             <InfoField label="Current Status" value={data.status} highlight source="main" />
             <InfoField label="Compliance Status" value={data.complianceStatus} source="main" />
             <InfoField label="Created At" value={new Date(data.createdAt).toLocaleString()} source="main" />
             <InfoField label="Approved At" value={data.approvedAt ? new Date(data.approvedAt).toLocaleString() : 'N/A'} source="main" />
             <InfoField label="Payout Requested At" value={data.payoutRequestedAt ? new Date(data.payoutRequestedAt).toLocaleString() : 'N/A'} source="main" />
             <InfoField label="Completed At" value={data.completedAt ? new Date(data.completedAt).toLocaleString() : 'N/A'} source="main" />
             <InfoField label="Updated At" value={new Date(data.updatedAt).toLocaleString()} source="main" />
        </DetailCard>

        {/* 10. Clearing & Settlement Info - HIDDEN */}
        {/* Clearing section removed as per requirement */}

        {/* 11. Audit & History */}
        <DetailCard title="Status History & Audit" icon={<Activity size={18} />} columns={1}>
             <StatusTimeline historyJson={data.statusHistory} />
        </DetailCard>
      </div>
    </div>
  );
};

// --- Reusable Components (Same as PayinDetail) ---

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

// --- Timeline Component ---
const StatusTimeline = ({ historyJson }: { historyJson: string | null }) => {
    if (!historyJson) return <div className="text-gray-400 text-sm italic p-4 text-center">No history available</div>;

    let history: any[] = [];
    try {
        history = JSON.parse(historyJson);
        // Ensure sorted by date descending (newest first)
        history.sort((a, b) => new Date(b.timestamp || b.changedAt).getTime() - new Date(a.timestamp || a.changedAt).getTime());
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
                            <p className="text-sm text-gray-600 leading-relaxed">{item.note || item.reason || 'No reason provided'}</p>
                            
                            <div className="flex items-center gap-2 text-xs text-gray-400 pt-1">
                                <User size={12} />
                                <span className="font-mono">{item.operator || item.operatorId || 'SYSTEM'}</span>
                            </div>
                        </div>
                        
                        <div className="mt-3 sm:mt-0 sm:ml-4 text-right shrink-0">
                            <time className="block text-xs font-mono text-gray-500 bg-white px-2 py-1 rounded border border-gray-100">
                                {new Date(item.timestamp || item.changedAt).toLocaleString()}
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
        case 'SUCCESS': return 'bg-green-500';
        case 'FAILED': 
        case 'REJECTED': return 'bg-red-500';
        case 'PENDING_COMPLIANCE': return 'bg-blue-500';
        case 'UNDER_REVIEW': return 'bg-yellow-500';
        case 'APPROVED': return 'bg-green-500';
        case 'PAYOUT_PENDING': return 'bg-indigo-500';
        default: return 'bg-gray-300';
    }
};

const getStatusBadgeStyle = (status: string) => {
    switch (status) {
        case 'SUCCESS': return 'bg-green-50 text-green-700 border-green-200';
        case 'FAILED': return 'bg-red-50 text-red-700 border-red-200';
        case 'REJECTED': return 'bg-red-50 text-red-700 border-red-200';
        case 'PENDING_COMPLIANCE': return 'bg-blue-50 text-blue-700 border-blue-200';
        case 'UNDER_REVIEW': return 'bg-yellow-50 text-yellow-700 border-yellow-200';
        case 'APPROVED': return 'bg-green-50 text-green-700 border-green-200';
        case 'PAYOUT_PENDING': return 'bg-indigo-50 text-indigo-700 border-indigo-200';
        default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
};

export default WithdrawTransactionDetail;