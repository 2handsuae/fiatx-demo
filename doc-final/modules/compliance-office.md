# 合规办公室（闹钟墙 · 合规日历 · 登记册）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-10-03（战役丙波四：闹钟墙加第四类灯 DSR，见 §1）；此前 2026-09-27（战役甲波四：闹钟墙 / 合规日历 / 登记册两本落地，首次实数点验：15 域 73 桶 81 组）
> 演示幕次：第八幕场景 21/22（战役甲波五收官定稿）｜ 验收：场景 21/22 走查（`demo/script.md`）+ 本篇 §5

## 0. 这是什么

合规办公室是**监管义务的统一倒计时看板 + 两本法定登记册**，挂在 V1 治理域下、与 V9 报送台共用同一张 `RegulatoryFiling` 主体（见 §2）：

- **闹钟墙**：把「对监管的死限期」——报送单的 `deadlineAt`、周期义务的 `nextDueAt`、投诉的确认 / 裁决钟与资料请求（DSR）的 30 天答复钟——聚合到一张只读表（四类灯：FILING / OBLIGATION / COMPLAINT / DSR），红/黄/绿三色一眼看出谁快到期、谁已超期。
- **合规日历**：周期性监管申报（月报/季报/年报）的义务台账，到期自动开出报送单（一期一单，翻期在生成时）。
- **两本登记册**：外包商登记册（Material Outsourcing）与 RI（Responsible Individual，受托责任人）登记册，RI 换人走事前审批（合规官提、高管批）。

**它不做什么**（对照总纲 §2 与本波裁定，spec §0）：不推送提醒（只看板不推送）；不建内幕名单登记册（乙案已判纯组织件不建）；不把 HRC/HRCA 三工作日不反对窗上墙（台账只记「报了没有」，窗口到期后的动作留三域细化）；超时后果止步于「标红 + 审计留痕」，升级成事故由演示者**人工**去事故中心登记——不自动开事故、不为「超时」新造事故类型。

## 1. 闹钟墙

**端点**：`GET /admin/compliance-office/clock-wall`（只读聚合，不落新表）。返回行按归一形状展开：

```
{ kind: 'FILING' | 'OBLIGATION' | 'COMPLAINT' | 'DSR', refNo, title, authority,
  deadlineAt, overdue: boolean, status, linkKey }
```

- **FILING 行**：`deadlineAt != null && status ∈ {DRAFT, PENDING_SIGNOFF, SIGNED_OFF}`——按时提交即下墙；被 sweep 标过 `overdueMarkedAt` 的**红着留墙**，直到提交 / 办结 / 作废才消。数据源即 V9 报送台的 `regulatory_filings.deadlineAt`（GENERAL 族 + AML 族 + 本波新增 PERIODIC_RETURN，同一张表、同一套超时软标机制，见 `modules/v9-regulatory-filing.md` §2）。
- **OBLIGATION 行**：`status = ACTIVE` 的义务全部上墙，按 `nextDueAt` 倒计时；义务行只有绿 / 黄两色，到期即生成工单并翻期（§2），红色由生成的工单行接棒。
- **COMPLAINT 行**（2026-09-28 战役甲波五新增）：`currentStatus != 'RESOLVED'` 的每张投诉一行，`deadlineAt` 取未确认走确认钟（`ackDeadlineAt`）、已确认走裁决钟（`resolveDeadlineAt`），`clockLabel` 区分两钟，超时同样只软标变红、不自动动作——详见 `modules/complaints.md` §5。
- **DSR 行**（2026-10-03 战役丙波四新增，**第四类灯**）：`status != RESOLVED` 的每张资料请求一行，`deadlineAt` 取 `dueAt`（提交时刻 + 30 自然日单钟），`authority` 恒为 `DPO`，逾期 = 读时现算 `dueAt < now`（已办结单永不逾期）——详见 `modules/v2-customer-compliance.md` §8。**行点击**有显式 DSR 分支，落 DSR 详情页（目的页读权由路由守卫判：合规官 / 内审只读，MLRO 落 403 页）；**⚡ 快进**走 DSR 自家端点（`simulate-timeout`，`DEMO_CLOCK_WRITE`）——能同时看到墙又点得动 ⚡ 的只有超管：DPO 是 DSR 经办人但**不持 `COMPLIANCE_OFFICE_VIEW`、看不见墙**，金库有拨钟权同样看不见墙，合规官看得见墙但没有 ⚡ 列（墙是合规官督办视角，DPO 看自己列表页的倒计时列）。

