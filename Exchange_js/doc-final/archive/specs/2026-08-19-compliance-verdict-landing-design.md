# 第一批 · 合规裁决落地的正确性与可取证性

> 三条工作流结构一致性改造 · 第 1 批（共 5 批）
> 设计日期：2026-08-19 ｜ 业主已逐条拍板 ｜ 状态：待评审

---

## 0. 背景

2026-08-19 对充值 / 提现 / 兑换三条交易主干做了一次端到端盘点（六层横切 105 条差异 + 13 个补充维度 + 三域全流程走查），业主将「结构一致」的范围收窄为**合规流程一致**，并把全部工作按**问题的性质**分成 5 批。

本文是**第 1 批**的设计。它的共同性质是一句话：

> **合规判断本身出了问题，而系统表现得一切正常。**

这批里每一条都是**沉默的错** —— 不报错、不告警、不留痕。这是它们该在同一批的唯一理由，也是它必须排在第一批的理由：其余四批解决的是「看不见」和「不好用」，只有这批解决的是「结论是错的」。

### 交易流环节坐标

业主已认可的 20 环节骨架（主干 10 / 条件分支 4 / 横切 6）中，本批覆盖：

| 环节 | 名称 |
|---|---|
| 6 | 裁决落地（归一 + 存证 + 推状态） |
| 7 | 裁决分流（通过 / 拒绝 / 等待） |
| 17 | 审计与取证 |

---

## 1. 问题：三个真实场景

以下三个场景均已在 HEAD `b63e4e8e` 上逐行核实，业主已逐条确认场景成立。

### 场景一 · 制裁记录被静默洗掉

一笔充值因**对手方命中制裁**被冻结（`FROZEN`，裁决 `rejected`，风险分 100，报文含制裁命中规则）。

三天后 Sumsub 官员改动后重发，来了一条迟到的 `onHold`（风险分 50）。

系统的执行顺序是：

1. **先写证据** —— `writeBackVerdict` + `saveTxnDetail` 两次独立裸写（`deposit-workflow.service.ts:371-380`），把「制裁 / 100 分 / 制裁报文」整份换成「onHold / 50 分 / onHold 报文」
2. **后判断** —— `applyKytOnHold` 因 `status !== COMPLIANCE_PENDING` 静默 return（`deposit-workflow.service.ts:678-683`）

**净效果**：单子仍冻着（正确），但详情页显示的裁决变成 `onHold`、风险分从 100 掉到 50、原始报文里再也找不到制裁命中记录。**零报错、零审计、webhook 返回成功。**

现有两道守卫都盖不住这条：

- `KYT_VERDICT_IGNORED_STATUSES`（`deposit-workflow.service.ts:297-308`）8 个成员里**不含 `FROZEN`**
- `approvedWillNoOpFrozen`（`:368-369`）**只挡 `approved`**，`onHold` / `awaitUser` 直接穿过

**提现完全同款**：`withdraw-workflow.service.ts:2328-2343`（守卫只挡 approved）→ `:2338` 裸写 → `:2555-2560`（onHold 状态守卫）/ `:2501-2506`（awaitUser 的 FROZEN 守卫）。守卫本身是对的，**位置太晚**。

**兑换不受影响** —— 它是「先判后写」：所有 no-op 判定跑完（`swap-workflow.service.ts:508-546`）才在 `:605` / `:631` 开事务写。同样操作出不了这个问题。

> ⚠️ 同族事故 2026-08-13 已发生过一次（A5），当时的修法是**扩容忽略集合成员**，没有改顺序。因此同族的其它 no-op 分支仍在流血 —— 本次必须改结构，不能再补成员。

### 场景二 · 收到了，但取证时拿不出

一笔提现已 `SUCCESS`（链上已广播）。40 分钟后 Sumsub 对该对手方地址重新评分，推来 `rejected`。

三域**都会忽略它**——这是正确的，不能拿迟到裁决翻已完成的单。分歧在留不留痕：

| 域 | 行为 | 锚点 |
|---|---|---|
| 充值 | **写审计** `DEPOSIT_KYT_VERDICT_IGNORED` | `deposit-workflow.service.ts:341-357` |
| 提现 | 只 `logger.debug` | `withdraw-workflow.service.ts:2317-2320`、`:2331-2336` |
| 兑换 | 只 `logger.debug` | `swap-workflow.service.ts:544` |

充值那条的理由写在代码注释里，本设计采纳为三域通用口径：

> 忽略 ≠ 静默。落一条审计，演示/取证时能指着说「系统收到了、判定不适用、记下来了」，而不是只有服务端日志。

