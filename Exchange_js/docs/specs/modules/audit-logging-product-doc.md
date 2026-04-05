# 统一审计日志产品文档（Audit Logging）

## 产品背景与目标
平台原有审计能力分散在多个业务表，查询链路割裂、取证成本高。统一审计模块的目标是建立单一审计中心，满足三件事：
- 可追溯：关键操作与关键状态变化能串成完整事件链。
- 可检索：支持按 No 体系快速反查，并把 No 查找与 workflow/trace 查找分开。
- 可取证：支持导出可校验摘要的证据包，形成治理闭环。

## 用户角色与核心场景
- 审计员：按 `subjectNo`、`actorNo`、`entityOwnerNo` 检索跨模块事件链，必要时再用 `traceId + workflowType/workflowNo` 定位流程链路。
- 合规管理员：查询登录、KYT、Travel Rule、状态迁移、人工干预等动作，定位责任人与处理时序。
- 运营管理员：按业务 No（如 `withdrawNo`、`payoutNo`、`customerNo`）追踪异常流程与失败原因。

## Operator-facing 语义规则
页面第一层采用 business-workflow-first 语义，而不是底层 container 名称：
- 一个业务 workflow 实例 = 一条 `traceId`，用于串起该实例内的用户动作与系统执行结果。
- 页面第一层默认展示 `businessWorkflow`、`userAction`、`primaryRefNo`。
- `approval` 是嵌入式治理节点，不是顶层 operator workflow；审批事件应归属于父业务 workflow。
- `Change Ticket` 与 `Delete Request` 是治理容器，不是页面第一层 workflow 名称。
- 删除类流程使用自己的 workflow trace，不继承被删目标对象的 trace。
- raw `action`、`traceId`、`workflowType/workflowNo/workflowId`、`entityType/entityNo` 仅在 technical context 中保留。

## 本轮交付范围
当前阶段重点交付：
- Admin 一级菜单 `Audit Center`，下挂 `Audit Log` 与 `Evidence Packages`。
- Admin 一级菜单 `Control Gates Center`，当前下挂 `Approvals`、`Change Tickets`、`Delete Requests`。
- `Audit Log` 支持 No-first 检索、详情查看、勾选审计事件并创建 evidence export request。
- `Evidence Packages` 支持查看导出申请/已生成记录、进入独立详情页；仅审批通过且包体就绪后允许下载 JSON 证据包。
- `Audit Log` 的事件事实层、`subjectNos[]` 查找层和 context JSON 层需要清晰分层。
- `traceId` 查询与 `subjectNo` 查询必须分离，不再混用语义。
- `Change Tickets` 与 `Delete Requests` 仍作为治理辅助能力保留，但不属于 audit module 的 canonical contract。

## Wave 1 Operator-facing Business Workflows
当前页面第一层只使用以下业务 workflow 语义：
- `ADMIN_MEMBER_PROVISIONING`
- `ADMIN_LOGIN_ACCESS`
- `ADMIN_ROLE_BINDING_CHANGE`
- `CHANGE_TICKET_DELETION`
- `ADMIN_USER_DELETION`
- `AUDIT_EVIDENCE_PACKAGE_DELETION`
- `AUDIT_EVIDENCE_EXPORT`

这些名称用于列表页、详情页、筛选与运营沟通；底层 container 或技术动作不直接作为第一层展示语言。

## Wave 1 User Action Vocabulary
页面第一层用户动作采用稳定、面向运营的 vocabulary，当前包括但不限于：
- `REQUEST_CREATED`
- `SUBMITTED`
- `APPROVED_FOR_EXECUTION`
- `REJECTED`
- `CANCELLED`
- `EXECUTED`
- `EXECUTION_FAILED`
- `RESENT`
- `ACCEPTED`
- `ACCEPT_FAILED`
- `LOGIN_SUCCEEDED`
- `LOGIN_FAILED`
- `EXPORTED`
- `EXPORT_FAILED`

底层 raw `action` 继续完整保留，用于技术排障、取证复核和精细检索。

## 当前接口能力清单
- `POST /admin/audit-logs`：管理员手工补录审计事件。
- `GET /admin/audit-logs`：分页查询，支持 `subjectNo/subjectType/actorNo/entityOwnerNo` 等过滤。
- `GET /admin/audit-logs/:id`：查询单条详情，返回 `subjectNos[]`。
- `POST /admin/audit-logs/export/evidence-package`：按勾选事件创建 evidence export request，并同步创建审批单。
- `GET /admin/audit-logs/evidence-packages`：查看导出记录列表（Evidence Packages）。
- `GET /admin/audit-logs/evidence-packages/:id`：查看导出记录详情（Evidence Package Detail）。
- `GET /admin/audit-logs/evidence-packages/:id/download`：仅在审批通过且包体 `READY` 时下载持久化 JSON 证据包。
- `GET /admin/control-gates/approvals`：查看审批单列表。
- `GET /admin/control-gates/approvals/:id`：查看审批单详情。
- `POST /admin/control-gates/approvals/:id/approve|reject|cancel`：审批决策。
- `POST /admin/control-gates/change-tickets`：创建更改单。
- `GET /admin/control-gates/change-tickets`：查看更改单列表。
- `GET /admin/control-gates/change-tickets/:id`：查看更改单详情。
- `POST /admin/control-gates/change-tickets/:id/submit`：提交审批。
- `POST /admin/control-gates/change-tickets/:id/consume`：消费处理结果。
- `POST /admin/control-gates/delete-requests`：创建删除申请。
- `GET /admin/control-gates/delete-requests`：查看删除申请列表。
- `GET /admin/control-gates/delete-requests/:id`：查看删除申请详情。
- `POST /admin/control-gates/delete-requests/:id/submit`：提交审批。
- `POST /admin/control-gates/delete-requests/:id/cancel`：取消申请。
- `POST /admin/control-gates/delete-requests/:id/consume`：消费处理结果。

