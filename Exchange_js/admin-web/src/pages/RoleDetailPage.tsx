import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import {
  AdminPermissionError,
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { DetailPageHeader } from '../components/compliance/DetailPageComponents';
import { adminButtonClass } from '../components/common/adminButtonStyles';
import { AdminBadge } from '../components/ui/AdminBadge';

/* ── Interfaces ──────────────────────────────────────────────── */

interface RolePermission {
  code: string;
  method: string;
  path: string;
  name: string;
  description: string;
}

interface RoleDetail {
  id: string;
  code: string;
  name: string;
  description: string;
  status: string;
  permissions: RolePermission[];
}

/* ── Shared layout primitives (per admin-ui-contract §4.2) ───── */

const Cap = ({ children }: { children: ReactNode }) => (
  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    {children}
  </p>
);

const FieldGrid = ({
  children,
  cols = 2,
}: {
  children: ReactNode;
  cols?: 1 | 2;
}) => (
  <div
    className={[
      'grid gap-x-8 gap-y-4',
      cols === 1 ? 'grid-cols-1' : 'grid-cols-2',
    ].join(' ')}
  >
    {children}
  </div>
);

const Field = ({
  label,
  value,
  mono = false,
  amber = false,
  full = false,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  amber?: boolean;
  full?: boolean;
}) => {
  if (!value) return null;
  return (
    <div className={full ? 'col-span-2' : ''}>
      <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">
        {label}
      </p>
      <p
        className={[
          'break-all leading-relaxed',
          mono ? 'font-mono text-[10px]' : 'text-[11px]',
          amber ? 'font-semibold text-adm-amber' : 'text-adm-t2',
        ].join(' ')}
      >
        {value}
      </p>
    </div>
  );
};

/* ── Sidebar primitives ──────────────────────────────────────── */

const SidebarGroup = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="border-b border-adm-border py-4 last:border-b-0">
    <Cap>{title}</Cap>
    <div className="mt-2.5 flex flex-col gap-1.5">{children}</div>
  </div>
);

