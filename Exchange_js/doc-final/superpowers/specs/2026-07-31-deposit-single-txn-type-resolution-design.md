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
| 8 | **数据模型对齐 Sumsub 官方字段命名**,`review` 拆为 `reviewStatus` + `reviewAnswer` 两个正交字段 | 业主:「看下人家字段命名,我们这边直接用就行」+ 选甲(拆两字段) |

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
| `sumsubReviewStatus` | `review.reviewStatus` | `init`/`completed`/`onHold`/`awaitingUser`/… |
| `sumsubReviewAnswer` | `review.reviewResult.reviewAnswer` | `GREEN`/`RED`/null |
| `sumsubScore` | `scoringResult.score` | 规则引擎风险分 |
| `sumsubScoredAt` | (我方落库时刻) | 取代 `financeCheckedAt` |
| `sumsubTxnDetailJson` | 整个响应体 | 报文存证(乙口径,后盖前) |
| `counterpartyIsVasp` | (无官方对应) | 我方判定输入;crypto 必填,fiat null |

### 2.2 删除列
`sumsubFinanceTxnId`、`sumsubTravelRuleTxnId`、`travelRuleRequired`、`travelRuleStatus`、`travelRuleTxnDetailJson`、`financeStatus`、`financeRiskScore`、`financeCheckedAt`、`financeScreeningId`、`financeTxnDetailJson`。

> **仅 deposit 表**。withdraw 的 `preKyt*`/`kyt*`/`travelRule*` 命名**不动**(其两阶段模型与本轮无关)。

### 2.3 四值 → 两正交字段的映射(拆一变二)
我方自造的 `GATE_STATUS_BY_VERDICT` 四值废弃,改为按官方两字段落库:

| 原四值 | `sumsubReviewStatus` | `sumsubReviewAnswer` |
|---|---|---|
| `PASSED` | `completed` | `GREEN` |
| `FAILED` | `completed` | `RED` |
| `ON_HOLD` | `onHold` | null |
| `AWAITING_USER` | `awaitingUser` | null |

**信息量增益**:原 `ON_HOLD` 丢失了「有无结论」这一维,拆分后补回。

### 2.4 存量数据迁移
SQLite 整表重建。回填口径:
- `sumsubTxnId` ← `sumsubFinanceTxnId`(存量单均由 finance 腿驱动)
- `sumsubTxnType` ← 常量 `'finance'`
- `sumsubScore` ← `financeRiskScore`;`sumsubScoredAt` ← `financeCheckedAt`;`sumsubTxnDetailJson` ← `financeTxnDetailJson`
- `sumsubReviewStatus`/`sumsubReviewAnswer` ← 按 §2.3 反查表从 `financeStatus` 映射
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

## 4. 放行闸(`checkAutoApproval`)改写

现状两道闸:
```ts
if (deposit.financeStatus !== 'PASSED') return;                                    // 闸 A
if (deposit.travelRuleStatus !== 'PASSED' && !== 'NOT_REQUIRED') return;           // 闸 B
```

改为:
```ts
// 闸 A 等价改写（拆字段后）
if (!(deposit.sumsubReviewStatus === 'completed' && deposit.sumsubReviewAnswer === 'GREEN')) return;
// 闸 B 整条删除 —— 一笔单只有一个 type，不存在「另一腿未过」
```

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

### 6.1 L2 · Transaction Screen —— 收敛为一行
按 `sumsubTxnType` 显示对应标签:
```
L2 · TRANSACTION SCREEN
Travel Rule:  completed / RED   Score: 98      ← type = travelRule
Finance:      completed / GREEN Score: 12      ← type = finance
```
不再有两条泳道。

### 6.2 Sumsub References —— 收敛为一组
```
Applicant ID
─────────────────────────────────
Txn ID │ Type │ Review Status │ Review Answer │ Received At
```

### 6.3 Sumsub Transaction Detail
从「两份 detail」塌成一份(读 `sumsubTxnDetailJson`)。其余字段(Score/Matched rules/Applicant Action IDs/折叠原文)不变。

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
2. **迁移数据保真**:5+5 列增删走整表重建,逐列核对 `INSERT…SELECT` 映射(尤其 §2.3 四值→两字段的反查回填),迁移前后行数与逐值比对。
3. **渲染验证(项目铁律)**:真起服务截图 —— 客户端弹窗(crypto 有 VASP 选项 / 法币无)、详情页 L2 一行两态(finance / travelRule)、References 一组。
4. **e2e 场景重做**:`fixtures/scenarios.ts` 的 S2(crypto 两腿)要改为单笔;其余场景的 `primeTxn` 随字段改名同步。
5. **硬闸**:后端 + admin + client `tsc` 0;`jest` 不回归(`asset-treasury/wallets` 4 例 pre-existing 除外)。
6. **客户面零泄露回归**:新增列(尤其 `sumsubTxnDetailJson`、`counterpartyIsVasp`)不得进 `toCustomerDepositView` 白名单。

## 9. 明确不做
- **真实 VASP 归属服务**(Sumsub `wallet-attribution`):演示系统用客户端录入模拟;真实接入待合规建好 VASP 主体后单独立项。
- **提现域**的同类改造(单笔提交 / 字段对齐):本轮仅 deposit。
- **阈值可配置化**:业主明确要求写死代码。
- **聚合规则分桶问题**:`txns.finance` 与 `txns.travelRule` 是独立聚合,速度/模式类规则若只挂 finance 会漏掉 TR 单——与 §7 同属合规规则配置动作,已并入给合规的确认清单。

## 10. 风险
- 🟡 **§7 未落实即切换 = 筛查真空**,且发生在最大额交易上。切换开关必须由合规确认后再翻。
- 🟡 **改动面大**:待删/改字段在 deposit 域合计约 110 处引用 + 泳道逻辑 10 处,需单独 task 收敛,tsc 为兜底扫漏器。
- 🟡 **迁移是拆字段而非纯改名**(§2.3),回填映射写错会静默丢裁决语义,必须逐值核对。
