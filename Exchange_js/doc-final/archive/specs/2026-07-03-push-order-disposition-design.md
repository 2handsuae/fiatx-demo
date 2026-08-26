# 推单（Push-Order）处置动作全路径设计

> 日期：2026-07-03 ｜ 状态：设计定稿（脑暴四问 甲/甲/甲/甲）｜ 分支：settle-opt
> 范围：平账处置期第一个原子动作。上游地基 = round3 检测侧驾驶舱（五桶/在途识别/case 唯一）+ effectiveDate 准备字段（双表双写 + 引擎等价保真切换 + recon:rerun）。
> 上游存档：`2026-07-03-recon-cockpit-round3-design.md` §8（推单交互两按钮三阶梯，本 spec 展开落地）。

---

## 0. 决策记录（脑暴四问）

| # | 问题 | 结论 | 理由 |
|---|---|---|---|
| 1 | 推单落账的生效日写哪天 | **回填 = 外部钱实际动的业务日**（选甲） | 不回填则推完单在途解释消失、补账又不算历史那天 → 历史日从在途恶化成 BREAK，修复动作越修越坏；同步分支回执自带日期，无需人拍脑袋 |
| 2 | 人工确认分支生效日谁定 | **operator 必填"外部实际动账日"，属证据链一环**（选甲） | 人工确认本质 = operator 担保"这笔钱真实发生过"，发生在哪天是担保内容的一部分；两条腿产出的账在引擎眼里同构 |
| 3 | 推完谁触发对账重跑 | **推单不碰引擎；一键"重新对账"批量收口 + 日终兜底**（选甲） | case:在途单=1:N、run:case=1:N，每推必跑=批处理时 90% 白跑+run 快照噪音；关 case 只需重跑"今天"一次（回填账生效日都在过去，今天全量吸收） |
| 4 | 同步找不到唯一回执怎么办 | **同步只认恰好 1 条，0/多条一律降级人工**（选甲） | 机器只做确定的事，不确定交给人担保；模糊自动挑=系统伪造确认，错账盖"机器同步"的章最难排查 |

## 1. 全路径一图流

```
case 详情 · 在途行 [去处理]
   └→ 资金单详情页（平账双按钮区，与 ⚡模拟面板物理分区）
        ├─【同步状态】机器查已摄入外部对账单行找回执
        │     ├─ 恰好 1 条 → 自动推进状态机至回执证明的终态
        │     │     └─ 状态机记账，effectiveDate = 回执行 datetime 的业务日（回填）
        │     └─ 0 条 / 多条 → 报"未找到唯一回执（N 条候选）"，指引人工确认
        └─【人工确认】operator 强推：必填 回执号 + 外部实际动账日 + 原因
              └─ 同一条状态机推进+记账路径，effectiveDate = operator 填的动账日
   （推单只改单子；case 在途行即时显示"已推进 · 待重对账"——派生态，不新增字段）

operator 清完一批 → run/case 页点一次【重新对账】（跑今天）
   └→ 回填账全量被今天对账吸收 → 修好的 case 同批 AUTO_HEALED 关闭
        （日终定时对账兜底；历史日快照修正 = 低频补跑，不影响 case 关闭）
```

## 2. 两按钮语义（承接 round3 §8，第一天就与模拟面板分家）

- **同步状态**：幂等安全，重复点无副作用——只在"唯一回执"命中时动手，动手即推进到回执证明的位置。MVP 数据源 = `external_statement_lines`（port/adapter：`ReceiptLookupPort`，将来接银行/托管实时查询只换 adapter，按钮语义不变）。
- **人工确认**：单人操作、无审批门（round3 定稿）；**强制证据三件套 = 外部回执号 + 外部实际动账日 + 原因**；审计带"人工确认"标记；月度计量上报（人工确认占比 = 运营健康度指标）。
- 两按钮复用**同一条状态机推进路径**（既有 `POST /admin/funds-orders/:fundsOrderNo/advance` 语义家族，但独立端点/独立语义，与模拟面板的 advance 分家）——差别只在证据提供者：机器（对账单行 ID）或人（担保填入）。引擎与账本不区分账由谁推。
- 状态机现状锚点：`FundsOrderStatus = CREATED→SUBMITTED→CONFIRMING→CONFIRMED→CLEARED`（终态）+ `FAILED/TIMEOUT`。同步命中回执 = 外部已完成证明 → 沿状态机既有合法迁移推进至 CLEARED（多步则逐步走完，每步照常记账/发事件，不跳步不造新迁移）。

## 3. 回填口子（effectiveDate 准备字段等的"改写方法"）

