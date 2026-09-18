# V8 对账流程 — 深度审计留底（Reconciliation Gap Audit）

Date: 2026-07-06 ｜ Status: 首次遗漏审计定稿（V8 此前经 I1-I5→credit-net→Phase B 三轮重构但无 deep-research spec；本次为合规向全量找漏）
Method: workflow harness（精简版，防额度），38 agent / 5 盲区猎手（法币 Client Money 对账 / 客户 VA 对账+PoR / 短缺补救 / 托管方·银行核对 / 对账治理）拿 roadmap+truth 当基线只找清单外义务 + 每条 3 视角对抗（条款真伪 / 真未覆盖 / 归属 V8）；11 候选 → **6 真发现（4 P1 + 1⚖️改写 + 1 P2）+ 1 BACKLOG + 2 驳回**。护栏：BD-only、HexTrust 分界、ADVANCED 已列条目只有"法定细节错/缺"才算发现、一手核不到只能 UNCERTAIN。
⚠️ 运行中 `client-money-recon` 猎手整路连接断（0 候选）+ 1 verify 断——**均由 opus 一手抓 rulebooks.vara.ae 补核闭环**（见下）。

---

## 核心结论

**V8 工程骨架（每日 cron + 五桶 + run 快照 + effectiveDate）恰好满足法定频率与输入面——本轮 0 P0。** 一手核 CRM IV.E.1/E.3：Client Money 对账法定要求就是**每日**、且须含贷/借账面余额 + **在途项(outstanding lodgements)** + 现金簿 + **银行正式对账单**——与现状（每日 02:30、五桶、external_statement_lines）逐项对上。漏的是"机器之外"：对外通报的嘴、周边纪律。规律：**V8 只建了机器、没接监管的嘴。**

## 真发现（6 条）

### ① 未平重大差异必须报 VARA — 三路猎手 3:0 撞同一条（最强信号）
- 一手原文（补核 https://rulebooks.vara.ae/rulebook/d-reconciliation）：**IV.E.5**（Client Money）+ **V.D.2**（Client VAs）同文：*"VASPs must notify VARA where there has been a material discrepancy with the reconciliation which has not been rectified."*
- 现状：差异闭环终点是内部 RESOLVED（Finance→24h→MLRO/CFO），**无任何一步通向 VARA**。落法：给 ADVANCED"差异闭环"加末级终态（重大未纠正→VARA 通报工单 `REPORTED_TO_VARA`+审计）。核验多数 **P1**（原文无硬时限、实时 1:1 已压低触发概率）。→ roadmap 就地改写。

### ② Proof of Reserves 频率写错（既漏又窄）— 分歧票双方合起来是全貌
- 一手：**CRM V.C.1** = "VARA 不时(含发照)要求即须证明储备覆盖全部 Client VA 负债"（**on-demand**，无季度）；驳方补核猎手漏读的交叉引用 **Company Rulebook 储备资产节 Rule 3** = 储备**每日对账** + **≥每半年独立第三方审计** + 审计报告随季报交 VARA。
- 现 roadmap"季度 PoR"**既漏半年独立审计、又把 on-demand 窄成季度定时任务**。→ roadmap 就地改写为四件套。

### ③ 对账流程利益冲突隔离（IV.E.4，两路 3:0，P1）
- 原文：*"VASPs must ensure that the process of reconciliation does not give rise to a conflict of interest."* 跑对账/推单平账/关 case 的角色须与"能制造差异的资金操作方"互斥。≠V1 公司级 SoD（Company §B.2），本条是对账域专条。现推单处置/驾驶舱操作无角色互斥。

### ④ 对账底稿+外部原件 8 年原生留存（I.F.1-3，3:0，P1）
- run 结果/匹配明细 + **银行/HexTrust 原始对账单原件**须 native 格式存 ≥8y、随索即出。现归一化入库后原件无留存、DB 在 /tmp。与 V5/V6 记录字段集同源。

### ⑤ 第三方银行客户资金确认函（IV.C.3/C.4，2:1，P1）→ 分拣归 V3
- 存客户法币前须取银行书面确认（agent 身份持有 / 银行无抵销·扣押权 / 账户名可区分自有资金）；不出函则不许再存并撤出已存（IV.C.4 有牙齿）。按分拣原则属**账户配置门→V3**，V8 只消费"该账户已挂确认函证据"。→ 入 roadmap V3。

### ⑥ 成文对账政策（I.B.3/4，2:1，P2）
- 五桶阈值/差异分级/SLA/处置权限/升级路径写成受治理政策文档+定期复审。

## BACKLOG（代码可自证，非合规派生 → 入 BACKLOG）

- **钱包枚举由 external_balances 驱动、缺外部快照的客户钱包静默漏对**（`wallet-recon-run.service.ts` 遍历以外部行为键）——核验读代码逮到的窄坑；"full list"完整性靠外部源自觉。已入 BACKLOG。

## 对抗驳回 2 条（跨版本去重生效）

- **短缺自有资金补足 make-whole**（0:3）：条款真（IV.E.2(c)），但 **V7 已登记**"储备金注资/穿底补救"，分拣刻意归 V7 非 V8，未漏。
- **逐客户每日清单**（1:2）：核验读代码证伪——本系统**每客户每币种一个专属钱包**，逐钱包直比**就是**逐客户粒度（客户间串账会破各自等式），非 omnibus；剩余只是"清单报表格式"，属已列 deferred"对账报告导出"。

## caveat（含方法论）

- ⚠️ `client-money-recon` 猎手整路断线（0 候选）——但其目标（法币对账频率/差异/报 VARA）已由我一手抓 IV.E 全节补齐，结论反而更实（每日达标 + IV.E.5 报 VARA）。
- ✅ 本轮对抗核验含**两处读代码 good catch**（逐客户清单证伪、枚举坑逮出）——持续验证"读代码/读原文"是 gap-audit 的命门。
- 承接教训：条款一手核（IV.E/V.D/V.C/IV.C 均抓到 rulebooks.vara.ae 原文）；`d-reconciliation` slug 反常（页面标题是 "E. Reconciliation"）。
