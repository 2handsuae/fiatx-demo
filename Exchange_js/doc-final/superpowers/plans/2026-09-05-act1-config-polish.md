# 第一幕配置收尾小轮（六项）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清掉第一幕账面上"站上看得见、还没治"的六个小缺陷：暂停理由通用文案、限额规则号随机铸造孤儿身世、限额/费率 SEEDED 行 afterData 渲染 UUID、地址两 SEEDED 码无判据兜底、邀请过期冒充 REVOKED、徽章色板 583 处透明度类不产生 CSS。

**Architecture:** 无新结构。种子改确定性铸号与业务键 afterData；判据网补两块；一处审批元数据传递修根因；邀请加 `expiredAt` 列分离两种结局；色板改 Tailwind 透明度修饰符标准格式。全部单点修，互不依赖。

**Tech Stack:** 既有（NestJS/Prisma/SQLite ｜ React/Tailwind ｜ ts-node 判据脚本）。

## Global Constraints

- 通用交付清单见 `doc-final/rules/delivery-checklist.md`，全部适用
- 本轮特有：①每项修前先在 self 栈复现（BACKLOG 记录会烂，尤其 :21 标着"未复现"）；②种子改动 = 重铺闸（`stack.sh reset self` 起步）；③判据与身世断言禁扫源码文本；④色板与邀请两项必须截图（改前/改后对照）；⑤本工作树栈 = self（后端 3200 段自动分配，见 `.stackports`），绝不碰 3000-3003
- 出处（全部 2026-09-05 在 HEAD 复现过）：BACKLOG :21 / :82 / :84 / :86 / :90 / :378（行号以当日文件为准，销账时按内容匹配）

---

### Task 1: 种子身世治理——限额规则号确定性铸造 + 限额/费率 SEEDED afterData 换业务键

**Files:**
- Modify: `Exchange_js/prisma/seed.business.ts`（限额段 :425-492；swap 费率 :272-330；withdrawal 费率 :400-415）

**Interfaces:**
- Consumes: `buildDeterministicNo(prefix, ...segments)`（`src/common/utils/no-generator.util.ts:21`，产出 `TLR260101XXXX`，4 位哈希）
- Produces: 重铺后 15 条规则的 `ruleNo` 每次相同；三族 `*_SEEDED` 审计行 `afterData` 零 UUID（Task 2/6 的判据与文档依赖此）

- [ ] **Step 1: 复现**。`bash scripts/stack.sh reset self` 后 sqlite 查 `transaction_limit_rules` 与 `audit_log_events`（action LIKE '%_SEEDED'）：记录 ruleNo 随机、afterData 含 `assetId`/`fromAssetId` UUID 的现状（贴查询与输出）。
- [ ] **Step 2: 确定性铸号**。删 `no()` 随机生成器（:432-438），改为：SINGLE 规则 `buildDeterministicNo('TLR', 'SINGLE', op, a.currency)`；CUMULATIVE `buildDeterministicNo('TLR', 'CUMULATIVE', op, tier, period)`；LARGE_APPROVAL `buildDeterministicNo('TLR', 'LARGE_APPROVAL', 'WITHDRAWAL')`。保留 `usedNos` 集合但语义反转：撞号即 `throw new Error`（确定性输入撞哈希只能改段列表，禁静默重试；一次性操作 fail fast）。先 `grep -rn "TLR" scripts admin-web/src client-web/src test doc-final/demo` 确认无人硬编码旧号格式，贴结果。
- [ ] **Step 3: afterData 业务键**。`TRANSACTION_LIMIT_SEEDED` 的 `assetId` → `assetCode`（经 assets 数组 id→currency；tier 规则为 null）；`SWAP_FEE_LEVEL_SEEDED` 的 `fromAssetId/toAssetId` → `fromCurrency/toCurrency`；`WITHDRAWAL_FEE_LEVEL_SEEDED` 同理 → `assetCode`。铁律⑥：afterData 是管理台上屏物。
- [ ] **Step 4: 重铺验证**。`bash scripts/stack.sh reset self` 两次；sqlite 断言：规则恰 15 条、两次重铺 ruleNo 集合相同、`*_SEEDED` afterData 经 `grep -E '[0-9a-f]{8}-[0-9a-f]{4}'` 零命中、每条 SEEDED 行 subjectNo 都能 join 活规则/活档。`bash scripts/on-stack.sh self verify:demo-data` 全绿。
- [ ] **Step 5: 随手闸 + commit**。`npx tsc --noEmit -p tsconfig.json`；提交 `fix(种子): 限额规则号确定性铸造(重铺不再孤儿身世)+三族 SEEDED afterData 换业务键(铁律⑥)`。

### Task 2: verify:demo-data R5 补两块——地址两 SEEDED 码判据兜底

