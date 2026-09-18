# 账务域三列表细化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给账本三张 admin 列表（账户/凭证/流水）补列并拉通账户身份口径——账户加 ID+实时余额、流水加 Account name/customerNo/ReferenceNo 并让 Balance After 恒显示、去 Wallet、凭证加 ReferenceNo。

**Architecture:** 三处后端**只读增强**（先读 Prisma 主体再挂只读 join / TB 批量余额，不进事务、不改写入、不加表、不碰权限），前端三页各改列。TB 余额整页一次 `lookupAccounts` 批量查，禁 N+1。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle 后端；React + Vite + Tailwind(`adm-*`) 管理台；jest（后端纯逻辑单测）；self 栈端口 backend 3120 / admin 3121，DB `/tmp/exchange_js_wt_ledger_detail/dev.db`。

**Spec:** `doc-final/superpowers/specs/2026-07-10-ledger-lists-refinement-design.md`

**执行前置：** 全程在 worktree `.claude/worktrees/ledger-detail/` 的 `Exchange_js/` 内。self 栈已起（`bash scripts/stack.sh up`）、demo 数据已灌（`on-stack.sh self db:biz:init` + `demo:all`）。后端命令若报 `ts-node: command not found`，前缀 `PATH="$PWD/node_modules/.bin:$PATH"`。

---

## 文件结构（谁负责什么）

**后端（3 处只读增强）**
- `src/modules/accounting/tigerbeetle/tb-evidence.service.ts` — `findAllFlows`：加 `attachAccountIdentity`（registry join → 每行挂 accountCode/ownerType/ownerNo/ownerUuid）＋ customerNo 过滤。
- `src/modules/accounting/tigerbeetle/tb-account-registry.service.ts` — `findAll`：加 `attachBalances`（TB 批量余额）＋导出纯函数 `postedBalanceForCode`（class-aware 符号，可单测）；构造函数注入 `TigerBeetleService`。
- `src/modules/accounting/tigerbeetle/tb-admin.controller.ts` — `findAccountFlows`：透传 `customerNo` query。（`findAccounts` 无需改，直传 findAll 结果。）
- `src/modules/accounting/tigerbeetle/tb-account-registry.service.spec.ts`（新建）— `postedBalanceForCode` 单测。

**前端（3 页改列）**
- `admin-web/src/pages/LedgerAccountList.tsx` — 加 ID 列 + Balance 列（含 decimals 格式化）。
- `admin-web/src/pages/AccountFlowList.tsx` — 删 Wallet 列/筛选；加 Account name/customerNo/ReferenceNo 列 + customerNo 筛选；Balance After 去单账户门恒显示。
- `admin-web/src/pages/TransferEvidenceList.tsx` — 加 ReferenceNo 列。

**测试口径：** 后端纯逻辑（余额符号）走 jest；join/过滤/余额的**端到端形状**走 self 栈 live curl（数据已灌，客观可验）；前端走 `tsc -b` 类型门 + 预览渲染快照。（本仓库 service 层无既有单测 harness，join/filter 传统上靠 live+demo 验——沿用。）

---

## Task 1: 后端 — 流水 registry join（Account name / customerNo 数据源，B1）

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/tb-evidence.service.ts`（`findAllFlows`，约 305-348）

- [ ] **Step 1: 在 findAllFlows 里把 items 过一遍 enrichment**

把方法结尾的 `return`（当前）：

```ts
    const [items, total] = await Promise.all([
      (this.prisma as any).accountFlow.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: filters.skip ?? 0, take: filters.take ?? 50,
      }),
      (this.prisma as any).accountFlow.count({ where }),
    ]);
    return { items, total, singleAccount: !!filters.tbAccountId };
```

改为：

```ts
    const [items, total] = await Promise.all([
      (this.prisma as any).accountFlow.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: filters.skip ?? 0, take: filters.take ?? 50,
      }),
      (this.prisma as any).accountFlow.count({ where }),
    ]);
    return { items: await this.attachAccountIdentity(items), total, singleAccount: !!filters.tbAccountId };
