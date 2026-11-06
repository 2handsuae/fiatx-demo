# 战役戊波一「账本地基 + 等价接线」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把账本从「资产按谁的钱合计 + 位置靠标签」改成「每个真实账户 / 钱包一个现金户、负债权益只记是谁的」，七种订单与调账单全部记到新户，对账引擎读现金户，**今天能演的一切照常演、一个功能不加**。

**Architecture:** 科目码 1 / 50 从每币种合计户变成每钱包一户（注册表归属 WALLET、户名 = 类名 · 钱包名、借方户不负标志）；运营户 200 改名公司权益只做对手盘；结算在途 201 / LP 前厅 203 退役为 50 类下的现金户；新增开支 300–302。所有记账调用点取现金户只走 `AccountingService.resolveCashAccountId(walletId, ledger)`；投影按科目类别写方向、钱包标签改派生、跨外部标记整列删除；对账引擎余额与匹配改读现金户的行、调账行按来源类型排除出匹配；种子、铺场脚本、`verify:coa`、基线随之改。

**Tech Stack:** NestJS + Prisma（SQLite）+ tigerbeetle-node 0.17.3（`AccountFlags.debits_must_not_exceed_credits=2`、`credits_must_not_exceed_debits=4`）；jest；React 管理台（admin-web）。

**Spec:** `doc-final/archive/superpowers/specs/2026-11-06-campaign-e-wave1-ledger-foundation-spec.md`（已随合并归档）（分录以总纲 `2026-11-06-campaign-e-ledger-by-location-charter.md` 附录 B「波一」列为准，科目表附录 A）

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用。
- 本轮特有：
  - **转账码一个不改号**（u16 一经分配不可改）；注释改写分录。
  - 科目码以总纲附录 A 为准；本波常量表 11 码（1 / 50 / 100 / 101 / 200 / 210–212 / 300–302），**201 FIRM_SET、203 FIRM_LIQ 从 T1 起标「退役中」，T12 删除**（它们的最后引用在 T4 兑换、T7 LP 与 T11 引擎里随任务清掉）；2 / 51 / 150 不进常量表。
  - 常量名甲套：`CLIENT_CASH`(1) / `FIRM_CASH`(50) / `FIRM_EQUITY`(200)；助记码 `A.CLIENT_CASH` / `A.FIRM_CASH` / `E.FIRM_EQUITY` / `X.EXPENSE_BANK_CUSTODY` / `X.EXPENSE_RECON_LOSS` / `X.EXPENSE_OTHER`；英文名 `Client Cash` / `Company Cash` / `Company Equity` / `Bank & Custody Charges` / `Reconciliation Write-off Loss` / `Other Expenses`。
  - **账本不得为负**：开户按类别写标志位——借方户（1 / 50 / 300–302）`credits_must_not_exceed_debits`(4)，贷方户（100 / 101 / 200 / 210–212）`debits_must_not_exceed_credits`(2)。
  - **所有记账调用点取现金户只走 `resolveCashAccountId`**，不得各自拼四元组。
  - 凭证参数 `debitWalletRef` / `creditWalletRef` / `isExternalCrossing` 三字段**删除**（T10 删类型与列，之前各任务只是不再传）。
  - 不做：托管短缺待补 ｜ 应收 LP ｜ 应付供应商 ｜ 公司钱包间调拨 ｜ 对内差额 ｜ 处置链接分组匹配 ｜ 案件页 / 跑批页布局 ｜ 文档整篇重写 ｜ decisions ｜ 追回链新行为 ｜ 兼容层 / backfill / 幂等 / 并发（项目总纲 §2）。
  - 每任务收尾：随手闸 ①②③④（jest 只跑本任务目录）。**钱的闸**：T3 起 `bash scripts/on-stack.sh self verify:coa` 每任务必跑（T3 之前 `reset` 铺不起来，没有栈可验）；T4–T7 各自的 money-arcs e2e 是过程闸；`demo:all` 第一次全绿在 T8。
  - 派发分层：T1 的机械替换走最低档；T2 / T3 / T4 / T5 / T6 / T7 / T9 / T10 / T11 动钱动引擎，**任务级评审升档**；终审升档。
  - 工作树：`.claude/worktrees/campaign-e-wave1/`，分支 `campaign-e-wave1`，自己的栈（`stack.sh up`）。

## Review Focus

1. **借方户上的方向**：现金户上一笔充值（借方行）必须投影成 `IN`；今天固定借 = OUT，不翻整张对账全反 → T10 投影 spec「A.CLIENT_CASH 借方行 → IN」。
2. **不负标志真的拒绝**：对客户现金户记一笔超过余额的贷方，TigerBeetle 必须拒绝（不是 verify:coa 事后发现）→ T2 写、T3 跑 `test/ledger-flags.e2e-spec.ts`。
3. **调账行进余额、不进匹配**：落账后的更正分录让差额归零，但不能冒出一条内部孤儿 → T11 余额检查器 spec + 匹配器 spec 各一条。
4. **改记四腿两个钱包同时归零**：钱从 Jack 的现金户挪到 Kate 的，应付反向 → T9 规则 spec + T13 跑 `test/recon-reattribution.e2e-spec.ts:699-713`（断言不改）。
5. **钱包没到 ACTIVE 不能记账**：没有现金户的钱包，`resolveCashAccountId` 必须抛而不是落到合计户 → T2 service spec。

---

### Task 0: 客户侧对照采样（改代码之前）

**Files:**
- Create: `scripts/client-side-snapshot.ts`
- Modify: `package.json`（npm script `client:snapshot`）
- Output: `doc-final/superpowers/checkups/2026-11-06-campaign-e-wave1-evidence/client-snapshot-before.json`

**Interfaces:**
- Produces: `client:snapshot` 脚本，参数 `--out <path>`；对花名册全部种子客户（`scripts/demo-lib.ts` 的 customers + Henry `demo_acme`）输出 `{ customerNo: { balances: {AED, USDT: {ledger, available}}, statementRows: [...], monthlyStatements: [...], portfolio: {...} } }`，用 `NestFactory.createApplicationContext(AppModule)` 直调 `CustomerStatementService` / `MonthlyStatementService` / 资产组合读服务（`customer-portfolio.controller.ts:75` 所用服务）/ `AccountingService.getCustomerAvailableBalance`；**去掉 id 与时间戳字段**，按客户号、币种、单号排序后 JSON 稳定输出。

