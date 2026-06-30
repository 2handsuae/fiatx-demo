import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  LayoutDashboard,
  Users,
  LogOut,
  Menu,
  Wallet,
  ClipboardList,
  History,
  UserCog,
  ArrowLeftRight,
  Download,
  Upload,
  Repeat,
  Library,
  FileText,
  Zap,
  Activity,
  Briefcase,
  LogIn,
  Coins,
  Layers,
  Handshake,
  Building2,
  ShieldCheck,
  Shield,
  UserCheck,
  Sun,
  Moon,
  Database,
  Gauge,
} from 'lucide-react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { useSimulationMode } from '../utils/simulationMode';

interface MenuLink {
  path: string;
  icon: ReactNode;
  label: string;
  requiredPermissions: string[];
}

interface MenuGroup {
  label: string;
  icon: ReactNode;
  children: MenuLink[];
}

type MenuItem = MenuLink | MenuGroup;

const isPathActive = (pathname: string, targetPath: string) => {
  if (targetPath === '/admin') {
    return pathname === '/admin' || pathname === '/admin/';
  }
  if (targetPath === '/admin/iam/members') {
    return pathname === targetPath;
  }
  return pathname === targetPath || pathname.startsWith(`${targetPath}/`);
};

const DashboardLayout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return (
        localStorage.getItem('theme') === 'dark' ||
        (!localStorage.getItem('theme') &&
          window.matchMedia('(prefers-color-scheme: dark)').matches)
      );
    }
    return false;
  });

  const { session, clearSession, hasAnyPermission } = useAdminSession();
  const { enabled: simulationModeEnabled, setEnabled: setSimulationModeEnabled } =
    useSimulationMode();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const toggleTheme = () => setIsDarkMode(!isDarkMode);

  const handleLogout = () => {
    clearSession();
    navigate('/admin/login');
  };

  const menuItems: MenuItem[] = [
    {
      path: '/admin',
      icon: <LayoutDashboard size={14} />,
      label: 'Overview',
      requiredPermissions: [PERMISSIONS.BASE_ACCESS],
    },
    // ─── Identity & Access ────────────────────────────────────────
    {
      label: 'Identity & Access',
      icon: <UserCog size={12} />,
      children: [
        {
          path: '/admin/iam/members',
          label: 'Platform Members',
          icon: <UserCheck size={13} />,
          requiredPermissions: [PERMISSIONS.USERS_READ],
        },
        {
          path: '/admin/iam/roles',
          label: 'Role Management',
          icon: <ShieldCheck size={13} />,
          requiredPermissions: [PERMISSIONS.IAM_ROLES_READ],
        },
      ],
    },
    // ─── Customers ────────────────────────────────────────────────
    {
      label: 'Customers',
      icon: <Users size={12} />,
      children: [
        {
          path: '/admin/customers',
          label: 'Customer Management',
          icon: <Users size={13} />,
          requiredPermissions: [PERMISSIONS.CUSTOMERS_READ],
        },
        {
          path: '/admin/customers/material-holdings',
          label: 'Material Holdings',
          icon: <FileText size={13} />,
          requiredPermissions: [PERMISSIONS.CUSTOMERS_READ],
        },
        {
          path: '/admin/customers/refresh-cycles',
          label: 'Refresh Cycles',
          icon: <History size={13} />,
          requiredPermissions: [PERMISSIONS.CUSTOMERS_READ],
        },
      ],
    },
    // ─── Compliance ───────────────────────────────────────────────
    {
      label: 'Compliance',
      icon: <ClipboardList size={12} />,
      children: [
        {
          path: '/admin/compliance/sumsub-events',
          label: 'Sumsub Events',
          icon: <Zap size={13} />,
          requiredPermissions: [PERMISSIONS.SUMSUB_EVENTS_READ],
        },
        {
          path: '/admin/compliance/risk-assessments',
          label: 'Risk Assessments',
          icon: <Shield size={13} />,
          requiredPermissions: [PERMISSIONS.RISK_ASSESSMENTS_READ],
        },
      ],
    },
    // ─── Trading ──────────────────────────────────────────────────
    {
      label: 'Trading',
      icon: <ArrowLeftRight size={12} />,
      children: [
        {
          path: '/admin/trading/deposits',
          label: 'Deposit Transactions',
          icon: <Download size={13} />,
          requiredPermissions: [PERMISSIONS.DEPOSIT_TRANSACTIONS_READ],
        },
        {
          path: '/admin/trading/withdrawals',
          label: 'Withdraw Transactions',
          icon: <Upload size={13} />,
          requiredPermissions: [PERMISSIONS.WITHDRAW_TRANSACTIONS_READ],
        },
        {
          path: '/admin/trading/swaps',
          label: 'Swap Transactions',
          icon: <Repeat size={13} />,
          requiredPermissions: [PERMISSIONS.SWAP_TRANSACTIONS_READ],
        },
        {
          path: '/admin/trading/payins',
          label: 'Payin Records',
          icon: <LogIn size={13} />,
          requiredPermissions: [PERMISSIONS.PAYINS_READ],
        },
        {
          path: '/admin/trading/payouts',
          label: 'Payout Records',
          icon: <LogOut size={13} />,
          requiredPermissions: [PERMISSIONS.PAYOUTS_READ],
        },
        {
          path: '/admin/trading/withdraw-quotes',
          label: 'Withdraw Quotes',
          icon: <FileText size={13} />,
          requiredPermissions: [PERMISSIONS.WITHDRAW_QUOTES_READ],
        },
        {
          path: '/admin/trading/swap-quotes',
          label: 'Swap Quotes',
          icon: <FileText size={13} />,
          requiredPermissions: [PERMISSIONS.SWAP_QUOTES_READ],
        },
        // TEMP: moved from Funds & Settlement (hidden) — see DashboardLayout edit 2026-06-29
        {
          path: '/admin/funds/internal-funds',
          label: 'Internal Funds',
          icon: <Activity size={13} />,
          requiredPermissions: [PERMISSIONS.FUNDS_LAYER_FUNDS_READ],
        },
      ],
    },
    // ─── Funds & Settlement (TEMP HIDDEN 2026-06-29) ──────────────
    // Internal Funds moved up under Trading (see above). The rest of
    // this group is hidden from sidebar nav while routes remain mounted
    // so deep links still work. Un-comment to restore.
    /*
    {
      label: 'Funds & Settlement',
      icon: <Layers size={12} />,
      children: [
        {
          path: '/admin/funds/transfers',
          label: 'Internal Transfers',
          icon: <Repeat size={13} />,
          requiredPermissions: [PERMISSIONS.FUNDS_LAYER_TRANSFERS_READ],
        },
        {
          path: '/admin/funds/internal-funds',
          label: 'Internal Funds',
          icon: <Activity size={13} />,
          requiredPermissions: [PERMISSIONS.FUNDS_LAYER_FUNDS_READ],
        },
        {
          path: '/admin/funds/settlements',
          label: 'Settlement Batches',
          icon: <Layers size={13} />,
          requiredPermissions: [PERMISSIONS.FUNDS_LAYER_SETTLEMENTS_READ],
        },
        {
          path: '/admin/funds/outstandings',
          label: 'Swap Outstandings',
          icon: <ClipboardList size={13} />,
          requiredPermissions: [PERMISSIONS.OUTSTANDINGS_READ],
        },
        {
          path: '/admin/funds/fee-accruals',
          label: 'Fee Accruals',
          icon: <ClipboardList size={13} />,
          requiredPermissions: [PERMISSIONS.FEE_ACCRUALS_READ],
        },
      ],
    },
    */
    // ─── Custody ──────────────────────────────────────────────────
    {
      label: 'Custody',
      icon: <Briefcase size={12} />,
      children: [
        {
          path: '/admin/custody/wallets',
          label: 'Custodian Wallets',
          icon: <Wallet size={13} />,
          requiredPermissions: [PERMISSIONS.WALLETS_READ],
        },
        {
          path: '/admin/custody/withdrawal-addresses',
          label: 'Withdrawal Addresses',
          icon: <Upload size={13} />,
          requiredPermissions: [PERMISSIONS.BASE_ACCESS],
        },
      ],
    },
    // ─── Assets & Limits ──────────────────────────────────────────
    {
      label: 'Assets & Limits',
      icon: <Coins size={12} />,
      children: [
        {
          path: '/admin/assets',
          label: 'Assets',
          icon: <Coins size={13} />,
          requiredPermissions: [PERMISSIONS.ASSETS_READ],
        },
        {
          path: '/admin/assets/transaction-limits',
          label: 'Transaction Limits',
          icon: <Gauge size={13} />,
          requiredPermissions: [PERMISSIONS.TRANSACTION_LIMIT_POLICIES_READ],
        },
      ],
    },
    // ─── Pricing ──────────────────────────────────────────────────
    {
      label: 'Pricing',
      icon: <Coins size={12} />,
      children: [
        {
          path: '/admin/pricing/withdrawal-fee-levels',
          label: 'Withdrawal Fee Levels',
          icon: <Layers size={13} />,
          requiredPermissions: [PERMISSIONS.WITHDRAWAL_FEE_LEVELS_READ],
        },
        {
          path: '/admin/pricing/swap-fee-levels',
          label: 'Swap Fee Levels',
          icon: <Repeat size={13} />,
          requiredPermissions: [PERMISSIONS.SWAP_FEE_LEVELS_READ],
        },
      ],
    },
    // ─── Reconciliation ───────────────────────────────────────────
    {
      label: 'Reconciliation',
      icon: <Activity size={12} />,
      children: [
        {
          path: '/admin/reconciliation/runs',
          label: 'Reconciliation Runs',
          icon: <History size={13} />,
          requiredPermissions: [PERMISSIONS.RECON_RUN_READ],
        },
        {
          path: '/admin/reconciliation/cases',
          label: 'Reconciliation Cases',
          icon: <ClipboardList size={13} />,
          requiredPermissions: [PERMISSIONS.RECON_CASE_READ],
        },
        {
          path: '/admin/reconciliation/external-balances',
          label: 'External Balances',
          icon: <FileText size={13} />,
          requiredPermissions: [PERMISSIONS.RECON_EXTERNAL_BALANCE_READ],
        },
      ],
    },
    // ─── Ledger ───────────────────────────────────────────────────
    {
      label: 'Ledger',
      icon: <Library size={12} />,
      children: [
        {
          path: '/admin/ledger/accounts',
          label: 'Ledger Accounts',
          icon: <Database size={13} />,
          requiredPermissions: [PERMISSIONS.TB_ACCOUNTS_READ],
        },
        {
          path: '/admin/ledger/transfer-evidence',
          label: 'Transfer Evidence',
          icon: <Database size={13} />,
          requiredPermissions: [PERMISSIONS.TB_TRANSFERS_READ],
        },
        {
          path: '/admin/ledger/account-statement',
          label: 'Account Statement',
          icon: <Database size={13} />,
          requiredPermissions: [PERMISSIONS.TB_ACCOUNTS_READ],
        },
      ],
    },
    // ─── Governance ───────────────────────────────────────────────
    {
      label: 'Governance',
      icon: <ShieldCheck size={12} />,
      children: [
        {
          path: '/admin/governance/approvals',
          label: 'Approvals',
          icon: <Shield size={13} />,
          requiredPermissions: [PERMISSIONS.GOV_APPROVALS_READ],
        },
        {
          path: '/admin/governance/approval-policies',
          label: 'Approval Policies',
          icon: <Shield size={13} />,
          requiredPermissions: [PERMISSIONS.GOV_APPROVAL_POLICIES_READ],
        },
      ],
    },
    // ─── Audit ────────────────────────────────────────────────────
    {
      label: 'Audit',
      icon: <FileText size={12} />,
      children: [
        {
          path: '/admin/audit/logs',
          label: 'Audit Log',
          icon: <FileText size={13} />,
          requiredPermissions: [PERMISSIONS.AUDIT_LOGS_READ],
        },
        {
          path: '/admin/audit/evidence-packages',
          label: 'Evidence Packages',
          icon: <Layers size={13} />,
          requiredPermissions: [PERMISSIONS.AUDIT_EVIDENCE_EXPORTS_READ],
        },
      ],
    },
    // ─── Governance Registries ────────────────────────────────────
    {
      label: 'Governance Registries',
      icon: <Library size={12} />,
      children: [
        {
          path: '/admin/registries/shareholding-versions',
          label: 'Shareholding Registry',
          icon: <Building2 size={13} />,
          requiredPermissions: [PERMISSIONS.GOV_SHAREHOLDING_REGISTRY_READ],
        },
        {
          path: '/admin/registries/appointments',
          label: 'Appointments',
          icon: <UserCheck size={13} />,
          requiredPermissions: [PERMISSIONS.GOV_APPOINTMENTS_READ],
        },
        {
          path: '/admin/registries/trainings',
          label: 'Trainings',
          icon: <ClipboardList size={13} />,
          requiredPermissions: [PERMISSIONS.GOV_TRAININGS_READ],
        },
        {
          path: '/admin/registries/conflicts',
          label: 'Conflicts',
          icon: <Shield size={13} />,
          requiredPermissions: [PERMISSIONS.GOV_CONFLICTS_READ],
        },
        {
          path: '/admin/registries/wind-down-materials',
          label: 'Wind-down Materials',
          icon: <FileText size={13} />,
          requiredPermissions: [PERMISSIONS.GOV_WIND_DOWN_MATERIALS_READ],
        },
        {
          path: '/admin/registries/regulatory-gates',
          label: 'Regulatory Gates',
          icon: <ShieldCheck size={13} />,
          requiredPermissions: [PERMISSIONS.GOV_REGULATORY_GATES_READ],
        },
      ],
    },
    // ─── Counterparty ─────────────────────────────────────────────
    {
      label: 'Counterparty',
      icon: <Handshake size={12} />,
      children: [
        {
          path: '/admin/counterparty/liquidity-providers',
          label: 'Liquidity Providers',
          icon: <Building2 size={13} />,
          requiredPermissions: [PERMISSIONS.LIQUIDITY_PROVIDERS_READ],
        },
        {
          path: '/admin/counterparty/liquidity-config',
          label: 'LP Liquidity Config',
          icon: <ShieldCheck size={13} />,
          requiredPermissions: [PERMISSIONS.LIQUIDITY_CONFIG_READ],
        },
      ],
    },
  ];

  const visibleMenuItems = useMemo(() => {
    return menuItems
      .map((item) => {
        if ('path' in item) {
          return hasAnyPermission(item.requiredPermissions) ? item : null;
        }
        const children = item.children.filter((child) =>
          hasAnyPermission(child.requiredPermissions),
        );
        if (children.length === 0) return null;
        return { ...item, children } as MenuGroup;
      })
      .filter((item): item is MenuItem => item !== null);
  }, [hasAnyPermission]);

  const displayName = session?.email || 'Admin';
  const displayRole = (session?.roles || []).join(', ') || 'No roles';
  const avatarText = displayName.slice(0, 1).toUpperCase();

  return (
    <div className="flex h-screen overflow-hidden bg-adm-bg font-['Noto_Sans_SC']">

      {/* ── Sidebar ── */}
      <aside
        className={[
          'fixed lg:static inset-y-0 left-0 z-50 flex h-full w-60 flex-col',
          'border-r border-adm-border bg-adm-panel',
          'transition-transform duration-300',
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
      >
        {/* Logo */}
        <div className="flex h-12 flex-none items-center gap-2.5 border-b border-adm-border px-4">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-adm-amber">
            <span className="font-mono text-[11px] font-bold text-white">E</span>
          </div>
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-adm-t1">
            Admin
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {visibleMenuItems.map((item, index) => (
            <div key={`${'path' in item ? item.path : item.label}-${index}`}>
              {'path' in item ? (
                /* ── Top-level direct link ── */
                <Link
                  to={item.path}
                  className={[
                    'mb-0.5 flex items-center gap-2 rounded px-2.5 py-1.5 transition-colors',
                    'font-mono text-[11px]',
                    isPathActive(location.pathname, item.path)
                      ? 'bg-adm-card font-medium text-adm-amber'
                      : 'text-adm-t2 hover:bg-adm-hover hover:text-adm-t1',
                  ].join(' ')}
                >
                  <span className="shrink-0">{item.icon}</span>
                  {item.label}
                </Link>
              ) : (
                /* ── Group ── */
                <div className="mb-1 mt-3 first:mt-1">
                  {/* Group header — section label style */}
                  <div className="mb-1 flex items-center gap-1.5 px-2.5 py-1">
                    <span className="shrink-0 text-adm-t3">{item.icon}</span>
                    <span className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
                      {item.label}
                    </span>
                  </div>
                  {/* Children */}
                  <div className="space-y-0.5 pl-2">
                    {item.children.map((child, cIndex) => (
                      <Link
                        key={`${child.path}-${cIndex}`}
                        to={child.path}
                        className={[
                          'flex items-center gap-2 rounded px-2.5 py-1.5 transition-colors',
                          'font-mono text-[11px]',
                          isPathActive(location.pathname, child.path)
                            ? 'bg-adm-card font-medium text-adm-amber'
                            : 'text-adm-t2 hover:bg-adm-hover hover:text-adm-t1',
                        ].join(' ')}
                      >
                        <span className="shrink-0 text-current">{child.icon}</span>
                        {child.label}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Sign out */}
        <div className="flex-none border-t border-adm-border px-3 py-3">
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 font-mono text-[11px] text-adm-t3 transition-colors hover:bg-adm-hover hover:text-adm-red"
          >
            <LogOut size={13} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* ── Right column ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">

        {/* Top header */}
        <header className="flex h-12 flex-none items-center justify-between border-b border-adm-border bg-adm-panel px-5">
          {/* Mobile hamburger */}
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="text-adm-t3 transition-colors hover:text-adm-t1 lg:hidden"
          >
            <Menu size={18} />
          </button>

          {/* Right controls */}
          <div className="ml-auto flex items-center gap-3">
            {/* Simulation mode toggle */}
            <label className="flex cursor-pointer items-center gap-2 rounded border border-adm-border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-t3">
              <span>Simulation</span>
              <button
                type="button"
                onClick={() => setSimulationModeEnabled(!simulationModeEnabled)}
                className={[
                  'relative inline-flex h-4 w-8 items-center rounded-full transition-colors',
                  simulationModeEnabled ? 'bg-adm-amber' : 'bg-adm-hover',
                ].join(' ')}
                title={simulationModeEnabled ? 'Disable Simulation Mode' : 'Enable Simulation Mode'}
              >
                <span
                  className={[
                    'inline-block h-3 w-3 transform rounded-full bg-white transition-transform',
                    simulationModeEnabled ? 'translate-x-4' : 'translate-x-0.5',
                  ].join(' ')}
                />
              </button>
            </label>

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="rounded p-1.5 text-adm-t3 transition-colors hover:bg-adm-hover hover:text-adm-t1"
              title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDarkMode ? <Sun size={15} /> : <Moon size={15} />}
            </button>

            {/* Divider */}
            <div className="h-4 w-px bg-adm-border" />

            {/* User info */}
            <div className="flex items-center gap-2.5">
              <div className="text-right">
                <div className="font-mono text-[11px] font-medium text-adm-t1 leading-tight">
                  {displayName}
                </div>
                <div className="font-mono text-[9px] text-adm-t3 leading-tight">
                  {displayRole}
                </div>
              </div>
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-adm-amber font-mono text-[11px] font-bold text-white">
                {avatarText}
              </div>
            </div>
          </div>
        </header>

        {/* Main content — no padding, let each page own its scroll */}
        <main className="flex-1 overflow-hidden bg-adm-bg">
          <Outlet />
        </main>
      </div>

      {/* Mobile backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
    </div>
  );
};

export default DashboardLayout;
