# 记账与 COA — 当前实现真相（跨版本共享域）

Last Verified: 2026-08-13（核对方式：COA v2 科目表重构（退役 202 `FIRM_FEE`/203 `FIRM_LIQ`/204 `FIRM_SEIZED`，新增 210 `INCOME_SWAP_FEE`/211 `INCOME_WITHDRAW_FEE`/212 `INCOME_OTHER`）落地后文档同步——§1 九码表机身换新 + 补齐"退役户"处理方式（TB 物理不可删/registry 置 RETIRED/`verify:coa` 恒零断言/读侧例外保留识别）；§4 公司侧不变量由笼统的"FIRM_* 各自守恒"改写为具体新公式 `Σ FIRM_ASSET == Σ(FIRM_OPS+FIRM_SET+INCOME_SWAP_FEE+INCOME_WITHDRAW_FEE+INCOME_OTHER)` + 补迁移脚本条目；§5/§6 同步。逐符号核对 `tb-account-codes.constant.ts`（新增三户常量 + `RETIRED_TB_CODES`）/`tb-transfer-codes.constant.ts`（36 `SWAP_FEE_FIRM`/16 `WITHDRAW_FEE_FIRM`/4 `DEPOSIT_CONFISCATE_FIRM_FEE` 三点贷方实际已切新户，常量名不变；新增 71 `COA_V2_INCOME_RECLASS` 迁移专用码）/`scripts/verify-realtime-coa.ts`（`firmEquity` 桶换新 + 退役户恒零断言）/`scripts/demo-lib.ts`（同款新公式）/`wallet-recon-run.service.ts → computeInternalIdentity()`（同款新公式）/`wallet-balance-checker.service.ts → FIRM_CODES`+`wallet-flow-matcher.service.ts → OWNED_CODES`（新三户入集 + 202/203 数字字面量保留识别历史 `account_flows` 行）/`scripts/migrate-coa-v2.ts`（新迁移脚本，`npm run migrate:coa-v2`）/`asset-provisioning.service.ts`（新资产建户清单换新三户）——均属实。分支硬闸：tsc 0 错/jest 净新 0 失败/`verify:coa` ALL PASS/`recon:demo` PASS/`demo:all` 8/8（四条 COA 守恒断言全绿，已实际产生兑换费/提现费并检验新科目守恒）；真迁移路径已在 main 数据隔离副本验证通过——迁移前 `verify:coa` fail-closed FAIL（两 ledger 差额精确等于 202 余额）→ 迁移（ledger1 4000→210/800→211，ledger2 3000000→210/4000000→211，202 双双清零，`retired 6 rows`，分拆金额与历史流水合计精确吻合）→ 迁移后 `ALL INVARIANTS PASS` → 幂等重跑全 skip；**main 栈本体尚未执行迁移**（202 上仍留存量，需另行排期跑 `migrate:coa-v2`，见 BACKLOG.md）。前序核对方式：2026-08-07 业主要求逐条拿代码核对充值相关 truth 四份，查出两处遗留漂移并修：①§1 已在上一轮订正为"9 码"，但 §0 一句话定位与 §6 锚点汇总两处仍留着"8 码 COA"字样，未同步改过来——已订正为 9 码；②§3"两阶段（提现/swap/充值没收 用）"的适用范围表述漏列了充值退回（A3）/上缴（A4）两条弧——`onReturnApproved()`/`pendReturnSuspense()`（`deposit-workflow.service.ts` L1981/L2017）与 `onSeizeApproved()`/`pendSeizeSuspense()`（L2320/L2378）均调用同一套 `executePendingTransfer()`/`postPendingTransfer()`/`voidPendingTransfer()`，与没收共享两阶段机制，已补齐。更早核对方式：2026-08-03 业主要求逐份核充值相关 truth，查出一处漂移并修：§1 标题与清单写"8 码 COA"，实为 9 码——FIRM_SEIZED(204) 由 2026-07-28 计划2·A4 上缴落地新增，文档漏收；再更早：符号级 grep + V3-V8 体检交叉佐证；2026-07-12 账本细化落地补 §2 `balanceAfter` + 新 §3.5 账本 admin 呈现层）

> 本文只描述"现在是什么样"。改代码必须同步本文。**跨版本共享域**：被 V3(账户开设)/V4(充值)/V5(提现)/V6(兑换)/V8(对账) 全部引用——记账口径的唯一真相，各版本文档链到此、不各写一遍。

---

## 0. 一句话定位

**TigerBeetle 是余额唯一真相；Prisma 只留人类可读凭证与投影。** 实时 1:1 镜像账本：客户资产与负债内部恒等，每笔交易就地记账（无延迟结算/EOD 轧差）。本文管：9 码 COA、TB 记账机制（转账/两阶段/凭证）、AccountFlow 投影、记账不变量。**不**管：各交易流怎么调用记账（去 v4/v5/v6）。

## 1. 9 码 COA（`tb-account-codes.constant.ts`）

