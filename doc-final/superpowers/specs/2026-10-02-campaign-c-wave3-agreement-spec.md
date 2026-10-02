# 战役丙波三「客户协议」spec

> 总纲：`2026-09-30-campaign-c-outreach-disclosure-charter.md` §1.1/§2 波三行 ｜ 骨架：`2026-10-02-campaign-c-wave3-agreement-skeleton.md`（11 条已定事实 + 承接记录，本 spec 全部继承不复述）｜ 脑暴拍板 2026-10-02 ｜ 状态：**待业主过目 → plan**
> **本任务做**：协议版本主体（两表 + 状态机 + 正文后端登记处）｜ 管理台发布链（合规官提交、高管单步批、30 天校验、⚡快进到生效）｜ 发布即通知（扩 AGREEMENT 通知类型）｜ 客户端弹窗/横幅/阅读页 `/agreement`（含打印）｜ 未同意拦 DEPOSIT/SWAP、放行 WITHDRAW｜ 注册同意落库｜ 种子全员已同意 v1 ｜ 第九幕剧本与文档同步。
> **本任务不做**（对照 CLAUDE.md §2 与总纲）：管理台正文编辑器 ｜ 重大/一般变更分类 ｜ 同意率计数与未同意名单（登 BACKLOG）｜ 独立"通知时间"字段（批准即通知，脑暴修订 B）｜ 生效时第二条通知 ｜ **费率/限时活动与协议任何联动**（原则见 §0）｜ 真发邮件（沿波一模拟留痕）｜ 协议真 PDF（浏览器打印即够）｜ 多语言 ｜ 法务角色与定稿工作流（定稿发生在代码层）｜ 月结单与 DSR（波四）。
> **档位**：动交易能力闸（三域入口），**plan 点名评审升档**（总纲已定）。

## 执行订正（2026-10-03，T12 收口，spec 原文不改只追记）

