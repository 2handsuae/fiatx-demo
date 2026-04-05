Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-04-02
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/cleanup/2026-04-wave1-foundation-reset/README.md`, `docs/cleanup/2026-04-wave1-foundation-reset/wave-1-subject-table-dictionary-and-minimal-model-review.md`, `docs/cleanup/2026-04-wave1-foundation-reset/wave-1-core-table-field-necessity-review.md`, `docs/constraints/backend-identity-and-operator-key-constraints.md`, `docs/constraints/backend-read-model-constraints.md`, `prisma/schema.prisma`
Source of Truth Level: review-note

# Wave 1 No-First Missing Field Review

## Purpose
- 本文档只回答一个问题：
  - 在我们已经整理出的 `Wave 1` 精简版字段基础上，如果继续执行既有后端规范
    - 主体要有自己的 `No / code / compositeRef`
    - 关联主体不要只绑 `id`，还要尽量成对绑 `No / code`
  - 那么当前 schema 还缺什么。
- 本文档不讨论业务流程改造。
- 本文档不要求所有字段都落回数据库主表，它先回答“逻辑上缺没缺”。

## Review Baseline
- 约束 1：一等主体不能只有 `id`，必须有 operator-facing key。
- 约束 2：当一个主体在运营页面里经常与另一个主体一起出现时，read-model 和字段设计都不应只靠裸 `id`。
- 约束 3：工作流绑定对象应稳定保留 `workflowId + workflowNo + traceId`。
- 约束 4：子对象不必发明新的全局 `No`，但应该具备父对象锚定的组合引用输入。

## Gap Levels

| 等级 | 含义 |
| --- | --- |
| `一级缺口` | 主体自己缺少 operator-facing key。 |
| `二级缺口` | 已经有主体自己的 `No`，但对常用关联对象只存了 `id`，没有配套 `No / code`。 |
| `三级缺口` | 子对象没有全局 `No` 也可以，但还缺父对象锚定的组合引用输入。 |

## Executive Summary

| 表 | 当前状态 | 建议补充 | 等级 | 结论 |
| --- | --- | --- | --- | --- |
| `AdminUserInvitation` | 只有 `id`，没有自己的 `No` | `invitationNo`, `userNo`, `createdByUserNo` | `一级 + 二级` | 这是本轮最基础的 identity 缺口。 |
| `ApprovalCase` | 有 `approvalNo`，但被审批对象和用户关联仍偏 `id-only` | `entityType`, `entityId`, `entityNo`, `makerUserNo`, `decisionByUserNo` | `二级` | `entityRef` 太黑盒，不利于统一。 |
| `AuditEvidencePackage` | 有 `packageNo`，但审批和导出人仍偏 `id-only` | `approvalCaseNo`, `exportedByNo` | `二级` | 当前详情页仍容易落回 `approvalCaseId / exportedById`。 |
| `ComplianceCaseEvidencePackage` | 同上 | `approvalCaseNo`, `exportedByNo` | `二级` | 与审计证据包应该保持同构。 |
| `ChangeTicket` | 有 `ticketNo`，但审批号和操作者编号依赖 join/投影 | `latestApprovalNo`, `createdByUserNo`, `submittedByUserNo`, `closedByUserNo` | `二级` | 当前 detail 仍直接显示 userId。 |
| `DeleteRequest` | 有 `requestNo` 和 `targetNo`，但审批号和操作者编号依赖 join/投影 | `latestApprovalNo`, `makerUserNo`, `submittedByUserNo`, `executedByUserNo` | `二级` | 当前 detail 仍直接显示 userId。 |
| `SlaTimer` | `timerNo/workflowNo/subjectNo/traceId` 已完整 | `ownerUserNo` | `二级` | 当前列表和详情都还是 `ownerUserId`。 |
| `ApprovalStep` | 只有 `approvalCaseId + stepNo` | `approvalNo` | `三级` | 不必发明新的 `stepNo` 体系，但要能和父审批形成组合引用。 |
| `ChangeTicketGateRun` | 只有 `ticketId + targetEnv + releaseVersion` | `ticketNo`, `operatorUserNo` | `三级 + 二级` | 已经天然是组合引用，只差父键和操作者 No。 |

## Detailed Review

### `AdminUserInvitation`

**当前问题**
- 它在我们当前 review 口径里被当成 `Wave 1` 主体表，但 schema 只有 `id`，没有自己的 operator-facing key。
- 它还只记录了 `userId`、`createdByUserId`，没有配套的 `userNo`、`createdByUserNo`。
- 当前代码里，邀请结果和激活页实际非常依赖 `user.userNo`，说明运营识别语言已经是 `userNo`，只是邀请表本体没有跟上。

**建议补充**
- `invitationNo`
- `userNo`
- `createdByUserNo`

**建议理由**
- 这是一个独立生命周期对象：可创建、可重发、可过期、可撤销、可消费。
- 既然它会被单独查看和回放，就不应该只能靠 `id`。
- 最小化设计不是让它继续裸奔，而是让它至少具备“自己是谁”和“关联的人是谁”的人类可读键。

### `ApprovalCase`

**当前问题**
- `approvalNo`、`workflowNo`、`traceId` 已经比较完整。
- 真正不统一的是审批目标仍被压缩成一个 `entityRef`。
- `entityRef` 在逻辑上混合了“目标类型是什么”“目标 id 是什么”“目标 No 是什么”这 3 件事。
- 同时，`makerUserId`、`decisionByUserId` 没有配套 `makerUserNo`、`decisionByUserNo`。

**建议补充**
- `entityType`
- `entityId`
- `entityNo`
- `makerUserNo`
- `decisionByUserNo`

**建议理由**
- 如果一个审批对象要做到逻辑合理、审美统一，它不应只知道自己“批了一个 ref”。
- 最起码应该能标准表达：
  - 批的是哪类对象
  - 该对象的内部主键
  - 该对象的 operator-facing key
- 如果担心改动过大，`entityRef` 可以先作为兼容字段保留，但不应继续当唯一绑定真相。

### `AuditEvidencePackage`

**当前问题**
- 主体自己的 `packageNo` 已完整。
- 但常用关联只落了 `approvalCaseId` 和 `exportedById`。
- 详情页现在还会展示 `Exporter ID`，审批号则通过关联对象再取一次。

**建议补充**
- `approvalCaseNo`
- `exportedByNo`

**建议理由**
- 证据包是治理主体，不只是文件壳子。
- 运营真正要看的不是“哪个 UUID 导出的”，而是“哪个管理员编号导出的”“挂的是哪个审批号”。
- 这两个字段是高价值补充，不会把模型补肥。

### `ComplianceCaseEvidencePackage`

**当前问题**
- 结构和 `AuditEvidencePackage` 几乎同形，但同样缺少关联 No。
- 当前列表和详情页也是：
  - 审批号通过 `approvalCase?.approvalNo` 补
  - 导出人主要展示 `exportedById`

**建议补充**
- `approvalCaseNo`
- `exportedByNo`

**建议理由**
- 两张证据包表如果要看起来优美、统一，就不应一张有完整配套、一张没有。
- 这类镜像主体最怕“字段语义平行，但命名和完备度不平行”。

### `ChangeTicket`

**当前问题**
- 主体自己的 `ticketNo` 很好。
- 但它对审批和操作者的关联仍然只有一半完整：
  - `latestApprovalId` 有，但 `latestApprovalNo` 不在表里
  - `createdByUserId`、`submittedByUserId`、`closedByUserId` 有，但没有 `...UserNo`
- 当前 service 实际已经在 read-model 中拼 `latestApprovalNo`，而详情页则直接展示原始 userId。

**建议补充**
- `latestApprovalNo`
- `createdByUserNo`
- `submittedByUserNo`
- `closedByUserNo`

**建议理由**
- 这是很典型的“主体自身规范已完成，但关联规范只做了一半”。
- 补齐后，后台 detail 就不需要持续把 `id` 当作人类展示值。
- 这也是最符合你“简洁、优美、统一”的一类修补。

### `DeleteRequest`

**当前问题**
- `requestNo` 和 `targetNo` 已经做得不错。
- 缺口在于它和审批、操作者的配对还不对称：
  - `latestApprovalId` 有，`latestApprovalNo` 不在表里
  - `makerUserId`、`submittedByUserId`、`executedByUserId` 有，但没有对应 `...UserNo`
- 当前 service 也在投影里补 `latestApprovalNo`，detail 页则直接展示 `Submitted By / Executed By` 的 userId。

**建议补充**
- `latestApprovalNo`
- `makerUserNo`
- `submittedByUserNo`
- `executedByUserNo`

**建议理由**
- 删除请求本身已经是 No-first 体系里最接近完整的一张表。
- 差的正是“谁发起、谁提交、谁执行、挂了哪张审批单”这些运营最自然要读的键。

### `SlaTimer`

**当前问题**
- `timerNo`、`workflowNo`、`subjectNo`、`traceId` 已经很统一。
- 唯一显眼的不协调点，是 `ownerUserId` 没有对应 `ownerUserNo`。
- 当前列表筛选和详情展示都还是 `ownerUserId` 语言。

**建议补充**
- `ownerUserNo`

**建议理由**
- 这是一个非常典型的“小补丁大收益”字段。
- 一旦补上，SLA 页的默认筛选和展示都可以从 UUID 语言切回运营语言。

## Support Table Review

### `ApprovalStep`

**当前问题**
- 当前有 `approvalCaseId + stepNo`，但没有 `approvalNo`。
- 按既有规范，子对象不一定要发明自己的全局 `No`，但应该能够靠父对象 operator key 拼出组合引用。

**建议补充**
- `approvalNo`

**建议理由**
- 有了 `approvalNo + stepNo`，这张表就天然具备稳定组合引用。
- 不需要再造一个全局 `approvalStepNo`。

### `ChangeTicketGateRun`

**当前问题**
- 当前有 `ticketId + targetEnv + releaseVersion`，已经很接近规范想要的组合引用。
- 但还差一个 operator-facing 父键 `ticketNo`。
- 同时 `operatorUserId` 没有配套 `operatorUserNo`。

**建议补充**
- `ticketNo`
- `operatorUserNo`

**建议理由**
- 补 `ticketNo` 后，这张表已经天然满足 `${ticketNo}:${targetEnv}:${releaseVersion}` 的组合引用语义。
- 同样不需要额外再造一个全局 `gateRunNo`。

## No Immediate Missing Fields

以下表在本轮 `No-first / id+No` 审查里，没有发现必须立刻补的新 identity 字段：

- `User`
- `Role`
- `Permission`
- `AuditLogEvent`
- `AuditLogSubjectNo`

原因很简单：
- 它们自己的 operator-facing key 已存在。
- 或者像 `AuditLogEvent` 一样，已经同时具备 `auditNo`、`entityNo`、`actorNo`、`workflowNo`、`subjectNos[]` 这类多层锚点。

## Recommended Minimal Supplement Set

如果只做一轮“既能统一，又不把模型补肥”的补充，我建议只补下面这组：

1. `AdminUserInvitation`
   - `invitationNo`
   - `userNo`
   - `createdByUserNo`
2. `ApprovalCase`
   - `entityType`
   - `entityId`
   - `entityNo`
   - `makerUserNo`
   - `decisionByUserNo`
3. `AuditEvidencePackage`
   - `approvalCaseNo`
   - `exportedByNo`
4. `ComplianceCaseEvidencePackage`
   - `approvalCaseNo`
   - `exportedByNo`
5. `ChangeTicket`
   - `latestApprovalNo`
   - `createdByUserNo`
   - `submittedByUserNo`
   - `closedByUserNo`
6. `DeleteRequest`
   - `latestApprovalNo`
   - `makerUserNo`
   - `submittedByUserNo`
   - `executedByUserNo`
7. `SlaTimer`
   - `ownerUserNo`
8. `ApprovalStep`
   - `approvalNo`
9. `ChangeTicketGateRun`
   - `ticketNo`
   - `operatorUserNo`

## What Not To Add In This Round

- 不要为了“整齐”给每个子表硬造全局 `No`。
- 不要把所有技术关联都机械补一份 `...No`，只补那些当前运营页、detail 页、read-model 已经在反复用到的关联。
- 不要把这次审查变成流程重设计；本轮重点是 identity contract 的缺口补齐。
