# 材料请求账（material request ledger）设计稿

**日期**：2026-08-17
**状态**：设计已确认，待写实施计划
**前置**：2026-08-15 客户生命周期轴 + 限制账（已合 main `66fdad88`）

---

## 1 背景

### 1.1 一句话

把「向客户要材料」这件事，从散落在四个域各自的表和列里，收成一本账：**一行 = 一次下发**。

它和上一轮的限制账是一对：

- **限制账**（`customer_restrictions`）回答：这个人被摁住了什么
- **材料账**（`material_requests`）回答：他交什么才能松开

### 1.2 树上现在有五套做法

| | 什么时候下发 | action 谁建 | 存哪 | 客户从哪进 |
|---|---|---|---|---|
| ① | 充值单 KYT 要补料 | Sumsub 建，webhook 推 | `deposit_applicant_actions`（按 seq） | 充值单详情页 |
| ② | 提现单 KYT 要补料 | Sumsub 建，webhook 推 | `withdraw_applicant_actions`（按 seq） | 提现单详情页 |
| ③ | 兑换单 KYT 软线拒 | Sumsub 建，webhook 推 | `customer_main.pendingAction*` 三列 | 客户级横幅 |
| ④ | 证件/材料到期 | **我方**调 `createApplicantAction` | `material_refresh_cycles.sumsubAction*` | Profile 横幅 |
| ⑤ | 分层升级 | 我方调 `moveToLevel`（不是 action） | `tier_upgrade_cases` | 无入口 |

四套存储、四套端点、四个前端页面（`DepositVerification` / `WithdrawVerification` / `Verification` / `PendingVerification`），干的是同一件事：拿 token → 渲染 SDK → 提交。

### 1.3 三个真问题

**① 客户级只有一个指针位。** `customer_main.pendingActionExternalId` 是单值，`CustomerPendingActionService.set()` 是覆盖写。同一客户第二笔兑换软线拒，会把第一笔的待办盖掉。

这是三轴时代 `complianceFreezeReason` 单列存冻结原因的同一个病。上一轮我们把「摁住的原因」做成了账，「要交什么材料」这一侧还是单列。**限制账只做了一半。**

**② 建 action 时没带我方 external id。** `SumsubClient.createApplicantAction()` POST 的是空 body（`sumsub.client.ts:104-116`），我方手里没有铸 SDK token 的钥匙。代码注释已承认此坑并登记 BACKLOG。路径 2（我方主动建）必须在建的时候就带上，否则既铸不了 token 也对不上 webhook。

**③ webhook 路由靠猜。** `applicantActionReviewed` 走一条「先问 swap 认不认、不认再落材料重检」的 if-else 链（`sumsub-ingestion.service.ts:225-262`），源码注释自陈这是一次跨域收窄的隐患。根因是没有统一 id 空间。

### 1.4 本轮不解决的

- **不建规则引擎**。运营不能配「风险升到 HIGH 就自动要资金来源证明」这类规则。手动下发 + 已有的到期 cron，就这两个自动化程度。
- **不真接 Sumsub**。全程我方模拟，但核心参数（level / applicantActionId / externalActionId）一个不少地走完整条链路，将来换真接口只替换 `SumsubClient` 的实现。

---

## 2 核心模型

### 2.1 `material_requests`

```prisma
model MaterialRequest {
  id                String   @id @default(uuid())
  // 业务键。客户端与后台一律以 requestNo 为操作单位（Rule 3）
  requestNo         String   @unique

  // 材料永远是对「人」要的 —— 这一列恒非空，绑不绑单是另一回事
  customerId        String
  sumsubApplicantId String

  // 要什么材料 = Sumsub 的 level。不自建文档枚举，level 就是材料清单
  levelName         String

  // Sumsub 侧 id。**只在服务端与审计出现，绝不下发客户端**
  applicantActionId String
  // 我方生成，铸 SDK token 的钥匙。路径 2 建 action 时即带上（修 §1.3②）
  externalActionId  String   @unique

  // 绑单（可空）。两列同时为空或同时非空
  orderDomain       String?  // DEPOSIT | WITHDRAW | SWAP
  orderRef          String?  // depositNo / withdrawNo / swapNo

  // 挂限制（可空，且**可后补** —— 见 §5.3 到期升档）
  restrictionNo     String?

  origin            String   // SUMSUB_PUSHED | OPERATOR_ISSUED | SYSTEM_SCHEDULED
  status            String   @default("PENDING_SUBMISSION")

  reason            String
  issuedBy          String   // userNo / 'SYSTEM'
  issuedAt          DateTime @default(now())
  submittedAt       DateTime?
  reviewedAt        DateTime?
  reviewAnswer      String?  // GREEN | RED
  reviewRejectType  String?
  cancelledAt       DateTime?
  cancelReason      String?
  traceId           String

  customer CustomerMain @relation(fields: [customerId], references: [id])

  @@index([customerId, status])
  @@index([orderDomain, orderRef])
  @@index([restrictionNo])
  @@map("material_requests")
}
```