**Files:**
- Modify: `Exchange_js/scripts/verify-demo-data.ts`（`scanR5` :154-210）
- Read: `Exchange_js/scripts/demo-lib.ts` :337/:353/:378/:403 四处 `writeSeedAudit`（subjectNo 用什么键以现场为准）

**Interfaces:**
- Consumes: `writeSeedAudit` 写行 `actorNo: 'DEMO_SEED'`；种子提现地址判别器 `ownershipProofType = 'DEMO_FIXTURE'`
- Produces: R5 新增 `CUSTOMER_DEPOSIT_ADDRESS_SEEDED` / `WITHDRAWAL_ADDRESS_SEEDED` 两块

- [ ] **Step 1: 读写点定键**。确认两码 subjectNo 的实际取值（钱包行 walletNo / 地址 addressNo），贴 demo-lib 四处原文。
- [ ] **Step 2: 加两块**。每块两向：(a) 行数 ≥ 1（写点被删 → 0 → 红，这就是 BACKLOG:86 的失效场景）；(b) 每行 subjectNo join 活体（钱包表 / 地址表），孤儿 → 红；提现地址块加第三向 (c)：`ownershipProofType='DEMO_FIXTURE'` 的活地址每条都有对应 SEEDED 行。风格照抄现有五块（业务键 join、非计数）。注意两码 actorNo 是 `DEMO_SEED` 不是 `RELEASE`。
- [ ] **Step 3: 变异测试**。fresh 库跑 `demo:all` → `verify:demo-data` 绿；`sqlite3` DELETE 一条 `CUSTOMER_DEPOSIT_ADDRESS_SEEDED` 行 → 重跑 → (a) 向红（贴红输出）；`reset self` + `demo:all` → 复绿收尾。
- [ ] **Step 4: 随手闸 + commit**。`npx tsc --noEmit -p tsconfig.json`；提交 `test(verify:demo-data): R5 补地址两块 DEMO_SEED 判据——写点被删/孤儿身世都兜得住`。

### Task 3: 资产暂停理由——复现、修元数据断链、测试

**Files:**
- Trace: `Exchange_js/src/modules/asset-treasury/assets/asset-suspension-workflow.service.ts`（:56 请求侧 ｜ :136-172 `executeSuspension`，:144 `event.metadata?.reason || 'Approved suspension'`）→ `asset-suspension-approval.service.ts`（`createAndSubmit` 建案传什么 metadata）→ `src/modules/governance/approvals/approval-handler.base.ts:35 emitDecidedEvent`（事件 metadata 从哪来）
- Test: 对应 `.spec.ts`（行为断言：`suspendAsset` 收到提交时填的 reason）

- [ ] **Step 1: 复现**（BACKLOG:21 标"未复现"，先证真）。self 栈：ops_officer 对 USDT-TRON 提暂停填 reason `POLISH-REPRO-<时间戳>` → ciso 批 → sqlite 查 `assets.suspendReason` + 详情页截图。若已 == 提交理由 → 缺陷不存在，报告后销账即止（本任务只剩 Step 4 的文档说明）。
- [ ] **Step 2: 定层修复**。沿链找 reason 丢失的那一环（大概率是建案 metadata 没带 reason，或 emitDecidedEvent 没转发案上 metadata）。在**正确的层**补传：不许在 executeSuspension 里回查审计日志拼理由。恢复侧（reactivation）无 reason 输入，确认不受影响即可。
- [ ] **Step 3: 测试**。红→绿：spec 断言批准落地时 `suspendAsset(id, '<提交的 reason>')`；跑 `npx jest src/modules/asset-treasury/assets/`。同链的其他消费方（若 emitDecidedEvent 改了）：`grep -rn "metadata" src --include='*-workflow.service.ts' | grep "event.metadata"` 逐个确认无行为变化，贴清单。
- [ ] **Step 4: 真机复验 + commit**。重跑 Step 1 场景 → suspendReason == 提交理由，详情页截图（改前/改后）；`npx tsc --noEmit -p tsconfig.json`；提交 `fix(资产): 暂停理由随审批链落地——详情页显示提交时填的理由而非通用文案`。

### Task 4: 邀请自然过期不再冒充 REVOKED

**Files:**
- Modify: `Exchange_js/prisma/schema.prisma`（`AdminUserInvitation` 加 `expiredAt DateTime?`）+ 新迁移文件（空库能建；不写 backfill，重铺即达终态）
- Modify: `Exchange_js/src/modules/identity/users/admin-invite-workflow.service.ts`（`sweepExpiredInvites` :478-：改盖 `expiredAt`，where 加 `expiredAt: null`）
- Modify: `Exchange_js/src/modules/identity/users/users.service.ts`（`mapInvitationStatus` :80-95：REVOKED → USED → (`expiredAt` 或 `expiresAt<=now`) EXPIRED → PENDING）
- Test: `users.service` / `admin-invite-workflow` 对应 spec

