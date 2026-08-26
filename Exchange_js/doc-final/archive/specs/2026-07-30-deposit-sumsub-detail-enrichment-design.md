# 充值详情 · Sumsub 报文存证与展示增强 — 设计 spec

> **日期**:2026-07-30　**状态**:设计(未实现)
> **背景**:计划1(KYT-only 状态机)+ 计划2(动钱弧)+ 充值前端已落地;G1–G4 已把裁决回写闸门、L1/L2 状态门控、demo 报文真实化、Sumsub References 展示最新 webhook 做完(commit `ec6f885e`)。本轮是**详情页收尾 + Sumsub 报文存证**:把 `getTxn` 拉回的交易详情**存下来**并在详情页展示核心字段,顺带清理状态文案 / 字段命名 / 大 ACTIONS 块。
> **范围**:仅充值 admin 详情页 + 后端存证 + 数据模型改名。**不含 Travel Rule 的真实数据交换**(右路补字段 / 左路入站应答 / 地址簿 / 13 值状态)——那部分已发邮件请合规先建 VASP 主体,单独立项。

## 0. 已定决策(脑暴逐段确认,2026-07-30)

| # | 决策 | 依据 |
|---|---|---|
| 1 | **scene tag(SANCTION/PEP)+ 处置 tag(FROZEN_BY_MLRO/RETURN_TO_SENDER)全走 userDefined tag,维持现状不改分流** | 业主:「走 tag 吧,这个最有把握」。rejectLabels 方案作废(PEP 在 awaitUser 中间态,`review.reviewResult` 未落,rejectLabels 多半空;schema 确认处置类语义 rejectLabels 装不下) |
| 2 | **amlCase 命中折进 KYT 裁决 + tag,我方只消费 KYT 结果 + 读 tag,自己那层(`applyKytVerdict`)按我方需要落地** | 业主:「amlCase 返回的信息,kytResult 再加工一层,根据我们自己的需要走」。= 现有架构,不动 |
| 3 | **`scoringResult.score` 展示;上游(`cryptoTxnInfo.riskScore` 链上分析 + 六家厂商原始结果)不接、不展示** | 业主:「scoringResult.score 重要要展示,再上游的可以不用」。G1 已接(`sumsub-txn-client.http.ts:71`) |
| 4 | **Travel Rule 只展示二元「通过/未通过」,13 值 lifecycle 不渲染** | 业主:「TR 真实状态不用展示,只要知道通没通过」 |
| 5 | **存证颗粒度 = 乙:每腿只留最新一份 `getTxn` 全报文,后盖前**(不建历史表) | 业主:「要乙就行」 |
| 6 | **不单独拉 amlCase 明细**;证据链止于 tag(SANCTION)+ score(98)+ 报文里的 `counterpartyAmlCaseId` 引用号 | 业主:「amlCase 明细不用单独拉」 |
| 7 | **approved 也拉一次 `getTxn`**(现状为省一次 API 只在 rejected/awaitUser 拉)——否则 happy path 单无 score、无报文,证据不对齐 | 业主早前:「为什么放行和为什么冻结同样要举证」。⚠️ 本轮新增,spec review 时可否决 |
| 8 | **详情页展示 deposit 的内部审批单**:范围=**全部**(含历史/驳回),颗粒度=**仅审批单头**(不含 step) | 业主 2026-07-30 加需求 + 拍板范围/颗粒度。零 schema 改动,`entityRef=deposit.id` 反查(§3.4b) |

## 1. 数据模型

### 1.1 存证列(新增,乙口径)
deposit 加两列,各存该腿最新一次 `getTxn` 的**原始全报文** JSON 字符串(后盖前):

```prisma
model DepositTransaction {
  // ...
  financeTxnDetailJson    String?   // 最新 getTxn(finance 腿)原始报文,乙口径覆盖
  travelRuleTxnDetailJson String?   // 最新 getTxn(travelRule 腿)原始报文,乙口径覆盖
}
```

