# Main 本地运行与修复手册

## 1. 标准基线
- 工作目录：当前 worktree 的 `Exchange_js` 目录
- 标准本地 stack：`main`
- 默认端口：
  1. backend `3000`
  2. admin-web `3001`
  3. client-web `3002`
- 默认数据库：`/tmp/exchange_js_main/dev.db`

`main` 的日常入口只保留一套：

```bash
npm run dev:start
npm run dev:stop
npm run dev:reset
npm run dev:rebuild
npm run runtime:diagnose
```

其中：
- `npm run dev:start` 等价于 `npm run stack:up:main`
- `npm run dev:stop` 等价于 `npm run stack:down:main`
- `npm run dev:reset` 只做业务数据重置，不删除整个 DB
- `npm run dev:rebuild` 会重建本地 `main` DB
- stack-managed 命令默认锁定 `main` DB：
  - `/tmp/exchange_js_main/dev.db`
  - 不应被当前 worktree `.env` 中的实验栈 `DATABASE_URL` 偷换
  - 若需要临时诊断其他 DB，只能显式传入 `DATABASE_URL=...`

## 2. 推荐日常流程

### 启动

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npm run runtime:diagnose
npm run dev:start
curl http://localhost:3000/api
```

通过标准：
- `runtime:diagnose` 的 `dbFile` 指向 `/tmp/exchange_js_main/dev.db`
- `migration.driftDetected` 为 `false`
- `curl http://localhost:3000/api` 返回 `200`

### 停止

```bash
npm run dev:stop
```

### 仅重置业务数据

```bash
npm run dev:reset
```

适用场景：
- 需要清空 demo / workflow 业务数据
- 不希望破坏 base IAM / 角色权限基线
- 只是想回到干净业务态，不是修 migration 问题

### 整库重建

```bash
npm run dev:rebuild
```

适用场景：
- 本地 SQLite 已经混乱
- migration 漂移、表结构异常、旧兼容状态太多
- 希望重新从 `prisma/migrations/**/migration.sql` 构建 `main`

## 3. Migration 纪律
- 已经应用过的 `prisma/migrations/**/migration.sql` 不允许直接改内容
- 需要变更 schema 时，必须新增 migration，不要修改历史 migration
- 本地 migration runner 现在会校验 checksum
- 如果看到 `checksum drift detected`，含义是“你改了已应用 migration”，不是“脚本没跑”

标准修复方式：
1. 回退被改动的历史 migration 内容，或
2. 清理本地 DB 后执行 `npm run dev:rebuild`，或
3. 新增一条正确的 migration，而不是继续覆盖旧文件

## 4. 如何看 `runtime:diagnose`

```bash
npm run runtime:diagnose
```

关键字段：
- `databaseUrl` / `dbFile`：当前服务实际会落到哪个 DB
- `migration.pendingLocal`：本地 migration 文件存在，但 DB 还没应用
- `migration.missingLocal`：DB 里记录了 migration，但当前文件树里不存在
- `migration.checksumMismatches`：同名 migration 已应用，但文件内容被改过
- `migration.driftDetected`：上面三类问题的汇总标记

治理计数字段：
- `counts.approvalCases`
- `counts.changeTickets`
- `counts.deleteRequests`
- `counts.slaTimers`
- `counts.evidencePackages`

## 5. 何时运行 `wave1:repair`

`wave1:repair` 不是日常启动步骤，只在“旧治理投影需要补修”时使用。

适用场景：
- 导入了老的本地 DB
- `approval_cases`、`change_tickets`、`delete_requests` 已有数据，但 `latestApprovalId/latestApprovalStatus` 投影缺失或不一致
- migration 本身没有漂移，但治理 UI 展示仍然像旧状态

运行方式：

```bash
npm run wave1:repair
```

如果要检查或修复旧 DB，可显式指定：

```bash
DATABASE_URL="file:/tmp/exchange_js_audit_evidence/dev.db" npm run runtime:diagnose
DATABASE_URL="file:/tmp/exchange_js_audit_evidence/dev.db" npm run wave1:repair
```

## 6. 推荐的故障排查顺序
1. 先跑 `npm run runtime:diagnose`
2. 如果是端口/旧进程问题，先 `npm run dev:stop`
3. 如果是业务脏数据，跑 `npm run dev:reset`
4. 如果是 migration 漂移或表结构错乱，跑 `npm run dev:rebuild`
5. 如果是旧治理投影不一致，再跑 `npm run wave1:repair`

## 7. Governance 冒烟命令

服务启动后，可直接跑这三条：

```bash
API_BASE_URL=http://localhost:3000 npm run governance:demo:seed
API_BASE_URL=http://localhost:3000 npm run sla:demo:smoke
API_BASE_URL=http://localhost:3000 npm run wave1:foundation:smoke
```

它们分别覆盖：
- `Approval / Change Ticket / Delete Request` 主治理链
- `SLA Timer + Audit Log` 冒烟链
- `Wave 1` 基座硬化链：
  - onboarding case decision 只返回 `case`
  - periodic review case decision 只返回 `case`
  - audit export / case export 的 approval detail 追跳
  - delete request 删除 `COMPLIANCE_CASE_EVIDENCE_PACKAGE`
  - delete request 删除 `ADMIN_USER`
  - 已软删 admin user 的登录 / 邀请 / 角色绑定 / 列表过滤

## 8. Wave 1 基座回归顺序

推荐在 fresh DB 上按以下顺序执行：

```bash
npm run dev:rebuild
npm run runtime:diagnose
npm run dev:start
API_BASE_URL=http://localhost:3000 npm run governance:demo:seed
API_BASE_URL=http://localhost:3000 npm run sla:demo:smoke
API_BASE_URL=http://localhost:3000 npm run wave1:foundation:smoke
```

通过标准：
- `runtime:diagnose` 结果中 `migration.driftDetected = false`
- `wave1:foundation:smoke` 成功输出：
  - onboarding / periodic review 的 case 编号
  - audit evidence package 编号
  - 已删除 case evidence package 编号
  - 已删除 admin user 编号
