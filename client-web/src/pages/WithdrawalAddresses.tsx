import { useEffect, useState, useCallback, useMemo } from 'react';
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
  Lock,
} from 'lucide-react';
import {
  customerFetch,
  CustomerSessionError,
  getCustomerApiErrorMessage,
} from '../utils/customerFetch';
import { useTradingReadiness } from '../hooks/useTradingReadiness';
import { formatCountdown } from './countdown';

const API = import.meta.env.VITE_API_URL;

/* ─── Types ────────────────────────────────────────────────── */

interface Asset {
  id: string;
  currency: string;
  code: string;
  type: string;
  network: string;
}

type OwnerType = 'SELF' | 'THIRD_PARTY';
type DeclaredHosting = 'SELF_CUSTODY' | 'VASP';

interface WithdrawalAddr {
  addressNo: string;
  address: string;
  addressType: string;
  network: string;
  status: string;
  label: string | null;
  ownerType: OwnerType;
  beneficiaryName: string | null;
  beneficiaryRelationship: string | null;
  memo: string | null;
  activatesAt: string;
  activatedAt: string | null;
  createdAt: string;
  counterpartyVaspName: string | null;
  ownershipProofType: string | null;
  ownershipDeclaredAt: string | null;
  ownershipVerifiedAt: string | null;
  // Bank-specific fields
  iban: string | null;
  swiftBic: string | null;
  bankName: string | null;
}

type ActiveTab = 'crypto' | 'bank';

/* ─── Helpers ──────────────────────────────────────────────── */

