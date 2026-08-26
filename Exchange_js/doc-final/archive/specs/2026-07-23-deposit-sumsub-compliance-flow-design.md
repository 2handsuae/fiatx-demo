# 充值合规 · Sumsub 集成与状态机驱动 设计 spec

> **主题**:充值(Deposit)合规审查用 Sumsub 替代现有 mock KYT/TR。定义 **Sumsub 接口调用 → webhook 返回 → 驱动充值状态机 → 状态机流转** 的完整闭环。
> **日期**:v1 2026-07-23 / v2 2026-07-24(webhook 全实测 + officer 全在 Sumsub + 状态机终版)/ **v3 2026-07-25**(KYT-only:忽略 amlCase、靠规则折叠+自动重算;sanctions/pep 场景标签)
> **状态**:设计(未实现)　**范围**:仅充值域;仅个人客户(无公司/KYB)。
> **配套图**:充值单 Lark PRD 附录 B(状态机终版画板)、附录 C(调用与 webhook 判断流程画板,待用户修订)。

## 0. 置信度标注约定

- ✅ **实测**:sandbox 真实调用/回读;**v2 起 webhook 均为 webhook.site 真实捕获**,非文档推断。
- 📄 **文档**:Sumsub 官方文档 / VARA·EOCN 原文。
- 🟡 **推断/政策**:设计推导或业主政策决定。

沙盒边界(诚实前置):对手方 AML 筛查不认 magic name 永返 GREEN(✅);applicant 制裁 RED 需后台手动 Request check(✅);手动 awaitingUser 后客户完成交易**是否自动重裁未实测**(设计上不依赖,见 §5.4)。

---

## 1. 总架构:officer 全在 Sumsub,你系统纯被动(v2 定稿)

**业主定调:officer 主场是 Sumsub,尽量不在自己系统点状态流转。** 实测验证此架构成立:

- **Sumsub** = 筛查 + 证据 + **officer 调查与处置**(改判/打 tag/发 link 全在 Sumsub 完成)
- **你系统** = 状态机唯一真相源,消费 webhook + 拉取持久态,**零手工流转按钮**;仅"动钱执行"(记账/出金/审批链)在你系统
- 一致性:deposit 存 `sumsubFinanceTxnId / sumsubTravelRuleTxnId / counterpartyAmlCaseId` 引用(VARA III.G hold 义务 + 8 年留档 + 迟到 webhook 对号入座)

## 2. 配置前提(落地前必须就位)

| 配置 | 说明 |
|---|---|
| 自己的 VASP Profile / 加入 VASP Directory | 一次性;交易自动带 `institutionInfo.internalId`(✅) |
| Wallet Address Book | `POST /resources/kyt/walletAddress/import`(≤1万/次);无验证、被动匹配,给入站 TR 应答用(📄) |
| **Webhook 端点**(Dev Space) | API 注册不了(✅ 404);后台配。生产换正式地址 |
| **tag 预注册**(4 个) | 场景标签 `SANCTION`、`PEP`(规则自动打,供 KYT-only 分流)+ 处置标签 `FROZEN_BY_MLRO`、`RETURN_TO_SENDER`(officer 打);**未注册 API 打 tag 400**(✅ 实测) |
| AML provider(ComplyAdvantage Mesh) | ✅ 已开通(level `watchListCheckSettings`:`caMeshSearch`+configId) |
| 对手方 AML 规则 AML0/1/13/19/22 | ✅ 已装(`types=['finance']`);**KYT-only 前提=规则全开当折叠器,别关**(见 §5.1);amlCase 两核心 **sanctions/pep**,其余归专员(🟡);配 `sanctions→reject+打SANCTION tag`、`pep→awaitUser+EDD action+打PEP tag`(🟡 需配) |
| Crystal 集成 | ✅ 已开通(travelRule 上 6 条规则 live) |

## 3. 接口(端点 `POST /resources/applicants/{applicantId}/kyt/txns/-/data`)

| 场景 | type | 次数 | 触发 |
|---|---|---|---|
| 法币充值 | `finance` | 1 | 金额/行为 + 对手方 AML;TR=NOT_REQUIRED |
| 虚拟币充值 | `finance`+`travelRule` | 2 | finance 同上;travelRule=Crystal 链上+TR 报文+VASP/unhosted |

辅助 API(✅ 全实测):
- **改判**:`POST /kyt/txns/{id}/review/status/completed` body `{"reviewAnswer":"GREEN"|"RED"}` — **rejected↔approved 双向可翻,同状态重拍也发 webhook**
- 挂起:`POST .../review/status/onHold`;停车:`POST .../review/status/pending`(**静默,禁用作信号**)
- tag:`POST|DELETE /kyt/txns/{id}/tags`(静默);重评:`POST /kyt/txns/{id}/-/score`(≤200 次)

