# 波四收尾 · 13 对截图逐张比对 walkthrough

比对口径（Task 7 brief Step 3）：文案 / 列 / 按钮组 / 布局零差异；允许两侧不同的仅：单号与日期时间字面（两侧各自独立重铺所致）、aging 天数（自然日漂移，本次 before/after 同为 2026-09-21，理论零漂移）。

## 复现前提

- before：Task 0（commit `01e215b5`）在 `4e3b0ef4` 上采样，`stack.sh reset self` 后单独一次 `demo:all`+`recon:demo:break`+`shots.sh before`。
- after：本任务（Task 7）在 HEAD（`d655fe8e`）上采样，独立 `stack.sh reset self` → `up self` → `demo:all`（exit 0，5/5 asserts）→ `recon:demo:break`（exit 0，18/18 scenarios）→ `shots.sh after`（13 张一次成功，同一份 `resolve-shot-targets.mjs`/`shots.sh`，未做任何修改）。
- 两次重铺相互独立，各自的 case 编号 / 时间戳 / reference 号均为各自库里重新生成的字面值。

## 逐张比对表

| # | 截图 | 结论 | 说明 |
|---|---|---|---|
| 1 | p1-runs | **零差异** | 像素级同构（该页无 case 编号字面，run 编号/资产/状态完全一致） |
| 2 | p2-cases | **结构零差异，数据字面重排** | 表头/列/状态徽章/布局完全一致；12 行内容与 before 相同的 12 个业务场景一一对应，但 case 编号→场景的映射发生了整体重排（如 wallet `...7408` 的 Firm/AED/-0.07 场景，before 标 002、after 标 001）。根因是种子脚本的 case 编号按创建顺序分配、独立两次重铺创建顺序不保证一致——与「单号字面因两侧各自重铺而不同」同性质，只是这次整表都在重排范围内，不算文案/列/按钮组/布局差异 |
| 3 | p3-case-detail | **零差异（含一处已证伪的假阳性）** | 同一 case `REC20260921-003`（CASE_CORRECT 场景），账户/余额/Case History/Differences 表内容逐字段一致，仅参考号与时间戳字面不同。**已排查项**：ASSET 列文本换行位置（"USDT-TRON · Client book" 一行 vs 折成两行）两侧不同，连带 DISPOSITION 三个按钮从"2 行"变"3 行"堆叠——用 `demo-shot.js` 对同一 URL（当前 HEAD 代码、同一份数据库）连续截两次图复现：一次不折行、一次折行，**证实这是与代码无关的截图时点渲染抖动（很可能是无头 Chrome 字体加载竞态），非布局回归**（见下方"专项排查"） |
| 4 | p4-external-balances | **零差异** | 像素级同构（该页固定读 19 个钱包快照，无 case 编号，两次重铺产出完全相同） |
| 5 | p5-adjustments | **零差异** | 像素级同构（截图时点在 m1-m6 之前，两侧均为 0 条调账记录） |
| 6 | m1-adjust-kind | **零差异（关键断言通过）** | 同一 case `REC20260921-003`，Correction 弹窗内容逐字段一致（仅 reference/时间戳字面不同）。**m1 方向断言**：Direction 只读值两侧均为 `Reduce`，与该行 delta 符号在入账语义下一致——与波前行为相同，证明方向公式收回后端后结果不变 |
| 7 | m2-finding-picker | **零差异** | 同一 case `REC20260921-005`（CASE_REATTR 场景），Reattribute 成因选择弹层逐字段一致 |
| 8 | m3-adjust-reattr-locked | **零差异** | 同一 case `REC20260921-005`，Reattribution 锁定表单逐字段一致（仅 reference/时间戳字面不同） |
| 9 | m4-hold | **数据内容不同，UI 结构零差异** | 见下方"CASE_HOLD 家族根因排查"——resolver 两次重铺挑中了不同的底层 case（均标号 001，但一个是 USDT-TRON 双行对冲、一个是 AED 单行 Mismatch），因此可选成因数量（3 个 vs 2 个）与金额不同；Hold 弹层本身的标题格式/单选列表结构/备注框/提示条/按钮组两侧完全一致 |
| 10 | m5-supplement | **零差异** | 同一 case `REC20260921-008`，补单表单逐字段一致（仅 posted-at 时间戳与 reference 字面不同） |
| 11 | m6a-hold-recorded | **数据内容不同，UI 结构零差异** | 同上第 9 项根因；Finding 结论条 + 三按钮的结构、Case History/Balance 5 瓦的布局两侧一致 |
| 12 | m6b-aged | **数据内容不同，UI 结构零差异** | 同上第 9 项根因；⚡ Fast-forward aging 交互、SLA 拨钟后的横幅结构、⚡ Recommended 推荐条样式两侧一致 |
| 13 | m6-writeoff-locked | **数据内容不同，UI 结构零差异（含一处已证伪的假阳性）** | 同上第 9 项根因，Write-off 弹层结构一致。**已排查项**：Direction 说明文案两侧字面不同（before："Direction = external flow direction as-is (IN → increase, OUT → decrease)"；after："Direction is derived from the delta sign (external − internal; outbound flows flip the sign)"）——这不是文案改写，是 `causeRegistry.ts:directionNoteFor(matchType)` 按 `row.matchType` 条件选择的两句固定文案之一，`git show 4e3b0ef4:...ReconciliationCasesDetailPage.tsx` 证实该函数与调用点在波四改动前后逐字节相同；两侧文案不同纯因两个 case 的 `matchType` 不同（EXTERNAL_ONLY vs AMOUNT_MISMATCH），是第 9 项根因的下游表现，非独立缺陷 |

