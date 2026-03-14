# Wave 1 底座迁移计划书 (`EXCHANGE_JAVA_wave2` -> `Exchange_js`)

## 1. 结论

`/Users/songshengwei/Documents/codex/projects/EXCHANGE_JAVA_wave2` 是一个相当成熟的 `Wave 1` 控制底座来源仓库，但如果严格按当前项目定义的 `Wave 1 DoD` 评估，它并不是 `100%` 完成。

建议口径：

- 按 `WF-01 ~ WF-06 + GOV-02 最小门禁` 的完整 `Wave 1 DoD` 评估：约 `82% - 86%`
- 如果只看 `WF-01 ~ WF-06` 六项底座能力：约 `92% - 95%`

核心判断：

- `WF-03 / WF-01 / WF-02 / WF-06(P0) / WF-05 / WF-04` 都已经有较强的源码与测试支撑。
- `WF-GOV-02` 的“最小 effectiveness gate”没有作为独立通用底座落地，只在 `accounting config activation` 上表达了部分“变更单批准后才能生效”的含义，不能按完成算。

注意：

- 本次评估引用了仓库现有源码、测试源码和 `target/surefire-reports`。
- 本地环境缺少 `mvn`，无法重新跑 Java 测试；不能把现有绿测当成“我已复跑确认”。

## 2. Wave 1 完成度评估

| 项目 | 判断 | 完成度 | 结论说明 |
| --- | --- | --- | --- |
| `WF-03` 统一审批引擎 | 已完成 | `95%` | 有通用 approval case/step/policy、SoD、阻断闸门，并已复用到导出/删除/发布三类敏感动作。 |
| `WF-01` 审计与证据导出 | 已完成 | `95%` | 有统一 `audit_events`、条件查询、trace 聚合、证据包导出、`export_hash`。 |
| `WF-02` RBAC + admin/customer 边界 | 已完成 | `95%` | 有路由契约、默认拒绝、customer/admin 边界 deny、未授权留痕。 |
| `WF-06(P0)` Change Ticket + Release Gate | 已完成 | `90%` | 变更单、审批链接、gate run、测试证据/回滚方案校验都齐；但仅演示版，不接真实 CI。 |
| `WF-05` 软删除闸门 | 大体完成 | `88%` | 有 `delete_requests + deleted_at + 审批 + 执行 + snapshot + export`；实现上是 `delete_requests` 承担 deletion log，而不是单独 `DeletionLog` 表。 |
| `WF-04` Timer/SLA + 通知登记 | 大体完成 | `82%` | 有 timer kernel、due soon、breach escalation、recalc、close/cancel、通知与审计；但“registry/档位产品化”较弱，更像可用引擎而不是完整控制台。 |
| `WF-GOV-02` 最小 effectiveness gate | 未完成/仅局部表达 | `20%` | 没有独立 filing/receipt/effective gate；只在 accounting config activation 里要求关联已批准的 change ticket。 |

### 2.1 关键证据

- `WF-03`
  - `approval/service/ApprovalService.java`
  - `approval/service/ApprovalGateService.java`
  - `approval/policy/SodService.java`
  - `biz/BusinessGateService.java`
- `WF-01`
  - `audit/AuditEventService.java`
  - `audit/AuditQueryService.java`
  - `export/service/ExportJobService.java`
  - `admin/AuditPageAndApiTest.java`
- `WF-02`
  - `config/SecurityConfig.java`
  - `config/security/AdminRouteContract.java`
  - `config/security/SecurityContractKeyRoutesTest.java`
  - `admin/AdminSecurityAndPageTest.java`
- `WF-06`
  - `changeticket/service/ReleaseGateService.java`
  - `changeticket/ChangeTicketWorkflowTest.java`
- `WF-05`
  - `deleterequest/service/DeleteRequestService.java`
  - `deleterequest/service/DeleteExecutionService.java`
  - `deleterequest/DeleteRequestWorkflowTest.java`
  - `db/migration/V12__wf05_delete_requests_soft_delete.sql`
- `WF-04`
  - `timer/service/SlaTimerService.java`
  - `timer/service/SlaTimerSettings.java`
  - `timer/SlaTimerWorkflowTest.java`

### 2.2 文档冲突说明

源仓库内部对 `GOV-02` 的状态存在冲突：

- `docs/program/Wave_DoD_Gates.md` 把 `GOV-02 最小门禁` 写进了 `Wave 1 DoD`
- `docs/program/Workflow_Task_Wave_Index.md` 仍把 `WF-GOV-02` 标为 `PLANNED`

