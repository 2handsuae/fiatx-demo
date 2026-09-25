# V1 · 治理底座（审批 / 审计 / 权限 / 管理员生命周期）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-09-25（战役甲波一：事故登记 §7 四类→十类终盘、结案两链→四链、权限两桶→六桶，见 §7）；此前 2026-09-12（波三红项修复：审计页实体跳转甲案落地 + 幽灵字段清除，见 §5）
> 演示幕次：第一幕「开业」+ 第六幕「账对」（事故登记末段）+ 第七幕「事后说得清」 ｜ 验收：第一幕 + 第七幕走查（`demo/script.md`）+ 本篇 §4；事故登记见第六幕末段 + `modules/v8-recon.md` §4

## 0. 一句话定位

管**平台自己的权力**：权力怎么给（权限包）、敏感事怎么批（maker/checker 审批引擎）、做过的事怎么留痕（只增不改的审计日志）、管理员从入职到停用的一生。不管客户（V2）、不管钱（V4–V6）——但所有后续模块的"操作可信性"全踩在它上面。

## 1. 业务叙事

最重要的一件事：**在这家店里，没有人能独自做成一件敏感的事；也没有一件事做完之后说不清。** 三句话讲完这个模块：

**权力是拼出来的。** 角色不天生有能力，能力来自权限包的组合。包分三个动词：**View 只读、Manage 改配置、Act 动钱动人**——Act 单列、不随 View/Manage 附赠，这是职责分离（SoD）的抓手：看得到资金单 ≠ 推得动资金单。职务层面另有三对硬互斥（CISO⊥MLRO、MLRO⊥运营、CISO⊥运营），保证"安全线"与"动钱线"永远不落在同一个人身上。

**敏感事是批出来的。** 提议的人（maker）和批准的人（checker）必须是两个人；自己批自己，系统当场拒绝——而且这次拒绝本身会留一条审计。谁能批哪一步由审批策略配置（多步骤、每步多角色任一可审）；而"修改审批策略"这件事自己也要过审批——规则不能被规则的管理员悄悄改掉。

**一切是留痕的。** 每个动作一条审计事件，只增、不改、不删；能按人查、按单查、按一段完整旅程查（一次邀请从发起到接受，串成一条链）。被拒绝的动作同样留痕——"默默拦下"在这个系统里是被禁止的。

一个管理员的一生贯穿以上三句：被邀请（邀请本身要审批）→ 首登四步绑定 MFA → 上岗干活（每次 API 调用实时校验权限包）→ 被停用（审批通过后下次请求即失效）→ 恢复（与停用配对的审批）。

## 2. 状态机

| 主体 | 状态流 |
|---|---|
| 审批案 ApprovalCase | `DRAFT → PENDING → APPROVED / REJECTED / EXPIRED / CANCELLED`（多步链，每步多角色任一可审） |
| 管理员 User.status | `PENDING_INVITE_APPROVAL → INVITE_SENT → ACTIVE ⇄ SUSPENDED`（另有 INACTIVE / LOCKED） |
| 首登 firstLoginStatus | `PENDING_IDENTITY_CONFIRM → MFA_BINDING → COMPLETED`（四步绑 MFA） |

## 3. 决策点与角色

| 动作 | 谁发起 | 谁裁决 | SoD 怎么体现 |
|---|---|---|---|
| 邀请新管理员 | 持「成员管理」包 | 审批链（策略配置） | maker≠checker；入职即受治理 |
| 停用 / 恢复管理员 | 持「成员管理」包 | 审批链 | 停用与恢复是配对的两案 |
| 角色定义创建 / 修改 | 持「角色定义」包 | 审批链 | 建角色时硬互斥当场校验 |
| 角色绑定变更 | 持「角色授予」包 | 审批链 | 给人换权力也要过门 |
| 审批策略变更 | 持「审批策略」包 | 审批链 | **自我保护**：改"谁能批"本身要批 |
| 凭证重置（密码 / MFA） | CISO / 技术官 | 审批链，SENIOR_MANAGEMENT_OFFICER 单步（`ADMIN_PASSWORD_RESET`/`ADMIN_MFA_RESET`，非直接执行——2026-08-31 核对代码更正） | 安全 Act 与动钱 Act 不同持 |
| 审计证据包导出 | 持「创建证据包」包 | 审批背书 | 导出失败也留痕 |

