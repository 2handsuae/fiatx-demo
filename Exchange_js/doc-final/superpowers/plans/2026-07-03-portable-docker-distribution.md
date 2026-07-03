# 可移植 Docker 交付 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把项目改造成"一条命令产出、与本机无关、装好 Docker 就能跑"的可移植交付包，同事（含 Windows）解压后 `docker compose up` 即可看演示。

**Architecture:** 三阶段——① 清垃圾 + 去机器化（配置/路径/密钥，纯仓库改动）；② Docker 化（4 服务：tigerbeetle/backend/admin/client + compose + 启动即 seed）；③ 升级打包命令（`git archive` 出干净包 + 双击封装 + 对面 README）。交付包由对面机器本地构建镜像（各自 arch 自适应），彻底绕开本机绝对路径与平台绑定。

**Tech Stack:** Docker / docker compose、Node 20、NestJS、Prisma(SQLite)、Vite/React、TigerBeetle、bash。

**验证基线（每阶段末锚点）：** spec `doc-final/superpowers/specs/2026-07-03-portable-docker-distribution-design.md`。

**环境前提：** 执行机需装 `docker` + `docker compose`（Phase 2/3 验证要真起容器）。开工前先 `docker --version && docker compose version` 确认；无 Docker 则 Phase 1 可做，Phase 2/3 需在有 Docker 的环境执行。

---

## Phase 1 — 清垃圾 + 去机器化（仓库改动，无 Docker）

### Task 1.1: 清本机垃圾文件

**Files:**
- Delete: `Exchange_js/prisma/*.bak*`（10 个）、全仓 `.DS_Store`（17 个）
- 不动：`.claude/worktrees/settle-opt`（真活，保留）

