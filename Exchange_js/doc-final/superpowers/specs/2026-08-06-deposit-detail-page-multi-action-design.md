# 充值详情独立页 + 多条 applicant action 设计

> 状态：设计定稿（2026-08-06 业主逐段确认）
> 承接：`2026-08-04-deposit-applicant-action-embed-design.md`（下称「上一轮」）
> 分支：`feat/deposit-action-embed`（上一轮已完成、未合 main，本轮在其上继续）

---

## 0. 这轮改什么

业主提出三条交互调整：

1. 充值详情**不再用弹窗**，改成右侧区域内跳转到独立页面；页面变大，字段重新布局。
2. applicant action **可以有多条**，点哪条展示哪条的认证。
3. 点 action 按钮**再跳一个页面**，在那个页面里进入 Sumsub SDK。

这三条看起来都是 UI，实际会捅到上一轮刚加固的 tipping-off 防线——本文大半篇幅在处理这件事。

---

## 1. 决策记录（业主逐条拍板）

| # | 岔口 | 定稿 | 理由 |
|---|---|---|---|
| D1 | 多条 action 怎么存 | **子表** | JSON 列在 SQLite + Prisma 下无法 where 过滤，筛选桶那条防线会被迫降级成内存过滤，而列表是服务端分页的，一分页就错 |
| D2 | 认证界面用哪条 Sumsub 路径 | **token 内嵌** | 保住 `idCheck.onApplicantSubmitted` 这条前端信号（客户一交我们就知道）；跳 `websdkLink` 则只能等 webhook |
| D3 | action 的展示标签 | **只给序号** | 按 `externalActionId` 前缀猜类型，等于把上一轮封掉的「为什么要你交」那 1 比特从后门放回来 |
| D4 | 「这单算不算已提交」 | **全部交齐** | 交一条就算完 → 客户以为交完了、剩下的永远不动，那是 bug 不是选项 |
| D5 | `actionSubmittedAt` 保留还是推导 | **保留，当缓存** | 见 §2.2 |

**协调者自行判定（业主未明说，可推翻）**：demo 必须能真演出多条 action。理由：业主要的交互是「点哪条看哪条」，演示里若永远只有一条，这个交互无从验收。

---

## 2. 数据模型

### 2.1 新表

```prisma
model DepositApplicantAction {
  id                    String   @id @default(uuid())
  depositTransactionId  String
  applicantActionId     String        // Sumsub 侧 id
  externalActionId      String        // 铸 token 的钥匙，一条 action 一个
  seq                   Int           // 客户面唯一可见的定位符
  createdAt             DateTime @default(now())
  submittedAt           DateTime?     // 这一条的提交时刻

  deposit DepositTransaction @relation("DepositApplicantActions", fields: [depositTransactionId], references: [id], onDelete: Cascade)

  @@unique([depositTransactionId, applicantActionId])   // 重复 webhook 幂等
  @@index([depositTransactionId, seq])
}
```

充值单上原有的 `sumsubActionId` / `sumsubExternalActionId` 两个标量迁入本表后**删除**。

### 2.2 `actionSubmittedAt` 留在充值单上，语义改为「所有 action 都交齐的时刻」

本节是这轮唯一需要论证的取舍。

上一轮把五层防线全部挂在这个字段上：客户端徽章文案、`completedAt` 收敛判据、筛选桶谓词、SLA 换表、审计写入条件。多条 action 之后有两条路：

- **推导式**：删字段，凡判断处查子表（`actions: { some: { submittedAt: null } }`）。单一真相，永不漂移。代价是五层全改，且每条读路径都要 include 关联。
- **缓存式**：字段保留，语义改成「全部交齐的时刻」。维护点只有两个（见下）。五层一行不动。

**选缓存式。** 它确实是冗余的——但上一轮在这五层里踩出过三个 Critical（`actionId` 泄 PEP 判定、「提交过即恒显」吃掉终态、`completedAt` 在冻结与解冻两次泄露），**每一个都是改动这几层时漏掉一条弧造成的**。多条 action 是个 UI 需求，不值得把这五层再掀一遍。

**唯二的维护点：**

1. 某条 action 提交后 → 若该单已无 `submittedAt IS NULL` 的行，盖上 `actionSubmittedAt`
2. 新 action 进来 / 撤回后仍有未提交行 → 清空 `actionSubmittedAt`