| 码 | 账户 | 归属 | 借贷方向 |
|---|---|---|---|
| 1 | `CLIENT_ASSET` | 客户池资产 | 资产 |
| 50 | `FIRM_ASSET` | 公司资产 | 资产 |
| 100 | `CLIENT_PAYABLE` | 客户应付（负债，flags=不可透支）| 负债 |
| 101 | `DEPOSIT_SUSPENSE` | 合规暂扣 | 负债 |
| 200 | `FIRM_OPS` | 公司运营 | 公司 |
| 201 | `FIRM_SET` | 结算中转（仅法币）| 公司 |
| 210 | `INCOME_SWAP_FEE` | 兑换手续费收入（2026-08-13 COA v2 新增，接类型码 36 `SWAP_FEE_FIRM`）| 公司 |
| 211 | `INCOME_WITHDRAW_FEE` | 提现手续费收入（2026-08-13 COA v2 新增，接类型码 16 `WITHDRAW_FEE_FIRM`）| 公司 |
| 212 | `INCOME_OTHER` | 其他收入（2026-08-13 COA v2 新增，接类型码 4 `DEPOSIT_CONFISCATE_FIRM_FEE`/below-min 没收，与服务费收入隔离）| 公司 |

- 系统级（CLIENT_ASSET/FIRM_ASSET/FIRM_OPS/INCOME_SWAP_FEE/INCOME_WITHDRAW_FEE/INCOME_OTHER + 法币 FIRM_SET）在资产创建**同事务** provision；客户级（CLIENT_PAYABLE/DEPOSIT_SUSPENSE）**首笔交易懒解析**。
- 账户映射：`TbAccountRegistry` 按 `(code, ledger, ownerType, ownerUuid)` 四元组唯一。
- **退役户（2026-08-13 COA v2）**：202 `FIRM_FEE`（由 210/211/212 接班）/203 `FIRM_LIQ`/204 `FIRM_SEIZED` 三户已废弃。**2026-08-13 同日删净兼容层**（判据：demo 数据随时 reset，不留过渡层）——`RETIRED_TB_CODES` / `RETIRED_TB_CODE_TO_COA` 两个常量、转移码 `COA_V2_INCOME_RECLASS`(71)、对账读侧 `wallet-balance-checker.service.ts → FIRM_CODES` 与 `wallet-flow-matcher.service.ts → OWNED_CODES` 里的裸数字 202/203、`scripts/recon-demo.ts` 的第四份硬编码公司科目集合、`verify:coa` 的退役户恒零断言、整个 `scripts/migrate-coa-v2.ts` + `package.json` 的 `migrate:coa-v2`，**全部物理删除**。TigerBeetle 账户物理仍在（TB 不可删），但代码里不再有任何一处认识它们。**唯一保留**：`tb-account-codes.constant.ts.spec.ts` 的死名单断言（`FIRM_FEE`/`FIRM_LIQ`/`FIRM_SEIZED` 不得回到 `TB_ACCOUNT_CODES` 主表）——防回归闸，与历史数据无关。
- 锚点：`tb-account-codes.constant.ts`（`TB_ACCOUNT_CODES`，9 码）｜ `tb-account-registry.service.ts → TbAccountRegistry` ｜ `tb-manual-account.service.ts`（手动建账 `POST /admin/tb/accounts`）｜ 四处注册清单同步：`asset-provisioning.service.ts` / `asset-activation-workflow.service.ts → checkReadiness()` / `tb-manual-account.service.ts → SYSTEM_CODES` / `wallet-recon-run.service.ts`（对账恒等式）

## 2. 数据模型要点

- **TB Transfer**：余额真相，flags 区分资产/负债/pending。`tb_transfer_evidence`（Prisma 凭证）：每笔 TB transfer 一行，含 `effectiveDate`（生效日/结算日）、`walletRef`/`externalRef`/`isExternalCrossing`（对账三字段）。
- **AccountFlow 投影**（`account_flows`）：2 行/transfer（借贷各一），供对账 by-wallet 视图 + effectiveDate 过滤；由 `writeEvidence` 唯一漏斗触发投影。**每行含 `balanceAfter`**（该账户过账后当时 posted **净额**快照，分，class-aware：资产＝posted 借－贷、负债/权益＝posted 贷－借，**不含在途 pending**）——写 evidence 时由 `tb-evidence.service.ts → postedBalanceAfter(tbAccountId, coaCode)` 读该账户 TB posted 净额落每行（借腿/贷腿各存各账户；pending→POST 重投影都刷）；历史行可空，一次性回填脚本 `scripts/backfill-account-flow-balance.ts`。
- **transfer codes**（`tb-transfer-codes.constant.ts`）：如 `CAPITAL_INJECTION=70`（DR FIRM_ASSET / CR FIRM_OPS）等业务分类。
- 锚点：prisma `tb_transfer_evidence`/`account_flows` ｜ `tb-transfer-codes.constant.ts`

## 3. 关键流程（记账机制，`accounting.service.ts` + `tb-evidence.service.ts`）

