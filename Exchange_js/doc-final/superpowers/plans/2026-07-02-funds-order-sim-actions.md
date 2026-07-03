# FundsOrder 模拟操作补回 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 C6 合并详情页时漏掉的"⚡ 模拟操作"按钮补回统一的 `FundsOrderDetail`,适配新的事件驱动状态机。

**Architecture:** 后端加 `POST /admin/funds-orders/:fundsOrderNo/advance`(deposit/withdraw 走 `FundsOrderService.advance`,swap 腿后端兜底拒绝并引导走已有 swap 端点)。前端 `FundsOrderDetail` 加模拟面板,复用全局 `useSimulationMode()` 开关;deposit/withdraw 按钮打新端点(FundsOrderAction 词表),swap 腿按钮打已有 `/admin/swap-transactions/:swapNo/legs/:legSeq/advance`(InternalFundAction 词表)。

**Tech Stack:** NestJS + Prisma;React admin-web;Jest。

**Spec:** `doc-final/superpowers/specs/2026-07-02-funds-order-sim-actions-design.md`

**Base:** `main` at `b7254e3`。**分支:** `feature/funds-order-sim-actions`(基于 main)。

---

## 全局约定

- 工作目录 `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js`。
- Commit 用显式路径(`git add <files>`),**禁止 `git add -A`**。
- **禁止 `git stash`**(会误弹旧 stash 污染 recon 禁区文件)。查历史用 `git show <commit>:<path>`。
- 不动 reconciliation(禁区)、不改状态机/转移表、不动 swap advanceLeg/resume。
- 硬闸:`npx tsc --noEmit -p tsconfig.json` 0 errors;`npm run demo:all` 8/8;`verify:coa` PASS;admin build ✓。

---

## 文件结构地图

**后端**:
- Modify `src/modules/funds-orders/funds-order.service.ts` — 加 `advanceByNo(fundsOrderNo, action, operator)`
- Create `src/modules/funds-orders/dto/advance-funds-order.dto.ts` — `AdvanceFundsOrderDto { action }`
- Modify `src/modules/funds-orders/funds-orders.admin.controller.ts` — 加 `@Post(':fundsOrderNo/advance')` + audit
- Modify `src/modules/funds-orders/funds-orders.module.ts` — 确保 AuditLogsModule 可用(注入 AuditLogsService)
- Modify `src/modules/audit-logging/constants/audit-actions.constant.ts` — 加 `FUNDS_ORDER_ADVANCED`
- Modify `src/modules/identity/access-control/rbac.catalog.ts` — 注册新 route
- Test `src/modules/funds-orders/funds-order.service.spec.ts` — advanceByNo 单测

**前端**:
- Create `admin-web/src/utils/fundsOrderSimActionMap.ts` — 动作矩阵 + 双语文案
- Modify `admin-web/src/pages/FundsOrderDetail.tsx` — 加模拟面板

---

## Task 1: 后端 advance 端点 + advanceByNo(TDD)

**Files:**
- Test: `Exchange_js/src/modules/funds-orders/funds-order.service.spec.ts`
- Modify: `Exchange_js/src/modules/funds-orders/funds-order.service.ts`
- Create: `Exchange_js/src/modules/funds-orders/dto/advance-funds-order.dto.ts`
- Modify: `Exchange_js/src/modules/funds-orders/funds-orders.admin.controller.ts`
- Modify: `Exchange_js/src/modules/funds-orders/funds-orders.module.ts`
- Modify: `Exchange_js/src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `Exchange_js/src/modules/identity/access-control/rbac.catalog.ts`

- [ ] **Step 1: 加 audit action 常量**

在 `audit-actions.constant.ts` 的 `AuditActions` 里(靠近其他 FUNDS/DEPOSIT action)加:
```typescript
  FUNDS_ORDER_ADVANCED: 'FUNDS_ORDER_ADVANCED',
