# 真相文档（Truth Docs）— 索引

> 本目录只回答一个问题：**代码现在是什么样。** 不写历史沿革（去 git/roadmap）、不写计划（去 roadmap）、不写规矩（去 rules/）。
>
> **铁律：改代码 = 同步这里。** 大重构合并时，刷新受影响文档的 `Last Verified` 并核对内容。每节末尾带代码锚点（file:line），供随时复核抓手。

## 四类文档的分工

| 文档 | 回答 | 位置 | 生命周期 |
|---|---|---|---|
| **rules/** | 必须**怎么写**代码（约束） | `doc-final/rules/` | 稳定，很少变 |
| **truth/** | 代码**现在什么样**（现状） | `doc-final/reference/truth/`（本目录） | 跟代码走，每次核对刷新 |
| **roadmap** | 接下来**做什么**（计划） | `doc-final/reference/roadmap.md` | 按决策变 |
| **BACKLOG** | 欠的账（技术债/死码/待决策） | `doc-final/BACKLOG.md` | 记账本，做完勾掉 |

## 文档清单

| 文件 | 覆盖范围 | Last Verified |
|---|---|---|
| [v3-financial-config.md](v3-financial-config.md) | 资产 / 托管钱包 / COA 账本账户 / 提现地址 / 金额闸门 | 2026-07-03 |
| [v4-deposit.md](v4-deposit.md) | 充值双链路（crypto/fiat）/ 合规三层门 / 异常分支现状 / funds_orders 充值切片 | 2026-07-03 |

> **切分原则**：核对粒度 = 文件粒度（一次体检核一个领域，核完刷新对应文件）。
> **共享概念暂存位置**：8 码 COA 现放 v3（账户在资产创建时开设）；funds_orders 状态机的充值切片现放 v4（充值是其首个消费方）。等 V5/V6 落地、被多方引用时，再把 COA 与 funds-orders 提升为独立共享文件（accounting-coa.md / funds-orders.md），避免各版本各自漂移。
> **未覆盖版本**：V1/V2/V5-V9 尚未建真相文档，随后续一致性体检逐版补齐。
