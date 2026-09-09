# 波二 · 报价单收口 + 交易域单号统一 · Spec

> 总纲：`2026-09-09-acts345-trading-campaign-charter.md` §2 波二 ｜ 依据：体检 `checkups/2026-09-09-acts345-trading-domains.md` 报价单专查 + 2026-09-09 脑暴（四岔口业主逐一拍板，见 §1）｜ 所有锚点已在脑暴会话于当前 main（波一基线 `4151ea91` 之后）逐处复现。

## 承接上一波（波一清地基收尾时填写）

- 波一合并基线 commit：`4151ea91`（2026-09-09 ff 合入 main；主栈已 prisma:generate + rm dev.db + reset main + up + db:base:sync + demo:all 验绿）
- 审计名册基线：V4/V5/V6 = 47/30/22 码（波一删的是旧扁平对象死键，分域名册零触碰；文档码数已同步）
- 波一遗留给波二的：报价取消端点 `POST withdraw-transactions/quotes/:id/cancel` 去留（本波裁定：对齐接入，见 §1-2）；A3 死码处置无「在册未删」项（全部干净）
- 环境判例：全新 worktree 跑 jest 须 `export DATABASE_URL`（TOOLING-DEBT 在案）；树名连字符会被 stack.sh 归一为下划线

## 0. 本波做 / 不做

**做**：交易域四处单号统一换新前缀 ｜ 报价单六问题收口（号规 / UUID 清屏 / 互链 / 审计三码 / 死路由 / 取消对齐）｜ 提现报价 TTL 30→300 秒 ｜ 报价详情路由与端点换业务号 ｜ 文档同步与 BACKLOG 销账。
**不做**（对照项目总纲 §2 + 战役总纲 §3）：三域交易订单详情路由 `:id`→业务号（波五）｜ `CU`/`WA`/`AS` 两字母域外前缀不动（业主裁定，另立专项）｜ `DEP`/`SWP` 等合规三字母前缀不动 ｜ FundsOrderDetail 拼链与恒空展示位（波五）｜ 体检红项修复（波三）｜ 共享抽离（波四）｜ 不为旧数据写任何 backfill/兼容层（数据重铺）｜ 不动兑换报价 30 秒 TTL。

## 1. 业主拍板记录（2026-09-09 脑暴，四岔口全定；收尾登 decisions.md）

1. **前缀终定**：提现单 `WDR` ｜ 资金单 `FDO` ｜ 提现报价 `WQT` ｜ 兑换报价 `SQT`（脑暴会话已核全站 25 个在用前缀，四个均无撞名）
2. **取消对齐**：提现页接取消（不删端点）——两页流程同构（报价→确认框→成交/关闭），差异是漏写不是业务分叉；且审计三码要对称，删端点则取消码永不触发
3. **报价详情路由换业务号**：岔口现场查后消解——审批回链表零报价条目、入站链接仅两个列表页，深度=全量换键，无连带面
4. **订单详情报价区块**：摘要 + 链接口径（提现补小区块四样：报价号链接/命中档位/费额合计/报价时间；兑换只把 Quote No 变链接、删 UUID 行；完整明细看报价详情页，不重复铺）
5. **提现报价 TTL 30→300 秒**：提现报价锁的是费用快照不是汇率，30 秒过短致确认框内犹豫即撞过期；但不改无限长——费率会被管理台改，报价必须有时限否则砸费率配置演示口径；兑换报价锁汇率，30 秒不动（RFQ 行业标准）

## 2. 交付清单

### A. 单号统一（前缀换装，生产代码 6 处）

| 处 | 现状 | 处置 |
|---|---|---|
| `withdraw-workflow.service.ts:677` | `generateReferenceNo('WD')` | → `'WDR'` |
| `funds-order.service.ts:58` | `generateReferenceNo('FO')` | → `'FDO'` |
| `withdraw-quote.service.ts:120` | 野拼接 `` `WQ-${Date.now()}-${随机}` `` | → `generateReferenceNo('WQT')`（废除野路子，归一生成器） |
| `swap-quote.service.ts:482` | `generateReferenceNo('QUO')` | → `'SQT'` |
| `reconciliation-query.service.ts:795` | 补单回挂分流 `no.startsWith('WD')` | → `'WDR'`（同函数 `'DEP'` 分支不动） |
| `prisma/schema.prisma:975` | `SwapQuote.quoteNo String? @unique` | → 必填 `String @unique`（新增迁移，空库能建即可；`SwapTransaction.quoteId/quoteNo` 可空保持不动——不在承诺内） |

**连带换装**（脑暴会话已按 §3 判例全量扫过，命中即此清单）：

