# WRAPUP：第六幕清残留 · 波四「前端拆分」

- Spec：`doc-final/superpowers/specs/2026-09-20-act6-wave4-frontend-split-design.md`
- Plan：`doc-final/superpowers/plans/2026-09-21-act6-wave4-frontend-split.md`
- Worktree：`.claude/worktrees/act6_wave4` ｜ branch `worktree-act6_wave4` ｜ base `4e3b0ef4`
- Commit 链：`01e215b5`(T0) → `05056023`(T1) → `b6ae479e`(T2) → `8c61baba`(T3) → `7ae359ab`(T4) → `036537e6`(T5) → `d655fe8e`(T6) → 本任务(T7)
- 执行日期：2026-09-21

## 一、spec §6「闸与验收」六道闸逐条实测值

| # | 闸 | 判据 | 本次实测 |
|---|---|---|---|
| 1 | 闸①②③ | 全绿 | 三闸均 `exit 0`，零输出（见下方摘录） |
| 2 | jest 对账域 | 全绿；基线 29/561 起算 | **29 suites / 567 tests，全绿**（波前 561 → T1 在既有 `cause-registry.spec.ts` 与 `reconciliation-query.service.spec.ts` 两文件内新增用例 +6 tests，suite 数不变，终值 567） |
| 3 | 栈级输出 diff | 归一后逐字节为空，或如实记录白名单未启用 | **两份均为空**：`demoall-diff.txt` 0 字节、`break-diff.txt` 0 字节（`wc -c` 实测）；`.norm.txt` 行数 after=before 一致（112/95）。demo 输出不含 case 读面 JSON，白名单 grep 步骤未触发（如实记录「白名单未启用」，非跳过） |
| 4 | 截图像素同构 | 13 张（五页+八弹层）文案/列/按钮组零差异 | **9/13 结构与内容双清；4/13 UI 结构清、数据内容因取证脚本既有缺口两侧命中不同底层 case**（逐张见 `walkthrough.md`，根因非本波代码回归） |
| 5 | 复现命令归零复跑 | padStart→共享件 1 处；TONE_CLASSES→1 处；反向 import→0 行；另 T2/T6 判死条件 | **全部按 Ruling R1 订正后的预期终态复现**（见下） |
| 6 | 行数终态 | 页面 ≤650 / 弹窗 ≤450 / 新件各 ≤500 | 页面 **741**（超 91，结构性解释见下）；弹窗 **623**（超 173，保留既有中文注释）；`CaseFlowTable.tsx` **568**（超 68，单次迁出最大整块，含 Ruling R2 的 `renderFunding`/`tableRef`）；其余 6 个新/改 utils 与组件文件均 ≤500（见下表） |

## 二、命令与摘录

### 闸①②③

```
$ PATH=".../v20.20.2/bin:$PATH" npx tsc --noEmit -p tsconfig.json          → exit 0，零输出
$ cd admin-web  && PATH="...:$PATH" npx tsc -b --noEmit                    → exit 0，零输出
$ cd client-web && PATH="...:$PATH" npx tsc -b --noEmit                    → exit 0，零输出
```

### jest 三域

```
$ DATABASE_URL="file:/tmp/exchange_js_wt_act6_wave4/dev.db" npx jest \
    src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers

Test Suites: 29 passed, 29 total
Tests:       567 passed, 567 total
Time:        9.632 s
```

### 栈级输出 diff（Step 2，采样先于截图，之间不再 reset）

```
$ bash scripts/stack.sh reset self && bash scripts/stack.sh up self         → exit 0
$ bash scripts/on-stack.sh self demo:all         > demoall-after.txt        → exit 0，尾行 "asserts: 5/5 PASS"
$ bash scripts/on-stack.sh self recon:demo:break > break-after.txt          → exit 0，尾行 "ALL 18 SCENARIOS DETECTED PER MANIFEST"
$ bash normalize-rules.sh demoall-after.txt > demoall-after.norm.txt        → 112 行（= before）
$ bash normalize-rules.sh break-after.txt   > break-after.norm.txt         → 95 行（= before）
$ diff demoall-before.norm.txt demoall-after.norm.txt > demoall-diff.txt; wc -c demoall-diff.txt
0 demoall-diff.txt
$ diff break-before.norm.txt   break-after.norm.txt   > break-diff.txt;   wc -c break-diff.txt
0 break-diff.txt
```

