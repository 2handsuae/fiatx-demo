# 第六幕清残留 · 波五「业务日迪拜 COB + 文档收口」—— 骨架

> 总纲：`superpowers/specs/2026-09-19-act6-recon-cleanup-charter.md` §3 波五行
> 本文件是骨架，**不是 spec**。波五 spec 的展开是下一个新会话读总纲 + 本承接后跟业主脑暴的活，收尾会话不代做。

## 承接上一波（波四「前端拆分」，2026-09-21 收官）

- **后端读面契约本波有变更**（与波三"零变更"不同，如实记录）：T1 给 `getCase()` 响应新增了 `adjustmentBook` 字段与各 `flowComparison` 行的 `adjustmentPrefill` 字段（非破坏性新增，前端消费点本波已同步迁移完毕）。波五若也要读这个响应，字段集合比波三骨架记录的更大，注意核对。
- **波五要改的 7 处业务日文件，本波逐一核对是否被拆分挪动过位置**（复现命令 `git diff --name-only 4e3b0ef4..HEAD`，只列与本节相关的 6 个候选文件的命中情况——完整改动文件清单见本仓库该 commit 范围的 git 历史，此处不整段贴出）：
  ```
  business-date.util.ts                → 未出现在改动列表，零触碰
  wallet-recon-run.service.ts          → 未出现在改动列表，零触碰
  recon-thresholds.constant.ts         → 未出现在改动列表，零触碰
  effective-cutoff.ts                  → 未出现在改动列表，零触碰
  push-order.service.ts                → 未出现在改动列表，零触碰
  reconciliation-query.service.ts      → 出现在改动列表（T1 改动，见下）
  ```
  - `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts`（总纲记 `:923`）——**本波被 T1 改动**（+12 行：新增 import + `adjustmentBook`/`adjustmentPrefill` 两处挂载，文件从 1022 行涨到 1034 行）。总纲写死的行号 `:923` 大概率已漂移，**波五定位这处硬写 UTC 日终时改按符号名 / 上下文搜，不要直接跳行号**。
  - 其余 6 处（`business-date.util.ts`、`wallet-recon-run.service.ts:1055`、`recon-thresholds.constant.ts:26`、`effective-cutoff.ts:23`、`push-order.service.ts:204,206`）**本波零触碰**——均不在 `git diff --name-only 4e3b0ef4..HEAD` 的改动文件列表里，总纲记录的行号对这 6 处应仍然有效。
- **实际偏差**（对照波四 spec/plan 与 Task 1-6 实际执行）：
  - Ruling R1：`padStart(decimals + 1)` 的复现命令预期终态，plan 原文写 3 行，主会话裁定订正为 **4 行**（`utils/reconAmount.ts` ×2〔`formatAmount` 与 `minorToDisplay` 两个语义变体各一行同核〕+ `LedgerAccountList.tsx` + `AccountFlowList.tsx`〔账本域，spec §0 明文不做〕）——plan 漏算了 `minorToDisplay`，Task 7 复跑该命令实测确认 4 行。
  - Ruling R2：T5 搬运 Differences 大表时，`renderFunding` 与 `tableRef` 两个 helper 的定义位于搬运锚点注释之前，仍随段搬入 `CaseFlowTable.tsx`——裁定成立：spec §2.2「只搬 JSX 与所需 props」的「所需」涵盖段内唯一消费的 helper/ref，不搬会在页面留孤儿函数。
  - 行数实数超软目标（均已在各任务报告与本波 WRAPUP 给出结构性解释，非遗留未搬）：页面 `ReconciliationCasesDetailPage.tsx` **741 行**（软目标 650，超 91 行——5 个弹层的状态编排/handler/挂载）；弹窗 `ReconciliationAdjustmentCreateModal.tsx` **623 行**（软目标 450，理由=保留既有中文注释）；新组件 `CaseFlowTable.tsx` **568 行**（新件软目标 500，超 68 行——单次迁出的最大整块，491 行原样搬运，含 Ruling R2 的 `renderFunding`/`tableRef`）。
