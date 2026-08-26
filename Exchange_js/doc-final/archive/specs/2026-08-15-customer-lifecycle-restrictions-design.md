# 客户生命周期轴 + 限制账 —— 设计稿

- **日期**：2026-08-15
- **状态**：业主已认可模型，待写实施计划
- **取代**：`CustomerMain` 的 `onboardingStatus` / `adminStatus` / `complianceStatus` 三轴 + `restrictions` JSON 列
- **关联**：`truth/v2-customer-compliance.md` §4「冻结/解冻无统一 workflow」红线、`BACKLOG.md`「客户永久卡死无解锁出口」

---

## 0 一句话

把「入驻 / 行政 / 合规」三根状态轴收敛成**一根客户关系生命周期轴**，把所有「摁住客户」的情形——制裁冻结、行政暂停、材料过期、等升级、交易审查未过——统一成**一张限制账（一行 = 一次摁住）**，限制的可见性与解除权限由「原因」查表推出、不由人工填写。

---

## 1 为什么要改（现状实证，2026-08-15 逐条 grep）

### 1.1 `adminStatus` 携带零独立信息

`CustomerAdminStatus = 'INACTIVE' | 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDED'`。

- `SUSPENDED` / `OFFBOARDED` 在客户语境下**全仓仅出现于 `customer-status.util.ts:9` 类型定义与 `:46` 数组**，零写入方、零读取方。
- 实际被写的只有 `ACTIVE` / `INACTIVE`，且取值完全由 onboarding 结果决定：`onboarding-final-approval.service.ts:467/482`、`onboarding.service.ts` 十余处、`material-refresh:151`、`tier-upgrade-case:175`、`sumsub-ingestion:194`。
- `customer-status.util.ts:139` 的缺省推导自陈其冗余：`onboardingStatus === 'APPROVED' ? 'ACTIVE' : 'INACTIVE'`。

### 1.2 `complianceStatus` 一个布尔扛四种因，且解除方不设防

写入方四处，各写各的 `complianceFreezeReason` 字符串：

| 位置 | reason 值 |
|---|---|
| `client-risk-assessment.service.ts:449` | `sanctions_hit_pending_investigation` |
| `material-refresh.service.ts:120` | `material_expired:<materialType>` |
| `tier-upgrade-case.service.ts:48` | `tier_upgrade_pending_level2` |
| `sumsub-ingestion.service.ts:194` | （不写 reason，只写 FROZEN） |

`profile-banners.service.ts:58` 读 `pep_review_pending`，**全仓无写入方**（死分支）。

解除方三处：`material-refresh:228` 比对 reason 逐字相等才解；`tier-upgrade:147`/`:177` 与 `sumsub-ingestion:179` **无条件 `complianceStatus:'CLEAR'`**。

→ 单列存因，第二个原因到来即覆盖第一个；三个解除方两个不比对因。**多因并存在当前数据结构下无法表达。**

### 1.3 读侧六处各自判断，导致合规叙事自相矛盾

`customer-auth.service.ts:182`（拒登录）、`jwt.strategy.ts:41`（每请求 403）、`onboarding.service.ts:1382`+`:1395`（同一判断做两遍）、`customer-transaction-guard.ts:20`、`profile-banners.service.ts:45`、client `AuthGuard.tsx`。

后两处是「冻结但可看 profile」的设计，被前两处彻底封杀 → **两者皆为不可达死码**。而登录页明示「账号已冻结，请联系 WhatsApp 客服」，与充值域三层脱敏、兑换域硬线零痕迹的 tipping-off 铁律正面冲突。

### 1.4 admin 冻结入口接的是已删除的子系统

`CustomerDetail.tsx:1058` 的 Freeze / Unfreeze → `CaseBoundCustomerControlModal` → `GET /admin/compliance/cases`、`PATCH /admin/compliance/cases/:id/action`。这两个端点**后端不存在**（Wave 2 compliance-cases 已删，全仓零命中）。按钮当前必报错。

配套空壳：`FreezeCustomerDto` / `UnfreezeCustomerDto` 定义无 controller；`AuditActions.CUSTOMER_FROZEN` / `CUSTOMER_UNFROZEN` 定义零写入方。

