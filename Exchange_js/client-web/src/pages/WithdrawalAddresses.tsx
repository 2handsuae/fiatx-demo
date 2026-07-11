import { useEffect, useState, useCallback } from 'react';
import {
  Wallet,
  Building2,
  Plus,
  Clock,
  X,
  AlertCircle,
  Copy,
  Check,
  ChevronRight,
  ShieldCheck,
  ArrowLeft,
  RefreshCw,
  Landmark,
} from 'lucide-react';
import {
  customerFetch,
  CustomerSessionError,
  getCustomerApiErrorMessage,
} from '../utils/customerFetch';
import { useTradingReadiness } from '../hooks/useTradingReadiness';

const API = import.meta.env.VITE_API_URL;

/* ─── Types ────────────────────────────────────────────────── */

interface Asset {
  id: string;
  currency: string;
  code: string;
  type: string;
  network: string;
}

interface WithdrawalAddr {
  addressNo: string;
  address: string;
  addressType: string;
  network: string;
  status: string;
  label: string | null;
  beneficiaryName: string | null;
  memo: string | null;
  activatesAt: string;
  activatedAt: string | null;
  createdAt: string;
  counterpartyVaspName: string | null;
  ownershipDeclaredAt: string | null;
  asset: { code: string; network?: string };
  // Bank-specific fields
  iban: string | null;
  swiftBic: string | null;
  bankName: string | null;
}

type ActiveTab = 'crypto' | 'bank';

/* ─── Helpers ──────────────────────────────────────────────── */

