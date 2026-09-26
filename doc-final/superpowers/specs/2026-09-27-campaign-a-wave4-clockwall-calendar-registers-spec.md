# 战役甲 · 波四 spec —— 闹钟墙 · 合规日历 · 登记册

> 总纲：`2026-09-25-campaign-a-incident-regulatory-charter.md` §3 波四 ｜ 骨架：`2026-09-26-campaign-a-wave4-skeleton.md`
> 立稿 2026-09-27 ｜ 状态：待业主过目（§9 核对表为重点复核对象）
> 本波不属高危波（零账务、不动既有状态机核心、不动钱）——评审常规档；收尾按 `rules/delivery-checklist.md`

**本任务做**：① 闹钟墙（统一倒计时看板 + ⚡ 快进联动）② 合规日历（周期义务台账 + 到期自动开报送单）③ 两本登记册（外包商 / RI，含 RI 更换事前审批）。
**本任务不做**（对照项目总纲 §2 与本波裁定）：推送提醒 ｜ 内幕名单登记册 ｜ HRC/HRCA 三工作日窗上墙 ｜ 超时自动开事故 ｜ 交易 SLA / 审批过期钟上墙 ｜ 报告正文生成 ｜ NLA 每日核对 ｜ 义务·登记册与其他主体之间的外键联动 ｜ 交易域一切改动。

## §0 脑暴裁定台账（2026-09-26/27，业主已拍板）

| # | 裁定 | 含义 |
|---|---|---|
| 1 | 三本册裁成**两本**（乙案） | 内幕名单改判纯组织件**不建**——总纲 §4 该行随本 spec 订正（波内 27→26、不建 9→10）；RI 册 + 外包商册照做 |
| 2 | 闹钟墙**只看板不推送**（总纲假设④维持） | 通知层死码不复活，推送留给丙战役回接 |
| 3 | 超时后果走**甲案** | sweep 标红 + 审计留痕到此为止；升级成事故由演示者**人工**去事故中心登记（既有能力），不自动开事故、不为「超时」新造事故类型。总纲「超时标红并事件化」的「事件化」按此语义钉死 |
| 4 | RI 换人事前审批 = **合规官提、高管单步批** | 名册维护人提单、任命权在高管；照 `SANCTION_DISPOSITION` 形状注册（单步、timeoutHours 48、allowCancel） |
| 5 | 法定数字走**二手多源交叉 + 业主过目** | 周期义务频率/时限、依据条款全部落 §9 核对表，逐条标置信度，不杜撰；业主非合规出身，一手核对不可得（与波三 HRCA 同款路径、同款风险） |
| 6 | 闹钟墙数据源走**只读聚合端点**（丙案） | 不落新表、不建持久化读模型；现场汇总归一 |
| 7 | 日历 = **义务台账新主体 + 到期开 GENERAL 族报送单** | 重复（每期一单）语义住义务侧，报送单保持一次性——类型目录只加行不动骨架（骨架预警的「重复开单」疑点由此消解） |
| 8 | HRC/HRCA 三工作日 FIU 不反对窗**不上墙** | 窗口到期后的动作（交易 HOLD 放行）在三域细化总纲，光挂倒计时演不圆；随 HOLD 边登 BACKLOG |
| 9 | **墙只收监管义务钟**（范围刀） | 交易 SLA（充/提/兑）与审批过期是运营钟不是法定监管钟，不上墙——墙的叙事是「对监管的死限期」 |
| 10 | **对内周期义务全砍**（乙案，2026-09-27） | 调研坐实 MLRO 季报（对董事会）、EWRA（对内自评）、年费（缴费）收件方均非监管——按总纲 §2 覆盖判据落「纯组织制度不建」侧，与内幕名单同判；当初排给波四是在「以为是对监管申报」的旧假设下，改判有新事实（§9）。`outlet` 拆分随之取消，义务台账只装对外申报三行；MLRO 季报、EWRA 两条总纲 §4 随本 spec 改判 |

## §1 已核代码事实（骨架「spec 开工核对项」完成情况）