- [ ] **Step 1: 写脚本并登记 npm script**（只读服务，零写库）
- [ ] **Step 2: 在工作树起栈、重铺、跑 demo:all**
  Run: `bash scripts/stack.sh reset self && bash scripts/stack.sh up && bash scripts/on-stack.sh self demo:all`
  Expected: demo:all 全绿（今天的基线）
- [ ] **Step 3: 采样**
  Run: `bash scripts/on-stack.sh self client:snapshot -- --out doc-final/superpowers/checkups/2026-11-06-campaign-e-wave1-evidence/client-snapshot-before.json`
  Expected: 文件存在，含全部花名册客户号；再跑一次输出逐字相同（稳定性）
- [ ] **Step 4: Commit**：`chore(戊波一): 客户侧对照采样脚本 + 改前快照`

### Task 1: 科目码表、类别函数、名称（含机械改名）

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts`
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.spec.ts`
- Modify（机械改名，常量与字面量）：全仓 `src/ scripts/ prisma/ test/ admin-web/src/`——`CLIENT_ASSET→CLIENT_CASH`（22 文件）、`FIRM_ASSET→FIRM_CASH`（23）、`FIRM_OPS→FIRM_EQUITY`（25）；字面量 `'A.CLIENT_ASSET'→'A.CLIENT_CASH'`、`'A.FIRM_ASSET'→'A.FIRM_CASH'`、`'E.FIRM_OPS'→'E.FIRM_EQUITY'`（含 `prisma/seed.business.ts:2317,2762,2768,2774,3498`、`admin-web/src/utils/causeRegistry.ts:61`、`admin-web/src/pages/ledger-account.constants.ts:17-20`、`CompanyFundsDashboard.tsx:41-43`、`wallet-recon-run.service.ts:782-788`、`scripts/recon-demo.ts:926`）。函数名 `assertFirmOpsBalance` **不改**（T8 改语义）。
- Modify（类别函数替换 8 处）：`tb-account-registry.service.ts:14`、`tb-admin.controller.ts:66`、`tb-evidence.service.ts:62,423,585`、`workflow/wallet-recon-run.service.ts:662`、`scripts/verify-realtime-coa.ts:6,18`、`scripts/backfill-account-flow-balance.ts:17`

**Interfaces:**
- Produces（`tb-account-codes.constant.ts`）：
  - `TB_ACCOUNT_CODES = { CLIENT_CASH:1, FIRM_CASH:50, CLIENT_PAYABLE:100, DEPOSIT_SUSPENSE:101, FIRM_EQUITY:200, FIRM_SET:201 /*退役中*/, FIRM_LIQ:203 /*退役中*/, INCOME_SWAP_FEE:210, INCOME_WITHDRAW_FEE:211, INCOME_OTHER:212, EXPENSE_BANK_CUSTODY:300, EXPENSE_RECON_LOSS:301, EXPENSE_OTHER:302 }`
  - `DEBIT_NORMAL_TB_CODES: ReadonlySet<number>` = {1, 50, 300, 301, 302}；`isDebitNormalCode(code: number): boolean`；`CASH_TB_CODES` = {1, 50}；`isCashCode(code: number): boolean`
  - `accountFlagsFor(code: number): number` → 借方户 4、贷方户 2（import `AccountFlags` from `tigerbeetle-node`）
  - `COA_TO_TB_CODE` 新键：`A.CLIENT_CASH` / `A.FIRM_CASH` / `E.FIRM_EQUITY` / `X.EXPENSE_BANK_CUSTODY` / `X.EXPENSE_RECON_LOSS` / `X.EXPENSE_OTHER`（`E.FIRM_SET` / `E.FIRM_LIQ` 保留到 T12）
  - `TB_ACCOUNT_NAMES`：1 `Client Cash`、50 `Company Cash`、200 `Company Equity`、300 / 301 / 302 英文名见 Global Constraints
  - `cashAccountName(code: 1 | 50, wallet: { vaultCode: string; walletRole: string; network: string; ownerNo: string }): string` → 平台 `${TB_ACCOUNT_NAMES[50]} · ${VAULTS[vaultCode].label} · ${network}`；客户 `${TB_ACCOUNT_NAMES[1]} · ${ownerNo} · ${walletRole === 'C_VIBAN' ? 'vIBAN' : 'Deposit address'}`
  - `isAssetCode` **删除**（全部改用 `isDebitNormalCode`）

- [ ] **Step 1: 改常量 spec**：`exposes exactly the 13 codes`（T12 改 11）断言新表；`round-trips COA labels` 加 `COA_TO_TB_CODE['X.EXPENSE_RECON_LOSS'] === 301`、`TB_CODE_TO_COA[1] === 'A.CLIENT_CASH'`；新增 `isDebitNormalCode(300) === true`、`isDebitNormalCode(200) === false`、`accountFlagsFor(1) === 4`、`accountFlagsFor(100) === 2`、`cashAccountName(50, {vaultCode:'F_OPS', walletRole:'F_OPS', network:'AED_ZAND', ownerNo:'PLATFORM'}) === 'Company Cash · Company Operations · AED_ZAND'`。`ALWAYS_REGISTERED_SYSTEM_CODES`（spec:58）与 `FIRM_LIQ is provisioned...`（spec:37-41）两条**留给 T2** 随 provisioning 一起改（本任务里它们照旧绿）。
- [ ] **Step 2: 跑 spec 确认红**：`npx jest src/modules/accounting/tigerbeetle/constants`
- [ ] **Step 3: 改常量文件**（上面 Interfaces）
- [ ] **Step 4: 机械改名**：改前 `grep -rl` 三个旧名各记文件数（22 / 23 / 25 为讨论会话计数，以现场为准）；替换；改后同名残留必须为 0，新名文件数 = 改前数。字面量三个同法。
- [ ] **Step 5: 类别函数替换 8 处**；`tb-evidence.service.ts:62` 改 `isDebitNormalCode(COA_TO_TB_CODE[coaCode] ?? -1)`。
- [ ] **Step 6: 随手闸 ①②③ + 常量 spec 绿**；全量 `npx jest src/modules/accounting`。
- [ ] **Step 7: Commit**：`refactor(戊波一): 科目码表 v3 常量、类别函数、甲套改名`

