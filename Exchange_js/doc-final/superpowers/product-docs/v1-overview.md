# V1 审计底座 — 产品文档总览

Last Updated: 2026-05-13 | 版本状态: MVP 10/10 Workflows 已交付 | 受众: 开发工程师

---

## 一、V1 的业务定位

V1 建立平台的**治理基础设施**。在没有 V1 的情况下，平台无法回答以下三个关键问题：

1. **谁在操作系统？** — 没有受控的管理员入职流程，无法追溯操作者身份
2. **操作是否经过授权？** — 没有审批引擎，高风险操作无法做到双人确认（maker-checker）
3. **发生了什么？** — 没有不可篡改的审计日志，监管审查无从开展

V2–V9 的所有业务操作都依赖 V1 提供的三项能力：**身份可信**、**操作可授权**、**行为可追溯**。

---

## 二、VARA 监管依据

| 监管条款 | 具体要求 | 覆盖的 V1 Workflow |
|---|---|---|
| TIR Rulebook III.A Authentication | 管理员访问必须强制 MFA；首次绑定必须有受控流程和审计证据 | WF02 Admin First Login |
| TIR Rulebook III.A Authentication | 凭证生命周期管理：密码 / MFA 泄露时必须能即时重置 | WF06 Password Reset、WF07 MFA Reset |
| TIR Rulebook III.B Access Control | RBAC 治理 + 最小权限原则 + 职责分离（SoD） | WF01 Admin Invite、WF03 Role Binding Change、WF08 Role Definition CRUD |
| TIR Rulebook III.B.2 Access Control | 离职人员必须完全撤销访问 | WF04 Account Suspension |
| CRM Rulebook II.B Internal Controls | 审批链本身的治理必须自洽且防篡改 | WF10 Approval Policy Management |
| CRM Rulebook III.A Record Keeping | 审计记录必须可导出可验证，保留不少于 8 年 | WF09 Audit Evidence Export |
| Company Rulebook III Governance | 内控与治理 | WF10 Approval Policy Management |

---

## 三、10 个 Workflow 一览

| # | Workflow | 发起人 | 审批门 | VARA 条款 | 文档 |
|---|---|---|---|---|---|
| WF01 | Admin Invite | 任意有权限的管理员 | ✅ 需审批（含 SoD 校验） | TIR III.B | [wf01](wf01-admin-invite.md) |
| WF02 | Admin First Login | 系统自动触发（首次登录时） | ❌ 无审批门 | TIR III.A | [wf02](wf02-admin-first-login.md) |
| WF03 | Admin Role Binding Change | 任意有权限的管理员 | ✅ 需审批（含 SoD 校验） | TIR III.B | [wf03](wf03-admin-role-binding-change.md) |
| WF04 | Admin Account Suspension | 任意有权限的管理员 | ✅ 需审批 | TIR III.B.2 | [wf04](wf04-admin-account-suspension.md) |
| WF05 | Admin Account Reactivation | 任意有权限的管理员 | ✅ 需审批 | TIR III.B.2 | [wf05](wf05-admin-account-reactivation.md) |
| WF06 | Admin Password Reset | 本人（自助路径）或 CISO（代操作路径） | ⚠️ 自助路径无审批门；CISO 代操作路径需审批 | TIR III.A | [wf06](wf06-admin-password-reset.md) |
| WF07 | Admin MFA Reset | CISO / TECH_OFFICER | ✅ 需审批 | TIR III.A | [wf07](wf07-admin-mfa-reset.md) |
| WF08 | Role Definition CRUD | CISO（创建）/ 任意有权限的管理员（修改） | ✅ 需审批（创建 + 修改均需） | TIR III.B | [wf08](wf08-role-definition-crud.md) |
| WF09 | Audit Evidence Export | 任意有权限的管理员 | ✅ 需审批 | CRM III.A | [wf09](wf09-audit-evidence-export.md) |
| WF10 | Approval Policy Management | CISO | ✅ 需审批（checker 硬编码，不可改） | CRM II.B | [wf10](wf10-approval-policy-management.md) |