```

- [ ] **Step 2: 写 advanceByNo 失败测试**

在 `funds-order.service.spec.ts` 末尾(describe 内)加:
```typescript
  describe('advanceByNo', () => {
    it('rejects swap-leg funds orders (must use swap endpoint)', async () => {
      prisma.fundsOrder.findUnique.mockResolvedValue({
        id: 'fo-swap', fundsOrderNo: 'FO-SWAP', status: 'CREATED',
        depositTransactionId: null, withdrawTransactionId: null, swapTransactionId: 's1',
        legSeq: 1, attempt: 1, statusHistory: null, asset: { type: 'CRYPTO' },
      });
      await expect(service.advanceByNo('FO-SWAP', FundsOrderAction.SUBMIT, 'ADMIN'))
        .rejects.toThrow(/swap-transactions/i);
    });

    it('advances a withdraw funds order via advance()', async () => {
      prisma.fundsOrder.findUnique
        .mockResolvedValueOnce({
          id: 'fo-wd', fundsOrderNo: 'FO-WD', status: 'CREATED',
          depositTransactionId: null, withdrawTransactionId: 'w1', swapTransactionId: null,
          legSeq: 1, attempt: 1, statusHistory: null, asset: { type: 'CRYPTO' },
        })  // advanceByNo's lookup
        .mockResolvedValueOnce({
          id: 'fo-wd', status: 'CREATED',
          depositTransactionId: null, withdrawTransactionId: 'w1', swapTransactionId: null,
          legSeq: 1, attempt: 1, statusHistory: null, asset: { type: 'CRYPTO' },
        }); // advance()'s internal FOR UPDATE lookup
      prisma.fundsOrder.update.mockResolvedValue({
        id: 'fo-wd', fundsOrderNo: 'FO-WD', status: 'SUBMITTED',
        depositTransactionId: null, withdrawTransactionId: 'w1', swapTransactionId: null,
        legSeq: 1, attempt: 1,
      });
      const result = await service.advanceByNo('FO-WD', FundsOrderAction.SUBMIT, 'ADMIN');
      expect(result.status).toBe('SUBMITTED');
    });

    it('throws NotFound for unknown fundsOrderNo', async () => {
      prisma.fundsOrder.findUnique.mockResolvedValue(null);
      await expect(service.advanceByNo('NOPE', FundsOrderAction.SUBMIT, 'ADMIN'))
        .rejects.toThrow(/not found/i);
    });
  });
```

> 注:测试文件顶部已 import `FundsOrderAction`。若没有,加 `import { FundsOrderAction } from './dto/funds-order.dto';`。

- [ ] **Step 3: Run 确认 fail**

Run: `cd Exchange_js && npx jest funds-order.service --silent 2>&1 | tail -8`
Expected: FAIL(advanceByNo 未定义)。

- [ ] **Step 4: 实现 advanceByNo**

在 `funds-order.service.ts` 的 `advance(...)` 方法后面加:
```typescript
  /**
   * Advance by business no — admin/simulation entry.
   * swap legs are rejected here and must go through the swap controller's
   * advanceLeg (which enforces the sell-first sequence guard). deposit/withdraw
   * route through the standard advance() (transition-map validated).
   */
  async advanceByNo(fundsOrderNo: string, action: FundsOrderAction, operatorId: string) {
    const row = await this.prisma.fundsOrder.findUnique({ where: { fundsOrderNo } });
    if (!row) throw new NotFoundException(`FundsOrder ${fundsOrderNo} not found`);
    if (row.swapTransactionId) {
      throw new BadRequestException(
        'Swap-leg funds orders advance via /admin/swap-transactions/:swapNo/legs/:legSeq/advance',
      );
    }
    return this.advance(row.id, action, operatorId);
  }
```

> `NotFoundException` / `BadRequestException` 已在文件顶部 import(`advance` 用了)。确认 import 行有它们。

- [ ] **Step 5: Run 确认 pass**

Run: `cd Exchange_js && npx jest funds-order.service --silent 2>&1 | tail -8`
Expected: PASS(原有 + 3 新测试)。

- [ ] **Step 6: 建 DTO**

Create `Exchange_js/src/modules/funds-orders/dto/advance-funds-order.dto.ts`:
```typescript
import { IsEnum } from 'class-validator';
import { FundsOrderAction } from './funds-order.dto';