function formatCountdown(activatesAt: string): string {
  const ms = Math.max(0, new Date(activatesAt).getTime() - Date.now());
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

function truncAddr(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function statusLabel(s: string): string {
  switch (s) {
    case 'PENDING_ACTIVATION': return 'Cooling';
    case 'ACTIVE':             return 'Active';
    case 'SUSPENDED':          return 'Suspended';
    case 'CANCELLED':          return 'Cancelled';
    case 'DEACTIVATED':        return 'Deactivated';
    default:                   return s;
  }
}

function statusColor(s: string): string {
  switch (s) {
    case 'PENDING_ACTIVATION': return 'bg-amber-500/15 text-amber-400';
    case 'ACTIVE':             return 'bg-fx-sage/15 text-fx-sage';
    case 'SUSPENDED':          return 'bg-rose-500/15 text-rose-400';
    case 'CANCELLED':          return 'bg-fx-dust/15 text-fx-dust';
    case 'DEACTIVATED':        return 'bg-fx-dust/15 text-fx-dust';
    default:                   return 'bg-fx-dust/15 text-fx-dust';
  }
}

function deactivateErrorMessage(code: string, fallback: string): string {
  switch (code) {
    case 'LAST_ACTIVE_FIAT_ADDRESS':
      return 'This is your only active bank withdrawal address. Add and activate another one before deactivating this.';
    case 'ADDRESS_HAS_INFLIGHT_WITHDRAWAL':
      return "This address has a withdrawal in progress and can't be deactivated yet.";
    case 'ADDRESS_NOT_ACTIVE':
      return 'This address is no longer active and cannot be deactivated.';
    case 'ADDRESS_NOT_FOUND':
      return 'This address could not be found.';
    default:
      return fallback;
  }
}

function maskIban(iban: string): string {
  const clean = iban.replace(/\s/g, '');
  if (clean.length <= 8) return clean;
  return `${clean.slice(0, 4)} •••• •••• ${clean.slice(-4)}`;
}

function formatIban(iban: string): string {
  const clean = iban.replace(/\s/g, '');
  return clean.replace(/(.{4})/g, '$1 ').trim();
}

/* ═══════════════════════════════════════════════════════════════
 *  Main Component
 * ═══════════════════════════════════════════════════════════════ */

export default function WithdrawalAddresses() {
  const { tradingReady, refetch: refetchTradingReadiness } = useTradingReadiness();
  const [activeTab, setActiveTab] = useState<ActiveTab>('crypto');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [fiatAssets, setFiatAssets] = useState<Asset[]>([]);
  const [addresses, setAddresses] = useState<WithdrawalAddr[]>([]);
  const [loading, setLoading] = useState(true);

  // modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [detailAddr, setDetailAddr] = useState<WithdrawalAddr | null>(null);

  // form fields
  const [formAssetId, setFormAssetId] = useState('');
  const [formBeneficiary, setFormBeneficiary] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formMemo, setFormMemo] = useState('');
  const [formDeclaration, setFormDeclaration] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // bank form fields
  const [showBankAddModal, setShowBankAddModal] = useState(false);
  const [bankDetailAddr, setBankDetailAddr] = useState<WithdrawalAddr | null>(null);
  const [bankFormAssetId, setBankFormAssetId] = useState('');
  const [bankFormBeneficiary, setBankFormBeneficiary] = useState('');
  const [bankFormBankName, setBankFormBankName] = useState('');
  const [bankFormIban, setBankFormIban] = useState('');
  const [bankFormSwift, setBankFormSwift] = useState('');
  const [bankFormLabel, setBankFormLabel] = useState('');
  const [bankFormDeclaration, setBankFormDeclaration] = useState(false);
  const [bankSubmitting, setBankSubmitting] = useState(false);
  const [bankFormError, setBankFormError] = useState('');

  const [copied, setCopied] = useState(false);

  // deactivate
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState('');

  /* ─── Load assets ────────────────────────────────────────── */
  useEffect(() => {
    (async () => {
      try {
        const res = await customerFetch(`${API}/assets?status=ACTIVE&take=200`);
        if (res.ok) {
          const data = await res.json();
          const all = (data.items ?? data) as Asset[];
          const crypto = all.filter(a => a.type === 'CRYPTO');
          const fiat = all.filter(a => a.type === 'FIAT');
          setAssets(crypto);
          setFiatAssets(fiat);
          if (crypto.length > 0) setFormAssetId(crypto[0].id);
        }
      } catch (err) {
        if (err instanceof CustomerSessionError) return;
      }
    })();
  }, []);

  /* ─── Load addresses ─────────────────────────────────────── */
  const fetchAddresses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await customerFetch(`${API}/client/withdrawal-addresses?take=100`);
      if (res.ok) {
        const data = await res.json();
        setAddresses(data.items ?? []);
      }
    } catch (err) {
      if (err instanceof CustomerSessionError) return;
    }
    setLoading(false);
  }, []);

  useEffect(() => { void fetchAddresses(); }, [fetchAddresses]);

  /* ─── Derived ────────────────────────────────────────────── */
  const visibleAddresses = addresses.filter(a => a.addressType !== 'BANK' && a.status !== 'CANCELLED');
  const activeCount = addresses.filter(a => a.addressType !== 'BANK' && ['PENDING_ACTIVATION', 'ACTIVE'].includes(a.status)).length;
  const canAdd = activeCount < 3 && tradingReady;

  // Bank tab derived
  const bankAddresses = addresses.filter(a => a.addressType === 'BANK' && a.status !== 'CANCELLED');
  const bankActiveCount = addresses.filter(a => a.addressType === 'BANK' && ['PENDING_ACTIVATION', 'ACTIVE'].includes(a.status)).length;
  const canAddBank = bankActiveCount < 3;

  /* ─── Copy ───────────────────────────────────────────────── */
  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /* ─── Submit ─────────────────────────────────────────────── */
  const handleSubmit = async () => {
    setFormError('');
    if (!formAssetId) { setFormError('Please select an asset'); return; }
    if (!formAddress.trim()) { setFormError('Wallet address is required'); return; }
    if (!formDeclaration) { setFormError('You must accept the ownership declaration'); return; }

    setSubmitting(true);
    try {
      const res = await customerFetch(`${API}/client/withdrawal-addresses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: formAssetId,
          address: formAddress.trim(),
          ownershipDeclaration: true,
          label: formLabel.trim() || undefined,
          beneficiaryName: formBeneficiary.trim() || undefined,
          memo: formMemo.trim() || undefined,
        }),
      });

      if (!res.ok) {
        setFormError(await getCustomerApiErrorMessage(res, 'Failed to register address'));
        return;
      }

      // success — close modal, reset form, reload list
      setShowAddModal(false);
      resetForm();
      await fetchAddresses();
    } catch (err: any) {
      if (err instanceof CustomerSessionError) return;
      setFormError(err.message || 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormBeneficiary('');
    setFormLabel('');
    setFormAddress('');
    setFormMemo('');
    setFormDeclaration(false);
    setFormError('');
  };

  const openAddModal = () => {
    resetForm();
    if (assets.length > 0 && !formAssetId) setFormAssetId(assets[0].id);
    setShowAddModal(true);
  };

  const resetBankForm = () => {
    setBankFormBeneficiary('');
    setBankFormBankName('');
    setBankFormIban('');
    setBankFormSwift('');
    setBankFormLabel('');
    setBankFormDeclaration(false);
    setBankFormError('');
  };

  const openBankAddModal = () => {
    resetBankForm();
    if (fiatAssets.length > 0) setBankFormAssetId(fiatAssets[0].id);
    setShowBankAddModal(true);
  };

  const handleBankSubmit = async () => {
    setBankFormError('');
    if (!bankFormAssetId) { setBankFormError('Please select an asset'); return; }
    if (!bankFormBeneficiary.trim()) { setBankFormError('Beneficiary name is required'); return; }
    if (!bankFormBankName.trim()) { setBankFormError('Bank name is required'); return; }
    if (!bankFormIban.trim()) { setBankFormError('IBAN is required'); return; }
    if (!bankFormSwift.trim()) { setBankFormError('SWIFT/BIC code is required'); return; }
    if (!bankFormDeclaration) { setBankFormError('You must accept the ownership declaration'); return; }

    setBankSubmitting(true);
    try {
      const res = await customerFetch(`${API}/client/withdrawal-addresses/bank-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: bankFormAssetId,
          beneficiaryName: bankFormBeneficiary.trim(),
          bankName: bankFormBankName.trim(),
          iban: bankFormIban.trim(),
          swiftBic: bankFormSwift.trim(),
          label: bankFormLabel.trim() || undefined,
          ownershipDeclaration: true,
        }),
      });

      if (!res.ok) {
        setBankFormError(await getCustomerApiErrorMessage(res, 'Failed to register bank account'));
        return;
      }

      setShowBankAddModal(false);
      resetBankForm();
      await fetchAddresses();
      await refetchTradingReadiness();
    } catch (err: any) {
      if (err instanceof CustomerSessionError) return;
      setBankFormError(err.message || 'Unexpected error');
    } finally {
      setBankSubmitting(false);
    }
  };

  /* ─── Deactivate ─────────────────────────────────────────── */
  const handleDeactivate = async () => {
    const addr = detailAddr || bankDetailAddr;
    if (!addr) return;

    setDeactivateError('');
    setDeactivating(true);
    try {
      const res = await customerFetch(`${API}/client/withdrawal-addresses/${addr.addressNo}/deactivate`, {
        method: 'POST',
      });

      if (!res.ok) {
        let code = '';
        let message = 'Failed to deactivate address';
        try {
          const payload = await res.clone().json();
          code = String(payload?.code || '');
          message = String(payload?.message || message);
        } catch {
          // ignore parse failure, fall back to generic message
        }
        setDeactivateError(deactivateErrorMessage(code, message));
        return;
      }

      // success — close modal(s), reset state, reload list
      setConfirmDeactivate(false);
      setDetailAddr(null);
      setBankDetailAddr(null);
      await fetchAddresses();
    } catch (err: any) {
      if (err instanceof CustomerSessionError) return;
      setDeactivateError(err.message || 'Unexpected error');
    } finally {
      setDeactivating(false);
    }
  };

  const resetDeactivateState = () => {
    setConfirmDeactivate(false);
    setDeactivateError('');
  };

  const closeDetail = () => {
    setDetailAddr(null);
    resetDeactivateState();
  };

  const closeBankDetail = () => {
    setBankDetailAddr(null);
    resetDeactivateState();
  };

  /* ═══════════════════════════════════════════════════════════
   *  Render
   * ═══════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-6 pb-20">
      {/* ── Header ─────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-fx-sand">Wallet</h1>
        <p className="text-fx-dune mt-1">Manage your withdrawal addresses and bank accounts</p>
      </div>

      {/* ── First-run guided banner ────────────────────────── */}
      {!tradingReady && (
        <div className="rounded-2xl border border-fx-brass/25 bg-fx-brass/5 p-5 flex items-start gap-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fx-brass/10 text-fx-brass">
            <Landmark size={16} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-fx-brass/70">
              § Withdrawal address required
            </div>
            <h3 className="text-sm font-bold text-fx-sand mt-1">Add a fiat (bank) withdrawal address to start</h3>
            <p className="text-xs text-fx-dune mt-1 leading-relaxed">
              You need one before you can deposit, swap, or withdraw. It only takes a minute.
            </p>
          </div>
          <button
            onClick={() => { setActiveTab('bank'); openBankAddModal(); }}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-fx-brass text-fx-obsidian text-sm font-bold rounded-xl hover:shadow-lg hover:shadow-fx-brass/20 transition-all"
          >
            <Plus size={16} />
            Add Bank Account
          </button>
        </div>
      )}

      {/* ── Main Card ──────────────────────────────────────── */}
      <div className="bg-fx-ink/40 rounded-3xl border border-fx-rule shadow-sm overflow-hidden min-h-[500px]">
        {/* Tabs */}
        <div className="border-b border-fx-rule bg-fx-charcoal/50">
          <div className="flex overflow-x-auto px-6">
            <button
              onClick={() => setActiveTab('crypto')}
              className={`px-6 py-4 text-sm font-bold transition-colors border-b-[3px] flex-1 sm:flex-none whitespace-nowrap ${
                activeTab === 'crypto'
                  ? 'border-fx-brass text-fx-brass bg-fx-ink/40'
                  : 'border-transparent text-fx-dust hover:text-fx-dune'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <Wallet size={18} />
                Crypto Addresses
              </div>
            </button>
            <button
              onClick={() => setActiveTab('bank')}
              className={`px-6 py-4 text-sm font-bold transition-colors border-b-[3px] flex-1 sm:flex-none whitespace-nowrap ${
                activeTab === 'bank'
                  ? 'border-fx-brass text-fx-brass bg-fx-ink/40'
                  : 'border-transparent text-fx-dust hover:text-fx-dune'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <Building2 size={18} />
                Bank Accounts
              </div>
            </button>
          </div>
        </div>

        {/* ── Crypto Tab ─────────────────────────────────── */}
        {activeTab === 'crypto' && (
          <div className="p-6 space-y-5">
            {/* Top bar */}
            <div className="flex items-center justify-between">
              <div className="text-sm text-fx-dune">
                Registered Addresses
                <span className="ml-1.5 font-mono text-fx-dust">({activeCount}/3)</span>
              </div>
              <button
                onClick={openAddModal}
                disabled={!canAdd}
                className="flex items-center gap-1.5 px-4 py-2 bg-fx-brass text-fx-obsidian text-sm font-bold rounded-xl hover:shadow-lg hover:shadow-fx-brass/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus size={16} />
                Add Address
              </button>
            </div>

            {!tradingReady ? (
              <div className="rounded-xl border border-fx-brass/20 bg-fx-brass/5 px-4 py-2.5 text-xs text-fx-brass flex items-center gap-2">
                <AlertCircle size={14} className="shrink-0" />
                Add a fiat withdrawal address first.
              </div>
            ) : !canAdd && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-400 flex items-center gap-2">
                <AlertCircle size={14} className="shrink-0" />
                Maximum 3 active addresses reached. Suspend or wait for an address to be removed before adding a new one.
              </div>
            )}

            {/* Address list */}
            {loading ? (
              <div className="text-center py-16 text-fx-dust">
                <RefreshCw className="animate-spin mx-auto mb-2" size={24} />
                Loading addresses...
              </div>
            ) : visibleAddresses.length === 0 ? (
              <div className="text-center py-16 bg-fx-charcoal/30 rounded-2xl border border-dashed border-fx-rule">
                <div className="w-16 h-16 bg-fx-charcoal rounded-full flex items-center justify-center mb-4 text-fx-dust mx-auto">
                  <Wallet size={32} />
                </div>
                <h3 className="text-lg font-bold text-fx-sand mb-2">No Addresses Yet</h3>
                <p className="text-fx-dust mb-6 max-w-sm mx-auto">
                  Register a crypto withdrawal address to start making on-chain transfers.
                </p>
                <button
                  onClick={openAddModal}
                  disabled={!canAdd}
                  className="px-6 py-3 bg-fx-brass text-fx-obsidian rounded-xl font-bold hover:shadow-lg hover:shadow-fx-brass/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Add Your First Address
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {visibleAddresses.map(addr => (
                  <button
                    key={addr.addressNo}
                    onClick={() => { resetDeactivateState(); setDetailAddr(addr); }}
                    className="w-full text-left rounded-2xl border border-fx-rule bg-fx-charcoal/40 p-4 hover:border-fx-brass/40 hover:bg-fx-charcoal/60 transition-all group"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-fx-sand truncate">
                            {addr.label || truncAddr(addr.address)}
                          </span>
                          <span className="shrink-0 text-[10px] font-bold uppercase text-fx-dust bg-fx-charcoal px-1.5 py-0.5 rounded">
                            {addr.asset.code}
                          </span>
                        </div>
                        <div className="mt-1 text-xs font-mono text-fx-dust truncate">
                          {truncAddr(addr.address)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0">
                        {addr.status === 'PENDING_ACTIVATION' && (
                          <div className="flex items-center gap-1 text-xs font-mono text-amber-400">
                            <Clock size={12} />
                            {formatCountdown(addr.activatesAt)}
                          </div>
                        )}
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${statusColor(addr.status)}`}>
                          {statusLabel(addr.status)}
                        </span>
                        <ChevronRight size={16} className="text-fx-dust group-hover:text-fx-brass transition-colors" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Bank Tab ─────────────────────────────────── */}
        {activeTab === 'bank' && (
          <div className="p-6 space-y-5">
            {/* Top bar */}
            <div className="flex items-center justify-between">
              <div className="text-sm text-fx-dune">
                Registered Accounts
                <span className="ml-1.5 font-mono text-fx-dust">({bankActiveCount}/3)</span>
              </div>
              <button
                onClick={openBankAddModal}
                disabled={!canAddBank}
                className="flex items-center gap-1.5 px-4 py-2 bg-fx-brass text-fx-obsidian text-sm font-bold rounded-xl hover:shadow-lg hover:shadow-fx-brass/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus size={16} />
                Add Account
              </button>
            </div>

            {!canAddBank && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-400 flex items-center gap-2">
                <AlertCircle size={14} className="shrink-0" />
                Maximum 3 active accounts reached. Suspend or wait for an account to be removed before adding a new one.
              </div>
            )}

            {/* Bank account list */}
            {loading ? (
              <div className="text-center py-16 text-fx-dust">
                <RefreshCw className="animate-spin mx-auto mb-2" size={24} />
                Loading accounts...
              </div>
            ) : bankAddresses.length === 0 ? (
              <div className="text-center py-16 bg-fx-charcoal/30 rounded-2xl border border-dashed border-fx-rule">
                <div className="w-16 h-16 bg-fx-charcoal rounded-full flex items-center justify-center mb-4 text-fx-dust mx-auto">
                  <Building2 size={32} />
                </div>
                <h3 className="text-lg font-bold text-fx-sand mb-2">No Bank Accounts Yet</h3>
                <p className="text-fx-dust mb-6 max-w-sm mx-auto">
                  Register a bank account to start making fiat withdrawals.
                </p>
                <button
                  onClick={openBankAddModal}
                  className="px-6 py-3 bg-fx-brass text-fx-obsidian rounded-xl font-bold hover:shadow-lg hover:shadow-fx-brass/30 transition-all"
                >
                  Add Your First Account
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {bankAddresses.map(addr => (
                  <button
                    key={addr.addressNo}
                    onClick={() => { resetDeactivateState(); setBankDetailAddr(addr); }}
                    className="w-full text-left rounded-2xl border border-fx-rule bg-fx-charcoal/40 p-4 hover:border-fx-brass/40 hover:bg-fx-charcoal/60 transition-all group"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-fx-sand truncate">
                            {addr.label || (addr.iban ? maskIban(addr.iban) : 'Bank Account')}
                          </span>
                          <span className="shrink-0 text-[10px] font-bold uppercase text-fx-dust bg-fx-charcoal px-1.5 py-0.5 rounded">
                            {addr.asset.code}
                          </span>
                        </div>
                        <div className="mt-1 text-xs font-mono text-fx-dust truncate">
                          {addr.iban ? maskIban(addr.iban) : '—'}
                        </div>
                        {addr.bankName && (
                          <div className="mt-0.5 text-[11px] text-fx-dust/70 truncate">
                            {addr.bankName}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0">
                        {addr.status === 'PENDING_ACTIVATION' && (
                          <div className="flex items-center gap-1 text-xs font-mono text-amber-400">
                            <Clock size={12} />
                            {formatCountdown(addr.activatesAt)}
                          </div>
                        )}
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${statusColor(addr.status)}`}>
                          {statusLabel(addr.status)}
                        </span>
                        <ChevronRight size={16} className="text-fx-dust group-hover:text-fx-brass transition-colors" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════
       *  Add Address Modal
       * ═══════════════════════════════════════════════════════ */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-fx-ink rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto border border-fx-rule">
            {/* header */}
            <div className="flex justify-between items-center p-5 border-b border-fx-rule">
              <div>
                <h3 className="text-lg font-bold text-fx-sand">New Withdrawal Address</h3>
                <p className="text-sm text-fx-dust mt-1">Register a crypto address for withdrawals</p>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-2 hover:bg-fx-charcoal rounded-full transition-colors text-fx-dust"
              >
                <X size={18} />
              </button>
            </div>

            {/* body */}
            <div className="p-5 space-y-4">
              {formError && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2.5 text-xs text-rose-400">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  {formError}
                </div>
              )}

              {/* Asset */}
              <div>
                <label className="text-xs text-fx-dust font-medium block mb-1">Asset</label>
                <select
                  value={formAssetId}
                  onChange={e => setFormAssetId(e.target.value)}
                  className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm focus:outline-none focus:border-fx-brass"
                >
                  {assets.map(a => (
                    <option key={a.id} value={a.id}>{a.code}</option>
                  ))}
                </select>
              </div>

              {/* Beneficiary Name */}
              <div>
                <label className="text-xs text-fx-dust font-medium block mb-1">Beneficiary Name</label>
                <input
                  value={formBeneficiary}
                  onChange={e => setFormBeneficiary(e.target.value)}
                  placeholder="Full name of the wallet owner"
                  className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
                />
              </div>

              {/* Label */}
              <div>
                <label className="text-xs text-fx-dust font-medium block mb-1">Address Label</label>
                <input
                  value={formLabel}
                  onChange={e => setFormLabel(e.target.value)}
                  placeholder="e.g. My Ledger, Binance Hot Wallet"
                  className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
                />
              </div>

              {/* Wallet Address */}
              <div>
                <label className="text-xs text-fx-dust font-medium block mb-1">Wallet Address</label>
                <input
                  value={formAddress}
                  onChange={e => setFormAddress(e.target.value)}
                  placeholder="0x... / T... / bc1..."
                  className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm font-mono placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
                />
              </div>

              {/* Memo / Tag */}
              <div>
                <label className="text-xs text-fx-dust font-medium block mb-1">
                  Memo / Tag
                  <span className="ml-1 text-fx-dust/60 font-normal">(optional)</span>
                </label>
                <input
                  value={formMemo}
                  onChange={e => setFormMemo(e.target.value)}
                  placeholder="Required for some networks (e.g. XLM, XRP)"
                  className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
                />
              </div>

              {/* Ownership Declaration */}
              <div className="rounded-xl border border-fx-brass/20 bg-fx-brass/5 p-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formDeclaration}
                    onChange={e => setFormDeclaration(e.target.checked)}
                    className="mt-0.5 accent-fx-brass"
                  />
                  <div>
                    <div className="text-xs font-bold text-fx-brass mb-1 flex items-center gap-1.5">
                      <ShieldCheck size={13} />
                      Ownership Declaration
                    </div>
                    <span className="text-xs text-fx-dune leading-relaxed">
                      I declare that I am the sole owner and controller of this wallet address. I understand that providing false information may result in account suspension and regulatory action.
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* footer */}
            <div className="p-5 border-t border-fx-rule bg-fx-charcoal/50 flex gap-3">
              <button
                onClick={() => setShowAddModal(false)}
                disabled={submitting}
                className="flex-1 py-3 bg-fx-ink border border-fx-rule text-fx-dune font-semibold rounded-xl hover:bg-fx-charcoal transition-colors disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !formDeclaration}
                className="flex-1 py-3 bg-fx-brass text-fx-obsidian font-bold rounded-xl hover:shadow-lg hover:shadow-fx-brass/20 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {submitting && <RefreshCw size={16} className="animate-spin" />}
                {submitting ? 'Registering...' : 'Register Address'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
       *  Address Detail Modal
       * ═══════════════════════════════════════════════════════ */}
      {detailAddr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-fx-ink rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-fx-rule">
            {/* header */}
            <div className="flex justify-between items-center p-5 border-b border-fx-rule">
              <div className="flex items-center gap-3">
                <button
                  onClick={closeDetail}
                  className="p-1.5 hover:bg-fx-charcoal rounded-lg transition-colors text-fx-dust"
                >
                  <ArrowLeft size={18} />
                </button>
                <div>
                  <h3 className="text-lg font-bold text-fx-sand">
                    {detailAddr.label || 'Address Details'}
                  </h3>
                  <p className="text-xs font-mono text-fx-dust mt-0.5">{detailAddr.addressNo}</p>
                </div>
              </div>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${statusColor(detailAddr.status)}`}>
                {statusLabel(detailAddr.status)}
              </span>
            </div>

            {/* body */}
            <div className="p-5 space-y-5">
              {deactivateError && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2.5 text-xs text-rose-400">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  {deactivateError}
                </div>
              )}

              {/* Cooling Period Banner */}
              {detailAddr.status === 'PENDING_ACTIVATION' && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-amber-400/70 font-bold">Activates In</div>
                  <div className="mt-1 text-2xl font-bold font-mono text-amber-400">
                    {formatCountdown(detailAddr.activatesAt)}
                  </div>
                  <div className="mt-1 text-xs text-fx-dust">
                    {new Date(detailAddr.activatesAt).toLocaleString()}
                  </div>
                </div>
              )}

              {/* Wallet Address */}
              <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-4">
                <label className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Wallet Address</label>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <code className="text-sm font-mono text-fx-sand break-all">{detailAddr.address}</code>
                  <button
                    onClick={() => copy(detailAddr.address)}
                    className="p-2 text-fx-dust hover:text-fx-brass transition-colors shrink-0"
                  >
                    {copied ? <Check size={16} className="text-fx-sage" /> : <Copy size={16} />}
                  </button>
                </div>
                {detailAddr.memo && (
                  <div className="mt-3 pt-3 border-t border-fx-rule">
                    <label className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Memo / Tag</label>
                    <div className="mt-1 text-sm font-mono text-fx-sand">{detailAddr.memo}</div>
                  </div>
                )}
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-3">
                  <div className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Asset</div>
                  <div className="mt-1 text-sm font-semibold text-fx-sand">{detailAddr.asset.code}</div>
                </div>
                <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-3">
                  <div className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Network</div>
                  <div className="mt-1 text-sm font-semibold text-fx-sand">{detailAddr.network}</div>
                </div>
                <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-3">
                  <div className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Type</div>
                  <div className="mt-1 text-sm font-semibold text-fx-sand">
                    {detailAddr.addressType === 'VASP' ? 'Exchange (VASP)' : 'Self-Custody'}
                  </div>
                </div>
                <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-3">
                  <div className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Registered</div>
                  <div className="mt-1 text-sm text-fx-sand">
                    {new Date(detailAddr.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>

              {/* Beneficiary */}
              {detailAddr.beneficiaryName && (
                <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-4">
                  <div className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Beneficiary</div>
                  <div className="mt-1 text-sm font-semibold text-fx-sand">{detailAddr.beneficiaryName}</div>
                </div>
              )}

              {/* VASP Info */}
              {detailAddr.counterpartyVaspName && (
                <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-4">
                  <div className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Counterparty VASP</div>
                  <div className="mt-1 text-sm font-semibold text-fx-sand">{detailAddr.counterpartyVaspName}</div>
                </div>
              )}

              {/* Ownership Declaration */}
              {detailAddr.ownershipDeclaredAt && (
                <div className="rounded-xl border border-fx-sage/20 bg-fx-sage/5 p-4 flex items-start gap-3">
                  <ShieldCheck size={18} className="text-fx-sage shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold text-fx-sage">Ownership Declared</div>
                    <div className="text-xs text-fx-dust mt-0.5">
                      {new Date(detailAddr.ownershipDeclaredAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* footer */}
            <div className="p-5 border-t border-fx-rule bg-fx-charcoal/50 rounded-b-2xl space-y-3">
              {detailAddr.status === 'ACTIVE' && confirmDeactivate ? (
                <>
                  <p className="text-xs text-fx-dust text-center">
                    Deactivate this address? You can't use it for withdrawals afterward.
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setConfirmDeactivate(false)}
                      disabled={deactivating}
                      className="flex-1 py-3 bg-fx-ink border border-fx-rule text-fx-dune font-semibold rounded-xl hover:bg-fx-charcoal transition-colors disabled:opacity-60"
                    >
                      Keep Address
                    </button>
                    <button
                      onClick={handleDeactivate}
                      disabled={deactivating}
                      className="flex-1 py-3 bg-rose-500/90 text-white font-bold rounded-xl hover:bg-rose-500 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      {deactivating && <RefreshCw size={16} className="animate-spin" />}
                      {deactivating ? 'Deactivating...' : 'Confirm Deactivate'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex gap-3">
                  <button
                    onClick={closeDetail}
                    className="flex-1 py-3 bg-fx-ink border border-fx-rule text-fx-dune font-bold rounded-xl hover:bg-fx-charcoal transition-colors"
                  >
                    Close
                  </button>
                  {detailAddr.status === 'ACTIVE' && (
                    <button
                      onClick={() => setConfirmDeactivate(true)}
                      className="flex-1 py-3 bg-fx-ink border border-rose-500/30 text-rose-400 font-bold rounded-xl hover:bg-rose-500/10 transition-colors"
                    >
                      Deactivate
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
       *  Bank Add Modal
       * ═══════════════════════════════════════════════════════ */}
      {showBankAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-fx-ink rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto border border-fx-rule">
            {/* header */}
            <div className="flex justify-between items-center p-5 border-b border-fx-rule">
              <div>
                <h3 className="text-lg font-bold text-fx-sand">New Bank Account</h3>
                <p className="text-sm text-fx-dust mt-1">Register a bank account for fiat withdrawals</p>
              </div>
              <button
                onClick={() => setShowBankAddModal(false)}
                className="p-2 hover:bg-fx-charcoal rounded-full transition-colors text-fx-dust"
              >
                <X size={18} />
              </button>
            </div>

            {/* body */}
            <div className="p-5 space-y-4">
              {bankFormError && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2.5 text-xs text-rose-400">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  {bankFormError}
                </div>
              )}

              {/* Asset */}
              <div>
                <label className="text-xs text-fx-dust font-medium block mb-1">Asset</label>
                <select
                  value={bankFormAssetId}
                  onChange={e => setBankFormAssetId(e.target.value)}
                  className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm focus:outline-none focus:border-fx-brass"
                >
                  {fiatAssets.map(a => (
                    <option key={a.id} value={a.id}>{a.code} (Fiat)</option>
                  ))}
                </select>
              </div>

              {/* Beneficiary Name */}
              <div>
                <label className="text-xs text-fx-dust font-medium block mb-1">Beneficiary Name</label>
                <input
                  value={bankFormBeneficiary}
                  onChange={e => setBankFormBeneficiary(e.target.value)}
                  placeholder="Full name of the account holder"
                  className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
                />
              </div>

              {/* Bank Name */}
              <div>
                <label className="text-xs text-fx-dust font-medium block mb-1">Bank Name</label>
                <input
                  value={bankFormBankName}
                  onChange={e => setBankFormBankName(e.target.value)}
                  placeholder="e.g. Emirates NBD, HSBC"
                  className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
                />
              </div>

              {/* IBAN */}
              <div>
                <label className="text-xs text-fx-dust font-medium block mb-1">IBAN</label>
                <input
                  value={bankFormIban}
                  onChange={e => setBankFormIban(e.target.value)}
                  placeholder="AE07 0331 0000 0000 0000 00"
                  className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm font-mono placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
                />
              </div>

              {/* SWIFT / BIC */}
              <div>
                <label className="text-xs text-fx-dust font-medium block mb-1">SWIFT / BIC Code</label>
                <input
                  value={bankFormSwift}
                  onChange={e => setBankFormSwift(e.target.value)}
                  placeholder="e.g.ABORAEADXXX"
                  className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm font-mono placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
                />
              </div>

              {/* Account Label */}
              <div>
                <label className="text-xs text-fx-dust font-medium block mb-1">
                  Account Label
                  <span className="ml-1 text-fx-dust/60 font-normal">(optional)</span>
                </label>
                <input
                  value={bankFormLabel}
                  onChange={e => setBankFormLabel(e.target.value)}
                  placeholder="e.g. My Salary Account"
                  className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
                />
              </div>

              {/* Ownership Declaration */}
              <div className="rounded-xl border border-fx-brass/20 bg-fx-brass/5 p-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bankFormDeclaration}
                    onChange={e => setBankFormDeclaration(e.target.checked)}
                    className="mt-0.5 accent-fx-brass"
                  />
                  <div>
                    <div className="text-xs font-bold text-fx-brass mb-1 flex items-center gap-1.5">
                      <ShieldCheck size={13} />
                      Ownership Declaration
                    </div>
                    <span className="text-xs text-fx-dune leading-relaxed">
                      I declare that I am the sole owner and controller of this bank account. I understand that providing false information may result in account suspension and regulatory action.
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* footer */}
            <div className="p-5 border-t border-fx-rule bg-fx-charcoal/50 flex gap-3">
              <button
                onClick={() => setShowBankAddModal(false)}
                disabled={bankSubmitting}
                className="flex-1 py-3 bg-fx-ink border border-fx-rule text-fx-dune font-semibold rounded-xl hover:bg-fx-charcoal transition-colors disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleBankSubmit}
                disabled={bankSubmitting || !bankFormDeclaration}
                className="flex-1 py-3 bg-fx-brass text-fx-obsidian font-bold rounded-xl hover:shadow-lg hover:shadow-fx-brass/20 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {bankSubmitting && <RefreshCw size={16} className="animate-spin" />}
                {bankSubmitting ? 'Registering...' : 'Register Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
       *  Bank Detail Modal
       * ═══════════════════════════════════════════════════════ */}
      {bankDetailAddr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-fx-ink rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-fx-rule">
            {/* header */}
            <div className="flex justify-between items-center p-5 border-b border-fx-rule">
              <div className="flex items-center gap-3">
                <button
                  onClick={closeBankDetail}
                  className="p-1.5 hover:bg-fx-charcoal rounded-lg transition-colors text-fx-dust"
                >
                  <ArrowLeft size={18} />
                </button>
                <div>
                  <h3 className="text-lg font-bold text-fx-sand">
                    {bankDetailAddr.label || 'Account Details'}
                  </h3>
                  <p className="text-xs font-mono text-fx-dust mt-0.5">{bankDetailAddr.addressNo}</p>
                </div>
              </div>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${statusColor(bankDetailAddr.status)}`}>
                {statusLabel(bankDetailAddr.status)}
              </span>
            </div>

            {/* body */}
            <div className="p-5 space-y-5">
              {deactivateError && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2.5 text-xs text-rose-400">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  {deactivateError}
                </div>
              )}

              {/* Cooling Period Banner */}
              {bankDetailAddr.status === 'PENDING_ACTIVATION' && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-amber-400/70 font-bold">Activates In</div>
                  <div className="mt-1 text-2xl font-bold font-mono text-amber-400">
                    {formatCountdown(bankDetailAddr.activatesAt)}
                  </div>
                  <div className="mt-1 text-xs text-fx-dust">
                    {new Date(bankDetailAddr.activatesAt).toLocaleString()}
                  </div>
                </div>
              )}

              {/* IBAN Card */}
              <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-4">
                <label className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">IBAN</label>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <code className="text-sm font-mono text-fx-sand break-all">
                    {bankDetailAddr.iban ? formatIban(bankDetailAddr.iban) : '—'}
                  </code>
                  {bankDetailAddr.iban && (
                    <button
                      onClick={() => copy(bankDetailAddr.iban!)}
                      className="p-2 text-fx-dust hover:text-fx-brass transition-colors shrink-0"
                    >
                      {copied ? <Check size={16} className="text-fx-sage" /> : <Copy size={16} />}
                    </button>
                  )}
                </div>
                {bankDetailAddr.swiftBic && (
                  <div className="mt-3 pt-3 border-t border-fx-rule">
                    <label className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">SWIFT / BIC</label>
                    <div className="mt-1 text-sm font-mono text-fx-sand">{bankDetailAddr.swiftBic}</div>
                  </div>
                )}
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-3">
                  <div className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Asset</div>
                  <div className="mt-1 text-sm font-semibold text-fx-sand">{bankDetailAddr.asset.code}</div>
                </div>
                <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-3">
                  <div className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Bank</div>
                  <div className="mt-1 text-sm font-semibold text-fx-sand">{bankDetailAddr.bankName || '—'}</div>
                </div>
                <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-3">
                  <div className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Beneficiary</div>
                  <div className="mt-1 text-sm font-semibold text-fx-sand">{bankDetailAddr.beneficiaryName || '—'}</div>
                </div>
                <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-3">
                  <div className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Registered</div>
                  <div className="mt-1 text-sm text-fx-sand">
                    {new Date(bankDetailAddr.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>

              {/* Ownership Declaration */}
              {bankDetailAddr.ownershipDeclaredAt && (
                <div className="rounded-xl border border-fx-sage/20 bg-fx-sage/5 p-4 flex items-start gap-3">
                  <ShieldCheck size={18} className="text-fx-sage shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold text-fx-sage">Ownership Declared</div>
                    <div className="text-xs text-fx-dust mt-0.5">
                      {new Date(bankDetailAddr.ownershipDeclaredAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* footer */}
            <div className="p-5 border-t border-fx-rule bg-fx-charcoal/50 rounded-b-2xl space-y-3">
              {bankDetailAddr.status === 'ACTIVE' && confirmDeactivate ? (
                <>
                  <p className="text-xs text-fx-dust text-center">
                    Deactivate this account? You can't use it for withdrawals afterward.
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setConfirmDeactivate(false)}
                      disabled={deactivating}
                      className="flex-1 py-3 bg-fx-ink border border-fx-rule text-fx-dune font-semibold rounded-xl hover:bg-fx-charcoal transition-colors disabled:opacity-60"
                    >
                      Keep Account
                    </button>
                    <button
                      onClick={handleDeactivate}
                      disabled={deactivating}
                      className="flex-1 py-3 bg-rose-500/90 text-white font-bold rounded-xl hover:bg-rose-500 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      {deactivating && <RefreshCw size={16} className="animate-spin" />}
                      {deactivating ? 'Deactivating...' : 'Confirm Deactivate'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex gap-3">
                  <button
                    onClick={closeBankDetail}
                    className="flex-1 py-3 bg-fx-ink border border-fx-rule text-fx-dune font-bold rounded-xl hover:bg-fx-charcoal transition-colors"
                  >
                    Close
                  </button>
                  {bankDetailAddr.status === 'ACTIVE' && (
                    <button
                      onClick={() => setConfirmDeactivate(true)}
                      className="flex-1 py-3 bg-fx-ink border border-rose-500/30 text-rose-400 font-bold rounded-xl hover:bg-rose-500/10 transition-colors"
                    >
                      Deactivate
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
