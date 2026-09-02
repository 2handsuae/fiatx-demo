# 四模块治愈 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按设计稿《2026-09-01-four-modules-cure-design.md》把角色 / 权限 / admin 管理 / 审批单四模块治到"演得出来、判据可信"：三部法（留痕纪律 / 迁移表 / 业务键）+ 底座两 @Cron + 四模块迁移 + 死物退役 + 六站剧本 + 约 15 条行为判据。

**Architecture:** 三波顺序推进。波一立法（法的机器件全部落地并各自带测试）；波二把四模块迁上法 + 收编 + 退役（模块间可并行）；波三剧本与判据收口（verify:act1 v2 + 真人走查）。审批单模块是迁移表范本，不动它的状态机。

**Tech Stack:** NestJS + Prisma/SQLite ｜ @nestjs/schedule (@Cron) ｜ React admin ｜ ts-node 校验脚本 ｜ jest（后端 `src/` 内 spec + `test/` e2e 走 `tsconfig.test.json`）

## Global Constraints

- 设计稿 = `doc-final/superpowers/specs/2026-09-01-four-modules-cure-design.md`；业主六裁决见其 §0，**不再翻案**
- **本任务不做**：幂等/去重/重试回放/补偿/并发锁/兼容层与 backfill（状态值变化直接终态，reset 重铺）/输入防御校验/性能优化。收编 9 端点与超时 @Cron 的边界澄清见设计稿 §1
- 审计词表守封册守则：新码出生即定死四件事；旧码进 `DEPRECATED_AUDIT_ACTIONS` 退役拒写
- 每个 Task 收尾必跑随手闸：`npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json && (cd admin-web && npx tsc -b --noEmit) && (cd client-web && npx tsc -b --noEmit)` + 本任务相关 jest，判据**全绿**
- 测试的绿必须来自行为；**禁止「扫源码文本」型断言**（仓内已栽六次）
- worktree 内 npm 脚本一律 `bash scripts/on-stack.sh self <script>`；改 RBAC 后必须 `db:base:sync` + **重启后端**（内存定义，只 seed = 白做）
- **并行会话在动 main**（平账一期半 14 任务）：本计划在 worktree 施工；合并前重新 merge main、复跑判据；`rbac.catalog.ts` / `approval.constants.ts` 是共享热点文件
- 行号基线 = main `4b7a81c0`（写计划当日）；执行时行号可能漂移，**以内容锚点为准、行号只作导航**
- 前端改动必须起 preview 渲染 + 截图，tsc 不算数

## 事实底稿（计划所依据的实测，全部在 4b7a81c0 上验证过）

| 事实 | 位置 |
|---|---|
| 审计去重钥匙 = sha256(域\|码\|主体类型\|主体号\|旅程号\|请求号)，命中即返回旧行 | `audit-logs.service.ts:302-319` / `:601-606` |
| approve/reject 审计不带 requestId；`randomUUID` 已 import | `approvals.service.ts:743-765` / `:846-869` / `:11` |
| SOD_DENIED 不带 requestId；REQUIRED_MISSING 用确定性 requestId | `approvals.service.ts:231-248` / `:963-979` |
| 三处 FAILED 审计缺 reasonCode（合同闸 `:920` 会当场拒收） | create `:263-278` / modify `:426-442` / binding `:259-286` |
| 修改流驳回比对 `'REJECTED'` 而信号是 `'DECLINED'` → 恒走 CANCELLED | `role-definition-modify-workflow.service.ts:465`；信号源 `approval-handler.base.ts:73`；正确对照组 binding `:170-181` |
| 修改流落地失败写 `status:'APPROVED'+failureReason` | 同文件 `:408-418`（failRequest） |
| 创建流取消裸 delete 不查状态 | `role-definition-create-workflow.service.ts:282-291` |
| `updateStatus` 任意值零 from 校验；`update()` 通用直通 | `users.domain.service.ts:93-109`；`users.service.ts:266-275` |
| `physicalDelete` 吞删除错误（幽灵账号） | `users.domain.service.ts:111-114`；调用方 invite `:112/:260` |
| 锁定经 `usersService.update` 直写 LOCKED；自动解锁直写 ACTIVE 且注释自认审计留空记 BACKLOG | `auth.service.ts:55-120` |
| 邀请接受在事务中直写 ACTIVE | `admin-invitations.service.ts:419-423` |
| `sweepExpiredInvites` 完整实现零调用方 | `admin-invite-workflow.service.ts:412-450` |
| 守卫 108 行零审计，deny 抛点 2 处（catalog 外 / missing） | `admin-permission.guard.ts:88-93` / `:99-104` |
| AuditLogsModule 是 `@Global()` 且导出 AuditLogsService（守卫可注入） | `audit-logging/*.module.ts:8,16` |
| entityRef 生产 ~40 处传 UUID（例外：restrictionNo/adjustmentNo）；消费 ~25 处按它回查 | 见 Task 19–21 对照表 |
| deposit 消费侧 `depositService.findOne(id)`；withdraw `findOneInternal(id)`；钱包已有 `findByWalletNo` | `deposit-workflow:1370` / `withdraw-workflow:769` / `wallets.service.ts:226` |
| 读侧两处 `list({ entityRef: item.id })` 拉关联审批 | `deposit-transactions.service.ts:548` / `withdraw-transactions.service.ts:605` |
| `:id/approve` 硬编码调用 5 处（verify-rbac ×4 + demo-mlro ×1） | `scripts/verify-rbac.ts:603/686/695/740`、`scripts/demo-mlro.ts:49` |
| 提现报价前端常量抄了 swap 的码 | `admin-web/src/rbac/permissions.ts:111-112`；正确码 catalog `:505/:508` |
| 材料页前端两处门控都是 `PERMISSIONS.CUSTOMERS_READ` | `DashboardLayout.tsx:133-137`、`App.tsx:283/287` |
| 客户读桶组 = `['CUSTOMER_READ','CUSTOMER_RESTRICTION_READ','CUSTOMER_TAG_VIEW']` | `rbac.catalog.ts:744-748` |
| 无守卫 controller 3 个（材料 6 端点 / Sumsub 模拟 2 / Sumsub 事件 1） | `admin-material-management.controller.ts`、`admin-sumsub-simulation.controller.ts`（`admin/sumsub/simulate` + `applicant-action-result`/`ongoing-doc-monitoring-fire`）、`sumsub-ingestion-admin.controller.ts` |
| ⚡ 裁决族组 `DEMO_VERDICT_WRITE`；时钟族 `DEMO_CLOCK_WRITE` | catalog `:295-301` / `:256` |
| 12 死策略键名 | `CASE_EVIDENCE_EXPORT_APPROVAL` `ONBOARDING_FINAL_APPROVAL` `POOL_SETTLEMENT_BATCH_APPROVAL` `TREASURY_CROSS_POOL_TRANSFER_APPROVAL` `RISK_RATING_MEDIUM/HIGH/UPGRADE_PHASE1/MAINTENANCE/MLRO_REVIEW/TIER_UPGRADE` `PEP_RELATIONSHIP_APPROVAL` `ASSET_LISTING`（constants `:201-260/:313-317`） |
| 12 死 catalog 行（PUT iam roles / simulate-expired / funds-layer×4 / POST wallets / POST assets / PATCH assets status / POST withdraw×2 / treasury customer assets）+ 孤儿组 `INTERNAL_TRANSFER_READ/WRITE` | G3 清点全部现存 |
| 策略页 `AVAILABLE_ROLES` 写死 6 职务；Source 判定=有无 DB 行；seed 全量 upsert | `ApprovalPoliciesPage.tsx:39-46`；`approval-policy.service.ts:71-91`；`seed.base.ts:199-217` |
| `buildEventPayload` 取 stepNo 最大的非 PENDING 步（撞联动取消的高步） | `approvals.service.ts:251-254` |
| 角色变更申请单页面只在 `/dashboard` 树、侧栏零入口；修改申请单前端零消费 | `App.tsx:203-210`；`access-control.controller.ts:71-85` |
| 邀请链接前端已渲染；首登页有 QR | `PlatformMemberDetailPage.tsx:524`；`AdminMfaBindingPage.tsx:264-291` |
| 站 2/4/5 的 45 审计裸词（31 码值、7 码三族撞车） | 撞车表见设计稿；调用点数：费率 18 / 资产 12 / 限额+标签 11 / 钱包+地址 14 |

**对设计稿的一处偏离（执行前已核实，写明理由）**：设计稿 §6 给材料 4 读端点开新组 `MATERIAL_VIEW`；实测前端侧栏与路由**本来就用客户读门控**，新组会造成前后端错配还得补全绑定。改为挂既有 `CUSTOMER_READ` 组，零前端改动、授予线自然成立。

## File Structure（新建/重点修改总览）

**新建**：`src/modules/governance/approvals/approval-expiry.service.ts` ｜ `src/modules/identity/users/invite-expiry.service.ts` ｜ `src/modules/identity/users/constants/user-status-transitions.constant.ts` ｜ `src/modules/identity/access-control/constants/role-request-transitions.constant.ts` ｜ `src/modules/asset-treasury/assets/constants/asset-transitions.constant.ts` ｜ `admin-web/src/pages/RoleDefinitionModifyRequestsPage.tsx` + `RoleDefinitionModifyRequestDetailPage.tsx` ｜ `scripts/verify-act1.ts` ｜ `test/approval-expiry.e2e-spec.ts` + `test/audit-discipline.e2e-spec.ts`

**重点修改**：`approvals.service.ts`（requestId/approvalNo/归因/代行标）｜ `admin-permission.guard.ts`（403 留痕）｜ `users.domain.service.ts` + `users.service.ts` + `auth.service.ts`（迁移表）｜ 三个角色 workflow ｜ `audit-actions.constant.ts`（新码 + 退役）｜ `rbac.catalog.ts`（收编 + 死行删）｜ 三个无守卫 controller ｜ 约 20 个 workflow 的 entityRef 成对改 ｜ `ApprovalDetailPage/ApprovalsPage/ApprovalPoliciesPage/AuditLogsPage/DashboardLayout/App.tsx` ｜ `demo/script.md` 等文档

---

# 波一 · 立法

## Task 1：审批超时扫描器接上 @Cron

**Files:**
- Create: `src/modules/governance/approvals/approval-expiry.service.ts`
- Modify: `src/modules/governance/approvals/approvals.module.ts`
- Test: `test/approval-expiry.e2e-spec.ts`

**Interfaces:**
- Consumes: `ApprovalsService.expirePendingApprovals(): Promise<{ expiredCount: number; expiredIds: string[] }>`（`approvals.service.ts:1101`，已存在，不改）
- Produces: `ApprovalExpiryService.sweep(): Promise<void>`（测试直接调，不等真实时钟）；`handleCron()`（@Cron 包装）

- [ ] **Step 1: 写失败的 e2e**

新建 `test/approval-expiry.e2e-spec.ts`：

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { ApprovalExpiryService } from '../src/modules/governance/approvals/approval-expiry.service';
import { ApprovalStatuses } from '../src/modules/governance/approvals/constants/approval.constants';

describe('审批超时门（⑥ 门不可绕）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let expiry: ApprovalExpiryService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    expiry = app.get(ApprovalExpiryService);
  });
  afterAll(async () => { await app.close(); });

  const mk = (suffix: string, timeoutAt: Date) =>
    prisma.approvalCase.create({
      data: {
        approvalNo: `APR-EXPIRY-${suffix}-${Date.now()}`,
        actionType: 'SWAP_FEE_LEVEL_CHANGE', entityRef: 'TEST', createdByUserId: 'test-user',
        status: ApprovalStatuses.PENDING, traceId: `trace-${suffix}-${Date.now()}`, timeoutAt,
      },
    });

  it('timeoutAt 已过的 PENDING 单，扫一轮后变 EXPIRED', async () => {
    const c = await mk('DUE', new Date(Date.now() - 60_000));
    await expiry.sweep();
    const after = await prisma.approvalCase.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.status).toBe(ApprovalStatuses.EXPIRED);
  });

  it('timeoutAt 未到的 PENDING 单，扫描器不碰', async () => {
    const c = await mk('FUTURE', new Date(Date.now() + 3_600_000));
    await expiry.sweep();
    const after = await prisma.approvalCase.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.status).toBe(ApprovalStatuses.PENDING);
  });
});
```

- [ ] **Step 2: 跑它确认失败**

```bash
cd Exchange_js && bash scripts/on-stack.sh self jest -- test/approval-expiry.e2e-spec.ts
```
预期：FAIL（`ApprovalExpiryService` 不存在）

- [ ] **Step 3: 写扫描器**

新建 `src/modules/governance/approvals/approval-expiry.service.ts`：

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ApprovalsService } from './approvals.service';

/**
 * 审批超时扫描（2026-09-01 治愈计划 · 底座）。
 * expirePendingApprovals()/expirePendingApprovalCase() 自建成起完整——状态机、
 * 审计（APPROVAL_EXPIRED，sourcePlatform 就写着 'CRON'）、EXPIRED 事件——唯独
 * 没人定时叫它：42 条策略的 timeoutHours 一直是纯展示。这不是禁做清单里的
 * 重试/回放，是业务规则本身：单子会过期。周期 */1 与三域 SLA 一致。
 */
@Injectable()
export class ApprovalExpiryService {
  private readonly logger = new Logger(ApprovalExpiryService.name);
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Cron('*/1 * * * *', { timeZone: 'Asia/Dubai' })
  async handleCron(): Promise<void> {
    await this.sweep();
  }

  // 与 @Cron 包装分开，测试直接调、不等真实时钟。
  async sweep(): Promise<void> {
    try {
      const { expiredCount } = await this.approvalsService.expirePendingApprovals();
      if (expiredCount > 0) this.logger.log(`approval expiry sweep: ${expiredCount} case(s) expired`);
    } catch (err) {
      this.logger.error(`approval expiry sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
