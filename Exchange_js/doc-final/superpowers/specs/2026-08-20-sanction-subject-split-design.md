# 制裁命中分主体 —— 第二批设计稿

- **日期**：2026-08-20
- **批次**：三域合规一致化 第二批
- **状态**：业主已逐节确认，待转 writing-plans
- **前置**：第一批「合规裁决落地」已合 main（`df9554df`），本稿多处依赖其 `decideVerdictLanding` 不变量

---

## 0. 背景与范围

### 0.1 要解决的问题

制裁命中有两种主体，系统今天只做了一种：

| 主体 | 含义 | 今天的处置 | 应有的处置 |
|---|---|---|---|
| **对手方** | 打款方/收款地址在名单上 | 冻这一单 | 冻这一单（不变） |
| **客户本人** | 我方客户自己在名单上 | **同样只冻这一单** ❌ | **冻单 + 冻人** |

根因是信号层不分主体：Sumsub 回来一个 `SANCTION` 标签，三个域都只当"这笔单有制裁问题"处理，无法区分是谁被制裁。

### 0.2 本批三件事

1. **充值**：客户本人命中 → 冻单 + 冻人
2. **提现**：同上（对称）
3. **兑换**：新增 `FROZEN` 状态，客户端展示为 `Unsuccessful`

### 0.3 明确不做（本批边界）

- **状态机跃迁的其它格子**：第一批已收口，本批不动
- **半截账**：兑换 `PROCESSING` 不设 FROZEN 入边，问题不产生（见 §3.2）
- **对手方恰好是我的客户**（交叉场景）：BACKLOG
- **SLA / 超时**：第三批

### 0.4 项目约定（实现时必须遵守）

本系统是 demo，数据可随时格式化重铺。**禁止**为旧数据写 backfill、迁移兼容层、双写过渡或向后兼容列。改完数据结构 = 重置重铺。

---

## 1. 信号层：`SANCTION` 拆成两个标签

### 1.1 拆分

| 新标签 | 主体 | 处置 |
|---|---|---|
| `SANCTION_APPLICANT` | 客户本人 | 冻单 + 冻人 |
| `SANCTION_COUNTERPARTY` | 对手方 | 只冻单（今天的行为） |

旧 `SANCTION` **标签**直接退役，不留兼容层、不做映射。

### 1.2 关键区分：标签 ≠ 因由

全仓 `SANCTION` 有两种完全不同的用法，**只拆前者**：

| 用法 | 是什么 | 本批 |
|---|---|---|
| **(A) Sumsub 标签** | 交易裁决报文里的 `typedTags[].label` | **拆成两个** |
| **(B) 限制因由** | `customer_restrictions.cause` | **不拆**，永远单一 `'SANCTION'` |

因由不拆的理由：人被冻的**原因只有一个**——他被制裁了。至于是哪笔单牵出来的，属于取证问题，审计日志逐笔记全了。

### 1.3 另一条独立通路（不要混淆）

系统里还有一条 **applicant 级** 制裁通路，走的是 Sumsub 客户身份审查的 `SANCTIONS_*` 标签命名空间：

```
client-risk-assessment.service.ts:310  reviewAnswer==='RED' && labels.some(l => l.startsWith('SANCTIONS_'))
  → :443 handleSanctionsPath()
  → :451 open({ cause: 'SANCTION', caseRef: assessment.id })
```

它与本批新增的**交易级** `SANCTION_APPLICANT` 完全独立、不同源。两者都会开 `cause='SANCTION'` 的便签 —— 这正是 §4 要统一 `caseRef` 的原因。

### 1.4 ⚠️ 拆分引入的静默丢失 bug（必须同时修）

充值/提现的 `sceneTag` 是**标量**，循环里后写覆盖先写：

```typescript
// deposit-kyt-verdict.handler.ts:80 / withdraw-kyt-verdict.handler.ts:82
for (const tag of detail.typedTags) {
  if (tag.type !== 'userDefined') continue;
  if (SCENE_TAGS.has(tag.label)) sceneTag = tag.label as 'SANCTION' | 'PEP';  // ← 覆盖
}
```

一笔交易同时命中 `SANCTION_APPLICANT` + `SANCTION_COUNTERPARTY` 完全可能（本人在名单上、且转给了受制裁地址）。拆分后哪个生效**取决于报文里标签的先后顺序** → "本人命中"有一半概率被静默降级成"只冻单不冻人"，且无任何日志。

**裁决：`SANCTION_APPLICANT` 优先。** 漏冻人的代价远大于多冻一次。实现上二选一：
- 把 `sceneTag` 改成集合（向兑换的 `typedTags: string[]` 看齐），下游按优先级判；或
- 保留标量但在赋值处显式判优先级（已是 APPLICANT 就不再被 COUNTERPARTY 覆盖）

