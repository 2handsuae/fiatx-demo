# 提现合规 · Sumsub 集成与状态机驱动 设计 spec

> **主题**：提现（Withdraw）合规审查用 Sumsub 替代现有 mock Pre-KYT/TR。定义 **接口调用 → webhook 返回 → 驱动提现状态机 → 状态机流转** 的完整闭环。
> **日期**：2026-07-25　**状态**：设计（未实现）　**范围**：仅提现域；仅个人客户（无公司/KYB）。
> **血缘**：充值 spec [2026-07-23-deposit-sumsub-compliance-flow-design.md](2026-07-23-deposit-sumsub-compliance-flow-design.md)（v3 KYT-only）——webhook 实测矩阵、消费铁律、折叠机制、officer 处置协议**全部复用**，本文只写提现差异，不重复充值已实测的内容。
> **配套图**：提现单 Lark PRD（MUE3dJAmCoJ0xKx77P3l73Ltgye）附录 B（状态机终版画板）、附录 C（调用与 webhook 判断时序画板）。

---

## 0. 与充值共享的底座（引充值 spec，不重复）

以下机制与充值 spec v2/v3 完全一致，提现直接沿用：

- **KYT-only 单闸**：只订阅 `applicantKytTxn*`，`amlCase*` / `kytCaseV2*` 不消费——对手方（收款方）筛查结论由 Sumsub AML 规则**折叠**进交易裁决；case 未决期间交易被 onHold 押住不误放；case 解决后 Sumsub 自动重算补发终裁（充值 spec §5.1）。**硬前提：AML 动作规则全开当折叠器，别关。**
- **webhook 实测矩阵**（充值 spec §4.1）与**消费铁律**（§4.2）：只认 `Approved`/`Rejected` 路由（成对带 `Reviewed`，Reviewed 陪跑可忽略）；幂等按 `kytTxnId + reviewResult` 去重抗重投；handler state-aware 已终态 no-op；payload 自带 `reviewStatus` 直接读；pending 静默禁用作信号；tag 是载荷不是事件。
- **officer 全在 Sumsub**：零手工流转按钮、零轮询；控制台不能对已 rejected 直接再 Reject，处置须 先 onHold → 加 tag → 再 Reject。
- **场景标签**（规则自动打，须预注册）：`SANCTION`（sanctions 命中→交易 rejected + 此 tag）/ `PEP`（pep 命中→awaitUser + EDD action + 此 tag）。
- **本人（applicant）命中制裁/PEP 不在本范围**：走 `applicantReviewed` 客户级冻结（onboarding/compliance 状态门），不折进交易 KYT。

## 1. 提现与充值的根本分野：不可逆分界线

| | 充值（IN）| 提现（OUT）|
|---|---|---|
| 钱何时不可逆 | **到账即不可逆**（链上已发生）| **广播/发汇才不可逆**；此前钱始终锁在客户名下（TB pending），从未离开平台 |
| 发现问题时拦截 | 只能 FROZEN（绝不退制裁方）| 发款前一律 **REJECTED 解锁退回**（void pending，crypto 同样适用——与充值相反）|
| 拦截要不要审批 | 退回=钱出平台（松方向）→ 须 MLRO+FIU | 退回=解锁客户自己的钱（紧方向）→ **免事前审批** |
| 跨线后异常 | — | FAILED（未发出→void 退回）/ RETURNED（发出弹回→重入账）/ 异步 RED（仍 SUCCESS＋客户级 case）|

**不可逆点 = PAYOUT_PENDING 的广播/发汇动作。** 全部合规压在此点之前，故提现无充值的 Step1/Step2 两段记账——只有 创建即锁（net+fee 两笔 pending）→ post（成功）/ void（拦截）。

## 2. 接口调用（direction=out）

- **提交时点**：大额门通过后、进 COMPLIANCE_PENDING 时提交（大额审批 ≥20万 AED·SMO 在我方系统内完成，先于本流程，不涉 Sumsub）。
- **法币**：`finance` ×1（对手方=收款受益人 IBAN/户名）。
- **虚拟币**：`finance` + `travelRule` ×2（对手方=目的地址/收款 VASP；**我=originator，TR 报文我方发起**；unhosted 走受益人自声明/所有权分支）。
- **组合取最强**：两路 `reject > awaitUser > onHold > approved`；**任何一路非 approved 都押住不放款**。
- **L3 归档**：SUCCESS 后 `PATCH /kyt/txns/{id}/data/info` 回写真实 txHash（现 `archivePostKyt()` stub 的真身，仅 crypto）。
- **看门狗两只**（仅有的定时器，其余全事件驱动）：① 提交后 N 分钟未收 `applicantKytTxnCreated` 回执 = 丢单告警重提；② onHold 超 SLA → MANUAL_CHECKING、ACTION_PENDING 7 天未完成 → MANUAL_CHECKING。
- **引用字段**（8 年留档 + 迟到 webhook 对号入座）：`sumsubFinanceTxnId` / `sumsubTravelRuleTxnId`。