白名单 grep（`grep -v "adjustmentPrefill\|adjustmentBook"`）因两份 diff 本身为空而未触发过滤，如实记录「白名单未启用」，非跳过。

### `verify:coa`（Step 2 保守项）

```
$ bash scripts/on-stack.sh self verify:coa
✓ ledger 1 CLIENT 恒等 29812565
✓ ledger 1 FIRM 恒等 99870335
✓ ledger 2 CLIENT 恒等 4392571811
✓ ledger 2 FIRM 恒等 100413428189
✓ 负余额检查 通过 (57 个科目全部 ≥ 0)
ALL INVARIANTS PASS
```

**声明（brief Step 2 要求原文照录）**：`recon-demo.ts` 零处置/调账动作（`grep -n "createDraft\|/dispositions\|adjustmentNo" scripts/recon-demo.ts` → 0 行，exit 1，本次复跑确认），故 `verify:coa` 对本波方向公式**无探测力**——方向等价性的闸是 T1 单测（`cause-registry.spec.ts:178`）+ Step 3 的 m1/m6-writeoff 截图断言，不拿 coa 绿充数。本次 `verify:coa` 全绿是廉价地基核验的记录，不作为方向公式回归证据。

### 复现命令归零复跑（Step 4）

```
$ grep -rn "rowAdjustmentPrefill\|deriveKindDirection" admin-web/src
（0 行，exit 1）—— T2 判据达成

$ grep -rn "padStart(decimals + 1" admin-web/src --include='*.tsx' --include='*.ts'
admin-web/src/utils/reconAmount.ts:19
admin-web/src/utils/reconAmount.ts:43
admin-web/src/pages/LedgerAccountList.tsx:63
admin-web/src/pages/AccountFlowList.tsx:77
（4 行——按 Ruling R1 订正后的预期终态，非 plan 原文 3 行；reconAmount.ts 两行分别对应 formatAmount 与 minorToDisplay 两个语义变体，账本域两文件 spec §0 明文不做）

$ grep -rn "const TONE_CLASSES" admin-web/src
admin-web/src/utils/reconBucketMap.ts:24
（1 行，T3 判据达成）

$ grep -rn "from '.*ReconciliationCasesDetailPage'" admin-web/src --include='*.tsx' --include='*.ts'
（0 行，exit 1，反向 import 断根判据达成）

$ grep -rn "REASON_META" admin-web/src | grep -v ReconciliationAdjustmentCreateModal.tsx
（0 行，exit 1）—— T6 判死条件复现成立

$ grep -n "setCreatePrefill(" admin-web/src/pages/ReconciliationCasesDetailPage.tsx
269（收尾清空）/ 285（开启：CORRECT）/ 316（开启：REATTRIBUTE）/ 368（开启：WRITE_OFF）/ 691（弹窗自身 onClose 收尾清空）
（5 行，与 T6 报告 Important #1 订正后的完整证据一致：2 处收尾清空 + 3 处成对开启，无"双空打开"入口）
```

## 三、行数终态清册（Step 5）