## 4. Webhook 实测矩阵(v2 核心,全部 webhook.site 实捕 ✅)

### 4.1 触发源 × webhook
| 事件 | 真实 webhook | 数量 |
|---|---|---|
| 交易创建 | `applicantKytTxnCreated`(reviewStatus=init) | 1 —— **当回执:提交后未到=丢单告警** |
| 首评落 awaitUser | `applicantKytTxnAwaitingUser`(reviewStatus=awaitingUser) | 1 —— 仅规则评分产生,**不经过 pending** |
| 对手方 amlCase 结案 | `amlCase{Approved/OnHold/Rejected}` | 1 —— **每笔必发(GREEN 也发);但 KYT-only 下你系统【不消费】**(靠规则折进 KYT,见 §5.1);无对手方/关 AML0 则不发(✅ 三向实测) |
| officer Approve(含 rejected 翻案) | `applicantKytTxnApproved` **+** `applicantKytTxnReviewed` | **成对同时发** |
| officer Reject(控制台走 onHold→reject;API 同状态重拍亦发) | `applicantKytTxnRejected` **+** `applicantKytTxnReviewed` | **成对同时发** |
| officer 设 onHold | `applicantKytOnHold` | 1(信息性) |
| officer 设 **pending** | **无** | 0 —— 状态真变但静默,**禁用作信号** |
| 打/摘 **tag** | **无** | 0 —— tag=载荷不是事件 |
| 创建 action / 下发 link | **无** | 0 —— 客户**提交时**才发 `applicantActionPending`,审完发 `applicantActionReviewed`(GREEN/RED) |
| applicant 建档 | `applicantCreated` | 1 |

### 4.2 消费铁律
1. **payload 自带 reviewStatus**,直接读,不靠上一状态推断(✅)
2. **只认 `Approved`/`Rejected` 路由**(每次终裁必到且载 reviewResult);`Reviewed` 陪跑、可忽略甚至退订。**幂等为抗重试**(Sumsub 失败会重投同一 webhook,直到 200),非抗成对,按 `kytTxnId+reviewResult` 去重
3. **handler state-aware**:已终态则 no-op(幂等兜底);sanctions 经 KYT `rejected+SANCTION tag` 折叠进来(不再是独立 amlCase veto)
4. **两层字段**:`review.reviewResult`(officer 终裁)⊃ 覆盖 `scoringResult.action`(规则输出);翻案只改前者(✅)
5. 虚拟币 finance+tr 两路组合取最强:`reject > awaitUser > onHold > approved`

## 5. Webhook → 状态机驱动

### 5.1 架构:只认 KYT,不消费 amlCase(v3 决策)
**你系统只订阅 `applicantKytTxn*`,完全忽略 `amlCase*`/`kytCaseV2*`,不做 case↔交易交叉判断。**

**为什么能这么做(原因,🟡=async 慢 case 端到端未验):**
1. **amlCase 结果由 AML 规则折叠进交易裁决**(RED→AML1 reject / YELLOW→AML2 onHold / GREEN→AML22 score)——交易 verdict 已含对手方 AML 结论,无需另读 case。这就是之前叫"AML1 反噬"的机制,**它正是我们依赖的折叠器,不是要躲的坑**。
2. **case 未决期间交易被 onHold 扣住,绝不提前 approved**(📄)——`applicantKytOnHold`/`AwaitingUser` 就是"押着等 case",不会误放。
3. **case 晚到/解决时,Sumsub 自动重算交易并补发 `applicantKytTxnReviewed`→`Approved/Rejected`,无需你调 rescore**(📄)——解决"amlCaseReject 回来慢"的乱序担忧。
4. 于是 amlCase 只是 Sumsub 内部中间态;你只看折叠好的 KYT 裁决,省掉交叉判断/乱序/case 引用维护。

**硬前提:AML 动作规则必须全开(它们是折叠器)。** 关 AML0=不筛不折叠(制裁也漏筛);关动作规则=case 不再扣住交易→可能提前 approved→漏放。**别关规则,只靠它们替你折叠。**
**不覆盖:本人(applicant)命中制裁/PEP** —— 那是 `applicantReviewed`(客户级、账户级冻结),不折进交易 KYT,由 onboarding/compliance 状态门管(CLAUDE.md 规则4),不在本 KYT-only 范围。

