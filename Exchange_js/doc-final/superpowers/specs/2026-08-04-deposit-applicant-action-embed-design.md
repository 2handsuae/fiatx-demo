# 充值 · applicant action 客户端交互设计

**日期**：2026-08-04
**范围**：充值单 `ACTION_PENDING` 态的客户侧补料交互（Sumsub applicant action）
**前置**：`2026-07-31-deposit-verdict-buttons-and-below-min-flow-design.md`（状态机与九裁决按钮）

---

## 0. 一句话

`awaitUser` 裁决把充值单推进 `ACTION_PENDING` 之后，客户端目前**没有任何可操作的东西**（详情弹窗只有一句静态 "Please contact support"）。本设计补上这段：详情弹窗展示按材料类型分岔的文案 + 认证按钮，点击后在详情区内嵌 Sumsub 认证界面；客户提交只改展示与 SLA 计时，**不动状态机**。

演示优先（业主定调「乙」）：mock 认证页占住真实 SDK 将来要占的那块容器，真接时换实现、前端结构不动。

---

## 1. 现状（改动前）

### 1.1 `applicantActionId` 全仓只活在 fixture 里

| 位置 | 状态 |
|---|---|
| `deposit-sumsub/fixtures/verdict-buttons.ts:62,80` | 造了 `aa-sof-0001` / `aa-edd-0002` |
| `deposit-sumsub/fixtures/txn-report.builder.ts:24` | 塞进模拟报告的 `scoringResult.applicantActions[]` |
| `DepositTransaction` 表 | **无字段承接** |
| admin 详情页 | 不展示 |
| 客户端 | 无交互 |

`client-web/src/pages/Deposit.tsx:354` 有一段自陈注释，明说 CTA 本应深链到 Sumsub 验证流程，但充值接口不暴露任何 SDK token / 链接字段，故降级为静态 "Please contact support"。

### 1.2 Sumsub 侧能拿到什么（已用真实沙盒响应核实）

2026-07-31 沙盒交易 `6a6cf0e9387e1ab12c26b8f6`（`reviewStatus: awaitingUser`）的真实响应：

```json
"scoringResult": {
  "action": "reject",
  "applicantActions": [{
    "applicantActionId":  "6a6cf0eb387e1ab12c26b906",
    "externalActionId":   "paymentMethod-7828b821-3d36-43da-b3a5-d140b2ef4dd3"
  }]
}
```

结论三条：

1. **`externalActionId` 由 Sumsub 生成**，我方不需要构造；前缀（`paymentMethod-`）标识 action 类型。
2. 触发者是规则 `TUT changelevel QIV v1`（`action: awaitUser`）——**要客户交什么由规则决定**，我方不判断。
3. `externalActionId` 正是铸 token 的必填键（见 §1.3）。

### 1.3 两个官方端点的分工（本地 OpenAPI 缓存 + `sumsub-integrate-websdk` skill 核实）

| 端点 | 产出 | 用途 |
|---|---|---|
| `POST /resources/sdkIntegrations/levels/{level}/websdkLink` | `{ url }` | 跳出去开新标签页 |
| `POST /resources/accessTokens/sdk` | `{ token }` | **喂给 WebSDK，在我方页面内渲染** |

`externalActionId` 字段官方说明原文：

> ⚠️ It is **required** when you generate an access token for applicant actions.

**本设计走 token 路线**（内嵌），不走 websdkLink。

### 1.4 现成 helper 不可直接复用（真接必炸）

`identity/onboarding/providers/sumsub/sumsub.client.ts:118` 的 `createActionSdkToken()`：

```ts
return this.post('/resources/accessTokens/sdk', {
  userId: input.applicantId,   // ← ① 语义错
  levelName: input.levelName,
  ttlInSecs: input.ttlInSecs ?? 600,
});                            // ← ② 缺 externalActionId
```

- ① `userId` 官方定义为「**你方**的客户标识，对应 applicant 的 `externalUserId`」。此处传的是 Sumsub 侧 `applicantId`。真实数据里两者不同（`applicantId=6a5de866…` vs `externalUserId=SHAWN-AML-A-04`），会绑到错误或新建的 applicant。
- ② applicant action 场景 `externalActionId` 必填，此处未传。

两处均被 `SUMSUB_MOCK_MODE=true` 的假返回掩盖。**本轮不修**（属 V2 材料重检路径，与充值无耦合），登记 BACKLOG。

### 1.5 `ACTION_PENDING` 的六条出边均非客户驱动

`deposit-transactions.service.ts:522`：`APPROVE` / `OPERATION_PENDING` / `SLA_BREACH` / `KYT_REJECTED` / `FREEZE` / `RESUME`。

