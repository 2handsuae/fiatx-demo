# 波三 · 报文族台账与联动 · plan（11 任务 SDD）

> spec：`../specs/2026-09-26-campaign-a-wave3-aml-reporting-family-spec.md`（草案 v1，§9 三条按下述落定）｜ 骨架裁定台账、总纲同前
> 收尾对照 `doc-final/rules/delivery-checklist.md`（引用不重抄）；评审对照 `doc-final/rules/review-rubric.md`
> **高危波**：动客户状态机（制裁定性/翻牌）＋新权限域分权——**T1/T3/T4 评审升档（opus），spec/plan 联合评审、终审、变异实证不降档**（附录 A：派发省略 model 字段走继承）

## spec §9 三条落定（走法 2，业主授权按倾向直落）

1. 「决定不报」＝ **新边 `DRAFT→CLOSED` ＋ `noFilingReason` 必填闸**（不加新态；理由字段承载语义）。
2. PARTIAL 出口补料请求由定性 workflow **自动发**（官方时序"暂停即取证"的一部分）。
3. 单波推进；超限牺牲顺序：SAR 种子 → HRCA 类型行 → 演示编排细化（HRC/HRCA 行本身成本极低，尽量保）。

## T0 预检

- ✅ 预检已跑（2026-09-26）：三仓 `npm install` 均通；`prisma generate` 后波前基线全绿——tsc×3 绿、governance+identity/customers jest **25 套件 346 过 1 跳**。⚠️ DB 型 spec 跑法：独立 SQLite（`DATABASE_URL=file:/tmp/exchange_js_wt_cloud/dev.db` + `prisma migrate deploy`）＋ **`--runInBand`**——共库并行会触发 `TOOLING-DEBT.md` 已登记的 sweep 全表扫描计数污染（波二 T10 登记那条，非新债），本波 jest 一律带此参数。收尾闸⑥⑧（起栈/TigerBeetle/重铺）本容器未验证，T10 前试跑，不通则该两闸转本地。
- main 基线 `44b1639`（波二收官，线性）；本波分支 `claude/vibrant-dirac-73kwrs`（云会话单分支 ≡ 一 worktree 一分支惯例）。

## 任务清单（T1→T2→(T3‖T6)→T4→T5→T7→T8→T9→T10→T11）

### T1 常量与注册表【高危-状态机｜评审升档】
- `filing-type-registry.ts`：`FilingTypeConfig` 扩 `family:'GENERAL'|'AML'`、`anchorKind:'BASIS'|'RECEIVED_AT'|'EXTERNAL'|'NONE'`（把现状三种隐式锚显式化，既有五行标 GENERAL 并回填 anchorKind）、钟单位扩工作日（`deadlineBusinessDays`，与 `defaultHours` 互斥）、`allowNoFilingClose`、`requiresExternalCaseRef`；**六行新类型**：STR/SAR（UAE_FIU｜无钟[形成怀疑即报，不杜撰时限]｜allowNoFilingClose｜requiresExternalCaseRef）｜CNMR/PNMR（EOCN｜5 工作日｜EXTERNAL 锚｜requiresExternalCaseRef）｜HRC/HRCA（UAE_FIU｜无钟｜行内备注"报后 3 工作日 FIU 不反对方可执行——HOLD 边移交三域细化"）。
- `regulatory-filing.constants.ts`：`FILING_TRANSITIONS` 改**按族两张显式表**（GENERAL 六边原样；AML 四边 `DRAFT→SUBMITTED`/`DRAFT→CLOSED`/`DRAFT→CANCELLED`/`SUBMITTED→CLOSED`）；`FilingEntryKinds` 加 `CUSTOMER_COMM`/`AUTHORITY_INSTRUCTION`。
- `businessDays` 纯函数（周一至五，UAE 联邦周末周六日）＋跨周末/跨月单测；注册表形状与边集穷举单测。

### T2 迁移
- `regulatory_filings` 加列 `externalCaseRef`/`noFilingReason`；`regulatory_filing_entries` 加列 `commDraftedBy`（自由文本拟稿人，仅 CUSTOMER_COMM 用；放行人＝既有 `recordedByUserId`＝MLRO，不另设列——评审黄项定案）。无 backfill（项目总纲 §3 重铺原则）；`stack.sh reset` 空库自建验证归 ⑧。

