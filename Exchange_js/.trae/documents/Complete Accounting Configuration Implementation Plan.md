# 会计配置全面补齐实施计划

## 1. 现状分析
经过检查，现有的 **Deposit (入金)** 相关配置在 Schema 升级后存在大量字段缺失（null），主要涉及：
- **AcctEvent**: 缺少 `triggerKey`, `fromStatus`, `toStatus` 等状态机触发配置。
- **JournalLineTemplate**: 缺少 `ownerTypeSource`, `ownerIdSource`, `referenceSource`, `description` 等结构化来源配置，且 `dimensionsRule` 为空。

## 2. 补齐逻辑

### A. 会计事件 (AcctEvent) 状态机补齐
| 事件代码 | triggerKey | fromStatus | toStatus |
| :--- | :--- | :--- | :--- |
| EVT_DEPOSIT_CONFIRMED__CRYPTO | status | PAYIN_LINKED | CONFIRMED |
| EVT_DEPOSIT_SUCCESS__CRYPTO | status | PENDING_COMPLIANCE | SUCCESS |
| EVT_DEPOSIT_CONFIRMED__FIAT | status | PAYIN_LINKED | CONFIRMED |
| EVT_DEPOSIT_SUCCESS__FIAT | status | PENDING_COMPLIANCE | SUCCESS |
| EVT_DEPOSIT_REJECTED__CRYPTO | status | CONFIRMED | REJECTED |
| EVT_DEPOSIT_REJECTED__FIAT | status | CONFIRMED | REJECTED |

### B. 分录模板 (JournalLineTemplate) 结构化补齐
对于所有入金相关的分录行，将补齐以下规则：
- **客户侧科目** (如 L.CLIENT_AUDIT, L.CLIENT_CREDIT):
    - `ownerTypeSource`: `'CUSTOMER'`
    - `ownerIdSource`: `'src.ownerId'`
    - `referenceSource`: `'src.depositId'`
    - `dimensionsRule`: `{"client_id":"{{src.ownerId}}","assetId":"{{src.assetId}}"}`
- **平台侧科目** (如 A.CUSTODY, A.BANK):
    - `ownerTypeSource`: `'PLATFORM'`
    - `ownerIdSource`: `null`
    - `referenceSource`: `'src.depositId'`
    - `dimensionsRule`: `{"assetId":"{{src.assetId}}","walletid":"{{src.towalletid}}"}`
- **描述补全**: 将根据原有的业务逻辑补齐 `description` 字段。

## 3. 执行步骤
- [ ] 编写并运行 `prisma/update_legacy_configs.ts` 脚本，对数据库中现有的 6 条事件和 12 条分录模板进行全量更新。
- [ ] 再次验证数据库，确保所有 `null` 字段已被合理的配置值覆盖。
