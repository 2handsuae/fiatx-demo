# 第六幕清残留 · 波二「清死物」—— 骨架

> 总纲：`superpowers/specs/2026-09-19-act6-recon-cleanup-charter.md` §3 波二行
> 本文件是骨架，**不是 spec**。波二 spec 的展开是下一个新会话读总纲 + 本承接后跟业主脑暴的活。

## 承接上一波（波一，2026-09-19 收官）

- **实际偏差**：
  - 计划 13 个类型错，实际恰好 13 个、位置逐条吻合（spec §1 的表零偏差）；`wallet-recon-run.service.ts:305/:366` 的快照 push **未连带暴露字段问题**——实现者按 schema 逐字段核对、任务评审又独立对 `model ReconciliationRunWallet` 17 个键逐一复核，两处 push 对象零改动。
  - jest 全程用本 worktree 的 self 栈库（`file:/tmp/exchange_js_wt_act6_wave1/dev.db`），不是 plan 原文写的 main 库——端口隔离铁律优先，属操作性偏差，结果数字与 plan 判据一致（28 suites / 553 tests）。
  - Task 8 的全文件 sed 误伤了 `supplement-evidence.service.ts:143-146` 前人事故注释里引用的 `(this.prisma as any)` 字面（历史记录字面变自相矛盾），主会话当场还原并补注「该逃逸已于波一摘净」（394b9f59）——**判例：全文件字面替换会咬到注释里的历史引用，收尾要扫一遍注释层**。
  - 波一收尾检查表 E 段「diff 零新增 as any」的 grep 命中 1 处 = 上述注释还原行（纯文档），非代码逃逸。
- **执行中发现的新事实**：
  - Task 6/7/8 共补 5 条显式守卫（disposition 与 adjustment 的 walletRef null、adjustment 的 assessedAmount null、supplement 的 kase null / walletRef null / ownerId null / direction 收窄）。其中 assessedAmount 守卫在可达状态上是**死防御**（`incident.service.ts:280` 强制定损时两字段同写、核销先查 FIRM_LOSS），未记 BACKLOG；**跨钱包合成案件（walletRef 为空）不能记定性/开调账单**这条真业务缺口已记 `BACKLOG.md` §G（Task 6）。
  - 这些新守卫分支**均无自动化测试覆盖**（三域 553 绿全部走 walletRef 非空 fixture）——两任务评审独立确认并定级为观察非缺陷（本波窄授权不补测试），但绿灯不代表这些分支被验证过。
  - 三域仍残留 **26 处非 prisma 的 `as any`**（审计载荷 12、记账边界 4、controller 入参 4 等）——波前已登记 `TOOLING-DEBT.md`（1ca13cfa），本波一处未碰，各任务评审逐一确认原样留存。
- **波二前提有无变化**：不变。红 3（`externalTimestamp`）、12 根死列、两个幽灵筛选项（`WAIVED`/`PENDING_RECHECK`）、运营收 `INTERNAL_TRANSFER_READ` ＋ `FundsOrderDetail.tsx` 连带链接、External Balances 被劫持——边界按总纲 §3 波二行原样。

## 已定事实（波一带过来的）

- 对账三域 180 处类型逃逸已归零；闸① 现在对该域数据层**有效**（变异实证在案：同一个改错列名的操作，波前 `gate-before.txt` EXIT=0 零报错，波后 `gate-after.txt` EXIT=2 且点名 `slaBreachedTYPO` 不存在——两份物证都在 `checkups/2026-09-19-act6-wave1-evidence/`）。
- **但闸① 不咬「省略可选字段」**——红 3（`externalTimestamp` 零写入）这类缺陷**波一防不住**（实测 13 个错里没有它），波二必须自建「断言写进去的行长什么样」这道防线，否则删完死列还会再长一根。
- 零行为变更已以栈级输出 diff 实证（归一规则与残差裁定见 `checkups/2026-09-19-act6-wave1-evidence/` 的收尾记录）。

## 待定岔口

- 红 3 的两条路（写它 / 退役它）二选一，需在波二 spec 里定。**主会话复判时的建议在案**（2026-09-19）：选甲（写入）——`ext.datetime` 就在匹配器 `take()` push 现场（`wallet-flow-matcher.service.ts:299-303`），约 3 行；同时读端 `reconciliation-query.service.ts:703` 的 epoch 兜底改为如实下发 null。演示价值：场景 1「钱在路上」的外部出账时间是故事的一部分，且修好在途行恒排最旧的排序。
- 运营收权限那条，连带 `FundsOrderDetail.tsx` 的无条件关联链接同改（总纲 §5 已定，此处只是提醒别漏）。
