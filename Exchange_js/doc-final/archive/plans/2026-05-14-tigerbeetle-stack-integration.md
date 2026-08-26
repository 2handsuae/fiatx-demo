# TigerBeetle Stack Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `npm run dev:start` 自动启动 TigerBeetle，backend 收到正确的 `TB_ADDRESS`，每个栈的所有进程严格限定在自己的端口段内不交叉。

**Architecture:** 在 `stack-common.sh` 为每个栈声明 TB 端口和数据文件路径；在 `stack-up.sh` 启动 backend 前先启动 TigerBeetle 并等待其就绪，同时把 `TB_ADDRESS` 注入 backend 启动环境；在 `stack-stop.sh` 一并关停 TB 进程。端口规则：每栈 backend/admin/client/TB 分别占 x000/x001/x002/x003，main=300x，branch=350x。

**Tech Stack:** Bash, TigerBeetle CLI (`tigerbeetle format` / `tigerbeetle start --development`), Python subprocess launcher（已有 `launch_detached_service`）

---

## File Map

| 文件 | 变更类型 | 职责 |
|------|----------|------|
| `CLAUDE.md` | Modify | 记录端口规则，防止将来违反 |
| `scripts/stack-common.sh` | Modify | 为每个栈声明 `TB_PORT` / `TB_DATA_FILE` / `TB_ADDRESS` / `TB_LOG` / `TB_PID_FILE`（变量结构已在上一个会话添加，本次修正端口号） |
| `scripts/stack-up.sh` | Modify | 启动前检查 TB 命令 + 格式化数据文件（首次）+ 启动 TB + 等待就绪；backend 启动环境注入 `TB_ADDRESS`；更新 summary 输出 |
| `scripts/stack-stop.sh` | Modify | 通过 pid file 停止 TB；通过 pattern 清理孤儿 TB 进程 |

---

## Task 1: 更新 CLAUDE.md — 端口规则

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 在"服务启动规则"表格下方添加端口隔离规则**

在 `CLAUDE.md` 的服务启动规则部分，现有的三行表格（API/Admin/Client）之后、`.env 必须设置` 那条 bullet 之前，插入以下内容：

```markdown
| TigerBeetle | **3003** | branch 用 **3503** |
```

然后在 `.env` bullet 列表中补充：

```markdown
- `.env` 必须同时设置 `TB_ADDRESS=http://127.0.0.1:3003`（branch 为 `3503`）
- **端口隔离规则（不可违反）**：每个栈的所有进程必须限定在同一端口段，严禁跨栈访问：

| 栈 | Backend | Admin | Client | TigerBeetle |
|-----|---------|-------|--------|-------------|
| main | 3000 | 3001 | 3002 | **3003** |
| codex | 3100 | 3101 | 3102 | **3103** |
| claude | 3200 | 3201 | 3202 | **3203** |
| trae | 3300 | 3301 | 3302 | **3303** |
| branch | 3500 | 3501 | 3502 | **3503** |
```

- [ ] **Step 2: 验证 CLAUDE.md 渲染正确**

```bash
head -60 CLAUDE.md
```

Expected: 服务启动规则下方可见完整端口隔离表格。

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add port isolation rules to CLAUDE.md (main=300x, branch=350x)"
```

---

## Task 2: 修正 stack-common.sh TB 端口号

**Files:**
- Modify: `scripts/stack-common.sh`

> 说明：`stack-common.sh` 在上一个会话已添加了 `TB_PORT` / `TB_DATA_FILE` / `TB_ADDRESS` / `TB_LOG` / `TB_PID_FILE` 变量声明和每栈赋值块，但端口号用的是 4000/4500 系列。本任务把它们修正为遵循 `x003` 规则的值。

- [ ] **Step 1: 修正所有栈的 TB_PORT**

找到以下 6 处赋值，逐一改为正确值：

```bash
# main: 改 4000 → 3003
TB_PORT="3003"

# codex: 改 4100 → 3103
TB_PORT="3103"

# claude: 改 4200 → 3203
TB_PORT="3203"

# trae: 改 4300 → 3303
TB_PORT="3303"

# branch: 改 4500 → 3503
TB_PORT="3503"

# audit-evidence: 改 4500 → 3503（与 branch 共享数据文件）
TB_PORT="3503"
```