**监管场景的实际损失**：半年后被问「这个收款地址后来上了制裁名单，你们什么时候知道的？」——打开该笔提现，`sumsubVerdict` 仍是 `approved`、`sumsubScoredAt` 仍是原时间、结算后零条新审计。**页面上没有任何迹象表明曾经来过一条拒绝。**

### 场景三 · 真实链路会吞掉第二条裁决

去重键（`sumsub-ingestion.service.ts:570-579`）：

```
type : applicantId : externalUserId : reviewId : attemptId
```

**KYT 交易裁决报文不带 `reviewId` / `attemptId`**。于是同一客户的第二条同类型 KYT 裁决，键与第一条**逐字相同** → 命中 `status='PROCESSED'` 的旧行 → `:78-79` 直接 return，**新裁决不落行、不派发**。

模拟入口跳过去重（`:69` `!options.isSimulated`），所以**演示环境不复现，接真 Sumsub 必中**。

**为什么它属于本批**：本设计用「Sumsub 事件表存了全部原始报文」作为覆盖式写入的取证兜底（见 §3 非目标）。这个兜底成立的前提是事件真的能落行。去重键不修，兜底就是空的。

---

## 2. 设计

### 2.1 统一为三段结构：解析 → 判定 → 落地

三域 `applyKytVerdict` 一律改成：

```
① 解析     从 handler 拿到归一后的 verdict + 证据
② 判定     decideVerdictLanding(status, verdict) → IGNORE | EVIDENCE_ONLY | DISPATCH
③ 落地     按判定结果执行；写证据只发生在 EVIDENCE_ONLY 与 DISPATCH
```

**判定必须先于任何写库动作。** 这是本批的核心不变量。

三个落地档位的语义：

| 档位 | 含义 | 写证据 | 推状态 | 写审计 |
|---|---|---|---|---|
| `IGNORE` | 这条裁决不会推动状态机，也不该留在订单上 | ❌ | ❌ | ✅ 必写（= 场景二） |
| `EVIDENCE_ONLY` | 证据要留，但不推状态（如兑换 PROCESSING 分支） | ✅ | ❌ | ✅ |
| `DISPATCH` | 正常分发到 approved / rejected / awaitUser / onHold 分支 | ✅ | ✅ | 由各分支自己写 |

### 2.2 判定集合：统一结构，不统一成员

**三域的忽略集合成员语义不同，不得强行合并**：

| 域 | 成员 | 域特有原因 |
|---|---|---|
| 充值 | 8 态 | 含 `CONFISCATING` / `RETURNING` / `SEIZING` 三个在途处置态，是充值独有的资金处置弧 |
| 提现 | 纯终态 | `PAYOUT_PENDING` 故意在集合外，走专门分支 |
| 兑换 | 2 个活成员 | 对 `rejected` 有 `REJECTED` / `SUCCESS` 的**故意 carve-out**（见 2.4） |

**修复场景一的做法：判定组合，而不是扩容集合。** 充值与提现的判定必须覆盖 `FROZEN`，但**不得**把 `FROZEN` 加进忽略集合（那样会挡掉合法的解冻路径）。正确做法是在 `decideVerdictLanding` 里判定「该 (status, verdict) 组合的下游分支是否必然 no-op」——集合成员一个不加。

判据：`FROZEN` 状态下**没有任何 verdict 能合法推动状态机** ——

- `approved` → 现有 `approvedWillNoOpFrozen` 已挡
- `onHold` → `applyKytOnHold` 的状态守卫必 return
- `awaitUser` → 提现 `:2501` 守卫必 return；充值 `applyKytAwaitUser` 全段无 FROZEN 守卫，会从 FROZEN 抛错（`FROZEN` 只有 `RESUME`/`SEIZE` 两条出边）
- `rejected` + SANCTION/FROZEN_BY_MLRO → 提现 `:2595` 已 return

因此 `FROZEN` + 任意 verdict 一律判 `IGNORE`。

### 2.3 忽略分支强制写审计（场景二）

以充值 `deposit-workflow.service.ts:341-357` 为基准，提现与兑换各补一份。

**必须原样继承的**：`recordSystem` + 尾部 `.catch(...)`。

> `.catch` 是 load-bearing 的。三个 handler 全无 try/catch，异常会上抛到 `sumsub-ingestion.service.ts:345` → `retryCount + 1`，`>= 3` 即 `DEAD` → `SumsubRetryService` 每 2 分钟按 30s / 5min / 30min 退避重投。**审计写失败会把一个本该静默忽略的 webhook 变成 FAILED → 重试 → 死信**，且每次重试重打一次 `getTxn`。模拟事件更直接：`await this.dispatch(event)` 是同步的，异常会 500 给 admin 模拟面板，演示当场炸。