通用规则两条：**能看审批列表 ≠ 能批**（全员可见审批中心，能不能批由策略的步骤配置决定）；SUPER_ADMIN 有全权 bypass——**演示用便利，生产必须移除**（PRODUCTION-NOTES 口径，演 SoD 拒绝时换非超管账号）。

## 4. 演示脚本（第一幕 · 开业 ｜ 第七幕 · 追溯）

**第一幕**（管理台 3001，11 职务账号见 demo/data.md ｜ 完整 6 站剧本见 `demo/script.md`）：本模块对应**站 0「进人」**、**站 1「谁能动手」**与**站 3「门自己也要过门」**，此处只补 script.md 未展开的技术细节，不重复整段走查：
- 站 0：`tech_admin@`（技术官，maker）邀请新成员 → `ciso@`（checker）批准 → 新人隐身窗完成身份确认 + 绑 TOTP，首登上岗；停用/恢复换另一对——`ciso@`（maker）提停用/恢复 → `sm@`（checker）批准，停用后新人下次请求即被登出。五步全程没人自批自己那单，第一幕开场即产生第一批审计记录（此前"重铺后需垫一笔治理动作"的缺口自此已解）
- 站 1：`tech_admin@`（技术官）提交角色定义修改（给运营加一个它没有的包）→ `ciso@` 批准 → 生效（角色详情页可见 13 域 66 桶全在场）；`auditor@`（内审）调业务写接口（如跑对账批次 `POST /admin/reconciliation/runs/wallet`）→ 403。⚠️ 内审**并非零写**：它持 `AUDIT_EXPORT_CREATE`（建证据包），那是刻意给的——监管上门他得能打包，且导出仍要 MLRO 背书。演示别拿证据包接口当 403 的例子
- 站 3：`sm@` 提交审批策略变更 → `ciso@` 批准，生效；再用 `ciso@` 自己提、自己批 → 当场被拒（同一账号不能既提又批）；给已持 CISO 的成员加 MLRO → 拒绝（三对硬互斥本轮未动）；`sm@` 再提一张策略变更，换 `treasury@`（11 职务里唯一持 `DEMO_CLOCK_WRITE` 的账号，2026-09-10 对账平账两角色定案后归金库）点 ⚡ 模拟超时 → 一分钟内刷新，状态转 EXPIRED，审计按单号查得到 `APPROVAL_EXPIRED`——批准 / 当场拒绝 / 超时作废三种结局站 3 一次演全

**第七幕**：审计日志页 → 按单号（primarySubjectNo）查站 3 那条 SoD 拒绝与站 1 那笔角色定义修改 → 全链拉出（谁、何时、结果、依据）；按 correlationId 看"一次邀请"的完整旅程——已兑现（2026-09-16 波三）：事件详情页有 `Correlation ID (Journey)` 字段 + `View journey →` 按钮，一键跳转该旅程全部事件，不用手抄 correlationId 去筛选框粘贴。

- **审计两页按后端真实字段重设计**（2026-09-16）：响应补齐组 G/组 H 有货列（fromStatus/toStatus、amount/currency、approvalNo/policyCode、category/actionDomain、before/afterData），摘除全库零值的 workflowType 死派生链；列表页 9 列换血（Domain/Owner/Amount + 人话标签 + 操作人名，摘 Workflow Type/Trace ID 死列），详情页复活状态迁移块与 Owner、新增 Authorization 区（Approval No 蓝链跳审批中心——"谁批的、依据什么"详情页自此答得出）；Payload 三块与 Raw Record 统一过 stripInternalIds、causationId 摘出放行名单（UUID 残口收口）。DEPOSIT_CREATED 审计 currency 由资产 UUID 改落币种码（写入点拆雷）。物证 `superpowers/checkups/2026-09-16-audit-pages-walkthrough/`。

## 5. 关键技术节点（≤30 行）