### 2.2 状态机

```
                    ┌──────── RED + RETRY（清提交章，同一 action 重交）────────┐
                    ↓                                                          │
PENDING_SUBMISSION ──客户提交──> SUBMITTED ──GREEN──────> APPROVED             │
        │                            │                                         │
        │                            ├──RED + FINAL────> REJECTED              │
        │                            └─────────────────────────────────────────┘
        │
        └──绑的单进终态且没挂限制──> CANCELLED
```

终态三个：`APPROVED` / `REJECTED` / `CANCELLED`，零出边。「活着的行」= `PENDING_SUBMISSION` 或 `SUBMITTED`。

**RED 分两种，这是 Sumsub 的真实语义，不能合并成一个「不通过」：**

| `reviewRejectType` | 含义 | 落地 |
|---|---|---|
| `RETRY` | 交的东西不合格，让他用**同一个 action** 重交 | 退回 `PENDING_SUBMISSION`，清 `submittedAt`，**`applicantActionId` / `externalActionId` / 认证链接全部不变**。便签保留 |
| `FINAL` | 拒了 | 置 `REJECTED` 终态。便签保留 |

树上三条路今天对此**互不一致**，本轮统一到上表：

- `swap-sumsub/applicant-action.handler.ts:159` —— 任何 RED 都 `resetSubmission()`，没有终态拒绝，运营无法关单
- `material-refresh.service.ts:181` —— 任何 RED 都退回 `PENDING_CUSTOMER_EVIDENCE`，同上
- `onboarding.service.ts:236` —— 唯一分了 `RED + RETRY` 与其余，本轮以它为准

`REJECTED` 之后要再要材料，是**新开一行**（新 action id、新链接），老行留着当历史。`RETRY` 不是新开行 —— 它就是同一行退回重交。

### 2.3 三种 origin

| origin | 谁触发 | 例子 | 本轮 |
|---|---|---|---|
| `SUMSUB_PUSHED` | Sumsub 先建 action，webhook 推来 | 充值/提现/兑换 KYT 要补料 | 已有，迁入本账 |
| `OPERATOR_ISSUED` | 运营在后台点「Request Documents」 | 本轮新增 | **新建** |
| `SYSTEM_SCHEDULED` | 系统自发，非人点。两个入口：到期 cron（`material-freshness-cron.service.ts`）与进件时的首次收集（`MaterialRefreshService.seedInitialHoldings()`，`triggerType='INITIAL_COLLECTION'`） | 护照 T-30；进件时缺地址证明 | 已有，迁入本账 |

**两条路径的差别只在建行那一刻**：路径 1 是 Sumsub 给我们两个 id、我们照记；路径 2 是我方先生成 `externalActionId`、再调 `createApplicantAction` 带上它。**建完之后两条路径出来的行完全同形**，下游（展示 / 提交 / 裁决 / 解限制）不区分来源。

---

## 3 展示规则

**后台和客户端的规则是相反的，两套各写各的，禁止互相套用。**

### 3.1 后台 = 全集

**admin 客户详情页列出该客户所有活着的行**，不管绑没绑单、挂没挂限制，无例外。理由：那是运营的操作台，裁决按钮在那儿；若绑单的行只在订单页露，运营审一条补料要先翻是哪个单。

**admin 订单详情页**额外镜像一份该单的行，带同样的裁决按钮。两处**严格共用同一个组件、同一个端点**（见 §4.3）。

### 3.2 客户端 = 分流

```
订单详情页 = 这个单上活着的行，且这个单还没进终态
客户级横幅 = 活着的行里「挂了限制的」∪「没绑单的」
横幅分档   = 挂了摁人的限制 → 红（BLOCKING/WARNING）；其余 → 黄（INFO）
```

