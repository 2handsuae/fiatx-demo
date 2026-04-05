Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-04-03
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/cleanup/2026-04-wave1-foundation-reset/change-delete-ticket-minimalization-design.md`, `docs/cleanup/2026-04-wave1-foundation-reset/wave-1-foundation-tightening-bcd-design.md`, `docs/specs/workflows/admin-member-auth-boundary-workflow.md`, `admin-web/src/pages/PlatformMembers.tsx`, `admin-web/src/pages/ChangeTicketDetailPage.tsx`, `admin-web/src/pages/DeleteRequestDetailPage.tsx`
Source of Truth Level: design-note

# Wave 1 Governed Five Flows Design

## Purpose

- 把 5 条最贴近真实运营的 `Wave 1` 流程，统一收进 `治理闸门 -> 审批 -> consume -> 正式生效` 模型。
- 保持业务页发起的自然体验，同时不放弃 `ChangeTicket / DeleteRequest` 作为独立治理令牌。
- 为下一步实现提供唯一设计基线，避免每条流程各自长一套审批和执行逻辑。

## In Scope

- 两条 `ChangeTicket` 流程：
  - `ADMIN_ACCESS_CHANGE`
  - `RBAC_CATALOG_CHANGE`
- 三条 `DeleteRequest` 流程：
  - `CHANGE_TICKET`
  - `ADMIN_USER`
  - `AUDIT_EVIDENCE_PACKAGE`
- `Admin Member Provisioning` 在 consume 之后的 invitation / activation 子流程。
- `PlatformMembers` 中 invitation link 的正式展示位置。

## Out of Scope

- 邮件发送。
- 新建独立 `Platform Member Detail` 路由页面。
- 新增更多 `changeType` 或 `targetType`。
- 把 `resend invitation` 再做成新的 `ChangeTicket`。
- `COMPLIANCE_CASE_EVIDENCE_PACKAGE` 删除流。
- `Evidence Package` 导出流本身；它是独立验收流程。

## Design Summary

- 这 5 条流程统一采用 `方案 C`：
  - 业务页准备信息
  - 系统自动生成治理单
  - 审批通过后治理单进入 `READY`
  - 只有在治理单详情页 `consume` 后，正式业务结果才生效
- 不要求运营先去治理中心手工建单，也不要求手工填写单号。
- 业务页负责“提申请”，治理单详情页负责“执行许可证”。

## Unified Governance Gate Model

### Canonical Flow

1. 用户在业务页填写变更或删除意图。
2. 用户点击业务页按钮提交治理申请。
3. 系统自动创建对应的：
   - `ChangeTicket`
   - 或 `DeleteRequest`
4. 审批通过后，治理单进入 `READY`。
5. 操作员进入治理单详情页点击 `Consume`。
6. 只有 `Consume` 成功后，正式业务动作才落库并生效。

### Product Boundary

- 业务页：
  - 准备意图
  - 自动生成治理单
- 审批：
  - 批准是否允许进入消费环节
- consume：
  - 真正执行正式动作

### Binding Rule

- 业务页发起时，系统必须冻结 `bindingSnapshot`。
- 审批看的是这份冻结后的意图。
- `consume` 执行的也必须是这份冻结后的意图。
- 审批通过后，业务页不能修改原意图内容。
- 如果要改内容，必须重新生成新的治理单。

## Display Labels

### ChangeTicket Display Labels

- `ADMIN_ACCESS_CHANGE`
  - display label: `Admin Member Provisioning`
- `RBAC_CATALOG_CHANGE`
  - display label: `Admin Role Binding Change`

### Internal Enum Stability

- 内部枚举值不改。
- 本轮只改对外展示文案。

## Two Change Flows

### 1. Admin Member Provisioning

#### Entry Page

- `PlatformMembers`

#### Business Input

- `email`
- `roleCodes`
- `changeReason`

#### Business-Page Action

- 按钮文案改成：
  - `Submit Access Change`
- 这个动作不再直接创建正式 `User`。
- 它只创建：
  - `ChangeTicket(changeType=ADMIN_ACCESS_CHANGE)`

#### Frozen Binding Snapshot

- `intent = CREATE_ADMIN_MEMBER`
- `email`
- `roleCodes`
- `changeReason`
- `requestedByUserId`
- `requestedByUserNo`

#### Formal Effect Point

- 审批通过前：
  - 不创建 `User`
  - 不创建 `AdminUserInvitation`
  - 不写正式 `UserRole`
- `consume` 成功后才正式：
  - 创建 `User(INACTIVE)`
  - 创建 `UserRole`
  - 创建首个 `AdminUserInvitation`
  - `ChangeTicket -> DONE`

### 2. Admin Role Binding Change

#### Entry Page

- `PlatformMembers`

#### Business Input

- `targetUserId`
- `targetUserNo`
- `roleCodes`
- `changeReason`

#### Business-Page Action

- 按钮文案改成：
  - `Submit Role Binding Change`
- 这个动作不再直接替换角色绑定。
- 它只创建：
  - `ChangeTicket(changeType=RBAC_CATALOG_CHANGE)`

#### Frozen Binding Snapshot

- `intent = REPLACE_ADMIN_ROLE_BINDINGS`
- `targetUserId`
- `targetUserNo`
- `targetEmail`
- `roleCodes`
- `changeReason`
- `requestedByUserId`
- `requestedByUserNo`

#### Formal Effect Point

- 审批通过前不改 `UserRole`。
- `consume` 成功后才正式：
  - 调用角色绑定替换逻辑
  - 返回新的绑定结果
  - `ChangeTicket -> DONE`

## Three Delete Flows

### Shared Rule

- 业务页不能直接删除正式对象。
- 业务页只负责创建 `DeleteRequest`。
- 只有 `DeleteRequest` 审批通过并被 `consume` 后，正式软删才发生。
- 删除按钮文案统一改成：
  - `Request Deletion`

### 1. Delete Change Ticket

#### Entry Pages

- `ChangeTicketsPage`
- `ChangeTicketDetailPage`

#### Target Rule

- 只能删除终态 `ChangeTicket`：
  - `DONE`
  - `FAILED`
  - `REJECTED`
  - `CANCELLED`

#### Generated Governance Object

- `DeleteRequest(targetType=CHANGE_TICKET)`

#### Formal Effect Point

- `consume` 成功后：
  - 对目标 `ChangeTicket` 写软删字段
  - `DeleteRequest -> DONE`

### 2. Delete Admin User

#### Entry Page

- `PlatformMembers`

#### Generated Governance Object

- `DeleteRequest(targetType=ADMIN_USER)`

#### Formal Effect Point

- `consume` 成功后：
  - 软删目标 `User`
  - revoke 未完成 invitation
  - `DeleteRequest -> DONE`

### 3. Delete Audit Evidence Package

#### Entry Pages

- `EvidenceExportsPage`
- `EvidenceExportDetailPage`

#### Generated Governance Object

- `DeleteRequest(targetType=AUDIT_EVIDENCE_PACKAGE)`

#### Formal Effect Point

- `consume` 成功后：
  - 软删目标 `AuditEvidencePackage`
  - `DeleteRequest -> DONE`

## Admin Invitation And Activation Child Flow

### Why This Is Special

- 5 条流程里，只有 `Admin Member Provisioning` 在 `consume` 后不会立刻“业务完全结束”。
- 它会进入一个正式的 invitation / activation 子流程。

### Chosen Model

- `consume` 负责：
  - 创建 `User(INACTIVE)`
  - 创建首个 `AdminUserInvitation`
- 后续：
  - `resend invitation`
  - `validate invitation token`
  - `accept invitation`
  - `activate account`
  都走 invitation 子流程，不重新开 `ChangeTicket`

### Explicitly Rejected Alternatives

- 不采用“每次 resend 都重新开 change ticket”。
- 不采用“consume 只创建 user，不创建 invitation”。

### Activation Flow

1. `Admin Member Provisioning` 被 `consume`
2. 系统创建：
   - `User(INACTIVE)`
   - first `AdminUserInvitation(PENDING)`
3. 该 member 进入：
   - `Pending Activation`
4. 被邀请人打开 invitation link
5. 系统校验 token
6. 被邀请人设置密码并接受 invitation
7. 系统将：
   - invitation 标记为 consumed
   - user 标记为 `ACTIVE`

### Resend Rule

- `Resend Invite` 不重新开 `ChangeTicket`
- 它继续走 invitation 子流程
- 新 token 生效
- 旧 token 失效

### Change Boundary

- 如果只是补发 invitation：
  - 不开新的治理单
- 如果要改：
  - `email`
  - `roleCodes`
  - 或重新定义这个成员的准入配置
  则必须重新开新的 `ADMIN_ACCESS_CHANGE`

## Invitation Link Delivery

### Explicit Product Decision

- 本轮不发邮件。
- invitation link 由系统内展示和复制。

### Why

- 邮件发送超出本轮范围。
- 当前仓库已经有：
  - invitation link 生成
  - invitation preview
  - resend
  - accept activation
- 因此本轮最自然的收法是：
  - 不新增邮件能力
  - 只把链接展示位置产品化

## PlatformMembers Detail Placement

### Current Problem

- 当前 invitation link 更像页面顶部的临时提示框。
- 这个位置适合短时反馈，不适合长期运营回看。

### Chosen Shape

- 不新建独立 member detail route。
- 在 `PlatformMembers` 内增加一个 `member detail` 面板。

### Detail Panel Sections

1. `Identity`
2. `Invitation & Activation`
3. `Role Bindings`
4. `Governance Actions`

### Invitation Placement

- invitation 信息放在第二块：
  - `Invitation & Activation`
- 它应紧跟 `Identity` 之后展示。

### Why This Position

- 对 `INACTIVE` admin 而言，invitation/activation 是当前最重要的生命周期信息。
- 它比角色展示更值得靠前。
- 但它仍然属于该 member 的身份后续链路，不应压过基础身份区。

### Invitation Fields In Member Detail

#### When Member Is `INACTIVE`

- `Invite Status`
- `Invite Expires At`
- `Invite Link`
- `Copy Invite Link`
- `Resend Invite`

#### When Member Is `ACTIVE`

- 保留 invitation 历史信息，但弱化展示
- 不再强调 `Copy Invite Link`
- 更适合显示：
  - `Last Invitation Status`
  - `Consumed At` or `Completed`

### Global Invite Banner Rule

- 当前顶部全局 `invitePayload` 蓝色提示框不再作为长期主展示位。
- 它最多只保留为：
  - 刚创建成功
  - 或刚 resend 成功
  的短时反馈提示。
- canonical 展示位只有一个：
  - `PlatformMembers -> member detail -> Invitation & Activation`

## Page-To-Ticket Connection

### Business Pages

- 业务页按钮不再直接提交正式动作。
- 业务页只负责：
  - 收集输入
  - 生成治理单
  - 引导用户打开治理单

### Governance Detail Pages

- `consume` 不放回业务页。
- `consume` 统一只放在：
  - `ChangeTicketDetailPage`
  - `DeleteRequestDetailPage`

### UX Rule

- 业务页负责“提申请”
- 治理单详情页负责“执行许可证”

## Formal Effect Matrix

### Admin Member Provisioning

- formal effect at:
  - `ChangeTicket consume`
- effect:
  - create `User`
  - create `UserRole`
  - create first invitation

### Admin Role Binding Change

- formal effect at:
  - `ChangeTicket consume`
- effect:
  - replace user role bindings

### Delete Admin User

- formal effect at:
  - `DeleteRequest consume`
- effect:
  - soft delete user
  - revoke pending invitation

### Delete Audit Evidence Package

- formal effect at:
  - `DeleteRequest consume`
- effect:
  - soft delete evidence package

### Delete Change Ticket

- formal effect at:
  - `DeleteRequest consume`
- effect:
  - soft delete terminal change ticket

## Delivery Order

### Recommended Sequence

1. `Admin Member Provisioning`
2. `Admin Role Binding Change`
3. `Delete Admin User`
4. `Delete Audit Evidence Package`
5. `Delete Change Ticket`

### Why This Order

- `PlatformMembers` 是最复杂、也最值钱的一条真实运营链路。
- 先把：
  - 创建成员
  - 角色变更
  - 删除成员
  做完整，能先打通最大的治理闭环。
- `Delete Audit Evidence Package` 是独立主体，适合用来验证 delete gate 可复用到非 identity 主体。
- `Delete Change Ticket` 应最后做，因为它依赖 change ticket 自己的主流程已经稳定。

## Acceptance Focus

- 业务页是否只生成治理单，而不提前写正式业务结果
- 审批通过后是否统一进入 `READY`
- 只有 `consume` 才会产生正式生效结果
- `Admin Member Provisioning` 的 consume 后是否顺利进入 invitation / activation 子流程
- invitation link 是否稳定地展示在 `PlatformMembers` 的 member detail 面板中
- `Resend Invite` 是否继续走 invitation 子流程，而不是重新开 change ticket