- 审批引擎 `governance/approvals/`：`approval-handler.base.ts → ApprovalHandlerBase`（30 个审批子流程的统一基类，1 个钦定例外 onboarding 终审）｜ `approvals.service.ts → approve()/reject()`（SoD same-user deny + 跨步骤已审校验）｜ `approval-policy.service.ts → getPolicy()`（stepsConfig 回退链 + 自审防篡改）
- 管理员生命周期 `identity/users/`：`admin-invite-workflow.service.ts` ｜ `mfa-binding-workflow.service.ts → verifyMfaBind()`（首登四步）｜ `admin-{suspension,reactivation,password-reset}-workflow.service.ts` ｜ `jwt.strategy.ts`（SUSPENDED 拦截，下次请求生效）
- 权限 `identity/access-control/`：`rbac.catalog.ts`（165 条路由×权限组登记、**13 域 66 桶**目录、3 对硬互斥、**74 个权限组**——2026-09-25 战役甲波一实测数字，收口时核对更正；较 2026-09-02 四模块治愈那版 12 域 51 桶/59 组，中间跨若干波多次加域加组；本战役开工时（`PermissionGroup` 联合类型核实为 70 组，本行"66 组"这个更早的数字在此之前已经过期、未被中间波次同步，未逐波追溯是哪几波加的）到本战役收官新增 4 个：`INCIDENT_TECH_WRITE`/`INCIDENT_DATA_WRITE`/`INCIDENT_OPS_WRITE`/`INCIDENT_FIN_WRITE`（事故域从"金库独占 FUNDS 族"拆成五族各一个独立经办组，`Incident Register` 域同步从 2 桶扩到 6 桶）；另有 5 个 `cap.incident.*` 族独占能力码是新增的**权限码**、复用既有组（每码单挂一个组，不是新组，不计入这 74 个组数），见 §7）｜ `admin-permission.guard.ts`（每 API 运行时校验）｜ `access-control.service.ts → validateHardMutex()`
- 审计 `audit-logging/`：`audit-logs.service.ts → recordByActor()/recordSystem()/assertActionSpec()`（写入前机器校验）/`persistSubjects()`（五角色子表）｜ `constants/audit-actions.constant.ts`（V1 合同 **102 码**（S30 起始/I62 继承/N10 独立，2026-09-16 波三重数订正），含 V3 财务配置域限额/费率/资产/托管钱包/提现地址/客户标签约 60 写点——随本轮换名册四批一并入册，此前"未入册"缺口已解；退役 **115 码**进拒写闸（2026-09-16 波三重数订正，历史版本号不动；含波二新退役 `CUSTOMER_UPDATED`/`CUSTOMER_DELETED` 2 码）；原撞名嵌套结构 `AuditGovernanceActions` 已全部拆平退役）｜ `audit-evidence-export-workflow.service.ts`（审批背书导出）｜ 校验器 `npm run verify:audit`
- **审计页实体跳转甲案**（2026-09-12 波三红项修复）：`admin-web/src/pages/auditEntityRoutes.ts` 按 `primarySubjectType` 建路由映射表（18 类主体，含不在 `AuditEntityTypes` 常量里但真实落库的 `FUNDS_ORDER`），命中即把审计列表 / 详情页的 `primarySubjectNo` 渲成可点链接；映射缺席的主体类型保留纯文本，不硬造（治理域两类 entityRef 虽已是业务号但唯一详情端点仍按内部 UUID 查询，映射了也是 404）；交易域三单跳转落地到「列表页 + `?keyword=`」，`keyword` 由三张列表页各自的显式单号参数接住预填。**同批清除幽灵字段**：审计 DTO / 服务层的 `entityType`/`entityId`/`entityNo`（2026-08-25 审计表重建后已无列支撑）全部改用真实存在的 `primarySubjectType`/`primarySubjectNo`；确证零调用方的 `AuditModules` 常量随之物理删除
- 通知 `core/notifications/`：仅 WebSocket 推送，email/webhook/retry 为空壳（见 §6）

## 6. 演示缺口（均在 BACKLOG 有账）

- **通知是空壳**：邀请邮件、审批通知不会真发——演示靠页面自查待办，别承诺"你会收到邮件"
- ~~按业务号经子表检索只覆盖 7/101 码~~ **已解（2026-09-16 波三 OR 语义）**：这条限制的前提（子表检索是主表检索的窄子集）已被波三废除——Related No 检索改为「主表 `primarySubjectNo` ∨ 子表 `subjectNo`」，全码覆盖，不再有覆盖不到的码；子表另有自己的五角色名册 47 码（`SUBJECTS_COVERED_ACTIONS`，记录事件涉及的次要主体，与主表检索覆盖率是两回事），第七幕检索按新口径演
- **停用非即时**：下次请求才失效——演示时刷一下页面再看效果
- ADVANCED 8 项未做（Break-Glass、定期权限复审、审批超时预警等），演示不承诺

