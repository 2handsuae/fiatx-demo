# 戊波三「公司侧读面闸门 + 收官」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把公司侧三个数字口径（NLA、看板、交付合同）改成跟「按钱包开户」的新账本一致，撤掉云端重摆按钮，清掉波二停放的小项与三桶债务，把整场战役戊的文档收官到「`modules/` 即现状」，全部闸门绿。

**Architecture:** 先改最深的一层——NLA 公式与算术门触发条件（T1，动钱的门，评审升档），看板随之改版（T2）；四件互不依赖的退役 / 搬家 / 删桶 / 夹具修复并列（T3–T6）；停放小项分后端、前端两任务（T7–T8）；代码全部落定后再改文档（T9 清册前六项 → T10 剧本基线与七幕走查）；最后全量闸、计数终态、证据、终审（T11）。每个任务自带测试与截图，收尾一次全量。

**Tech Stack:** NestJS + Prisma + SQLite + TigerBeetle 0.17.3；React admin-web；jest（根目录跑，roots 含 `admin-web/src`）；e2e 经 `bash scripts/on-stack.sh self test:e2e`；preview 截图经 `demo-shot.js` 或内置浏览器。

**Spec:** `doc-final/archive/superpowers/specs/2026-11-07-campaign-e-wave3-closeout-spec.md`（已随合并归档）（§0 裁定 1–13 与 §0.1 施工检查订正 1–22 是权威；§1 已核事实的行号凡与 §0.1 冲突以 §0.1 为准；总纲 `2026-11-06-campaign-e-ledger-by-location-charter.md` §6 终闸；骨架 `2026-11-06-campaign-e-wave3-skeleton.md` 的承接与数字基线）

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用。
- 本轮特有：
  - NLA = `F_OPS + F_FEE + F_LIQ` 六个现金户折 AED 之和，`F_SET` 与码 51 不读；余额口径与折算不变（spec §3）。门只在钱离开公司时过：付款单恒调、LP 兑换单恒调、调拨单不调（spec 裁定 2）。
  - 零新审计码、零新端点、零新审批、零新状态、零 schema 改动；`recon:demo:*` 脚本与 R37 前置闸保留；科目页版式不动。
  - 预期终态数量（spec §12）：RBAC 15 域 / **87** 桶 / 96 组；审计现役 386（词表种子行 393）；门调用点 **2**；`demo-ops` 端点 2；e2e 基线 B 集 **20** 名；`decisions.md` +11 行。**对不上就停**。
  - 每条 shell 命令前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`；`demo:*` / `recon:demo:*` / `verify:*` / `test:e2e` 一律经 `bash scripts/on-stack.sh self <script>`；worktree 内只碰 self 栈。
  - 每个任务 prompt 带项目总纲 `CLAUDE.md` §0–§5 要点；执行档 `sonnet`，评审档 `opus`；**T1 动钱的门，任务级评审升 `opus`**；其余任务级评审 `sonnet`；终审 `opus`。
  - 证据目录 `doc-final/superpowers/checkups/2026-11-07-campaign-e-wave3-evidence/`；e2e 对照协议照波二（冷缓存 `--cacheDirectory=<新空目录>`、私库每轮重铺、比失败名集合）。
  - 闸门：每任务随手闸 ①②③ + 相关 jest；改前端必 preview 截图；T11 收尾闸 ⑥⑦⑧。
  - commit message 不加署名行；每任务一个提交（T8 两个）。

## Review Focus

1. **F_SET 里有钱时 NLA 不含它**（结算钱包法币第一腿到账、第二腿未推）：NLA 不变 → T1 单测「F_SET 大余额不入 NLA」。
2. **新口径下场景 31 仍破线、32 仍回线**（手续费 114.00 + 前厅 36 USDT 折算后缺口 ≈ 85,001.54）：→ T10 实走取数；若不破线停下回主会话，不改事故金额。
3. **付款单 from = 手续费户在破线窗口被拒、调拨单两向照常成功**：→ T1 e2e 两条（spy `computeStatus` 造破线窗口）。
4. **已结案的对内不平案侧栏 Books Δ 仍显示数字**（`internalDeltaAmount` 存在即显示，不看状态）：→ T8 截图一张 RESOLVED 的对内不平案 + 一张 OPEN 的。
5. **流水页的 `assetCode` 是 code 形态还是 currency 形态**：`currencyOf` 两种都收 → T8 对 USDT-TRON 流水截图核 6 位小数，而不只核科目页。
6. **删掉重摆端点后空库上 `recon:demo:break` 仍 18/18、带锚处置后仍被拒**：→ T11 重铺闸 + 一次带锚拒绝实测。
7. **删两桶后 `verify:rbac` 红集不变**（仅 S7 四行）：→ T5。

---

### Task 0: 对照组与基线复用（改前）

**Files:**
- Create: `doc-final/superpowers/checkups/2026-11-07-campaign-e-wave3-evidence/README.md`、`counts-before.md`、`nla-status-before.json`、`t0-dashboard-before.png`、`t0-ledger-usdt-tron-before.png`、`t0-flows-usdt-tron-before.png`、`t0-demo-ops-panel-before.png`

**Interfaces:** 产出改前对照供 T11：NLA 状态 JSON（`perAsset` 两行、`nlaAedMinor` = 口径二）、计数、四张截图；e2e 基线**不重跑**，复用波二 `e2e-after-8b40965d.md` 的 B 集 22 名。

- [ ] **Step 1**: 隔离 worktree（`superpowers:using-git-worktrees`，放 `.claude/worktrees/campaign-e-wave3-<id>/`），`npm ci` 根 + `admin-web` + `client-web`；`bash scripts/stack.sh reset self` → `up` → `bash scripts/on-stack.sh self demo:all` 35/35
- [ ] **Step 2**: 证明 e2e 基线可复用：`git diff 8b40965d HEAD --stat -- src test scripts admin-web prisma` 为空（只允许 `doc-final/` 差异）；结果写进 README「基线复用依据」。不为空则按波二协议重跑全量 e2e 采 B 集
- [ ] **Step 3**: `curl -s -H "Authorization: Bearer <金库 token>" http://localhost:<self API 端口>/admin/prudential/status > nla-status-before.json`；`npm run audit:vocab`（exit 1、29 码清单）与 RBAC 计数（spec §1「权限桶」的并集脚本：15 / 89 / 96）写 `counts-before.md`
- [ ] **Step 4**: preview 截图四张：看板全页、科目页按 USDT-TRON 筛（小数位 bug 现状）、流水页按 USDT-TRON 筛、`DEMO_OPS=1` 起后端后的 Demo Data 面板（含「Restore recon scenarios」块）
- [ ] **Step 5**: Commit `chore(戊波三): 对照组采样——NLA 状态、计数、四张改前截图`

