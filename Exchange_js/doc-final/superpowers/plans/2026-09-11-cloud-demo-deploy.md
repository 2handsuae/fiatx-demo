# 演示环境上云 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 业主在 Mac 上跑一条命令，就把演示系统部署到腾讯云新加坡服务器（101.32.141.97）。服务器每次启动都自动铺满演示数据并自动验收，迪拜同事用浏览器直接打开。

**Architecture:** 服务器不用 Docker，直接跑：systemd 管两个服务。一个是「演示服务」`exchange-demo`，把 TigerBeetle 和 `node dist/main` 放在一起跑，每次启动都从零铺数据；另一个是 `caddy`，负责三件事：IP 地址 HTTPS 证书、托管两个前端的静态文件、把 `/api` 请求反代给后端。构建在 Mac 上做，输出到临时目录，再用 rsync 只传运行需要的文件。

**Tech Stack:** Bash（Mac 端 3.2 / 服务器 5.x）、systemd、Caddy v2.11.4、TigerBeetle 0.17.3、Node v20.20.2、rsync/ssh；业务栈沿用 NestJS + Prisma + SQLite，不改。

**Spec:** `doc-final/superpowers/specs/2026-09-11-cloud-demo-deploy-design.md`

## Global Constraints

- 通用交付清单见 rules/delivery-checklist.md，全部适用
- 本轮特有：
  - 服务器：`ubuntu@101.32.141.97`，密钥 `~/.ssh/exchange_demo_ed25519`。只用密钥登录，不用、也不索要任何密码。sudo 免密。
  - 版本钉死：Node **v20.20.2**（与本机 nvm 一致）、TigerBeetle **0.17.3**（与 `tigerbeetle-node` 一致）、Caddy **v2.11.4**（2026-09-11 已实测能签 IP 证书）
  - 不用 Docker；不改业务代码，唯一例外是 `demo-lib` 的 data.md 写入（Task 1）
  - 本机构建输出一律进 `mktemp -d` 临时目录，**不碰 `Exchange_js/dist/`**（main 栈 `stack-up.sh` 直接跑它）
  - 服务器目录：`/opt/exchange-demo/{app,web/admin,web/client,deploy,data,run}`；演示服务工作目录 = `/opt/exchange-demo/app`（`material-policy.ts` 按 `process.cwd()` 读 `config/`）
  - 端口：443 管理台、8443 客户端、80 跳转；API 3000 与账本 3003 只供本机访问
  - Mac 端脚本必须兼容 **bash 3.2**（不用 `wait -n` / `mapfile` / `${x,,}`）；服务器端脚本可用 bash 5
  - **绝不删 `/var/lib/caddy`**（Caddy 的证书存储）：重复签发会撞 Let's Encrypt 的频率上限
  - 子代理模型：执行与逐任务评审用 `sonnet`；终审与变异测试省略 model、走继承（主会话 Opus 5；按项目规定，Fable 5 不在时降 opus）
  - 禁做清单（CLAUDE.md §2）照旧

## 本任务做 / 不做

- **做**：上云运行形态（systemd + Caddy）、开服 / 部署 / 重铺三条命令与双击入口、§5 自动验收（含变异测试）、data.md 写入改为缺文件跳过、退役 zip 交付与全部 Docker 文件、文档收口
- **不做**（对照 CLAUDE.md §2 与 spec §8）：Docker、门锁 / 访问控制、数据保留与迁移兼容、定时重铺、多实例、镜像瘦身、构建提速、Node 升级、域名 / CDN / 监控 / CI

## 本任务过交付清单哪几条（delivery-checklist）

| 触发 | 本任务落在 |
|---|---|
| 改了前端（构建配置 `VITE_API_URL=/api`，页面由 Caddy 托管） | Task 6 浏览器截图 |
| 改页面或种子 → 同步 `demo/script.md` | Task 6（环境行补云端入口） |
| 每轮收尾 → 文档分层收口 + CHANGELOG + BACKLOG 销账 | Task 6（本任务无 BACKLOG 条目；销的是 TOOLING-DEBT 一行） |
| 动了钱 → `verify:coa` | 不触发（本任务不动钱）；但云端验收每次都跑 `verify:coa` |

## File Structure

| 文件 | 职责 |
|---|---|
| Create `Exchange_js/scripts/demo-data-md.ts` | data.md 生成区写入（从 demo-lib 拆出，无重依赖、可单测；缺文件跳过） |
| Create `Exchange_js/scripts/demo-data-md.spec.ts` | 上面那个的行为测试 |
| Modify `Exchange_js/scripts/demo-lib.ts` | 改为 import `writeDataMdSnapshot` |
| Create `Exchange_js/scripts/cloud-env.sh` | Mac 端公共：读 `.cloud.env`、`cloud_ssh` / `cloud_rsync` |
| Create `Exchange_js/scripts/cloud-bootstrap.sh` | 开服（一次性）入口 |
| Create `Exchange_js/scripts/cloud-deploy.sh` | 部署入口 |
| Create `Exchange_js/scripts/cloud-verify.sh` | 等 READY + §5 验收 |
| Create `Exchange_js/scripts/cloud-reset.sh` | 重铺入口 |
| Create `Exchange_js/deploy/remote-bootstrap.sh` | 服务器：装 Node / TB / Caddy、建用户与目录 |
| Create `Exchange_js/deploy/remote-apply.sh` | 服务器：依赖、配置、服务单元、重启（每次部署跑） |
| Create `Exchange_js/deploy/demo-run.sh` | 服务器：演示服务启动序列（spec §3） |
| Create `Exchange_js/deploy/exchange-demo.service` | systemd 单元：演示服务 |
| Create `Exchange_js/deploy/caddy.service` | systemd 单元：Caddy（官方单元，路径改 /usr/local/bin） |
| Create `Exchange_js/deploy/Caddyfile.template` | Caddy 配置（`__HOST__` 占位） |
| Create `Exchange_js/deploy/demo.env.template` | 演示服务环境变量（`__HOST__` 占位） |
| Create `Exchange_js/deploy/colleague-message.txt` | 部署完打印的「转发给同事」段 |
| Create `Exchange_js/.cloud.env.example` | `.cloud.env` 样例（入库） |
| Create `部署.command`、`重铺数据.command`（仓库根） | 双击入口 |
| Modify `Exchange_js/package.json` | 删 `package:release`，加 `cloud:bootstrap` / `cloud:deploy` / `cloud:reset` |
| Modify `Exchange_js/.gitignore` | 加 `.cloud.env` |
| Modify `Exchange_js/.env.example:48` | 去掉对 `SETUP.md` 的引用 |
| Modify `CLAUDE.md` §10、`doc-final/CHANGELOG.md`、`doc-final/TOOLING-DEBT.md:73`、`doc-final/demo/script.md:7` | 文档收口 |
| Delete（spec §7） | 打包入口、启动器、READ-ME-FIRST、SETUP、全部 Docker 文件、两份 `.gitattributes` |

---

### Task 0: 开 worktree，把 spec 与 plan 入库

**Files:**
- Move: `Exchange_js/doc-final/superpowers/specs/2026-09-11-cloud-demo-deploy-design.md`、`Exchange_js/doc-final/superpowers/plans/2026-09-11-cloud-demo-deploy.md`（主工作树里未跟踪 → 搬进 worktree）

**Interfaces:**
- Produces：worktree `.claude/worktrees/cloud-deploy`（分支 `feat/cloud-demo-deploy`），后续所有任务都在里面做；self 栈已起（Task 6 的闸⑥要用）

- [ ] **Step 1: 按 superpowers:using-git-worktrees 建 worktree**

项目规定位置是 `.claude/worktrees/<名>/`（CLAUDE.md §10）。在仓库根执行：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版
git check-ignore -q .claude/worktrees/probe && echo "worktrees ignored: OK" || echo "NOT IGNORED — stop and report"
git worktree add -b feat/cloud-demo-deploy .claude/worktrees/cloud-deploy main
```

Expected: `worktrees ignored: OK`，随后 `Preparing worktree (new branch 'feat/cloud-demo-deploy')`。

- [ ] **Step 2: 把两份文档从主工作树搬进 worktree 并提交**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版
W=.claude/worktrees/cloud-deploy
mv Exchange_js/doc-final/superpowers/specs/2026-09-11-cloud-demo-deploy-design.md "$W/Exchange_js/doc-final/superpowers/specs/"
mv Exchange_js/doc-final/superpowers/plans/2026-09-11-cloud-demo-deploy.md "$W/Exchange_js/doc-final/superpowers/plans/"
cd "$W"
git add Exchange_js/doc-final/superpowers/specs/2026-09-11-cloud-demo-deploy-design.md Exchange_js/doc-final/superpowers/plans/2026-09-11-cloud-demo-deploy.md
git commit -m "docs(上云): 演示环境上云 spec + plan——新加坡轻量服务器·直接部署·一条命令部署与自动验收"
```

