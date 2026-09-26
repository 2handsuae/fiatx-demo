# 波三 · 报文族台账与联动 · spec（草案 v1，待评审——高危波，评审升档）

> 总纲：`2026-09-25-campaign-a-incident-regulatory-charter.md` §3 波三 ｜ 骨架与脑暴裁定台账：`2026-09-26-campaign-a-wave3-skeleton.md`（六岔裁定以台账为准，本 spec 是其展开）｜ 现状真相：`modules/v9-regulatory-filing.md`、`modules/v2-customer-compliance.md` §5（限制账）
> 基线：main `44b1639`（波二收官，线性）；本 spec 于分支 `claude/vibrant-dirac-73kwrs` 起草

## §0 本波做 / 不做

**做**：报文族六类型行挂上报送台（STR/SAR/CNMR/PNMR/HRC/HRCA）｜ 制裁定性裁决（命中待裁→确认/部分/排除三出口）与冻结联动 ｜ MLRO 亲办报文族（无签发链，filings 域新桶）｜ tipping-off 客户沟通预审登记本 ｜ ⚡ EOCN 存量客户命中变体 ｜ 种子与演示编排 ｜ RBAC/审计/文档收口。

**不做**（对照项目总纲 §2 + 战役总纲 §6）：检测/筛查引擎（Sumsub 承接）｜ 报文内容生成、goAML 模拟、真发送 ｜ 交易 HOLD 边（HRC 3 工作日不反对窗归三域细化，本波只记台账）｜ 误冻结申诉主体（裁定⑤：既有补料+解冻链承接）｜ 通知推送、闹钟墙表盘（波四）｜ 幂等/去重/并发锁等禁做全项。

## §1 核对项清账（骨架台账七条，2026-09-26 核毕）

| # | 结论 | 出处强度 |
|---|---|---|
| ① CNMR 官方名 | **总纲无误**：FFR（Funds Freeze Report）在 2025 版 TFS 指引中已正式更名 **CNMR**（Confirmed Name Match Report）；旧文献仍称 FFR | 二手多源交叉一致；残留：EOCN TFS Guidelines 2025 原文（uaeiec.gov.ae 被会话网络策略拦，建议业主本机存档一份入 reference/） |
| ② 时限口径 | **总纲需订正**（已随本 spec 订正）：CNMR 与 PNMR 的报送时限**都是 5 个工作日**（CNMR 自冻结、PNMR 自暂停）；**10 个工作日是补证窗**（partial match 下取证件排除/坐实的合理期），不是"排除后才报 PNMR"——官方时序是**先暂停即报 PNMR，补证窗并行走**；10 工作日拿不到证件→拒绝交易并 5 工作日内再报 PNMR（本波作叙事，不建二次单）；**暂停/冻结的解除须等 EOCN 经 goAML 回指令**。工作日=周一至周五（UAE 联邦周末周六日） | 二手多源交叉一致 |
| ③ SAR | goAML 独立报文类型（STR=具体交易；SAR=无交易的可疑行为），**单列一行**：STR 锚交易单号、SAR 锚客户 | 坐实 |
| ④ 上游触发点 | V5「KYT→STR」：冻结单证据留存已在（`decideVerdictLanding` FROZEN 一律 IGNORE 保护制裁证据），MLRO 读证据→手工开 STR 锚该单即接上，无需 V5 侧改动；V2「CDD→STR」：销户流程未建（v2 §6 缺口），维持移交，STR 手工开单锚客户即为将来接口 | 查库坐实 |
| ⑤ Sumsub 案件引用 | 新增列 `externalCaseRef`（STR/SAR 记 Sumsub 案件/applicant 引用；CNMR/PNMR 记名单条目引用），**STR/SAR/CNMR/PNMR 四类型必填**（HRC/HRCA 锚交易属性，无外部案件可引，不填——评审白项收窄） | 设计定 |
| ⑥ HRC/HRCA | 受文机构 **UAE FIU**（goAML），非 EOCN；HRC 有"报后 3 个工作日 FIU 不反对方可执行"真规则——**属交易 HOLD 边，移交注记**，台账行无钟（类型行备注该窗）；HRCA=交易属性不全时的替代报文 | 二手多源交叉 |
| ⑦ 法律锚 | tipping-off 刑事禁令：Federal Decree-Law 20/2018（禁止向被报告人或第三方披露 STR 已报或在研判）；VARA 条款号（合规官职责条/T&I Rule H）官方站被拦，二手一致，留业主本机一手复核 | 二手交叉 |

## §2 两条主线（业务设计）

### B 线 · 制裁（订正后时序）