同时 `as 'SANCTION' | 'PEP'` 这个**硬类型断言**必须跟 `SCENE_TAGS` 同步改 —— 它是这条链上唯一的类型盲区，Set 加了新标签而联合类型没跟着改时 TS 不报错，运行时把新标签当旧值传下去，下游 `=== 'SANCTION'` 恒 false。

### 1.5 ⚠️ 兑换那一行是无类型保护的命门

```typescript
// swap-workflow.service.ts:872
const hasSanction = (input.typedTags ?? []).includes('SANCTION');
```

纯字符串数组 `includes`，**TypeScript 抓不到**。漏改的后果是连锁的：

```
includes('SANCTION') 恒 false
  → hasSanction = false
  → restrictionCause 掉进 KYT_REJECTED_SOFT
  → markHardLineDisposition 不盖章
  → 走软线 → 开一个面向客户的补料请求
  → 客户被告知"请补充材料" = tipping-off，合规防线整条失效
```

**必须有一条测试把这一行钉死。**

---

## 2. 处置层：冻单 + 冻人

### 2.1 落地点

充值/提现各有一个现成的、语义唯一的落点：

```typescript
// deposit-workflow.service.ts:764（提现同构于 withdraw-workflow.service.ts:2657）
if (sceneTag === 'SANCTION' || dispoTag === 'FROZEN_BY_MLRO') {
  if (deposit.status === FROZEN) return;              // ← 幂等守卫，load-bearing
  await updateStatus(depositId, { action: FREEZE });  // ← 冻单
  await recordSystem({ action: DEPOSIT_FROZEN, ... }); // ← 审计
}
```

**改成**：

| 标签 | 冻单 | 冻人 |
|---|---|---|
| `SANCTION_APPLICANT` | ✅ | ✅ `open({ cause: 'SANCTION' })` |
| `SANCTION_COUNTERPARTY` | ✅ | ❌ |
| `FROZEN_BY_MLRO`（处置标签，非本批） | ✅ | ❌（维持现状） |

接在 workflow 层而非 handler 层，理由：handler 层会绕过 `applyKytVerdict:344` 的 `decideVerdictLanding` 判定闸门 —— 已 FROZEN / 已终态的单也会去冻人。第一批的"判定先于写库"不变量必须保住。

### 2.2 今天充值/提现根本没有冻人能力

全库 grep 证实：`customerRestrictionsService.open()` 在整个 `src/modules/trading/` 下**只有兑换调用**（`swap-workflow.service.ts:906`）。充值/提现两个域对客户限制是**纯消费者**（只订阅事件冻单），从来不是生产者。这正是"充值制裁只冻单不冻人"的根因。

**这是新建能力，不是改标签名。**

好消息：模块接线已经全通 —— 两个模块都已 `forwardRef(() => CustomersModule)`，`CustomersModule` 已导出 `CustomerRestrictionsService`。**只需在两个 workflow 的构造函数加一个参数，不要动模块图**（本项目有 `CustomersModule` 三处 forwardRef 成环的旧伤）。

### 2.3 冻单与冻人的先后：先冻人、再冻单

两者分属**两次独立提交**（`open()` 自开 `$transaction`，`updateStatus` 是独立 update），中间崩会留半成品：

| 顺序 | 崩在中间的残局 | 能否自愈 |
|---|---|---|
| 先冻单、后冻人 | 单冻了、人没冻 → 客户还能开新单 | ❌ 危险 |
| **先冻人、后冻单** | 人冻了、单没冻 | ✅ `open()` 的广播会把在途单冻掉 |

**裁决：先冻人、再冻单。** 与兑换现有的成文范式一致（`swap-workflow.service.ts:895-901` 注释："先 restrict 再暴露入口……不要因为看起来能合并成一次就调换，它是 load-bearing 的"）。

### 2.4 ⚠️ 事件回环与误导性 warn（本批一并修）

`open()` 成功后广播 `CUSTOMER_RESTRICTION_OPENED`，三域各有监听器扫在途单批量冻结。于是本域自己刚冻的那笔单会被自己的监听器再冻一次：

```
FROZEN 行没有 FREEZE 自环边
  → getNextStatus 返回 undefined
  → BadRequestException("Invalid action 'freeze' for status 'FROZEN'")
  → 被 deposit-workflow.service.ts:2995 的 try/catch 吞成
    logger.warn("Failed to freeze in-flight deposit ... : Invalid action 'freeze' for status 'FROZEN'")
```

功能上不致命（逐项容错、不中断循环），但每次制裁都刷一条**与事实不符**的 warn。

**修法**：监听器循环里跳过已 `FROZEN` 的单。不加自环边（自环边会让"冻结"变成可重入操作，语义更糟）。

