# 对手方波一 · 提现地址簿重造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **派发注意（项目总纲 §6）**：每个任务 prompt 必须带仓库根 `CLAUDE.md` §0–§5 要点；任务执行降档 `sonnet`、评审不降档；写前端的任务先读 `doc-final/rules/frontend-client.md` / `frontend-admin.md` 与 `ui-contract/`，写后端的先读 `rules/backend.md`、动审计先读 `rules/audit-logging.md`。

**Goal:** 提现地址簿长出受益人三档（本人/第三方申报）、托管自报×归因交叉红旗、筛查态与签名验证（全 mock），状态机扩 PENDING_VERIFICATION / REJECTED 两态，两绿汇合才进既有冷却；第二幕"首法币即时生效"链路零改动。

**Architecture:** 改造不新建——`asset-treasury/withdrawal-addresses` 模块原地扩字段扩边；登记落点在主体层按 2×2 一次算出，筛查结论由 mock adapter 按**确定性测试地址**规则给出（尾号 2222→YELLOW、3333→RED 登记即拒、默认 GREEN——演示者输入已知地址得到已知结局，验收判据所在）；⚡筛查喂与签名验证是登记后的两个显式迁移入口（⚡降为覆写后门）；审计走既有管道加 5 个新码；种子/剧本/文档同步。**全 mock、零真实 Sumsub 调用**；每个 mock 触点登记进新文档 `reference/sumsub-mock-touchpoints.md`（业主后续要做 mock↔sandbox 切换的地图）。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle（本波不动钱）；React client-web / admin-web；jest + vitest。

**Spec:** `doc-final/superpowers/specs/2026-10-22-counterparty-wave1-withdrawal-address-spec.md`（总纲：`2026-10-22-counterparty-layer-charter.md`，裁定以总纲 §2/§4 为准）

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用
- 本轮特有：
  - **全 mock**：不发任何真实 Sumsub 请求；凡"站在 Sumsub 一侧"的能力（归因/筛查/签名验证）都是 mock，且必须登记进 `reference/sumsub-mock-touchpoints.md`（Task 10 建册；业主要做 mock↔sandbox 切换，漏登记 = 将来切换时找不到刀口）
  - **不为真集成预留字段**（总纲 §4 YAGNI）：不加 `sumsubPaymentMethodId` 之类
  - 申报证据字段（`ownerType`/`beneficiaryName`/`beneficiaryRelationship`/`declaredHosting`）登记后**冻结**，`updateAddress` 收窄为仅 `label`
  - `@@unique([customerId, network, address])` 原样保留；REJECTED 占坑即封禁、不可复活（spec §2.1 裁定③ + §5 默认升定案）
  - 客户地址簿**无 maker-checker**：不新增审批类型、不接审批中心（总纲 §2.6 措辞澄清）
  - 零新权限组/桶/域（⚡筛查复用 `DEMO_VERDICT_WRITE`，签名验证是客户端点）
  - **数字判据（收尾复核，改完必须恰好对上）**：迁移表 7 态 / 9 边 / 7 动作枚举 ｜ 审计现役码 343→**348**（+5）｜ `demo:all` 后种子地址 8→**11** 条 ｜ 剧本站 5 ④ 三拍→**五拍**

## Review Focus

spec 蕴含但下列任务测试若没钉住就会咬人的五类输入（已逐条把测试放进属主任务）：

1. **首法币即时生效回归**（第二幕②依赖）：银行路径两绿即时成立，首个法币账户必须仍落 `ACTIVE` 并解交易起始门 → Task 3 Step 2 测试 + Task 11 走查单拍。
2. **每网络 3 条上限漏数新态**：`PENDING_VERIFICATION` 不计入上限 = 无限占坑 → Task 3 Step 4 测试。
3. **冷却起点漂移**：签名路径若沿用登记时刻的 `activatesAt`，客户拖 24h 后签名 = 零冷却直接可激活 → Task 3 Step 6 测试（release 时重算 activatesAt）。
4. **⚡喂 RED 打在非 pending 态**：ACTIVE/终态必须 409（迁移表拒绝），否则 ⚡ 变成绕表直写 → Task 4 Step 5 测试。
5. **R5 判别式失效**：`verify-demo-data` 现靠 `ownershipProofType='DEMO_FIXTURE'` 识别种子地址，枚举真值化后判别式空转 → Task 9 Step 3 改判别式为 traceId 前缀并在重铺闸实证非空。
6. **RED × 首法币撞线**：尾号 3333 的 IBAN 若先走"首法币直落 ACTIVE"分支就把拒绝短路成放行——RED 优先级必须高于首法币规则 → Task 3 Step 2b 测试。

## 现状锚点（实查 2026-10-22，执行者无须重查）

