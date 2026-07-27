# 充值单全状态机落地 — 实施设计 spec

> **主题**:落地充值单全状态机流转。干净重设计 Sumsub 接入,全程 mock fixture 驱动,不依赖真 Sumsub 跑测试。
> **日期**:2026-07-25　**状态**:设计(未实现)
> **语义来源**:合规流转语义以 [`2026-07-23-deposit-sumsub-compliance-flow-design.md`](./2026-07-23-deposit-sumsub-compliance-flow-design.md)(v3, KYT-only)为准;本文只管**怎么落地代码 + 怎么仿真测试**。
> **置信度**:✅ 实测 / 📄 文档 / 🟡 设计推断。

## 0. 范围与关键决策(脑暴已确认)

- **范围**:引擎 + 动钱弧,**不含前端**(admin 处置 UI / 客户面后续单独做)。
- **仿真路线**:**全 mock fixture** 驱动测试(不调真 Sumsub);真 SumsubClient impl 做全 + 一次性沙盒冒烟(不进 CI)。理由:沙盒**造不出对手方 sanctions/pep 命中**(✅ 三向实测),合规关键支只有 mock 造得出。
- **接入重设计**:**跳出老 `dispatch()`**,新建干净的充值 Sumsub 接入子模块;老 `sumsub-ingestion/` 继续服务 withdraw/swap,一行不动(deposit-only 迁移)。
- **消费模型**:KYT-only —— 只认 `applicantKytTxn*`,忽略 `amlCase*`(靠规则折叠进 KYT + case 未决押着 + case 解决自动重算,见 v3 spec §5.1)。

## 1. 架构:三块物理分开(落实"驱动边界")

按"跟 Sumsub 的关系"分三块,代码物理隔离:

```
① 出站 SumsubClient(我方拨出去)
   submit(deposit)→txnId ｜ getTxn(txnId)→{verdict, typedTags} ｜ rescore ｜ reviewComplete
   ├─ 真 impl(HTTP,生产;沙盒冒烟验证)
   └─ mock impl(喂 fixture,测试)

② 入站 接收+翻译(收 Sumsub 的信)· 全新干净
   POST /webhooks/sumsub → 签名验证 → 记 durable 事件(复用 SumsubWebhookEvent:去重/retry/dead-letter)
   → 【强类型 handler 路由】(取代老 if/else dispatch)
        applicantKytTxn{Approved/Rejected/AwaitingUser/OnHold/Reviewed} → DepositKytVerdictHandler
        applicantActionReviewed/Pending                                → DepositActionHandler
        applicantKytTxnCreated                                         → 回执对账
   → 映射(applicantId + txnRef → deposit.sumsubTxnId)→ 调 ③ 的 workflow 方法

③ 自系统 状态机 + 动钱(不碰 Sumsub)
   deposit-workflow(状态机)｜ 动钱弧(审批+两腿 post+重试)｜ SLA 定时器
```

**驱动边界(= 合规 spec 的"点 1"):**
- **Sumsub 驱动**:命中判定 & officer 处置信号 → 走 ①②(webhook + 回拨读 tag)。
- **自系统**:动钱执行 & 审批 & 记账 & 定时 → 全在 ③,handler 碰不到钱。

**复用 vs 新建:**
- **复用**:`SumsubWebhookEvent` 表 + 签名验证 + 去重/retry/dead-letter(成熟持久事件日志,不重建)。
- **新建**:其上的强类型 handler 路由层(取代老 dispatch)+ SumsubClient 接口 + 场景仿真器,独立子模块 `deposit-sumsub/`。

## 2. 入站翻译映射(每封信 → 哪个状态移动)

充值单提交后停在 **COMPLIANCE_PENDING**。

**A. 首评(在 COMPLIANCE_PENDING 收到):**
| webhook | 翻译 | 移动 |
|---|---|---|
| Approved | 通过 | 运营闸 → 达标 SUCCESS / 小于最小 → 没收 |
| AwaitingUser(+PEP tag) | PEP,要 EDD | ACTION_PENDING(下发 pep 问卷) |
| AwaitingUser(一般) | 要客户操作 | ACTION_PENDING |
| OnHold | Sumsub 人工排队 | 原地留 + SLA 计时器,超时→MANUAL_CHECKING |
| Rejected + SANCTION tag | 制裁 | **直接 FROZEN** |
| Rejected + 无处置 tag | 有问题 | MANUAL_CHECKING |