function truncAddr(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function statusLabel(s: string): string {
  switch (s) {
    case 'PENDING_VERIFICATION': return 'Pending verification';
    case 'PENDING_ACTIVATION': return 'Cooling';
    case 'ACTIVE':             return 'Active';
    case 'SUSPENDED':          return 'Suspended';
    case 'CANCELLED':          return 'Cancelled';
    case 'DEACTIVATED':        return 'Deactivated';
    case 'REJECTED':           return 'Not approved';
    default:                   return s;
  }
}

function statusColor(s: string): string {
  switch (s) {
    case 'PENDING_VERIFICATION': return 'bg-fx-brass/15 text-fx-brass';
    case 'PENDING_ACTIVATION': return 'bg-amber-500/15 text-amber-400';
    case 'ACTIVE':             return 'bg-fx-sage/15 text-fx-sage';
    case 'SUSPENDED':          return 'bg-rose-500/15 text-rose-400';
    case 'CANCELLED':          return 'bg-fx-dust/15 text-fx-dust';
    case 'DEACTIVATED':        return 'bg-fx-dust/15 text-fx-dust';
    case 'REJECTED':           return 'bg-rose-500/15 text-rose-400';
    default:                   return 'bg-fx-dust/15 text-fx-dust';
  }
}

// 占每网络 3 个名额的状态（与后端 SLOT_HOLDING_STATUSES 同三态；REJECTED 不占名额）
const SLOT_HOLDING_STATUSES = ['PENDING_VERIFICATION', 'PENDING_ACTIVATION', 'ACTIVE'];

// 登记还没生效、客户可以撤销的两个等待态
function isCancellable(status: string): boolean {
  return status === 'PENDING_VERIFICATION' || status === 'PENDING_ACTIVATION';
}

// 终态：不再出任何动作（编辑 / 取消 / 停用）
function isTerminalStatus(status: string): boolean {
  return status === 'CANCELLED' || status === 'DEACTIVATED' || status === 'REJECTED';
}

// 自托管 × 本人：要先做钱包签名验证，地址才会进入冷却期
function needsSignature(addr: WithdrawalAddr): boolean {
  return addr.status === 'PENDING_VERIFICATION' && addr.ownershipProofType === 'SIGNATURE' && !addr.ownershipVerifiedAt;
}

function beneficiaryText(addr: WithdrawalAddr): string {
  if (addr.ownerType === 'THIRD_PARTY') return addr.beneficiaryName || '—';
  return addr.beneficiaryName || 'Myself';
}

// 列表行里的一行受益人摘要（仅第三方条目出现）
function thirdPartyLine(addr: WithdrawalAddr): string {
  return [addr.beneficiaryName, addr.beneficiaryRelationship].filter(Boolean).join(' · ');
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

/* ─── Small form pieces ────────────────────────────────────── */

function ChoiceCard({ name, checked, onSelect, title, hint }: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  hint?: string;
}) {
  return (
    <label
      className={`flex-1 cursor-pointer rounded-xl border px-3 py-2.5 transition-colors focus-within:ring-1 focus-within:ring-fx-brass/60 ${
        checked ? 'border-fx-brass bg-fx-brass/10' : 'border-fx-rule bg-fx-charcoal hover:border-fx-brass/40'
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      <div className="text-sm font-semibold text-fx-sand">{title}</div>
      {hint && <div className="mt-0.5 text-[11px] leading-snug text-fx-dust">{hint}</div>}
    </label>
  );
}

function OwnerTypeChoice({ name, value, onChange }: {
  name: string;
  value: OwnerType;
  onChange: (v: OwnerType) => void;
}) {
  return (
    <div>
      <label className="text-xs text-fx-dust font-medium block mb-1">Beneficiary</label>
      <div role="radiogroup" aria-label="Beneficiary" className="flex gap-2">
        <ChoiceCard name={name} checked={value === 'SELF'} onSelect={() => onChange('SELF')} title="Myself" hint="I own it" />
        <ChoiceCard name={name} checked={value === 'THIRD_PARTY'} onSelect={() => onChange('THIRD_PARTY')} title="Third party" hint="Someone else owns it" />
      </div>
    </div>
  );
}

function ThirdPartyBadge() {
  return (
    <span className="shrink-0 text-[10px] font-bold uppercase text-fx-brass bg-fx-brass/10 px-1.5 py-0.5 rounded">
      Third party
    </span>
  );
}

// 详情里的所有权凭据行：签名通过 > 第三方申报 > 本人声明；被拒的条目不出绿勾
function OwnershipNote({ addr }: { addr: WithdrawalAddr }) {
  if (addr.status === 'REJECTED' || !addr.ownershipDeclaredAt) return null;
  const title = addr.ownershipVerifiedAt
    ? 'Wallet signature verified'
    : addr.ownerType === 'THIRD_PARTY'
      ? 'Third-party Beneficiary Declared'
      : 'Ownership Declared';
  return (
    <div className="rounded-xl border border-fx-sage/20 bg-fx-sage/5 p-4 flex items-start gap-3">
      <ShieldCheck size={18} className="text-fx-sage shrink-0 mt-0.5" />
      <div>
        <div className="text-xs font-bold text-fx-sage">{title}</div>
        <div className="text-xs text-fx-dust mt-0.5">
          {new Date(addr.ownershipVerifiedAt ?? addr.ownershipDeclaredAt).toLocaleString()}
        </div>
      </div>
    </div>
  );
}

// 登记未通过：客户面只说结果，不给原因
function NotApprovedNotice({ noun }: { noun: 'address' | 'account' }) {
  return (
    <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 flex items-start gap-3">
      <AlertCircle size={18} className="text-rose-400 shrink-0 mt-0.5" />
      <div>
        <div className="text-xs font-bold text-rose-400">Not approved</div>
        <div className="text-xs text-fx-dust mt-0.5">
          This {noun} wasn't approved and can't be used for withdrawals.
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
 *  Main Component
 * ═══════════════════════════════════════════════════════════════ */

export default function WithdrawalAddresses() {
  const { tradingReady, loading: tradingReadinessLoading, refetch: refetchTradingReadiness } = useTradingReadiness();
  // 站 5 ④：倒计时走秒。到期那一秒重拉一次列表——后端查询时懒激活，会把 PENDING_ACTIVATION 翻成 ACTIVE。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const [activeTab, setActiveTab] = useState<ActiveTab>('crypto');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [addresses, setAddresses] = useState<WithdrawalAddr[]>([]);
  const [loading, setLoading] = useState(true);

  // Network options derived from loaded crypto assets — client has no access
  // to the backend's network registry, so it groups assets by network instead.
  const chainNetworks = useMemo(() => {
    const byNetwork = new Map<string, string[]>();
    for (const a of assets) {
      if (a.type !== 'CRYPTO') continue;
      byNetwork.set(a.network, [...(byNetwork.get(a.network) ?? []), a.code]);
    }
    return Array.from(byNetwork, ([network, codes]) => ({ network, label: `${network} (${codes.join(', ')})` }));
  }, [assets]);

  // modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [detailAddr, setDetailAddr] = useState<WithdrawalAddr | null>(null);

  // form fields
  const [formNetwork, setFormNetwork] = useState(chainNetworks[0]?.network ?? '');
  const [formOwnerType, setFormOwnerType] = useState<OwnerType>('SELF');
  const [formBeneficiary, setFormBeneficiary] = useState('');
  const [formRelationship, setFormRelationship] = useState('');
  // 托管自报没有默认值：这是客户的申报证据，不替他预选
  const [formHosting, setFormHosting] = useState<DeclaredHosting | ''>('');
  const [formLabel, setFormLabel] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formMemo, setFormMemo] = useState('');
  const [formDeclaration, setFormDeclaration] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // bank form fields
  const [showBankAddModal, setShowBankAddModal] = useState(false);
  const [bankDetailAddr, setBankDetailAddr] = useState<WithdrawalAddr | null>(null);
  const [bankFormOwnerType, setBankFormOwnerType] = useState<OwnerType>('SELF');
  const [bankFormBeneficiary, setBankFormBeneficiary] = useState('');
  const [bankFormRelationship, setBankFormRelationship] = useState('');
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
  const [deactivateReason, setDeactivateReason] = useState('');

  // cancel registration (waiting states only: PENDING_VERIFICATION / PENDING_ACTIVATION) — inline per-card confirm
  const [cancelConfirmFor, setCancelConfirmFor] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  // edit label (crypto + bank detail modals) — beneficiary / hosting are frozen declarations
  const [editLabel, setEditLabel] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState('');

  // wallet signature verification (crypto detail, self-custody × myself)
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState('');

  /* ─── Load assets ────────────────────────────────────────── */
  useEffect(() => {
    (async () => {
      try {
        const res = await customerFetch(`${API}/assets?status=ACTIVE&take=200`);
        if (res.ok) {
          const data = await res.json();
          const all = (data.items ?? data) as Asset[];
          const crypto = all.filter(a => a.type === 'CRYPTO');
          setAssets(crypto);
          if (crypto[0]?.network) setFormNetwork(crypto[0].network);
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

  useEffect(() => {
    const due = addresses.some(
      (a) => a.status === 'PENDING_ACTIVATION' && new Date(a.activatesAt).getTime() <= now,
    );
    if (due) void fetchAddresses();
  }, [now, addresses, fetchAddresses]);

  useEffect(() => { void fetchAddresses(); }, [fetchAddresses]);

  /* ─── Lock to Bank tab until a fiat withdrawal address exists ── */
  // No active fiat address → the Crypto Addresses tab is disabled; force the Bank
  // Accounts tab so the customer can only add the required fiat address first.
  useEffect(() => {
    if (!tradingReadinessLoading && !tradingReady) setActiveTab('bank');
  }, [tradingReadinessLoading, tradingReady]);

  /* ─── Derived ────────────────────────────────────────────── */
  const visibleAddresses = addresses.filter(a => a.addressType !== 'BANK');
  const activeCount = addresses.filter(a => a.addressType !== 'BANK' && SLOT_HOLDING_STATUSES.includes(a.status)).length;
  const canAdd = activeCount < 3 && tradingReady;

  // Crypto cards grouped by network for display (group title = network code)
  const visibleAddressesByNetwork = new Map<string, WithdrawalAddr[]>();
  for (const addr of visibleAddresses) {
    const group = visibleAddressesByNetwork.get(addr.network) ?? [];
    group.push(addr);
    visibleAddressesByNetwork.set(addr.network, group);
  }

  // Bank tab derived
  const bankAddresses = addresses.filter(a => a.addressType === 'BANK' && a.status !== 'CANCELLED');
  const bankActiveCount = addresses.filter(a => a.addressType === 'BANK' && SLOT_HOLDING_STATUSES.includes(a.status)).length;
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
    if (!formNetwork) { setFormError('Please select a network'); return; }
    if (!formAddress.trim()) { setFormError('Wallet address is required'); return; }
    if (!formHosting) { setFormError('Please tell us how this wallet is held'); return; }
    if (formOwnerType === 'THIRD_PARTY') {
      if (!formBeneficiary.trim()) { setFormError('Beneficiary name is required'); return; }
      if (!formRelationship.trim()) { setFormError('Relationship to the beneficiary is required'); return; }
    }
    if (!formDeclaration) { setFormError('You must accept the ownership declaration'); return; }

    setSubmitting(true);
    try {
      const res = await customerFetch(`${API}/client/withdrawal-addresses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          network: formNetwork,
          address: formAddress.trim(),
          ownershipDeclaration: true,
          ownerType: formOwnerType,
          declaredHosting: formHosting,
          label: formLabel.trim() || undefined,
          ...(formOwnerType === 'THIRD_PARTY'
            ? { beneficiaryName: formBeneficiary.trim(), beneficiaryRelationship: formRelationship.trim() }
            : {}),
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
    setFormOwnerType('SELF');
    setFormBeneficiary('');
    setFormRelationship('');
    setFormHosting('');
    setFormLabel('');
    setFormAddress('');
    setFormMemo('');
    setFormDeclaration(false);
    setFormError('');
  };

  const openAddModal = () => {
    resetForm();
    if (chainNetworks.length > 0 && !formNetwork) setFormNetwork(chainNetworks[0].network);
    setShowAddModal(true);
  };

  const resetBankForm = () => {
    setBankFormOwnerType('SELF');
    setBankFormBeneficiary('');
    setBankFormRelationship('');
    setBankFormBankName('');
    setBankFormIban('');
    setBankFormSwift('');
    setBankFormLabel('');
    setBankFormDeclaration(false);
    setBankFormError('');
  };

  const openBankAddModal = () => {
    resetBankForm();
    setShowBankAddModal(true);
  };

  const handleBankSubmit = async () => {
    setBankFormError('');
    if (!bankFormBeneficiary.trim()) { setBankFormError('Beneficiary name is required'); return; }
    if (bankFormOwnerType === 'THIRD_PARTY' && !bankFormRelationship.trim()) { setBankFormError('Relationship to the beneficiary is required'); return; }
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
          ownerType: bankFormOwnerType,
          beneficiaryName: bankFormBeneficiary.trim(),
          ...(bankFormOwnerType === 'THIRD_PARTY' ? { beneficiaryRelationship: bankFormRelationship.trim() } : {}),
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

  /* ─── Cancel registration (PENDING_VERIFICATION / PENDING_ACTIVATION) ─── */
  const startCancel = (addressNo: string) => {
    setCancelConfirmFor(addressNo);
    setCancelReason('');
    setCancelError('');
  };

  const resetCancelState = () => {
    setCancelConfirmFor(null);
    setCancelReason('');
    setCancelError('');
  };

  const handleCancel = async (addr: WithdrawalAddr) => {
    if (!cancelReason.trim()) return;
    setCancelError('');
    setCancelling(true);
    try {
      const res = await customerFetch(`${API}/client/withdrawal-addresses/${addr.addressNo}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason }),
      });
      if (!res.ok) {
        setCancelError(await getCustomerApiErrorMessage(res, 'Failed to cancel registration'));
        return;
      }
      resetCancelState();
      await fetchAddresses();
    } catch (err: any) {
      if (err instanceof CustomerSessionError) return;
      setCancelError(err.message || 'Unexpected error');
    } finally {
      setCancelling(false);
    }
  };

  /* ─── Deactivate ─────────────────────────────────────────── */
  const handleDeactivate = async () => {
    const addr = detailAddr || bankDetailAddr;
    if (!addr || !deactivateReason.trim()) return;

    setDeactivateError('');
    setDeactivating(true);
    try {
      const res = await customerFetch(`${API}/client/withdrawal-addresses/${addr.addressNo}/deactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: deactivateReason }),
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
      setDeactivateReason('');
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
    setDeactivateReason('');
  };

  const closeDetail = () => {
    setDetailAddr(null);
    resetDeactivateState();
    setEditError('');
    setSignError('');
  };

  /* ─── Wallet signature verification (mock: passes on click) ─── */
  const handleVerifySignature = async () => {
    if (!detailAddr) return;
    setSignError('');
    setSigning(true);
    try {
      const res = await customerFetch(`${API}/client/withdrawal-addresses/${detailAddr.addressNo}/verify-signature`, {
        method: 'POST',
      });
      if (!res.ok) {
        setSignError(await getCustomerApiErrorMessage(res, 'Signature verification failed'));
        return;
      }
      // 通过后条目进入冷却期：详情就地换成返回的新状态，列表同步重拉
      setDetailAddr(await res.json());
      await fetchAddresses();
    } catch (err: any) {
      if (err instanceof CustomerSessionError) return;
      setSignError(err.message || 'Unexpected error');
    } finally {
      setSigning(false);
    }
  };

  /* ─── Edit label (crypto detail modal) ──────────────────────── */
  const openDetail = (addr: WithdrawalAddr) => {
    resetDeactivateState();
    setDetailAddr(addr);
    setEditLabel(addr.label ?? '');
    setEditError('');
    setSignError('');
  };

  const handleEditSave = async () => {
    const addr = detailAddr || bankDetailAddr;
    if (!addr) return;
    setEditError('');
    setEditSubmitting(true);
    try {
      const res = await customerFetch(`${API}/client/withdrawal-addresses/${addr.addressNo}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: editLabel.trim() }),
      });
      if (!res.ok) {
        setEditError(await getCustomerApiErrorMessage(res, 'Failed to update address'));
        return;
      }
      const updated = await res.json();
      if (detailAddr) setDetailAddr(updated);
      if (bankDetailAddr) setBankDetailAddr(updated);
      await fetchAddresses();
    } catch (err: any) {
      if (err instanceof CustomerSessionError) return;
      setEditError(err.message || 'Unexpected error');
    } finally {
      setEditSubmitting(false);
    }
  };

  /* ─── Edit label (bank detail modal) ────────────────────────── */
  const openBankDetail = (addr: WithdrawalAddr) => {
    resetDeactivateState();
    setBankDetailAddr(addr);
    setEditLabel(addr.label ?? '');
    setEditError('');
  };

  const closeBankDetail = () => {
    setBankDetailAddr(null);
    resetDeactivateState();
    setEditError('');
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
              onClick={() => { if (tradingReady) setActiveTab('crypto'); }}
              disabled={!tradingReady}
              title={!tradingReady ? 'Add a fiat withdrawal address first' : undefined}
              className={`px-6 py-4 text-sm font-bold transition-colors border-b-[3px] flex-1 sm:flex-none whitespace-nowrap ${
                !tradingReady
                  ? 'border-transparent text-fx-dust/40 cursor-not-allowed'
                  : activeTab === 'crypto'
                    ? 'border-fx-brass text-fx-brass bg-fx-ink/40'
                    : 'border-transparent text-fx-dust hover:text-fx-dune'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                {!tradingReady ? <Lock size={16} /> : <Wallet size={18} />}
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
              <div className="space-y-5">
                {Array.from(visibleAddressesByNetwork, ([network, group]) => (
                  <div key={network} className="space-y-3">
                    <div className="text-xs font-bold uppercase tracking-wider text-fx-dust">{network}</div>
                    {group.map(addr => (
                      <div
                        key={addr.addressNo}
                        onClick={() => { if (cancelConfirmFor !== addr.addressNo) openDetail(addr); }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && cancelConfirmFor !== addr.addressNo) { e.preventDefault(); openDetail(addr); } }}
                        className="w-full cursor-pointer text-left rounded-2xl border border-fx-rule bg-fx-charcoal/40 p-4 hover:border-fx-brass/40 hover:bg-fx-charcoal/60 transition-all group"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-fx-sand truncate">
                                {addr.label || truncAddr(addr.address)}
                              </span>
                              <span className="shrink-0 text-[10px] font-bold uppercase text-fx-dust bg-fx-charcoal px-1.5 py-0.5 rounded">
                                {addr.network}
                              </span>
                              {addr.ownerType === 'THIRD_PARTY' && <ThirdPartyBadge />}
                            </div>
                            <div className="mt-1 text-xs font-mono text-fx-dust truncate">
                              {truncAddr(addr.address)}
                            </div>
                            {addr.ownerType === 'THIRD_PARTY' && (
                              <div className="mt-0.5 text-[11px] text-fx-dust/70 truncate">
                                {thirdPartyLine(addr)}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2.5 shrink-0">
                            {isCancellable(addr.status) && (
                              <>
                                {addr.status === 'PENDING_ACTIVATION' ? (
                                  <div className="flex items-center gap-1 text-xs font-mono text-amber-400">
                                    <Clock size={12} />
                                    {formatCountdown(addr.activatesAt, now)}
                                  </div>
                                ) : (
                                  <div className="text-xs text-fx-brass">Signature needed</div>
                                )}
                                {cancelConfirmFor !== addr.addressNo && (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); startCancel(addr.addressNo); }}
                                    onKeyDown={(e) => e.stopPropagation()}
                                    className="text-xs font-semibold text-rose-400 hover:underline"
                                  >
                                    Cancel registration
                                  </button>
                                )}
                              </>
                            )}
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${statusColor(addr.status)}`}>
                              {statusLabel(addr.status)}
                            </span>
                            <ChevronRight size={16} className="text-fx-dust group-hover:text-fx-brass transition-colors" />
                          </div>
                        </div>
                        {cancelConfirmFor === addr.addressNo && (
                          <div
                            onClick={e => e.stopPropagation()}
                            onKeyDown={e => e.stopPropagation()}
                            className="mt-3 pt-3 border-t border-fx-rule space-y-3"
                          >
                            {cancelError && (
                              <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2.5 text-xs text-rose-400">
                                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                                {cancelError}
                              </div>
                            )}
                            <div>
                              <label className="text-xs text-fx-dust font-medium block mb-1">Reason</label>
                              <textarea
                                value={cancelReason}
                                onChange={e => setCancelReason(e.target.value)}
                                placeholder="Why are you cancelling this registration?"
                                className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass h-16 resize-none"
                              />
                            </div>
                            <div className="flex gap-3">
                              <button
                                onClick={resetCancelState}
                                disabled={cancelling}
                                className="flex-1 py-3 bg-fx-ink border border-fx-rule text-fx-dune font-semibold rounded-xl hover:bg-fx-charcoal transition-colors disabled:opacity-60"
                              >
                                Keep registration
                              </button>
                              <button
                                onClick={() => handleCancel(addr)}
                                disabled={cancelling || !cancelReason.trim()}
                                className="flex-1 py-3 bg-rose-500/90 text-white font-bold rounded-xl hover:bg-rose-500 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                              >
                                {cancelling && <RefreshCw size={16} className="animate-spin" />}
                                {cancelling ? 'Cancelling...' : 'Confirm Cancel'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
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
                <div className="text-xs font-bold uppercase tracking-wider text-fx-dust">
                  {bankAddresses[0].network} · Bank accounts
                </div>
                {bankAddresses.map(addr => (
                  <div
                    key={addr.addressNo}
                    onClick={() => { if (cancelConfirmFor !== addr.addressNo) openBankDetail(addr); }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && cancelConfirmFor !== addr.addressNo) { e.preventDefault(); openBankDetail(addr); } }}
                    className="w-full cursor-pointer text-left rounded-2xl border border-fx-rule bg-fx-charcoal/40 p-4 hover:border-fx-brass/40 hover:bg-fx-charcoal/60 transition-all group"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-fx-sand truncate">
                            {addr.label || (addr.iban ? maskIban(addr.iban) : 'Bank Account')}
                          </span>
                          <span className="shrink-0 text-[10px] font-bold uppercase text-fx-dust bg-fx-charcoal px-1.5 py-0.5 rounded">
                            {addr.network}
                          </span>
                          {addr.ownerType === 'THIRD_PARTY' && <ThirdPartyBadge />}
                        </div>
                        <div className="mt-1 text-xs font-mono text-fx-dust truncate">
                          {addr.iban ? maskIban(addr.iban) : '—'}
                        </div>
                        {addr.bankName && (
                          <div className="mt-0.5 text-[11px] text-fx-dust/70 truncate">
                            {addr.bankName}
                          </div>
                        )}
                        {addr.ownerType === 'THIRD_PARTY' && (
                          <div className="mt-0.5 text-[11px] text-fx-dust/70 truncate">
                            {thirdPartyLine(addr)}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0">
                        {addr.status === 'PENDING_ACTIVATION' && (
                          <>
                            <div className="flex items-center gap-1 text-xs font-mono text-amber-400">
                              <Clock size={12} />
                              {formatCountdown(addr.activatesAt, now)}
                            </div>
                            {cancelConfirmFor !== addr.addressNo && (
                              <button
                                onClick={(e) => { e.stopPropagation(); startCancel(addr.addressNo); }}
                                onKeyDown={(e) => e.stopPropagation()}
                                className="text-xs font-semibold text-rose-400 hover:underline"
                              >
                                Cancel registration
                              </button>
                            )}
                          </>
                        )}
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${statusColor(addr.status)}`}>
                          {statusLabel(addr.status)}
                        </span>
                        <ChevronRight size={16} className="text-fx-dust group-hover:text-fx-brass transition-colors" />
                      </div>
                    </div>
                    {cancelConfirmFor === addr.addressNo && (
                      <div
                        onClick={e => e.stopPropagation()}
                        onKeyDown={e => e.stopPropagation()}
                        className="mt-3 pt-3 border-t border-fx-rule space-y-3"
                      >
                        {cancelError && (
                          <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2.5 text-xs text-rose-400">
                            <AlertCircle size={14} className="mt-0.5 shrink-0" />
                            {cancelError}
                          </div>
                        )}
                        <div>
                          <label className="text-xs text-fx-dust font-medium block mb-1">Reason</label>
                          <textarea
                            value={cancelReason}
                            onChange={e => setCancelReason(e.target.value)}
                            placeholder="Why are you cancelling this registration?"
                            className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass h-16 resize-none"
                          />
                        </div>
                        <div className="flex gap-3">
                          <button
                            onClick={resetCancelState}
                            disabled={cancelling}
                            className="flex-1 py-3 bg-fx-ink border border-fx-rule text-fx-dune font-semibold rounded-xl hover:bg-fx-charcoal transition-colors disabled:opacity-60"
                          >
                            Keep registration
                          </button>
                          <button
                            onClick={() => handleCancel(addr)}
                            disabled={cancelling || !cancelReason.trim()}
                            className="flex-1 py-3 bg-rose-500/90 text-white font-bold rounded-xl hover:bg-rose-500 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                          >
                            {cancelling && <RefreshCw size={16} className="animate-spin" />}
                            {cancelling ? 'Cancelling...' : 'Confirm Cancel'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
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

              {/* Network */}
              <div>
                <label className="text-xs text-fx-dust font-medium block mb-1">Network</label>
                <select
                  value={formNetwork}
                  onChange={e => setFormNetwork(e.target.value)}
                  className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm focus:outline-none focus:border-fx-brass"
                >
                  {chainNetworks.map(n => (
                    <option key={n.network} value={n.network}>{n.label}</option>
                  ))}
                </select>
              </div>

              {/* Beneficiary */}
              <OwnerTypeChoice name="crypto-owner-type" value={formOwnerType} onChange={setFormOwnerType} />

              {formOwnerType === 'THIRD_PARTY' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-fx-dust font-medium block mb-1">Beneficiary Name</label>
                    <input
                      value={formBeneficiary}
                      onChange={e => setFormBeneficiary(e.target.value)}
                      placeholder="Full name of the wallet owner"
                      className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-fx-dust font-medium block mb-1">Relationship to you</label>
                    <input
                      value={formRelationship}
                      onChange={e => setFormRelationship(e.target.value)}
                      placeholder="e.g. Spouse, Business partner"
                      className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
                    />
                  </div>
                </div>
              )}

              {/* Wallet hosting */}
              <div>
                <label className="text-xs text-fx-dust font-medium block mb-1">Wallet hosting</label>
                <div role="radiogroup" aria-label="Wallet hosting" className="flex gap-2">
                  <ChoiceCard
                    name="crypto-hosting"
                    checked={formHosting === 'SELF_CUSTODY'}
                    onSelect={() => setFormHosting('SELF_CUSTODY')}
                    title="Self-custody wallet"
                    hint="You hold the keys"
                  />
                  <ChoiceCard
                    name="crypto-hosting"
                    checked={formHosting === 'VASP'}
                    onSelect={() => setFormHosting('VASP')}
                    title="Hosted by an exchange (VASP)"
                    hint="An exchange holds the keys"
                  />
                </div>
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
                      {formOwnerType === 'THIRD_PARTY'
                        ? 'I declare that this wallet address belongs to the beneficiary named above, that I am authorised to send funds to it, and that the relationship I have stated is accurate. I understand that providing false information may result in account suspension and regulatory action.'
                        : 'I declare that I am the sole owner and controller of this wallet address. I understand that providing false information may result in account suspension and regulatory action.'}
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
                    {formatCountdown(detailAddr.activatesAt, now)}
                  </div>
                  <div className="mt-1 text-xs text-fx-dust">
                    {new Date(detailAddr.activatesAt).toLocaleString()}
                  </div>
                </div>
              )}

              {/* Wallet signature needed (self-custody x myself) */}
              {needsSignature(detailAddr) && (
                <div className="rounded-xl border border-fx-brass/25 bg-fx-brass/5 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <ShieldCheck size={18} className="text-fx-brass shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-bold text-fx-brass">Wallet signature needed</div>
                      <p className="text-xs text-fx-dune mt-1 leading-relaxed">
                        Prove this wallet is yours by signing a short message with it. Once verified, the address starts its cooling period.
                      </p>
                    </div>
                  </div>
                  {signError && (
                    <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2.5 text-xs text-rose-400">
                      <AlertCircle size={14} className="mt-0.5 shrink-0" />
                      {signError}
                    </div>
                  )}
                  <button
                    onClick={handleVerifySignature}
                    disabled={signing}
                    className="w-full py-2.5 bg-fx-brass text-fx-obsidian font-bold rounded-xl hover:shadow-lg hover:shadow-fx-brass/20 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {signing && <RefreshCw size={16} className="animate-spin" />}
                    {signing ? 'Verifying...' : 'Verify wallet signature'}
                  </button>
                </div>
              )}

              {detailAddr.status === 'REJECTED' && <NotApprovedNotice noun="address" />}

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
              <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-4">
                <div className="flex items-center gap-2">
                  <div className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Beneficiary</div>
                  {detailAddr.ownerType === 'THIRD_PARTY' && <ThirdPartyBadge />}
                </div>
                <div className="mt-1 text-sm font-semibold text-fx-sand">{beneficiaryText(detailAddr)}</div>
                {detailAddr.ownerType === 'THIRD_PARTY' && detailAddr.beneficiaryRelationship && (
                  <div className="mt-0.5 text-xs text-fx-dust">Relationship: {detailAddr.beneficiaryRelationship}</div>
                )}
              </div>

              {/* VASP Info */}
              {detailAddr.counterpartyVaspName && (
                <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-4">
                  <div className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Counterparty VASP</div>
                  <div className="mt-1 text-sm font-semibold text-fx-sand">{detailAddr.counterpartyVaspName}</div>
                </div>
              )}

              {/* Ownership evidence */}
              <OwnershipNote addr={detailAddr} />

              {/* Edit — hidden for terminal states (CANCELLED / DEACTIVATED / REJECTED) */}
              {!isTerminalStatus(detailAddr.status) && (
                <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-4 space-y-3">
                  <label className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Edit</label>
                  {editError && (
                    <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2.5 text-xs text-rose-400">
                      <AlertCircle size={14} className="mt-0.5 shrink-0" />
                      {editError}
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-fx-dust font-medium block mb-1">Label</label>
                    <input
                      value={editLabel}
                      onChange={e => setEditLabel(e.target.value)}
                      className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
                    />
                  </div>
                  <button
                    onClick={handleEditSave}
                    disabled={editSubmitting}
                    className="w-full py-2.5 bg-fx-brass text-fx-obsidian font-bold rounded-xl hover:shadow-lg hover:shadow-fx-brass/20 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {editSubmitting && <RefreshCw size={16} className="animate-spin" />}
                    {editSubmitting ? 'Saving...' : 'Save'}
                  </button>
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
                  <div>
                    <label className="text-xs text-fx-dust font-medium block mb-1">Reason</label>
                    <textarea
                      value={deactivateReason}
                      onChange={e => setDeactivateReason(e.target.value)}
                      placeholder="Why are you deactivating this address?"
                      className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass h-16 resize-none"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={resetDeactivateState}
                      disabled={deactivating}
                      className="flex-1 py-3 bg-fx-ink border border-fx-rule text-fx-dune font-semibold rounded-xl hover:bg-fx-charcoal transition-colors disabled:opacity-60"
                    >
                      Keep Address
                    </button>
                    <button
                      onClick={handleDeactivate}
                      disabled={deactivating || !deactivateReason.trim()}
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

              {/* Beneficiary */}
              <OwnerTypeChoice name="bank-owner-type" value={bankFormOwnerType} onChange={setBankFormOwnerType} />

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

              {bankFormOwnerType === 'THIRD_PARTY' && (
                <div>
                  <label className="text-xs text-fx-dust font-medium block mb-1">Relationship to you</label>
                  <input
                    value={bankFormRelationship}
                    onChange={e => setBankFormRelationship(e.target.value)}
                    placeholder="e.g. Spouse, Business partner"
                    className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
                  />
                </div>
              )}

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
                      {bankFormOwnerType === 'THIRD_PARTY'
                        ? 'I declare that this bank account belongs to the beneficiary named above, that I am authorised to send funds to it, and that the relationship I have stated is accurate. I understand that providing false information may result in account suspension and regulatory action.'
                        : 'I declare that I am the sole owner and controller of this bank account. I understand that providing false information may result in account suspension and regulatory action.'}
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
                    {formatCountdown(bankDetailAddr.activatesAt, now)}
                  </div>
                  <div className="mt-1 text-xs text-fx-dust">
                    {new Date(bankDetailAddr.activatesAt).toLocaleString()}
                  </div>
                </div>
              )}

              {bankDetailAddr.status === 'REJECTED' && <NotApprovedNotice noun="account" />}

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
                  <div className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Bank</div>
                  <div className="mt-1 text-sm font-semibold text-fx-sand">{bankDetailAddr.bankName || '—'}</div>
                </div>
                <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-3">
                  <div className="flex items-center gap-2">
                    <div className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Beneficiary</div>
                    {bankDetailAddr.ownerType === 'THIRD_PARTY' && <ThirdPartyBadge />}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-fx-sand">{beneficiaryText(bankDetailAddr)}</div>
                  {bankDetailAddr.ownerType === 'THIRD_PARTY' && bankDetailAddr.beneficiaryRelationship && (
                    <div className="mt-0.5 text-xs text-fx-dust">Relationship: {bankDetailAddr.beneficiaryRelationship}</div>
                  )}
                </div>
                <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-3">
                  <div className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Registered</div>
                  <div className="mt-1 text-sm text-fx-sand">
                    {new Date(bankDetailAddr.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>

              {/* Ownership evidence */}
              <OwnershipNote addr={bankDetailAddr} />

              {/* Edit — hidden for terminal states (CANCELLED / DEACTIVATED / REJECTED) */}
              {!isTerminalStatus(bankDetailAddr.status) && (
                <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-4 space-y-3">
                  <label className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Edit</label>
                  {editError && (
                    <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2.5 text-xs text-rose-400">
                      <AlertCircle size={14} className="mt-0.5 shrink-0" />
                      {editError}
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-fx-dust font-medium block mb-1">Label</label>
                    <input
                      value={editLabel}
                      onChange={e => setEditLabel(e.target.value)}
                      className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
                    />
                  </div>
                  <button
                    onClick={handleEditSave}
                    disabled={editSubmitting}
                    className="w-full py-2.5 bg-fx-brass text-fx-obsidian font-bold rounded-xl hover:shadow-lg hover:shadow-fx-brass/20 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {editSubmitting && <RefreshCw size={16} className="animate-spin" />}
                    {editSubmitting ? 'Saving...' : 'Save'}
                  </button>
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
                  <div>
                    <label className="text-xs text-fx-dust font-medium block mb-1">Reason</label>
                    <textarea
                      value={deactivateReason}
                      onChange={e => setDeactivateReason(e.target.value)}
                      placeholder="Why are you deactivating this account?"
                      className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass h-16 resize-none"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={resetDeactivateState}
                      disabled={deactivating}
                      className="flex-1 py-3 bg-fx-ink border border-fx-rule text-fx-dune font-semibold rounded-xl hover:bg-fx-charcoal transition-colors disabled:opacity-60"
                    >
                      Keep Account
                    </button>
                    <button
                      onClick={handleDeactivate}
                      disabled={deactivating || !deactivateReason.trim()}
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