export class AdvanceFundsOrderDto {
  @IsEnum(FundsOrderAction)
  action!: FundsOrderAction;
}
```

- [ ] **Step 7: controller 加 advance 端点 + audit**

先确认 module 能注入 AuditLogsService。看 `funds-orders.module.ts` imports 是否含 `AuditLogsModule`;没有则加(`import { AuditLogsModule } from '../audit-logging/audit-logs.module';` + imports 数组加它)。

在 `funds-orders.admin.controller.ts`:
- import 补:`Post, Body, Req`(from `@nestjs/common`)、`AdvanceFundsOrderDto`、`AuditLogsService`、`AuditActions, AuditEntityTypes, AuditWorkflowTypes`(from audit constants)。
- constructor 注入 `private readonly auditLogs: AuditLogsService`。
- 加方法:
```typescript
  @Post(':fundsOrderNo/advance')
  @ApiOperation({ summary: 'Advance a funds order (simulation/ops)' })
  @RequirePermissions(
    buildPermissionCode('POST', '/admin/funds-orders/:fundsOrderNo/advance'),
  )
  @UsePipes(new ValidationPipe({ transform: true }))
  async advance(
    @Param('fundsOrderNo') fundsOrderNo: string,
    @Body() dto: AdvanceFundsOrderDto,
    @Req() req: any,
  ) {
    const before = await this.fundsOrders.findOneByNoForAdmin(fundsOrderNo);
    const actorNo = req.user?.userNo || req.user?.sub || 'ADMIN';
    const updated = await this.fundsOrders.advanceByNo(fundsOrderNo, dto.action, actorNo);
    await this.auditLogs.recordByActor(
      {
        action: AuditActions.FUNDS_ORDER_ADVANCED,
        entityType: AuditEntityTypes.INTERNAL_FUND,
        entityId: updated.id,
        entityNo: fundsOrderNo,
        workflowType: AuditWorkflowTypes.DEPOSIT,
        reason: `Sim advance ${dto.action}: ${before.status} → ${updated.status}`,
        metadata: { fundsOrderNo, action: dto.action, fromStatus: before.status, toStatus: updated.status },
        sourcePlatform: 'ADMIN',
      },
      { actorType: 'ADMIN', actorId: actorNo, actorNo, actorRole: 'ADMIN' },
    );
    return updated;
  }
```

> `AuditWorkflowTypes.DEPOSIT` 是占位(sim advance 跨类型;审计 workflowType 必填非空)。若有更中性的值(如 `FUNDS` / `INTERNAL_TRANSFER`)优先用;没有就用 DEPOSIT,metadata 里已带真实类型信息。实施时 grep `AuditWorkflowTypes` 选最合适的现有值。
> `AuditEntityTypes.INTERNAL_FUND` 复用(funds_order 审计一直用它)。

- [ ] **Step 8: RBAC 注册**

在 `rbac.catalog.ts` 找到 funds-orders 的 route() 登记处(C6 加的 GET routes,用 `INTERNAL_FUND_READ`),紧跟着加:
```typescript
  route('POST', '/admin/funds-orders/:fundsOrderNo/advance', 'Advance funds order (sim/ops)', ['INTERNAL_FUND_READ']),
```
> **复用 `INTERNAL_FUND_READ`**(已核实:catalog 里只有 `INTERNAL_FUND_READ`,无 `_WRITE`)。sim 是演示/开发工具,能查看即能模拟,不新建 write bucket。若这个 bucket 的类型联合(`| 'INTERNAL_FUND_READ'`)需要,已存在,直接用。

- [ ] **Step 9: tsc + RBAC sync + 硬闸**

Run:
```bash
cd Exchange_js
npx tsc --noEmit -p tsconfig.json
npm run db:base:sync 2>&1 | tail -3
npm run demo:all 2>&1 | tail -6
```
Expected: tsc 0;demo:all 8/8。

- [ ] **Step 10: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版
git add Exchange_js/src/modules/funds-orders/funds-order.service.ts \
        Exchange_js/src/modules/funds-orders/funds-order.service.spec.ts \
        Exchange_js/src/modules/funds-orders/dto/advance-funds-order.dto.ts \
        Exchange_js/src/modules/funds-orders/funds-orders.admin.controller.ts \
        Exchange_js/src/modules/funds-orders/funds-orders.module.ts \
        Exchange_js/src/modules/audit-logging/constants/audit-actions.constant.ts \
        Exchange_js/src/modules/identity/access-control/rbac.catalog.ts
git commit -m "feat(funds-orders): admin advance endpoint (sim/ops) + audit + RBAC"
```