1. **事故表时限列已退役**（波二 T6 单槽六列删除，`prisma/schema.prisma` Incident 模型注释在案）→ 闹钟墙数据源**只有两处**：`regulatory_filings.deadlineAt`（波二三现成）＋ 本波新增 `compliance_obligations.nextDueAt`。骨架岔口①设想的「事故/报送两主体各自 deadlineAt」中事故一路已不存在——事故的钟就是它自动开出的 `INCIDENT_REPORT` 报送单的钟。
2. **⚡ 拨钟的真身是逐单快进端点**，不是全局时钟偏移：现有五处（充/提/兑 `simulate-sla-timeout`、对账 `simulate-aging-timeout`、审批 `simulate-timeout`）全部是「把该记录的锚时间回拨到过去，让真实时钟的 sweep 当场咬住」，统一挂 `DEMO_CLOCK_WRITE`（金库持有，Demo Instruments 域既有桶）。本波两条新 ⚡ 照此模式，不新造机制、不加桶。
3. **`computeDeadline` 的 EXTERNAL 锚守卫是 `== null`**（`regulatory-filing.service.ts:172`）——`deadlineBusinessDays: 0` 合法通过；且 `addBusinessDays(from, 0)` 显式注明原样返回 `from`（`business-days.ts`）。→ 周期工单「截止日=到期日」零改动可表达。骨架的开工验证项就地销掉。
4. **报送单 sweep**（`regulatory-filing-sweep.service.ts`）：@Cron 30 秒、`sweep(now)` 逻辑与 @Cron 分离（测试直调不等真钟）、逐笔 try/catch、`recordSystem` 系统留痕、扫描集合 `deadlineAt < now && overdueMarkedAt IS NULL && status ∈ {DRAFT, PENDING_SIGNOFF, SIGNED_OFF}`。义务 sweep 照此模板。
5. **业务单号**走 `generateReferenceNo('FIL')` 共享工具 → 本波新前缀 `OBL` / `VEN` / `RI`。
6. **审批类型注册先例**：`ApprovalActionTypes.SANCTION_DISPOSITION` + 默认策略 `{ steps: [{ stepNo: 1, roles: ['MLRO'] }], timeoutHours: 48, allowCancel: true }`（`approval.constants.ts:82-414`）；落地 workflow 照 `sanction-disposition-workflow.service.ts`（onDecided 监听 + 服务方法落地）。
7. **演示场景编号**接波三：新场景为 21/22（暂编，收官幕编号随波五 `demo/script.md` 定稿）。
8. **调研三发现改写义务名录**（2026-09-27 调研代理，全表见 §9）：① EWRA 不是行业惯例的年度——VARA CRM Rulebook 明文「不超过每 3 个月」（Rule III.D.3/III.D.8）；② MLRO 报告双口径——现行联邦法（Cabinet Resolution 134/2025，2025-12-14 生效）只说 periodic 无固定频率（网上大量「半年报」说法引用的是已废止的 2019 版），VARA CRM Rule III.A.2.f 明文**季度**对董事会——种子取 VARA 口径；③ goAML 注册与 EOCN 订阅**查无周期续期义务**（负面结论，搜索边界见 §9）——不入义务种子，总纲 §3 波四行的「goAML/EOCN 注册位」按证据落空处理。
9. **对内义务出清**（裁定 10）：调研坐实 MLRO 季报、EWRA、年费收件方均非监管，不过总纲覆盖判据——全砍，无 `outlet` 拆分，日历只管对外申报。

## §2 闹钟墙

**端点**：`GET /admin/compliance-office/clock-wall`（只读聚合，无新表）。返回行的归一形状：

```
{ kind: 'FILING' | 'OBLIGATION', refNo, title, authority,
  deadlineAt, overdue: boolean, status, linkKey }
```

**行集判据**（与既有 sweep 口径逐字对齐，不另起判定）：

- FILING 行：`deadlineAt != null && status ∈ {DRAFT, PENDING_SIGNOFF, SIGNED_OFF}`——按时提交即下墙；已被 sweep 标过 `overdueMarkedAt` 的**红着留墙**，直到提交/办结/作废才消。
- OBLIGATION 行：`status = ACTIVE` 的义务全部上墙，按 `nextDueAt` 倒计时。义务行只有绿/黄两色：到期即生成工单并翻期（§3.2），红色由生成的工单行承担。

