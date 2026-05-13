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

/* ── Interfaces ── */

interface AssetOption {
  id: string;
  assetNo: string;
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
  const [ownerId, setOwnerId] = useState('');

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
  const filteredRoles = selectedAsset
    ? WALLET_ROLE_OPTIONS.filter((r) => ROLE_ASSET_TYPE[r]?.includes(selectedAsset.type))
    : WALLET_ROLE_OPTIONS;

  const needsOwnerId = role ? ROLE_OWNER_TYPE[role] === 'CUSTOMER' : false;

  /* ── Reset role when asset changes and role becomes invalid ── */

  useEffect(() => {
    if (role && !filteredRoles.includes(role)) {
      setRole('');
    }
  }, [assetNo]);

  /* ── Submit ── */

  const handleSubmit = async () => {
    setError('');

    if (!assetNo) { setError('Please select an asset.'); return; }
    if (!role) { setError('Please select a role.'); return; }
    if (needsOwnerId && !ownerId.trim()) { setError('Owner ID is required for this role.'); return; }

    setSubmitting(true);
    try {
      const body: Record<string, string> = { assetNo, role, custodianProvider: 'HEXTRUST' };
      if (vaultId.trim()) body.vaultId = vaultId.trim();
      if (needsOwnerId && ownerId.trim()) body.ownerId = ownerId.trim();

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
                  {a.code} ({a.type}) — {a.assetNo}
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

          {/* Custodian Provider (display-only) */}
          <div>
            <label className={labelCls}>Custodian Provider</label>
            <select value="HEXTRUST" disabled className={inputCls}>
              <option value="HEXTRUST">HexTrust</option>
            </select>
          </div>

          {/* Vault ID (optional) */}
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

          {/* Owner ID (conditional) */}
          {needsOwnerId && (
            <div>
              <label className={labelCls}>Owner ID (Customer UUID)</label>
              <input
                type="text"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
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
