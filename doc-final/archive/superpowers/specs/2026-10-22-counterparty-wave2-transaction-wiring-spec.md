# 波二 · 交易接线 spec

> 总纲：`2026-10-22-counterparty-layer-charter.md`（裁定与不做清单以总纲 §2/§4 为准）｜承接记录：`2026-10-22-counterparty-wave2-skeleton.md`
> 脑暴收口：2026-10-22（六岔口业主逐个拍板）｜现状实查日期：2026-10-22（schema + 两域 workflow + 补料闭环 + 前端两端逐处核过）

## §0 本任务做 / 不做

**做**：KYT 判型一行化（resolver 删 `∧VASP ∧阈值`）、充值来源归因（⚡喂）与 VASP 展示区块、unhosted 超线认领（复用补料机制、二分支表单）、"已知来源"沉淀与同源免问、"对手方 VASP 不合格"裁决分支（充值退回 / 提现退款，均走既有弧）、提现建单带出受益人与 TR 报文快照、两端前端、审计码、测试串扩充、种子与剧本。

**不做**（对照根纲 §2 + 总纲 §4）：兑换域零触碰（站内 swap 本就 finance，不经 resolver）｜法币充值零归因零认领（unhosted 是 crypto 概念，波一已定 IBAN 无归因）｜VASP 名录页 / 尽调册实体（名录数据只住 mock 侧，管理台按单展示）｜关联累计升格（BACKLOG 在案）｜真实 Sumsub 集成与预留字段｜新挂起状态（见 §2.3——两种等待就是既有两个州）｜幂等 / 重试 / 并发锁等技术兜底。

## §1 现状（实查，别按旧文档想象）

- **充值的 VASP 标志是客户自报的**：`client-web/src/pages/Deposit.tsx:1197-1223` 模拟充值弹窗里"VASP / Unhosted wallet"两个按钮 → `inbound-transfer-signals.service.ts:166-168`（crypto 必填校验）→ 信号列 → `detected()` 落 `deposit.counterpartyIsVasp`（唯一写点，之后无人改）。**充值域从未调用过归因 adapter**（`grep attributeAddress src/modules/trading` 零命中）。
- 判型 `kyt-txn-type.resolver.ts`：四条件（crypto ∧ VASP ∧ 阈值配置 ∧ 金额≥阈值）；消费方仅 `deposit-workflow.service.ts:368` 与 `withdraw-workflow.service.ts:2487`，reason 只进审计 metadata `decisionReason`，**不进 L1 快照**（`l1-gate.types.ts:5` 注释明示刻意不进）。
- 归因 adapter 住 `asset-treasury/withdrawal-addresses/`（token `TRAVEL_RULE_ADAPTER`，module 未导出 token），唯一消费方是地址簿 workflow。
- 补料闭环现成：挂起 = `applyKytAwaitUser` → `issuer.register(materialType, orderDomain:'DEPOSIT', orderRef)` → outstanding 集非空 → `ACTION_PENDING`；回炉 = 客户 submit → review APPROVED → 广播 `MATERIAL_REQUEST_REVIEWED` → `onMaterialRequestReviewed` → `RESUME` 回 `COMPLIANCE_PENDING`（单上已有 `sumsubTxnId`，`submitSumsubTxns` 幂等跳过，等下一次裁决推进）。材料类型注册表 `config/material-refresh-policy.json`（5 型，均挂 Sumsub SDK level）；客户提交页 `MaterialVerification.tsx` 现在**一律**起 Sumsub SDK session。
- ⚡裁决 11 键共享表 `verdict-buttons.shared.ts`（三域同码同义）；V10 = 拒绝带 `RETURN_TO_SENDER` 标签 → 落 `MANUAL_CHECKING`（`earlyReturnTag`）→ 侧栏"Initiate Return to Sender" → MLRO 批 → `RETURNED`。提现镜像：`MANUAL_CHECKING` 可直接执行退款拒绝 → `REJECTED` 全额解锁。
- 提现建单只抄一个布尔：`withdraw-workflow.service.ts:305` `counterpartyIsVasp = addressType==='VASP'`；`beneficiaryName / counterpartyVaspName / ownerType / addressNo` 全没带出；客户详情页的 Address label 是按值反查的（无键链接）。
- 死物（只提不删，非本波造）：`DepositTransaction.counterpartyVasp`（零写点）、`sumsubActionId`（零引用）。前者本波复活（§2.2），后者不动。
- 两域状态机 29 边 / 23 边各有守则单测锁边数；通知模板 `DEPOSIT_ACTION_PENDING` / `WITHDRAW_*` 已够用。

## §2 目标终态

### 2.1 判型一行化（总纲裁定 ①）

