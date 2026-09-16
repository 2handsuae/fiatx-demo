# 审计两页按后端字段重设计 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 后端审计响应补齐有货的列、摘掉死列，管理台审计列表/详情两页按真实字段重排；顺手收三件页内小账（UUID 残口、workflowType 死列、invite 失败分支归因）。

**Architecture:** 单一映射 `mapEvent`（列表详情共用）补列摘列 → 两页前端接口按真实响应重声明重排 → 展示层 strip 收口。写入面只动两处既有调用（DEPOSIT_CREATED currency、invite FAILED 分支），不加新码不动名册。

**Tech Stack:** NestJS + Prisma（后端）｜ React + Tailwind（admin-web）｜ jest ｜ demo-shot.js 走查截图

**Spec:** `doc-final/superpowers/specs/2026-09-16-audit-pages-field-alignment-design.md`（§ 编号引用均指它）

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用（本 plan 末节写死「本任务过哪几条」）
- 本轮特有：
  - 所有 node/npm/npx 命令前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`（本机 shell 默认 node18，判例在档）
  - jest 一律在 `Exchange_js/` 根下跑；若报 DATABASE_URL 缺失，前置 `DATABASE_URL="file:/tmp/exchange_js_main/dev.db"`（判例：jest 缺 DATABASE_URL 假红）
  - 执行在 worktree：目录 `.claude/worktrees/audit_pages_field_alignment`（树名下划线判例）、分支 `audit-pages-field-alignment`、self 栈；起栈必先 `reset`（脏库探针判例）
  - 派 subagent：任务执行与任务级评审 → `sonnet`（省略 model 字段=继承主会话时不适用，此处显式 sonnet）；终审 → 主会话 Fable 不派发。任务 prompt 必须带总纲 CLAUDE.md §0–§5 要点
  - 测试的绿必须来自行为；禁止「扫源码文本」型断言
  - 不动：审计名册/`verify:audit` 判据、子表写入面、`workflowType` DB 列与查询参数（`audit-logs.service.ts:463` where 与 `:654` 起证据导出读用保留）、4 处调用方死参数、旧库污染行（重铺即愈）

---

### Task 1: 后端 `mapEvent` 补列摘列（TDD）

**Files:**
- Modify: `src/modules/audit-logging/audit-logs.service.ts:272-352`（mapEvent / deriveBusinessWorkflow / deriveUserAction）
- Modify: `src/modules/audit-logging/dto/audit-log.dto.ts:92-125`（AuditLogView）
- Test: `src/modules/audit-logging/audit-logs.service.spec.ts`

**Interfaces:**
- Produces（Task 4/5 前端依赖的响应形状）：列表与详情 item 均为新版 `AuditLogView` —— 新增 `category, actionDomain, fromStatus, toStatus, amount, currency, approvalNo, policyCode, policyVersion, beforeData, afterData`（前五个 string|null，policyVersion number|null，before/afterData unknown 已 parseJson）；摘除 `workflowType, businessWorkflow, businessWorkflowLabel`；其余字段原样（`userAction/userActionLabel` 保留）。
- 消费方保护（已核，不需改）：`FundsOrderDetail.tsx` 审计栏与 `scripts/verify-act1.ts` 只读 items 数量/`action`/`occurredAt`/`recordedAt`/subjects。

- [ ] **Step 1: 改写既有测试为新形状（4 处）**

`audit-logs.service.spec.ts` 逐处替换（行号为当前文件，改动后自然漂移）：

① `:148-172` 整个用例替换为：

```ts
  it('should map evidence export request actions to the user-layer action (workflow derivation retired)', async () => {
    prisma.auditLogEvent.count.mockResolvedValue(1);
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'wf-exp-req-1',
        auditNo: 'AUD2604051001',
        action: AuditActions.AUDIT_EVIDENCE_EXPORT_REQUESTED,
        actorType: 'ADMIN',
        actorNo: 'ADMIN-001',
        outcome: AuditOutcome.SUCCESS,
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-04-05T10:00:00.000Z'),
      },
    ]);

    const result = await service.findAll({ take: 20 });

    expect(result.items[0]).toMatchObject({
      userAction: AuditUserActions.REQUEST_CREATED,
      userActionLabel: 'Request Created',
    });
    expect(result.items[0]).not.toHaveProperty('businessWorkflow');
    expect(result.items[0]).not.toHaveProperty('workflowType');
  });
```

② `:305-327`（"should list audit logs and parse json payload fields"）在既有两条 expect 后**追加**：

```ts
    expect(result.items[0].beforeData).toEqual({ status: 'CREATED' });
    expect(result.items[0].afterData).toEqual({ status: 'SUCCESS' });
```

③ `:329-373` 整个用例替换为（组 G/组 H 透传）：

```ts
  it('should pass through group-G/H columns (state transition, money, authorization basis)', async () => {
    prisma.auditLogEvent.count.mockResolvedValue(1);
    prisma.auditLogEvent.findMany.mockResolvedValue([
      {
        id: 'gh-1',
        auditNo: 'AUD2604010001',
        action: AuditActions.APPROVAL_SUBMITTED,
        actorType: 'ADMIN',
        outcome: AuditOutcome.SUCCESS,
        category: 'BUSINESS',
        actionDomain: 'DEPOSIT',
        fromStatus: 'COMPLIANCE_PENDING',
        toStatus: 'SUCCESS',
        amount: '2000',
        currency: 'AED',
        approvalNo: 'APR2609160001',
        policyCode: 'DEPOSIT_SEIZE',
        policyVersion: 3,
        metadata: null,
        beforeData: null,
        afterData: null,
        occurredAt: new Date('2026-04-01T10:00:00.000Z'),
      },
    ]);

    const result = await service.findAll({ take: 20 });

    expect(result.items[0]).toMatchObject({
      category: 'BUSINESS',
      actionDomain: 'DEPOSIT',
      fromStatus: 'COMPLIANCE_PENDING',
      toStatus: 'SUCCESS',
      amount: '2000',
      currency: 'AED',
      approvalNo: 'APR2609160001',
      policyCode: 'DEPOSIT_SEIZE',
      policyVersion: 3,
      userAction: AuditUserActions.SUBMITTED,
      userActionLabel: 'Submitted',
    });
  });
