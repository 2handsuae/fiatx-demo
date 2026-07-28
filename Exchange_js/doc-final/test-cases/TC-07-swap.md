# TC-07 · 兑换流程（Swap）测试用例

> 对应 PRD《7. 兑换流程 · Swap》v0.1 ｜ 域码 `SWP` ｜ 33 条
> 口径与排除范围见 [README.md](README.md)

**本篇排除**：兑换费率的创建/变更治理（属 TC-04）；过期报价自动清扫 cron（G2，未接，仅测成交时到期校验兜底）；整笔冲正/回滚终态（Q2，明确未做）；大额/可疑兑换的异步合规闸门（Q1，待合规确认）。
**触发方式说明**：真实链上/银行确认未接（G1），腿的外部确认由运营手动 advance 模拟，不影响断言。
**说明**：兑换的自愈与人工恢复写在 PRD 正文（FR-5/FR-6、7.3 且为「失败路径 · 重心」），属本篇范围。

---

## 1. 报价（FR-1/FR-2/FR-9 · Q1~Q4 · 判定 3 · AC-1.x）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-SWP-001 | AC-1.1 / FR-1 / Q1 | 正例 | P0 | 支持币对返回完整 FIRM 报价 | 币对已上线、有 ACTIVE 费率等级 | ① 选币对 + 输卖出金额，请求报价 | 返回：市场汇率、全含汇率、点差 bps、手续费明细、净到账、30 秒有效期；quoteType 恒 `FIRM`、status `ACTIVE`；审计 `SWAP_QUOTE_CREATED` | — |
| TC-SWP-002 | FR-9 | 正例 | P0 | 全含汇率 = 市场汇率 × (1 − bps/10000) | 已知等级 markup bps | ① 请求报价 ② 用返回的市场汇率与 bps 反算 | 全含汇率与反算值一致；点差显式可见、可追溯到汇率来源 | 定价透明 |
| TC-SWP-003 | AC-1.5 / FR-9 | 反例 | P0 | 法币兑法币报价被拒 | — | ① 请求 AED → 另一法币的报价 | 拒绝（当前仅支持 CRYPTO ↔ FIAT） | — |
| TC-SWP-004 | UC1 扩展 2a | 反例 | P1 | 无适用费率则拒绝报价 | 该币对无命中的 ACTIVE+enabled 等级 | ① 请求报价 | 拒绝，不出价 | 与 TC-FEE-034 同源 |
| TC-SWP-005 | AC-1.3 / FR-2 | 边界 | P0 | 报价恰在 30 秒内成交通过 | 报价生成后第 29 秒 | ① 确认成交 | 正常受理，报价转 `USED` | 恰命中 |
| TC-SWP-006 | AC-1.2 / FR-2 / Q4 | 边界 | P0 | 报价恰过 30 秒成交被拒 | 报价生成后第 31 秒 | ① 确认成交 | 拒绝；报价**不置 USED**；不建单；客户须重新报价 | 恰差一分；EXPIRED 靠成交时校验兜底（G2） |
| TC-SWP-007 | AC-1.4 / 判定 3 | 反例 | P0 | 非 ACTIVE 报价不可成交 | 报价已 USED / CANCELLED / EXPIRED | ① 分别用三种状态的报价成交 | 三次均拒绝（fail-closed） | 一份报价只消费一次 |
| TC-SWP-008 | Q3 | 正例 | P2 | 客户取消未用报价 | 报价 ACTIVE | ① 客户取消 | 转 `CANCELLED`；审计 `SWAP_QUOTE_CANCELLED`；此后不可成交 | — |
| TC-SWP-009 | Q2/Q3/Q4 约束 | 反例 | P1 | 报价终态不可复活 | 报价为 USED/CANCELLED/EXPIRED | ① 尝试将其改回 ACTIVE | 被拒 | — |