### Task 2: 注册表 WALLET 归属、标志位、现金户解析与开户

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/types/accounting.types.ts:1-10`（`ownerType: 'SYSTEM' | 'CUSTOMER' | 'LP' | 'WALLET'`）
- Modify: `src/modules/accounting/tigerbeetle/accounting.service.ts:25-75`（`createAccounts` 默认 flags）、新增 `resolveCashAccountId`
- Modify: `prisma/seed-tb.helper.ts:115`（默认 flags）、新增 `ensureWalletCashAccount`
- Create: `src/modules/accounting/tigerbeetle/wallet-cash-account.service.ts`（`WalletCashAccountService`）
- Modify: `src/config/manifests/assets.manifest.ts`（`currencyForNetwork`）
- Modify: `src/modules/asset-treasury/assets/asset-provisioning.service.ts`（列表）
- Modify: `src/modules/asset-treasury/wallets/wallets.service.ts:35-95`、`src/modules/trading/deposit-transactions/deposit-transactions.service.ts:1444-1450`（开户钩子）
- Modify: 模块装配（AccountingModule 导出新服务；WalletsModule / DepositTransactionsModule 注入）
- Test: `src/modules/accounting/tigerbeetle/wallet-cash-account.service.spec.ts`（新）、`accounting.service.spec.ts`、`tb-account-codes.constant.spec.ts`（provisioning 两条）、`wallets.service.spec.ts`、`test/ledger-flags.e2e-spec.ts`（新，T3 跑）

**Interfaces:**
- Produces：
  - `AccountingService.resolveCashAccountId(walletId: string, ledger: number, tx?: Prisma.TransactionClient): Promise<bigint>`：读 `wallets` 行（CUSTOMER → 1，PLATFORM → 50），再 `resolveTbAccountId({ code, ledger, ownerType: 'WALLET', ownerUuid: walletId }, tx)`；钱包不存在或无注册行 → 抛 `NotFoundException`（沿用 `resolveTbAccountId` 现行为）。
  - `WalletCashAccountService.ensureForWallet(wallet: { id: string; walletNo: string; ownerType: 'PLATFORM' | 'CUSTOMER'; ownerNo: string; vaultCode: string; walletRole: string; network: string }, tx?): Promise<void>`：ledger = `TB_LEDGERS[currencyForNetwork(network)]`；已有注册行则返回，否则 `createAccounts([{ code, ledger, ownerType: 'WALLET', ownerUuid: id, ownerNo: walletNo, assetCurrency, description: cashAccountName(code, wallet) }])`。
  - `ensureWalletCashAccount(prisma, tbClient, wallet)`（`prisma/seed-tb.helper.ts`，脚本用，同语义，照 `ensureTbAccountRegistry` 形态）。
  - `currencyForNetwork(code: NetworkCode): string`（TRON → 'USDT'，AED_ZAND → 'AED'，从 `DEFAULT_ASSETS` 查）。
  - `systemAccountCodesFor(assetType)` 返回 `[FIRM_EQUITY, INCOME_SWAP_FEE, INCOME_WITHDRAW_FEE, INCOME_OTHER, EXPENSE_BANK_CUSTODY, EXPENSE_RECON_LOSS, EXPENSE_OTHER]`（不再分法币）。
  - `createAccounts`：`flags: params.flags ?? accountFlagsFor(params.code)`（`accounting.service.ts:44,71`；`seed-tb.helper.ts:115` 同）。

- [ ] **Step 1: 改常量 spec 两条**：`ALWAYS_REGISTERED_SYSTEM_CODES`（spec:58）改为 `['FIRM_EQUITY','INCOME_SWAP_FEE','INCOME_WITHDRAW_FEE','INCOME_OTHER','EXPENSE_BANK_CUSTODY','EXPENSE_RECON_LOSS','EXPENSE_OTHER']`；删 `FIRM_LIQ is provisioned...`（spec:37-41），改为 `systemAccountCodesFor('FIAT') 与 ('CRYPTO') 返回同一份 7 码`。写 `wallet-cash-account.service.spec.ts`：`opens code 1 for CUSTOMER wallet on USDT ledger with flags 4 and name 'Client Cash · CU… · Deposit address'`；`opens code 50 for PLATFORM wallet`；`returns without createAccounts when registry row exists`。写 `accounting.service.spec.ts` 两条：`createAccounts defaults flags to 2 for code 100`、`to 4 for code 1`；`resolveCashAccountId throws NotFoundException when wallet has no registry row`（Review Focus 5）。
- [ ] **Step 2: 跑确认红**：`npx jest src/modules/accounting`
- [ ] **Step 3: 实现**（上面 Interfaces）；开户钩子：`WalletsService.createWalletRecord` 在 `status === 'ACTIVE'` 时、`transitionStatus(..., to === 'ACTIVE')` 时调 `ensureForWallet(row, tx)`；`deposit-transactions.service.ts:1444` `createRandom` 建行后调一次。
- [ ] **Step 4: 跑绿**：`npx jest src/modules/accounting src/modules/asset-treasury/wallets src/modules/asset-treasury/assets`
- [ ] **Step 5: 写 `test/ledger-flags.e2e-spec.ts`**（Review Focus 2，照 `test/withdraw-money-arcs.e2e-spec.ts` 的直调写法）：建一个客户钱包（`CustomerDepositWalletService.createOrReturn`）→ 现金户存在 → `executeTransfer` 借 1,000 进现金户 → 再贷 1,500 出现金户 → 断言抛错且错误信息含 TigerBeetle 的 `exceeds_debits` 状态。**本任务只写不跑**——它要重铺，重铺要等 T3 把种子接到新户。
- [ ] **Step 6: Commit**：`feat(戊波一): 注册表 WALLET 归属、按类别标志位、现金户解析与钱包开户`

### Task 3: 种子与演示造数、verify:coa 新天平（含 Henry 钱包）

**Files:**
- Modify: `prisma/seed.business.ts:132-190,200-224,2209-2334,2379-2843,3253-3510,3520-3769`
- Modify: `scripts/demo-lib.ts:378-415,1456-1473,1550-1569`
- Modify: `scripts/verify-realtime-coa.ts`（整文件）
- Test: `prisma/seed*.spec.ts`（若有）、`scripts/verify-demo-data.ts` R5 跑绿、`test/ledger-flags.e2e-spec.ts`（T2 写的，本任务首跑）

**Interfaces:**
- 平台钱包（215-218）：upsert 后 `ensureWalletCashAccount`；客户钱包（demo-lib 392 / 408）同。
- 注资（2247-2277）：借 现金·opsWallet ／ 贷 `FIRM_EQUITY`；凭证助记码 `A.FIRM_CASH / E.FIRM_EQUITY`；flow 行改用 `AccountFlowProjectorService.projectEvidence` 的纯函数生成（方向按类别），不再手写方向。
- LP 三腿（2747-2778）：84 借 `FIRM_EQUITY` ／ 贷 现金·sellFrom；85 借 现金·buyVia ／ 贷 `FIRM_EQUITY`；86 借 现金·buyTo ／ 贷 现金·buyVia。
- 付款（3459-3503）：借 `EXPENSE_BANK_CUSTODY` ／ 贷 现金·fromWallet。
- **Henry**（3520-3769）：按 `demo-lib.ts:392-413` 的形态给他 upsert C_DEP（TRON）+ C_VIBAN（AED_ZAND）两行、`status: 'ACTIVE'`、审计 `CUSTOMER_DEPOSIT_ADDRESS_SEEDED`（actor `DEMO_SEED`，R5 要求）、开现金户；账单腿改为客户本双边——充值 借 现金·vIBAN ／ 贷 应付；兑换卖出 借 应付 ／ 贷 现金·vIBAN；兑换买入 借 现金·地址 ／ 贷 应付；兑换费 借 应付 ／ 贷 现金·地址；提现与费 借 应付 ／ 贷 现金·vIBAN；**公司侧对手腿仍不铺**（现金户既有钱进钱出，不影响他「无活订单」）；结果余额仍 AED 44,950.00 / USDT 2,709.049000；注释 3540-3546 改写。
- demo-lib COA 恒等（1456-1473、1550-1569）改附录 A 公式。
- `verify:coa`：客户本 `Σ(1) == Σ(100) + Σ(101)`；公司本 `Σ(50) + Σ(300..302) == Σ(200) + Σ(210..212)`（201 / 203 在 T12 删前余额恒 0，暂并入右边不影响）；负余额遍历用 `isDebitNormalCode`；输出含 WALLET 行的 `ownerNo`（钱包号）。

- [ ] **Step 1: 改种子与 demo-lib**
- [ ] **Step 2: 改 verify:coa**（上面公式）
- [ ] **Step 3: 重铺**：`stack.sh reset self && up` → `on-stack.sh self verify:demo-data`（R5 绿，Henry 两钱包有审计）→ `on-stack.sh self verify:coa` 全绿（此时只有种子记过账，天平必须成立）。`demo:all` 此时**预期红**（七单未接线），不跑。
- [ ] **Step 4: 失效验证**（纪律 2）：在 self 栈手工 `executeTransfer` 一笔 借 现金·某客户钱包 ／ 贷 `FIRM_EQUITY`（跨本），`verify:coa` 必须红；反向冲回，绿。命令与输出存 evidence 目录。
- [ ] **Step 5: 跑 `test/ledger-flags.e2e-spec.ts`**（Review Focus 2）
  Run: 照项目既有 e2e 三要素在 self 栈跑该文件
  Expected: PASS（现金户超贷被 TigerBeetle 拒）
- [ ] **Step 6: 核 Henry**：`client:snapshot` 单跑 Henry，余额与改前快照一致。
- [ ] **Step 7: Commit**：`feat(戊波一): 种子记到现金户，Henry 铺钱包，verify:coa 新天平`

### Task 4: 兑换四腿接线

**Files:**
- Modify: `src/modules/funds-layer/constants/swap-leg-plan.constant.ts:11-45`
- Modify: `src/modules/trading/swap-transactions/swap-leg-accounting.ts:79-90,105-134,170-222,299-380`
- Test: `swap-leg-plan.constant.spec.ts`、`swap-leg-accounting` 相关 spec（`swap-workflow.service.spec.ts` 中涉及腿记账的断言）

**Interfaces:**
- Consumes：`resolveCashAccountId`（T2）。
- Produces：`swap-leg-plan` 表（码不变）：
  - CRYPTO_TO_FIAT：30 `CLIENT_PAYABLE / CLIENT_CASH`；31 `FIRM_CASH / FIRM_EQUITY`；32 `FIRM_CASH / FIRM_CASH`；33 `FIRM_EQUITY / FIRM_CASH`；34 `CLIENT_CASH / CLIENT_PAYABLE`；35 `CLIENT_PAYABLE / CLIENT_CASH`；36 `FIRM_CASH / INCOME_SWAP_FEE`
  - FIAT_TO_CRYPTO：30 同上；31 `FIRM_CASH / FIRM_EQUITY`（原贷 FIRM_SET）；37 `FIRM_CASH / FIRM_CASH`；38 `FIRM_EQUITY / FIRM_CASH`；34 / 35 / 36 同上
  - **现金侧钱包规则**（写进 `resolveAcct`）：同一腿内，现金贷方 = 该腿 `fromRole` 的钱包，现金借方 = `toRole` 的钱包；客户角色（C_*）按 `ctx.ownerId` 解析，平台角色按资产解析（沿用 `resolveWallet`）。
  - `resolveAcct(code, ledger, ctx, spec, side: 'debit' | 'credit', client?)`：`isCashCode(code)` → `resolveCashAccountId(wallet.id, ledger)`；`CLIENT_PAYABLE` → CUSTOMER；其余 SYSTEM。
  - 删除：`walletRefForCode`、`resolveLegWalletRefs`；`evidence()` 不再带三字段；`postLeg` 的 `enrichForPost` 只传 `{ externalRef }`。

- [ ] **Step 1: 改 `swap-leg-plan.constant.spec.ts`**：逐腿断言上表 14 行；新增 `every cash side resolves to the leg's from/to role`（纯函数断言：对每条 spec，含 1/50 的借方对应 toRole、贷方对应 fromRole）。
- [ ] **Step 2: 跑确认红**：`npx jest src/modules/funds-layer`
- [ ] **Step 3: 改表与解析**（上面 Interfaces）
- [ ] **Step 4: 跑绿**：`npx jest src/modules/funds-layer src/modules/trading/swap-transactions`
- [ ] **Step 5: 栈上抽核**（`demo:all` 要到 T8 才全绿，这里只跑一笔兑换）：用 `test/swap-money-arc.e2e-spec.ts`（随本任务改断言为新助记码）跑通，再 `sqlite3 … "select eventCode, debitCode, creditCode from tb_transfer_evidence where sourceType='SWAP'"` 抽一条每码，与附录 B 兑换表一致。
- [ ] **Step 6: Commit**：`feat(戊波一): 兑换四腿记到现金户与公司权益`

