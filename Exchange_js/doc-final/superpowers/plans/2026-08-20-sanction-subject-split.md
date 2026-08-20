# 制裁命中分主体 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「客户本人命中制裁」与「对手方命中制裁」在三个交易域走出不同处置 —— 前者冻单 + 冻人，后者只冻单；并给兑换域补上 `FROZEN` 状态，把"人被冻结"从"技术卡单"的布尔旗里拆出来。

**Architecture:** 三段落地。① 信号层把 Sumsub 标签 `SANCTION` 拆成 `SANCTION_APPLICANT` / `SANCTION_COUNTERPARTY`，旧标签直接退役。② 处置层给充值/提现新建"冻人"能力（今天只有兑换有），并把 `cause='SANCTION'` 的便签 `caseRef` 在服务层归一成客户级，保证一个客户永远只有最早的那一张。③ 兑换域新增 `COMPLIANCE_PENDING --FREEZE--> FROZEN` 单条入边的终态，并在服务层做客户面收敛（`FROZEN → REJECTED`），客户端零改动。

**Tech Stack:** NestJS 10 · Prisma 5 (SQLite) · TypeScript · Jest · React (admin-web / client-web)

**Spec:** `doc-final/superpowers/specs/2026-08-20-sanction-subject-split-design.md`

## Global Constraints

以下约束对**每一个** Task 都生效，不再逐条重复：

- **Demo 数据约定**：本系统是 demo，数据可随时格式化重铺（`npm run main:reset:biz`）。**禁止**为旧数据写 backfill、迁移兼容层、双写过渡或向后兼容列。schema/状态机改动直接按目标终态做。唯一例外：`prisma/migrations` 仍按正常流程新增，但迁移内容不必兼容已有行。
- **铁律 ①**：有持久状态、operator 可见的操作 → **必须**写 `AuditLogsService`（DI 注入，禁止 `new`）。
- **铁律 ②**：多表状态变更 → **必须**用 DB transaction。
- **铁律 ③**：有稳定业务键（`customerNo`、`swapNo` 等）→ **禁止**以 `id` 作主查询合同。
- **铁律 ④**：**禁止**绕过 onboarding / compliance 状态门语义。
- **铁律 ⑤**：Workflow **禁止**直接写 domain 实体的 Prisma 表 → 必须通过该 domain 的 service 方法。
- **deliberate fork**：三域的 handler / workflow 是**故意分叉**的（仓库内 20 处成文记录），**禁止**为本轮改动抽公共基类、公共常量或泛型工具。同样的修改在三个域各写一遍。
- **tipping-off 铁律**：制裁相关状态对客户必须**不可区分**。任何执法措辞、任何让客户能自证被调查的接口行为（响应体字段、筛选器返回非空、报错差异）都不允许。
- **分支**：本计划在独立 worktree 的分支上执行（`.claude/worktrees/<名字>/`），栈用 `bash scripts/stack.sh up`（self，自动分端口）。**不在主工作树 `main` 上起服务**。
- **每个 Task 结束必须 commit**，commit message 用中文，格式 `<type>(<scope>): <说明>`。

---

## File Structure

| 文件 | 职责 | Task |
|---|---|---|
| `src/modules/deposit-sumsub/deposit-kyt-verdict.handler.ts` | 充值标签解析：拆标签 + APPLICANT 优先级 | 1 |
| `src/modules/withdraw-sumsub/withdraw-kyt-verdict.handler.ts` | 提现标签解析：同构 | 1 |
| `src/modules/deposit-sumsub/fixtures/verdict-buttons.ts` | 充值 demo 报文：④ 拆成两个按钮 | 2 |
| `src/modules/withdraw-sumsub/fixtures/verdict-buttons.ts` | 提现 demo 报文：同上 | 2 |
| `src/modules/swap-sumsub/fixtures/verdict-buttons.ts` | 兑换 demo 报文：同上 | 2 |
| `admin-web/src/pages/{Deposit,Withdraw,Swap}TransactionDetail.tsx` | 三个模拟按钮下拉 | 2 |
| `src/modules/trading/swap-transactions/swap-workflow.service.ts` | 兑换命门 `includes()` + FROZEN 落地 + 监听器 | 3, 9 |
| `src/modules/identity/customers/constants/restriction-cause.constant.ts` | 因由注册表加 `customerLevel` | 4 |
| `src/modules/identity/customers/customer-restrictions.service.ts` | `openWithin` 归一 caseRef | 4 |
| `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts` | `autoRelease` 配对改 | 4 |
| `src/modules/trading/deposit-transactions/deposit-workflow.service.ts` | 充值冻人 + 监听器补审计 | 5, 7 |
| `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts` | 提现冻人 + 监听器补审计 | 6, 7 |
| `src/modules/trading/swap-transactions/dto/swap-transaction.dto.ts` | FROZEN 状态 + FREEZE 动作 + rejectReason | 8 |
| `src/modules/trading/swap-transactions/swap-transactions.service.ts` | 迁移表 / 两个集合 / 客户面收敛 / customerScope 门 | 8, 10 |
| `src/modules/audit-logging/constants/audit-actions.constant.ts` | 新增 `SWAP_FROZEN` | 8 |
| `test/customer-restrictions.e2e-spec.ts` | 用例⑤ 重写 | 11 |
| `test/sanction-subject-split.e2e-spec.ts` | **新建** 本批验收 | 11 |
| `doc-final/reference/truth/{v4-deposit,v5-withdraw,v6-swap,sumsub-ingestion}.md` | 真相同步 | 12 |
| `doc-final/BACKLOG.md` | 勾掉 :232 | 12 |
| `prisma/seed.business.ts` | Carol 便签 caseRef | 12 |

---

## Task 1: 信号层拆标签 · 充值/提现 handler

**Files:**
- Modify: `src/modules/deposit-sumsub/deposit-kyt-verdict.handler.ts:25,64,80`
- Modify: `src/modules/withdraw-sumsub/withdraw-kyt-verdict.handler.ts:24,66,82`
- Test: `src/modules/deposit-sumsub/deposit-kyt-verdict.handler.spec.ts`
- Test: `src/modules/withdraw-sumsub/withdraw-kyt-verdict.handler.spec.ts`

**Interfaces:**
- Produces: `SceneTag = 'SANCTION_APPLICANT' | 'SANCTION_COUNTERPARTY' | 'PEP'` —— Task 5/6 的 `applyKytRejected(deposit, sceneTag?, dispoTag?)` 签名依赖它。**逐字使用这两个新标签名**，不要写成 `SANCTION_SELF` / `SANCTION_CP` 之类。

> ⚠️ **本 Task 的核心不是改名，是修一个改名会引入的静默 bug。** `sceneTag` 是标量，循环里后写覆盖先写；一笔交易同时命中 `SANCTION_APPLICANT` 和 `SANCTION_COUNTERPARTY` 完全可能（本人在名单上、且转给了受制裁地址），拆完之后哪个生效**取决于 Sumsub 报文里标签的先后顺序** —— "本人命中"有一半概率被静默降级成"只冻单不冻人"。裁决：**APPLICANT 恒优先**。

- [ ] **Step 1: 写失败测试（充值域，优先级）**

在 `src/modules/deposit-sumsub/deposit-kyt-verdict.handler.spec.ts` 末尾、最外层 `describe` 内追加：

```typescript
  it('同时命中 APPLICANT 与 COUNTERPARTY 时，APPLICANT 优先（不受报文顺序影响）', async () => {
    // COUNTERPARTY 排在前面 —— 旧的标量覆盖写法会让 APPLICANT 赢；
    // 反序（见下一个 expect）则会让 COUNTERPARTY 赢。两次都必须是 APPLICANT。
    sumsubTxnClient.getTxn.mockResolvedValue(
      txnDetail([{ label: 'SANCTION_COUNTERPARTY' }, { label: 'SANCTION_APPLICANT' }]),
    );
    await handler.handle({ type: 'applicantKytTxnRejected', kytTxnId: 'kyt-1' });
    expect(workflow.applyKytVerdict).toHaveBeenLastCalledWith(
      'deposit-1',
      expect.objectContaining({ sceneTag: 'SANCTION_APPLICANT' }),
    );

    sumsubTxnClient.getTxn.mockResolvedValue(
      txnDetail([{ label: 'SANCTION_APPLICANT' }, { label: 'SANCTION_COUNTERPARTY' }]),
    );
    await handler.handle({ type: 'applicantKytTxnRejected', kytTxnId: 'kyt-1' });
    expect(workflow.applyKytVerdict).toHaveBeenLastCalledWith(
      'deposit-1',
      expect.objectContaining({ sceneTag: 'SANCTION_APPLICANT' }),
    );
  });

  it('只命中 COUNTERPARTY 时原样传下去', async () => {
    sumsubTxnClient.getTxn.mockResolvedValue(txnDetail([{ label: 'SANCTION_COUNTERPARTY' }]));
    await handler.handle({ type: 'applicantKytTxnRejected', kytTxnId: 'kyt-1' });
    expect(workflow.applyKytVerdict).toHaveBeenLastCalledWith(
      'deposit-1',
      expect.objectContaining({ sceneTag: 'SANCTION_COUNTERPARTY' }),
    );
  });
```

先读该 spec 文件顶部，确认 `txnDetail` / `handler` / `workflow` / `sumsubTxnClient` 这几个变量的**实际名字**（本仓库各 spec 命名不完全一致）；若不同，按该文件的既有写法调整这三个测试里的变量名，**不要**新建 helper。

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/modules/deposit-sumsub/deposit-kyt-verdict.handler.spec.ts -t "APPLICANT 优先"
```

Expected: FAIL —— 收到 `sceneTag: 'SANCTION_COUNTERPARTY'`（第一个断言就挂），因为 `SCENE_TAGS` 里还没有新标签，实际会是 `undefined`。

- [ ] **Step 3: 改充值 handler**

`src/modules/deposit-sumsub/deposit-kyt-verdict.handler.ts:25`，把

```typescript
const SCENE_TAGS = new Set(['SANCTION', 'PEP']);
```

替换为：

```typescript
// 2026-08-20 制裁分主体：SANCTION 拆成 APPLICANT（客户本人 → 冻单+冻人）与
// COUNTERPARTY（对手方 → 只冻单）。旧的 'SANCTION' 直接退役，不留兼容映射
// （demo 约定：不做向后兼容）。
export type SceneTag = 'SANCTION_APPLICANT' | 'SANCTION_COUNTERPARTY' | 'PEP';
const SCENE_TAGS = new Set<SceneTag>(['SANCTION_APPLICANT', 'SANCTION_COUNTERPARTY', 'PEP']);
```

`:64` 的

```typescript
    let sceneTag: 'SANCTION' | 'PEP' | undefined;
```

替换为：

```typescript
    let sceneTag: SceneTag | undefined;
```

`:80` 的

```typescript
          if (SCENE_TAGS.has(tag.label)) sceneTag = tag.label as 'SANCTION' | 'PEP';
