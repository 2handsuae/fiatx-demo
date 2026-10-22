# 对手方波二 · 收尾闸与走查证据册（2026-10-22）

> worktree `counterparty-wave2`，branch `worktree-counterparty-wave2`，HEAD `b122954e`（Task 1–12 全合），栈端口 3110–3113。
> plan：`superpowers/plans/2026-10-22-counterparty-wave2-transaction-wiring-plan.md` Task 13。
> 截图与响应物证都在本目录；闸门日志摘录在 `gate-logs/*.txt`（原为 `.log`，被 `.gitignore` 的 `*.log` 挡住，改后缀入库）；命名 = `<序号>-<站点>-<端>-<拍的是什么>.png`。

## 一、闸门（命令 · 退出码 · 关键行）

| 闸 | 命令 | 退出码 | 关键行 |
|---|---|---|---|
| ① 后端 tsc | `npx tsc --noEmit -p tsconfig.json` | 0 | 无输出 |
| ② 管理台 tsc | `cd admin-web && npx tsc -b --noEmit` | 0 | 无输出 |
| ③ 客户端 tsc | `cd client-web && npx tsc -b --noEmit` | 0 | 无输出 |
| ④ jest（禁 `-t`） | `DATABASE_URL=file:<已迁移空库> npx jest src/modules/trading src/modules/sumsub-shared src/modules/deposit-sumsub src/modules/withdraw-sumsub src/modules/identity/material-requests src/modules/audit-logging src/modules/asset-treasury/withdrawal-addresses` | 0 | `Test Suites: 80 passed, 80 total` / `Tests: 1535 passed, 1535 total`（波二开工基线 67 套 / 1326 例） |
| ④ 客户端 vitest（§7④ 附带） | `npm run test:client` | 0 | `Test Files 12 passed (12)` / `Tests 142 passed (142)` |
| e2e（`CLAUDE.md §7` 无对应编号） | `TB_ADDRESS=127.0.0.1:3119 npx jest --config ./test/jest-e2e.json test/deposit-sumsub-verdicts.e2e-spec.ts`（专用库 + 专用 TB，见下「偏差」） | 0 | `Tests: 18 passed, 18 total` |
| ⑧ 重铺 | `bash scripts/stack.sh reset self` → `bash scripts/stack.sh up self` | 0 / 0 | `verify:demo-data ALL PASS`（链内，R5 两块 SKIP = ensureSetup 未跑的合法中间态）；三端口 up |
| ⑥ demo:all | `bash scripts/on-stack.sh self demo:all`（不接管道，直接重定向到文件） | 0 | `花名册：35/35 符合预期`、COA 四恒等式 ✓、`asserts: 5/5 PASS`、`demo:all DONE ✅`；`git diff doc-final/demo/data.md` **零 diff**（生成区与 HEAD 一致） |
| ⑧ verify:demo-data | `bash scripts/on-stack.sh self verify:demo-data`（demo:all 刚铺完的干净库） | 0 | `verify:demo-data ALL PASS`（R5 两块此时不再 SKIP） |
| ⑦ verify:coa（铺完） | `bash scripts/on-stack.sh self verify:coa` | 0 | 四恒等 ✓；`负余额检查 通过 (67 个科目全部 ≥ 0)`；`ALL INVARIANTS PASS` |
| verify:rbac | `API_BASE=http://127.0.0.1:3110 bash scripts/on-stack.sh self verify:rbac` | 1（**预期基线红**） | 输出首部 `API base: http://127.0.0.1:3110`；`共 1 条 FAIL，其中 GUARD_OPEN 0 条`；唯一红 = `S7` 四行 `api.{post,get}.admin_{deposit,withdraw}_sumsub_demo_{run_verdict,verdict_buttons}`，与 `TOOLING-DEBT.md` 该条（:141–147）逐行**恒等**，零新增红；本波新路由 `api.post.admin_deposit_sumsub_demo_feed_attribution` 不在死行名单（S7 认活） |
| verify:act1 | `API_BASE=http://127.0.0.1:3110 bash scripts/on-stack.sh self verify:act1` | 0 | `API base: http://127.0.0.1:3110`；`24/24 PASS`；`ALL ACT1 CHECKS PASS` |
| ⑦ verify:coa（走查后） | 同上，在走查全部造单（入账 / 退回 / 挂起）之后再跑一次 | 0 | 四恒等 ✓（ledger 2 CLIENT 8201620811 → 14701620811，差额 = 走查入账净额）；`负余额检查 通过 (67 个科目全部 ≥ 0)` |
| 收官杂项后复核 | `npx prisma validate`；`npx tsc --noEmit -p tsconfig.json`（schema.prisma 注释改动后） | 0 / 0 | `The schema at prisma/schema.prisma is valid` |