- schema：[prisma/schema.prisma:728](prisma/schema.prisma:728) `WithdrawalAddress`（`activatesAt` 非空；`@@unique([customerId, network, address])`）
- 迁移表：`constants/withdrawal-address-transitions.constant.ts` 现 5 态 5 边 5 动作
- 主体层 `withdrawal-address.service.ts`：`create`（链上）/ `createBankAccount`（法币，首法币直写 ACTIVE）/ `activate`/`cancel`/`suspend`/`unsuspend`/`skipCooling`/`deactivate`/`updateDetails(label+beneficiaryName)`
- 编排层 `withdrawal-address-workflow.service.ts`：归因 `trAdapter.attributeAddress` → `addressType`（'VASP'/'SELF_CUSTODY'）；`ownershipProofType` 恒写 `'DECLARATION'`；审计 9 个既有码在 `V1_AUDIT_ACTIONS` CONFIG 段（[audit-actions.constant.ts:759](src/modules/audit-logging/constants/audit-actions.constant.ts:759)）
- mock 归因：`mock-travel-rule.adapter.ts`——尾号 `1111` → Mock VASP（DI token `TRAVEL_RULE_ADAPTER`）
- 外部消费方（不许破坏）：`customer-access.service.ts:168` 与 `withdraw-workflow.service.ts:296-315` 都只认 `status:'ACTIVE'`（+`addressType`），新增态不影响
- 种子：`scripts/demo-lib.ts:367,392`（直写 prisma，`ownershipProofType:'DEMO_FIXTURE'`、traceId 前缀 `demo-setup-withdrawal-address`）；`verify-demo-data.ts:257` R5 以 `DEMO_FIXTURE` 为判别式
- API 调用方：`scripts/verify-act1.ts:152,552-562`（V7 上限探针）；两个 e2e（`test/withdraw-money-arcs`、`deposit-sumsub-verdicts`）直写 prisma，靠 schema 默认值兜住，无须改
- 前端：client `WithdrawalAddresses.tsx`（1574 行，crypto/bank 两式 modal 表单 + 列表 + 详情 + 编辑 label/beneficiary）；admin `WithdrawalAddressList.tsx` / `WithdrawalAddressDetail.tsx`（canWrite= `PERMISSIONS.WITHDRAWAL_ADDRESS_SUSPEND`）
- ⚡先例：`admin/sumsub/simulate/*` 全挂 `DEMO_VERDICT_WRITE`（合规官持，且合规官持 `WITHDRAWAL_ADDRESS_READ` 看得到地址详情页——喂筛查选它，不选金库的 `WITHDRAWAL_ADDRESS_WRITE`，因为筛查站在 Sumsub 一侧，与喂裁决同义）
- 剧本：`demo/script.md` 站 5（43 行起）④ 现三拍；`demo/data.md:53`「地址簿种子」手写段

## 目标终态速查（全任务共用，名字以此为准）

**schema 新列**（全部给默认值/可空，e2e 直写 prisma 的夹具零改动）：

| 列 | 类型 | 值域 |
|---|---|---|
| `ownerType` | `String @default("SELF")` | `SELF` / `THIRD_PARTY` |
| `beneficiaryRelationship` | `String?` | 自由文本，THIRD_PARTY 必填（DTO 层校验） |
| `declaredHosting` | `String?` | `SELF_CUSTODY` / `VASP`（crypto 必填；法币恒 null） |
| `hostingMismatch` | `Boolean @default(false)` | 自报 ≠ 归因 |
| `screeningAnswer` | `String?` | `GREEN` / `YELLOW` / `RED` |
| `screenedAt` | `DateTime?` | |
| `ownershipVerifiedAt` | `DateTime?` | 仅 SIGNATURE 路径 |

`ownershipProofType` 列不动，值集升级为 `SIGNATURE`/`DECLARATION`/`ATTESTATION`（`DEMO_FIXTURE` 退场，Task 9 清种子）。

**2×2 → 证据档与登记落点**（主体层一次算出）：

| 托管 × 受益人 | proofType | 所有权落定时刻 | 登记落点 |
|---|---|---|---|
| SELF_CUSTODY × SELF | `SIGNATURE` | 签名验证后 | `PENDING_VERIFICATION` |
| VASP × SELF | `DECLARATION` | 登记即落定 | `PENDING_ACTIVATION`（冷却） |
| 任意 × THIRD_PARTY | `ATTESTATION` | 登记即落定（姓名+关系即证据） | `PENDING_ACTIVATION`（冷却） |
| BANK × SELF | `DECLARATION` | 登记即落定 | 首法币→`ACTIVE`，否则冷却 |
| BANK × THIRD_PARTY | `ATTESTATION` | 同上 | 同上（首法币规则不区分受益人——登记时余额为零的理由对两者同样成立，spec 未另说，按零改动处理） |

**mock 确定性规则（业主 2026-10-22 补拍——测试地址驱动结局，验收判据所在）**：

| 地址 / IBAN 尾号 | 归因 | 筛查 | 登记结局 |
|---|---|---|---|
| `1111`（仅链上） | VASP（Mock VASP Exchange） | GREEN | 照 2×2 落点 |
| `2222` | 自托管 | **YELLOW** | 照 2×2 落点（中风险放行留痕） |
| `3333` | 自托管 | **RED** | **登记即 `REJECTED`**（插入即终态，属落点计算不是边；REGISTERED + REJECTED 双审计，后者 `recordSystem`、reason 固定 `Screening returned RED at registration`） |
| 其余 | 自托管 | GREEN（默认） | 照 2×2 落点 |

组合位不配（VASP×RED 波一用不上）；银行路径按 IBAN 尾号同规则、无归因。筛查结论写 `screeningAnswer`/`screenedAt`，登记时不单独记 SCREENED 审计（折进 `REGISTERED.afterData`；RED 例外见上表）；⚡ 是对已登记 pending 条目的**覆写后门**。测试地址完整串固化进 `demo/data.md` 速查（魔法 IBAN 两枚须预算过 mod-97——固定 BBAN 主体调 AE 检查位即可构造）。

**迁移表终形（7 态 9 边 7 动作——数字判据）**：

```
PENDING_VERIFICATION: RELEASE → PENDING_ACTIVATION ｜ REJECT → REJECTED ｜ CANCEL → CANCELLED   （新 3 边）
PENDING_ACTIVATION:   ACTIVATE → ACTIVE ｜ CANCEL → CANCELLED ｜ REJECT → REJECTED              （新 1 边）
ACTIVE:               SUSPEND → SUSPENDED ｜ DEACTIVATE → DEACTIVATED
SUSPENDED:            UNSUSPEND → ACTIVE
CANCELLED / DEACTIVATED / REJECTED: 终态
```

新动作：`RELEASE`（两绿汇合推进）、`REJECT`（筛查 RED）。首法币直落 ACTIVE 是**登记时落点计算**，不是边（沿 `createBankAccount` 既有写法）。

**审计新码 5 个**（进 `V1_AUDIT_ACTIONS` CONFIG 段既有 WITHDRAWAL_ADDRESS 块旁，四属性出生即冻结）：

