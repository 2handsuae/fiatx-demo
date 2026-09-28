# 投诉处理监管依据调研（波五 spec 输入）

> 调研日 2026-09-27 ｜ 方法：四路 sonnet 并行取数（VARA 一手 / FCA DISP / CBUAE / ISO 10002），主会话判读 ｜ **一次性快照，不是活文档**
> 消费方：波五骨架「spec 开工核对项」第一条（1/4/8 周数字依据核实）、待定岔口 2（例外分支状态机）、岔口 4（受理角色）
> 边界声明：DFSA（DIFC）一路子代理中途失联未交付，本报告不含 DFSA 参照；ISO 10002 的二次交叉（ANSI 预览）被反爬拦截未完成，见 §4。

## §1 定音结论：总纲的 1/4/8 周数字是 VARA 原文，逐字吻合

**出处：VARA Market Conduct Rulebook, Part III – Complaints Handling**（现行版生效 2025-06-19；V1 2023-02-07 / V2 2023-10-01 三版比对，时限条文自 V1 起未改）。

- **确认 ≤1 周**——Rule III.A.1.a：*"VASPs shall acknowledge all complaints within one (1) week of a complaint being made"*
- **裁决 ≤4 周，例外 ≤8 周且第 4 周状态更新**——Rule III.A.1.b：*"VASPs shall resolve all complaints within four (4) weeks of the complaint being made, except in extraordinary circumstances, in which case VASPs must— i. provide the client an update on the status of the complaint, and explain the extraordinary circumstances delaying its resolution, within four (4) weeks of the complaint being made; and ii. resolve the complaint no later than eight (8) weeks from when the complaint was made."*
- **三段留档**——Rule III.A.5：*"VASPs shall keep a record of— a. all complaints received from their clients; b. all measures they have taken in response to complaints; and c. the resolution of all complaints."*（总纲「投诉/措施/结果三段留档」即此条，逐字对应）
- URL：`https://rulebooks.vara.ae/rulebook/complaints-handling-requirements`、`https://rulebooks.vara.ae/rulebook/b-complaints-handling-procedures`；官方 PDF `https://rulebooks.vara.ae/sites/default/files/en_net_file_store/VARA_EN_190_VER20250519.pdf`
- 波一占位 `establishedBy: 'Market Conduct III.A'`（incident-type-registry.ts）核实**正确**。

## §2 VARA 侧其余发现（均一手核实）

1. **保存年限 ≥8 年**：Market Conduct III.A.5 本身无年限；年限来自 Compliance and Risk Management Rulebook 通用条款 **Rule I.F.1.h**（投诉调查相关通讯与文档在保留清单内）+ **Rule I.F.2.a**（*"no less than eight (8) years"*，涉国家安全的无限期）。
2. **处理职责与利益隔离**：CRM **Rule I.B.2**（合规官对 CMS 负最终责任）+ **Rule I.B.3.b**：*"ensure that client complaints are handled properly with appropriate remedial action. Complaints should be handled and investigated by Staff who are not directly involved in the subject matter of the complaint..."*——**调查人不得是被投诉事项的直接相关人**。→ 岔口 4（受理角色）的条文锚点。
3. **无告知外部申诉渠道的义务**：Market Conduct Part II/III + CRM 全文 `complain*` 检索未找到「须告知客户可向 VARA 升级」条文。VARA 官网有公众投诉入口（`vara.ae/en/register-a-complaint/`，属网站指引非 Rulebook 义务）。
4. **无定期投诉数据报送**：CRM Rule I.H 月/季/年报送清单逐款核对无投诉项；唯一例外 Rule VII.K.2.a 仅约束 Regulated Sponsor 对被保荐 VASP 的年度报送，不适用一般 VASP。→ **波四义务台账不必加投诉行**。
5. **排他性**：Company / Technology and Information / Broker-Dealer Services 三本手册全文 `complain` 零命中——投诉条文集中在 Market Conduct Part III，活动手册无加码。（边界：未覆盖非公开 Directive/Notice。）

## §3 国际参照（时限对照）

