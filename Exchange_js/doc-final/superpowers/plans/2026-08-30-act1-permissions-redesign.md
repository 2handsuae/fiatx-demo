# 第一幕 · 开业：职权重划与退役 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐任务实施。步骤用 `- [ ]` 勾选。
> **Spec**：`doc-final/superpowers/specs/2026-08-30-act1-permissions-redesign-design.md`（决策记录 D1–D14 在其 §0）

**Goal**：让第一幕的台词「谁能做什么是拼包拼出来的」在管理台上真正兑现——退掉演示里用不到的三块模块与 30 个死权限组，把权限重划成 12 域 50 包、11 个职务各司其职，并消除三处自批死锁。

**Architecture**：三段推进，段间可停可验。段一是纯删除（删完权限只减不增，演示画面除首页外零变化）；段二在干净地基上一次落定权限终盘（权限组 → 桶目录 → 角色绑定 → 种子账号 → 审批策略 → 前端常量）；段三照段二的实际终态改文档与剧本。**后段依赖前段的终盘，不得并段。**

**Tech Stack**：NestJS + Prisma + SQLite ｜ React 管理台（`admin-web`）｜ 权限中枢 `src/modules/identity/access-control/rbac.catalog.ts` ｜ 审批策略 `src/modules/governance/approvals/constants/approval.constants.ts` ｜ 验收走真实 HTTP 登录（`scripts/demo-mlro.ts → loginAs`）

## Global Constraints

- **本项目是演示系统**（CLAUDE.md §0–§2）：禁做幂等 / 去重 / 重试与回放 / 补偿 / 并发锁 / 向后兼容与迁移兼容层 / 输入防御性校验 / 性能优化 / 为让测试通过而修测试框架。发现兜底类缺口 → `doc-final/PRODUCTION-NOTES.md` 追加一行即放下。
- **数据随时可重铺**：schema 改动直接按目标终态做，**禁止 backfill / 双写过渡**。迁移文件照常新增以保证空库能建起，内容不必兼容已有行。
- **禁止「扫源码文本」型断言**。所有验收必须来自行为：真实登录、真实 HTTP、真实状态迁移。
- **worktree 隔离**：本计划在独立 worktree 执行，栈用 `self`（`bash scripts/stack.sh up`），命令一律经 `bash scripts/on-stack.sh self <script>`。禁止在主工作树起服务。
- **随手闸**（每个任务结束前跑）：`npx tsc --noEmit -p tsconfig.json`；`cd admin-web && npx tsc -b --noEmit`；`cd client-web && npx tsc -b --noEmit`。
- **改了前端必须起 preview 渲染 + 截图**，tsc 通过不算数。
- **jest 判据 = 净新失败 0**，只跑本任务相关目录。基线红名单见 `doc-final/demo/baseline.md`。
- **对外识别一律用业务键**，管理台不暴露 UUID。
- **审计词条退役走「退役拒写」名册**，不直接删——`audit-vocabulary-closure.spec` 必须始终绿。
- 所有新增/改名权限组必须同时出现在 **三处**：`PermissionGroup` 联合类型、至少一条 `route(...)` 注册、`ACTION_BUCKET_CATALOG` 某个桶（客户侧路由专用组除外，见 T7 步骤 6）。

---

# 段一 · 退役

## Task 1：退役五本档案簿与监管闸门

两块互相引用（`registries.service.ts` ↔ `regulatory-gates.service.ts`），必须一起删。

**Files:**
- Delete: `src/modules/governance/registries/`（整目录，含 `.spec.ts`）
- Delete: `src/modules/governance/regulatory-gates/`（整目录，含 `.spec.ts`）
- Modify: `src/modules/governance/governance.module.ts`
- Delete: `admin-web/src/pages/GovernanceRegistryListPage.tsx` `GovernanceRegistryDetailPage.tsx` `GovernanceRegistryCreatePage.tsx` `GovernanceRegistryEditPage.tsx` `GovernanceRegistryFormPage.tsx` `governanceRegistryConfig.ts` `governanceRegistryFormConfig.ts` `RegulatoryGateListPage.tsx` `RegulatoryGateDetailPage.tsx` `RegulatoryGateCreatePage.tsx`
- Modify: `admin-web/src/App.tsx`（lazy import `:49-55`；路由 `:343-494` 与 `:685-707`）
- Modify: `admin-web/src/components/DashboardLayout.tsx`（`:355-395` 注释块整段删）
- Modify: `admin-web/src/rbac/permissions.ts`（`GOV_SHAREHOLDING_*` `GOV_APPOINTMENT*` `GOV_TRAINING*` `GOV_CONFLICT*` `GOV_WIND_DOWN_*` `GOV_REGULATORY_GATE*` 全部常量）
- Modify: `prisma/schema.prisma`（删 7 个 model）
- Create: `prisma/migrations/<timestamp>_act1_drop_registries_and_gates/migration.sql`

**Interfaces:**
- Consumes: 无
- Produces: `GovernanceModule` 仅 `imports: [ApprovalsModule]`；schema 中不再有 `ShareholdingRegistryVersion` / `ShareholdingRegistryParticipant` / `AppointmentRecord` / `TrainingRecord` / `ConflictDisclosure` / `WindDownMaterialRecord` / `RegulatoryGateItem` 七个 model。后续 Task 4 依赖此处已无 `GOV_REGISTRY_*` / `GOV_REGULATORY_GATE_*` 的业务消费方。

- [ ] **Step 1：确认外部依赖只有已知的那几处**

```bash
cd Exchange_js
grep -rln "governance/registries\|GovernanceRegistriesService\|GovernanceRegistriesModule\|regulatory-gates\|RegulatoryGatesService\|RegulatoryGatesModule\|RegulatoryGate" src admin-web/src test \
  | grep -viE "modules/governance/registries|modules/governance/regulatory-gates|pages/GovernanceRegistry|pages/RegulatoryGate"
```

预期输出恰好这 7 行（多出任何一行都要先读懂再动手）：
```
src/modules/identity/access-control/rbac.catalog.spec.ts
src/modules/identity/access-control/rbac.catalog.ts
src/modules/governance/governance.module.ts
src/modules/audit-logging/constants/audit-actions.constant.ts
admin-web/src/App.tsx
admin-web/src/components/DashboardLayout.tsx
admin-web/src/pages/Wave8OpsDashboardPage.tsx
```

- [ ] **Step 2：删后端两个目录**

```bash
rm -rf src/modules/governance/registries src/modules/governance/regulatory-gates
```

- [ ] **Step 3：改 `governance.module.ts` 为**

```typescript
import { Global, Module } from '@nestjs/common';
import { ApprovalsModule } from './approvals/approvals.module';

@Global()
@Module({
  imports: [ApprovalsModule],
  exports: [ApprovalsModule],
})
export class GovernanceModule {}
```

- [ ] **Step 4：删前端 10 个文件**

```bash
cd admin-web/src/pages
rm -f GovernanceRegistryListPage.tsx GovernanceRegistryDetailPage.tsx \
      GovernanceRegistryCreatePage.tsx GovernanceRegistryEditPage.tsx \
      GovernanceRegistryFormPage.tsx governanceRegistryConfig.ts \
      governanceRegistryFormConfig.ts \
      RegulatoryGateListPage.tsx RegulatoryGateDetailPage.tsx RegulatoryGateCreatePage.tsx
```

- [ ] **Step 5：`App.tsx` 删 7 行 lazy import 与 24 条路由**

删除 `:49-55` 的 7 个 `const GovernanceRegistry*Page = lazy(...)` / `const RegulatoryGate*Page = lazy(...)`；删除 `:343-494` 与 `:685-707` 区间内所有 `registries/...` 与 `registries/regulatory-gates...` 的 `<Route>`。**保留** `:196` 与 `:602` 的 Wave8 index 路由（Task 3 处理）。

- [ ] **Step 6：`DashboardLayout.tsx` 删注释块**

删除 `:355-395` 整段被注释掉的 `Governance Registries` 菜单定义（含 `Shareholding Registry` / `Appointments` / `Trainings` / `Conflicts` / `Wind-down Materials` / `Regulatory Gates` 六个子项）。**保留** `:399-410` 的 Counterparty 注释块（Task 2 处理）。

- [ ] **Step 7：`permissions.ts` 删常量**

删除 `GOV_SHAREHOLDING_REGISTRY_*`、`GOV_APPOINTMENT*`、`GOV_TRAINING*`、`GOV_CONFLICT*`、`GOV_WIND_DOWN_MATERIAL*`、`GOV_REGULATORY_GATE*` 全部键。

- [ ] **Step 8：schema 删 7 个 model 并生成迁移**

在 `prisma/schema.prisma` 删除 `ShareholdingRegistryVersion`（`:626`）、`ShareholdingRegistryParticipant`（`:654`）、`AppointmentRecord`（`:673`）、`TrainingRecord`（`:702`）、`ConflictDisclosure`（`:726`）、`WindDownMaterialRecord`（`:751`）、`RegulatoryGateItem`（`:776`）七个 model，以及其它 model 中指向它们的关系字段（`npx prisma validate` 会逐个报出来）。

```bash
cd Exchange_js
npx prisma validate
npx prisma migrate dev --name act1_drop_registries_and_gates --create-only
npx prisma generate
```
预期：`prisma/migrations/<timestamp>_act1_drop_registries_and_gates/migration.sql` 生成，内含 7 条 `DROP TABLE`。

- [ ] **Step 9：随手闸**

```bash
cd Exchange_js && npx tsc --noEmit -p tsconfig.json
cd admin-web && npx tsc -b --noEmit && cd ..
cd client-web && npx tsc -b --noEmit && cd ..
```
预期：三条全部无输出。**若 `rbac.catalog.ts` 因 `GOV_REGISTRY_*` / `GOV_REGULATORY_GATE_*` 仍在 `PermissionGroup` 类型里而未报错，属正常**——那些组由 Task 4 统一退役，本任务不动 `rbac.catalog.ts`。

- [ ] **Step 10：提交**

```bash
git add -A src/modules/governance admin-web/src/pages admin-web/src/App.tsx \
  admin-web/src/components/DashboardLayout.tsx admin-web/src/rbac/permissions.ts \
  prisma/schema.prisma prisma/migrations
git commit -m "refactor(governance): 退役五本档案簿与监管闸门——演示不讲，业主 2026-08-30 定"
```

---

## Task 2：退役对手方（流动性提供商 / 报价配置）