- 测试夹具 3 文件的旧号字面改新前缀（照波一「测试描述用真实码」判例）：`audit-logs.service.spec.ts`（`QUO26…`/`WD26…` 多处）、`adjustment.service.spec.ts:164,167`（`WD26…`）、`withdraw-applicant-actions.service.spec.ts`（`WD26…` 多处）——改后各文件整体跑绿
- 注释里的旧前缀例子 3 处：`scripts/demo-lib.ts:1029`、`scripts/demo-fixtures.ts:169`（这两条还留着「4 位随机」失真说法——生成器 2026-09-01 已改 6 位，换前缀时一并订正为如实描述）、`adjustment.service.ts:370`（虚构例号 `WD-E2E-…` 改 `WDR-E2E-…`）
- 业务文档 2 处：`demo/data.md:75`（`WD…` 例子）、`demo/script.md:108`（徽标 `WD…`）→ `WDR…`

### B. 报价单收口（UUID 清屏 + 互链 + 死路由）

| 项 | 现状 | 处置 |
|---|---|---|
| 管理台兑换订单详情 UUID | `SwapTransactionDetail.tsx:442` 渲染 "Quote ID"（UUID） | 整行删；`:441` "Quote No" 改为链接 → 兑换报价详情 |
| 客户端两页 UUID | `Swap.tsx:1049`、`Withdraw.tsx:841` 给客户渲染 `quoteId` | 改显示 `quoteNo` |
| 两报价列表跳转 | `SwapQuoteList.tsx:250` navigate `/SWAP/${UUID}`、`WithdrawQuoteList.tsx:247` navigate `${UUID}` | 改 navigate `quoteNo` |
| 死路由 | `App.tsx:213-215` 兑换报价两条路由（`:id` + `:business/:id`，后者 `:business` 恒 'SWAP'，且列表实际走的是这条） | 二合一 `trading/swap-quotes/:quoteNo`；提现同理 `:id`→`:quoteNo`（`App.tsx:211-212`） |
| 后端详情端点 | `GET admin/swap-transactions/quotes/:id`、`GET admin/withdrawal-fee-levels/quotes/:id`（按内部 id 查） | 改按 `quoteNo` 查（照客户域 `:customerNo` 前例，直接换语义不留旧端点）；两详情页 `useParams`/fetch 随之改 |
| rbac.catalog 登记 | `rbac.catalog.ts:377,567` 登记行带 `:id` 路径 | 同步改 `:quoteNo`；**合并 main 后必做 `db:base:sync` + 重启后端**（权限走内存定义，只 seed 不重启=403，判例在案） |
| 提现订单详情报价区块 | 数据链路已通（`WithdrawTransaction.pricingQuoteId` 外键在，纯屏上没显示） | 新增小区块四样：报价号（链接→提现报价详情）/ 命中档位（`matchedTierName` + `feeLevelCode`）/ 费额合计 / 报价时间；后端详情响应若缺这几个字段则补 select，不铺 feeBreakdown 全量 |

### C. 提现报价审计三码（对齐兑换侧）

- 新增 `WITHDRAW_QUOTE_CREATED / WITHDRAW_QUOTE_USED / WITHDRAW_QUOTE_CANCELLED`，照 `swap-quote.service.ts:247,320,368` 三处 `recordByActor` 写法逐一对称落点（创建 / 下单消费 / 客户取消）；**每次带显式 `requestId`**（照 swap 侧 `SWAP_QUOTE_CREATED_${quoteNo}_${uuid}` 模式，漏了会被静默去重）
- 名册登记照 SWAP_QUOTE 前例：扁平键 + V5 分域名册，**四属性出生即冻结**（含义 / domain WITHDRAW / correlationMode N / 特有必填，`assertActionSpec` 机器校验，对照 `audit-actions.constant.ts:875-877`）+ 新增 `WITHDRAW_QUOTE` 主体类型 + 审计界面主体路由映射（照 `:13` `SWAP_QUOTES` 前例，路由值用新 `:quoteNo` 形态）
- V5 名册 30→33 码；文档码数同步 2 处：`modules/v5-withdraw.md:64`、`demo/script.md:139`（第七幕缺口段 47/30/22 → 47/33/22）；若执行中名册实数有出入，以删/增后实数为准末尾统一复数（波一判例）
- **三域对称答卷**（delivery-checklist「改了交易三域」行）：充值域无报价概念，不涉及；本波即提现↔兑换报价对称化本身，收口后两域报价三码 / 取消 / 号规全对称，仅 TTL 刻意不对称（300s vs 30s，理由见 §1-5）
- 懒过期不加 EXPIRED 码——兑换侧就三码，对齐即止，不加戏

