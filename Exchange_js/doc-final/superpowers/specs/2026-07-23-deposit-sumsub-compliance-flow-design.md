# 充值合规 · Sumsub 集成与状态机驱动 设计 spec

> **主题**：充值（Deposit）合规审查用 Sumsub 替代现有 mock KYT/TR。定义 **Sumsub 接口调用 → webhook 返回 → 驱动充值状态机 → 状态机流转** 的完整闭环。
> **日期**：2026-07-23　**状态**：设计（未实现）　**范围**：仅充值域；仅个人客户（无公司/KYB）。
> **配套图**：充值单 Lark PRD 附录 B（状态机流转画板）、附录 C（调用与 webhook 判断流程画板）。

## 0. 置信度标注约定

全文每条结论标注来源：
- ✅ **实测**：本轮在 Sumsub sandbox（app token `sbx:KIX2Yi5TG5jf8L7zAjpyhsjl`）真实调用/回读验证。
- 📄 **文档**：Sumsub 官方文档 / VARA·EOCN 原文，未在沙盒实证。
- 🟡 **推断**：基于实测+文档的设计推导，落地前需再核。

沙盒能力边界（诚实前置）：**对手方 AML 筛查在沙盒不认 magic name，永返 GREEN**（✅ 实测两次）；**制裁 RED 只能对 applicant 出、且需后台手动 Request check**（✅ 实测，API recheck 不出红）。故"对手方制裁 RED + 真实 amlCaseRejected"未在沙盒端到端跑通；RED 结构以 applicant 侧真实 case（`6a5dfc9a`）为准。

---

## 1. 分工：Sumsub 做什么，我系统做什么

| 环节 | 谁做 | 说明 |
|---|---|---|
| TR 报文收发、地址簿匹配、VASP 目录查询、对手方筛查、链上分析 | **Sumsub** | 协议层机械动作，我不实现（📄+✅） |
| 提交交易数据 | **我系统** | 每笔充值提交 finance（±travelRule） |
| 读 webhook 判 pass/hold/freeze | **我系统** | 驱动充值状态机 |
| **持有 Sumsub txnId / amlCaseId 引用** | **我系统** | 记录义务：VARA III.G "obtain and **hold** + 监管可调取"，8 年留档；异步重筛 RED 靠 txnId 映射回 deposit（📄 VARA + ✅ counterpartyAmlCaseId 字段存在） |

**一句话**：处理交给 Sumsub，持有（引用）留给我自己。deposit 表必须存 `sumsubFinanceTxnId` / `sumsubTravelRuleTxnId` / `counterpartyAmlCaseId`。

---

## 2. 配置前提（落地前必须就位）

| 配置 | 谁配 | 依据 |
|---|---|---|
| 自己的 VASP Profile（TR 网络身份） | 我，一次性 | ✅ 交易 applicant 自动带 `institutionInfo.internalId` |
| **Wallet Address Book**（灌客户充值地址） | 我，持续 | `POST /resources/kyt/walletAddress/import`（单次≤1万）；**无所有权验证、加了即用、被动匹配**（📄）。主要给"别人查你"用，加速入站 TR 应答 |
| 加入 VASP Directory | 我，一次性 | 让对方 VASP 找得到你 |
| **Webhook 订阅**（Dev Space） | 我，一次性 | API 注册不了（✅ 3 端点 404），后台配。收 `applicantKytTxn*` + `amlCase*` + `kytCaseV2*` |
| **AML provider**（ComplyAdvantage Mesh） | 我 | ✅ 在 level 的 `watchListCheckSettings`（`amlCaseType:caMeshSearch` + `screeningConfigurationId`），租户已开通 |
| **对手方 AML 规则** AML0/AML13/AML19 | 我，已装 | ✅ 用户已在后台装（`types=['finance']`） |
| **Crystal 集成**（链上分析） | 我/商务 | ✅ `bgCheckTarget: TM_CRYPTO_RISK_SCORING_CRYSTAL`，规则 live |

**只做 sanctions + pep 两核心**（用户定调）；adverse/crime/terrorism 规则（AML16/17/18）命中归"合规专员兜底"，不硬编码。

---

## 3. 接口调用（端点统一 `POST /resources/applicants/{applicantId}/kyt/txns/-/data`）