### 2.5 ⚠️ 批量冻单零审计（第一批遗留，本批补齐）

三域的 `onCustomerRestrictionOpened` 监听器批量把在途单打到 FROZEN，**全程零 `auditLogsService` 调用**。违反项目铁律 ①（有持久状态、operator 可见的操作必须写审计）。

额外注意：**充值域的 `updateStatus` 自身不写审计**（`deposit-transactions.service.ts:590-677` 全方法零审计调用），而提现的 `updateStatus` 内建 `recordByActor`（`withdraw-transactions.service.ts:702`）。**充值域任何调用方都必须自己补审计，别指望 `updateStatus` 兜底。**

---

## 3. 兑换：新增 `FROZEN` 状态

### 3.1 今天的问题

兑换今天是 4 个活态（`COMPLIANCE_PENDING` / `PROCESSING` / `SUCCESS` / `REJECTED`，另有 `FAILED`/`REVERSED` 两个已登记 BACKLOG 的不可达死枚举）。

**问题一**：客户命中制裁 → 单子进 `REJECTED`，与"这笔对手方有风险"的普通拒绝**同一个状态**，运营在列表页分不出。

**问题二（更严重）**：冻人广播打到在途兑换单时，**状态根本不变** —— 只 `setNeedsReview(true)` + 写一条审计。状态栏还写着 `PROCESSING`，一个永远不会再动的单子伪装成"处理中"。

而 `needsReview` 是**复用**的旗标：

| 同一个旗 | 实际含义 | 运营该做什么 |
|---|---|---|
| 腿重试耗尽 | 技术卡单 | **点 Resume 重试** |
| 客户被制裁 | 人被冻了 | **别碰，等 MLRO** |

制裁客户的单子混在卡单堆里，旁边挂着 Resume 按钮。点下去会被守卫再拦一次（不会真放行），但运营看到的是"点了没反应"——不知道自己在碰一个制裁单。

**加 FROZEN 的本质**：把"技术卡住"和"人被冻结"从同一个布尔旗里拆开。同时兑现 BACKLOG:232 的第一个选项。

### 3.2 状态机：一条边，两个驱动方

```
COMPLIANCE_PENDING ──FREEZE──> FROZEN     ← 唯一入边
FROZEN: {}                                 ← 零出边，终态
```

**`PROCESSING` 不设入边**（业主裁决）。这一刀砍掉了半截账问题：兑换的 `PROCESSING` 是四条腿正在逐条过账，冻结落在半程会把账本劈成两半。腿一旦开跑就不再有冻结介入。

**同一条边有两个驱动方**（不要误读成"只由本单 KYT 驱动"）：

| 驱动方 | 场景 |
|---|---|
| 本单 KYT 裁决 | 兑换单自己收到 `SANCTION_APPLICANT` |
| 跨域冻人广播 | 客户在充值/提现单上本人命中，或 CRA 命中 |

在途的 `COMPLIANCE_PENDING` 兑换单**两种情况都进 FROZEN**，三域行为由此拉齐。只有 `PROCESSING` 的单维持今天的停腿行为（残余混淆见 §7）。

### 3.3 客户端展示：在服务层收敛，不在前端映射

**业主口径**：兑换 FROZEN 在客户端展示为 `FAILED` / `Unsuccessful`。

**但实现层不能靠前端映射。** 兑换今天的客户视图是原样透传：

```typescript
// swap-transactions.service.ts  toCustomerSwapView
return { id, swapNo, status: item.status, ... };   // ← 原始状态直接下发
```

前端把 `FROZEN` 渲染成 `Unsuccessful` 只挡眼睛 —— 客户打开 devtools 就看到 `status: "FROZEN"`。

**正解：在 `toCustomerSwapView` 把 `FROZEN` 收敛成 `REJECTED`。**

| 层 | 效果 |
|---|---|
| 响应体 | 给客户的是 `'REJECTED'`，与普通 KYT 拒绝**逐字相同** → 分不出 ✅ |
| `swapStatusView.ts` | 已有 `REJECTED → 'Unsuccessful'` → **不用加映射** |
| `client-web/pages/Swap.tsx:36` 终态集合 | 已含 `REJECTED` → **无限轮询问题自动消失** |

**前端零改动。** 这比"加 FROZEN 映射"既更安全又更省事。

### 3.4 客户面收敛规则：抄充值的白名单，不要用黑名单

充值域这套机制附有一段成文的设计理由（`deposit-transactions.service.ts:82-91`），必须照搬其**方向**：

> 黑名单必然滞后……状态机将来任何新增的执法态，只要没人记得手工把它加进黑名单，就会原样下发……必须反过来：只有这七个"客户本就该看到真实结果"的态原样输出，其余任何状态——现在的、遗留的、未来新增的——一律收敛。**宁可错杀，不可放过。**

