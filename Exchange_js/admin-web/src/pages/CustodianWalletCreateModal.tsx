import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import {
  adminButtonClass,
} from '../components/common/adminButtonStyles';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { WALLET_ROLE_OPTIONS } from '../utils/walletRole.util';

/* ── Role → Asset type filter ── */

const ROLE_ASSET_TYPE: Record<string, string[]> = {
  C_DEP:   ['CRYPTO'],
  C_VIBAN: ['FIAT'],
  C_MAIN:  ['CRYPTO'],
  C_OUT:   ['CRYPTO'],
  C_CMA:   ['FIAT'],
  F_LIQ:   ['CRYPTO', 'FIAT'],
  F_OPS:   ['CRYPTO', 'FIAT'],
};

const ROLE_OWNER_TYPE: Record<string, string> = {
  C_DEP:   'CUSTOMER',
  C_VIBAN: 'CUSTOMER',
  C_MAIN:  'PLATFORM',
  C_OUT:   'PLATFORM',
  C_CMA:   'PLATFORM',
  F_LIQ:   'PLATFORM',
  F_OPS:   'PLATFORM',
};

const FIAT_SYSTEM_ROLES = new Set(['C_CMA', 'F_LIQ', 'F_OPS']);

/* ── Interfaces ── */

interface AssetOption {
  id: string;
  assetNo: string;
  currency: string;
  code: string;
  type: string;
  status: string;
}

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

/* ── Component ── */

