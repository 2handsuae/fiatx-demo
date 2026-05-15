# Withdrawal Address Registration — Crypto Design

Date: 2026-05-13 | Scope: V3 MVP | Status: APPROVED

---

## Overview

客户在 Client 端自助注册虚拟币提现目的地地址。注册时平台通过 Travel Rule (TR) adapter 自动识别地址归属：识别到对手方 VASP 则标记为 VASP 并存入 VASP 信息，未识别则标记为 SELF_CUSTODY。客户始终签署 ownership declaration。注册后进入 24 小时安全冷却期，冷却期内客户可取消，冷却期满自动激活。仅 ACTIVE 状态的地址可用于 V5 提现。

**VARA 合规依据：** TIR Rulebook III.A Authentication — 安全冷却防止凭证泄露后资产被立即转移。CRM Rulebook Part III.G — VASP 间转账需 Travel Rule 信息交换（V5 执行）。

**前置依赖：** Asset 处于 ACTIVE 状态（V3 Asset Listing）。

---

## Section 1: 数据模型

### Prisma Model — `WithdrawalAddress`

```prisma
model WithdrawalAddress {
  id                      String    @id @default(uuid())
  addressNo               String    @unique                    // operator key: WAD2605140001
  customerId              String                               // FK → CustomerMain
  customerNo              String                               // 冗余，方便审计和列表展示
  assetId                 String                               // FK → Asset
  network                 String                               // 从 Asset.network 复制，冗余方便查询
  address                 String                               // 链上地址
  addressType             String                               // VASP | SELF_CUSTODY（系统通过 TR adapter 自动判定）
  label                   String?                              // 客户自定义备注，如"我的Ledger"

  // VASP 专属字段（TR adapter 自动填充）
  counterpartyVaspName    String?                              // 对手方 VASP 名称，TR 识别后自动填入
  counterpartyVaspDid     String?                              // TR Provider 的 VASP 标识符（如 Notabene DID）

  // Ownership declaration（所有地址都需要）
  ownershipDeclaredAt     DateTime?                            // 客户声明时间戳
  ownershipProofType      String?                              // DECLARATION | SIGNATURE（预留，MVP 只用 DECLARATION）

  // 状态机
  status                  String    @default("PENDING_ACTIVATION")
  activatesAt             DateTime                             // 冷却期到期时间 = createdAt + 24h
  activatedAt             DateTime?                            // 实际激活时间
  suspendedAt             DateTime?                            // 停用时间
  suspendedBy             String?                              // 停用操作人 adminNo
  suspendReason           String?                              // 停用原因
  cancelledAt             DateTime?                            // 客户取消时间

  // 审计追踪
  traceId                 String                               // UUID v4，注册时生成

  createdAt               DateTime  @default(now())
  updatedAt               DateTime  @updatedAt

  customer                CustomerMain @relation(fields: [customerId], references: [id])
  asset                   Asset        @relation(fields: [assetId], references: [id])

  @@unique([customerId, assetId, address])                     // 同一客户同一资产不能重复注册同一地址
  @@index([customerId, assetId, status])                       // 查询客户某资产的有效地址
  @@index([status, activatesAt])                               // cron 扫描到期地址
  @@map("withdrawal_addresses")
}
```

### 状态集合 & 转换规则

| 状态 | 含义 | 允许转换 |
|---|---|---|
| `PENDING_ACTIVATION` | 冷却期中，不可用于提现 | → ACTIVE（到期）, → CANCELLED（客户取消） |
| `ACTIVE` | 可用于提现 | → SUSPENDED（admin 强制停用） |
| `CANCELLED` | 客户冷却期内取消 | terminal |
| `SUSPENDED` | 合规停用 | terminal (MVP) |

### 业务约束

- 每个 `customerId + assetId` 组合最多 **3 个**非 terminal 状态地址（PENDING_ACTIVATION + ACTIVE 合计），常量 `MAX_ADDRESSES_PER_ASSET = 3`
- `@@unique([customerId, assetId, address])` 防止重复注册同一地址
- `activatesAt = createdAt + COOLING_PERIOD_HOURS`，常量 `COOLING_PERIOD_HOURS = 24`
- 冷却期到期激活方式：Cron sweep（每 5 分钟）+ 客户查询时懒激活，双路径幂等