**结论**：13 对里 9 对（p1/p2 结构/p3/p4/p5/m1/m2/m3/m5）零差异或仅数据字面重排；4 对（m4/m6a/m6b/m6-writeoff）因下方根因，同一变量名两次重铺命中了不同的底层业务场景，但 UI 结构本身（标题格式、字段布局、按钮组、说明文案的生成逻辑）逐一核对后确认一致，不构成本波代码引入的第三类差异（文案/列/按钮组/布局回归）。

## CASE_HOLD 家族根因排查（#9/11/12/13 共用）

**现象**：`resolve-shot-targets.mjs` 里 `CASE_HOLD=pick('HOLD_INVESTIGATING')` 在 before 与 after 两次独立重铺中都解析到了案号 `REC20260921-001`，但两次的 001 号案实际内容完全不同：

| | before REC20260921-001 | after REC20260921-001 |
|---|---|---|
| Wallet | WA2601018867 | WA2601017408 |
| Asset | USDT-TRON | AED |
| Bucket | Compensating | Break |
| Δ | 0.000000 | -0.07 |
| Rows | 2（External only OUT + External only IN） | 1（Mismatch IN） |
| Hold 弹层可选成因 | Unclaimed inflow / Unexplained (exhausted) / Other（3 个） | Unexplained (exhausted) / Other（2 个，缺 Unclaimed inflow） |

**根因定位**（两步）：

