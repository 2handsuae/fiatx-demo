# 费率受众谓词 + 客户标签地基 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把费率等级"受众"从「isDefault + 逐客户 binding」改为「`{requiredTags, window}` 谓词 + 客户标签」，客户管理新增 operator 手动打 tag（经固定注册表被 fee level 引用），硬切退役 binding；提现+兑换两域同步。

**Architecture:** 三阶段依赖有序。**A** 客户域建 tag 固定注册表 + 显式标签表 + `effectiveTags`（显式∪派生）+ 手动打 tag UI。**B** 两 level 表加 `requiredTagsJson`/`validFrom`/`validTo`，`resolveBestLevel` 改按谓词判资格（cheapest 后段不动）。**C** 迁种子 binding→白名单标签、删 binding 表/服务/审计。硬切、无双跑；保真铁律=迁移前后同客户取费逐一致。

**Tech Stack:** NestJS + Prisma(SQLite) + Jest；React admin(admin-web)。迁移 `npm run db:migrate:local`；base seed `npm run db:base:sync`；测试 `npx jest <path>`；类型闸 `npx tsc --noEmit`。

> **执行前置**：本计划在**独立 worktree** 里跑（`bash scripts/stack.sh up` 自动分栈）。RBAC 新权限须 `db:base:sync` + **重启后端**（SUPER_ADMIN 走内存 catalog）。前端改动**须 preview 渲染截图验证**（项目铁律 [[feedback_verify_ui_by_rendering]]）。Admin 页**禁暴露原始 id**，用业务键（customerNo/tagCode/levelCode）。

---

## 文件结构（决策锁定）

**Phase A — 客户标签地基（新建为主）**
- Create `src/modules/identity/customer-tags/constants/customer-tag.constant.ts` — 固定注册表 `CUSTOMER_TAG_DEFINITIONS` + 类型/查询辅助
- Create `src/modules/identity/customer-tags/customer-tag.service.ts` — 显式标签 assign/revoke + `effectiveTags`
- Create `src/modules/identity/customer-tags/customer-tag.controller.ts` — admin API（list-catalog / customer 的 effective / assign / revoke）
- Create `src/modules/identity/customer-tags/customer-tag.module.ts`
- Create `src/modules/identity/customer-tags/customer-tag.service.spec.ts`
- Modify `prisma/schema.prisma` — 加 `CustomerExplicitTag` model + `CustomerMain.onboardingApprovedAt`
- Modify `src/modules/audit-logging/constants/audit-actions.constant.ts` — 加 `CUSTOMER_TAG` workflow/entity + `TAG_ASSIGNED/TAG_REVOKED`
- Modify `src/modules/identity/access-control/rbac.catalog.ts` — 加 `CUSTOMER_TAG_VIEW/MANAGE`
- Modify `src/modules/identity/onboarding/onboarding.service.ts` — FINAL_APPROVAL 通过时写 `onboardingApprovedAt`
- Modify `src/app.module.ts` — 注册 CustomerTagModule
- Modify `admin-web/src/pages/CustomerDetail.tsx` — 加「标签」面板

**Phase B — 费率受众谓词（改现有）**
- Modify `prisma/schema.prisma` — `WithdrawalFeeLevel`/`SwapFeeLevel` 加 `requiredTagsJson`/`validFrom`/`validTo`
- Create `src/modules/trading/shared/fee-audience.util.ts` — `matchesAudience(level, effectiveTags, now)` 共享判定（两域 DRY）
- Modify `src/modules/trading/withdrawal-fee-level/withdraw-quote.service.ts` + `.../swap-fee-level/swap-quote.service.ts` — `resolveBestLevel` 资格改谓词
- Modify `admin-web/src/pages/WithdrawalFeeLevelDetail.tsx` + `SwapFeeLevelDetail.tsx` — requiredTags/window 编辑

**Phase C — binding 硬切**
- Create `prisma/migrations-scripts/2026-07-12-binding-to-whitelist-tag.ts` — 迁移脚本
- Modify `prisma/schema.prisma` — 删两 binding model
- Delete `*/withdrawal-fee-level-binding*.ts` + `swap-fee-level-binding*.ts`
- Modify 两 `resolveBestLevel` — 删 bound 分支；两 module/controller 去 binding 路由
- Modify `audit-actions.constant.ts` — 删 `*_FEE_LEVEL_BINDING` 常量组

---

# Phase A — 客户标签地基

### Task A1: Tag 固定注册表（常量 + 查询辅助）