1. **种子 consents 是 13 行，不是 11 行**：spec/plan 三处写"11"系沿用客户端 Quick login 子集数的笔误；库内 demo 客户实为 13 位（`prisma/seed.business.ts` DEMO_CUSTOMERS），种子给全部 13 位各铺一行 ACCEPTED v1。T1 当场直改正文（`801ac9c7`），此处补记缘由；`demo/baseline.md` 断言按 13。
2. **§4.3「`intakeDecision` 里返回 DENY」实作为 `assertTradingIntake` 前置显式拦，语义等价**（T5）：协议拒绝是显式 `AGREEMENT_NOT_ACCEPTED`、不折叠，而 `intakeDecision` 本体只管限制账语义（ACCEPT / ACCEPT_FREEZE / DENY 三值服务于 SILENT 合规限制）——把协议拦截塞进去会污染它的返回契约；生产无人直调 `intakeDecision`（实证见 T5 报告），故在其上游 `assertTradingIntake` 前置拦截，调用方行为一致。**口径补一句**：冻结客户走 intake 路径会先吃 `AGREEMENT_NOT_ACCEPTED`、同意后仍被中性拒——客户端文案一律用中性的 "Review & accept"，不许承诺"同意即可交易"。
3. **§4.2 强制弹窗补 "View full terms" 链，并在 `/agreement` 路由上让位**（T8 修 1）：原表生效后行只写"同意 / 暂不同意"，漏写查看全文——客户被迫先落一行 DECLINED 才能读条款，违背"同意前可取副本"（VARA II.A.5）。落地：弹窗多一条纯链（离页回弹，不是表态）、`/agreement` 页上强制弹窗不显示，consents 零新增。可关弹窗（通知期）的 "View full terms" 行为仍是 dismiss 语义，两弹窗差异保留。
4. **§4.4 打印版式弃 `position: fixed`、改流式 + 颗粒叠层摘除**：波二确立的 `fixed` 版式只能印一页，协议七节需四页（T7 无头打印实证 1 页截断 vs 4 页全出），改为 `body:has(.print-agreement)` 域隔离的流式分页；T11 真实 printToPDF 又逮到「背景图形」关态（Chrome 打印默认）下深色主题的 `body::before` 颗粒叠层盖白整页、三页全空，补一条 `body:has(.print-agreement)::before { display: none }`（`0501d3db`）。证据 `checkups/2026-10-02-campaign-c-wave3-evidence/10-*`；同日 T12 对波二确认单补测关态（`13-confirmation-print-bgoff.*`，暗像素 8611 = 开态 8611，无缺陷）。
5. **§5 `GET /client/agreements/me` 响应三键扩为四键**（T11 修复波）：`{ current, pending, previous, consent }`，新增 `previous` = 最近一版 SUPERSEDED 全文（无则 null）。原因：⚡快进生效后 v1 变 SUPERSEDED、`pending=null`，客户再也读不到旧版，§7 剧本"回 `/agreement` 对照两版"演不出，且违总纲"可查可追"；阅读页切换组据此在三态间切（`V1 · SUPERSEDED` / `V2 · IN EFFECT` / `Upcoming`）。**只补可读，不做全量历史列表**（记 PRODUCTION-NOTES）。
6. **§4.1 通知 `{effectiveAt}` 口径 = 服务进程本地日**（T11）：原实现 `toISOString().slice(0,10)` 取 UTC 日，迪拜 00:00 的生效日会被写成前一天，站内信与弹窗/管理台差一天；改 `Intl.DateTimeFormat('en-CA')` 本地日（`630db1b4`）。**云端须钉 `TZ=Asia/Dubai`**——`deploy/demo.env.template` 已加（T12，`7ff3525b`），否则云端 UTC 机上差一天照旧；系统另有迪拜业务日函数 `toBusinessDate`（S20），客户面日期两套口径并存的取舍记 PRODUCTION-NOTES。
7. **§8/§6 S16 判据补**（T9 修 1）：`verify-rbac` 在 S5/S9/S13d 之外加 **S16a/b/c** 三条——`AGREEMENT_WRITE` 唯合规官持有、桶 `compliance-office.agreements` 的 groups 恰为 `[AGREEMENT_WRITE]`、两条写路由分挂 `AGREEMENT_WRITE`/`DEMO_CLOCK_WRITE`（五变异证据在 T9 报告）。原因：S5 只验自批死锁，管不到「提单权被悄悄多发给别的职务」。
8. **§7 `demo:all` 零协议动作与 `AGREEMENT_PUBLISH_REJECTED` 码，已在 plan 期订正正文**（见 §0/§6/§7，此处仅互链）。**连带几处尾差**：§7 末句、§9 overview 行写"审计码 334"，§8 ⑦写"审计 6 码四属性"，§9 触碰检查写"审计集（+6）"，都是补 `AGREEMENT_PUBLISH_REJECTED` 前的旧数——现役终值 **335 / 7 码**（`npm run audit:vocab` 合计 335 码，T12 实跑；§6/§10 本就写 335）。
9. **幕号：第九幕已被战役乙「公司的钱」占用，客户协议实落「第十幕 · 场景 33」**：本 spec、骨架、plan、T11 走查报告与证据说明里的"第九幕"均指客户协议，但 `demo/script.md` 的第九幕（2026-09-30 战役乙收官定稿，场景 26–32）早已是「公司的钱」；剧本以 script.md 编号为准，故落**第十幕**、场景编号接 33。本 spec 内凡"第九幕"读作"第十幕"；排序约束不变——仍排整场最后（⚡快进后全库客户被拦充值/兑换），且第九幕场景 31 须从全新重铺起跑，故先演九幕再演十幕、演完重铺。

## §0 脑暴裁定台账（2026-10-02）

