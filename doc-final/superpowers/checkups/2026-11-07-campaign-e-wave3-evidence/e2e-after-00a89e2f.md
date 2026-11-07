# e2e 对照（AFTER）— 戊波三 T11a，代码头 `00a89e2f`

> **新基线 20 名（vendor-onboarding ① 记偶发，见上）。** 主会话裁定（第二轮后）：通过条件 = 失败集恰为 20 名，或 20 名 + `vendor-onboarding ①`；两轮全量均满足，别无其他多出 / 缺少的名字。对照物：`../2026-11-07-campaign-e-wave2-evidence/e2e-baseline-0c6eb7b0.md` §2.1 B 集 22 名，减去预期转绿的两名（recon-aging 主链路时区、recon-adjustment 用例 9）= 预期 20 名。

## 一句话结论

**新基线 20 名（`vendor-onboarding ①` 记偶发，见上）**——两轮全量冷缓存串行，失败集都是「预期 20 名一名不少」+ `vendor-onboarding ①`；下面第 1 轮的事实陈述保留原文。

### 偶发名 `vendor-onboarding ①`（与波二 `e2e-after-8b40965d.md` §2、`e2e-baseline-0c6eb7b0.md` §2.2 同款）

- **签名**：`VENDOR_ACTIVATED` 审计行晚于状态落库——期望五条审计（APPLIED / SENT_FOR_APPROVAL / APPROVED / NOTIFICATION_OPENED / ACTIVATED），收到四条（缺 ACTIVATED），`test/vendor-onboarding.e2e-spec.ts:196`（读早型）。
- **干净重铺单跑**：`reset self → up → 7 私库 → demo:setup → test/vendor-onboarding.e2e-spec.ts`（冷缓存）= exit 0，`2 passed`（见 §4）。
- **本波全量红次数：2 / 2**（第 1 轮、第 2 轮都红，且两轮签名相同）。波二同名 1 / 1，波一 1 / 3，故属稳定偶发而非一次性；红在全量、绿在单跑，指向与同次全量里其它套件的时序相关，但本任务没有追根因。

### 第 1 轮事实陈述（原文）

全量冷缓存串行 = `Test Suites: 8 failed, 23 passed, 31 total` / `Tests: 21 failed, 178 passed, 199 total`（jest `Time: 147.136 s`，exit 1）。失败名 21 个 = **预期 20 名一名不少、一名不多** + **1 个不在 B 集的名字 `vendor-onboarding ①`**；该名干净重铺单跑 exit 0（2/2 绿），签名与波二 `e2e-after-8b40965d.md` §2 完全相同（期望五条审计、收到四条，缺 `VENDOR_ACTIVATED`）。「recon-aging 主链路」「recon-adjustment 用例 9」两名确实不在失败集（套件 `recon-aging-write-off`、`recon-adjustment-money-arcs` 在全量里均 PASS）。

## 1. 时钟与命令（均在 worktree 根；每条前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`；Node v20.20.2）

**时钟**：开跑前 `date` = Sun Nov 8 01:16:19 +04 2026，`date -u` = Sat Nov 7 21:16:19 UTC 2026——**在迪拜 00–04 / UTC 20–24 窗口内**（T6 已证夹具与窗口无关；本次 recon 类套件在窗口内全绿，印证）。全量结束 21:18:51 UTC。

