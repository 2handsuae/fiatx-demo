# 全局业务编号 (No) 重构计划

## 1. 数据库模型变更 (Prisma)
- 修改 `prisma/schema.prisma`，为以下模型添加唯一业务编号字段：
  - `CustomerMain` -> `customerNo`
  - `Asset` -> `assetNo`
  - `Wallet` -> `walletNo`
  - `Payin` -> `payinNo`
  - `Payout` -> `payoutNo`
  - `Journal` -> `journalNo`
  - `Clearing` -> `clearingNo`
  - `Coa` -> `coaNo`
  - `LiquidityProvider` -> `lpNo`
- 为所有新字段添加 `@unique` 约束和 `@@index`。

## 2. 后端逻辑重构
- 在 `src/common/utils/no-generator.util.ts` 中确认生成逻辑。
- 更新以下 Service 文件的 `create` 方法，实现自动编号生成：
  - `src/modules/identity/customers/customers.service.ts`
  - `src/modules/counterparty/liquidity-providers/liquidity-providers.service.ts`
  - `src/modules/asset-treasury/assets/assets.service.ts`
  - `src/modules/asset-treasury/wallets/wallets.service.ts`
  - `src/modules/asset-treasury/payins/payins.service.ts`
  - `src/modules/asset-treasury/payouts/payouts.service.ts`
  - `src/modules/accounting/journals/journals.service.ts`
  - `src/modules/clearing-settle/clearing/clearings.service.ts`

## 3. 前端界面适配 (admin-web)
- 遍历 `admin-web/src/pages/` 下的所有列表页面。
- 将表格中展示 `id` 的位置替换为对应的 `*No` 字段。
- 在涉及关联展示的地方（如清分详情中的 Source ID），优先展示业务编号。

## 4. 数据同步
- 更新 `prisma/seed.ts` 以支持初始数据的编号生成。
- 运行数据库迁移：`npx prisma migrate dev --name add_business_numbers`。
