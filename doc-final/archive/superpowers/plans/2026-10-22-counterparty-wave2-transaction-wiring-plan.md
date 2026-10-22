# 对手方波二 · 交易接线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **派发注意（项目总纲 §6）**：每个任务 prompt 必须带仓库根 `CLAUDE.md` §0–§5 要点；任务执行降档 `sonnet`、评审不降档；写前端的任务先读 `doc-final/rules/frontend-client.md` / `frontend-admin.md` 与 `ui-contract/`，写后端的先读 `rules/backend.md`、动审计先读 `rules/audit-logging.md`。

**Goal:** 充值/提现两域消费波一的对手方字段——判型一行化、充值来源归因（⚡喂）+ VASP 展示区块 + unhosted 超线认领（复用补料、提交即回炉）+ 已知来源同源免问、"对手方 VASP 不合格"裁决分支（充值退回 / 提现退款，均走既有弧）、提现建单带出受益人 + TR 报文三档快照；**两域状态机零新态零新边**。

**Architecture:** 归因真相源从客户自报改为 mock Sumsub（⚡喂，仅 COMPLIANCE_PENDING 可喂）——自报链整链拆除；mock 归因 adapter 迁 `sumsub-shared/` 并新增 VASP 名录 profile 与 TR 规则服务（阈值表从 resolver 原样搬家、已知来源=查询既有认领快照、零新表）；认领 = 材料账第 6 型（无 SDK，客户端渲染我方二分支表单），提交由充值域自己落快照再经材料账 mock 即时 APPROVED 走既有 RESUME 回炉；V12 裁决按钮复用 V10 的 MANUAL_CHECKING 落点 + 既有退回/退款弧，maker-checker 不绕；提现建单从地址簿条目抄出业务键与受益人档，travelRule 型提交时一次性写三档如实快照。全 mock，四个新触点续登 `reference/sumsub-mock-touchpoints.md`。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle（复用既有退回/退款记账，零新分录型）；React client-web / admin-web；jest + vitest。

**Spec:** `doc-final/superpowers/specs/2026-10-22-counterparty-wave2-transaction-wiring-spec.md`（总纲：`2026-10-22-counterparty-layer-charter.md`；承接：`2026-10-22-counterparty-wave2-skeleton.md`）

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用（命中行清单由 Task 13 写死）
- 本轮特有：
  - **全 mock**：零真实 Sumsub 请求；凡"站在 Sumsub 一侧"的新能力（归因⚡ / 名录 profile / TR 阈值与认领规则 / 认领解锁）都登记进 `reference/sumsub-mock-touchpoints.md`（Task 12）
  - **两域状态机零新态零新边**：deposit 29 边 / withdraw 23 边守则单测数字**不许动**——本波最硬回归判据
  - **自报链拆除是目标终态**：收尾 grep `counterpartyIsVasp` 在 `InboundTransferSignal`/信号 DTO/`detected()` 入参/客户端弹窗四处预期终态 **0**（订单列保留、改由归因写入）；错误文案 `counterpartyIsVasp is required` 全仓清零
  - 零新权限组/桶/域（⚡归因挂既有 `DEMO_VERDICT_WRITE`）；零新审批策略（`MAKER_GROUP_BY_POLICY` 不动）；零新事件（复用 `MATERIAL_REQUEST_REVIEWED`）；零新通知模板（挂起复用 `DEPOSIT_ACTION_PENDING`）
  - **数字判据（收尾复核，改完必须恰好对上）**：审计现役码 348→**352**（+4：V4 47→50、V5 33→34）｜ ⚡共享表 11→**12** 键 ｜ 材料类型注册表 5→**6** ｜ resolver spec 用例 9→**3** ｜ 种子地址 11→**12**（demo_bob 尾号 4444）｜ 通知模板 19 不变 ｜ 权限 15 域 83 桶 92 组不变

## Review Focus

spec 蕴含但若无测试钉住就会咬人的六类输入（已逐条把测试放进属主任务）：

1. **认领后同单再喂 Unhosted 必须命中已知来源**（否则回炉后再⚡一次 = 永久循环挂起）：已知来源查询须含本单自己的认领快照 → Task 4 Step 1⑤。
2. **finance 型 / 低于线的归因喂**：法币或 finance 型喂归因 → 400；travelRule 型低于阈值喂 Unhosted → 只记归因不挂认领、不建材料单 → Task 4 Step 1③④。
3. **V12 打在非可派发态**：FROZEN 一律 IGNORE（保护制裁证据）、SUCCESS/终态不动——必须沿 `decideVerdictLanding` 既有三档，不得绕 → Task 6 Step 1③。
4. **提现快照三档边界**：恰好 1000 USDT（≥语义沿旧 resolver）→ 过线；过线×自托管 → `SELF_HOSTED_NO_EXCHANGE` 而非 `EXCHANGED`；低于线×VASP → `NOT_APPLICABLE` → Task 7 Step 2 矩阵。
5. **认领端点守卫**：非本人 Forbidden；非 ACTION_PENDING 或无未决认领单 409；第三方分支缺姓名/关系 400 → Task 5 Step 1③。
6. **客户面泄漏不对称**：`counterpartyVasp` 移出敏感集进白名单，但 `counterpartyVaspDid`/`knownSourceRef`/`sourceAttributedAt`/`travelRuleSnapshotJson` 必须加入敏感断言；认领快照四列客户可见 → Task 5 Step 4 / Task 7 Step 4（SENSITIVE_KEYS spec 双域同改）。

## 现状锚点（实查 2026-10-22，执行者无须重查）

