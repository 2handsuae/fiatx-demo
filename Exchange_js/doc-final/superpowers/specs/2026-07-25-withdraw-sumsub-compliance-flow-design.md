# 提现合规 · Sumsub 集成与状态机驱动 设计 spec

> **主题**：提现（Withdraw）全流转升级——合规审查用 Sumsub 替代现有 mock Pre-KYT/TR，状态机重写做全，四条异常弧闭环。定义 **接口调用 → webhook 返回 → 驱动提现状态机 → 状态机流转 → 施工序列** 的完整蓝图。
> **日期**：v1 2026-07-25（两笔提交/两路取最强/含 CREATED+CANCELLED）/ **v2 2026-08-03**（对齐充值 §4.5 单笔提交模型；业主逐边检查后状态机修订：删 CREATED、ACTION_PENDING 三线直落、解冻回炉定 COMPLIANCE_PENDING；费腿三级处置梯（无豁免）；STUCK=旗子非状态；三岔口拍板：镜像模块/VASP 地址推导/FROZEN 双审批）
> **状态**：设计（未实现）　**范围**：仅提现域；仅个人客户（无公司/KYB）。
> **血缘**：充值 spec [2026-07-23-deposit-sumsub-compliance-flow-design.md](2026-07-23-deposit-sumsub-compliance-flow-design.md)（v3 KYT-only）+ **落地形态以 [truth/v4-deposit.md](../../reference/truth/v4-deposit.md)（Last Verified 2026-08-03）为准**——充值实际落地已超过其 spec（单笔提交 §4.5 / 状态机收窄 ⑳ / 四条动钱弧），本文对齐的是落地形态。
> **配套图**：提现单 Lark PRD（MUE3dJAmCoJ0xKx77P3l73Ltgye）附录 B（状态机画板）、附录 C（调用与 webhook 时序画板）——⚠️ 附录 B/C 尚为 v1 口径（两笔提交/含 CANCELLED 已由业主手改、其余待随本 v2 更新）。

---

## 0. 与充值共享的底座（引充值 spec/truth，不重复）

- **KYT-only 单闸**：只订阅 `applicantKytTxn*`，`amlCase*`/`kytCaseV2*` 不消费——对手方筛查由 Sumsub AML 规则**折叠**进交易裁决；case 未决押 onHold 不误放；case 解决自动重算补发终裁。**硬前提：AML 动作规则全开当折叠器。**
- **消费铁律**：只认 `Approved`/`Rejected` 路由（成对带 `Reviewed`，陪跑可忽略）；幂等按 `kytTxnId + reviewResult` 去重抗重投；handler state-aware 已终态 no-op；payload 自带 `reviewStatus` 直接读；pending 静默禁用作信号；tag 是载荷不是事件。⚠️ 官方命名坑：`applicantKytOnHold` **没有 Txn**（充值踩过，router 抄修正后的版本）。
- **officer 全在 Sumsub**：零手工流转按钮、零轮询；控制台不能对已 rejected 直接再 Reject，处置须 先 onHold → 加 tag → 再 Reject。
- **tag 预注册**：场景 tag `SANCTION`/`PEP`（规则自动打）沿用充值已注册的；处置 tag 提现新增 **`REJECT_REFUND`**（充值对应位是 `RETURN_TO_SENDER`，语义不同故分开注册），`FROZEN_BY_MLRO` 沿用。
- **迟到 webhook 防护**（充值 ⑯ 教训）：FROZEN 单收到迟到/重评 `approved`，闸门回写 + 报文存证一并跳过，防制裁证据被无声覆写。
- **本人（applicant）命中不在本范围**：走 `applicantReviewed` 客户级冻结（onboarding/compliance 状态门）。

## 1. 提现与充值的根本分野：不可逆分界线