**B. 客户补完料**:Sumsub 自动重算 → 发新审查信 → **按 A 表再翻译一遍**。

**C. officer 处置后(在 MANUAL_CHECKING 收到):**
| webhook | 翻译 | 移动 |
|---|---|---|
| Approved(翻案) | 误报放行 | 运营闸 → SUCCESS |
| Rejected + FROZEN_BY_MLRO tag | 冻结 | FROZEN |
| Rejected + RETURN_TO_SENDER tag | 退回 | 起退回审批 → RETURNING |
| AwaitingUser | 要材料 | ACTION_PENDING |

**D. 忽略**:`Reviewed`(陪跑,只认 Approved/Rejected)、`Created`(回执对账,不改状态)。

**关键机制:标签不在信里,得回拨读。** 收到 Rejected/AwaitingUser 时,handler 让 ① 打 `getTxn` 把交易拉回,读 `typedTags` 才能准确分流(SANCTION / PEP / 处置标签)。

## 3. 场景 fixture 清单(覆盖第 2 段每条边)

每场景 = ① mock 电话应答(submit 返回哪个 txnId、getTxn 返回啥)+ ② 投的信序列。

| # | 场景 | 投信序列 | getTxn 应答 | 终态 |
|---|---|---|---|---|
| S1 | 法币直通 | Created → Approved | approved | SUCCESS |
| S2 | 虚拟币通过(2笔) | Created×2 → Approved×2 | 都 approved(组合取最强) | SUCCESS |
| S3 | 对手方制裁 | Created → Rejected | rejected, [SANCTION] | FROZEN |
| S4 | PEP 补料放行 | Created → AwaitingUser →(补料)ActionReviewed(GREEN)→ 重算 Approved | 先 awaitUser+[PEP];后 approved | ACTION_PENDING → SUCCESS |
| S5 | 脏钱→人工→冻结 | Created → Rejected →(officer)Rejected | 先无tag;后 [FROZEN_BY_MLRO] | MANUAL_CHECKING → FROZEN |
| S6 | 脏钱→人工→退回 | 同 S5,officer 那封 | [RETURN_TO_SENDER] | MANUAL_CHECKING → RETURNING → RETURNED |
| S7 | 脏钱→人工→误报翻案 | Created → Rejected →(officer)Approved | 先无tag;后 approved | MANUAL_CHECKING → SUCCESS |
| S8 | 小额,合规过但没收 | Created → Approved | approved,金额<最小 | 运营闸 → CONFISCATING → CONFISCATED |
| S9 | onHold 超时 | Created → OnHold →(拨快时钟) | onHold | 原地等 → MANUAL_CHECKING |

候选补充(实施时定):S2b 虚拟币 travelRule 被 Crystal 判高危(finance approved + tr rejected → 组合取最强 = reject)。

**诚实点:** S3-S6 的 SANCTION/PEP/处置标签是**构造保真**(沙盒逼不出真命中);其余信形状是实捕逐字。S9 超时用**可注入假时钟**,不真等。

## 4. 动钱弧(自系统,admin 触发)· 复刻现成没收骨架

统一骨架 = **先审批 → 进在途态 → 锁两腿 pending → post 结算 + 重试**(C1-C5 已跑通):

| 弧 | 触发 | 事前审批 | 在途态 | 两腿(钱从→到) | 失败 |
|---|---|---|---|---|---|
| 冻结 | SANCTION webhook / FROZEN_BY_MLRO | ❌ 免(收紧,自动) | 无(单步) | SUSPENSE → CLIENT_BLOCKED | 单步重试 |
| 退回 | RETURN_TO_SENDER | ✅ MLRO 双人 + FIU | RETURNING | SUSPENSE → 外部出金 | 停在途重试,不回滚 |
| 上缴 | admin(政府令) | ✅ 政府令验证 + 双人 | SEIZING | CLIENT_BLOCKED → 政府账 | 停在途重试 |
| 没收(已有) | 运营闸 below-min | ✅ OPS 双人 | CONFISCATING | SUSPENSE → FIRM_FEE | 3 重试(现成) |
| 解冻回炉 | admin(除名/EOCN 令) | ✅ 双人 | 无 | CLIENT_BLOCKED → SUSPENSE | 后调 rescore 重跑 |