- 判型：[kyt-txn-type.resolver.ts:38](src/modules/sumsub-shared/kyt-txn-type.resolver.ts:38)（四条件；阈值表 :7-10）；调用方仅 [deposit-workflow.service.ts:368](src/modules/trading/deposit-transactions/deposit-workflow.service.ts:368) 与 [withdraw-workflow.service.ts:2487](src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts:2487)；`SINGLE_TXN_SUBMIT_ENABLED` 开关 :344-346（关=一律 finance，行为保留）
- 自报链：`Deposit.tsx:412-413,506,1197-1223`（弹窗随机生成 fromAddress + 两按钮）→ `inbound-transfer-signals.service.ts:166-171`（crypto 必填/法币禁传）→ :217 落信号 → `detected()`（`deposit-transactions.service.ts:1302`）落单；补录路径 :354 写死 false；`verify-act1.ts:506` 传 false
- 受冲击断言（Task 2 逐条翻面）：`deposit-workflow.service.spec.ts:775`（COUNTERPARTY_NOT_VASP→翻 travelRule）/`:754/:807/:867`；`test/deposit-sumsub-verdicts.e2e-spec.ts:561-586`（non-VASP 用例翻面）；`withdraw-workflow.service.spec.ts:833-862`（只断 type，微调入参）；resolver spec 9 用例重写
- mock adapter：`asset-treasury/withdrawal-addresses/` 下 token `TRAVEL_RULE_ADAPTER` + `mock-travel-rule.adapter.ts`（尾号 1111→Mock VASP Exchange；2222/3333 筛查）；唯一消费方 `withdrawal-address-workflow.service.ts:95,99,232`；module :19 绑定、:21 未导出 token
- 补料闭环：挂起 `applyKytAwaitUser`（deposit-workflow :724）→ `issuer.register`（`deposit-applicant-actions.service.ts:101-121`）→ `hasOutstanding` → ACTION_PENDING（:784-797，审计 `DEPOSIT_ACTION_REQUIRED`）；回炉 `onMaterialRequestReviewed`（:2944，只认 APPROVED + ACTION_PENDING → RESUME）；材料注册表 `config/material-refresh-policy.json`（5 型，各挂 sumsubActionLevelName）+ 标签表 `dto/material-request.dto.ts:10-16`；客户提交页 `MaterialVerification.tsx` 一律起 SDK session（:37 session → :99 submit）
- ⚡现状：共享表 `verdict-buttons.shared.ts:42-160`（11 键）；V10 落点 deposit-workflow :899-955（非复核态先落 MANUAL_CHECKING `earlyReturnTag`，复核态调 `initiateReturn` :1858-1926）；demo controller `admin-deposit-demo.controller.ts:23`（SUMSUB_MOCK_MODE 下注册）；`SimulationPanel.tsx:37-104` 按钮渲染
- 提现建单：withdraw-workflow :296-325 只取 `counterpartyIsVasp`；`insertRecord` :489-523；客户详情 Address label 按值反查（`withdraw-transactions.service.ts:523-532`）
- 客户面投影：deposit 白名单 `deposit-transactions.service.ts:426-446` + SENSITIVE_KEYS spec :238-252（`counterpartyVasp` 现在敏感集里）；withdraw 镜像 `toCustomerWithdrawView`
- 死列（只提不删）：`DepositTransaction.counterpartyVasp`（:838，本波复活）、`sumsubActionId`（:864，不动）
- 剧本：`demo/script.md` 第三幕 56-98（3.1-3.8，无补料/VASP 站）、第五幕 144-182；`demo/data.md` 速查表 71-87、充值花名册 #4/#5/#9、提现花名册 #17

## 目标终态速查（全任务共用，名字以此为准）

**schema 新列**（全可空/给默认，e2e 直写 prisma 夹具零改动；`InboundTransferSignal.counterpartyIsVasp` **删列**）：

| 表 | 列 | 类型 | 说明 |
|---|---|---|---|
| DepositTransaction | `counterpartyVaspDid` | String? | 归因产物（`counterpartyIsVasp`/`counterpartyVasp` 两既有列改由归因写入） |
| DepositTransaction | `sourceAttributedAt` | DateTime? | ⚡归因时刻 |
| DepositTransaction | `sourceClaimType` | String? | `SELF` / `THIRD_PARTY_PERSON` / `THIRD_PARTY_VASP` |
| DepositTransaction | `sourceClaimName` | String? | 乙分支：个人姓名或 VASP 名 |
| DepositTransaction | `sourceClaimRelationship` | String? | 仅 THIRD_PARTY_PERSON |
| DepositTransaction | `sourceClaimedAt` | DateTime? | 认领提交时刻（已知来源判别键） |
| DepositTransaction | `knownSourceRef` | String? | 同源免问时回链的 depositNo |
| WithdrawTransaction | `withdrawalAddressNo` | String? | 地址簿业务键（铁律⑥，label 改键回链） |
| WithdrawTransaction | `beneficiaryName` | String? | 建单抄自地址簿 |
| WithdrawTransaction | `beneficiaryType` | String? | `SELF`/`THIRD_PARTY`（抄 `ownerType`；订单自身 `ownerType` 列已被占用，刻意改名） |
| WithdrawTransaction | `counterpartyVaspName` / `counterpartyVaspDid` | String? | 抄自地址簿（自托管/法币 null） |
| WithdrawTransaction | `travelRuleSnapshotJson` | String? | travelRule 型提交时一次性写 |

**mock 侧新件**（全住 `sumsub-shared/travel-rule/`，Task 3）：

- adapter 原样迁入 + 归因加一行：尾号 `4444` → `{attributed:true, vaspName:'Grey Harbor Exchange', vaspDid:'did:mock:grey-harbor-001'}`
- `MOCK_VASP_DIRECTORY`（两条）+ `getVaspProfile(vaspDid): VaspProfile|null`，`VaspProfile = {name, eecStatus:'COMPLETED'|'PENDING', riskScore:number, licensed:boolean}`：exchange-001→`{COMPLETED, 3, true}`、grey-harbor-001→`{PENDING, 42, false}`（政策口径"EEC 完成 ∧ 评分<10 ∧ licensed"一过一不过）
- `MockTrRulesService`：`TR_THRESHOLD_BY_CURRENCY` 从 resolver 原样搬入（USDT 1000/AED 3500，≥ 语义不变，漏配币种 warn+不适用）；`isTrApplicable(currency, amount): boolean`；`findKnownSource(userId, fromAddress): Promise<string|null>`（查 `deposit_transactions` 同客户×同 fromAddress×`sourceClaimedAt` 非空，返回最近 depositNo——已知来源的记忆以查询代存储，零新表）

**认领材料型**：注册表加 `SOURCE_OWNERSHIP_CLAIM`（`formKind:'OWNERSHIP_CLAIM'`、无 sumsubActionLevelName——注册表允许该键缺省即是 formKind 的判别；标签表加中文"来源认领/申报"）。

