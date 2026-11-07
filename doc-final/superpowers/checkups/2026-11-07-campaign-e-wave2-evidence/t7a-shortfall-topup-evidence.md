# T7a · 认损补缺一张单（后端）— 证据

> 戊波二 T7 前半（R20）：迁移 / DTO / workflow / 守卫搬迁 / 读面 / 退役 / 审计 / 单测；e2e 改写归 T7b。基线 `adbea729`。
> 所有命令在 worktree 根跑，前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`；jest 前 `set -a; . ./.env; set +a`。

## 1. 这一单做了什么（一句话一项）

| 项 | 落点 |
|---|---|
| 迁移（无 backfill） | `prisma/migrations/20261107010000_campaign_e_shortfall_topup/migration.sql`（`prisma migrate diff` 从 `HEAD:prisma/schema.prisma` 生成）：`InternalTransfer` +`explainedFlowId? / explainedExternalLineId? / recognizedTbTransferId? / recognizedAt? / effectiveDate / lossSource? / sourceIncidentNo?`，删 `sourceAdjustmentNo` 与其索引；`ReconciliationDisposition` +`transferNo?` |
| 用途改名 | `['SHORTFALL_TOPUP','CLIENT_ADVANCE']`（改名，非新增）；`failureReasonCode` 新值 `RECOGNITION_FAILED` |
| 开单 | `InternalTransferWorkflowService.initiateShortfallTopup`；`POST /admin/internal-transfers/shortfall-topup {caseNo, flowId?, externalLineId?, fromWalletId, reason}` |
| 守卫搬迁（R21） | 账龄路 / 事故路两段原样守卫从 `adjustment.service.ts` 搬到 `disposition/write-off-guards.ts`（`assertAgingWriteOffAllowed` / `assertIncidentWriteOffAllowed` / `writeOffPathOf`），调账单（公司池）与认损补缺（客户池）共用一份；公司池错误文案逐字保持（`adjustment.service.spec` 的正则是锁） |
| 提交即挂 | `DispositionService.linkTransfer / unlinkTransfer`（同 `linkAdjustment / unlinkAdjustment`）；`record()` / `linkAdjustment` 的挂单锁都认 `transferNo`；驳回 / 撤回 / 超时 / `RECOGNITION_FAILED` / 批准时 `INSUFFICIENT_FIRM_BALANCE` 解锁；已记短缺的单（腿失败）**不**解锁 |
| 批准那一步 | 复查出钱钱包余额 + 客户钱包余量 → 码 91（借 2·客户钱包 / 贷 1·同一只，`effectiveDate` = 案件业务日，eventCode `INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED`）→ 回执落 `recognizedTbTransferId / recognizedAt`（先于建腿）→ 审计 → EXECUTING + 腿 1。91 被拒 / 复查不过 → `FAILED(RECOGNITION_FAILED)`（既有 PENDING_APPROVAL → FAILED 边）+ 解锁。无新边、无新 DispositionKind |
| 最后一腿 | 82 不变；83 按用途：`SHORTFALL_TOPUP` 借 1 / 贷 **2**·同一只客户钱包（`INTERNAL_TRANSFER_SHORTFALL_TOPUP_IN`）；`CLIENT_ADVANCE` 原样（贷 100） |
| 客户钱包余量（裁定 14） | `AccountingService.getWalletCashAvailable(walletId, ledger)`＝可用额算式**唯一一份**；`assertWalletBalance` 改调它；认损补缺单开单与批准各查一次（话术指路「先处理在途出款」，只用 customerNo / walletNo） |
| 阻塞集（裁定 15） | `InternalTransferService.findBlockingShortfallTopup`：同行任一锚命中 ∧（`PENDING_APPROVAL/EXECUTING/SUCCESS` ∨ `FAILED ∧ recognizedTbTransferId 非空`） |
| 审计 | V7 名册 +1 `INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED`（INHERIT、`['amount','effectiveDate']`、要因果）→ 现役码 385→**386**，名册 19 |
| 读面 | `nextStep.kind 'SHORTFALL_TOPUP'`（账龄路 + 事故路，带 `amount / effectiveDate / lossSource / customerNo / walletNo`）；`disposition.transferNo`；`transfer` 回链多带 `recognized: boolean`（R22）；补款推导 / 列表「待补款」徽标 / `funding-next-step` 的 `COMPENSATION` 分支删 |
| 退役 | `UNEXPLAINED_CLIENT_LOSS` 出 `REASON_SPECS`（DTO 白名单与 `assertReasonAllowed` 同拒），留作 `cause-registry.ts` 的 `CLIENT_SHORTFALL_CAUSE`；`InitiateCompensationDto / initiateCompensation / /compensation / sourceAdjustmentNo / INTERNAL_TRANSFER_COMPENSATION_IN` 全删 |
| RBAC / 管理台权限 | `rbac.catalog.ts` 路由改名（组不变）+ 两条桶文案；`admin-web/src/rbac/permissions.ts` `INTERNAL_TRANSFER_COMPENSATION_WRITE → INTERNAL_TRANSFER_SHORTFALL_TOPUP_WRITE`（值 `api.post.admin_internal_transfers_shortfall_topup`），唯一用处 `ReconciliationCasesDetailPage.tsx:159` 同改 |
| 模块接线 | `ReconciliationModule` 导出 `ReconciliationQueryService`（认损补缺按锚取案件页同一行的差额，金额 / 方向与 `nextStep` 同源） |

## 2. 闸门（命令 · 退出码 · 关键行）

| 闸 | 命令 | 结果 |
|---|---|---|
| ① | `npx tsc --noEmit -p tsconfig.json` | exit 0，输出 0 行 |
| ② | `cd admin-web && npx tsc -b --noEmit` | exit 0，输出 0 行 |
| ③ | `cd client-web && npx tsc -b --noEmit` | exit 0，输出 0 行 |
| ④ 目标目录 | `npx jest src/modules/asset-treasury src/modules/clearing-settle src/modules/governance src/modules/audit-logging src/modules/accounting` | exit 0；`Test Suites: 118 passed, 118 total`；`Tests: 2438 passed, 2438 total` |
| ④ 全量 | `npx jest`（不接管道） | exit 0；`Test Suites: 284 passed`；`Tests: 2 skipped, 5 todo, 4758 passed, 4765 total` |
| 重铺 | `bash scripts/stack.sh reset self` | exit 0（新迁移在空库上建起）；`up` exit 0 |
| 路由同步 | `bash scripts/on-stack.sh self db:base:sync` → `stack.sh down self && up self` | exit 0；`backend.log` `Mapped {/admin/internal-transfers/shortfall-topup, POST} route`；`UnknownDependenciesException` 0 |
| ⑥ | `bash scripts/on-stack.sh self demo:all` | exit 0；`花名册：35/35 符合预期`；`asserts: 5/5 PASS` |
| ⑦ | `bash scripts/on-stack.sh self verify:coa` | exit 0；4 条恒等 ✓；`105 个科目全部 ≥ 0`；`ALL INVARIANTS PASS` |
| RBAC | `bash scripts/on-stack.sh self verify:rbac` | exit 1 = **✓186 ✗1**，与改前同；唯一 ✗ = S7 的 4 条 sumsub demo 死行（`TOOLING-DEBT.md` 既有，零新增）。S13d 桶 89 / 组 96 不变 |
| 对账 | `bash scripts/on-stack.sh self recon:demo:break` | exit 0；`scenarios: 18/18 DETECTED`；`wallets: 12/12`；`casesOpened 12/12`；答案键未碰 |
| 收尾 | 再 `verify:coa` | exit 0；`ALL INVARIANTS PASS` |
| 终态 | `stack.sh reset self` → `up` → `demo:all` | exit 0；35/35、5/5；`verify:coa` 过（栈留在这个态） |

改前基线（同命令，改前 HEAD，**未重铺的 self 库**）：目标目录 `117 suites / 2380 tests`，`3 failed` 全在 `regulatory-filing-sweep.service.spec.ts`（该 spec 直连栈 DB，库里有别的运行留下的报送单，`marked` 多算；与本任务无关）。重铺后同一 spec 绿，故终态 118 suites（+1 = 新 DTO spec）全绿。

## 3. 红 → 绿 的证据（诚实交代）

本任务**没有**严格「先红后实现」：实现先写、单测后补。补救是两条独立证据：

**(a) 新 / 改的 spec 对着改前代码（`adbea729` 的生产码）跑**——临时 detached worktree + 共享 `node_modules`，把本任务的 spec 拷进去：`Test Suites: 12 failed, 1 passed, 13 total`。唯一过的是 `incident.service.spec.ts`——事故侧「挂 TRANSFER 即满足善后」改前就成立（见 §7 第 5 条）。worktree 已 `git worktree remove`。

**(b) 变异测试**（改一处行为 → 跑对应 spec → 必须红 → 还原；脚本在 scratchpad `mutate.py`）：

| # | 变异 | 结果 |
|---|---|---|
| M1 | 83（认损补缺）贷应付而不是码 2 | 红（2 例） |
| M2 | 91 借贷对调 | 红 |
| M3 | 阻塞集丢掉 `FAILED ∧ 已记短缺` | 红 |
| M4 | 解锁函数变空操作 | 红（6 例：驳回 / 超时 / 撤回 / 91 失败 / 余额不足 / 复查不过） |
| M5 | 批准时不复查客户钱包余量 | 红（2 例） |
| M6 | 账龄路不拒「多出来」(INCREASE) | 红 |
| M7 | 91 生效日用今天而不是案件业务日 | 红 |
| M8 | 事故路金额不锁定定损额 | 红（2 例） |
| M9 | 记短缺审计码不再要因果 | 红 |
| M10 | 读面 `nextStep` 不认 `transferNo` 锁 | 红 |
| M11 | `record()` 不认 `transferNo` 覆盖锁 | 红 |
| M12 | 可用额算式漏掉挂起贷方 | 红（3 例） |
| M13 | 路径判据丢掉「挂了事故号」一支 | 红 |
| M14 | 提交时不挂处置记录 | 红（2 例） |

14/14 被抓（M11 第一版写法触发 TS 诊断而非行为红，已换成不影响类型的写法重做，才算数）。

## 4. 真栈冒烟（一次性，未入库）

单测的账户 / 余额都是 mock。为了证明 91 / 83 在真 TigerBeetle 上不被拒，用 `test/recon-internal-transfer.e2e-spec.ts` 的夹具改了一份临时 e2e（`test/tmp-t7a-smoke.e2e-spec.ts`，跑完已删，不入库；T7b 写正式的），`bash scripts/on-stack.sh self test:e2e --runInBand --cacheDirectory=<空目录> test/tmp-t7a-smoke.e2e-spec.ts` → exit 0，A + B `Tests: 2 passed`；加 `-t "SMOKE C"` 再跑 → exit 0，C `1 passed`（共 3 例）：

- **A（USDT 一腿 · 账龄路全弧）**：`nextStep` = `{kind:'SHORTFALL_TOPUP', amount:'7500000', effectiveDate:<案件业务日>, lossSource:'AGING', customerNo, walletNo}` → 开单后处置记录 `transferNo` 已挂、`nextStep` 收起、`transfer` 回链 `{status:'PENDING_APPROVAL', recognized:false}`、同行再开 → 400 `already linked to shortfall top-up` → 撤回后 `transferNo` 回 `null` → 再开 → 快照 impact **逐字**等于 `Recognize custody shortfall of 7.500000 USDT on wallet <walletNo> for customer <CU…> and top it up from <from walletNo>; customer balance unchanged`，快照不含钱包 id → CFO 批 → `EXECUTING`；凭证 `A.CLIENT_SHORTFALL / A.CLIENT_CASH`、`effectiveDate` = 案件业务日、金额 7500000、凭证转账号 = `recognizedTbTransferId`；**客户应付 `available` 一分未动**；码 2 户余额 +7.5；客户现金户 −7.5；审计 `INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED` 恰 1 条（`effectiveDate`、`amount`、`causationId`、域 TREASURY）→ ⚡ 提交 / 确认腿 → `SUCCESS`；凭证三条 `SHORTFALL_RECOGNIZED / FIRM_OUT / SHORTFALL_TOPUP_IN`，83 = `A.CLIENT_CASH / A.CLIENT_SHORTFALL` 且贷方户 = 该钱包的码 2 户；**短缺户回 0、现金户复位、运营户 −7.5、应付不动**；该客户应付户的对账单里 `sourceType = INTERNAL_TRANSFER` 零行。
- **B（余量）**：对客户现金户挂一笔 pending 贷方（形状同待批提现锁定 `WITHDRAW_NET_PENDING`）→ 开单 400：`Customer CU-… 's wallet WA… has only 5.000000 USDT of cash free of in-flight payouts, but the custody shortfall to recognize is 7.500000 USDT — first handle this wallet's in-flight payouts (reject or withdraw the pending withdrawal), then recognize the shortfall`；没建单、没挂锁。
- **C（AED 两腿 · from = 手续费户 F_FEE）**：91 → 腿 1 手续费户 → 结算户（81）→ 腿 2 结算户 → 客户 vIBAN（82 + 83）→ 凭证四条 `SHORTFALL_RECOGNIZED / OPS_TO_SET / FIRM_OUT / SHORTFALL_TOPUP_IN`（各 9000）；手续费户 −9000、结算户净 0、运营户不动、应付全程 300,000、码 2 户回 0。

冒烟里看到的事实（给 T9）：记短缺后、T9 的第 0 轮上线前，那行差异（`AMOUNT_MISMATCH`）仍在案件页上，`transfer` 回链走 `d.transferNo`，状态随单走（`EXECUTING/recognized` → `SUCCESS/recognized`）；案子愈合是 T9 的事。

## 5. 退役清点（纪律 5：改前写预期、改后再数）

命令（改前 / 改后同一条）：
`grep -rn "CLIENT_COMPENSATION\|sourceAdjustmentNo\|INTERNAL_TRANSFER_COMPENSATION_IN\|initiateCompensation\|'COMPENSATION'" src scripts prisma test admin-web/src client-web/src --exclude-dir=migrations | wc -l`
**94 → 38**（搜索边界：上述 6 个目录、字面量搜法；动态拼接 / 反射不在边界内。第二种形态另搜 `grep -rniE "compensat" src scripts prisma/*.ts`：生产码里只剩 `accounting.service.ts` / `withdraw-workflow.service.ts` 的「失败补偿 void」注释，与本概念无关）。

| 剩余命中（38） | 条数 | 谁收 |
|---|---|---|
| `test/recon-internal-transfer.e2e-spec.ts` | 15 | **T7b**（改写 A / C1 / C2 / C3 / P2；本任务只做编译修，见 §7 第 6 条） |
| `test/incident-register.e2e-spec.ts` | 3 | **T7b** |
| `admin-web`：`InternalTransferDetail.tsx` 4、`InternalTransferList.tsx` 3、`ReconciliationCasesListPage.tsx` 2、`ReconciliationCasesDetailPage.tsx` 2、`CaseFlowTable.tsx` 2、`reconTypes.ts` 1、`internalTransferStatusMap.ts` 1 | 15 | **T8**（另：`InternalTransferInitiateModal.tsx` 仍 POST `/admin/internal-transfers/compensation`，路由已改名，T8 重做弹层） |
| 本任务自己钉死「已退役」的负向断言（`not.toHaveProperty('sourceAdjustmentNo')` ×3、`'INTERNAL_TRANSFER_COMPENSATION_IN'` 不在白名单、`COMPENSATION` 不再是 `nextStep.kind`） | 5 | 留着——它们是退役的锁 |

`UNEXPLAINED_CLIENT_LOSS`（命令 `grep -rn "UNEXPLAINED_CLIENT_LOSS" src scripts prisma test admin-web/src client-web/src doc-final/demo doc-final/modules --exclude-dir=migrations | wc -l`）**66 → 29**，分类：

| 类 | 条数 | 说明 |
|---|---|---|
| 常量家 | 2 | `cause-registry.ts:25`（`CLIENT_SHORTFALL_CAUSE`）；`adjustment-rules.ts:21`（指路注释） |
| cause-registry / 读面 / 审批 | 0 | `resolveWriteOff` 现产出 `kind:'SHORTFALL_TOPUP'` + 该常量（引用常量名，不再有字面量）；读面不再带 `reasonCode` |
| 本任务测试（退役的锁 / 常量断言 / 固定成因进审计） | 14 | `adjustment.service.spec` 5、`adjustment-rules.spec` 3、`cause-registry.spec` 2、`customer-statement.service.spec` 2、`internal-transfer-workflow.service.spec` 2 |
| e2e | 5 | **T7b**：`recon-internal-transfer` 3、`incident-register` 1、`recon-aging-write-off`（反例③）1 |
| admin-web | 6 | **T8**：`reconTypes.ts` 1、`CaseFlowTable.tsx` 2、`ReconciliationAdjustmentCreateModal.tsx` 3 |
| 文档 | 2 | `doc-final/modules/v8-recon.md` ×2 → **T11**（文档任务） |

## 6. 计数终态

| 项 | 命令 / 来源 | 结果 |
|---|---|---|
| 审计现役码 | `counts-before.md` C4 同一条命令 | **386**（19 册；`V7_TREASURY_AUDIT_ACTIONS` 7→8）；`rosters in spec REGISTRIES: 19`，两个方向差集空 |
| 转账码最大值 | — | 91（本任务不动） |
| 演示库科目数 | `verify:coa` | 105（不变） |
| `verify:rbac` | 见 §2 | ✓186 ✗1（同改前） |
| 业务号前缀 | — | 本任务不新增 |

## 7. 偏离 / 裁量（评审请核）

1. **`InternalTransfer.effectiveDate` 存 `DateTime` = `startOfBusinessDate(<业务日>)`，读回用 `toBusinessDate()`**（迪拜日起点，只经 `business-date.util`，不手拼）。与调账单的 `String YYYY-MM-DD` 不同，但 spec / 控制器明写 `DateTime`。**`CLIENT_ADVANCE` 行**：取被退汇账单行的业务日（`assertClaimable` 已返回的 `businessDate`），不取「现在」。
2. **`lossSource` 建成可空 `String?`**（spec 写 `String`）：垫款单没有认损来路，非空列只能塞假值。认损补缺行恒为 `'AGING' | 'INCIDENT'`（服务端判，DTO 不收）。
3. **金额 / 方向由服务端定**：DTO 没有 amount。事故路 = 事故 `assessedAmount`；账龄路 = `ReconciliationQueryService.getCase()` 里那一行的 `adjustmentPrefill`（`resolveWriteOff` 公式，与案件页 `nextStep` 同源）。代价：开单多一次案件页级读取（演示可接受）；换来「UI 看到的 = 服务端锁的」。
4. **`recognizedTbTransferId` 存十六进制**（= `tb_transfer_evidence.tbTransferId` 的写法，T9 可直接联凭证）；调账单的 `tbTransferId` 是十进制，两者口径不同——T9 读之前别混。
5. **`incident.service.ts` 零代码改动**：`linkRemediation` 的 `TRANSFER` 分支本来就只校验划转单存在，`ASSESSED → RESOLVING` 随首次挂载自动推进，没有任何「先挂 ADJUSTMENT」的前置。加了一条单测钉死（ASSESSED 事故直接挂 TRANSFER → RESOLVING，且 `reconciliationAdjustment.findUnique` 零调用）。事故页的 `adjustmentStatusByNo`（`getView`，供「发起补款」按钮判已落账认损单）随 T8 删按钮后成孤儿——T8 一并清。
6. **e2e 只做编译修**：`transferWf.initiateCompensation(` → `(transferWf as any).initiateCompensation(`（两个文件共 8 处，各加一行说明注释），让闸 ① 过编译；这些用例在 T7b 前运行期必红，**不是**本任务的回归。
7. 决定性守卫顺序：开单时「锚中定性行 → 路径 → 守卫 → 阻塞 → picker → 余额闸 → 客户钱包余量 → 建单 → 挂 → 提审」。批准时「出钱钱包余额 → （仅认损补缺）客户钱包余量 → 91 → 回执 → 审计 → 腿」。余量不足在批准时走 `RECOGNITION_FAILED`（没有分录落下，可重新开单）；91 落账后腿失败走 `LEG_FAILED`，**不解锁**。
8. 顺手改的 3 处文案：`rbac.catalog.ts` 两条动作桶 label / description 里的 "compensation" → "shortfall top-up"（同一概念的退役，仅文案）；`customer-statement.service.ts` 一条注释里提到的已退役 label。
9. 未做（超出本任务 / 属后续）：`describeImpact` 老路「客户池认损」两套文案随码一并删（审批句改在 workflow 里，spec §4.1 原句）；PRODUCTION-NOTES 三行（裁定 14 / 15 与 T5 的 89+90 非原子）归 T11。

## 8. 给下游的接口备忘

- **T7b**：`initiateShortfallTopup({caseNo, flowId?, externalLineId?, fromWalletId, reason}, actor)` → `{transferNo, approvalNo, status}`；失败文案见 `internal-transfer-workflow.service.spec.ts`。冒烟里证过的断言点（§4）可直接搬。注意：e2e 里造「待批提现锁定」不必走提现工作流，对客户现金户挂一笔 `executePendingTransfer`（借应付 / 贷现金，码 10）即可复现裁定 14。
- **T8**：行标签靠 `row.transfer = {transferNo, purpose, status, recognized}` 与 `row.disposition.transferNo`（锁判定 = `adjustmentNo || transferNo`）。`nextStep.kind === 'SHORTFALL_TOPUP'` 携带 `{amount, effectiveDate, lossSource, customerNo, walletNo}`（无 UUID）；弹层提交 `{caseNo, flowId?, externalLineId?, fromWalletId, reason}`——锚取该行 `internalFlow.id / externalLine.id`。`InternalTransferView` 新增 `effectiveDate / lossSource / sourceIncidentNo / recognizedAt`，删 `sourceAdjustmentNo`。
- **T9**：读 `InternalTransfer.recognizedTbTransferId`（十六进制）与 `explainedFlowId / explainedExternalLineId`；91 的凭证 `sourceType='INTERNAL_TRANSFER'`、`eventCode='INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED'`、`effectiveDate`=案件业务日；`recon-demo` 模拟对账单取数要排除这个 eventCode。
