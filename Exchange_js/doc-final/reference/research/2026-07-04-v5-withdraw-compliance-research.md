# V5 提现合规 — 深度调研留底（Withdrawal Compliance Research）

Date: 2026-07-04 ｜ Status: 研究定稿（provenance 留底，用于重排 roadmap V5 + V3）
Method: deep-research harness，108 agent 五路搜索 → 抓 VARA CRM/BD/Transfer&Settlement Rulebook + FATF R.16/OFAC 原文 → 三票对抗验证 → 综合；10 findings（多数 3:0 high，个别 medium）；24 源主体 VARA/FATF 官方。**4 个头条结论已一手 grep 代码验证。**
Scope: 提现执行流 + 合规控制（Travel Rule 发起方义务、目的地制裁、地址、大额/拆单、非托管钱包、异常分支/资金退回）。**不含**热钱包流动性（V7/HexTrust），不重复 Sumsub 筛查执行。

---

## 核心结论（代码验证）

**现有三层合规骨架方向对，但 L2 内涵被严重低估。** 一手 grep 坐实：
- L2「Travel Rule」是**筛查状态位**（`travelRuleStatus` 枚举，`simulate/travel-rule` 端点更新，门校验只看 `=='PASSED'`），**无发起方数据发送**（无 payload 组装、无向受益方 VASP 传输）。
- 有地址 VASP 归因（`lnName`/`lnDid`，TravelRuleAdapter 登记时标"这地址属哪 VASP"）——识别对方是不是 VASP 的半边，**缺"发数据给它"+"尽调它"**。
- 提现后端**零 FROZEN 态、零 sanction block**（grep 全空）——制裁分支完全空白。

## 一、现有 V5 的 VARA 评审 `V5-1 3-0`

- L1 资格门 ≈ CRM III.E CDD ✓；L3 归档 ≈ 记录保存 ✓
- **L2 是唯一阻塞门，须承载 CRM III.G(Travel Rule)+III.H(制裁)全部机制**——现只承载筛查状态位，内涵低估
- BD Rulebook I.A.1.c：客户提取权牌照级（`shall establish/implement/enforce`，极端行情也要能提）——约束冻结/暂停设计
- TR 机制**只在 CRM Part III.G**（BD Rulebook 0 处 travel rule、Transfer&Settlement 0 处 3,500，均交叉引用 CRM）

## 二、Travel Rule 发起方义务专节（全场最硬）

### 核心缺口 🔴 P0：取得+持有+**发送**，现缺"发送" `V5-2 3-0，代码确认`
- III.G.2：**AED 3,500 阈值**（**单笔或关联交易累计**，非"按自然日"；见文末 2026-07-06 订正），义务在"**发起转账前**"（pre-execution 阻塞）
- III.G.4/5 法定字段：发起人(name + 钱包地址/账号 + 住址)、受益人(name + 钱包地址/账号)
- FATF R.16/INR.15.7(b)：originating VASP 须"immediately and securely 发给受益方 VASP"——与筛查**架构不同**的数据发送 payload；不满足则"must not execute"

### 独立缺口 🔴 P0：对手方 VASP 尽调 `V5-3 3-0`
- III.G.6：与新对手方 VASP 首次交易**前**须完成风险尽调（核验受益方是否"适当受监管、能处理 TR 数据"）；首次做+定期复核，无需每笔重做
- ⚠️ **2026-02-24 VARA Circular 收紧**：须确认受益方 VASP 母法域适当受监管，**禁止向未受监管对手方转账**

### 🟡 P1：自托管钱包目的地 `V5-4 3-0`
- III.G.7：VASP 须**设计如何处理**来自 TR 合规/不合规存取 + 非义务实体(unhosted 钱包)的风险（止于要求风险考量，未强制声明/白名单/拒绝协议）
- 即便目的地自托管，**仍须向自己客户收集**法定 originator/beneficiary 信息（不能因自托管跳过收集）
- ⚠️ FATF 记录处罚案例：**把受益钱包误分类为"unhosted"来规避 TR 步骤本身是合规失误**（未查明是否实为外国 VASP 控制）
- Sunrise 问题：全球合规前，向非实施法域对手方转账须 best-efforts/风险相称放行

## 三、异常分支与缺失控制的优先级

