# WF01 Admin Invite — 产品文档

Last Updated: 2026-05-07 | Workflow 状态: ✅ 已交付 | workflowType: `ADMIN_INVITE`

---

## 一、业务目的与监管依据

**解决什么问题：** 管理员账号的创建属于高风险操作。没有受控流程时，任意有系统访问权限的人都可以直接创建并激活另一个管理员账号，无法防止未经授权的账号入驻，事后也无法证明账号创建的合法性。

**VARA 依据：** TIR Rulebook III.B Access Control — 管理员账号创建必须满足最小权限原则和职责分离（SoD）要求。单人自批创建管理员账号，违反 SoD 原则。

**没有这个 Workflow 会怎样：** 无法向 VARA 监管机构证明平台的管理员账号都经过双人确认的受控流程入驻。任何内部人员滥权创建账号的行为都无法被事前阻止，也无法在事后审计中被发现。

---

## 二、参与角色与权限

| 角色 | 能做什么 | 所需权限 |
|---|---|---|
| **Maker（任意有权限的管理员）** | 发起邀请请求（填写邮箱 + 角色 + 原因） | `IAM_USER_CREATE` |
| **Checker（CISO / MLRO 等）** | 审批通过 / 拒绝邀请请求 | `IAM_INVITE_APPROVE` |
| **被邀请人** | 点击邮件中的邀请链接，设置密码，激活账号 | 无需系统账号（公开接口） |

**SoD 规则：** Maker 不能同时是同一请求的 Checker。即：发起邀请的人不能审批自己的申请。

> SUPER_ADMIN 是唯一例外（可自批），但这是演示用角色，正式上线后不存在。任何以 SUPER_ADMIN 自批为前提的设计，在正式环境中均为无效路径。

---

## 三、操作流程（操作员视角）

### 3.1 触发条件

需要为新员工创建管理员账号时，由有权限的操作员手动在平台内发起。

### 3.2 正常路径（发起 → 审批通过 → 激活）

**第一步：Maker 发起邀请**
- 进入 Platform Members 列表页（`/dashboard/members`）
- 点击"Invite New Member"
- 填写：目标邮箱、角色（支持多选）、邀请原因
- 提交后，系统创建**临时账号**，状态为 `PENDING_INVITE_APPROVAL`，同时提交审批请求
- 操作员在列表页可看到该账号的 `PENDING_INVITE_APPROVAL` 状态

**第二步：Checker 审批**
- Checker 在 Approvals 页面（`/dashboard/control-gates/approvals`）看到待处理请求
- 请求详情展示：申请人、目标邮箱、申请角色、申请原因
- Checker 点击"Approve"

**第三步：系统发送邀请邮件**
- 审批通过后，系统自动生成邀请 token 并发送邮件至目标邮箱
- 账号状态变为 `INVITE_SENT`
- 邀请链接有有效期（由系统配置，默认 72 小时）

**第四步：被邀请人激活账号**
- 点击邮件中的邀请链接，跳转至激活页面（`/admin/activate?token=xxx`，公开页面，无需登录）
- 页面显示：邮箱地址、分配的角色、链接有效期
- 填写密码并提交，账号状态变为 `ACTIVE`
- 激活完成，跳转至登录页

> 账号激活后，该管理员首次登录将自动触发 **WF02 Admin First Login**（强制 MFA 绑定仪式）。

### 3.3 审批拒绝路径

- Checker 点击"Reject"并填写拒绝原因
- 系统**物理删除**该临时账号记录
- 审批案例和审计日志保留完整记录（不依赖账号记录）

> **为什么是物理删除？** 被拒绝的邀请意味着这个人从未合法入驻系统。保留一条 `REJECTED` 状态的账号记录会污染成员列表，且对后续重新邀请同一邮箱造成干扰（邮箱唯一性约束会误报冲突）。审计证据在 `audit_log_events` 和审批案例中保留，与账号记录无关。

### 3.4 Maker 撤销路径

- 在审批结果出来之前，Maker 可在 Approvals 页面撤销自己的申请
- 账号同样**物理删除**
- 审计日志记录撤销行为及撤销人

### 3.5 审批超时路径

- 审批请求超过 TTL（由 WF09 配置的审批超时时长）无人响应
- 系统自动将审批状态标记为 `EXPIRED`
- 账号同样**物理删除**
- 审计日志记录超时行为

### 3.6 重发邀请路径

- **前提**：账号状态为 `INVITE_SENT`（已审批通过，但被邀请人尚未激活）
- **操作**：进入成员详情页，点击"Resend Invitation"
- **效果**：原邀请 token 立即作废，生成新 token，重新发送邮件，有效期重新计算
- **无需重新审批**（审批已通过，只是重新触发链接发送）

---

## 四、状态语义

`status` 字段存储在管理员账号记录（`admin_users` 表）上。