## 7. 事故登记（平账三期 2026-09-06 立，2026-09-25 战役甲波一扩至十类终盘）

**定位。** 治理件，不是账务件——对账（V8）发现的性质严重的差异，或安全 / 数据 / 外包 / 资产 / 审慎五个非对账触发面的其它情况，先正式登记成一个独立的「事故」，走自己的调查 / 定损 / 通报 / 结案生命周期。**全程零账务**：登记、调查、升级、定损、通报草案与标记已通报、提结案、结案 / 撤回一笔分录都不产生；FUNDS 族真正动钱的两步（认损、补款）挂在既有的调账单（V8 核销通道）与内部划转单（V7）上，事故详情页只「挂载」这两张单的单号做引用，不重复记账；OPERATIONS 族的 `ASSET_NONCOMPLIANCE` 挂载的是资产暂停审批单引用（纯留痕，不越域校验该单存在）；DATA 族的 `DATA_BREACH` 挂载的是客户通知留痕串。

**十类终盘、按族分组**（`incident-type-registry.ts` 注册表是唯一真相；`MANUAL` 已退役、`COMPLAINT_ESCALATION` 未启用为波五占位）：

| 族 FAMILY | 经办组（独占） | 类型 | 定损口径 | 结案善后白名单 |
|---|---|---|---|---|
| FUNDS | `INCIDENT_WRITE`（金库专员） | `UNAUTHORIZED_OUTFLOW`（未授权转出）｜ `LARGE_UNEXPLAINED`（大额长期查不出）｜ `CLIENT_SHORTFALL`（客户欠款） | MONETARY（追回/认损/追索/无损失） | `SUPPLEMENT`/`CLAIM`/`ADJUSTMENT`/`TRANSFER` |
| TECH_SECURITY | `INCIDENT_TECH_WRITE`（技术官） | `CYBER_BCDR`（网安/BCDR）｜ `OUTSOURCING_FAILURE`（外包故障） | IMPACT（服务影响摘要，无金额） | 空集——定损即可直接结案（Ruling-10 乙案） |
| DATA | `INCIDENT_DATA_WRITE`（DPO） | `DATA_BREACH`（个人数据泄露） | IMPACT（数据影响摘要 + 受影响人数） | `CUSTOMER_NOTICE_LOGGED`（客户通知留痕） |
| OPERATIONS | `INCIDENT_OPS_WRITE`（运营） | `ASSET_NONCOMPLIANCE`（资产不合规，职责=立即暂停不是通报）｜ `STUCK_TRANSACTION_MAJOR`（大额卡单） | IMPACT（资产不合规）/ MONETARY（卡单） | `ASSET_SUSPENSION_REF`（资产不合规）/ 空集（卡单，乙案直接结案） |
| FINANCIAL | `INCIDENT_FIN_WRITE`（CFO） | `PRUDENTIAL_BREACH`（审慎/NLA 缺口） | SHORTFALL（缺口金额） | 空集——定损即可直接结案（Ruling-10 乙案） |
| CUSTOMER（未启用） | — | `COMPLAINT_ESCALATION` | — | 波五占位，`enabled:false` 当场 400 |

**状态机。** 五态 + 一旁支，终态零出边（十类共用同一张迁移表，未随族改变）：

| 状态 | 含义 |
|---|---|
| REGISTERED | 已登记，未开始调查 |
| INVESTIGATING | 调查中——加调查记录、升级 MLRO / CFO / 高管 |
| ASSESSED | 已定损——按类型所属口径（MONETARY/IMPACT/SHORTFALL 三档，见上表）填对应字段 + 是否需要监管通报 |
| RESOLVING | 处置中——已挂载至少一张该类型白名单内的善后单 |
| CLOSED | 已结案（终态，走审批） |
| WITHDRAWN | 已撤回（终态，仅限 REGISTERED 态、须填理由，误登记专用出口） |

