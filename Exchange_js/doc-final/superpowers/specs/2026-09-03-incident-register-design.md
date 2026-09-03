# 平账三期 · 事故登记（治理件）设计 —— 草稿

- 日期：2026-09-03
- 状态：**草稿，未经业主逐段脑暴**。用法同二期草稿：开工先过 §0.2 岔口，拍完板再进 writing-plans。三期依赖二期（赔付 / 垫款要走内部划转单），顺序不能反
- 承接：`decisions.md` [2026-08-28] 平账分三期（事故是治理件）、[合规承接]（不重建内部合规信号管道）；`BACKLOG.md` §G「三期 · 事故登记」（含 2026-09-02 评审补记的「上报留痕待设计」）；`BACKLOG.md`「INTERNAL_BREAK 全链本期不做」；成因表 `UNAUTHORIZED_OUTFLOW → INCIDENT`；A 批「大额超期只留档，事故三期」；B 批「退汇余额不足待三期追索」
- 前序：一期 → 一期半 → A 批 → B 批 → 二期

## 0. 事实与岔口

### 0.1 已经定了的

| # | 事实 | 出处 |
|---|---|---|
| 1 | 平账三期 = 事故登记，性质是**治理件**：纠错不动钱（调账）、划转动真钱有在途、事故是治理件，硬塞进一个主体会让调账单的定义糊掉 | decisions 2026-08-28 |
| 2 | C3 未授权转出（钥匙泄露 / 内部人作案 / 银行误划）业主定性为**事故**，不是普通差异；补款只是善后，事故本身要：登记、定性、升级（MLRO / 管理层）、通报监管 | BACKLOG §G 三期条 |
| 3 | 抽不抽独立模块三期到了再定；**若建，必须先在 decisions 写清与已删 `incidents` 的区别**：被删的是合规筛查信号（归 Sumsub），这里是运营 / 安全 / 资金事件（Sumsub 管不着） | BACKLOG §G 三期条；decisions [合规承接] |
| 4 | **上报留痕要求待设计**：`UNAUTHORIZED_OUTFLOW` 查证时「该上报给谁、什么时候、依据是什么」——手册里抢先写的一句已删，需求点留给三期 | BACKLOG §G（2026-09-02 手册 T13 评审补记） |
| 5 | 成因表 `UNAUTHORIZED_OUTFLOW`（外有我无 × 客户，OUT）出口「留档 · 事故升级（三期）」；公司池差异超小额线到线后显示「超期 · 待升级事故（三期）」无入口 | `cause-registry.ts`；`modules/v8-recon.md` §5 |
| 6 | 漏记的提现（钱出去了但客户没提过）是事故不是差异，不做自动处置、只开案升级 | BACKLOG「运营补录入站信号」条边角② |
| 7 | 退汇认领时客户可用余额不足 → 拒绝认领，待二期公司垫款与**三期追索** | B 批 spec §4 |
| 8 | 内部恒等预门（`computeInternalIdentity()`）已在，破裂即中止本轮并报内部破口；事故界面 / 告警 / 收敛冻结 / 受控更正全部 defer；对账 PRD 不把 INTERNAL_BREAK 当 run 结果 | BACKLOG「INTERNAL_BREAK 全链本期不做」 |
| 9 | 监管挂钩已在路线图：「未平差异报 VARA」（CRM IV.E.5 客户资金 + V.D.2 客户虚拟资产）、「卡单重大事件 72h 上报判定」（Tech K.1 + I.H.1）；今天止于内部 RESOLVED、无对外出口 | `reference/roadmap.md` ⚖️P1 两条 |
| 10 | 平台牌照仅 BD，T&S 条款不能当直接义务引 | memory `platform-license-bd-only` |
| 11 | 复核人口径：合规驱动归 MLRO，纯资金归 CFO | 业主 2026-09-03 |

### 0.2 待拍板（每条带建议）

