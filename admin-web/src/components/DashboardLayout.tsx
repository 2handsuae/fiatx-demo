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
  Coins,
  Layers,
  Gauge,
  ShieldCheck,
  Shield,
  AlertTriangle,
  UserCheck,
  Sun,
  Moon,
  Database,
  FileEdit,
  ChevronDown,
  Send,
  Building2,
  Landmark,
  PiggyBank,
  Banknote,
  Clock,
  CalendarClock,
  BookUser,
  MessageSquare,
  ScrollText,
  FileSearch,
} from 'lucide-react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { useSimulationMode } from '../utils/simulationMode';
import DemoOpsPanel from './DemoOpsPanel';

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

// Task 26：Role Requests 单个侧栏项底下挂两条真实路由（Binding Changes /
// Definition Changes 两个 tab，见 RoleRequestTabs），二者都要让同一个侧栏项亮起。
const ROLE_DEFINITION_MODIFY_REQUESTS_PATH = '/admin/iam/role-definition-modify-requests';

const isPathActive = (pathname: string, targetPath: string) => {
  if (targetPath === '/admin') {
    return pathname === '/admin' || pathname === '/admin/';
  }
  if (targetPath === '/admin/iam/members') {
    return pathname === targetPath;
  }
  if (targetPath === '/admin/iam/role-change-requests') {
    return (
      pathname === targetPath ||
      pathname.startsWith(`${targetPath}/`) ||
      pathname === ROLE_DEFINITION_MODIFY_REQUESTS_PATH ||
      pathname.startsWith(`${ROLE_DEFINITION_MODIFY_REQUESTS_PATH}/`)
    );
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
  const [demoOpsAvailable, setDemoOpsAvailable] = useState(false);
  const [demoOpsPanelOpen, setDemoOpsPanelOpen] = useState(false);

  // 一级菜单分组折叠状态：存的是"已折叠"的分组名，默认空 = 全展开（保持现状）。存 localStorage 存活刷新。
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('admin_sidebar_collapsed_groups');
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const toggleGroup = (label: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      try {
        localStorage.setItem('admin_sidebar_collapsed_groups', JSON.stringify([...next]));
      } catch {
        /* 无痕/隐私模式下写不了，忽略——只丢失记忆，不影响功能 */
      }
      return next;
    });
  };

  // 探测 demo-ops 是否可达（DEMO_OPS=1 才注册路由）：404/网络错误 = 本地，隐藏入口。
  useEffect(() => {
    if (!simulationModeEnabled || demoOpsAvailable) return;
    let cancelled = false;
    void fetch(`${import.meta.env.VITE_API_URL}/demo-ops/status`)
      .then((res) => { if (!cancelled && res.ok) setDemoOpsAvailable(true); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [simulationModeEnabled, demoOpsAvailable]);
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

  // 2026-10-06 导航重组（业主拍板）：13 组 → 10 组，42 条二级不增不减。
  // 排序原则 = 观众动线：客户 → 交易 → 钱的真相（资金单/账本/对账）→ 公司的钱 →
  // 静态配置 → 治理 → 合规办公室 → 系统管理（IAM/审计）收尾。
  // 组的显隐由儿子的权限过滤决定（visibleMenuItems），重排不改变任何人的可见面。
  const menuItems: MenuItem[] = [
    {
      path: '/admin',
      icon: <LayoutDashboard size={14} />,
      label: 'Overview',
      requiredPermissions: [PERMISSIONS.BASE_ACCESS],
    },
    // ─── Customers ────────────────────────────────────────────────
    // 组壳暂只此一条——业主拍板保留（客户域后续还会加二级入口，不升顶层直链）。
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
      ],
    },
    // ─── Trading ──────────────────────────────────────────────────
    // 报价单紧跟各自的域；Funds Orders 迁出至 Ledger & Funds——资金单是
    // 全域共用的结算层（每一笔钱动的物理转账镜像），不只三域交易。
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
          path: '/admin/trading/withdraw-quotes',
          label: 'Withdraw Quotes',
          icon: <FileText size={13} />,
          requiredPermissions: [PERMISSIONS.WITHDRAW_QUOTES_READ],
        },
        {
          path: '/admin/trading/swaps',
          label: 'Swap Transactions',
          icon: <Repeat size={13} />,
          requiredPermissions: [PERMISSIONS.SWAP_TRANSACTIONS_READ],
        },
        {
          path: '/admin/trading/swap-quotes',
          label: 'Swap Quotes',
          icon: <FileText size={13} />,
          requiredPermissions: [PERMISSIONS.SWAP_QUOTES_READ],
        },
      ],
    },
    // ─── Ledger & Funds ───────────────────────────────────────────
    // 资金单与账本三页同组——铁律⑤「资金单镜像 + 账本分录实时 1:1」的两面
    // 放一起，对账演示翻页即可互证。资金单在 RBAC 里本就是独立域（非 Trading）。
    {
      label: 'Ledger & Funds',
      icon: <Library size={12} />,
      children: [
        // Unified funds-orders surface (Round 2 / C6) — replaces the legacy
        // Payin Records / Payout Records / Internal Funds entries.
        {
          path: '/admin/funds-orders',
          label: 'Funds Orders',
          icon: <Activity size={13} />,
          requiredPermissions: [PERMISSIONS.FUNDS_ORDERS_READ],
        },
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
          path: '/admin/ledger/flows',
          label: 'Account Flows',
          icon: <Database size={13} />,
          requiredPermissions: [PERMISSIONS.TB_FLOWS_READ],
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
        {
          path: '/admin/reconciliation/adjustments',
          label: 'Adjustments',
          icon: <FileEdit size={13} />,
          requiredPermissions: [PERMISSIONS.RECON_ADJUSTMENT_LIST_READ],
        },
      ],
    },
    // ─── Treasury（战役乙波二 + 波三导航归并）────────────────────
    // 公司自身资金动线——不是客户域。Task 6：注资单先落地；Task 7：付款单续补；
    // Task 8：公司资金全景看板——恰四职务（金库/CFO/高管/内审）可见，运营/技术官
    // 均不持 FUNDING_DASHBOARD_VIEW，导航无入口（同组的两条数据路由 OR 锚不改变这点，
    // 见 rbac.catalog.ts cap.treasury.funding_dashboard 注释）。
    // 战役乙波三（T10，§0 裁定 9）：LP Register / LP Exchanges 从 Custody 组迁入本组——
    // LP 是外部对手方财资活动，与注资/付款/看板同属 V7 财资域，归队同组。
    {
      label: 'Treasury',
      icon: <PiggyBank size={12} />,
      children: [
        {
          path: '/admin/company-funds',
          label: 'Company Funds',
          icon: <Gauge size={13} />,
          requiredPermissions: [PERMISSIONS.FUNDING_DASHBOARD_VIEW],
        },
        {
          path: '/admin/capital-injections',
          label: 'Capital Injections',
          icon: <Banknote size={13} />,
          requiredPermissions: [PERMISSIONS.CAPITAL_INJECTIONS_READ],
        },
        // 战役乙波二 Task 7：付款单——金库开单，CFO 单步批，支付在册外包商。
        {
          path: '/admin/vendor-payments',
          label: 'Vendor Payments',
          icon: <Send size={13} />,
          requiredPermissions: [PERMISSIONS.VENDOR_PAYMENTS_READ],
        },
        // 平账二期：公司 → 客户的补款 / 垫款划转单。2026-10-06 导航重组从原 Custody 组
        // 迁入——与 LP 迁移（乙波三裁定 9）同理，V7 财资动线归队。路由保留 custody/ 前缀
        // （2026-09-21 波五甲案统一的是路由前缀，前端路径非权限载体，组名与前缀自此脱钩）。
        {
          path: '/admin/custody/internal-transfers',
          label: 'Internal Transfers',
          icon: <ArrowLeftRight size={13} />,
          requiredPermissions: [PERMISSIONS.INTERNAL_TRANSFERS_READ],
        },
        // 战役乙波一（Task 7）：LP 档案——金库注册 / CFO 批的流动性提供方登记册。
        {
          path: '/admin/lp-profiles',
          label: 'LP Register',
          icon: <Landmark size={13} />,
          requiredPermissions: [PERMISSIONS.LP_PROFILES_READ],
        },
        // 战役乙波一（Task 8）：LP 兑换单——先款后货三腿，金库开单 / CFO 批。
        {
          path: '/admin/lp-exchanges',
          label: 'LP Exchanges',
          icon: <Repeat size={13} />,
          requiredPermissions: [PERMISSIONS.LP_EXCHANGES_READ],
        },
      ],
    },
    // ─── Configuration ────────────────────────────────────────────
    // V3 财务配置归一组（原 Assets & Limits + Pricing 两组，加原 Custody 组的
    // 钱包地址行/提现地址簿，三组并一）——资产/地址/限额/费率同属
    // 「交易的静态参数从哪来」（overview §1 V3）。
    {
      label: 'Configuration',
      icon: <Coins size={12} />,
      children: [
        {
          path: '/admin/assets',
          label: 'Assets',
          icon: <Coins size={13} />,
          requiredPermissions: [PERMISSIONS.ASSETS_READ],
        },
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
          requiredPermissions: [PERMISSIONS.WITHDRAWAL_ADDRESSES_READ],
        },
        {
          path: '/admin/assets/transaction-limits',
          label: 'Transaction Limits',
          icon: <Gauge size={13} />,
          requiredPermissions: [PERMISSIONS.TRANSACTION_LIMIT_READ],
        },
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
        // 平账三期：事故登记——独立治理件，与审批中心平级（G1 拍板）
        {
          path: '/admin/governance/incidents',
          label: 'Incident Register',
          icon: <AlertTriangle size={13} />,
          requiredPermissions: [PERMISSIONS.INCIDENTS_READ],
        },
        // 战役甲波二：报送台——独立治理件，与事故登记平级（spec §9）
        {
          path: '/admin/governance/regulatory-filings',
          label: 'Regulatory Filings',
          icon: <Send size={13} />,
          requiredPermissions: [PERMISSIONS.REG_FILINGS_READ],
        },
        // 战役甲波五（Task 9）：投诉工作流——独立治理件，与事故登记/报送台平级
        // （三刀「投诉并入事件中心」不另立顶层模块，见 spec §4）。
        {
          path: '/admin/governance/complaints',
          label: 'Complaints',
          icon: <MessageSquare size={13} />,
          requiredPermissions: [PERMISSIONS.COMPLAINT_READ],
        },
      ],
    },
    // ─── Compliance Office ────────────────────────────────────────
    // 战役甲波四（Task 9）：闹钟墙 + 合规日历（周期义务）+ 两本登记册（外包商/RI）——
    // 独立治理件，与 Governance 组的事故登记/报送台平级（照 rbac.catalog.ts 的
    // 'compliance-office' 独立 domain 先例，同 label 字面量）。
    {
      label: 'Compliance Office',
      icon: <Building2 size={12} />,
      children: [
        {
          path: '/admin/governance/compliance-office/clock-wall',
          label: 'Clock Wall',
          icon: <Clock size={13} />,
          requiredPermissions: [PERMISSIONS.COMPLIANCE_OFFICE_VIEW],
        },
        {
          path: '/admin/governance/compliance-office/obligations',
          label: 'Obligations',
          icon: <CalendarClock size={13} />,
          requiredPermissions: [PERMISSIONS.COMPLIANCE_OFFICE_VIEW],
        },
        {
          path: '/admin/governance/compliance-office/registers',
          label: 'Registers',
          icon: <BookUser size={13} />,
          requiredPermissions: [PERMISSIONS.COMPLIANCE_OFFICE_VIEW],
        },
        // 战役丙波三（Task 10）：客户协议版本管理——读权限复用 COMPLIANCE_OFFICE_VIEW（五职务共持），
        // 写（提交发布）在页内按 AGREEMENT_WRITE 门控。
        {
          path: '/admin/governance/compliance-office/agreements',
          label: 'Customer Agreements',
          icon: <ScrollText size={13} />,
          requiredPermissions: [PERMISSIONS.COMPLIANCE_OFFICE_VIEW],
        },
        // 战役丙波四（Task 6）：资料请求（DSR）——DPO 的经办面；读 DSR_READ（DPO/合规官/内审），
        // 写钮在页内按 DSR_WRITE（DPO 独占）门控。
        {
          path: '/admin/governance/compliance-office/dsr-requests',
          label: 'Data Requests',
          icon: <FileSearch size={13} />,
          requiredPermissions: [PERMISSIONS.DSR_READ],
        },
        // 2026-10-06 导航重组（业主拍板）：从原 Compliance 单条组迁入（该组随之撤销）。
        // 已知展示副作用：技术官/运营持 SUMSUB_EVENT_VIEW 但不持 COMPLIANCE_OFFICE_VIEW，
        // 对他们本组只显示这一条——纯展示，权限面零变化。
        {
          path: '/admin/compliance/sumsub-events',
          label: 'Sumsub Events',
          icon: <Zap size={13} />,
          requiredPermissions: [PERMISSIONS.SUMSUB_EVENTS_READ],
        },
      ],
    },
    // ─── Identity & Access ────────────────────────────────────────
    // 2026-10-06 导航重组：从首组下移到治理簇——IAM 是系统管理，不排业务动线前面。
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
        {
          path: '/admin/iam/role-change-requests',
          label: 'Role Requests',
          icon: <ClipboardList size={13} />,
          requiredPermissions: [PERMISSIONS.IAM_ROLES_READ],
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
                  {/* Group header — 可点折叠/展开 */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(item.label)}
                    aria-expanded={!collapsedGroups.has(item.label)}
                    className="mb-1 flex w-full items-center gap-1.5 rounded px-2.5 py-1 text-left transition-colors hover:bg-adm-hover"
                  >
                    <span className="shrink-0 text-adm-t3">{item.icon}</span>
                    <span className="flex-1 font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
                      {item.label}
                    </span>
                    <ChevronDown
                      size={12}
                      className={[
                        'shrink-0 text-adm-t3 transition-transform duration-150',
                        collapsedGroups.has(item.label) ? '-rotate-90' : '',
                      ].join(' ')}
                    />
                  </button>
                  {/* Children — 折叠时不渲染 */}
                  {!collapsedGroups.has(item.label) && (
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
                  )}
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

            {/* Demo Data（仅云端：DEMO_OPS 探测可达才显示） */}
            {simulationModeEnabled && demoOpsAvailable && (
              <button
                type="button"
                onClick={() => setDemoOpsPanelOpen(true)}
                className="rounded border border-adm-amber/60 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-adm-amber transition-colors hover:bg-adm-amber/10"
              >
                Demo Data
              </button>
            )}

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

      <DemoOpsPanel open={demoOpsPanelOpen} onClose={() => setDemoOpsPanelOpen(false)} />
    </div>
  );
};

export default DashboardLayout;