Expected：提交成功，只含这 2 个文件。主工作树里业主未提交的 `READ-ME-FIRST.md` / `start-demo.*` / lark 文档**原样不动**。

此后本计划的路径是 worktree 内的 `.claude/worktrees/cloud-deploy/Exchange_js/doc-final/superpowers/plans/2026-09-11-cloud-demo-deploy.md`，子代理与勾选进度都以它为准。

- [ ] **Step 3: 起 self 栈（顺带装好三处 node_modules）**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.claude/worktrees/cloud-deploy/Exchange_js
bash scripts/stack.sh up
bash scripts/stack.sh status
```

Expected：`status` 显示 self 栈四个端口都在跑；`ls node_modules admin-web/node_modules client-web/node_modules >/dev/null && echo deps-ok` 输出 `deps-ok`。

---

### Task 1: data.md 找不到就跳过（TDD）

**Files:**
- Create: `Exchange_js/scripts/demo-data-md.ts`
- Create: `Exchange_js/scripts/demo-data-md.spec.ts`
- Modify: `Exchange_js/scripts/demo-lib.ts`（约 1190–1198 行的常量块、约 1241–1253 行的函数；约 66 行附近加 import）

**Interfaces:**
- Produces：`writeDataMdSnapshot(body: string, mdPath?: string): 'written' | 'skipped-missing' | 'skipped-no-markers'`；另导出 `DATA_MD_PATH`、`GENERATED_BEGIN`、`GENERATED_END`
- Consumes：无。demo-lib 的调用点 `writeDataMdSnapshot(renderDataMdSnapshot(rosterResults, coaRows));`（约 1314 行）保持不变，返回值不用

- [ ] **Step 1: 写失败测试** —— `Exchange_js/scripts/demo-data-md.spec.ts`

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GENERATED_BEGIN, GENERATED_END, writeDataMdSnapshot } from './demo-data-md';

describe('writeDataMdSnapshot', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-md-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('data.md 不存在时跳过、不抛错、不创建文件（云端服务器不带 doc-final）', () => {
    const missing = path.join(dir, 'doc-final', 'demo', 'data.md');
    expect(writeDataMdSnapshot('body', missing)).toBe('skipped-missing');
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('只替换 GENERATED 标记之间的内容', () => {
    const md = path.join(dir, 'data.md');
    fs.writeFileSync(md, `head\n${GENERATED_BEGIN}\nold\n${GENERATED_END}\ntail\n`, 'utf8');
    expect(writeDataMdSnapshot('NEW', md)).toBe('written');
    expect(fs.readFileSync(md, 'utf8')).toBe(`head\n${GENERATED_BEGIN}\nNEW\n${GENERATED_END}\ntail\n`);
  });

  it('缺标记时原样保留文件', () => {
    const md = path.join(dir, 'data.md');
    fs.writeFileSync(md, 'hand-written only\n', 'utf8');
    expect(writeDataMdSnapshot('NEW', md)).toBe('skipped-no-markers');
    expect(fs.readFileSync(md, 'utf8')).toBe('hand-written only\n');
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run（在 worktree 的 `Exchange_js/` 下；jest 只能在这里跑）：`npx jest scripts/demo-data-md.spec.ts`
Expected: FAIL，`Cannot find module './demo-data-md'`

- [ ] **Step 3: 写实现** —— `Exchange_js/scripts/demo-data-md.ts`

```ts
// scripts/demo-data-md.ts — data.md 生成区写入（demo:all 收尾调用）。
// doc-final/demo/data.md:3 声明它的生成区由 demo:all 写入；这里只动 GENERATED 标记之间的文字，
// 其余是手写内容、原样保留。标记缺失（有人手改删掉了）时不写，免得把文件写坏——
// data.md 自己的 git 历史才是恢复手段。
// 从 demo-lib.ts 拆出来的原因：demo-lib 一被 import 就跑 requireStackEnv，单测没法加载它。
// 云端服务器不带 doc-final（spec 2026-09-11 §8）：文件不存在时打印一行并跳过，不让 demo:all 收尾崩。
import * as fs from 'fs';
import * as path from 'path';

export const DATA_MD_PATH = path.resolve(__dirname, '../doc-final/demo/data.md');
export const GENERATED_BEGIN = '<!-- GENERATED:BEGIN -->';
export const GENERATED_END = '<!-- GENERATED:END -->';

export type DataMdWriteResult = 'written' | 'skipped-missing' | 'skipped-no-markers';

export function writeDataMdSnapshot(body: string, mdPath: string = DATA_MD_PATH): DataMdWriteResult {
  if (!fs.existsSync(mdPath)) {
    console.log(`  ⤷ 没有 data.md（${mdPath}）——云端部署不带 doc-final，跳过生成区写入`);
    return 'skipped-missing';
  }
  const original = fs.readFileSync(mdPath, 'utf8');
  const beginIdx = original.indexOf(GENERATED_BEGIN);
  const endIdx = original.indexOf(GENERATED_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    console.warn(`  ⚠ data.md 缺 GENERATED 标记，跳过生成区写入（${mdPath}）`);
    return 'skipped-no-markers';
  }
  const before = original.slice(0, beginIdx + GENERATED_BEGIN.length);
  const after = original.slice(endIdx);
  fs.writeFileSync(mdPath, `${before}\n${body}\n${after}`, 'utf8');
  console.log(`  ✓ data.md 生成区已更新`);
  return 'written';
}
```

- [ ] **Step 4: 跑测试，确认通过**

Run: `npx jest scripts/demo-data-md.spec.ts`
Expected: PASS，`Tests: 3 passed`

- [ ] **Step 5: demo-lib 改用新模块**

在 `Exchange_js/scripts/demo-lib.ts` 里做三处 Edit。

(a) 在 `import { loginAsMlro, loginAsSmo, loginAsCfo, approveApproval } from './demo-mlro';` 这一行下面加：

```ts
import { writeDataMdSnapshot } from './demo-data-md';
```

(b) 把这 9 行（原常量块）：

```ts
// doc-final/demo/data.md:3 declares this file's generated section is written
// by demo:all — this is that write. Only the text between the GENERATED
// markers is touched; everything else in data.md is hand-maintained and left
// alone. If the markers are missing (someone hand-edited them out), skip
// silently rather than corrupting the file — data.md's own git history is
// the recovery path, not this script.
const DATA_MD_PATH = path.resolve(__dirname, '../doc-final/demo/data.md');
const GENERATED_BEGIN = '<!-- GENERATED:BEGIN -->';
const GENERATED_END = '<!-- GENERATED:END -->';
```

替换为：

```ts
// doc-final/demo/data.md:3 declares this file's generated section is written
// by demo:all — renderDataMdSnapshot builds the body; ./demo-data-md writes it
// (split out so it can be unit-tested — this file runs requireStackEnv on import).
```

(c) 删掉整个旧函数（13 行）：

```ts
function writeDataMdSnapshot(body: string): void {
  const original = fs.readFileSync(DATA_MD_PATH, 'utf8');
  const beginIdx = original.indexOf(GENERATED_BEGIN);
  const endIdx = original.indexOf(GENERATED_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    console.warn(`  ⚠ data.md 缺 GENERATED 标记，跳过生成区写入（${DATA_MD_PATH}）`);
    return;
  }
  const before = original.slice(0, beginIdx + GENERATED_BEGIN.length);
  const after = original.slice(endIdx);
  fs.writeFileSync(DATA_MD_PATH, `${before}\n${body}\n${after}`, 'utf8');
  console.log(`  ✓ data.md 生成区已更新`);
}
```

然后确认 demo-lib 里旧名字全清了：

Run: `grep -nE "DATA_MD_PATH|GENERATED_BEGIN|GENERATED_END|writeDataMdSnapshot" scripts/demo-lib.ts`
Expected：只剩 import 那一行和约 1314 行的调用点，共 2 行。

- [ ] **Step 6: 闸①（后端 tsc，覆盖 src / test / scripts / prisma）**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected：无输出，退出码 0。

- [ ] **Step 7: 提交**

```bash
git add scripts/demo-data-md.ts scripts/demo-data-md.spec.ts scripts/demo-lib.ts
git commit -m "fix(演示装备): data.md 生成区写入拆出独立模块——文件不存在时跳过，云端不带 doc-final 也不崩"
```

---

### Task 2: 开服——服务器装好 Node / TigerBeetle / Caddy

**Files:**
- Create: `Exchange_js/scripts/cloud-env.sh`
- Create: `Exchange_js/scripts/cloud-bootstrap.sh`
- Create: `Exchange_js/deploy/remote-bootstrap.sh`
- Create: `Exchange_js/.cloud.env.example`
- Modify: `Exchange_js/.gitignore`（末尾加一行）
- Modify: `Exchange_js/package.json`（scripts 加 `cloud:bootstrap`）

**Interfaces:**
- Produces（Task 3/4 依赖）：`cloud-env.sh` 提供 `CLOUD_HOST` `CLOUD_USER` `CLOUD_KEY` `CLOUD_APP_DIR` `CLOUD_ROOT=/opt/exchange-demo` `CLOUD_ADMIN_URL` `CLOUD_CLIENT_URL` `CLOUD_SSH_OPTS`，以及函数 `cloud_ssh <cmd...>`、`cloud_rsync <rsync args...>`；服务器上有 `/opt/node20/bin/node`（v20.20.2）、`/usr/local/bin/tigerbeetle`（0.17.3）、`/usr/local/bin/caddy`（v2.11.4）、系统用户 `caddy`，以及归 ubuntu 所有的 `/opt/exchange-demo/{app,web/admin,web/client,deploy,data,run}`

- [ ] **Step 1: `Exchange_js/scripts/cloud-env.sh`**

```bash
#!/usr/bin/env bash
# scripts/cloud-env.sh — 云端演示环境公共设置（被 scripts/cloud-*.sh source）。兼容 bash 3.2。
# 读 Exchange_js/.cloud.env（本机、未入库）：CLOUD_HOST / CLOUD_USER / CLOUD_KEY。
set -euo pipefail

