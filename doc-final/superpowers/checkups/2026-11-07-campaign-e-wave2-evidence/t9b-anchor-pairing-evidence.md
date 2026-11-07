# T9b 证据笔记 · 匹配器第 0 轮锚配对（戊波二）

- 基底 `eff428df`（T9a）。时钟：全部在 UTC 02:38–03:05（迪拜 06:38–07:05），窗口（UTC 20:00–24:00）外，未用拨钟配置。
- 状态：已提交。`recon-reattribution` 场景 A 的旧断言与 spec 第 0 轮语义矛盾（§4），控制方裁定 R36 批准按 spec §4.5 对齐那一段断言，愈合断言不动；对齐后见 §4 末的复跑。
- 命令前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`；需要退出码的命令一律重定向到文件再取 `$?`。

## 1. 闸门（命令 · 退出码 · 关键行）

| 闸 | 命令 | 退出 | 关键行 |
|---|---|---|---|
| ① | `npx tsc --noEmit -p tsconfig.json` | 0 | 0 字节输出 |
| ② | `cd admin-web && npx tsc -b --noEmit` | 0 | 0 字节 |
| ③ | `cd client-web && npx tsc -b --noEmit` | 0 | 0 字节 |
| ④ | `npx jest src/modules/clearing-settle/reconciliation src/modules/asset-treasury/internal-transfers src/modules/governance/incidents` | 0 | `Test Suites: 33 passed` / `Tests: 817 passed`（要求的两个目录单跑：26 suites / 621 例，含本任务新增） |
| 重铺 | `bash scripts/stack.sh reset self` → `up` | 0 / 0 | |
| ⑥ | `bash scripts/on-stack.sh self demo:all` | 0 | `花名册：35/35 符合预期`；`asserts: 5/5 PASS`（首跑无 FDO/#35 偶发） |
| | `… recon:demo:pass` | 0 | `status=PASS walletsChecked=21 casesOpened=0` |
| | `… recon:demo:break` | 0 | `scenarios: 18/18 DETECTED`；`OK wallets 12/12`；`OK casesOpened 12/12`；`identities OK`（与改前一致，答案键未碰） |
| ⑦ | `… verify:coa` | 0 | 四条恒等 ✓；`105 个科目全部 ≥ 0`；`ALL INVARIANTS PASS` |
| 收尾态 | `reset self` → `up` → `demo:all`（0/0/0，35/35、5/5）→ `verify:coa`（0） | | 栈留在这个态 |

## 2. e2e（干净栈：`reset self` → `up` → `demo:setup`，命令 `bash scripts/on-stack.sh self test:e2e --runInBand --verbose <七个文件>`，退出 1）

`Test Suites: 6 failed, 1 passed, 7 total` / `Tests: 8 failed, 33 passed, 41 total`。逐文件对基线 §2.1（`e2e-baseline-0c6eb7b0.md`）：

| 文件 | 通过 / 总 | 失败名 | 在基线 §2.1？ |
|---|---|---|---|
| recon-internal-transfer | 7 / 8 | `B · 退汇余额不足…` | 是 |
| incident-register | 9 / 10 | `9 · CLIENT_SHORTFALL：带垫款单号登记…` | 是 |
| recon-adjustment-money-arcs | 10 / 11 | `9. 平账闭环（真实形状）…`（第一轮 `run1.status` 期望 BREAK 收到 PASS，夹具日期老债） | 是 |
| recon-aging-write-off | 2 / 3 | `主链路：查无果 → 拨钟 → …` | 是 |
| recon-supplement | 2 / 5 | `② 退汇…` `③ 退回…` `拒绝路径…` | 是（三名） |
| recon-internal-delta | 2 / 2 | — | — |
| **recon-reattribution** | **1 / 2** | **`A. 改记一单双案同愈…`** | **否 → §4** |

本任务要求的新断言：`recon-internal-transfer` **A** 的「按案件业务日重对账 → 案愈、原差异行 MATCHED、resolution = ITR 号」与「腿到账后 83 按参考号配上模拟回单」、`incident-register` **5** 的同款断言，**全绿**（`✓ A · 账龄路全弧…`、`✓ 5 · 事故路认损补缺…`）。money-arcs 11 例里除 9 外 10 例全绿（含 1、8——它们走「内部对内部消化」形状，见 §3 M1）。

## 3. 失效验证（变异 → 必红 → 还原；还原后 `diff -q` 与备份一致）

| # | 变异 | 结果 |
|---|---|---|
| M1 | 第 0 轮整段关掉（`for (const a of [])`） | 匹配器 spec `8 failed`；e2e：internal-transfer **A** 红（`bucket COMPENSATING / mismatchCount 1`，期望 MATCHED / 0）、incident **5** 红（91 退化成 Pass 2 模糊配上幽灵转出行，`explainedByAdjustmentNo` 期望 ITR 号收到 undefined——只看「配上了」会漏，resolution 断言逮住）、money-arcs **1、8** 红（重复入账冲正案不再自愈）、reattribution **A** 红 |
| M2 | 外部行锚：净额 ≠ 对账单也算 MATCHED | `1 failed`（「signed sum differs … AMOUNT_MISMATCH」） |
| M3 | 组里不带内部行锚 | `6 failed` |
| M4 | 两锚皆空的调账流水也进池 | `1 failed`（「anchored … in the pool, anchorless one is not」） |
| M5 | 净额 0 不消化 | `2 failed` |
| M6 | 取数条件里丢掉截止点过滤（AND 重组后的风险） | 加测试前 **31 passed（没逮住）**；补「截止点之后写入的同日流水不进池」后 `1 failed` |

（M2 / M5 第一版写成 `if (true || …)` / `if (false && …)` 触发 TS 诊断、`Tests: 0 total`，不算行为红，已换写法重做。）

## 4. `recon-reattribution` 场景 A 的旧断言（R36 已裁：按第 0 轮语义对齐）（`test/recon-reattribution.e2e-spec.ts:731`）

spec §4.5 与 brief 都写「改记四腿：Jack 钱包 {幽灵 IN, 改记 OUT} 净 0 → 消化；Kate 钱包 改记 IN ↔ 锚外部行 → MATCHED；`:442` 断言不变」。这两半互相矛盾：场景 A 的读后断言是「两条差异行都还在（orphanInternal 1 / orphanExternal 1，案件页 ORPHAN_INTERNAL / ORPHAN_EXTERNAL 行带 `explainedByAdjustmentNo` 与 `disposition`）」，而第 0 轮的定义恰恰是把这两条配成 MATCHED / 消化——计数必为 0、行必为 MATCHED。

实测（实现完整、断言未动）：`Expected: 1  Received: 0` 红在 `:731 expect(fromSnap.orphanInternal).toBe(1)`；该断言之前的全部「一次重对账两案齐愈」前置（内部余额、deltaAmount、快照存在）都过。

临时套用 `task-9b-reattribution-proposed.patch`（只改这一段断言：计数 1→0 + `matchedCount` 1；行改按 id 找、`matchType === 'MATCHED'`、`explainedByAdjustmentNo === ADJ 号`、整表无异常行；案子 `RESOLVED / AUTO_HEALED / closedByRunId = run2` 等「同一次重对账两案齐愈」断言一字未动）后 `test:e2e --runInBand test/recon-reattribution.e2e-spec.ts`：退出 0，`2 passed`。该 patch 随后已 `git checkout` 回退，**仓库里该文件保持原样**。

该补丁丢掉了 `fromRow.disposition.*` 三行断言——MATCHED 行目前不挂 `disposition` 注解（`annotateRow` 只给三类异常行贴）。要不要让第 0 轮的 MATCHED 行也挂处置注解，是读面（T10）的取舍，不是引擎的。

同款旧断言还在 money-arcs 用例 9（`:1148 snapshot.orphanInternal toBe(1)`、`:1156 ORPHAN_INTERNAL`）——该例在基线里就红在第一轮 `run1.status`，到不了这几行；日期夹具哪天修好，它会撞同一个问题。

### R36 对齐后（实际提交的版本）

断言对齐（`test/recon-reattribution.e2e-spec.ts` 场景 A，愈合断言一字未动）：`:731 orphanInternal 1 → 0`、`:732 orphanExternal 1 → 0`（并加 `matchedCount` 两边各 1）；`:752` 行由 `find(ORPHAN_INTERNAL)` 改按内部行 id 找，断言 `MATCHED`、`externalLine` 为 null（钱包内对冲）、`explainedByAdjustmentNo = ADJ 号`、整表无异常行；`:757-760` 原 `fromRow.disposition.{causeCode,outlet,adjustmentNo}` 三行改为直接查处置记录（`causeCode MISATTRIBUTED_FROM / outlet ADJUST_REATTRIBUTE / adjustmentNo = ADJ 号`），因为 MATCHED 行读面不贴处置注解、案子已愈合所以没有持久的 MATCHED 证据行（run 只在案子仍破口时才写行）；`:763` 行由 `find(ORPHAN_EXTERNAL)` 改按对账单行 id 找，断言 `MATCHED` + `explainedByAdjustmentNo = ADJ 号`、整表无异常行。

复跑：`bash scripts/on-stack.sh self test:e2e --runInBand --verbose test/recon-reattribution.e2e-spec.ts test/recon-adjustment-money-arcs.e2e-spec.ts` 退出 1（仅因 money-arcs 9）：`Tests: 1 failed, 12 passed, 13 total`；reattribution A、B 全绿；money-arcs 失败名 = `9. 平账闭环（真实形状）…`，在基线 §2.1。①②③ `tsc` 各 exit 0、0 字节。
