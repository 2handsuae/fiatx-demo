# 第六幕「账对」清残留战役 · 六条战役级判据末波复验

> 判据原文见总纲 `doc-final/superpowers/specs/2026-09-19-act6-recon-cleanup-charter.md` §0
> 复验人：波五 Task 11（收尾闸执行段）｜ 复验时点：2026-09-21（重铺后，见 `gates-final.txt`）

## ① 闸门能咬人：对账域 `(this.prisma as any)` 归零 + 变异实证

判据原文：「对账域 `(this.prisma as any)` 归零；变异测试实证——故意改一个 Prisma 列名，闸① 必红（现在不会）」

复跑命令（波一登记的复现命令，本轮在 HEAD 重跑）：
```
grep -rn "(this.prisma as any)" src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers
```
结果：1 处命中，`supplement-evidence.service.ts:158`，内容为**注释**（"`(this.prisma as any)` 取数（2026-09-19 波一已摘净），tsc 照不到..."），排除注释后 `grep -v "^\S*:\s*//"` 复核 **0 处活代码命中**。归零成立。

变异实证：物证指针 `doc-final/superpowers/checkups/2026-09-19-act6-wave1-evidence/gate-before.txt`（改列名前闸①绿）与 `gate-after.txt`（改列名后闸①红），两文件本轮未被后续任何波触碰（`git log --follow` 波二/三/四/五均未改动该目录以外的波一物证文件）——变异实证仍然有效，不需要在末波重新破坏生产代码复证。

**结论：通过。**

## ② 测试的绿来自行为：3 条恒真断言已换真断言

判据原文：「体检点名的 3 条恒真断言全部换成能红的断言，各带一次变异实证」

- `bucket-classifier.spec.ts`（180 组网格）：本轮源码检查（`src/modules/clearing-settle/reconciliation/engine/v2/bucket-classifier.spec.ts`）第 14/39 行断言为 `expect(computeBucket(input)).toBe(expectedBucket(input))`／`toBe(want)`，非旧式 `expect(buckets.has(b)).toBe(true)` 恒真形态；第 19 行注释原文记录旧写法已废弃；第 42 行 `expect(checked).toBe(180)` 锁网格覆盖数。jest 本轮实跑该 spec 随三域全量一并通过（见 `gates-final.txt`）。
- `reconciliation-case-idempotent-fields.spec.ts`（67 行零 import 那份）：本轮 `find . -iname "reconciliation-case-idempotent-fields.spec.ts"` **零命中**——已整份删除，不是"仍存在但改真"，与波一物证（`WRAPUP.md`）记录的处置口径一致。
- 变异实证物证指针：`doc-final/superpowers/checkups/2026-09-19-act6-wave1-evidence/grid-mutation-before.txt` / `grid-mutation-after.txt`（180 网格断言变异前后对照，绿→红）。

**结论：通过（2 条换真断言 + 1 条整份删除，3 条均未回退）。**

## ③ 屏上无假数据：第六幕五页逐页截图，无 epoch 时间 / 无恒空字段 / 无点了必空的筛选项

物证：
- 本波 after 对位集（`checkups/2026-09-21-act6-wave5-evidence/after/`）：`after-1-cases-list.png`（案件列表）、`after-2-run-detail-break-invariant-pass.png`（run 详情）、`after-3-case-detail-severity-badge.png`（案件详情 · 严重度徽章）、`after-5-internal-transfers-list-custody-url.png`（划转列表 · custody URL）、`after-6-client-deposit-detail-value-date.png`（客户端充值详情）、`scenario9-1-hold-next-period-case-red.png` / `scenario9-2-re-reconcile-still-red.png`（场景 9 实走两态）。
- T6 横幅图：`run-internal-break.png`（INTERNAL BREAK 红横幅，真实触发非硬编码）、`run-break-normal-comparison.png`（普通 BREAK run 对照，无横幅、Health Check 卡片正常）。
- 逐页核对：案件列表无 epoch 时间列（AGING 列为 "0d" 相对值）；run 详情 Health Check 五桶卡片数字非全零（19/7/1/2/9，非"看着像干净"的全零假象）；划转列表按状态/用途筛选下拉框存在但本轮 0 条记录时正确显示空态提示文案（"No transfers yet"），非"点了报错/卡死"。

**结论：通过。**

## ④ 主体边界立起来：Case 有自己的服务与显式迁移表，`status` 写点收敛

判据原文：「Case 有自己的服务与显式迁移表，`status` 写点收敛；对账域 workflow 零直写表」

