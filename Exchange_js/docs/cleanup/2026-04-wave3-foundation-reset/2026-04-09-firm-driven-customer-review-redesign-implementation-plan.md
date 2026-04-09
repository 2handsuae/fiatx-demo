# Wave 3 Firm-Driven Customer Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实施 Wave 3 firm-driven customer review 重设计——构建 Layer 2 (ClientRiskAssessment) + Layer 3 (MaterialRefreshCycle) 双层架构，把现有 periodic review 从"customer-driven 重走 CDD/EDD"替换为"firm-driven Sumsub 集成 + 事件驱动材料刷新"。

**Architecture:** 通过 3 层架构（Layer 1 Sumsub 持续监控 / Layer 2 分析聚合 / Layer 3 证据维护）+ 4 个 Sumsub Applicant Action Levels + 复用 Wave 1 ApprovalCase kernel（扩展支持多步）+ 三张新表 + 两份 JSON policy config 实现。Sumsub 集成通过扩展现有 `SumsubWebhookDispatcher` 模式处理所有实时事件和模拟事件。

**Tech Stack:** NestJS 11, Prisma 5, SQLite, Jest, React 19 + Vite, Sumsub WebSDK, Sumsub User Verification API, Sumsub Applicant Actions API

**Design Doc:** `docs/cleanup/2026-04-wave3-foundation-reset/2026-04-09-firm-driven-customer-review-redesign-design.md`

---

## Phase Roadmap

| Phase | Scope | Depends On | Est. Days |
|---|---|---|---|
| **Phase 0** | Sumsub Dashboard pre-config + runbook | — | 0.5 |
| **Phase 1** | Wave 1 Approval kernel 多步扩展 | Phase 0 | 1.5 |
| **Phase 2** | Schema migration (customer_main rename + 3 new tables) | Phase 1 | 1.0 |
| **Phase 3** | Layer 2 Client Risk Assessment 实现 | Phase 2 | 2.5 |
| **Phase 4** | Layer 3 Material Refresh 实现 | Phase 2 | 2.5 |
| **Phase 5** | Sumsub integration layer + Webhook Dispatcher | Phase 3, 4 | 1.0 |
| **Phase 6** | Profile Banner + Frontend (/verification 多模式 + AuthGuard) | Phase 3, 4, 5 | 2.0 |
| **Phase 7** | Backfill script + 部署 + 监控 | Phase 6 | 1.0 |
| **Phase 8** | 文档更新 | Phase 7 | 0.5 |

**总计**: ~12.5 人天

**执行原则**:
- 每个 Phase 独立可验收，结束时有 git commit
- Phase 1 是前置依赖，必须先完成
- Phase 3 和 Phase 4 理论上可并行（两位开发者），但因为有 cross-cutting 依赖（postSignoffCascade → recomputeHoldingsForCustomer），建议串行
- 每个 Task 内严格 TDD：红→绿→重构→提交

---

## Phase 0: Sumsub Dashboard 预配

**目标**: 在代码部署前完成 Sumsub Dashboard 所有配置，作为 Phase 1 的前置。

**注意**: 这一 Phase 是运维工作，**不写代码**。产出是一份 runbook 文档供运维按步骤执行。

### Task 0.1: 写 Sumsub Dashboard 配置 runbook

**Files:**
- Create: `Exchange_js/docs/operations/sumsub-dashboard-wave3-config-runbook.md`

- [ ] **Step 1: 创建 runbook 文件，按以下模板填充**

```markdown
# Sumsub Dashboard Wave 3 Configuration Runbook

Owner: Operations
Last Updated: 2026-04-09
Status: active

## Purpose

This runbook documents the Sumsub Dashboard configuration required before
deploying Wave 3 firm-driven customer review code. Each item must be
completed and verified before Phase 1 of the implementation plan begins.

## Prerequisites

- Access to Sumsub Dashboard with admin privileges
- Current Sumsub App Token and Secret Key in ops vault
- Wave 3 design doc read: `2026-04-09-firm-driven-customer-review-redesign-design.md`

## Step 1: Create 4 Applicant Action Levels

Navigate to: Dashboard → Workflow Builder → Action Workflows → Create New

Create the following 4 levels:

### Level 1: `wave3-action-id-refresh`
- Name: `wave3-action-id-refresh`
- Required steps:
  - IDENTITY (ID card / passport / driving license)
- Country allowed: ALL
- Document validity: Accept only valid documents
- Minimum validity: 6 months

### Level 2: `wave3-action-poa-refresh`
- Name: `wave3-action-poa-refresh`
- Required steps:
  - PROOF_OF_RESIDENCE (utility bill, bank statement, etc.)
- Country allowed: ALL
- Document age: Accept documents issued within last 3 months

### Level 3: `wave3-action-sof-refresh`
- Name: `wave3-action-sof-refresh`
- Required steps:
  - APPLICANT_DATA (questionnaire about source of funds)
  - PROOF_OF_SOURCE_OF_FUNDS (supporting documents)
- Country allowed: ALL

### Level 4: `wave3-action-sow-refresh`
- Name: `wave3-action-sow-refresh`
- Required steps:
  - APPLICANT_DATA (questionnaire about source of wealth)
  - PROOF_OF_SOURCE_OF_WEALTH (supporting documents)
- Country allowed: ALL

Verification: Each level should show status "Published" with unique name.

## Step 2: Configure ID Document Expiry

Navigate to: Dashboard → Supported ID Documents

For each combination below:
- UAE → Emirates ID → Custom expiry settings: "Accept only valid documents" + "Valid for at least 6 months"
- ALL countries → Passport → Same
- ALL countries → Driving License → Same

## Step 3: Enable Ongoing Document Monitoring

Navigate to: Dashboard → Settings → Ongoing Document Monitoring

- Toggle: Enable
- Grace period after expiry: 0 days (fire immediately)
- Save

## Step 4: Enable Ongoing AML Monitoring

Navigate to: Dashboard → Settings → Ongoing AML Monitoring

- Toggle: Enable globally
- Save

Then in Workflow Builder:
- Open the main onboarding workflow
- Configure: route RED rejected applicants → "Requires action (onHold)" status
  (NOT "Final rejection", which would stop Ongoing Monitoring after 24h)
- Save and publish

## Step 5: Webhook Configuration

Navigate to: Dashboard → Settings → Webhooks

- Add URL: `https://<FIATX_API_HOST>/onboarding/sumsub/webhook`
- Subscribe to events:
  - applicantReviewed
  - applicantPending
  - applicantOnHold
  - applicantActionPending
  - applicantActionOnHold
  - applicantActionReviewed
  - applicantWorkflowCompleted
  - applicantWorkflowFailed
- Secret key: <copy to vault, set `SUMSUB_WEBHOOK_SECRET` env var>

## Verification Checklist

- [ ] 4 Action Levels created and published
- [ ] ID document expiry configured for UAE + international
- [ ] Ongoing Document Monitoring enabled
- [ ] Ongoing AML Monitoring enabled
- [ ] Workflow Builder routes RED → onHold (not rejected)
- [ ] Webhook URL registered and secret stored in vault
- [ ] Test webhook delivery (use Sumsub "Test webhook" button)

## Rollback

If any step fails during deploy:
- Disable Ongoing Doc Monitoring (Step 3 toggle off)
- Disable Ongoing AML Monitoring (Step 4 toggle off)  
- Remove webhook URL (Step 5)
- Do NOT delete the 4 Action Levels — they are harmless if unused

## Contacts

- Sumsub account issues: <sumsub support>
- Secret management: <ops vault contact>
```

- [ ] **Step 2: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
git add docs/operations/sumsub-dashboard-wave3-config-runbook.md
git commit -m "docs(ops): add Wave 3 Sumsub Dashboard configuration runbook"
```

### Task 0.2: Verification task for runbook execution (to be run by ops before Phase 1)

**Files:**
- Read: `Exchange_js/docs/operations/sumsub-dashboard-wave3-config-runbook.md`

- [ ] **Step 1: Ops executes runbook**

Operations team follows each step in the runbook. Each checkbox in the "Verification Checklist" section must be ticked before moving to Phase 1.

- [ ] **Step 2: Test webhook delivery**

In Sumsub Dashboard, use the "Test webhook" button. Verify FIATX backend receives a test event at `/onboarding/sumsub/webhook`. Check logs for successful signature verification.

**Phase 0 Complete**: Ops runbook committed and Sumsub Dashboard configured. Proceed to Phase 1.

---

## Phase 1: Wave 1 Approval Kernel 多步扩展

**目标**: 扩展现有 `ApprovalsService` 支持多步审批，为 PEP 双签做准备。Schema 已支持（`ApprovalStep` 表带 `stepNo` + `checkerRoleCandidates` 字段），只需扩展 service 层 logic。

**向后兼容性要求**: 现有单步 action types (CHANGE_TICKET_APPROVAL, DELETE_REQUEST_APPROVAL, 等) 行为必须完全不变。

### Task 1.1: Write failing test for multi-step createCase

**Files:**
- Modify: `Exchange_js/src/modules/governance/approvals/approvals.service.spec.ts`
- Read-only: `Exchange_js/src/modules/governance/approvals/approvals.service.ts`

- [ ] **Step 1: 先读懂现有测试结构**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
grep -n "describe\|it('" src/modules/governance/approvals/approvals.service.spec.ts | head -30
```

这会显示现有测试的 describe/it 结构。找到已有的 `describe('create')` 或类似块。

- [ ] **Step 2: 在已有 describe 块末尾添加新 describe 'multi-step'**

Edit `src/modules/governance/approvals/approvals.service.spec.ts` — 在 `describe('ApprovalsService', ...)` 根块内靠末尾添加：

```typescript
describe('multi-step approval', () => {
  it('createCase creates N steps when policy defines N checker roles', async () => {
    // 这个测试依赖一个具有多个 checker roles 的 action type.
    // 使用临时的 test action type 'TEST_DUAL_SIGN' (需要先注册 mock policy).
    prismaMock.approvalPolicy = { TEST_DUAL_SIGN: ['MLRO', 'SENIOR_MANAGEMENT_OFFICER'] };
    
    // Mock policy service to return dual-role policy
    (service as any).approvalPolicyService.getPolicy = jest.fn().mockResolvedValue({
      riskLevel: 'HIGH',
      checkerRoles: ['MLRO', 'SENIOR_MANAGEMENT_OFFICER'],
      timeoutHours: 240,
      allowCancel: true,
      allowRetry: true,
    });
    
    prismaMock.approvalCase.findFirst = jest.fn().mockResolvedValue(null);
    prismaMock.approvalCase.create = jest.fn().mockImplementation(({ data }) => 
      Promise.resolve({
        id: 'case-1',
        ...data,
        steps: data.steps?.create 
          ? (Array.isArray(data.steps.create) ? data.steps.create : [data.steps.create])
              .map((s: any, idx: number) => ({ id: `step-${idx + 1}`, ...s }))
          : [],
      })
    );
    
    const result = await (service as any).createDraftCase(
      {
        actionType: 'TEST_DUAL_SIGN',
        entityRef: 'test_entity:1',
        metadata: {},
      },
      { actorType: 'ADMIN', userId: 'u1', roleCodes: ['MLRO'] },
    );
    
    // 断言 createCase 创建了 2 个 step
    const createCall = prismaMock.approvalCase.create.mock.calls[0][0];
    expect(createCall.data.steps.create).toHaveLength(2);
    expect(createCall.data.steps.create[0]).toMatchObject({
      stepNo: 1,
      status: 'PENDING',
      checkerRoleCandidates: 'MLRO',
    });
    expect(createCall.data.steps.create[1]).toMatchObject({
      stepNo: 2,
      status: 'PENDING',
      checkerRoleCandidates: 'SENIOR_MANAGEMENT_OFFICER',
    });
  });
});
```

- [ ] **Step 3: Run the failing test**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm test -- src/modules/governance/approvals/approvals.service.spec.ts -t "multi-step approval" --runInBand
```

**Expected**: FAIL. The test should fail because `createDraftCase` currently always creates a single step regardless of `checkerRoles.length`.

The failure should look like one of:
- `Expected createCall.data.steps.create to have length 2, received 1` (currently wraps single step in object form, not array)
- Or the test passes but the asserted structure doesn't match (current code uses `create: { stepNo: 1, ... }` not `create: [{...}, {...}]`)

Take note of the exact failure output — it tells you what the current code does.

### Task 1.2: Implement multi-step createCase

**Files:**
- Modify: `Exchange_js/src/modules/governance/approvals/approvals.service.ts` (around line 764)

- [ ] **Step 1: Read the current createCase steps block**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
sed -n '760,775p' src/modules/governance/approvals/approvals.service.ts
```

Expected output:
```typescript
        traceId: ...,
        workflowType: ...,
        ...
        steps: {
          create: {
            stepNo: 1,
            status: ApprovalStepStatuses.PENDING,
            checkerRoleCandidates: joinRoleCsv(policy.checkerRoles),
          },
        },
      },
      client,
    );
  }
```

- [ ] **Step 2: Replace the single-step `steps.create` with array form**

Edit the file. Find the `steps: { create: { stepNo: 1, ... } }` block and replace:

```typescript
// BEFORE:
steps: {
  create: {
    stepNo: 1,
    status: ApprovalStepStatuses.PENDING,
    checkerRoleCandidates: joinRoleCsv(policy.checkerRoles),
  },
},

// AFTER:
steps: {
  create: policy.checkerRoles.map((role, idx) => ({
    stepNo: idx + 1,
    status: ApprovalStepStatuses.PENDING,
    checkerRoleCandidates: role,
  })),
},
```

**关键变化**:
- 单步: 所有 checkerRoles 拼 CSV 放到一个 step 的 `checkerRoleCandidates` (旧行为)
- 多步: 每个 role 独立一个 step, 按 array 顺序排 stepNo (新行为)

**向后兼容性**: 单 role 的 action type 仍然正确工作 —— `.map` 返回 1 元素数组，stepNo=1，只是 `checkerRoleCandidates` 从 "ROLE_A,ROLE_B" 变成 "ROLE_A"。由于原始 policy 也只有一个 role（单签 case），这个变化对现有单步 case 透明。

- [ ] **Step 3: 再 run test**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm test -- src/modules/governance/approvals/approvals.service.spec.ts -t "multi-step approval" --runInBand
```

**Expected**: PASS.

- [ ] **Step 4: 跑整个 approvals.service.spec.ts 确保没打破现有测试**

```bash
npm test -- src/modules/governance/approvals/approvals.service.spec.ts --runInBand
```

**Expected**: 所有测试 PASS.

如果有任何现有测试失败，说明单步的 CSV 写法有依赖方。检查失败的 spec 里如何断言 `checkerRoleCandidates`，可能需要微调 assertion 或调整实现。

- [ ] **Step 5: Commit**

```bash
git add src/modules/governance/approvals/approvals.service.ts \
        src/modules/governance/approvals/approvals.service.spec.ts
git commit -m "feat(approvals): support multi-step createCase with N steps for N checker roles"
```

### Task 1.3: Write failing test for multi-step approve (advance to next step)

**Files:**
- Modify: `Exchange_js/src/modules/governance/approvals/approvals.service.spec.ts`

- [ ] **Step 1: Add test for "first step approved keeps case PENDING"**

Add to the `describe('multi-step approval', ...)` block:

```typescript
it('approve on first step keeps case PENDING and marks only step 1 APPROVED', async () => {
  const approval = {
    id: 'case-1',
    actionType: 'TEST_DUAL_SIGN',
    status: 'PENDING',
    traceId: 'trace-1',
    checkerRoles: 'MLRO,SENIOR_MANAGEMENT_OFFICER',
    selectedCheckerRole: 'MLRO',
    createdByUserId: 'maker-1',
    steps: [
      { 
        id: 'step-1', stepNo: 1, status: 'PENDING', 
        checkerRoleCandidates: 'MLRO' 
      },
      { 
        id: 'step-2', stepNo: 2, status: 'PENDING', 
        checkerRoleCandidates: 'SENIOR_MANAGEMENT_OFFICER' 
      },
    ],
  };
  
  prismaMock.approvalCase.findUnique = jest.fn().mockResolvedValue(approval);
  prismaMock.approvalStep.update = jest.fn().mockResolvedValue({});
  prismaMock.approvalCase.update = jest.fn().mockResolvedValue({ 
    ...approval, 
    steps: approval.steps, 
  });
  
  const actor = { 
    actorType: 'ADMIN' as const, 
    userId: 'u1', 
    userNo: 'U1',
    role: 'MLRO', 
    roleCodes: ['MLRO'] 
  };
  
  await service.approve('case-1', { reason: 'ok' } as any, actor);
  
  // 断言 step 1 被标记 APPROVED
  expect(prismaMock.approvalStep.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        approvalCaseId_stepNo: { approvalCaseId: 'case-1', stepNo: 1 },
      }),
      data: expect.objectContaining({
        status: 'APPROVED',
        decidedByUserId: 'u1',
      }),
    }),
  );
  
  // 断言 approvalCase.update 没有被调用, 或被调用时 status 仍是 PENDING (case 不动)
  const caseUpdateCalls = prismaMock.approvalCase.update.mock.calls;
  if (caseUpdateCalls.length > 0) {
    const updateData = caseUpdateCalls[0][0].data;
    expect(updateData.status).toBeUndefined(); // 不改 status
  }
});

it('approve on last step marks case APPROVED', async () => {
  const approval = {
    id: 'case-1',
    actionType: 'TEST_DUAL_SIGN',
    status: 'PENDING',
    traceId: 'trace-1',
    checkerRoles: 'MLRO,SENIOR_MANAGEMENT_OFFICER',
    selectedCheckerRole: 'SENIOR_MANAGEMENT_OFFICER',
    createdByUserId: 'maker-1',
    steps: [
      { 
        id: 'step-1', stepNo: 1, status: 'APPROVED',  // step 1 已签
        checkerRoleCandidates: 'MLRO',
        decidedByUserId: 'mlro-user',
      },
      { 
        id: 'step-2', stepNo: 2, status: 'PENDING',   // 等 step 2
        checkerRoleCandidates: 'SENIOR_MANAGEMENT_OFFICER' 
      },
    ],
  };
  
  prismaMock.approvalCase.findUnique = jest.fn().mockResolvedValue(approval);
  prismaMock.approvalStep.update = jest.fn().mockResolvedValue({});
  prismaMock.approvalCase.update = jest.fn().mockResolvedValue({ 
    ...approval, 
    status: 'APPROVED', 
    steps: approval.steps, 
  });
  
  const actor = { 
    actorType: 'ADMIN' as const, 
    userId: 'senior-1', 
    userNo: 'S1',
    role: 'SENIOR_MANAGEMENT_OFFICER', 
    roleCodes: ['SENIOR_MANAGEMENT_OFFICER'],
  };
  
  await service.approve('case-1', { reason: 'approved' } as any, actor);
  
  // 断言 step 2 被标记 APPROVED
  expect(prismaMock.approvalStep.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        approvalCaseId_stepNo: { approvalCaseId: 'case-1', stepNo: 2 },
      }),
    }),
  );
  
  // 断言 case.status 被设为 APPROVED
  expect(prismaMock.approvalCase.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ status: 'APPROVED' }),
    }),
  );
});
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm test -- src/modules/governance/approvals/approvals.service.spec.ts -t "multi-step approval" --runInBand
```

**Expected**: 
- Test "createCase creates N steps": PASS (from Task 1.2)
- Test "approve on first step keeps case PENDING": FAIL — current code always sets status to APPROVED
- Test "approve on last step marks case APPROVED": FAIL — current code hardcodes stepNo=1

### Task 1.4: Implement multi-step approve logic

**Files:**
- Modify: `Exchange_js/src/modules/governance/approvals/approvals.service.ts`

- [ ] **Step 1: Read the current approve() method**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
sed -n '891,955p' src/modules/governance/approvals/approvals.service.ts
```

- [ ] **Step 2: Replace the approve() transaction body**

Find the `async approve(...)` method. Replace the entire inner transaction block with:

```typescript
async approve(id: string, dto: DecisionApprovalDto, actor: ApprovalActorContext) {
  const updated = await this.prisma.$transaction(async (tx: any) => {
    const approval = await this.findCaseOrThrow(id, tx);
    if (approval.status !== ApprovalStatuses.PENDING) {
      throw new BadRequestException('Only PENDING approvals can be approved');
    }

    this.assertTraceConsistency(approval.traceId, dto.traceId);
    this.assertWorkflowContextConsistency(approval, dto);
    
    // 找到当前角色可以签的 pending step
    const currentStep = (approval.steps || []).find(
      (s: any) =>
        s.status === ApprovalStepStatuses.PENDING &&
        splitRoleCsv(s.checkerRoleCandidates).some((candidate) =>
          (actor.roleCodes || []).includes(candidate),
        ),
    );
    
    if (!currentStep) {
      // 回退: 也允许 super admin bypass
      if (!this.isSuperAdmin(actor)) {
        throw new ForbiddenException(
          `Actor role ${actor.roleCodes?.join(',')} cannot sign any pending step of this approval`,
        );
      }
      // super admin 就签第一个 pending step
      const firstPending = (approval.steps || []).find(
        (s: any) => s.status === ApprovalStepStatuses.PENDING,
      );
      if (!firstPending) {
        throw new BadRequestException('No pending step to approve');
      }
      return this.executeStepApproval(tx, approval, firstPending, actor, dto);
    }
    
    return this.executeStepApproval(tx, approval, currentStep, actor, dto);
  });

  await this.recordAudit(
    AuditActions.APPROVAL_APPROVED,
    updated,
    actor,
    AuditResult.SUCCESS,
    dto.reason || 'Approval approved',
    ApprovalStatuses.PENDING,
    updated.status === ApprovalStatuses.APPROVED 
      ? ApprovalStatuses.APPROVED 
      : ApprovalStatuses.PENDING,
    this.isSuperAdmin(actor) && actor.userId === updated.createdByUserId
      ? { superAdminBypass: true }
      : undefined,
  );
  if (updated.status === ApprovalStatuses.APPROVED) {
    await this.projectGovernanceApprovalDecision(updated);
    await this.emitApprovalEvent(ApprovalEvents.APPROVED, this.buildEventPayload(updated));
  }
  return this.mapApproval(updated, actor);
}

private async executeStepApproval(
  tx: any,
  approval: any,
  currentStep: any,
  actor: ApprovalActorContext,
  dto: DecisionApprovalDto,
): Promise<ApprovalCaseRow> {
  const now = new Date();
  const decisionRole = await this.resolveDecisionRole(approval, actor, dto.checkerRole);
  
  // Mark current step as APPROVED
  await tx.approvalStep.update({
    where: {
      approvalCaseId_stepNo: {
        approvalCaseId: approval.id,
        stepNo: currentStep.stepNo,
      },
    },
    data: {
      status: ApprovalStepStatuses.APPROVED,
      decidedByUserId: actor.userId,
      decidedByUserNo: this.normalizeOptionalString(actor.userNo),
      decidedByRole: decisionRole,
      reason: this.normalizeOptionalString(dto.reason),
      decidedAt: now,
    },
  });
  
  // Check if there's a pending step after this one
  const hasNextPendingStep = (approval.steps || []).some(
    (s: any) => 
      s.stepNo > currentStep.stepNo && 
      s.status === ApprovalStepStatuses.PENDING,
  );
  
  if (hasNextPendingStep) {
    // Not the last step — case stays PENDING
    // Reload to get fresh state including the just-updated step
    return tx.approvalCase.findUnique({
      where: { id: approval.id },
      include: this.approvalInclude(),
    }) as Promise<ApprovalCaseRow>;
  }
  
  // Last step — case APPROVED
  return tx.approvalCase.update({
    where: { id: approval.id },
    data: {
      status: ApprovalStatuses.APPROVED,
      selectedCheckerRole: decisionRole,
      decisionByUserId: actor.userId,
      decisionByUserNo: this.normalizeOptionalString(actor.userNo),
      decisionByRole: decisionRole,
      decisionReason: this.normalizeOptionalString(dto.reason),
      decidedAt: now,
    },
    include: this.approvalInclude(),
  }) as Promise<ApprovalCaseRow>;
}
```

- [ ] **Step 3: Run the multi-step tests**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm test -- src/modules/governance/approvals/approvals.service.spec.ts -t "multi-step approval" --runInBand
```

**Expected**: All 3 tests PASS.

- [ ] **Step 4: Run the full approvals test suite**

```bash
npm test -- src/modules/governance/approvals/approvals.service.spec.ts --runInBand
```

**Expected**: 所有测试 PASS. 现有单步 tests 应该继续工作因为：
- 单步 case 的 `steps[0].checkerRoleCandidates` 仍然包含所有 roles (Task 1.2 改后每个 role 独立，但单 role policy 时就只有一个 step)
- `executeStepApproval` 对单步 case 的行为等同于旧逻辑

如果现有测试失败，debug 方向：
- 检查测试是否依赖 `selectedCheckerRole` 字段 — 新代码在 `executeStepApproval` 里更新它
- 检查测试是否依赖 `step 1` 的硬编码 — 新代码用 `currentStep.stepNo`

### Task 1.5: Write failing test for multi-step reject

**Files:**
- Modify: `Exchange_js/src/modules/governance/approvals/approvals.service.spec.ts`

- [ ] **Step 1: Add rejection test case**

Add to the `describe('multi-step approval', ...)` block:

```typescript
it('reject on any step marks entire case REJECTED', async () => {
  const approval = {
    id: 'case-1',
    actionType: 'TEST_DUAL_SIGN',
    status: 'PENDING',
    traceId: 'trace-1',
    checkerRoles: 'MLRO,SENIOR_MANAGEMENT_OFFICER',
    selectedCheckerRole: 'MLRO',
    createdByUserId: 'maker-1',
    steps: [
      { id: 'step-1', stepNo: 1, status: 'PENDING', checkerRoleCandidates: 'MLRO' },
      { id: 'step-2', stepNo: 2, status: 'PENDING', checkerRoleCandidates: 'SENIOR_MANAGEMENT_OFFICER' },
    ],
  };
  
  prismaMock.approvalCase.findUnique = jest.fn().mockResolvedValue(approval);
  prismaMock.approvalStep.update = jest.fn().mockResolvedValue({});
  prismaMock.approvalCase.update = jest.fn().mockResolvedValue({ 
    ...approval, status: 'REJECTED', steps: approval.steps,
  });
  
  const actor = { 
    actorType: 'ADMIN' as const, 
    userId: 'u1', 
    userNo: 'U1',
    role: 'MLRO', 
    roleCodes: ['MLRO'],
  };
  
  await service.reject('case-1', { reason: 'not acceptable' } as any, actor);
  
  // step 1 被标记 REJECTED
  expect(prismaMock.approvalStep.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ status: 'REJECTED' }),
    }),
  );
  
  // case 被立即标记 REJECTED, 不等 step 2
  expect(prismaMock.approvalCase.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ status: 'REJECTED' }),
    }),
  );
});
```

