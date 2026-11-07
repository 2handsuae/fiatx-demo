# T7b · 认损补缺 e2e 改写 — 证据

> 戊波二 T7 后半：把 T7a（`f3a18e56`）退役的「认损调账单 + 补款划转单」两张单的 e2e 改成「认损补缺一张单」，新增两条挂起锁定用例。
> 所有命令在 worktree 根跑，前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`；jest 一律经 `bash scripts/on-stack.sh self test:e2e --runInBand --verbose …`，输出进日志文件、`$?` 直接取（无管道）。基线对照 `e2e-baseline-0c6eb7b0.md` §2.1。

## 0. 时钟窗口

跑 e2e 时真实时钟 `date -u` = **01:11–01:15 UTC**（迪拜 05:11–05:15）——在 UTC 20:00–24:00 的错位窗口**之外**，按基线 §3 的说法对账 e2e 不受 UTC/迪拜日错位影响，**正常跑，未用拨钟配置**。

## 1. 改了什么（只动 3 个 e2e 文件 + 本证据）

| 文件 | 改动 |
|---|---|
| `test/recon-internal-transfer.e2e-spec.ts` | 重写 A / C1 / C2 / C3 / P2；新增「挂起锁定」「lock after submit」两条；共享 helper：`driveClientLossToCompensationPending` → `driveClientShortfallToOverdue`（只推到「超期、读面给 SHORTFALL_TOPUP 钮」，不再有认损调账单一步）、`expectTransferPostings` 加可选 `topup`（多一笔 91、83 贷码 2 而不是应付；垫款 B 的调用不变）、新增 `openTopup / dispRow / shortfallHex / shortfallPosted / payableAvailable / payableStatement / fundFirmWallet / createInFlightWithdrawal`；删孤儿 `rowByAdjustment / adjRow / ConflictException` |
| `test/incident-register.e2e-spec.ts` | 用例 5 改事故路认损补缺全弧（定损 → 开单金额锁定 → 批 → 91 → 腿 → 83 贷码 2 → 挂 `TRANSFER` 善后）；`mainCompensationTransferNo → mainTopupTransferNo`（含用例 9 里的一处引用）；删孤儿 `AdjustmentService / adjustments / adjRow / mainAdjustmentNo` |
| `test/recon-aging-write-off.e2e-spec.ts` | 反例③ 改成真客户池破口：公司池核销码 400（话术指路 `Recognize loss & top up`）+ 认损补缺放行（金额 0.07 = 差异行的差额）+ 撤回解锁；删孤儿 `createFixtureRun / createFixtureCase / TODAY` |

用例清单（brief Step 4 + spec §8.3）：

| 用例 | 断言要点 |
|---|---|
| **A** 账龄路全弧（USDT 一腿，from = F_OPS） | 开单 → 处置记录 `transferNo` 已挂、读面收起按钮、回链 `PENDING_APPROVAL/recognized:false`、同行再开（换锚）400 `already linked to shortfall top-up`、零分录 → 撤回解锁再发 → 审批 impact 逐字等于 spec §4.1 → CFO 批 → **91** `A.CLIENT_SHORTFALL / A.CLIENT_CASH`、借贷户 id 对、金额、`effectiveDate = kase.businessDate`、`recognizedTbTransferId` = 凭证号；**应付一分不动**、短缺户 +7.5、现金户 −7.5（= 外部真值）；审计 `INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED` 一条（`approvalNo`、金额、`effectiveDate`、`metadata.causeCode/lossSource/tbTransferId`）→ ⚡ 腿 → **82 + 83**（83 贷码 2·同一只钱包）→ 短缺户 0、现金户回铺底、应付全程铺底原额、**客户应付户流水前后条数相等且无 `INTERNAL_TRANSFER` 来源** → 五个审计动作各一条 → 预门 `run.status ≠ INTERNAL_BREAK` |
| **C1** 客户池多出来 | 读面 `CLIENT_SURPLUS`；开认损补缺 → 400 `deposit backfill` 指路补录、不建单、不挂锁；旧调账单入口（`CLIENT_SHORTFALL_CAUSE` 当 reasonCode）→ `Unknown reason code` |
| **C2**（裁定 15）腿失败 | 单 `FAILED(LEG_FAILED)`、`recognizedTbTransferId` 有值；凭证只有 91（无 82/83）；短缺户**不归零**（+7.5）、现金户仍 −7.5、应付不动；处置记录仍挂着、读面无钮、回链 `FAILED/recognized:true`；同一行再开 → 400 `already linked …`（含只给内部流水锚的写法），库里同锚仍只有 1 张单 |
| **C3**（brief 未点名，原文也用了 `initiateCompensation`，一并改）CFO 拒绝 | `REJECTED`、无资金单、无任何凭证（连 91 也没记）、审计 `REJECTED` 带审批号、解锁、钮回来、可再开 |
| **P2** 法币两腿（from = **F_FEE**） | impact / 快照 `fromWalletNo` 是手续费户；91 在批准时落；腿 1 `F_FEE → F_SET`、腿 2 `F_SET → 客户 vIBAN`；81 / 82 / 83 + 91 四笔账户 id 与余额落点（手续费户 −缺口、结算户净 0、**运营户不动**、客户现金 +缺口）；短缺 0、应付全程铺底原额 |
| **挂起锁定**（裁定 14，新增） | 真实 `createWithdrawal`（经真报价）对客户钱包挂 2950.00 AED 待决贷方 → `getWalletCashAvailable` = 50.00 < 缺口 90.00 → 开单 400 `CLIENT_WALLET_PAYOUTS_IN_FLIGHT`，话术含「first handle this wallet's in-flight payouts」、含 customerNo、**不含钱包 UUID**；没建单、没挂锁、没动账，读面钮仍在 |
| **lock after submit**（Review Focus 2，新增） | 开单放行（钱包上当时没锁）→ 之后真实提现挂锁 → CFO 批 → `FAILED(RECOGNITION_FAILED)`；`recognizedTbTransferId` 空、**无 91 凭证、无腿**、短缺户 0、现金户铺底原额、客户应付不被认损补缺再动；审计 `FAILED/RECOGNITION_FAILED` 一条、无 `SHORTFALL_RECOGNIZED`；处置记录 `transferNo` 清空、读面钮回来、回链空 |
| **incident-register 5**（事故路） | 事故定损 25 USDT → 开单锚事故定性行（客户端哪怕塞 `amount:'1'` 也无效）金额 = 25.000000、`lossSource INCIDENT`、`sourceIncidentNo`；审计 `REQUESTED` 带来路、`SHORTFALL_RECOGNIZED` 带回执；批 → 91（生效日 = 案件业务日，`toBusinessDate(itr.effectiveDate)` 对）→ 腿 → 82 + 83（贷码 2）→ 短缺 0；`linkRemediation(TRANSFER)` 一张就把事故推到 RESOLVING（不再有「先挂调账单」）→ 用例 6 照常走完结案 |
| **aging 反例③** | 真客户池破口超期 + 调查中：`UNEXPLAINED_WRITE_OFF` → 400 `Recognize loss & top up`；认损补缺放行（`amount 0.07`、`lossSource AGING`、处置记录挂 `transferNo`、读面收起钮）→ 撤回 → 解锁、钮回来 |

**留给 T9 的两处**（带 `// T9:` 标记，不是漏）：A 与 incident 5 里「按案件业务日重对账 → 案愈：原差异行 MATCHED、resolution = 本单号」。同时，原 A 在 ⚡ 提交后跑一轮对账、断言客户钱包开出 `IN_TRANSIT` 案的那段**已删**——新弧里案子从头到尾是 OPEN（匹配器第 0 轮未上），那个断言在 T9 的对账断言里重做；本文件只断言到账与余额。