### 1.5 诊断

现有模型按**范围**切分：「范围 = 全部」的两种情形被提升为专有状态列（`adminStatus.SUSPENDED`、`complianceStatus.FROZEN`），「范围 < 全部」的扔进 `restrictions`。

但这四种摁住的真实差异在三个正交属性：**范围 / 可见性 / 解除路径**。按范围分家，可见性与解除路径无处安放，只能散落到六个读侧各自实现。

---

## 2 目标与非目标

### 目标

1. 提供**正式的客户冻结**：制裁命中时全平台摁住，客户端零痕迹，仅 MLRO 审批 + 政府文书号可解。
2. 提供**客户交易受限**：等材料/等审核期间禁提现禁兑换，客户能登录能看能被明确告知缺什么，交完自动恢复。
3. 两者在 admin 后台有**可见的执行与解除入口**，替换当前失效的 Freeze/Unfreeze 按钮。
4. 消除 1.1–1.4 列出的结构性缺陷。

### 非目标（明确不做）

- **销户流程本身**。`OFFBOARDED` 进轴、其不变量成立，但发起/审批/余额清退不在本轮。
- **制裁客户的订单级折叠**（照常收单挂 PROCESSING）。本轮只做到「界面无差异 + 中性失败」；订单级折叠需与 BACKLOG「提现域 tipping-off 未对齐」一并做。
- 代码清理类工作（业主本轮口径：做功能，不做清理）。本设计删除的列/分支是模型替换的必然结果，不属清理。
- 通知发送（`core/notifications/` 本体是 stub，见 BACKLOG）。

---

## 3 模型

### 3.1 轴：`lifecycle`（唯一一根）

```
注册                         重新申请
 ↓            ┌─────────────────────────────┐
PROSPECT ──→ IN_VERIFICATION ──→ PENDING_APPROVAL ──→ ACTIVE ──→ OFFBOARDED
                │      │                 │                          （终态）
       客户撤回 │      │ Sumsub 拒       │ MLRO 拒
                ↓      ↓                 ↓
           WITHDRAWN  REJECTED ←─────────┘
                └──────┴── 重新申请 ──→ IN_VERIFICATION
```

| 值 | 含义 | 取代 |
|---|---|---|
| `PROSPECT` | 已注册，未开始认证 | `onboardingStatus=NONE` |
| `IN_VERIFICATION` | 认证进行中 | `PENDING_VERIFICATION` |
| `PENDING_APPROVAL` | 材料齐备，等 MLRO 终审 | `FINAL_APPROVAL` |
| `ACTIVE` | 正式客户 | `APPROVED` + `adminStatus=ACTIVE` |
| `REJECTED` | 未通过（可重新申请） | `REJECTED` |
| `WITHDRAWN` | 客户主动撤回（可重新申请） | `WITHDRAWN` |
| `OFFBOARDED` | 曾为客户，关系已终止（终态） | `adminStatus=OFFBOARDED`（此前空枚举） |

#### 迁移表（唯一真相源，实现放 `customer-lifecycle.constant.ts`）

| from | 动作 | to | 驱动方 |
|---|---|---|---|
| `PROSPECT` | `START_VERIFICATION` | `IN_VERIFICATION` | 客户 |
| `IN_VERIFICATION` | `VERIFICATION_PASSED` | `PENDING_APPROVAL` | Sumsub webhook |
| `IN_VERIFICATION` | `VERIFICATION_REJECTED` | `REJECTED` | Sumsub webhook |
| `IN_VERIFICATION` | `WITHDRAW_APPLICATION` | `WITHDRAWN` | 客户 |
| `PENDING_APPROVAL` | `FINAL_APPROVED` | `ACTIVE` | `ONBOARDING_FINAL_APPROVAL` 审批 |
| `PENDING_APPROVAL` | `FINAL_REJECTED` | `REJECTED` | `ONBOARDING_FINAL_APPROVAL` 审批 |
| `REJECTED` | `REAPPLY` | `IN_VERIFICATION` | 客户 |
| `WITHDRAWN` | `REAPPLY` | `IN_VERIFICATION` | 客户 |
| `ACTIVE` | `OFFBOARD` | `OFFBOARDED` | 销户流程（本轮不实现，边先留） |

