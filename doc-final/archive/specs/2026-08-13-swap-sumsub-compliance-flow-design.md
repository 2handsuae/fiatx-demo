# 兑换合规 · Sumsub 集成与状态机驱动 设计 spec

> **主题**：兑换（Swap）合规审查接入 Sumsub。定义 **提交契约 → webhook 驱动状态机 → 人级处置支线** 的完整闭环。
> **日期**：2026-08-13　**状态**：设计（未实现）　**范围**：仅兑换域；仅个人客户。
> **血缘**：充值 spec [2026-07-23](2026-07-23-deposit-sumsub-compliance-flow-design.md)（v3 KYT-only）+ 提现 spec [2026-07-25](2026-07-25-withdraw-sumsub-compliance-flow-design.md)。webhook 消费铁律、officer 处置协议、mock 演示五件套**全部复用**，本文只写兑换差异。
> **上游**：三闸门 spec [2026-07-12](2026-07-12-transaction-risk-gates-design.md) §4.3 曾定「兑换无 L2」——**本文推翻该条**，理由见 §1。

## 0. 置信度标注约定

- ✅ **实测**：2026-08-13 在 fiatx.com_181762 sandbox 真实调用/回读。
- 📄 **文档**：Sumsub 官方文档 / VARA 原文 / 本仓库代码实证。
- 🟡 **推断/待验**：设计推导或未验证项。

---

## 1. 定性：兑换为什么不一样

**兑换没有对手方**——钱在平台内换币种，不进不出，没有外部地址、没有对手 VASP。三个直接推论：

1. **不走 Travel Rule** —— 要件不成立（无对手方 VASP），不是豁免。
2. **无 `amlCase`** —— 对手方 AML 规则（AML0/1/13/19/22）无对象，充值/提现赖以工作的「折叠器」机制在兑换上不存在。裁决 = **纯规则输出**。`SANCTION`/`PEP` 场景标签同样不适用（那是对手方筛查产物）。
3. **必须提交 `finance`** —— 不提交，客户在 Sumsub 的交易史上「充值 → ??? → 提现」中间断链，而 layering（离析）恰好发生在那一段。这是接入的**唯一目的**：补全人的行为画像。

> 📄 VARA III.F.1 要求 "continuously monitor **business relationships** with clients"——监管对象是业务关系，不是「每笔兑换必须过前置闸门」。故兑换设闸属风险偏好选择，非合规义务；本设计选择设闸，因兑换是全平台**拦截成本最低**的位置（§4）。

## 2. 提交契约

📄 官方确认：兑换提交**两笔独立交易、两个 `txnId`**（schema 层 `info.direction` 仅 `in|out`、单币种单金额，无 exchange 类型，一笔表达不了兑换）。

| | 卖出腿 | 买入腿 |
|---|---|---|
| `direction` | `out` | `in` |
| 币种/金额 | 卖出币种、卖出额 | 买入币种、买入额 |
| 提交时点 | **建单后立即** | **成交后补提**（fire-and-forget，失败进重试队列，不阻断） |
| 是否承载裁决 | **是（唯一）** | 否（零规则命中） |

**共同字段**：
```
txnId    <swapNo 派生，自铸>        铁律：自铸 ID 作全链关联键
type     "finance"
orderId  <swapNo>                   串两腿
props    { txType: "exchange" }     📄 官方推荐的域判别器
info.type "exchange"                辅助分类（Dashboard 可读性）
```

**为何用 `props.txType` 而非 `sourceKey`**：📄 `sourceKey` 的本职是 **applicant 级**分源（团队可见范围 / level 分配 / webhook 过滤 / app token 权限域均按它切）。同一客户既充值又兑换，只有一个 source key，分不开交易类型；且交易级 sourceKey 对 applicant 归属有 🟡 未验副作用。官方直接推荐 `props`。

**代价**：`props` 无结构级过滤，**不存在「规则自动看不见兑换」**——每条规则必须在条件里声明域（§7 纪律①）。

**被拒时买入腿不提交** —— 不在 Sumsub 留一笔「钱进来了」的假交易。被拒的 swap 只留一条 rejected 的 out 腿，该腿是有价值的 attempted 信号。