```
$ wc -l admin-web/src/pages/ReconciliationCasesDetailPage.tsx \
      admin-web/src/components/ReconciliationAdjustmentCreateModal.tsx \
      admin-web/src/components/reconciliation/*.tsx admin-web/src/utils/recon*.ts

     741 ReconciliationCasesDetailPage.tsx        （软目标 650，超 91）
     623 ReconciliationAdjustmentCreateModal.tsx  （软目标 450，超 173）
     124 components/reconciliation/CaseBalanceTiles.tsx
     568 components/reconciliation/CaseFlowTable.tsx        （新件软目标 500，超 68）
      83 components/reconciliation/CaseHistory.tsx
     165 components/reconciliation/DispositionFindingModal.tsx
     104 components/reconciliation/ReattributionCandidatePicker.tsx
      43 components/reconciliation/WriteOffPrereqPanel.tsx
      74 components/reconciliation/caseDetailBits.tsx
      59 utils/reconAmount.ts
      29 utils/reconBucketMap.ts
      48 utils/reconRunTrigger.ts
     186 utils/reconTypes.ts
    2847 total
```

**三处超软目标的结构性解释**（照波三 `run()` 190 行先例记录，不做额外搬运去硬凑数字）：

- **页面 741 行（原 1893 行，净减 1152 行）**：搬运边界由 brief 给定的两个区块注释精确锚定，已完整执行（T4/T5 共迁出 491+行）。剩余构成：五个弹层的状态编排+handler（约 140 行）、Hero+Account+两处组件挂载（约 130 行）、三个数据获取/操作 handler（约 90 行）、Sidebar（约 45 行）、五个弹层挂载 JSX（约 65 行）——现状即"状态编排 + 版面组装"，行数反映的是要编排的 5 个弹层流程数量，无一处落在 T4/T5 任务边界内。
- **弹窗 623 行（原 821 行，净减 198 行）**：T6 搬出候选选择器与核销前提区两块（207 行）、删除自由选择死分支（约 40 行），保留既有中文注释是 brief 明确指示的取舍（可读性优先于行数）。
- **`CaseFlowTable.tsx` 568 行**：T5 单次迁出的最大整块，421 行主体段 + Ruling R2 裁定随迁的 `renderFunding`/`tableRef`（合计 491 行原样搬运），是"Differences"大表本身的复杂度（3 种行类型 × 处置按钮矩阵 × 资金单弹窗接线）决定的，非拆分不彻底。

**偏差/订正记录**：

- Ruling R3：spec §2.2 曾把 deltaSign 列入 reconAmount.ts，实现留在页面——裁定成立（全仓唯一消费者在页面，『消费方在哪就住哪』同 R2 旨），代码不动，此行即偏离记录。

## 四、13 对截图逐张比对 + CASE_HOLD 根因排查

完整逐张比对表、CASE_HOLD 家族根因排查（species-selection 既有方法论缺口的完整证据链）、p3 ASSET 换行专项排查（证实为无头 Chrome 渲染抖动、非代码回归）——见同目录 `walkthrough.md`。

**要点摘要**：
- 13 对里 9 对（p1/p2/p3/p4/p5/m1/m2/m3/m5）零差异或仅数据字面重排（p2 全表编号因两次独立重铺整体重排，性质等同"单号字面因重铺而不同"）。
- m1 关键断言：Direction 只读值两侧均为 `Reduce`，方向公式收回后端后结果不变。
- 4 对（m4/m6a/m6b/m6-writeoff）因 `resolve-shot-targets.mjs` 的 `pick('HOLD_INVESTIGATING')` 不具场景排他性（11/12 个 open case 都提供该处置项），两次独立重铺各自命中不同底层 case——已用 `git show 4e3b0ef4:...` 逐字节比对确认相关函数（`directionNoteFor` 等）本波未被触碰，坐实为取证方法论既有缺口，非产品代码回归。已登记进波五骨架供后续参考。

## 五、文档收口四件摘要