| 码 | mode | requiredFields | 谁触发 |
|---|---|---|---|
| `WITHDRAWAL_ADDRESS_SCREENED` | I | `['afterData']` | ⚡喂 GREEN/YELLOW，operator 记操作人 |
| `WITHDRAWAL_ADDRESS_REJECTED` | I | `['reason']` | ⚡喂 RED（REJECT 边）operator；或登记即拒（尾号 3333）`recordSystem` |
| `WITHDRAWAL_ADDRESS_OWNERSHIP_VERIFIED` | I | `[]` | 客户签名验证（带 fromStatus/toStatus） |
| `WITHDRAWAL_ADDRESS_THIRD_PARTY_DECLARED` | I | `['afterData']` | 登记第三方地址时随 REGISTERED 加记（申报快照），客户主体 |
| `WITHDRAWAL_ADDRESS_HOSTING_MISMATCH_FLAGGED` | I | `['afterData']` | 登记时自报≠归因，`recordSystem` |

**新端点 2 个**：
- client `POST /client/withdrawal-addresses/:addressNo/verify-signature`（JWT 客户，mock 即点即过；client 路由不进 rbac 目录，同既有）
- admin `POST /admin/withdrawal-addresses/:addressNo/simulate-screening`，body `{ answer: 'GREEN'|'YELLOW'|'RED', reason: string }`，rbac `route()` 挂 **`DEMO_VERDICT_WRITE`**（零新组；admin-web `permissions.ts` 加键 `WITHDRAWAL_ADDRESS_SIMULATE_SCREENING: 'api.post.admin_withdrawal_addresses_addressno_simulate_screening'`）

**种子终盘 11 条**（`demo:all` 后；判别式 = traceId 前缀 `demo-setup-withdrawal-address`）：

| # | 条目 | 改法 |
|---|---|---|
| 1–6 | 六人各一条 BANK ACTIVE（既有） | 补 `ownerType:'SELF'`、`ownershipProofType:'DECLARATION'`、`screeningAnswer:'GREEN'`、`screenedAt` |
| 7–8 | alice/bob TRON SELF_CUSTODY ACTIVE（既有） | 补 `ownerType:'SELF'`、`declaredHosting:'SELF_CUSTODY'`、`ownershipProofType:'SIGNATURE'`、`ownershipVerifiedAt`、`screeningAnswer:'GREEN'`（四格之"本人×自托管已签名"） |
| 9 新 | grace TRON **本人×托管**：地址尾号 1111（`fakeTronAddress(seed).slice(0,30)+'1111'`，仍合 `^T[1-9A-HJ-NP-Za-km-z]{33}$`）、`addressType:'VASP'`、`counterpartyVaspName:'Mock VASP Exchange'`、`counterpartyVaspDid:'did:mock:vasp-exchange-001'`、`declaredHosting:'VASP'`、`DECLARATION`、GREEN、ACTIVE | 新增 + `writeSeedAudit` |
| 10 新 | kate TRON **第三方×托管**：同上 VASP 套件、`ownerType:'THIRD_PARTY'`、`beneficiaryName:'Li Hua'`、`beneficiaryRelationship:'Spouse'`、`ATTESTATION`、GREEN、ACTIVE | 新增 + `writeSeedAudit` |
| 11 新 | jack TRON **REJECTED 展品**：地址用尾号 `3333` 串（与魔法规则自洽——重放登记也得同一结局）、SELF_CUSTODY×SELF、`SIGNATURE` 未验证、`screeningAnswer:'RED'`、status `REJECTED` | 新增 + `writeSeedAudit` |

（alice 名下不加新 ACTIVE TRON 条目——站 5 ④a/b 她要现场再登记，3 条上限不能被种子占满。）

---

### Task 1: schema 扩列 + 迁移文件

**Files:**
- Modify: `prisma/schema.prisma:728-771`
- Create: `prisma/migrations/<timestamp>_counterparty_wave1_address_book/migration.sql`

**Interfaces:**
- Produces: 上表 7 个新列（名字、默认值照「目标终态速查」）；后续所有任务按这些列名消费。

- [ ] **Step 1: schema 加 7 列**（放 `ownershipDeclaredAt`/`ownershipProofType` 附近，注释一行 2×2 语义；`@@unique`/索引不动）
- [ ] **Step 2: 生成迁移**：`npx prisma migrate dev --name counterparty_wave1_address_book`（SQLite 对 NOT NULL 新列要求默认值——`ownerType`/`hostingMismatch` 已给 default，其余可空，ALTER ADD COLUMN 即可；不写任何 backfill）
- [ ] **Step 3: 验证空库能建**：`bash scripts/stack.sh reset self` 走通（或最小化 `rm 临时库 && npx prisma migrate deploy`）
- [ ] **Step 4: 随手闸 ①**：`npx tsc --noEmit -p tsconfig.json` 过
- [ ] **Step 5: Commit** `feat(address-book): schema — ownerType/declaredHosting/screening/ownership columns`

### Task 2: 迁移表扩边（7 态 9 边 7 动作）

**Files:**
- Modify: `src/modules/asset-treasury/withdrawal-addresses/constants/withdrawal-address-transitions.constant.ts`
- Test: `constants/withdrawal-address-transitions.constant.spec.ts`

**Interfaces:**
- Produces: `WithdrawalAddressAction.RELEASE`、`WithdrawalAddressAction.REJECT`；迁移表照「目标终态速查」终形；`assertWithdrawalAddressTransition` 签名不变。