| 步骤 | 命令 | 退出码 |
|---|---|---|
| 重铺 | `bash scripts/stack.sh reset self` | 0 |
| 起栈 | `bash scripts/stack.sh up`（API 3120 / Admin 3121 / Client 3122 / TB 3123；库目录 `/tmp/exchange_js_wt_campaign_e_wave3_3aac42/`） | 0 |
| 7 个私库（先 `rm -f`；`e2e-{kyt-verdict-landing,sanction-subject-split,deposit-verdicts,material-requests,customer-restrictions,sla,aml-reporting-family}.db`） | `DATABASE_URL=file:<库> npx prisma migrate deploy` / `… npm run db:base:sync` / `… TB_ADDRESS=127.0.0.1:3123 FILE_STORAGE_DIR=<栈 files 目录> npm run db:biz:init` | 0 / 0 / **1（×7）**——已知债（`TOOLING-DEBT.md` 私库条），与波二一致 |
| 建 demo 基础 | `bash scripts/on-stack.sh self demo:setup` | 0 |
| **全量** | `bash scripts/on-stack.sh self test:e2e --runInBand --cacheDirectory=<新空目录>`（输出进日志文件，`$?` 直接取，无管道） | **1** |
| 单跑 | 同上整套前置序列（含 `reset self`），`… test:e2e --runInBand --cacheDirectory=<新空目录> test/vendor-onboarding.e2e-spec.ts`（21:21 UTC） | **0**（`Tests: 2 passed, 2 total`，① ② 均 ✓） |

收尾：`reset self → up → demo:all`（exit 0 / 0 / 0，asserts 5/5）；`git diff --stat doc-final/demo/data.md` 为空——demo-roster 套件没有把 data.md 写脏，无需 `git checkout`。

| 轮次 | Test Suites | Tests |
|---|---|---|
| 本次全量（窗口内真实时钟） | `8 failed, 23 passed, 31 total` | `21 failed, 178 passed, 199 total` |
| 波二终态（`8b40965d`，窗口外） | `10 failed, 21 passed, 31 total` | `24 failed, 173 passed, 197 total` |

套件数同为 31；Tests 199 vs 197 = 净增 2 例（来源未逐例核对）。失败套件 8：recon-internal-transfer、recon-supplement、incident-register、swap-sumsub-scenarios、swap-money-arc、customer-restrictions、vendor-onboarding、demo-roster。

## 2. 失败名集合（jest 末尾「Summary of all failing tests」逐字，输出序，21 名）