### Task 1: NLA 三算两不算 + 门只在钱离开公司时过（评审升 opus）

**Files:**
- Modify: `src/modules/asset-treasury/prudential/prudential.service.ts:58-80, 95-131`（`PrudentialStatus` 加 `perWallet`；`computeStatus` 三角色 × 两资产）；`prudential.controller.ts:28`（summary 文案）
- Modify: `src/modules/asset-treasury/company-funding/vendor-payment-workflow.service.ts:94-95`（去 F_OPS 条件）；`house-transfer-workflow.service.ts:95`（删门调用；`prudential` 注入若无其他用处随删）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（`treasury.view_dashboard` description 改「company wallets, due from LP, income and expenses」）
- Test: `prudential.service.spec.ts`（mock `:37, :55` 按角色；断言 `:94-98, :109-114, :132, :135, :171` 重写；`:185-189, :332` 加 `perWallet`；删 `:300, :310`；新增 F_SET 用例）；`vendor-payment-workflow.service.spec.ts:222, 337`；`house-transfer-workflow.service.spec.ts:76, 128-134`；`test/vendor-payment-from-wallet.e2e-spec.ts:156, 161, 205`；`test/house-transfer.e2e-spec.ts:329`

**Interfaces:**
- Produces: `PrudentialStatus.perWallet: Array<{ vaultCode: 'F_OPS' | 'F_FEE' | 'F_LIQ'; label: string; assetCode: string; currency: string; balanceMinor: string; aedEquivalentMinor: string }>`（六行，顺序 F_OPS → F_FEE → F_LIQ，每角色内 AED 先 USDT 后）；`perAsset` 语义 = 该币种三钱包合计；`label` = `VAULTS[vaultCode].label`。
- Produces: `PrudentialOrderKind` 不再含 `'HOUSE_TRANSFER'`。

