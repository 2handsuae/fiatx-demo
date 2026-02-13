# 数据库数据分类与重置方案

## 1. 核心目标
将系统数据划分为“永久配置”与“临时业务数据”，并提供安全的一键重置机制。

## 2. 数据分类详情
### 永久保留 (System Config)
- **Admin 用户**: 仅保留 `email: admin@fiatx.com` 的用户。
- **会计体系**: `COA` (科目表)、`AcctEvent` (会计事件)。
- **模板体系**: `JournalHeaderTemplate`, `JournalLineTemplate`, `ClearingTemplate`, `ClearingLineTemplate`。
- **核心资产**: `Asset` 表中 code 为 `USDT` 和 `AED` 的记录。

### 随时清空 (Business Data)
- **交易记录**: `Payin`, `Payout`, `DepositTransaction`, `SwapTransaction`, `WithdrawTransaction`。
- **会计账目**: `Journal`, `JournalLine`, `Clearing`, `ClearingLine`。
- **客户与钱包**: `CustomerMain`, `CustomerAuditLog`, `Wallet`。
- **流动性配置**: `LiquidityProvider`, `LiquidityConfiguration`。

## 3. 技术实施步骤

### 第一阶段：代码重构
1. **重构 `prisma/seed.ts`**:
   - 拆分为 `seedSystemData()` 和 `seedMockData()`。
   - 确保 `seedSystemData()` 内部全部使用 `upsert` 逻辑。
2. **定义系统常量**:
   - 在 `src/common/constants/system.ts` 中定义必须保留的资产 Code 和管理员 Email。

### 第二阶段：编写清理脚本
1. **创建 `prisma/reset-business.ts`**:
   - 编写顺序删除逻辑，先删除子表，再删除主表。
   - 实现“安全删除”：在删除 `Asset` 和 `User` 时，增加 `where` 过滤条件，排除系统必需项。

### 第三阶段：工程化集成
1. **更新 `package.json`**:
   - 增加 `npm run db:reset-business` 命令，调用清理脚本。

## 4. 关键差异说明
- **不采用物理分库**: 物理分库会导致 Prisma 失去跨库外键约束，增加代码复杂度。
- **采用逻辑隔离**: 通过脚本确保 `dev.db` 始终处于“干净”或“包含系统配置”的状态。

请确认该计划，我将开始实施清理脚本和 Seed 逻辑的重构。