- [ ] **Step 2: 验证最终的 TB 变量块**

```bash
grep -A2 "TB_PORT\|TB_DATA_FILE\|TB_ADDRESS\|TB_LOG\|TB_PID_FILE" scripts/stack-common.sh
```

Expected 输出中应该看到：
- main 块: `TB_PORT="3003"`, `TB_DATA_FILE="/tmp/exchange_js_main/0_0.tigerbeetle"`
- branch 块: `TB_PORT="3503"`, `TB_DATA_FILE="/tmp/exchange_js_branch/0_0.tigerbeetle"`
- `TB_ADDRESS="127.0.0.1:${TB_PORT}"` 在 esac 后的公共派生行

- [ ] **Step 3: Commit**

```bash
git add scripts/stack-common.sh
git commit -m "fix: correct TB port assignments to x003 scheme (main=3003, branch=3503)"
```

---

## Task 3: 更新 stack-up.sh — 启动 TigerBeetle + 注入 TB_ADDRESS

**Files:**
- Modify: `scripts/stack-up.sh`

本任务需要 4 处独立修改，按顺序执行。

### 3a: require_commands 加入 tigerbeetle

- [ ] **Step 1: 找到 require_commands 调用行并加入 `tigerbeetle`**

当前行（约第 34 行）：
```bash
require_commands node npm lsof sqlite3 git python3
```

改为：
```bash
require_commands node npm lsof sqlite3 git python3 tigerbeetle
```

### 3b: rm -f 加入 TB_PID_FILE

- [ ] **Step 2: 找到 `rm -f` 那一行并加入 TB_PID_FILE**

当前：
```bash
rm -f "${BACKEND_PID_FILE}" "${ADMIN_PID_FILE}" "${CLIENT_PID_FILE}"
```

改为：
```bash
rm -f "${BACKEND_PID_FILE}" "${ADMIN_PID_FILE}" "${CLIENT_PID_FILE}" "${TB_PID_FILE}"
```

### 3c: ensure_port_free 加入 TB 端口

- [ ] **Step 3: 在 3 条 ensure_port_free 之后加第 4 条**

当前（约第 85-87 行）：
```bash
ensure_port_free "${BACKEND_PORT}" "backend"
ensure_port_free "${ADMIN_PORT}" "admin"
ensure_port_free "${CLIENT_PORT}" "client"
```

改为：
```bash
ensure_port_free "${BACKEND_PORT}" "backend"
ensure_port_free "${ADMIN_PORT}" "admin"
ensure_port_free "${CLIENT_PORT}" "client"
ensure_port_free "${TB_PORT}" "tb"
```

### 3d: 在 backend build 之前插入 TB 启动块

- [ ] **Step 4: 在 `echo "[${STACK}] building backend runtime"` 之前插入 TB 启动逻辑**

在该行前方插入：
```bash
echo "[${STACK}] starting TigerBeetle at ${TB_ADDRESS}"
mkdir -p "$(dirname "${TB_DATA_FILE}")"
if [ ! -f "${TB_DATA_FILE}" ]; then
  echo "[${STACK}] formatting new TigerBeetle data file..."
  tigerbeetle format --cluster=0 --replica=0 --replica-count=1 "${TB_DATA_FILE}"
fi
launch_detached_service \
  "/" \
  "${TB_LOG}" \
  "[\"tigerbeetle\",\"start\",\"--development\",\"--addresses=${TB_ADDRESS}\",\"${TB_DATA_FILE}\"]" \
  "{}" \
  >/dev/null
capture_listener_pid "tb" "${TB_PORT}" "${TB_PID_FILE}"
```

> 说明：`capture_listener_pid` 最多等 60 秒（每 0.5s 轮询一次 lsof），TB 通常在 1-2 秒内就绪。如果超时会报错中止整个 up 流程，避免 backend 启动时连不上 TB。

### 3e: backend 启动环境注入 TB_ADDRESS

- [ ] **Step 5: 找到 backend 的 launch_detached_service 调用，在 env JSON 中加入 TB_ADDRESS**

