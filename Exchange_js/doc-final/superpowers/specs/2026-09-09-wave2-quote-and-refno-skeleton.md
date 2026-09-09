# 波二 · 报价单收口 + 交易域单号统一 · Spec 骨架

> 总纲：`2026-09-09-acts345-trading-campaign-charter.md` §2 波二（业主定硬伤，提前至波二）。本文件是骨架——波二新会话读总纲 + 下方承接记录后与业主脑暴展开，勿直接当 spec 执行。

## 承接上一波（波一清地基收尾时填写）

- 波一合并基线 commit：`4151ea91`（2026-09-09 ff 合入 main；主栈已 prisma:generate + rm dev.db + reset main + up + db:base:sync + demo:all 验绿）
- 审计名册基线：V4/V5/V6 = 47/30/22 码（波一删的是旧扁平对象死键，分域名册零触碰；文档码数已同步）
- 波一遗留给波二的：报价取消端点 `POST withdraw-transactions/quotes/:id/cancel` 去留（波一按裁定未动）；A3 死码处置无「在册未删」项（全部干净）
- 环境判例：全新 worktree 跑 jest 须 `export DATABASE_URL`（TOOLING-DEBT 在案）；树名连字符会被 stack.sh 归一为下划线

## 已定事实（体检 + 总纲阶段）

- 单号违规三处：提现单 `WD`（withdraw-workflow.service.ts `generateReferenceNo('WD')`）、资金单 `FO`（funds-order.service.ts:58）、提现报价 `WQ-${Date.now()}-随机`（withdraw-quote.service.ts:120，未走生成器）
- 前缀建议（spec 终定，业主可改）：`WDR` / `FDO` / `WQT`；兑换报价 `QUO`→`SQT` 对称化（照 SFC/WFC 先例）
- 已知硬编码前缀分流仅 2 处：`reconciliation-query.service.ts` `startsWith('DEP')/('WD')`；scripts/docs 例子须全量扫（换号判例：全量 grep 入站链接）
- 报价单六问题：两套号规｜UUID 上屏三处（admin SwapTransactionDetail "Quote ID"、client Swap.tsx:1049、Withdraw.tsx:841）+ 两报价列表 navigate UUID｜订单↔报价互链断（提现订单详情零报价信息、兑换报价号非链接）｜提现报价全生命周期零审计（对齐 SQT 侧三码）｜`swap-quotes/:business/:id` 死参数路由｜取消动作不对称（swap 页会取消、withdraw 页从不）
- swap `quoteNo` 列可空 → 改必填（数据可重铺）
- 铁律⑥约束：报价对外一律业务单号；数据随时重铺零兼容层

## 待定岔口（脑暴时与业主定）

1. 前缀名终定（WDR/FDO/WQT/SQT 或业主另定）
2. 取消动作：对齐（withdraw 页接 cancel）还是删端点
3. 报价详情路由换业务号的深度（连带 approvalEntityRoutes 之类回链有无涉及）
4. 订单详情「报价区块」展示哪些字段（费额/档位/汇率快照的口径）