## 3. webhook → 状态机驱动（单闸 + 场景 tag 分流）

| KYT verdict | 场景 tag | 提现动作 |
|---|---|---|
| approved（两路全过）| — | 创建 payout 两腿 → **PAYOUT_PENDING**（广播，跨不可逆线）|
| awaitUser | `PEP` / 一般 | **ACTION_PENDING**（PEP→向我客户收 SOF；crypto→钱包所有权/TR 信息）；SLA 7d |
| onHold | — | 原地留 COMPLIANCE_PENDING；超 SLA → MANUAL_CHECKING |
| **rejected** | **`SANCTION`** | **直接 FROZEN**（法定停单，免审批，不进人工）|
| **rejected** | 无场景 tag | **MANUAL_CHECKING**（officer 在 Sumsub 调查处置）|

**Rejected handler（处置协议，凡 rejected 先拉 txn 读 tag，不分首次）**：

```
收到 Rejected（幂等去重后）：
  1) 拉 txn 读 userDefined tags 分流：
       SANCTION（场景 tag）  → FROZEN（法定停单）
       FROZEN_BY_MLRO（处置）→ FROZEN（officer 定冻，幂等已冻 no-op）
       REJECT_REFUND（处置） → REJECTED：void 双 pending 解锁退回可用余额（免审批）
       无 tag               → 置/保持 MANUAL_CHECKING 留守
收到 Approved 且在 MANUAL_CHECKING/FROZEN → 误报翻案/解冻 → 放款（进 PAYOUT_PENDING）
```

处置 tag `REJECT_REFUND` 为提现新注册（充值对应位是 `RETURN_TO_SENDER`，但语义不同：充值退回=钱出平台给外部发款方，须 MLRO maker-checker + FIU；提现退回=解锁客户自己的钱，收紧方向免审批）。

## 4. FROZEN 语义（行业对齐：冻单短期、冻户长期）

- **单级 FROZEN = 制裁命中排查/申诉停车位**（行业 95%+ 命中是假阳性，寿命=排查周期，小时~数周）。法定即时、免审批（收紧方向）。
- **出口三条，必然了结（FROZEN 非终态）**：
  1. 误报/除名 → 解冻回炉 COMPLIANCE_PENDING 重评 → 放款；
  2. 坐实、客户干净（仅收款方脏）→ REJECTED 解锁退回 + 上报（+拉黑该收款地址）；
  3. 坐实、客户牵连 → REJECTED + 资金划 `CLIENT_BLOCKED` + **V2 客户级冻结接管**——长期冻结与上缴都在客户资产层执行。
- **订单无 SEIZED/SEIZING/CONFISCATING**：上缴/没收是账户资产级动作，不属提现订单——已发出的钱不在我托管（无可缴），未发出的钱属于客户（缴的是客户账户不是这笔单）。充值单有这些态是因为在途资金卡在我托管 SUSPENSE/CLIENT_BLOCKED 里，钱没有别的家。

## 5. 状态机（终版）

### 状态

| 状态 | 类型 | 钱 | 等谁 |
|---|---|---|---|
| CREATED | 入口 | 创建即锁 net+fee（TB pending）| AED 估值 |
| PENDING_APPROVAL | 等待 | 已锁 | SMO（≥20万 AED）|
| COMPLIANCE_PENDING | 枢纽 | 已锁 | Sumsub KYT 终裁；onHold 原地留、超 SLA→人工 |
| ACTION_PENDING | 等待 | 已锁 | 客户（SOF/钱包所有权/TR 信息）；SLA 7d |
| MANUAL_CHECKING | 人工 | 已锁 | officer 在 Sumsub 调查处置 |
| FROZEN | 半终 | 保持锁定 | 排查/申诉（MLRO/除名令）|
| PAYOUT_PENDING | 在途 | **钱已出**（跨不可逆线）| 链上/银行确认 |
| SUCCESS | 终 | 到收款方 | — |
| REJECTED | 终 | 解锁退回可用余额（牵连时划 CLIENT_BLOCKED）| — |
| FAILED | 终 | 解锁退回（未发出）| — |
| RETURNED | 终 | 重入账退回（发出弹回）| — |

**无 CANCELLED**（见锁定决策 5）。终态 4 个：SUCCESS / REJECTED / FAILED / RETURNED。

### 转移（全量）