```
⚡命中（新客既有通道 / 存量客户新变体）
  └► SANCTION 便签（SILENT，现状机制）＝命中待裁，客户面零痕迹（三层防线不动）
        └► 制裁定性裁决：合规官提，MLRO 单步批（新审批类型 SANCTION_DISPOSITION），三出口——
             ├─ 排除 CLEARED：批准即联动既有解除执行（同一次 maker/checker，不叠第二道解冻审批），客户全程无感
             ├─ 部分 PARTIAL：维持 SILENT ＋ 自动开 PNMR 单（5 工作日钟，**锚 SANCTION 便签开立时刻**＝暂停落地 `restrictionOpenedAt`——官方口径"自暂停起算"，评审红项订正，原"锚定性时刻"不确）＋ 补料请求（既有通道，中性话术；10 工作日补证窗为剧本叙事）
             │     └► EOCN 指令经 PNMR 单往来记录落痕（新 kind，见 §5）→ 据指令走 CLEARED（二次定性）或升 CONFIRMED
             └─ 确认 CONFIRMED：SILENT 便签解列、开 SANCTION_CONFIRMED 便签（新 DISCLOSED 因由，横幅可见依据）＋ 自动开 CNMR 单（5 工作日钟，**锚同上便签开立时刻**＝冻结落地——官方口径"自冻结起算"）
```

- 定性落地走单一 workflow（限制域翻牌/解除 ＋ 报送域开单，铁律③各写各的）；定性动作/出口全量审计（铁律①）。
- 「24h 冻结」不建钟：⚡ 命中即冻瞬时完成；`restrictionOpenedAt`（＝台账所称 freezeAt，统一用此名）即 `openForSanction` 外传的 `anchorAt` 钟锚数据源，兼作留痕；表盘归波四。
- 误冻结申诉（裁定⑤）：部分线的补料+解除就是申诉的全部落地；确认后的申诉对象是 EOCN（叙事）。

### A 线 · STR/SAR

```
⚡「Sumsub 案件已裁决（可疑）」（叙事+案件引用号，不建研判 UI）
  └► MLRO 开 STR（锚交易单）或 SAR（锚客户）——报文族全程亲办：起草→标已提交(externalRef=goAML 回执号)→往来→办结
        ├─ 决定不报：DRAFT→CLOSED，必填 noFilingReason（no-file decision 法定可辩护留痕）
        └─ 在案期间客户来问：客户沟通预审登记（§5），客户面话术恒中性（既有防线）
```

- **无签发审批链**（裁定⑥）：goAML 注册在 MLRO 名下、FDL 20/2018 下 STR 任何人不得拦。与通用族"高管签发"同屏对比是演示点。

## §3 主体与状态机改动（报送台，加行之外的三处真改动）

1. **类型目录加六行**＋新字段：`family: 'GENERAL' | 'AML'`（服务层按族独占的判据）、`anchorKind` 第三种 **EXTERNAL**（开单时 workflow 外传 `anchorAt`）、钟单位扩 **工作日**（`businessDays`，周一至五；既有小时钟不动）、`allowNoFilingClose`（仅 STR/SAR true）、`requiresExternalCaseRef`。六行：STR/SAR（UAE_FIU，无固定钟——"形成怀疑后即报"，`deadlineAt=null` 不杜撰）｜ CNMR/PNMR（EOCN，5 工作日，EXTERNAL 锚）｜ HRC/HRCA（UAE_FIU，无钟，备注 3 工作日不反对窗移交）。
2. **族内合法边集**（显式迁移表按 family 分列，铁律④）：AML 族 `DRAFT→SUBMITTED`（MLRO，externalRef 前置闸不变）、`DRAFT→CLOSED`（仅 allowNoFilingClose，必填 noFilingReason）、`DRAFT→CANCELLED`、`SUBMITTED→CLOSED`；**不经过** PENDING_SIGNOFF/SIGNED_OFF 两态（AML 族送签即非法跃迁显式拒）。GENERAL 族六态六边原样。
3. **schema 新列**：`externalCaseRef`、`noFilingReason`；限制因由新增 `SANCTION_CONFIRMED`（DISCLOSED、ALL、MLRO_APPROVAL 解除、customerLevel=true、customerLabel 明示制裁依据）。动 schema/seed → 收尾闸 ⑧ 重铺闸触发。

## §4 制裁定性裁决（新审批类型）

- `SANCTION_DISPOSITION`：合规官提（带出口选择+依据摘要）、**MLRO 单步批**；挂在 SANCTION 便签（customerLevel，caseRef=customerNo）。
- 批准落地（workflow）：CLEARED→复用既有解除执行路径；PARTIAL→开 PNMR＋补料请求；CONFIRMED→便签翻牌＋开 CNMR。驳回→维持待裁。
- 同客户可二次定性（PARTIAL 之后据 EOCN 指令再定 CLEARED/CONFIRMED）。

## §5 tipping-off 登记本 ＋ EOCN 指令

