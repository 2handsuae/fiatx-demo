import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, RefreshCw, Copy, Check, ExternalLink, 
  FileText, User, CreditCard, Activity, Clock, ShieldCheck, Scale, History, Coins, ArrowRight
} from 'lucide-react';
import { copyToClipboard } from '../utils/clipboard';

interface SwapTransactionDetail {
  id: string;
  swapNo: string;
  ownerType: string;
  ownerId: string;
  ownerNo: string | null;
  status: string;
  
  // Sell (From)
  fromAssetId: string;
  fromAssetCode: string | null;
  fromAmount: string;
  fromAsset: {
    code: string;
    type: string;
    network: string | null;
    decimals: number;
  };

  // Buy (To)
  toAssetId: string;
  toAssetCode: string | null;
  toAmount: string;
  toAsset: {
    code: string;
    type: string;
    network: string | null;
    decimals: number;
  };

  exchangeRate: string;

  // Timings
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;

  // Relations
  customer?: {
    firstName: string | null;
    lastName: string | null;
    customerNo: string;
  };

  // Audit
  statusHistory: string | null;
  auditLogs?: Array<{
    id: string;
    oldStatus: string;
    newStatus: string;
    reason: string | null;
    createdAt: string;
    operatorId: string;
  }>;
}

const SwapTransactionDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<SwapTransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('admin_token');
        const response = await fetch(`${import.meta.env.VITE_API_URL}/admin/swap-transactions/${id}`, {
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
             navigate('/exchange/swap-transactions');
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

  const handleAction = async (action: string, reason?: string) => {
    setIsSubmitting(true);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/admin/swap-transactions/${id}/status`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action, reason })
      });
      
      if (response.ok) {
        const result = await response.json();
        setData(prev => prev ? { ...prev, ...result } : result);
        setIsRejectModalOpen(false);
        setRejectReason('');
      } else {
        const err = await response.json();
        alert(`Action failed: ${err.message}`);
      }
    } catch (error) {
      console.error('Action failed', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getAvailableActions = (status: string) => {
    const actions = [];
    switch (status) {
      case 'PENDING_COMPLIANCE':
        actions.push({ action: 'success', label: 'Approve Transaction', color: 'bg-green-600 hover:bg-green-700' });
        actions.push({ action: 'reject', label: 'Reject Transaction', color: 'bg-red-600 hover:bg-red-700' });
        actions.push({ action: 'flag', label: 'Flag for Review', color: 'bg-yellow-600 hover:bg-yellow-700' });
        break;
      case 'UNDER_REVIEW':
        actions.push({ action: 'success', label: 'Approve Transaction', color: 'bg-green-600 hover:bg-green-700' });
        actions.push({ action: 'reject', label: 'Reject Transaction', color: 'bg-red-600 hover:bg-red-700' });
        break;
    }
    return actions;
  };

  const renderStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      PENDING_COMPLIANCE: 'bg-blue-100 text-blue-800',
      UNDER_REVIEW: 'bg-yellow-100 text-yellow-800',
      SUCCESS: 'bg-green-100 text-green-800',
      REJECTED: 'bg-red-100 text-red-800',
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
        <RefreshCw className="animate-spin mb-4 text-brand-primary" size={32} />
        <p className="text-gray-500">Loading details...</p>
      </div>
    );
  }

  if (!data) return null;

  const ownerNo = data.ownerNo || (data.customer?.customerNo) || 'N/A';

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-admin-border shadow-sm">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/exchange/swap-transactions')}
            className="p-2 hover:bg-gray-100 rounded-lg border border-admin-border transition-colors text-gray-600"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">Swap Details</h1>
              {renderStatusBadge(data.status)}
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 font-mono">
              <span className="text-brand-primary font-bold">No: {data.swapNo}</span>
              <span>ID: {data.id}</span>
              <span className="flex items-center gap-1"><Clock size={14}/> Created: {new Date(data.createdAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 items-center">
            {getAvailableActions(data.status).map(act => (
                <button
                    key={act.action}
                    onClick={() => act.action === 'reject' ? setIsRejectModalOpen(true) : handleAction(act.action)}
                    disabled={isSubmitting}
                    className={`px-4 py-2 rounded-lg text-white text-sm font-medium shadow-sm transition-colors ${act.color} ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    {act.label}
                </button>
            ))}
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {/* 1. Basic Identification */}
        <DetailCard title="Basic Identification" icon={<FileText size={18} />}>
            <InfoField label="ID" value={data.id} source="main" />
            <InfoField label="Swap No" value={data.swapNo} highlight source="main" />
            <InfoField label="Owner Type" value={data.ownerType} source="main" />
            <InfoField label="Owner ID" value={data.ownerId} icon={<User size={14}/>} source="main" />
            <InfoField label="Owner No" value={ownerNo} source="main" />
            {data.customer && (
                <InfoField 
                    label="Customer Name" 
                    value={`${data.customer.firstName || ''} ${data.customer.lastName || ''}`} 
                    source="main" 
                />
            )}
        </DetailCard>

        {/* 2. Assets & Amount */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <DetailCard title="Sell Asset (From)" icon={<ArrowRight size={18} className="rotate-45 text-red-500" />} columns={1}>
                <InfoField label="Asset Code" value={data.fromAssetCode || data.fromAsset.code} highlight source="main" />
                <InfoField label="Asset Type" value={data.fromAsset.type} source="main" />
                <InfoField label="Amount" value={`${Number(data.fromAmount).toLocaleString()} ${data.fromAsset.code}`} highlight source="main" />
                <InfoField label="Asset ID" value={data.fromAssetId} source="main" />
            </DetailCard>

            <DetailCard title="Buy Asset (To)" icon={<ArrowRight size={18} className="-rotate-45 text-green-500" />} columns={1}>
                <InfoField label="Asset Code" value={data.toAssetCode || data.toAsset.code} highlight source="main" />
                <InfoField label="Asset Type" value={data.toAsset.type} source="main" />
                <InfoField label="Amount" value={`${Number(data.toAmount).toLocaleString()} ${data.toAsset.code}`} highlight source="main" />
                <InfoField label="Asset ID" value={data.toAssetId} source="main" />
            </DetailCard>
        </div>

        {/* 3. Pricing */}
        <DetailCard title="Price & Rate" icon={<Coins size={18} />}>
            <InfoField label="Exchange Rate" value={Number(data.exchangeRate).toFixed(8)} highlight source="main" />
            <InfoField label="Pair" value={`${data.fromAsset.code} -> ${data.toAsset.code}`} source="main" />
        </DetailCard>

        {/* 4. Status & Timings */}
        <DetailCard title="Status & Timings" icon={<Clock size={18} />}>
            <InfoField label="Current Status" value={data.status} highlight source="main" />
            <InfoField label="Created At" value={new Date(data.createdAt).toLocaleString()} source="main" />
            <InfoField label="Updated At" value={new Date(data.updatedAt).toLocaleString()} source="main" />
            <InfoField label="Completed At" value={data.completedAt ? new Date(data.completedAt).toLocaleString() : 'N/A'} source="main" />
        </DetailCard>

        {/* 5. Audit & History */}
        <DetailCard title="Status History & Audit" icon={<Activity size={18} />} columns={1}>
             <StatusTimeline historyJson={data.statusHistory} />
        </DetailCard>
      </div>

      {/* Reject Modal */}
      {isRejectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
            <h3 className="text-lg font-bold text-gray-900 mb-2">Reject Transaction</h3>
            <p className="text-sm text-gray-500 mb-4">
              Please provide a reason for rejecting this transaction. This will be recorded in the audit logs.
            </p>
            <textarea
              className="w-full border border-gray-200 rounded-lg p-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all mb-4"
              rows={4}
              placeholder="Enter rejection reason..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setIsRejectModalOpen(false);
                  setRejectReason('');
                }}
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleAction('reject', rejectReason)}
                disabled={isSubmitting || !rejectReason.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isSubmitting && <RefreshCw size={14} className="animate-spin" />}
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}
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
        default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
};

export default SwapTransactionDetail;