```

替换为：

```typescript
          // APPLICANT 恒优先：一笔交易同时命中"本人被制裁"和"对手方被制裁"
          // 是真实场景（本人在名单上、又转给了受制裁地址）。sceneTag 是标量、
          // 循环里后写覆盖先写，若不判优先级则哪个生效取决于 Sumsub 报文里
          // typedTags 的先后顺序 —— "本人命中"有一半概率被静默降级成"只冻单
          // 不冻人"，且无任何日志。漏冻人的代价远大于多冻一次。
          if (SCENE_TAGS.has(tag.label as SceneTag)) {
            if (sceneTag !== 'SANCTION_APPLICANT') sceneTag = tag.label as SceneTag;
          }
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx jest src/modules/deposit-sumsub/deposit-kyt-verdict.handler.spec.ts
```

Expected: PASS（含该文件原有全部用例）。若原有用例里有硬编码 `'SANCTION'` 的断言，一并改成 `'SANCTION_COUNTERPARTY'`（对手方是原语义）。

- [ ] **Step 5: 提现域同样改一遍（deliberate fork，不抽公共常量）**

`src/modules/withdraw-sumsub/withdraw-kyt-verdict.handler.ts:24` 替换为：

```typescript
// 2026-08-20 制裁分主体：与 deposit-kyt-verdict.handler.ts 同构（deliberate
// fork，不抽公共常量）。SANCTION 拆成 APPLICANT / COUNTERPARTY，旧标签退役。
export type SceneTag = 'SANCTION_APPLICANT' | 'SANCTION_COUNTERPARTY' | 'PEP';
const SCENE_TAGS = new Set<SceneTag>(['SANCTION_APPLICANT', 'SANCTION_COUNTERPARTY', 'PEP']);
```

`:66` 替换为 `    let sceneTag: SceneTag | undefined;`

`:82` 替换为（与充值逐字同款，含注释）：

```typescript
          // APPLICANT 恒优先 —— 理由见 deposit-kyt-verdict.handler.ts 同名分支。
          if (SCENE_TAGS.has(tag.label as SceneTag)) {
            if (sceneTag !== 'SANCTION_APPLICANT') sceneTag = tag.label as SceneTag;
          }
```

在 `withdraw-kyt-verdict.handler.spec.ts` 里追加 Step 1 的三个测试（把 `deposit-1` 换成该 spec 里的 withdraw id 变量、`depositService` 换成 `withdrawService`）。

- [ ] **Step 6: 跑两域测试**

```bash
npx jest src/modules/deposit-sumsub src/modules/withdraw-sumsub
```

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/modules/deposit-sumsub/deposit-kyt-verdict.handler.ts src/modules/deposit-sumsub/deposit-kyt-verdict.handler.spec.ts src/modules/withdraw-sumsub/withdraw-kyt-verdict.handler.ts src/modules/withdraw-sumsub/withdraw-kyt-verdict.handler.spec.ts
git commit -m "feat(compliance): 充值/提现标签层拆 SANCTION_APPLICANT/COUNTERPARTY,APPLICANT 恒优先"
```

---

## Task 2: 信号层拆标签 · demo 报文与 admin 入口

**Files:**
- Modify: `src/modules/deposit-sumsub/fixtures/verdict-buttons.ts:97-112`
- Modify: `src/modules/withdraw-sumsub/fixtures/verdict-buttons.ts:91-106`
- Modify: `src/modules/swap-sumsub/fixtures/verdict-buttons.ts:67-80`
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx:43`
- Modify: `admin-web/src/pages/WithdrawTransactionDetail.tsx:43`
- Modify: `admin-web/src/pages/SwapTransactionDetail.tsx:29`
- Test: `src/modules/swap-sumsub/fixtures/verdict-buttons.spec.ts`

**Interfaces:**
- Consumes: Task 1 的两个新标签名。
- Produces: fixture key `V4_REJECTED_SANCTION_APPLICANT` 与 `V4B_REJECTED_SANCTION_COUNTERPARTY` —— Task 11 的 e2e 按 key 投递报文。

> 三个 fixtures + 三个 admin 页面共 6 处，是**业主走查的唯一入口**。漏改任何一处，那个域就演不出新场景。

- [ ] **Step 1: 改充值 fixtures**

`src/modules/deposit-sumsub/fixtures/verdict-buttons.ts`，把整个 `V4_REJECTED_SANCTION` 块（`:97-112`）替换为两块：

```typescript
  V4_REJECTED_SANCTION_APPLICANT: {
    key: 'V4_REJECTED_SANCTION_APPLICANT',
    label: '④ Rejected · Sanctions（客户本人）',
    webhookType: 'applicantKytTxnRejected',
    verdict: {
      reviewStatus: 'completed',
      reviewAnswer: 'RED',
      action: 'reject',
      score: 98,
      reviewRejectType: 'FINAL',
      matchedRules: [
        RULE('AML1', 'Sanctions match (applicant)', 98, 'reject', 'The customer themselves matches an OFAC SDN sanctions list entry.'),
      ],
      typedTags: [TAG('SANCTION_APPLICANT')],
    },
  },

  V4B_REJECTED_SANCTION_COUNTERPARTY: {
    key: 'V4B_REJECTED_SANCTION_COUNTERPARTY',
    label: '④B Rejected · Sanctions（对手方）',
    webhookType: 'applicantKytTxnRejected',
    verdict: {
      reviewStatus: 'completed',
      reviewAnswer: 'RED',
      action: 'reject',
      score: 98,
      reviewRejectType: 'FINAL',
      matchedRules: [
        RULE('AML1', 'Sanctions match (counterparty)', 98, 'reject', 'Counterparty address matches an OFAC SDN sanctions list entry.'),
      ],
      typedTags: [TAG('SANCTION_COUNTERPARTY')],
    },
  },
```

- [ ] **Step 2: 改提现 fixtures**

`src/modules/withdraw-sumsub/fixtures/verdict-buttons.ts:91-106` 的 `V4_REJECTED_SANCTION` 块，用与 Step 1 **逐字相同**的两块替换（该文件的 `RULE`/`TAG` helper 与充值同名同签名，直接复制即可）。

- [ ] **Step 3: 改兑换 fixtures**

`src/modules/swap-sumsub/fixtures/verdict-buttons.ts:67-80` 的 `V4_REJECTED_SANCTION` 块替换为：

```typescript
  V4_REJECTED_SANCTION_APPLICANT: {
    key: 'V4_REJECTED_SANCTION_APPLICANT',
    label: '④ Rejected · Sanctions（客户本人）',
    webhookType: 'applicantKytTxnRejected',
    verdict: {
      reviewAnswer: 'RED',
      score: 100,
      typedTags: [TAG('SANCTION_APPLICANT')],
      // 同 V3_REJECTED_ACTION 的 getter 注记：现铸而非固定字面量。
      get applicantActions() {
        return [{ applicantActionId: `demo-action-${randomUUID()}`, externalActionId: `demo-ext-${randomUUID()}` }];
      },
    },
  },
  V4B_REJECTED_SANCTION_COUNTERPARTY: {
    key: 'V4B_REJECTED_SANCTION_COUNTERPARTY',
    label: '④B Rejected · Sanctions（对手方）',
    webhookType: 'applicantKytTxnRejected',
    verdict: {
      reviewAnswer: 'RED',
      score: 100,
      typedTags: [TAG('SANCTION_COUNTERPARTY')],
      get applicantActions() {
        return [{ applicantActionId: `demo-action-${randomUUID()}`, externalActionId: `demo-ext-${randomUUID()}` }];
      },
    },
  },
```

- [ ] **Step 4: 改三个 admin 详情页的按钮数组**

`admin-web/src/pages/SwapTransactionDetail.tsx:29`，把

```typescript
  { key: 'V4_REJECTED_SANCTION', label: '④ Rejected · Sanctions' },
```

替换为两行：

```typescript
  { key: 'V4_REJECTED_SANCTION_APPLICANT', label: '④ Rejected · Sanctions（客户本人）' },
  { key: 'V4B_REJECTED_SANCTION_COUNTERPARTY', label: '④B Rejected · Sanctions（对手方）' },
```

`admin-web/src/pages/DepositTransactionDetail.tsx:43` 和 `admin-web/src/pages/WithdrawTransactionDetail.tsx:43` 做**同样**的两行替换。

- [ ] **Step 5: 修补引用旧 key 的 spec**

```bash
grep -rn "V4_REJECTED_SANCTION\b" src test
```

把所有命中改成 `V4_REJECTED_SANCTION_APPLICANT`（这些用例原本演的是"制裁命中"，语义上归属本人主体；`test/swap-sumsub-scenarios.e2e-spec.ts:512` 那条断言 `cause === 'SANCTION'` **不要动** —— 那是因由不是标签）。

- [ ] **Step 6: 跑 fixtures 单测 + 全量 tsc**

```bash
npx jest src/modules/swap-sumsub/fixtures/verdict-buttons.spec.ts && npx tsc --noEmit -p tsconfig.json
```

Expected: PASS + tsc 0 错。

- [ ] **Step 7: Commit**

```bash
git add src/modules/deposit-sumsub/fixtures src/modules/withdraw-sumsub/fixtures src/modules/swap-sumsub/fixtures admin-web/src/pages/DepositTransactionDetail.tsx admin-web/src/pages/WithdrawTransactionDetail.tsx admin-web/src/pages/SwapTransactionDetail.tsx test
git commit -m "feat(compliance): 三域 demo 报文与 admin 模拟入口拆成本人/对手方两个按钮"
```

---

## Task 3: 兑换命门 —— `includes('SANCTION')` 与钉死测试

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts:872`
- Test: `src/modules/trading/swap-transactions/swap-workflow.service.spec.ts`（若不存在则新建）

**Interfaces:**
- Consumes: Task 1 的标签名。
- Produces: 无新接口。

> ⚠️ **这一行是全批唯一没有类型保护的地方。** 它吃的是 handler 已经 map 成 `string[]` 的 `typedTags`，`includes` 对任意字符串都合法，**TypeScript 抓不到**。漏改的后果是连锁的：`hasSanction=false` → `restrictionCause` 掉进 `KYT_REJECTED_SOFT` → `markHardLineDisposition` 不盖章 → 走软线 → **开一个面向客户的补料请求** → 客户被告知"请补充材料" = tipping-off，整条合规防线失效，而且构建全绿、测试全绿、没有任何日志。

- [ ] **Step 1: 写失败测试**

新建或追加到 `src/modules/trading/swap-transactions/swap-workflow.service.spec.ts`：

```typescript
describe('handleRejectDisposition · 制裁主体判定（命门）', () => {
  it('SANCTION_APPLICANT → cause=SANCTION，且不暴露补料入口', async () => {
    await service.handleRejectDisposition(swapRow, {
      verdict: 'rejected',
      typedTags: ['SANCTION_APPLICANT'],
      applicantActions: [{ applicantActionId: 'a1', externalActionId: 'e1' }],
    });
    expect(customerRestrictionsService.open).toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'SANCTION' }),
    );
    // tipping-off：命中制裁绝不能登记面向客户的材料请求
    expect(materialRequestIssuer.register).not.toHaveBeenCalled();
  });

  it('SANCTION_COUNTERPARTY → 不是硬线制裁，走软线（有 action 时暴露补料入口）', async () => {
    await service.handleRejectDisposition(swapRow, {
      verdict: 'rejected',
      typedTags: ['SANCTION_COUNTERPARTY'],
      applicantActions: [{ applicantActionId: 'a1', externalActionId: 'e1' }],
    });
    expect(customerRestrictionsService.open).toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'KYT_REJECTED_SOFT' }),
    );
  });

  it('旧标签 SANCTION 已退役 —— 不得再被识别成制裁', async () => {
    await service.handleRejectDisposition(swapRow, {
      verdict: 'rejected',
      typedTags: ['SANCTION'],
      applicantActions: [{ applicantActionId: 'a1', externalActionId: 'e1' }],
    });
    expect(customerRestrictionsService.open).not.toHaveBeenCalledWith(
      expect.objectContaining({ cause: 'SANCTION' }),
    );
  });
});
```

