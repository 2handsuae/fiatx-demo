# Admin First Login Workflow — Design Spec

Date: 2026-05-06 | Author: brainstorm session | Status: APPROVED

---

## 背景与目标

管理员通过 Admin Invite 流程激活账号后，首次登录必须完成一个受控仪式：展示身份信息 → 绑定 TOTP MFA → 验证绑定 → 确认安全须知。完成后才获得完整的 JWT 访问权限。

VARA 依据：TIR Rulebook III.A Authentication — MFA 是管理访问的强制要求，首次绑定必须有受控流程和审计证据。

此 workflow 无审批门（无 Layer 2），但有完整状态机和每步审计打点。

---

## 范围

**In scope（本次实现）：**
- 首次登录 4 步向导（身份确认 → MFA 绑定 → 安全须知确认 → 完成）
- firstLoginToken 机制（受限 JWT，scope: "first_login"）
- TOTP MFA 绑定（基于 `otplib`，Google Authenticator 兼容）
- 后续正常登录的 MFA 验证步骤（密码通过后追加 TOTP 验证）
- 完整审计日志覆盖

**Out of scope（后续 workflow）：**
- Admin MFA Reset（设备丢失恢复，独立 workflow）
- Admin Password Reset（独立 workflow）
- MFA 备用码（MVP 不做）
- 硬件密钥 / WebAuthn

---

## 状态机

### firstLoginStatus（存储在 admin_users 表）

```
PENDING_IDENTITY_CONFIRM
  → [POST /first-login/confirm-identity] →
MFA_BINDING
  → [POST /first-login/mfa/init] → （留在 MFA_BINDING，生成 secret）
  → [POST /first-login/mfa/verify, 验证通过] →
POLICY_ACK_PENDING
  → [POST /first-login/policy/acknowledge] →
COMPLETED
```

注意：`mfa/verify` 成功后直接转 `POLICY_ACK_PENDING`，不存在独立的 `MFA_VERIFIED` 中间状态。

错误路径：
- `mfa/verify` 验证失败：留在 `MFA_BINDING`，`mfaVerifyFailCount` 累加
- 连续失败 5 次：锁定 15 分钟（`mfaVerifyLockedUntil` 字段），返回 429

### 后续正常登录的 MFA 状态

正常登录流程在 `firstLoginStatus = COMPLETED` 后生效，不存储独立状态，通过 mfaSessionToken 中间态管控。

---

## Pre-flight Checklist（per backend-platform.md）

- **Trigger**：`POST /admin/auth/login` 账号密码验证通过，后端发现 `firstLoginStatus ≠ COMPLETED` 时触发
- **Emitted events**：无（此 workflow 不发出内部 domain event）
- **Subscribed events**：无
- **Direct cross-module dependencies**：`AuditLogsService`（audit-logging module）
- **Audit actions**：见下方 Audit Actions 清单
- **Approval sub-workflow**：无

---

## 后端设计

### 1. Schema 变更（admin_users 表）

新增字段：

```prisma
firstLoginStatus      FirstLoginStatus  @default(PENDING_IDENTITY_CONFIRM)
mfaSecret             String?           // TOTP base32 secret，加密存储
mfaEnabledAt          DateTime?
mfaVerifyFailCount    Int               @default(0)
mfaVerifyLockedUntil  DateTime?
securityAckAt         DateTime?
firstLoginTraceId     String?           // 整个首次登录序列的 traceId（UUID v4）
```

新增 enum：

```prisma
enum FirstLoginStatus {
  PENDING_IDENTITY_CONFIRM
  MFA_BINDING
  POLICY_ACK_PENDING
  COMPLETED
}
```

### 2. 新文件清单

| 文件 | 层次 | 说明 |
|---|---|---|
| `identity/users/first-login-workflow.service.ts` | Layer 3 | 编排所有步骤转换，写审计日志 |
| `identity/auth/guards/first-login.guard.ts` | Guard | 校验 JWT scope === "first_login" |
| `identity/auth/first-login.controller.ts` | Controller | 路由 `/admin/auth/first-login/*` |
| `identity/auth/dto/first-login.dto.ts` | DTO | 各步骤请求/响应体 |

