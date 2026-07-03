# effectiveDate 平账准备字段设计

> 日期：2026-07-03 ｜ 状态：设计定稿（脑暴三问 甲/甲/甲 + swap 四腿场景拷问通过）
> 范围：TbTransferEvidence + AccountFlow 加 `effectiveDate` 业务日字段，引擎切换消费，存量回填。零 API 变更、零前端变更。
> 上游：平账（处置分录）前置准备——处置期补账要能"算回昨天"，重跑旧 run 自动吸收。

---

## 1. 语义与决策记录

| 决策点 | 结论 | 理由 |
|---|---|---|
| 字段类型 | `String` YYYY-MM-DD（问题一选甲） | 语义="这笔账算哪一天的账"；与 run.businessDate / ExternalBalance.cutoffDate 同构，字符串直比 |
| 引擎切换时机 | 本轮就切（问题二选甲） | 存量数据上等价保真=免费全量回归闸门；拖到处置期切则闸门丢失 |
| 写入口子 | 本轮不开（问题三选甲） | 回填自带规则（能回多早/关账日/权限），归处置期带规则一起开；本轮所有写入一律=写入当天 |
| 加哪些表 | 两表都加 | Evidence 是真相源（不加则重投影丢字段）；AccountFlow 是查询面（不加则引擎过滤要 join）。与 createdAt/externalRef/isExternalCrossing 既有双写模式一致 |
| trade date vs value date | 每条腿记自己发生的那天，不跟订单走 | swap T+0 成交、链上腿 T+1 动账：外部对账单只在 T+1 记账，回填 T+0 会凭空造 break。订单成交日记在订单表，与记账生效日两条线 |

`createdAt`（物理写入时刻）原样保留，两个字段各管各的：effectiveDate 管业务归属日，createdAt 管物理时间（匹配器 ±72h 邻近判断继续用它）。

## 2. 字段与写入（生产侧）

- `TbTransferEvidence.effectiveDate String` + `AccountFlow.effectiveDate String`
- 唯一写入漏斗 = `tb-evidence.service.ts` `writeEvidence()`（evidenceData 内已显式写 `createdAt: new Date()`）→ 同处补 `effectiveDate = toBusinessDate(now)`。全系统只改这一处，充值/提现/换汇/内转自动带上。
- `toBusinessDate` = UTC ISO 取日（与 `wallet-recon-run.service.ts:940` 现有换算同口径）；抽成共享工具或复制一行，计划阶段定。
- 投影器 `AccountFlowProjectorService`：`EvidenceLike` / `AccountFlowRow` 接口 + 投影复制各加一行（与 createdAt 复制同模式）。
- evidence 两处 update（:117/:165，LOCK→POST 提升）不碰日期字段——零改动。
- `recon-demo.ts` 只读 accountFlow（:278）不写——零改动。

## 3. 引擎切换（消费侧）——等价保真复合过滤式

全仓按日期过滤 AccountFlow 的位置只有 3 处，全部切换为：

```
OR: [
  { effectiveDate: { lt: businessDate } },                      // 生效日早于截止日 → 全进（平账回填将来落这段）
  { effectiveDate: businessDate, createdAt: { lte: cutoff } },  // 当天的 → 仍按物理时刻卡截止点
]
```

| # | 位置 | 现过滤 |
|---|---|---|
| 1 | `engine/v2/wallet-balance-checker.service.ts:100` | `createdAt ≤ cutoff` |
| 2 | `engine/v2/wallet-flow-matcher.service.ts:160`（候选池） | `createdAt ≤ cutoff` |
| 3 | `domain/reconciliation-query.service.ts:670`（case 详情重放） | `createdAt ≤ cutoff` |

**等价性证明**（存量数据满足 effectiveDate == date(createdAt) 时，复合式 ⟺ 旧式 `createdAt ≤ cutoff`）：
- date(createdAt) < date(cutoff)：createdAt 必 < cutoff → 旧真；复合式落第一段 → 新真 ✓
- date(createdAt) == date(cutoff)：两式都归结为 createdAt ≤ cutoff ✓
- date(createdAt) > date(cutoff)：createdAt 必 > cutoff → 旧假；两段都不中 → 新假 ✓

简单版 `effectiveDate ≤ businessDate` 被否：会把截止时刻之后当天晚些写入的账吸进来，偷改现行为。

不切换的读点（无日期过滤，原样不动）：`tb-evidence.service.ts:395`（钱包下钻）、`:555/:575`（groupBy 钱包列表）。

## 4. 存量回填（一次性迁移）

- Prisma migration 加列（NOT NULL 需 default 空串或两步迁移，实测定）+ 回填 `effectiveDate = date(createdAt)`（UTC）。
- ⚠️ 已知坑：SQLite 里 Prisma DateTime 的物理存储格式不许拍脑袋——回填 SQL 前先 `sqlite3` 实测一行 createdAt 的原始值再写转换式；拿不准就改用 Node 脚本经 Prisma client 回填。
- 不加新索引：3 处引擎查询都先按 walletRef 收窄（已有索引），单钱包流水量级小。

## 5. 验证闸门

1. 后端 `npx tsc --noEmit` 0 错；jest 净新增失败 0（基线 4 failed 不算）
2. **金闸门（等价保真实证）**：切换前后各跑一次 `recon:demo`，九场景 pass/break 结果逐字一致
3. **功能就绪实证**：claude 栈手工插一笔 `effectiveDate=昨天、createdAt=今天` 的流水（sqlite 直插，模拟平账回填），重跑昨天业务日的 run，验证该笔被余额核对吸收；验完清数据
4. 投影器/匹配器/核对器现有 spec 测试跟进字段（计划阶段定具体断言）

## 6. 明确不做

回填 API/参数（处置期带规则开）｜处置分录本体｜前端展示 effectiveDate｜外部两表改动（ExternalStatementLine.datetime / ExternalBalance.cutoffDate 已有生效语义）｜TbTransferEvidence 日期索引｜时区本地化（沿用 UTC 口径，全系统一致）