**七岔口**（编号对应骨架"待定岔口"）：
1. **管理台可见面只做客户详情一行**"当前协议版本"（生效版未同意时同行标出）；不做版本页计数/未同意名单（演示剧本里唯一必答的问题是"这个客户为什么被拦"，计数属运营监控面，照波一"管理员侧通知"先例登 BACKLOG）；明细走审计中心（天然可搜）。
2. **通知只发一条**：批准（=发布=通知）时发"协议将于 X 日更新"；生效时零通知——生效日的告知就是强制弹窗本身。
3. **"暂不同意"落库 + 入审计**：被已拍交互锁死（下次登录给横幅而非弹窗，必须有持久状态才知道给哪个）；顺手补齐因果链证据。
4. **版本键 = `v1` / `v2`**：协议是"版本"不是"单据"，客户面要人话；**明示破例**不走 `generateReferenceNo` 单号惯例（破例理由：无流水语义、总量个位数、对客展示物）。
5. **种子与 v2 由头**：种子客户同意时间 = 各自注册时间（锚定方式随现有种子日期惯例，执行时核，避"相对运行时"判例）；v1 发布/生效日取早于最早种子客户注册日的固定日；**v2 = 新增投诉时限条款**（在第 V 节加一段：确认 ≤7 天、裁决 ≤28 天可延一次至 56 天——与甲波五已上线的投诉双钟逐字对得上），弃用"改费率条款"由头（与灵活费率/限时活动犯冲，见下原则）。
6. **剧本新开第九幕、排整场最后**（坑 9 对策）；"暂不同意"演员 = 干净（无冻结/受限人设，排除 Carol/Jack/Grace/Frank）、有余额（"放行提现"要演得出）、非主角（不用 alice）的配角，执行时对种子表点名。
7. **阅读页 = 新轻量页 `/agreement`**：通知深链与横幅需要 URL 落点，浮层当不了；正文渲染组件从注册抽屉抽出共用，页面 = 版本状态头 + 两版对照 + 打印（沿波二打印判例）。

**两条流程修订（业主 2026-10-02，修订骨架已定事实 2/4 的时序）**：
- **A. 弹窗提前到通知期**：发布后、生效前，客户登录即弹"新版将于 X 日生效"，**可提前同意、可"稍后再说"关掉**；生效后弹窗**必须二选一**（同意/暂不同意），不可关。来晚的客户（生效后才登录）弹的永远是**当前生效版**。
- **B. 不设独立"通知时间"**：业主原提案"审批通过→到通知时间发信→到生效时间生效"三时刻，agent 建议合并前两个、业主采纳——监管 30 天的钟本就从"通知客户"起算，批准即通知则"生效 ≥ 通知+30"合并为"生效 ≥ 批准+30"一条校验，且少造一台定时机器、少一个 ⚡按钮。
- **30 天校验锚定批准时刻**：提交时按"生效日 ≥ 今天+30"预检（友好报错）；**批准落地时以批准时刻复核**，不足 30 天则批准失败退回（防"提交后拖延数天才批"把通知期挤穿）。

**费率零联动原则（业主 2026-10-02 质询后立）**：现行条款第 IV 节本就是引用式费率条款（"fees … are published on our fee schedule"）——日常调费率、限时活动费率动的是**费率表**，协议正文零变化，不触发、不校验、不提醒协议发布，费率模块与协议模块互不认识。只有**条款本身**（费用的游戏规则）变更才走协议发布，且该判断是法务人工判断，不是系统逻辑。

**三坑对策（编号对应骨架）**：坑 9 → 第九幕排最后 + `demo:all` 零协议动作（v2 保持 DRAFT，见 §7；plan 期订正：原"跑到发布为止"与现场剧本冲突——demo:all 先发布则前八幕客户登录全弹新版弹窗、第九幕也无单可发）；坑 10 → 未同意客户拦在充值信号提交口（见 §4）；坑 11 → **v1 以订正后文案收录为基线，"不可变"约束自入库起算**（订正 = 正文两处 "14 days" 均改 "30 days"：第 IV 节费率表通知期、第 VII 节条款变更通知期——依据同 VARA MC II.A.7 / II.B.1.e，两处不同改会自相矛盾）。

## §1 协议版本主体（新模块 `src/modules/identity/agreements/`）

### 1.1 正文登记处（写死代码、随版本装载，已定事实 3）

`agreement-versions.constant.ts`（后端，**单一来源**）：按 `versionKey` 登记正文，节结构沿 `CustomerRegister.tsx` 现行 `Section[]` 形状（no/title/body）。预置两版：
- **v1**：现行七节原文 + 两处 14→30 订正（坑 11 基线声明见 §0）。
- **v2**：v1 全文 + 第 V 节追加一段投诉时限承诺（文案执行时按双钟 7/28/56 写定）。

公开只读端点 `GET /client/agreements/...`（见 §5）供注册页、`/agreement` 页、管理台**三处同源取文**；`CustomerRegister.tsx` 内写死的 `TERMS_SECTIONS` 随之退役改为取接口（改一处先找齐同款：客户端仅此一处正文副本，退役后 client-web 零正文硬编码，grep 清点入测收尾）。

### 1.2 表 `customer_agreement_versions`（新迁移 + reset 登记，甲波二判例）