**审计新码 4 个**（四属性出生即冻结；V4 段 +3、V5 段 +1）：

| 码 | mode | requiredFields | 谁触发 |
|---|---|---|---|
| `DEPOSIT_SOURCE_ATTRIBUTED` | I | `['afterData']` | ⚡喂归因，operator |
| `DEPOSIT_SOURCE_CLAIM_SUBMITTED` | I | `['afterData']` | 客户提交认领（申报快照进 afterData），客户主体 |
| `DEPOSIT_KNOWN_SOURCE_MATCHED` | I | `['afterData']` | 同源免问，`recordSystem`（afterData 含 knownSourceRef） |
| `WITHDRAW_TRAVEL_RULE_SNAPSHOTTED` | I | `['afterData']` | travelRule 快照落单，`recordSystem` |

**新端点 2 个**：
- admin `POST /admin/deposit-sumsub/demo/feed-attribution`，body `{ depositNo, attribution:'VASP'|'UNHOSTED', vasp?:'MOCK_VASP_EXCHANGE'|'GREY_HARBOR' }`（默认 MOCK_VASP_EXCHANGE），rbac `route()` 挂 **`DEMO_VERDICT_WRITE`**（demo controller 内，SUMSUB_MOCK_MODE 下注册；admin-web permissions.ts 加对应键）
- client `POST <既有客户充值控制器>/:depositNo/ownership-claim`（路径前缀照 `my/inbound-signals` 同款对齐；client 路由不进 rbac 目录），body `OwnershipClaimDto = { claimType, name?, relationship? }`

**⚡共享表第 12 键**：`V12_VASP_UNQUALIFIED`（ENGINE 组，标签 "Counterparty VASP unqualified"）；处置 tag 常量 `VASP_UNQUALIFIED`；deposit/withdraw fixtures 暴露、swap 不暴露（站内无外部对手方，语义性缺席）。落点两域同款：沿 `decideVerdictLanding` 三档进 `MANUAL_CHECKING`（manualReason 记 `vasp_unqualified`），后续走**既有**退回（充值：运营提 + MLRO 批）/ 退款（提现：复核态运营直执行）弧——零新边零新审批。

**客户面投影终态**：deposit 白名单 **+5**（`counterpartyVasp`、认领快照四列）；SENSITIVE_KEYS 两域调整——`counterpartyVasp` 移出，`counterpartyVaspDid`/`knownSourceRef`/`sourceAttributedAt`（deposit）与 `travelRuleSnapshotJson`/`counterpartyVaspDid`（withdraw）加入；withdraw 客户面 **+3**（`beneficiaryName`/`beneficiaryType`/`withdrawalAddressNo`→label 键回链）。

**种子终盘**：地址 11→12（#12 demo_bob TRON 尾号 4444，VASP×SELF、DECLARATION、GREEN、ACTIVE——Grey Harbor 展品）；充值花名册 +4（认领甲/认领乙/同源免问对照/VASP 不合格已退回）；提现花名册 +2（grace ≥1000 USDT → 她的 1111 VASP 地址 = EXCHANGED 展品；alice ≥1000 USDT → 她的已签名自托管地址 = SELF_HOSTED_NO_EXCHANGE 展品；既有 alice/bob 50 USDT 单自然成为 NOT_APPLICABLE 展品）。

---

### Task 1: schema 两域扩列 + 信号删列 + 迁移

**Files:**
- Modify: `prisma/schema.prisma`（DepositTransaction :819-877 / WithdrawTransaction :1225-1295 / InboundTransferSignal :782-817）
- Create: `prisma/migrations/<timestamp>_counterparty_wave2_transaction_wiring/migration.sql`

**Interfaces:**
- Produces: 「目标终态速查」全部新列 + `InboundTransferSignal.counterpartyIsVasp` 删除；后续任务按这些列名消费。

- [ ] **Step 1: 按速查表加列、删信号列**（SQLite 删列走表重建已有先例；不写任何 backfill）
- [ ] **Step 2: 生成迁移** `npx prisma migrate dev --name counterparty_wave2_transaction_wiring`，随后 `npx prisma generate`
- [ ] **Step 3: 验证空库能建**：`rm -f /tmp/w2-check.db && DATABASE_URL=file:/tmp/w2-check.db npx prisma migrate deploy` 走通
- [ ] **Step 4: 随手闸 ①**（信号列删除会让旧引用当场编译红——那是 Task 2 的活，本任务只需 prisma 侧绿；若闸①红在信号消费方，与 Task 2 合并提交）
- [ ] **Step 5: Commit** `feat(counterparty): schema — attribution/claim columns on deposit, counterparty columns on withdraw, drop signal self-report`

### Task 2: 判型一行化 + 自报链后端拆除 + 受冲击断言翻面

**Files:**
- Modify: `src/modules/sumsub-shared/kyt-txn-type.resolver.ts`、`kyt-txn-type.resolver.spec.ts`、`deposit-workflow.service.ts:368-373`、`withdraw-workflow.service.ts:2487` 附近、`inbound-transfer-signals.service.ts`（:147-171 校验、:217/:354 写点、:579-590 透传）、`deposit-transactions.service.ts`（`detected()` 入参 :1302）、信号 DTO、`scripts/demo-lib.ts:652-658`、`scripts/verify-act1.ts:506`
- Test: 上列各自 spec + `test/deposit-sumsub-verdicts.e2e-spec.ts:561-586`

**Interfaces:**
- Produces: `resolveKytTxnType(input: { assetType: string }): { type: 'finance'|'travelRule', reason: 'NOT_CRYPTO'|'TR_REQUIRED' }`（函数名与返回形状不变，输入收窄；`TR_THRESHOLD_BY_CURRENCY` 从本文件**删除**——Task 3 在 mock 规则里重建同值表）。信号链不再有 `counterpartyIsVasp` 任何痕迹。

