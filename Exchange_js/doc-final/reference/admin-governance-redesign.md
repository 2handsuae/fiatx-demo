# Admin Governance Redesign — CT/DR Deprecation Plan

Last Updated: 2026-04-29 | Status: Design Complete | C5 已实现；C1/C2/C3/C4b/D1/D2 实现待进行

---

## 1. 背景与动机

Wave 1 原始设计中 `ChangeTicket`（CT）和 `DeleteRequest`（DR）是**通用容器**，通过 `changeType` / `targetType` 字段区分业务意图。这导致：

- 所有变更共用同一个 `CHANGE_TICKET_APPROVAL` actionType，无法按操作类型差异化配置 checker 和超时
- `changeType: RBAC_CATALOG_CHANGE` 是死路（Role Management 只读），名义存在但无实现路径
- 审批记录的 entityRef 指向 CT/DR，不指向真实业务主体，audit trail 语义模糊
- 操作者心智模型混乱："我提交了一个变更单，它创建了一个审批案例"——两个实体描述同一件事

**决策：废弃 CT 和 DR，替换为 7 个具体的治理工作流实体，每个有专属 actionType。**

---

## 2. 替换后的治理工作流目录

### 设计模式说明

分两种模式，判断标准见 §3。

- **闸门模式（Gate）**：主体实体已存在且进入 `PENDING_*` 状态，ApprovalCase.entityRef → 主体 id
- **中间记录模式（Proposal Record）**：主体存在但状态不能动，需独立 Proposal 表存 pending 意图

---

### C1 — Admin Invite（管理员入职）

| 项 | 值 |
|---|---|
| 设计模式 | **闸门模式** — 提前创建 user 记录，状态机承载审批 |
| 主体实体 | `users` 表 |
| 新增状态 | `PENDING_INVITE_APPROVAL → INVITE_SENT → ACTIVE \| EXPIRED` |
| actionType | `ADMIN_INVITE_APPROVAL` |
| checkerRoles | `['CISO']` |
| timeoutHours | `48` |
| 替代 | `ChangeTicket(ADMIN_INVITE)` |

**关键流程节点：**
```
PENDING_INVITE_APPROVAL → approval_granted → INVITE_SENT → account_activated → ACTIVE
                       ↘ approval_declined / withdrawn → 记录终态，user 软删除
```

---

### C2 — Admin Role Binding Change（角色绑定变更）

| 项 | 值 |
|---|---|
| 设计模式 | **中间记录模式** — user 保持 ACTIVE，Proposal 表存 fromRoles/toRoles |
| 主体实体 | 新建 `admin_role_binding_proposals` 表 |
| actionType | `ADMIN_ROLE_BINDING_APPROVAL` |
| checkerRoles | `['CISO']` |
| timeoutHours | `24` |
| 替代 | `ChangeTicket(ROLE_BINDING)` |

**原因**：角色变更审批期间，目标 admin 仍需正常工作，不应进入受限状态；fromRoles/toRoles 无法附在 user 实体字段上。

**执行**：approval_granted 后，系统原子写 `user_roles` 表（同一 DB transaction）并将 proposal 状态置 APPLIED。

---

### C3a — Admin Account Suspension（管理员停用）

| 项 | 值 |
|---|---|
| 设计模式 | **闸门模式** |
| 主体实体 | `users` 表 |
| 新增状态 | `ACTIVE → PENDING_SUSPENSION_APPROVAL → SUSPENDED` |
| actionType | `ADMIN_SUSPENSION_APPROVAL` |
| checkerRoles | `['CISO']` |
| timeoutHours | `24` |
| 替代 | （无前驱，新增流程） |

---

### C3b — Admin Account Reactivation（管理员恢复）

| 项 | 值 |
|---|---|
| 设计模式 | **闸门模式** |
| 主体实体 | `users` 表 |
| 新增状态 | `SUSPENDED → PENDING_REACTIVATION_APPROVAL → ACTIVE` |
| actionType | `ADMIN_REACTIVATION_APPROVAL` |
| checkerRoles | `['CISO']` |
| timeoutHours | `24` |
| 替代 | （无前驱，新增流程） |

C3a / C3b 是两个独立的 workflow，不合并，状态机节点语义不同。

---

### C4b — Approval Policy Modification（审批策略配置变更）

| 项 | 值 |
|---|---|
| 设计模式 | **闸门模式**（要求 `approval_policies` 表先入库） |
| 主体实体 | `approval_policies` 表（当前为硬编码，需 DB 迁移） |
| 新增状态 | `ACTIVE → PENDING_MODIFICATION_APPROVAL → ACTIVE`（变更后覆盖） |
| actionType | `APPROVAL_POLICY_CHANGE_APPROVAL` |
| checkerRoles | `['CISO', 'SENIOR_MANAGEMENT_OFFICER']`（**硬编码，不从 policy 表读取**） |
| timeoutHours | `24` |
| 替代 | （无前驱，新增流程） |

**自我指涉保护**：`APPROVAL_POLICY_CHANGE_APPROVAL` 自身的 checker 必须绕过 policy 表，写死在代码里，防止通过修改自身 policy 规避审批。