**Files:**
- Create: `src/modules/identity/customer-tags/constants/customer-tag.constant.ts`
- Test: `src/modules/identity/customer-tags/customer-tag.constant.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { CUSTOMER_TAG_DEFINITIONS, isStaticTag, isValidTag } from './constants/customer-tag.constant';

describe('customer tag registry', () => {
  it('每项有 tagCode/displayName/type', () => {
    for (const d of CUSTOMER_TAG_DEFINITIONS) {
      expect(d.tagCode).toBeTruthy();
      expect(d.displayName).toBeTruthy();
      expect(['STATIC', 'DERIVED']).toContain(d.type);
    }
  });
  it('NEW_CUSTOMER/VIP 是 DERIVED、不可手打', () => {
    expect(isStaticTag('NEW_CUSTOMER')).toBe(false);
    expect(isStaticTag('VIP')).toBe(false);
  });
  it('WHITELIST_PILOT 是 STATIC、可手打', () => {
    expect(isStaticTag('WHITELIST_PILOT')).toBe(true);
  });
  it('未注册 tag 无效', () => {
    expect(isValidTag('TYPO_TAG')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `npx jest src/modules/identity/customer-tags/customer-tag.constant.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 写实现**

```ts
export type CustomerTagType = 'STATIC' | 'DERIVED';
export interface CustomerTagDefinition {
  tagCode: string;
  displayName: string;
  type: CustomerTagType;
  description: string;
}

export const CUSTOMER_TAG_DEFINITIONS: readonly CustomerTagDefinition[] = [
  { tagCode: 'NEW_CUSTOMER', displayName: '新客', type: 'DERIVED', description: 'onboarding 终批 ≤ newCustomerDays 天' },
  { tagCode: 'VIP', displayName: 'VIP', type: 'DERIVED', description: 'tradingTier=PREMIUM 派生' },
  { tagCode: 'WHITELIST_PILOT', displayName: '白名单·试点', type: 'STATIC', description: '手动指定客户群' },
] as const;

const BY_CODE = new Map(CUSTOMER_TAG_DEFINITIONS.map((d) => [d.tagCode, d]));
export const NEW_CUSTOMER_DAYS = 30;

export function isValidTag(code: string): boolean { return BY_CODE.has(code); }
export function isStaticTag(code: string): boolean { return BY_CODE.get(code)?.type === 'STATIC'; }
export function isDerivedTag(code: string): boolean { return BY_CODE.get(code)?.type === 'DERIVED'; }
export function staticTagCodes(): string[] { return CUSTOMER_TAG_DEFINITIONS.filter((d) => d.type === 'STATIC').map((d) => d.tagCode); }
```

- [ ] **Step 4: 跑测试确认 PASS** — `npx jest .../customer-tag.constant.spec.ts` → PASS
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(customer-tags): fixed tag registry constant"`

### Task A2: schema — CustomerExplicitTag + onboardingApprovedAt

**Files:** Modify `prisma/schema.prisma`

- [ ] **Step 1: 加 model + 列**（在 CustomerMain 附近）

```prisma
model CustomerExplicitTag {
  id               String   @id @default(uuid())
  customerId       String
  tagCode          String
  assignedByUserId String
  assignedAt       DateTime @default(now())
  customer         CustomerMain @relation(fields: [customerId], references: [id])
  @@unique([customerId, tagCode])
  @@index([tagCode])
  @@map("customer_explicit_tags")
}
```
CustomerMain 内加：`onboardingApprovedAt DateTime?` 和关系 `explicitTags CustomerExplicitTag[]`。

- [ ] **Step 2: 生成迁移 + client**

Run: `npm run db:migrate:local && npm run prisma:generate`
Expected: 新迁移生成、client 含 `customerExplicitTag`

- [ ] **Step 3: 类型闸** — `npx tsc --noEmit` → 0 报错
- [ ] **Step 4: Commit** — `git commit -am "feat(customer-tags): explicit tag table + onboardingApprovedAt"`

### Task A3: CustomerTagService — assign/revoke + effectiveTags（TDD 核心）

**Files:**
- Create: `src/modules/identity/customer-tags/customer-tag.service.ts`
- Test: `.../customer-tags/customer-tag.service.spec.ts`

- [ ] **Step 1: 写失败测试**（用 jest mock PrismaService + AuditLogsService；固定 now）