## 历史兼容注记
- 旧版更改单发布闭环与定时器能力保留在治理域的历史上下文中，但不作为当前 audit module 的主叙事。

## 后台入口
主入口位于 Admin 后台一级菜单 `Audit Center`：
- `Audit Log`：`/dashboard/audit/audit-logs`
- `Audit Log Detail`：`/dashboard/audit/audit-logs/:id`
- `Evidence Packages`：`/dashboard/audit/evidence-exports`
- `Evidence Package Detail`：`/dashboard/audit/evidence-exports/:id`
- `Approvals`：`/dashboard/control-gates/approvals`
- `Approval Detail`：`/dashboard/control-gates/approvals/:id`
- `Change Tickets`：`/dashboard/control-gates/change-tickets`
- `Change Ticket Create`：`/dashboard/control-gates/change-tickets/create`
- `Change Ticket Detail`：`/dashboard/control-gates/change-tickets/:id`
- `Delete Requests`：`/dashboard/control-gates/delete-requests`
- `Delete Request Create`：`/dashboard/control-gates/delete-requests/create`
- `Delete Request Detail`：`/dashboard/control-gates/delete-requests/:id`

兼容路由仍保留：
- `/dashboard/compliance/audit-logs` -> 跳转到 `/dashboard/audit/audit-logs`

## 查询体验（No 优先检索）
查询默认围绕 No 体系设计，但语义分层要清晰：
- 精确反查：`subjectNo` + `subjectType`。
- 责任人反查：`actorNo`。
- 归属主体反查：`entityOwnerNo`。
- 流程链路反查：`traceId` + `workflowType` + `workflowNo`。
- 时间窗与结果过滤：`startAt/endAt/result`。
- 模糊补充：`keyword` 只用于兜底搜索，不替代 No 精确检索。

`primaryRefNo` 的产品语义是“当前业务 workflow 实例最稳定、最面向运营的主编号”：
- 优先使用 `workflowNo`
- 若无 `workflowNo`，优先使用根业务 `subjectNo`
- 最后才退回技术实体编号

因此 approval 子节点号不应在存在父业务编号时抢占第一层主编号。

## 证据包能力（JSON 单文件、摘要校验、持久化复下载）
证据包输出为单个 JSON 文件，结构固定为：
- `manifest`：导出版本、时间、导出人、筛选条件、记录摘要列表。
- `records`：脱敏后的 typed 审计记录。
- `snapshots`：仅作为补充上下文的可选结构，不定义域特定装配规则。
- `digest`：包级 SHA-256 摘要。

导出动作本身会新增一条 `EVIDENCE_EXPORT` 审计事件，形成闭环留痕。用户下载的内容来自审批通过后持久化的包体，而不是临时重算。

证据导出在页面第一层归属于 `AUDIT_EVIDENCE_EXPORT`：
- 导出申请、审批、执行成功、执行失败共用同一条 trace。
- `approval` 只作为该业务 workflow 内的治理节点展示，不单独抬升为顶层 workflow。

`Evidence Packages` 列表页只展示导出记录摘要，不在底部内嵌 detail。用户点击 `View` 或 `packageNo` 后进入独立的 `Evidence Package Detail` 页，按导出记录字段含义查看：
- 标识类：`packageNo`、`fileName`
- 执行状态类：`status`、`exportMode`、`itemCount`
- 审批类：`approvalCaseId`、`approvalCase.status`
- 操作人类：`exportedByType`、`exportedById`、`exportedByRole`
- 持久化与校验类：`digest`、`createdAt`、`updatedAt`
- 条件快照类：`filterSnapshot`、`selectedEventIdsSnapshot`
- 结果内容类：`manifest`、`packageBody`

## 安全与合规（默认脱敏、8年保留）
- 默认脱敏：`metadata/beforeData/afterData` 递归脱敏后入库。
- 摘要校验：每条记录有 `payloadDigest`，证据包有 `digest`。
- 幂等写入：支持 `idempotencyKey`，避免重试重复记录。
- 数据保留：`retainedUntil = occurredAt + 8年`，由保留任务执行归档标记。

## 业务价值指标与验收口径
核心价值指标（建议作为阶段验收口径）：
- 覆盖率：P0 域关键写路径统一审计覆盖率 >= 95%。
- 可检索性：按 No 查询命中率 >= 99%（含 actor/owner/entity 维度）。
- 可取证性：证据包离线摘要校验通过率 100%。
- 可追责性：失败/拒绝事件 `reason` 字段完整率 >= 99%。

## 已知限制
- 当前证据包仅支持 JSON 单文件，不提供 ZIP/PDF 多格式。
- 当前导出模式仅支持 `Audit Log` 页勾选事件后创建导出申请，不支持按 trace/template 一键导出。
- 查询权限当前限定为 `ADMIN` token。
- 非 No 体系主体不伪造 No，需通过其他字段补充定位。
- 当前文档不把任何域特定 snapshot 组装写成 source-of-truth 规则。

## 路线图（P1/P2）
- P1：
1. 增强证据包下载链路（任务化、批次状态、重试策略）。
2. 增加审计统计看板（按模块/动作/失败率）。
3. 扩展更多自动流程动作的统一审计覆盖。
4. 扩展 `Change Ticket` 审计查询模板与证据导出模板。
- P2：
1. 引入更细粒度的权限分层（审计员/导出员/查看员）。
2. 对接外部归档存储与审计签名链。
3. 增加跨系统审计联查能力（多平台统一检索）。
