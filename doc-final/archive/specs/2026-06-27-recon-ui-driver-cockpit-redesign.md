# 对账 UI 重排：Run 详情=主驾驶台 + Case=只读调查台

> 设计文档 · 2026-06-27 · 分支 main
> Phase B 引擎完成后，admin UI 仍是 V8 时代的 verdict/invariant 视角，对账员看不出"哪些钱包不平、差多少、缺哪笔"。本设计按"每账户·余额+流水"的新颗粒度重排 Run 详情、Case 详情、Cases 列表三页 + 调整 case 模型为 (walletRef, businessDate) 幂等。

## 1. 底层逻辑（不依赖现有引擎结构）

对账 = 每个有外部对账单的物理钱包/账号，**外部余额 vs 账本余额** + **外部流水 vs 账本流水**。

- 异常分两类：余额不平 / 流水不平（三种：orphan_internal / orphan_external / amount_mismatch）
- ops 调查的最小工作单元是**一个账号**（不是一条 line item，也不是整个 run）
- 同一账号同一日，**只能有一个 Open Case**（多次 Run 更新它的快照，不开新 case）

## 2. 信息架构

```
Reconciliation Runs (列表 - 现有不动)
   └─ Run 详情 (★ 主驾驶台 重排)
        └─ ⚠ 账户行 click → Case 详情 (只读调查台 重排)
                                  └─ 处置 workflow [Phase C deferred]

Reconciliation Cases (列表 - 退化为跨 Run/跨日跟进视图)
```

ops 日常工作主要在 Run 详情；Cases 列表只用作"还没解决的 Open 跟进单"。

## 3. Run 详情页（重排）

### 3.1 Header
Run ID · 触发方式 · Cutoff · Engine · Trace · 总判定（⚠ HAS BREAKS / ✅ ALL CLEAR）。

### 3.2 总览统计卡（5 数字，一眼全局）
- N accounts checked
- ✅ M match
- ⚠ K break
  - balance mismatch 数量
  - orphan (internal+external) 数量
  - amount mismatch 数量

### 3.3 账户状态表（主体）
每行一个被 Run 检查的物理钱包/账号：

| 列 | 说明 |
|---|---|
| Account | walletRef 简码 + 钱包角色（C_DEP / FIRM_FEE / …） |
| Owner | customerNo + 客户名（客户钱包）/ "–" (公司钱包) |
| Asset | AED / USDT-TRON |
| Internal | 账本余额（SUSPENSE+PAYABLE 合并 / 公司权益账户） |
| External | 外部对账单期末 |
| Δ | external − internal（0 / 非 0） |
| Flows | matched/total（如 4/5）+ 异常类型小标签 |
| Status | ✅ Match / ⚠ Balance / ⚠ Orphan / ⚠ Mismatch / ⚠ Both |

- ⚠ 行 click → 跳 Case 详情
- ✅ 行 click → 只读快照（无 Case，validation 用）
- 顶部 toggle：「只看 Break」「全部」
- 列排序：按 Δ / Asset / Status

### 3.4 底部
- 「View All Cases for this Run」（跳 Cases 列表过滤 runId）
- 自愈历史："本次 Run 自动 close 了 N 个上轮 Open 的 Case"

## 4. Case 详情页（只读调查台）

### 4.1 Header — 账户身份卡
Wallet · Owner · Asset · COA · 关联 Run（点跳回）· Business Date · Status `Open`。
底部 banner：「Disposition workflow in Phase C」。

### 4.2 余额对比卡（3 大数字）
Internal · External · Δ。Δ≠0 高亮。

### 4.3 异常摘要（顶部 chips）
- ⚠ X ORPHAN_INTERNAL
- ⚠ Y ORPHAN_EXTERNAL
- ⚠ Z AMOUNT_MISMATCH
（点 chip 跳到对应行）

### 4.4 流水比对清单（单表双栏 — 核心）
| EXTERNAL | INTERNAL | Match / Diff |
|---|---|---|
| 11:01 IN 3,000 ref:0x.. | 11:01 IN 3,000 event:DEPOSIT_… | ✓ matched |
| – | 11:05 OUT 50 ref:SWP..  | ⚠ ORPHAN_INTERNAL |
| 11:08 IN 1M ref:DEMO.. | – | ⚠ ORPHAN_EXTERNAL |
| 11:10 OUT **3,000,001** | 11:10 OUT **3,000,000** | ⚠ MISMATCH (+1) |

- 同 ref 两条匹配 → 同一行（左右都填）
- orphan_external → 仅左栏；orphan_internal → 仅右栏
- amount_mismatch → 两栏都有，差额列高亮

### 4.5 底部
- 「在 Account Statement 看该钱包全量流水（含内部 reclass）」深链接

## 5. Cases 列表（退化）

| 列 |
|---|
| Case ID / Account / Owner / Asset / Aging / Δ / First Run / Last Run / Status |

- 默认过滤 `Status = Open` + Aging 倒序（老 case 先看）
- 不在这做主调查；点行跳 Case 详情

