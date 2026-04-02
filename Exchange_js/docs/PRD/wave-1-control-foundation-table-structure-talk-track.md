Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-01
Applies To: `Exchange_js`
Supersedes: none
Depends On: `prisma/schema.prisma`, `docs/constraints/rbac-member-management-constraints.md`, `docs/constraints/governance-approval-constraints.md`, `docs/constraints/governance-change-ticket-constraints.md`, `docs/constraints/governance-delete-request-constraints.md`, `docs/constraints/governance-sla-timer-constraints.md`, `docs/constraints/audit-logging-constraints.md`, `docs/specs/modules/rbac-member-management-module.md`, `docs/specs/entities/approval-case-entity.md`, `docs/specs/entities/change-ticket-entity.md`, `docs/specs/entities/delete-request-entity.md`, `docs/specs/entities/governance-sla-timer-entity.md`, `docs/specs/entities/audit-log-event-entity.md`, `docs/specs/entities/audit-evidence-package-entity.md`
Source of Truth Level: product-narrative-supporting-doc

# Wave 1 表结构讲解稿：控制底座主体表

## 文档目的
- 本文是一份面向开发的 `Wave 1` 表结构讲解稿。
- 它的目标不是替代 schema 或 entity spec，而是帮助讲解者把 `Wave 1` 的主体表、字段语义、关联关系和实现边界讲清楚。
- 如果本文与运行时真相冲突，以 [schema.prisma](/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/prisma/schema.prisma) 和 `docs/specs/**`、`docs/constraints/**` 为准。

## 适合怎么讲
- 这份稿子适合接在 [wave-1-control-foundation-talk-track.md](/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/PRD/wave-1-control-foundation-talk-track.md) 后面。
- 建议顺序不是按 schema 顺序念，而是按产品语义讲：
1. 谁能进系统
2. 敏感动作怎么审批
3. 敏感动作怎么写审计
4. 证据怎么导出
5. 变更怎么发
6. 删除怎么管
7. 超时怎么跟
- 讲的时候建议反复提醒开发：
  `这些表不是普通 CRUD 表，它们大多数都是治理对象或治理配套对象。`

## Wave 1 最值得先记住的 10 张主体表
1. `users`
2. `roles`
3. `permissions`
4. `approval_cases`
5. `audit_log_events`
6. `audit_evidence_packages`
7. `change_tickets`
8. `delete_requests`
9. `sla_timers`
10. `admin_user_invitations`

## 配套表与从属表
- 这些表通常不作为第一轮主讲对象，但开发必须知道它们的作用：
1. `user_roles`
2. `role_permissions`
3. `approval_steps`
4. `approval_action_policies`
5. `approval_sod_rules`
6. `change_ticket_gate_runs`
7. `sla_notifications`
8. `audit_log_subject_nos`

## 推荐开场
- 直接讲：
  `Wave 1 的表结构不是按业务链设计出来的，而是按治理能力设计出来的。`
- 再补一句：
  `所以不要把这些表理解成后台页面的存储，而要理解成“权限、审批、审计、发布、删除、SLA”这几套控制机制的落地载体。`

## 第一组：成员与 RBAC

### 1. `users`
- 这张表解决什么问题：
  `它是后台成员主表，回答“这个人是谁、能不能登录、是不是已经被治理下线”。`
- 最重要字段：
1. `id`
   - 内部主键
2. `userNo`
   - 后台成员编号，适合 operator 口头沟通和检索
3. `email`
   - 登录身份
4. `password`
   - 密码存储
5. `role`
   - 兼容/展示字段，不是权限真相
6. `status`
   - 成员状态，核心语义是 `INACTIVE / ACTIVE`
7. `failedLoginAttempts`
   - 登录失败次数
8. `lockedUntil`
   - 登录锁定到什么时候
9. `lastLoginAt`
   - 最近一次登录时间
10. `deletedAt / deletedBy / deleteRequestId / deleteReason`
   - 治理性软删除链
- 讲给开发最关键的一句：
  `users 表解决的是身份和登录，不解决最终授权。`
- 容易写错的点：
  `users.role` 不是授权真相，真正授权要去看 `user_roles + role_permissions`。

### 2. `roles`
- 这张表解决什么问题：
  `它是角色目录，回答“平台有哪些标准角色”。`