终态：`OFFBOARDED`（零出边）。`REJECTED` / `WITHDRAWN` 非终态（可 `REAPPLY`）。

#### 三条不变量

- **INV-1：`ACTIVE` 的唯一出口是 `OFFBOARDED`。** 转移表中不存在 `ACTIVE → REJECTED|WITHDRAWN` 的边。今天三处违反：

  | 位置 | 今天写 | 实际语义 | 改为 |
  |---|---|---|---|
  | `sumsub-ingestion.service.ts:194` | `REJECTED` + `INACTIVE` + `FROZEN` | Sumsub MLRO 复评判拒 | 不动 lifecycle，贴 `SANCTION` 便签 |
  | `tier-upgrade-case.service.ts:175` | `REJECTED` + `INACTIVE` | 升级审批被拒 | 不动 lifecycle，贴 `ADMIN_SUSPENSION` 便签 |
  | `material-refresh.service.ts:151`（`terminateCycle`） | `WITHDRAWN` + `INACTIVE` | 客户长期不补材料，平台终止周期 | 不动 lifecycle，贴 `ADMIN_SUSPENSION` 便签 |

  第三处尤其错得明显：客户并没有"撤回申请"，是平台单方终止，却写了 `WITHDRAWN`。真要终止关系应走销户（本轮不做），所以本轮这三处统一落到限制账上。
- **INV-2：身上有 `visibility=SILENT` 的 OPEN 限制时，禁止 `OFFBOARD`。** 抛 `OFFBOARD_BLOCKED_BY_SANCTION`。销户等于放人走，制裁客户必须扣留。
- **INV-3：`OFFBOARD` 前置为余额归零且无非终态资金单。** 抛 `OFFBOARD_BLOCKED_BY_BALANCE` / `OFFBOARD_BLOCKED_BY_INFLIGHT`。

> INV-2/INV-3 的断言函数本轮实现并单测，调用点（销户流程）留待后续。

**lifecycle 轴上不存在任何「因合规摁住」的状态。** 摁住一律走限制账。

### 3.2 账：`customer_restrictions`（一行 = 一次摁住）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | uuid | 内部 FK |
| `restrictionNo` | String | 业务键，`generateReferenceNo('RST')`。**一张便签一个号；卡多个能力 = 同号多行不同 `scope`** |
| `customerId` | String | FK → CustomerMain |
| `scope` | String | `ALL` / `DEPOSIT` / `WITHDRAW` / `SWAP`（单值，不用数组，能力查询即纯 `IN`）|
| `cause` | String | 见 §3.3 闭集 |
| `visibility` | String | `SILENT` / `DISCLOSED` —— **由 cause 查表落库，非人工输入** |
| `releasePolicy` | String | `MLRO_APPROVAL` / `OPS_APPROVAL` —— 人工解除时走哪级审批，**由 cause 查表落库** |
| `status` | String | `OPEN` / `RELEASED` |
| `reason` | String | 必填，人工或系统写 |
| `caseRef` | String? | 关联 CRA / MaterialRefreshCycle / SwapTransaction 等业务号 |
| `releaseOrderRef` | String? | 政府解除令文书号，解除 `MLRO_APPROVAL` 类时必填，撕的时候写 |
| `openedAt` / `openedBy` | DateTime / String | |
| `releasedAt` / `releasedBy` | DateTime? / String? | |
| `releaseApprovalNo` | String? | 人工解除时关联的 ApprovalCase |
| `releaseMode` | String? | `AUTO` / `MANUAL` —— 撕的时候记，便于审计区分 |
| `traceId` | String | 贴的时候生成，撕的时候继承 |

索引：`@@unique([restrictionNo, scope])`、`@@index([customerId, status])`、`@@index([cause, status])`。

**一号多行**：`MATERIAL_EXPIRED` 卡提现+兑换 = 同一 `restrictionNo` 下两行（`scope=WITHDRAW` / `scope=SWAP`），字段除 `scope` 外完全相同，**同贴同撕、同一事务**。前端与 API 一律以 `restrictionNo` 为操作单位，`scope` 是它的明细。