**必须改进的**：充值现在是 `.catch(() => undefined)` 哑吞 —— 审计写不进去零信号。三份统一改成 `.catch(err => this.logger.error(...))`。

**新增审计动作常量**（`audit-actions.constant.ts`）：

- `WITHDRAW_KYT_VERDICT_IGNORED` —— 提现段（现有 `:401-425` 附近）
- `SWAP_KYT_VERDICT_IGNORED` —— 兑换段（现有 `:327-345` 附近）
- 充值已有 `DEPOSIT_KYT_VERDICT_IGNORED`（`:244`），不动

**提现要补两个点，不是一个**：

- `withdraw-workflow.service.ts:2317` —— 终态忽略
- `withdraw-workflow.service.ts:2332` —— `FROZEN` + `approved` 忽略（**这条最需要留痕**：制裁冻结单收到迟到 approved）

### 2.4 兑换的 carve-out 必须保留

`swap-workflow.service.ts:537-543`：`(status === REJECTED || SUCCESS) && verdict === 'rejected'` → 走 `handleRejectDisposition` 后 return。

理由写在 `:509-536`，本设计原样采纳：

> `markStatus` 与 `handleRejectDisposition` 是两次独立写、后者在事务外。若它抛错，重投撞上已 `REJECTED` 的单会静默 no-op，客户永远不被限制。**订单自己的状态不该决定这个人被不被摁。**

**审计点必须放在 carve-out 之后**（`:544` 那一行）。放前面会导致同一事件既写 `IGNORED` 又写 `SWAP_KYT_REJECTED_DISPOSED`，自相矛盾。

### 2.5 审计幂等键：保留随机数（业主 2026-08-19 拍板）

**同一笔单前后收到 3 次迟到裁决，写 3 行审计。**

充值现状 `requestId: ..._${randomUUID()}`（`:354`）即为目标态，提现与兑换照做。

> 业主口径：「他们前后来了三次」这件事本身就是证据。
> 工程注记：`audit-logs.service.ts:969-974` 提供按 `requestId` 的去重能力，随机数把它关掉了。这在本设计里是**有意为之**，不是遗留缺陷 —— 请勿在后续重构中"顺手修复"。

### 2.6 去重键补交易号（场景三）

`buildDedupeKey`（`sumsub-ingestion.service.ts:570-579`）追加 KYT 交易号维度：

```
type : applicantId : externalUserId : reviewId : attemptId : kytTxnId
```

`extractDedupeKey`（`:77` 的比对方）同步。

`kytTxnId` 从报文中取（KYT 裁决报文携带该字段，非 KYT 事件为空串，不影响既有行为）。

---

## 3. 非目标（本批明确不做）

| 不做 | 原因 |
|---|---|
| **建裁决历史表**（追加式写入） | 三域今天都是覆盖式：一笔单收到 3 条裁决，订单表只留第 3 条。这是**独立问题**（`BACKLOG:91` 已登记，业主未给口径）。本批不做的依据：`sumsub_webhook_events` 已全量留存 `rawPayload` 且无 TTL / 无 purge，配合 §2.6 修好去重后即可作为取证兜底。**取证口径**＝订单表给最新结论、事件表按交易号反查给全序列，两者互为佐证。 |
| **给兑换加人工复核态** | 业主 2026-08-19 明确否决，无商量余地。 |
| **标签兜底口径调整** | 业主澄清：标签是 Sumsub 侧预先录入的闭集，逻辑从高到低依次过，未命中即落兜底态。「认不出标签」场景不成立。 |
| **送检失败的重试上限与落点** | 业主澄清：客户都会建档，「无档案」场景不成立；「Sumsub 服务挂了」本质是 `COMPLIANCE_PENDING` 的 SLA 问题，**移至第 3 批（环节计时）**。 |
| **卡单救援** | 业主定调：本质是资金问题不是订单问题，归资金层，不在交易流讨论。 |
| **Sumsub 事件页的可用性**（列表恒显 PROCESSED / 前端不调详情接口 / 表无订单关联列） | 属第 4 批（对外呈现）。本批只保证事件**落得进去**，不管**查不查得到**。 |

---

## 4. 硬约束

本批**不得**触碰：

- ❌ 状态机（零新增状态、零新增边）
- ❌ 数据库 schema（零 migration、零重铺）
- ❌ 记账（一分钱不碰，TB 零改动）
- ❌ 前端（admin 与 client 均零改动）

任何实现若需要突破以上任一条，**必须回头找业主重新拍板**，不得自行放宽。

---

## 5. 验收标准

每条都可独立跑、可当面演。