| 字段 | 说明 |
|---|---|
| id / `versionKey` **@unique** | uuid / `v1`、`v2`（铁律⑥业务键，破例理由见 §0 岔口 4） |
| `status` | 状态机见 1.4 |
| `effectiveAt` | 生效时刻（提交发布时填；⚡快进会改写它并单独审计，见 §3） |
| `publishedAt` | 发布（=批准）时刻，批准落地时写 |
| `summary` | 一句话变更摘要（通知与弹窗用，随正文登记处预置，非管理台可编辑） |

正文不落库（住登记处随代码版本）；**版本行除状态推进与 ⚡快进改 effectiveAt 外无 update 入口**。种子：v1 = EFFECTIVE（effectiveAt 早于最早种子客户注册日）；v2 = DRAFT。

### 1.3 表 `customer_agreement_consents`（同迁移）

| 字段 | 说明 |
|---|---|
| id / `customerId` / `customerNo` | 归属客户（customerNo 冗余落列供审计/检索，照通知表先例） |
| `versionKey` | 表态针对的版本 |
| `action` | `ACCEPTED` ｜ `DECLINED` |
| `actedAt` | 表态时刻 |

**只追加不改写**（append-only 台账）：同一客户对同一版本可先 DECLINED 后 ACCEPTED，各自一行；判定一律取"该客户对**当前生效版**是否存在 ACCEPTED 行"。种子：13 客户各一行 ACCEPTED v1（T1 执行订正：库内全部 demo 客户实为 13，原"11"系沿用 Quick login 子集数，笔误），actedAt=各自注册时间。

### 1.4 版本状态机（铁律④显式迁移表，非法跃迁显式拒绝）

```
DRAFT ──提交发布(合规官,填生效日,预检≥今天+30)──► PENDING_APPROVAL
PENDING_APPROVAL ──高管批准(复核生效日≥批准时刻+30,不足则批准失败退回)──► PUBLISHED   ← 批准即发布即通知
PENDING_APPROVAL ──驳回(或批准时 30 天复核不过的退回)──► DRAFT   ← 记 AGREEMENT_PUBLISH_REJECTED
PUBLISHED ──到点或⚡快进──► EFFECTIVE
EFFECTIVE ──新版本进 EFFECTIVE──► SUPERSEDED
```

- **PUBLISHED→EFFECTIVE 翻转**：⚡快进（演示主路径，见 §3）或到点懒翻（读"当前生效版"的路径发现 `effectiveAt<=now` 且仍 PUBLISHED 则翻转并记审计 actor=system——机制对齐义务台账"到期自动开单"既有先例，plan 核对实现形态）；翻转同事务内把旧 EFFECTIVE 版翻 SUPERSEDED。
- 同一时刻至多一版 PENDING_APPROVAL/PUBLISHED 在途（提交时校验，演示系统不需要并行多版在途）。

## §2 发布链（管理台 + 审批 + 权限）

- **管理台新页**（Compliance Office 菜单下「Customer Agreements」）：版本列表（versionKey/状态/生效日/发布时刻）+ 版本详情（正文只读、DRAFT 版"提交发布"按钮填生效日、PUBLISHED 版 ⚡快进按钮）。**读**挂既有桶 `compliance-office.view`（五职务共持，不新增读组）；**写**新增桶 `compliance-office.agreements`（Compliance Office 域 4→5 桶，15 域 81→**82** 桶）+ 新权限组 `AGREEMENT_WRITE`（**合规官独占**，89→**90** 组）。
- **审批策略 `AGREEMENT_PUBLISH`**（+1）：合规官提（maker=`AGREEMENT_WRITE`）→ 高管单步批（照 `RI_REPLACEMENT` 先例）；`scripts/verify-rbac.ts` `MAKER_GROUP_BY_POLICY` 加一行（交付清单触发项）。批准落地 = 同事务翻 PUBLISHED + 写 `publishedAt` → 审计 → 全员发信（波一漏斗三原则：持久物先于信号、`$transaction` resolve 后调横切写服务、服务边界吞错）。
- **客户详情一行**（岔口 1）：管理台客户详情页加"Agreement: 已同意 vX（时刻）；当前生效版未同意时标注 pending/declined"——读 consents 表，零新权限（挂客户详情既有读权）。

## §3 ⚡快进到生效（演示仪表）

