# 地基站 · 资金单处置动词（DispositionService）设计稿

日期：2026-08-26 ｜ 分支：refactor/ledger-disposition-verb ｜ 依据：主会话三轮设计业主过目通过（蓝图侦察 + 落点 + 做/不做）
性质：Phase 4 第一站（样板仗）——建拆分离原则下唯一的"建"；站 2 提现 / 站 3 兑换按本图纸复演。

## 1. 蓝图（充值三条处置链的异同，代码指纹实测）

| | 没收 CONFISCATE | 退回 RETURN | 上缴 SEIZE |
|---|---|---|---|
| 账本锁定腿 | 2 笔：SUSPENSE→CLIENT_ASSET + FIRM_ASSET→INCOME_OTHER | 1 笔：SUSPENSE→CLIENT_ASSET | 1 笔：SUSPENSE→CLIENT_ASSET |
| 资金单 legSeq / 去向 | 2 / 公司费钱包 | 3 / 原发款方（锁死） | 4 / 留空（政府） |
| eventCode 族 | CONFISCATE_REVERSE_SUSPENSE / CONFISCATE_INCOME_OTHER（+_VOID） | RETURN 族 | SEIZE_REVERSE_SUSPENSE（+_VOID） |
| 失败重试 | 三级梯（第四批后三弧已统一） | 三级梯 | 三级梯 |
| 终态动作 | CONFISCATE_SETTLE | RETURNED_DONE | SEIZED_DONE |

差异收敛为参数：锁几笔账（科目对数组）、腿号、去向、eventCode 前缀。抽象条件成熟。

## 2. 动词 API（落点：funds-orders 模块）

```
DispositionService.start(spec: DispositionSpec)
DispositionSpec = {
  kind: 'CONFISCATE' | 'RETURN' | 'SEIZE',
  sourceType: 'DEPOSIT',            // 站2起扩 'WITHDRAW'
  sourceId, sourceNo,
  legSeq, asset, amount,
  destination: { toWalletId? toAddress? toIban? },   // 退回=原发款方 / 上缴=空 / 没收=费钱包
  tbLegs: [{ eventCode, debitCode, creditCode }],    // 1 或 2 笔
  maxAttempts: 3,
}
内部自理：建资金单腿(CREATED, attempt) → 挂账本 pending 锁 → 认领 funds_order.status.changed
  CONFIRMED → post 全部 pending + 腿收口 CLEARED → emit disposition.settled {sourceType, sourceNo, kind, attempt}
  FAILED/TIMEOUT → void 本 attempt 全部 pending → attempt<max 重建新 attempt / 耗尽 emit disposition.exhausted
```

工作流保留（业务层，一样不少）：发起审批、批准后组 spec 调 `start()` + 推订单入"处置中"、
订阅 `disposition.settled` → 推订单终态 + 业务审计、订阅 `disposition.exhausted` → needsReview 红旗 + 审计。

## 3. 保真不变量（一条都不许丢）

1. 决定性转账号 `deterministicTransferId(sourceType, sourceNo, eventCode, attempt)`——pend/post/void 三方同 attempt 复算
2. post/void 对 already_posted/already_voided 赦免为幂等 no-op（账本层已有，不重写不绕过）
3. 三级梯语义原样：FAILED/TIMEOUT → void + 重建 attempt+1，attempt=3 耗尽停手
4. 腿收口 CLEARED（settle 后必收；吞异常不上抛、already terminal 视为幂等成功）
5. 订单状态只由订单主体迁移表迁（铁律 §5.3/5.4）；业务审计留在工作流编排层（审计规则）
6. 行为保真判据：demo:deposit / demo:all 终态断言逐字不变 + verify:coa 全绿 + 演示画面不变（纯后端重构，UI 零触碰）

## 4. 任务清单

- T1 DispositionService 内核（start + spec 类型 + 事件认领 + settle/fail 三级梯）＋注册进 FundsOrdersModule
- T2 没收弧搬家（六件套 → 组 spec + 两订阅；删旧六方法）
- T3 退回弧搬家（同形）
- T4 上缴弧搬家（同形）
- T5 测试收编：删"扫源码找 settle*"守则测试；三弧 workflow spec 改断行为（或迁 DispositionService spec）
- T6 收尾：闸门（tsc×3 + 相关 jest 净新 0 对照 baseline + demo:deposit/demo:all/verify:coa on self 栈）→ modules/v4-deposit.md §5 + funds-orders.md §5 锚点更新 → CHANGELOG B 类一行

## 5. 本站不做

不动账本本体/科目/恒等式（decisions 在案）｜不动审批与状态机语义｜不碰提现/兑换（站 2/3）｜不切审计词表、不删其余兜底（站 1b）｜解冻弧（零记账，无腿）不属处置动词范围，原样不动