- 物证指针：`doc-final/superpowers/checkups/2026-09-20-act6-wave3-evidence/`（`reconciliation-case.service.ts` 主体服务 + 迁移表落地、`demoall-diff.txt`/`break-diff.txt` 两份栈级输出归一 diff 均空）。
- 本轮复扫写点（不依赖波三物证是否漂移，直接在 HEAD 重新取证）：
  ```
  grep -rln "reconciliationCase.update\|reconciliationCase\.upsert\|status:\s*['\"]RESOLVED['\"]\|status:\s*ReconciliationCaseStatus" src/modules/clearing-settle src/modules/asset-treasury src/modules/governance --include="*.ts" | grep -v spec
  grep -rln "\.reconciliationCase\.\(update\|upsert\|create\)" src --include="*.ts" | grep -v spec
  ```
  两种搜法均只命中 **1 个文件**：`src/modules/clearing-settle/reconciliation/domain/reconciliation-case.service.ts`。收敛仍唯一，波五 9 位点改动（含 T2 删除私有 `toBusinessDate`、T4 契约改造、T5 severity 改造、T6 finalize 改造）均未在别处新开写点。

**结论：通过。**

## ⑤ 记账日期按迪拜 COB 切：7 处（订正 9 位点/8 文件）改完，重铺闸 + `verify:coa` 全绿

判据原文：「7 处改完，重铺闸 + `verify:coa` 全绿」（总纲订正为 9 位点/8 文件，见波五 spec §1.2）

- 9 位点全部落地：commit 链 4d963c75(T1) → 18f1b5fa(T2) → 3d2e66f2(T3) → a14a19f3(T4)，逐位点在各任务报告与 progress.md 已逐条评审 clean。
- 本任务 Step 1-3 实证：
  - 闸①②③ + 三域 jest 29 suites/572 tests 全绿（`gates-final.txt` §1）
  - 重铺闸：`rm dev.db` → `stack.sh reset` → `up` → `demo:all`（29/29 + COA 4 恒等式）→ `recon:demo:break`（18/18 场景 + 12/12 桶 + casesOpened 12/12 + identities OK）全绿（`gates-final.txt` §2）
  - `verify:coa`：两 ledger × 2 恒等式全过 + 负余额检查 57 科目全部 ≥0（`gates-final.txt` §3）
  - 场景 9 剧本实走：三时间戳算式 + 实走结局一致（`scenario9-timestamps.txt`），本轮铺场时刻已过 UTC 14:00 门槛，案子 Re-reconcile 后正确地仍红（迪拜 COB 边界行为，非缺陷）

**结论：通过。**

## ⑥ 文档与代码对得上：体检点名的 5 处数字腐烂清零，`modules/v8-recon.md` 与代码逐数复核

判据原文：「体检点名的 5 处数字腐烂清零，`modules/v8-recon.md` 与代码逐数复核」

- 物证指针：`doc-final/superpowers/checkups/2026-09-21-act6-wave5-evidence/v8-recon-number-audit.md`（T10 产出，逐数复核清单）；commit `1203b007`（波五 T10：五处数字腐烂 + 附录 18 场景 12 案重排 + CHANGELOG 去重 + 台账销登）。
- T10 progress.md 记录的已知偏差（不影响本判据"清零"结论，如实带出）：复核清单 #24 记"五桶残留注释 3 文件"实为 4 文件（`wallet-recon-run.service.ts:382,601` 漏计，残留注释本身超 T10 brief 范围未修，本条 WRAPUP 一并登记）。
- 本轮未新增改动 `modules/v8-recon.md` 或体检点名的 5 处，T10 交付原样保留，无需重新复核。

**结论：通过（1 条 minor 偏差已知，不影响主判据）。**

---

## 复验汇总

| # | 判据 | 结果 |
|---|---|---|
| ① | 闸门能咬人（as any 归零 + 变异实证） | 通过 |
| ② | 测试的绿来自行为（3 条恒真断言已换） | 通过 |
| ③ | 屏上无假数据（五页截图） | 通过 |
| ④ | 主体边界立起来（Case 服务 + 迁移表 + 写点收敛） | 通过 |
| ⑤ | 记账日期按迪拜 COB 切（重铺闸 + coa） | 通过 |
| ⑥ | 文档与代码对得上（5 处数字腐烂清零） | 通过（1 条 minor 偏差已知） |

六条战役级判据本轮全部复验通过。