CLOUD_APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # = Exchange_js/
CLOUD_ENV_FILE="${CLOUD_APP_DIR}/.cloud.env"
if [[ ! -f "${CLOUD_ENV_FILE}" ]]; then
  echo "✖ 缺 ${CLOUD_ENV_FILE}：照 .cloud.env.example 复制一份（CLOUD_HOST / CLOUD_USER / CLOUD_KEY）" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "${CLOUD_ENV_FILE}"
: "${CLOUD_HOST:?CLOUD_HOST 未设}"
: "${CLOUD_USER:?CLOUD_USER 未设}"
: "${CLOUD_KEY:?CLOUD_KEY 未设}"
CLOUD_KEY="${CLOUD_KEY/#\~/$HOME}"

CLOUD_ROOT=/opt/exchange-demo
CLOUD_ADMIN_URL="https://${CLOUD_HOST}"
CLOUD_CLIENT_URL="https://${CLOUD_HOST}:8443"
CLOUD_SSH_OPTS=(-i "${CLOUD_KEY}" -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new)

cloud_ssh() { ssh "${CLOUD_SSH_OPTS[@]}" "${CLOUD_USER}@${CLOUD_HOST}" "$@"; }
cloud_rsync() { rsync -az --delete -e "ssh ${CLOUD_SSH_OPTS[*]}" "$@"; }
```

- [ ] **Step 2: `Exchange_js/.cloud.env.example`，并在本机复制出 `.cloud.env`**

```bash
# 复制为 .cloud.env（本机、未入库）；三项都按实际填写
CLOUD_HOST=101.32.141.97
CLOUD_USER=ubuntu
CLOUD_KEY=~/.ssh/exchange_demo_ed25519
```

在 `Exchange_js/.gitignore` 末尾追加一行：

```
.cloud.env
```

Run: `cp .cloud.env.example .cloud.env && git check-ignore -q .cloud.env && echo ignored-ok`
Expected：`ignored-ok`

- [ ] **Step 3: `Exchange_js/deploy/remote-bootstrap.sh`（服务器上执行）**

```bash
#!/usr/bin/env bash
# deploy/remote-bootstrap.sh — 服务器一次性安装（由 scripts/cloud-bootstrap.sh 经 ssh 'bash -s' 执行）。
# 装 Node / TigerBeetle / Caddy（版本钉死）+ caddy 用户 + 目录。重装系统后原样重跑即可恢复。
# 服务单元与 Caddyfile 不在这里装：由每次部署的 deploy/remote-apply.sh 装（配置只有一个出口）。
set -euo pipefail
NODE_VERSION=v20.20.2
TB_VERSION=0.17.3
CADDY_VERSION=2.11.4
ROOT=/opt/exchange-demo

for t in curl unzip tar xz rsync sha256sum; do
  command -v "$t" >/dev/null || { echo "✖ 服务器缺 $t" >&2; exit 1; }
done

echo "[bootstrap] 1/5 内核：io_uring 必须可用（TigerBeetle 没有替代路径）"
if [[ "$(cat /proc/sys/kernel/io_uring_disabled 2>/dev/null || echo 0)" != "0" ]]; then
  echo 'kernel.io_uring_disabled = 0' | sudo tee /etc/sysctl.d/60-io-uring.conf >/dev/null
  sudo sysctl -p /etc/sysctl.d/60-io-uring.conf
fi
echo "  io_uring_disabled=$(cat /proc/sys/kernel/io_uring_disabled)"

echo "[bootstrap] 2/5 Node ${NODE_VERSION}"
if [[ "$(/opt/node20/bin/node -v 2>/dev/null || true)" != "${NODE_VERSION}" ]]; then
  curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz" | sudo tar -xJ -C /opt
  sudo ln -sfn "/opt/node-${NODE_VERSION}-linux-x64" /opt/node20
fi
echo "  node $(/opt/node20/bin/node -v)"

echo "[bootstrap] 3/5 TigerBeetle ${TB_VERSION}"
if [[ "$(tigerbeetle version 2>/dev/null | head -1 || true)" != *"${TB_VERSION}"* ]]; then
  tmp="$(mktemp -d)"
  curl -fsSL -o "${tmp}/tb.zip" "https://github.com/tigerbeetle/tigerbeetle/releases/download/${TB_VERSION}/tigerbeetle-x86_64-linux.zip"
  unzip -q -o "${tmp}/tb.zip" -d "${tmp}"
  sudo install -m 0755 "${tmp}/tigerbeetle" /usr/local/bin/tigerbeetle
  rm -rf "${tmp}"
fi
echo "  $(tigerbeetle version | head -1)"

echo "[bootstrap] 4/5 Caddy ${CADDY_VERSION}"
if [[ "$(caddy version 2>/dev/null || true)" != "v${CADDY_VERSION}"* ]]; then
  tmp="$(mktemp -d)"
  curl -fsSL -o "${tmp}/caddy.tgz" "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.tar.gz"
  tar -xzf "${tmp}/caddy.tgz" -C "${tmp}" caddy
  sudo install -m 0755 "${tmp}/caddy" /usr/local/bin/caddy
  rm -rf "${tmp}"
fi
id caddy >/dev/null 2>&1 || sudo useradd --system --home /var/lib/caddy --create-home --shell /usr/sbin/nologin caddy
echo "  caddy $(caddy version | cut -d' ' -f1)"

echo "[bootstrap] 5/5 目录（归 ubuntu；caddy 用户只读 web/）"
sudo mkdir -p "${ROOT}"/app "${ROOT}"/web/admin "${ROOT}"/web/client "${ROOT}"/deploy "${ROOT}"/data "${ROOT}"/run /etc/caddy
sudo chown -R ubuntu:ubuntu "${ROOT}"
sudo chmod 755 "${ROOT}" "${ROOT}/web"
echo "[bootstrap] ✅ 完成"
```

- [ ] **Step 4: `Exchange_js/scripts/cloud-bootstrap.sh`**

```bash
#!/usr/bin/env bash
# scripts/cloud-bootstrap.sh — 开服（一次性；重装系统后重跑）：服务器装好 Node / TigerBeetle / Caddy，然后首次部署。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/cloud-env.sh"
echo "[bootstrap] → ${CLOUD_USER}@${CLOUD_HOST}"
cloud_ssh 'bash -s' < "${CLOUD_APP_DIR}/deploy/remote-bootstrap.sh"
echo "[bootstrap] 服务器装好了 → 首次部署"
exec bash "${SCRIPT_DIR}/cloud-deploy.sh"
```

在 `Exchange_js/package.json` 的 `scripts` 里、`"package:release"` 那行上方加一行（`package:release` 本身留给 Task 5 删）：

```json
    "cloud:bootstrap": "bash scripts/cloud-bootstrap.sh",
