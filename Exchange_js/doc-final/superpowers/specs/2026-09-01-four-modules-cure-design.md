# 四模块治愈 · 设计稿（角色 / 权限 / admin 管理 / 审批单）

> 2026-09-01 ｜ 底料：同日完成的 4×9 体检（四个并行探查 + 浏览器全页走查，全部红项已在原位复核）
> 目标锚点：⑩ 演得出来 ← ①–⑨ 系统属性 ← ⑪ 判据可信
> 路线：**乙 · 先立法后治病**——先立三部法 + 一个底座，再把四模块迁上来，死物整批退役，每族收口配机器判据

## 0. 业主已拍板的六个决定（本设计的前提，不再翻案）

| # | 岔口 | 裁决 |
|---|---|---|
| 1 | 治疗路线 | 乙 · 先立法后治病 |
| 2 | 管理员的一生 | **进剧本**——第一幕新增站 0 |
| 3 | 403 越权拒绝 | **记审计**（守卫单点） |
| 4 | 审计子表 | **留并接上**——审计页加「关联单号」筛选 |
| 5 | 9 个游离端点 | **收编**（初判挂账，业主改判收编） |
| 6 | 审批超时门 | 接 @Cron（上一轮已拍板，并入底座） |

关系说明：已存在的《2026-09-01-act1-system-properties》计划整体并入本设计——超时门=底座、45 审计裸词=法一外延、UUID 路由=法三、资产迁移表=法二、verify:act1=判据收口。实施计划将按本设计重出，旧计划作废归档。

## 1. 本任务做 / 不做

**做**：三部法（留痕纪律 / 迁移表 / 业务键）及其在四模块的迁移；两个 @Cron + 两个 ⚡；9 端点收编；死物退役清单；剧本扩写（站 0 + 站 3 第三结局 + 第七幕两件新展品）；判据收口（verify:rbac 扩 2 静态、verify:act1 扩到约 15 条行为判据）。

**不做**（对照总纲 §2）：幂等、去重、重试回放、补偿 repair、并发锁、兼容层与 backfill（schema/状态值变化直接按终态做，reset 重铺）、输入防御校验、性能优化。**特别澄清两条边界**：① 收编 9 端点不是「管理 API 权限加固」——是让权限字典说真话 + 保住「内审零 Act」台词，属流程一致性；② 审批超时 @Cron 不是「重试回放」——是业务规则（单子会过期），机器早已建成只缺触发器。

## 2. 法一 · 留痕纪律（治病族 1）

四条纪律，全模块通用；每条都有已实证的病灶做靶子。

**纪律 1：每笔审计写入必带唯一请求号。**
去重钥匙 = sha256(域|码|主体类型|主体号|旅程号|请求号)。不带请求号的两次动作拼出同一把钥匙，第二次被静默丢弃——这就是「两票批准只留一票」的成因（`approvals.service.ts:743` 实证，DEPOSIT_SEIZE 的 MLRO 终票在审计里不存在）。
改法：`approve()` / `reject()` / SOD_DENIED / APPROVAL_REQUIRED_MISSING 等所有「同一主体可重复发生」的写入点补 `requestId: randomUUID()`（仓内已有先例 `requestChange:184`）。语义变化：反复被拒每次一行（此前刻意只留一条的 APPROVAL_REQUIRED_MISSING 一并改，「每个动作一条记录」优先）。

**纪律 2：失败必带机器原因码。**
合同闸门已强制（`audit-logs.service.ts:920`），但三处失败分支违规（只带人读 reason 不带 reasonCode）→ 运行时被闸门拒收 → 状态已变、痕迹为零：
- 角色创建落地失败 `role-definition-create-workflow.service.ts:263-278`
- 角色修改落地失败 `role-definition-modify-workflow.service.ts:426-442`
- 绑定变更落地失败 `admin-role-binding-change-workflow.service.ts:259-286`
改法：三处补 reasonCode（机器码，如 `EXECUTION_FAILED` / `ROLE_CONFLICT`），错误分类各自就地定。