---

## Task 2: 前端 sim action map(纯逻辑)

**Files:**
- Create: `Exchange_js/admin-web/src/utils/fundsOrderSimActionMap.ts`

- [ ] **Step 1: 建 action map**

Create `Exchange_js/admin-web/src/utils/fundsOrderSimActionMap.ts`:
```typescript
// ⚡ 模拟操作动作矩阵 —— 和后端 funds-order-transitions.constant.ts 对齐。
// deposit/withdraw 送 FundsOrderAction(打 /admin/funds-orders/:no/advance)。
// swap 腿送 InternalFundAction(打 /admin/swap-transactions/:swapNo/legs/:legSeq/advance)。

export type AssetType = 'CRYPTO' | 'FIAT';

export interface SimAction {
  key: string;              // 稳定 key
  fundsOrderAction: string; // deposit/withdraw 用(FundsOrderAction)
  swapAction: string;       // swap 腿用(InternalFundAction)
  labelZh: string;
  labelEn: string;
  destructive: boolean;
  enabledStatuses: Set<string>;   // crypto/fiat 各自的可用状态
}

// crypto: CREATED→SUBMIT→SUBMITTED→OBSERVE_CONFIRMING→CONFIRMING→CONFIRM→CONFIRMED
const CRYPTO_ACTIONS: SimAction[] = [
  { key: 'SUBMIT', fundsOrderAction: 'SUBMIT', swapAction: 'SIGN',
    labelZh: '⚡ 广播', labelEn: '⚡ Broadcast', destructive: false,
    enabledStatuses: new Set(['CREATED']) },
  { key: 'OBSERVE_CONFIRMING', fundsOrderAction: 'OBSERVE_CONFIRMING', swapAction: 'SEEN_IN_MEMPOOL',
    labelZh: '⚡ 链上可见', labelEn: '⚡ Seen in Mempool', destructive: false,
    enabledStatuses: new Set(['SUBMITTED']) },
  { key: 'CONFIRM', fundsOrderAction: 'CONFIRM', swapAction: 'CONFIRM',
    labelZh: '⚡ 确认到账', labelEn: '⚡ Confirm', destructive: false,
    enabledStatuses: new Set(['CONFIRMING']) },
  { key: 'FAIL', fundsOrderAction: 'FAIL', swapAction: 'FAIL',
    labelZh: '⚡ 失败', labelEn: '⚡ Fail', destructive: true,
    enabledStatuses: new Set(['SUBMITTED', 'CONFIRMING']) },
  { key: 'TIMEOUT', fundsOrderAction: 'TIMEOUT', swapAction: 'TIMEOUT',
    labelZh: '⚡ 超时', labelEn: '⚡ Timeout', destructive: true,
    enabledStatuses: new Set(['SUBMITTED', 'CONFIRMING']) },
];

// fiat: CREATED→SUBMIT→SUBMITTED→CONFIRM→CONFIRMED(无 OBSERVE_CONFIRMING)
const FIAT_ACTIONS: SimAction[] = [
  { key: 'SUBMIT', fundsOrderAction: 'SUBMIT', swapAction: 'SUBMIT',
    labelZh: '⚡ 提交银行', labelEn: '⚡ Submit', destructive: false,
    enabledStatuses: new Set(['CREATED']) },
  { key: 'CONFIRM', fundsOrderAction: 'CONFIRM', swapAction: 'CONFIRM',
    labelZh: '⚡ 银行到账', labelEn: '⚡ Settle', destructive: false,
    enabledStatuses: new Set(['SUBMITTED']) },
  { key: 'FAIL', fundsOrderAction: 'FAIL', swapAction: 'FAIL',
    labelZh: '⚡ 失败', labelEn: '⚡ Fail', destructive: true,
    enabledStatuses: new Set(['SUBMITTED']) },
  { key: 'TIMEOUT', fundsOrderAction: 'TIMEOUT', swapAction: 'TIMEOUT',
    labelZh: '⚡ 超时', labelEn: '⚡ Timeout', destructive: true,
    enabledStatuses: new Set(['SUBMITTED']) },
];

const TERMINAL = new Set(['CLEARED', 'FAILED', 'TIMEOUT']);

export function getFundsOrderSimActions(
  status: string,
  assetType: AssetType,
): Array<SimAction & { enabled: boolean }> {
  const s = (status || '').toUpperCase();
  if (TERMINAL.has(s)) return [];
  const actions = assetType === 'FIAT' ? FIAT_ACTIONS : CRYPTO_ACTIONS;
  return actions
    .filter((a) => a.enabledStatuses.has(s))
    .map((a) => ({ ...a, enabled: true }));
}
```