- [ ] **Step 1: 写失败测试**——新增断言：`PENDING_VERIFICATION+RELEASE→PENDING_ACTIVATION`、`PENDING_VERIFICATION+REJECT→REJECTED`、`PENDING_VERIFICATION+CANCEL→CANCELLED`、`PENDING_ACTIVATION+REJECT→REJECTED`、`ACTIVE+REJECT` 抛 ConflictException、`REJECTED` 任意动作抛、**边数恰为 9**（展开计数，防多加少加）
- [ ] **Step 2: 跑测试确认红**：`npx jest src/modules/asset-treasury/withdrawal-addresses/constants`（⚠️勿加 `-t transitions`——spec 名不含该词，过滤后 8 测全跳过、exit 0 假绿，2026-10-22 执行中实证）
- [ ] **Step 3: 实现**（枚举 +2、表 +2 态 +4 边，注释标 2026-10-22 波一）
- [ ] **Step 4: 跑测试确认绿**
- [ ] **Step 5: Commit** `feat(address-book): state machine — PENDING_VERIFICATION/REJECTED, RELEASE/REJECT edges`

### Task 3: 主体层——登记落点、上限计数、release/reject/筛查/签名/updateDetails 收窄

**Files:**
- Modify: `withdrawal-address.service.ts`
- Test: `withdrawal-address.service.spec.ts`（沿既有 prismaMock 模式；判例在案——mock 断言必须核 `create/update` 实参的 data/where，不许只断返回值）

**Interfaces:**
- Consumes: Task 2 的 `RELEASE`/`REJECT`。
- Produces（workflow/controller 按此调）:
  - `CreateAddressData` 增 `ownerType: 'SELF'|'THIRD_PARTY'`、`declaredHosting: 'SELF_CUSTODY'|'VASP'`、`beneficiaryRelationship?: string`、`hostingMismatch: boolean`、`screeningAnswer: 'GREEN'|'YELLOW'|'RED'`（归因交叉与筛查结论都由 workflow 调 adapter 算好传入），**删** `ownershipProofType`/`ownershipDeclaredAt` 入参（主体层按 2×2 自算证据档与落点 status/activatesAt/screenedAt；**RED → 落点 `REJECTED`，优先级高于一切，含首法币**）
  - `CreateBankAccountData` 增 `ownerType`、`beneficiaryRelationship?`、`screeningAnswer`，同样删 proofType 入参
  - `releaseToCooling(addressNo, tx?)`：RELEASE 边 + **重算 `activatesAt = now+24h`**（冷却自 release 起算）
  - `rejectByScreening(addressNo, tx?)`：REJECT 边 + `screeningAnswer:'RED'`/`screenedAt`
  - `recordScreening(addressNo, answer: 'GREEN'|'YELLOW')`：status ∉ 两 pending 态 → 409 `ADDRESS_NOT_PENDING`；只写字段不迁移
  - `verifyOwnershipSignature(addressNo, customerId)`：守卫（本人 / status=PENDING_VERIFICATION / proofType=SIGNATURE / 未验证过，违者 409 `SIGNATURE_NOT_APPLICABLE`）→ 写 `ownershipVerifiedAt` → 调 `releaseToCooling`，返回更新行
  - `updateDetails` 收窄为 `{ label?: string }`（beneficiaryName 从 patch 类型里删除）
  - `MAX_ADDRESSES_PER_NETWORK` 计数 status 集合扩为 `['PENDING_VERIFICATION','PENDING_ACTIVATION','ACTIVE']`（crypto 与 bank 两处同改——第 5 条纪律：改前搜 `PENDING_ACTIVATION', 'ACTIVE'` 拿全清单）

- [ ] **Step 1: 写失败测试——2×2 落点**：四个 case 断言 create 实参里的 `status`/`ownershipProofType`/`screeningAnswer`（SELF_CUSTODY×SELF→PENDING_VERIFICATION+SIGNATURE；VASP×SELF→PENDING_ACTIVATION+DECLARATION；×THIRD_PARTY→PENDING_ACTIVATION+ATTESTATION；screeningAnswer 原样透传）
- [ ] **Step 2: 写失败测试——首法币回归**：`createBankAccount` ownerType SELF + GREEN 首条 → create 实参 `status:'ACTIVE'`、`activatedAt` 非空（第二幕回归点的单元级钉子）；第二条 → PENDING_ACTIVATION
- [ ] **Step 2b: 写失败测试——RED 登记即拒且压过首法币**：crypto 传 `screeningAnswer:'RED'` → create 实参 `status:'REJECTED'`、`activatedAt` 空；bank 首条传 RED → 同样 `REJECTED` 不是 ACTIVE（Review Focus 6）
- [ ] **Step 3: 写失败测试——第三方银行**：ownerType THIRD_PARTY → `ownershipProofType:'ATTESTATION'`、`beneficiaryRelationship` 入库
- [ ] **Step 4: 写失败测试——上限计数含新态**：count 被调用时 where.status.in 恰为三值集合
- [ ] **Step 5: 写失败测试——release 重算冷却**：`releaseToCooling` 对 PENDING_VERIFICATION 行，update 实参 `status:'PENDING_ACTIVATION'` 且 `activatesAt` ≈ now+24h；对 ACTIVE 行抛 409
- [ ] **Step 6: 写失败测试——reject/recordScreening/verify 守卫**：`rejectByScreening` 两 pending 态都通、ACTIVE 409；`recordScreening` 非 pending 409；`verifyOwnershipSignature` 非本人 Forbidden、非 SIGNATURE 档 409
- [ ] **Step 7: 写失败测试——updateDetails 只收 label**：patch 带 beneficiaryName 不再落库（类型收窄后编译即拒，测试断 label-only 更新 + 终态不可改保留）
- [ ] **Step 8: 跑测试确认红** → **Step 9: 实现** → **Step 10: 跑绿**：`npx jest src/modules/asset-treasury/withdrawal-addresses`
- [ ] **Step 11: Commit** `feat(address-book): service — 2x2 landing, screening fields, release/reject/verify`

### Task 4: 编排层——登记改造 + 签名验证 + ⚡筛查喂 + 5 个审计写点

