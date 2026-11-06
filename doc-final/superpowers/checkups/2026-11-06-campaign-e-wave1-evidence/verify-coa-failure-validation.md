# verify:coa 新天平 · 失效验证（戊波一 Task 3）

纪律 2：报绿之前先确认这个检查真的会红。`verify:coa` 改成按钱包求和的新天平（客户本 `Σ(1) == Σ(100)+Σ(101)`；公司本 `Σ(50)+Σ(300..302) == Σ(200)+Σ(210..212)`，逐币种）后，在 self 栈上手工跨本记一笔，看它红不红，再冲回看它绿不绿。

栈：`claude/campaign-e-wave1-4a558e` 的 self 栈（TB `127.0.0.1:3103`，库 `/tmp/exchange_js_wt_campaign_e_wave1_4a558e/dev.db`）。库状态：`stack.sh reset self` → `stack.sh up` 之后只有种子记过账（未跑 demo:all）。

## 1. 基线：种子记完，新天平全绿

```
$ bash scripts/on-stack.sh self verify:coa        # exit 0
✓ ledger 1 CLIENT 恒等 4495000          (AED 44,950.00 = Henry)
✓ ledger 1 FIRM 恒等 95000000           (AED 950,000.00)
✓ ledger 2 CLIENT 恒等 2709049000       (USDT 2,709.049000 = Henry)
✓ ledger 2 FIRM 恒等 113600000000       (USDT 113,600.000000)
✓ 负余额检查 通过 (75 个科目全部 ≥ 0)
ALL INVARIANTS PASS
```

75 个科目 = 7 个公司钱包现金户 + 2 个 Henry 钱包现金户 + 其余系统户 / 客户户。

## 2. 跨本误记一笔：借 客户现金·Henry vIBAN ／ 贷 FIRM_EQUITY（AED 1,000.00）

一次性脚本（`scripts/_tmp-cross-book.ts`，用后即删、未入库）走真实记账入口：

```ts
const cashId   = await accounting.resolveCashAccountId(henryVibanWallet.id, TB_LEDGERS.AED);
const equityId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.FIRM_EQUITY, ledger: TB_LEDGERS.AED, ownerType: 'SYSTEM' });
await accounting.executeTransfer({ debitAccountId: cashId, creditAccountId: equityId, amount: 100000n /* 1,000.00 */,
  ledger: TB_LEDGERS.AED, code: TB_TRANSFER_CODES.CAPITAL_INJECTION, evidence: { /* 凭证字段 */ } });
```

```
$ ts-node scripts/_tmp-cross-book.ts mispost       # exit 0（转账本身合法：借方户加借、贷方户加贷，不触发非负标志）
OK mispost: DR 客户现金·Henry vIBAN / CR FIRM_EQUITY AED 1000.00

$ bash scripts/on-stack.sh self verify:coa         # exit 1   ← 红
✗ ledger 1 CLIENT: Σ(1)=4595000 Σ(100)+Σ(101)=4495000
✗ ledger 1 FIRM: Σ(50)+Σ(300..302)=95000000 Σ(200)+Σ(210..212)=95100000
✓ ledger 2 CLIENT 恒等 2709049000
✓ ledger 2 FIRM 恒等 113600000000
✓ 负余额检查 通过 (75 个科目全部 ≥ 0)
FAIL: 2 invariant breaks
```

两本都红、且只红被误记的那个币种（AED，ledger 1）；USDT 两条不受影响。差额恰为 100000（1,000.00）。

## 3. 反向冲回：借 FIRM_EQUITY ／ 贷 客户现金·Henry vIBAN

```
$ ts-node scripts/_tmp-cross-book.ts reverse       # exit 0
OK reverse: DR FIRM_EQUITY / CR 客户现金·Henry vIBAN AED 1000.00

$ bash scripts/on-stack.sh self verify:coa         # exit 0   ← 回绿
✓ ledger 1 CLIENT 恒等 4495000
✓ ledger 1 FIRM 恒等 95000000
✓ ledger 2 CLIENT 恒等 2709049000
✓ ledger 2 FIRM 恒等 113600000000
✓ 负余额检查 通过 (75 个科目全部 ≥ 0)
ALL INVARIANTS PASS
```

## 4. 同轮顺带做的其它失效验证

| 检查 | 变异 | 结果 |
|---|---|---|
| `test/ledger-flags.e2e-spec.ts`（T2 写、本任务首跑） | 无变异，重铺 → `demo:setup` → 跑 | `bash scripts/on-stack.sh self test:e2e --runInBand test/ledger-flags.e2e-spec.ts` exit 0，`Tests: 3 passed, 3 total` |
| 同上 | 临时把 `ensureWalletCashAccount` 的现金户标志位改成 0（`const flags = 0`），重铺 → `demo:setup` → 跑 | exit 1，`✕ 借方户（现金 1）：贷记超过借方余额 → TB 拒绝（exceeds_debits）…`，`Received promise resolved instead of rejected`，`Tests: 1 failed, 2 passed`；已还原，`git diff prisma/seed-tb.helper.ts` 为空 |
| `verify:demo-data` R5（Henry 两钱包有 `CUSTOMER_DEPOSIT_ADDRESS_SEEDED` 审计，actor `DEMO_SEED`） | 直接改库把 Henry 的 C_DEP 钱包号换成一个没有审计的号 | exit 1，`[R5] WA9999999999: no CUSTOMER_DEPOSIT_ADDRESS_SEEDED audit row (actorNo=DEMO_SEED …) for live wallet`；该库随即重铺丢弃 |

## 5. 边界

- 负余额那一段（`isDebitNormalCode` 判符号）现在基本不会自己红：带非负标志位的账户被 TigerBeetle 在写入时就拒绝（上表 e2e 证明）。它留作第二道网，本验证没有单独把它弄红。
- 本验证用的是误记一笔「客户现金 ↔ FIRM_EQUITY」这一类跨本错账；其它错账形态（只动一本的凭空造余额等）由两本各自的恒等式 + 标志位覆盖，未逐一构造。
- 此刻 `demo:all` 预期为红（七单的记账调用点还指向已不开户的聚合户，T4–T7 接线）；本验证只证明「种子记账 + 新天平」这一段。