```

- [ ] **Step 4: 注册进 `approvals.module.ts` providers**（import + 加入数组，其余不动）
- [ ] **Step 5: 跑测试确认 2 passed；跑四道 tsc**
- [ ] **Step 6: Commit**

```bash
git add src/modules/governance/approvals/approval-expiry.service.ts src/modules/governance/approvals/approvals.module.ts test/approval-expiry.e2e-spec.ts
git commit -m "feat(approvals): 超时门接 @Cron——timeoutHours 从展示字段变成真会响的门"
```

## Task 2：⚡ 模拟审批超时

**Files:**
- Modify: `src/modules/governance/approvals/approvals.service.ts`（`expirePendingApprovals()` 之后追加方法）
- Modify: `src/modules/governance/approvals/approvals.controller.ts`
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（`:438` cancel 行后）
- Modify: `admin-web/src/pages/ApprovalDetailPage.tsx`
- Test: `test/approval-expiry.e2e-spec.ts` 追加

**Interfaces:**
- Produces: `ApprovalsService.simulateTimeoutByNo(approvalNo: string): Promise<{ approvalNo: string; timeoutAt: Date }>`；`POST /admin/control-gates/approvals/:approvalNo/simulate-timeout`（组 `DEMO_CLOCK_WRITE`）

- [ ] **Step 1: 追加失败测试**

```typescript
  it('⚡ 拨到过去后，下一轮扫描该单即过期', async () => {
    const approvalsService = app.get(ApprovalsService);
    const c = await mk('SIM', new Date(Date.now() + 48 * 3_600_000));
    await approvalsService.simulateTimeoutByNo(c.approvalNo);
    await expiry.sweep();
    const after = await prisma.approvalCase.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.status).toBe(ApprovalStatuses.EXPIRED);
  });
```
（顶部补 `import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';`）
跑：预期 FAIL `simulateTimeoutByNo is not a function`。

- [ ] **Step 2: service 方法**

```typescript
  /**
   * 演示用：把该单超时时间拨到过去，下一轮 @Cron 扫描即过期。与三域
   * simulate-sla-timeout 同款。只拨时间、不直改状态：过期这条边必须由
   * 扫描器走，否则演的是假门。
   */
  async simulateTimeoutByNo(approvalNo: string) {
    const approval = await this.prisma.approvalCase.findUnique({ where: { approvalNo } });
    if (!approval) throw new NotFoundException(`Approval ${approvalNo} not found`);
    if (approval.status !== ApprovalStatuses.PENDING) {
      throw new BadRequestException(`Approval ${approvalNo} is ${approval.status}, only PENDING can be fast-forwarded`);
    }
    const timeoutAt = new Date(Date.now() - 1000);
    await this.prisma.approvalCase.update({ where: { id: approval.id }, data: { timeoutAt } });
    return { approvalNo, timeoutAt };
  }
```

- [ ] **Step 3: controller 端点**（紧挨现有 cancel 端点后；装饰器写法照抄该文件既有端点，`@RequirePermissions`/`buildPermissionCode` 的 import 名以文件现状为准）

```typescript
  @Post(':approvalNo/simulate-timeout')
  @ApiOperation({ summary: '演示用：把该审批单的超时时间拨到过去，下轮扫描即过期' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/control-gates/approvals/:approvalNo/simulate-timeout'))
  simulateTimeout(@Param('approvalNo') approvalNo: string) {
    return this.approvalsService.simulateTimeoutByNo(approvalNo);
  }
```

- [ ] **Step 4: rbac.catalog 登记**（cancel 行后加）

```typescript
  route('POST', '/admin/control-gates/approvals/:approvalNo/simulate-timeout', 'Fast-forward approval timeout (demo only)', ['DEMO_CLOCK_WRITE']),
```
然后 `bash scripts/on-stack.sh self db:base:sync` + 重启后端。

- [ ] **Step 5: 前端 ⚡ 按钮**（`ApprovalDetailPage.tsx` 现有动作按钮组内，PENDING 时显示；`Button/message/api/reload` 名字照该文件现状）

```tsx
{detail?.status === 'PENDING' && (
  <Button onClick={async () => {
    await api.post(`/admin/control-gates/approvals/${detail.approvalNo}/simulate-timeout`);
    message.success('已把超时时间拨到过去，一分钟内该单将自动过期');
    void reload();
  }}>⚡ 模拟超时</Button>
)}
```
⚠️ 本任务时详情页路由还是 `:id`（Task 17 才换 approvalNo）——按钮用 `detail.approvalNo` 字段，不依赖路由参数。

- [ ] **Step 6: 跑 e2e 3 passed + 四道 tsc + preview 截图（提单→⚡→等 1 分钟→EXPIRED）**
- [ ] **Step 7: Commit** `feat(approvals): ⚡ 模拟超时——48 小时的门演示里一分钟看得到`

## Task 3：邀请过期清扫器接上 @Cron

**Files:**
- Create: `src/modules/identity/users/invite-expiry.service.ts`
- Modify: `src/modules/identity/users/users.module.ts`（providers 注册）
- Test: `src/modules/identity/users/invite-expiry.service.spec.ts`

**Interfaces:**
- Consumes: `AdminInviteWorkflowService.sweepExpiredInvites()`（`admin-invite-workflow.service.ts:412-450`，已存在零调用方，`ADMIN_INVITE_EXPIRED` 唯一写入点）
- Produces: `InviteExpiryService.sweep(): Promise<void>` + `@Cron('0 * * * *')` 包装

- [ ] **Step 1: 写失败 spec**（行为断言：造一条 `expiresAt` 已过的 PENDING 邀请行 → `sweep()` → 行状态变 EXPIRED。夹具按 `admin_user_invitations` 表现有字段造，参考 `admin-invitations.service.ts:151-169` 的 createInvitationRecord 字段集；禁止 readFileSync 扫源码）
- [ ] **Step 2: 跑确认 FAIL**
- [ ] **Step 3: 实现**（结构与 Task 1 完全同款：`@Cron('0 * * * *', { timeZone: 'Asia/Dubai' })` 每小时档 + try/catch + logger；构造函数注入 `AdminInviteWorkflowService`）
- [ ] **Step 4: providers 注册 → spec 转绿 → 四道 tsc**
- [ ] **Step 5: Commit** `feat(users): 邀请过期清扫接 @Cron——ADMIN_INVITE_EXPIRED 从死码活过来`

## Task 4：法一纪律 1——审批裁决审计补唯一请求号

**Files:**
- Modify: `src/modules/governance/approvals/approvals.service.ts`（4 个写入点）
- Test: `test/audit-discipline.e2e-spec.ts`（新建）

**Interfaces:**
- Consumes: `randomUUID`（`approvals.service.ts:11` 已 import）
- Produces: 行为保证「同案两票 = 审计两行」，Task 29 判据依赖

- [ ] **Step 1: 写失败 e2e**

新建 `test/audit-discipline.e2e-spec.ts`（复用 Task 1 的 app 引导样式）：

```typescript
  it('两步审批的两票各留一行 APPROVAL_GRANTED（第二票不被去重吞掉）', async () => {
    // 直接造一张两步 PENDING 单 + 两个 step，再依次以两个不同 checker 调 service.approve()
    // checker 账号用种子 sm@ / mlro@（DEPOSIT_SEIZE 现役两步策略的两个角色）。
    // 断言：auditLogEvent 里 action=APPROVAL_GRANTED 且 primarySubjectNo=该 approvalNo 的行数 === 2
  });
```

（完整夹具：`approvalCase.create` + `approvalStep.createMany`（stepNo 1/2, roles 分别 `SENIOR_MANAGEMENT_OFFICER`/`MLRO`, status PENDING）；actor 构造参照 `test/` 下既有 e2e 对 `toAuditActor` 形状的用法；两次 `approvalsService.approve(id, { reason }, actorSm)` / `(…, actorMlro)`。断言行数 2。）

- [ ] **Step 2: 跑确认 FAIL（现状去重后只剩 1 行）**
- [ ] **Step 3: 四个写入点补 requestId**

在以下四处的审计输入对象里各加一行 `requestId: randomUUID(),`：
1. APPROVAL_GRANTED（`:743` 起的对象，加在 `sourcePlatform` 上一行）
2. APPROVAL_DECLINED（`:846` 起）
3. APPROVAL_SOD_DENIED（`:231` 起）
4. APPROVAL_REQUIRED_MISSING（`:963` 起）——**替换**现有确定性 `requestId: \`APPROVAL_REQUIRED_${...}\``` 为 `randomUUID()`（语义变化经设计稿 §2 批准：反复被拒每次一行）

- [ ] **Step 4: e2e 转绿 + 变异回验**（临时删掉 GRANTED 那行 requestId → 测试必须回红 → 恢复）
- [ ] **Step 5: 四道 tsc + `bash scripts/on-stack.sh self jest -- src/modules/governance test/audit-discipline`**
- [ ] **Step 6: Commit** `fix(audit): 审批裁决四写入点补唯一请求号——多步单第二票不再被去重吞掉（铁律1）`

## Task 5：法一纪律 2——三处失败审计补 reasonCode

**Files:**
- Modify: `src/modules/identity/access-control/role-definition-create-workflow.service.ts:263-278`
- Modify: `src/modules/identity/access-control/role-definition-modify-workflow.service.ts:426-442`
- Modify: `src/modules/identity/users/admin-role-binding-change-workflow.service.ts:259-286`
- Test: 各文件旁既有 spec 追加断言

**Interfaces:**
- Consumes: 合同闸 `audit-logs.service.ts:920`（非成功必带 reasonCode，已存在）
- Produces: 三处失败分支的审计能真正落库

- [ ] **Step 1: 三处各加 `reasonCode`**

在三处 `outcome: AuditOutcome.FAILED` 的审计对象里补 `reasonCode: 'EXECUTION_FAILED',`（紧挨 outcome 行）。若该分支能区分「角色冲突/互斥拒绝」等细因，用更具体码（如 `ROLE_CONFLICT`）——判断依据是抛错来源，就地定，不新建全局枚举。

- [ ] **Step 2: spec 各补一条行为断言**

每个 workflow spec 里仿既有失败分支用例，追加：驱动失败路径后，断言 `auditLogsService.recordSystem`（或 recordByActor）收到的入参含 `reasonCode`（mock 捕获入参判断；不是文本扫描——断言的是调用行为）。跑绿。

- [ ] **Step 3: 变异回验**：任删一处 reasonCode → 对应 spec 回红 → 恢复
- [ ] **Step 4: 四道 tsc + jest（access-control + users 目录）**
- [ ] **Step 5: Commit** `fix(audit): 三处失败分支补机器原因码——失败留痕不再被合同闸拒收（铁律1）`

## Task 6：法一纪律 3——拆除吞错（留痕失败即流程失败）

**Files:**
- Modify: `src/modules/identity/users/admin-role-binding-change-workflow.service.ts:337`
- Modify: `src/modules/identity/users/admin-invite-workflow.service.ts:288 / :399`
- Modify: `src/modules/identity/users/mfa-binding-workflow.service.ts:306 / :366 / :556`
- Modify: `src/modules/identity/users/admin-password-reset-workflow.service.ts:435`
- Modify: `src/modules/identity/users/users.domain.service.ts:111-114`（physicalDelete）
- Test: `src/modules/identity/users/` 相关 spec

**Interfaces:**
- Produces: 8 处吞错点全部改为错误上抛；`physicalDelete` 删除失败会抛（幽灵账号病根除）

- [ ] **Step 1: 逐处删 `.catch(() => undefined)`**

7 处审计写入尾部的 `.catch(() => undefined)` 直接删除（`await this.auditLogsService.recordByActor(...)` 裸 await）。`physicalDelete` 改为：

```typescript
  async physicalDelete(userId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx || this.prisma;
    // 删除失败必须响：静默吞掉会残留 PENDING_INVITE_APPROVAL 幽灵账号，
    // 该 email 从此永远发不出第二张邀请（createProvisionalUser 撞唯一键恒抛）。
    await client.user.delete({ where: { id: userId } });
  }
```

⚠️ 逐处删除前看清所在方法的注释——mfa 三处注释主张「审计问题不能盖过锁定生效」，设计稿 §2 纪律 3 已明文推翻，**注释一并更新**（改成「留痕失败即流程失败，对齐记账铁律」），不留与代码相反的旧注释。

- [ ] **Step 2: 跑 users 目录 jest**——预期个别用例翻红（此前依赖静默的 mock 缺参）→ **修用例传参**（给 mock 的审计入参补齐 reasonCode/correlationId 等），不许回退纪律
- [ ] **Step 3: 四道 tsc + jest 全绿**
- [ ] **Step 4: Commit** `refactor(audit): 拆除 8 处吞错——留痕失败即流程失败（对齐记账铁律）`

## Task 7：法一纪律 4——守卫 403 留痕（ADMIN_ACCESS_DENIED）

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（V1_AUDIT_ACTIONS 加一码）
- Modify: `src/modules/identity/access-control/admin-permission.guard.ts`
- Test: `test/audit-discipline.e2e-spec.ts` 追加

**Interfaces:**
- Consumes: `AuditLogsService`（AuditLogsModule 是 `@Global()` 且导出，守卫可 `@Optional()` 注入）
- Produces: 合同码 `ADMIN_ACCESS_DENIED`；行为保证「持 ADMIN token 缺权限组打端点 → 403 且审计一行」

- [ ] **Step 1: 合同加码**（`V1_AUDIT_ACTIONS` 的 APPROVAL 段后）

```typescript
  // ── 权限守卫拒绝（2026-09-01 法一纪律4：被拒绝的动作同样留痕）──────
  ADMIN_ACCESS_DENIED: { domain: 'IAM', correlationMode: N, requiredFields: [], requiresCausation: false },
