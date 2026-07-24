# 充值合规 · Sumsub 集成与状态机驱动 设计 spec

> **主题**:充值(Deposit)合规审查用 Sumsub 替代现有 mock KYT/TR。定义 **Sumsub 接口调用 → webhook 返回 → 驱动充值状态机 → 状态机流转** 的完整闭环。
> **日期**:v1 2026-07-23 / **v2 2026-07-24**(webhook 全实测 + officer 全在 Sumsub 架构 + 状态机终版)
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
| **处置 tag 预注册** | 后台 Settings 建 `FROZEN_BY_MLRO`、`RETURN_TO_SENDER`;**未注册 API 打 tag 400**(✅ 实测) |
| AML provider(ComplyAdvantage Mesh) | ✅ 已开通(level `watchListCheckSettings`:`caMeshSearch`+configId) |
| 对手方 AML 规则 AML0/1/13/19/22 | ✅ 已装(`types=['finance']`);amlCase 两核心:**sanctions + pep**,其余归合规专员(🟡 业主定调) |
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
| 对手方 amlCase 结案 | `amlCase{Approved/OnHold/Rejected}` | 1 —— **每笔必发(GREEN 也发);travelRule 笔同样会发** |
| officer Approve(含 rejected 翻案) | `applicantKytTxnApproved` **+** `applicantKytTxnReviewed` | **成对同时发** |
| officer Reject(**含同状态重拍 RED→RED**) | `applicantKytTxnRejected` **+** `applicantKytTxnReviewed` | **成对同时发** |
| officer 设 onHold | `applicantKytOnHold` | 1(信息性) |
| officer 设 **pending** | **无** | 0 —— 状态真变但静默,**禁用作信号** |
| 打/摘 **tag** | **无** | 0 —— tag=载荷不是事件 |
| 创建 action / 下发 link | **无** | 0 —— 客户**提交时**才发 `applicantActionPending`,审完发 `applicantActionReviewed`(GREEN/RED) |
| applicant 建档 | `applicantCreated` | 1 |

### 4.2 消费铁律
1. **payload 自带 reviewStatus**,直接读,不靠上一状态推断(✅)
2. **成对投递必幂等**:按 `kytTxnId+reviewResult` 去重,第二条 no-op
3. **handler state-aware**:先比对 deposit 当前状态再流转
4. **两层字段**:`review.reviewResult`(officer 终裁)⊃ 覆盖 `scoringResult.action`(规则输出);翻案只改前者(✅)
5. 虚拟币 finance+tr 两路组合取最强:`reject > awaitUser > onHold > approved`

## 5. Webhook → 状态机驱动

### 5.1 两闸 + veto
- **闸 1 amlCase(上位否决,两核心)**:`sanctions → FROZEN`(**全局中断:可从 COMPLIANCE_PENDING/ACTION_PENDING/MANUAL_CHECKING 任意非终态触发**,处理乱序);`pep → ACTION_PENDING`(EDD-transaction 收 SOF,action workflow,不切 EDD-PEP);其他 label/说不清 → MANUAL_CHECKING 交专员;YELLOW → 原地留;GREEN → 进闸 2。
- **闸 2 交易结果**:approved → 运营闸(below-min)→ SUCCESS;awaitUser → ACTION_PENDING;onHold → 原地留(**超 SLA→MANUAL_CHECKING,防死胡同**);rejected → 见 5.2。

### 5.2 Rejected handler(officer 处置协议,v2 定稿)
```
收到 Rejected+Reviewed 对(幂等去重后):
  deposit 在 COMPLIANCE_PENDING → 转 MANUAL_CHECKING(首拒,无 tag)
  deposit 在 MANUAL_CHECKING   → 这是 officer 的处置信号 → 拉 txn 读 userDefined tags:
        FROZEN_BY_MLRO   → FROZEN
        RETURN_TO_SENDER → 退回审批(见 §6 应然)→ RETURNING
        无处置 tag        → 留 MANUAL_CHECKING(仅重申拒绝)
收到 Approved 对 且在 MANUAL_CHECKING → 运营闸 → SUCCESS(误报翻案)
```
**officer 全 Sumsub 双击流**:调查 → 误报点 Approve｜冻结/退回打 tag+**重拍 Reject**(同状态重拍必发对,✅)｜要材料发 link+设 awaitingUser(发 `AwaitingUser`,✅)。**零轮询。**