- **存全报文**(含上游厂商分等不展示字段)——「存下来」存全,「不用」只是不展示,两者不冲突。
- **含对手方 PII**(travelRuleInfo.counterparty 姓名/生日/证件)——仅 admin 可见,**绝不进客户面**(F9 `toCustomerDepositView` 白名单已挡,本轮不新增客户面字段)。

### 1.2 `kyt*` 列改名 `finance*`(与 Sumsub finance type 对齐)
仅 **deposit** 表:

| 旧 | 新 |
|---|---|
| `kytStatus` | `financeStatus` |
| `kytRiskScore` | `financeRiskScore` |
| `kytCheckedAt` | `financeCheckedAt` |
| `kytScreeningId` | `financeScreeningId`(若仍有引用;无引用则顺手删) |

- **withdraw 表不动**:它有自己的 `preKytStatus`/`postKyt` 两阶段命名,与本轮 finance-leg 模型无关,改名会误伤,排除在外。
- 血缘波及(全部 deposit 域内):`deposit-transactions.service.ts`(`updateKytStatus`→`updateFinanceStatus`)、`deposit-workflow.service.ts`(`checkAutoApproval` 读 `deposit.kytStatus`、`writeBackGateStatus`)、DTO、admin 前端映射、fixtures/specs。机械改名,单独一 task。
- **迁移**:SQLite 改列名走 `ALTER TABLE ... RENAME COLUMN`(Prisma 迁移);存量值直接带过去,无回填。

## 2. 后端:getTxn 报文落库

### 2.1 handler 存证(`deposit-kyt-verdict.handler.ts`)
现状:第 63 行 `getTxn` 读完 `typedTags` 就地丢弃。改为**读完顺手把原始报文透传给 workflow 存库**。

- 新增:handler 把 `getTxn` 的**原始 JSON**(不是归一后的 `SumsubTxnDetail`)一并带出。需让 `SumsubTxnClient.getTxn` 除返回归一 `SumsubTxnDetail` 外,附带 `raw`(原始报文对象),或新增 `getTxnRaw`。倾向前者:`SumsubTxnDetail` 加 `raw: unknown` 字段,mock/http 都填。
- workflow `applyKytVerdict` 增参 `detailRaw`,按 `lane` 写入 `financeTxnDetailJson` / `travelRuleTxnDetailJson`。

### 2.2 approved 也拉(决策 7)
`deposit-kyt-verdict.handler.ts` 的 `TAG_LOOKUP_VERDICTS` 现为 `{rejected, awaitUser}`。approved 也纳入拉取:
- approved 拉 `getTxn` → 存报文 + 落 score(现状 approved 不落 score,`writeBackGateStatus` 的 riskScore 为 null)。
- approved **不读处置 tag**(approved 无 SANCTION/dispo 语义),只取 score + 存报文。
- 代价:happy path 每单多一次 API。可接受(证据对齐)。

### 2.3 findOneForAdmin 带出报文
G4 已加 `findOneForAdmin`(带 `latestSumsubWebhook`)。本轮再带出解析后的展示子集(见 §3.3),避免前端自己解 JSON:
- 从 `financeTxnDetailJson` / `travelRuleTxnDetailJson` 解出:`verdict` / `reviewAnswer` / `scoringResult.score` / `scoringResult.matchedRules[].{id,name,action,score}` / `scoringResult.applicantActions[].applicantActionId` / typedTags / TR 二元通过。
- 原始全报文也一并返回一份(供「订单下方」原文展示)。

## 3. 详情页展示(`admin-web/src/pages/DepositTransactionDetail.tsx`)

### 3.1 状态文案改名(业主指令 #1)
`admin-web/src/utils/depositStatusMap.ts`:

| 状态 | 旧徽章 | 新徽章 |
|---|---|---|
| PAYIN_PENDING | `AWAITING PAYIN` | **`PAYIN PENDING`** |
| COMPLIANCE_PENDING | `COMPLIANCE REVIEW` | **`COMPLIANCE PENDING`** |

