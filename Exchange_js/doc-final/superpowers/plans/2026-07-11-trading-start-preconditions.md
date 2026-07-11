# 交易起始前置门 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 客户开展任何业务（充值/提现/兑换）前必须有 ≥1 个 ACTIVE 法币提现地址；兑换两侧币种须有收款账户；补客户侧地址停用。

**Architecture:** 通用闸并入 `assertTradingEligibility`（充值/提现/兑换唯一咽喉，抽 `assertTradingReady` 共享给收款账户创建入口）；兑换逐币校验放兑换流专属闸；只读就绪接口驱动前端弹窗；前端 4 入口拦截 + 兑换窗预检。后端硬闸兜底，UI 拦截非唯一边界。

**Tech Stack:** NestJS + Prisma(SQLite) + Jest（后端 `*.spec.ts`）；React + Vite（client-web，前端用 preview 渲染验证）。

**设计来源：** [`../specs/2026-07-11-trading-start-preconditions-design.md`](../specs/2026-07-11-trading-start-preconditions-design.md)（7 决策 D1–D7）。

**执行前置：** 在本工作树 `feat/trading-start-preconditions` 内 `bash scripts/stack.sh up`（self 栈自动分端口），供 e2e/preview。

---

## File Structure（决策落点）

**后端（src/modules/）**
- `asset-treasury/withdrawal-addresses/withdrawal-address.service.ts` — 加 `hasActiveFiatWithdrawalAddress()`/`countActiveFiatAddresses()`；`createBankAccount` 首地址免冷却；`deactivate()` + 守卫
- `asset-treasury/withdrawal-addresses/withdrawal-address-workflow.service.ts` — `deactivateAddress()`（审计）
- `asset-treasury/withdrawal-addresses/withdrawal-address.controller.ts` — `POST :addressNo/deactivate`
- `identity/onboarding/onboarding.service.ts` — 抽 `assertTradingReady()` + 并入 `assertTradingEligibility`
- `asset-treasury/wallets/customer-deposit-wallet.service.ts` — `createOrReturn` 前置 `assertTradingReady`（依赖链②）
- `asset-treasury/wallets/wallet-query.service.ts` — 加 `hasReceivingAccount(customerId, assetId)`
- `trading/swap-transactions/swap-workflow.service.ts` — `executeSwap` 加两侧收款账户闸
- `trading/shared/trading-readiness.controller.ts` — **新建** `GET /me/trading-readiness` + `GET /me/receiving-accounts`
- `audit-logging/constants/audit-actions.constant.ts` — `WITHDRAWAL_ADDRESS_REGISTRATION.ADDRESS_DEACTIVATED`
- `prisma/schema.prisma` — `WithdrawalAddress` 加 `deactivatedAt`/`deactivatedBy`（migration）

**前端（client-web/src/）**
- `hooks/useTradingReadiness.ts` — **新建** 就绪查询
- `components/TradingGateModal.tsx` — **新建** 拦截弹窗
- `pages/{Deposit,Withdraw,Swap,WalletManagement}.tsx` — 接拦截
- `pages/Swap.tsx` — 兑换窗逐币预检
- `pages/WithdrawalAddresses.tsx` — 停用按钮

---

## Phase 1 — 后端：法币地址就绪判定 + 总闸

### Task 1: 法币地址就绪查询

**Files:**
- Modify: `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.service.ts`
- Test: `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
// withdrawal-address.service.spec.ts（新增/追加）
describe('hasActiveFiatWithdrawalAddress', () => {
  it('true when ≥1 ACTIVE bank address', async () => {
    prisma.withdrawalAddress.count = jest.fn().mockResolvedValue(1);
    await expect(service.hasActiveFiatWithdrawalAddress('cust-1')).resolves.toBe(true);
    expect(prisma.withdrawalAddress.count).toHaveBeenCalledWith({
      where: { customerId: 'cust-1', status: 'ACTIVE', addressType: 'BANK' },
    });
  });
  it('false when none', async () => {
    prisma.withdrawalAddress.count = jest.fn().mockResolvedValue(0);
    await expect(service.hasActiveFiatWithdrawalAddress('cust-1')).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm run test -- withdrawal-address.service.spec` → FAIL（方法未定义）

- [ ] **Step 3: 实现**