**幂等键 `(customerId, cause, caseRef)` 最多一条 OPEN** —— 服务层 `findFirst` 兜底（SQLite 部分唯一索引限制，与 `ReconciliationCase` 同一处理）。重复贴 = no-op + 审计 `CUSTOMER_RESTRICTION_ADDED` 记 `result: SKIPPED`。`caseRef` 为空的手工便签不去重（运营可对同一客户开多张 `PENDING_DOCUMENT`，各要一份材料）。

### 3.3 原因注册表（`RESTRICTION_CAUSE_POLICY` 常量，闭集）

| cause | 默认 scope | visibility | releasePolicy | 自动撕条件 | 贴的人 |
|---|---|---|---|---|---|
| `SANCTION` | `ALL` | `SILENT` | `MLRO_APPROVAL` + `releaseOrderRef` 必填 | 无 | CRA 制裁路径 / admin 手工 |
| `ADMIN_SUSPENSION` | `ALL` | `DISCLOSED` | `OPS_APPROVAL` | 无 | admin 手工 |
| `MATERIAL_EXPIRED` | `WITHDRAW`+`SWAP` | `DISCLOSED` | `OPS_APPROVAL` | 客户提交材料，周期 `CLEARED` | 材料到期 cron / admin 手工 |
| `TIER_UPGRADE_PENDING` | `WITHDRAW`+`SWAP` | `DISCLOSED` | `OPS_APPROVAL` | Level 2 通过 + 升级审批 APPROVED | tier-upgrade 自动 |
| `KYT_REJECTED_SOFT` | `SWAP`+`WITHDRAW` | `DISCLOSED` | `OPS_APPROVAL` | Sumsub `applicantActionReviewed` = GREEN | swap 拒绝流程 |
| `KYT_REJECTED_HARD` | `SWAP`+`WITHDRAW` | `SILENT` | `MLRO_APPROVAL` | 无 | swap 拒绝流程 |
| `PENDING_DOCUMENT` | **运营选** | `DISCLOSED` | `OPS_APPROVAL` | 无 | admin 手工（兜底口）|

**规矩：**

- **R1**：`visibility` 与 `releasePolicy` 是 `cause` 的函数，运营选不了、API 不接受这两个入参。落库时由服务端从注册表取值写入（落库而非每次现算，保证历史行不因常量表改动而变义）。
- **R2**：`scope` 仅 `PENDING_DOCUMENT` 允许运营指定；其余 cause 用注册表默认值。
- **R3**：每张便签两条解除路径 —— **自动撕**由该 cause 自身机制触发、不走审批、`releaseMode=AUTO`；**人工撕**一律走 `releasePolicy` 规定的审批、`releaseMode=MANUAL`。
- **R4**：**贴不审批，撕才审批。** 制裁命中法定 ≤24h 摁住，加审批即引入超时风险，且错摁可解、代价低；放行才是高风险动作。此不对称范式与 `DEPOSIT_UNFREEZE` / `WITHDRAW_UNFREEZE` 一致。

### 3.4 读侧收口：`CustomerAccessService.resolve()`

```ts
interface CustomerAccess {
  lifecycle: CustomerLifecycle;
  /** 服务端专用：全部 OPEN 限制 scope 的并集（ALL 展开）。这是唯一的执法依据。 */
  blocked: Set<Capability>;
  /** 客户面专用：仅 DISCLOSED 限制贡献的 scope 并集。 */
  disclosedBlocked: Set<Capability>;
  /** 客户面专用：仅 visibility=DISCLOSED 的 OPEN 行。 */
  disclosed: RestrictionView[];
  /** admin 专用：OPEN 总数（含 SILENT）。 */
  openCount: number;
}
```

**所有读侧改为消费此函数，不得再各自解析。**

> ⚠️ **`blocked` 与 `disclosedBlocked` 必须分成两个字段，这是本设计的 tipping-off 命门。**
> 若客户端拿到完整 `blocked`，被制裁客户的提现按钮就会被置灰 —— 置灰本身即是信号，等于告知调查。
> 因此：**后端执法用 `blocked`，任何客户面 DTO 只允许出现 `disclosedBlocked` 与 `disclosed`。**
> `SILENT` 限制在客户面**没有任何字段可以承载** —— 结构性保证，不是"记得脱敏"的约定。
> 对被制裁客户，`disclosedBlocked` 为空集，前端因此照常渲染可点按钮，点击后由后端 `blocked` 拒绝。

