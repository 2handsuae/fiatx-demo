# External Balances 页（#4 父子）+ 行下钻（#5）+ #3 旧页全退役 + FIRM 数据补齐

日期：2026-06-20
状态：脑暴对齐，待 user review spec
触发：`external_balances`/`external_statement_lines` 前后端都缺页；旧 External Statements 页读 superseded blob 表应退役。
关联：承接记分牌 run 详情（[[v8-recon-redesign-done]]）——余额 closing 就是式4/式5 的外部侧。

---

## 0. 决策（脑暴已拍）
- **拓扑 A 合并父子**：一个「External Balances」页。余额=单账户单 cutoff 期末（`source×accountRef×currency×book×cutoffDate`），按 **book 分区**（Client / Firm）。行（lines）不单独建顶层页，挂在余额详情里下钻。
- **#3 全退役**：删 2 旧页 + 路由 + sidebar + 后端 `listStatements`/`getStatement` endpoint + **drop `reconciliation_external_statements` 表**（migration）。原始报文已在 `line.raw + statementId` 留证。
- **FIRM 数据补齐**：生成器枚举真实 `F_*` 钱包，每个非 VIBAN 账户出 1 张余额 + ≥1 行；closing 锚到内部 `A.FIRM_TREASURY` TB。VIBAN（`C_VIBAN`）滚 CMA 不单独出（现状保留）。
- **不做**：余额↔case 反向链接（记分牌已管"平没平"，本页管账户明细，职责分清）。

## 1. 后端（复用现有 recon controller/query 模式）
- `reconciliation-admin.controller.ts` 加：
  - `GET /admin/reconciliation/external-balances` → `query.listExternalBalances(q)`，filter `cutoffDate? / book? / source? / currency?`。
  - `GET /admin/reconciliation/external-balances/:statementId` → `query.getExternalBalance(statementId)`（用业务键 statementId 不暴露 UUID）。
  - 权限 `buildPermissionCode('GET', ...)`：已验 `permission-code.util` 把 `[^a-zA-Z0-9]+→_`，码确定为 `api.get.admin_reconciliation_external_balances`（list）/ `api.get.admin_reconciliation_external_balances_statementid`（detail）。
- `reconciliation-query.service.ts` 加：
  - `listExternalBalances(q)`：`externalBalance.findMany({ where:{cutoffDate,book,source,currency}, orderBy:[{book},{source},{currency}] })`。
  - `getExternalBalance(id)`：`findUnique({where:{id}})` + 取其流水 `externalStatementLine.findMany({ where:{ source, accountRef, currency }, orderBy:{datetime:'asc'} })`（行无 FK，按 `source+accountRef+currency` 同维匹配；`lineCount` 已 denormalize 做核对）。返 `{ ...balance, lines }`。NotFound 抛 404。
- `permissions.ts` 加 `RECON_EXTERNAL_BALANCE_READ` / `RECON_EXTERNAL_BALANCE_DETAIL_READ`。

## 2. List 页（新 `ReconciliationExternalBalancesListPage.tsx`）
- 顶部 filter：cutoff date（默认最新业务日）/ source / currency / book。
- **按 book 分区两段**：`Client accounts` / `Firm accounts`，每段一个 closing 小计行（按币种 Σ closingBalance —— 即式4/式5 外部侧）。
- 列：Source · Account(accountRef, mono) · Currency · **Closing**(mono, 负数 adm-red) · Lines(lineCount) · Status。
- 行点击 → `/admin/reconciliation/external-balances/{id}`。
- 空态、loading 复用现有 list 原语（参考 `ReconciliationRunsListPage`）。

## 3. Detail 页（新 `ReconciliationExternalBalancesDetailPage.tsx`）
- 两栏壳（main + sidebar），与 run/case 详情一致。
- Hero：`{source} · {accountRef}` + book badge(CLIENT=blue/FIRM=green) + currency；右侧 closing 大字(mono)。
- Header 卡：opening / closing / asOf / cutoffDate / lineCount / source / statementId / ingestedAt / status。
- **Roll-forward 自检卡**：`opening + Σnet(lines) =? closing`，相等 → adm-green「continuous」，否则 adm-red「discontinuity Δx」。（net = Σ IN − Σ OUT。真实数据 CMA: −8531.25 + 17181.63 = 8650.38 ✓。）
- **流水行表**：datetime · direction(IN green/OUT red) · amount(mono) · externalRef · channelRef · **subAccount(VIBAN, mono)** · balanceAfter · description；末列「raw」点开展开该行 `raw` JSON（行内抽屉/可展开行，不做独立详情页）。
- sidebar：Identity（source/accountRef/book/currency/cutoff）+ Ingest（ingestedAt/statementId/status）。
- adm-* token only；英文；数字 mono。

