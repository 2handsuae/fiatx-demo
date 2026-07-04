# recon 引擎单位契约统一（canonical minor）设计

> 日期：2026-07-04 ｜ 状态：设计定稿（脑暴判定深度=乙/中档）｜ 分支：demo-realdata
> 范围：修 recon 引擎"元/分两个 scale 世界"根因——把匹配器统一到分（minor），外部对账单行 + funds_order 金额进引擎边界按 `asset.decimals` 换算。前置于 demo 真实数据夹具的完整 heal 闭环（`2026-07-04-recon-demo-realdata-design.md`）。
> 触发：真实卡单 push 后 delta 不归 0（=49302=49800−498=498×(100−1)），根因锁定 `wallet-recon-run.service.ts:202` 在途金额（元）塞进余额残差（分）。

---

## 0. 决策记录

| # | 问题 | 结论 | 依据 |
|---|---|---|---|
| 1 | decimals 来源 | **统一来自 asset 表**（用户原则） | 查询层 `reconciliation-query.service.ts:524-538` 已是 `asset.findMany({select:{code,decimals}})`；引擎目前一处不用 decimals（裸 BigInt） |
| 2 | canonical scale 定谁 | **分（minor）** | 对齐 TB/account_flows 记账真相源；余额核对器已是分（`wallet-balance-checker.service.ts:14-15` 契约注释 + :191 delta=closing−internal 皆分） |
| 3 | 换算点在哪 | **匹配器输入边界**（乙/中档） | 匹配器从此全程活在分，`inTransitSigned` 自然同单位，非在 `:202` 打补丁（甲/窄）；也不迁移存储（丙/宽） |
| 4 | 存储改不改 | **不改** | external 行仍存元、account_flows 仍存分；只引擎读入时换算。展示层不动（已 分→元） |

## 1. 根因（两个 scale 世界，一处交汇）

| 组件 | 金额源 | 单位 |
|---|---|---|
| 余额核对器 `wallet-balance-checker` | account_flows + external_balances.closing_balance | **分** |
| 匹配器 `wallet-flow-matcher` | external_statement_lines.amount + funds_orders.amount | **元** |

两世界各自自洽（分比分/元比元），唯一交汇 = `wallet-recon-run.service.ts:202` 把匹配器在途金额（元）reduce 进余额残差（分）：
```ts
const inTransitSigned = matcherResult.inTransit.reduce(
  (s, it) => s + (it.direction === 'IN' ? BigInt(it.amount) : -BigInt(it.amount)), 0n);  // it.amount = 元
// 下方 residual = balanceCheck.delta（分） vs inTransitSigned（元） → 差 10^decimals 倍
```
orphan/mismatch 是**计数**不跨 scale，故观测 bug 仅此一处，但根是两世界裂缝。demo 用 `bumpClosing(裸元)` 造在途——外部差与在途金额都是元自抵，蒙混过关；真实 push 按分动账（49800）才暴露。

## 2. 设计：匹配器统一到分

### 2.1 decimals 供给（run 服务，从 asset 表）
`wallet-recon-run.service.ts` run 开头批量查该批钱包涉及币种的 decimals（照 `reconciliation-query.service.ts:524-532` 同款：`asset.findMany({where:{code:{in:currencies}}, select:{code,decimals}})`），得 `Map<currency, decimals>`。每钱包按 `bal.currency` 取 `decimals` 传入匹配器。

### 2.2 匹配器边界换算（`wallet-flow-matcher.service.ts`）
匹配器 `matchFlows` 入参加 `decimals: number`。在**读入即换算**（进匹配逻辑前）：
- external_statement_lines 的 `amount`（元）→ 分：`amount × 10^decimals`（用 Prisma.Decimal 乘，`.toFixed(0)` 取整 BigInt）。
- 候选 funds_order 的 `amount`/`netAmount`（元）→ 分：同法。
换算后 `amountOk`（分==分）、`inTransit.amount`（分）全在分。`take()` 里 `amount: <分>.toString()`。
> ⚠️ 换算用 `Prisma.Decimal` 避免浮点；元值可能带小数（如 AED 4380.56），×10^decimals 后必为整数（decimals 足够），`.toFixed(0)` 安全——顺带消解 T2 发现的 `BigInt(分数)` 崩溃（分数元 → 整数分）。

### 2.3 run 服务残差（`:202` 零改）
匹配器输出既已是分，`inTransitSigned = Σ ±BigInt(it.amount)` 天然与 `balanceCheck.delta`（分）同单位，`:202` 一行不动。`residual = delta − inTransitSigned` 正确。

### 2.4 不动的
- 余额核对器：已分，不动。
- 查询/展示层：已按 asset.decimals 分→元展示，引擎统一到分后展示口径不变，不动。
- 存储：external 行/余额/account_flows 存储 scale 不动（丙 不做）。

## 3. 联动 demo 夹具（本 spec 落地后 demo-realdata 才能收口）

- **夹具外部镜像改真实分**：`createStuckWithdraw`/`createStuckSwap`（`demo-fixtures.ts`）现设 `closing = 内部分 − 裸元(498)`；引擎统一分后须改 `closing = 内部分 − (元 × 10^decimals)`（=真实分 49800）。这样修后仍 IN_TRANSIT（delta=−49800、inTransit 换算=−49800、残差 0），且 **push 后真实分动账（49800）与外部分镜像相抵 → delta 真归 0 → case AUTO_HEALED**（补齐 heal 闭环）。
- **场景 2-9 不受影响**：余额 delta 检测型（delta≠0 即 break），与在途换算无关；`bumpClosing(元)` 造的 delta 仍触发 break，金闸门 9/9 保持。
- **顺带修**：T2 发现的分数在途金额 `BigInt` 崩溃（chip task_3d7c3fdd）被 2.2 的元→整数分换算根治，createStuckSwap 的"整数 grossTo"绕开 + `toAsset.decimals>2` 限制可**撤除**（6-8 位 to-asset 方向重新可用）。

## 4. 验收标准

- [ ] 单测：匹配器 given decimals=2 + external line 498 元 → in-transit amount = 49800 分（红→绿）
- [ ] 单测：AED 4380.56 元 × 10^2 = 438056 分，不再 `BigInt` 崩
- [ ] e2e：`demo:in-transit`（夹具改分镜像后）→ recon IN_TRANSIT 残差 0 → push sync CLEARED → 重对账 **delta=0、case AUTO_HEALED**（**这是整件事的目标**）
- [ ] 金闸门：`recon:demo:break` 九场景 9/9 DETECTED + 两恒等式，改前改后一致（in-transit 场景 1 由真夹具供）
- [ ] createStuckSwap 撤 `toAsset.decimals>2` 限制后，AED→USDT 方向也能造在途（可选验证）
- [ ] 后端 tsc 0 / jest 净新增失败 0（匹配器既有 spec 跟进换算：fixture 金额若断言分值需同步）

## 5. 明确不做

存储 scale 迁移（丙——external 行/余额改存分）｜展示层改动｜容差/舍入策略变更（换算是精确 ×10^n，无舍入）｜非在途路径的 scale（orphan/mismatch 是计数，无金额跨界）
