# Governance 端到端验收清单

## 1. 验收总览

### 本轮覆盖范围
- `Approval`：`SENSITIVE_EXPORT_APPROVAL`
- `Change Ticket`：`create -> submit -> approval -> gate -> deploy -> close`
- `Delete Request`：`create -> submit -> approval -> execute -> soft delete`
- `SLA Timer`：
  - `APPROVAL_TIMEOUT`
  - `CHANGE_POST_APPROVAL_FOLLOWUP`
- `Audit Center`：
  - `Audit Log`
  - `Evidence Export`

### 本轮不覆盖范围
- Onboarding / CDD / EDD / Incident / Alert 的专项验收
- 非 Governance 的 SLA 接入
- 外发通知能力（邮件、短信、站内消息）
- `Delete Request` 的批量删除、恢复删除、用户删除

### 当前分支运行口径
- 当前 `audit-evidence` worktree 默认端口是：
  - backend: `http://localhost:3500`
  - admin-web: `http://localhost:3501`
  - client-web: `http://localhost:3502`
- Admin 登录入口：
  - `http://localhost:3501/admin/login`
- Swagger / 健康检查入口：
  - `http://localhost:3500/api`

### 建议验收顺序
1. `Approval`
2. `Change Ticket`
3. `Delete Request`
4. `SLA Timer`
5. `Audit Center`

这样可以复用前面步骤产出的 `approvalNo / ticketNo / requestNo / timerNo / traceId`。

### 推荐账号

| 角色 | 邮箱 | 默认密码 | 本清单中的主要用途 |
| --- | --- | --- | --- |
| `SUPER_ADMIN` | `admin@fiatx.com` | `123456` | 全局兜底、SLA mock API、Audit Center 总验收 |
| `MLRO` | `mlro@fiatx.com` | `123456` | 审批敏感导出 |
| `TECH_ADMIN` | `tech_admin@fiatx.com` | `123456` | Change Ticket 创建 / gate / deploy / close，Delete Request 执行，SLA UI 操作 |
| `DPO` | `dpo@fiatx.com` | `123456` | Delete Request 审批 |
| `COMPLIANCE_LEAD` | `compliance_lead@fiatx.com` | `123456` | Delete Request 创建与提交 |
| `CISO` | `ciso@fiatx.com` | `123456` | Change Ticket 审批 |

## 2. 全局基线检查

### 环境命令

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-evidence/Exchange_js
npm run db:base:sync
npm run dev:start
curl http://localhost:3500/api
```

### 通过标准
- `curl http://localhost:3500/api` 返回 `200`
- 能打开 `http://localhost:3501/admin/login`
- 以下账号都能登录：
  - `admin@fiatx.com`
  - `mlro@fiatx.com`
  - `tech_admin@fiatx.com`
  - `dpo@fiatx.com`
  - `compliance_lead@fiatx.com`
  - `ciso@fiatx.com`
- 菜单可见：
  - `Audit Center -> Audit Log / Evidence Export`
  - `Governance Center -> Approvals / Change Tickets / Delete Requests / SLA Timers`

### 常见失败与排查
- 登录失败：
  - 先执行 `npm run db:base:sync`
  - 确认密码仍是 `123456`
- 菜单缺失：
  - 退出并重新登录
  - 确认 backend 跑的是当前分支端口 `3500`
- 页面报 `Internal server error`：
  - 先执行 `npm run db:migrate:local`
  - 再执行 `npm run db:base:sync`

## 3. Demo Path 1：Approval（敏感导出审批）

### 目标
验证 `Audit Log -> Evidence Export -> Approval -> Download` 这条链完整可用，并且主展示使用 `approvalNo / packageNo`。

### 使用账号
- maker：`SUPER_ADMIN`
- checker：`MLRO`

### 前置条件
- 已完成全局基线检查
- `Audit Center -> Audit Log` 能打开

### 操作步骤
1. 使用 `admin@fiatx.com` 登录。
2. 进入 `Audit Center -> Audit Log`。
3. 如果页面默认 `Workflow Type = DEPOSIT` 导致记录太少或没有治理事件：
   - 清空 `Workflow Type`
   - 点击 `Search`
4. 勾选任意 `1-3` 条 audit log 记录。
   - 最稳妥的选择是刚登录后能看到的 `ADMIN_LOGIN_SUCCESS` 或其他最新记录。