**顺序说明**：先在刚铺完的干净库上跑 verify:demo-data / coa / rbac / act1（act1 会占 alice 名额，所以放走查前），随后**第二次** `reset self` → `up` → `demo:all`（35/35、5/5、`data.md` 零 diff 再次成立），在这套新铸库上走查（kate 的地址名额、alice/bob 的认领都要新库）。

**偏差与注记**
- e2e 专用库不能直接在 self 栈的 TigerBeetle 上 `db:biz:init`：`seedStatementHistoryLegs` 的确定性转账 id 与栈库已铺的撞（status 37/38），所以另起一个临时 TigerBeetle（端口 3119，数据文件放会话 scratchpad）+ 重建专用库（`rm → migrate deploy → db:base:sync → db:biz:init`）；跑完停掉临时 TB。`TOOLING-DEBT.md` 的 52 监听器债（`setMaxListeners(50)`）使 `app.init()` 即抛，**临时**把测试文件里 50 改 100 跑绿，随即改回（`git diff test/` 为空）。两条都是既有债的已知绕法，未新增。
- 本机 `node -v` 实为 v20.20.2（PATH 前缀指的 20.19.0 目录里没有该版本，落到系统 20.x），满足 `require-node.js` 的 20 系要求。
- 走查截图工具：`scripts/demo-shot.js` 先例的 login/注入逻辑 + 一次会话多步截图 + 抓 API 响应的临时驱动脚本（不入库，放 scratchpad）；依赖 `npm i --no-save puppeteer-core@24`（`demo-shot.js` 头部写明的做法，`git status` 确认 package*.json 零改动）。
- **未做失效验证**：本任务没有新增/改动检查；T11 新增的花名册断言（#30–#35）的"会红"由 T11 报告与评审负责，本任务只复跑到绿。
- 已知噪音：`[MonthlyStatementSweep] issue failed … Unique constraint failed on (customerId, periodMonth)`（backend 进程与 demo:all 进程各跑一遍 sweep 撞唯一约束，demo:all 单次 57 行日志，不影响任何判据）。

## 二、走查（self 栈 3111/3112，Chrome 无头，一次会话多步）

### 站 3.9 无主来源认领（alice 甲 / bob 乙 / alice 同源对照）