---

## 四、操作员角色体系

V1 中涉及的角色及其在各 Workflow 中的分工：

| 角色 | 可发起 | 可审批 | 特殊能力 |
|---|---|---|---|
| SUPER_ADMIN | 所有（演示用，正式上线后不存在） | 所有；可自批（SoD 例外，须审计） | — |
| CISO | WF01/03/04/05/06/07/08/09/10 | WF01/03/04/05/07/08/09 + WF10 最终 checker | 可代操作密码重置；可重置他人 MFA；可发起角色定义创建 |
| MLRO | WF01/03/04/05/09 | WF01/03/04/05/09 | — |
| TECH_OFFICER | WF07 发起 | 部分 Workflow | 可重置他人 MFA |
| 其他角色 | 受各 Workflow 的权限配置控制 | 受各 Workflow 的权限配置控制 | — |

> **重要：** SUPER_ADMIN 是演示角色，正式上线后系统中不存在该角色。所有与 SUPER_ADMIN 相关的 SoD 例外逻辑（单人自批），在正式环境中均为不可达路径，开发时不得将此例外当作正常路径设计。

---

## 五、Supporting Features（非独立 Workflow）

以下能力是 V1 Workflow 的底层基础设施，由各 Workflow 调用，不单独作为 Workflow 存在，没有独立的业务状态机。

### 5.1 审批引擎（Approval Engine）

- **功能**：实现 maker-checker 双人确认机制。Maker 发起申请，系统路由至有审批权限的 Checker；Checker 审批通过 / 拒绝。
- **审批状态**：`PENDING` → `APPROVED` / `REJECTED` / `CANCELLED` / `EXPIRED`
- **SoD 保障**：Maker 不能同时担任同一请求的 Checker（SUPER_ADMIN 演示期例外，须审计记录）
- **超时机制**：审批请求有 TTL（由 WF10 Approval Policy 配置），超时后自动进入 `EXPIRED` 状态，触发对应 Workflow 的超时处理路径
- **被以下 Workflow 调用**：WF01、WF03、WF04、WF05、WF06（CISO 代操作路径）、WF07、WF08、WF09、WF10

### 5.2 审计日志（Audit Log）

- **写入规则**：每个有持久状态变化或 operator 可见操作的路径，必须通过 `AuditLogsService` 写入 `audit_log_events` 表
- **不可篡改**：append-only，写入后不可修改或删除
- **保留期**：8 年（`retainedUntil = occurredAt + 8 years`，每行写入时自动计算）
- **traceId**：每个业务序列有且仅有一个 UUID v4，同一序列的所有审计行共享这一 traceId
- **查询支持**：按 `subjectNo` / `actorNo` / `traceId` / 时间范围检索；`traceId` 查询是主要追溯路径

### 5.3 通知服务（Notification）

- **支持渠道**：邮件 + webhook
- **重试策略**：发送失败最多重试 3 次，指数退避，全部失败后写入失败审计
- **V1 中的触发场景**：邀请链接发送（WF01）、密码重置链接发送（WF06）

### 5.4 SoD 规则配置（Separation of Duties）

- **存储形式**：角色互斥表以硬编码常量定义，不可通过 UI 修改
- **校验时机**：① 发起审批请求时做 SoD 预检（快速失败）；② Checker 审批时做运行时二次校验（防止角色变更后绕过）
- **前端展示**：Admin UI 提供 SoD Rules 标签页，供操作员查阅当前生效规则

### 5.5 RBAC 权限校验

- **校验位置**：每次 API 调用在路由层通过 `AdminPermissionGuard` 校验
- **权限来源**：角色-权限绑定从数据库实时读取，不可在业务代码中硬编码角色判断
- **高风险操作**：即使路由层已授权，部分操作还需额外的 action-level 权限校验（例：WF09 导出需 `AUDIT_EXPORT` 权限，WF07 MFA 重置需 `IAM_CREDENTIAL_RESET` 权限）

