# 充值仿真裁决按钮 + 小额充值流程改造 — 设计

**日期**：2026-07-31
**分支**：`feat/deposit-money-arcs`
**触发**：单笔提交改造（`2026-07-31-deposit-single-txn-type-resolution`）落地后，验收时检查详情页 Simulation 场景按钮，发现仿真层与新裁决模型脱节；顺带业主重新定义小额充值的处置时点。

---

## 0. 一句话

把充值详情页的 **8 个多步场景剧本**改成 **9 个单步裁决按钮**（报文按 Sumsub 官方 schema 1:1 复刻、按 `sumsubTxnType` 分型生成），并把**小额充值的金额闸从"建单时判"挪到"合规通过后判"**，新增 `OPERATION_PENDING` 状态承接待运营处置。

---

## 1. 现状与实测证据

### 1.1 仿真按钮：状态机全对，报文全偏

2026-07-31 在 self 栈（backend 3100）用真实客户端建单 → scan → Gate 0 → 逐个点场景按钮，8 个场景 **8/8 到达预期终态**。问题全在喂出去的那份 Sumsub 报文上：

| 实测现象 | 证据 |
|---|---|
| 报文含一个**真实 Sumsub 不存在**的顶层 `verdict` 字段 | `fixtures/scenarios.ts → buildRawDetail()`；官方 getTxn 顶层字段是 `id/applicantId/externalUserId/clientId/data/score/review/createdAt/scoringResult/needMasking/txnInactive/cryptoTxnInfo`，无 `verdict` |
| 缺 `data.type` / `review.reviewStatus` / `scoringResult.action` | 8 个场景落库报文逐笔核对，三者均为 `缺` |
| 详情页 "Review Status" 行 **8 个场景全空白** | `parseDetail` 读 `d.review.reviewStatus`，fixture 从不产出 |
| "Applicant Action IDs" 行**永远为空** | `buildRawDetail` 的 `applicantActions` 硬编码 `[]`，连 S4（PEP→补料）也是 |
| onHold 单**零证据**：分数空、报文块整个空 | `DETAIL_LOOKUP_VERDICTS = {approved,rejected,awaitUser}` 不含 onHold；实测 `101 MANUAL_CHECKING onHold score=(空) detail=(无报文)` |
| 翻案后**原命中证据被覆写抹除** | S7 实测终态 `score=5 tags=[] rules=[]`，而中途曾是 `score=79 rules=["High-risk transaction pattern"]` |
| **没有任何场景演示 `travelRule`** | 8 笔实测 `sumsubTxnType` 全为 `finance` |

### 1.2 已确认的两个真 bug

**Bug 1 — onHold webhook 类型名写错（真接入即失效）**

Sumsub 官方文档 verbatim：on-hold 事件的 type 是 **`applicantKytOnHold`**（无 `Txn`），文档本身注明"该事件与其他 KYT 事件命名不一致"。我方**五处**一致写成 `applicantKytTxnOnHold`，且缺陷分**三层**：

```
① sumsub-ingestion.service.ts:124   startsWith('applicantKytTxn')  ← 前置分流,最外层
② deposit-webhook.router.ts:8       KYT_VERDICT_TYPES 集合
③ deposit-webhook.router.spec.ts:26
④ deposit-kyt-verdict.handler.ts:12 VERDICT_BY_TYPE 映射
⑤ fixtures/scenarios.ts:420         仿真 fixture
```

最外层的 ① 是**前缀匹配**：真实的 `applicantKytOnHold` 不以 `applicantKytTxn` 开头，所以它连 router 都进不去，在 ingestion 分流处就被丢弃 —— 比 handler 层更早一步。

fixture 与全链路 **一致地错**，所以演示跑得通、单测全绿；真接上 Sumsub 后 onHold 事件永远匹配不上 → 静默丢弃 → 挂起复核整条路失效。

**修法约束**：① 不能简单改成 `startsWith('applicantKyt')` —— 那会把 `applicantKytAml*` 等其它 KYT 族事件也吞进 deposit 路由。应改为显式类型集合匹配（与 ② 共用一份常量），避免前缀匹配再次埋雷。

**Bug 2 — approved 主路径没有金额闸（below-min 挂起从未生效）**