```ts
// 关键用例：
// 1) assign('WHITELIST_PILOT') → 写表 + 审计 TAG_ASSIGNED
// 2) assign('NEW_CUSTOMER') → 抛错（DERIVED 不可手打）
// 3) assign('TYPO') → 抛错（未注册）
// 4) effectiveTags：显式表有 WHITELIST_PILOT + tradingTier=PREMIUM + onboardingApprovedAt = now-10d
//    → 返回 {WHITELIST_PILOT, VIP, NEW_CUSTOMER}
// 5) effectiveTags：onboardingApprovedAt = now-40d、tradingTier=BASIC → 不含 NEW_CUSTOMER/VIP
```
（完整 mock：`customerExplicitTag.findMany` 返回赋值行；`customerMain.findUnique` 返回 `{tradingTier, onboardingApprovedAt}`；`now` 作参数传入 `effectiveTags(customerId, now)` 便于断言。）

- [ ] **Step 2: 跑测试确认 FAIL**
- [ ] **Step 3: 写实现**

```ts
@Injectable()
export class CustomerTagService {
  constructor(private prisma: PrismaService, private audit: AuditLogsService) {}

  async assign(customerId: string, tagCode: string, actor: ApprovalActorContext) {
    if (!isStaticTag(tagCode)) throw new BadRequestException(`Tag ${tagCode} 不是可手动赋的 STATIC 标签`);
    const customer = await this.prisma.customerMain.findUnique({ where: { id: customerId }, select: { customerNo: true } });
    if (!customer) throw new NotFoundException('Customer not found');
    const row = await this.prisma.customerExplicitTag.upsert({
      where: { customerId_tagCode: { customerId, tagCode } },
      update: {}, create: { customerId, tagCode, assignedByUserId: actor.userId },
    });
    await this.audit.recordByActor({ action: AuditGovernanceActions.CUSTOMER_TAG.TAG_ASSIGNED,
      entityType: AuditEntityTypes.CUSTOMER_TAG, entityId: row.id, entityNo: `${customer.customerNo}:${tagCode}`,
      workflowType: AuditBusinessWorkflowTypes.CUSTOMER_TAG, result: AuditResult.SUCCESS,
      metadata: { customerId, tagCode }, sourcePlatform: 'ADMIN_API' }, toAuditActor(actor));
    return row;
  }

  async revoke(customerId: string, tagCode: string, actor: ApprovalActorContext) { /* 对称：delete + TAG_REVOKED */ }

  async effectiveTags(customerId: string, now: Date): Promise<Set<string>> {
    const [explicit, c] = await Promise.all([
      this.prisma.customerExplicitTag.findMany({ where: { customerId }, select: { tagCode: true } }),
      this.prisma.customerMain.findUnique({ where: { id: customerId }, select: { tradingTier: true, onboardingApprovedAt: true } }),
    ]);
    const tags = new Set(explicit.map((e) => e.tagCode));
    if (c?.tradingTier === 'PREMIUM') tags.add('VIP');
    if (c?.onboardingApprovedAt && (now.getTime() - c.onboardingApprovedAt.getTime()) <= NEW_CUSTOMER_DAYS * 86400_000) tags.add('NEW_CUSTOMER');
    return tags;
  }
}
```

- [ ] **Step 4: 跑测试确认 PASS**（全部用例绿）
- [ ] **Step 5: Commit** — `git commit -am "feat(customer-tags): CustomerTagService assign/revoke/effectiveTags (TDD)"`

### Task A4: 审计常量 + RBAC 权限

**Files:** Modify `audit-actions.constant.ts`、`rbac.catalog.ts`

- [ ] **Step 1:** audit 加 `AuditBusinessWorkflowTypes.CUSTOMER_TAG='CUSTOMER_TAG'`、`AuditEntityTypes.CUSTOMER_TAG='CUSTOMER_TAG'`、`AuditGovernanceActions.CUSTOMER_TAG={TAG_ASSIGNED,TAG_REVOKED}`。
- [ ] **Step 2:** rbac.catalog 加 `CUSTOMER_TAG_VIEW`（读 effective/catalog）+ `CUSTOMER_TAG_MANAGE`（assign/revoke），归 customer 域 bucket。
- [ ] **Step 3:** `npx tsc --noEmit` → 0；`npm run db:base:sync` 落权限。
- [ ] **Step 4: Commit** — `git commit -am "feat(customer-tags): audit actions + RBAC perms"`

### Task A5: Controller + Module + onboarding 回写 + 注册

**Files:** Create controller/module；Modify onboarding.service.ts、app.module.ts