### D. 取消对齐 + TTL

- `Withdraw.tsx` 确认框关闭动作（现 `clearQuoteState`，`:269-272`，只清前端状态）加调已有端点 `POST withdraw-transactions/quotes/:id/cancel`（`withdraw-quote-customer.controller.ts:84`），仅报价仍 ACTIVE 且未过期时调，照 `Swap.tsx:471-486` `handleCloseConfirm` 写法；载荷继续用 `quoteId`（客户端 API 载荷本就走内部 id，兑换同款——铁律⑥管屏上与链接，不管载荷）
- `pricing.types.ts:151` `WITHDRAW_QUOTE_TTL_SECONDS` 30 → 300；执行时 grep 客户端有无写死 30 的倒计时/文案随常量走

### E. 文档同步（modules 层真相补录）

- `modules/v5-withdraw.md`：**现文对报价零着墨**（2026-09-09 复核 grep 零命中）——本波给提现报价加了审计三码 / TTL 300 / 取消入口后，按现状真相补一段报价生命周期（创建→消费/取消/懒过期，锚点 `withdraw-quote.service.ts`），并同步 §5 实现锚点；码数 30→33 见 C
- `modules/v6-swap.md`：TTL 30 秒提法不动（`:14/:52/:66`）；若 §5 锚点提及 `QUO` 号规则随 `SQT` 更新（执行时 grep 确认）
- `demo/data.md:75`、`demo/script.md:108` 前缀例子见 A；`script.md` 走查步骤无报价页操作变化，不动
- 各改到的文档 Last Verified 随改随更

### F. 收尾账目

- **BACKLOG 销账**：F3（提现报价零审计——本波 C 补齐）；零消费端点第 3 条（报价取消端点——本波 D 接入消费方）
- **decisions.md 登记**：§1 五条拍板（前缀终定 / 取消对齐 / TTL 300 及「报价必须有时限」口径）
- **立波三骨架 + 写承接记录**（delivery-checklist「多波中的一波」行）：`specs/` 新立波三骨架（总纲链接 / 空「承接上一波」节 / 已定事实 / 待定岔口），收尾时把本波实际偏差、执行中新事实、波三前提变化写进骨架承接节；**只写承接，不展开波三 spec**——那是波三新会话跟业主脑暴的活
- **CHANGELOG**：合并后一行（收尾时）

## 3. 换号判例纪律（执行任务硬前提）

1. **全量 grep 三形态**（判例：模板串/URL 字面 grep 必假阴性、UUID 与单号扫描按值不按字段名）：① 引号字面 `'WD'`/`'FO'`/`'QUO'`/`'WQ'`；② 单号值形态 `\b(WD|FO|QUO|WQ)2[56]\d{4}`；③ 前缀假设 `startsWith/slice/substring/正则`。范围含 `src/ scripts/ admin-web/ client-web/ prisma/ doc-final/`（archive 除外）。§2-A 连带清单即脑暴会话扫描结果；执行前在当前 HEAD 重扫一遍，多出命中先处置再动手
2. **零兼容层**：不写旧号识别、不写双前缀分流；改完 = reset 重铺（项目总纲 §3）
3. 动 `swap-quotes` 路由后 grep `verify-rbac.ts`/`verify-act1.ts` 确认无判据引用旧路径形态

## 4. 验收（对照 `rules/delivery-checklist.md`，本波触发项）

- **随手闸**：三闸 tsc 全绿；jest 圈定目录（trading 三域 + audit-logging + reconciliation/disposition + funds-orders）全绿；client-web 动了 → `npm run test:client`
- **收尾闸**：号规 + schema 都动 → 重铺闸 `stack.sh reset`（worktree 内 self）从零建库重铺 + `on-stack.sh <栈> demo:all` 全绿，判据对照 `demo/baseline.md`；demo:all 判红先按总纲 §4 悬案取证姿势抓现场再 reset
- **审计实证**：第七幕手法按新号抽查——造一张提现报价走完「创建→取消」和「创建→下单消费」两条路，审计日志按 `WQT…` 号可查全三码
- **前端截图**（preview 渲染，tsc 不算数）：两报价列表（跳转走业务号）、两报价详情（URL 是 `quoteNo`）、提现订单详情（新报价区块）、兑换订单详情（Quote No 链接、无 UUID 行）、客户端 Withdraw 确认框（关闭后报价被取消可从审计验证）
- **合并 main 后**：重启后端 + `db:base:sync`（rbac 路径变更）；动了 schema → `stack.sh reset main`

## 5. 待定岔口

（无——四岔口已于 §1 全部拍板。）
