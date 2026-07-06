# V6 兑换合规 — 深度调研留底（Swap / Conversion Compliance Research）

Date: 2026-07-04 ｜ Status: 研究定稿（provenance 留底，用于重排 roadmap V6）
Method: workflow harness，103 agent 七维度并行调研 → 抓 VARA Broker-Dealer / Market Conduct / CRM / Transfer&Settlement / Technology&Information Rulebook + FATF R.10/16/20 原文 → 每条发现 3 视角对抗核验（条款真伪 / 缺口真伪 / 优先级）→ 综合；32 findings，对抗后 **24 条存活、8 条驳回**。多条头条结论逐字核到 VARA 官方 PDF（VARA_EN_226 / _190 / _123 / _169）。
Scope: 平台内 crypto↔fiat 兑换执行流 + 合规控制（AML 交易监控、市场行为/最优执行、本金披露、大额/EDD、操作韧性）。**不含** 热钱包流动性（V7）、Sumsub 筛查执行细节。

---

## 核心结论（代码验证）

**设计前提「资金不出境 → 免 L2 合规」对了一块、错了两块。** 一手核实（truth/v6-swap.md §0/§11/§47）：现有兑换合规**仅 L1 同步资格门**（`assertTradingEligibility('SWAP')`），无 L2 KYT、无交易监控、无最优执行控制、无本金披露。

- ✅ **对的一块**：Travel Rule（跨境转账报文）确实可豁免——V6 是同一客户账本内余额交换，无 VA 对外转移、无第二对手方，CRM III.G 构成要件不满足。
- ❌ **错的两块**：把「免 Travel Rule」错误泛化成「免整个交易层合规」，漏掉两根与「钱出不出平台」**根本无关**的牌照级支柱：
  1. **反洗钱交易监控**（触发锚点是「客户业务关系/所有交易」，非资金去向）；
  2. **市场行为 / 最优执行 + 本金披露**（触发锚点是「以本金身份对客户成交」，与托管拓扑无关）。

---

## 一、现有 V6 的 VARA 评审

- L1 资格门 ≈ CRM CDD ✓（准入资格，**不是**交易监控——两者不同义务，L1 覆盖不了 AML 交易监控）。
- 平台是**本金交易方（principal/dealer）**：自己定价（Binance 中间价 + rateMarkupBps 点差）、与客户对赌、客户 take-it-or-leave-it。这一形态**触发** best execution + 利益冲突披露义务，而 V6 该维度**整维空白**。
- BD Rulebook II.A.2 末句明文：`Rule II.A.1 does, however, apply where a VASP satisfies a client order by dealing as principal with the client`——以本金对（零售）客户成交，最优执行**不豁免**；豁免只给 VASP/合格/机构投资者的 discretionary quote。

---

## 二、两根 P0 支柱 + 落地设计

### 支柱一 · 反洗钱交易监控 `[9]/[14]/[29] 多条 3-0`

**本质白话（与甲方共识）**：反洗钱**看的是客户的行为模式**（一段时间里钱怎么流动），**不是**评判某一笔换得值不值。单笔也可能触发，但靠的是这笔的**背景**（谁换、多大、刚充完就换），非这笔本身的价格。

- **依据**：CRM III.F.1（持续监控业务关系识别可疑交易）/ III.E.5(a)（审计存续期所有交易）/ III.F.2（可疑指标）/ III.F.3-4（MLRO 经 goAML 报 FIU）/ III.C.4（落地 FATF 2020 VA 红旗）；FATF R.10/R.20（不论金额、即使未完成都报）。
- **看什么（5 类红旗）**：① 刚充就急着换走（velocity）；② 金额大 / 拆小凑大（threshold + structuring）；③ 来回空转、多币种无理由（对敲）；④ 与 KYC 声明身份不符（profile mismatch）；⑤ 高风险/PEP + 大额（联动 CRA riskRating）。
- **落地（真实钩子 + 复用）**：`executeSwap()` 成交后 emit `SwapCompleted` → 规则引擎（rule-based，不依赖 Sumsub，因现无可用 TM 引擎）→ 命中开 `ApprovalCase`(MLRO，复用 `governance/approvals`)→ MLRO 复核 → STR 候选（**真提交走 V9 goAML，MLRO 不可外包**）。累计器优先用 funds_orders 查询算、AED 走现有 peg 3.6725，不新建表。
- **拍板点（甲方决策）**：**Phase 1 全量「只检测不阻断」**（钱没出平台，FATF R.20 事后报告即合规，零状态机改动）；**Phase 2 仅对高风险/超大额加成交前挂起**（需给状态机加 PENDING_COMPLIANCE 态）。此引擎应设计成充值/提现共用的 L2（它们现为状态位筛查）。