```

- [ ] **Step 5: 语法检查 + 只跑服务器那一半（`cloud-deploy.sh` 要到 Task 3 才有）**

```bash
chmod +x scripts/cloud-env.sh scripts/cloud-bootstrap.sh deploy/remote-bootstrap.sh
bash -n scripts/cloud-env.sh && bash -n scripts/cloud-bootstrap.sh && echo mac-syntax-ok
ssh -i ~/.ssh/exchange_demo_ed25519 -o BatchMode=yes ubuntu@101.32.141.97 'bash -n' < deploy/remote-bootstrap.sh && echo server-syntax-ok
bash -c 'source scripts/cloud-env.sh && cloud_ssh "bash -s" < deploy/remote-bootstrap.sh'
```

Expected：`mac-syntax-ok`、`server-syntax-ok`；bootstrap 输出以 `[bootstrap] ✅ 完成` 结束，并打印 `io_uring_disabled=0`、`node v20.20.2`、`TigerBeetle version 0.17.3…`、`caddy v2.11.4`。

- [ ] **Step 6: 实证服务器状态**

```bash
bash -c 'source scripts/cloud-env.sh && cloud_ssh "/opt/node20/bin/node -v; tigerbeetle version | head -1; caddy version; id caddy; stat -c \"%U %a %n\" /opt/exchange-demo /opt/exchange-demo/web /opt/exchange-demo/app"'
```

Expected：`v20.20.2`、`TigerBeetle version 0.17.3+…`、`v2.11.4 …`、`uid=…(caddy)`；三个目录都是 `ubuntu`，前两个权限 `755`。

- [ ] **Step 7: 提交**

```bash
git add scripts/cloud-env.sh scripts/cloud-bootstrap.sh deploy/remote-bootstrap.sh .cloud.env.example .gitignore package.json
git commit -m "feat(上云): 开服脚本——服务器装钉死版本的 Node/TigerBeetle/Caddy + 目录"
```

---

### Task 3: 演示服务 + 一条命令部署 + 自动验收

**Files:**
- Create: `Exchange_js/deploy/demo-run.sh`
- Create: `Exchange_js/deploy/exchange-demo.service`
- Create: `Exchange_js/deploy/caddy.service`
- Create: `Exchange_js/deploy/Caddyfile.template`
- Create: `Exchange_js/deploy/demo.env.template`
- Create: `Exchange_js/deploy/remote-apply.sh`
- Create: `Exchange_js/deploy/colleague-message.txt`
- Create: `Exchange_js/scripts/cloud-verify.sh`
- Create: `Exchange_js/scripts/cloud-deploy.sh`
- Modify: `Exchange_js/package.json`（加 `cloud:deploy`）

**Interfaces:**
- Consumes：Task 2 的 `cloud-env.sh` 全部名字；`scripts/node-env.sh` 的 `ensure_node20`
- Produces（Task 4 依赖）：服务器状态文件 `/opt/exchange-demo/run/status`（`STARTING…` / `READY` / `FAILED:<步骤>`）、日志 `/opt/exchange-demo/run/boot.log`、版本文件 `/opt/exchange-demo/app/DEPLOYED_VERSION`、systemd 服务名 `exchange-demo` 与 `caddy`；`scripts/cloud-verify.sh`（退出码 0 = 全绿），**调用前必须先 `rm -f /opt/exchange-demo/run/status`**，否则会读到上一轮留下的 READY、造成假绿

- [ ] **Step 1: `Exchange_js/deploy/demo-run.sh`（spec §3）**

```bash
#!/usr/bin/env bash
# deploy/demo-run.sh — 演示服务启动序列（exchange-demo.service 的 ExecStart；spec 2026-09-11 §3）
# 每次启动：清空 → 账本 → 建表 → 底座 → 业务数据 → 接口 → demo:all → recon:demo:break → READY
# 状态写 run/status（STARTING… / READY / FAILED:<步骤>），全量输出同时进 journal 与 run/boot.log。
set -uo pipefail

ROOT=/opt/exchange-demo
DATA="${ROOT}/data"
RUN="${ROOT}/run"
STATUS="${RUN}/status"
LOG="${RUN}/boot.log"
mkdir -p "${RUN}"
exec > >(tee "${LOG}") 2>&1

TB_PID=""
API_PID=""
say() { echo "[demo-run $(date +%H:%M:%S)] $*"; }
mark() { echo "$1" > "${STATUS}"; }
hold_failed() {
  # 失败：标记后原地停住——API 若已起就继续服务、便于排查；不退出，免得 systemd 反复重启重铺
  say "✖ FAILED @ $1"
  mark "FAILED:$1"
  sleep infinity
}
wait_port() {   # $1=端口 $2=超时秒
  local i
  for ((i = 0; i < $2; i++)); do
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0
    sleep 1
  done
  return 1
}
run_step() {    # $1=步骤名，其余=命令
  local name="$1"
  shift
  mark "STARTING:${name}"
  say "▶ ${name}"
  "$@" || hold_failed "${name}"
}

mark "STARTING"
say "清空数据目录 ${DATA}（每次启动都从零来）"
rm -rf "${DATA}" && mkdir -p "${DATA}"

run_step "1 格式化账本" tigerbeetle format --development --cluster=0 --replica=0 --replica-count=1 "${DATA}/0_0.tigerbeetle"

mark "STARTING:2 启动账本"
say "▶ 2 启动账本"
tigerbeetle start --development --addresses=127.0.0.1:3003 "${DATA}/0_0.tigerbeetle" &
TB_PID=$!
wait_port 3003 60 || hold_failed "2 启动账本"

run_step "3 建表" npx prisma migrate deploy --schema ./prisma/schema.prisma
run_step "4 铺底座" npm run db:base:sync
run_step "5 铺业务数据" npm run db:seed:business

mark "STARTING:6 起接口"
say "▶ 6 起接口"
node dist/main &
API_PID=$!
wait_port "${API_PORT:-3000}" 120 || hold_failed "6 起接口"

run_step "7 demo:all" npm run demo:all
run_step "8 recon:demo:break" npm run recon:demo:break

mark "READY"
say "✅ READY  管理台 ${ADMIN_URL}  客户端 ${CLIENT_URL}"

# 守护：账本或接口任一退出 → 本服务非 0 退出，systemd 重启 = 重新从零来
wait -n "${TB_PID}" "${API_PID}"
say "✖ 账本或接口进程退出，服务退出（systemd 将重启并重铺）"
exit 1
```

- [ ] **Step 2: 两个 systemd 单元**

`Exchange_js/deploy/exchange-demo.service`：

```ini
# deploy/exchange-demo.service — 演示服务：TigerBeetle + API，每次启动从零铺数据（spec 2026-09-11 §3）
[Unit]
Description=Exchange demo (TigerBeetle + API, fresh data on every start)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/exchange-demo/app
EnvironmentFile=/opt/exchange-demo/demo.env
Environment=PATH=/opt/node20/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/opt/exchange-demo/deploy/demo-run.sh
Restart=on-failure
RestartSec=5
# TigerBeetle 官方 systemd 部署文档：io_uring 初始化需要锁内存（服务器默认只给 8 MB）
LimitMEMLOCK=infinity
KillMode=control-group
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
```

`Exchange_js/deploy/caddy.service`（官方单元原样，只把两处路径改成 `/usr/local/bin/caddy`）：

```ini
# deploy/caddy.service — 来源 caddyserver/dist init/caddy.service；仅 ExecStart / ExecReload 改为 /usr/local/bin/caddy
[Unit]
Description=Caddy
Documentation=https://caddyserver.com/docs/
After=network.target network-online.target
Requires=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
PrivateTmp=true
ProtectSystem=full
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: `Exchange_js/deploy/Caddyfile.template`**

```
# deploy/Caddyfile.template — remote-apply.sh 把 __HOST__ 换成公网 IP 后装到 /etc/caddy/Caddyfile
# IP 证书：Let's Encrypt shortlived（6 天）档，Caddy 自动续期（2026-09-11 staging 实测 v2.11.4 可签）
# acme_ca 只指 Let's Encrypt 一家：profile 要求所有 CA 都支持它
{
	acme_ca https://acme-v02.api.letsencrypt.org/directory
	default_sni __HOST__
}

(ip_cert) {
	tls {
		issuer acme {
			profile shortlived
		}
	}
}

(api_proxy) {
	handle_path /api/* {
		reverse_proxy 127.0.0.1:3000
	}
}

# 管理台
https://__HOST__ {
	import ip_cert
	import api_proxy
	handle {
		root * /opt/exchange-demo/web/admin
		try_files {path} /index.html
		file_server
	}
}

# 客户端
https://__HOST__:8443 {
	import ip_cert
	import api_proxy
	handle {
		root * /opt/exchange-demo/web/client
		try_files {path} /index.html
		file_server
	}
}
```

- [ ] **Step 4: `Exchange_js/deploy/demo.env.template`**

