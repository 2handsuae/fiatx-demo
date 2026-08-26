# 审计日志写法（audit-logging）

Last Updated: 2026-08-26 ｜ 底稿：2026-08-25 审计重构第一批（V1 治理域已切新合同；充值/提现/兑换三域仍写旧合同，迁移欠账见 BACKLOG）。生产级加固项（哈希链校验、留存 / legal hold 运维、库级只追加权限等五条）已移 PRODUCTION-NOTES。

## 怎么写

- `AuditLogsService` 经 DI 注入，禁 `new`；所有新审计一律走它，不许自己写表。
- 人 / API 触发用 `recordByActor()`，任务 / 编排器触发用 `recordSystem()`。
- **写在编排层**（workflow / 审批服务），不在主体服务、不在 controller。分工：主体层**判**（拒绝非法跃迁、抛结构化异常），编排层**接住并记**——"默默拦下不留痕"被禁止。唯一例外：`AUDIT_LOG_QUERIED` 写在 controller（查询没有 workflow），钦定单例不是先例。
- 每次写入带显式 `requestId`（惯例模板 `<动作>_<单号>_<uuid>`）——漏带会被静默去重、这条日志直接消失（真实踩过的坑）。
- V1 词表集中在 `constants/audit-actions.constant.ts`（45 live + 11 retired 拒写）；旧 `AuditActions` 常量还有 29 个非 V1 调用文件，等各域自己的批次迁移，勿先删。

## outcome：四值枚举

`SUCCESS / FAILED / DENIED / PARTIAL`，回答"**动作本身执行了没有**"，不回答"业务结果好不好"：
- 审批**拒绝** = `APPROVAL_DECLINED` + `outcome: SUCCESS`（拒绝这个动作成功执行了）。
- `DENIED` = 系统主动拦下、动作没执行（SoD 冲突、过期令牌）；`FAILED` = 试了但没成（邮件没发出去）。
- 非 SUCCESS 必带 `reasonCode`；不再铸 `*_FAILED` 动作码。

## 多主体：subjectRole 五个闭环角色

一件事常碰多个对象（"MLRO 批准解冻 DEP-1234"碰订单 / 客户 / 审批案 / 资金单 / 资产五个）。子表 `audit_log_subjects` 按角色记**业务键**（永不记 UUID）：

| 角色 | 含义 |
|---|---|
| PRIMARY | 事件直接作用的对象（至多 1，可为 0） |
| OWNER | 归属方（通常是客户）——**按客户检索走这里** |
| INSTRUMENT | 动作依赖的凭据：审批案、规则、提现地址、报价 |
| RELATED | 被牵连的单据：资金单、资产、钱包 |
| COUNTERPARTY | 对手方：外部 VASP、收 / 付款人 |

actor 不是角色（主表 `actorNo` 已有，一个事实只存一处）。拆条判据（二择一命中即拆）：各对象结局独立可成败 → 拆；两个主体状态都变了 → 拆。要写 `fromStatus == toStatus` 时停一下——多半是 PRIMARY 选错了。

## 三个追踪 ID

一句话：`traceId` 是"这一瞬间"，`correlationId` 是"这一整段旅程"，`causationId` 是"直接导致这条的那件事"。都是不透明 UUID，禁止把单号 / 日期编进 id。
每个动作码声明 `correlationMode`：`START`（开旅程）/ `INHERIT`（从 PRIMARY 主体上读）/ `NONE`（不属旅程，罕见）。**硬规则：INHERIT 读不到值必须报错，禁止悄悄新开一段**（`?? randomUUID()` 是最常见的作弊——链断了数据还看着正常）。

## 动作码：前缀归流程 + 六个闭环后缀

- 码扁平全局唯一；同一条流程共享前缀（`ADMIN_SUSPENSION_*`），一个前缀拉出整条流程。
- 后缀闭环：`_REQUESTED / _APPLIED / _COMPLETED / _CANCELLED / _EXPIRED / _DENIED`。
- 新码**出生即冻结**四属性（含义 / actionDomain / correlationMode / 特有必填字段），`assertActionSpec` 写入时机器校验；禁止"先上车后补票"。
- 禁把分类维度编进码名（不要 `TRADING_DEPOSIT_APPROVED`）。
- 已废字段（workflowId / workflowNo / module / triggerType / updatedAt）不得复引，缘由见 `../decisions.md`。

## 什么时候必须写（交付判据）

有持久状态的新功能 ｜ 新流程或关键状态迁移 ｜ 自动拦截 / 拒绝（含 SoD 拦截）｜ 修复动作（谁、为何、对谁、结果）｜ 证据包导出（须走审批门，失败也要记 `outcome=FAILED`）｜ 超时无人处理（"到点没人动"要和"有人动了"一样可见）。
密度感：担责方 / 不可逆点 / 事后可被单独质疑——三问中一即记。顺路径约 8 条，异常路径 15–25 条。
