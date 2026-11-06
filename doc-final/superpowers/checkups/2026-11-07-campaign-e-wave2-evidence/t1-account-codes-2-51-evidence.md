# 戊波二 T1 · 科目码 2 / 51、开户、投影、天平 — 证据

> 代码头：commit 1 `feat(戊波二): 科目码 2 / 51、类别函数、码 2 流水不打 walletRef` 之后的工作树（commit 2 即带本文件的那一笔）。
> 所有命令在 worktree 根跑，前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`；栈 = `self`（`.stackports` 3110–3113）。

## 1. TDD：先红后绿

| 步 | 命令 | 退出码 | 关键行 |
|---|---|---|---|
| 红（实现前） | `npx jest src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.spec.ts src/modules/accounting/tigerbeetle/wallet-cash-account.service.spec.ts src/modules/asset-treasury/lp-desk/lp-receivable-account.service.spec.ts src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service.spec.ts` | 1 | `Test Suites: 4 failed, 4 total` ｜ `Tests: 5 failed, 21 passed, 26 total` ｜ `TS2307: Cannot find module './lp-receivable-account.service'`（常量 spec 因 `walletAccountCodesFor` 未导出编译失败）｜ 投影器：`Expected "IN" / Received "OUT"`（助记码 `A.CLIENT_SHORTFALL` 未登记，借方户被当贷方户）与 `码 2 … walletRef` 收到 `"wallet-w1"` |
| 绿（实现后，同命令） | 同上 | 0 | `Test Suites: 4 passed, 4 total` ｜ `Tests: 46 passed, 46 total` |

补充两组**失效验证**（破坏被测行为，看它变红，再还原）：

| 被测行为 | 破坏方式 | 结果 | 还原后 |
|---|---|---|---|
| 档案 →ACTIVE 两条边之后开应收户（`lp-profile-workflow.service.spec.ts`） | 临时删掉 `onDecided` APPROVED 分支与 `reactivate` 里的 `ensureForLp` 调用 | 退出码 1，`Tests: 3 failed, 65 passed, 68 total`（两个 APPROVED 用例 + reactivate 用例） | 退出码 0，68 passed |
| 内部天平含码 2 / 51（`wallet-recon-run.service.spec.ts` 新增 3 例，不桩 `computeInternalIdentity`） | 临时把 `CLIENT_SHORTFALL` 与 `LP_RECEIVABLE` 从求和里拿掉 | 退出码 1，`Tests: 3 failed, 23 passed, 26 total`（3 个「戊波二」用例） | 退出码 0，26 passed |

## 2. 闸门

| 闸 | 命令 | 退出码 | 输出 |
|---|---|---|---|
| ① 后端 | `npx tsc --noEmit -p tsconfig.json` | 0 | 零输出 |
| ② 管理台 | `cd admin-web && npx tsc -b --noEmit` | 0 | 零输出 |
| ③ 客户端 | `cd client-web && npx tsc -b --noEmit` | 0 | 零输出 |
| ④ 相关 jest | `npx jest src/modules/accounting src/modules/asset-treasury src/modules/clearing-settle`（DATABASE_URL 取 `.env`） | 0 | `Test Suites: 70 passed, 70 total` ｜ `Tests: 1459 passed, 1459 total` |
| ④′ 全量单测 | `npx jest --silent`（全仓 `src` + `admin-web` + `scripts` 的 `.spec.ts`） | 0 | `Test Suites: 276 passed, 276 total` ｜ `Tests: 2 skipped, 5 todo, 4607 passed, 4614 total`（这一遍在加 `wallet-recon-run` 天平 3 例之前跑；之后那 3 例已在 ④ 里覆盖） |

## 3. 重铺 + 科目数 + verify:coa

`bash scripts/stack.sh reset self`（exit 0）→ `bash scripts/stack.sh up`（exit 0，等到 `Nest application successfully started`）。

**reset 之后、demo:all 之前**（R4：这个数不是停车条件）：`select count(*) from tb_account_registry where status='ACTIVE'` = **81**。
构成（`select code, ownerType, count(*) … group by`）：码 1 = 2（Henry 两条钱包）、码 2 = 2、码 50 = 7、**码 51 = 4（Falcon、Dune × AED、USDT）**、100 / 101 各 26、200 / 210–212 / 300–302 各 2。

`bash scripts/on-stack.sh self verify:coa`（exit 0）：
```
✓ ledger 1 CLIENT 恒等 4495000      ✓ ledger 1 FIRM 恒等 95000000
✓ ledger 2 CLIENT 恒等 2709049000   ✓ ledger 2 FIRM 恒等 113600000000
✓ 负余额检查 通过 (81 个科目全部 ≥ 0)      ALL INVARIANTS PASS
```

`bash scripts/on-stack.sh self demo:all`（exit 0）：`花名册：35/35 符合预期` ｜ `asserts: 5/5 PASS`。
其中新天平两行（`scripts/demo-lib.ts` 的 `verifyEndState`，label 随公式改）：
```
✓ COA CLIENT(AED): Σ(CLIENT_CASH+CLIENT_SHORTFALL) == Σ(CLIENT_PAYABLE+DEPOSIT_SUSPENSE) (34107565 == 34107565)
✓ COA FIRM(AED): Σ(FIRM_CASH+LP_RECEIVABLE+EXPENSE_*) == Σ(FIRM_EQUITY+INCOME_*) (94870335 == 94870335)
```
（四行余额数与改前 `doc-final/demo/data.md` 生成区**逐位相同**：34107565 / 94870335 / 8201620811 / 114035428189——码 2 / 51 本任务不记任何账。）

**demo:all 之后**（R4：这个数是停车条件）：`bash scripts/on-stack.sh self verify:coa`（exit 0）
```
✓ ledger 1 CLIENT 恒等 34107565     ✓ ledger 1 FIRM 恒等 94870335
✓ ledger 2 CLIENT 恒等 8201620811   ✓ ledger 2 FIRM 恒等 114035428189
✓ 负余额检查 通过 (105 个科目全部 ≥ 0)      ALL INVARIANTS PASS
```
`select count(*) from tb_account_registry where status='ACTIVE'` = **105** = 87 + 14（客户钱包码 2）+ 4（LP 码 51），与 spec §6 一致。分码：码 1 = 14、码 2 = 14、码 50 = 7、码 51 = 4。

`bash scripts/on-stack.sh self recon:demo:pass`（exit 0）：`status=PASS walletsChecked=21 casesOpened=0`——真对账引擎（含改过的 `computeInternalIdentity` 预门）在 105 户的账上放行。

## 4. 失效验证：天平真的会红

一次性脚本（不入库）直接对 TigerBeetle 记**一笔**：借 `2·WA2601010188`（Henry 的 vIBAN 钱包的短缺待补户）/ 贷 `200` 公司权益（同 ledger 1），金额 777000 分，transfer code 65001（不在业务码内）。
（R8：TB 是复式账，「无对手借方」不存在；对手方取客户本之外的 200。）

`verify:coa`（exit **1**）：
```
✗ ledger 1 CLIENT: Σ(1)+Σ(2)=34884565 Σ(100)+Σ(101)=34107565      ← 差额 777000，正是码 2 那一笔；码 2 不在求和里这行不会红
✗ ledger 1 FIRM: Σ(50)+Σ(51)+Σ(300..302)=94870335 Σ(200)+Σ(210..212)=95647335   ← 对手方 200 被贷，公司本同时破
✓ ledger 2 CLIENT 恒等 8201620811   ✓ ledger 2 FIRM 恒等 114035428189
FAIL: 2 invariant breaks
```
记精确反向一笔（借 200 / 贷 2）后 `verify:coa`（exit **0**）：四行全 `✓`，`105 个科目全部 ≥ 0`，`ALL INVARIANTS PASS`。
随后 `reset self` → `up` → `demo:all` → `verify:coa` 把栈还原干净（见 §5）。

## 5. 收尾状态（栈）与一次已知偶发红

最终状态：`reset self` → `up` → `demo:all`（exit 0，35/35，asserts 5/5）→ `verify:coa`（exit 0，105 户全 ≥ 0，四行余额同 §3）。

**如实记一笔红**：收尾那几轮「reset → up → demo:all」里有一轮 `demo:all` exit 1：`FATAL Error: Timeout (8000ms) waiting for: SWP261107274168 leg 2 CLEARED`，日志里的根因是 `SwapWorkflowService.createLeg` → `funds-order.service.ts:66` `Unique constraint failed on the fields: (fundsOrderNo)`——`generateReferenceNo('FDO')` 的 6 位随机数同日撞号（该函数头注释自述一次 demo:all 约 0.2% 命中，见 `src/common/utils/no-generator.util.ts:8-12`）。与账户 / 开户 / 天平无关（本任务没有任何码 2 / 51 的分录，兑换单建腿路径不碰它们）；同代码立即重铺重跑一轮，demo:all exit 0。未登记 `TOOLING-DEBT.md`（该撞号概率已在源码注释里自述并接受）。

## 6. 天平口径的硬编码清单（R3：「在 <范围> 内、用 <搜法> 未找到别处」）

范围 = `src scripts prisma test`（`*.ts / *.sh / *.js`），三种搜法：
① 含 `CLIENT_PAYABLE` 且同文件含 `DEPOSIT_SUSPENSE` 的非 spec 文件；② 含 `INCOME_SWAP_FEE` 且同文件含 `EXPENSE_RECON_LOSS` 的非 spec 文件；③ 字面 `Σ(1)` / `Σ(50)` / `[1, 100` 类数字集合。

求和型「天平」只在三处，**全已改**：
- `src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts` `computeInternalIdentity`（对账预门）
- `scripts/verify-realtime-coa.ts`（= `npm run verify:coa`）
- `scripts/demo-lib.ts` `verifyEndState` 第 2 条（`demo:all` 的 COA 断言；**控制者清单没列，但它是同款硬编码天平**，不改则 `demo:all` 的 label 与公式落后于 verify:coa；生成区 `doc-final/demo/data.md` 四个 label 随之变，余额数不变）

其余命中均为**记账 / 读数**，不是天平，未动：`customer-ledger-provisioning.service.ts`（开 100/101）、`customer-statement.service.ts`、`adjustment.service.ts`、`deposit-workflow.service.ts`、`scripts/recon-demo.ts`（铺场分录）、`prisma/seed.business.ts`（种子分录；3572 行一处注释里复述了旧公式，已顺手改成新式）、`tb-transfer-codes.constant.ts`、`asset-provisioning.service.ts`（每资产 7 个系统户，不含 2 / 51）。
动态引用 / 运行时注册 / 外部调用方天然在搜索边界外，没覆盖。

## 7. 夹具兼容（ensureForWallet 现在开两户）：e2e 抽样

夹具直造钱包的 e2e（`recon-adjustment-money-arcs / recon-supplement / recon-internal-transfer / incident-register / recon-reattribution / recon-aging-write-off`，都调 `WalletCashAccountService.ensureForWallet`）：
- **真实时钟（本机迪拜 01:5x = UTC 21:5x，窗口内）**：`recon-reattribution` 的 A、B 两例红，签名 `expect(run1.status).toBe('BREAK')` 收到 `"PASS"`——这正是 `e2e-baseline-0c6eb7b0.md` §2.2 / §4 记的「迪拜业务日 vs UTC 日期」窗口效应（基线 A 轮这两名同样红），与本任务无关。
- **拨钟（沿用基线 §4 的 `shift-clock.js` + 拨钟 jest 配置）**：`reset self` → `up` → `demo:setup`（均 exit 0）→ 上述 6 套件 `--runInBand --cacheDirectory=<新空目录>`：exit 1，`Test Suites: 5 failed, 1 passed, 6 total` ｜ `Tests: 7 failed, 30 passed, 37 total`——与基线 §4 第 1 条对**改前代码**的同口径拨钟结果**逐数相同**；7 个失败名全部在基线失败名清单里（`comm` 式核对：不在基线内的 = 0），`recon-reattribution` 整套绿。即：码 2 随客户钱包一起开出来，没有让任何夹具多红一名。
- 之后 `reset self` → `up` → `demo:all`（exit 0，35/35，asserts 5/5）→ `verify:coa`（exit 0，105 户全 ≥ 0）把栈还原干净。
- 全量 e2e 冷缓存对照留给 T12。
