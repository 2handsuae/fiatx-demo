# 第七幕波二 · 留痕补齐与归因 —— 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让"人和事都查得到"成立——V1 治理域 9 文件存量 48 处审计调用补 subjects 镜像(+2 新打点=50)、材料下发带操作人、MFA 锁定补打点、删 customers 裸 CRUD、verify:audit 升级名册断言。

**Architecture:** 纯后端写入面。每个 workflow 文件加一个私有 subjects helper（镜像主表 primary 进子表 + 审批单 INSTRUMENT 行），48 处存量调用每处 diff 一行；verify:audit 从"任取一条自证"升级为按名册逐码断言覆盖面。

**Tech Stack:** NestJS + Prisma + SQLite ｜ jest 单测（mock 服务依赖）｜ ts-node 验证脚本

**Spec:** `doc-final/superpowers/specs/2026-09-16-act7-wave2-audit-attribution-design.md`（范围权威；总纲波二节）

## Global Constraints（每个任务隐含遵守）

- **Node 20 前置**：本机 shell 默认 node18，每条命令先 `export PATH="$(ls -d "$HOME"/.nvm/versions/node/v20*/bin | tail -1):$PATH"`
- **工作树**：执行在独立 worktree `.claude/worktrees/act7_wave2/`（树名下划线，不用连字符）+ 独立分支 + 自动分栈；jest / tsc 全部在 worktree 的 `Exchange_js/` 根下跑
- **不动 schema / seed / 前端**（前端零文件改动，②③⑧ 闸均不触发）
- **随手闸**：每任务收尾 `npx tsc --noEmit -p tsconfig.json` + 本任务相关 jest 全绿
- **测试纪律**：禁止「扫源码文本」型断言；涉 audit-logging 查询侧 mock 一律用 `audit-logs.service.spec.ts` 顶层的 `mockFindManyByWhere`（行为化，按 where 真过滤），禁止 `mockResolvedValue` 无视 where
- **subjects 统一规则（spec §1.2 原文）**：镜像行 subjectType/subjectNo = 该调用主表 `primarySubjectType`/`primarySubjectNo` **原值**，role PRIMARY；该调用点已有 approvalNo **在手（本地变量）或已写进顶层/metadata** 时加 `{ APPROVAL_CASE, <同一值>, INSTRUMENT }`，没有就不加、不查库凑行（Task 1 评审裁定 2026-09-16：REQUESTED 处 `approvalCase.approvalNo` 属"在手"，加行正确）
- **派发模型**（项目 CLAUDE.md §6）：任务执行与任务级评审 → sonnet；终审 → 主会话 Fable；子代理 prompt 须带项目 CLAUDE.md §0–§5 要点
- **commit**：每任务一 commit，只 add 具名文件

---

### Task 1: 停用/恢复两文件 subjects（样板任务，钉死 helper 形状）

**Files:**
- Modify: `src/modules/identity/users/admin-suspension-workflow.service.ts`（record 调用 :111/:154/:179）
- Modify: `src/modules/identity/users/admin-reactivation-workflow.service.ts`（:110/:152/:176）
- Test: `src/modules/identity/users/admin-suspension-workflow.service.spec.ts`、`admin-reactivation-workflow.service.spec.ts`

**Interfaces:**
- Produces: 私有 helper `adminSubjects(userNo: string, approvalNo?: string | null): AuditSubjectInput[]` 的标准形状——Task 2/3/4 逐文件复制同款（各文件自持，不抽公共模块，YAGNI）

- [ ] **Step 1: 写失败测试** —— 两个 spec 文件里现有的 REQUESTED/APPLIED 断言块（suspension spec :71-93 一带）各追加 subjects 断言：

```ts
// REQUESTED（recordByActor 捕获处，紧跟现有 expect(req[0]...) 之后）
expect(req[0].subjects).toEqual([
  { subjectType: 'ADMIN_USER', subjectNo: targetUser.userNo, subjectRole: 'PRIMARY' },
  { subjectType: 'APPROVAL_CASE', subjectNo: 'APR2608260001', subjectRole: 'INSTRUMENT' },
]);
// APPLIED 成功分支（recordSystem 捕获处）
expect(app[0].subjects).toEqual([
  { subjectType: 'ADMIN_USER', subjectNo: targetUser.userNo, subjectRole: 'PRIMARY' },
  { subjectType: 'APPROVAL_CASE', subjectNo: 'APR2608260001', subjectRole: 'INSTRUMENT' },
]);
// APPLIED 失败分支同款（subjectNo 取该用例断言的 userNo/entityRef 值）
```