当前：
```bash
  "{\"API_PORT\":\"${BACKEND_PORT}\",\"ADMIN_URL\":\"${ADMIN_URL}\",\"CLIENT_URL\":\"${CLIENT_URL}\",\"DATABASE_URL\":\"${DB_URL}\",\"GOVERNANCE_DEMO_ENABLED\":\"${GOVERNANCE_DEMO_ENABLED:-true}\"}" \
```

改为：
```bash
  "{\"API_PORT\":\"${BACKEND_PORT}\",\"ADMIN_URL\":\"${ADMIN_URL}\",\"CLIENT_URL\":\"${CLIENT_URL}\",\"DATABASE_URL\":\"${DB_URL}\",\"GOVERNANCE_DEMO_ENABLED\":\"${GOVERNANCE_DEMO_ENABLED:-true}\",\"TB_ADDRESS\":\"${TB_ADDRESS}\"}" \
```

### 3f: 更新 summary 输出，包含 TB 信息

- [ ] **Step 6: 在 summary 输出块加入 TB 地址和日志路径**

当前 summary 块：
```bash
echo "[${STACK}] all services started"
echo "Branch: $(stack_branch)"
echo "API:    ${BACKEND_URL}"
echo "Admin:  ${ADMIN_URL}"
echo "Client: ${CLIENT_URL}"
echo ""
echo "Logs:"
echo "  ${BACKEND_LOG}"
echo "  ${ADMIN_LOG}"
echo "  ${CLIENT_LOG}"
echo ""
echo "Tail logs:"
echo "  tail -f ${BACKEND_LOG}"
echo "  tail -f ${ADMIN_LOG}"
echo "  tail -f ${CLIENT_LOG}"
```

改为：
```bash
echo "[${STACK}] all services started"
echo "Branch: $(stack_branch)"
echo "API:    ${BACKEND_URL}"
echo "Admin:  ${ADMIN_URL}"
echo "Client: ${CLIENT_URL}"
echo "TB:     ${TB_ADDRESS}"
echo ""
echo "Logs:"
echo "  ${BACKEND_LOG}"
echo "  ${ADMIN_LOG}"
echo "  ${CLIENT_LOG}"
echo "  ${TB_LOG}"
echo ""
echo "Tail logs:"
echo "  tail -f ${BACKEND_LOG}"
echo "  tail -f ${ADMIN_LOG}"
echo "  tail -f ${CLIENT_LOG}"
echo "  tail -f ${TB_LOG}"
```

- [ ] **Step 7: Commit**

```bash
git add scripts/stack-up.sh
git commit -m "feat: start TigerBeetle in stack-up.sh and inject TB_ADDRESS into backend"
```

---

## Task 4: 更新 stack-stop.sh — 停止 TigerBeetle

**Files:**
- Modify: `scripts/stack-stop.sh`

- [ ] **Step 1: 在 3 条 stop_pid_file_process 后加入 TB**

当前（约第 13-15 行）：
```bash
stop_pid_file_process "backend" "${BACKEND_PID_FILE}"
stop_pid_file_process "admin" "${ADMIN_PID_FILE}"
stop_pid_file_process "client" "${CLIENT_PID_FILE}"
```

改为：
```bash
stop_pid_file_process "backend" "${BACKEND_PID_FILE}"
stop_pid_file_process "admin" "${ADMIN_PID_FILE}"
stop_pid_file_process "client" "${CLIENT_PID_FILE}"
stop_pid_file_process "tb" "${TB_PID_FILE}"
```

- [ ] **Step 2: 在 cleanup_orphans_by_pattern 块末尾加入 TB 孤儿进程清理**

当前（约第 43-45 行）：
```bash
cleanup_orphans_by_pattern "backend-orphan" "${APP_DIR}/dist/main"
cleanup_orphans_by_pattern "admin-orphan" "${APP_DIR}/admin-web/node_modules/.bin/vite --host 0.0.0.0 --port ${ADMIN_PORT}"
cleanup_orphans_by_pattern "client-orphan" "${APP_DIR}/client-web/node_modules/.bin/vite --host 0.0.0.0 --port ${CLIENT_PORT}"
```

