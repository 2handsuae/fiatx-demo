# 可移植 Docker 交付 — 设计

Date: 2026-07-03 ｜ Status: approved（待执行）

> 目标：把"发给同事、对面上来就能跑"从"发我整台电脑"改成"发一个与我电脑无关、装好 Docker 就能跑的干净包，且由一条命令产出"。

## 0. 背景 / 问题（已验证）

用户当前用 **Finder 手动压缩整个 `重做版/` 文件夹** 发给同事（同事含 **Windows**，用途 = **只要跑起来看**）。实测该文件夹 **1.7 GB**，每次发送都：

| 问题 | 证据 |
|---|---|
| 🔴 泄露真密钥 | 根 `.env` 有 `MINIMAX_API_KEY`（exchange 源码 0 引用，纯残留）、`Exchange_js/.env` 有 `MFA_ENCRYPTION_KEY` |
| 🔴 数据库不在包里 | `.env` 指 `DATABASE_URL=file:/tmp/exchange_js_main/dev.db`（文件夹外，压不进）|
| 🔴 写死本机路径 | `package.json` 10 条脚本 + 10 个 `scripts/*` 硬编码 `/tmp/exchange_js*`；`launch.json` 绝对路径 |
| 🔴 node_modules 平台绑定 | TigerBeetle / Prisma 原生件只有 mac-arm/linux，**无 Windows**；换机即废 |
| 🟡 巨型 + 误发 | node_modules 763M + `.git` 216M + `settle-opt` 工作树 764M（**另一份并行工作，误混入**）|
| 🔴 账本端无 Windows 版 | `tigerbeetle-node/dist/bin` 仅 macos/linux-gnu，Windows 原生跑不了 |

demo 跑在 **mock 模式**（`SUMSUB_MOCK_MODE=true`），**不需要任何真密钥**。

## 1. 目标

一条命令产出一个 **几十 MB 的干净包**：源码 + Docker + 铺好的演示数据 + 一页对面看的说明；**不含**密钥 / node_modules / `.git` / worktree。对面：装一次 Docker Desktop → 解压 → `docker compose up` → 浏览器登录，演示数据就绪。用户以后**发的就是这个产物**，不再发原始文件夹。

## 2. 三条工作线

### 线 1 · 清垃圾（瘦身，本机）
- 删 `.DS_Store`（17）、`prisma/*.bak`（10 个，11M）、`prisma/dev.db` 与 `/tmp` 库的双份僵尸（统一到项目内一份）。
- `launch.json` 删 5 条指向死路径的配置，留现役（并见线 2 路径处理）。
- ⚠️ **`settle-opt` 工作树不动** —— 它是真活，本地保留。只有"它的复制品"才算垃圾（线 3 打包天然不复制它）。

### 线 2 · 拔机器依赖（去机器化，让源码可移植）
- **密钥**：删根 `.env` 的 `MINIMAX_API_KEY`（未使用）；`.env.example` 用 demo 安全默认（MFA 用固定 demo 值，不放真密钥）。规则：真密钥永不进文件夹。
- **写死路径**：`package.json` 10 条脚本 + `scripts/*` 的 `/tmp/exchange_js*` → 改为读环境变量 / 相对项目路径（默认落项目内，不落 `/tmp`）。
- **数据库**：默认路径从 `/tmp/...` 搬回**项目内**（`prisma/dev.db`），恢复"随包带走、开箱即用"原设计；`.env.example` 的 `DATABASE_URL` 指项目内。
- launch.json 的绝对路径问题被"改用 Docker + 不进包"一并消解（launch.json 是本机预览工具配置，不进交付包）。

### 线 3 · Docker 化 + 一条打包命令（交付）
**Docker（新增，纳入 git，故会进包）：**
- `tigerbeetle` 服务：用官方 TigerBeetle 容器镜像（或 linux 二进制），容器内 format + start，数据落 named volume。
- `backend` 服务：`node:20` 多阶段构建 → `npm ci` + `prisma generate` + `build` → 启动时 `prisma migrate deploy` + seed（base + governance demo）→ 跑 NestJS。env 由 compose 注入（端口、`TB_ADDRESS`、`DATABASE_URL`、`SUMSUB_MOCK_MODE=true`、CORS 的 `ADMIN_URL`/`CLIENT_URL`）。
- `admin` / `client` 服务：构建静态产物，nginx（或静态服务）托管；`VITE_API_URL` 构建期指向 compose 内 backend。
- `docker-compose.yml` 编排四服务 + 依赖顺序（tigerbeetle → backend → 前端）+ 端口映射到宿主。
- `.dockerignore` 排除 node_modules/.git/dist 等，保证构建上下文干净。
- **对面 arch 自适应**：镜像在**对面机器**上构建（源码包内），各自出各自 arch 的镜像，用户无需跨芯片构建。

**打包命令（基于现有 `scripts/package-release.sh` 升级）：**
- 用 `git archive HEAD` 取**已提交源码**（→ 天然排除 node_modules/.git/worktree/.env，**永不产生 settle-opt 复制品**）。
- 注入：Docker 文件（已纳入 git 故已在 archive 内）、铺好的演示 DB（可选，Docker 启动也会 seed）、一页 `READ-ME-FIRST` 对面说明。
- 产出 `Exchange-demo-<stamp>.zip`。
- **两种触发**：① Finder 双击的 `打包.command`（macOS 可双击）；② `npm run package:release`。两者调同一脚本。

## 3. 对面体验（"上来就能用"的确切含义）
1. 一次性装 Docker Desktop（Windows 需开 WSL2，可能需管理员权限——账本端无 Windows 版绕不过）。
2. 解压 → `docker compose up`（首次构建几分钟，需联网拉依赖）。
3. 浏览器开 admin / client，演示数据（充值/兑换/对账）已就绪。

## 4. Scope 守卫
- ❌ 不删 `settle-opt`（真活）；打包不复制它。
- ❌ 不改任何业务逻辑 / `src` 功能代码——只动配置、路径、打包、Docker、清垃圾。
- ❌ 真密钥永不进包（git archive + 显式剥离双保险）。
- ⏭️ 前端"开发模式热更 Docker" 不做（用途只需"跑起来看"）。

## 5. 风险 / 已知约束
- **Docker Desktop 前提**：对面必须装；无 Docker 则回退 WSL（更麻烦，本设计不覆盖）。
- **首跑需联网**：容器构建要拉 npm 依赖 + TigerBeetle 镜像。
- **seed 确定性**：Docker 启动 seed 需幂等，避免重复起脏数据。
- **demo DB 双供给**：包内 `prisma/dev.db` 与容器内 seed 二选一为准，避免冲突（实现时定：Docker 路径以容器内 seed 为准）。

## 6. 执行阶段（writing-plans 细化）
- **Phase 1**：线 1 清垃圾 + 线 2 去机器化（密钥、路径、DB 位置）——纯配置/清理，可独立验证。
- **Phase 2**：线 3 Docker 化（Dockerfile ×3 + compose + .dockerignore），`docker compose up` 本机验证四服务起、演示数据在。
- **Phase 3**：升级打包命令（双击 + npm）+ 对面 README，产出 zip 并**在干净环境（或删掉 node_modules 后）验证 `docker compose up` 真能起**。