PUBLISHED 版详情页 ⚡按钮：`effectiveAt` 改写为当前时刻并立即执行 1.4 的生效翻转。门控照既有 ⚡先例：`DEMO_CLOCK_WRITE` + Simulation 开关（金库/超管持有；合规官看得见页面点不动 ⚡，与投诉拨钟同款 RBAC 交叉，口径照甲波五先例写文档，非缺陷）。审计 `AGREEMENT_FASTFORWARDED`（actor=操作者），与生效业务事件 `AGREEMENT_EFFECTIVE`（actor=system）分记——⚡是模拟器动作，生效是业务事实。先例：`complaints.service.ts:447` / `regulatory-filing.service.ts:586` / `compliance-obligations.service.ts:149`。

## §4 客户侧：通知、弹窗、能力闸

### 4.1 通知（扩波一管子）

- `customer_notifications.relatedOrderType` 扩第五值 `AGREEMENT`（`prisma/schema.prisma:1972` 注释同步）；`relatedOrderNo` = versionKey（如 `v2`）。
- 波一模板登记处 +1 模板："协议将于 {effectiveAt} 更新"（引 `summary`）；email 模拟留痕同波一；深链 → `/agreement`（客户端 type→路由映射 +1）。
- 发信点唯一：批准落地后置（§2 漏斗）。生效时零通知（岔口 2）。

### 4.2 弹窗与横幅（修订 A 的两段式）

客户端登录/壳层加载时取 `GET /client/agreements/me`（当前生效版 + 在途 PUBLISHED 版 + 本人对两者的表态），纯展示逻辑抽纯函数供 vitest（显示条件四态：无事 / 通知期可关弹窗 / 生效后强制弹窗 / 已拒横幅），渲染靠截图闸：

| 时段 | 触点 | 行为 |
|---|---|---|
| 通知期（PUBLISHED 未生效） | 弹窗（可关："稍后再说"） | 展示 summary + 生效日 + "查看全文"链 `/agreement`；可提前同意（落 ACCEPTED v2 行，生效后直接静默） |
| 生效后、未对生效版 ACCEPTED | **强制弹窗（不可关，必须二选一）** | 同意 → 落 ACCEPTED、解锁；暂不同意 → 落 DECLINED、弹窗收起、**横幅常驻** |
| 已 DECLINED | 横幅常驻（"查看并同意"链 `/agreement`） | 页面照常可浏览；充值/兑换入口行为见 4.3 |

"稍后再说"不落库（它不是表态，只是关弹窗；本次会话内不再弹，刷新/再登录重弹——无状态，纯前端）。

### 4.3 能力闸（动钱入口，评审升档点）

- `CustomerAccessService`（`customer-access.service.ts`）注入协议侧只读判定 `hasAcceptedCurrent(customerId)`（AgreementsService 暴露，identity 域内近亲读，铁律③零跨界）：
  - `assertCapability` / `intakeDecision`：capability ∈ {DEPOSIT, SWAP} 且当前生效版无 ACCEPTED 行 → 拒绝；**WITHDRAW 不检查**（放行提现是本波的业务语义本体）。
  - **拒绝是显式的，不用 `NEUTRAL_DENIAL`**：code `AGREEMENT_NOT_ACCEPTED`、message 指明"请先同意现行客户协议"——这是客户自己的选择，零合规敏感信息，与 tipping-off 无关（decisions:122 不适用：此拦截与钱的去向无关）；客户端据此文案引导去 `/agreement`。
  - `intakeDecision` 里协议拦截返回 **DENY**（显式拒绝，不走 ACCEPT_FREEZE——折叠是给 SILENT 合规限制用的，协议拦截无须也不可伪装）。
- **坑 10 对策**：demo 里链上/法币入金全部经客户信号口 `inbound-transfer-signals.service.ts` `createForCustomer`（内调 `assertTradingIntake('DEPOSIT')`）进单，协议拦截在信号提交口即生效、显式报错——不存在"已到账再处置"的分支，无须新造到账后结局。spec 判据：未同意客户提交充值信号 → 400/403 显式协议报错；提交兑换建单同理；提现建单照常。
- 兑换/提现的闸调用点（`swap-transactions-customer.controller.ts` / `swap-workflow.service.ts` / `customer-withdraw.controller.ts` 等 6 文件既有调用）**零改动**——检查加在 `CustomerAccessService` 判定内部，调用方自然继承。