> `CONFIRMED` 状态返回空数组(workflow 自动 CLEAR,无手动按钮)—— 上面 filter 天然满足(没有 action 的 enabledStatuses 含 CONFIRMED)。

- [ ] **Step 2: tsc(admin-web)**

Run: `cd Exchange_js/admin-web && npx tsc --noEmit 2>&1 | tail -3`
Expected: 0 errors。

- [ ] **Step 3: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版
git add Exchange_js/admin-web/src/utils/fundsOrderSimActionMap.ts
git commit -m "feat(admin): fundsOrderSimActionMap — sim action matrix + bilingual labels"
```

---

## Task 3: FundsOrderDetail 模拟面板

**Files:**
- Modify: `Exchange_js/admin-web/src/pages/FundsOrderDetail.tsx`

- [ ] **Step 1: 读现有 FundsOrderDetail 结构**

先通读 `FundsOrderDetail.tsx`,确认:数据 state 变量名(funds order 数据对象)、refetch 函数名、adminFetch 用法(`admin-web/src/utils/adminFetch.ts`)、已 import 的东西。以现有 fetch/error 处理风格为准。

- [ ] **Step 2: 加模拟面板**

在 `FundsOrderDetail.tsx`:
- import 补:
```typescript
import { useSimulationMode } from '../utils/simulationMode';
import { getFundsOrderSimActions } from '../utils/fundsOrderSimActionMap';
```
- 组件内加:
```typescript
  const { enabled: simEnabled } = useSimulationMode();
  const [simSubmitting, setSimSubmitting] = useState(false);
```
- 加处理函数(`data` = 详情数据对象,字段名以 Step 1 读到的为准;下面用 `data` 占位):
```typescript
  const handleSimAction = async (a: { key: string; fundsOrderAction: string; swapAction: string; destructive: boolean; labelZh: string }) => {
    if (a.destructive && !window.confirm(`确定执行「${a.labelZh}」? 这会把资金单打到失败终态并触发退款/解锁。`)) return;
    setSimSubmitting(true);
    try {
      const isSwap = !!data.swapTransactionId;
      const url = isSwap
        ? `/admin/swap-transactions/${data.swapNo}/legs/${data.legSeq}/advance`
        : `/admin/funds-orders/${data.fundsOrderNo}/advance`;
      const action = isSwap ? a.swapAction : a.fundsOrderAction;
      const response = await adminFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        alert(await getApiErrorMessage(response, 'Simulation failed'));
        return;
      }
      await refetch(); // ← 用 Step 1 读到的真实 refetch 函数名替换
    } catch (error) {
      console.error('Sim failed', error);
      alert('Simulation request failed');
    } finally {
      setSimSubmitting(false);
    }
  };
```
- 在详情渲染区(metadata 卡下面)加面板 JSX:
```tsx
  {simEnabled && (
    <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="mb-2 text-sm font-semibold text-amber-800">⚡ 模拟操作 / Simulation</div>
      {(() => {
        const actions = getFundsOrderSimActions(data.status, (data.asset?.type || 'CRYPTO').toUpperCase());
        if (actions.length === 0) {
          return <div className="text-sm text-gray-500">终态或无可用动作 / No actions available</div>;
        }
        return (
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <button
                key={a.key}
                disabled={simSubmitting}
                onClick={() => handleSimAction(a)}
                className={`rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
                  a.destructive ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'
                }`}
              >
                {a.labelZh} / {a.labelEn.replace('⚡ ', '')}
              </button>
            ))}
          </div>
        );
      })()}
    </div>
  )}
