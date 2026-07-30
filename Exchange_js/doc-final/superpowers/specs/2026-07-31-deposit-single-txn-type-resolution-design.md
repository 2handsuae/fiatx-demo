# 充值单 · 单笔提交 + TR 类型判定 + Sumsub 字段对齐 — 设计 spec

> **日期**:2026-07-31　**状态**:设计(未实现)
> **背景**:此前对每笔 crypto 充值**无条件报送两笔** Sumsub 交易(`finance` + `travelRule`)。经查证(Sumsub 官方文档 + 我方 v3 实测台账「travelRule 也发 amlCase」+ 规则 schema「Types may be combined」),**一笔交易只有一个 `type`,且 `travelRule` 类型同样进规则引擎、同样做对手方 AML/制裁筛查** —— 双发是多余的(交易数与 webhook 双倍计费),且我方「两个 txnId 分泳道」的复杂度本可不存在。
> **范围**:充值域的类型判定 + 数据模型对齐官方命名 + 详情页/客户端相应改造。**不含**真实 VASP 归属服务接入(演示系统用客户端录入模拟)、不含提现域。

## 0. 已定决策(脑暴逐段确认,2026-07-31)

| # | 决策 | 依据 |
|---|---|---|
| 1 | **一笔充值只报一次 Sumsub**;`type` 二选一 | 业主定;官方 `type` 为单值枚举,doc「can have both」是可选非必须 |
| 2 | **判定口径**:`crypto` ∧ 对手方是 VASP ∧ `amount >= 阈值` → `travelRule`;**其余全 `finance`** | 业主定(VARA 要求) |
| 3 | **阈值按资产写死在代码**:`USDT=1000`、`AED=3500`;**不折算**、不入库、不做管理台可配 | 业主:「写在代码。这个是 VARA 的要求」——监管线不应让运营随手改 |
| 4 | **边界 `>=`**:正好 1000 USDT / 3500 AED **要**走 TR | 业主明确修正 |
| 5 | **对手方 VASP 由客户端「模拟充值」弹窗录入**(本质模拟 Sumsub 归属服务);**演示系统不接真服务** | 业主定 |
| 6 | **法币单不带该字段**(不渲染、不传、库中为 null);crypto **必填** | 业主:「法币不要有这个字段」 |
| 7 | **判定抽成独立纯函数判定器**(非内联),返回 `type` **+ 判定理由** | 脑暴选项乙;监管逻辑值得有名字、可表驱动单测、理由可落审计 |
| 8 | **数据模型对齐 Sumsub 官方字段命名** | 业主:「看下人家字段命名,我们这边直接用就行」 |
| 9 | **两个展示区按来源分工**:L2 显示**最新 webhook 裁决**四值原样(`approved`/`rejected`/`onHold`/`awaitingUser`);Sumsub Transaction Detail 按**getTxn 报文官方字段**直接回显 | 业主纠正:「放行闸其实是 webhook 是 approved…L2 展示的永远是最新 webhook 的那个值」。**代码坐实**:`applyKytApproved` 全程不读 `financeStatus`,放行由 webhook verdict 驱动;`financeStatus` 只是展示投影 |
| 10 | **老 mock KYT 管道退役**(`applyKytResult`/`applyTrResult` + `kytCheckSimulated`/`travelRuleCheckSimulated` 分支 + 旧 admin simulate 端点);`checkAutoApproval` **保留**,判断改读新裁决字段 | 业主选甲→甲-1。`checkAutoApproval` 非死码:`waiveLimitHold`(below-min PASS 豁免,活功能)在用;甲-2(整删)有真实卡单风险(KYT 先 approved、豁免后到则无新 webhook 触发) |

## 1. 判定器(核心)

新增纯函数模块,唯一职责:回答「这笔充值报哪个 type」。

### 1.1 VARA 阈值表(代码常量)
```ts
const TR_THRESHOLD_BY_CURRENCY: Record<string, number> = {
  USDT: 1000,
  AED: 3500,
};
```