## 3. 状态机

```
COMPLIANCE_PENDING ─┬─ kyt_approved ──→ PROCESSING ──→ SUCCESS
   （出生态）        ├─ kyt_rejected ──→ REJECTED
                    └─ sla_breach   ──→ REJECTED
```

```ts
transitions = {
  COMPLIANCE_PENDING: { kyt_approved: PROCESSING, kyt_rejected: REJECTED, sla_breach: REJECTED },
  PROCESSING:         { success: SUCCESS },   // 四腿全 CLEAR
  SUCCESS: {}, REJECTED: {},
}
```

**4 态**（对照充值 10 / 提现 10）。终态 `SUCCESS` / `REJECTED`。`FAILED`/`REVERSED` 保持不可达死枚举，BACKLOG 那条继续挂。

**无 `CREATED`**：📄 提现 Task 1 重写时已把 `CREATED`/`PENDING_COMPLIANCE`/`UNDER_REVIEW`/`APPROVED`/`HELD`/`CANCELLED` 整体删除，出生态直接落有意义的等待态。「已建单未提交」由**字段**承载（`sumsubTxnId IS NULL`），不由状态承载。

**刻意不要的三个态**：
| 缺席 | 理由 |
|---|---|
| `ACTION_PENDING` | 材料挂**人**不挂单。兑换单不等客户补料 |
| `MANUAL_CHECKING` | 无 amlCase，裁决当场终局，无 officer 等待期 |
| `FROZEN` | 兑换没有「钱卡在我托管里」的处境（充值有，故充值需要） |

这三个的缺席**就是本设计的核心**。它们一旦进来，汇率风险、SLA、挂起清理、并发竞态全部回来。

**无大额审批门**（沿用 2026-06 评估：资金不出境）。

## 4. 节点条件

### 节点1 · L1 本地门（毫秒，建单前）

| 判据 | 状态 |
|---|---|
| `assertTradingEligibility(ownerId,'SWAP')` —— 三轴态 APPROVED/ACTIVE/≠FROZEN | 现有 |
| **`restrictions` 不含 `SWAP` / `ALL`** | ⚠️ 现为死码，需接通 |
| R4 双边收款账户门（buy/sell 两侧 ACTIVE 收款账户） | 现有 |
| quote 仍 ACTIVE | 现有 |

不过 → **单不建**，前端报错（L1 是纯本地判断，不值得留单）。

> `restrictions` 死在两处：三个 `ensureCustomerCanTransact()` 调用点全未传 `capability`（检查包在 `if (capability)` 内恒不执行），且全仓零写入方。接通点建议置于 `assertTradingEligibility` 内——它才是三域共用的门。⚠️ truth `v2-customer-compliance.md` 声称该门含「restrictions 校验」，与代码不符，需订正。

### 节点2 · 建单（事务①）

```
consumeQuote(quoteId, ...)          ← 锁价 + 天然幂等锁
建单 status = COMPLIANCE_PENDING
TB 零动作
```

**quote 必须在此消费**，不可推迟到裁决后：`consumeQuote` 内含 `getActiveQuoteOrThrow` 的 check-and-set，是防重复提交的唯一锁。推迟 = 同一 quote 可刷出 N 个待审单与 N 笔 Sumsub 交易（双击即触发），污染 velocity 计数器与计费。

### 节点3 · 提交卖出腿（事务①之外）

先落库再外调。存 `sumsubTxnId` + `scoringResult` 快照（**审计与 admin 展示用，不写状态**——📄 §A.2 状态字段唯一写入口 = webhook handler）。

提交失败 → 单已存在、quote 已消费 → 看门狗按 `COMPLIANCE_PENDING AND sumsubTxnId IS NULL` **重试提交**（quote 不白费，优于回滚）。

### 节点4 · 等 webhook

| 出口 | 条件 |
|---|---|
| → 节点5 | `applicantKytTxnApproved` |
| → 节点6 | `applicantKytTxnRejected` |
| → REJECTED(`TIMEOUT`) | 合规超时看门狗 |