### T3 报文族服务层【高危-状态机+分权｜评审升档】
- `regulatory-filing.service.ts`：迁移守卫改读族边集（AML 送签=非法跃迁显式拒）；`markSubmitted` AML 族自 DRAFT 直达（externalRef 前置闸不变）；新 `closeNoFiling()`（仅 allowNoFilingClose 类型，`noFilingReason` 必填闸）——**`DRAFT→CLOSED` 边唯此方法可走，既有 `close()` 维持仅 SUBMITTED 语义（动作级守卫，配行为单测：DRAFT 态 CNMR 打 close 端点应 400——评审黄项，防"法定必报单被无理由 Close"）**；新 `openForSanction(type, customerNo, externalCaseRef, anchorAt)`（EXTERNAL 锚：deadline=anchorAt+5 工作日）；`computeDeadline` 扩 EXTERNAL 分支＋工作日单位。**端点**：新路由 `POST /admin/regulatory-filings/:filingNo/close-no-filing`（入 catalog、OR 两写组，服务层 `cap.filing.aml`+allowNoFilingClose 真把关；登记随 T6）。
- 服务层按族独占：`cap.filing.general`（合规官组）/`cap.filing.aml`（MLRO 组），照 `cap.incident.*` 先例（`v1-governance.md` §7 Ruling-6）——路由 OR 是粗门，服务层能力码是真把关。
- 审计：新码 `FILING_CLOSED_NO_FILING`（域 GOVERNANCE，入报送名册；名册十码→十一码）；`audit:vocab` 收口。

### T4 制裁定性【高危-动客户状态｜评审升档】
- `approval.constants.ts` 注册 `SANCTION_DISPOSITION`（单步 `steps:[{roles:['MLRO']}]`；提单人合规官）。
- 新 workflow（落 `identity/customers/` 侧，照 `customer-restriction-workflow` 同域先例；横向只调 `RegulatoryFilingService.openForSanction()`，铁律③）：三出口——**CLEARED**→定性 workflow 直接调限制解除执行（`releaseMode=MANUAL`、`releaseApprovalNo`=定性审批单号，照 `onReleaseDecided` 落地形状自写 `CUSTOMER_RESTRICTION_CLEARED`/`CUSTOMER_UNFROZEN` 审计——铁律①"哪张定性单解的冻"可反查；**不走 `initiateRelease` 手工链**——其政府解除令必填闸[`customer-restriction-workflow.service.ts:143-148`]只适用手工路径、原样保留，也不用 SYSTEM-actor autoRelease——评审黄项定案）；**PARTIAL**→开 PNMR（**锚＝SANCTION 便签 `openedAt`**，评审红项订正，原"批准时刻"与官方口径矛盾）＋`material-request-issuer` 自动发补料（中性话术）；**CONFIRMED**→SILENT `SANCTION` 便签解列＋开 `SANCTION_CONFIRMED` 便签＋开 CNMR（**锚＝便签 `openedAt`**，同前）。支持二次定性（PARTIAL 后据 EOCN 指令再定）。**端点**：定性提单挂客户域新路由（形如 `POST /admin/customers/:customerNo/sanction-disposition`），权限组 T4 首步勘定——倾向复用「解限制」提单组（合规官已持有，不新增组）；入 catalog＋verify:rbac（登记随 T6）。
- `restriction-cause.constant.ts` 加行 `SANCTION_CONFIRMED`：DISCLOSED｜ALL｜MLRO_APPROVAL｜customerLevel=true｜customerLabel 明示制裁依据。
- 审计码 `SANCTION_DISPOSITION_{REQUESTED,DECIDED,LANDED}`（identity 域名册，终数 T11 清点）。
- 单测：三出口、驳回维持、二次定性、CONFIRMED 翻牌原子性（两便签+一单同 workflow 落地）。

### T5 tipping-off 登记本＋指令留痕
- entries 服务：两种新 kind **均仅 AML 族**（GENERAL 族监管指令维持既有 `REGULATOR_INQUIRY`——评审白项定口径）：`CUSTOMER_COMM`（body=放行话术，`commDraftedBy`=拟稿人自由文本[MLRO 代录]，放行人=`recordedByUserId`=MLRO 实名——「MLRO 亲录预审」为定案演示话术，两签不装作两人，评审黄项）；`AUTHORITY_INSTRUCTION`（EOCN/FIU 指令，记录不推状态——解除/升级走 T4 的链）。两种新 kind **非终态可追加**；旧三种维持仅 SUBMITTED。
- 行为测试：客户面 DTO 契约测试扩展——零 `filingNo`/STR/报文引用＋tipping-off 违禁词断言（总纲 §3 验收口径）。