5. 点击右上角 `Export Selected (n)`。
6. 页面提示创建成功后，进入 `Audit Center -> Evidence Export`。
7. 打开最新一条 `packageNo`。
8. 预期：
   - `status = PENDING_APPROVAL`
   - 下载按钮显示 `Waiting Approval`
   - 页面存在 `Open Approval`
9. 退出登录，使用 `mlro@fiatx.com` 登录。
10. 进入 `Governance Center -> Approvals`。
11. 使用以下任一方式找到这张审批单：
   - `Action Type = SENSITIVE_EXPORT_APPROVAL`
   - `Approval No`
12. 打开审批详情，确认：
   - `approvalNo` 已生成
   - `status = PENDING`
13. 点击 `Approve`。
14. 退出登录，重新使用 `admin@fiatx.com` 登录。
15. 回到 `Audit Center -> Evidence Export`，打开刚才那条导出记录。
16. 预期：
   - `status = READY`
   - 下载按钮变为 `Download`
   - `approvalCase.approvalNo` 可见
17. 点击 `Download`，确认浏览器下载 `packageNo.json`。

### 预期状态流转
- Evidence package：
  - `PENDING_APPROVAL -> READY`
- Approval：
  - `DRAFT -> PENDING -> APPROVED`
  - `executionStatus: NOT_EXECUTED -> EXECUTED`

### 预期审计事件
- `APPROVAL_SUBMITTED`
- `APPROVAL_APPROVED`
- `AUDIT_EVIDENCE_PACKAGE_EXPORTED`
- `APPROVAL_EXECUTED`

### 验收通过标准
- 页面主展示是 `approvalNo / packageNo`，不是裸 `id`
- 审批通过前不能下载
- 审批通过后可以下载
- `Evidence Export Detail` 能跳到对应 `Approval Detail`

### 常见失败与排查
- `MLRO` 看不到审批按钮：
  - 先确认审批单状态是否是 `PENDING`
  - 刷新详情页
- 导出仍显示 `Waiting Approval`：
  - 先刷新 `Evidence Export Detail`
  - 再确认 `Approval Detail` 中 `status=APPROVED`
- `Audit Log` 看不到可选记录：
  - 清空默认 `Workflow Type=DEPOSIT`
  - 重新点击 `Search`

## 4. Demo Path 2：Change Ticket

### 目标
验证 `Change Ticket` 从创建到闭环的主流程，以及 `ticketNo / latestApprovalNo / gate runs` 展示正确。

### 使用账号
- maker / gate / deploy / close：`TECH_ADMIN`
- checker：`CISO`

### 前置条件
- 已完成 `Approval` 路径

### 操作步骤
1. 使用 `tech_admin@fiatx.com` 登录。
2. 进入 `Governance Center -> Change Tickets`。
3. 点击 `New Ticket`。
4. 在 `Create Change Ticket` 页填写：
   - `Change Type = SYSTEM`
   - `Scope Summary = Demo change ticket for governance acceptance`
   - `Test Evidence Ref = TEST-EVIDENCE-001`
   - `Rollback Plan Ref = ROLLBACK-PLAN-001`
   - `Emergency = OFF`
5. 点击 `Create Ticket`。
6. 进入详情页后，点击 `Submit`。
7. 预期：
   - `ticketNo` 已生成
   - `status = APPROVAL_PENDING`
   - `latestApprovalNo` 已生成
8. 退出登录，使用 `ciso@fiatx.com` 登录。
9. 进入 `Governance Center -> Approvals`。
10. 通过 `Approval No` 或 `Action Type = CHANGE_TICKET_APPROVAL` 找到对应审批。
11. 打开详情，点击 `Approve`。
12. 退出登录，重新使用 `tech_admin@fiatx.com` 登录。
13. 打开刚才的 change ticket 详情。
14. 预期：
   - `status = READY_FOR_DEPLOY`
   - 页面存在 `Run Gate Check`
15. 在 Gate 区域填写：
   - `Target Env = UAT`
   - `Release Version = demo-v1`
16. 点击 `Run Gate Check`。
17. 预期：
   - `Gate Runs` 出现一条 `PASSED`
18. 点击 `Mark Deployed`。
19. 预期：
   - `status = DEPLOYED`
20. 点击 `Close`。
21. 预期：
   - `status = CLOSED`

### 预期状态流转
- Ticket：
  - `DRAFT -> APPROVAL_PENDING -> READY_FOR_DEPLOY -> DEPLOYED -> CLOSED`
- Approval：
  - `PENDING -> APPROVED`
- Gate run：
  - `PENDING/RUNNING -> PASSED`

