# FundsOrder 模拟操作补回 — 设计规格

**Date**: 2026-07-02
**Author**: brainstorming with owner
**Status**: Design approved, ready for planning
**Base**: `main` at `70d642f`(funds_orders Round 2 已合)
**Context**: Round 2 的 C6 把 payin/payout/internal-fund 三个后台详情页合并成统一的 `FundsOrderDetail`,但**漏掉了旧页面上的"模拟操作"按钮**(⚡ 手动驱动状态机,演示/开发用)。本 spec 把它补回来,适配新的事件驱动状态机。

---

## §1 背景 — 丢了什么

旧三个详情页(PayinDetail / PayoutDetail / InternalFundDetailPage)都有一套"⚡ 模拟操作"面板:
- 全局 `useSimulationMode()` 开关控制显隐(off 默认;演示时打开)
- 按当前 status + asset 类型,显示可用的状态机动作按钮
- 点击 → POST 到后端(旧 `PATCH /treasury/payins/:id/status` 等,已在 C3/C5b 删除)→ 推进状态

C6 的新 `FundsOrderDetail` 只做了查看(list + detail),模拟按钮 + 后端端点全没了。**运营/演示无法再从后台手动把一笔资金单走完生命周期**。本 spec 补回。

---

## §2 核心决策(brainstorm 已定)

| # | 决策 |
|---|---|
| 动作粒度 | 模拟按钮 = **注入外部事件**集,不给 CLEAR 按钮。点 CONFIRM 后 workflow 自动 CLEAR + 级联推父单(事件驱动语义,取代旧的逐步离散跳转) |
| 动作集 | SUBMIT / OBSERVE_CONFIRMING(仅 crypto)/ CONFIRM / FAIL / TIMEOUT |
| 按钮文案 | crypto/fiat **分开措辞**(贴合真实语义) |
| swap 路由 | swap 腿的推进走**已有的** `POST /admin/swap-transactions/:swapNo/legs/:legSeq/advance`(带先卖后买守卫);deposit/withdraw 走**新增**的 funds-orders advance 端点 |
| 开关 | 复用现有全局 `useSimulationMode()`(off 时整个面板不显示) |
| 破坏性动作 | FAIL / TIMEOUT 点击弹二次确认;SUBMIT/OBSERVE_CONFIRMING/CONFIRM 直接执行 |

---

## §3 后端 — advance 端点

### 新增 `POST /admin/funds-orders/:fundsOrderNo/advance`

加在现有 `FundsOrdersAdminController`(`src/modules/funds-orders/funds-orders.admin.controller.ts`)。

```typescript
@Post(':fundsOrderNo/advance')
@ApiOperation({ summary: 'Advance a funds order (simulation/ops)' })
@RequirePermissions(buildPermissionCode('POST', '/admin/funds-orders/:fundsOrderNo/advance'))
@UsePipes(new ValidationPipe({ transform: true }))
advance(
  @Param('fundsOrderNo') fundsOrderNo: string,
  @Body() dto: AdvanceFundsOrderDto,   // { action: FundsOrderAction }
) {
  return this.fundsOrders.advanceByNo(fundsOrderNo, dto.action, 'ADMIN');
}
```

### FundsOrderService 加 `advanceByNo(fundsOrderNo, action, operator)`

- 按 `fundsOrderNo` 查到 funds_order(拿到 id + 父 FK + asset.type + status)
- **swap 腿守卫**:若 `swapTransactionId` 非空 → 抛 `BadRequestException('swap legs advance via /admin/swap-transactions/:swapNo/legs/:legSeq/advance')`(前端不会走到这里,但后端兜底,防止绕过先卖后买守卫)
- deposit/withdraw → 调现有 `advance(id, action, operator)`(它已含转移表校验:非法转移抛 400;终态抛 400)
- 返回更新后的 funds_order

> `advance()` 内部已 emit `funds_order.status.changed`,对应 workflow handler 自动级联(deposit 推合规门 / withdraw 推 SUCCESS+解锁 / — swap 不走这条)。

### Audit

`advanceByNo` 是 operator 可见操作 → 写审计。按项目规矩 audit 归 controller/workflow 层(不在 domain service)。在 controller 的 advance 里,advance 成功后 `auditLogsService.recordByActor({ action: 'FUNDS_ORDER_ADVANCED', entityType: 'INTERNAL_FUND'(复用), entityId, workflowType, metadata: { fundsOrderNo, action, fromStatus, toStatus }, actorNo: 'ADMIN' })`。新增 audit action 常量 `FUNDS_ORDER_ADVANCED`。

### DTO

`src/modules/funds-orders/dto/advance-funds-order.dto.ts`:
```typescript
export class AdvanceFundsOrderDto {
  @IsEnum(FundsOrderAction)
  action!: FundsOrderAction;
}
```

### RBAC

`rbac.catalog.ts` 加 `route('POST', '/admin/funds-orders/:fundsOrderNo/advance', 'Advance funds order (sim/ops)', ['INTERNAL_FUND_WRITE'])`(或复用现有 funds bucket)。加后 `db:base:sync` + 重启后端(SUPER_ADMIN 走内存 RBAC)。