若该 spec 文件不存在，参照 `src/modules/swap-sumsub/swap-kyt-verdict.handler.spec.ts` 的 `Test.createTestingModule` 写法搭建：mock 掉 `PrismaService`、`AuditLogsService`、`CustomerRestrictionsService`、`CustomersService`（`hasHardLineDisposition` 返回 `false`）、材料请求 issuer。`swapRow` 用 `{ id: 'swap-1', swapNo: 'SW-1', ownerId: 'cust-1', ownerNo: 'C0001', traceId: 't1', status: 'COMPLIANCE_PENDING' }`。

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/modules/trading/swap-transactions/swap-workflow.service.spec.ts -t "命门"
```

Expected: 第一个用例 FAIL —— `open` 被以 `cause: 'KYT_REJECTED_SOFT'` 调用（因为 `includes('SANCTION')` 对 `'SANCTION_APPLICANT'` 返回 false）。

- [ ] **Step 3: 改那一行**

`src/modules/trading/swap-transactions/swap-workflow.service.ts:872`，把

```typescript
      const hasSanction = (input.typedTags ?? []).includes('SANCTION');
```

替换为：

```typescript
      // 2026-08-20 制裁分主体：只有「客户本人命中」才算硬线制裁。对手方命中
      // （SANCTION_COUNTERPARTY）按普通拒绝走软/硬线判定。
      //
      // ⚠️ 这一行是 string[] 上的 includes，TypeScript 抓不到写错的标签名。
      // 写错 → hasSanction 恒 false → restrictionCause 掉进 KYT_REJECTED_SOFT
      // → markHardLineDisposition 不盖章 → 走软线开出面向客户的补料请求
      // → 客户被告知"请补充材料" = tipping-off，而构建和测试全绿、零日志。
      // swap-workflow.service.spec.ts 的「命门」用例组就是为钉死这一行存在的，
      // 改这里必须同步看那组测试。
      const hasSanction = (input.typedTags ?? []).includes('SANCTION_APPLICANT');
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx jest src/modules/trading/swap-transactions/swap-workflow.service.spec.ts
```

Expected: PASS（三个用例全绿）。

- [ ] **Step 5: Commit**

```bash
git add src/modules/trading/swap-transactions/swap-workflow.service.ts src/modules/trading/swap-transactions/swap-workflow.service.spec.ts
git commit -m "fix(compliance): 兑换制裁判定改认 SANCTION_APPLICANT,并加测试钉死这一行"
```

---

## Task 4: `caseRef` 客户级归一（服务层收口）

**Files:**
- Modify: `src/modules/identity/customers/constants/restriction-cause.constant.ts:26-46`
- Modify: `src/modules/identity/customers/customer-restrictions.service.ts:161-166`
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts:191`
- Test: `src/modules/identity/customers/customer-restrictions.service.spec.ts`

**Interfaces:**
- Produces: `RestrictionCausePolicy.customerLevel: boolean` —— Task 5/6/11 依赖"同一客户同一 cause 只有一张 OPEN"这条不变量。

> **为什么在服务层收口而不是让每个调用方传 customerNo**：本仓库有一条成文教训（`deposit-transactions.service.ts:82-91`）——"黑名单/白名单必然滞后：只要没人记得手工同步，新增的那条就会漏"。让 5 个调用方各自记得传客户级 caseRef 是同一种会滞后的设计。归一放在 `openWithin` 里，**结构上**保证不漏。
>
> **⚠️ `caseRef: null` 不是"客户级去重"，是"完全不去重"**（`customer-restrictions.service.ts:165` 的既有注释：给运营开多张 PENDING_DOCUMENT 用）。所以归一的目标值必须是**具体字符串**，取 `customerNo`。

- [ ] **Step 1: 写失败测试**

追加到 `src/modules/identity/customers/customer-restrictions.service.spec.ts`：

```typescript
  it('SANCTION 是客户级因由：不同 caseRef 的第二次 open 不再贴新条子', async () => {
    const first = await service.open({
      customerId: 'cust-1', cause: 'SANCTION', reason: 'CRA 命中', caseRef: 'ASSESSMENT-1', openedBy: 'SYSTEM',
    });
    expect(first.created).toBe(true);

    const second = await service.open({
      customerId: 'cust-1', cause: 'SANCTION', reason: '充值单 DEP-1 命中', caseRef: 'DEP-1', openedBy: 'SYSTEM',
    });
    expect(second.created).toBe(false);
    expect(second.restrictionNo).toBe(first.restrictionNo);
  });

  it('非客户级因由（KYT_REJECTED_SOFT）仍按单号各贴一张', async () => {
    const a = await service.open({
      customerId: 'cust-1', cause: 'KYT_REJECTED_SOFT', reason: 'SW-1', caseRef: 'SW-1', openedBy: 'system',
    });
    const b = await service.open({
      customerId: 'cust-1', cause: 'KYT_REJECTED_SOFT', reason: 'SW-2', caseRef: 'SW-2', openedBy: 'system',
    });
    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(b.restrictionNo).not.toBe(a.restrictionNo);
  });
```

若该 spec 不存在，用 e2e 方式验证（放进 Task 11 的新 e2e 文件），本 Step 改为在 Task 11 里补断言 —— 但**不要跳过验证**。

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/modules/identity/customers/customer-restrictions.service.spec.ts -t "客户级因由"
```

Expected: FAIL —— `second.created` 是 `true`（两个不同 caseRef 各贴一张）。

- [ ] **Step 3: 因由注册表加 `customerLevel`**

`src/modules/identity/customers/constants/restriction-cause.constant.ts`，在 `RestrictionCausePolicy` 接口里（`scopeSelectable` 之后）加一个字段：

```typescript
  /**
   * R4（2026-08-20 制裁分主体）：该因由描述的是「这个人的状态」而非「这笔单的处置」。
   * 为 true 时 openWithin 会把 caseRef 归一成 customerNo —— 于是同一客户无论被
   * 几条路径、几笔单牵出来，永远只有最早的那一张 OPEN 便签，MLRO 只需解一次。
   * 哪笔单牵出来的由 reason 字段与审计日志承载，不靠 caseRef 记。
   */
  customerLevel: boolean;
```

然后给**全部 7 个** cause 补上这个字段：`SANCTION` 为 `true`，其余六个（`ADMIN_SUSPENSION`、`MATERIAL_EXPIRED`、`TIER_UPGRADE_PENDING`、`KYT_REJECTED_SOFT`、`KYT_REJECTED_HARD`、`PENDING_DOCUMENT`）一律 `false`。TypeScript 会因缺字段报错，逐个补齐即可。

`SANCTION` 那条改完长这样：

```typescript
  SANCTION: {
    defaultScopes: ['ALL'],
    visibility: 'SILENT',
    releasePolicy: 'MLRO_APPROVAL',
    scopeSelectable: false,
    customerLevel: true,
    customerLabel: '',
  },
```

- [ ] **Step 4: 在 `openWithin` 里归一**

`src/modules/identity/customers/customer-restrictions.service.ts`，在 `:161-165`（`const customer = await tx.customerMain.findUnique(...)` 与 `if (!customer) throw ...` 之后、`if (caseRef !== null)` 之前）插入：

```typescript
    // R4：客户级因由（今天只有 SANCTION）把 caseRef 归一成 customerNo。
    // 归一放在服务层而不是让每个调用方记得传 —— 调用方有 5 处（CRA / Sumsub
    // MLRO / 兑换 / 充值 / 提现），靠约定必然滞后（同 deposit-transactions.
    // service.ts:82 那段关于白名单滞后的教训）。归一后同一客户同一 cause 永远
    // 只有最早的那一张 OPEN，第 2..N 次命中 created=false、不广播、但仍写一条
    // result=SKIPPED 的审计，可取证。
    // ⚠️ 不能用 null 表达「客户级」—— null 在下面的分支里是「完全不去重」。
    const effectiveCaseRef = policy.customerLevel ? customer.customerNo : caseRef;
