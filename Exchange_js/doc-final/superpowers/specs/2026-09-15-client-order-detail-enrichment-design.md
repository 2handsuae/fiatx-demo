# 客户端三域订单详情增强（丙档：全字段 + 时间线）· 设计稿

2026-09-15 立 ｜ 业主脑暴定稿（排布 mockup 与丙档均已过目拍板）｜ 底数来源：`superpowers/checkups/2026-09-15-acts345-post-campaign.md` 取数员 D §7 ｜ 配套任务：黑白模式（另一份 spec，本任务之后做——截图基线在本任务后钉）

## 0. 背景与目标

业主原话：「信息不好是指字段内容，感觉交易可以展示更多信息。一旦信息多了，那么排布必然优化。」现状三域详情页（DepositDetail 180 行 / SwapDetail 156 行 / WithdrawDetail 168 行）字段全业务性、无 UUID、无恒空位——**病不在错，在薄**：一张平铺卡讲不出"这笔费怎么来的、单子走过哪几步"。目标 = 安全业务字段做加法 + 四区块重排 + 客户可见时间线。

**全程零 schema 迁移**——所有新字段的数据源都已在库（复检时逐列核实）。

## 1. 本任务做 / 不做

**做**：三域客户视图白名单扩容（§2）｜客户可见时间线（§3）｜三页四区块重排（§4）｜三份逐字重复的 `Field`/`goBack`/材料请求区块收编共享组件｜文档同步（modules 三篇 §5 前端可见面）。

**不做**（对照总纲 §2 与业主既定裁定）：
- swap 详情页材料请求区块——swap 5 态无 `ACTION_PENDING`，无补料弧，没有可显示的东西
- 通知本体（I1 老账）、订单列表页改动（去轮询专项另立，BACKLOG §I 在案）
- admin 端任何改动；深浅色主题（配套 spec）
- raw `statusHistory` 以任何形态下发客户（§3 红线）
- 报价页/确认框改动（波二已收口）

## 2. 后端 · 三域客户视图扩容（逐字段带数据源）

三个 `toCustomer*View` 白名单各开安全口子；**客户端 `Transaction` 接口与白名单 lockstep 同步改**（deposit 视图文档注释点名的契约）。

### 2.1 充值 `toCustomerDepositView`

| 新字段 | 数据源 | 语义 |
|---|---|---|
| `toAddress` / `toIban` | `DepositTransaction` 行上现成列 | 平台收款账户——客户打款的目标地址/IBAN，一直在库没给客户看 |
| `effectiveDate` | 行上现成列 | 入账业务日（价值日） |

### 2.2 提现 `toCustomerWithdrawView`

| 新字段 | 数据源 | 语义 |
|---|---|---|
| `quote: { quoteNo, levelName, feeTotal } \| null` | `WithdrawPricingQuote` relation（波二给 admin 建的订单↔报价互链，`WithdrawTransactionDetail.tsx:468` 同口径，**不含 feeBreakdown**——admin 侧业主已裁"summary only"，客户面沿用） | 这笔费按哪张报价、哪档费率算的 |
| `addressLabel` | 按 `customerId + toAddress/toIban` 反查 `WithdrawalAddress.label`（值匹配，无 FK；查不到 → null 前端不渲染） | 客户自己给提现地址起的名 |

### 2.3 兑换 `toCustomerSwapView`

| 新字段 | 数据源 | 语义 |
|---|---|---|
| `quoteNo` | `SwapTransaction.quoteNo` 行上现成列 | 报价号 SQT，与确认框对得上号 |
| `feeLines: [{ name, amount, currency }]` | 服务端 parse 行上 `feeBreakdown` JSON，**只挑费项行**重新组装下发 | 费用逐条明细 |
| `marketRate` / `spreadPercent` | `feeBreakdown.fx` 块（报价预览页已给客户看的同一口径） | 市场价 + 点差 |

⚠️ **禁止把 `feeBreakdown` 原包 JSON 下发**——里面有 `endpoint`/`symbol`/`bid`/`ask` 等技术字段；服务端拆好业务行再给。

### 2.4 禁入清单（白名单意识，评审对照用）