| # | 场景 | 断言 |
|---|---|---|
| 1 | 一笔 `FROZEN`（制裁）充值单，喂一条迟到 `onHold` | `sumsubVerdict` 仍是 `rejected`、`sumsubScore` 仍是原值、`sumsubTxnDetailJson` 仍含制裁命中规则；**且**新增一条 `DEPOSIT_KYT_VERDICT_IGNORED` 审计 |
| 2 | 同上，提现版（`FROZEN` + 迟到 `awaitUser`） | 同上，审计为 `WITHDRAW_KYT_VERDICT_IGNORED` |
| 3 | 一笔 `SUCCESS` 提现，喂一条迟到 `rejected` | 新增一条 `WITHDRAW_KYT_VERDICT_IGNORED`，含 `verdict` 与 `riskScore` |
| 4 | 同上连喂 3 次 | 审计表出现 **3 行**（业主口径 §2.5） |
| 5 | 一笔 `REJECTED` 兑换单，喂一条迟到 `rejected` | 仍走 `handleRejectDisposition`（客户被摁）；**不**写 `SWAP_KYT_VERDICT_IGNORED`（carve-out 生效） |
| 6 | 一笔 `SUCCESS` 兑换单，喂一条迟到 `approved` | 写 `SWAP_KYT_VERDICT_IGNORED`，不动订单 |
| 7 | 同一客户先后两笔兑换，各收一条 KYT 裁决（**非模拟入口**） | 两条事件**都落行**、都派发；第二条不被去重吞掉 |
| 8 | 审计服务人为置故障，喂一条迟到裁决 | webhook 仍返回成功、事件仍 `PROCESSED`、**不进重试/死信**；日志中有一条 error |

**硬闸**：后端 `tsc` 0 错 ｜ `jest` 净新增 0 失败 ｜ `verify:coa` ALL PASS ｜ `demo:all` 不劣于改前。

---

## 6. 改动清单

| 文件 | 改什么 | 类型 |
|---|---|---|
| `deposit-workflow.service.ts` | `applyKytVerdict` 改三段结构；`.catch` 加 logger | 改 |
| `withdraw-workflow.service.ts` | 同上；`:2317` 与 `:2332` 两处补审计 | 改 |
| `swap-workflow.service.ts` | 同上；审计点放 `:544` carve-out 之后 | 改 |
| `audit-actions.constant.ts` | 新增 2 个常量 | 加 |
| `sumsub-ingestion.service.ts` | `buildDedupeKey` / `extractDedupeKey` 加 `kytTxnId` | 改 |
| 三域 `*-workflow.service.spec.ts` | 新增判定顺序用例 | 加 |
| `test/*-sumsub-*.e2e-spec.ts` | 新增验收 1-8 | 加 |
| `truth/v4-deposit.md` / `v5-withdraw.md` / `v6-swap.md` / `sumsub-ingestion.md` | 同步三段结构与审计口径 | 改 |

**零 schema 变更、零 migration、零前端文件。**

---

## 7. 已知风险与坑

1. **`.catch` 不可省** —— 见 §2.3，省了会造死信。
2. **审计点位置** —— 兑换必须在 carve-out 之后，否则同事件双写自相矛盾。
3. **随机幂等键是有意的** —— 见 §2.5，勿"顺手优化"。
4. **判定不得引入新的 no-op 分支遗漏** —— 本批改的是结构，实现时需逐个 verdict × status 组合列表核对，不能只改 `FROZEN` 一格（2026-08-13 那次就是只补成员没改结构，导致同族继续流血）。
5. **兑换有一处文档漂移，已于本轮就地订正**：`truth/v6-swap.md:55` 原写「超时…走同一套 `handleRejectDisposition()`」，与 `swap-sla.service.ts:50-58` 实际相反——超时判死**刻意不触发**任何处置（该 service 连 `CustomerRestrictionsService` 都没注入）。此句非本批引入，但因本设计的取证口径依赖它，已在写 spec 时一并改正，避免实现者照错文档做。

---

## 8. 业主决策记录（2026-08-19）

| 事项 | 决定 |
|---|---|
| 「结构一致」范围 | 收窄为**合规流程一致**，非全流程 |
| 批次划分判据 | 按**问题的性质**分，不按域、不按前后端 |
| 兑换人工复核态 | **不加**，无商量余地 |
| 场景一（标签认不出） | **不存在** —— 标签是预录入闭集，从高到低依次过，未命中落兜底态 |
| 场景二（客户无 Sumsub 档案） | **不存在** —— 都会建档 |
| 场景三（Sumsub 服务挂） | 本质是 `COMPLIANCE_PENDING` 的 SLA 问题，**推迟到第 3 批** |
| 迟到裁决审计幂等 | **3 次写 3 行** —— 「来了几次」本身是证据 |
| 卡单救援 | 本质是资金问题，归资金层，不在交易流讨论 |