| | 充值（IN）| 提现（OUT）|
|---|---|---|
| 钱何时不可逆 | **到账即不可逆** | **广播/发汇才不可逆**；此前钱始终锁在客户名下（TB pending）|
| 发现问题时拦截 | 只能 FROZEN（绝不退制裁方）| 发款前一律 **REJECTED 解锁退回**（void pending，crypto 同样适用）|
| 跨线后异常 | — | FAILED（未发出→退回）/ RETURNED（发出弹回→重入账）/ 异步 RED（仍 SUCCESS＋客户级 case）|

**不可逆点 = PAYOUT_PENDING 的广播/发汇。** 全部合规压在此点之前；提现无 Step1/Step2 两段记账——只有 创建即锁（net+fee 双 pending）→ post（成功）/ void（拦截，走现有 `releaseLock()`）。

## 2. 接口调用（单笔提交模型，对齐充值 §4.5）

- **提交时点**：进 COMPLIANCE_PENDING 时提交（大额门之后；大额审批在我方系统内，不涉 Sumsub）。
- **单笔 + 判定器**（复用充值 `resolveKytTxnType()` 纯函数，direction=out）：`crypto ∧ 收款方 VASP ∧ 金额≥阈值` → `travelRule`，否则 `finance`。阈值沿用同一写死常量（`USDT=1000 / AED=3500`，同一条 VARA 线，不可配）。**无「两笔提交/两路取最强」**（v1 口径作废）。
- **counterpartyIsVasp 从提现地址推导（岔口 2，已验证）**：`withdrawal_addresses.addressType`（登记时经 `TravelRuleAdapter.attributeAddress()` 归因写入 `'VASP' | 'SELF_CUSTODY'`，另有 `counterpartyVaspName/Did`）→ `counterpartyIsVasp = (addressType === 'VASP')`。零客户输入、零模拟弹窗（比充值干净——充值靠客户端弹窗模拟归属）。当前 adapter 是 mock（尾号 1111 判 VASP），字段合同真实，真归因服务接上后免费升级（BACKLOG 既有项）。
  - **连带收口安全缺口 task_20678a2c**：推导要求创建时能查到地址记录 → 提现创建**必须引用已登记 ACTIVE 提现地址**（此前后端裸奔、仅前端过滤），本轮一并关闭。
- **TR 角色**：我=originator，TR 报文我方发起；unhosted 走受益人自声明分支。
- **看门狗两只**（仅有的定时器）：① 提交后 N 分钟未收 `applicantKytTxnCreated` 回执=丢单告警重提（幂等）；② onHold 超 SLA / ACTION_PENDING 7d → MANUAL_CHECKING。
- **L3 归档**：SUCCESS 后 `PATCH /kyt/txns/{id}/data/info` 回写真实 txHash（现 `archivePostKyt()` stub 换真，仅 crypto）。
- **数据模型**（对齐充值七列命名；老列 `preKyt*`/`kyt*`/`travelRule*` 删除）：`sumsubTxnId` / `sumsubTxnType` / `sumsubVerdict` / `sumsubScore` / `sumsubScoredAt` / `sumsubTxnDetailJson` / `counterpartyIsVasp`；另 `manualReason` / `slaDeadline` / `slaBreached` / `needsReview` / 处置审批引用。
- **`SUMSUB_SINGLE_TXN_SUBMIT` 同款硬前提**：真实租户须先确认规则作用域挂 `types:["finance","travelRule"]` 才开；`SUMSUB_MOCK_MODE=true` 隐含开启（同充值）。
- **存证口径**（同充值）：`approved/rejected/awaitUser/onHold` 四态都拉 `getTxn` 存 `sumsubTxnDetailJson`；仅 `rejected`/`awaitUser` 读 tag。

## 3. webhook → 状态机驱动（单闸 + 场景 tag 分流）