### 1.2 判定规则
```
resolveKytTxnType({ assetType, currency, amount, counterpartyIsVasp })
  → { type: 'finance' | 'travelRule', reason: string }

assetType !== 'CRYPTO'         → finance     · NOT_CRYPTO
counterpartyIsVasp !== true    → finance     · COUNTERPARTY_NOT_VASP
阈值表无该币种                  → finance     · NO_TR_THRESHOLD_CONFIGURED（+ warn 日志）
amount < 阈值[currency]         → finance     · BELOW_TR_THRESHOLD
否则（amount >= 阈值）           → travelRule  · TR_REQUIRED
```

- **漏配币种兜底判 `finance` 并打 warn**:静默漏报危险,但不能因漏配把单卡死;warn 保证可发现。
- **判定结果落审计**:`DEPOSIT_SUMSUB_SUBMITTED` 的 metadata 带 `txnType` + `reason`,详情页可回溯「这单为什么没走 TR」。

## 2. 数据模型(对齐 Sumsub 官方命名)

### 2.1 新增列
| 列 | 对应官方字段 | 说明 |
|---|---|---|
| `sumsubTxnId` | `id` | Sumsub 服务端交易号(唯一,取代双列) |
| `sumsubTxnType` | `data.type` | `finance` \| `travelRule` |
| `sumsubVerdict` | (webhook 裁决,非 getTxn 字段) | `approved`/`rejected`/`onHold`/`awaitingUser` —— **L2 直接显示,不做任何翻译** |
| `sumsubScore` | `scoringResult.score` | 规则引擎风险分(L2 附带显示) |
| `sumsubScoredAt` | (我方落库时刻) | 取代 `financeCheckedAt` |
| `sumsubTxnDetailJson` | 整个响应体 | 报文存证(乙口径,后盖前) |
| `counterpartyIsVasp` | (无官方对应) | 我方判定输入;crypto 必填,fiat null |

### 2.2 删除列
`sumsubFinanceTxnId`、`sumsubTravelRuleTxnId`、`travelRuleRequired`、`travelRuleStatus`、`travelRuleTxnDetailJson`、`financeStatus`、`financeRiskScore`、`financeCheckedAt`、`financeScreeningId`、`financeTxnDetailJson`。

> **仅 deposit 表**。withdraw 的 `preKyt*`/`kyt*`/`travelRule*` 命名**不动**(其两阶段模型与本轮无关)。

### 2.3 裁决值:存 webhook 原值,不做翻译
我方自造的 `GATE_STATUS_BY_VERDICT`(`approved→PASSED` 等四值翻译表)**整个废弃** —— 它把 Sumsub 的词表翻译成我们自造的词表,徒增一层认知负担。改为 `sumsubVerdict` 直接存 webhook 带来的裁决原值(`approved`/`rejected`/`onHold`/`awaitingUser`),L2 原样显示。

**`review.reviewStatus` / `review.reviewResult.reviewAnswer` 不单独落列** —— 它们已在 `sumsubTxnDetailJson` 报文里,Transaction Detail 块解析后直接回显即可(§6.3),无需冗余建列。

### 2.4 存量数据迁移
SQLite 整表重建。回填口径:
- `sumsubTxnId` ← `sumsubFinanceTxnId`(存量单均由 finance 腿驱动)
- `sumsubTxnType` ← 常量 `'finance'`
- `sumsubScore` ← `financeRiskScore`;`sumsubScoredAt` ← `financeCheckedAt`;`sumsubTxnDetailJson` ← `financeTxnDetailJson`
- `sumsubVerdict` ← 从 `financeStatus` 反查:`PASSED→approved` / `FAILED→rejected` / `ON_HOLD→onHold` / `AWAITING_USER→awaitingUser`
- `counterpartyIsVasp` ← null(存量 e2e 单业主已明示将删除,不回填)
- `financeScreeningId` ← **不迁移,直接丢弃**(全仓零读零写,是历史残留死列,借本次重建顺手清掉)

## 3. 提交逻辑

