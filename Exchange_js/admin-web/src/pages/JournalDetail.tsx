import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Hash, FileText, AlertCircle, Clock, RefreshCw, DollarSign, Layers, Activity } from 'lucide-react';

interface JournalDetail {
  id: string;
  journalNo: string;
  description: string | null;
  
  sourceType: string;
  sourceId: string;
  sourceNo?: string | null;
  eventCode: string;
  journalHeaderTemplateId: string | null;
  reversalOfJournalId: string | null;
  
  baseAssetId: string;
  baseAsset: { id: string; code: string; type: string };
  totalAmount: string | null;
  
  postingStatus: string;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const JournalDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<JournalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/journals/${id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const result = await response.json();
        setData(result);
      } else {
        const err = await response.json();
        setError(err.message || 'Failed to fetch journal details');
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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <RefreshCw className="animate-spin text-brand-primary mb-4" size={48} />
        <p className="text-gray-500">Loading journal details...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center max-w-2xl mx-auto mt-12">
        <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-red-800 mb-2">Data Retrieval Failed</h2>
        <p className="text-red-600 mb-6">{error || 'Journal entry not found or has been deleted'}</p>
        <button 
          onClick={() => navigate('/ledger/journals')}
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
            onClick={() => navigate('/ledger/journals')}
            className="p-2 hover:bg-gray-100 rounded-lg border border-admin-border transition-colors"
          >
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                 Journal Entry
              </h1>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                data.postingStatus === 'POSTED' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
              }`}>
                {data.postingStatus}
              </span>
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 font-mono">
              <span className="text-brand-primary font-bold">No: {data.journalNo}</span>
              <span>ID: {data.id}</span>
              <span className="flex items-center gap-1"><Clock size={14}/> {formatDate(data.createdAt)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {/* 1. Basic Identification (基础识别) */}
        <DetailCard title="Basic Identification" icon={<Hash size={18}/>}>
            <InfoField label="ID" value={data.id} highlight />
            <InfoField label="Journal No" value={data.journalNo} highlight />
            <InfoField label="Description" value={data.description} icon={<FileText size={14}/>} />
        </DetailCard>

        {/* 2. Business Source (业务来源) */}
        <DetailCard title="Business Source" icon={<Layers size={18}/>}>
            <InfoField label="Source Type" value={data.sourceType} highlight />
            <InfoField label="Source No" value={data.sourceNo} highlight />
            <InfoField label="Source ID" value={data.sourceId} />
            <InfoField label="Event Code" value={data.eventCode} />
            <InfoField label="Template ID" value={data.journalHeaderTemplateId} />
            <InfoField label="Reversal Of" value={data.reversalOfJournalId} />
        </DetailCard>

        {/* 3. Finance/Currency (财务/币种) */}
        <DetailCard title="Finance & Currency" icon={<DollarSign size={18}/>}>
            <InfoField label="Base Asset ID" value={data.baseAssetId} />
            <InfoField label="Base Asset Code" value={data.baseAsset?.code} highlight />
            <InfoField label="Total Amount" value={data.totalAmount} highlight icon={<DollarSign size={14}/>} />
        </DetailCard>

        {/* 4. Status & Timing (状态与时效) */}
        <DetailCard title="Status & Timing" icon={<Activity size={18}/>}>
            <InfoField label="Posting Status" value={data.postingStatus} highlight={data.postingStatus !== 'POSTED'} />
            <InfoField label="Posted At" value={formatDate(data.postedAt)} />
            <InfoField label="Created At" value={formatDate(data.createdAt)} />
            <InfoField label="Updated At" value={formatDate(data.updatedAt)} />
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
  icon 
}: { 
  label: string, 
  value: string | null | undefined, 
  highlight?: boolean, 
  icon?: React.ReactNode
}) => {
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
            <div className={`text-sm font-medium break-all flex items-center gap-2 ${highlight ? 'text-brand-primary' : 'text-gray-900'}`}>
                {icon && <span className="text-gray-400">{icon}</span>}
                {value || 'N/A'}
            </div>
        </div>
    );
};

export default JournalDetail;