### 5.1b 单闸:KYT 裁决 + 场景标签分流
只读一个信号——KYT verdict,配规则在交易上打的**场景标签**区分是哪种命中:

| KYT verdict | 场景 tag(规则自动打) | 你系统 |
|---|---|---|
| approved | — | 运营闸(below-min)→ SUCCESS |
| awaitUser | **`PEP`** / 一般(钱包认证等) | ACTION_PENDING(PEP→下发 pep-EDD 问卷) |
| onHold | — | 原地留;**超 SLA→MANUAL_CHECKING** |
| **rejected** | **`SANCTION`** | **直接 FROZEN**(法定即时,不进 MANUAL_CHECKING) |
| **rejected** | 无场景 tag | MANUAL_CHECKING → officer 处置(见 5.2) |

**两类 tag 分清(这是本节新增的"两个场景处置标签"):**
- **场景标签(规则自动打,你随 KYT 裁决拉交易时读)** —— 回答"这条命中是哪个场景":
  - **`SANCTION`** —— sanctions 命中 → 交易 rejected + 此 tag → **直接 FROZEN**(不进人工;走冻结/解冻/上缴弧)
  - **`PEP`** —— pep 命中 → 交易 awaitUser + 此 tag → **ACTION_PENDING + pep-EDD**(收材料,清白后自动重算放行)
  - 🟡 需在 rule 里配"命中标签→打 userDefined tag";替代方案=读 KYT `scoringResult` 里命中的规则名(如 AML15)判场景。tag 须先预注册(§2)。
- **处置标签(officer 在 MANUAL_CHECKING 手动 onHold→tag→reject)** —— 回答"这笔 dirty 怎么处置",见 5.2:`FROZEN_BY_MLRO` / `RETURN_TO_SENDER`。

### 5.2 Rejected handler(officer 处置协议,v2 定稿)
**凡收到 Rejected —— 不分首次/再次,统一处理**(去掉 state-aware 分叉,系统只看 tag):
```
收到 Rejected(幂等去重后):
  1) deposit 非终态 → 置/保持 MANUAL_CHECKING
  2) 拉 txn 读 userDefined tags 分流:
       FROZEN_BY_MLRO   → 订单直接冻结 FROZEN（收紧方向,无需事前审批,幂等:已冻则 no-op）
       RETURN_TO_SENDER → 自动提交 return 审批单（MLRO maker-checker,批后 → RETURNING）
       无处置 tag        → 留守 MANUAL_CHECKING（仅重申拒绝）
收到 Approved 且在 MANUAL_CHECKING → 运营闸 → SUCCESS(误报翻案)
```
**officer 全 Sumsub 操作（控制台真实路径,✅ 实测):**
- 误报 → 点 **Approve**（rejected→approved 翻案可行,发 `Approved`）
- 冻结/退回 → **控制台不能对已 rejected 直接再 Reject**;须 **先 onHold → 加 tag → 再 Reject**(onHold 中间步系统收 `OnHold` 但 no-op;最终 Reject 发 `Rejected+Reviewed` → 系统拉 tag 分流)
- 要材料 → 发 link + 设 **awaitingUser**(发 `AwaitingUser`)→ ACTION_PENDING

**零轮询**;信号即事件。

### 5.3 折叠机制 + 恢复(取代旧"反噬/veto"说法)
**折叠(Sumsub 内部,你不管):** amlCase 结论经 AML1/2/22 折进交易裁决;case 未决时交易被押 onHold(不误放);case 解决自动重算、补发 `applicantKytTxnReviewed`→`Approved/Rejected`——**你不用 rescore、不用听 amlCase**(📄;`applicantKytTxnReviewed` ✅ 实测,async 慢 case 端到端未验)。
**pep 清白自动放行:** 客户交 SOF → officer 把 hit 标 false_positive → 案子 GREEN → Sumsub 自动重算 → 交易 approved → 你收 `applicantKytTxnApproved` → SUCCESS。全程 KYT 一个口子。
**FROZEN 恢复:** KYT 结果是**持久状态**(txn 可随时拉);解冻(除名/EOCN 令+maker-checker)后**拉 txn 读裁决/tags 按 5.1b 重走**;冻 >30d 可先 rescore 再读(🟡)。

