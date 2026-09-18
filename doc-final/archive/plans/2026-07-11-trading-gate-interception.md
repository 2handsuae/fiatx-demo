# 交易起始前置门 iteration 2（onboarding 式大拦截）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把法币地址门从 4 处逐动作弹窗，收敛为路由级大拦截（无 active 法币地址的已认证客户 → 重定向 /withdrawal-addresses 引导页）；补 crypto 提现地址后端门；swap 预检 CTA 改跳 /deposit。

**Architecture:** 前端 `AuthGuard` 的 approved 分支加 readiness 级（读 `useTradingReadiness`），业务路径 `/deposit /swap /withdraw /wallet` 未就绪 → `<Navigate to="/withdrawal-addresses">`；删 `TradingGateModal` 及 4 处 wiring；`WithdrawalAddresses` 加首次引导态 + crypto 入口门；后端 `registerAddress`(crypto) 加就绪硬门。后端硬门全保留。

**Tech Stack:** React + Vite（client-web，preview 渲染验证）；NestJS + Jest（后端 `registerAddress` 门用 `*-workflow.service.spec.ts`）。

**设计来源：** [`../specs/2026-07-11-trading-gate-interception-design.md`](../specs/2026-07-11-trading-gate-interception-design.md)（E1–E5）。

**执行前置：** 本工作树 self 栈已可 `bash scripts/stack.sh up self`（backend 3130 / client 3132）；preview 验证在 client 3132（后端 CORS 只放行该源）。demo 客户密码 `123456`；`demo_bob@example.com` = 未就绪、`demo_alice@example.com` = 已就绪。

---

## File Structure
- **后端**：`src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-workflow.service.ts`（`registerAddress` 加就绪门）
- **前端**：
  - `client-web/src/components/AuthGuard.tsx`（加 readiness 级）
  - `client-web/src/pages/WithdrawalAddresses.tsx`（首次引导态 + crypto 入口门）
  - `client-web/src/pages/{Deposit,Withdraw,Swap,WalletManagement}.tsx`（删 `TradingGateModal` wiring）
  - `client-web/src/pages/Swap.tsx`（CTA 路由 /wallet→/deposit）
  - **删** `client-web/src/components/TradingGateModal.tsx`
  - 保留 `client-web/src/hooks/useTradingReadiness.ts`

---

## Task 1（后端）: crypto 提现地址登记加就绪门

**Files:**
- Modify: `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-workflow.service.ts → registerAddress()`
- Test: `withdrawal-address-workflow.service.spec.ts`

`registerAddress`（crypto）现只校验 `onboardingStatus==='APPROVED'`。在该校验之后、建址之前，加"须已有 active 法币地址"硬门。用已注入的 `this.addressService.hasActiveFiatWithdrawalAddress`（Task 1/iteration1 的方法），**不新注入 OnboardingService**。`registerBankAccount`(fiat) 不动（引导起点）。

- [ ] **Step 1: 写失败测试**
```ts
it('registerAddress (crypto) rejects when no active fiat withdrawal address', async () => {
  // customer onboarding APPROVED + adminStatus ACTIVE + asset ACTIVE CRYPTO 都 mock 过
  jest.spyOn(addressService, 'hasActiveFiatWithdrawalAddress').mockResolvedValue(false);
  await expect(workflow.registerAddress(cryptoDto, 'cust-1', 'CU1'))
    .rejects.toMatchObject({ response: { code: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS' } });
  expect(addressService.create).not.toHaveBeenCalled();
});
it('registerAddress (crypto) proceeds when has active fiat address', async () => {
  jest.spyOn(addressService, 'hasActiveFiatWithdrawalAddress').mockResolvedValue(true);
  await expect(workflow.registerAddress(cryptoDto, 'cust-1', 'CU1')).resolves.toBeDefined();
});
```
- [ ] **Step 2: 跑测试确认失败** — `npm run test -- withdrawal-address-workflow.service.spec` → FAIL
- [ ] **Step 3: 实现** — 在 `registerAddress` 现有 onboarding/adminStatus/asset 校验之后、`this.trAdapter.attributeAddress`/`addressService.create` 之前：
```ts
if (!(await this.addressService.hasActiveFiatWithdrawalAddress(customerId))) {
  throw new ForbiddenException({
    code: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS',
    message: '需要先创建并激活一个法币提现地址才能登记提现地址',
  });
}
```
（`ForbiddenException` 已在文件 import；`hasActiveFiatWithdrawalAddress` 已在 `WithdrawalAddressService`。）
- [ ] **Step 4: 跑测试确认通过** + `npm run build` → exit 0
- [ ] **Step 5: 提交** — `git commit -am "feat(withdrawal-address): gate crypto address registration on active fiat address"`

---

## Task 2（前端）: AuthGuard 加 readiness 路由门

**Files:**
- Modify: `client-web/src/components/AuthGuard.tsx`

在 `AuthGuard` 顶部（与其它 hooks 同级，React 规则要求无条件调用）加 `useTradingReadiness`；在 `isApproved` 分支内、FROZEN/RESTRICTED 子门之后、最终 `return <>{children}</>` 之前，加 readiness 重定向。