`onHold` / `awaitingUser` 在我方**一律等同 Rejected**（兑换无「等」的语义）。

**合规超时是独立时钟**（60s 量级，可配），**不复用 quote TTL**——quote 已 USED，价格已锁；合规延迟是平台自身服务问题，不应让客户已接受的价格失效。价格风险由平台承担，上限即此超时。

> 🟡 **全链唯一命门**：「规则自动裁决（无 officer 介入）是否自动发 `Approved`/`Rejected` webhook」——充值实测矩阵中该格为空（两行触发源均标 officer 手点）。**不发 = 每笔兑换走超时死**。真接前必须 sandbox 补测。

### 节点5 · 放行（事务②）

`markStatus PROCESSING` → `createLeg(leg1)` → 四腿两阶段（现状不变）→ 全 CLEAR → `SUCCESS`；随后补提买入腿。

### 节点6 · 拒绝

- `REJECTED`（终态），`rejectReason ∈ {KYT_REJECTED, TIMEOUT}`
- **TB 零痕迹** —— 无 void、无补偿分录、无审批（收紧方向）。对照：充值拦截时钱已在 `DEPOSIT_SUSPENSE` 需走退回/没收弧；提现拦截时已锁 pending 需 void；**兑换什么都没发生**。这是本设计最大的结构性便宜，e2e 须将「零记账痕迹」钉为断言。
- `getTxn(txnId)` 拉详情存库 → admin「Sumsub Detail」区块

**分两型（决定客户端出不出 banner）**：

| 型 | 判据 | 处置 |
|---|---|---|
| **软线** | `scoringResult.applicantActions[]` 非空 | 写 `restrictions=[SWAP, WITHDRAW]` + 存 actionId + **出 banner** |
| **硬线** | actions 为空 或 `typedTags` 含 `SANCTION` | 写 restrictions，**不出 banner** |

硬线不出 banner 是 **tipping-off 线**：EDD 补料可告知客户，制裁调查不可。该线由「有无 action 可做」自动画对。

**充值不禁** —— 钱在链上飞来，禁不掉；其对应动作只能是挂起。

## 5. 人级处置支线（异步，不碰订单）

```
applicantActionReviewed
   ├─ GREEN → 清 restrictions（+ 必要时写豁免位，§6）→ 兑换/提现恢复
   └─ RED   → 升级 MLRO / V2 客户级冻结
```

订单早已终态，**此线与订单不交叉**——「充值提现是订单问题，兑换是限制客户的问题」落地形态。

- 📄 **Action 不影响 applicant 主验证状态**（"Passing an action check does not affect the current applicant verification status"）→ 零爆炸半径，充值不会被误拦。这也是本设计**不用 `applicantChange: applicantLevel`** 的原因：改 level 会翻转 `review.decision` → 镜像我方 `onboardingStatus` → L1 拦死全部（含充值），撞上 BACKLOG「充值挂起无自动重驱」。与充值 spec 锁定决策 8 同源。
- 客户端 banner 置于 Swap 页右侧详情窗顶部；CTA → 后端换 access token（`externalActionId` + `userId`）→ WebSDK。
- **banner 显隐由后端吐 `pendingAction: {...} | null`**，前端不从 restrictions 推导——tipping-off 判断必须收在后端一处。

## 6. 豁免闭环（客户完成认证后如何不再命中）

✅ **实测前提**（2026-08-13 sandbox）：画像分 `applicant.assessment.totalScore` **同 tag 只覆盖不累加、无衰减、无重置口子**。故必须有显式豁免机制。

**主用「原生检查」，tag 仅兜底**：规则条件读**材料本身**而非代理标记。代理标记会漂移（材料造假/过期后 tag 仍在），需额外生命周期管理；原生字段不会。

| 材料 | 机制 | 有效期 |
|---|---|---|
| SoF / SoW / 目的问卷 | `questionnaires[qId][sectionId][itemId]` 原生 | 🟡 字段若带提交时间戳则规则内判 |
| 证件 / 地址证明 | `poi` / `poa` 原生 | 同上 |
| Liveness | `applicant.tags` 兜底（表达式根无原生字段） | 我方管理，对齐 V2 材料时效 |