```

- [ ] **Step 2: 新增私有方法 `attachAccountIdentity`（紧接 findAllFlows 之后）**

```ts
  /** 给流水行批量挂账户身份(code/owner)：单次 IN 查询，禁 N+1。
   *  customerNo/ownerUuid 仅对 CUSTOMER 账户暴露，SYSTEM/LP 恒 null。 */
  private async attachAccountIdentity(rows: any[]): Promise<any[]> {
    const ids = [...new Set(rows.map((r) => r.tbAccountId).filter(Boolean))];
    if (ids.length === 0) return rows;
    const regs = await (this.prisma as any).tbAccountRegistry.findMany({
      where: { tbAccountId: { in: ids } },
      select: { tbAccountId: true, code: true, ownerType: true, ownerNo: true, ownerUuid: true },
    });
    const map = new Map<string, any>(regs.map((r: any) => [r.tbAccountId, r]));
    return rows.map((r) => {
      const reg = map.get(r.tbAccountId);
      const isCustomer = reg?.ownerType === 'CUSTOMER';
      return {
        ...r,
        accountCode: reg?.code ?? null,
        ownerType: reg?.ownerType ?? null,
        ownerNo: isCustomer ? (reg?.ownerNo ?? null) : null,
        ownerUuid: isCustomer ? (reg?.ownerUuid ?? null) : null,
      };
    });
  }
```

- [ ] **Step 3: 类型门**

Run: `npm run build`
Expected: 编译通过，无 TS 错误（末尾打印 `webpack ... compiled` / nest build 成功，退出码 0）。

- [ ] **Step 4: Commit**

```bash
git add src/modules/accounting/tigerbeetle/tb-evidence.service.ts
git commit -m "feat(ledger): join registry into account-flows rows (accountCode/ownerNo/ownerUuid)"
```

（live 验证并入 Task 3 的统一栈重启 curl 批次。）

---

## Task 2: 后端 — 流水 customerNo 筛选（丙，B2）

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/tb-evidence.service.ts`（`findAllFlows` 入参 + where）
- Modify: `src/modules/accounting/tigerbeetle/tb-admin.controller.ts`（`findAccountFlows` 透传）

- [ ] **Step 1: findAllFlows 入参加 `customerNo`**

在 `findAllFlows(filters: { ... })` 的类型里，`tbAccountId?: string;` 下一行加：

```ts
    customerNo?: string;
```

- [ ] **Step 2: 解析 customerNo → 约束 where.tbAccountId**

在 `if (filters.tbAccountId) where.tbAccountId = filters.tbAccountId;` 等简单 where 赋值**之后**、`const q = filters.q?.trim();` **之前**，插入：

```ts
    // customerNo：先查该客户的 tbAccountId 集合，再约束流水。与 tbAccountId 单值取交集。
    if (filters.customerNo?.trim()) {
      const regs = await (this.prisma as any).tbAccountRegistry.findMany({
        where: { ownerType: 'CUSTOMER', ownerNo: filters.customerNo.trim() },
        select: { tbAccountId: true },
      });
      const custIds: string[] = regs.map((r: any) => r.tbAccountId);
      if (filters.tbAccountId) {
        if (!custIds.includes(filters.tbAccountId)) where.tbAccountId = { in: [] };
        // 命中则保留已设的单值 where.tbAccountId
      } else {
        where.tbAccountId = { in: custIds }; // 空集合 → Prisma in:[] 返回 0 行
      }
    }
```

- [ ] **Step 3: 控制器透传 customerNo**

在 `findAccountFlows` 的参数列表里，`@Query('tbAccountId') tbAccountId?: string,` 下一行加：

```ts
    @Query('customerNo') customerNo?: string,
```

并在 `this.tbEvidenceService.findAllFlows({ ... })` 对象里，`tbAccountId: tbAccountId || undefined,` 下一行加：

```ts
      customerNo: customerNo || undefined,
```

- [ ] **Step 4: 类型门**

Run: `npm run build`
Expected: 编译通过，退出码 0。

- [ ] **Step 5: Commit**

```bash
git add src/modules/accounting/tigerbeetle/tb-evidence.service.ts src/modules/accounting/tigerbeetle/tb-admin.controller.ts
git commit -m "feat(ledger): filter account-flows by customerNo (resolve to that customer's tb accounts)"
```

---

## Task 3: 后端 — 账户列表实时余额（丁，B3）＋ 纯函数单测 ＋ live 验证

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/tb-account-registry.service.ts`
- Create: `src/modules/accounting/tigerbeetle/tb-account-registry.service.spec.ts`

- [ ] **Step 1: 写失败单测（class-aware 余额符号）**

新建 `src/modules/accounting/tigerbeetle/tb-account-registry.service.spec.ts`：

```ts
import { postedBalanceForCode } from './tb-account-registry.service';