一句话：**订单页管绑单的，横幅兜住其余的 + 所有真摁住人的。**

### 3.3 四种组合

| | 后台客户详情页 | 后台订单详情页 | 客户端订单页 | 客户端横幅 |
|---|---|---|---|---|
| 绑单 + 挂限制 | 露 | 露 | 露（单非终态） | 露（红） |
| 绑单 + 没挂限制 | 露 | 露 | 露（单非终态） | 不露 |
| 不绑单 + 挂限制 | 露 | — | — | 露（红） |
| 不绑单 + 没挂限制（护照 T-30） | 露 | — | — | 露（黄） |

**孤儿在结构上不存在**：每一行至少有一个客户端入口。绑单的靠订单页兜（单一死就作废，见 §5.1），其余全部靠横幅兜。

### 3.4 为什么横幅要分两档

护照 T-30 提醒是不挂限制的客户级下发。树上已经是这个形态：

- `ProfileBannerService` 已发三档 `INFO` / `WARNING` / `BLOCKING`
- `material_refresh_cycles.stage` 已是 `NUDGE_ONLY`(T-30) → `URGENT`(T-7) → `BLOCKING`(过期)
- 前两档不挂任何限制，第三档才开 `MATERIAL_EXPIRED` 便签

任何「不挂限制就不上横幅」的规则都会把这个正在跑的功能判死。

---

## 4 模拟闭环

三个面全部复刻树上已跑通的套路，不新发明交互。

### 4.1 下发 —— 后台客户详情页

新增 **Verification Requests** 节，右上「Request Documents」按钮。弹窗四项：

| 字段 | 说明 |
|---|---|
| 要什么材料 | 选 Sumsub level（注册表见 §7.1） |
| 绑不绑单 | 下拉该客户**非终态**的充值/提现/兑换单（复用三域已有的 `findNonTerminalByOwner()`），可不选 |
| 要不要摁住 | 勾了同时开一张 `PENDING_DOCUMENT` 便签，scope 沿用限制账的勾选。**可不勾**（护照提醒那一档） |
| 原因 | 文本，进审计 |

提交时**一个事务**内：生成 `externalActionId` → 调 `createApplicantAction`（mock 下返回 `mock-action-<uuid>`）→ 落 `material_requests` 一行 → 勾了摁住则经 `CustomerRestrictionsService.open()` 开便签并回填 `restrictionNo`。

### 4.2 提交 —— 客户端

**一个页面 `/verification/:requestNo` 收掉现在四个页面。**

照抄 `client-web/src/pages/DepositVerification.tsx` 已跑通的两态结构：`simulation` 分支渲染假上传组件、真接分支挂 Sumsub SDK 容器；`submitted` 后换成「已收到，审核中」。定位符从 `depositNo + seq` 换成 `requestNo`。

- `GET  /client/me/material-requests/:requestNo/session` → `{ submitted, sdkToken }`
- `POST /client/me/material-requests/:requestNo/submit` → 置 `SUBMITTED`

### 4.3 裁决 —— 后台，客户详情页与订单详情页共用

`SUBMITTED` 的行给**三个**按钮：**✅ Approve** / **🔄 Reject · Retry** / **❌ Reject · Final**。三个而不是两个，是因为 Sumsub 的 RED 本身就带 `reviewRejectType`（见 §2.2）——只给「通过/不通过」两个按钮，就模拟不出"让他重交"这个在真实流程里最常见的分支。

整节用 `useSimulationMode()` 门控，与充值详情页现有的「10. Simulation」区一致，真接 Sumsub 时不出现。

按钮打 `POST /admin/sumsub/simulate/applicant-action-result`。**该端点已存在但写死只认 `cycleId`/`cycleNo`**（`admin-sumsub-simulation.controller.ts:81`），改成认 `requestNo`。它照旧造 `applicantActionReviewed` 报文丢进 `SumsubIngestionService.ingest()`。

Ingestion 拿 `externalActionId` **一次查表**定位到那一行，行上写着绑哪个单、挂哪张便签 —— §1.3③ 那条 if-else 链随之拆除。

---

## 5 生命周期

### 5.1 订单进终态 → 作废（仅限没挂限制的）

监听 `DEPOSIT_STATUS_CHANGED` / `WITHDRAWAL_STATUS_CHANGED`；swap 域**没有** `SWAP_STATUS_CHANGED`（走 `FUNDS_ORDER_STATUS_CHANGED`），实施时需为 swap 单独接线或补事件 —— 这是三域唯一的不对称处。