| # | 岔口 | 选项 | 建议 |
|---|---|---|---|
| G1 | **抽不抽独立模块** | 甲 抽 `governance/incidents`（与 approvals 平级的治理件）｜ 乙 挂在对账模块下当案子的附属 | **甲**。三期落地时用例已有三个（未授权转出、大额查不出、客户欠款），且事故可以不来自对账（人工登记）；decisions 先写清与已删 `incidents` 的区别（§12） |
| G2 | **事故类型清单**（首批做哪些） | `UNAUTHORIZED_OUTFLOW` 未授权转出 ｜ `LARGE_UNEXPLAINED` 公司池大额查不出到线 ｜ `CLIENT_SHORTFALL` 客户欠款（退汇余额不足）｜ `MISSED_PAYOUT` 漏记提现 ｜ `INTERNAL_IDENTITY_BREAK` 恒等破裂 ｜ `MANUAL` 人工登记 | **首批四个**：前三 + `MANUAL`。恒等破裂与漏记提现留 BACKLOG（前者全链 defer 是既定，后者今天没有演示场景） |
| G3 | **状态机形状** | 甲 五态：已登记 → 调查中 → 已定损 → 处置中 → 已结案 ｜ 乙 加「已升级」态 | **甲**。升级是动作 + 记录（升给谁、何时），不是状态；结案前必须有定损 |
| G4 | **谁裁决**：登记 / 升级 / 结案 | 登记：运营或金库 ｜ 升级：按类型路由（涉合规 → MLRO，纯资金 → CFO）｜ 结案：maker-checker，未授权转出两步（MLRO → CFO），其余 CFO 单步 | 采纳左列；未授权转出可能是洗钱或内部人，先 MLRO 后 CFO 符合 §0.1-11 口径且两人都要签 |
| G5 | **监管通报做到哪一步** | 甲 只做留痕：通报草案、依据条款、时限计时、已通报标记、经办人 ｜ 乙 真发（邮件 / 门户） | **甲**。时限与阈值不在本仓库杜撰，按 CRM Rulebook 条款核后填常量（roadmap 引的 IV.E.5 / V.D.2 / I.H.1 是起点） |
| G6 | **事故与冻结的联动**：未授权转出是否自动冻结客户 / 钱包 | 自动 ｜ 不自动、页面给「去冻结」链接 | **不自动**。冻结是合规动作（V2 冻结流有自己的门），事故页只指路 |
| G7 | **事故的账务出口** | 事故零账务，善后走既有原语：追回 → 补录 / 认领（B 批）｜ 认损 → 调账认损 + 二期补款 ｜ 追索 → 只登记不入账，追回时走补录 | 采纳。COA 无「应收」科目、不新增；追索金额只在事故单上 |
| G8 | **演示场景** | 新增破口场景「未授权转出」（客户钱包 OUT 无单）| 用它把「登记 → 调查 → 升级 → 定损 → 善后（认损 + 补款）→ 结案 + 通报草案」走完；钱包位 plan 时定（B 批后 Alice USDT 若被二期场景 16 占用，则叠在 Bob USDT） |
| G9 | **大额查不出到线的入口** | 案子上「升级事故」按钮自动带金额 / 钱包 / 案号 | 采纳；A 批那句「超期 · 待升级事故（三期）」变成可点 |

## 1. 定位与边界

**是什么。** 一张事故单：谁登记、什么类型、涉及哪个钱包 / 客户 / 多少钱、从哪张案子来、调查记录、升级给了谁、定损多少、善后走了哪些单（补录 / 调账 / 划转）、有没有通报监管、谁结的案。零账务。

**不是什么。** 不是合规筛查（Sumsub 的活，decisions [合规承接]）；不是通知中心；不是对外通报系统（G5 甲）；不是恒等破裂的收敛流程（BACKLOG）。

**为什么单独一个主体。** 调账单和划转单都是「钱怎么改」，事故单是「事情怎么交代」：谁知道、何时知道、上报没有。VARA 场景下这层留痕是业务可见物。

