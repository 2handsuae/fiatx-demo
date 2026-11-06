# 戊波二 T2 · 转账码 88–91 + 应收 LP 接线 — 证据

> 代码头：T1 之后（`f6796066`）的工作树上，本任务那一笔提交。栈 = `self`（`.stackports` 3110–3113）；所有命令在 worktree 根跑，前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`，jest 前 `set -a; . ./.env; set +a`。

## 1. TDD：先红后绿

| 步 | 命令 | 退出码 | 关键行 |
|---|---|---|---|
| 红（单测，实现前） | `npx jest src/modules/asset-treasury/lp-desk/lp-exchange-workflow.service.spec.ts` | 1 | `Tests: 3 failed, 51 passed, 54 total`——三个失败名：卖出腿确认「84 + 88」、「88 被 TB 拒 → 整步失败」、交货「85 贷 51」 |
| 红（单测，registry） | `npx jest src/modules/accounting/tigerbeetle/tb-account-registry.service.spec.ts` | 1 | `Tests: 1 failed, 12 passed, 13 total`（LP 行 `ownerName`） |
| 绿（实现后，两支同跑） | `npx jest …/tb-account-registry.service.spec.ts …/lp-exchange-workflow.service.spec.ts` | 0 | `Test Suites: 2 passed` ｜ `Tests: 67 passed, 67 total` |
| 红（e2e，**把 workflow 临时还原成 HEAD 版**，其余改动都在） | `bash scripts/on-stack.sh self test:e2e --runInBand test/lp-receivable.e2e-spec.ts` | 1 | `Tests: 3 failed, 2 passed, 5 total`；批准+卖出腿确认那一例 `Expected: 13600000000n  Received: 0n`（51 没挂应收）；验收那一例 `Expected length: 4  Received length: 3`（凭证只有 PAY / RECEIVE / ACCEPT 三笔，85 仍是 `A.FIRM_CASH>E.FIRM_EQUITY`）。还原后 `git diff --stat` 与还原前同为 `32 insertions, 8 deletions` |
| 绿（e2e，实现后） | 同命令 | 0 | `Tests: 5 passed, 5 total`（共跑三次：栈上有旧单时一次、`demo:all` 之后一次真文件、一次带临时 `console.log` 的副本——副本跑完即删，见 §3） |

## 2. 闸门

| 闸 | 命令 | 退出码 | 输出 |
|---|---|---|---|
| ① 后端 | `npx tsc --noEmit -p tsconfig.json` | 0 | 零输出 |
| ② 管理台 | `cd admin-web && npx tsc -b --noEmit` | 0 | 零输出 |
| ③ 客户端 | `cd client-web && npx tsc -b --noEmit` | 0 | 零输出 |
| ④ 相关 jest | `npx jest src/modules/accounting src/modules/asset-treasury src/modules/clearing-settle` | 0 | `Test Suites: 70 passed, 70 total` ｜ `Tests: 1461 passed, 1461 total`（T1 为 1459；+2 = workflow spec 新增「88 被 TB 拒 → 整步失败」一例 + registry spec 新增 LP `ownerName` 一例；改写的两例不增数） |
| ⑧ 重铺 | `bash scripts/stack.sh reset self` → `bash scripts/stack.sh up` | 0 / 0 | 种子日志 `✔ LP exchange evidence: 4 evidence row(s) + 8 flow row(s)` |
| `verify:coa`（种子态） | `bash scripts/on-stack.sh self verify:coa` | 0 | 四条恒等 ✓ ｜ `负余额检查 通过 (81 个科目全部 ≥ 0)` |
| `demo:all` | `bash scripts/on-stack.sh self demo:all` | 0 | `花名册：35/35 符合预期` ｜ `asserts: 5/5 PASS` ｜ `demo:all DONE ✅` |
| `verify:coa`（demo:all 后） | 同上 | 0 | 四条恒等 ✓ ｜ `负余额检查 通过 (105 个科目全部 ≥ 0)` |
| `verify:coa`（两次 e2e 之后） | 同上 | 0 | `109 个科目全部 ≥ 0`（= 105 + 两个夹具 LP × AED/USDT 各一户）——证明走完整条弧后天平仍成立 |
| 收尾 | `reset self` → `up` → `demo:all` → `verify:coa` | 0 / 0 / 0 / 0 | 35/35、5/5、105 户全 ≥ 0——栈最终停在这个状态 |

## 3. 种子：四腿、期末 51 = 0（只读查询 TB）

`REPO=$PWD node <scratchpad>/q51.js`（只读 `tbAccountRegistry` + TB `lookupAccounts` + `tbTransferEvidence`）在**收尾重铺 + demo:all 后**的输出（Falcon AED 与 Dune 两币种各一行，此处合并书写）：

```
51 LPP2601010183 USDT debits=13600000000 credits=13600000000 net=0 | Due from LP · Falcon Liquidity FZE
51 LPP2601010183 AED  debits=0 credits=0 net=0 | Due from LP · Falcon Liquidity FZE
51 LPP2601017193 AED/USDT debits=0 credits=0 net=0 | Due from LP · Dune OTC DMCC
evidence LPX2601016429 LP_EXCHANGE_PAY        E.FIRM_EQUITY>A.FIRM_CASH       5000000      AED   at …T22:11:40.456Z (executedAt)
evidence LPX2601016429 LP_EXCHANGE_RECEIVABLE A.LP_RECEIVABLE>E.FIRM_EQUITY   13600000000  USDT  at …T22:11:40.456Z (executedAt)
evidence LPX2601016429 LP_EXCHANGE_RECEIVE    A.FIRM_CASH>A.LP_RECEIVABLE     13600000000  USDT  at …T22:11:40.456Z + 1 天 (deliveredAt)
evidence LPX2601016429 LP_EXCHANGE_ACCEPT     A.FIRM_CASH>A.FIRM_CASH         13600000000  USDT  at …T22:11:40.456Z + 2 天 (settledAt)
```

四笔顺序 84 → 88 → 85 → 86；Falcon USDT 应收借 13,600 / 贷 13,600，净额 0。

## 4. e2e 的 TigerBeetle 余额前后（`demo:all` 之后的栈；单位 = 账户最小单位，AED 2 位、USDT 6 位；借方户取借−贷、贷方户取贷−借）

夹具 LP（`ensureForLp` 开出 51·AED / 51·USDT 两户）；兑换 50,000 AED → 13,600 USDT；表中为 `snapshot()` 取自 TB 的实值（`TRACE` 副本输出，副本跑完已删）：

| 账户 | 开单前 | 批准 + 卖出腿确认后（84 + 88） | 交货后（85） | 验收后（86） |
|---|---|---|---|---|
| 51·该 LP USDT | 0 | **13,600,000,000** | **0** | 0 |
| 51·该 LP AED | 0 | 0 | 0 | 0 |
| 200 AED | 94,858,935 | 89,858,935（**−5,000,000** = −50,000.00） | 同左 | 同左 |
| 200 USDT | 113,999,428,189 | 127,599,428,189（**+13,600,000,000**） | 同左（85 不再碰权益） | 同左 |
| 50·F_OPS AED | 94,608,935 | 89,608,935（−5,000,000） | 同左 | 同左 |
| 50·F_LIQ USDT | 0 | 0 | **13,600,000,000** | 0 |
| 50·F_OPS USDT | 113,999,428,189 | 同左 | 同左 | **127,599,428,189**（+13,600,000,000） |

每步另按 `tbTransferEvidence`（`sourceType=LP_EXCHANGE`、`sourceNo=<兑换单号>`）核对借贷码集合：
批准后 `LP_EXCHANGE_PAY:E.FIRM_EQUITY>A.FIRM_CASH` + `LP_EXCHANGE_RECEIVABLE:A.LP_RECEIVABLE>E.FIRM_EQUITY`；交货后多 `LP_EXCHANGE_RECEIVE:A.FIRM_CASH>A.LP_RECEIVABLE`；验收后共 4 笔。

端点：`TbAdminController.findAccounts('0','100',undefined,'LP','51')`（= `GET /admin/tb/accounts?ownerType=LP&code=51&take=100` 的控制器方法）返回夹具 LP 的两行，`ownerName` = 夹具 LP 名称，`assetCode` = AED / USDT，交货后 `balance` = `'0'`；种子的 Falcon / Dune 行同样带各自名称。

## 5. 说明

- **失效验证（R8）**：e2e 的「会红」由 §1 第四行证明——把 workflow 还原成改前版，同一支 e2e 当场红在 `Received: 0n` 与凭证数 3；单测由三个失败名证明。88 的金额来源（买入合同数而非卖出数）靠单测里卖出 20,000 USDT / 买入 73,280 AED 两个不同的数钉住（`amount: 7_328_000n`、`ledger: AED`）。
- **没覆盖**：88 被 TB 拒时 84 已记（同一步两笔、没有补偿，与项目纪律「记账失败即流程失败、不做补偿」一致）——单测断言了「整步失败：不 CLEAR、不翻状态、审计 POSTING_FAILED」，没有在真栈上造 TB 拒绝。
- **89 / 90 / 91**：本任务只定常量与注释（借贷与时刻见 `tb-transfer-codes.constant.ts`），无过账代码，也无引用点；T5 / T7 过账。
- 夹具 LP 用 prisma 直造（ACTIVE 档案 + ACTIVE 的 AED 打款地址）后调 `ensureForLp`，没走档案审批；每次 e2e 都会新建一个 LP + 一张兑换单留在库里（自栈每轮重铺清掉）。