- [ ] **Step 2: Run test**

```bash
npm test -- src/modules/governance/approvals/approvals.service.spec.ts -t "reject on any step" --runInBand
```

**Expected**: FAIL or PASS depending on current reject implementation. If current reject uses `stepNo: 1` hardcode, it may accidentally pass for the first-step case. Re-read the current reject code:

```bash
sed -n '954,1020p' src/modules/governance/approvals/approvals.service.ts
```

### Task 1.6: Implement multi-step reject logic

**Files:**
- Modify: `Exchange_js/src/modules/governance/approvals/approvals.service.ts`

- [ ] **Step 1: Replace reject() inner transaction**

Find `async reject(...)` method and replace the transaction block with logic analogous to `approve()` but simpler (since reject is immediate-terminal):

```typescript
async reject(id: string, dto: DecisionApprovalDto, actor: ApprovalActorContext) {
  const updated = await this.prisma.$transaction(async (tx: any) => {
    const approval = await this.findCaseOrThrow(id, tx);
    if (approval.status !== ApprovalStatuses.PENDING) {
      throw new BadRequestException('Only PENDING approvals can be rejected');
    }

    this.assertTraceConsistency(approval.traceId, dto.traceId);
    this.assertWorkflowContextConsistency(approval, dto);

    // 找到一个当前 actor 可以签的 pending step
    const currentStep = (approval.steps || []).find(
      (s: any) =>
        s.status === ApprovalStepStatuses.PENDING &&
        (splitRoleCsv(s.checkerRoleCandidates).some((candidate) =>
          (actor.roleCodes || []).includes(candidate),
        ) || this.isSuperAdmin(actor)),
    );
    
    if (!currentStep) {
      throw new ForbiddenException(
        `Actor role ${actor.roleCodes?.join(',')} cannot reject any pending step of this approval`,
      );
    }
    
    const decisionRole = await this.resolveDecisionRole(approval, actor, dto.checkerRole);
    const now = new Date();

    // Mark this step as REJECTED
    await tx.approvalStep.update({
      where: {
        approvalCaseId_stepNo: {
          approvalCaseId: approval.id,
          stepNo: currentStep.stepNo,
        },
      },
      data: {
        status: ApprovalStepStatuses.REJECTED,
        decidedByUserId: actor.userId,
        decidedByUserNo: this.normalizeOptionalString(actor.userNo),
        decidedByRole: decisionRole,
        reason: this.normalizeOptionalString(dto.reason),
        decidedAt: now,
      },
    });
    
    // Mark ALL other pending steps as CANCELLED (因为 case 已 rejected, 它们没机会签了)
    await tx.approvalStep.updateMany({
      where: {
        approvalCaseId: approval.id,
        status: ApprovalStepStatuses.PENDING,
      },
      data: {
        status: ApprovalStepStatuses.CANCELLED,
      },
    });
    
    // Case REJECTED immediately (不等其他 step)
    return tx.approvalCase.update({
      where: { id: approval.id },
      data: {
        status: ApprovalStatuses.REJECTED,
        selectedCheckerRole: decisionRole,
        decisionByUserId: actor.userId,
        decisionByUserNo: this.normalizeOptionalString(actor.userNo),
        decisionByRole: decisionRole,
        decisionReason: this.normalizeOptionalString(dto.reason),
        decidedAt: now,
      },
      include: this.approvalInclude(),
    }) as Promise<ApprovalCaseRow>;
  });

  await this.recordAudit(
    AuditActions.APPROVAL_REJECTED,
    updated,
    actor,
    AuditResult.SUCCESS,
    dto.reason || 'Approval rejected',
    ApprovalStatuses.PENDING,
    ApprovalStatuses.REJECTED,
  );
  await this.projectGovernanceApprovalDecision(updated);
  await this.emitApprovalEvent(ApprovalEvents.REJECTED, this.buildEventPayload(updated));
  return this.mapApproval(updated, actor);
}
```

- [ ] **Step 2: Run test**

```bash
npm test -- src/modules/governance/approvals/approvals.service.spec.ts -t "multi-step approval" --runInBand
```

**Expected**: All multi-step tests PASS.

- [ ] **Step 3: Run full approvals test suite**

```bash
npm test -- src/modules/governance/approvals/approvals.service.spec.ts --runInBand
```

**Expected**: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/governance/approvals/approvals.service.ts \
        src/modules/governance/approvals/approvals.service.spec.ts
git commit -m "feat(approvals): multi-step approve and reject logic"
```

### Task 1.7: Integration test for PEP 2-step flow

**Files:**
- Modify: `Exchange_js/src/modules/governance/approvals/approvals.service.spec.ts`

- [ ] **Step 1: Add end-to-end multi-step integration test**

Add a test that simulates the full PEP flow:

```typescript
it('integration: full 2-step PEP approval lifecycle (MLRO → SENIOR)', async () => {
  // Mock policy for PEP_RELATIONSHIP_APPROVAL
  (service as any).approvalPolicyService.getPolicy = jest.fn().mockResolvedValue({
    riskLevel: 'HIGH',
    checkerRoles: ['MLRO', 'SENIOR_MANAGEMENT_OFFICER'],
    timeoutHours: 240,
    allowCancel: true,
    allowRetry: true,
  });
  
  // Step 1: createDraftCase 应该产生 2 个 steps
  let caseRecord: any = {
    id: 'pep-case-1',
    actionType: 'PEP_RELATIONSHIP_APPROVAL',
    entityRef: 'client_risk_assessment:assessment-1',
    status: 'DRAFT',
    traceId: 'trace-pep-1',
    selectedCheckerRole: 'MLRO',
    createdByUserId: 'system',
    steps: [
      { id: 's1', stepNo: 1, status: 'PENDING', checkerRoleCandidates: 'MLRO' },
      { id: 's2', stepNo: 2, status: 'PENDING', checkerRoleCandidates: 'SENIOR_MANAGEMENT_OFFICER' },
    ],
  };
  
  prismaMock.approvalCase.findFirst = jest.fn().mockResolvedValue(null);
  prismaMock.approvalCase.create = jest.fn().mockResolvedValue(caseRecord);
  
  const result = await (service as any).createDraftCase(
    {
      actionType: 'PEP_RELATIONSHIP_APPROVAL',
      entityRef: 'client_risk_assessment:assessment-1',
      metadata: {},
    },
    { actorType: 'ADMIN', userId: 'system', roleCodes: ['SUPER_ADMIN'] },
  );
  
  expect(result.steps).toHaveLength(2);
  
  // Step 2: MLRO approves step 1
  caseRecord.status = 'PENDING';
  prismaMock.approvalCase.findUnique = jest.fn().mockResolvedValue(caseRecord);
  prismaMock.approvalStep.update = jest.fn().mockImplementation(async ({ where, data }) => {
    const step = caseRecord.steps.find((s: any) => s.stepNo === where.approvalCaseId_stepNo.stepNo);
    if (step) Object.assign(step, data);
    return step;
  });
  prismaMock.approvalCase.update = jest.fn().mockImplementation(async ({ data }) => {
    Object.assign(caseRecord, data);
    return caseRecord;
  });
  
  const mlroActor = { 
    actorType: 'ADMIN' as const, 
    userId: 'mlro-1', userNo: 'M1',
    role: 'MLRO', roleCodes: ['MLRO'],
  };
  
  await service.approve('pep-case-1', { reason: 'mlro ok' } as any, mlroActor);
  
  // 验证 step 1 = APPROVED
  expect(caseRecord.steps[0].status).toBe('APPROVED');
  // 验证 step 2 仍 PENDING
  expect(caseRecord.steps[1].status).toBe('PENDING');
  
  // Step 3: SENIOR approves step 2 — case APPROVED
  const seniorActor = { 
    actorType: 'ADMIN' as const, 
    userId: 'senior-1', userNo: 'S1',
    role: 'SENIOR_MANAGEMENT_OFFICER', 
    roleCodes: ['SENIOR_MANAGEMENT_OFFICER'],
  };
  
  await service.approve('pep-case-1', { reason: 'senior ok' } as any, seniorActor);
  
  // 验证 step 2 = APPROVED
  expect(caseRecord.steps[1].status).toBe('APPROVED');
  // 验证 case = APPROVED
  expect(caseRecord.status).toBe('APPROVED');
});
```

- [ ] **Step 2: Run integration test**

```bash
npm test -- src/modules/governance/approvals/approvals.service.spec.ts -t "full 2-step PEP" --runInBand
```

**Expected**: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/approvals/approvals.service.spec.ts
git commit -m "test(approvals): add 2-step PEP approval integration test"
```

**Phase 1 Complete**: Wave 1 approval kernel 支持多步签字。Commit: `feat(approvals): multi-step approve and reject logic` + `test(approvals): 2-step PEP integration test`. 代码已就绪接受 Phase 2 的 action type catalog 变更。

---

## Phase 2: Schema Migration + Action Type Catalog

**目标**: 给 `customer_main` 加 Wave 3 新字段 + rename 3 个 final approval 字段；创建 3 张新表；catalog 里新增 3 个 action type。

**风险**: `customer_main` 的 rename 会级联到 `onboarding-final-approval.service.ts`、admin-web `CustomerDetail.tsx` 和各测试。必须作为一个原子变更批次完成。

**策略**: 
- 新增动作先做（向后兼容），不会破坏任何现有代码
- 然后做 rename，必须和所有下游引用一起更新
- 保留 `ONBOARDING_FINAL_APPROVAL` action type（直到 Phase 5 onboarding flow 完全迁移才删）

### Task 2.1: 添加 3 个新 action type 到 catalog (非破坏性)

**Files:**
- Modify: `Exchange_js/src/modules/governance/approvals/constants/approval.constants.ts`

- [ ] **Step 1: Add new action type keys**

Edit `approval.constants.ts`. Find the `ApprovalActionTypes` const object and add 3 new entries:

```typescript
export const ApprovalActionTypes = {
  AUDIT_EVIDENCE_EXPORT_APPROVAL: 'AUDIT_EVIDENCE_EXPORT_APPROVAL',
  CASE_EVIDENCE_EXPORT_APPROVAL: 'CASE_EVIDENCE_EXPORT_APPROVAL',
  CHANGE_TICKET_APPROVAL: 'CHANGE_TICKET_APPROVAL',
  DELETE_REQUEST_APPROVAL: 'DELETE_REQUEST_APPROVAL',
  ONBOARDING_FINAL_APPROVAL: 'ONBOARDING_FINAL_APPROVAL',
  POOL_SETTLEMENT_BATCH_APPROVAL: 'POOL_SETTLEMENT_BATCH_APPROVAL',
  TREASURY_CROSS_POOL_TRANSFER_APPROVAL: 'TREASURY_CROSS_POOL_TRANSFER_APPROVAL',
  // ─── Wave 3 new (2026-04-09) ──────────────────────────────────
  RISK_RATING_MEDIUM_APPROVAL: 'RISK_RATING_MEDIUM_APPROVAL',
  RISK_RATING_HIGH_APPROVAL: 'RISK_RATING_HIGH_APPROVAL',
  PEP_RELATIONSHIP_APPROVAL: 'PEP_RELATIONSHIP_APPROVAL',
} as const;
```

- [ ] **Step 2: Add default policies for 3 new types**

In the same file, find `DEFAULT_APPROVAL_POLICIES` and add 3 new entries at the end:

```typescript
  [ApprovalActionTypes.RISK_RATING_MEDIUM_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    checkerRoles: ['COMPLIANCE_OFFICER'],
    timeoutHours: 168,  // 7 days
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.RISK_RATING_HIGH_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    checkerRoles: ['MLRO'],
    timeoutHours: 168,  // 7 days
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.PEP_RELATIONSHIP_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    checkerRoles: ['MLRO', 'SENIOR_MANAGEMENT_OFFICER'],  // dual sign
    timeoutHours: 240,  // 10 days
    allowCancel: true,
    allowRetry: true,
  },
```

- [ ] **Step 3: Update header comment**

At the top of the file, update the header comment block:

```typescript
/**
 * WAVE 1 STABLE CONTRACT
 * ...existing stable entries...
 *
 * Wave 3 (2026-04-09) new types — firm-driven customer review:
 *   RISK_RATING_MEDIUM_APPROVAL   — LOW→MED upgrade / MED initial at onboarding
 *   RISK_RATING_HIGH_APPROVAL     — HIGH reaffirm / →HIGH upgrade / HIGH initial
 *   PEP_RELATIONSHIP_APPROVAL     — FATF R.12 PEP dual-sign (MLRO + SENIOR)
 *
 * The ONBOARDING_FINAL_APPROVAL type is kept until Phase 5 migrates onboarding
 * flow to use the new Wave 3 types. Scheduled for removal after that.
 */
```

- [ ] **Step 4: Run existing approval tests to ensure no regression**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm test -- src/modules/governance/approvals --runInBand
```

**Expected**: ALL PASS. New types are additive, no existing test should break.

- [ ] **Step 5: Commit**

```bash
git add src/modules/governance/approvals/constants/approval.constants.ts
git commit -m "feat(approvals): add Wave 3 action types (RISK_RATING_MEDIUM/HIGH, PEP_RELATIONSHIP)"
```

### Task 2.2: 添加 3 张新 Prisma 模型

**Files:**
- Modify: `Exchange_js/prisma/schema.prisma`

- [ ] **Step 1: Append 3 new models at the end of schema.prisma**

Open `prisma/schema.prisma`. At the end of the file (after all existing models, before any `// END` marker), add:

```prisma
// ═══════════════════════════════════════════════════════════════
// Wave 3 Firm-Driven Customer Review (2026-04-09)
// ═══════════════════════════════════════════════════════════════

model CustomerMaterialHolding {
  id                   String   @id @default(cuid())
  customerId           String
  customer             CustomerMain @relation("CustomerMaterialHoldings", fields: [customerId], references: [id])
  
  materialType         String
  managementMode       String
  
  verifiedAt           DateTime
  expiresAt            DateTime?
  status               String   @default("FRESH")
  
  sumsubIdDocSetType   String?
  sumsubDocId          String?
  
  activeRefreshCycleId String?  @unique
  activeRefreshCycle   MaterialRefreshCycle? @relation("ActiveRefreshCycle", fields: [activeRefreshCycleId], references: [id])
  
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  
  refreshCycles        MaterialRefreshCycle[] @relation("HoldingRefreshCycles")
  
  @@unique([customerId, materialType])
  @@index([expiresAt, status])
  @@index([customerId])
  @@map("customer_material_holdings")
}

model MaterialRefreshCycle {
  id                       String   @id @default(cuid())
  cycleNo                  String   @unique
  customerId               String
  customer                 CustomerMain @relation("CustomerMaterialRefreshCycles", fields: [customerId], references: [id])
  
  holdingId                String
  holding                  CustomerMaterialHolding @relation("HoldingRefreshCycles", fields: [holdingId], references: [id])
  
  materialType             String
  
  status                   String   @default("PENDING_CUSTOMER_EVIDENCE")
  stage                    String   @default("NUDGE_ONLY")
  triggerType              String
  
  createdAt                DateTime @default(now())
  stageNudgeAt             DateTime?
  stageUrgentAt            DateTime?
  stageBlockingAt          DateTime?
  clearedAt                DateTime?
  rejectedAt               DateTime?
  graceExpiresAt           DateTime?
  resolutionReason         String?
  
  sumsubActionId           String?
  sumsubActionLevelName    String?
  sumsubActionCreatedAt    DateTime?
  
  triggeredByAssessmentId  String?
  triggeredByAssessment    ClientRiskAssessment? @relation("AssessmentTriggeredCycles", fields: [triggeredByAssessmentId], references: [id])
  
  traceId                  String   @unique
  
  activeForHolding         CustomerMaterialHolding? @relation("ActiveRefreshCycle")
  
  @@index([customerId, status])
  @@index([status, graceExpiresAt])
  @@index([sumsubActionId])
  @@map("material_refresh_cycles")
}

model ClientRiskAssessment {
  id                          String   @id @default(cuid())
  assessmentNo                String   @unique
  customerId                  String
  customer                    CustomerMain @relation("CustomerRiskAssessments", fields: [customerId], references: [id])
  
  triggerType                 String
  triggeredAt                 DateTime @default(now())
  
  sumsubAmlCheckRequestedAt   DateTime?
  sumsubAmlCheckInspectionId  String?
  sumsubAmlReviewAnswer       String?
  sumsubAmlLabels             String?  // JSON string (SQLite)
  sumsubAmlRejectType         String?
  sumsubSnapshotAt            DateTime?
  sumsubRiskScore             Int?
  sumsubTags                  String?  // JSON string
  
  policyVersion               String
  resultingRiskTier           String?
  previousRiskTier            String?
  scoreSuggestedTier          String?
  recommendedAction           String?
  reasoning                   String?  // JSON string
  
  status                      String   @default("PENDING_SUMSUB_RESULT")
  signoffMethod               String?
  approvalCaseId              String?
  approvalCase                ApprovalCase? @relation("ClientRiskAssessmentApprovalCase", fields: [approvalCaseId], references: [id])
  signedBy                    String?
  signedAt                    DateTime?
  signedUnderPolicyVersion    String?
  
  sumsubInternalCaseRef       String?
  sumsubCaseFinalDecision     String?
  sumsubCaseDecidedAt         DateTime?
  
  triggeredRefreshCycles      MaterialRefreshCycle[] @relation("AssessmentTriggeredCycles")
  
  traceId                     String   @unique
  createdAt                   DateTime @default(now())
  
  @@index([customerId, status])
  @@index([customerId, triggeredAt])
  @@index([sumsubAmlCheckInspectionId])
  @@index([status, triggeredAt])
  @@map("client_risk_assessments")
}
```

**重要 SQLite 说明**: `Json` 类型字段（`sumsubAmlLabels`, `sumsubTags`, `reasoning`）在 SQLite 下用 `String` 存 JSON 序列化，代码层用 `JSON.parse/stringify` 处理。Prisma 对 SQLite 不原生支持 `Json` 类型。

### Task 2.3: 更新 CustomerMain 添加新字段 + rename

**Files:**
- Modify: `Exchange_js/prisma/schema.prisma`

- [ ] **Step 1: Read current CustomerMain model**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
awk '/^model CustomerMain /,/^\}/' prisma/schema.prisma | head -60
```

找到 `latestFinalApprovalId`, `latestFinalApprovalStatus`, `latestFinalApproval` 这 3 行的位置。

- [ ] **Step 2: Rename + add new fields atomically**

在 `CustomerMain` model 内找到这 3 行：

```prisma
  latestFinalApprovalId           String?   @unique
  latestFinalApprovalStatus       String?
  latestFinalApproval             ApprovalCase?  @relation("CustomerLatestFinalApproval", fields: [latestFinalApprovalId], references: [id], onDelete: SetNull)
```

替换为：

```prisma
  // ─── renamed 2026-04-09 ──────────────────────
  latestRiskApprovalId            String?   @unique
  latestRiskApprovalStatus        String?
  latestRiskApproval              ApprovalCase?  @relation("CustomerLatestRiskApproval", fields: [latestRiskApprovalId], references: [id], onDelete: SetNull)
  
  // ─── Wave 3 new 2026-04-09 ───────────────────
  riskTier                        String    @default("LOW")
  riskTierUpdatedAt               DateTime?
  pepStatus                       String    @default("NONE")
  pepConfirmedAt                  DateTime?
  latestRiskAssessmentId          String?
  
  // Wave 3 relations
  materialHoldings                CustomerMaterialHolding[]  @relation("CustomerMaterialHoldings")
  materialRefreshCycles           MaterialRefreshCycle[]     @relation("CustomerMaterialRefreshCycles")
  riskAssessments                 ClientRiskAssessment[]     @relation("CustomerRiskAssessments")
```

- [ ] **Step 3: Also find and remove any @@index references to old field names**

Search for any `@@index([latestFinalApprovalStatus])` or similar in CustomerMain block and rename:

```prisma
// BEFORE:
@@index([latestFinalApprovalStatus])

// AFTER:
@@index([latestRiskApprovalStatus])
```

- [ ] **Step 4: Update ApprovalCase model relation name**

Find `ApprovalCase` model in schema.prisma. Look for:

```prisma
  latestForCustomerFinalApproval  CustomerMain?  @relation("CustomerLatestFinalApproval")
```

Replace with:

```prisma
  latestForCustomerRiskApproval     CustomerMain?                  @relation("CustomerLatestRiskApproval")
  riskAssessments                   ClientRiskAssessment[]         @relation("ClientRiskAssessmentApprovalCase")
```

- [ ] **Step 5: Validate schema syntax**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npx prisma validate
```

**Expected**: `The schema at prisma/schema.prisma is valid 🚀`

If validation fails, common issues:
- Relation name mismatch between model sides
- Missing back-reference
- Typo in field name

### Task 2.4: 生成 SQLite migration

**Files:**
- Create: `Exchange_js/prisma/migrations/20260409120000_wave3_firm_driven_review/migration.sql`

- [ ] **Step 1: Generate migration**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npx prisma migrate dev --name wave3_firm_driven_review --create-only
```

`--create-only` 生成 SQL 但不应用，让我们先审查。

- [ ] **Step 2: Review generated migration SQL**

```bash
cat prisma/migrations/20260409120000_wave3_firm_driven_review/migration.sql
```

应该包含：
- `ALTER TABLE "customer_main" RENAME COLUMN "latestFinalApprovalId" TO "latestRiskApprovalId"` (Prisma 会用 table-recreate 模式实现，因为 SQLite rename column 早期版本不支持)
- ALTER TABLE 添加 riskTier / pepStatus / latestRiskAssessmentId 等字段
- CREATE TABLE customer_material_holdings
- CREATE TABLE material_refresh_cycles
- CREATE TABLE client_risk_assessments
- CREATE INDEX 语句

**⚠️ 如果 Prisma 生成的是 table-recreate 模式**（`CREATE TABLE "new_customer_main" ... DROP TABLE "customer_main" ... ALTER TABLE "new_customer_main" RENAME`），**参考 `docs/cleanup/deferred-refactors.md` 里的"Use ALTER TABLE DROP COLUMN"经验教训**：
- 这种 recreate 模式会丢失所有 FK constraints pointing to customer_main
- 需要手动调整成 `ALTER TABLE ... DROP COLUMN` + `ALTER TABLE ... ADD COLUMN` 形式

**Option A (推荐, 若 SQLite 3.35+)**: 手动改写 migration.sql 使用原生 DROP/ADD COLUMN:

```sql
-- 手动覆盖 Prisma 生成的 table-recreate, 改用原生 ALTER TABLE
-- (Reference: docs/cleanup/deferred-refactors.md gotcha about SQLite table-recreate)

-- 1. Rename latestFinalApprovalId → latestRiskApprovalId
-- SQLite 3.25+ 支持 RENAME COLUMN
ALTER TABLE "customer_main" RENAME COLUMN "latestFinalApprovalId" TO "latestRiskApprovalId";
ALTER TABLE "customer_main" RENAME COLUMN "latestFinalApprovalStatus" TO "latestRiskApprovalStatus";

-- 2. Add new Wave 3 columns
ALTER TABLE "customer_main" ADD COLUMN "riskTier" TEXT NOT NULL DEFAULT 'LOW';
ALTER TABLE "customer_main" ADD COLUMN "riskTierUpdatedAt" DATETIME;
ALTER TABLE "customer_main" ADD COLUMN "pepStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "customer_main" ADD COLUMN "pepConfirmedAt" DATETIME;
ALTER TABLE "customer_main" ADD COLUMN "latestRiskAssessmentId" TEXT;

-- 3. Update index name
DROP INDEX IF EXISTS "customer_main_latestFinalApprovalStatus_idx";
CREATE INDEX "customer_main_latestRiskApprovalStatus_idx" ON "customer_main"("latestRiskApprovalStatus");

-- 4. Create 3 new Wave 3 tables
CREATE TABLE "customer_material_holdings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "materialType" TEXT NOT NULL,
    "managementMode" TEXT NOT NULL,
    "verifiedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'FRESH',
    "sumsubIdDocSetType" TEXT,
    "sumsubDocId" TEXT,
    "activeRefreshCycleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "customer_material_holdings_customerId_fkey" 
      FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "customer_material_holdings_customerId_materialType_key" 
  ON "customer_material_holdings"("customerId", "materialType");
CREATE UNIQUE INDEX "customer_material_holdings_activeRefreshCycleId_key" 
  ON "customer_material_holdings"("activeRefreshCycleId");
CREATE INDEX "customer_material_holdings_expiresAt_status_idx" 
  ON "customer_material_holdings"("expiresAt", "status");
CREATE INDEX "customer_material_holdings_customerId_idx" 
  ON "customer_material_holdings"("customerId");

CREATE TABLE "material_refresh_cycles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cycleNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "holdingId" TEXT NOT NULL,
    "materialType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_CUSTOMER_EVIDENCE',
    "stage" TEXT NOT NULL DEFAULT 'NUDGE_ONLY',
    "triggerType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stageNudgeAt" DATETIME,
    "stageUrgentAt" DATETIME,
    "stageBlockingAt" DATETIME,
    "clearedAt" DATETIME,
    "rejectedAt" DATETIME,
    "graceExpiresAt" DATETIME,
    "resolutionReason" TEXT,
    "sumsubActionId" TEXT,
    "sumsubActionLevelName" TEXT,
    "sumsubActionCreatedAt" DATETIME,
    "triggeredByAssessmentId" TEXT,
    "traceId" TEXT NOT NULL,
    CONSTRAINT "material_refresh_cycles_customerId_fkey" 
      FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "material_refresh_cycles_holdingId_fkey" 
      FOREIGN KEY ("holdingId") REFERENCES "customer_material_holdings" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "material_refresh_cycles_triggeredByAssessmentId_fkey" 
      FOREIGN KEY ("triggeredByAssessmentId") REFERENCES "client_risk_assessments" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "material_refresh_cycles_cycleNo_key" ON "material_refresh_cycles"("cycleNo");
CREATE UNIQUE INDEX "material_refresh_cycles_traceId_key" ON "material_refresh_cycles"("traceId");
CREATE INDEX "material_refresh_cycles_customerId_status_idx" 
  ON "material_refresh_cycles"("customerId", "status");
CREATE INDEX "material_refresh_cycles_status_graceExpiresAt_idx" 
  ON "material_refresh_cycles"("status", "graceExpiresAt");