**Files:**
- Modify: `withdrawal-address-workflow.service.ts`、`dto/create-withdrawal-address.dto.ts`、`dto/create-bank-account.dto.ts`、`dto/update-withdrawal-address.dto.ts`
- Test: `withdrawal-address-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 3 全部新方法。
- Produces（controller 按此调）:
  - `TravelRuleAdapter` 接口增 `screenAddress(address: string, network: string): Promise<'GREEN'|'YELLOW'|'RED'>`；`MockTravelRuleAdapter` 实现确定性尾号规则（`2222`→YELLOW、`3333`→RED、默认 GREEN——与归因同文件同 DI token，mock 登记册的同一个刀口）
  - `registerAddress` / `registerBankAccount`：DTO 新字段透传；登记时调 `screenAddress`（bank 用 cleanIban）；crypto 路径算 `hostingMismatch = declaredHosting !== (attribution.attributed?'VASP':'SELF_CUSTODY')`——**红旗留痕不拦截**；审计编排：`REGISTERED`（afterData 增 ownerType/declaredHosting/screeningAnswer/hostingMismatch）＋ THIRD_PARTY 时加记 `WITHDRAWAL_ADDRESS_THIRD_PARTY_DECLARED`（afterData={beneficiaryName,beneficiaryRelationship,addressNo}，客户主体）＋ mismatch 时 `recordSystem` `WITHDRAWAL_ADDRESS_HOSTING_MISMATCH_FLAGGED`（afterData={declaredHosting,attributedType,counterpartyVaspName}）＋ 落点 REJECTED（RED）时 `recordSystem` `WITHDRAWAL_ADDRESS_REJECTED`（reason 固定文案，见速查表）
  - `verifyOwnershipSignature(addressNo, customerId, customerNo)`：调主体层 → 记 `WITHDRAWAL_ADDRESS_OWNERSHIP_VERIFIED`（客户主体，fromStatus `PENDING_VERIFICATION` / toStatus `PENDING_ACTIVATION`，correlationId=existing.traceId）
  - `feedScreening(addressNo, actor: {userId,userNo,role}, answer, reason)`：reason 必填；GREEN/YELLOW → `recordScreening` + 记 `WITHDRAWAL_ADDRESS_SCREENED`（operator，afterData={answer}）；RED → `rejectByScreening` + 记 `WITHDRAWAL_ADDRESS_REJECTED`（operator，reason、fromStatus/toStatus）
  - DTO：`CreateWithdrawalAddressDto` 增 `ownerType!`（IsIn）、`declaredHosting!`（IsIn）、`beneficiaryRelationship?`（`@ValidateIf(ownerType==='THIRD_PARTY')` 必填，连带 beneficiaryName 同条件必填）；`CreateBankAccountDto` 增 `ownerType!`、`beneficiaryRelationship?`（同条件）；`UpdateWithdrawalAddressDto` **删 beneficiaryName**
  - 每个新审计写点**带显式 `requestId`**（`<ACTION>_<addressNo>_<uuid>` 式样，沿本文件既有写法——漏了会被静默去重，交付清单第一行）

- [ ] **Step 1: 写失败测试**：①第三方 crypto 登记 → audit 被调 2 次（REGISTERED + THIRD_PARTY_DECLARED）且 actor 是客户；②尾号 1111 地址 + 自报 SELF_CUSTODY → create 实参 `hostingMismatch:true` 且 `recordSystem` 记 MISMATCH 码、登记**不被拦**；③feedScreening RED → rejectByScreening 被调 + REJECTED 审计带 reason；④feedScreening GREEN → recordScreening + SCREENED 审计；⑤verifyOwnershipSignature → OWNERSHIP_VERIFIED 审计 fromStatus/toStatus 正确；⑥尾号 2222 → screenAddress 出 YELLOW 且透传到 create 实参；⑦尾号 3333 → 落点 REJECTED + REGISTERED/REJECTED 双审计（后者 recordSystem）
- [ ] **Step 2: 跑红** → **Step 3: 实现** → **Step 4: 跑绿**
- [ ] **Step 5: 补迁移守卫测试**：feedScreening RED 打 ACTIVE 行 → 409 冒泡且不写 REJECTED 审计（Review Focus 4）
- [ ] **Step 6: Commit** `feat(address-book): workflow — third-party declaration, mismatch flag, screening feed, signature verify`

### Task 5: 控制器 + RBAC 登记

**Files:**
- Modify: `withdrawal-address.controller.ts`（client）、`withdrawal-address-admin.controller.ts`、`src/modules/identity/access-control/rbac.catalog.ts:758-772`
- Test: 并入 Task 4 spec（controller 薄层，直调 workflow；不单测 controller，沿模块现状）

**Interfaces:**
- Produces: 「目标终态速查」两个新端点；rbac 新 `route('POST','/admin/withdrawal-addresses/:addressNo/simulate-screening','Feed a simulated address screening verdict (demo only)',['DEMO_VERDICT_WRITE'])`（放既有 Withdrawal Addresses 区块内）。

- [ ] **Step 1: client 控制器加 `POST ':addressNo/verify-signature'`**（extractCustomer → workflow.verifyOwnershipSignature）
- [ ] **Step 2: admin 控制器加 `POST ':addressNo/simulate-screening'`**（extractAdmin → workflow.feedScreening；body answer+reason 缺一 400）
- [ ] **Step 3: rbac.catalog 登记该 admin 路由**（挂 `DEMO_VERDICT_WRITE`，零新组——合规官同时持 `WITHDRAWAL_ADDRESS_READ`，看得到页面也点得动，与喂裁决同位）
- [ ] **Step 4: 随手闸 ① + 模块 jest 全绿**；记住收尾合并后 `npm run db:base:sync` + 重启后端（交付清单「新增 admin 端点」行）
- [ ] **Step 5: Commit** `feat(address-book): verify-signature + simulate-screening endpoints, rbac route`

### Task 6: 审计名册五处登记（判例：一处别漏 exporter）

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（V1_AUDIT_ACTIONS CONFIG 段 WITHDRAWAL_ADDRESS 块旁）
- Modify: `doc-final/lark/2026-09-15-audit-actions-catalog-by-domain-workflow.md`（CONFIG 域节加 5 行人写说明——此文件是 audit:vocab 的种子，属机器名册例外，不受「lark/ 不读」限制）
- Regenerate: `doc-final/lark/2026-09-16-audit-actions-catalog-full.md`（跑出来的，不手改）

**Interfaces:**
- Consumes: Task 4 落的 5 个码。
- Produces: 审计现役码 343→348（`audit:vocab` 机器数为准）。

- [ ] **Step 1: 常量加 5 条 spec**（四属性照「目标终态速查」表，出生即冻结；注释一行标对手方波一与触发者）
- [ ] **Step 2: 跑 `npx jest src/modules/audit-logging`**（assertActionSpec/常量 spec 全绿）
- [ ] **Step 3: 种子词表加 5 行说明** → `npm run audit:vocab`——**fail-fast 即名册没对齐**，必须跑到 exit 0 且 full 版 diff 里恰好 +5 行
- [ ] **Step 4: 核对数字判据**：现役码总数 348（以 vocab 输出计数为准，不手数）
- [ ] **Step 5: Commit** `feat(address-book): 5 audit actions registered (constant + vocab catalog)`

### Task 7: client-web——登记表单 / 列表详情 / 签名按钮 / 编辑收窄

**Files:**
- Modify: `client-web/src/pages/WithdrawalAddresses.tsx`
- Test: 构建 `cd client-web && npx tsc -b --noEmit` + `npm run test:client`（若该页无既有 vitest 用例则不新建——本仓 React 组件单测不可行判例在案，验收靠 Task 11 截图）

**Interfaces:**
- Consumes: Task 5 两端点、DTO 新字段。
- Produces: 演示者在客户端能走通五拍里的客户侧动作。

- [ ] **Step 1: crypto 表单**：加「Beneficiary」单选（Myself / Third party，默认 Myself；选 Third party 展开 beneficiaryName+relationship 两必填框）＋「Wallet hosting」单选（Self-custody wallet / Hosted by an exchange (VASP)，必选）；声明 checkbox 保留，第三方时文案换申报语义（具体文案 builder 定）
- [ ] **Step 2: bank 表单**：加同款 Beneficiary 单选（第三方时 relationship 必填；beneficiaryName 本就必填）
- [ ] **Step 3: 列表/详情**：`statusLabel`/`statusColor` 补 `PENDING_VERIFICATION`（"Pending verification"）与 `REJECTED`（"Not approved"——**客户面不露筛查内情**，tipping-off 白名单对齐：详情不渲染 screeningAnswer/内部 reason）；登记即拒（尾号 3333）提交成功后列表即显 "Not approved"，表单不报错——拒的是地址不是请求；第三方条目徽标 + 受益人姓名/关系展示；PENDING_VERIFICATION 条目可 Cancel（复用既有取消弹窗）
- [ ] **Step 4: 签名验证按钮**：`SELF_CUSTODY×SELF` 且 status=PENDING_VERIFICATION 且未验证 → 详情显示「Verify wallet signature」按钮，点击打 verify-signature，成功后刷新列表（mock 即点即过，入冷却倒计时）
- [ ] **Step 5: 编辑收窄**：编辑弹窗删 beneficiary 输入框（`editBeneficiary` 状态与请求体一并清——孤儿要清）
- [ ] **Step 6: 过随手闸 ③** + `npm run test:client`
- [ ] **Step 7: Commit** `feat(client): address book — beneficiary/hosting declaration, verification states, signature verify`

### Task 8: admin-web——详情新区块 / ⚡筛查三按钮 / 列表列

**Files:**
- Modify: `admin-web/src/pages/WithdrawalAddressDetail.tsx`、`WithdrawalAddressList.tsx`、`admin-web/src/rbac/permissions.ts`、`admin-web/src/components/ui/AdminBadge.tsx`（共享状态色映射加 `PENDING_VERIFICATION: 'pending'`；`REJECTED` 已有映射不动）
- Test: `cd admin-web && npx tsc -b --noEmit`（验收靠 Task 11 截图）

**Interfaces:**
- Consumes: Task 5 simulate-screening 端点、新字段。
- Produces: 管理台看得到归因/红旗/受益人/筛查/证据档，⚡能喂三色。

- [ ] **Step 1: permissions.ts 加键** `WITHDRAWAL_ADDRESS_SIMULATE_SCREENING: 'api.post.admin_withdrawal_addresses_addressno_simulate_screening'`
- [ ] **Step 2: 详情新区块**：①Attribution（addressType、counterpartyVaspName/Did）；②Self-declaration & red flag（declaredHosting、`hostingMismatch` 为真时醒目警示条）；③Beneficiary（ownerType、姓名、关系、proofType、ownershipDeclaredAt/VerifiedAt）；④Screening（screeningAnswer 色徽 + screenedAt）；status 徽标补两新态
- [ ] **Step 3: ⚡ Screening Simulation 区**：三按钮 GREEN/YELLOW/RED + 必填 reason 弹窗，仅 `hasAnyPermission([WITHDRAWAL_ADDRESS_SIMULATE_SCREENING])` 且 status ∈ 两 pending 态时渲染（沿本页 Manual Simulation 既有样式）；RED 成功后状态翻 REJECTED
- [ ] **Step 4: 列表加 Owner 列**（SELF/THIRD_PARTY 徽标）+ status 筛选下拉补两新态
- [ ] **Step 5: 过随手闸 ②**
- [ ] **Step 6: Commit** `feat(admin): address book — attribution/red-flag/beneficiary/screening blocks, simulate-screening`

### Task 9: 种子与脚本同款改齐（改一处之前先找齐同款——本任务就是那张清单）

**Files:**
- Modify: `scripts/demo-lib.ts:355-410`（既有两处 upsert + 新增三条样本）
- Modify: `scripts/verify-demo-data.ts:251-268`（R5 判别式）
- Modify: `scripts/verify-act1.ts:152,552-562`（API 调用方补必填字段）

**Interfaces:**
- Consumes: Task 1 列、Task 4 DTO。
- Produces: 「目标终态速查」种子终盘 11 条；R5 判别式 = `traceId: { startsWith: 'demo-setup-withdrawal-address' }`。

- [ ] **Step 1: demo-lib 既有两处 upsert 补新字段**（照种子终盘表 #1–8；`ownershipProofType` 从 `DEMO_FIXTURE` 改真值——**改完全仓 grep `DEMO_FIXTURE` 必须归零**，预期终态数 0）
- [ ] **Step 2: 新增三条样本 #9–11**（grace/kate/jack，字段照表；traceId 用既有前缀；各配 `writeSeedAudit` `WITHDRAWAL_ADDRESS_SEEDED`；upsert 幂等键沿 `customerId_network_address`）
- [ ] **Step 3: verify-demo-data R5 判别式换 traceId 前缀**，注释同步改写；块注释里的实测值 8 改 11
- [ ] **Step 4: verify-act1 补字段**：`:152` bank 调用加 `ownerType:'SELF'`；`:552-562` 四处 crypto 调用加 `ownerType:'SELF', declaredHosting:'SELF_CUSTODY'`；逐条核该探针对返回 status 的断言——落点改为 `PENDING_VERIFICATION` 后按新语义修断言（V7 上限语义不变：第 4 条仍须 `ADDRESS_LIMIT_REACHED`）
- [ ] **Step 5: 随手闸 ①**（tsc 覆盖 scripts/）；`npx jest src/modules/asset-treasury/withdrawal-addresses` 回归
- [ ] **Step 6: Commit** `feat(address-book): seeds — 4-quadrant samples, R5 discriminator, verify:act1 callers`

### Task 10: 文档与剧本（含 mock 触点登记册——业主切换地图）

**Files:**
- Create: `doc-final/reference/sumsub-mock-touchpoints.md`
- Modify: `doc-final/demo/script.md`（站 5 账号行 + ④ 三拍→五拍）、`doc-final/demo/data.md:53`、`doc-final/modules/v3-financial-config.md`（§1/§2/§3/§5 + 头部 Last Verified）、`doc-final/modules/overview.md`（头部审计码 343→348 一句）、`doc-final/demo/simulated-externals.md`（Sumsub 行加指针）、总纲 `2026-10-22-counterparty-layer-charter.md` §5（加登记册链接一行）

**Interfaces:**
- Consumes: 全部前序任务的实际落点（写实际值，不写 plan 预估值）。

- [ ] **Step 1: 建 `sumsub-mock-touchpoints.md`**。表头：`触点 ｜ 代码位置 ｜ mock 行为 ｜ 真 Sumsub 对应物（含缺口清单编号）｜ 切换时的刀口`。首批四行：
  1. 地址归因 `attributeAddress`（`mock-travel-rule.adapter.ts`，尾号 1111→Mock VASP）→ 真=Standalone Wallet Attribution `POST /resources/api/wallet-attribution`（缺口 #1，403 未开通）→ 刀口=DI token `TRAVEL_RULE_ADAPTER` 换实现
  2. 地址风险筛查（确定性测试地址：`mock-travel-rule.adapter.ts#screenAddress` 尾号 2222→YELLOW / 3333→RED / 默认 GREEN；⚡覆写：`POST /admin/withdrawal-addresses/:addressNo/simulate-screening`）→ 真=payment method AML screening/Crystal（缺口 #3 触发条件待确认）→ 刀口=同一 DI token 换实现、登记写点改挂 webhook 回灌 + ⚡端点保留为演示后门
  3. 钱包签名验证（`POST /client/withdrawal-addresses/:addressNo/verify-signature` mock 即过）→ 真=crypto ownership verification（WebSDK 签名/Satoshi，缺口 #2 链支持未配）→ 刀口=client 按钮改拉 WebSDK、后端改收回调
  4. 既有总开关 `SUMSUB_MOCK_MODE` 与裁决 ⚡ 全家族 → 指回 `demo/simulated-externals.md`（本册只收对手方层触点）
  并写一行定位语：「业主将做 mock↔sandbox 切换，波二新增触点续登本册；本册只登记不实现，切换机制届时另立 spec」