| KYT verdict | 场景 tag | 提现动作 |
|---|---|---|
| approved | — | 创建 payout 两腿 → **PAYOUT_PENDING**（广播，跨不可逆线）|
| awaitUser | `PEP` / 一般 | **ACTION_PENDING**（PEP→收 SOF；crypto→钱包所有权/TR 信息）；SLA 7d |
| onHold | — | **非转移边**：原地留 COMPLIANCE_PENDING，只刷 `slaDeadline` + 审计；超 SLA → MANUAL_CHECKING |
| rejected | `SANCTION` | **FROZEN**（法定停单，免审批——收紧方向）|
| rejected | 无场景 tag | **MANUAL_CHECKING** |

**Rejected handler（凡 rejected 先拉 txn 读 tag，不分首次）**：

```
收到 Rejected（幂等去重后）：
  拉 txn 读 userDefined tags 分流：
    SANCTION（场景）      → FROZEN（幂等已冻 no-op）
    FROZEN_BY_MLRO（处置）→ FROZEN
    REJECT_REFUND（处置） → REJECTED：void 双 pending 解锁退回（officer tag 驱动，免审批）
    无 tag                → 置/保持 MANUAL_CHECKING 留守
收到 Approved 且在 MANUAL_CHECKING → 误报翻案 → PAYOUT_PENDING
收到 Approved 且在 FROZEN → no-op + 跳过证据回写（出 FROZEN 只走 §4 审批弧）
```

## 4. FROZEN 语义与处置弧（岔口 3：两出口都 maker-checker，两种审批类型）

- **单级 FROZEN = 制裁命中排查/申诉停车位**（假阳性 95%+）；进入免审批（法定即时、收紧方向），**出去必须过审批门**：
  1. **解冻回炉** `WITHDRAW_UNFREEZE`（MLRO 单步，解冻令 `orderRef` 必填）：admin `Initiate Unfreeze` → 审批 APPROVED → `resume` 推 **COMPLIANCE_PENDING**（**绝不直达 PAYOUT_PENDING**——解冻批的是「重新筛」不是「放款」，放行凭证只能是新鲜 KYT Approved）→ 触发 `rescore(sumsubTxnId)` 驱动重评（try/catch，失败只 warn 不回滚——充值 I2 教训）。零记账（钱一直锁着）。
  2. **坐实退回** `WITHDRAW_SANCTION_REFUND`（MLRO 单步，理由必填）：admin `Initiate Refund` → 审批 APPROVED → `reject_refund` 推 REJECTED + void 双 pending 解锁退回；客户牵连 → 另落审计升级 V2 冻户（V2 freeze API 缺失为既有 BACKLOG，本轮只审计+人工）。
  - 两条出口互补：`resume` 走误报/除名（重筛能过），`reject_refund` 走真命中（重筛必然又冻回来、死循环，故必须有直达了结口）——充值 FROZEN `resume`/`seize` 两出边的提现同构体（无可缴，了结动作=退回）。
- **刻意的不对称**：MANUAL_CHECKING 的 `reject_refund` 是 officer tag 驱动**免审批**（一般脏、officer 在 Sumsub 已裁）；FROZEN（制裁案）的两出口才上 maker-checker。
- **订单无 SEIZED/SEIZING/CONFISCATING**：上缴/没收属客户资产级——已发出的钱不在我托管（无可缴），未发出的钱属于客户（缴的是账户不是单）。
- 复刻充值范式：`initiate*()` 只读校验+防重复+开审批 case 不写单表（Rule 5）；`ApprovalDecidedEvent.metadata` 恒空 → `fetch*OrderRef()` 从 APPROVED 案 `objectSnapshot` 回读；guard-before-mutate；decided 监听 DECLINED/CANCELLED/EXPIRED 只留日志原地不动。

## 5. 状态机（终版，业主 2026-08-03 逐边检查定稿：10 状态 / 20 边）

### 状态