- [ ] **Step 1**: 写红测试：`prudential.service.spec.ts` ① `resolve` 被以 `(assetId, 'F_OPS' | 'F_FEE' | 'F_LIQ')` 各调两次（共 6 次）、`resolveCashAccountId` 6 次；② mock 给 F_OPS(AED) 100、F_FEE(AED) 10、F_LIQ(AED) 5、F_SET(AED) 1000 → `nlaAedMinor` = 115 折算后（F_SET 不入）；③ `perWallet` 六行字段齐、`perAsset` 为合计；④ 删 `:300, :310`。`vendor-payment-workflow.service.spec.ts:222` 改为 from = F_FEE 时 `assertPostOutflowCompliant` **被调**，`:337` 同；`house-transfer-workflow.service.spec.ts:104-126` 改为两向都**不调**，`:128-134` 删
- [ ] **Step 2**: 跑三支 spec，确认红（`npx jest src/modules/asset-treasury/prudential src/modules/asset-treasury/company-funding`）
- [ ] **Step 3**: 实现 `computeStatus()`：`for role of ['F_OPS','F_FEE','F_LIQ'] for asset of assets` → 六次解析与查余额，汇总 `perWallet` / `perAsset` / `nlaAedMinor`；付款单去条件；调拨单删调用与注入；`PrudentialOrderKind` 去 `'HOUSE_TRANSFER'` 及其分支；controller summary 与 catalog description 文案
- [ ] **Step 4**: 跑三支 spec 绿；`npx tsc --noEmit -p tsconfig.json` 零输出
- [ ] **Step 5**: e2e：`vendor-payment-from-wallet.e2e-spec.ts` 反转 `:156, 161, 205`，并新增一条「spy `computeStatus` 返回 headroom 刚好小于出款额 → from = F_FEE 开单 400 `PRUDENTIAL_GATE_BLOCKED`」；`house-transfer.e2e-spec.ts:329` 反转，并新增一条「同款破线 spy 下 F_OPS → F_FEE 与 F_FEE → F_OPS 都开单成功」。`bash scripts/on-stack.sh self test:e2e -- --runInBand test/vendor-payment-from-wallet.e2e-spec.ts test/house-transfer.e2e-spec.ts` 全绿
- [ ] **Step 6**: `curl …/admin/prudential/status` 看 `perWallet` 六行、`nlaAedMinor` = 六行 `aedEquivalentMinor` 之和（node 一行比对），结果存证据目录 `t1-nla-status-after.json`
- [ ] **Step 7**: Commit `feat(戊波三): NLA 三算两不算（F_OPS+F_FEE+F_LIQ）、perWallet 明细、门只在钱离开公司时过`

### Task 2: 公司资金看板改版

**Files:**
- Modify: `admin-web/src/pages/CompanyFundsDashboard.tsx`（NLA 区 :437-535 加三小格与脚注；① ② ③ 三格 :544-593 合成「Company wallets」表；新增「Expenses」格放在 ④ Income 之后；副标题 :409；`cashAccountsByRole` 加 `F_FEE`；`OperatingBalanceCard` 的低水位红 :173-175 迁到 Operations 行）
- Test: 无单测（页面）；截图

**Interfaces:**
- Consumes: T1 的 `PrudentialStatus.perWallet`；既有 `/admin/tb/accounts?ownerType=WALLET&code=50`（已含 F_FEE 行）与 `ownerType=SYSTEM`（已含 300–302）。

- [ ] **Step 1**: 改 `PrudentialStatus` 前端类型加 `perWallet`；NLA 区大数字下渲染三小格（标题 = `label`，格内按 `assetCode` 两行 `currency balance`）+ 脚注「Not counted: Company Settlement (money already on its way to a client) and amounts due from LP (not yet received). USDT at the pegged rate.」
- [ ] **Step 2**: 「Company wallets」表：行序 Operations / Fees / Liquidity (LP front hall) / Settlement (fiat only)，列 Wallet｜AED｜USDT｜In NLA；前三行 pill `counted`、Settlement 行 `in transit`；Settlement 的 USDT 格「—」；Operations 行数字低于阈值变红并带 title（沿用 :173-175, :192 逻辑）；删 ① ② ③ 三个 `DetailCard`
- [ ] **Step 3**: 「Expenses」格：从 SYSTEM 户里按码 300 / 301 / 302 各取按币种排序的行，户名字面照科目页；副标题改「Firm liquidity at a glance — company wallets, due from LP, income and expenses」
- [ ] **Step 4**: `cd admin-web && npx tsc -b --noEmit` 零输出；preview 起管理台（金库号登录），截图 `t2-dashboard-light.png`、`t2-dashboard-dark.png`；同一时刻科目页按 `code=50` 筛的七户余额截图 `t2-ledger-code50.png`，在证据 README 列「看板格 ↔ 科目页户」八格数字对照表（AED/USDT × 四钱包，Settlement USDT 为「—」）
- [ ] **Step 5**: Commit `feat(戊波三): 看板四钱包一格 + NLA 三小格 + 开支格`