- 最重要字段：
1. `code`
   - 稳定角色标识，真正适合写逻辑和配置
2. `name`
   - 展示名
3. `description`
   - 角色职责解释
4. `status`
   - 角色目录是否仍有效
- 讲给开发的建议：
  `role 是职责边界，不是 UI 标签。`

### 3. `permissions`
- 这张表解决什么问题：
  `它是权限目录，回答“系统到底控制哪些动作和接口”。`
- 最重要字段：
1. `code`
   - 权限稳定标识
2. `name`
   - 权限显示名
3. `description`
   - 权限语义说明
4. `method`
   - HTTP 方法
5. `path`
   - 路由路径
- 对开发最关键的一句：
  `permission 不是抽象概念，它在 Wave 1 里就是具体接口/动作边界。`

### 4. `user_roles`
- 这张表解决什么问题：
  `它回答“某个成员被授予了哪些角色”。`
- 最重要字段：
1. `userId`
2. `roleId`
- 讲给开发时重点强调：
  `用户和角色是多对多，不要把角色写死回 users.role。`

### 5. `role_permissions`
- 这张表解决什么问题：
  `它回答“某个角色最终拥有哪些权限”。`
- 最重要字段：
1. `roleId`
2. `permissionId`
- 一句讲法：
  `role_permissions 是权限真相矩阵。`

### 6. `admin_user_invitations`
- 这张表解决什么问题：
  `它支撑后台成员的邀请激活制。`
- 最重要字段：
1. `userId`
   - 这张邀请属于谁
2. `tokenHash`
   - 一次性邀请凭证的 hash
3. `expiresAt`
   - 邀请失效时间
4. `consumedAt`
   - 是否已被接受
5. `revokedAt`
   - 是否已被重发/撤销
6. `createdByUserId`
   - 谁发起的邀请
- 讲给开发最关键的一句：
  `Wave 1 的 admin member 不是直接可登录，而是必须经过 invitation activation 才能从 INACTIVE 进入 ACTIVE。`

## 第二组：审批治理

### 7. `approval_cases`
- 这张表解决什么问题：
  `它是所有审批型治理动作的根对象。`
- 最重要字段：
1. `approvalNo`
   - 审批编号，operator-facing 主键
2. `actionType`
   - 这是一张什么审批单
3. `entityRef`
   - 被审批的是哪一个业务对象
4. `makerUserId`
   - 谁发起的
5. `status`
   - 审批生命周期
6. `executionStatus`
   - 审批后执行结果
7. `riskLevel`
   - 这张审批的治理风险级别
8. `checkerRoles`
   - 哪些角色有资格审批
9. `selectedCheckerRole`
   - 这单最终实际允许哪个角色批
10. `allowCancel / allowRetry`
   - 是否允许撤销 / 重试
11. `docRef`
   - 相关材料或附件引用
12. `metadataJson`
   - 审批上下文扩展信息
13. `traceId / workflowType / workflowId / workflowNo`
   - 审批如何接回业务链
14. `submittedAt / timeoutAt / decidedAt / executedAt`
   - 关键时点
15. `decisionByUserId / decisionByRole / decisionReason`
   - 最终由谁以什么理由决定
- 对开发最关键的理解：
  `ApprovalCase 是独立治理对象，不是业务对象上的一个 status 字段。`
- 讲解建议：
  `审批结果可以投影回业务对象，但审批本身始终有自己的生命周期。`

### 8. `approval_steps`
- 这张表解决什么问题：
  `它记录审批单内部的步骤。`
- 最重要字段：
1. `approvalCaseId`
2. `stepNo`
3. `status`
4. `checkerRoleCandidates`
5. `decidedByUserId / decidedByRole / reason / decidedAt`
- 讲给开发时的口径：
  `当前 Wave 1 主要还是单步审批，但表结构已经把 step 维度留出来了。`

### 9. `approval_action_policies`
- 这张表解决什么问题：
  `它是审批动作默认策略表。`
- 最重要字段：
1. `actionType`
2. `riskLevel`
3. `checkerRoles`
4. `timeoutHours`
5. `allowCancel`
6. `allowRetry`
- 一句讲法：
  `它不是实例数据，而是“这类审批默认怎么配”的策略模板。`

### 10. `approval_sod_rules`
- 这张表解决什么问题：
  `它存的是审批 SoD 规则开关。`