**颜色三档**：红 = `overdue`（FILING 行专属）；黄 = 剩余 ≤ 总时长 25%（锚与截止均知时）或剩余 ≤ 24h（总长不可知时）；OBLIGATION 行进入生成窗（距 `nextDueAt` ≤ `leadBusinessDays`）即黄。绿 = 其余。**阈值数字是展示参数，不入验收判据**，plan 可调。

**权限**：`COMPLIANCE_OFFICE_VIEW`（§5）。

**⚡ 快进**：`POST /admin/regulatory-filings/:filingNo/simulate-deadline-timeout`——把该单 `deadlineAt` 回拨到过去（仅限墙上行集内状态，终态/已提交单 400），30 秒内被既有 sweep 标红。挂 `DEMO_CLOCK_WRITE`，审计一条（§5 名册）。前端按钮走 `useSimulationMode` 门控（既有惯例）。

零新状态机、零账务；聚合端点只读两张表，不触铁律③。

## §3 合规日历

### 3.1 新主体 ComplianceObligation（表 `compliance_obligations`）

| 列 | 说明 |
|---|---|
| `obligationNo` | `generateReferenceNo('OBL')`，对外业务键（铁律⑥） |
| `name` / `description?` | 义务名（演示用英文，照报送台惯例）/ 补充说明 |
| `frequency` | `MONTHLY \| QUARTERLY \| SEMIANNUAL \| ANNUAL` |
| `authority` | `RegulatoryAuthorities` 既有五家目录取值 |
| `basisNote` | 依据条款自由文本（出处 = §9 核对表，不杜撰；照类型目录 `establishedBy` 的文体） |
| `leadBusinessDays` | 生成提前量（工作日），默认 5 |
| `nextDueAt` | 下一期到期日 |
| `status` | `ACTIVE \| DISABLED`，显式迁移表（铁律④：`ACTIVE→DISABLED`、`DISABLED→ACTIVE` 两边） |
| `lastFilingNo?` | 最近一期生成的工单号（展示用回填） |
| 常规 | `createdByUserId` / `traceId` / 时间戳 |

CRUD：合规官（`OBLIGATION_WRITE`）建 / 改 / 停用 / 复用；全程审计（§5 名册）。无硬删。

### 3.2 到期生成（一期一单，翻期在生成时）

新 `ComplianceObligationSweepService`，照报送单 sweep 模板（@Cron 30 秒、`sweep(now)` 分离、逐笔 try/catch、`recordSystem`）。

- **触发判据**：`status = ACTIVE && addBusinessDays(now, leadBusinessDays) >= nextDueAt`（正推比对，不写反推函数）。
- **编排**（铁律③——sweep 只调两个主体各自的服务方法，不直写对方表）：
  1. `ComplianceObligationsService.claimDue(obligationNo, now)`：自表写——`nextDueAt` 按 `frequency` 翻到下一期（日历月加法 +1/+3/+6/+12 月；落周末不挪，v1 简化，若 §9 核对出「工作日顺延」条款再订正）＋ 审计 `OBLIGATION_FILING_GENERATED`。翻期在生成时完成，**一期一单由构造保证**，无需去重机制（项目总纲 §2 禁做去重，此处也确实不需要）。
  2. `RegulatoryFilingService.openForObligation(...)`（新方法，照 `openForSanction` 形状）：`type = PERIODIC_RETURN`、`anchorAt = 该期 dueAt`（EXTERNAL 锚 → `deadlineAt = dueAt`）、`authority`/`title` 从义务行带出（title 含期别，如 `Quarterly compliance return — 2026 Q4`）、`createdByUserId = 'SYSTEM'`（纯 String 列无外键；审计走 `recordSystem`，与 sweep 先例一致）。
  3. 回填 `lastFilingNo`。