1. **`BACKLOG.md:176` 已销账**：`- [x] ~~原文~~ —— **已修**（2026-09-21 第六幕波四）：波四收编修复：方向公式收回后端 cause-registry，出账翻符号用例入 cause-registry.spec（`cause-registry.spec.ts:178`）；前端 `rowAdjustmentPrefill`/`deriveKindDirection` 两处本地推导随之退役，改读后端下发的 `row.adjustmentPrefill.direction``，沿用文件内既有销账体例（`- [x] ~~原文~~ —— **已修**（日期）：说明`）。
2. **`CHANGELOG.md` 加一行**（顶部，`[2026-09-21]`）：说明观众唯一能感知的行为变化（提现类调账预填方向修对了）+ 结构重排摘要 + 闸门结果 + 13 对截图比对结论（含 CASE_HOLD 家族的既有缺口如实说明）。
3. **总纲状态行回写**：`specs/2026-09-19-act6-recon-cleanup-charter.md` 第 7 行「波四」从"spec 已立"改"已完成"，附 commit 链、闸门结果、物证目录指针；「波五」从"待开"改"骨架已立"。
4. **波五骨架新立**：`specs/2026-09-21-act6-wave5-skeleton.md`——只含总纲链接 + 承接上一波（实际偏差/新事实/判据达成事实）+ 已定事实 + 待定岔口（空，注明"无"），未展开波五 spec。承接节重点核对了波五要改的 7 处业务日文件：`reconciliation-query.service.ts` 本波被 T1 加了 12 行（import+两处挂载，1022→1034 行），总纲写死的行号 `:923` 大概率已漂移；其余 6 处（`business-date.util.ts`/`wallet-recon-run.service.ts`/`recon-thresholds.constant.ts`/`effective-cutoff.ts`/`push-order.service.ts` 两行）经 `git diff --name-only 4e3b0ef4..HEAD` 实证零触碰。

## 六、对照 `rules/delivery-checklist.md` 逐条

| 触发行 | 是否命中 | 说明 |
|---|---|---|
| 任何持久状态变化 → 写审计 | 否 | 本波零新增持久状态写点，纯前端结构重排 + 后端一处只读预填计算下沉 |
| 新增审计动作码 | 否 | 不涉及 |
| 新状态/新结局 | 否 | 不涉及 |
| 动了钱 | 否（`verify:coa` 作保守项加跑，非本波触发） | 记账路径零改动；见二、`verify:coa` 声明 |
| 该走 maker-checker | 否 | 不涉及 |
| 新增 maker-checker 审批策略 | 否 | 不涉及 |
| 新增权限组 | 否 | 不涉及 |
| 新增 admin 端点 | 否 | 不涉及 |
| 新增业务动作 | 否 | 不涉及 |
| 退役业务动作 | 否（自由选择死分支删除是死码清理，非业务动作退役——种子数据从未触发过该分支） | T6 判死双证在案 |
| 改了交易三域任一 | 否 | 不涉及 |
| 新字段/新状态到客户面 | 否——2026-09-21 实扫：`client-web` 对对账读面零消费，命中的 3 处 "reconciliation" 字面均为营销文案 | `getCase()` 新增的 `adjustmentBook`/`adjustmentPrefill` 字段仅 admin-web 消费 |
| 涉及金额 | 否（金额换算逻辑搬家未改算法） | 不涉及 |
| 对外识别 | 否 | 不涉及 |
| 新事件 | 否 | 不涉及 |
| 改 schema | 否 | 不触发重铺闸 |
| 改页面或种子 | 否（内容零变化，纯结构重排） | 不涉及 |
| 改了前端 | **是** | 起 preview + 13 张截图验证（本任务 Step 3，见四、） |
| 本任务是多波中的一波 | **是** | 承接记录写入波五骨架，本波 spec/plan 留待波五会话开工时归档（照波三→波四先例，收尾会话不代做归档） |
| 每轮收尾 | **是** | 文档分层收口 + CHANGELOG 一行 + BACKLOG 销账（见五、） |

## 七、合并要求（Step 8，只记录不执行）

merge 进 main 后：**build + 重启后端**（主栈跑 dist）；无新端点/权限变更，**不需要** `db:base:sync`；无 schema 变更，不触发重铺闸。

`Documentation updated: modules(none) / demo(none) / decisions(none) / 总纲状态行+CHANGELOG+BACKLOG:176 销账+波五骨架 — 波四前端拆分收尾闸全套通过（含一处取证方法论既有缺口如实记录），行为零差异证据齐全`
