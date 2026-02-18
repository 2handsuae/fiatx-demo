import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Hash, DollarSign, Calendar, ExternalLink, RefreshCw, AlertCircle, User, Link as LinkIcon } from 'lucide-react';
import { formatAssetAmount } from '../utils/number-format';

interface ClearingLineDetail {
  id: string;
  clearingId: string;
  clearingNo?: string | null;
  lineNo: number;
  lineType: string;
  
  partyType: string;
  partyId: string | null;
  partyNo?: string | null;
  
  assetId: string;
  assetCode?: string | null;
  assetDecimals?: number | null;
  amount: string;
  
  refType: string | null;
  refId: string | null;
  
  createdAt: string;
}

const ClearingLineDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ClearingLineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/clearings/lines/${id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const result = await response.json();
        setData(result);
      } else {
        const err = await response.json();
        setError(err.message || 'Failed to fetch clearing line details');
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

  const renderTypeBadge = (type: string) => {
    const colorMap: Record<string, string> = {
      PAYABLE: 'bg-red-100 text-red-800',
      RECEIVABLE: 'bg-green-100 text-green-800',
      COMMISSION: 'bg-yellow-100 text-yellow-800',
    };
    const className = colorMap[type] || 'bg-gray-100 text-gray-800';
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${className}`}>
        {type}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <RefreshCw className="animate-spin text-brand-primary mb-4" size={48} />
        <p className="text-gray-500">Loading clearing line details...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center max-w-2xl mx-auto mt-12">
        <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-red-800 mb-2">Data Retrieval Failed</h2>
        <p className="text-red-600 mb-6">{error || 'Clearing line not found or has been deleted'}</p>
        <button 
          onClick={() => navigate('/clearing/details')}
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
            onClick={() => navigate('/clearing/details')}
            className="p-2 hover:bg-gray-100 rounded-lg border border-admin-border transition-colors"
          >
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                 Clearing Line
              </h1>
              {renderTypeBadge(data.lineType)}
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 font-mono">
              <span className="text-brand-primary font-bold">Line: {data.lineNo}</span>
              <span>ID: {data.id}</span>
              <span className="flex items-center gap-1"><Calendar size={14}/> {formatDate(data.createdAt)}</span>
            </div>
          </div>
        </div>
        <button 
            onClick={() => navigate(`/clearing/management/${data.clearingId}`)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-admin-border text-gray-700 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
        >
            <ExternalLink size={16} />
            <span>View Parent Clearing</span>
        </button>
      </div>

      <div className="flex flex-col gap-6">
        {/* 1. Row Identification (行级识别) */}
        <DetailCard title="Row Identification" icon={<Hash size={18}/>}>
            <InfoField label="ID" value={data.id} />
            <InfoField 
                label="Clearing No" 
                value={data.clearingNo} 
                highlight 
                icon={<ExternalLink size={12}/>}
                onClick={() => navigate(`/clearing/management/${data.clearingId}`)}
            />
            <InfoField label="Clearing ID" value={data.clearingId} />
            <InfoField label="Line No" value={data.lineNo.toString()} />
            <InfoField label="Line Type" value={data.lineType} />
        </DetailCard>

        {/* 2. Counterparty (交易对手方) */}
        <DetailCard title="Counterparty" icon={<User size={18}/>}>
            <InfoField label="Party Type" value={data.partyType} highlight />
            <InfoField 
                label="Party No" 
                value={data.partyNo} 
                highlight={!!data.partyNo}
                icon={data.partyNo ? <ExternalLink size={12}/> : undefined}
                onClick={
                    data.partyType === 'CUSTOMER' && data.partyId 
                        ? () => navigate(`/customer/${data.partyId}`) 
                        : undefined
                }
            />
            <InfoField label="Party ID" value={data.partyId} />
        </DetailCard>

        {/* 3. Amount & Asset (金额与资产) */}
        <DetailCard title="Amount & Asset" icon={<DollarSign size={18}/>}>
            <InfoField label="Asset Code" value={data.assetCode} highlight />
            <InfoField label="Asset ID" value={data.assetId} />
            <InfoField
              label="Amount"
              value={formatAssetAmount(data.amount, data.assetDecimals)}
              highlight
            />
        </DetailCard>

        {/* 4. Tracking Reference (追踪引用) */}
        <DetailCard title="Tracking Reference" icon={<LinkIcon size={18}/>}>
            <InfoField label="Ref Type" value={data.refType} />
            <InfoField label="Ref ID" value={data.refId} />
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

export default ClearingLineDetail;