## 6. Case 模型调整（幂等）

`Case 维度 = (walletRef, businessDate)`：
- 同一账号同一日只允许一个 OPEN
- 新 Run 时，该账号仍异常 → **更新现有 OPEN case 的 snapshot**（最新 Δ、最新 line items），**不开新**
- 该账号恢复正常 → 现有 OPEN case **自动 close（RESOLVED_AUTO）**，记录关联 Run
- 跨 businessDate 开新 case（即使是同一钱包，日级独立）

### Schema 影响（已有列，仅加约束 + 字段补全）
- `ReconciliationCase` 已有 walletRef/ownerNo/coaCode（T5）✓
- 加 partial unique index：`@@unique([walletRef, businessDate], where: { status: 'OPEN' })`（SQLite 通过 `WHERE` 表达式索引实现）；service 层 upsert 双保险
- 加 `firstSeenRunId` / `lastUpdatedRunId` 字段（跟踪 Aging）
- 加 `resolvedAt` / `resolutionReason` 字段（自愈/手动 close 共用）
- 加 `severity` 字段（HIGH / MEDIUM / LOW，按 Δ 金额阈值；阈值这版定 hard-code，Phase C 改可配置）

不动 ReconciliationRun / LineItem schema。

## 7. 后端 endpoint 影响

### 7.1 GET /admin/reconciliation/runs/:id
返回新增 `accountStatusTable: [...]`，每元素：
```
{ walletRef, ownerNo?, ownerName?, walletRole?, asset, coaCode,
  internal: { balance, total }, external: { balance },
  delta, flowMatched, flowTotal,
  status: 'MATCH'|'BALANCE'|'ORPHAN'|'MISMATCH'|'BOTH' }
```
同时补全 summary（修上次 OPENED CASES=0 的 UI bug 源头）。

### 7.2 GET /admin/reconciliation/cases/:id
返回新增 `flowComparison: [...]`，每元素：
```
{ externalLine: { id?, ref, amount, direction, timestamp, ... } | null,
  internalFlow: { id?, eventCode, amount, direction, timestamp, ... } | null,
  matchType: 'MATCHED'|'ORPHAN_EXTERNAL'|'ORPHAN_INTERNAL'|'AMOUNT_MISMATCH',
  deltaAmount?: string }
```

### 7.3 GET /admin/reconciliation/cases
- 加 `aging` 字段 + 默认 `?status=OPEN` 过滤
- 列表按 aging desc 默认排

### 7.4 WalletReconRunService.run（重写 case 落库逻辑）
- 异常账户：upsert by (walletRef, businessDate) → 已 OPEN 就更新 snapshot；不存在就建
- 自愈检测：本次 Run 跑完后，扫上次 OPEN 但本次平账的 case，标 RESOLVED_AUTO + 关联本次 Run
- 写完 case 后 update Run summary 字段（accountsChecked / matchCount / breakCount / 各类 break 计数）

## 8. 前端影响（admin-web）

### 8.1 ReconciliationRunsDetailPage 重写
- 删现有 INVARIANT ATTESTATION 块（V8 五公式专用）
- 加 Header 元信息 + 总览 5 数字卡 + 账户状态表
- 表行 click：⚠ 跳 case；✅ 跳只读 panel

### 8.2 ReconciliationCasesDetailPage 重写
- 删现有 V8 风格的"book/asset/vintage"展示
- 加 Header 账户身份卡 + 余额对比 + 异常 chips + 流水比对单表双栏

### 8.3 ReconciliationCasesListPage 简化
- 默认 `?status=OPEN&sort=aging.desc`
- 列：Aging / Δ / First Run / Last Run / Status

## 9. 不做（deferred）

- Case 处置工作流（Close/Waive/Assignee/SLA/Aging 升级） → Phase C
- 严格 schema 迁移（如 partial unique index 兼容性问题）→ 第一版用 service 层 upsert 兜底，DB 约束 Phase C
- severity 阈值可配置 → Phase C；本版 hard-code（balance Δ ≥ 1M = HIGH 等）

## 10. 验收

- recon:demo:break 跑 → Run 详情主驾驶台显示 9 行账户、5 ✅ + 4 ⚠ 分类正确
- 同一账号连跑 3 次 break → Cases 列表里**该账号只有 1 个 OPEN case**（幂等生效）
- 在两次 break 之间手动 reset external balance → 该账号 case 自动 RESOLVED_AUTO（自愈生效）
- Case 详情页流水比对单表双栏渲染：matched / orphan_internal / orphan_external / amount_mismatch 4 种状态都能看出
- 截图验证（按现有 admin UI 风格）

## 11. 决策点（写 plan 前定）

- severity 阈值（balance Δ HIGH/MEDIUM/LOW 分割线）：本版 hard-code，例 `≥10000` for HIGH, `≥100` for MEDIUM, 否则 LOW（用户审 spec 时若想改具体值就改）
- Case 详情底部「在 Account Statement 看」深链接是否带 crossingOnly=true 默认（推荐 true）