```bash
# deploy/demo.env.template — remote-apply.sh 把 __HOST__ 换成公网 IP 后写到 /opt/exchange-demo/demo.env
# 同时被 systemd（EnvironmentFile）与 bash（cloud-verify 里 source 它跑 verify:coa）读取：含空格的值必须加引号
NODE_ENV=production
API_PORT=3000
DATABASE_URL=file:/opt/exchange-demo/data/dev.db
TB_ADDRESS=127.0.0.1:3003
RECON_DEMO_MANIFEST_PATH=/opt/exchange-demo/data/recon-demo-manifest.json
ADMIN_URL=https://__HOST__
CLIENT_URL=https://__HOST__:8443
SUMSUB_MOCK_MODE=true
GOVERNANCE_DEMO_ENABLED=true
MFA_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
MFA_ISSUER="Exchange Admin (Demo)"
```

- [ ] **Step 5: `Exchange_js/deploy/remote-apply.sh`（服务器上执行，每次部署跑）**

```bash
#!/usr/bin/env bash
# deploy/remote-apply.sh — 每次部署在服务器上跑（由 scripts/cloud-deploy.sh 经 ssh 调用）
# 依赖清单变了才 npm ci → prisma generate → 渲染配置、装服务单元 → 启 / 重载 Caddy → 重启演示服务（= 新数据）
set -euo pipefail
HOST="${1:?用法: remote-apply.sh <公网IP>}"
ROOT=/opt/exchange-demo
APP="${ROOT}/app"
export PATH=/opt/node20/bin:/usr/local/bin:/usr/bin:/bin

cd "${APP}"
LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [[ ! -f node_modules/.lock-hash ]] || [[ "$(cat node_modules/.lock-hash)" != "${LOCK_HASH}" ]]; then
  echo "[apply] 依赖清单有变 → npm ci"
  npm ci --no-audit --no-fund
  echo "${LOCK_HASH}" > node_modules/.lock-hash
else
  echo "[apply] 依赖清单未变 → 跳过 npm ci"
fi
echo "[apply] prisma generate"
npx prisma generate --schema ./prisma/schema.prisma >/dev/null

echo "[apply] 渲染配置 + 装服务单元"
sed "s/__HOST__/${HOST}/g" "${ROOT}/deploy/demo.env.template" > "${ROOT}/demo.env"
sed "s/__HOST__/${HOST}/g" "${ROOT}/deploy/Caddyfile.template" | sudo tee /etc/caddy/Caddyfile.new >/dev/null
sudo -u caddy /usr/local/bin/caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile >/dev/null
sudo mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile
sudo install -m 0644 "${ROOT}/deploy/exchange-demo.service" /etc/systemd/system/exchange-demo.service
sudo install -m 0644 "${ROOT}/deploy/caddy.service" /etc/systemd/system/caddy.service
sudo systemctl daemon-reload
sudo systemctl enable --quiet caddy exchange-demo
if systemctl is-active --quiet caddy; then sudo systemctl reload caddy; else sudo systemctl start caddy; fi

echo "[apply] 重启演示服务（= 新数据）"
rm -f "${ROOT}/run/status"   # 先清状态：否则验收会读到上一轮留下的 READY（假绿）
sudo systemctl restart exchange-demo
```

- [ ] **Step 6: `Exchange_js/deploy/colleague-message.txt`**

```
──────── Forward this to colleagues ────────
Exchange demo — all data is fake, click freely.
  Admin console : __ADMIN_URL__
  Customer app  : __CLIENT_URL__
Admin sign-in (password for every account: 123456). The Quick Login panel on the
sign-in page switches roles in one click, or type any of these:
  Super Admin          admin@fiatx.com
  Compliance Officer   compliance_lead@fiatx.com
  MLRO                 mlro@fiatx.com
  Ops Officer          ops_officer@fiatx.com
  CFO                  cfo@fiatx.com
  Treasury Officer     treasury@fiatx.com
  Internal Auditor     auditor@fiatx.com (read-only)
Customer app: click "Demo quick login" and pick a customer.
Note: everyone shares one dataset; every redeploy or reset starts over with fresh data.
────────────────────────────────────────────
```

- [ ] **Step 7: `Exchange_js/scripts/cloud-verify.sh`（spec §5）**

```bash
#!/usr/bin/env bash
# scripts/cloud-verify.sh — 等演示服务 READY，再跑 spec 2026-09-11 §5 自动验收；任一条红 → 退出码 1。兼容 bash 3.2。
# 调用方必须先在服务器上 rm -f run/status 再重启服务，否则这里会读到上一轮留下的 READY（假绿）。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/cloud-env.sh"

echo "[verify] 等演示服务 READY（最多 15 分钟）"
deadline=$(( $(date +%s) + 900 ))
last=""
while :; do
  st="$(cloud_ssh "cat ${CLOUD_ROOT}/run/status 2>/dev/null || echo MISSING")"
  if [[ "${st}" != "${last}" ]]; then echo "  状态：${st}"; last="${st}"; fi
  [[ "${st}" == "READY" ]] && break
  if [[ "${st}" == FAILED:* ]]; then
    echo "✖ 启动失败（${st}），boot.log 最后 60 行：" >&2
    cloud_ssh "tail -n 60 ${CLOUD_ROOT}/run/boot.log" >&2
    exit 1
  fi
  if (( $(date +%s) > deadline )); then echo "✖ 15 分钟内没到 READY" >&2; exit 1; fi
  sleep 5
done

LOG="$(cloud_ssh "cat ${CLOUD_ROOT}/run/boot.log")"
fails=0
pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1 —— $2"; fails=$((fails + 1)); }
eq() { [[ "$1" =~ ([0-9]+)/([0-9]+) ]] && [[ "${BASH_REMATCH[1]}" == "${BASH_REMATCH[2]}" ]] && (( BASH_REMATCH[2] > 0 )); }

# 1. demo:all
if grep -q 'demo:all DONE ✅' <<<"${LOG}"; then
  pass "demo:all DONE（花名册逐条 + COA 四恒等式）"
else
  fail "demo:all" "boot.log 里没有 'demo:all DONE ✅'"
fi

# 2. recon:demo:break —— 三组数字两边相等且 > 0，且没有任何 BAD 断言
sc="$(grep -oE 'scenarios: [0-9]+/[0-9]+ DETECTED' <<<"${LOG}" | tail -1 || true)"
wl="$(grep -oE 'wallets: +[0-9]+/[0-9]+ bucket OK' <<<"${LOG}" | tail -1 || true)"
co="$(grep -oE 'casesOpened [0-9]+/[0-9]+' <<<"${LOG}" | tail -1 || true)"
if eq "${sc}" && eq "${wl}" && eq "${co}" && ! grep -qE '^ *BAD ' <<<"${LOG}"; then
  pass "recon:demo:break（${sc} · ${wl} · ${co}）"
else
  fail "recon:demo:break" "scenarios='${sc}' wallets='${wl}' cases='${co}'，或日志里有 BAD 断言"
fi

# 3. verify:coa —— 在服务器上用演示服务同一套环境变量跑
if cloud_ssh "cd ${CLOUD_ROOT}/app && set -a && . ${CLOUD_ROOT}/demo.env && set +a && PATH=/opt/node20/bin:\$PATH npm run -s verify:coa" | grep -q 'ALL INVARIANTS PASS'; then
  pass "verify:coa（恒等式 + 负余额断言）"
else
  fail "verify:coa" "输出里没有 ALL INVARIANTS PASS"
fi

# 4. 两个网址 HTTPS 200，且证书校验通过（curl 默认校验证书）
for u in "${CLOUD_ADMIN_URL}/" "${CLOUD_CLIENT_URL}/"; do
  code="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "${u}" || true)"
  if [[ "${code}" == "200" ]]; then pass "HTTPS ${u}"; else fail "HTTPS ${u}" "返回 ${code:-无响应}（证书校验失败也会到这里）"; fi
done

# 5. 经 /api 反代登录（证明反代 + CORS 都通）
tok="$(curl -s -m 15 -H 'Content-Type: application/json' -d '{"email":"admin@fiatx.com","password":"123456"}' "${CLOUD_ADMIN_URL}/api/auth/login" | grep -oE '"access_token":"[^"]+"' || true)"
if [[ -n "${tok}" ]]; then pass "经 ${CLOUD_ADMIN_URL}/api 登录拿到 access_token"; else fail "登录" "没拿到 access_token"; fi

if (( fails > 0 )); then echo "[verify] ✖ ${fails} 项不通过" >&2; exit 1; fi
echo "[verify] ✅ 全部通过"
```

- [ ] **Step 8: `Exchange_js/scripts/cloud-deploy.sh`（spec §4）**