**颜色三档**：红 = `overdue`（FILING / COMPLAINT / DSR 三类行都可能红——FILING 行由 sweep 标 `overdueMarkedAt`、COMPLAINT 行超时软标、DSR 行读时现算 `dueAt < now`；OBLIGATION 行只有绿 / 黄）；黄 = 剩余 ≤ 24h（聚合端点不携带锚时间戳或 `leadBusinessDays`，四种 kind 统一走「总长不可知」分支，见前端实现注释）；绿 = 其余。阈值数字是展示参数，不入验收判据。

**权限**：`COMPLIANCE_OFFICE_VIEW`（合规官、MLRO、高管、内审、CISO 五职务共持，见 §4）。

**⚡ 快进**（四条，均挂 `DEMO_CLOCK_WRITE`，金库/超管持有，审计各一条；前两条随闹钟墙 / 合规日历一并落地，后两条分别由投诉 / 资料请求两波加入，墙上 FILING / COMPLAINT / DSR 行点 ⚡ 各走自己类别的端点，OBLIGATION 的 simulate-due 不在墙行上）：
- `POST /admin/regulatory-filings/:filingNo/simulate-deadline-timeout`——把该单 `deadlineAt` 回拨到过去（仅限墙上行集内状态，终态 / 已提交单 400），30 秒内被既有 sweep 标红，落 `FILING_DEADLINE_FASTFORWARDED` 审计。
- `POST /admin/compliance-obligations/:obligationNo/simulate-due`——把 `nextDueAt` 回拨进生成窗，sweep 30 秒内当场开单（见 §2），落 `OBLIGATION_DUE_FASTFORWARDED` 审计。
- `POST /admin/complaints/:complaintNo/simulate-timeout`——把该投诉的确认钟或裁决钟（body `target`）回拨到过去，落 `COMPLAINT_DEADLINE_FASTFORWARDED` 审计（详见 `modules/complaints.md` §5）。
- `POST /admin/dsr-requests/:requestNo/simulate-timeout`——把该资料请求 `dueAt` 回拨到 now−1h（终态 400），落 `DSR_DEADLINE_FASTFORWARDED` 审计（详见 `modules/v2-customer-compliance.md` §8）。

前端按钮走 `useSimulationMode` 既有门控；合规官不持 `DEMO_CLOCK_WRITE`（不是自己的裁决人），页面上不出现任何 ⚡ 按钮——只有金库 / 超管这类持有 `DEMO_CLOCK_WRITE` **且**持有 `COMPLIANCE_OFFICE_VIEW`（金库不持有，实际能点的只有 SUPER_ADMIN）才看得到并能点，这一「无人独自持有两把钥匙」的现象是本波真实的 RBAC 交叉产物，非缺陷（见 §4）。

## 2. 合规日历

### 2.1 新主体 ComplianceObligation（表 `compliance_obligations`）

对外业务键 `obligationNo`（前缀 `OBL`）。字段：`name`/`description?`、`frequency`（`MONTHLY|QUARTERLY|SEMIANNUAL|ANNUAL`）、`authority`（既有五家受文机构目录取值）、`basisNote`（依据条款自由文本，不杜撰）、`leadBusinessDays`（生成提前量，默认 5）、`nextDueAt`、`status`（`ACTIVE|DISABLED`，显式迁移表两边）、`lastFilingNo?`（回填最近一期生成的工单号）。CRUD 全归合规官（`OBLIGATION_WRITE`）：建 / 改 / 停用 / 复用，全程审计，无硬删。

### 2.2 到期生成（一期一单，翻期在生成时）