实测：种子下限 `minAmount=100`，建一笔 50 USDT，建单时正确落 `limitHoldReason=BELOW_MIN`；喂 approved webhook 后 **直接 `SUCCESS`、钱记进客户账**，审计里无 `DEPOSIT_HELD_BELOW_MIN`。

```
depositNo      status   amount  hold       sumsubVerdict
DEP2607313453  SUCCESS  50      BELOW_MIN  approved
审计: CREATED / PAYIN_CONFIRMED / COMPLIANCE_STARTED / GATE0_PASSED
      / SUMSUB_SUBMITTED / APPROVED / COMPLETED   ← 无 HELD_BELOW_MIN
```

根因：金额闸只写在 `checkAutoApproval()`（现为 waive 后重评入口），而 webhook 主路径 `applyKytApproved()` 直通 `approveDeposit()`，`assertTradingReadyOrHold()` 只查提现地址、不查金额。

叠加第二层：客户面列表服务端过滤 `limitHoldReason = null`，所以这笔已入账的钱**客户列表里查无此单**（实测客户可见 20 笔，金额=50 的 0 笔）。

### 1.3 已经站得住、无需改动的现状

- **onHold 状态机本就不动**：`applyKytOnHold()` 只设 `slaDeadline` + 写 `DEPOSIT_ONHOLD` 审计，状态留在 `COMPLIANCE_PENDING`（含迟到 webhook 的状态守卫）。
- **rejected 的 tag 分派已是目标形状**：`SANCTION`/`FROZEN_BY_MLRO` → `FROZEN`；`RETURN_TO_SENDER` → 开 `DEPOSIT_RETURN` 审批、留 `MANUAL_CHECKING`；其余 → `MANUAL_CHECKING`。
- **没收/放行处置管道完整**：maker-checker 审批（D6）、`CONFISCATING` 中间态两步转移（C1）、pending 锁两腿 + post 结算 + 3 次重试（C2/C3）全部现成，只是入口条件绑在 `COMPLIANCE_PENDING + BELOW_MIN` 上。

---

## 2. 设计 A：9 个原子裁决按钮

### 2.1 结构变更

`DepositScenario`（key + 有序 steps + expectedFinalStatus）→ `DepositVerdictButton`（一次 webhook + 一份按型生成的报文）。

**语义**：每个按钮 = 投递一次 Sumsub webhook，状态流转完全交给现有 handler。operator 自由串联，贴近真实（真实世界就是一次次 webhook 进来）：

- ② → ① = 补料后通过
- ⑦ → ⑤ = 人工复核后 MLRO 冻结
- ⑧ → ⑨ = 挂起后超时转人工

### 2.2 按钮矩阵

| # | 按钮 | webhook type | 报文要点 | 现有 handler 去向 |
|---|---|---|---|---|
| ① | Approved | `applicantKytTxnApproved` | `review.reviewStatus=completed`、`reviewAnswer=GREEN`、低分、无 tag | **≥min → SUCCESS；<min → OPERATION_PENDING**（见设计 B） |
| ② | Awaiting user | `applicantKytTxnAwaitingUser` | `reviewStatus=awaitingUser` + `scoringResult.applicantActions=[{applicantActionId,externalActionId}]` | `ACTION_PENDING` |
| ③ | Awaiting user · PEP | `applicantKytTxnAwaitingUser` | 同 ② + `typedTags=[PEP]` | `ACTION_PENDING` |
| ④ | Rejected · 制裁 | `applicantKytTxnRejected` | `reviewAnswer=RED`、高分、`typedTags=[SANCTION]` | `FROZEN` |
| ⑤ | Rejected · MLRO 冻结 | `applicantKytTxnRejected` | `typedTags=[FROZEN_BY_MLRO]` | `FROZEN` |
| ⑥ | Rejected · MLRO 退回 | `applicantKytTxnRejected` | `typedTags=[RETURN_TO_SENDER]` | 开 `DEPOSIT_RETURN` 审批，留 `MANUAL_CHECKING` |
| ⑦ | Rejected · 其他/无 tag | `applicantKytTxnRejected` | 无处置 tag | `MANUAL_CHECKING` |
| ⑧ | On hold | **`applicantKytOnHold`** | `reviewStatus=onHold` + 分数 + 命中规则 | **状态不动**，设 SLA 倒计时 |
| ⑨ | Rejected · SLA | `applicantKytTxnRejected` | `typedTags=[SLA_BREACH]` | `MANUAL_CHECKING`（走 ⑦ 同一条"其他 tag"路径） |

