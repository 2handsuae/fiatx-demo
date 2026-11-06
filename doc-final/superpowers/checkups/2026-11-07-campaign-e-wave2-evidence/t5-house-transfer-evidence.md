# T5 证据 · 公司调拨单（HouseTransfer，前缀 `HTR`）后端

> 戊波二 T5。代码基线 `a2c6d8db`（T4 提交）。所有命令在 worktree 根跑，前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`；要退出码的命令一律重定向到文件再取 `$?`（不接管道）。栈 = self（3110–3113）。

## 1. 迁移与建库

| 命令 | 退出码 | 关键行 |
|---|---|---|
| `npx prisma migrate diff --from-schema-datamodel <HEAD 的 schema.prisma> --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261107000000_campaign_e_house_transfers/migration.sql` | 0 | 108 行：`CREATE TABLE "house_transfers"` + `RedefineTables new_funds_orders`（加 `houseTransferId`、唯一索引 `(houseTransferId, legSeq, attempt)`、索引 `houseTransferId`、FK `ON DELETE CASCADE`） |
| `npx prisma generate` | 0 | — |
| `bash scripts/stack.sh reset self` | 0 | `sqlite3 …/dev.db ".schema house_transfers"` 有表；`_prisma_migrations` 末行 `20261107000000_campaign_e_house_transfers｜1`；`pragma table_info(funds_orders)` 含 `9｜houseTransferId｜TEXT` |

只新增迁移文件，没改任何已应用迁移，无 backfill。`schema.prisma` 的 diff 是 +35 行纯增量（**没有**跑 `prisma format`——它会把整份 schema 重排对齐，已避免）。`scripts/reset-business-data.ts` 加 `'houseTransfer'`（FK → asset RESTRICT，须排在 asset 之前；`vendorPayment` 同款先例）。

## 2. TDD：红 → 绿

**RED**（实现之前，只有 spec）：
```
npx jest src/modules/asset-treasury/company-funding/house-transfer src/modules/audit-logging/constants/house-transfer-audit-codes.spec.ts
→ exit 1   Test Suites: 2 failed, 2 passed, 4 total   Tests: 11 passed
   FAIL house-transfer.service.spec.ts           TS2307 Cannot find module './house-transfer.service'
   FAIL house-transfer-workflow.service.spec.ts  TS2307 Cannot find module './house-transfer-workflow.service'
