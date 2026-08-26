# V1 · 治理底座（审批 / 审计 / 权限 / 管理员生命周期）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-08-26（底稿 truth 2026-08-25 端到端验收 + 批次二核查员复核审计锚点）
> 演示幕次：第一幕「开业」+ 第七幕「事后说得清」 ｜ 验收用例：TC-09（RBAC）

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
| 凭证重置（密码 / MFA） | CISO / 技术官 | 直接执行（凭证包） | 安全 Act 与动钱 Act 不同持 |
| 审计证据包导出 | 持「创建证据包」包 | 审批背书 | 导出失败也留痕 |

通用规则两条：**能看审批列表 ≠ 能批**（全员可见审批中心，能不能批由策略的步骤配置决定）；SUPER_ADMIN 有全权 bypass——**演示用便利，生产必须移除**（PRODUCTION-NOTES 口径，演 SoD 拒绝时换非超管账号）。

## 4. 演示脚本（第一幕 · 开业 ｜ 第七幕 · 追溯）

**第一幕**（管理台 3001，8 职务账号见 demo/data.md）：
1. IAM 页看成员与角色 → 点开一个角色看它由哪些**权限包**拼成（对应 TC-RBA-012/019）
2. 现场走一笔 maker/checker：ops_officer 提一条费率变更 → 审批中心出现待办 → **换 checker 账号**登录批准 → 生效
3. 演 SoD 拒绝：用同一账号自批 → 当场被拒（对应 TC-RBA-006；注意用非超管账号）
4. 演硬互斥：给已持 CISO 的成员加 MLRO → 拒绝（TC-RBA-015~017）
5. 演权限边界：仅持 View 包的角色调写接口 → 403（TC-RBA-002/007）

**第七幕**：审计日志页 → 按单号（primarySubjectNo）查第 3 步那条 SoD 拒绝与第 2 步那笔变更 → 全链拉出（谁、何时、结果、依据）；按 correlationId 看"一次邀请"的完整旅程。⚠️ 重铺后先在第一幕做一笔治理动作垫场，否则新词表下无记录（BACKLOG 在案）。

## 5. 关键技术节点（≤30 行）

- 审批引擎 `governance/approvals/`：`approval-handler.base.ts → ApprovalHandlerBase`（30 个审批子流程的统一基类，1 个钦定例外 onboarding 终审）｜ `approvals.service.ts → approve()/reject()`（SoD same-user deny + 跨步骤已审校验）｜ `approval-policy.service.ts → getPolicy()`（stepsConfig 回退链 + 自审防篡改）
- 管理员生命周期 `identity/users/`：`admin-invite-workflow.service.ts` ｜ `mfa-binding-workflow.service.ts → verifyMfaBind()`（首登四步）｜ `admin-{suspension,reactivation,password-reset}-workflow.service.ts` ｜ `jwt.strategy.ts`（SUSPENDED 拦截，下次请求生效）
- 权限 `identity/access-control/`：`rbac.catalog.ts`（150+ 路由×权限包登记、9 域 23 桶目录、3 对硬互斥）｜ `admin-permission.guard.ts`（每 API 运行时校验）｜ `access-control.service.ts → validateHardMutex()`
- 审计 `audit-logging/`：`audit-logs.service.ts → recordByActor()/recordSystem()/assertActionSpec()`（写入前机器校验）/`persistSubjects()`（五角色子表）｜ `constants/audit-actions.constant.ts`（V1 词表 45 live + 11 退役拒写）｜ `audit-evidence-export-workflow.service.ts`（审批背书导出）｜ 校验器 `npm run verify:audit`
- 通知 `core/notifications/`：仅 WebSocket 推送，email/webhook/retry 为空壳（见 §6）

## 6. 演示缺口（均在 BACKLOG 有账）

- **通知是空壳**：邀请邮件、审批通知不会真发——演示靠页面自查待办，别承诺"你会收到邮件"
- **按业务号经子表检索只覆盖 7/45 码**：其余 38 码要用 primarySubjectNo 精确过滤才查得到——第七幕检索按此口径演
- **重铺后新词表零写入**：demo 造数不含治理动作，第七幕开演前先垫一笔（批次三实测）
- **三域交易日志仍旧合同**：跨域旅程链断在交易域，完整追溯待审计第二批
- **停用非即时**：下次请求才失效——演示时刷一下页面再看效果
- **审批与审计没有专属验收用例**：test-cases 里 V1 只有 TC-09（RBAC）一份，审批流/审计检索的用例缺位（2026-08-26 新发现，已登记 BACKLOG）
- ADVANCED 8 项未做（Break-Glass、定期权限复审、审批超时预警等），演示不承诺
