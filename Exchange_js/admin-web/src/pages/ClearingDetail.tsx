import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Hash, 
  FileText, 
  DollarSign,
  Layers,
  Activity,
  Calendar,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  Briefcase,
  Link as LinkIcon,
  ArrowRightLeft
} from 'lucide-react';

interface ClearingDetail {
  id: string;
  clearingNo: string;
  clearingType: string;
  description: string | null;
  
  sourceType: string;
  sourceId: string;
  sourceNo?: string | null;
  
  outAssetId: string;
  outAssetNo?: string | null;
  outAmount: string;
  inAssetId: string;
  inAssetNo?: string | null;
  inAmount: string;
  
  feeAssetId: string | null;
  feeAssetNo?: string | null;
  feeAmount: string | null;
  feeMethod: string;
  
  outPayoutId: string | null;
  outPayoutNo?: string | null;
  inPayinId: string | null;
  inPayinNo?: string | null;
  
  clearingStatus: string;
  createdAt: string;
  updatedAt: string;
}

const ClearingDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ClearingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/clearings/${id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const result = await response.json();
        setData(result);
      } else {
        const err = await response.json();
        setError(err.message || 'Failed to fetch clearing details');
      }
    } catch (err) {
      setError('Network error occurred while fetching data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) fetchDetail();
  }, [id]);

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

  const formatAmount = (val: string | null) => {
    if (!val) return '0.00';
    return Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 });
  };

  const renderStatusBadge = (status: string) => {
    const colorMap: Record<string, string> = {
      OPEN: 'bg-blue-100 text-blue-800',
      SETTLED: 'bg-green-100 text-green-800',
      FAILED: 'bg-red-100 text-red-800',
      CANCELLED: 'bg-gray-100 text-gray-800',
    };
    const className = colorMap[status] || 'bg-gray-100 text-gray-800';
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${className}`}>
        {status}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <RefreshCw className="animate-spin text-brand-primary mb-4" size={48} />
        <p className="text-gray-500">Loading clearing details...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center max-w-2xl mx-auto mt-12">
        <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-red-800 mb-2">Data Retrieval Failed</h2>
        <p className="text-red-600 mb-6">{error || 'Clearing record not found or has been deleted'}</p>
        <button 
          onClick={() => navigate('/clearing/management')}
          className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          Back to List
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      {/* Header Panel */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-admin-border shadow-sm">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/clearing/management')}
            className="p-2 hover:bg-gray-100 rounded-lg border border-admin-border transition-colors"
          >
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                 Clearing Details
              </h1>
              {renderStatusBadge(data.clearingStatus)}
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 font-mono">
              <span className="text-brand-primary font-bold">{data.clearingNo}</span>
              <span className="hidden sm:inline">|</span>
              <span className="flex items-center gap-1"><Calendar size={14}/> {formatDate(data.createdAt)}</span>
            </div>
          </div>
        </div>
        <button 
            onClick={() => navigate(`/clearing/details?clearingId=${data.id}`)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-admin-border text-gray-700 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
        >
            <ExternalLink size={16} />
            <span>View Lines</span>
        </button>
      </div>

      <div className="flex flex-col gap-6">
        {/* 1. Basic Identification (基础识别) */}
        <DetailCard title="Basic Identification" icon={<Hash size={18}/>}>
            <InfoField label="ID" value={data.id} />
            <InfoField label="Clearing No" value={data.clearingNo} highlight />
            <InfoField label="Type" value={data.clearingType} />
            <InfoField label="Description" value={data.description} icon={<FileText size={14}/>} />
        </DetailCard>

        {/* 2. Business Source (业务来源) */}
        <DetailCard title="Business Source" icon={<Briefcase size={18}/>}>
            <InfoField label="Source Type" value={data.sourceType} highlight />
            <InfoField label="Source No" value={data.sourceNo} />
            <InfoField label="Source ID" value={data.sourceId} />
        </DetailCard>

        {/* 3. Funds Overview (资金概览 - Netting) */}
        <DetailCard title="Funds Overview (Netting)" icon={<ArrowRightLeft size={18}/>}>
            <div className="p-4 bg-red-50 rounded-lg border border-red-100">
                <h4 className="text-xs font-bold text-red-800 uppercase mb-3 flex items-center gap-2">
                    <ArrowRightLeft size={14} className="rotate-45"/> Outbound (Payable)
                </h4>
                <div className="grid grid-cols-2 gap-4">
                    <InfoField label="Out Asset No" value={data.outAssetNo} highlight />
                    <InfoField label="Out Amount" value={formatAmount(data.outAmount)} highlight />
                    <InfoField label="Out Asset ID" value={data.outAssetId} />
                </div>
            </div>
            
            <div className="p-4 bg-green-50 rounded-lg border border-green-100">
                <h4 className="text-xs font-bold text-green-800 uppercase mb-3 flex items-center gap-2">
                    <ArrowRightLeft size={14} className="rotate-[-135deg]"/> Inbound (Receivable)
                </h4>
                <div className="grid grid-cols-2 gap-4">
                    <InfoField label="In Asset No" value={data.inAssetNo} highlight />
                    <InfoField label="In Amount" value={formatAmount(data.inAmount)} highlight />
                    <InfoField label="In Asset ID" value={data.inAssetId} />
                </div>
            </div>
        </DetailCard>

        {/* 4. Fee Processing (手续费处理) */}
        <DetailCard title="Fee Processing" icon={<DollarSign size={18}/>}>
            <InfoField label="Fee Asset No" value={data.feeAssetNo} highlight />
            <InfoField label="Fee Amount" value={formatAmount(data.feeAmount)} />
            <InfoField label="Fee Method" value={data.feeMethod} />
            <InfoField label="Fee Asset ID" value={data.feeAssetId} />
        </DetailCard>

        {/* 5. Physical Funds Linkage (物理资金链路) */}
        <DetailCard title="Physical Funds Linkage" icon={<LinkIcon size={18}/>}>
            <InfoField 
                label="Out Payout No" 
                value={data.outPayoutNo} 
                icon={<ExternalLink size={12}/>}
                highlight={!!data.outPayoutNo}
                onClick={data.outPayoutId ? () => navigate(`/treasury/payouts/${data.outPayoutId}`) : undefined}
            />
            <InfoField label="Out Payout ID" value={data.outPayoutId} />
            <InfoField 
                label="In Payin No" 
                value={data.inPayinNo} 
                icon={<ExternalLink size={12}/>}
                highlight={!!data.inPayinNo}
                onClick={data.inPayinId ? () => navigate(`/treasury/payins/${data.inPayinId}`) : undefined}
            />
            <InfoField label="In Payin ID" value={data.inPayinId} />
        </DetailCard>

        {/* 6. Status & Timestamps */}
        <DetailCard title="Status & Timeline" icon={<Activity size={18}/>}>
            <InfoField label="Created At" value={formatDate(data.createdAt)} />
            <InfoField label="Updated At" value={formatDate(data.updatedAt)} />
            <InfoField label="Status" value={data.clearingStatus} />
        </DetailCard>
      </div>
    </div>
  );
};

// --- Sub-components ---

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
  onClick
}: { 
  label: string, 
  value: string | null | undefined, 
  highlight?: boolean, 
  icon?: React.ReactNode,
  onClick?: () => void
}) => {
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
            <div 
                className={`text-sm font-medium break-all flex items-center gap-2 ${highlight ? 'text-brand-primary' : 'text-gray-900'} ${onClick ? 'cursor-pointer hover:underline' : ''}`}
                onClick={onClick}
            >
                {icon && <span className="text-gray-400">{icon}</span>}
                {value || 'N/A'}
            </div>
        </div>
    );
};

export default ClearingDetail;