### Task 3: 云端面板撤重摆按钮、端点退役、脚本死段删除

**Files:**
- Modify: `admin-web/src/components/DemoOpsPanel.tsx`（删 :137-159 块、:11-14 `reconBreak`、:4 头注释、:55 `busy` 的 recon 引用、`requestReconBreak` 与三个 recon 状态）
- Modify: `src/modules/demo-ops/demo-ops.controller.ts:33-39`（删）；`demo-ops.service.ts`（删 `startReconBreak`、`reconBreak` 状态与 `status` 返回体字段）
- Modify: `scripts/recon-demo.ts:116-117, 495-497`（删）
- Test: `demo-ops.service.spec.ts:43-46, 93-134`；`demo-ops.controller.spec.ts:10, 15, 24`

**Interfaces:**
- Produces: `GET /demo-ops/status` 返回体不含 `reconBreak`；`POST /demo-ops/recon-break` 不存在（404）。

- [ ] **Step 1**: 改测试：`demo-ops.service.spec.ts` 删 `startReconBreak` describe、readStatus 断言去 `reconBreak`；`demo-ops.controller.spec.ts` 删三处、用例名改「两条路由」；跑 `npx jest src/modules/demo-ops` 确认红
- [ ] **Step 2**: 删后端端点、service 方法与状态字段；删前端块与状态；删脚本常量与过滤段
- [ ] **Step 3**: `npx jest src/modules/demo-ops` 绿；三处 tsc 零输出；`grep -rn "recon-break\|reconBreak" src admin-web/src scripts deploy` 终态 0（结果存证据）
- [ ] **Step 4**: self 栈以 `DEMO_OPS=1` 起后端，preview 打开 Demo Data 面板截图 `t3-demo-ops-panel-after.png`（只剩重铺块）；`curl -X POST …/demo-ops/recon-break` → 404
- [ ] **Step 5**: `bash scripts/stack.sh reset self` → `up` → `demo:all` → `bash scripts/on-stack.sh self recon:demo:break` 仍 18/18（脚本未受影响）
- [ ] **Step 6**: Commit `feat(戊波三): 云端面板只留重铺——重摆按钮与 /demo-ops/recon-break 退役，recon-demo 死段删除`

### Task 4: 审计词表归 agent 维护

**Files:**
- Move: `doc-final/lark/2026-09-15-audit-actions-catalog-by-domain-workflow.md` → `doc-final/reference/audit-actions-vocab.md`（`git mv`）
- Modify: `scripts/export-audit-vocab.ts:23`（SEED 默认新路径）；`doc-final/reference/audit-actions-vocab.md`（头两行改写 + 29 行 + 域节码数）；`doc-final/lark/2026-09-16-audit-actions-catalog-full.md`（脚本重生成）
- Modify: `doc-final/rules/delivery-checklist.md`（「新增审计动作码」行加词表一句）；`CLAUDE.md` §8（加「新增审计码 → `reference/audit-actions-vocab.md`」一行；`:98` lark 行加括注）；`doc-final/TOOLING-DEBT.md:164`（销）、`:203`（`:136` → `:137`）

**Interfaces:**
- Produces: `npm run audit:vocab` exit 0；种子 393 行（364 + 29）。

