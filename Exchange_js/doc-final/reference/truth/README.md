# 真相文档（Truth Docs）— 索引

> 本目录只回答一个问题：**代码现在是什么样。** 不写历史沿革（去 git/roadmap）、不写计划（去 roadmap）、不写规矩（去 rules/）。
>
> **铁律：改代码 = 同步这里。** 大重构合并时，刷新受影响文档的 `Last Verified` 并核对内容。锚点用「**文件 → 符号名**」（函数/常量/类），**不用行号**——行号一次重构就烂，符号名寿命长一个数量级、grep 一样快。

## 四类文档的分工

| 文档 | 回答 | 位置 | 生命周期 |
|---|---|---|---|
| **rules/** | 必须**怎么写**代码（约束） | `doc-final/rules/` | 稳定，很少变 |
| **truth/** | 代码**现在什么样**（现状） | `doc-final/reference/truth/`（本目录） | 跟代码走，每次核对刷新 |
| **roadmap** | 接下来**做什么**（计划） | `doc-final/reference/roadmap.md` | 按决策变 |
| **BACKLOG** | 欠的账（技术债/死码/待决策） | `doc-final/BACKLOG.md` | 记账本，做完勾掉 |

## 文件清单 + 新鲜度看板

> `Last Verified` = 上次逐条核对代码的日期。哪块超过一个月没核，下次体检优先它。

| 文件 | 覆盖范围 | Last Verified |
|---|---|---|
| [_template.md](_template.md) | 新建文件的结构模板 | — |
| [v3-financial-config.md](v3-financial-config.md) | 资产 / 托管钱包 / COA 账本账户 / 提现地址 / 金额闸门 | 2026-07-03 |
| [v4-deposit.md](v4-deposit.md) | 充值双链路（crypto/fiat）/ 合规三层门 / 异常分支现状 / funds_orders 充值切片 | 2026-07-03 |
| [v5-withdraw.md](v5-withdraw.md) | 提现双链路（共用工作流）/ 大额审批门 / 三层合规 / 费率治理 / funds_order 2 腿 | 2026-07-03 |

## 版本 → 文件映射

| 版本 | 领域 | 真相文件 |
|---|---|---|
| V1 | 审批引擎 / 审计 / RBAC | `governance-approvals.md`（待建，随需）|
| V2 | 客户三轴状态 / 合规门 | `identity-compliance.md`（待建，随需）|
| V3 | 资产 / 钱包 / COA / 提现地址 / 金额闸门 | ✅ v3-financial-config.md |
| V4 | 充值 | ✅ v4-deposit.md |
| V5 | 提现 | ✅ v5-withdraw.md |
| V6 | 兑换 | `v6-swap.md`（待 V6 体检后建）|
| V7 | 内部转账 / 资金层 | 并入 funds-orders.md（待建）|
| V8 | 对账 | `v8-recon.md`（待建，Round3 记忆最新鲜，建议尽早）|
| 跨版本 | 8 码 COA + 记账不变量 | `accounting-coa.md`（待抽出）|
| 跨版本 | 资金单状态机全集 | `funds-orders.md`（待抽出）|

## 命名规则

- **单版本域** → `v{N}-{域名}.md`（版本号是给你按 V 查找的索引）
- **跨版本共享域** → **纯域名、无版本前缀**（它不属于任何单一版本，挂版本号反而误导）

## 抽出时机（共享域）

一个概念被 **≥2 个版本文件重复描述**时，立刻抽成共享域文件（纯域名），原地留一行链接。**别提前抽**（YAGNI），**也别拖到三处各自漂移**。
> 现状：8 码 COA 暂存 [v3-financial-config.md](v3-financial-config.md) §3、funds_orders 充值切片暂存 [v4-deposit.md](v4-deposit.md) §1。等 V5/V6/V8 也引用时 → 抽出 `accounting-coa.md` / `funds-orders.md`。

## 每文件结构

统一六节（见 [_template.md](_template.md)）：`0 一句话定位` / `1 状态机` / `2 数据模型要点` / `3 关键流程` / `4 ⚠️已知缺口` / `5 锚点`。结构统一 = 读的人不用学、写的人不用想。

## 锚点规范

- 用「**文件名 → 符号名**」（函数 `foo()` / 常量 `BAR` / 类）。**禁止行号**。
- 前端组件无明确符号 → 「文件名（一句话定位）」。
- ⚠️ **每条已知缺口必须链到 BACKLOG.md 对应行**——truth 只描述"缺什么"，账记在 BACKLOG，两处互链。

## 反模式（禁止）

- ❌ 写历史沿革（"原来是…后来改成…" → 去 git）
- ❌ 写计划（"将来会…" → 去 roadmap）
- ❌ 抄 rules/ 的规范（truth 说"是什么"，rules 说"必须怎样"）
- ❌ 单文件超 ~400 行（超了说明域切太大 → 拆）
- ❌ ⚠️缺口只在 truth 写、BACKLOG 无账
- ❌ 用行号锚点（会腐烂 → 用符号名）

## 切分原则 + 未覆盖版本

**切分原则**：核对粒度 = 文件粒度（一次体检核一个领域，核完刷新对应文件的 `Last Verified`）。
**未覆盖版本**：V1/V2/V5-V9 尚未建真相文档，随后续一致性体检逐版补齐（见上方版本映射表标注）。
