import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { AdminBadge } from '../components/ui/AdminBadge';
import { PageTitleBar } from '../components/ui/PageTitleBar';

/* ── Interfaces ──────────────────────────────────────────────── */

interface RolePermission {
  code: string;
  method: string;
  path: string;
  name: string;
  description: string;
}

interface RoleItem {
  id: string;
  code: string;
  name: string;
  description: string;
  status: string;
  permissions: RolePermission[];
}

/* ─────────────────────────────────────────────────────────────── */

const RolesPage = () => {
  const navigate = useNavigate();

  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* Filters — client-side */
  const [keyword, setKeyword] = useState('');
  const [applied, setApplied] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  /* ── Data fetching ── */

  const loadRoles = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/iam/roles`,
      );
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load roles.'));
      }
      const payload = (await response.json()) as RoleItem[];
      setRoles(Array.isArray(payload) ? payload : []);
    } catch (err: unknown) {
      if (err instanceof AdminSessionError) return;
      if (err instanceof AdminPermissionError) {
        setError('Permission denied. You cannot view the role catalog.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load roles.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadRoles(); }, []);

  /* ── Derived ── */

  const filteredRoles = useMemo(() => {
    const kw = applied.trim().toLowerCase();
    return roles.filter((r) => {
      const matchKw =
        !kw ||
        r.code?.toLowerCase().includes(kw) ||
        r.name?.toLowerCase().includes(kw) ||
        r.description?.toLowerCase().includes(kw);
      const matchStatus = !statusFilter || r.status === statusFilter;
      return matchKw && matchStatus;
    });
  }, [applied, statusFilter, roles]);

  const totalPermissions = useMemo(
    () => roles.reduce((sum, r) => sum + (r.permissions?.length ?? 0), 0),
    [roles],
  );

  const hasFilter = !!keyword.trim() || !!applied.trim() || !!statusFilter;

  /* ── Input style ── */
  const fi =
    'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  /* ── Render ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Title bar ── */}
      <PageTitleBar
        title="Roles"
        meta={`${roles.length} role${roles.length === 1 ? '' : 's'} · ${totalPermissions} permission bindings · Identity & Access`}
      >
        <button
          onClick={() => void loadRoles()}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {/* ── Filter bar ── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-adm-border bg-adm-panel px-5 py-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && setApplied(keyword.trim())}
          placeholder="Code / Name / Description"
          className={`${fi} w-56`}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={`${fi} w-32`}
        >
          <option value="">All Status</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="INACTIVE">INACTIVE</option>
        </select>
        <button
          onClick={() => setApplied(keyword.trim())}
          className={adminButtonClass('listPrimary')}
        >
          <Search size={13} />
          Search
        </button>
        <button
          onClick={() => { setKeyword(''); setApplied(''); setStatusFilter(''); }}
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
                  ['Code',        '200px'],
                  ['Name',        '200px'],
                  ['Status',      '100px'],
                  ['Permissions', '130px'],
                  ['Description', 'auto'],
                ] as [string, string][]
              ).map(([label, w]) => (
                <th
                  key={label}
                  style={{ width: w === 'auto' ? undefined : w }}
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
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3"
                >
                  Loading…
                </td>
              </tr>
            )}
            {!loading && filteredRoles.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3"
                >
                  {roles.length === 0 ? 'No roles found.' : 'No roles match the current filters.'}
                </td>
              </tr>
            )}
            {!loading &&
              filteredRoles.map((role) => (
                <tr
                  key={role.id}
                  className="cursor-pointer border-b border-adm-border transition-colors hover:bg-adm-hover"
                  onClick={() => navigate(`/dashboard/members/roles/${encodeURIComponent(role.code)}`)}
                >
                  {/* Code — amber mono dominant identifier */}
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[11px] font-semibold text-adm-amber">
                      {role.code || '—'}
                    </span>
                  </td>
                  {/* Name */}
                  <td className="px-4 py-2.5 font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                    {role.name || <span className="text-adm-t3">—</span>}
                  </td>
                  {/* Status */}
                  <td className="px-4 py-2.5">
                    <AdminBadge value={role.status} />
                  </td>
                  {/* Permissions count */}
                  <td className="px-4 py-2.5 font-mono text-[11px] font-semibold text-adm-t1">
                    {role.permissions?.length ?? 0}
                  </td>
                  {/* Description */}
                  <td className="max-w-0 px-4 py-2.5 font-mono text-[10px] text-adm-t3">
                    <span className="block truncate">
                      {role.description || '—'}
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* ── Footer ── */}
      <div className="shrink-0 border-t border-adm-border bg-adm-panel px-5 py-2.5">
        <span className="font-mono text-[10px] text-adm-t3">
          Showing {filteredRoles.length} / {roles.length} role{roles.length === 1 ? '' : 's'}
          {' · '}
          Fixed backend catalog
        </span>
      </div>

    </div>
  );
};

export default RolesPage;