```
[*]→CREATED（客户发起，锁 net+fee）
CREATED →(估值≥20万AED)→ PENDING_APPROVAL ｜ →(低于阈值)→ COMPLIANCE_PENDING
PENDING_APPROVAL →(SMO批准)→ COMPLIANCE_PENDING ｜ →(否决/超时，void解锁)→ REJECTED
COMPLIANCE_PENDING: 自环(onHold/YELLOW) ｜ →ACTION_PENDING(awaitUser/PEP)
                    ｜ →MANUAL_CHECKING(rejected无tag / onHold超SLA)
                    ｜ →FROZEN(rejected+SANCTION tag) ｜ →PAYOUT_PENDING(全approved，广播)
ACTION_PENDING →COMPLIANCE_PENDING(客户完成，自动重算) ｜ →MANUAL_CHECKING(SLA 7d)
MANUAL_CHECKING →PAYOUT_PENDING(Approve误报放行) ｜ →ACTION_PENDING(发link设awaitingUser)
                ｜ →FROZEN(FROZEN_BY_MLRO tag) ｜ →REJECTED(REJECT_REFUND tag，解锁退回)
FROZEN →COMPLIANCE_PENDING(误报/除名解冻回炉) ｜ →REJECTED(坐实退回；牵连划CLIENT_BLOCKED+V2冻户)
PAYOUT_PENDING →SUCCESS(确认+post全腿CLEARED) ｜ →FAILED(未发出，void解锁退回)
               ｜ →RETURNED(发出弹回，重入账)
SUCCESS / REJECTED / FAILED / RETURNED → [*]
```

## 6. 锁定决策

1. **不可逆线 = 广播/发汇**；唯 KYT 终裁 `Approved` 可跨线放款；`Created`/`OnHold`/`AwaitingUser` 一律押住不放款（提现的人命线——提前放行=钱出去追不回）。
2. **发款前拦截一律 REJECTED 解锁退回**，crypto/fiat 同样适用（与充值「虚拟币绝不 REJECTED」正好相反，理由=钱未离开平台）。
3. **FROZEN 为半终态停车位**（假阳性排查/申诉）；长期冻结与上缴归客户资产层（V2 冻户 + CLIENT_BLOCKED），订单无 SEIZED/CONFISCATING。
4. **处置 tag**：`FROZEN_BY_MLRO` / `REJECT_REFUND`（提现新注册）；两个处置皆收紧/退客户方向，**免事前审批**（充值 RETURN_TO_SENDER 须 MLRO+FIU，提现不需）。
5. **不提供客户撤销**：无 CANCEL 操作、无 CANCELLED 状态（2026-07-25 业主拍板删除）。拦截出口统一 REJECTED/FAILED，消除「撤单 vs 状态推进」并发竞态面；现枚举 `CANCELLED` 转历史兼容值（新流程不可达）。
6. **广播后异步 RED**：本单仍 SUCCESS（钱确已送达），另开客户级合规 case（STR + V2 冻户）；法币可 recall 成功的走 RETURNED。
7. **大额门保持现状**：≥20万 AED → SMO 审批（fail-closed），先于合规、在我方系统内，不涉 Sumsub。

## 7. 与现状代码差距（truth/v5-withdraw.md）

- **L2 mock 换真**：`initializeTransactionScreen()` 的 Pre-KYT/TR mock → 提交真 Sumsub `finance(out)`（±`travelRule(out)`）；`checkScreenPass()` 收敛条件从「preKytStatus=PASSED && TR∈{PASSED,NOT_REQUIRED}」改为「KYT 终裁 Approved（两路取最强）」。
- **新状态落位**：ACTION_PENDING / MANUAL_CHECKING / FROZEN——现枚举有 `UNDER_REVIEW`/`HELD` 空槽可复用或新增，实施时定；`CANCELLED` 转历史兼容。
- **RETURNED 枚举在但零实现** → 需接退汇/链上退回入口（发出后弹回→重入账）。
- **`archivePostKyt()` stub → 真 PATCH /kyt/txns 调用**（L3 归档 txHash）。
- **新字段**：`sumsubFinanceTxnId` / `sumsubTravelRuleTxnId` / `slaDeadline` / `slaBreached` / `actionReason`{EDD_SOF, WALLET_OWNERSHIP, TR_INFO} / `manualReason`{FIRST_REJECT, SLA_BREACH} / `complianceHoldReason`。
- **webhook 接入复用 sumsub-ingestion 翻译层**（ingest→dispatch 管道 + retry/dead-letter），dispatch 按 kytTxnId 映射回 withdraw。
- **释放原语复用**：拦截退回全走现有 `releaseLock()`（P6 修复的 void net+fee），无新记账面。