- [ ] **Step 1**: `git mv`；改 SEED 默认；`npm run audit:vocab` 仍 exit 1、仍 29 码（证明路径已切、缺行未补）
- [ ] **Step 2**: 对 29 个码逐个读 `audit-actions.constant.ts` 的四属性与写点（grep 常量名找 `recordByActor` / `recordSystem`），按常量 `domain` 放进对应域节的既有或新开 `###` 分组（建议：TREASURY 域「公司调拨单（7）」「认损补缺（1）」「LP 两步准入补遗（4）」；`VENDOR_*` / `DD_*` / `DOCUMENT_UPLOADED` 按各自 `domain`），每行五列照 `:15-17` 格式，说明列中文一句人话
- [ ] **Step 3**: `npm run audit:vocab` exit 0、输出含 `386`；全量版 `git diff --stat` 只增不减；`grep -rn "2026-09-15-audit-actions" src scripts package.json` 终态 0
- [ ] **Step 4**: 三份规则文档改行；`TOOLING-DEBT.md:164` 划掉并注「2026-11-07 戊波三 T4 搬至 reference/，agent 维护」、`:203` 行号订正
- [ ] **Step 5**: Commit `docs(戊波三): 审计词表种子搬至 reference/ 归 agent 维护，补齐 29 码说明，audit:vocab 绿`

### Task 5: R19 删两个重复动作桶

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts:1127-1135`（删）；`scripts/verify-rbac.ts:871-875, 882`（注释、判断 `89 → 87`、预期串）
- Modify: `doc-final/demo/baseline.md:484`、`doc-final/modules/overview.md:61`、`doc-final/modules/company-funds.md:89`（两桶名改为归 funding 两桶）

**Interfaces:** 终态 15 域 / 87 桶 / 96 组。

- [ ] **Step 1**: 先改 S13d 期望为 87，`bash scripts/on-stack.sh self verify:rbac` 确认 S13d 红（现 89）
- [ ] **Step 2**: 删两桶；`grep -rn "view_house_transfers\|act_house_transfers" src scripts prisma admin-web/src test` 终态 0；三处文档改
- [ ] **Step 3**: 重启 self 后端（桶目录在内存，不跑 `db:base:sync`）；`verify:rbac` S13d 绿、红集仅 S7 四行（与 `TOOLING-DEBT.md:148` 恒等）；输出存证据 `t5-verify-rbac.txt`
- [ ] **Step 4**: preview 角色编辑器 Treasury 域截图 `t5-role-editor-treasury.png`（少两开关）；调拨单列表 / 建单仍可用（金库号）
- [ ] **Step 5**: Commit `fix(戊波三): 删 treasury.view/act_house_transfers 两个重复桶，S13d 89→87`

### Task 6: e2e 夹具按迪拜业务日 + 场景 9 加强断言

**Files:**
- Modify: `test/recon-aging-write-off.e2e-spec.ts:349, 414, 543`；`test/recon-supplement.e2e-spec.ts:276`；`test/recon-reattribution.e2e-spec.ts:126, 341`；`test/recon-adjustment-money-arcs.e2e-spec.ts:144, 400, 1058-1059, 1063, 1123-1128`
- Modify: `doc-final/TOOLING-DEBT.md:211`（销）

**Interfaces:** 四文件 `grep -c "toISOString().slice(0, 10)\|T23:59:59.999Z"` 终态 0；日期一律 `toBusinessDate()` / `endOfBusinessDate()` / `startOfBusinessDate()`（`src/modules/accounting/tigerbeetle/utils/business-date.util.ts`）。

- [ ] **Step 1**: 逐处替换；场景 9 `:1123-1128` 断言加强为「调账分录 `createdAt > endOfBusinessDate(PAST_DATE)` 且该行在重对账后 MATCHED」
- [ ] **Step 2**: `bash scripts/on-stack.sh self test:e2e -- --runInBand <四个文件>`：预期「recon-aging 主链路时区」与「recon-adjustment 用例 9」转绿，B 集里其余属于这四个文件的名（`recon-adjustment` 其他、`recon-aging` 其他）红名不变；多转绿或新红停下回主会话
- [ ] **Step 3**: 用波二 `e2e-baseline-0c6eb7b0.md` §4 拨钟配方再跑同四个文件一次，失败名与 Step 2 逐名一致（两种时钟同结果 = 时区依赖已消）；两次输出存证据 `t6-e2e-{real,shifted}.txt`
- [ ] **Step 4**: `TOOLING-DEBT.md:211` 划掉并注修法与两次跑的结果
- [ ] **Step 5**: Commit `test(戊波三): recon e2e 夹具改按迪拜业务日，场景 9 钉住截止过滤第三支`

### Task 7: 停放小项——后端（to 钱包文案、码 2 户名）

**Files:**
- Modify: `src/modules/funds-layer/domain/firm-wallet-picker.service.ts:16-33`（签名加 `side: 'from' | 'to'`；`side = 'to'` 时 code `TO_WALLET_NOT_ELIGIBLE`、文案「…cannot be chosen as the to wallet…」）；调用方 `internal-transfer-workflow.service.ts:128`、`vendor-payment-workflow.service.ts:91`、`house-transfer-workflow.service.ts:88-89`
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts:173, 183-184`（`Custody Shortfall Receivable · …`）
- Test: `firm-wallet-picker.service.spec.ts:67` + 新 to 向用例；`house-transfer-workflow.service.spec.ts:68-70, 98-99`；`vendor-payment-workflow.service.spec.ts:187, 219`；`internal-transfer-workflow.service.spec.ts:107`；`test/house-transfer.e2e-spec.ts:397`（断言码改 TO）；`wallet-cash-account.service.spec.ts:81, 102, 170`；`tb-account-codes.constant.spec.ts:156, 159`

