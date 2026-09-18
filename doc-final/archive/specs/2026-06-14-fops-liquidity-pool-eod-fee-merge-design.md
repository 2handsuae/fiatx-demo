# F_OPS 接管流动性池 + EOD 合并虚拟币手续费 — 设计

日期：2026-06-14
状态：**部分降级落地**。用户最终拍板「只做 F_LIQ→F_OPS re-point，保留 FEE_COLLECT，其他不动」。
EOD 合并费 / feeComponent / 退役 CRON / isFeePath 改动 **全部撤销不做**（gas 节省不值，且费用追溯属另一轮）。
实际落地见 commit `9295f0a`：仅白名单 + fiat/settlement workflow 的 F_LIQ→F_OPS。
下方第二节(EOD 合并)与第三节(退役 CRON)仅留作历史记录，未实施。

## 背景与目标

用户对 funds-layer 转账白名单的修正，本质是 **F_OPS 取代 F_LIQ 充当流动性池**，
F_LIQ 退役（只 re-point，留作 deprecated orphan，不删 enum/seed/DB）。

并入 **EOD 时把虚拟币手续费结算合并进 INTERNAL_OUT 转移**，目标是
**省一笔链上转账、省一笔 gas**：每个虚拟币资产在 EOD 时客户池↔firm 之间只动一次净额。

FEE_COLLECT 路径移除（枚举值保留兼容历史行，不再被任何路径调用）。

## 一、白名单 re-point（F_LIQ → F_OPS）

`internal-transfer-paths.constant.ts`：

| Path | 改前 | 改后 |
|---|---|---|
| INTERNAL_OUT | C_MAIN → F_LIQ | C_MAIN → **F_OPS** |
| INTERNAL_IN | F_LIQ → C_MAIN | **F_OPS** → C_MAIN |
| FIAT_SETTLE_OUT | C_VIBAN→F_LIQ, route [C_VIBAN,F_SET,F_LIQ] | C_VIBAN→**F_OPS**, route [C_VIBAN,F_SET,**F_OPS**] |
| FIAT_SETTLE_IN | F_LIQ→C_VIBAN, route [F_LIQ,F_SET,C_VIBAN] | **F_OPS**→C_VIBAN, route [**F_OPS**,F_SET,C_VIBAN] |
| FIAT_SPREAD_COLLECT | F_LIQ → F_FEE | **F_OPS** → F_FEE |
| FEE_COLLECT | C_MAIN → F_OPS | **移除整条**（与 INTERNAL_OUT 同 from/to 冲突；枚举值保留） |
| FIAT_FEE_COLLECT | C_VIBAN → F_FEE | 不变 |
| AGGREGATE / FUND_OUT / FUND_RETURN | — | 不变 |

下游 `resolve('F_LIQ')` → `'F_OPS'`：`fiat-settlement-workflow`、`fiat-fee-collection-workflow`、
`settlement-batch.service`。注释/`verify-two-book.ts` 的 F_LIQ 字样同步。

F_LIQ enum/seed/wallet-role-policies/DB 钱包：**保留**（deprecated，不再被路径引用）。

## 二、EOD 合并虚拟币手续费（核心，B2）

### 算法（每个虚拟币资产，在 `runEodSettlement` 内）

迭代资产集合 = {有 open crypto outstanding 的资产} ∪ {未归集 fee > 0 的资产}。

```
outstandingNetSigned = 当日 outstanding 净额，符号约定：正 = 池→firm(OUT)，负 = firm→池(IN)，0 = 无
feeNet = Σ(SUCCESS 提现 feeAmount) − Σ(feeComponent，非 FAILED/CANCELLED)   // 恒 ≥ 0，池→firm
combined = outstandingNetSigned + feeNet                                    // 有符号净额

combined > 0 → INTERNAL_OUT (C_MAIN→F_OPS)，amount = combined，feeComponent = feeNet
combined < 0 → INTERNAL_IN  (F_OPS→C_MAIN)，amount = |combined|，feeComponent = feeNet
combined = 0 → 不发转账；若 feeNet>0（被等额 inbound 抵消）仍需记账 feeNet 已归集（见边界）
```

**方向相反即省 gas**：outstanding 为 IN(firm→池) 时，fee(池→firm) 直接冲减 inbound 金额，
firm 少还即收费，一笔搞定。TB 净额与"分两笔"完全等价。

### feeComponent 追踪（迁移）

`InternalTransaction` 加 `feeComponent Decimal @default(0)`。EOD 那笔记下其中费部分。
自校正不变量改为 `应归集 = Σ成功提现fee − Σ feeComponent(非 FAILED/CANCELLED)`，
口径不变、中断重跑安全。加列 default 0、零回填、不破坏现有行。

### 边界

- 仅有 fee、无 outstanding 的资产：combined = feeNet > 0 → INTERNAL_OUT，正常一笔。
- 仅有 outstanding、无 fee：feeNet = 0，退化为现状逻辑（feeComponent = 0）。
- combined = 0 且 feeNet > 0（inbound 恰好抵消 fee）：不发链上转账，但 feeNet 需登记为已归集
  → 发一笔 amount=0 的记账型 internalTransaction（feeComponent=feeNet，无 funds leg、TB no-op）
  挂在 batch 上维持不变量。【待审：用零额记账行 vs 记在 netted-zero item，二选一，倾向零额记账行】
- combined = 0 且 feeNet = 0：现状 markSettledNettedZero 不变。

### TB 记账

合并后该笔走 INTERNAL_OUT/IN，`funds-accounting.isFeePath` 去掉 `=== FEE_COLLECT`
（只剩 FIAT_FEE_COLLECT）。虚拟币费随 combined 记 **SETTLE_POOL_TO_FIRM / SETTLE_FIRM_TO_POOL**，
不再单独 FEE_DECOMMINGLE（用户已确认 option A：过账等价，费金额经 feeComponent 可追溯）。

## 三、退役独立费归集

- `fee-collection-sweep.service.ts` 的 `@Cron('0 0 0 * * *')` 退役（不再单独跑虚拟币费归集）。
- `FeeCollectionWorkflowService.runFeeCollection` 的费计算口径**抽出复用**（EOD 调用），
  standalone batch 创建 + 独立 transfer 路径停用。手动 admin 入口若有，保留或一并退役（待确认）。
- `fee-collection-workflow` 的 `@OnEvent` recompute 处理：合并后费随 EOD batch，事件归 EOD 处理。

## 四、验收

- 白名单 spec（red→green）：6 处 re-point + FEE_COLLECT 不再被 resolvePathPolicy 命中。
- EOD spec：3 场景（纯 outstanding / 纯 fee / 二者合并含 IN 抵消）各断言一笔转账 + feeComponent + combined 方向。
- funds-accounting spec：INTERNAL_OUT 含费走 SETTLE_POOL_TO_FIRM；isFeePath 只认 FIAT_FEE_COLLECT。
- `feeComponent` 迁移应用到 branch DB。
- `verify-two-book.ts` 改为合并口径，全链跑通（改钱不变量护栏）。
- 全量 `npx jest` 0 failed + `npm run build`；重启 branch stack。

## 不在范围（follow-up）

- 给 crypto 开独立 F_FEE（让虚拟币费收入不混入 F_OPS 流动性池）——本轮 crypto 无 F_FEE，
  费进 F_OPS；治本另起一轮。
- F_LIQ 彻底删除（enum/seed/DB 迁移）——本轮只 re-point。