- **新事实**：
  1. **弹窗里残存一处波前既有的锚存在性 `side` 推导**：`ReconciliationAdjustmentCreateModal.tsx:220` `const side: 'FROM' | 'TO' = prefill.explainedFlowId ? 'FROM' : 'TO';`——这是"提交体"概念（哪个方向的锚字段要塞值），与本波收编的 `matchType`→`direction` 展示字段是两个不同概念，spec 范围未收编。波四未收，登记给波五（或后续波）斟酌是否也收回后端，本骨架不预判。
  2. **取证方法论缺口**（本波截图比对时发现，非产品代码缺陷）：`checkups/2026-09-21-act6-wave4-evidence/resolve-shot-targets.mjs` 的 `pick('HOLD_INVESTIGATING')` 选的是"尚未被占用、且提供该处置项的第一个案子"，不绑定专属场景——实测 11/12 个 open case 都提供 `HOLD_INVESTIGATING`（近乎通用兜底处置），导致两次独立重铺各自命中不同底层案件，`m4`/`m6a`/`m6b`/`m6-writeoff` 四张截图内容因此有别（非产品代码差异，根因定位见 `checkups/2026-09-21-act6-wave4-evidence/walkthrough.md`「CASE_HOLD 家族根因排查」节：`directionNoteFor` 等相关函数改动前后逐字节一致）。**波五若也用这套截图脚本取证**（含业务日切换验收），涉及具体 case 内容的部分不要默认"同一变量名 = 同一场景"，需要专属挑选逻辑（例如按 wallet 地址字面或固定 seed 索引）才能保证跨重铺可比。
  3. `resolve-shot-targets.mjs` / `shots.sh` 两份可复用脚本已入库 `checkups/2026-09-21-act6-wave4-evidence/`，before/after 全程同一份未改，波五如需截图证据可直接复用（结合上一条的已知缺口）。
- **判据达成事实**（波五开工前的干净基线）：
  - `BACKLOG.md:176`（提现类 `AMOUNT_MISMATCH` 缺翻符号）已销账：方向公式收回后端 `cause-registry`，前端 `rowAdjustmentPrefill`/`deriveKindDirection` 两处本地推导退役，改读后端下发的 `row.adjustmentPrefill.direction`；出账翻符号用例见 `cause-registry.spec.ts:178`。
  - utils 层新增/扩充：`admin-web/src/utils/reconTypes.ts`（对账域公共类型）、`reconAmount.ts`（`formatAmount`/`minorToMajorPlain`/`isZeroAmount`/`minorToDisplay`/`displayToMinor`）、`reconBucketMap.ts`（新增导出 `TONE_CLASSES`）、`causeRegistry.ts`（新增导出 `MATCH_TONE`/`MATCH_LABEL`/`COA_PHRASE`）——波五若涉及日期/金额展示相关的前端改动，先查这几个文件是否已有现成实现，不要另起一份。
  - `admin-web/src/components/reconciliation/` 目录新立 7 个文件（`CaseFlowTable.tsx` / `CaseBalanceTiles.tsx` / `CaseHistory.tsx` / `DispositionFindingModal.tsx` / `ReattributionCandidatePicker.tsx` / `WriteOffPrereqPanel.tsx` / `caseDetailBits.tsx`），案件详情页与调账弹窗的 JSX 已迁出对应板块。
  - jest 对账三域基线：**29 suites / 567 tests**（波前 561 → T1 在既有的 `cause-registry.spec.ts` 与 `reconciliation-query.service.spec.ts` 两个文件内新增用例 +6 tests，suite 数不变）。
  - `verify:coa` 全绿（4 条恒等式 + 57 科目负余额检查）；栈级输出（`demo:all`/`recon:demo:break`）归一后与波前基线逐字节比对为空。
  - 13 对页面/弹层截图逐张比对：12 张结构/文案/按钮组/布局零差异（允许差异仅单号与时间戳字面）；1 组 4 张（`m4`/`m6a`/`m6b`/`m6-writeoff`）因上述取证方法论缺口两侧命中不同底层案件，已根因定位为非代码回归。

## 已定事实（波四带过来的，波五开工前必须知道）

- **方向公式主体已归位**：调账开单/锁定两条路径的方向（Direction）计算统一由后端 `cause-registry.ts` 的 `resolveAdjustmentPrefill`/`directionNoteFor` 给出，前端只读不算；提现类 `AMOUNT_MISMATCH` 翻符号已入网。
- **utils 层已成型**：类型 / 金额换算 / 色调词表三类公共代码已从页面剥离，见上方"判据达成事实"清单。
- **组件已拆分**：案件详情页（741 行）现状即"状态编排 + 版面组装"，Differences 大表、余额瓦片、案件历史、定性弹层、候选选择器、核销前提区均已是独立组件；调账弹窗（623 行）已去掉"自由选择成因/方向"死分支，只剩 kind 模式与 locked 模式两条真实路径。
- **反向 import 已断根**：6 处历史上"页面被组件反向 import"的写法已改道 utils 层，页面自身不再 `export` 这些符号（`default` 导出保留）。

## 待定岔口

**无**——波五范围已在总纲 §3 波五行定稿（业务日按迪拜 COB 切，7 处 + §G 剩余演示可见项 + 文档 5 处数字腐烂修订；验收口径=重铺闸对照 `demo/baseline.md` 全绿 + `verify:coa` + 跨日切场景 9 按剧本实走 + `modules/v8-recon.md` 与代码逐数复核），本次收尾任务执行过程中未发现需要业主重新拍板的新岔口。若波五新会话展开 spec 时发现总纲范围与代码现状有出入（例如业务日切换与本波新增的 `adjustmentPrefill` 读面之间有交互），按惯例在波五 spec 里如实列出，不在本骨架臆测。