兑换照此建立：

```typescript
// 客户本就该看到真实结果的态，原样输出。
const SWAP_CUSTOMER_STATUS_PASSTHROUGH = new Set<string>([
  'COMPLIANCE_PENDING', 'PROCESSING', 'SUCCESS', 'REJECTED',
]);

// FROZEN 显式收敛成 REJECTED —— 它是终态（零出边），收敛成终态才不会让
// 客户端永远转圈；且与普通拒绝同词，客户分不出。
// 其余任何未列出的状态（含未来新增）一律收敛成 COMPLIANCE_PENDING —— 与
// 充值同一条「宁可错杀」的兜底，避免白名单滞后于状态机。
```

⚠️ **收敛目标为什么与充值不同**：充值的 FROZEN 是**可逆的**（`RESUME → COMPLIANCE_PENDING`），收敛成"处理中"是诚实的；兑换的 FROZEN 是**零出边终态**，收敛成"处理中"就是一个永远不会兑现的谎，还会让客户端无限轮询。**状态语义不同，收敛目标就该不同。**

### 3.4b ⚠️ 筛选面也要堵（比响应体更直接的探测面）

`SwapTransactionQueryDto` 同时被 admin 列表和客户端 `GET /swap-transactions/my` 复用（`swap-transactions-customer.controller.ts:155`），而 `findAllForCustomer` 把 `...query` **原样透传**给 `findAll`（`:295 if (status) where.status = status`），**没有任何 customerScope 门**。

今天不出事只因 `FROZEN` 还不是合法枚举值，`@IsEnum` 挡回 400。**枚举一加，洞就开**：`GET /swap-transactions/my?status=FROZEN` 返回非空 = 客户自证被制裁冻结。响应体收敛挡不住这个 —— 过滤发生在收敛之前。

**照抄充值的修法**（`deposit-transactions.service.ts:197`，注释标明「评审 Important 1(a)，安全洞」）：

```typescript
if (status && !options?.customerScope) { where.status = status; }
```

客户面完全忽略 `status` 参数；admin 侧行为不受影响。

### 3.5 两份终态集合的处理（结论相反，不要一刀切）

| 集合 | 加不加 FROZEN | 理由 |
|---|---|---|
| `KYT_VERDICT_TERMINAL_STATUSES`<br>（`swap-workflow.service.ts:465`） | **不加**，改为单写一行<br>`if (status === FROZEN) return 'IGNORE'` | 语义是"冻了所以忽略"，不是"终态所以忽略"。与第一批充值/提现同款。<br>**但这一行必须写**：不写则 Sumsub 重投同一条 webhook 时不 no-op，一路走到 `markStatus(FREEZE)`，FROZEN 零出边 → 抛 `Invalid transition` → handler 未捕获 → 事件标 FAILED → 三次重试后进死信 |
| `SWAP_TERMINAL_STATUSES`<br>（`swap-transactions.service.ts:85`） | **不加**（业主裁决） | 进了会自动作废该单在途的材料请求 → 客户端"请上传XX"的卡片突然消失 = 可感知的变化。<br>业主口径："这些都是独立的东西，没啥非要清空的必要"。零痕迹优先 |

### 3.6 ⚠️ `findNonTerminalByOwner` 硬编码（改集合修不好它）

```typescript
// swap-transactions.service.ts:747
where: { ownerId, status: { notIn: ['SUCCESS', 'REJECTED'] } }   // ← 字面量，没复用 :85 的集合
```

唯一调用方就是 `onCustomerRestrictionOpened`。不改的话：刚冻的单会被自己的监听器当"在途"捞出来 → `assertSwapCustomerAccessOrHalt` 给它打 `needsReview=true` + 写一条 `SWAP_LEG_HALTED_BY_RESTRICTION` → admin 详情页在一张**零腿冻单**上弹"Needs review — 裁决在批准/执行后到达"，文案与事实完全不符，且污染审计。

**⚠️ 这里有个陷阱**：直接改成 `notIn: [...SWAP_TERMINAL_STATUSES]` **修不好**，因为 §3.5 裁定 FROZEN **不进**那个集合（进了会撕材料请求）。照抄集合等于 `notIn: ['SUCCESS','REJECTED','FAILED','REVERSED']`，FROZEN 单照样被当在途单捞出来。

**处方：引入第二个常量，两个判据物理分开。**

```typescript
// swap-transactions.service.ts:85 附近
// 「单据生命周期已结束」—— 材料请求监听器/admin 列表用。FROZEN 不在内：
// 被制裁客户的在途材料请求要留着不撕（零痕迹，见设计稿 §3.5）。
export const SWAP_TERMINAL_STATUSES: ReadonlySet<string> = new Set([SUCCESS, REJECTED, FAILED, REVERSED]);

// 「不再需要被冻结扫描捞起」—— findNonTerminalByOwner 专用。FROZEN 在内：
// 已经冻了的单不需要再冻一次。
export const SWAP_FREEZE_SCAN_EXCLUDED: ReadonlySet<string> =
  new Set([...SWAP_TERMINAL_STATUSES, SwapTransactionStatus.FROZEN]);
```