筛选项下拉同步(`Awaiting payin`→`Payin pending`、`Compliance review`→`Compliance pending`)。

### 3.2 L2 · Transaction Screen(业主:两组字段记 finance+tr webhook,核心 approved/rejected)
- KYT→**Finance** 改名(G2 已改展示 label,本轮随 §1.2 列改名一并对齐)。
- **Finance 行**:核心裁决(APPROVED/REJECTED/ON_HOLD/AWAITING_USER)+ `Risk: <score>`。
- **Travel Rule 行**:**二元**——`PASSED` / `PENDING` / `NOT REQUIRED`(决策 4),不显 13 值。

### 3.3 Sumsub References 字段与排列(业主指令 #3)
只保留下列字段,除 Applicant ID 外**每组三件套**:

```
Applicant ID
─────────────────────────────────────────
Finance Txn ID   │ Finance Txn status │ Received At
Travel Rule Txn ID │ TR Txn status    │ Received At
```

- status = 该腿最新裁决(approved/rejected/…);Received At = 该腿最新 webhook 到达时刻(来自 G4 的 `latestSumsubWebhook` / `sumsub_webhook_events`)。
- **删除** Manual Reason 字段(业主:「其他不用了」)。
- **删除** G4 临时加的 "Latest Sumsub Webhook" 独立卡——其信息(裁决状态 + 到达时刻)已并入此三件套。