```

④ `:376-402` 整个用例替换为：

```ts
  it('should expose the same aligned shape on detail as on list', async () => {
    prisma.auditLogEvent.findUnique.mockResolvedValue({
      id: 'detail-1',
      auditNo: 'AUD2604010100',
      action: AuditActions.APPROVAL_SUBMITTED,
      traceId: 'trace-role-binding-1',
      actionDomain: 'APPROVAL',
      category: 'GOVERNANCE',
      approvalNo: 'APR2604010001',
      actorType: 'ADMIN',
      outcome: AuditOutcome.SUCCESS,
      metadata: null,
      beforeData: null,
      afterData: null,
      occurredAt: new Date('2026-04-01T12:00:00.000Z'),
    });

    const result = await service.findOne('detail-1');

    expect(result).toMatchObject({
      userAction: AuditUserActions.SUBMITTED,
      userActionLabel: 'Submitted',
      action: AuditActions.APPROVAL_SUBMITTED,
      actionDomain: 'APPROVAL',
      category: 'GOVERNANCE',
      approvalNo: 'APR2604010001',
      traceId: 'trace-role-binding-1',
    });
    expect(result).not.toHaveProperty('businessWorkflowLabel');
  });
```

注意：`:90-129` 的 `AuditBusinessWorkflowTypes` 冻结名册测试**不动**（测的是常量本身，常量不删）；`:404+` 的 keyword 与 `workflowType` 查询过滤测试**不动**（查询侧保留）。若 ①③④ 改完后 `AuditBusinessWorkflowTypes` import 报 unused，保留（名册测试仍用）。

- [ ] **Step 2: 跑测试确认红**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx jest src/modules/audit-logging/audit-logs.service.spec.ts 2>&1 | tail -20
```
预期：①③④ FAIL（`businessWorkflow` 仍在 / 新列 undefined），② FAIL（beforeData 是字符串非对象）。

- [ ] **Step 3: 改 `AuditLogView`（dto/audit-log.dto.ts:92-125 整体替换）**

```ts
export interface AuditLogView {
  id: string;
  eventNo: string;
  userAction: string | null;
  userActionLabel: string | null;
  action: string;
  category: string | null;
  actionDomain: string | null;
  primarySubjectType: string | null;
  primarySubjectNo: string | null;
  traceId: string | null;
  correlationId: string | null;
  causationId: string | null;
  ownerCustomerNo: string | null;
  actorType: string;
  actorNo: string | null;
  actorDisplayName: string;
  /** 当时的角色快照数组（JSON 反序列化）。取代旧单值 actorRole —— 一个人当时可能兼多角色 */
  actorRolesAtTime: string[];
  isReadOnly: boolean;
  fromStatus: string | null;
  toStatus: string | null;
  amount: string | null;
  currency: string | null;
  approvalNo: string | null;
  policyCode: string | null;
  policyVersion: number | null;
  reasonCode: string | null;
  requestId: string | null;
  sourceIp: string | null;
  sourcePlatform: string | null;
  outcome: string | null;
  reason: string | null;
  metadata: unknown;
  beforeData: unknown;
  afterData: unknown;
  payloadDigest: string | null;
  retainedUntil: Date | string | null;
  occurredAt: Date | string;
  recordedAt?: Date | string | null;
  archivedAt?: Date | string | null;
}
```

- [ ] **Step 4: 改 `mapEvent` + 删派生链（audit-logs.service.ts:272-352）**

`mapEvent` 整体替换：

```ts
  private mapEvent(raw: any): AuditLogView {
    const metadata = this.parseJson(raw.metadata);
    const userAction = this.deriveUserAction(raw.action);

    return {
      id: raw.id,
      eventNo: raw.eventNo,
      userAction,
      userActionLabel: this.toDisplayLabel(userAction),
      action: raw.action,
      category: raw.category ?? null,
      actionDomain: raw.actionDomain ?? null,
      primarySubjectType: raw.primarySubjectType ?? null,
      primarySubjectNo: raw.primarySubjectNo ?? null,
      traceId: raw.traceId ?? null,
      correlationId: raw.correlationId ?? null,
      causationId: raw.causationId ?? null,
      ownerCustomerNo: raw.ownerCustomerNo ?? null,
      actorType: raw.actorType,
      actorNo: raw.actorNo ?? null,
      actorDisplayName: raw.actorDisplayName,
      actorRolesAtTime: (() => {
        try { return JSON.parse(raw.actorRolesAtTime ?? '[]'); } catch { return []; }
      })(),
      isReadOnly: raw.isReadOnly ?? false,
      fromStatus: raw.fromStatus ?? null,
      toStatus: raw.toStatus ?? null,
      amount: raw.amount ?? null,
      currency: raw.currency ?? null,
      approvalNo: raw.approvalNo ?? null,
      policyCode: raw.policyCode ?? null,
      policyVersion: raw.policyVersion ?? null,
      reasonCode: raw.reasonCode ?? null,
      requestId: raw.requestId ?? null,
      sourceIp: raw.sourceIp ?? null,
      sourcePlatform: raw.sourcePlatform ?? null,
      outcome: raw.outcome ?? null,
      reason: raw.reason ?? null,
      metadata,
      beforeData: this.parseJson(raw.beforeData),
      afterData: this.parseJson(raw.afterData),
      payloadDigest: raw.payloadDigest ?? null,
      retainedUntil: raw.retainedUntil ?? null,
      occurredAt: raw.occurredAt,
      recordedAt: raw.recordedAt ?? null,
      archivedAt: raw.archivedAt ?? null,
    };
  }
```

`deriveBusinessWorkflow`（:314-326）**整个方法删除**；`deriveUserAction` 收窄为单参：

```ts
  private deriveUserAction(action?: string | null): string | null {
    const normalizedAction = this.normalizeOptionalString(action)?.toUpperCase() || null;
    if (!normalizedAction) {
      return null;
    }

    return mapRawAuditActionToUserAction(normalizedAction) || normalizedAction;
  }
```