这是**正确的**：真实世界里客户交完材料，我方单子不动，须等 Sumsub 重评后发新 webhook 才动。本设计不新增客户驱动的边。

---

## 2. 嵌入机制

Sumsub 确实在页面内以 iframe 渲染（`api.sumsub.com/websdk/websdk.html`），但该 iframe **由官方 JS 库创建**，不是我方设 `src`：

```js
const sdk = snsWebSdk.init(token, refreshFn)
  .withOptions({ adaptIframeHeight: true })
  .on('idCheck.onReady', hideLoader)
  .on('idCheck.onApplicantSubmitted', onSubmitted)
  .on('idCheck.onError', showRetry)
  .build();

sdk.launch('#sumsub-websdk-container');
```

**设计约束**：详情区里那块地方定义为**空容器（stage）**，不是"我方设 src 的 iframe"。

- 演示：容器内放我方 mock 认证页
- 真接：同一容器，改为 `sdk.launch()`

布局、高度、loading 遮罩、周边文案不变。

> ⚠️ **未核实项**：`websdkLink` 返回的 url 是否可被 iframe（身份验证类托管页通常设 `X-Frame-Options` 挡点击劫持）。本设计不依赖该 url，故不阻塞；若将来改走跳转路线需实测。

### 2.1 白捡的两条官方约束

- `idCheck.onApplicantSubmitted` 被官方列入「最少必接三事件」，原文：*Without this the user re-uploads or contacts support.* —— 即本设计 §4 态③的依据。
- 官方明示浏览器事件不可信：*The browser event fires from inside the iframe. A bad actor can spoof it trivially. The only authoritative signal is server-side.* —— 即「浏览器事件只改展示、状态机只认 webhook」的依据。

---

## 3. 数据模型

### 3.1 `DepositTransaction` 新增三字段

```prisma
sumsubActionId          String?    // Sumsub 侧 applicantActionId（admin 可见、可追溯）
sumsubExternalActionId  String?    // 铸 token 的键（applicant action 场景必填）
actionSubmittedAt       DateTime?  // 客户提交时间
```

**不新增「要客户交什么」字段**：`applyKytAwaitUser` 已在写 `manualReason = sceneTag === 'PEP' ? 'EDD_PEP' : 'CLIENT_ACTION'`（`deposit-workflow.service.ts:496`），客户端文案据此分岔即可。

> `EDD_PEP` 决定我方问客户要什么材料，**绝不出现在客户可见文案中**。

### 3.2 SLA 换表：靠 `actionSubmittedAt` 派生，不加字段

现状：`ONHOLD_SLA_DAYS = ACTION_SLA_DAYS = 7`（`deposit-workflow.service.ts:292`）。业主定调「换表，还是 7 天」——**换语义不换数字**。

```
actionSubmittedAt == null  →  该表在等客户
actionSubmittedAt != null  →  该表在等 Provider 重评
```

客户提交时：盖 `actionSubmittedAt` + `slaDeadline = now + 7d`。

`deposit-sla.service.ts:50` 的 breach 理由由写死改为分岔：

| 条件 | 理由 |
|---|---|
| 未提交 | `SLA breached: no compliance action before deadline`（不变） |
| 已提交 | `SLA breached: provider re-review exceeded deadline after customer submission` |

**选派生而非显式 `slaKind` 字段的理由**：两者是同一事实的两面，拆成两个字段会引入"已提交但 kind 未改"的不一致态。

### 3.3 修 `applyKytAwaitUser` 的早退

`deposit-workflow.service.ts:492`：

```ts
if (deposit.status === DepositTransactionStatus.ACTION_PENDING) {
  return; // 已在目标态,防重复 webhook
}
```

防重复正确，但**整段 return、不写任何字段**。加入 §3.1 三字段后成为缺陷：

Sumsub 在客户交完第一份后可再发一个带**新 `applicantActionId`** 的 awaitUser（"还不够，再交一份"）。此时单子仍在 `ACTION_PENDING`，直接 return，于是：

- 新 action id 存不进来 → 客户点进去仍是上一份材料的界面
- `actionSubmittedAt` 不被清 → 客户端仍显示"已收到，审核中"，**客户不知道又要交东西**
- SLA 表停在上次重置点

**改法**：状态不动，但 **action id 变化时刷新三字段、清 `actionSubmittedAt`、重置 `slaDeadline`**；action id 未变（真重复 webhook）才 return。

---

## 4. 前端

### 4.1 详情弹窗两尺寸

现为 `max-w-lg`（`Deposit.tsx:1158`），塞不下认证界面（官方要求容器 `min-height: 600px`）。

