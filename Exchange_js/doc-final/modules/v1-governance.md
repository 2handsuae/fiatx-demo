# V1 · 治理底座（审批 / 审计 / 权限 / 管理员生命周期）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-09-06（平账三期：事故登记落地，见 §7）
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
- 站 1：`tech_admin@`（技术官）提交角色定义修改（给运营加一个它没有的包）→ `ciso@` 批准 → 生效（角色详情页可见 13 域 58 桶全在场）；`auditor@`（内审）调业务写接口（如跑对账批次 `POST /admin/reconciliation/runs/wallet`）→ 403。⚠️ 内审**并非零写**：它持 `AUDIT_EXPORT_CREATE`（建证据包），那是刻意给的——监管上门他得能打包，且导出仍要 MLRO 背书。演示别拿证据包接口当 403 的例子
- 站 3：`sm@` 提交审批策略变更 → `ciso@` 批准，生效；再用 `ciso@` 自己提、自己批 → 当场被拒（同一账号不能既提又批）；给已持 CISO 的成员加 MLRO → 拒绝（三对硬互斥本轮未动）；`sm@` 再提一张策略变更，换 `treasury@`（11 职务里唯一持 `DEMO_CLOCK_WRITE` 的账号，2026-09-10 对账平账两角色定案后归金库）点 ⚡ 模拟超时 → 一分钟内刷新，状态转 EXPIRED，审计按单号查得到 `APPROVAL_EXPIRED`——批准 / 当场拒绝 / 超时作废三种结局站 3 一次演全

**第七幕**：审计日志页 → 按单号（primarySubjectNo）查站 3 那条 SoD 拒绝与站 1 那笔角色定义修改 → 全链拉出（谁、何时、结果、依据）；按 correlationId 看"一次邀请"的完整旅程。

## 5. 关键技术节点（≤30 行）

- 审批引擎 `governance/approvals/`：`approval-handler.base.ts → ApprovalHandlerBase`（30 个审批子流程的统一基类，1 个钦定例外 onboarding 终审）｜ `approvals.service.ts → approve()/reject()`（SoD same-user deny + 跨步骤已审校验）｜ `approval-policy.service.ts → getPolicy()`（stepsConfig 回退链 + 自审防篡改）
- 管理员生命周期 `identity/users/`：`admin-invite-workflow.service.ts` ｜ `mfa-binding-workflow.service.ts → verifyMfaBind()`（首登四步）｜ `admin-{suspension,reactivation,password-reset}-workflow.service.ts` ｜ `jwt.strategy.ts`（SUSPENDED 拦截，下次请求生效）
- 权限 `identity/access-control/`：`rbac.catalog.ts`（165 条路由×权限组登记、**13 域 58 桶**目录、3 对硬互斥、**66 个权限组**——2026-09-06 平账三期实测数字，收口时核对更正；较 2026-09-02 四模块治愈那版 12 域 51 桶/59 组，中间跨若干波多次加域加组，本轮新增 `Incident Register` 域 2 桶 + `INCIDENT_READ`/`INCIDENT_WRITE` 2 组是最后一次变动）｜ `admin-permission.guard.ts`（每 API 运行时校验）｜ `access-control.service.ts → validateHardMutex()`
- 审计 `audit-logging/`：`audit-logs.service.ts → recordByActor()/recordSystem()/assertActionSpec()`（写入前机器校验）/`persistSubjects()`（五角色子表）｜ `constants/audit-actions.constant.ts`（V1 合同 **101 码**（S26 起始/I65 继承/N10 独立），含 V3 财务配置域限额/费率/资产/托管钱包/提现地址/客户标签约 60 写点——随本轮换名册四批一并入册，此前"未入册"缺口已解；退役 **97 码**进拒写闸——2026-09-02 收官实测；原撞名嵌套结构 `AuditGovernanceActions` 已全部拆平退役）｜ `audit-evidence-export-workflow.service.ts`（审批背书导出）｜ 校验器 `npm run verify:audit`
- 通知 `core/notifications/`：仅 WebSocket 推送，email/webhook/retry 为空壳（见 §6）

## 6. 演示缺口（均在 BACKLOG 有账）

- **通知是空壳**：邀请邮件、审批通知不会真发——演示靠页面自查待办，别承诺"你会收到邮件"
- **按业务号经子表检索只覆盖 7/101 码**：其余 94 码要用 primarySubjectNo 精确过滤才查得到——第七幕检索按此口径演。（分母随 2026-09-02 换名册四批收官从 48→101 更新；分子 7 未变——BACKLOG §H 记的那 7 码是 6 个 `APPROVAL_*` 加 `AUDIT_LOG_QUERIED`，退役码不计入分母）
- **停用非即时**：下次请求才失效——演示时刷一下页面再看效果
- ADVANCED 8 项未做（Break-Glass、定期权限复审、审批超时预警等），演示不承诺

## 7. 事故登记（平账三期，2026-09-06）