`AuditWorkflowTypes` import **保留**（`:666-681` 证据导出流程仍用）。

- [ ] **Step 5: 跑测试确认绿 + 后端 tsc**

```bash
npx jest src/modules/audit-logging 2>&1 | tail -8
npx tsc --noEmit -p tsconfig.json
```
预期：suite 全 PASS；tsc 零错。

- [ ] **Step 6: Commit**

```bash
git add src/modules/audit-logging/audit-logs.service.ts src/modules/audit-logging/dto/audit-log.dto.ts src/modules/audit-logging/audit-logs.service.spec.ts
git commit -m "feat(审计后端): mapEvent 补组G/组H有货列+parseJson before/afterData，摘 workflowType/businessWorkflow 死派生链（spec §2.1）"
```

---

### Task 2: `DEPOSIT_CREATED` 审计 currency 修写入（TDD）

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts:1223`（asset select）、`:1310`（currency 写入）
- Test: `src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts`（`describe('detected')` 块，:1495 起）

**Interfaces:**
- Consumes: 无（独立写入点修正）
- Produces: `DEPOSIT_CREATED` 审计 `currency` 落币种码（`AED`/`USDT`），不再落资产 UUID。三域对称性已核：全仓 `grep "currency: .*assetId"` 唯一命中此处，WITHDRAW_CREATED/SWAP_CREATED 实测已写 `AED` 干净。

- [ ] **Step 1: 补 mock + 写失败测试**

`detected` 的 `beforeEach`（:1505-1509）asset mock 加 `currency`：

```ts
      ((prisma as any).asset.findUnique as jest.Mock).mockResolvedValue({
        id: 'a1',
        type: 'FIAT',
        network: 'AED_ZAND',
        currency: 'AED',
      });
```

在该 describe 末尾新增用例：

```ts
    it('detected(): DEPOSIT_CREATED 审计 currency 落币种码，不落资产 UUID（铁律⑥）', async () => {
      limitRules.getSingleRule.mockResolvedValue(null);
      await service.detected({ assetId: 'a1', toWalletId: 'w1', amount: '100' });
      const call = ((auditLogsService as any).recordSystem as jest.Mock).mock.calls.find(
        (c: any[]) => c[0].action === 'DEPOSIT_CREATED',
      );
      expect(call).toBeDefined();
      expect(call[0].currency).toBe('AED');
    });
```

- [ ] **Step 2: 跑红**

```bash
npx jest src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts -t "currency" 2>&1 | tail -8
```
预期：FAIL——`currency` 实收 `'a1'`（assetId）。

- [ ] **Step 3: 修实现（两行）**

`:1223` asset 查询 select 补 currency：

```ts
    const asset = await (this.prisma as any).asset.findUnique({ where: { id: input.assetId }, select: { id: true, type: true, network: true, currency: true } });
```

`:1310`：

```ts
      currency: asset.currency,
```

- [ ] **Step 4: 跑绿（整文件回归）**

```bash
npx jest src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts 2>&1 | tail -5
```
预期：全 PASS（既有 detected 用例的 asset mock 已带 currency，不受影响）。

- [ ] **Step 5: Commit**

```bash
git add src/modules/trading/deposit-transactions/deposit-transactions.service.ts src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts
git commit -m "fix(充值审计): DEPOSIT_CREATED currency 落币种码不落资产 UUID——金额上屏前拆雷，旧库 119 行污染重铺即愈（spec §2.2）"
```

---

### Task 3: invite 派发失败分支归因（TDD，BACKLOG §H 既有条）

**Files:**
- Modify: `src/modules/identity/users/admin-invite-workflow.service.ts:276`（subjects）、`:286-287`（actor）
- Test: `src/modules/identity/users/admin-invite-workflow.service.spec.ts`（`第一批 · 入职邀请 5 码` describe 内新增）

**Interfaces:**
- Consumes: `ApprovalDecidedEvent`（`approval-handler.base.ts:8`，字段 `approvalNo`/`decisionByUserNo` 均已有）；`inviteSubjects(userNo, approvalNo?)` helper（:59-67，第二参现成）
- Produces: FAILED 派发审计带 PRIMARY+INSTRUMENT 两行子表、actor 用业务号。**范围钉死**：只改 `executeInviteDispatch` 的 catch 分支；`:158`（REQUESTED，审批未生）与 `:378`（EXPIRED cron，无审批上下文）的单参调用是合法形态，不动。

- [ ] **Step 1: 写失败测试**（仿 `:154` 成功派发用例的 mock 形状，加在同 describe 内）：

```ts
    it('派发失败也带 INSTRUMENT 行与业务号 actor：审批单号在手不丢、actorNo 不落 UUID', async () => {
      usersDomainService.findByUserNo.mockResolvedValue({
        id: 'user-1',
        userNo: 'ADM-001',
        email: 'new@fiatx.com',
        status: 'PENDING_INVITE_APPROVAL',
      });
      adminInvitationsService.createInvitationForUser.mockRejectedValue(new Error('smtp down'));

      const event: ApprovalDecidedEvent = {
        decision: 'APPROVED',
        actionType: 'ADMIN_INVITE_APPROVAL',
        entityRef: 'user-1',
        approvalId: 'apr-uuid-1',
        approvalNo: 'APR-1',
        traceId: 'trace-invite-fail-1',
        workflowType: 'ADMIN_INVITE',
        decisionByUserId: 'uuid-ciso-1',
        decisionByUserNo: 'ADM-CISO',
        decisionByRole: 'CISO',
        metadata: {},
      };

      await expect(service.handleApprovalDecided(event)).rejects.toThrow('smtp down');

      const call = auditLogsService.recordByActor.mock.calls.find(
        (c: any[]) => c[0].action === 'ADMIN_INVITE_DISPATCHED' && c[0].outcome === 'FAILED',
      );
      expect(call).toBeDefined();
      expect(call[0].subjects).toEqual([
        { subjectType: 'ACCESS_CONTROL', subjectNo: 'ADM-001', subjectRole: 'PRIMARY' },
        { subjectType: 'APPROVAL_CASE', subjectNo: 'APR-1', subjectRole: 'INSTRUMENT' },
      ]);
      expect(call[1].actorNo).toBe('ADM-CISO');
      expect(call[1].actorDisplayName).toBe('ADM-CISO');
    });
