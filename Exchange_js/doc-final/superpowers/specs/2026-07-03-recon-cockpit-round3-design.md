# V8 对账 Round 3 — 驾驶舱 + 引擎收口 + 演示数据 设计

> 日期：2026-07-03 ｜ 状态：设计定稿（脑暴四节逐节确认通过）
> 范围：① Run 详情页改版 ② Case 详情页改版 ③ 对账流程优化（在途识别 / run 快照 / case 唯一性 / 死码清扫）④ recon:demo 重写（9 场景注入）
> 上游对齐：本 spec 是「平账流程」的检测侧地基轮。平账处置动作（推单/补单/豁免等）**不在本期**，下一期基于本期产出的数据做。

---

## 0. 范围决策记录（脑暴锁定）

| 决策点 | 结论 |
|---|---|
| 引擎最小改造是否随页面一起做 | ✅ 一起做（在途识别 + 五桶 + 快照，页面吃真数据） |
| 在途识别机制 | ✅ 按资金单识别（孤儿外部行 → 查非终态 funds_orders 配对；覆盖充值/提现/swap 全部三类，配上的单即未来推单跳转目标） |
| effective date（结算日期字段） | ❌ 本期不做，单独一期（牵扯四条记账写入路径） |
| 推单交互（同步状态/人工确认） | ❌ 移出本期，方案存档见 §8 |
| case 页处置动作 | ❌ 本期只读（含资金单只读深链），处置按钮下一期 |
| demo 注入形态 | ✅ break 模式一次全注入 9 场景 + manifest 根因答案键 |
| 死码清扫边界 | ✅ 引擎 + 外围全清，清单先行逐项验引用 |

## 1. 术语与新旧边界

- **新引擎（live 主链路，保留并增强）**：`wallet-recon-run.service`（编排）+ `engine/v2/wallet-balance-checker` + `engine/v2/wallet-flow-matcher` + `projector/account-flow-projector` + `domain/reconciliation-query.service`。数据面 = `account_flows` + `external_balances` / `external_statement_lines`。
- **旧引擎（五公式时代，本期物理删除）**：2026-06-20 credit-net 设计的检测引擎，Phase B 后失去前提，roadmap 记录为 "neuter 不删，Phase C 清"——本期即 Phase C 执行。
- **FundsOrderSourceRepo**：Round 2（2026-07-02）新写的**兼容垫片**——三表合一后把 funds_orders 投影回旧表形状，让旧引擎文件零改动续跑。消费方 = 4 个旧引擎文件 + mock-external.adapter，无 live 引用。旧引擎删除后垫片完成历史使命一起退役（新代码按 funds_orders 原生语义直读，不再投影）。

## 2. 引擎改造

### 2.1 在途识别（匹配器第三轮）

现有两轮（externalRef 精确 → 金额+方向+时窗模糊）之后，对剩余**孤儿外部行**执行第三轮：

- 调 funds-orders 模块**公开 service 方法**（禁止直查表）检索候选资金单：
  - 钱包匹配：`fromWalletId == walletRef`（外部行方向 OUT）或 `toWalletId == walletRef`（IN）
  - 状态：非终态（∉ {CLEARED, FAILED, TIMEOUT}）
  - 金额相等（以资金单到账口径 `netAmount` 为基准，实施时按方向核定 amount/netAmount 取哪个）；单号候选键（txHash / referenceNo / providerTxnId ↔ 外部行 externalRef）能对上则优先
  - 宽松时窗（±72h）防误配陈年单
- 配上 → line item `matchStatus = 'IN_TRANSIT'`（新枚举），`internalSourceType='FUNDS_ORDER'`、`internalSourceNo=fundsOrderNo`（未来推单跳转目标）
- 配不上 → 维持 `ORPHAN_EXTERNAL`

### 2.2 五桶互斥分类（每钱包，命中即止）

```
残差 := delta − Σ(在途行签名金额，IN 为正 OUT 为负)
① 残差 ≠ 0                          → BREAK
② 残差 = 0 且 在途行 > 0             → IN_TRANSIT
③ 残差 = 0 且 在途行 = 0 且 OI+OE+MM > 0 → SOFT_FLAG
④ 其余                              → MATCHED
```

- 恒等式 **总钱包数 = 四桶之和** 写进单测。
- 混合钱包（如既有在途又有孤儿）按上述优先级归桶，line items 完整保留不丢信息。

### 2.3 无主外部账户（场景 9 逼出的补丁）

现引擎对 `walletRef = null` 的外部余额头**静默跳过**——孤儿充值不可见。本期改为：解析不到钱包的外部余额头直接开 case（BREAK 桶，`caseReason='unattributed_external_account'`，case.walletRef 记原始 accountRef/subAccount），不再静默。该头同样写入 run_wallets 快照一行（bucket=BREAK），计入总钱包数与四桶恒等式。

### 2.4 Run 快照持久化（新表，修"历史 run 数字会漂"bug）