同一弹窗两态：点认证按钮后展开为宽版（`max-w-3xl` / `min-h-[680px]`），顶部保留窄条单据信息（金额 + 充值单号），使客户始终知道在为哪一笔认证；关闭认证收回小尺寸。

### 4.2 `ACTION_PENDING` 三展示态

| 态 | 判据 | 客户看到 |
|---|---|---|
| ① 待提交 | `actionSubmittedAt == null` | `ACTION REQUIRED` + 按材料类型文案 + 「Provide information」按钮 |
| ② 认证中 | 按钮点开 | 宽版容器 + loading 遮罩 → 认证界面 |
| ③ 已提交 | `actionSubmittedAt != null` | `PROCESSING` + 「已收到，审核中」 |

①文案按 **`materialKind`** 分岔（由 §5.1 的 session 端点返回），只说要什么、不说为什么：

| `manualReason`（服务端） | `materialKind`（下发客户端） | 客户看到 |
|---|---|---|
| `CLIENT_ACTION` | `SOURCE_OF_FUNDS` | *Please provide proof of source of funds* |
| `EDD_PEP` | `SUPPORTING_DOCUMENTS` | *Please provide additional supporting documents* |

> 两种文案不同是可接受的：要求不同材料属标准尽调，客户可见属正常。不可露的是「因为你是 PEP」。

⚠️ **`manualReason` 本身绝不下发**。`toCustomerDepositView()`（`deposit-transactions.service.ts:177`）是客户面字段白名单，其注释明确列出 `manualReason` / sumsub 元数据 / `limitHoldReason` / `slaDeadline` / `slaBreached` 均不得到达客户浏览器——DevTools 查看 JSON 即足以对被调查人通风报信。故服务端在 session 端点内把 `manualReason` 映射成中性的 `materialKind` 再下发，映射表不出现在前端。

### 4.2.1 白名单要开一个口子：`actionSubmittedAt`

态①/③ 的判据是 `actionSubmittedAt`，而**列表页**也要按它渲染徽章（否则列表显示 `ACTION REQUIRED`、弹窗显示 `PROCESSING`，自相矛盾）。故须把 `actionSubmittedAt` 加进 `toCustomerDepositView()` 白名单。

**这是一次有意开口，理由**：该字段记录的是**客户自己的动作**，客户本就知道自己交没交，不构成新信息；且它对执法态与正常态**一视同仁地存在**（提交过的单无论后来是 FROZEN 还是 COMPLIANCE_PENDING，该值都在），因此不产生新的可辨识信号。

**同时须改的两处**：
- 白名单注释补一句说明为何 `actionSubmittedAt` 可以在、`manualReason` 不可以
- `client-web/src/pages/Deposit.tsx` 的 `Transaction` 接口（注释里点名该表是"实际字段合同"，须同步）

### 4.3 泄密口：「已收到」必须绑时间戳，不绑状态

现 `VIEW_MAP` 纯按状态查表，而 FROZEN / SEIZING / SEIZED / MANUAL_CHECKING 四执法态为**光秃秃 `PROCESSING`、无 note**（`depositStatusView.ts`，2026-08-02 业主定稿，目的是与正常处理逐字段一致）。

若态③的 note 按状态给出，则：

> 客户提交 → 见「PROCESSING · 已收到，审核中」
> Sumsub 判回制裁 → 进 FROZEN → **该句消失，变光秃秃 PROCESSING**

客户可观测到一句话凭空消失 —— 正是 2026-08-02 收敛要堵的「一眼看出自己这单与众不同」。

**堵法**：态③的 note 绑 `actionSubmittedAt`，**不绑当前状态**。提交过即恒显该句，无论该单后来是真在审还是已被冻。冻结时刻客户端**零变化**。

### 4.4 mock 认证页

新增不带后台外壳的路由（与 `/login` 同级）：`/mock-verification?deposit=DEP…`

- 假材料上传界面（不真收文件）
- 「Submit」→ 调 `POST …/verification-session/submit` → 然后：

```js
window.parent.postMessage({ type: 'idCheck.onApplicantSubmitted' }, origin)
```

**故意复用真实 SDK 事件名**。父页面监听该消息切态③；将来换真 SDK 时，父页面 handler 由 `postMessage` 监听改为 `.on('idCheck.onApplicantSubmitted', …)`，内部逻辑不变。

### 4.5 admin 侧

充值详情加两行只读：`Applicant action id`、`Customer submitted at`。挂在现有详情返回里，**不新增端点**（故不涉及 RBAC catalog 登记）。

---

## 5. 接口

### 5.1 硬规矩：接口服从与渲染层同一条不可区分规则