| 读侧 | 改法 |
|---|---|
| `jwt.strategy.ts:41` | **删除合规判断**。会话只校验 lifecycle 非 `OFFBOARDED`（`REJECTED`/`WITHDRAWN` 仍可持会话——他们要能重新申请）。能不能干事交给能力门 |
| `customer-auth.service.ts:182` | **删除冻结拒登录**。同上 |
| `onboarding.service.ts` `assertTradingEligibility()` | 重写为 `lifecycle === 'ACTIVE'` + `!blocked.has(action)`；删掉今天重复两遍的 FROZEN 判断与手工 JSON 解析 |
| `customer-transaction-guard.ts` `ensureCustomerCanTransact()` | 同上，两者合并为一个实现（今天是两套等价逻辑）|
| `profile-banners.service.ts` | 由 `disclosed` 驱动；删掉死分支 `pep_review_pending` |
| client `AuthGuard.tsx` | 见 §5.1 |

**tipping-off 保证**：任何客户面响应（`/auth/me`、`/client/**`）只允许序列化 `disclosedBlocked` 与 `disclosed` 两个字段，`blocked` / `openCount` 禁止出现在客户面 DTO 中。由一条守则性单测扫描客户面 DTO 定义断言之。

### 3.5 贴 `scope=ALL` 时的在途单处理

统一为：**贴 `ALL` 便签时，冻结该客户名下所有非终态充值/提现/兑换单。**

- 充值：已有 `runGate0()`，改为在贴便签时主动扫描而非仅建单时查
- 提现：已有 `assertCustomerComplianceOrFreeze()`（3 处），改读 `CustomerAccess`
- **兑换：本轮补齐**。今天仅 `initiateSwap()` 建单前查一次，PROCESSING 中 4 腿照常推完。复刻提现范式，在 `onLegConfirmed()` 前加客户级闸

`scope < ALL` 的便签**不动在途单** —— 材料过期不应把已在途的提现拽回。

---

## 4 后端接口

### 4.1 端点

| 方法 | 路径 | 说明 | 权限组 |
|---|---|---|---|
| `GET` | `/admin/customers/:customerNo/restrictions` | 列全部限制（含 SILENT、含已 RELEASED） | `CUSTOMER_RESTRICTION_READ` |
| `POST` | `/admin/customers/:customerNo/restrictions` | 贴便签，**立即生效** | `CUSTOMER_RESTRICTION_WRITE` |
| `POST` | `/admin/customers/:customerNo/restrictions/:restrictionNo/release` | 发起人工解除 → 开审批案 | `CUSTOMER_RESTRICTION_RELEASE` |
| `GET` | `/client/me/restrictions` | 客户自读，**仅 `disclosed`** | 客户 JWT，不进 RBAC catalog |

`POST` 建限制请求体：`{ cause, scope?, reason, caseRef? }`。`scope` 仅 `cause=PENDING_DOCUMENT` 时接受；其余传了即 400。**不接受 `visibility` / `releasePolicy`。**

`release` 请求体：`{ reason, releaseOrderRef? }`。`releasePolicy=MLRO_APPROVAL` 时 `releaseOrderRef` 必填，缺失 400。以 `restrictionNo` 为操作单位——该号下的多个 `scope` 行同一事务一起撕。

> ⚠️ 三个 admin 端点必须在 `rbac.catalog.ts` 用 `route()` 登记 → `npm run db:base:sync` → **重启后端**（SUPER_ADMIN 走内存 `RBAC_PERMISSION_DEFINITIONS`，只 seed 不重启无效）。新增三个权限组到 `PermissionGroup` 联合类型。

### 4.2 审批

新增两个 actionType（`approval.constants.ts`）：