`findNonTerminalByOwner` 用后者。**两个集合都必须带上这段注释**，否则下一个人会"顺手合并成一个"。

### 3.6b 🔑 四个判据的 FROZEN 归属对照表（本批最易错处）

兑换域改完后会有 **4 个按状态分类的判据**，FROZEN 在每个里的归属**都不一样**。实现前先对这张表：

| # | 判据 | FROZEN 在内？ | 消费方 | 错了会怎样 |
|---|---|---|---|---|
| 1 | `SWAP_TERMINAL_STATUSES` | **否** | 材料请求作废监听器、admin 材料请求列表 | 放进去 → 自动撕掉被冻客户在途的材料请求 → 客户端卡片消失 = **泄密** |
| 2 | `SWAP_FREEZE_SCAN_EXCLUDED`（新增） | **是** | `findNonTerminalByOwner` → 冻结广播扫描 | 不放 → 刚冻的单被自己的监听器再捞一次 → 零腿冻单上弹"Needs review"假横幅 + 污染审计 |
| 3 | `KYT_VERDICT_TERMINAL_STATUSES` | **否**，另写一行 `if (status === FROZEN) return 'IGNORE'` | `applyKytVerdict` 幂等闸 | 两者都不做 → Sumsub 重投 webhook → `markStatus(FREEZE)` 打到零出边的 FROZEN → 抛 `Invalid transition` → 未捕获 → 事件 FAILED → 三次重试后**进死信** |
| 4 | `SWAP_CUSTOMER_STATUS_PASSTHROUGH`（新增） | **否**（显式收敛成 `REJECTED`） | `toCustomerSwapView` | 放进去 → `status: 'FROZEN'` 原样下发客户 = **泄密** |

> **记法**：只有 #2（"这单还需不需要被冻"）答"已经冻了，别管了"，其余三个都答"FROZEN 不算普通终态，要特殊对待"。

### 3.7 `rejectReason` 需要新值

`SwapRejectReason = 'KYT_REJECTED' | 'TIMEOUT'` 是兑换单**唯一**的失败原因列。冻结时两个现有值都不对，不扩就只能传 `undefined` → admin 详情页和取证时都看不出这笔为什么被冻。需加一个表达"制裁冻结"的值。

另需明确 `FROZEN` 作为终态要不要写 `completedAt`（现在只在 `SUCCESS` 时写）。

### 3.8 ⚠️ 有一条 e2e 会直接变红

```typescript
// test/customer-restrictions.e2e-spec.ts:514-531
// ……落地成 assertSwapCustomerAccessOrHalt()：拦住推腿 + 写一条
// SWAP_LEG_HALTED_BY_RESTRICTION 审计，**不新增 SwapTransactionStatus.FROZEN**
// （该状态从未设计过，兑换域也没有这条状态机边）。
expect((await prisma.swapTransaction.findUnique({ where: { id: sw.id } }))!.status).not.toBe('FROZEN');
```

这条用例**主动断言兑换没有 FROZEN**，与本批设计正面冲突。用例断言和注释都要重写 —— 注释是当前设计意图的书面记录，不改会误导后来人。

---

## 4. `caseRef` 改客户级（业主裁决）

### 4.1 要达到的效果

一个客户身上**永远只有最早的那一张** `SANCTION` 便签，后续命中不再贴新条子。

业主理由：双命中太常见 —— **充值是别人打钱进来，我们拦不住**，同一个被制裁的人会反复触发。

### 4.2 ⚠️ `caseRef: null` 是"完全不去重"，正好相反

```typescript
// customer-restrictions.service.ts:165
// caseRef 为 null 的手工便签不去重 —— 运营可对同一客户开多张 PENDING_DOCUMENT，各要一份材料
if (caseRef !== null) { ...去重查询... }
```

传 `null` 会变成**每次命中贴一张**。必须传一个**具体的客户级常量**。

**取 `customerNo`**（业务键；符合铁律 ③，且 admin 上不暴露 UUID）。

### 4.3 改动范围：只改 `cause='SANCTION'` 的三处

| 调用点 | 今天的 caseRef | 改成 |
|---|---|---|
| `client-risk-assessment.service.ts:455` | `assessment.id` | `customerNo` |
| `sumsub-ingestion.service.ts:215` | `assessmentId` | `customerNo` |
| `swap-workflow.service.ts:910`（仅 SANCTION 分支） | `swap.swapNo` | `customerNo` |
| 新增：充值 / 提现 | — | `customerNo` |
| `prisma/seed.business.ts:575`（Carol） | `'SEED-SANCTION-CAROL'` | `customerNo`（demo 重铺） |

