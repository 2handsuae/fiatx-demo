# e2e 对照（AFTER）— 戊波二 T12，代码头 `8b40965d`

> 对照物：`e2e-baseline-0c6eb7b0.md` §2.1 的 **B 集（22 名）**。协议同波一：冷缓存、串行、干净重铺 + 7 个私库 + `demo:setup`；失败名集合 ⊆ B 集 ∪ 已登记连带；多出的名字干净重铺单跑，绿 = 偶发 / 顺序，红 = 停手报告。

## 一句话结论

1. **全量（冷缓存串行）= `Test Suites: 10 failed, 21 passed, 31 total` / `Tests: 24 failed, 173 passed, 197 total`**（jest `Time: 144.378 s`，exit 1）。比 B 轮（9 / 27 套件、22 / 175 例）多 **4 个新套件**（本波新增的 4 个 e2e 文件）、**22 个新例**（4 个新文件 5 + 5 + 8 + 2 = 20 例，加 `recon-internal-transfer` 由 6 个 `it` 变 8 个的 2 例；按 `grep -cE "^\s*(it|test)\("` 对 `0c6eb7b0` 与 HEAD 的文件数得，`vendor-payment-from-wallet` 的 `it.each` 另计 2）、**多 2 个红名**。
2. 24 个红名 = **B 集 22 名一名不少、一名不多** + **2 个不在 B 集的名字**——`vendor-onboarding ①`（已知偶发）与 `customer-restrictions ⑤`（新见偶发）。**两个都干净重铺单跑，该例绿**（§3），按「顺序 / 偶发」记，不作回归。
3. 本波新增的 4 个 e2e 文件全绿：`lp-receivable`、`vendor-payment-from-wallet`、`house-transfer`、`recon-internal-delta`（全量里均为 `PASS`）。被本波改写的 `recon-internal-transfer`（A / C1 / C2 / P2）、`incident-register`（用例 5）、`recon-aging-write-off`（反例 ③）、`recon-adjustment-money-arcs`、`recon-reattribution` 里，红的只有 B 集里原本就红的名字（§2）。

## 1. 命令与退出码（均在 worktree 根；每条前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`）

**时钟**：开跑前 `date -u` = **2026-11-07 05:48 UTC（迪拜 09:48）**，全量 05:55:15–05:59:47 UTC，两次单跑 06:01–06:07 UTC，全部在 UTC 20:00–24:00 窗口之外——**没用拨钟配置**（T0 的「recipe 依赖 `test/jest-e2e.json` 形状」那条因此没有用到，也没复核）。

| 步骤 | 命令 | 退出码 |
|---|---|---|
| 重铺 | `bash scripts/stack.sh reset self` | 0 |
| 起栈 | `bash scripts/stack.sh up` | 0 |
| 7 个私库（先 `rm -f`；`e2e-{kyt-verdict-landing,sanction-subject-split,deposit-verdicts,material-requests,customer-restrictions,sla,aml-reporting-family}.db`） | `DATABASE_URL=file:<库> npx prisma migrate deploy` / `… npm run db:base:sync` / `… TB_ADDRESS=127.0.0.1:3113 FILE_STORAGE_DIR=<栈 files 目录> npm run db:biz:init` | 0 / 0 / **1（×7）**——已知债（`TOOLING-DEBT.md` 私库条），与 T0 一致 |
| 建 demo 基础 | `bash scripts/on-stack.sh self demo:setup` | 0 |
| **全量** | `bash scripts/on-stack.sh self test:e2e --runInBand --cacheDirectory=<新空目录>`（输出进日志文件，`$?` 直接取，无管道） | **1**（有红，预期） |
| 单跑 1 | 同上整套前置序列，`… test:e2e --runInBand --cacheDirectory=<新空目录> test/customer-restrictions.e2e-spec.ts` | 1（② ⑥ 红 = B 集；⑤ 绿） |
| 单跑 2 | 同上整套前置序列，`… test/vendor-onboarding.e2e-spec.ts` | **0**（2 / 2 绿） |

数据：`demo-roster` 跑完没有把 `doc-final/demo/data.md` 生成区写脏（`git status` 无 data.md），故无需 `git checkout`。

## 2. 失败名集合与 B 集的比对

比对口径同 T0 / 波一：失败名去重后按前 70 字符前缀对 B 集 22 名（🎯 的乱码归一）。命令：从 jest 日志「Summary of all failing tests」抽 `  ● ` 行 → 与 `e2e-baseline-0c6eb7b0.md` §2.1 代码块逐名比。结果：

- `baseline names no longer red: []`——B 集 22 名一名不少；
- `current names not in B:` 恰 **2 名**（下面标 ← 的两行）；
- 即 **失败集合 = B 集 22 名 ∪ {customer-restrictions ⑤, vendor-onboarding ①}**。