| 状态 | 类型 | 钱 | 等谁 |
|---|---|---|---|
| PENDING_APPROVAL | 入口之一 | 出生即锁 net+fee | SMO（≥20万 AED，估值失败 fail-closed 也进）|
| COMPLIANCE_PENDING | 入口之一/枢纽 | 已锁 | Sumsub KYT 终裁；onHold 原地刷 SLA |
| ACTION_PENDING | 等待 | 已锁 | 客户（SOF/所有权/TR 信息）；SLA 7d |
| MANUAL_CHECKING | 人工 | 已锁 | officer 在 Sumsub 调查处置 |
| FROZEN | 半终 | 保持锁定 | 排查/申诉（出口双审批，§4）|
| PAYOUT_PENDING | 在途 | **钱已出**（跨线）| 链上/银行确认 |
| SUCCESS / REJECTED / FAILED / RETURNED | 终态 ×4 | 见下不变量 | — |

- **无 CREATED**（2026-08-03 删：撤销取消后其全部职责是创建时刻同步动作，不回答「等谁」——订单出生即着陆两入口之一）。**无 CANCELLED**（不提供客户撤销，v1 已定）。**无 UNDER_REVIEW/HELD**（被 MANUAL_CHECKING/FROZEN 取代，转历史兼容）。
- **终态不变量**（充值收窄同款判据）：每个终态答得出「钱去哪了」——SUCCESS=到收款方｜REJECTED/FAILED=解锁退回可用余额｜RETURNED=重入账退回。
- **STUCK 不是状态**：`needsReview` 旗子 + `*_STUCK` 审计 + admin 待修队列（swap/充值处置腿同款）；状态机记「走到哪」，旗子记「顺不顺」。

### 转移（20 边逐条；动作命名对齐充值 `sla_breach`/`kyt_rejected` 拆分成因）

```
[*] ─(≥20万AED，估值fail-closed同)→ PENDING_APPROVAL
[*] ─(低于阈值)→ COMPLIANCE_PENDING

PENDING_APPROVAL
  gate_approve   → COMPLIANCE_PENDING   ← SMO 批准
  reject         → REJECTED             ← 否决/超时，void 解锁退回

COMPLIANCE_PENDING（提交 Sumsub 单笔，等首裁）
  approve        → PAYOUT_PENDING       ← KYT approved（唯一跨线入口）
  action_pending → ACTION_PENDING       ← awaitUser
  kyt_rejected   → MANUAL_CHECKING      ← rejected 无 tag
  sla_breach     → MANUAL_CHECKING      ← onHold 超时（onHold 非边）
  freeze         → FROZEN               ← rejected + SANCTION tag

ACTION_PENDING（补料后新裁决直接着陆，不回炉——业主 2026-08-03 定）
  approve        → PAYOUT_PENDING       ← 重裁 approved
  kyt_rejected   → MANUAL_CHECKING      ← 重裁 rejected 无 tag
  freeze         → FROZEN               ← 重裁 rejected + SANCTION / FROZEN_BY_MLRO
  sla_breach     → MANUAL_CHECKING      ← 7d 未完成（定时器）

MANUAL_CHECKING
  approve        → PAYOUT_PENDING       ← officer Approve 翻案
  action_pending → ACTION_PENDING       ← officer 发 link
  freeze         → FROZEN               ← FROZEN_BY_MLRO tag
  reject_refund  → REJECTED             ← REJECT_REFUND tag（免审批）

FROZEN
  resume         → COMPLIANCE_PENDING   ← WITHDRAW_UNFREEZE 审批 + rescore
  reject_refund  → REJECTED             ← WITHDRAW_SANCTION_REFUND 审批

PAYOUT_PENDING
  success → SUCCESS ｜ fail → FAILED ｜ return → RETURNED
```

守则性测试同充值：20 边逐条断言 + 穷举反向（10×动作 组合中不在名单的一律必须抛）+ 总数断言。
动作枚举复用度：`require_approval(入口)/gate_approve/reject/approve/success/fail/return` 现有枚举已有；新增 `action_pending/kyt_rejected/sla_breach/freeze/reject_refund/resume`；`FLAG/CANCEL/CHECK` 废弃转历史兼容。

