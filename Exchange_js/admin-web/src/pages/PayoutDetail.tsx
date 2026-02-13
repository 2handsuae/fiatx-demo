import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, RefreshCw, Copy, Check, ExternalLink, 
  FileText, User, CreditCard, Activity, Clock, Server, Shield, Scale, MapPin, ArrowUpRight
} from 'lucide-react';
import { copyToClipboard } from '../utils/clipboard';

interface PayoutDetail {
  id: string;
  payoutNo: string;
  withdrawId: string;
  type: string;
  status: string;
  amount: string;
  assetId: string;
  asset: { code: string; type: string; network: string | null };
  toWalletId: string | null;
  toAddress: string | null;
  toIban: string | null;
  fromAddress: string | null;
  fromIban: string | null;
  txHash: string | null;
  confirmations: number;
  referenceNo: string | null;
  providerTxnId: string | null;
  createdAt: string;
  sentAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  statusHistory: string | null;
  withdraw: {
    withdrawNo: string;
    ownerId: string;
  };
  customer?: {
    firstName: string | null;
    lastName: string | null;
    customerNo: string;
  };
  clearings?: Array<{
    id: string;
    status: string; // Using clearingStatus field from schema which is usually mapped to status in API
    clearingStatus?: string;
    createdAt: string;
    lines: Array<{
        id: string;
        partyType: string;
        partyId: string;
        amount: string;
        lineType: string;
        description: string | null;
    }>
  }>;
  auditLogs: Array<{
    id: string;
    operatorId: string;
    oldStatus: string;
    newStatus: string;
    reason: string | null;
    createdAt: string;
  }>;
}

const PayoutDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<PayoutDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const fetchPayout = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/payouts/${id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const result = await response.json();
        setData(result);
      } else {
        alert('Failed to fetch payout details');
        navigate('/dashboard/treasury/payouts');
      }
    } catch (error) {
      console.error('Failed to fetch payout', error);
      alert('Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayout();
  }, [id]);

  const handleUpdateAction = async (action: string) => {
    setUpdating(true);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/payouts/${id}/status`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action })
      });

      if (response.ok) {
        fetchPayout();
      } else {
        const err = await response.json();
        alert(`Update failed: ${err.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Update failed', error);
      alert('Update failed due to network error');
    } finally {
      setUpdating(false);
    }
  };

  const handleCopy = (text: string, field: string) => {
    copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const getPayoutActions = (payout: PayoutDetail) => {
    const { status, type } = payout;
    const actions: { action: string; label: string; color: string }[] = [];

    if (type === 'CRYPTO') {
      switch (status) {
        case 'CREATED':
          actions.push({ action: 'SIGN', label: 'Sign', color: 'bg-blue-600 hover:bg-blue-700 text-white' });
          break;
        case 'SIGNING':
          actions.push({ action: 'BROADCAST', label: 'Broadcast', color: 'bg-indigo-600 hover:bg-indigo-700 text-white' });
          actions.push({ action: 'SIGN_FAIL', label: 'Sign Fail', color: 'bg-red-600 hover:bg-red-700 text-white' });
          break;
        case 'BROADCASTED':
          actions.push({ action: 'SEEN_IN_MEMPOOL', label: 'Seen in Mempool', color: 'bg-blue-600 hover:bg-blue-700 text-white' });
          actions.push({ action: 'DROP', label: 'Drop', color: 'bg-orange-600 hover:bg-orange-700 text-white' });
          actions.push({ action: 'TIMEOUT', label: 'Timeout', color: 'bg-gray-600 hover:bg-gray-700 text-white' });
          break;
        case 'CONFIRMING':
          actions.push({ action: 'CONFIRM', label: 'Confirm', color: 'bg-green-600 hover:bg-green-700 text-white' });
          actions.push({ action: 'FAIL', label: 'Fail', color: 'bg-red-600 hover:bg-red-700 text-white' });
          actions.push({ action: 'TIMEOUT', label: 'Timeout', color: 'bg-gray-600 hover:bg-gray-700 text-white' });
          break;
        case 'CONFIRMED':
          actions.push({ action: 'CLEAR', label: 'Clear', color: 'bg-emerald-600 hover:bg-emerald-700 text-white' });
          break;
      }
    } else if (type === 'FIAT') {
      switch (status) {
        case 'CREATED':
          actions.push({ action: 'SUBMIT', label: 'Submit', color: 'bg-blue-600 hover:bg-blue-700 text-white' });
          break;
        case 'CONFIRMING':
          actions.push({ action: 'CONFIRM', label: 'Confirm', color: 'bg-green-600 hover:bg-green-700 text-white' });
          actions.push({ action: 'FAIL', label: 'Fail', color: 'bg-red-600 hover:bg-red-700 text-white' });
          actions.push({ action: 'TIMEOUT', label: 'Timeout', color: 'bg-gray-600 hover:bg-gray-700 text-white' });
          break;
        case 'CONFIRMED':
          actions.push({ action: 'CLEAR', label: 'Clear', color: 'bg-emerald-600 hover:bg-emerald-700 text-white' });
          actions.push({ action: 'RETURN', label: 'Return', color: 'bg-orange-600 hover:bg-orange-700 text-white' });
          break;
        case 'CLEAR':
          actions.push({ action: 'RETURN', label: 'Return', color: 'bg-orange-600 hover:bg-orange-700 text-white' });
          break;
      }
    }
    return actions;
  };

  const renderStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      CREATED: 'bg-gray-100 text-gray-800',
      SIGNING: 'bg-indigo-100 text-indigo-800',
      BROADCASTED: 'bg-blue-100 text-blue-800',
      CONFIRMING: 'bg-yellow-100 text-yellow-800',
      CONFIRMED: 'bg-green-100 text-green-800',
      CLEAR: 'bg-emerald-100 text-emerald-800',
      FAILED: 'bg-red-100 text-red-800',
      TIMEOUT: 'bg-orange-100 text-orange-800',
      RETURNED: 'bg-purple-100 text-purple-800',
    };
    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
        {status}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <RefreshCw className="animate-spin text-brand-primary mb-4" size={32} />
        <p className="text-gray-500">Loading payout details...</p>
      </div>
    );
  }

  if (!data) return null;

  const ownerName = data.customer ? `${data.customer.firstName || ''} ${data.customer.lastName || ''}`.trim() || data.customer.customerNo : 'N/A';
  const ownerNo = data.customer?.customerNo || 'N/A';

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-admin-border shadow-sm">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/dashboard/treasury/payouts')}
            className="p-2 hover:bg-gray-100 rounded-lg border border-admin-border transition-colors text-gray-600"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Payout Details</h1>
              {renderStatusBadge(data.status)}
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 font-mono">
              <span className="text-brand-primary font-bold">No: {data.payoutNo || data.id}</span>
              <span className="flex items-center gap-1"><Clock size={14}/> Created: {new Date(data.createdAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 items-center">
           {getPayoutActions(data).map((item) => (
            <button 
              key={item.action}
              onClick={() => handleUpdateAction(item.action)}
              disabled={updating}
              className={`px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition-colors disabled:opacity-50 ${item.color}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {/* 1. Basic Identification */}
        <DetailCard title="Basic Identification" icon={<FileText size={18} />}>
            <InfoField label="Payout ID" value={data.id} source="main" />
            <InfoField label="Payout No" value={data.payoutNo} highlight source="main" />
            <InfoField label="Withdraw No" value={data.withdraw.withdrawNo} 
                       link={`/exchange/withdraw-transactions/${data.withdrawId}`} 
                       source="main" />
            <InfoField label="Owner ID" value={data.withdraw.ownerId} icon={<User size={14}/>} source="main" />
            <InfoField label="Owner Name" value={ownerName} source="main" />
            <InfoField label="Owner No" value={ownerNo} source="main" />
            <InfoField label="Type" value={data.type} source="main" />
        </DetailCard>

        {/* 2. Assets & Amount */}
        <DetailCard title="Assets & Amount" icon={<CreditCard size={18} />}>
            <InfoField label="Asset ID" value={data.assetId} source="main" />
            <InfoField label="Asset Code" value={data.asset.code} highlight source="main" />
            <InfoField label="Asset Network" value={data.asset.network} source="main" />
            <InfoField label="Amount" value={`${Number(data.amount).toLocaleString()}`} highlight source="main" />
        </DetailCard>

        {/* 3. Destination Info */}
        <DetailCard title="Destination Info" icon={<MapPin size={18} />}>
            <InfoField label="To Wallet ID" value={data.toWalletId} source="main" />
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

        {/* 6. Status & Timings */}
        <DetailCard title="Status & Timings" icon={<Clock size={18} />}>
             <InfoField label="Current Status" value={data.status} highlight source="main" />
             <InfoField label="Created At" value={new Date(data.createdAt).toLocaleString()} source="main" />
             <InfoField label="Sent At" value={data.sentAt ? new Date(data.sentAt).toLocaleString() : 'N/A'} source="main" />
             <InfoField label="Completed At" value={data.completedAt ? new Date(data.completedAt).toLocaleString() : 'N/A'} source="main" />
             <InfoField label="Updated At" value={new Date(data.updatedAt).toLocaleString()} source="main" />
        </DetailCard>

        {/* 7. Clearing & Settlement Info - HIDDEN */}
        {/* Clearing section removed as per requirement */}

        {/* 8. Audit & History */}
        <DetailCard title="Status History & Audit" icon={<Activity size={18} />} columns={1}>
             {data.statusHistory ? (
                <StatusTimeline historyJson={data.statusHistory} />
             ) : (
                <div className="space-y-4">
                     {data.auditLogs.map((log) => (
                         <div key={log.id} className="flex gap-4 p-4 bg-gray-50 rounded-lg text-sm">
                            <div className="flex-1">
                                <span className="font-bold text-gray-900">{log.newStatus}</span>
                                <span className="text-gray-500 mx-2">from</span>
                                <span className="font-mono text-gray-600">{log.oldStatus}</span>
                                <p className="text-gray-600 mt-1">{log.reason}</p>
                            </div>
                            <div className="text-right text-gray-500 text-xs">
                                <div>{new Date(log.createdAt).toLocaleString()}</div>
                                <div className="mt-1 font-mono">By: {log.operatorId}</div>
                            </div>
                         </div>
                     ))}
                </div>
             )}
        </DetailCard>
      </div>
    </div>
  );
};

// --- Reusable Components ---

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
                    <a href={link} target={link.startsWith('/') ? undefined : "_blank"} rel={link.startsWith('/') ? undefined : "noopener noreferrer"} className="text-blue-600 hover:underline flex items-center gap-1" onClick={(e) => {
                        if (link.startsWith('/')) {
                            // Let the parent component's router handle internal links if possible, or use standard anchor
                        }
                    }}>
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

const StatusTimeline = ({ historyJson }: { historyJson: string | null }) => {
    if (!historyJson) return <div className="text-gray-400 text-sm italic p-4 text-center">No history available</div>;

    let history: any[] = [];
    try {
        history = JSON.parse(historyJson);
        history.sort((a, b) => new Date(b.timestamp || b.changedAt).getTime() - new Date(a.timestamp || a.changedAt).getTime());
    } catch (e) {
        return <div className="text-red-400 text-sm p-4">Error parsing history data</div>;
    }

    if (history.length === 0) return <div className="text-gray-400 text-sm italic p-4 text-center">No history events</div>;

    return (
        <div className="relative border-l-2 border-gray-100 ml-4 space-y-8 my-2">
            {history.map((item, idx) => (
                <div key={idx} className="ml-8 relative">
                    <span className="absolute flex items-center justify-center w-6 h-6 bg-white rounded-full -left-[44px] top-0 ring-4 ring-white">
                        <div className={`w-3 h-3 rounded-full ${getStatusColor(item.status)} shadow-sm`}></div>
                    </span>
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
    if (['CONFIRMED', 'CLEAR', 'SUCCESS'].includes(status)) return 'bg-green-500';
    if (['FAILED', 'TIMEOUT', 'RETURNED'].includes(status)) return 'bg-red-500';
    if (['CREATED', 'PENDING'].includes(status)) return 'bg-gray-300';
    if (['SIGNING', 'BROADCASTED', 'CONFIRMING'].includes(status)) return 'bg-blue-500';
    return 'bg-yellow-500';
};

const getStatusBadgeStyle = (status: string) => {
    if (['CONFIRMED', 'CLEAR', 'SUCCESS'].includes(status)) return 'bg-green-50 text-green-700 border-green-200';
    if (['FAILED', 'TIMEOUT', 'RETURNED'].includes(status)) return 'bg-red-50 text-red-700 border-red-200';
    if (['CREATED', 'PENDING'].includes(status)) return 'bg-gray-50 text-gray-700 border-gray-200';
    if (['SIGNING', 'BROADCASTED', 'CONFIRMING'].includes(status)) return 'bg-blue-50 text-blue-700 border-blue-200';
    return 'bg-yellow-50 text-yellow-700 border-yellow-200';
};

export default PayoutDetail;