| 判据 | 结果 | 物证 |
|---|---|---|
| ⚡模拟弹窗只问金额 + 可选 From address，**没有**"对手方是不是交易所"两按钮 | ✓ | `01-3.9a-client-simulate-modal-only-from-address.png` |
| 确认后单进 COMPLIANCE_PENDING；Source & Counterparty = NOT ATTRIBUTED；Sumsub References Type = `travelRule`；侧栏 **Attribution Simulation ⚡** 三钮（VASP (qualified) / VASP (Grey Harbor) / Unhosted）+ 主栏 ENGINE 组含 **⑫ Rejected · Counterparty VASP unqualified**（V12 按钮在）| ✓ | `02-3.9a-admin-compliance-pending-not-attributed.png` |
| ⚡Unhosted → 区块 UNHOSTED + Custody Snapshot「Unhosted — self-custody wallet」，单转 ACTION_PENDING（管理台标签 AWAITING CUSTOMER，**SLA 6d 23h = 既有 7 天钟，无新钟**），Verification Requests 多一行 `Source Ownership Claim` PENDING_SUBMISSION | ✓ | `03-3.9a-admin-unhosted-attributed-action-pending.png` |
| 客户端横幅白话句「Source Ownership Claim: Please tell us where this deposit came from.」；页面文本不含 Unhosted / Travel Rule / threshold / compliance | ✓（脚本 `LEAK WORDS on /deposit []`）| `04-3.9a-client-banner-source-ownership-claim.png`（横幅右侧 VERIFY NOW 另点过：落到 `/verification/MRQ…?from=%2Fdeposit` 认领表单，`36-…png`）|
| 详情页 Outstanding verification 区「Source Ownership Claim / Awaiting your declaration / **Declare source**」→ 认领表单（不是 Sumsub 材料页） | ✓ | `05-…-client-detail-declare-source.png`、`06-…-client-claim-form-initial.png` |
| **分支一**：This is my own wallet → VERIFY BY SIGNATURE（mock 即过）→ received 面板「We have received your information and it is being reviewed.」 | ✓ | `07-…-branch-one-own-wallet.png`、`08-…-claim-received-panel.png` |
| **Ruling 8 验证点**：POST 返回体 `status` 仍是 `ACTION_PENDING`（异步 RESUME），点 Back 回详情页**重拉后**状态已刷新——头部 PROCESSING、**Outstanding verification 区消失**、多出 **Source** 区（Source declaration「Submitted · …」/ Sending wallet「My own wallet」） | ✓（时间线里保留历史条目 `ACTION REQUIRED 19:53:08` 属历史，非当前状态）| `09-…-client-detail-after-claim-status-refreshed-source-area.png`；响应 `response-client-deposit-detail-3.9a-after-claim.json`（`status: COMPLIANCE_PENDING`）|
| admin：Ownership Claim =「Self — own wallet」+ Claimed At；⚡① → SUCCESS | ✓ | `10-3.9a-…`、`11-3.9a-…` |
| **分支二**：Sent by someone else → 默认 An individual（Full name + Relationship to you，**两项为空时 SUBMIT DECLARATION 禁用**）；切 An exchange or custodian（只填名称）；填 `Omar Al Mansoori` / `Business partner` 后按钮亮 | ✓ | `13-…`、`14-…`、`15-…exchange-or-custodian-name-only.png`、`16-…individual-filled-button-enabled.png` |
| 提交 → received → Back：Source 区「Sent by / Relationship to you」，头部 PROCESSING | ✓ | `17-…`、`18-3.9b-client-detail-after-claim-sent-by-relationship.png` |
| admin：Ownership Claim =「Third-party individual」，Claimed Name / Claimed Relationship 全文可见；⚡① → SUCCESS | ✓ | `10-3.9b-…`、`11-3.9b-…` |
| **同源免问对照**（alice，From address = 种子 #30 的 `TnTuTp9k…1Y1n`）：⚡Unhosted 后单**仍 COMPLIANCE_PENDING**（不挂起），区块多 **Known Source = DEP261022694105**「same address already claimed on that deposit — no claim asked」；点该号回链落到 #30 详情（带 Ownership Claim）；客户端无横幅、无 Declare source；⚡① → SUCCESS | ✓ | `19-…`、`20-…backlink-lands-on-claimed-deposit.png`、`21-…`、`22-…`、`34-…` |
| 低于线对照（alice 500 USDT 留空 From → ⚡Unhosted）：只记归因，**不挂起**，无 Known Source | ✓ | `33-3.9d-admin-below-threshold-500-unhosted-attributed-only-no-hang.png` |
| 边界（kate 恰好 1000 USDT 留空 → ⚡Unhosted）：**挂起**（`>=` 算过线）；客户端出横幅 | ✓ | `35-3.9f-client-kate-banner-exactly-1000-usdt-hangs.png` |
| 判据①：甲/乙审计按单号查得到 `DEPOSIT_SOURCE_ATTRIBUTED`(ADMIN) → `MATERIAL_REQUEST_ISSUED` → `DEPOSIT_ACTION_REQUIRED` → `DEPOSIT_SOURCE_CLAIM_SUBMITTED`（**主体 CUSTOMER**，afterData=申报快照）→ `MATERIAL_REQUEST_SUBMITTED/APPROVED` → `DEPOSIT_MATERIAL_APPROVED_RESUMED` → `DEPOSIT_APPROVED` | ✓ | `audit-deposit-DEP261022680322-3.9a.json`、`audit-deposit-DEP261022437251-3.9b.json` |
| 判据②：对照单查得到 `DEPOSIT_KNOWN_SOURCE_MATCHED`（SYSTEM，afterData `knownSourceRef=DEP261022694105`）、**查不到** `DEPOSIT_ACTION_REQUIRED` | ✓ | `audit-deposit-DEP261022620089-3.9c.json` |
| 判据③：全程只出现既有状态（PAYIN_PENDING / COMPLIANCE_PENDING / ACTION_PENDING / SUCCESS / MANUAL_CHECKING / RETURNING / RETURNED），`deposit-transactions.service.spec.ts` 里 `brief lists exactly 29 edges` 随 80 套全绿，spec 该断言本波零 diff | ✓ | 闸 ④ |
| 判据④（DevTools 响应目检）：客户端各详情响应键集 = `id,depositNo,status,amount,createdAt,completedAt,txHash,referenceNo,fromAddress,fromIban,toAddress,toIban,effectiveDate,timeline,asset,counterpartyVasp,sourceClaimType,sourceClaimName,sourceClaimRelationship,sourceClaimedAt`（白名单 +5）；对整次会话所有 API 响应按 `did:mock / knownSourceRef / sourceAttributedAt / counterpartyVaspDid / custodySnapshot / sourceAttribution / unhosted·UNHOSTED / travelRule / knownSource / vaspProfile / eecStatus / vaspRiskScore` 子串扫描 → **0 命中**（甲 / 乙 / 对照 / kate 四次会话各扫一遍；kate 与对照两次另含 `manualReason / vasp_unqualified / MANUAL_CHECKING`。甲的首次扫描清单更宽，唯二命中是白名单内的 `counterpartyVasp`〔值为 null〕与 `sourceClaim*`〔客户自己的申报〕，属设计内）| ✓ | `response-client-deposit-detail-*.json`、`requests-client-session-3.9a.json` |