```ts
async hasActiveFiatWithdrawalAddress(customerId: string): Promise<boolean> {
  const n = await this.prisma.withdrawalAddress.count({
    where: { customerId, status: 'ACTIVE', addressType: 'BANK' },
  });
  return n > 0;
}
async countActiveFiatAddresses(customerId: string): Promise<number> {
  return this.prisma.withdrawalAddress.count({
    where: { customerId, status: 'ACTIVE', addressType: 'BANK' },
  });
}
```

- [ ] **Step 4: 跑测试确认通过** — 同命令 → PASS
- [ ] **Step 5: 提交** — `git commit -am "feat(withdrawal-address): active fiat address readiness query"`

### Task 2: `assertTradingReady` + 并入 `assertTradingEligibility`

**Files:**
- Modify: `src/modules/identity/onboarding/onboarding.service.ts:1342`（`assertTradingEligibility` 末尾）
- Test: `src/modules/identity/onboarding/onboarding.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe('assertTradingEligibility fiat-address gate', () => {
  it('throws NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS when none', async () => {
    // customer 三态全过（mock getCanonicalState → APPROVED/ACTIVE/CLEAR）
    withdrawalAddressService.hasActiveFiatWithdrawalAddress = jest.fn().mockResolvedValue(false);
    await expect(service.assertTradingEligibility('cust-1', 'SWAP'))
      .rejects.toMatchObject({ response: { code: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS' } });
  });
  it('passes when has active fiat address', async () => {
    withdrawalAddressService.hasActiveFiatWithdrawalAddress = jest.fn().mockResolvedValue(true);
    await expect(service.assertTradingEligibility('cust-1', 'SWAP')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm run test -- onboarding.service.spec` → FAIL

- [ ] **Step 3: 实现** — `onboarding.service.ts`，在 `assertTradingEligibility` 现有三态校验**之后**追加，并抽出可复用方法。注入 `WithdrawalAddressService`（构造函数）。

```ts
// 在 assertTradingEligibility 末尾（compliance 校验之后）：
await this.assertTradingReady(customerId);

// 新方法：
async assertTradingReady(customerId: string): Promise<void> {
  const ok = await this.withdrawalAddressService.hasActiveFiatWithdrawalAddress(customerId);
  if (!ok) {
    throw new ForbiddenException({
      code: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS',
      message: '需要先创建并激活一个法币提现地址才能开展业务',
      customerId,
    });
  }
}
```
> ⚠ 循环依赖：`OnboardingService ↔ WithdrawalAddressService` 若成环，用 `@Inject(forwardRef(...))` **禁止**（项目铁律）。改法：把 `hasActiveFiatWithdrawalAddress` 下沉到无依赖的 query 层，或让 onboarding 直接 `prisma.withdrawalAddress.count`（同 where）。执行时先 `npm run build` 验证无环；有环则内联 count。

> ⚠ **DEPOSIT 例外**（对齐 spec §6）：钱已进不可逆，充值不能在到账信号处硬拒。故 `assertTradingEligibility` 对 `action==='DEPOSIT'` **不调** `assertTradingReady`：`if (action !== 'DEPOSIT') await this.assertTradingReady(customerId);`。DEPOSIT 的就绪拦截由 ① 收款账户创建门（Task 3，无账户无法收款）+ ② 挂起待补（Task 4b）承担；WITHDRAW/SWAP 才硬抛。

- [ ] **Step 4: 跑测试确认通过** + `npm run build`（验证无循环依赖）
- [ ] **Step 5: 提交** — `git commit -am "feat(onboarding): gate all trading on active fiat withdrawal address"`

---

## Phase 2 — 后端：依赖链② + 首地址免冷却

### Task 3: 收款账户创建前置就绪（依赖链②）

**Files:**
- Modify: `src/modules/asset-treasury/wallets/customer-deposit-wallet.service.ts → createOrReturn()`（校验段，约 :44 之后）
- Test: `customer-deposit-wallet.service.spec.ts`

- [ ] **Step 1: 写失败测试** — 不就绪时 `createOrReturn` 抛 `NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS`。

```ts
it('rejects create when not trading-ready', async () => {
  onboardingService.assertTradingReady = jest.fn().mockRejectedValue(
    new ForbiddenException({ code: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS' }));
  await expect(service.createOrReturn('cust-1', 'asset-usdt'))
    .rejects.toMatchObject({ response: { code: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS' } });
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm run test -- customer-deposit-wallet.service.spec` → FAIL
- [ ] **Step 3: 实现** — 在 `createOrReturn` 现有 `onboarding/adminStatus/asset` 校验之后、建账户之前：

