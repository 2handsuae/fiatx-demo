# TC-06 · 提现单（Withdraw）测试用例

> 对应 PRD《6. 提现单 · Withdraw》v0.5 ｜ 域码 `WDR` ｜ 28 条
> 口径与排除范围见 [README.md](README.md)

**本篇排除**：失败 / 异常 / 解锁路径（FAILED、releaseLock、admin 拒·取消·复核、UNDER_REVIEW、记账 fail-closed 卡单）——非目标 1；大额审批门（≥200,000 AED → SMO 48h）及其 AED 估值字段——非目标 2；报价定价算法（属 TC-04）；附录 B/C 的 Sumsub 异常状态机；crypto L3 归档（G2，stub 且命名待改）。
**触发方式说明**：Pre-KYT / TR 结果经模拟端点注入（G1）；外部确认（链上 txHash / 银行到账）经资金单 CONFIRMED 入口驱动。

---

## 1. 报价（阶段 0 · FR-1/FR-2 · AC-1.1）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-WDR-001 | FR-1 | 反例 | P0 | 未过资格门不得报价 | 客户 onboarding 非 APPROVED / 被冻结 / 无 ACTIVE 法币提现地址（任一） | ① 请求提现报价 | 拒绝，不生成报价单 | 资格门在报价与发起**两处**都校验 |
| TC-WDR-002 | AC-1.1 / FR-2 | 正例 | P0 | 报价生成 30 秒有效的 ACTIVE 单 | 已过资格门、有可用余额 | ① 选资产 + 输金额，请求报价 | 生成 `WQ-` 前缀报价单，status=`ACTIVE`，`expiresAt = 生成 + 30s`；返回手续费明细、净额、quoteId | — |
| TC-WDR-003 | AC-1.1 / FR-2 | 反例 | P0 | 无适用费率等级则拒绝报价 | 该资产无命中的 ACTIVE+enabled 费率等级 | ① 请求报价 | 拒绝，错误「No applicable fee level」；**不静默按 0 费出价** | 与 TC-FEE-034 同源 |
| TC-WDR-004 | FR-2 | 正例 | P1 | 报价取命中集合最低费 | 客户命中多个等级 | ① 请求报价 ② 核对费额与 feeLevelCode | 取 cheapest 那级的服务费；报价单记录命中等级码与档位名 | 算法细节见 TC-04 |

## 2. 受理与锁定（阶段 1-2 · FR-3/FR-4 · T1 · AC-1.2/1.3）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-WDR-005 | AC-1.2 / FR-3/FR-4 | 正例 | P0 | 持有效报价发起 → 消费报价 + 建单 + 锁定 | 报价 ACTIVE 且未过期 | ① 携 quoteId + 目标地址/IBAN 发起提现 | 报价转 `USED`；工单 `CREATED`（`WD` 前缀）；账本出现 **net + fee 两笔 pending**；审计 `REQUESTED` | 单事务原子完成 |
| TC-WDR-006 | FR-4 | 边界 | P0 | 受理为单事务原子操作 | 可注入锁定失败 | ① 令锁定环节失败 | 工单**不残留**、报价**不置 USED**、无孤儿 pending——全部回滚 | 原子性 |
| TC-WDR-007 | AC-1.3 / FR-3 | 边界 | P0 | 报价过期（超 30 秒）发起被拒 | 报价生成后等待 31 秒 | ① 携该 quoteId 发起 | 报价置 `EXPIRED`；抛「Quote has expired」；**不建工单、不锁定** | 恰过一秒 |
| TC-WDR-008 | FR-3 | 边界 | P0 | 报价恰在 30 秒内可用 | 报价生成后第 29 秒 | ① 携该 quoteId 发起 | 正常受理 | 与 007 成对 |
| TC-WDR-009 | FR-3 | 反例 | P0 | 报价不属本人则拒 | 用客户 A 的 quoteId | ① 以客户 B 身份发起 | 拒绝，不建单 | 越权防线 |
| TC-WDR-010 | FR-3 | 反例 | P0 | 报价资产/金额与发起不一致则拒 | 报价为 100 USDT | ① 以 200 USDT 发起 ② 以另一资产发起 | 两次均拒绝 | 防篡改 |
| TC-WDR-011 | FR-3 | 反例 | P1 | 非 ACTIVE 报价不可消费 | 报价已 USED / CANCELLED | ① 再次携该 quoteId 发起 | 拒绝 | 一份报价只消费一次 |
| TC-WDR-012 | FR-1 | 反例 | P0 | 发起时再次校验资格门 | 报价生成后客户被冻结 | ① 携该有效报价发起 | 拒绝，不建单 | 两处校验的意义 |
| TC-WDR-013 | T1 | 正例 | P1 | 受理后进入合规筛查 | 工单 CREATED | ① 观察状态推进 | `CREATED → PENDING_COMPLIANCE`，并初始化 Pre-KYT + TR | — |

