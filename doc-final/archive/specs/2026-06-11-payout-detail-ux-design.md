# Payout 详情页打磨 — 设计 spec

日期:2026-06-11
状态:已确认(全量状态机+按钮矩阵已逐表过审;fiat 出资=客户 vIBAN,CMA 不对外转账)

## 0. 审计结论

- 后端转换表较完备(fiat 已有 CONFIRMED/CLEARED→RETURN 退票);缺 crypto 浅重组。
- **前端现行 bug**:`PAYOUT_TERMINAL` 把 CLEARED 一刀划终态 → fiat `CLEARED→RETURN` 后端允许但 UI 按钮被禁,退票路径不可达。
- `⚡ Clear (system)` 手动按钮与 withdraw 工作流自动 CLEAR(withdraw-workflow.service.ts:551)赛跑,应删。
- Chain Details 混排 IBAN、etherscan 硬编码(TRON 资产链接错误)、Linked Withdraw 手搓 h3、Technical raw JSON 与时间线重复——与 payin 同病。
- payout 表 fromAddress/fromIban 从未写入(create dto 不含)→ 详情页恒空。
- crypto RETURNED 不可达(fiat 专属)——文档说明,无代码。TIMEOUT 维持终态(迟到确认=双付风险,归对账域)。

## 1. 状态机与按钮(终局,★=本次增改)

### Crypto
| 状态 | 按钮 | 去向 |
|---|---|---|
| CREATED | Sign | SIGNING |
| SIGNING | Broadcast / Sign Fail | BROADCASTED / FAILED |
| BROADCASTED | Seen in Mempool / Drop / Timeout | CONFIRMING / FAILED / TIMEOUT |
| CONFIRMING | Confirm / Fail / Timeout / ★Reorg — back to broadcasted | CONFIRMED / FAILED / TIMEOUT / ★BROADCASTED |
| CONFIRMED | ★删 Clear;文案 `Auto-clearing via withdraw workflow…` | 自动 CLEARED |
| CLEARED/FAILED/TIMEOUT | 文案 `Terminal state — no simulatable events` | — |

### Fiat
| 状态 | 按钮 | 去向 |
|---|---|---|
| CREATED | Submit | CONFIRMING |
| CONFIRMING | Confirm / Fail / Timeout | CONFIRMED / FAILED / TIMEOUT |
| CONFIRMED | Return + 文案 `Auto-clearing…`(★删 Clear) | RETURNED / 自动 CLEARED |
| CLEARED | ★Return(修终态 bug 后可达) | RETURNED |
| FAILED/TIMEOUT/RETURNED | 文案 | — |

- 后端:`PayoutAction`/`AdminPayoutAction` 加 `REORG`;`CRYPTO_TRANSITIONS[CONFIRMING]` 加 `REORG→BROADCASTED`。
- 前端终态集合按轨道分:crypto `{CLEARED,FAILED,TIMEOUT,RETURNED}`;fiat `{FAILED,TIMEOUT,RETURNED}`。
- 面板:无可用动作时按 瞬态(CONFIRMED)/终态 显示文案(对齐 payin)。

## 2. from 字段补缺

| 轨道 | 出资钱包 | 字段 |
|---|---|---|
| crypto | 该资产 `C_OUT` 出站热钱包 | fromAddress = C_OUT.address |
| fiat | **该客户 `C_VIBAN`**(CMA 不对外转账) | fromIban = C_VIBAN.iban |

- 创建时(payouts.service.create)解析快照写入;解析不到不阻断创建(置 null + warn 日志)。
- 详情读取对 null 行现场解析兜底(不回写),存量单可显示。

## 3. 左侧重排(同 payin 模式)

Hero → **Chain Details**(仅 crypto:Tx Hash 链接走共享 `explorerTxUrl`、Confirmations、From/To Address、Provider Txn ID 有值才显)→ **Bank Transfer**(仅 fiat:From/To IBAN、Reference No、Provider Txn ID)→ **Linked Withdraw**(进 DetailCard)→ Status History;**删 Technical raw JSON**。
`explorerTxUrl` 抽到 `admin-web/src/utils/explorer.ts`,PayinDetail 改 import 共享(删本地副本)。

## 4. Sidebar 与 Lifecycle

- Owner 行升级:**Customer No**(可点击 `/dashboard/customer/:ownerId`)+ **Customer Name**(detail 接口 enrich customer firstName/lastName;ownerNo 显示口径以接口实际为准核对)。
- Lifecycle 核对补 `Completed`(completedAt)。

## 5. 测试与验收

- payouts.service spec:REORG 转换、create 快照(crypto/fiat 两轨)、detail null 兜底 enrich(TDD)。
- admin tsc/vite 200;手验:crypto 走全程含 Reorg 回退;fiat CLEARED 点 Return 成功;from 字段两轨显示;TRON 链接到 tronscan;CONFIRMED 文案。

## 6. 范围外

TIMEOUT 迟到确认(对账域)、crypto RETURNED、payout 列表页。
