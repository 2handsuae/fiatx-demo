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
  AlignLeft,
  Zap,
  Activity,
  BarChart3,
  Briefcase,
  LogIn,
  Cpu,
  Coins,
  Table,
  Command,
  FileCode,
  Layers,
  Handshake,
  Building2,
  ShieldCheck,
  Shield,
  UserCheck,
  Sun,
  Moon,
} from 'lucide-react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';

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
  if (targetPath === '/dashboard') {
    return pathname === '/dashboard' || pathname === '/dashboard/';
  }
  if (targetPath === '/dashboard/members') {
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

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
  };

  const handleLogout = () => {
    clearSession();
    navigate('/admin/login');
  };

  const menuItems: MenuItem[] = [
    {
      path: '/dashboard',
      icon: <LayoutDashboard size={20} />,
      label: 'Overview',
      requiredPermissions: [PERMISSIONS.BASE_ACCESS],
    },
    {
      label: 'Customer Management',
      icon: <UserCog size={20} />,
      children: [
        {
          path: '/dashboard/customer/management',
          label: 'Customer Management',
          icon: <Users size={18} />,
          requiredPermissions: [PERMISSIONS.CUSTOMERS_READ],
        },
      ],
    },
    {
      label: 'Pricing Center',
      icon: <Coins size={20} />,
      children: [
        {
          path: '/dashboard/pricing/rates',
          label: 'Swap Rates',
          icon: <Repeat size={18} />,
          requiredPermissions: [PERMISSIONS.CUSTOMER_SWAP_RATES_READ],
        },
        {
          path: '/dashboard/pricing/quotes',
          label: 'Swap Quotes',
          icon: <FileText size={18} />,
          requiredPermissions: [PERMISSIONS.SWAP_QUOTES_READ],
        },
      ],
    },
    {
      label: 'Reconciliation Center',
      icon: <Activity size={20} />,
      children: [
        {
          path: '/dashboard/reconciliation/outstanding-settlements',
          label: 'Outstanding Settlements',
          icon: <ClipboardList size={18} />,
          requiredPermissions: [PERMISSIONS.OUTSTANDING_SETTLEMENTS_READ],
        },
        {
          path: '/dashboard/reconciliation/outstandings',
          label: 'Swap Outstandings',
          icon: <ClipboardList size={18} />,
          requiredPermissions: [PERMISSIONS.OUTSTANDINGS_READ],
        },
      ],
    },
    {
      label: 'Audit Center',
      icon: <FileText size={20} />,
      children: [
        {
          path: '/dashboard/audit/audit-logs',
          label: 'Audit Log',
          icon: <FileText size={18} />,
          requiredPermissions: [PERMISSIONS.AUDIT_LOGS_READ],
        },
        {
          path: '/dashboard/audit/evidence-exports',
          label: 'Evidence Export',
          icon: <Layers size={18} />,
          requiredPermissions: [PERMISSIONS.AUDIT_EVIDENCE_EXPORTS_READ],
        },
      ],
    },
    {
      label: 'Governance Center',
      icon: <ShieldCheck size={20} />,
      children: [
        {
          path: '/dashboard/governance/change-tickets',
          label: 'Change Tickets',
          icon: <Briefcase size={18} />,
          requiredPermissions: [PERMISSIONS.GOV_CHANGE_TICKETS_READ],
        },
        {
          path: '/dashboard/governance/delete-requests',
          label: 'Delete Requests',
          icon: <ClipboardList size={18} />,
          requiredPermissions: [PERMISSIONS.GOV_DELETE_REQUESTS_READ],
        },
        {
          path: '/dashboard/governance/approvals',
          label: 'Approvals',
          icon: <Shield size={18} />,
          requiredPermissions: [PERMISSIONS.GOV_APPROVALS_READ],
        },
        {
          path: '/dashboard/governance/sla-timers',
          label: 'SLA Timers',
          icon: <History size={18} />,
          requiredPermissions: [PERMISSIONS.GOV_SLA_TIMERS_READ],
        },
      ],
    },
    {
      label: 'Compliance Center',
      icon: <ClipboardList size={20} />,
      children: [
        {
          path: '/dashboard/compliance/tx-evidence',
          label: 'Tx Evidence Bundles',
          icon: <ShieldCheck size={18} />,
          requiredPermissions: [PERMISSIONS.BASE_ACCESS],
        },
        {
          path: '/dashboard/compliance/kyt-cases',
          label: 'KYT Cases',
          icon: <ShieldCheck size={18} />,
          requiredPermissions: [PERMISSIONS.BASE_ACCESS],
        },
        {
          path: '/dashboard/compliance/travel-rule-cases',
          label: 'Travel Rule Cases',
          icon: <ShieldCheck size={18} />,
          requiredPermissions: [PERMISSIONS.BASE_ACCESS],
        },
        {
          path: '/dashboard/compliance/cdd-cases',
          label: 'CDD Cases',
          icon: <ShieldCheck size={18} />,
          requiredPermissions: [PERMISSIONS.CDD_CASES_READ],
        },
        {
          path: '/dashboard/compliance/edd-cases',
          label: 'EDD Cases',
          icon: <Shield size={18} />,
          requiredPermissions: [PERMISSIONS.EDD_CASES_READ],
        },
        {
          path: '/dashboard/compliance/alerts',
          label: 'Alerts',
          icon: <Activity size={18} />,
          requiredPermissions: [PERMISSIONS.BASE_ACCESS],
        },
        {
          path: '/dashboard/compliance/incidents',
          label: 'Incidents',
          icon: <Activity size={18} />,
          requiredPermissions: [PERMISSIONS.BASE_ACCESS],
        },
      ],
    },
    {
      label: 'Risk Management',
      icon: <Shield size={20} />,
      children: [
        {
          path: '/dashboard/risk/policy-executions',
          label: 'Risk Policy Executions',
          icon: <Activity size={18} />,
          requiredPermissions: [PERMISSIONS.CDD_CASES_READ],
        },
      ],
    },
    {
      label: 'Customer Transaction',
      icon: <ArrowLeftRight size={20} />,
      children: [
        {
          path: '/exchange/deposit-transactions',
          label: 'Deposit Transactions',
          icon: <Download size={18} />,
          requiredPermissions: [PERMISSIONS.DEPOSIT_TRANSACTIONS_READ],
        },
        {
          path: '/exchange/withdraw-transactions',
          label: 'Withdraw Transactions',
          icon: <Upload size={18} />,
          requiredPermissions: [PERMISSIONS.WITHDRAW_TRANSACTIONS_READ],
        },
        {
          path: '/exchange/swap-transactions',
          label: 'Swap Transactions',
          icon: <Repeat size={18} />,
          requiredPermissions: [PERMISSIONS.SWAP_TRANSACTIONS_READ],
        },
        {
          path: '/exchange/internal-transactions',
          label: 'Internal Transactions',
          icon: <Repeat size={18} />,
          requiredPermissions: [PERMISSIONS.INTERNAL_TRANSACTIONS_READ],
        },
      ],
    },
    {
      label: 'Account Center',
      icon: <Library size={20} />,
      children: [
        {
          path: '/ledger/journals',
          label: 'Journal Entries',
          icon: <FileText size={18} />,
          requiredPermissions: [PERMISSIONS.JOURNALS_READ],
        },
        {
          path: '/ledger/journal-lines',
          label: 'Journal Lines',
          icon: <AlignLeft size={18} />,
          requiredPermissions: [PERMISSIONS.JOURNAL_LINES_READ],
        },
        {
          path: '/ledger/balance-history',
          label: 'Balance History',
          icon: <History size={18} />,
          requiredPermissions: [PERMISSIONS.CUSTOMER_BALANCE_HISTORY_READ],
        },
      ],
    },
    {
      label: 'Clearing Center',
      icon: <Zap size={20} />,
      children: [
        {
          path: '/clearing/management',
          label: 'Clearing',
          icon: <Activity size={18} />,
          requiredPermissions: [PERMISSIONS.CLEARINGS_READ],
        },
        {
          path: '/clearing/details',
          label: 'Clearing Lines',
          icon: <BarChart3 size={18} />,
          requiredPermissions: [PERMISSIONS.CLEARING_LINES_READ],
        },
      ],
    },
    {
      label: 'Treasury Center',
      icon: <Briefcase size={20} />,
      children: [
        {
          path: '/dashboard/treasury/wallets',
          label: 'Wallet & Account',
          icon: <Wallet size={18} />,
          requiredPermissions: [PERMISSIONS.WALLETS_READ],
        },
        {
          path: '/dashboard/treasury/payins',
          label: 'Payin Records',
          icon: <LogIn size={18} />,
          requiredPermissions: [PERMISSIONS.PAYINS_READ],
        },
        {
          path: '/dashboard/treasury/payouts',
          label: 'Payout Records',
          icon: <LogOut size={18} />,
          requiredPermissions: [PERMISSIONS.PAYOUTS_READ],
        },
        {
          path: '/dashboard/treasury/internal-funds',
          label: 'Internal Funds',
          icon: <Activity size={18} />,
          requiredPermissions: [PERMISSIONS.INTERNAL_FUNDS_READ],
        },
      ],
    },
    {
      label: 'Infrastructure Domain',
      icon: <Cpu size={20} />,
      children: [
        {
          path: '/dashboard/system/assets',
          label: 'Assets Config',
          icon: <Coins size={18} />,
          requiredPermissions: [PERMISSIONS.ASSETS_READ],
        },
        {
          path: '/ledger/coa',
          label: 'Chart of Accounts (COA)',
          icon: <Table size={18} />,
          requiredPermissions: [PERMISSIONS.COA_READ],
        },
        {
          path: '/dashboard/system/acct-events',
          label: 'Event Code Management',
          icon: <Command size={18} />,
          requiredPermissions: [PERMISSIONS.ACCT_EVENTS_READ],
        },
        {
          path: '/dashboard/system/journal-header-templates',
          label: 'Journal Templates',
          icon: <FileCode size={18} />,
          requiredPermissions: [PERMISSIONS.JOURNAL_HEADER_TEMPLATES_READ],
        },
        {
          path: '/dashboard/system/clearing-header-templates',
          label: 'Clearing Templates',
          icon: <Layers size={18} />,
          requiredPermissions: [PERMISSIONS.CLEARING_TEMPLATES_READ],
        },
      ],
    },
    {
      label: 'Counterparty Management',
      icon: <Handshake size={20} />,
      children: [
        {
          path: '/dashboard/system/liquidity-providers',
          label: 'Liquidity Providers',
          icon: <Building2 size={18} />,
          requiredPermissions: [PERMISSIONS.LIQUIDITY_PROVIDERS_READ],
        },
        {
          path: '/dashboard/system/liquidity-config',
          label: 'LP Liquidity Config',
          icon: <ShieldCheck size={18} />,
          requiredPermissions: [PERMISSIONS.LIQUIDITY_CONFIG_READ],
        },
      ],
    },
    {
      label: 'Backend Member Management',
      icon: <Shield size={20} />,
      children: [
        {
          path: '/dashboard/members',
          label: 'Platform Members',
          icon: <UserCheck size={18} />,
          requiredPermissions: [PERMISSIONS.USERS_READ],
        },
        {
          path: '/dashboard/members/roles',
          label: 'Role Management',
          icon: <ShieldCheck size={18} />,
          requiredPermissions: [PERMISSIONS.IAM_ROLES_READ],
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
        if (children.length === 0) {
          return null;
        }

        return {
          ...item,
          children,
        } as MenuGroup;
      })
      .filter((item): item is MenuItem => item !== null);
  }, [hasAnyPermission]);

  const displayName = session?.email || 'Admin';
  const displayRole = (session?.roles || []).join(', ') || 'No roles';
  const avatarText = displayName.slice(0, 1).toUpperCase();

  return (
    <div className="h-screen bg-admin-content-bg dark:bg-deep-space flex font-['Noto_Sans_SC'] overflow-hidden">
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-admin-sidebar-bg text-admin-sidebar-text transition-transform duration-300 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } lg:w-64 flex flex-col border-r border-admin-sidebar-hover h-full`}
      >
        <div className="h-16 flex-none flex items-center px-6 border-b border-admin-sidebar-hover">
          <div className="w-8 h-8 bg-brand-primary rounded flex items-center justify-center font-bold mr-3 text-white">
            E
          </div>
          <span className="font-bold text-lg tracking-wide">ADMIN</span>
        </div>

        <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
          {visibleMenuItems.map((item, index) => (
            <div key={`${'path' in item ? item.path : item.label}-${index}`}>
              {'path' in item ? (
                <Link
                  to={item.path}
                  className={`flex items-center px-3 py-2 rounded-lg transition-all duration-200 mb-1 ${
                    isPathActive(location.pathname, item.path)
                      ? 'bg-brand-primary text-white shadow-md shadow-brand-primary/20'
                      : 'text-gray-400 hover:text-admin-sidebar-text hover:bg-admin-sidebar-hover'
                  }`}
                >
                  {item.icon}
                  <span className="ml-3 text-sm font-medium">{item.label}</span>
                </Link>
              ) : (
                <div className="mb-4">
                  <div className="flex items-center px-3 py-2 text-gray-500 text-xs font-bold uppercase tracking-wider">
                    {item.icon}
                    <span className="ml-3">{item.label}</span>
                  </div>
                  <div className="ml-4 pl-3 border-l border-admin-sidebar-hover space-y-1 mt-1">
                    {item.children.map((child, cIndex) => (
                      <Link
                        key={`${child.path}-${cIndex}`}
                        to={child.path}
                        className={`flex items-center px-3 py-2 rounded-lg transition-all duration-200 ${
                          isPathActive(location.pathname, child.path)
                            ? 'text-white bg-admin-sidebar-hover border-r-2 border-brand-primary'
                            : 'text-gray-400 hover:text-admin-sidebar-text hover:bg-admin-sidebar-hover/50'
                        }`}
                      >
                        {child.icon}
                        <span className="ml-3 text-sm">{child.label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-admin-sidebar-hover flex-none">
          <button
            onClick={handleLogout}
            className="flex items-center w-full px-3 py-2 text-gray-400 hover:text-red-400 hover:bg-admin-sidebar-hover rounded-lg transition-colors"
          >
            <LogOut size={20} />
            <span className="ml-3 text-sm font-medium">Sign Out</span>
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <header className="bg-white dark:bg-admin-sidebar-bg dark:border-admin-sidebar-hover border-b border-admin-border h-16 flex-none flex items-center justify-between px-6">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="lg:hidden text-gray-500 hover:text-gray-700"
          >
            <Menu size={24} />
          </button>
          <div className="flex items-center gap-4 ml-auto">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-admin-sidebar-hover transition-colors"
              title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <div className="text-right">
              <div className="text-sm font-bold text-gray-900 dark:text-white">{displayName}</div>
              <div className="text-xs text-gray-500">{displayRole}</div>
            </div>
            <div className="w-10 h-10 bg-brand-primary rounded-full flex items-center justify-center text-white font-bold">
              {avatarText}
            </div>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-y-auto dark:bg-deep-space dark:text-white">
          <Outlet />
        </main>
      </div>

      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        ></div>
      )}
    </div>
  );
};

export default DashboardLayout;