### 3.4 getTxn 详情提取展示(业主指令 #3:risk score / actionId 等)
详情页新增一块「Sumsub Transaction Detail」(**放订单下方**,业主指令 #2),展示 §2.3 解出的子集:
- **Score**:`scoringResult.score`
- **Verdict / reviewAnswer**
- **Matched rules**:`matchedRules[].{name, action, score}`(命中了哪几条规则、各加多少分)——这是「为什么这个分」的依据
- **Applicant Action IDs**:`applicantActions[].applicantActionId`(补料动作引用)
- **原始全报文**:折叠展示(`<details>` 或等价),供 operator 需要时看全文。上游厂商分在原文里,不单列。

### 3.4b Internal Approvals(内部审批单,业主 2026-07-30 加需求)
详情页新增一块「Internal Approvals」(**放订单下方**,挨着 §3.4)。展示这单开过的**全部**审批单(所有类型、所有状态,含已通过/已驳回的历史——取证视角要留驳回记录)。

**零 schema 改动**:四种充值审批(`DEPOSIT_CONFISCATION` / `DEPOSIT_RETURN` / `DEPOSIT_SEIZE` / `DEPOSIT_UNFREEZE`)发起时全部 `entityRef = deposit.id`(`deposit-workflow.service.ts` 四处 `createAndSubmit`),`ApprovalsService.list()` 已支持 `entityRef` 过滤(`approvals.service.ts:881`),表上有 `@@index([actionType, entityRef, status])`。反查即得,不加列、不新表。

**后端**:`findOneForAdmin` 带出 `approvals: []` —— 调 `approvalsService.list({ entityRef: deposit.id })`,每条**只取审批单头**(业主定:不含 step):
- `approvalNo` / `actionType`(映射成中文/英文动作名) / `status`(DRAFT/PENDING/APPROVED/REJECTED/…) / `createdAt`
- **不带 steps**(谁批的、批语不展示)

**前端**:一行一单——动作名 + 审批号 + 状态徽章 + 发起时间,可点进审批中心(`/admin/approvals/<no>` 或现有路由)看详情。空态:「No internal approvals」。

**顺带结清 BACKLOG**:删除现有那个存 local state、刷新即丢的 `lastApprovalNo` 横幅(`DepositTransactionDetail.tsx:166/470`,BACKLOG「approval banner lost on refresh」)——改由本模块持久反查,横幅债一并结清。

### 3.5 删除大 ACTIONS 块(业主指令 #4)
详情页右侧那个通用 ACTIONS 组(Approve/Freeze/Resume/Expire/Reject/Confiscate)**删除**——不同场景的动作已由各自的按钮承载(FROZEN 的 Seize/Unfreeze、below-min 的 PASS/Confiscate、Simulation 面板)。删除后确认无状态失去唯一入口(逐状态核对:见 §5 验证)。

## 4. Fixtures:模拟全报文(业主指令 #2「你得模拟出来全部报文」)
`fixtures/scenarios.ts` 的 `primeTxn.detail` 现只有 `{txnId, verdict, reviewAnswer, riskScore, typedTags}`。补成**接近真实 `getTxn` 的全报文**,让存证与展示能真正演出来:
- 加 `scoringResult: { score, matchedRules: [{id,name,action,score}], applicantActions: [...] }`
- 加 `review: { reviewResult: { reviewAnswer, moderationComment } }`
- crypto 场景加 `travelRuleInfo: { status }`(供 TR 二元判定)
- mock `getTxn` 返回时带 `raw`(整个报文对象),供 §2.1 存库。

## 5. 验证
1. **单测**:①存证——rejected/awaitUser/**approved** 三路都断言 `financeTxnDetailJson` 落库、按 lane 分列;②改名——`financeStatus` 回写、`checkAutoApproval` 读新字段不回归;③TR 二元映射。
2. **渲染验证(项目铁律)**:真起服务 + mock 喂 S1(happy)/S3(制裁)两场景,截图比对:PAYIN PENDING / COMPLIANCE PENDING 新文案、L2 Finance+TR、References 三件套、订单下方 Transaction Detail(score+matchedRules)、**Internal Approvals**(制裁单走一次 seize/unfreeze 审批后应列出该审批单头)、大 ACTIONS 已消失、刷新后审批模块不丢。
3. **硬闸**:后端 + admin `tsc` 0;`jest` 不回归(asset-treasury/wallets 4 例 pre-existing 除外);零中文扫描(客户面文案)。
4. **客户面不泄露**:断言 `GET /deposit-transactions/my` 响应无 `financeTxnDetailJson`/`travelRuleTxnDetailJson`/PII(F9 白名单回归)。

## 6. 交付物
Prisma 迁移(rename + 2 新列)+ handler 存证 + approved 拉取 + `findOneForAdmin`(带报文子集 + `approvals[]` 反查)+ 详情页(状态文案 / L2 / References 三件套 / Transaction Detail 块 / **Internal Approvals 块** / 删 ACTIONS / 删刷新即丢横幅)+ fixtures 全报文 + 单测 + 渲染截图。

## 7. 明确不做(本轮 defer,已登记/另立项)
- **Travel Rule 真实数据交换**:右路补 `paymentTxnId`/对手方地址/链信息、左路入站应答(`ownership/confirmed` + `travelRuleOwnership`)、地址簿批量导入、`applicantKytTxnDataChanged` 订阅、mirrored 识别、13 值 lifecycle。→ 依赖合规先建 VASP 主体 + 答定制问卷(已发邮件),单独立项。
- **amlCase 直接消费**:维持 v3 KYT-only,不订阅 `amlCase*`,不拉 amlCase 明细。
- **上游风险源**:链上分析分 + 六家厂商结果,不接。
- **withdraw 的 kyt→finance 改名**:不在本轮。
- **REJECTED/EXPIRED 终态删除**:仍按前序 BACKLOG,本轮不碰。

## 8. 风险 / 待 review
- 🟡 **决策 7(approved 也拉)** 每 happy-path 单多一次 Sumsub API。若业主 review 时觉得不值,回退为「approved 不拉、happy 单无 score/报文」。
- 🟡 **改名波及面**:deposit 域 5+ 文件 + 前端 + fixtures,机械但需一次改全,漏改会 tsc 报错兜底。
- 🟡 **乙 覆盖丢历史**:改判场景(S5/S6 两次 rejected)第二份报文盖掉第一份——业主已知并选乙。若日后要回放改判,需升级为历史表(甲)。