## 2. 结果（干净协议：`reset self` → `up` → `demo:setup` → jest）

| 步骤 | 命令 | 退出码 |
|---|---|---|
| 重铺 / 起栈 / 基础 | `bash scripts/stack.sh reset self` / `bash scripts/stack.sh up` / `bash scripts/on-stack.sh self demo:setup` | 0 / 0 / 0 |
| 目标三件 | `bash scripts/on-stack.sh self test:e2e --runInBand --verbose test/recon-internal-transfer.e2e-spec.ts test/incident-register.e2e-spec.ts test/recon-aging-write-off.e2e-spec.ts` | 1（jest `Time: 15.136 s`） |
| 回归三件（同一栈接着跑） | `… test/recon-adjustment-money-arcs.e2e-spec.ts test/recon-supplement.e2e-spec.ts test/recon-reattribution.e2e-spec.ts` | 1（`Time: 16.269 s`） |

**目标三件：`Test Suites: 3 failed, 3 total` / `Tests: 3 failed, 18 passed, 21 total`**

| 文件 | 通过 / 总 | 失败名（逐字） | 在基线 §2.1？ |
|---|---|---|---|
| `recon-internal-transfer` | 7 / 8 | `B · 退汇余额不足：读面给 ADVANCE → 认领 400 指路 → 垫款两腿（81 / 82+83）→ 可用够扣 → 认领退汇 CLAWED_BACK → 愈`（`AGREEMENT_NOT_ACCEPTED`，充值入口） | 是（`… › B · 退汇余额不足…`） |
| `incident-register` | 9 / 10 | `9 · CLIENT_SHORTFALL：带垫款单号登记 → 锚定校验（purpose==='CLIENT_ADVANCE'）`（`AGREEMENT_NOT_ACCEPTED`，充值入口） | 是 |
| `recon-aging-write-off` | 2 / 3 | `主链路：查无果 → 拨钟 → 扫描超期（留痕）→ 金库开核销单 → … → 重对账 RESOLVED`（`slaDeadline` 时区 `23:59:59Z` vs `19:59:59Z`，与基线同） | 是 |