export default function CustodianWalletCreateModal({ onClose, onCreated }: Props) {
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);

  const [assetNo, setAssetNo] = useState('');
  const [role, setRole] = useState('');
  const [vaultId, setVaultId] = useState('');
  const [customerNo, setCustomerNo] = useState('');
  const [iban, setIban] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [cmaLoading, setCmaLoading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  /* ── Fetch assets on mount ── */

  useEffect(() => {
    const fetchAssets = async () => {
      try {
        const res = await adminFetch(`${import.meta.env.VITE_API_URL}/assets?take=200`);
        if (!res.ok) return;
        const data = await res.json();
        const items = (data.items ?? data) as AssetOption[];
        setAssets(items.filter((a) => a.status === 'PROVISIONING' || a.status === 'ACTIVE'));
      } catch {
        // ignore — user will see empty dropdown
      } finally {
        setAssetsLoading(false);
      }
    };
    void fetchAssets();
  }, []);

  /* ── Derived state ── */

  const selectedAsset = assets.find((a) => a.assetNo === assetNo);
  const isFiat = selectedAsset?.type === 'FIAT';
  const filteredRoles = selectedAsset
    ? WALLET_ROLE_OPTIONS.filter((r) => ROLE_ASSET_TYPE[r]?.includes(selectedAsset.type))
    : WALLET_ROLE_OPTIONS;

  const needsOwnerId = role ? ROLE_OWNER_TYPE[role] === 'CUSTOMER' : false;
  const needsIban = isFiat && role && FIAT_SYSTEM_ROLES.has(role);
  const isCma = role === 'C_CMA';
  const isViban = role === 'C_VIBAN';
  const needsBankFields = isCma || isViban;
  const provider = isFiat ? 'ZANDBANK' : 'HEXTRUST';
  const providerLabel = isFiat ? 'ZandBank' : 'HexTrust';

  /* ── Reset role when asset changes and role becomes invalid ── */

  useEffect(() => {
    if (role && !filteredRoles.includes(role)) {
      setRole('');
    }
    setIban('');
    setBankName('');
    setAccountName('');
  }, [assetNo]);

  /* ── Fetch CMA bank fields when role=C_VIBAN ── */

  useEffect(() => {
    if (!isViban || !selectedAsset) {
      return;
    }
    const fetchCma = async () => {
      setCmaLoading(true);
      try {
        const res = await adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/custodian-wallets?walletRole=C_CMA&assetId=${selectedAsset.id}&status=ACTIVE&take=1`,
        );
        if (res.ok) {
          const data = await res.json();
          const items = data.items ?? data;
          if (items.length > 0) {
            setBankName(items[0].bankName || '');
            setAccountName(items[0].accountName || '');
          } else {
            setBankName('');
            setAccountName('');
          }
        }
      } catch {
        // ignore
      } finally {
        setCmaLoading(false);
      }
    };
    void fetchCma();
  }, [role, assetNo]);

  /* ── Submit ── */

  const handleSubmit = async () => {
    setError('');

    if (!assetNo) { setError('Please select an asset.'); return; }
    if (!role) { setError('Please select a role.'); return; }
    if (needsOwnerId && !customerNo.trim()) { setError('Customer No is required for this role.'); return; }
    if (needsIban && !iban.trim()) { setError('IBAN is required for this role.'); return; }
    if (isCma && !bankName.trim()) { setError('Bank Name is required for CMA wallets.'); return; }
    if (isCma && !accountName.trim()) { setError('Account Holder is required for CMA wallets.'); return; }

    setSubmitting(true);
    try {
      const body: Record<string, string> = { assetNo, role, custodianProvider: provider };
      if (vaultId.trim()) body.vaultId = vaultId.trim();
      if (needsOwnerId && customerNo.trim()) body.customerNo = customerNo.trim();
      if (needsIban && iban.trim()) body.iban = iban.trim();
      if (isCma && bankName.trim()) body.bankName = bankName.trim();
      if (isCma && accountName.trim()) body.accountName = accountName.trim();

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/custodian-wallets`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to create wallet.'));
        return;
      }

      onCreated();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to create wallet.');
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Input styles ── */

  const inputCls =
    'w-full h-[34px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';
  const labelCls = 'block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-adm-t3 mb-1.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-adm-border bg-white shadow-xl">

        {/* Header */}
        <div className="border-b border-adm-border px-6 py-4">
          <h2 className="text-lg font-semibold text-adm-t1">Create Custodian Wallet</h2>
          <p className="mt-1 text-sm text-adm-t3">Submit a wallet creation request for approval.</p>
        </div>

        {/* Body */}
        <div className="space-y-4 px-6 py-5">

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-adm-red/20 bg-adm-red/6 px-3 py-2 text-sm text-adm-red">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span className="font-mono text-[11px]">{error}</span>
            </div>
          )}

          {/* Asset */}
          <div>
            <label className={labelCls}>Asset</label>
            <select
              value={assetNo}
              onChange={(e) => setAssetNo(e.target.value)}
              className={inputCls}
              disabled={assetsLoading}
            >
              <option value="">{assetsLoading ? 'Loading assets…' : 'Select an asset'}</option>
              {assets.map((a) => (
                <option key={a.assetNo} value={a.assetNo}>
                  {a.code} ({a.type})
                </option>
              ))}
            </select>
          </div>

          {/* Role */}
          <div>
            <label className={labelCls}>Wallet Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={inputCls}
              disabled={!assetNo}
            >
              <option value="">Select a role</option>
              {filteredRoles.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Custodian Provider (display-only, auto-selected by asset type) */}
          <div>
            <label className={labelCls}>Custodian Provider</label>
            <select value={provider} disabled className={inputCls}>
              <option value={provider}>{providerLabel}</option>
            </select>
          </div>

          {/* Vault ID — only for CRYPTO */}
          {!isFiat && (
            <div>
              <label className={labelCls}>Vault ID (optional)</label>
              <input
                type="text"
                value={vaultId}
                onChange={(e) => setVaultId(e.target.value)}
                placeholder="Leave empty to create new vault"
                className={inputCls}
              />
            </div>
          )}

          {/* IBAN — fiat system wallets: paste manually */}
          {needsIban && (
            <div>
              <label className={labelCls}>IBAN</label>
              <input
                type="text"
                value={iban}
                onChange={(e) => setIban(e.target.value)}
                placeholder="e.g. AE070331234567890123456"
                className={inputCls}
              />
            </div>
          )}

          {/* Bank Name — CMA: editable, vIBAN: read-only from CMA */}
          {needsBankFields && (
            <div>
              <label className={labelCls}>Bank Name{isCma ? ' *' : ''}</label>
              <input
                type="text"
                value={bankName}
                onChange={(e) => isCma && setBankName(e.target.value)}
                readOnly={isViban}
                placeholder={isViban ? (cmaLoading ? 'Loading from CMA…' : 'Inherited from CMA') : 'e.g. Zand Bank PJSC'}
                className={`${inputCls} ${isViban ? 'bg-gray-50 text-adm-t3' : ''}`}
              />
            </div>
          )}

          {/* Account Holder — CMA: editable, vIBAN: read-only from CMA */}
          {needsBankFields && (
            <div>
              <label className={labelCls}>Account Holder{isCma ? ' *' : ''}</label>
              <input
                type="text"
                value={accountName}
                onChange={(e) => isCma && setAccountName(e.target.value)}
                readOnly={isViban}
                placeholder={isViban ? (cmaLoading ? 'Loading from CMA…' : 'Inherited from CMA') : 'e.g. FiatX Ltd'}
                className={`${inputCls} ${isViban ? 'bg-gray-50 text-adm-t3' : ''}`}
              />
            </div>
          )}

          {/* Owner ID (conditional) */}
          {needsOwnerId && (
            <div>
              <label className={labelCls}>Customer No</label>
              <input
                type="text"
                value={customerNo}
                onChange={(e) => setCustomerNo(e.target.value)}
                placeholder="e.g. CU2605130001"
                className={inputCls}
              />
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-adm-border px-6 py-4">
          <button
            onClick={onClose}
            disabled={submitting}
            className={adminButtonClass('modalCancel')}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className={adminButtonClass('modalConfirm')}
          >
            {submitting ? 'Submitting…' : 'Submit for Approval'}
          </button>
        </div>

      </div>
    </div>
  );
}