`ASSESSED` 有两条出边：**乙案**（Ruling-10，2026-09-25 战役甲波一 T8 修）——`assessmentBasis==='NO_LOSS'` 或该类型 `allowedRemediationKinds` 为空集（上表右列「空集」的四类）→ 直接 `CLOSED`（`CLOSE_NO_ACTION`）；否则须先挂至少一张善后单 → `RESOLVING`，收尾再结案。旧版（迁移前）曾把这条边误判成「`assessmentBasis` 字面等于 `NO_LOSS` 才放行」，导致 IMPACT/SHORTFALL 口径四类（无 `NO_LOSS` 取值）永远走不到直接结案，是 T8 修复轮 1 的 Critical 修复。

**审批（结案按性质分四条链，2026-09-25 战役甲波一由两条扩至四条）**：

| 结案链 | 步数 · 裁决人 | 覆盖类型 |
|---|---|---|
| `INCIDENT_CLOSE_SECURITY` | 两步：MLRO → CFO | `UNAUTHORIZED_OUTFLOW` |
| `INCIDENT_CLOSE_FINANCIAL` | 单步：CFO | `LARGE_UNEXPLAINED`/`CLIENT_SHORTFALL`/`STUCK_TRANSACTION_MAJOR` |
| `INCIDENT_CLOSE_TECHSEC` | 单步：CISO（新增） | `CYBER_BCDR`/`OUTSOURCING_FAILURE`/`DATA_BREACH`/`ASSET_NONCOMPLIANCE` |
| `INCIDENT_CLOSE_PRUDENTIAL` | 单步：高管 SENIOR_MANAGEMENT_OFFICER（新增） | `PRUDENTIAL_BREACH` |

每类在注册表里显式点名归属链（`closeActionType` 字段），不再是「未授权转出 vs 其余全部」的二元判断。结案前置两道闸，少一道都是 400：① 定损未完成（`REGISTERED`/`INVESTIGATING`）不许结案；② 判定需要监管通报但尚未标记「已通报」不许结案。开单人（金库/技术官/DPO/运营/CFO 五族经办人）与裁决人（MLRO/CFO/CISO/高管）职务互斥，无自批死锁。

**通报留痕。** 定损时可勾「需要监管通报」，勾了必须选依据条款——目录从三条扩到七条（`hours=null` 代表没有法定钟，界面显式「未设时限」，不杜撰；每码只对它所属类型的 `reportBasisCandidates` 候选集开放，如 `UNAUTHORIZED_OUTFLOW` 只能勾 `CRM_IV_E_5`/`CRM_V_D_2`，勾其它类型的码 400）：

| 依据码 | 依据 | 时限 | 适用族/类型 |
|---|---|---|---|
| `TIR_K_H` | TIR Rulebook Section K + H —— 网安/BCDR 与大额卡单事件报 VARA | 72 小时，从登记时刻起算 | `CYBER_BCDR`/`STUCK_TRANSACTION_MAJOR` |
| `CRM_IV_E_5` | CRM IV.E.5 —— Client Money 重大未平差异 | 未设时限 | FUNDS 三类 |
| `CRM_V_D_2` | CRM V.D.2 —— Client VAs 重大未平差异 | 未设时限 | FUNDS 三类 |
| `PDPL_ART_9` | PDPL（联邦第 45/2021 号法令）第 9 条 —— 个人数据泄露报 UAE 数据办公室 | 未设时限（法条未载明钟） | `DATA_BREACH` |
| `TIR_II_C_24H` | VARA TIR Part II Section C + CRM I.1.4 —— 泄露通知发出后 24 小时内向 VARA 二次上报 | 24 小时，**钟链起点是另一码触发的"通知发出"时刻，不参与本码自身的倒计时计算**（新增机制） | `DATA_BREACH` |
| `COMPANY_IV_H_1` | Company Rulebook IV.H.1 —— 重大外包故障，立即通知 VARA | 即时义务，无小时钟 | `OUTSOURCING_FAILURE` |
| `COMPANY_VI_C_F` | Company Rulebook VI.C / VI.F —— NLA 审慎缺口，立即通知 VARA（每日更新直到 VARA 满意，日历义务留待波四） | 即时义务，无小时钟 | `PRUDENTIAL_BREACH` |