现状 bug：run 详情页的钱包表是打开页面时现算的，违反"run 不可变"。改造：

- 新表 `reconciliation_run_wallets`（run 跑完每钱包定格一行）：`runId, walletRef, assetCode, book, coaCode, ownerNo, bucket, internalTotal, externalClosing, delta, inTransitAmount, matchedCount, orphanInternalCount, orphanExternalCount, mismatchCount, inTransitCount, caseNo?`
- `reconciliation_runs` 加四桶计数列：`matchedCount / inTransitCount / softFlagCount / breakCount`（+ `walletCount`）；三元组沿用已有 `openedCount / reObservedCount / closedCount`
- run 详情页只读快照，不再 read-time 重算

### 2.5 Case 唯一性：每钱包一个 OPEN

- upsert 探测键从 `(walletRef, businessDate, OPEN)` 改为 `(walletRef, OPEN)`，跨日复用同一 case（快照字段刷新、firstSeenRunId 不动）
- auto-heal 同步放开日期限定：全部 OPEN（layer=WALLET）中，本次未破的钱包 → RESOLVED + AUTO_HEALED
- `reconciliation_cases` 加 `bucket` 列（IN_TRANSIT / SOFT_FLAG / BREAK），列表可筛；businessDate 语义 = 首次发现日
- 勾稽恒等式（进单测）：新开 + 复观察 = 开 case 桶（in-transit + soft-flag + break）钱包数

### 2.6 配套纪律

- **审计起步**（模块现状零审计）：case 开/关（含 auto-heal）写 `AuditLogsService.recordSystem`，run 完成写一条系统事件；entity/action 用字典已预留的 `RECONCILIATION_RUN_V8 / RECONCILIATION_CASE` 与 `RECONCILIATION_BREAK` 等
- **RBAC**：新端点登记 `rbac.catalog.ts` + `db:base:sync` + 重启后端验证（历史 403 教训）
- in-transit case 老化升级（挂超 N 天转 break）**本期不做**，字段留好

## 3. Run 详情页（布局定稿：甲 · 上下两排）

自上而下：

1. **导航条**：← Runs + 刷新（`DetailPageHeader` 规范，无 title/subtitle）
2. **结论条**：PASS/BREAK + 一句人话（"12 个钱包，5 个平，3 笔在途，4 个需要处理"）
3. **模块一 · 本次体检（钱包维度快照）**：五卡横排 = 总钱包 / Matched(绿) / In-transit(蓝) / Soft-flag(琥珀) / Break(红)，各卡可点击下钻到过滤后的钱包明细/case
4. **模块二 · 工单流转（case 维度增量）**：三卡横排 = 新开 / 复观察 / 本次关闭
5. **钱包明细表**（读 run_wallets 快照）：钱包 / 归属 / 币种 / 内部 / 外部 / Δ / **在途** / 流水(✓n OI OE MM ⧖) / 桶状态徽章 / Case 深链；非 matched 行整行可点
6. **右侧栏**：Identity（Run No / Status / Verdict / Trigger / Mode）+ Lifecycle（Started / Completed / Created），272px 规范

「在途」列语义：该钱包被在途单解释的签名金额——in-transit 桶 Δ==在途；break 桶两者不等，"解释不干净"可视化。
**全局未决 case 总数不放本页**（历史照片原则），放 case 列表页顶部。

## 4. Case 详情页（布局定稿：乙 · 单表混排）

自上而下：

1. **导航条** + caseNo + 桶徽章（BREAK 红 / IN_TRANSIT 蓝 / SOFT_FLAG 琥珀）+ 严重度徽章
2. **钱包身份**：钱包 / 归属(ownerNo) / 科目(coaCode) / 币种
3. **差额解释五格**（本页核心）：内部余额 / 外部余额 / Δ / 在途解释 / **未解释残差**（红色高亮）
4. **观察历史横条**：首见 RUN → 复观察 ×N（最后 RUN）→ 仍 OPEN·已挂 N 天（红）或 已关闭 by RUN
5. **流水下钻单表**（乙形态）：类型徽章（在途/外有我无/我有外无/金额不符）/ 方向 / 金额（不符行显示 a ≠ b）/ 外部单号 / **内部源**（资金单号只读深链，本期无处置按钮）/ 时间；按严重度排序，matched 行默认隐藏可展开
6. **相关视图**：Account Statement（钱包流水对账视图）/ External Balance 深链
7. **右侧栏**：Identity（Case No / 桶 / 状态 / 严重度 / Δ）+ Lifecycle（首见日 / 首见 run / 最后观察 / 关闭于）

## 5. 死码清扫（清单先行）

**引擎内部**（探索确认主链路零引用，删文件+测试+module 注册）：
`balance-snapshot / subledger-inputs / in-transit / balance-recon / match-engine / match-engine-v2 / classifier / anomaly-classifier / internal-actions / leg-projection / drilldown-match`