### 预期审计事件
- `CHANGE_TICKET_CREATED`
- `CHANGE_TICKET_SUBMITTED`
- `CHANGE_TICKET_APPROVAL_LINKED`
- `CHANGE_TICKET_APPROVED`
- `RELEASE_GATE_CHECKED`
- `RELEASE_GATE_PASSED`
- `CHANGE_TICKET_DEPLOYED`
- `CHANGE_TICKET_CLOSED`

### 验收通过标准
- 列表和详情主识别值都是 `ticketNo`
- `latestApprovalNo` 可见，且 `View Approval` 可跳转
- `Gate Runs` 能看到 `UAT / demo-v1 / PASSED`
- 关闭后状态稳定停在 `CLOSED`

### 常见失败与排查
- `Run Gate Check` 按钮不可用：
  - 确认 `status = READY_FOR_DEPLOY`
  - `Release Version` 不能为空
- `Mark Deployed` 不可用：
  - 先确认对应 `targetEnv + releaseVersion` 的 gate run 已经 `PASSED`
- 审批后 ticket 没进入 `READY_FOR_DEPLOY`：
  - 刷新详情页
  - 检查 linked approval 是否已经 `APPROVED`

## 5. Demo Path 3：Delete Request

### 目标
验证 `Delete Request` 对已闭环 `Change Ticket` 的软删能力，以及软删后原模块隐藏、删除请求详情保留。

### 使用账号
- maker：`COMPLIANCE_LEAD`
- checker：`DPO`
- executor：`TECH_ADMIN`

### 前置条件
- 已完成 `Change Ticket` 路径
- 手里已有一张 `status=CLOSED` 的 `ticketNo`

### 操作步骤
1. 记录上一路径产出的 `ticketNo`。
2. 使用 `compliance_lead@fiatx.com` 登录。
3. 进入 `Governance Center -> Delete Requests`。
4. 点击 `New Request`。
5. 在创建页填写：
   - `Target Type = CHANGE_TICKET`
   - `Target No = 上一步 ticketNo`
   - `Delete Reason = Demo delete request for governance acceptance`
   - `Doc Ref = DR-DOC-001`（可选）
6. 点击 `Create Request`。
7. 在详情页点击 `Submit`。
8. 预期：
   - `requestNo` 已生成
   - `status = APPROVAL_PENDING`
   - `latestApprovalNo` 已生成
9. 退出登录，使用 `dpo@fiatx.com` 登录。
10. 进入 `Governance Center -> Approvals`。
11. 使用 `Approval No` 或 `Action Type = DELETE_REQUEST_APPROVAL` 找到对应审批。
12. 点击 `Approve`。
13. 退出登录，使用 `tech_admin@fiatx.com` 登录。
14. 回到 `Governance Center -> Delete Requests`，通过 `requestNo` 打开详情页。
15. 预期：
   - `status = READY_TO_EXECUTE`
16. 点击 `Execute`。
17. 预期：
   - `status = EXECUTED`
   - `Target Snapshot` 模块有内容
18. 回到 `Governance Center -> Change Tickets`，搜索之前的 `ticketNo`。
19. 预期：
   - 列表中查不到这张 ticket

### 预期状态流转
- Delete request：
  - `DRAFT -> APPROVAL_PENDING -> READY_TO_EXECUTE -> EXECUTED`
- Approval：
  - `PENDING -> APPROVED`
- Target：
  - `change_tickets.deletedAt` 被写入

### 预期审计事件
- `DELETE_REQUEST_CREATED`
- `DELETE_REQUEST_SUBMITTED`
- `DELETE_REQUEST_APPROVED`
- `DELETE_REQUEST_EXECUTED`

### 验收通过标准
- 列表与详情主识别值都是 `requestNo`
- 执行后原 `Change Tickets` 页面不再显示目标
- `Delete Request Detail` 仍可查看，并能看到 `Target Snapshot`

### 常见失败与排查
- `Execute` 按钮不显示：
  - 当前账号必须不是 maker
  - `status` 必须是 `READY_TO_EXECUTE`
- 执行时报目标不可删：
  - `CHANGE_TICKET` 必须先是 `CLOSED`
- 列表还能搜到旧 ticket：
  - 刷新列表并重新搜索
  - 确认 delete request 状态已经 `EXECUTED`

## 6. Demo Path 4：SLA Timer

### 目标
验证 `SLA Timer` 的两条链：
- `APPROVAL_TIMEOUT`
- `CHANGE_POST_APPROVAL_FOLLOWUP`