**不改**：兑换的 `KYT_REJECTED_SOFT` / `KYT_REJECTED_HARD` 便签保持 `caseRef=swapNo` —— 那是按单的处置，不是客户级事实。其它 cause（`PENDING_DOCUMENT`、升级类等）一律不动。

### 4.4 ⚠️ 配对改：`autoRelease` 不同步 = 解冻静默失效

MLRO 在 Sumsub 批准后走这条：

```typescript
// sumsub-ingestion.service.ts:191
autoRelease(customerId, 'SANCTION', assessmentId, 'SYSTEM')
  → customer-restriction-workflow.service.ts:258 findOpenByCause(customerId, cause, caseRef)  ← 精确匹配
  → 找不到 → this.logger.log('Auto-release skip: ...') → return    ← 静默返回，不报错
```

`open()` 改客户级而 `autoRelease` 还按 `assessmentId` 找 → **永远找不到 → MLRO 批准了，客户还被冻着，只留一行 log**。

**两处必须一起改。** `findOpenByCause` 的 `caseRef` 传 `null` 表示"不限 caseRef"（`customer-restrictions.service.ts:356`），也是一个可选解法。

### 4.5 "后面的条子不贴"是免费的，且仍可取证

现有幂等直接满足需求，**零新增逻辑**：

| 第 N 次命中 | 贴条子 | 广播 | 审计 |
|---|---|---|---|
| 第 1 次 | ✅ 贴 | ✅ 发 | `CUSTOMER_RESTRICTION_ADDED` + `CUSTOMER_FROZEN`，`result=SUCCESS` |
| 第 2..N 次 | ❌ 不贴 | ❌ 不发 | `CUSTOMER_RESTRICTION_ADDED`，**`result=SKIPPED`** |

第 N 次命中全部留痕，只是不重复贴条。

**第二次不广播不会漏冻单**：那一单是被 `applyKytRejected` 自己冻的，不依赖广播。

### 4.6 被冻客户的新充值不会悬空

链上打款拦不住，但系统自洽：新充值照样建单 → `runGate0`（`deposit-workflow.service.ts:167`）读到 `access.blocked.has('DEPOSIT')` → 立刻 `FREEZE` → 单子进 FROZEN。钱有单子承接，且这条路径本来就不调 `open()`（人已经冻了）。

---

## 5. 接触点全清单

> 以下每一条都经 grep/sed 实读核对过行号（2026-08-20，HEAD `df9554df`）。

### 5.1 标签拆分（A 类，要改）

| 文件 | 行 | 内容 |
|---|---|---|
| `deposit-sumsub/deposit-kyt-verdict.handler.ts` | 25, 64, 80 | `SCENE_TAGS` Set / `sceneTag` 联合类型 / `as` 硬断言 |
| `withdraw-sumsub/withdraw-kyt-verdict.handler.ts` | 24, 66, 82 | 同构 |
| `trading/deposit-transactions/deposit-workflow.service.ts` | 330, 585, 761, 764, 785 | 三处联合类型 + 判断 + reason 文案 |
| `trading/withdraw-transactions/withdraw-workflow.service.ts` | 2315, 2489, 2654, 2657, 2674 | 同构 |
| `trading/swap-transactions/swap-workflow.service.ts` | 872 | `includes('SANCTION')` — 无类型保护的命门 |
| `deposit-sumsub/fixtures/verdict-buttons.ts` | 97, 98, 110 | `V4_REJECTED_SANCTION` → 拆两个按钮 |
| `withdraw-sumsub/fixtures/verdict-buttons.ts` | 91, 92, 104 | 同上 |
| `swap-sumsub/fixtures/verdict-buttons.ts` | 67, 68, 74 | 同上 |
| `admin-web/pages/DepositTransactionDetail.tsx` | 43 | 模拟按钮下拉项 |
| `admin-web/pages/WithdrawTransactionDetail.tsx` | 43 | 同上 |
| `admin-web/pages/SwapTransactionDetail.tsx` | 29 | 同上 |

### 5.2 因由（B 类，**不改**）

`customer-restriction-workflow.service.ts:105/142/329`、`restriction-cause.constant.ts:13/38`、`customer-restrictions.service.ts:121/261`、`client-risk-assessment.service.ts:453/518`、`profile-banners.service.ts:35`、`material-requests.admin.controller.ts:116`、`sumsub-ingestion.service.ts:213`、`swap-workflow.service.ts:888`、`admin-web/utils/restrictionCauseMeta.ts:12/32`、`admin-web/pages/CustomerManagement.tsx:48/159`、`client-web/components/RestrictionBanner.tsx:12`