| 优先级 | 分支 | 关键点（附纠偏）| 依据 |
|---|---|---|---|
| 🔴P0 | **制裁命中→BLOCK/FROZEN** | ⚠️**纠偏**：不是"取消+退回客户"——BLOCK 须**冻结原地、拒绝各方访问、10 工作日内上报**，退回客户与 block **冲突** | OFAC FAQ 646/36 + VARA III.H |
| 🔴P0 | **失败/未授权提现→24h 退回** | 未授权/偏离指示/任何 VASP 触发错误 → "**24 小时内**"退款或恢复账户 + **赔偿责任** | Transfer&Settlement II.C.2 |
| 🔴P0/P1 | **stuck/failed→追踪-定因-通知** | 转账未达须"**立即追踪+查因+通知客户**"，**举证倒置**（VASP 须自证无责）| Transfer&Settlement II.C.3 |
| 🔴P0 | **KYT 高风险/可疑→MLRO→STR** | 怀疑即 MLRO 经 goAML **立即上报**（联动 V9 STR）| CRM III.F.3.a |
| 🟡P1 | **自托管钱包所有权验证 + 差异化 EDD** | 向 unhosted 目的地须验证客户控制 + 可设额度限制 | FATF/VARA III.G.7 + Sumsub |
| 🟢P2 | 拆单监控 / 大额 EDD(SOF/SOW) / 提现冷静期 | 有依据但风险相称，优先级低 | CRM III.E/III.G.9 |
| 🟢P2 | FATF 数据字段基准 / Custody 返还合同条款 | AED 3,500 payload 对标 FATF >USD 1,000 字段；客户协议须写明返还方式 | FATF R.16 / Custody III.D.1.a.iii |

## 四、V3/V5 架构拆分决策（本次落地）

**原则**：**地址级一次性控制 → V3 登记**；**交易级每笔控制 → V5 执行**。
- **V3 登记**（拿到钱包即可提前验，验一次永久有效）：分类 hosted/unhosted（已有归因）+ **所有权/控制权验证**（NEW）+ 对手方 VASP 初次尽调 + 打标记（已验证控制权/自托管需 EDD/托管所已尽调）
- **V5 执行**（每笔）：**制裁重筛**（名单会变，不能缓存 V3 结果）+ **Travel Rule 发送**（单笔或关联交易累计 >3500）+ 按 V3 标记应用 EDD/限额 + 大额门
- 故调研 P1"自托管钱包 EDD/所有权验证"**拆两半**：所有权验证挪 V3，差异化 EDD/限额留 V5。

## 五、关键纠偏（研究推翻旧设想）

1. **制裁命中 ≠ "取消+退回客户余额"**——是 **BLOCK（冻结原地不退回）**，旧 roadmap"制裁地址拦截→取消→SAR"方向错。
2. **L2「Travel Rule」≠ 合规达标**——它现在只是筛查状态位，发起方"发送"义务代码里没有。
3. **失败退回有硬 24h SLA**（Transfer&Settlement II.C.2），不是"尽快"。

## 六、置信度/caveat

- 高置信黑字：TR III.G.2/4/5/6/7、Transfer&Settlement II.C.2/C.3、III.F.3、BD I.A.1.c。
- caveat：① OFAC FAQ 646 直接约束美国人，Dubai 主体需 U.S. nexus 才直接适用，但 block-not-refund 是标准 VASP 实践 + VARA III.H；② message-signing 不是 VARA/Sumsub 钦定的唯一所有权证明（该 claim 0-2 被驳，勿写死用签名）；③ Custody 返还条款 2-1（托管外包 HexTrust 场景适用性有保留）。

## 主要源

VARA: CRM Rulebook（III.G Travel Rule、III.H 制裁、III.E CDD、III.F STR）、BD Services Rulebook（I.A.1.c）、VA Transfer & Settlement Rulebook（II.C.2/C.3，VARA_EN_347_VER20250519.pdf）、Custody Rulebook（III.D.1.a.iii）。FATF: R.16/INR.15.7、Best Practices Travel Rule、Oct-2021 VA Guidance。OFAC: FAQ 646/36。Sumsub unhosted wallet verification。

---

## 2026-07-06 牌照订正（BD-only）

用户确认：平台 VARA 牌照**仅 Broker-Dealer**、无 VA Transfer & Settlement 活动，链上转账由持牌托管 HexTrust 执行。本 spec 引用 Transfer&Settlement Rulebook 的两条（II.C.2 失败 24h 退回、II.C.3 追踪定因）**不能当平台直接义务**——硬时限直接约束执行转账的持牌方（HexTrust），平台义务=**合同传导 24h SLA + 监督跟踪 + 客户资产保护**（改锚 CRM I.E.4/I.E.1 + BD I.A.1.c）。roadmap V5 对应两条已同步改锚（2026-07-06）。§三表格中 II.C.2/C.3 两行按此解读；"关键纠偏 3（失败退回有硬 24h SLA）"限缩为"HexTrust 侧硬 24h，平台侧合同传导"。

---

## 2026-07-06 TR 阈值订正（甲方拍板 + 一手原文核对）

**决策（甲方 2026-07-06）**：Travel Rule 发送**按 VARA 口径**——**>AED 3,500 才发** payload；阈值按**单笔或关联交易累计**达到，**不按自然日**。

