import React, { useState } from 'react';
import { 
  LogOut, 
  Menu, 
  X, 
  User, 
  Wallet, 
  ArrowDownCircle, 
  ArrowUpCircle, 
  ArrowLeftRight, 
  TrendingUp,
  Sun,
  Moon
} from 'lucide-react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';

const CustomerDashboardLayout = () => {
  const { theme, toggleTheme } = useTheme();
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('sidebar_state');
    return saved !== null ? JSON.parse(saved) : true;
  });
  
  const toggleSidebar = () => {
    const newState = !isSidebarOpen;
    setIsSidebarOpen(newState);
    localStorage.setItem('sidebar_state', JSON.stringify(newState));
  };

  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('customer_token');
    navigate('/login');
  };

  const menuItems = [
    { path: '/overview', icon: <TrendingUp size={20} />, label: 'Asset Overview' },
    { path: '/wallet', icon: <Wallet size={20} />, label: 'Wallet' },
    { path: '/deposit', icon: <ArrowDownCircle size={20} />, label: 'Deposit' },
    { path: '/swap', icon: <ArrowLeftRight size={20} />, label: 'Swap' },
    { path: '/withdraw', icon: <ArrowUpCircle size={20} />, label: 'Withdraw' },
    { path: '/profile', icon: <User size={20} />, label: 'Profile' },
  ];

  return (
    <div className="h-screen overflow-hidden bg-slate-50 dark:bg-fin-dark-bg flex font-['Inter'] transition-colors duration-500">
      {/* Sidebar */}
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 h-full glass-panel border-r border-slate-200 dark:border-slate-800 transition-all duration-500 flex flex-col ${isSidebarOpen ? 'w-[260px] translate-x-0' : 'w-0 -translate-x-full lg:w-24 lg:translate-x-0'}`}>
        <div className="h-20 flex items-center justify-between px-6 border-b border-slate-200/50 dark:border-slate-800/50">
          <div className={`flex items-center ${!isSidebarOpen && 'lg:justify-center lg:w-full'}`}>
             <div className="w-10 h-10 bg-tech-gradient rounded-xl flex items-center justify-center font-bold text-white shadow-glow animate-pulse-slow">
               <span className="text-xl">E</span>
             </div>
             {isSidebarOpen && <span className="font-black text-xl text-slate-900 dark:text-white tracking-tighter ml-3">EXCHANGE<span className="text-brand-accent">.</span></span>}
          </div>
          {isSidebarOpen && (
            <button onClick={toggleSidebar} className="lg:hidden text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors">
              <X size={20} />
            </button>
          )}
        </div>

        <nav className="flex-1 py-8 px-4 space-y-2 overflow-y-auto overflow-x-hidden">
          {menuItems.map((item, index) => {
            const isActive = location.pathname === item.path;
            return (
              <Link 
                  key={index}
                  to={item.path}
                  className={`relative flex items-center px-4 py-3.5 rounded-xl transition-all duration-300 group mb-1 ${
                  isActive 
                      ? 'bg-brand-primary/10 text-brand-primary' 
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/50'
                  }`}
                  title={!isSidebarOpen ? item.label : ''}
              >
                  {isActive && (
                    <div className="absolute left-0 top-1/4 bottom-1/4 w-1 bg-brand-primary rounded-r-full shadow-glow"></div>
                  )}
                  <div className={`shrink-0 transition-transform duration-300 ${isActive ? 'scale-110' : 'group-hover:scale-110'}`}>
                    {item.icon}
                  </div>
                  <span className={`ml-4 text-sm font-bold tracking-tight whitespace-nowrap transition-all duration-300 ${isSidebarOpen ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4 lg:hidden'}`}>
                    {item.label}
                  </span>
              </Link>
            );
          })}
        </nav>

        <div className="p-6 border-t border-slate-200/50 dark:border-slate-800/50">
          <button onClick={handleLogout} className="flex items-center w-full px-4 py-3 text-slate-400 hover:text-fin-rose hover:bg-rose-50 dark:hover:bg-rose-900/10 rounded-xl transition-all duration-300 group">
            <div className="shrink-0 group-hover:rotate-12 transition-transform"><LogOut size={20} /></div>
            <span className={`ml-4 text-sm font-bold tracking-tight whitespace-nowrap transition-all duration-300 ${isSidebarOpen ? 'opacity-100' : 'opacity-0 lg:hidden'}`}>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white/50 dark:bg-fin-dark-bg/50 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 h-20 flex items-center justify-between px-8 sticky top-0 z-40">
          <button onClick={toggleSidebar} className="text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all hover:scale-110">
            <Menu size={24} />
          </button>
          <div className="flex items-center gap-6">
             <button 
                onClick={toggleTheme}
                className="p-2.5 text-slate-400 hover:text-brand-primary hover:bg-brand-primary/10 rounded-xl transition-all"
                title={theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
             >
                {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
             </button>
             <div className="flex items-center gap-3 pl-6 border-l border-slate-200 dark:border-slate-800">
                <div className="text-right hidden sm:block">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Client</p>
                  <p className="text-sm font-black text-slate-900 dark:text-white truncate max-w-[120px]">CUSTOMER</p>
                </div>
                <div className="w-10 h-10 bg-tech-gradient rounded-xl flex items-center justify-center text-white font-black shadow-glow border border-white/20">C</div>
             </div>
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-10 overflow-y-auto">
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
      
      {/* Mobile Overlay */}
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 lg:hidden" onClick={() => setIsSidebarOpen(false)}></div>
      )}
    </div>
  );
};

export default CustomerDashboardLayout;