```

- [ ] **Step 2: 守卫注入审计并在两个 deny 抛点前写入**

`admin-permission.guard.ts` 构造函数加：

```typescript
    @Optional()
    private readonly auditLogsService?: AuditLogsService,
```

新增私有方法：

```typescript
  private async recordDenied(request: any, requiredPermissions: string[], reasonCode: string): Promise<void> {
    if (!this.auditLogsService) return;
    // 留痕失败即流程失败（法一纪律3）——这里不包 catch。
    await this.auditLogsService.recordByActor(
      {
        action: 'ADMIN_ACCESS_DENIED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ACCESS_CONTROL,
        primarySubjectNo: requiredPermissions.join(','),
        outcome: AuditOutcome.DENIED,
        reasonCode,
        reason: `Missing permission: ${requiredPermissions.join(', ')}`,
        requestId: randomUUID(),
        sourcePlatform: 'ADMIN_API',
        sourceIp: request.ip,
      },
      {
        actorType: 'ADMIN',
        actorNo: String(request.user?.userNo ?? request.user?.userId ?? 'UNKNOWN'),
        actorDisplayName: String(request.user?.email ?? 'UNKNOWN'),
        actorRolesAtTime: request.user?.roleCodes ?? [],
      },
    );
  }
```

（import 补 `randomUUID`、`AuditLogsService`、`AuditCategory`、`AuditOutcome`、`AuditEntityTypes`；actor 字段名以 `toAuditActor` 的消费方为准，执行时对照 `audit-log.dto.ts` 的 ActorInput 形状。）
在 `:99-104` 的 missing 抛点前调用 `await this.recordDenied(request, missing, 'MISSING_PERMISSION');`；在 `:88-93` catalog 外抛点前调用 `await this.recordDenied(request, [permissionCode], 'PERMISSION_NOT_IN_CATALOG');`。
⚠️ JWT 里有没有 userNo？若 `request.user.userNo` 为空，回查一次 `accessControlService`（或接受 userId 兜底）——执行时实测一条 403 看落库行，actorNo 必须是 ADM 号不是 UUID，查不到就在守卫里用 userId 查一次 user 表。

- [ ] **Step 3: e2e 追加**（`auditor@` 打 `POST /admin/reconciliation/runs/wallet` → 403 → 查 auditLogEvent：action=ADMIN_ACCESS_DENIED、actorNo=auditor 的 ADM 号、reasonCode=MISSING_PERMISSION 各断言一次）跑绿
- [ ] **Step 4: 变异回验**（注释掉 recordDenied 调用 → e2e 回红 → 恢复）；四道 tsc
- [ ] **Step 5: Commit** `feat(audit): 守卫 403 留痕 ADMIN_ACCESS_DENIED——「默默拦下被禁止」从叙事变行为（业主裁决3）`

## Task 8：法一附属修缮五件

**Files:**
- Modify: `src/modules/identity/users/admin-invite-workflow.service.ts:377-397`（接受失败主体号）/ `:291-309`（重发留痕）
- Modify: `src/modules/identity/auth 下 auth.service.ts:60-78`（自动解锁留痕；文件真实路径以 `find src -name auth.service.ts` 为准）
- Modify: `src/modules/identity/access-control/role-definition-create-workflow.service.ts:143`（主体号同轴）
- Modify: `src/modules/governance/approvals/approvals.service.ts:756-762 与 reject 同构处`（超管代行标）
- Test: 各旁 spec 追加行为断言

**Interfaces:**
- Consumes: `findLatestInvitationAuditContext`（`admin-invitations.service.ts:85`）的「回查最近审计事件取 correlationId」模式
- Produces: 五件修缮各自可断言

- [ ] **Step 1: 接受邀请失败分支**（`:381-397` 的 DENIED 审计）：token 可解析出邀请行则 `primarySubjectNo: 目标 userNo`，解析不出则用请求里的 email；`actorNo` 同源填充，不再写死 `'UNKNOWN'`
- [ ] **Step 2: 重发邀请留痕**：`resendInvitation`（`:291-309`）成功路径补写 `ADMIN_INVITE_DISPATCHED`（correlationMode I：correlationId 经 `findLatestInvitationAuditContext` 回查同旅程；`requestId: randomUUID()` 区分首发/重发；actor 用调用方传入的 AdminActor）
- [ ] **Step 3: 自动解锁留痕**：`auth.service.ts` 自动解锁分支补写 `ADMIN_ACCOUNT_LOCK_RELEASED`（recordSystem；fromStatus LOCKED / toStatus ACTIVE；correlationId = 回查该 userNo 最近一条 `ADMIN_ACCOUNT_LOCK_APPLIED` 事件的 correlationId——同 findLatestInvitationAuditContext 模式，在 auth.service 里注入 AuditLogsService 读侧或经 usersDomainService 转查）。**同步删除**该处「解锁侧留空记 BACKLOG」的长注释（旧账销掉），BACKLOG 对应条目在 Task 32 销
- [ ] **Step 4: 角色审计主体号同轴**：`role-definition-create-workflow.service.ts` 三处审计 `primarySubjectNo: roleCode` 改为申请语义的单号——创建流没有申请单表，主体改用 `role.id 对应的 roleCode` 保持不变**但**追加 `subjects: [{ subjectType: ACCESS_CONTROL, subjectNo: roleCode, subjectRole: RELATED }]`？——**不对，照设计稿执行**：修改流与绑定流已用 requestNo 为主体；创建流保持 roleCode 主体 + 三条流全部**追加 RELATED 子表行**（modify/binding 补 roleCode 为 RELATED，create 补 requestNo 缺失则免）。落点：三个 workflow 的每条审计对象加 `subjects` 数组（PRIMARY 由服务层自动落，只补 RELATED 行；参照 `approvalSubjects` 的形状 `approvals.service.ts:139-141`）
- [ ] **Step 5: 超管代行标**：approve/reject 两处 metadata 条件从 `isSuperAdmin && 自批` 放宽为 `isSuperAdmin(actor) ? { superAdminBypass: true, actedAsRoles: allowedRoles } : undefined`（对象里带上代行的候选角色集）
- [ ] **Step 6: 各 spec 补断言（mock 捕获入参）→ 全绿；四道 tsc；Commit** `fix(audit): 法一附属五件——邀请失败可检索/重发留痕/自动解锁留痕/角色主体双轴/超管代行标`

## Task 9：法二——管理员迁移表 + 敞口废除

**Files:**
- Create: `src/modules/identity/users/constants/user-status-transitions.constant.ts`
- Modify: `src/modules/identity/users/users.domain.service.ts`
- Modify: `src/modules/identity/users/users.service.ts:266-275`
- Modify: `src/modules/identity/users/admin-invitations.service.ts:419-423`
- Modify: `src/modules/identity/users/admin-invite-workflow.service.ts:187`
- Modify: `auth.service.ts`（锁定/解锁两调用点）
- Test: `src/modules/identity/users/users.domain.service.spec.ts`

**Interfaces:**
- Produces: `assertUserTransition(from: string, action: UserStatusAction): string`（纯函数，非法抛 ConflictException 带 "Invalid transition"）；`UsersDomainService.applyUserTransition(userId, action, extra?: Record<string, any>, tx?): Promise<void>`；`assertFirstLoginTransition(from, action)` 同构

- [ ] **Step 1: 写失败 spec**

```typescript
  it('非法跃迁被表挡下：ACTIVE 不能 REACTIVATE / SUSPENDED 不能 LOCK', () => {
    expect(() => assertUserTransition('ACTIVE', UserStatusAction.REACTIVATE)).toThrow(/Invalid transition/);
    expect(() => assertUserTransition('SUSPENDED', UserStatusAction.LOCK)).toThrow(/Invalid transition/);
  });
  it('合法边照走：全部现役边', () => {
    expect(assertUserTransition('PENDING_INVITE_APPROVAL', UserStatusAction.INVITE_APPROVE)).toBe('INVITE_SENT');
    expect(assertUserTransition('INVITE_SENT', UserStatusAction.ACCEPT)).toBe('ACTIVE');
    expect(assertUserTransition('ACTIVE', UserStatusAction.SUSPEND)).toBe('SUSPENDED');
    expect(assertUserTransition('SUSPENDED', UserStatusAction.REACTIVATE)).toBe('ACTIVE');
    expect(assertUserTransition('ACTIVE', UserStatusAction.LOCK)).toBe('LOCKED');
    expect(assertUserTransition('LOCKED', UserStatusAction.UNLOCK)).toBe('ACTIVE');
  });
  it('首登三边 + 重置回环', () => {
    expect(assertFirstLoginTransition('PENDING_IDENTITY_CONFIRM', FirstLoginAction.CONFIRM)).toBe('MFA_BINDING');
    expect(assertFirstLoginTransition('MFA_BINDING', FirstLoginAction.BIND)).toBe('COMPLETED');
    expect(assertFirstLoginTransition('COMPLETED', FirstLoginAction.RESET)).toBe('PENDING_IDENTITY_CONFIRM');
    expect(() => assertFirstLoginTransition('COMPLETED', FirstLoginAction.BIND)).toThrow(/Invalid transition/);
  });
```

- [ ] **Step 2: 跑确认 FAIL；写迁移表**

新建 `constants/user-status-transitions.constant.ts`：

```typescript
import { ConflictException } from '@nestjs/common';

export enum UserStatusAction {
  INVITE_APPROVE = 'INVITE_APPROVE',
  ACCEPT = 'ACCEPT',
  SUSPEND = 'SUSPEND',
  REACTIVATE = 'REACTIVATE',
  LOCK = 'LOCK',
  UNLOCK = 'UNLOCK',
}
export enum FirstLoginAction { CONFIRM = 'CONFIRM', BIND = 'BIND', RESET = 'RESET' }

/**
 * 管理员状态迁移表（2026-09-01 法二）。此前 updateStatus 收任意目标态零校验，
 * 合法性全靠调用方自律（铁律④要求显式表+非法拒绝）。
 * INACTIVE 全仓零写入方，不进表、随重铺自然消亡。邀请被拒=物理删除，无状态边。
 */
export const USER_STATUS_TRANSITIONS: Record<string, Partial<Record<UserStatusAction, string>>> = {
  PENDING_INVITE_APPROVAL: { [UserStatusAction.INVITE_APPROVE]: 'INVITE_SENT' },
  INVITE_SENT:             { [UserStatusAction.ACCEPT]: 'ACTIVE' },
  ACTIVE:                  { [UserStatusAction.SUSPEND]: 'SUSPENDED', [UserStatusAction.LOCK]: 'LOCKED' },
  SUSPENDED:               { [UserStatusAction.REACTIVATE]: 'ACTIVE' },
  LOCKED:                  { [UserStatusAction.UNLOCK]: 'ACTIVE' },
};
export const FIRST_LOGIN_TRANSITIONS: Record<string, Partial<Record<FirstLoginAction, string>>> = {
  PENDING_IDENTITY_CONFIRM: { [FirstLoginAction.CONFIRM]: 'MFA_BINDING' },
  MFA_BINDING:              { [FirstLoginAction.BIND]: 'COMPLETED' },
  COMPLETED:                { [FirstLoginAction.RESET]: 'PENDING_IDENTITY_CONFIRM' },
};

export function assertUserTransition(from: string, action: UserStatusAction): string {
  const to = USER_STATUS_TRANSITIONS[from]?.[action];
  if (!to) throw new ConflictException(`Invalid transition: user in ${from} cannot ${action}`);
  return to;
}
export function assertFirstLoginTransition(from: string, action: FirstLoginAction): string {
  const to = FIRST_LOGIN_TRANSITIONS[from]?.[action];
  if (!to) throw new ConflictException(`Invalid transition: firstLogin in ${from} cannot ${action}`);
  return to;
}
```

- [ ] **Step 3: 域服务换轨**

`users.domain.service.ts`：
1. `updateStatus(userId, newStatus)` **删除**，替换为：

```typescript
  async applyUserTransition(
    userId: string,
    action: UserStatusAction,
    extra: Record<string, any> = {},
    tx?: Prisma.TransactionClient,
  ): Promise<{ fromStatus: string; toStatus: string }> {
    const client = tx || this.prisma;
    const user = await client.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const toStatus = assertUserTransition(user.status, action);
    await client.user.update({ where: { id: userId }, data: { status: toStatus, ...extra } });
    return { fromStatus: user.status, toStatus };
  }