### 5.4 ACTION_PENDING 完成翻转(多 action 聚合)
不数 actionId,**用交易 `scoringResult.action` 当聚合闸**(仍 awaitUser=没完,非 awaitUser=全完)。触发信号:`applicantActionPending`(客户提交)/`applicantActionReviewed`(材料审毕 GREEN/RED)→ 拉 txn 判。**规则触发的 awaitUser**:flow 完成自动重评(📄);**officer 手动设的 awaitingUser**:勿指望自动重裁(🟡 未实测),出口=officer 审材料后显式 Approve/Reject → 成对 webhook。EDD 类完成**不自动放行**(EDD 本义人判 SOF)。SLA 7d 未完成 → MANUAL_CHECKING(监管场景如 PARTIAL_MATCH_DOCS 用 EOCN 10 工作日线)。

## 6. 状态机(终版)

### 状态
| 状态 | 类型 | 钱 | 等谁 |
|---|---|---|---|
| PAYIN_PENDING | 入口 | 未到账 | 链上/VIBAN |
| COMPLIANCE_PENDING | 枢纽 | SUSPENSE | Sumsub 结果;onHold/YELLOW 原地留,**超 SLA→人工** |
| ACTION_PENDING | 等待 | SUSPENSE | 客户(SOF/认证);SLA 7d |
| MANUAL_CHECKING | 人工 | SUSPENSE | officer 在 Sumsub 调查处置 |
| FROZEN | 半终 | CLIENT_BLOCKED | 解冻令或政府令 |
| RETURNING → RETURNED | 在途→终 | 出金在途→原路退回 | 出金确认(失败停留重试) |
| SEIZING → SEIZED | 在途→终 | 移交在途→政府 | 移交确认(失败停留) |
| CONFISCATING → CONFISCATED | 在途→终(运营) | →FIRM_FEE | 两腿 post |
| SUCCESS | 终 | CLIENT_PAYABLE | — |
> **RETURNED 取代 REJECTED**(钱到账过,是退回非拒收);法币/虚拟币异常退回统一走 MANUAL_CHECKING→RETURNING。

### 转移(全量)
```
[*]→PAYIN_PENDING →(payin确认+记账Step1)→ COMPLIANCE_PENDING
COMPLIANCE_PENDING: 自环 onHold/YELLOW ｜ →ACTION_PENDING(awaitUser;PEP tag→pep-EDD) ｜ →MANUAL_CHECKING(rejected无场景tag/onHold超SLA)
                    ｜ →运营闸(approved) ｜ →FROZEN(rejected+SANCTION tag)
ACTION_PENDING: →COMPLIANCE_PENDING(客户完成,自动重算) ｜ →MANUAL_CHECKING(SLA 7d)
MANUAL_CHECKING: →运营闸(Approve误报) ｜ →FROZEN(读FROZEN_BY_MLRO tag,officer onHold→tag→reject) ｜ →自动提return审批→RETURNING(读RETURN_TO_SENDER tag)
                 ｜ →ACTION_PENDING(发link+awaitingUser)
运营闸: ≥min/PASS豁免→SUCCESS ｜ <min→审批→CONFISCATING→CONFISCATED
RETURNING→RETURNED ｜ FROZEN→COMPLIANCE_PENDING(解冻回炉) ｜ FROZEN→SEIZING→SEIZED
SUCCESS/RETURNED/CONFISCATED/SEIZED→[*]
```

### 动钱弧应然(审批 + 在途态)
> **统一原则:钱往「紧」处走免事前审批(先锁再说);钱往「松」处走(出平台/变可用)必审批 + 两阶段在途态。失败停留在途重试,不回滚不跳终态。**

| 弧 | 事前审批 | 在途态 | 记账 |
|---|---|---|---|
| 没收(已有) | ✅ OPS maker-checker | CONFISCATING | pending 锁两腿→post |
| **退回** | ✅ MLRO maker-checker + **FIU 同意**(涉可疑;UAE 对等机制待核 🟡);原路退**不重跑风险筛**,仅制裁 re-check | **RETURNING** | SUSPENSE 出金腿 pending→post |
| **上缴** | ✅ 政府令文书验证+双人核(验证命令非裁量) | **SEIZING** | CLIENT_BLOCKED 移交腿 pending→post,8 年留档 |
| 冻结(进) | ❌ 制裁法定即时/tag 即执行(收紧方向) | 无(账内单步) | SUSPENSE→CLIENT_BLOCKED |
| 解冻(出) | ✅ 除名/EOCN 令+maker-checker | — | 回 COMPLIANCE_PENDING 重评 |

### 字段
`actionReason`{EDD_SOF,WALLET_OWNERSHIP,PARTIAL_MATCH_DOCS} / `manualReason`{FIRST_REJECT,SLA_BREACH,AML_OTHER} / `complianceHoldReason` / `limitHoldReason`(运营,永不混) / `slaDeadline·slaBreached` / Sumsub 引用四件套。