- [ ] **Step 2: script.md 站 5**：账号行补 `compliance_lead@`（⚡筛查喂）；④ 改五拍——a/b/c 三拍原样保留（c 即第二幕回归拍），新增 d)「第三方申报登记」（alice 登记 TRON 第三方地址：姓名+关系 → ATTESTATION 即落定 → 冷却；切 `treasury@` 详情看受益人档）、e)「筛查+签名+红旗」（客户登记尾号 1111 地址自报 Self-custody → 管理台看 `hostingMismatch` 红旗 → 登记尾号 3333 测试地址 → **当场 REJECTED**（登记即拒，判据确定）→ 另登记一条真自托管停 PENDING_VERIFICATION → 客户端 Verify wallet signature → 入冷却 → `compliance_lead@` 对冷却中条目 ⚡ 喂 RED → REJECTED（覆写后门另演一手），指一眼 jack 的种子 REJECTED 展品）——具体文案 builder 定，看点四件（红旗/测试地址即拒/签名/⚡覆写拒）一个不许少
- [ ] **Step 3: data.md 地址簿种子段**改写为 11 条终盘（含三新样本人设与 REJECTED 展品）；另起「**mock 测试地址速查**」小节——完整可复制串逐行列出：尾号 1111/2222/3333 的 TRON 地址各一枚（`fakeTronAddress(seed).slice(0,30)+尾号`，须过 `^T[1-9A-HJ-NP-Za-km-z]{33}$`）+ 尾号 2222/3333 的合法 AE IBAN 各一枚（builder 预算 mod-97 并固化），每行写明确定性结局（归因/筛查/登记落点）——演示者照抄即得已知结果，这是本波验收的判据表
- [ ] **Step 4: modules/v3-financial-config.md**：§1 地址簿叙事段重写（受益人三档/托管自报/筛查/签名/两绿/封禁语义）、§2 迁移表行换 7 态 9 边、§3 加一行「⚡喂筛查 ｜ 合规官（DEMO_VERDICT_WRITE）｜ 直接执行必留痕」、§5 技术节点补新方法与端点、头部 Last Verified 更新
- [ ] **Step 5: overview.md 头部**审计码 343→348 一句（照既有「此前…」滚动格式）；simulated-externals.md Sumsub 行尾加「对手方层触点明细见 `reference/sumsub-mock-touchpoints.md`」；总纲 §5 加登记册一行
- [ ] **Step 6: Commit** `docs(address-book): script station-5 five beats, mock touchpoints register, module/overview sync`

