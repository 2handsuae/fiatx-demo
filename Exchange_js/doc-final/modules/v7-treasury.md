# V7 · 财资（公司的钱怎么给客户）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-09-05（平账二期：内部划转单落地）
> 演示幕次：第六幕场景 16 / 17 ｜ 验收：第六幕走查（`demo/script.md`）+ `modules/v8-recon.md` §4

## 0. 一句话定位

管**公司自己的钱放进客户钱包**这件事。它是第四类订单（决策 2026-08-28）：有意图、有审批、有执行、有资金单跟着在途、有账本分录收口。二期只做公司 → 客户两条路：**认损补款**、**退汇垫款**；公司池之间的调拨不做（结算户是过渡户，兑换每笔进多少出多少）。

## 1. 业务叙事

**短缺 = 托管里的钱比账本记的少。** 两种：查不出的短缺（认损 + 补款）；退汇造成的短缺（先垫后扣）。两种都要**先让账说真话，再由公司真金白银补进去**——认损让案子愈，补款是对客户的交代；垫款金额锁定等于差额，先垫后扣，客户欠公司的三期追索。

**每一步真人开单、真人裁决。** 运营查证定性、金库在案子上发起、CFO 单步复核；金额不可改（多一分都是往客户钱包塞钱）。

**法币必须经结算户。** vIBAN 与运营户不能直转：运营户 → 结算户 → 客户 vIBAN 两腿，与兑换买入腿同一条物理路线；加密币一腿直达。

**钱在路上时对账不红。** 腿一提交，模拟托管方就写两行对账单；账本在腿确认时落账、同一参考号。对账在两钱包各找到一张没走完的资金单，落在途桶。

## 2. 状态机（六态六边）

`PENDING_APPROVAL → EXECUTING → SUCCESS`；`PENDING_APPROVAL → FAILED（批了运营户没钱）/ REJECTED（拒绝 / 超时）/ CANCELLED（金库撤回）`；`EXECUTING → FAILED（腿失败）`。不设草稿、不设「已批准」中间态、不计时。资金单腿：加密币一腿沿出金表 5 跳，法币两腿各 4 跳，腿 1 清算后腿 2 才诞生。

## 3. 决策点与角色

| 动作 | 谁发起 | 谁裁决 | 要点 |
|---|---|---|---|
| 发起补款 | 金库（案件页，认损落账后） | CFO 单步 | 金额 = 认损额；同一认损单只能有一张未走完 / 已成功的划转单 |
| 发起垫款 | 金库（案件页，退汇行余额不足时） | CFO 单步 | 金额 = 账单行 − 客户可用；到账后「认领退汇」回来 |
| 撤回 | 金库（待批时） | — | 执行中不许撤 |
| ⚡ 推腿 | 运营（资金单页） | — | 提交写回单、确认落账 |
| 批准时余额复核 | 系统 | — | 运营户不够 → FAILED，不建资金单 |

## 4. 演示脚本

第六幕场景 16（Alice USDT：认损 → 补款，一腿）与 17（Grace AED：垫款 → 认领，两腿）——步骤在 `demo/script.md`。

## 5. 关键技术节点

- 主体 `asset-treasury/internal-transfers/internal-transfer.service.ts`（迁移表 / 建行 / 零 UUID 投影 / 运营户余额闸）｜ 工作流 `internal-transfer-workflow.service.ts`（发起 / 撤回 / `workflow.internal-transfer.decided` / `FUNDS_ORDER_STATUS_CHANGED`：提交写回单、确认落账 81/82/83 并清算、失败三种原因码）｜ 审批 `INTERNAL_TRANSFER_APPROVAL`（CFO 单步 48h 可撤）｜ 端点 `admin/internal-transfers/{compensation,advance,:no/cancel}` + 列表 / 详情
- 对账域：`reconciliation/simulation/simulated-custodian-statement.service.ts`（模拟托管方回单）｜ 读面 `disposition/funding-next-step.ts`（`COMPENSATION` / `ADVANCE`）
- 资金单第四父键 `internalTransferId`（沿出金走法表）｜ 转账码 81–83 ｜ 审计七码 `V7_TREASURY_AUDIT_ACTIONS`（域 TREASURY）｜ 权限 `INTERNAL_TRANSFER_READ / WRITE`（桶 `treasury.view_transfers` / `treasury.act_client_funding`）
- 表 `internal_transfers`；客户可见面：账本对账单行「平台补款 / 平台垫付」（客户侧腿事件码分）

## 6. 演示缺口（BACKLOG 有账）

- 公司池调拨（备付 / 归集）不做；手续费归集等报表层
- 法币腿 2 失败后款项停在结算户，人工处理，不做自动退回
- 追索三期：垫款只登记不入账，账上无应收科目
- 铺场前不得有在途划转（脚本前置闸）
