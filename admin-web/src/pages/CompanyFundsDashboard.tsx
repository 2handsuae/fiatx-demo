// admin-web/src/pages/CompanyFundsDashboard.tsx
// 战役乙波二 T8：公司资金全景看板——纯前端组装既有账本端点（GET /admin/tb/accounts +
// GET /admin/tb/account-flows），不建任何新后端聚合端点（spec §5）。可见性由
// FUNDING_DASHBOARD_VIEW 门控（金库/CFO/高管/内审恰四职务，见 App.tsx 路由 + rbac.catalog.ts）。
//
// 五区：① 运营户水位（F_OPS 钱包的现金户，每币种一张水位卡：余额大字 + 横向水位条 + 阈值刻线 +
// 低于线时红字）② F_LIQ 钱包现金户在途待验收格 ③ F_SET 钱包现金户结算在途格 ④ 三收入格（210/211/212）
// ⑤ 最近资金动态（流水最近 10 条）。波三接线声明：本波看板只展示，零事件、零推送、
// 零预留挂点（乙总纲假设①、裁定 4）。
// 戊波二 T10：②′「Due from LP — Pending Delivery」读 ownerType=LP 的应收户（码 51），LP 名 × 币种 × 余额，
// 余额为 0 的户不列，空时 "No LP delivery outstanding."。
// 戊波一 T8：①②③ 改读 ownerType=WALLET 的公司现金户（码 50），按 walletRole（F_OPS/F_LIQ/F_SET）
// 分区——权益户 200 只是兑换对手盘，不再当「运营户现金」读；④ 收入格仍读 SYSTEM 户，不变。
//
// 战役乙波三 T4：NLA（Net Liquid Assets，regulatory）区，置于五区之上，消费 T1/T3 的
// GET/POST /admin/prudential/status|check——全部 dashboard 观众（本页既有
// FUNDING_DASHBOARD_VIEW 门控四职务）可见合计水位+红线刻线+跌破横幅；巡检按钮唯持
// PRUDENTIAL_CHECK_WRITE 的金库可见——真实业务动作，不挂 useSimulationMode（⚡）。
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { DetailCard } from '../components/compliance/DetailPageComponents';
import { PageTitleBar } from '../components/ui/PageTitleBar';
import { adminButtonClass, adminIconButtonClass } from '../components/common/adminButtonStyles';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import { COMPANY_FUNDS_THRESHOLDS } from './companyFundsThresholds';
import {
  buildAssetLookup,
  dueFromLpRows,
  formatMinorToMajor,
  isBelowThresholdMinor,
  type AssetLookup,
} from './companyFundsFormat';

/** 账本行下发的 assetCode 在规范化前默认原样透传、decimals 回退 2 位——首帧数据未到位时
 *  的安全占位（同既有页面「加载中先给默认值」惯例），并非业务判断。 */
const IDENTITY_ASSET_LOOKUP: AssetLookup = { currencyOf: (raw) => raw, decimalsOf: () => 2 };

/* ── TB 科目码 ────────────────────────────────────────────────────
   grep 源：src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts
   （TB_ACCOUNT_CODES / TB_CODE_TO_COA）。本页只拿数字码做客户端分组过滤——显示名称一律
   用 API 下发的 accountName（唯一真相源，见 ledger-account.constants.ts 头注释同款纪律），
   不在前端另造名字。 */
const TREASURY_CODES = {
  FIRM_CASH: 50, // A.FIRM_CASH — 公司现金（每个公司钱包一户，ownerType WALLET；按 walletRole 分运营 / LP 前厅 / 结算）
  LP_RECEIVABLE: 51, // A.LP_RECEIVABLE — 应收 LP 待交货（戊波二：LP 兑换批准后挂账、交货验收后冲平；每 LP × 币种一户，ownerType LP）
  FIRM_EQUITY: 200, // E.FIRM_EQUITY — 公司权益（兑换对手盘；本页只用于流水过滤，不当现金读）
  INCOME_SWAP_FEE: 210, // E.INCOME_SWAP_FEE
  INCOME_WITHDRAW_FEE: 211, // E.INCOME_WITHDRAW_FEE
  INCOME_OTHER: 212, // E.INCOME_OTHER
  EXPENSE_BANK_CUSTODY: 300, // X.EXPENSE_BANK_CUSTODY
  EXPENSE_RECON_LOSS: 301, // X.EXPENSE_RECON_LOSS
  EXPENSE_OTHER: 302, // X.EXPENSE_OTHER
} as const;