**Files:**
- Delete: `src/modules/counterparty/`（整目录）
- Modify: `src/app.module.ts`（`:11` `:13` 两行 import + `imports` 数组两项）
- Delete: `admin-web/src/pages/LiquidityProviderList.tsx` `LiquidityProviderCreate.tsx` `LiquidityConfigList.tsx` `LiquidityConfigCreate.tsx` `LiquidityConfigEdit.tsx`
- Modify: `admin-web/src/App.tsx`（`:23-27` lazy import；`:530-546` 与 `:710-714` 路由）
- Modify: `admin-web/src/components/DashboardLayout.tsx`（`:399-410` 注释块）
- Modify: `admin-web/src/rbac/permissions.ts`（`LIQUIDITY_PROVIDERS_*` `LIQUIDITY_CONFIG_*`）
- Modify: `prisma/schema.prisma`（删 `LiquidityProvider` `LiquidityConfiguration`）
- Create: `prisma/migrations/<timestamp>_act1_drop_counterparty/migration.sql`

**Interfaces:**
- Consumes: Task 1 的产出（`App.tsx` / `DashboardLayout.tsx` / `permissions.ts` 已被改过，注意基于最新内容编辑）
- Produces: schema 中不再有 `LiquidityProvider` / `LiquidityConfiguration`；`app.module.ts` 不再 import counterparty

- [ ] **Step 1：确认「对手方」两义已分清**

```bash
cd Exchange_js
grep -rl "modules/counterparty\|LiquidityProvidersService\|LiquidityConfigService" src admin-web/src test | grep -v "modules/counterparty"
```
预期输出仅一行：`src/app.module.ts`

**⚠️ 本任务只退流动性提供商 / 报价配置。三条交易流程里的 `SANCTION_COUNTERPARTY`、KYT 对手方地址、制裁分主体那套是第三幕正题，一行不动。** 下面这条必须仍有大量命中：

```bash
grep -rl "SANCTION_COUNTERPARTY\|counterpartyAddress" src | wc -l
```
预期：≥ 4

- [ ] **Step 2：删后端目录**

```bash
rm -rf src/modules/counterparty
```

- [ ] **Step 3：`app.module.ts` 摘两处**

删除 `:11` `import { LiquidityProvidersModule } ...` 与 `:13` `import { LiquidityConfigModule } ...`，并从 `@Module({ imports: [...] })` 数组中删除 `LiquidityProvidersModule` 与 `LiquidityConfigModule` 两项。

- [ ] **Step 4：删前端 5 个页面**

```bash
cd admin-web/src/pages
rm -f LiquidityProviderList.tsx LiquidityProviderCreate.tsx \
      LiquidityConfigList.tsx LiquidityConfigCreate.tsx LiquidityConfigEdit.tsx
```

- [ ] **Step 5：`App.tsx` 删 5 行 lazy import 与 10 条路由**

删 `:23-27` 五个 `const Liquidity* = lazy(...)`；删 `:530-546` 与 `:710-714` 区间内所有 `counterparty/liquidity-*` 的 `<Route>`。

- [ ] **Step 6：`DashboardLayout.tsx` 删 Counterparty 注释块**（`:399-410`）；`permissions.ts` 删 `LIQUIDITY_PROVIDERS_READ` `LIQUIDITY_PROVIDERS_CREATE` `LIQUIDITY_CONFIG_READ` `LIQUIDITY_CONFIG_CREATE` `LIQUIDITY_CONFIG_UPDATE` 五个常量。

- [ ] **Step 7：schema 删 2 个 model 并生成迁移**

```bash
cd Exchange_js
# 删除 schema.prisma 中 LiquidityProvider（:827）与 LiquidityConfiguration（:891）两个 model 及关系字段
npx prisma validate
npx prisma migrate dev --name act1_drop_counterparty --create-only
npx prisma generate
```

- [ ] **Step 8：随手闸 + 提交**

```bash
cd Exchange_js && npx tsc --noEmit -p tsconfig.json
cd admin-web && npx tsc -b --noEmit && cd ..
cd client-web && npx tsc -b --noEmit && cd ..
git add -A src/modules src/app.module.ts admin-web/src prisma
git commit -m "refactor(counterparty): 退役流动性提供商与报价配置——保留交易域的 KYT 对手方概念"
```

---

## Task 3：管理台首页换空白占位页

**Files:**
- Delete: `admin-web/src/pages/Wave8OpsDashboardPage.tsx`
- Create: `admin-web/src/pages/AdminHomePlaceholder.tsx`
- Modify: `admin-web/src/App.tsx`（`:56` lazy import；`:196` 与 `:602` 两处 index 路由）
- Modify: `admin-web/src/rbac/permissions.ts`（删 `REIMBURSEMENT_OBLIGATIONS_READ`）

**Interfaces:**
- Consumes: Task 1/2 的 `App.tsx` 改动
- Produces: `AdminHomePlaceholder` 默认导出的 React 组件，无 props，无网络请求

- [ ] **Step 1：新建占位页**

```tsx
// admin-web/src/pages/AdminHomePlaceholder.tsx
//
// 原 Wave8OpsDashboardPage 两块面板：一块打已删的 /admin/reimbursement-obligations
// （恒 404），一块是 2026-08-30 退役的监管闸门 —— 整页退役。业主定：先放空白占位，
// 「这页以后再优化」。刻意不发任何请求：第一幕开演第一个画面不能有红色网络错误。
export default function AdminHomePlaceholder() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <h1 className="text-xl font-semibold text-gray-800 dark:text-gray-100">
        FiatX 管理台
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        请从左侧菜单开始。
      </p>
    </div>
  );
}
```

- [ ] **Step 2：`App.tsx` 换掉三处**

把 `:56` 的
```tsx
const Wave8OpsDashboardPage = lazy(() => import('./pages/Wave8OpsDashboardPage'));
```
改为
```tsx
const AdminHomePlaceholder = lazy(() => import('./pages/AdminHomePlaceholder'));
```
并把 `:196` 与 `:602` 两处 `withPermission(<Wave8OpsDashboardPage />, [PERMISSIONS.BASE_ACCESS])` 中的组件名换成 `<AdminHomePlaceholder />`。

- [ ] **Step 3：删旧页与死常量**

```bash
rm -f admin-web/src/pages/Wave8OpsDashboardPage.tsx
# permissions.ts 删 REIMBURSEMENT_OBLIGATIONS_READ 与 INTERNAL_COLLECTIONS_RECONCILE 两个常量
```

- [ ] **Step 4：顺手拆掉 `CustodianWalletDetail.tsx` 的幽灵按钮**

`admin-web/src/pages/CustodianWalletDetail.tsx:182` 的
```tsx
const canCreateCollection = hasAnyPermission([PERMISSIONS.INTERNAL_COLLECTIONS_RECONCILE]);
```
连同它控制显示的那个按钮一并删除（端点早已不存在，点了没反应）。删完若 `hasAnyPermission` 在该文件内不再被使用，一并移除其 import。

- [ ] **Step 5：随手闸 + 起 preview 截图验证**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
```
起 self 栈，登录 `admin@fiatx.com / 123456`，访问 `/admin`：
- 截图必须显示占位文案
- **读 network 面板确认零 404**（这是本任务的真正判据，页面好看不算数）

- [ ] **Step 6：提交**

```bash
git add admin-web/src/pages admin-web/src/App.tsx admin-web/src/rbac/permissions.ts
git commit -m "refactor(admin): 首页退役 Wave8 面板改空白占位——开演第一个画面不再是两个 404"
```

---

## Task 4：退役 30 个权限组与 15 条幽灵路由

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`
- Modify: `src/modules/identity/access-control/rbac.catalog.spec.ts`
- Delete/Modify: 幽灵路由对应的 controller 方法（见步骤 4）
- Modify: `admin-web/src/pages/SumsubEventsPage.tsx`（去重放按钮）

**Interfaces:**
- Consumes: Task 1/2 已删除的模块（其权限组此刻已无消费方）
- Produces: `PermissionGroup` 联合类型净剩 51 个成员（80 − 30 + 1 改名后仍为原位）；`RBAC_ROLE_GROUP_BINDINGS` 中不再出现任何被退役的组

- [ ] **Step 1：写下退役前的基线数字**

```bash
cd Exchange_js
awk '/^export type PermissionGroup/,/;/' src/modules/identity/access-control/rbac.catalog.ts \
  | grep -oE "'[A-Z_]+'" | tr -d "'" | sort -u | wc -l
```
预期：`80`

- [ ] **Step 2：从 `PermissionGroup` 联合类型删 30 个组**

零路由（16）：`CDD_REVIEW_WRITE` `CLEARING_READ` `CLEARING_WRITE` `JOURNAL_READ` `MLRO_REVIEW_WRITE` `ONBOARDING_READ` `PAYIN_READ` `PAYIN_WRITE` `PAYOUT_READ` `PAYOUT_WRITE` `RECON_OUTSTANDING_READ` `SETTLEMENT_READ` `SETTLEMENT_WRITE` `TX_COMPLIANCE_READ` `TX_COMPLIANCE_WRITE` `CUSTOMER_RATE_WRITE`

幽灵路由组（1）：`CUSTOMER_RATE_READ`

随模块（6）：`GOV_REGISTRY_READ` `GOV_REGISTRY_WRITE` `GOV_REGULATORY_GATE_READ` `GOV_REGULATORY_GATE_WRITE` `COUNTERPARTY_READ` `COUNTERPARTY_WRITE`

按 D7（2）：`GOV_APPROVAL_WRITE` `GOV_APPROVAL_DECIDE`

按 D8/D9（3）：`LEDGER_ACCOUNT_WRITE` `INVESTOR_OVERRIDE_WRITE` `RISK_DECISION_RECORD_WRITE`

历史别名（2）：`IAM_READ` `IAM_ASSIGN`

- [ ] **Step 3：删对应的 `route(...)` 注册**

| 路由 | 行号（改动前） |
|---|---|
| `GET/POST` × 5 条 `/admin/pricing/policies*` + `/admin/pricing/simulator/swap` | `:252-261` |
| `POST /admin/control-gates/approvals`、`.../:id/submit`、`.../:id/cancel` | `:453,454,457` |
| `POST /admin/tb/accounts` | `:404` |
| `PATCH /admin/compliance/customers/:id/investor-classification` | `:266` |
| `POST /admin/sumsub-events/simulate`、`POST /admin/sumsub-events/:id/replay`、`GET /admin/sumsub-events/:id` | `:271,272,270` |
| 档案簿 10 条 + 监管闸门 7 条 + 对手方 6 条 | 随 `GOV_REGISTRY_*` / `GOV_REGULATORY_GATE_*` / `COUNTERPARTY_*` 一起 |