- 往来记录新增两种受控 kind，**均仅 AML 族**（GENERAL 族监管指令维持既有 `REGULATOR_INQUIRY`，评审白项定口径）：**`CUSTOMER_COMM`**（客户沟通预审三留痕——拟稿人为录入数据字段 `commDraftedBy` 自由文本、放行人＝`recordedByUserId`＝MLRO 实名、body＝放行话术；报文族唯 MLRO 可写，故演示话术即「MLRO 亲录预审」，两签不装作两人——评审黄项定案）＋ **`AUTHORITY_INSTRUCTION`**（EOCN/FIU 指令留痕；记录不推状态——解除/升级动作走 §4 各自的链）。
- 态限放宽：这两种 kind 在**非终态**均可追加（波二三种 kind 维持仅 SUBMITTED）。
- 行为测试：客户面 DTO 全量断言零 STR/报文/filingNo 引用（三层防线契约测试扩展）＋ tipping-off 违禁词断言（总纲验收口径）。

## §6 RBAC 与审计

- filings 域加一桶：「Operate AML reporting desk」→ 新组 `REG_FILING_AML_WRITE`，**MLRO 独持**（14 域 **69 桶 77 组**）；合规官在报文族零角色。
- 路由共享：写路由 OR 两组为粗门，**服务层按 `family` 独占**为真把关（照 Ruling-6 / `cap.incident.*` 先例，命名 `cap.filing.general` / `cap.filing.aml`）；GET 两条 OR 三组（+MLRO）。
- `verify:rbac` 扩判据：MLRO 推不动通用族、合规官推不动报文族（服务层 403 探针双向）；报文族单不产生签发审批单（无链断言）。
- 审计：报文族复用波二十码名册＋新增 `FILING_CLOSED_NO_FILING` / `SANCTION_DISPOSITION_*`（定性提/批/落地）/ 新 kind 的 `FILING_ENTRY_LOGGED` 沿用；码目录数随 plan 定稿清点，词表闸 `audit:vocab` 收口。

## §7 ⚡、种子与演示

- ⚡ 新入口一个：「EOCN 名单更新→存量 ACTIVE 客户命中」（落点 plan 定：demo-ops 或沿 sumsub-ingestion applicant 通道；最终调 `CustomerRestrictionWorkflowService.openRestriction()` 贴 SANCTION 便签——自带 `CUSTOMER_RESTRICTION_ADDED`/`CUSTOMER_FROZEN` 审计与 ⚡ actor 留痕；**不走** `deposit-workflow.service.ts` 488/866 的域服务裸 `open()`（其留痕搭在 KYT 审计上，⚡ 场景无 KYT 单可搭——评审黄项订正））。A 线不新增 ⚡（案件裁决为叙事＋手工开单）。
- 种子三张：STR 已提交（带回执＋一条 CUSTOMER_COMM 预审样例）｜ PNMR 在途（5 工作日钟在跑＋一条 AUTHORITY_INSTRUCTION 待决样例）｜ CNMR 已提交（锚一名 SANCTION_CONFIRMED 客户，客户端可见横幅）。SAR/HRC/HRCA 不铺种子，现场手工开单讲解（照波二三类先例）。
- 演示编排：B 线两分支＋A 线一条写入 `demo/script.md`（场景暂编，幕次编号波五收官统一）；`demo/data.md` 同步种子。

## §8 验收口径与闸

1. **B 线可演**：确认分支（命中→静默→定性确认→横幅＋CNMR→标已提交→回执）；部分分支（命中→定性部分→PNMR＋补料→EOCN 指令→排除解除，客户全程无感）。
2. **A 线可演**：STR 全链（开→提交→回执）＋ 不报结案（理由留痕）＋ 预审登记；SAR 手工开一单讲解。
3. verify:rbac 双向族探针零红；无签发链断言；客户面零泄露契约测试全绿。
4. 变异三点常驻：族边集删边（AML 族走送签应拒）｜ EXTERNAL 钟锚算法（工作日跨周末）｜ no-filing 必填理由闸。
5. 闸：随手闸①-⑤ ＋ 收尾闸 ⑥⑧（动 schema/seed；零账务 ⑦ 不触发）；收尾对照 `rules/delivery-checklist.md`。
6. **评审升档**（总纲 §8 点名：联动冻结＋新权限域）：spec 评审、终审、变异测试不降档。

## §9 评审留问（本 spec 不硬定，评审时裁）

1. 「决定不报」用 `DRAFT→CLOSED+noFilingReason` 新边，还是新终态 `CLOSED_NO_FILING`？（本 spec 取前者：不加态，理由字段承载语义）
2. PARTIAL 出口的补料请求由定性 workflow 自动发，还是剧本手工发？（本 spec 取自动发——"暂停即取证"是官方时序的一部分）
3. 量级：总纲预判"波三可能拆两波"；裁剪后本 spec 评估**单波可完**，若 plan 超限，牺牲顺序：HRC/HRCA 两行与 SAR 种子 → 后补。

## 总纲订正记录（随本 spec 落笔，活文档同步）

总纲 §3 波三行：PNMR 时序订正（先报后补证）＋ 误冻结申诉按裁定⑤收窄 ＋ MLRO 亲办无签发链；§4 覆盖表「误冻结申诉→波三」加注承接方式。原文改动见同次提交 diff。
