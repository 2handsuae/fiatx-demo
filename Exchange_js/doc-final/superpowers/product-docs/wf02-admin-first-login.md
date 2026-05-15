# WF02 Admin First Login — 产品文档

Last Updated: 2026-05-07 | Workflow 状态: ✅ 已交付 | workflowType: `ADMIN_FIRST_LOGIN`

---

## 一、业务目的与监管依据

**解决什么问题：** 新管理员的账号被激活后，必须在首次登录时强制完成 MFA 绑定。如果没有受控的首登流程，管理员可能在没有 MFA 的情况下进入系统，或者 MFA 绑定过程没有被记录，无法向监管机构证明 MFA 要求被切实执行。

**VARA 依据：** TIR Rulebook III.A Authentication — MFA 是所有管理员访问的强制要求。首次 MFA 绑定必须有受控流程，且必须留下可供审查的审计证据。

**没有这个 Workflow 会怎样：** 平台无法保证每个管理员账号都绑定了 MFA。若监管审查时发现有管理员账号未绑定 MFA，或绑定过程缺乏审计记录，将直接违反 TIR Rulebook III.A 的强制要求。

---

## 二、参与角色与权限

| 角色 | 能做什么 |
|---|---|
| **新激活的管理员本人** | 执行首次登录仪式的全部步骤（无需其他人参与） |

**无 Checker**：本 Workflow 没有审批门，所有步骤由本人独立完成。

**受限 JWT 机制（firstLoginToken）：** 进入首次登录仪式的管理员使用一种特殊的受限 JWT（`firstLoginToken`），其 `scope` 字段值为 `"first_login"`。这个 token：
- 只能访问首次登录仪式的 4 个专用接口
- 无法访问系统任何其他功能（包括查看数据、执行操作等）
- 有效期 15 分钟，无法续期
- 仪式完成后被吊销，下发正常 `accessToken`

这个机制确保管理员在完成 MFA 绑定之前，无法以任何方式访问系统业务功能。

---

## 三、操作流程（操作员视角）

### 3.1 触发条件

账号通过 WF01 激活（`status = ACTIVE`）后，管理员第一次打开登录页面输入邮箱 + 密码时，系统检测到 `firstLoginStatus ≠ COMPLETED`，不下发正常 token，而是：
1. 在登录接口响应中返回 `status: "FIRST_LOGIN_REQUIRED"`
2. 下发 `firstLoginToken`（受限 JWT）
3. 前端跳转至首次登录仪式页面（`/admin/first-login`）

> 仪式页面在同一个页面内完成，有进度条显示当前步骤（共 4 步）。刷新页面后可恢复到已完成的步骤，不会丢失进度。

### 3.2 第一步：身份确认（Identity Confirmation）

- 页面展示管理员的邮箱地址和当前分配的角色
- 管理员确认"这是我的账号信息" → 点击"Confirm"
- 系统将 `firstLoginStatus` 从 `PENDING_IDENTITY_CONFIRM` 更新为 `MFA_BINDING`
- **审计**：写入 `FIRST_LOGIN_IDENTITY_CONFIRMED`

### 3.3 第二步：MFA 绑定（MFA Binding）

**3.3.1 生成密钥**
- 系统自动生成 TOTP 密钥，页面展示：
  - 二维码（供 Google Authenticator 或同类 App 扫描）
  - 手动输入的文字密钥（二维码无法扫描时的备用方式）
- **审计**：写入 `FIRST_LOGIN_MFA_BINDING_INITIATED`（密钥生成时记录）

**3.3.2 验证绑定**
- 管理员用手机 App 扫码后，App 中出现每 30 秒刷新的 6 位验证码
- 在页面输入框填入当前验证码 → 点击"Verify"
- 验证通过：`firstLoginStatus` → `POLICY_ACK_PENDING`，记录 MFA 绑定完成时间
- **审计**：写入 `FIRST_LOGIN_MFA_BINDING_COMPLETED`

**3.3.3 验证失败处理**

