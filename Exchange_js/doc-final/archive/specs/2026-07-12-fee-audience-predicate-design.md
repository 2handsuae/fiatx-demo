# 费率受众谓词 + 客户标签地基 — 设计（提现 + 兑换 · 硬切）

Date: 2026-07-12
Status: Design（待 review → writing-plans）
来源: 2026-07-11 费率治理 V3 PRD（飞书 `docx/KoqidVBVMoPIBoxOVVKltxn6g9c`）脑暴 → 本设计定实现方案

---

## 0. 一句话

把费率等级的"受众"从现状「`isDefault` + 逐客户 binding 表」改成 **`{requiredTags, window}` 一个谓词**，全部走**客户标签**；客户管理新增 **operator 手动打 tag** 功能，tag 经**固定注册表**共享，被 fee level 的 `requiredTags` 引用；**硬切退役 binding 表**。提现、兑换两域同步做。

## 1. 决策台账（脑暴已拍板）

| # | 决策 | 定论 |
|---|---|---|
| 1 | 标签存储 | **混合**：派生标签由 `effectiveTags` 从现有客户字段现算（零存储）；显式标签（白名单/指定客户）落新表 |
| 2 | binding 退役 | **硬切**（重做版/demo 无真实客户）：同批改动建谓词路径 + 迁种子 binding + 换 `resolveBestLevel` + 删表 |
| 3 | 范围 | **提现 + 兑换一起**（客户标签地基共享，费率侧两域同构） |
| 4 | Tag 目录 | **固定注册表常量**（非 DB CRUD）：operator 从注册表选 tag 打，fee level 从同一注册表选 tag 引用 |
| 5 | 手动打 tag | **硬需求**：客户管理必须有 operator 手动打 tag 的前端功能，tag 可被 fee level 引用 |
| 6 | 新客起算日 | CustomerMain 加 `onboardingApprovedAt` 冗余列（onboarding 终批时写），比 join / createdAt 干净 |
| 7 | 受众变更是否走 configHash | **不走**：configHash 仍只保护 `tiersJson` 费率本身；受众（requiredTags/window）变更直接更新 |
| 8 | 报价"资格快照" | **延后**单列（独立于选级正确性，本轮先把引擎换对）|
| 9 | 派生标签集 | 本轮只 `NEW_CUSTOMER` + `VIP`；high-risk/PEP 要时再加一行 if |

## 2. 现状锚点（对着代码）

- 费率等级两域对称：`WithdrawalFeeLevel` / `SwapFeeLevel`（`levelCode` 业务键、`tiersJson`、`configHash`、`isDefault`、`enabled`、status PENDING_APPROVAL→ACTIVE）。
- 受众现状：`resolveBestLevel`（`withdraw-quote.service.ts` / `swap-quote.service.ts`）可用集合 = `findActiveByAsset` 里 `isDefault` **或** `WithdrawalFeeLevelBinding`/`SwapFeeLevelBinding`（`[customerId, levelId]`）命中 → 匹配 tier → 算费 → **cheapest**。
- 客户主表 `CustomerMain`：有 `tradingTier`(BASIC/PREMIUM)、`riskRating`(LOW/MED/HIGH)、`pepStatus`、`investorTier`、`restrictions`(JSON 数组，list-on-customer 范式) + `createdAt`；**无任何 tag/segment 体系**，**无 onboarding 完成时间戳**（`onboardingStatus` 是字符串）。

## 3. A — 客户域标签地基（共享，先建）

### 3.1 Tag 注册表（固定常量，共享字典）
新常量 `CUSTOMER_TAG_DEFINITIONS`（如 `customer-tags/constants/customer-tag.constant.ts`）：

```
{ tagCode, displayName, type: 'STATIC' | 'DERIVED', description }
```

- `STATIC`：operator 手动可打（`WHITELIST_*`、`VIP_MANUAL`、活动组 `CAMPAIGN_*` 等）。
- `DERIVED`：系统现算、不可手打（`NEW_CUSTOMER`、`VIP`）。
- **唯一真相源**：客户端打 tag、fee level 引用 tag **都读它**，禁自由文本 → 钱路无 typo 断裂。

### 3.2 显式标签存储 + 赋值
新表 `customer_explicit_tags`：`id / customerId / tagCode / assignedByUserId / assignedAt`，唯一 `[customerId, tagCode]`。只存 **STATIC** 赋值。
- Service：`assign(customerId, tagCode, actor)` / `revoke(customerId, tagCode, actor)`；`tagCode` 必须是注册表里 `type=STATIC` 项，否则拒。
- 审计：`TAG_ASSIGNED` / `TAG_REVOKED`，workflowType `CUSTOMER_TAG`，entityType `CUSTOMER_TAG`，entityNo = `<customerNo>:<tagCode>`（业务键，不暴露 id）。

### 3.3 求值器 `effectiveTags(customerId, now)`
归客户域（`customer-tags` 模块）。返回 `Set<tagCode>` = **显式 ∪ 派生**：
- 显式：查 `customer_explicit_tags`。
- 派生（现算、零存储、免定时器）：
  - `NEW_CUSTOMER` = `now − onboardingApprovedAt ≤ newCustomerDays`（配置项）。
  - `VIP` = `tradingTier == 'PREMIUM'`。