## 2. 主体与状态机

主体 `Incident`（单号 `INC…`）。

| 状态 | 含义 | 出边 |
|---|---|---|
| `REGISTERED` 已登记 | 有类型、金额、来源；可从案子一键登记或人工登记 | `START_INVESTIGATION → INVESTIGATING`；`WITHDRAW → WITHDRAWN`（误登记，需说明） |
| `INVESTIGATING` 调查中 | 记录调查条目（时间、人、发现）；可做「升级」动作（对象 MLRO / CFO / 管理层，记录不改状态） | `ASSESS → ASSESSED` |
| `ASSESSED` 已定损 | 定损金额、定损口径（追回 / 认损 / 追索 / 无损失）、是否需通报 | `START_RESOLUTION → RESOLVING`；`CLOSE_NO_ACTION → CLOSED`（无损失、无善后，仍走结案审批） |
| `RESOLVING` 处置中 | 善后单挂上来：补录 / 认领 / 调账 / 划转，各自在自己域走完 | `CLOSE → CLOSED`（结案审批批准后） |
| `CLOSED` / `WITHDRAWN` | 终态 | — |

- 显式迁移表；`ASSESSED` 之前不能结案（G3）
- 计时：**通报时限**一只钟（`ASSESSED` 且「需通报」起算，常量待核，G5）；超时只标记 + 审计，不推状态。其余不计时
- 升级动作：`ESCALATE { to: MLRO | CFO | SENIOR_MANAGEMENT, note }`，可多次，每次一条记录 + 审计

## 3. 审批

- `INCIDENT_CLOSE`：主体 `incidentNo`；策略按类型：`UNAUTHORIZED_OUTFLOW` 两步 `[MLRO] → [CFO]`，其余 `[CFO]` 单步；48h；可撤。策略表按类型分流的写法参考 `DEPOSIT_SEIZE` 的两步形状；若审批框架只按 actionType 取策略，则拆两个类型 `INCIDENT_CLOSE_SECURITY` / `INCIDENT_CLOSE_FINANCIAL`（plan 核实后定）
- maker 权限组 `INCIDENT_WRITE`；`MAKER_GROUP_BY_POLICY` 加行
- 结案审批单摘要：类型、金额、定损口径、善后单号清单、是否已通报

## 4. 通报留痕（G5 甲）

事故单下挂 `regulatoryReport` 子记录：`required`（是否需通报，定损时勾）、`basis`（依据条款文本，如「CRM IV.E.5」）、`deadlineAt`（= 触发时刻 + 常量小时数）、`draft`（通报草案正文）、`reportedAt` / `reportedByUserId`（人工点「已通报」）、`reference`（对外编号，选填）。三件事必须留痕：对象（VARA）、时限、依据。不做真实发送。

## 5. 与对账、调账、划转、补单的链接

| 入口 | 从哪来 | 预填 |
|---|---|---|
| 案子定性 `UNAUTHORIZED_OUTFLOW` → 「登记事故」 | 对账案子详情 | 类型、钱包、客户、金额、案号、账单行参考号 |
| 公司池大额到线 → 「升级事故」 | 案子详情（A 批「超期 · 待升级事故」处） | 类型 `LARGE_UNEXPLAINED`、金额、钱包、案号 |
| 退汇认领余额不足 → 「登记欠款」 | B 批认领拒绝提示处 | 类型 `CLIENT_SHORTFALL`、客户、差额 |
| 人工登记 | 治理台「事故登记」列表 | 空表单 |

善后回挂：事故单上「善后单」列表，登记时选类型（补录 / 认领 / 调账 / 划转）+ 单号，系统只校验单号存在与归属同一客户或钱包；单子在各自域走完，事故页只读它们的状态。追索走 `CLIENT_SHORTFALL` 的定损口径「追索」，金额只在事故单上（G7）。

案子侧：定性行的出口从「留档 · 事故升级（三期）」改为「事故 · 已登记 INC…」（可点）；案子不因事故登记而愈，账实仍不符直到善后落账。