### 2.3 ⑧ 附带修 Bug 1

`applicantKytTxnOnHold` → `applicantKytOnHold`，四处同改（handler / router / router.spec / 按钮定义）。

### 2.4 ⑧ 附带补报文

把 `onHold` 加进 `DETAIL_LOOKUP_VERDICTS`，使 onHold 也拉 `getTxn` 存证。依据：onHold 的语义是"规则已算完分、判定需人工复核"，分数与命中规则正是 officer 的决策依据；官方 `scoringResult.action` 的合法值本就含 `onHold`。**不**加进 `TAG_LOOKUP_VERDICTS`（onHold 不读处置 tag，维持现状）。

### 2.5 ⑨ 的口径（业主已定，含已知分歧）

业主定：**⑨ 就是一次普通的 rejected + `SLA_BREACH` tag**，不置 `slaBreached`、不写 `DEPOSIT_SLA_BREACHED` 审计、不调 `DepositSlaService`。

我方 SLA 定时器（`@Cron` + `checkSlaBreaches()`）**保持原样不动、不退役**。

> ⚠️ **已知分歧（业主拍板"先按我的方式走，以后再说"）**：真实 Sumsub 不会因我方内部 SLA 超时而发 rejected —— SLA 是我方时限。因此按钮 ⑨ 与真实定时器会产出**不同的取证痕迹**（按钮：仅一条 rejected 裁决 + SLA tag；定时器：`slaBreached=true` + `DEPOSIT_SLA_BREACHED` 审计）。登记 BACKLOG，本轮不处理。

---

## 3. 设计 B：小额充值流程 + `OPERATION_PENDING`

### 3.1 流程

```
建单 → PAYIN_PENDING → COMPLIANCE_PENDING → 完整 Sumsub 检验
                                                  │
                                             approved
                                                  │
                              ┌───────────────────┴───────────────────┐
                         amount ≥ min                            amount < min
                              │                                        │
                           SUCCESS                            OPERATION_PENDING（新增）
                                                                       │
                                                        admin 详情页处置 ┤
                                                                       ├─ 放行 → SUCCESS
                                                                       └─ 没收 → CONFISCATING → CONFISCATED
```

**口径反转**：旧 = 先判金额、后合规风控；新 = **先合规风控、后判金额**。

### 3.2 新增状态与转移边

新增枚举值 `DepositTransactionStatus.OPERATION_PENDING = 'OPERATION_PENDING'`
新增动作 `DepositTransactionAction.OPERATION_PENDING = 'operation_pending'`

转移表（`deposit-transactions.service.ts` 的 `transitions`）增删：

| 起点 | 动作 | 终点 | 增/删 |
|---|---|---|---|
| `COMPLIANCE_PENDING` | `operation_pending` | `OPERATION_PENDING` | **新增** |
| `OPERATION_PENDING` | `approve` | `SUCCESS` | **新增**（放行） |
| `OPERATION_PENDING` | `confiscate_start` | `CONFISCATING` | **新增**（没收） |
| `COMPLIANCE_PENDING` | `confiscate_start` | `CONFISCATING` | **删除**（入口上移到 `OPERATION_PENDING`） |

`OPERATION_PENDING` 与既有 `ACTION_PENDING` 的分工：**`ACTION_PENDING` = 等客户补料；`OPERATION_PENDING` = 等运营处置**。两者互不重叠。

### 3.3 金额闸落点

在 `applyKytApproved()` 内、`approveDeposit()` **之前**加闸（同时堵死 Bug 2）：

```
FROZEN 守卫 → assertTradingReadyOrHold → MANUAL_CHECKING 翻案审计
  → 【新】limitHoldReason === 'BELOW_MIN' ?
        是 → updateStatus(OPERATION_PENDING) + 审计 DEPOSIT_HELD_BELOW_MIN，return
        否 → approveDeposit()
```