**纪律 3：留痕失败即流程失败。**
对齐既有铁律「记账失败即流程失败」。拆除审计写入上的全部 `.catch(() => undefined)`（实证清单）：
`admin-role-binding-change-workflow.service.ts:337`｜`admin-invite-workflow.service.ts:288/:399`｜`mfa-binding-workflow.service.ts:306/:366/:556`｜`admin-password-reset-workflow.service.ts:435`。
同族非审计吞错一并拆：`users.domain.service.ts:113` 的 `physicalDelete` 吞删除错误（吞掉即残留 `PENDING_INVITE_APPROVAL` 幽灵账号，该 email 永远发不出第二张邀请）。
行为变化知会：mfa 锁定路径原注释主张「审计问题不能盖过锁定生效」，本法推翻之——锁定生效但审计失败 = 整个动作失败回滚。

**纪律 4：拒绝也留痕。**
v1 叙事已承诺「被拒绝的动作同样留痕」，SoD 拒绝早就在写（APPROVAL_SOD_DENIED），唯独权限守卫 403 静默（`admin-permission.guard.ts` 108 行零审计）。
改法：守卫单点新增合同码 **`ADMIN_ACCESS_DENIED`**（domain `IAM`，correlationMode N，requiredFields []；写入时 outcome=DENIED + reasonCode=`MISSING_PERMISSION`，primarySubjectType=ACCESS_CONTROL，primarySubjectNo=被拒端点的权限码，actor 五件套照常）。第七幕按 actorNo 查内审的越权尝试即中。

**法一附属修缮**（同族小病顺手治）：
- 接受邀请失败的审计补 primarySubjectNo（token 可解析则用目标 userNo，不可解析用提交的 email）+ actorNo 不再写死 `'UNKNOWN'`（`admin-invite-workflow.service.ts:381-397`）
- 重发邀请补留痕：复用 `ADMIN_INVITE_DISPATCHED`（INHERIT 同旅程，requestId 区分首发/重发；代码注释自认的缺口 `admin-invitations.service.ts:249-258`）
- 登录自动解锁补留痕：复用 `ADMIN_ACCOUNT_LOCK_RELEASED`，correlationId 用「回查该用户最近一条 LOCK_APPLIED 事件」取得（`findLatestInvitationAuditContext` 同款既有模式）
- 角色域审计主体号同轴：三条角色流一律 primarySubjectNo=申请单号，roleCode 走子表 RELATED——配合决定 4，按角色码与按申请单号两个轴都能查
- 超管代批的代行痕迹补全：凡超管裁决即打 `superAdminBypass` 标（现仅自批打标，`approvals.service.ts:759-762`），metadata 记实际身份与代行角色

**上一轮已立案的 45 条裸词换名册**（站 2/4/5 的费率/资产/限额/钱包/地址/标签，31 新码进合同 + 旧裸名退役）整体并入法一，施工细目沿用旧计划 Task 3–7 的对照表。

## 3. 法二 · 迁移表模板（治病族 2）

范本 = 审批单模块（写点全集中单服务 + 每写点带 from-status 守卫 + updateMany 全部 status 过滤，体检判绿）。三个主体迁上来：

**管理员**（`User.status` + `firstLoginStatus`）：
- 新建 `user-status-transitions.constant.ts`：
  `PENDING_INVITE_APPROVAL --INVITE_APPROVE--> INVITE_SENT --ACCEPT--> ACTIVE --SUSPEND--> SUSPENDED --REACTIVATE--> ACTIVE`；`ACTIVE --LOCK--> LOCKED --UNLOCK--> ACTIVE`；邀请被拒 = 物理删除（无状态边，删除失败必须报错，见法一纪律 3）；`INACTIVE` 值全仓零写入方，不进迁移表、随重铺自然消亡
  首登：`PENDING_IDENTITY_CONFIRM --CONFIRM--> MFA_BINDING --BIND--> COMPLETED`；MFA 重置 `COMPLETED --RESET--> PENDING_IDENTITY_CONFIRM`
- **废除敞口**：`users.domain.service.ts:93-109` `updateStatus(任意值)` 改为 `applyUserTransition(userId, action)`（查现状→断言迁移表→写目标态）；`users.service.ts:265` 通用 `update()` 剥除 status 字段直通（锁定/解锁改走域方法）；死方法 `completeFirstLogin` 删除
- 非法跃迁抛 409 `Invalid transition`