CREATE INDEX "material_refresh_cycles_sumsubActionId_idx" 
  ON "material_refresh_cycles"("sumsubActionId");

CREATE TABLE "client_risk_assessments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assessmentNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "triggeredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sumsubAmlCheckRequestedAt" DATETIME,
    "sumsubAmlCheckInspectionId" TEXT,
    "sumsubAmlReviewAnswer" TEXT,
    "sumsubAmlLabels" TEXT,
    "sumsubAmlRejectType" TEXT,
    "sumsubSnapshotAt" DATETIME,
    "sumsubRiskScore" INTEGER,
    "sumsubTags" TEXT,
    "policyVersion" TEXT NOT NULL,
    "resultingRiskTier" TEXT,
    "previousRiskTier" TEXT,
    "scoreSuggestedTier" TEXT,
    "recommendedAction" TEXT,
    "reasoning" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_SUMSUB_RESULT',
    "signoffMethod" TEXT,
    "approvalCaseId" TEXT,
    "signedBy" TEXT,
    "signedAt" DATETIME,
    "signedUnderPolicyVersion" TEXT,
    "sumsubInternalCaseRef" TEXT,
    "sumsubCaseFinalDecision" TEXT,
    "sumsubCaseDecidedAt" DATETIME,
    "traceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "client_risk_assessments_customerId_fkey" 
      FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "client_risk_assessments_approvalCaseId_fkey" 
      FOREIGN KEY ("approvalCaseId") REFERENCES "approval_cases" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "client_risk_assessments_assessmentNo_key" ON "client_risk_assessments"("assessmentNo");
CREATE UNIQUE INDEX "client_risk_assessments_traceId_key" ON "client_risk_assessments"("traceId");
CREATE INDEX "client_risk_assessments_customerId_status_idx" 
  ON "client_risk_assessments"("customerId", "status");
CREATE INDEX "client_risk_assessments_customerId_triggeredAt_idx" 
  ON "client_risk_assessments"("customerId", "triggeredAt");
CREATE INDEX "client_risk_assessments_sumsubAmlCheckInspectionId_idx" 
  ON "client_risk_assessments"("sumsubAmlCheckInspectionId");
CREATE INDEX "client_risk_assessments_status_triggeredAt_idx" 
  ON "client_risk_assessments"("status", "triggeredAt");
```

**⚠️ Note on forward-reference**: `material_refresh_cycles` 的 FK 指向 `client_risk_assessments`，但在 `material_refresh_cycles` 之前还没 CREATE。SQL 需要 **先创建 `client_risk_assessments`**，再创建 `material_refresh_cycles`。调整顺序：先 client_risk_assessments，再 customer_material_holdings（依赖 material_refresh_cycles 的 FK，但那是 `activeRefreshCycleId` 指向 material_refresh_cycles，需要循环引用处理）。

**实际可行的 CREATE 顺序**:
1. `client_risk_assessments` (无 FK 依赖)
2. `customer_material_holdings` (FK 到 customer_main, 暂时不加 activeRefreshCycleId 的 FK)
3. `material_refresh_cycles` (FK 到 customer_main + customer_material_holdings + client_risk_assessments)
4. 补加 `customer_material_holdings.activeRefreshCycleId` 的 FK (SQLite 不支持 ADD CONSTRAINT, 所以这个 FK 只能通过 table-recreate, 不实际执行，依赖 Prisma client 层的约束)

简化方案：**不对 `activeRefreshCycleId` 声明 DB 层 FK**，只在 Prisma schema 里声明 relation (Prisma client 层面保证)。SQLite 没有 ON DELETE CASCADE 也能工作。

- [ ] **Step 3: Apply migration (dev)**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npx prisma migrate dev
```

**Expected**: 
- Migration 应用成功
- Prisma client 自动重新生成

如果失败：
- 检查 SQL 语法
- 检查 CREATE TABLE 顺序（循环依赖）
- 可能需要临时用 `sqlite3 prisma/dev.db` 手动修 schema

- [ ] **Step 4: Verify schema with a query**

```bash
npx prisma studio
```

在 Prisma Studio 里应该能看到：
- `customer_main` 有 `latestRiskApprovalId`, `riskTier`, `pepStatus` 等新字段
- 3 张新表 `customer_material_holdings`, `material_refresh_cycles`, `client_risk_assessments` 存在

关闭 Studio 继续。

### Task 2.5: 修复 TypeScript 编译错误（级联 rename）

**Files:**
- Modify: `Exchange_js/src/modules/identity/onboarding/onboarding-final-approval.service.ts`
- Modify: `Exchange_js/src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts`

- [ ] **Step 1: 尝试 build，收集编译错误**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm run build 2>&1 | head -50
```

**Expected failures**:
- `onboarding-final-approval.service.ts` 里所有 `latestFinalApprovalId` → 找不到
- `onboarding-final-approval.service.spec.ts` 里所有 `latestFinalApprovalStatus` → 找不到
- 可能还有其他引用处

- [ ] **Step 2: Find all references**

```bash
grep -rn "latestFinalApproval" src/ 2>/dev/null
```

- [ ] **Step 3: 用 sed 批量替换 (src/ 下所有 .ts 文件)**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
find src -name "*.ts" -exec sed -i '' \
  -e 's/latestFinalApprovalId/latestRiskApprovalId/g' \
  -e 's/latestFinalApprovalStatus/latestRiskApprovalStatus/g' \
  -e 's/latestFinalApproval\b/latestRiskApproval/g' \
  {} +
```

**注意**: macOS `sed -i ''` 的空字符串语法。Linux 用 `sed -i -e`。

- [ ] **Step 4: Verify the replacement**

```bash
grep -rn "latestFinalApproval" src/ 2>/dev/null
```

**Expected**: 无输出（全部 replaced）。

- [ ] **Step 5: 再 build**

```bash
npm run build 2>&1 | tail -30
```

**Expected**: Build 成功。如果还有 error，检查：
- Prisma 关系名 `CustomerLatestFinalApproval` → `CustomerLatestRiskApproval` 是否同步更新
- 有没有动态字符串引用 `'latestFinalApproval'` 没被 sed 捕获

- [ ] **Step 6: Run affected tests**

```bash
npm test -- src/modules/identity/onboarding --runInBand
```

**Expected**: ALL PASS. 测试里的 `latestFinalApproval*` 已被 sed 替换。

### Task 2.6: 修复 admin-web 的级联 rename

**Files:**
- Modify: `Exchange_js/admin-web/src/pages/CustomerDetail.tsx`

- [ ] **Step 1: Sed 批量替换 admin-web**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
find admin-web/src -name "*.tsx" -o -name "*.ts" | xargs sed -i '' \
  -e 's/latestFinalApprovalId/latestRiskApprovalId/g' \
  -e 's/latestFinalApprovalStatus/latestRiskApprovalStatus/g' \
  -e 's/latestFinalApproval\b/latestRiskApproval/g' \
  -e 's/FinalApprovalSummary/RiskApprovalSummary/g'
```

- [ ] **Step 2: Check for remaining display strings**

```bash
grep -rn "Final Approval\|final approval\|ONBOARDING_FINAL_APPROVAL" admin-web/src/ 2>/dev/null | head -20
```

对于用户可见的显示字符串（例如 "Final Approval"），**保留** —— 只在 Phase 5 onboarding flow 迁移完成后才改文案。因为 Phase 2-4 之间，onboarding-final-approval.service 仍然在创建 ONBOARDING_FINAL_APPROVAL 类型的 case，admin 页面需要继续能显示它。

- [ ] **Step 3: Build admin-web**

```bash
cd admin-web
npm run build 2>&1 | tail -20
cd ..
```

**Expected**: Build 成功。

- [ ] **Step 4: Commit all Phase 2 changes**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
git add prisma/schema.prisma \
        prisma/migrations/20260409120000_wave3_firm_driven_review/ \
        src/modules/governance/approvals/constants/approval.constants.ts \
        src/modules/identity/onboarding/ \
        admin-web/src/pages/CustomerDetail.tsx
git commit -m "feat(schema): Wave 3 firm-driven review — add holdings/cycles/assessments tables + rename customer.latestFinalApproval→latestRiskApproval"
```

- [ ] **Step 5: 跑完整测试套件做回归**

```bash
npm test --runInBand 2>&1 | tail -30
```

**Expected**: ALL PASS. 如果有失败：
- 检查是否有未 sed 到的字符串引用
- 检查 Prisma client 是否正确生成

**Phase 2 Complete**: 
- 3 新表创建 + customer_main rename + add fields
- 3 新 action type 加入 catalog
- 全部 TypeScript 代码通过编译
- 全部现有测试通过
- Commit: `feat(schema): Wave 3 ...`

Phase 3 和 Phase 4 现在可以启动 (Layer 2 / Layer 3 业务代码)。

---

## Phase 3: Layer 2 Client Risk Assessment Implementation

**目标**: 实现 Layer 2 的完整业务逻辑——policy pure function + ClientRiskAssessmentService + quarterly cron。

**策略**: 严格 TDD。Policy 函数是纯函数，可以用表驱动测试穷举所有分支。Service 层用 mock 隔离依赖测试。

### Task 3.1: 创建 `config/client-risk-assessment-policy.json`

**Files:**
- Create: `Exchange_js/config/client-risk-assessment-policy.json`

- [ ] **Step 1: Write the config file**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
mkdir -p config
```

Create `config/client-risk-assessment-policy.json`:

```json
{
  "version": "1.0.0",
  "effectiveFrom": "2026-04-09",
  "assessmentFrequencyDays": {
    "LOW": 90,
    "MEDIUM": 90,
    "HIGH": 90
  },
  "tierMappingRules": [
    {
      "priority": 1,
      "condition": "labels_contains_SANCTIONS",
      "tier": "HIGH",
      "action": "ESCALATE_TO_SUMSUB_CASE",
      "immediateEffect": "FREEZE",
      "signoffMethod": "ESCALATED"
    },
    {
      "priority": 2,
      "condition": "labels_contains_PEP",
      "tier": "HIGH",
      "action": "PEP_REVIEW",
      "immediateEffect": "RESTRICT",
      "signoffMethod": "DUAL_MLRO_SENIOR"
    },
    {
      "priority": 3,
      "condition": "labels_contains_ADVERSE_MEDIA",
      "tier": "HIGH",
      "action": "MANUAL_REVIEW",
      "signoffMethod": "MANUAL_MLRO"
    },
    {
      "priority": 4,
      "condition": "red_other",
      "tier": "KEEP_PREVIOUS",
      "action": "MANUAL_REVIEW",
      "signoffMethod": "MANUAL_MLRO"
    },
    {
      "priority": 5,
      "condition": "any_required_material_stale",
      "tier": "UNKNOWN",
      "action": "REQUEST_REFRESH",
      "signoffMethod": "MANUAL_MLRO"
    },
    {
      "priority": 6,
      "condition": "green_stable",
      "tier": "LOW",
      "action": "REAFFIRM",
      "signoffMethod": "AUTO_R2"
    }
  ],
  "signoffActionTypeMap": {
    "MANUAL_COMPLIANCE_OFFICER": "RISK_RATING_MEDIUM_APPROVAL",
    "MANUAL_MLRO": "RISK_RATING_HIGH_APPROVAL",
    "DUAL_MLRO_SENIOR": "PEP_RELATIONSHIP_APPROVAL"
  },
  "tierLevelConstraint": {
    "LOW": ["wave3-level-1"],
    "MEDIUM": ["wave3-level-1", "wave3-level-2"],
    "HIGH": ["wave3-level-2"]
  },
  "frozenCustomersSkipLevelSync": true,
  "downgradeForbidden": true
}
```

**关于规则设计**: v1 只有 6 条规则（no behavioral score 复杂打分，因为 A1 决策 defer mirror）。未来当 Sumsub 事件 mirror 做起来，可以在 `priority 3` 和 `priority 4` 之间插入新规则例如 `"local_behavior_score_high"` 等。v1 保持简化。

- [ ] **Step 2: Commit**

```bash
git add config/client-risk-assessment-policy.json
git commit -m "feat(config): add client risk assessment policy v1.0.0"
```

### Task 3.2: 创建模块骨架 + policy loader

**Files:**
- Create: `Exchange_js/src/modules/identity/client-risk-assessment/client-risk-assessment.module.ts`
- Create: `Exchange_js/src/modules/identity/client-risk-assessment/policy/policy-loader.ts`
- Create: `Exchange_js/src/modules/identity/client-risk-assessment/policy/policy-loader.spec.ts`

- [ ] **Step 1: Write failing test for policy loader**

Create `policy-loader.spec.ts`:

```typescript
import { ClientRiskAssessmentPolicyLoader } from './policy-loader';

describe('ClientRiskAssessmentPolicyLoader', () => {
  let loader: ClientRiskAssessmentPolicyLoader;
  
  beforeEach(() => {
    loader = new ClientRiskAssessmentPolicyLoader();
  });
  
  it('loads policy from config/client-risk-assessment-policy.json', () => {
    const policy = loader.getPolicy();
    
    expect(policy.version).toBe('1.0.0');
    expect(policy.assessmentFrequencyDays).toEqual({
      LOW: 90, MEDIUM: 90, HIGH: 90,
    });
    expect(policy.tierMappingRules).toHaveLength(6);
    expect(policy.downgradeForbidden).toBe(true);
  });
  
  it('caches policy after first load', () => {
    const p1 = loader.getPolicy();
    const p2 = loader.getPolicy();
    expect(p1).toBe(p2); // same reference
  });
  
  it('returns tier→action-type mapping', () => {
    const policy = loader.getPolicy();
    expect(policy.signoffActionTypeMap.MANUAL_MLRO).toBe('RISK_RATING_HIGH_APPROVAL');
    expect(policy.signoffActionTypeMap.DUAL_MLRO_SENIOR).toBe('PEP_RELATIONSHIP_APPROVAL');
  });
});
```

- [ ] **Step 2: Run (should fail because module doesn't exist)**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
mkdir -p src/modules/identity/client-risk-assessment/policy
npm test -- src/modules/identity/client-risk-assessment/policy/policy-loader.spec.ts --runInBand
```

**Expected**: FAIL with "Cannot find module './policy-loader'"

- [ ] **Step 3: Implement policy loader**

Create `policy-loader.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface ClientRiskAssessmentPolicy {
  version: string;
  effectiveFrom: string;
  assessmentFrequencyDays: Record<string, number>;
  tierMappingRules: PolicyRule[];
  signoffActionTypeMap: Record<string, string>;
  tierLevelConstraint: Record<string, string[]>;
  frozenCustomersSkipLevelSync: boolean;
  downgradeForbidden: boolean;
}

export interface PolicyRule {
  priority: number;
  condition: string;
  tier: string;
  action: string;
  immediateEffect?: string;
  signoffMethod: string;
}

@Injectable()
export class ClientRiskAssessmentPolicyLoader {
  private cachedPolicy: ClientRiskAssessmentPolicy | null = null;
  
  getPolicy(): ClientRiskAssessmentPolicy {
    if (this.cachedPolicy) {
      return this.cachedPolicy;
    }
    
    const configPath = path.resolve(
      process.cwd(),
      'config',
      'client-risk-assessment-policy.json',
    );
    const raw = fs.readFileSync(configPath, 'utf8');
    this.cachedPolicy = JSON.parse(raw) as ClientRiskAssessmentPolicy;
    return this.cachedPolicy;
  }
  
  /** For testing: force reload */
  reload(): void {
    this.cachedPolicy = null;
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/modules/identity/client-risk-assessment/policy/policy-loader.spec.ts --runInBand
```

**Expected**: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/client-risk-assessment/policy/
git commit -m "feat(client-risk-assessment): add policy loader"
```

### Task 3.3: Policy pure function (`applyPolicy`)

**Files:**
- Create: `Exchange_js/src/modules/identity/client-risk-assessment/policy/client-risk-assessment-policy.ts`
- Create: `Exchange_js/src/modules/identity/client-risk-assessment/policy/client-risk-assessment-policy.spec.ts`

- [ ] **Step 1: Write the full failing test suite (table-driven)**

Create `client-risk-assessment-policy.spec.ts`:

```typescript
import { applyPolicy, PolicyInput, PolicyOutput } from './client-risk-assessment-policy';
import { ClientRiskAssessmentPolicyLoader } from './policy-loader';

describe('applyPolicy', () => {
  let policy: ReturnType<ClientRiskAssessmentPolicyLoader['getPolicy']>;
  
  beforeAll(() => {
    policy = new ClientRiskAssessmentPolicyLoader().getPolicy();
  });
  
  function makeInput(overrides: Partial<PolicyInput> = {}): PolicyInput {
    return {
      amlAnswer: 'GREEN',
      amlLabels: [],
      holdings: [],
      previousTier: 'LOW',
      previousPepStatus: 'NONE',
      ...overrides,
    };
  }
  
  // Priority 1: sanctions
  it('Priority 1: sanctions hit → HIGH + FREEZE + ESCALATE', () => {
    const result = applyPolicy(
      makeInput({ amlAnswer: 'RED', amlLabels: ['SANCTIONS_UN'] }),
      policy,
    );
    expect(result.resultingTier).toBe('HIGH');
    expect(result.signoffMethod).toBe('ESCALATED');
    expect(result.immediateEffect).toBe('FREEZE');
    expect(result.recommendedAction).toBe('ESCALATE_TO_SUMSUB_CASE');
    expect(result.matchedRule).toBe(1);
  });
  
  it('Priority 1: multiple sanctions labels → still HIGH + FREEZE', () => {
    const result = applyPolicy(
      makeInput({ amlAnswer: 'RED', amlLabels: ['SANCTIONS_UN', 'SANCTIONS_OFAC'] }),
      policy,
    );
    expect(result.resultingTier).toBe('HIGH');
    expect(result.signoffMethod).toBe('ESCALATED');
  });
  
  // Priority 2: PEP (non-sanctions)
  it('Priority 2: PEP hit → HIGH + RESTRICT + DUAL sign', () => {
    const result = applyPolicy(
      makeInput({ amlAnswer: 'RED', amlLabels: ['PEP_CLASS_1_DOMESTIC'] }),
      policy,
    );
    expect(result.resultingTier).toBe('HIGH');
    expect(result.signoffMethod).toBe('DUAL_MLRO_SENIOR');
    expect(result.immediateEffect).toBe('RESTRICT');
    expect(result.matchedRule).toBe(2);
  });
  
  it('Priority 2: sanctions + PEP (both labels) → sanctions wins (priority 1)', () => {
    const result = applyPolicy(
      makeInput({ 
        amlAnswer: 'RED', 
        amlLabels: ['SANCTIONS_UN', 'PEP_CLASS_1_DOMESTIC'] 
      }),
      policy,
    );
    expect(result.matchedRule).toBe(1);  // sanctions wins
    expect(result.signoffMethod).toBe('ESCALATED');
  });
  
  // Priority 3: adverse media
  it('Priority 3: adverse media → HIGH + MLRO manual', () => {
    const result = applyPolicy(
      makeInput({ 
        amlAnswer: 'RED', 
        amlLabels: ['ADVERSE_MEDIA_FRAUD'] 
      }),
      policy,
    );
    expect(result.resultingTier).toBe('HIGH');
    expect(result.signoffMethod).toBe('MANUAL_MLRO');
    expect(result.matchedRule).toBe(3);
  });
  
  // Priority 4: other RED
  it('Priority 4: red_other keeps previous tier + manual review', () => {
    const result = applyPolicy(
      makeInput({ 
        amlAnswer: 'RED', 
        amlLabels: ['OTHER_FLAG'],
        previousTier: 'LOW',
      }),
      policy,
    );
    expect(result.resultingTier).toBe('LOW'); // kept
    expect(result.signoffMethod).toBe('MANUAL_MLRO');
    expect(result.matchedRule).toBe(4);
  });
  
  // Priority 5: stale material
  it('Priority 5: any required material stale → UNKNOWN + request refresh', () => {
    const staleHolding: any = {
      materialType: 'PROOF_OF_ADDRESS',
      status: 'EXPIRED',
      expiresAt: new Date('2026-01-01'),
    };
    const result = applyPolicy(
      makeInput({
        amlAnswer: 'GREEN',
        amlLabels: [],
        holdings: [staleHolding],
      }),
      policy,
    );
    expect(result.resultingTier).toBe('UNKNOWN');
    expect(result.recommendedAction).toBe('REQUEST_REFRESH');
    expect(result.matchedRule).toBe(5);
  });
  
  // Priority 6: green stable
  it('Priority 6: green + fresh holdings + LOW previous → LOW auto-reaffirm', () => {
    const freshHolding: any = {
      materialType: 'PROOF_OF_ADDRESS',
      status: 'FRESH',
      expiresAt: new Date('2027-01-01'),
    };
    const result = applyPolicy(
      makeInput({
        amlAnswer: 'GREEN',
        holdings: [freshHolding],
        previousTier: 'LOW',
      }),
      policy,
    );
    expect(result.resultingTier).toBe('LOW');
    expect(result.signoffMethod).toBe('AUTO_R2');
    expect(result.matchedRule).toBe(6);
  });
  
  // Downgrade forbidden
  it('downgradeForbidden: HIGH previous + green stable → keep HIGH, manual MLRO', () => {
    const freshHolding: any = {
      materialType: 'PROOF_OF_ADDRESS',
      status: 'FRESH',
      expiresAt: new Date('2027-01-01'),
    };
    const result = applyPolicy(
      makeInput({
        amlAnswer: 'GREEN',
        holdings: [freshHolding],
        previousTier: 'HIGH',
      }),
      policy,
    );
    expect(result.resultingTier).toBe('HIGH'); // downgrade blocked
    expect(result.signoffMethod).toBe('MANUAL_MLRO');
    expect(result.scoreSuggestedTier).toBe('LOW');
  });
});
```

- [ ] **Step 2: Run (should fail — module not created)**

```bash
npm test -- src/modules/identity/client-risk-assessment/policy/client-risk-assessment-policy.spec.ts --runInBand
```

**Expected**: FAIL with "Cannot find module './client-risk-assessment-policy'"

- [ ] **Step 3: Implement the pure function**

Create `client-risk-assessment-policy.ts`:

```typescript
import { ClientRiskAssessmentPolicy, PolicyRule } from './policy-loader';

export interface PolicyInput {
  amlAnswer: 'GREEN' | 'RED';
  amlLabels: string[];
  holdings: Array<{
    materialType: string;
    status: string;
    expiresAt: Date | null;
  }>;
  previousTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  previousPepStatus: 'NONE' | 'CONFIRMED' | 'CLEARED';
}

export interface PolicyOutput {
  resultingTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  scoreSuggestedTier?: string;
  recommendedAction: string;
  signoffMethod: string;
  immediateEffect?: string;
  matchedRule: number;
  reasoning: {
    ruleId: string;
    amlAnswer: string;
    amlLabels: string[];
    previousTier: string;
    downgradeBlocked?: boolean;
  };
}

export function applyPolicy(
  input: PolicyInput,
  policy: ClientRiskAssessmentPolicy,
): PolicyOutput {
  // Apply rules by priority, first match wins
  for (const rule of policy.tierMappingRules.sort((a, b) => a.priority - b.priority)) {
    if (matchesCondition(rule.condition, input)) {
      let resultingTier = rule.tier as PolicyOutput['resultingTier'];
      let scoreSuggestedTier: string | undefined;
      let downgradeBlocked = false;
      
      // Handle KEEP_PREVIOUS
      if (rule.tier === 'KEEP_PREVIOUS') {
        resultingTier = input.previousTier;
      }
      
      // Handle downgradeForbidden
      if (
        policy.downgradeForbidden &&
        input.previousTier === 'HIGH' &&
        resultingTier !== 'HIGH' &&
        resultingTier !== 'UNKNOWN'
      ) {
        scoreSuggestedTier = resultingTier;
        resultingTier = 'HIGH';
        downgradeBlocked = true;
      }
      
      // If downgrade blocked, force MANUAL_MLRO instead of AUTO_R2
      let signoffMethod = rule.signoffMethod;
      if (downgradeBlocked && signoffMethod === 'AUTO_R2') {
        signoffMethod = 'MANUAL_MLRO';
      }
      
      return {
        resultingTier,
        scoreSuggestedTier,
        recommendedAction: rule.action,
        signoffMethod,
        immediateEffect: rule.immediateEffect,
        matchedRule: rule.priority,
        reasoning: {
          ruleId: `P${rule.priority}_${rule.condition}`,
          amlAnswer: input.amlAnswer,
          amlLabels: input.amlLabels,
          previousTier: input.previousTier,
          ...(downgradeBlocked && { downgradeBlocked: true }),
        },
      };
    }
  }
  
  // No rule matched — fallback (shouldn't happen with priority 6 as catch-all)
  throw new Error(
    `No policy rule matched for input: ${JSON.stringify({ 
      amlAnswer: input.amlAnswer, 
      labelCount: input.amlLabels.length, 
    })}`,
  );
}

function matchesCondition(condition: string, input: PolicyInput): boolean {
  switch (condition) {
    case 'labels_contains_SANCTIONS':
      return input.amlLabels.some(l => l.startsWith('SANCTIONS_'));
    
    case 'labels_contains_PEP':
      return input.amlLabels.some(l => l.startsWith('PEP_'));
    
    case 'labels_contains_ADVERSE_MEDIA':
      return input.amlLabels.some(l => l.startsWith('ADVERSE_MEDIA'));
    
    case 'red_other':
      return input.amlAnswer === 'RED';
    
    case 'any_required_material_stale':
      return input.holdings.some(
        h => h.status === 'EXPIRED' || h.status === 'MISSING'
      );
    
    case 'green_stable':
      return input.amlAnswer === 'GREEN';
    
    default:
      return false;
  }
}
```

- [ ] **Step 4: Run all policy tests**

```bash
npm test -- src/modules/identity/client-risk-assessment/policy/client-risk-assessment-policy.spec.ts --runInBand
```

**Expected**: ALL tests PASS (should be 8 or so).

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/client-risk-assessment/policy/
git commit -m "feat(client-risk-assessment): add policy applyPolicy pure function"
```

### Task 3.4: ClientRiskAssessmentService — startAssessment + handleSumsubAmlResult

**Files:**
- Create: `Exchange_js/src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts`
- Create: `Exchange_js/src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts`

- [ ] **Step 1: Write failing test for startAssessment idempotency**

Create `client-risk-assessment.service.spec.ts`:

```typescript
import { ClientRiskAssessmentService } from './client-risk-assessment.service';
import { ClientRiskAssessmentPolicyLoader } from './policy/policy-loader';

describe('ClientRiskAssessmentService', () => {
  let service: ClientRiskAssessmentService;
  let prismaMock: any;
  let sumsubClientMock: any;
  let approvalServiceMock: any;
  
  beforeEach(() => {
    prismaMock = {
      clientRiskAssessment: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      customerMain: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      customerMaterialHolding: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((fn) => fn(prismaMock)),
    };
    sumsubClientMock = {
      runAmlCheck: jest.fn(),
      getApplicant: jest.fn(),
      moveToLevel: jest.fn(),
    };
    approvalServiceMock = {
      createCase: jest.fn(),
    };
    const policyLoader = new ClientRiskAssessmentPolicyLoader();
    service = new ClientRiskAssessmentService(
      prismaMock,
      sumsubClientMock,
      approvalServiceMock,
      policyLoader,
      { write: jest.fn() } as any, // audit
    );
  });
  
  describe('startAssessment', () => {
    it('returns existing pending assessment if one exists (idempotent)', async () => {
      const existing = { id: 'a1', status: 'PENDING_SUMSUB_RESULT' };
      prismaMock.clientRiskAssessment.findFirst.mockResolvedValue(existing);
      
      const result = await service.startAssessment({
        customerId: 'c1',
        triggerType: 'SCHEDULED_QUARTERLY',
      });
      
      expect(result).toBe(existing);
      // Should not call create or sumsub
      expect(prismaMock.clientRiskAssessment.create).not.toHaveBeenCalled();
      expect(sumsubClientMock.runAmlCheck).not.toHaveBeenCalled();
    });
    
    it('creates new assessment and calls Sumsub AML check when no pending', async () => {
      prismaMock.clientRiskAssessment.findFirst.mockResolvedValue(null);
      prismaMock.customerMain.findUnique.mockResolvedValue({
        id: 'c1',
        sumsubApplicantId: 'app-1',
        riskTier: 'LOW',
        pepStatus: 'NONE',
      });
      prismaMock.clientRiskAssessment.create.mockResolvedValue({
        id: 'new-assessment-1',
        status: 'PENDING_SUMSUB_RESULT',
      });
      sumsubClientMock.runAmlCheck.mockResolvedValue({ ok: 1 });
      
      const result = await service.startAssessment({
        customerId: 'c1',
        triggerType: 'SCHEDULED_QUARTERLY',
      });
      
      expect(prismaMock.clientRiskAssessment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'c1',
            triggerType: 'SCHEDULED_QUARTERLY',
            status: 'PENDING_SUMSUB_RESULT',
            policyVersion: '1.0.0',
            previousRiskTier: 'LOW',
          }),
        }),
      );
      expect(sumsubClientMock.runAmlCheck).toHaveBeenCalledWith('app-1');
      expect(result.id).toBe('new-assessment-1');
    });
  });
});
```

- [ ] **Step 2: Run (should fail)**

```bash
npm test -- src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts --runInBand
```

**Expected**: FAIL with "Cannot find module"

- [ ] **Step 3: Implement the service (Part 1: startAssessment + constructor)**

Create `client-risk-assessment.service.ts`:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import { ClientRiskAssessmentPolicyLoader } from './policy/policy-loader';
import { applyPolicy, PolicyInput } from './policy/client-risk-assessment-policy';

export type AssessmentTriggerType =
  | 'INITIAL_ONBOARDING'
  | 'SCHEDULED_QUARTERLY'
  | 'SUMSUB_AML_HIT'
  | 'MLRO_MANUAL';

export interface StartAssessmentInput {
  customerId: string;
  triggerType: AssessmentTriggerType;
  triggeredBy?: string;
  triggeredContext?: Record<string, any>;
}

@Injectable()
export class ClientRiskAssessmentService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly sumsubClient: SumsubClient,
    private readonly approvalsService: ApprovalsService,
    private readonly policyLoader: ClientRiskAssessmentPolicyLoader,
    private readonly auditLogsService: AuditLogsService,
  ) {}
  
  /**
   * Layer 2 main entrypoint — will trigger a fresh /aml/check
   */
  async startAssessment(input: StartAssessmentInput): Promise<any> {
    // 1. Idempotency check
    const existing = await this.prisma.clientRiskAssessment.findFirst({
      where: {
        customerId: input.customerId,
        status: 'PENDING_SUMSUB_RESULT',
      },
    });
    if (existing) {
      return existing;
    }
    
    // 2. Load customer
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: input.customerId },
    });
    if (!customer) {
      throw new Error(`Customer ${input.customerId} not found`);
    }
    
    // 3. Create assessment in PENDING_SUMSUB_RESULT
    const policy = this.policyLoader.getPolicy();
    const assessmentNo = await this.generateAssessmentNo();
    const traceId = `CLIENT_RISK_ASSESSMENT:${randomUUID()}`;
    
    const assessment = await this.prisma.clientRiskAssessment.create({
      data: {
        assessmentNo,
        customerId: input.customerId,
        triggerType: input.triggerType,
        policyVersion: policy.version,
        previousRiskTier: customer.riskTier,
        status: 'PENDING_SUMSUB_RESULT',
        sumsubAmlCheckRequestedAt: new Date(),
        traceId,
      },
    });
    
    // 4. Trigger Sumsub AML check
    if (customer.sumsubApplicantId) {
      try {
        await this.sumsubClient.runAmlCheck(customer.sumsubApplicantId);
      } catch (err) {
        // Will be retried by the stuck assessment cron
        // Log and leave assessment in PENDING state
        console.error(
          `Failed to trigger /aml/check for customer ${customer.id}:`,
          err,
        );
      }
    }
    
    return assessment;
  }
  
  private async generateAssessmentNo(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.clientRiskAssessment.count({
      where: {
        assessmentNo: { startsWith: `CRA-${year}-` },
      },
    });
    const seq = String(count + 1).padStart(5, '0');
    return `CRA-${year}-${seq}`;
  }
}
```

- [ ] **Step 4: Run the first 2 tests**

```bash
npm test -- src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts --runInBand
```

**Expected**: Both tests pass (idempotent return + new assessment creation).

如果 fail, 检查:
- Mock 的 findFirst / create 返回值
- 构造函数参数顺序

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/client-risk-assessment/
git commit -m "feat(client-risk-assessment): startAssessment with idempotency + AML check trigger"
```

### Task 3.5: handleSumsubAmlResult (4 paths)

**Files:**
- Modify: `Exchange_js/src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts`
- Modify: `Exchange_js/src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts`

- [ ] **Step 1: Write failing tests for 4 paths**

Add to the spec file's `describe('ClientRiskAssessmentService', ...)`:

```typescript
describe('handleSumsubAmlResult', () => {
  function setupPendingAssessment() {
    prismaMock.clientRiskAssessment.findFirst.mockResolvedValue({
      id: 'a1',
      customerId: 'c1',
      policyVersion: '1.0.0',
      previousRiskTier: 'LOW',
      traceId: 'CLIENT_RISK_ASSESSMENT:test-1',
      status: 'PENDING_SUMSUB_RESULT',
    });
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      sumsubApplicantId: 'app-1',
      riskTier: 'LOW',
      pepStatus: 'NONE',
      complianceHoldStatus: 'CLEAR',
      restrictionStatus: 'CLEAR',
    });
    sumsubClientMock.getApplicant.mockResolvedValue({
      info: { idDocs: [] },
      totalScore: null,
      tags: [],
    });
  }
  
  it('PATH GREEN: LOW→LOW → auto-signs without ApprovalCase', async () => {
    setupPendingAssessment();
    
    await service.handleSumsubAmlResult('insp-1', {
      reviewAnswer: 'GREEN',
      rejectLabels: [],
    } as any);
    
    // Should update assessment to SIGNED
    expect(prismaMock.clientRiskAssessment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SIGNED',
          signedBy: 'SYSTEM',
          signoffMethod: 'AUTO_R2',
          resultingRiskTier: 'LOW',
        }),
      }),
    );
    // Should NOT create approval case
    expect(approvalServiceMock.createCase).not.toHaveBeenCalled();
  });
  
  it('PATH RED SANCTIONS: immediately freezes customer + escalates', async () => {
    setupPendingAssessment();
    
    await service.handleSumsubAmlResult('insp-1', {
      reviewAnswer: 'RED',
      rejectLabels: ['SANCTIONS_UN'],
    } as any);
    
    // Customer frozen
    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          complianceHoldStatus: 'FROZEN',
          complianceHoldReason: expect.stringContaining('sanctions'),
        }),
      }),
    );
    // Assessment ESCALATED_TO_SUMSUB
    expect(prismaMock.clientRiskAssessment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ESCALATED_TO_SUMSUB',
          resultingRiskTier: 'HIGH',
        }),
      }),
    );
    // NO approval case (Sumsub接管)
    expect(approvalServiceMock.createCase).not.toHaveBeenCalled();
  });
  
  it('PATH RED PEP: creates PEP_RELATIONSHIP_APPROVAL dual-sign case', async () => {
    setupPendingAssessment();
    approvalServiceMock.createCase.mockResolvedValue({ id: 'case-pep-1' });
    
    await service.handleSumsubAmlResult('insp-1', {
      reviewAnswer: 'RED',
      rejectLabels: ['PEP_CLASS_1_DOMESTIC'],
    } as any);
    
    // Customer RESTRICTED (not frozen)
    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          restrictionStatus: 'RESTRICTED',
          restrictionReason: 'pep_review_pending',
          pepStatus: 'CONFIRMED',
        }),
      }),
    );
    // PEP approval case created
    expect(approvalServiceMock.createCase).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'PEP_RELATIONSHIP_APPROVAL',
      }),
      expect.any(Object),
    );
    // Assessment PENDING_SIGNATURE
    expect(prismaMock.clientRiskAssessment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING_SIGNATURE',
          signoffMethod: 'DUAL_MLRO_SENIOR',
          approvalCaseId: 'case-pep-1',
        }),
      }),
    );
  });
  
  it('PATH RED OTHER: creates RISK_RATING_HIGH_APPROVAL single-sign case', async () => {
    setupPendingAssessment();
    approvalServiceMock.createCase.mockResolvedValue({ id: 'case-red-1' });
    
    await service.handleSumsubAmlResult('insp-1', {
      reviewAnswer: 'RED',
      rejectLabels: ['ADVERSE_MEDIA_FRAUD'],
    } as any);
    
    expect(approvalServiceMock.createCase).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'RISK_RATING_HIGH_APPROVAL',
      }),
      expect.any(Object),
    );
  });
});
```

- [ ] **Step 2: Run (should fail)**

```bash
npm test -- src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts --runInBand
```

**Expected**: FAIL — `handleSumsubAmlResult` not implemented.

- [ ] **Step 3: Implement handleSumsubAmlResult**

Add to `client-risk-assessment.service.ts`:

```typescript
  /**
   * Receives applicantReviewed webhook result — looks up pending assessment
   * by inspectionId, applies policy, routes signoff.
   */
  async handleSumsubAmlResult(
    inspectionId: string,
    reviewResult: {
      reviewAnswer: 'GREEN' | 'RED';
      rejectLabels?: string[];
      reviewRejectType?: string;
    },
  ): Promise<void> {
    const assessment = await this.prisma.clientRiskAssessment.findFirst({
      where: {
        sumsubAmlCheckInspectionId: inspectionId,
        status: 'PENDING_SUMSUB_RESULT',
      },
    });
    
    // If inspectionId not set, find by customer's latest pending assessment
    const pending = assessment || await this.prisma.clientRiskAssessment.findFirst({
      where: { status: 'PENDING_SUMSUB_RESULT' },
      orderBy: { triggeredAt: 'desc' },
    });
    
    if (!pending) {
      console.warn(`No pending assessment for inspection ${inspectionId}`);
      return;
    }
    
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: pending.customerId },
    });
    if (!customer) {
      throw new Error(`Customer ${pending.customerId} not found`);
    }
    
    // Save Sumsub result fields
    await this.prisma.clientRiskAssessment.update({
      where: { id: pending.id },
      data: {
        sumsubAmlCheckInspectionId: inspectionId,
        sumsubAmlReviewAnswer: reviewResult.reviewAnswer,
        sumsubAmlLabels: JSON.stringify(reviewResult.rejectLabels || []),
        sumsubAmlRejectType: reviewResult.reviewRejectType,
      },
    });
    
    // For GREEN: fetch full snapshot
    // For RED: check sanctions path first (no snapshot needed)
    if (reviewResult.reviewAnswer === 'RED' && 
        (reviewResult.rejectLabels || []).some(l => l.startsWith('SANCTIONS_'))) {
      await this.handleSanctionsPath(pending, customer, reviewResult.rejectLabels || []);
      return;
    }
    
    // Other paths — fetch snapshot
    const snapshot = customer.sumsubApplicantId
      ? await this.sumsubClient.getApplicant(customer.sumsubApplicantId)
      : { info: {}, tags: [], totalScore: null };
    
    const holdings = await this.prisma.customerMaterialHolding.findMany({
      where: { customerId: customer.id },
    });
    
    const policyInput: PolicyInput = {
      amlAnswer: reviewResult.reviewAnswer,
      amlLabels: reviewResult.rejectLabels || [],
      holdings,
      previousTier: customer.riskTier as any,
      previousPepStatus: customer.pepStatus as any,
    };
    
    const policy = this.policyLoader.getPolicy();
    const policyOutput = applyPolicy(policyInput, policy);
    
    // Save policy output to assessment
    await this.prisma.clientRiskAssessment.update({
      where: { id: pending.id },
      data: {
        sumsubSnapshotAt: new Date(),
        sumsubRiskScore: (snapshot as any).totalScore || null,
        sumsubTags: JSON.stringify((snapshot as any).tags || []),
        resultingRiskTier: policyOutput.resultingTier,
        scoreSuggestedTier: policyOutput.scoreSuggestedTier,
        recommendedAction: policyOutput.recommendedAction,
        reasoning: JSON.stringify(policyOutput.reasoning),
        signoffMethod: policyOutput.signoffMethod,
      },
    });
    
    // Route signoff
    await this.routeSignoff(pending, customer, policyOutput);
  }
  
  private async handleSanctionsPath(
    assessment: any,
    customer: any,
    labels: string[],
  ): Promise<void> {
    // Freeze customer immediately
    await this.prisma.customerMain.update({
      where: { id: customer.id },
      data: {
        complianceHoldStatus: 'FROZEN',
        complianceHoldReason: 'sanctions_hit_pending_investigation',
      },
    });
    
    // Mark assessment ESCALATED_TO_SUMSUB
    await this.prisma.clientRiskAssessment.update({
      where: { id: assessment.id },
      data: {
        status: 'ESCALATED_TO_SUMSUB',
        resultingRiskTier: 'HIGH',
        recommendedAction: 'ESCALATE_TO_SUMSUB_CASE',
        signoffMethod: 'ESCALATED',
        reasoning: JSON.stringify({
          ruleId: 'P1_labels_contains_SANCTIONS',
          labels,
        }),
      },
    });
  }
  
  private async routeSignoff(
    assessment: any,
    customer: any,
    policyOutput: any,
  ): Promise<void> {
    const policy = this.policyLoader.getPolicy();
    
    switch (policyOutput.signoffMethod) {
      case 'AUTO_R2':
        await this.prisma.clientRiskAssessment.update({
          where: { id: assessment.id },
          data: {
            status: 'SIGNED',
            signedBy: 'SYSTEM',
            signedAt: new Date(),
            signedUnderPolicyVersion: policy.version,
          },
        });
        await this.postSignoffCascade(assessment.id);
        return;
      
      case 'DUAL_MLRO_SENIOR':
      case 'MANUAL_MLRO':
      case 'MANUAL_COMPLIANCE_OFFICER': {
        const actionType = policy.signoffActionTypeMap[policyOutput.signoffMethod];
        
        // PEP path: apply immediate effect (RESTRICT)
        if (policyOutput.immediateEffect === 'RESTRICT') {
          await this.prisma.customerMain.update({
            where: { id: customer.id },
            data: {
              restrictionStatus: 'RESTRICTED',
              restrictionReason: 'pep_review_pending',
              pepStatus: 'CONFIRMED',
              pepConfirmedAt: new Date(),
            },
          });
        }
        
        const approvalCase = await this.approvalsService.createCase(
          {
            actionType,
            entityRef: `client_risk_assessment:${assessment.id}`,
            metadata: {
              assessmentId: assessment.id,
              resultingTier: policyOutput.resultingTier,
              reasoning: policyOutput.reasoning,
            },
            traceId: assessment.traceId,
          } as any,
          { actorType: 'ADMIN', userId: 'SYSTEM', roleCodes: ['SUPER_ADMIN'] } as any,
        );
        
        await this.prisma.clientRiskAssessment.update({
          where: { id: assessment.id },
          data: {
            status: 'PENDING_SIGNATURE',
            approvalCaseId: approvalCase.id,
          },
        });
        return;
      }
    }
  }
  
  /**
   * Placeholder — implemented fully in Task 3.6
   */
  async postSignoffCascade(assessmentId: string): Promise<void> {
    // TODO: implement in Task 3.6
  }
```

**Note**: The `ApprovalsService.createCase` signature might differ from what I've written — check `approvals.service.ts` around line 686 for the actual `createDraftCase` signature and adjust. The test mock expects `createCase` method, so either:
- Expose a public `createCase` method on ApprovalsService that wraps `createDraftCase`
- Or change the mock and implementation to use `create()` / `createDraftCase()` directly.

- [ ] **Step 4: Run tests**

```bash
npm test -- src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts --runInBand
```

**Expected**: All 4 path tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/client-risk-assessment/
git commit -m "feat(client-risk-assessment): handleSumsubAmlResult with 4 paths (GREEN/SANCTIONS/PEP/OTHER)"
```

### Task 3.6: postSignoffCascade + handleSignoffComplete

**Files:**
- Modify: `Exchange_js/src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts`
- Modify: `Exchange_js/src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts`

- [ ] **Step 1: Write failing test for postSignoffCascade**

Add to the spec file:

```typescript
describe('postSignoffCascade', () => {
  it('updates customer.riskTier and calls Layer 3 recompute on tier change', async () => {
    const materialRefreshServiceMock = {
      recomputeHoldingsForCustomer: jest.fn().mockResolvedValue([]),
    };
    (service as any).materialRefreshService = materialRefreshServiceMock;
    
    const assessment = {
      id: 'a1',
      customerId: 'c1',
      status: 'SIGNED',
      resultingRiskTier: 'MEDIUM',
      previousRiskTier: 'LOW',
      approvalCaseId: 'case-1',
    };
    prismaMock.clientRiskAssessment.findUnique.mockResolvedValue(assessment);
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      riskTier: 'LOW',
      complianceHoldStatus: 'CLEAR',
      sumsubApplicantId: 'app-1',
      sumsubCurrentLevelName: 'wave3-level-1',
    });
    prismaMock.customerMain.update.mockResolvedValue({});
    
    await service.postSignoffCascade('a1');
    
    // customer.riskTier updated
    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          riskTier: 'MEDIUM',
          latestRiskAssessmentId: 'a1',
          latestRiskApprovalId: 'case-1',
        }),
      }),
    );
    
    // Layer 3 recompute called
    expect(materialRefreshServiceMock.recomputeHoldingsForCustomer)
      .toHaveBeenCalledWith('c1', 'MEDIUM');
  });
  
  it('syncs Sumsub level when tier upgrade requires level 2', async () => {
    const materialRefreshServiceMock = {
      recomputeHoldingsForCustomer: jest.fn().mockResolvedValue([]),
    };
    (service as any).materialRefreshService = materialRefreshServiceMock;
    
    prismaMock.clientRiskAssessment.findUnique.mockResolvedValue({
      id: 'a1',
      customerId: 'c1',
      status: 'SIGNED',
      resultingRiskTier: 'HIGH',
      previousRiskTier: 'LOW',
    });
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      riskTier: 'LOW',
      sumsubCurrentLevelName: 'wave3-level-1',
      sumsubApplicantId: 'app-1',
      complianceHoldStatus: 'CLEAR',
    });
    
    await service.postSignoffCascade('a1');
    
    // Sumsub moveToLevel called
    expect(sumsubClientMock.moveToLevel).toHaveBeenCalledWith(
      'app-1',
      'wave3-level-2',
    );
  });
  
  it('skips level sync when customer is FROZEN', async () => {
    const materialRefreshServiceMock = {
      recomputeHoldingsForCustomer: jest.fn().mockResolvedValue([]),
    };
    (service as any).materialRefreshService = materialRefreshServiceMock;
    
    prismaMock.clientRiskAssessment.findUnique.mockResolvedValue({
      id: 'a1',
      customerId: 'c1',
      status: 'SIGNED',
      resultingRiskTier: 'HIGH',
      previousRiskTier: 'LOW',
    });
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      riskTier: 'LOW',
      sumsubCurrentLevelName: 'wave3-level-1',
      sumsubApplicantId: 'app-1',
      complianceHoldStatus: 'FROZEN',  // frozen!
    });
    
    await service.postSignoffCascade('a1');
    
    // moveToLevel should NOT be called (frozen → skip)
    expect(sumsubClientMock.moveToLevel).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run (failing)**

```bash
npm test -- src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts -t "postSignoffCascade" --runInBand
```

**Expected**: FAIL.

- [ ] **Step 3: Implement postSignoffCascade (replace placeholder)**

In `client-risk-assessment.service.ts`, replace the placeholder `postSignoffCascade` with:

```typescript
  async postSignoffCascade(assessmentId: string): Promise<void> {
    const assessment = await this.prisma.clientRiskAssessment.findUnique({
      where: { id: assessmentId },
    });
    if (!assessment) return;
    
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: assessment.customerId },
    });
    if (!customer) return;
    
    const policy = this.policyLoader.getPolicy();
    const tierChanged = assessment.resultingRiskTier !== customer.riskTier;
    
    // 1. Update customer tier + pointers
    const updateData: any = {
      latestRiskAssessmentId: assessment.id,
      latestRiskApprovalId: assessment.approvalCaseId,
      latestRiskApprovalStatus: 'APPROVED',
    };
    
    if (tierChanged) {
      updateData.riskTier = assessment.resultingRiskTier;
      updateData.riskTierUpdatedAt = new Date();
    }
    
    // Unlock PEP restriction after sign
    if (customer.restrictionReason === 'pep_review_pending') {
      updateData.restrictionStatus = 'CLEAR';
      updateData.restrictionReason = null;
    }
    
    await this.prisma.customerMain.update({
      where: { id: customer.id },
      data: updateData,
    });
    
    // 2. Sync Sumsub level (skip if frozen)
    if (customer.complianceHoldStatus !== 'FROZEN') {
      const allowedLevels = policy.tierLevelConstraint[assessment.resultingRiskTier] || [];
      if (
        customer.sumsubApplicantId && 
        allowedLevels.length > 0 &&
        !allowedLevels.includes(customer.sumsubCurrentLevelName || '')
      ) {
        try {
          await this.sumsubClient.moveToLevel(
            customer.sumsubApplicantId,
            allowedLevels[0],
          );
          await this.prisma.customerMain.update({
            where: { id: customer.id },
            data: {
              sumsubCurrentLevelName: allowedLevels[0],
              sumsubExperiencedLevel2: allowedLevels[0] === 'wave3-level-2' 
                ? true 
                : customer.sumsubExperiencedLevel2,
            },
          });
        } catch (err) {
          console.error(`Sumsub moveToLevel failed for customer ${customer.id}:`, err);
        }
      }
    }
    
    // 3. Trigger Layer 3 recompute (via injected service)
    if (tierChanged && (this as any).materialRefreshService) {
      try {
        await (this as any).materialRefreshService.recomputeHoldingsForCustomer(
          customer.id,
          assessment.resultingRiskTier,
        );
      } catch (err) {
        console.error(`Layer 3 recompute failed for customer ${customer.id}:`, err);
      }
    }
    
    // 4. Audit log
    // (handled elsewhere via event emission or direct call)
  }
```

**注意**: `materialRefreshService` 是通过 property 注入而非构造函数依赖，目的是解决 Layer 2 ↔ Layer 3 的 circular dependency。Phase 4 会在 `MaterialRefreshService` 里同样用 property 注入方式引用 `ClientRiskAssessmentService`。

- [ ] **Step 4: Run tests**

```bash
npm test -- src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts --runInBand
```