### 3. 修改文件清单

| 文件 | 改动 |
|---|---|
| `identity/auth/auth.service.ts` | login 方法：密码通过后检查 firstLoginStatus，分叉返回 firstLoginToken 或 mfaSessionToken |
| `identity/users/users.domain.service.ts` | 新增 firstLoginStatus 相关写方法（接受可选 tx） |
| `identity/users/users.module.ts` | 注册新 Service 和 Controller |
| `prisma/schema.prisma` | 新增字段和 enum |

### 4. firstLoginToken 规格

- 签名密钥：与正常 JWT 相同（`JWT_SECRET`）
- Payload：`{ sub: adminId, scope: "first_login", iat, exp }`
- 有效期：15 分钟（无活动续期，操作前 5 分钟警告倒计时）
- `FirstLoginGuard`：校验 `payload.scope === "first_login"`
- `AdminPermissionGuard`（所有其他接口）：拒绝 `scope === "first_login"` 的 token，返回 403

### 5. API 接口

所有 first-login 接口由 `FirstLoginGuard` 保护（无 RBAC，有 scope 校验）。

#### 登录入口（修改现有接口）

`POST /admin/auth/login`

正常响应（firstLoginStatus = COMPLETED，且 mfaEnabled）：
```json
{ "status": "MFA_REQUIRED", "mfaSessionToken": "..." }
```

首次登录响应（firstLoginStatus ≠ COMPLETED）：
```json
{ "status": "FIRST_LOGIN_REQUIRED", "firstLoginToken": "..." }
```

#### 首次登录接口

`GET /admin/auth/first-login/status`
- 返回当前步骤，用于页面刷新恢复
- 响应：`{ currentStep: "MFA_BINDING" }`

`POST /admin/auth/first-login/confirm-identity`
- 无请求体
- 状态转换：`PENDING_IDENTITY_CONFIRM → MFA_BINDING`
- 响应：`{ nextStep: "MFA_BINDING" }`

`POST /admin/auth/first-login/mfa/init`
- 无请求体
- 生成 TOTP secret，写入 `admin_users.mfaSecret`（加密）
- 响应：`{ otpauthUri: "otpauth://totp/...", manualKey: "JBSW YDPE EHPK 3PXP" }`
- 状态保持 `MFA_BINDING`（init 不转换状态，verify 才转换）
- 幂等：若已有 secret 且尚未 verify，重新生成并覆盖

`POST /admin/auth/first-login/mfa/verify`
- 请求：`{ code: "123456" }`
- 校验 6 位 TOTP 码（`otplib.totp.verify`）
- 验证通过：`MFA_BINDING → POLICY_ACK_PENDING`，写 `mfaEnabledAt`，重置 failCount
- 验证失败：failCount++，若 ≥ 5 则写 `mfaVerifyLockedUntil = now + 15min`，返回 429
- 响应（成功）：`{ nextStep: "POLICY_ACK_PENDING" }`

`POST /admin/auth/first-login/policy/acknowledge`
- 无请求体
- 状态转换：`POLICY_ACK_PENDING → COMPLETED`
- 写 `securityAckAt`，下发完整 `accessToken` + `refreshToken`
- 响应：`{ accessToken: "...", refreshToken: "..." }`

#### MFA 验证接口（正常登录用，新增）

`POST /admin/auth/mfa/verify`
- 由 `MfaSessionGuard` 保护（scope: "mfa_session"）
- 请求：`{ code: "123456" }`
- 验证通过后下发完整 JWT
- 失败策略与 first-login 相同（5 次锁 15 分钟）

### 6. TOTP 实现