**外围陪葬品**：
- `data-source/funds-order-source.repo`（垫片，见 §1）
- `adapters/mock-external.adapter` + `adapters/external-data.provider`（现 demo 未引用，最后核验后删）
- RBAC 字典残留：`/admin/reconciliation/outstandings*`、`/fee-accruals*`（对应 controller 已不存在）
- constants / DTO 中只服务旧引擎的孤儿定义；admin-web 若存在挂旧概念的残页一并清

**纪律**：
1. 实施第一步产出**完整删除清单**，逐项 grep 验引用（防误删 LIVE 的历史教训），清单落在实施计划里
2. 只清代码不清数据（历史 DB 旧 layer case 行不动）
3. 验收：`tsc` 0 错 + 构建绿 + 新 demo 全绿 + 删除项全库 grep 零引用

## 6. recon:demo 重写（9 场景注入）

### 6.1 注入映射表

| # | 根因场景 | 注入方式 | 预期桶 | 预期流水类型 |
|---|---|---|---|---|
| 1 | 在途时序差 | 资金单停在确认中不推终态 + 外部镜像写确认行 | IN_TRANSIT | IN_TRANSIT |
| 2 | 手续费差额 | 内部毛额，外部同单号净额 | BREAK | AMOUNT_MISMATCH |
| 3 | 对账单缺行 | 内部正常，外部镜像删行 | BREAK | ORPHAN_INTERNAL |
| 4 | 精度/单位错 | 外部行金额 ×100 | BREAK | AMOUNT_MISMATCH |
| 5 | 银行杂费 | 外部多一行 OUT，内部无 | ↘ 与 7 对冲 | ORPHAN_EXTERNAL |
| 6 | 充值漏监听 | 外部多一行 IN，内部无单无账 | BREAK | ORPHAN_EXTERNAL |
| 7 | 银行利息 | 外部多一行 IN，与 5 等额同一公司钱包 | SOFT_FLAG | ORPHAN_EXTERNAL |
| 8 | 银行退汇 | 外部 IN+退汇 OUT 一对，内部只记 IN | BREAK | ORPHAN_EXTERNAL |
| 9 | 孤儿充值 | 外部 IN 到无主地址（解析不到钱包） | BREAK（无主） | ORPHAN_EXTERNAL |

钱包分配：每场景独立钱包（5+7 特意同钱包对冲制造 soft-flag），另留干净钱包做 matched 底色。预期产出 **8 个 case**（6 BREAK + 1 IN_TRANSIT + 1 SOFT_FLAG）。

### 6.2 manifest 答案键

每注入一条：`scenarioId + 根因代号 + walletRef + 预期桶 + 预期流水类型 + 金额 + 外部单号 +（场景1）fundsOrderNo`。写盘路径沿用现有 manifest 机制。

### 6.3 自验（跑完自动断言）

1. 逐条对照 manifest：检测到 + 桶正确 + 流水类型正确 → 输出 9/9 得分表
2. 恒等式：总钱包 = 四桶之和；新开 + 复观察 = 开 case 钱包数
3. 全部通过才算 demo 绿

### 6.4 演示动线

`reset`（清场）→ 基础业务流（真实记账+资金单）→ `pass`（干净镜像全绿）→ `break`（9 场景注入，8 case 全开）→ 自验得分 → case 留 OPEN 持久保留，供下一期平账开发使用。

## 7. 验收标准

- [ ] `tsc` 0 错、构建绿、jest 净新增失败 0
- [ ] `recon:demo:pass` 全绿；`recon:demo:break` 产出 8 case，manifest 断言 9/9 PASS，两恒等式成立
- [ ] Run / Case 页按 §3/§4 渲染，**preview 截图验收**（不以 curl/tsc 代替）；文案遵循 funds-orders 双语模式（labelZh/labelEn）
- [ ] 死码删除清单全库 grep 零引用；RBAC 新端点登记 + sync + 重启验证
- [ ] case 开/关审计事件可在 audit-logs 查到

## 8. 存档 · 推单交互方案（下一期直接用）

- 交互：case 在途行"去处理"→ 资金单详情页；页上两按钮三阶梯——**同步状态**（幂等安全，MVP 实现 = 查已摄入外部对账单行找回执，port/adapter 架构，后接真实银行/托管查询 API 只换适配器）与**人工确认**（强推，单人 + 强制证据字段（回执号+原因）+ 审计"人工确认"标记，月度计量上报；不设审批门）
- 铁律：平账永不直写 TB，只推资金单状态机，由状态机记账
- 复用：`POST /admin/funds-orders/:fundsOrderNo/advance` 已有，需与模拟面板语义分家（"同步"/"人工确认"两按钮从第一天分开）

## 9. 明确不做（本期）

effective date 及按日切片取数｜推单/补单/冲正/豁免/偿付等处置动作｜in-transit 老化升级｜容差(tolerance)规则｜case SLA 通知｜旧 layer 历史数据迁移