### 支柱二 · 最优执行（best execution）`[0]/[5] 3-0，逐字核到 PDF`

**本质白话（澄清甲方误会，纠我上一轮「公道的价」的误导措辞）**：最优执行**不限制利润、不管点差收几个点**（无硬性上限），管的是**透明 / 一致 / 有据**三件事：

- **透明**：客户成交前清楚看到「平台吃 X 点差」；禁把基准市场价做假来藏真实利润（如真市价 10 万记成 9 万、报客户 8.8 万，藏了 12% 假称 2%——这才是要抓的）。
- **一致**：按公布规则报价；**按客户等级/交易量分档完全允许**（行业惯例），红线是「区别对待依据**规则**还是**人**」——同档同价、禁运营手动看人改单个客户点差。
- **有据**：每笔留证据链——那一刻**真实市价**（≥2 源交叉、防单源抽风）+ **公布的点差规则** + **客户成交价 = 市价+点差 对得上**。监管查你，摆这本账即「证明了」。

- **依据**：BD Rulebook II.A.1（prevailing market conditions 下 most favourable price）/ II.A.2（本金成交不豁免）/ II.A.3（书面控制管冲突）/ II.A.4（价差/波动/流动性因子）/ II.A.13（内部化订单流 ≥季度执行质量复核）/ II.A.16（执行政策+重大变更通知客户）/ II.B.1（riskless principal 许可，以 best-ex 为条件）。
- **落地（真实钩子 + 复用）**：报价 `SwapQuoteService.createQuote()` 加第二参考源 → 价格带 + prevailing mid → 偏离治理阈值则拦截/降级/needsReview；每张 Quote 落 `bestExecEvidence`（源/mid/成交价/点差/偏离/时间戳）留存 ≥8y，写 `AuditLogsService`。政策（点差上限/偏离容忍/peg 来源）挂现有 SwapFeeLevel 式 Maker-Checker（configHash）。季度内部化复核借 material-freshness-cron 形状。
- **拍板点（甲方决策）**：偏离超阈**先「降级转复核」（软）、第二源跑稳后收紧硬拦**。best-ex 重点是**能拿出证据自证尽力**，evidence + 季度复核是 VARA 查你的底牌，比价格本身更关键。

---

## 三、P1 / P2 清单（存活项）

**P1（VARA 强制、次级）**：
- 点差作「平台留存」双点披露 + 成交确认单（现连成功通知都没接）｜BD II.A.6
- 本金身份 + 利益冲突 + 定价方法 对外披露｜BD I.B.1.a/d + II.B.1
- 价格公允性书面政策 + 治理（点差上限/偏离容忍/peg 来源入 Maker-Checker）｜BD II.A.1/A.3/A.16
- 内部化订单流 ≥季度执行质量复核（自家价 vs 外部可得价，「调整 or 书面说明」）｜BD II.A.13
- 陈旧价/极端行情保护（价源心跳+最大陈旧度拒单+第二源熔断+成交前重校验，顺带解决滑点）｜BD II.A.4/A.12 + Tech I.H.1
- 兑换环节市场操纵监控（账本内也能 wash/自成交/套陈旧价，达阈报 FIU/VARA）｜Market Conduct VIII §I/§J
- AED 3,500 累计阈值 → re-CDD + 大额兑换审批门（单笔+滚动累计，与拆单共用计数器）｜CRM III.E
- 高风险/PEP 大额兑换 EDD（L1 门读 riskRating→打 EDD 标记→校验 SOF/SOW 时效；客户层义务，不必逐笔硬闸）｜CRM III.E.10
- 卡单重大事件 72h 上报判定（STUCK 严重度分级→达档起 72h 计时+VARA 通报草案）｜Tech K.1 + I.H.1
- 卡单期间客户资金保护 SLA（leg1 已扣、买入腿卡→最长停留 SLA、超时强制修复 or 全额回滚释放 + 客户侧可见）｜CRM I.E.4/I.E.1
- 本金交易 vs 自营禁令边界（出「仅即时轧平、禁投机」政策 + 存货敞口台账 ≥8y）｜Market Conduct VII.A.1/A.3 + BD II.B.1