## 2. 成交资格门（FR-3 · 判定 4 · AC-2.1/2.2）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-SWP-010 | AC-2.1 / FR-3 / 判定 4 | 反例 | P0 | onboarding 非 APPROVED 拒绝且不建单 | 客户 onboarding ≠ APPROVED | ① 确认成交 | 拒绝、**不建单**、报价不置 USED；审计 `CREATE_FAILED`（含 error） | fail-closed |
| TC-SWP-011 | AC-2.1 / FR-3 | 反例 | P0 | 账户非 ACTIVE 拒绝 | adminStatus ≠ ACTIVE | ① 确认成交 | 同上 | — |
| TC-SWP-012 | AC-2.1 / FR-3 | 反例 | P0 | 合规冻结拒绝 | complianceStatus = FROZEN | ① 确认成交 | 同上 | — |
| TC-SWP-013 | AC-2.1 / FR-3 | 反例 | P0 | 限制 SWAP 能力拒绝 | 客户 restrictions 含 SWAP | ① 确认成交 | 同上 | 资格四项 |
| TC-SWP-014 | AC-2.2 / FR-3 / 判定 4 | 反例 | P0 | 缺任一侧收款账户拒绝 | 买入或卖出侧缺 ACTIVE 收款账户 | ① 确认成交 | 拒绝 `RECEIVING_ACCOUNT_REQUIRED`（带 assetCode）；**先于**消费报价与建单 | 与 TC-WAL-038/039 呼应 |
| TC-SWP-016 | AC-2.6 / FR-8 | 反例 | P0 | 管理员直接建单被禁 | 以任意管理员身份 | ① 调管理员建单入口 | 恒 `Forbidden` | 兑换无 maker-checker，但也不给 admin 造单口 |
| TC-SWP-017 | FR-8 | 边界 | P1 | 兑换不设审批门与大额门 | 构造一笔超大额兑换 | ① 确认成交 | **不触发**任何审批/大额门，直接进成交（资金不出境） | 与提现刻意不同 |

## 3. 成交编排与账本（FR-4/FR-7 · T1/T2 · L1~L5 · AC-2.3~2.5）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-SWP-018 | AC-2.3 / FR-4 / T1 | 正例 | P0 | 成交后仅建 Leg1，订单 PROCESSING | 资格与账户齐备 | ① 确认成交 | 报价 `USED`；订单 `PROCESSING`（`SWP-` 前缀）；**仅 Leg1** 被建并锁 pending；审计 `CREATED`（含 quoteId/quoteNo） | 前腿 CLEARED 才建后腿 |
| TC-SWP-019 | FR-4 | 边界 | P0 | 后腿在前腿 CLEARED 后才创建 | Leg1 尚未 CLEARED | ① 查资金单列表 | 此时**不存在** Leg2/3/4；Leg1 CLEARED 后 Leg2 才出现 | 链式 |
| TC-SWP-020 | AC-2.4 / FR-4 / T2 | 正例 | P0 | 四腿全 CLEARED → 订单 SUCCESS | 逐腿推进 | ① 依次推进 4 腿至 CLEARED | 第 4 腿 CLEARED 后订单转 `SUCCESS`，落 completedAt；审计 `SUCCEEDED` | 主链路 |
| TC-SWP-021 | AC-2.4 / FR-7 | 正例 | P0 | 成交后余额与恒等式一致 | 同上 | ① 核对客户两侧余额 ② 核不变量 | 卖出币按成交额减少、买入币按**净额**到账；实时 1:1 恒等式成立 | 点差与费归公司 |
| TC-SWP-022 | FR-7 | 正例 | P0 | 每腿过账写账本凭证 | 一笔成功兑换 | ① 查该单凭证 | 每腿均有凭证行，含 eventCode / legSeq / attempt / traceId；桶向符合《账本》附录 B | 见 TC-LDG-025/026 |
| TC-SWP-023 | 判定 1 | 边界 | P1 | 腿形状按资产类型区分 | 一笔 CRYPTO↔FIAT 兑换 | ① 观察币腿与法币腿的状态路径 | 币腿 5 跳（含 CONFIRMING）；法币腿 4 跳（跳过 CONFIRMING） | 差异② |
| TC-SWP-024 | AC-2.5 / FR-10 | 正例 | P1 | 全链路共享同一 traceId | 一笔成功兑换 | ① 比对报价创建、报价使用、订单创建、成功四条审计 | 四者 `traceId` 相同 | 可串联追溯 |
| TC-SWP-025 | FR-10 / 分层原则 | 边界 | P1 | 合规审计只记订单级、不记逐腿过账 | 同上 | ① 查合规审计事件列表 | 只有订单级里程碑（CREATED / SUCCEEDED / STUCK / RESUMED / 报价三事件）；**逐腿过账不入合规审计**，只在账本凭证层 | ⚠漂移：代码现仍逐腿写 `SWAP_LEG_POSTED` / `RETRIED`（G3） |

## 4. 自愈与人工恢复（FR-5/FR-6 · L6/L7 · 判定 2 · AC-3.x）

