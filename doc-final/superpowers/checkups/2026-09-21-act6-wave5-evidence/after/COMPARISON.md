# Task 11 Step 4 · after 对位截图集 · 逐张差异说明

对照口径：Ruling R1（严重度徽章锚点=**案件详情页**，列表页无徽章，不当缺陷）

## ① 案件详情页 · 严重度徽章 —— 对照 before-3

- before: `before/before-3-case-detail-intransit-leg.png`（REC20260921-013，旧案号，IN-TRANSIT + **HIGH** 徽章，"Push order →" 链接）
- after: `after/after-3-case-detail-severity-badge.png`（REC20260921-004，本轮案号，同一 wallet 概念（Alice AED 场景 1）IN-TRANSIT + **MEDIUM** 徽章，"Push order →" 链接仍在）
- 差异说明：
  1. 严重度徽章数值从 HIGH → MEDIUM —— **预期行为变化**（spec §2.2 严重度按币种拆线，`SEVERITY_LINES_MINOR` 新阈值表生效；本案 -498.00 AED 落在 MEDIUM 档 `[10,000, 1,000,000)` 分区内，同一套代码不同轮次的具体案值落点不同属正常）。
  2. "Push order →" 链接两版本均保留 —— **正确的非变化**：本案差异行来自 funds-order 推单（`FDO2609...`），不是 internal-transfer 腿，spec §2.3（T7 划转腿显式拒）只对 `order.internalTransferId` 非空的行生效，本行不受影响。
  3. 案号从 `-013` 变为 `-004` —— 数据噪声，非缺陷（案号按当轮开案顺序生成，非稳定标识）。

## ② run 详情页 · 恒等徽章 —— 对照 before-2

- before: `before/before-2-run-detail-break.png`（RUN20260921-1，BREAK 横幅 + Health Check 五桶卡片 19/7/1/2/9）
- after: `after/after-2-run-detail-break-invariant-pass.png`（RUN20260921-1，本轮，同一渲染：BREAK 横幅 + Health Check 五桶卡片 19/7/1/2/9）
- 差异说明：
  - **视觉上两图完全一致**——这是预期的：spec §2.1 T6 修正的是 `invariantStatus` 字段的**写入语义**（普通 BREAK 不再被误记为恒等 FAIL），而前端只在 `invariantStatus==='FAIL'` 时才渲染红色 INTERNAL BREAK 横幅（隐藏 Health Check）；普通 BREAK 场景（`invariantStatus==='PASS'`）两版本前端渲染路径相同，视觉不可区分。
  - **恒等徽章"现应 PASS"的证据落在数据层**，非像素层：本轮 sqlite 直查 `reconciliation_runs` 表 `RUN20260921-1` 的 `invariantStatus` 列值 = `PASS`（见 `gates-final.txt` 同级目录外的会话记录；命令：`sqlite3 dev.db "SELECT runNo,status,walletCount,breakCount,invariantStatus FROM reconciliation_runs"`）。T6 修正前（写入语义错误版本）这一行本会被误记为 `FAIL`——本轮验证其为 `PASS`，证明写入修正生效。
  - 补充证据：`run-internal-break.png`（T6 物证，真实停 TB 触发的 INTERNAL_BREAK run，展示 FAIL 态的红横幅+空表专用渲染，与本轮普通 BREAK run 形成对照，证明三态渲染逻辑存在且分流正确）。

## ③ 案件列表页 —— 对照 before-1

- before: `before/before-1-cases-list.png`（10 cases，无严重度列）
- after: `after/after-1-cases-list.png`（12 cases，无严重度列）
- 差异说明：
  - 列表页两版本均**不渲染严重度徽章**——按 Ruling R1，这是笔误订正后的正确现状（严重度锚点在详情页），非缺陷；不新开任务给列表页补徽章（超出 spec 范围）。
  - 案件数从 10→12：数据噪声（before-1 取数时点未必是全新重铺后的第一轮 recon:demo:break，可能叠加了额外测试动作产生的案件；本轮 12 = 18 场景经 wallet 分组后的固定 casesOpened 数，与 baseline.md 记录的 "18/18 场景 + 12/12 钱包桶" 判据一致）。

## ④ 划转单列表页（custody URL）—— 对照 before-5

- before: `before/before-5-internal-transfers-list.png`（1 transfer(s)，ITR260921756381，Executing）
- after: `after/after-5-internal-transfers-list-custody-url.png`（0 transfer(s)，空态提示）
- 差异说明：
  - **URL 前缀**：本轮通过点击 admin-web 侧栏「Custody」分组下的「Internal Transfers」到达，实测 `window.location.href` 确认落在 `/admin/custody/internal-transfers`（sidebar 链接 `href="/admin/custody/internal-transfers"`，非旧 `treasury/`）—— spec §2.5 T9 前缀统一 `custody/` 生效证据。
  - **数据量差异**（1→0）：before-5 的那笔在途划转是 Task 0 取证轮专门摆出的「划转腿在途态」复现配方产物（progress.md 记录的 anchor 单号 ITR260921756381，该配方文档明说"在取数轮 reset 后已不存在"）；本轮是全新 `stack.sh reset` 后仅跑过 `demo:all` + `recon:demo:break` + 场景 9 一条处置（Hold，不涉及划转单），尚未执行任何会创建 internal-transfer 的处置（认损补款、事故补款等），0 条记录是**正确的初始状态**，非回归。

## ⑤ 客户端充值详情 · Value date 字段 —— 顺带走查

- after: `after/after-6-client-deposit-detail-value-date.png`（`demo_grace@example.com` 登录，DEP260921770342，1,200 USDT）
- 走查结论：`Amounts` 区块正常渲染 `Submitted` / `Completed` 两个时间字段，无渲染错误或崩溃；`Value date` 字段按 `DepositDetail.tsx:91` 的条件渲染（`{tx.effectiveDate && <Field .../>}`）**正确地未显示**——因为该字段仅在充值经「平账推单回填」（`deposit-workflow.service.ts:69` 注释："普通实时流转恒为 undefined"）时才会被写入，`demo:all` 铺的普通充值（含本笔 Grace USDT 场景 9 关联的那笔 #22）从不经过该回填路径。
- 本轮数据库复查（`SELECT depositNo, effectiveDate FROM deposit_transactions WHERE effectiveDate IS NOT NULL`）返回 0 行，确认当前库内确无带值的样本可供正向截图；Task 11 范围（场景 9 = Hold·Next period，不涉及推单回填）未产生这类记录，追加执行场景 13/14/15 的补单流程超出本任务 Step 3 界定的场景 9 范围，故不追加。
- 结论：源码路径审查 + 空值正确渲染的实拍，两者共同确认 wave-5 的迪拜 COB 改动（本组件未被任何 wave-5 任务触碰）未影响该字段的展示逻辑——`tx.effectiveDate` 是纯字符串直显，不经过 `new Date()` 二次解析，不受业务日算法切换影响。