### 站 3.10 对手方 VASP 不合格 → 原路退回（kate，1300 USDT）

| 判据 | 结果 | 物证 |
|---|---|---|
| ⚡VASP (Grey Harbor)：区块 VASP / Grey Harbor Exchange / `did:mock:grey-harbor-001` / 档案三行 EEC `PENDING`、评分 `42`、`UNLICENSED` / 一行 `Policy: EEC completed ∧ risk score < 10 ∧ licensed → eligible`；**单仍 COMPLIANCE_PENDING** | ✓ | `23-3.10-admin-vasp-grey-harbor-attributed-profile-rows-compliance-pending.png` |
| 对照：重喂 VASP (qualified) → Mock VASP Exchange / `COMPLETED` / `3` / `LICENSED`；再喂回 Grey Harbor（审计多两条 `DEPOSIT_SOURCE_ATTRIBUTED`，符合 script 所写）| ✓ | `24-3.10-admin-contrast-qualified-vasp-profile-all-pass.png` |
| ⚡⑫ → **MANUAL_CHECKING**；区块多 **Review Basis =「Counterparty VASP unqualified」**；Sumsub Transaction Detail 命中规则「Counterparty VASP not qualified · reject · 67」；审计 `DEPOSIT_MANUAL_CHECKING` | ✓ | `25-3.10-admin-after-feed-12-manual-checking-review-basis.png` |
| 复核态页面按钮扫描：与退回相关的**只有** ⚡「⑩ Rejected · MLRO return」，**无 UI 手动退回按钮**（与 script ⑤、v4 §3/§4 订正一致）| ✓ | 脚本输出 `RETURN-ish BUTTONS`，同 `25-…png` |
| ⑤ 复核态再喂 ⚡⑩ → 开 **MLRO 退回审批** `APR261022932914`（类型 DEPOSIT_RETURN，Step 1 = MLRO，**Submitted By = KYT_VERDICT 系统**，不是运营），单仍停 MANUAL_CHECKING | ✓ | `26-…`、`27-3.10-mlro-return-approval-case-before-approve.png` |
| `mlro@` 批准 → 单 RETURNING，退回腿资金单 CREATED；⚡ Broadcast → ⚡ Seen in Mempool → ⚡ Confirm → **RETURNED**；退回腿 TO ADDRESS `T201BC889D89E4AE69C30D5B452AF2C77U` **等于**入金的 From address（目的地锁死原发款方）| ✓ | `28-…approved.png`、`29-…`、`30-3.10-admin-deposit-returned-terminal.png`；审计 `audit-deposit-DEP261022957964-3.10.json`（APPROVAL_SUBMITTED → DEPOSIT_RETURN_REQUESTED → APPROVAL_GRANTED → DEPOSIT_RETURN_STARTED → DEPOSIT_RETURNED）|
| 客户端 kate 详情：RETURNED，时间线 PROCESSING → RETURNING → RETURNED（**复核态收敛成 PROCESSING，无人工复核字样**），Source 区只读到 Counterparty「Grey Harbor Exchange」；响应扫描 0 命中（无 DID / 档案 / EEC / UNLICENSED / manualReason）| ✓ | `31-3.10-client-kate-returned-deposit-detail.png`、`response-client-deposit-detail-3.10-kate-returned.json` |
| 种子 #33 的 admin 详情：Review Basis「Counterparty VASP unqualified」（`manualReason=vasp_unqualified` 的展示）+ RETURN 审批 APPROVED + 两条资金单 CLEARED + RETURNED | ✓ | `32-seed-33-admin-vasp-unqualified-returned-detail.png` |