**两档规则**（豁免不是免死金牌）：
```
基础档  totalScore > X  AND <材料未提供>   → reject
升级档  totalScore > Y                     → reject（无豁免口）
```

## 7. 规则纪律（三条硬约束；细则另见规则目录文档）

```
① 域锚必带      data.props.txType == 'exchange'
② 兑换域钉方向   AND data.info.direction == 'out'    → 买入腿零命中，不产生裁决
③ 自身聚合钉 out  txns.finance.byApplicant.out.filter(it.data.props.txType=='exchange')...
```

②消除两腿裁决分叉（out approved / in rejected 时原子的兑换单无法消化）；③防兑换量被算两遍（两腿都在历史窗口内）。

**排雷项**：含 `rejected` 计数或缺 `.notRejected` 过滤的聚合规则会造成「被拒 → 加分 → 再被拒」死循环。上线前须逐条 audit。

**动作收敛**：兑换域规则仅用 `reject`（硬线/软线）与 `score`+tags（喂画像），**不用 `onHold`/`awaitUser`**——兑换无「等」的语义。

## 8. 模拟层（fork 提现五件套）

```
swap-sumsub/
  swap-sumsub.module.ts          SUMSUB_MOCK_MODE 条件化注册 demo controller
  swap-webhook.router.ts         按 txnId 认领 → 驱状态机
  demo-scenario.service.ts       铸官方报文 → prime mock → 喂真实 ingest 链路
  admin-swap-demo.controller.ts  POST /admin/swap-sumsub/demo/run-verdict
  fixtures/verdict-buttons.ts    场景按钮
```

**关键**：demo 与 e2e 走同一份生产代码路径（提现既有做法），非测试自拼报文。⚡ 面板置于**兑换单详情页**，对挂在 `COMPLIANCE_PENDING` 的单喂场景——与提现完全同构。

**接口改动（跨域，动 `deposit-sumsub` 共享原语）**：`SubmitTxnInput` 补 `orderId`/`props`/`infoType`；返回值补 `scoringResult`。充值提现不用即可，但改动需跑两域回归。

**场景按钮**（对照提现 9 键）：
```
① Approved              → 成交 → SUCCESS
② Rejected · 硬线        → REJECTED【断言：TB 零 pending / 零 void / 零分录】
③ Rejected · 软线+action → REJECTED + restrictions + banner
④ Rejected · SANCTION    → REJECTED + restrictions，无 banner（tipping-off）
⑤ 超时（不喂 webhook）   → 看门狗收单 REJECTED(TIMEOUT)
⑥ 买入腿提交失败         → 成交不受阻 + 重试队列有记录
⑦ actionReviewed GREEN   → 清 restrictions，恢复交易（豁免闭环）
⑧ actionReviewed RED     → 升级 MLRO / V2 冻结
```

## 9. 代码改动点

**`executeSwap()` 一劈为二**（`swap-workflow.service.ts`）：

```
initiateSwap()                       客户端调用
  :191-192 L1 + 【新增】restrictions 查 SWAP
  :240     R4 保持
  ——— 事务①：consumeQuote(:256) + 建单 COMPLIANCE_PENDING ———
  提交卖出腿 → 存 sumsubTxnId
  返回 swap(COMPLIANCE_PENDING)

onKytApproved()                      webhook handler
  ——— 事务②：markStatus PROCESSING + createLeg(leg1)(:334) ———
  补提买入腿
```

- `markStatus`（`swap-transactions.service.ts:321`）现仅被 `'SUCCESS'` 调用且**无状态机守卫**，需扩展 PROCESSING/REJECTED 并加 transitions 校验。
- **不动**：四腿两阶段、`onLegConfirmed` 链式、`onLegFailedSelfHeal` 自愈、`needsReview`/STUCK、`advanceLeg`。

**⚠️ 前端契约变更**：今日 `executeSwap()` 返回时 swap 已 PROCESSING、leg1 已入账；新流程返回 `COMPLIANCE_PENDING` 且零账务动作。客户端 `Swap.tsx` 须从「点了就成」改为「点了要等」（等待有天花板 = 合规超时）。**此项影响交互稿，需产品确认。**