因此对这个源仓库更准确的说法应是：

- `Wave 1` 的六个主底座 workflow 基本完成
- `GOV-02 最小门禁` 尚未真正闭环

## 3. 对 `Exchange_js` 的迁移原则

这次迁移应该迁“底座语义与控制模型”，而不是直接搬 Spring 项目实现。

必须迁的，是这些东西：

- 审批/执行/阻断的状态机与错误语义
- maker-checker 与 SoD 的通用规则
- release gate 的证据校验规则
- soft delete 的审批化执行模型
- timer/SLA 的核心内核
- evidence package 与 `export_hash` 的口径

不应该直接迁的，是这些东西：

- `Thymeleaf` 页面
- `Spring Security` 路由配置写法
- Java 仓库的数据库表名和 JPA 实体结构
- Java 的 SSR 页面导航与参数回跳实现

原因很简单：

- 目标仓库 `Exchange_js` 已有自己的 Nest 模块边界、Prisma schema、统一审计模块和前后端结构。
- 直接照搬 Java 工程的 controller/page/schema，只会引入第二套底座。

## 4. 目标仓库中的可复用落点

当前 `Exchange_js` 里已经存在的可复用落点：

- 统一审计：`src/modules/risk-engine/audit-logs`
- RBAC / 后台成员与权限：`src/modules/identity/access-control`
- Admin / Customer auth 边界：`src/modules/identity/auth`
- 已有告警与事件：`src/modules/risk-engine/compliance-alerts`、`src/modules/risk-engine/compliance-incidents`

当前 `Exchange_js` 里仍然缺少、需要从这次迁移中补出来的共享底座：

- 通用 approval engine
- 通用 action policy / checker role policy
- 通用 change ticket / release gate
- 通用 delete request / soft delete gate
- 通用 timer/SLA engine
- 通用 effectiveness gate

这意味着迁移策略应该是：

- `audit`、`rbac` 走“合并增强”
- `approval / change-ticket / delete / timer / effectiveness gate` 走“新增共享底座，然后逐步接入业务”

## 5. 迁移范围建议

### 5.1 建议直接迁移的能力

1. Approval case / step / action policy / SoD 语义
2. Approval gate 的阻断规则
3. Change ticket 的证据完整性校验
4. Delete request 的审批化软删闭环
5. SLA timer 的 active-key 幂等、due soon、breach escalation
6. evidence package 的 manifest + records + digest 思路

### 5.2 建议只迁“设计”，不要照搬实现的能力

1. 路由权限契约测试
2. 页面层列表/详情/回跳体验
3. Spring 风格的 access denied handler
4. Java migration SQL 的表结构细节

### 5.3 不建议迁移的内容

1. `Thymeleaf` 模板与 SSR admin 页面
2. Java `export_jobs` / `audit_events` 表名本身
3. 把 `GOV-02` 当作已完成能力直接复制

## 6. 分阶段迁移计划

### Phase 0：语义冻结与差异清单

目标：

- 明确源项目哪些能力是“要迁的控制语义”，哪些只是 Java 实现细节。

交付物：

- `Wave 1` 迁移映射表
- action catalog 草案
- evidence package 最小字段清单
- 阻断错误码/错误原因口径

本阶段必须冻结的内容：

- approval 状态机
- delete request 状态机
- change ticket / gate run 状态机
- SLA timer 状态与通知类型
- 证据包最小字段：
  - 时间
  - 操作者
  - 审批轨迹
  - 关键业务 ID / No
  - digest / hash

退出条件：

- 源仓库与目标仓库的语义映射已达成一致
- 明确 `GOV-02` 需要在目标仓库重新设计，不直接照搬

### Phase 1：目标仓库持久化模型与服务契约

目标：

- 在 `Exchange_js` 里建立能承载这套底座的 Prisma 模型与 Nest service 契约。

交付物：

- 通用 approval persistence model
- 通用 change ticket persistence model
- 通用 delete request persistence model
- 通用 SLA timer persistence model
- 对应 DTO / service contract / test skeleton

设计要求：

- 不要改动现有 `audit_log_events` 的 canonical 地位
- 新底座模块的审计写入必须走 `AuditLogsService`
- 多表状态变化必须走事务

退出条件：

- Prisma schema 可以表达四类底座对象
- 不破坏现有 audit/rbac/compliance 模块