失败名 ⊆ 基线，**一名不多**。新 / 改的 8 条（itr A C1 C2 C3 P2 挂起锁定 lock-after-submit；incident 5；aging 反例③）全绿。基线时 itr 6 例（A B C1 C2 C3 P2）、本次 8 例。

**回归三件：`Test Suites: 2 failed, 1 passed, 3 total` / `Tests: 4 failed, 14 passed, 18 total`**，失败名（逐字，全在基线 §2.1）：`recon-adjustment-money-arcs › 9. 平账闭环（真实形状）…`、`recon-supplement › ② 退汇…`、`› ③ 退回…`、`› 拒绝路径…`；`recon-reattribution` 全绿（2/2）。

迭代过程中的两次非终态红（如实）：① 首次整套跑「lock after submit」红在我自己的断言——提现自己会把客户应付可用额锁到 50.00，不能断言「应付 = 铺底」，改成断言「批准前后应付不变」；② 同条的 `row.transfer` 解锁后是 `undefined` 不是 `null`，改 `toBeFalsy()`。两处都是测试写错，不是 T7a 缺陷。

## 3. 失效验证（变异测试：改一处产品行为 → 跑 → 必须红 → `git checkout --` 还原；还原后 `git diff --quiet -- src` 为 0）

| # | 变异（文件：`internal-transfer-workflow.service.ts`，M5 为 `adjustment.service.ts`） | 变红的新 / 改用例 | 关键失败行 |
|---|---|---|---|
| M1 | `postFinalLeg`：认损补缺的 83 贷应付而不是码 2 | itr **A**、**P2**、incident **5**（用例 6 连带） | `expectTransferPostings` `clientIn.creditTbAccountId` Expected `01a1b38e2dc7…acb3` Received `01a1b38e2dac…57b6`（贷到了应付户） |
| M2 | `initiateShortfallTopup`：去掉开单时的客户钱包余量检查 | itr **挂起锁定** | `expect(err).toBeInstanceOf(BadRequestException)`，Received `Object`（开单没被拒、返回了结果） |
| M3 | `onLegFailed`：腿失败时也解行锁（违反裁定 15） | itr **C2** | `(await dispRow(…)).transferNo` Expected `ITR261107619771` Received `null`（锁被解了） |
| M4 | `recognizeShortfall`：91 借贷对调 | itr **A**（`-t "A · "`） | TB 拒绝反向分录 → 单进 `FAILED(RECOGNITION_FAILED)`，`waitUntil EXECUTING` 30000ms 超时 |
| M5 | `assertReasonPairing`：客户池不再拒公司池核销码 | aging **反例③** | `rejects.toThrow(/Recognize loss & top up/)`，Received `Reason UNEXPLAINED_WRITE_OFF can only be used on the FIRM book…`（落到更晚的成因闸，指路话术丢了） |
| M6 | 事故路：金额 = 定损额 − 1 最小单位 | incident **5**（用例 6、9 连带） | `Expected: "25.000000" Received: "24.999999"` |

未做 e2e 级失效验证的一点：**批准时**的客户钱包余量复查。lock-after-submit 断言的是结果（`FAILED(RECOGNITION_FAILED)`、无 91、行解锁），这个结果无论是预查拦下还是 TB 自己因「贷不得超借」拒掉 91 都一样，所以 e2e 分不出这两者；预查本身由 T7a 的单测变异 M5 钉着。**开单时**的余量检查有 e2e 变异（M2）。