- **工单取消不回拨**：生成的工单被作废，义务不回拨（下一期照走）；该期要补报走 `openManual` 手工开单（EXTERNAL 锚手工路拿不到锚、`deadlineAt` 留 null——与 CNMR/PNMR 手工路先例同款，兜底可用）。

### 3.3 类型目录加一行（11→12，只加行不动骨架）

```
PERIODIC_RETURN: { direction: 'OUTBOUND', label: 'Periodic regulatory return',
  establishedBy: 'Per obligation registry (compliance_obligations.basisNote)',
  defaultAuthority: null, defaultCcAuthorities: [], defaultHours: null,
  requiresIncident: false, enabled: true, family: 'GENERAL',
  anchorKind: 'EXTERNAL', deadlineBusinessDays: 0 }
```

- family=GENERAL → 工单走波二**六态六边全弧原样**：合规官起草 → 高管签发（`REG_FILING_SUBMIT` 既有审批）→ 标已提交 → 办结。定期申报要高管签字，业务上讲得圆，且零新边、零新审批类型。
- `anchorKind='EXTERNAL'` 的语义注释需订正：从「CNMR/PNMR 专用」扩为「workflow/编排方显式外传 anchorAt」（`filing-type-registry.ts` 注释与 `modules/v9-regulatory-filing.md` §2 同步）。
- 完成留痕 = 工单生命周期本身；义务行展示 `lastFilingNo` 及其状态。

**⚡ 快进**：`POST /admin/compliance-obligations/:obligationNo/simulate-due`——把 `nextDueAt` 回拨进生成窗，sweep 30 秒内当场开单。挂 `DEMO_CLOCK_WRITE`，审计一条。

## §4 登记册两本

### 4.1 外包商册 OutsourcingVendor（表 `outsourcing_vendors`）

| 列 | 说明 |
|---|---|
| `vendorNo` | `generateReferenceNo('VEN')` |
| `name` / `serviceDescription` | 供应商名 / 外包内容 |
| `criticality` | `MATERIAL \| NON_MATERIAL`（Material Outsourcing 判定留痕） |
| `contractStart` / `contractEnd?` | 合同期 |
| `status` | `ACTIVE \| TERMINATED`，显式迁移表（`ACTIVE→TERMINATED` 单边，终态零出边） |
| 常规 | `notes?` / `createdByUserId` / `traceId` / 时间戳 |

CRUD：合规官（`VENDOR_REGISTER_WRITE`）登记 / 修改 / 终止，无硬删，全程审计。
与波一「外包商断供」事件的呼应是**纯叙事**（种子含 Sumsub / HexTrust 行，演示口头连线）——不建外键、不建联动（YAGNI；两主体各管各的）。

### 4.2 RI 册 ResponsibleIndividual（表 `responsible_individuals`）

| 列 | 说明 |
|---|---|
| `riNo` | `generateReferenceNo('RI')` |
| `position` | 岗位名（自由文本；种子岗位集见 §7，**演示合理集、非法定名录**，避免杜撰 VARA 岗位清单） |
| `incumbentName` | 现任人姓名（自然人，非系统账号——与 IAM 无外键、无联动，骨架岔口④钉死） |
| `varaRef?` | VARA 备案引用（自由文本） |
| `effectiveFrom` | 现任起始 |
| `pendingApprovalNo?` | 在途换人审批单号（一席一在途：非空时再提 400） |
| `status` | `ACTIVE`（席位常驻，v1 无退席位边——要退再加边，不预铺） |
| 常规 | `createdByUserId` / `traceId` / 时间戳 |

- **建席位**：合规官（`RI_REGISTER_WRITE`）。
- **换人（事前审批，本册唯一流程戏）**：合规官提 `RI_REPLACEMENT` 审批（新任姓名 + 生效日 + 理由 + `varaRef?`）→ 高管单步批 → 新 `ri-replacement-workflow.service.ts`（照 sanction-disposition 先例 onDecided 监听）调服务方法落地：换 `incumbentName`/`effectiveFrom`/`varaRef`、清 `pendingApprovalNo`、审计 `RI_REPLACEMENT_APPLIED`（携 from/to，换人史靠审计链可查，不另建历史表）。驳回/撤单/过期 → 只清 `pendingApprovalNo` + 审计。
- 审批类型注册：`ApprovalActionTypes.RI_REPLACEMENT` + 默认策略 `{ steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }], timeoutHours: 48, allowCancel: true }`；maker≠checker 由审批引擎天然保证。