---

## §4 前端 — 模拟操作面板

### 新建 `admin-web/src/utils/fundsOrderSimActionMap.ts`

```typescript
export interface FundsOrderSimAction {
  action: 'SUBMIT' | 'OBSERVE_CONFIRMING' | 'CONFIRM' | 'FAIL' | 'TIMEOUT';
  labelZh: string;
  labelEn: string;
  destructive: boolean;    // FAIL/TIMEOUT = true → 二次确认
  enabledStatuses: Set<string>;
}

// crypto: CREATED→SUBMIT→(OBSERVE_CONFIRMING)→CONFIRM; fiat: CREATED→SUBMIT→CONFIRM
// 文案 crypto/fiat 分开
export function getFundsOrderSimActions(status: string, assetType: 'CRYPTO' | 'FIAT'):
  Array<FundsOrderSimAction & { enabled: boolean }>;
```

动作可用矩阵(转移表驱动,和 `funds-order-transitions.constant.ts` 对齐):

| status | crypto 亮 | fiat 亮 |
|---|---|---|
| CREATED | 广播/Broadcast、失败/Fail | 提交银行/Submit、失败/Fail |
| SUBMITTED | 链上可见/Seen in Mempool、失败、超时/Timeout | 银行到账/Settle、失败、超时 |
| CONFIRMING(仅 crypto) | 确认到账/Confirm、失败、超时 | — |
| CONFIRMED | (无 — workflow 自动 CLEAR) | (无) |
| CLEARED/FAILED/TIMEOUT | 终态,无按钮 | 终态,无按钮 |

文案表:

| action | crypto zh/en | fiat zh/en |
|---|---|---|
| SUBMIT | ⚡ 广播 / Broadcast | ⚡ 提交银行 / Submit |
| OBSERVE_CONFIRMING | ⚡ 链上可见 / Seen in Mempool | (fiat 无) |
| CONFIRM | ⚡ 确认到账 / Confirm | ⚡ 银行到账 / Settle |
| FAIL | ⚡ 失败 / Fail | ⚡ 失败 / Fail |
| TIMEOUT | ⚡ 超时 / Timeout | ⚡ 超时 / Timeout |

### `FundsOrderDetail.tsx` 加面板

- 顶部读 `useSimulationMode()`;off 则不渲染面板。
- **两种目标端点 + 两种 action 词表**(sim action map 按父类型产出正确的 `action` 值):
  - **deposit/withdraw**:POST `/admin/funds-orders/:fundsOrderNo/advance`,body `{ action }` = **`FundsOrderAction`**(SUBMIT/OBSERVE_CONFIRMING/CONFIRM/FAIL/TIMEOUT)。
  - **swap 腿**(`swapTransactionId` 非空):POST `/admin/swap-transactions/:swapNo/legs/:legSeq/advance`,body `{ action }` = **`InternalFundAction`**(swap 控制器现有契约)。映射固定:显示"广播"→ 送 `SIGN`(swap 的 `mapLegAction` 把 SIGN 收敛成 SUBMIT);"链上可见"→ `SEEN_IN_MEMPOOL`;"确认到账"→ `CONFIRM`;"失败"→ `FAIL`;"超时"→ `TIMEOUT`。实施时读 `swap-workflow.service.ts` 的 `mapLegAction` 确认这几个 InternalFundAction 都被接受。
  - > 为什么不统一:swap advanceLeg 带"先卖后买"守卫且吃旧枚举,给它套新端点/新词表会破坏守卫或引 FundsOrderService→SwapWorkflow 循环依赖。sim map 多产出一个 action 值(按 crypto/fiat/swap 分支)成本更低。
- destructive(FAIL/TIMEOUT)点击 → `window.confirm` 二次确认再发。
- 成功后 refetch 详情(状态 + statusHistory 更新)。失败 alert 后端 error message。

---

## §5 验证

- **后端单测**(`funds-orders.admin.controller.spec` 或 service spec):
  - deposit/withdraw funds_order 合法转移 → advance 成功
  - 非法转移 → 400
  - swap 腿调 funds-orders advance → 400(引导走 swap 端点)
- **业务不断**:`demo:all` 8/8 + `verify:coa` PASS 不回归
- **UI 渲染 + 截图**(声称完成前必须):
  - 打开 simulation mode
  - crypto payin 详情(SUBMITTED)→ 亮"链上可见/确认",点"链上可见"→ 状态推进到 CONFIRMING
  - fiat payout 详情(CREATED)→ 亮"提交银行",点 → SUBMITTED
  - simulation mode off → 面板消失

---

## §6 范围

**In**:后端 advance 端点 + FundsOrderService.advanceByNo + audit + RBAC;前端 sim action map + FundsOrderDetail 面板;swap 走已有端点。

**Out**:
- 不动 swap 的 advanceLeg / resume(已有,复用)
- 不做 RETURNED(spec §8 defer,fiat 退票)
- 不改状态机 / 转移表(已定)
- 不动 reconciliation(禁区)

**硬闸**:demo:all 8/8 + verify:coa PASS + tsc 0 + admin build + 渲染截图。