**P2（低频/治理/辩护）**：
- 拆单/结构化聚合监控（既有客户非 occasional，列低）｜CRM III.E.4(b)
- 成交前滑点重校验（30s TTL 内重拉 mid 比对）
- ✅ **可保留辩护**：Travel Rule 不适用内部兑换（III.G 需对手方/transfer）——须**存证依据** + 护栏（将来支持转出/跨客户则立即触发）｜CRM III.G

---

## 四、可辩护性判定（「免 L2」的边界必须写死）`[12]/[18]/[31]`

| 义务 | 触发锚点 | 「资金不出境」能否豁免 |
|---|---|---|
| Travel Rule（III.G）| VA **对外 transfer** + 两对手方 | ✅ **能**（唯一成立处，须存证）|
| 交易监控 / STR（III.F/III.E.5）| 客户业务关系 / 所有交易 | ❌ 不能 |
| 最优执行 + 披露（BD II.A/I.B）| 以本金对客户成交 | ❌ 不能 |
| EDD / 风险分级（III.E.10/III.D）| 客户风险 | ❌ 不能 |

**根因**：设计者把只对 Travel Rule 成立的豁免逻辑，无声外推到了 TM/best-ex/EDD 三项无跨境前提的义务。truth/v6-swap.md §11/§47「合规仅 L1=设计决策非遗漏」**部分错误且危险**，待更新为「TR 可豁免 / TM·best-ex·EDD 不可豁免」两半（后续 truth+BACKLOG 任务）。

---

## 五、关键纠偏（研究推翻旧设想）

1. **「资金不出境 → 免 L2」过度泛化**——只 Travel Rule 可豁免，AML 监控 + 最优执行两根 P0 支柱不豁免。
2. **最优执行 ≠ 限制利润 / ≠ 「不挣钱叫好价」**——管透明/一致/有据，点差多少是商业决策（无硬上限）；按等级分档合规，红线是「规则 vs 因人」。
3. **FAILED/REVERSED 死枚举 + STUCK 部分成交一致性 = 技术债，非合规洞**——被对抗核验 **3:0 一致驳回**（现有 void + two-phase + 审计日志已覆盖，BACKLOG 已记）。别在此花合规预算。

---

## 六、对抗核验战果 + caveat

- **驳回 8 条**：重复的 II.A.6 披露（去重）、auto-DLT 工具、成交量回喂风险分级、STUCK BCDR 部分成交一致性（3:0）、死枚举审计留痕（3:0）、适当性协议条款（多已存在）、best-ex defensibility 重复项。对抗过程有效。
- **caveat**：① defensibility 维度 2 个 verify agent 因 API 断连挂了（clause/priority 各一票），但该维度结论被 [9]/[14]/[29] 从其它维度重复确认（3:0 / 2:0），不影响定论；② goAML STR 提交是 V9 领域且 MLRO 不可外包，swap 只产候选；③ 现无可用交易监控引擎可插——swap 需建第一个 rule-based 引擎并设计成共享 L2；④ OFAC 类美国属人条款不直接约束 Dubai 主体（本次未主张）。

## 主要源

VARA: Broker-Dealer Services Rulebook（VARA_EN_226：II.A 最优执行全节、II.B 本金交易、I.B.1 披露）、Market Conduct Rulebook（VARA_EN_190：IV.A 零售定义、VII.A 自营禁令、VIII §I/§J 操纵）、Compliance & Risk Management Rulebook（VARA_EN_123：III.C/III.D/III.E/III.F/III.G）、Technology & Information Rulebook（VARA_EN_169：I.H BCDR、K.1 72h）。FATF: R.10/R.16/R.20、2020 Virtual Assets Red Flag Indicators。