## 3. 合规筛查收敛（阶段 3 · FR-5/FR-6 · T2 · 判定表 · AC-2.x）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-WDR-014 | FR-5 | 正例 | P0 | crypto 初始化 Pre-KYT + TR 双筛查 | crypto 提现进入筛查 | ① 查筛查初始化结果 | 同时初始化 `preKytStatus` 与 `travelRuleStatus`（TR 适用） | 差异① |
| TC-WDR-015 | FR-5 | 正例 | P0 | fiat 只初始化 Pre-KYT、TR 恒 NOT_REQUIRED | fiat 提现进入筛查 | ① 查筛查初始化结果 | `travelRuleStatus = NOT_REQUIRED`（不发起 TR） | 差异① |
| TC-WDR-016 | AC-2.1 / FR-6 / 判定表行 1 | 正例 | P0 | crypto 收敛：Pre-KYT PASSED 且 TR PASSED | 同上 | ① 注入 preKyt=PASSED、TR=PASSED | 收敛通过，转 `PAYOUT_PENDING`；审计 `COMPLIANCE_PASSED` | — |
| TC-WDR-017 | AC-2.2 / FR-6 / 判定表行 2 | 正例 | P0 | fiat 收敛：Pre-KYT PASSED 且 TR NOT_REQUIRED | 同上 | ① 注入 preKyt=PASSED | 收敛通过，进入出账 | — |
| TC-WDR-018 | FR-6 | 边界 | P0 | 未收敛不得进入出账 | preKyt 仍 PENDING | ① 查工单与账本 | 停在 `PENDING_COMPLIANCE`；**不建资金单、不出账**；net+fee 仍锁定 | 后续处置属异常分支，不在本篇 |
| TC-WDR-019 | AC-2.3 / FR-7 | 正例 | P0 | 绑定客户自有源钱包 | 收敛通过 | ① 查工单 fromWallet | crypto 绑 `C_DEP`、fiat 绑 `C_VIBAN`，且 `ownerType=CUSTOMER` | 不得绑系统钱包 |
| TC-WDR-020 | AC-2.3 / FR-8 | 正例 | P0 | 物化本金腿 + 费用腿 | 同上，手续费 > 0 | ① 查资金单 | 生成 legSeq=1（net）与 legSeq=2（fee）两张；审计 `PAYOUT_INITIATED` | — |
| TC-WDR-021 | FR-8 | 边界 | P1 | 手续费为 0 时不建费用腿 | 报价手续费 = 0 | ① 查资金单 | **仅 1 张**（legSeq=1）；无费用腿 | 恰为 0 |

## 4. 出账确认与记账收敛（阶段 5-6 · FR-9/10/11 · T3 · AC-3.x）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-WDR-022 | AC-3.1 / FR-9 | 正例 | P0 | 本金腿确认 → POST net → 腿 CLEARED | 本金腿达 CONFIRMED | ① 观察记账与腿状态 | 账本出现 net 落账凭证（evidence `WITHDRAW_NET_POST`）；本金腿 `CLEARED` | **⚠漂移**：账本 PRD 应然 eventCode 为去阶段化的 `WITHDRAW_NET`（G2） |
| TC-WDR-023 | AC-3.2 / FR-10 | 正例 | P0 | 费用腿确认 → POST fee + 公司侧收费 | 费用腿达 CONFIRMED | ① 观察记账与腿状态 | 出现 `WITHDRAW_FEE_POST`（客户侧）与 `WITHDRAW_FEE_FIRM`（FIRM_ASSET → FIRM_FEE）；费用腿 `CLEARED` | 公司侧那笔为单步 |
| TC-WDR-024 | AC-3.3 / FR-11 / T3 | 正例 | P0 | 全腿 CLEARED → SUCCESS + 余额校验 | 两腿均 CLEARED | ① 观察工单与余额 | 工单 `SUCCESS`；审计 `ACCOUNTING_POSTED` + `SUCCESS`；客户余额 = 原余额 − amount（含费）；公司侧 FIRM_FEE 增加 fee | 主链路终点 |
| TC-WDR-025 | T3 约束 | 边界 | P0 | 未全腿 CLEARED 不得 SUCCESS | 仅本金腿 CLEARED、费用腿未确认 | ① 查工单状态 | 仍 `PAYOUT_PENDING`——记账证据齐是 SUCCESS 的前置 | 易漏 |
| TC-WDR-026 | 差异③ | 边界 | P1 | crypto 与 fiat 走同一确认入口 | 分别跑 crypto 与 fiat 提现 | ① 观察确认触发路径 | 两者都经资金单 `CONFIRMED` 入口驱动，仅确认介质不同（txHash / 银行到账） | 共用一条工作流 |
| TC-WDR-027 | 5.3 约束 | 反例 | P0 | admin 不得直推 PAYOUT_PENDING 与终态 | 工单在任意中间态 | ① 以 admin 身份直接推 PAYOUT_PENDING ② 直接推 SUCCESS | 均被拒——状态推进由 workflow 独家驱动 | 单一编排者 |
| TC-WDR-028 | 5.6 审计 | 正例 | P1 | 5 个关键里程碑审计完整有序 | 一笔成功提现 | ① 按 traceId 拉审计 | 依次含 `REQUESTED` → `COMPLIANCE_PASSED` → `PAYOUT_INITIATED` → `ACCOUNTING_POSTED` → `SUCCESS`；信封含 entityType=WITHDRAW_TRANSACTION / withdrawNo / 客户 / traceId / workflowType=WITHDRAW | 报价环节零打点属 G5，不测 |

---

**覆盖对账**：AC-1.1→002/003 ｜ AC-1.2→005 ｜ AC-1.3→007 ｜ AC-2.1→016 ｜ AC-2.2→017 ｜ AC-2.3→019/020 ｜ AC-3.1→022 ｜ AC-3.2→023 ｜ AC-3.3→024；FR-1→001/012 ｜ FR-2→002~004 ｜ FR-3→005/007~011 ｜ FR-4→005/006 ｜ FR-5→014/015 ｜ FR-6→016~018 ｜ FR-7→019 ｜ FR-8→020/021 ｜ FR-9→022 ｜ FR-10→023 ｜ FR-11→024；T1→013 ｜ T2→016/017 ｜ T3→024/025；判定表 2 行→016/017；报价生命周期 ACTIVE→USED→005、ACTIVE→EXPIRED→007。失败/异常/大额门/admin 路径不在本篇（非目标 1、2）。