```
Recon internal transfer e2e (平账二期, Task 9) › B · 退汇余额不足：读面给 ADVANCE → 认领 400 指路 → 垫款两腿（81 / 82+83）→ 可用够扣 → 认领退汇 CLAWED_BACK → 愈
Recon supplement e2e (平账 B 批, Task 8) › ② 退汇：SUCCESS 充值 1200 AED → 银行扣回 → 定性 → 发起（候选含原单）→ CFO 批 → CLAWED_BACK，借应付贷客户现金，余额减 → 重跑愈
Recon supplement e2e (平账 B 批, Task 8) › ③ 退回：SUCCESS 提现 → 银行退回 → 定性 → 发起 → CFO 批 → RETURNED，借客户现金贷应付，余额加、手续费不退 → 重跑愈
Recon supplement e2e (平账 B 批, Task 8) › 拒绝路径：方向不符 400；余额不足 400；同一行仍待决时二次发起 400，CFO 拒绝后可再发起（复用同一信号）；② 拒绝后原状态不动、supplementNo 清空、可再发起
Incident register e2e (平账三期 · 事故登记, Task 13) › 9 · CLIENT_SHORTFALL：带垫款单号登记 → 锚定校验（purpose==='CLIENT_ADVANCE'）
Swap Sumsub verdict buttons (e2e, Task 12) › ① approved: COMPLIANCE_PENDING → PROCESSING, leg1 booked
Swap Sumsub verdict buttons (e2e, Task 12) › ② awaiting user（下发认证）: REJECTED, zero legs, no restriction opened, material request issued (2026-09-14: soft line no longer stamps a 便签)
Swap Sumsub verdict buttons (e2e, Task 12) › ② awaiting user（我方等同拒绝）: REJECTED, no restriction opened, material request issued (ext-3, 2026-09-14: soft line no longer stamps a 便签)
Swap Sumsub verdict buttons (e2e, Task 12) › ⑪ rejected · no disposition tag: REJECTED, no material request issued, no sticky hard-line
Swap Sumsub verdict buttons (e2e, Task 12) › ⑥ on hold（我方等同拒绝）: REJECTED, no material request issued
Swap Sumsub verdict buttons (e2e, Task 12) › ⑦ rejected · Sanctions: FROZEN, sticky hard-line set, no material request issued (tipping-off)
Swap Sumsub verdict buttons (e2e, Task 12) › sticky hard-line silences a later, otherwise-soft-line verdict（V7 制裁后送达的 V2：单已被客户级冻结广播冻住,裁决被幂等闸吞,沉默依旧零材料请求）
Swap money arcs (e2e, Task 12) › 2. THE HEADLINE PROPERTY（站3·出生锁版）— KYT rejected swap: 圈全擦、余额复原、零落笔零单据, quote consumed, restrictions block SWAP/WITHDRAW but not DEPOSIT
Customer lifecycle restrictions (e2e, Task 14) › ② 零痕迹：SANCTION 客户与正常客户的 /onboarding/me、/client/me/restrictions、/deposit-transactions/my 归一化后逐字节相等
Customer lifecycle restrictions (e2e, Task 14) › ⑥ 贴 MATERIAL_EXPIRED（WITHDRAW+SWAP）→ 三笔在途单状态一律不变
Vendor onboarding VARA notification gate e2e (甲波六 · T7) › ① 重大服务商：批准 → 待报备 + 自动开告知单盖章 → 告知单走到「已报送」→ ACTIVE → 终止再开一张告知单且不认领
Deposit/swap/withdraw roster (e2e, Task C2 + C3) › 充值 11 笔全部落到花名册预期状态
Deposit/swap/withdraw roster (e2e, Task C2 + C3) › 兑换 3 笔 + 提现 7 笔全部落到花名册预期状态
Deposit/swap/withdraw roster (e2e, Task C2 + C3) › 在途单由 runWithdraws 产出，不再需要单独跑 demo:in-transit
Deposit/swap/withdraw roster (e2e, Task C2 + C3) › verifyEndState — 花名册比对（Task C4） › �� 跑过 demo:in-transit 之后再跑 verifyEndState，仍然全绿
Deposit/swap/withdraw roster (e2e, Task C2 + C3) › verifyEndState — 花名册比对（Task C4） › 某笔单没到预期状态 → 断言失败并指名道姓
```

## 3. 比对方法与结果

方法同波二：从日志抽 `  ● ` 行 → 与 `e2e-baseline-0c6eb7b0.md` §2.1 代码块（B 集 22 名）按**前 70 字符前缀**逐名比（🎯 乱码归一），两个方向各取差集。

- **本次有、B 集无**（1 名）：`Vendor onboarding VARA notification gate e2e (甲波六 · T7) › ① 重大服务商：批准 → 待报备 + …`——不在 B 集（B 集 22 名里没有它；它是波二基线 §2.2 的 A 轮偶发名），属已知偶发。
- **B 集有、本次无**（2 名）：
  1. `Recon adjustment money arcs (e2e, Task 8) › 9. 平账闭环（真实形状）…`
  2. `Recon case aging → write-off e2e (平账 A 批, Task 12) › 主链路：查无果 → 拨钟 → …`

  恰是预期转绿的两名，无其他名转红或转绿。
- 即：失败集 21 = (B 集 22 − 2) ∪ {vendor-onboarding ①}；预期 20 名的差集：**多 1 名（vendor-onboarding ①）、少 0 名**。

## 4. 多出名字的单跑复核（干净重铺）

