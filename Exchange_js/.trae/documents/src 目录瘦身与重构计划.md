# 代码架构瘦身与领域重组计划

## 1. 基础设施准备
### 创建新目录结构
- 创建一级目录：`src/core/`, `src/orchestrators/`, `src/config/manifests/`
- 创建领域子目录：
  - `src/modules/asset-treasury/`
  - `src/modules/accounting/`
  - `src/modules/clearing-settle/`
  - `src/modules/trading/`
  - `src/modules/counterparty/`
  - `src/modules/identity/`
  - `src/modules/risk-engine/`

## 2. 领域模块迁移 (Domain Migration)
### 资产与资金域 (Asset & Treasury)
- 迁移 `assets`, `wallets`, `payins`, `payouts`, `treasury` 到 `modules/asset-treasury/`

### 账务域 (Accounting)
- 迁移 `coa`, `journals`, `journal-lines`, `journal-header-templates`, `journal-line-templates`, `acct-events` 到 `modules/accounting/`

### 清结算域 (Clearing & Settle)
- 迁移 `clearing` 到 `modules/clearing-settle/`

### 交易域 (Trading)
- 迁移 `deposit-transactions`, `withdraw-transactions`, `swap-transactions` 到 `modules/trading/`

### 对手方域 (Counterparty)
- 迁移 `liquidity-providers`, `liquidity-config` 到 `modules/counterparty/`

### 身份域 (Identity)
- 迁移 `auth`, `users`, `customers` 到 `modules/identity/`

## 3. 支撑层与配置迁移
### 核心支撑层 (Core)
- 迁移 `monitoring`, `notifications`, `prisma` 到 `src/core/`

### 业务编排层 (Orchestrators)
- 将 `src/modules/workflows/` 中的核心编排服务（如 `withdraw-workflow.orchestrator.ts`）迁移至 `src/orchestrators/`

### 配置数据剥离 (Config)
- 将 `acct-config.data.ts` 等初始数据文件迁移至 `src/config/manifests/`

## 4. 逻辑完善与修复
### 风控引擎 (Risk Engine)
- 在 `src/modules/risk-engine/` 下建立基础服务结构

### 全局引用修复
- 批量更新所有文件的 `import` 路径
- 更新 `src/app.module.ts` 中的模块导入路径
- 更新 `prisma/seed.ts` 中的数据源引用路径

## 5. 验证与清理
- 确保所有测试用例通过
- 清理 `prisma/` 目录下的临时脚本（移至根目录 `scripts/`）
- 验证系统启动和初始 Seed 流程正常
