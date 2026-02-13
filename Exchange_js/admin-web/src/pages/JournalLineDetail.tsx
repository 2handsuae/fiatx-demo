import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Hash, 
  FileText, 
  DollarSign,
  Layers,
  Activity,
  Code,
  Calendar,
  ExternalLink,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

interface JournalLineDetail {
  id: string;
  journalId: string;
  lineNo: number;
  journalLineTemplateId: string | null;
  referenceId: string | null;
  
  accountCode: string;
  drCr: 'DR' | 'CR';
  
  assetId: string;
  amount: string;
  fxRate: string | null;
  baseAmount: string | null;
  
  ownerType: string;
  ownerId: string | null;
  dimensions: any;
  description: string | null;
  
  createdAt: string;
  
  journal: {
    journalNo: string;
    eventCode: string;
  };
  account: {
    name: string;
  };
  asset: {
    code: string;
  };
}

const JournalLineDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<JournalLineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/journal-lines/${id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const result = await response.json();
        setData(result);
      } else {
        const err = await response.json();
        setError(err.message || 'Failed to fetch journal line details');
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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <RefreshCw className="animate-spin text-brand-primary mb-4" size={48} />
        <p className="text-gray-500">Loading journal line details...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center max-w-2xl mx-auto mt-12">
        <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-red-800 mb-2">Data Retrieval Failed</h2>
        <p className="text-red-600 mb-6">{error || 'Journal line not found or has been deleted'}</p>
        <button 
          onClick={() => navigate('/ledger/journal-lines')}
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
            onClick={() => navigate('/ledger/journal-lines')}
            className="p-2 hover:bg-gray-100 rounded-lg border border-admin-border transition-colors"
          >
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">
                 Journal Line
              </h1>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                data.drCr === 'DR' ? 'bg-indigo-100 text-indigo-700' : 'bg-orange-100 text-orange-700'
              }`}>
                {data.drCr}
              </span>
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 font-mono">
              <span className="text-brand-primary font-bold">Line: {data.lineNo}</span>
              <span>ID: {data.id}</span>
              <span className="flex items-center gap-1"><Calendar size={14}/> {formatDate(data.createdAt)}</span>
            </div>
          </div>
        </div>
        <button 
            onClick={() => navigate(`/ledger/journals/${data.journalId}`)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-admin-border text-gray-700 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
        >
            <ExternalLink size={16} />
            <span>View Parent Journal</span>
        </button>
      </div>

      <div className="flex flex-col gap-6">
        {/* 1. Row Identification (行级识别) */}
        <DetailCard title="Row Identification" icon={<Hash size={18}/>}>
            <InfoField label="ID" value={data.id} highlight />
            <InfoField 
                label="Journal No" 
                value={data.journal?.journalNo} 
                highlight 
                icon={<ExternalLink size={12}/>}
                onClick={() => navigate(`/ledger/journals/${data.journalId}`)}
            />
            <InfoField label="Journal ID" value={data.journalId} />
            <InfoField label="Line No" value={data.lineNo.toString()} />
            <InfoField label="Template ID" value={data.journalLineTemplateId} />
            <InfoField label="Reference ID" value={data.referenceId} />
        </DetailCard>

        {/* 2. Core Accounting (核心会计) */}
        <DetailCard title="Core Accounting" icon={<Activity size={18}/>}>
            <InfoField label="Account Code" value={data.accountCode} highlight />
            <InfoField label="Account Name" value={data.account?.name} />
            <InfoField label="Direction" value={data.drCr === 'DR' ? 'DEBIT' : 'CREDIT'} highlight />
        </DetailCard>

        {/* 3. Amount & FX (金额与汇率) */}
        <DetailCard title="Amount & FX" icon={<DollarSign size={18}/>}>
            <InfoField label="Asset Code" value={data.asset?.code} highlight />
            <InfoField label="Asset ID" value={data.assetId} />
            <InfoField label="Tx Amount" value={formatAmount(data.amount)} highlight />
            <InfoField label="FX Rate" value={data.fxRate} />
            <InfoField label="Base Amount" value={formatAmount(data.baseAmount)} highlight />
        </DetailCard>

        {/* 4. Ownership & Dimensions (归属与维度) */}
        <DetailCard title="Ownership & Dimensions" icon={<Layers size={18}/>}>
            <InfoField label="Owner Type" value={data.ownerType} highlight />
            <InfoField label="Owner ID" value={data.ownerId} />
            <InfoField label="Description" value={data.description} icon={<FileText size={14}/>} />
            <div className="col-span-1 sm:col-span-2">
                 <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Dimensions (JSON)</span>
                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 font-mono text-xs text-gray-600 overflow-x-auto">
                        {JSON.stringify(data.dimensions || {}, null, 2)}
                    </div>
                </div>
            </div>
        </DetailCard>
      </div>
    </div>
  );
};

// --- Sub-components (Reused from JournalDetail/CustomerDetail) ---

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

export default JournalLineDetail;