`ComplianceObligationSweepService`（@Cron 每 30 秒，`sweep(now)` 与定时分离，逐笔 try/catch，照报送单 sweep 模板）。触发判据：`status='ACTIVE' && addBusinessDays(now, leadBusinessDays) >= nextDueAt`（正推比对，不写反推函数）。命中即：

1. `ComplianceObligationsService.claimDue()`：自表写——`nextDueAt` 按 `frequency` 翻到下一期（日历月加法 +1/+3/+6/+12，落周末不挪，v1 简化）＋ 审计 `OBLIGATION_FILING_GENERATED`。翻期在生成时完成，一期一单由构造保证，不需要去重机制。
2. `RegulatoryFilingService.openForObligation()`：开一张 `type=PERIODIC_RETURN` 报送单，`anchorAt = 该期 dueAt`（EXTERNAL 锚 → `deadlineAt = dueAt`），`authority`/`title` 从义务行带出（title 含期别，如 "VARA Monthly Regulatory Return — due 2026-09-30"），`createdByUserId='SYSTEM'`。
3. 回填 `lastFilingNo`。

工单被作废不回拨义务（下一期照走）；该期要补报走手工开单（`openManual`，EXTERNAL 锚手工路拿不到锚、`deadlineAt` 留 `null`，与 CNMR/PNMR 手工路先例同款）。

**类型目录新增 `PERIODIC_RETURN`**（十一行→十二行，详见 `modules/v9-regulatory-filing.md` §2）：`family='GENERAL'`——走既有六态六边全弧原样（合规官起草 → 高管签发 → 标已提交 → 办结），零新边、零新审批类型，定期申报要高管签字业务上讲得圆。

**实测边界发现**（T10 场景 21 走查坐实，非缺陷）：`leadBusinessDays` 默认 5 个工作日，若义务的自然期末恰好落在铺场时刻 5 个工作日以内（如月末 / 季末临近铺场日），后端服务一启动、sweep 30 秒内即自动触发生成——不需要演示者动 ⚡ 按钮。本波种子铺场当日（2026-09-27，月末季末均为 2026-09-30）即命中此边界，Monthly/Quarterly 两条义务开箱即已生成 `PERIODIC_RETURN` 单；仅 Annual（次年到期，远超提前量）需要 ⚡ 才能现场演示「快进」机制。

## 3. 登记册两本

### 3.1 外包商册 OutsourcingVendor（表 `outsourcing_vendors`）

对外业务键 `vendorNo`（前缀 `VEN`）。字段：`name`/`serviceDescription`、`criticality`（`MATERIAL|NON_MATERIAL`）、`contractStart`/`contractEnd?`、`status`（`ACTIVE|TERMINATED`，`ACTIVE→TERMINATED` 单边、终态零出边）、`notes?`。CRUD 归合规官（`VENDOR_REGISTER_WRITE`）：登记 / 修改 / 终止，无硬删，全程审计。与波一「外包商断供」事件（`outsourcing-kyc-relay-degraded`）的呼应是纯叙事——不建外键、不建联动（YAGNI，两主体各管各的）。

### 3.2 RI 册 ResponsibleIndividual（表 `responsible_individuals`）

对外业务键 `riNo`（前缀 `RI`）。字段：`position`（岗位名自由文本，演示合理集非法定名录）、`incumbentName`（自然人姓名，与 IAM 账号无外键无联动）、`varaRef?`、`effectiveFrom`、`pendingApprovalNo?`（在途换人审批单号，一席一在途，非空时再提 400）、`status`（`ACTIVE` 常驻，v1 无退席位边）。