- **铁律**：派生标签**只算不存**，"过期"由现算天然得出（防 staleness 错价）。

### 3.4 新客起算日
`CustomerMain` 加冗余列 `onboardingApprovedAt DateTime?`，onboarding 终批（FINAL_APPROVAL 通过）那一刻写入。`NEW_CUSTOMER` 以它起算。

### 3.5 手动打 tag UI（前端 · 客户管理）
客户详情页新增「标签」面板：
- **加/删 STATIC 标签**：从注册表 `type=STATIC` 多选赋给该客户 → 调 assign/revoke API。
- **只读展示 DERIVED 标签**：新客 / VIP 等系统算的，以只读徽章显示（不可手打）。
- 展示当前 `effectiveTags` 全集（显式 + 派生）。
- ⚠ 遵项目规范：不暴露原始 id（用 `customerNo`/`tagCode`）；UI 完成前须 preview 渲染截图验证。

## 4. B — 费率域受众谓词（提现 + 兑换对称）

### 4.1 数据模型
`WithdrawalFeeLevel` / `SwapFeeLevel` 各加：
- `requiredTagsJson String @default("[]")` —— JSON 数组，元素为注册表 tagCode（沿用 `restrictions`/`tiersJson` JSON 列范式）。
- `validFrom DateTime?` / `validTo DateTime?` —— 时间窗（活动级用；null = 无窗）。

### 4.2 受众判定
```
命中(level, customer, now) =
   (level.validFrom/To 未设 或 now ∈ [validFrom, validTo])
   且 (level.requiredTags ⊆ effectiveTags(customer, now))
```
`isDefault` **保留**为 EVERYONE 语义（等价 requiredTags 空 + 无窗），少动。

### 4.3 `resolveBestLevel` 改造
可用集合 = 该资产/币对 `ACTIVE + enabled` 等级中 `isDefault` **或** 4.2 谓词命中 → **后续（`findMatchedTier` 匹配金额分层、`calculateFeeLines` 算费、cheapest 取最低）一行不改**。
- 需注入 `effectiveTags` 求值器（费率域调客户域）。

### 4.4 requiredTags 引用 UI（前端 · 费率配置）
level 创建/变更表单加 `requiredTags` 多选器 + `validFrom/validTo` 选择 → 从注册表多选（STATIC + DERIVED 皆可，如"要求 白名单A 或 新客"）。存 `requiredTagsJson`。

## 5. C — binding 硬切退役（依赖 A、B）

1. **迁移**（一次性脚本/seed 调整）：现有每条 binding（客户 C ↔ 等级 L）→ 给 C 赋一个 whitelist STATIC 标签（如 `WHITELIST_<levelCode>` 或按业务归并），并把 L 的 `requiredTagsJson` 设为该标签。
2. **删**：`withdrawal_fee_level_bindings` / `swap_fee_level_bindings` 表 + `*BindingService` / `*BindingWorkflowService` / binding controller 路由 + `resolveBestLevel` 的 bound 分支 + `WITHDRAWAL/SWAP_FEE_LEVEL_BINDING` 审计常量组。
3. **审计迁移**：`LEVEL_BOUND / LEVEL_UNBOUND` 语义 → 客户域 `TAG_ASSIGNED / TAG_REVOKED`。

## 6. 顺序与验证

1. **A 客户标签地基** —— 可独立测：`effectiveTags` 返回集正确（含 NEW_CUSTOMER 到期现算不命中）。
2. **B 费率谓词** —— `resolveBestLevel` 换判定，两域同步。
3. **C binding 迁移 + 删表**。

**保真铁律**：迁移前后，同客户、同资产、同金额 `resolveBestLevel` 取费**逐一致**（等价保真测试，两域各覆盖）。

硬闸（全绿方算完）：`tsc` 0 报错、相关单测、`db:base:sync`（新权限/常量）、后端重启（RBAC 走内存）、UI 渲染截图验证。

## 7. 非目标 / 延后

1. 报价"资格快照"（命中集合/标签快照落 quote）—— 延后单列。
2. Tag 目录 DB CRUD + 管理页 —— 本轮固定注册表；operator 自建 tag 是后续。
3. 派生标签 high-risk / PEP —— 需要时加。
4. 受众变更走 configHash 审批链 —— 本轮受众变更直接更新。
5. 优先级/加价选级 —— 本轮仅 cheapest（V3 §5.5 明确不做）。
6. 数据表/接口/错误码细节 —— 交实现。

## 8. 风险与开放项

- **`onboardingApprovedAt` 回填**：加列后历史客户该列为 null → NEW_CUSTOMER 对老客户永假（可接受；或迁移时按 onboarding 记录 completedAt 回填一次）。
- **迁移归并策略**：多客户绑同一 level 时，whitelist 标签是"每 level 一个"还是"共享一个" —— 实现时按 seed 实际情况定（V3 §5.4 已留口径）。
- **RBAC**：手动打 tag / 撤 tag 是变更操作，需新权限门（`CUSTOMER_TAG_MANAGE` 类），登记 rbac catalog + db:base:sync + 重启。
- **两域 DRY**：费率侧提现/兑换代码同构，抽共享判定逻辑避免双份漂移。

<p align="center">— 设计结束 —</p>