```

2. `suspendUser`/`reactivateUser` 内部的手写 from 校验（`:147-153`/`:180-182`）改调 `assertUserTransition(user.status, SUSPEND/REACTIVATE)` 后写目标态（行为不变，真相处收拢）
3. `setFirstLoginStatus`/`completeMfaBinding`/`resetMfa` 各自改为先 `assertFirstLoginTransition(现值, CONFIRM|BIND|RESET)` 再写；**删除死方法 `completeFirstLogin`（`:299-313`）**

- [ ] **Step 4: 调用点跟随**

- `admin-invite-workflow.service.ts:187` `updateStatus(user.id, 'INVITE_SENT')` → `applyUserTransition(user.id, UserStatusAction.INVITE_APPROVE)`
- `admin-invitations.service.ts:419-423` 事务内直写 `status:'ACTIVE'` → `applyUserTransition(user.id, UserStatusAction.ACCEPT, {}, tx)`（其余同事务字段照旧另写）
- `auth.service.ts` 自动解锁 → `applyUserTransition(user.id, UserStatusAction.UNLOCK, { failedLoginAttempts: 0, lockedUntil: null })`；锁定分支（attempts>=5）→ `applyUserTransition(user.id, UserStatusAction.LOCK, { failedLoginAttempts: attempts, lockedUntil: ... })`，非锁定的计数更新仍走 `usersService.update`（它不再碰 status）
- `users.service.ts:266-275` `update()` 开头加保险：

```typescript
    if (data && Object.prototype.hasOwnProperty.call(data, 'status')) {
      // status 只能经 UsersDomainService.applyUserTransition 走迁移表（铁律④）。
      throw new BadRequestException('status must go through applyUserTransition');
    }
