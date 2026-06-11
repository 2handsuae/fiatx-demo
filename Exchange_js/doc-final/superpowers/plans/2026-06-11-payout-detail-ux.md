# Payout 详情 UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec `doc-final/superpowers/specs/2026-06-11-payout-detail-ux-design.md` 落地:REORG 转换、删手动 Clear、fiat CLEARED Return 解禁、from 字段快照+兜底、左侧重排、sidebar 客户化。

**Architecture:** 后端 payouts.service(转换表+创建快照+detail enrich,TDD);前端 payoutActionMap(按轨道终态集+按钮表)+ PayoutDetail 重排 + 共享 explorer util(PayinDetail 同步去重)。

**Tech Stack:** NestJS+Prisma、React+Vite。`npx jest <file>`;`cd admin-web && npx tsc --noEmit`。分支 `branch`,只 commit 不 push。

**已钉事实:** 转换表 payouts.service.ts:12-51(CRYPTO/FIAT_TRANSITIONS);enums dto/payout.dto.ts:4-41;create 在 payouts.service.ts:270-313(dto 无 from 字段);CLEAR 自动调用方 withdraw-workflow.service.ts:551;前端动作表 payoutActionMap.ts:29-62(PAYOUT_TERMINAL 单一集合=bug 根源);页面 PayoutDetail.tsx(Hero 160-202、Chain Details 205-243、Linked Withdraw 246-263、Status History 267、Technical 271-283、sidebar Identity 312/Lifecycle 346);payin 的 explorerTxUrl 在 PayinDetail.tsx 头部(本轮抽共享);C_OUT=crypto 出站钱包、客户 C_VIBAN=fiat 出资(resolveCustomer 同款查询:walletRole+assetId+ownerType CUSTOMER+ownerId+ACTIVE)。

---

### Task 1: 后端 — REORG + from 快照 + detail enrich(TDD)

**Files:**
- Modify: `src/modules/asset-treasury/payouts/dto/payout.dto.ts`(PayoutAction/AdminPayoutAction 各加 `REORG = 'REORG'`)
- Modify: `src/modules/asset-treasury/payouts/payouts.service.ts`
- Test: `src/modules/asset-treasury/payouts/payouts.service.spec.ts`(先 Read 现 mock 结构)

- [x] **Step 1: 失败测试**(断言语义,按现 spec 风格落地)

```typescript
    it('crypto CONFIRMING + REORG → BROADCASTED(浅重组)', async () => {
      // findOne mock: { status: 'CONFIRMING', type: 'CRYPTO', statusHistory: null }
      // updateStatus(id, PayoutAction.REORG) → payout.update data.status === 'BROADCASTED'
    });
    it('create 快照 crypto fromAddress = C_OUT 钱包地址', async () => {
      // wallet.findFirst mock({ walletRole:'C_OUT', assetId, ownerType:'PLATFORM', status:'ACTIVE' })
      //   → { address: 'Txyz' };payout.create data.fromAddress === 'Txyz'
    });
    it('create 快照 fiat fromIban = 客户 C_VIBAN iban', async () => {
      // wallet.findFirst mock({ walletRole:'C_VIBAN', assetId, ownerType:'CUSTOMER', ownerId, status:'ACTIVE' })
      //   → { iban: 'AE07...' };payout.create data.fromIban === 'AE07...'
    });
    it('detail 对存量 null from 字段现场解析兜底(不回写)', async () => {
      // findOne 返回 fromIban:null 的 fiat 单 → 响应 fromIban 来自钱包解析;payout.update 未被调用
    });
```

- [x] **Step 2: 跑红** `npx jest src/modules/asset-treasury/payouts/payouts.service.spec.ts` → FAIL

- [x] **Step 3: 实现**

(a) 转换表:`CRYPTO_TRANSITIONS[PayoutStatus.CONFIRMING]` 加 `[PayoutAction.REORG]: PayoutStatus.BROADCASTED,`。
(b) 私有解析器(service 内,创建与 detail 共用):