**Expected**: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/client-risk-assessment/
git commit -m "feat(client-risk-assessment): postSignoffCascade with tier sync + level sync + Layer 3 trigger"
```

### Task 3.7: recordAssessmentFromKnownAmlResult (for onboarding)

**Files:**
- Modify: `Exchange_js/src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts`

- [ ] **Step 1: Write failing test**

Add to spec:

```typescript
describe('recordAssessmentFromKnownAmlResult', () => {
  it('creates assessment and runs policy without calling /aml/check', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      sumsubApplicantId: 'app-1',
      riskTier: 'LOW',
      pepStatus: 'NONE',
      sumsubCurrentLevelName: 'wave3-level-1',
      complianceHoldStatus: 'CLEAR',
    });
    prismaMock.clientRiskAssessment.create.mockResolvedValue({
      id: 'a1',
      status: 'PENDING_SUMSUB_RESULT',
    });
    prismaMock.clientRiskAssessment.findFirst.mockResolvedValue({
      id: 'a1',
      customerId: 'c1',
      previousRiskTier: 'LOW',
      policyVersion: '1.0.0',
      traceId: 't1',
      status: 'PENDING_SUMSUB_RESULT',
    });
    
    await service.recordAssessmentFromKnownAmlResult({
      customerId: 'c1',
      triggerType: 'INITIAL_ONBOARDING',
      knownAmlResult: { reviewAnswer: 'GREEN', rejectLabels: [] } as any,
      snapshot: { info: {}, totalScore: null, tags: [] },
    });
    
    // sumsub runAmlCheck NOT called
    expect(sumsubClientMock.runAmlCheck).not.toHaveBeenCalled();
    
    // Assessment created
    expect(prismaMock.clientRiskAssessment.create).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement method**

Add to `client-risk-assessment.service.ts`:

```typescript
  /**
   * For onboarding completion: uses already-known AML result, skips /aml/check
   */
  async recordAssessmentFromKnownAmlResult(input: {
    customerId: string;
    triggerType: 'INITIAL_ONBOARDING';
    knownAmlResult: {
      reviewAnswer: 'GREEN' | 'RED';
      rejectLabels?: string[];
    };
    snapshot: any;
  }): Promise<any> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: input.customerId },
    });
    if (!customer) {
      throw new Error(`Customer ${input.customerId} not found`);
    }
    
    const policy = this.policyLoader.getPolicy();
    const assessmentNo = await this.generateAssessmentNo();
    const traceId = `CLIENT_RISK_ASSESSMENT:${randomUUID()}`;
    
    // Create assessment
    const assessment = await this.prisma.clientRiskAssessment.create({
      data: {
        assessmentNo,
        customerId: input.customerId,
        triggerType: input.triggerType,
        policyVersion: policy.version,
        previousRiskTier: customer.riskTier,
        status: 'PENDING_SUMSUB_RESULT',
        traceId,
        sumsubSnapshotAt: new Date(),
      },
    });
    
    // Directly invoke handleSumsubAmlResult internal path (using fake inspectionId)
    // Or call the same logic as handleSumsubAmlResult but with the known data
    await this.prisma.clientRiskAssessment.update({
      where: { id: assessment.id },
      data: {
        sumsubAmlReviewAnswer: input.knownAmlResult.reviewAnswer,
        sumsubAmlLabels: JSON.stringify(input.knownAmlResult.rejectLabels || []),
      },
    });
    
    // Reuse the policy+routing logic from handleSumsubAmlResult
    // For sanctions path:
    if (
      input.knownAmlResult.reviewAnswer === 'RED' &&
      (input.knownAmlResult.rejectLabels || []).some(l => l.startsWith('SANCTIONS_'))
    ) {
      await this.handleSanctionsPath(
        assessment, 
        customer, 
        input.knownAmlResult.rejectLabels || [],
      );
      return assessment;
    }
    
    // Other paths
    const holdings = await this.prisma.customerMaterialHolding.findMany({
      where: { customerId: customer.id },
    });
    
    const policyOutput = applyPolicy(
      {
        amlAnswer: input.knownAmlResult.reviewAnswer,
        amlLabels: input.knownAmlResult.rejectLabels || [],
        holdings,
        previousTier: customer.riskTier as any,
        previousPepStatus: customer.pepStatus as any,
      },
      policy,
    );
    
    await this.prisma.clientRiskAssessment.update({
      where: { id: assessment.id },
      data: {
        sumsubRiskScore: input.snapshot.totalScore || null,
        sumsubTags: JSON.stringify(input.snapshot.tags || []),
        resultingRiskTier: policyOutput.resultingTier,
        recommendedAction: policyOutput.recommendedAction,
        reasoning: JSON.stringify(policyOutput.reasoning),
        signoffMethod: policyOutput.signoffMethod,
      },
    });
    
    await this.routeSignoff(assessment, customer, policyOutput);
    
    return assessment;
  }
```

- [ ] **Step 3: Run tests**

```bash
npm test -- src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts --runInBand
```

**Expected**: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/identity/client-risk-assessment/
git commit -m "feat(client-risk-assessment): recordAssessmentFromKnownAmlResult for onboarding"
```

### Task 3.8: ClientRiskAssessmentCronService — quarterly cron

**Files:**
- Create: `Exchange_js/src/modules/identity/client-risk-assessment/client-risk-assessment-cron.service.ts`
- Create: `Exchange_js/src/modules/identity/client-risk-assessment/client-risk-assessment-cron.service.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { ClientRiskAssessmentCronService } from './client-risk-assessment-cron.service';

describe('ClientRiskAssessmentCronService', () => {
  let cronService: ClientRiskAssessmentCronService;
  let prismaMock: any;
  let assessmentServiceMock: any;
  
  beforeEach(() => {
    prismaMock = {
      customerMain: {
        findMany: jest.fn(),
      },
    };
    assessmentServiceMock = {
      startAssessment: jest.fn(),
    };
    cronService = new ClientRiskAssessmentCronService(
      prismaMock,
      assessmentServiceMock,
    );
  });
  
  it('selects customers whose last assessment > 90 days ago', async () => {
    const ninetyDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    prismaMock.customerMain.findMany.mockResolvedValue([
      { id: 'c1', latestRiskAssessmentAt: ninetyDaysAgo, riskTier: 'LOW' },
      { id: 'c2', latestRiskAssessmentAt: null, riskTier: 'LOW' },
    ]);
    
    await cronService.runQuarterlyAssessment();
    
    expect(assessmentServiceMock.startAssessment).toHaveBeenCalledTimes(2);
    expect(assessmentServiceMock.startAssessment).toHaveBeenCalledWith({
      customerId: 'c1',
      triggerType: 'SCHEDULED_QUARTERLY',
    });
  });
  
  it('does not re-trigger for customers with recent assessment', async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    prismaMock.customerMain.findMany.mockResolvedValue([
      { id: 'c1', latestRiskAssessmentAt: tenDaysAgo, riskTier: 'LOW' },
    ]);
    // findMany 应该只返回 past-due 客户 — mock 返回空
    prismaMock.customerMain.findMany.mockResolvedValue([]);
    
    await cronService.runQuarterlyAssessment();
    
    expect(assessmentServiceMock.startAssessment).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement cron service**

Create `client-risk-assessment-cron.service.ts`:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ClientRiskAssessmentService } from './client-risk-assessment.service';
import { ClientRiskAssessmentPolicyLoader } from './policy/policy-loader';

@Injectable()
export class ClientRiskAssessmentCronService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly assessmentService: ClientRiskAssessmentService,
    private readonly policyLoader?: ClientRiskAssessmentPolicyLoader,
  ) {}
  
  /**
   * Runs on the 1st of every month at 03:07 UTC.
   * Selects customers whose last assessment is older than 90 days
   * and triggers a new assessment.
   */
  @Cron('7 3 1 * *')
  async runQuarterlyAssessment(): Promise<void> {
    if (process.env.FF_WAVE3_FIRM_DRIVEN_REVIEW !== 'true') {
      return;
    }
    
    const policy = this.policyLoader?.getPolicy();
    const frequencyDays = policy?.assessmentFrequencyDays.LOW || 90;
    const cutoffDate = new Date(Date.now() - frequencyDays * 24 * 60 * 60 * 1000);
    
    // Find customers with no recent assessment
    const dueCustomers = await this.prisma.customerMain.findMany({
      where: {
        onboardingStatus: 'APPROVED',
        OR: [
          { latestRiskAssessmentId: null },
          {
            riskAssessments: {
              some: {
                status: 'SIGNED',
                signedAt: { lt: cutoffDate },
              },
            },
          },
        ],
      },
      select: { id: true },
      take: 500,  // batch limit
    });
    
    for (const customer of dueCustomers) {
      try {
        await this.assessmentService.startAssessment({
          customerId: customer.id,
          triggerType: 'SCHEDULED_QUARTERLY',
        });
      } catch (err) {
        console.error(`Failed to start quarterly assessment for ${customer.id}:`, err);
      }
      // Small pacing delay to avoid Sumsub rate limit
      await new Promise(r => setTimeout(r, 750));
    }
  }
}
```

- [ ] **Step 3: Run tests**

```bash
npm test -- src/modules/identity/client-risk-assessment/client-risk-assessment-cron.service.spec.ts --runInBand
```

**Expected**: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/identity/client-risk-assessment/client-risk-assessment-cron.service.ts \
        src/modules/identity/client-risk-assessment/client-risk-assessment-cron.service.spec.ts
git commit -m "feat(client-risk-assessment): quarterly cron service"
```

### Task 3.9: 模块注册 + admin 触发 API

**Files:**
- Create: `Exchange_js/src/modules/identity/client-risk-assessment/client-risk-assessment.module.ts`
- Create: `Exchange_js/src/modules/identity/client-risk-assessment/client-risk-assessment.controller.ts`

- [ ] **Step 1: Create module**

```typescript
// client-risk-assessment.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { ClientRiskAssessmentService } from './client-risk-assessment.service';
import { ClientRiskAssessmentCronService } from './client-risk-assessment-cron.service';
import { ClientRiskAssessmentController } from './client-risk-assessment.controller';
import { ClientRiskAssessmentPolicyLoader } from './policy/policy-loader';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';

@Module({
  imports: [
    forwardRef(() => OnboardingModule),  // for SumsubClient
    ApprovalsModule,
  ],
  providers: [
    ClientRiskAssessmentService,
    ClientRiskAssessmentCronService,
    ClientRiskAssessmentPolicyLoader,
  ],
  controllers: [ClientRiskAssessmentController],
  exports: [ClientRiskAssessmentService],
})
export class ClientRiskAssessmentModule {}
```

- [ ] **Step 2: Create admin controller**

```typescript
// client-risk-assessment.controller.ts
import { Controller, Post, Param, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ClientRiskAssessmentService } from './client-risk-assessment.service';
import { AdminAuthGuard } from '../../auth/admin-auth.guard';

@ApiTags('Admin - Client Risk Assessment')
@Controller('admin/compliance/customers/:customerId/risk-assessment')
@UseGuards(AdminAuthGuard)
@ApiBearerAuth()
export class ClientRiskAssessmentController {
  constructor(private readonly service: ClientRiskAssessmentService) {}
  
  @Post('trigger')
  async triggerManual(
    @Param('customerId') customerId: string,
    @Body() body: { reason?: string },
    @Req() req: any,
  ) {
    return this.service.startAssessment({
      customerId,
      triggerType: 'MLRO_MANUAL',
      triggeredBy: req.user?.userId,
      triggeredContext: { reason: body.reason },
    });
  }
}
```

- [ ] **Step 3: Register module in app.module.ts**

Edit `src/app.module.ts`:

```typescript
import { ClientRiskAssessmentModule } from './modules/identity/client-risk-assessment/client-risk-assessment.module';

@Module({
  imports: [
    // ...existing modules...
    ClientRiskAssessmentModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 4: Build + verify**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm run build 2>&1 | tail -30
```

**Expected**: Build 成功。

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/client-risk-assessment/client-risk-assessment.module.ts \
        src/modules/identity/client-risk-assessment/client-risk-assessment.controller.ts \
        src/app.module.ts
git commit -m "feat(client-risk-assessment): module + admin trigger API"
```

**Phase 3 Complete**: 
- Policy loader + pure function with 8 test scenarios
- `startAssessment` with idempotency + AML check trigger
- `handleSumsubAmlResult` with 4 paths (GREEN / RED SANCTIONS / RED PEP / RED OTHER)
- `recordAssessmentFromKnownAmlResult` for onboarding initial
- `postSignoffCascade` with tier sync + Sumsub level sync + Layer 3 trigger
- Quarterly cron with feature flag
- Admin trigger API
- Module registered in app.module
- All tests passing

---

## Phase 4: Layer 3 Material Refresh Implementation

**目标**: 实现 Layer 3 的完整业务逻辑——`material-refresh-policy.json` + MaterialRefreshService + daily cron + customer SDK token API。

### Task 4.1: 创建 `config/material-refresh-policy.json`

**Files:**
- Create: `Exchange_js/config/material-refresh-policy.json`

- [ ] **Step 1: Write the config file**

Create `config/material-refresh-policy.json`:

```json
{
  "version": "1.0.0",
  "effectiveFrom": "2026-04-09",
  "stages": [
    { "daysFromExpiry": -30, "action": "CREATE_CYCLE_NUDGE_ONLY" },
    { "daysFromExpiry": -7, "action": "ESCALATE_URGENT" },
    { "daysFromExpiry": 0, "action": "ENFORCE_RESTRICTION" },
    { "daysFromExpiry": 30, "action": "TERMINATE_CYCLE_OFFBOARD" }
  ],
  "materials": {
    "EMIRATES_ID": {
      "managementMode": "SUMSUB_MANAGED",
      "requiredForTiers": ["LOW", "MEDIUM", "HIGH"],
      "sumsubIdDocSetType": "IDENTITY",
      "sumsubActionLevelName": "wave3-action-id-refresh",
      "enforceRestriction": true
    },
    "PASSPORT": {
      "managementMode": "SUMSUB_MANAGED",
      "requiredForTiers": ["LOW", "MEDIUM", "HIGH"],
      "sumsubIdDocSetType": "IDENTITY",
      "sumsubActionLevelName": "wave3-action-id-refresh",
      "enforceRestriction": true,
      "alternativeOf": "EMIRATES_ID"
    },
    "PROOF_OF_ADDRESS": {
      "managementMode": "SELF_MANAGED",
      "requiredForTiers": ["LOW", "MEDIUM", "HIGH"],
      "sumsubActionLevelName": "wave3-action-poa-refresh",
      "windowDays": { "LOW": 365, "MEDIUM": 270, "HIGH": 180 },
      "initialCollectionWindowDays": { "MEDIUM": 21, "HIGH": 14 },
      "enforceRestriction": true
    },
    "SOURCE_OF_FUNDS": {
      "managementMode": "SELF_MANAGED",
      "requiredForTiers": ["MEDIUM", "HIGH"],
      "sumsubActionLevelName": "wave3-action-sof-refresh",
      "windowDays": { "MEDIUM": 540, "HIGH": 365 },
      "initialCollectionWindowDays": { "MEDIUM": 21, "HIGH": 14 },
      "enforceRestriction": true
    },
    "SOURCE_OF_WEALTH": {
      "managementMode": "SELF_MANAGED",
      "requiredForTiers": ["HIGH"],
      "sumsubActionLevelName": "wave3-action-sow-refresh",
      "windowDays": { "HIGH": 730 },
      "initialCollectionWindowDays": { "HIGH": 14 },
      "enforceRestriction": true
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
git add config/material-refresh-policy.json
git commit -m "feat(config): add material refresh policy v1.0.0"
```

### Task 4.2: Policy loader + pure functions (compute-stage, get-required-materials)

**Files:**
- Create: `Exchange_js/src/modules/identity/material-refresh/policy/material-refresh-policy.ts`
- Create: `Exchange_js/src/modules/identity/material-refresh/policy/compute-stage.ts`
- Create: `Exchange_js/src/modules/identity/material-refresh/policy/compute-stage.spec.ts`
- Create: `Exchange_js/src/modules/identity/material-refresh/policy/get-required-materials.ts`
- Create: `Exchange_js/src/modules/identity/material-refresh/policy/get-required-materials.spec.ts`

- [ ] **Step 1: Write failing tests for computeStage (pure function)**

Create `compute-stage.spec.ts`:

```typescript
import { computeStage } from './compute-stage';

describe('computeStage', () => {
  // Based on policy stages: [-30, -7, 0, 30]
  
  it('returns FRESH when > 30 days before expiry', () => {
    expect(computeStage(60)).toBe('FRESH');
    expect(computeStage(31)).toBe('FRESH');
  });
  
  it('returns NOTIFIED when within 30 days before expiry (T-30)', () => {
    expect(computeStage(30)).toBe('NOTIFIED');
    expect(computeStage(15)).toBe('NOTIFIED');
    expect(computeStage(8)).toBe('NOTIFIED');
  });
  
  it('returns URGENT when within 7 days before expiry (T-7)', () => {
    expect(computeStage(7)).toBe('URGENT');
    expect(computeStage(3)).toBe('URGENT');
    expect(computeStage(1)).toBe('URGENT');
  });
  
  it('returns BLOCKING on or after expiry day', () => {
    expect(computeStage(0)).toBe('BLOCKING');
    expect(computeStage(-1)).toBe('BLOCKING');
    expect(computeStage(-10)).toBe('BLOCKING');
    expect(computeStage(-29)).toBe('BLOCKING');
  });
  
  it('returns GRACE_EXPIRED after T+30 (offboard)', () => {
    expect(computeStage(-30)).toBe('GRACE_EXPIRED');
    expect(computeStage(-100)).toBe('GRACE_EXPIRED');
  });
});
```

- [ ] **Step 2: Implement compute-stage.ts**

```typescript
export type Stage = 'FRESH' | 'NOTIFIED' | 'URGENT' | 'BLOCKING' | 'GRACE_EXPIRED';

/**
 * Pure function — map days from expiry to stage.
 * 
 * Positive days = before expiry
 * Negative days = after expiry
 * 
 * Stage boundaries from material-refresh-policy.json:
 * - FRESH:         daysFromExpiry > 30
 * - NOTIFIED:      7 < daysFromExpiry <= 30     (T-30 era)
 * - URGENT:        0 < daysFromExpiry <= 7      (T-7 era)
 * - BLOCKING:      -30 < daysFromExpiry <= 0    (T-0 to T+30, restrict)
 * - GRACE_EXPIRED: daysFromExpiry <= -30        (T+30, offboard)
 */
export function computeStage(daysFromExpiry: number): Stage {
  if (daysFromExpiry > 30) return 'FRESH';
  if (daysFromExpiry > 7) return 'NOTIFIED';
  if (daysFromExpiry > 0) return 'URGENT';
  if (daysFromExpiry > -30) return 'BLOCKING';
  return 'GRACE_EXPIRED';
}
```

- [ ] **Step 3: Write tests for getRequiredMaterialsForTier**

Create `get-required-materials.spec.ts`:

```typescript
import { getRequiredMaterialsForTier } from './get-required-materials';
import * as fs from 'fs';
import * as path from 'path';

const policy = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), 'config/material-refresh-policy.json'),
    'utf8',
  ),
);

describe('getRequiredMaterialsForTier', () => {
  it('LOW tier requires ID + PoA', () => {
    const materials = getRequiredMaterialsForTier('LOW', policy);
    expect(materials).toContain('EMIRATES_ID');
    expect(materials).toContain('PROOF_OF_ADDRESS');
    expect(materials).not.toContain('SOURCE_OF_FUNDS');
    expect(materials).not.toContain('SOURCE_OF_WEALTH');
  });
  
  it('MEDIUM tier adds SOURCE_OF_FUNDS', () => {
    const materials = getRequiredMaterialsForTier('MEDIUM', policy);
    expect(materials).toContain('EMIRATES_ID');
    expect(materials).toContain('PROOF_OF_ADDRESS');
    expect(materials).toContain('SOURCE_OF_FUNDS');
    expect(materials).not.toContain('SOURCE_OF_WEALTH');
  });
  
  it('HIGH tier adds SOURCE_OF_WEALTH', () => {
    const materials = getRequiredMaterialsForTier('HIGH', policy);
    expect(materials).toContain('SOURCE_OF_WEALTH');
  });
});
```

- [ ] **Step 4: Implement get-required-materials.ts**

```typescript
import { MaterialRefreshPolicy } from './material-refresh-policy';

export function getRequiredMaterialsForTier(
  tier: string,
  policy: MaterialRefreshPolicy,
): string[] {
  const required: string[] = [];
  
  for (const [materialType, config] of Object.entries(policy.materials)) {
    // Skip alternatives to avoid double counting (EID and PASSPORT both satisfy ID)
    if (config.alternativeOf) continue;
    
    if (config.requiredForTiers.includes(tier)) {
      required.push(materialType);
    }
  }
  
  return required;
}
```

- [ ] **Step 5: Implement policy loader**

Create `material-refresh-policy.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface MaterialRefreshPolicy {
  version: string;
  effectiveFrom: string;
  stages: Array<{ daysFromExpiry: number; action: string }>;
  materials: Record<string, MaterialConfig>;
}

export interface MaterialConfig {
  managementMode: 'SUMSUB_MANAGED' | 'SELF_MANAGED';
  requiredForTiers: string[];
  sumsubIdDocSetType?: string;
  sumsubActionLevelName: string;
  windowDays?: Record<string, number>;
  initialCollectionWindowDays?: Record<string, number>;
  enforceRestriction: boolean;
  alternativeOf?: string;
}

@Injectable()
export class MaterialRefreshPolicyLoader {
  private cachedPolicy: MaterialRefreshPolicy | null = null;
  
  getPolicy(): MaterialRefreshPolicy {
    if (this.cachedPolicy) return this.cachedPolicy;
    
    const configPath = path.resolve(process.cwd(), 'config/material-refresh-policy.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    this.cachedPolicy = JSON.parse(raw) as MaterialRefreshPolicy;
    return this.cachedPolicy;
  }
  
  getMaterialConfig(materialType: string): MaterialConfig | null {
    const policy = this.getPolicy();
    return policy.materials[materialType] || null;
  }
  
  reload(): void {
    this.cachedPolicy = null;
  }
}
```

- [ ] **Step 6: Run all policy tests**

```bash
mkdir -p src/modules/identity/material-refresh/policy
# Move the created files into this directory if not already
npm test -- src/modules/identity/material-refresh/policy --runInBand
```

**Expected**: ALL PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/identity/material-refresh/policy/
git commit -m "feat(material-refresh): policy loader + compute-stage + get-required-materials"
```

### Task 4.3: MaterialRefreshService — stage transitions

**Files:**
- Create: `Exchange_js/src/modules/identity/material-refresh/material-refresh.service.ts`
- Create: `Exchange_js/src/modules/identity/material-refresh/material-refresh.service.spec.ts`

- [ ] **Step 1: Write failing tests for enterNotifiedStage**

```typescript
import { MaterialRefreshService } from './material-refresh.service';
import { MaterialRefreshPolicyLoader } from './policy/material-refresh-policy';

describe('MaterialRefreshService', () => {
  let service: MaterialRefreshService;
  let prismaMock: any;
  let sumsubClientMock: any;
  
  beforeEach(() => {
    prismaMock = {
      customerMaterialHolding: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      materialRefreshCycle: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      customerMain: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    sumsubClientMock = {
      createApplicantAction: jest.fn(),
    };
    
    service = new MaterialRefreshService(
      prismaMock,
      sumsubClientMock,
      new MaterialRefreshPolicyLoader(),
      { write: jest.fn() } as any,  // audit
    );
  });
  
  describe('enterNotifiedStage', () => {
    it('creates cycle with NUDGE_ONLY stage and calls Sumsub createApplicantAction', async () => {
      const holding = {
        id: 'h1',
        customerId: 'c1',
        materialType: 'PROOF_OF_ADDRESS',
        expiresAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
        activeRefreshCycleId: null,
      };
      prismaMock.customerMaterialHolding.findUnique.mockResolvedValue(holding);
      prismaMock.customerMain.findUnique.mockResolvedValue({
        id: 'c1',
        sumsubApplicantId: 'app-1',
        riskTier: 'LOW',
      });
      prismaMock.materialRefreshCycle.create.mockResolvedValue({
        id: 'cycle-1',
        cycleNo: 'MRC-2026-00001',
      });
      sumsubClientMock.createApplicantAction.mockResolvedValue({ id: 'action-1' });
      
      await service.enterNotifiedStage('h1');
      
      // Cycle created
      expect(prismaMock.materialRefreshCycle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            holdingId: 'h1',
            status: 'PENDING_CUSTOMER_EVIDENCE',
            stage: 'NUDGE_ONLY',
            triggerType: 'SCHEDULED_EXPIRY',
            materialType: 'PROOF_OF_ADDRESS',
          }),
        }),
      );
      
      // Sumsub called
      expect(sumsubClientMock.createApplicantAction).toHaveBeenCalledWith({
        applicantId: 'app-1',
        levelName: 'wave3-action-poa-refresh',
      });
      
      // Holding updated
      expect(prismaMock.customerMaterialHolding.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            activeRefreshCycleId: 'cycle-1',
            status: 'REFRESH_IN_PROGRESS',
          }),
        }),
      );
    });
    
    it('is idempotent — skips if holding already has active cycle', async () => {
      prismaMock.customerMaterialHolding.findUnique.mockResolvedValue({
        id: 'h1',
        activeRefreshCycleId: 'existing-cycle',
      });
      
      await service.enterNotifiedStage('h1');
      
      expect(prismaMock.materialRefreshCycle.create).not.toHaveBeenCalled();
      expect(sumsubClientMock.createApplicantAction).not.toHaveBeenCalled();
    });
  });
  
  describe('enterBlockingStage', () => {
    it('sets customer RESTRICTED and marks cycle BLOCKING', async () => {
      const holding = {
        id: 'h1',
        customerId: 'c1',
        materialType: 'PROOF_OF_ADDRESS',
        activeRefreshCycleId: 'cycle-1',
      };
      prismaMock.customerMaterialHolding.findUnique.mockResolvedValue(holding);
      prismaMock.materialRefreshCycle.findFirst.mockResolvedValue({
        id: 'cycle-1',
        status: 'PENDING_CUSTOMER_EVIDENCE',
        stage: 'URGENT',
      });
      
      await service.enterBlockingStage('h1');
      
      // Cycle → BLOCKING
      expect(prismaMock.materialRefreshCycle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stage: 'BLOCKING',
          }),
        }),
      );
      
      // Customer RESTRICTED
      expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            restrictionStatus: 'RESTRICTED',
            restrictionReason: 'material_expired:PROOF_OF_ADDRESS',
          }),
        }),
      );
    });
  });
});
```

- [ ] **Step 2: Implement the service**

Create `material-refresh.service.ts`:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import { AuditLogsService } from '../../risk-engine/audit-logs/audit-logs.service';
import { MaterialRefreshPolicyLoader } from './policy/material-refresh-policy';
import { getRequiredMaterialsForTier } from './policy/get-required-materials';
import { addDays } from 'date-fns';

@Injectable()
export class MaterialRefreshService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly sumsubClient: SumsubClient,
    private readonly policyLoader: MaterialRefreshPolicyLoader,
    private readonly auditLogsService: AuditLogsService,
  ) {}
  
  async enterNotifiedStage(holdingId: string): Promise<void> {
    const holding = await this.prisma.customerMaterialHolding.findUnique({
      where: { id: holdingId },
    });
    if (!holding) return;
    
    // Idempotent: skip if already has active cycle
    if (holding.activeRefreshCycleId) return;
    
    const materialConfig = this.policyLoader.getMaterialConfig(holding.materialType);
    if (!materialConfig) return;
    
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: holding.customerId },
    });
    if (!customer?.sumsubApplicantId) return;
    
    // Create cycle
    const cycleNo = await this.generateCycleNo();
    const cycle = await this.prisma.materialRefreshCycle.create({
      data: {
        cycleNo,
        customerId: holding.customerId,
        holdingId: holding.id,
        materialType: holding.materialType,
        status: 'PENDING_CUSTOMER_EVIDENCE',
        stage: 'NUDGE_ONLY',
        triggerType: 'SCHEDULED_EXPIRY',
        stageNudgeAt: new Date(),
        graceExpiresAt: addDays(holding.expiresAt || new Date(), 30),
        traceId: `MATERIAL_REFRESH:${randomUUID()}`,
      },
    });
    
    // Create Sumsub Applicant Action
    try {
      const action = await this.sumsubClient.createApplicantAction({
        applicantId: customer.sumsubApplicantId,
        levelName: materialConfig.sumsubActionLevelName,
      });
      
      await this.prisma.materialRefreshCycle.update({
        where: { id: cycle.id },
        data: {
          sumsubActionId: action.id,
          sumsubActionLevelName: materialConfig.sumsubActionLevelName,
          sumsubActionCreatedAt: new Date(),
        },
      });
    } catch (err) {
      console.error(`Failed to create Sumsub action for cycle ${cycle.id}:`, err);
      // Leave cycle with sumsubActionId=null, stuck cycle cron will alert
    }
    
    // Update holding
    await this.prisma.customerMaterialHolding.update({
      where: { id: holding.id },
      data: {
        activeRefreshCycleId: cycle.id,
        status: 'REFRESH_IN_PROGRESS',
      },
    });
  }
  
  async escalateToUrgent(holdingId: string): Promise<void> {
    const holding = await this.prisma.customerMaterialHolding.findUnique({
      where: { id: holdingId },
    });
    if (!holding?.activeRefreshCycleId) {
      // No existing cycle — fall back to enterNotifiedStage first
      return this.enterNotifiedStage(holdingId);
    }
    
    await this.prisma.materialRefreshCycle.update({
      where: { id: holding.activeRefreshCycleId },
      data: { stage: 'URGENT', stageUrgentAt: new Date() },
    });
  }
  
  async enterBlockingStage(holdingId: string): Promise<void> {
    const holding = await this.prisma.customerMaterialHolding.findUnique({
      where: { id: holdingId },
    });
    if (!holding) return;
    
    // Ensure cycle exists
    if (!holding.activeRefreshCycleId) {
      await this.enterNotifiedStage(holdingId);
      return this.enterBlockingStage(holdingId);
    }
    
    await this.prisma.materialRefreshCycle.update({
      where: { id: holding.activeRefreshCycleId },
      data: { stage: 'BLOCKING', stageBlockingAt: new Date() },
    });
    
    const materialConfig = this.policyLoader.getMaterialConfig(holding.materialType);
    if (materialConfig?.enforceRestriction) {
      await this.prisma.customerMain.update({
        where: { id: holding.customerId },
        data: {
          restrictionStatus: 'RESTRICTED',
          restrictionReason: `material_expired:${holding.materialType}`,
        },
      });
    }
    
    await this.prisma.customerMaterialHolding.update({
      where: { id: holding.id },
      data: { status: 'EXPIRED' },
    });
  }
  
  async terminateCycle(cycleId: string, reason: string): Promise<void> {
    const cycle = await this.prisma.materialRefreshCycle.findFirst({
      where: { id: cycleId, status: 'PENDING_CUSTOMER_EVIDENCE' },
    });
    if (!cycle) return;
    
    await this.prisma.materialRefreshCycle.update({
      where: { id: cycle.id },
      data: {
        status: 'REJECTED',
        rejectedAt: new Date(),
        resolutionReason: reason,
      },
    });
    
    // Offboard customer
    await this.prisma.customerMain.update({
      where: { id: cycle.customerId },
      data: {
        onboardingStatus: 'WITHDRAWN',
        operatingStatus: 'INACTIVE',
      },
    });
    
    // Release holding
    await this.prisma.customerMaterialHolding.updateMany({
      where: { activeRefreshCycleId: cycle.id },
      data: { activeRefreshCycleId: null, status: 'EXPIRED' },
    });
  }
  
  private async generateCycleNo(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.materialRefreshCycle.count({
      where: { cycleNo: { startsWith: `MRC-${year}-` } },
    });
    return `MRC-${year}-${String(count + 1).padStart(5, '0')}`;
  }
}
```

- [ ] **Step 3: Run tests**

```bash
npm test -- src/modules/identity/material-refresh/material-refresh.service.spec.ts --runInBand
```

**Expected**: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/identity/material-refresh/
git commit -m "feat(material-refresh): service with stage transitions + cycle lifecycle"
```