/** 现金户所属公司钱包的角色（后端 walletRole，= vaultCode）：①运营 ②LP 前厅 ③结算。 */
const WALLET_ROLES = {
  OPS: 'F_OPS',
  LIQ: 'F_LIQ',
  SET: 'F_SET',
} as const;

const INCOME_CODES = [
  TREASURY_CODES.INCOME_SWAP_FEE,
  TREASURY_CODES.INCOME_WITHDRAW_FEE,
  TREASURY_CODES.INCOME_OTHER,
];

/** 「公司账户」流水过滤集（⑤ 最近资金动态）：公司现金 + 权益 + 收入三格 + 开支三类。 */
const COMPANY_CODES: number[] = [
  TREASURY_CODES.FIRM_CASH,
  TREASURY_CODES.FIRM_EQUITY,
  ...INCOME_CODES,
  TREASURY_CODES.EXPENSE_BANK_CUSTODY,
  TREASURY_CODES.EXPENSE_RECON_LOSS,
  TREASURY_CODES.EXPENSE_OTHER,
];

/* ── Interfaces（字段形状照 LedgerAccountList.tsx:33 / AccountFlowList.tsx:17 的读法）── */

interface AccountRow {
  tbAccountId: string;
  code: number;
  accountName: string | null;
  assetCode: string;
  balance: string | null;
  /** 戊波一 T8：仅 ownerType=WALLET 的行有值（F_OPS / F_LIQ / F_SET …），其余为 null。 */
  walletRole?: string | null;
  /** 戊波二 T10：仅 ownerType=LP 的行有值（LP 名称，端点按 LP 档案联出）；其余为 null。 */
  ownerName?: string | null;
}

interface FlowRow {
  id: string;
  direction: 'IN' | 'OUT';
  amount: string;
  accountCode: number | null;
  accountName: string | null;
  assetCode: string;
  eventCode: string;
  createdAt: string;
}

interface AssetRow {
  currency: string;
  code: string;
  decimals: number;
  tbLedgerId: number | null;
}

/** 字段形状照 T1 `prudential.service.ts` 的 `PrudentialStatus`（后端唯一真相源）——
 *  全部金额是 AED 最小单位字符串（2 位小数），只有 `perAsset[].balanceMinor` 是各自币种
 *  的最小单位（AED 2 位 / USDT 6 位，decimals 经既有 assetLookup 查）。 */
interface PrudentialAssetStatus {
  assetCode: string;
  currency: string;
  balanceMinor: string;
  aedEquivalentMinor: string;
}

interface PrudentialStatus {
  perAsset: PrudentialAssetStatus[];
  nlaAedMinor: string;
  floorAedMinor: string;
  headroomAedMinor: string;
  breached: boolean;
  monthlyOpexBaseAedMinor: string;
  coefficient: string;
  pegRate: string;
}

/* ── Helpers ─────────────────────────────────────────────────────── */

const humanizeEventCode = (code: string): string =>
  code
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

const formatDate = (d: string) =>
  new Date(d).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

/** 水位条填充比例——纯展示用近似值（Number 精度在演示体量下足够），
 *  不影响余额大字（那个走 formatMinorToMajor 的 BigInt-safe 路径）。 */
const gaugeScale = (balanceMinor: string | null, thresholdMajor: number | undefined, decimals: number) => {
  const balanceMajor = Number(balanceMinor ?? '0') / 10 ** decimals;
  const threshold = thresholdMajor ?? 0;
  const scaleMax = Math.max(balanceMajor, threshold, 1) * 1.3;
  const fillPct = Math.max(0, Math.min(100, (balanceMajor / scaleMax) * 100));
  const thresholdPct = threshold > 0 ? Math.max(0, Math.min(100, (threshold / scaleMax) * 100)) : null;
  return { fillPct, thresholdPct };
};