本路径默认采用 `API 创建 demo 链 + UI 验证详情` 的方式。

### 使用账号
- mock API：`SUPER_ADMIN`
- UI 验证与操作：`TECH_ADMIN`

### 前置条件
- 已完成全局基线检查
- 可执行附录里的 SLA mock 命令

### 子链 A：APPROVAL_TIMEOUT

#### 操作步骤
1. 按附录命令创建一条 `approval-timeout` demo 链。
2. 记录返回的：
   - `timerNo`
   - `workflowNo`（审批单 `approvalNo`）
   - `traceId`
3. 使用 `tech_admin@fiatx.com` 登录。
4. 进入 `Governance Center -> SLA Timers`。
5. 按 `Timer No` 搜索刚才的 `timerNo`。
6. 打开详情页，确认：
   - `Timer Type = APPROVAL_TIMEOUT`
   - `Subject Type = APPROVAL_CASE`
   - 页面存在 `View Approval`
   - 页面存在 `Recalc`
   - 页面不存在 `Close`
7. 填写 `Due In Seconds / Grace Seconds / Reason` 后点击 `Recalc`。
8. 预期：
   - 状态仍为 `ACTIVE`
   - `Notifications` 模块有记录
9. 再按附录命令对该 timer 执行 demo `expire`。
10. 刷新详情页，预期：
   - `status = EXPIRED`
   - `expiredAt` 已写入
   - `Notifications` 里能看到 `TRIGGERED`
   - 对应审批应进入 `EXPIRED`

#### 预期审计事件
- `SLA_TIMER_CREATED`
- `SLA_NOTIFICATION_SCHEDULED`
- `SLA_TIMER_RECALCULATED`
- `SLA_NOTIFICATION_TRIGGERED`
- `SLA_TIMER_EXPIRED`
- `APPROVAL_EXPIRED`

### 子链 B：CHANGE_POST_APPROVAL_FOLLOWUP

#### 操作步骤
1. 按附录命令创建一条 `change-follow-up` demo 链。
2. 记录返回的：
   - `timerNo`
   - `workflowNo`（`ticketNo`）
   - `traceId`
3. 使用 `tech_admin@fiatx.com` 登录。
4. 进入 `Governance Center -> SLA Timers`。
5. 按 `Timer No` 搜索刚才的 `timerNo`。
6. 打开详情页，确认：
   - `Timer Type = CHANGE_POST_APPROVAL_FOLLOWUP`
   - `Subject Type = CHANGE_TICKET`
   - 页面存在 `View Change Ticket`
   - 页面存在 `Recalc`
   - 页面存在 `Close`
7. 在 `Recalc Timer` 区域填写：
   - `Due In Seconds = 60`
   - `Grace Seconds = 10`
   - `Reason = Demo follow-up recalc`
8. 点击 `Recalc`。
9. 预期：
   - 状态保持 `ACTIVE`
10. 在 `Close Reason` 中填写任意原因。
11. 点击 `Close`。
12. 预期：
   - `status = CLOSED`
   - `closedAt` 已写入
   - `Notifications` 中未触发的记录显示 `SKIPPED`

#### 预期审计事件
- `SLA_TIMER_CREATED`
- `SLA_NOTIFICATION_SCHEDULED`
- `SLA_TIMER_RECALCULATED`
- `SLA_NOTIFICATION_SKIPPED`
- `SLA_TIMER_CLOSED`

### 验收通过标准
- `APPROVAL_TIMEOUT` 没有 `Close` 按钮
- `CHANGE_POST_APPROVAL_FOLLOWUP` 同时有 `Recalc` 和 `Close`
- 两类 timer 都能在详情页看到 `Notifications`
- `timerNo / workflowNo / subjectNo / traceId` 都可检索

### 常见失败与排查
- 列表搜不到 timer：
  - 先点击 `Refresh`
  - 再按 `Timer No` 精确搜索
- `Close` 不显示：
  - 仅 `CHANGE_POST_APPROVAL_FOLLOWUP` 才允许关闭
  - 当前角色需有 `GOV_SLA_WRITE`
- `APPROVAL_TIMEOUT` 没过期：
  - 直接使用附录 demo `expire`
  - 不要手工等待默认超时

## 7. Demo Path 5：Audit Center

### 目标
把前面 4 条链的结果统一放回 `Audit Center` 验证，确认：
- `workflowNo / traceId / subjectNo` 可反查
- 审计事件完整
- `Evidence Export` 详情与审批关系可追溯