```bash
#!/usr/bin/env bash
# scripts/cloud-deploy.sh — 一条命令部署到云端演示服务器（spec 2026-09-11 §4）。兼容 bash 3.2。
# 预检（运行相关文件已提交）→ 本机构建（临时目录）→ rsync 只传改动 → 服务器 remote-apply → 等 READY + 验收
set -euo pipefail
START_TS=$(date +%s)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/cloud-env.sh"
source "${SCRIPT_DIR}/node-env.sh"
ensure_node20

cd "${CLOUD_APP_DIR}"
TOP="$(git rev-parse --show-toplevel)"
REL="$(git rev-parse --show-prefix)"
REL="${REL%/}"   # = Exchange_js
RUNTIME_PATHS=(src prisma scripts config admin-web client-web deploy package.json package-lock.json .npmrc tsconfig.json tsconfig.build.json)

echo "[deploy] 1/5 预检：运行相关文件必须已提交"
DIRTY="$(git status --porcelain -- "${RUNTIME_PATHS[@]}")"
if [[ -n "${DIRTY}" ]]; then
  echo "✖ 以下文件有未提交改动，先提交再部署：" >&2
  echo "${DIRTY}" >&2
  exit 1
fi
COMMIT="$(git rev-parse --short HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "  部署 ${BRANCH}@${COMMIT} → ${CLOUD_HOST}"
cloud_ssh true || { echo "✖ SSH 连不上 ${CLOUD_HOST}" >&2; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT
mkdir -p "${STAGE}/app" "${STAGE}/web/admin" "${STAGE}/web/client"

echo "[deploy] 2/5 本机构建（输出进临时目录，不碰本机 dist/）"
git -C "${TOP}" archive "HEAD:${REL}" src prisma scripts config package.json package-lock.json .npmrc tsconfig.json | tar -x -C "${STAGE}/app"
npx tsc -p tsconfig.build.json --outDir "${STAGE}/app/dist" --declaration false --sourceMap false --incremental false
( cd admin-web && npx tsc -b tsconfig.app.json tsconfig.node.json && VITE_API_URL=/api npx vite build --outDir "${STAGE}/web/admin" --emptyOutDir )
( cd client-web && npx tsc -b tsconfig.app.json tsconfig.node.json && VITE_API_URL=/api npx vite build --outDir "${STAGE}/web/client" --emptyOutDir )
echo "${BRANCH}@${COMMIT} $(date '+%F %T')" > "${STAGE}/app/DEPLOYED_VERSION"

echo "[deploy] 3/5 上传（rsync 只传改动；服务器上的 node_modules 不动）"
cloud_rsync --exclude node_modules "${STAGE}/app/" "${CLOUD_USER}@${CLOUD_HOST}:${CLOUD_ROOT}/app/"
cloud_rsync "${STAGE}/web/" "${CLOUD_USER}@${CLOUD_HOST}:${CLOUD_ROOT}/web/"
cloud_rsync "${CLOUD_APP_DIR}/deploy/" "${CLOUD_USER}@${CLOUD_HOST}:${CLOUD_ROOT}/deploy/"

echo "[deploy] 4/5 服务器：装依赖 / 刷新配置 / 重启演示服务"
cloud_ssh "bash ${CLOUD_ROOT}/deploy/remote-apply.sh ${CLOUD_HOST}"

echo "[deploy] 5/5 等 READY + 验收"
bash "${SCRIPT_DIR}/cloud-verify.sh"
echo "[deploy] ✅ 完成：${BRANCH}@${COMMIT}，总用时 $(( $(date +%s) - START_TS )) 秒"
echo ""
sed -e "s#__ADMIN_URL__#${CLOUD_ADMIN_URL}#g" -e "s#__CLIENT_URL__#${CLOUD_CLIENT_URL}#g" "${CLOUD_APP_DIR}/deploy/colleague-message.txt"
```

在 `Exchange_js/package.json` 的 `scripts` 里、`"cloud:bootstrap"` 下面加：

```json
    "cloud:deploy": "bash scripts/cloud-deploy.sh",
```

- [ ] **Step 9: 语法检查，然后提交（部署只认已提交的内容，所以要先提交）**

```bash
chmod +x deploy/demo-run.sh deploy/remote-apply.sh scripts/cloud-verify.sh scripts/cloud-deploy.sh
bash -n scripts/cloud-verify.sh && bash -n scripts/cloud-deploy.sh && echo mac-syntax-ok
for f in deploy/demo-run.sh deploy/remote-apply.sh; do ssh -i ~/.ssh/exchange_demo_ed25519 -o BatchMode=yes ubuntu@101.32.141.97 'bash -n' < "$f" && echo "server-syntax-ok $f"; done
git add deploy/ scripts/cloud-verify.sh scripts/cloud-deploy.sh package.json
git commit -m "feat(上云): 演示服务（每次启动从零铺数据）+ Caddy HTTPS/反代 + 一条命令部署与自动验收"
```

Expected：`mac-syntax-ok`，两行 `server-syntax-ok`，提交成功。

- [ ] **Step 10: 首次部署，同时采样内存峰值**

另开一个 Bash 调用（`run_in_background: true`）采样服务器内存，覆盖整个首次启动过程：

```bash
ssh -i ~/.ssh/exchange_demo_ed25519 -o BatchMode=yes ubuntu@101.32.141.97 'peak=0; for i in $(seq 1 300); do u=$(free -m | awk "/Mem:/{print \$3}"); s=$(free -m | awk "/Swap:/{print \$3}"); [ "$u" -gt "$peak" ] && peak=$u && speak=$s; sleep 2; done; echo "PEAK used=${peak}MB swap_at_peak=${speak}MB"'
```

主调用：

```bash
npm run cloud:deploy
```

Expected：`[verify]` 下面 6 行全是 `✓`，然后是 `[verify] ✅ 全部通过`、`[deploy] ✅ 完成：feat/cloud-demo-deploy@<hash>，总用时 N 秒`，最后是「Forward this to colleagues」段。首次部署含服务器 `npm ci`，会明显更久。**记下总用时与 PEAK**（Task 6 要写进 CLAUDE.md §10 和最终报告）。PEAK used > 3200 MB 时，按 spec §10 评估 swap（服务器自带 2 GB swap，已确认存在）。

遇到红就停下，按 superpowers:systematic-debugging 查：`boot.log` 最后 60 行会自动打出来；Caddy 查 `sudo journalctl -u caddy -n 50`；演示服务查 `sudo journalctl -u exchange-demo -n 100`。

- [ ] **Step 11: 常规更新用时（依赖不变 → 不跑 npm ci）**

```bash
npm run cloud:deploy > /tmp/deploy-2.log 2>&1; echo "exit=$?"
grep -E "跳过 npm ci|✓|✗|总用时" /tmp/deploy-2.log
```

Expected：`exit=0`（不走管道：管道会吞掉退出码，本仓库反复踩过）；出现 `依赖清单未变 → 跳过 npm ci`，6 个 `✓`，总用时 ≤ 300 秒（spec §9-1）。超过就记下各段耗时、原因，照实上报，不算失败。

- [ ] **Step 12: 变异测试——证明验收会红（spec §5「验收能失败」）**

每一条都要看到对应的 `✗`、命令退出码为 1，然后恢复。

```bash
# M1 demo:all 证据缺失
bash -c 'source scripts/cloud-env.sh && cloud_ssh "sed -i \"s/demo:all DONE ✅/demo:all DONE-MUTATED/\" /opt/exchange-demo/run/boot.log"'
bash scripts/cloud-verify.sh; echo "exit=$?"      # 期望：✗ demo:all … exit=1

# M2 对账场景少一个
bash -c 'source scripts/cloud-env.sh && cloud_ssh "sed -i -E \"s#scenarios: ([0-9]+)/#scenarios: 1/#\" /opt/exchange-demo/run/boot.log"'
bash scripts/cloud-verify.sh; echo "exit=$?"      # 期望：✗ recon:demo:break … exit=1

# M4 HTTPS 断了
bash -c 'source scripts/cloud-env.sh && cloud_ssh "sudo systemctl stop caddy"'
bash scripts/cloud-verify.sh; echo "exit=$?"      # 期望：两条 ✗ HTTPS、✗ 登录，exit=1
bash -c 'source scripts/cloud-env.sh && cloud_ssh "sudo systemctl start caddy"'

# M5 反代指向错误端口 → 登录失败
bash -c 'source scripts/cloud-env.sh && cloud_ssh "sudo sed -i s#127.0.0.1:3000#127.0.0.1:3999# /etc/caddy/Caddyfile && sudo systemctl reload caddy"'
bash scripts/cloud-verify.sh; echo "exit=$?"      # 期望：✗ 登录 … exit=1

# 恢复：重新部署会重写 Caddyfile、重铺数据、刷新 boot.log
npm run cloud:deploy
```

Expected：M1 / M2 / M4 / M5 各自 `exit=1` 且 `✗` 落在对应条目；最后的部署 6 个 `✓` 全绿。

- [ ] **Step 13: 提交（若 Step 10–12 期间修过脚本）**

