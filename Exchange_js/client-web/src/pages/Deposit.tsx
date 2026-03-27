import { useState, useEffect } from 'react';
import { Copy, RefreshCw, Check, Wallet, Building2, Info, AlertTriangle, History, X, Filter, ShieldCheck, Clock } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../context/AuthContext';
import { formatAssetAmount } from '../utils/number-format';
import { useSimulationMode } from '../utils/simulationMode';

interface Asset {
  id: string;
  code: string;
  type: string;
  network: string | null;
  decimals?: number;
}

interface WalletItem {
  id: string;
  assetId: string;
  type: string;
  direction: string;
  walletRole?: string;
  asset: { code: string; type: string; decimals?: number };
  address?: string;
  memo?: string;
  bankName?: string;
  bankAccount?: string;
  iban?: string;
  accountName?: string;
  bankCode?: string;
}

interface Transaction {
    id: string;
    depositNo: string;
    status: string;
    amount: string;
    createdAt: string;
    completedAt: string | null;
    asset: {
        code: string;
        network: string | null;
        decimals?: number;
    };
    txHash: string | null;
    referenceNo: string | null;
    fromAddress: string | null;
    fromIban: string | null;
}

interface ScanInboundSignalsResult {
  scannedCount: number;
  createdPayinCount: number;
  reusedPayinCount: number;
  blockedCount: number;
  failedCount: number;
  depositIds: string[];
  records: Array<{
    signalId: string;
    signalNo: string;
    payinId: string | null;
    payinNo: string | null;
    payinStatus: string | null;
    depositId: string | null;
    depositNo: string | null;
    depositStatus: string | null;
  }>;
}

interface SimulationFeedback {
  kind: 'success' | 'error';
  message: string;
}

interface SimulationResultSummary {
  signalNo: string | null;
  payinNo: string | null;
  payinStatus: string | null;
  depositNo: string | null;
  depositStatus: string | null;
  assetCode: string;
  assetType: DepositAssetType;
}

interface CreatedInboundSignalResponse {
  signalNo?: string | null;
  payin?: {
    payinNo?: string | null;
    status?: string | null;
    deposit?: {
      depositNo?: string | null;
      status?: string | null;
    } | null;
  } | null;
}

type DepositAssetType = 'CRYPTO' | 'FIAT';

interface CreateInboundTransferSignalPayload {
  walletId: string;
  amount: string;
  txHash?: string;
  fromAddress?: string;
  referenceNo?: string;
  fromIban?: string;
}

const normalizeSimulationAssetType = (
  assetType: string | null | undefined,
): DepositAssetType => (assetType === 'FIAT' ? 'FIAT' : 'CRYPTO');