## §5 权限、审计、RBAC（预期终态数量——改完必须对上，纪律五）

| 计数 | 现值 | 终态 | 增量 |
|---|---|---|---|
| RBAC 域 | 14 | **15** | 新域 `Compliance Office` |
| 桶 | 69 | **73** | 见下四桶 |
| 权限组 | 77 | **81** | `COMPLIANCE_OFFICE_VIEW` / `OBLIGATION_WRITE` / `VENDOR_REGISTER_WRITE` / `RI_REGISTER_WRITE` |
| 报送类型行 | 11 | **12** | `PERIODIC_RETURN` |
| 审批类型 | — | +1 | `RI_REPLACEMENT` |
| Prisma 新表 | — | +3 | obligations / vendors / responsible_individuals |
| 单号前缀 | — | +3 | `OBL` / `VEN` / `RI` |
| 审计现役码 | 273 | 273+N | 名册见下，精确 N 由 plan 钉、`audit:vocab` 入库 |

**新域 `Compliance Office` 四桶**：

| 桶 | 组 | 持有 |
|---|---|---|
| `compliance-office.view`（看闹钟墙 / 日历 / 两册） | `COMPLIANCE_OFFICE_VIEW` | 合规官、MLRO、高管、内审、CISO |
| `compliance-office.obligations`（管周期义务台账） | `OBLIGATION_WRITE` | 合规官独占 |
| `compliance-office.vendors`（管外包商册） | `VENDOR_REGISTER_WRITE` | 合规官独占 |
| `compliance-office.ri`（管 RI 册 + 提换人） | `RI_REGISTER_WRITE` | 合规官独占 |

- **不需要 `cap.*` 服务层族独占**（与波三的差异及理由写明）：波三是「两个经办人共享同一组写路由」才需要服务层按族精确分权；本波三个写面各自单一经办人、路由门即精确门，一组一门，无 OR 粗门。
- 高管新增 `RI_REPLACEMENT` 裁决位（审批策略机制既有、管理台可改）；随本波补持 `COMPLIANCE_OFFICE_VIEW`。
- ⚡ 两条新路由挂 `DEMO_CLOCK_WRITE`（金库，既有 Demo Instruments 桶描述扩一句，不加桶不加组）。
- **审计名册**（domain GOVERNANCE，独立常量组照 filing 先例）：`OBLIGATION_REGISTERED` / `OBLIGATION_UPDATED` / `OBLIGATION_STATUS_CHANGED` / `OBLIGATION_FILING_GENERATED` / `OBLIGATION_DUE_FASTFORWARDED` / `VENDOR_REGISTERED` / `VENDOR_UPDATED` / `VENDOR_TERMINATED` / `RI_SEAT_REGISTERED` / `RI_REPLACEMENT_PROPOSED` / `RI_REPLACEMENT_APPLIED` / `RI_REPLACEMENT_REJECTED` / `FILING_DEADLINE_FASTFORWARDED`（约 13 码；操作必留痕铁律①逐动作对表）。
- `verify:rbac` 扩判据：新域四处齐（route / 桶目录 / 职务绑定）＋ 行为探针（合规官三写面可写、其余职务 403、RI 在途重复提 400、高管可批换人、内审仍零写、⚡ 唯金库）。

## §6 前端（admin-web；client-web 零改动）

- 侧边栏新组 **Compliance Office** 三页：Clock Wall ｜ Compliance Calendar ｜ Registers（外包商 / RI 两 tab）。
- Clock Wall：聚合行表 + 三色标 + 单号/义务号点跳详情；「只看超时」过滤。
- Calendar：义务列表（名 / 频率 / 受文机构 / 下次到期 / 最近工单及状态）+ CRUD 弹窗 + ⚡ simulate-due（`useSimulationMode` 门控）。
- Registers：vendors tab（登记 / 修改 / 终止）；RI tab（席位列表 + 换人提单弹窗 + 在途审批号链接到审批中心）。
- UI 契约照 `rules/frontend-admin.md` 与 `ui-contract/`；不暴露 UUID（铁律⑥）；改完必过闸⑤（preview 渲染 + 截图）。