---

## Section 2: VASP 自动识别 — Travel Rule Adapter

### 识别流程

```
客户输入地址
  → workflow 调用 trAdapter.attributeAddress(address, network)
  → 返回 { attributed: true, vaspName, vaspDid }
      → addressType = 'VASP', 存入 counterpartyVaspName + counterpartyVaspDid
  → 返回 { attributed: false }
      → addressType = 'SELF_CUSTODY'
```

`addressType` 由系统自动判定，客户不需要手动选择。

### TR Adapter 接口

```typescript
// travel-rule-adapter.interface.ts
export const TRAVEL_RULE_ADAPTER = Symbol('TRAVEL_RULE_ADAPTER');

export interface AddressAttributionResult {
  attributed: boolean;
  vaspName?: string;        // 对手方 VASP 名称
  vaspDid?: string;         // TR Provider 的 VASP 标识符
}

export interface TravelRuleAdapter {
  attributeAddress(address: string, network: string): Promise<AddressAttributionResult>;
}
```

### Mock 实现（MVP）

```typescript
// mock-travel-rule.adapter.ts
@Injectable()
export class MockTravelRuleAdapter implements TravelRuleAdapter {
  async attributeAddress(address: string, network: string): Promise<AddressAttributionResult> {
    return { attributed: false };
  }
}
```

MVP 阶段所有地址返回 `attributed: false` → 全部标记为 SELF_CUSTODY。接入 Notabene 等 TR Provider 后替换为真实实现，无需改动 workflow 逻辑。

### Ownership Declaration

无论 addressType 是 VASP 还是 SELF_CUSTODY，客户**始终签署 ownership declaration**：

> "I declare that I am the sole owner and controller of this wallet address. I understand that providing false information may result in account suspension and regulatory action."

- `ownershipDeclaredAt = now()`
- `ownershipProofType = 'DECLARATION'`（MVP），预留 `SIGNATURE` 供中期消息签名验证

---

## Section 3: API 设计

### 3.1 Client API

**注册提现地址**
```
POST /client/withdrawal-addresses
Authorization: Bearer <customer-jwt>

{
  "assetId": "uuid",
  "address": "0x1234abcd...",
  "ownershipDeclaration": true,
  "label": "My Ledger"              // optional
}
```

客户只需提交 3 个字段（assetId、address、ownershipDeclaration）。`addressType` 和 VASP 信息由后端通过 TR adapter 自动判定填充。

Response `201`:
```json
{
  "addressNo": "WAD2605140001",
  "address": "0x1234abcd...",
  "addressType": "SELF_CUSTODY",
  "network": "ETH",
  "status": "PENDING_ACTIVATION",
  "activatesAt": "2026-05-15T10:00:00Z",
  "label": "My Ledger",
  "counterpartyVaspName": null,
  "asset": { "code": "ETH", "type": "CRYPTO" }
}
```

**前置校验清单**

| 校验项 | 失败码 | HTTP |
|---|---|---|
| Customer onboardingStatus !== APPROVED | `ONBOARDING_NOT_APPROVED` | 403 |
| Customer adminStatus !== ACTIVE | `ACCOUNT_SUSPENDED` | 403 |
| Asset 不存在 | `ASSET_NOT_FOUND` | 404 |
| Asset status !== ACTIVE | `ASSET_NOT_ACTIVE` | 400 |
| Asset type !== CRYPTO | `ASSET_NOT_CRYPTO` | 400 |
| 地址格式校验不通过 | `INVALID_ADDRESS_FORMAT` | 400 |
| 同一地址已注册（unique 冲突） | `ADDRESS_ALREADY_REGISTERED` | 409 |
| 非 terminal 地址数 >= 3 | `ADDRESS_LIMIT_REACHED` | 400 |
| ownershipDeclaration !== true | `OWNERSHIP_DECLARATION_REQUIRED` | 400 |

**查询提现地址列表**（含懒激活）
```
GET /client/withdrawal-addresses?assetId=uuid&status=ACTIVE
Authorization: Bearer <customer-jwt>
```

Service 层在查询时对每个 `PENDING_ACTIVATION` 且 `activatesAt <= now()` 的记录执行懒激活 → 更新状态后返回。

