# V9 合规治理顶层 — 深度调研留底（Regulatory Governance Research）

Date: 2026-07-04（+ 2026-07-06 遗漏复查追补）｜ Status: 研究定稿 + 遗漏复查（provenance 留底，已据此重排 roadmap V9；初版 commit d795768，追补见文末「2026-07-06 遗漏复查追补」+「产品大白话」）
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

---

# 2026-07-06 遗漏复查追补（fable-5 gap-audit）

Method: 80 agent / 8 盲区猎手（每人拿已覆盖清单**只找清单外义务**、可交白卷）+ 每条候选 3 视角对抗（条款真伪 / 真未覆盖防换皮 / 归属 V9 防错塞 Sumsub/HexTrust/V1-V8）；24 条候选**全部 3:0 存活**（1 verify agent 断线，对应条目仍 2:0）。

**核心发现**：原 9 条**无一被裁错**（覆盖到的都对），但**广度漏约 17 条独立义务、其中 6-7 条 P0**。规律钉死：**旧调研凡"不单列 / 待核 / 顺带一提"处，全是这次的漏。**

## 最大纠正：制裁申报独立单列（推翻旧"不单列/STR 交叉点"）

旧 spec 把制裁命中折叠进"Sumsub 筛查 + STR①×V2 冻结"。**错**——goAML 上 CNMR/PNMR 是与 STR **并列的独立报文**，触发/时限/收件方全不同，命中后只发 STR = **漏发 CNMR/PNMR = 直接踩 Cabinet Decision 74 罚则**（AED 5 万起+刑责）。

- **CNMR（确认命中）** P0：≤24h 冻结全部资产+停服+禁 tipping-off → 冻结后 5 个工作日经 goAML 交 CNMR（原 FFR）抄送 **EOCN+VARA**（STR 只到 FIU）→ 冻结无限期至除名 ｜Cabinet Decision 74/2020 Art.21/22 + EOCN TFS Guidance
- **PNMR（部分命中）** P0：模糊同名排除不了→24h 暂停+10 工作日排除窗口→拒绝交易+5 工作日交 PNMR→**挂起直至 EOCN 经 goAML 下指令**；**无需"怀疑"即触发**，STR 状态机接不住 ｜同上
- **EOCN NAS 名单订阅 + 全库重筛** P0：与 goAML 注册并列的上线前置；名单一更新即全库重筛，**24h 冻结钟从 UNSC/内阁列名起算**（非从发现起）｜EOCN TFS Guidance
- **误冻结申诉/解冻除名** P1：法定 grievance 程序，≠普通客户投诉 ｜EOCN TFS Guidance

## 追补清单（按主题，priority = 对抗核验后多数意见）

| 主题 | 义务 | 条款 | Pri |
|---|---|---|---|
| 定期申报 | 月度财务包 + 季度治理申报 报 VARA | CRM Section H Rule 1/2 | P1 |
| 定期申报 | 年度审计财报+内控鉴证+首 100 客户 onboarding 抽样 | CRM Section H Rule 3 + Company G.1 | P1 |
| 审慎 | **NLA 跌破即报**+每日跟进直至 VARA 认可 | Company VI.C/VI.F | **P0** |
| 治理 | 外部审计师任命/更换通知（VARA 可强制换）| Company Section G | P2 |
| 数据 | **个人数据泄露报 UAE Data Office(非 VARA)+客户** | UAE PDPL Art.9 + TIR II.A.1 | **P0** |
| 数据 | **发通知后 24h 再报 VARA**（独立于 72h 网安线第二只钟）| VARA TIR Part II §C | **P0** |
| 外包 | 外包商 material breach immediately 报 VARA | Company IV.H.1 | **P0** |
| 外包 | Material Outsourcing 事前通知+异议清关+登记册 | Company IV.H.3/4 + IV.C.2.b | P1 |
| 吹哨 | 吹哨人渠道+官网公示+年评 | BD I.B.1.b + I.A.2 | P1 |
| 营销 | **营销内容发布前合规审批门**（含 KOL 书面批准）| Marketing Regs 2024 I.B.3.b + I.C.2/3 | **P0** |
| 营销 | 营销激励逐活动事前 VARA confirmation | Marketing Regs 2024 I.C.2.l | P1 |
| 营销 | 营销档案 8 年留存随查随出 | Marketing Regs 2024 I.C.4 | P1 |
| 营销 | 违规营销 cease-and-desist 整改/下架执行 | Marketing Regs 2024 II.A.1 | P2 |
| 人员 | RI 更换事前审批（突发离任才可事后通知）| Company I.C.2/3/4 | P1 |
| 人员 | 董事 fit & proper 审批+年检+失格免职 | Company I.B.1 | P2 |
| 人员 | 控制权/股权变更 30 工作日审+新 UBO 尽调 | Company VIII.C + I.A.5 | P2 |
| 市场 | 市场违法双头上报 FIU+VARA | **VA & Related Activities Regulations 2023 Part VIII §J** | P1 |
| 监管 | 现场检查配合（期限按通知载明，非固定 48h）| VA&RA Regs 2023 Part IX.B | P1 |
| 报案 | HRC/HRCA 高危国家报文（报后 3 工作日 FIU 不反对才放行，**阻断型**）| UAEFIU goAML Report Types + NAMLCFTC | P1 |

## 顺带纠错（本轮已同步修正）

V6 spec/roadmap 的"市场操纵监控"条款原引 `Market Conduct Rulebook VIII §J` **定位有误**——原文实为 **VA & Related Activities Regulations 2023 Part VIII §J**（Market Conduct 的 Part VIII 是 VA Standards）。已修 V6 两处 + 本 spec。

## caveat