- **建账**：`createAccounts()`（批量 provision TB 账户 + registry）
- **实时转账**：`executeTransfer()`（单笔即时借贷，写 evidence）
- **两阶段（提现/swap/充值没收·退回·上缴 用）**：`executePendingTransfer()`（锁定，create pending）→ `postPendingTransfer()`（结算）/ `voidPendingTransfer()` / `voidPendingTransferBestEffort()`（失败解锁，best-effort 补偿）。充值侧没收（`startConfiscation`/`settleConfiscation`）、退回（`onReturnApproved`/`settleReturn`）、上缴（`onSeizeApproved`/`settleSeize`）三条处置弧均走同一套两阶段机制（`deposit-workflow.service.ts`，2026-08-07 复核补齐后两条，此前本条只列了没收）。**post/void 幂等**：`postPendingTransfer`/`voidPendingTransfer` 对 TB 的 `pending_transfer_already_posted`/`pending_transfer_already_voided` 放行为干净 no-op（不重写凭证、不盖假 postId/voidId），故重放安全——充值没收结算的 3 重试可自愈"leg1 已 post、leg2 瞬断"的半截 split（见 [v4-deposit.md](v4-deposit.md) §6）
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

- **核心不变量**（实时 1:1）：客户侧 `Σ CLIENT_ASSET == Σ (CLIENT_PAYABLE + DEPOSIT_SUSPENSE)`（客户资产=客户负债，按币种）；公司侧 `Σ FIRM_ASSET == Σ (FIRM_OPS + FIRM_SET + INCOME_SWAP_FEE + INCOME_WITHDRAW_FEE + INCOME_OTHER)`（2026-08-13 COA v2：收入段由旧 `FIRM_FEE`+`FIRM_LIQ` 换成三个新收入户，公式两侧同增减仍平）；均按 ledger（币种）各自守恒。
- **验证**：`scripts/verify-realtime-coa.ts`（四式不变量，`ALL INVARIANTS PASS`/`FAIL: N invariant breaks`；**2026-08-13 新增负余额断言**——遍历全部 ACTIVE registry 科目，按 class-aware 口径算余额，**任何科目 < 0 即 FAIL**，打印 `科目名/ledger/归属/余额`。加它的理由：四条恒等式只比"总数对不对"，对「凭空造余额」「超额提现」这两类错账**完全失明**——两边同增同减正负相消，恒等式照常全绿。首次实跑即逮到实例：money-arcs 两个 e2e spec 建 fixture 不跑 STEP_1，把 `CLIENT_ASSET` 与某客户 `DEPOSIT_SUSPENSE` 扣成负数，而两条恒等式仍然通过，详见 BACKLOG「演示/测试环境卫生」节；退役户恒零断言已随兼容层一并删除），V8 对账的内部恒等预门复用此逻辑（`wallet-recon-run.service.ts → computeInternalIdentity()`）。
- ~~**迁移**：`scripts/migrate-coa-v2.ts`~~ —— **2026-08-13 已物理删除**（含 `package.json` 的 `migrate:coa-v2`）。demo 数据随时 reset，不保留历史迁移脚本；需要干净基线时走 `stack.sh down` → `rm -rf /tmp/exchange_js_wt_<名>` → `stack.sh up` → `db:biz:init`。
- 锚点：`scripts/verify-realtime-coa.ts` ｜ `npm run verify:coa`

## 5. ⚠️ 已知缺口（详见 BACKLOG.md）

- TB 账户创建失败无 backlog 重试（仅转账凭证有 `TbEvidenceBacklog`）
- 资本注入 evidence 待核（CAPITAL_INJECTION seed transfer 在，FIRM_ASSET 流水是否有对应 evidence/account_flow 行待确认）
- 旧 COA（TRADE_CLEARING/FEE_RECEIVABLE）已删（实时 1:1 重构前口径，勿复用）
- **main 栈尚未执行 COA v2 迁移**：`migrate:coa-v2` 已在 main 数据的隔离副本上验证通过（详见文件头 Last Verified），但 main 栈本体还没跑——跑之前 main 栈的 `verify:coa` 会在退役户恒零断言处 fail-closed（202 上仍有存量）。这不是代码缺陷，是待执行的一次性运维步骤，见 BACKLOG.md「COA v2 科目表重设计」条。

## 6. 锚点汇总

`accounting/tigerbeetle/`：`accounting.service.ts`（记账主）｜ `tb-evidence.service.ts`（凭证漏斗）｜ `tb-account-registry.service.ts` ｜ `tb-manual-account.service.ts` ｜ `tb-admin.controller.ts` ｜ `constants/tb-account-codes.constant.ts`（9 码 + `RETIRED_TB_CODES`）+ `tb-transfer-codes.constant.ts`（含迁移专用 `COA_V2_INCOME_RECLASS`=71）｜ `tigerbeetle.service.ts`（TB client）
`accounting/tigerbeetle/projector/account-flow-projector.service.ts`（AccountFlow 投影）｜ `scripts/verify-realtime-coa.ts`（四式验证 + 退役户恒零断言）｜ `scripts/migrate-coa-v2.ts`（`npm run migrate:coa-v2`，202 存量精确重分类 + 退役封户）｜ `admin-web/src/pages/ledger-account.constants.ts`（admin 展示名模板：币种不写死、渲染拼后缀；筛选下拉只列 9 个活跃码；退役码仍可读侧识别标 `(retired)`）