### 4.4 阅读页 `/agreement`（岔口 7）

- 版本状态头（你同意的版本与时刻 / 在途新版与生效日 / 待表态状态与同意按钮）+ 正文（共用组件渲染，v1/v2 可切换对照）+ 打印（`@media print` 沿波二 `position: fixed` + `color-scheme: light` 判例，真实打印预览验证，含背景图形开/关两态）。
- 同意动作在弹窗与本页都可发起（同一 `POST /client/agreements/{versionKey}/consent`）。
- 注册页：`TERMS_SECTIONS` 改取接口（§1.1）；注册成功在既有事务后置序列落 ACCEPTED 行（版本=注册时刻的生效版）+ 审计（已定事实 8；注册时若有在途 v2，登录后照 4.2 正常弹，不特殊处理）。

## §5 接口面（客户端三个 + 管理台随页）

- `GET /client/agreements/current`：当前生效版元数据 + 正文（**公开**，注册页未登录可取；demo 口径不做防刷）。
- `GET /client/agreements/me`（登录）：当前生效版 + 在途 PUBLISHED 版（各含元数据+正文或按需拆分，plan 定）+ 本人表态状态。
- `POST /client/agreements/{versionKey}/consent`（登录）：body `{action: ACCEPTED|DECLINED}`；仅接受 versionKey ∈ {当前生效版, 在途 PUBLISHED 版}（在途版只收 ACCEPTED——通知期没有"拒绝"语义，生效前不表态即是）；DECLINED 仅对生效版可落。
- 管理台：版本列表/详情/提交发布/⚡快进，挂 §2 桶；客户详情响应补协议行字段。

## §6 审计（328 → **335**，+7，全部走五处登记 + 出生即冻结四属性 + `assertActionSpec`，入波二确立的触达审计册）

| 码 | actor | 时机 |
|---|---|---|
| `AGREEMENT_PUBLISH_SUBMITTED` | 合规官 | 提交发布（metadata: versionKey/effectiveAt） |
| `AGREEMENT_PUBLISHED` | 批准落地（approvedBy 入 metadata，照审批载荷时序判例拆步） | 翻 PUBLISHED + 发信前 |
| `AGREEMENT_PUBLISH_REJECTED` | system（decision 入 metadata） | 驳回/撤/过期、或批准时 30 天复核不过的退回——PENDING_APPROVAL→DRAFT 边留痕（plan 期补：原 6 码漏了这条边，违铁律①） |
| `AGREEMENT_FASTFORWARDED` | ⚡操作者 | 改写 effectiveAt |
| `AGREEMENT_EFFECTIVE` | system | PUBLISHED→EFFECTIVE 翻转（含旧版翻 SUPERSEDED，metadata 两键） |
| `AGREEMENT_ACCEPTED` | customer | 落 ACCEPTED 行（注册/弹窗/阅读页三口同码，metadata 带 source） |
| `AGREEMENT_DECLINED` | customer | 落 DECLINED 行 |

`audit:vocab` 入库 335；审计中心按 customerNo / versionKey 可检索（演示动线：搜演员客户号 → 拒绝与同意两行白纸黑字）。

## §7 演示与 demo:all（坑 9 对策落地）

- **第九幕（新开，排整场最后）**：合规官提交发布 v2（填生效日，指读 30 天校验）→ 高管批准 → 切客户端：铃铛 + 站内信 + email 留痕 → 演员客户登录见可关弹窗（提前同意先不点）→ 切管理台 ⚡快进生效 → 演员再登录强制弹窗 → **暂不同意** → 充值/兑换入口显式拦（指读报错文案）、提现照常可走 → 管理台客户详情见"未同意 v2" → 审计中心搜 DECLINED → 演员回 `/agreement` 对照两版（指读第 V 节新段）→ 同意 → 解锁 → 审计补一行 ACCEPTED。收场。
- **`demo:all`：零协议动作**（plan 期订正，原"跑到发布为止"作废：demo:all 先发布则 ①前八幕现场走查时全库客户登录都弹新版弹窗，②第九幕现场再无"提交发布"可演——v2 只有一张）。v2 全程保持 DRAFT，全库客户闸零影响，既有各幕断言前提不变（骨架前提变化 7 已核）；发布→审批→通知→快进→表态整条链是第九幕现场戏，栈级证据来自走查截图（手驱走查法照波二 T7 先例，收尾闸前 `rm dev.db` 重铺防审计孤行，TOOLING-DEBT:89 在案）。`demo/baseline.md` 判据断言种子态：版本 2 行（v1 EFFECTIVE / v2 DRAFT）+ consents 13 行，且跑完交易日后协议态不变。
- `demo/baseline.md` 判据同步（新表计数、审计码 334、通知 +1 条）。