### 站 5.1 提现 TR 三档 + 受益人随报文

| 判据 | 结果 | 物证 |
|---|---|---|
| #15（bob 150 USDT → 自托管）：Beneficiary Type = SELF；Withdrawal Address = 业务键 `WA…`；Counterparty VASP =「None — self-hosted wallet」；TR Report = **NOT_APPLICABLE**（below threshold, submitted anyway）| ✓ | `40-5.1-admin-withdraw-15-tr-not-applicable.png` |
| #34（grace 1200 USDT → 尾号 1111 VASP 地址）：Counterparty VASP = Mock VASP Exchange + DID + 档案 `COMPLETED / 3 / LICENSED`；TR Report = **EXCHANGED** | ✓ | `41-5.1-admin-withdraw-34-tr-exchanged.png` |
| #35（alice 1500 USDT → 已签名自托管）：TR Report = **SELF_HOSTED_NO_EXCHANGE**（ownership verified at address registration）| ✓ | `42-5.1-admin-withdraw-35-tr-self-hosted-no-exchange.png` |
| 客户端 grace #34 详情**只多读到 `Beneficiary type: Myself` 一行**（无报文状态 / VASP 名与 DID / `withdrawalAddressNo`）；响应键集含 `beneficiaryName,beneficiaryType,addressLabel`；对 `did:mock / travelRule / EXCHANGED / NOT_APPLICABLE / SELF_HOSTED_NO_EXCHANGE / counterpartyVasp / withdrawalAddressNo / WA2601 / eecStatus / UNLICENSED / Mock VASP` 扫描响应与页面 → **0 命中** | ✓ | `43-5.1-client-grace-withdraw-34-only-beneficiary-type-myself.png`、`response-client-withdraw-detail-5.1-grace-34.json` |
| 审计：`WITHDRAW_TRAVEL_RULE_SNAPSHOTTED`（SYSTEM，afterData = 快照本体 `{status:"EXCHANGED", beneficiaryType:"SELF", counterpartyVaspName, counterpartyVaspDid,…}`）| ✓ | `audit-withdraw-WDR261022500241-seed-34.json` |
| 提现状态机仍 23 边（本波零触碰迁移表，见 §三 第 3 行）| ✓ | — |

### 站 5 ④e 提现地址簿（**kate，新铸库**）