### Task 5: 充值接线（含没收 / 退回 / 上缴 / 追回）

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts:1588-1640,1858-1970,2237-2270,2478-2560,2765-2830`
- Modify: `src/modules/funds-orders/disposition.service.ts:35-64,205-225,140-155`
- Test: `deposit-workflow.service.spec.ts`、`funds-orders/disposition.service.spec.ts`、`test/deposit-money-arcs.e2e-spec.ts`（11 处旧名断言）

**Interfaces:**
- Consumes：`resolveCashAccountId`。
- Produces：`DispositionAccountRef = { code: number; ownerType: 'SYSTEM' | 'CUSTOMER'; ownerUuid?: string } | { cashWalletId: string }`；`DispositionTbLeg` 删 `debitWalletRef / creditWalletRef / isExternalCrossing`；`DispositionPostEnrich` 删 `isExternalCrossing`；`pendLegs` 对 `cashWalletId` 走 `resolveCashAccountId`。
- 分录（附录 B 充值表）：1 借 现金·充值落地钱包（`fundsOrder?.toWalletId ?? deposit.toWalletId`）／ 贷 暂扣；2 不变；3 借 暂扣 ／ 贷 现金·同钱包；4 借 现金·F_FEE 钱包（`firmFeeWallet.id`）／ 贷 其他收入；5–9 / 20 借 暂扣 ／ 贷 现金·同钱包（两阶段不变）；21 借 应付 ／ 贷 现金·同钱包（UI 维持置灰）。

- [ ] **Step 1: 改 spec**：`deposit-workflow.service.spec.ts` 对 `executeDepositAccounting` STEP_1 断言 `resolveCashAccountId(walletId, ledger)` 被调且借方为其返回值；没收腿 2 借方 = F_FEE 钱包现金户；`disposition.service.spec.ts` 对 `cashWalletId` 形态的 `DispositionAccountRef` 断言解析路径。
- [ ] **Step 2: 跑确认红**：`npx jest src/modules/trading/deposit-transactions src/modules/funds-orders`
- [ ] **Step 3: 实现**；删除本文件内三字段写入（1617 / 1626 / 1923-1926 / 1965-1968 / 2265-2266 / 2504 / 2507 / 2791）。
- [ ] **Step 4: 跑绿**（同上两目录）
- [ ] **Step 5: e2e**：`test/deposit-money-arcs.e2e-spec.ts` 助记码断言改新名后在 self 栈跑绿。
- [ ] **Step 6: Commit**：`feat(戊波一): 充值五条弧记到现金户`

### Task 6: 提现接线

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts:230-240,560-605,1142-1210,1264-1395,1768-1835,2079-2105`
- Test: `withdraw-workflow.service.spec.ts`、`withdraw-workflow.fee-income.spec.ts`（7 / 21 处）、`withdraw-transactions.service.spec.ts`（6 处）、`test/withdraw-money-arcs.e2e-spec.ts`