1. **种子的 case 编号分配跨重铺不稳定**：`p2-cases` 列表页对比（见上表 #2）已实证，同一批 12 个业务场景两次重铺后编号整体重排（例如 before 002 号在 after 变成 001 号）。这是种子/对账跑批的既有行为，与波四前端拆分代码无关。
2. **resolver 的 `pick('HOLD_INVESTIGATING')` 不具场景排他性**：现场查询当前（after）栈的 12 个 open case，`HOLD_INVESTIGATING` 在其中 **11 个**上都是可用处置项（仅 004 号无任何处置项）：

   ```
   $ curl 逐个查询 12 个 case 的 flowComparison[].dispositions[].kind（本节即完整结果，唯一底本——`.superpowers/` 工作目录随合并不保留，不再另指向别处）
   REC20260921-001 rows=4 RECORD,HOLD_NEXT_PERIOD,HOLD_INVESTIGATING
   REC20260921-002 rows=5 RECORD,HOLD_NEXT_PERIOD,HOLD_INVESTIGATING
   REC20260921-003 rows=2 CORRECT,HOLD_NEXT_PERIOD,HOLD_INVESTIGATING
   REC20260921-004 rows=8 （无）
   REC20260921-005 rows=5 SUPPLEMENT,REATTRIBUTE,INCIDENT,HOLD_NEXT_PERIOD,HOLD_INVESTIGATING
   REC20260921-006 rows=3 CORRECT,HOLD_NEXT_PERIOD,HOLD_INVESTIGATING
   REC20260921-007 rows=3 REVERSE,REATTRIBUTE,HOLD_NEXT_PERIOD,HOLD_INVESTIGATING
   REC20260921-008 rows=8 SUPPLEMENT,REATTRIBUTE,INCIDENT,HOLD_NEXT_PERIOD,HOLD_INVESTIGATING,CORRECT
   REC20260921-009 rows=2 SUPPLEMENT,REATTRIBUTE,INCIDENT,HOLD_NEXT_PERIOD,HOLD_INVESTIGATING
   REC20260921-010 rows=2 REVERSE,REATTRIBUTE,HOLD_NEXT_PERIOD,HOLD_INVESTIGATING
   REC20260921-011 rows=4 SUPPLEMENT,REATTRIBUTE,INCIDENT,HOLD_NEXT_PERIOD,HOLD_INVESTIGATING
   REC20260921-012 rows=5 REVERSE,REATTRIBUTE,HOLD_NEXT_PERIOD,HOLD_INVESTIGATING
   ```

   `HOLD_INVESTIGATING` 实际是几乎全通用的兜底处置项，`resolve-shot-targets.mjs:17` 的 `pick()` 只是"取列表里第一个未被占用、且提供该 kind 的 case"，并不绑定某个专属设计场景。两次独立重铺中，list 顺序恰好都让 001 号（虽然内容不同）排在最前，于是两次都被选中，但选中的其实是两个不同的场景。

**结论**：这是 Task 0 建立的取证脚本（`resolve-shot-targets.mjs`）本身对 `CASE_HOLD` 的挑选逻辑存在的既有方法论缺口（未绑定专属场景），不是波四 T1-T6 代码改动引入的回归。已登记进波五骨架的"新事实"节，供后续需要跨重铺截图对比的任务参考。

## p3 ASSET 换行 / 按钮堆叠专项排查

对当前 HEAD 代码（无任何改动）连续两次截同一个 URL（`/admin/reconciliation/cases/REC20260921-003`，同一份数据库，间隔数秒）：

```
$ node scripts/demo-shot.js --api http://127.0.0.1:3100 --url ".../REC20260921-003" --wait 2500 --out /tmp/recheck-p3-1.png
$ node scripts/demo-shot.js --api http://127.0.0.1:3100 --url ".../REC20260921-003" --wait 2500 --out /tmp/recheck-p3-2.png
```

第一次截图 ASSET 列显示单行"USDT-TRON · Client book"；第二次截图同一字段折成两行"USDT-TRON · Client" / "book"。两次用的是完全相同的代码、完全相同的数据库状态，唯一变量是截图的时间点——证实这是无头 Chrome 截图工具本身的渲染抖动（推测是字体加载竞态导致文本测量结果偶发性差几像素，从而影响 flex-wrap 断点），与波四代码改动无关，也不是本次 before/after 比对能够控制的变量。**诊断图 ×2 已入档**（`p3-flake-recheck-1.png` / `p3-flake-recheck-2.png`，同目录，非 13 张正式清单的一部分）——这条 flake 结论日后被质疑时，两张同 HEAD 不同布局的图就是它的全部证据，可直接复看。

`git show 4e3b0ef4:admin-web/src/pages/ReconciliationCasesDetailPage.tsx` 中"Account"卡片区块（Wallet/Customer/Ledger Account/Asset/Business Date 五列的 grid）与 HEAD 版本逐行 diff 为空，确认该区块本波未被任何任务触碰。
