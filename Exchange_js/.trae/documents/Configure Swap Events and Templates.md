# Journal & Template 结构化升级实施计划

## 1. Schema 层面修改 (prisma/schema.prisma)
### JournalHeaderTemplate
- [x] 添加 `effectiveTo` DateTime?

### JournalLineTemplate
- [x] 重命名 `memo` 为 `description`
- [x] 添加 `ownerTypeSource` String? (归属方类型来源)
- [x] 添加 `ownerIdSource` String? (归属方ID来源)
- [x] 添加 `fxRateSource` String? (汇率来源)
- [x] 添加 `referenceSource` String? (参考号来源)

## 2. 数据库迁移
- [x] 运行 `npx prisma migrate dev` 生成并应用迁移脚本。

## 3. 字段说明表格交付
- [x] 输出四个主体（Journal, JournalHeaderTemplate, JournalLine, JournalLineTemplate）的详细字段表格。
