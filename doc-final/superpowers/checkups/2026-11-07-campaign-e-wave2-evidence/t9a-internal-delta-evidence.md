# T9a 证据 —— 对账读端解析器合一 + 客户钱包对内差额（戊波二 Task 9 前半）

基底 `4d07a129`，分支 `claude/campaign-e-wave2-e761d7`。命令均在 worktree 根执行、前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`；退出码取自重定向到文件后的 `echo $?`（不接管道）。

## 1. 前提核验（controller 要求：违反即停）

**前提**：对内差额拿「按钱包的现金 + 短缺待补」去比「按客户·按账本的应付 + 暂扣」，只有在「每个客户在每个账本至多一只 CUSTOMER 钱包」时才成立。

只读查询（`sqlite3 -readonly`，自栈库 `/tmp/exchange_js_wt_campaign_e_wave2_e761d7/dev.db`，`reset self` → `demo:all` 之后）：

```
select count(*) from wallets where ownerType='CUSTOMER';
  → 14
select ownerNo, case network when 'AED_ZAND' then 1 when 'TRON' then 2 else -1 end ledger, count(*) c
  from wallets where ownerType='CUSTOMER' group by 1,2 having c>1 or ledger=-1;
  → （空：没有任何客户在同一账本有两只 CUSTOMER 钱包，也没有未知网络）
select ownerNo, group_concat(network) from wallets where ownerType='CUSTOMER' group by ownerNo having count(*)>1;
  → 7 个客户，每个都是 TRON,AED_ZAND（Henry = CU2601012635 在内）——两只钱包在不同账本