| 拍 | 结果 | 物证 |
|---|---|---|
| ① 登记尾号 `1111`（Wallet hosting 故意选 Self-custody）→ 停 Pending verification + Signature needed（名额 2/3）；admin 详情：Attribution = VASP / Mock VASP Exchange / DID、**Self-declaration & Red Flag**「Declared hosting does not match attribution … Flag only」、Hosting Match = Mismatch、Screening GREEN | ✓ | `50a/50b-5e1-…`、`51-5e1-admin-address-1111-red-flag-and-attribution.png` |
| ② 登记尾号 `3333` → **当场 Not approved**，名额仍 2/3（REJECTED 不占坑）；客户端只说结果；admin Screening = RED；审计 `WITHDRAWAL_ADDRESS_REGISTERED`(CUSTOMER) + `WITHDRAWAL_ADDRESS_REJECTED`(SYSTEM) | ✓ | `52a/52b-5e2-…`、`53-5e2-admin-address-3333-screening-red-rejected.png`、`audit-address-WAD261022538943-3333.json` |
| ③ 登记普通自托管串 → Pending verification → 客户端详情 **Verify wallet signature** → Cooling（倒计时 `23h 59m 56s`）；名额 3/3 并出「Maximum 3 active addresses reached」提示；`compliance_lead@` 详情侧栏 ⚡ **Screening Simulation** 三钮 → Feed RED（弹窗必填理由）→ 页内回显「Screening RED fed — address rejected.」、刷新后 REJECTED 且 ⚡ 区消失；客户端同条目变 **Not approved** | ✓ | `54a/54b-5e3-…`、`55a/55b-5e3-…`、`56a/56b/56c-5e3-…`、`57-5e3-client-kate-sees-not-approved-after-override.png` |

### 其余走查判据

- **admin 两详情页新区块**：充值 Source & Counterparty（`02/03/10/19/23/25/32`）、提现 Counterparty / Travel Rule（`40/41/42`）✓。
- **新端点 RBAC**：用同一 self 栈（`reset` 已 `db:base:sync`）对 `POST /admin/deposit-sumsub/demo/feed-attribution` 打不存在的单号：`compliance_lead@` → 404（过了守卫）、`admin@` → 404、`treasury@` / `ops_officer@` → **403 `Missing permission: api.post.admin_deposit_sumsub_demo_feed_attribution`** ✓（输出存 `gate-logs/rbac-feed-attribution-role-check.txt`）。
- **政策口径行只在有 vaspProfile 的单上显示**：Unhosted 区块（`03/19/33`）无该行、VASP 区块（`23/24/25/32`）有——与 Task 10 说明一致。**走查判断：不伤剧本**——script 3.9 全程是 Unhosted、从未要求读政策行；3.10 ② 在 VASP 区块里读它，正好显示。无需改。
- **复核态 ⚡ 面板**：⑩ 在 MANUAL_CHECKING 仍在（`25`），与 script ⑤ 吻合。

## 三、交付清单逐行核（`rules/delivery-checklist.md` 命中行，plan Step 6 写死）