## §7 种子与演示同步

- `demo/data.md`：**义务种子三行**（全部对外申报，依据与置信度见 §9 核对表）——VARA 月度监管报送（MONTHLY，CRM I.H.1）/ VARA 季度报告（QUARTERLY，CRM I.H.2）/ VARA 年度报告含审计财报（ANNUAL，CRM I.H.3 + I.G.1）。vendors 种子含 Sumsub（合规筛查）、HexTrust（托管）+ 一家非 Material 对照行；RI 席位种子 3–4 行（MLRO / Compliance Officer / CFO / CISO——演示合理集，与种子管理员人设对齐）。波三已有的 PNMR 在途单自带 5 工作日钟 → 闹钟墙开箱非空。
- **场景 21（暂编）· 闹钟墙与合规日历**：看墙（PNMR 钟在跑、三条义务倒计时）→ ⚡ 义务快进 → 工单当场出现在墙上与报送台 → 合规官起草送签 → 高管签发 → 标已提交 → 义务翻期；再 ⚡ 报送单超时 → 墙上变红 + 审计留痕 → 口播「升级出口 = 人工登记事故」（不实际登记，指给观众看入口）。
- **场景 22（暂编）· 登记册**：外包商册登记/修改 → RI 换人提单 → 高管批准 → 名册翻新 → 审计链回查（`RI_REPLACEMENT_APPLIED` 携 from/to）。
- `demo/script.md` 补两场景；`demo/baseline.md` 重铺判据补三张新表的种子断言。

## §8 验收判据（可执行口径）

1. **⚡ 报送单快进** → 30 秒内 `overdueMarkedAt` 落值 + `FILING_OVERDUE_MARKED` 审计 + 墙上该行 `overdue=true`（e2e + 走查截图）。
2. **⚡ 义务快进** → sweep 开单（`type=PERIODIC_RETURN`、`deadlineAt = 该期 dueAt`、authority/title 从义务行带出）→ 六态全弧办结 → 义务 `nextDueAt` 已翻下一期、`lastFilingNo` 回填（e2e 全链）。
3. **两册**：CRUD 留痕逐动作有审计码；RI 换人审批全弧（提→批→落地）+ 驳回分支 + 在途重复提 400 + 跨职务 403 矩阵（e2e）。
4. **闸门**：三 tsc + jest 相关目录全绿；`verify:rbac` 全绿（含新探针）；`audit:vocab` 词表入库；收尾闸⑥⑧（动了 schema/seed → 重铺闸必跑）；场景 21/22 preview 走查 + 截图落盘。
5. 收尾对照 `rules/delivery-checklist.md` 逐条过（含 `modules/` 新增/修订篇目：v9 补 §（日历与 PERIODIC_RETURN）、新 `modules/` 小节或独立篇装两册与闹钟墙，plan 定；`CHANGELOG.md` 一行；总纲 §4 销账行订正）。

## §9 周期义务法定数字核对表（二手多源交叉，待业主过目拍板）

> 铁律「不杜撰」：下表每行给出频率 / 时限 / 依据 / 来源 / 置信度；业主过目替代一手核对（裁定 5）。调研全文（含逐条原文引述与推理）存 `doc-final/superpowers/checkups/2026-09-27-act-a-wave4-vara-obligations-research.md`。**调研日期 2026-09-27，走 rulebooks.vara.ae 官方全文页逐条直读 + 律所/咨询二手源交叉。**