**Interfaces:**
- 分录（附录 B 提现表）：10 / 13 锁定 借 应付 ／ 贷 现金·`record.fromWalletId`；11 / 14 落账同户；16 借 现金·F_FEE 钱包（`resolveFirmFeeWalletRef` 的钱包）／ 贷 提现费收入；17 借 现金·`w.fromWalletId` ／ 贷 应付（两处：1796、2093）。
- `enrichForPost`（1202、1339）只传 `{ externalRef, effectiveDate? }`。

- [ ] **Step 1: 改 spec**：费腿公司侧借方 = F_FEE 现金户；锁定贷方 = fromWallet 现金户；bounce 借方 = fromWallet 现金户。
- [ ] **Step 2: 跑确认红**：`npx jest src/modules/trading/withdraw-transactions`
- [ ] **Step 3: 实现**；删三字段写入（598-601 / 1193-1208 / 1332-1345 / 1387-1390 / 1830-1833 / 2102-2103）。
- [ ] **Step 4: 跑绿**；**三域对照**：充值 / 提现 / 兑换三处取现金户的写法必须同一个入口（grep `resolveCashAccountId(` 三目录各 ≥ 1，`resolveTbAccountId({ code: TB_ACCOUNT_CODES.CLIENT_CASH` 全仓 0）。
- [ ] **Step 5: e2e**：`test/withdraw-money-arcs.e2e-spec.ts` 改断言后 self 栈跑绿。
- [ ] **Step 6: Commit**：`feat(戊波一): 提现本金 / 费 / 退回记到现金户`

### Task 7: 公司侧四单接线（内部划转 / LP 兑换 / 注资 / 支出）

**Files:**
- Modify: `src/modules/asset-treasury/internal-transfers/internal-transfer-workflow.service.ts:265-325`
- Modify: `src/modules/asset-treasury/lp-desk/lp-exchange-workflow.service.ts:413-480`
- Modify: `src/modules/asset-treasury/company-funding/capital-injection-workflow.service.ts:203-225`
- Modify: `src/modules/asset-treasury/company-funding/vendor-payment-workflow.service.ts:258-280`
- Test: 四个对应 `*.spec.ts`（`lp-exchange-workflow.service.spec.ts` 4 / 2 / 4 / 3 处；`capital-injection` 1 / 1 / 1；`vendor-payment` 2 / 1 / 1；`internal-transfer` 1 / 4）、`test/recon-internal-transfer.e2e-spec.ts`