describe('postedBalanceForCode', () => {
  it('asset code (1=CLIENT_ASSET): debits − credits', () => {
    expect(postedBalanceForCode({ debits_posted: 500n, credits_posted: 200n }, 1)).toBe('300');
  });
  it('liability code (100=CLIENT_PAYABLE): credits − debits', () => {
    expect(postedBalanceForCode({ debits_posted: 200n, credits_posted: 500n }, 100)).toBe('300');
  });
  it('equity code (200=FIRM_OPS): credits − debits', () => {
    expect(postedBalanceForCode({ debits_posted: 0n, credits_posted: 700n }, 200)).toBe('700');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `PATH="$PWD/node_modules/.bin:$PATH" npx jest tb-account-registry.service.spec`
Expected: FAIL —— `postedBalanceForCode is not a function` / 模块无该导出。

- [ ] **Step 3: 加导入 + 导出纯函数 `postedBalanceForCode`**

在 `tb-account-registry.service.ts` 顶部 import 段（`import { Prisma } from '@prisma/client';` 之后）加：

```ts
import { TigerBeetleService } from './tigerbeetle.service';
import { hexToBigint } from './utils/tb-id.util';
import { isAssetCode } from './constants/tb-account-codes.constant';
```

在 `@Injectable()` 装饰器**之前**（文件顶层）加导出纯函数：

```ts
/** class-aware posted 余额(分,字符串)。资产借正=debits−credits；负债/权益贷正=credits−debits。 */
export function postedBalanceForCode(
  acct: { debits_posted: bigint; credits_posted: bigint },
  code: number,
): string {
  const net = isAssetCode(code)
    ? acct.debits_posted - acct.credits_posted
    : acct.credits_posted - acct.debits_posted;
  return net.toString();
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `PATH="$PWD/node_modules/.bin:$PATH" npx jest tb-account-registry.service.spec`
Expected: PASS（3 passed）。

- [ ] **Step 5: 构造函数注入 TigerBeetleService**

把 `constructor(private readonly prisma: PrismaService) {}` 改为：

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly tbService: TigerBeetleService,
  ) {}
```

- [ ] **Step 6: findAll 结尾挂余额**

把 `findAll` 结尾的 `return { items: await this.attachOwnerNames(rows), total };` 改为：

```ts
    const named = await this.attachOwnerNames(rows);
    return { items: await this.attachBalances(named), total };
```

- [ ] **Step 7: 新增 `attachBalances`（紧接 `attachOwnerNames` 之后）**

```ts
  /** 整页账户余额：一次 TB 批量 lookupAccounts，class-aware 算 posted 余额；
   *  TB 不可用/账户缺失 → balance=null（前端显「—」），绝不阻断列表主体。 */
  private async attachBalances(rows: any[]): Promise<any[]> {
    if (rows.length === 0) return rows;
    let byId = new Map<string, { debits_posted: bigint; credits_posted: bigint }>();
    try {
      const ids = rows.map((r) => hexToBigint(r.tbAccountId));
      const accounts = await this.tbService.lookupAccounts(ids);
      byId = new Map(accounts.map((a: any) => [a.id.toString(), a]));
    } catch {
      return rows.map((r) => ({ ...r, balance: null }));
    }
    return rows.map((r) => {
      const acct = byId.get(hexToBigint(r.tbAccountId).toString());
      return { ...r, balance: acct ? postedBalanceForCode(acct, r.code) : null };
    });
  }
```

- [ ] **Step 8: 类型门 + 全量单测**

Run: `npm run build && PATH="$PWD/node_modules/.bin:$PATH" npx jest tb-account-registry.service.spec`
Expected: build 退出码 0；jest 3 passed。

- [ ] **Step 9: 重启 self 栈（后端换 dist）+ live curl 批次（验 Task 1/2/3）**

Run: `bash scripts/stack.sh up`（停旧→rebuild→重启；约 1 分钟）
然后：

```bash
API=http://localhost:3120
TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@fiatx.com","password":"123456"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.accessToken||j.access_token||j.token)})")
AUTH="Authorization: Bearer $TOKEN"
echo "--- T1 flows join: 期望某行有 accountCode + (客户行)ownerNo ---"
curl -s "$API/admin/tb/account-flows?take=100" -H "$AUTH" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const rows=JSON.parse(d).items;const cust=rows.find(r=>r.ownerType==='CUSTOMER');const sys=rows.find(r=>r.ownerType==='SYSTEM');console.log('customer row → accountCode=',cust?.accountCode,'ownerNo=',cust?.ownerNo,'ownerUuid?',!!cust?.ownerUuid);console.log('system row   → accountCode=',sys?.accountCode,'ownerNo=',sys?.ownerNo,'(应为 null)')})"
echo "--- T2 customerNo filter：取一个客户号，只回其流水 ---"
CU=$(curl -s "$API/admin/tb/account-flows?take=100" -H "$AUTH" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d).items.find(x=>x.ownerNo);console.log(r?r.ownerNo:'')})")
echo "picked customerNo=$CU"
curl -s "$API/admin/tb/account-flows?customerNo=$CU&take=100" -H "$AUTH" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const bad=j.items.filter(r=>r.ownerNo&&r.ownerNo!==process.argv[1]);console.log('total=',j.total,'| 非该客户混入条数(应0)=',bad.length)})" "$CU"
curl -s "$API/admin/tb/account-flows?customerNo=NOPE_NOBODY&take=10" -H "$AUTH" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('customerNo=NOPE total(应0)=',JSON.parse(d).total))"
echo "--- T3 accounts balance：每行有 balance；资产账户不为负 ---"
curl -s "$API/admin/tb/accounts?take=100" -H "$AUTH" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const rows=JSON.parse(d).items;const withBal=rows.filter(r=>r.balance!=null).length;const negAsset=rows.filter(r=>[1,50].includes(r.code)&&r.balance!=null&&BigInt(r.balance)<0n).length;console.log('rows=',rows.length,'| 有 balance 行=',withBal,'| 资产账户负余额条数(应0)=',negAsset)})"
```

Expected:
- customer row → `accountCode` 为 100/101，`ownerNo` 形如 `CU2601...`，`ownerUuid?` true；system row → `ownerNo=null`。
- customerNo 过滤：`非该客户混入条数=0`；`customerNo=NOPE... total=0`。
- accounts：`有 balance 行` = 行数（全有），`资产账户负余额条数=0`。

- [ ] **Step 10: Commit**

```bash
git add src/modules/accounting/tigerbeetle/tb-account-registry.service.ts src/modules/accounting/tigerbeetle/tb-account-registry.service.spec.ts
git commit -m "feat(ledger): real-time posted balance column on accounts list (batch TB lookup, class-aware)"
```

---

## Task 4: 前端 — 账户列表加 ID 列 + Balance 列

**Files:**
- Modify: `admin-web/src/pages/LedgerAccountList.tsx`

- [ ] **Step 1: interface 加 balance 字段**

`interface LedgerAccountRow` 里 `createdAt: string;` 之前加：

```ts
  balance: string | null;
```

- [ ] **Step 2: 加 分→元 格式化 + decimals**

在 `const formatDate = ...` 之前（`/* ── Helpers ── */` 段）加：

```ts
/* bigint-safe 分→元（与 AccountFlowList.formatMinorToMajor 同源）。 */
const formatMinorToMajor = (raw: string, decimals: number): string => {
  const s = String(raw ?? '0');
  let neg = false;
  let body = s;
  if (body.startsWith('-')) { neg = true; body = body.slice(1); }
  const padded = body.padStart(decimals + 1, '0');
  const intPart = padded.slice(0, padded.length - decimals) || '0';
  const fracPart = decimals > 0 ? padded.slice(padded.length - decimals) : '';
  const intGrouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${intGrouped}${fracPart ? `.${fracPart}` : ''}`;
};
```

- [ ] **Step 3: 让 assets 抓取带上 decimals**

`const [assets, setAssets] = useState<AssetOption[]>([]);` 之后加一行 state：

```ts
  const [decimalsMap, setDecimalsMap] = useState<Record<string, number>>({});
```

把 `fetchAssets` 里的 `setAssets(provisioned.map((a: any) => ({ code: a.code, type: a.type })));` 改为：

```ts
      setAssets(provisioned.map((a: any) => ({ code: a.code, type: a.type })));
      const dec: Record<string, number> = {};
      for (const a of provisioned) if (typeof a.decimals === 'number') dec[String(a.currency ?? a.code)] = a.decimals;
      setDecimalsMap(dec);
```

在组件内（`const th = ...` 附近）加：

```ts
  const decimalsOf = (assetCode: string): number => decimalsMap[assetCode] ?? 2;
```

- [ ] **Step 4: thead 加 ID 与 Balance 表头**

把 thead 里 `<th className={th}>Account</th>` 之后插入：

```tsx
              <th className={th}>ID</th>
```

把 `<th className={th}>Asset</th>` 之前插入：

```tsx
              <th className={th} style={{ textAlign: 'right' }}>Balance</th>
```

同时把两处空态 `colSpan={9}` 改为 `colSpan={11}`（新增 2 列）。

- [ ] **Step 5: tbody 加 ID 与 Balance 单元格**

在 Account 单元格（`{/* Account */}` 那个 `<td>…</td>`）**之后**插入 ID 单元格：

```tsx
                {/* ID */}
                <td className="px-3 py-2 font-mono text-[10px] text-adm-t2">
                  <span className="inline-flex items-center gap-1" title={row.tbAccountId}>
                    <span className="max-w-[220px] truncate">{row.tbAccountId}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); void navigator.clipboard?.writeText(row.tbAccountId); }}
                      className="text-adm-t3 hover:text-adm-t1"
                      title="Copy ID"
                    >
                      <Copy size={10} />
                    </button>
                  </span>
                </td>