- [ ] **Step 1:** controller 4 端点（`GET /admin/customer-tags/catalog`、`GET /admin/customers/:customerNo/effective-tags`、`POST .../:customerNo/tags` assign、`DELETE .../:customerNo/tags/:tagCode` revoke），门控上条权限；查 customerNo→id 用业务键。
- [ ] **Step 2:** module 装配 service+controller，export service（供 Phase B 费率域注入）。
- [ ] **Step 3:** onboarding.service FINAL_APPROVAL 通过分支写 `onboardingApprovedAt = new Date()`（找现有 FINAL_APPROVAL 落地处，加一处 update）。
- [ ] **Step 4:** app.module 引入 CustomerTagModule。
- [ ] **Step 5:** `npx tsc --noEmit` → 0；重启后端；`curl` catalog 端点 200。
- [ ] **Step 6: Commit** — `git commit -am "feat(customer-tags): controller/module + onboardingApprovedAt writeback"`

### Task A6: 前端 — 客户详情「标签」面板

**Files:** Modify `admin-web/src/pages/CustomerDetail.tsx`（先读它 + 一个现有带"加/删 chip"面板的页做样板）

- [ ] **Step 1:** 读 `CustomerDetail.tsx` 摸清数据加载/权限 gate/组件风格；标签面板：拉 `effective-tags`（显式可删 chip + 派生只读徽章）+ catalog（STATIC 下拉赋值）。
- [ ] **Step 2:** 接三端点（assign/revoke/effective）；显式 chip 带删除、派生徽章灰色不可删；用 customerNo 调用。
- [ ] **Step 3:** preview 渲染，种子 admin 登录，**截图验证**：显式 chip 可加删、派生只读、无原始 id 暴露。
- [ ] **Step 4: Commit** — `git commit -am "feat(admin): customer manual-tag panel"`

> **Phase A 验收**：`effectiveTags` 单测全绿（含新客到期现算不命中）；客户详情页可手动加/删 STATIC 标签、派生只读展示（截图为证）；`tsc` 0。

---

# Phase B — 费率受众谓词（提现 + 兑换）

### Task B1: schema — 两 level 表加 requiredTagsJson + 窗

**Files:** Modify `prisma/schema.prisma`

- [ ] `WithdrawalFeeLevel` / `SwapFeeLevel` 各加：`requiredTagsJson String @default("[]")`、`validFrom DateTime?`、`validTo DateTime?`。
- [ ] `npm run db:migrate:local && npm run prisma:generate`；`npx tsc --noEmit` → 0。
- [ ] Commit `feat(fee-level): audience fields (requiredTags + window)`

### Task B2: 共享受众判定 util（DRY）+ TDD

**Files:** Create `src/modules/trading/shared/fee-audience.util.ts` + `.spec.ts`

- [ ] **Step 1: 失败测试**

```ts
import { matchesAudience } from './fee-audience.util';
const now = new Date('2026-07-12T00:00:00Z');
it('空 requiredTags + 无窗 → 恒命中', () => expect(matchesAudience({ requiredTagsJson: '[]', validFrom: null, validTo: null }, new Set(), now)).toBe(true));
it('requiredTags 子集才命中', () => {
  const lvl = { requiredTagsJson: '["VIP"]', validFrom: null, validTo: null };
  expect(matchesAudience(lvl, new Set(['VIP']), now)).toBe(true);
  expect(matchesAudience(lvl, new Set(['NEW_CUSTOMER']), now)).toBe(false);
});
it('窗外不命中', () => expect(matchesAudience({ requiredTagsJson: '[]', validFrom: new Date('2026-08-01'), validTo: new Date('2026-08-31') }, new Set(), now)).toBe(false));
```

- [ ] **Step 2: FAIL** → **Step 3: 实现**

```ts
export function matchesAudience(level: { requiredTagsJson: string; validFrom: Date | null; validTo: Date | null }, effectiveTags: Set<string>, now: Date): boolean {
  if (level.validFrom && now < level.validFrom) return false;
  if (level.validTo && now > level.validTo) return false;
  const req: string[] = JSON.parse(level.requiredTagsJson || '[]');
  return req.every((t) => effectiveTags.has(t));
}
```

- [ ] **Step 4: PASS** → **Step 5: Commit** `feat(fee-level): shared audience predicate util (TDD)`

### Task B3: resolveBestLevel 改谓词（两域）

**Files:** Modify `withdraw-quote.service.ts`、`swap-quote.service.ts`