**取消冷却期中的地址**
```
DELETE /client/withdrawal-addresses/:addressNo
Authorization: Bearer <customer-jwt>
```

前置：`status === PENDING_ACTIVATION` 且 `customerId === JWT.customerId`。

### 3.2 Admin API

**列表查询**
```
GET /admin/withdrawal-addresses?customerId=uuid&status=ACTIVE&assetId=uuid&addressType=VASP
Authorization: Bearer <admin-jwt>
Guards: AdminPermissionGuard
```

**详情查询**
```
GET /admin/withdrawal-addresses/:addressNo
```

**强制停用**
```
POST /admin/withdrawal-addresses/:addressNo/suspend
Permission: WITHDRAWAL_ADDRESS_SUSPEND (MLRO / COMPLIANCE_OFFICER)
Body: { "reason": "Sanctioned address identified by KYT" }
```

前置：`status === ACTIVE`。

**模拟：跳过冷却期**
```
POST /admin/withdrawal-addresses/:addressNo/skip-cooling
```

前置：`status === PENDING_ACTIVATION`。立即激活为 ACTIVE。

### 3.3 DTO 汇总

| DTO | 字段 |
|---|---|
| `CreateWithdrawalAddressDto` | `assetId` (UUID), `address` (string), `ownershipDeclaration` (boolean, must be true), `label?` (string) |
| `ListWithdrawalAddressQueryDto` | `assetId?`, `status?`, `addressType?`, `take?`, `skip?` |
| `SuspendWithdrawalAddressDto` | `reason` (string, required) |

---

## Section 4: 后端三层架构

### 4.1 文件结构

```
src/modules/asset-treasury/withdrawal-addresses/
├── withdrawal-addresses.module.ts
├── withdrawal-address.service.ts                  # Layer 1: Domain Service
├── withdrawal-address-workflow.service.ts          # Layer 3: Workflow
├── withdrawal-address-sweep.service.ts             # Cron sweep
├── withdrawal-address.controller.ts                # Client API
├── withdrawal-address-admin.controller.ts          # Admin API
├── address-validator.util.ts                       # 地址格式校验
├── travel-rule-adapter.interface.ts                # TR adapter 接口定义
├── mock-travel-rule.adapter.ts                     # TR adapter mock 实现
└── dto/
    ├── create-withdrawal-address.dto.ts
    ├── list-withdrawal-address-query.dto.ts
    └── suspend-withdrawal-address.dto.ts
```

无 Approval Sub-Workflow — 本功能没有 maker/checker 审批门。

### 4.2 Layer 1: Domain Service (`withdrawal-address.service.ts`)

职责：CRUD、校验、状态转换。不写审计日志。

**方法清单：**

- `create(data, tx?)` — 生成 addressNo（`generateReferenceNo('WAD')`），计算 activatesAt，校验地址格式、unique 约束、上限 3 个。创建记录 status = PENDING_ACTIVATION。addressType 和 VASP 字段由调用方（workflow）传入。
- `activate(addressNo, tx?)` — guard: status === PENDING_ACTIVATION && activatesAt <= now()。更新 status = ACTIVE, activatedAt = now()。幂等：已 ACTIVE 直接返回。
- `cancel(addressNo, customerId, tx?)` — guard: status === PENDING_ACTIVATION && customerId 匹配。更新 status = CANCELLED, cancelledAt = now()。
- `suspend(addressNo, adminNo, reason, tx?)` — guard: status === ACTIVE。更新 status = SUSPENDED, suspendedAt = now(), suspendedBy = adminNo, suspendReason = reason。
- `skipCooling(addressNo, tx?)` — guard: status === PENDING_ACTIVATION。更新 status = ACTIVE, activatedAt = now()。
- `findByNo(addressNo)` — include: { asset, customer }。
- `listByCustomer(customerId, filters)` — 支持 assetId, status, addressType 过滤。
- `listAll(filters)` — Admin 用，支持 customerId, status, assetId, addressType 过滤。
- `findPendingExpired()` — WHERE status = PENDING_ACTIVATION AND activatesAt <= now()。Cron sweep 专用。
- `lazyActivateForCustomer(customerId, assetId?)` — 查询该客户的过期 PENDING 地址，逐个调用 activate()。列表查询前调用。