**一手原文核对（起因：agent 曾称"按日累计 daily aggregated"，深挖发现该措辞非原文）：**
- VARA CRM III.G.2（rulebooks.vara.ae 直接核到）：*"Prior to initiating **any transfer** of Virtual Assets with an equivalent value **exceeding AED 3,500**, VASPs must **obtain and hold** required and accurate originator information…"*——">3,500 才 obtain-and-hold"，逐笔口径。
- Cabinet Decision 134/2025（联邦实施条例）CDD 触发：*"occasional Transactions amounting to or exceeding AED 3,500, **whether carried out as a single Transaction or several Transactions that appear to be linked**"*——聚合口径是**关联交易**，非自然日。
- CBUAE Art.29（电汇对应条款）：*"For cross-border wire transfers of **AED 3,500 or more**…shall verify the identity of the beneficiary, if…not previously verified."*

**订正结论：**
1. ❌ **撤回"按日累计（daily aggregated）"**——该措辞在 VARA/联邦一手原文中核不到（三处独立复核均为 "AED 3,500 or more" / linked transactions）；系 gap-audit agent 共享同一二手转述所致，对抗核验未能拦截（教训：3:0 一致 ≠ 源头可靠）。
2. ✅ 正确口径 = **单笔或关联交易累计 ≥AED 3,500**；关联交易合并沿用已有 III.G.9 拆单监控，**不新增条目**。
3. ⏸️ **"小额也发（FATF transmit-at-all）"未采纳**——Notabene 等引 FATF 严格读法主张任何金额都发，但 VARA CRM III.G.2 字面只要求 >3,500；甲方定**按 VARA**，故保留 >3,500 门槛。若未来 VARA/FATF 收紧再议。

**caveat**：CBUAE 官网对抓取工具 403（其一手 PDF 未能直接读），CBUAE 两条系搜索提取+多源交叉；VARA rulebook 两条为直接抓取。

---

# 2026-07-06 遗漏复查追补（fable-5 gap-audit）

Method: 51 agent / 6 盲区猎手(TR 边角/客户资金划出/提取权约束/费用披露/记录回执/筛查时点，只找清单外义务)+ 每条 3 视角对抗(条款真伪/真未覆盖/归属 V5，硬闸:引 T&S 当平台义务直接 REFUTED)；15 候选 → **11 存活、4 驳回**。

**核心：0 新 P0**（TR 阈值那条是修正现有 P0，已单列「2026-07-06 TR 阈值订正」）；11 存活按模块分拣后 **9 留 V5(全 P1)、1 归 V2(对账单)**。盲区规律：V5 原研究只翻了 CRM Part III(AML)，**没翻 Part IV(客户资金)**——4 条 Client Money 义务整块空白。

## 分拣结果

**留 V5（9 条 P1，均已入 roadmap）**：① 划账授权+指令绑定存证(IV.B.10) ② payout 失败 1 日再隔离(IV.B.5.a) ③ Client Money 违规 1 日报 VARA(IV.F.1) ④ 提现暂停牌照级窄化(BD I.A.1.c/I.A.2) ⑤ 合规冻结 tipping-off 内外双轨(III.F.1/F.3.d+联邦法 Art.25) ⑥ 提现费率 30 日生效闸(MC II.A.7/8，与 V6 同源) ⑦ 提现记录字段集(CRM I.F.1，与 V6 同源) ⑧ Sunrise 分支(Circular §2.c+III.G.8) ⑨ Post-KYT 持续监控(III.F.5)

**归 V2（1 条）**：客户资金月度对账单(CRM IV.D.2)——对账单本体客户级，V5 记录字段集供数。

## 对抗驳回 4 条

- **打款前制裁重筛**(0:3)：核验员读 truth/v5-withdraw.md 证实工作流=大额审批在前、筛完即时打款，"筛查过时"场景不存在。
- **提现前费用拆解披露**(0:3)：引 BD II.A.6 是"买卖成交"语境，提现非成交，张冠李戴。
- **TR payload 留存 / AML 证据链留存**(各 1:2)：与「记录字段集」重叠被吸收。

## caveat（含方法论教训）

- ⚠️ **Client Money(CRM Part IV) 条款号(IV.B.5/B.10/D.2/F.1)系 gap-audit agent 溯源，未逐条一手核**——本轮 TR "daily aggregated" 事件已证 **3:0 一致 ≠ 原文为真**（agent 会共享同一二手坏源、对抗核验拦不住）；动工前须对 rulebooks.vara.ae 一手复核 Part IV 条款号与文本。
- 1 verify agent 曾在 TR 边角维度断线，对应条目仍多票定论。
- 「关联交易累计」落地是真难点：TR 阈值需**事前**聚合，而 III.G.9 拆单监控偏**事后**侦测，二者非同一实现——留待实现阶段设计（本 spec 已记；属合规派生欠账，按项目规则不入 BACKLOG，活在 roadmap TR 条）。