**三张角色申请单**（创建 / 修改 / 绑定变更）：
- 状态值统一为 `{PENDING_APPROVAL, APPROVED, REJECTED, CANCELLED, EXPIRED, FAILED}`，共用一张迁移表常量
- **修错边**：修改流驳回分支比对值 `'REJECTED'` 改 `'DECLINED'`（handler 发的信号是 DECLINED，`approval-handler.base.ts:73`；比对错值导致 REJECTED 永不可达、驳回恒记 CANCELLED，`role-definition-modify-workflow.service.ts:465`——绑定流的正确映射照抄）
- **拆并态**：修改流落地失败从 `APPROVED+failureReason` 改为独立 `FAILED` 态（对齐绑定流既有做法）；创建流取消的裸 delete 补 from-status 守卫（仅 PENDING_APPROVAL 可取消）
- SQLite status 是字符串列，无 schema 迁移；数据重铺（总纲 §3）

**资产**（沿用旧计划 Task 10 原文）：`PROVISIONING --ACTIVATE--> ACTIVE --SUSPEND--> SUSPENDED --REACTIVATE--> ACTIVE`，三处散落 if 改走表。

审批单不动（已达标，当范本）。

## 4. 法三 · 业务键约定（治病族 3）

**约定**：URL、页面展示、检索输入一律业务号；内部关联（外键、事件载荷）继续用 id。逐处清单：

| 位置 | 现状 | 改成 |
|---|---|---|
| 审批详情端点 + URL | `:id`（UUID） | `:approvalNo`（approve/reject/cancel/detail 四端点 + 前端两处路由 + 列表跳转，沿旧计划 Task 8） |
| 成员详情端点 + URL | `/users/:id`、`/admin/iam/members/:id` | `:userNo`（浏览器实测地址栏 UUID） |
| 钱包详情端点 + URL | `/wallets/:id` | `:walletNo`（沿旧计划 Task 9，含 `ownerUuid`→`ownerNo` 跳转） |
| 角色申请单 | 前端路由 request.id、筛选框要求手输 UUID、目标人兜底展示 UUID 前 8 位 | 路由 `:requestNo`、筛选改「目标人 userNo」、兜底展示去除 |
| 审批 entityRef | 30 建单点中 28 个存 UUID | 全部改业务号（withdrawNo/depositNo/assetNo/userNo/levelCode/ruleNo/walletNo/packageNo/requestNo；restrictionNo、adjustmentNo 已达标） |
| 审批详情页正文 | ENTITY REF / TRACE ID 裸 UUID 上屏、Maker 兜底 UUID | entityRef 显示业务号并**按 actionType 映射成可点回链**；TRACE ID 收进折叠的技术区；Maker 兜底删除 |
| 审计页 | 无关联单号检索 | 新增「关联单号」筛选框（走子表 `subjects.some`，后端 `:1080` 已支持）——entityRef 业务号化后，按提现单号能捞出「主体是审批单、关联着这张提现单」的事件 |

## 5. 底座 · 给门通电（治病族 4）

- **审批超时**：`ApprovalExpiryService` @Cron `*/1`（沿旧计划 Task 1 原文，含 e2e）+ ⚡ `POST /admin/control-gates/approvals/:approvalNo/simulate-timeout`（Task 2 原文，挂 `DEMO_CLOCK_WRITE`）。死码 `APPROVAL_EXPIRED` 就此活过来。
- **邀请过期**：`sweepExpiredInvites`（`admin-invite-workflow.service.ts:412-450`，零调用方）同款接 @Cron（每小时档即可）；死码 `ADMIN_INVITE_EXPIRED` 活过来。⚡ 不做（邀请过期不进剧本，cron 只为语义成立）。

## 6. 四模块治疗单（法之外的模块独有活）

**角色**：
- 申请单从孤儿变公民：侧栏 Identity & Access 组加「Role Change Requests」入口；「角色定义修改申请单」补列表/详情页（后端 `access-control.controller.ts:71-85` 两个查询端点现成、前端零消费）；`/admin` 路由树补齐（现只在 `/dashboard` 树）
- 提交申请后导流到申请单详情（现只弹 notice）

**权限**：
- 修抄串码：`permissions.ts:111-112` 两个提现报价常量改 `api.get.admin_withdrawal_fee_levels_quotes[_id]`（正确码 catalog:505/508 已存在；现状=持提现权限进不了页、持兑换权限进页即 403）
- **9 端点收编**（决定 5）：三个 controller 挂 `AuthGuard('jwt') + AdminPermissionGuard`，路由进字典——
  材料管理 4 读（cycles×2、holdings×2）→ 新组 `MATERIAL_VIEW`（客户域新桶「View material holdings」，授予线随现侧栏可见性：持客户读的职务）；材料 2 模拟（simulate-stage / simulate-tier-change）→ `DEMO_CLOCK_WRITE`（`demo.act_clock` 桶描述本就写着 material expiry）；Sumsub 模拟 2 条（applicant-action-result / ongoing-doc-monitoring-fire）→ `DEMO_VERDICT_WRITE`（⚡ 裁决族既有组）；`GET /admin/sumsub-events` → 挂守卫让既有登记 `SUMSUB_EVENT_VIEW` 变真
  收编后「内审零 Act」在全部 admin 端点上为真，手工 `ensureAdmin` 内联判据保留不动（守卫在前，它变冗余兜底，不值得为删而动）
