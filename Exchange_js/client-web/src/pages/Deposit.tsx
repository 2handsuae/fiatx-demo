import { useState, useEffect } from 'react';
import { Copy, RefreshCw, Check, Wallet, Building2, Info, AlertTriangle, History, X, Filter, ShieldCheck, Clock } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../context/AuthContext';
import { formatAssetAmount } from '../utils/number-format';
import { useSimulationMode } from '../utils/simulationMode';
import {
  CustomerSessionError,
  customerFetch,
  getCustomerApiErrorMessage,
} from '../utils/customerFetch';

interface Asset {
  id: string;
  currency: string;
  code: string;
  type: string;
  network: string | null;
  decimals?: number;
}

interface WalletItem {
  id: string;
  assetId: string;
  type: string;
  walletRole?: string;
  status: string;
  asset: { code: string; type: string; decimals?: number };
  address?: string;
  bankName?: string;
  iban?: string;
  accountName?: string;
  memo?: string;
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
        currency: string;
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
        const response = await customerFetch(`${import.meta.env.VITE_API_URL}/assets?status=ACTIVE`);
        if (response.ok) {
          const data = await response.json();
          setAssets(data.items || []);
        }
      } catch (error) {
        if (error instanceof CustomerSessionError) return;
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
        const params = new URLSearchParams({
          ownerType: 'CUSTOMER',
          ownerId: user.id,
          walletRole: activeTab === 'crypto' ? 'C_DEP' : 'C_VIBAN',
          assetId: selectedAssetId,
        });
        const response = await customerFetch(
          `${import.meta.env.VITE_API_URL}/wallets?${params.toString()}`,
        );

        if (response.ok) {
            const data = await response.json();
            const items: WalletItem[] = data.items || [];
            const found = items.find(w =>
                w.assetId === selectedAssetId &&
                (w.walletRole === 'C_DEP' || w.walletRole === 'C_VIBAN')
            );
            setDepositWallet(found || null);
        }
      } catch (error) {
        if (error instanceof CustomerSessionError) return;
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
          const params = new URLSearchParams({
              skip: ((page - 1) * 10).toString(),
              take: '10',
          });
          if (historyStatus) params.append('status', historyStatus);
          if (historyAssetId) params.append('assetId', historyAssetId);

          const response = await customerFetch(
            `${import.meta.env.VITE_API_URL}/deposit-transactions/my?${params.toString()}`,
          );

          if (response.ok) {
              const data = await response.json();
              setTransactions(data.items || []);
              setTotal(data.total || 0);
          }
      } catch (error) {
          if (error instanceof CustomerSessionError) return;
          console.error('Failed to fetch history', error);
      } finally {
          setHistoryLoading(false);
      }
  };

  const handleGenerate = async () => {
    if (!selectedAssetId || !user) return;
    setGenerating(true);
    try {
        const response = await customerFetch(
            `${import.meta.env.VITE_API_URL}/client/deposit-wallets`,
            {
                method: 'POST',
                body: JSON.stringify({ assetId: selectedAssetId }),
            },
        );

        if (response.ok) {
            const newWallet = await response.json();
            setDepositWallet(newWallet);
        } else {
            alert(await getCustomerApiErrorMessage(response, 'Failed to generate address'));
        }
    } catch (error) {
        if (error instanceof CustomerSessionError) return;
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

  const getCustomerFacingStatus = (internalStatus: string): { label: string; color: string } => {
    switch (internalStatus) {
      case 'PAYIN_PENDING':
      case 'COMPLIANCE_PENDING':
      case 'ACTION_PENDING':
      case 'FROZEN':
        return { label: 'Processing', color: 'bg-blue-500/20 text-blue-400' };
      case 'SUCCESS':
        return { label: 'Completed', color: 'bg-fx-sage/20 text-fx-sage' };
      case 'REJECTED':
        return { label: 'Declined', color: 'bg-rose-500/20 text-rose-400' };
      case 'FAILED':
        return { label: 'Failed', color: 'bg-fx-rust/20 text-fx-rust' };
      case 'EXPIRED':
        return { label: 'Expired', color: 'bg-fx-dust/20 text-fx-dust' };
      case 'CONFISCATED':
        return { label: 'Contact Support', color: 'bg-rose-500/20 text-rose-400' };
      default:
        return { label: 'Processing', color: 'bg-fx-dust/20 text-fx-dust' };
    }
  };

  const renderStatusBadge = (status: string) => {
    const { label, color } = getCustomerFacingStatus(status);
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${color}`}>
        {label}
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

  const scanInboundSignals = async (walletId: string) => {
    const response = await customerFetch(
      `${import.meta.env.VITE_API_URL}/deposit-transactions/my/inbound-signals/scan`,
      {
        method: 'POST',
        body: JSON.stringify({ walletId, mode: 'INTERACTIVE' }),
      },
    );

    if (!response.ok) {
      throw new Error(await getCustomerApiErrorMessage(response, 'Failed to scan inbound signals'));
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
      const payload: CreateInboundTransferSignalPayload = {
        ...buildMockInboundSignalPayload(depositWallet, amount),
      };
      const createResponse = await customerFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions/my/inbound-signals`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      );

      if (!createResponse.ok) {
        throw new Error(
          await getCustomerApiErrorMessage(createResponse, 'Failed to submit inbound signal'),
        );
      }

      const createdSignal =
        (await createResponse.json()) as CreatedInboundSignalResponse;
      const result = await scanInboundSignals(depositWallet.id);
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
      if (error instanceof CustomerSessionError) return;
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
        ? 'border-fx-rust/30 bg-fx-rust/10 text-fx-rust'
        : 'border-fx-sage/30 bg-fx-sage/10 text-fx-sage';

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
      <div className="rounded-2xl border border-fx-sage/30 bg-fx-sage/10 p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h4 className="text-sm font-bold text-fx-sage">
              Simulation Created
            </h4>
            <p className="mt-1 text-sm text-fx-sage/80">
              {summary.assetCode} 模拟充值已创建成功，下一步请去 Admin 继续推进。
            </p>
          </div>
          <button
            onClick={openHistoryWithReset}
            className="shrink-0 rounded-lg border border-fx-sage/30 px-3 py-1.5 text-xs font-semibold text-fx-sage hover:bg-fx-sage/20 transition-colors"
          >
            查看历史
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl bg-fx-charcoal/50 border border-fx-sage/20 p-3">
            <div className="text-[11px] uppercase tracking-wide text-fx-sage/70">
              Signal
            </div>
            <div className="mt-1 font-mono text-sm text-fx-sand">
              {summary.signalNo || '-'}
            </div>
          </div>
          <div className="rounded-xl bg-fx-charcoal/50 border border-fx-sage/20 p-3">
            <div className="text-[11px] uppercase tracking-wide text-fx-sage/70">
              Payin
            </div>
            <div className="mt-1 font-mono text-sm text-fx-sand">
              {summary.payinNo || '-'}
            </div>
            <div className="mt-1 text-xs text-fx-dust">
              Status: {summary.payinStatus || '-'}
            </div>
          </div>
          <div className="rounded-xl bg-fx-charcoal/50 border border-fx-sage/20 p-3 sm:col-span-2">
            <div className="text-[11px] uppercase tracking-wide text-fx-sage/70">
              Deposit
            </div>
            <div className="mt-1 font-mono text-sm text-fx-sand">
              {summary.depositNo || '-'}
            </div>
            <div className="mt-1 text-xs text-fx-dust">
              Status: {summary.depositStatus || '-'}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-fx-sage/20 bg-fx-charcoal/50 px-4 py-3 text-sm text-fx-sage">
          {nextStepText}
        </div>
      </div>
    );
  };

  const renderSimulationDepositFlow = () => (
    <div className="pt-4 border-t border-fx-rule space-y-3">
      <button
        onClick={() => {
          setSignalAmount('');
          setSignalFeedback(null);
          setShowSimulateModal(true);
        }}
        disabled={simulatingSignal}
        className="px-4 py-2.5 bg-fx-brass text-fx-obsidian rounded-xl font-semibold hover:opacity-90 disabled:opacity-60 transition-all flex items-center gap-2"
      >
        {simulatingSignal ? <RefreshCw size={16} className="animate-spin" /> : null}
        {simulatingSignal ? 'Simulating...' : 'Simulate Deposit'}
      </button>

      {lastSimulationResult ? renderSimulationResultSummary(lastSimulationResult) : null}
    </div>
  );

  const renderInstructions = () => (
    <div className="bg-fx-ink/60 rounded-2xl p-6 border border-fx-rule h-full sticky top-6">
        <div className="flex items-center gap-2 mb-4 text-fx-brass">
            <div className="p-2 bg-fx-charcoal rounded-lg">
                <Info size={24} />
            </div>
            <h3 className="font-bold text-lg">Instructions</h3>
        </div>

        {activeTab === 'crypto' ? (
            <div className="space-y-4">
                <div className="flex gap-3">
                    <ShieldCheck size={20} className="text-fx-brass shrink-0 mt-1" />
                    <div>
                        <h4 className="text-sm font-bold text-fx-sand">Network Verification</h4>
                        <p className="text-xs text-fx-dune mt-1">
                            Ensure the deposit network matches the platform supported chain.
                        </p>
                    </div>
                </div>

                <div className="flex gap-3">
                    <Clock size={20} className="text-fx-brass shrink-0 mt-1" />
                    <div>
                        <h4 className="text-sm font-bold text-fx-sand">Confirmation Time</h4>
                        <p className="text-xs text-fx-dune mt-1">
                            Requires <strong className="underline text-fx-sand">1-3 network confirmations</strong>. Automatic processing after confirmation.
                        </p>
                    </div>
                </div>

                <div className="p-4 bg-fx-charcoal/60 rounded-xl border border-fx-rule mt-2">
                    <div className="flex gap-2 items-start">
                        <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-[11px] font-bold text-amber-400 leading-relaxed">
                            Do not deposit any other assets to this address, otherwise your assets may be permanently lost.
                        </p>
                    </div>
                </div>
            </div>
        ) : (
            <div className="space-y-4">
                <div className="flex gap-3">
                    <Building2 size={20} className="text-fx-brass shrink-0 mt-1" />
                    <div>
                        <h4 className="text-sm font-bold text-fx-sand">Account Name</h4>
                        <p className="text-xs text-fx-dune mt-1">
                            Please use a bank account under <strong className="underline text-fx-sand">your own name</strong>.
                        </p>
                    </div>
                </div>

                <div className="flex gap-3">
                    <Clock size={20} className="text-fx-brass shrink-0 mt-1" />
                    <div>
                        <h4 className="text-sm font-bold text-fx-sand">Processing Time</h4>
                        <p className="text-xs text-fx-dune mt-1">
                            Typically <strong className="underline text-fx-sand">1-3 business days</strong> depending on bank speed.
                        </p>
                    </div>
                </div>

                <div className="p-4 bg-fx-charcoal/60 rounded-xl border border-fx-rule mt-2">
                    <div className="flex gap-2 items-start">
                        <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-[11px] font-bold text-amber-400 leading-relaxed">
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
            <h1 className="text-2xl font-bold text-fx-sand">Deposit</h1>
            <p className="text-fx-dune mt-1">Fund your account with Crypto or Fiat</p>
        </div>
      </div>

      {/* Main Card */}
      <div className="bg-fx-ink/40 rounded-3xl border border-fx-rule shadow-sm overflow-hidden min-h-[600px]">
        {/* Tabs */}
        <div className="border-b border-fx-rule bg-fx-charcoal/50">
          <div className="flex overflow-x-auto px-6">
            <button
              onClick={() => setActiveTab('crypto')}
              className={`px-6 py-4 text-sm font-bold transition-colors border-b-[3px] flex-1 sm:flex-none justify-center whitespace-nowrap ${
                activeTab === 'crypto'
                  ? 'border-fx-brass text-fx-brass bg-fx-ink/40'
                  : 'border-transparent text-fx-dust hover:text-fx-dune'
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
                  ? 'border-fx-brass text-fx-brass bg-fx-ink/40'
                  : 'border-transparent text-fx-dust hover:text-fx-dune'
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
                  ? 'border-fx-brass text-fx-brass bg-fx-ink/40'
                  : 'border-transparent text-fx-dust hover:text-fx-dune'
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
                    <div className="flex items-center gap-2 bg-fx-charcoal/50 px-3 py-2 rounded-lg border border-fx-rule">
                        <Filter size={16} className="text-fx-dust" />
                        <select
                          value={historyStatus}
                          onChange={(e) => setHistoryStatus(e.target.value)}
                          className="bg-transparent text-sm text-fx-sand focus:outline-none"
                        >
                            <option value="">All Status</option>
                            <option value="PAYIN_PENDING">Processing</option>
                            <option value="SUCCESS">Completed</option>
                            <option value="REJECTED">Declined</option>
                            <option value="FAILED">Failed</option>
                            <option value="EXPIRED">Expired</option>
                        </select>
                    </div>
                    <div className="flex items-center gap-2 bg-fx-charcoal/50 px-3 py-2 rounded-lg border border-fx-rule">
                        <Wallet size={16} className="text-fx-dust" />
                        <select
                          value={historyAssetId}
                          onChange={(e) => setHistoryAssetId(e.target.value)}
                          className="bg-transparent text-sm text-fx-sand focus:outline-none"
                        >
                            <option value="">All Assets</option>
                            {assets.map(a => (
                                <option key={a.id} value={a.id}>{a.code}</option>
                            ))}
                        </select>
                    </div>
                    <button
                      onClick={fetchHistory}
                      className="p-2 text-fx-dust hover:text-fx-brass hover:bg-fx-charcoal/50 rounded-lg transition-colors ml-auto"
                      title="Refresh"
                    >
                        <RefreshCw size={18} className={historyLoading ? 'animate-spin' : ''} />
                    </button>
                </div>

                {/* Table */}
                <div className="overflow-x-auto rounded-lg border border-fx-rule">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-fx-charcoal/50 border-b border-fx-rule">
                            <tr>
                                <th className="px-4 py-3 font-medium text-fx-dust">Transaction No</th>
                                <th className="px-4 py-3 font-medium text-fx-dust">Time</th>
                                <th className="px-4 py-3 font-medium text-fx-dust">Asset / Amount</th>
                                <th className="px-4 py-3 font-medium text-fx-dust">Status</th>
                                <th className="px-4 py-3 font-medium text-fx-dust text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-fx-rule">
                            {historyLoading && transactions.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-fx-dust">
                                        Loading transactions...
                                    </td>
                                </tr>
                            ) : transactions.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-12 text-center text-fx-dust">
                                        <div className="flex flex-col items-center">
                                            <History size={32} className="text-fx-dust/50 mb-2" />
                                            <p>No transactions found</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                transactions.map(tx => (
                                    <tr key={tx.id} className="hover:bg-fx-shadow/50 transition-colors">
                                        <td className="px-4 py-3">
                                            <div className="font-mono text-fx-sand">{tx.depositNo}</div>
                                            {tx.txHash && (
                                                <div className="text-xs text-fx-dust truncate max-w-[120px]" title={tx.txHash}>
                                                    Ref: {tx.txHash.substring(0, 8)}...
                                                </div>
                                            )}
                                            {tx.referenceNo && (
                                                <div className="text-xs text-fx-dust truncate max-w-[120px]" title={tx.referenceNo}>
                                                    Ref: {tx.referenceNo}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-fx-dust text-xs">
                                            <div>{new Date(tx.createdAt).toLocaleDateString()}</div>
                                            <div>{new Date(tx.createdAt).toLocaleTimeString()}</div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="font-medium text-fx-sand">
                                                {formatAssetAmount(tx.amount, tx.asset.decimals)} {tx.asset.currency}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            {renderStatusBadge(tx.status)}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button
                                              onClick={() => setSelectedTx(tx)}
                                              className="text-fx-brass hover:text-fx-brass/80 text-xs font-medium px-3 py-1.5 bg-fx-brass/10 rounded hover:bg-fx-brass/20 transition-colors"
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
                <div className="flex justify-between items-center pt-2 text-sm text-fx-dust">
                    <div>
                        Showing {transactions.length} of {total} records
                    </div>
                    <div className="flex gap-2">
                        <button
                          disabled={page === 1}
                          onClick={() => setPage(p => p - 1)}
                          className="px-3 py-1 border border-fx-rule rounded text-fx-dune hover:bg-fx-charcoal/50 disabled:opacity-50"
                        >
                            Previous
                        </button>
                        <button
                          disabled={page * 10 >= total}
                          onClick={() => setPage(p => p + 1)}
                          className="px-3 py-1 border border-fx-rule rounded text-fx-dune hover:bg-fx-charcoal/50 disabled:opacity-50"
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
                <label className="block text-sm font-bold text-fx-dune mb-2">Select Asset</label>
                <select
                  value={selectedAssetId}
                  onChange={(e) => setSelectedAssetId(e.target.value)}
                  className="w-full px-4 py-3 border border-fx-rule rounded-xl focus:outline-none focus:border-fx-brass bg-fx-charcoal text-fx-sand"
                >
                  <option value="">Select a currency...</option>
                  {filteredAssets.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.code}
                    </option>
                  ))}
                </select>
              </div>

              {!selectedAssetId ? (
                <div className="text-center py-16 bg-fx-charcoal/30 rounded-2xl border border-dashed border-fx-rule">
                  <div className="w-16 h-16 bg-fx-charcoal rounded-full flex items-center justify-center mb-4 text-fx-dust mx-auto">
                    {activeTab === 'crypto' ? <Wallet size={32} /> : <Building2 size={32} />}
                  </div>
                  <h3 className="text-lg font-bold text-fx-sand mb-2">
                    Select {activeTab === 'crypto' ? 'Asset' : 'Currency'}
                  </h3>
                  <p className="text-fx-dust mb-6 max-w-sm mx-auto">
                    Choose an asset above to view or generate your {activeTab === 'crypto' ? 'deposit address' : 'deposit vIBAN'}.
                  </p>
                </div>
              ) : loading ? (
                <div className="text-center py-16 text-fx-dust">
                  <RefreshCw className="animate-spin mx-auto mb-2" size={24} />
                  Checking for existing address...
                </div>
              ) : depositWallet && depositWallet.status !== 'ACTIVE' ? (
                <div className="text-center py-16 bg-fx-charcoal/30 rounded-2xl border border-dashed border-amber-500/30">
                  <div className="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mb-4 mx-auto">
                    <AlertTriangle size={32} className="text-amber-400" />
                  </div>
                  <h3 className="text-lg font-bold text-fx-sand mb-2">
                    {activeTab === 'crypto' ? 'Deposit Address' : 'Deposit vIBAN'} Unavailable
                  </h3>
                  <p className="text-fx-dust mb-2 max-w-sm mx-auto">
                    Your {activeTab === 'crypto' ? 'deposit address' : 'vIBAN'} for this asset is currently <span className="font-semibold text-amber-400">{depositWallet.status.replace(/_/g, ' ')}</span>.
                  </p>
                  <p className="text-fx-dust text-sm max-w-sm mx-auto">
                    Please contact support if you need assistance.
                  </p>
                </div>
              ) : depositWallet ? (
                <div className="bg-fx-charcoal/50 rounded-2xl p-6 border border-fx-rule space-y-6">
                  <div className="flex justify-between items-start">
                    <h3 className="text-sm font-bold text-fx-dust uppercase tracking-wider">
                      {activeTab === 'crypto' ? 'Deposit Address' : 'Deposit vIBAN'}
                    </h3>
                    <span className="bg-fx-sage/20 text-fx-sage text-xs px-3 py-1 rounded-full font-bold">
                      Active
                    </span>
                  </div>

                  {activeTab === 'crypto' && depositWallet.address && (
                    <div className="flex justify-center bg-white p-4 rounded-xl border border-fx-rule w-fit mx-auto">
                      <QRCodeSVG value={depositWallet.address} size={160} level="M" includeMargin />
                    </div>
                  )}

                  <div className="bg-fx-ink/60 rounded-xl border border-fx-rule divide-y divide-fx-rule">
                    {activeTab === 'fiat' && (
                      <>
                        <div className="px-4 py-3">
                          <label className="text-xs text-fx-dust font-medium">Account Holder</label>
                          <div className="mt-0.5 text-sm font-semibold text-fx-sand">{depositWallet.accountName || 'FiatX User'}</div>
                        </div>
                        {depositWallet.bankName && (
                          <div className="px-4 py-3">
                            <label className="text-xs text-fx-dust font-medium">Bank Name</label>
                            <div className="mt-0.5 text-sm font-semibold text-fx-sand">{depositWallet.bankName}</div>
                          </div>
                        )}
                      </>
                    )}

                    <div className="px-4 py-3">
                      <label className="text-xs text-fx-dust font-medium">
                        {activeTab === 'crypto' ? 'Wallet Address' : 'IBAN'}
                      </label>
                      <div className="mt-0.5 flex items-center justify-between gap-3">
                        <code className="text-sm font-mono text-fx-sand break-all">
                          {activeTab === 'crypto' ? depositWallet.address : depositWallet.iban}
                        </code>
                        <button
                          onClick={() => copyToClipboard((activeTab === 'crypto' ? depositWallet.address : depositWallet.iban) || '')}
                          className="p-2 text-fx-dust hover:text-fx-brass transition-colors shrink-0"
                        >
                          {copied ? <Check size={18} className="text-fx-sage" /> : <Copy size={18} />}
                        </button>
                      </div>
                    </div>

                    {activeTab === 'crypto' && depositWallet.memo && (
                      <div className="px-4 py-3">
                        <label className="text-xs text-fx-dust font-medium">Memo / Tag</label>
                        <div className="mt-0.5 flex items-center justify-between gap-3">
                          <span className="text-sm font-mono text-fx-sand">{depositWallet.memo}</span>
                          <button
                            onClick={() => copyToClipboard(depositWallet.memo || '')}
                            className="p-2 text-fx-dust hover:text-fx-brass transition-colors shrink-0"
                          >
                            <Copy size={16} />
                          </button>
                        </div>
                      </div>
                    )}

                    {activeTab === 'fiat' && depositWallet.bankCode && (
                      <div className="px-4 py-3">
                        <label className="text-xs text-fx-dust font-medium">SWIFT / BIC</label>
                        <div className="mt-0.5 text-sm font-mono text-fx-sand">{depositWallet.bankCode}</div>
                      </div>
                    )}
                  </div>

                  {showSimulationDepositFlow ? renderSimulationDepositFlow() : null}
                </div>
                            ) : (
                                <div className="text-center py-16 bg-fx-charcoal/30 rounded-2xl border border-dashed border-fx-rule">
                                    <div className="w-16 h-16 bg-fx-charcoal rounded-full flex items-center justify-center mb-4 text-fx-dust mx-auto">
                                        {activeTab === 'crypto' ? <Wallet size={32} /> : <Building2 size={32} />}
                                    </div>
                                    <h3 className="text-lg font-bold text-fx-sand mb-2">
                                        No {activeTab === 'crypto' ? 'Address' : 'vIBAN'} Generated
                                    </h3>
                                    <p className="text-fx-dust mb-6 max-w-sm mx-auto">
                                        Generate a dedicated {activeTab === 'crypto' ? 'deposit address' : 'deposit vIBAN'} whenever you need to fund your account.
                                    </p>
                                    <button
                                        onClick={handleGenerate}
                                        disabled={generating}
                                        className="px-6 py-3 bg-fx-brass text-fx-obsidian rounded-xl font-bold hover:shadow-lg hover:shadow-fx-brass/30 transition-all flex items-center gap-2 mx-auto"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-fx-ink rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-fx-rule">
            <div className="flex justify-between items-center p-5 border-b border-fx-rule">
              <div>
                <h3 className="text-lg font-bold text-fx-sand">Simulate Deposit</h3>
                <p className="text-sm text-fx-dust mt-1">
                  Enter an amount for the mock {depositWallet.asset.type === 'CRYPTO' ? 'crypto' : 'fiat'} deposit. Final risk simulation now happens in Admin Risk Policy Executions.
                </p>
              </div>
              <button
                onClick={() => setShowSimulateModal(false)}
                className="p-2 hover:bg-fx-charcoal rounded-full transition-colors text-fx-dust"
                disabled={simulatingSignal}
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {signalFeedback ? renderSimulationFeedback(signalFeedback) : null}

              <div className="rounded-xl border border-fx-rule bg-fx-charcoal/50 p-4 space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-fx-dust">Asset</span>
                  <span className="font-semibold text-fx-sand">{depositWallet.asset.code}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-fx-dust">Wallet</span>
                  <span className="font-mono text-xs text-fx-sand text-right break-all">
                    {depositWallet.asset.type === 'CRYPTO' ? depositWallet.address : depositWallet.iban}
                  </span>
                </div>
              </div>

              <div>
                <label className="text-xs text-fx-dust font-medium block mb-1">Amount</label>
                <input
                  value={signalAmount}
                  onChange={(e) => setSignalAmount(e.target.value)}
                  placeholder="100.00"
                  autoFocus
                  className="w-full px-3 py-2 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand focus:outline-none focus:border-fx-brass"
                />
              </div>

              <div className="rounded-xl border border-fx-rule bg-fx-charcoal/50 p-4 text-sm text-fx-dune">
                This step only submits the mock inbound signal. After the payin/deposit is created, use Admin Risk Policy Executions to simulate Low, Medium, or High risk.
              </div>
            </div>

            <div className="p-5 border-t border-fx-rule bg-fx-charcoal/50 flex gap-3">
              <button
                onClick={() => {
                  setSignalAmount('');
                  setShowSimulateModal(false);
                }}
                disabled={simulatingSignal}
                className="flex-1 py-3 bg-fx-ink border border-fx-rule text-fx-dune font-semibold rounded-xl hover:bg-fx-charcoal transition-colors disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitInboundSignal}
                disabled={simulatingSignal}
                className="flex-1 py-3 bg-fx-brass text-fx-obsidian font-semibold rounded-xl hover:shadow-lg hover:shadow-fx-brass/20 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-fx-ink rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-fx-rule">
                <div className="flex justify-between items-center p-6 border-b border-fx-rule">
                    <h3 className="text-xl font-bold text-fx-sand">Transaction Details</h3>
                    <button
                        onClick={() => setSelectedTx(null)}
                        className="p-2 hover:bg-fx-charcoal rounded-full transition-colors text-fx-dust"
                    >
                        <X size={20} />
                    </button>
                </div>
                <div className="p-6 space-y-6">
                    <div className="text-center">
                        <div className="text-3xl font-bold text-fx-sand mb-2">
                            {formatAssetAmount(selectedTx.amount, selectedTx.asset.decimals)} <span className="text-fx-dust text-xl">{selectedTx.asset.currency}</span>
                        </div>
                        <div className="mt-2">
                             {renderStatusBadge(selectedTx.status)}
                        </div>
                    </div>

                    <div className="space-y-3 bg-fx-charcoal/50 p-4 rounded-xl border border-fx-rule">
                        <div className="flex justify-between text-sm">
                            <span className="text-fx-dust">Transaction No</span>
                            <span className="font-mono font-semibold text-fx-sand">{selectedTx.depositNo}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-fx-dust">Date</span>
                            <span className="font-semibold text-fx-sand">{new Date(selectedTx.createdAt).toLocaleString()}</span>
                        </div>
                        {selectedTx.completedAt && (
                            <div className="flex justify-between text-sm">
                                <span className="text-fx-dust">Completed</span>
                                <span className="font-semibold text-fx-sand">{new Date(selectedTx.completedAt).toLocaleString()}</span>
                            </div>
                        )}
                    </div>

                    <div className="space-y-4">
                        <h4 className="font-bold text-sm uppercase tracking-wider text-fx-dust">Source Details</h4>
                        {selectedTx.fromAddress && (
                            <div>
                                <label className="text-xs text-fx-dust font-medium block mb-1">From Address</label>
                                <div className="bg-fx-charcoal/50 p-2 rounded text-sm font-mono break-all border border-fx-rule text-fx-sand">
                                    {selectedTx.fromAddress}
                                </div>
                            </div>
                        )}
                        {selectedTx.txHash && (
                            <div>
                                <label className="text-xs text-fx-dust font-medium block mb-1">Transaction Hash</label>
                                <div className="bg-fx-charcoal/50 p-2 rounded text-sm font-mono break-all border border-fx-rule flex items-center justify-between text-fx-sand">
                                    <span>{selectedTx.txHash}</span>
                                    <button onClick={() => copyToClipboard(selectedTx.txHash!)} className="text-fx-brass">
                                        <Copy size={14} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                <div className="p-6 border-t border-fx-rule bg-fx-charcoal/50 rounded-b-2xl">
                    <button
                        onClick={() => setSelectedTx(null)}
                        className="w-full py-3 bg-fx-ink border border-fx-rule text-fx-dune font-bold rounded-xl hover:bg-fx-charcoal transition-colors"
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