**Interfaces:**
- Produces: `FirmWalletPickerService.assertEligible(walletId: string, assetId: string, side: 'from' | 'to', tx?: Prisma.TransactionClient): Promise<Wallet>`；错误码 `FROM_WALLET_NOT_ELIGIBLE` / `TO_WALLET_NOT_ELIGIBLE`；码 2 户名字面 `Custody Shortfall Receivable · <ownerNo> · <role>`。

- [ ] **Step 1**: 写红测试：picker spec 新增「side = 'to' 的 F_SET 钱包 → `TO_WALLET_NOT_ELIGIBLE`，message 含 `as the to wallet`」、`:67` 传四参；三份 workflow spec 的按参数断言加 side；mock `:68-70` 按 side 抛不同码；e2e `:397` 改 TO；码 2 户名五处断言改字面
- [ ] **Step 2**: 跑相关 jest 确认红：`npx jest src/modules/funds-layer src/modules/asset-treasury/company-funding src/modules/asset-treasury/internal-transfers src/modules/accounting/tigerbeetle`
- [ ] **Step 3**: 实现签名、文案、三处调用方传 side、户名字面
- [ ] **Step 4**: 同上 jest 绿；tsc ① 零输出；`bash scripts/on-stack.sh self test:e2e -- --runInBand test/house-transfer.e2e-spec.ts` 绿
- [ ] **Step 5**: Commit `fix(戊波三): to 钱包不合法报 TO_WALLET_NOT_ELIGIBLE；码 2 户名对齐常量英文名`
- [ ] **Step 6**: `stack.sh reset self` → `up` → `demo:all` → preview 科目页按码 2 筛截图 `t7-ledger-code2-name.png`；`verify:coa` 105 户全过

### Task 8: 停放小项——前端（Books Δ 侧栏、两页小数位）