### Task 11: 收尾闸与走查（本任务过哪几条，plan 写死在此）

**Files:** 证据落 `doc-final/superpowers/checkups/`（截图/命令输出摘录）

- [ ] **Step 1: 随手闸三件** + `npx jest src/modules/asset-treasury/withdrawal-addresses src/modules/audit-logging` + `npm run test:client` 全绿
- [ ] **Step 2: worktree 栈起 preview 走查截图**（永不豁免条①）：client 两式表单（本人/第三方两形态）、PENDING_VERIFICATION 与 REJECTED 列表态、**尾号 3333 测试地址登记即拒**、签名验证按钮前后；admin 列表 Owner 列、详情四新区块 + 红旗警示条 + ⚡三按钮、喂 RED 后 REJECTED；data.md 速查表逐行实走一遍（每枚测试地址的实际结局 = 表上写的结局，这就是验收）
- [ ] **Step 3: 第二幕回归单拍**（Review Focus 1）：现场注册新客 → 登记首个法币账户 → 断言**即时 ACTIVE** + 交易起始门解锁（客户端 TradingStartGuide 消失），单独截图留证
- [ ] **Step 4: 重铺闸**（动了 schema）：`bash scripts/stack.sh reset self` 从零重铺 → `bash scripts/on-stack.sh self demo:all` 全绿对 `demo/baseline.md`（判例：新 worktree 先 `npm ci`×2；demo:all 不接 tail 管道防吞码）；链内 verify:demo-data R5 实证 11 条非空
- [ ] **Step 5: `bash scripts/on-stack.sh self verify:act1`**（动了它的探针）与 `bash scripts/on-stack.sh self verify:rbac`（动了 rbac.catalog；判例：API_BASE 必须指本栈端口，严禁击中 main）
- [ ] **Step 6: 交付清单命中行逐条核**：持久状态变化留痕（5 新码写点）｜新增审计码四属性冻结｜新状态进迁移表+409（SLA：两新态**不计时**——PENDING_VERIFICATION 等客户签名、REJECTED 终态，无钟可挂，此处显式回答）｜新增 admin 端点 route()+db:base:sync+重启（合并 main 后）｜新业务动作前端有入口（签名按钮/⚡三按钮）｜新字段客户面裁决（REJECTED 不露内情）｜业务键（addressNo 贯穿）｜改 schema 有迁移、无 backfill｜改页面种子同步 data.md/script.md｜前端截图｜承接记录写进波二骨架（见 Step 7）｜收尾报告 `Documentation updated: modules§0-4 / demo / none…` + CHANGELOG 一行 + BACKLOG 核对（关联累计升格已登，无新增）
- [ ] **Step 7: 承接记录**写进 `2026-10-22-counterparty-wave2-skeleton.md`「承接上一波」节：实落字段名/枚举值、迁移表终形 7/9/7、5 码清单、种子 11 条与人设、剧本拍号、mock 触点登记册路径、执行偏差与判例
- [ ] **Step 8: Commit** `chore(address-book): wave1 closeout evidence`

