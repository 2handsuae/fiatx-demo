# Swap 资金单编排（per-swap InternalFund orchestration）Design

> 状态：设计基线（pre-implementation）
> 日期：2026-06-25
> 适用：在实时 1:1 资金模型（spec `2026-06-25-realtime-1to1-funds-model-redesign-design.md`）之上，给 swap 补「真实物理转账单 + 两阶段记账」执行层
> 决策来源：2026-06-25 acceptance 中发现 swap 原子记账、缺资金单层；与 owner 收口

---

## 0. 一句话

> swap 不再「原子记账瞬间成功」。成交时建 **4 个 InternalFund（资金单）直接挂在 swap 上**，按序手动推进；**每条转账两阶段记账**（发起 pending → 完成 post → 失败 void）；4 腿全 post → swap `SUCCESS`；任一腿失败 → swap `FAILED` + 人工修复。

---

## 1. 决策（已与 owner 收口）

1. **不复用** funds-layer 的 InternalTransaction / 白名单 / transfer-workflow / `funds-flow.updateStatus`（那套耦合 InternalTransaction）。**InternalFund 直接挂 swap**，编排逻辑放 swap 模块。
2. **两阶段记账（D1 升级版）**：每条转账**发起即记 pending**（`executePendingTransfer`）、**完成转 post**（`postPendingTransfer`）、**失败 void**（`voidPendingTransfer`）。取代原子记账。
3. **D2 乙 手动推进**：腿建成 pending 态，由 admin 经 simulate 端点逐腿推进（生产由托管商 webhook 驱动；dev/验收用 simulate）。
4. **D3 乙 失败即 FAILED + 人工修复**：失败腿 void 自己的 pending；已 post 的前序腿保留，由人工修复入口冲正/重试（不做自动 saga 回滚）。
5. **pending 即锁**：leg1 卖出腿一发起就 pending 借记客户卖出币 → 可用余额立即下降，结算完成前不可双花；进账腿 pending 贷记 → post 前不计入客户可用。无需额外锁。

---

## 2. 复用 / 新增

**复用**：`InternalFund` 实体（+新字段）｜状态机转移表常量 `CRYPTO_TRANSITIONS`/`FIAT_TRANSITIONS`｜`SystemWalletResolver`（角色→钱包）｜`AccountingService.executePendingTransfer/postPendingTransfer/voidPendingTransfer`。

**新增**：
- `SwapSettlementService`（swap 模块，Layer-3 workflow）：建腿、按序推进、每腿两阶段记账、按 swap 汇总状态、写审计。
- InternalFund domain service 增 `createSwapLeg` / `transitionSwapLeg`（不依赖 InternalTransaction）——domain 写仍走 service（守平台铁律），但无旧编排耦合。
- simulate 推进端点（admin）。

**不用**：InternalTransaction、TRANSFER_PATH_WHITELIST、internal-transfer-workflow、funds-accounting mirror。

---

## 3. Schema 变更（InternalFund）

```
internalTransactionId  String?   // 改为可空（swap 腿不挂 InternalTransaction）
swapTransactionId      String?   // 新增 FK → swap_transactions，@@index
legSeq                 Int?      // 新增：1..4 顺序
```
（其余字段沿用：status / assetId / amount / fromWalletId / toWalletId / txHash / confirmations / statusHistory / completedAt…）InternalFund 仍是同一张表，只是腿可挂 swap 而非 InternalTransaction。

---

## 4. 4 腿结构（两个方向，恒 4 腿；fiat 侧经 SET 两跳、crypto 侧直连、fee 在 to 币）

**USDT → AED（卖 crypto / 买 fiat）**
| legSeq | 资金单 | 介质 | 类 |
|---|---|---|---|
| 1 | USDT `C_DEP→F_OPS` | 链上 | 跨账本 |
| 2 | AED `F_OPS→F_SET` | 银行 | 公司内 |
| 3 | AED `F_SET→C_VIBAN`（毛额） | 银行 | 跨账本 |
| 4 | AED `C_VIBAN→F_FEE`（费） | 银行 | 跨账本 |

**AED → USDT（卖 fiat / 买 crypto）**
| legSeq | 资金单 | 介质 | 类 |
|---|---|---|---|
| 1 | AED `C_VIBAN→F_SET` | 银行 | 跨账本 |
| 2 | AED `F_SET→F_OPS` | 银行 | 公司内 |
| 3 | USDT `F_OPS→C_DEP`（毛额） | 链上 | 跨账本 |
| 4 | USDT `C_DEP→F_FEE`（费） | 链上 | 跨账本 |

规则：**先卖后买再收费**；fiat 侧必经 F_SET（两跳，银行约束）；crypto 侧直连；fee 在 to 币、收到 F_FEE。腿的 `assetId.type` 决定走 crypto/fiat 状态机。

---

## 5. 每腿两阶段记账（pending→post→void）

腿**发起**（CREATED→首个在途态）即建 pending；腿 **CLEAR** 时 post；腿失败 void。各腿对应的 TB 转账（以 USDT→AED 为例；AED→USDT 对称）：