| # | 命中行 | 核对结论 | 证据 |
|---|---|---|---|
| 1 | 持久状态变化留痕（4 新码写点 + 显式 requestId）| ✓ 四个写点（`deposit-workflow.service.ts:880/901/961`、`withdraw-workflow.service.ts:2595`）全经 `depositAudit` / `withdrawAudit` 包装，包装内统一 `requestId: \`${action}_${no}_${randomUUID()}\``（`deposit-workflow.service.ts:2059`、`withdraw-workflow.service.ts:1998`）；走查里 3.10 同一单连喂三次归因落三行（未被去重）| 审计 JSON ×6 |
| 2 | 新增审计码四属性冻结 | ✓ `audit-actions.constant.ts:909–911 / :971` 四码均带 `domain` + `correlationMode: I` + `requiredFields:['afterData']` + `requiresCausation:false`；词表 352 = DEPOSIT 50 + WITHDRAW 34，`audit-actions.constant.spec.ts` 随闸 ④ 绿 | 闸 ④ |
| 3 | 新状态 / 新结局：零新态零新边；SLA 显式回答 | ✓ 本波 diff 无任何迁移表文件；deposit 的 `brief lists exactly 29 edges` 断言（`deposit-transactions.service.spec.ts:1420`）零 diff 且全绿；**SLA：认领挂起复用 ACTION_PENDING 既有 7 天钟，无新钟**（`03-…png` SLA = 6d 23h）；V12 落 MANUAL_CHECKING 沿既有 3 天只标红钟 | `03`、`25`、闸 ④ |
| 4 | 动了钱：走既有退回/退款弧 + verify:coa | ✓ V12→⑩ 走既有 `initiateReturn` → MLRO 审批 → 退回腿资金单（`28–30`）；`verify:coa` 铺完 / 走查后两次全绿含负余额断言 | `gate-logs/verify-coa-after-demo-all.txt`、`gate-logs/verify-coa-after-walkthrough.txt` |
| 5 | maker-checker：走既有审批正门、零新策略 | ✓ 审批类型 `DEPOSIT_RETURN`、Step 1 = MLRO（`27`）；本波 diff 不含 `approval.constants` / `MAKER_GROUP_BY_POLICY`（`git diff --name-only 03cc4796..HEAD` 无此二文件）| `27`、`28` |
| 6 | 新增权限组：零 | ✓ 仅在既有 `DEMO_VERDICT_WRITE` 组下加一条 `route()`；admin-web `permissions.ts` 只加一个路由镜像键 `DEPOSIT_FEED_ATTRIBUTION`（`git diff` 两文件共 +11 行，无 `PermissionGroup` 联合类型改动）| diff |
| 7 | 新增 admin 端点：`route()` 登记 + `db:base:sync` + 重启 | ✓ `rbac.catalog.ts:410` 已登记，S7 认活；self 栈经 reset（含 base sync）后 RBAC 实测 compliance_lead 通过 / treasury、ops 403。**合并 main 后仍须 `db:base:sync` + 重启后端**（见 §五待办）| verify:rbac、RBAC 实测 |
| 8 | 新增业务动作前端有入口 | ✓ ⚡归因区（`02`）、认领表单（`06/07/13–16`）、Source & Counterparty / Counterparty·Travel Rule 区块（`03/40–42`）| 截图 |
| 9 | 退役业务动作前端同步删（弹窗两按钮）| ✓ 模拟弹窗只剩金额 + From address（`01`）；`grep -rn counterpartyIsVasp client-web/src` 零命中；信号服务 / DTO 零命中（余下命中均为充值 / 提现**订单**列与种子、admin 区块，是有意保留的归因快照列）| `01`、grep |
| 10 | 改交易域问另两域 | ✓ 充值 / 提现本波同改；**兑换显式豁免**（账内换币无外部对手方，V12 不暴露）——`swap-sumsub/fixtures/verdict-buttons.{ts,spec.ts}` 只改注释与断言口径（语义性缺席 ④/⑧/⑫），`v6-swap.md` 已写 | diff |
| 11 | 新字段客户面裁决 | ✓ 充值白名单 +5（`counterpartyVasp` + 认领四列）；提现白名单加 `beneficiaryName`、`beneficiaryType` 两键，`addressLabel` 改按业务键回链（Ruling 6/7，`counterpartyVaspName` 不进提现客户面）；DID / 归因时刻 / `knownSourceRef` / 报文状态 / 档案**不出客户面**——响应扫描 0 命中 | `response-client-*.json`、扫描输出 |
| 12 | 涉及金额：阈值沿旧 resolver 数值语义 | ✓ `isTrApplicable`：`amount >= TR_THRESHOLD_BY_CURRENCY`（数值比较，无换算改动）；实测 1000 USDT 挂起、500 不挂（`35`/`33`）| `35`、`33` |
| 13 | 对外识别用业务键 | ✓ admin 区块用 `DEP…` 回链（Known Source）、`WA…` 地址簿号；客户端无 UUID 暴露字段新增（`id` 是既有字段，非本波）| `20`、`40` |
| 14 | 新事件：零 | ✓ 本波 diff 无 `domain-events.constants` | diff |
| 15 | 改 schema：有迁移无 backfill | ✓ `20261022115552_counterparty_wave2_transaction_wiring/migration.sql`：13 条 `ADD COLUMN` + 信号表 `RedefineTables`（Prisma 标准拷贝删 `counterpartyIsVasp` 列），无 `UPDATE` / backfill；`schema.prisma:859` 旧注释已订正；`prisma validate` 通过 | migration 文件 |
| 16 | 改页面或种子：同步 data.md / script.md | ✓ T11/T12 已同步；demo:all 后 `git diff doc-final/demo/data.md` 零 diff（生成区一致）| §一 |
| 17 | 改了前端：preview 渲染 + 截图 | ✓ 本册 58 张 PNG | 本目录 |
| 18 | 多波中的一波：末波无承接 | ✓ 改做战役收官（总纲头部已加「两波收官 2026-10-22」）| 总纲 |
| 19 | 每轮收尾：报告 + CHANGELOG 一行 + BACKLOG 销账 | ✓ CHANGELOG 加一行；BACKLOG `:88`「TR 适用判定未自动计算」销账（语义确系条件②自报缺口：「对手方 VASP 打标靠 DTO 自报」整链已退役，缺口结构性取代；同时注明现状 TR 适用 = 虚拟币 ∧ 金额 ≥ 阈值，VASP 打标改作适用之后的分支依据）| `BACKLOG.md:88` |
| 永不豁免 ① | 改了前端行为 → 必须截图 | ✓ | 本目录 |
| 永不豁免 ② | 动了钱 → verify:coa | ✓ 两次 | `gate-logs/` |