```
Customer lifecycle restrictions (e2e, Task 14) › ② 零痕迹：SANCTION 客户与正常客户的 /onboarding/me、/client/me/restrictions、/deposit-transactions/my 归一化后逐字节相等
Customer lifecycle restrictions (e2e, Task 14) › ⑤ 三域各一笔在途单 → 贴 SANCTION（scope=ALL）→ 充值/提现/兑换均被冻结   ← 不在 B 集
Customer lifecycle restrictions (e2e, Task 14) › ⑥ 贴 MATERIAL_EXPIRED（WITHDRAW+SWAP）→ 三笔在途单状态一律不变
Deposit/swap/withdraw roster (e2e, Task C2 + C3) › verifyEndState — 花名册比对（Task C4） › 某笔单没到预期状态 → 断言失败并指名道姓
Deposit/swap/withdraw roster (e2e, Task C2 + C3) › verifyEndState — 花名册比对（Task C4） › 🎯 跑过 demo:in-transit 之后再跑 verifyEndState，仍然全绿
Deposit/swap/withdraw roster (e2e, Task C2 + C3) › 充值 11 笔全部落到花名册预期状态
Deposit/swap/withdraw roster (e2e, Task C2 + C3) › 兑换 3 笔 + 提现 7 笔全部落到花名册预期状态
Deposit/swap/withdraw roster (e2e, Task C2 + C3) › 在途单由 runWithdraws 产出，不再需要单独跑 demo:in-transit
Incident register e2e (平账三期 · 事故登记, Task 13) › 9 · CLIENT_SHORTFALL：带垫款单号登记 → 锚定校验（purpose==='CLIENT_ADVANCE'）
Recon adjustment money arcs (e2e, Task 8) › 9. 平账闭环（真实形状）：昨天的破口 + 真实"我有外无"差异行 → 今天开单回填 → 重跑 → 差额归零、差异行标已解释、桶回 MATCHED、case 自愈
Recon case aging → write-off e2e (平账 A 批, Task 12) › 主链路：查无果 → 拨钟 → 扫描超期（留痕）→ 金库开核销单 → CFO 批 → 落账（借对账核销损失/贷公司现金·案子钱包 7）→ 重对账 RESOLVED
Recon internal transfer e2e (平账二期, Task 9) › B · 退汇余额不足：读面给 ADVANCE → 认领 400 指路 → 垫款两腿（81 / 82+83）→ 可用够扣 → 认领退汇 CLAWED_BACK → 愈
Recon supplement e2e (平账 B 批, Task 8) › ② 退汇：SUCCESS 充值 1200 AED → 银行扣回 → 定性 → 发起（候选含原单）→ CFO 批 → CLAWED_BACK，借应付贷客户现金，余额减 → 重跑愈
Recon supplement e2e (平账 B 批, Task 8) › ③ 退回：SUCCESS 提现 → 银行退回 → 定性 → 发起 → CFO 批 → RETURNED，借客户现金贷应付，余额加、手续费不退 → 重跑愈
Recon supplement e2e (平账 B 批, Task 8) › 拒绝路径：方向不符 400；余额不足 400；同一行仍待决时二次发起 400，CFO 拒绝后可再发起（复用同一信号）；② 拒绝后原状态不动、supplementNo 清空、可再发起
Swap Sumsub verdict buttons (e2e, Task 12) › sticky hard-line silences a later, otherwise-soft-line verdict（V7 制裁后送达的 V2：单已被客户级冻结广播冻住,裁决被幂等闸吞,沉默依旧零材料请求）
Swap Sumsub verdict buttons (e2e, Task 12) › ① approved: COMPLIANCE_PENDING → PROCESSING, leg1 booked
Swap Sumsub verdict buttons (e2e, Task 12) › ② awaiting user（下发认证）: REJECTED, zero legs, no restriction opened, material request issued (2026-09-14: soft line no longer stamps a 便签)
Swap Sumsub verdict buttons (e2e, Task 12) › ② awaiting user（我方等同拒绝）: REJECTED, no restriction opened, material request issued (ext-3, 2026-09-14: soft line no longer stamps a 便签)
Swap Sumsub verdict buttons (e2e, Task 12) › ⑥ on hold（我方等同拒绝）: REJECTED, no material request issued
Swap Sumsub verdict buttons (e2e, Task 12) › ⑦ rejected · Sanctions: FROZEN, sticky hard-line set, no material request issued (tipping-off)
Swap Sumsub verdict buttons (e2e, Task 12) › ⑪ rejected · no disposition tag: REJECTED, no material request issued, no sticky hard-line
Swap money arcs (e2e, Task 12) › 2. THE HEADLINE PROPERTY（站3·出生锁版）— KYT rejected swap: 圈全擦、余额复原、零落笔零单据, quote consumed, restrictions block SWAP/WITHDRAW but not DEPOSIT
Vendor onboarding VARA notification gate e2e (甲波六 · T7) › ① 重大服务商：批准 → 待报备 + 自动开告知单盖章 → 告知单走到「已报送」→ ACTIVE → 终止再开一张告知单且不认领   ← 不在 B 集
```

