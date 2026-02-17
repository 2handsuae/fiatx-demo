import { useState } from 'react';
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
  UserCheck
} from 'lucide-react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';

const DashboardLayout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    navigate('/admin/login');
  };

  const menuItems = [
    { path: '/dashboard', icon: <LayoutDashboard size={20} />, label: 'Overview' },
    { 
      label: 'Customer Management', 
      icon: <UserCog size={20} />, 
      children: [
        { path: '/dashboard/customer/management', label: 'Customer Management', icon: <Users size={18} /> },
      ]
    },
    {
      label: 'Pricing Center',
      icon: <Coins size={20} />,
      children: [
        { path: '/dashboard/pricing/rates', label: 'Swap Rates', icon: <Repeat size={18} /> },
        { path: '/dashboard/pricing/quotes', label: 'Swap Quotes', icon: <FileText size={18} /> },
      ],
    },
    {
      label: 'Reconciliation Center',
      icon: <Activity size={20} />,
      children: [
        { path: '/dashboard/reconciliation/outstandings', label: 'Swap Outstandings', icon: <ClipboardList size={18} /> },
      ],
    },
    {
      label: 'Compliance Center',
      icon: <ClipboardList size={20} />,
      children: [
        { path: '/dashboard/compliance/cdd-cases', label: 'CDD Cases', icon: <ShieldCheck size={18} /> },
        { path: '/dashboard/compliance/edd-cases', label: 'EDD Cases', icon: <Shield size={18} /> },
      ],
    },
    {
      label: 'Customer Transaction',
      icon: <ArrowLeftRight size={20} />,
      children: [
        { path: '/exchange/deposit-transactions', label: 'Deposit Transactions', icon: <Download size={18} /> },
        { path: '/exchange/withdraw-transactions', label: 'Withdraw Transactions', icon: <Upload size={18} /> },
        { path: '/exchange/swap-transactions', label: 'Swap Transactions', icon: <Repeat size={18} /> },
        { path: '/exchange/internal-transactions', label: 'Internal Transactions', icon: <Repeat size={18} /> }
      ]
    },
    {
      label: 'Account Center',
      icon: <Library size={20} />,
      children: [
        { path: '/ledger/journals', label: 'Journal Entries', icon: <FileText size={18} /> },
        { path: '/ledger/journal-lines', label: 'Journal Lines', icon: <AlignLeft size={18} /> },
        { path: '/ledger/balance-history', label: 'Balance History', icon: <History size={18} /> }
      ]
    },
    {
      label: 'Clearing Center',
      icon: <Zap size={20} />,
      children: [
        { path: '/clearing/management', label: 'Clearing', icon: <Activity size={18} /> },
        { path: '/clearing/details', label: 'Clearing Lines', icon: <BarChart3 size={18} /> }
      ]
    },
    {
      label: 'Treasury Center',
      icon: <Briefcase size={20} />,
      children: [
        { path: '/dashboard/treasury/wallets', label: 'Wallet & Account', icon: <Wallet size={18} /> },
        { path: '/dashboard/treasury/payins', label: 'Payin Records', icon: <LogIn size={18} /> },
        { path: '/dashboard/treasury/payouts', label: 'Payout Records', icon: <LogOut size={18} /> },
        { path: '/dashboard/treasury/internal-funds', label: 'Internal Funds', icon: <Activity size={18} /> }
      ]
    },
    {
      label: 'Infrastructure Domain', 
      icon: <Cpu size={20} />, 
      children: [
        { path: '/dashboard/system/assets', label: 'Assets Config', icon: <Coins size={18} /> },
        { path: '/ledger/coa', label: 'Chart of Accounts (COA)', icon: <Table size={18} /> },
        { path: '/dashboard/system/acct-events', label: 'Event Code Management', icon: <Command size={18} /> },
        { path: '/dashboard/system/journal-header-templates', label: 'Journal Templates', icon: <FileCode size={18} /> },
        { path: '/dashboard/system/clearing-header-templates', label: 'Clearing Templates', icon: <Layers size={18} /> }
      ]
    },
    {
      label: 'Counterparty Management',
      icon: <Handshake size={20} />,
      children: [
        { path: '/dashboard/system/liquidity-providers', label: 'Liquidity Providers', icon: <Building2 size={18} /> },
        { path: '/dashboard/system/liquidity-config', label: 'LP Liquidity Config', icon: <ShieldCheck size={18} /> }
      ]
    },
    {
      label: 'Backend Member Management',
      icon: <Shield size={20} />,
      children: [
        { path: '/dashboard/members', label: 'Platform Members', icon: <UserCheck size={18} /> }
      ]
    }
  ];

  return (
    <div className="h-screen bg-admin-content-bg flex font-['Noto_Sans_SC'] overflow-hidden">
      {/* Sidebar */}
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-admin-sidebar-bg text-admin-sidebar-text transition-transform duration-300 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} lg:w-64 flex flex-col border-r border-admin-sidebar-hover h-full`}>
        <div className="h-16 flex-none flex items-center px-6 border-b border-admin-sidebar-hover">
          <div className="w-8 h-8 bg-brand-primary rounded flex items-center justify-center font-bold mr-3 text-white">E</div>
          <span className="font-bold text-lg tracking-wide">ADMIN</span>
        </div>

        <nav className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
          {menuItems.map((item, index) => (
            <div key={index}>
              {item.path ? (
                <Link 
                  to={item.path}
                  className={`flex items-center px-3 py-2 rounded-lg transition-all duration-200 mb-1 ${
                    location.pathname === item.path 
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
                    {item.children?.map((child, cIndex) => (
                      <Link 
                        key={cIndex}
                        to={child.path}
                        className={`flex items-center px-3 py-2 rounded-lg transition-all duration-200 ${
                          location.pathname === child.path 
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
          <button onClick={handleLogout} className="flex items-center w-full px-3 py-2 text-gray-400 hover:text-red-400 hover:bg-admin-sidebar-hover rounded-lg transition-colors">
            <LogOut size={20} />
            <span className="ml-3 text-sm font-medium">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <header className="bg-white border-b border-admin-border h-16 flex-none flex items-center justify-between px-6">
          <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="lg:hidden text-gray-500 hover:text-gray-700">
            <Menu size={24} />
          </button>
          <div className="flex items-center gap-4 ml-auto">
             <div className="text-right">
               <div className="text-sm font-bold text-gray-900">Admin</div>
               <div className="text-xs text-gray-500">Super Administrator</div>
             </div>
             <div className="w-10 h-10 bg-brand-primary rounded-full flex items-center justify-center text-white font-bold">A</div>
          </div>
        </header>

        <main className="flex-1 p-6 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      
      {/* Mobile Overlay */}
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setIsSidebarOpen(false)}></div>
      )}
    </div>
  );
};

export default DashboardLayout;