以下字段无论哪个域，**永不进客户视图**：`statusHistory` 原文（引用制裁/上缴/没收判词）｜`manualReason`（EDD_PEP 即告知 PEP 判定）｜`sumsub*` / `kyt*` / `travelRule*` 元数据｜`limitHoldReason`｜`slaDeadline` / `slaBreached`｜任何内部 UUID（`ownerId`/`assetId`/tier id 等）。

## 3. 后端 · 客户可见时间线（tipping-off 核心件）

三域视图各加 `timeline: [{ status, at }]`，构建规则（服务端唯一实现，`trading/shared` 落一个共享构建函数、各域传入自己的收敛函数）：

1. parse 行上 `statusHistory`（服务端内存操作，原文不出服务端）；
2. 每条取 `toStatus`，过该域现有收敛函数（`toCustomerStatus` / `toCustomerWithdrawStatus` / `toCustomerSwapStatus`）；
3. **收敛后与上一条相同 → 整条丢弃**（合并连续重复）；
4. 首条补一个出生条目（`CREATE` 动作行或 `createdAt`，收敛后作起点）；
5. 只下发 `[{ status: 收敛值, at }]`，词表渲染沿用客户端现有 StatusBadge。

**不变式（写成单测，变异式断言）**：冻结单（含冻结→解冻→再走完的单）的 timeline 与同路径普通单**等长、等形、不可区分**——FROZEN 与一切执法态收敛成 `COMPLIANCE_PENDING` 后被去重规则吞没，时间线上不产生任何多余条目或异常时刻。这是波五「订单级折叠」语义在时间线维度的延伸。

`completedAt` 门控沿用现有 `CUSTOMER_COMPLETED_STATUSES` 判据，不因时间线另开口子（时间线条目只有收敛放行态才出现，天然一致）。

## 4. 前端 · 四区块排布（mockup 已过目定稿）

三页统一结构，区块无内容则整块不渲染：

| 区块 | 充值 | 提现 | 兑换 |
|---|---|---|---|
| **头部** | 单号 + 徽章 + 金额·币种 | 单号 + 徽章 + 金额·币种 | 单号 + 徽章 + `100 USDT → 353.58 AED` |
| **Amounts** | 金额、业务日 | 金额、费、净额 | 卖出、毛收、费、净收、成交汇率、市场价+点差 |
| **Route** | 来源地址/IBAN、**平台收款账户**、txHash、网络 | 目标地址/IBAN、**地址标签**、txHash、网络 | —（无路由信息） |
| **Pricing** | — | **报价号 WQT、费率档名、费用合计** | **报价号 SQT、费用明细行** |
| **Timeline** | ✓ | ✓ | ✓ |
| **材料请求** | ✓（现有，收编共享后复用） | ✓（同） | ✗ |

共享组件收编到 `client-web/src/components/detail/`：`Field`（label/value/mono/wide，三份逐字重复）、`BackLink`（goBack 判据三份重复）、`MaterialRequestList`（充/提两份重复）。收编 = 行为零变化搬家，不顺手改样式（样式变化只来自本 spec 的排布）。

## 5. 验收（对照 `rules/delivery-checklist.md`）

- 随手闸：tsc ①②③ ｜ vitest（**时间线构建单测**：三域正常路径 + 冻结路径不可区分断言 + 去重规则；词表 spec 现有用例不红）｜ jest（三域视图扩容单测：新字段来源正确、禁入清单字段零出现——对响应对象断言 `not.toHaveProperty`）
- ⑤ preview 截图：三域各一张正常单（Alice/Bob 数据）+ 一张冻结单对照（**用 Frank**——Carol 恒零余额判例在案），冻结单截图与普通在途单肉眼无差
- 收尾闸：`on-stack main demo:all`（不动种子，闸⑥照跑）
- 文档：modules 三篇 §5 前端可见面同步；`demo/script.md` 若引用详情页字段随之核一遍
- BACKLOG：本 spec 交付后销「client 三域详情 Field/goBack 三份重复」观察项（复检报告 §二-9）

## 6. 风险与边界

- 唯一敏感件是时间线（§3），红线三条：raw history 不出服务端、收敛函数是唯一词表出口、冻结单不可区分断言必须存在且能翻红（做一次故意放行 FROZEN 的变异验证测试真的会红）。
- 提现 addressLabel 是值匹配反查，地址簿改名后旧单标签跟着变——demo 语义可接受，不做快照（快照=新列=迁移，违背零迁移边界）。