```

在 `{/* Asset */}` 单元格**之前**插入 Balance 单元格：

```tsx
                {/* Balance */}
                <td className="px-3 py-2 font-mono text-[11px] text-adm-t1 text-right tabular-nums">
                  {row.balance != null ? formatMinorToMajor(row.balance, decimalsOf(row.assetCode)) : '—'}
                </td>
```

- [ ] **Step 6: 引入 Copy 图标**

把顶部 `import { Plus, RefreshCw, X } from 'lucide-react';` 改为：

```ts
import { Plus, RefreshCw, X, Copy } from 'lucide-react';
```

- [ ] **Step 7: 类型门**

Run: `cd admin-web && PATH="$PWD/node_modules/.bin:$PATH" tsc -b && cd ..`
Expected: 无类型错误，退出码 0。

- [ ] **Step 8: 预览渲染验证**（admin 3121，vite HMR 已生效）

用 preview 工具：reload → 用 seed admin（`admin@fiatx.com`/`123456`）登录 → 打开 `/admin/ledger/accounts` → snapshot。
Expected: 表头出现 `ID`、`Balance` 两列；某客户账户行 ID 显完整 `tbAccountId`、Balance 显数字（如 `30,000.00`）；资产账户 Balance 非负。

- [ ] **Step 9: Commit**

```bash
git add admin-web/src/pages/LedgerAccountList.tsx
git commit -m "feat(ledger-ui): accounts list — full tbAccountId ID column + real-time Balance column"
```

---

## Task 5: 前端 — 流水列表改列（去 Wallet / 加 name·customerNo·ReferenceNo / customerNo 筛选 / Balance 恒显）

**Files:**
- Modify: `admin-web/src/pages/AccountFlowList.tsx`

- [ ] **Step 1: interface 加字段**

`interface AccountFlowRow` 里，`walletRef: string | null;` **删除**，并在 `balanceAfter` 附近补：

```ts
  accountCode: number | null;
  ownerType: string | null;
  ownerNo: string | null;
  ownerUuid: string | null;
  externalRef: string | null;
