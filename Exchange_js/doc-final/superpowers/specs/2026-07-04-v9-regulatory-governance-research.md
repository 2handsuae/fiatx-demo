# V9 合规治理顶层 — 深度调研留底（Regulatory Governance Research）

Date: 2026-07-04 ｜ Status: 研究定稿（provenance 留底，已据此重排 roadmap V9，commit d795768）
Method: deep-research harness，100 agent 五路搜索 → 抓 VARA 官方 Rulebook 原文 → 每条结论三票对抗验证 → 综合；9 条 findings 全部 3:0（个别子项 2:1，见各条 vote），18 源主体为 rulebooks.vara.ae 官方原文。
Scope: V1-V8 交易层之上、**直接面向监管机构（VARA / UAE FIU）和客户**的合规治理义务工作流。**边界铁律**：Sumsub 承接检测（KYT/筛查/持续监控），V9 只做 Sumsub 覆盖不到、**法定责任在 MLRO 身上不可外包**的申报/上报/裁决/配合。

---

## 核心结论

STR 向 FIU 申报、tipping-off 决策、向 VARA 的事件/变更上报、投诉裁决、监管配合——法定责任在持牌人（MLRO）身上、无法外包，故必须 V9 自建；且几乎全部为**个人客户 MVP 阶段即适用**的牌照级义务，不能延后到机构客户阶段。唯一"可延后"空间在 SLA 精度打磨与内部升级链多级设计，非义务本身。

## P0 · 牌照级工作流（个人客户 MVP 即适用，不可延后）

### ① STR/SAR 申报 `vote 3-0`
- 定位：疑似交易报告，MLRO 经 goAML 向 UAE FIU 申报，Sumsub（只做 KYT/筛查/监控）覆盖不到。
- 触发=员工/系统形成合理怀疑上报 MLRO（VARA III.F.1）；状态机=怀疑形成→MLRO scrutinize→决定申报→goAML 提交→FIU 追加信息回复→后续处置（input watchlist/改风险评级/near-real-time 监控被标记账户 III.F.5）；SLA=**无固定天数**，标准是 immediately/without delay（'as soon as reasonably possible'），建模为 near-real-time 即时计时器而非倒计时（复杂案件可加 15 工作日初报+30 工作日跟进兜底）；角色=MLRO 唯一责任人（CBUAE §2.2.1）。
- 依据：VARA CRM Rulebook III.F.3(a)+III.F.4（goAML）；CBUAE Rulebook 4.3 / STR Guidance（AML-CFT Law Art.15 + Decision Art.17，regardless of amount 无门槛）。

### ①a tipping-off 防护门（随 STR 同生）`vote 3-0`
- STR case 状态机内所有对外/跨角色通信节点强制过防泄密门；MLRO≠CO 时向 CO 通报明文以"不构成 tipping-off"为条件（III.F.3(d)）。
- tipping-off = 联邦刑事罪（不得直接/间接告知客户/第三方交易被监控/调查/已报 FIU，延伸至 FIU 请求信息），AML-CFT Law Art.25 罚则=不少于 6 月监禁 +/或 AED 10-50 万；仅集团内为识别/预防/报告犯罪目的的信息共享有豁免（Decision Art.39.1）。
- caveat：罚则细节跨源有出入（监禁下限/法律版本/罚金下限），但禁令、刑事性、FIU-请求延伸、集团豁免均实质不变。

### ①b goAML 注册（上线前置）`vote 3-0`
- 所有 UAE 应报实体（含 VASP，无论谁监管）必须在 goAML 门户注册且保持 active，由 CO/MLRO 注册为系统用户；新持牌机构取牌后 immediately 注册；未注册=行政违规（罚 AED 5 万起）且无法报任何 AML 事项。
- 落地：goAML 注册状态纳入合规日历监控项，STR 工作流终点强制指向 goAML。
- caveat：CBUAE MPLS 专线细节不适用 VARA VASP（VARA 走 SACM/互联网），勿照搬。

### ② VARA 重大变更/事件上报 `vote 3-0`
- **关键纠偏**：Material Change 是**事前书面审批门**（发生前取 VARA 书面批准，Company Rulebook VIII.A.1.a + Schedule 1 定义），**不是事后 72h 通知**；一般合规受损=immediately 通知 VARA（Section H）。
- 状态机（变更类）=材料性评估→VARA 事前审批申请→VARA 决定（业界称 30 工作日）→获批后执行；（一般事项类）=识别→immediately 通知→回执跟踪；角色=合规官/MLRO/CEO 层签署。