| ID | 锚点 | 类型 | P | 标题 | 前置 | 步骤 | 预期 | 备注 |
|---|---|---|---|---|---|---|---|---|
| TC-SWP-026 | AC-3.1 / FR-5 / 判定 2 / L6 | 正例 | P0 | 单腿失败自动 void 并重试 | 某腿 attempt=1 进行中 | ① 令该腿 FAILED | 本 attempt 的 pending 被 void 解锁；自动建 attempt=2 重试；订单**仍 PROCESSING** | attempt < 3 |
| TC-SWP-027 | AC-3.2 / FR-5 / 判定 2 | 边界 | P0 | 同腿失败满 3 次挂起 needsReview | 该腿已失败 2 次 | ① 令第 3 次失败 | 不再自动重试；`needsReview=true`；审计 `STUCK`（含 legSeq/stage/attempts）；订单**仍 PROCESSING、不进 FAILED** | MAX_LEG_ATTEMPTS=3 |
| TC-SWP-028 | T2 约束 | 边界 | P0 | 订单永不进入 FAILED | 腿反复失败 | ① 观察订单状态 | 订单状态始终 `PROCESSING`（needsReview 为附加轴，不改主状态）；无 FAILED 终态 | 绝不静默丢单 |
| TC-SWP-029 | AC-3.6 / UC1 最低保证 | 边界 | P0 | 失败腿的 pending 已解锁、余额分毫不差 | 某腿失败后 | ① 核对客户可用余额与账本 | 该腿锁定额全额退回；pending 与 void 严格配对；余额与失败前一致 | 资金不悬空 |
| TC-SWP-030 | AC-3.3 / FR-6 / UC2 | 正例 | P0 | 运营 resume 挂起腿 | 腿处于失败终态、needsReview=true | ① 运营对该腿 resume | 建全新 attempt（max+1）、重锁 pending、清 `needsReview`；审计 `RESUMED`（含 legSeq/stage/resumedAttempt，记为运营动作） | 人工恢复 |
| TC-SWP-031 | AC-3.3 / FR-6 | 正例 | P1 | resume 后链式走完剩余腿 | 承接 030 | ① 继续推进 | 该腿 CLEARED 后自动建下一腿；最终订单 `SUCCESS` | — |
| TC-SWP-032 | AC-3.4 / FR-6 | 反例 | P0 | 对非失败终态腿 resume 被拒 | 腿处于 CONFIRMED / CLEARED / 进行中 | ① 运营 resume | 拒绝 `SWAP_LEG_NOT_STUCK`；不建新 attempt | 边界 |
| TC-SWP-033 | AC-3.5 / L 约束 | 反例 | P0 | 越序推进腿被拒 | Leg1 未 CLEARED | ① 尝试推进 Leg3 | 拒绝 `SWAP_SEQUENCE_VIOLATION` | 严格按 legSeq |
| TC-SWP-034 | UC2 最低保证 | 边界 | P1 | 恢复失败不恶化 | resume 后该腿再次失败 | ① 观察订单与 pending | 订单仍 `PROCESSING`；pending 配对不破（新 attempt 的 pending 已 void）；回到自愈循环 | — |

---

**覆盖对账**：AC-1.1→001 ｜ AC-1.2→006 ｜ AC-1.3→005 ｜ AC-1.4→007 ｜ AC-1.5→003 ｜ AC-2.1→010~013 ｜ AC-2.2→014 ｜ AC-2.3→018 ｜ AC-2.4→020/021 ｜ AC-2.5→024 ｜ AC-2.6→016 ｜ AC-3.1→026 ｜ AC-3.2→027 ｜ AC-3.3→030/031 ｜ AC-3.4→032 ｜ AC-3.5→033 ｜ AC-3.6→029；FR-1→001 ｜ FR-2→005~007 ｜ FR-3→010~014 ｜ FR-4→018~020 ｜ FR-5→026~028 ｜ FR-6→030~032 ｜ FR-7→021/022 ｜ FR-8→016/017 ｜ FR-9→002/003 ｜ FR-10→024/025；Q1→001 ｜ Q2→018 ｜ Q3→008 ｜ Q4→006；T1→018 ｜ T2→020/028；L5→020/022 ｜ L6/L7→026/027；判定 1→023 ｜ 判定 2→026/027 ｜ 判定 3→005/006/007 ｜ 判定 4→010~014。

**范围复核移除（2026-07-27）**：原 TC-SWP-015（卖出侧余额不足拒绝）—— PRD 仅在 UC1「前置条件」提及「卖出侧有可用余额」，**未**将余额不足写成扩展流或验收标准（扩展流只列 2a 无费率 / 3a 报价过期 / 4a 资格门与收款账户 / 5a 腿失败），该用例系异常分支外推，超出本版范围。编号不重排。