```

- [ ] **Step 2: FilterState / DEFAULT_FILTERS：去 walletRef，加 customerNo**

`interface FilterState` 里删 `walletRef: string;`，加 `customerNo: string;`。
`DEFAULT_FILTERS` 里删 `walletRef: '',`，加 `customerNo: '',`。
初始化 `useState<FilterState>` 的 `walletRef: searchParams.get('walletRef')?.trim() ?? '',` 一行**删除**（改从 customerNo 无需预填）。

- [ ] **Step 3: fetchData 的 query 参数：去 walletRef，加 customerNo**

删 `if (nextFilters.walletRef.trim()) params.set('walletRef', nextFilters.walletRef.trim());`
加：

```ts
      if (nextFilters.customerNo.trim()) params.set('customerNo', nextFilters.customerNo.trim());
```

- [ ] **Step 4: hasFilter：去 walletRef，加 customerNo**

`hasFilter` 表达式里 `!!filters.walletRef.trim() ||` 换成 `!!filters.customerNo.trim() ||`。

- [ ] **Step 5: 删「余额仅单账户」逻辑，改常量 name helper**

删掉这两行：

```ts
  /* balanceAfter only meaningful when filtered to ONE account. */
  const singleAccount = !!filters.tbAccountId.trim();
```

在 `formatDate` 之前加账户名 helper（引入 TB_CODE_LABELS）：

```ts
  const accountName = (code: number | null, asset: string): string =>
    code == null ? '—' : `${TB_CODE_LABELS[code] ?? `CODE_${code}`} · ${asset}`;