### Task 4.4: handleSumsubActionResult + handleSumsubDocMonitoringFire

**Files:**
- Modify: `Exchange_js/src/modules/identity/material-refresh/material-refresh.service.ts`
- Modify: `Exchange_js/src/modules/identity/material-refresh/material-refresh.service.spec.ts`

- [ ] **Step 1: Write failing test for handleSumsubActionResult GREEN**

Add to spec:

```typescript
describe('handleSumsubActionResult', () => {
  it('GREEN result: cycle CLEARED, holding FRESH, window recalculated', async () => {
    const cycle = {
      id: 'cycle-1',
      holdingId: 'h1',
      sumsubActionId: 'action-1',
      status: 'PENDING_CUSTOMER_EVIDENCE',
    };
    prismaMock.materialRefreshCycle.findFirst.mockResolvedValue(cycle);
    prismaMock.customerMaterialHolding.findUnique.mockResolvedValue({
      id: 'h1',
      customerId: 'c1',
      materialType: 'PROOF_OF_ADDRESS',
      managementMode: 'SELF_MANAGED',
    });
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      riskTier: 'LOW',
      restrictionStatus: 'CLEAR',
      restrictionReason: null,
    });
    
    await service.handleSumsubActionResult({
      actionId: 'action-1',
      reviewResult: { reviewAnswer: 'GREEN' },
    } as any);
    
    // Cycle CLEARED
    expect(prismaMock.materialRefreshCycle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CLEARED',
          clearedAt: expect.any(Date),
        }),
      }),
    );
    
    // Holding refreshed
    expect(prismaMock.customerMaterialHolding.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verifiedAt: expect.any(Date),
          status: 'FRESH',
          activeRefreshCycleId: null,
        }),
      }),
    );
  });
  
  it('GREEN: also releases customer restriction if cycle caused it', async () => {
    prismaMock.materialRefreshCycle.findFirst.mockResolvedValue({
      id: 'cycle-1',
      holdingId: 'h1',
      sumsubActionId: 'action-1',
      status: 'PENDING_CUSTOMER_EVIDENCE',
      stage: 'BLOCKING',
    });
    prismaMock.customerMaterialHolding.findUnique.mockResolvedValue({
      id: 'h1',
      customerId: 'c1',
      materialType: 'PROOF_OF_ADDRESS',
      managementMode: 'SELF_MANAGED',
    });
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      riskTier: 'LOW',
      restrictionStatus: 'RESTRICTED',
      restrictionReason: 'material_expired:PROOF_OF_ADDRESS',
    });
    
    await service.handleSumsubActionResult({
      actionId: 'action-1',
      reviewResult: { reviewAnswer: 'GREEN' },
    } as any);
    
    // customer unrestricted
    expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          restrictionStatus: 'CLEAR',
          restrictionReason: null,
        }),
      }),
    );
  });
  
  it('RED result: cycle stays PENDING, customer can retry', async () => {
    prismaMock.materialRefreshCycle.findFirst.mockResolvedValue({
      id: 'cycle-1',
      status: 'PENDING_CUSTOMER_EVIDENCE',
      stage: 'NUDGE_ONLY',
    });
    
    await service.handleSumsubActionResult({
      actionId: 'action-1',
      reviewResult: { reviewAnswer: 'RED', reviewRejectType: 'RETRY' },
    } as any);
    
    // Cycle NOT updated to CLEARED
    const updateCalls = prismaMock.materialRefreshCycle.update.mock.calls;
    expect(updateCalls.length).toBe(0);  // no status change
  });
});
```

- [ ] **Step 2: Implement handleSumsubActionResult**

Add to `material-refresh.service.ts`:

```typescript
  async handleSumsubActionResult(event: {
    actionId: string;
    reviewResult: {
      reviewAnswer: 'GREEN' | 'RED';
      reviewRejectType?: string;
    };
  }): Promise<void> {
    const cycle = await this.prisma.materialRefreshCycle.findFirst({
      where: {
        sumsubActionId: event.actionId,
        status: 'PENDING_CUSTOMER_EVIDENCE',
      },
    });
    if (!cycle) {
      console.warn(`No pending cycle for actionId ${event.actionId}`);
      return;
    }
    
    if (event.reviewResult.reviewAnswer === 'RED') {
      // Leave cycle PENDING — customer can retry
      return;
    }
    
    // GREEN — clear cycle and refresh holding
    const holding = await this.prisma.customerMaterialHolding.findUnique({
      where: { id: cycle.holdingId },
    });
    if (!holding) return;
    
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: holding.customerId },
    });
    if (!customer) return;
    
    const materialConfig = this.policyLoader.getMaterialConfig(holding.materialType);
    
    // Compute new expiresAt
    let newExpiresAt: Date | null = null;
    if (holding.managementMode === 'SUMSUB_MANAGED' && customer.sumsubApplicantId) {
      // For ID docs, pull fresh validUntil from Sumsub snapshot
      const snapshot = await this.sumsubClient.getApplicant(customer.sumsubApplicantId);
      const idDoc = (snapshot as any).info?.idDocs?.find(
        (d: any) => this.mapSumsubDocToMaterialType(d) === holding.materialType,
      );
      if (idDoc?.validUntil) {
        newExpiresAt = new Date(idDoc.validUntil);
      }
    } else if (holding.managementMode === 'SELF_MANAGED' && materialConfig?.windowDays) {
      const days = materialConfig.windowDays[customer.riskTier as string];
      if (days) {
        newExpiresAt = addDays(new Date(), days);
      }
    }
    
    // Refresh holding
    await this.prisma.customerMaterialHolding.update({
      where: { id: holding.id },
      data: {
        verifiedAt: new Date(),
        expiresAt: newExpiresAt,
        status: 'FRESH',
        activeRefreshCycleId: null,
      },
    });
    
    // Close cycle
    await this.prisma.materialRefreshCycle.update({
      where: { id: cycle.id },
      data: {
        status: 'CLEARED',
        clearedAt: new Date(),
        resolutionReason: 'customer_refreshed',
      },
    });
    
    // Release restriction if this cycle caused it
    const restrictionReason = `material_expired:${holding.materialType}`;
    if (
      customer.restrictionStatus === 'RESTRICTED' &&
      customer.restrictionReason === restrictionReason
    ) {
      await this.prisma.customerMain.update({
        where: { id: customer.id },
        data: {
          restrictionStatus: 'CLEAR',
          restrictionReason: null,
        },
      });
    }
  }
  
  async handleSumsubDocMonitoringFire(event: any): Promise<void> {
    // Sumsub Ongoing Doc Monitoring fired — fallback path
    // 1. Find customer by applicantId
    // 2. Read current idDoc validity from Sumsub snapshot
    // 3. Find matching holding
    // 4. If no active cycle, enter BLOCKING stage immediately (this is T-0)
    
    const customer = await this.prisma.customerMain.findFirst({
      where: { sumsubApplicantId: event.applicantId },
    });
    if (!customer) return;
    
    const snapshot = await this.sumsubClient.getApplicant(customer.sumsubApplicantId!);
    const expiredDocs = ((snapshot as any).info?.idDocs || []).filter(
      (d: any) => d.validUntil && new Date(d.validUntil) <= new Date(),
    );
    
    for (const idDoc of expiredDocs) {
      const materialType = this.mapSumsubDocToMaterialType(idDoc);
      if (!materialType) continue;
      
      const holding = await this.prisma.customerMaterialHolding.findUnique({
        where: {
          customerId_materialType: {
            customerId: customer.id,
            materialType,
          },
        },
      });
      if (!holding) continue;
      
      if (holding.activeRefreshCycleId) {
        // Already handled by our cron — skip
        continue;
      }
      
      // Fallback path — enter BLOCKING immediately
      await this.enterBlockingStage(holding.id);
    }
  }
  
  private mapSumsubDocToMaterialType(idDoc: any): string | null {
    if (idDoc.idDocType === 'ID_CARD' && idDoc.country === 'ARE') return 'EMIRATES_ID';
    if (idDoc.idDocType === 'PASSPORT') return 'PASSPORT';
    return null;
  }
```

- [ ] **Step 3: Run tests**

```bash
npm test -- src/modules/identity/material-refresh/material-refresh.service.spec.ts --runInBand
```

**Expected**: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/identity/material-refresh/
git commit -m "feat(material-refresh): handleSumsubActionResult + handleSumsubDocMonitoringFire"
```

### Task 4.5: recomputeHoldingsForCustomer (Layer 2 → Layer 3 cascade)

**Files:**
- Modify: `Exchange_js/src/modules/identity/material-refresh/material-refresh.service.ts`
- Modify: `Exchange_js/src/modules/identity/material-refresh/material-refresh.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Add to spec:

```typescript
describe('recomputeHoldingsForCustomer', () => {
  it('recomputes expiresAt for SELF_MANAGED holdings on tier upgrade', async () => {
    prismaMock.customerMaterialHolding.findMany.mockResolvedValue([
      {
        id: 'h1',
        customerId: 'c1',
        materialType: 'PROOF_OF_ADDRESS',
        managementMode: 'SELF_MANAGED',
        verifiedAt: new Date('2026-01-01'),
        expiresAt: new Date('2026-12-31'),  // LOW window 365d
      },
    ]);
    
    await service.recomputeHoldingsForCustomer('c1', 'HIGH');
    
    // HIGH window = 180d, so expiresAt should be shorter
    expect(prismaMock.customerMaterialHolding.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          expiresAt: expect.any(Date),
        }),
      }),
    );
  });
  
  it('creates INITIAL_COLLECTION cycle when new tier requires missing material', async () => {
    prismaMock.customerMaterialHolding.findMany.mockResolvedValue([
      { id: 'h1', customerId: 'c1', materialType: 'PROOF_OF_ADDRESS', managementMode: 'SELF_MANAGED', 
        verifiedAt: new Date(), expiresAt: new Date() },
      // No SOURCE_OF_FUNDS or SOURCE_OF_WEALTH
    ]);
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      sumsubApplicantId: 'app-1',
      riskTier: 'HIGH',
    });
    prismaMock.customerMaterialHolding.create = jest.fn().mockResolvedValue({
      id: 'new-holding',
    });
    prismaMock.materialRefreshCycle.create.mockResolvedValue({
      id: 'initial-cycle',
    });
    sumsubClientMock.createApplicantAction.mockResolvedValue({ id: 'action-1' });
    
    await service.recomputeHoldingsForCustomer('c1', 'HIGH');
    
    // SoF and SoW holdings should be created
    expect(prismaMock.customerMaterialHolding.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          materialType: 'SOURCE_OF_FUNDS',
          status: 'MISSING',
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Implement**

Add to `material-refresh.service.ts`:

```typescript
  async recomputeHoldingsForCustomer(
    customerId: string,
    newRiskTier: string,
  ): Promise<any[]> {
    const holdings = await this.prisma.customerMaterialHolding.findMany({
      where: { customerId },
    });
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
    });
    if (!customer) return [];
    
    const policy = this.policyLoader.getPolicy();
    const createdCycles: any[] = [];
    
    // 1. Recompute expiresAt for SELF_MANAGED holdings
    for (const holding of holdings) {
      if (holding.managementMode !== 'SELF_MANAGED') continue;
      
      const materialConfig = policy.materials[holding.materialType];
      if (!materialConfig?.windowDays) continue;
      
      const newWindow = materialConfig.windowDays[newRiskTier];
      if (!newWindow) continue;  // tier doesn't require this material
      
      const newExpiresAt = addDays(holding.verifiedAt, newWindow);
      
      if (!holding.expiresAt || newExpiresAt.getTime() !== holding.expiresAt.getTime()) {
        await this.prisma.customerMaterialHolding.update({
          where: { id: holding.id },
          data: { expiresAt: newExpiresAt },
        });
      }
    }
    
    // 2. Check for missing required materials
    const requiredMaterials = getRequiredMaterialsForTier(newRiskTier, policy);
    const existingTypes = new Set(holdings.map(h => h.materialType));
    // Also satisfy alternatives (EID satisfies ID requirement even if PASSPORT is required)
    for (const holding of holdings) {
      const mat = policy.materials[holding.materialType];
      if (mat?.alternativeOf) existingTypes.add(mat.alternativeOf);
    }
    
    for (const materialType of requiredMaterials) {
      if (existingTypes.has(materialType)) continue;
      
      // Create missing holding in MISSING state
      const newHolding = await this.prisma.customerMaterialHolding.create({
        data: {
          customerId,
          materialType,
          managementMode: policy.materials[materialType].managementMode,
          verifiedAt: new Date(),
          expiresAt: null,
          status: 'MISSING',
        },
      });
      
      // Create initial collection cycle
      const materialConfig = policy.materials[materialType];
      const initialWindow = materialConfig.initialCollectionWindowDays?.[newRiskTier] || 14;
      
      if (!customer.sumsubApplicantId) continue;
      
      const cycleNo = await this.generateCycleNo();
      const cycle = await this.prisma.materialRefreshCycle.create({
        data: {
          cycleNo,
          customerId,
          holdingId: newHolding.id,
          materialType,
          status: 'PENDING_CUSTOMER_EVIDENCE',
          stage: 'NUDGE_ONLY',
          triggerType: 'INITIAL_COLLECTION',
          stageNudgeAt: new Date(),
          graceExpiresAt: addDays(new Date(), initialWindow),
          traceId: `MATERIAL_REFRESH:${randomUUID()}`,
        },
      });
      
      try {
        const action = await this.sumsubClient.createApplicantAction({
          applicantId: customer.sumsubApplicantId,
          levelName: materialConfig.sumsubActionLevelName,
        });
        await this.prisma.materialRefreshCycle.update({
          where: { id: cycle.id },
          data: {
            sumsubActionId: action.id,
            sumsubActionLevelName: materialConfig.sumsubActionLevelName,
            sumsubActionCreatedAt: new Date(),
          },
        });
      } catch (err) {
        console.error(`Failed to create Sumsub action for initial cycle ${cycle.id}:`, err);
      }
      
      await this.prisma.customerMaterialHolding.update({
        where: { id: newHolding.id },
        data: {
          activeRefreshCycleId: cycle.id,
          status: 'REFRESH_IN_PROGRESS',
        },
      });
      
      createdCycles.push(cycle);
    }
    
    return createdCycles;
  }
```

- [ ] **Step 3: Run tests**

```bash
npm test -- src/modules/identity/material-refresh/material-refresh.service.spec.ts --runInBand
```

**Expected**: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/identity/material-refresh/
git commit -m "feat(material-refresh): recomputeHoldingsForCustomer cascade for tier upgrade"
```

### Task 4.6: MaterialFreshnessCronService — daily cron

**Files:**
- Create: `Exchange_js/src/modules/identity/material-refresh/material-freshness-cron.service.ts`
- Create: `Exchange_js/src/modules/identity/material-refresh/material-freshness-cron.service.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { MaterialFreshnessCronService } from './material-freshness-cron.service';
import { computeStage } from './policy/compute-stage';

describe('MaterialFreshnessCronService', () => {
  let cron: MaterialFreshnessCronService;
  let prismaMock: any;
  let serviceMock: any;
  let sumsubClientMock: any;
  
  beforeEach(() => {
    prismaMock = {
      customerMain: { findMany: jest.fn() },
      customerMaterialHolding: { 
        findMany: jest.fn(),
        update: jest.fn(),
      },
      materialRefreshCycle: {
        findMany: jest.fn(),
      },
    };
    serviceMock = {
      enterNotifiedStage: jest.fn(),
      escalateToUrgent: jest.fn(),
      enterBlockingStage: jest.fn(),
      terminateCycle: jest.fn(),
    };
    sumsubClientMock = {
      getApplicant: jest.fn(),
    };
    cron = new MaterialFreshnessCronService(
      prismaMock,
      serviceMock,
      sumsubClientMock,
    );
  });
  
  it('dispatches enterNotifiedStage when holding enters NOTIFIED stage', async () => {
    // holding expires in 20 days → NOTIFIED stage
    const twentyDaysOut = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    
    prismaMock.customerMain.findMany.mockResolvedValue([]);  // no Sumsub sync
    prismaMock.customerMaterialHolding.findMany.mockResolvedValue([
      {
        id: 'h1',
        customerId: 'c1',
        materialType: 'PROOF_OF_ADDRESS',
        status: 'FRESH',
        expiresAt: twentyDaysOut,
        activeRefreshCycleId: null,
      },
    ]);
    prismaMock.materialRefreshCycle.findMany.mockResolvedValue([]);
    
    await cron.runDailyCheck();
    
    expect(serviceMock.enterNotifiedStage).toHaveBeenCalledWith('h1');
  });
  
  it('dispatches terminateCycle for cycles past grace period', async () => {
    prismaMock.customerMain.findMany.mockResolvedValue([]);
    prismaMock.customerMaterialHolding.findMany.mockResolvedValue([]);
    prismaMock.materialRefreshCycle.findMany.mockResolvedValue([
      {
        id: 'cycle-1',
        status: 'PENDING_CUSTOMER_EVIDENCE',
        graceExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),  // expired yesterday
      },
    ]);
    
    await cron.runDailyCheck();
    
    expect(serviceMock.terminateCycle).toHaveBeenCalledWith('cycle-1', 'grace_expired');
  });
});
```

- [ ] **Step 2: Implement**

```typescript
// material-freshness-cron.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { MaterialRefreshService } from './material-refresh.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import { computeStage } from './policy/compute-stage';

@Injectable()
export class MaterialFreshnessCronService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly materialRefreshService: MaterialRefreshService,
    private readonly sumsubClient: SumsubClient,
  ) {}
  
  @Cron('0 2 * * *')  // Daily 02:00 UTC
  async runDailyCheck(): Promise<void> {
    if (process.env.FF_WAVE3_FIRM_DRIVEN_REVIEW !== 'true') {
      return;
    }
    
    console.log('[MaterialFreshnessCron] Daily check starting');
    
    // Step 1: Sync Sumsub-managed holdings validUntil
    await this.syncSumsubManagedExpiry();
    
    // Step 2: Scan holdings and dispatch stage transitions
    await this.scanHoldingsForStageTransitions();
    
    // Step 3: Scan grace-expired cycles
    await this.scanGraceExpiredCycles();
    
    // Step 4: Scan stuck cycles (no sumsub action)
    await this.scanStuckCycles();
    
    console.log('[MaterialFreshnessCron] Daily check complete');
  }
  
  private async syncSumsubManagedExpiry(): Promise<void> {
    const customers = await this.prisma.customerMain.findMany({
      where: {
        onboardingStatus: 'APPROVED',
        sumsubApplicantId: { not: null },
      },
      select: {
        id: true,
        sumsubApplicantId: true,
      },
      take: 500,
    });
    
    for (const customer of customers) {
      try {
        const applicant = await this.sumsubClient.getApplicant(customer.sumsubApplicantId!);
        const idDocs = (applicant as any).info?.idDocs || [];
        
        for (const idDoc of idDocs) {
          const materialType = this.mapSumsubDocToMaterialType(idDoc);
          if (!materialType) continue;
          
          const holding = await this.prisma.customerMaterialHolding.findUnique({
            where: {
              customerId_materialType: {
                customerId: customer.id,
                materialType,
              },
            },
          });
          if (!holding) continue;
          
          const newExpiresAt = idDoc.validUntil ? new Date(idDoc.validUntil) : null;
          if (
            newExpiresAt &&
            holding.expiresAt?.getTime() !== newExpiresAt.getTime()
          ) {
            await this.prisma.customerMaterialHolding.update({
              where: { id: holding.id },
              data: { expiresAt: newExpiresAt },
            });
          }
        }
      } catch (err) {
        console.error(`Failed to sync Sumsub for customer ${customer.id}:`, err);
      }
      await new Promise(r => setTimeout(r, 500));  // rate limit pacing
    }
  }
  
  private async scanHoldingsForStageTransitions(): Promise<void> {
    const holdings = await this.prisma.customerMaterialHolding.findMany({
      where: {
        status: { in: ['FRESH', 'NOTIFIED', 'URGENT', 'BLOCKING'] },
        expiresAt: { not: null },
      },
      take: 5000,
    });
    
    const now = Date.now();
    
    for (const holding of holdings) {
      if (!holding.expiresAt) continue;
      
      const daysFromExpiry = Math.floor(
        (holding.expiresAt.getTime() - now) / (24 * 60 * 60 * 1000)
      );
      const targetStage = computeStage(daysFromExpiry);
      
      // Map holding.status → current "cron stage"
      const currentStage = holding.status === 'REFRESH_IN_PROGRESS' 
        ? null  // skip, already being handled
        : holding.status;
      
      if (targetStage === 'FRESH' || currentStage === null) continue;
      if (targetStage === currentStage) continue;
      
      try {
        if (targetStage === 'NOTIFIED') {
          await this.materialRefreshService.enterNotifiedStage(holding.id);
        } else if (targetStage === 'URGENT') {
          await this.materialRefreshService.escalateToUrgent(holding.id);
        } else if (targetStage === 'BLOCKING') {
          await this.materialRefreshService.enterBlockingStage(holding.id);
        }
      } catch (err) {
        console.error(`Stage transition failed for holding ${holding.id}:`, err);
      }
    }
  }
  
  private async scanGraceExpiredCycles(): Promise<void> {
    const expiredCycles = await this.prisma.materialRefreshCycle.findMany({
      where: {
        status: 'PENDING_CUSTOMER_EVIDENCE',
        graceExpiresAt: { lt: new Date() },
      },
    });
    
    for (const cycle of expiredCycles) {
      try {
        await this.materialRefreshService.terminateCycle(cycle.id, 'grace_expired');
      } catch (err) {
        console.error(`Failed to terminate cycle ${cycle.id}:`, err);
      }
    }
  }
  
  private async scanStuckCycles(): Promise<void> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const stuck = await this.prisma.materialRefreshCycle.findMany({
      where: {
        status: 'PENDING_CUSTOMER_EVIDENCE',
        sumsubActionId: null,
        createdAt: { lt: oneHourAgo },
      },
    });
    
    if (stuck.length > 0) {
      console.warn(`[MaterialFreshnessCron] ${stuck.length} stuck cycles with no sumsubActionId`);
      // TODO: emit alert via monitoring hook
    }
  }
  
  private mapSumsubDocToMaterialType(idDoc: any): string | null {
    if (idDoc.idDocType === 'ID_CARD' && idDoc.country === 'ARE') return 'EMIRATES_ID';
    if (idDoc.idDocType === 'PASSPORT') return 'PASSPORT';
    return null;
  }
}
```

- [ ] **Step 3: Run tests**

```bash
npm test -- src/modules/identity/material-refresh/material-freshness-cron.service.spec.ts --runInBand
```

**Expected**: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/identity/material-refresh/material-freshness-cron.service.ts \
        src/modules/identity/material-refresh/material-freshness-cron.service.spec.ts
