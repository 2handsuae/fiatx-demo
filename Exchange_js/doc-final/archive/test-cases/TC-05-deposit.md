# TC-05 · 充值单（Deposit）测试用例

> 对应 PRD《4. 充值单 · Deposit》v1.0 ｜ 域码 `DEP` ｜ 24 条
> 口径与排除范围见 [README.md](README.md)

**本篇排除**：全部异常分支（FROZEN / REJECTED / ACTION_PENDING / FAILED / EXPIRED / CONFISCATED）及合规官·MLRO 处置（非目标 1）；附录 B/C 的 Sumsub 异常状态机与 tag 路由；放行后的行为风控 L3（非目标 5）。
**触发方式说明**：① 到账侦测器未接（G2），用例以 demo 申报 + 扫描作为「侦测到账」的触发；② Sumsub 真实 webhook 未接（G3），KYT/TR 结果经模拟端点注入，走同一 ingest→dispatch 管道，不影响断言。

---

## 1. 建单与暂扣（FR-1/FR-2 · T1/T2 · AC-1.1~1.2）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-DEP-001 | AC-1.1 / FR-1 / T1 | 正例 | P0 | 虚拟币到账建单 + 资金单出生 SUBMITTED | 客户已过 onboarding、有 ACTIVE 充值地址 | ① 侦测一笔带 txHash 的链上到账 | 生成 `DEP-` 前缀订单，状态 `PAYIN_PENDING`；同时建 1 张充值资金单，出生态 `SUBMITTED`；审计 `CREATED`（含 fundsOrderId/amount/assetCurrency） | — |
| TC-DEP-002 | AC-1.1 / FR-1 / T1 | 正例 | P0 | 法币到账建单 + 资金单出生 CONFIRMED | 客户有 ACTIVE VIBAN | ① 侦测一笔 VIBAN 入账 | 订单 `PAYIN_PENDING`；资金单出生态 `CONFIRMED`（**无确认阶段**）；审计 `CREATED` | 双链路差异① |
| TC-DEP-003 | AC-1.2 / FR-2 / T2 | 正例 | P0 | 资金单 CONFIRMED 触发 Step1 暂扣 | 订单 PAYIN_PENDING | ① 令资金单达 CONFIRMED | 账本出现 `CLIENT_ASSET → DEPOSIT_SUSPENSE` 分录；订单转 `COMPLIANCE_PENDING`；资金单 CLEAR；审计 `PAYIN_CONFIRMED`（含 fundsOrderNo） | 钱到账 ≠ 钱可用 |
| TC-DEP-004 | FR-2 | 边界 | P0 | 暂扣期间客户不可用该笔资金 | 订单停在 COMPLIANCE_PENDING | ① 查客户可用余额 ② 尝试用该笔资金提现/兑换 | 可用余额**不含**该笔；发起交易时该笔不计入余额 | UC1 最低保证 |
| TC-DEP-005 | FR-6 | 反例 | P0 | 记账失败订单不推进 | 可注入记账失败 | ① 令 Step1 记账失败 | 订单**不转** COMPLIANCE_PENDING；记 `DEPOSIT_ACCOUNTING_BLOCKED`；无半账（fail-closed） | — |

## 2. 合规双门与放行（FR-3/FR-5 · T3 · AC-1.3）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-DEP-006 | FR-3 | 正例 | P0 | L1 → L2 串行 | 订单进 COMPLIANCE_PENDING | ① 观察合规门执行顺序 | **先跑 L1**（客户合规状态），通过后**才**启动 L2（KYT/TR）；审计顺序 `L1_PASSED` 早于 `KYT_PASSED` | 串行非并行 |
| TC-DEP-007 | AC-1.3 / FR-5 / T3 | 正例 | P0 | 双门收敛 → Step2 入账 → SUCCESS | L1 通过 | ① 注入 kyt=PASSED ② 注入 tr=PASSED（TR 适用时） | 账本出现 `DEPOSIT_SUSPENSE → CLIENT_PAYABLE`；订单 `SUCCESS`；客户可用余额增加该笔；审计 `COMPLETED` | 主链路 |
| TC-DEP-008 | FR-5 | 边界 | P0 | TR 为 NOT_REQUIRED 同样收敛放行 | L1 通过、TR 判定为 NOT_REQUIRED | ① 仅注入 kyt=PASSED | 直接收敛放行、入账 SUCCESS，**不等** TR webhook | 收敛条件是 tr ∈ {PASSED, NOT_REQUIRED} |
| TC-DEP-009 | UC1 最低保证 | 边界 | P0 | 未收敛前资金停在暂扣、不入账 | L1 通过，kyt 仍 PENDING | ① 查订单与账本 | 订单停 `COMPLIANCE_PENDING`；**无** Step2 分录；资金留在 DEPOSIT_SUSPENSE、客户不可用 | 后续处置属异常分支，不在本篇 |
| TC-DEP-010 | T3 约束 | 反例 | P1 | SUCCESS 不可逆 | 订单已 SUCCESS | ① 尝试将其改回 COMPLIANCE_PENDING 或其他态 | 被拒，状态不变 | — |