订单进终态时，对该单上所有活着的行：

- **没挂限制** → 置 `CANCELLED`，`cancelReason = 'ORDER_TERMINAL'`。它本来就只在订单页露，单死了彻底没意义
- **挂了限制** → **不作废**，清空 `orderDomain`/`orderRef` 解绑订单，留在客户级横幅上

第二条是本设计的价值点：充值退回了，但「这个人还欠一张资金来源证明」没跟着消失。

各域终态集合以域内既有定义为准（今日：deposit = SUCCESS/FAILED/CONFISCATED/RETURNED/SEIZED；withdraw = SUCCESS/REJECTED/FAILED/RETURNED；swap 见 `swap-transactions.service.ts` 转移表），**本文不复制枚举，避免漂移**。

### 5.2 裁决落地

**Approve（GREEN）**
1. 行置 `APPROVED`
2. 挂了便签 → `CustomerRestrictionWorkflowService.autoRelease()` 自动撕，`releaseMode = AUTO`，**不走审批**（这条路径材料重检已在用）
3. 绑了单 → 发事件通知该域，**域自己决定怎么推进**。材料账不替订单域做状态决定

**Reject · Retry（RED + `reviewRejectType='RETRY'`）**
1. 行退回 `PENDING_SUBMISSION`，清 `submittedAt`
2. `applicantActionId` / `externalActionId` / 认证链接**全部不变**，客户回到同一个页面重交
3. **便签原地不动**
4. 客户端表现：横幅/订单页从「审核中」退回「请认证」

**Reject · Final（RED + `reviewRejectType='FINAL'`）**
1. 行置 `REJECTED` 终态
2. **便签原地不动**。审不过就是没解开 —— 这是本设计最不能含糊的一条
3. 绑了单 → 通知该域
4. 运营要么再下发一次（**新行、新 action id**），要么走审批手工撕便签

两种 RED 都**不撕便签**。区别只在这一行还能不能继续用。

### 5.3 到期升档：同一行补挂限制

护照那条路：T-30 建行（无限制，黄）→ T-7 升 `URGENT`（仍无限制）→ T-0 在**同一行上**补挂 `MATERIAL_EXPIRED` 便签，回填 `restrictionNo`，横幅转红。

所以 `restrictionNo` 不是建行时定死的，是可后补的。**不要设计成「升档时重新下发一次」** —— 那样客户会收到第二个链接、Sumsub 侧多一条 action、老的还悬着。

这与今天的行为一致，已核实：`material-refresh.service.ts` 的两个 `createApplicantAction()` 调用点（L69、L373）都发生在**建 cycle 那一刻**（`stage='NUDGE_ONLY'`），升档路径（`material-freshness-cron.service.ts`）只改 stage、不碰 `sumsubActionId`。

---

## 6 不变量

| # | 约束 | 为什么 |
|---|---|---|
| **I1** | 材料请求**只能**挂 `DISCLOSED` 类便签（`PENDING_DOCUMENT` / `MATERIAL_EXPIRED`）。SILENT 类（`SANCTION` / `KYT_REJECTED_HARD`）的 cause 根本不出现在后台「要不要摁住」的选项里 | 客户点进认证页就等于被告知「你因为某个不能说的原因被卡住了」= tipping-off |
| **I2** | `applicantActionId` 绝不出现在任何客户面响应里 | 沿用 `deposit_applicant_actions` 既定口径；客户面只认 `requestNo` |
| **I3** | `orderDomain` 与 `orderRef` 同空同非空 | 半绑状态无法判定展示位置 |
| **I4** | 每一行至少有一个客户端入口（§3.3 四行全覆盖） | 孤儿 = 运营发了、客户看不见、双方都不知道 |
| **I5** | 建 action 必须带我方 `externalActionId` | 否则铸不了 token、对不上 webhook（§1.3②） |
| **I6** | 客户端与后台**一律**以 `requestNo` 为操作单位，不以 `id` | CLAUDE.md 铁律 3 |

**I1 的反面**：身上有制裁便签的客户，照样可以给他下发别的材料 —— 补料是常规操作，本身不泄漏什么。只是那次下发与制裁便签毫无关系，交了也撕不动它。

---

## 7 收编清单

### 7.1 新建

