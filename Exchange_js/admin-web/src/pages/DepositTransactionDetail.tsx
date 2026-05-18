import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  RefreshCw,
  ExternalLink,
  FileText,
  User,
  CreditCard,
  Activity,
  Clock,
  Globe,
  MapPin,
  ShieldCheck,
  Scale,
  Workflow,
  Compass,
} from 'lucide-react';
import {
  DetailCard,
  DetailPageHeader,
  InfoField,
} from '../components/compliance/DetailPageComponents';
import { copyToClipboard } from '../utils/clipboard';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { formatAssetAmount } from '../utils/number-format';
import { useSimulationMode } from '../utils/simulationMode';
import {
  formatDerivedComplianceStatusLabel,
  formatResponseLifecycleLabel,
  formatStatusLabel,
  formatTransactionTypeLabel,
  normalizeResponseLifecycle,
} from '../utils/transactionRootDisplay';

interface DepositTransactionDetail {
  id: string;
  depositNo: string;
  ownerType: string;
  ownerId: string;
  ownerNo: string | null;
  type?: string | null;
  status: string;
  assetId: string;
  
  // Amounts
  amount: string;
  netAmount: string;
  feeAmount: string;
  
  // Destination
  toWalletId: string;
  toWalletNo: string | null;
  toAddress: string | null;
  toIban: string | null;
  
  // Source
  fromWalletId: string | null;
  fromWalletNo: string | null;
  fromAddress: string | null;
  fromIban: string | null;
  
  // External
  txHash: string | null;
  confirmations: number;
  referenceNo: string | null;
  
  // Compliance (KYT)
  kytStatus: string;
  kytScreeningId: string | null;
  kytRiskScore: number | null;
  kytCheckedAt: string | null;
  
  // Regulation (Travel Rule)
  travelRuleRequired: boolean;
  travelRuleStatus: string;
  travelRuleTransferId: string | null;
  counterpartyVasp: string | null;
  travelRuleCheckedAt: string | null;
  derivedComplianceStatus?: string;
  
  // Timings
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  
  // Relations
  payinId: string | null;
  payinNo: string | null;
  payinStatus?: string | null;
  payinType?: string | null;
  asset: {
    currency: string;
    code: string;
    type: string;
    network: string | null;
    decimals: number;
  };
  
  // Audit
  statusHistory: string | null;
  kytCase?: {
    id: string;
    caseNo: string;
    status: string;
    provider?: string;
    providerCaseId?: string | null;
  } | null;
  travelRuleCase?: {
    id: string;
    caseNo: string;
    status: string;
    provider?: string;
    providerTransferId?: string | null;
  } | null;
  finalAlert?: {
    id: string;
    alertNo: string;
    status: string;
  } | null;
  finalCase?: {
    id: string;
    caseNo: string;
    status: string;
  } | null;
  simulationProfile?: {
    signalId: string;
    signalNo: string;
    riskLevel: string;
    riskReason: string | null;
  } | null;
  auditLogs?: Array<{
    id: string;
    oldStatus: string;
    newStatus: string;
    reason: string | null;
    createdAt: string;
    operatorId: string;
  }>;
}

const DepositTransactionDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<DepositTransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const { enabled: simulationModeEnabled } = useSimulationMode();

  const fetchData = async () => {
    setLoading(true);
    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/deposit-transactions/${id}`);

      if (response.ok) {
        const result = await response.json();
        setData(result);
      } else {
        alert(await getApiErrorMessage(response, 'Failed to load detail'));
        navigate('/exchange/deposit-transactions');
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch detail', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) fetchData();
  }, [id, navigate]);

  const handleCopy = (text: string, field: string) => {
    copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const renderStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      PAYIN_PENDING: 'bg-blue-100 text-blue-800',
      COMPLIANCE_PENDING: 'bg-purple-100 text-purple-800',
      UNDER_REVIEW: 'bg-yellow-100 text-yellow-800',
      FROZEN: 'bg-sky-100 text-sky-800',
      SUCCESS: 'bg-green-100 text-green-800',
      REJECTED: 'bg-red-100 text-red-800',
      FAILED: 'bg-orange-100 text-orange-800',
    };
    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${colors[status] || 'bg-gray-100 text-gray-800'}`}>
        {formatStatusLabel(status)}
      </span>
    );
  };

  const getNextStepLabel = (detail: DepositTransactionDetail) => {
    if (detail.status === 'PAYIN_PENDING') return 'Payin rail';
    if (detail.status === 'FAILED') return 'Terminal: failed';
    if (detail.status === 'SUCCESS') return 'Terminal: success';
    if (detail.status === 'REJECTED') return 'Terminal: rejected';
    if (detail.status === 'FROZEN') return 'Terminal: frozen';
    if (detail.finalCase?.id) return 'Compliance Case';
    if (detail.finalAlert?.id) return 'Compliance Alert';
    if (detail.asset.type === 'FIAT' && detail.status === 'COMPLIANCE_PENDING') {
      return 'Final review bridge';
    }
    const kytLifecycle = normalizeResponseLifecycle(detail.kytStatus);
    const travelLifecycle = normalizeResponseLifecycle(detail.travelRuleStatus);
    if (!kytLifecycle) {
      return detail.kytCase?.id ? 'KYT response' : 'Waiting for KYT case';
    }
    if (['CREATED', 'RECEIVED'].includes(kytLifecycle)) {
      return detail.kytCase?.id ? 'KYT response' : 'Waiting for KYT case';
    }
    if (['CREATED', 'RECEIVED'].includes(travelLifecycle)) {
      return detail.travelRuleCase?.id ? 'Travel Rule response' : 'Waiting for Travel Rule case';
    }
    if (detail.status === 'COMPLIANCE_PENDING') return 'Final review bridge';
    if (detail.status === 'UNDER_REVIEW') return 'Alert or case resolution';
    return 'No further step';
  };

  const getProjectedFinalStates = (detail: DepositTransactionDetail) => {
    if (detail.status === 'FAILED') {
      return { payin: detail.payinStatus || 'FAILED', deposit: 'FAILED' };
    }
    if (detail.status === 'SUCCESS') {
      return { payin: detail.payinStatus || 'CLEARED', deposit: 'SUCCESS' };
    }
    if (detail.status === 'REJECTED') {
      return { payin: detail.payinStatus || 'CLEARED', deposit: 'REJECTED' };
    }
    if (detail.status === 'FROZEN') {
      return { payin: detail.payinStatus || 'CLEARED', deposit: 'FROZEN' };
    }
    if (detail.finalCase?.id) {
      return { payin: detail.payinStatus || 'CLEARED', deposit: 'SUCCESS / REJECTED / FROZEN' };
    }
    if (detail.finalAlert?.id) {
      return { payin: detail.payinStatus || 'CLEARED', deposit: 'SUCCESS or UNDER_REVIEW' };
    }
    return {
      payin: detail.payinStatus || 'FAILED / CONFIRMED / CLEARED',
      deposit: 'SUCCESS / REJECTED / FROZEN / FAILED',
    };
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

  const nextStepLabel = getNextStepLabel(data);
  const projectedFinalStates = getProjectedFinalStates(data);
  const isFiatFlow = String(data.asset.type || '').toUpperCase() === 'FIAT';
  const kytLifecycleDisplay =
    isFiatFlow && !data.kytCase?.id
      ? 'Not created for fiat flow'
      : formatResponseLifecycleLabel(data.kytStatus);
  const travelRuleLifecycleDisplay =
    isFiatFlow && !data.travelRuleCase?.id
      ? 'Not created for fiat flow'
      : formatResponseLifecycleLabel(data.travelRuleStatus);

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <DetailPageHeader
        title="Deposit Details"
        subtitle={`No: ${data.depositNo} · ID: ${data.id} · Created: ${new Date(data.createdAt).toLocaleString()}`}
        onBack={() => navigate('/exchange/deposit-transactions')}
        onRefresh={fetchData}
        refreshing={loading}
        backLabel="Back to Deposits"
      >
        {renderStatusBadge(data.status)}
      </DetailPageHeader>

      <div className="flex flex-col gap-6">
        <DetailCard title="Workflow Summary" icon={<Workflow size={18} />} columns={2}>
            <InfoField label="Current Deposit Status" value={formatStatusLabel(data.status)} highlight source="main" />
            <InfoField label="Current Payin Status" value={data.payinStatus ? formatStatusLabel(data.payinStatus) : 'N/A'} highlight source="main" />
            <InfoField label="Next Step" value={nextStepLabel} source="main" />
            <InfoField label="Projected Payin Final" value={formatStatusLabel(projectedFinalStates.payin)} source="main" />
            <InfoField label="Projected Deposit Final" value={formatStatusLabel(projectedFinalStates.deposit)} source="main" />
            <InfoField label="Derived Compliance" value={data.derivedComplianceStatus ? formatDerivedComplianceStatusLabel(data.derivedComplianceStatus) : null} source="main" />
            <div className="sm:col-span-2 rounded border border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-600 space-y-2">
              <div>
                This chain continues into the linked subject detail pages. Payin progression stays
                inside the payin icon rail, while alert and case handling remains in the formal
                text-action surfaces.
              </div>
              <div className="flex flex-wrap gap-2">
                {data.payinId ? (
                  <button
                    onClick={() => navigate(`/dashboard/treasury/payins/${data.payinId}`)}
                    className="inline-flex items-center gap-1 text-brand-primary hover:underline"
                  >
                    Open Payin
                    <ExternalLink size={12} />
                  </button>
                ) : null}
                {data.kytCase?.id ? (
                  <button
                    onClick={() => navigate(`/dashboard/compliance/tx-kyt-responses/${data.kytCase?.id}`)}
                    className="inline-flex items-center gap-1 text-brand-primary hover:underline"
                  >
                    Open KYT Response
                    <ExternalLink size={12} />
                  </button>
                ) : null}
                {data.travelRuleCase?.id ? (
                  <button
                    onClick={() => navigate(`/dashboard/compliance/tx-travel-rule-responses/${data.travelRuleCase?.id}`)}
                    className="inline-flex items-center gap-1 text-brand-primary hover:underline"
                  >
                    Open Travel Rule Response
                    <ExternalLink size={12} />
                  </button>
                ) : null}
                {data.finalAlert?.id ? (
                  <button
                    onClick={() => navigate(`/dashboard/compliance/alerts/${data.finalAlert?.id}`)}
                    className="inline-flex items-center gap-1 text-brand-primary hover:underline"
                  >
                    Open Final Alert
                    <ExternalLink size={12} />
                  </button>
                ) : null}
                {data.finalCase?.id ? (
                  <button
                    onClick={() => navigate(`/dashboard/compliance/cases/${data.finalCase?.id}`)}
                    className="inline-flex items-center gap-1 text-brand-primary hover:underline"
                  >
                    Open Final Case
                    <ExternalLink size={12} />
                  </button>
                ) : null}
              </div>
            </div>
        </DetailCard>

        {simulationModeEnabled && data.simulationProfile ? (
          <DetailCard title="Compatibility Signal Profile" icon={<Compass size={18} />} columns={2}>
            <InfoField label="Signal No" value={data.simulationProfile.signalNo} source="main" />
            <InfoField label="Signal Risk Level" value={data.simulationProfile.riskLevel} highlight source="main" />
            <InfoField label="Signal Risk Reason" value={data.simulationProfile.riskReason || 'LOW has no reason'} source="main" />
            <InfoField label="Signal ID" value={data.simulationProfile.signalId} source="main" />
            <InfoField
              label="Interpretation"
              value="Signal-level compatibility evidence only. Final deposit risk outcome is decided in Risk Policy Executions."
              source="main"
            />
          </DetailCard>
        ) : null}

        {/* 1. Basic Identification */}
        <DetailCard title="Basic Identification" icon={<FileText size={18} />} columns={2}>
            <InfoField label="ID" value={data.id} source="main" />
            <InfoField label="Deposit No" value={data.depositNo} highlight source="main" />
            <InfoField label="Type" value={formatTransactionTypeLabel(data.type || data.asset.type)} source="main" />
            <InfoField label="Owner Type" value={data.ownerType} source="main" />
            <InfoField label="Owner ID" value={data.ownerId} icon={<User size={14}/>} source="main" />
            <InfoField label="Owner No" value={data.ownerNo} source="main" />
        </DetailCard>

        {/* 2. Assets & Amount */}
        <DetailCard title="Assets & Amount" icon={<CreditCard size={18} />} columns={2}>
            <InfoField label="Asset ID" value={data.assetId} source="main" />
            <InfoField label="Asset Code" value={data.asset.code} source="main" />
            <InfoField label="Asset Network" value={data.asset.network} source="main" />
            <InfoField label="Amount" value={formatAssetAmount(data.amount, data.asset.decimals)} highlight source="main" />
            <InfoField label="Fee Amount" value={formatAssetAmount(data.feeAmount, data.asset.decimals)} source="main" />
            <InfoField label="Net Amount" value={formatAssetAmount(data.netAmount, data.asset.decimals)} highlight source="main" />
        </DetailCard>

        {/* 3. Endpoint / Destination */}
        <DetailCard title="Endpoint / Destination" icon={<MapPin size={18} />} columns={2}>
            <InfoField label="To Wallet ID" value={data.toWalletId} source="main" />
            <InfoField label="To Wallet No" value={data.toWalletNo} source="main" />
            <InfoField label="To Address" value={data.toAddress || 'N/A'} copyable onCopy={(v) => handleCopy(v, 'toAddress')} isCopied={copiedField === 'toAddress'} source="main" />
            <InfoField label="To IBAN" value={data.toIban || 'N/A'} copyable onCopy={(v) => handleCopy(v, 'toIban')} isCopied={copiedField === 'toIban'} source="main" />
        </DetailCard>

        {/* 4. Source / Origin */}
        <DetailCard title="Source / Origin" icon={<Activity size={18} />} columns={2}>
            <InfoField label="From Wallet ID" value={data.fromWalletId} source="main" />
            <InfoField label="From Wallet No" value={data.fromWalletNo} source="main" />
            <InfoField label="From Address" value={data.fromAddress || 'N/A'} copyable onCopy={(v) => handleCopy(v, 'fromAddress')} isCopied={copiedField === 'fromAddress'} source="main" />
            <InfoField label="From IBAN" value={data.fromIban || 'N/A'} copyable onCopy={(v) => handleCopy(v, 'fromIban')} isCopied={copiedField === 'fromIban'} source="main" />
        </DetailCard>

        {/* 5. External Transaction */}
        <DetailCard title="External Transaction Info" icon={<Globe size={18} />} columns={2}>
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
        </DetailCard>

        {/* 6. Response Container (KYT) */}
        <DetailCard title="Response Container (KYT)" icon={<ShieldCheck size={18} />} columns={2}>
            <InfoField label="Lifecycle" value={kytLifecycleDisplay} highlight source="main" />
            <InfoField label="Screening ID" value={data.kytScreeningId} source="main" />
            <InfoField label="Risk Score" value={data.kytRiskScore?.toString()} source="main" />
            <InfoField label="Checked At" value={data.kytCheckedAt ? new Date(data.kytCheckedAt).toLocaleString() : 'N/A'} source="main" />
            <InfoField label="Case No" value={data.kytCase?.caseNo} source="main" />
            <InfoField label="Provider Case ID" value={data.kytCase?.providerCaseId || null} source="main" />
            <div className="sm:col-span-2 rounded border border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-600">
              {data.kytCase?.id ? (
                <button
                  onClick={() => navigate(`/dashboard/compliance/tx-kyt-responses/${data.kytCase?.id}`)}
                  className="inline-flex items-center gap-1 text-brand-primary hover:underline"
                >
                  Open KYT response detail
                  <ExternalLink size={12} />
                </button>
              ) : (
                <span>
                  {isFiatFlow
                    ? 'Not created for fiat flow.'
                    : 'No KYT response detail available.'}
                </span>
              )}
            </div>
        </DetailCard>

        {/* 7. Response Container (Travel Rule) */}
        <DetailCard title="Response Container (Travel Rule)" icon={<Scale size={18} />} columns={2}>
            <InfoField label="Travel Rule Required" value={data.travelRuleRequired ? 'Yes' : 'No'} source="main" />
            <InfoField label="Lifecycle" value={travelRuleLifecycleDisplay} highlight source="main" />
            <InfoField label="Transfer ID" value={data.travelRuleTransferId} source="main" />
            <InfoField label="Counterparty VASP" value={data.counterpartyVasp} source="main" />
            <InfoField label="Checked At" value={data.travelRuleCheckedAt ? new Date(data.travelRuleCheckedAt).toLocaleString() : 'N/A'} source="main" />
            <InfoField label="Case No" value={data.travelRuleCase?.caseNo} source="main" />
            <InfoField
              label="Provider Transfer ID"
              value={data.travelRuleCase?.providerTransferId || null}
              source="main"
            />
            <div className="sm:col-span-2 rounded border border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-600">
              {data.travelRuleCase?.id ? (
                <button
                  onClick={() =>
                    navigate(`/dashboard/compliance/tx-travel-rule-responses/${data.travelRuleCase?.id}`)
                  }
                  className="inline-flex items-center gap-1 text-brand-primary hover:underline"
                >
                  Open Travel Rule response detail
                  <ExternalLink size={12} />
                </button>
              ) : (
                <span>
                  {isFiatFlow
                    ? 'Not created for fiat flow.'
                    : 'No Travel Rule response detail available.'}
                </span>
              )}
            </div>
        </DetailCard>

        {/* 8. Derived Compliance & Timings */}
        <DetailCard title="Derived Compliance & Timings" icon={<Clock size={18} />} columns={2}>
            <InfoField label="Current Status" value={formatStatusLabel(data.status)} highlight source="main" />
            <InfoField label="Derived Compliance" value={data.derivedComplianceStatus ? formatDerivedComplianceStatusLabel(data.derivedComplianceStatus) : null} highlight source="main" />
            <InfoField label="Created At" value={new Date(data.createdAt).toLocaleString()} source="main" />
            <InfoField label="Updated At" value={new Date(data.updatedAt).toLocaleString()} source="main" />
            <InfoField label="Completed At" value={data.completedAt ? new Date(data.completedAt).toLocaleString() : 'N/A'} source="main" />
        </DetailCard>

        <DetailCard title="Linked Rail" icon={<Workflow size={18} />} columns={2}>
            <InfoField label="Payin ID" value={data.payinId} source="main" />
            <InfoField label="Payin No" value={data.payinNo} source="main" />
            <InfoField label="Payin Status" value={data.payinStatus ? formatStatusLabel(data.payinStatus) : null} source="main" />
            <InfoField label="Payin Type" value={data.payinType ? formatTransactionTypeLabel(data.payinType) : null} source="main" />
            <InfoField label="Final Alert" value={data.finalAlert?.alertNo || null} source="main" />
            <InfoField label="Final Alert Status" value={data.finalAlert?.status || null} source="main" />
            <InfoField label="Final Case" value={data.finalCase?.caseNo || null} source="main" />
            <InfoField label="Final Case Status" value={data.finalCase?.status || null} source="main" />
            <div className="sm:col-span-2 rounded border border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-600 space-y-2">
              {data.status === 'COMPLIANCE_PENDING' || data.status === 'UNDER_REVIEW' ? (
                <div>
                  Deposit-side manual actions are disabled in final transaction review. Continue investigation from the linked alert or case.
                </div>
              ) : (
                <div>
                  Final transaction review is reflected here when applicable. Deposit status is driven by alert or case closure.
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {data.finalAlert?.id ? (
                  <button
                    onClick={() => navigate(`/dashboard/compliance/alerts/${data.finalAlert?.id}`)}
                    className="inline-flex items-center gap-1 text-brand-primary hover:underline"
                  >
                    Open Final Alert
                    <ExternalLink size={12} />
                  </button>
                ) : null}
                {data.finalCase?.id ? (
                  <button
                    onClick={() => navigate(`/dashboard/compliance/cases/${data.finalCase?.id}`)}
                    className="inline-flex items-center gap-1 text-brand-primary hover:underline"
                  >
                    Open Final Case
                    <ExternalLink size={12} />
                  </button>
                ) : null}
              </div>
            </div>
        </DetailCard>

        {/* 9. Audit & History */}
        <DetailCard title="Audit Trail" icon={<Activity size={18} />} columns={1}>
             <StatusTimeline historyJson={data.statusHistory} />
        </DetailCard>
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
                                    {formatStatusLabel(item.status)}
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
        case 'COMPLIANCE_PENDING': return 'bg-purple-500';
        case 'UNDER_REVIEW': return 'bg-yellow-500';
        case 'FROZEN': return 'bg-sky-500';
        case 'PAYIN_PENDING': return 'bg-blue-500';
        default: return 'bg-gray-300';
    }
};

const getStatusBadgeStyle = (status: string) => {
    switch (status) {
        case 'SUCCESS': return 'bg-green-50 text-green-700 border-green-200';
        case 'FAILED': return 'bg-red-50 text-red-700 border-red-200';
        case 'REJECTED': return 'bg-red-50 text-red-700 border-red-200';
        case 'COMPLIANCE_PENDING': return 'bg-purple-50 text-purple-700 border-purple-200';
        case 'UNDER_REVIEW': return 'bg-yellow-50 text-yellow-700 border-yellow-200';
        case 'FROZEN': return 'bg-sky-50 text-sky-700 border-sky-200';
        case 'PAYIN_PENDING': return 'bg-blue-50 text-blue-700 border-blue-200';
        default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
};

export default DepositTransactionDetail;