```
> `getApiErrorMessage` / `adminFetch` 若详情页还没 import,从 `../utils/adminFetch`(或它们实际所在)import。以页面现有工具函数为准(读 Step 1)。
> `data` / `refetch` 换成 Step 1 读到的真实变量/函数名。若详情页用 react-query,`refetch` 就是 query 的 refetch;若手写 fetch,则调那个重新拉取的函数。

- [ ] **Step 3: tsc + build**

Run: `cd Exchange_js/admin-web && npx tsc --noEmit && npm run build 2>&1 | tail -4`
Expected: tsc 0 + build ✓。

- [ ] **Step 4: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版
git add Exchange_js/admin-web/src/pages/FundsOrderDetail.tsx
git commit -m "feat(admin): FundsOrderDetail simulation action panel (restore C6-dropped feature)"
```

---

## Task 4: 验证(渲染截图 + 硬闸)

**Files:** 无代码改动。

- [ ] **Step 1: 后端硬闸**

Run:
```bash
cd Exchange_js
npx tsc --noEmit -p tsconfig.json
npm run demo:all 2>&1 | tail -6
DATABASE_URL="file:/tmp/exchange_js_main/dev.db" TB_ADDRESS=127.0.0.1:3003 npm run verify:coa 2>&1 | tail -3
```
Expected: tsc 0;demo:all 8/8;verify:coa PASS。

- [ ] **Step 2: 重启后端(RBAC 新 route 生效)**

Run: `cd Exchange_js && bash scripts/stack.sh up main 2>&1 | tail -6`
(SUPER_ADMIN 走内存 RBAC,重启才认新 route。)

- [ ] **Step 3: 渲染 + 截图验证**

用 preview 工具(种子 admin@fiatx.com/123456 登录注入 token):
1. 打开 simulation mode(设置里或直接 `setSimulationModeEnabled(true)` 注入 cookie/localStorage)。
2. 进一笔 crypto funds order 详情(status=SUBMITTED)→ 截图确认亮"链上可见/确认到账"按钮;点"链上可见"→ 状态推进到 CONFIRMING(刷新后)。
3. 进一笔 fiat funds order 详情(status=CREATED)→ 截图确认亮"提交银行"。
4. 关掉 simulation mode → 面板消失。

> 若 demo 数据全是终态 CLEARED(无 SUBMITTED/CREATED 的活单),先跑一笔新的:`npm run demo:deposit`(或手动建),或在 demo 中途状态截图。至少证明:面板在非终态显示正确按钮 + 点击能推进状态 + 终态/off 时不显示。

- [ ] **Step 4: 最终确认**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版
git log --oneline main..HEAD
```
Expected: 3 个 feature commit(Task 1/2/3)。

---

## Self-Review 记录

- **Spec 覆盖**:§3 后端 advance 端点→Task 1;§4 前端 sim map→Task 2 + 面板→Task 3;§5 验证→Task 4。全覆盖。
- **两词表**:Task 2 的 SimAction 同时带 `fundsOrderAction`(deposit/withdraw)+ `swapAction`(swap InternalFundAction);Task 3 按 `isSwap` 选端点 + 选 action 值。与 spec §4 一致。
- **类型一致**:`getFundsOrderSimActions(status, assetType)` 定义(Task 2)= 调用(Task 3);`advanceByNo(fundsOrderNo, action, operator)` 定义(Task 1 Step 4)= 调用(Task 1 Step 7 controller)。
- **swap 守卫**:后端 advanceByNo 拒绝 swap(Task 1 Step 4),前端 swap 走已有 swap 端点(Task 3)—— 双保险,先卖后买守卫不被绕过。
- **留白**:Task 3 的 `data`/`refetch`/`adminFetch`/`getApiErrorMessage` 是占位,实施 subagent 必须读 FundsOrderDetail.tsx 现状对齐真实名字 —— 已在步骤里明确标注(有意,因为不读现有页面无法给准确变量名)。