`test/vendor-onboarding.e2e-spec.ts`：`reset self → up → 7 私库 → demo:setup → 单文件（冷缓存）` → exit 0，`2 passed`。全量里红的签名：`expect(received).toEqual(expected)`，期望 `[APPLIED, SENT_FOR_APPROVAL, APPROVED, NOTIFICATION_OPENED, ACTIVATED]`，收到前四条（`VENDOR_ACTIVATED` 审计晚于状态落库，读早型）。与波一基线、波二 `e2e-after-8b40965d.md` §2 同款。已在 TOOLING-DEBT 登记与否：本任务未查（不在测量范围）。**红/绿归类**：单跑绿 → 与波二同判「偶发 / 顺序」；是否因此仍把新基线记为 20、或把基线定义改成「20 + 已知偶发 vendor-onboarding ①」，已由主会话裁定记偶发（见顶部结论）。

## 5. 没覆盖

- 全量只跑一遍（外加一次单跑），没有三轮取多数；`vendor-onboarding ①` 偶发频率不量化（波二 1/1、波一 1/3、本次 1/1 全量）。
- 没做拨钟配置对照（真实时钟已在 UTC 20–24 窗口内，recon 套件全绿，窗口效应已被 T6 修掉）；spec §11.7 末句「再用 §4 拨钟配方跑同四个文件」本任务未做（brief 未列）。
- 失败例的逐例栈未展开；与 B 集的比对是名字级。

## 6. Run 2（第二轮全量，同协议）

**时钟**：开跑前 `date` = Sun Nov 8 01:29:55 +04 2026，`date -u` = Sat Nov 7 21:29:55 UTC 2026（仍在 UTC 20–24 窗口内）；结束约 21:32:30 UTC。

| 步骤 | 命令 | 退出码 |
|---|---|---|
| 重铺 / 起栈 | `bash scripts/stack.sh reset self` / `bash scripts/stack.sh up` | 0 / 0 |
| 7 个私库 | `rm -f` 后 `migrate deploy` / `db:base:sync` / `db:biz:init` | 0 / 0 / **1（×7）**（已知债，同第 1 轮） |
| 建 demo 基础 | `bash scripts/on-stack.sh self demo:setup` | 0 |
| 全量 | `bash scripts/on-stack.sh self test:e2e --runInBand --cacheDirectory=<新空目录>`（日志文件，`$?` 直接取） | **1** |

**总数**：`Test Suites: 8 failed, 23 passed, 31 total` / `Tests: 21 failed, 178 passed, 199 total`，jest `Time: 146.826 s`——与第 1 轮完全相同。失败套件同为 8 个（recon-internal-transfer、recon-supplement、incident-register、swap-sumsub-scenarios、swap-money-arc、customer-restrictions、vendor-onboarding、demo-roster）。

**与 20 名基线的两个方向差集**（方法同 §3：70 字符前缀；20 名 = B 集 22 名 − {recon-aging 主链路、recon-adjustment 用例 9}）：

- **本轮有、基线无**：`Vendor onboarding VARA notification gate e2e (甲波六 · T7) › ① 重大服务商：批准 → 待报备 + 自动开告知单盖章 → …`（1 名）。
- **基线有、本轮无**：空（20 名一名不少）。同时相对 B 集 22 名：缺的恰是那两个预期转绿名（`Recon adjustment money arcs … 9. 平账闭环…`、`Recon case aging → write-off e2e … 主链路…`）。

**第 1 轮的两个方向差集**（补贴，数据见 §3）：本轮有基线无 = `vendor-onboarding ①`；基线有本轮无 = 空。两轮失败名集合逐名相同（`diff <(sort 第1轮) <(sort 第2轮)` 为空）。

**`vendor-onboarding ①` 是否重现**：是，红（`:196`，期望 5 条收到 4 条，缺 `VENDOR_ACTIVATED`，与第 1 轮同签名）。无其他多出 / 缺少的名字，故无需另做单文件归类（①的单跑复核见 §4）。

**判定**：两轮均 = 20 + `vendor-onboarding ①`，满足主会话裁定的通过条件。收尾：`reset self → up → demo:all`（0 / 0 / 0，asserts 5/5 PASS）；`git diff --stat doc-final/demo/data.md` 为空。