## 7. 锁定决策(v2)

1. officer 全在 Sumsub;你系统零流转按钮,webhook 事件驱动,零轮询。
2. 处置触发协议 = **tag(载荷,预注册)+ onHold→tag→reject(触发)**——控制台不能对已 rejected 直接再 Reject,须先 onHold;pending 静默禁用;onHold 信息性。
3. 虚拟币无 REJECTED 终态;**RETURNED 取代 REJECTED**;FROZEN 出口仅解冻回炉/上缴,✗不退制裁方。
4. **KYT-only**:只认 `applicantKytTxn*`,忽略 `amlCase*`(规则折叠 + case 未决押着不误放 + case 解决自动重算补发,§5.1)。sanctions→`rejected+SANCTION tag`→FROZEN;pep→`awaitUser+PEP tag`→ACTION_PENDING+EDD。**硬前提=AML 规则全开当折叠器**;本人命中走 `applicantReviewed`(账户级)不在此列。
5. **只认 Approved/Rejected 路由**(Reviewed 可忽略);幂等抗重试 + 已终态 no-op 是 handler 硬前提;**凡 rejected 一律→MANUAL_CHECKING 读 tag,不分首次**(FROZEN→直接冻结 / RETURN→自动提审批单 / 无 tag→留守)。
6. 动钱松方向必审批+在途态(RETURNING/SEIZING/CONFISCATING);冻结免事前审批。
7. 小额(below-min)运营闸在你系统、置于合规通过后;制裁无起征点,小额也全程过筛。
8. EDD 打自己客户(对手方 PEP 用 EDD-transaction/action workflow,不切 EDD-PEP、不误标客户)。

## 8. 实测证据台账(v2)

**✅ 实测(含 webhook.site 实捕)**:§4 全矩阵;rejected↔approved 双向翻案;同状态重拍发对;pending 真变静默;tag 须预注册(400)/增删静默;action 创建静默;AwaitingUser 只出评分且 payload=awaitingUser;Created 存在;travelRule 也发 amlCase;两层字段分离;AML1 反噬(规则条件);case↔交易互链(kytCaseIds/counterpartyAmlCaseId);Create-case 不限 rejected(📄);amlCase 结构(hits[].matchStatus 四值+riskLabels);**amlCase=对手方筛查产物三向对照:AML0开+无对手方→无 / AML0开+带对手方→amlCaseApproved / AML0关+带对手方→无(counterpartyAmlCaseId=None)**。
**📄 文档(KYT-only 依据,未在 sandbox 端到端强制验)**:case 未决期间交易被 onHold 押着不提前 approved;case 解决自动重算并补发 `applicantKytTxnReviewed`→`Approved/Rejected`,无需 rescore——故可只认 KYT、忽略 amlCase(慢对手方 case 未强制出、`applicantKytTxnReviewed` 已实测)。
**🟡 未实测/待核**:手动 awaitingUser 后自动重裁(设计不依赖);**控制台不能对已 rejected 直接再 Reject(业主实操报告——须 onHold→加 tag→reject;注:API 层同状态重拍可发对,是控制台 UI 约束)**;onHold→GREEN 是否发 Approved(webhook.site 桶满 429 未新捕,onHold→RED 已捕对,按对称推定);kytCaseV2* webhook 租户可用性;UAE FIU 退回同意机制;冻>30d rescore 策略。
**沙盒堵死**:对手方制裁 RED(magic name 只认 applicant+后台 Request check)。

## 9. 与现状代码差距(truth/v4-deposit.md)

- mock KYT/TR → 真 Sumsub;`complianceStatus` 客户级二值 → 需资产级冻结(CLIENT_BLOCKED);无对手方筛查 → AML0;KYT FAILED 死胡同 → 本设计 KYT 单闸(§5.1b)+SLA 全覆盖。
- 新状态:MANUAL_CHECKING / RETURNING / RETURNED / SEIZING / SEIZED;删 REJECTED;FAILED/EXPIRED 技术态保留不变。

## 附:风险 label → 规则动作 → KYT 折叠(你只见右侧 KYT 裁决+tag)
```
sanctions→AML15→交易 reject + 打 SANCTION tag → 你系统 FROZEN
pep→AML14→交易 awaitUser + EDD action + 打 PEP tag → 你系统 ACTION_PENDING
adverseMedia/crime→AML16/18→reject 无场景tag → MANUAL_CHECKING(专员) ｜ terrorism→AML17→FROZEN 家族
Crystal: ≥0.70 reject→FROZEN ｜ 0.25–0.69 onHold ｜ ≤0.24 score
```