新增 `GET /deposits/:depositNo/verification-session` 是一个**新的可观测面**。若其对 `ACTION_PENDING` 返 200、对 `FROZEN` 返 404，客户可直接由 devtools 问出自己那单是否被冻，渲染层防线归零。

```
GET /deposits/:depositNo/verification-session
  已提交过（无论现状态 ACTION_PENDING 还是 FROZEN）→ { submitted: true }（同一响应体）
  未提交且有未完成 action                          → { submitted: false, embedUrl, materialKind, actionId }
  其余                                              → { submitted: false, embedUrl: null }
```

```
POST /deposits/:depositNo/verification-session/submit
  本人的单且有 action id → 一律 200，幂等盖一次 actionSubmittedAt + 重置 slaDeadline
  不与状态耦合：冻结单上提交照收（收下不做事，好过返错误码告知对方"你这单不一样"）
  **不碰状态机**
```

他人的单 → 404（普通鉴权，与不可区分规则无关）。

### 5.2 不搭抽象层

按业主选定的「乙」，`embedUrl` 在演示中指向我方 mock 认证页。**不建 `DepositActionClient` 之类 http/mock 双实现抽象**（那是被否的「丙」），真接时直接改该接口实现体。

---

## 6. 错误处理

- iframe / SDK 加载失败 → 容器内给可重试 CTA（官方将 `idCheck.onError` 列入必接三件套）
- loading 遮罩必须有，`onReady` 才撤（官方：不接此事件是「widget 一片空白」报障的头号原因）
- 他人的单 → 404

---

## 7. 已堵与未堵（诚实边界）

| 客户可观测的变化 | 结论 |
|---|---|
| 提交后被冻 →「已收到」消失 | ✅ 本设计堵住（§4.3） |
| **未提交即被冻 →「ACTION REQUIRED」消失** | ❌ **未堵，且为既有缺陷** |

第二条今日已存在，非本功能引入。要堵只能「冻结后仍向客户索要材料」——等于诱使客户提交我方根本不会审阅的文件。**取舍：不堵，登记 BACKLOG。** 理由：第一条是「确认收到」凭空消失，信号更强且零成本可修；第二条须以欺骗为代价，不划算。

> 此项为合规口径，业主可覆盖。

---

## 8. 测试

### 8.1 单元

1. 视图表现有 8 条断言必须全绿（新签名用可选参数，不破坏既有调用）
2. 新不变量，**两个取值都测**：
   ```ts
   for (const submitted of [true, false])
     expect(view('FROZEN', { submitted })).toEqual(view('COMPLIANCE_PENDING', { submitted }))
   ```
3. **时序不变量**（对应客户实际观察）：
   ```ts
   expect(view('FROZEN', { submitted: true })).toEqual(view('ACTION_PENDING', { submitted: true }))
   ```
4. SLA breach 理由按 `actionSubmittedAt` 分岔
5. `applyKytAwaitUser` 早退：action id 变→刷新+清 `actionSubmittedAt`+重置表；未变→真 no-op

### 8.2 e2e

接现有 `test/deposit-sumsub-verdicts.e2e-spec.ts`，**沿用其 `e2e-` 库名硬守卫**（DATABASE_URL 不含 `e2e-` 即 throw）。

6. 完整弧：awaitUser 裁决 → session 可取 → 提交 → 时间戳落 + 表重置 + **状态未动** → 操作员点 ① Approved → SUCCESS
7. 接口不可区分：`GET session` 在 FROZEN-已提交 与 ACTION_PENDING-已提交 上响应体**全等**

### 8.3 变异测试（强制）

绿灯不算证据，能被弄红才算。

- 第 2/3/7 条写完后，**用 python 真实改写源码**（把「已收到」绑回 status），确认测试变红并指名定位；不红即测试无效，重写。
- 第 4 条同理：把 SLA 理由改回写死那句，确认变红。

> 背景：上一轮用 perl 做变异，`\Q…\E` 将 `\n` 当字面反斜杠 n，文件根本未被修改，"守卫为绿"的结论无意义。本轮禁用 perl 做变异。

---

## 9. 登记 BACKLOG

1. `createActionSdkToken()` 两处缺陷（`userId` 传错 + 缺 `externalActionId`），真接 Sumsub 前必修（§1.4）
2. 未提交即被冻时「ACTION REQUIRED」消失的可观测性（§7）
3. `websdkLink` 返回 url 的 iframe 可行性未实测（§2）

---

## 10. 不做（范围外）

- 不接真实 Sumsub（`SUMSUB_MOCK_MODE=true` 保持）
- 不搭 http/mock 双实现抽象层
- 不改 SLA 时长（保持 7 天）
- 不新增客户驱动的状态机边
- 不真实收取/存储客户上传文件
