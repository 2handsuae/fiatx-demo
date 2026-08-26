# V8 外部对账单 Admin 展示 — 设计 spec

日期：2026-06-19
状态：脑暴对齐完成，待实施
前置：V8 对账（spec 2026-06-18）+ statement-driven demo（`reconciliation_external_statements` 表已落地，ZAND/HEXTRUST 两行已存）

---

## 0. 目标

把已存储的 HexTrust（USDT）+ Zand（AED）外部对账单在 admin 展示：**一个列表页 + 一个 source-aware 详情页**（合并，非分开）。只读。遵 `doc-final/rules/frontend-admin.md`。

## 1. 决策：合并

ZAND/HEXTRUST 同一张表 `reconciliation_external_statements`，只差 `source` + rawJson 形状。**一个列表（按 source 可筛）+ 一个详情（按 source 渲不同明细表）** —— 一套代码、一个路由、一个侧边栏项。分开会 90% 重复。

## 2. 数据源

`reconciliation_external_statements`：id, source(ZAND|HEXTRUST), businessDate, currency, accountRef, closingBalance, rawJson, fetchedAt, createdAt。
- ZAND rawJson：`{ StatementInfo{FromDate,ToDate,AccountId}, StatementRecords[]{ChannelRefId,InstructionIdentification,ValueDate,PostedDate,InstructedAmount,TransactionAmount{Amount,Currency},TransactionType(Credit|Debit),Remarks,BeneficiaryDetails,Description,PartType,Balance,VirtualAccount}, Page }`
- HEXTRUST rawJson：`[ {id,traceId,txHash,amountDecimal,assetKey,transactionType,primaryTransactionStatus,vaultId,from,to,confirmationCount,blockTimestamp,createdAt} ]`

## 3. 业务键（frontend-admin：禁裸 id 作主键）

加 `statementNo` 到表：格式 `STMT-{businessDate}-{source}-{currency}`（如 `STMT-20260616-ZAND-AED`）。小迁移 + backfill 现有 2 行。列表/详情按 statementNo 检索。

## 4. 后端（recon controller/query 加 2 端点）

```
GET /admin/reconciliation/statements           → list（reconciliation_external_statements，按 createdAt desc；可选 ?source 过滤）
GET /admin/reconciliation/statements/:statementNo → detail（含解析后的 entries：ZAND StatementRecords / HEXTRUST tx[]）
```
- query service 加 `listStatements(q)` + `getStatement(statementNo)`（getStatement 解析 rawJson 返回 { ...row, parsed: { kind:'ZAND'|'HEXTRUST', records?:[...], txs?:[...] } }）。
- controller 加 2 个 @Get + @RequirePermissions(buildPermissionCode(...))。

## 5. 前端（沿用 recon 两栏范式 + 共享原语）

**列表页** `admin-web/src/pages/ReconciliationStatementsListPage.tsx`（route `reconciliation/statements`）
- 共享表格 + Pagination + adm-* token + 英文。
- 列：Statement No(mono) · Source(StatusPill ZAND/HEXTRUST) · Currency · Account Ref · Closing Balance(mono) · Entries(条数) · Business Date · Fetched At。
- 可选 Source 过滤；行 → `/admin/reconciliation/statements/{statementNo}`。

**详情页** `ReconciliationStatementDetailPage.tsx`（route `reconciliation/statements/:statementNo`）两栏 Hero+Sidebar（照 SwapTransactionDetail）：
- Nav: ← Statements / Refresh（无 title/subtitle）。
- Hero(bg-adm-card): statementNo(amber mono) + 标签字段 Source(StatusPill) / Currency / Closing Balance / Business Date。
- DetailCard "Statement Info"：source, accountRef, closingBalance, businessDate, fetchedAt, entries 条数。
- 明细 section（source-aware，adm-* 表格）：
  - ZAND → StatementRecords 表：Value Date · Channel Ref · Description · Amount(Credit 绿/Debit 红方向) · Balance · Virtual Account。
  - HEXTRUST → tx 表：Block Time · Tx Hash(截断) · Amount · Type(DEPOSIT/WITHDRAWAL pill) · Status · Vault · From/To(截断)。
- Technical 末: DetailCard + JsonBlock 展示原始 rawJson + accountRef。
- Sidebar: Identity(Statement No / Source / Currency / Closing Balance) + Lifecycle(Business Date / Fetched At / Created)。

## 6. RBAC + 路由 + 侧边栏 + Per-entity 表

- RBAC：`rbac.catalog.ts` 加 `RECON_STATEMENT_READ` 组 + 2 路由条目；`permissions.ts` 加 `RECON_STATEMENT_READ`/`RECON_STATEMENT_DETAIL_READ`。
- App.tsx：加 2 lazy 路由（静态段先于动态段）。
- DashboardLayout 侧边栏 Reconciliation 组加 "External Statements"（path `/admin/reconciliation/statements`）。
- frontend-admin.md Per-entity 表加：`ReconciliationExternalStatement | statementNo, source, currency, closingBalance | businessDate, fetchedAt, createdAt`。

## 7. 验收

- `npx tsc -b` 净 + `npm run build`（admin-web）成功。
- 后端：curl GET /admin/reconciliation/statements + /:statementNo（SUPER_ADMIN token）返数据。
- 渲染截图：列表（2 行 ZAND+HEXTRUST）+ ZAND 详情（StatementRecords 表）+ HEXTRUST 详情（tx 表）。

## 8. 范围外

- 不做编辑/重新拉取（只读）。
- 不做真实 HexTrust/Zand API 拉取（仍读已存储的 statement）。
- 不改对账 run/case 逻辑。