| 场景 | type | 次数 | direction | 触发的筛查 |
|---|---|---|---|---|
| **法币充值** | `finance` | **1** | `in` | 金额/行为 + **对手方 AML(AML0/13)**；TR 硬写 NOT_REQUIRED |
| **虚拟币充值** | `finance` + `travelRule` | **2** | `in` | finance 同上；travelRule = **Crystal 链上** + TR 报文 + VASP/unhosted |

✅ 实测：对手方制裁名单筛查在 **finance** 那笔（AML0/1/13 全 `types=['finance']`），**不在 travelRule**。链上地址脏才走 travelRule（Crystal）。

**虚拟币多一步 0**：对方 VASP 发 TR 报文，我方回（仅对方是 VASP 时；unhosted 无报文）。这一步即提交 travelRule 交易所驱动，非独立动作。

---

## 4. Webhook 返回（三家族）

### 4.1 交易层 `applicantKytTxn*`（每笔交易结果）
`applicantKytTxnApproved / OnHold / Rejected / AwaitingUser`。虚拟币 finance + travelRule 两笔各一路。

### 4.2 AML 筛查 `amlCase*`（对手方名单筛查）
`amlCaseApproved(GREEN) / amlCaseOnHold(YELLOW) / amlCaseRejected(RED)`。
- ✅ **装了 AML0 后，每笔 finance 必建一个 counterparty amlCase（`counterpartyAmlCaseId` 字段），GREEN 也建、也发 amlCaseApproved**（实测两笔各一 id）。
- 📄 都是"review completed"的**结案**信号（无 `amlCaseCreated`）；GREEN=命中被判误报，干净无命中不发。
- ✅ amlCase 结构：`review.reviewAnswer` RED/YELLOW/GREEN；`hits[]` 每条 `review.matchStatus` ∈ {unknown, potential_match, false_positive, true_positive}；`riskLabels` ∈ {sanctions, pep, adverseMedia, terrorism, crime}。**case 级 RED = 只要有一条 true_positive**。

### 4.3 调查案 `kytCaseV2*`（Case Management 2.0）
📄 `kytCaseV2Created / StatusChanged / BlueprintChanged / PriorityChanged`。MLRO 点 Resolve 选 **False positive / Valid threat** 结案 → 发 `kytCaseV2StatusChanged`。**与 amlCase 是两套**。

### 4.4 组合逻辑（虚拟币）
finance + travelRule 两路交易结果**取最强**：`reject > awaitUser > onHold > approved`（= Sumsub 动作优先级 reject10 > awaitUser7 > onHold5 > score0，✅ 实测印证）。

### 4.5 ⚠️ 时序铁律
amlCase 与交易 webhook **异步分开到，不保证谁先**。合并逻辑必须"等齐再判 / 给 amlCase 等待窗口"——**绝不能"收到 finance approved 就放行"**，否则随后到的 amlCaseRejected 会漏掉制裁。amlCase 是上位否决。

---

## 5. Webhook → 驱动充值状态机（核心映射）

**两步判，顺序固定：amlCase 先（上位否决）→ 无覆盖再看交易结果。**

### 闸 1 · amlCase（先判）
| webhook / riskLabel | deposit 动作 | 承载 level |
|---|---|---|
| `amlCaseRejected` · **sanctions** | → **FROZEN**（钱 SUSPENSE→CLIENT_BLOCKED）+ 建 MLRO case + 上报 | — |
| `amlCaseRejected` · **pep/adverse** | → **ACTION_PENDING** {EDD_SOF} | **EDD-transaction**（type=actions，✅ 实测）；**不切 EDD-PEP**（那会把非 PEP 客户误标） |
| `amlCaseRejected` · **其他/说不清** | → **CASE_PENDING** {mlroReview}（开 MLRO case） | — |
| `amlCaseOnHold`（YELLOW） | 留 COMPLIANCE_PENDING，等 Sumsub 定性 | — |
| `amlCaseApproved`（GREEN） | 进闸 2 | — |

> ⚠️ **ofac/eu 折进 sanctions→FROZEN**（用户定调）：deposit 的 FROZEN 是"账务预防性挂起"（钱先锁），非"宣称 TFS 法定冻结"，谁都能做、不踩法律坑；MLRO 再定 UN/UAE 强制冻 vs OFAC/EU 咨询监管。