**Interfaces:**（附录 B「波一」列）
- 划转 81：借 现金·`row.viaWalletId` ／ 贷 现金·`row.fromWalletId`；82：借 `EXPENSE_RECON_LOSS`(SYSTEM) ／ 贷 现金·firmWallet（法币 via、加密币 from）；83：借 现金·`row.toWalletId` ／ 贷 `CLIENT_PAYABLE`(row.customerId)。垫款路径同法接线、UI 置灰不动。`accounts()` 访问器删 firmOps / firmSet / firmAsset / clientAsset，改为按钱包的现金户。
- LP 84：借 `FIRM_EQUITY` ／ 贷 现金·`sellFromWalletId`；85：借 现金·`buyViaWalletId` ／ 贷 `FIRM_EQUITY`；86：借 现金·`buyToWalletId` ／ 贷 现金·`buyViaWalletId`。
- 注资 70：借 现金·`row.toWalletId` ／ 贷 `FIRM_EQUITY`。
- 支出 87：借 `EXPENSE_BANK_CUSTODY` ／ 贷 现金·`row.fromWalletId`。
- 四处 `evidence()` 删三字段。

- [ ] **Step 1: 改四个 spec** 按上表断言借贷户（现金侧断言 `resolveCashAccountId` 的入参钱包 id）。
- [ ] **Step 2: 跑确认红**：`npx jest src/modules/asset-treasury`
- [ ] **Step 3: 实现**
- [ ] **Step 4: 跑绿**；`test/recon-internal-transfer.e2e-spec.ts` 改断言后 self 栈跑绿。
- [ ] **Step 5: Commit**：`feat(戊波一): 划转 / LP / 注资 / 支出记到现金户、权益、开支`

### Task 8: 公司侧读面保活（余额闸、NLA、看板、科目端点）

**Files:**
- Modify: `src/modules/asset-treasury/lp-desk/lp-exchange.service.ts:93-100`、`internal-transfers/internal-transfer.service.ts:76-83`、`company-funding/vendor-payment.service.ts:98-105`、`prudential/prudential.service.ts:87-110`
- Modify: `src/modules/accounting/tigerbeetle/tb-account-registry.service.ts:95-160`（列表响应加 `walletRole` / `walletNo`）、`tb-admin.controller.ts`
- Modify: `admin-web/src/pages/CompanyFundsDashboard.tsx:40-60,268-330,482-521`
- Test: `prudential.service.spec.ts`（3 处）、三个 `assertFirmOpsBalance` 所在 service 的 spec、`tb-account-registry.service.spec.ts`

**Interfaces:**
- 余额闸与 NLA：先 `systemWallets.resolve(assetId, 'F_OPS')` → `resolveCashAccountId(wallet.id, ledger)` → `lookupBalance` → **借方口径** `available = debitsPosted − creditsPosted − creditsPending`（出款挂起是贷方挂起）。`assertFirmOpsBalance` 函数名不改，注释改。
- `GET /admin/tb/accounts`：`ownerType=WALLET` 行附 `walletRole`、`walletNo`（按 `ownerUuid` 批量 join `wallets`，禁 N+1，照 `attachOwnerName` 先例）。
- 看板：运营 / LP 在途 / 结算三区改读 `ownerType=WALLET` 且 `walletRole ∈ {F_OPS, F_LIQ, F_SET}` 的行（按币种）；收入三格不变；`COMPANY_CODES` 流水过滤改为 `{50, 200, 210, 211, 212, 300, 301, 302}`。

- [ ] **Step 1: 改 spec**：`prudential` NLA 用借方口径（给 mock `lookupBalance` 一组数，断言 `balanceMinor === debitsPosted − creditsPosted − creditsPending`）；三个闸同款一条；注册表列表 spec 断言 WALLET 行带 `walletRole`。
- [ ] **Step 2: 跑确认红**：`npx jest src/modules/asset-treasury src/modules/accounting`
- [ ] **Step 3: 实现后端**；再改看板。
- [ ] **Step 4: 跑绿 + admin tsc（闸②）**
- [ ] **Step 5: `demo:all` 首绿 + 渲染截图**：`stack.sh reset self && up` → `on-stack.sh self demo:all` **全绿**（T3–T7 接线齐了，这是本波第一道整体闸）→ `verify:coa` 绿 → 公司资金看板三区数字 = 科目页对应现金户余额；截图入 evidence 目录。
- [ ] **Step 6: Commit**：`feat(戊波一): 余额闸 / NLA / 看板改读现金户`

### Task 9: 调账单接线（含改记四腿）

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.ts:80-120`
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.ts:767-860,924-990`
- Test: `adjustment-rules.spec.ts`（7 处）、`adjustment.service.spec.ts`（4 / 4 / 41 处）、`test/recon-adjustment-money-arcs.e2e-spec.ts`（11）、`test/recon-aging-write-off.e2e-spec.ts`（8）

**Interfaces:**
- `resolvePostingLegs(book: Book, direction: Direction, reasonCode: ReasonCode): { debitCode: number; creditCode: number }`：现金码 = 账簿（CLIENT → 1，FIRM → 50）；对手码：CLIENT → 100；FIRM 按 `REASON_SPECS[reasonCode].family`：`CORRECT` / `REVERSE` → 200；`RECORD` 且 `INCREASE` → 212；`RECORD` 且 `REDUCE` → 300；`WRITE_OFF` 且 `REDUCE` → 301；`WRITE_OFF` 且 `INCREASE` → 212。`REDUCE` = 借对手 ／ 贷现金；`INCREASE` = 借现金 ／ 贷对手。
- `resolveReattributionLegs(): { payable: { debitCode: 100; creditCode: 100 }; cash: { debitCode: 1; creditCode: 1 } }`。
- `adjustment.service.onApproved`：`ownerFor` 改为——100 / 101 → CUSTOMER(`row.ownerId`)；1 / 50 → `resolveCashAccountId(row.walletRef, ledger)`；其余 SYSTEM。`postReattribution`：同事务两笔码 80——应付对（借 错记方 `row.ownerId` ／ 贷 正主 `toOwner.id`）+ 现金对（借 现金·`row.toWalletRef` ／ 贷 现金·`row.walletRef`），第二笔 `memo` 含 `cash reattribution`。凭证不再传三字段（841-845、970-974）。
- 调账凭证 `sourceType` 字面以 `adjustment.service.ts` 现值为准（grep `sourceType:` 确认），T11 引擎按同一常量排除——把它抽成 `RECON_ADJUSTMENT_SOURCE_TYPE` 常量导出。

