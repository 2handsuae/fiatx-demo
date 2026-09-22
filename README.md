# FiatX 演示系统交付包

虚拟币 / 法币 broker-dealer **演示系统**（NestJS + Prisma + SQLite 后端 ｜ React 管理台 ｜ React 客户端 ｜ TigerBeetle 复式账本）。
本仓库是交付包的 demo 代码部分：**参考实现，不是代码基线**。交付模式 = demo 代码（tag 冻结）+ PRD 文档集（Lark）+ 交付宪法四文件。

## 包版本总表

| 件 | 位置 | 冻结点 |
|---|---|---|
| demo 代码 | 本仓库 | tag `delivery-2026-09-22` |
| 语义合同（重做时什么不许动） | `doc-final/delivery/semantic-contract.md` | 随 tag |
| 决策日志（防「好心优化」摘选） | `doc-final/delivery/decision-log.md`（全量真身 `doc-final/decisions.md`） | 随 tag |
| 非功能底线（demo 看不见的下限） | `doc-final/delivery/nonfunctional-baseline.md` | 随 tag |
| 依赖契约状态表（外部接口真假） | `doc-final/delivery/dependency-contract-status.md` | 随 tag |
| PRD 文档集 | Lark 在线版（链接由产品提供）；`doc-final/lark/` 为交付时留底快照 | 在线版持续演进 |
| 演示剧本（验收口径） | `doc-final/demo/script.md`（七幕）+ `doc-final/demo/baseline.md` | 随 tag |

## 读法顺序

1. **先跑起来**（下节），照 `doc-final/demo/script.md` 走一遍七幕——先看见系统在演什么，再读字。
2. **语义合同** `doc-final/delivery/semantic-contract.md`——重做时什么必须分毫不差、什么随便发挥。
3. **PRD 文档集**（Lark）——各域的状态机、决策表、验收标准。
4. **决策日志**——看到 demo 里「不合理」的设计，先来查有没有名字，再决定要不要问。
5. **数据模型**：PRD 附录 A 是导读，字段级真相在 `prisma/schema.prisma`。
6. 动手前读完下面的**四刀声明**。

## 四刀声明

1. **demo 的法律地位**：参考实现，不是代码基线。**语义以合同为准、精度以 demo 为准、工程质量以 demo 为耻**——demo 是明令不做技术兜底的演示系统（无幂等、无并发防护、管理 API 未加固……清单见非功能底线与 `doc-final/PRODUCTION-NOTES.md`），它的错误处理、测试、安全姿势都不构成标准。
2. **冲突裁决**：业务意图冲突 → 文档赢；实现细节冲突 → demo 赢；裁决不了 → 提问题给产品，**禁止猜测后静默继续**。
3. **责任线**：产品验收业务正确性（PRD 验收标准 + 演示剧本），不审代码、不背工程债；工程质量是开发的专业责任，非功能底线只是下限。
4. **时间线**：交付时 demo 已打 tag 冻结，此后需求变更走 PRD 变更记录，**不打 demo 补丁**——demo 与文档互相追赶只会两边都变流沙。

## 怎么跑

前置：Node 20（仓库根 `.nvmrc`）、`tigerbeetle`、`sqlite3`、`python3`、`lsof`、`git` 在 PATH 上（`scripts/stack-up.sh` 启动时会自检）。

```bash
npm install && (cd admin-web && npm install) && (cd client-web && npm install)
```

```bash
bash scripts/stack.sh reset main
```

`reset` 从零建库、格式化 TigerBeetle、铺满演示数据并起栈：API `:3000`、管理台 `:3001`、客户端 `:3002`。管理台/客户端登录页都有 Quick Login（种子账号）。常用验证：

```bash
bash scripts/on-stack.sh main demo:all
```

```bash
bash scripts/on-stack.sh main verify:coa
```

⚠️ `demo:*` / `recon:*` / `verify:*` 一类 npm 脚本必须经 `scripts/on-stack.sh` 包装器跑（缺环境变量会当场 fail-fast 并提示用法）。

## 仓库文档地图（doc-final/）

`modules/` 现状唯一真相（先读 `modules/overview.md`）｜ `decisions.md` 决策全量（只追加）｜ `demo/` 剧本、种子数据、模拟件清单 ｜ `BACKLOG.md` 已知业务缺口 ｜ `PRODUCTION-NOTES.md` 技术兜底登记册（生产化起点） ｜ `TOOLING-DEBT.md` 工具债 ｜ `lark/` PRD 留底快照 ｜ `archive/` 历史存档（只考古用）。