```
（`house-transfer-audit-codes.spec` 当时已绿——审计常量先于 spec 落地；`house-transfer-fee-close.spec` 绿——纯函数先写，红证由下面的变异补。）

**GREEN**：`npx jest src/modules/asset-treasury/company-funding/house-transfer` → exit 0，`Tests: 63 passed`（三套件：fee-close 7 例、service 25 例、workflow 31 例）。

**失效验证（变异测试，改完即还原，`diff -q` 对备份一致）**

单测层（`npx jest …/house-transfer`）：

| 变异 | 结果 |
|---|---|
| M1 消耗顺序 211 先于 210 | exit 1，8 例红（fee-close 顺序 / ①～④、workflow 三户顺序） |
| M2 去掉「每户封顶在自己余额」（`take = remaining`） | exit 1，9 例红（①②④⑤、workflow 整扫 / 扫一半） |
| M3 NLA 门不分 vault 一律调 | exit 1，1 例红（from = 手续费户不过门） |
| M4 每条路都结转 | exit 1，1 例红（运营户 → 手续费户只有 89） |
| M5 落账失败也迁 FAILED | exit 1，2 例红（单必须停 EXECUTING） |
| M6 89 借贷方向反 | exit 1，1 例红 |

e2e 层（真 TB，`bash scripts/on-stack.sh self test:e2e --runInBand --cacheDirectory=<空目录> test/house-transfer.e2e-spec.ts`；**只在干净栈上采**，见 §7 坑 2）：

| 变异 | 结果 |
|---|---|
| E1 结转不看每户余额（无封顶） | exit 1，4 红：①②③⑥（TB 真拒 90） |
| E2 消耗顺序 212 → 210 → 211 | exit 1，2 红：①②（回执顺序 / 只扣到够） |
| E3 NLA 门永不调 | exit 1，1 红：④（spy 0 次） |
| E4 扫费路径只记 89、不记 90 | exit 1，3 红：①②③ |

## 3. 闸门（最终代码，退出码均取自重定向文件）

| 闸 | 命令 | 结果 |
|---|---|---|
| ① 后端 | `npx tsc --noEmit -p tsconfig.json` | exit 0，0 行 |
| ② 管理台 | `cd admin-web && npx tsc -b --noEmit` | exit 0，0 行 |
| ③ 客户端 | `cd client-web && npx tsc -b --noEmit` | exit 0，0 行 |
| ④ jest（相关目录） | `npx jest src/modules/asset-treasury src/modules/funds-orders src/modules/audit-logging src/modules/governance/approvals src/modules/identity src/modules/clearing-settle/reconciliation/disposition admin-web/src/pages/approvalEntityRoutes.spec.ts scripts`（先 `. ./.env`） | exit 0，136 套件 / `2127 passed, 1 skipped, 5 todo`（skipped / todo 为既有） |
| ④' jest 全量 | `npx jest`（root） | exit 0，282 套件 / `4693 passed, 2 skipped, 5 todo` |
| ⑦ 动了钱 | `bash scripts/on-stack.sh self verify:coa` | e2e 刚跑完（栈上有扫费 + 卡住的单）exit 0：4 条恒等 + `负余额检查 通过 (105 个科目全部 ≥ 0)`；最终干净栈 exit 0，同样 105 |
| ⑧ 动了 schema | `reset self` → `up` → `on-stack.sh self demo:all` | 最终干净栈：reset 0 / up 0 / demo:all 0，`花名册：35/35 符合预期`、`asserts: 5/5 PASS` |

⚠️ `demo:all` 在本任务中途的重铺里**偶发 exit 1 两次**（8 次里 2 次）：`FATAL Error: #35 WDR…: travelRuleSnapshotJson 应已落库，实为空`（`scripts/demo-lib.ts:1454` `expectTravelRuleSnapshot`，提现 Travel Rule 快照写入晚于脚本读取的竞态）。与调拨单无关（失败路径是提现 / KYT；本任务只多了一个对 `houseTransferId` 空就立即返回的资金单事件监听），重跑即绿，**未修**；日志留在 scratch（未入库）。是否登记 TOOLING-DEBT 交主会话定。

## 4. 计数：前 → 后（同一批命令，`counts-before.md` 的 C1–C5 原样重跑，每条 exit 0）

| 项 | 命令 | 前（T0） | 后（T5） | 预期 | 一致 |
|---|---|---|---|---|---|
| 审批策略 `DEFAULT_APPROVAL_POLICIES` | C1 | 55 | **56** | 56 | 是 |
| `MAKER_GROUP_BY_POLICY` / 豁免 | C2 | 54 / 1 | **55 / 1**（并集 56，双向差集空） | 55 + 1 | 是 |
| S9 表 `DETAIL_READ_GROUP_BY_POLICY` | C3 | 45 | **46** | 46 | 是 |
| 路由表 `ENTITY_ROUTE_BY_ACTION` | C3 | 45 | **46**（与 S9 键集双向差集空） | 46 | 是 |
| 审计现役码 / 名册 | C4 | 378 / 18 | **385 / 19**（`CAMPAIGN_E_HOUSE_TRANSFER_AUDIT_ACTIONS=7`；去重后仍 385） | 385 / 19（T7 再 +1 = 386） | 是 |
| 导出 `*_AUDIT_ACTIONS`（不含 DEPRECATED）与 spec `REGISTRIES` | C4 | 18 = 18 | **19 = 19**，双向差集空 | — | 是 |
| TB 科目码 / 转账码 | C5 | 11 / 87 | 13 / 91（T1 / T2 的结果，T5 未动） | — | 是 |
| `generateReferenceNo('HTR'` 命中 | `grep -rn "generateReferenceNo('HTR'" src scripts test prisma` | 0 | **1**（`house-transfer.service.ts:58`） | 恰 1 | 是 |
| 动作桶 `ACTION_BUCKET_CATALOG` | S13d 实跑数 | 87 | **89**（`treasury.view_house_transfers` / `treasury.act_house_transfers`） | +2 | 是 |
| 权限组（三源并集） | S13d | 96 | 96（复用 `FUNDING_READ` / `FUNDING_WRITE`） | 不变 | 是 |
| 后端 catalog `route()` 行 | S6 | 271 | **275**（+4） | +4 | 是 |
| 资金单父键（`houseTransferId` vs `vendorPaymentId` 在 `funds-order.service.ts` / dto 的出现次数） | `grep -rn` | — | 9 vs 9、1 vs 1 | 同款全覆盖 | 是 |