```

顶部加导入：

```ts
import { TB_CODE_LABELS } from './ledger-account.constants';
```

- [ ] **Step 6: 筛选条：把 Wallet Ref 输入框换成 customerNo 输入框**

把这段（Wallet Ref input）：

```tsx
        <input
          className={`${fi} w-40`}
          placeholder="Wallet Ref"
          value={filters.walletRef}
          onChange={(e) => updateFilter('walletRef', e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
        />
```

替换为：

```tsx
        <input
          className={`${fi} w-40`}
          placeholder="Customer No"
          value={filters.customerNo}
          onChange={(e) => updateFilter('customerNo', e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
        />
```

- [ ] **Step 7: thead —— 去 Wallet，加 Account name / customerNo / ReferenceNo**

把 `<th className={th} style={{ width: 130 }}>Wallet</th>` **删除**，在 `Account` 表头之后加两列：

```tsx
              <th className={th} style={{ width: 150 }}>Account Name</th>
              <th className={th} style={{ width: 120 }}>Customer No</th>
```

在 `<th ...>Source No</th>` 之后加：

```tsx
              <th className={th} style={{ width: 150 }}>ReferenceNo</th>
```

改 Balance After 表头 title：`title="选定账户后显示余额"` → `title="过账后当时余额"`。
两处空态 `colSpan={12}` 改为 `colSpan={14}`。

- [ ] **Step 8: tbody —— 去 Wallet 单元格，加三个新单元格，Balance 恒显**

删掉 Wallet 单元格：

```tsx
                <td className="px-3 py-2 font-mono text-[11px] text-adm-t2 truncate max-w-[130px]" title={row.walletRef ?? ''}>
                  {row.walletRef || '—'}
                </td>
```

在 Account 单元格（那个带 `navigate(.../accounts/${row.tbAccountId})` 的 `<td>`）**之后**加：

```tsx
                <td className="px-3 py-2 font-mono text-[11px] text-adm-t2 truncate max-w-[150px]" title={accountName(row.accountCode, row.assetCode)}>
                  {accountName(row.accountCode, row.assetCode)}
                </td>
                <td className="px-3 py-2 font-mono text-[11px]">
                  {row.ownerNo && row.ownerUuid ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/admin/customers/${row.ownerUuid}`); }}
                      className="text-adm-amber hover:underline"
                      title="Open customer"
                    >
                      {row.ownerNo}
                    </button>
                  ) : (
                    <span className="text-adm-t3">—</span>
                  )}
                </td>
```

把 Balance After 单元格从：

```tsx
                <td className="px-3 py-2 font-mono text-[11px] text-adm-t1 text-right tabular-nums">
                  {singleAccount && row.balanceAfter != null
                    ? formatMinorToMajor(row.balanceAfter, decimalsOf(row.assetCode))
                    : '—'}
                </td>
```

改为（去掉 singleAccount 门）：

```tsx
                <td className="px-3 py-2 font-mono text-[11px] text-adm-t1 text-right tabular-nums">
                  {row.balanceAfter != null
                    ? formatMinorToMajor(row.balanceAfter, decimalsOf(row.assetCode))
                    : '—'}
                </td>
```

在 Source No 单元格之后加 ReferenceNo 单元格：

```tsx
                <td className="px-3 py-2 font-mono text-[11px] text-adm-t2 truncate max-w-[150px]" title={row.externalRef ?? ''}>
                  {row.externalRef || '—'}
                </td>
```

- [ ] **Step 9: 类型门**

Run: `cd admin-web && PATH="$PWD/node_modules/.bin:$PATH" tsc -b && cd ..`
Expected: 无类型错误，退出码 0。

- [ ] **Step 10: 预览渲染验证**

preview：reload → `/admin/ledger/flows`（流水列表）→ snapshot。
Expected: **无** Wallet 列；有 `Account Name`(如 `CLIENT_PAYABLE · USDT`) / `Customer No` / `ReferenceNo` 列；Balance After **每行都是数字**（不再全「—」）；顶部筛选出现 `Customer No` 框、无 `Wallet Ref` 框。再输入一个客户号查询 → 只剩该客户行。

- [ ] **Step 11: Commit**

```bash
git add admin-web/src/pages/AccountFlowList.tsx
git commit -m "feat(ledger-ui): flows list — drop Wallet, add Account Name/Customer No/ReferenceNo, always-on Balance After, customerNo filter"
```

---

## Task 6: 前端 — 凭证列表加 ReferenceNo 列（乙）

**Files:**
- Modify: `admin-web/src/pages/TransferEvidenceList.tsx`

- [ ] **Step 1: interface 加 externalRef**

`interface TransferEvidenceRow` 里 `effectiveDate: string;` 之前加：

```ts
  externalRef: string | null;
```

- [ ] **Step 2: thead 加 ReferenceNo 表头**

在 `<th className={th} style={{ width: 100 }}>Credit</th>` 之后加：

```tsx
              <th className={th} style={{ width: 150 }}>ReferenceNo</th>
```

把该表的空态 `colSpan={11}`（两处）改为 `colSpan={12}`。

- [ ] **Step 3: tbody 加 ReferenceNo 单元格**

在 Credit 单元格（`text-blue-400` 那个 `<td>{row.creditCode}</td>`）之后加：

```tsx
                <td className="px-3 py-2 font-mono text-[11px] text-adm-t2 truncate max-w-[150px]" title={row.externalRef ?? ''}>
                  {row.externalRef || '—'}
                </td>
```

- [ ] **Step 4: 类型门**

Run: `cd admin-web && PATH="$PWD/node_modules/.bin:$PATH" tsc -b && cd ..`
Expected: 无类型错误，退出码 0。

- [ ] **Step 5: 预览渲染验证**

preview：reload → `/admin/ledger/transfer-evidence`（凭证列表）→ snapshot。
Expected: Credit 后出现 `ReferenceNo` 列；有 `externalRef` 的行显值（如链上 hash / 银行号），空行显「—」；Debit/Credit 保持 `A.CLIENT_ASSET`（甲未动）。

- [ ] **Step 6: Commit**

```bash
git add admin-web/src/pages/TransferEvidenceList.tsx
git commit -m "feat(ledger-ui): evidence list — add ReferenceNo (externalRef) column"
```

---

## 收尾验证（全任务完成后）

- [ ] **Step 1: 硬门全绿**

Run: `npm run build && cd admin-web && PATH="$PWD/node_modules/.bin:$PATH" tsc -b && cd .. && PATH="$PWD/node_modules/.bin:$PATH" npx jest tb-account-registry.service.spec`
Expected: 后端 build 0 错；admin tsc 0 错；jest 3 passed。

- [ ] **Step 2: 三页快照复核 spec §5 验收清单**

逐条对 `spec §5`：账户(ID/Balance/一次批量查) · 流水(去Wallet/name/customerNo/ReferenceNo/Balance恒显/customerNo筛选) · 凭证(ReferenceNo) · 回归(点击跳转/分页/三态)。

- [ ] **Step 3: 同步真相文档**

若 `doc-final/reference/truth/` 有账本列表页现状描述，按本次列变更同步（改代码必须同步 truth/）。

---

## Self-Review（写完即查，已核）

- **Spec 覆盖**：账户 ID(Task4)/余额(Task3+4) · 流水 −Wallet+name+customerNo+ReferenceNo+Balance恒显(Task1+2+5) · 凭证 ReferenceNo(Task6) · 甲撤销(不排任务) · pending排除(BACKLOG，不排任务) —— 全覆盖。
- **占位符**：无 TBD/TODO；每个改码步骤给出完整片段。
- **类型一致**：后端挂 `accountCode/ownerType/ownerNo/ownerUuid/externalRef`(Task1) 与前端 interface(Task5) 同名；`balance`(Task3) 与前端(Task4) 同名；`postedBalanceForCode` 签名 Task3 内自洽。