## §8 测试与闸

- **jest**（agreements + customer-access + 通知相关目录）：①状态机全边 + 非法跃迁拒（含 PENDING_APPROVAL 并行在途拒）；②30 天双锚校验（提交预检 + 批准复核，边界 29/30 天各一）；③批准落地漏斗次序（版本行→审计→全员通知落库，逐客户一行）；④闸：未同意 → DEPOSIT 信号/SWAP 建单显式拒（code 断言）、WITHDRAW 放行；ACCEPTED 后三域全放；提前同意 v2 → 生效后静默放行；⑤注册落 ACCEPTED 行 + 版本=当时生效版；⑥consents append-only（先拒后同两行并存，判定取生效版 ACCEPTED）；⑦审计 6 码四属性。
- **vitest**：弹窗/横幅四态显示条件纯函数。
- **闸**：tsc×3 ｜ 相关 jest + `npm run test:client` 全绿 ｜ `audit:vocab` 335 ｜ ⑤preview 截图 ≥9（管理台提交/审批/⚡/客户详情行 ｜ 客户端通知/可关弹窗/强制弹窗/拦截报错+横幅+提现可走/阅读页两版对照+打印预览）｜ 动 schema+seed → 收尾重铺闸⑧（`stack.sh reset` + `demo:all` 全绿对照 baseline）｜ 不动钱 → ⑦ `verify:coa` 不触发 ｜ `verify:rbac` 全绿（新桶/组/策略三处登记）｜ 禁文本扫描型断言。

## §9 文档与剧本同步（收尾按 `rules/delivery-checklist.md` 逐触发行过）

- `modules/`：客户域篇（或 v1 治理篇，plan 按模块归属定）加"客户协议"一节；overview §4 权限 82 桶 90 组、§5 审计 334、通知类型 5 值各行。
- `demo/script.md` 第九幕整幕新增；`demo/data.md` 生成区由 `demo:all` 自写。
- `decisions.md`：+费率零联动原则（防翻案）；+30 天锚定批准时刻；CHANGELOG 一行。
- BACKLOG：+1 行（协议同意率计数/名单，岔口 1 判缓）；PRODUCTION-NOTES 追加：正文整版哈希留存、到点自动生效的真定时器、通知期未读客户的催告。
- delivery 触碰检查：动了状态机（版本主体）+ 审计集（+6）+ 新业务键形态（versionKey 破例）→ 对应文件过一遍。
- 收尾：**立波四骨架**（月结单+DSR，含总纲链接/空承接节/已定事实搬运）并按交付清单写本波承接记录；本波 spec/plan/骨架随合并归档 `archive/superpowers/`。

## §10 数量表（终审逐条可点）

新表 2（迁移 +1，reset 登记 +1）｜ 新模块 1（`identity/agreements/`）｜ 审计 328→**335**（+7）｜ 权限桶 81→**82**（Compliance Office 域 +1）｜ 权限组 89→**90**（`AGREEMENT_WRITE` 合规官独占）｜ 审批策略 +1（`AGREEMENT_PUBLISH`，verify-rbac 登记 +1）｜ 通知模板 +1、`relatedOrderType` +1 值 ｜ 客户端：新页 1（`/agreement`）+ 弹窗/横幅组件 + 注册页正文改取接口 ｜ 管理台：新页 1 + 客户详情 +1 行 ｜ 能力闸改 1 处（`CustomerAccessService` 内部，6 个调用文件零改动）｜ 种子：consents +13 行、versions +2 行。

## §11 验收口径（总纲波三行展开）

第九幕一条线截图走通：发布 → 审批 → 通知 → ⚡快进生效 → 强制弹窗暂不同意 → 充值/兑换显式拦 + 提现可走 + 详情行 + 审计可查 → 两版对照 → 同意解锁；`demo:all`（协议零动作，v2 保持 DRAFT）全绿；重铺后全部复现。