## 5. `verify:rbac`（`bash scripts/on-stack.sh self verify:rbac`，改前 / 改后各一次，均 exit 1 = 仅既有 S7 红）

| 判据 | 改前 | 改后 |
|---|---|---|
| S4 | 55 条策略点名真实职务 | **56** |
| S5 | 54 条 maker-checker 逐条验过 | **55** |
| S8 | 55 条：54 + 1 豁免 | **56 条：55 + 1 豁免** |
| S9 | 45 条带回链的策略 | **46** |
| S13d | 桶 87 / 组 96 | **桶 89 / 组 96**（门槛 87 → 89；已验证门槛留在 87 时实跑 `✗ S13d`，改 89 转绿） |
| S14a | FUNDING_READ: route 4 / bucket 1；FUNDING_WRITE: route 6 / bucket 1 | route 6 / **bucket 2**；route 8 / **bucket 2** |
| S6 | 前端 158 码 ⊆ 后端 271 条 | 158 ⊆ **275** |
| S7 | ✗ 4 条 sumsub demo 死行（`TOOLING-DEBT.md:141`，既有） | ✗ 同 4 条，**零新增** |
| 总计 | ✓186 ✗1 | ✓186 ✗1 |

重启与同步：`bash scripts/on-stack.sh self db:base:sync` exit 0 → `stack.sh down self` / `up self` 各 exit 0；`backend.log` 有 `HouseTransferController {/admin/house-transfers}` 四条 `Mapped … route`，`UnknownDependenciesException` 0。

## 6. e2e：`test/house-transfer.e2e-spec.ts`（8 例，真 AppModule、真 TigerBeetle、零 mock）

最终干净栈（`reset self → up → demo:all` 之后）：`bash scripts/on-stack.sh self test:e2e --runInBand --cacheDirectory=<空目录> test/house-transfer.e2e-spec.ts` → exit 0，`Tests: 8 passed, 8 total`。

| 例 | 断言（全部取自 TB 余额前后差 / 凭证行 / 审计行 / 外部账单行 / 单据状态） |
|---|---|
| fixture | 运营户 ≠ 手续费户；开局公司本天平 + 无负余额 |
| ① 整扫 | 先铺 兑换费 300 / 提现费 200 / 没收 777（贷 212）；整扫 = 手续费户全部现金；批准前、建腿后账本零变化；落账后 手续费户 −amount（= 0）、运营户 +amount、210/211/212 全 0、公司权益 +Σ收入；凭证恰 4 笔（89 + `FEE_INCOME_CLOSE_SWAP/_WITHDRAW/_OTHER`），借贷码与账户 id 逐笔对；`closeTbTransferIds` = 三笔 90 的转账号、码序；审计恰 REQUESTED / EXECUTION_STARTED / LEG_POSTED / SETTLED；两侧模拟托管方外部行（from OUT / to IN，同一 externalRef = 89 凭证的 externalRef，金额 = amount）；公司本天平 + 无负余额（`verify:coa` 同口径）；NLA 门零调用；投影无 id |
| ② 扫一半 | amount = 210 余额 + 211 余额的一半 → 210 归零、211 只扣一半、212 不动、权益 +amount、凭证恰 89 + 两笔 90、回执 2 个 |
| ③ 封顶 | 先真实走一笔 运营户 → 手续费户（10.00 AED），再整扫：amount > Σ收入；权益只 +Σ收入（不是 amount）；三笔 90 合计 = Σ；单无 POSTING_FAILED、`failureReasonCode` 空 |
| ④ 运营户 → 手续费户 | 只有 89（凭证恰 1 笔）、权益 / 收入户不动、`closeTbTransferIds` 空；NLA 门 spy 恰 1 次（`orderKind HOUSE_TRANSFER`、对手方 = 手续费户钱包号、最小单位金额、资产号）、批准 / 落账阶段不再调；放行不写 `PRUDENTIAL_GATE_BLOCKED` |
| ⑤ 拒绝 / 撤回 | CFO 拒 → `REJECTED`，无腿、无凭证，审计带 `approvalNo` + `causationId`；金库撤回另一张 → `CANCELLED`，审批单 `CANCELLED`；已终态再撤 400；两张都没动账 |
| guards | from = to / 结算户当 from 或 to / 余额大于手续费户现金 → 全 400，`house_transfers` 行数不变，账本不动 |
| ⑥（超出 brief 的第 6 例） | 同一余额批两张整扫：第二张的 89 被真 TigerBeetle 拒（手续费户已被第一张扫空，「贷不得超借」）→ 审计 `HOUSE_TRANSFER_FAILED` + `POSTING_FAILED`（`toStatus` 空），单停 `EXECUTING`、行上 `failureReasonCode=POSTING_FAILED`，账本一分不动、无凭证（90 根本没尝试）、腿停 `CONFIRMED` 不清算；执行中撤回 400 |