```

- [ ] **Step 2: 跑红**

```bash
npx jest src/modules/identity/users/admin-invite-workflow.service.spec.ts -t "派发失败" 2>&1 | tail -8
```
预期：FAIL——subjects 只有 PRIMARY 一行、actorNo 收到 `'uuid-ciso-1'`。

- [ ] **Step 3: 修实现（3 行）**

`:276`：

```ts
          subjects: this.inviteSubjects(user.userNo, event.approvalNo),
```

`:286-287`：

```ts
          actorNo: event.decisionByUserNo || 'SYSTEM',
          actorDisplayName: event.decisionByUserNo || 'SYSTEM',
```

- [ ] **Step 4: 跑绿（整文件回归）**

```bash
npx jest src/modules/identity/users/admin-invite-workflow.service.spec.ts 2>&1 | tail -5
```
预期：全 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/users/admin-invite-workflow.service.ts src/modules/identity/users/admin-invite-workflow.service.spec.ts
git commit -m "fix(IAM审计): invite 派发失败分支补 INSTRUMENT 行+actor 用业务号——对齐同文件成功/CANCELLED 写法（spec §2.3，BACKLOG §H 销账）"
```

---

### Task 4: 列表页重设计（`AuditLogsPage.tsx`）

**Files:**
- Modify: `admin-web/src/pages/AuditLogsPage.tsx`

**Interfaces:**
- Consumes: Task 1 的新响应形状（`userActionLabel/actionDomain/ownerCustomerNo/actorDisplayName/amount/currency` 现已随列表 items 下发）
- Produces: 无（叶子页面）。选择/导出逻辑（`selectedIds` 用内部 `id` 提交证据包 API）**不动**——是 API 载荷不是屏显。

- [ ] **Step 1: 接口与筛选状态重声明**

`AuditLogItem`（:16-29）整体替换：

```ts
interface AuditLogItem {
  id: string;
  eventNo: string;
  action: string;
  userActionLabel?: string | null;
  actionDomain?: string | null;
  primarySubjectType?: string | null;
  primarySubjectNo?: string | null;
  ownerCustomerNo?: string | null;
  actorType: string;
  actorNo?: string | null;
  actorDisplayName?: string | null;
  outcome: AuditOutcome;
  occurredAt: string;
  amount?: string | null;
  currency?: string | null;
}
```

`workflowType` 从四处摘除：`FilterState`（:60）、`DEFAULT_FILTERS`（:77）、`URL_FILTER_KEYS`（:92）、`buildSearchParams`（:170-172 整段删）；高级筛栏的 Workflow Type `<input>`（:433-438）删除；深链展开条件（:299）里的 `initial.workflowType ||` 删除。其余筛栏（含 traceId、correlationId）全部不动。

- [ ] **Step 2: 表头替换**（:525-536 的列数组）：

```ts
              (
                [
                  ['Time',     '140px'],
                  ['Audit No', '152px'],
                  ['Result',   '84px'],
                  ['Domain',   '96px'],
                  ['Action',   'auto'],
                  ['Entity',   '150px'],
                  ['Owner',    '120px'],
                  ['Actor',    '140px'],
                  ['Amount',   '110px'],
                ] as [string, string][]
              ).map(([label, w]) => (
                <th
                  key={label}
                  style={{ width: w === 'auto' ? undefined : w }}
                  className={[
                    'border-b border-adm-border bg-adm-panel px-3 py-2 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap',
                    label === 'Amount' ? 'text-right' : 'text-left',
                  ].join(' ')}
                >
                  {label}
                </th>
              ))
```

- [ ] **Step 3: 行单元格替换**——Time/Audit No/Result 三格不动；Workflow Type 格（:615-618）与 Trace ID 格（:647-650）删除；Action/Entity No/Entity Type/Actor No 四格替换为下面四格（顺序：Domain → Action → Entity → Owner → Actor → Amount）：

```tsx
                    {/* Domain */}
                    <td className="px-3 py-2.5 font-mono text-[10px] text-adm-t2">
                      {item.actionDomain ?? <span className="text-adm-t3">—</span>}
                    </td>
                    {/* Action — 人话标签为主、码为辅（label 就是码的 Title Case 时不重复显示） */}
                    <td className="max-w-[240px] px-3 py-2.5">
                      <p className="truncate text-[11px] text-adm-t1">{item.userActionLabel ?? item.action}</p>
                      {item.userActionLabel &&
                        item.userActionLabel.replace(/ /g, '_').toUpperCase() !== item.action && (
                          <p className="truncate font-mono text-[9px] text-adm-t3">{item.action}</p>
                        )}
                    </td>
                    {/* Entity — No + Type 合一格 */}
                    <td className="px-3 py-2.5">
                      {item.primarySubjectNo ? (
                        <>
                          {AUDIT_ENTITY_ROUTE_BY_SUBJECT_TYPE[item.primarySubjectType ?? ''] ? (
                            <span
                              className="cursor-pointer font-mono text-[11px] text-adm-blue hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(AUDIT_ENTITY_ROUTE_BY_SUBJECT_TYPE[item.primarySubjectType!]!(item.primarySubjectNo!));
                              }}
                            >
                              {item.primarySubjectNo}
                            </span>
                          ) : (
                            <span className="font-mono text-[11px] text-adm-amber">{item.primarySubjectNo}</span>
                          )}
                          <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-adm-t3">
                            {item.primarySubjectType ?? ''}
                          </p>
                        </>
                      ) : (
                        <span className="text-adm-t3">—</span>
                      )}
                    </td>
                    {/* Owner */}
                    <td className="px-3 py-2.5 font-mono text-[11px] text-adm-t2">
                      {item.ownerCustomerNo ?? <span className="text-adm-t3">—</span>}
                    </td>
                    {/* Actor — 人名 + 号合一格 */}
                    <td className="px-3 py-2.5">
                      <p className="truncate text-[11px] text-adm-t1">
                        {item.actorDisplayName ?? item.actorNo ?? '—'}
                      </p>
                      {item.actorNo && item.actorDisplayName && item.actorNo !== item.actorDisplayName && (
                        <p className="truncate font-mono text-[9px] text-adm-t3">{item.actorNo}</p>
                      )}
                    </td>
                    {/* Amount */}
                    <td className="px-3 py-2.5 text-right font-mono text-[11px] text-adm-t2 whitespace-nowrap">
                      {item.amount ? `${item.amount} ${item.currency ?? ''}`.trim() : <span className="text-adm-t3">—</span>}
                    </td>
```