### 使用账号
- 推荐：`SUPER_ADMIN`

### 前置条件
- 已完成前 4 条路径
- 手里已有：
  - `approvalNo`
  - `packageNo`
  - `ticketNo`
  - `requestNo`
  - `timerNo`
  - 至少一个 `traceId`

### 操作步骤
1. 使用 `admin@fiatx.com` 登录。
2. 进入 `Audit Center -> Audit Log`。
3. 先执行一次重要动作：
   - 清空默认 `Workflow Type = DEPOSIT`
   - 点击 `Search`
4. 依次用以下字段验证：
   - `Workflow No = approvalNo`
   - `Workflow No = ticketNo`
   - `Workflow No = requestNo`
   - `Trace ID = SLA mock 返回的 traceId`
5. 每次命中后，打开任意一条 `View Detail`，确认详情页字段分组正常。
6. 重点确认以下 action name 能被筛出：
   - `APPROVAL_SUBMITTED`
   - `APPROVAL_APPROVED`
   - `AUDIT_EVIDENCE_PACKAGE_EXPORTED`
   - `CHANGE_TICKET_CREATED`
   - `RELEASE_GATE_PASSED`
   - `CHANGE_TICKET_CLOSED`
   - `DELETE_REQUEST_EXECUTED`
   - `SLA_TIMER_CREATED`
   - `SLA_TIMER_RECALCULATED`
   - `SLA_TIMER_CLOSED`
   - `SLA_TIMER_EXPIRED`
7. 进入 `Audit Center -> Evidence Export`。
8. 用 `packageNo` 找到 `Approval` 路径里创建的导出记录，打开详情。
9. 预期：
   - `packageNo`、`digest`、`manifest`、`packageBody` 可见
   - `approvalCase.approvalNo` 可见
   - 存在 `Open Approval`
10. 点击 `Open Approval`，确认能打开对应审批详情。

### 验收通过标准
- 审计中心能通过 `workflowNo / traceId` 查到治理事件
- `Change Ticket` 在被软删后，审计链仍然能通过 `workflowNo=ticketNo` 查到
- `Evidence Export` 的审批关联是可追溯的

### 常见失败与排查
- 治理事件查不到：
  - 先清空 `Workflow Type=DEPOSIT`
  - 再点击 `Search`
- `Evidence Export` 明细打不开：
  - 确认 package 没被 `Delete Request` 删除
- `Change Ticket` 原详情打不开但审计还在：
  - 这是正常现象，说明 soft delete 生效了

## 8. 快速 API / Smoke 命令附录

### 8.1 环境基线

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-evidence/Exchange_js
npm run db:base:sync
npm run dev:start
curl http://localhost:3500/api
```

### 8.2 一键跑通 SLA demo

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/audit-evidence/Exchange_js
export API_BASE_URL=http://localhost:3500
export ADMIN_EMAIL=admin@fiatx.com
export ADMIN_PASSWORD=123456
npm run sla:demo:smoke
```

### 8.3 获取 Bearer Token

```bash
TOKEN=$(curl -s http://localhost:3500/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@fiatx.com","password":"123456"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write(JSON.parse(s).access_token));")
echo "$TOKEN" | head -c 24 && echo '...'
```

### 8.4 创建 `APPROVAL_TIMEOUT` demo chain

```bash
curl -s http://localhost:3500/admin/demo/governance/sla-timers/approval-timeout \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"dueInSeconds":15,"graceSeconds":0,"reason":"Acceptance approval-timeout demo"}'
```

### 8.5 创建 `CHANGE_POST_APPROVAL_FOLLOWUP` demo chain

```bash
curl -s http://localhost:3500/admin/demo/governance/sla-timers/change-follow-up \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"dueInSeconds":20,"graceSeconds":5,"reason":"Acceptance change follow-up demo"}'
```

### 8.6 强制使 active timer 过期

```bash
curl -s http://localhost:3500/admin/demo/governance/sla-timers/<timerId>/expire \
  -X POST \
  -H "Authorization: Bearer $TOKEN"
```

### 8.7 手工 Recalc timer

```bash
curl -s http://localhost:3500/admin/governance/sla-timers/<timerId>/recalc \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"dueInSeconds":30,"graceSeconds":10,"reason":"Acceptance recalc"}'
```

### 8.8 按 workflowNo 快速拉审计

```bash
curl -s "http://localhost:3500/admin/audit-logs?workflowNo=<workflowNo>&take=100" \
  -H "Authorization: Bearer $TOKEN"
```