```ts
await this.onboardingService.assertTradingReady(customerId);
```
> 注入 `OnboardingService`（若成环，复用 Task 2 决定的内联 count 方案）。

- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 提交** — `git commit -am "feat(wallet): require active fiat address before creating C_DEP/C_VIBAN"`

### Task 4: 首个法币提现地址免冷却

**Files:**
- Modify: `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.service.ts → createBankAccount()`
- Test: `withdrawal-address.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe('createBankAccount first-address skip cooling', () => {
  it('first bank address → status ACTIVE (no cooling)', async () => {
    prisma.withdrawalAddress.count = jest.fn().mockResolvedValue(0); // 无既有 BANK 地址
    const created = await service.createBankAccount({ customerId: 'c1', /* ...bank fields... */ } as any);
    expect(created.status).toBe('ACTIVE');
  });
  it('second bank address → PENDING_ACTIVATION + activatesAt +24h', async () => {
    prisma.withdrawalAddress.count = jest.fn().mockResolvedValue(1);
    const created = await service.createBankAccount({ customerId: 'c1' } as any);
    expect(created.status).toBe('PENDING_ACTIVATION');
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm run test -- withdrawal-address.service.spec` → FAIL
- [ ] **Step 3: 实现** — `createBankAccount`：建库前判"是否首个法币地址"（count addressType=BANK, status∈{PENDING_ACTIVATION,ACTIVE}==0），事务内取计数防并发。

```ts
const existing = await tx.withdrawalAddress.count({
  where: { customerId: input.customerId, addressType: 'BANK',
           status: { in: ['PENDING_ACTIVATION', 'ACTIVE'] } },
});
const isFirst = existing === 0;
const status = isFirst ? 'ACTIVE' : 'PENDING_ACTIVATION';
const activatesAt = isFirst ? new Date() : new Date(Date.now() + COOLING_PERIOD_HOURS * 3600_000);
const activatedAt = isFirst ? new Date() : null;
// ...create with { status, activatesAt, activatedAt, addressType: 'BANK' }
```

- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 提交** — `git commit -am "feat(withdrawal-address): first fiat address auto-activates (skip cooling)"`