- [ ] **Step 1: 重写 resolver spec 为 3 用例**：法币→`{finance, NOT_CRYPTO}`；crypto（无论金额/币种，含 BTC）→`{travelRule, TR_REQUIRED}`；assetType 大小写不敏感
- [ ] **Step 2: 跑红**：`npx jest src/modules/sumsub-shared/kyt-txn-type`
- [ ] **Step 3: 实现 resolver 收窄**；两域调用点同步改入参（deposit :368 删 currency/amount/counterpartyIsVasp 三参；withdraw :2487 同）；`SINGLE_TXN_SUBMIT_ENABLED` 分支不动
- [ ] **Step 4: 后端自报链拆除**：信号 DTO 删字段、:166-171 两段校验删、:217/:354 写点删、`processSignal`→`detected()` 透传删、`detected()` 入参删（deposit 列保留但 `detected` 不再写它）；demo-lib/verify-act1 两个调用方删字段
- [ ] **Step 5: 受冲击断言翻面**：deposit-workflow.spec :775 用例改期望 travelRule/`TR_REQUIRED`（夹具 `baseCryptoNotVasp` 更名去 VASP 语义）、:807/:867 维持 finance（NOT_CRYPTO / 开关关）、:754 维持；e2e :561-586 non-VASP 用例改期望 travelRule；withdraw spec :833-862 夹具去 counterpartyIsVasp 入参
- [ ] **Step 6: 跑绿**：`npx jest src/modules/sumsub-shared src/modules/trading/deposit-transactions src/modules/trading/withdraw-transactions`；e2e 按仓库既有跑法单跑 `deposit-sumsub-verdicts`
- [ ] **Step 7: 收尾 grep**：`grep -rn "counterpartyIsVasp" src/modules/trading/deposit-transactions scripts client-web/src --include="*.ts*" | grep -v "deposit.counterpartyIsVasp\|spec"` 预期只剩订单列消费（Task 4 写入点尚未建，此时应为 0 写点）；`grep -rn "counterpartyIsVasp is required"` 归零
- [ ] **Step 8: Commit** `feat(counterparty): one-line KYT typing — crypto=travelRule; dismantle self-reported VASP chain`

### Task 3: mock 侧地基——adapter 迁址 + 名录 profile + TR 规则服务 + 尾号 4444

**Files:**
- Create: `src/modules/sumsub-shared/travel-rule/`（`travel-rule-adapter.interface.ts`、`mock-travel-rule.adapter.ts` 原样迁入 + 扩展、`mock-tr-rules.service.ts`、`mock-tr-rules.service.spec.ts`）
- Modify: `asset-treasury/withdrawal-addresses/withdrawal-addresses.module.ts`（改 import 新位置，provider 绑定保留或改引共享 provider——以两模块各自 provide 同一 token 的最小改法为准）、`withdrawal-address-workflow.service.ts`（import 路径）、`deposit-transactions.module.ts`（provide token + MockTrRulesService）
- Delete: 旧位置两文件
- Test: adapter spec 随迁 + 新规则服务 spec

**Interfaces:**
- Consumes: Task 1 的 deposit 认领列（findKnownSource 查询键）。
- Produces: `TRAVEL_RULE_ADAPTER` token（新路径导出）；`TravelRuleAdapter` 接口增 `getVaspProfile(vaspDid: string): VaspProfile | null`；`MockTrRulesService.isTrApplicable(currency: string, amount: number): boolean` 与 `findKnownSource(userId: string, fromAddress: string): Promise<string | null>`（名字、值域照「目标终态速查」）。

- [ ] **Step 1: 写失败测试**：①尾号 4444 → Grey Harbor 归因；②`getVaspProfile` 两条名录各返回速查表值、未知 did → null；③`isTrApplicable`：USDT 999.99 false / 1000 true / AED 3499 false / 3500 true / BTC false+warn（≥ 语义与漏配行为 = 旧 resolver 原样）；④`findKnownSource`：同客户×同址×`sourceClaimedAt` 非空 → 返回 depositNo，异客户或未认领 → null（prismaMock 断言 where 实参）
- [ ] **Step 2: 跑红** → **Step 3: 迁址 + 实现**（1111/2222/3333 既有规则一行不改；地址簿 workflow 只改 import 路径——行为零变化，模块 jest 回归作证）
- [ ] **Step 4: 跑绿**：`npx jest src/modules/sumsub-shared/travel-rule src/modules/asset-treasury/withdrawal-addresses`
- [ ] **Step 5: Commit** `refactor(counterparty): travel-rule mock moves to sumsub-shared; VASP directory profile, TR rules service, suffix 4444`

### Task 4: 充值归因喂——applySourceAttribution + 认领挂起 + admin 端点