改为：
```bash
cleanup_orphans_by_pattern "backend-orphan" "${APP_DIR}/dist/main"
cleanup_orphans_by_pattern "admin-orphan" "${APP_DIR}/admin-web/node_modules/.bin/vite --host 0.0.0.0 --port ${ADMIN_PORT}"
cleanup_orphans_by_pattern "client-orphan" "${APP_DIR}/client-web/node_modules/.bin/vite --host 0.0.0.0 --port ${CLIENT_PORT}"
cleanup_orphans_by_pattern "tb-orphan" "tigerbeetle start.*${TB_DATA_FILE}"
```

> 说明：pattern 包含 `TB_DATA_FILE` 路径，不同栈的数据文件路径不同（`exchange_js_main` vs `exchange_js_branch`），所以 `dev:stop branch` 不会误杀 main 栈的 TB 进程。

- [ ] **Step 3: Commit**

```bash
git add scripts/stack-stop.sh
git commit -m "feat: stop TigerBeetle in stack-stop.sh"
```

---

## Task 5: 端到端验证

- [ ] **Step 1: 停止当前所有服务**

```bash
cd Exchange_js
npm run dev:stop
```

- [ ] **Step 2: 验证 TB 进程已停止**

```bash
pgrep -f "tigerbeetle start" || echo "TB not running — OK"
```

Expected: `TB not running — OK`

- [ ] **Step 3: 启动完整 stack**

```bash
npm run dev:start
```

Expected: 输出中依次出现：
```
[branch] starting TigerBeetle at 127.0.0.1:3503
[branch/tb] listening on 3503 (pid XXXX)
[branch] building backend runtime
[branch/backend] listening on 3500 (pid XXXX)
[branch/admin] listening on 3501 (pid XXXX)
[branch/client] listening on 3502 (pid XXXX)
TB:     127.0.0.1:3503
```

- [ ] **Step 4: 验证 backend log 不再有 connection refused 刷屏**

```bash
sleep 5
grep "ConnectionRefused\|connection_refused" /tmp/exchange_js_runtime_branch/backend.log | wc -l
```

Expected: `0`（backend log 不含 TB 连接失败消息）

- [ ] **Step 5: 验证 TB log 正常**

```bash
head -5 /tmp/exchange_js_runtime_branch/tb.log
```

Expected: TigerBeetle 启动日志，不含 `ConnectionRefused`。

- [ ] **Step 6: 验证 4 个端口都在监听**

```bash
lsof -nP -iTCP:3500,3501,3502,3503 -sTCP:LISTEN
```

Expected: 4 行，分别对应 backend / admin / client / TB。

- [ ] **Step 7: 停止并验证 TB 被清理**

```bash
npm run dev:stop
sleep 2
pgrep -f "tigerbeetle start" || echo "TB stopped — OK"
lsof -nP -iTCP:3500,3501,3502,3503 -sTCP:LISTEN || echo "all ports free — OK"
```

Expected: 两行 OK。

---

## Self-Review

**Spec coverage:**
- ✅ stack-up.sh 不启动 TB → Task 3d
- ✅ backend 不收到 TB_ADDRESS → Task 3e
- ✅ .env 错误问题 → env vars 通过 launch_detached_service 注入，绕过 .env（不需要改 .env）
- ✅ 端口规则文档化 → Task 1
- ✅ 端口号修正 → Task 2
- ✅ 停止逻辑 → Task 4

**Placeholder scan:** 无 TBD / TODO。

**Type consistency:** 所有变量名（TB_PORT / TB_DATA_FILE / TB_ADDRESS / TB_LOG / TB_PID_FILE）在 Task 2、3、4 中保持一致，均来自 stack-common.sh 的声明。

**关于 .env 文件：** `launch_detached_service` 通过 Python `os.environ.copy()` + 注入 dict 覆盖环境变量，`TB_ADDRESS` 在启动时直接通过进程环境传入，不依赖 `.env` 文件。所以 `.env` 文件内容错误不影响实际运行。（.env 可以选择性修正，但不是 blocker。）