`:455` `:456`（approve / reject）**保留**，权限组从 `['GOV_APPROVAL_DECIDE']` 改成 `['GOV_APPROVAL_READ']`。

`:202-221` 的 15 条 IAM 路由，把 `'IAM_READ'` / `'IAM_ASSIGN'` 从数组里摘掉，只留细粒度组。例：

```typescript
route('GET', '/users', 'List users', ['IAM_MEMBER_READ']),
route('POST', '/users', 'Create admin user', ['IAM_MEMBER_MANAGE']),
route('PUT', '/admin/iam/users/:id/roles', 'Replace user roles', ['IAM_ROLE_ASSIGN']),
```

- [ ] **Step 4：删幽灵路由对应的后端实现**

按 Step 3 的清单，逐条到对应 controller 删掉方法（以及仅被它调用的 service 方法）：

| 路由 | controller |
|---|---|
| `/admin/pricing/policies*`、`/admin/pricing/simulator/swap` | `src/modules/trading/pricing-center/` —— 该模块只有 `pricing-engine.service.ts` 与 provider，**没有 controller**，故只需删 `rbac.catalog.ts` 里的 5 条注册 |
| `/admin/control-gates/approvals`（建案 / submit / cancel） | `src/modules/governance/approvals/approvals.controller.ts` |
| `POST /admin/tb/accounts` | `src/modules/accounting/` 下的 TB 账户 controller（`grep -rn "admin/tb/accounts" src` 定位） |
| `PATCH /admin/compliance/customers/:id/investor-classification` | `grep -rn "investor-classification" src` 定位 |
| `/admin/sumsub-events/simulate`、`/:id/replay`、`GET /:id` | `src/modules/sumsub-ingestion/sumsub-ingestion-admin.controller.ts` |
| `PATCH /deposit-transactions/:id/status` | `src/modules/trading/deposit-transactions/deposit-transactions.controller.ts` |
| `PATCH /admin/swap-transactions/:id/status` | `src/modules/trading/swap-transactions/` 下的 admin controller |

**每删一条先跑一次**：

```bash
grep -rn "<该路由路径>" admin-web/src scripts test src | grep -v rbac.catalog
```
预期：无输出。**有输出就停下来读懂再决定**——`PATCH /deposit-transactions/:id/status` 与 `PATCH /admin/swap-transactions/:id/status` 属于 spec §10 待决项，若此处发现 `demo-lib.ts` 实跑依赖则**保留该路由**，并在 `PRODUCTION-NOTES.md` 追加一行说明，不得为退役去改造数脚本。

- [ ] **Step 5：`RBAC_ROLE_GROUP_BINDINGS` 摘掉被退役的组**

从 8 个职务的数组里删除所有出现的被退役组名（`IAM_READ` `IAM_ASSIGN` `GOV_APPROVAL_WRITE` `GOV_APPROVAL_DECIDE` `GOV_REGISTRY_*` `GOV_REGULATORY_GATE_*` `MLRO_REVIEW_WRITE` `RISK_DECISION_RECORD_WRITE` `LEDGER_ACCOUNT_WRITE`）。**本任务只做减法**，加法在 Task 9。

- [ ] **Step 6：前端 Sumsub 事件页去重放按钮**

`admin-web/src/pages/SumsubEventsPage.tsx` 删掉 `:118` 那次对 `/admin/sumsub-events/${id}/replay` 的 `adminFetch`，以及触发它的按钮与相关 state。页面只剩列表读取（`:90`）。

- [ ] **Step 7：`rbac.catalog.spec.ts` 跟上**

该 spec 引用了 `governance/registries` 与 `regulatory-gates`（Task 1 Step 1 已确认）。删除其中针对已退役组/路由的断言。**不得为了让 spec 通过而放宽断言逻辑**——只删不再存在的对象对应的用例。

- [ ] **Step 8：验证退役后的数字**

```bash
cd Exchange_js
awk '/^export type PermissionGroup/,/;/' src/modules/identity/access-control/rbac.catalog.ts \
  | grep -oE "'[A-Z_]+'" | tr -d "'" | sort -u > /tmp/g_after.txt
wc -l < /tmp/g_after.txt
```
预期：`50`（80 − 30）

```bash
# 零路由组必须为空
awk "/^export const RBAC_PERMISSION_DEFINITIONS/,/^\];/" src/modules/identity/access-control/rbac.catalog.ts \
  | grep -oE "'[A-Z_]+'" | tr -d "'" | grep -vE "^(GET|POST|PATCH|PUT|DELETE)$" | sort -u > /tmp/r_after.txt
comm -23 /tmp/g_after.txt /tmp/r_after.txt
```
预期：无输出（每个存活的组都至少守一条路由）

- [ ] **Step 9：随手闸 + jest + 提交**

```bash
cd Exchange_js
npx tsc --noEmit -p tsconfig.json
cd admin-web && npx tsc -b --noEmit && cd ..
npx jest src/modules/identity/access-control src/modules/governance/approvals
```
预期：净新失败 0（对照 `doc-final/demo/baseline.md` 的已知红名单）

```bash
git add src admin-web/src
git commit -m "refactor(rbac): 退役 30 个权限组与 15 条幽灵路由——裁决权交还审批策略"
```

---

## Task 5：审计词条进退役拒写名册

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `src/modules/audit-logging/constants/audit-vocabulary-closure.spec.ts`（仅在其附册快照需同步时）

**Interfaces:**
- Consumes: Task 1/2 已删除的写点
- Produces: 约 44 个词条从 live 表移入退役名册；`verify:audit` 与封册 spec 仍绿

- [ ] **Step 1：列出待退役词条**

```bash
cd Exchange_js
grep -oE "^\s+[A-Z_]+:" src/modules/audit-logging/constants/audit-actions.constant.ts | tr -d ' :' \
  | grep -E "SHAREHOLDING|APPOINTMENT_RECORD|TRAINING_RECORD|CONFLICT_DISCLOSURE|WIND_DOWN|REGULATORY_GATE|LIQUIDITY" | sort -u
```

- [ ] **Step 2：按站 7 既有范式移入退役名册**

照文件里已有的退役写法（`:430-475` 那批 `// C1 — Admin Invite：已退役，...` 的形态）处理：从 live 词表移出、在退役名册登记、保留注释说明退役原因与日期。**不直接删键**——封册守则要求「平面表每键有籍」。注释统一用：

```
// 2026-08-30：随五本档案簿 / 监管闸门 / 对手方整块退役（第一幕职权重划），写点已删
```

- [ ] **Step 3：跑封册 spec 与审计校验器**

```bash
cd Exchange_js
npx jest src/modules/audit-logging/constants/audit-vocabulary-closure.spec.ts
```
预期：PASS

```bash
bash scripts/on-stack.sh self verify:audit
```
预期：恒绿七项不退步（对照 `doc-final/demo/baseline.md`）

- [ ] **Step 4：提交**

```bash
git add src/modules/audit-logging
git commit -m "chore(audit): 档案簿/闸门/对手方词条进退役拒写名册——封册守则不破"
```

---

## Task 6：段一收尾闸（重铺 + 全量走查）

**Files:** 无代码改动；产出为验证记录

**Interfaces:**
- Consumes: Task 1–5 全部
- Produces: 一份可对照 `doc-final/demo/baseline.md` 的实跑结论；后续段二在此干净库上开工

- [ ] **Step 1：从零重铺**

```bash
cd Exchange_js
bash scripts/stack.sh reset
```
预期：含 TigerBeetle 清理重建，无报错退出。

- [ ] **Step 2：全量造数**

```bash
bash scripts/on-stack.sh self demo:all
```
预期：花名册 21 笔逐条 `✓`，COA 四恒等式通过。**任何一笔与预期终态不符即停**——那说明退役删多了，改代码，不改脚本。

- [ ] **Step 3：账务与对账回归**

```bash
bash scripts/on-stack.sh self verify:coa
bash scripts/on-stack.sh self recon:demo:pass
bash scripts/on-stack.sh self recon:demo:break
```
预期：`verify:coa` 两恒等式 + 无负余额；`pass` 全绿；`break` 检出 9/9。

- [ ] **Step 4：三个 tsc + 全量 jest**

```bash
npx tsc --noEmit -p tsconfig.json
cd admin-web && npx tsc -b --noEmit && cd ..
cd client-web && npx tsc -b --noEmit && cd ..
npx jest
```
预期：tsc 三条无输出；jest 净新失败 = 0（基线四套 8 例仍红属已知）。

- [ ] **Step 5：截图存证**

起 preview，登录超管，逐页截图：`/admin` 首页（占位、零 404）、侧栏（无档案簿/对手方两档）、角色详情页（此刻仍是 6 个域，段二才铺满）。

- [ ] **Step 6：记账并提交**

在 `doc-final/CHANGELOG.md` 追加一行：

```markdown
- [2026-08-30] **第一幕退役段**：五本档案簿 / 监管闸门 / 对手方三块整体退役（约 1 万行 + 9 表），30 个死权限组与 15 条幽灵路由清空，管理台首页从两个 404 换成空白占位；审批裁决权交还审批策略（不再有第二道会漂的权限闸）
```

```bash
git add doc-final/CHANGELOG.md
git commit -m "docs(CHANGELOG): 第一幕退役段收尾"
```

---

# 段二 · 权限重建