## 3. Travel Rule 适用判定（FR-4 · 5.4 判定表 · AC-2.x）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-DEP-011 | AC-2.1 / 判定表 行 1 | 边界 | P0 | 虚拟币 + VASP 来源 + 恰 3,500 AED → TR 适用 | 来源地址判定为 VASP 托管 | ① 充值等值**恰 3,500 AED** 的虚拟币 | `travelRuleRequired=true`、`travelRuleStatus=PENDING`；**必须**等 webhook 回 PASSED 才放行 | 阈值含等号 |
| TC-DEP-012 | AC-2.2 / 判定表 行 2 | 边界 | P0 | 同条件 3,499 AED → NOT_REQUIRED | 同上 | ① 充值等值 3,499 AED | `travelRuleStatus=NOT_REQUIRED`；放行链路中**无** `TR_PASSED` 审计 | 恰差一档 |
| TC-DEP-013 | AC-2.3 / 判定表 行 3 | 正例 | P0 | 虚拟币 + 自托管来源 → NOT_REQUIRED | 来源判定为自托管 | ① 充值任意金额（含 ≥3,500） | `NOT_REQUIRED`——三条件 AND 缺一即不适用 | — |
| TC-DEP-014 | AC-2.3 / 判定表 行 4 | 正例 | P0 | 法币充值恒 NOT_REQUIRED | — | ① 法币充值任意金额 | `travelRuleStatus=NOT_REQUIRED`（硬写） | 双链路差异③ |
| TC-DEP-015 | FR-7 / 5.7 | 正例 | P1 | KYT/TR 结果均由 webhook 信号回填订单字段 | TR 适用的虚拟币充值 | ① 注入 KYT 与 TR 信号 ② 查数据模型 | 结果落订单的 `kytStatus` / `travelRuleStatus` 等字段；**不存在**本地 TR 交换实体表 | 独立交换表方案已否决 |
| TC-DEP-016 | 5.7 场景 A/B | 边界 | P1 | 两种 TR 时序对我方是同一处理 | — | ① 场景 A：对方 VASP 先发 TR，我方后到账 ② 场景 B：我方先到账后提交 TR | 两种时序下我方行为一致——都只消费一个 webhook 信号回填 `travelRuleStatus`；**不建预告表、不做认领** | 复杂度归 Sumsub |

## 4. 客户视角中性化（FR-8 · AC-1.4）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-DEP-017 | AC-1.4 / FR-8 | 正例 | P0 | 客户端全程仅「处理中 → 已完成」 | 一笔充值走完全程 | ① 以客户身份在各阶段查看该笔充值 | PAYIN_PENDING / COMPLIANCE_PENDING 阶段统一显示「处理中」；SUCCESS 后显示「已完成」 | tipping-off 防线 |
| TC-DEP-018 | FR-8 | 反例 | P0 | 客户端不外泄任何合规内部态 | 同上 | ① 检查客户端接口返回体与页面 | 不出现 kytStatus / travelRuleStatus / 合规原因码 / 内部状态名等字段 | 接口层也要拦，不只是 UI |

## 5. 记账不变量与审计（AC-3.x · 5.6）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-DEP-019 | AC-3.1 | 正例 | P0 | 每笔成功充值留 2 步共 4 条借贷凭证 | 一笔已 SUCCESS 的充值 | ① 查该笔的账本记录 | Step1、Step2 各 1 笔转账；按借贷拆共 **4 条**流水行；全部 POSTED | 与 TC-LDG-023 呼应 |
| TC-DEP-020 | AC-3.2 | 正例 | P0 | 不变量按币种恒成立 | 跑完若干充值 | ① 执行不变量自检 | 每币种 Σ CLIENT_ASSET = Σ(CLIENT_PAYABLE + DEPOSIT_SUSPENSE) 成立 | `verify:coa` 通过 |
| TC-DEP-021 | AC-3.2 | 边界 | P0 | 暂扣中的充值不破不变量 | 一笔停在 COMPLIANCE_PENDING | ① 此刻自检不变量 | 成立（暂扣额在负债侧 DEPOSIT_SUSPENSE） | 易误判 |
| TC-DEP-022 | 5.6 审计 | 正例 | P1 | 成功链路 6 个审计事件完整有序 | 一笔 TR 适用的成功充值 | ① 按 traceId 拉全部审计事件 | 依次为 `CREATED` → `PAYIN_CONFIRMED` → `L1_PASSED` → `KYT_PASSED` → `TR_PASSED` → `COMPLETED`，共 6 条、顺序正确 | **⚠漂移**：代码现发旧名（如 `DEPOSIT_GATE0_PASSED`），PRD 应然为去前缀新名（G4） |
| TC-DEP-023 | 5.6 审计 | 边界 | P1 | TR 不适用时只有 5 个事件 | 一笔法币或自托管来源充值 | ① 按 traceId 拉全部审计事件 | 无 `TR_PASSED`，共 5 条 | 与 022 成对 |
| TC-DEP-024 | 5.6 信封 / 5.5 | 正例 | P2 | 审计信封与留存字段齐备 | 同上 | ① 检查任一事件的信封字段 ② 检查订单留存字段 | 信封含 entityType=DEPOSIT_TRANSACTION / 订单号 / 归属客户 / 操作者 / traceId / workflowType=DEPOSIT；订单留有金额、资产、来源地址、txHash 或 referenceNo、两个合规态、暂扣与入账时点 | 留存 ≥8 年 |

---

**覆盖对账**：AC-1.1→001/002 ｜ AC-1.2→003 ｜ AC-1.3→007 ｜ AC-1.4→017/018 ｜ AC-2.1→011 ｜ AC-2.2→012 ｜ AC-2.3→013/014 ｜ AC-3.1→019 ｜ AC-3.2→020/021；FR-1→001/002 ｜ FR-2→003/004 ｜ FR-3→006 ｜ FR-4→011~014 ｜ FR-5→007/008 ｜ FR-6→005 ｜ FR-7→015 ｜ FR-8→017/018；T1→001/002 ｜ T2→003 ｜ T3→007/010；判定表 4 行→011/012/013/014；审计 6 事件→022/023/024。异常分支与 5.7 之外的 TR 处置不在本篇（非目标 1、4）。