**时序(退回/上缴 照没收"先批后动"):** 收 RETURN 标签 → 留人工校验 + 起审批单 → 批准+FIU → RETURNING(锁出金腿 pending)→ 出金广播确认 → post → RETURNED;驳回 → 回人工校验。
**取向:** 动钱=敏感必留痕可失败 → 全两腿 pending→post + 失败停在途重试(不回滚/不跳终态);**冻结唯一免审批**(收紧可逆,放钱才审批)。

## 5. 错误处理

| 问题 | 因为 | 兜底 |
|---|---|---|
| 重复收信 | Sumsub 失败重投同一封 | 幂等:`交易id+结果` 去重(事件表 + handler 双层),第二封 no-op |
| 信乱序 | 异步 | handler state-aware:看当前状态再动,已终态 no-op;信自带 reviewStatus 不靠上一封 |
| 丢信 | 提交后没 Created | X 分钟未到 → 拉 getTxn 对账 + 告警 |
| 慢 case | case 未决 | Sumsub 押 onHold 不提前放,决了自动重算补发;兜底 onHold 超 SLA → 人工 |
| 动钱 post 失败 | 广播失败 | 停在途重试 3 次,再败停住 + 告警;不回滚不跳终态 |
| handler 抛错 | bug/DB 冲突 | 现成 retry 3 → DEAD 死信 + 告警 |
| 认不出这笔 | txnId 无对应单 | 记 orphan + 告警,不静默丢 |

## 6. 测试策略

1. **单元(TDD)**:每 handler 翻译、运营闸、动钱记账 —— mock SumsubClient。
2. **场景 e2e(§3 的 9 个)**:mock 应答 + 投信 → 跑全状态机 → 断言 终态 + 两腿守恒 + 审计日志。
3. **动钱弧 e2e**:admin 触发退回/上缴/解冻 → 在途态 + 两腿 post + 失败重试。
4. **幂等/乱序**:重复投、乱序投 → no-op / 正确落位。
5. **沙盒冒烟(一次性,非 CI)**:真 submit + happy webhook 真投 + 手工冻结一遍 → 证明真线通。
6. **硬闸**:`tsc` 0、`jest` 绿、`verify:coa` 两腿守恒、审计日志覆盖。

## 7. 数据模型改动

- **状态 enum**(`deposit-transaction.dto.ts`):**新增** MANUAL_CHECKING / RETURNING / RETURNED / SEIZING / SEIZED / CONFISCATING;CONFISCATED 已有;**弃用** REJECTED(由 RETURNED 取代);FAILED/EXPIRED 技术态保留。
- **字段**:`sumsubFinanceTxnId` / `sumsubTravelRuleTxnId`(出站映射)、`manualReason`、`slaDeadline·slaBreached`、动钱审批引用。(部分已在,实施核对。)
- **COA 科目**:退回的"外部出金账"、上缴的"政府账"COA 里**可能缺**,需新增;SUSPENSE/CLIENT_BLOCKED/FIRM_FEE 现成。实施核 `accounting-coa.md`。
- **规则**:命中 5 条不可违反(审计走 `AuditLogsService` DI、多表变更用事务、业务键查询、不绕合规门、workflow 经 service 不直写表)。

## 8. 未决 / 风险(诚实)

- 🟡 **"慢 case 自动重算补发"**是 KYT-only 根基,**e2e 只能 fixture 断言、沙盒冒烟也覆盖不到**——本设计**唯一无法自动化验证**的假设。上线前用真慢 case / Sumsub 测试数据验一次。
- 🟡 **SANCTION/PEP 场景标签靠规则打**(v3 spec §2),沙盒验不了;替代=读 scoringResult 命中规则名。
- 🟡 退回/上缴 COA 科目待定;FIU 同意(退回)UAE 对等机制待核。
- 本设计**不含前端**;officer 处置全在 Sumsub 控制台(onHold→tag→reject),我系统只收 webhook。

## 9. 交付物(本次)

`deposit-sumsub/` 子模块(接收+handler+SumsubClient 真/mock)+ 状态 enum/字段迁移 + 动钱弧(RETURNING/SEIZING + 解冻,复用 CONFISCATING)+ 9 场景 fixture + e2e + 沙盒冒烟脚本。**不含**前端。