所有写方法接受可选 `tx: Prisma.TransactionClient` 参数。

### 4.3 Layer 3: Workflow (`withdrawal-address-workflow.service.ts`)

职责：编排全程，写审计日志，发通知。注入 `TRAVEL_RULE_ADAPTER`。

**方法清单：**

- `registerAddress(dto, customerId, customerNo)`:
  1. 查询 CustomerMain → 校验 onboardingStatus === APPROVED, adminStatus === ACTIVE
  2. 查询 Asset → 校验 status === ACTIVE, type === CRYPTO
  3. 生成 traceId = crypto.randomUUID()
  4. 调用 `trAdapter.attributeAddress(dto.address, asset.network)`
     - attributed → addressType = VASP, counterpartyVaspName = result.vaspName, counterpartyVaspDid = result.vaspDid
     - not attributed → addressType = SELF_CUSTODY
  5. 调用 domainService.create({ ...dto, customerId, customerNo, traceId, addressType, counterpartyVaspName?, counterpartyVaspDid?, ownershipDeclaredAt: now(), ownershipProofType: 'DECLARATION' })
  6. 审计：ADDRESS_REGISTERED（recordSystem）
  7. 通知：发送冷却期开始通知给客户
  8. 返回

- `cancelAddress(addressNo, customerId, customerNo)`:
  1. 读取地址 → 获取 traceId
  2. domainService.cancel(addressNo, customerId)
  3. 审计：ADDRESS_CANCELLED
  4. 返回

- `activateAddress(addressNo)`:
  1. 读取地址 → 获取 traceId
  2. domainService.activate(addressNo)
  3. 审计：ADDRESS_ACTIVATED（recordSystem）
  4. 通知：发送地址已激活通知给客户
  5. 返回

- `suspendAddress(addressNo, actor, reason)`:
  1. 读取地址 → 获取 traceId
  2. domainService.suspend(addressNo, actor.userNo, reason)
  3. 审计：ADDRESS_SUSPENDED（recordByActor）
  4. 通知：发送地址已停用通知给客户
  5. 返回

- `skipCoolingPeriod(addressNo, actor)`:
  1. 读取地址 → 获取 traceId
  2. domainService.skipCooling(addressNo)
  3. 审计：MANUAL_COOLING_SKIP（recordByActor）
  4. 返回

### 4.4 Sweep Service (`withdrawal-address-sweep.service.ts`)

```
@Cron('*/5 * * * *')  // 每 5 分钟
handleCoolingExpiry():
  1. domainService.findPendingExpired()
  2. 逐个调用 workflowService.activateAddress(addressNo)
  3. 单个失败不阻塞其余（独立 try/catch）
```

### 4.5 Controllers

**Client Controller** (`withdrawal-address.controller.ts`)
```
@Controller('client/withdrawal-addresses')
@UseGuards(AuthGuard('jwt'))

POST /                     → workflowService.registerAddress()
GET  /                     → lazyActivate + domainService.listByCustomer()
GET  /:addressNo           → lazyActivate + domainService.findByNo()
DELETE /:addressNo         → workflowService.cancelAddress()
```

**Admin Controller** (`withdrawal-address-admin.controller.ts`)
```
@Controller('admin/withdrawal-addresses')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)

GET  /                     → domainService.listAll()
GET  /:addressNo           → domainService.findByNo()
POST /:addressNo/suspend   → workflowService.suspendAddress()
POST /:addressNo/skip-cooling → workflowService.skipCoolingPeriod()
```

---

## Section 5: 地址格式校验

`address-validator.util.ts` — 纯函数，无依赖注入。

```typescript
const VALIDATORS: Record<string, { pattern: RegExp; label: string }> = {
  ETH:  { pattern: /^0x[0-9a-fA-F]{40}$/,                                    label: 'Ethereum (0x + 40 hex)' },
  TRX:  { pattern: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,                            label: 'Tron (T + 33 Base58)' },
  BTC:  { pattern: /^(1[1-9A-HJ-NP-Za-km-z]{25,34}|3[1-9A-HJ-NP-Za-km-z]{25,34}|bc1[0-9a-z]{39,59})$/, label: 'Bitcoin' },
  SOL:  { pattern: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,                          label: 'Solana (Base58)' },
};

function validateCryptoAddress(network: string, address: string): { valid: boolean; reason?: string }
```