字面量 `'APR2608260001'` 以各 spec 顶部 approvals mock 实际返回值为准（与既有 `app[0].approvalNo` 断言同源）；REQUESTED 处若 mock 的 approvalCase.approvalNo 是别的常量，照那个常量写。reactivation spec 同构追加。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/identity/users/admin-suspension-workflow.service.spec.ts src/modules/identity/users/admin-reactivation-workflow.service.spec.ts`
Expected: FAIL —— `expect(received).toEqual(expected)`，received 为 undefined（现在不传 subjects）

- [ ] **Step 3: 实现** —— 两文件各加 helper（放在既有私有方法区），既有 dto import 行补 `AuditSubjectInput, AuditSubjectRole`：

```ts
import { AuditOutcome, AuditSubjectInput, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
// （以文件现有 import 为基础扩展，勿重复导入）

/** 波二 §1.2：镜像主表 PRIMARY 进子表（Related No 检索只查子表，audit-logs.service.ts:1031-1036）
 *  + 审批单凭据行。形状照 approvals.service.ts approvalSubjects 先例。 */
private adminSubjects(userNo: string, approvalNo?: string | null): AuditSubjectInput[] {
  const rows: AuditSubjectInput[] = [
    { subjectType: AuditEntityTypes.ADMIN_USER, subjectNo: userNo, subjectRole: AuditSubjectRole.PRIMARY },
  ];
  if (approvalNo) {
    rows.push({ subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: approvalNo, subjectRole: AuditSubjectRole.INSTRUMENT });
  }
  return rows;
}
```

六处调用各插一行（放 `primarySubjectNo` 行之后）：

| 文件 | 调用 | 插入行 |
|---|---|---|
| suspension :111 REQUESTED | `subjects: this.adminSubjects(targetUser.userNo, approvalCase.approvalNo),` |
| suspension :154 APPLIED 成功 | `subjects: this.adminSubjects(result.userNo, event.approvalNo),` |
| suspension :179 APPLIED 失败 | `subjects: this.adminSubjects(before?.userNo ?? event.entityRef, event.approvalNo),` |
| reactivation :110 REQUESTED | `subjects: this.adminSubjects(targetUser.userNo, approvalCase.approvalNo),` |
| reactivation :152 APPLIED 成功 | `subjects: this.adminSubjects(result.userNo, event.approvalNo),` |
| reactivation :176 APPLIED 失败 | `subjects: this.adminSubjects(before?.userNo ?? event.entityRef, event.approvalNo),` |

（行号是基线 `429e1689` 实测；以 `grep -n "action: '"` 现场对位。表达式即该调用现有 `primarySubjectNo`/顶层 `approvalNo` 字段的同一值。）

- [ ] **Step 4: 跑测试确认通过**

Run: 同 Step 2。Expected: PASS 全绿

- [ ] **Step 5: 随手闸 + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/modules/identity/users/admin-suspension-workflow.service.ts src/modules/identity/users/admin-suspension-workflow.service.spec.ts src/modules/identity/users/admin-reactivation-workflow.service.ts src/modules/identity/users/admin-reactivation-workflow.service.spec.ts
git commit -m "feat(审计波二): 停用/恢复两 workflow 补 subjects 镜像——PRIMARY 镜像行+APPROVAL_CASE 凭据行"
```

---

### Task 2: admin-invite subjects（9 处，ACCESS_CONTROL 遗留按原值镜像）

**Files:**
- Modify: `src/modules/identity/users/admin-invite-workflow.service.ts`（:138/:160/:225/:253/:286/:353/:410/:447/:503）
- Test: `src/modules/identity/users/admin-invite-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 helper 形状
- Produces: 无（本文件自持 helper `inviteSubjects`）

- [ ] **Step 1: 写失败测试** —— invite spec 对 REQUESTED / DISPATCHED / ACCEPTED 各追加（照 Task 1 的 `mock.calls.find` 手法定位调用）：

```ts
expect(call[0].subjects).toEqual(
  expect.arrayContaining([
    { subjectType: 'ACCESS_CONTROL', subjectNo: <该用例断言的 userNo 值>, subjectRole: 'PRIMARY' },
  ]),
);
// 有 approvalNo 顶层字段的调用（REQUESTED 等）额外断言完整 toEqual 两行数组，
// 无 approvalNo 的调用（ACCEPTED/EXPIRED）断言 toEqual 单行数组。
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/identity/users/admin-invite-workflow.service.spec.ts`
Expected: FAIL（subjects undefined）

- [ ] **Step 3: 实现** —— helper（注意本文件镜像的是主表原值 ACCESS_CONTROL，不改型）：

```ts
/** 波二 §1.2 镜像主表原值。本家族 primarySubjectType 历史上是 ACCESS_CONTROL 而号是 userNo
 *  （:413 注释自认"对齐同旅程"）——波二只镜像不改型（改型是展示/跳转面变化，越界；
 *  已登记 BACKLOG 观察）。判据按 subjectNo 匹配，不受类型影响。 */
private inviteSubjects(userNo: string, approvalNo?: string | null): AuditSubjectInput[] {
  const rows: AuditSubjectInput[] = [
    { subjectType: AuditEntityTypes.ACCESS_CONTROL, subjectNo: userNo, subjectRole: AuditSubjectRole.PRIMARY },
  ];
  if (approvalNo) {
    rows.push({ subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: approvalNo, subjectRole: AuditSubjectRole.INSTRUMENT });
  }
  return rows;
}
```

9 处调用逐一插行，第一参 = 该调用现有 `primarySubjectNo` 表达式（:142 `user.userNo`、:164 `user.userNo`、:229/:257/:290 `user.userNo`、:357 `user.userNo`、:416 `accepted.userNo`、:451 `targetUserNo || 'UNKNOWN'`、:507 `invitation.user.userNo`），第二参 = 该调用已有的顶层 `approvalNo` 值（REQUESTED 两处 `approvalCase.approvalNo`；:236/:296 对应调用 `event.approvalNo`；其余无则省略）。

- [ ] **Step 4: 跑测试确认通过** —— 同 Step 2，PASS
- [ ] **Step 5: 随手闸 + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/modules/identity/users/admin-invite-workflow.service.ts src/modules/identity/users/admin-invite-workflow.service.spec.ts
git commit -m "feat(审计波二): 邀请 workflow 九处补 subjects 镜像(按主表原值 ACCESS_CONTROL,遗留不改型)"
```

---

### Task 3: password-reset + mfa-reset subjects（10 处）

**Files:**
- Modify: `src/modules/identity/users/admin-password-reset-workflow.service.ts`（:163/:266/:351/:375/:418/:489）
- Modify: `src/modules/identity/users/admin-mfa-reset-workflow.service.ts`（:116/:167/:192/:219）
- Test: 两文件同名 `.spec.ts`

**Interfaces:**
- Consumes: Task 1 helper 形状（两文件各自复制 `adminSubjects`，ADMIN_USER 版，代码与 Task 1 Step 3 完全一致）

- [ ] **Step 1: 写失败测试** —— 两 spec 对各码追加 subjects 断言（手法同 Task 1 Step 1；官员径 REQUESTED/APPLIED 断言双行数组，SELF 径 `officerRef?.approvalNo` 为 undefined 的用例断言单行数组）
- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/identity/users/admin-password-reset-workflow.service.spec.ts src/modules/identity/users/admin-mfa-reset-workflow.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现** —— 复制 Task 1 Step 3 的 `adminSubjects` helper 进两文件；10 处插行，第一参 = 各调用现有 `primarySubjectNo` 表达式（password-reset :167 `user.userNo`、:270 `target.userNo`、:355/:379 `target?.userNo ?? event.entityRef`、:422/:493 `userNo`；mfa-reset :120 `targetUser.userNo`、:171 `result.userNo`、:196 `before?.userNo ?? event.entityRef`、:223 `target?.userNo ?? event.entityRef`），第二参 = 该调用已有顶层 `approvalNo` 值（password-reset SELF 径 :120 一带是 `officerRef?.approvalNo` 可为空，helper 天然吞 undefined；mfa-reset 三处 `event.approvalNo` / REQUESTED 处 `approvalCase.approvalNo`）
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 随手闸 + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/modules/identity/users/admin-password-reset-workflow.service.ts src/modules/identity/users/admin-password-reset-workflow.service.spec.ts src/modules/identity/users/admin-mfa-reset-workflow.service.ts src/modules/identity/users/admin-mfa-reset-workflow.service.spec.ts
git commit -m "feat(审计波二): 密码重置/MFA重置两 workflow 补 subjects 镜像"
```

---

### Task 4: mfa-binding subjects（12 处）+ `verifyMfaCode` 锁定打点（spec §3）

**Files:**
- Modify: `src/modules/identity/users/mfa-binding-workflow.service.ts`（12 处既有调用 :165/:212/:297/:337/:361/:393/:409/:478/:514/:561/:586 旁/:609；`verifyMfaCode` :240-275 新增 2 处）
- Test: `src/modules/identity/users/mfa-binding-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 helper 形状；本文件既有 `buildActor(:109)`、`findLatestLockAppliedCorrelationId(:585 一带)`

- [ ] **Step 1: 写失败测试** —— ① 既有各码断言追加 subjects（同 Task 1 手法；本文件全部无 approvalNo，一律单行数组）；② `verifyMfaCode` 新增两用例：

```ts
describe('verifyMfaCode 锁定路径打点（波二 §3）', () => {
  it('连续失败触发锁定时写 ADMIN_ACCOUNT_LOCK_APPLIED', async () => {
    usersDomainService.incrementMfaVerifyFail.mockResolvedValue({ newCount: 5, locked: true });
    await expect(service.verifyMfaCode('user-1', '000000')).rejects.toThrow();
    const lock = auditLogsService.recordByActor.mock.calls.find(
      (c: any[]) => c[0].action === 'ADMIN_ACCOUNT_LOCK_APPLIED',
    );
    expect(lock).toBeDefined();
    expect(lock[0].primarySubjectNo).toBe(user.userNo);
    expect(lock[0].reasonCode).toBe('MFA_VERIFY_LOCKOUT');
    expect(lock[0].subjects).toEqual([
      { subjectType: 'ADMIN_USER', subjectNo: user.userNo, subjectRole: 'PRIMARY' },
    ]);
  });

  it('过期锁的首次尝试惰性解封并写 ADMIN_ACCOUNT_LOCK_RELEASED', async () => {
    // loadUser mock 返回 mfaVerifyLockedUntil = 过去时间
    await service.verifyMfaCode('user-1', validCode);
    const rel = auditLogsService.recordByActor.mock.calls.find(
      (c: any[]) => c[0].action === 'ADMIN_ACCOUNT_LOCK_RELEASED',
    );
    expect(rel).toBeDefined();
    expect(usersDomainService.clearMfaVerifyFail).toHaveBeenCalled();
    expect(rel[0].fromStatus).toBe('LOCKED');
    expect(rel[0].toStatus).toBe('ACTIVE');
  });
});
```

（mock 变量名/user fixture 以该 spec 文件既有设置为准；OTP mock 已有的沿用，让 validCode 用例走 verify 成功路径。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/identity/users/mfa-binding-workflow.service.spec.ts`
Expected: FAIL（既有码 subjects undefined；新用例找不到 LOCK 记录）

- [ ] **Step 3: 实现** —— ① 复制 Task 1 的 `adminSubjects` helper；12 处既有调用插 `subjects: this.adminSubjects(<该调用现有 primarySubjectNo 表达式>),`（全文件均 `user.userNo` / `event.userNo`，无 approvalNo）。② `verifyMfaCode` 改为（对齐姊妹 verifyMfaBind :293-315 / :353-374 两处模板）：

```ts
async verifyMfaCode(userId: string, code: string): Promise<void> {
  const user = await this.loadUser(userId);
  if (!user.mfaSecret) {
    throw new ForbiddenException('MFA not bound');
  }

  // 波二 §3：对齐 verifyMfaBind 的惰性解封——过期锁的首次尝试先清计数并留痕再继续。
  // correlationId 回查最近一条 APPLIED（applied/released 配对共享旅程，
  // 同 findLatestLockAppliedCorrelationId 的既有模式；本流程没有 firstLoginTraceId 可借）。
  if (user.mfaVerifyLockedUntil && user.mfaVerifyLockedUntil <= new Date()) {
    await this.usersDomainService.clearMfaVerifyFail(userId);
    await this.auditLogsService.recordByActor(
      {
        action: 'ADMIN_ACCOUNT_LOCK_RELEASED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: AuditEntityTypes.ADMIN_USER,
        primarySubjectNo: user.userNo,
        correlationId: await this.findLatestLockAppliedCorrelationId(user.userNo),
        fromStatus: 'LOCKED',
        toStatus: 'ACTIVE',
        reason: 'MFA verify lockout expired',
        subjects: this.adminSubjects(user.userNo),
        requestId: randomUUID(),
        sourcePlatform: 'ADMIN_API',
      },
      this.buildActor(user),
    );
  }

  if (user.mfaVerifyLockedUntil && user.mfaVerifyLockedUntil > new Date()) {
    throw new TooManyRequestsException({
      message: 'MFA verification temporarily locked',
      retryAfterSeconds: this.retryAfterSeconds(user.mfaVerifyLockedUntil),
    });
  }

  const secret = decryptMfaSecret(user.mfaSecret);
  const otp = await getOtp();
  const verifyResult = otp.verifySync({ token: code, secret, window: 1 });
  const isValid = verifyResult.valid;

  if (!isValid) {
    const { newCount, locked } = await this.usersDomainService.incrementMfaVerifyFail(userId);

    if (locked) {
      // 波二 §3：锁定被施加是独立事件，对齐 verifyMfaBind 同款模板（START 现铸 correlationId）。
      // 留痕失败即流程失败：审计写入不吞错。
      await this.auditLogsService.recordByActor(
        {
          action: 'ADMIN_ACCOUNT_LOCK_APPLIED',
          actionDomain: 'IAM',
          category: AuditCategory.GOVERNANCE,
          primarySubjectType: AuditEntityTypes.ADMIN_USER,
          primarySubjectNo: user.userNo,
          correlationId: randomUUID(),
          reasonCode: 'MFA_VERIFY_LOCKOUT',
          fromStatus: 'ACTIVE',
          toStatus: 'LOCKED',
          metadata: { failCount: newCount },
          subjects: this.adminSubjects(user.userNo),
          requestId: randomUUID(),
          sourcePlatform: 'ADMIN_API',
        },
        this.buildActor(user, 'TOTP'),
      );
      throw new TooManyRequestsException({
        message: 'MFA verification locked due to too many failed attempts',
        retryAfterSeconds: 15 * 60,
      });
    }

    throw new ForbiddenException({
      message: 'Invalid MFA code',
      attemptsRemaining: Math.max(0, 5 - newCount),
    });
  }

  await this.usersDomainService.clearMfaVerifyFail(userId);
}
```

- [ ] **Step 4: 跑测试确认通过** —— 同 Step 2，PASS
- [ ] **Step 5: 随手闸 + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/modules/identity/users/mfa-binding-workflow.service.ts src/modules/identity/users/mfa-binding-workflow.service.spec.ts
git commit -m "feat(审计波二): mfa-binding 十二处补 subjects+verifyMfaCode 锁定路径补 LOCK_APPLIED/RELEASED 打点"
```

---

### Task 5: role-definition-create + approval-policy-change subjects（7 处）

**Files:**
- Modify: `src/modules/identity/access-control/role-definition-create-workflow.service.ts`（:130/:230/:257/:294）
- Modify: `src/modules/governance/approvals/approval-policy-change-workflow.service.ts`（:164/:248/:296）
- Test: 两文件同名 `.spec.ts`

- [ ] **Step 1: 写失败测试** —— 断言形状：

```ts
// role-definition-create（REQUESTED 例）
expect(req[0].subjects).toEqual([
  { subjectType: 'ACCESS_CONTROL', subjectNo: roleCode常量, subjectRole: 'PRIMARY' },
  { subjectType: 'APPROVAL_CASE', subjectNo: approval常量, subjectRole: 'INSTRUMENT' },
]);
// approval-policy-change（REQUESTED 例）——注意三行：镜像 + 被动策略 RELATED + 凭据
expect(req[0].subjects).toEqual([
  { subjectType: 'APPROVAL_POLICY', subjectNo: requestNo常量, subjectRole: 'PRIMARY' },
  { subjectType: 'APPROVAL_POLICY', subjectNo: targetActionType常量, subjectRole: 'RELATED' },
  { subjectType: 'APPROVAL_CASE', subjectNo: approval常量, subjectRole: 'INSTRUMENT' },
]);
```

（常量取各 spec 既有 mock/fixture 值。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/identity/access-control/role-definition-create-workflow.service.spec.ts src/modules/governance/approvals/approval-policy-change-workflow.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

role-definition-create 的 helper（同域先例 `role-definition-modify` 的注释坑不抄——那套不镜像 PRIMARY，spec §1.1 已定按 approvals 先例镜像）：

```ts
private roleSubjects(roleCode: string, approvalNo?: string | null): AuditSubjectInput[] {
  const rows: AuditSubjectInput[] = [
    { subjectType: AuditEntityTypes.ACCESS_CONTROL, subjectNo: roleCode, subjectRole: AuditSubjectRole.PRIMARY },
  ];
  if (approvalNo) {
    rows.push({ subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: approvalNo, subjectRole: AuditSubjectRole.INSTRUMENT });
  }
  return rows;
}
```

四处插行：:130 `this.roleSubjects(roleCode, approvalCase.approvalNo)`；:230/:257 `this.roleSubjects(role.code, event?.approvalNo)`；:294 `this.roleSubjects(role.code, event?.approvalNo)`（第二参一律取该调用已有顶层 `approvalNo` 值）。

approval-policy-change 的 helper（含被动目标 RELATED 行，spec §1.2 规则②唯一生效处）：

```ts
private policySubjects(requestNo: string, targetActionType: string, approvalNo?: string | null): AuditSubjectInput[] {
  const rows: AuditSubjectInput[] = [
    { subjectType: AuditEntityTypes.APPROVAL_POLICY, subjectNo: requestNo, subjectRole: AuditSubjectRole.PRIMARY },
    { subjectType: AuditEntityTypes.APPROVAL_POLICY, subjectNo: targetActionType, subjectRole: AuditSubjectRole.RELATED },
  ];
  if (approvalNo) {
    rows.push({ subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: approvalNo, subjectRole: AuditSubjectRole.INSTRUMENT });
  }
  return rows;
}
```

三处插行：:164 `this.policySubjects(requestNo, targetActionType, approvalCase.approvalNo)`；:248/:296 `this.policySubjects(request.requestNo, request.targetActionType, event.approvalNo)`。

- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 随手闸 + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/modules/identity/access-control/role-definition-create-workflow.service.ts src/modules/identity/access-control/role-definition-create-workflow.service.spec.ts src/modules/governance/approvals/approval-policy-change-workflow.service.ts src/modules/governance/approvals/approval-policy-change-workflow.service.spec.ts
git commit -m "feat(审计波二): 角色定义创建/审批策略变更补 subjects——策略变更含被动目标 RELATED 行"
```

---

### Task 6: audit-evidence-export subjects（4 处）+ 承接顺手项

**Files:**
- Modify: `src/modules/audit-logging/audit-evidence-export-workflow.service.ts`（:131/:172/:256/:289）
- Test: `src/modules/audit-logging/audit-evidence-export-workflow.service.spec.ts`

- [ ] **Step 1: 写失败测试** —— 各码追加（dto 路径注意本文件在 audit-logging 内，import 自 `./dto/audit-log.dto`）：

```ts
expect(call[0].subjects).toEqual(
  expect.arrayContaining([
    { subjectType: 'AUDIT_EVIDENCE_PACKAGE', subjectNo: <该用例的 packageNo 值>, subjectRole: 'PRIMARY' },
  ]),
);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/audit-logging/audit-evidence-export-workflow.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: 实现** —— helper：

```ts
private packageSubjects(packageNo: string, approvalNo?: string | null): AuditSubjectInput[] {
  const rows: AuditSubjectInput[] = [
    { subjectType: AuditEntityTypes.AUDIT_EVIDENCE_PACKAGE, subjectNo: packageNo, subjectRole: AuditSubjectRole.PRIMARY },
  ];
  if (approvalNo) {
    rows.push({ subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: approvalNo, subjectRole: AuditSubjectRole.INSTRUMENT });
  }
  return rows;
}
```

四处插行：:131 REQUESTED `this.packageSubjects(evidencePackage.packageNo, submitted.approvalNo || null)`；:172 DOWNLOADED `this.packageSubjects(found.packageNo)`（该调用如已有顶层 approvalNo 值则同传）；:256/:289 GENERATED `this.packageSubjects(evidencePackage.packageNo, this.normalizeOptionalString(event.approvalNo))`。

顺手项（承接记录第 5 条）：本 spec 文件里语义过时的 `'pkg-1'` 字面量（现在传的是 packageNo）更名为 `'EVP...'` 形字面量；只改动到的文件，不扩散。

- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 随手闸 + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/modules/audit-logging/audit-evidence-export-workflow.service.ts src/modules/audit-logging/audit-evidence-export-workflow.service.spec.ts
git commit -m "feat(审计波二): 证据包导出族补 subjects 镜像+spec 过时字面量顺手更名"
```

---

### Task 7: 材料下发归因（`MATERIAL_REQUEST_ISSUED` 改 recordByActor）

**Files:**
- Modify: `src/modules/identity/material-requests/material-requests.service.ts`（`create` :90 签名 + :146 审计调用）
- Modify: `src/modules/identity/material-requests/material-request-issuer.service.ts`（:129 `requests.create` 调用）
- Test: `src/modules/identity/material-requests/material-requests.service.spec.ts`、`material-request-issuer.service.spec.ts`

**Interfaces:**
- Produces: `MaterialRequestsService.create(input: IssueMaterialRequestInput, actor: ApprovalActorContext, tx?): Promise<MaterialRequestRow>`（签名加中位参）

- [ ] **Step 1: 前置核对** —— `requests.create` 的全部调用方（承接判例 4：改签名先全量 grep）：

Run: `grep -rn "\.create(" src/modules/identity/material-requests --include="*.ts" | grep -v "prisma\|client\|\.spec\."`
Expected: 生产调用方仅 `material-request-issuer.service.ts:129` 一处（issuer 头注自称"建行的唯一入口"）；spec 文件的调用在 Step 2 一并更新。若冒出计划外调用方 → 停下报告，不硬改。

- [ ] **Step 2: 写失败测试** —— material-requests.service.spec 中 ISSUED 断言改为：

```ts
const issued = auditLogsService.recordByActor.mock.calls.find(
  (c: any[]) => c[0].action === 'MATERIAL_REQUEST_ISSUED',
);
expect(issued).toBeDefined();
expect(issued[1].actorNo).toBe(actor.userNo);           // c[1] 是 actor 参数
expect(auditLogsService.recordSystem.mock.calls.find(
  (c: any[]) => c[0].action === 'MATERIAL_REQUEST_ISSUED',
)).toBeUndefined();                                      // 不再走 recordSystem
```

（spec 里 create 的调用点补第二参 actor fixture：`{ actorType: 'ADMIN', userId: 'u-1', userNo: 'ADM2601010001', roleCodes: ['COMPLIANCE_OFFICER'] }`。）

- [ ] **Step 3: 跑测试确认失败**

Run: `npx jest src/modules/identity/material-requests`
Expected: FAIL（tsc 层参数不符或断言失败）

- [ ] **Step 4: 实现**

material-requests.service.ts：

```ts
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';

async create(
  input: IssueMaterialRequestInput,
  actor: ApprovalActorContext,
  tx?: Record<string, any>,
): Promise<MaterialRequestRow> {
```

:146 审计调用改（其余字段含 `sourcePlatform: 'SYSTEM'`、subjects、metadata 一律不动；actor 映射照 `internal-transfer-workflow.service.ts:358` 先例；`client` 挪到第三参）：

```ts
const actorDisplay = actor.userNo ?? actor.userId;
await this.auditLogsService.recordByActor({
  action: AuditActions.MATERIAL_REQUEST_ISSUED,
  /* ……原有全部字段原样保留…… */
}, {
  actorType: 'ADMIN',
  actorNo: actorDisplay,
  actorDisplayName: actorDisplay,
  actorRolesAtTime: actor.roleCodes ?? [],
}, client);
```

material-request-issuer.service.ts :129：`this.requests.create(row, tx)` → `this.requests.create(row, actor, tx)`。

- [ ] **Step 5: 跑测试确认通过** —— `npx jest src/modules/identity/material-requests`，PASS
- [ ] **Step 6: 随手闸 + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/modules/identity/material-requests/material-requests.service.ts src/modules/identity/material-requests/material-requests.service.spec.ts src/modules/identity/material-requests/material-request-issuer.service.ts src/modules/identity/material-requests/material-request-issuer.service.spec.ts
git commit -m "feat(审计波二): 材料下发 MATERIAL_REQUEST_ISSUED 改 recordByActor 带操作人——actor 本就必传只是没用上"
```

---

### Task 8: 删 customers 裸 CRUD 三端点（岔口②执行）

**Files:**
- Modify: `src/modules/identity/customers/customers.controller.ts`（删 `create`/`update`/`remove` 三 handler）
- Modify: `src/modules/identity/customers/customers.service.ts`（删 `create`(:19)/`update`(:76)/`remove`(:124) 三方法 + 随删孤儿 import/DI）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（删 :236/:239/:240 三条 route）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（CUSTOMER_UPDATED/DELETED 退役）
- Test: `customers.controller.spec.ts`、`customers.service.spec.ts`（删对应用例）

- [ ] **Step 1: 零引用预检**（404 判例防线，红了就停）：

```bash
grep -rn "customersService\.\(create\|update\|remove\)\b" src admin-web/src client-web/src scripts test --include="*.ts" --include="*.tsx" | grep -v "customers.controller\|\.spec\."
grep -rniE "(post|patch|delete)[^a-z]*['\"\`]/?customers['\"\`/]" admin-web/src client-web/src scripts test --include="*.ts" --include="*.tsx"
```

Expected: 两条均零命中（基线 2026-09-16 已核：服务方法唯一调用方=controller；HTTP 零调用方；`verify-rbac.ts:1204` 仅 GET）。

- [ ] **Step 2: 删代码**
  1. controller：删三 handler 及其装饰器；import 里随删不再使用的 `Post, Body, Patch, Delete`（`Get/Query/Param/Request/UseGuards/ForbiddenException/NotFoundException` 仍在用，保留）。
  2. service：删三方法。随删后 `auditLogsService`、`AuditActions`、`AuditEntityTypes`、`AuditOutcome`、`randomUUID` 在本文件零使用 → 构造函数去掉 `auditLogsService` 注入、删对应 import（`Prisma`/`CustomerMain`/`PrismaService` 等保留）。
  3. rbac.catalog.ts：删三行——

```ts
route('POST', '/customers', 'Create customer', ['CUSTOMER_WRITE']),
route('PATCH', '/customers/:customerNo', 'Update customer', ['CUSTOMER_WRITE']),
route('DELETE', '/customers/:customerNo', 'Delete customer', ['CUSTOMER_WRITE']),
```

`CUSTOMER_WRITE` 权限组随删后零路由但仍被角色绑定引用（:824/:1023）——**保留不动**，Task 10 登 BACKLOG 观察一行（退役权限组要查 bindings 判例，不在本波扩大）。前端 `admin-web/src/rbac/permissions.ts` 实测从未声明三写键——零改动。

  4. 词表退役（照 2026-08-27 各站先例）：`AuditActions` 删 `CUSTOMER_UPDATED`(:340)/`CUSTOMER_DELETED`(:343) 两键；ACTION_SPECS 删对应两行(:904/:905)；`DEPRECATED_AUDIT_ACTIONS`(:984 起) 尾部追加：

```ts
  // ── 客户主表裸 CRUD 退役（第七幕波二，2026-09-16 岔口②：三端点删除，
  //    CUSTOMER_CREATED 保留——真实写点在注册链 customer-auth.service.ts）──
  'CUSTOMER_UPDATED', 'CUSTOMER_DELETED',
```

- [ ] **Step 3: 清测试** —— 两 spec 删 create/update/remove 相关用例（读端点用例保留）；service.spec 若因 auditLogsService 注入变化需同步构造。

- [ ] **Step 4: 跑测试与全仓引用复核**

```bash
npx jest src/modules/identity/customers
grep -rn "CUSTOMER_UPDATED\|CUSTOMER_DELETED" src scripts test --include="*.ts" | grep -v "DEPRECATED"
```

Expected: jest PASS；grep 仅 audit-actions.constant.ts 的 DEPRECATED 注释块命中（写点已随方法删除）。

- [ ] **Step 5: 随手闸 + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/modules/identity/customers/customers.controller.ts src/modules/identity/customers/customers.controller.spec.ts src/modules/identity/customers/customers.service.ts src/modules/identity/customers/customers.service.spec.ts src/modules/identity/access-control/rbac.catalog.ts src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat(审计波二): 删客户主表裸 CRUD 三端点+三服务方法(岔口②)——catalog 三 route 连删,CUSTOMER_UPDATED/DELETED 退役"
```

⚠️ 合并 main 后必做：重启后端 + `npm run db:base:sync`（catalog 变了，只 seed 不重启=403）——记入 Task 10 收尾清单。

---

### Task 9: `verify:audit` Q2/Q4 升级名册断言 + 变异测试

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（新增 `SUBJECTS_COVERED_ACTIONS`）
- Modify: `scripts/verify-audit.ts`（Q2/Q4 两块重写）

**Interfaces:**
- Consumes: Task 1-6 已让名册内 34 码全部带 subjects
- Produces: `export const SUBJECTS_COVERED_ACTIONS: readonly string[]`（47 码）

- [ ] **Step 1: 名册常量**（`DEPRECATED_AUDIT_ACTIONS` 旁新增；47 码 = 波二新修 34（含变量 action 逃 grep 的 ADMIN_PASSWORD_RESET_SELF_COMPLETED）+ 既有覆盖 13，既有三族入册前提 spec §5 已实测 7/7、4/4、4/4）：

```ts
/** 第七幕波二（2026-09-16）：承诺写 audit_log_subjects 子表的码族名册。
 *  verify:audit Q2 按此逐码断言"该码全部事件都有子表行"——新 workflow 落码时
 *  若带 subjects 请同步登记，防覆盖面无声退化。AUDIT_LOG_QUERIED 是条件式
 *  （仅带 ownerCustomerNo 参数时写 OWNER 行），由 Q4 单独看守，不入本名册。 */
export const SUBJECTS_COVERED_ACTIONS: readonly string[] = [
  // 审批横切（波二前既有覆盖）
  'APPROVAL_SUBMITTED', 'APPROVAL_SOD_DENIED', 'APPROVAL_GRANTED', 'APPROVAL_DECLINED',
  'APPROVAL_CANCELLED', 'APPROVAL_EXPIRED', 'APPROVAL_TIMEOUT_SIMULATED',
  // 角色/绑定（波二前既有覆盖）
  'ROLE_DEFINITION_MODIFY_REQUESTED', 'ROLE_DEFINITION_MODIFY_APPLIED', 'ROLE_DEFINITION_MODIFY_CANCELLED',
  'ADMIN_ROLE_CHANGE_REQUESTED', 'ADMIN_ROLE_CHANGE_APPLIED', 'ADMIN_ROLE_CHANGE_CANCELLED',
  // ── 以下波二补齐（2026-09-16）──
  'ADMIN_INVITE_REQUESTED', 'ADMIN_INVITE_DISPATCHED', 'ADMIN_INVITE_CANCELLED',
  'ADMIN_INVITE_ACCEPTED', 'ADMIN_INVITE_EXPIRED',
  'ADMIN_SUSPENSION_REQUESTED', 'ADMIN_SUSPENSION_APPLIED',
  'ADMIN_REACTIVATION_REQUESTED', 'ADMIN_REACTIVATION_APPLIED',
  'ADMIN_PASSWORD_RESET_SELF_REQUESTED', 'ADMIN_PASSWORD_RESET_OFFICER_REQUESTED',
  'ADMIN_PASSWORD_RESET_OFFICER_APPLIED', 'ADMIN_PASSWORD_RESET_CANCELLED',
  'ADMIN_PASSWORD_RESET_SELF_TOKEN_ISSUED', 'ADMIN_PASSWORD_RESET_SELF_COMPLETED',
  'ADMIN_MFA_RESET_REQUESTED', 'ADMIN_MFA_RESET_APPLIED', 'ADMIN_MFA_RESET_CANCELLED',
  'ADMIN_FIRST_LOGIN_IDENTITY_CONFIRMED', 'ADMIN_FIRST_LOGIN_MFA_INITIATED',
  'ADMIN_FIRST_LOGIN_MFA_BOUND', 'ADMIN_FIRST_LOGIN_COMPLETED',
  'MFA_LOGIN_VERIFY_FAILED', 'MFA_LOGIN_VERIFIED',
  'ADMIN_ACCOUNT_LOCK_APPLIED', 'ADMIN_ACCOUNT_LOCK_RELEASED',
  'ROLE_DEFINITION_CREATE_REQUESTED', 'ROLE_DEFINITION_CREATE_APPLIED', 'ROLE_DEFINITION_CREATE_CANCELLED',
  'APPROVAL_POLICY_CHANGE_REQUESTED', 'APPROVAL_POLICY_CHANGE_APPLIED',
  'AUDIT_EVIDENCE_EXPORT_REQUESTED', 'AUDIT_EVIDENCE_EXPORT_GENERATED', 'AUDIT_EVIDENCE_EXPORT_DOWNLOADED',
];
```

⚠️ 例外说明：`ADMIN_ACCOUNT_LOCK_APPLIED/RELEASED` 另有两处 `@OnEvent` 系统写点（`mfa-binding-workflow.service.ts:561/:609`，密码登录锁，同在 Task 4 文件、同 helper 补上——12 处清册已含）。

- [ ] **Step 2: Q2 重写**（替换 verify-audit.ts :13-23 整块；import 行补 `SUBJECTS_COVERED_ACTIONS`）：

```ts
// ── Q2 名册子表覆盖（波二升级：从"任取一条自证"改为按码断言全覆盖）──────
const MIN_EXERCISED_ROSTER_ACTIONS = /* Step 4 实测后钉数 */ 0;
const rosterEvents = await prisma.auditLogEvent.findMany({
  where: { action: { in: [...SUBJECTS_COVERED_ACTIONS] } },
  select: { action: true, subjects: { select: { id: true }, take: 1 } },
});
const byAction = new Map<string, { total: number; missing: number }>();
for (const r of rosterEvents) {
  const e = byAction.get(r.action) ?? { total: 0, missing: 0 };
  e.total += 1;
  if (r.subjects.length === 0) e.missing += 1;
  byAction.set(r.action, e);
}
const violated = [...byAction.entries()].filter(([, v]) => v.missing > 0);
check('Q2 名册子表覆盖', violated.length === 0 && byAction.size >= MIN_EXERCISED_ROSTER_ACTIONS,
  `${byAction.size}/${SUBJECTS_COVERED_ACTIONS.length} 个名册码有事件（阈值 ${MIN_EXERCISED_ROSTER_ACTIONS}）` +
  (violated.length
    ? `；违约 ${violated.map(([a, v]) => `${a}(${v.missing}/${v.total})`).join(', ')}`
    : '；违约 0'));
```

- [ ] **Step 3: Q4 重写**（替换 :25-39 整块；先 `grep -n "ownerCustomerNo" src/modules/audit-logging/audit-logs.service.ts` 确认 AUDIT_LOG_QUERIED 写入时把查询参数落到事件行 `ownerCustomerNo` 列——落列条件与 persistSubjects 条件同源才可用此判据，不同源则改按该写点实际落的字段过滤）：

```ts
// ── Q4 查询留痕（波二升级：带 owner 参数的查询事件必须全部落 OWNER=CUSTOMER 行）──
// 结构性说明保留：V1 治理域没有其他把 CUSTOMER 设为 OWNER 的场景——本判据看守的是
// "查询留痕自身的子表纪律"，交易域 OWNER 场景待其接入 subjects 后另立判据（BACKLOG §H Q4 条）。
const ownerQueries = await prisma.auditLogEvent.findMany({
  where: { action: 'AUDIT_LOG_QUERIED', ownerCustomerNo: { not: null } },
  select: { id: true, subjects: { where: { subjectRole: 'OWNER', subjectType: 'CUSTOMER' }, select: { id: true }, take: 1 } },
});
const q4Missing = ownerQueries.filter((r) => r.subjects.length === 0).length;
check('Q4 带 owner 参数的查询全部落 OWNER 行', ownerQueries.length > 0 && q4Missing === 0,
  `${ownerQueries.length} 条带 owner 参数的 AUDIT_LOG_QUERIED，其中 ${q4Missing} 条缺 OWNER=CUSTOMER 子表行`);
```

- [ ] **Step 4: 基数实测 + 钉阈值**（worktree 自有栈）：

```bash
bash scripts/stack.sh reset self
bash scripts/on-stack.sh self demo:all
bash scripts/on-stack.sh self verify:audit
```

Expected: 输出里 `Q2 名册子表覆盖` 报 `N/46 个名册码有事件`——把 `MIN_EXERCISED_ROSTER_ACTIONS` 钉成该 N（不取更小值），改后重跑确认全绿。若 N=0（demo:all 不产任何名册码事件）→ 停下报告，阈值方案需回主会话重议，不许钉 0 蒙混。

- [ ] **Step 5: 变异测试（防新自证，红/绿双证）** —— 对 DB 副本抽一行子表，绿闸必须转红：

```bash
DB=$(bash scripts/stack.sh status | grep -o '/tmp/exchange_js_wt_[^ ]*/dev.db' | head -1)
cp "$DB" /tmp/verify_audit_mutation.db
sqlite3 /tmp/verify_audit_mutation.db "DELETE FROM audit_log_subjects WHERE eventId=(SELECT eventId FROM audit_log_subjects s JOIN audit_log_events e ON e.id=s.eventId WHERE e.action IN (SELECT value FROM json_each('$(node -e "console.log(JSON.stringify(require('./src/modules/audit-logging/constants/audit-actions.constant').SUBJECTS_COVERED_ACTIONS))" 2>/dev/null || echo '[]')')) LIMIT 1);"
DATABASE_URL="file:/tmp/verify_audit_mutation.db" npx ts-node -r tsconfig-paths/register scripts/verify-audit.ts; echo "exit=$?"
```

（sqlite 内联 json 取名册太绕的话，允许简化为直接挑一条 `APPROVAL_SUBMITTED` 事件删其子表行——demo 库必有该码。）
Expected: `Q2 名册子表覆盖` 转 ✗、exit=1；原库重跑 `bash scripts/on-stack.sh self verify:audit` 仍全绿。两次输出存档作物证。

- [ ] **Step 6: 随手闸 + commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/modules/audit-logging/constants/audit-actions.constant.ts scripts/verify-audit.ts
git commit -m "feat(审计波二): verify:audit Q2/Q4 升级名册断言——47 码名册+空库阈值+变异红绿双证"
```

---

### Task 10: 收尾——判据走查 + 全闸 + 文档记账

**Files:**
- Modify: `doc-final/BACKLOG.md`、`doc-final/CHANGELOG.md`、`doc-final/superpowers/specs/2026-09-15-act7-audit-campaign-charter.md`
- Create: `doc-final/superpowers/specs/2026-09-16-act7-wave3-search-flow-skeleton.md`（波三骨架）
- 物证: 截图落 `doc-final/superpowers/checkups/` 旁按惯例路径，文档里写明落盘位置

- [ ] **Step 1: 收尾闸全套**（worktree 内）：

```bash
npx tsc --noEmit -p tsconfig.json
npx jest src/modules/identity/users src/modules/identity/access-control src/modules/identity/customers src/modules/identity/material-requests src/modules/governance/approvals src/modules/audit-logging
bash scripts/stack.sh reset self
bash scripts/on-stack.sh self demo:all
bash scripts/on-stack.sh self verify:audit
```

Expected: 全绿（demo:all 判据对照 `doc-final/demo/baseline.md`）。

- [ ] **Step 2: 判据 2 现场走查**（demo 数据无管理员生命周期，实走造事件）：worktree 栈管理台上，超管完整走 邀请新 ADM→接受邀请首登（确认身份+绑 MFA）→停用（发起+审批通过）→恢复（发起+审批通过）；然后 auditor 进审计页 Advanced · Related No 输该 ADM 号，断言一生全链齐（INVITE_REQUESTED→…→REACTIVATION_APPLIED，含 INSTRUMENT 关联的审批单事件），截图落盘。走查后再跑一次 `bash scripts/on-stack.sh self verify:audit`——此时名册里 users/ 六族码首次有真实事件，Q2 断言在真数据上二次咬合，必须仍全绿。

- [ ] **Step 3: BACKLOG 记账**（§H）：销「⭐🔴 subjects 覆盖面」「审计有痕无人」两条（原文划存 + 已修说明）；Q4 条按新判据重锚；新登 3 行观察——① invite 家族 primarySubjectType=ACCESS_CONTROL 遗留（改型属展示面，待波三跳转映射轮顺手评估）② role-definition-modify 的 requestNo 不镜像 PRIMARY（Related No 查不到 requestNo，属既有口径）③ `CUSTOMER_WRITE` 权限组零路由但仍被角色绑定引用（rbac.catalog.ts:824/:1023，退役要查 bindings，下次动权限包再收）。

- [ ] **Step 4: 波三骨架 + 总纲 + CHANGELOG**：按 `rules/delivery-checklist.md` 立 `2026-09-16-act7-wave3-search-flow-skeleton.md`（链总纲 + 「承接上一波」节写实际偏差与新事实：至少含 名册阈值实测值、走查造出的 ADM 事件家族清单、Task 7 若发现计划外调用方的处置）；总纲状态行回写「波二 已完成」；CHANGELOG 合并时一行。

- [ ] **Step 5: commit + 合并交接**

```bash
git add doc-final/BACKLOG.md doc-final/CHANGELOG.md doc-final/superpowers/specs/2026-09-15-act7-audit-campaign-charter.md doc-final/superpowers/specs/2026-09-16-act7-wave3-search-flow-skeleton.md
git commit -m "docs(第七幕波二): 收尾记账——§H 销2重锚1新登3,波三骨架立,总纲状态行回写"
```

合并 main 走 `superpowers:finishing-a-development-branch`；**合并后必做**：重启后端 + `npm run db:base:sync`（Task 8 动了 catalog）；本波不动 schema/seed，主栈无需 reset。

---

## Self-Review 记录（写毕自查）

- **Spec 覆盖**：§1→Task 1-6（存量 48 处逐文件）；§2→Task 7；§3→Task 4；§4→Task 8；§5→Task 9；§6 验收→Task 9 Step 4-5 + Task 10 Step 1-2；§6 收尾→Task 10 Step 3-5。无缺口。
- **占位符**：Task 9 Step 2 的 `MIN_EXERCISED_ROSTER_ACTIONS = 0` 是显式"Step 4 实测后钉数"流程，非 TBD；Task 1/5 的 mock 字面量注明以 spec 既有 fixture 为准，属现场对位不属含糊。
- **类型一致**：`adminSubjects/inviteSubjects/roleSubjects/policySubjects/packageSubjects` 五个 helper 签名同构 `(no: string, approvalNo?: string | null) => AuditSubjectInput[]`（policySubjects 多一中位参）；`create(input, actor, tx?)` 与 Task 7 Interfaces 一致。
- **判据咬合**：jest 断言（每文件）+ Q2 名册（库级）+ 变异红绿（闸自身）三层互证，无单点自证。
