import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  RefreshCw,
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
import { SimulationRail, type SimulationRailItem } from '../components/SimulationRail';
import { useSimulationMode } from '../utils/simulationMode';
import {
  formatRailStatusLabel,
  formatTransactionTypeLabel,
  normalizeRailDisplayStatus,
} from '../utils/transactionRootDisplay';

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
  displayStatus?: string | null;
  
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
  auditLogs?: Array<{
    id: string;
    action?: string | null;
    operatorId?: string | null;
    actorId?: string | null;
    actorType?: string | null;
    oldStatus?: string | null;
    newStatus?: string | null;
    statusFrom?: string | null;
    statusTo?: string | null;
    reason?: string | null;
    createdAt?: string | null;
    occurredAt?: string | null;
    result?: string | null;
  }>;
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

  const fetchPayin = async () => {
    setLoading(true);
    try {
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/treasury/payins/${id}`);

      if (response.ok) {
        const data = await response.json();
        setPayin(data);
      } else {
        alert(await getApiErrorMessage(response, 'Failed to load payin details'));
        navigate('/dashboard/treasury/payins');
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Failed to fetch payin', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
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
      const response = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/treasury/payins/${id}/mock-event`, {
        method: 'POST',
        body: JSON.stringify({ event })
      });
      
      if (response.ok) {
        const updated = await response.json();
        setPayin(prev => prev ? { ...prev, ...updated, customer: prev.customer || updated.customer } : updated);
      } else {
        alert(`Action failed: ${await getApiErrorMessage(response, 'Request failed')}`);
      }
    } catch (error) {
      if (error instanceof AdminSessionError) return;
      console.error('Action failed', error);
    } finally {
      setRailSubmitting(false);
    }
  };

  const renderStatusBadge = (
    status: string,
    displayStatus?: string | null,
  ) => {
    const normalizedDisplayStatus = normalizeRailDisplayStatus(
      displayStatus || status,
    );
    const colors: Record<string, string> = {
      DETECTED: 'bg-blue-100 text-blue-800',
      CONFIRMING: 'bg-yellow-100 text-yellow-800',
      CONFIRMED: 'bg-indigo-100 text-indigo-800',
      CLEARED: 'bg-green-100 text-green-800',
      FAILED: 'bg-red-100 text-red-800',
    };
    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${colors[normalizedDisplayStatus] || 'bg-gray-100 text-gray-800'}`}>
        {formatRailStatusLabel(normalizedDisplayStatus)}
      </span>
    );
  };

  const getPayinRailItems = (detail: PayinDetail): SimulationRailItem[] => {
    const status = String(detail.status || '').toUpperCase();
    const type = formatTransactionTypeLabel(detail.type);

    if (type === 'FIAT') {
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
          helperText: 'Inbound fiat signal detected.',
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
          helperText: 'Move to CONFIRMED after receipt is verified.',
        },
        {
          id: 'cleared',
          label: 'Cleared',
          icon: <CheckCircle2 size={14} />,
          state: status === 'CLEARED' ? 'current' : 'readonly',
          tone: 'success',
          helperText: 'Shown automatically after confirmed-side accounting succeeds.',
        },
        {
          id: 'failed',
          label: 'Fail',
          icon: <ShieldAlert size={14} />,
          state: status === 'FAILED' ? 'current' : status === 'DETECTED' ? 'available' : 'readonly',
          tone: 'danger',
          onClick: status === 'DETECTED' ? () => handleMockEvent('FIAT_FAILED') : undefined,
          disabled: railSubmitting,
          helperText: 'Move to FAILED when inbound monitoring fails.',
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
        helperText: 'Inbound on-chain signal detected.',
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
        helperText: 'Advance to CONFIRMING after the mempool signal is observed.',
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
        helperText: 'Advance to CONFIRMED once confirmation conditions are met.',
      },
      {
        id: 'cleared',
        label: 'Cleared',
        icon: <CheckCircle2 size={14} />,
        state: status === 'CLEARED' ? 'current' : 'readonly',
        tone: 'success',
        helperText: 'Shown automatically after accounting succeeds. No simulation action is exposed.',
      },
      {
        id: 'failed',
        label: 'Dropped',
        icon: <ShieldAlert size={14} />,
        state: status === 'FAILED' ? 'current' : status === 'CONFIRMING' ? 'available' : 'readonly',
        tone: 'danger',
        onClick: status === 'CONFIRMING' ? () => handleMockEvent('DROPPED') : undefined,
        disabled: railSubmitting,
        helperText: 'Drop / fail branch retained by the current model.',
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
      <DetailPageHeader
        title="Payin Details"
        subtitle={`No: ${payin.payinNo || '-'} · ID: ${payin.id} · Created: ${formatDate(payin.createdAt)}`}
        onBack={() => navigate('/dashboard/treasury/payins')}
        onRefresh={fetchPayin}
        refreshing={loading}
        backLabel="Back to Payins"
      >
        {renderStatusBadge(payin.status, payin.displayStatus)}
      </DetailPageHeader>

      {simulationModeEnabled ? (
        <SimulationRail
          title="Payin Monitoring Rail"
          description="Payin is the inbound monitoring rail. Simulate bank or chain observation events here; Cleared is read-only output."
          items={payinRailItems}
        />
      ) : null}

      {showAccountingBlockedHint ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Payin is currently stuck at `CONFIRMED`. This usually means confirmed-side accounting has
          not yet advanced it to `Cleared`.
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        {payin.simulationProfile ? (
          <DetailCard title="Inbound Signal Profile" icon={<ShieldAlert size={18} />} columns={2}>
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

        {/* Basic Identification */}
        <DetailCard title="Basic Identification" icon={<FileText size={18}/>} columns={2}>
            <InfoField label="Payin ID" value={payin.id} highlight source="main" />
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
            <InfoField label="Type" value={formatTransactionTypeLabel(payin.type)} source="main" />
        </DetailCard>

        {/* Assets & Amount */}
        <DetailCard title="Assets & Amount" icon={<Banknote size={18}/>} columns={2}>
            <InfoField label="Asset ID (Symbol)" value={payin.asset.code} source="main" />
            <InfoField label="Asset Name" value={payin.asset.description || payin.asset.code} source="main" />
            <InfoField label="Amount" value={formatAssetAmount(payin.amount, payin.asset.decimals)} highlight source="main" />
            <InfoField label="Decimals" value={payin.asset.decimals.toString()} source="main" />
        </DetailCard>

        {/* 3. Settlement Endpoint / Path */}
        <DetailCard title="Settlement Endpoint / Path" icon={<MapPin size={18}/>} columns={2}>
            <InfoField label="To Wallet ID" value={payin.toWalletId} source="main" />
            <InfoField label="To Wallet No" value={payin.toWalletNo} source="main" />
            <InfoField label="To Address" value={payin.toAddress || 'N/A'} copyable onCopy={(v) => handleCopy(v, 'toAddress')} isCopied={copiedField === 'toAddress'} source="main" />
            <InfoField label="To IBAN" value={payin.toIban || 'N/A'} copyable onCopy={(v) => handleCopy(v, 'toIban')} isCopied={copiedField === 'toIban'} source="main" />
            <InfoField label="From Wallet ID" value={payin.fromWalletId} source="main" />
            <InfoField label="From Wallet No" value={payin.fromWalletNo} source="main" />
            <InfoField label="From Address" value={payin.fromAddress || 'N/A'} copyable onCopy={(v) => handleCopy(v, 'fromAddress')} isCopied={copiedField === 'fromAddress'} source="main" />
            <InfoField label="From IBAN" value={payin.fromIban || 'N/A'} copyable onCopy={(v) => handleCopy(v, 'fromIban')} isCopied={copiedField === 'fromIban'} source="main" />
        </DetailCard>

        {/* 4. Settlement Evidence */}
        <DetailCard title="Settlement Evidence" icon={<Globe size={18}/>} columns={2}>
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
            <InfoField label="Provider Txn ID" value={payin.providerTxnId || 'N/A'} source="main" />
        </DetailCard>

        {/* 5. Status & Timings */}
        <DetailCard title="Status & Timings" icon={<Clock size={18}/>} columns={2}>
            <InfoField label="Current Status" value={formatRailStatusLabel(payin.displayStatus || payin.status)} highlight source="main" />
            <InfoField label="Created At" value={formatDate(payin.createdAt)} source="main" />
            <InfoField label="Updated At" value={formatDate(payin.updatedAt)} source="main" />
            <InfoField label="Received At" value={formatDate(payin.receivedAt)} source="main" />
            <InfoField label="Confirmed At" value={formatDate(payin.confirmedAt)} source="main" />
        </DetailCard>

        {/* 6. Status History & Audit */}
        <DetailCard title="Status History & Audit" icon={<Activity size={18}/>} columns={1}>
             <StatusTimeline historyJson={payin.statusHistory} />
             <AuditEventList events={payin.auditLogs || []} />
        </DetailCard>
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
                                    {formatRailStatusLabel(item.status)}
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

const AuditEventList = ({
  events,
}: {
  events: Array<{
    id: string;
    action?: string | null;
    operatorId?: string | null;
    actorId?: string | null;
    actorType?: string | null;
    oldStatus?: string | null;
    newStatus?: string | null;
    statusFrom?: string | null;
    statusTo?: string | null;
    reason?: string | null;
    createdAt?: string | null;
    occurredAt?: string | null;
    result?: string | null;
  }>;
}) => {
  if (events.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-gray-200 px-4 py-3 text-sm text-gray-400">
        No canonical audit events found.
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        Canonical Audit Trail
      </div>
      {events.map((event) => (
        <div key={event.id} className="rounded-lg border border-gray-100 bg-gray-50/70 p-4 text-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <div className="font-semibold text-gray-900">
                {event.action || formatRailStatusLabel(event.newStatus) || 'AUDIT_EVENT'}
              </div>
              <div className="text-xs text-gray-500">
                {event.statusFrom || event.oldStatus
                  ? `From: ${formatRailStatusLabel(event.statusFrom || event.oldStatus)}`
                  : 'From: N/A'}
                {'  '}
                {event.statusTo || event.newStatus
                  ? `To: ${formatRailStatusLabel(event.statusTo || event.newStatus)}`
                  : 'To: N/A'}
              </div>
              <div className="text-sm text-gray-600">
                {event.reason || 'No reason provided'}
              </div>
              <div className="text-xs text-gray-400">
                {(event.actorType || 'SYSTEM')}: {event.actorId || event.operatorId || 'SYSTEM'}
                {event.result ? ` · ${event.result}` : ''}
              </div>
            </div>
            <time className="text-xs font-mono text-gray-500">
              {new Date(event.occurredAt || event.createdAt || '').toLocaleString()}
            </time>
          </div>
        </div>
      ))}
    </div>
  );
};

export default PayinDetail;