## 四、走查撞见 / 收官杂项

**撞见（登记）**
1. **⚡ Simulate Deposit 的 From address 留空并不随机**：同一客户每次留空都是同一串（钱包 id + `U`），`client-web/src/pages/Deposit.tsx#buildMockInboundSignalPayload` 的 `slice(0, 33)` 把时间戳 / 随机数段截掉了（该行波二前已有）。波二把它变成了行为——第二笔留空 ≥ 1000 USDT 且第一笔已认领 → ⚡Unhosted 后命中 Known Source 免问、不挂起（实证：bob 的 `DEP261022814998` 命中 `DEP261022437251`；alice 的 1500 与 500 两笔 From 都是 `TEC2DF02…435U`）。单人顺序 + 每次新铸库不触发；已登 `TOOLING-DEBT.md`（复现 + 修法方向 `slice(-33)`）。**未改代码**（本任务不含）。
2. 脚本里出现的「必不在任何已知来源里」措辞因此只在**该客户首次留空**时成立——`script.md` / `data.md` 不改（走查路径每客户只用一次留空，且已要求新铸库），报回由业主定。
3. 走查前一次误跑让 bob 多出两笔 PAYIN_PENDING 的 1200 USDT（`DEP261022437251` 被用作乙，另一笔 `DEP261022814998` 后来用于验证上一条）、alice 多一笔 500、kate 多一笔 1000 挂起认领——都是走查造数，**本栈数据已被练手污染，演示前须按规矩 `reset` 重铺**。
4. 认领页面包屑显示 `ACCOUNT > Dashboard`（`/verification/:requestNo` 页既有布局，所有材料页同款），非本波引入，未动。
5. 客户端「Simulate Deposit」弹窗副文案仍写「Final risk simulation now happens in Admin Risk Policy Executions」（既有陈旧文案，与波二无关），未动。

**收官杂项（本任务一个 commit）**：PRODUCTION-NOTES 追加四行 ✓｜文档清尾四处（`v4-deposit.md:91`、`baseline.md:389`、`v5-withdraw.md` §1 与 §3 复核态措辞、`schema.prisma:859` 注释）✓｜CHANGELOG 一行 ✓｜总纲头部「两波收官」✓｜BACKLOG:88 销账 ✓｜TOOLING-DEBT 追加一条（上面第 1 条，走查新发现）。

## 五、待办（不在本任务内）

- **归档**（随合并批执行）：总纲 `specs/2026-10-22-counterparty-layer-charter.md`、波一 / 波二 spec + plan + 骨架 → `doc-final/archive/`，收官记录已在总纲头部。
- **合并 main 后必做**：重启后端 + `npm run db:base:sync`（新增 `feed-attribution` 路由登记，否则非超管 403）+ `bash scripts/stack.sh reset main`（动过 schema / seed）；`cloud:deploy` 连欠多波，另议。