- [ ] **Step 1: 删 .bak + .DS_Store（均 gitignored，纯本地清理）**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版
rm -f Exchange_js/prisma/*.bak*
find . -name .DS_Store -not -path '*/node_modules/*' -not -path '*/.git/*' -delete
```

- [ ] **Step 2: 验证已清 + settle-opt 未动**

Run: `ls Exchange_js/prisma/*.bak* 2>/dev/null | wc -l; find . -name .DS_Store -not -path '*/node_modules/*' | wc -l; git worktree list | grep -c settle-opt`
Expected: `0`（bak）/ `0`（DS_Store）/ `1`（settle-opt 仍在）

- [ ] **Step 3: 无需 commit（都是 gitignored 本地文件）** —— 记录到收尾报告即可。

---

### Task 1.2: 清 launch.json 死配置

**Files:**
- Modify: `.claude/launch.json`

- [ ] **Step 1: 只保留指向现存路径的配置，删 5 条死的**

保留 `admin`(3001)/`admin-web-main`(3103)/`backend-main`(3010)/`client-web-main`(3102) 四条（指向 `Exchange_js/...` 现存路径）；删 `claude-admin`/`audit-log-redesign`/`branch-admin`/`admin-web`/`client-web`（指向已删 `.wt/` 或 `/tmp/serve-audit.py`）。用 Edit 工具逐条移除死配置对象。

- [ ] **Step 2: 验证 JSON 合法 + 无死路径**

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude/launch.json'))" && grep -c '.wt/\|serve-audit' .claude/launch.json`
Expected: 无报错（JSON 合法）；`0`（无死路径残留）

- [ ] **Step 3: Commit**

```bash
git add .claude/launch.json
git commit -m "chore: 清理 launch.json 指向已删路径的死配置"
```

---

### Task 1.3: 密钥 + `.env.example` 去敏（保证 git archive 出的包零真密钥）

**Files:**
- Delete line: 根 `.env`（本地 gitignored）中的 `MINIMAX_API_KEY`（exchange 0 引用）
- Verify/Modify: `Exchange_js/.env.example`（tracked，会进包）

- [ ] **Step 1: 查 .env.example 现有内容 + 是否含真密钥**

Run: `cat Exchange_js/.env.example`
Expected: 人工核对——`DATABASE_URL` 应指项目内、`MFA_ENCRYPTION_KEY` 应是 demo 占位、`SUMSUB_MOCK_MODE=true`、**无真密钥**。

- [ ] **Step 2: 若 .env.example 缺项/含真值，改为 demo 安全默认**

确保含（示例值，非真密钥）：
```
DATABASE_URL="file:./prisma/dev.db"
API_PORT=3000
ADMIN_URL=http://localhost:3001
CLIENT_URL=http://localhost:3002
TB_ADDRESS=127.0.0.1:3003
SUMSUB_MOCK_MODE=true
GOVERNANCE_DEMO_ENABLED=true
MFA_ENCRYPTION_KEY=dev-demo-key-change-me-0000000000000000000000000000000000000000
MFA_ISSUER=Exchange Admin (Demo)
```

- [ ] **Step 3: 删本机根 .env 的 MINIMAX（无用残留，降低本地误压风险）**

用 Edit 删掉 `MINIMAX_API_KEY=...` 那行。

- [ ] **Step 4: 验证 tracked 文件零真密钥**

Run: `git ls-files | xargs grep -lE 'sk-api-|MINIMAX_API_KEY' 2>/dev/null | grep -v '\.md$'; echo "---"; grep -c 'DATABASE_URL=.file:./prisma' Exchange_js/.env.example`
Expected: 第一行空（tracked 文件无真密钥）；`1`（.env.example DB 指项目内）

- [ ] **Step 5: Commit**

```bash
git add Exchange_js/.env.example
git commit -m "chore: .env.example 去敏 + DB 指项目内（可移植默认）"
```

---

### Task 1.4: 拔 npm 脚本 + shell/ts 脚本里的 `/tmp` 硬编码

**Files:**
- Modify: `Exchange_js/package.json`（`recon:demo*` / `demo:*` / `recon:rerun` 共 ~11 条）
- Modify: `Exchange_js/scripts/{db-env.sh,dev-tigerbeetle.sh,stack-common.sh,recon-demo.ts,verify-demo-data.ts,verify-p6-lock-release.ts,verify-swap-redesign-happy.ts,verify-swap-self-heal.ts,backfill-internal-fund-keys.ts}`

**做法：** 硬编码 `file:/tmp/exchange_js_main/dev.db` → 改为读环境变量、带**可移植默认**，不破坏用户本机 stack（用户仍可 export 覆盖到 /tmp）。

- [ ] **Step 1: package.json 脚本改为环境变量驱动**

把每条 `DATABASE_URL="file:/tmp/exchange_js_main/dev.db" TB_ADDRESS=127.0.0.1:3003 ts-node ...` 前缀替换为依赖外部 env（脚本内部用 `${DATABASE_URL:-file:./prisma/dev.db}` 兜底）。即命令里删掉写死的 `DATABASE_URL=...`/`TB_ADDRESS=...` 前缀，改由 `.env` / compose 注入。

- [ ] **Step 2: ts/sh 脚本内的 /tmp 兜底改可移植**

各 `.ts`/`.sh` 里出现的 `/tmp/exchange_js_main/...` 字面量 → 改 `process.env.DATABASE_URL ?? 'file:./prisma/dev.db'`（ts）/ `"${DATABASE_URL:-file:./prisma/dev.db}"`（sh）。`dev-tigerbeetle.sh` 的 `TB_DATA=/tmp/...` → `"${TB_DATA:-./prisma/0_0.tigerbeetle}"`。

- [ ] **Step 3: 验证功能文件零 /tmp 硬编码**

Run: `grep -rn '/tmp/exchange_js' Exchange_js/package.json Exchange_js/scripts | grep -v '\.md' | wc -l`
Expected: `0`

- [ ] **Step 4: 验证本机 main 栈仍可跑（不回归）**

Run: `bash scripts/on-stack.sh main verify:coa` 或最小 `npm run runtime:diagnose`（在有 main 栈时）
Expected: 与改动前一致（无新报错）。⚠️ 若本会话无 main 栈，记录为"待执行者在有栈环境复验"。

- [ ] **Step 5: Commit**

```bash
git add Exchange_js/package.json Exchange_js/scripts
git commit -m "chore: 脚本 /tmp 硬编码改环境变量驱动（可移植默认落项目内）"
```

---

## Phase 2 — Docker 化（4 服务，本机 `docker compose up` 验证）

### Task 2.1: `.dockerignore`（构建上下文瘦身）

**Files:**
- Create: `Exchange_js/.dockerignore`

- [ ] **Step 1: 写 .dockerignore**

```
node_modules
*/node_modules
dist
*/dist
.git
prisma/*.bak*
prisma/dev.db*
.env
*.log
.DS_Store
```

- [ ] **Step 2: Commit**

```bash
git add Exchange_js/.dockerignore
git commit -m "chore(docker): add .dockerignore"
```

---

### Task 2.2: 后端 Dockerfile（含 migrate + seed 编排入口）

**Files:**
- Create: `Exchange_js/Dockerfile`
- Create: `Exchange_js/docker/backend-entrypoint.sh`

- [ ] **Step 1: 写后端 Dockerfile（多阶段）**

```dockerfile
# ---- build ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

# ---- runtime ----
FROM node:20-bookworm-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts ./scripts
COPY docker/backend-entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
ENV NODE_ENV=production
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
```

- [ ] **Step 2: 写 entrypoint（migrate → base seed → 起后端 → 后台 seed demo 数据）**

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?}"; : "${TB_ADDRESS:?}"
echo "[entrypoint] prisma migrate deploy"
npx prisma migrate deploy --schema ./prisma/schema.prisma
echo "[entrypoint] base seed"
node dist/prisma/seed.js 2>/dev/null || npx ts-node -r tsconfig-paths/register prisma/seed.ts
echo "[entrypoint] start backend"
node dist/main &
BACK=$!
# 等后端就绪后铺演示数据（幂等；失败不致命）
until curl -sf "http://127.0.0.1:${API_PORT:-3000}/health" >/dev/null 2>&1; do sleep 1; done
echo "[entrypoint] seed demo data (demo:all)"
npm run demo:all || echo "[entrypoint] demo seed skipped/failed (non-fatal)"
wait $BACK
```
> ⚠️ 执行者核对：`seed.ts` 编译产物路径、`/health` 端点是否存在（无则换一个 200 的只读端点或改 `sleep 8`）、`demo:all` 是否依赖已被 Task 1.4 改成 env 驱动（是）。

- [ ] **Step 3: 验证后端镜像能构建**

Run: `cd Exchange_js && docker build -t exchange-backend .`
Expected: 构建成功，末行 `naming to ... exchange-backend`。

- [ ] **Step 4: Commit**

```bash
git add Exchange_js/Dockerfile Exchange_js/docker/backend-entrypoint.sh
git commit -m "feat(docker): backend image + migrate/seed entrypoint"
```

---

### Task 2.3: 前端 Dockerfile（admin + client，构建静态 + nginx 托管）

**Files:**
- Create: `Exchange_js/admin-web/Dockerfile`
- Create: `Exchange_js/client-web/Dockerfile`

- [ ] **Step 1: admin-web/Dockerfile（构建期注入 API 地址）**

```dockerfile
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
# SPA 回退
RUN printf 'server{listen 80;location /{root /usr/share/nginx/html;try_files $uri /index.html;}}' > /etc/nginx/conf.d/default.conf
```

- [ ] **Step 2: client-web/Dockerfile —— 内容同上，仅目录为 client-web**（完整重复，勿写"同上"）

```dockerfile
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
RUN printf 'server{listen 80;location /{root /usr/share/nginx/html;try_files $uri /index.html;}}' > /etc/nginx/conf.d/default.conf
```

- [ ] **Step 3: 验证两前端镜像能构建**

Run: `cd Exchange_js/admin-web && docker build -t exchange-admin . && cd ../client-web && docker build -t exchange-client .`
Expected: 两个都构建成功。

- [ ] **Step 4: Commit**

```bash
git add Exchange_js/admin-web/Dockerfile Exchange_js/client-web/Dockerfile
git commit -m "feat(docker): admin + client static images (nginx)"
```

---

### Task 2.4: docker-compose.yml（编排四服务）

**Files:**
- Create: `Exchange_js/docker-compose.yml`

- [ ] **Step 1: 写 compose**

```yaml
services:
  tigerbeetle:
    image: ghcr.io/tigerbeetle/tigerbeetle:latest
    volumes: [ "tb-data:/data" ]
    entrypoint: ["/bin/sh","-c"]
    command:
      - >
        ([ -f /data/0_0.tigerbeetle ] || tigerbeetle format --cluster=0 --replica=0 --replica-count=1 /data/0_0.tigerbeetle) &&
        tigerbeetle start --addresses=0.0.0.0:3003 /data/0_0.tigerbeetle
    ports: [ "3003:3003" ]

  backend:
    build: .
    depends_on: [ tigerbeetle ]
    environment:
      API_PORT: 3000
      DATABASE_URL: "file:/app/prisma/dev.db"
      TB_ADDRESS: "tigerbeetle:3003"
      ADMIN_URL: "http://localhost:3001"
      CLIENT_URL: "http://localhost:3002"
      SUMSUB_MOCK_MODE: "true"
      GOVERNANCE_DEMO_ENABLED: "true"
    ports: [ "3000:3000" ]

  admin:
    build:
      context: ./admin-web
      args: { VITE_API_URL: "http://localhost:3000" }
    depends_on: [ backend ]
    ports: [ "3001:80" ]

  client:
    build:
      context: ./client-web
      args: { VITE_API_URL: "http://localhost:3000" }
    depends_on: [ backend ]
    ports: [ "3002:80" ]

volumes:
  tb-data:
```
> ⚠️ 执行者核对：TigerBeetle 官方镜像的 entrypoint/命令格式（以其文档为准，可能需 `--development`）；backend 连 `tigerbeetle:3003`（容器网络名）而非 127.0.0.1。

- [ ] **Step 2: 验证四服务起来 + 演示数据在**

Run:
```bash
cd Exchange_js && docker compose up -d --build
sleep 60
curl -sf http://localhost:3000/health && echo BACKEND_OK
curl -sf http://localhost:3001 >/dev/null && echo ADMIN_OK
curl -sf http://localhost:3002 >/dev/null && echo CLIENT_OK
docker compose logs backend | grep -i 'demo' | tail -3
```
Expected: `BACKEND_OK` / `ADMIN_OK` / `CLIENT_OK`；日志见 demo seed 完成。若失败 → 读 `docker compose logs` 逐服务修，回到对应 Task。

- [ ] **Step 3: 关停清理**

Run: `docker compose down`

- [ ] **Step 4: Commit**

```bash
git add Exchange_js/docker-compose.yml
git commit -m "feat(docker): compose orchestrating tigerbeetle+backend+admin+client"
```

---

## Phase 3 — 打包命令 + 对面 README

### Task 3.1: 对面一页说明 `READ-ME-FIRST.md`

**Files:**
- Create: `Exchange_js/READ-ME-FIRST.md`

- [ ] **Step 1: 写对面说明（大白话）**

```markdown
# 跑起来看（3 步）

1. 装 Docker Desktop（Windows 需开 WSL2）：https://www.docker.com/products/docker-desktop/
2. 在本文件夹打开终端，运行：`docker compose up --build`（首次几分钟）
3. 浏览器打开：
   - 管理台 http://localhost:3001
   - 客户端 http://localhost:3002
   - 登录：admin@fiatx.com / 123456

停止：终端按 Ctrl+C，或 `docker compose down`。演示数据（充值/兑换/对账）已预置。
```

- [ ] **Step 2: Commit**

```bash
git add Exchange_js/READ-ME-FIRST.md
git commit -m "docs: recipient run guide"
```

---

### Task 3.2: 升级打包命令（git archive 出干净包 + 双击封装）

**Files:**
- Modify: `Exchange_js/scripts/package-release.sh`
- Create: `打包.command`（仓库根，macOS 双击封装）
- Modify: `Exchange_js/package.json`（`package:release` 已存在，确认指向脚本）

- [ ] **Step 1: 升级 package-release.sh**

保留其 `git archive HEAD` 主干（天然排除 node_modules/.git/worktree/.env → 永不含 settle-opt 副本与真密钥）；产物内包含 Docker 文件（已 tracked 故已在 archive 内）、`READ-ME-FIRST.md`、`.env.example`。移除"构建 prisma/dev.db 塞进包"的旧步骤（改由 Docker 启动 seed），或保留为可选。产物命名 `Exchange-demo-<stamp>.zip`。

- [ ] **Step 2: 写双击封装 `打包.command`**

```bash
#!/usr/bin/env bash
cd "$(dirname "$0")/Exchange_js" && npm run package:release
echo "完成。按回车关闭。"; read -r
```
Run: `chmod +x 打包.command`

- [ ] **Step 3: 验证打包产物干净（关键闭环）**

Run:
```bash
cd Exchange_js && npm run package:release
Z=$(ls -t Exchange-demo-*.zip | head -1)
unzip -l "$Z" | grep -E 'node_modules|\.git/|settle-opt|\.env$' | grep -v '.env.example' | wc -l
unzip -l "$Z" | grep -E 'docker-compose.yml|Dockerfile|READ-ME-FIRST' | wc -l
```
Expected: 第一行 `0`（无密钥/依赖/副本）；第二行 `>=3`（Docker + README 在包内）。

- [ ] **Step 4: 干净环境冒烟（终极验证：解压即跑）**

Run:
```bash
T=$(mktemp -d); unzip -q "$Z" -d "$T"; cd "$T"/*/
docker compose up -d --build && sleep 60
curl -sf http://localhost:3000/health && echo CLEAN_RUN_OK
docker compose down
```
Expected: `CLEAN_RUN_OK`——证明"对面解压 → compose up → 能跑"闭环成立。

- [ ] **Step 5: Commit**

```bash
git add Exchange_js/scripts/package-release.sh 打包.command Exchange_js/package.json
git commit -m "feat(release): 一键出可移植 Docker 交付包（双击/npm）"
```

---

## Self-Review（对照 spec）

- **spec 线 1（清垃圾）** → Task 1.1 / 1.2 ✅（settle-opt 保留 ✅）
- **spec 线 2（去机器化）** → Task 1.3（密钥/DB）/ 1.4（路径）✅
- **spec 线 3（Docker+打包）** → Task 2.1–2.4 / 3.1–3.2 ✅
- **对面体验（compose up）** → Task 2.4 Step2 + 3.2 Step4 冒烟 ✅
- **Scope 守卫（不动 src / settle-opt / 密钥不进包）** → Task 1.1 Step2、3.2 Step3 校验 ✅
- **风险（Docker 前提 / seed 幂等 / TB 镜像格式）** → entrypoint 幂等、compose ⚠️ 核对注记已标 ✅

## 已知需执行者现场核对的点（非占位，是环境依赖）
1. TigerBeetle 官方镜像的确切启动命令（以其 docs 为准）。
2. 后端 `/health` 端点是否存在（无则改就绪探测方式）。
3. `seed.ts` 编译产物路径 / demo:all 在容器内的依赖。
4. Docker 是否在执行环境可用（否则 Phase 2/3 移到有 Docker 的机器验）。