```bash
git add deploy/ scripts/cloud-*.sh
git commit -m "fix(上云): 演示服务等接口就绪的超时从 120 秒放宽到 240 秒"
```

上面的提交信息只是格式示例：`fix(上云): ` 开头，后面照实写这次修了什么，一句话。没有改动就跳过这一步。

---

### Task 4: 重铺命令 + 两个双击入口

**Files:**
- Create: `Exchange_js/scripts/cloud-reset.sh`
- Create: `部署.command`（仓库根）
- Create: `重铺数据.command`（仓库根）
- Modify: `Exchange_js/package.json`（加 `cloud:reset`）

**Interfaces:**
- Consumes：`cloud-env.sh`；`cloud-verify.sh`（前提：先 `rm -f run/status`）；服务名 `exchange-demo`；`/opt/exchange-demo/app/DEPLOYED_VERSION`

- [ ] **Step 1: `Exchange_js/scripts/cloud-reset.sh`**

```bash
#!/usr/bin/env bash
# scripts/cloud-reset.sh — 重铺：重启演示服务（= 新数据）→ 等 READY + 验收（spec 2026-09-11 §4）。兼容 bash 3.2。
set -euo pipefail
START_TS=$(date +%s)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/cloud-env.sh"
echo "[reset] 线上版本：$(cloud_ssh "cat ${CLOUD_ROOT}/app/DEPLOYED_VERSION 2>/dev/null || echo 未知")"
cloud_ssh "rm -f ${CLOUD_ROOT}/run/status && sudo systemctl restart exchange-demo"   # 先清状态，防假绿
bash "${SCRIPT_DIR}/cloud-verify.sh"
echo "[reset] ✅ 完成，用时 $(( $(date +%s) - START_TS )) 秒"
```

在 `Exchange_js/package.json` 的 `scripts` 里、`"cloud:deploy"` 下面加：

```json
    "cloud:reset": "bash scripts/cloud-reset.sh",
```

- [ ] **Step 2: 两个双击入口（仓库根，与原 `打包.command` 同级）**

`部署.command`：

```bash
#!/usr/bin/env bash
# 双击：把本机已提交的代码部署到云端演示服务器（spec 2026-09-11）
cd "$(dirname "$0")/Exchange_js" || exit 1
bash scripts/cloud-deploy.sh
echo ""
read -r -p "按回车关闭窗口 " _
```

`重铺数据.command`：

```bash
#!/usr/bin/env bash
# 双击：云端演示服务器重铺一套全新数据（spec 2026-09-11）
cd "$(dirname "$0")/Exchange_js" || exit 1
bash scripts/cloud-reset.sh
echo ""
read -r -p "按回车关闭窗口 " _
```

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.claude/worktrees/cloud-deploy
chmod +x 部署.command 重铺数据.command Exchange_js/scripts/cloud-reset.sh
bash -n 部署.command && bash -n 重铺数据.command && bash -n Exchange_js/scripts/cloud-reset.sh && echo syntax-ok
```

- [ ] **Step 3: 实测重铺——数据换新 + 全绿**

```bash
cd Exchange_js
before="$(bash -c 'source scripts/cloud-env.sh && cloud_ssh "grep -m1 -oE \"DEP[0-9]+\" /opt/exchange-demo/run/boot.log"')"
echo | bash ../重铺数据.command
after="$(bash -c 'source scripts/cloud-env.sh && cloud_ssh "grep -m1 -oE \"DEP[0-9]+\" /opt/exchange-demo/run/boot.log"')"
echo "before=${before} after=${after}"; [[ -n "${before}" && "${before}" != "${after}" ]] && echo "fresh-data-ok"
```

Expected：双击入口的输出里 6 个 `✓`、`[reset] ✅ 完成`；最后打出 `fresh-data-ok`（第一笔充值单号变了 = 新数据）。

- [ ] **Step 4: 提交**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.claude/worktrees/cloud-deploy
git add 部署.command 重铺数据.command Exchange_js/scripts/cloud-reset.sh Exchange_js/package.json
git commit -m "feat(上云): 重铺命令 + 仓库根双击入口（部署 / 重铺数据）"
```

---

### Task 5: 退役 zip 交付与全部 Docker 文件（spec §7）

**Files:**
- Delete: `打包.command`、`.gitattributes`（仓库根）、`Exchange_js/.gitattributes`、`Exchange_js/启动演示.bat`、`Exchange_js/启动演示.command`、`Exchange_js/READ-ME-FIRST.md`、`Exchange_js/SETUP.md`、`Exchange_js/scripts/package-release.sh`、`Exchange_js/docker-compose.yml`、`Exchange_js/Dockerfile`、`Exchange_js/.dockerignore`、`Exchange_js/docker/backend-entrypoint.sh`、`Exchange_js/admin-web/Dockerfile`、`Exchange_js/admin-web/.dockerignore`、`Exchange_js/admin-web/nginx.conf`、`Exchange_js/client-web/Dockerfile`、`Exchange_js/client-web/.dockerignore`、`Exchange_js/client-web/nginx.conf`
- Modify: `Exchange_js/package.json`（删 `package:release`）、`Exchange_js/.env.example:48`

**Interfaces:** 无（纯减法）。

- [ ] **Step 1: 删除**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.claude/worktrees/cloud-deploy
git rm -q 打包.command .gitattributes Exchange_js/.gitattributes "Exchange_js/启动演示.bat" "Exchange_js/启动演示.command" \
  Exchange_js/READ-ME-FIRST.md Exchange_js/SETUP.md Exchange_js/scripts/package-release.sh \
  Exchange_js/docker-compose.yml Exchange_js/Dockerfile Exchange_js/.dockerignore Exchange_js/docker/backend-entrypoint.sh \
  Exchange_js/admin-web/Dockerfile Exchange_js/admin-web/.dockerignore Exchange_js/admin-web/nginx.conf \
  Exchange_js/client-web/Dockerfile Exchange_js/client-web/.dockerignore Exchange_js/client-web/nginx.conf
git status --short | wc -l
```

Expected：`18`（18 个 `D`）。

- [ ] **Step 2: 两处引用改掉**

`Exchange_js/package.json`：删掉这一行

```json
    "package:release": "bash scripts/package-release.sh",
```

`Exchange_js/.env.example` 第 48 行：

```
# TigerBeetle. Start/format it separately (see SETUP.md).
```

改为：

```
# TigerBeetle. Start/format it separately (see scripts/dev-tigerbeetle.sh).
```

- [ ] **Step 3: 查残留引用**

```bash
git grep -nIE "READ-ME-FIRST|SETUP\.md|package:release|package-release|start-demo|启动演示|docker-compose|backend-entrypoint|打包\.command" -- . ':(exclude)Exchange_js/doc-final/archive' ':(exclude)Exchange_js/doc-final/PRODUCTION-NOTES.md' ':(exclude)Exchange_js/doc-final/superpowers' ':(exclude)Exchange_js/doc-final/TOOLING-DEBT.md' || echo "no-dangling-refs"
```

Expected：`no-dangling-refs`。排除项的理由：
- `archive` 是历史存档，不读；
- `PRODUCTION-NOTES` 只许追加；
- `superpowers` 是本任务自己的 spec 和 plan，本来就在描述这些文件；
- `TOOLING-DEBT:73` 留给 Task 6 划掉。

- [ ] **Step 4: 闸①（package.json 改过）+ 提交**

```bash
cd Exchange_js && npx tsc --noEmit -p tsconfig.json && cd ..
git add -A Exchange_js/package.json Exchange_js/.env.example
git commit -m "chore(上云): 退役 zip 交付与全部 Docker 文件——打包入口/启动器/READ-ME-FIRST/SETUP/Dockerfile/compose/.gitattributes"
```

Expected：tsc 无输出；提交里是 18 个删除加 2 个修改。

---

### Task 6: 文档收口 + 收尾闸 + 浏览器验收 + 终审 + 合并

**Files:**
- Modify: `CLAUDE.md`（仓库根，§10 末尾追加）
- Modify: `Exchange_js/doc-final/CHANGELOG.md`（追加一行）
- Modify: `Exchange_js/doc-final/TOOLING-DEBT.md:73`（划掉）
- Modify: `Exchange_js/doc-final/demo/script.md:7`（环境行补云端入口）

**Interfaces:** 无。

- [ ] **Step 1: CLAUDE.md §10 末尾追加**（锚点是 §10 最后一条 `- **合并进 main 后必做**：…`，接在它后面）

````markdown

**云端演示环境**（2026-09-11 起，给同事自助看）：腾讯云新加坡轻量服务器 `101.32.141.97`（Ubuntu 26.04 / 2 核 4 GB）｜管理台 `https://101.32.141.97` ｜客户端 `https://101.32.141.97:8443`