## Task 7：新增 12 个权限组并按动作改挂路由

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`

**Interfaces:**
- Consumes: Task 4 的终盘（50 个组）
- Produces: `PermissionGroup` 联合类型**新增 11 个**成员，供 Task 8 的桶目录与 Task 9 的角色绑定引用：
  `FUNDS_ORDER_VIEW` `FUNDS_ORDER_ACT` `DEMO_VERDICT_WRITE` `DEPOSIT_WAIVE_WRITE` `DEPOSIT_CONFISCATE_WRITE` `DEPOSIT_RETURN_WRITE` `DEPOSIT_SEIZE_WRITE` `DEPOSIT_UNFREEZE_WRITE` `WITHDRAW_BOUNCE_WRITE` `WITHDRAW_REFUND_WRITE` `WITHDRAW_UNFREEZE_WRITE`
  **改名 2 个**：`RISK_DECISION_RECORD_READ` → `SUMSUB_EVENT_VIEW`，`SIMULATE_EXPIRED_WRITE` → `DEMO_CLOCK_WRITE`
  终盘 50 + 11 = **61 个组**

- [ ] **Step 1：联合类型加 11 个新成员 + 改名 2 个**

在 `PermissionGroup` 里新增上述 11 个；把 `'RISK_DECISION_RECORD_READ'` 整体改名为 `'SUMSUB_EVENT_VIEW'`（联合类型 + `GET /admin/sumsub-events` 那条路由注册），把 `'SIMULATE_EXPIRED_WRITE'` 整体改名为 `'DEMO_CLOCK_WRITE'`。改完核对：

```bash
awk '/^export type PermissionGroup/,/;/' src/modules/identity/access-control/rbac.catalog.ts \
  | grep -oE "'[A-Z_]+'" | tr -d "'" | sort -u | wc -l
```
预期：`61`

- [ ] **Step 2：资金单五条路由按看/推拆开（解 B3）**

`rbac.catalog.ts:639-644` 改为：

```typescript
route('GET', '/admin/funds-orders', 'List funds orders', ['FUNDS_ORDER_VIEW']),
route('GET', '/admin/funds-orders/:fundsOrderNo', 'Get funds order detail', ['FUNDS_ORDER_VIEW']),
route('POST', '/admin/funds-orders/:fundsOrderNo/advance', 'Advance funds order (sim/ops)', ['FUNDS_ORDER_ACT']),
route('POST', '/admin/funds-orders/:fundsOrderNo/push/sync', 'Push order — sync from external receipt (recon disposition)', ['FUNDS_ORDER_ACT']),
route('POST', '/admin/funds-orders/:fundsOrderNo/push/manual', 'Push order — manual confirm with evidence (recon disposition)', ['FUNDS_ORDER_ACT']),
```

同步：`admin-web/src/rbac/permissions.ts` 里 `FUNDS_ORDERS_READ` 常量指向的权限码不变（它是 `api.get.admin_funds_orders`，按路由推导，无需改）；若资金单详情页有推单按钮，其权限判定改成 `FUNDS_ORDER_ACT` 对应的码。

- [ ] **Step 3：充值域五条动作路由各挂各的组**

```typescript
route('POST', '/deposit-transactions/:id/waive-limit', 'Waive deposit below-minimum amount hold', ['DEPOSIT_WAIVE_WRITE']),
route('POST', '/deposit-transactions/:id/confiscate', 'Confiscate deposit below-minimum amount as fee', ['DEPOSIT_CONFISCATE_WRITE']),
route('POST', '/deposit-transactions/:id/return', 'Open a return-to-sender approval for a deposit', ['DEPOSIT_RETURN_WRITE']),
route('POST', '/deposit-transactions/:id/seize', 'Seize a frozen deposit under government order', ['DEPOSIT_SEIZE_WRITE']),
route('POST', '/deposit-transactions/:id/unfreeze', 'Unfreeze a frozen deposit', ['DEPOSIT_UNFREEZE_WRITE']),
```

- [ ] **Step 4：提现域三条动作路由各挂各的组**

```typescript
route('POST', '/withdraw-transactions/:id/bounce', 'Bounce (return) withdraw transaction payout', ['WITHDRAW_BOUNCE_WRITE']),
route('POST', '/withdraw-transactions/:id/unfreeze', 'Unfreeze a FROZEN withdraw transaction', ['WITHDRAW_UNFREEZE_WRITE']),
route('POST', '/withdraw-transactions/:id/refund', 'Sanction-refund a FROZEN withdraw transaction', ['WITHDRAW_REFUND_WRITE']),
```

建单类三条（`POST /withdraw-transactions`、`.../quotes`、`.../mock`）**保留** `TRADING_WITHDRAW_WRITE`。

- [ ] **Step 5：⚡ 与拨时钟改挂演示专用组**

```typescript
route('POST', '/admin/deposit-sumsub/demo/run-verdict', 'Feed one Sumsub KYT verdict webhook into a deposit (demo only)', ['DEMO_VERDICT_WRITE']),
route('POST', '/admin/withdraw-sumsub/demo/run-verdict', 'Feed one Sumsub KYT verdict webhook into a withdrawal (demo only)', ['DEMO_VERDICT_WRITE']),
route('POST', '/admin/swap-sumsub/demo/run-verdict', 'Feed one Sumsub KYT verdict webhook into a swap (demo only)', ['DEMO_VERDICT_WRITE']),
route('POST', '/deposit-transactions/:depositNo/simulate-sla-timeout', 'Simulate SLA timeout for a deposit (demo only)', ['DEMO_CLOCK_WRITE']),
route('POST', '/withdraw-transactions/:withdrawNo/simulate-sla-timeout', 'Simulate SLA timeout for a withdraw transaction (demo only)', ['DEMO_CLOCK_WRITE']),
route('POST', '/admin/swap-transactions/:swapNo/simulate-sla-timeout', 'Simulate SLA timeout for a swap transaction (demo only)', ['DEMO_CLOCK_WRITE']),
route('POST', '/admin/compliance/customers/:id/simulate-expired', 'Simulate customer expired', ['DEMO_CLOCK_WRITE']),
```

三条 `demo/verdict-buttons` 保持挂各自域的 `TRADING_*_READ`（读按钮清单是看的动作）。

⚠️ `DEMO_CLOCK_WRITE` **是 `SIMULATE_EXPIRED_WRITE` 的改名，不是新组**——后者本就守着 `simulate-expired` 那条路由，改名后一并接管三域 SLA 模拟。联合类型里把 `'SIMULATE_EXPIRED_WRITE'` 整体改成 `'DEMO_CLOCK_WRITE'`，不要「新增一个 + 退役一个」。

- [ ] **Step 6：客户侧两条路由保持原样**

`POST /deposit-transactions/my/inbound-signals` 与 `.../scan` **继续挂 `TRADING_DEPOSIT_WRITE`**。该组不进桶目录、不进任何角色 bindings——它不是管理端能力。这不违反 B1（B1 禁的是「有绑定无桶」，不是「有路由无桶」）。在这两条 `route(...)` 上方加注释说明，防后人误清。

- [ ] **Step 7：随手闸 + 提交**

```bash
cd Exchange_js && npx tsc --noEmit -p tsconfig.json
git add src/modules/identity/access-control/rbac.catalog.ts
git commit -m "feat(rbac): 交易域按动作拆包、资金单看推分离、⚡ 单列演示组"
```

---

## Task 8：重写 `ACTION_BUCKET_CATALOG`（12 域 50 桶）

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（`ACTION_BUCKET_CATALOG`）

**Interfaces:**
- Consumes: Task 7 的 12 个新组与 1 个改名组
- Produces: 12 个 `ActionDomain`，**每个域的 `buckets` 数组都非空**；Task 9 的角色绑定所引用的每个组都能在此找到归宿

- [ ] **Step 1：删 4 个退役域**

从数组中删除 `{ id: 'config', ... }`、`{ id: 'clearing', ... }`、`{ id: 'gov_registry', ... }`、`{ id: 'counterparty', ... }` 四个空壳。

- [ ] **Step 2：账本域去掉「开科目」桶**

`accounting` 域的 `buckets` 删掉 `{ key: 'ledger.manage_accounts', ... }`，剩三个 view 桶。

- [ ] **Step 3：新增 6 个域（customer / trading / funds / recon / pricing / demo）**

在 `treasury` 域之后插入：

```typescript
  {
    id: 'customer',
    label: 'Customer Management',
    icon: '👥',
    buckets: [
      {
        key: 'customer.view',
        label: 'View customers',
        description: 'Browse customer list, detail, tags and restrictions',
        groups: ['CUSTOMER_READ', 'CUSTOMER_RESTRICTION_READ', 'CUSTOMER_TAG_VIEW'],
      },
      {
        key: 'customer.manage_profile',
        label: 'Manage profile & tags',
        description: 'Edit customer profile fields and attach/detach tags',
        groups: ['CUSTOMER_WRITE', 'CUSTOMER_TAG_MANAGE'],
      },
      {
        key: 'customer.act_restrict',
        label: 'Open restrictions',
        description: 'Place a restriction on a customer (sanction, administrative)',
        groups: ['CUSTOMER_RESTRICTION_WRITE'],
      },
      {
        key: 'customer.act_release',
        label: 'Release restrictions',
        description: 'Request release of an existing restriction — deliberately split from opening one',
        groups: ['CUSTOMER_RESTRICTION_RELEASE'],
      },
    ],
  },
  {
    id: 'trading',
    label: 'Trading',
    icon: '📊',
    buckets: [
      { key: 'trading.view_deposit', label: 'View deposits', description: 'Browse deposit orders and detail', groups: ['TRADING_DEPOSIT_READ'] },
      { key: 'trading.view_withdraw', label: 'View withdrawals', description: 'Browse withdrawal orders and detail', groups: ['TRADING_WITHDRAW_READ'] },
      { key: 'trading.view_swap', label: 'View swaps', description: 'Browse swap orders, quotes and detail', groups: ['TRADING_SWAP_READ'] },
      { key: 'trading.view_sumsub_events', label: 'View Sumsub callbacks', description: 'Browse the inbound Sumsub webhook event log and where each was dispatched', groups: ['SUMSUB_EVENT_VIEW'] },
      { key: 'trading.act_deposit_waive', label: 'Release below-minimum holds', description: 'Waive a below-minimum deposit hold — executes immediately, no approval', groups: ['DEPOSIT_WAIVE_WRITE'] },
      { key: 'trading.act_deposit_confiscate', label: 'Request deposit confiscation', description: 'Open a confiscation approval — the money becomes firm revenue', groups: ['DEPOSIT_CONFISCATE_WRITE'] },
      { key: 'trading.act_deposit_return', label: 'Request return to sender', description: 'Open a return-to-sender approval', groups: ['DEPOSIT_RETURN_WRITE'] },
      { key: 'trading.act_deposit_seize', label: 'Request seizure', description: 'Open a seizure approval under government order', groups: ['DEPOSIT_SEIZE_WRITE'] },
      { key: 'trading.act_deposit_unfreeze', label: 'Request deposit unfreeze', description: 'Open an unfreeze approval — compliance line only, never operations', groups: ['DEPOSIT_UNFREEZE_WRITE'] },
      { key: 'trading.act_withdraw_create', label: 'Create withdrawals & quotes', description: 'Raise withdrawal orders and pricing quotes', groups: ['TRADING_WITHDRAW_WRITE'] },
      { key: 'trading.act_withdraw_bounce', label: 'Bounce payouts', description: 'Mark a payout as returned by the bank — executes immediately', groups: ['WITHDRAW_BOUNCE_WRITE'] },
      { key: 'trading.act_withdraw_refund', label: 'Request sanction refund', description: 'Open a sanction-refund approval on a frozen withdrawal', groups: ['WITHDRAW_REFUND_WRITE'] },
      { key: 'trading.act_withdraw_unfreeze', label: 'Request withdrawal unfreeze', description: 'Open an unfreeze approval — compliance line only, never operations', groups: ['WITHDRAW_UNFREEZE_WRITE'] },
      { key: 'trading.act_swap', label: 'Handle swaps', description: 'Raise and progress swap orders', groups: ['TRADING_SWAP_WRITE'] },
    ],
  },
  {
    id: 'funds',
    label: 'Funds Orders',
    icon: '🚚',
    buckets: [
      { key: 'funds.view', label: 'View funds orders', description: 'Browse the physical transfer mirror of every order', groups: ['FUNDS_ORDER_VIEW'] },
      { key: 'funds.act_push', label: 'Push funds orders', description: 'Advance or push a funds order leg — seeing one is not moving one', groups: ['FUNDS_ORDER_ACT'] },
    ],
  },
  {
    id: 'recon',
    label: 'Reconciliation',
    icon: '🔍',
    buckets: [
      { key: 'recon.view', label: 'View runs, cases & balances', description: 'Browse reconciliation runs, cases and external balances', groups: ['RECON_RUN_READ', 'RECON_CASE_READ', 'RECON_EXTERNAL_BALANCE_READ'] },
      { key: 'recon.act_run', label: 'Trigger reconciliation runs', description: 'Kick off a per-wallet reconciliation run', groups: ['RECON_RUN_WRITE'] },
    ],
  },
  {
    id: 'pricing',
    label: 'Pricing',
    icon: '💰',
    buckets: [
      { key: 'pricing.view', label: 'View fee levels', description: 'Browse withdrawal and swap fee levels', groups: ['WITHDRAWAL_FEE_LEVEL_READ', 'SWAP_FEE_LEVEL_READ'] },
      { key: 'pricing.manage', label: 'Manage fee levels', description: 'Raise fee level creation and change requests — operations signs them off', groups: ['WITHDRAWAL_FEE_LEVEL_WRITE', 'SWAP_FEE_LEVEL_WRITE'] },
    ],
  },
  {
    id: 'demo',
    label: 'Demo Instruments',
    icon: '⚡',
    buckets: [
      { key: 'demo.act_verdict', label: 'Feed compliance verdicts', description: 'Stand in for the Sumsub console — the only way a compliance officer moves an order', groups: ['DEMO_VERDICT_WRITE'] },
      { key: 'demo.act_clock', label: 'Fast-forward clocks', description: 'Trip SLA timers and material expiry for demonstration', groups: ['DEMO_CLOCK_WRITE'] },
    ],
  },