- `material_requests` 表 + `MaterialRequestService`（实体守卫：建行/提交/裁决/作废 + 审计）
- 可下发 level 注册表（常量表，仿 `RESTRICTION_CAUSE_POLICY`）：level 名 + 人类可读标签 + 该 level 要哪些文档。今日树上散落的 level 名：`wave3-level-1` / `wave3-level-2` / `wave3-poa` / `level-1` / `level-2`，需收成一处
- admin：客户详情 Verification Requests 节 + 下发弹窗 + 裁决按钮组件（订单详情页复用同一组件）
- client：`/verification/:requestNo` 单页

### 7.2 吸收后删除

| 对象 | 位置 |
|---|---|
| `deposit_applicant_actions` 表 | schema |
| `withdraw_applicant_actions` 表 | schema |
| `customer_main.pendingActionExternalId` / `pendingActionReason` / `pendingActionSubmittedAt` | schema |
| `material_refresh_cycles.sumsubActionId` / `sumsubActionLevelName` / `sumsubActionCreatedAt` | schema（表本身留着 —— 它管「哪天到期」，是下发的**理由**，不是下发本身） |
| `CustomerPendingActionService` + `customer-pending-action.controller.ts` | 整体 |
| `applicantActionReviewed` 的 if-else 路由链 | `sumsub-ingestion.service.ts:225-262` |
| 四个客户端页面 | `DepositVerification` / `WithdrawVerification` / `Verification` / `PendingVerification` |
| 各域 `verification-session/:seq` 端点（4 个） | deposit / withdraw controller |

`customer_main.hardLineDispositionedAt`（sticky 硬线标记）**保留** —— 它记的是「这个人被硬线处置过」这个持久事实，不是一次下发，与本账无关。

### 7.3 不动

- `tier_upgrade_cases`（用 `moveToLevel`，不是 applicant action，机制不同）
- `customer_restrictions`（上一轮的限制账，本账只引用其 `restrictionNo`）
- `material_refresh_cycles` 表本身及其 stage 机
- `client_risk_assessments` 的 `moveToLevel` 调用

---

## 8 非目标

- **不做规则引擎**。运营不能配自动下发条件（明确选型：手动 + 已有到期 cron）
- **不真接 Sumsub**。全程模拟，但参数完整
- **不改各订单域的状态机**。材料裁决只发事件，域自己决定怎么推进
- **不为 SILENT 限制做任何客户面出口**（I1）
- **不做批量下发**（一次一个客户一条）

---

## 9 待决

| # | 问题 | 建议 |
|---|---|---|
| **Q1** | swap 域缺 `SWAP_STATUS_CHANGED` 事件，作废规则的接线方式 | 实施时二选一：补一个域事件（与另两域对称），或在 swap workflow 终态处直接调材料账。倾向补事件 |
| **Q2** | level 注册表里每个 level 到底要哪些文档，需与 Sumsub 侧实际配置对齐 | demo 阶段先按现有 level 名硬编码标签，真接前核对 |
| **Q3** | 已被 `REJECTED` 的行，其便签长期挂着无人清理 | 现设计靠运营再下发或手工撕。是否需要 SLA 提醒，本轮不做，登记 BACKLOG |

---

## 10 验收要点

1. 同一客户同时存在「护照 T-30 提醒（黄、不绑单、无限制）」与「充值单补料（绑单、挂限制）」两行，互不覆盖 —— 直接反证 §1.3① 那个单指针病
2. 挂限制的充值单走到 RETURNED：订单页不再显示该行，客户级横幅仍红着，行未作废且已解绑订单
3. 不挂限制的充值单走到 RETURNED：该行 `CANCELLED`，两端均不显示
4. 护照行从 T-30 到 T-0：`requestNo` 与 `externalActionId` 全程不变，横幅由黄转红
5. Approve 后便签自动撕（`releaseMode=AUTO`，无审批案）；两种 Reject 后便签均仍 OPEN
8. Reject·Retry 后：行退回 `PENDING_SUBMISSION`、`externalActionId` 与裁决前逐字相同、客户可再次提交；Reject·Final 后：行 `REJECTED` 且客户端两处均不再显示该行
6. 后台「要不要摁住」的下拉里不存在 `SANCTION` / `KYT_REJECTED_HARD`（I1）
7. 任一客户面响应体中搜不到 `applicantActionId` 字面值（I2）
