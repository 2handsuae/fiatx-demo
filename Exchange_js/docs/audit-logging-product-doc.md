# 统一审计日志产品文档（Audit Logging）

## 产品背景与目标
平台原有审计能力分散在多个业务表，查询链路割裂、证据提取成本高。统一审计模块的目标是建立单一审计中心，满足三件事：
- 可追溯：关键操作与关键数据变化能串成完整事件链。
- 可检索：支持按 No 体系快速反查（运营与合规日常方式）。
- 可取证：支持导出可校验摘要的证据包，满足审计与监管提交。

## 用户角色与核心场景（审计员、合规管理员、运营管理员）
- 审计员：按 `subjectNo`、`actorNo`、`entityOwnerNo` 检索跨模块事件链，导出证据包并离线校验摘要。
- 合规管理员：查询登录、KYT、Travel Rule、状态迁移、人工干预等动作，定位责任人与处理时序。
- 运营管理员：按业务 No（如 `withdrawNo`、`payoutNo`、`customerNo`）追踪异常流程与失败原因。

## 本轮交付范围（Auth/Compliance/Config/Wallet/Customer/SwapQuote + 统一查询导出）
本轮已纳入统一审计的 P0 范围：
- Auth：平台用户与客户登录成功/失败、锁定/解锁。
- Compliance：KYT case、Travel Rule 更新与补偿任务行为。
- Config：资产、LP 配置、会计事件、清结算模板、分录模板、COA、客户汇率配置。
- 主数据：Wallet、Customer 的创建/更新/状态变化。
- 报价：Swap Quote 创建/取消/使用。
- 通用能力：统一查询、详情查看、证据包导出。

### 当前接口能力清单
- `POST /admin/audit-logs`：管理员手工补录审计事件。
- `GET /admin/audit-logs`：分页查询，支持 `subjectNo/subjectType/actorNo/entityOwnerNo` 等过滤。
- `GET /admin/audit-logs/:id`：查询单条详情，返回 `subjectNos[]`。
- `POST /admin/audit-logs/export/evidence-package`：导出 JSON 证据包。

### 后台入口
审计日志入口位于 Admin 后台 `Compliance Center`：
- 菜单路径：`/dashboard/compliance/audit-logs`
- 页面标题：`Compliance Center - Audit Logs`

## 查询体验（No 优先检索）
查询默认围绕 No 体系设计：
- 精确反查：`subjectNo` + `subjectType`。
- 责任人反查：`actorNo`。
- 归属主体反查：`entityOwnerNo`。
- 时间窗与结果过滤：`startAt/endAt/result`。
- 模糊补充：`keyword` 用于兜底搜索，不替代 No 精确检索。

## 证据包能力（JSON 单文件、摘要校验）
证据包输出为单个 JSON 文件，结构固定为：
- `manifest`：导出版本、时间、导出人、筛选条件、记录摘要列表。
- `records`：脱敏后的审计记录（可按 `includeRecords=false` 仅导出清单）。
- `digest`：包级 SHA-256 摘要。

导出动作本身会新增一条 `EVIDENCE_EXPORT` 审计事件，形成闭环留痕。

## 安全与合规（默认脱敏、8年保留）
- 默认脱敏：`metadata/beforeData/afterData` 递归脱敏后入库。
- 摘要校验：每条记录有 `payloadDigest`，证据包有 `digest`。
- 幂等写入：支持 `idempotencyKey`，避免重试重复记录。
- 数据保留：`retainedUntil = occurredAt + 8年`，由保留任务执行归档标记。

## 业务价值指标与验收口径
核心价值指标（建议作为阶段验收口径）：
- 覆盖率：P0 域关键写路径统一审计覆盖率 >= 95%。
- 可检索性：按 No 查询命中率 >= 99%（含 actor/owner/entity 维度）。
- 可取证性：证据包离线摘要校验通过率 100%。
- 可追责性：失败/拒绝事件 `reason` 字段完整率 >= 99%。

## 已知限制
- 当前证据包仅支持 JSON 单文件，不提供 ZIP/PDF 多格式。
- 查询权限当前限定为 `ADMIN` token。
- 非 No 体系主体不伪造 No，需通过其他字段补充定位。
- 本轮未扩展到 clearing/outstanding/journal 自动流水级全量审计。

## 路线图（P1/P2）
- P1：
1. 增强证据包下载链路（任务化、批次状态、重试策略）。
2. 增加审计统计看板（按模块/动作/失败率）。
3. 扩展更多自动流程动作的统一审计覆盖。
- P2：
1. 引入更细粒度的权限分层（审计员/导出员/查看员）。
2. 对接外部归档存储与审计签名链。
3. 增加跨系统审计联查能力（多平台统一检索）。