### 5.3 中断-恢复模式(veto/解冻)
KYT 结果是**持久状态**(txn 对象可随时拉),不是转瞬事件。FROZEN 期间到达的 KYT webhook 只记录不流转;**解冻后恢复点 = 拉 txn 读 reviewResult/action/tags 按闸 2 路由**;冻结 >30d 可先调 rescore 再读(🟡)。
**AML1 反噬耦合(✅ 规则实证)**:AML1 条件 `amlCaseReview.reviewAnswer=='RED'`→reject——amlCase RED 会把交易本身打成 rejected。故 PEP 弧 EDD 过后拉到 rejected 是**历史产物**:等 officer 翻案对,勿当新拒/勿走 tag 分流(无 tag 自然落 MANUAL_CHECKING 兜底,正确)。

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
COMPLIANCE_PENDING: 自环 onHold/YELLOW ｜ →ACTION_PENDING(awaitUser/pep) ｜ →MANUAL_CHECKING(首拒无tag/onHold超SLA)
                    ｜ →运营闸(全approved) ｜ ⚡→FROZEN(sanctions veto)
ACTION_PENDING: →COMPLIANCE_PENDING(客户完成) ｜ →MANUAL_CHECKING(SLA 7d) ｜ ⚡→FROZEN
MANUAL_CHECKING: →运营闸(Approve误报) ｜ →FROZEN(tag冻+重拍) ｜ →RETURNING(tag退+重拍→审批+FIU)
                 ｜ →ACTION_PENDING(发link+awaitingUser) ｜ ⚡→FROZEN
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
2. 处置触发协议 = **tag(载荷,预注册)+ 重拍 Reject(触发)**;pending 静默禁用;onHold 信息性。
3. 虚拟币无 REJECTED 终态;**RETURNED 取代 REJECTED**;FROZEN 出口仅解冻回炉/上缴,✗不退制裁方。
4. amlCase 两核心 sanctions/pep;sanctions veto=全局中断边;其他交合规专员(MANUAL_CHECKING)。
5. 成对幂等 + state-aware 是 handler 硬前提。
6. 动钱松方向必审批+在途态(RETURNING/SEIZING/CONFISCATING);冻结免事前审批。
7. 小额(below-min)运营闸在你系统、置于合规通过后;制裁无起征点,小额也全程过筛。
8. EDD 打自己客户(对手方 PEP 用 EDD-transaction/action workflow,不切 EDD-PEP、不误标客户)。

## 8. 实测证据台账(v2)

**✅ 实测(含 webhook.site 实捕)**:§4 全矩阵;rejected↔approved 双向翻案;同状态重拍发对;pending 真变静默;tag 须预注册(400)/增删静默;action 创建静默;AwaitingUser 只出评分且 payload=awaitingUser;Created 存在;travelRule 也发 amlCase;两层字段分离;AML1 反噬(规则条件);case↔交易互链(kytCaseIds/counterpartyAmlCaseId);Create-case 不限 rejected(📄);amlCase 结构(hits[].matchStatus 四值+riskLabels)。
**🟡 未实测/待核**:手动 awaitingUser 后自动重裁(设计不依赖);kytCaseV2* webhook 租户可用性;UAE FIU 退回同意机制;冻>30d rescore 策略。
**沙盒堵死**:对手方制裁 RED(magic name 只认 applicant+后台 Request check)。

## 9. 与现状代码差距(truth/v4-deposit.md)

- mock KYT/TR → 真 Sumsub;`complianceStatus` 客户级二值 → 需资产级冻结(CLIENT_BLOCKED);无对手方筛查 → AML0;KYT FAILED 死胡同 → 本设计闸 2+SLA 全覆盖。
- 新状态:MANUAL_CHECKING / RETURNING / RETURNED / SEIZING / SEIZED;删 REJECTED;FAILED/EXPIRED 技术态保留不变。

## 附:风险 label → 路由(✅)
```
sanctions→AML15→FROZEN(veto) ｜ pep→AML14→ACTION_PENDING(EDD-transaction)
adverseMedia/crime→AML16/18→MANUAL_CHECKING(专员) ｜ terrorism→AML17→FROZEN 家族
Crystal: ≥0.70 reject→FROZEN ｜ 0.25–0.69 onHold ｜ ≤0.24 score
```