`colSpan={10}` 两处（Loading/空态）维持 10（勾选框 + 9 列）。

- [ ] **Step 4: tsc**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
```
预期：零错。

- [ ] **Step 5: Commit**

```bash
git add admin-web/src/pages/AuditLogsPage.tsx
git commit -m "feat(审计列表页): 9 列换血——摘死列 Workflow Type/Trace ID，上 Domain/Owner/Amount+人话标签+人名（spec §3）"
```

---

### Task 5: 详情页重设计 + strip 收口（`AuditLogDetailPage.tsx` / `stripInternalIds.ts`）

**Files:**
- Modify: `admin-web/src/pages/AuditLogDetailPage.tsx`
- Modify: `admin-web/src/utils/stripInternalIds.ts:4`

**Interfaces:**
- Consumes: Task 1 的新响应形状
- Produces: 无（叶子页面）。Related Subjects 区（:382-412）与 Raw Record 机制（:140-172）**不动**。

- [ ] **Step 1: `AuditLogDetail` 接口整体替换**（:16-54）：

```ts
interface AuditLogDetail {
  id: string;
  eventNo: string;
  action: string;
  userActionLabel?: string | null;
  category?: string | null;
  actionDomain?: string | null;
  primarySubjectType?: string | null;
  primarySubjectNo?: string | null;
  ownerCustomerNo?: string | null;
  actorType: string;
  actorNo?: string | null;
  actorDisplayName?: string | null;
  actorRolesAtTime?: string[];
  isReadOnly?: boolean;
  outcome: AuditOutcome;
  reason?: string | null;
  reasonCode?: string | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  amount?: string | null;
  currency?: string | null;
  approvalNo?: string | null;
  policyCode?: string | null;
  policyVersion?: number | null;
  occurredAt: string;
  recordedAt?: string | null;
  traceId?: string | null;
  correlationId?: string | null;
  requestId?: string | null;
  sourceIp?: string | null;
  sourcePlatform?: string | null;
  metadata?: unknown;
  beforeData?: unknown;
  afterData?: unknown;
  payloadDigest?: string | null;
  retainedUntil?: string | null;
  archivedAt?: string | null;
  subjects?: { subjectType: string; subjectNo: string; subjectRole: string }[];
}
```

（`causationId` 刻意不声明不渲染——spec §5 残口①。响应仍带它，Raw Record 经 strip 后该键消失。）

- [ ] **Step 2: 派生量与 payloadBlocks 更新**（:239-253）：

```ts
  const hasStateChange = !!(detail.fromStatus || detail.toStatus);
  const hasAuthorization = !!(detail.approvalNo || detail.policyCode || detail.reasonCode);
  const hasPayload = detail.metadata != null || detail.beforeData != null || detail.afterData != null;
  /** PRIMARY 镜像行与上方 Entity 区重复，不进本区；角色固定顺序展示 */
  const ROLE_ORDER = ['OWNER', 'INSTRUMENT', 'RELATED', 'COUNTERPARTY'];
  const relatedSubjects = ROLE_ORDER.flatMap((role) =>
    (detail.subjects ?? []).filter((s) => s.subjectRole === role),
  );
  const hasTrace = !!(detail.traceId || detail.correlationId);

  // 铁律⑥：Payload 三块与 Raw Record 同款过 strip——此前只有 Raw Record 过滤，
  // metadata 里的 approvalId/suspendedByUserId 等内部 id 键从这里裸落屏（残口②）。
  const payloadBlocks = [
    detail.metadata   != null && { title: 'Metadata',    value: stripInternalIds(detail.metadata) },
    detail.beforeData != null && { title: 'Before Data', value: stripInternalIds(detail.beforeData) },
    detail.afterData  != null && { title: 'After Data',  value: stripInternalIds(detail.afterData) },
  ].filter(Boolean) as { title: string; value: unknown }[];
```

- [ ] **Step 3: Hero 区更新**——`userActionLabel` 行去掉 `businessWorkflowLabel` 拼接（:281-285 改为只渲 `detail.userActionLabel`）；Reason 格下方（`{detail.reason && …}` 块之后、状态迁移块之前）插入金额行：

```tsx
              {detail.amount && (
                <div>
                  <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Amount</p>
                  <p className="font-mono text-[15px] font-semibold text-adm-amber">
                    {detail.amount} {detail.currency ?? ''}
                  </p>
                </div>
              )}
```

状态迁移块（:302-319）字段名对真：`detail.statusFrom` → `detail.fromStatus`、`detail.statusTo` → `detail.toStatus`（UI 结构不动）。

- [ ] **Step 4: Actor 区替换**（:322-337）：

```tsx
          <section className="px-6 py-5">
            <Cap>Actor</Cap>
            <p className="mt-1.5 font-mono text-[15px] font-semibold leading-snug text-adm-amber">
              {detail.actorDisplayName ?? detail.actorNo ?? '—'}
            </p>
            {detail.actorNo && detail.actorNo !== detail.actorDisplayName && (
              <p className="mt-0.5 font-mono text-[10px] text-adm-t2">{detail.actorNo}</p>
            )}
            <p className="mt-1 font-mono text-[10px] text-adm-t3">
              {[detail.actorType, ...(detail.actorRolesAtTime ?? [])].filter(Boolean).join(' · ') || '—'}
            </p>
            {(detail.sourcePlatform || detail.sourceIp) && (
              <p className="mt-0.5 font-mono text-[9px] text-adm-t3">
                {[detail.sourcePlatform, detail.sourceIp].filter(Boolean).join(' · ')}
              </p>
            )}
          </section>