夹具真实形状（R14 前提核对）：没收落账代码 `deposit-workflow.service.ts:1589` `confiscationSpec` 的第二腿（`:1622–1623`）= 借 `cashWalletId: firmFeeWallet.id`（手续费户现金）/ 贷 `INCOME_OTHER`（212，SYSTEM），转账码 4 —— **前提成立**，没触发 NEEDS_CONTEXT。e2e 夹具直接按这一腿的码 / 户 / eventCode（`CONFISCATE_INCOME_OTHER`）过账（兑换费 36 `SWAP_FEE_FIRM`、提现费 16 `WITHDRAW_FEE_FIRM` 同理，取自 `swap-leg-plan.constant.ts`、`withdraw-workflow.service.ts:1338–1342`）；码 3（客户本那一腿）不铺——本 e2e 不碰客户本，公司本这一笔自己借贷平；账户标志位没动（TB 的「借不得超贷 / 贷不得超借」照常生效）。

## 7. 本任务踩到的两个坑（下游须知）

1. **e2e 里 SUBMIT / CONFIRM 背靠背会让外部行参考号回落到资金单号**（真人点两下之间隔好几秒，不会发生）：提交的事件处理（铸号 + 模拟托管方写外部行）是异步的，确认那步的 `buildExternalRefPatch` 会和它的读写交错，`stampExternalRef` 返回 null、外部行 `externalRef` 落到 `fundsOrderNo`。本 e2e 的 `pushLeg` 在 SUBMIT 之后先等两行外部行写完再 CONFIRM。T4 的 `vendor-payment-from-wallet.e2e-spec.ts` 也是背靠背但没断言外部行参考号，不受影响；以后有 e2e 断言「外部行参考号 = 凭证参考号」要照此等。
2. **变异测试会污染共享库**：E1 / E4 这类把账记半截的变异之后，收入户余额与手续费户现金不再相等，后面的 e2e 前置条件（`amount ≥ Σ收入`）会因此红——红的原因就不是变异本身。所以 §2 的 e2e 变异结果都是在 `reset self → up → demo:all` 之后的干净栈上采的（第一轮在脏栈上采的 E3 / E2 里夹了一个真竞态，才发现坑 1，已重采）。

## 8. 审计七码的写点（`rules/delivery-checklist.md`：每个持久状态变化都写审计）

`grep -rn "AuditActions.HOUSE_TRANSFER_<码>\b" src --include='*.ts' | grep -v "spec.ts\|audit-actions.constant"`：

| 码 | 写点（`house-transfer-workflow.service.ts`） | 命中数 |
|---|---|---|
| REQUESTED | `initiate()` | 2（1 个写点 + `transferAudit` 里决定是否传 correlationId 的比较） |
| CANCELLED | `cancel()` | 1 |
| REJECTED | `onDecided()` 拒绝 / 超时分支 | 1 |
| EXECUTION_STARTED | `onDecided()` 批准分支 | 1 |
| LEG_POSTED | `onLegConfirmed()` | 1 |
| SETTLED | `onLegConfirmed()` | 1 |
| FAILED | `markFailed()`（批准时余额不足 / 腿失败 / 落账失败三路共用这一个写点） | 1 |

## 9. 本任务落的东西（清单；文档类归 T11 / T12）

