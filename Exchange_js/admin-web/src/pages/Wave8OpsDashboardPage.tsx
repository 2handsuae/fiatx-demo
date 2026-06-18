import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { StatusBadge } from '../components/governance/GovernanceUi';
import { formatDateTime } from '../components/governance/governanceUtils';
import { AdminPermissionError, AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';

type DashboardCard = {
  title: string;
  count: number | null;
  path: string;
  icon: ReactNode;
  description: string;
};

type RecentItem = {
  id: string;
  no: string;
  label: string;
  status: string;
  updatedAt?: string | null;
  path: string;
};

const Wave8OpsDashboardPage = () => {
  const navigate = useNavigate();
  const { hasAnyPermission } = useAdminSession();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cards, setCards] = useState<DashboardCard[]>([]);
  const [recentObligations, setRecentObligations] = useState<RecentItem[]>([]);
  const [recentGates, setRecentGates] = useState<RecentItem[]>([]);

  const canReadObligations = hasAnyPermission([
    PERMISSIONS.REIMBURSEMENT_OBLIGATIONS_READ,
  ]);
  const canReadGates = hasAnyPermission([PERMISSIONS.GOV_REGULATORY_GATES_READ]);

  const baseCards = useMemo<DashboardCard[]>(
    () => [
      {
        title: 'Open Reimbursement Obligations',
        count: null,
        path: '/dashboard/treasury/reimbursement-obligations',
        icon: <Wallet size={18} />,
        description: 'Platform replenishment work items still left open.',
      },
      {
        title: 'Blocked Regulatory Gates',
        count: null,
        path: '/admin/registries/regulatory-gates',
        icon: <ShieldCheck size={18} />,
        description: 'Governance items blocked on filing, receipt, or effectiveness.',
      },
    ],
    [],
  );

  const fetchCount = async (path: string) => {
    const response = await adminFetch(`${import.meta.env.VITE_API_URL}${path}`);
    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, `Failed to load ${path}.`));
    }
    const result = (await response.json()) as { total?: number };
    return typeof result.total === 'number' ? result.total : 0;
  };

  const fetchJson = async <T,>(path: string) => {
    const response = await adminFetch(`${import.meta.env.VITE_API_URL}${path}`);
    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, `Failed to load ${path}.`));
    }
    return (await response.json()) as T;
  };

  const guardedCount = async (
    enabled: boolean,
    path: string,
  ): Promise<number | null> => {
    if (!enabled) return null;
    try {
      return await fetchCount(path);
    } catch (e) {
      if (e instanceof AdminPermissionError) return null;
      throw e;
    }
  };

  const fetchDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const [obligationCount, blockedGateCount, obligationList, gateList] =
        await Promise.all([
          guardedCount(
            canReadObligations,
            '/admin/reimbursement-obligations?status=OPEN&take=1',
          ),
          guardedCount(
            canReadGates,
            '/admin/governance/regulatory-gates?gateResult=BLOCKED&take=1',
          ),
          canReadObligations
            ? fetchJson<{ items: Array<Record<string, unknown>> }>(
                '/admin/reimbursement-obligations?status=OPEN&take=5',
              )
            : Promise.resolve({ items: [] }),
          canReadGates
            ? fetchJson<{ items: Array<Record<string, unknown>> }>(
                '/admin/governance/regulatory-gates?take=10',
              )
            : Promise.resolve({ items: [] }),
        ]);

      setCards([
        { ...baseCards[0], count: obligationCount },
        { ...baseCards[1], count: blockedGateCount },
      ]);

      setRecentObligations(
        (obligationList.items || []).map((item) => ({
          id: String(item.id),
          no: String(item.obligationNo || item.id),
          label: `${String(item.poolRole || '-')}${(item.asset as { code?: string } | undefined)?.code ? ` · ${String((item.asset as { code?: string }).code)}` : ''}`,
          status: String(item.status || '-'),
          updatedAt: String(item.updatedAt || item.createdAt || ''),
          path: `/dashboard/treasury/reimbursement-obligations/${String(item.id)}`,
        })),
      );

      setRecentGates(
        (gateList.items || [])
          .filter((item) => {
            const gateResult = String(item.gateResult || '');
            return gateResult === 'BLOCKED' || gateResult === 'READY';
          })
          .map((item) => ({
            id: String(item.id),
            no: String(item.gateNo || item.id),
            label: `${String(item.gateType || '-')}${item.subjectNo ? ` · ${String(item.subjectNo)}` : ''}`,
            status: String(item.gateResult || '-'),
            updatedAt: String(item.updatedAt || item.createdAt || ''),
            path: `/admin/registries/regulatory-gates/${String(item.id)}`,
          }))
          .slice(0, 8),
      );
    } catch (e: unknown) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to load Wave 8 ops dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderRecentTable = (title: string, rows: RecentItem[], emptyText: string) => (
    <div className="overflow-hidden rounded-xl border border-admin-border bg-white shadow-sm">
      <div className="border-b border-admin-border px-4 py-3 text-sm font-semibold text-gray-900">
        {title}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-admin-border bg-admin-content-bg">
            <tr>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">No</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Label</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Status</th>
              <th className="px-4 py-3 text-xs uppercase text-gray-500">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-admin-border">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">
                  {emptyText}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={`${row.path}-${row.id}`}
                  className="cursor-pointer hover:bg-gray-50"
                  onClick={() => navigate(row.path)}
                >
                  <td className="px-4 py-3 font-mono text-xs text-brand-primary">{row.no}</td>
                  <td className="px-4 py-3 text-gray-700">{row.label}</td>
                  <td className="px-4 py-3">
                    <StatusBadge value={row.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-700">{formatDateTime(row.updatedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Wave 8 Ops Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            Operational view across treasury reimbursements and regulatory gates.
          </p>
        </div>
        <button
          onClick={() => void fetchDashboard()}
          className="inline-flex items-center gap-2 rounded-lg border border-admin-border bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <button
            key={card.title}
            onClick={() => navigate(card.path)}
            className="rounded-xl border border-admin-border bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="rounded-lg bg-brand-primary/10 p-2 text-brand-primary">
                {card.icon}
              </div>
              <div className="text-right text-2xl font-bold text-gray-900">
                {card.count === null ? '-' : card.count}
              </div>
            </div>
            <div className="mt-4 text-sm font-semibold text-gray-900">{card.title}</div>
            <div className="mt-1 text-xs text-gray-500">{card.description}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {renderRecentTable(
          'Recent Open Reimbursement Obligations',
          recentObligations,
          'No open reimbursement obligations.',
        )}
        {renderRecentTable(
          'Recent Blocked / Ready Gates',
          recentGates,
          'No blocked or ready regulatory gates.',
        )}
      </div>
    </div>
  );
};

export default Wave8OpsDashboardPage;