- **不改历史账，只给新账定生效日**：`writeEvidence()` 增加**可选参数 `effectiveDate`**——不传 = 现状（写当天）；仅资金单状态机的推单链路传入回填值。投影器照常复制（EvidenceLike 已带该字段，零改动）。
- 校验三条：①不能是未来 ②不能早于该资金单 `createdAt` 业务日 ③合法 `YYYY-MM-DD`。
- **铁律不破**：平账永不直写 TB/账本；回填值经 状态机→记账服务→writeEvidence 漏斗流下。
- **已回填生效日不可再改**：生效日只在记账诞生时定一次；定错走将来的"冲正"动作，不开修改接口。

### 3.1 落地增量（实现期回写——回填不止一个漏斗，是一条透传链）

原设计只点了 `writeEvidence()` 一个口子，落地发现回填值要穿过**三层**才到库，缺一层则回填断在半路（表现为"推单 effectiveDate 回参数对了、库里 evidence 却仍是当天"）。三层全部补齐 `effectiveDate?`（不传 = 写当天，行为零变化）：

1. **`AccountingService.executeTransfer` — 隐藏的中间漏斗（T2 落地补）**：deposit/withdraw 记账不直接调 `writeEvidence`，而是走 `executeTransfer({ evidence: EvidenceParams })`。故 `EvidenceParams`（`accounting.types.ts`）加 `effectiveDate?`，`executeTransfer` 两处 `writeEvidence` 调用透传（`accounting.service.ts` — 双分录各一）。这是 T2 事件链穿透的真正落点：状态机 advance → 工作流监听器 → `executeTransfer` → `writeEvidence`，回填值必须在 `EvidenceParams` 边界带上，只补 `writeEvidence` 签名不够。
2. **`enrichForPost` — 第二个记账入口（不只 `writeEvidence`）**：withdraw 的 pending net/fee 记账走 `TbEvidenceService.enrichForPost(...)`（re-project 补全 pending 凭证），非 `writeEvidence`。故 `enrichForPost` 同样加 `effectiveDate?`（`tb-evidence.service.ts` — 存在即写）。原 §3"writeEvidence 唯一漏斗"措辞不准，实为**两个记账入口 × executeTransfer 一个中间层**。
3. **同步匹配 tier-1 用三字段 `externalRefs`（对齐 matcher，非单 `referenceNo`）**：§4 tier-1"参考号精配"落地为 `[txHash, referenceNo, providerTxnId].filter(Boolean)` 的 membership 匹配（`push-order.service.ts::toView`），与对账 matcher 的 `refsOf` 同源——链上回执是 `txHash`、法币是 `referenceNo`/`providerTxnId`，单取 `referenceNo` 会漏掉链上单。

## 4. 同步匹配规则（"唯一"判据，严格度递减两档）

任一档命中**恰好 1 条**即确认；命中多条即止（不进下一档）：
1. **参考号精配**：资金单 `externalRef`（txHash/银行回执号）非空 且 == 对账单行 `externalRef`；
2. **要素精配**：`walletRef` + 方向 + 金额完全相等 + 时间窗（单子创建日 ~ 今天）内唯一。
两档皆无唯一 → 返回候选数（"0 条 / 3 条相似"），同步终止。**同步永不猜。**
（该匹配与对账引擎 matcher 的 ref/fuzzy 匹配语义同源，实现可复用其工具，但独立函数——推单要的是"确认单笔"，不是"批量分桶"。）

## 5. 收口：一键重新对账

- run/case 页【重新对账】按钮 = 触发一次今天的全引擎 run（与 `recon:rerun` 同一服务入口 `WalletReconRunService.run({cutoff: now})`，HTTP 化 = 既有 `POST /admin/reconciliation/runs/wallet`，前端加按钮即可）。
- 回填账 `effectiveDate < 今天` → 落 `effectiveCutoffFilter` 第一段 → 今天 run 全量吸收 → 一批推单修好的所有 case 同批走既有 `SYSTEM_RECON_CASE_AUTO_HEALED` 关闭。
- 日终定时对账兜底（既有调度）。
- 历史日快照修正（把上周一 BREAK 快照重跑成 MATCHED）不影响 case 关闭：MVP 不做 UI，`recon:rerun --cutoff=<D>T23:59:59Z` CLI 即够，run 列表自然多一条同业务日新 run（旧 BREAK 快照保留，审计链完整）。

## 6. 审计与可观测

- 每次推单（两腿）写 AuditLogsService（DI）：actor、fundsOrderNo、fromStatus→toStatus、证据（同步=命中行 ID；人工=回执号+动账日+原因）、回填 effectiveDate、"人工确认"标记（仅人工腿）。动作字典走 `AuditActions`（新增 RECON_PUSH_ORDER_SYNCED / RECON_PUSH_ORDER_MANUAL 之类，实现期定名，须遵守 audit-logging.md 字典纪律）。
- "已推进 · 待重对账"= 派生态（单子终态 && case 仍 OPEN 且在途行指向它），零新增存储。