```typescript
  /** 出资钱包解析:crypto=C_OUT(平台出站热钱包);fiat=客户 C_VIBAN(CMA 不对外转账)。 */
  private async resolveSourceWallet(
    type: string,
    assetId: string,
    ownerId: string | null,
  ): Promise<{ fromAddress: string | null; fromIban: string | null }> {
    if (String(type).toUpperCase() === 'FIAT') {
      if (!ownerId) return { fromAddress: null, fromIban: null };
      const viban = await (this.prisma as any).wallet.findFirst({
        where: { walletRole: 'C_VIBAN', assetId, ownerType: 'CUSTOMER', ownerId, status: 'ACTIVE' },
        select: { iban: true },
      });
      return { fromAddress: null, fromIban: viban?.iban ?? null };
    }
    const out = await (this.prisma as any).wallet.findFirst({
      where: { walletRole: 'C_OUT', assetId, ownerType: 'PLATFORM', status: 'ACTIVE' },
      select: { address: true },
    });
    return { fromAddress: out?.address ?? null, fromIban: null };
  }
```

(c) create:取 `withdraw.ownerId` 后调用解析器,`payout.create data` 加 `fromAddress/fromIban`(解析失败不阻断,null+`this.logger.warn`)。
(d) detail 读取方法(admin 详情用的 findOne/getByNo,Read 找实名):返回前若 `fromAddress`/`fromIban` 均空,调解析器**只填响应**,不 update。
(e) detail 响应 enrich `customerName`:include/查询 customer(firstName/lastName join,模式同本周各页);响应带 `ownerId`(跳转用,若已有则确认)。

- [x] **Step 4: 跑绿** 同文件 + `npx jest src/modules/asset-treasury` + `npm run build` 零错
- [x] **Step 5: Commit** `git add -A && git commit -m "feat(payouts): shallow-reorg transition, source-wallet snapshot (C_OUT / customer vIBAN), detail enrich"`

---

### Task 2: 前端 — 动作表 + 详情页重排 + 共享 explorer util

**Files:**
- Create: `admin-web/src/utils/explorer.ts`
- Modify: `admin-web/src/utils/payoutActionMap.ts:29-62`
- Modify: `admin-web/src/pages/PayoutDetail.tsx`(先 Read 全文)
- Modify: `admin-web/src/pages/PayinDetail.tsx`(删本地 explorerTxUrl,改 import)

- [x] **Step 1: explorer util**

```typescript
/** Block-explorer tx link by network — TRON/ETHEREUM supported, others get no link. */
export const explorerTxUrl = (network: string | null | undefined, hash: string): string | undefined => {
  switch ((network || '').toUpperCase()) {
    case 'TRON':
      return `https://tronscan.org/#/transaction/${hash}`;
    case 'ETHEREUM':
      return `https://etherscan.io/tx/${hash}`;
    default:
      return undefined;
  }
};
```
PayinDetail.tsx:删本地定义,`import { explorerTxUrl } from '../utils/explorer';`。

- [x] **Step 2: payoutActionMap**

```typescript
const CRYPTO_SIM_ACTIONS: PayoutSimAction[] = [
  { action: 'SIGN',            label: '⚡ Sign',                         enabledStatuses: new Set(['CREATED']) },
  { action: 'BROADCAST',       label: '⚡ Broadcast',                    enabledStatuses: new Set(['SIGNING']) },
  { action: 'SIGN_FAIL',       label: '⚡ Sign Fail',                    enabledStatuses: new Set(['SIGNING']) },
  { action: 'SEEN_IN_MEMPOOL', label: '⚡ Seen in Mempool',              enabledStatuses: new Set(['BROADCASTED']) },
  { action: 'DROP',            label: '⚡ Drop',                         enabledStatuses: new Set(['BROADCASTED']) },
  { action: 'TIMEOUT',         label: '⚡ Timeout',                      enabledStatuses: new Set(['BROADCASTED', 'CONFIRMING']) },
  { action: 'CONFIRM',         label: '⚡ Confirm',                      enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'FAIL',            label: '⚡ Fail',                         enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'REORG',           label: '⚡ Reorg — back to broadcasted',  enabledStatuses: new Set(['CONFIRMING']) },
];

const FIAT_SIM_ACTIONS: PayoutSimAction[] = [
  { action: 'SUBMIT',  label: '⚡ Submit',                enabledStatuses: new Set(['CREATED']) },
  { action: 'CONFIRM', label: '⚡ Confirm',               enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'FAIL',    label: '⚡ Fail',                  enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'TIMEOUT', label: '⚡ Timeout',               enabledStatuses: new Set(['CONFIRMING']) },
  { action: 'RETURN',  label: '⚡ Return (bank recall)',  enabledStatuses: new Set(['CONFIRMED', 'CLEARED']) },
];