| 情况 | 系统行为 |
|---|---|
| 验证码错误 | 失败计数 +1，页面提示剩余尝试次数 |
| 连续失败 5 次 | 账号 MFA 验证被锁定 15 分钟，页面显示倒计时，锁定期间无法重试 |
| 每次失败 | 写入审计 `FIRST_LOGIN_MFA_VERIFY_FAILED`（含失败次数） |

**3.3.4 密钥重置规则**
- 若管理员已调用"生成密钥"但尚未验证通过，可以重新调用（生成新密钥，旧密钥立即作废，重置失败计数）
- 一旦验证通过（进入 `POLICY_ACK_PENDING`），密钥不再变更，直到 CISO 通过 WF07 重置

### 3.4 第三步：安全须知确认（Policy Acknowledgment）

- 页面展示平台安全须知内容（密码规范、设备安全要求、职责说明等）
- 管理员勾选"I have read and understood the above" → 点击"Acknowledge"
- `firstLoginStatus` → `COMPLETED`，记录确认时间（`securityAckAt`）
- 系统吊销 `firstLoginToken`，下发正常的 `accessToken` + `refreshToken`
- **审计**：写入 `FIRST_LOGIN_POLICY_ACKNOWLEDGED` 和 `FIRST_LOGIN_COMPLETED`

### 3.5 第四步：完成（Completion）

- 页面展示"Setup complete"确认画面
- 前端将正常 token 写入本地存储，自动跳转至系统主页（Dashboard）
- 自此，管理员进入正常登录流程（每次登录需完成 MFA 验证）

### 3.6 页面刷新恢复机制

仪式页面加载时，会调用 `GET /admin/auth/first-login/status`，根据返回的 `currentStep` 直接渲染对应步骤，不从头开始。管理员意外刷新或浏览器崩溃后，重新打开页面可继续未完成的步骤。

### 3.7 Token 过期处理

- `firstLoginToken` 有效期 15 分钟（自登录时下发，无活动续期机制）
- 过期后，调用任何首登接口均返回 401
- 前端清除 token，跳转回登录页，提示"会话已超时，请重新登录"
- 重新登录后，系统根据 `firstLoginStatus` 恢复进度（已完成的步骤不重做）

---

## 四、状态语义

`firstLoginStatus` 是 `admin_users` 表上独立的状态字段，与账号主 `status` 字段互不干扰。

| firstLoginStatus | 业务含义 | 该状态下能调用什么接口 |
|---|---|---|
| `PENDING_IDENTITY_CONFIRM` | 账号刚激活，尚未开始首次登录仪式 | 仅"确认身份"接口 |
| `MFA_BINDING` | 已确认身份，正在完成 MFA 绑定 | "生成 MFA 密钥"和"验证 MFA 验证码"接口 |
| `POLICY_ACK_PENDING` | MFA 已绑定，等待确认安全须知 | 仅"确认安全须知"接口 |
| `COMPLETED` | 首次登录仪式全部完成 | 无 firstLogin 接口（已持有正常 token，使用系统全部功能） |

> **账号主 `status` 在本 Workflow 全程保持 `ACTIVE` 不变。** `firstLoginStatus` 是独立的状态轴，专门描述首登仪式的完成进度，不影响账号的生命周期状态。

**状态流转图：**

```
PENDING_IDENTITY_CONFIRM
  → [confirm-identity] → MFA_BINDING
      → [mfa/init] → （停留在 MFA_BINDING，密钥生成，状态不变）
      → [mfa/verify 通过] → POLICY_ACK_PENDING
          → [policy/acknowledge] → COMPLETED

错误路径：
  mfa/verify 失败 → 停留 MFA_BINDING，failCount++
  failCount ≥ 5 → 锁定 15 分钟（mfaVerifyLockedUntil），返回 429
```

---

## 五、业务规则与前置条件

### 5.1 前置条件

- 账号主 `status = ACTIVE`（WF01 已完成激活）
- `firstLoginStatus ≠ COMPLETED`（首次登录仪式尚未完成）
- 若以上任一条件不满足，正常登录流程直接下发 `mfaSessionToken`（用于 MFA 验证），不进入 WF02

### 5.2 不可绕过的规则

