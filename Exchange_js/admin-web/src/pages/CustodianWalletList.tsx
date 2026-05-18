import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search, Plus, RotateCcw } from 'lucide-react';
import Pagination from '../components/common/Pagination';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { WalletRoleBadge, WALLET_ROLE_OPTIONS } from '../utils/walletRole.util';
import { formatAssetAmount } from '../utils/number-format';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import CustodianWalletCreateModal from './CustodianWalletCreateModal';

/* ── Interfaces ──────────────────────────────────────────────── */

interface WalletItem {
  id: string;
  walletNo: string | null;
  walletRole: string;
  surfaceCategory?: string;
  ownerType: string;
  ownerId: string | null;
  ownerNo: string | null;
  ownerName?: string | null;
  type: string;
  direction: string;
  balance: string;
  asset: { currency: string; code: string; type: string; network?: string | null; decimals?: number };
  status: string;
  vaultId?: string | null;
  updatedAt: string;
}

interface WalletListResponse {
  total: number;
  items: WalletItem[];
}

interface FilterState {
  ownerIdSearch: string;
  ownerType: string;
  walletRole: string;
  type: string;
  status: string;
}

/* ── Helpers ─────────────────────────────────────────────────── */

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

/* ── Constants ───────────────────────────────────────────────── */

const PAGE_SIZE = 20;

const DEFAULT_FILTERS: FilterState = {
  ownerIdSearch: '',
  ownerType: '',
  walletRole: '',
  type: '',
  status: '',
};

/* ── Component ───────────────────────────────────────────────── */