## 6. 资金腿（PAYOUT_PENDING 内两腿的失败语义）

**单的状态跟着本金腿走；费腿永远不配决定单的生死。**

- **本金腿（legSeq=1，真实外部穿越）FAILED/TIMEOUT** → 整单 FAILED + `releaseLock()` void 双 pending 退回（现有 P6 路径，保留）；费腿随之作废。
- **顺序铁律（新增守卫）**：**费腿不得先于本金腿结算**（照抄 swap sell-first）。本金失败时费必然还是 pending，void 即完事——「退费冲正」这类分录永不存在。
- **费腿（legSeq=2，纯内部表示）失败三级梯（无豁免——业主 2026-08-03 定）**：
  1. 自动重试 ×3（幂等，`already_posted` 赦免兜半截结算）；本金未确认时费腿单坏 → void+重建新 attempt（充值 A3 rebuild 模式）；
  2. 耗尽 → `WITHDRAW_FEE_SETTLE_STUCK` 审计 + `needsReview` 旗，单留 PAYOUT_PENDING；
  3. operator 修根因 → Retry settlement 重跑 → post → CLEARED → SUCCESS。
  - **无「豁免手续费」出口**：豁免会造出「订单记费 5 实收 0」的流水谎言 +「SUCCESS 单挂 void 腿」的账面谎言；且费腿动的就是本金腿刚 post 成功的同一对账户，永久失败不是真实场景——逃生门是修复不是原谅。
- **现状真缺口**（实施必修）：`handleFundsOrderChanged()` 的 FAILED/TIMEOUT 分支只处理 legSeq=1，**费腿失败零 handler**——现状会无声挂死。
- **RETURNED 覆盖口径**：仅覆盖「SUCCESS 之前弹回」；SUCCESS 后退汇（T+1 银行退回）不回改订单状态，走对账异常 + 客户资产层入账（同充值「法币 bounce 未建模」的处置位，明示留档）。
- **`assertWithdrawSettled()` fail-closed 门保留**：三笔 TB 分录不齐不许 SUCCESS。
- **结算收口**：payout/fee 腿结算后推资金单 CLEARED（充值 2026-08-02 `clearDispositionLeg()` 教训——「资金单本身也是状态机」别漏第四件事）。

## 7. 锁定决策（v2 全集）

1. **唯 KYT `Approved` 可跨不可逆线放款**；`Created`/`OnHold`/`AwaitingUser` 一律押住（提现人命线）。
2. **发款前拦截一律 REJECTED 解锁退回**，crypto/fiat 同（与充值相反，理由=钱未离开平台）。
3. **单笔提交模型**（对齐充值 §4.5）：判定器二选一；`counterpartyIsVasp` 从提现地址 `addressType` 推导；连带关闭「提现地址不校验登记」缺口。
4. **FROZEN 两出口都 maker-checker，两种审批类型**（业主 2026-08-03）：`WITHDRAW_UNFREEZE`（→回炉+rescore）/ `WITHDRAW_SANCTION_REFUND`（→退回）；解冻**绝不直达 PAYOUT_PENDING**。MANUAL_CHECKING 的 tag 退回免审批（刻意不对称）。
5. **无 CREATED/无 CANCELLED/无客户撤销**；ACTION_PENDING 新裁决直接着陆不回炉；onHold 非转移边。
6. **STUCK=旗子非状态**；费腿失败三级梯无豁免；费腿不得先于本金结算。
7. **广播后异步 RED**：本单仍 SUCCESS，另开客户级 case（STR + V2 冻户）；法币 recall 成功走 RETURNED。
8. **大额门保持现状**（PENDING_APPROVAL 状态保留——处置类审批不占状态，流水线强制串行闸配得上状态；充值 OPERATION_PENDING 同理）。
9. **模块策略（岔口 1·乙）**：镜像建 `withdraw-sumsub/`，dispatch 加薄共享层（`kytTxnId` 先查 deposit 再查 withdraw，谁命中路由给谁）；不动刚稳定的充值模块，只抽零风险纯函数/常量。
10. **终态不变量**：每个终态必须回答「钱去哪了」（充值收窄同款判据，4 终态全过）。

