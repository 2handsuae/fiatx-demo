import { useEffect, useState } from 'react';
import {
  LogOut,
  PanelLeft,
  PanelLeftClose,
  User,
  Wallet,
  ArrowDownCircle,
  ArrowUpCircle,
  ArrowLeftRight,
  LineChart,
  ChevronRight,
} from 'lucide-react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/* ────────────────────────────────────────────────────────────────
 *  FIATX member shell — Terminal dialect.
 *  Same brand tokens as the public pages, but turned DOWN:
 *  no editorial `§` markers, no italic Fraunces headlines, no
 *  Roman numerals as primary nav. This is a tool, not a magazine.
 * ──────────────────────────────────────────────────────────────── */

const MASTHEAD = ['F', 'I', 'A', 'T', 'X'];

type NavItem = {
  path: string;
  label: string;
  icon: React.ReactNode;
  group: 'ASSETS' | 'MOVEMENT' | 'ACCOUNT';
};

const NAV: NavItem[] = [
  { group: 'ASSETS',   path: '/overview',     label: 'Overview',     icon: <LineChart size={14} /> },
  { group: 'ASSETS',   path: '/withdrawal-addresses', label: 'Wallet', icon: <Wallet size={14} /> },
  { group: 'MOVEMENT', path: '/deposit',      label: 'Deposit',      icon: <ArrowDownCircle size={14} /> },
  { group: 'MOVEMENT', path: '/swap',         label: 'Swap',         icon: <ArrowLeftRight size={14} /> },
  { group: 'MOVEMENT', path: '/withdraw',     label: 'Withdraw',     icon: <ArrowUpCircle size={14} /> },
  { group: 'ACCOUNT',  path: '/profile',      label: 'Profile',      icon: <User size={14} /> },
];

const GROUP_ORDER: NavItem['group'][] = ['ASSETS', 'MOVEMENT', 'ACCOUNT'];

/* ─── Dubai clock, minimal ──────────────────────────────────────── */
function DubaiClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const dubai = new Date(now.getTime() + (now.getTimezoneOffset() + 240) * 60_000);
  const hh = String(dubai.getHours()).padStart(2, '0');
  const mm = String(dubai.getMinutes()).padStart(2, '0');
  const ss = String(dubai.getSeconds()).padStart(2, '0');
  return (
    <span className="hidden md:inline-flex items-center font-mono text-[10px] text-fx-dune tabular-nums">
      <span className="text-fx-dust mr-1.5 tracking-[0.14em]">DXB</span>
      {hh}:{mm}
      <span className="text-fx-brass/60 mx-px">:</span>
      {ss}
    </span>
  );
}

/* ─── Compact masthead (same as public, only place Fraunces lives) */
function MiniMasthead({ collapsed }: { collapsed: boolean }) {
  return (
    <Link to="/overview" className="inline-flex items-end gap-1" aria-label="FIATX">
      {MASTHEAD.map((l, i) => (
        <span key={i} className="inline-flex items-end">
          <span className="fx-display font-light text-[18px] leading-none text-fx-sand">{l}</span>
          {!collapsed && i < MASTHEAD.length - 1 && (
            <span className="w-[2px] h-[2px] rounded-full bg-fx-brass mx-1 mb-[0.25em] shrink-0" />
          )}
        </span>
      ))}
    </Link>
  );
}

/* ─── Compact status badge ──────────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'APPROVED' || status === 'ACTIVE'
      ? 'text-fx-sage border-fx-sage/30 bg-fx-sage/5'
      : status === 'REJECTED' || status === 'FROZEN' || status === 'WITHDRAWN'
        ? 'text-fx-rust border-fx-rust/30 bg-fx-rust/5'
        : status === 'FINAL_APPROVAL'
          ? 'text-fx-brass border-fx-brass/30 bg-fx-brass/5'
          : 'text-fx-dune border-fx-rule bg-transparent';
  return (
    <span
      className={`inline-flex items-center gap-1 border px-1.5 py-[1px] font-mono text-[9px] uppercase tracking-[0.12em] ${tone}`}
    >
      <span className="w-[3px] h-[3px] rounded-full bg-current" />
      {status.replace(/_/g, ' ')}
    </span>
  );
}

/* ─── Layout ────────────────────────────────────────────────────── */

const CustomerDashboardLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('fx_rail_collapsed');
    return saved === '1';
  });

  const toggleRail = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('fx_rail_collapsed', next ? '1' : '0');
  };

  const handleLogout = () => {
    localStorage.removeItem('customer_token');
    navigate('/login');
  };

  const currentItem = NAV.find((item) => item.path === location.pathname);
  const currentGroup = currentItem?.group || 'ACCOUNT';
  const currentLabel = currentItem?.label || 'Dashboard';

  // Member chip
  const fullName =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Member';
  const initials =
    ((user?.firstName?.[0] || '') + (user?.lastName?.[0] || 'M')).toUpperCase();
  const email = user?.email || '';

  const hasRestrictions = Array.isArray(user?.restrictions) && user.restrictions.length > 0;
  const displayStatus =
    String(user?.complianceStatus || '').toUpperCase() === 'FROZEN'
      ? 'FROZEN'
      : hasRestrictions
        ? 'RESTRICTED'
        : String(user?.onboardingStatus || 'NONE').toUpperCase() === 'APPROVED' &&
            String(user?.adminStatus || 'INACTIVE').toUpperCase() === 'ACTIVE'
          ? 'ACTIVE'
          : String(user?.onboardingStatus || 'NONE').toUpperCase();

  const railWidth = collapsed ? 'w-[72px]' : 'w-[220px]';

  return (
    <div className="h-screen overflow-hidden bg-fx-obsidian text-fx-sand flex font-sans">
      {/* ── LEFT RAIL ─────────────────────────────────────────── */}
      <aside
        className={`relative flex flex-col shrink-0 border-r border-fx-rule bg-fx-ink/40 transition-all duration-300 ${railWidth}`}
      >
        {/* Rail header */}
        <div className="h-14 flex items-center justify-between px-5 border-b border-fx-rule">
          <MiniMasthead collapsed={collapsed} />
          <button
            onClick={toggleRail}
            className="text-fx-dust hover:text-fx-brass transition-colors"
            title={collapsed ? 'Expand' : 'Collapse'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeft size={13} /> : <PanelLeftClose size={13} />}
          </button>
        </div>

        {/* Nav groups — compact ALL-CAPS headers, no § markers, no Roman numerals */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-4">
          {GROUP_ORDER.map((group, groupIdx) => {
            const items = NAV.filter((n) => n.group === group);
            return (
              <div key={group} className={groupIdx > 0 ? 'mt-6' : ''}>
                {!collapsed && (
                  <div className="px-5 pb-2 font-mono text-[9px] uppercase tracking-[0.14em] text-fx-dust/70">
                    {group}
                  </div>
                )}
                {collapsed && groupIdx > 0 && (
                  <div className="mx-4 mb-3 h-[1px] bg-fx-rule" />
                )}
                {items.map((item) => {
                  const active = location.pathname === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`relative flex items-center gap-2.5 transition-colors ${
                        collapsed
                          ? 'justify-center px-0 py-[9px]'
                          : 'px-5 py-[7px]'
                      } ${
                        active
                          ? 'text-fx-sand bg-fx-sand/[0.025]'
                          : 'text-fx-dust hover:text-fx-dune'
                      }`}
                      title={collapsed ? item.label : undefined}
                    >
                      {/* Active marker: thin brass bar on the left */}
                      {active && (
                        <span
                          className={`absolute top-1/2 -translate-y-1/2 w-[2px] h-4 bg-fx-brass ${
                            collapsed ? 'right-1' : 'left-0'
                          }`}
                        />
                      )}
                      <span
                        className={`shrink-0 ${
                          active ? 'text-fx-brass' : ''
                        }`}
                      >
                        {item.icon}
                      </span>
                      {!collapsed && (
                        <span
                          className={`text-[12px] whitespace-nowrap ${
                            active ? 'text-fx-sand font-medium' : ''
                          }`}
                        >
                          {item.label}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* Rail footer — licence line + sign out */}
        <div className="border-t border-fx-rule p-4">
          {!collapsed && (
            <div className="mb-3 font-mono text-[9px] leading-relaxed text-fx-dust/60 tracking-wider">
              VARA VASP · 2025/DXB
            </div>
          )}
          <button
            onClick={handleLogout}
            className={`group w-full flex items-center text-fx-dust hover:text-fx-rust transition-colors ${
              collapsed ? 'justify-center' : 'gap-2.5'
            }`}
            title="Sign out"
          >
            <LogOut size={13} className="group-hover:rotate-[-6deg] transition-transform" />
            {!collapsed && (
              <span className="text-[12px]">Sign out</span>
            )}
          </button>
        </div>
      </aside>

      {/* ── MAIN COLUMN ───────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ── TOP BAR ─────────────────────────────────────────── */}
        <header className="h-14 shrink-0 border-b border-fx-rule bg-fx-obsidian/80 backdrop-blur-xl flex items-center justify-between px-6 md:px-8">
          {/* Plain breadcrumb — no serif italics, no § */}
          <div className="flex items-center gap-2 min-w-0 font-sans">
            <span className="text-[11px] uppercase tracking-[0.12em] text-fx-dust/70">
              {currentGroup}
            </span>
            <ChevronRight size={12} className="text-fx-rule-strong" />
            <span className="text-[13px] text-fx-sand font-medium truncate">
              {currentLabel}
            </span>
          </div>

          {/* Right cluster */}
          <div className="flex items-center gap-5">
            <DubaiClock />
            <div className="hidden md:block h-5 w-[1px] bg-fx-rule" />

            {/* Member chip */}
            <Link
              to="/profile"
              className="group flex items-center gap-2.5 hover:opacity-90 transition-opacity"
              title="Profile"
            >
              <div className="shrink-0 w-7 h-7 border border-fx-brass/40 bg-fx-brass/5 flex items-center justify-center">
                <span className="font-mono text-[10px] text-fx-brass font-medium leading-none">
                  {initials}
                </span>
              </div>
              <div className="hidden lg:flex flex-col items-start min-w-0">
                <div className="font-sans text-[12px] text-fx-sand truncate max-w-[140px] leading-tight">
                  {fullName}
                </div>
                <div className="mt-[2px]">
                  <StatusBadge status={displayStatus} />
                </div>
              </div>
            </Link>
          </div>
        </header>

        {/* ── CONTENT ────────────────────────────────────────── */}
        <main
          className={`flex-1 overflow-y-auto relative bg-fx-obsidian ${
            location.pathname === '/verification' ? '' : 'px-6 md:px-8 py-8'
          }`}
        >
          {location.pathname === '/verification' ? (
            <Outlet />
          ) : (
            <div className="max-w-[1200px] mx-auto">
              <Outlet />
            </div>
          )}

          {/* Subtle footer watermark */}
          {location.pathname !== '/verification' && (
            <div className="max-w-[1200px] mx-auto mt-16 pt-4 border-t border-fx-rule flex items-center justify-between">
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-fx-dust/50">
                FIATX · Dubai · {new Date().getFullYear()}
              </span>
              {email && (
                <span className="font-mono text-[10px] text-fx-dust/50">{email}</span>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default CustomerDashboardLayout;
