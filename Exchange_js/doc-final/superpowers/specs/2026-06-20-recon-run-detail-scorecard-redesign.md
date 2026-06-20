# Run 详情页重设计 — 记分牌矩阵（可读性）

日期：2026-06-20
状态：脑暴对齐 + mockup 通过，待实现
触发：现 run 详情把 5 公式×2 币种×3 scope 摊成等权小行，可读性差。用户选"汇总优先：一眼健康度→定位失败"。
mockup：`recon_run_scorecard_redesign`（方案 A）。

---

## 0. 目标
REDESIGN 层 run 详情改为**健康条 + 币种×客户公司 2×3 记分牌 + 点格下钻**。一眼看 run 健不健康、空间定位破在哪、明细藏进下钻。只动 `ReconciliationRunsDetailPage.tsx` 的 REDESIGN 分支；legacy I1-I5 run 保留旧表。

## 1. 三段结构（main body，两栏壳不变）

**① 健康条（顶部，always）**
- 左：runNo(mono) + business date · mode · trigger。
- 右：总 verdict 徽章 —— 任一公式 FAIL → `Break`(adm-red pill)；全 PASS → `Balanced`(adm-green)。
- 下方 4 张指标卡（adm-bg）：`Formulas` (N pass / M fail) · `Open cases` (n) · `Worst Δ` (最大 abs delta + 其 ccy·book) · `Ledger integrity` (式1/式3 全 PASS → ok 绿 / 否则 red)。

**② 2×3 记分牌矩阵**
- 行 = scope：**Ledger-wide(F1·F3) · Client(F2·F4) · Firm(F5)**；列 = 币种（**动态**，从 invariantChecks 的 currency 去重，不硬编码 AED/USDT）。
- 格 = (scope, ccy)：该 scope 在该币种的公式聚合——
  - 全 PASS → 绿格(adm-green/10 bg + border)：`✓ balanced` + "k checks · Δ 0"。
  - 任一 FAIL → 红格(adm-red/10)：`⚠ break` + 该 scope 最差公式的 **Δ(大字 mono)** + 公式号 tag(F4/F5)。
- 格可点（role=button/tabindex/键盘）；选中 outline adm-amber/info。

**③ 下钻面板（点格更新）**
- 标题：`{scope} · {ccy}` + 右侧直链 caseNo(REC-…-C/F，有 case 才显) 或 "no case · balanced"。
- 表：该格的公式行 —— `CHK(F-tag) · FORMULA(label) · INTERNAL(lhs) ↔ EXTERNAL(rhs) · RESULT(✓ 或 Δ x，红)`。
- 默认展开"最差格"（worst Δ 那个）。

## 2. 数据映射（现有 API + getRun 补一个 cases join）
- 现 `getRun(runNo)` 返 `run + invariantChecks`（每 check：invariantCode 式1..式5 / currency / lhsLabel / lhsValue / rhsLabel / rhsValue / delta / status / severity）+ run summary（openedCount/reObservedCount/closedCount 等）。**当前不返 cases**。
- **最小后端增量**：给 `getRun` 加 `cases` —— 复用 `getLatestRedesignRun` 同款 join：`reconciliationCase.findMany({ where:{ lastObservedRunId: run.id }, orderBy:[{assetCode},{book}] })`，**不带 lineItems**（链接只需 caseNo）。`select: caseNo, assetCode, book, status, deltaAmount`。返 `{ ...run, cases }`。legacy run 拿到 cases 无害（旧分支不用）。
- formula→scope（前端 map）：式1/式3=LEDGER、式2/式4=CLIENT、式5=FIRM。
- 格状态：聚合该 scope 该 ccy 的公式 status；红格 Δ = 该 scope 最差(abs max) 公式 delta + 其 F-tag。
- 健康条统计：pass/fail = 全公式计数；worst Δ = 全局 abs max delta + 其 ccy；open cases = run.openedCount；ledger integrity = 式1/式3 全 ccy 全 PASS。
- 格→case 链接：`cases.find(c => c.assetCode===ccy && c.book===(scope==='CLIENT'?'CLIENT':'FIRM'))` → caseNo（点击 `navigate('/admin/reconciliation/cases/'+caseNo)`）。LEDGER 格无 case；找不到 case 的红格不显链接（容错）。

## 3. 约束
- **adm-* token 全覆盖零裸色**（mockup 用的是 visualize token，实现要翻成 adm-green/red/amber/bg/border/t1-t3）；英文；font-mono 数字。
- 两栏壳保留（main=三段，sidebar=Identity/Lifecycle 不变）。
- 仅 `layer==='REDESIGN'`；legacy run 保留现有 I1-I5 表。
- 复用共享原语（DetailCard/StatusPill/InfoField）；矩阵格是新的小组件（page-local 可，或抽 ScorecardCell）。

## 4. 验收
- admin tsc -b 0 + build ✓；零裸色 grep。
- 渲染：健康条(Break+4卡) + 2×3 矩阵(Ledger 行绿、Client/Firm 红带 Δ) + 点 Client·AED 格下钻(式2 PASS/式4 FAIL LHS↔RHS↔Δ + case 链接)。截图比对 mockup。

## 5. 范围外
- case 详情页（本轮只动 run 详情；case 已是 book-aware）。
- list 页、external_balances/lines 页（另轮）。