```ts
CUSTOMER_RESTRICTION_RELEASE_MLRO: 'CUSTOMER_RESTRICTION_RELEASE_MLRO',
CUSTOMER_RESTRICTION_RELEASE_OPS:  'CUSTOMER_RESTRICTION_RELEASE_OPS',
```

`DEFAULT_APPROVAL_POLICIES` 条目（逐字复刻 `WITHDRAW_UNFREEZE` 形状）：

```ts
[ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_MLRO]: {
  steps: [{ stepNo: 1, roles: ['MLRO'] }],
  timeoutHours: 48,
  allowCancel: true,
},
[ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_OPS]: {
  steps: [{ stepNo: 1, roles: ['OPS_OFFICER'] }],
  timeoutHours: 48,
  allowCancel: true,
},
```

两个 `ApprovalHandlerBase` 子类（各只提供 4 个常量），批准后由 `CustomerRestrictionWorkflowService.onReleaseApproved()` 落地。

发起侧只读校验 + 防重复开案 + 开审批案，**不写 `customer_restrictions` 表**（Rule 5：workflow 禁止直写 domain 表 —— 此处发起侧连 workflow 都不算，纯开案）。

`releaseOrderRef` 取回：`ApprovalDecidedEvent.metadata` 恒为 `{}`，须按 `actionType + entityRef + APPROVED` 反查 `objectSnapshot`（复刻 `fetchUnfreezeOrderRef()`），取不到直接抛，不用空串糊弄。

> ⚠️ 已知平台缺陷：`expirePendingApprovals()` 全仓无 @Cron 调用方，`timeoutHours` 目前是展示字段（本设计 §9 已列入 BACKLOG 登记清单，见 Q3）。本设计照现有范式写 48h，不在本轮修这个平台级问题。

### 4.3 审计

复用现有常量，无需新增：

| 动作 | AuditAction | 写入方 |
|---|---|---|
| 贴便签 | `CUSTOMER_RESTRICTION_ADDED` | `CustomerRestrictionWorkflowService` |
| 撕便签 | `CUSTOMER_RESTRICTION_CLEARED` | 同上 |
| 贴 `SANCTION` | 额外 `CUSTOMER_FROZEN`（今日零写入方，本轮激活）| 同上 |
| 撕 `SANCTION` | 额外 `CUSTOMER_UNFROZEN`（同上）| 同上 |

`metadata` 必带 `{ restrictionNo, cause, scope, visibility, releaseMode, approvalNo?, releaseOrderRef? }`。`workflowType` 新增 `CUSTOMER_RESTRICTION`。traceId 在贴时生成、撕时继承便签行上的值。

---

## 5 前端

### 5.1 客户端（client-web）

**`SILENT` 限制 —— 与正常客户零差异：**

| | 正常客户 | 有 SILENT 限制 |
|---|---|---|
| 登录 | ✓ | ✓（今天是拒登录）|
| 余额 / 持仓 / 历史 | ✓ | ✓ 完全一致 |
| 顶部提示条 | 无 | **无** |
| 侧栏状态徽章 | ACTIVE | **ACTIVE** |
| 提现/兑换按钮 | 可点 | **可点，不置灰**（置灰本身即信号）|
| 点击后 | 成功 | 后端拒 → 中性文案，与网络失败/系统繁忙**逐字相同** |

**`DISCLOSED` 限制 —— 明确告知：**

- 复用现有 `PendingActionBanner` 的位置与形态，按 `disclosed` 逐条渲染（标题 = cause 文案，正文 = `reason`，CTA 按 cause 定：材料类跳 `/verification`，其余无 CTA）
- 被卡能力的按钮置灰 + hover 提示
- Profile 页新增「Current restrictions」区块，列 `disclosed`
- 多条并存 → 提示条堆叠

**`AuthGuard.tsx` 改法：**

- 删除 `complianceStatus === 'FROZEN' → Navigate('/profile')` 整个分支（该分支今天不可达）
- 保留 lifecycle 未过的四步拦截页（值名跟随新轴）
- 保留 trading-readiness 引导页（段边界匹配，勿误伤 `/withdrawal-addresses`）
- 能力受限沿用 2026-08-14 parity 定稿：**不封页只禁按钮**，唯一重定向仍是 `/wallet/send`