多选依据取时限最短、且非 `chainStart='NOTICE'` 钟链码的一条为倒计时；全部符合条件的码为 null 时倒计时保持 null，不杜撰时限。留痕两步各自独立：先保存通报草案，再填对外编号标记「已通报」——两步都记审计，不能跳过草案直接标已通报。

**登记入口。** 三个对账触发入口不变（均落 FUNDS 族类型）：① 对账案件页「登记事故」——定性行出口 = `INCIDENT`（`UNAUTHORIZED_OUTFLOW`）时出现；② 对账案件页「升级事故」——公司池差异超小额线、账龄到线时出现（`LARGE_UNEXPLAINED`）；③ 对账案件页「登记欠款」——退汇认领后客户余额不足、已走「发起垫款」时出现（`CLIENT_SHORTFALL`）。**第四入口已改版**（2026-09-25 战役甲波一）：事故列表页「Register Incident」不再是不锚案子的自由文本 `MANUAL`（已退役）——改为九个启用类型的下拉，选中类型后表单按注册表 `requiredAnchors` 动态渲染必填锚字段（顶层列 `assetCode`/`customerNo`/`amount` 或 `subjectRefs` 内的类型专属键，如 `affectedSystem`/`vendor`/`dataCategories`），不允许裸标题描述登记。四入口共用同一条生命周期；登记后定性行 / 案件回填事故号可点回跳。

**权限（六桶、五族独占经办组 + 一枚只读组，2026-09-25 战役甲波一从两桶拆至六桶）**：`incidents.view`（`INCIDENT_READ`，只读，MLRO / CFO / 内审 / DPO / 高管 / CISO 持有——CISO 新增，裁决人要看得见事故才能批）；`incidents.manage`（`INCIDENT_WRITE`，FUNDS 族，金库专员独持）；`incidents.manage-tech`（`INCIDENT_TECH_WRITE`，TECH_SECURITY 族，技术官独持）；`incidents.manage-data`（`INCIDENT_DATA_WRITE`，DATA 族，DPO 独持）；`incidents.manage-ops`（`INCIDENT_OPS_WRITE`，OPERATIONS 族，运营独持）；`incidents.manage-fin`（`INCIDENT_FIN_WRITE`，FINANCIAL 族，CFO 独持）。路由层五个写组 OR 放行是粗门（`POST /admin/incidents` 等端点五桶任一持有即可进），真正的族边界在服务层——`IncidentService.assertOperator` 按事故类型的 `operatorMarkerCode`（`cap.incident.{funds,tech,data,ops,fin}` 五枚族独占能力码，`rbac.catalog.ts` 里每码只挂一个组）精确判定，不走「权限码反查所属组」（码被多组共享时会把持有人一并错误抬进所有共享组）；`Incident Register` 域 6 桶，13 域 66 桶。

**关键代码**：`governance/incidents/`：`incident.service.ts`（登记/调查/升级/撤回/善后挂载/经办桶断言）｜ `incident-type-registry.ts`（新增，十类终盘的单一注册表——族/经办组/独占能力码/结案链/通报候选码集/必填锚键/定损口径/善后白名单/启用位，八格一行）｜ `incident-close-workflow.service.ts`（定损后结案，四类型路由，从注册表 `closeActionType` 查链而非硬编码分支）｜ `incidents.controller.ts` ｜ 常量 `incident.constants.ts`（类型键集 / 状态 / 迁移表 / 通报依据目录七条）；对账侧接线 `clearing-settle/reconciliation/disposition/cause-registry.ts`（`UNAUTHORIZED_OUTFLOW` 出口 = `INCIDENT`）+ `disposition.service.ts → attachIncident()`（定性行回填 `incidentNo`）；认损调账事故分支 `disposition/adjustment.service.ts → assertIncidentWriteOffAllowed()`（锁定金额=定损额，免账龄线/小额线，仅 FUNDS 族适用）；审计 11 码不变（`INCIDENT_*`，见 `audit-actions.constant.ts`，十类共用同一份名册，未随扩类新增码位）；前端 `pages/IncidentListPage.tsx`（按类型动态渲染登记表单）/ `IncidentDetailPage.tsx`（定损表单按口径过滤、依据码按候选集过滤、善后下拉按白名单过滤、`Type-Specific Details` 卡片渲染 `subjectRefs`），案件页三入口在 `pages/ReconciliationCasesDetailPage.tsx`。