```

- [ ] **Step 5: Entity 区 Owner 复活**——`hasOwner` 派生量删除，:369-379 的 Owner 块替换为（Entity 主体渲染不动）：

```tsx
            {detail.ownerCustomerNo && (
              <div className="mt-4 pt-4 border-t border-adm-border">
                <Cap>Owner</Cap>
                <p className="mt-2 font-mono text-[13px] font-semibold">
                  <span
                    className="cursor-pointer text-adm-blue hover:underline"
                    onClick={() => navigate(`/admin/customers/${detail.ownerCustomerNo}`)}
                  >
                    {detail.ownerCustomerNo}
                  </span>
                </p>
              </div>
            )}
```

- [ ] **Step 6: Related Subjects 区之后新增 Authorization 区**（第七幕"依据什么"）：

```tsx
          {/* ── 4 · AUTHORIZATION ──────────────────────────────────
               依据什么：审批单（蓝链跳审批中心）/ 策略 / 原因码。
               组 H 授权依据此前整组不进响应，第七幕"谁批的、依据什么"详情页答不出。 ── */}
          {hasAuthorization && (
            <section className="px-6 py-5">
              <Cap>Authorization</Cap>
              <div className="mt-3">
                <FieldGrid>
                  {detail.approvalNo && (
                    <div>
                      <p className="mb-1 font-mono text-[8.5px] uppercase tracking-[0.14em] text-adm-t3">Approval No</p>
                      <p
                        className="cursor-pointer font-mono text-[11px] font-semibold text-adm-blue hover:underline"
                        onClick={() => navigate(`/admin/governance/approvals/${detail.approvalNo}`)}
                      >
                        {detail.approvalNo}
                      </p>
                    </div>
                  )}
                  <Field
                    label="Policy"
                    value={detail.policyCode
                      ? `${detail.policyCode}${detail.policyVersion != null ? ` · v${detail.policyVersion}` : ''}`
                      : null}
                    mono
                  />
                  <Field label="Reason Code" value={detail.reasonCode} mono />
                </FieldGrid>
              </div>
            </section>
          )}
```

- [ ] **Step 7: Workflow 区改 Trace & Journey**（:414-446）——`hasWorkflow` 换 `hasTrace`；区名 `<Cap>Trace & Journey</Cap>`；`Type`（workflowType）与 `Causation ID` 两个 Field 删除；`Trace ID` Field 与 correlationId journey 块原样保留。

- [ ] **Step 8: Integrity 区替换**（:469-481）：

```tsx
          <section className="px-6 py-5">
            <Cap>Integrity</Cap>
            <div className="mt-3">
              <FieldGrid>
                <Field label="Request ID"     value={detail.requestId}     mono      />
                <Field label="Payload Digest" value={detail.payloadDigest} mono full />
              </FieldGrid>
              {detail.isReadOnly && (
                <div className="mt-3">
                  <AdminBadge value="READ_ONLY" />
                </div>
              )}
            </div>
          </section>
```

- [ ] **Step 9: Sidebar 替换**（:489-506）：

```tsx
          {/* Identity Summary */}
          <SidebarGroup title="Identity Summary">
            <SidebarKV label="Category"    value={detail.category} />
            <SidebarKV label="Domain"      value={detail.actionDomain} />
            <SidebarKV label="Actor Type"  value={detail.actorType} />
            <SidebarKV label="Entity Type" value={detail.primarySubjectType} />
          </SidebarGroup>

          {/* Lifecycle — 真实时间线 */}
          <SidebarGroup title="Lifecycle">
            <SidebarKV label="Occurred"       value={fmt(detail.occurredAt)}    mono />
            <SidebarKV label="Recorded"       value={fmt(detail.recordedAt)}    mono />
            <SidebarKV label="Retained Until" value={fmt(detail.retainedUntil)} mono />
            <SidebarKV label="Archived"       value={fmt(detail.archivedAt)}    mono />
          </SidebarGroup>
```

- [ ] **Step 10: `stripInternalIds.ts:4` 放行名单摘 causationId**（注释同步）：

```ts
/** 铁律⑥展示层过滤（岔口①乙案，2026-09-15 业主拍板）：递归剔除内部 id 形键，
 * 放行旅程/链路标识（页面本就展示的检索键）。只作用于屏上渲染与 Copy——
 * 下载文件保持全量，取证完整性不受影响。
 * causationId 2026-09-16 摘出放行名单：值常是审批内部 UUID（approvalId 作 causation），
 * 读不懂也跳不了（BACKLOG §H UUID 残口①）。 */
const PASSTHROUGH_ID_KEYS = new Set(['traceId', 'correlationId', 'requestId', 'sessionId']);
```

- [ ] **Step 11: tsc**

```bash
cd admin-web && npx tsc -b --noEmit && cd ..
```
预期：零错（若报 `AdminBadge`/`stripInternalIds` 未 import，页顶补 import——AdminBadge 现文件已 import，stripInternalIds 已 import）。

- [ ] **Step 12: Commit**

```bash
git add admin-web/src/pages/AuditLogDetailPage.tsx admin-web/src/utils/stripInternalIds.ts
git commit -m "feat(审计详情页): 幽灵字段清零+状态迁移/Owner/金额复活+Authorization 区，Payload 三块过 strip、causationId 摘放行名单（spec §4/§5）"
```

---

### Task 6: 走查——self 栈重铺 + 四张截图 + SQL 判据

**Files:**
- Create: `doc-final/superpowers/checkups/2026-09-16-audit-pages-walkthrough/`（01-list.png / 02-detail-transition.png / 03-detail-authorization.png / 04-detail-strip-probe.png）

**Interfaces:**
- Consumes: Task 1–5 全部合入本分支；worktree self 栈（端口读本树 `.stackports`：`API_PORT`/`ADMIN_PORT`）
- Produces: 闸⑤物证（永不豁免①）+ spec §6-4/6-6 判据结论

- [ ] **Step 1: 重铺起栈（标准序 reset → up → 等就绪 → demo:all）**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
bash scripts/stack.sh reset self
bash scripts/stack.sh up
cat .stackports    # 记下 API/Admin 端口，下文 <API>/<ADMIN> 代指
bash scripts/on-stack.sh self demo:all
bash scripts/on-stack.sh self verify:audit
```
预期：demo:all 花名册全绿；verify:audit 全绿（名册判据未动，应零波动）。