**Interfaces:**
- Produces: 派生态 `EXPIRED`（前端 `PlatformMemberDetailPage.tsx:34` 联合类型已含，无前端改动预期）

- [ ] **Step 1: 复现**。self 栈建一张邀请 → sqlite 把 `expiresAt` 拨到过去 → 手动触发 sweep（直接调服务或等 cron）→ 详情页显示 REVOKED，截图。
- [ ] **Step 2: 迁移 + 三处改**。改前 `grep -n "revokedAt" src/modules/identity/users -r` 逐处确认没有别的逻辑依赖"sweep 盖 revokedAt"（激活消费路径 :140 已按 `expiresAt` 拒，预期无依赖；贴清单）。`ADMIN_INVITE_EXPIRED` 审计照写不动。
- [ ] **Step 3: 测试**。红→绿：sweep 盖 `expiredAt` 不盖 `revokedAt`；映射对 swept 行回 `EXPIRED`、对人工撤销行仍 `REVOKED`。`npx jest src/modules/identity/users/`。
- [ ] **Step 4: 重铺 + 截图 + commit**。动了 schema → `bash scripts/stack.sh reset self` 全绿起栈；重跑 Step 1 场景 → 显示 EXPIRED，截图；`npx tsc --noEmit -p tsconfig.json && cd admin-web && npx tsc -b --noEmit && cd ..`；提交 `fix(IAM): 邀请自然过期与管理员撤销分列(expiredAt)——超时邀请不再显示成 REVOKED`。

### Task 5: 徽章色板——525 处透明度修饰符类真正产出 CSS

**Files:**
- Modify: `Exchange_js/admin-web/src/index.css`（:10-23 亮色 + :27-40 暗色，14 变量 × 2 块：hex → `R G B` 三元组；:55-56 等本文件内 `var(--adm-*)` 直接消费处包 `rgb(...)`，先 grep 全）
- Modify: `Exchange_js/admin-web/tailwind.config.js`（:28-41 十四条 → `'adm-bg': 'rgb(var(--adm-bg) / <alpha-value>)'` 格式）
- Modify: 四处内联消费 `var(--adm-border)` → `rgb(var(--adm-border))`：`AdminLogin.tsx:307` / `ResetPasswordPage.tsx:136` / `AdminInviteActivate.tsx:167` / `AdminMfaBindingPage.tsx:432`

- [ ] **Step 1: 消费面清点**。`grep -rn "var(--adm" admin-web/src` 全量列出（截至排期为 index.css 内部 + 上述 4 处 tsx）；`grep -rn "var(--adm" client-web/src src` 确认域外零消费。有新增处一并转换。
- [ ] **Step 2: 机械转换**。hex → 十进制三元组（如 `#f8fafc` → `248 250 252`），28 个值全换；config 14 条换格式。自检：`grep -c "#" index.css` 的 --adm 块内为 0；抽两个值手算核对。
- [ ] **Step 3: 渲染验证（本任务的闸，tsc 不算数）**。preview 起 admin（self 栈 3201 段）：改前先截 L1GateCard 裁决徽章（`bg-adm-green/10 border-adm-green/25`，任一充值详情）与审批详情状态徽章作对照；改后同页同位截图——期望淡色底/边出现；再抽两张只用裸 `bg-adm-*` 的页面（成员列表、资产详情）亮暗双色各一张——期望与改前无差。`cd admin-web && npx tsc -b --noEmit`。
- [ ] **Step 4: commit**。`fix(admin/色板): adm-* 改 rgb(var/<alpha-value>) 标准格式——525 处透明度修饰符类从不产 CSS 到生效`。

### Task 6: 文档收口 + 收尾闸

**Files:**
- Modify: `Exchange_js/doc-final/BACKLOG.md`（按内容匹配销六条：暂停理由 / ruleNo 孤儿 / afterData UUID / 地址两码判据 / 徽章色板 / 邀请过期；Task 3 若判"缺陷不存在"该条照销、销账语写实测结论）
- Modify: `Exchange_js/doc-final/CHANGELOG.md`（一行）；`demo/data.md` 若 Task 1 报告规则号上镜内容变化则同步；`modules/` 预期零改（六项全是修不符，不改口径——逐项确认后在报告里说一句）

- [ ] **Step 1: 销账 + CHANGELOG**。
- [ ] **Step 2: 收尾闸全套（本工作树 self 栈）**。三随手闸 tsc → `npx jest src/modules/identity/users src/modules/asset-treasury/assets`（本轮动过的目录）→ `bash scripts/stack.sh reset self` → `on-stack.sh self verify:rbac` → `on-stack.sh self verify:act1`（新库先跑，V 组不可复跑）→ `reset self` → `on-stack.sh self demo:all` → `verify:coa` / `verify:audit` / `verify:demo-data`。判据全绿，贴每道输出尾部。
- [ ] **Step 3: commit**。`docs(第一幕小轮): 六项销账 + CHANGELOG`。