## 4. 退役清点（改前写预期、改后再数；同一条命令）

| 命令 | 改前 | 改后 | 预期 |
|---|---|---|---|
| `grep -rn "CLIENT_COMPENSATION\|sourceAdjustmentNo\|INTERNAL_TRANSFER_COMPENSATION_IN\|initiateCompensation\|'COMPENSATION'\|/compensation\|COMPENSATION" test \| wc -l` | **18** | **0** | 0（`test/` 全量替换） |
| `grep -rn "UNEXPLAINED_CLIENT_LOSS" test \| wc -l` | 5 | **0** | 0（改引 `CLIENT_SHORTFALL_CAUSE` 常量） |
| T7a 同款 6 目录命令 `grep -rn "CLIENT_COMPENSATION\|sourceAdjustmentNo\|INTERNAL_TRANSFER_COMPENSATION_IN\|initiateCompensation\|'COMPENSATION'" src scripts prisma test admin-web/src client-web/src --exclude-dir=migrations \| wc -l` | 38 | **20** | 38 − 18 = 20（剩 admin-web 15 → T8；src 单测里 5 条「已退役」负向断言是锁） |

搜索边界：字面量搜法，范围 `test/`（及上表 6 目录）；动态拼接 / 反射不在内。另搜 `grep -rniE "compensat" test`：剩的全是 `COMPENSATING`（对账桶名，另一个概念）与 T5 `house-transfer` 用例标题里的英文词，与本概念无关。

## 5. 闸门

| 闸 | 命令 | 结果 |
|---|---|---|
| ① | `npx tsc --noEmit -p tsconfig.json` | exit 0，0 行（全部改完后复跑） |
| ② | `cd admin-web && npx tsc -b --noEmit` | exit 0，0 行 |
| ③ | `cd client-web && npx tsc -b --noEmit` | exit 0，0 行 |
| 终态 | `reset self` → `up` → `demo:all`；`verify:coa` | exit 0 / 0 / 0；`花名册：35/35 符合预期`、`asserts: 5/5 PASS`；`ALL INVARIANTS PASS`（4 条恒等 ✓，105 个科目全部 ≥ 0）——栈留在这个态 |

本任务只动 `test/` 与证据，不碰 `src/`（变异测试均已还原，`git status --short` 终态只有 3 个 e2e 文件 + 本证据）；闸 ④（单测 jest）因 `src/` 零改动不重跑。

## 6. 事实与取舍（评审请核）

1. **P2 的 from = F_FEE（手续费户），且要先注资**：干净协议 `reset self → up → demo:setup` 后实测（临时探针 e2e，已删）种子 F_FEE AED 已落账余额 = **0**（F_OPS AED 947,500.00、F_OPS USDT 113,600.000000 够用）。所以 P2 在开单前用真实注资形状（借 现金·F_FEE 钱包 / 贷 公司权益，码 70）给 F_FEE 注 500.00 AED，再从它出钱。不注资就没法证明「人选 from 钱包」。
2. **T7a 缺陷：未发现**。8 条新 / 改用例对 T7a 实现零修改一次跑绿（过程中两次红都是测试自己写错，§2）。`src/` 零改动。
3. **偏离 brief 的两处**：（a）C3 一并改写（原文也用 `initiateCompensation`，brief 的"每个引用都要清"要求它）；（b）原 A 的「在途桶 IN_TRANSIT」断言删除（见 §1 末），不是遗漏。
4. aging 反例③ 的标题从「二期改口」改成「戊波二改口」；失败名集合以名字比对时这一条是新名字（它基线时是绿的，现在仍绿）。
5. `createInFlightWithdrawal` 只造到 `COMPLIANCE_PENDING`（KYT 未判，锁一直挂着），两条挂起锁定用例结束后这两张提现单留在栈里（各自独立客户；下一次 `reset self` 一并清掉）。
6. 前提：`ensureDepositWallet`（= `createOrReturn`，真实开地址流程）开出的钱包带码 1 + 码 2 两个户；aging ③ 用 `createCustomerWallet`（`prisma.wallet.create` + `WalletCashAccountService.ensureForWallet`）建钱包，只开单不批准，没走到 91。