- [ ] **Step 1: 实现**
在文件顶部 import：
```tsx
import { useTradingReadiness } from '../hooks/useTradingReadiness';
```
在组件内（`const location = useLocation();` 附近）：
```tsx
const { tradingReady, loading: tradingReadinessLoading } = useTradingReadiness();
```
在 `if (isApproved) { ... }` 块内，RESTRICTED 判断之后、`return <>{children}</>;` 之前插入：
```tsx
// Trading-readiness gate: approved but no active fiat withdrawal address → guide to add one.
// Business paths blocked; /withdrawal-addresses (the destination) intentionally NOT blocked (no redirect loop).
const readinessBlockedPaths = ['/deposit', '/withdraw', '/swap', '/wallet'];
if (
  !tradingReadinessLoading &&
  !tradingReady &&
  readinessBlockedPaths.some((p) => location.pathname.startsWith(p))
) {
  return <Navigate to="/withdrawal-addresses" replace />;
}
```
> ⚠ `readinessBlockedPaths` 用 `/wallet`（拦 WalletManagement 建收款账户），不是 onboarding 门那套 `/wallet/send`。`/withdrawal-addresses` 不在此列（避免死循环）。loading 时不拦（`!tradingReadinessLoading`）。
- [ ] **Step 2: 编译验证** — `cd client-web && npm run build` → exit 0。粘贴输出。
- [ ] **Step 3: 提交** — `git commit -am "feat(client): route-level trading-readiness gate in AuthGuard"`

---

## Task 3（前端）: WithdrawalAddresses 首次引导态 + crypto 入口门

**Files:**
- Modify: `client-web/src/pages/WithdrawalAddresses.tsx`

- [ ] **Step 1: 实现**
  - 用 `useTradingReadiness()` 拿 `tradingReady`（= 是否已有 active 法币地址）。
  - 无地址时（`!tradingReady`）页顶显示引导态卡片（用页面现有设计 token / 组件）：文案「先添加一个法币提现地址，才能开始充值 / 兑换 / 提现」+ 高亮"添加银行账户"入口。
  - **crypto 提现地址添加入口**：`!tradingReady` 时禁用该按钮 + 悬浮/说明"请先添加法币提现地址"。（后端 Task 1 已硬门兜底。）
  - 加成功法币地址后（页面本就 refetch 列表），`useTradingReadiness` 需要 refetch 让引导态消失——调用 hook 返回的 `refetch()`（Task 10 的 hook 已提供），或在成功回调后触发。
- [ ] **Step 2: 编译验证** — `cd client-web && npm run build` → exit 0。
- [ ] **Step 3: 提交** — `git commit -am "feat(client): first-run guided state + crypto-gate on withdrawal addresses page"`

---

## Task 4（前端）: 删 TradingGateModal 及 4 处 wiring

**Files:**
- Modify: `client-web/src/pages/{Deposit,Withdraw,Swap,WalletManagement}.tsx`（移除 `TradingGateModal` import + state `showTradingGate`/`setShowTradingGate` + handler 里的 `if(!tradingReady){setShowTradingGate(true);return;}` guard + JSX 里的 `<TradingGateModal .../>`）
- Delete: `client-web/src/components/TradingGateModal.tsx`

- [ ] **Step 1: 实现** — 逐页移除 iteration 1 Task 11 加的 4 处 wiring（每页约 10 行，删干净：import / useTradingReadiness（若仅为 modal 用则删；若页面别处还用则留）/ state / handler guard / JSX modal）。Swap 页保留 `useTradingReadiness`？—— Swap 的逐币预检不依赖它，但 Task 5 的 CTA 不需要；若 Swap 页 `useTradingReadiness` 仅为 modal，则删。删 `TradingGateModal.tsx`。
  > 注意：readiness 门现由 AuthGuard 统一负责（Task 2），这些页面级 modal 已冗余。
- [ ] **Step 2: 编译验证** — `cd client-web && npm run build` → exit 0（确认无残留 import/未用变量报错）。
- [ ] **Step 3: 提交** — `git commit -am "refactor(client): remove per-action TradingGateModal (superseded by route gate)"`

---

## Task 5（前端）: Swap 预检 CTA 改跳 /deposit

**Files:**
- Modify: `client-web/src/pages/Swap.tsx`（`navigate('/wallet')` → `navigate('/deposit')`，R4 逐币预检其余不动）

- [ ] **Step 1: 实现** — 把兑换预检提示里的 `onClick={() => navigate('/wallet')}` 改为 `navigate('/deposit')`。
- [ ] **Step 2: 编译验证** — `cd client-web && npm run build` → exit 0。
- [ ] **Step 3: 提交** — `git commit -am "fix(client): swap receiving-account CTA routes to /deposit"`

---

## 收尾验证（全 Task 后，controller 做）
- [ ] `npm run build`（后端）+ `cd client-web && npm run build`（前端）全绿
- [ ] `npm run test -- withdrawal-address-workflow.service.spec` 绿（Task 1 门）
- [ ] **preview 亲验**（self 栈 client 3132）：
  - demo_bob（未就绪）访问 /deposit /swap /withdraw /wallet → 全部重定向到 /withdrawal-addresses 引导页（不再逐动作弹窗）
  - /withdrawal-addresses 显示引导态；crypto 添加入口禁用；加一个法币银行账户（AED，即 ACTIVE）→ 业务路径放行
  - demo_alice（已就绪）Swap 选无收款账户的币 → 预检提示 CTA 跳 /deposit
- [ ] truth 同步：`v5-withdraw.md` / `v3-financial-config.md`（crypto 地址门 + 前端门形态）；`frontend-client.md` 若需
- [ ] `finishing-a-development-branch`