`restrictedCapabilities.ts` 改为直接读 `/auth/me` 返回的 **`disclosedBlocked`** 数组（后端已算好，前端不再自行归一化 JSON）。

> 前端**永远拿不到** `blocked`。被制裁客户的 `disclosedBlocked` 是空集，于是按钮照常可点 —— "不置灰"这个行为不是靠前端记得特判，是拿不到数据的自然结果。

### 5.2 管理台（admin-web）

**`CustomerDetail.tsx` 主区新增 Restrictions 节**（Compliance 段内，空则整节隐藏）：

```
RESTRICTIONS                                             2 open

便签号            卡住          原因               贴于          贴的人      
RST26081500A1    ALL           SANCTION 🔇        08-15 10:22  mlro@fiatx   [ Release ]
                 制裁名单命中 · CRA26081500x
RST26080900B7    WITHDRAW·SWAP MATERIAL_EXPIRED   08-09 02:00  system-cron  [ Release ]
                 Emirates ID expired 08-01 · MRC26073100xx

已解除（3） ▸
```

🔇 标记 `visibility=SILENT`（后台可见全部，SILENT 仅对客户端隐藏）。

**侧栏 Actions**（替换现有两个失效按钮）：
- `[ Add Restriction ]` — `workflowNegative`
- `[ Offboard ]` — 禁用，hover「Not implemented」（本轮不做，占位说明轴上有这一步）

**侧栏 Status 段**：三行 `Onboarding / Admin / Compliance` → 两行
```
Lifecycle      ACTIVE
Restrictions   2 OPEN      （0 显示 NONE）
```

**Add Restriction 弹窗**：选 cause → 只读回显该 cause 带出的「卡住 / 客户可见 / 解除方式」三行 → 填 `reason`（必填）+ `caseRef`（可选）→ 提交立即生效。`cause=PENDING_DOCUMENT` 时「卡住」一行变为可勾选。

**Release 弹窗**：回显该便签 → 按 `releasePolicy` 决定是否要 `releaseOrderRef`（MLRO 类必填）→ 填解除理由 → 提交**开审批案**（不是立即解除），按钮文案 `Submit for approval`。

**客户列表页**：新增 `Restrictions` 列（OPEN 数，0 显示 `—`）+ 筛选「有限制 / 无限制 / 仅制裁」。

**样式**：必须走 `adminButtonClass()` 13 变体 + `adm-*` token + `<AdminBadge>` + 空值 `—`。⚠️ 现有 `CaseBoundCustomerControlModal.tsx` 通篇裸 Tailwind（`bg-white` / `text-gray-900` / `brand-primary`），**本轮以新弹窗替换它，不做原地修补**。

---

## 6 数据与迁移

按项目 demo 约定：**禁止 backfill / 兼容层 / 双写过渡**，直接按终态建，`reset` 重铺。

**删列**（`CustomerMain`）：`adminStatus`、`complianceStatus`、`complianceFreezeReason`、`complianceFreezeCaseId`、`complianceFreezeAt`、`complianceFreezeReleasedAt`、`restrictions`。

**改列**：`onboardingStatus` → `lifecycle`（值域按 §3.1；`APPROVED` → `ACTIVE`）。

**建表**：`customer_restrictions`。

**保留不动**：`pendingActionExternalId` / `pendingActionReason` / `pendingActionSubmittedAt` / `hardLineDispositionedAt`（客户级补料闭环是独立机制，与限制账互补：限制说「不能做什么」，pendingAction 说「做什么能解开」）。二者通过 `KYT_REJECTED_SOFT` 便签的 `caseRef` 关联。

**seed**：`seed.business.ts` 8 个 demo 客户按新轴铺；Carol（今 `FROZEN`）改为 `lifecycle=ACTIVE` + 一条 `SANCTION` 便签，用于演示零痕迹。

> SQLite 删带 FK 的列须走表重建 `create-_new` 模式（见 funds_orders Round 2 经验）。

---

## 7 验收

### 7.1 单测