**漂移的堵法**（§5 测试 1）：对随机构造的 action 提交组合，断言标量与子表推导出的结论一致。漂了即红。

### 2.3 `seq` 一旦分配不再变

它进 URL（`/verification/2`）。客户收藏了链接、或页面开着时来了新 action，都不能让第 2 条变成第 3 条。新 action 取 `max(seq) + 1` 往后追加。

---

## 3. 路由与页面

### 3.1 三条路由

```
/deposit                              列表（保留；弹窗删除）
/deposit/:depositNo                   详情页          ← 新
/deposit/:depositNo/verification/:seq 认证页          ← 新
```

两个新页面都挂在 `CustomerDashboardLayout` 内（业主要的「右侧区域」），侧栏常驻。

`Deposit.tsx` 现 1388 行，详情与弹窗（约 200 行）搬走后显著变薄。

### 3.2 详情页布局

自上而下：

1. **返回链接**（← Deposits）
2. **金额 hero** + 单号/网络（等宽字体）+ 状态徽章（右上）
3. **Outstanding verification** 区块——**仅在存在 action 时渲染**
   - 每条 action 一张卡：序号标签、请求时间、按钮
   - 已提交的那条：**无按钮、颜色收敛成次要色**，表达「这件事完了」而不是「按钮变灰了」
4. **Details** 网格：提交时间、Reference、From address、Transaction hash

排序依据：客户点进来唯一需要动作的是补料；转账哈希这类事后追溯字段沉底。原弹窗恰好相反。

### 3.3 客户端从头到尾拿不到 action id

直接来自上一轮的 Critical：当时 `actionId` 出现在响应体里，而 demo fixture 的 id 是 `aa-edd-0002`——`edd` 三个字母把「为什么要你交材料」写在脸上。

| | 客户端 | 服务端 |
|---|---|---|
| 定位一条 action | `seq`（1/2/3） | `applicantActionId` |
| 铸 token 的钥匙 | ❌ 永不下发 | `externalActionId` |

前端回传 `seq`，服务端查表换真 id 去铸 token。**不是靠「记得别下发」，是客户端根本没有这个字段可漏。**

### 3.4 `/mock-verification` 独立路由删除

它当初为被 iframe 嵌套才做成鉴权之外的全屏页（上一轮评审已指出该路由注册在 AuthGuard 之外）。改成 token 内嵌 + 独立页面后，那个假上传界面**降级为认证页内的一个组件**：demo 模式渲染它，真接时同一位置换成 `snsWebSdk.launch()`。

净收益：少一条路由、少一个任何人可直接访问的页面、少一层 iframe 通信。

---

## 4. 接口

### 4.1 详情响应新增 `actions`

客户面白名单再开一个口（与上一轮开 `actionSubmittedAt` 同等对待，注释须写明理由）：

```ts
actions: [{ seq: 1, submittedAt: null }, { seq: 2, submittedAt: '2026-08-06T...' }]
```

**只有这两个键。** 无 id、无类型、无理由。够画列表和各自状态，多一个字段都是风险面。

### 4.2 会话接口改为按条取

```
GET  /deposit-transactions/my/:depositNo/verification-session/:seq
     → { submitted: boolean, sdkToken: string | null }

POST /deposit-transactions/my/:depositNo/verification-session/:seq/submit
     → { ok: true }
```

**不可区分规则原样适用，粒度从「整单」降到「这一条」**：响应体只由该条 action 的 `submittedAt` 决定，绝不由充值单 `status` 决定；`POST` 对任何状态恒 2xx。

`seq` 不存在时返回与「单子不存在 / 不属于本人 / BELOW_MIN 隐藏单」**完全相同**的 404，不新增探测面。

### 4.3 demo 与真接怎么共用这个接口

`sdkToken` 在 demo 模式下由 mock 客户端返回占位串（与既有 `createActionSdkToken` 的 mock 分支同口径），真接时是 Sumsub 的真 token。

**认证页判断该渲染谁，不靠接口新增字段**——用客户端既有的 `useSimulationMode()`（`client-web/src/utils/simulationMode.ts:36`，`Deposit.tsx` / `Verification.tsx` 已在用）：

| 模式 | 认证页渲染 |
|---|---|
| 演示 | 内置的假上传组件（由 §3.4 被降级的那个页面改造而来） |
| 真接 | `snsWebSdk.init(sdkToken, …).launch('#container')` |