/** breached 时 headroomAedMinor 是负的最小单位字符串（nla − floor < 0）；缺口话术要报正数
 *  「shortfall AED x」，全程 BigInt 不经 Number()（同文件铁律）。 */
const shortfallAedMajor = (headroomAedMinor: string): string =>
  formatMinorToMajor((-BigInt(headroomAedMinor)).toString(), 2);

/* ── Sub-components ──────────────────────────────────────────────── */

/** 区① 运营户水位卡：余额大字 + 横向水位条 + 阈值刻线 + 低于线时红字。 */
const OperatingBalanceCard = ({ row, decimals }: { row: AccountRow; decimals: number }) => {
  const thresholdMajor = COMPANY_FUNDS_THRESHOLDS[row.assetCode];
  const below = thresholdMajor != null && isBelowThresholdMinor(row.balance, thresholdMajor, decimals);
  const { fillPct, thresholdPct } = gaugeScale(row.balance, thresholdMajor, decimals);

  return (
    <div className="rounded border border-adm-border bg-adm-bg p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-adm-t3">{row.assetCode}</div>
      <div className={`mt-1 font-mono text-2xl font-bold ${below ? 'text-adm-red' : 'text-adm-t1'}`}>
        {formatMinorToMajor(row.balance, decimals)}
      </div>
      <div className="relative mt-4 h-2 w-full rounded-full bg-adm-border">
        <div
          className={`h-2 rounded-full ${below ? 'bg-adm-red' : 'bg-adm-green'}`}
          style={{ width: `${fillPct}%` }}
        />
        {thresholdPct != null && (
          <div
            className="absolute -top-1 h-4 w-0.5 bg-adm-amber"
            style={{ left: `${thresholdPct}%` }}
            title={`Low-water threshold: ${thresholdMajor!.toLocaleString()} ${row.assetCode}`}
          />
        )}
      </div>
      {thresholdMajor != null && (
        <div className="mt-1 font-mono text-[10px] text-adm-t3">
          Threshold {thresholdMajor.toLocaleString()} {row.assetCode}
        </div>
      )}
      {below && (
        <div className="mt-2 font-mono text-[11px] font-semibold text-adm-red">Below threshold</div>
      )}
    </div>
  );
};

/** 区②③④ 简单余额卡：无阈值线，只有余额大字。 */
const SimpleBalanceCard = ({ row, decimals }: { row: AccountRow; decimals: number }) => (
  <div className="rounded border border-adm-border bg-adm-bg p-4">
    <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-adm-t3">{row.assetCode}</div>
    <div className="mt-1 font-mono text-xl font-semibold text-adm-t1">
      {formatMinorToMajor(row.balance, decimals)}
    </div>
  </div>
);

/** 区②′ 应收 LP 卡：LP 名 × 币种 × 余额（该 LP 批准后还没交的货，按买入币计）。 */
const LpReceivableCard = ({ row, decimals }: { row: AccountRow; decimals: number }) => (
  <div className="rounded border border-adm-border bg-adm-bg p-4">
    <div className="truncate font-mono text-[10px] uppercase tracking-[0.1em] text-adm-t3" title={row.ownerName ?? ''}>
      {row.ownerName ?? '—'} · {row.assetCode}
    </div>
    <div className="mt-1 font-mono text-xl font-semibold text-adm-t1">
      {formatMinorToMajor(row.balance, decimals)} <span className="text-[12px] font-normal text-adm-t3">{row.assetCode}</span>
    </div>
  </div>
);

const EmptyRow = ({ label }: { label: string }) => (
  <div className="rounded border border-dashed border-adm-border p-4 font-mono text-[11px] text-adm-t3">
    {label}
  </div>
);

/* ── Component ───────────────────────────────────────────────────── */