### 5.3 兑换 FROZEN

| 文件 | 行 | 改什么 |
|---|---|---|
| `swap-transactions/dto/swap-transaction.dto.ts` | 12 | 加 `FROZEN`（放 REJECTED 后、死枚举注释块**外**） |
| 同上 | 22 | 加 `FREEZE = 'freeze'`（与充值/提现逐字同款，别自造名） |
| 同上 | 29 | `SwapRejectReason` 加制裁冻结值 |
| 同上 | 98 | `SwapTransactionQueryDto.status` 的 `@IsEnum` —— 见 §7 tipping-off 探测面 |
| `swap-transactions/swap-transactions.service.ts` | 362 | 迁移表加边 + `[FROZEN]: {}`；**同时改 :358-360 表头注释**（写死了"4 态状态机"） |
| 同上 | 747 | `findNonTerminalByOwner` 硬编码，见 §3.6 |
| `swap-transactions/swap-workflow.service.ts` | 465 | 加 `if (status === FROZEN) return 'IGNORE'` 一行 |
| 同上 | 1503-1513 | `onCustomerRestrictionOpened`：COMPLIANCE_PENDING 打 FROZEN，跳过已 FROZEN |
| `audit-logging/constants/audit-actions.constant.ts` | 325-381 | 新增 `SWAP_FROZEN`（**只这一个**；`UNFROZEN`/`BLOCKED` 那几个是给有出边的域用的，抄了就是死常量） |
| `swap-transactions/swap-transactions.service.ts` | `toCustomerSwapView` | 加客户面收敛：FROZEN → REJECTED，白名单兜底（§3.3 / §3.4） |
| 同上 | `findAllForCustomer` / `findAll:295` | 加 `customerScope` 门，客户面忽略 status 参数（§3.4b） |
| ~~`client-web/src/pages/Swap.tsx:36`~~ | — | **不用改** —— 服务层收敛后客户端只见 REJECTED，已在终态集合内 |
| ~~`client-web/src/utils/swapStatusView.ts`~~ | — | **不用改** —— REJECTED → 'Unsuccessful' 映射已存在 |

### 5.4 冻人链路

| 文件 | 行 | 改什么 |
|---|---|---|
| `deposit-workflow.service.ts` | 87 | 构造函数注入 `CustomerRestrictionsService` |
| 同上 | 764 | 拆主体 + 冻人（先冻人后冻单） |
| 同上 | 2975-3001 | 补审计 + 跳过已 FROZEN |
| `withdraw-workflow.service.ts` | 对应位置 | 同构 |
| 同上 | 2174 | 顺带清理陈旧注释（"V2 freeze API not yet built" —— API 已于 2026-08-16 落地，BACKLOG:231） |
| `client-risk-assessment.service.ts` | 455 | caseRef → customerNo |
| `sumsub-ingestion.service.ts` | 191, 215 | autoRelease + open 两处 caseRef 配对改 |
| `swap-workflow.service.ts` | 910 | 仅 SANCTION 分支 caseRef → customerNo |
| `prisma/seed.business.ts` | 575 | caseRef → customerNo |

### 5.5 文档与测试

| 文件 | 改什么 |
|---|---|
| `test/customer-restrictions.e2e-spec.ts:514-531` | 用例⑤ 断言与注释重写（§3.8） |
| `doc-final/BACKLOG.md:232` | 勾掉（本批兑现第一个选项） |
| `doc-final/reference/truth/v6-swap.md:11/13-27/52/79/84` | 状态机从 4 态改 5 态 |
| `doc-final/reference/truth/v4-deposit.md` | FROZEN 语义从"只冻单"改"冻单+冻人" |
| `doc-final/reference/truth/v5-withdraw.md:19/33/174` | 同上 |
| `doc-final/reference/truth/sumsub-ingestion.md` | 标签拆分 |

---

## 6. 明确不用动（省一轮无谓改动）

| 项 | 结论 | 依据 |
|---|---|---|
| **Prisma 迁移** | **不需要** | `SwapTransaction.status` 是裸 `String`（`schema.prisma:1208`），全库 `grep '^enum'` **零命中**，migrations 里无 status CHECK 约束。状态集合的唯一约束在 TS 侧 |
| **admin StatusPill** | **开箱即用** | `StatusPill.tsx:45` 已含 `FROZEN: 'bg-cyan-100 text-cyan-800'`；文字走 `transactionRootDisplay.ts:39-43` 的 `split('_')` 通用兜底（FROZEN → 'Frozen'） |
| **admin 兑换列表筛选** | **无需补 key** | `SwapTransactionList.tsx:51-91` 的 FilterState 只有 swapNo/ownerNo/日期/needsReviewOnly，**没有状态下拉**。不要为对齐 depositStatusMap 而凭空建 swapStatusMap.ts |
| **模块 imports / forwardRef** | **不要动** | 两个模块已有 `forwardRef(() => CustomersModule)`，`CustomersModule:50` 已导出 `CustomerRestrictionsService`。只加构造函数参数 |
| **seed 重铺兑换单** | **不需要** | `grep swap prisma/seed.business.ts` 只命中 `swapFeeLevel`，seed 不建任何 swapTransaction。FROZEN 只由运行时 demo 按钮产生 |
| **`FAILED` / `REVERSED` 死枚举** | **不要顺手删** | BACKLOG 另有条目；删了会破坏历史行读取与 `client-web/pages/Swap.tsx:36` 的终态集合 |