**Files:**
- Modify: `deposit-workflow.service.ts`、`deposit-sumsub/admin-deposit-demo.controller.ts`、`rbac.catalog.ts`（deposit demo 路由区块）
- Test: `deposit-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 3 adapter/规则服务；Task 1 列。
- Produces（controller/种子脚本按此调）:
  - `applySourceAttribution(depositNo: string, input: { attribution: 'VASP'|'UNHOSTED', vasp?: 'MOCK_VASP_EXCHANGE'|'GREY_HARBOR' }, actor: AdminActor)`：守卫 status===COMPLIANCE_PENDING 否则 409 `ATTRIBUTION_NOT_PENDING`、crypto 否则 400；VASP → 写 `{counterpartyIsVasp:true, counterpartyVasp, counterpartyVaspDid, sourceAttributedAt}`；UNHOSTED → `{counterpartyIsVasp:false, sourceAttributedAt}`；两者均记 `DEPOSIT_SOURCE_ATTRIBUTED`（operator，afterData=归因结果）；UNHOSTED 续判：`sumsubTxnType==='travelRule' ∧ isTrApplicable(currency, amount)` 时——`findKnownSource` 命中 → 写 `knownSourceRef` + `recordSystem` `DEPOSIT_KNOWN_SOURCE_MATCHED`；未命中 → `hangForOwnershipClaim`
  - `hangForOwnershipClaim(deposit)`（私有）：`issuer.register({ materialType:'SOURCE_OWNERSHIP_CLAIM', orderDomain:'DEPOSIT', orderRef: depositNo, origin:'SUMSUB_PUSHED', restrict:false })` → 复用 `applyKytAwaitUser` 的 hasOutstanding→ACTION_PENDING 推进段（抽共享私有方法，死角守卫原样保留）
  - admin 端点 `POST /admin/deposit-sumsub/demo/feed-attribution`（速查表 body；demo controller 既有模式）+ rbac `route()` 挂 `DEMO_VERDICT_WRITE`
  - admin 读增强：`findOneForAdmin` 响应加 `vaspProfile`（按单上 did 调 `getVaspProfile` 现拼，不落库）
  - 每个新审计写点带显式 `requestId`（沿本文件既有式样）
- 材料注册表第 6 型与标签同在本任务落（`config/material-refresh-policy.json` + `material-policy.ts` 允许无 levelName 型 + `MATERIAL_TYPE_LABELS`），issuer 不再拒 `SOURCE_OWNERSHIP_CLAIM`

- [ ] **Step 1: 写失败测试**：①VASP 喂 → update 实参三列 + SOURCE_ATTRIBUTED 审计（operator）；②GREY_HARBOR → Grey Harbor 名入列；③finance 型/法币喂 → 400，非 COMPLIANCE_PENDING → 409；④UNHOSTED + 800 USDT → 只记归因、issuer 不被调、状态不动；⑤UNHOSTED + 1500 USDT + findKnownSource 命中 → knownSourceRef 落列 + KNOWN_SOURCE_MATCHED（recordSystem）、不挂起（Review Focus 1 的查询含自身认领由 Task 3 ④钉）；⑥UNHOSTED + 1500 USDT + 无已知 → issuer.register 实参 materialType/orderRef 正确 + 状态推 ACTION_PENDING + `DEPOSIT_ACTION_REQUIRED`；⑦admin 读含 vaspProfile
- [ ] **Step 2: 跑红** → **Step 3: 实现** → **Step 4: 跑绿**：`npx jest src/modules/trading/deposit-transactions src/modules/identity/material-requests`
- [ ] **Step 5: Commit** `feat(counterparty): deposit source attribution feed — VASP block data, unhosted claim hang, known-source match`

### Task 5: 认领提交回炉——client 端点 + 快照 + mock 即时 APPROVED

**Files:**
- Modify: `deposit-workflow.service.ts`、充值客户控制器（挂 ownership-claim 端点）、`deposit-transactions.service.ts`（客户面白名单 :426-446 +5 列）、`deposit-transactions.service.spec.ts`（SENSITIVE_KEYS 调整）、`dto/`（OwnershipClaimDto）
- Test: `deposit-workflow.service.spec.ts` + 投影 spec

**Interfaces:**
- Consumes: Task 4 挂起机制；材料账既有 `markSubmitted`/`MaterialRequestReviewService.applyReview`/`onMaterialRequestReviewed`（RESUME 回炉零改动）。
- Produces:
  - `submitOwnershipClaim(depositNo: string, customerId: string, dto: OwnershipClaimDto)`：守卫（本人 / ACTION_PENDING / 存在 PENDING_SUBMISSION 的 SOURCE_OWNERSHIP_CLAIM 单，违者 403/409）；DTO 校验（THIRD_PARTY_PERSON：name+relationship 必填；THIRD_PARTY_VASP：name 必填；SELF：零附加——mock 签名即点即过语义）；写认领快照四列 + `DEPOSIT_SOURCE_CLAIM_SUBMITTED`（客户主体，afterData=快照）；随后调材料账 `markSubmitted` + `applyReview(APPROVED)`（mock 即时回调，项目允许假设；既有广播 → RESUME 回炉自动发生）
  - client 端点 `POST .../:depositNo/ownership-claim`（返回更新后的客户视图）

- [ ] **Step 1: 写失败测试**：①SELF 提交 → 快照列 + 审计（actor=客户）+ markSubmitted/applyReview 均被调；②THIRD_PARTY_PERSON 缺 relationship → 400；③非本人 403、非 ACTION_PENDING 409、无未决认领单 409（Review Focus 5）；④THIRD_PARTY_VASP → sourceClaimName=VASP 名、relationship null
- [ ] **Step 2: 跑红** → **Step 3: 实现**
- [ ] **Step 4: 投影与敏感键**：白名单 +5；SENSITIVE_KEYS 按「目标终态速查」调整（`counterpartyVasp` 移出、`counterpartyVaspDid`/`knownSourceRef`/`sourceAttributedAt` 加入），违禁泄漏断言跑绿（Review Focus 6）
- [ ] **Step 5: 跑绿**：`npx jest src/modules/trading/deposit-transactions`（回炉链路以 ⑥既有 onMaterialRequestReviewed spec 回归作证，不重测）
- [ ] **Step 6: Commit** `feat(counterparty): ownership claim — two-branch submit, snapshot, instant mock approval, resume`

### Task 6: V12 两域裁决分支

**Files:**
- Modify: `sumsub-shared/verdict-buttons.shared.ts`、`deposit-sumsub/fixtures/verdict-buttons.ts`、withdraw 侧同名 fixture、deposit/withdraw 两个 KYT verdict handler（V10 同款接线）
- Test: 两域 workflow spec

**Interfaces:**
- Consumes: 既有 `decideVerdictLanding` 三档与 V10 落点机制。
- Produces: 共享表 `V12_VASP_UNQUALIFIED`（ENGINE）；tag 常量 `VASP_UNQUALIFIED`；deposit/withdraw 喂 V12 → 落 `MANUAL_CHECKING`（manualReason `vasp_unqualified`）；swap fixture 不含 V12（表内注释一行说明语义性缺席）。

- [ ] **Step 1: 写失败测试**：①deposit COMPLIANCE_PENDING 喂 V12 → MANUAL_CHECKING + manualReason=vasp_unqualified；②withdraw 同款；③deposit FROZEN 喂 V12 → IGNORE 不动（Review Focus 3，沿 decideVerdictLanding 既有档）；④swap 按钮表无 V12
- [ ] **Step 2: 跑红** → **Step 3: 实现**（照 V10/V11 接线式样；共享表键数断言 11→12 同步）
- [ ] **Step 4: 跑绿**：`npx jest src/modules/sumsub-shared src/modules/deposit-sumsub src/modules/withdraw-sumsub src/modules/trading`
- [ ] **Step 5: 复核后续弧零改动**：既有退回（V10 路径 :899-955/:1858-1926）与提现复核态退款对 V12 落点的单子**本来就可用**——跑两域既有处置弧 spec 回归作证，不新增边
- [ ] **Step 6: Commit** `feat(counterparty): V12 counterparty-VASP-unqualified verdict — lands manual checking, exits via existing return/refund arcs`

### Task 7: 提现接线——建单带出 + TR 三档快照 + 投影

**Files:**
- Modify: `withdraw-workflow.service.ts`（:296-325 建单守卫段、`insertRecord` :489-523、`submitSumsubTxns` :2487 附近）、`withdraw-transactions.service.ts`（客户视图 + Address label 键回链 :523-532、admin 读加 vaspProfile）、withdraw SENSITIVE 断言 spec
- Test: `withdraw-workflow.service.spec.ts`、`withdraw-transactions.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 列、Task 3 `isTrApplicable`/`getVaspProfile`。
- Produces: 建单落 `withdrawalAddressNo/beneficiaryName/beneficiaryType/counterpartyVaspName/counterpartyVaspDid`（crypto 与 fiat 两路径都抄；fiat 的 vasp 两列恒 null）；travelRule 型在 submit 后一次性写 `travelRuleSnapshotJson = { status, beneficiaryName, beneficiaryType, counterpartyVaspName, counterpartyVaspDid }`，`status = !isTrApplicable ? 'NOT_APPLICABLE' : (counterpartyVaspName ? 'EXCHANGED' : 'SELF_HOSTED_NO_EXCHANGE')` + `recordSystem` `WITHDRAW_TRAVEL_RULE_SNAPSHOTTED`；客户视图 +3（beneficiaryName/beneficiaryType/label 经 addressNo 键查）、快照与 did 不出客户面。