## 4. #3 全退役
- 删文件：`admin-web/src/pages/ReconciliationStatementsListPage.tsx` + `ReconciliationStatementDetailPage.tsx`。
- `App.tsx`：删 2 处 import（24-25）+ **两处**路由块（285-292、731-732）。换成新 External Balances 两路由（list + `:id`）。
- `DashboardLayout.tsx`：Reconciliation 组把 `External Statements`(statements) 项换成 `External Balances`(external-balances)，权限换 `RECON_EXTERNAL_BALANCE_READ`，icon 可沿用。
- `permissions.ts`：删 `RECON_STATEMENT_READ` / `RECON_STATEMENT_DETAIL_READ`（确认无其它引用后），加新两条。
- 后端：`reconciliation-admin.controller.ts` 删 `statements` / `statements/:statementNo` 两路由；`reconciliation-query.service.ts` 删 `listStatements` / `getStatement`。
- 删 model `ReconciliationExternalStatement` + 新增 migration `DROP TABLE reconciliation_external_statements`。
- 删 `ReconStatementQueryDto`（确认仅 controller 用 ✓）。
- **连带死 blob 路径出清**（drop 表必然连带，否则留读死表的死代码）：删 `adapters/zand-file.adapter.ts` + `adapters/hextrust-file.adapter.ts`（未绑 module=死代码，读旧 blob）+ `scripts/recon-statement-demo.ts`（旧 demo，被 recon:gen 取代）+ package.json `recon:demo` 脚本。`external-data.provider.ts` 接口保留（MockExternalAdapter live 用）。

## 5. 生成器 FIRM 补齐（`scripts/recon-redesign-statement-gen.ts`）
- **现状**：FIRM 仅 `VAULT_MAIN`(HEXTRUST USDT plug)。FIRM AED=0、firm treasury 账户全缺。
- **改**：枚举 ACTIVE `F_*` 钱包（`F_FEE/F_LIQ/F_OPS/F_SET`，AED+USDT）。每钱包 → 1 张 FIRM 余额：
  - source：FIAT_BANK(AED)→`ZAND`；CRYPTO_ADDRESS(USDT)→`HEXTRUST`。
  - accountRef：合成稳定 id（`{role}-{ccy}-0001`，如 `F_OPS-AED-0001`）。
  - closing **锚到内部**（与 CMA/vault plug 同法）：`firmTB(ccy)=balancesAtCutoff(ccy)['A.FIRM_TREASURY']`（若 key 不存在则用引擎 式5 同源口径，impl 时确认 COA key）；该币种**非 plug 账户** closing = 各自 `mockBalance`；**plug 账户**（取 `F_OPS`）closing = `firmTB − firmInTransit − Σ(非 plug closing)`，使 `Σ firm closing == firmTB − firmInTransit`。每账户 1 合成行（IN/OUT 由 closing 符号定，描述 `Treasury position snapshot`），balanceAfter 倒推、roll-forward 自检成立。
  - book=FIRM；roll-forward 自检照样成立（opening=closing−Σnet）。
- VIBAN：`C_VIBAN` 仍不单独出，滚 `C_CMA`（现状）。
- **CLIENT 不动**（已符合"每账户一统计单、VIBAN 除外"）。
- **callout（spec review 决策点）**：firm 这样锚 → 式5 ties to ~0（firm 干净对平）。若要 demo 保留 firm break，需显式注入一笔 firm orphan/mismatch（默认**不注入**，等 user 定）。

## 6. 验收
- 后端 tsc + jest（engine/query 不回归）；`npm run recon:gen` 重跑：FIRM 账户数 ≥ 4（AED+USDT 都有），Σ firm closing 对 firmTB。
- admin tsc + build；零裸色。
- 渲染：List 页 Client/Firm 两区都有真实行 + 小计；点 CMA 行 → Detail roll-forward ✓ + 23 行 + VIBAN 列 + raw 展开；点一个 FIRM 账户 → 详情正常。
- #3：sidebar 无 External Statements、有 External Balances；旧路由 404/移除；`reconciliation_external_statements` 表已 drop。
- 截图比对 mockup `external_balances_parent_child_pages`。

## 7. 范围外
- 余额↔case 反向链接（deferred）。
- 行独立详情页（不做，raw 抽屉替代）。
- 跨账户流水全局搜索页（C 方案，未选）。
- run 记分牌 / case 详情页（本轮不动）。