`submitSumsubTxns()` 从「无条件发两笔」改为「**判定后发一笔**」:
```
type = resolveKytTxnType(...)            ← §1
submitTxn({ ..., type })                 ← 一次调用
setSumsubTxn(depositId, { sumsubTxnId, sumsubTxnType })
落审计（含 type + reason）
```

**泳道概念整体消失**:`KytLane` 类型、handler 的泳道反查、`applyKytVerdict` 的 `lane` 参数、`writeBackGateStatus` 的双分支 —— 全部删除。一笔单一个号,`findBySumsubTxnId` 命中即是它,不存在歧义。

## 4. 放行路径澄清 + 老 mock 管道退役

### 4.1 概念澄清(本轮纠正的认知错位)
**放行由 webhook 裁决驱动,不由存储字段驱动。** 代码坐实:`applyKytApproved()` 全程不读 `financeStatus`,它读 webhook 的 `verdict==='approved'`,判 FROZEN 守卫 → trading-ready 闸 → 直接 `approveDeposit()`。

`financeStatus`(及其继任者 `sumsubVerdict`)是**展示投影**,由 `writeBackGateStatus` 单向写入,供 L2 显示。**不得**再把它当决策依据 —— 这正是本轮暴露的错误范式。

### 4.2 老 mock KYT 管道退役(决策 10)
v3 已定 KYT-only,以下整套是被取代的旧 mock 管道,**删除**:
- `DepositWorkflowService.applyKytResult()` / `applyTrResult()`
- `SumsubIngestionService` 的 `kytCheckSimulated` / `travelRuleCheckSimulated` 两个合成事件分支
- `admin-sumsub-simulation.controller.ts` 里产生上述合成事件的旧 simulate 端点(`:354` 起)

> 删除前须确认无其它活调用方(tsc + grep 兜底)。新的场景仿真走 `AdminDepositDemoController`(`SUMSUB_MOCK_MODE` 门控),与此无关、保留。

### 4.3 `checkAutoApproval` 保留但改数据源(决策 10,甲-1)
**不能整删** —— `waiveLimitHold()`(below-min PASS 豁免,活功能)依赖它:豁免解除金额挂起后,需要重新评估「合规是否已过、能否放行」。

改动:
```ts
// 原:读展示投影
if (deposit.financeStatus !== 'PASSED') return;
// 改:读新裁决字段
if (deposit.sumsubVerdict !== 'approved') return;

// 原 travelRuleStatus 那道闸 —— 整条删除
// (一笔单只有一个 type,不存在「另一腿未过」)
```

**为何不选甲-2(整删 `checkAutoApproval`、豁免只清标记)**:存在真实卡单时序 —— 若 KYT 的 approved 在豁免**之前**已到达(单子因 below-min 被挡住未放行),豁免后不会再有新 webhook 触发放行,单子永久卡住。

## 5. 客户端(模拟充值弹窗)

crypto 资产选中时新增一项(法币**整项不渲染**):
```
Counterparty   ( ) VASP (exchange / custodian)
               ( ) Unhosted wallet
```

数据通路照 `simulationRiskLevel` 既有范式:
```
弹窗 → CreateInboundTransferSignalDto.counterpartyIsVasp（crypto 必填 / fiat 禁传，用 @ValidateIf）
     → inbound_transfer_signals 新增列
     → 建 deposit 时带到 deposit_transactions
     → Gate 0 判定器读取
```
> 建单入口仅此一个(`POST my/inbound-signals`),无 admin 后门,字段条件必填即全覆盖。

## 6. 详情页

### 6.1 L2 · Transaction Screen —— 收敛为一行,显示 webhook 裁决原值
标签按 `sumsubTxnType`,值取 `sumsubVerdict`(**最新 webhook 的四值原样,不翻译**):
```
L2 · TRANSACTION SCREEN
Travel Rule:  rejected   Score: 98      ← type=travelRule, 最新 webhook=applicantKytTxnRejected
Finance:      approved   Score: 12      ← type=finance,   最新 webhook=applicantKytTxnApproved
```
四值:`approved` / `rejected` / `onHold` / `awaitingUser`。不再有两条泳道,不再有 PASSED/FAILED 自造词表。

