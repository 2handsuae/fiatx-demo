# V6 兑换 — 单一工作流 + 自愈多腿重设计

> 状态：设计基线（pre-implementation），已与用户逐段确认
> 日期：2026-06-28
> 适用：V6 swap-transactions（workflow / settlement / domain / 两个控制器 + InternalFund 腿 + 前端 swap 详情）
> 分支：`refactor/v4-v5-three-layer`（与用户并行的 Trae recon 工作显式路径提交隔离）
> 验收闸：`npm run demo:swap` + `npm run verify:coa` + jest（main 栈/claude 验收栈）

---

## 0. 一句话目标

把兑换从「建单工作流 + 结算工作流」两套，收敛成**唯一一个 `SwapWorkflowService` 当家**；删除"结算"概念；4 条资金腿**陆续创建、admin 逐腿推进、腿自控记账时机**；**先收后付**强制不变量；**腿失败自动重建新腿（有限次）→ 超限挂起人工，绝不整笔回滚**。

---

## 1. 背景：当前问题

- **工作流被劈成两半**：`SwapWorkflowService`（只建单）+ `SwapSettlementService`（615 行，实为第二个 workflow——它写业务审计 `SWAP_SUCCEEDED/FAILED/REVERSED`、emit `SWAP_SUCCEEDED` 事件、判 SUCCESS/FAILED、被 admin 控制器直接驱动）。"结算"被错放在三层模型的 L2 槽（L2 本应是审批子工作流）。旅程终态审计落在 settlement 而非 workflow。
- **过度建模**：4 腿 two-phase pending→post + 失败 void + 整单 FAILED + `reverseSwap` 冲正，是从充提（有外部确认）照搬来的。**兑换是纯内部记账、资金不出境、无外部确认要等**，整单回滚/冲正这套对内部换币是多余的。
- **legacy 死码**：`SwapTransactionsService.findOne` 仍挂 `internalTransferService.findFundsOrderBySource`（实时模型恒空），是 2 个预存 `fundsOrders` 失败测试的根源。

---

## 2. 范围边界

**做：** swap-transactions 的 workflow 重写、删 settlement、domain findOne 清理、两个控制器、InternalFund 腿数据模型（attempt + NEEDS_REVIEW）、前端 swap 详情、demo-lib 适配。

**不做（明确不碰）：**
- **V7 funds-layer 活逻辑**（`fiat-settlement-workflow` 订阅 `SWAP_SUCCEEDED` 保持不变——只要 workflow 仍 emit 该事件即可）。
- **swap-fee-level 费率治理**（创建/变更/绑定审批子工作流，属配置治理，与兑换流无关）。
- **InternalFund 状态机本体不重写**（见 §11 deferred）——腿沿用现有 InternalFund 机器（含 SIGNING/CONFIRMING 等在途跳），仅**新增** `NEEDS_REVIEW` 态 + `attempt`。最小化对 withdraw 等共享 InternalFund 消费者的 blast radius。

---

## 3. 架构（一个 workflow，"结算"消失）

```
            旧                                    新
L3  SwapWorkflowService（只建单）          SwapWorkflowService —— 唯一当家
L2  SwapSettlementService（第二workflow）   ❌ 删除；大脑上交 workflow
                                            纯 TB 记账机械 → swap-leg-accounting helper（无状态）
L1  SwapTransactionsService（domain）       不变（create/markStatus/findOne，清 legacy 死码）
```

- **`SwapWorkflowService`（L3，唯一拥有者）**：建单 → 逐腿推进 → 成功 → 失败自愈 → 人工恢复 → 全部业务审计 + 事件。
- **`swap-leg-accounting`（无状态 helper）**：从 settlement 拆出的纯记账机械——`initiateLegPending` / `postLeg` / `voidLeg` + ctx 构建 + walletRef/evidence 解析。**不写审计、不发事件、不做生命周期/状态决策**（AccountingService adapter 定位）。被 workflow 调用。
- **`SwapTransactionsService`（L1，不变）**：实体持久化 + 状态机 + 查询；`findOne` 删 legacy `fundsOrders` 路径，只返 `internalFunds`（腿）。

---

## 4. 两台状态机（核心）

### 机器一：腿（InternalFund，每个 attempt 一条）—— 富状态在此

**状态**：`CREATED` → `(在途跳：沿用 InternalFund 现有机器，无记账)` → `CLEAR`（post，腿成功终态）｜`FAILED/TIMEOUT/RETURNED`（本次尝试失败）｜`NEEDS_REVIEW`（同 legSeq 失败满 N 次的挂起态，**新增**）

**转移**：
```
create ─▶ CREATED ─(advance: 挂pending)▶ 在途 ─(advance→CLEAR: post)▶ CLEAR ✅
                                     └─(advance→FAIL / 转账失败)▶ FAILED/TIMEOUT/RETURNED
                                            │ [同一事务内系统就地] voidLeg + 建新 attempt 腿
                                            ├─ attempt < N(=3) ▶ 新腿 CREATED（admin 重推）
                                            └─ attempt = N      ▶ 当前腿 NEEDS_REVIEW（挂起）
NEEDS_REVIEW ─(admin resume)▶ 建新 attempt 腿 CREATED
```