```

- [ ] **Step 4：机器验证「有绑定无桶」为 0**

```bash
cd Exchange_js
awk "/^export const ACTION_BUCKET_CATALOG/,/^\];/" src/modules/identity/access-control/rbac.catalog.ts \
  | grep -oE "'[A-Z_]+'" | tr -d "'" | sort -u > /tmp/bucket_groups.txt
awk "/^export const RBAC_ROLE_GROUP_BINDINGS/,/^\};/" src/modules/identity/access-control/rbac.catalog.ts \
  | grep -oE "'[A-Z_]+'" | tr -d "'" | sort -u > /tmp/binding_groups.txt
comm -23 /tmp/binding_groups.txt /tmp/bucket_groups.txt
```
预期：**无输出**。这是本任务的硬判据（spec §1.2.1）。此刻 bindings 还是 Task 4 减法后的旧内容，Task 9 改完后要再跑一次。

- [ ] **Step 5：验证每个域都非空**

```bash
awk "/^export const ACTION_BUCKET_CATALOG/,/^\];/" src/modules/identity/access-control/rbac.catalog.ts | grep -c "buckets: \[\]"
```
预期：`0`

- [ ] **Step 6：随手闸 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/modules/identity/access-control/rbac.catalog.ts
git commit -m "feat(rbac): 权限包目录重划 12 域 50 桶——空域清零，每个绑定都有桶收着"
```

---

## Task 9：11 个职务定义与开箱权限

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（`RBAC_ROLE_DEFINITIONS` / `PRIMARY_ROLE_PRIORITY` / `HARD_MUTEX_ROLE_PAIRS` / `RBAC_ROLE_GROUP_BINDINGS`）

**Interfaces:**
- Consumes: Task 8 的桶目录（每个组都有桶）
- Produces: 11 个角色码 `SUPER_ADMIN` `SENIOR_MANAGEMENT_OFFICER` `CISO` `MLRO` `DPO` `INTERNAL_AUDITOR` `COMPLIANCE_OFFICER` `CFO` `TREASURY_OFFICER` `TECH_OFFICER` `OPS_OFFICER`，供 Task 10 的种子与 Task 11 的审批策略引用

- [ ] **Step 1：`RBAC_ROLE_DEFINITIONS` 加 3 个职务**

```typescript
  {
    code: 'INTERNAL_AUDITOR',
    name: 'Internal Auditor',
    description: 'Independent read-only oversight across every domain. Holds no manage or act capability by design.',
  },
  {
    code: 'CFO',
    name: 'Chief Financial Officer',
    description: 'Owns pricing, reads the ledger and reconciliation, signs off on deposit confiscation.',
  },
  {
    code: 'TREASURY_OFFICER',
    name: 'Treasury Officer',
    description: 'Owns where the money sits: custodian wallets, customer receiving accounts and withdrawal addresses.',
  },
```

`PRIMARY_ROLE_PRIORITY` 整体替换为（新三个按「监管问责 > 合规 > 财务 > 业务」插在现有序列里，现有八个的相对次序一字不动）：

```typescript
export const PRIMARY_ROLE_PRIORITY = [
  'SUPER_ADMIN',
  'CISO',
  'DPO',
  'MLRO',
  'INTERNAL_AUDITOR',
  'COMPLIANCE_OFFICER',
  'SENIOR_MANAGEMENT_OFFICER',
  'CFO',
  'TECH_OFFICER',
  'TREASURY_OFFICER',
  'OPS_OFFICER',
] as const;
```

- [ ] **Step 2：硬互斥不变**

`HARD_MUTEX_ROLE_PAIRS` 保持 `['MLRO','OPS_OFFICER']` `['CISO','OPS_OFFICER']` `['CISO','MLRO']` 三对，不新增——三个新职务与安全线/动钱线均无重叠。

- [ ] **Step 3：`RBAC_ROLE_GROUP_BINDINGS` 整体重写**

