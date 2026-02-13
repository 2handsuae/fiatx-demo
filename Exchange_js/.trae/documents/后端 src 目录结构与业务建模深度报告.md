# 执行计划：Payin 与 Deposit 字段重构及合规上移

我将按照以下步骤执行字段修改和业务逻辑对齐：

## **1. 数据库模型重构 (Prisma)**
*   **修改 [schema.prisma](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/prisma/schema.prisma)**：
    *   从 `Payin` 模型中删除 `kytStatus`, `kytScreeningId`, `kytRiskScore`, `kytCheckedAt`, `travelRuleRequired`, `travelRuleStatus`, `travelRuleTransferId`, `counterpartyVasp`, `travelRuleCheckedAt`。
    *   将上述 9 个字段添加到 `DepositTransaction` 模型中。
    *   在 `DepositTransaction` 模型中新增 `statusHistory` (String?) 字段。
*   **执行迁移**：
    *   运行 `npx prisma migrate dev --name migrate_compliance_to_deposit`
    *   运行 `npx prisma generate`

## **2. DTO 代码对齐**
*   **更新 [payin.dto.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/src/modules/payins/dto/payin.dto.ts)**：移除已删除字段的验证逻辑。
*   **更新 [deposit-transaction.dto.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/src/modules/deposit-transactions/dto/deposit-transaction.dto.ts)**：增加合规字段和 `statusHistory` 的 DTO 定义。

## **3. Service 业务逻辑重构**
*   **更新 [payins.service.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/src/modules/payins/payins.service.ts)**：清理不再属于物理入账层的合规处理代码。
*   **更新 [deposit-transactions.service.ts](file:///Users/songshengwei/Documents/trae_projects/Exchange_js/src/modules/deposit-transactions/deposit-transactions.service.ts)**：
    *   在 `updateStatus` 方法中增加逻辑，每次状态变更时自动向 `statusHistory` 追加 JSON 格式的时间轴记录。
    *   确保合规字段在充值生命周期中得到妥善处理。

## **4. 验证**
*   通过 `npm run start:dev` 确保服务启动正常。
*   （可选）编写简单的单元测试验证 `statusHistory` 的追加逻辑。

**请确认以上步骤，确认后我将立即开始执行。**