- 1 个 verify agent（marketing coverage 维度）API 断线，对应条目仍有 2:0 票，不影响结论。
- 多处"提交时限"rulebook 原文未载具体天数（月/季/年报的期后天数），须监管入驻时向 VARA 确认，spec 中标注为"时限待 VARA 确认"。
- HRC/HRCA、CNMR/PNMR 的 goAML 报文类型以 UAEFIU goAML Report Types 文档为准，报文表单细节实施时须对 goAML 最新版核对。

---

# 产品大白话（V9 到底是干嘛的）

> **V1-V8 是把店开好**（柜台/后厨/保安）；**V9 是让官府放心你这家店**。生意再好，跟官府的往来没做，牌照直接没。

V9 按"跟谁打交道"分三堆：**① 替官府盯坏人（报案类）② 向官府交作业（汇报类）③ 对客户负责（应诉类）**。

## 名词表（都用大白话）

| 名词 | 大白话 |
|---|---|
| VARA | 迪拜虚拟资产监管局——**发你牌照的主管单位**，能发也能吊 |
| UAE FIU | 全国收"脏钱线索"的**报案中心** |
| goAML | FIU 的**官方报案网站**（联合国开发），不注册连案都报不了 |
| MLRO | 公司**反洗钱当家人**，以**个人名义**对官府负责，罚的坐牢的是他本人、推不给外包 |
| Sumsub | 外包的**查人查钱供应商**，只能"发现问题"，替你报案它没资格 |
| EOCN | 阿联酋**黑名单执行办公室**（管制裁名单）|
| STR | **可疑交易报告**（一封"这笔钱来路不对"的报案信）|
| tipping-off | 告诉客户"你被上报了"——**刑事犯罪**，最低 6 月监禁 |
| BCDR | **灾备预案**（系统全崩怎么活下去）|
| SLA | **法定期限**（官府给的各种"几天内必须办完"死线）|

## 第一堆：替官府盯坏人（报案类）

- **STR 报案**：监控发现可疑（如刚充就急着换现金提走）→ MLRO 研判 → 上 goAML 报 → 事后重点盯防。时限"立刻"，只能 MLRO 本人报，报没报都留底。
- **防通风报信门**：客户进了报案流程，系统里所有对外沟通统一话术、锁权限——因为"说漏嘴就有人坐牢"，不能靠自觉。
- **goAML 注册**：上线前一次性去报案网站开户。
- **🆕 制裁撞名（本次最大遗漏）**：撞实了→24h 冻结+不告诉他为什么+5 工作日交 CNMR 表（抄送黑名单办公室，跟 STR 不是一张）；撞模糊→24h 挂起+查 10 天+查不清交 PNMR+**干等官府发话**才能解。可怕在**重名就触发、不需要客户干坏事**，且 24h 从"联合国列名那刻"起算。配套要订阅黑名单更新、一更新就全库重刷。
- **🆕 高危国家交易**：涉高危国家的钱**先扣住**→报 goAML→**等 3 个工作日官府不反对才放行**。全 V9 唯一会拦交易的。

## 第二堆：向官府交作业（汇报类）

- **重大变更**：换大股东/加业务线/换 CEO——**先批后动**（事前审批，不是先斩后奏）；出了合规岔子**立刻自首**。
- **被黑 72 小时上报**：黑客/数据被偷/机房瘫→发现起 72h 内报 VARA。
- **🆕 数据泄露两只更紧的钟**：员工误发名单（没黑客、72h 线不触发）→报**数据保护局(不是 VARA)**+通知客户；发完通知后**24h 内**再报 VARA 一次。
- **官府问话 48h 内必答**（所以 V1 建 8 年留痕、V8 建对账，2 天内得拿得出材料）。
- **🆕 定期交作业**：月报（财务包+钱包地址+关联交易）/ 季报（董事会纪要+风险敞口）/ 年报（审计财报+头 100 客户开户抽样）——活着就得交。
- **🆕 家底不够马上自首**：留够"至少烧 1.2 个月的活钱"，跌破→立刻报+**天天汇报**直到补上。
- **🆕 外包商出事**：Sumsub/HexTrust 瘫了→立刻报（责任外包不掉）；签重大外包前先报备。
- **🆕 换人要报批**：换法定负责人先批后换；换董事官府审"配不配"+年检；换大股东 30 工作日审。
- **🆕 营销也管**（有 App 全命中）：拉新奖励/返佣**每场先拿 VARA 书面确认**；物料出街前过合规审批（禁"保证赚钱/最后一天"）；营销档案存 8 年。违规单次最高罚 1000 万迪拉姆。

## 第三堆：对客户负责（应诉类）

- **客户投诉法定时间表**：1 周回执 / 4 周结论 / 最长 8 周（第 4 周给进展）+三样留底。
- **🆕 挨检查**：官府上门→按通知期限开放账簿/系统/场地；上线前置：客户协议要预先写"同意把交易信息交监管"。
- **🆕 吹哨人通道**：建内部举报（可匿名）+官网显眼处公示+年检。

## 两个"基建"

- **统一 SLA 监控层 = 一面挂满法定闹钟的墙**：立刻/24h/48h/72h/3 工作日/5 工作日/1-4-8 周/每日/月季年——没系统统一管这些倒计时，人肉记必漏，漏一个=违规。
- **合规日历 = 一本"何时交什么作业"的台账**：goAML 账号/EOCN 订阅/月季年报/董事年审全盯着。

## 一句话总结

> V9 就三件事：**看到坏人马上报**（MLRO 亲办、嘴要严、有专用表格 CNMR/PNMR）、**该交的作业按时交**（事前审批+定期报表+出事自首）、**客户告状按时办**。命门是**时限**，所以底座是那面"法定闹钟墙"。