### T6 RBAC（可与 T3 并行）
- `rbac.catalog.ts`：`PermissionGroup` 加 `REG_FILING_AML_WRITE`（:89 联合类型处）；filings 域第三桶「Operate AML reporting desk」（:974 域块，**14 域 69 桶 77 组**）；MLRO 绑定新组；既有写路由 7 条改 OR 两组、GET 两条改 OR 三组（:471-479）；**新登记两条 route()**：`close-no-filing`（T3）与客户域 `sanction-disposition`（T4）——管理路由一律入 catalog（评审黄项补）；波二"路由门即精确门，不设 cap.*"注释**两处**（:468-470 与 :971-972 域块头，评审黄项——漏一处即留半句假话）改写为指向 cap.filing.* 机制。合并后惯例：重启＋`db:base:sync`。
- `verify:rbac` 扩判据：双向族探针（合规官打 AML 单写动作 403、MLRO 打通用单写动作 403——服务层拒）＋ AML 单全生命周期零审批单断言（无签发链）。

### T7 ⚡ EOCN 存量命中
- 首步勘定落点：`demo-ops` vs `sumsub-ingestion` applicant 通道；最终效果=对指定存量 ACTIVE 客户经 `CustomerRestrictionWorkflowService.openRestriction()` 贴 `SANCTION` 便签（自带 `CUSTOMER_RESTRICTION_ADDED`/`CUSTOMER_FROZEN` 审计＋⚡ actor 留痕；**不照抄 `deposit-workflow.service.ts:488/866` 的域服务裸 `open()`**——那条路留痕搭在 KYT 审计上，⚡ 场景无 KYT 单可搭，评审黄项订正）；权限挂 Demo Instruments 域既有组。A 线不新增 ⚡（案件裁决=叙事+手工开单）。

### T8 e2e（governance+identity 联跑）
六段：B 线确认全链（命中→定性确认→横幅+CNMR→标已提交→回执→关闭）｜B 线部分（定性部分→PNMR+补料→AUTHORITY_INSTRUCTION→二次定性排除→解除，客户面全程 PROCESSING 断言）｜A 线 STR 全链｜不报结案（理由闸）｜越界双向（族独占 403）｜无签发断言（AML 单零审批单+送签 400）。

### T9 前端（admin-web；client-web 验证渲染）
- 报送台两页按族渲染：AML 单动作组（无送签按钮；标已提交自 DRAFT 直达；不报结案带理由弹窗——调 T3 新端点；externalCaseRef 展示）；两种新 kind 的往来记录渲染（CUSTOMER_COMM 展示「拟稿 `commDraftedBy` 文本＋放行 MLRO 实名」——不装作两个账号，评审黄项口径）。
- 客户详情/限制区：定性动作入口（合规官）＋定性历史展示；`SANCTION_CONFIRMED` 横幅走既有 `RestrictionBanner`（DISCLOSED 自动生效——client-web 验证）。
- 闸⑤：preview 渲染＋截图走查（报送台 AML 单/定性弹窗/客户端横幅/客户端 PROCESSING 不可区分四组）。

### T10 种子＋演示编排【执行档】
- 种子：STR 已提交（回执＋一条 CUSTOMER_COMM 样例）｜PNMR 在途（5 工作日钟在跑＋AUTHORITY_INSTRUCTION 待决）｜CNMR 已提交（锚 SANCTION_CONFIRMED 客户，客户端横幅可验）｜一名 PARTIAL 在途客户（补料请求挂着）。SAR/HRC/HRCA 不铺种子（现场手工开单讲解，照波二三类先例）。
- `demo/data.md`、`demo/script.md` 同步（场景暂编，幕次编号波五收官统一）。

### T11 文档收口＋波四骨架
- truth 同步：`modules/v9-regulatory-filing.md`（六类型/族边集/钟锚/MLRO 亲办）＋`v1-governance.md` §7＋`v2-customer-compliance.md`（定性+新因由）＋`overview.md` §4（69 桶 77 组、MLRO/合规官/内审行订正）；`CHANGELOG.md` 一行；六裁定入 `decisions.md`；BACKLOG/PRODUCTION-NOTES 触碰；`delivery/` 30 秒触碰检查（动了状态机＋审计集——命中）；**波四骨架立档**（链总纲+承接节）。收尾全项对照 `rules/delivery-checklist.md`。

## 变异实证三点（常驻，终审复验）

① AML 族边集删 `DRAFT→SUBMITTED` 边→送签外全动作应拒（红一次复绿）② `businessDays` 跨周末算错（周末计入）→CNMR 钟单测应红 ③ `closeNoFiling` 拿掉 noFilingReason 必填闸→单测应红。

## 闸与派发

- 随手闸①-⑤逐任务；收尾闸⑥⑧（动 schema/seed；零账务 ⑦ 不触发）。
- 派发（附录 A）：T2/T10→执行档；T1/T3/T4/T5/T6/T7/T8/T9→执行档、其中 **T1/T3/T4 评审升档 opus 点名**；spec/plan 联合评审、终审、变异实证→**不降档**。派 subagent 一律带项目总纲 §0–§5 要点。