- [ ] **Step 1: 写失败测试——建单抄字段**：crypto 建单 create 实参五列 = 地址簿条目值；fiat 建单抄三列、vasp 两列 null
- [ ] **Step 2: 写失败测试——快照三档矩阵**（Review Focus 4）：50 USDT 自托管→NOT_APPLICABLE；1000 USDT（恰好线上）×VASP→EXCHANGED；1500 USDT×自托管→SELF_HOSTED_NO_EXCHANGE；AED 法币单（finance 型）→不写快照不记码
- [ ] **Step 3: 写失败测试——label 键回链**：`withdrawalAddressNo` 存在时按键查 label（findFirst where addressNo），值反查退场
- [ ] **Step 4: 投影与敏感键**：客户视图 +3；`travelRuleSnapshotJson`/`counterpartyVaspDid` 进敏感断言（Review Focus 6）；admin 读加 vaspProfile 现拼
- [ ] **Step 5: 跑红→实现→跑绿**：`npx jest src/modules/trading/withdraw-transactions`
- [ ] **Step 6: Commit** `feat(counterparty): withdraw carries counterparty from address book; tiered travel-rule snapshot`

### Task 8: 审计名册登记（判例：一处别漏 exporter）

**Files:**
- Modify: `audit-actions.constant.ts`（V4 段 +3、V5 段 +1，四属性照速查表）
- Modify: `doc-final/lark/2026-09-15-audit-actions-catalog-by-domain-workflow.md`（+4 行人写说明）
- Regenerate: `doc-final/lark/2026-09-16-audit-actions-catalog-full.md`

- [ ] **Step 1: 常量 4 条 spec**（注释标对手方波二与触发者；V4 头注释 47→50、V5 头注释 33→34 同步）
- [ ] **Step 2: `npx jest src/modules/audit-logging`** 全绿
- [ ] **Step 3: 种子词表 +4 行** → `npm run audit:vocab` exit 0 且 full 版 diff 恰 +4 行
- [ ] **Step 4: 核对数字判据**：现役码 352（vocab 输出计数为准）
- [ ] **Step 5: Commit** `feat(counterparty): 4 audit actions registered (constant + vocab catalog)`

### Task 9: client-web——弹窗改造 / 认领表单 / 两详情页

**Files:**
- Modify: `client-web/src/pages/Deposit.tsx`（删 :1197-1223 两按钮与 :506 校验、:413 字段；加可选 "From address (optional)" 输入，默认留空仍随机生成）、`MaterialVerification.tsx`（formKind 分叉：OWNERSHIP_CLAIM 型渲染认领表单，不调 session）、`DepositDetail.tsx`（Source 区块：对手方名称/认领状态/认领快照——白名单内三类）、`WithdrawDetail.tsx`（Route 区 +受益人两行；label 改随响应键回链值）、`components/detail/MaterialRequestSection.tsx`（认领型按钮文案 "Declare source" 跳同一 `/verification/:requestNo`）
- Test: `cd client-web && npx tsc -b --noEmit` + `npm run test:client`（组件单测不可行判例在案，验收靠 Task 13 截图）

**Interfaces:**
- Consumes: Task 5 claim 端点与客户视图字段；材料单响应需带 materialType/formKind（Task 4 注册表已供）。
- Produces: 认领表单二分支——"This is my own wallet"（展示一颗 "Verify by signature" 确认按钮，点击即提交 `{claimType:'SELF'}`，mock 即点即过）/ "Sent by someone else"（子选 个人→姓名+关系 / 交易所→VASP 名称，提交对应 payload）；提交成功回详情页，状态随回炉刷新。

- [ ] **Step 1: Deposit.tsx 弹窗改造**（孤儿状态变量一并清）
- [ ] **Step 2: MaterialVerification 分叉 + 认领表单**（二分支交互照 Interfaces；文案 builder 定，白话、不露调查语义）
- [ ] **Step 3: DepositDetail Source 区块 + WithdrawDetail 受益人行**
- [ ] **Step 4: 过随手闸 ③** + `npm run test:client`
- [ ] **Step 5: Commit** `feat(client): claim form two branches, source blocks, from-address input, self-report buttons retired`

### Task 10: admin-web——两详情页区块 + ⚡归因区 + V12 按钮

