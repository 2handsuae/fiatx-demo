# 合并 Prisma 数据初始化脚本

为了优化项目结构并确保数据初始化的顺序正确性，我将把散落在 `prisma` 目录下的多个基础配置脚本合并到主脚本 [seed.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/prisma/seed.ts) 中。

## **1. 合并逻辑设计**
合并后的 [seed.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/prisma/seed.ts) 将采用模块化结构，按以下顺序执行（处理外键依赖）：
1.  **管理员与客户 (seedAdmin & seedCustomers)**：创建系统初始管理员及测试客户。
2.  **基础资产 (seedAssets)**：初始化 AED, USD, USDT, BTC 等资产。
3.  **会计科目 (seedCOA)**：根据 [seed_coa_v2.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/prisma/seed_coa_v2.ts) 初始化科目表。
4.  **会计配置 (seedAcctConfig)**：同步会计事件（AcctEvent）和记账模板（Journal Templates）。
5.  **清分模板 (seedClearing)**：初始化提现清分模板并与事件关联。

## **2. 技术实现要点**
*   **幂等性处理**：全部使用 `upsert` 或“先检查再创建”的逻辑，确保脚本多次运行不会产生重复数据或报错。
*   **代码清理**：合并完成后，将删除以下冗余文件以保持目录整洁：
    *   `seed_assets.ts`
    *   `seed_coa_v2.ts`
    *   `seed_acct_config.ts`
    *   `seed_clearing_withdraw.ts`
*   **保留工具脚本**：保留 [update_legacy_configs.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/prisma/update_legacy_configs.ts)（用于数据迁移）和 [verify_clearing_data.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/prisma/verify_clearing_data.ts)（用于功能验证），因为它们不属于“初始基础配置”。

## **3. 验证步骤**
*   运行 `npx prisma db seed` 执行合并后的脚本。
*   确认数据库中的管理员、资产、会计科目及配置模板均已正确就绪。

您是否同意按照此方案执行合并？