- Schema + 迁移 + `reset-business-data.ts` 登记（§1）；`FundsOrder.houseTransferId`（`funds-order.service.ts` 的 `parentOf / directionOf(INTERNAL) / create / findByParent / parentFkWhere / findAllForAdmin / findOneByNoForAdmin`，`funds-order.dto.ts`，`funds-orders-admin-query.dto.ts` 加 `house-transfer`）。
- 主体：`dto/house-transfer.dto.ts`、`constants/house-transfer-transitions.constant.ts`、`house-transfer.service.ts`、`house-transfer-fee-close.ts`（码 90 规划，纯函数）、`house-transfer-workflow.service.ts`、`house-transfer-approval.service.ts`、`house-transfer.controller.ts`、`company-funding.module.ts` 接线。
- 审批四处同加 + 白名单（`approval.constants.ts` 三处、`verify-rbac.ts` MAKER 表、`verify-rbac.tables.ts` S9、`approvalEntityRoutes.ts`、`ApprovalPoliciesPage.tsx`）；`domain-events.constants.ts` 登记 `HOUSE_TRANSFER_DECIDED`。
- 审计：`audit-actions.constant.ts`（`AuditEntityTypes` / `AuditBusinessWorkflowTypes` 各 `HOUSE_TRANSFER`、平面枚举 7 码、名册 `CAMPAIGN_E_HOUSE_TRANSFER_AUDIT_ACTIONS`）；名册登记点 = `audit-logs.service.ts`（查表链）+ `scripts/export-audit-vocab.ts` + `audit-vocabulary-closure.spec.ts`（`REGISTRIES` 18 → 19，措辞十八 → 十九）；`audit-logs.service.spec.ts` 冻结的 workflow 类型表加 `HOUSE_TRANSFER`。
- RBAC：`rbac.catalog.ts` 四条 `route()` + 两个动作桶；`verify-rbac.ts` S13d 桶数门槛 87 → 89。
- NLA：`prudential.service.ts` 的 `assertPostOutflowCompliant` 过期注释改成真实三处调用点；调用只在 `from.vaultCode === 'F_OPS'`。
- 推单：`push-order.service.ts loadPushable` 对 `houseTransferId` 显式拒（+ spec）。
- 测试：`house-transfer.service.spec.ts`、`house-transfer-workflow.service.spec.ts`、`house-transfer-fee-close.spec.ts`、`house-transfer-audit-codes.spec.ts`、`funds-order.house-transfer-parent.spec.ts`、`test/house-transfer.e2e-spec.ts`。

## 10. 留给 T6 / T7 / T11 的接口备忘

- 端点：`POST /admin/house-transfers {purpose:'FEE_SWEEP', assetId, amount, fromWalletId, toWalletId, reason}` → `{transferNo, approvalNo, status}`；`POST /admin/house-transfers/:transferNo/cancel {reason}`；`GET /admin/house-transfers[?status&purpose&skip&take]` → `{items,total}`；`GET /admin/house-transfers/:transferNo` → 投影字段 `transferNo purpose assetCode currency decimals amount fromWalletNo fromVaultCode toWalletNo toVaultCode reason status approvalNo fundsOrderNo closeTbTransferIds[] failureReasonCode failureNote createdBy createdAt executedAt settledAt legs[]`。分录金额行（89 / 90）前端要从凭证接口按 `closeTbTransferIds` 取（投影不带分录金额）。
- 前端权限码（T6 `permissions.ts`，由 `buildPermissionCode` 生成）：`api.post.admin_house_transfers`、`api.post.admin_house_transfers_transferno_cancel`、`api.get.admin_house_transfers`、`api.get.admin_house_transfers_transferno`（S6 要求前端引用 ⊆ 后端 catalog，这四条后端已在册）。
- 资金单页：`GET /admin/funds-orders?parent=house-transfer` 后端已支持，列表 / 详情 `houseTransferNo` 已带出；`FundsOrderList.tsx` 筛选项、`FundsOrderDetail.tsx` 父单回链与 `isTransferLeg` 判断是 T6 的活。调拨腿**不进** push-order（显式拒）。
- T7 在同一份 `audit-actions.constant.ts` / `rbac.catalog.ts` 上继续改：审计现役码此刻 385，T7 +1 → 386。