- tooltip 统一：`RolesPage.tsx:470` 写死的 `'Restricted — CISO only'` 改读 `bucket.description`（RoleDetailPage 已改，两页对齐）

**admin 管理**：
- 站 0 演示动线依赖的机器全部现成：邀请链接前端已渲染（`PlatformMemberDetailPage.tsx:524`）、首登四步页有 QR 可扫任意 TOTP 应用（`AdminMfaBindingPage.tsx:264-291`）——**无新功能，纯剧本编排**
- 法一/法二覆盖其余病灶（敞口、幽灵账号、三处留痕缺口）

**审批单**：
- 12 条死策略退役（11 条全仓零引用 + ASSET_LISTING 仅注释引用；`approval.constants.ts:201-260/313-317`），连带 Wave 叙事注释清理、一次性迁移脚本 `scripts/migrate-policy-steps-config.ts` 删除、no-op `projectGovernanceApprovalDecision` 删除、`allowRetry` 死列记 PRODUCTION-NOTES（不动 schema）
- 策略编辑页角色名单：`AVAILABLE_ROLES` 写死 6 旧职务（缺 OPS_OFFICER/CFO，7 条现役策略编辑不能）→ 改由后端在策略列表响应里下发（源 = `RBAC_ROLE_DEFINITIONS` 减 SUPER_ADMIN），前端删常量
- Source 徽章修成真 diff：DB 行内容 == 出厂默认 → 显示 `DEFAULT`，有差异才 `CUSTOMIZED`（现状=seed 全量落库、判定看「有无 DB 行」、27 条恒显 CUSTOMIZED）。站 3 改一条策略后徽章当场翻转，是新演示看点
- 非末步驳回归因：`buildEventPayload` 取「最后一个带 decidedBy 的步」（现取 stepNo 最大的非 PENDING 步，撞上被联动取消的高步 → decisionBy 全 null）
- 策略页显示名统一（现 `Admin Invite` 与 `ROLE_DEFINITION_CREATE` 混排）：补显示名映射

## 7. 退役清单（病族 6，整批删，退役也是治愈）

12 死审批策略 ｜ 12 死权限字典行（幽灵 PUT roles、6 条 assets/wallets/withdraw/treasury、4 条 funds-layer）+ 孤儿组 `INTERNAL_TRANSFER_READ/WRITE`（`TRADING_DEPOSIT_WRITE` 留，白名单注释已自证）｜ 死方法 `completeFirstLogin` ｜ 死常量 `AuditUserActions`、`SYSTEM_ACTOR`×2、`SOFT_WARNING_ROLE_GROUPS` 空转链 ｜ 未用 import ×4 ｜ 迁移脚本残留 ｜ 前端死筛选项（角色页 INACTIVE）｜ 前端幻影字段（ApprovalStepItem 的 canApprove 等后端从不产出的声明）｜ 三处「扫源码文本」型断言换行为断言 ｜ DTO 弃用字段 traceId（注释已声明不采信）

## 8. 剧本扩写（第一幕 5 站 → 6 站）

**站 0 · 进人**（新，放最前——先有人再有权）：
`ciso@` 在成员页发一张邀请（目标角色 OPS_OFFICER 之类）→ 审批中心出现 `ADMIN_INVITE_APPROVAL` 待办 → 换 checker 批准 → 回成员详情页拿激活链接 → 切新人视角打开：确认身份 → 扫 QR 绑 TOTP → 首登完成上岗 → 回 `ciso@` 提停用 → 批准 → 新人下一次请求即失效（刷新演示）→ 恢复审批 → 复活。
期望：管理员的一生完整走通；邀请/停用/恢复三案都是 maker/checker；重铺后审计页从此在第一幕开场就有货（站 0 本身产证据，取代此前「垫一笔治理动作」的凑数说明）。

