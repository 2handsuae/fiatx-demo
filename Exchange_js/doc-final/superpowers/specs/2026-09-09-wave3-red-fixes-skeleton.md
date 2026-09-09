# 波三 · 业务红项修复 · Spec 骨架

> 总纲：`2026-09-09-acts345-trading-campaign-charter.md` §2 波三。本文件是骨架——波三新会话读总纲 + 下方承接记录后与业主脑暴展开，勿直接当 spec 执行。

## 承接上一波（波二报价单收口+单号统一收尾时填写）

- 波二合并基线 commit：`6c473e47`（2026-09-09 ff 合入 main；14 commits；主栈重铺见台账收官行）
- 审计名册基线：V4/V5/V6 = **47/33/22**（波二 V5 +3：`WITHDRAW_QUOTE_{CREATED,USED,CANCELLED}`）
- 单号现状：`WDR`/`FDO`/`WQT`/`SQT` 已统一上线，全仓四形态重扫零残留（终审带变异验证）；报价详情路由已 `:quoteNo`
- **执行中修掉的 pre-existing bug**：两报价详情页白屏（2026-05-30 起前端期望嵌套对象、后端恒返扁平行，tsc 恒绿运行必崩）已在波二顺手修——两报价模块现可完整走查；「tsc 不算数、⑤号渲染闸真有判别力」再添实证
- **plan 前提被实测推翻三处**（供波三 plan 手法参考——写 plan 时对"我记得的先例"要先复现）：①「审计不进事务」错（swap 真先例传 tx 第三参）②「兑换响应缺 quoteNo」错（2026-05-31 起就带）③「审计页主体可点进详情」错（生态级不存在）
- **新假阴性判例两条**（换号/退役类扫描配方要收编）：带省略号的 `WD…` 提法能躲过三形态 grep（demo-lib 生成区硬编码就是这么漏的）；引号字面交替组漏写 `'WQ'` 靠 `WQ-` 模式侥幸兜住
- **留给波三的四条观察**（终审 triage 定的口径）：
  1. `pricing-engine.service.ts:273` `buildWithdrawalQuote` 零调用死码（带 30s TTL 旧默认）——删码活，评审已证零调用方
  2. 审计页对所有 entityType 均无实体跳转（`AuditModules` 路由映射全仓零消费，SWAP_QUOTES 前例亦然）——是否补跳转属业务岔口，脑暴时问业主
  3. `BACKLOG.md` 头部「⭐ 共 15 条」实数 14（陈年漂移）——文档对账顺手项
  4. 六组验收截图未落盘归档（渲染验证发生过、有 DB 级实证兜底）——若波二收官走查已补拍则销此条
- 环境判例照旧：worktree jest 须 `export DATABASE_URL`；Node 20 显式切；jest 不接管道尾

## 已定事实（总纲阶段）

- 充值冻结留痕五连缺（铁律①）：correlationId select ×2（deposit `:1409`/withdraw `:1109`）+ `evaluateL1` FREEZE 分支（`:249-256`）零审计 + 验证 `.catch` 链路真落库——验收含第七幕按单号实拉冻结链
- 提现 tipping-off 三处快修：status 白名单 / `findAllForCustomer` 收窄 / client 筛选改 bucket 补集（照充值域抄）
- D6 三弧 kind 分弧（2→CONFISCATION / 3→RETURN / 4→SEIZE）+ 前端文案
- 小真账：E1 冻人 vs 卡单分旗 ｜ E3 operator 真实化 ｜ E5 resubmit 推 deadline ｜ D8 审批深链补 id ｜ I2 keyword 死参数接通 ｜ 充值受限横幅（业主裁定 2：兑换/提现事前可拦、充值本质不可拦）
- **纪律**：动 swap workflow 期间 demo:all 判红**先取证再 reset**（BACKLOG §A 姿势，1/13 记账失衡悬案头号嫌疑路径）
- 验收：demo:all + verify:coa + 第七幕拉链实证 + 走查截图

## 待定岔口（脑暴时与业主定）

1. 充值受限横幅的文案与落点（哪一页、拦不拦操作还是只提示）
2. E1「冻人 vs 卡单」分旗的语义边界（两旗各自驱动什么）
3. 审计页实体跳转要不要补（承接观察 2——补则 AuditModules 映射才有消费方）
4. 五连缺修复的验收深度（第七幕拉链到哪一环算过）