## 6. 页面

- 管理台治理：「事故登记」列表（类型 / 状态 / 金额 / 来源案号 / 通报状态 / 时限倒计时）、详情（基本信息、调查记录时间线、升级记录、定损、善后单、通报留痕、审批）、新建
- 对账案子详情：三处按钮（§5）；A 批「超期 · 待升级事故」文案变按钮
- 审批中心：通用
- 客户端：**无**。事故信息一律不出客户面（未授权转出可能涉刑事调查，tipping-off 同款谨慎；客户看到的只是善后落账后的余额变化）

**截图**：登记表单｜调查中详情（含升级记录）｜定损 + 通报草案｜善后单挂载｜两步结案审批｜案子上的三处入口。

## 7. 审计与权限

- 审计码（domain `GOVERNANCE`）：`INCIDENT_REGISTERED` / `_INVESTIGATION_STARTED` / `_NOTE_ADDED` / `_ESCALATED` / `_ASSESSED` / `_REMEDIATION_LINKED` / `_REGULATOR_REPORT_DRAFTED` / `_REGULATOR_REPORTED` / `_CLOSE_REQUESTED` / `_CLOSED` / `_WITHDRAWN`；`_ESCALATED` 必填 `escalatedTo`；`_REGULATOR_REPORTED` 必填 `basis`
- 权限组：`INCIDENT_WRITE`（运营 + 金库）｜ `INCIDENT_REVIEW`（MLRO、CFO：升级接收、定损确认）｜ `INCIDENT_READ`（内审、管理层）；四处齐
- 端点：`POST /admin/incidents`、`GET` 列表 / 详情、`POST …/:incidentNo/notes`、`…/escalate`、`…/assess`、`…/remediations`、`…/regulator-report`、`…/close`（开审批）、`…/withdraw`；`route()` 登记 + sync + 重启

## 8. 演示脚本变化

新增破口场景「未授权转出」（G8）：客户钱包幽灵 OUT、无任何单据 → 第六幕末段：定性「未授权转出」→ 登记事故 → 调查记录两条 → 升级 MLRO → 定损「认损，需通报」→ 通报草案（依据条款、时限倒计时）→ 善后：认损调账 + 二期补款划转（客户余额复位）→ 结案两步审批 → 案子重对账愈。顺带演一笔人工登记的 `MANUAL` 事故并撤回，讲「误登记怎么收」。

花名册不动；`recon:demo:break` 场景数 +1（编号接二期之后）；`baseline.md` 同步。

## 9. 验收标准

- 随手闸三处；jest：`governance/incidents/`（新）、`reconciliation/`、`approvals/`
- e2e `test/incident-register.e2e-spec.ts`：从案子登记 → 调查 → 升级 → 定损 → 善后挂载（引用 B 批 / 二期真单）→ 两步结案 → 状态终态；通报留痕三要素齐；`ASSESSED` 前结案 400；人工登记 + 撤回；权限：运营能登记不能结案、CFO 不能自批
- 收尾闸：`reset self` → `demo:all` → `recon:demo:break` 新场景数全检出 → 第六幕末段走完 → `verify:coa`（事故零账务，善后落账后恒等仍平）→ `verify:audit`（11 个新码）→ `verify:rbac` → 截图
- 变异测试：去掉「定损前不许结案」守卫，e2e 对应用例必须红；把通报时限计时去掉，时限倒计时断言必须红

## 10. 明确不做

真实对外通报（G5）｜ 自动冻结（G6）｜ 恒等破裂收敛全链 ｜ 漏记提现类型（BACKLOG）｜ 通知中心 ｜ 事故 SLA 硬推状态 ｜ 应收科目 ｜ 客户端可见 ｜ 与 Sumsub 的信号联动 ｜ 幂等 / 并发 / 重试

## 11. 依赖与顺序