const CustodianWalletList = () => {
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();
  const canCreate = hasAnyPermission([PERMISSIONS.CUSTODIAN_WALLET_CREATE]);
  const canRetry = hasAnyPermission([PERMISSIONS.CUSTODIAN_WALLET_RETRY]);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<WalletItem[]>([]);
  const [total, setTotal] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestSeqRef = useRef(0);

  /* ── Data fetching ── */

  const buildParams = (page: number, next: FilterState) => {
    const params = new URLSearchParams();
    params.set('skip', String((page - 1) * PAGE_SIZE));
    params.set('take', String(PAGE_SIZE));
    if (next.ownerIdSearch.trim()) params.set('ownerId', next.ownerIdSearch.trim());
    if (next.ownerType) params.set('ownerType', next.ownerType);
    if (next.walletRole) params.set('walletRole', next.walletRole);
    if (next.type) params.set('type', next.type);
    if (next.status) params.set('status', next.status);
    return params;
  };

  const fetchItems = async (page: number, next: FilterState = filters) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/wallets?${buildParams(page, next).toString()}`,
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Failed to load wallets.'));

      const data = (await res.json()) as WalletListResponse;
      if (seq !== requestSeqRef.current) return;
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
      setCurrentPage(page);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to load wallets.');
    } finally {
      if (seq === requestSeqRef.current) setLoading(false);
    }
  };

  useEffect(() => { void fetchItems(1, DEFAULT_FILTERS); }, []);

  /* ── Input style ── */
  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  const hasFilter =
    !!filters.ownerIdSearch || !!filters.ownerType || !!filters.walletRole
    || !!filters.type || !!filters.status;

  const updateFilter = (key: keyof FilterState, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const handleSearch = () => void fetchItems(1, filters);

  const handleReset = () => {
    setFilters(DEFAULT_FILTERS);
    void fetchItems(1, DEFAULT_FILTERS);
  };

  /* ── Status toggle ── */

  const handleStatusChange = async (wallet: WalletItem) => {
    if (wallet.status === 'FROZEN') return;
    const newStatus = wallet.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    if (!window.confirm(`${newStatus === 'DISABLED' ? 'Disable' : 'Enable'} wallet ${wallet.walletNo}?`)) return;

    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/wallets/${wallet.id}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        },
      );
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Failed to update wallet status.'));
        return;
      }
      void fetchItems(currentPage);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Failed to update wallet status.');
    }
  };

  const handleRetry = async (walletNo: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Retry vault creation for wallet ${walletNo}?`)) return;
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/custodian-wallets/${walletNo}/retry`,
        { method: 'POST' },
      );
      if (!res.ok) {
        setError(await getApiErrorMessage(res, 'Retry failed.'));
        return;
      }
      void fetchItems(currentPage);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Retry failed.');
    }
  };

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Title bar ── */}
      <PageTitleBar
        title="Custodian Wallets"
        meta={`${total} wallet${total === 1 ? '' : 's'} · Treasury`}
      >
        {canCreate && (
          <button
            onClick={() => setShowCreateModal(true)}
            className={adminButtonClass('listPrimary')}
          >
            <Plus size={13} />
            Create Wallet
          </button>
        )}
        <button
          onClick={() => void fetchItems(currentPage)}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* ── Filter bar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <input
          value={filters.ownerIdSearch}
          onChange={(e) => updateFilter('ownerIdSearch', e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Owner ID / No"
          className={`${fi} w-40`}
        />
        <select
          value={filters.ownerType}
          onChange={(e) => updateFilter('ownerType', e.target.value)}
          className={`${fi} w-32`}
        >
          <option value="">All owners</option>
          <option value="PLATFORM">PLATFORM</option>
          <option value="CUSTOMER">CUSTOMER</option>
        </select>
        <select
          value={filters.walletRole}
          onChange={(e) => updateFilter('walletRole', e.target.value)}
          className={`${fi} w-28`}
        >
          <option value="">All roles</option>
          {WALLET_ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select
          value={filters.type}
          onChange={(e) => updateFilter('type', e.target.value)}
          className={`${fi} w-36`}
        >
          <option value="">All types</option>
          <option value="CRYPTO_ADDRESS">CRYPTO_ADDRESS</option>
          <option value="FIAT_BANK">FIAT_BANK</option>
        </select>
        <select
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          className={`${fi} w-36`}
        >
          <option value="">All status</option>
          <option value="PENDING_APPROVAL">PENDING_APPROVAL</option>
          <option value="CREATING">CREATING</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="FAILED">FAILED</option>
          <option value="DISABLED">DISABLED</option>
          <option value="FROZEN">FROZEN</option>
        </select>
        <button onClick={handleSearch} className={adminButtonClass('listPrimary')}>
          <Search size={13} />
          Search
        </button>
        <button
          onClick={handleReset}
          disabled={!hasFilter}
          className={adminButtonClass('listSecondary')}
        >
          Reset
        </button>
      </div>

      {/* ── Notices ── */}
      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {(
                [
                  ['Wallet No',  '160px'],
                  ['Role',       '100px'],
                  ['Owner',      '140px'],
                  ['Asset',      '100px'],
                  ['Balance',    '130px'],
                  ['Status',     '90px'],
                  ['Vault',      '110px'],
                  ['Updated',    '150px'],
                  ['Action',     '100px'],
                ] as [string, string][]
              ).map(([label, w]) => (
                <th
                  key={label}
                  style={{ width: w }}
                  className="border-b border-adm-border bg-adm-panel px-4 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No wallets found.
                </td>
              </tr>
            )}
            {!loading && items.map((w) => {
              const ownerLabel = w.ownerName || w.ownerNo || w.ownerId || '—';
              const statusActionLabel = w.status === 'ACTIVE' ? 'Disable' : w.status === 'DISABLED' ? 'Enable' : null;

              return (
                <tr
                  key={w.id}
                  className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                  onClick={() => navigate(`/dashboard/treasury/custodian-wallets/${w.id}`)}
                >
                  {/* Wallet No */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {w.walletNo || w.id.slice(0, 8)}
                    </span>
                    <div className="mt-0.5 font-mono text-[9px] text-adm-t3">{w.type}</div>
                  </td>

                  {/* Role */}
                  <td className="px-4 py-2.5">
                    <WalletRoleBadge role={w.walletRole} />
                  </td>

                  {/* Owner */}
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-[11px] text-adm-t1">{ownerLabel}</div>
                    <div className="mt-0.5 font-mono text-[9px] text-adm-t3">{w.ownerType}</div>
                  </td>

                  {/* Asset */}
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-[11px] text-adm-t1">{w.asset?.code || '—'}</div>
                    <div className="mt-0.5 font-mono text-[9px] text-adm-t3">{w.asset?.network || '—'}</div>
                  </td>

                  {/* Balance */}
                  <td className="px-4 py-2.5 text-right">
                    <span className="font-mono text-[11px] text-adm-t1">
                      {formatAssetAmount(w.balance ?? '0', w.asset?.decimals)}
                    </span>
                    <span className="ml-1 font-mono text-[9px] text-adm-t3">{w.asset?.code}</span>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-2.5">
                    <AdminBadge value={w.status} />
                  </td>

                  {/* Vault */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[10px] text-adm-t2">
                      {(w as any).vaultId || '—'}
                    </span>
                  </td>

                  {/* Updated */}
                  <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                    {fmt(w.updatedAt)}
                  </td>

                  {/* Action */}
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      {w.status === 'FAILED' && canRetry && w.walletNo && (
                        <button
                          onClick={(e) => void handleRetry(w.walletNo!, e)}
                          className={adminButtonClass('rowSecondaryUtility')}
                        >
                          <RotateCcw size={11} />
                          Retry
                        </button>
                      )}
                      {statusActionLabel && (
                        <button
                          onClick={() => void handleStatusChange(w)}
                          className={adminButtonClass('rowSecondaryUtility')}
                        >
                          {statusActionLabel}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Footer ── */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-adm-t3">
            {total > 0
              ? `Showing ${items.length} / ${total} wallet${total === 1 ? '' : 's'}`
              : 'No wallets'}
          </span>
          {total > PAGE_SIZE && (
            <Pagination
              currentPage={currentPage}
              totalItems={total}
              pageSize={PAGE_SIZE}
              onPageChange={(page) => void fetchItems(page)}
            />
          )}
        </div>
      </div>

      {showCreateModal && (
        <CustodianWalletCreateModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            void fetchItems(1);
          }}
        />
      )}
    </div>
  );
};

export default CustodianWalletList;