---

## 六、V1 与后续版本的依赖关系

```
V1（审计底座）
  ├→ V2：需要审批引擎（客户合规操作需要 maker-checker）
  ├→ V2：需要身份可信（每个操作员行为必须可追溯到真实身份）
  └→ V3–V9：需要审计日志（所有业务操作必须有合规证据）
```

**V1 是唯一不依赖其他版本的版本。** 没有 V1，后续任何版本都无法满足 VARA 对操作可信性的要求，也无法通过监管审查。

---

## 七、跨 Workflow 的统一约定

### 7.1 workflowType 与 Workflow 的对应关系

| workflowType 常量 | 覆盖的 Workflow | 说明 |
|---|---|---|
| `ADMIN_INVITE` | WF01 | — |
| `ADMIN_FIRST_LOGIN` | WF02 | — |
| `ADMIN_ROLE_BINDING_CHANGE` | WF03 | — |
| `ADMIN_SUSPENSION` | WF04 | — |
| `ADMIN_REACTIVATION` | WF05 | — |
| `ADMIN_PASSWORD_RESET` | WF06（CISO 代操作路径） | 有审批门的治理路径 |
| `ADMIN_CREDENTIAL_MGMT` | WF06（自助路径）| 自助密码重置，无审批门 |
| `ADMIN_MFA_RESET` | WF07 | — |
| `ROLE_DEFINITION_CREATE` | WF08（创建角色） | — |
| `ROLE_DEFINITION_MODIFY` | WF08（修改角色） | — |
| `AUDIT_EVIDENCE_EXPORT` | WF09 | — |
| `APPROVAL_POLICY` | WF10 | — |

### 7.2 entityType 与业务主体的对应关系

| entityType 常量 | 适用主体 |
|---|---|
| `ACCESS_CONTROL` | 管理员账号、角色绑定变更 |
| `ADMIN_USER` | 管理员用户自身（首登仪式专用） |
| `ADMIN_ROLE_CHANGE_REQUEST` | 角色变更申请（WF03） |
| `AUDIT_EVIDENCE_PACKAGE` | 审计证据包（WF09） |
| `APPROVAL_POLICY` | 审批策略配置（WF10） |
| `PASSWORD_RESET_TOKEN` | 密码重置凭证（WF06） |

### 7.3 operatorKey（业务键）规范

| 业务主体 | operatorKey 格式 | 示例 |
|---|---|---|
| 管理员账号 | `ADM-XXXXXX` | `ADM-001234` |
| 审批案例 | `APR-XXXXXX` | `APR-000789` |
| 审计证据包 | `PKG-XXXXXX` | `PKG-000012` |
| 审批策略 | `actionType` 字段本身作为稳定键 | `ADMIN_INVITE_APPROVAL` |

operatorKey 是 operator 在 UI 中检索和引用记录的主键，禁止以 UUID `id` 作为面向 operator 的主查询键。

### 7.4 审批决定的二次事件分发模式

所有带审批门的 Workflow（WF01/03/04/05/06 CISO路径/07/08/09/10）采用统一的两级事件分发机制：

```
审批引擎 emit → governance.approval.[approved/rejected/cancelled/expired]
                          ↓
Layer 2（薄审批处理器）订阅原始审批事件
  → 过滤 actionType
  → 写审批层审计日志（APPROVAL_GRANTED / APPROVAL_DECLINED / APPROVAL_CANCELLED）
  → emit 二次事件：workflow.[workflow-name].decided
                          ↓
Layer 3（Workflow）订阅二次事件
  → 执行业务动作（状态变更、凭证生成、账号操作等）
  → 写业务审计日志
```

这个模式确保：审批层的职责和业务执行的职责完全分离，互不干扰。