`checkAutoApproval()` 里那段 BELOW_MIN 早退逻辑相应改为同款（放行豁免后重评走同一条闸），避免两处口径分裂。

**判定依据**：沿用建单时落的 `limitHoldReason` 标记，**不在 approved 时重查限额规则** —— 规则可能在单子生命周期内被改，用出生时的标记更稳定、可追溯。

**边界**：沿用现状 `amount < minAmount` 才挂起，即**恰好等于 min 放行**。

### 3.4 客户可见性（业主定：一定看不见）

`limitHoldReason` 从"闸门 + 隐身标记"降级为**纯隐身标记**：建单时照落（`deposit-transactions.service.ts` 建单逻辑不变），客户面过滤 `if (customerScope) where.limitHoldReason = null` **不动**。

全程轨迹：

| 阶段 | `limitHoldReason` | 客户可见 |
|---|---|---|
| 建单（<min） | `BELOW_MIN` | ❌ |
| `COMPLIANCE_PENDING` 合规中 | `BELOW_MIN` | ❌ |
| `OPERATION_PENDING` 待处置 | `BELOW_MIN` | ❌ |
| 放行 → `SUCCESS` | `null`（`clearLimitHold`） | ✅ |
| 没收 → `CONFISCATED` | `BELOW_MIN` | ❌ 永久 |

金额 ≥ min 的单从建单起就无标记，全程可见，不受本次改动影响。

### 3.5 处置入口条件改写

| 位置 | 旧前置 | 新前置 |
|---|---|---|
| `waiveLimitHold()` | `BELOW_MIN && status===COMPLIANCE_PENDING` | `BELOW_MIN && status===OPERATION_PENDING` |
| `initiateConfiscation()` | 同上 | 同上 |
| `settleConfiscation()` 漂移守卫 | 同上 | 同上 |

处置管道本身（审批、两腿记账、重试）**零改动**。

---

## 4. 报文生成器契约

替换 `buildRawDetail()`，改为按 Sumsub 官方 schema 生成、并依 `sumsubTxnType` 分型：

```
buildTxnReport(ctx: {
  txnId: string;             // 现铸的 24-hex
  txnType: 'finance' | 'travelRule';
  applicantId: string;
  externalUserId: string;    // customerNo
  clientTxnId: string;       // depositNo
  amount: number; currency: string; isCrypto: boolean;
}, verdict: {
  reviewStatus: 'completed' | 'onHold' | 'awaitingUser';
  reviewAnswer: 'GREEN' | 'RED' | null;
  action: 'score' | 'onHold' | 'awaitUser' | 'reject';
  score: number;
  matchedRules: {...}[];
  applicantActions: {applicantActionId, externalActionId}[];
  typedTags: {label, type}[];
  moderationComment: string;
}) : SumsubKytTxnReport
```

产出形状（官方字段，2026-07-31 查证 `docs.sumsub.com/reference/get-transaction`）：

```jsonc
{
  "id": "<txnId>",
  "applicantId": "...", "externalUserId": "...", "clientId": "...",
  "createdAt": "...",
  "score": <int>,                          // 官方顶层也有 score
  "data": {
    "txnId": "<clientTxnId>", "txnDate": "...",
    "type": "finance" | "travelRule",      // ← 按型
    "info": { "amount": ..., "currencyCode": ..., "direction": "in" },
    "applicant": {...}, "counterparty": {...}
  },
  "review": {
    "reviewId": "...", "reviewStatus": "completed|onHold|awaitingUser",
    "reviewResult": { "reviewAnswer": "GREEN|RED", "moderationComment": "..." }
  },
  "scoringResult": {
    "score": <int>, "action": "score|onHold|awaitUser|reject",
    "matchedRules": [{ "id","name","revision","title","score","dryRun","action" }],
    "applicantActions": [{ "applicantActionId","externalActionId" }],
    "failedRules": []
  },
  "typedTags": [{ "label","type" }],
  "cryptoTxnInfo": { ... },                // ← 仅 isCrypto
  "travelRuleInfo": {                      // ← 仅 type==='travelRule'
    "protocolName": "trp", "status": "completed",
    "applicantVaspId": "...", "counterpartyVaspId": "...", "expiredAt": "..."
  }
}
```