- [ ] **Step 1: 改 `adjustment-rules.spec.ts`**：逐格断言——`CLIENT REDUCE AMT_MISBOOKED → {100, 1}`；`CLIENT INCREASE → {1, 100}`；`FIRM REDUCE AMT_MISBOOKED → {200, 50}`；`FIRM REDUCE BANK_CHARGE_UNBOOKED → {300, 50}`；`FIRM INCREASE BANK_INTEREST_UNBOOKED → {50, 212}`；`FIRM REDUCE UNEXPLAINED_WRITE_OFF → {301, 50}`；`FIRM INCREASE UNEXPLAINED_WRITE_OFF → {50, 212}`；`resolveReattributionLegs` 两对（Review Focus 4）。
- [ ] **Step 2: 跑确认红**：`npx jest src/modules/clearing-settle/reconciliation/disposition`
- [ ] **Step 3: 实现**
- [ ] **Step 4: 跑绿**；`adjustment.service.spec.ts` 断言 `postReattribution` 调了两次 `executeTransfer`、第二次借贷均为现金户。
- [ ] **Step 5: Commit**：`feat(戊波一): 调账单按处置家族落现金户，改记四腿`

### Task 10: 投影按类别、标签派生、跨外部标记退役（含迁移）

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/types/accounting.types.ts:12-33`、`tb-evidence.service.ts:11-37,72-100,186-230,396-470,495-610`、`accounting.service.ts:127-150,196-220`
- Modify: `src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service.ts:16-52,92-145,155-260`
- Modify: `prisma/schema.prisma:1472,1500`；Create: `prisma/migrations/20261106000000_coa_v3_drop_external_crossing/migration.sql`
- Modify（只删字段行，查询改法留 T11）: `scripts/recon-demo.ts:1135-1152,1229,471-477`、`domain/flow-comparison.builder.ts:88`、`engine/v2/wallet-flow-matcher.service.ts:179`（删 `isExternalCrossing: true` 条件，让编译过；T11 改成按户查）
- Modify: `scripts/verify-demo-data.ts:3-32,55-100,339-345`（删 R2）
- Test: `account-flow-projector.service.spec.ts`（9 / 31 处）、`tb-evidence.service.spec.ts`（19 / 20）

**Interfaces:**
- `EvidenceParams` / `WriteEvidenceParams` / `EvidenceLike`：删 `debitWalletRef`、`creditWalletRef`、`isExternalCrossing`；保留 `externalRef`、`effectiveDate`。`enrichForPost` 的 `fields` 同删两项。
- `projectEvidence(evidence)`：方向——`isDebitNormalCode(COA_TO_TB_CODE[evidence.debitCode])` 为真时借方行 `IN`、贷方行 `OUT`；否则借 `OUT`、贷 `IN`（含义统一「钱进这个户 = IN」）。`persist()`：按两侧 `tbAccountId` 批量查注册表，`walletRef = ownerType === 'WALLET' ? ownerUuid : null`；删 `assertWalletRefMatchesTbAccount`、`AGGREGATE_TB_CODES`、`WalletRefMismatchError`。
- `getAccountStatement` / `getWalletStatement`：删 `crossingOnly` 参数与过滤（441、535）；控制器同步删查询参数。
- 迁移：`ALTER TABLE tb_transfer_evidence DROP COLUMN isExternalCrossing; ALTER TABLE account_flows DROP COLUMN isExternalCrossing;`（SQLite 3.35+ 支持 DROP COLUMN；不支持则照 `RedefineTables` 惯例重建）；无 backfill。

- [ ] **Step 1: 改投影 spec**：`debit on A.CLIENT_CASH projects direction IN`、`credit on A.CLIENT_CASH projects OUT`、`debit on L.CLIENT_PAYABLE projects OUT`（Review Focus 1）；`walletRef derived from WALLET-owned registry row, null otherwise`；删 R2 用例。
- [ ] **Step 2: 跑确认红**：`npx jest src/modules/clearing-settle/reconciliation/projector src/modules/accounting`
- [ ] **Step 3: 改类型与投影、写迁移、`prisma generate`**；脚本与引擎只删字段行（查询改法留 T11）。种子在 T3 已不写这三字段。
- [ ] **Step 4: 随手闸 ①（含 scripts / prisma）+ 跑绿**
- [ ] **Step 5: Commit**：`feat(戊波一): 投影按类别写方向，钱包标签派生，跨外部标记退役`

### Task 11: 对账引擎最小适配 + 铺场脚本

**Files:**
- Modify: `engine/v2/wallet-balance-checker.service.ts`（整文件）、`engine/v2/wallet-flow-matcher.service.ts:60-75,170-225`、`domain/flow-comparison.builder.ts:80-95`、`workflow/wallet-recon-run.service.ts:330-480,641-690,775-790`（路径前缀 `src/modules/clearing-settle/reconciliation/`）
- Modify: `scripts/recon-demo.ts:404-480,440-445,920-930,1105-1160,1225-1235`
- Modify: `admin-web/src/utils/causeRegistry.ts:58-62`
- Test: `wallet-balance-checker.service.spec.ts`、`wallet-flow-matcher.service.spec.ts`、`wallet-recon-run.service.spec.ts`、`reconciliation-query.service.spec.ts`、`flow-comparison` 相关 spec；e2e 六支在 T13

**Interfaces:**
- `WalletBalanceCheckerService.checkBalance({ walletRef, externalClosing, cutoff })` → `{ pass, walletRef, walletKind: 'CUSTOMER' | 'FIRM', coaCode: 'A.CLIENT_CASH' | 'A.FIRM_CASH', ownerNo, cashTbAccountId: string, internal: { total: bigint }, external, delta }`：按 `wallets.ownerType` 定码、按币种定 ledger、查注册表 `(code, ledger, 'WALLET', walletRef)` 得户；`internal.total = Σ(IN) − Σ(OUT)` of `account_flows where tbAccountId = 户 (补零后) and transferType = 'POSTED' and effectiveCutoff`。删 `CUSTOMER_CODES / FIRM_CODES / AGGREGATE_CODES` 与 payable / suspense / firmEquity 字段。
- `WalletFlowMatcherService.match(input)`：新增入参 `cashTbAccountId`；纳入 = `{ tbAccountId: cashTbAccountId, transferType: 'POSTED', sourceType: { not: RECON_ADJUSTMENT_SOURCE_TYPE }, ...cutoff }`；删 `OWNED_CODES` 与注册表过滤（205-223）。
- `flow-comparison.builder.ts:85-89`：同一纳入条件（用案子 `walletRef` 反查户）。
- `computeInternalIdentity`：客户本 `Σ(1) == Σ(100) + Σ(101)`；公司本 `Σ(50) + Σ(300..302) == Σ(200) + Σ(210..212)`，余额按 `isDebitNormalCode` 取向。
- `wallet-recon-run`：删 `COA_BY_ROLE`（782-788）；案子与快照 `coaCode` 取 checker 的；`book` 由 `walletKind`。
- `recon-demo.ts`：`FIRM_CODES / CUSTOMER_CODES`（443-444）→ `{50}` / `{1}`；`planWallets` 流水查询（471-477）按户查、排除调账行；`p.coaCode !== 'E.FIRM_LIQ'`（926）→ `p.walletRole !== 'F_LIQ'`；重复入账场景（1112-1152）借方 = `resolveCashAccountId(slotShowcaseB.walletRef, ledger)`；1229 的 `findFirst` 改按户与方向。
- `COA_PHRASE`：`'A.CLIENT_CASH': 'Client cash'`、`'A.FIRM_CASH': 'Company cash'`（删旧三键）。
- `simulation/simulated-custodian-statement.service.ts` 不读流水（只写对账单行、调 checker 取 `coaCode`），**零改动**。

- [ ] **Step 1: 改 spec**：checker——`internal.total sums IN minus OUT on the wallet's cash account only`、`adjustment rows are included in the balance`（Review Focus 3 上半）；matcher——`rows with sourceType RECON_ADJUSTMENT are excluded from candidates`（下半）、`a cash-account deposit row with direction IN matches an external IN line`；run——`computeInternalIdentity passes with expenses on the left`；query spec 的 walletRef 断言按新形态改。
- [ ] **Step 2: 跑确认红**：`npx jest src/modules/clearing-settle/reconciliation`
- [ ] **Step 3: 实现引擎**；再改 `recon-demo.ts` 与 `COA_PHRASE`。
- [ ] **Step 4: 跑绿 + 闸②（admin tsc）**
- [ ] **Step 5: 栈上**：`stack.sh reset self && up && demo:all` → `recon:demo:pass` 绿 → `recon:demo:break` **18/18 场景、12/12 案子**（`RECON_DEMO_MANIFEST_PATH` 按 self 栈路径）。
- [ ] **Step 6: Commit**：`feat(戊波一): 对账引擎改读现金户，铺场脚本随之`