**Files:**
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx:671`（下加 `SidebarKV label="Books Δ"`，读 `kase.internalDeltaAmount` 经 `formatAmount` 带符号，缺或 0 显示「—」）
- Modify: `admin-web/src/pages/LedgerAccountList.tsx:155-157, 184`、`admin-web/src/pages/AccountFlowList.tsx:116-121, 128`（改用 `companyFundsFormat.ts` 的 `buildAssetLookup` / `currencyOf` 按 `assetCode` → currency → decimals）
- Modify: `doc-final/BACKLOG.md`（销「小数位查找键」条；其「更深根因」句拆成新低优先级条目）

**Interfaces:** 无新接口。

- [ ] **Step 1**: 改三个页面；`cd admin-web && npx tsc -b --noEmit` 零输出；`npx jest admin-web/src` 绿（`companyFundsFormat.spec.ts` 必过）
- [ ] **Step 2**: preview：`bash scripts/on-stack.sh self recon:demo:break` 后用 T9 波二的造数法（`recon-internal-delta` e2e 的直记方式）在 self 栈造一张对内不平案，截图 OPEN 态侧栏 `t8-case-books-delta-open.png`；把它归零后 RESOLVED 态侧栏 `t8-case-books-delta-resolved.png`（Review Focus 4）
- [ ] **Step 3**: 科目页与流水页各按 USDT-TRON 筛截图 `t8-ledger-usdt-tron-after.png`、`t8-flows-usdt-tron-after.png`（与 T0 两张对照：6 位小数）
- [ ] **Step 4**: Commit `fix(戊波三): 案件侧栏 Books Δ；科目页与流水页小数位按 code→currency 查`
- [ ] **Step 5**: BACKLOG 两处改动（销 + 新条目）→ Commit `docs(戊波三): BACKLOG 小数位条销账、根因拆新条`

### Task 9: 文档清册 1–6（`delivery/` → `decisions.md` → `accounting-coa.md` → `coa-v3.md` → 模块分录句 → 成因手册）

**Files:**
- Modify: `doc-final/delivery/semantic-contract.md:24, 25, 28`；`decision-log.md:10, 15` + 新 D 条；`dependency-contract-status.md:8, 13`；`nonfunctional-baseline.md`（数字核）
- Modify: `doc-final/decisions.md`（+11 行，spec §9.2 ①–⑪ 逐条，末尾署名照 spec §0「谁定」列）
- Rewrite: `doc-final/modules/accounting-coa.md`（§0–§6 骨架不变，内容全换为现状）
- Modify: `doc-final/reference/coa-v3.md`（状态行改「现状」；§2 新增「七单与调账单记账总表」——总纲附录 B 按实际落地导出）
- Modify: `doc-final/modules/company-funds.md:12, 16, 42, 52, 99`、`lp-desk.md:8, 32, 36, 79, 113`、`overview.md:101`、`v8-recon.md` §1 / §5、`funds-orders.md`、`v6-swap.md`、`v7-treasury.md`；`scripts/recon-demo.ts:708` 注释；`doc-final/reference/recon-cause-handbook.md` 分录表

**Interfaces:** 每篇改后附「旧名 grep 只剩合法命中」命令与结果（证据 README 第 9 节表格）。

- [ ] **Step 1**: `delivery/` 四文件按 spec §9.1 改；D 条编号接既有末号；S9 依据改指 `decisions.md` 新 COA v3 条 + `reference/coa-v3.md`
- [ ] **Step 2**: `decisions.md` 追加 11 条（⑧ 必须点名 `:152` 的「`FIRM_LIQ` 在途不计」并写新事实；① 点名 `:13 / :24 / :149`）；`wc -l` = 181
- [ ] **Step 3**: 重写 `accounting-coa.md`；状态行写「Last Verified 2026-11-07（戊波三整篇重写，COA v3 现状）」；不留波次过程叙述
- [ ] **Step 4**: `coa-v3.md`：状态行、科目表核（码 2 英文名、户名模式）、新增 §2 记账总表（从总纲附录 B 逐行核对 `tb-transfer-codes.constant.ts` 与各 workflow 的 post 调用后导出，列：单据 / 步骤 / 转账码 / 借 / 贷 / eventCode）
- [ ] **Step 5**: 各模块分录句：每篇先 `grep -n -E "FIRM_OPS|FIRM_LIQ|FIRM_SET|FIRM_ASSET|CLIENT_ASSET|结算中转|客户资产池|公司资产|9 码|10 码|九码|\b201\b|\b203\b"` 取清单，改后同一 grep 只剩合法命中（审计码计数、HTTP 201）；`company-funds.md` 另写 NLA 新口径（三算两不算 + 门规则）与看板新格；`recon-cause-handbook.md` 分录表户名核
- [ ] **Step 6**: Commit `docs(戊波三): 交付合同、决策记录 11 条、科目表篇重写、coa-v3 定稿 + 记账总表、模块分录句`

### Task 10: 剧本 / 基线 / data / CLAUDE.md / 三桶债务 + 七幕走查

**Files:**
- Modify: `doc-final/demo/baseline.md:57, 283-289, 358, 484, 578` + RBAC 桶数、`audit:vocab`、B 集 20 名；`doc-final/demo/script.md`（NLA 数字约 20 行、`:230, :246, :532, :848`、看板格名）；`doc-final/demo/data.md`（只核不改，生成区零 diff）；`CLAUDE.md:143`；`doc-final/BACKLOG.md`（销 NLA 条；改「被锚定的调账单少付」末句；新增「账本三列表分组 + 钱包筛选（业主 2026-11-07 推迟）」「科目页十六进制 ID 列」；连同工作树 `:156` 业主条目一起提交）
- Create: 证据目录七幕走查截图 `t10-scene-<n>-*.png` 与 `t10-walkthrough.md`

**Interfaces:** NLA 口径一 / 口径二 / 场景 31 / 场景 32 四个数字以实跑为准写回基线与剧本。

- [ ] **Step 1**: `stack.sh reset self` → `curl …/prudential/status` 取口径一（预期 136,469,600）→ `demo:all` → 再取口径二（预期 ≈ 136,499,846）；写 `baseline.md:283-289`
- [ ] **Step 2**: 七幕走查：按 `script.md` 走完，重点场景 16 / 18 / 29 / 31 / 32 / 37 / 41（骨架「走查未覆盖」四项本波补走）；场景 31 记 NLA 破线数字、32 记回线数字；若 31 不破线停下回主会话（Review Focus 2）
- [ ] **Step 3**: 按走查结果改 `script.md` 的 NLA 数字行与门语义句、看板格名；`baseline.md` 其余行；`CLAUDE.md:143`；BACKLOG 四处
- [ ] **Step 4**: `bash scripts/on-stack.sh self demo:all` 后 `git diff --stat doc-final/demo/data.md` 为空
- [ ] **Step 5**: Commit `docs(戊波三): 剧本与基线按新 NLA 口径重钉、重摆口径、BACKLOG 销账与推迟项`

### Task 11: 收尾闸、全量 e2e、计数终态、证据、CHANGELOG、终审

**Files:**
- Modify: `doc-final/CHANGELOG.md`（+1 行）；证据目录 `README.md`（闸表、计数前后表、文档清册 ✓ 表、截图索引、e2e 新基线 `e2e-after-<sha>.md`）
- Modify: `doc-final/superpowers/specs/2026-11-06-campaign-e-wave3-skeleton.md`（「收尾记录」节：实际交付、偏差、归档待办）

**Interfaces:** 全部数字与 spec §12 终态表逐项对上；对不上停。

- [ ] **Step 1**: 随手闸 ①②③ 零输出；`npx jest`（根，全量）全绿，记套数 / 例数
- [ ] **Step 2**: 重铺闸 ⑧：`reset self` → `up` → `demo:all` 35/35 + 5/5 → `verify:coa` 105 户全 ≥ 0 → `recon:demo:pass` 21 钱包 0 案 → `recon:demo:break` 18/18 → `verify:coa` 再过；再走一次场景 16 认损补缺到落账后 `recon:demo:break` 被拒（R37 不变，Review Focus 6）
- [ ] **Step 3**: 全量 e2e 冷缓存（波二协议，私库重铺）：失败名集合 ⊆ B 集 22 且恰好少「recon-aging 主链路时区」「recon-adjustment 用例 9」两名 → 新基线 20 名写 `e2e-after-<sha>.md`；多一名少一名停
- [ ] **Step 4**: `verify:rbac`（S13d 87、红集仅 S7 四行）；`audit:vocab` exit 0；计数终态表（spec §12 十二行）逐项实跑填 `counts-after.md`
- [ ] **Step 5**: 证据 README：闸表、计数前后、文档清册 11 项 ✓ 表（每项附 grep 命令与结果）、截图索引（T0 / T2 / T3 / T5 / T7 / T8 / T10）、「看板 ↔ 科目页」对照表、`cloud:deploy` 待业主触发一句
- [ ] **Step 6**: `CHANGELOG.md` 一行（观众能感知：看板四钱包一格 + 开支格、NLA 新口径与门规则、云端面板只剩重铺、to 钱包报错、对内 Δ 侧栏、小数位修好、角色编辑器少两开关）；骨架「收尾记录」节；`CLAUDE.md §9` 报告行写进 README
- [ ] **Step 7**: Commit `docs(戊波三): 收尾证据、CHANGELOG、骨架收尾记录`
- [ ] **Step 8**: 终审（`opus`）：按 `rules/review-rubric.md` 三判据 + 逐条问「spec §2 做 ①–⑨ 的代码 / 文档在哪」「§12 十二行对上没有」「翻案条目⑧有没有点名 :152」；修复轮按 Global Constraints 档位；终审 Yes 后报主会话合并（合并后主会话归档总纲 + 骨架 + spec + plan，并按 `CLAUDE.md §10` 重启 main 栈 + `reset main`）