### Task 4b: 充值信号阶段不就绪 → 挂起待补（不硬拒，spec §6）

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts → checkAutoApproval()`
- Test: `deposit-workflow.service.spec.ts`

背景：充值到账信号触发时钱已进（不可逆）。正常客户建 C_DEP/C_VIBAN 已被 Task 3 挡（无收款账户无法收款）；仅当客户**曾就绪、后被 admin 停用其法币地址**时才命中此边界。此时不硬拒：让充值走到 `COMPLIANCE_PENDING`（Step1 已 `CLIENT_ASSET→DEPOSIT_SUSPENSE` 暂扣），但**不自动入账（Step2）**直到就绪。

- [ ] **Step 1: 写失败测试** — 不就绪时 `checkAutoApproval` 不推进到 SUCCESS，停在 COMPLIANCE_PENDING（不调 Step2 记账）。
- [ ] **Step 2: 跑测试确认失败** — `npm run test -- deposit-workflow.service.spec` → FAIL
- [ ] **Step 3: 实现** — `checkAutoApproval` 在 kyt/TR 收敛判断处并入就绪：

```ts
const ready = await this.withdrawalAddresses.hasActiveFiatWithdrawalAddress(deposit.ownerId);
if (!ready) return; // 留 COMPLIANCE_PENDING（DEPOSIT_SUSPENSE 暂扣），待补齐后重驱
```
> 补齐触发：法币地址激活事件（或客户端补齐后手动重驱）唤醒挂起充值——执行时接 `ADDRESS_ACTIVATED` 后扫该客户 COMPLIANCE_PENDING 充值重跑 `checkAutoApproval`；若工作量大，本期先留挂起 + admin 可见，重驱入 BACKLOG。

- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 提交** — `git commit -am "feat(deposit): hold in suspense when not trading-ready instead of crediting"`

---

## Phase 3 — 后端：客户侧停用

### Task 5: schema — DEACTIVATED 字段 + migration

**Files:**
- Modify: `prisma/schema.prisma`（`WithdrawalAddress`）
- Create: migration（`npx prisma migrate dev --name withdrawal_address_deactivate`）

- [ ] **Step 1: 加字段**

```prisma
deactivatedAt        DateTime?
deactivatedBy        String?
```

- [ ] **Step 2: 生成 migration + client** — `npx prisma migrate dev --name withdrawal_address_deactivate && npm run prisma:generate`
- [ ] **Step 3: 验证** — `npm run runtime:diagnose`（无漂移）
- [ ] **Step 4: 提交** — `git commit -am "feat(schema): withdrawal address deactivated fields"`

### Task 6: `deactivate()` + 守卫（末位法币 / 在途）

**Files:**
- Modify: `withdrawal-address.service.ts`
- Test: `withdrawal-address.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe('deactivate guards', () => {
  it('rejects deactivating last active fiat address', async () => {
    // 目标是 BANK/ACTIVE，且 countActiveFiat==1
    jest.spyOn(service, 'countActiveFiatAddresses').mockResolvedValue(1);
    await expect(service.deactivate('ADDR-fiat', 'c1'))
      .rejects.toMatchObject({ response: { code: 'LAST_ACTIVE_FIAT_ADDRESS' } });
  });
  it('rejects when in-flight withdrawal references address', async () => {
    prisma.fundsOrder.count = jest.fn().mockResolvedValue(1); // 非终态
    await expect(service.deactivate('ADDR-x', 'c1'))
      .rejects.toMatchObject({ response: { code: 'ADDRESS_HAS_INFLIGHT_WITHDRAWAL' } });
  });
  it('ACTIVE → DEACTIVATED on success', async () => {
    const r = await service.deactivate('ADDR-crypto', 'c1');
    expect(r.status).toBe('DEACTIVATED');
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — FAIL
- [ ] **Step 3: 实现**

```ts
async deactivate(addressNo: string, customerId: string) {
  const addr = await this.findByNo(addressNo);
  if (!addr || addr.customerId !== customerId) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND' });
  if (addr.status !== 'ACTIVE') throw new BadRequestException({ code: 'ADDRESS_NOT_ACTIVE' });
  // 守卫①：末位 active 法币地址
  if (addr.addressType === 'BANK' && (await this.countActiveFiatAddresses(customerId)) <= 1) {
    throw new BadRequestException({ code: 'LAST_ACTIVE_FIAT_ADDRESS',
      message: '这是最后一个可用法币提现地址，请先新增并激活一个再停用' });
  }
  // 守卫②：在途提现引用（funds_order 非终态，按 toIban/toAddress 关联）
  const inflight = await this.prisma.fundsOrder.count({
    where: { withdrawTransaction: { customerId }, status: { notIn: ['CLEARED','FAILED','TIMEOUT'] },
             OR: [{ toIban: addr.iban ?? undefined }, { toAddress: addr.address ?? undefined }] },
  });
  if (inflight > 0) throw new BadRequestException({ code: 'ADDRESS_HAS_INFLIGHT_WITHDRAWAL' });
  return this.prisma.withdrawalAddress.update({
    where: { id: addr.id },
    data: { status: 'DEACTIVATED', deactivatedAt: new Date(), deactivatedBy: 'CUSTOMER' },
  });
}
```
> 在途判定的确切关联键（funds_order → 提现地址）执行时按 `funds-order` 真实字段核对（`toIban`/`toAddress`）；若无直接列，改按 withdrawTransaction 的地址快照关联。

- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 提交** — `git commit -am "feat(withdrawal-address): customer deactivate with last-fiat + in-flight guards"`

### Task 7: workflow + 审计 + 端点

**Files:**
- Modify: `audit-actions.constant.ts`（`WITHDRAWAL_ADDRESS_REGISTRATION` 加 `ADDRESS_DEACTIVATED: 'ADDRESS_DEACTIVATED'`）
- Modify: `withdrawal-address-workflow.service.ts`（`deactivateAddress`）
- Modify: `withdrawal-address.controller.ts`（`POST :addressNo/deactivate`）
- Test: `withdrawal-address-workflow.service.spec.ts`

- [ ] **Step 1: 写失败测试** — `deactivateAddress` 调 service.deactivate 且写 `ADDRESS_DEACTIVATED` 审计（recordSystem, CLIENT_API, entityOwner=customer）。
- [ ] **Step 2: 跑测试确认失败** — FAIL
- [ ] **Step 3: 实现**（对齐现有 `cancelAddress` 写法）

```ts
// workflow
async deactivateAddress(addressNo: string, customerId: string, customerNo: string) {
  const existing = await this.addressService.findByNo(addressNo);
  if (!existing) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND' });
  const result = await this.addressService.deactivate(addressNo, customerId);
  await this.auditLogsService.recordSystem({
    action: AuditGovernanceActions.WITHDRAWAL_ADDRESS_REGISTRATION.ADDRESS_DEACTIVATED,
    entityType: AuditEntityTypes.WITHDRAWAL_ADDRESS, entityId: existing.id, entityNo: addressNo,
    workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_ADDRESS_REGISTRATION,
    traceId: existing.traceId, result: AuditResult.SUCCESS,
    metadata: { deactivatedByCustomerNo: customerNo }, sourcePlatform: 'CLIENT_API',
    entityOwnerId: customerId, entityOwnerNo: customerNo,
  });
  return result;
}
// controller
@Post(':addressNo/deactivate')
async deactivate(@Request() req: any, @Param('addressNo') addressNo: string) {
  const { customerId, customerNo } = this.extractCustomer(req);
  return this.workflowService.deactivateAddress(addressNo, customerId, customerNo);
}
```

- [ ] **Step 4: 跑测试确认通过** + `npm run build`
- [ ] **Step 5: 提交** — `git commit -am "feat(withdrawal-address): deactivate endpoint + audit"`

---

## Phase 4 — 后端：兑换逐币闸（R4）

### Task 8: 收款账户校验 + 并入 executeSwap

**Files:**
- Modify: `src/modules/asset-treasury/wallets/wallet-query.service.ts`（`hasReceivingAccount`）
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts → executeSwap()`（`:185` `assertTradingEligibility` 之后）
- Test: `swap-workflow.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('rejects swap when buy-side receiving account missing', async () => {
  walletQuery.hasReceivingAccount = jest.fn()
    .mockImplementation((_c, assetId) => Promise.resolve(assetId !== 'asset-aed')); // AED 缺
  await expect(service.executeSwap(/* quote buy=AED sell=USDT */))
    .rejects.toMatchObject({ response: { code: 'RECEIVING_ACCOUNT_REQUIRED', assetCode: 'AED' } });
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm run test -- swap-workflow.service.spec` → FAIL
- [ ] **Step 3: 实现**

```ts
// wallet-query.service.ts
async hasReceivingAccount(customerId: string, assetId: string): Promise<boolean> {
  const n = await this.prisma.wallet.count({
    where: { ownerType: 'CUSTOMER', ownerId: customerId, assetId,
             walletRole: { in: ['C_DEP', 'C_VIBAN'] }, status: 'ACTIVE' },
  });
  return n > 0;
}
// swap-workflow.service.ts executeSwap，assertTradingEligibility 之后：
for (const asset of [buyAsset, sellAsset]) {
  if (!(await this.walletQuery.hasReceivingAccount(ownerId, asset.id))) {
    throw new BadRequestException({ code: 'RECEIVING_ACCOUNT_REQUIRED',
      assetCode: asset.code, message: `请先为 ${asset.code} 创建收款账户再兑换` });
  }
}
```
> `buyAsset`/`sellAsset` 从已消费 quote 解析（执行时按 quote 真实字段取 fromAssetId/toAssetId）。

- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 提交** — `git commit -am "feat(swap): gate on both-side receiving accounts (C_DEP/C_VIBAN)"`

---

## Phase 5 — 后端：就绪只读接口

### Task 9: TradingReadinessController

**Files:**
- Create: `src/modules/trading/shared/trading-readiness.controller.ts`
- Modify: 对应 module（注册 controller）
- Test: `trading-readiness.controller.spec.ts`

- [ ] **Step 1: 写失败测试** — `GET /me/trading-readiness` 返回 `{ tradingReady, hasActiveFiatWithdrawalAddress }`；`GET /me/receiving-accounts?assets=USDT,AED` 返回逐币 `{ hasReceivingAccount }`。
- [ ] **Step 2: 跑测试确认失败** — FAIL
- [ ] **Step 3: 实现**（客户 JWT 守卫，同 `customer-withdraw.controller` 鉴权）

```ts
@Controller('me')
@UseGuards(CustomerJwtGuard)
export class TradingReadinessController {
  constructor(private readonly withdrawalAddresses: WithdrawalAddressService,
              private readonly walletQuery: WalletQueryService,
              private readonly assets: AssetsService) {}
  @Get('trading-readiness')
  async readiness(@Request() req: any) {
    const has = await this.withdrawalAddresses.hasActiveFiatWithdrawalAddress(req.user.userId);
    return { tradingReady: has, hasActiveFiatWithdrawalAddress: has };
  }
  @Get('receiving-accounts')
  async receiving(@Request() req: any, @Query('assets') assets: string) {
    const codes = (assets ?? '').split(',').filter(Boolean);
    const out: Record<string, { hasReceivingAccount: boolean }> = {};
    for (const code of codes) {
      const asset = await this.assets.findByCode(code);
      out[code] = { hasReceivingAccount: asset
        ? await this.walletQuery.hasReceivingAccount(req.user.userId, asset.id) : false };
    }
    return out;
  }
}
```

- [ ] **Step 4: 跑测试确认通过** + `npm run build`
- [ ] **Step 5: 提交** — `git commit -am "feat(trading): read-only trading-readiness + receiving-accounts endpoints"`

---

## Phase 6 — 前端（client-web，preview 渲染验证）

> 前端无单测框架惯例 → 用 preview 渲染 + 截图验证（项目铁律：UI 一致性靠渲染截图）。每 Task 末 `git commit`。

### Task 10: 就绪 hook + 拦截弹窗

**Files:**
- Create: `client-web/src/hooks/useTradingReadiness.ts`（`customerFetch('/me/trading-readiness')`，返回 `{ tradingReady, loading }`）
- Create: `client-web/src/components/TradingGateModal.tsx`（受阻引导风格：文案「需先创建法币提现地址」+ CTA 跳 `/withdrawal-addresses`）

- [ ] Step 1: 写 hook（`customerFetch` 等价 helper，禁裸 fetch）
- [ ] Step 2: 写 Modal（`framer-motion` 轻量，非唯一权限边界）
- [ ] Step 3: 提交 — `git commit -am "feat(client): trading readiness hook + gate modal"`

### Task 11: 4 入口接拦截

**Files:** Modify `pages/{Deposit,Withdraw,Swap,WalletManagement}.tsx`

- [ ] Step 1: 各页入口 `useTradingReadiness()`；`!tradingReady` → 渲染 `TradingGateModal` 拦截主操作（Deposit 在"查看/生成收款地址"前；WalletManagement 在"创建 C_DEP/C_VIBAN"前）
- [ ] Step 2: preview 验证 — `preview_start` → 种子登录 → 无法币地址客户访问 4 页 → 截图确认弹窗拦截；补一个 active 法币地址后 → 放行
- [ ] Step 3: 提交 — `git commit -am "feat(client): gate deposit/withdraw/swap/wallet on trading readiness"`

### Task 12: 兑换窗逐币预检

**Files:** Modify `pages/Swap.tsx`

- [ ] Step 1: 选定买/卖币种后 `customerFetch('/me/receiving-accounts?assets=<buy>,<sell>')`；任一 `hasReceivingAccount=false` → 禁用「兑换」按钮 + 提示「请先为 X 创建收款账户」+ CTA 跳创建（不静默自动建）
- [ ] Step 2: preview 验证 — 选一个客户没有收款账户的币对 → 截图确认按钮禁用 + 提示 + CTA
- [ ] Step 3: 提交 — `git commit -am "feat(client): swap widget per-currency receiving-account precheck"`

### Task 13: 提现地址停用按钮

**Files:** Modify `pages/WithdrawalAddresses.tsx`

- [ ] Step 1: ACTIVE 地址行加「停用」按钮 → `customerFetch POST /withdrawal-addresses/:no/deactivate`；处理 `LAST_ACTIVE_FIAT_ADDRESS` / `ADDRESS_HAS_INFLIGHT_WITHDRAWAL` 错误码为友好文案；停用后行显示 DEACTIVATED（归档态）
- [ ] Step 2: preview 验证 — 停用非末位地址成功；停用末位法币地址被拦（看到友好提示）截图
- [ ] Step 3: 提交 — `git commit -am "feat(client): customer deactivate withdrawal address"`

---

## 收尾验证（全 Phase 后）

- [ ] `npm run build` 绿（无循环依赖）
- [ ] `npm run test`（新增 spec 全绿，pre-existing fail 不新增）
- [ ] e2e 手验：新客户 onboarding→登记法币地址(即 ACTIVE)→建 C_DEP→充值/兑换放行；删末位法币地址被拦
- [ ] 同步 truth：`doc-final/reference/truth/v3-financial-config.md`（§4 提现地址加 DEACTIVATED + 首地址免冷却）+ `v2/v6` 交易门更新；BACKLOG 勾账
- [ ] `finishing-a-development-branch`：合回 main
