# Payin Simulation Controls 完备性补全 — 设计 spec(中间版)

日期:2026-06-11
状态:已确认(三档选**中间版**:链上语义闭环,不加入账后事故态)
范围:payin 状态机两处新转换 + sim 事件映射 + 详情页面板文案。无记账/联动变更。

## 0. 完备性审计结论(脑暴定案)

现状(payins.service.ts:396-432;depositActionMap.ts:117-128):
- crypto:`DETECTED--block-->CONFIRMING--confirm-->CONFIRMED--clear-->CLEARED`,`CONFIRMING--fail-->FAILED`
- fiat:`DETECTED--confirm-->CONFIRMED--clear-->CLEARED`,`DETECTED--fail-->FAILED`
- CLEAR 由 deposit 工作流自动调(deposit-workflow.service.ts:392),CONFIRMED 为瞬态;payin FAILED 已有 deposit 联动(deposit-workflow:65)。

| 缺口 | 判定 |
|---|---|
| crypto mempool 阶段失败(RBF/丢弃) | **本期补**:DETECTED→FAILED |
| 浅重组退回 mempool | **本期补**:CONFIRMING→DETECTED(新 action `reorg`) |
| 瞬态/终态时面板渲染一排灰按钮 | **本期补**:状态文案替代 |
| 深重组回滚(CLEARED 后) | 不做:客户已入账=资损事件,归对账/事故域(safeguarding warning + deposit FROZEN 通道),按钮表达会误导 |
| 银行退回/chargeback(fiat CLEARED 后) | 不做:同上,冲正属 reconciliation+incident 域 |
| 实收金额≠申报 | 不做:金额在 inbound signal 创建时定,属 signal 模拟域 |
| fiat 银行处理中间态 | 不做:状态机扩态收益≈0,YAGNI |

## 1. 后端(payins.service.ts + dto/payin.dto.ts)

- `PayinAction` 加 `REORG = 'reorg'`;`PayinMockEvent` 加 `REORG = 'REORG'`。
- crypto 状态机两处新转换:
  - `DETECTED`:`action === FAIL → FAILED`(mempool 丢弃/RBF);
  - `CONFIRMING`:`action === REORG → DETECTED`(浅重组退回 mempool,确认数清零语义)。
- mock 事件映射(crypto switch):`DROPPED → FAIL`(不变,状态机现在允许 DETECTED 也走);新增 `REORG → REORG`。fiat 不支持 REORG(落入既有 "not supported" 异常)。
- statusHistory 沿用现机制(reason `Action: reorg`)。
- 联动安全性(已核):CONFIRMING 阶段 deposit 仍在 PAYIN_PENDING,退回 DETECTED 无 deposit 影响;FAILED 联动已有。
- TDD 用例:crypto DETECTED+fail→FAILED;crypto CONFIRMING+reorg→DETECTED(可再 block→CONFIRMING 重走);fiat reorg → BadRequest;既有转换回归不破。

## 2. 前端(depositActionMap.ts + PayinDetail.tsx)

- `CRYPTO_SIM_ACTIONS`:
  - `DROPPED` 的 enabledStatuses 扩为 `{DETECTED, CONFIRMING}`,label 改 `⚡ Dropped / RBF Replaced`;
  - 新增 `{ event: 'REORG', label: '⚡ Reorg — back to mempool', enabledStatuses: {CONFIRMING} }`。
- 面板文案(PayinDetail Simulation Controls):sim mode 下计算 `hasEnabled = simActions.some(a => a.enabled)`;
  - 有可用按钮 → 现状渲染(disabled 的仍灰显,保留状态上下文);
  - 无可用且终态(CLEARED/FAILED)→ 显示一行 `Terminal state — no simulatable events`;
  - 无可用且非终态(CONFIRMED 瞬态)→ 显示 `Auto-progressing — ledger credit in flight…`。

## 3. 测试与验收

- payins.service.spec 新转换用例(TDD 红→绿);全量 jest 0 failed;build/admin tsc 零错。
- 手验:crypto payin DETECTED 直接 Drop → FAILED;走到 CONFIRMING 点 Reorg → 回 DETECTED 再重走全程;CLEARED 详情页显示终态文案。

## 4. 范围外

§0 表中四项"不做"(深重组/银行退回/金额不符/fiat 中间态)及失败 reason 输入框。