| # | 义务 | 频率 | 截止时限 | 条款依据 | 置信度 | 种子落法 |
|---|---|---|---|---|---|---|
| 1 | VARA 定期监管报送（月/季/年三层） | 月＋季＋年 | Rulebook **未规定**「期末后 X 天」——只定频率 | CRM Rulebook（2025-06-19 生效）Part I，Rule I.H.1（月）/ I.H.2（季）/ I.H.3（年） | 高（频率一手原文）；截止天数未找到 | 三行 `FILING`；`deadlineAt = 期末日`（无天数条款，不杜撰宽限） |
| 2 | 年度审计财务报表 | 年度 | 未规定 N 个月内；网传「6 个月」经核实是 Reserve Assets 每 6 个月审计（Company Rulebook VI.E.3）的混淆 | CRM Rule I.G.1 ＋ I.H.3.a | 高（频率）；天数未找到 | 并入年度报告行（I.H.3 提交清单含审计财报），不另立行 |
| 3 | MLRO 定期报告 | **VARA=季度（对董事会）**；现行联邦法仅 periodic 无固定频率 | 仅 quarterly，无天数 | VARA CRM Rule III.A.2.f；联邦 Cabinet Resolution 134/2025 Art.22（2025-12-14 生效，废止 10/2019——旧版才是「半年」，网上大量文章引用已废止版本） | 高（两条均一手直读） | **不入种子**——收件方为董事会，按总纲覆盖判据改判组织件不建（裁定 10），总纲 §4 已订正 |
| 4 | EWRA（机构 ML/TF 风险自评） | **不超过每 3 个月**（VARA 口径）；联邦法仅 ongoing | 无天数 | VARA CRM Rule III.D.1-3 / III.D.6-8；联邦 134/2025 Art.5 | 高（一手原文＋独立二手源 webacy.com 一致） | **不入种子**——对内自评，同裁定 10 改判组织件不建（「EWRA 年度」的行业惯例假设同时被推翻，留档备查） |
| 5 | goAML 注册续期 | **查无周期续期义务**——仅合规官变更/执照续期时更新登记 | 不适用 | 无正面条款（负面结论；一手指南 PDF 404 未能核验，两独立二手源一致） | 中 | **不入种子**；搜索边界：goAML registration renewal / expire / annual renewal UAE |
| 6 | EOCN 名单订阅/注册位 | 一次性订阅，查无周期续订；真正的持续义务是名单实时监控（CRM III.C.2，非周期申报） | 不适用 | EOCN 官方 FAQ（uaeiec.gov.ae，单一来源，未达双源标准） | 中 | **不入种子**；总纲 §3 波四行「goAML/EOCN 注册位」按证据落空处理 |
| 7 | VARA 牌照年费 | 年度 Annual Supervision Fee；Broker-Dealer 档 AED 200,000/年 | 原文只说 in advance，无精确到期窗口；一手条文无「牌照每年到期续期」说法（与二手指南冲突，已如实标注） | Regulations 2023 Part IV.B.4 ＋ Schedule 2 | 高（费率与年度频率一手）；提前量未找到 | **不入种子**——缴费义务非报送，且不在总纲 36 条底账内（裁定 10） |

**对种子的净效果**：三行义务，全部对外申报（§7）；MLRO 季报 / EWRA / 年费按裁定 10 出清、goAML/EOCN 两项以负面结论出清；所有「截止天数未找到」的行一律 `deadlineAt = 期末日`、`basisNote` 只写查实的条款号，不补想象中的宽限天数。

## §10 展开边界备忘

- 义务频率步进用日历月加法，落周末不挪（v1 简化，§9 若核出「工作日顺延」条款再订正，订正属加行级改动）。
- RI 席位岗位名录是演示集不是法定清单（表述已在 §4.2 钉死），不因 §9 调研结果反推改动。
- 两册与义务台账均无横向外键——查询聚合（闹钟墙）是唯一跨表读点，且只读。
- **报文正文的通用形式已定，不在本波扩展**：台账形式 = 报送单主体（单号 / 类型 / 机构 / 依据 / 钟 / `body` 自由文本快照 / 外部引用号 / 回执往来）——波二既定，所有材料共用；各报文的结构化字段表单等合规同事提需求后按类型追加（登 BACKLOG）。
- 波五骨架收尾时立（含投诉对撞点提示：外来包「escalate 走系统外文案」vs 总纲「升级=转事件」）。
