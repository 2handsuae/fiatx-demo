# Swap 交易会计配置实施计划

## 1. Schema 补全 (AcctEvent)
为了支持 `STATUS_TRANSITION` 类型的触发逻辑，需要将事件状态机信息结构化：
- [ ] 为 `AcctEvent` 模型增加 `triggerKey` (触发字段，如 'status')、`fromStatus` (原状态)、`toStatus` (目标状态) 字段。
- [ ] 执行数据库迁移：`npx prisma migrate dev --name add_event_transition_fields`。

## 2. 数据补全与映射
基于您提供的数据，我将进行以下结构化补全，以适配我们刚刚升级的 V3 模板结构：

### AcctEvent 补全：
- **EVT_SWAP_CREATED**: `triggerKey: 'status'`, `fromStatus: null`, `toStatus: 'CREATED'`
- **EVT_SWAP_REJECTED**: `triggerKey: 'status'`, `fromStatus: 'PENDING_COMPLIANCE'`, `toStatus: 'REJECTED'`
- **EVT_SWAP_SUCCESS**: `triggerKey: 'status'`, `fromStatus: 'PENDING_COMPLIANCE'`, `toStatus: 'SUCCESS'`

### JournalLineTemplate 结构化补全：
- 所有行将自动补全：
    - `ownerTypeSource`: `'CUSTOMER'`
    - `ownerIdSource`: `'src.ownerId'`
    - `referenceSource`: `'src.swapNo'`
- SUCCESS 事件的行将增加：
    - `fxRateSource`: `'src.exchangeRate'`

## 3. Seed 脚本执行
- [ ] 编写 `prisma/seed_swap_config.ts` 脚本。
- [ ] 获取 `AED` 资产的真实 UUID。
- [ ] 按照补全后的数据，依次插入：
    1. 3 条 `AcctEvent`
    2. 2 条 `JournalHeaderTemplate`
    3. 4 条 `JournalLineTemplate`
- [ ] 运行脚本：`npx ts-node prisma/seed_swap_config.ts`。

## 4. 交付
- [ ] 确认数据已正确进入数据库。
- [ ] 您可以在管理后台的“会计事件”和“凭证模板”中查看到这些新配置。