### 闸 2 · 交易结果（无 amlCase 覆盖时）
| 组合结果 | 法币 | 虚拟币 |
|---|---|---|
| **reject** | → **REJECTED**（退回银行）或 FROZEN(疑) | → **FROZEN + 调查**（**绝不 REJECTED**） |
| **awaitUser** | → **ACTION_PENDING**（客户 action + SLA） | 同左（钱包所有权认证 / TR originator 补录） |
| **onHold** | 留 COMPLIANCE_PENDING | 同左 |
| **approved** | → 记账 Step2（SUSPENSE→PAYABLE）→ **SUCCESS** | 同左 |

### CASE_PENDING（等 MLRO 调查，钱仍锁 SUSPENSE）
📄+🟡 由 `kytCaseV2StatusChanged` 驱动，MLRO 结案定性：
- Resolution = **False positive** → 回 COMPLIANCE_PENDING 重评 → SUCCESS
- Resolution = **Valid threat** → FROZEN（币）/ REJECTED（法币）

**CASE_PENDING vs FROZEN**：前者"还在定"（钱 SUSPENSE），后者"定了要冻"（钱 CLIENT_BLOCKED）。sanctions 不走 CASE_PENDING——先冻后查。

---

## 6. 状态机（终版）

### 状态清单
| 状态 | 类型 | 钱在哪 | 等谁 |
|---|---|---|---|
| `PAYIN_PENDING` | 入口 | 未到账 | 链上/VIBAN 确认 |
| `COMPLIANCE_PENDING` | 枢纽 | SUSPENSE | Sumsub webhook |
| `ACTION_PENDING` | 等待 | SUSPENSE | **客户**（SOF/钱包认证）|
| `CASE_PENDING` | 等待 | SUSPENSE | **MLRO**（调查案）|
| `FROZEN` | 半终态 | CLIENT_BLOCKED | 解冻/上缴决定 |
| `SUCCESS` | 终态 | CLIENT_PAYABLE | — |
| `REJECTED` | 终态（仅法币）| 退回银行 | — |
| `CONFISCATING`→`CONFISCATED` | 中间→终态（运营）| →FIRM_FEE | below-min 没收 |
| `SEIZED` | 终态（监管）| →政府 | 上缴 |

### 转移表
```
[*] → PAYIN_PENDING
PAYIN_PENDING → COMPLIANCE_PENDING            : payin确认 + 记账Step1
COMPLIANCE_PENDING → FROZEN                   : amlCase sanctions / 交易reject(虚拟币)
COMPLIANCE_PENDING → ACTION_PENDING           : amlCase pep / 交易awaitUser
COMPLIANCE_PENDING → CASE_PENDING             : amlCase ofac/adverse/onHold拖 (开case)
COMPLIANCE_PENDING → CONFISCATING → CONFISCATED : below-min没收(运营)
COMPLIANCE_PENDING → REJECTED                 : 交易reject(法币) → 退回银行
COMPLIANCE_PENDING → SUCCESS                  : 全approved + 记账Step2
COMPLIANCE_PENDING → COMPLIANCE_PENDING       : amlCase onHold / 交易onHold (原地留 + reason)
ACTION_PENDING → COMPLIANCE_PENDING           : 客户完成 → 重评
ACTION_PENDING → CASE_PENDING                 : SLA到点 → 转 MLRO 调查
CASE_PENDING → COMPLIANCE_PENDING             : kytCaseV2StatusChanged = 误报 → 重评
CASE_PENDING → FROZEN / REJECTED              : kytCaseV2StatusChanged = 威胁
FROZEN → COMPLIANCE_PENDING                   : 解冻(除名 / EOCN 解冻令)
FROZEN → SEIZED                               : 上缴(政府令)
SUCCESS / REJECTED / CONFISCATED / SEIZED → [*]
```
（✗ FROZEN 绝不 → REJECTED：制裁不可退回发款方，VARA III.H.3.b）

### 字段（reason 多而细，status 少而粗）
- `actionReason` ∈ {EDD_SOF, WALLET_OWNERSHIP, PARTIAL_MATCH_DOCS}（ACTION_PENDING 用）
- `reviewReason` ∈ {SLA_BREACH, OFAC_EU, ADVERSE_MEDIA, AML_ONHOLD}（CASE_PENDING 用）
- `complianceHoldReason` ∈ {SANCTIONS, ...}（FROZEN 用）
- `limitHoldReason` = BELOW_MIN（运营，与合规 reason **永不混**）
- `slaDeadline` / `slaBreached`（ACTION_PENDING）
- 引用：`sumsubFinanceTxnId` / `sumsubTravelRuleTxnId` / `counterpartyAmlCaseId` / `kytCaseV2Id`