---

## 不做（对照根纲 §2 + 总纲 §4，评审按此拒绝扩scope）

交易侧任何改动（判型/充值/提现单——波二）｜真实 Sumsub 调用与切换机制实现（只登记触点）｜LP 侧｜累计监视器｜`sumsubPaymentMethodId` 等预留字段｜REJECTED 复活通道｜地址簿审批链｜幂等/重试/并发锁等技术兜底

## Self-review 记录（写完即查）

- spec §2.1 七字段 → Task 1；§2.2 状态机与两绿 → Task 2/3；§2.3 2×2 → Task 3/4；§2.4 ⚡两面 → Task 5/7/8；§2.5 前端 → Task 7/8；§2.6 审计 → Task 4/6；§2.7 种子剧本 → Task 9/10；§4 验收 → Task 11；§5 留给 builder 的四项中「REJECTED 可否复活」已按默认定死（不可，见 Global Constraints），其余（枚举命名细部/组件拆分/metadata 形状/拍内文案）留给执行者。
- spec §2.2 标题"扩一态两边"与其正文不符（正文实为两态四边），以正文与本 plan 7/9/7 为准——评审时不要拿标题当判据。
- 类型一致性：`releaseToCooling`/`rejectByScreening`/`recordScreening`/`verifyOwnershipSignature`/`feedScreening` 五个名字在 Task 3/4/5/7/8 间已核对一致。
- 承接自用户的新要求（2026-10-22 会话）：mock 触点登记册是**本波交付物**（Task 10 Step 1），不是可选项。
- 业主 2026-10-22 补拍（已写回 spec §2.2/§2.7）：确定性测试地址是 mock 筛查的主通道，⚡降为覆写后门；"登记即拒"是落点计算不是边，RED 优先级压过首法币规则（Review Focus 6）。数字判据不受影响（码仍 5 个、边仍 9 条）。