- [ ] **Step 2: SQL 判据——currency 零污染 + 取截图素材**

```bash
DB=$(ls /tmp/exchange_js_wt_*/dev.db | grep audit_pages || true); DB=${DB:-/tmp/exchange_js_wt_audit_pages_field_alignment/dev.db}
sqlite3 "$DB" "SELECT COUNT(*) FROM audit_log_events WHERE currency LIKE '%-%-%-%-%';"
sqlite3 "$DB" "SELECT eventNo FROM audit_log_events WHERE action='DEPOSIT_APPROVED' AND fromStatus IS NOT NULL LIMIT 1;"
sqlite3 "$DB" "SELECT eventNo FROM audit_log_events WHERE approvalNo IS NOT NULL ORDER BY occurredAt DESC LIMIT 1;"
sqlite3 "$DB" "SELECT eventNo FROM audit_log_events WHERE action='DEPOSIT_CREATED' LIMIT 1;"
```
预期：第一条 = **0**（spec §6-6，重铺后 DEPOSIT_CREATED 全部落币种码）；后三条各取到一个 eventNo，记为 `<EVT_TRANS>`/`<EVT_AUTH>`/`<EVT_PROBE>`。

- [ ] **Step 3: 四张截图（demo-shot.js，缺依赖先 `npm i --no-save puppeteer-core@24`）**

```bash
OUT=doc-final/superpowers/checkups/2026-09-16-audit-pages-walkthrough; mkdir -p $OUT
node scripts/demo-shot.js --api http://127.0.0.1:<API> --as roger@fiatx.com --password 123456 \
  --url http://localhost:<ADMIN>/admin/audit/logs --out $OUT/01-list.png --full-page 1
node scripts/demo-shot.js --api http://127.0.0.1:<API> --as roger@fiatx.com --password 123456 \
  --url http://localhost:<ADMIN>/admin/audit/logs/<EVT_TRANS> --out $OUT/02-detail-transition.png --full-page 1
node scripts/demo-shot.js --api http://127.0.0.1:<API> --as roger@fiatx.com --password 123456 \
  --url http://localhost:<ADMIN>/admin/audit/logs/<EVT_AUTH> --out $OUT/03-detail-authorization.png --full-page 1
node scripts/demo-shot.js --api http://127.0.0.1:<API> --as roger@fiatx.com --password 123456 \
  --url http://localhost:<ADMIN>/admin/audit/logs/<EVT_PROBE> --out $OUT/04-detail-strip-probe.png --full-page 1
```

**逐张肉眼判据**（不达标就回去修，修完从 Task 6 Step 1 重来）：
- `01`：Domain/Owner/Amount 三列有真值；Action 列双行（人话 + 码）；无 "Workflow Type"/"Trace ID" 列；不出现整列 "—" 的死列。
- `02`：Before→After 状态迁移块点亮（如 `COMPLIANCE_PENDING → SUCCESS`）；Amount 行显 `<数> AED/USDT` 无 UUID；Owner 蓝链在场。
- `03`：Authorization 区在场，Approval No 蓝链显示（点击行为已由路由现成保证，截图只证在场与样式）。
- `04`：Payload Metadata 块显示 `fundsOrderNo` 而**无** `fundsOrderId` 键（DEPOSIT_CREATED metadata 天然带 UUID 形键，是 strip 的确定性探针）；Raw Record 区无 `causationId` 键、无 `"id":` 键。

- [ ] **Step 4: Commit 物证**

```bash
git add doc-final/superpowers/checkups/2026-09-16-audit-pages-walkthrough/
git commit -m "test(审计两页走查): 闸⑤物证四张——列表换血/状态迁移+金额/Authorization 区/strip 探针，currency 污染 SQL 判据=0"
```

---

### Task 7: 文档收口 + 销账

**Files:**
- Modify: `doc-final/modules/v1-governance.md`（第七幕段 :51 一带）
- Modify: `doc-final/ui-contract/admin-ui-contract.md`（行号锚）
- Modify: `doc-final/BACKLOG.md`（§H 销 2 条）
- Modify: `doc-final/PRODUCTION-NOTES.md`（追加 1 行）
- Modify: `doc-final/CHANGELOG.md`（1 行）

**Interfaces:**
- Consumes: Task 1–6 的最终落点与截图路径
- Produces: 文档层「现状真相」与台账一致

- [ ] **Step 1: `v1-governance.md` 第七幕段（:51 段落后）补一条 bullet**（措辞可按上下文微调，信息点不减）：

```markdown
- **审计两页按后端真实字段重设计**（2026-09-16）：响应补齐组 G/组 H 有货列（fromStatus/toStatus、amount/currency、approvalNo/policyCode、category/actionDomain、before/afterData），摘除全库零值的 workflowType 死派生链；列表页 9 列换血（Domain/Owner/Amount + 人话标签 + 操作人名，摘 Workflow Type/Trace ID 死列），详情页复活状态迁移块与 Owner、新增 Authorization 区（Approval No 蓝链跳审批中心——"谁批的、依据什么"详情页自此答得出）；Payload 三块与 Raw Record 统一过 stripInternalIds、causationId 摘出放行名单（UUID 残口收口）。DEPOSIT_CREATED 审计 currency 由资产 UUID 改落币种码（写入点拆雷）。物证 `superpowers/checkups/2026-09-16-audit-pages-walkthrough/`。
```