- 库：`otplib`（后端），`qrcode`（前端渲染 QR 码，只依赖 otpauthUri）
- secret 生成：`authenticator.generateSecret()` → base32 字符串
- URI 格式：`otpauth://totp/{issuer}:{email}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30`
- `issuer`：从环境变量 `MFA_ISSUER`（默认 `Exchange Admin`）
- 存储：secret 在写入 DB 前用 `AES-256-GCM` 加密（密钥来自 `MFA_ENCRYPTION_KEY` 环境变量）
- 验证：`authenticator.verify({ token: code, secret: decryptedSecret })`，允许 ±1 个时间窗口容错

### 7. Audit Actions

`workflowType: ADMIN_FIRST_LOGIN`

| action | 触发时机 |
|---|---|
| `FIRST_LOGIN_IDENTITY_CONFIRMED` | confirm-identity 调用，状态转 MFA_BINDING |
| `FIRST_LOGIN_MFA_BINDING_INITIATED` | mfa/init 调用，secret 生成 |
| `FIRST_LOGIN_MFA_VERIFY_FAILED` | verify 失败，metadata: `{ attemptCount }` |
| `FIRST_LOGIN_MFA_BINDING_COMPLETED` | verify 成功，状态转 POLICY_ACK_PENDING |
| `FIRST_LOGIN_POLICY_ACKNOWLEDGED` | policy/acknowledge 调用 |
| `FIRST_LOGIN_COMPLETED` | policy/acknowledge 完成，状态转 COMPLETED |

所有 audit 行共享同一个 `firstLoginTraceId`（在 confirm-identity 时生成并持久化到 `admin_users`）。

`recordByActor` 调用，`actorNo` = adminUserNo，`entityType` = ADMIN_USER。

---

## 前端设计

### 新文件

`admin-web/src/pages/AdminFirstLoginPage.tsx`

单页面，内部管理 `currentStep` 状态（不拆路由）。步骤组件：
- `IdentityConfirmStep` — 展示 name / role / email，调用 confirm-identity
- `MfaBindingStep` — 调用 mfa/init 获取 URI，`qrcode` 渲染 QR 码，输入框提交 verify
- `PolicyAckStep` — 展示安全须知条目，checkbox，调用 policy/acknowledge
- `CompletionStep` — 成功画面，替换 token，跳转 Dashboard

进度条：4 格，当前步骤高亮颜色。

### 修改文件

`admin-web/src/pages/AdminLogin.tsx`

login 响应处理：
```ts
if (res.status === 'FIRST_LOGIN_REQUIRED') {
  sessionStorage.setItem('firstLoginToken', res.firstLoginToken)
  navigate('/admin/first-login')
} else if (res.status === 'MFA_REQUIRED') {
  sessionStorage.setItem('mfaSessionToken', res.mfaSessionToken)
  // 展示 MFA 输入框（内联在登录页，不跳转）
}
```

`admin-web/src/App.tsx`

新增路由：`/admin/first-login` → `AdminFirstLoginPage`（无需 RBAC guard，有 firstLoginToken 才能调用接口）

### 页面刷新恢复

`AdminFirstLoginPage` mount 时调用 `GET /admin/auth/first-login/status`，根据返回的 `currentStep` 直接渲染对应步骤，不从头开始。

---

## 错误处理

| 场景 | 处理 |
|---|---|
| firstLoginToken 过期（15 分钟） | 接口返回 401，前端清除 token，跳回登录页，提示"会话已超时，请重新登录" |
| MFA verify 失败 | 前端展示剩余次数（如"验证失败，还有 3 次机会"） |
| MFA verify 锁定 | 后端返回 429 + `retryAfter` 秒数，前端显示倒计时 |
| 非 first-login scope 访问 first-login 接口 | 403 |
| first-login scope 访问正常接口 | 403 |

---

## 不涉及的已有 Workflow

Admin Invite 流程（账号激活、设置密码）不变。First Login 从用户点击"登录"并输入密码开始，与邀请激活流程在时序上是分离的。