**新增字段**：
```
sumsubTxnIdOut / sumsubTxnIdIn     Sumsub 引用（8 年留档 + 迟到 webhook 对号）
complianceVerdict                   approved | rejected
complianceAction                    score|reject|onHold|awaitUser（规则引擎层快照）
complianceRuleNames                 命中规则名（可解释性 / 客诉举证）
sumsubDetailJson                    getTxn 详情，供 admin 区块
rejectReason                        KYT_REJECTED | TIMEOUT
```
**无 `slaDeadline`** —— 充值提现有，兑换不需要（不挂起）。

**新建**：`swap-sumsub/`（§8）｜ identity 域 applicant-action handler（人级 GREEN/RED → restrictions）｜ `restrictions` 接通。

## 10. 与现状差距（truth/v6-swap.md）

- 合规**仅 L1** → 增 L2（webhook 驱动的 KYT 单闸）
- 状态机 **2 态可达**（PROCESSING/SUCCESS）→ 4 态
- `consumeQuote` 与建腿同事务 → 劈成两段，中隔外部往返
- `restrictions` 死码 → 接通（L1 传 capability + 新增写入方）
- 无 Sumsub 引用字段 / 无 admin Sumsub 区块 / 无 ⚡ 面板 → 全部新增
- `FAILED`/`REVERSED` 死枚举 → 本设计**不复活**，BACKLOG 继续挂

## 11. ✅ 实测证据台账（2026-08-13，sandbox fiatx.com_181762）

| 结论 | 证据 |
|---|---|
| 规则分 ≠ 画像分 | 对照交易 86 条规则命中、交易分 39，画像分 **0**（tag 未入 assessment） |
| 画像分公式 | `Σ_tags[最近一次 score × scoreWeight%]`；实测 50×10% + 20×30% = **11.0** |
| **画像分含本笔贡献** | 全新 applicant 首笔：喂分规则触发 → 读分规则**同笔命中**；对照组（喂分规则未触发）读分规则**未命中** → 无「慢一拍」、无冷启动洞 |
| **同 tag 覆盖不累加** | 连跑两笔同规则同 tag，`totalScore` 恒 5.0；`assessment.scores` 每 tag 一条 entry 带最近 txnId |
| 规则可经 API 激活 | 建规则后发 revision 带 `dryRun:false` → rev=2 active（免 Dashboard） |
| 规则 POST 需信封 | 裸 payload 恒 500；须 `{"rule":…, "metadata":{"source":"aiAgent"}}` |
| testMode 规则照常求值 | dryRun 规则出现在 `matchedRules[]`（`dryRun:true`），分入 `dryScore` → 可作零副作用探针 |

**租户现状发现**（非本设计产物，但影响接入）：
- 183 条活跃规则中**无一条活跃 finance 规则挂 `includeInTotalScore` 的 tag**；`High`/`Medium`/`Low` 三 tag 权重已配但零挂载；`riskLevel` 阈值**为空** → 画像分链路当前是断的。
- `tut-cha-qiv-v1-dgmX`（tutorial 规则）条件 `amountInDefaultCurrency > 0`、动作 `awaitUser`，**每笔 finance 交易必命中**，须停用。

## 12. ⚠️ 待验证 / 待决

1. 🟡 **规则自动裁决是否自动发 Approved/Rejected webhook**（§4 命门，不发则每笔走超时死）——真接前必测。
2. 🟡 `poa`/`questionnaires` 字段是否含提交时间戳（决定豁免有效期能否规则内判，否则该档退回 tag + 我方管期限）。
3. 🟡 applicant tag 的写入 API 端点（Liveness 兜底档依赖）。
4. 🟡 Sumsub 是否支持将 txn 标记为「未执行/撤销」（被拒兑换在 Sumsub 侧留 rejected 记录，officer 语义需培训说明）。
5. 合规超时具体秒数（60s 为建议值，待运营口径）。
6. 兑换域规则清单与阈值（另见规则目录文档，不在本 spec）。