### ②a 资产持续监控（Broker-Dealer 专属，仅当做 Licensed Distribution）`vote 3-0`
- 提供 Licensed Distribution Services 的 VASP，若知道/有理由怀疑某资产不再符合 Rule IV.B，须 immediately 暂停/停止分销；Issuer/资产材料性变更须 immediately 重跑 IV.B.3/IV.B.4 尽调。
- 依据：BD Services Rulebook Part IV Section E Rule 2/3。scope：限提供 distribution 的 VASP；若资产范围极窄不做 distribution 可 P1。注：同 Section 的 Rule IV.D 提交义务链接那条 claim 被裁 refuted(1-2)，勿据此建独立通知支线。

### ③ 客户投诉处理 `vote 3-0`
- 状态机=受理→确认→调查→裁决/解决（例外走延期）→留档；SLA（VARA 明确数字）=**1 周确认 / 4 周解决 / 例外最长 8 周（第 4 周须出状态更新说明延迟）**；角色=合规/客服一线出裁决，升级 MLRO/仲裁。
- 强制留档三段：(a) 所有投诉 (b) 所有措施 (c) 所有解决结果。
- 依据：Market Conduct Rulebook Part III Section A。

### ⑤ 网络安全/BCDR 事件上报 `vote 3-0`
- 触发=材料性网安事件 或 触发 BCDR 且重大影响业务；SLA=**检测后最迟 72h 内报 VARA**（这才是 72h 数字的真正归属处，非 Company Rulebook）；上报三要素=性质/范围/影响 + 缓解措施 + 是否已报他机关；BCDR Plan 须预定义触发事件+恢复优先级+沟通安排+漏洞修复。
- 依据：TIR Rulebook Section K（72h 通知）+ Section H（BCDR）。注：个人数据事件 24h 线与 72h 网安线并存不冲突。

### ⑩ 监管信息请求配合 `vote 3-0`
- 触发=FIU/VARA 追加信息请求；SLA=**promptly and in any event within 48 hours**（硬性倒计时）；角色=MLRO 主责；证据调取横跨 V1 审计 + V4-V8 交易/对账。
- 依据：CRM Rulebook III.F.3(b)。caveat：条文在 STR 规则内、以 FIU/VARA 'additional information requests' 为触发；更广的现场检查配合无 SLA 锚点，需另设计。

## P1 · 强制但非上线阻断

### ⑧ MLRO/董事会季度合规报告 `vote 3-0`
- cadence=季度（VARA 明确）；内容=AML/CFT 有效性评估 + 失效项指认 + **当季所有匿名增强交易(AET)摘要**；应 VARA 请求可调取。
- 依据：CRM Rulebook III.A.2.f/g/h；UK FCA SYSC 3.2.6G(2) 佐证"格式自定"。P1 因首个季度到期前有缓冲，非上线硬阻断。

## 跨版本基础设施（非独立工作流）

- **统一 SLA 监控层**：收拢 48h（信息请求）/72h（网安）/1-4-8 周（投诉）/季度（董事会报告）所有法定时钟成倒计时+告警引擎。
- **合规日历**：goAML 注册状态 + 季度报告 + 各监管截止日追踪。

## 被降级/剔除（防多做）

- **制裁命中治理**：不单列——Sumsub 筛查，命中后冻结+SAR+上报是 STR① × V2 冻结的交叉点。
- **定期 regulatory returns**：调研未锚定 VARA 有独立季度 returns（季度义务主要即 MLRO 董事会报告），标待核，勿凭空造。

## 关键纠偏（取代旧 V9 的错误）

1. "72h" 归属**网安/BCDR 事件**（旧 V9 误挂"重大事件上报"）。
2. 材料性变更是**事前审批门**，非事后 72h 通知。
3. STR 申报**无固定天数**（immediately），建模为即时计时器非倒计时。
4. **STR 是 MLRO 经 goAML 自报，Sumsub 报不了**（旧 V9 "STR→Sumsub→goAML" 是错的——goAML 注册绑持牌实体、申报责任 MLRO 不可外包、tipping-off 是刑事红线）。

## 主要源

VARA: CRM Rulebook（III.F STR/goAML、III.A.2 MLRO 报告、I.F 留存）、Company Rulebook（VIII.A.1 Material Change、Section H）、Market Conduct Rulebook（III.A 投诉）、TIR Rulebook（Section K/H 网安 BCDR）、BD Services Rulebook（IV.E 资产监控）、Schedule 1 定义。CBUAE: Rulebook 4.3 / STR Guidance（goAML、tipping-off、AML-CFT Law/Decision）。