**前置条件**：`DEFAULT_APPROVAL_POLICIES` 从 TypeScript 常量迁移为 `approval_policies` 数据库表 + seeding，否则此流程无实体可挂。

---

### C5 — Audit Evidence Export（审计证据包导出）✅ 已实现

| 项 | 值 |
|---|---|
| 设计模式 | **闸门模式** — export 记录先建（`PENDING_APPROVAL`），审批通过后异步生成文件 |
| 主体实体 | `audit_evidence_packages` 表 |
| actionType | `AUDIT_EVIDENCE_EXPORT_APPROVAL`（已存在，保留） |
| checkerRoles | `['MLRO']` |
| timeoutHours | `24` |
| 替代 | 无需替换，已是正确模式 |
| 实现归属 | `AuditEvidenceExportApprovalService`（Plan B 独占审计写入模式） |

**包状态机**：`PENDING_APPROVAL → READY / FAILED / REJECTED / CANCELLED / EXPIRED`

---

### D1 — Admin Account Deletion（管理员账号删除）

| 项 | 值 |
|---|---|
| 设计模式 | **闸门模式** |
| 主体实体 | `users` 表 |
| 新增状态 | `ACTIVE \| SUSPENDED → PENDING_DELETION_APPROVAL → SOFT_DELETED` |
| actionType | `ADMIN_ACCOUNT_DELETION_APPROVAL` |
| checkerRoles | `['CISO']` |
| timeoutHours | `24` |
| 替代 | `DeleteRequest(ADMIN_USER)` |

---

### D2 — Audit Evidence Package Deletion（证据包删除）

| 项 | 值 |
|---|---|
| 设计模式 | **闸门模式** |
| 主体实体 | `audit_evidence_packages` 表 |
| 新增状态 | `READY → PENDING_DELETION_APPROVAL → PURGED` |
| actionType | `AUDIT_EVIDENCE_PACKAGE_DELETION_APPROVAL` |
| checkerRoles | `['MLRO']` |
| timeoutHours | `24` |
| 替代 | `DeleteRequest(AUDIT_EVIDENCE_PACKAGE)` |

---

## 3. 设计模式判断框架

```
主体实体在审批前已存在？
│
├─ 否 ──────────────────────────────────────────→ 必须有独立 Workflow 表
│
└─ 是
    │
    审批期间主体应进入"受限中间态"？（交易受限、登录受限等）
    │
    ├─ 是 ──────────────────────────────────────→ 闸门模式
    │    主体状态机增加 PENDING_* 节点
    │    pending 意图若有结构化数据 → 存 Proposal/Decision record
    │
    └─ 否（主体保持 ACTIVE，不应感知审批）
         │
         pending 意图（如 fromRoles/toRoles）有结构化字段？
         │
         ├─ 是 ──────────────────────────────────→ 中间记录模式（Proposal 表）
         └─ 否 ──────────────────────────────────→ 闸门模式（intent 存 ApprovalCase metadata）
```

---

## 4. User 实体状态机扩展

现有 `users.status` 仅有 `INACTIVE / ACTIVE`，需要扩展：

```
PENDING_INVITE_APPROVAL   → 审批中（C1）
INVITE_SENT               → 邀请已发出，等待激活（C1）
ACTIVE                    → 正常使用
PENDING_SUSPENSION_APPROVAL → 停用审批中（C3a）
SUSPENDED                 → 已停用
PENDING_REACTIVATION_APPROVAL → 恢复审批中（C3b）
PENDING_DELETION_APPROVAL → 删除审批中（D1）
SOFT_DELETED              → 已软删（deletedAt 非空）
```

**注意**：同一用户任何时刻只允许一个 `PENDING_*` 状态存在，提交新的治理请求前须检查是否有进行中的审批。

---

## 5. ApprovalCase 的定位

ApprovalCase 保留为**技术子实体**，不直接暴露给操作者。

- 操作者看到的是具体 workflow 实体（如"这条角色变更申请"）
- ApprovalCase 通过 `entityRef` 与 workflow 主体关联
- Approvals 汇总页（所有待决审批）通过 ApprovalCase 表统一查询，不依赖各 workflow 表 UNION
- 操作者永远不通过 ApprovalCase 详情页访问 workflow——只通过 workflow 详情页看到关联的审批信息

---

## 6. 新增 actionTypes 汇总

| actionType | checkerRoles | timeoutHours | 对应 workflow |
|---|---|---|---|
| `ADMIN_INVITE_APPROVAL` | `['CISO']` | 48 | C1 |
| `ADMIN_ROLE_BINDING_APPROVAL` | `['CISO']` | 24 | C2 |
| `ADMIN_SUSPENSION_APPROVAL` | `['CISO']` | 24 | C3a |
| `ADMIN_REACTIVATION_APPROVAL` | `['CISO']` | 24 | C3b |
| `APPROVAL_POLICY_CHANGE_APPROVAL` | `['CISO', 'SENIOR_MANAGEMENT_OFFICER']` | 24 | C4b（硬编码 checker） |
| `ADMIN_ACCOUNT_DELETION_APPROVAL` | `['CISO']` | 24 | D1 |
| `AUDIT_EVIDENCE_PACKAGE_DELETION_APPROVAL` | `['MLRO']` | 24 | D2 |
| `AUDIT_EVIDENCE_EXPORT_APPROVAL` | `['MLRO']` | 24 | C5（已实现 ✅） |