- lifecycle 迁移表逐边断言 + 断言总数固定防漂移（复刻充值 28 边守则性测试）
- INV-1：不存在 `ACTIVE → REJECTED|WITHDRAWN` 边
- INV-2/INV-3：断言函数在有 SILENT 限制 / 有余额 / 有在途单时各自抛对应错误码
- `RESTRICTION_CAUSE_POLICY` 覆盖全部 cause，且 `visibility`/`releasePolicy` 不可由入参覆盖
- `CustomerAccessService.resolve()`：多因并存、`ALL` 通配展开、`disclosed` 不含 SILENT
- **`blocked` ⊋ `disclosedBlocked`**：仅有 SILENT 限制时 `blocked` 非空而 `disclosedBlocked` 为空集
- **守则性测试**：扫描客户面 DTO 定义，断言不含 `blocked` / `openCount` 字段（防后人顺手加回去）
- 幂等键 `(customerId, cause, caseRef)` 重复贴 = no-op；`caseRef` 为空时不去重
- 一号多行：`MATERIAL_EXPIRED` 产生两行同 `restrictionNo`，release 一次全撕

### 7.2 e2e（`test/customer-restrictions.e2e-spec.ts`）

1. **多因并存不互相解**：贴 SANCTION → 贴 MATERIAL_EXPIRED → 客户交材料自动撕第二张 → 断言 SANCTION 仍 OPEN 且 `blocked` 仍含全部能力（**这是本设计存在的首要理由，必须有此用例**）
2. **零痕迹**：SANCTION 客户与正常客户对 `/auth/me`、`/client/me/restrictions`、`/client/deposit-transactions` 三个响应体**逐字节相等**（复刻提现补料 Embed 的不可区分性断言）
3. **贴不审批撕审批**：POST 贴 → 立即 `blocked` 生效、无 ApprovalCase；POST release → 建 ApprovalCase 且便签仍 OPEN；MLRO 批 → 撕
4. **MLRO 类缺 `releaseOrderRef` → 400**
5. **贴 ALL 冻在途单**：三域各建一笔在途单 → 贴 SANCTION → 三笔全 FROZEN（含兑换，本轮新补）
6. **`scope < ALL` 不动在途单**

### 7.3 硬闸门

`tsc` 0 错 · `npm test` 净新增失败 0 · `test:e2e` 全绿 · `demo:all` 8/8 · `verify:coa` ALL PASS（本设计不动账本，应无影响，作回归）

### 7.4 截图验收（业主口径：UI 一致性靠渲染截图，curl 200 不算）

- admin 客户详情 Restrictions 节（含 🔇 行）
- Add / Release 两个弹窗
- 客户端：SANCTION 客户与正常客户**并排截图**证明无差异
- 客户端：MATERIAL_EXPIRED 客户的提示条 + 灰按钮

---

## 8 待决 / 风险

| # | 事项 | 处置 |
|---|---|---|
| Q1 | 制裁客户订单级折叠（收单挂 PROCESSING） | 本轮不做，与 BACKLOG「提现域 tipping-off 未对齐」一并排期 |
| Q2 | 销户流程 | 本轮只落轴上位置 + 三条不变量断言函数 |
| Q3 | `expirePendingApprovals()` 无 @Cron，48h 是展示字段 | 平台级缺陷，不在本轮；本设计按现有范式写 |
| Q4 | 客户被限时的通知 | `core/notifications/` 本体是 stub，不接 |
| R1 | 改动面横跨 identity / trading 三域 / 两端前端 | 实施计划按「模型 → 后端读侧 → 写入方迁移 → 两端 UI」四段切，每段自带闸门 |
| R2 | 删 `complianceStatus` 会打到 6 个读侧 | §3.4 已逐个列出改法，实施计划逐条勾 |

---

## 9 同步清单（实现后必做）

- `truth/v2-customer-compliance.md` —— 三轴段整段重写为一轴 + 限制账；勾掉 §4「冻结/解冻无统一 workflow」红线
- `BACKLOG.md` —— 勾掉「客户永久卡死无解锁出口」（本设计的人工 release 即出口）；新登记 Q1/Q2/Q3 三条
- `glossary/global-glossary.md` —— 补「限制账 / cause / visibility / releasePolicy」词条
- `rules/frontend-admin.md` —— Per-entity Sidebar Fields 表补 CustomerRestriction 行