```bash
npm run cloud:deploy      # 部署本机已提交版本（= 新数据）；或双击仓库根「部署.command」
npm run cloud:reset       # 重铺一套新数据；或双击「重铺数据.command」
npm run cloud:bootstrap   # 开服（一次性；控制台重装系统后重跑）
```

- 配置在 `Exchange_js/.cloud.env`（未入库，照 `.cloud.env.example`）；SSH 密钥 `~/.ssh/exchange_demo_ed25519`，只用密钥
- 服务器不用 Docker：systemd 管 `exchange-demo`（账本 + API，每次启动从零铺数据）与 `caddy`（Let's Encrypt IP 证书 6 天自动续、托管两个前端、`/api` 反代）；启动日志 `/opt/exchange-demo/run/boot.log`，线上版本 `/opt/exchange-demo/app/DEPLOYED_VERSION`
- 实测：首次部署 <Task 3 Step 10 记下的秒数> 秒，常规更新 <Step 11 的秒数> 秒，启动内存峰值 <Step 10 的 PEAK> MB
- 绝不删 `/var/lib/caddy`（证书存储；重签会撞 Let's Encrypt 频率上限）
````

尖括号三处由执行者填入 Task 3 实测的真数字，不许留尖括号。

- [ ] **Step 2: CHANGELOG 追加一行**（接在 `> 每次合并一行…` 那段说明之后、第一条之前）

```markdown
- [2026-09-11] **演示环境上云：同事在浏览器里直接看，不用再装 Docker** —— 观众能感知的变化是：演示系统常驻腾讯云新加坡服务器，管理台 `https://101.32.141.97`、客户端 `https://101.32.141.97:8443`，打开即用（HTTPS，免费 IP 证书自动续期）；每次部署或重铺都自动铺满花名册 29 笔交易与 18 个对账差异场景并自动验收（29/29、COA 恒等式、verify:coa、对账 18/18、两个页面、登录，任一条红即部署失败）；业主一条命令（或双击「部署」）完成更新。zip 交付包与全部 Docker 文件退役——它们 7 月后无人复验，已在任何干净机器上起不来（管理台构建必挂、demo:all 收尾崩、停了再开起不来、对账零数据）。
```

- [ ] **Step 3: TOOLING-DEBT 第 73 行划掉**

先取 Task 5 删除提交的短 hash：

```bash
git log -1 --format=%h -- Exchange_js/docker/backend-entrypoint.sh
```

把第 73 行开头的 `- [ ] **Docker 入口每次启动无条件跑 db:base:sync，会触发新的管理员账号清空逻辑**` 改成下面这样，行尾原文保留：

```markdown
- [x] ~~**Docker 入口每次启动无条件跑 db:base:sync，会触发新的管理员账号清空逻辑**~~ → **2026-09-11 已销**（<上一条命令输出的短 hash>）：Docker 交付整体退役（上云后服务器直接部署、每次启动从零铺数据，spec 2026-09-11），该入口文件已删；"每次从零"下清账号是预期行为。
```

尖括号换成真实 hash。

- [ ] **Step 4: `doc-final/demo/script.md` 第 7 行**

把开头这段：

```markdown
**环境**：main 栈（API 3000 ｜ 管理台 3001 ｜ 客户端 3002）。
```

改为：

```markdown
**环境**：main 栈（API 3000 ｜ 管理台 3001 ｜ 客户端 3002）；云端演示环境（同事自助，数据同样由 `demo:all` + `recon:demo:break` 铺好）：管理台 `https://101.32.141.97`、客户端 `https://101.32.141.97:8443`，重铺 `npm run cloud:reset`。
```

- [ ] **Step 5: 收尾闸 ①②③④**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.claude/worktrees/cloud-deploy/Exchange_js
npx tsc --noEmit -p tsconfig.json
cd admin-web && npx tsc -b --noEmit && cd ..
cd client-web && npx tsc -b --noEmit && cd ..
npx jest scripts/demo-data-md.spec.ts
```

Expected：三处 tsc 都无输出；jest `3 passed`。

- [ ] **Step 6: 收尾闸⑥（self 栈从零重铺 + demo:all；demo-lib 改过）**

按 `doc-final/demo/baseline.md` 的顺序：先 down，再 reset，再 up。

```bash
bash scripts/stack.sh down
bash scripts/stack.sh reset self
bash scripts/stack.sh up
bash scripts/on-stack.sh self demo:all > /tmp/wt-demo-all.log 2>&1; echo "exit=$?"
tail -5 /tmp/wt-demo-all.log
grep -E "data.md 生成区已更新|demo:all DONE ✅" /tmp/wt-demo-all.log
git status --short doc-final/demo/data.md
```

Expected：
- `exit=0`，两行都能 grep 到。worktree 里有 data.md，所以要看到 `✓ data.md 生成区已更新`，证明 main 上的行为没变。
- `git status` 对 data.md 无输出：生成区只收跨重铺稳定的列，不应产生差异。有差异就停下查。
- 如果 `up` 撞了账本端口，先 `bash scripts/stack.sh status` 看，按 baseline.md 第 69 行处理。

- [ ] **Step 7: 浏览器验收（spec §9-4；交付清单「改了前端 → 截图」）**

用 Browser 面板打开 `https://101.32.141.97`：
1. 用 Quick Login 进管理台，截图首页。
2. 打开任意一张资金单或账本页，点一个"复制"按钮，截图，同时读 console，确认没有 `navigator.clipboard` 报错。
3. 打开 `https://101.32.141.97:8443`，用 Demo quick login 进客户端，截图 Overview。

Expected：
- 三张截图都正常渲染；
- 地址栏是 https，且没有证书警告；
- console 里没有 clipboard 报错。

- [ ] **Step 8: 提交文档收口**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.claude/worktrees/cloud-deploy
git add CLAUDE.md Exchange_js/doc-final/CHANGELOG.md Exchange_js/doc-final/TOOLING-DEBT.md Exchange_js/doc-final/demo/script.md
git commit -m "docs(上云): CLAUDE.md §10 云端运维事实 + CHANGELOG + TOOLING-DEBT 销账 + 剧本环境行"
```

- [ ] **Step 9: 终审（子代理，省略 model 走继承）**

按 superpowers:requesting-code-review 派终审，prompt 要带上 CLAUDE.md §0–§5 要点，并逐条问两件事：
- spec 里的每条承诺，代码在哪（记忆判例：逐任务评审抓不到"spec 承诺了但没人建"）；
- 每条验收能不能红（Step 12 的变异结果要附上）。

红项修完再回到 Step 5 重跑收尾闸。

- [ ] **Step 10: 合并（按 superpowers:finishing-a-development-branch）**

**合并前必须先征得业主当面确认**：主工作树里业主未提交的 `READ-ME-FIRST.md` 英文重写与 `start-demo.*` 改名要丢弃（spec §7 已批；账号表已并入 `colleague-message.txt`）。业主确认后，在主工作树执行：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版
git restore --staged -- Exchange_js/start-demo.bat Exchange_js/start-demo.command "Exchange_js/启动演示.bat" "Exchange_js/启动演示.command" Exchange_js/READ-ME-FIRST.md
git restore --worktree -- "Exchange_js/启动演示.bat" "Exchange_js/启动演示.command" Exchange_js/READ-ME-FIRST.md
rm -f Exchange_js/start-demo.bat Exchange_js/start-demo.command
git status --short        # 只应剩业主那份未跟踪的 lark 文档
git merge --no-ff feat/cloud-demo-deploy -m "Merge branch 'feat/cloud-demo-deploy': 演示环境上云"
```

合并后：
- 先把本机配置带回主工作树（它不进 git，合并带不过来）：`cp .claude/worktrees/cloud-deploy/Exchange_js/.cloud.env Exchange_js/.cloud.env`
- 在主工作树跑一次 `npm run cloud:deploy`（在 `Exchange_js/` 下），确认从 main 部署也全绿。它走的正是业主双击的那条路径。
- 按 CLAUDE.md §10 清理：在 worktree 里 `bash scripts/stack.sh down`，然后 `git worktree remove .claude/worktrees/cloud-deploy` 与 `git branch -d feat/cloud-demo-deploy`。
- 本任务没动 RBAC、schema、seed，所以 main 栈不需要 `db:base:sync`，也不需要 reset。

- [ ] **Step 11: 收尾报告与记忆**

- 给业主的报告要写明：两个网址、实测三个数字（首次部署、常规更新、内存峰值）、变异测试结果、「转发给同事」段原文，以及 CLAUDE.md §9 规定的收尾行。
- 请业主或迪拜同事亲自打开两个网址确认（spec §9-5 最终验收）；确认之前，本任务不算完成。
- 更新记忆：新建一条「演示环境上云已合 main」，并把 `docker-delivery-rot-2026-09-11` 标注为"已由上云取代"。