| 状态 | 业务含义 | 操作员在哪里看到 |
|---|---|---|
| `PENDING_INVITE_APPROVAL` | 邀请申请已提交，等待 Checker 审批 | Platform Members 列表、对应 Approval 详情页 |
| `INVITE_SENT` | 审批通过，邀请邮件已发出，等待被邀请人点击链接激活 | Platform Members 列表和详情页 |
| `ACTIVE` | 账号已激活，可以正常登录 | Platform Members 列表和详情页 |
| （无记录） | 申请被拒绝 / 撤销 / 超时，账号已物理删除 | 仅在 Audit Logs 和 Approvals 历史记录中可见 |

> `PENDING_SUSPENSION_APPROVAL` 和 `SUSPENDED` 状态属于 WF04 / WF05，本 Workflow 不涉及。

**状态流转图：**

```
[Maker 发起] → PENDING_INVITE_APPROVAL
    ├── 审批通过 → INVITE_SENT → [被邀请人激活] → ACTIVE
    ├── 审批拒绝 → [物理删除]
    ├── Maker 撤销 → [物理删除]
    └── 审批超时 → [物理删除]

INVITE_SENT
    └── 重发邀请 → INVITE_SENT（状态不变，token 替换）
```

---

## 五、业务规则与前置条件

### 5.1 发起前置条件

- 目标邮箱在系统中不存在活跃账号（邮箱唯一性约束，含 `PENDING_INVITE_APPROVAL` 状态的临时账号）
- 发起人持有 `IAM_USER_CREATE` 权限
- 申请的角色必须存在于系统角色表中（不接受未定义的 roleCode）

### 5.2 不可绕过的业务规则

- **SoD**：同一申请的 Maker 和 Checker 不能是同一人。系统在发起时做预检，在审批时做运行时二次校验（防止审批期间角色变更导致的绕过）
- **邀请 token 安全**：token 以 SHA-256 哈希后存储，数据库中不保存明文 token；token 被消费（激活成功）后立即作废；重发时旧 token 立即作废，不允许两个有效 token 并存
- **激活页无需认证**：激活页面是公开接口（持有 token 即可访问），系统依赖 token 的有效性和时效性控制安全，不依赖登录状态

### 5.3 密码安全规范

- 被邀请人在激活页自行设置密码（系统不预设密码、不发送临时密码）
- 密码要求由全局密码策略控制（最小长度、复杂度等），具体规则以实现时的策略配置为准
- 密码以 bcrypt 哈希存储，不可逆

---

## 六、合规证据覆盖

### 6.1 审计事件清单

同一邀请流程的所有审计行共享同一个 `traceId`（在 Maker 发起时生成，贯穿全流程）。

| 审计事件 | 触发时机 | 记录层 | 合规意义 |
|---|---|---|---|
| `INVITE_REQUESTED` | Maker 提交邀请申请 | Layer 3 Workflow | 记录"谁申请让谁以什么角色入驻" |
| `APPROVAL_GRANTED` | Checker 审批通过 | Layer 2 审批处理器 | 双人确认的书面证据 |
| `APPROVAL_DECLINED` | Checker 拒绝 | Layer 2 审批处理器 | 记录拒绝决定及拒绝人、拒绝原因 |
| `APPROVAL_CANCELLED` | Maker 撤销 或 系统超时 | Layer 2 审批处理器 | 记录撤销 / 超时行为 |
| `INVITE_LINK_DISPATCHED` | 邀请邮件发送成功 | Layer 3 Workflow | 记录链接发出时间点（可追溯邮件送达时序） |
| `INVITE_CANCELLED` | 申请被拒绝 / 撤销 / 超时，账号物理删除 | Layer 3 Workflow | 记录账号清理动作（证明无僵尸账号） |
| `ACCOUNT_ACTIVATED` | 被邀请人激活账号 | Layer 3 Workflow | 记录账号正式生效时间点（作为身份确立证据） |

> `INVITE_LINK_DISPATCHED` 和 `APPROVAL_GRANTED` 同属于"审批通过"的后续动作，共享同一 `traceId`，但是两条独立的审计记录——前者由 Layer 3 写，后者由 Layer 2 写。

### 6.2 数据保留

- 所有审计日志保留 8 年（`retainedUntil = occurredAt + 8 years`）
- 账号即使被物理删除，审计日志中的相关记录仍完整存在（`entityId` 指向已删除账号的 UUID，但日志行本身不受影响）
- 审批案例（`ApprovalCase`）记录独立保留，通过 `traceId` 可关联到审计日志全链

---

## 七、关联工作流

| 关系类型 | 关联 Workflow | 说明 |
|---|---|---|
| **后续触发** | WF02 Admin First Login | 账号激活（`ACTIVE`）后，首次登录时系统自动触发 WF02 的首登仪式 |
| **逻辑后继** | WF03 Admin Role Binding Change | 账号激活后，若角色需要变更，走 WF03 |
| **逻辑后继** | WF04 Admin Account Suspension | 账号 `ACTIVE` 后，若需停用，走 WF04 |
| **基础设施依赖** | 审批引擎（Supporting Feature） | WF01 通过审批引擎实现 maker-checker 双人确认 |
| **基础设施依赖** | 通知服务（Supporting Feature） | 邀请邮件通过通知服务发送，失败后有重试 |