`resolveKytTxnType`：crypto → `travelRule`，其余 → `finance`。输入剩 `assetType`；reason 收敛为 `NOT_CRYPTO | TR_REQUIRED`（`COUNTERPARTY_NOT_VASP / BELOW_TR_THRESHOLD / NO_TR_THRESHOLD_CONFIGURED` 三码退场）。`TR_THRESHOLD_BY_CURRENCY`（USDT 1000 / AED 3500）**原样搬家**进 mock TR 规则（§2.3）——阈值语义归 Sumsub 配置，mock 同口径（总纲 §5 三引文）。`SINGLE_TXN_SUBMIT_ENABLED` 开关行为不变（关 = 一律 finance）。

**自报链拆除**（我的裁定）：归因真相源改为 mock Sumsub（§2.2），客户自报 hosted/unhosted 失去业务位置——Deposit.tsx 两按钮、DTO 必填校验（:166-171）、信号列 `counterpartyIsVasp`、`detected()` 同名入参整链拆除（调用方 `demo-lib.ts` / `verify-act1.ts:506` 同步）。`DepositTransaction.counterpartyIsVasp` 列保留，改由归因写入（见下）。按项目 §3：schema 改动直奔终态，reset 重铺，零 backfill。

### 2.2 充值来源归因与 VASP 区块

- **归因 = ⚡喂**（岔口拍板：挂充值单详情既有模拟面板同侧、同 `DEMO_VERDICT_WRITE` 门控；新 demo 端点进 rbac.catalog，判例三件套）。仅 `COMPLIANCE_PENDING` 态可喂，三个出口：
  1. **VASP（合格样本）**：Mock VASP Exchange（did:mock:vasp-exchange-001）；
  2. **VASP（不合格样本）**：新 mock 名录第二条 Grey Harbor Exchange（EEC 未完成 / 评分 42 / unlicensed——数值 builder 定，须踩政策口径红线）；
  3. **Unhosted**：触发 §2.3 认领判定。
- 落单列：`counterpartyIsVasp`（托管事实快照）、`counterpartyVasp`（VASP 名，复活既有死列）、新列 `counterpartyVaspDid?`、`sourceAttributedAt?`。
- **名录档案展示层拼装，不落单**（§1 分工的直接推论——Sumsub 数据住 Sumsub 侧）：adapter 新方法 `getVaspProfile(did)` 返回 `{eecStatus, riskScore, licensed}`，admin 详情读接口按单上 did 现取现拼；mock 名录就两条。
- **adapter 迁址**（我的裁定）：`mock-travel-rule.adapter.ts` + 接口 + token 从 `asset-treasury/withdrawal-addresses/` 迁 `sumsub-shared/`（两域共用的 Sumsub 侧 mock，与 verdict-buttons 共享表同性质），地址簿模块改引、行为零变化。触点登记册续登（归因⚡ / 名录 profile / TR 阈值规则 / 认领解锁四触点，各写真身与切换刀口）。
- **admin VASP/来源区块**（充值详情新区块）：归因结果（VASP 名 + did / Unhosted）、托管快照、名录档案三行（EEC / 评分 / licensed）、政策口径一行静态文案、认领状态与快照、已知来源命中回链。**客户面白名单只放**：对手方名称、认领状态、客户自己的申报快照；评分 / EEC / 风险标 / 筛查类永不出客户面（`SENSITIVE_KEYS` 守卫同步改——`counterpartyVasp` 从敏感集移入白名单，波一判例口径）。

### 2.3 unhosted 认领（复用补料，二分支）

- **判定**（mock TR 规则，站 Sumsub 一侧）：⚡喂 Unhosted 时——`travelRule` 型 ∧ 金额 ≥ 该币种阈值（搬家表）∧ 非已知来源（§2.4）→ 下发认领；否则只记归因、照常等裁决（≤3,500 AED 等值免认领 = 总纲裁定 ⑤；姓名缺失在线下为合法缺席，不硬凑）。
- **挂起**：材料类型注册表加第 6 型 `SOURCE_OWNERSHIP_CLAIM`（无 Sumsub level，带 formKind 标记），经既有 `issuer.register`（orderRef = depositNo，origin `SUMSUB_PUSHED`，restrict:false）+ 既有 `applyKytAwaitUser` 机制落 `ACTION_PENDING`——**零新态零新边**，通知复用 `DEPOSIT_ACTION_PENDING` 模板。
- **客户认领表单**（业主拍板·岔口一）：`MaterialVerification.tsx` 按 formKind 分叉，认领型渲染我方表单（不起 SDK session），二选一：
  - **甲"这是我自己的钱包"**：点"签名验证"，mock 即点即过（与波一地址簿签名同观感语言）；
  - **乙"别人转给我的"**：个人 → 姓名 + 关系（同波一第三方申报形状）；交易所 → VASP 名称。
