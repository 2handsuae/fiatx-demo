import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
  FileText,
  User,
  CreditCard,
  Activity,
  Clock,
  MapPin,
  CircleDashed,
  CheckCircle2,
  Waves,
  Landmark,
  ShieldAlert,
} from 'lucide-react';
import { copyToClipboard } from '../utils/clipboard';
import { formatAssetAmount } from '../utils/number-format';
import { SimulationRail, type SimulationRailItem } from '../components/SimulationRail';
import { useSimulationMode } from '../utils/simulationMode';
import {
  formatRailStatusLabel,
  formatTransactionTypeLabel,
  normalizeRailDisplayStatus,
} from '../utils/transactionRootDisplay';

interface PayoutDetail {
  id: string;
  payoutNo: string;
  withdrawId: string;
  ownerNo?: string | null;
  transactionType?: string | null;
  transactionId?: string | null;
  transactionNo?: string | null;
  type: string;
  status: string;
  displayStatus?: string | null;
  amount: string;
  assetId: string;
  asset: { code: string; type: string; network: string | null; decimals?: number };
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
    status: string;
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
    action?: string | null;
    operatorId?: string | null;
    actorId?: string | null;
    actorType?: string | null;
    oldStatus?: string | null;
    newStatus?: string | null;
    statusFrom?: string | null;
    statusTo?: string | null;
    reason: string | null;
    createdAt?: string | null;
    occurredAt?: string | null;
    module?: string | null;
    result?: string | null;
  }>;
}

const PayoutDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<PayoutDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [referenceNoDraft, setReferenceNoDraft] = useState('');
  const { enabled: simulationModeEnabled } = useSimulationMode();

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
        setReferenceNoDraft(result.referenceNo || '');
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

  const handleUpdateAction = async (
    action: string,
    extraPayload?: Record<string, unknown>,
  ) => {
    setUpdating(true);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/payouts/${id}/status`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ action, ...extraPayload })
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

  const handleReCloseout = async () => {
    setUpdating(true);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/payouts/${id}/re-closeout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        fetchPayout();
      } else {
        const err = await response.json();
        alert(`Re-run closeout failed: ${err.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Re-run closeout failed', error);
      alert('Re-run closeout failed due to network error');
    } finally {
      setUpdating(false);
    }
  };

  const handleReCompensate = async () => {
    setUpdating(true);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${import.meta.env.VITE_API_URL}/payouts/${id}/re-compensate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        fetchPayout();
      } else {
        const err = await response.json();
        alert(`Re-run compensation failed: ${err.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Re-run compensation failed', error);
      alert('Re-run compensation failed due to network error');
    } finally {
      setUpdating(false);
    }
  };

  const handleCopy = (text: string, field: string) => {
    copyToClipboard(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const effectiveFiatReferenceNo =
    referenceNoDraft.trim() || data?.referenceNo || '';

  const getPayoutRailItems = (payout: PayoutDetail): SimulationRailItem[] => {
    const { status, type } = payout;
    const normalized = String(status || '').toUpperCase();
    const normalizedType = formatTransactionTypeLabel(type);

    if (normalizedType === 'CRYPTO') {
      return [
        {
          id: 'sign',
          label: 'Sign',
          icon: <CircleDashed size={14} />,
          state:
            normalized === 'SIGNING'
              ? 'current'
              : ['BROADCASTED', 'CONFIRMING', 'CONFIRMED', 'CLEAR', 'FAILED', 'TIMEOUT'].includes(normalized)
                ? 'completed'
                : normalized === 'CREATED'
                  ? 'available'
                  : 'readonly',
          onClick: normalized === 'CREATED' ? () => handleUpdateAction('SIGN') : undefined,
          disabled: updating,
          helperText: '生成签名后进入 SIGNING',
        },
        {
          id: 'broadcast',
          label: 'Broadcast',
          icon: <Waves size={14} />,
          state:
            normalized === 'BROADCASTED'
              ? 'current'
              : ['CONFIRMING', 'CONFIRMED', 'CLEAR', 'FAILED', 'TIMEOUT'].includes(normalized)
                ? 'completed'
                : normalized === 'SIGNING'
                  ? 'available'
                  : 'readonly',
          onClick: normalized === 'SIGNING' ? () => handleUpdateAction('BROADCAST') : undefined,
          disabled: updating,
          helperText: '广播后进入 BROADCASTED',
        },
        {
          id: 'mempool',
          label: 'Seen in Mempool',
          icon: <Activity size={14} />,
          state:
            normalized === 'CONFIRMING'
              ? 'current'
              : ['CONFIRMED', 'CLEAR', 'FAILED', 'TIMEOUT'].includes(normalized)
                ? 'completed'
                : normalized === 'BROADCASTED'
                  ? 'available'
                  : 'readonly',
          onClick:
            normalized === 'BROADCASTED'
              ? () => handleUpdateAction('SEEN_IN_MEMPOOL')
              : undefined,
          disabled: updating,
          helperText: '看到 mempool 后进入 CONFIRMING',
        },
        {
          id: 'confirmed',
          label: 'Confirm',
          icon: <CheckCircle2 size={14} />,
          state:
            normalized === 'CONFIRMED'
              ? 'current'
              : normalized === 'CLEAR'
                ? 'completed'
                : normalized === 'CONFIRMING'
                  ? 'available'
                  : 'readonly',
          onClick: normalized === 'CONFIRMING' ? () => handleUpdateAction('CONFIRM') : undefined,
          disabled: updating,
          helperText: '确认后进入 CONFIRMED，随后系统自动写 CLEAR',
        },
        {
          id: 'cleared',
          label: 'Cleared',
          icon: <CheckCircle2 size={14} />,
          state: normalized === 'CLEAR' ? 'current' : 'readonly',
          tone: 'success',
          helperText: 'closeout 记账成功后自动出现',
        },
        {
          id: 'failed',
          label: 'Fail / Timeout',
          icon: <ShieldAlert size={14} />,
          state: ['FAILED', 'TIMEOUT'].includes(normalized)
            ? 'current'
            : ['CREATED', 'SIGNING', 'BROADCASTED', 'CONFIRMING'].includes(normalized)
              ? 'available'
              : 'readonly',
          tone: 'danger',
          onClick:
            normalized === 'CREATED' ||
            normalized === 'SIGNING' ||
            normalized === 'BROADCASTED' ||
            normalized === 'CONFIRMING'
              ? () =>
                  handleUpdateAction(
                    normalized === 'CONFIRMING' ? 'TIMEOUT' : 'FAIL',
                  )
              : undefined,
          disabled: updating,
          helperText: '异常路径继续走 canonical compensation',
        },
      ];
    }

    return [
      {
        id: 'submit',
        label: 'Submit',
        icon: <Landmark size={14} />,
        state:
          normalized === 'CONFIRMING'
            ? 'current'
            : ['CONFIRMED', 'CLEAR', 'FAILED', 'TIMEOUT', 'RETURNED'].includes(normalized)
              ? 'completed'
              : normalized === 'CREATED'
                ? 'available'
                : 'readonly',
        onClick:
          normalized === 'CREATED'
            ? () =>
                handleUpdateAction('SUBMIT', {
                  referenceNo: referenceNoDraft.trim() || undefined,
                })
            : undefined,
        disabled: updating,
        helperText: '提交后进入 CONFIRMING',
      },
      {
        id: 'confirm',
        label: 'Confirm',
        icon: <CheckCircle2 size={14} />,
        state:
          normalized === 'CONFIRMED'
            ? 'current'
            : normalized === 'CLEAR'
              ? 'completed'
              : normalized === 'CONFIRMING'
                ? 'available'
                : 'readonly',
        onClick:
          normalized === 'CONFIRMING'
            ? () =>
                handleUpdateAction('CONFIRM', {
                  referenceNo: referenceNoDraft.trim() || undefined,
                })
            : undefined,
        disabled: updating,
        helperText: effectiveFiatReferenceNo
          ? '确认后进入 CONFIRMED，随后系统自动写 CLEAR'
          : '确认时若未填写，系统会自动生成 Reference No',
      },
      {
        id: 'cleared',
        label: 'Cleared',
        icon: <CheckCircle2 size={14} />,
        state: normalized === 'CLEAR' ? 'current' : 'readonly',
        tone: 'success',
        helperText: 'closeout 记账成功后自动出现',
      },
      {
        id: 'fail',
        label: 'Fail',
        icon: <ShieldAlert size={14} />,
        state:
          normalized === 'FAILED'
            ? 'current'
            : ['CREATED', 'CONFIRMING'].includes(normalized)
              ? 'available'
              : 'readonly',
        tone: 'danger',
        onClick:
          ['CREATED', 'CONFIRMING'].includes(normalized)
            ? () => handleUpdateAction('FAIL')
            : undefined,
        disabled: updating,
        helperText: '失败后走 canonical compensation',
      },
      {
        id: 'return',
        label: 'Return',
        icon: <Activity size={14} />,
        state:
          normalized === 'RETURNED'
            ? 'current'
            : normalized === 'CONFIRMED'
              ? 'available'
              : 'readonly',
        tone: 'warning',
        onClick: normalized === 'CONFIRMED' ? () => handleUpdateAction('RETURN') : undefined,
        disabled: updating,
        helperText: '退回后走 canonical compensation',
      },
    ];
  };

  const renderStatusBadge = (
    status: string,
    displayStatus?: string | null,
  ) => {
    const normalizedDisplayStatus = normalizeRailDisplayStatus(
      displayStatus || status,
    );
    const colors: Record<string, string> = {
      CREATED: 'bg-gray-100 text-gray-800',
      SIGNING: 'bg-indigo-100 text-indigo-800',
      BROADCASTED: 'bg-blue-100 text-blue-800',
      CONFIRMING: 'bg-yellow-100 text-yellow-800',
      CONFIRMED: 'bg-green-100 text-green-800',
      CLEARED: 'bg-emerald-100 text-emerald-800',
      FAILED: 'bg-red-100 text-red-800',
      TIMEOUT: 'bg-orange-100 text-orange-800',
      RETURNED: 'bg-purple-100 text-purple-800',
    };
    return (
      <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${colors[normalizedDisplayStatus] || 'bg-gray-100 text-gray-800'}`}>
        {formatRailStatusLabel(normalizedDisplayStatus)}
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
  const ownerNo = data.ownerNo || data.customer?.customerNo || 'N/A';
  const canRepairCloseout =
    data.status === 'CONFIRMED' && data.withdraw?.status === 'PAYOUT_PENDING';
  const canRepairCompensation =
    ((data.status === 'FAILED' || data.status === 'TIMEOUT') &&
      data.withdraw?.status === 'PAYOUT_PENDING') ||
    (data.status === 'RETURNED' && data.withdraw?.status === 'SUCCESS');
  const payoutRailItems = getPayoutRailItems(data);

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
              {renderStatusBadge(data.status, data.displayStatus)}
            </div>
            <div className="flex items-center gap-4 mt-1 text-sm text-gray-500 font-mono">
              <span className="text-brand-primary font-bold">No: {data.payoutNo || data.id}</span>
              <span className="flex items-center gap-1"><Clock size={14}/> Created: {new Date(data.createdAt).toLocaleString()}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {canRepairCloseout ? (
            <button
              onClick={handleReCloseout}
              disabled={updating}
              className="px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition-colors disabled:opacity-50 bg-slate-900 hover:bg-slate-800 text-white"
            >
              Re-run Closeout
            </button>
          ) : null}
          {canRepairCompensation ? (
            <button
              onClick={handleReCompensate}
              disabled={updating}
              className="px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition-colors disabled:opacity-50 bg-red-700 hover:bg-red-800 text-white"
            >
              Re-run Compensation
            </button>
          ) : null}
        </div>
      </div>

      {data.status === 'CONFIRMED' ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-900">
          <div className="font-semibold">Receipt recorded</div>
          <div className="mt-1">
            This payout has already reached `CONFIRMED`. `CLEAR` must be written by system canonical closeout after withdraw success posting.
          </div>
          {canRepairCloseout ? (
            <div className="mt-1 text-blue-800">
              The linked withdraw is still `PAYOUT_PENDING`. Use `Re-run Closeout` only to retry the canonical closeout path.
            </div>
          ) : null}
        </div>
      ) : null}

      {(data.status === 'FAILED' || data.status === 'TIMEOUT' || data.status === 'RETURNED') ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900">
          <div className="font-semibold">Terminal payout compensation</div>
          <div className="mt-1">
            Terminal payout outcomes must back-propagate through canonical withdraw compensation. Do not manually mutate withdraw terminal status from admin surfaces.
          </div>
          {canRepairCompensation ? (
            <div className="mt-1 text-red-800">
              The linked withdraw is still waiting for canonical compensation closeout. Use `Re-run Compensation` only to retry the system compensation path.
            </div>
          ) : null}
        </div>
      ) : null}

      {simulationModeEnabled ? (
        <div className="space-y-3">
          {formatTransactionTypeLabel(data.type) === 'FIAT' ? (
            <div className="rounded-xl border border-admin-border bg-white p-4">
              <div className="text-sm font-semibold text-gray-900">FIAT Receipt Reference</div>
              <p className="mt-1 text-xs text-gray-500">
                `SUBMIT` 可预填；若留空，系统会在 `CONFIRM` 时自动生成 `Reference No`。
              </p>
              <div className="mt-3">
                <input
                  type="text"
                  value={referenceNoDraft}
                  onChange={(event) => setReferenceNoDraft(event.target.value)}
                  placeholder="Enter bank reference no"
                  className="w-full rounded-lg border border-admin-border px-3 py-2 text-sm focus:outline-none focus:border-brand-primary"
                />
              </div>
            </div>
          ) : null}
          <SimulationRail
            title="Payout Execution Rail"
            description="Payout 是 outbound execution rail。参考 Payin 的 rail 逐步推进，Cleared 只做结果回显。"
            items={payoutRailItems}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        {/* 1. Basic Identification */}
        <DetailCard title="Basic Identification" icon={<FileText size={18} />}>
            <InfoField label="Payout ID" value={data.id} source="main" />
            <InfoField label="Payout No" value={data.payoutNo} highlight source="main" />
            <InfoField label="Transaction Type" value={data.transactionType || 'WITHDRAW'} source="main" />
            <InfoField label="Transaction ID" value={data.transactionId || data.withdrawId} source="main" />
            <InfoField label="Transaction No" value={data.transactionNo || data.withdraw.withdrawNo}
                       link={`/exchange/withdraw-transactions/${data.withdrawId}`}
                       source="main" />
            <InfoField label="Owner ID" value={data.withdraw.ownerId} icon={<User size={14}/>} source="main" />
            <InfoField label="Owner Name" value={ownerName} source="main" />
            <InfoField label="Owner No" value={ownerNo} source="main" />
            <InfoField label="Type" value={formatTransactionTypeLabel(data.type)} source="main" />
        </DetailCard>

        {/* 2. Assets & Amount */}
        <DetailCard title="Assets & Amount" icon={<CreditCard size={18} />}>
            <InfoField label="Asset ID" value={data.assetId} source="main" />
            <InfoField label="Asset Code" value={data.asset.code} highlight source="main" />
            <InfoField label="Asset Network" value={data.asset.network} source="main" />
            <InfoField label="Amount" value={formatAssetAmount(data.amount, data.asset?.decimals)} highlight source="main" />
        </DetailCard>

        {/* 3. Settlement Endpoint / Path */}
        <DetailCard title="Settlement Endpoint / Path" icon={<MapPin size={18} />}>
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

        {/* 4. Settlement Evidence */}
        <DetailCard title="Settlement Evidence" icon={<Activity size={18} />}>
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

        {/* 5. Status & Timings */}
        <DetailCard title="Status & Timings" icon={<Clock size={18} />}>
             <InfoField label="Current Status" value={formatRailStatusLabel(data.displayStatus || data.status)} highlight source="main" />
             <InfoField label="Created At" value={new Date(data.createdAt).toLocaleString()} source="main" />
             <InfoField label="Sent At" value={data.sentAt ? new Date(data.sentAt).toLocaleString() : 'N/A'} source="main" />
             <InfoField label="Completed At" value={data.completedAt ? new Date(data.completedAt).toLocaleString() : 'N/A'} source="main" />
             <InfoField label="Updated At" value={new Date(data.updatedAt).toLocaleString()} source="main" />
        </DetailCard>

        {/* 7. Clearing & Settlement Info - HIDDEN */}
        {/* Clearing section removed as per requirement */}

        {/* 6. Status History & Audit */}
        <DetailCard title="Status History & Audit" icon={<Activity size={18} />} columns={1}>
             {data.statusHistory ? <StatusTimeline historyJson={data.statusHistory} /> : null}
             <AuditEventList events={data.auditLogs} />
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
                    <a href={link} target={link.startsWith('/') ? undefined : "_blank"} rel={link.startsWith('/') ? undefined : "noopener noreferrer"} className="text-blue-600 hover:underline flex items-center gap-1">
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
                                    {formatRailStatusLabel(item.status)}
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
    module?: string | null;
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
                {event.statusFrom || event.oldStatus ? `From: ${formatRailStatusLabel(event.statusFrom || event.oldStatus)}` : 'From: N/A'}
                {'  '}
                {event.statusTo || event.newStatus ? `To: ${formatRailStatusLabel(event.statusTo || event.newStatus)}` : 'To: N/A'}
              </div>
              <div className="text-sm text-gray-600">
                {event.reason || 'No reason provided'}
              </div>
              <div className="text-xs text-gray-400">
                {(event.actorType || 'SYSTEM')}: {event.actorId || event.operatorId || 'SYSTEM'}
                {event.module ? ` · ${event.module}` : ''}
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