git commit -m "feat(material-refresh): daily freshness cron"
```

### Task 4.7: Customer SDK token API

**Files:**
- Create: `Exchange_js/src/modules/identity/material-refresh/material-refresh-cycles.controller.ts`

- [ ] **Step 1: Implement**

```typescript
// material-refresh-cycles.controller.ts
import { 
  Controller, Get, Post, Param, Req, 
  UseGuards, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import { Inject } from '@nestjs/common';

@ApiTags('Customer - Material Refresh')
@Controller('onboarding/refresh-cycles')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class MaterialRefreshCyclesController {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly sumsubClient: SumsubClient,
  ) {}
  
  @Get(':cycleId')
  async getCycle(
    @Param('cycleId') cycleId: string,
    @Req() req: any,
  ) {
    const customerId = this.ensureCustomer(req);
    const cycle = await this.prisma.materialRefreshCycle.findUnique({
      where: { id: cycleId },
    });
    
    if (!cycle) throw new NotFoundException('Cycle not found');
    if (cycle.customerId !== customerId) {
      throw new ForbiddenException('Not your cycle');
    }
    
    return {
      id: cycle.id,
      cycleNo: cycle.cycleNo,
      materialType: cycle.materialType,
      status: cycle.status,
      stage: cycle.stage,
      graceExpiresAt: cycle.graceExpiresAt,
      sumsubActionLevelName: cycle.sumsubActionLevelName,
    };
  }
  
  @Post(':cycleId/sdk-token')
  async getSdkToken(
    @Param('cycleId') cycleId: string,
    @Req() req: any,
  ) {
    const customerId = this.ensureCustomer(req);
    const cycle = await this.prisma.materialRefreshCycle.findUnique({
      where: { id: cycleId },
    });
    
    if (!cycle) throw new NotFoundException('Cycle not found');
    if (cycle.customerId !== customerId) {
      throw new ForbiddenException('Not your cycle');
    }
    if (cycle.status !== 'PENDING_CUSTOMER_EVIDENCE') {
      throw new ForbiddenException(`Cycle is ${cycle.status}, cannot obtain SDK token`);
    }
    if (!cycle.sumsubActionLevelName) {
      throw new ForbiddenException('Sumsub action not yet created for this cycle');
    }
    
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
    });
    if (!customer?.sumsubApplicantId) {
      throw new ForbiddenException('No Sumsub applicant for customer');
    }
    if (customer.complianceHoldStatus === 'FROZEN') {
      throw new ForbiddenException('Account is frozen — cannot refresh materials');
    }
    
    const tokenResult = await this.sumsubClient.createActionSdkToken({
      applicantId: customer.sumsubApplicantId,
      levelName: cycle.sumsubActionLevelName,
      ttlInSecs: 600,
    });
    
    return {
      token: tokenResult.token,
      ttlSeconds: 600,
      levelName: cycle.sumsubActionLevelName,
    };
  }
  
  private ensureCustomer(req: any): string {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    return req.user.userId as string;
  }
}
```

- [ ] **Step 2: Build + commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm run build 2>&1 | tail -20
git add src/modules/identity/material-refresh/material-refresh-cycles.controller.ts
git commit -m "feat(material-refresh): customer SDK token API"
```

### Task 4.8: Module registration

**Files:**
- Create: `Exchange_js/src/modules/identity/material-refresh/material-refresh.module.ts`
- Modify: `Exchange_js/src/app.module.ts`

- [ ] **Step 1: Create module**

```typescript
// material-refresh.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { MaterialRefreshService } from './material-refresh.service';
import { MaterialFreshnessCronService } from './material-freshness-cron.service';
import { MaterialRefreshCyclesController } from './material-refresh-cycles.controller';
import { MaterialRefreshPolicyLoader } from './policy/material-refresh-policy';
import { OnboardingModule } from '../onboarding/onboarding.module';

@Module({
  imports: [forwardRef(() => OnboardingModule)],
  providers: [
    MaterialRefreshService,
    MaterialFreshnessCronService,
    MaterialRefreshPolicyLoader,
  ],
  controllers: [MaterialRefreshCyclesController],
  exports: [MaterialRefreshService],
})
export class MaterialRefreshModule {}
```

- [ ] **Step 2: Register in app.module.ts**

```typescript
// In app.module.ts imports:
import { MaterialRefreshModule } from './modules/identity/material-refresh/material-refresh.module';

@Module({
  imports: [
    // ...existing...
    MaterialRefreshModule,
  ],
})
```

- [ ] **Step 3: Wire up Layer 2 → Layer 3 via property injection**

In `ClientRiskAssessmentModule`, inject `MaterialRefreshService` into `ClientRiskAssessmentService` after construction to avoid circular deps:

```typescript
// client-risk-assessment.module.ts
import { Module, forwardRef, OnModuleInit } from '@nestjs/common';
import { MaterialRefreshModule } from '../material-refresh/material-refresh.module';
import { MaterialRefreshService } from '../material-refresh/material-refresh.service';
import { ClientRiskAssessmentService } from './client-risk-assessment.service';

@Module({
  imports: [
    forwardRef(() => OnboardingModule),
    forwardRef(() => MaterialRefreshModule),
    ApprovalsModule,
  ],
  // ... existing providers
})
export class ClientRiskAssessmentModule implements OnModuleInit {
  constructor(
    private readonly clientRiskAssessmentService: ClientRiskAssessmentService,
    private readonly materialRefreshService: MaterialRefreshService,
  ) {}
  
  onModuleInit() {
    (this.clientRiskAssessmentService as any).materialRefreshService = 
      this.materialRefreshService;
  }
}
```

- [ ] **Step 4: Build + test**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm run build 2>&1 | tail -20
npm test -- src/modules/identity/material-refresh --runInBand
npm test -- src/modules/identity/client-risk-assessment --runInBand
```

**Expected**: Build 成功，所有测试 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/material-refresh/material-refresh.module.ts \
        src/modules/identity/client-risk-assessment/client-risk-assessment.module.ts \
        src/app.module.ts
git commit -m "feat(material-refresh): module registration + Layer 2↔3 wiring"
```

**Phase 4 Complete**: Layer 3 完整实现 —— material refresh policy + 3 个 pure functions + service with 4 stage 推进 + webhook handlers + Layer 2→3 cascade + daily cron + customer SDK token API.

---

## Phase 5: Sumsub Integration Layer + Webhook Dispatcher

**目标**: 扩展 SumsubClient 新方法；创建 SumsubWebhookDispatcher 统一路由；扩展 simulation controller 覆盖 Layer 2/3 场景。

### Task 5.1: 扩展 SumsubClient

**Files:**
- Modify: `Exchange_js/src/modules/identity/onboarding/providers/sumsub/sumsub.client.ts`

- [ ] **Step 1: Read current SumsubClient**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
cat src/modules/identity/onboarding/providers/sumsub/sumsub.client.ts | head -80
```

- [ ] **Step 2: Add new methods**

Add to the class:

```typescript
  async runAmlCheck(applicantId: string): Promise<{ ok: number }> {
    return this.post(
      `/resources/applicants/${applicantId}/aml/check`,
      {},
    );
  }
  
  async getApplicant(applicantId: string): Promise<any> {
    return this.get(`/resources/applicants/${applicantId}/one`);
  }
  
  async createApplicantAction(input: {
    applicantId: string;
    levelName: string;
  }): Promise<{ id: string }> {
    return this.post(
      `/resources/applicantActions/-/forApplicant/${input.applicantId}` +
      `?levelName=${encodeURIComponent(input.levelName)}`,
      {},
    );
  }
  
  async createActionSdkToken(input: {
    applicantId: string;
    levelName: string;
    ttlInSecs?: number;
  }): Promise<{ token: string }> {
    return this.post('/resources/accessTokens/sdk', {
      userId: input.applicantId,
      levelName: input.levelName,
      ttlInSecs: input.ttlInSecs ?? 600,
    });
  }
  
  async moveToLevel(
    applicantId: string,
    levelName: string,
    docSets?: any[],
  ): Promise<any> {
    return this.post(
      `/resources/applicants/${applicantId}/moveToLevel?name=${encodeURIComponent(levelName)}`,
      docSets ? { docSets } : {},
    );
  }
```

- [ ] **Step 3: Update tests**

Existing `sumsub.client.spec.ts` may need new mock cases. Run:

```bash
npm test -- src/modules/identity/onboarding/providers/sumsub --runInBand
```

If tests fail due to unmocked methods, add minimal mock responses.

- [ ] **Step 4: Commit**

```bash
git add src/modules/identity/onboarding/providers/sumsub/
git commit -m "feat(sumsub): add runAmlCheck + getApplicant + createApplicantAction + createActionSdkToken + moveToLevel"
```

### Task 5.2: SumsubWebhookDispatcher

**Files:**
- Create: `Exchange_js/src/modules/identity/sumsub-integration/sumsub-integration.module.ts`
- Create: `Exchange_js/src/modules/identity/sumsub-integration/sumsub-webhook-dispatcher.service.ts`
- Create: `Exchange_js/src/modules/identity/sumsub-integration/sumsub-webhook-dispatcher.service.spec.ts`

- [ ] **Step 1: Write failing test for dispatch routing**

```typescript
import { SumsubWebhookDispatcher } from './sumsub-webhook-dispatcher.service';

describe('SumsubWebhookDispatcher', () => {
  let dispatcher: SumsubWebhookDispatcher;
  let prismaMock: any;
  let onboardingMock: any;
  let riskAssessmentMock: any;
  let materialRefreshMock: any;
  
  beforeEach(() => {
    prismaMock = {
      clientRiskAssessment: { findFirst: jest.fn() },
      materialRefreshCycle: { findFirst: jest.fn() },
      customerMain: { findFirst: jest.fn() },
    };
    onboardingMock = {
      handleSumsubVerificationEvent: jest.fn(),
    };
    riskAssessmentMock = {
      handleSumsubAmlResult: jest.fn(),
      startAssessment: jest.fn(),
    };
    materialRefreshMock = {
      handleSumsubActionResult: jest.fn(),
      handleSumsubDocMonitoringFire: jest.fn(),
    };
    dispatcher = new SumsubWebhookDispatcher(
      prismaMock,
      onboardingMock,
      riskAssessmentMock,
      materialRefreshMock,
    );
  });
  
  it('routes ongoingDocExpired reviewMode to Layer 3 doc monitoring handler', async () => {
    await dispatcher.dispatch({
      reviewMode: 'ongoingDocExpired',
      applicantId: 'app-1',
      type: 'applicantReviewed',
    } as any, {} as any);
    
    expect(materialRefreshMock.handleSumsubDocMonitoringFire).toHaveBeenCalled();
  });
  
  it('routes applicantReviewed with matching pending assessment to Layer 2', async () => {
    prismaMock.clientRiskAssessment.findFirst.mockResolvedValue({
      id: 'a1', sumsubAmlCheckInspectionId: 'insp-1',
    });
    
    await dispatcher.dispatch({
      type: 'applicantReviewed',
      inspectionId: 'insp-1',
      applicantId: 'app-1',
      reviewResult: { reviewAnswer: 'GREEN' },
    } as any, {} as any);
    
    expect(riskAssessmentMock.handleSumsubAmlResult).toHaveBeenCalledWith(
      'insp-1',
      expect.anything(),
    );
  });
  
  it('routes applicantActionReviewed with matching pending cycle to Layer 3', async () => {
    prismaMock.materialRefreshCycle.findFirst.mockResolvedValue({
      id: 'cycle-1', sumsubActionId: 'action-1',
    });
    
    await dispatcher.dispatch({
      type: 'applicantActionReviewed',
      actionId: 'action-1',
      applicantId: 'app-1',
      reviewResult: { reviewAnswer: 'GREEN' },
    } as any, {} as any);
    
    expect(materialRefreshMock.handleSumsubActionResult).toHaveBeenCalled();
  });
  
  it('routes onboarding events to onboarding service', async () => {
    prismaMock.clientRiskAssessment.findFirst.mockResolvedValue(null);
    prismaMock.materialRefreshCycle.findFirst.mockResolvedValue(null);
    prismaMock.customerMain.findFirst.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'PENDING_VERIFICATION',
    });
    
    await dispatcher.dispatch({
      type: 'applicantReviewed',
      applicantId: 'app-1',
      reviewResult: { reviewAnswer: 'GREEN' },
    } as any, {} as any);
    
    expect(onboardingMock.handleSumsubVerificationEvent).toHaveBeenCalled();
  });
  
  it('routes spontaneous AML hit on APPROVED customer to Layer 2 startAssessment', async () => {
    prismaMock.clientRiskAssessment.findFirst.mockResolvedValue(null);
    prismaMock.materialRefreshCycle.findFirst.mockResolvedValue(null);
    prismaMock.customerMain.findFirst.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'APPROVED',
    });
    
    await dispatcher.dispatch({
      type: 'applicantReviewed',
      applicantId: 'app-1',
      reviewResult: { 
        reviewAnswer: 'RED', 
        rejectLabels: ['SANCTIONS_UN'],
      },
    } as any, {} as any);
    
    expect(riskAssessmentMock.startAssessment).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'c1',
        triggerType: 'SUMSUB_AML_HIT',
      }),
    );
  });
});
```

- [ ] **Step 2: Implement dispatcher**

Create `sumsub-webhook-dispatcher.service.ts`:

```typescript
import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { ClientRiskAssessmentService } from '../client-risk-assessment/client-risk-assessment.service';
import { MaterialRefreshService } from '../material-refresh/material-refresh.service';

export interface SumsubWebhookEvent {
  type: string;
  applicantId?: string;
  inspectionId?: string;
  actionId?: string;
  reviewMode?: string;
  reviewResult?: {
    reviewAnswer: 'GREEN' | 'RED';
    rejectLabels?: string[];
    reviewRejectType?: string;
  };
  createdAtMs?: string;
  [key: string]: any;
}

export interface DispatchContext {
  rawBody?: Buffer;
  signature?: string;
  simulated: boolean;
  actorId?: string;
}

@Injectable()
export class SumsubWebhookDispatcher {
  private readonly logger = new Logger(SumsubWebhookDispatcher.name);
  
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly onboardingService: OnboardingService,
    private readonly clientRiskAssessmentService: ClientRiskAssessmentService,
    private readonly materialRefreshService: MaterialRefreshService,
  ) {}
  
  async dispatch(
    event: SumsubWebhookEvent,
    context: DispatchContext,
  ): Promise<void> {
    // Clue 1: reviewMode field explicitly indicates Sumsub doc monitoring
    if (event.reviewMode === 'ongoingDocExpired') {
      return this.materialRefreshService.handleSumsubDocMonitoringFire(event);
    }
    
    // Clue 2: pending ClientRiskAssessment matches by inspectionId
    if (event.inspectionId) {
      const pendingAssessment = await this.prisma.clientRiskAssessment.findFirst({
        where: {
          sumsubAmlCheckInspectionId: event.inspectionId,
          status: 'PENDING_SUMSUB_RESULT',
        },
      });
      if (pendingAssessment) {
        return this.clientRiskAssessmentService.handleSumsubAmlResult(
          event.inspectionId,
          event.reviewResult!,
        );
      }
    }
    
    // Clue 3: pending MaterialRefreshCycle by actionId
    if (event.actionId) {
      const pendingCycle = await this.prisma.materialRefreshCycle.findFirst({
        where: {
          sumsubActionId: event.actionId,
          status: 'PENDING_CUSTOMER_EVIDENCE',
        },
      });
      if (pendingCycle) {
        return this.materialRefreshService.handleSumsubActionResult(event as any);
      }
    }
    
    // Clue 4/5: find customer and route based on onboarding status
    if (!event.applicantId) {
      this.logger.warn('unrouted_sumsub_webhook', { event });
      return;
    }
    
    const customer = await this.prisma.customerMain.findFirst({
      where: { sumsubApplicantId: event.applicantId },
    });
    if (!customer) {
      this.logger.warn('unrouted_webhook_no_customer', { applicantId: event.applicantId });
      return;
    }
    
    // Clue 4: customer is in onboarding
    if (customer.onboardingStatus === 'PENDING_VERIFICATION') {
      return this.onboardingService.handleSumsubVerificationEvent(event as any, context);
    }
    
    // Clue 5: APPROVED customer + spontaneous AML RED → new Layer 2 trigger
    if (
      customer.onboardingStatus === 'APPROVED' &&
      event.type === 'applicantReviewed' &&
      event.reviewResult?.reviewAnswer === 'RED'
    ) {
      return this.clientRiskAssessmentService.startAssessment({
        customerId: customer.id,
        triggerType: 'SUMSUB_AML_HIT',
        triggeredContext: {
          spontaneousEvent: event,
          labels: event.reviewResult.rejectLabels || [],
        },
      });
    }
    
    this.logger.warn('unrouted_sumsub_webhook', { 
      applicantId: event.applicantId,
      type: event.type,
      customerStatus: customer.onboardingStatus,
    });
  }
}
```

- [ ] **Step 3: Create module**

```typescript
// sumsub-integration.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { SumsubWebhookDispatcher } from './sumsub-webhook-dispatcher.service';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { ClientRiskAssessmentModule } from '../client-risk-assessment/client-risk-assessment.module';
import { MaterialRefreshModule } from '../material-refresh/material-refresh.module';

@Module({
  imports: [
    forwardRef(() => OnboardingModule),
    forwardRef(() => ClientRiskAssessmentModule),
    forwardRef(() => MaterialRefreshModule),
  ],
  providers: [SumsubWebhookDispatcher],
  exports: [SumsubWebhookDispatcher],
})
export class SumsubIntegrationModule {}
```

- [ ] **Step 4: Run tests + register in app.module.ts**

```bash
npm test -- src/modules/identity/sumsub-integration --runInBand
```

Update `src/app.module.ts`:

```typescript
import { SumsubIntegrationModule } from './modules/identity/sumsub-integration/sumsub-integration.module';

@Module({
  imports: [
    // ...
    SumsubIntegrationModule,
  ],
})
```

- [ ] **Step 5: Update `onboarding-sumsub-webhook.controller.ts` to delegate to dispatcher**

Edit existing file to use dispatcher:

```typescript
@Post('webhook')
async handleWebhook(
  @Req() req: any,
  @Body() body: any,
  @Headers('x-payload-digest') signature?: string,
) {
  return this.dispatcher.dispatch(body, {
    rawBody: req.rawBody,
    signature,
    simulated: false,
    actorId: 'SUMSUB',
  });
}
```

constructor inject `SumsubWebhookDispatcher` instead of (or in addition to) `OnboardingService`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/identity/sumsub-integration/ \
        src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.ts \
        src/app.module.ts
git commit -m "feat(sumsub-integration): webhook dispatcher unifying onboarding + Layer 2/3 routing"
```

### Task 5.3: Admin Sumsub Simulation Controller

**Files:**
- Create: `Exchange_js/src/modules/identity/sumsub-integration/admin-sumsub-simulation.controller.ts`

- [ ] **Step 1: Implement**

```typescript
// admin-sumsub-simulation.controller.ts
import { 
  Controller, Post, Body, ForbiddenException, UseGuards, 
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SumsubWebhookDispatcher } from './sumsub-webhook-dispatcher.service';
import { AdminAuthGuard } from '../../auth/admin-auth.guard';

@ApiTags('Admin - Sumsub Simulation')
@Controller('admin/sumsub/simulate')
@UseGuards(AdminAuthGuard)
@ApiBearerAuth()
export class AdminSumsubSimulationController {
  constructor(private readonly dispatcher: SumsubWebhookDispatcher) {}
  
  @Post('aml-check-result')
  @ApiOperation({ summary: 'Simulate Sumsub AML check completion (applicantReviewed)' })
  async simulateAmlCheckResult(@Body() body: {
    customerId: string;
    applicantId: string;
    inspectionId: string;
    reviewAnswer: 'GREEN' | 'RED';
    rejectLabels?: string[];
    reviewRejectType?: string;
  }) {
    if (process.env.NODE_ENV !== 'development') {
      throw new ForbiddenException('Simulation only in development');
    }
    
    return this.dispatcher.dispatch({
      type: 'applicantReviewed',
      applicantId: body.applicantId,
      inspectionId: body.inspectionId,
      reviewResult: {
        reviewAnswer: body.reviewAnswer,
        rejectLabels: body.rejectLabels,
        reviewRejectType: body.reviewRejectType,
      },
      createdAtMs: String(Date.now()),
    } as any, { simulated: true, actorId: 'ADMIN_SIMULATION' });
  }
  
  @Post('applicant-action-result')
  async simulateApplicantActionResult(@Body() body: {
    applicantId: string;
    actionId: string;
    reviewAnswer: 'GREEN' | 'RED';
    reviewRejectType?: string;
  }) {
    if (process.env.NODE_ENV !== 'development') {
      throw new ForbiddenException('Simulation only in development');
    }
    
    return this.dispatcher.dispatch({
      type: 'applicantActionReviewed',
      applicantId: body.applicantId,
      actionId: body.actionId,
      reviewResult: {
        reviewAnswer: body.reviewAnswer,
        reviewRejectType: body.reviewRejectType,
      },
      createdAtMs: String(Date.now()),
    } as any, { simulated: true, actorId: 'ADMIN_SIMULATION' });
  }
  
  @Post('sumsub-case-decision')
  async simulateSumsubCaseDecision(@Body() body: {
    assessmentId: string;
    decision: 'APPROVE' | 'REJECT';
    reason?: string;
  }) {
    // Dispatches to ClientRiskAssessmentService.handleSumsubCaseFinalDecision
    // (Implement in Phase 3.10 or directly call here since we have access)
    // For simplicity: directly inject and call
    // ...
  }
  
  @Post('ongoing-doc-monitoring-fire')
  async simulateOngoingDocMonitoring(@Body() body: {
    applicantId: string;
  }) {
    if (process.env.NODE_ENV !== 'development') {
      throw new ForbiddenException('Simulation only in development');
    }
    
    return this.dispatcher.dispatch({
      type: 'applicantReviewed',
      reviewMode: 'ongoingDocExpired',
      applicantId: body.applicantId,
      createdAtMs: String(Date.now()),
    } as any, { simulated: true, actorId: 'ADMIN_SIMULATION' });
  }
}
```

- [ ] **Step 2: Register controller in `SumsubIntegrationModule`**

```typescript
@Module({
  // ...
  controllers: [AdminSumsubSimulationController],
})
```

- [ ] **Step 3: Build + commit**

```bash
npm run build 2>&1 | tail -20
git add src/modules/identity/sumsub-integration/
git commit -m "feat(sumsub-integration): admin simulation controller for Layer 2/3 testing"
```

**Phase 5 Complete**: SumsubClient 扩展 + Webhook Dispatcher 统一路由 + Admin simulation controller.

---

## Phase 6: Profile Banner + Frontend

**目标**: Backend profile banner API + Frontend 渲染 banner + /verification 多模式 + AuthGuard 细化 + 交易 guard.

### Task 6.1: Backend ProfileBannerService + API

**Files:**
- Create: `Exchange_js/src/modules/identity/profile-banners/profile-banners.module.ts`
- Create: `Exchange_js/src/modules/identity/profile-banners/profile-banners.service.ts`
- Create: `Exchange_js/src/modules/identity/profile-banners/profile-banners.controller.ts`

- [ ] **Step 1: Implement service**

```typescript
// profile-banners.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';

export interface ProfileBanner {
  id: string;
  type: 'MATERIAL_REFRESH' | 'COMPLIANCE_HOLD' | 'PEP_REVIEW_PENDING';
  severity: 'INFO' | 'WARNING' | 'BLOCKING';
  title: string;
  description: string;
  cycleId?: string;
  materialType?: string;
  expiresAt?: string;
  daysFromExpiry?: number;
  ctaLabel?: string | null;
  ctaPath?: string | null;
  dismissible: boolean;
}

@Injectable()
export class ProfileBannerService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
  ) {}
  
  async getBannersFor(customerId: string): Promise<ProfileBanner[]> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
    });
    if (!customer) return [];
    
    const banners: ProfileBanner[] = [];
    
    // 1. FROZEN (highest priority)
    if (customer.complianceHoldStatus === 'FROZEN') {
      banners.push({
        id: `banner-hold-${customer.id}`,
        type: 'COMPLIANCE_HOLD',
        severity: 'BLOCKING',
        title: 'Your account is frozen',
        description: 'Please contact our compliance team.',
        ctaLabel: 'Contact compliance',
        ctaPath: '/support/compliance',
        dismissible: false,
      });
    }
    
    // 2. PEP review pending
    if (customer.restrictionReason === 'pep_review_pending') {
      banners.push({
        id: `banner-pep-${customer.id}`,
        type: 'PEP_REVIEW_PENDING',
        severity: 'WARNING',
        title: 'Compliance review in progress',
        description: 'Your account is temporarily limited while we verify additional information.',
        ctaLabel: null,
        ctaPath: null,
        dismissible: false,
      });
    }
    
    // 3. Active material refresh cycles
    const cycles = await this.prisma.materialRefreshCycle.findMany({
      where: {
        customerId,
        status: 'PENDING_CUSTOMER_EVIDENCE',
      },
      include: { holding: true },
      orderBy: { graceExpiresAt: 'asc' },
    });
    
    for (const cycle of cycles) {
      const holding = cycle.holding;
      const daysFromExpiry = holding?.expiresAt
        ? Math.floor(
            (holding.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
          )
        : null;
      
      const severity = 
        cycle.stage === 'BLOCKING' ? 'BLOCKING' :
        cycle.stage === 'URGENT' ? 'WARNING' : 'INFO';
      
      const materialDisplay = this.formatMaterialName(cycle.materialType);
      const title = severity === 'BLOCKING' 
        ? `Your ${materialDisplay} has expired`
        : severity === 'WARNING'
        ? `Your ${materialDisplay} expires in ${daysFromExpiry} days`
        : `Your ${materialDisplay} expires in ${daysFromExpiry} days`;
      
      banners.push({
        id: `banner-mrc-${cycle.id}`,
        type: 'MATERIAL_REFRESH',
        severity,
        title,
        description: severity === 'BLOCKING' 
          ? 'Refresh it now to restore your account.'
          : severity === 'WARNING'
          ? 'Refresh soon to avoid service interruption.'
          : 'You can refresh it at any time.',
        cycleId: cycle.id,
        materialType: cycle.materialType,
        expiresAt: holding?.expiresAt?.toISOString(),
        daysFromExpiry: daysFromExpiry ?? undefined,
        ctaLabel: `Refresh ${materialDisplay}`,
        ctaPath: `/verification?cycleId=${cycle.id}`,
        dismissible: severity === 'INFO',
      });
    }
    
    // Sort: BLOCKING first, then WARNING, then INFO
    return banners.sort((a, b) => {
      const order = { BLOCKING: 0, WARNING: 1, INFO: 2 };
      return order[a.severity] - order[b.severity];
    });
  }
  
  private formatMaterialName(materialType: string): string {
    switch (materialType) {
      case 'EMIRATES_ID': return 'Emirates ID';
      case 'PASSPORT': return 'Passport';
      case 'PROOF_OF_ADDRESS': return 'Proof of Address';
      case 'SOURCE_OF_FUNDS': return 'Source of Funds';
      case 'SOURCE_OF_WEALTH': return 'Source of Wealth';
      default: return materialType;
    }
  }
}
```