## 7. 验收标准（实现期展开为 plan 硬闸）

- [ ] e2e：demo 在途场景 → 同步推单（唯一回执命中）→ 重新对账 → case AUTO_HEALED，生效日=回执业务日，历史日补跑从在途→MATCHED
- [ ] e2e：人工确认腿同上，审计含三件套+人工标记
- [ ] 同步 0 条/多条候选 → 不动状态机、如实报数
- [ ] 校验拒绝：未来日期/早于单子创建日
- [x] 金闸门：`recon:demo` 九场景 pre/post 结论行逐字一致（score 9/9、两条恒等式、status==BREAK、manifest 9/9 零差异 → `GOLDEN_GATE_OK`）
- [x] tsc 0 / jest 净新增失败 0（基线 = asset-treasury/wallets 4 失败；T4 getCase 批量查询漏了测试桩致 recon-query spec +3 回归，已补 `fundsOrder.findMany` 桩收回，净新 0）

### 7.1 e2e 落地结果（实现期回写——含合成 demo 数据的 heal 边界，诚实记录）

**两腿状态驱动 + 回填 + 审计 + 重对账触发，全部 EMPIRICALLY 证过**（self 栈 3100，curl+sqlite）：
- **同步腿**：给在途单播种"生效日=昨天"的唯一匹配对账单行 → `POST …/push/sync` → `finalStatus=CLEARED, effectiveDate=2026-07-02, matchedLineId=<seeded>`；审计 `RECON_PUSH_ORDER_SYNCED`（actor+matchedLineId+effectiveDate+from/to）。
- **人工腿**：`POST …/push/manual`（回执号+动账日+原因）→ CLEARED；审计 `RECON_PUSH_ORDER_MANUAL` 带**三件套**（receiptRef/externalDate/reason）+ `manualConfirm=true`。
- **失败路径**：sync 0 候选 → 400"未找到唯一回执（0 条候选）"、状态不变；manual 未来日 → 400"不能是未来"、早于创建日 → 400"不能早于单子创建日"，均不动状态机。
- **重对账**：`POST /admin/reconciliation/runs/wallet {cutoff:now}` → 201，case 批量 re-observe。

**⚠️ 合成 demo 数据 heal 边界（Option B 诚实记录，非代码缺陷）**：`recon:demo` 场景1 的在途单是**挂在一张已 SUCCESS（已记账）的 deposit 上的状态壳**——单本身无待记账链（demo 设计"不触发 TB 记账"，靠 `bumpClosing` 人造 +101 外部差）。故推单驱到 CLEARED 后，deposit 工作流监听器见 deposit 已 SUCCESS→**不重复记账**（正确），无新 evidence/flow 行产生；重对账时该单已终态、不再被在途匹配器认领 → 桶 IN_TRANSIT→BREAK（残差 101 无真实内部记账吸收），**delta 不归 0、case 不 AUTO_HEALED**。DB 内 6 笔 deposit / 5 笔 withdraw 全已 SUCCESS，无未记账真实单可挂，Option A（真实 deposit 流造在途单）在本 demo 数据上不可低成本达成。**effectiveDate 回填→记账→被对账吸收使 delta 归 0** 的完整闭环由 T1 准备字段 e2e 已单独证过（roadmap「effectiveDate」条：注入"生效日=昨天"补账 → delta 79200000→0）。推单侧对该闭环的贡献 = 把回填生效日经状态机漏斗**盖进记账**（已证透传链三层齐全），最后一环"记账吸收"依赖被推单落一笔真实首次记账，合成壳单无此记账故止于状态/审计验证。
- **前端点击流**：本环境 Chrome 扩展未连、preview MCP 无法与 self 栈共占 3101 → 浏览器渲染点击流未跑（T4 已验按钮渲染）；改以数据契约头验替代并证实：`GET …/cases/:no` 返回 `flowComparison[].fundsOrderStatus`，推单后该值 SUBMITTED→CLEARED 且 case 仍 OPEN——恰是徽记 JSX 渲染条件 `kase.status==='OPEN' && row.fundsOrderStatus==='CLEARED'`（`ReconciliationCasesDetailPage.tsx`），"重新对账"按钮打的 `POST …/runs/wallet {cutoff}` 端点 201 可用。

## 8. 明确不做（本期）

补单/冲正/豁免/偿付等其余六动作｜审批门｜模糊匹配自动挑选｜已回填生效日修改接口｜实时银行/托管查询 adapter（只留 port）｜in-transit 老化升级｜容差规则｜历史补跑 UI
