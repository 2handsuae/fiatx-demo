# F_OPS 流动性池 + EOD 合并虚拟币费 — 实施计划

Spec：`doc-final/superpowers/specs/2026-06-14-fops-liquidity-pool-eod-fee-merge-design.md`

状态：**降级——仅执行 F_LIQ→F_OPS re-point(commit 9295f0a),T2-T5(feeComponent/EOD合并/退役CRON/verify改写)全部不做**。

判定：**大**（改钱不变量 + Prisma 迁移 + 净额方向边界）→ spec+plan 先停，审过再执行。
执行时建议**串行**（不并行 subagents）：T1→T2 是 T3 的前置，T3 是核心改钱逻辑，
必须独占上下文 TDD，不能并发改同一批 funds-layer 文件。

## T1 — 白名单 re-point + 移除 FEE_COLLECT（TDD）

- [ ] 红测（whitelist + funds-accounting spec）：
      INTERNAL_OUT.to=F_OPS / INTERNAL_IN.from=F_OPS；FIAT_SETTLE route 经 F_OPS；
      FIAT_SPREAD_COLLECT.from=F_OPS；resolvePathPolicy('C_MAIN','F_OPS')→INTERNAL_OUT；
      FEE_COLLECT 不在 record 内
- [ ] 改 `internal-transfer-paths.constant.ts`（保留 enum 值，删 record 条目）
- [ ] 改 `fiat-settlement-workflow` / `fiat-fee-collection-workflow` / `settlement-batch` 的 resolve('F_LIQ')→F_OPS
- [ ] `funds-accounting.isFeePath` 去掉 FEE_COLLECT
- [ ] 绿测

## T2 — feeComponent 迁移 + 费计算口径抽出（TDD）

- [ ] Prisma `InternalTransaction.feeComponent Decimal @default(0)`，
      `npx prisma migrate dev --name internal_tx_fee_component`
- [ ] 把 fee 净额计算 `Σ成功提现fee − Σ feeComponent(非FAILED/CANCELLED)` 抽成可复用方法
      （domain service 或 helper），红测覆盖差额自校正
- [ ] 绿测

## T3 — EOD 合并费（核心，TDD）

- [ ] 红测 `eod-settlement-workflow.spec`：
      ① 纯 outstanding（feeNet=0，一笔，feeComponent=0）
      ② 纯 fee 无 outstanding（combined=feeNet>0→INTERNAL_OUT 一笔，feeComponent=feeNet）
      ③ outstanding IN + fee 抵消（combined 方向/金额正确，feeComponent=feeNet 记上）
      ④ combined=0 且 feeNet>0（零额记账行 feeComponent=feeNet，无 funds leg）
- [ ] `runEodSettlement` 改：资产集合 union（outstanding ∪ fee>0）；每资产算 combined；
      一笔转账带 feeComponent；边界按 spec
- [ ] 绿测

## T4 — 退役独立费归集 CRON

- [ ] `fee-collection-sweep` @Cron 退役（删/no-op）
- [ ] `FeeCollectionWorkflowService` standalone 路径停用（计算口径已被 T2 抽出复用）；
      事件处理归并/清理
- [ ] 相关 spec 调整

## T5 — verify-two-book 合并口径 + 终验

- [ ] `verify-two-book.ts` 改为：EOD 合并扫费、F_LIQ→F_OPS、一笔净额
- [ ] 跑 `verify-two-book` 全链通过（贴输出）
- [ ] 全量 `npx jest` 0 failed + `npm run build`
- [ ] `feeComponent` 迁移已在 branch DB；重启 branch stack
- [ ] 勾选计划 + 分层提交