**顶层 `verdict` 字段删除**。`parseDetail` 已有 `d.verdict ?? sr.action` 回退，删掉假字段后自动走 `scoringResult.action` —— 与生产同路径，回退分支从此被演示覆盖。

webhook payload 同步按官方补齐：现有 `type`/`kytTxnId`/`applicantId`/`applicantType`/`externalUserId`/`correlationId`/`reviewStatus`/`createdAtMs`，补 **`kytTxnType`**（finance/travelRule）、**`kytDataTxnId`**（= depositNo）、`clientId`、`sandboxMode`、`reviewResult`。

---

## 5. 影响面（文件级）

**后端**
- `src/modules/deposit-sumsub/fixtures/scenarios.ts` → 重写为按钮定义 + `buildTxnReport()`
- `src/modules/deposit-sumsub/demo-scenario.service.ts` → 从"跑剧本"改为"投单次裁决"
- `src/modules/deposit-sumsub/deposit-kyt-verdict.handler.ts` → 改 `applicantKytOnHold`；`DETAIL_LOOKUP_VERDICTS` 加 `onHold`
- `src/modules/deposit-sumsub/deposit-webhook.router.ts`（+ `.spec`）→ 改 `applicantKytOnHold`；把类型集合提成导出常量
- `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts:124` → 前缀匹配改为引用上述导出常量做显式集合匹配
- `src/modules/trading/deposit-transactions/dto/deposit-transaction.dto.ts` → 加 `OPERATION_PENDING` 状态 + 动作
- `src/modules/trading/deposit-transactions/deposit-transactions.service.ts` → 转移表增删
- `src/modules/trading/deposit-transactions/deposit-workflow.service.ts` → `applyKytApproved` 加金额闸；三处处置前置条件改 `OPERATION_PENDING`
- admin demo controller → 端点从 `run-scenario` 改为 `run-verdict`（或保留路径、改 body 语义）

**Prisma**
- **零迁移**：`DepositTransaction.status` 是 `String` 列（`schema.prisma:955`），全库 0 个 Prisma enum —— 新状态值只是新字符串，不需要迁移，也不会触发 SQLite 整表重建。

**前端**
- `admin-web/src/pages/DepositTransactionDetail.tsx` → Simulation 面板 8 按钮 → 9 按钮；`OPERATION_PENDING` 徽章；处置按钮门控状态改判
- `admin-web/src/utils/depositStatusMap.ts`（+ `.spec`）→ `getDepositStatusMeta` 加 `OPERATION_PENDING` 条目（三处徽章渲染的单一真相源）
- `admin-web/src/utils/depositActionMap.ts` → `DEPOSIT_BADGE_MAP` 加 `OPERATION_PENDING`（注：该 map 的 `getDepositStatusBadgeClass` 已无调用方、属待清死码，见 BACKLOG；若清理先行则本条免改）
- `client-web` → 不改（小额单全程隐身，客户端看不到该状态）

**测试**
- `test/deposit-sumsub-scenarios.e2e-spec.ts` → 按新按钮语义重写（⚠️ 该文件当前会清空整个栈库，见 BACKLOG，重写时一并修隔离）
- 新增：below-min approved → `OPERATION_PENDING` 的红灯测试（复现 Bug 2）
- 新增：`applicantKytOnHold` 类型名的防回归断言

---

## 6. 明确不做

- **不改真实 SLA 定时器**（业主定，见 §2.5 分歧）
- **不做证据历史留档**：翻案后原命中证据仍被覆写（§1.1 最后一条）。业主未就"曾被标记过要不要留痕"给口径，本轮维持现状，登记 BACKLOG
- **不改客户端**：小额单全程隐身，客户端无需认识 `OPERATION_PENDING`
- **不动没收/放行的记账与审批管道**
- **不做真实 VASP 归属服务**、不做阈值可配置化（沿用前一轮口径）

---

## 7. 本轮需登记 BACKLOG

1. 按钮 ⑨ 与真实 SLA 定时器取证痕迹不一致（业主已知，"以后再说"）
2. 翻案/放行后原命中证据被覆写，无历史留档
3. `test/deposit-sumsub-scenarios.e2e-spec.ts` 清空栈库 + 打断客户端建单通路（已于 2026-07-31 登记，重写时一并修）
