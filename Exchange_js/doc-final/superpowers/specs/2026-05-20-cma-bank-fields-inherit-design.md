# CMA Bank Fields Inherit Design

## Goal

Admin 创建 CMA 时手动填写 `bankName`（Bank Name）和 `accountName`（Account Holder）；创建 vIBAN 时自动从同资产 CMA 继承这两个字段（只读，不可覆盖）。客户自助创建 vIBAN 时同样自动继承。客户端充值页面已展示这两个字段，无需改动。

## Background

- `bankName` / `accountName` 已存在于 Wallet schema，无需改表
- CMA (C_CMA) = 平台级 FIAT 银行账户，每个 FIAT 资产一个
- vIBAN (C_VIBAN) = 客户级虚拟 IBAN，从 CMA 派生
- 客户端 `Deposit.tsx` 已读取并展示 `wallet.bankName` / `wallet.accountName`

## Constraints

1. **CMA 创建**：`bankName` 和 `accountName` 为必填（当 role=C_CMA 且 type=FIAT_BANK）
2. **vIBAN 继承**：只读复制，不可手动修改
3. **CMA 必须先于 vIBAN 存在**：创建 vIBAN 时找不到 ACTIVE CMA 则报错
4. **零 schema 变更**：字段已存在，不需要 migration

## Changes

### 1. Backend — DTO

**File:** `src/modules/asset-treasury/wallets/dto/create-custodian-wallet.dto.ts`

新增两个可选字段：

- `bankName?: string` — CMA 创建时必填，vIBAN 创建时忽略（后端覆盖）
- `accountName?: string` — 同上

### 2. Backend — CustodianWalletCreateWorkflowService

**File:** `src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts`

`initiateCreate` 方法内：

- **CMA 路径**：校验 `bankName` 和 `accountName` 非空，传入 `createWalletRecord`
- **vIBAN 路径**：查询 `walletRole=C_CMA, assetId=当前资产, status=ACTIVE`，取其 `bankName`/`accountName`，传入 `createWalletRecord`。找不到 CMA 则抛 `BadRequestException`

识别方式：CMA = `dto.role === 'C_CMA'`，vIBAN = `dto.role === 'C_VIBAN'`

### 3. Backend — CustomerDepositWalletService

**File:** `src/modules/asset-treasury/wallets/customer-deposit-wallet.service.ts`

`createOrReturn` 方法内，当 `walletRole === C_VIBAN`（即 FIAT 资产）时：

- 查询同资产 ACTIVE CMA
- 在 `prisma.wallet.create` 的 data 中加入 `bankName` / `accountName`

### 4. Admin Frontend — CustodianWalletCreateModal

**File:** `admin-web/src/pages/CustodianWalletCreateModal.tsx`

- **CMA 创建**：新增 Bank Name + Account Holder 两个必填文本输入框，条件：`role === 'C_CMA'`
- **vIBAN 创建**：选择资产后，fetch 该资产的 CMA 钱包数据，将 `bankName`/`accountName` 以只读方式展示。条件：`role === 'C_VIBAN'`
- 提交时将 `bankName`/`accountName` 加入 request body（仅 CMA）

### 5. Client Frontend

**零改动** — `client-web/src/pages/Deposit.tsx` 已展示 `bankName` 和 `accountName`。

## Out of Scope

- CMA bankName/accountName 修改功能（如果 CMA 改了银行名，需要另外设计批量更新 vIBAN 的流程）
- 非 FIAT 钱包的 bankName/accountName 处理