```

结构性依据（不止是种子巧合）：`Wallet` 唯一键 `[vaultCode, network, ownerNo]`（`schema.prisma:722`）+ 客户钱包 vaultCode 恒为 `CLIENT_DEPOSIT`（查询：`CLIENT_DEPOSIT|14`）+ `networks.manifest.ts` 只有 `TRON`（→ ledger 2）与 `AED_ZAND`（→ ledger 1）两个网络。**前提成立，继续。**

## 2. 实现 → 证据对照

| 要求 | 位置 | 验证 |
|---|---|---|
| 读端删自查注册表，取现金户经 `AccountingService.resolveCashAccountId(walletId, ledgerForNetwork(network))` | `engine/v2/wallet-balance-checker.service.ts`（`loadWallet`；公开的 `resolveCashAccount` 保留给案件页 / `recon-demo`，但内部已不碰注册表） | checker spec 用**真实** `AccountingService` + `TbAccountRegistryService`（只替 Prisma/TB 底层）；`resolveCashAccount` 用例 `jest.spyOn(accounting,'resolveCashAccountId')` 断言 `('w-cust-usdt', 2)` / `('w-firm-aed', 1)` |
| 客户钱包四户求和 → `internalDelta`，公司钱包 `null`，同一个 `effectiveCutoffFilter` | 同上 `netPosted` ×4 | checker spec「四户求和 / 短缺待补进算式 / 四个户共用同一个截止口径 / 只按户汇总 / 账本跟网络走 / 公司钱包 null 且不查 2·100·101」 |
| 未开户同码抛 | 现金户未开 → `WALLET_CASH_ACCOUNT_NOT_FOUND`（把解析器的 `TB_ACCOUNT_REGISTRY_NOT_FOUND` 换回读端一贯用的码）；短缺待补户未开 → 解析器自己的 `TB_ACCOUNT_REGISTRY_NOT_FOUND`（话术带 `code=2`） | checker spec 两条 |
| 迁移 + 两列 | `prisma/migrations/20261107020000_campaign_e_internal_delta/migration.sql`；`schema.prisma` `ReconciliationCase.internalDeltaAmount Decimal?`、`ReconciliationRunWallet.internalDeltaAmount Decimal?`（分，签名，同 `deltaAmount` 单位） | `prisma migrate deploy` 到临时空库后 `prisma migrate diff --from-url <临时库> --to-schema-datamodel prisma/schema.prisma --script` → `-- This is an empty migration.`（无漂移）；`reset self` 后 `pragma table_info` 两表都有 `internalDeltaAmount DECIMAL` |
| 分桶第 0 条 | `engine/v2/bucket-classifier.ts`（`internalDelta: bigint \| null` 必填入参） | classifier spec：4 个第 0 条用例 + 网格 180 → 720 组（独立 `expectedBucket` 含第 0 条） |
| 快照 / 案件带 internalDelta；INVARIANT 差异行 | `workflow/wallet-recon-run.service.ts`、`domain/reconciliation-case.service.ts`（`openCase` / `reObserve` 落列） | run-service spec 新 describe 7 例（形状逐键相等、方向 IN/OUT + 绝对值、两种差异并存行号接续、自愈）+ case-service spec |
| `computeInternalIdentity` 陈旧注释 | `debit-normal (1 / 2 / 50 / 51 / 300–302)` | 文本 |
| 读面 | `AccountStatusRow.internalDelta`（`dto` + `getRun`）；案件详情 / 列表本就 `...kase` 展开，新列自动下发 | query-service spec；e2e 里 `getRun` / `getCase` 实测 |

判断点（controller 没点名、我自作主张的三处，report 里也列）：
1. **严重度**取 `max(|delta|, |internalDelta|)` 对应的那个数：仅对内不平的案子 `delta = 0`，按 `delta` 算恒 LOW，与「账簿对不上」不相称（run-service spec 一例：对内 5,000,000 → HIGH）。
2. `caseReason` 多一个 `wallet_internal_imbalance`（只对内不平时），否则会被标成 `wallet_flow_break`。该字段下游无消费者，纯标签。
3. INVARIANT 行**只在持久化的 `lineItems` 里**，不进 `flowComparison`（实时重算的行集）——所以案件页的行级处置菜单天然拿不到它（e2e 断言 `flowComparison.filter(r => r.dispositions?.length)` 为空）；T10 渲染它需从 `lineItems` 取（或决定把它并入 `flowComparison`，那是 T10 的口子）。

## 3. 闸门

| # | 命令 | 退出码 | 关键摘录 |
|---|---|---|---|
| ① | `npx tsc --noEmit -p tsconfig.json` | 0 | 输出 0 字节 |
| ② | `cd admin-web && npx tsc -b --noEmit` | 0 | 0 字节 |
| ③ | `cd client-web && npx tsc -b --noEmit` | 0 | 0 字节 |
| ④ | `npx jest src/modules/clearing-settle/reconciliation src/modules/accounting` | 0 | `Test Suites: 33 passed, 33 total` / `Tests: 654 passed, 654 total` |
| 重铺 | `bash scripts/stack.sh reset self` → `bash scripts/stack.sh up` | 0 / 0 | |
| ⑥ | `bash scripts/on-stack.sh self demo:all` | 0 | `花名册：35/35 符合预期` / `asserts: 5/5 PASS` / `demo:all DONE ✅` |
| | `bash scripts/on-stack.sh self recon:demo:pass` | 0 | `status=PASS walletsChecked=21 casesOpened=0`；该轮快照 `internalDeltaAmount`：CUSTOMER 14 行全为 0、FIRM 7 行全为 NULL（`sqlite3 -readonly … group by book` → `CUSTOMER|14|0|14|0`、`FIRM|7|7||`） |
| | `bash scripts/on-stack.sh self recon:demo:break` | 0 | `scenarios: 18/18 DETECTED`、`wallets: 12/12 bucket OK`、`casesOpened 12/12`、`identities OK`（与改前一致） |
| ⑦ | `bash scripts/on-stack.sh self verify:coa` | 0 | 四条恒等 ✓；`负余额检查 通过 (105 个科目全部 ≥ 0)`；`ALL INVARIANTS PASS` |
| 收尾态 | 最后又 `reset self` → `up` → `demo:all`（0 / 0 / 0，35/35、5/5）→ `verify:coa`（0，105 户 ≥ 0） | | 栈留在 reset + up + demo:all 之后 |

首次 `demo:all` 没有碰到 FDO/#35 偶发，无需重跑。

## 4. e2e

时钟：全部在 **UTC 02:24–02:29（迪拜 06:24–06:29）** 跑，在 20:00–24:00 UTC 窗口之外，没有用拨钟配置（基线 §4）跑这四个文件。附加：新 e2e 的外部余额 `cutoffDate` 取引擎自己的 `toBusinessDate(CUTOFF)`（不用 UTC 日期），所以它本身不吃窗口效应——另在进程内 `Date` +18h 垫片（scratch，不入库；配方同基线 §4，方向相反：UTC 02:2x → 20:2x）下对照跑：`recon-internal-delta` 绿，同一次跑里的 `recon-reattribution` A、B 两例按基线记载的签名（`expect(run1.status).toBe('BREAK')` 收到 `"PASS"`）红。垫片只改进程内 Date（基线 §4 的边界同样适用）。

栈准备：`reset self` → `up` → `demo:setup`（0/0/0）。

| 命令 | 退出码 | 结果 |
|---|---|---|
| `bash scripts/on-stack.sh self test:e2e --runInBand test/recon-internal-delta.e2e-spec.ts` | 0 | `Tests: 2 passed, 2 total`（主场景 2049 ms + 认损场景 1019 ms；本文件先只有主场景时首跑也是绿） |
| `… test:e2e --runInBand test/recon-internal-delta.e2e-spec.ts test/recon-adjustment-money-arcs.e2e-spec.ts test/recon-reattribution.e2e-spec.ts test/recon-internal-transfer.e2e-spec.ts`（终版，UTC 02:34） | 1 | `Test Suites: 2 failed, 2 passed, 4 total` / `Tests: 2 failed, 21 passed, 23 total`（加认损场景前的同命令：`2 failed, 20 passed, 22 total`，失败两名相同）。失败两名，逐字在基线 §2.1：`Recon adjustment money arcs (e2e, Task 8) › 9. 平账闭环（真实形状）…`（`run1.status` 收到 `"PASS"`——夹具用 `${PAST_DATE}T23:59:59.999Z` 当截止、而引擎按迪拜日取外部余额，错一天，与时钟无关的老债）、`Recon internal transfer e2e (平账二期, Task 9) › B · 退汇余额不足…`（`AGREEMENT_NOT_ACCEPTED`）。`recon-reattribution` 2/2 绿 |
| 顺带：`… test:e2e --runInBand test/recon-supplement.e2e-spec.ts test/recon-aging-write-off.e2e-spec.ts test/incident-register.e2e-spec.ts` | 1 | `Tests: 5 failed, 13 passed, 18 total`。5 名都在基线 §2.1：supplement ②、③、拒绝路径（`AGREEMENT_NOT_ACCEPTED`）、aging 主链路（`Expected …T23:59:59.999Z / Received …T19:59:59.999Z`，基线记的时区老债）、incident-register 9（`AGREEMENT_NOT_ACCEPTED`）。T7b 改写的 incident-register 5 与 aging 反例③ 等 13 例绿——这三个文件都驱动对账引擎、其夹具若有对内不平会被新第 0 条抓出来，没有。 |

新 e2e 的断言面（`test/recon-internal-delta.e2e-spec.ts`，一条顺序场景）：
- 先自证夹具干净：造数前一轮对账 A、B 都是 MATCHED、`internalDeltaAmount = 0`、不开案；
- 造数（裁定 18，同本跨客户）：`executeTransfer` 借 1·A 钱包现金 / 贷 100·B 客户应付（同一 AED 账本；`sourceType/eventCode = E2E_INTERNAL_DELTA`）。外部侧照现金户做（A 外部余额 = 造数后现金 + 一条同单号外部入账行；B 现金没动），**对外差额恒 0**，开案的唯一成因是对内差额；
- 第 1 轮：`status = BREAK`；A、B 各一张 OPEN / BREAK 案，`deltaAmount = 0`，`internalDeltaAmount = +Y / −Y`；各恰有一条 `INVARIANT` 行（`internalAmount = Y` 绝对值，A 方向 IN / B 方向 OUT，外部侧与 `internalSourceId` 全空，`status = OPEN`、`resolution = null`）；快照行带同值；`getRun().accountStatusTable[].internalDelta` 与 `getCase().internalDeltaAmount / lineItems` 下发；`flowComparison` 无任何带处置菜单的行；
- 第 2 轮：A 外部再多 5 → **同一案**复观察：`deltaAmount = 5` 且 `internalDeltaAmount = Y`（两种差额并存），行不累积（仍只一条 INVARIANT）；B 案不变；
- 精确反向（借 100·B / 贷 1·A）+ A 外部侧同步（一条 OUT 行 + 外部余额回铺底额）→ 第 3 轮：两案 `RESOLVED / AUTO_HEALED / closedByRunId = 本轮`，快照 A、B 都 `MATCHED`、`internalDeltaAmount = 0`；
- `finally`：断言中途红了也补一笔反向，不把不平的账留在共用库里。

第二条场景「认损之后」（短缺待补项的真栈证据）：新客户 + 新钱包铺底 X（外部配平）→ 一轮 MATCHED；再记**码 91 的形状**（借 2·本钱包 / 贷 1·本钱包，`TB_TRANSFER_CODES.CLIENT_SHORTFALL_RECOGNIZED`，夹具 eventCode `E2E_SHORTFALL_RECOGNIZED`）金额 S；外部侧配一条同单号 OUT 行并把外部余额同步少 S（只为把对外差额与流水异常压到 0，隔离出「算式里有没有短缺这一项」）→ 断言快照 `internalTotal = X−S`、`internalDeltaAmount = 0`、`deltaAmount = 0`、`bucket = MATCHED`、无开案。丢掉短缺项会读成 `(X−S) − X = −S`（M4 实测 `Received: "-25000"`）。

与 controller 原话的两处出入：① 用**全新**客户 / 钱包（`makeCustomer` + `ensureForWallet`），不挑种子客户——引擎是全局 `run()`，种子钱包会被别的 spec 并发改动，且外部余额要逐钱包铺（同 `recon-reattribution` 的既有做法，也是它头注释论证过的）；② 「A、B 外部余额等于造数前现金」放不住——造数后 A 的现金确实 +Y，外部对账单要同步 +Y（并配一条同单号行）才能让对外差额为 0，所以 A 的外部余额取**造数后**现金。

## 5. 失效验证（变异，改完即还原；还原用 scratchpad 备份 `diff -q` 确认字节一致）

每行 = 「单元（`engine/v2` 目录 + `wallet-recon-run.service.spec.ts`，96 例）/ 新 e2e」。

| # | 变异 | 单元 | 新 e2e | 红在哪 |
|---|---|---|---|---|
| M1 | 删分桶第 0 条（`bucket-classifier.ts`） | 红：`9 failed, 87 passed` | **红** | e2e `run1.status` 期望 `BREAK` 收到 `PASS`（`:267`）；单元：4 个第 0 条用例 + 720 网格 + run-service 对内系列 |
| M2 | 对内差额算式里把应付乘 0（丢应付） | 红：`8 failed` | **红** | `internal.total…` 等；e2e 造数前的「夹具干净」自证就红（A 现金 − 暂扣 ≠ 0） |
| M3 | 不写 INVARIANT 行（`if (false && …)`） | 红：`3 failed` | **红** | e2e `expect(invA).toHaveLength(1)` 收到 0 |
| M4 | 对内差额算式里把短缺待补乘 0（丢短缺） | 红：`3 failed`（四户求和 / 现金多于账面 / 短缺待补进算式） | 主场景绿（夹具里没有码 2 流水，抓不到）；**加了第二条「认损之后」场景后红** | 第二场景 `snap.internalDeltaAmount` 期望 `"0"` 收到 `"-25000"`（`:401`）。曾先验过 T7b 的 `recon-internal-transfer` + `incident-register` 两个 e2e：M4 下失败名与对照完全相同（`2 failed, 16 passed`，都是基线名）——即 T7b 的 e2e **抓不到**短缺项，所以才补第二场景 |

红色首发状态（TDD）：先写 checker / classifier 两份 spec（检查器 spec 整体重写为真实 `AccountingService`），在实现前跑：`Test Suites: 2 failed`（TS2353 / TS2339：`internalDelta` 不在类型里；构造函数多一个参数）——**编译级红**，不是行为级；行为级的红由上表变异补证。

## 6. 没覆盖

- `scripts/recon-demo.ts`、匹配器第 0 轮锚配对等 T9b 全部项按分工未碰。
- 码 91 形状的 e2e 夹具是**直接 `executeTransfer`**，不走认损补缺单 / 划转单工作流；它验的是「算式里有短缺项」，不是认损补缺的业务链（那是 T7b 的 e2e）。认损那条 91 流水在对账里是否被第 0 轮配成 MATCHED 是 T9b 的事——本场景靠外部侧配一条 OUT 行绕开了它（上文已说明）。
- 案件页 / 跑批页 / 看板渲染是 T10；admin-web 零改动（`AccountStatusRow` 的 admin 侧类型未加 `internalDelta`）。
- `doc-final/PRODUCTION-NOTES.md`「对内不平无业务修法」一行与各 modules 文档是 T11 的活。
- 全量 e2e 冷缓存对照（T12）未跑；本任务只跑了 controller 点名的四个文件 + 三个同样驱动引擎的对账文件。