- 找不到 network 对应的 validator → 放行（新网络不被校验阻塞）
- 返回 `{ valid, reason }` 供 domain service 使用

---

## Section 6: 审计日志

### 6.1 新增常量

```typescript
// AuditBusinessWorkflowTypes
WITHDRAWAL_ADDRESS_REGISTRATION: 'WITHDRAWAL_ADDRESS_REGISTRATION',

// AuditEntityTypes
WITHDRAWAL_ADDRESS: 'WITHDRAWAL_ADDRESS',

// AuditGovernanceActions
WITHDRAWAL_ADDRESS_REGISTRATION: {
  ADDRESS_REGISTERED:     'ADDRESS_REGISTERED',
  ADDRESS_ACTIVATED:      'ADDRESS_ACTIVATED',
  ADDRESS_CANCELLED:      'ADDRESS_CANCELLED',
  ADDRESS_SUSPENDED:      'ADDRESS_SUSPENDED',
  MANUAL_COOLING_SKIP:    'MANUAL_COOLING_SKIP',
},
```

### 6.2 审计矩阵

| 动作 | action | 记录方法 | traceId | metadata |
|---|---|---|---|---|
| 客户注册 | `ADDRESS_REGISTERED` | `recordSystem` | 新生成 | `{ addressType, address, network, assetCode, counterpartyVaspName?, counterpartyVaspDid?, label? }` |
| 冷却到期激活 | `ADDRESS_ACTIVATED` | `recordSystem` | 继承 | `{ activatedBy: 'CRON' \| 'LAZY' }` |
| 客户取消 | `ADDRESS_CANCELLED` | `recordSystem` | 继承 | `{ cancelledByCustomerNo }` |
| Admin 停用 | `ADDRESS_SUSPENDED` | `recordByActor` | 继承 | `{ reason, suspendedBy }` |
| 跳过冷却期 | `MANUAL_COOLING_SKIP` | `recordByActor` | 继承 | `{ skippedBy }` |

客户操作用 `recordSystem`（审计系统 actor 体系是 admin actor），客户身份通过 `entityOwnerId` + `metadata.customerNo` 追踪。

### 6.3 traceId 传播

注册时生成 traceId → 持久化到 `withdrawal_addresses.traceId` → 后续操作从实体行继承 → 同一地址的所有审计事件通过 `WHERE traceId = X` 关联。

---

## Section 7: Admin 前端

### 7.1 列表页 (`WithdrawalAddressList.tsx`)

| 列 | 内容 |
|---|---|
| Address No | `WAD2605140001`，点击进详情 |
| Customer | `customerNo`，链接到客户详情 |
| Asset | `asset.code` |
| Network | `network` |
| Address | 截断显示 `0x742d...bD18` |
| Type | badge：🏢 VASP（蓝）/ 🔑 SELF_CUSTODY（紫） |
| Status | badge：PENDING（amber）/ ACTIVE（green）/ CANCELLED（gray）/ SUSPENDED（red） |
| Registered | `createdAt` |
| Chevron | `>` |

筛选栏：status 下拉 + addressType 下拉 + customerNo 精确搜索。无 Create 按钮。

### 7.2 详情页 (`WithdrawalAddressDetail.tsx`)

两栏布局（main + 272px sidebar）。

**主区域：**
- **Identity** — addressNo、addressType badge、完整地址（monospace）
- **Asset & Network** — asset.code、network、label
- **Customer** — customerNo（链接）、ownership declaration 时间
- **VASP Info**（仅 addressType=VASP）— counterpartyVaspName、counterpartyVaspDid
- **Cooling Period**（仅 PENDING_ACTIVATION）— registeredAt、activatesAt、剩余倒计时、进度条

**Sidebar：**
- **Actions** — Skip Cooling Period 按钮（紫色虚线，仅 PENDING 可用）、Force Suspend 按钮（仅 ACTIVE 可用，需输入 reason）
- **Status** — 当前状态、类型、网络
- **Audit Trace** — traceId、"View Audit Trail →" 链接

按钮状态矩阵：

| status | Skip Cooling | Force Suspend |
|---|---|---|
| PENDING_ACTIVATION | 可用 | disabled |
| ACTIVE | 隐藏 | 可用 |
| CANCELLED | 隐藏 | 隐藏 |
| SUSPENDED | 隐藏 | 隐藏 |