- [ ] **Step 1:** 注入 `CustomerTagService`；`resolveBestLevel` 里可用集合改：`allLevels.filter(l => l.isDefault || matchesAudience(l, tags, now))`，其中 `tags = await customerTagService.effectiveTags(customerId, now)`。删原 `boundSet` 分支（binding 在 Phase C 删表，此处先不消费其结果——用 isDefault||谓词）。
- [ ] **Step 2:** 加/改单测：客户有 VIP 标签 → VIP 级进候选、cheapest 生效；无标签 → 仅 default。
- [ ] **Step 3:** `npx tsc --noEmit` 0；`npx jest .../withdraw-quote .../swap-quote`。
- [ ] **Step 4: Commit** `feat(fee-level): resolveBestLevel by audience predicate (both domains)`

### Task B4: 前端 — level 表单 requiredTags/窗 编辑

**Files:** Modify `WithdrawalFeeLevelDetail.tsx`、`SwapFeeLevelDetail.tsx`（先读样板）

- [ ] 读现有 level 编辑表单；加 requiredTags 多选（从 `GET /admin/customer-tags/catalog` 拉全 tag）+ validFrom/validTo 日期。
- [ ] preview 截图验证两页可编辑受众；`tsc` 0。
- [ ] Commit `feat(admin): fee-level audience editor (requiredTags + window)`

> **Phase B 验收**：谓词 util 单测绿；`resolveBestLevel` 按标签选级 + cheapest；两 level 页可配受众（截图）。

---

# Phase C — binding 硬切退役

### Task C1: 迁移脚本 binding→白名单标签

**Files:** Create `prisma/migrations-scripts/2026-07-12-binding-to-whitelist-tag.ts`

- [ ] 读全部 `withdrawalFeeLevelBinding`/`swapFeeLevelBinding`；每条：给 customer 赋 STATIC 标签 `WHITELIST_<levelCode>`（注册表加对应项 or 归并）、把 level.requiredTagsJson 设为 `["WHITELIST_<levelCode>"]`。幂等（upsert）。
- [ ] 跑脚本 + 打印迁移条数。
- [ ] Commit `chore(fee-level): migrate bindings to whitelist tags`

### Task C2: 等价保真测试（迁移前后取费一致）

**Files:** Create `.../fee-level-migration-equivalence.spec.ts`

- [ ] 造 seed：客户绑一个非默认更便宜的 level；断言迁移后 `resolveBestLevel` 返回同一 level、同 totalFee。
- [ ] 绿则进删除。Commit `test(fee-level): binding→tag equivalence`

### Task C3: 删 binding 表/服务/审计/路由

**Files:** Delete binding services；Modify schema/两 quote service/module/controller/audit-actions

- [ ] 删两 binding model（schema）；`db:migrate:local` 生成 drop 迁移。
- [ ] 删 `*-fee-level-binding.service.ts`、`*-fee-level-binding-workflow.service.ts`、binding controller 路由、module provider。
- [ ] `resolveBestLevel` 删残留 binding 引用；删 `WITHDRAWAL/SWAP_FEE_LEVEL_BINDING` 审计常量组 + `WithdrawalFeeLevelBindingService` 等引用。
- [ ] `npx tsc --noEmit` 0；全量 `npm test` 无净新失败；`db:base:sync`。
- [ ] Commit `refactor(fee-level): retire binding tables/services (hard cut)`

> **Phase C 验收**：等价保真绿；binding 全删、`tsc` 0、`grep -r "FeeLevelBinding" src` 仅注释/无 → 硬切完成。

---

## 自查（覆盖 spec）

- spec §3 客户地基 → A1–A6 ✅｜§4 费率谓词 → B1–B4 ✅｜§5 硬切 → C1–C3 ✅｜§6 保真铁律 → C2 ✅｜手动打 tag 硬需求 → A6 ✅｜固定注册表 → A1 ✅｜onboardingApprovedAt → A2+A5 ✅｜RBAC → A4 ✅。
- 无占位符：核心逻辑（注册表/effectiveTags/matchesAudience/迁移）均给真实代码；前端/routine 步骤给"读样板文件 X 镜像"的具体指令（非 TODO）。
- 类型一致：`effectiveTags(customerId, now): Set<string>` / `matchesAudience(level, Set, now): boolean` 跨 B2/B3 一致。
- ⚠ B/C 的前端与 controller 步骤颗粒度略粗（列文件+关键代码+验收），执行时按 subagent-driven 逐 task 细化；B、C 待 A 落地后可各自展开为独立细粒度计划。

<p align="center">— 计划结束 —</p>