- 最重要字段：
1. `ruleCode`
2. `enabled`
3. `description`
- 建议这样讲：
  `SoD 不是散落在代码里的 if-else，它有独立规则表。`

## 第三组：审计与证据

### 11. `audit_log_events`
- 这张表解决什么问题：
  `它是 Wave 1 统一审计真相表。`
- 最重要字段：
1. `auditNo`
   - 审计编号
2. `triggerType`
   - 这次事件是怎么触发的
3. `action`
   - 做了什么动作
4. `module`
   - 来自哪个模块
5. `entityType`
   - 操作了哪类对象
6. `entityId / entityNo`
   - 操作的是哪一条对象记录
7. `traceId / workflowType / workflowId / workflowNo`
   - 这条审计属于哪条业务链
8. `entityOwnerType / entityOwnerId / entityOwnerNo`
   - 这条事件最终归属谁
9. `actorType / actorId / actorNo / actorRole`
   - 谁做的
10. `result`
   - 执行结果
11. `reason`
   - 原因或说明
12. `beforeData / afterData`
   - 前后快照
13. `metadata`
   - 补充上下文
14. `idempotencyKey`
   - 幂等键
15. `payloadDigest`
   - 内容摘要
16. `maskVersion`
   - 脱敏版本
17. `retainedUntil`
   - 保留到什么时候
18. `occurredAt`
   - 真正发生时间
- 对开发最关键的一句：
  `audit_log_events 不是 debug log，它是证据。`

### 12. `audit_log_subject_nos`
- 这张表解决什么问题：
  `它给审计事件补充多主体可检索编号。`
- 最重要字段：
1. `eventId`
2. `subjectRole`
3. `subjectType`
4. `subjectId`
5. `subjectNo`
- 讲解建议：
  `一条审计可能同时涉及 approvalNo、ticketNo、packageNo，这张表就是让 Audit Center 能按这些编号去搜。`

### 13. `audit_evidence_packages`
- 这张表解决什么问题：
  `它是 Audit Center 的 governed export object。`
- 最重要字段：
1. `packageNo`
   - 证据包编号
2. `approvalCaseId`
   - 关联审批
3. `exportedByType / exportedById / exportedByRole`
   - 谁导出的
4. `status`
   - 包当前状态
5. `exportMode`
   - 以什么模式导出
6. `fileName`
   - 导出文件名
7. `filterSnapshot`
   - 当时的筛选条件
8. `selectedEventIdsSnapshot`
   - 当时选了哪些事件
9. `itemCount`
   - 导出项数量
10. `digest`
   - 导出结果摘要
11. `manifest`
   - 导出清单
12. `packageBody`
   - 实际导出内容
13. `deletedAt / deletedBy / deleteRequestId / deleteReason`
   - 删除治理链
- 对开发最关键的一句：
  `证据包不是临时下载文件，而是受审批、可删除治理、可追溯的产品对象。`

## 第四组：变更与发布治理

### 14. `change_tickets`
- 这张表解决什么问题：
  `它是变更治理根对象。`
- 最重要字段：
1. `ticketNo`
   - 变更单编号
2. `status`
   - 变更单生命周期
3. `changeType`
   - 变更类别
4. `scopeSummary`
   - 影响范围
5. `riskLevel`
   - 风险等级
6. `testEvidenceRef`
   - 测试证据引用
7. `rollbackPlanRef`
   - 回滚方案引用
8. `latestApprovalId / latestApprovalStatus`
   - 最近审批真相
9. `traceId`
   - 变更治理链 trace
10. `emergency / emergencyReason`
   - 是否紧急变更
11. `postApprovalDueAt / postApprovalCompletedAt`
   - 紧急变更后补跟进窗口
12. `createdByUserId / submittedByUserId / closedByUserId`
   - 责任人链
13. `submittedAt / deployedAt / closedAt`
   - 关键时间点
14. `deletedAt / deletedBy / deleteRequestId / deleteReason`
   - 删除治理链
- 建议这样讲：
  `ChangeTicket 不是“发版备注”，而是把变更理由、测试证据、回滚方案、审批和部署结果绑在一起的治理对象。`

### 15. `change_ticket_gate_runs`
- 这张表解决什么问题：
  `它记录某张变更单的一次具体 gate 检查。`