---

## 7. 已知取舍与 BACKLOG

### 7.1 本批新登记

| 条目 | 说明 |
|---|---|
| **对手方恰好是我的客户** | 交叉场景，本批不考虑 |
| **PROCESSING 在途单的混淆残留** | 兑换 `PROCESSING` 单碰上冻人广播仍走旧的 `needsReview` 旗，混在卡单堆里、旁边挂 Resume。窗口已比原来窄（只剩腿已开跑的单） |
| **双裁决毫秒级并发** | 两笔单的裁决在冻人广播完成前同时跑到冻人那一步，会开出两张。窗口极窄、后果轻（多一张同因由便签），防它要加客户级锁，不划算 |

### 7.2 tipping-off 三层防线（见 §3.3 / §3.4 / §3.4b）

本批给兑换加状态，会同时在三层开洞，三层都要堵：

| 层 | 洞 | 堵法 |
|---|---|---|
| 响应体 | `status: 'FROZEN'` 原样下发 | `toCustomerSwapView` 收敛成 `REJECTED`（§3.3） |
| 筛选面 | `?status=FROZEN` 返回非空 = 自证 | `customerScope` 下忽略 status 参数（§3.4b） |
| 未来新状态 | 白名单/黑名单滞后 | 白名单 passthrough + 兜底收敛（§3.4） |

充值域三层都已堵好且附有评审记录，兑换域**三层都没有**。

### 7.3 关系待厘清

CRA 那条 applicant 级通路（§1.3）与本批交易级 `SANCTION_APPLICANT` 并行存在。§4 统一 `caseRef` 后两者共用同一张便签 —— 需在实现时验证：CRA 先命中、交易后命中（及反序）都能正确收敛到一张。

---

## 8. 验收标准

1. **标签拆分生效**：三域各投 `SANCTION_APPLICANT` 与 `SANCTION_COUNTERPARTY`，前者冻单+冻人、后者只冻单
2. **命门有测试钉死**：`swap-workflow.service.ts:872` 那一行有测试覆盖，改错会红
3. **双标签同投**：同一笔同时带两个标签 → `APPLICANT` 生效（冻人），不因报文顺序而变
4. **只贴一张条子**：同一客户经 CRA + 充值 + 提现 + 兑换四条路径先后命中 → 便签表**只有一张** OPEN 的 SANCTION，且第 2..N 次各留一条 `result=SKIPPED` 的审计
5. **解冻不失效**：MLRO 在 Sumsub 批准 → `autoRelease` 能找到并撕掉那张客户级便签（不出现 `Auto-release skip`）
6. **兑换 FROZEN 闭环**：`COMPLIANCE_PENDING` 单经本单裁决 / 跨域广播两条路径都能进 FROZEN；FROZEN 单再收裁决 → 写 IGNORED 审计、不推状态、**不进死信**
7. **客户端零痕迹（三层验）**：① `GET /swap-transactions/my` 响应体里被冻单的 `status` 是 `REJECTED` 不是 `FROZEN`；② `?status=FROZEN` 不返回任何自证信息；③ 客户端显示 `Unsuccessful`、轮询停止；④ 材料请求仍 live 不被撕
8. **审计齐全**：批量冻单每笔都有审计；`SWAP_FROZEN` 可按 action 检索
9. **硬闸全绿**：`tsc` 0 错；`test/customer-restrictions.e2e-spec.ts` 用例⑤ 重写后通过；jest 净新失败 0
10. **文档同步**：三份 truth 文档 + BACKLOG:232 勾掉

---

## 附录：本稿事实核查方式

- 五路并发清查（标签 / FROZEN 参照 / 兑换新态 / 冻人链路 / 充值接入点），每条 MUST_CHANGE 派独立怀疑者对抗证伪，再过一轮完备性批评者
- `扫:tag-split` 一路 agent 中途断线零产出，§5.1/§5.2 的标签清单由主 session 自行 grep 补全并逐条归类
- §4.2、§4.4、§4.5、§6 全部结论均经 `sed`/`grep` 实读源码验证，非转述