不给响应体加 `mock: boolean` 之类的字段，理由有二：它是**系统级模式、对所有客户取值相同**，本就不该混进按单查询的响应；且客户面响应每多一个键就多一分泄漏面——上一轮的 Critical 正是这么来的，那条钉死响应 key 集合的断言也会拦住它。

---

## 5. 后端行为

### 5.1 裁决管道：集合比对

`applyKytAwaitUser` 从「比对单个 id」改为比对集合：

| 报文集合 vs 库内集合 | 处理 |
|---|---|
| 有新 id | 插行、分配 `seq`、清 `actionSubmittedAt`、重置 SLA 表、记 `DEPOSIT_ACTION_REISSUED` |
| 完全一致 | 真 no-op（重复 webhook） |
| 库内有、报文无 | **删除其中未提交的行**（已提交的不动，那是历史） |

第三行非业主需求，是协调者主动加的：Sumsub 报文带的是**当前全量列表**，若它撤回一条而我方保留，该行永远算作未提交 →「全部交齐」永不成立 → **客户永久卡死**。这与上一轮 `applyKytAwaitUser` 早退 bug 是同款形状、不同入口。

### 5.2 审计带真 id——它是给运营看的

与客户面正好相反，须写清以免后人搞混：

| | 客户面 | 审计 |
|---|---|---|
| action id | ❌ 永不下发 | ✅ 必须带，否则运营对不上 Sumsub 后台 |

- `DEPOSIT_ACTION_SUBMITTED`：metadata 带 `seq` + `applicantActionId`
- `DEPOSIT_ACTION_REISSUED`：带新增与撤回的清单

### 5.3 SLA 不变

仍由充值单的 `actionSubmittedAt` 驱动（§2.2 的缓存语义使这一层零改动）。新 action 进来清空该字段 → 自动切回「等客户」并重置 7 天。

---

## 6. 测试与验收

### 6.1 三条本轮特有的守卫

1. **绑死两种表示**（防 §2.2 的缓存漂移）：随机构造 N 条 action 的提交组合，断言充值单 `actionSubmittedAt` 与子表推导结论一致。
2. **逐条不可区分**：同一条 action，在充值单为 `ACTION_PENDING` 与 `FROZEN` 时，`GET verification-session/:seq` 响应体全等。
3. **集合比对三情况**各一条，尤其「报文撤回未提交 action 后客户不再被卡住」。

### 6.2 整体断言，不是单字段断言

上一轮三个 Critical **全部是只盯单个字段才漏的**。本轮每个任务都要带一条**整体**断言——比对整个响应对象 / 整个渲染输出，而非单个字段。

### 6.3 变异验证

每条守卫都必须能被弄红才算数。用 python 做替换（**禁止 perl**：`\Q…\E` 会把 `\n` 当字面反斜杠 n，文件根本没改却误判为绿——本项目已实证）；**禁止 `git checkout` 还原**（会丢未提交的实现）。

### 6.4 验收准备

新增裁决按钮 **⑩ Awaiting user · 多条**，一次吐 3 条 action，用于验证：

- 能分别点开第 1、2、3 条，各自进入自己的认证界面
- 交完 2 条时徽章仍为 `ACTION REQUIRED`、仍落 `ACTION_REQUIRED` 桶
- 交完第 3 条才切「已收到，审核中」并落 `PROCESSING` 桶

### 6.5 渲染验收必须走真实路径

造冻结态**必须调真实 admin 接口**（`PATCH :id/status` → `adminFreeze` → `updateStatus`），不得直接改库。上一轮正是因为改库绕过了 `updateStatus`，`completedAt` 从未被写，**验收方法自己把洞盖住了**。

---

## 7. 已知取舍与不做的事

- **未提交即被冻仍可观测**：客户尚未提交时被冻，视图从 `ACTION REQUIRED`/warning/索要文案变为 `PROCESSING`/neutral/无 note。属上一轮已登记的设计取舍，本轮不处理。
- **不猜 action 类型**（D3）：客户点进认证界面之前不知道要准备什么。有意接受——具体材料由验证组件自己告知。
- **越权路由**（`GET /deposit-transactions` 等四条缺 `assertAdmin`）：已在 `fix/deposit-transactions-authz` 分支单独处理，不进本轮。