三期开工前提：B 批合入（补录 / 认领作为善后原语）、二期合入（补款划转作为善后原语）。若二期延后，三期可先做「登记 → 定损 → 通报留痕 → 结案」骨架，善后挂载只挂调账单与补单，划转留空位，但演示闭环（客户余额复位）演不出，需业主同意再拆。

## 12. `decisions.md` 追加草稿（拍板后落）

- [日期] **事故登记是治理件，独立主体 `Incident`**，与已删的 `incidents`（合规筛查信号，归 Sumsub）不是一回事：这里登记的是运营 / 安全 / 资金事件，Sumsub 管不着，平台必须自己留痕 ｜ 承接 [合规承接] 与 2026-08-28
- [日期] **事故零账务**：善后一律走既有原语（补录 / 认领 / 调账认损 / 补款划转），追索只登记不入账，不设应收科目 ｜ 待业主
- [日期] **结案裁决按类型路由**：未授权转出 MLRO → CFO 两步，其余 CFO 单步；升级是动作不是状态 ｜ 待业主
- [日期] **监管通报只做留痕**（对象 / 时限 / 依据 / 草案 / 已通报标记），不做真实发送；时限常量按 CRM Rulebook 条款核定后填 ｜ 待业主

## 附录 A · 数据模型（一个迁移）

| 表 | 字段 |
|---|---|
| `incidents`（新） | `id`、`incidentNo @unique`、`type`、`status`、`sourceCaseNo?`、`sourceDispositionNo?`、`sourceExternalLineId?`、`walletRef?`、`customerId?`、`assetCode?`、`amount Decimal?`、`title`、`description`、`assessedAmount?`、`assessmentBasis?`（RECOVERED / FIRM_LOSS / CLIENT_COLLECTION / NO_LOSS）、`reportRequired Boolean`、`reportBasis?`、`reportDeadlineAt?`、`reportDraft?`、`reportedAt?`、`reportedByUserId?`、`reportReference?`、`registeredByUserId`、`closedAt?`、`traceId`、时间戳 |
| `incident_notes`（新） | `incidentId`、`kind`（NOTE / ESCALATION）、`escalatedTo?`、`body`、`authorUserId`、`createdAt` |
| `incident_remediations`（新） | `incidentId`、`kind`（SUPPLEMENT / CLAIM / ADJUSTMENT / TRANSFER）、`referenceNo`、`linkedByUserId`、`createdAt` |
| `reconciliation_dispositions` | + `incidentNo String?`（与 `adjustmentNo` / `supplementNo` 平行） |

常量：`ApprovalActionTypes` +1（或 +2，§3）、策略 +1/+2；`AuditActions` +11、工作流类型 +1；`PermissionGroup` +3、`route()` +9；成因表 `UNAUTHORIZED_OUTFLOW` 出口 `DEFERRED/INCIDENT` → `INCIDENT`（新 `StoredOutlet` 值），A 批账龄「待升级事故」文案改按钮。

## 附录 B · 交付清单行

任何持久状态变化 ｜ 新增审计动作码（11）｜ 新状态 / 新结局（一整套迁移表；计时：通报时限一只钟，软标）｜ 该走 maker-checker（结案）｜ 新增审批策略（+1/+2）｜ 新增权限组（3）｜ 新增 admin 端点（9）｜ 新增业务动作（前端入口四处）｜ 对外识别（`incidentNo`）｜ 改 schema ｜ 改页面或种子（破口场景 +1）｜ 改了前端（截图六张）｜ 每轮收尾（modules：`v1-governance.md` 加事故一节或新篇，plan 定；v8-recon §5 三处「三期」句改现状；手册 `UNAUTHORIZED_OUTFLOW` 行；overview；decisions；CHANGELOG；BACKLOG 销 §G 三期条 + 上报留痕待设计 + B 批留下的追索行）

不触发：动了钱（事故零账务；善后在各自域已各自过闸）｜ 改了交易三域（无）｜ 新字段到客户面（无，刻意）｜ 新事件（无）