```

然后把该方法后续用到 `caseRef` 的**三处**全部改成 `effectiveCaseRef`：
1. `if (caseRef !== null) {` → `if (effectiveCaseRef !== null) {`
2. 去重查询里的 `caseRef,` → `caseRef: effectiveCaseRef,`
3. `createMany` 的 `data` 里 `caseRef,` → `caseRef: effectiveCaseRef,`

- [ ] **Step 5: 跑测试确认通过**

```bash
npx jest src/modules/identity/customers/customer-restrictions.service.spec.ts
```

Expected: PASS。

- [ ] **Step 6: 配对改 `autoRelease`（不改则解冻静默失效）**

`src/modules/sumsub-ingestion/sumsub-ingestion.service.ts:188-196`，把

```typescript
          // 自动撕：cause + caseRef 双键，只撕 CRA 制裁路径用同一 assessmentId
          // 贴的那张 SANCTION。客户身上材料/升级等别的便签一概不动。
          await this.restrictionWorkflowService.autoRelease(
            customerId,
            'SANCTION',
            assessmentId,
            'SYSTEM',
          );
```

替换为：

```typescript
          // 自动撕：只撕这个客户的 SANCTION 便签，材料/升级等别的因由一概不动。
          //
          // ⚠️ caseRef 传 null 是刻意的，不是漏传：2026-08-20 起 SANCTION 是
          // 客户级因由（restriction-cause.constant.ts R4），openWithin 把它的
          // caseRef 归一成 customerNo，这里再按 assessmentId 精确匹配会永远
          // 找不到 —— findOpenByCause 找不到时只 logger.log 一行就 return，
          // 于是 MLRO 明明批准了、客户却还被冻着，且不报错。
          // findOpenByCause(caseRef=null) 的语义正是"不限 caseRef、取该 cause
          // 下最早一张 OPEN"（见该方法的文档注释），就是为自动撕设计的。
          await this.restrictionWorkflowService.autoRelease(
            customerId,
            'SANCTION',
            null,
            'SYSTEM',
          );
```

- [ ] **Step 7: 确认 autoRelease 的 caseRef 形参可空**

```bash
sed -n '250,262p' src/modules/identity/customers/customer-restriction-workflow.service.ts
```

Expected: 形参已是 `caseRef: string | null`。若不是，把它改成可空（`findOpenByCause` 的第三参已经是 `string | null`）。

- [ ] **Step 8: 全量 tsc**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: 0 错。

- [ ] **Step 9: Commit**

```bash
git add src/modules/identity/customers src/modules/sumsub-ingestion/sumsub-ingestion.service.ts
git commit -m "feat(compliance): SANCTION 改客户级因由,caseRef 服务层归一 customerNo,autoRelease 配对改 null"
```

---

## Task 5: 充值域冻人

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts:87`（构造函数）、`:759-790`（`applyKytRejected`）、`:325-335`（`applyKytVerdict` 入参类型）、`:585`（中间层签名）
- Test: Task 11 的 e2e

**Interfaces:**
- Consumes: Task 1 的 `SceneTag`；Task 4 的客户级 caseRef 不变量。
- Produces: 充值域 `SANCTION_APPLICANT → 冻单 + 冻人` 行为。

> **今天充值域根本没有冻人能力。** 全库 grep 证实 `customerRestrictionsService.open()` 在整个 `src/modules/trading/` 下只有兑换调用 —— 充值/提现对客户限制是纯消费者（只订阅事件冻单），从来不是生产者。这是新建能力，不是改标签名。
>
> **好消息**：模块接线已全通（`deposit-transactions.module.ts:25` 已有 `forwardRef(() => CustomersModule)`，`customers.module.ts:50` 已导出 `CustomerRestrictionsService`）。**只加构造函数参数，不要动模块 imports、不要新增 forwardRef** —— 本项目有 `CustomersModule` 三处 forwardRef 成环的旧伤。

- [ ] **Step 1: 注入 service**

`src/modules/trading/deposit-transactions/deposit-workflow.service.ts` 顶部 import 区加：

```typescript
import { CustomerRestrictionsService } from '../../identity/customers/customer-restrictions.service';
```

构造函数（`:87` 起的参数列表）末尾加一个参数：

```typescript
    private readonly customerRestrictionsService: CustomerRestrictionsService,
```

- [ ] **Step 2: 放宽 sceneTag 的三处联合类型**

把 `:330`、`:585`、`:761` 三处的

```typescript
sceneTag?: 'SANCTION' | 'PEP',
```

（`:330` 是对象字面量里的 `sceneTag?: 'SANCTION' | 'PEP';`，注意行尾是分号）统一改成引用 Task 1 导出的类型：

```typescript
import type { SceneTag } from '../../deposit-sumsub/deposit-kyt-verdict.handler';
```

三处分别改为 `sceneTag?: SceneTag,` / `sceneTag?: SceneTag;`。

- [ ] **Step 3: 改制裁分支（先冻人、再冻单）**

`:764` 起的整个第一支替换为：

```typescript
    const isApplicantSanction = sceneTag === 'SANCTION_APPLICANT';
    if (
      isApplicantSanction ||
      sceneTag === 'SANCTION_COUNTERPARTY' ||
      dispoTag === 'FROZEN_BY_MLRO'
    ) {
      if (deposit.status === DepositTransactionStatus.FROZEN) return; // 已在目标态,防重复 webhook

      // 客户本人命中 → 先冻人、再冻单。
      //
      // 顺序是 load-bearing 的：两者分属两次独立提交（open() 自开
      // $transaction，updateStatus 是独立 update），中途崩溃必然留半成品。
      // 先冻人的残局是「人冻了、单没冻」—— open() 广播 CUSTOMER_RESTRICTION_OPENED
      // 会被本域自己的 onCustomerRestrictionOpened 接住,把在途单（含这一笔）
      // 冻掉，能自愈。反过来「单冻了、人没冻」客户还能开新单，方向危险。
      // 不要因为"看起来能合并"或"先改状态更直觉"调换。
      if (isApplicantSanction) {
        await this.customerRestrictionsService.open({
          customerId: deposit.ownerId,
          cause: 'SANCTION',
          reason: `Deposit ${deposit.depositNo} KYT rejected: applicant sanctioned`,
          // caseRef 传单号只为可读；SANCTION 是客户级因由，openWithin 会归一成
          // customerNo（restriction-cause.constant.ts R4）。哪笔单牵出来的由上面
          // 的 reason 和审计承载。
          caseRef: deposit.depositNo,
          openedBy: 'system',
        });
      }

      await this.depositService.updateStatus(
        deposit.id,
        { action: DepositTransactionAction.FREEZE, reason: 'KYT verdict: rejected' },
        {
          actor: { actorType: 'SYSTEM', actorId: 'KYT_VERDICT' },
          sourcePlatform: 'SYSTEM',
        },
      );
      // 校正:FROZEN 零记账——钱留在 DEPOSIT_SUSPENSE,不释放/不过账。
      await this.auditLogsService.recordSystem({
        action: AuditActions.DEPOSIT_FROZEN,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id,
        entityNo: deposit.depositNo,
        entityOwnerType: deposit.ownerType,
        entityOwnerId: deposit.ownerId,
        traceId: deposit.traceId || undefined,
        workflowType: 'DEPOSIT',
        reason: isApplicantSanction
          ? 'KYT verdict rejected: SANCTION_APPLICANT hit (order frozen + customer restricted)'
          : sceneTag === 'SANCTION_COUNTERPARTY'
            ? 'KYT verdict rejected: SANCTION_COUNTERPARTY hit (order frozen only)'
            : 'KYT verdict rejected: FROZEN_BY_MLRO disposition',
        sourcePlatform: 'SYSTEM',
      });
      return;
    }
```

> ⚠️ 注意 `updateStatus` 抛异常时不要吞：`applyKytRejected` 的调用方已在 `applyKytVerdict` 里，异常上抛会让 webhook 重试 —— 这是期望行为。**但 `open()` 已经成功了**，重试时 `created=false` 幂等，不会贴第二张。

- [ ] **Step 4: 跑编译**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: 0 错。若报 `CustomerRestrictionsService` 循环依赖，**不要**加 `forwardRef` 到模块图 —— 先确认 `deposit-transactions.module.ts:25` 的 `forwardRef(() => CustomersModule)` 确实在，且 `customers.module.ts` 的 `exports` 里有 `CustomerRestrictionsService`。

- [ ] **Step 5: 起栈冒烟**

```bash
bash scripts/stack.sh up
```

Expected: 后端起来无 Nest DI 报错（循环依赖会在启动时炸，不是编译期）。

- [ ] **Step 6: Commit**

```bash
git add src/modules/trading/deposit-transactions/deposit-workflow.service.ts
git commit -m "feat(compliance): 充值域接冻人,SANCTION_APPLICANT 先冻人再冻单"
```

---

## Task 6: 提现域冻人（对称）

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts` 构造函数、`:2315`/`:2489`/`:2654` 三处类型、`:2657-2680` 制裁分支、`:2174` 陈旧注释
- Test: Task 11 的 e2e

**Interfaces:**
- Consumes: 同 Task 5。
- Produces: 提现域 `SANCTION_APPLICANT → 冻单 + 冻人`。

- [ ] **Step 1: 注入 service**

顶部 import 加：

```typescript
import { CustomerRestrictionsService } from '../../identity/customers/customer-restrictions.service';
import type { SceneTag } from '../../withdraw-sumsub/withdraw-kyt-verdict.handler';
```

构造函数参数列表末尾加：

```typescript
    private readonly customerRestrictionsService: CustomerRestrictionsService,
```

- [ ] **Step 2: 放宽三处联合类型**

`:2315`（对象字面量，行尾分号）、`:2489`、`:2654` 三处 `sceneTag?: 'SANCTION' | 'PEP'` 改成 `sceneTag?: SceneTag`。

- [ ] **Step 3: 改制裁分支**

`:2657` 起的第一支替换为：

```typescript
    const isApplicantSanction = sceneTag === 'SANCTION_APPLICANT';
    if (
      isApplicantSanction ||
      sceneTag === 'SANCTION_COUNTERPARTY' ||
      dispoTag === 'FROZEN_BY_MLRO'
    ) {
      if (w.status === WithdrawTransactionStatus.FROZEN) return; // already frozen — repeat webhook

      // 先冻人、再冻单 —— 顺序 load-bearing，理由见 deposit-workflow.service.ts
      // 同名分支的注释（deliberate fork，两域各写一遍，不抽公共方法）。
      if (isApplicantSanction) {
        await this.customerRestrictionsService.open({
          customerId: w.ownerId,
          cause: 'SANCTION',
          reason: `Withdrawal ${w.withdrawNo} KYT rejected: applicant sanctioned`,
          caseRef: w.withdrawNo,
          openedBy: 'system',
        });
      }

      await this.withdrawService.updateStatus(
        w.id,
        { action: WithdrawTransactionAction.FREEZE, reason: 'KYT verdict: rejected' },
        this.systemCtx,
      );
      await this.auditLogsService.recordSystem({
        action: AuditActions.WITHDRAW_FROZEN,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: w.id,
        entityNo: w.withdrawNo,
        entityOwnerType: w.ownerType,
        entityOwnerId: w.ownerId,
        traceId: w.traceId || undefined,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        reason: isApplicantSanction
          ? 'KYT verdict rejected: SANCTION_APPLICANT hit (order frozen + customer restricted)'
          : sceneTag === 'SANCTION_COUNTERPARTY'
            ? 'KYT verdict rejected: SANCTION_COUNTERPARTY hit (order frozen only)'
            : 'KYT verdict rejected: FROZEN_BY_MLRO disposition',
        sourcePlatform: 'SYSTEM',
      });
      return;
    }
```

- [ ] **Step 4: 清掉陈旧注释**

`:2174` 那条写着 `customer-account escalation is manual (V2 freeze API not yet built, see BACKLOG)` 的注释已经过时（该 API 于 2026-08-16 落地，BACKLOG:231）。改成：

```typescript
    // 2026-08-20：客户级冻结已在本域接通（applyKytRejected 的 SANCTION_APPLICANT
    // 分支调 customerRestrictionsService.open），此处不再需要人工升级。
```

同时把 `doc-final/BACKLOG.md:231` 那条勾掉（放到 Task 12 一起做）。

- [ ] **Step 5: 编译 + 起栈**

```bash
npx tsc --noEmit -p tsconfig.json && bash scripts/stack.sh up
```

Expected: tsc 0 错，后端启动无 DI 报错。

- [ ] **Step 6: Commit**

```bash
git add src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts
git commit -m "feat(compliance): 提现域接冻人,与充值对称;清掉 V2 freeze API 陈旧注释"
```

---

## Task 7: 批量冻单 —— 补审计 + 不再重冻已冻的单

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts:1076-1081`
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts:1042-1047`
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts:745-750`
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts:2975-3002`
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts:2780-2798`
- Test: Task 11 的 e2e

**Interfaces:**
- Consumes: Task 5/6 会调 `open()` 触发广播。
- Produces: 三域批量冻单都写审计；已 FROZEN 的单不再被扫出来。

> **两个遗留问题一起收口。**
>
> ① **零审计**（第一批遗留）：三域的 `onCustomerRestrictionOpened` 批量把在途单打到 FROZEN，**全程零 `auditLogsService` 调用**，违反铁律 ①。额外注意：**充值域的 `updateStatus` 自身不写审计**（`deposit-transactions.service.ts:590-677` 全方法零审计），而提现的 `updateStatus` 内建 `recordByActor` —— 充值域任何调用方都必须自己补，别指望兜底。
>
> ② **自咬**：Task 5/6 加了 `open()` 后，本域自己刚冻的那笔单会被自己的监听器再冻一次 → `FROZEN` 行无 `FREEZE` 自环边 → 抛 `Invalid action 'freeze' for status 'FROZEN'` → 被 try/catch 吞成一条**与事实不符**的 `logger.warn`。
>
> **⚠️ 2026-08-20 修订（Task 5 审查实证推翻了本任务的原方案）**

原方案是「把 `FROZEN` 加进 `findNonTerminalByOwner` 的 `notIn`」。**那治不了它自己点名的自咬**，理由是时序：

```
open() 内部 emit（fire-and-forget）        ← 此刻本单还是 COMPLIANCE_PENDING
   ↓ setImmediate
监听器 findMany 扫描 → 扫到本单（快照仍是 COMPLIANCE_PENDING，notIn 拦不住）
   ↑ 与此同时
主路径 updateStatus(FREEZE) 提交 → 本单变 FROZEN
   ↓
监听器对本单 updateStatus(FREEZE) → findUnique 读到 FROZEN → 零自环边 → 抛
```

**扫描的过滤发生在主路径写入之前，所以 `notIn` 只能治「该客户名下早就 FROZEN 的**别的**单」，治不了触发单自己。**

**修订后的两段修法（两段都要做）**：

- **第一段（仍做）**：`notIn` 加 `FROZEN` —— 治「早就冻着的别的单」，减少无谓循环。
- **第二段（新增，真正治自咬）**：监听器的 `catch` 要能区分「这笔单已经处于目标态」和「真失败」。前者降级成 `logger.debug` 且文案说清是被触发路径抢先冻上的，不再打与事实不符的 `Failed to freeze` warn。

**不要**给 `FROZEN` 加 `FREEZE` 自环边 —— 那会让"冻结"变成可重入操作，语义更糟。
**也不要**试图靠调换 `open()` 与 `updateStatus` 的顺序来回避 —— 那个顺序是 Task 5/6 的 load-bearing 取舍（见 §2.3）。

- [ ] **Step 1: 三域扫描排除 FROZEN**

`deposit-transactions.service.ts:1078`：

```typescript
      // FROZEN 在排除之列（2026-08-20）：本方法唯一的调用方是
      // onCustomerRestrictionOpened，已经冻了的单不需要再冻一次。不排除的话
      // 制裁路径「先冻人→广播→自己的监听器扫到自己刚冻的这笔」会走到无 FREEZE
      // 自环边的 FROZEN 行上抛 BadRequest，被吞成一条与事实不符的 warn。
      where: { ownerId, status: { notIn: ['SUCCESS', 'FAILED', 'CONFISCATED', 'RETURNED', 'SEIZED', 'FROZEN'] } },
```

`withdraw-transactions.service.ts:1044`：

```typescript
      // FROZEN 在排除之列 —— 理由见 deposit-transactions.service.ts 同名方法。
      where: { ownerId, status: { notIn: ['SUCCESS', 'REJECTED', 'FAILED', 'RETURNED', 'FROZEN'] } },
```

`swap-transactions.service.ts:748` 改成引用 Task 8 会建好的常量（**本 Step 先留字面量，Task 8 Step 4 再换成常量**）：

```typescript
      where: { ownerId, status: { notIn: ['SUCCESS', 'REJECTED', 'FAILED', 'REVERSED', 'FROZEN'] } },
```

- [ ] **Step 2: 充值监听器补审计**

`deposit-workflow.service.ts:2984-3001` 的 `for` 循环体替换为：

```typescript
      // 逐项容错：一笔冻不动（例如已在无 freeze 出边的中间态）不能连累其余几笔。
      try {
        await this.depositService.updateStatus(
          d.id,
          { action: DepositTransactionAction.FREEZE },
          {
            reason: `Customer restriction ${event.restrictionNo} (${event.cause}) opened`,
            actor: { actorType: 'SYSTEM', actorId: 'CUSTOMER_RESTRICTION' },
          },
        );
        // 铁律①：有持久状态、operator 可见 → 必须写审计。
        // ⚠️ 充值域的 updateStatus 自身不写审计（提现的写），所以这里必须自己补，
        // 否则批量冻结在审计里完全不可见。action 复用 DEPOSIT_FROZEN，让"按
        // action 查所有冻结"能一次查全；来源差异由 reason 承载。
        await this.auditLogsService.recordSystem({
          action: AuditActions.DEPOSIT_FROZEN,
          entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
          entityId: d.id,
          entityNo: d.depositNo,
          entityOwnerType: d.ownerType,
          entityOwnerId: d.ownerId,
          traceId: d.traceId || event.traceId || undefined,
          workflowType: 'DEPOSIT',
          reason: `Frozen by customer restriction ${event.restrictionNo} (${event.cause})`,
          sourcePlatform: 'SYSTEM',
        });
      } catch (e) {
        this.logger.warn(
          `Failed to freeze in-flight deposit ${d.depositNo} for restriction ${event.restrictionNo}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
```

- [ ] **Step 3: 提现监听器 —— 审计已有，只补一句注释**

**已核实（2026-08-20）**：提现走的 `assertCustomerComplianceOrFreeze` 内部已经写了 `AuditActions.WITHDRAW_FROZEN`（`updateStatus` 之后紧接着 `recordSystem`），所以提现侧**不需要补审计代码**。三域里只有充值域缺（因为它的 `updateStatus` 自身不写审计）。

只在 `withdraw-workflow.service.ts` 的 `onCustomerRestrictionOpened` 方法注释里补一句，免得下一个人以为漏了：

```typescript
   * 审计由 assertCustomerComplianceOrFreeze 内部写（WITHDRAW_FROZEN），
   * 不在这里重复 —— 与充值域不同：充值的 updateStatus 自身不写审计，
   * 它的监听器必须自己补一条。

- [ ] **Step 4: 编译 + 跑现有 e2e 确认没打破旧行为**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: 0 错。

- [ ] **Step 5: Commit**

```bash
git add src/modules/trading/deposit-transactions src/modules/trading/withdraw-transactions src/modules/trading/swap-transactions/swap-transactions.service.ts
git commit -m "fix(compliance): 批量冻单补审计,扫描排除已 FROZEN 避免自咬与误导性 warn"
```

---

## Task 8: 兑换 `FROZEN` 状态机基础设施

**Files:**
- Modify: `src/modules/trading/swap-transactions/dto/swap-transaction.dto.ts:12,22,29`
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts:84-90,357-376,745-750`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts:325-381`
- Test: `src/modules/trading/swap-transactions/swap-transactions.service.spec.ts`（若不存在则新建）

**Interfaces:**
- Produces:
  - `SwapTransactionStatus.FROZEN = 'FROZEN'`
  - `SwapTransactionAction.FREEZE = 'freeze'`
  - `SwapRejectReason` 增加 `'SANCTION_APPLICANT'`
  - `SWAP_FREEZE_SCAN_EXCLUDED: ReadonlySet<string>`（含 FROZEN）
  - `AuditActions.SWAP_FROZEN`
  - Task 9/10/11 全部依赖以上名字，**逐字使用**。

> **不需要 prisma 迁移**：`SwapTransaction.status` 是裸 `String`（`schema.prisma:1208`），全库 `grep '^enum' prisma/schema.prisma` **零命中**，migrations 里也没有 status 的 CHECK 约束。状态集合的唯一约束在 TS 侧。**不要凭空造一个空迁移，更不要写 backfill。**

- [ ] **Step 1: 写失败测试**

新建 `src/modules/trading/swap-transactions/swap-transactions.service.spec.ts`（若已存在则追加）：

```typescript
import { SwapTransactionStatus, SwapTransactionAction } from './dto/swap-transaction.dto';
import { SWAP_TERMINAL_STATUSES, SWAP_FREEZE_SCAN_EXCLUDED } from './swap-transactions.service';

describe('兑换状态机 · FROZEN', () => {
  it('FROZEN 与 FREEZE 已定义', () => {
    expect(SwapTransactionStatus.FROZEN).toBe('FROZEN');
    expect(SwapTransactionAction.FREEZE).toBe('freeze');
  });

  it('FROZEN 不进 SWAP_TERMINAL_STATUSES —— 进了会自动作废客户在途的材料请求（tipping-off）', () => {
    expect(SWAP_TERMINAL_STATUSES.has('FROZEN')).toBe(false);
  });

  it('FROZEN 进 SWAP_FREEZE_SCAN_EXCLUDED —— 已经冻了的单不再被冻结广播扫出来', () => {
    expect(SWAP_FREEZE_SCAN_EXCLUDED.has('FROZEN')).toBe(true);
    expect(SWAP_FREEZE_SCAN_EXCLUDED.has('SUCCESS')).toBe(true);
    expect(SWAP_FREEZE_SCAN_EXCLUDED.has('COMPLIANCE_PENDING')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/modules/trading/swap-transactions/swap-transactions.service.spec.ts
```

Expected: FAIL —— `SwapTransactionStatus.FROZEN` 是 `undefined`；`SWAP_FREEZE_SCAN_EXCLUDED` 导入不到。

- [ ] **Step 3: 改 DTO**

`src/modules/trading/swap-transactions/dto/swap-transaction.dto.ts:12-29` 整块替换为：

```typescript
export enum SwapTransactionStatus {
  COMPLIANCE_PENDING = 'COMPLIANCE_PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESS = 'SUCCESS',
  REJECTED = 'REJECTED',
  // 2026-08-20 制裁分主体：客户本人命中制裁 → 冻单。零出边终态。
  // 唯一入边 COMPLIANCE_PENDING --freeze--> FROZEN，两个驱动方（本单 KYT 裁决 /
  // 跨域冻人广播）。PROCESSING 刻意不设入边 —— 四条腿正在逐条过账，半程冻结
  // 会把账本劈成两半。
  // ⚠️ FROZEN 是活态、可达，不属于下面那段死枚举。
  FROZEN = 'FROZEN',
  // 不可达死枚举，保留仅为历史行兼容 —— 见 BACKLOG「V6 兑换 FAILED/REVERSED 死枚举」
  FAILED = 'FAILED',
  REVERSED = 'REVERSED',
}

export enum SwapTransactionAction {
  KYT_APPROVED = 'kyt_approved',
  KYT_REJECTED = 'kyt_rejected',
  SLA_BREACH = 'sla_breach',
  SUCCESS = 'success',
  // 与 deposit-transaction.dto.ts / withdraw-transaction.dto.ts 的 FREEZE 逐字同款。
  FREEZE = 'freeze',
}

export type SwapRejectReason = 'KYT_REJECTED' | 'TIMEOUT' | 'SANCTION_APPLICANT';
```

- [ ] **Step 4: 改 service 的两个集合 + 迁移表**

`swap-transactions.service.ts:84-90` 替换为：

```typescript
/**
 * 「单据生命周期已结束」—— 材料请求作废监听器（material-request-order-cancel.
 * listener.ts）与 admin 材料请求列表读这一份。
 * ⚠️ FROZEN 刻意**不在**内：被制裁调查的客户，他在途的材料请求要留着不撕。
 * 撕掉 = 客户端"请上传XX"的卡片突然消失 = 一个可感知的变化 = tipping-off。
 */
export const SWAP_TERMINAL_STATUSES: ReadonlySet<string> = new Set<string>([
  SwapTransactionStatus.SUCCESS,
  SwapTransactionStatus.REJECTED,
  SwapTransactionStatus.FAILED,
  SwapTransactionStatus.REVERSED,
]);

/**
 * 「不需要再被冻结广播捞起」—— findNonTerminalByOwner 专用。
 * ⚠️ FROZEN **在**内：已经冻了的单不需要再冻一次。
 * 与上面那份的 FROZEN 归属**故意相反**，两个判据回答的是不同问题，
 * 不要因为"看起来能合并成一个"就合并。
 */
export const SWAP_FREEZE_SCAN_EXCLUDED: ReadonlySet<string> = new Set<string>([
  ...SWAP_TERMINAL_STATUSES,
  SwapTransactionStatus.FROZEN,
]);
```

`:357-376` 的迁移表注释与表体替换为：

```typescript
  /**
   * 5 态状态机的合法迁移表：COMPLIANCE_PENDING(出生态) → PROCESSING → SUCCESS，
   * 或 COMPLIANCE_PENDING → REJECTED(终态)，或 COMPLIANCE_PENDING → FROZEN(终态)。
   * FROZEN 零出边：制裁冻结只能由 MLRO 撕便签后人工处理，系统不提供解冻边。
   * PROCESSING 刻意没有 FREEZE 出边（腿已开跑，冻结会留半截账）。
   * FAILED/REVERSED 是不可达死枚举（历史行兼容，见 BACKLOG「V6 兑换
   * FAILED/REVERSED 死枚举」），不出现在此表中。
   */
  private readonly transitions: Record<string, Partial<Record<SwapTransactionAction, SwapTransactionStatus>>> = {
    [SwapTransactionStatus.COMPLIANCE_PENDING]: {
      [SwapTransactionAction.KYT_APPROVED]: SwapTransactionStatus.PROCESSING,
      [SwapTransactionAction.KYT_REJECTED]: SwapTransactionStatus.REJECTED,
      [SwapTransactionAction.SLA_BREACH]: SwapTransactionStatus.REJECTED,
      [SwapTransactionAction.FREEZE]: SwapTransactionStatus.FROZEN,
    },
    [SwapTransactionStatus.PROCESSING]: {
      [SwapTransactionAction.SUCCESS]: SwapTransactionStatus.SUCCESS,
    },
    [SwapTransactionStatus.SUCCESS]: {},
    [SwapTransactionStatus.REJECTED]: {},
    // 零出边是**故意的**，不是忘了写。
    [SwapTransactionStatus.FROZEN]: {},
    [SwapTransactionStatus.FAILED]: {},
    [SwapTransactionStatus.REVERSED]: {},
  };
```

`:748`（Task 7 Step 1 留的字面量）换成常量：

```typescript
      where: { ownerId, status: { notIn: [...SWAP_FREEZE_SCAN_EXCLUDED] } },
```

- [ ] **Step 5: 加审计常量**

`src/modules/audit-logging/constants/audit-actions.constant.ts`，在 `SWAP_KYT_REJECTED_DISPOSED` 那行之后追加：

```typescript
  // 2026-08-20 制裁分主体：兑换单被冻（客户本人命中制裁 / 跨域冻人广播）。
  // 对齐 DEPOSIT_FROZEN(:240) / WITHDRAW_FROZEN(:416)。
  // ⚠️ 只加这一个 —— 充值/提现的 *_UNFROZEN / *_APPROVE_BLOCKED_FROZEN 那几个
  // 是给「FROZEN 有出边」的域用的，兑换 FROZEN 零出边，抄过来就是死常量。
  SWAP_FROZEN: 'SWAP_FROZEN',
```

- [ ] **Step 6: 跑测试确认通过 + tsc**

```bash
npx jest src/modules/trading/swap-transactions/swap-transactions.service.spec.ts && npx tsc --noEmit -p tsconfig.json
```

Expected: PASS + 0 错。tsc 可能会在别处报「`Record<SwapTransactionStatus, X>` 缺 FROZEN 键」—— 逐个补齐，**这正是加枚举时最容易漏的一类**。

- [ ] **Step 7: Commit**

```bash
git add src/modules/trading/swap-transactions/dto/swap-transaction.dto.ts src/modules/trading/swap-transactions/swap-transactions.service.ts src/modules/trading/swap-transactions/swap-transactions.service.spec.ts src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat(swap): 新增 FROZEN 终态与 FREEZE 动作,两个状态集合职责分开"
```

---

## Task 9: 兑换 `FROZEN` 落地（两个驱动方 + 幂等闸）

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts:465-472`（终态集合旁加一行）、`:1503-1520`（监听器）、`handleRejectDisposition` 内新增冻单
- Test: Task 11 的 e2e

**Interfaces:**
- Consumes: Task 8 的 `FROZEN` / `FREEZE` / `SWAP_FROZEN` / `SWAP_FREEZE_SCAN_EXCLUDED`；Task 3 的 `hasSanction`。
- Produces: 兑换单在两条路径上都能进 FROZEN。

> **三件事必须一起做，缺一个就出事：**
>
> ① **本单裁决驱动**：`handleRejectDisposition` 里 `hasSanction` 为真时把单子打到 FROZEN。
> ② **跨域广播驱动**：`onCustomerRestrictionOpened` 里 `COMPLIANCE_PENDING` 的单打 FROZEN；`PROCESSING` 的单**维持今天的停腿行为**（腿已开跑，不冻）。
> ③ **幂等闸**：`applyKytVerdict` 开头加 `if (status === FROZEN) return 'IGNORE'` 等价的一行。**不加会进死信** —— Sumsub 重投同一条 rejected webhook 时不会 no-op，一路走到 `markStatus(FREEZE)`，打在零出边的 FROZEN 上抛 `Invalid transition: FROZEN + freeze`，异常未捕获 → 事件标 FAILED → 三次重试后进死信。

- [ ] **Step 1: 加幂等闸（先做这个，它是防死信的）**

`swap-workflow.service.ts:508`，在

```typescript
    if (SwapWorkflowService.KYT_VERDICT_TERMINAL_STATUSES.has(status)) {
```

**之前**插入：

```typescript
    // 2026-08-20：FROZEN 单一律忽略后续裁决 —— 与第一批（2026-08-19）在充值/
    // 提现 decideVerdictLanding 里那条 `if (status === FROZEN) return 'IGNORE'`
    // 同源。刻意**不**放进 KYT_VERDICT_TERMINAL_STATUSES：那个集合的语义是
    // 「终态所以忽略」，这里的语义是「冻了所以忽略」，两者混在一起以后没人
    // 分得清。
    // ⚠️ 这一行是防死信的：不写则 Sumsub 重投同一条 rejected webhook 会一路
    // 走到 markStatus(FREEZE)，打在零出边的 FROZEN 上抛 Invalid transition，
    // 异常未捕获 → 事件标 FAILED → 三次重试后进死信。
    if (status === SwapTransactionStatus.FROZEN) {
      this.logger.debug(`applyKytVerdict no-op: swap ${swapId} is FROZEN`);
      await this.recordVerdictIgnored(swap, input, status);
      return;
    }
```

- [ ] **Step 2: 本单裁决驱动 —— `handleRejectDisposition` 里冻单**

在 `handleRejectDisposition` 内、`customerRestrictionsService.open(...)` 调用**之后**（保持"先冻人、再冻单"的 fail-safe 顺序，与充值/提现一致），加：

```typescript
      // 2026-08-20：客户本人命中制裁 → 把这笔单打到 FROZEN。
      // 只对 COMPLIANCE_PENDING 有效（迁移表的唯一入边）；单子若已在 PROCESSING
      // （腿已开跑）或已终态，markStatus 会抛 —— 这里用 status 判据先过滤，
      // 不靠异常控流。
      if (hasSanction && swap.status === SwapTransactionStatus.COMPLIANCE_PENDING) {
        await this.prisma.$transaction(async (tx: any) => {
          await this.swapTransactionsService.markStatus(
            swap.id,
            SwapTransactionAction.FREEZE,
            tx,
            { rejectReason: 'SANCTION_APPLICANT' },
          );
        });
        await this.auditLogsService.recordSystem({
          action: AuditActions.SWAP_FROZEN,
          entityType: AuditEntityTypes.SWAP_TRANSACTION,
          entityId: swap.id,
          entityNo: swap.swapNo,
          entityOwnerType: swap.ownerType,
          entityOwnerId: swap.ownerId,
          entityOwnerNo: swap.ownerNo || undefined,
          traceId: swap.traceId || undefined,
          workflowType: AuditWorkflowTypes.SWAP,
          reason: `KYT verdict rejected: SANCTION_APPLICANT hit (order frozen + customer restricted)`,
          sourcePlatform: 'SYSTEM',
        });
      }
```

**已核实（2026-08-20）**：常量就是 `AuditEntityTypes.SWAP_TRANSACTION`（定义在 `audit-actions.constant.ts:50`，不是单独的 entity-types 文件）与 `AuditWorkflowTypes.SWAP`。上面代码块里的 `workflowType: 'SWAP'` 要写成 `workflowType: AuditWorkflowTypes.SWAP`（本域既有写法，见 `swap-workflow.service.ts:329/355/456`）。**不要新建常量。**

- [ ] **Step 3: 跨域广播驱动 —— 改监听器**

`swap-workflow.service.ts:1503-1520` 的 `onCustomerRestrictionOpened` 整块替换为：

```typescript
  /**
   * 客户被贴了「卡住全部能力」的便签 → 处理他名下所有在途兑换。
   *
   * 2026-08-20 起分两路（BACKLOG:232 收口）：
   *   COMPLIANCE_PENDING → 打到 FROZEN（与充值/提现对齐，运营在列表页一眼可见）
   *   PROCESSING         → 维持停腿 + needsReview（腿已逐条过账，冻结会留半截账）
   * 已经 FROZEN 的单不会出现在这里 —— findNonTerminalByOwner 用
   * SWAP_FREEZE_SCAN_EXCLUDED 排除掉了。
   */
  @OnEvent(DomainEventNames.CUSTOMER_RESTRICTION_OPENED, { async: true })
  async onCustomerRestrictionOpened(event: {
    customerId: string;
    restrictionNo: string;
    cause: string;
    blocksAllCapabilities: true;
    traceId: string;
  }): Promise<void> {
    const inflight = await this.swapTransactionsService.findNonTerminalByOwner(event.customerId);
    for (const sw of inflight) {
      try {
        if (sw.status === SwapTransactionStatus.COMPLIANCE_PENDING) {
          await this.prisma.$transaction(async (tx: any) => {
            await this.swapTransactionsService.markStatus(
              sw.id,
              SwapTransactionAction.FREEZE,
              tx,
              { rejectReason: 'SANCTION_APPLICANT' },
            );
          });
          await this.auditLogsService.recordSystem({
            action: AuditActions.SWAP_FROZEN,
            entityType: AuditEntityTypes.SWAP_TRANSACTION,
            entityId: sw.id,
            entityNo: sw.swapNo,
            entityOwnerType: sw.ownerType,
            entityOwnerId: sw.ownerId,
            traceId: sw.traceId || event.traceId || undefined,
            workflowType: AuditWorkflowTypes.SWAP,
            reason: `Frozen by customer restriction ${event.restrictionNo} (${event.cause})`,
            sourcePlatform: 'SYSTEM',
          });
        } else {
          // PROCESSING：腿已开跑，只停推腿 + 留审计，不动单据状态。
          await this.assertSwapCustomerAccessOrHalt(sw, `restriction:${event.restrictionNo}`);
        }
      } catch (e) {
        this.logger.warn(
          `Failed to handle in-flight swap ${sw.swapNo} for restriction ${event.restrictionNo}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
  }
```

- [ ] **Step 4: 编译 + 起栈**

```bash
npx tsc --noEmit -p tsconfig.json && bash scripts/stack.sh up
```

Expected: 0 错，后端起来。

- [ ] **Step 5: Commit**

```bash
git add src/modules/trading/swap-transactions/swap-workflow.service.ts
git commit -m "feat(swap): FROZEN 落地两个驱动方(本单裁决/跨域广播)+ 幂等闸防死信"
```

---

## Task 10: 兑换客户面三层防线

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts:278-296`（`findAll` 加 `customerScope`）、`:322-332`（`findAllForCustomer`）、`:496`（`toCustomerSwapView`）、新增收敛白名单常量
- Test: Task 11 的 e2e

**Interfaces:**
- Consumes: Task 8 的 `FROZEN`。
- Produces: 客户面永远看不到 `FROZEN` 字面量，也无法用它做筛选。

> **本批改动会同时在三层开洞，三层都要堵。** 兑换今天**一层都没有** —— `toCustomerSwapView` 是 `status: item.status` 原样透传，`findAllForCustomer` 是 `...query` 原样透传。今天不出事只因 `FROZEN` 还不是合法枚举值、`@IsEnum` 挡回 400；**Task 8 加了枚举，洞就开了**。
>
> 充值域两层都已堵好且附有评审记录（`deposit-transactions.service.ts:191` 的注释逐字描述了同一个洞）。**照抄它的形状。**
>
> **前端零改动**：服务层把 `FROZEN` 收敛成 `REJECTED` 之后，客户端拿到的就是 `REJECTED` —— `swapStatusView.ts` 已有 `REJECTED → 'Unsuccessful'` 映射，`client-web/src/pages/Swap.tsx:36` 的终态集合已含 `REJECTED`（无限轮询问题自动消失）。**不要**去给这两个前端文件加 FROZEN。

- [ ] **Step 1: 加收敛白名单常量**

`swap-transactions.service.ts` 的 `SWAP_FREEZE_SCAN_EXCLUDED` 定义之后追加：

```typescript
/**
 * 客户面 passthrough 白名单 —— 只有这几个「客户本就该看到真实结果」的态原样
 * 输出，其余任何状态（现在的、遗留的、未来新增的）一律收敛。
 *
 * 方向抄自 deposit-transactions.service.ts:82-91 的成文教训：黑名单必然滞后，
 * 新增的执法态只要没人记得手工加进去就会原样下发给客户。白名单反过来，
 * 新增状态天生落在收敛侧。宁可错杀，不可放过。
 */
const SWAP_CUSTOMER_STATUS_PASSTHROUGH = new Set<string>([
  SwapTransactionStatus.COMPLIANCE_PENDING,
  SwapTransactionStatus.PROCESSING,
  SwapTransactionStatus.SUCCESS,
  SwapTransactionStatus.REJECTED,
]);
```

- [ ] **Step 2: 加收敛函数**

在 `toCustomerSwapView` 方法**之前**插入：

```typescript
  /**
   * 客户面状态收敛。
   *
   * FROZEN 显式收敛成 REJECTED —— 与充值收敛成 COMPLIANCE_PENDING 的选择
   * **故意不同**：充值的 FROZEN 是可逆的（RESUME → COMPLIANCE_PENDING），
   * 收敛成"处理中"是诚实的；兑换的 FROZEN 是零出边终态，收敛成"处理中"就是
   * 一个永远不会兑现的谎，还会让客户端的自刷定时器（client-web/src/pages/
   * Swap.tsx:543 的 hasNonTerminal）永不停止。收敛成 REJECTED 后客户看到
   * 'Unsuccessful'，与普通 KYT 拒绝**逐字相同**，分不出 —— 这正是 tipping-off
   * 要求的。
   *
   * 其余未列入白名单的状态（含未来新增）一律收敛成 COMPLIANCE_PENDING，
   * 与充值同一条「宁可错杀」的兜底。
   */
  toCustomerSwapStatus(status: string): string {
    if (SWAP_CUSTOMER_STATUS_PASSTHROUGH.has(status)) return status;
    if (status === SwapTransactionStatus.FROZEN) return SwapTransactionStatus.REJECTED;
    return SwapTransactionStatus.COMPLIANCE_PENDING;
  }
```

- [ ] **Step 3: 在客户视图里用它**

`toCustomerSwapView`（`:496`）里把

```typescript
      status: item.status,
```

替换为：

```typescript
      status: this.toCustomerSwapStatus(item.status),
```

- [ ] **Step 4: 堵筛选面**

`findAll`（`:279`）的签名加一个可选参数：

```typescript
  async findAll(query: SwapTransactionQueryDto, options?: { customerScope?: boolean }) {
```

`:295` 的

```typescript
    if (status) where.status = status;
```

替换为：

```typescript
    // 安全洞（对齐充值 deposit-transactions.service.ts:191 的「评审 Important 1(a)」）：
    // customerScope 下完全忽略 status 查询参数。SwapTransactionQueryDto 被 admin
    // 列表和客户端 GET /swap-transactions/my 复用，枚举一加 FROZEN，
    // ?status=FROZEN 就把状态过滤器交给了客户 —— 返回非空即等于确认自己被冻，
    // 是比响应体里原样输出 status 更直接的一个探测面。
    // 静默忽略、不报错 —— 报错本身又是一个可探测面。admin 侧行为不受影响。
    if (status && !options?.customerScope) where.status = status;
```

`findAllForCustomer`（`:322`）改成传入 scope：

```typescript
  async findAllForCustomer(customerId: string, query: SwapTransactionQueryDto) {
    const result = await this.findAll(
      {
        ...query,
        ownerId: customerId,
        ownerType: 'CUSTOMER',
      },
      { customerScope: true },
    );
    return {
      ...result,
      items: result.items.map((item: any) => this.toCustomerSwapView(item)),
    };
  }
```

- [ ] **Step 5: 确认单笔详情也走收敛**

```bash
sed -n '535,545p' src/modules/trading/swap-transactions/swap-transactions.service.ts
```

Expected: 能看到 `return this.toCustomerSwapView(item);` —— 说明单笔详情复用同一个视图函数，Step 3 已覆盖。若它是另一条路径，同样加上收敛。

- [ ] **Step 6: 编译 + 客户端不改动的确认**

```bash
npx tsc --noEmit -p tsconfig.json
grep -n "FROZEN" client-web/src/utils/swapStatusView.ts client-web/src/pages/Swap.tsx
```

Expected: tsc 0 错；grep **无输出**（客户端确实不需要认识 FROZEN，这是设计意图）。

- [ ] **Step 7: Commit**

```bash
git add src/modules/trading/swap-transactions/swap-transactions.service.ts
git commit -m "feat(swap): 客户面三层防线(状态收敛/白名单兜底/customerScope 忽略 status)"
```

---

## Task 11: e2e 验收

**Files:**
- Modify: `test/customer-restrictions.e2e-spec.ts:488-533`（用例⑤ 重写）
- Create: `test/sanction-subject-split.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1-10 的全部产出。

> ⚠️ **`test/customer-restrictions.e2e-spec.ts` 的用例⑤ 会直接变红** —— 它逐字断言 `expect(swap.status).not.toBe('FROZEN')`，注释还写着"该状态从未设计过，兑换域也没有这条状态机边"。断言和注释都要改，注释是设计意图的书面记录，留着会误导后来人。
>
> ⚠️ **破坏性护栏是硬要求**：本仓库的 e2e 会 `deleteMany` 整表，2026-07-31 真的炸掉过两次常驻栈的验收数据。新 e2e 必须用 `e2e-` 专用库并带 fail-closed 守卫。

- [ ] **Step 1: 重写用例⑤**

`test/customer-restrictions.e2e-spec.ts`，把 `:511-531`（从注释 `// 兑换：spec §3.5 ...` 到 `expect(...).not.toBe('FROZEN');`）替换为：

```typescript
    // 兑换：2026-08-20 制裁分主体（BACKLOG:232 收口）——
    // COMPLIANCE_PENDING 的在途兑换单现在会被打到 FROZEN（与充值/提现对齐），
    // 不再只是停腿 + needsReview 旗。PROCESSING 的单才维持停腿行为
    // （腿已逐条过账，冻结会留半截账）。
    await waitUntil(
      '兑换单被冻结',
      async () =>
        (await prisma.swapTransaction.findUnique({ where: { id: sw.id } }))!.status ===
        SwapTransactionStatus.FROZEN,
    );
    expect(
      await prisma.auditLogEvent.count({
        where: { entityId: sw.id, action: AuditActions.SWAP_FROZEN },
      }),
    ).toBeGreaterThan(0);
```

在该文件的 import 区补上 `SwapTransactionStatus`（若尚未 import）：

```typescript
import { SwapTransactionStatus } from '../src/modules/trading/swap-transactions/dto/swap-transaction.dto';
```

- [ ] **Step 2: 跑用例⑤确认通过**

```bash
npm run test:e2e -- test/customer-restrictions.e2e-spec.ts -t "⑤"
```

Expected: PASS。

- [ ] **Step 3: 新建本批验收 e2e（护栏头）**

新建 `test/sanction-subject-split.e2e-spec.ts`，头部**逐字**照抄第一批的护栏模板，只换库名与 suite 名：

```typescript
import { resolveE2eDatabaseUrl } from './e2e-db';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Node 18 polyfill：@nestjs/schedule 需要 globalThis.crypto（Node 19+ 才稳定），
// 本 harness 不加载 src/main.ts，所以要在 AppModule 之前自己补。
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// 必须在任何读 DATABASE_URL 的 import 之前执行。
process.env.DATABASE_URL = resolveE2eDatabaseUrl('e2e-sanction-subject-split.db');
process.env.SUMSUB_MOCK_MODE = 'true';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ── 破坏性护栏（2026-07-31 起，因为真的炸过两次）────────────────────────
if (!process.env.DATABASE_URL?.includes('e2e-')) {
  throw new Error(
    `[sanction-subject-split e2e] 拒绝运行：本 suite 会写入并清理交易表，但 ` +
      `DATABASE_URL 当前指向 ${process.env.DATABASE_URL} —— 这看起来是常驻栈的验收库。`,
  );
}
```

其余 import、`beforeAll` 建库/建客户/建资产的脚手架，照 `test/kyt-verdict-landing.e2e-spec.ts` 的形状写（那是第一批刚立的模板，同一批人写的，最省事）。

- [ ] **Step 4: 写四组验收用例**

```typescript
describe('第二批 · 制裁命中分主体 (e2e)', () => {
  it('① 充值 SANCTION_APPLICANT → 冻单 + 冻人', async () => {
    const dep = await makeDeposit(customerId, '5000');
    await depositWorkflow.applyKytVerdict(dep.id, {
      verdict: 'rejected',
      sceneTag: 'SANCTION_APPLICANT',
    });
    const row = await prisma.depositTransaction.findUnique({ where: { id: dep.id } });
    expect(row!.status).toBe(DepositTransactionStatus.FROZEN);
    const restrictions = await prisma.customerRestriction.findMany({
      where: { customerId, cause: 'SANCTION', status: 'OPEN' },
    });
    expect(restrictions.length).toBeGreaterThan(0);
  });

  it('② 充值 SANCTION_COUNTERPARTY → 只冻单，不冻人', async () => {
    const fresh = await makeCustomer('cp-only');
    const dep = await makeDeposit(fresh.id, '5000');
    await depositWorkflow.applyKytVerdict(dep.id, {
      verdict: 'rejected',
      sceneTag: 'SANCTION_COUNTERPARTY',
    });
    expect((await prisma.depositTransaction.findUnique({ where: { id: dep.id } }))!.status)
      .toBe(DepositTransactionStatus.FROZEN);
    expect(
      await prisma.customerRestriction.count({
        where: { customerId: fresh.id, cause: 'SANCTION', status: 'OPEN' },
      }),
    ).toBe(0);
  });

  it('③ 同一客户经充值+提现两条路径命中 → 便签只有一张,第二次留 SKIPPED 审计', async () => {
    const fresh = await makeCustomer('two-paths');
    const dep = await makeDeposit(fresh.id, '5000');
    const wd = await makeWithdraw(fresh.id, '600');

    await depositWorkflow.applyKytVerdict(dep.id, { verdict: 'rejected', sceneTag: 'SANCTION_APPLICANT' });
    // 第二笔单此时已被广播冻成 FROZEN，其裁决会被幂等闸 IGNORE ——
    // 所以直接对一笔全新的单再投一次，验证便签不重复贴。
    const wd2 = await makeWithdraw(fresh.id, '700');
    await withdrawWorkflow.applyKytVerdict(wd2.id, { verdict: 'rejected', sceneTag: 'SANCTION_APPLICANT' })
      .catch(() => undefined); // 单子可能已被广播冻结，抛不抛都不影响本断言

    const rows = await prisma.customerRestriction.findMany({
      where: { customerId: fresh.id, cause: 'SANCTION', status: 'OPEN' },
    });
    const distinctNos = new Set(rows.map((r) => r.restrictionNo));
    expect(distinctNos.size).toBe(1); // 只有最早的那一张
    expect(
      await prisma.auditLogEvent.count({
        where: { entityId: fresh.id, action: AuditActions.CUSTOMER_RESTRICTION_ADDED, result: 'SKIPPED' },
      }),
    ).toBeGreaterThan(0);
    void wd;
  });

  it('④ 兑换 FROZEN 客户面三层：响应体收敛成 REJECTED、筛选器无效、审计可查', async () => {
    const fresh = await makeCustomer('swap-frozen');
    const sw = await makeSwap(fresh.id, '900');
    await swapWorkflow.applyKytVerdict(sw.id, {
      verdict: 'rejected',
      typedTags: ['SANCTION_APPLICANT'],
    });
    expect((await prisma.swapTransaction.findUnique({ where: { id: sw.id } }))!.status)
      .toBe(SwapTransactionStatus.FROZEN);

    // 响应体收敛
    const view = await swapService.findAllForCustomer(fresh.id, {} as any);
    expect(view.items.map((i: any) => i.status)).not.toContain('FROZEN');
    expect(view.items.map((i: any) => i.status)).toContain('REJECTED');

    // 筛选器被忽略（客户面传 FROZEN 不应筛出任何"自证"结果）
    const probe = await swapService.findAllForCustomer(fresh.id, { status: 'FROZEN' } as any);
    expect(probe.items.length).toBe(view.items.length); // status 被完全忽略

    expect(
      await prisma.auditLogEvent.count({
        where: { entityId: sw.id, action: AuditActions.SWAP_FROZEN },
      }),
    ).toBeGreaterThan(0);
  });

  it('⑤ FROZEN 兑换单再收裁决 → 写 IGNORED 审计、不推状态、不抛异常（防死信）', async () => {
    const fresh = await makeCustomer('swap-late');
    const sw = await makeSwap(fresh.id, '900');
    await swapWorkflow.applyKytVerdict(sw.id, { verdict: 'rejected', typedTags: ['SANCTION_APPLICANT'] });

    await expect(
      swapWorkflow.applyKytVerdict(sw.id, { verdict: 'rejected', typedTags: ['SANCTION_APPLICANT'] }),
    ).resolves.not.toThrow();

    expect((await prisma.swapTransaction.findUnique({ where: { id: sw.id } }))!.status)
      .toBe(SwapTransactionStatus.FROZEN);
    expect(
      await prisma.auditLogEvent.count({
        where: { entityId: sw.id, action: AuditActions.SWAP_KYT_VERDICT_IGNORED },
      }),
    ).toBeGreaterThan(0);
  });
});
```

**已核实（2026-08-20）**：常量名就是 `AuditActions.SWAP_KYT_VERDICT_IGNORED`（`audit-actions.constant.ts:343`，第一批加的；充值/提现的对应物是 `DEPOSIT_KYT_VERDICT_IGNORED:244` / `WITHDRAW_KYT_VERDICT_IGNORED:424`）。用例⑤ 直接照上面写即可。

- [ ] **Step 5: 跑新 e2e**

```bash
npm run test:e2e -- test/sanction-subject-split.e2e-spec.ts
```

Expected: 5 个用例全 PASS。

- [ ] **Step 6: 跑全量硬闸**

```bash
npx tsc --noEmit -p tsconfig.json && npx jest 2>&1 | tail -20
```

Expected: tsc 0 错；jest 净新失败 0（本仓库有 4 个 wallets 相关的 pre-existing 失败，属于既有问题，不算本批引入 —— 但必须确认失败清单没变长）。

- [ ] **Step 7: Commit**

```bash
git add test/customer-restrictions.e2e-spec.ts test/sanction-subject-split.e2e-spec.ts
git commit -m "test(compliance): 第二批 e2e 验收 5 例;用例⑤ 改断言兑换会 FROZEN"
```

---

## Task 12: 文档同步与欠账收口

**Files:**
- Modify: `doc-final/reference/truth/v6-swap.md:11,13-27,52,79,84`
- Modify: `doc-final/reference/truth/v4-deposit.md`
- Modify: `doc-final/reference/truth/v5-withdraw.md:19,33,174`
- Modify: `doc-final/reference/truth/sumsub-ingestion.md`
- Modify: `doc-final/BACKLOG.md:231,232`
- Modify: `prisma/seed.business.ts:575`

> 项目 CLAUDE.md 明令「改代码必须同步 truth/」。truth 是「现在什么样」的唯一真相源，不同步的话下一个人会照旧的 4 态状态机写代码。

- [ ] **Step 1: 同步 v6-swap.md**

- `:11` 概述里「拒绝即终态 REJECTED」→ 补上 FROZEN 这条终态
- `:13-27` §1 状态机图：4 态改 5 态，加 `COMPLIANCE_PENDING ──(客户本人命中制裁)──→ FROZEN（终态，零出边，零记账）`，并注明 PROCESSING 刻意无 FREEZE 入边的理由（半截账）
- `:52` `handleRejectDisposition` 三分 cause 的描述：`hasSanction` 判据从 `SANCTION` 改 `SANCTION_APPLICANT`
- `:79` dto 「状态枚举」→ 5 活态 + 2 死枚举
- `:84` 客户端「四态展示」→ 说明服务层收敛（FROZEN → REJECTED），客户端只见 4 个态

新增一节记录四个状态判据的 FROZEN 归属（照抄设计稿 §3.6b 的表）。

- [ ] **Step 2: 同步 v4-deposit.md / v5-withdraw.md**

FROZEN 的语义从「只冻单」改成「按标签主体分流：`SANCTION_APPLICANT` 冻单 + 冻人，`SANCTION_COUNTERPARTY` 只冻单」。`v5-withdraw.md:19/33/174` 三处逐一核对。补一句：批量冻单现在写审计（`DEPOSIT_FROZEN` / `WITHDRAW_FROZEN`，reason 标明来源是限制广播）。

- [ ] **Step 3: 同步 sumsub-ingestion.md**

标签清单里 `SANCTION` 拆成两个；补一句 `SANCTION` 作为 **restriction cause** 不拆、且 2026-08-20 起是客户级因由（caseRef 由 `openWithin` 归一成 customerNo）。

- [ ] **Step 4: 勾掉 BACKLOG 两条**

- `:232`「兑换域被摁住时在单据上不可见……要么给兑换域补 FROZEN 态」→ 标记完成，注明由本批兑现第一个选项。
- `:231`「V2 freeze API not yet built」相关那条 → 标记完成（API 已于 2026-08-16 落地，本批把陈旧注释也清了）。

- [ ] **Step 5: 新登记三条 BACKLOG**

```markdown
- 【制裁】对手方恰好是我的客户（交叉场景）—— 本批不考虑。来源: 2026-08-20 第二批设计
- 【兑换】PROCESSING 在途单碰冻人广播仍走 needsReview 旗，混在卡单堆里、旁边挂 Resume 按钮，运营分不出「技术卡单」与「人被冻结」。窗口已收窄至腿已开跑的单。来源: 2026-08-20 第二批设计 §7.1
- 【制裁】两笔单的裁决在冻人广播完成前毫秒级并发到达，会开出两张同因由便签。窗口极窄、后果轻（MLRO 多签一次），防它要加客户级锁，暂不做。来源: 2026-08-20 第二批设计 §7.1
```

- [ ] **Step 6: 改 seed**

**已核实（2026-08-20）**：seed **不走 `open()`**，是直接 `create`（`prisma/seed.business.ts` ~:688-700，`caseRef: r.caseRef ?? null`），所以 Task 4 在 `openWithin` 里加的归一**管不到 seed**，必须手工填对。

好在同一段的上游（`:672`）已经 `select: { id: true, customerNo: true }`，`customer.customerNo` 就在作用域里。把便签落行处的

```typescript
            caseRef: r.caseRef ?? null,
```

改成：

```typescript
            // 客户级因由（SANCTION）的 caseRef 必须与 openWithin 的归一结果一致，
            // 否则 seed 铺出来的那张便签与运行时贴的那张会各算一张，
            // 破坏「一个客户只有最早的一张」这条不变量。
            // seed 不走 open()，归一管不到这里，只能手工对齐。
            caseRef: RESTRICTION_CAUSE_POLICY[r.cause].customerLevel
              ? customer.customerNo
              : (r.caseRef ?? null),
```

并把 Carol 那条（`:575`）的 `caseRef: 'SEED-SANCTION-CAROL',` 整行**删掉**（现在由上面的归一逻辑填）。确认 `RESTRICTION_CAUSE_POLICY` 已在该 seed 文件里 import —— 上游已经用它取 `policy.visibility`/`policy.releasePolicy`，所以必然已 import。

- [ ] **Step 7: 重铺验证**

**已核实（2026-08-20）**：worktree 的 self 栈重铺业务数据用下面这条（`db:biz:reset` 是 `package.json` 里的实际脚本名，`db:reset` 不存在）：

```bash
bash scripts/on-stack.sh self db:biz:reset && bash scripts/on-stack.sh self db:seed:business && bash scripts/stack.sh up
```

Expected: 重铺成功，`verify:demo-data` 绿（`db:seed:business` 自带这一步），后端起来。

验证 Carol 的便签 caseRef 已是她的 customerNo：

```bash
bash scripts/on-stack.sh self prisma:studio >/dev/null 2>&1 &
```

或直接查库（把 `<self 栈的库路径>` 换成 `bash scripts/stack.sh status` 里显示的那个）：

```bash
sqlite3 <self 栈的库路径> "SELECT customerId, cause, caseRef FROM customer_restrictions WHERE cause='SANCTION';"
```

Expected: `caseRef` 是 `CU...` 开头的客户号，不是 `SEED-SANCTION-CAROL`。

- [ ] **Step 8: Commit**

```bash
git add doc-final prisma/seed.business.ts
git commit -m "docs(truth): 同步第二批制裁分主体;勾掉 BACKLOG 231/232,新登记三条"
```

---

## Self-Review

**Spec coverage：**

| 设计稿 | Task |
|---|---|
| §1.1 标签拆分 | 1, 2 |
| §1.4 标量覆盖 bug + APPLICANT 优先 | 1 |
| §1.5 兑换命门 + 测试钉死 | 3 |
| §2.1 落地点 / §2.2 新建冻人能力 | 5, 6 |
| §2.3 先冻人后冻单 | 5, 6 |
| §2.4 事件回环误导性 warn | 7 |
| §2.5 批量冻单零审计 | 7 |
| §3.2 状态机一条边两个驱动方 | 8, 9 |
| §3.3/§3.4/§3.4b 客户面三层 | 10 |
| §3.5 两份终态集合 | 8（集合）、9（幂等闸一行） |
| §3.6/§3.6b 四判据对照 | 8 |
| §3.7 rejectReason | 8 |
| §3.8 e2e 变红 | 11 |
| §4 caseRef 客户级 + autoRelease 配对 | 4 |
| §5.5 文档与测试 | 11, 12 |
| §6 明确不用动 | 已写进 Task 8（无迁移）、10（前端零改动）、5（不动模块图） |
| §7.1 BACKLOG 三条 | 12 |
| §8 验收标准 1-10 | 11（1-8）、12（10）、各 Task 的 tsc/jest 步（9） |

**Placeholder scan：** 零命中（无 "TBD"、无 "类似 Task N"、无 "添加适当的错误处理"）。

初稿留过 5 处「让实现者自己 grep 确认再决定」的条件分支，写完后逐条查实、全部改成确定处方（文中标 **已核实（2026-08-20）**）：

| 原条件 | 查实结论 |
|---|---|
| 提现监听器要不要补审计 | **不要** —— `assertCustomerComplianceOrFreeze` 内部已写 `WITHDRAW_FROZEN`。三域只有充值缺 |
| 兑换审计的 entityType/workflowType 叫什么 | `AuditEntityTypes.SWAP_TRANSACTION`（在 `audit-actions.constant.ts:50`）+ `AuditWorkflowTypes.SWAP` |
| 第一批的 IGNORED 常量叫什么 | `SWAP_KYT_VERDICT_IGNORED`（`:343`） |
| seed 建便签走 `open()` 还是直接 `create` | **直接 `create`** —— Task 4 的归一管不到 seed，必须手工对齐，否则 seed 那张与运行时那张各算一张 |
| 重置脚本叫什么 | `db:biz:reset` + `db:seed:business`（`db:reset` 不存在） |

仅剩 Task 1 Step 1 一处要求实现者先读该 spec 顶部确认变量名 —— 本仓库各 spec 的 mock 变量命名确实不统一，这是**核对指令**不是占位符，且给了确切的判据（"若不同，按该文件既有写法调整，不要新建 helper"）。

**Type consistency：** `SceneTag` 在 Task 1 定义、Task 5/6 引用；`SWAP_FREEZE_SCAN_EXCLUDED` 在 Task 8 定义、Task 7 Step 1 先用字面量占位并在 Task 8 Step 4 换成常量（已在两处互相注明）；`SwapTransactionAction.FREEZE = 'freeze'` 全篇一致；`AuditActions.SWAP_FROZEN` 在 Task 8 定义、Task 9/11 引用。

**已知顺序依赖：** Task 7 Step 1 的 swap 部分依赖 Task 8 的常量，故那一步刻意先写字面量、Task 8 Step 4 再替换。若执行顺序调整为 8 → 7，直接在 Task 7 用常量即可。