**逐例原因（读自全量日志，按类对 T0 文档的原因类别）**：13 例 `AGREEMENT_NOT_ACCEPTED`（recon-internal-transfer B 1、recon-supplement ②③+拒绝路径 3、incident-register 9 一例、swap-sumsub-scenarios 7、customer-restrictions ⑥ 1）｜`recon-aging` 主链路 `slaDeadline` `23:59` vs `19:59`（时区）｜`swap-money-arc` 用例 2 深比较｜`customer-restrictions` ② 深比较（`/deposit-transactions/my`）｜`demo-roster` 5 例（充值 11 笔 `deposit reaches CONFISCATED` 15 s 超时；`TigerBeetle pending transfer rejected … status 54`；`depositResults is not iterable` / `reading 'find'` 连带）｜`recon-adjustment` 用例 9 `Expected "BREAK" / Received "PASS"`。**边界**：用例 9 在 T0 文档里只给了名字、没记失败签名，所以它与基线是**名字级**一致，签名级没有对照；其余各类的签名与 T0 §2.1 / 波一文档的原因类别一致。

**不在 B 集的两名**：
- `vendor-onboarding ①`：期望五条审计、收到四条（`VENDOR_ACTIVATED` 晚于状态落库），与 T0 A 轮同一签名；T0 文档、波一文档都记过这是偶发。**单跑 2 绿**（§3）。
- `customer-restrictions ⑤`：`test/customer-restrictions.e2e-spec.ts:526` `expect(count).toBeGreaterThan(0)` 收到 0——用例先 `waitUntil(兑换单 status === FROZEN)`、随后一次性数 `SWAP_FROZEN` 审计行，不轮询（读早型，同 `deposit-money-arcs` 用例 1 那条已登记的债）。T0 的 A、B 两轮该例都绿；本次全量红一次，**单跑 1 绿**（§3）。已登记 `TOOLING-DEBT.md`（见该条；归因是推断，没有跟踪被测代码里状态与审计的写入先后）。

## 3. 多出名字的单跑复核（干净重铺）

| 文件 | 序列 | 退出码 | 结果 |
|---|---|---|---|
| `test/customer-restrictions.e2e-spec.ts` | `reset self` → `up` → 7 私库 → `demo:setup` → 单文件（冷缓存目录） | 1 | `Tests: 2 failed, 4 passed, 6 total`：✓ ① ③ ④ **⑤** ；✕ ② ⑥——**红的恰是 B 集里这个文件的两名**；⑤ 绿 ⇒ 全量里那次是偶发 |
| `test/vendor-onboarding.e2e-spec.ts` | 同上 | 0 | `Tests: 2 passed, 2 total` ✓ ① ② ⇒ 偶发 |

## 4. 点名风险：公司调拨单 e2e ⑥ 留下的卡单

`house-transfer.e2e-spec.ts` 用例 ⑥ 故意让第二笔 89 被 TB 拒，留下一张 **EXECUTING / `POSTING_FAILED`** 的调拨单与一条 CONFIRMED 的腿（其对账单行没有 89 的码）。全量里 `house-transfer` 排在第 11 位；`grep -lE "WalletReconRunService|reconRun|recon-run" test/*.e2e-spec.ts` 命中 7 个调对账跑批的套件，其中排在它**之后**的只有 `recon-internal-delta`（第 18 位），它 `PASS`；其余 6 个都排在它之前（第 1–10 位）。在它之后红的套件（swap-sumsub、swap-money-arc、customer-restrictions、vendor-onboarding、demo-roster）不调对账跑批，红的名字都在 B 集或已单跑复核。全量跑完后 `house_transfers` 表：SUCCESS ×6、REJECTED ×1、CANCELLED ×1、EXECUTING ×1（`POSTING_FAILED`）。**反向探针（把顺序钉死）**：干净重铺 + 7 私库 + `demo:setup` 后，先单跑 `test/house-transfer.e2e-spec.ts`（exit 0，`8 passed`；查 `house_transfers` 得 `EXECUTING | POSTING_FAILED` 一张卡单在库里），**再**跑 `test:e2e --runInBand --cacheDirectory=<新目录> test/recon- test/incident-register`（7 个调对账跑批的套件全部排在卡单之后；exit 1，`Test Suites: 5 failed, 2 passed, 7 total` / `Tests: 7 failed, 34 passed, 41 total`）。7 个红名 = B 集里 recon 组的 7 名**逐名一致**（recon-adjustment 9、recon-supplement ②③ 与拒绝路径、recon-internal-transfer B、incident-register 9、recon-aging 主链路；对 B 集做同一个 70 字符前缀比对，两个方向差集都为空）；`recon-internal-delta`、`recon-reattribution` 绿。

**结论：卡单与扫费收入的变化（EXECUTING 单的腿已 CONFIRMED、手续费户收入被动过）没有污染后面的对账套件**——全量顺序与钉死顺序两种排法下都成立；没有出现「只在全量里红」的对账名字。

## 5. 没覆盖

- 全量只跑了一遍（外加两次单跑）；没有三轮取多数，偶发频率（`vendor-onboarding ①` 在 T0 是 1 / 2、本次 1 / 1 全量）没有量化。
- 失败例的原因只逐例读了一遍日志摘要（§2），没有逐例展开栈；`recon-adjustment` 用例 9 的签名级对照缺（见 §2 边界）。
- 没做拨钟配置的对照（真实时钟在窗口外，不需要）。