| legSeq | pending/post 的 TB 转账 |
|---|---|
| 1 | `SWAP_SELL_CLIENT` DR CLIENT_PAYABLE / CR CLIENT_ASSET（USDT）＋ `SWAP_SELL_FIRM` DR FIRM_ASSET / CR FIRM_OPS（USDT） |
| 2 | `SWAP_BUY_OPS_TO_SET` DR FIRM_OPS / CR FIRM_SET（AED） |
| 3 | `SWAP_BUY_SET_TO_ASSET` DR FIRM_SET / CR FIRM_ASSET（AED）＋ `SWAP_BUY_CLIENT` DR CLIENT_ASSET / CR CLIENT_PAYABLE（AED） |
| 4 | `SWAP_FEE_CLIENT` DR CLIENT_PAYABLE / CR CLIENT_ASSET（AED）＋ `SWAP_FEE_FIRM` DR FIRM_ASSET / CR FIRM_FEE（AED） |

合计 **7 条 TB 转账**（3 跨账本×2 + 1 公司内×1），每条经 pending→post 生命周期（evidence `transferType` PENDING→POST_PENDING；失败 VOID_PENDING）。跨账本仍是 2 条 / 笔物理转账——见实时 1:1 spec §6 解释。

---

## 6. 状态机 + 生命周期

**Swap 状态**：`CREATED → SETTLING → SUCCESS`（全腿 post）/ `FAILED`（任一腿失败）；修复冲正后 `FAILED → REVERSED`（见 §7）。新增 `SETTLING`、`REVERSED`。

**InternalFund 腿状态**：沿用 crypto `CREATED→SIGNING→BROADCASTED→CONFIRMING→CONFIRMED→CLEAR`（失败 FAILED/TIMEOUT）/ fiat `CREATED→CONFIRMING→CONFIRMED→CLEAR`（失败 FAILED/RETURNED）。

**流程**：
1. 客户确认 quote → `executeSwap`：保留前置校验（L1 eligibility、quote 有效）；**不再原子记账**；建 swap 行（`SETTLING`）+ 4 个 InternalFund 腿（`CREATED`，挂 swapId + legSeq）；**发起 leg1**（建 pending 记账 + 腿进首个在途态）。
2. admin simulate 逐腿推进：腿首次离开 CREATED = 发起 → 建 pending；腿到 CLEAR → post；**前一腿未 post 不得发起下一腿**（按序）。
3. leg4 post → 4 腿全 post → swap `SUCCESS`（写 SUCCESS 审计）。
4. 任一腿失败（FAIL/TIMEOUT/RETURN）→ void 该腿 pending → swap `FAILED`（写 FAILED 审计）；前序已 post 腿保留待修复。

---

## 7. 失败修复入口（D3 乙，最小版）

swap `FAILED` 时，admin 可执行命名修复动作（审计 + maker/checker 视风险）：
- **冲正（compensate）**：对已 post 的前序腿生成反向 TB 转账（post 的镜像）+ 释放客户锁定，swap 标 `REVERSED`。
- **重试（retry）**：对失败腿重建 pending 重新推进。

本版只需定义入口 + 冲正/重试两动作；自动 saga 回滚不做。

---

## 8. simulate 端点（D2 乙）

`POST /admin/swaps/:swapNo/legs/:legSeq/advance`（RBAC + 审计），body `{ action }`（SIGN/BROADCAST/SEEN_IN_MEMPOOL/CONFIRM/CLEAR/FAIL… 按腿币种状态机）。校验：按序（前腿未 post 不能动后腿）、动作合法（转移表）。CLEAR→post 记账；FAIL→void。生产替换为托管商 webhook 驱动同一推进方法。

---

## 9. 不变量 / 验收

- swap `SUCCESS` ⟺ 其 4 腿全部 `CLEAR` 且对应 TB 全 posted。
- 任意时刻：`verify:coa` 两条恒等式成立（pending 不破坏——TB pending 不计入 posted 余额；恒等式按 posted 算）。
- SETTLING 中：客户卖出币被 pending 锁定（不可双花）；买入币 post 前不可用。
- 端到端：建 swap→逐腿 advance→SUCCESS，期间逐腿 pending/post 可见；造一腿 FAIL→swap FAILED + 修复入口可冲正。

---

## 10. 不做 / 推后

- deposit / withdraw 同样改「资金单 + 两阶段」——本 spec 只做 swap；deposit/withdraw 后续按同模式（withdraw 已有 pending/post 雏形）。
- 自动 saga 回滚（D3 甲）。
- 真实托管商/银行 webhook 接入（dev 用 simulate）。

---

## 11. 决策日志（2026-06-25）

1. 不复用 InternalTransaction/白名单/transfer-workflow；InternalFund 直挂 swap。✅
2. 两阶段记账：发起 pending / 完成 post / 失败 void（取代原子记账）。✅
3. D2 乙 手动 simulate 推进。✅
4. D3 乙 FAILED + 人工修复（无自动回滚）。✅
5. pending 即锁，无需额外锁定。✅