- **无法跳过 MFA 绑定**：`firstLoginToken` 的 scope 限制确保管理员在仪式完成前，无法调用系统任何业务接口。这一限制由后端 `FirstLoginGuard` 和 `AdminPermissionGuard` 协同执行
- **步骤必须顺序完成**：不能跨步骤调用接口。例如在 `PENDING_IDENTITY_CONFIRM` 状态时调用 MFA 接口，系统拒绝并返回错误
- **firstLoginToken 和正常 accessToken 互斥**：持有 `firstLoginToken` 的请求访问正常接口返回 403；持有正常 `accessToken` 的请求访问 firstLogin 接口同样返回 403

### 5.3 与正常登录 MFA 验证的关系

首次登录仪式完成后，后续每次登录流程为：

```
[输入邮箱 + 密码] → 后端验证通过 → 返回 mfaSessionToken（scope: "mfa_session"）
    → [用 App 查看验证码，提交 POST /admin/auth/mfa/verify]
    → 验证通过 → 下发完整 accessToken + refreshToken
```

这是两套独立的 token 机制：
- `firstLoginToken`：首次登录专用，完成仪式后永久吊销，不再生成
- `mfaSessionToken`：每次正常登录使用，用于 MFA 验证中间步骤，验证完成后失效

MFA 验证失败策略与首登期间相同：连续失败 5 次锁定 15 分钟。

### 5.4 TOTP 规格说明（供实现参考）

- 算法：TOTP（RFC 6238），SHA-1，6 位，周期 30 秒
- 兼容所有标准 TOTP App（Google Authenticator、Microsoft Authenticator、Authy 等）
- 密钥在写入数据库前以 AES-256-GCM 加密存储（密钥来自环境变量）
- 验证时允许 ±1 个时间窗口容错（防止时钟偏差导致的误拒）

---

## 六、合规证据覆盖

### 6.1 审计事件清单

同一首次登录仪式的所有审计行共享同一个 `firstLoginTraceId`（在"确认身份"步骤时生成，持久化到账号记录，整个仪式结束前该值不变）。

| 审计事件 | 触发时机 | 合规意义 |
|---|---|---|
| `FIRST_LOGIN_IDENTITY_CONFIRMED` | 第一步"确认身份"完成 | 证明本人确认了账号归属（防止账号被冒用） |
| `FIRST_LOGIN_MFA_BINDING_INITIATED` | MFA 密钥生成 | 记录密钥生成的时间点 |
| `FIRST_LOGIN_MFA_VERIFY_FAILED` | MFA 验证码验证失败 | 异常行为追溯（含累计失败次数，可识别暴力破解） |
| `FIRST_LOGIN_MFA_BINDING_COMPLETED` | MFA 验证通过 | **核心合规证据**：证明 MFA 绑定确实完成，且是本人操作 |
| `FIRST_LOGIN_POLICY_ACKNOWLEDGED` | 第三步"确认安全须知"完成 | 证明管理员已阅读并确认平台安全要求 |
| `FIRST_LOGIN_COMPLETED` | 仪式全部完成，正常 token 下发 | VARA TIR III.A 的最终合规证据：MFA 强制要求已落实 |

### 6.2 VARA 合规要求对照

| VARA 要求 | 平台实现 |
|---|---|
| "MFA 必须强制" | `firstLoginToken` scope 机制，物理上无法绕过 |
| "首次绑定必须有受控流程" | 4 步状态机，步骤必须顺序完成，无法跳过 |
| "必须有审计证据" | `firstLoginTraceId` 贯穿全流程，6 条审计事件完整覆盖 |

---

## 七、关联工作流

| 关系类型 | 关联 Workflow / 功能 | 说明 |
|---|---|---|
| **前置依赖** | WF01 Admin Invite | 账号必须先经过 WF01 激活（`ACTIVE`）才会触发 WF02 |
| **配对场景** | WF07 Admin MFA Reset | 设备丢失时，CISO 通过 WF07 重置 MFA，重置后管理员重走 WF02 的 MFA 绑定步骤（即 `firstLoginStatus` 重置为 `MFA_BINDING`） |
| **延续关系** | 正常登录 MFA 验证（非独立 Workflow） | WF02 完成后，后续每次登录走 `mfaSessionToken` MFA 验证流程，使用同一个 TOTP 密钥 |