- [ ] **Step 2: Implement controller**

```typescript
// profile-banners.controller.ts
import { Controller, Get, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ProfileBannerService } from './profile-banners.service';

@ApiTags('Customer - Profile Banners')
@Controller('customers/me/profile-banners')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class ProfileBannerController {
  constructor(private readonly service: ProfileBannerService) {}
  
  @Get()
  async getBanners(@Req() req: any) {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    const banners = await this.service.getBannersFor(req.user.userId);
    return { banners };
  }
}
```

- [ ] **Step 3: Module + register**

```typescript
// profile-banners.module.ts
import { Module } from '@nestjs/common';
import { ProfileBannerService } from './profile-banners.service';
import { ProfileBannerController } from './profile-banners.controller';

@Module({
  providers: [ProfileBannerService],
  controllers: [ProfileBannerController],
  exports: [ProfileBannerService],
})
export class ProfileBannersModule {}
```

Register in `app.module.ts`:

```typescript
import { ProfileBannersModule } from './modules/identity/profile-banners/profile-banners.module';

@Module({ imports: [/* ..., */ ProfileBannersModule] })
```

- [ ] **Step 4: Build + commit**

```bash
npm run build 2>&1 | tail -20
git add src/modules/identity/profile-banners/ src/app.module.ts
git commit -m "feat(profile-banners): backend service + API"
```

### Task 6.2: Frontend ProfileBanner + BannerStack 组件

**Files:**
- Create: `Exchange_js/client-web/src/components/ProfileBanner.tsx`
- Create: `Exchange_js/client-web/src/components/ProfileBannerStack.tsx`

- [ ] **Step 1: Implement banner component**

```tsx
// ProfileBanner.tsx
import { AlertTriangle, AlertCircle, Info, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export interface ProfileBannerData {
  id: string;
  type: string;
  severity: 'INFO' | 'WARNING' | 'BLOCKING';
  title: string;
  description: string;
  ctaLabel?: string | null;
  ctaPath?: string | null;
  dismissible: boolean;
}

export function ProfileBanner({ banner }: { banner: ProfileBannerData }) {
  const navigate = useNavigate();
  
  const styles = {
    BLOCKING: {
      container: 'border-fx-rust bg-fx-rust/5',
      icon: 'text-fx-rust',
      Icon: AlertTriangle,
      title: 'text-fx-rust',
    },
    WARNING: {
      container: 'border-fx-copper bg-fx-copper/5',
      icon: 'text-fx-copper',
      Icon: AlertCircle,
      title: 'text-fx-copper',
    },
    INFO: {
      container: 'border-fx-brass/40 bg-fx-brass/5',
      icon: 'text-fx-brass',
      Icon: Info,
      title: 'text-fx-brass',
    },
  }[banner.severity];
  
  const { Icon } = styles;
  
  return (
    <div className={`border-l-4 ${styles.container} px-5 py-4 mb-3`}>
      <div className="flex items-start gap-4">
        <Icon className={`mt-1 shrink-0 ${styles.icon}`} size={18} />
        <div className="flex-1">
          <div className={`font-mono text-[10px] uppercase tracking-[0.18em] mb-1 ${styles.title}`}>
            {banner.title}
          </div>
          <p className="text-[13px] text-fx-dune leading-relaxed">
            {banner.description}
          </p>
        </div>
        {banner.ctaLabel && banner.ctaPath && (
          <button
            onClick={() => navigate(banner.ctaPath!)}
            className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-fx-sand hover:text-fx-brass transition-colors flex items-center gap-1"
          >
            {banner.ctaLabel}
            <ExternalLink size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement banner stack**

```tsx
// ProfileBannerStack.tsx
import { useEffect, useState } from 'react';
import { ProfileBanner, ProfileBannerData } from './ProfileBanner';
import { customerFetch } from '../utils/customerFetch';

export function ProfileBannerStack() {
  const [banners, setBanners] = useState<ProfileBannerData[]>([]);
  
  useEffect(() => {
    const load = async () => {
      try {
        const response = await customerFetch(
          `${import.meta.env.VITE_API_URL}/customers/me/profile-banners`,
        );
        if (response.ok) {
          const data = await response.json();
          setBanners(data.banners || []);
        }
      } catch (err) {
        console.error('Failed to load banners:', err);
      }
    };
    
    load();
    
    // Reload on visibility change (returning to tab)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);
  
  if (banners.length === 0) return null;
  
  return (
    <div className="mb-6">
      {banners.map(b => (
        <ProfileBanner key={b.id} banner={b} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Insert into CustomerProfile page**

Edit `Exchange_js/client-web/src/pages/CustomerProfile.tsx`. At the top of the main content area, add:

```tsx
import { ProfileBannerStack } from '../components/ProfileBannerStack';

// Inside the return JSX, at the very top of the profile content:
<ProfileBannerStack />
```

- [ ] **Step 4: Preview build**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/client-web
npm run build 2>&1 | tail -10
cd ..
```

- [ ] **Step 5: Commit**

```bash
git add client-web/src/components/ProfileBanner.tsx \
        client-web/src/components/ProfileBannerStack.tsx \
        client-web/src/pages/CustomerProfile.tsx
git commit -m "feat(client-web): profile banner stack with severity-based styling"
```

### Task 6.3: /verification 页面多模式支持

**Files:**
- Modify: `Exchange_js/client-web/src/pages/Verification.tsx`

- [ ] **Step 1: Wrap existing Verification in a mode selector**

At the top of `Verification.tsx`, add routing logic:

```tsx
import { useSearchParams, Navigate } from 'react-router-dom';

const Verification = () => {
  const { profile } = useCustomerProfile();
  const [searchParams] = useSearchParams();
  const cycleId = searchParams.get('cycleId');
  
  // Mode A: still in onboarding
  if (!profile || profile.onboardingStatus !== 'APPROVED') {
    return <OnboardingVerificationMode profile={profile} />;
  }
  
  // Mode B: refresh cycle
  if (cycleId) {
    return <MaterialRefreshVerificationMode cycleId={cycleId} />;
  }
  
  // Mode C: invalid access
  return <Navigate to="/profile" replace />;
};
```

Rename the existing component body to `OnboardingVerificationMode` and create a new `MaterialRefreshVerificationMode` component.

- [ ] **Step 2: Implement MaterialRefreshVerificationMode**

```tsx
const MaterialRefreshVerificationMode = ({ cycleId }: { cycleId: string }) => {
  const [cycle, setCycle] = useState<any>(null);
  const [sdkToken, setSdkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  useEffect(() => {
    (async () => {
      try {
        // Get cycle details
        const cycleRes = await customerFetch(
          `${import.meta.env.VITE_API_URL}/onboarding/refresh-cycles/${cycleId}`,
        );
        if (!cycleRes.ok) {
          setError('Cycle not found or access denied');
          setLoading(false);
          return;
        }
        const cycleData = await cycleRes.json();
        setCycle(cycleData);
        
        // Get SDK token
        const tokenRes = await customerFetch(
          `${import.meta.env.VITE_API_URL}/onboarding/refresh-cycles/${cycleId}/sdk-token`,
          { method: 'POST' },
        );
        if (!tokenRes.ok) {
          setError('Failed to get SDK token');
          setLoading(false);
          return;
        }
        const { token } = await tokenRes.json();
        setSdkToken(token);
      } catch (err: any) {
        setError(err.message || 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, [cycleId]);
  
  if (loading) return <div className="text-fx-dune font-mono text-[11px]">Loading…</div>;
  if (error) return <div className="text-fx-rust font-mono text-[11px]">{error}</div>;
  if (!cycle || !sdkToken) return null;
  
  return (
    <div className="min-h-[calc(100vh-4rem)] px-6 py-12 max-w-[800px] mx-auto">
      <div className="flex items-center gap-3 mb-10">
        <span className="h-[1px] w-8 bg-fx-brass" />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fx-dust">
          § Material Refresh · {formatMaterialName(cycle.materialType)}
        </span>
      </div>
      
      <h1 className="fx-display font-light text-[40px] leading-[1.05] text-fx-sand mb-6">
        Refresh your
        <br />
        <span className="fx-serif italic text-fx-brass">
          {formatMaterialName(cycle.materialType).toLowerCase()}
        </span>
      </h1>
      
      <p className="fx-serif text-[15px] leading-[1.7] text-fx-dune max-w-[500px] mb-10">
        Your document needs an update. Upload a fresh copy using the secure Sumsub widget below.
      </p>
      
      {/* Sumsub WebSDK embed using @sumsub/websdk package (vanilla JS API) */}
      <SumsubEmbed 
        accessToken={sdkToken}
        levelName={cycle.sumsubActionLevelName}
        onCompleted={() => {
          // Sumsub fires 'applicantActionReviewed' webhook → our backend handles it
          // Here we just navigate back to /profile; banner will auto-refresh
          navigate('/profile');
        }}
      />
    </div>
  );
};

/**
 * Sumsub WebSDK wrapper. Uses @sumsub/websdk package (vanilla) via ref-mounted
 * container since there is no React-first binding we depend on.
 *
 * Install: cd client-web && npm install --save @sumsub/websdk
 */
const SumsubEmbed = ({ 
  accessToken, 
  levelName,
  onCompleted,
}: {
  accessToken: string;
  levelName?: string;
  onCompleted: () => void;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Lazy load the Sumsub SDK script
    // (In demo we can also skip this and show a stub UI if the package is not installed)
    let snsWebSdkInstance: any = null;
    
    (async () => {
      try {
        // @ts-ignore — dynamic import of installed package
        const { default: snsWebSdk } = await import('@sumsub/websdk');
        
        snsWebSdkInstance = snsWebSdk
          .init(accessToken, () => Promise.resolve(accessToken))  // refresh cb
          .withConf({
            lang: 'en',
            theme: 'dark',
          })
          .on('idCheck.onStepCompleted', (payload: any) => {
            console.log('Sumsub step completed:', payload);
          })
          .on('idCheck.onApplicantSubmitted', () => {
            console.log('Sumsub applicant submitted');
            onCompleted();
          })
          .on('idCheck.onApplicantResubmitted', () => {
            console.log('Sumsub applicant resubmitted');
          })
          .on('idCheck.onError', (error: any) => {
            console.error('Sumsub error:', error);
          })
          .build();
        
        snsWebSdkInstance.launch('#sumsub-websdk-container');
      } catch (err) {
        console.error('Failed to init Sumsub WebSDK:', err);
      }
    })();
    
    return () => {
      if (snsWebSdkInstance) {
        try {
          snsWebSdkInstance.destroy();
        } catch { /* noop */ }
      }
    };
  }, [accessToken, onCompleted]);
  
  return (
    <div 
      id="sumsub-websdk-container" 
      ref={containerRef} 
      className="border border-fx-rule min-h-[600px]" 
    />
  );
};

function formatMaterialName(materialType: string): string {
  const map: Record<string, string> = {
    EMIRATES_ID: 'Emirates ID',
    PASSPORT: 'Passport',
    PROOF_OF_ADDRESS: 'Proof of Address',
    SOURCE_OF_FUNDS: 'Source of Funds',
    SOURCE_OF_WEALTH: 'Source of Wealth',
  };
  return map[materialType] || materialType;
}
```

- [ ] **Step 3: Install Sumsub WebSDK package**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/client-web
npm install --save @sumsub/websdk
```

这个包 export default 一个 `snsWebSdk` 对象，通过 `.init() → .withConf() → .on() → .build() → .launch()` 的流式 API 挂载到 DOM。

- [ ] **Step 4: Build + commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/client-web
npm run build 2>&1 | tail -10
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
git add client-web/src/pages/Verification.tsx client-web/package.json client-web/package-lock.json
git commit -m "feat(client-web): /verification multi-mode (onboarding + refresh cycle) + Sumsub WebSDK embed"
```

### Task 6.4: AuthGuard 细化 + backend trading guards

**Files:**
- Modify: `Exchange_js/client-web/src/components/AuthGuard.tsx`
- Modify: `Exchange_js/src/modules/trading/deposit/deposit.service.ts` (or equivalent)
- Modify: `Exchange_js/src/modules/trading/withdraw/withdraw.service.ts`
- Modify: `Exchange_js/src/modules/trading/swap/swap.service.ts`

- [ ] **Step 1: Refine AuthGuard**

Edit `AuthGuard.tsx` to add route-level gating:

```tsx
// Inside AuthGuard, after existing check for approved/active:

// FROZEN state: allow only /profile
if (customer?.complianceHoldStatus === 'FROZEN') {
  if (location.pathname !== '/profile') {
    return <Navigate to="/profile" replace />;
  }
  return <>{children}</>;  // profile page shows banner
}

// RESTRICTED state: block trading routes
if (customer?.restrictionStatus === 'RESTRICTED') {
  const blockedPaths = ['/deposit', '/withdraw', '/swap', '/wallet/send'];
  if (blockedPaths.includes(location.pathname)) {
    return <Navigate to="/profile" replace />;
  }
  return <>{children}</>;
}
```

- [ ] **Step 2: Add backend guard helper**

Create a shared guard utility:

```typescript
// src/modules/trading/shared/customer-transaction-guard.ts
import { ForbiddenException } from '@nestjs/common';

export function ensureCustomerCanTransact(customer: any): void {
  if (customer.complianceHoldStatus === 'FROZEN') {
    throw new ForbiddenException('Account is frozen');
  }
  if (customer.restrictionStatus === 'RESTRICTED') {
    throw new ForbiddenException(
      `Account restricted: ${customer.restrictionReason || 'unspecified'}`,
    );
  }
  if (customer.operatingStatus !== 'ACTIVE') {
    throw new ForbiddenException('Account is not active');
  }
}
```

- [ ] **Step 3: Add guard calls in deposit/withdraw/swap services**

In each trading service's transaction entry method, call:

```typescript
import { ensureCustomerCanTransact } from '../shared/customer-transaction-guard';

// At the start of createDeposit / createWithdraw / createSwap:
const customer = await this.prisma.customerMain.findUnique({
  where: { id: customerId },
});
ensureCustomerCanTransact(customer);
```

**Exact files to edit**: Find the main entry methods in:
- `src/modules/trading/deposit/` (look for `deposit.service.ts` or similar)
- `src/modules/trading/withdraw/`
- `src/modules/trading/swap/`

Use `grep -rn "createDeposit\|createWithdraw\|createSwap" src/modules/trading/` to locate.

- [ ] **Step 4: Build + commit**

```bash
cd client-web && npm run build 2>&1 | tail -10 && cd ..
npm run build 2>&1 | tail -20
git add client-web/src/components/AuthGuard.tsx \
        src/modules/trading/shared/customer-transaction-guard.ts \
        src/modules/trading/deposit/ \
        src/modules/trading/withdraw/ \
        src/modules/trading/swap/
git commit -m "feat(trading): AuthGuard + backend guards for FROZEN/RESTRICTED customers"
```

**Phase 6 Complete**: Frontend banner + verification page + AuthGuard + backend transaction guards.

---

## Phase 7: Backfill + Rollout

**目标**: 写 backfill 脚本；设置 feature flag；配监控；分阶段上线。

### Task 7.1: Backfill script

**Files:**
- Create: `Exchange_js/scripts/wave3-firm-driven-review-backfill.ts`

- [ ] **Step 1: Implement backfill**

```typescript
// scripts/wave3-firm-driven-review-backfill.ts
import { PrismaClient } from '@prisma/client';
import { SumsubClient } from '../src/modules/identity/onboarding/providers/sumsub/sumsub.client';

async function backfill({ dryRun, fromCustomerNo, batchSize = 100 }: {
  dryRun: boolean;
  fromCustomerNo?: string;
  batchSize?: number;
}) {
  const prisma = new PrismaClient();
  const sumsub = new SumsubClient();
  
  const where: any = {
    onboardingStatus: 'APPROVED',
    sumsubApplicantId: { not: null },
  };
  if (fromCustomerNo) {
    where.customerNo = { gte: fromCustomerNo };
  }
  
  const customers = await prisma.customerMain.findMany({
    where,
    orderBy: { customerNo: 'asc' },
  });
  
  console.log(`Found ${customers.length} customers to backfill`);
  
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  
  for (const customer of customers) {
    try {
      if (dryRun) {
        console.log(`[DRY] ${customer.customerNo}`);
        continue;
      }
      
      await prisma.$transaction(async (tx) => {
        // 1. Set default riskTier + pepStatus if not set
        if (!customer.riskTier || customer.riskTier === 'LOW') {
          await tx.customerMain.update({
            where: { id: customer.id },
            data: { riskTier: 'LOW', pepStatus: 'NONE' },
          });
        }
        
        // 2. Read Sumsub snapshot
        const snapshot: any = await sumsub.getApplicant(customer.sumsubApplicantId!);
        
        // 3. Create holdings for LOW tier required materials
        const requiredMaterials = ['EMIRATES_ID', 'PROOF_OF_ADDRESS'];
        
        for (const materialType of requiredMaterials) {
          const existing = await tx.customerMaterialHolding.findUnique({
            where: {
              customerId_materialType: {
                customerId: customer.id,
                materialType,
              },
            },
          });
          if (existing) continue;
          
          let expiresAt: Date | null = null;
          let managementMode: 'SUMSUB_MANAGED' | 'SELF_MANAGED' = 'SELF_MANAGED';
          let sumsubIdDocSetType: string | null = null;
          
          if (materialType === 'EMIRATES_ID') {
            managementMode = 'SUMSUB_MANAGED';
            sumsubIdDocSetType = 'IDENTITY';
            const idDoc = snapshot.info?.idDocs?.find(
              (d: any) => d.idDocType === 'ID_CARD' && d.country === 'ARE',
            );
            expiresAt = idDoc?.validUntil ? new Date(idDoc.validUntil) : null;
          } else if (materialType === 'PROOF_OF_ADDRESS') {
            managementMode = 'SELF_MANAGED';
            // LOW tier window: 365 days from approvedAt
            expiresAt = new Date(
              (customer.updatedAt || customer.createdAt).getTime() + 
              365 * 24 * 60 * 60 * 1000,
            );
          }
          
          await tx.customerMaterialHolding.create({
            data: {
              customerId: customer.id,
              materialType,
              managementMode,
              sumsubIdDocSetType,
              verifiedAt: customer.updatedAt || customer.createdAt,
              expiresAt,
              status: expiresAt ? 'FRESH' : 'MISSING',
            },
          });
        }
      });
      
      succeeded++;
      console.log(`✓ ${customer.customerNo}`);
    } catch (err: any) {
      failed++;
      console.error(`✗ ${customer.customerNo}: ${err.message}`);
    }
    
    if ((succeeded + failed) % batchSize === 0) {
      await new Promise(r => setTimeout(r, 1000));  // pacing
    }
  }
  
  console.log(`\nDone. ${succeeded} succeeded, ${failed} failed, ${skipped} skipped.`);
  await prisma.$disconnect();
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fromArg = args.find(a => a.startsWith('--from-customer-no='));
const fromCustomerNo = fromArg?.split('=')[1];

backfill({ dryRun, fromCustomerNo }).catch(console.error);
```

- [ ] **Step 2: Add npm script**

Edit `package.json`, add to scripts:

```json
{
  "scripts": {
    "wave3:backfill": "ts-node scripts/wave3-firm-driven-review-backfill.ts"
  }
}
```

- [ ] **Step 3: Test dry-run on dev DB**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm run wave3:backfill -- --dry-run
```

**Expected**: 输出 customer list, 没有写入。

- [ ] **Step 4: Commit**

```bash
git add scripts/wave3-firm-driven-review-backfill.ts package.json
git commit -m "feat(scripts): wave3 backfill script for CustomerMaterialHolding"
```

### Task 7.2: Feature flag infrastructure

- [ ] **Step 1: Add feature flag to env**

Add to `.env.example`:

```
FF_WAVE3_FIRM_DRIVEN_REVIEW=false
```

The flag is already referenced in Phase 3/4 cron services (`process.env.FF_WAVE3_FIRM_DRIVEN_REVIEW !== 'true'`).

- [ ] **Step 2: Add to deployment docs**

Update `docs/operations/sumsub-dashboard-wave3-config-runbook.md` to mention the feature flag:

```markdown
## Step 6: Feature flag

Before enabling the Layer 2/3 crons, set:
  FF_WAVE3_FIRM_DRIVEN_REVIEW=true

This is only set to true AFTER the backfill script has completed.
```

### Task 7.3: Staging deployment (manual execution checklist)

- [ ] **Step 1: Deploy all Phase 1-6 code to staging** (standard deployment)

- [ ] **Step 2: Run backfill dry-run on staging**

```bash
FF_WAVE3_FIRM_DRIVEN_REVIEW=false npm run wave3:backfill -- --dry-run
```

- [ ] **Step 3: Run backfill for real**

```bash
FF_WAVE3_FIRM_DRIVEN_REVIEW=false npm run wave3:backfill
```

- [ ] **Step 4: Enable feature flag on staging**

```bash
# in staging env
export FF_WAVE3_FIRM_DRIVEN_REVIEW=true
# restart services
```

- [ ] **Step 5: Run 6 acceptance scenarios via admin simulation controller**

Use `POST /admin/sumsub/simulate/*` endpoints to exercise each scenario:
1. Onboarding → 3m → GREEN → LOW reaffirm (auto)
2. Onboarding → 3m → SANCTIONS hit → FROZEN
3. Onboarding → 12m → PoA expired → customer refreshes → CLEARED
4. Tier LOW → MEDIUM via behavior upgrade → SoF initial collection
5. PEP detected → dual sign flow (MLRO → SENIOR)
6. Grace expired → customer offboard

**Expected**: Each scenario produces the correct final state in DB + correct customer UX.

### Task 7.4: Production deployment

- [ ] **Step 1-7**: Follow the same staging sequence in production.

- [ ] **Step 8: Monitor metrics for 48 hours**

Watch for:
- `wave3_assessment_escalated_to_sumsub_total{label}` (any sanctions)
- `wave3_assessment_stuck_total` (should stay 0)
- `wave3_material_refresh_cycle_total{status}` (healthy ratio)

**Phase 7 Complete**: Backfill + feature flag + staging + production deployment.

---

## Phase 8: Documentation Updates

**目标**: 把本次 Wave 3 重设计的真相写到 canonical specs/constraints 文档里，让未来维护者有文档可查。

### Task 8.1: 更新 periodic-review-module.md

**Files:**
- Modify: `Exchange_js/docs/specs/modules/periodic-review-module.md`

- [ ] **Step 1: Replace with Wave 3 firm-driven version**

Rewrite the file to reflect the new Layer 2/3 architecture. Key changes:
- "Periodic review" is now called "Firm-driven customer review" with Layer 2 + Layer 3
- Remove references to customer-driven CDD/EDD flow
- Add references to new entities (ClientRiskAssessment, MaterialRefreshCycle, CustomerMaterialHolding)
- Add VARA III.D.7/8 and III.E.5/10 references

### Task 8.2: 新建 firm-driven-customer-review-workflow.md

**Files:**
- Create: `Exchange_js/docs/specs/workflows/firm-driven-customer-review-workflow.md`

- [ ] **Step 1: Create workflow spec**

Brief canonical workflow document referencing Layer 2 triggers (SCHEDULED_QUARTERLY, SUMSUB_AML_HIT, MLRO_MANUAL) and Layer 3 triggers (SCHEDULED_EXPIRY, RISK_TIER_UPGRADED, INITIAL_COLLECTION, SUMSUB_DOC_MONITORING).

### Task 8.3: 新建 3 份 entity specs

**Files:**
- Create: `Exchange_js/docs/specs/entities/client-risk-assessment-entity.md`
- Create: `Exchange_js/docs/specs/entities/customer-material-holding-entity.md`
- Create: `Exchange_js/docs/specs/entities/material-refresh-cycle-entity.md`

- [ ] **Step 1: Create entity specs following the existing project pattern**

Reference the design doc Section 5 (Data Model) for canonical fields + relationships.

### Task 8.4: Update onboarding-flow-constraints.md

**Files:**
- Modify: `Exchange_js/docs/constraints/onboarding-flow-constraints.md`

- [ ] **Step 1: Add section about Layer 2 integration**

Add note that onboarding flow now creates initial `ClientRiskAssessment` via `recordAssessmentFromKnownAmlResult` in place of creating ONBOARDING_FINAL_APPROVAL directly.

### Task 8.5: Update wave-3-residual-cleanup-inventory.md

**Files:**
- Modify: `Exchange_js/docs/cleanup/wave-3-residual-cleanup-inventory.md`

- [ ] **Step 1: Close the Wave 3 residual items that are addressed by this plan**

Mark items like "periodic review customer-driven flow" as resolved by this redesign.

### Task 8.6: Commit all docs

```bash
git add docs/specs/modules/periodic-review-module.md \
        docs/specs/workflows/firm-driven-customer-review-workflow.md \
        docs/specs/entities/client-risk-assessment-entity.md \
        docs/specs/entities/customer-material-holding-entity.md \
        docs/specs/entities/material-refresh-cycle-entity.md \
        docs/constraints/onboarding-flow-constraints.md \
        docs/cleanup/wave-3-residual-cleanup-inventory.md
git commit -m "docs: align canonical specs/constraints with Wave 3 firm-driven customer review"
```

**Phase 8 Complete**: All canonical documentation updated.

---

## Final Verification

- [ ] **All Phase tests pass**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npm test --runInBand 2>&1 | tail -20
```

**Expected**: ALL PASS.

- [ ] **Backend + frontend build**

```bash
npm run build && (cd client-web && npm run build)
```

- [ ] **Feature flag enabled in production**

- [ ] **6 acceptance scenarios validated in production**

- [ ] **Monitoring dashboards green for 48h**

---

## Summary

- **40+ tasks across 8 phases, ~12.5 person-days**
- **All Phases committed independently** for easy rollback
- **Feature flag protects production** during rollout
- **TDD throughout Phase 1-4** (kernel + Layer 2 + Layer 3)
- **Full acceptance via simulation controller** without needing real Sumsub connection
- **Layer 2/3 cross-cutting cascade** wired via property injection to avoid circular deps

**Design Doc**: `2026-04-09-firm-driven-customer-review-redesign-design.md`

**Deferred items**: Written to `docs/cleanup/deferred-refactors.md` items #6 (policy docs) and #7 (Sumsub event mirror).