| 参照系 | 确认 | 最终答复 | 中间节点 | 记录保存 | 向监管报送 | 外部升级出口 |
|---|---|---|---|---|---|---|
| **VARA**（我方适用） | 1 周 | 4 周；例外硬上限 8 周 | 第 4 周强制 update+解释（例外分支才触发） | ≥8 年（CRM I.F 通用） | 无 | 无条文义务（官网入口存在） |
| **FCA DISP**（英国） | "prompt" 无天数（DISP 1.6.1R） | 8 周（DISP 1.6.2R），超期须告知可转 FOS，**无硬上限** | **现行无 4 周节点**（旧 DISP 1.4.4R 的 4 周二选一规则 2007-11-01 废除；timeline 功能 9 个历史时点核实） | 一般 3 年（DISP 1.9.1R） | 半年报（DISP 1.10.1R） | FOS：最终答复后 6 个月内或满 8 周未答复（DISP 2.8.1/2.8.2R） |
| **CBUAE**（阿联酋央行，非我方监管，仅参照） | 2 个完整工作日（Standards 8.1.2.5） | 30 个完整工作日（8.1.3.7），机构无自主延期权 | 超时须书面告知违反 TAT 及原因（8.1.1.4(f)） | ≥5 年（8.2.3.1） | 未见定期报送 | Sanadak 申诉专员（Notice 1659/2023；先投诉机构+满 30 工作日） |
| **ISO 10002:2018** | — | — | 7.3 全程跟踪、状态可查询 | 有记录要求无年限 | — | 7.9 结案含告知外部救济途径 |

**ISO 10002 生命周期九子条款**（Clause 7，官方授权经销商预览目录逐字）：7.1 制度公示 → 7.2 接收 → 7.3 跟踪 → 7.4 确认 → 7.5 初评 → 7.6 调查 → 7.7 形成回应 → 7.8 告知决定 → 7.9 结案。（流传的 6 段简化版普遍漏 7.1/7.3。）

## §4 负面结论与未覆盖项

- 「第 4 周状态更新」在现行 FCA DISP **不存在**（DISP 1 全章 "four week/4 week/4-week" 零命中）；仅 EMD/PSD 投诉有 15/35 工作日机制（DISP 1.6.2AR），与 1/4/8 无关。→ 我方数字血统是纯 VARA，非 FCA 移植。
- FCA 3 工作日简化通道（SRC，DISP 1.5.1R/1.5.4R）：VARA **无**对应机制，若做即自定义业务规则，不能挂 VARA 条款背书。
- CBUAE「简单/复杂投诉分级」不存在（Standards 全文检索）；机构无单案自主延期权。
- DFSA 参照未取得（子代理失联）；ISO 二次交叉源（ANSI）被反爬拦截，现有结论基于 iTeh 官方授权预览单源+多篇二手方向一致。
- 二手数字「Sanadak 申诉费 AED 500」「30 自然日」均未在一手核实，**不采信**（一手为 30 complete business days）。

## §5 对波五设计的直接落点（主会话判读）

1. **时限依据条款可直接铸码**：`establishedBy: 'MC III.A.1'`（确认/裁决时钟）、三段留档 `MC III.A.5`、利益隔离 `CRM I.B.3.b`——骨架「spec 开工核对项」第一条**销账**。
2. **岔口 2（例外分支状态机）有条文支撑做显式边**：VARA III.A.1.b.i 的「第 4 周 update + 解释特殊情况」是**强制义务**（例外分支触发时），不是可选动作——支持建显式「已延期」态或等价的强制往来记录，且延期动作本身应留痕（写了什么解释、何时发给客户）。
3. **岔口 4（受理角色）有条文锚点**：利益隔离要求「调查人 ≠ 被投诉事项当事人」+ 合规官总责——受理/调查角色设计可据此立论（具体归哪个经办组仍需业主脑暴，但「不能是被投诉业务的经办人自己」这条红线是条文）。
4. **「升级」的应然语义厘清**（岔口 1 判读输入）：国际通行的「escalation」指**客户向外部申诉**（FOS/Sanadak）；VARA 语境下无外部申诉专员、无告知义务。故「投诉超时→内部转事件」不是监管义务，是**我方自选的内控设计**；Raymond 包的「escalate 走文案」与我方「转事件」都不违反条文，拍板依据应是演示价值与内控叙事，不是合规必需。
5. **闹钟墙挂钟**：投诉钟天然是「1 周确认钟 + 4 周裁决钟（例外延至 8 周）」双钟，与制裁族 24h+5 工作日双钟同构，波四聚合端点先例适用（字段命名核对仍按骨架提示做）。
6. **报送台/义务台账零联动**：无定期投诉报送义务（§2.4），投诉域不给波二报送台、波四日历加行。