- **提交即回炉**（总纲裁定 ③）：提交落认领快照（充值单新列：`sourceClaimType?`（SELF/THIRD_PARTY_PERSON/THIRD_PARTY_VASP）、`sourceClaimName?`、`sourceClaimRelationship?`、`sourceClaimedAt?`）→ 材料单 SUBMITTED → mock 侧**即时 applyReview(APPROVED)**（项目允许假设：mock 总是准时回调且只回一次；真身 = `POST /kyt/txns/{id}/travelRuleOwnership` 解锁）→ 既有广播与 `RESUME` 回炉链路原样走。⚡三键（GREEN/RETRY/FINAL）仍是覆写后门。

### 2.4 "已知来源"沉淀（业主拍板·岔口二修正版）

- **载体 = 充值单上的认领快照 + mock 规则查询，零新表**：判"已知" = 同客户 × 同 `fromAddress` 存在认领已通过的在册充值单。沉淀的记忆语义住 Sumsub 侧（真身 = applicant 名下已验证收付方式/WAB），mock 以查询代存储——登记触点册。
- **我方屏幕只留对照时刻**：第二笔同源免认领，区块一行"来源已于 DP-xxx 认领"（回链业务键）；**不建任何"已知来源"清单页**（管理台、客户端都不建）——清单时刻归第二块演示屏（业主开 Sumsub 真后台）。
- 对照演法前提：模拟充值弹窗加**可选 From address 输入**（默认仍随机生成）——同源二笔才演得出来。

### 2.5 提现接线

- **建单带出**（锚点 `withdraw-workflow.service.ts:296-325`）：从 `registeredAddress` 抄 `addressNo`（业务键链接，铁律⑥——客户详情页 Address label 改走键回链，弃按值反查）、`beneficiaryName`、`ownerType`、`counterpartyVaspName/Did`，落提现单同名新列；法币路径同抄（受益人银行账户同样有 ownerType/beneficiaryName）。
- **TR 报文快照**（travelRule 型即每笔链上提现；状态口径为 builder check 唯一岔口，业主 2026-10-22 拍甲案"分档如实"）：提交 KYT 时一次性写 `travelRuleSnapshotJson?`（受益人姓名、ownerType、对手方 VASP、报文状态），状态**三档如实**（提现工作流消费 mock TR 规则服务按搬家阈值表判）：低于阈值 → `NOT_APPLICABLE`（"低于阈值，照常报送"——总纲 §5 引文口径）｜ ≥阈值 ∧ 对手方 VASP → `EXCHANGED`（受益人随报文）｜ 自托管 → `SELF_HOSTED_NO_EXCHANGE`（"无报文交换·所有权登记时已验证"，回链地址簿所有权证据）。单据即快照，只写一次；花名册 alice/bob 50 USDT 自托管展品由此如实显示 Not Applicable——正好教阈值规则，不与充值侧口径相撞。
- **展示**（业主拍板·岔口三）：admin 提现详情新"Counterparty / Travel Rule"区块（受益人、ownerType、VASP 名 + 名录档案现拼、TR 报文状态）；**时间线不加新事件**。客户面：受益人姓名、Address label（键回链）可见；TR 报文状态、名录档案不出客户面。

### 2.6 "对手方 VASP 不合格"裁决分支（两域同款）

- ⚡共享表加第 12 键 `V12_VASP_UNQUALIFIED`（充值 / 提现 fixtures 暴露，兑换不暴露——站内无外部对手方，语义性缺席非漂移）。形状同制裁命中：⚡喂进来的 Sumsub 侧裁决。
- **充值出口 = 原路退回**（业主拍板·岔口拍"直接原路退回"）：复用 V10 落点机制——落 `MANUAL_CHECKING`（distinct tag `VASP_UNQUALIFIED`，区块亮不合格依据）→ 运营"Initiate Return to Sender" → MLRO 批 → `RETURNED`。**我的裁定（口径说明）**："直接"落实为*剧本直奔退回、不开复核决策戏*；机制上复核站只是退回弧的既有出发台（退回入口仅复核/挂起两处，运营提 + MLRO 批的 maker-checker 不可绕——铁律②）。不新增"裁决直落退回"边。
- **提现出口 = 退款拒绝**（镜像）：落 `MANUAL_CHECKING` 同款 → 运营执行退款（该态可直接执行，既有）→ `REJECTED` 全额解锁——"拒绝即解锁"不变量照旧。
- 两域**零新状态零新边零新审批类型**；剧本只演充值侧拒绝一单（同一处置不铺两遍画面——种子按处置铺原则），提现侧演受益人与 TR 区块即可（我的裁定）。

### 2.7 测试串与 ⚡ 控制面汇总