### 机器二：兑换单（swap）—— 薄，是腿的「投影」

**主状态（唯一生命周期轴）**：`PROCESSING`（建单即入，leg1 建好）→ `SUCCESS`（**每个 legSeq 恰有一条 CLEAR**）。
**取消**：旧 `FAILED` / `REVERSED` 终态删除（永不回滚）。
**关键**：swap 主状态不自跳，由腿投影——末腿 CLEAR → SUCCESS；其余皆 PROCESSING。

> 建单事务整体失败（swap 根本没建起来）仍写 `SWAP_FAILED` 审计（executeSwap catch），但这是"没建成"，不是 swap 的 FAILED 状态。

---

## 5. 腿生命周期：陆续创建 + 先收后付不变量

- **建单时**：只创建 **leg1** 并 initiate pending（不再一次性建 4 条）。
- **admin 推进第 N 腿至 CLEAR**：post 落定 → 若非末腿，**陆续创建第 N+1 腿** + initiate pending → admin 推下一条 → … → 末腁 CLEAR → swap SUCCESS。
- **先收后付（强制不变量）**：**leg1 永远是 SELL_CLIENT（客户卖币 / 公司先收钱）**；BUY_CLIENT（给客户钱）的腿被"卖出腿 CLEAR"这道**顺序闸**挡住，不可在卖出腿落定前创建/推进。`swap-leg-plan.constant.ts` 现有 CRYPTO_TO_FIAT / FIAT_TO_CRYPTO 已是此序（leg1=SELL、leg3=BUY、leg4=FEE），本设计将其从"碰巧"升级为**显式 guard + 测试**。
- **自愈安全性来自此序**：leg1 卖出失败 → 公司未收未付，void 后客户余额原样、纯净重试；buy/fee 腿失败时卖出已 CLEAR → 公司已收客户的钱垫着，重试买入**绝无"已付未收"敞口**。

---

## 6. 自愈失败模型

**一条腿落到 FAILED/TIMEOUT/RETURNED（在 admin advance 调用内，同一事务）：**
1. `voidLeg` 撤销该腿 pending（释放锁定，腁在 pending 阶段失败，void 干净）。
2. 该 attempt 标 FAILED 留作历史（不删）。
3. **自动新建同 legSeq 的新腿**（`attempt+1`）+ initiate pending；写 `SWAP_LEG_RETRIED` 审计。admin 随即推这条新腿。
4. **绝不回滚已 CLEAR 的腿、绝不整单 FAILED。**

**有限重试 → 人工挂起：**
- 同 legSeq 累计失败 **N = 3** 次 → 当前腁置 `NEEDS_REVIEW` + 写 `SWAP_LEG_STUCK` 审计/告警；**整单仍 PROCESSING**。
- 运营查根因后走 `POST :swapNo/legs/:legSeq/resume` → 建新 attempt 腿重推；写 `SWAP_LEG_RESUMED`。

**触发点**：推进是 admin 手动的，失败发生在 advance 调用内 → 同一事务就地 void+重建，无需额外事件/cron。

---

## 7. 对外 / 对内两个视图（一条生命周期，两个视图）

| 谁 | 看什么 |
|---|---|
| **客户** | `swap.status` ∈ {PROCESSING, SUCCESS} 套友好文案。腿卡住客户仍只看到"处理中"（tipping-off-safe）。 |
| **运营·详情页** | swap + **4 条腿**（角色=卖出/归集/买入/手续费、每腿状态、attempt 历史、STUCK 标记）。细节全在腿里。 |
| **运营·列表页** | swap + 两个**派生只读投影字段**：`currentStage`（当前活跃腁角色：SELL/BUY/FEE）+ `needsReview`（有腿 NEEDS_REVIEW 即真）。供列表筛/排"卡住的 / 卡在哪一步",免 join 腿。 |

**铁律**：`swap.status` 永远只有 PROCESSING/SUCCESS（对内对外同一主轴）。"卡住 + 卡在哪步"是**腿的投影**，不是 swap 的新状态——`currentStage/needsReview` 是显示用影子（随腁更新或读时计算），**不驱动任何行为**，行为永远由腿驱动。**不引入 BLOCKED，不把腿相位写进 swap.status。**

---

## 8. 审计 + 事件（全部归 workflow）

由 `SwapWorkflowService` 独家写/发：
- `SWAP_CREATED`（已有）— swap→PROCESSING
- `SWAP_LEG_POSTED`（**新增**）— 腿→CLEAR
- `SWAP_LEG_RETRIED`（**新增**）— 腿 FAILED→void+新 attempt
- `SWAP_LEG_STUCK`（**新增**）— 腁→NEEDS_REVIEW
- `SWAP_LEG_RESUMED`（**新增**）— NEEDS_REVIEW→新 attempt（人工）
- `SWAP_SUCCEEDED`（已有，**从 settlement 移回 workflow** 写 + 事务提交后 emit `DomainEventNames.SWAP_SUCCEEDED`，V7 fiat-settlement 仍能收到）
- `SWAP_FAILED`：仅保留**建单事务失败**那处（executeSwap catch）；腿失败导致的整单 FAILED **取消**。
- `SWAP_REVERSED`：**取消**。