## 8. 与现状代码差距 + 施工序列

### 差距清单（truth/v5-withdraw.md 对照）
- `initializeTransactionScreen()`/`checkScreenPass()` mock → 真 Sumsub 单笔提交；收敛条件改「KYT 终裁 approved」。
- withdraw 表七列迁移（删 `preKyt*`/`kyt*`/`travelRule*`）；提现创建加「已登记 ACTIVE 地址」校验。
- 新状态落位（MANUAL_CHECKING/FROZEN/ACTION_PENDING）+ 老枚举转历史兼容；转移表重写+守则性测试。
- 费腿失败 handler + 顺序守卫；RETURNED 弹回入口；`archivePostKyt()` 换真。
- 两个审批 handler service（`WITHDRAW_UNFREEZE`/`WITHDRAW_SANCTION_REFUND`，V1 引擎）。
- admin：状态映射表 + 详情页 9 区块（照充值：Hero/Transaction Details/Compliance 两卡/Sumsub References/Transaction Detail/Internal Approvals/Linked Funds Orders/Status History/⚡Simulation）+ Frozen Disposition 组；client：脱敏映射表（FROZEN/MANUAL_CHECKING → 与 COMPLIANCE_PENDING 逐字段一致的 PROCESSING，充值 2026-08-02 口径）+ 违禁词单测。
- `toCustomerWithdrawView()` 白名单裁剪（tipping-off 数据层，充值 Fix 1 同款）。
- demo：`SUMSUB_MOCK_MODE` 门控的 withdraw demo-scenario service + Simulation 面板（9 按钮镜像充值、去 below-min 项）。

### 施工序列（六段，每段独立绿灯）
```
A 状态机地基   新枚举+转移表+守则性测试；老动作转历史兼容（老 mock 暂存活）
B Sumsub 引擎  七列迁移 → 判定器(out+地址推导+登记校验) → submit → 双域分发薄层
              → WithdrawKytVerdictHandler + applyKytVerdict → SLA cron → 老 mock 退役（本段末刀）
C 资金腿硬化   顺序守卫 + 费腿失败三级梯 + RETURNED 入口 + L3 真调用 + 腿 CLEARED 收口
D FROZEN 处置  两审批门（复刻充值 A2/A5 范式）+ decided 监听 + 执行侧 + rescore
E 前端双端     admin 映射表/详情页/Simulation ｜ client 脱敏收敛
F e2e 收官     money-arcs e2e（本金失败P6/费腿卡死/冻结退回/解冻回炉）+ 场景 e2e
              + verify:coa + 真机渲染截图验证（Task-8 式）
```
顺序讲究：A 先行（B 的 handler 落新转移表）；mock 退役刀在 B 段末（否则 A/B 之间流程断裂）；C/D 可并行；F 必须真机渲染。

### 直接复用的充值资产
webhook 去重/重试管道（sumsub-ingestion 原封）｜ router 修正版（`applicantKytOnHold` 命名坑）｜ `resolveKytTxnType`/`VERDICT_BY_TYPE`/tag 解析（抽共享纯函数）｜ `already_posted` 幂等赦免 ｜ `toCustomerView` 白名单手法 ｜ 违禁词单测 ｜ 9 区块详情页结构 ｜ demo-scenario 模式 ｜ FROZEN 迟到 webhook 证据保护 ｜ `fetch*OrderRef` 回读范式 ｜ I2 try/catch 教训（submit/rescore 外部调用失败不 strand 单子）。