```

- [ ] **Step 5: spec 转绿 + 全仓 grep 确认 `updateStatus(` 零残留调用；跑 `bash scripts/on-stack.sh self jest -- src/modules/identity`（翻红用例=在直写 status 的旧假设上，修用例走新方法）**
- [ ] **Step 6: 四道 tsc + Commit** `refactor(users): 管理员状态走显式迁移表——updateStatus 敞口废除（铁律④）`

## Task 10：法二——三张角色申请单迁移表 + REJECTED 修边 + FAILED 拆态

**Files:**
- Create: `src/modules/identity/access-control/constants/role-request-transitions.constant.ts`
- Modify: `src/modules/identity/access-control/role-definition-modify-workflow.service.ts:460-470`（修边）/ `:408-418`（拆态）
- Modify: `src/modules/identity/access-control/role-definition-create-workflow.service.ts:282-291`（取消守卫）
- Modify: `src/modules/identity/users/admin-role-binding-change-workflow.service.ts:295-303`（executeTermination 补 from 过滤）
- Test: `role-definition-modify-workflow.service.spec.ts` 等三个既有 spec

**Interfaces:**
- Produces: `ROLE_REQUEST_TRANSITIONS` + `assertRoleRequestTransition(from, action): string`；状态全集 `{PENDING_APPROVAL, APPROVED, REJECTED, CANCELLED, EXPIRED, FAILED}`

- [ ] **Step 1: 写失败 spec（三条）**

```typescript
  it('驳回一张修改申请后，单据状态是 REJECTED 而不是 CANCELLED', async () => {
    // 夹具：造 PENDING_APPROVAL 的 roleDefinitionModifyRequest + 对应 role
    // 直接调 handleApprovalDecided/executeCancellation 入口，event.decision='DECLINED'
    // 断言落库 status === 'REJECTED'
  });
  it('落地失败的修改申请状态是 FAILED，不再是 APPROVED+failureReason', async () => { /* 驱动 failRequest 路径，断言 status==='FAILED' */ });
  it('已终态的创建申请不能再取消（裸 delete 有守卫）', async () => { /* role status=ACTIVE 时调 executeCancellation，断言 role 仍存在 */ });
```

- [ ] **Step 2: 跑确认 FAIL；写迁移表常量**

```typescript
import { ConflictException } from '@nestjs/common';
export enum RoleRequestAction { APPROVE='APPROVE', REJECT='REJECT', CANCEL='CANCEL', EXPIRE='EXPIRE', FAIL='FAIL' }
export const ROLE_REQUEST_TRANSITIONS: Record<string, Partial<Record<RoleRequestAction, string>>> = {
  PENDING_APPROVAL: {
    [RoleRequestAction.APPROVE]: 'APPROVED', [RoleRequestAction.REJECT]: 'REJECTED',
    [RoleRequestAction.CANCEL]: 'CANCELLED', [RoleRequestAction.EXPIRE]: 'EXPIRED',
    [RoleRequestAction.FAIL]: 'FAILED',
  },
};
export function assertRoleRequestTransition(from: string, action: RoleRequestAction): string {
  const to = ROLE_REQUEST_TRANSITIONS[from]?.[action];
  if (!to) throw new ConflictException(`Invalid transition: request in ${from} cannot ${action}`);
  return to;
}
```

- [ ] **Step 3: 三处手术**

1. **修边**（modify `:465`）：`const newStatus = decision === 'REJECTED' ? 'REJECTED' : 'CANCELLED';` →

```typescript
    const action =
      decision === 'DECLINED' ? RoleRequestAction.REJECT
      : decision === 'EXPIRED' ? RoleRequestAction.EXPIRE
      : RoleRequestAction.CANCEL;
    const newStatus = assertRoleRequestTransition(request.status, action);
```

2. **拆态**（modify failRequest `:413-417`）：`data: { status: 'APPROVED', failureReason, executedAt }` → `data: { status: assertRoleRequestTransition(request.status, RoleRequestAction.FAIL), failureReason: reason, executedAt: new Date() }`（注意 failRequest 被调时 request.status 仍是 PENDING_APPROVAL——落地失败发生在置 APPROVED 之前；执行时核对 `:378` 的置位顺序，若先置了 APPROVED 则把置位挪到执行成功之后，保持「PENDING_APPROVAL --FAIL--> FAILED」单边成立）
3. **取消守卫**（create `:282-291`）：delete 前加 `if (role.status !== 'PENDING_APPROVAL') { this.logger.warn(...); return; }`
4. **binding executeTermination**（`:300-303`）：update 加 from 过滤 `where: { id: request.id, status: 'PENDING_APPROVAL' }` 改用 `updateMany` 并检查 count（终态不被二次事件覆写）；executeRoleChange（`:184-187`）同款
5. modify 的成功执行路径（`:378` 附近置 APPROVED 处）改经 `assertRoleRequestTransition(…, APPROVE)`

- [ ] **Step 4: spec 转绿（含 Step 1 三条）+ jest access-control/users 目录全绿 + 四道 tsc**
- [ ] **Step 5: Commit** `fix(roles): 申请单走显式迁移表——REJECTED 可达、落地失败独立 FAILED 态（铁律④）`

## Task 11：法二——资产迁移表

**Files:**
- Create: `src/modules/asset-treasury/assets/constants/asset-transitions.constant.ts`
- Modify: `src/modules/asset-treasury/assets/assets.service.ts`（activateAsset `:155-162` / reactivateAsset `:120-127` / 停牌方法）
- Test: `src/modules/asset-treasury/assets/assets.service.spec.ts`

**Interfaces:**
- Produces: `ASSET_TRANSITIONS` + `assertAssetTransition(from: string, action: AssetAction): string`

- [ ] **Step 1: 写失败 spec**

```typescript
  it('非法跃迁：ACTIVE 资产不能再次 activate', () => {
    expect(() => assertAssetTransition('ACTIVE', AssetAction.ACTIVATE)).toThrow(/Invalid transition/);
  });
  it('合法边：PROVISIONING--ACTIVATE-->ACTIVE；SUSPENDED 只能 REACTIVATE', () => {
    expect(assertAssetTransition('PROVISIONING', AssetAction.ACTIVATE)).toBe('ACTIVE');
    expect(assertAssetTransition('SUSPENDED', AssetAction.REACTIVATE)).toBe('ACTIVE');
    expect(() => assertAssetTransition('SUSPENDED', AssetAction.ACTIVATE)).toThrow(/Invalid transition/);
  });
```

- [ ] **Step 2: 跑确认 FAIL；写常量**

```typescript
import { ConflictException } from '@nestjs/common';
export enum AssetAction { ACTIVATE = 'ACTIVATE', SUSPEND = 'SUSPEND', REACTIVATE = 'REACTIVATE' }
/** 资产状态迁移表（法二）。此前三处散落 if 守，无单一真相处（铁律④）。 */
export const ASSET_TRANSITIONS: Record<string, Partial<Record<AssetAction, string>>> = {
  PROVISIONING: { [AssetAction.ACTIVATE]: 'ACTIVE' },
  ACTIVE:       { [AssetAction.SUSPEND]: 'SUSPENDED' },
  SUSPENDED:    { [AssetAction.REACTIVATE]: 'ACTIVE' },
};
export function assertAssetTransition(from: string, action: AssetAction): string {
  const to = ASSET_TRANSITIONS[from]?.[action];
  if (!to) throw new ConflictException(`Invalid transition: asset in ${from} cannot ${action}`);
  return to;
}
```

- [ ] **Step 3: 三处改走表**（activate/reactivate/suspend 的 `if (asset.status !== X) throw` 换 `const to = assertAssetTransition(asset.status, 动作)`，update 写 `status: to`；reactivate 附带的 preSuspend 字段恢复逻辑原样保留）
- [ ] **Step 4: spec 转绿 + jest assets 目录 + 四道 tsc**
- [ ] **Step 5: Commit** `refactor(assets): 资产状态走显式迁移表（铁律④）`

## Task 12：45 裸词换名册 · 批一（费率两域，18 处调用）

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: 18 处调用点（`grep -rn "AuditGovernanceActions.SWAP_FEE_LEVEL_\|AuditGovernanceActions.WITHDRAWAL_FEE_LEVEL_" src --include='*.ts' | grep -v spec` 逐一定位）

**Interfaces:**
- Produces: 16 个前缀唯一新码进 `V1_AUDIT_ACTIONS`（domain CONFIG）

- [ ] **Step 1: 加 16 码**（`APPROVAL_POLICY_CHANGE_APPLIED` 段后；S/I 简写文件顶部已定义）

```typescript
  // ── 兑换费率等级（2026-09-01 换名册：裸名跨族撞车 → 前缀唯一）────
  SWAP_FEE_LEVEL_CREATION_REQUESTED:     { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  SWAP_FEE_LEVEL_CREATION_APPLIED:       { domain: 'CONFIG', correlationMode: I, requiredFields: ['afterData', 'approvalNo'], requiresCausation: true },
  SWAP_FEE_LEVEL_CREATION_APPLY_FAILED:  { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  SWAP_FEE_LEVEL_CREATION_CANCELLED:     { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },
  SWAP_FEE_LEVEL_CHANGE_REQUESTED:       { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData', 'afterData'], requiresCausation: false },
  SWAP_FEE_LEVEL_CHANGE_APPLIED:         { domain: 'CONFIG', correlationMode: I, requiredFields: ['beforeData', 'afterData', 'approvalNo'], requiresCausation: true },
  SWAP_FEE_LEVEL_CHANGE_APPLY_FAILED:    { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  SWAP_FEE_LEVEL_CHANGE_CANCELLED:       { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },
  // ── 提现费率等级 ────────────────────────────────────────
  WITHDRAWAL_FEE_LEVEL_CREATION_REQUESTED:    { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  WITHDRAWAL_FEE_LEVEL_CREATION_APPLIED:      { domain: 'CONFIG', correlationMode: I, requiredFields: ['afterData', 'approvalNo'], requiresCausation: true },
  WITHDRAWAL_FEE_LEVEL_CREATION_APPLY_FAILED: { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  WITHDRAWAL_FEE_LEVEL_CREATION_CANCELLED:    { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },
  WITHDRAWAL_FEE_LEVEL_CHANGE_REQUESTED:      { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData', 'afterData'], requiresCausation: false },
  WITHDRAWAL_FEE_LEVEL_CHANGE_APPLIED:        { domain: 'CONFIG', correlationMode: I, requiredFields: ['beforeData', 'afterData', 'approvalNo'], requiresCausation: true },
  WITHDRAWAL_FEE_LEVEL_CHANGE_APPLY_FAILED:   { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  WITHDRAWAL_FEE_LEVEL_CHANGE_CANCELLED:      { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },
```

- [ ] **Step 2: 18 处调用改字面量新码并当场补字段**（`AuditGovernanceActions.SWAP_FEE_LEVEL_CHANGE.CHANGE_REQUESTED` → `'SWAP_FEE_LEVEL_CHANGE_REQUESTED'`，逐条对照上表；每处核对合同必填：REQUESTED 带 afterData（CHANGE 另带 beforeData）、APPLIED 带 approvalNo+causationId、CANCELLED 带 reason+causationId、APPLY_FAILED 带 outcome=FAILED+reasonCode——缺了会当场抛，这正是进合同的意义，禁止为不抛而把 requiredFields 写空）
- [ ] **Step 3: 删 `AuditGovernanceActions` 里四个费率族**。⚠️ 8 个裸名字符串（CREATION_*/CHANGE_* 各 4）被限额两族共用，**退役名册登记推迟到 Task 14 一并做**，本任务只改码不登退役
- [ ] **Step 4: 闸门** `npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json` + `bash scripts/on-stack.sh self jest -- src/modules/trading src/modules/audit-logging` + `bash scripts/on-stack.sh self verify:audit`
- [ ] **Step 5: Commit** `refactor(audit): 费率两域换新名册——16 码进合同，解 CHANGE_REQUESTED 三族撞车`

## Task 13：45 裸词换名册 · 批二（资产四族，12 处调用）

**Files:** 同上模式；调用点 `grep -rn "AuditGovernanceActions.ASSET_" src --include='*.ts' | grep -v spec`

- [ ] **Step 1: 加 12 码**

```typescript
  // ── 资产上架 / 停复牌 ────────────────────────────────────
  ASSET_CREATED_AND_PROVISIONED: { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  ASSET_CREATION_FAILED:         { domain: 'CONFIG', correlationMode: S, requiredFields: [], requiresCausation: false },
  ASSET_PROVISIONING_UPDATED:    { domain: 'CONFIG', correlationMode: I, requiredFields: ['afterData'], requiresCausation: false },
  ASSET_ACTIVATION_REQUESTED:    { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData'], requiresCausation: false },
  ASSET_ACTIVATED:               { domain: 'CONFIG', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  ASSET_ACTIVATION_FAILED:       { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  ASSET_SUSPENSION_REQUESTED:    { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData'], requiresCausation: false },
  ASSET_SUSPENDED:               { domain: 'CONFIG', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  ASSET_SUSPENSION_FAILED:       { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  ASSET_REACTIVATION_REQUESTED:  { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData'], requiresCausation: false },
  ASSET_REACTIVATED:             { domain: 'CONFIG', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  ASSET_REACTIVATION_FAILED:     { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
```

（六个码值本就前缀唯一——`ASSET_CREATED_AND_PROVISIONED`/`ASSET_CREATION_FAILED`/`ASSET_PROVISIONING_UPDATED`/`ASSET_ACTIVATED`/`ASSET_SUSPENDED`/`ASSET_REACTIVATED` 码值不变只进合同，调用点只需补字段；另六个裸名改前缀。）

- [ ] **Step 2: 12 处调用改码+补字段**（裸名对照：`SUSPENSION_REQUESTED→ASSET_SUSPENSION_REQUESTED`、`SUSPENSION_EXECUTION_FAILED→ASSET_SUSPENSION_FAILED`、`REACTIVATION_REQUESTED→ASSET_REACTIVATION_REQUESTED`、`REACTIVATION_EXECUTION_FAILED→ASSET_REACTIVATION_FAILED`、`ACTIVATION_REQUESTED→ASSET_ACTIVATION_REQUESTED`、`ACTIVATION_FAILED→ASSET_ACTIVATION_FAILED`）
- [ ] **Step 3: 退役登记六个裸名 + 删四个资产族**

```typescript
  // 2026-09-01 换名册 · 资产四族裸名退役
  'SUSPENSION_REQUESTED', 'SUSPENSION_EXECUTION_FAILED',
  'REACTIVATION_REQUESTED', 'REACTIVATION_EXECUTION_FAILED',
  'ACTIVATION_REQUESTED', 'ACTIVATION_FAILED',
```

- [ ] **Step 4: 闸门（jest 加 asset-treasury 目录）+ Commit** `refactor(audit): 资产四族换新名册——12 码进合同`

## Task 14：45 裸词换名册 · 批三（限额两族 + 客户标签，11 处调用）

**Files:** 同上模式；`grep -rn "AuditGovernanceActions.TRANSACTION_LIMIT_\|AuditGovernanceActions.CUSTOMER_TAG" src --include='*.ts' | grep -v spec`

- [ ] **Step 1: 加 10 码**

```typescript
  // ── 交易限额规则 ────────────────────────────────────────
  TRANSACTION_LIMIT_CREATION_REQUESTED:    { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  TRANSACTION_LIMIT_CREATION_APPLIED:      { domain: 'CONFIG', correlationMode: I, requiredFields: ['afterData', 'approvalNo'], requiresCausation: true },
  TRANSACTION_LIMIT_CREATION_APPLY_FAILED: { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  TRANSACTION_LIMIT_CREATION_CANCELLED:    { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },
  TRANSACTION_LIMIT_CHANGE_REQUESTED:      { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData', 'afterData'], requiresCausation: false },
  TRANSACTION_LIMIT_CHANGE_APPLIED:        { domain: 'CONFIG', correlationMode: I, requiredFields: ['beforeData', 'afterData', 'approvalNo'], requiresCausation: true },
  TRANSACTION_LIMIT_CHANGE_APPLY_FAILED:   { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  TRANSACTION_LIMIT_CHANGE_CANCELLED:      { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },
  // ── 客户标签 ────────────────────────────────────────────
  CUSTOMER_TAG_ASSIGNED: { domain: 'CONFIG', correlationMode: I, requiredFields: ['afterData'], requiresCausation: false },
  CUSTOMER_TAG_REVOKED:  { domain: 'CONFIG', correlationMode: I, requiredFields: ['beforeData', 'reason'], requiresCausation: false },
```

- [ ] **Step 2: 11 处调用改码+补字段**（`TAG_ASSIGNED→CUSTOMER_TAG_ASSIGNED`、`TAG_REVOKED→CUSTOMER_TAG_REVOKED`；限额按表前缀化）
- [ ] **Step 3: 退役登记（含 Task 12 推迟的 8 个共用裸名）+ 删三族**

```typescript
  // 2026-09-01 换名册 · 费率/限额共用裸名 + 标签裸名退役
  'CREATION_REQUESTED', 'CREATION_APPLIED', 'CREATION_APPLY_FAILED', 'CREATION_CANCELLED',
  'CHANGE_REQUESTED', 'CHANGE_APPLIED', 'CHANGE_APPLY_FAILED', 'CHANGE_CANCELLED',
  'TAG_ASSIGNED', 'TAG_REVOKED',
```

- [ ] **Step 4: 核对 `TRANSACTION_LIMIT_REJECTED`**（L1 拦截码，非本批裸词）是否已在某张合同表；不在则加进 `V1_AUDIT_ACTIONS`：`TRANSACTION_LIMIT_REJECTED: { domain: 'CONFIG', correlationMode: I, requiredFields: ['reasonCode'], requiresCausation: false },`
- [ ] **Step 5: 闸门（jest 加 identity/customers）+ Commit** `refactor(audit): 限额两族+客户标签换新名册——10 码进合同，共用裸名一次性退役`

## Task 15：45 裸词换名册 · 批四（托管钱包 + 提现地址，14 处调用）

**Files:** 同上模式；`grep -rn "AuditGovernanceActions.CUSTODIAN_WALLET_CREATE\|AuditGovernanceActions.WITHDRAWAL_ADDRESS_REGISTRATION" src --include='*.ts' | grep -v spec`

- [ ] **Step 1: 加 10 码**

```typescript
  // ── 托管钱包创建 ────────────────────────────────────────
  CUSTODIAN_WALLET_CREATE_REQUESTED: { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  CUSTODIAN_WALLET_CREATED:          { domain: 'CONFIG', correlationMode: I, requiredFields: ['afterData', 'approvalNo'], requiresCausation: true },
  CUSTODIAN_WALLET_CREATE_FAILED:    { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  CUSTODIAN_WALLET_CREATE_CANCELLED: { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },
  // ── 客户提现地址（24h 冷却闸）──────────────────────────
  WITHDRAWAL_ADDRESS_REGISTERED:      { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  WITHDRAWAL_ADDRESS_ACTIVATED:       { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: false },
  WITHDRAWAL_ADDRESS_CANCELLED:       { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
  WITHDRAWAL_ADDRESS_SUSPENDED:       { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
  WITHDRAWAL_ADDRESS_DEACTIVATED:     { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
  WITHDRAWAL_ADDRESS_COOLING_SKIPPED: { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
```

- [ ] **Step 2: 14 处调用改码+补字段**（对照：`CREATE_REQUESTED→CUSTODIAN_WALLET_CREATE_REQUESTED`、`WALLET_CREATED→CUSTODIAN_WALLET_CREATED`、`WALLET_CREATE_FAILED→CUSTODIAN_WALLET_CREATE_FAILED`、`CREATE_CANCELLED→CUSTODIAN_WALLET_CREATE_CANCELLED`、`ADDRESS_REGISTERED→WITHDRAWAL_ADDRESS_REGISTERED`、`ADDRESS_ACTIVATED→WITHDRAWAL_ADDRESS_ACTIVATED`、`ADDRESS_CANCELLED→WITHDRAWAL_ADDRESS_CANCELLED`、`ADDRESS_SUSPENDED→WITHDRAWAL_ADDRESS_SUSPENDED`、`ADDRESS_DEACTIVATED→WITHDRAWAL_ADDRESS_DEACTIVATED`、`MANUAL_COOLING_SKIP→WITHDRAWAL_ADDRESS_COOLING_SKIPPED`。⚠️ 冷却跳过是后门端点留痕，reason 必填是演示要讲的点）
- [ ] **Step 3: 退役登记十个裸名；删最后两族；若 `AuditGovernanceActions` 已空则整个常量删除并清全仓 import（`grep -rn "AuditGovernanceActions" src` 应为 0；若剩 `TRANSACTION_LIMIT_REJECTED` 单条，改字面量后删常量）**
- [ ] **Step 4: 四道 tsc 全跑 + jest（asset-treasury + audit-logging）+ `verify:audit` + Commit** `refactor(audit): 钱包与地址换新名册——AuditGovernanceActions 清零，45 裸词全部进合同`

## Task 16：封册守则闭环（防复发）

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-vocabulary-closure.spec.ts`

- [ ] **Step 1: 追加两条断言**

```typescript
  it('审计码全局唯一且禁裸名——不许再出现跨族撞车', () => {
    const contracted = [
      ...Object.keys(V1_AUDIT_ACTIONS), ...Object.keys(V4_DEPOSIT_AUDIT_ACTIONS),
      ...Object.keys(V5_WITHDRAW_AUDIT_ACTIONS), ...Object.keys(V6_SWAP_AUDIT_ACTIONS),
      ...Object.keys(V8_RECON_AUDIT_ACTIONS), ...Object.keys(V2_CUSTOMER_AUDIT_ACTIONS),
    ];
    expect(new Set(contracted).size).toBe(contracted.length);
    const BARE = ['CREATION_REQUESTED', 'CREATION_APPLIED', 'CHANGE_REQUESTED', 'CHANGE_APPLIED',
                  'ACTIVATION_REQUESTED', 'TAG_ASSIGNED', 'CREATE_REQUESTED', 'ADDRESS_REGISTERED'];
    expect(contracted.filter((c) => BARE.includes(c))).toEqual([]);
  });
```

- [ ] **Step 2: 变异回验（不能跳）**：临时把 `'CHANGE_REQUESTED': { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: false },` 塞回 V1 表 → spec 必须 FAIL → 删掉恢复 PASS
- [ ] **Step 3: Commit** `test(audit): 封册加「全局唯一+禁裸名」，变异实证抓得住撞车码`

---

# 波二 · 迁移与退役

## Task 17：审批单对外识别改 approvalNo

**Files:**
- Modify: `src/modules/governance/approvals/approvals.service.ts`（新增按号查找 + 四个对外方法换参）
- Modify: `src/modules/governance/approvals/approvals.controller.ts`（4 端点 `:id` → `:approvalNo`）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts:436-439`（四行路径改 `:approvalNo`）
- Modify: `admin-web/src/App.tsx`（`control-gates/approvals/:id` 与 `governance/approvals/:id` 两处路由）
- Modify: `admin-web/src/pages/ApprovalsPage.tsx:306`、`admin-web/src/pages/ApprovalDetailPage.tsx`（useParams 与全部拼接）
- Modify: `scripts/verify-rbac.ts:603/686/695/740`、`scripts/demo-mlro.ts:49`（5 处硬编码调用连带）
- Test: `test/audit-discipline.e2e-spec.ts` 追加

**Interfaces:**
- Produces: `private findCaseByNoOrThrow(approvalNo: string, tx?): Promise<ApprovalCaseRow>`；`approve/reject/cancel/getDetail` 四方法入参 `approvalNo: string`

- [ ] **Step 1: 写失败 e2e**

```typescript
  it('审批端点收业务号；拿 UUID 打 → 404', async () => {
    const c = await prisma.approvalCase.create({ data: { approvalNo: `APR-KEY-${Date.now()}`,
      actionType: 'SWAP_FEE_LEVEL_CHANGE', entityRef: 'E', createdByUserId: 'u',
      status: 'PENDING', traceId: `t-${Date.now()}` } });
    const token = await loginAs('ciso');   // helper 照 test/ 既有 e2e
    expect((await req(`/admin/control-gates/approvals/${c.approvalNo}`, token)).status).toBe(200);
    expect((await req(`/admin/control-gates/approvals/${c.id}`, token)).status).toBe(404);
  });
```

- [ ] **Step 2: service**——`findCaseOrThrow` 旁新增：

```typescript
  private async findCaseByNoOrThrow(approvalNo: string, tx?: any) {
    const client = tx ?? this.prisma;
    const approval = await client.approvalCase.findUnique({
      where: { approvalNo }, include: this.approvalInclude(),
    });
    if (!approval) throw new NotFoundException(`Approval ${approvalNo} not found`);
    return approval as ApprovalCaseRow;
  }
```

`approve()/reject()/cancel()/getDetail()` 四个对外方法首参 `id` → `approvalNo`，内部第一跳换 `findCaseByNoOrThrow`。⚠️ **只改这四个**；`expirePendingApprovalCase(id)` 是扫描器内部按 id 走，不动——对外业务号、内部 id 本就是两件事。SoD 检查里的 `findCaseOrThrow(id)`（`:230`）若在这四方法调用链内，跟随换号。

- [ ] **Step 3: controller 四处 `@Param('id')`→`@Param('approvalNo')`、路径 `:id`→`:approvalNo`；catalog 四行同步；`db:base:sync` + 重启后端**
- [ ] **Step 4: 前端**——`App.tsx` 两条路由参数名改 `:approvalNo`；`ApprovalsPage.tsx:306` `navigate(...${item.id})` → `${item.approvalNo}`；`ApprovalDetailPage.tsx` `useParams` 取 `approvalNo`、所有请求拼接换之（Task 2 的 ⚡ 按钮已用 `detail.approvalNo` 无需动）
- [ ] **Step 5: 5 处脚本连带**——`verify-rbac.ts` 三处 `${caseId}/approve` 改传 `approvalNo`（V2 往返夹具里建案后记下 approvalNo 用它调用），`:740` routePattern 行改 `/admin/control-gates/approvals/:approvalNo/approve`；`demo-mlro.ts:49` 同改（其上游拿到的是 detail 里的 approvalNo 字段）
- [ ] **Step 6: e2e 转绿 + `bash scripts/on-stack.sh self verify:rbac` 全绿 + 四道 tsc + preview 截图（详情页地址栏 = APR 号）**
- [ ] **Step 7: Commit** `refactor(approvals): 对外识别改 approvalNo——URL 不再是 UUID（铁律⑥）`

## Task 18：成员 / 钱包对外识别改业务号

**Files:**
- Modify: `src/modules/identity/users/users.controller.ts`（`:id` 五端点 → `:userNo`）+ `users.domain.service.ts`（新增 `findByUserNo`）+ `admin-credential-mgmt.controller.ts:43`
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（users 五行 + reset-mfa 行路径同步）
- Modify: `admin-web/src/App.tsx:423`（`iam/members/:id`→`:userNo`）、`admin-web/src/pages/PlatformMembers.tsx:357`、`PlatformMemberDetailPage.tsx:133` 起全部拼接
- Modify: `/wallets/:id` 三端点 → `:walletNo`（`rbac.catalog.ts:369-371` + 对应 controller）+ `admin-web/src/App.tsx:457`、`CustodianWalletList.tsx:307/:325`、`CustodianWalletDetail.tsx`、`LedgerAccountList.tsx:343`（`ownerUuid`→`ownerNo`）
- Test: `test/audit-discipline.e2e-spec.ts` 追加两条（成员 byNo 200 / byUUID 404；钱包同构）

**Interfaces:**
- Produces: `UsersDomainService.findByUserNo(userNo: string): Promise<User | null>`（`findFirst({ where: { userNo, deletedAt: null } })`）；钱包侧用既有 `WalletsService.findByWalletNo`（`wallets.service.ts:226`）

- [ ] **Step 1: 失败 e2e 两条 → Step 2: 后端换参（suspend/reactivate/reset-password/resend/detail 五端点 + reset-mfa；工作流入口若收 userId，controller 层按号查出 id 后传入，工作流内部不动）→ Step 3: catalog 同步 + db:base:sync + 重启 → Step 4: 前端跳转与 useParams 换号；⚠️ 列表接口须返回 `userNo`/`walletNo`/`ownerNo` 字段，缺则后端 select 补——禁止前端拿 UUID 再查一次；`LedgerAccountList.tsx:304` 的 `tbAccountId` 是账本对外键，保留不动**
- [ ] **Step 5: e2e 转绿 + verify:rbac 全绿（它真登录打成员端点，路径变了判据必须跟上——其 routePattern 表相应行同步）+ 四道 tsc + 两页 preview 截图地址栏**
- [ ] **Step 6: Commit** `refactor(admin): 成员/钱包对外识别改业务号——第一幕 URL UUID 清零（铁律⑥）`

## Task 19：entityRef 换业务号 · 治理域（成对手术）

**Files:** 下表全部生产/消费点
**Interfaces:** 约定「entityRef 存业务号；消费侧按号回查」。`requireApproved`（`approvals.service.ts:981`）比对的是同一字符串，成对换后自动一致。

**成对对照表（生产 → 消费）**：

| 流 | 生产点（改传业务号） | 消费点（改按号回查） |
|---|---|---|
| 邀请 | `admin-invite-workflow.service.ts:101` `user.id`→`user.userNo` | `:183/:257` `findById(event.entityRef)`→`findByUserNo(event.entityRef)`（Task 18 已建） |
| 停用 | `admin-suspension-workflow.service.ts`（initiate 处 targetUserId）→ userNo | `:148/:151` findById/suspendUser → 先 `findByUserNo` 取 id 再调（suspendUser 签名不动） |
| 恢复 | `admin-reactivation-workflow.service.ts` 同构 | `:146/:149` 同构 |
| 密码重置 | `admin-password-reset-workflow.service.ts:235/:248` targetUserId→userNo | `:320` `where:{id:event.entityRef}`→`where:{userNo:event.entityRef}`；`:372` findById→findByUserNo |
| MFA 重置 | `admin-mfa-reset-workflow.service.ts:86/:99` 同构 | `:158/:161/:213` 先按号查 id 再调域方法 |
| 角色创建 | `role-definition-create-workflow.service.ts:105` `role.id`→`role.code` | decided 处理器内以 roleId 用之处 → 先 `role.findFirst({where:{code:entityRef}})` |
| 角色修改 | `role-definition-modify-workflow.service.ts:191` `request.id`→`request.requestNo` | `:457` `findUnique({where:{id:requestId}})`→`findFirst({where:{requestNo:…}})`（executeModification 同构处一并） |
| 绑定变更 | `admin-role-binding-change-workflow.service.ts:86` `request.id`→`request.requestNo` | `:185/:296` `where:{id:event.entityRef}`→`where:{requestNo:event.entityRef}` |
| 策略变更 | `approval-policy-change-workflow.service.ts`（建单处 request.id→requestNo，schema 有 requestNo 则用；无则该流保持 id 并在表内注明——执行时 `grep requestNo prisma/schema.prisma` 定夺） | `:219/:333` 跟随 |
| 证据包 | `audit-evidence-export-workflow.service.ts:101` `evidencePackage.id`→`packageNo`；`:156` requireApproved 传号 | 同文件消费处跟随 |

- [ ] **Step 1: 逐行手术（每流：改生产→改消费→跑该目录 jest→下一流）**
- [ ] **Step 2: 全域闸**：`bash scripts/on-stack.sh self jest -- src/modules/identity src/modules/governance src/modules/audit-logging` 全绿；四道 tsc
- [ ] **Step 3: Commit** `refactor(approvals): entityRef 换业务号 · 治理域——生产/消费成对切换（铁律⑥）`

## Task 20：entityRef 换业务号 · 交易域

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`（生产 `:1301/:1319/:1958/:1972/:2028/:2042/:2098/:2112/:2469/:2715` 全部 `deposit.id|depositId`→`depositNo`；消费=四个 decided handler `:1360/:2147/:2416/:2673` 内 `findOne(entityRef)`→`findOneByNo(entityRef)`）
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`（新增 `findOneByNo`；读侧 `:548` `list({entityRef: item.id})`→`item.depositNo`）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`（生产 `:723/:1901/:1915/:1971/:1985/:2060` `w.id|withdrawId`→`withdrawNo`；消费 `:769` `findOneInternal(payload.entityRef)`→`findOneInternalByNo`）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`（新增 `findOneInternalByNo`；读侧 `:605` 同构）
- Test: 既有三域 e2e（处置弧在 demo:all 花名册有行为覆盖）

**Interfaces:**
- Produces: `DepositTransactionsService.findOneByNo(depositNo: string)`（镜像 `findOne(id)` `:422`，`findUnique({where:{depositNo}})` 同 include）；`WithdrawTransactionsService.findOneInternalByNo(withdrawNo: string)`（镜像 `findOneInternal` `:388`）

- [ ] **Step 1: 两个 byNo 查找方法（照抄各自 findOne 的 include，只换 where）**
- [ ] **Step 2: 逐点手术（生产表 + 消费表）**。⚠️ deposit 四 handler 里有「entityRef 属别的工作流就忽略」的容错分支（`:1370-1373`）——按号查不到时同样静默 return，语义保持
- [ ] **Step 3: 行为闸**：`bash scripts/on-stack.sh self jest -- src/modules/trading` + `bash scripts/stack.sh reset self` + `bash scripts/on-stack.sh self demo:all`（花名册 21/21——没收/退回/上缴/解冻四条处置弧全在册，成对手术错一半这里当场红）+ `verify:coa`
- [ ] **Step 4: 四道 tsc + Commit** `refactor(approvals): entityRef 换业务号 · 交易域——四条处置弧花名册实证`

## Task 21：entityRef 换业务号 · 资产与配置域

**Files:**

| 流 | 生产点 | 消费点 |
|---|---|---|
| 资产激活 | `asset-activation-workflow.service.ts:68/:85` `asset.id`→`asset.assetNo` | `:175` `findUnique({where:{id}})`→`findFirst({where:{assetNo:event.entityRef}})` |
| 资产停牌 | `asset-suspension-workflow.service.ts:62/:75` 同构 | 该文件 decided 处理器内查询同构改 |
| 资产复牌 | `asset-reactivation-workflow.service.ts:62/:75` | `:130` `reactivateAsset(event.entityRef)` → 先按 assetNo 查出 id 再调 |
| 托管钱包 | `custodian-wallet-create-workflow.service.ts:172` `wallet.id`→`wallet.walletNo` | 该文件消费处 → `walletsService.findByWalletNo`（`:226` 已有） |
| 限额 | `transaction-limit-rule-workflow.service.ts:116/:257/:312` `rule.id`→`rule.ruleNo` | 同文件 decided 处理器按 ruleNo 回查 |
| 兑换费率 | `swap-fee-level-creation-workflow.service.ts:73` `level.id`→`level.levelCode`；`swap-fee-level-change-workflow.service.ts:84` `request.id`→请求业务号（schema 无则保持 id 并注明） | 各自 decided 处理器跟随 |
| 提现费率 | `withdrawal-fee-level-creation-workflow.service.ts:71`、`withdrawal-fee-level-change-workflow.service.ts:84` 同构 | 同构 |

- [ ] **Step 1: 逐流手术（业务号字段名执行时以 schema 为准：`assetNo`/`walletNo`/`ruleNo`/`levelCode` 均已在 schema 实证 @unique 或唯一索引；change 流的 request 表若无业务号列，该流 entityRef 保持 request.id 并在提交信息里写明豁免）**
- [ ] **Step 2: 行为闸**：jest asset-treasury + trading/fee 目录；`reset self` + `demo:all`（费率变更/资产激活在种子与花名册路径上）；verify:coa
- [ ] **Step 3: 四道 tsc + Commit** `refactor(approvals): entityRef 换业务号 · 资产与配置域`

## Task 22：审批详情页展示治理 + 审计页「关联单号」筛选

**Files:**
- Modify: `admin-web/src/pages/ApprovalDetailPage.tsx`（entityRef 回链、TRACE 折叠、Maker 兜底）
- Modify: `admin-web/src/pages/ApprovalsPage.tsx:327`（Maker 兜底）
- Modify: `admin-web/src/pages/AuditLogsPage.tsx`（FilterState + 输入框 + 请求参数）
- Test: preview 截图

**Interfaces:**
- Consumes: Task 19–21 之后 entityRef = 业务号；后端审计查询 `query.subjectNo` 走子表（`audit-logs.service.ts:1080-1086` 已支持）

- [ ] **Step 1: 回链映射**——`ApprovalDetailPage.tsx` 新增：

```tsx
const ENTITY_ROUTE_BY_ACTION: Record<string, (ref: string) => string | null> = {
  WITHDRAW_LARGE_VALUE_APPROVAL: (r) => `/admin/trading/withdrawals?keyword=${r}`,
  DEPOSIT_CONFISCATION: (r) => `/admin/trading/deposits?keyword=${r}`,
  DEPOSIT_RETURN: (r) => `/admin/trading/deposits?keyword=${r}`,
  DEPOSIT_SEIZE: (r) => `/admin/trading/deposits?keyword=${r}`,
  DEPOSIT_UNFREEZE: (r) => `/admin/trading/deposits?keyword=${r}`,
  WITHDRAW_UNFREEZE: (r) => `/admin/trading/withdrawals?keyword=${r}`,
  WITHDRAW_SANCTION_REFUND: (r) => `/admin/trading/withdrawals?keyword=${r}`,
  ASSET_ACTIVATION: (r) => `/admin/assets/${r}`,
  ASSET_SUSPENSION: (r) => `/admin/assets/${r}`,
  ASSET_REACTIVATION: (r) => `/admin/assets/${r}`,
  TRANSACTION_LIMIT_CREATION: (r) => `/admin/assets/transaction-limits/${r}`,
  TRANSACTION_LIMIT_CHANGE: (r) => `/admin/assets/transaction-limits/${r}`,
  SWAP_FEE_LEVEL_CREATION: (r) => `/admin/pricing/swap-fee-levels/${r}`,
  WITHDRAWAL_FEE_LEVEL_CREATION: (r) => `/admin/pricing/withdrawal-fee-levels/${r}`,
};
```

ENTITY REF 值渲染为 `<Link>`（映射缺席时纯文本）；各详情路由已按业务号收参（资产 `:assetNo`、限额 `:ruleNo`、费率 `:levelCode` 现状如此；交易域列表页用 keyword 预填，因三域详情路由参数以现状为准，列表定位足够演示）。TRACE ID 移入既有 objectSnapshot 所在的 TECHNICAL DETAIL 折叠块（该区已存在，仅挪位置）；Maker 兜底 `?? createdByUserId` 删除（缺 userNo 显示 `—`），`ApprovalsPage.tsx:327` 同改。

- [ ] **Step 2: 审计页筛选**——`FilterState` 加 `subjectNo: string`（DEFAULT_FILTERS 补 `''`）；筛选区加输入框「关联单号 / Related No」；请求参数拼 `subjectNo`（后端参数名同名）
- [ ] **Step 3: preview 走查截图**：① 审批详情 entityRef 是业务号且可点跳转；② 审计页输一张提现单号 → 捞到主体为审批单的行。四道 tsc + admin tsc
- [ ] **Step 4: Commit** `feat(admin): 审批详情回链业务号 + 审计按关联单号检索（业主裁决4）`

## Task 23：权限码修串 + tooltip 统一 + verify:rbac 扩 S6/S7

**Files:**
- Modify: `admin-web/src/rbac/permissions.ts:111-112`
- Modify: `admin-web/src/pages/RolesPage.tsx:470`
- Modify: `scripts/verify-rbac.ts`（静态段追加 S6/S7）

- [ ] **Step 1: 修抄串**

```typescript
  WITHDRAW_QUOTES_READ: 'api.get.admin_withdrawal_fee_levels_quotes',
  WITHDRAW_QUOTES_DETAIL_READ: 'api.get.admin_withdrawal_fee_levels_quotes_id',
```

- [ ] **Step 2: tooltip**——`RolesPage.tsx:470` 硬编码 `'Restricted — CISO only'` 改 `` `Restricted — ${bucket.description}` ``（RoleDetailPage 同款已改，两页对齐）
- [ ] **Step 3: S6 前后端码表双向差集**——verify-rbac 静态段追加：读 `admin-web/src/rbac/permissions.ts` 文本抽取 `'api.xxx'` 字面量集合（正则 `/'(api\.[a-z]+\.[a-z0-9_]+)'/g`），与 `RBAC_PERMISSION_DEFINITIONS` 的 code 集合比对：前端引用 ∖ 后端 = 空集才过（这是集合运算判据，与 S1–S5 同型；不是给业务行为投绿灯的文本断言）
- [ ] **Step 4: S7 字典真实性**——catalog 每行的 `(method,path)` 必须有活端点：由 AppModule 路由表在运行时枚举（verify-rbac 已起 app 的话用 `app.getHttpServer()` 路由栈；若纯静态跑，则以「catalog code 集合 ⊆ 收编后全部 controller 装饰器推导码集合」的 AST/正则抽取实现——执行者二选一，判据语义相同：**死行=红**）。⚠️ 本判据在 Task 26（死行删除）前会红——**S7 与 Task 26 同一提交落地**，或先写判据带 `TODO_DEAD_ROWS` 白名单、Task 26 清空白名单，执行者择一并在提交信息写明
- [ ] **Step 5: 变异回验**：把一个前端常量改成不存在的码 → S6 红；把一条死路由塞回 catalog → S7 红。恢复。`bash scripts/on-stack.sh self verify:rbac` 全绿
- [ ] **Step 6: preview：以 `cfo@` 登录（持提现费率读）访问提现报价页应可进；截图。Commit** `fix(rbac): 提现报价权限码修串 + S6/S7 判据——抄串病从此当场红`

## Task 24：收编 9 端点

**Files:**
- Modify: `src/modules/identity/material-refresh/admin-material-management.controller.ts`（挂守卫 + 6 端点 @RequirePermissions）
- Modify: `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts`（挂守卫 + 2 端点）
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion-admin.controller.ts`（挂守卫，登记已有）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（8 新行登记；`GET /admin/sumsub-events` `:259` 已在）
- Test: `test/audit-discipline.e2e-spec.ts` 追加两条

**Interfaces:**
- Consumes: 既有组 `CUSTOMER_READ`（材料 4 读——**设计偏离已批注**：前端两处门控本用客户读，弃建 MATERIAL_VIEW 新组）、`DEMO_CLOCK_WRITE`（材料 2 模拟）、`DEMO_VERDICT_WRITE`（Sumsub 模拟 2）、`SUMSUB_EVENT_VIEW`（事件页）

- [ ] **Step 1: catalog 登记 8 行**

```typescript
  // ── 材料管理（2026-09-01 收编：此前只查 type==='ADMIN'，内审也能按模拟钮）──
  route('GET', '/admin/material-management/cycles', 'List material refresh cycles', ['CUSTOMER_READ']),
  route('GET', '/admin/material-management/cycles/:id', 'Get material refresh cycle', ['CUSTOMER_READ']),
  route('GET', '/admin/material-management/holdings', 'List material holdings', ['CUSTOMER_READ']),
  route('GET', '/admin/material-management/holdings/:id', 'Get material holding', ['CUSTOMER_READ']),
  route('POST', '/admin/material-management/holdings/:id/simulate-stage', 'Simulate material stage transition (demo only)', ['DEMO_CLOCK_WRITE']),
  route('POST', '/admin/material-management/customers/:customerId/simulate-tier-change', 'Simulate customer tier change (demo only)', ['DEMO_CLOCK_WRITE']),
  // ── Sumsub 入站模拟（收编同上）──
  route('POST', '/admin/sumsub/simulate/applicant-action-result', 'Feed a simulated Sumsub applicant-action webhook (demo only)', ['DEMO_VERDICT_WRITE']),
  route('POST', '/admin/sumsub/simulate/ongoing-doc-monitoring-fire', 'Fire a simulated ongoing-doc-monitoring event (demo only)', ['DEMO_VERDICT_WRITE']),
```

⚠️ controller 路径前缀以 `@Controller()` 装饰器实测为准（材料 controller 挂载点执行时 grep 确认，路径段拼出来必须与 `buildPermissionCode` 推导一致——错一段就是 S7 红）。

- [ ] **Step 2: 三个 controller 类级 `@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)` + 各端点 `@RequirePermissions(buildPermissionCode(...))`（import 照仓内任一已收编 controller 抄）；`ensureAdmin`/`requireAdmin` 内联判据保留（守卫在前成冗余兜底）**
- [ ] **Step 3: db:base:sync + 重启后端**
- [ ] **Step 4: e2e 两条**：`auditor@` POST simulate-stage → **403**（此前 200——收编的行为证明）；`compliance_lead@` POST `/admin/sumsub/simulate/applicant-action-result` → 非 403（持 DEMO_VERDICT_WRITE 的职务不受伤）。跑绿
- [ ] **Step 5: verify:rbac 全绿（S7 覆盖新行）+ 四道 tsc + preview：材料页以 `ops_officer@`（持客户读）正常渲染截图**
- [ ] **Step 6: Commit** `feat(rbac): 收编 9 游离端点——「内审零 Act」在全部 admin 端点为真（业主裁决5）`

## Task 25：角色申请单从孤儿变公民

**Files:**
- Modify: `admin-web/src/components/DashboardLayout.tsx:104-121`（Identity & Access 组加第三项）
- Modify: `admin-web/src/App.tsx`（`/admin` 树补 `iam/role-change-requests` 列表+详情路由；沿用既有页面组件）
- Modify: `admin-web/src/pages/RoleChangeRequestsPage.tsx`（路由跳转 `request.id`→`requestNo`；「Target User ID」筛选改「Target User No」传 `targetUserNo`；`:225` UUID 前 8 位兜底删除）
- Modify: `admin-web/src/pages/RoleChangeRequestDetailPage.tsx`（useParams 收 `requestNo`；`:151` 兜底删；`:161` 审批跳转改 approvalCaseNo→`/admin/governance/approvals/${approvalCaseNo}`）
- Modify: `src/modules/identity/users/admin-role-change-request.controller.ts`（详情 `:id`→`:requestNo`；列表 query 加 `targetUserNo`）+ workflow `:141` 过滤条件加 userNo 关系
- Modify: `admin-web/src/pages/PlatformMemberDetailPage.tsx:216-217`（提交后 navigate 到申请单详情）
- Test: preview 截图

- [ ] **Step 1: 侧栏项**

```tsx
        {
          path: '/admin/iam/role-change-requests',
          label: 'Role Change Requests',
          icon: <ClipboardList size={13} />,
          requiredPermissions: [PERMISSIONS.IAM_ROLES_READ],
        },
```

- [ ] **Step 2: `/admin` 树路由两条（withPermission 同侧栏权限）；后端详情端点与 catalog 行 `:id`→`:requestNo`（db:base:sync+重启）；前端跳转/参数全换 requestNo；筛选框改 userNo 语义（后端 findFirst 按 `targetUser: { userNo }` 关系过滤——AdminRoleChangeRequest 有无 user 关系执行时看 schema，无关系则先按 userNo 查 user 再按 targetUserId 过滤，**在 controller 层做**，不给前端 UUID）**
- [ ] **Step 3: preview：侧栏入口出现 → 列表 → 详情 → 从成员页提交一张申请自动跳详情。三截图。四道 tsc**
- [ ] **Step 4: Commit** `feat(roles): 绑定变更申请单入口+业务号化——孤儿页变公民（铁律⑥）`

## Task 26：角色定义修改申请单页面 + 权限字典死行清理

**Files:**
- Create: `admin-web/src/pages/RoleDefinitionModifyRequestsPage.tsx` + `RoleDefinitionModifyRequestDetailPage.tsx`
- Modify: `admin-web/src/App.tsx`（`iam/role-definition-requests` 两条路由）+ `DashboardLayout.tsx`（并入 Step 1 的 Role Change Requests 同组，或合并为一页两 tab——**做成两 tab**：既有 RoleChangeRequestsPage 外套一层 tab 容器「绑定变更 / 定义修改」，少一个侧栏项）
- Modify: `src/modules/identity/access-control/access-control.controller.ts:71-85`（详情 `:id`→`:requestNo`）+ catalog 行同步
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（**删 12 死行**：`PUT /admin/iam/users/:id/roles`、`POST /admin/compliance/customers/:id/simulate-expired`、4 条 `/admin/funds-layer/*`、`POST /wallets`、`POST /assets`、`PATCH /assets/:id/status`、`POST /withdraw-transactions`、`POST /withdraw-transactions/mock`、`GET /treasury/customer/:customerId/assets`；连带删 `PermissionGroup` 联合类型里的 `INTERNAL_TRANSFER_READ`/`INTERNAL_TRANSFER_WRITE` 两个孤儿组成员）
- Test: preview + verify:rbac

- [ ] **Step 1: 新列表页**（照 `RoleChangeRequestsPage.tsx` 的结构抄：表格列 = requestNo / roleCode / 提交人 / 状态（含 REJECTED/FAILED 徽章）/ 时间；数据源 `GET /admin/iam/role-definition-modify-requests`）；详情页展示 beforeData/afterData diff + failureReason + approvalCaseNo 链接
- [ ] **Step 2: 死行删除 + `db:base:sync` + 重启；S7 白名单清空（若 Task 23 走了白名单方案）**
- [ ] **Step 3: verify:rbac 全绿（S7 此后守住字典真实性）+ 四道 tsc + preview 截图（两 tab、驳回一张后状态显示 REJECTED）**
- [ ] **Step 4: Commit** `feat(roles): 修改申请单可见 + 权限字典 12 死行清零`

## Task 27：审批单周边五件

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`（12 死策略删除 + Wave 注释清理）
- Delete: `src/modules/governance/approvals/scripts/migrate-policy-steps-config.ts`
- Modify: `src/modules/governance/approvals/approvals.service.ts`（no-op `projectGovernanceApprovalDecision` 及 4 处调用删除；`buildEventPayload:251-254` 归因修正）
- Modify: `src/modules/governance/approvals/approval-policy.service.ts`（source diff 判定 + availableRoles 下发）+ 对应 controller
- Modify: `admin-web/src/pages/ApprovalPoliciesPage.tsx`（`AVAILABLE_ROLES:39-46` 删除改读响应；显示名映射；`:144` 跳转路径改 `/admin/governance/policy-change-requests/...` 若该树有路由，无则保持 `/dashboard` 现状并注明）
- Modify: `doc-final/PRODUCTION-NOTES.md`（`allowRetry` 死列一行）
- Test: 既有 approvals spec + preview

- [ ] **Step 1: 12 死策略整块删除**（键名见事实底稿；同时从 `DEFAULT_APPROVAL_POLICIES` 与任何启用名单里移除；`grep -rn "<键名>" src` 全仓核实除 constants 外零引用后再删——ASSET_LISTING 在 `audit-actions.constant.ts:520` 的注释引用一并改写）
- [ ] **Step 2: 归因修正**：

```typescript
    const decidedStep = [...(approval.steps || [])]
      .sort((a: any, b: any) => b.stepNo - a.stepNo)
      .find((s: any) => s.status !== ApprovalStepStatuses.PENDING && s.decidedByUserId);
```

（找「最后一个真有人裁决的步」；非末步驳回时高步被联动 CANCELLED 无裁决人，旧写法取到它导致 decisionBy 全 null）

- [ ] **Step 3: source diff**：`listV1Policies` 的 `source: hasOverride ? 'CUSTOMIZED' : 'DEFAULT'` 改为内容比对——`stepsConfig` 解析后与 `defaultPolicy.steps` 深比较（roles 数组排序后 JSON.stringify 相等）且 `timeoutHours`/`allowCancel` 相等 → `'DEFAULT'`，否则 `'CUSTOMIZED'`（seed 全量 upsert 的现实下，重铺库 27 条应显 DEFAULT；站 3 改一条后当场翻 CUSTOMIZED）
- [ ] **Step 4: availableRoles 下发**：策略列表响应加 `availableRoles: RBAC_ROLE_DEFINITIONS.filter(r => r.code !== 'SUPER_ADMIN').map(r => ({ code: r.code, name: r.name }))`；前端删 `AVAILABLE_ROLES` 常量改读响应渲染 toggle；显示名映射表（actionType → 中文/友好名）就地建于页面文件，覆盖全部现役策略键
- [ ] **Step 5: spec 断言 source diff（重铺态 DEFAULT / 改后 CUSTOMIZED 两条）+ preview 截图（角色 toggle 出现 OPS_OFFICER/CFO；徽章翻转）+ 四道 tsc + jest governance**
- [ ] **Step 6: Commit** `refactor(approvals): 死策略清零 + 角色册下发 + Source 真 diff + 归因修正`

## Task 28：退役清单扫尾

**Files:**
- Modify: `src/modules/identity/users/users.domain.service.ts`（Task 9 已删 completeFirstLogin——核对）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（`AuditUserActions:151-167` 删除）
- Modify: `src/modules/identity/access-control/role-definition-create-workflow.service.ts` / `role-definition-modify-workflow.service.ts`（`SYSTEM_ACTOR` 死常量×2、未用 import×4 删）
- Modify: `src/modules/identity/access-control/access-control.service.ts`（`SOFT_WARNING_ROLE_GROUPS` 空转链：catalog `:198` 空数组 + `buildSoftWarnings:46-54` + 返回值拼接，整链删）
- Modify: `admin-web/src/pages/RolesPage.tsx:264`（死筛选项 INACTIVE 删）
- Modify: `admin-web/src/pages/ApprovalDetailPage.tsx:66-69`（幻影字段 canApprove/availableDecisionRoles/evidencePackage 的 step 级声明删）
- Modify: `src/modules/identity/users/dto/create-role-change-request.dto.ts:29-31`（弃用 traceId 字段删）
- Modify: 三处「扫源码文本」型断言（`role-definition-modify-workflow.service.spec.ts:164-168` 等 readFileSync 断言）→ 换成行为断言（断 mock 入参/落库行）或直接删除该用例（若 Task 5/10 的新行为断言已覆盖同一主张）

- [ ] **Step 1: 逐项删除，每删一项 `grep -rn "<名>" src admin-web/src` 确认零引用**
- [ ] **Step 2: 四道 tsc + jest（identity + access-control + governance）全绿**
- [ ] **Step 3: Commit** `chore: 退役清单扫尾——死常量/死字段/幻影声明/文本断言清零（退役也是治愈）`

---

# 波三 · 剧本与判据

## Task 29：`verify:act1` 行为校验器（15 判据）

**Files:**
- Create: `scripts/verify-act1.ts`
- Modify: `package.json`（`"verify:act1": "ts-node -r tsconfig-paths/register scripts/verify-act1.ts"`）
- Modify: `doc-final/demo/baseline.md`（运行顺序章程并入）

**Interfaces:**
- Consumes: 波一/波二全部产出
- Produces: `npm run verify:act1` 退出码 0=全过，非 0=打印首条不符

**三条铁规矩（照 verify-rbac 的教训）**：① 端口从 `.stackports` 读绝不写死（写死打到 main 栈）；② 每条判据先路径存在性预检（404 冒充「非 403=通过」的假绿仓内栽过）；③ 真登录真 HTTP，禁扫源码。

- [ ] **Step 1: 写校验器**——骨架（登录/调用/预检/judge 函数）照下式，15 条判据全列：

```typescript
// scripts/verify-act1.ts —— 第一幕系统属性行为校验器
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';

function apiBase(): string {
  const raw = readFileSync(join(__dirname, '..', '.stackports'), 'utf8');
  const port = /BACKEND_PORT=(\d+)/.exec(raw)?.[1];
  if (!port) throw new Error('.stackports 里读不到 BACKEND_PORT——先 stack.sh up');
  return `http://localhost:${port}`;
}
const API = apiBase();
const prisma = new PrismaClient();
const results: Array<{ id: string; ok: boolean; msg: string }> = [];
const judge = (id: string, ok: boolean, msg: string) => { results.push({ id, ok, msg }); console.log(`${ok ? '✓' : '✗'} ${id} ${msg}`); };
async function login(u: string): Promise<string> {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${u}@fiatx.com`, password: '123456' }),
  });
  const j: any = await r.json();
  if (!j.access_token) throw new Error(`登录失败: ${u}`);
  return j.access_token;
}
const call = (p: string, t: string, m = 'GET', body?: any) => fetch(`${API}${p}`, { method: m, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
async function precheck(p: string, t: string) { const r = await call(p, t); if (r.status === 404) throw new Error(`预检失败：${p} 404，判据路径写错`); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
```

**15 条判据清单（实现顺序即运行顺序）**：

```
B0  ⚡ simulate-timeout 端点可用（POST 200/201）
B1  ⑥ 拨过去的 PENDING 单 ≤90 秒内被 cron 判 EXPIRED（轮询 prisma）
B2  ⑥ 未到期 PENDING 单同轮不被误杀
B3  ⑥ 对已过期单再打 ⚡ → 400 而非 500
B4  ⑨ GET /admin/control-gates/approvals/<approvalNo> → 200
B5  ⑨ 同路径拿 UUID → 404
B6  ⑨ GET /users/<userNo> → 200 且 GET /users/<uuid> → 404（钱包同构合并判：/wallets/<walletNo> 200 + <uuid> 404）
B7  ⑦ 对 ACTIVE 资产再打激活 → 409 且报文含 "Invalid transition"
B8  ① B1 那张单按 approvalNo 查审计 → APPROVAL_EXPIRED 一行且 from=PENDING/to=EXPIRED
B9  ① 两步单两票各批（造 DEPOSIT_SEIZE 形状夹具，sm→mlro 两 token 真打 approve）→ APPROVAL_GRANTED 恰 2 行
B10 ⑦ 提一张角色定义修改申请 → ciso 拒绝 → 单据 status===REJECTED（不是 CANCELLED）
B11 ① 403 留痕：auditor 打 POST /admin/reconciliation/runs/wallet → 403 → 审计出现 ADMIN_ACCESS_DENIED 且 actorNo=auditor 的 ADM 号
B12 ⑦ 对 ACTIVE 管理员直接打 reactivate → 409
B13 ⑤ 收编生效：auditor POST /admin/material-management/holdings/<某id>/simulate-stage → 403
B14 ① 子表检索：取 B9 夹具单的 entityRef（业务号）打 GET /admin/audit-logs?subjectNo=<该号>（路径实证 rbac.catalog:412）→ 结果含主体为审批单的行
```

每条动手前 precheck 路径；B9/B10 的夹具经 prisma 直造（与 Task 4/10 的 e2e 同构）；结尾统计 `n/15 PASS`，有红打印首条并 `process.exit(1)`。

- [ ] **Step 2: 注册 package.json；`bash scripts/on-stack.sh self verify:act1` 跑到 15/15**
- [ ] **Step 3: 变异回验（逐条，不能跳）**：注释 @Cron→B1 红；迁移表加 ACTIVE.ACTIVATE 自环→B7 红；`:approvalNo` 改回 `:id`→B4/B5 红；guard 的 recordDenied 注释→B11 红；approve 的 requestId 删→B9 红；守卫从材料 controller 摘掉→B13 红。全部恢复后 15/15
- [ ] **Step 4: baseline.md 追加**：verify:act1 会写数据（EXPIRED 单、REJECTED 申请、若干 403 审计行）；顺序章程 `verify:rbac → verify:act1 → stack.sh reset → demo:all`，**绝不在演示前跑**
- [ ] **Step 5: Commit** `test(act1): verify:act1 十五判据——⑥⑦⑨①⑤ 逐条变异实证`

## Task 30：剧本扩写（第一幕 5 站 → 6 站）+ 数据字典

**Files:**
- Modify: `doc-final/demo/script.md`（第一幕）
- Modify: `doc-final/demo/data.md`（站 0 演员注记）

- [ ] **Step 1: script.md 第一幕头部**「收敛为 5 站」改「收敛为 6 站」；插入站 0：

```markdown
**站 0 · 进人**（先有人，再有权——管理员的一生）
账号：`ciso@`（发起，maker）→ `sm@`（ADMIN_INVITE_APPROVAL checker）；新人视角用浏览器隐身窗
走查：① `ciso@` 成员页 Invite Member（角色选 OPS_OFFICER，邮箱现编）→ 审批中心出现邀请审批 → ② 换 `sm@` 批准 → ③ 回成员详情页复制激活链接（通知是空壳，链接就在卡片上——这是演示装置，讲清）→ 隐身窗打开：确认身份 → 扫 QR 绑 TOTP（任意认证器 App）→ 首登完成上岗 → ④ `ciso@` 提停用 → `sm@` 批准 → 新人刷新页面即被登出（下次请求失效）→ ⑤ 恢复审批走一遍 → 复活
期望：邀请/停用/恢复三案全是 maker/checker；管理员的一生五步连贯；重铺后第一幕开场审计页就有货（站 0 自己产证据）
```

- [ ] **Step 2: 站 3 追加第三结局**：

```markdown
⑤ `sm@` 再提一张策略变更 → 详情页点 ⚡ 模拟超时 → 一分钟内刷新 → 状态 EXPIRED，
   审计按该单号查得到 APPROVAL_EXPIRED（谁都没批，时间到了）；顺带看策略页——
   刚被改过的那条 Source 徽章已从 DEFAULT 翻成 CUSTOMIZED
期望：批准 / 当场拒绝 / 超时作废三种结局都演到
```

- [ ] **Step 3: 站 1 追加**：内审 403 之后「切审计页按 actorNo=内审查出那条 ADMIN_ACCESS_DENIED——『默默拦下是被禁止的』当场兑现」；**删除**幕尾「重铺后新词表零写入需垫一笔」的说明（站 0 已天然产证据）
- [ ] **Step 4: 第七幕追加两展品**：按内审 actorNo 拉越权记录；「关联单号」筛选输一张提现单号捞跨主体全链
- [ ] **Step 5: data.md 站 0 注记（新人邮箱现编、TOTP 用任意认证器、隐身窗切视角）；Commit** `docs(demo): 第一幕六站——站 0 进人 + 三结局审批 + 403 展品`

## Task 31：全幕真人走查 + 收尾闸

- [ ] **Step 1: 重铺造数**：`bash scripts/stack.sh reset self && bash scripts/on-stack.sh self demo:all`
- [ ] **Step 2: 按新 script.md 第一幕六站逐站真登录点完**，每站三查（走通没有 / 页面对不对 / 审计查得到吗），逐站截图；站 0 全程含隐身窗首登
- [ ] **Step 3: 撞到的问题当场分流**：业务缺口→BACKLOG；技术兜底→PRODUCTION-NOTES；工具环境→TOOLING-DEBT
- [ ] **Step 4: 收尾闸全家**（顺序敏感）：

```bash
bash scripts/on-stack.sh self verify:rbac
bash scripts/on-stack.sh self verify:act1
bash scripts/stack.sh reset self
bash scripts/on-stack.sh self demo:all
bash scripts/on-stack.sh self verify:coa
bash scripts/on-stack.sh self verify:audit
bash scripts/on-stack.sh self recon:demo:pass
bash scripts/on-stack.sh self recon:demo:break
```

判据对照 baseline.md **全绿**；动过 schema/seed 与否按实际叠重铺闸
- [ ] **Step 5: Commit（走查产生的截图路径与问题清单进 progress 台账）**

## Task 32：文档同步 + 销账

**Files:**
- Modify: `doc-final/modules/v1-governance.md`（§4 六站对应、§5 词表数字实测更新、§6 删「V3 词汇未入册」与「重铺后零写入垫场」两条已解缺口）
- Modify: `doc-final/modules/v3-financial-config.md`（§5 审计合同覆盖说明；表头 Last Verified）
- Modify: `doc-final/BACKLOG.md`（销账：expirePendingApprovals 无调用方 ⭐Q3 ｜ 自动解锁审计留空旧账 ｜ 其余对照走查清单）
- Modify: `doc-final/PRODUCTION-NOTES.md`（追加：`allowRetry` 死列 ｜ 10 条客户端路由依赖守卫对非 ADMIN 放行的结构脆弱性——收编未动它，挂账）
- Modify: `doc-final/CHANGELOG.md`（一条 2026-09-0X 业务口径变更，按既有格式）
- Modify: `doc-final/demo/baseline.md`（Task 29 已并入顺序章程——核对）

- [ ] **Step 1: 逐文件同步（数字一律以本轮实测为准，禁抄设计稿的预估值）**
- [ ] **Step 2: 四道 tsc（文档改动跑一遍兜底）+ Commit** `docs: 四模块治愈收尾——模块篇/剧本/账本三层对齐`

---

## 已知风险与执行者须知（全计划级）

1. **Task 12 与 Task 14 的退役名册顺序耦合**：8 个 CREATION_*/CHANGE_* 裸名被费率与限额两族共用，退役登记统一放 Task 14；Task 12 只改码不登退役。乱序会让限额族写入当场被拒
2. **RBAC/catalog 改动（Task 2/17/18/24/25/26）必须 `db:base:sync` + 重启后端**——内存定义，只 seed = 白做
3. **Task 17–21 是成对手术**：entityRef 生产/消费必须同 commit 落地，改一半 = 审批批完落不了地；每域收尾跑该域 jest + demo:all 花名册兜底
4. **Task 6 拆吞错是行为变化**：翻红的用例修传参，不许回退纪律；mfa 三处的旧注释必须同步改写
5. **verify 判据先变异后上岗**（Task 16/23/29 各自明列变异步骤，不能跳）——自证型绿灯仓内栽过六次
6. **并行会话在动 main**：worktree 施工；合并前 merge main 复跑 verify:rbac + verify:act1 + demo:all；`rbac.catalog.ts`/`approval.constants.ts` 冲突高发
7. **法一改动会放大审计行数**（403 留痕、每票一行、重发留痕）：`verify:audit` 若有行数上限类断言翻红，按新语义修判据而非收紧写入
8. **收编改变可达面**（Task 24）：材料 4 读挂 CUSTOMER_READ 与前端现状一致、演示动线不断；模拟端点挂 DEMO_* 后不持该组的职务失去按钮——⚡ 面板按端点渲染（rbac.catalog `:302` 注释），面板自动跟随
9. 行号随并行会话漂移：**内容锚点为准**；任何 old_string 不唯一时先 grep 再动手