### 6.2 Sumsub References —— 收敛为一组
```
Applicant ID
─────────────────────────────────
Txn ID │ Type │ Verdict │ Received At
```

### 6.3 Sumsub Transaction Detail —— 按官方字段直接回显
从「两份 detail」塌成一份(读 `sumsubTxnDetailJson`)。**字段名与展示直接沿用 Sumsub 官方结构**,不做翻译:
`review.reviewStatus` / `review.reviewResult.reviewAnswer` / `scoringResult.score` / `scoringResult.matchedRules[].{name,action,score}` / `scoringResult.applicantActions[].applicantActionId` + `<details>` 折叠原文。

## 7. ⚠️ 硬前提:规则作用域必须挂双类型(合规动作)

**这是本方案成立的前提,不是可选项。**

Sumsub 规则的 `types` 是数组(`List<String>`,必填,min 1)。若筛查类规则只挂 `["finance"]`,那么 `travelRule` 类型的交易**根本不进该规则** —— 而 TR 交易按定义正是「≥ 阈值 + 对手方 VASP」的**最大额那批**,等于恰好在最大额交易上关闭了筛查。

**要求**:所有制裁/AML/链上筛查类规则的作用域改为
```json
"types": ["finance", "travelRule"]
```

**切换顺序**:合规先改规则作用域并确认 → 我方再切提交逻辑。代码可先全部落地,提交那一步以开关控制,合规确认当天翻开关。**未确认前不得切换**,否则产生筛查真空。

## 8. 验证
1. **判定器表驱动单测**:三条件 × 边界(正好 1000/3500 → travelRule)× 漏配币种兜底 × fiat 短路,全矩阵。
2. **迁移数据保真**:5+5 列增删走整表重建,逐列核对 `INSERT…SELECT` 映射(尤其 §2.4 `financeStatus → sumsubVerdict` 的反查回填),迁移前后行数与逐值比对。
3. **渲染验证(项目铁律)**:真起服务截图 —— 客户端弹窗(crypto 有 VASP 选项 / 法币无)、详情页 L2 一行两态(finance / travelRule)、References 一组。
4. **老 mock 管道删除后回归**:确认 `admin-sumsub-simulation` 旧端点删除未波及新 demo 端点;`waiveLimitHold` 豁免后放行路径单测(KYT 先 approved / 后 approved 两种时序)。
5. **e2e 场景重做**:`fixtures/scenarios.ts` 的 S2(crypto 两腿)要改为单笔;其余场景的 `primeTxn` 随字段改名同步。
6. **硬闸**:后端 + admin + client `tsc` 0;`jest` 不回归(`asset-treasury/wallets` 4 例 pre-existing 除外)。
7. **客户面零泄露回归**:新增列(尤其 `sumsubTxnDetailJson`、`counterpartyIsVasp`)不得进 `toCustomerDepositView` 白名单。

## 9. 明确不做
- **真实 VASP 归属服务**(Sumsub `wallet-attribution`):演示系统用客户端录入模拟;真实接入待合规建好 VASP 主体后单独立项。
- **提现域**的同类改造(单笔提交 / 字段对齐):本轮仅 deposit。
- **阈值可配置化**:业主明确要求写死代码。
- **聚合规则分桶问题**:`txns.finance` 与 `txns.travelRule` 是独立聚合,速度/模式类规则若只挂 finance 会漏掉 TR 单——与 §7 同属合规规则配置动作,已并入给合规的确认清单。

## 10. 风险
- 🟡 **§7 未落实即切换 = 筛查真空**,且发生在最大额交易上。切换开关必须由合规确认后再翻。
- 🟡 **改动面大**:待删/改字段在 deposit 域合计约 110 处引用 + 泳道逻辑 10 处,需单独 task 收敛,tsc 为兜底扫漏器。
- 🟡 **迁移是拆字段而非纯改名**(§2.3),回填映射写错会静默丢裁决语义,必须逐值核对。