const Deposit = () => {
  const { user } = useAuth();
  const { enabled: simulationModeEnabled } = useSimulationMode();
  const [activeTab, setActiveTab] = useState<'crypto' | 'fiat' | 'history'>('crypto');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [depositWallet, setDepositWallet] = useState<WalletItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  
  const [historyStatus, setHistoryStatus] = useState('');
  const [historyAssetId, setHistoryAssetId] = useState('');
  const [simulatingSignal, setSimulatingSignal] = useState(false);
  const [showSimulateModal, setShowSimulateModal] = useState(false);
  const [signalAmount, setSignalAmount] = useState('');
  const [signalFeedback, setSignalFeedback] = useState<SimulationFeedback | null>(null);
  const [lastSimulationResult, setLastSimulationResult] = useState<SimulationResultSummary | null>(null);

  useEffect(() => {
    const fetchAssets = async () => {
      try {
        const token = localStorage.getItem('customer_token');
        const response = await fetch(`${import.meta.env.VITE_API_URL}/assets?status=ACTIVE`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const data = await response.json();
          setAssets(data.items || []);
        }
      } catch (error) {
        console.error('Failed to fetch assets', error);
      }
    };
    fetchAssets();
  }, []);

  useEffect(() => {
    if (!selectedAssetId || !user || activeTab === 'history') {
      setDepositWallet(null);
      return;
    }

    const fetchWallet = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('customer_token');
        const params = new URLSearchParams({
          ownerType: 'CUSTOMER',
          ownerId: user.id,
          direction: 'INBOUND',
          walletRole: 'DEPOSIT',
          assetId: selectedAssetId,
        });
        const response = await fetch(`${import.meta.env.VITE_API_URL}/wallets?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            const data = await response.json();
            const items: WalletItem[] = data.items || [];
            const found = items.find(w => 
                w.assetId === selectedAssetId &&
                (w.type === 'CRYPTO_ADDRESS' || w.type === 'FIAT_BANK') &&
                w.direction === 'INBOUND' &&
                w.walletRole === 'DEPOSIT'
            );
            setDepositWallet(found || null);
        }
      } catch (error) {
        console.error('Failed to fetch wallet', error);
      } finally {
        setLoading(false);
      }
    };

    fetchWallet();
  }, [selectedAssetId, user, assets, activeTab]);

  useEffect(() => {
      if (activeTab === 'history' && user) {
          fetchHistory();
      }
  }, [activeTab, page, historyStatus, historyAssetId, user]);

  useEffect(() => {
    setSignalFeedback(null);
    setLastSimulationResult(null);
    setSignalAmount('');
    setShowSimulateModal(false);
  }, [selectedAssetId, activeTab, depositWallet?.id]);

  useEffect(() => {
    if (simulationModeEnabled) {
      return;
    }

    setShowSimulateModal(false);
    setSignalAmount('');
    setLastSimulationResult(null);
  }, [simulationModeEnabled]);

  const fetchHistory = async () => {
      setHistoryLoading(true);
      try {
          const token = localStorage.getItem('customer_token');
          const params = new URLSearchParams({
              skip: ((page - 1) * 10).toString(),
              take: '10',
          });
          if (historyStatus) params.append('status', historyStatus);
          if (historyAssetId) params.append('assetId', historyAssetId);

          const response = await fetch(`${import.meta.env.VITE_API_URL}/deposit-transactions/my?${params.toString()}`, {
              headers: { 'Authorization': `Bearer ${token}` }
          });

          if (response.ok) {
              const data = await response.json();
              setTransactions(data.items || []);
              setTotal(data.total || 0);
          }
      } catch (error) {
          console.error('Failed to fetch history', error);
      } finally {
          setHistoryLoading(false);
      }
  };

  const handleGenerate = async () => {
    if (!selectedAssetId || !user) return;
    setGenerating(true);
    try {
        const token = localStorage.getItem('customer_token');
        const payload = {
            ownerType: 'CUSTOMER',
            ownerId: user.id,
            direction: 'INBOUND',
            type: activeTab === 'crypto' ? 'CRYPTO_ADDRESS' : 'FIAT_BANK',
            assetId: selectedAssetId,
        };

        const response = await fetch(`${import.meta.env.VITE_API_URL}/wallets`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            const newWallet = await response.json();
            setDepositWallet(newWallet);
        } else {
            const err = await response.json();
            alert(err.message || 'Failed to generate address');
        }
    } catch (error) {
        console.error('Generation failed', error);
        alert('An unexpected error occurred');
    } finally {
        setGenerating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredAssets = assets.filter(a => 
    activeTab === 'crypto' ? a.type === 'CRYPTO' : a.type === 'FIAT'
  );
  const showSimulationDepositFlow = simulationModeEnabled;

  useEffect(() => {
    if (activeTab === 'history') {
      return;
    }

    if (
      selectedAssetId &&
      filteredAssets.some((asset) => asset.id === selectedAssetId)
    ) {
      return;
    }

    setSelectedAssetId(filteredAssets[0]?.id || '');
  }, [activeTab, filteredAssets, selectedAssetId]);

  const renderStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      CREATED: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      PAYIN_LINKED: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
      CONFIRMED: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
      COMPLIANCE_PENDING: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
      UNDER_REVIEW: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
      FROZEN: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
      HELD: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
      SUCCESS: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
      REJECTED: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
      FAILED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    };
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${colors[status] || 'bg-slate-100 text-slate-700'}`}>
        {status}
      </span>
    );
  };

  const buildHexMockValue = (seed: string, length: number) => {
    const sanitized = seed.toLowerCase().replace(/[^a-f0-9]/g, 'a') || 'abcd1234';
    return sanitized.repeat(Math.ceil(length / sanitized.length)).slice(0, length);
  };

  const buildMockInboundSignalPayload = (
    wallet: WalletItem,
    amount: string,
  ): CreateInboundTransferSignalPayload => {
    const rawSeed = `${wallet.id}-${wallet.asset.code}-${Date.now().toString(16)}-${Math.random()
      .toString(16)
      .slice(2, 10)}`;
    const compactSeed = rawSeed.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

    if (wallet.asset.type === 'CRYPTO') {
      const txSeed = buildHexMockValue(rawSeed, 64);
      const addressSeed = buildHexMockValue(`${rawSeed}-from`, 40);

      return {
        walletId: wallet.id,
        amount,
        txHash: `0x${txSeed}`,
        fromAddress: `0x${addressSeed}`,
      };
    }

    const ibanSeed = compactSeed.slice(-18).padStart(18, '7');
    const referenceSuffix = compactSeed.slice(-10).padStart(10, '7');

    return {
      walletId: wallet.id,
      amount,
      referenceNo: `REF-${wallet.asset.code}-${referenceSuffix}`,
      fromIban: `AE07MOCK${ibanSeed}`,
    };
  };

  const scanInboundSignals = async (walletId: string, token: string) => {
    const response = await fetch(
      `${import.meta.env.VITE_API_URL}/deposit-transactions/my/inbound-signals/scan`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ walletId, mode: 'INTERACTIVE' }),
      },
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to scan inbound signals');
    }

    return response.json() as Promise<ScanInboundSignalsResult>;
  };

  const handleSubmitInboundSignal = async () => {
    if (!depositWallet) return;

    const amount = signalAmount.trim();
    if (!amount) {
      setSignalFeedback({
        kind: 'error',
        message: 'Please enter an amount to simulate.',
      });
      return;
    }

    setSimulatingSignal(true);
    setSignalFeedback(null);
    setLastSimulationResult(null);
    try {
      const token = localStorage.getItem('customer_token');
      if (!token) {
        throw new Error('Customer session expired. Please log in again.');
      }
      const payload: CreateInboundTransferSignalPayload = {
        ...buildMockInboundSignalPayload(depositWallet, amount),
      };
      const createResponse = await fetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions/my/inbound-signals`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );

      if (!createResponse.ok) {
        const error = await createResponse.json();
        throw new Error(error.message || 'Failed to submit inbound signal');
      }

      const createdSignal =
        (await createResponse.json()) as CreatedInboundSignalResponse;
      const result = await scanInboundSignals(depositWallet.id, token || '');
      await fetchHistory();
      const firstRecord = result.records?.[0];
      const fallbackRecord = createdSignal?.payin
        ? {
            signalNo: createdSignal.signalNo || null,
            payinNo: createdSignal.payin.payinNo || null,
            payinStatus: createdSignal.payin.status || null,
            depositNo: createdSignal.payin.deposit?.depositNo || null,
            depositStatus: createdSignal.payin.deposit?.status || null,
          }
        : null;
      const resolvedRecord = firstRecord || fallbackRecord;
      if (!resolvedRecord) {
        throw new Error(
          `Inbound signal ${createdSignal?.signalNo || '-'} was created, but scan did not return a payin record.`,
        );
      }
      setLastSimulationResult({
        signalNo:
          createdSignal?.signalNo || resolvedRecord.signalNo || null,
        payinNo: resolvedRecord.payinNo || null,
        payinStatus: resolvedRecord.payinStatus || 'DETECTED',
        depositNo: resolvedRecord.depositNo || null,
        depositStatus: resolvedRecord.depositStatus || 'PAYIN_PENDING',
        assetCode: depositWallet.asset.code,
        assetType: normalizeSimulationAssetType(depositWallet.asset.type),
      });
      setSignalAmount('');
      setShowSimulateModal(false);
    } catch (error) {
      console.error('Failed to simulate inbound signal', error);
      setSignalFeedback({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Failed to simulate inbound signal',
      });
    } finally {
      setSimulatingSignal(false);
    }
  };

  const openHistoryWithReset = () => {
    setHistoryStatus('');
    setHistoryAssetId('');
    setPage(1);
    setActiveTab('history');
  };

  const renderSimulationFeedback = (feedback: SimulationFeedback) => {
    const tone =
      feedback.kind === 'error'
        ? 'border-red-100 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
        : 'border-emerald-100 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200';

    return (
      <div className={`rounded-xl border px-4 py-3 text-sm ${tone}`}>
        {feedback.message}
      </div>
    );
  };

  const renderSimulationResultSummary = (summary: SimulationResultSummary) => {
    const nextStepText =
      summary.assetType === 'FIAT'
        ? '下一步去 Admin 的 Payin Detail，用 Payin rail 点 FIAT_CONFIRMED；之后系统会进入 Final review / Alert / Case。'
        : '下一步去 Admin 的 Payin Detail，用 Payin rail 继续推进；随后再走 KYT / Travel Rule / Alert / Case。';

    return (
      <div className="rounded-2xl border border-emerald-100 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-900/20 p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h4 className="text-sm font-bold text-emerald-900 dark:text-emerald-100">
              Simulation Created
            </h4>
            <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">
              {summary.assetCode} 模拟充值已创建成功，下一步请去 Admin 继续推进。
            </p>
          </div>
          <button
            onClick={openHistoryWithReset}
            className="shrink-0 rounded-lg border border-emerald-200 dark:border-emerald-800 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100/70 dark:hover:bg-emerald-800/30 transition-colors"
          >
            查看历史
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl bg-white/70 dark:bg-slate-900/40 border border-emerald-100 dark:border-emerald-900/30 p-3">
            <div className="text-[11px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              Signal
            </div>
            <div className="mt-1 font-mono text-sm text-slate-900 dark:text-white">
              {summary.signalNo || '-'}
            </div>
          </div>
          <div className="rounded-xl bg-white/70 dark:bg-slate-900/40 border border-emerald-100 dark:border-emerald-900/30 p-3">
            <div className="text-[11px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              Payin
            </div>
            <div className="mt-1 font-mono text-sm text-slate-900 dark:text-white">
              {summary.payinNo || '-'}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Status: {summary.payinStatus || '-'}
            </div>
          </div>
          <div className="rounded-xl bg-white/70 dark:bg-slate-900/40 border border-emerald-100 dark:border-emerald-900/30 p-3 sm:col-span-2">
            <div className="text-[11px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              Deposit
            </div>
            <div className="mt-1 font-mono text-sm text-slate-900 dark:text-white">
              {summary.depositNo || '-'}
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Status: {summary.depositStatus || '-'}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-emerald-100 dark:border-emerald-900/30 bg-white/70 dark:bg-slate-900/40 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-100">
          {nextStepText}
        </div>
      </div>
    );
  };

  const renderSimulationDepositFlow = () => (
    <div className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
      <button
        onClick={() => {
          setSignalAmount('');
          setSignalFeedback(null);
          setShowSimulateModal(true);
        }}
        disabled={simulatingSignal}
        className="px-4 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-semibold hover:opacity-90 disabled:opacity-60 transition-all flex items-center gap-2"
      >
        {simulatingSignal ? <RefreshCw size={16} className="animate-spin" /> : null}
        {simulatingSignal ? 'Simulating...' : 'Simulate Deposit'}
      </button>

      {lastSimulationResult ? renderSimulationResultSummary(lastSimulationResult) : null}
    </div>
  );

  const renderInstructions = () => (
    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-2xl p-6 border border-blue-100 dark:border-blue-900/30 h-full sticky top-6">
        <div className="flex items-center gap-2 mb-4 text-blue-800 dark:text-blue-300">
            <div className="p-2 bg-blue-100 dark:bg-blue-800/30 rounded-lg">
                <Info size={24} />
            </div>
            <h3 className="font-bold text-lg">Instructions</h3>
        </div>
        
        {activeTab === 'crypto' ? (
            <div className="space-y-4">
                <div className="flex gap-3">
                    <ShieldCheck size={20} className="text-blue-600 dark:text-blue-400 shrink-0 mt-1" />
                    <div>
                        <h4 className="text-sm font-bold text-blue-900 dark:text-blue-100">Network Verification</h4>
                        <p className="text-xs text-blue-800/80 dark:text-blue-200/80 mt-1">
                            Ensure the deposit network matches the platform supported chain.
                        </p>
                    </div>
                </div>

                <div className="flex gap-3">
                    <Clock size={20} className="text-blue-600 dark:text-blue-400 shrink-0 mt-1" />
                    <div>
                        <h4 className="text-sm font-bold text-blue-900 dark:text-blue-100">Confirmation Time</h4>
                        <p className="text-xs text-blue-800/80 dark:text-blue-200/80 mt-1">
                            Requires <strong className="underline">1-3 network confirmations</strong>. Automatic processing after confirmation.
                        </p>
                    </div>
                </div>

                <div className="p-4 bg-white/60 dark:bg-gray-800/60 rounded-xl border border-blue-100 dark:border-blue-900/30 mt-2">
                    <div className="flex gap-2 items-start">
                        <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-[11px] font-bold text-amber-800 dark:text-amber-300 leading-relaxed">
                            Do not deposit any other assets to this address, otherwise your assets may be permanently lost.
                        </p>
                    </div>
                </div>
            </div>
        ) : (
            <div className="space-y-4">
                <div className="flex gap-3">
                    <Building2 size={20} className="text-blue-600 dark:text-blue-400 shrink-0 mt-1" />
                    <div>
                        <h4 className="text-sm font-bold text-blue-900 dark:text-blue-100">Account Name</h4>
                        <p className="text-xs text-blue-800/80 dark:text-blue-200/80 mt-1">
                            Please use a bank account under <strong className="underline">your own name</strong>.
                        </p>
                    </div>
                </div>

                <div className="flex gap-3">
                    <Clock size={20} className="text-blue-600 dark:text-blue-400 shrink-0 mt-1" />
                    <div>
                        <h4 className="text-sm font-bold text-blue-900 dark:text-blue-100">Processing Time</h4>
                        <p className="text-xs text-blue-800/80 dark:text-blue-200/80 mt-1">
                            Typically <strong className="underline">1-3 business days</strong> depending on bank speed.
                        </p>
                    </div>
                </div>

                <div className="p-4 bg-white/60 dark:bg-gray-800/60 rounded-xl border border-blue-100 dark:border-blue-900/30 mt-2">
                    <div className="flex gap-2 items-start">
                        <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-[11px] font-bold text-amber-800 dark:text-amber-300 leading-relaxed">
                            Transfers from third-party accounts may be rejected and refunded (fees may apply). Include Reference No. if applicable.
                        </p>
                    </div>
                </div>
            </div>
        )}
    </div>
  );

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Deposit</h1>
            <p className="text-gray-500 dark:text-gray-400 mt-1">Fund your account with Crypto or Fiat</p>
        </div>
      </div>

      {/* Main Card */}
      <div className="bg-white dark:bg-gray-800 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden min-h-[600px]">
        {/* Tabs */}
        <div className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
          <div className="flex overflow-x-auto px-6">
            <button
              onClick={() => setActiveTab('crypto')}
              className={`px-6 py-4 text-sm font-bold transition-colors border-b-[3px] flex-1 sm:flex-none justify-center whitespace-nowrap ${
                activeTab === 'crypto' 
                  ? 'border-blue-600 text-blue-600 bg-white dark:bg-gray-800' 
                  : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <Wallet size={18} />
                Crypto
              </div>
            </button>
            <button
              onClick={() => setActiveTab('fiat')}
              className={`px-6 py-4 text-sm font-bold transition-colors border-b-[3px] flex-1 sm:flex-none justify-center whitespace-nowrap ${
                activeTab === 'fiat' 
                  ? 'border-blue-600 text-blue-600 bg-white dark:bg-gray-800' 
                  : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <Building2 size={18} />
                Fiat
              </div>
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-6 py-4 text-sm font-bold transition-colors border-b-[3px] flex-1 sm:flex-none justify-center whitespace-nowrap ${
                activeTab === 'history' 
                  ? 'border-blue-600 text-blue-600 bg-white dark:bg-gray-800' 
                  : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <History size={18} />
                History
              </div>
            </button>
          </div>
        </div>

        {activeTab === 'history' ? (
            <div className="p-6 space-y-4">
                {/* Filters */}
                <div className="flex flex-wrap gap-3 mb-4">
                    <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900/50 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700">
                        <Filter size={16} className="text-slate-500 dark:text-slate-400" />
                        <select 
                          value={historyStatus}
                          onChange={(e) => setHistoryStatus(e.target.value)}
                          className="bg-transparent text-sm text-slate-700 dark:text-slate-200 focus:outline-none"
                        >
                            <option value="">All Status</option>
                            <option value="PAYIN_PENDING">Payin Pending</option>
                            <option value="COMPLIANCE_PENDING">Compliance Pending</option>
                            <option value="UNDER_REVIEW">Under Review</option>
                            <option value="SUCCESS">Success</option>
                            <option value="FROZEN">Frozen</option>
                            <option value="REJECTED">Rejected</option>
                            <option value="FAILED">Failed</option>
                        </select>
                    </div>
                    <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900/50 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700">
                        <Wallet size={16} className="text-slate-500 dark:text-slate-400" />
                        <select 
                          value={historyAssetId}
                          onChange={(e) => setHistoryAssetId(e.target.value)}
                          className="bg-transparent text-sm text-slate-700 dark:text-slate-200 focus:outline-none"
                        >
                            <option value="">All Assets</option>
                            {assets.map(a => (
                                <option key={a.id} value={a.id}>{a.code}</option>
                            ))}
                        </select>
                    </div>
                    <button 
                      onClick={fetchHistory}
                      className="p-2 text-slate-500 dark:text-slate-400 hover:text-brand-primary hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors ml-auto"
                      title="Refresh"
                    >
                        <RefreshCw size={18} className={historyLoading ? 'animate-spin' : ''} />
                    </button>
                </div>

                {/* Table */}
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
                            <tr>
                                <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400">Transaction No</th>
                                <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400">Time</th>
                                <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400">Asset / Amount</th>
                                <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400">Status</th>
                                <th className="px-4 py-3 font-medium text-slate-500 dark:text-slate-400 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                            {historyLoading && transactions.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                                        Loading transactions...
                                    </td>
                                </tr>
                            ) : transactions.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-12 text-center text-slate-500 dark:text-slate-400">
                                        <div className="flex flex-col items-center">
                                            <History size={32} className="text-slate-300 dark:text-slate-600 mb-2" />
                                            <p>No transactions found</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                transactions.map(tx => (
                                    <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                                        <td className="px-4 py-3">
                                            <div className="font-mono text-slate-900 dark:text-white">{tx.depositNo}</div>
                                            {tx.txHash && (
                                                <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[120px]" title={tx.txHash}>
                                                    Ref: {tx.txHash.substring(0, 8)}...
                                                </div>
                                            )}
                                            {tx.referenceNo && (
                                                <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[120px]" title={tx.referenceNo}>
                                                    Ref: {tx.referenceNo}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-slate-500 dark:text-slate-400 text-xs">
                                            <div>{new Date(tx.createdAt).toLocaleDateString()}</div>
                                            <div>{new Date(tx.createdAt).toLocaleTimeString()}</div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-slate-900 dark:text-white">
                                                {formatAssetAmount(tx.amount, tx.asset.decimals)} {tx.asset.code}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            {renderStatusBadge(tx.status)}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button 
                                              onClick={() => setSelectedTx(tx)}
                                              className="text-brand-primary hover:text-brand-primary/80 text-xs font-medium px-3 py-1.5 bg-brand-primary/10 rounded hover:bg-brand-primary/20 transition-colors"
                                            >
                                                Details
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="flex justify-between items-center pt-2 text-sm text-slate-500 dark:text-slate-400">
                    <div>
                        Showing {transactions.length} of {total} records
                    </div>
                    <div className="flex gap-2">
                        <button 
                          disabled={page === 1}
                          onClick={() => setPage(p => p - 1)}
                          className="px-3 py-1 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                        >
                            Previous
                        </button>
                        <button 
                          disabled={page * 10 >= total}
                          onClick={() => setPage(p => p + 1)}
                          className="px-3 py-1 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>
        ) : (
        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left: Main Operation */}
            <div className="lg:col-span-2 space-y-6">
              {/* Integrated Asset Selector */}
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Select Asset</label>
                <select
                  value={selectedAssetId}
                  onChange={(e) => setSelectedAssetId(e.target.value)}
                  className="w-full px-4 py-3 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:border-blue-500 bg-white dark:bg-slate-700 text-slate-900 dark:text-white"
                >
                  <option value="">Select a currency...</option>
                  {filteredAssets.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.code} {a.network ? `(${a.network})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {!selectedAssetId ? (
                <div className="text-center py-16 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                  <div className="w-16 h-16 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mb-4 text-slate-400 mx-auto">
                    {activeTab === 'crypto' ? <Wallet size={32} /> : <Building2 size={32} />}
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                    Select {activeTab === 'crypto' ? 'Asset' : 'Currency'}
                  </h3>
                  <p className="text-slate-500 dark:text-slate-400 mb-6 max-w-sm mx-auto">
                    Choose an asset above to view or generate your {activeTab === 'crypto' ? 'deposit address' : 'deposit vIBAN'}.
                  </p>
                </div>
              ) : loading ? (
                <div className="text-center py-16 text-slate-400">
                  <RefreshCw className="animate-spin mx-auto mb-2" size={24} />
                  Checking for existing address...
                </div>
              ) : depositWallet ? (
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-6 border border-slate-200 dark:border-slate-700">
                                <div className="flex justify-between items-start mb-6">
                                        <h3 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                            {activeTab === 'crypto' ? 'Deposit Address' : 'Deposit vIBAN'}
                                        </h3>
                                        <span className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-xs px-3 py-1 rounded-full font-bold">
                                            Active
                                        </span>
                                </div>

                                {activeTab === 'crypto' ? (
                                    <div className="space-y-6">
                                        <div className="flex justify-center bg-white dark:bg-white p-4 rounded-xl border border-slate-200 dark:border-slate-600 w-fit mx-auto">
                                                <QRCodeSVG 
                                                    value={depositWallet.address || ''} 
                                                    size={180}
                                                    level="M"
                                                    includeMargin={true}
                                                />
                                        </div>
                                        <div className="text-center text-sm text-slate-500 dark:text-slate-400 font-medium">
                                            Scan to deposit {depositWallet.asset.code}
                                        </div>

                                        <div>
                                            <label className="text-xs text-slate-500 dark:text-slate-400 font-medium block mb-1">Wallet Address</label>
                                            <div className="flex items-center justify-between bg-white dark:bg-slate-700 p-3 rounded-xl border border-slate-200 dark:border-slate-600">
                                                <code className="text-sm font-mono text-slate-900 dark:text-white break-all">{depositWallet.address}</code>
                                                <button 
                                                        onClick={() => copyToClipboard(depositWallet.address || '')}
                                                        className="ml-3 p-2 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors shrink-0"
                                                >
                                                    {copied ? <Check size={20} className="text-emerald-500" /> : <Copy size={20} />}
                                                </button>
                                            </div>
                                        </div>
                                        {depositWallet.memo && (
                                            <div>
                                                <label className="text-xs text-slate-500 dark:text-slate-400 font-medium block mb-1">Memo / Tag</label>
                                                <div className="flex items-center justify-between bg-white dark:bg-slate-700 p-3 rounded-xl border border-slate-200 dark:border-slate-600">
                                                    <span className="font-mono text-sm text-slate-900 dark:text-white">{depositWallet.memo}</span>
                                                    <button 
                                                            onClick={() => copyToClipboard(depositWallet.memo || '')}
                                                            className="ml-3 p-2 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 shrink-0"
                                                    >
                                                        <Copy size={16} />
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {showSimulationDepositFlow ? renderSimulationDepositFlow() : null}
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="bg-white dark:bg-slate-700 p-4 rounded-xl border border-slate-200 dark:border-slate-600 space-y-4">
                                            <div>
                                                <label className="text-xs text-slate-500 dark:text-slate-400 font-medium block mb-1">Account Holder</label>
                                                <div className="font-semibold text-slate-900 dark:text-white">{depositWallet.accountName || 'FiatX User'}</div>
                                            </div>
                                            <div>
                                                <label className="text-xs text-slate-500 dark:text-slate-400 font-medium block mb-1">Bank Name</label>
                                                <div className="font-semibold text-slate-900 dark:text-white">{depositWallet.bankName}</div>
                                            </div>
                                            <div>
                                                <label className="text-xs text-slate-500 dark:text-slate-400 font-medium block mb-1">IBAN</label>
                                                <div className="flex items-center justify-between">
                                                        <code className="text-lg font-mono text-slate-900 dark:text-white break-all">{depositWallet.iban}</code>
                                                        <button 
                                                            onClick={() => copyToClipboard(depositWallet.iban || '')}
                                                            className="ml-2 p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 shrink-0"
                                                        >
                                                            {copied ? <Check size={18} className="text-emerald-500" /> : <Copy size={18} />}
                                                        </button>
                                                </div>
                                            </div>
                                            {depositWallet.bankCode && (
                                                <div>
                                                    <label className="text-xs text-slate-500 dark:text-slate-400 font-medium block mb-1">SWIFT / BIC</label>
                                                    <div className="font-mono text-slate-900 dark:text-white">{depositWallet.bankCode}</div>
                                                </div>
                                            )}
                                        </div>
                                        {showSimulationDepositFlow ? renderSimulationDepositFlow() : null}
                                    </div>
                                )}
                                </div>
                            ) : (
                                <div className="text-center py-16 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                                    <div className="w-16 h-16 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center mb-4 text-slate-400 mx-auto">
                                        {activeTab === 'crypto' ? <Wallet size={32} /> : <Building2 size={32} />}
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">
                                        No {activeTab === 'crypto' ? 'Address' : 'vIBAN'} Generated
                                    </h3>
                                    <p className="text-slate-500 dark:text-slate-400 mb-6 max-w-sm mx-auto">
                                        Generate a dedicated {activeTab === 'crypto' ? 'deposit address' : 'deposit vIBAN'} whenever you need to fund your account.
                                    </p>
                                    <button
                                        onClick={handleGenerate}
                                        disabled={generating}
                                        className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-bold hover:shadow-lg hover:shadow-blue-500/30 transition-all flex items-center gap-2 mx-auto"
                                    >
                                        {generating ? <RefreshCw className="animate-spin" size={20} /> : null}
                                        {generating ? 'Generating...' : `Generate ${activeTab === 'crypto' ? 'Address' : 'vIBAN'}`}
                                    </button>
                                </div>
                            )}
                            
                        </div>

                        {/* Right: Instructions */}
                        <div className="lg:col-span-1">
                            {renderInstructions()}
                        </div>
                    </div>
                </div>
            )}
      </div>

      {showSimulationDepositFlow && showSimulateModal && depositWallet && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-700">
            <div className="flex justify-between items-center p-5 border-b border-slate-200 dark:border-slate-700">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Simulate Deposit</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Enter an amount for the mock {depositWallet.asset.type === 'CRYPTO' ? 'crypto' : 'fiat'} deposit. Final risk simulation now happens in Admin Risk Policy Executions.
                </p>
              </div>
              <button
                onClick={() => setShowSimulateModal(false)}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-400 dark:text-slate-500"
                disabled={simulatingSignal}
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {signalFeedback ? renderSimulationFeedback(signalFeedback) : null}

              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-4 space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-500 dark:text-slate-400">Asset</span>
                  <span className="font-semibold text-slate-900 dark:text-white">{depositWallet.asset.code}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-500 dark:text-slate-400">Wallet</span>
                  <span className="font-mono text-xs text-slate-900 dark:text-white text-right break-all">
                    {depositWallet.asset.type === 'CRYPTO' ? depositWallet.address : depositWallet.iban}
                  </span>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-500 dark:text-slate-400 font-medium block mb-1">Amount</label>
                <input
                  value={signalAmount}
                  onChange={(e) => setSignalAmount(e.target.value)}
                  placeholder="100.00"
                  autoFocus
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-600 rounded-xl bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-4 text-sm text-slate-600 dark:text-slate-300">
                This step only submits the mock inbound signal. After the payin/deposit is created, use Admin Risk Policy Executions to simulate Low, Medium, or High risk.
              </div>
            </div>

            <div className="p-5 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex gap-3">
              <button
                onClick={() => {
                  setSignalAmount('');
                  setShowSimulateModal(false);
                }}
                disabled={simulatingSignal}
                className="flex-1 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitInboundSignal}
                disabled={simulatingSignal}
                className="flex-1 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-xl hover:shadow-lg hover:shadow-blue-500/20 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {simulatingSignal ? <RefreshCw size={16} className="animate-spin" /> : null}
                {simulatingSignal ? 'Simulating...' : 'Confirm Simulation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Details Modal */}
      {selectedTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center p-6 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">Transaction Details</h3>
                    <button 
                        onClick={() => setSelectedTx(null)}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors text-slate-400 dark:text-slate-500"
                    >
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 space-y-6">
                    <div className="text-center">
                        <div className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                            {formatAssetAmount(selectedTx.amount, selectedTx.asset.decimals)} <span className="text-slate-500 dark:text-slate-400 text-xl">{selectedTx.asset.code}</span>
                        </div>
                        <div className="mt-2">
                             {renderStatusBadge(selectedTx.status)}
                        </div>
                    </div>

                    <div className="space-y-3 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-500 dark:text-slate-400">Transaction No</span>
                            <span className="font-mono font-semibold text-slate-900 dark:text-white">{selectedTx.depositNo}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-500 dark:text-slate-400">Date</span>
                            <span className="font-semibold text-slate-900 dark:text-white">{new Date(selectedTx.createdAt).toLocaleString()}</span>
                        </div>
                        {selectedTx.completedAt && (
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500 dark:text-slate-400">Completed</span>
                                <span className="font-semibold text-slate-900 dark:text-white">{new Date(selectedTx.completedAt).toLocaleString()}</span>
                            </div>
                        )}
                    </div>

                    <div className="space-y-4">
                        <h4 className="font-bold text-sm uppercase tracking-wider text-slate-500 dark:text-slate-400">Source Details</h4>
                        {selectedTx.fromAddress && (
                            <div>
                                <label className="text-xs text-slate-500 dark:text-slate-400 font-medium block mb-1">From Address</label>
                                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded text-sm font-mono break-all border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white">
                                    {selectedTx.fromAddress}
                                </div>
                            </div>
                        )}
                        {selectedTx.txHash && (
                            <div>
                                <label className="text-xs text-slate-500 dark:text-slate-400 font-medium block mb-1">Transaction Hash</label>
                                <div className="bg-slate-50 dark:bg-slate-900/50 p-2 rounded text-sm font-mono break-all border border-slate-200 dark:border-slate-700 flex items-center justify-between text-slate-900 dark:text-white">
                                    <span>{selectedTx.txHash}</span>
                                    <button onClick={() => copyToClipboard(selectedTx.txHash!)} className="text-blue-600 dark:text-blue-400">
                                        <Copy size={14} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                <div className="p-6 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 rounded-b-2xl">
                    <button 
                        onClick={() => setSelectedTx(null)}
                        className="w-full py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default Deposit;