**定位。** 治理件，不是账务件——对账（V8）发现的性质严重的差异（未经授权的资金转出、大额长期查不出、客户欠款收不回来），或人工发现的其它情况，先正式登记成一个独立的「事故」，走自己的调查 / 定损 / 通报 / 结案生命周期。**全程零账务**：登记、调查、升级、定损、通报草案与标记已通报、提结案、结案 / 撤回一笔分录都不产生；真正动钱的两步（认损、补款）挂在既有的调账单（V8 核销通道）与内部划转单（V7）上，事故详情页只「挂载」这两张单的单号做引用，不重复记账。四类登记：`UNAUTHORIZED_OUTFLOW`（未授权转出）｜ `LARGE_UNEXPLAINED`（大额长期查不出）｜ `CLIENT_SHORTFALL`（客户欠款）｜ `MANUAL`（人工登记，不锚任何案子）。

**状态机。** 五态 + 一旁支，终态零出边：

| 状态 | 含义 |
|---|---|
| REGISTERED | 已登记，未开始调查 |
| INVESTIGATING | 调查中——加调查记录、升级 MLRO / CFO / 高管 |
| ASSESSED | 已定损——金额 + 口径（追回 / 认损 / 追索（客户欠公司，只登记不入账） / 无损失）+ 是否需要监管通报 |
| RESOLVING | 处置中——已挂载至少一张善后单（调账单 / 划转单） |
| CLOSED | 已结案（终态，走审批） |
| WITHDRAWN | 已撤回（终态，仅限 REGISTERED 态、须填理由，误登记专用出口） |

`ASSESSED` 有两条出边：挂了善后单 → `RESOLVING`；无损失且零善后单 → 直接 `CLOSED`（`CLOSE_NO_ACTION`，走财务类单步审批而不是走完整处置链）。

**审批（结案按性质分两条链）。** `UNAUTHORIZED_OUTFLOW` 走 `INCIDENT_CLOSE_SECURITY`——两步 MLRO→CFO，安全性质事件双人高层背书；其余三类走 `INCIDENT_CLOSE_FINANCIAL`——单步 CFO，同调账单 / 内部划转单同一裁决人。结案前置两道闸，少一道都是 400：① 定损未完成（`REGISTERED`/`INVESTIGATING`）不许结案；② 判定需要监管通报但尚未标记「已通报」不许结案。

**通报留痕。** 定损时可勾「需要监管通报」，勾了必须选依据条款——目录固定三条（`hours=null` 代表没有法定钟，界面显式「未设时限」，不杜撰）：

| 依据码 | 依据 | 时限 |
|---|---|---|
| `TIR_K_H` | TIR Rulebook Section K + H —— 网安 / BCDR 事件报 VARA | 72 小时，**从登记时刻起算** |
| `CRM_IV_E_5` | CRM IV.E.5 —— Client Money 重大未平差异 | 未设时限 |
| `CRM_V_D_2` | CRM V.D.2 —— Client VAs 重大未平差异 | 未设时限 |

多选依据取时限最短的一条为倒计时。留痕两步各自独立：先保存通报草案，再填对外编号标记「已通报」——两步都记审计，不能跳过草案直接标已通报。

**四入口。** ① 对账案件页「登记事故」——定性行出口 = `INCIDENT`（未授权转出）时出现；② 对账案件页「升级事故」——公司池差异超小额线、账龄到线时出现（`LARGE_UNEXPLAINED`）；③ 对账案件页「登记欠款」——退汇认领后客户余额不足、已走「发起垫款」时出现（`CLIENT_SHORTFALL`）；④ 事故列表页「登记事故」——人工登记（`MANUAL`），不锚任何案子。四个入口共用同一套登记表单、同一条生命周期；登记后定性行 / 案件回填事故号可点回跳。

**权限。** 两枚权限组：`INCIDENT_READ`（只读，MLRO / CFO / 内审 / DPO / 高管持有）、`INCIDENT_WRITE`（登记 + 全部动作，2026-09-10 对账平账两角色定案起金库专员独持，运营清零）；`Incident Register` 域两桶（查看 / 登记与处置），13 域 58 桶（较三期前 12 域 56 桶新增本域）。

**关键代码**：`governance/incidents/`：`incident.service.ts`（登记/调查/升级/撤回/善后挂载）｜ `incident-close-workflow.service.ts`（定损后结案，双类型路由）｜ `incidents.controller.ts`（12 端点）｜ 常量 `incident.constants.ts`（类型 / 状态 / 迁移表 / 通报依据目录）；对账侧接线 `clearing-settle/reconciliation/disposition/cause-registry.ts`（`UNAUTHORIZED_OUTFLOW` 出口 = `INCIDENT`）+ `disposition.service.ts → attachIncident()`（定性行回填 `incidentNo`）；认损调账事故分支 `disposition/adjustment.service.ts → assertIncidentWriteOffAllowed()`（锁定金额=定损额，免账龄线/小额线）；审计 11 码（`INCIDENT_*`，见 `audit-actions.constant.ts`）；前端 `pages/IncidentListPage.tsx` / `IncidentDetailPage.tsx`，案件页三入口在 `pages/ReconciliationCasesDetailPage.tsx`。