- [ ] **Step 2: `admin-ui-contract.md` 行号锚更新**——两页重排后按新文件实际行号修正这些锚（内容描述不变就只改数字；描述失真则连句改）：`:63`（audit-log hero 的 `detail.action`，原 `AuditLogDetailPage.tsx:263-265`）、`:105`（外壳 `AuditLogsPage.tsx:248` / 详情壳 `AuditLogDetailPage.tsx:218`）、`:154-183`（Cap/FieldGrid/Field/Sidebar 四段 primitive 的行号）。改完 `grep -n "AuditLog" doc-final/ui-contract/admin-ui-contract.md` 逐锚对新文件核一遍行号。

- [ ] **Step 3: `demo/script.md` 第七幕核对**——`grep -n "Workflow Type\|Trace ID\|workflowType" doc-final/demo/script.md`；预核零命中列名，若实际命中（措辞变体）按新列名/新区名同步该步骤文案；零命中则不动（收尾报告注明"核对过、零命中"）。`demo/data.md` 不动（未动种子；生成区只归 demo:all 写）。

- [ ] **Step 4: BACKLOG §H 销 2 条**（保留原文划线 + 补「已修」段，格式照 §H 既有已修条）：
  - 「审计详情页对内部 UUID 的过滤有两个已证/待核的残口」→ 已修（2026-09-16 本轮）：残口① causationId 摘出 `stripInternalIds` 放行名单 + 详情页展示摘除；残口②"待核"定案——直因是 Payload 区 JsonBlock 从不经 strip（Raw Record 才 strip），已改为三块统一过 strip；探针截图 `04-detail-strip-probe.png`。
  - 「invite 派发失败分支漏 INSTRUMENT 行」→ 已修（2026-09-16 本轮）：`:276` 补 `event.approvalNo`，同处 actorNo/actorDisplayName 由 `decisionByUserId` 改 `decisionByUserNo`（顺手同族，spec §2.3）；jest 红绿双证。

- [ ] **Step 5: `PRODUCTION-NOTES.md` 追加一行然后放下**：

```markdown
- 审计 `payloadDigest` 完整性哈希不覆盖 fromStatus/toStatus/amount/approvalNo 等组 G/组 H 列（2026-09-16 两页重设计时发现，防篡改覆盖面部分）
```

- [ ] **Step 6: `CHANGELOG.md` 加一行**（格式照文件既有行）：审计两页按后端真实字段重设计——响应补组 G/组 H、列表 9 列换血、详情 Authorization 区、UUID 残口收口、DEPOSIT_CREATED currency 拆雷。

- [ ] **Step 7: Commit**

```bash
git add doc-final/modules/v1-governance.md doc-final/ui-contract/admin-ui-contract.md doc-final/BACKLOG.md doc-final/PRODUCTION-NOTES.md doc-final/CHANGELOG.md
git commit -m "docs(审计两页重设计): v1-governance 第七幕段+ui-contract 行号锚+BACKLOG 销 2+PRODUCTION-NOTES 1 行+CHANGELOG"
```

---

### Task 8: 收尾闸 + 合并 main

**Files:** 无新改动（闸与合并）

- [ ] **Step 1: 三闸全跑**

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx tsc --noEmit -p tsconfig.json
cd admin-web && npx tsc -b --noEmit && cd ..
cd client-web && npx tsc -b --noEmit && cd ..
npx jest src/modules/audit-logging src/modules/identity/users src/modules/trading/deposit-transactions 2>&1 | tail -6
```
预期：三 tsc 零错、jest 全 PASS。

- [ ] **Step 2: 收尾闸⑥（若 Task 6 之后代码再动过则必跑，否则以 Task 6 结果为准）**

```bash
bash scripts/on-stack.sh self demo:all
bash scripts/on-stack.sh self verify:audit
```

- [ ] **Step 3: 终审**——主会话 Fable 按 `review-rubric.md` 三件事终审（含逐条问"spec 每条承诺的代码在哪"——判例：承诺没代码不产生 diff）。

- [ ] **Step 4: 合并 main + 合并后必做**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
git merge --ff-only audit-pages-field-alignment
npm run db:base:sync        # §10 合并后必做（本轮无权限变更，照惯例跑）
bash scripts/stack.sh reset main   # 主库 119 行 currency UUID 污染行重铺清除，Amount 列上屏不露 UUID
bash scripts/stack.sh up main
bash scripts/on-stack.sh main demo:all
```
预期：demo:all 全绿；随后清 worktree + 分支。

- [ ] **Step 5: 收尾报告**（CLAUDE.md §9）：`Documentation updated: modules§0-4 / demo(核对零命中) / none — 审计两页按后端字段重设计合 main`

---

## 任务收尾「本任务过哪几条」（delivery-checklist，由 plan 写死）

| 触发行 | 判定 | 落点 |
|---|---|---|
| 改了前端 → preview + 截图（**永不豁免①**） | 触发 | Task 6 四张物证 |
| 对外识别用业务键 / 不暴露 UUID | 触发（任务本体） | Task 2/3/5 + 探针截图 04 |
| 改了交易三域任一 → 问另外两域一不一样 | 触发（Task 2 动充值域写入） | 已核：`currency: assetId` 全仓唯一命中充值域；WITHDRAW_CREATED/SWAP_CREATED 实测落 `AED` 干净（spec §2.2 记录） |
| 涉及金额 → 最小单位存、展示层换算 | 触发但免换算 | 审计 `amount` 列既有写入约定即显示单位（实测 600/1200/2000），列表/详情直显；不改写入约定 |
| 改页面 → 同步 demo/script.md + data.md | 触发 | Task 7 Step 3（script.md 核对；data.md 未动种子不触发生成区） |
| 每轮收尾 → 文档分层 + CHANGELOG + BACKLOG | 触发 | Task 7 |
| 任何持久状态变化 → 写审计 | 不新增写点（只修两处既有调用，requestId 均已带） | — |
| 新增审计动作码 / 新状态 / 动了钱（verify:coa）/ maker-checker / 新权限组 / 新端点（db:base:sync）/ 新事件 / 改 schema / 客户面字段 / 多波承接 | 均不触发 | 无新码无新边无记账无 schema 无 client-web 改动，单波任务 |