**站 3 追加第三结局**：`sm@` 再提一张策略变更 → 详情页 ⚡ 模拟超时 → 一分钟内自动 EXPIRED → 审计可查 `APPROVAL_EXPIRED`（谁都没批，时间到了）。批准 / 拒绝 / 超时三结局齐。

**站 1 追加一句**：内审 403 之后，切审计页按 actorNo 查出那条 `ADMIN_ACCESS_DENIED`——「默默拦下是被禁止的」当场兑现。

**第七幕两件新展品**：① 按内审 actorNo 拉越权被拒记录；② 「关联单号」筛选输一张提现单号，捞出主体是审批单的关联事件（跨主体全链）。

## 9. 判据收口（⑪，每族一条看守）

**verify:rbac 扩 2 条静态**：
- S6 前后端权限码双向差集 = 空（前端 `permissions.ts` 86 常量 ↔ 后端 catalog；抄串病从此当场红）
- S7 字典真实性：catalog 每行都有活端点、每个挂守卫的 admin 端点都在 catalog（12 死行删后应恒真；集合运算，与 S1–S5 同型）

**verify:act1 扩到约 15 条行为判据**（全部真登录真 HTTP + 路径存在性预检 + 上线前逐条变异验证）：
旧 9 条（B0–B8：⚡ 可用一条、超时门三条、业务键三条、迁移表一条、留痕带上下文一条）+ 新增——
- 两票齐痕：造一张两步单，两票各批 → 审计里 `APPROVAL_GRANTED` 恰好 2 行
- 驳回可达：提一张角色修改申请 → 拒绝 → 单据状态 = REJECTED（不是 CANCELLED）
- 失败留痕不再被拒收：强制一次落地失败 → 审计有 FAILED 行且带 reasonCode
- 403 留痕：内审打写接口 → 403 → 审计出现 `ADMIN_ACCESS_DENIED` 且 actorNo=内审
- 管理员非法跃迁：对 ACTIVE 管理员直接打恢复 → 409
- 收编生效：内审打材料 simulate-stage → 403（此前 200）
- 子表检索：按 entityRef 业务号查审计 → 捞到主体为审批单的关联行
- 邀请过期：⚡ 无（cron 语义由 e2e 盖，verify 免）

**运行顺序约束沿用**：verify 系列会写数据 → 永远排在 `reset → demo:all` 之前，绝不在演示前跑（baseline.md 已有章程，新判据并入）。

## 10. 施工波次

- **波一 · 立法**：法一四纪律的机器件（requestId/reasonCode/去 catch/403 码）+ 法二三张迁移表 + 底座两 @Cron 两 ⚡ + 45 裸词换名册
- **波二 · 迁移与退役**：四模块治疗单 + 退役清单 + 业务键全量替换 + 9 端点收编（可并行拆 subagent，一模块一任务组）
- **波三 · 剧本与判据**：script.md 六站改写 + verify 扩展（逐条变异验证）+ 全幕真人走查 + 文档同步（modules v1/v3 §4§5、demo/data.md、baseline.md、CHANGELOG、BACKLOG 销账）

每波收尾过总纲 §7 随手闸；波三过收尾闸全家（demo:all / verify:coa / verify:audit / verify:rbac / verify:act1 / recon:demo 双态 / 重铺闸）。

## 11. 已知风险与执行注意

1. **收编改变现有职务的可达面**：材料页此前对全部 ADMIN 放行，挂 `MATERIAL_VIEW` 后未授组的职务将失去入口——授予线以「现侧栏哪些职务看得见材料页」为准核定，防止把演示动线掐断（rbac 改动必跑 verify:rbac 全绿）
2. **去 catch 是行为变化**：此前静默的审计失败将变成流程失败——e2e 里若有依赖静默的用例会翻红，翻红即修用例传参（补 reasonCode 等），不许回退法一
3. **RBAC 路由/组改动后必须 `db:base:sync` + 重启后端**（内存定义，只 seed 不重启=白做，仓内已栽过）
4. **状态值变化不写兼容层**：REJECTED/FAILED 新值靠 reset 重铺进世界，旧库不迁移
5. **verify 判据先变异后上岗**：每条新判据必须先人为制造一次病、看它变红，再修回——自证型绿灯这里栽过六次
6. **并行会话在动 main**（平账一期半 14 任务计划已挂出）：本设计动 `rbac.catalog.ts`、`approval.constants.ts` 等共享文件，worktree 施工、合并前重新 merge main 并复跑判据