```typescript
export const RBAC_ROLE_GROUP_BINDINGS: Record<string, PermissionGroup[]> = {
  SUPER_ADMIN: [],

  SENIOR_MANAGEMENT_OFFICER: [
    'BASE_ACCESS',
    'IAM_MEMBER_READ', 'IAM_ROLE_READ',
    'GOV_APPROVAL_READ', 'GOV_APPROVAL_POLICY_READ', 'GOV_APPROVAL_POLICY_WRITE',
    'AUDIT_READ', 'AUDIT_EXPORT_READ',
    'LEDGER_ACCOUNT_READ', 'LEDGER_EVIDENCE_READ', 'LEDGER_FLOW_READ',
    'ASSET_CONFIG_READ', 'WALLET_READ', 'WITHDRAWAL_ADDRESS_READ', 'TRANSACTION_LIMIT_READ',
    'CUSTOMER_READ', 'CUSTOMER_RESTRICTION_READ', 'CUSTOMER_TAG_VIEW',
    'TRADING_DEPOSIT_READ', 'TRADING_WITHDRAW_READ', 'TRADING_SWAP_READ', 'SUMSUB_EVENT_VIEW',
    'FUNDS_ORDER_VIEW',
    'RECON_RUN_READ', 'RECON_CASE_READ', 'RECON_EXTERNAL_BALANCE_READ',
    'WITHDRAWAL_FEE_LEVEL_READ', 'SWAP_FEE_LEVEL_READ',
  ],

  CISO: [
    'BASE_ACCESS',
    'IAM_MEMBER_READ', 'IAM_ROLE_READ', 'IAM_MEMBER_MANAGE', 'IAM_ROLE_ASSIGN',
    'IAM_ROLE_DEFINE', 'IAM_CREDENTIAL_RESET',
    'GOV_APPROVAL_READ', 'GOV_APPROVAL_POLICY_READ', 'GOV_APPROVAL_POLICY_WRITE',
    'AUDIT_READ', 'AUDIT_EXPORT_READ',
    'ASSET_CONFIG_READ', 'TRANSACTION_LIMIT_READ',
  ],

  MLRO: [
    'BASE_ACCESS',
    'IAM_MEMBER_READ', 'IAM_ROLE_READ',
    'GOV_APPROVAL_READ', 'GOV_APPROVAL_POLICY_READ',
    'AUDIT_READ', 'AUDIT_EXPORT_READ',
    'CUSTOMER_READ', 'CUSTOMER_RESTRICTION_READ', 'CUSTOMER_TAG_VIEW',
    'CUSTOMER_RESTRICTION_WRITE', 'CUSTOMER_RESTRICTION_RELEASE',
    'TRADING_DEPOSIT_READ', 'TRADING_WITHDRAW_READ', 'TRADING_SWAP_READ', 'SUMSUB_EVENT_VIEW',
    'FUNDS_ORDER_VIEW',
    'TRANSACTION_LIMIT_READ',
  ],

  DPO: [
    'BASE_ACCESS',
    'IAM_MEMBER_READ', 'IAM_ROLE_READ',
    'GOV_APPROVAL_READ', 'GOV_APPROVAL_POLICY_READ',
    'AUDIT_READ', 'AUDIT_EXPORT_READ', 'AUDIT_EXPORT_CREATE',
    'CUSTOMER_READ', 'CUSTOMER_RESTRICTION_READ', 'CUSTOMER_TAG_VIEW',
  ],

  // 全域只读 + 建证据包；一个 manage / act 包都不给 —— 这是本职务的全部意义
  INTERNAL_AUDITOR: [
    'BASE_ACCESS',
    'IAM_MEMBER_READ', 'IAM_ROLE_READ',
    'GOV_APPROVAL_READ', 'GOV_APPROVAL_POLICY_READ',
    'AUDIT_READ', 'AUDIT_EXPORT_READ', 'AUDIT_EXPORT_CREATE',
    'LEDGER_ACCOUNT_READ', 'LEDGER_EVIDENCE_READ', 'LEDGER_FLOW_READ',
    'ASSET_CONFIG_READ', 'WALLET_READ', 'WITHDRAWAL_ADDRESS_READ', 'TRANSACTION_LIMIT_READ',
    'CUSTOMER_READ', 'CUSTOMER_RESTRICTION_READ', 'CUSTOMER_TAG_VIEW',
    'TRADING_DEPOSIT_READ', 'TRADING_WITHDRAW_READ', 'TRADING_SWAP_READ', 'SUMSUB_EVENT_VIEW',
    'FUNDS_ORDER_VIEW',
    'RECON_RUN_READ', 'RECON_CASE_READ', 'RECON_EXTERNAL_BALANCE_READ',
    'WITHDRAWAL_FEE_LEVEL_READ', 'SWAP_FEE_LEVEL_READ',
  ],

  // 拦的手：开/解限制、贴撕标签、提解冻；管理台里推不动任何交易单据（D-不翻案）
  COMPLIANCE_OFFICER: [
    'BASE_ACCESS',
    'IAM_MEMBER_READ', 'IAM_ROLE_READ',
    'GOV_APPROVAL_READ',
    'AUDIT_READ', 'AUDIT_EXPORT_READ', 'AUDIT_EXPORT_CREATE',
    'CUSTOMER_READ', 'CUSTOMER_RESTRICTION_READ', 'CUSTOMER_TAG_VIEW',
    'CUSTOMER_WRITE', 'CUSTOMER_TAG_MANAGE',
    'CUSTOMER_RESTRICTION_WRITE', 'CUSTOMER_RESTRICTION_RELEASE',
    'TRADING_DEPOSIT_READ', 'TRADING_WITHDRAW_READ', 'TRADING_SWAP_READ', 'SUMSUB_EVENT_VIEW',
    'DEPOSIT_UNFREEZE_WRITE', 'WITHDRAW_UNFREEZE_WRITE',
    'DEMO_VERDICT_WRITE',
    'ASSET_CONFIG_READ', 'WITHDRAWAL_ADDRESS_READ', 'TRANSACTION_LIMIT_READ',
    'RECON_RUN_READ', 'RECON_CASE_READ', 'RECON_EXTERNAL_BALANCE_READ',
  ],

  CFO: [
    'BASE_ACCESS',
    'IAM_MEMBER_READ', 'IAM_ROLE_READ',
    'GOV_APPROVAL_READ',
    'AUDIT_READ',
    'LEDGER_ACCOUNT_READ', 'LEDGER_EVIDENCE_READ', 'LEDGER_FLOW_READ',
    'ASSET_CONFIG_READ', 'WALLET_READ', 'TRANSACTION_LIMIT_READ',
    'TRADING_DEPOSIT_READ', 'TRADING_WITHDRAW_READ', 'TRADING_SWAP_READ',
    'FUNDS_ORDER_VIEW',
    'RECON_RUN_READ', 'RECON_CASE_READ', 'RECON_EXTERNAL_BALANCE_READ',
    'WITHDRAWAL_FEE_LEVEL_READ', 'SWAP_FEE_LEVEL_READ',
    'WITHDRAWAL_FEE_LEVEL_WRITE', 'SWAP_FEE_LEVEL_WRITE',
  ],

  TREASURY_OFFICER: [
    'BASE_ACCESS',
    'IAM_MEMBER_READ', 'IAM_ROLE_READ',
    'GOV_APPROVAL_READ',
    'AUDIT_READ',
    'LEDGER_ACCOUNT_READ', 'LEDGER_EVIDENCE_READ', 'LEDGER_FLOW_READ',
    'ASSET_CONFIG_READ',
    'WALLET_READ', 'WALLET_WRITE',
    'WITHDRAWAL_ADDRESS_READ', 'WITHDRAWAL_ADDRESS_WRITE',
    'FUNDS_ORDER_VIEW',
  ],

  TECH_OFFICER: [
    'BASE_ACCESS',
    'IAM_MEMBER_READ', 'IAM_ROLE_READ', 'IAM_MEMBER_MANAGE',
    'IAM_ROLE_DEFINE', 'IAM_CREDENTIAL_RESET',
    'GOV_APPROVAL_READ', 'GOV_APPROVAL_POLICY_READ',
    'AUDIT_READ', 'AUDIT_EXPORT_READ',
    'LEDGER_ACCOUNT_READ', 'LEDGER_EVIDENCE_READ', 'LEDGER_FLOW_READ',
    'ASSET_CONFIG_READ', 'ASSET_CONFIG_WRITE',
    'WALLET_READ', 'WITHDRAWAL_ADDRESS_READ', 'TRANSACTION_LIMIT_READ',
    'SUMSUB_EVENT_VIEW',
    'FUNDS_ORDER_VIEW',
    'RECON_RUN_READ', 'RECON_CASE_READ', 'RECON_EXTERNAL_BALANCE_READ',
    'WITHDRAWAL_FEE_LEVEL_READ', 'SWAP_FEE_LEVEL_READ',
  ],

  // 动钱的手 —— 唯独没有任何 *_UNFREEZE_WRITE（业主 2026-08-30 定）
  OPS_OFFICER: [
    'BASE_ACCESS',
    'IAM_MEMBER_READ', 'IAM_ROLE_READ',
    'GOV_APPROVAL_READ',
    'AUDIT_READ',
    'LEDGER_ACCOUNT_READ', 'LEDGER_EVIDENCE_READ', 'LEDGER_FLOW_READ',
    'ASSET_CONFIG_READ', 'WALLET_READ', 'WITHDRAWAL_ADDRESS_READ',
    'TRANSACTION_LIMIT_READ', 'TRANSACTION_LIMIT_WRITE',
    'CUSTOMER_READ', 'CUSTOMER_RESTRICTION_READ', 'CUSTOMER_TAG_VIEW',
    'TRADING_DEPOSIT_READ', 'TRADING_WITHDRAW_READ', 'TRADING_SWAP_READ', 'SUMSUB_EVENT_VIEW',
    'DEPOSIT_WAIVE_WRITE', 'DEPOSIT_CONFISCATE_WRITE', 'DEPOSIT_RETURN_WRITE', 'DEPOSIT_SEIZE_WRITE',
    'TRADING_WITHDRAW_WRITE', 'WITHDRAW_BOUNCE_WRITE', 'WITHDRAW_REFUND_WRITE',
    'TRADING_SWAP_WRITE',
    'FUNDS_ORDER_VIEW', 'FUNDS_ORDER_ACT',
    'RECON_RUN_READ', 'RECON_CASE_READ', 'RECON_EXTERNAL_BALANCE_READ', 'RECON_RUN_WRITE',
    'WITHDRAWAL_FEE_LEVEL_READ', 'SWAP_FEE_LEVEL_READ',
    'DEMO_CLOCK_WRITE',
  ],
};
```

- [ ] **Step 4：再跑一次「有绑定无桶」判据**

```bash
cd Exchange_js
awk "/^export const ACTION_BUCKET_CATALOG/,/^\];/" src/modules/identity/access-control/rbac.catalog.ts \
  | grep -oE "'[A-Z_]+'" | tr -d "'" | sort -u > /tmp/bucket_groups.txt
awk "/^export const RBAC_ROLE_GROUP_BINDINGS/,/^\};/" src/modules/identity/access-control/rbac.catalog.ts \
  | grep -oE "'[A-Z_]+'" | tr -d "'" | sort -u > /tmp/binding_groups.txt
comm -23 /tmp/binding_groups.txt /tmp/bucket_groups.txt
```
预期：**无输出**

- [ ] **Step 5：随手闸 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/identity/access-control
git add src/modules/identity/access-control/rbac.catalog.ts
git commit -m "feat(rbac): 11 个职务重定开箱权限——运营手里没有任何解冻包"
```

---

## Task 10：种子扩到 11 个职务账号

**Files:**
- Modify: `prisma/seed.base.ts`（`ROLE_SEED_ACCOUNTS`，`:27-36`）

**Interfaces:**
- Consumes: Task 9 的 11 个角色码
- Produces: 11 个可登录账号，供 Task 13 的验收脚本与第一幕现场演示使用：
  `admin@` `sm@` `ciso@` `mlro@` `dpo@` `auditor@` `compliance_lead@` `cfo@` `treasury@` `tech_admin@` `ops_officer@`（域名 `fiatx.com`，密码统一 `123456`）

- [ ] **Step 1：加 3 个账号**

```typescript
const ROLE_SEED_ACCOUNTS: RoleSeedAccount[] = [
  { roleCode: 'SUPER_ADMIN', email: 'admin@fiatx.com', userNo: 'ADM2501010001' },
  { roleCode: 'SENIOR_MANAGEMENT_OFFICER', email: 'sm@fiatx.com', userNo: 'ADM2501010002' },
  { roleCode: 'CISO', email: 'ciso@fiatx.com', userNo: 'ADM2501010003' },
  { roleCode: 'MLRO', email: 'mlro@fiatx.com', userNo: 'ADM2501010004' },
  { roleCode: 'DPO', email: 'dpo@fiatx.com', userNo: 'ADM2501010005' },
  { roleCode: 'COMPLIANCE_OFFICER', email: 'compliance_lead@fiatx.com', userNo: 'ADM2501010006' },
  { roleCode: 'TECH_OFFICER', email: 'tech_admin@fiatx.com', userNo: 'ADM2501010007' },
  { roleCode: 'OPS_OFFICER', email: 'ops_officer@fiatx.com', userNo: 'ADM2501010008' },
  { roleCode: 'INTERNAL_AUDITOR', email: 'auditor@fiatx.com', userNo: 'ADM2501010009' },
  { roleCode: 'CFO', email: 'cfo@fiatx.com', userNo: 'ADM2501010010' },
  { roleCode: 'TREASURY_OFFICER', email: 'treasury@fiatx.com', userNo: 'ADM2501010011' },
];
```

- [ ] **Step 2：重铺并核实 11 个账号都能登录**

```bash
cd Exchange_js
bash scripts/stack.sh reset
for e in admin sm ciso mlro dpo auditor compliance_lead tech_admin ops_officer cfo treasury; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:$(grep API .stackports | cut -d= -f2)/auth/login \
    -H 'Content-Type: application/json' -d "{\"email\":\"$e@fiatx.com\",\"password\":\"123456\"}")
  echo "$e -> $code"
