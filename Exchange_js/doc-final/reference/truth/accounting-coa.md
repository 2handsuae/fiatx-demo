# 记账与 COA — 当前实现真相（跨版本共享域）

Last Verified: 2026-07-12（核对方式：符号级 grep + V3-V8 体检交叉佐证；2026-07-12 账本细化落地补 §2 `balanceAfter` + 新 §3.5 账本 admin 呈现层）

> 本文只描述"现在是什么样"。改代码必须同步本文。**跨版本共享域**：被 V3(账户开设)/V4(充值)/V5(提现)/V6(兑换)/V8(对账) 全部引用——记账口径的唯一真相，各版本文档链到此、不各写一遍。

---

## 0. 一句话定位

**TigerBeetle 是余额唯一真相；Prisma 只留人类可读凭证与投影。** 实时 1:1 镜像账本：客户资产与负债内部恒等，每笔交易就地记账（无延迟结算/EOD 轧差）。本文管：8 码 COA、TB 记账机制（转账/两阶段/凭证）、AccountFlow 投影、记账不变量。**不**管：各交易流怎么调用记账（去 v4/v5/v6）。

## 1. 8 码 COA（`tb-account-codes.constant.ts`）

| 码 | 账户 | 归属 | 借贷方向 |
|---|---|---|---|
| 1 | `CLIENT_ASSET` | 客户池资产 | 资产 |
| 50 | `FIRM_ASSET` | 公司资产 | 资产 |
| 100 | `CLIENT_PAYABLE` | 客户应付（负债，flags=不可透支）| 负债 |
| 101 | `DEPOSIT_SUSPENSE` | 合规暂扣 | 负债 |
| 200 | `FIRM_OPS` | 公司运营 | 公司 |
| 201 | `FIRM_SET` | 结算中转（仅法币）| 公司 |
| 202 | `FIRM_FEE` | 手续费收入 | 公司 |
| 203 | `FIRM_LIQ` | 流动性 | 公司 |

- 系统级（CLIENT_ASSET/FIRM_ASSET/FIRM_OPS/FIRM_FEE/FIRM_LIQ + 法币 FIRM_SET）在资产创建**同事务** provision；客户级（CLIENT_PAYABLE/DEPOSIT_SUSPENSE）**首笔交易懒解析**。
- 账户映射：`TbAccountRegistry` 按 `(code, ledger, ownerType, ownerUuid)` 四元组唯一。
- 锚点：`tb-account-codes.constant.ts` ｜ `tb-account-registry.service.ts → TbAccountRegistry` ｜ `tb-manual-account.service.ts`（手动建账 `POST /admin/tb/accounts`）

## 2. 数据模型要点

- **TB Transfer**：余额真相，flags 区分资产/负债/pending。`tb_transfer_evidence`（Prisma 凭证）：每笔 TB transfer 一行，含 `effectiveDate`（生效日/结算日）、`walletRef`/`externalRef`/`isExternalCrossing`（对账三字段）。
- **AccountFlow 投影**（`account_flows`）：2 行/transfer（借贷各一），供对账 by-wallet 视图 + effectiveDate 过滤；由 `writeEvidence` 唯一漏斗触发投影。**每行含 `balanceAfter`**（该账户过账后当时 posted 余额快照，分，class-aware 符号：资产借正、负债/权益贷正）——写 evidence 时由 `tb-evidence.service.ts → postedBalanceAfter(tbAccountId, coaCode)` 读该账户 TB posted 余额落每行（借腿/贷腿各存各账户；pending→POST 重投影都刷）；历史行可空，一次性回填脚本 `scripts/backfill-account-flow-balance.ts`。
- **transfer codes**（`tb-transfer-codes.constant.ts`）：如 `CAPITAL_INJECTION=70`（DR FIRM_ASSET / CR FIRM_OPS）等业务分类。
- 锚点：prisma `tb_transfer_evidence`/`account_flows` ｜ `tb-transfer-codes.constant.ts`

## 3. 关键流程（记账机制，`accounting.service.ts` + `tb-evidence.service.ts`）

- **建账**：`createAccounts()`（批量 provision TB 账户 + registry）
- **实时转账**：`executeTransfer()`（单笔即时借贷，写 evidence）
- **两阶段（提现/swap/充值没收 用）**：`executePendingTransfer()`（锁定，create pending）→ `postPendingTransfer()`（结算）/ `voidPendingTransfer()` / `voidPendingTransferBestEffort()`（失败解锁，best-effort 补偿）。**post/void 幂等**：`postPendingTransfer`/`voidPendingTransfer` 对 TB 的 `pending_transfer_already_posted`/`pending_transfer_already_voided` 放行为干净 no-op（不重写凭证、不盖假 postId/voidId），故重放安全——充值没收结算的 3 重试可自愈"leg1 已 post、leg2 瞬断"的半截 split（见 [v4-deposit.md](v4-deposit.md) §6）
- **凭证漏斗**：`tb-evidence.service.ts → writeEvidence()` 是**唯一写入漏斗**——打 `effectiveDate`（不传=`toBusinessDate(now)` 写当天）+ 触发 `flowProjector.persist()` 投影 AccountFlow。**平账回填经此透传**（advance→writeEvidence→account_flows）。
- **余额读**：`lookupBalance()` / `getCustomerAvailableBalance()`（客户可用余额，扣 pending）
- **记账铁律**：workflow 同步调 accounting，记账失败则业务状态不许推进（绝不事件异步记账，保 ACID）。
- 锚点：`accounting.service.ts → executeTransfer()/executePendingTransfer()/postPendingTransfer()/voidPendingTransferBestEffort()/getCustomerAvailableBalance()` ｜ `tb-evidence.service.ts → writeEvidence()` ｜ `account-flow-projector.service.ts → persist()`