**Files:**
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx`（主栏 Compliance 后插 "Source & Counterparty" 区块：归因结果/托管快照/VASP 档案三行（vaspProfile）/政策口径一行静态文案/认领快照/knownSourceRef 回链；侧栏 ⚡ 区加 "Attribution Simulation" 三按钮：VASP (qualified) / VASP (Grey Harbor) / Unhosted，仅 simEnabled ∧ status===COMPLIANCE_PENDING ∧ crypto 渲染）、`WithdrawTransactionDetail.tsx`（主栏加 "Counterparty / Travel Rule" 区块：受益人/beneficiaryType/VASP 名+档案/TR 状态徽；`withdrawalAddressNo` 回链地址详情）、`admin-web/src/rbac/permissions.ts`（feed-attribution 键）
- Test: `cd admin-web && npx tsc -b --noEmit`（验收靠 Task 13 截图）

**Interfaces:**
- Consumes: Task 4/7 admin 读增强（vaspProfile）、feed-attribution 端点；V12 按钮经既有 SimulationPanel 自动出现（按钮表驱动，零前端改动——核实即可）。

- [ ] **Step 1: permissions.ts 加键**（`api.post.admin_deposit_sumsub_demo_feed_attribution` 式样，照既有命名法）
- [ ] **Step 2: Deposit 详情区块 + ⚡归因三按钮**（TR 状态/档案用既有徽章组件；政策口径文案："Policy: EEC completed ∧ risk score < 10 ∧ licensed → eligible"）
- [ ] **Step 3: Withdraw 详情区块**（三档状态各配徽色；NOT_APPLICABLE 副文案 "below threshold, submitted anyway"）
- [ ] **Step 4: 核实 V12 按钮**在两域 SimulationPanel 出现（fixtures 驱动）
- [ ] **Step 5: 过随手闸 ②**
- [ ] **Step 6: Commit** `feat(admin): source/counterparty blocks, attribution simulation, travel-rule panel`

### Task 11: 种子与花名册（改一处先找齐同款——本任务即清单）

**Files:**
- Modify: `scripts/demo-lib.ts`（地址种子 +#12 demo_bob 尾号 4444；充值计划 +4 单：认领甲（喂 UNHOSTED→客户 SELF 认领→回炉→Approved 入账，固定 fromAddress 串）/ 认领乙（THIRD_PARTY_PERSON 同套路）/ 同源对照（与甲同 fromAddress，喂 UNHOSTED→KNOWN_SOURCE 免问→Approved）/ VASP 不合格（喂 GREY_HARBOR 归因→V12→运营提退回→MLRO 批→RETURNED）；提现计划 +2 单：grace ≥1000 USDT→1111 地址、alice ≥1000 USDT→自托管地址——两人先补一笔入金保证余额，金额 builder 按现有计划核定）
- Modify: `doc-final/demo/baseline.md`（demo:all 判据数随花名册更新）
- Test: 种子路径走服务直调（判例），新单沿既有计划式样

**Interfaces:**
- Consumes: Task 4/5/6/7 全部服务方法。
- Produces: 种子地址 12、充值花名册 +4、提现花名册 +2；认领对照所用固定 fromAddress 串写进 data.md 速查（Task 12）。

- [ ] **Step 1: 地址种子 #12**（照波一 #9/#10 式样：`addressType:'VASP'`、Grey Harbor 名/did、`declaredHosting:'VASP'`、DECLARATION、GREEN、ACTIVE、traceId 既有前缀、`writeSeedAudit`）
- [ ] **Step 2: 充值计划 +4**（走 `applySourceAttribution`/`submitOwnershipClaim`/run-verdict 服务直调；退回单复用既有退回腿式样）
- [ ] **Step 3: 提现计划 +2**（含前置入金；断言终态 SUCCESS 且 `travelRuleSnapshotJson.status` 各为 EXCHANGED / SELF_HOSTED_NO_EXCHANGE）
- [ ] **Step 4: 本地重铺实证**：`bash scripts/stack.sh reset self` → `bash scripts/on-stack.sh self demo:all` 全绿；baseline.md 对照更新
- [ ] **Step 5: Commit** `feat(counterparty): seeds — claim exhibits, known-source pair, VASP-unqualified return, TR snapshot withdrawals`

### Task 12: 文档与剧本

**Files:**
- Modify: `doc-final/reference/sumsub-mock-touchpoints.md`（续登 4 行：⑤归因喂（feed-attribution + `attributeAddress`，真身=Standalone Wallet Attribution/交易内归因，缺口 #1/#4）｜⑥VASP 名录 profile（`getVaspProfile`，真身=VASP 名录 API 实拉 637 家）｜⑦TR 阈值与认领规则（`MockTrRulesService`，真身=Sumsub TR 规则配置 `Awaiting user`，缺口 #4/#5）｜⑧认领解锁（`submitOwnershipClaim` 即时 APPROVED，真身=`POST /kyt/txns/{id}/travelRuleOwnership` + webhook `applicantKytTxnAwaitingUser`），各写切换刀口）
- Modify: `doc-final/demo/script.md`（第三幕插两站：「无主来源认领」三单连演（甲签名认领/乙第三方申报/同源免问对照）+「对手方 VASP 不合格 → 原路退回」（⚡Grey Harbor 归因→区块亮差档案→**第二屏台词：打开 Sumsub VASP 名录对照政策口径**→⚡V12→复核台提退回→MLRO 批→RETURNED，与 3.5 退回红线对照收尾）；第五幕 5.1 扩一拍：TR 区块三档对照（50 USDT 单 NOT_APPLICABLE / grace VASP 单 EXCHANGED / alice 过线自托管单 SELF_HOSTED_NO_EXCHANGE）+ 受益人随报文）
- Modify: `doc-final/demo/data.md`（速查表 +尾号 4444 行与认领固定 fromAddress 串；地址种子段 11→12；充值/提现花名册新条目）
- Modify: `doc-final/modules/v4-deposit.md`（§1 判型口径改一行化 + 归因/认领/VASP 分支叙事；§3 决策表 +⚡归因/认领/V12 三行；§4 演示脚本补两站；§5 技术节点 + **政策口径一行**；头部 Last Verified）
- Modify: `doc-final/modules/v5-withdraw.md`（§1/§5 建单带出与 TR 快照；§6 删过时行"VASP 归因靠客户自报"；**政策口径一行**；头部）
- Modify: `doc-final/modules/overview.md`（头部滚动段：判型口径/审计 348→352/种子地址 12/⚡12 键一句）

- [ ] **Step 1: 触点登记册 +4 行**（写实际落点，不写 plan 预估）
- [ ] **Step 2: script.md 两幕改**（看点五件一个不许少：认领二分支/同源免问/第二屏名录对照/V12 退回/TR 三档——具体台词 builder 定）
- [ ] **Step 3: data.md 手写区同步**（生成区由 demo:all 自写，不手改）
- [ ] **Step 4: 两模块篇 + overview 同步**
- [ ] **Step 5: Commit** `docs(counterparty): wave2 — touchpoints, script stations, module/overview sync, policy line`

### Task 13: 收尾闸与走查 + 战役收官（本任务过哪几条，plan 写死在此）

**Files:** 证据落 `doc-final/superpowers/checkups/2026-10-22-counterparty-wave2-evidence/`

- [ ] **Step 1: 随手闸三件** + `npx jest src/modules/trading src/modules/sumsub-shared src/modules/deposit-sumsub src/modules/withdraw-sumsub src/modules/identity/material-requests src/modules/audit-logging src/modules/asset-treasury/withdrawal-addresses`（禁 `-t` 过滤）+ `npm run test:client` + e2e `deposit-sumsub-verdicts` 全绿
- [ ] **Step 2: worktree 栈 preview 走查截图**（永不豁免①）：充值认领全链两分支（挂起横幅→表单两形态→回炉入账）、同源免问对照单区块回链、⚡归因三按钮、VASP 不合格单的差档案区块与退回终态、提现 TR 区块三档各一单、客户端两详情页（无敏感泄漏目检：DevTools 响应无 did/快照/knownSourceRef）
- [ ] **Step 3: 重铺闸**（动 schema）：`bash scripts/stack.sh reset self` → `on-stack.sh self demo:all` 全绿对 baseline（判例：新 worktree 先 `npm ci`×2、不接 tail 管道）；链内 verify:demo-data 全绿（在刚铺完的干净库跑）
- [ ] **Step 4: `on-stack.sh self verify:coa`**（永不豁免②——花名册新增 RETURNED/提现单动了钱，恒等式+负余额全绿）
- [ ] **Step 5: `on-stack.sh self verify:rbac`**（动 rbac.catalog；判据=红集恒等；API_BASE 指本栈）+ `on-stack.sh self verify:act1`（动过其调用方）
- [ ] **Step 6: 交付清单命中行逐条核**：持久状态变化留痕（4 新码写点 + 显式 requestId）｜新增审计码四属性冻结｜新状态/新结局——**零新态零新边**（SLA 显式回答：认领挂起复用 ACTION_PENDING 既有 7 天钟，无新钟）｜动了钱——走既有退回/退款弧 + verify:coa｜maker-checker——走既有审批正门、零新策略｜新增权限组——零｜新增 admin 端点——feed-attribution route() + 合并 main 后 `db:base:sync` + 重启｜新业务动作前端有入口（⚡归因区/认领表单/区块）｜退役动作前端同步删（弹窗两按钮）｜改交易域问另两域——deposit/withdraw 本波同改，swap 显式豁免（站内无外部对手方，V12 不暴露）｜新字段客户面裁决（白名单 +5/+3、敏感集双域调整）｜金额——阈值判定沿旧 resolver 数值语义（number ≥，无换算改动）｜业务键（addressNo/DP-xxx 回链）｜新事件——零｜改 schema 有迁移无 backfill｜页面种子同步 data.md/script.md｜前端截图｜**末波无承接**——改做战役收官（Step 7）｜收尾报告 + CHANGELOG 一行 + BACKLOG 核对（累计升格已登，无新增）
- [ ] **Step 7: 战役收官**：总纲 §6 收尾义务——充值/提现政策口径一行已进模块篇（Task 12）；收官证据册落 checkups；归档动作（总纲/波一波二 spec+plan/骨架 → `doc-final/archive/`）**随合并批执行**，归档前总纲头部加一行"两波收官 2026-10-22"
- [ ] **Step 8: Commit** `chore(counterparty): wave2 closeout evidence & campaign closure`

---

## 不做（对照根纲 §2 + 总纲 §4，评审按此拒绝扩 scope）

兑换域任何改动（含 V12 暴露）｜法币充值归因/认领｜关联累计监视器｜VASP 名录页/尽调册实体｜真实 Sumsub 调用与切换机制实现（只登记触点）｜新挂起状态/新边/新审批类型｜`sumsubPaymentMethodId` 等预留字段｜幂等/重试/并发锁等技术兜底

## Self-review 记录（写完即查）

- spec 覆盖：§2.1→Task 2；§2.2→Task 1/3/4/10；§2.3→Task 4/5/9；§2.4→Task 3/4/9（From address 输入在 Task 9）；§2.5→Task 1/7/10；§2.6→Task 6；§2.7→Task 3/4/10/12；§2.8→Task 4/5/7/8；§2.9→Task 11/12；§4→Task 13。无悬空承诺。
- 类型一致性：`applySourceAttribution`/`hangForOwnershipClaim`/`submitOwnershipClaim`/`isTrApplicable`/`findKnownSource`/`getVaspProfile`/`VASP_UNQUALIFIED`/`V12_VASP_UNQUALIFIED` 诸名在 Task 3–11 间已核对一致；`beneficiaryType` 刻意避开订单既有 `ownerType` 列名（速查表注明）。
- 已知口径差点名：spec §2.6"复用 V10 落点机制"在本 plan 落为"沿 `decideVerdictLanding` 进 MANUAL_CHECKING + 既有弧"，V10 的 earlyReturnTag 直通 initiateReturn 之路对 V12 不照搬（V12 不自动开退回审批——运营看完区块再提，maker 位留人）；评审以本 plan 为准。
- 种子对照组前提：认领甲与同源对照必须同一 fromAddress 串且顺序先后——Task 11 Step 2 已按序排列；demo:all 顺序执行满足（项目允许假设：单人顺序）。
- 承接自脑暴的拍板已全部入 plan：二分支表单（岔口一）、已知来源零清单页（岔口二修正）、⚡既有面板+退回出口（岔口三）、展示三条（岔口四至六）、TR 三档甲案（builder check 岔口）。