### Phase 2：迁移共享服务内核

目标：

- 先把“无 UI 依赖”的核心服务迁出来。

优先顺序：

1. approval engine
2. action policy + SoD
3. approval gate
4. SLA timer engine
5. change ticket + release gate
6. delete request + soft delete execution

必须保留的行为：

- 相同 active key 的审批/计时器幂等复用
- maker/checker 不可同人
- gate run 同环境同版本不可并发重入
- 删除执行必须写 snapshot
- 执行成功/失败都要可审计

退出条件：

- 服务层测试覆盖主流程和阻断流程
- 三类核心阻断都已具备稳定错误语义：
  - approval 未通过
  - release evidence 不完整
  - target 不允许软删

### Phase 3：接入首批 3 类敏感动作

目标：

- 满足 `Wave 1 DoD` 对 maker-checker 复用的最低要求。

建议首批接入对象：

1. 审计证据导出
2. 配置发布/生效动作
3. 软删除动作

为什么这样排：

- 这三类动作正好对应 Java 源仓库里已经被验证过的三种复用场景。
- 它们也正是 `Wave 1` 最有代表性的 P0 控制动作。

退出条件：

- 至少 3 类敏感动作复用同一套 approval engine
- 自动阻断不是提示，而是后端硬阻断并写审计日志

### Phase 4：Admin API、最小 UI 与证据包闭环

目标：

- 给运营和后续 agent 一个可操作、可验证、可导证据的最小工作台。

交付物：

- admin approval list/detail/decision API
- admin change ticket / gate run API
- admin delete request API
- admin timer list/detail API
- evidence export API 对接新底座字段

最小 UI 要求：

- 不追求复制 Java 页面
- 只要求能演示主流程、异常阻断、证据导出

退出条件：

- 跑通 1 条主流程 UAT
- 跑通 1 条异常阻断/回滚 UAT

### Phase 5：切流、替换局部临时逻辑、补 `GOV-02`

目标：

- 在不破坏现有业务模块的前提下，把散落的局部控制逻辑收口到共享底座。

建议切流顺序：

1. 审计导出审批
2. 配置发布/生效 gate
3. soft delete
4. compliance alert / incident SLA 收口到通用 timer
5. `GOV-02` 最小 effectiveness gate

`GOV-02` 的建议做法：

- 在目标仓库单独实现一个最小 gate
- 以“是否存在 receipt / effective flag”为开关前置条件
- 与功能开放动作或配置激活动作联动
- 不要复用 accounting config activation 代替通用 effectiveness gate

退出条件：

- `Exchange_js` 达成自己的 `Wave 1 DoD`
- 源仓库只作为参考，不再作为控制语义事实来源

## 7. 风险与规避

### 风险 1：把 Java 表结构当成迁移目标

问题：

- `Exchange_js` 已有 Prisma、统一审计表、现有业务 schema；直接照搬 Java 表结构会制造第二套事实源。

规避：

- 只迁状态机、规则、证据模型，不迁表名和 JPA 设计。

### 风险 2：先迁 UI，后迁底座

问题：

- 会先做出页面，再发现后端控制语义不稳定，返工很大。

规避：

- 先做 Phase 1/2，再做 Phase 4。

### 风险 3：误判 `GOV-02` 已完成

问题：

- 源仓库对这一项的文档口径本身就不一致。

规避：

- 明确把它列为“目标仓库需要重新设计的缺口项”，不要当作现成底座复制。

### 风险 4：直接替换目标仓库现有局部逻辑

问题：

- `Exchange_js` 已经在部分域里有局部 maker-checker/SLA 逻辑，直接大爆炸替换容易引入回归。

规避：

- 采用“新增共享底座 -> 首批接入 -> 逐域切流”的方式，不做一次性大替换。

## 8. 面向后续 Agent 的执行建议

后续 agent 如果继续做这件事，建议严格按下面顺序推进：

1. 先完成 `Phase 0` 语义映射，不要直接改 Prisma
2. 先落 approval/timer/change-ticket/delete 四个共享内核
3. 审计写入统一接 `AuditLogsService`
4. 先接 3 类敏感动作，再谈更多业务复用
5. `GOV-02` 单独设计，不得用“已有 config activation”冒充完成

推荐把“源仓库迁移完成”的判定标准设为：

- `Exchange_js` 自己满足 `Wave 1 DoD`
- 而不是“代码看起来像 Java 版本”