---

## Section 8: Client 前端

### 8.1 页面

新增 `client-web/src/pages/WithdrawalAddresses.tsx`，路由 `/withdrawal-addresses`。单文件三视图状态。

### 8.2 Step 1 — 地址列表

- Asset 下拉（只显示 CRYPTO + ACTIVE 资产）
- 已注册地址列表：label、地址截断、类型 badge（系统判定，只读展示）、状态 badge、PENDING 行显示倒计时
- "+ Add Withdrawal Address" 按钮，剩余名额提示

### 8.3 Step 2 — 注册表单

- **Wallet Address 输入**（失焦前端预校验）
- **Label 输入**（可选）
- **Ownership Declaration 复选框**（必须勾选才能提交）：
  > "I declare that I am the sole owner and controller of this wallet address. I understand that providing false information may result in account suspension and regulatory action."
- **提交按钮**：`POST /client/withdrawal-addresses`

表单极简：无 addressType 选择（系统自动判定），无 VASP 下拉（TR adapter 自动识别）。客户只需要输入地址、可选 label、勾选声明。

### 8.4 Step 3 — 冷却确认

- "Cooling Period Active" 标题 + 倒计时时钟（实时更新）
- 地址摘要（含系统判定的 addressType badge：如果 TR 识别到 VASP 则显示 🏢 VASP + counterpartyVaspName）
- "Cancel Registration" 按钮
- 倒计时归零后刷新 → 懒激活

---

## Section 9: 系统影响与范围排除

### 9.1 现有文件变更

| 文件 | 变更 |
|---|---|
| `prisma/schema.prisma` | 新增 WithdrawalAddress model + Asset/CustomerMain 关联 |
| `audit-actions.constant.ts` | 新增 workflow type + 5 个 action + entity type |
| `asset-treasury` module | 注册 WithdrawalAddressesModule |
| `app.module.ts` | 按需注册 |
| `client-web/src/App.tsx` | 新增 `/withdrawal-addresses` 路由 |
| `admin-web/src/App.tsx` | 新增列表 + 详情路由 |

### 9.2 不改动的模块

wallets/、custodian-wallet-create-workflow、customer-deposit-wallet、assets/、审批引擎 — 全部不动。

### 9.3 新增文件汇总

```
# 后端（11 个文件）
src/modules/asset-treasury/withdrawal-addresses/
├── withdrawal-addresses.module.ts
├── withdrawal-address.service.ts
├── withdrawal-address-workflow.service.ts
├── withdrawal-address-sweep.service.ts
├── withdrawal-address.controller.ts
├── withdrawal-address-admin.controller.ts
├── address-validator.util.ts
├── travel-rule-adapter.interface.ts
├── mock-travel-rule.adapter.ts
└── dto/
    ├── create-withdrawal-address.dto.ts
    ├── list-withdrawal-address-query.dto.ts
    └── suspend-withdrawal-address.dto.ts

# 前端（3 个文件）
admin-web/src/pages/WithdrawalAddressList.tsx
admin-web/src/pages/WithdrawalAddressDetail.tsx
client-web/src/pages/WithdrawalAddresses.tsx

# 数据库
prisma/migrations/xxx_add_withdrawal_addresses/migration.sql
```

### 9.4 范围排除

| 排除项 | 原因 |
|---|---|
| 银行提现地址注册 | 独立 workflow，roadmap 单独列出 |
| 提现地址删除 | V3 Advanced |
| SUSPENDED → 解冻 | V3 Advanced |
| V5 Travel Rule 数据传输 | V5 scope |
| KYT 链上地址风险评分 | 中期方案 |
| 消息签名验证 | 中期方案，MVP 用声明式 |
| 真实 TR Provider 对接（Notabene 等） | MVP 用 mock adapter |

### 9.5 通知触发点

| 事件 | 内容 | 渠道 |
|---|---|---|
| 注册成功 | 新地址已注册，24h 冷却期，如非本人操作请取消 | 邮件 |
| 冷却到期激活 | 地址已激活可用于提现 | 邮件 |
| Admin 停用 | 地址已被停用，如有疑问联系客服 | 邮件 |