## 3.5 账本 admin 呈现层（读侧，2026-07-12 账本细化）

三张表严格对应三个菜单，各挂独立权限门；只读为主 + 唯一写=手动建账：

| 菜单 | 表 | 端点 | 权限 |
|---|---|---|---|
| 账户 | `TbAccountRegistry` | `GET /admin/tb/accounts`（+`:tbAccountId`） | `LEDGER_ACCOUNT_READ` |
| （手动建账）| — | `POST /admin/tb/accounts` | `LEDGER_ACCOUNT_WRITE` |
| 凭证 | `TbTransferEvidence` | `GET /admin/tb/transfers`（+`:tbTransferId`） | `LEDGER_EVIDENCE_READ` |
| 流水 | `AccountFlow` | `GET /admin/tb/account-flows` | `LEDGER_FLOW_READ` |
| （钱包）| — | `GET /admin/tb/wallets` | `LEDGER_FLOW_READ` |

- 旧共享 `ACCOUNTING_CONFIG_READ/WRITE` 已拆为上表四个 `LEDGER_*`（`rbac.catalog.ts`）；`/admin/tb/wallets` 由原先裸奔补挂 `LEDGER_FLOW_READ` 门。
- **「对账单 Account Statement」菜单/页/端点已移除**——其按钱包聚合能力被「流水列表 + 单账户筛选 + `balanceAfter`」吸收。
- **账户列表挂实时 posted 余额**：整页 `tbAccountId` 一次 `tigerbeetle.service → lookupAccounts(ids)` 批量查（**禁逐行**），class-aware 算余额挂 `balance`；TB 不可用/账户缺失 → `balance=null` 不阻断列表主体（`tb-account-registry.service.ts → findAll()/attachBalances()` + 导出纯函数 `postedBalanceForCode()`；TB 失败落 `logger.warn`）。
- **流水列表挂账户身份 + `customerNo` 过滤**：`tb-evidence.service.ts → findAllFlows()` 批量 join `TbAccountRegistry` 出 `accountCode/ownerType/ownerNo/ownerUuid`（供「账户名/客户号」列，仅 CUSTOMER 暴露 owner）；`customerNo` 过滤先解析该客户 tbAccount 集合再约束 `where.tbAccountId`（与单账户筛选取交集，空集返 0）；`balanceAfter` 恒展示（去「仅单账户」门）；`?walletRef=` 深链兼容（前端 seed 进搜索框 `q`）。
- 前端列（`admin-web/src/pages/`）：账户页 +`ID`(完整 `tbAccountId`)+`Balance`；流水页 −Wallet ＋`Account Name`(`code·币种`)/`Customer No`/`ReferenceNo`(=`externalRef`)/`Balance After` 恒显；凭证页 +`ReferenceNo`（Debit/Credit 仍显 `A.CLIENT_ASSET` COA 串不变）。
- 锚点：`tb-admin.controller.ts`（`findAccounts/findAccountFlows`）｜ `tb-account-registry.service.ts`｜ `tb-evidence.service.ts → findAllFlows()`｜ `rbac.catalog.ts`（LEDGER_* + routes）｜ 设计 `superpowers/specs/2026-07-07-ledger-detail-design.md` + `2026-07-10-ledger-lists-refinement-design.md`

## 4. 不变量与验证

- **核心不变量**（实时 1:1）：`Σ CLIENT_ASSET == Σ (CLIENT_PAYABLE + DEPOSIT_SUSPENSE)`（客户资产=客户负债，按币种）；公司侧 FIRM_* 各自守恒。
- **验证**：`scripts/verify-realtime-coa.ts`（四式不变量，`ALL INVARIANTS PASS`/`FAIL: N invariant breaks`），V8 对账的内部恒等预门复用此逻辑（`wallet-recon-run.service.ts → computeInternalIdentity()`）。
- 锚点：`scripts/verify-realtime-coa.ts` ｜ `npm run verify:coa`

## 5. ⚠️ 已知缺口（详见 BACKLOG.md）

- TB 账户创建失败无 backlog 重试（仅转账凭证有 `TbEvidenceBacklog`）
- 资本注入 evidence 待核（CAPITAL_INJECTION seed transfer 在，FIRM_ASSET 流水是否有对应 evidence/account_flow 行待确认）
- 旧 COA（TRADE_CLEARING/FEE_RECEIVABLE）已删（实时 1:1 重构前口径，勿复用）

## 6. 锚点汇总

`accounting/tigerbeetle/`：`accounting.service.ts`（记账主）｜ `tb-evidence.service.ts`（凭证漏斗）｜ `tb-account-registry.service.ts` ｜ `tb-manual-account.service.ts` ｜ `tb-admin.controller.ts` ｜ `constants/tb-account-codes.constant.ts`（8 码）+ `tb-transfer-codes.constant.ts` ｜ `tigerbeetle.service.ts`（TB client）
`accounting/tigerbeetle/projector/account-flow-projector.service.ts`（AccountFlow 投影）｜ `scripts/verify-realtime-coa.ts`（四式验证）