---

## 9. 数据模型变更

- **InternalFund**：新增 `attempt`（int，默认 1；同 legSeq 多条=失败留 FAILED 历史 + 活跃一条）；状态枚举新增 `NEEDS_REVIEW`。"某 legSeq 活跃腿" = 最新非终态那条（或最大 attempt 的非 FAILED 条）。
- **SwapTransaction**：主 `status` 收敛为 {PROCESSING, SUCCESS}（移除 FAILED/REVERSED 的写入路径；历史值兼容读取）；新增派生投影列 `currentStage`（string nullable）+ `needsReview`（bool，默认 false）。
- 迁移安全：新增列 + 枚举值，不破坏现有行；`dev:rebuild` 验证。

---

## 10. 删除清单

- `SwapSettlementService` 整文件（机械拆入 `swap-leg-accounting` helper；大脑入 workflow）。
- `reverseSwap` + admin `POST :swapNo/reverse` 端点 + 前端冲正 UI。
- swap `FAILED/REVERSED` 终态的写入路径 + `TERMINAL_FAIL→void→FAILED` 整单失败逻辑。
- `SwapTransactionsService.findOne` 的 `internalTransferService.findFundsOrderBySource` legacy 路径（连带修 2 个预存 `fundsOrders` 失败测试）。

---

## 11. API / 前端变更

**API：**
- admin `POST /admin/swap-transactions/:swapNo/legs/:legSeq/advance` → **重接 `SwapWorkflowService`**（行为含自愈重建）。
- **新增** admin `POST /admin/swap-transactions/:swapNo/legs/:legSeq/resume`（恢复 NEEDS_REVIEW 腁）→ `SwapWorkflowService`。
- **删除** admin `POST /admin/swap-transactions/:swapNo/reverse`。
- 客户/admin 查询 DTO 暴露 `currentStage`/`needsReview` + 腿的 `attempt`。

**前端 swap 详情：** 去掉 reverse 按钮；advance 保留（走 workflow）；腁列表展示 attempt 历史 + NEEDS_REVIEW 徽章 + resume 按钮；列表页可按 `needsReview`/`currentStage` 筛。

**demo-lib：** `driveSwapToSuccess` 适配新推进路径（陆续建腿 + 逐腁 advance；无 reverse）。

---

## 12. 验收口径

- **TDD 新测**：① 腿失败 → 自动 void+重建（attempt+1）→ 重推 → SUCCESS；② 同腁失败满 3 次 → NEEDS_REVIEW、整单仍 PROCESSING；③ resume → 新 attempt → SUCCESS；④ **先收后付不变量**：买入腁在卖出腁 CLEAR 前不可创建/推进（应拒）；⑤ SUCCESS 当且仅当每个 legSeq 恰一条 CLEAR；⑥ `currentStage/needsReview` 投影随腿正确更新。
- **e2e**：`npm run demo:swap` 陆续 4 腁推到 SUCCESS 绿 + `DATABASE_URL=… TB_ADDRESS=… npm run verify:coa` ALL PASS；jest swap 模块绿（含修掉的 2 个预存失败）。

---

## 13. 风险与回滚

- **最高风险**：记账路径从 settlement 迁入 workflow + helper、自愈 void/重建触及真实 TB。缓解：保持 `initiate/post/void` 机械语义逐字搬移；`verify:coa` + demo:swap + 自愈/先收后付 TDD 兜底。
- **数据模型**：attempt + NEEDS_REVIEW + 投影列迁移，`dev:rebuild` 验证不破坏现有数据。
- 每步独立 commit、显式路径（隔离用户 recon 工作），任一步 demo 不绿即单步 revert。

---

## 14. 待确认 / deferred

- **InternalFund 在途中间跳精简**（对内部换币是装饰、无记账）：本期**不做**（沿用现机器，避免触及 withdraw 等共享消费者）；可作后续独立简化。
- **永久不可履约的 swap 的"放弃/取消"终态**：本设计无整单终态失败；若某腁根因无法修复（如货币对永久下线），目前只能停在 NEEDS_REVIEW。是否需要一个受控的 `ABANDONED`（带审批 + 把已 CLEAR 腁反向退回客户）路径——**deferred，待运营实际遇到再设计**。
- `currentStage/needsReview` 是"读时计算"还是"写时缓存列"：实现时择一（倾向缓存列 + 腁变更时同步更新，便于列表索引）。

---

## 15. 待评审确认项

1. §4 两台状态机（腿富状态 + swap 薄投影）是否认可。
2. §9 数据模型（InternalFund.attempt + NEEDS_REVIEW；swap 投影列）是否认可。
3. §14 deferred 三项是否接受推后。