### Task 12: 常量收口、admin 词表、文档判据

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts`（删 201 / 203，黑名单加 `FIRM_SET` / `FIRM_LIQ`）+ spec（`exposes exactly the 11 codes`）
- Modify: `admin-web/src/pages/ledger-account.constants.ts:14-53`（删 201 / 203 标签；加 1 / 50 / 200 新名、300–302、`X` 前缀）
- Modify: `doc-final/demo/baseline.md`（行 24, 71, 130, 230-289, 318-358, 405, 436, 457）、`doc-final/demo/data.md:42-49`（加「现金户」列）、`doc-final/demo/script.md`（222, 230-232, 462-479, 499-608, 640-674：术语换「公司现金·运营」「客户现金」；222 改记措辞按总纲 §4 岔口 6）
- Test: 常量 spec；`grep -rn "FIRM_SET\|FIRM_LIQ" src scripts prisma admin-web/src --include='*.ts' --include='*.tsx' | grep -v spec` 必须为 0（钱包角色 `F_SET` / `F_LIQ` 不在此列）

**Interfaces:**
- 常量表终盘 11 码；`verify:coa`（T3）公式里 201 / 203 项随之删除。

- [ ] **Step 1: 常量收口** → `npx jest src/modules/accounting/tigerbeetle/constants` 绿；`verify:coa` 删 201 / 203 项后在 self 栈仍绿
- [ ] **Step 2: 改 admin 词表 + 闸②；账本科目页截图（7 个公司现金户 + 客户现金户按模式命名）**
- [ ] **Step 3: 改三份 demo 文档**
- [ ] **Step 4: Commit**：`chore(戊波一): 退役 201/203，admin 词表，文档判据`

### Task 13: 收尾闸、走查、对照比对、承接

**Files:**
- Modify: `test/*.e2e-spec.ts`（H1 清单中 8 支旧助记码断言随前面任务已改；本任务只跑）
- Modify: `doc-final/CHANGELOG.md`（一行）、`doc-final/superpowers/specs/2026-11-06-campaign-e-wave2-skeleton.md`（「承接波一」四项）
- Output: `doc-final/superpowers/checkups/2026-11-06-campaign-e-wave1-evidence/`（`client-snapshot-after.json`、`client-snapshot.diff`、`evidence-by-transfer-code.md`、截图）

- [ ] **Step 1: 全量**：`stack.sh reset self && up` → `demo:all` → `verify:coa` → `recon:demo:pass` → `recon:demo:break`（18/18、12/12）→ e2e 六支对账 + money-arcs 三支 + `ledger-flags` + 其余（基线 7 红不劣化）→ 全量 jest 不接管道、看退出码。
- [ ] **Step 2: 客户侧对照**：`client:snapshot --out …/client-snapshot-after.json`；`diff before after` 必须为空（Henry 除外：他多了两个钱包行，但余额 / 流水 / 月结单 / 组合四项仍须逐字相同）。
- [ ] **Step 3: 凭证抽核表**：每个转账码（1–21、30–38、70、80–87）从 `tb_transfer_evidence` 取一条：码 → 凭证号 → `debitCode / creditCode`，与附录 B 逐行对照，写 `evidence-by-transfer-code.md`。
- [ ] **Step 4: 管理台走查截图**：账本三列表、对账跑批详情、一张客户案 + 一张公司案、公司资金看板。
- [ ] **Step 5: 承接波一**：骨架四项（合并基线 / 实际交付含订正 / 偏差 / 悬挂项）；CHANGELOG 一行；文档分层报告句。
- [ ] **Step 6: Commit**：`docs(戊波一): 收尾证据、承接波二、CHANGELOG`

---

## 任务依赖与并行

T0 → T1 → T2 → **T3（种子，之后 `reset` 才铺得起来）** → {T4, T5, T6, T7} 可并行（文件不交叉；共用 T2 接口）→ T8（demo:all 首绿）→ T9 → T10 → T11 → T12 → T13。T10 之前各任务只「不再传」三字段、不删类型；T10 删类型时若有残留调用方编译即红，顺手清。
