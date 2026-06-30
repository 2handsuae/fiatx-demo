# Account Statement 加 External Reference 列

> 设计文档 · 2026-06-29 · 分支 main
> AccountStatement 页面当前把链上 txHash / 银行回执 (`externalRef`) 埋在 EXT 角标的 hover title 里，运营要靠悬停才能拿到。本设计在 Source No 旁加一独立列 External Ref 直接显化，三列（Source No / External Ref / EXT）职责互不重叠：内部追单 / 外部对账 / 跨外语义旗。

## 1. 底层逻辑

每条流水有两类 reference：

| Ref 类型 | 数据字段 | 业务含义 | 运营用途 |
|---|---|---|---|
| **内部业务单号** | `sourceNo` | DEP/SWP/WD 系统 No | 追 PR / 客服工单 / 复现链路 |
| **外部对账号** | `externalRef` | chain txHash / BANK-PO 回执 / swap leg ref | 跳链上 explorer / 银行流水查询 / fund 单下钻 |

两个号承载完全不同的对话场景，不能合并展示。当前 UI 只突出前者、把后者藏 hover —— 运营对账时要逐行悬停，颗粒度差。

## 2. 范围

| 在范围 | 不在范围 |
|---|---|
| ✓ `AccountStatementPage.tsx` 主表 — 加一列 External Ref | 后端 read model（externalRef 字段已有，不动） |
| ✓ EXT 列 fallback 从 `—` 改为明示 `INT` badge（与 EXT 对仗） | 钱包模式（mode=wallets）独立讨论 |
| ✓ Source No 列 header 文案从 `Reference` 改成 `Source No`（避免与 External Ref 列同名混淆） | — |

## 3. 表头终态（9 列）

```
DATE  │  TYPE  │  Source No  │  External Ref  │  EVENT  │  EXT  │  IN (+)  │  OUT (−)  │  BALANCE
```

### 3.1 列规范

| 列 | 来源 | 宽度 | 视觉 |
|---|---|---|---|
| DATE | `row.createdAt` | 不动 | mono `[11px]` `text-adm-t3` |
| TYPE | `row.sourceType` | 不动 | `AdminBadge` |
| **Source No** | `row.sourceNo`（旧 Reference 列重命名） | `width: 140` `max-w-[140px] truncate` | mono `[11px]` `text-adm-t2`，hover title=完整值 |
| **External Ref** ⭐ NEW | `row.externalRef ?? '—'` | `width: 160` `max-w-[160px] truncate` | mono `[11px]` `text-adm-amber`（突出对外可对账），空时 `text-adm-t3 '—'`，hover title=完整值 |
| EVENT | `row.eventCode` | 不动 | mono `[10px]` `text-adm-t3` |
| EXT | `row.isExternalCrossing` | 不动 | crossing=true → `EXT` 绿/amber badge（保持现有）；**crossing=false → `INT` 灰 badge**（替代 `—`，与 EXT 对仗明确） |
| IN / OUT / BALANCE | 不动 | — | — |

### 3.2 视觉对仗（EXT 列升级）

```
┌─────────┐  ┌─────────┐
│   EXT   │  │   INT   │
└─────────┘  └─────────┘
  amber/green   灰 (adm-t3)
```

明示交叉/内部，消除 `—` 的歧义（运营会问"`—`是缺数据还是没外部对手"）。

## 4. 数据现状（实证）

DB 查询 (`account_flows` 表) 验证 externalRef 格式：

| eventCode | externalRef 样本 | 含义 |
|---|---|---|
| DEPOSIT_ASSET_TO_SUSPENSE | `0xDEMO1USDT` | chain txHash 占位（生产真 hash） |
| DEPOSIT_SUSPENSE_TO_PAYABLE | `null` | 内部 book-to-book，crossing=false |
| SWAP_BUY_CLIENT / SWAP_FEE_* | `SWP260xxxx:legSeq:1:pending` | swap fund leg ref |
| 法币 WITHDRAW（demo 见过） | `BANK-POxxxx` | 银行回执 |
| 内部 book-to-book | `null` | crossing=false |

**结论**：externalRef 已在 read model 充分覆盖外部跨账的场景；crossing=false 行天然 null，新列展示 `—` 是正确兜底。

## 5. 文件改动

```
admin-web/src/pages/AccountStatementPage.tsx
  ~line 648:  <th>Reference</th>  →  <th>Source No</th>
              紧跟插一行: <th style={{ width: 160 }}>External Ref</th>
  ~line 663-670:  保留 Source No <td>
                  紧跟插一行 External Ref <td>(amber, truncate, title)
                  EXT 列 fallback 从 <span>—</span> 改为 INT badge
```

净改动 **+15 ~ 20 行**，单文件单提交。后端零改动。

## 6. 不变量

- StatementRow 数据契约（sourceNo + externalRef + isExternalCrossing 三字段）不动
- 钱包模式（mode=wallets）的统计表用同一 StatementRow，列改动同步生效
- adm-* 色 token：amber 用于 External Ref 突出可对账，灰 t3 用于 fallback 与 INT badge
- max-w 截断 + title 完整值 hover 模式延用现有规范

## 7. 验收方式

按 `feedback_verify_ui_by_rendering` 铁律：

| # | 验收项 | 方式 | 判据 |
|---|---|---|---|
| 1 | 表头 9 列，Source No 跟 External Ref 紧邻 | preview screenshot | 列序正确，External Ref amber 显眼 |
| 2 | DEPOSIT 行 External Ref 显 `0xDEMO1USDT` 不再藏 hover | preview screenshot | 数据可见 |
| 3 | SWAP 行 External Ref 显 `SWP...:N:1:pending` swap leg ref | preview screenshot | swap fund 单下钻可用 |
| 4 | crossing=false 行 External Ref 显 `—`，EXT 列显 `INT` 灰 badge | preview screenshot | 对仗清晰 |
| 5 | crossing=true 行 EXT 列保持 `EXT` 角标，External Ref 突出 amber | preview screenshot | 三列职责互补不冲突 |
| 6 | tsc 0 errors | npx tsc --noEmit | 编译过 |

## 8. 后续考虑（Deferred）

- **可点击成 explorer 跳转**：External Ref 为 chain txHash 时直跳 Tronscan / Etherscan；为 BANK-PO 时跳 fund detail 页。本期纯展示，跳转链路单独立 design。
- **mode=wallets 流水表**：本设计聚焦 mode=accounts；wallets 模式列同步改造但未在本期范围。

## 9. 引用

- [`doc-final/rules/frontend-admin.md`](../../rules/frontend-admin.md) —— admin token + truncate + hover title 规范
- [`admin-web/src/pages/AccountStatementPage.tsx:42-56`](../../../admin-web/src/pages/AccountStatementPage.tsx) —— StatementRow interface 数据契约
- [`src/modules/accounting/tigerbeetle/tb-evidence.service.ts:27`](../../../src/modules/accounting/tigerbeetle/tb-evidence.service.ts) —— externalRef 后端写入路径注释（"blockchain txHash / bank statement ref when this leg crosses an external boundary"）