| 串 | 结局 | 波次 |
|---|---|---|
| 尾号 1111 | 归因 VASP：Mock VASP Exchange（合格） | 波一（沿用） |
| 尾号 2222 / 3333 | 筛查 YELLOW / RED | 波一（沿用） |
| **尾号 4444（新）** | 归因 VASP：Grey Harbor Exchange（不合格样本） | 波二——供地址簿登记 → 提现 VASP 区块亮差档案 |
| 其余 | 归因 Unhosted / 筛查 GREEN | 沿用 |

充值侧归因不依赖尾号（fromAddress 随机生成），⚡三键显式喂；`demo/data.md` 速查表续表。新 ⚡ 端点：喂归因（充值）一个，挂 `DEMO_VERDICT_WRITE`；V12 走既有 run-verdict 通道。**零新权限桶 / 组**（同波一）。

### 2.8 审计

新码约 4 个（命名 builder 定，名册三点齐判例在案、exporter 别漏）：归因落单（⚡ operator）、认领提交（客户主体，申报快照进 metadata）、已知来源命中免认领（recordSystem）、TR 报文快照落单（system）。V12 裁决与退回/退款弧走既有码（verdict 落地与处置弧审计齐全）；认领挂起复用 `DEPOSIT_ACTION_REQUIRED`。

### 2.9 种子与剧本

- 种子（计数 plan 钉）：充值花名册加三展品——认领挂起中一单、认领通过 + 同源免问对照一对（需固定 fromAddress）、VASP 不合格已退回一单；提现侧一条打到 4444 地址的单（或种子地址 + 现场建单，plan 定）。⚠️ 判例：`demo-lib.ts` 建单路径同步新字段，否则全新树必炸。
- 剧本：第三幕插认领站（两分支两单）+ VASP 不合格退回站（可并入 3.5 退回站讲）；第五幕 5.1 扩一拍看受益人 / TR 区块;第二块屏提示词（开 Sumsub 名录）写进台词。`demo/data.md` 花名册与速查表同步。
- 文档收口：政策口径一行进 `modules/v4-deposit.md` / `v5-withdraw.md`（总纲三薄件之三）；v5 §6"VASP 归因靠客户自报"行已过时，随波订正；触点登记册四触点续登。

## §3 铁律对照

状态只沿边（**两域零新态零新边**，29/23 守则单测数字不变——本波最硬的回归判据）｜门不可绕（退回 / 退款弧 maker-checker 原样；认领不是审批是客户补料）｜钱动必过账（复用既有退回 / 退款记账，零新分录型）｜操作必留痕（§2.8 四码 + 既有码）｜各管各的（充值域消费 sumsub-shared 的 mock，不写地址簿；提现建单读地址簿经既有服务路径）｜对外业务键（addressNo 回链上单、DP-xxx 回链认领来源）。

## §4 验收口径

- 走查三幕（charter §3 验收口径）：① 充值 unhosted 认领——⚡Unhosted → 挂起 → 客户端二分支表单（两单各走一支）→ 提交回炉 → ⚡Approved 入账;同源第二笔免问对照;② VASP 不合格——⚡归因(Grey Harbor) → 区块亮差档案 → ⚡V12 → 退回弧到 `RETURNED`;③ 提现详情受益人 + TR 区块——三档状态各见一单（花名册低于线自托管单 / 4444 或 1111 VASP 过线单 / 过线自托管单，取材 plan 定）。前端改动必 preview 渲染 + 截图。
- 闸：随手闸三件 + jest 本任务目录（**禁 `-t` 过滤**，判例在案）+ client-web vitest;动 schema → 收尾重铺闸 `stack.sh reset` + `demo:all` 全绿对 baseline（verify:demo-data 在刚铺完的干净库跑，判例在案）。
- 数字判据（plan 钉死预期终态数，改完复核）：两域迁移表边数 29/23 不变｜resolver spec 用例 9 → N（重写后）｜受冲击断言清单逐条翻面：`deposit-workflow.service.spec.ts:775`（non-VASP 翻 travelRule）/`:754/:807/:867`、`test/deposit-sumsub-verdicts.e2e-spec.ts:561-586`（non-VASP 用例翻面）、`withdraw-workflow.service.spec.ts:833-862`｜审计现役 348 → N｜通知模板 19 不变｜权限 15 域 83 桶 92 组不变｜⚡共享表 11 → 12 键。

## §5 留给 builder

新列具体命名与迁移文件｜mock TR 规则服务落点（sumsub-shared 内）与 Grey Harbor 档案数值｜认领表单组件拆分与校验文案｜formKind 标记在注册表里的形状｜V12 的 tag 常量与两域 fixtures 接线｜审计 metadata 形状｜剧本站点编号与台词｜提现 4444 展品走种子还是现场建单。