- **建席位**：合规官（`RI_REGISTER_WRITE`）。
- **换人（事前审批，本册唯一流程戏）**：合规官提 `RI_REPLACEMENT` 审批（新任姓名 + 生效日 + 理由 + `varaRef?`）→ **高管单步批**（`ApprovalActionTypes.RI_REPLACEMENT`，策略 `{steps:[{stepNo:1,roles:['SENIOR_MANAGEMENT_OFFICER']}], timeoutHours:48, allowCancel:true}`，照 `SANCTION_DISPOSITION` 先例注册）→ `ri-replacement-workflow.service.ts`（`onDecided` 监听，照 `sanction-disposition-workflow.service.ts` 先例）调服务方法落地：换 `incumbentName`/`effectiveFrom`/`varaRef`、清 `pendingApprovalNo`、审计 `RI_REPLACEMENT_APPLIED`（携 `fromIncumbent`/`toIncumbent`）。驳回 / 撤单 / 过期 → 只清 `pendingApprovalNo` + 审计 `RI_REPLACEMENT_REJECTED`。
- 换人史靠审计链可查：`RI_REPLACEMENT_APPLIED` 这条审计的 `metadata` 里直接落着 `fromIncumbent`/`toIncumbent`/`approvalNo` 三键（T8 评审修复——`extra` 顶层字段此前只供 `assertActionSpec` 校验、不落库，已镜像进 `metadata`，见 §5 R5），管理台审计详情页 Payload/Metadata 区可直接读到「谁换了谁」，场景 22 走查已实证（`doc-final/superpowers/checkups/2026-09-27-act-a-wave4-evidence/22-04-ri-replacement-audit-from-to.png`）。

## 4. 权限、审计、RBAC

**新域 `Compliance Office` 四桶**（波四时点 RBAC 15 域 73 桶 81 组；2026-09-28 波五后现值 75 桶 83 组，权威快照见 `overview.md` §4——波五终审逮出的时点值漏更，订正为双时点表述）：

| 桶 | 组 | 持有 |
|---|---|---|
| `compliance-office.view`（看闹钟墙 / 日历 / 两册） | `COMPLIANCE_OFFICE_VIEW` | 合规官、MLRO、高管、内审、CISO |
| `compliance-office.obligations`（管周期义务台账） | `OBLIGATION_WRITE` | 合规官独占 |
| `compliance-office.vendors`（管外包商册） | `VENDOR_REGISTER_WRITE` | 合规官独占 |
| `compliance-office.ri`（管 RI 册 + 提换人） | `RI_REGISTER_WRITE` | 合规官独占 |

不需要 `cap.*` 服务层族独占——本波三个写面各自单一经办人，路由门即精确门（与波三「两个经办人共享同一组写路由」的场景不同，无需按族再分权）。高管新增 `RI_REPLACEMENT` 裁决位，随之补持 `COMPLIANCE_OFFICE_VIEW`。⚡ 两条新路由挂既有 `DEMO_CLOCK_WRITE`（金库，Demo Instruments 桶描述扩一句，不加桶不加组）。

**审计名册十三码**（domain GOVERNANCE，`COMPLIANCE_OFFICE_AUDIT_ACTIONS`，独立常量组照 filing 先例）：`OBLIGATION_REGISTERED` / `OBLIGATION_UPDATED` / `OBLIGATION_STATUS_CHANGED` / `OBLIGATION_FILING_GENERATED` / `OBLIGATION_DUE_FASTFORWARDED` / `VENDOR_REGISTERED` / `VENDOR_UPDATED` / `VENDOR_TERMINATED` / `RI_SEAT_REGISTERED` / `RI_REPLACEMENT_PROPOSED` / `RI_REPLACEMENT_APPLIED` / `RI_REPLACEMENT_REJECTED` / `FILING_DEADLINE_FASTFORWARDED`（后者挂本组而非 `REG_FILING_AUDIT_ACTIONS`，单步演示动作无旅程可继承）。审计现役码全量目录 273→**286**（`audit:vocab` 实跑数，GOVERNANCE 域 20→33）。

**R5 修复（T8 评审）**：`RI_REPLACEMENT_APPLIED` 等码此前 `fromIncumbent`/`toIncumbent`/`frequency`/`criticality`/`position`/`nextDueAt`/`dueAt`/`filingType`/`deadlineAt`/`approvalNo`/`decision` 这些展示级字段只在写入时供 `assertActionSpec` 校验必填、不落任何持久化列——审计详情页查不到。已把这些字段镜像进 `metadata` JSON（`extra` 校验形态保留不动，双落而非改字段结构）。**已知不对称**（登记 BACKLOG）：波二遗留的 `FILING_OVERDUE_MARKED`（`regulatory-filing-sweep.service.ts`）的 `deadlineAt` 字段未随本轮修复同步镜像，仍是 `extra`-only、审计详情查不到具体拨到了哪个时刻——与本波新写点的处理方式不对称，见 `BACKLOG.md`。