done
```
预期：11 行全部 `-> 201`（或 `200`，以本仓库登录端点实际返回为准）

> ⚠️ 新增 admin 端点或角色后 SUPER_ADMIN 权限走内存定义，**改完必须重启后端**，只 seed 不重启等于白费。

- [ ] **Step 3：提交**

```bash
git add prisma/seed.base.ts
git commit -m "feat(seed): 职务账号 8 → 11，新增内审/财务/金库"
```

---

## Task 11：审批策略改两处裁决人

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`

**Interfaces:**
- Consumes: Task 9 的 `CFO` 角色码
- Produces: `DEPOSIT_CONFISCATION` 由 `CFO` 单步裁决；`TRANSACTION_LIMIT_CREATION` / `TRANSACTION_LIMIT_CHANGE` 由 `SENIOR_MANAGEMENT_OFFICER` 单步裁决。Task 13 的验收依赖此改动

- [ ] **Step 1：没收改财务**

```typescript
  [ApprovalActionTypes.DEPOSIT_CONFISCATION]: {
    // 2026-08-30：裁决人 OPS_OFFICER → CFO。没收 = 客户的钱变公司收入，属财务事项；
    // 且发起人只能是运营（唯一持 DEPOSIT_CONFISCATE_WRITE 者），原配置构成自批死锁。
    steps: [{ stepNo: 1, roles: ['CFO'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
```
（`timeoutHours` / `allowCancel` 沿用该条目原值，不要改。）

- [ ] **Step 2：限额改高管**

`TRANSACTION_LIMIT_CREATION` 与 `TRANSACTION_LIMIT_CHANGE` 两条的 `steps` 均改为：

```typescript
    // 2026-08-30：裁决人 OPS_OFFICER → SENIOR_MANAGEMENT_OFFICER。限额归运营改（业主定），
    // 高管签字：定阈值与放超额单归同一人（大额提现本就是高管批）。
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
```

- [ ] **Step 3：机器验证「策略点名的每个职务都存在」**

```bash
cd Exchange_js
grep -oE "roles: \['[A-Z_]+'\]|roles: \['[A-Z_]+', '[A-Z_]+'\]" \
  src/modules/governance/approvals/constants/approval.constants.ts \
  | grep -oE "'[A-Z_]+'" | tr -d "'" | sort -u > /tmp/policy_roles.txt
grep -oE "code: '[A-Z_]+'" src/modules/identity/access-control/rbac.catalog.ts \
  | grep -oE "'[A-Z_]+'" | tr -d "'" | sort -u > /tmp/role_codes.txt
comm -23 /tmp/policy_roles.txt /tmp/role_codes.txt
```
预期：**无输出**（没有哪条策略点名了不存在的职务）

- [ ] **Step 4：随手闸 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/governance/approvals
git add src/modules/governance/approvals/constants/approval.constants.ts
git commit -m "feat(approvals): 没收改财务裁决、限额改高管裁决——解开两处自批死锁"
```

---

## Task 12：前端跟上权限终盘

**Files:**
- Modify: `admin-web/src/rbac/permissions.ts`
- Modify: `admin-web/src/components/SimulationPanel.tsx`（若其按钮显隐依赖 `TRADING_*_WRITE`）
- Modify: 资金单详情页推单按钮的权限判定（`admin-web/src/pages/` 下 funds-order 详情页）

**Interfaces:**
- Consumes: Task 7 的路由改挂结果（权限码由路由推导：`api.<method>.<path_snake>`）
- Produces: 管理台前端不再引用任何已退役权限常量

- [ ] **Step 1：清掉已退役常量**

删除 `permissions.ts` 中 `RISK_DECISION_RECORD_DETAIL_READ`（其端点已退役）以及任何指向 Task 4 已删路由的常量。

- [ ] **Step 2：⚡ 面板与资金单按钮改判定**

权限码由 `rbac.catalog.ts` 的 `route()` 经 `buildPermissionCode(method, path)` 生成，**路由路径不变则码不变**——Task 7 只换了 `groups`，没换 method/path，所以**前端已有的权限码常量全部无需改动**。

需要改的只有两处判定所引用的常量语义：
- `SimulationPanel.tsx` 若有显隐判定，改用 ⚡ 三条 run-verdict 路由对应的码（`grep -n "run_verdict" admin-web/src/rbac/permissions.ts` 确认常量是否已存在；不存在则按 `buildPermissionCode` 规则新增一个常量）
- 资金单详情页推单按钮改用 push/advance 三条路由对应的码

改完用运行时对照核实，不靠手写猜测：

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:<API 端口>/admin/iam/permissions \
  | python3 -m json.tool | grep -iE "run_verdict|funds_orders.*push|funds_orders.*advance"
```

- [ ] **Step 3：随手闸**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
```

- [ ] **Step 4：起 preview 截图验证**

登录 `ops_officer@` 与 `compliance_lead@` 各一次：
- 运营：充值详情页看得到放行/没收/退回/上缴按钮，**看不到解冻按钮**；⚡ 面板不可见
- 合规官：充值详情页**看不到任何处置按钮**，但**看得到解冻按钮与 ⚡ 面板**

两组截图都要留。

- [ ] **Step 5：提交**

```bash
git add admin-web/src
git commit -m "feat(admin): 前端权限常量跟上终盘——⚡ 归合规官、解冻不在运营手里"
```

---

## Task 13：`verify:rbac` 行为验收脚本

按 spec §7 的 V1–V9 写一个可重复跑的校验器，跟 `verify:audit` / `verify:coa` 同一范式。

**Files:**
- Create: `scripts/verify-rbac.ts`
- Modify: `package.json`（加 `verify:rbac` 脚本）

**Interfaces:**
- Consumes: `scripts/demo-mlro.ts → loginAs(apiBase, email, password?)`（已存在，返回 `access_token` 字符串）
- Produces: `npm run verify:rbac` 退出码 0 = 全过；非 0 = 打印第一条不符项

- [ ] **Step 1：写校验器骨架与探针表**

```typescript
// scripts/verify-rbac.ts
//
// 第一幕职权重划的行为验收（spec §7 V1–V9）。全部走真实登录 + 真实 HTTP，
// 不读源码文本 —— 本仓库有过「注释喂饱 toContain」的自证型绿灯前科。
import { loginAs } from './demo-mlro';

const API = process.env.API_BASE ?? 'http://localhost:3000';

type Probe = { name: string; method: 'GET' | 'POST'; path: string; body?: unknown };

// 每个探针配一张「谁应当通过」的名单；不在名单里的职务必须拿 403。
const PROBES: Array<Probe & { allow: string[] }> = [
  { name: '看成员', method: 'GET', path: '/users', allow: ['ALL'] },
  { name: '定义角色', method: 'GET', path: '/admin/iam/action-buckets', allow: ['ALL'] },
  { name: '看审计日志', method: 'GET', path: '/admin/audit-logs?take=1', allow: ['ALL'] },
  { name: '看资金单', method: 'GET', path: '/admin/funds-orders?take=1',
    allow: ['sm', 'mlro', 'auditor', 'cfo', 'treasury', 'tech_admin', 'ops_officer'] },
  { name: '看费率等级', method: 'GET', path: '/admin/trading/swap-fee-levels?take=1',
    allow: ['sm', 'auditor', 'cfo', 'ops_officer', 'tech_admin'] },
  { name: '看对账跑批', method: 'GET', path: '/admin/reconciliation/runs?take=1',
    allow: ['sm', 'auditor', 'compliance_lead', 'cfo', 'tech_admin', 'ops_officer'] },
];

const ACCOUNTS = [
  'sm', 'ciso', 'mlro', 'dpo', 'auditor',
  'compliance_lead', 'cfo', 'treasury', 'tech_admin', 'ops_officer',
];

async function probe(token: string, p: Probe): Promise<number> {
  const res = await fetch(`${API}${p.path}`, {
    method: p.method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: p.body ? JSON.stringify(p.body) : undefined,
  });
  return res.status;
}
```

- [ ] **Step 2：加 V9（内审只读）专项**

```typescript
// V9：内审对任何 Manage / Act 端点必须 403 —— 这是该职务存在的唯一理由。
const AUDITOR_MUST_BE_DENIED: Probe[] = [
  { name: '开限制', method: 'POST', path: '/admin/customers/CUS-NOT-EXIST/restrictions', body: {} },
  { name: '跑对账批次', method: 'POST', path: '/admin/reconciliation/runs/wallet', body: {} },
  { name: '推资金单', method: 'POST', path: '/admin/funds-orders/FO-NOT-EXIST/push/sync', body: {} },
  { name: '改费率', method: 'POST', path: '/admin/trading/swap-fee-levels', body: {} },
  { name: '建托管钱包', method: 'POST', path: '/admin/custodian-wallets', body: {} },
];
// 判据：状态码必须是 403。404/400 说明守卫放行了（只是业务层拒绝），算不通过。
```

- [ ] **Step 3：加 V6（运营碰不到解冻）与 V7（合规官推不动单据）专项**

```typescript
// V6：运营对两条 unfreeze 必须 403
const OPS_MUST_BE_DENIED: Probe[] = [
  { name: '充值解冻', method: 'POST', path: '/deposit-transactions/NOT-EXIST/unfreeze', body: {} },
  { name: '提现解冻', method: 'POST', path: '/withdraw-transactions/NOT-EXIST/unfreeze', body: {} },
];

// V7：合规官对三域处置必须 403，但 ⚡ 必须不是 403
const COMPLIANCE_MUST_BE_DENIED: Probe[] = [
  { name: '没收', method: 'POST', path: '/deposit-transactions/NOT-EXIST/confiscate', body: {} },
  { name: '提现退票', method: 'POST', path: '/withdraw-transactions/NOT-EXIST/bounce', body: {} },
  { name: '处置兑换', method: 'POST', path: '/admin/swap-transactions', body: {} },
];
const COMPLIANCE_MUST_PASS_GUARD: Probe[] = [
  { name: '⚡ 投递裁决', method: 'POST', path: '/admin/deposit-sumsub/demo/run-verdict', body: { depositId: 'NOT-EXIST', verdict: 'approved' } },
];
// ⚡ 判据：状态码 ≠ 403（404/400 都算守卫放行，这里只验权限闸不验业务）
```

- [ ] **Step 3b：加 V3（裁决只认审批策略）与 V4（资金单看推分离）**

```typescript
// V3：B2 的行为判据 —— 持 GOV_APPROVAL_READ 但策略未点名的职务，调 approve 必须被拒。
// 取一张 DEPOSIT_RETURN（策略点名 MLRO）的待审单：
//   treasury@ 登录 → POST /admin/control-gates/approvals/<id>/approve → 必须非 2xx
//   mlro@     登录 → 同一端点                                        → 必须 2xx
// 判据落在「同一张单、同一端点、换个人结果相反」，而不是读策略常量。