const SidebarKV = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) => {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 font-mono text-[9px] text-adm-t3">{label}</span>
      <span
        className={[
          'min-w-0 break-all text-right text-adm-t2',
          mono ? 'font-mono text-[10px]' : 'text-[11px]',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  );
};

/* ── Method tag (color by HTTP verb) ─────────────────────────── */

const METHOD_CLS: Record<string, string> = {
  GET:     'border-adm-green/25 bg-adm-green/10 text-adm-green',
  POST:    'border-adm-blue/25  bg-adm-blue/10  text-adm-blue',
  PUT:     'border-adm-amber/25 bg-adm-amber/10 text-adm-amber',
  PATCH:   'border-adm-amber/25 bg-adm-amber/10 text-adm-amber',
  DELETE:  'border-adm-red/25   bg-adm-red/10   text-adm-red',
};

const MethodTag = ({ value }: { value: string }) => {
  const cls = METHOD_CLS[value.toUpperCase()] ?? 'border-adm-t3/25 bg-adm-t3/10 text-adm-t2';
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold ${cls}`}
    >
      {value.toUpperCase()}
    </span>
  );
};

/* ─────────────────────────────────────────────────────────────── */

const RoleDetailPage = () => {
  const { code: rawCode } = useParams<{ code: string }>();
  const code = rawCode ? decodeURIComponent(rawCode) : '';
  const navigate = useNavigate();

  const [detail, setDetail] = useState<RoleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  /* Permission search within the detail — client-side */
  const [permKeyword, setPermKeyword] = useState('');
  const [methodFilter, setMethodFilter] = useState('');

  /* ── Fetching ── */

  const fetchDetail = async () => {
    if (!code) {
      setError('Role code is required.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/iam/roles`,
      );
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'Failed to load role catalog.'));
      }
      const payload = (await res.json()) as RoleDetail[];
      const found = payload.find((r) => r.code === code) ?? null;
      setDetail(found);
      if (!found) {
        setError(`Role "${code}" not found in catalog.`);
      }
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      if (e instanceof AdminPermissionError) {
        setError('Permission denied. You cannot view the role catalog.');
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load role detail.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchDetail(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [code]);

  /* ── Derived ── */

  const methodBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of detail?.permissions ?? []) {
      const m = (p.method || 'OTHER').toUpperCase();
      counts[m] = (counts[m] ?? 0) + 1;
    }
    return counts;
  }, [detail]);

  const filteredPermissions = useMemo(() => {
    const kw = permKeyword.trim().toLowerCase();
    return (detail?.permissions ?? []).filter((p) => {
      const matchKw =
        !kw ||
        p.code?.toLowerCase().includes(kw) ||
        p.path?.toLowerCase().includes(kw) ||
        p.name?.toLowerCase().includes(kw) ||
        p.description?.toLowerCase().includes(kw);
      const matchMethod = !methodFilter || p.method?.toUpperCase() === methodFilter;
      return matchKw && matchMethod;
    });
  }, [detail, permKeyword, methodFilter]);

  /* ── Loading / error stubs ── */

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-3">
        <RefreshCw size={24} className="animate-spin text-adm-amber" />
        <p className="font-mono text-[11px] text-adm-t3">Loading…</p>
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4 flex items-center gap-2">
          <button
            onClick={() => navigate('/dashboard/members/roles')}
            className={adminButtonClass('detailUtility')}
          >
            ← Back
          </button>
          <button
            onClick={() => void fetchDetail()}
            className={adminButtonClass('detailUtility')}
          >
            <RefreshCw size={13} /> Retry
          </button>
        </div>
        <div className="px-6 py-6">
          <div className="rounded-lg border border-adm-red/30 bg-adm-red/10 px-4 py-3 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="shrink-0 border-b border-adm-border bg-adm-panel px-6 py-4">
          <button
            onClick={() => navigate('/dashboard/members/roles')}
            className={adminButtonClass('detailUtility')}
          >
            ← Back
          </button>
        </div>
        <div className="px-6 py-6 font-mono text-[11px] text-adm-t3">Role not found.</div>
      </div>
    );
  }

  /* ── Shared input style for in-detail permission search ── */
  const fi =
    'h-[28px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[10px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';

  /* ── Page ── */

  return (
    <div className="flex h-full flex-col overflow-hidden">

      {/* ── Sticky nav header ── */}
      <DetailPageHeader
        title="Role"
        onBack={() => navigate('/dashboard/members/roles')}
        onRefresh={() => void fetchDetail()}
        refreshing={loading}
        backLabel="Roles"
      />

      {/* ── Inline error ── */}
      {error && (
        <div className="shrink-0 px-6 pt-3 pb-1">
          <div className="rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] text-adm-red">
            {error}
          </div>
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ════ LEFT MAIN ════ */}
        <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">

          {/* ① Identity — code dominant, status, then name + id */}
          <section className="bg-adm-card px-6 py-5">
            <Cap>Role</Cap>
            <p className="mt-1.5 font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {detail.code}
            </p>
            <div className="mt-2.5">
              <AdminBadge value={detail.status} />
            </div>
            <div className="mt-4 border-t border-adm-border pt-4">
              <p className="font-mono text-[11px] text-adm-t2">{detail.name || '—'}</p>
              <p className="mt-1.5 break-all font-mono text-[9px] text-adm-t3">{detail.id}</p>
            </div>
          </section>

          {/* ② Overview */}
          <section className="px-6 py-5">
            <Cap>Overview</Cap>
            <div className="mt-3">
              <FieldGrid>
                <Field label="Role Code"    value={detail.code}           mono amber />
                <Field label="Role Name"    value={detail.name}                      />
                <Field label="Status"       value={detail.status}                    />
                <Field label="Total Bindings" value={String(detail.permissions?.length ?? 0)} mono />
                <Field label="Description"  value={detail.description || '—'} full   />
              </FieldGrid>
            </div>
          </section>

          {/* ③ Permission Bindings */}
          <section className="px-6 py-5">
            <Cap>Permission Bindings</Cap>
            <p className="mt-1 mb-4 font-mono text-[9px] text-adm-t3">
              API routes bound to this role · read-only from the backend catalog
            </p>

            {/* In-detail filter toolbar */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                value={permKeyword}
                onChange={(e) => setPermKeyword(e.target.value)}
                placeholder="Code / Path / Name"
                className={`${fi} w-64`}
              />
              <select
                value={methodFilter}
                onChange={(e) => setMethodFilter(e.target.value)}
                className={`${fi} w-28`}
              >
                <option value="">All Methods</option>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </select>
              <span className="ml-auto font-mono text-[9px] text-adm-t3">
                {filteredPermissions.length} / {detail.permissions?.length ?? 0} shown
              </span>
            </div>

            {/* Permissions table */}
            <div className="overflow-hidden rounded border border-adm-border bg-adm-bg">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {(
                      [
                        ['Code',        '220px'],
                        ['Method',      '72px'],
                        ['Path',        '260px'],
                        ['Name',        '180px'],
                        ['Description', 'auto'],
                      ] as [string, string][]
                    ).map(([label, w]) => (
                      <th
                        key={label}
                        style={{ width: w === 'auto' ? undefined : w }}
                        className="border-b border-adm-border bg-adm-card px-3 py-2 text-left font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredPermissions.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-8 text-center font-mono text-[11px] text-adm-t3"
                      >
                        {(detail.permissions?.length ?? 0) === 0
                          ? 'No permissions bound.'
                          : 'No permissions match the current filter.'}
                      </td>
                    </tr>
                  ) : (
                    filteredPermissions.map((p) => (
                      <tr
                        key={`${p.code}-${p.method}-${p.path}`}
                        className="border-b border-adm-border last:border-b-0"
                      >
                        {/* Code */}
                        <td className="px-3 py-2 font-mono text-[10px] font-semibold text-adm-amber">
                          {p.code || '—'}
                        </td>
                        {/* Method */}
                        <td className="px-3 py-2">
                          <MethodTag value={p.method || '—'} />
                        </td>
                        {/* Path */}
                        <td className="px-3 py-2 font-mono text-[10px] text-adm-t2">
                          <span className="block truncate">{p.path || '—'}</span>
                        </td>
                        {/* Name */}
                        <td className="px-3 py-2 font-mono text-[10px] text-adm-t2">
                          <span className="block truncate">{p.name || '—'}</span>
                        </td>
                        {/* Description */}
                        <td className="max-w-0 px-3 py-2 font-mono text-[10px] text-adm-t3">
                          <span className="block truncate">{p.description || '—'}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

        </div>

        {/* ════ RIGHT SIDEBAR ════ */}
        <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">

          {/* Identity */}
          <SidebarGroup title="Identity">
            <SidebarKV label="Role ID" value={detail.id}   mono />
            <SidebarKV label="Code"    value={detail.code} mono />
            <SidebarKV label="Name"    value={detail.name}      />
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 font-mono text-[9px] text-adm-t3">Status</span>
              <AdminBadge value={detail.status} />
            </div>
          </SidebarGroup>

          {/* Statistics */}
          <SidebarGroup title="Statistics">
            <SidebarKV
              label="Total"
              value={String(detail.permissions?.length ?? 0)}
              mono
            />
            {Object.entries(methodBreakdown)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([method, count]) => (
                <SidebarKV
                  key={method}
                  label={method}
                  value={String(count)}
                  mono
                />
              ))}
          </SidebarGroup>

          {/* Source */}
          <SidebarGroup title="Source">
            <SidebarKV label="Catalog" value="Fixed backend catalog" />
            <SidebarKV label="Mutable" value="No (read-only)" />
          </SidebarGroup>

        </div>
      </div>
    </div>
  );
};

export default RoleDetailPage;