const CRYPTO_TERMINAL = new Set(['CLEARED', 'FAILED', 'TIMEOUT', 'RETURNED']);
const FIAT_TERMINAL = new Set(['FAILED', 'TIMEOUT', 'RETURNED']); // fiat CLEARED 留有 Return 出口

export function getPayoutSimActionsForStatus(
  currentStatus: string,
  type: string,
): Array<PayoutSimAction & { enabled: boolean }> {
  const isFiat = type.toUpperCase() === 'FIAT';
  const terminal = isFiat ? FIAT_TERMINAL : CRYPTO_TERMINAL;
  const actions = isFiat ? FIAT_SIM_ACTIONS : CRYPTO_SIM_ACTIONS;
  const isTerminal = terminal.has(currentStatus.toUpperCase());
  return actions.map((a) => ({
    ...a,
    enabled: !isTerminal && a.enabledStatuses.has(currentStatus.toUpperCase()),
  }));
}
```
(CLEAR 按钮删除——自动流转。)

- [x] **Step 3: PayoutDetail 重排**(对照 payin 这轮的成品 PayinDetail.tsx 同构改)
1. Chain Details → 仅 `data.asset.type !== 'FIAT'` 渲染:Tx Hash(`explorerTxUrl(data.asset.network, hash)`)、Confirmations、From/To Address、Provider Txn ID(有值才显);
2. 新增 Bank Transfer → 仅 fiat:From IBAN / To IBAN / Reference No / Provider Txn ID;
3. Linked Withdraw 收进 `<DetailCard title="Linked Withdraw" columns={1}>`;
4. 删 Technical 段 + JsonBlock import;
5. Sim 面板:外层条件改 `simulationModeEnabled`,无可用动作时文案——终态(按轨道终态集判断,直接用 `simActions.every(a => !a.enabled)` + 状态∈terminal 集;为避免重复定义,从 payoutActionMap 导出 `isPayoutSimTerminal(status, type)` 帮助函数)→ `Terminal state — no simulatable events`;非终态(CONFIRMED)→ `Auto-clearing via withdraw workflow…`;
6. sidebar Identity:Owner 行改 **Customer No**(`data.ownerId` 存在时可点击 `navigate(\`/dashboard/customer/${data.ownerId}\`)`,显示值用接口的 ownerNo/customerNo 字段,Read 确认实名)+ **Customer Name**(`data.customerName ?? '—'`,接口已 enrich);
7. Lifecycle:确认含 Created/Sent/Completed(completedAt),缺则补 SidebarKV。
(数据接口类型补 `customerName?: string | null;` 等新字段。)

- [x] **Step 4: 验证** `cd admin-web && npx tsc --noEmit` 0 错;`curl …/PayoutDetail.tsx` 与 `…/PayinDetail.tsx` 均 200
- [x] **Step 5: Commit** `git add -A && git commit -m "feat(admin): payout detail — rail-split sections, reorg/return sim fixes, source wallet fields, customer sidebar"`

---

### Task 3: 终验

- [x] `npx jest`(0 failed)+ `npm run build` + admin tsc 全绿
- [x] 重启栈(后端有变更):`npm run dev:stop && npm run dev:start`,3500/3503 LISTEN
- [x] 手验:新建 fiat 提现→payout 详情 fromIban=客户 vIBAN;crypto 单 fromAddress=C_OUT;CONFIRMING 点 Reorg 回 BROADCASTED;fiat CLEARED 点 Return 成功(原 bug 修复);CONFIRMED 显自动文案;TRON 链接 tronscan
- [x] plan checkbox 全勾 + commit

## Self-Review 记录

- Spec §1→T1(a)/T2(Step2);§2→T1(b-d);§3→T2(Step1/3);§4→T1(e)/T2(Step3.6-7);§5→T3。
- 类型一致:`REORG`/`resolveSourceWallet`/`explorerTxUrl`/`customerName` 贯穿;`isPayoutSimTerminal` 在 T2 内定义并使用。
- 防回归:CLEAR 自动调用方(withdraw-workflow)走 `updateStatus(PayoutAction.CLEAR)` 不经过前端动作表,删按钮不影响自动链路。