---

## 7. Audit Log 命名规范

格式：`{domain}.{workflow}.{event}`，domain 固定为 `governance`。

| Workflow | 事件序列 |
|---|---|
| `governance.admin_invite` | `initiated` → `submitted_for_approval` → `approval_granted \| approval_declined \| withdrawn` → `link_dispatched` → `link_expired \| account_activated` |
| `governance.admin_role_binding` | `change_initiated` → `submitted_for_approval` → `approval_granted \| approval_declined \| withdrawn` → `change_applied \| change_apply_failed` |
| `governance.admin_suspension` | `initiated` → `submitted_for_approval` → `approval_granted \| approval_declined \| withdrawn` → `account_suspended` |
| `governance.admin_reactivation` | `initiated` → `submitted_for_approval` → `approval_granted \| approval_declined \| withdrawn` → `account_reactivated` |
| `governance.approval_policy` | `modification_initiated` → `submitted_for_approval` → `approval_granted \| approval_declined \| withdrawn` → `modification_applied \| modification_apply_failed` |
| `governance.audit_evidence_export` | ⚠️ **C5 已实现，但命名方案与本表不同**：实际使用短 UPPERCASE（`EXPORT_REQUESTED` / `APPROVAL_GRANTED` / `APPROVAL_DECLINED` / `APPROVAL_CANCELLED` / `GENERATION_COMPLETED` / `GENERATION_FAILED` / `PACKAGE_DOWNLOADED`），无 `generation_started` 节点，取消动作名为 `APPROVAL_CANCELLED`（非 `withdrawn`）。新 C1-D2 实现时遵循本表 dotted 命名。 |
| `governance.admin_account_deletion` | `initiated` → `submitted_for_approval` → `approval_granted \| approval_declined \| withdrawn` → `account_soft_deleted` |
| `governance.audit_evidence_package_deletion` | `initiated` → `submitted_for_approval` → `approval_granted \| approval_declined \| withdrawn` → `package_purged` |

**命名规则：**
- `initiated` 不用 `requested`（initiated 是动作起点）
- `approval_granted / approval_declined` 不用 `approved / rejected`（语义更精确）
- `withdrawn` 不用 `cancelled`（专指发起人主动撤回）
- `applied` 用于配置生效，`executed` 用于命令式执行，`purged` 用于不可逆销毁
- C3 拆成两个独立 workflow（suspension / reactivation），不合并

---

## 8. CT / DR 迁移策略

| 内容 | 处理方式 |
|---|---|
| `change_tickets` 历史数据 | 保留只读，UI 保留历史查询页但禁止新建 |
| `delete_requests` 历史数据 | 同上 |
| `CHANGE_TICKET_APPROVAL` actionType | 标记为 DEPRECATED，禁止新建对应 ApprovalCase |
| `DELETE_REQUEST_APPROVAL` actionType | 同上 |
| Wave 4 config release CT 门 | 需单独设计替代方案（当前 CT 门为 optional，影响有限）|

---

## 9. 未解决问题（Open Questions）

以下问题在设计讨论中未最终拍板，实现前需确认：

| # | 问题 | 影响范围 |
|---|---|---|
| OQ-1 | SUPER_ADMIN 是否仍可通过 `POST /users`（IAM_ASSIGN）直接创建用户，绕过 C1 审批流程？ | C1 实现 |
| OQ-2 | 重发邀请（resend invite）是否需要审批门，还是保持 IAM_ASSIGN 直接操作？ | C1 实现 |
| OQ-3 | C2 执行失败（change_apply_failed）后的恢复路径：系统自动重试？SUPER_ADMIN 手动覆盖？还是重新提交新 proposal？ | C2 实现 |
| OQ-4 | 同一用户已有进行中的停用审批，此时能否同时提交删除申请？冲突规则是什么？ | C3a / D1 实现 |
| OQ-5 | C4b 依赖 `approval_policies` 表落库，DB 迁移和初始 seeding 策略如何设计？ | C4b 实现（前置条件） |
| OQ-6 | Wave 4 config release 流程中的 CT 门如何替代？（当前文档标注为 optional） | Wave 4 范围 |
| OQ-7 | `CASE_EVIDENCE_EXPORT_APPROVAL`（Wave 2-3 pre-registered）是否纳入本次重设计范围？ | 待定 |

---

## 10. 不在本次范围

- C4a（RBAC Catalog 权限修改）、C4c（角色创建）、C4d（角色停用）→ 见 `roadmap.md` 未来规划项
- C6（认证策略变更）、C7（actionType 生命周期）、C9（外部集成配置）→ 当前为硬编码/DevOps 层，不纳入运行时治理
- C8（手动审计记录写入）→ 低频，暂不做审批门