**`verify:rbac` 扩判据**：新域四处齐（route / 桶目录 / 职务绑定）＋ 三写组唯合规官 ＋ `COMPLIANCE_OFFICE_VIEW` 恰五职务 ＋ 行为探针（合规官三写面可写、其余职务 403、RI 在途重复提 400、高管可批换人、内审仍零写、⚡ 唯金库/超管）。收尾口径（Ruling R4）：本波新增判据全绿，既有红集（`S7`/`BACKLOG:234` COMPLIANCE_OFFICER 孤儿组）与波前基线恒等、不新增。

## 5. 演示脚本

**场景 21 · 闹钟墙与合规日历**（墙现为四类灯——报送单 / 周期义务 / 投诉 / DSR；本场景只走前两类，投诉灯与 DSR 灯分别在各自场景里演）：看墙（报送单钟 + 三条义务倒计时）→ ⚡ 义务快进 → 工单当场出现在墙上与报送台 → 合规官起草送签 → 高管签发 → 标已提交 → 义务翻期；再 ⚡ 报送单超时 → 墙上变红 + 审计留痕 → 口播「升级出口 = 人工登记事故」（不实际登记，指给观众看入口）。

**场景 22 · 登记册**：外包商登记 / 修改 / 终止 → RI 换人提单 → 高管批准 → 名册翻新 → 审计链回查（`RI_REPLACEMENT_APPLIED` 携 from/to）。

完整走查步骤见 `demo/script.md`「场景 21」「场景 22」两节；走查截图（真实 self 栈渲染，含账号切换与判据核对）入 `doc-final/superpowers/checkups/2026-09-27-act-a-wave4-evidence/`（`21-01`~`21-06`、`22-01`~`22-04`）。

## 6. 关键技术节点

- 后端模块 `src/modules/governance/compliance-office/`：`compliance-clock-wall.service.ts`（只读聚合）｜ `compliance-obligations.service.ts` + `compliance-obligation-sweep.service.ts`（@Cron 30s）｜ `outsourcing-vendors.service.ts` ｜ `responsible-individuals.service.ts` + `ri-replacement-workflow.service.ts` + `ri-replacement-approval.service.ts` ｜ 挂载 `compliance-office.module.ts`（同域下 governance.module.ts 既有惯例）
- 端点：`GET .../clock-wall`；`compliance-obligations` 五条（list/detail/create/update/status，+⚡ `simulate-due`）；`outsourcing-vendors` 五条（list/detail/create/update/terminate）；`responsible-individuals` 四条（list/detail/create/replacement）；报送单 ⚡ `simulate-deadline-timeout` 挂在 V9 域路由（详见 `modules/v9-regulatory-filing.md`）
- 前端 `admin-web/src/pages/ComplianceClockWallPage.tsx` / `ComplianceObligationListPage.tsx` / `ComplianceRegistersPage.tsx`，侧边栏新组 Compliance Office 三项
- 单号前缀 `OBL`/`VEN`/`RI`（`generateReferenceNo()` 共享工具）；Prisma 新表三张 `compliance_obligations`/`outsourcing_vendors`/`responsible_individuals`，三表互无外键、无横向联动，闹钟墙聚合是唯一跨表读点且只读

## 7. 演示缺口（BACKLOG 有账）

- HRC/HRCA 3 工作日 FIU 不反对窗不上墙（随交易 HOLD 边一起做，`BACKLOG.md`）
- 报送单结构化正文表单（按报文类型细分字段）——现行通用形式（`body` 自由文本 + 外部引用号）不变，待合规同事提需求后按类型追加
- `FILING_OVERDUE_MARKED` 的 `deadlineAt` 仍 `extra`-only 不入 `metadata`（§4 已记账）
- 推送提醒、内幕名单登记册：按裁定判组织件 / 非本波范围，不建