const CompanyFundsDashboard = () => {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  // 戊波二 T10：应收 LP 户（码 51）单独一路——ownerType=LP，不在 SYSTEM / WALLET 两路里。
  const [lpReceivables, setLpReceivables] = useState<AccountRow[]>([]);
  const [flows, setFlows] = useState<FlowRow[]>([]);
  // 账户/流水两路数据落地前已用 currencyOf() 统一收敛成 currency（见 fetchAll），
  // decimalsOf 之后只需按 currency 查——存整个 AssetLookup 对象（不是裸函数），setState
  // 对普通对象值没有 useState(fn) 那种"当 updater 调用"的特殊语义，直接存/取即可。
  const [assetLookup, setAssetLookup] = useState<AssetLookup>(IDENTITY_ASSET_LOOKUP);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 战役乙波三 T4：NLA 区状态——独立于账本五区的 fetch（不同端点、不同失败态互不连坐）。
  const { hasPermission } = useAdminSession();
  const canRunPrudentialCheck = hasPermission(PERMISSIONS.PRUDENTIAL_CHECK_WRITE);
  const [nla, setNla] = useState<PrudentialStatus | null>(null);
  const [nlaError, setNlaError] = useState<string | null>(null);
  const [checkSubmitting, setCheckSubmitting] = useState(false);
  const [checkResult, setCheckResult] = useState<PrudentialStatus | null>(null);

  const fetchNla = async () => {
    setNlaError(null);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/prudential/status`);
      if (!res.ok) {
        setNlaError(await getApiErrorMessage(res, 'Failed to load prudential status.'));
        return;
      }
      setNla(await res.json());
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setNlaError('Failed to load prudential status.');
    }
  };

  /** 巡检按钮：POST /admin/prudential/check 返回值形状与 GET status 完全同款（同一次
   *  computeStatus 快照，见 prudential.service.ts performCheck），直接拿它当最新 status
   *  用——不必巡检后再多打一次 GET（「顺手刷新 status」就是这一步）。 */
  const handleRunCheck = async () => {
    setCheckSubmitting(true);
    setCheckResult(null);
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/prudential/check`, {
        method: 'POST',
      });
      if (!res.ok) {
        alert(await getApiErrorMessage(res, 'Prudential check failed'));
        return;
      }
      const result: PrudentialStatus = await res.json();
      setCheckResult(result);
      setNla(result);
      setNlaError(null);
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      alert('Prudential check request failed');
    } finally {
      setCheckSubmitting(false);
    }
  };

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      // 戊波一 T8:两路账户——SYSTEM 户(收入三格 / 权益 / 开支)+ 公司现金户(ownerType=WALLET、码 50,
      // 带 walletRole 供分区)。客户现金户同属 WALLET 但码是 1,不会被码 50 过滤带进来。
      const [assetsRes, accountsRes, cashRes, lpRes, flowsRes] = await Promise.all([
        adminFetch(`${import.meta.env.VITE_API_URL}/assets?take=100`),
        adminFetch(`${import.meta.env.VITE_API_URL}/admin/tb/accounts?ownerType=SYSTEM&take=100`),
        adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/tb/accounts?ownerType=WALLET&code=${TREASURY_CODES.FIRM_CASH}&take=100`,
        ),
        adminFetch(
          `${import.meta.env.VITE_API_URL}/admin/tb/accounts?ownerType=LP&code=${TREASURY_CODES.LP_RECEIVABLE}&take=100`,
        ),
        adminFetch(`${import.meta.env.VITE_API_URL}/admin/tb/account-flows?take=200`),
      ]);

      if (!accountsRes.ok) {
        setError(await getApiErrorMessage(accountsRes, 'Failed to load ledger accounts.'));
        return;
      }
      if (!cashRes.ok) {
        setError(await getApiErrorMessage(cashRes, 'Failed to load company cash accounts.'));
        return;
      }
      if (!lpRes.ok) {
        setError(await getApiErrorMessage(lpRes, 'Failed to load LP receivable accounts.'));
        return;
      }
      if (!flowsRes.ok) {
        setError(await getApiErrorMessage(flowsRes, 'Failed to load account flows.'));
        return;
      }

      // 实测坐实（Step 4）：SYSTEM 账户的 assetCode 在注册表里存的是资产 code
      // （如 'USDT-TRON'），不是 currency（'USDT'）——见 companyFundsFormat.ts 头注释。
      // 账户/流水两路数据落地前先用 currencyOf() 统一收敛成 currency，下游阈值/展示/
      // decimals 三处查找从此只认一种键形态。
      let lookup: AssetLookup = IDENTITY_ASSET_LOOKUP;
      if (assetsRes.ok) {
        const assetsData = await assetsRes.json();
        const provisioned: AssetRow[] = (assetsData.items ?? assetsData ?? []).filter(
          (a: AssetRow) => a.tbLedgerId != null,
        );
        lookup = buildAssetLookup(provisioned);
        setAssetLookup(lookup);
      }

      const accountsData = await accountsRes.json();
      const cashData = await cashRes.json();
      const companyAccounts: AccountRow[] = [...(accountsData.items ?? []), ...(cashData.items ?? [])]
        .filter((r: AccountRow) => COMPANY_CODES.includes(r.code))
        .map((r: AccountRow) => ({ ...r, assetCode: lookup.currencyOf(r.assetCode) }));
      setAccounts(companyAccounts);

      const lpData = await lpRes.json();
      setLpReceivables(
        (lpData.items ?? []).map((r: AccountRow) => ({ ...r, assetCode: lookup.currencyOf(r.assetCode) })),
      );

      const flowsData = await flowsRes.json();
      const companyFlows: FlowRow[] = (flowsData.items ?? [])
        .filter((r: FlowRow) => r.accountCode != null && COMPANY_CODES.includes(r.accountCode))
        .map((r: FlowRow) => ({ ...r, assetCode: lookup.currencyOf(r.assetCode) }));
      setFlows(companyFlows.slice(0, 10));
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError('Failed to load company funds dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAll();
    void fetchNla();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decimalsOf = (assetCode: string): number => assetLookup.decimalsOf(assetCode);

  const accountsByCode = (code: number): AccountRow[] =>
    accounts.filter((a) => a.code === code).sort((a, b) => a.assetCode.localeCompare(b.assetCode));

  /** 公司现金户（码 50）按钱包角色取：①运营 F_OPS ②LP 前厅 F_LIQ ③结算 F_SET，每币种一户。 */
  const cashAccountsByRole = (walletRole: string): AccountRow[] =>
    accounts
      .filter((a) => a.code === TREASURY_CODES.FIRM_CASH && a.walletRole === walletRole)
      .sort((a, b) => a.assetCode.localeCompare(b.assetCode));

  // 戊波二 T10：应收 LP——只列余额不为 0 的户（交货冲平后整格回到空文案）。
  const dueFromLp = dueFromLpRows(lpReceivables);

  const opsAccounts = cashAccountsByRole(WALLET_ROLES.OPS);
  const liqAccounts = cashAccountsByRole(WALLET_ROLES.LIQ);
  const setAccountsRows = cashAccountsByRole(WALLET_ROLES.SET);

  // NLA 合计水位条：分子=nlaAedMinor（AED 2 位小数），红线刻线在 floorAedMinor 位置——
  // 复用既有 gaugeScale 的算术（fillPct/thresholdPct），只是这条线的颜色/语义在渲染处
  // 改红（「监管红线」），跟运营户卡的琥珀色「见底线」区分开。
  const nlaGauge = nla
    ? gaugeScale(nla.nlaAedMinor, Number(nla.floorAedMinor) / 100, 2)
    : { fillPct: 0, thresholdPct: null as number | null };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ─── Zone 1: Title ─── */}
      <PageTitleBar
        title="Company Funds"
        subtitle="Firm liquidity at a glance — operating balances, in-transit, settlement and income"
      >
        <button
          onClick={() => {
            void fetchAll();
            void fetchNla();
          }}
          className={adminIconButtonClass()}
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </PageTitleBar>

      {error && (
        <div className="shrink-0 border-b border-adm-red/20 bg-adm-red/6 px-5 py-2.5 font-mono text-[11px] text-adm-red">
          {error}
        </div>
      )}

      <div className="flex-1 space-y-4 overflow-y-auto p-6">
        {loading && accounts.length === 0 ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center">
            <RefreshCw className="mb-4 animate-spin text-adm-amber" size={32} />
            <p className="text-adm-t3">Loading company funds…</p>
          </div>
        ) : (
          <>
            {/* ── NLA (regulatory) — 战役乙波三 T4，置于五区之上 ── */}
            <div
              className={`overflow-hidden rounded-lg border shadow-sm ${
                nla?.breached ? 'border-adm-red bg-adm-red/5' : 'border-adm-border bg-adm-panel'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-adm-border bg-adm-card px-4 py-2.5">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-adm-t2">
                  Net Liquid Assets (regulatory)
                </span>
                {canRunPrudentialCheck && (
                  <button
                    type="button"
                    disabled={checkSubmitting}
                    onClick={() => void handleRunCheck()}
                    className={adminButtonClass('workflowPrimary')}
                  >
                    {checkSubmitting ? 'Running…' : 'Run prudential check'}
                  </button>
                )}
              </div>
              <div className="p-4">
                {!nla ? (
                  <EmptyRow label={nlaError ?? 'Loading prudential status…'} />
                ) : (
                  <>
                    {nla.breached && (
                      <div className="mb-4 rounded border border-adm-red/30 bg-adm-red/10 px-4 py-2 font-mono text-[11px] font-semibold text-adm-red">
                        NLA below regulatory floor — shortfall AED {shortfallAedMajor(nla.headroomAedMinor)}. A
                        prudential incident must be registered (Incident Register, CFO).
                      </div>
                    )}

                    <div className="relative h-3 w-full rounded-full bg-adm-border">
                      <div
                        className={`h-3 rounded-full ${nla.breached ? 'bg-adm-red' : 'bg-adm-green'}`}
                        style={{ width: `${nlaGauge.fillPct}%` }}
                      />
                      {nlaGauge.thresholdPct != null && (
                        <div
                          className="absolute -top-1 h-5 w-0.5 bg-adm-red"
                          style={{ left: `${nlaGauge.thresholdPct}%` }}
                          title={`Regulatory floor: AED ${formatMinorToMajor(nla.floorAedMinor, 2)}`}
                        />
                      )}
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-adm-t3">NLA</div>
                        <div
                          className={`mt-1 font-mono text-xl font-bold ${nla.breached ? 'text-adm-red' : 'text-adm-t1'}`}
                        >
                          AED {formatMinorToMajor(nla.nlaAedMinor, 2)}
                        </div>
                      </div>
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-adm-t3">Floor</div>
                        <div className="mt-1 font-mono text-xl font-bold text-adm-t1">
                          AED {formatMinorToMajor(nla.floorAedMinor, 2)}
                        </div>
                      </div>
                      <div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-adm-t3">Headroom</div>
                        <div
                          className={`mt-1 font-mono text-xl font-bold ${nla.breached ? 'text-adm-red' : 'text-adm-t1'}`}
                        >
                          AED {formatMinorToMajor(nla.headroomAedMinor, 2)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 font-mono text-[10px] text-adm-t3">
                      {nla.perAsset
                        .map((a) => `${a.currency} ${formatMinorToMajor(a.balanceMinor, decimalsOf(a.currency))}`)
                        .join(' + ')}{' '}
                      ≈ AED {formatMinorToMajor(nla.nlaAedMinor, 2)} @ {nla.pegRate}
                    </div>

                    {checkResult && (
                      <div
                        className={`mt-4 rounded border px-4 py-2 font-mono text-[11px] ${
                          checkResult.breached
                            ? 'border-adm-red/30 bg-adm-red/10 text-adm-red'
                            : 'border-adm-green/30 bg-adm-green/10 text-adm-green'
                        }`}
                      >
                        {checkResult.breached ? (
                          <>
                            NLA_BREACH — shortfall AED {shortfallAedMajor(checkResult.headroomAedMinor)}. A
                            prudential incident must be registered (Incident Register, CFO).
                          </>
                        ) : (
                          <>
                            NLA_OK — NLA AED {formatMinorToMajor(checkResult.nlaAedMinor, 2)}, Floor AED{' '}
                            {formatMinorToMajor(checkResult.floorAedMinor, 2)}, Headroom AED{' '}
                            {formatMinorToMajor(checkResult.headroomAedMinor, 2)}. Logged to audit trail.
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* ── ① Operating balances (F_OPS wallet cash account) ── */}
            <DetailCard
              title="Operating Balances — Firm Operating Funds"
              description="Below-threshold balances turn red — that's the cue to find an LP or push a client trade."
              columns={2}
            >
              {opsAccounts.length === 0 ? (
                <EmptyRow label="No operating funds account provisioned." />
              ) : (
                opsAccounts.map((row) => (
                  <OperatingBalanceCard key={row.tbAccountId} row={row} decimals={decimalsOf(row.assetCode)} />
                ))
              )}
            </DetailCard>

            {/* ── ② F_LIQ wallet cash account — in transit pending acceptance ── */}
            <DetailCard title="LP Delivery in Transit — Pending Acceptance" columns={3}>
              {liqAccounts.length === 0 ? (
                <EmptyRow label="No LP delivery in transit." />
              ) : (
                liqAccounts.map((row) => (
                  <SimpleBalanceCard key={row.tbAccountId} row={row} decimals={decimalsOf(row.assetCode)} />
                ))
              )}
            </DetailCard>

            {/* ── ②′ Due from LP — 戊波二 T10：LP 兑换批准后挂着的应收（码 51），LP 交货验收后冲平 ── */}
            <DetailCard
              title="Due from LP — Pending Delivery"
              description="What liquidity providers still owe us after an approved exchange. Clears when the LP delivers and the delivery is accepted."
              columns={3}
            >
              {dueFromLp.length === 0 ? (
                <EmptyRow label="No LP delivery outstanding." />
              ) : (
                dueFromLp.map((row) => (
                  <LpReceivableCard key={row.tbAccountId} row={row} decimals={decimalsOf(row.assetCode)} />
                ))
              )}
            </DetailCard>

            {/* ── ③ F_SET wallet cash account — settlement in transit ── */}
            <DetailCard title="Settlement in Transit — Fiat" columns={3}>
              {setAccountsRows.length === 0 ? (
                <EmptyRow label="No fiat settlement in transit." />
              ) : (
                setAccountsRows.map((row) => (
                  <SimpleBalanceCard key={row.tbAccountId} row={row} decimals={decimalsOf(row.assetCode)} />
                ))
              )}
            </DetailCard>

            {/* ── ④ Income (profit) ── */}
            <DetailCard title="Income (profit)" columns={3}>
              {INCOME_CODES.flatMap((code) => accountsByCode(code)).length === 0 ? (
                <EmptyRow label="No income posted yet." />
              ) : (
                INCOME_CODES.flatMap((code) => accountsByCode(code)).map((row) => (
                  <div key={row.tbAccountId}>
                    <div className="mb-1 truncate font-mono text-[9px] uppercase tracking-[0.08em] text-adm-t3" title={row.accountName ?? ''}>
                      {row.accountName ?? '—'}
                    </div>
                    <SimpleBalanceCard row={row} decimals={decimalsOf(row.assetCode)} />
                  </div>
                ))
              )}
            </DetailCard>

            {/* ── ⑤ Recent fund movements ── */}
            <DetailCard title="Recent Fund Movements — Last 10" columns={1}>
              {flows.length === 0 ? (
                <EmptyRow label="No recent company-account flows." />
              ) : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-adm-t3">
                      {['Time', 'Account', 'Direction', 'Amount', 'Event'].map((h) => (
                        <th key={h} className="px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em]">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {flows.map((f) => (
                      <tr key={f.id} className="border-t border-adm-border/60">
                        <td className="whitespace-nowrap px-2 py-1.5 font-mono text-adm-t3">{formatDate(f.createdAt)}</td>
                        <td className="px-2 py-1.5 font-mono text-adm-t2">{f.accountName ?? '—'}</td>
                        <td className="px-2 py-1.5">
                          <span className={`font-mono font-semibold ${f.direction === 'IN' ? 'text-adm-green' : 'text-adm-red'}`}>
                            {f.direction}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-adm-t1 tabular-nums">
                          {formatMinorToMajor(f.amount, decimalsOf(f.assetCode))} {f.assetCode}
                        </td>
                        <td className="px-2 py-1.5 font-mono text-adm-t2">{humanizeEventCode(f.eventCode)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </DetailCard>
          </>
        )}
      </div>
    </div>
  );
};

export default CompanyFundsDashboard;