- 最重要字段：
1. `ticketId`
2. `targetEnv`
3. `releaseVersion`
4. `status`
5. `reason / failureReason`
6. `operatorUserId`
7. `traceId`
8. `startedAt / finishedAt`
9. `activeKey`
- 对开发最关键的一句：
  `ChangeTicket 表示变更对象本身，GateRun 表示某次具体部署尝试。`

## 第五组：删除治理

### 16. `delete_requests`
- 这张表解决什么问题：
  `它把删除从数据库操作变成治理工作流。`
- 最重要字段：
1. `requestNo`
   - 删除单编号
2. `targetType / targetId / targetNo`
   - 要删什么
3. `status`
   - 删除请求生命周期
4. `latestApprovalId / latestApprovalStatus`
   - 关联审批真相
5. `makerUserId / submittedByUserId / executedByUserId`
   - 谁提、谁交、谁执行
6. `deleteReason`
   - 为什么删
7. `docRef`
   - 补充材料
8. `targetSnapshotJson`
   - 删除前快照
9. `traceId`
   - 治理链路
10. `submittedAt / executedAt`
   - 关键时间点
- 最适合直接讲的一句：
  `DeleteRequest 不是“删掉一行数据”，而是“治理性退役一个受控对象”。`

## 第六组：SLA 与时间控制

### 17. `sla_timers`
- 这张表解决什么问题：
  `它是治理工作流的时间控制对象。`
- 最重要字段：
1. `timerNo`
   - SLA 编号
2. `workflowType / workflowId / workflowNo`
   - 挂靠哪条工作流根
3. `subjectType / subjectId / subjectNo`
   - 当前计时对象是谁
4. `timerType`
   - 什么类型的 SLA
5. `ownerUserId`
   - 当前 owner
6. `status`
   - `ACTIVE / CLOSED / EXPIRED`
7. `dueAt`
   - 截止时间
8. `graceSeconds`
   - 宽限秒数
9. `traceId`
   - 进入统一 trace
10. `contextJson`
   - 上下文
11. `closedAt / expiredAt`
   - 终止时间
12. `activeKey`
   - 活跃唯一键
- 建议这样讲：
  `SlaTimer 不是提醒器，它是把“某件治理义务有时限”这件事显式做成表。`

### 18. `sla_notifications`
- 这张表解决什么问题：
  `它是 SLA 的通知注册表。`
- 最重要字段：
1. `timerId`
2. `notificationType`
3. `status`
4. `scheduledAt`
5. `triggeredAt`
6. `reasonCode`
7. `message`
8. `metadataJson`
- 对开发的提醒：
  `这张表不是外发消息系统，而是“定时该触发什么时间事件”的 registry。`

## 最适合开发记忆的关联图
- 可以直接这样讲：
1. `users -> user_roles -> roles -> role_permissions -> permissions`
   - 这是后台身份和授权真相链
2. `approval_cases -> approval_steps`
   - 这是审批治理链
3. `change_tickets -> change_ticket_gate_runs`
   - 这是变更治理链
4. `delete_requests -> approval_cases`
   - 删除要借助审批治理链
5. `audit_evidence_packages -> approval_cases`
   - 证据导出要借助审批治理链
6. `sla_timers -> sla_notifications`
   - 时间控制和通知注册链
7. 所有关键写操作最终都要落到 `audit_log_events`
   - 这是统一证据链

## 开发最容易误解的 10 个点
1. `users.role` 不是授权真相。
2. `ApprovalCase` 不是业务表的状态镜像。
3. `ChangeTicket` 不是发布备注。
4. `ChangeTicketGateRun` 不是第二张 ChangeTicket。
5. `DeleteRequest` 不是数据库 delete 命令。
6. `AuditLogEvent` 不是技术日志。
7. `AuditEvidencePackage` 不是临时下载文件。
8. `SlaTimer` 不是单纯倒计时器。
9. `SlaNotification` 不是消息中心。
10. 删除和审批结果都可能投影回业务对象，但治理对象本身始终独立存在。

## 最后怎么收口
- 建议这样结束：
  `Wave 1 的表结构本质上是控制结构。它先把人、权限、审批、审计、变更、删除、SLA 这些治理对象建出来，后面的业务波次只是把自己的工作流挂到这套治理骨架上。`