---

## 7. 锁定决策

1. **虚拟币绝不 REJECTED**，任何该拒 → FROZEN（链上不可逆 + 制裁不可退 + 退回是新出金）。法币可 REJECTED 退回银行。
2. **FROZEN 半终态**，出口仅 解冻→COMPLIANCE_PENDING 或 上缴→SEIZED；✗ 不退制裁方。
3. **amlCase 两核心**：sanctions→FROZEN｜pep→ACTION_PENDING(EDD-transaction)；其余→CASE_PENDING(mlroReview) 交合规专员。
4. **SLA 到点不自动跳终态**，→ CASE_PENDING，MLRO 人裁（可 event-driven off `kytCaseV2StatusChanged`）。
5. **没收(运营·below-min→FIRM_FEE) vs 上缴(监管→政府)** = 同一状态机两个终态，**不拆两台机器**。
6. **EDD 打在【我客户】身上，不打对手方**。客户自己 PEP → standard workflow(EDD-PEP standalone)；对手方 PEP → action workflow(EDD-transaction)，只对我客户收 SOF。
7. **小额(below-min) 是运营门放我系统，不塞 Sumsub**（Sumsub 只管合规筛查；小额仍过合规——制裁无起征点）。合规 reject ⟂ 运营 below-min，信号永不混。

---

## 8. 实测证据台账 & 待办

### 已实测坐实（✅）
- API 次数/type 归属；对手方 AML 在 finance；每笔必建 counterparty amlCase（含 GREEN）
- amlCase 结构（RED + hits[].matchStatus 四值 + riskLabels）；真 case `6a5dfc9a`
- 组合优先级 reject>awaitUser>onHold>approved
- Crystal 链上返回结构（riskScore/signals 13 类）；对手方钱包实测 0.48/YELLOW
- level type：standalone(standard) vs actions(action)；EDD-PEP=standalone、EDD-transaction=actions
- unhosted 三分支（own签名 / hosted选VASP / unhosted自声明 originator）——WebSDK 全程截图走通
- 删 applicant API 403（需后台）；已给测试 applicant 打 `zzz-delete` 标签

### 文档/推断，落地前再核（📄/🟡）
- `kytCaseV2*` 四 webhook（📄，未在沙盒收到实物）
- webhook 实物投递数量（🟡，注册端点后台专属，未真收；映射：干净虚拟币=finance 2 + tr 1 = 3 个）
- CASE_PENDING event-driven 细节（🟡）
- VARA 具体条款号（📄 原文引用，条款编号需对原文位置）

### 沙盒堵死项（需后台/工单）
- 对手方制裁 RED（沙盒不认 magic name，永 GREEN）
- 真收 webhook（Dev Space 贴 `webhook.site` 端点 + 后台 Request check）

---

## 9. 与现状代码的差距（truth/v4-deposit.md）

- 现状 L2 是 **mock KYT/TR 端点**；本设计用真 Sumsub 替代。
- 现状 `complianceStatus` 是**客户级二值(CLEAR/FROZEN)**，**表达不了单笔 deposit 冻结** → 需资产级冻结（CLIENT_BLOCKED 102）。
- 现状 **无对手方筛查**（只筛自己客户 CRA→handleSanctionsPath）→ 需补 finance 上的对手方 AML（AML0）。
- 现状 `KYT FAILED` 是死胡同（永挂 COMPLIANCE_PENDING）→ 需补终态出口（本设计的闸 2）。
- 新增状态：`CASE_PENDING` / `SEIZED`；`REJECTED` 限法币。

---

## 附：风险 label → 规则路由（✅ 实测规则条件）
```
riskLabels 含 'sanctions'    → AML15 → 本设计 FROZEN
              'pep'          → AML14 → ACTION_PENDING(EDD-transaction)
              'adverseMedia' → AML16 → CASE_PENDING(合规专员)
              'terrorism'    → AML17 → (归 sanctions 家族/FROZEN)
              'crime'        → AML18 → CASE_PENDING(合规专员)
```
Crystal 链上分档：riskScore ≥0.70 reject → FROZEN；0.25–0.69 onHold；≤0.24 score。