// V4：B3 的行为判据 —— 只持 FUNDS_ORDER_VIEW 的职务看得见、推不动。
const FUNDS_VIEW_ONLY = ['auditor', 'cfo', 'treasury', 'sm', 'mlro', 'tech_admin'];
// 对每个：GET /admin/funds-orders?take=1 必须 200
//         POST /admin/funds-orders/FO-NOT-EXIST/push/sync 必须 403
// ops_officer 反过来：push 必须 ≠ 403（404/400 都算守卫放行）
```

- [ ] **Step 4：加 V2（改角色不丢权限）**

```typescript
// V2：B1 的行为判据 —— 对每个内建角色跑一次「改角色」提交并批准，
// 比对前后 permissionCodes 集合逐一无丢失。
async function permissionCodesOf(token: string, roleId: string): Promise<string[]> {
  const res = await fetch(`${API}/admin/iam/role-definitions/${roleId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body: any = await res.json();
  return (body.permissionCodes ?? []).slice().sort();
}
// 流程：技术官登录 → 取角色详情记下 before → POST .../modify（原样提交同一批 buckets）
//      → CISO 登录批准 → 再取详情记 after → assert before 与 after 逐项相等
```

- [ ] **Step 5：接进 `package.json`**

```json
"verify:rbac": "ts-node -r tsconfig-paths/register scripts/verify-rbac.ts",
```

- [ ] **Step 6：跑一次，全绿**

```bash
cd Exchange_js
bash scripts/on-stack.sh self verify:rbac
```
预期：逐条打印 `✓`，退出码 0。**任何一条红都要改代码，不许放宽判据。**

- [ ] **Step 7：提交**

```bash
git add scripts/verify-rbac.ts package.json
git commit -m "test(rbac): verify:rbac 行为校验器——11 职务逐端点探针，禁止源码文本断言"
```

---

## Task 14：段二收尾闸

**Files:** 无代码改动

- [ ] **Step 1：从零重铺 + 全量造数**

```bash
cd Exchange_js
bash scripts/stack.sh reset
bash scripts/on-stack.sh self demo:all
```
预期：花名册 21 笔逐条 `✓`。

> ⚠️ `demo-lib.ts` 用 `DEMO_ACTOR('DEMO_OPS_MAKER_8', 'OPS_OFFICER')` 之类的合成演员走没收审批。Task 11 把没收裁决人改成 `CFO` 后，**造数脚本里对应的 checker 角色必须跟着改成 `CFO`**——这是造数跟随业务口径，不是「为让脚本通过而改脚本」。限额若有类似造数亦同。

- [ ] **Step 2：四个校验器**

```bash
bash scripts/on-stack.sh self verify:rbac
bash scripts/on-stack.sh self verify:coa
bash scripts/on-stack.sh self verify:audit
bash scripts/on-stack.sh self verify:demo-data
```
预期：`verify:rbac` 全绿；其余对照 `doc-final/demo/baseline.md` 净新失败 0。

- [ ] **Step 3：对账两场**

```bash
bash scripts/on-stack.sh self recon:demo:pass
bash scripts/on-stack.sh self recon:demo:break
```
预期：pass 全绿；break 检出 9/9。

- [ ] **Step 4：三 tsc + 全量 jest**

```bash
npx tsc --noEmit -p tsconfig.json
cd admin-web && npx tsc -b --noEmit && cd ..
cd client-web && npx tsc -b --noEmit && cd ..
npx jest
```
预期：净新失败 0。

- [ ] **Step 5：第一幕 5 站真人走查（V5 的落地）**

起 preview，按下表逐条真登录实做，每步截图：

| 走查 | maker | checker | 期望 |
|---|---|---|---|
| 改角色权限包 | `tech_admin@` | `ciso@` | 审批单生成 → 批准 → 权限生效且**无其它权限丢失** |
| 改费率等级 | `cfo@` | `ops_officer@` | 批准后客户端报价当场变 |
| 改限额规则 | `ops_officer@` | `sm@` | 批准生效 |
| 提充值解冻 | `compliance_lead@` | `mlro@` | 批准生效；运营账号试同一动作得 403 |
| 提没收 | `ops_officer@` | `cfo@` | 批准生效 |
| 自批被拒 | 同一账号提+批 | — | 当场拒绝且**审计有一条拒绝记录** |
| 硬互斥 | `ciso@` 加 MLRO 角色 | — | 当场拒绝 |

- [ ] **Step 6：CHANGELOG + 提交**

```markdown
- [2026-08-30] **第一幕职权重建**：权限包 25 → 50、域 6 → 12、职务 8 → 11（新增内审 / 财务负责人 / 金库专员）；交易域按具体动作拆包——解冻只在合规官手里、没收由财务签字、限额由高管签字；⚡ 面板单列为演示装置并归合规官（合规官在后台推不动任何单据，只能经 Sumsub 回调）；补上「改一次角色就丢权限」的漏洞
```

```bash
git add doc-final/CHANGELOG.md
git commit -m "docs(CHANGELOG): 第一幕职权重建段收尾"
```

---

# 段三 · 剧本与文档

## Task 15：第一幕 5 站剧本与模块文档同步

**Files:**
- Modify: `doc-final/demo/script.md`（第一幕整段）
- Modify: `doc-final/demo/data.md`（管理员名册 8 → 11）
- Modify: `doc-final/modules/overview.md`（§4 权限包拆分整节）
- Modify: `doc-final/modules/v1-governance.md`（§3 决策点与角色、§4 演示脚本、§5 技术节点、§6 演示缺口）
- Modify: `doc-final/modules/v3-financial-config.md`（§3、§4、§5、§6）
- Modify: `doc-final/BACKLOG.md`（§B 销账 + §G 注一行）
- Modify: `doc-final/PRODUCTION-NOTES.md`（追加本轮发现的兜底类缺口）

**Interfaces:**
- Consumes: Task 14 的实跑终态（文档照实际写，不照计划写）
- Produces: 演示者可直接照着走的第一幕动线

- [ ] **Step 1：`demo/script.md` 第一幕重写成 5 站**

按 spec §6 的表落成剧本体例（讲什么 / 造数 / 走查 / 期望），五站标题：① 谁能动手 ② 一笔配置要过门 ③ 门自己也要过门 ④ 货架 ⑤ 三种门与容器。每站写清**用哪个账号登录**。

同时在第一幕末尾补一句：**本幕的每个动作都是第七幕要拉出来的证据链**（审计不设站的理由）。

- [ ] **Step 2：`demo/data.md` 管理员名册**

改成 11 行，标注每个账号在第一幕哪一站出场。

- [ ] **Step 3：`modules/overview.md` §4 整节重写**

按 12 域 50 包重写权限包表；保留「不做角色矩阵」的说明；把 11 个职务与其独有动作列一张表。

- [ ] **Step 4：`v1-governance.md` 与 `v3-financial-config.md` 同步**

- §3 决策点与角色：按新的 maker/checker 对照表改（含没收→财务、限额→高管、解冻→合规官提）
- §4 演示脚本：与 `script.md` 第一幕对齐，不重复写、只补细节
- §5 技术节点：`rbac.catalog.ts` 的域/桶数字更新；删掉指向已退役模块的锚点
- §6 演示缺口：销掉本轮已修的，保留未修的

两篇头部的「技术节点 Last Verified」改成 `2026-08-30`。

- [ ] **Step 5：`BACKLOG.md` 销账**

§B（第一幕）中以下条目打勾销账：权限包目录三动词标准化 + 铺满 9 空域 ｜ `CustodianWalletDetail.tsx:182` 幽灵按钮 ｜ Wave8OpsDashboardPage 404 ｜ `/admin/pricing/policies*` 幽灵路由 + `CUSTOMER_RATE_READ/WRITE` 死权限组 ｜ 新增 CFO 角色。

§G（第六幕）的调账单条目下追加一行：

```markdown
  ⤷ 落地时同批加 `recon.act_adjust` 权限包（2026-08-30 第一幕职权重划时预留，当时代码尚不存在故未建组）
```

**`Q3 expirePendingApprovals() 无 @Cron 调用方` 不销账**——本轮未修，仍是业务缺口。

- [ ] **Step 6：`PRODUCTION-NOTES.md` 追加**

把本轮路上发现、按 CLAUDE.md §2 不做的项各记一行，例如：客户侧 `/my/inbound-signals` 两条路由挂管理端权限组的语义错配；若 Task 4 Step 4 保留了 `PATCH .../status` 幽灵路由，也记一行。

- [ ] **Step 7：文档自查**

```bash
cd Exchange_js
grep -rn "档案簿\|监管闸门\|流动性提供商\|Wave8\|RISK_DECISION_RECORD" doc-final --include=*.md \
  | grep -v archive | grep -v superpowers
```
预期：只剩本计划与 spec 自身的提及，以及 CHANGELOG 的退役记录。现行文档（`modules/` `demo/` `rules/` `ui-contract/`）不得再有活口径引用。

- [ ] **Step 8：提交**

```bash
git add doc-final
git commit -m "docs(第一幕): 5 站剧本 + 11 职务名册 + 权限包表重写；BACKLOG 销 5 条"
```

---

## 收尾

三段全部完成后，按 `superpowers:finishing-a-development-branch` 决定合并方式。合并前最后确认：

- [ ] `bash scripts/stack.sh reset` + `demo:all` 8/8 与花名册 21 笔全对
- [ ] `verify:rbac` / `verify:coa` / `verify:audit` / `recon:demo:pass` / `recon:demo:break` 全部对照基线
- [ ] 三个 tsc 无输出，全量 jest 净新失败 0
- [ ] `doc-final/demo/baseline.md` 若有数字变化（权限组数、职务数）同步更新
- [ ] worktree 与分支清理
