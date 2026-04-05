Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-04-02
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/cleanup/2026-04-wave1-foundation-reset/README.md`, `docs/cleanup/2026-04-wave1-foundation-reset/wave-1-subject-table-dictionary-and-minimal-model-review.md`, `prisma/schema.prisma`
Source of Truth Level: review-note

# Wave 1 Core Table Field Necessity Review

## Purpose
- 本文档回答的是“每个字段值不值得保留在主模型里”。
- 它不是字段含义字典。
- 它是在字段字典基础上，再加一层产品和后台治理视角的必要性判断。

## Judgment Legend

| 标签 | 含义 |
| --- | --- |
| `核心保留` | 必须保留为 typed 字段，会参与状态、检索、治理、工作流或对外理解。 |
| `保留但技术区` | 字段要留，但更适合放到技术区或折叠区，不适合默认主展示。 |
| `兼容保留` | 当前代码或历史契约还依赖，短期不能删，但不应继续当主真相。 |
| `上下文保留` | 该字段有价值，但更像上下文、快照、说明，不适合继续扩成主字段。 |
| `结构化子对象` | 应保留，但作为子表/数组理解，而不是主体表主字段。 |
| `应弱化主路径` | 关系可以继续存在，但不应该再成为理解该主体表的主入口。 |

## `User`

| 字段 | 判断 | 原因 |
| --- | --- | --- |
| `id` | `保留但技术区` | 内部主键必须存在，但不适合默认展示。 |
| `userNo` | `核心保留` | 管理员的 operator-facing 标识。 |
| `email` | `核心保留` | 登录和成员识别主入口。 |
| `password` | `核心保留` | 登录必需，但属于敏感字段，绝不应进入普通展示。 |
| `role` | `兼容保留` | 当前仍存在代码依赖，但长期真相应是 `userRoles`。 |
| `status` | `核心保留` | 决定成员是否可登录、可激活。 |
| `failedLoginAttempts` | `核心保留` | 安全与锁定逻辑依赖。 |
| `lockedUntil` | `核心保留` | 直接影响登录资格。 |
| `lastLoginAt` | `核心保留` | 安全和运营审计都需要。 |
| `deletedAt` | `保留但技术区` | 属于治理删除链路，不必默认展示。 |
| `deletedBy` | `保留但技术区` | 仅在治理回溯时需要。 |
| `deleteRequestId` | `保留但技术区` | 只用于治理链路跳转。 |
| `deleteReason` | `保留但技术区` | 留给治理回溯即可。 |
| `createdAt` | `保留但技术区` | 生命周期辅助信息。 |
| `updatedAt` | `保留但技术区` | 生命周期辅助信息。 |
| `userRoles` | `结构化子对象` | 这才是角色真相，应该保留为绑定集合。 |
| `adminInvitations` | `结构化子对象` | 邀请链路是用户的子对象，不该混进用户主视图。 |

## `Role`

| 字段 | 判断 | 原因 |
| --- | --- | --- |
| `id` | `保留但技术区` | 内部主键。 |
| `code` | `核心保留` | 角色真相键。 |
| `name` | `核心保留` | 角色显示名称。 |
| `description` | `核心保留` | 产品和运营理解角色用途需要。 |
| `status` | `核心保留` | 决定角色是否可继续分配。 |
| `createdAt` | `保留但技术区` | 辅助信息。 |
| `updatedAt` | `保留但技术区` | 辅助信息。 |
| `rolePermissions` | `结构化子对象` | 角色和权限绑定集合。 |
| `userRoles` | `结构化子对象` | 角色被谁使用应作为附属关系理解。 |

## `Permission`

| 字段 | 判断 | 原因 |
| --- | --- | --- |
| `id` | `保留但技术区` | 内部主键。 |
| `code` | `核心保留` | 权限目录的真相键。 |
| `name` | `核心保留` | 权限显示名称。 |
| `description` | `核心保留` | 权限用途解释仍有价值。 |
| `method` | `核心保留` | 定义权限对应的主要动作入口。 |
| `path` | `核心保留` | 定义权限对应的主要路由入口。 |
| `createdAt` | `保留但技术区` | 辅助信息。 |
| `updatedAt` | `保留但技术区` | 辅助信息。 |
| `rolePermissions` | `结构化子对象` | 角色绑定是附属关系，不应混进权限主卡片。 |

## `AdminUserInvitation`

| 字段 | 判断 | 原因 |
| --- | --- | --- |
| `id` | `保留但技术区` | 内部主键。 |
| `userId` | `保留但技术区` | 绑定用户所需，但不适合主展示。 |
| `tokenHash` | `保留但技术区` | 必须保留以支持校验，但只属于敏感技术字段。 |
| `expiresAt` | `核心保留` | 邀请是否有效的关键时间。 |
| `consumedAt` | `核心保留` | 邀请是否已被接受。 |
| `revokedAt` | `核心保留` | 邀请是否已作废。 |
| `createdByUserId` | `核心保留` | 邀请责任归属需要。 |
| `createdAt` | `核心保留` | 邀请发起时间有业务意义。 |
| `updatedAt` | `保留但技术区` | 变化辅助信息。 |
| `user` | `应弱化主路径` | 邀请是主体，用户是关联对象，不必把用户关系当邀请主字段讲。 |

## `ApprovalCase`

| 字段 | 判断 | 原因 |
| --- | --- | --- |
| `id` | `保留但技术区` | 内部主键。 |
| `approvalNo` | `核心保留` | 审批对象最重要的业务编号。 |
| `actionType` | `核心保留` | 决定这是哪类审批。 |
| `entityRef` | `核心保留` | 审批必须知道自己批的是谁，但更偏技术绑定。 |
| `makerUserId` | `核心保留` | 发起责任归属。 |
| `status` | `核心保留` | 审批状态主字段。 |
| `executionStatus` | `核心保留` | 审批结果是否成功投影执行。 |
| `riskLevel` | `核心保留` | 审批策略和优先级依赖。 |
| `checkerRoles` | `核心保留` | 审批角色范围是审批语义的一部分。 |
| `selectedCheckerRole` | `核心保留` | 本次审批具体选中了哪个角色。 |
| `allowCancel` | `核心保留` | 审批动作规则的一部分。 |
| `allowRetry` | `核心保留` | 审批动作规则的一部分。 |
| `docRef` | `核心保留` | 审批附带材料引用仍有价值。 |
| `metadataJson` | `上下文保留` | 保留，但不应继续承担更多 typed 语义。 |
| `traceId` | `核心保留` | 审批要能串回工作流。 |
| `workflowType` | `核心保留` | 工作流绑定主键之一。 |
| `workflowId` | `保留但技术区` | 内部工作流 ID，常用于跳转和排障。 |
| `workflowNo` | `核心保留` | 面向运营的工作流编号绑定。 |
| `createdAt` | `保留但技术区` | 生命周期辅助信息。 |
| `updatedAt` | `保留但技术区` | 生命周期辅助信息。 |
| `submittedAt` | `核心保留` | 审批进入流转的关键时间。 |
| `timeoutAt` | `核心保留` | 审批 SLA 和超时逻辑依赖。 |
| `decidedAt` | `核心保留` | 审批得出结论的关键时间。 |
| `executedAt` | `核心保留` | 审批结果完成投影执行的关键时间。 |
| `decisionByUserId` | `核心保留` | 决策责任归属。 |
| `decisionByRole` | `核心保留` | 决策时使用的角色。 |
| `decisionReason` | `核心保留` | 审批结果说明必须保留。 |
| `deletedAt` | `保留但技术区` | 治理删除链路字段。 |
| `deletedBy` | `保留但技术区` | 治理删除链路字段。 |
| `deleteRequestId` | `保留但技术区` | 治理删除链路字段。 |
| `deleteReason` | `保留但技术区` | 治理删除链路字段。 |
| `steps` | `结构化子对象` | 审批步骤天然是子表，不应揉成主字段。 |
| `evidencePackage` | `应弱化主路径` | 它是审批的外部投影，不是审批主体本身。 |
| `caseEvidencePackage` | `应弱化主路径` | 同上。 |
| `latestForChangeTicket` | `应弱化主路径` | 这是跨业务反向关系，会污染审批主体理解。 |
| `latestForDeleteRequest` | `应弱化主路径` | 同上。 |
| `latestForCustomerFinalApproval` | `应弱化主路径` | 同上。 |
| `linkedRegulatoryGates` | `应弱化主路径` | 同上，而且已超出 Wave 1 主体语义。 |
| `internalTransactionForApproval` | `应弱化主路径` | 同上。 |

## `AuditEvidencePackage`

| 字段 | 判断 | 原因 |
| --- | --- | --- |
| `id` | `保留但技术区` | 内部主键。 |
| `packageNo` | `核心保留` | 证据包 operator-facing 标识。 |
| `approvalCaseId` | `保留但技术区` | 绑定审批链路所需，但不必主展示。 |
| `exportedByType` | `核心保留` | 记录谁发起导出。 |
| `exportedById` | `核心保留` | 记录发起人。 |
| `exportedByRole` | `核心保留` | 记录发起角色。 |
| `status` | `核心保留` | 证据包状态主字段。 |
| `exportMode` | `核心保留` | 导出模式主字段。 |
| `fileName` | `核心保留` | 产物文件名仍有业务意义。 |
| `filterSnapshot` | `上下文保留` | 导出意图快照，适合作为上下文。 |
| `selectedEventIdsSnapshot` | `上下文保留` | 回放导出意图所需，不必主展示。 |
| `itemCount` | `核心保留` | 导出规模信息。 |
| `digest` | `核心保留` | 完整性校验关键字段。 |
| `manifest` | `上下文保留` | 应保留，但更像产物内容。 |
| `packageBody` | `上下文保留` | 应保留，但不应进入默认界面。 |
| `deletedAt` | `保留但技术区` | 治理删除链路字段。 |
| `deletedBy` | `保留但技术区` | 治理删除链路字段。 |
| `deleteRequestId` | `保留但技术区` | 治理删除链路字段。 |
| `deleteReason` | `保留但技术区` | 治理删除链路字段。 |
| `createdAt` | `核心保留` | 产物生成时间有业务意义。 |
| `updatedAt` | `保留但技术区` | 辅助信息。 |
| `approvalCase` | `应弱化主路径` | 它是导出治理关系，不是包主体本身。 |

## `ComplianceCaseEvidencePackage`

| 字段 | 判断 | 原因 |
| --- | --- | --- |
| `id` | `保留但技术区` | 内部主键。 |
| `packageNo` | `核心保留` | 证据包业务编号。 |
| `approvalCaseId` | `保留但技术区` | 绑定审批链路所需。 |
| `exportedByType` | `核心保留` | 发起主体类型。 |
| `exportedById` | `核心保留` | 发起主体 ID。 |
| `exportedByRole` | `核心保留` | 发起角色。 |
| `status` | `核心保留` | 状态主字段。 |
| `exportMode` | `核心保留` | 导出模式。 |
| `fileName` | `核心保留` | 产物文件名。 |
| `filterSnapshot` | `上下文保留` | 导出意图快照。 |
| `selectedCaseIdsSnapshot` | `上下文保留` | 选中 case 的快照。 |
| `itemCount` | `核心保留` | 导出规模。 |
| `digest` | `核心保留` | 完整性校验字段。 |
| `manifest` | `上下文保留` | 产物上下文。 |
| `packageBody` | `上下文保留` | 产物正文。 |
| `deletedAt` | `保留但技术区` | 治理删除链路字段。 |
| `deletedBy` | `保留但技术区` | 治理删除链路字段。 |
| `deleteRequestId` | `保留但技术区` | 治理删除链路字段。 |
| `deleteReason` | `保留但技术区` | 治理删除链路字段。 |
| `createdAt` | `核心保留` | 生成时间。 |
| `updatedAt` | `保留但技术区` | 辅助信息。 |
| `approvalCase` | `应弱化主路径` | 它是治理关系，不是包主体本身。 |

## `ChangeTicket`

| 字段 | 判断 | 原因 |
| --- | --- | --- |
| `id` | `保留但技术区` | 内部主键。 |
| `ticketNo` | `核心保留` | 变更单业务编号。 |
| `status` | `核心保留` | 变更单状态主字段。 |
| `changeType` | `核心保留` | 变更类型是产品理解入口。 |
| `scopeSummary` | `核心保留` | 变更范围摘要必须保留。 |
| `riskLevel` | `核心保留` | 治理和审批都依赖。 |
| `testEvidenceRef` | `核心保留` | 支撑变更可信度。 |
| `rollbackPlanRef` | `核心保留` | 变更治理必需。 |
| `latestApprovalId` | `保留但技术区` | 用于链路跳转即可。 |
| `latestApprovalStatus` | `核心保留` | 这是变更审批结果主摘要。 |
| `traceId` | `核心保留` | 必须能串整条变更链路。 |
| `emergency` | `核心保留` | 决定是否走紧急分支。 |
| `emergencyReason` | `核心保留` | 紧急原因必须可回看。 |
| `postApprovalDueAt` | `核心保留` | 紧急补审批治理需要。 |
| `postApprovalCompletedAt` | `核心保留` | 紧急补审批治理需要。 |
| `createdByUserId` | `核心保留` | 责任归属。 |
| `submittedByUserId` | `核心保留` | 责任归属。 |
| `closedByUserId` | `核心保留` | 责任归属。 |
| `submittedAt` | `核心保留` | 流转关键时间。 |
| `deployedAt` | `核心保留` | 发布关键时间。 |
| `closedAt` | `核心保留` | 生命周期关键时间。 |
| `deletedAt` | `保留但技术区` | 治理删除链路字段。 |
| `deletedBy` | `保留但技术区` | 治理删除链路字段。 |
| `deleteRequestId` | `保留但技术区` | 治理删除链路字段。 |
| `deleteReason` | `保留但技术区` | 治理删除链路字段。 |
| `createdAt` | `保留但技术区` | 辅助信息。 |
| `updatedAt` | `保留但技术区` | 辅助信息。 |
| `latestApproval` | `应弱化主路径` | 允许保留关系，但不应让页面以 approval 代替 ticket 本身。 |
| `gateRuns` | `结构化子对象` | gate run 是天然子对象。 |

## `DeleteRequest`

| 字段 | 判断 | 原因 |
| --- | --- | --- |
| `id` | `保留但技术区` | 内部主键。 |
| `requestNo` | `核心保留` | 删除请求业务编号。 |
| `targetType` | `核心保留` | 决定删的是什么。 |
| `targetId` | `保留但技术区` | 运行时定位对象需要，但不适合主展示。 |
| `targetNo` | `核心保留` | 面向运营的查找入口。 |
| `status` | `核心保留` | 删除请求状态主字段。 |
| `latestApprovalId` | `保留但技术区` | 只用于链路跳转。 |
| `latestApprovalStatus` | `核心保留` | 删除治理状态摘要。 |
| `makerUserId` | `核心保留` | 发起责任归属。 |
| `submittedByUserId` | `核心保留` | 提交责任归属。 |
| `executedByUserId` | `核心保留` | 执行责任归属。 |
| `deleteReason` | `核心保留` | 核心业务理由。 |
| `docRef` | `核心保留` | 关联材料仍有价值。 |
| `targetSnapshotJson` | `上下文保留` | 非常重要，但适合作为上下文快照，而不是主字段群的一部分。 |
| `traceId` | `核心保留` | 必须能串治理链路。 |
| `createdAt` | `保留但技术区` | 辅助信息。 |
| `updatedAt` | `保留但技术区` | 辅助信息。 |
| `submittedAt` | `核心保留` | 流转时间。 |
| `executedAt` | `核心保留` | 执行时间。 |
| `latestApproval` | `应弱化主路径` | 审批对象是附属治理链，不应盖过删除请求主体。 |

## `SlaTimer`

| 字段 | 判断 | 原因 |
| --- | --- | --- |
| `id` | `保留但技术区` | 内部主键。 |
| `timerNo` | `核心保留` | SLA 业务编号。 |
| `workflowType` | `核心保留` | 计时器必须知道挂在哪类工作流上。 |
| `workflowId` | `保留但技术区` | 内部绑定 ID，常用于排障。 |
| `workflowNo` | `核心保留` | 面向运营的链路编号。 |
| `subjectType` | `核心保留` | 计时对象类型。 |
| `subjectId` | `保留但技术区` | 内部绑定 ID。 |
| `subjectNo` | `核心保留` | 计时对象业务编号。 |
| `timerType` | `核心保留` | 决定 SLA 语义。 |
| `ownerUserId` | `核心保留` | 当前责任归属。 |
| `status` | `核心保留` | 计时器状态主字段。 |
| `dueAt` | `核心保留` | 最关键的时间字段。 |
| `graceSeconds` | `核心保留` | SLA 计算规则的一部分。 |
| `traceId` | `核心保留` | 用于跨工作流回放。 |
| `contextJson` | `上下文保留` | 适合作为计算上下文，不应继续扩成更多 typed 字段。 |
| `closedAt` | `核心保留` | 生命周期关键时间。 |
| `expiredAt` | `核心保留` | 生命周期关键时间。 |
| `activeKey` | `保留但技术区` | 唯一性控制字段，不是业务主展示字段。 |
| `createdAt` | `保留但技术区` | 辅助信息。 |
| `updatedAt` | `保留但技术区` | 辅助信息。 |
| `notifications` | `结构化子对象` | 通知天然应该作为子对象展开。 |

## `AuditLogEvent`

| 字段 | 判断 | 原因 |
| --- | --- | --- |
| `id` | `保留但技术区` | 内部主键。 |
| `auditNo` | `核心保留` | 审计事件 operator-facing 编号。 |
| `triggerType` | `核心保留` | 审计分类主字段。 |
| `action` | `核心保留` | 最重要的事件动作字段。 |
| `module` | `核心保留` | 事件来源模块仍是查询入口。 |
| `entityType` | `核心保留` | 当前事件触达的实体类型。 |
| `entityId` | `保留但技术区` | 可检索，但更适合作为技术绑定字段。 |
| `entityNo` | `核心保留` | 面向运营的实体编号入口。 |
| `traceId` | `核心保留` | 回放整条链路必须保留。 |
| `workflowType` | `核心保留` | 工作流查询入口。 |
| `workflowId` | `保留但技术区` | 内部工作流 ID。 |
| `workflowNo` | `核心保留` | 工作流业务编号，是运营查询入口。 |
| `entityOwnerType` | `核心保留` | 区分归属主体很有价值。 |
| `entityOwnerId` | `保留但技术区` | 归属内部 ID。 |
| `statusFrom` | `核心保留` | 对状态流转类事件仍有直接阅读价值。 |
| `statusTo` | `核心保留` | 对状态流转类事件仍有直接阅读价值。 |
| `actorType` | `核心保留` | 谁触发的，必须 typed 保留。 |
| `actorId` | `核心保留` | 事件触发者的内部定位。 |
| `actorNo` | `核心保留` | 事件触发者业务编号。 |
| `actorRole` | `核心保留` | 角色语义对审计解释很重要。 |
| `requestId` | `保留但技术区` | 排障有用，但不适合主展示。 |
| `sourceIp` | `保留但技术区` | 排障和安全用途。 |
| `sourcePlatform` | `保留但技术区` | 技术上下文。 |
| `result` | `核心保留` | 成功/失败/拒绝是审计结论主字段。 |
| `reason` | `核心保留` | 结果说明必须可读。 |
| `metadata` | `上下文保留` | 补充上下文，适合作为 JSON。 |
| `beforeData` | `上下文保留` | 变更前快照。 |
| `afterData` | `上下文保留` | 变更后快照。 |
| `idempotencyKey` | `保留但技术区` | 写入治理字段，产品不必默认看到。 |
| `payloadDigest` | `核心保留` | 证据完整性关键字段。 |
| `maskVersion` | `核心保留` | 脱敏规则追溯所需。 |
| `retainedUntil` | `核心保留` | 合规保留字段。 |
| `entityOwnerNo` | `核心保留` | 归属业务编号是运营查询入口。 |
| `archivedAt` | `保留但技术区` | 归档治理字段。 |
| `occurredAt` | `核心保留` | 审计时间轴根字段。 |
| `createdAt` | `保留但技术区` | 辅助信息。 |
| `updatedAt` | `保留但技术区` | 辅助信息。 |
| `subjectNos` | `结构化子对象` | 多个查找锚点必须保留为子对象数组。 |

## Highest-Value Cleanup Targets

### 立刻该收的字段
- `User.role`
  - 只保留 compat 含义，不再当权限真相。
- `ApprovalCase.latestFor*`、`linkedRegulatoryGates`、`internalTransactionForApproval`
  - 这些关系把通用审批表拖进了跨 wave 业务。
- `AuditLogEvent` 的 `entityId / workflowId / requestId / sourceIp`
  - 要保留，但应整体退入技术区。
- `DeleteRequest.targetId`
  - 应留库，但普通详情默认看 `targetNo` 就够了。
- `SlaTimer.workflowId / subjectId / activeKey`
  - 保留，但不应占主页面心智。

### 最不建议动的字段
- 所有 `No` 字段
- 所有主状态字段
- 所有关键时间字段
- `traceId`
- `workflowType / workflowNo`
- `latestApprovalStatus`
- `result`
- `payloadDigest / retainedUntil`

## Bottom Line
- 你说“字段太多”是对的，但其中很多不是“该删”，而是“该退出主视图”。
- 真正该优先收的，不是时间戳，也不是治理字段本身，而是：
  - compat 字段
  - 跨业务直连关系
  - 默认展示层里的技术字段
