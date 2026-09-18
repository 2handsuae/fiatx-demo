# 后端写法（backend）

> **开工前先过一遍 [`delivery-checklist.md`](delivery-checklist.md)** —— 按触发条件列出这个任务必须交付的东西（留痕 / 权限 / 状态 / 记账 / 前端入口 / 三域对称 …）。

Last Updated: 2026-08-26 ｜ 取代 backend-platform.md（生产宪法版）。本文件只有一个目的：**让业务逻辑好读**。兜底类要求已随演示化治理废止（判断标准见 CLAUDE.md §1–§2）；历史设计决策见 `../decisions.md`。

## 三层结构（推荐结构，不是审批门）

| 层 | 文件 | 管什么 | 不管什么 |
|---|---|---|---|
| 主体服务 | `[domain].service.ts` | 自己实体的数据 + **显式迁移表**（状态集、动作、非法跃迁拒绝） | 不写业务审计、不订事件、不含跨主体流程 |
| 审批子流程 | `[type]-approval.service.ts` | 一种审批动作的步骤 / SoD 配置（一律继承 ApprovalHandlerBase；旧日唯一钦定例外 onboarding-final-approval 已随一期拆除，2026-08-27） | 不执行业务动作——审批通过后的动作归 workflow |
| 工作流 | `[domain]-workflow.service.ts` | 一条业务旅程从头到尾：串主体服务、发起审批、写业务审计、订阅事件 | **不直写任何主体的表**（铁律 §5.3） |

- 一个业务流程 = 一个 workflow 文件，**读起来像 PRD 步骤**；方法名用业务动词（没收、退回、放行），不是技术动词。
- 改状态只走主体服务的迁移表——**要新结局就加一条边，不许绕表**（铁律 §5.4）。
- controller 只做传输（解析 → 调 workflow / 查询 → 返回），不含业务逻辑、不写审计。
- 主体服务的写方法带 `tx?: Prisma.TransactionClient` 可选参数，workflow 用 `prisma.$transaction` 把多主体写入组成一笔事务（全仓 69 处在用的既定惯例）。
  - 事务回调里（以及拿到事务的函数里）调别的服务方法，**必须把事务传下去**；被调方没有事务参数就按上一条补一个（不传时行为不变）。漏传的那次读写会另开一条连接，和还没提交的事务互等到超时（2026-09-11 全仓 36 个事务扫出 8 处，已修）。自查：`DATABASE_URL` 末尾加 `?connection_limit=1` 跑一遍 `demo:all`——每进程只剩 1 条连接，漏传必现 P2028（5 秒）。云端演示环境就按这个参数跑，新写的漏传会在部署当场变红。

## 铁律的落地符号（CLAUDE §5 → 代码）

| 铁律 | 写法 |
|---|---|
| 操作必留痕 | `AuditLogsService` 经 DI 注入（禁 `new`）；人为动作 `recordByActor`、系统动作 `recordSystem`；写在**编排层**。细则见 `audit-logging.md` |
| 门不可绕 | 审批一律走 `ApprovalsService` 正门；onboarding / 合规状态门的判断不许在新代码里短路 |
| 钱动必过账 | workflow **同步直调** `AccountingService`，失败即流程失败、状态不得推进；禁止把记账挂到事件上（同步 ACID 变最终一致，不可接受） |
| 对外用业务键 | 每个一级主体有稳定 operatorKey（`...No` / `code`）；列表、详情、筛选一律业务键优先；禁止只有 `id` 的一级主体上线 |

## 事件与跨模块（一条判断规则）

- 外部信号（webhook / 链上 / cron）→ ingestion/adapter 层翻译成内部事件 → workflow 订阅；`@Cron` 只出现在 sweep/adapter 文件。
- 判断：**触发方不知道谁在乎 → 发事件（广播）；知道找谁 → 直调那个模块的 service 正门。**
- 事件命名 `[模块].[主体].[过去式动词]`（如 `customer.restriction.opened`、`deposit.status.changed`）；**必须先登记**在 `src/common/events/domain-events.constants.ts` 才能使用——每条带发出方 / 订阅方 / 载荷说明，一处看全全部事件。
- 新代码**不再新增** `forwardRef()` 环；存量 67 处暂不追究，**Phase 4 按模块回收时随模块清理、逐步清零**（业主 2026-08-26 定）。真遇到环优先靠分层调整解。

## API 的业务脸面

- action 端点 = 具名业务动作（approve / freeze / return），不是自由字段 patch；响应说清"对谁、做了什么、到了什么状态"。
- 列表 / 详情直接给 operator 要看的字段（业务键、状态、关键时间、关联主体的 No），前端不该自己拼真相。
- 错误响应带人话 message + 业务码。

## 检查项（新代码常踩的坑）

- 新增 admin 端点 → 必须在 `rbac.catalog.ts` 用 `route()` 登记权限包 + `db:base:sync` + **重启后端**，否则前端 403。
- 新 workflow 开工前一句话想清楚：触发源、订 / 发哪些事件、直调哪些服务、写哪些审计、有没有审批门。
