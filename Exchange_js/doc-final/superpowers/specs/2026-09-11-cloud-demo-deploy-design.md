# 演示环境上云 · 设计 spec（2026-09-11）

> 业主脑暴定稿（2026-09-11）。
> 本任务做：演示系统**直接部署**（不用 Docker）到腾讯云新加坡轻量服务器；业主 Mac 上一条命令部署、一条命令重铺；每次启动自动铺满演示数据（含对账差异）并自动验收；迪拜同事用浏览器直接用；退役 zip 交付与全部 Docker 文件。
> 本任务不做（对照 CLAUDE.md §2 与本文 §8）：Docker / 容器化、门锁 / 访问控制、数据保留与迁移兼容、定时重铺、多实例、监控告警、域名。

## 0. 为什么上云

2026-09-11 诊断（同事在 Windows 上"总是有问题"）：zip 交付自 07-07 起无人复验，已在任何干净机器上起不来——

- 干净构建必挂：admin 的 `tsc -b` 带进了 spec 项目，两个 spec 从 `../../../src|scripts` import，Docker 构建上下文里没有 → TS2307；
- `demo:all` 收尾读 `doc-final/demo/data.md`，而打包排除了 `doc-final` → FATAL（29/29 其实已过）；
- 停了再开起不来：tb-format 重跑报 PathAlreadyExists，账本不启动；
- 包里对账数据为零：入口脚本不跑 `recon:demo:break`；
- 打包只取 HEAD：业主未提交的改动不进包。

另外，Windows 真机在 Mac 上验不了（Apple 芯片虚拟机跑不了 WSL2；模拟 x86 时账本报 io_uring 不可用）。上云后同事零安装、浏览器即客户端，Windows 问题整类消失，验收直接在真实运行的服务器上做。

## 1. 业主拍板清单（2026-09-11，全部已定）

1. **上云替代 zip 交付。**
2. **服务器**：腾讯云轻量应用服务器（国际站），**新加坡**（从迪拜实测 TCP 建连 107 ms，候选地域中最低：香港 143 / 法兰克福 155 / 东京 174）；Starter 2 核 8 GB、80 GB SSD、30 Mbps、月流量 2560 GB（2026-09-11 由 2 核 4 GB 升级：账本要放内存盘，4 GB 装不下，见 §2）；**Ubuntu 26.04 LTS**。不用大陆地域：需 ICP 备案，且银发〔2026〕42 号明令"法定货币与虚拟货币兑换业务"属非法金融活动、互联网企业不得为其提供网络经营场所——备案过不了，还有被停机风险。
3. **不加门锁**：网址公开可达、Quick Login 可一键进超管——业主接受（内部演示、数据全假）。
4. **数据不重要**：每次启动都换一套全新数据（部署 / 手动重铺 / 服务器重启一律如此）；不做定时重铺。
5. **部署要快**：业主 Mac 上一条命令（或双击）完成；常规更新目标 ≤ 5 分钟。
6. **上 HTTPS**（执行者建议、业主未反对）：Chrome 154（2026-10）起对 http 公网站点默认弹整页警告；管理台 / 客户端 11 处"复制"按钮用 `navigator.clipboard`，只在安全上下文可用。
7. **不用 Docker，直接部署**（业主提出、执行者赞同）：Docker 在 zip 路线里是为了把整套环境塞进别人的 Windows 电脑（Windows 没有账本程序）；上云后只有一台自管的 Linux 服务器，这个理由消失。服务器上的跑法与 main 栈相同：`node dist/main` + TigerBeetle 程序 + SQLite 文件。

## 2. 运行形态（服务器上）

```
浏览器 https://<IP>/       ─┐  Caddy（系统服务）：静态托管 admin / client
浏览器 https://<IP>:8443/  ─┤  /api/* 去前缀反代 → 127.0.0.1:3000；80 → 跳 https
                            └─> 演示服务 exchange-demo（系统服务）：TigerBeetle + 后端 API，本机直接跑
```

- **开服时一次装好**（不装 Docker）：Node 20（官方二进制包，与 `.nvmrc` 一致）、TigerBeetle 0.17.3 Linux 程序（与 `tigerbeetle-node` 版本一致）、Caddy；并给账本数据目录挂 1400 MB 内存盘（`/etc/fstab` tmpfs）。已核：后端唯一需要编译的原生依赖 `bcrypt@6.0.0` 自带 linux-x64 预编译包，服务器无需编译工具；Prisma 引擎按 `binaryTargets` 在服务器 `npm ci` 时取 Linux 版。
- **演示服务**：一个 systemd 服务，执行 §3 的启动顺序；API 与账本只监听 `127.0.0.1`（`TB_ADDRESS=127.0.0.1:3003`，账本客户端只认 IP 的老问题自然不存在）。按 TigerBeetle 官方 systemd 文档调高锁内存上限（`LimitMEMLOCK`），io_uring 初始化需要。开机自启；进程崩溃时自动重启（= 新数据）。
- **Caddy**：443 = 管理台，8443 = 客户端。前端构建时 `VITE_API_URL=/api`——已核：前端全部按 `${VITE_API_URL}/path` 拼接，无 WebSocket / SSE，**前端零代码改动**。浏览器只对 Caddy 同源请求；后端 CORS 白名单由 `ADMIN_URL=https://<IP>`、`CLIENT_URL=https://<IP>:8443` 覆盖。
- **无持久数据、全部在内存**：SQLite 放 `/run/exchange-demo`（systemd `RuntimeDirectory=`，服务每次重启由 systemd 清空）；账本文件放 `/opt/exchange-demo/data`，该目录挂 1400 MB 内存盘（`/etc/fstab` tmpfs），演示服务每次启动先清空（§3 第 1 步）。2026-09-11 对照实验：这块云硬盘同步写约 4 ms/次（Mac 约 0.1 ms），SQLite 放盘上 `demo:all` 必撞 Prisma `P1008`，挪进内存盘后解决。之后仍有约一半开机失败，当时判断为"卡在账本落盘"，于是把账本也挪进内存、升级到 8 GB；账本进内存后失败照旧（10 次成 4 次）——与磁盘无关。真因是两条，2026-09-11/12 查清并修掉（见 `2026-09-11-tx-leak-fix-design.md`）：① 业务代码 8 处事务漏传；② "制裁连带冻结"广播那一步，同一进程里主流程与三个域的监听器同时写库、多条连接抢 SQLite 唯一写锁，故服务配置改成每进程 1 条连接（§3）。8 GB 只能升不能降；账本留在内存盘开机更快，保持现状。
- **端口**（2026-09-11 实测）：22 / 80 已放通；**443 与 8443 被腾讯云控制台防火墙拦截**（服务器自身 ufw 未启用、iptables 全放行，已排除），需业主在控制台加两条 TCP 允许。3000 / 3003 只在本机，不对外。
- **文件布局**：服务器侧文件放 `Exchange_js/deploy/`（`exchange-demo.service`、`demo-run.sh`、`Caddyfile`）；业主侧命令放 `Exchange_js/scripts/cloud-*.sh`，并挂 npm 脚本与仓库根双击入口。

## 3. 演示服务启动顺序（每次启动都跑；任何一步失败即停在 FAILED）

1. 清空数据目录
2. `tigerbeetle format --development` → `tigerbeetle start --development --addresses=127.0.0.1:3003`（开发模式实测 1.44 GiB，默认 3.04 GiB；与 main 栈 `dev-tigerbeetle.sh` 同模式）
3. `prisma migrate deploy`
4. `db:base:sync`（角色权限 + 管理员）
5. `db:seed:business`（业务数据 + `verify:demo-data`；与 main 栈 `stack.sh reset` 同一条命令）
6. 起 API（`node dist/main`），等端口就绪
7. `demo:all`（花名册 29 笔 + COA 四恒等式）
8. `recon:demo:break`（18 场景 / 12 张案子；答案键写入对账运行记录，⚡场景气泡读库即可显示；另把 `RECON_DEMO_MANIFEST_PATH` 指向数据目录——默认值 `/tmp/exchange_js_main/…` 在服务器上不存在）
9. 打印 **READY** + 两个网址，写状态标记供命令读取

- 失败：打印 **FAILED @ 第 N 步** + 该步输出；API 若已起则保持在线（便于排查）；状态标记为失败 → 部署 / 重铺命令红。
- 守护：TigerBeetle 或 API 任一进程退出，服务即退出，由 systemd 按上文规则重启，不留半死状态。
- 环境变量（写在服务配置里）：`DATABASE_URL`（末尾带 `?connection_limit=1` —— 每进程只开 1 条数据库连接，业主 2026-09-12 拍板；理由与实测见 tx-leak spec §0 更正与 §5）、`TB_ADDRESS=127.0.0.1:3003`、`RECON_DEMO_MANIFEST_PATH`、`API_PORT`、`ADMIN_URL` / `CLIENT_URL`、`SUMSUB_MOCK_MODE=true`、`GOVERNANCE_DEMO_ENABLED=true`、`MFA_*`（沿用原 compose 的演示值）、`TS_NODE_TRANSPILE_ONLY=true`（服务器上的种子 / 演示脚本只转译不做类型检查：实测启动约 70 s → 40 s；类型由 Mac 端闸①与部署时的 tsc 把关）。

## 4. 业主的三条命令（业主、同事的电脑都不用装 Docker，也不用装任何新软件）

| 命令 | 做什么 |
|---|---|
| **部署** `npm run cloud:deploy` ｜ 双击 `部署.command` | ① 预检：运行相关路径（`src` / `prisma` / `scripts` / `config` / `admin-web` / `client-web` / `deploy` / `package*.json` / `tsconfig*`）与 HEAD 一致，否则停下并列出未提交文件；SSH 可达。部署的永远是本机已提交版本，打印 commit 号；不需要远端仓库，也不用 push。② **本机构建**：后端 tsc 输出到临时目录（**不碰本机 `dist/`**——main 栈 `stack-up.sh` 直接跑它）；admin / client 执行 `tsc -b tsconfig.app.json tsconfig.node.json && vite build`（不编 spec 项目，spec 仍由闸② 在本机检查）。③ rsync 只传改动（首次约 25–30 MB）：`src/`、`prisma/`、`scripts/`、`config/`、后端编译产物、`package.json` / `package-lock.json` / `.npmrc` / `tsconfig.json`、两个前端的静态构建产物；不传 `node_modules`（服务器自装 Linux 版）、`doc-final`、`test`、前端源码、`.env`（本机真密钥）。④ 服务器（以应用根目录为工作目录——`material-policy.ts` 按 `process.cwd()` 读 `config/material-refresh-policy.json`）：依赖清单变了才重跑 `npm ci`，随后 `prisma generate`；重启演示服务（= 新数据）。⑤ 等 READY → §5 自动验收 → 打印结果、总用时、一段可直接转发给同事的话（两个网址 + 账号 / 职务表） |
| **重铺** `npm run cloud:reset` ｜ 双击 `重铺数据.command` | 重启演示服务（= 新数据）→ 等 READY → §5 验收 → 打印 |
| **开服**（一次性，执行者跑）`npm run cloud:bootstrap` | 装 Node 20、TigerBeetle、Caddy；确认 `kernel.io_uring_disabled=0`（不是则改并持久化）；建运行用户与目录；装两个系统服务；签证书（§6）；首次部署。脚本可在重装后的新系统上原样重跑 |

- 服务器地址与密钥路径存本机未入库文件 `Exchange_js/.cloud.env`（加入 `.gitignore`）；只用 SSH 密钥登录，不用密码。
- 构建放 Mac 的理由：服务器 2 核 4 GB 且同时在跑演示服务，在上面构建慢且易爆内存；本机构建用业主 Mac 的性能，服务器上也不必装前端构建环境。

## 5. 自动验收（部署、重铺都跑；任一条红 = 命令失败）

1. 启动日志含 `demo:all DONE ✅`（花名册 29/29 + COA 四恒等式）
2. 启动日志含 `recon:demo:break` 18/18 场景检出、12/12 钱包分桶、12 张案子开出（判据同 `demo/baseline.md`）
3. 服务器上跑 `verify:coa`：恒等式 + 负余额断言
4. `https://<IP>/` 与 `https://<IP>:8443/` 均返回 200，且证书校验通过
5. 经 `https://<IP>/api` 用 `admin@fiatx.com / 123456` 登录拿到 token（证明反代 + CORS 通）
6. 打印部署总用时

**验收能失败**：实现期对第 1 / 2 / 4 / 5 条各做一次故意破坏，命令必须红，否则该条验收不算数。

## 6. HTTPS

- Let's Encrypt **IP 地址证书**（2026-01-15 起正式可用，须用 `shortlived` 6 天档），服务器自动续期，不需要域名。
- 工具：**Caddy v2.11.4 原生签发**。2026-09-11 在本服务器上对 Let's Encrypt staging 实测：`issuer acme { profile shortlived }` + 全局 `default_sni <IP>` 签到 `IP Address:101.32.141.97` 证书（有效期 6 天余，tls-alpn-01 验证）；浏览器式无 SNI 握手取到的就是它；80 自动 308 跳 https。正式环境全局 `acme_ca` 只指向 Let's Encrypt 正式目录（只配这一家，免得 profile 被不支持它的 CA 拒）。certbot 备选不再需要。
- 续期由 Caddy 自己做（证书 6 天，到期前自动续，无需另装定时器）；续期失败的后果是页面报证书错误，§5 第 4 条会在下次部署 / 重铺时拦下。

## 7. 退役（zip 交付整套 + 全部 Docker 文件）

| 删除 | 说明 |
|---|---|
| `scripts/package-release.sh`、npm `package:release`、仓库根 `打包.command` | 打包入口 |
| `启动演示.bat` / `启动演示.command`（及业主未提交的改名版 `start-demo.*`） | 双击启动器 |
| `READ-ME-FIRST.md`（含业主未提交的英文重写） | 收包人说明书；账号 / 职务表并入部署命令的"转发给同事"输出 |
| `SETUP.md` | 给收包人的原生安装指南，受众已消失；日常开发以 CLAUDE.md 为准 |
| `docker-compose.yml`、`Dockerfile`、`docker/`、`.dockerignore`；`admin-web` / `client-web` 下的 `Dockerfile`、`.dockerignore`、`nginx.conf` | 不再用 Docker |
| 仓库根与 `Exchange_js/` 两份 `.gitattributes` | 只为 `git archive` 的 export-ignore 存在，打包退役后无用 |
| TOOLING-DEBT「Docker 入口每次启动无条件跑 db:base:sync，会清空新管理员」一行 | Docker 入口已删；按"每次从零"的设计，本来就该清 → 划掉 |

⚠️ 合并前：主工作树里业主未提交的 `READ-ME-FIRST.md` 改动与 `start-demo.*` 改名需丢弃（以本任务为准），届时先找业主确认。

## 8. 本任务不做

- Docker / 容器化（§1-7）
- 门锁 / 访问控制 / JWT 密钥加固（业主决定；技术兜底不进本任务）
- 数据保留、跨版本迁移兼容（每次从零；CLAUDE.md §3）
- 定时重铺（业主改为手动）
- 多实例 / 一人一套
- 构建提速（先实测，常规部署超 5 分钟再议）
- Node 升级（项目锁定 20，见 §10）
- 域名、CDN、监控告警、CI
- 业务代码改动。例外两处：① `scripts/demo-lib.ts` 的 `writeDataMdSnapshot` 在 `data.md` 不存在时打印一行"跳过"并返回（服务器上不传 `doc-final`；main 上文件在，行为不变）；② 事务漏传修复 + 种子留痕撞号——2 核服务器上开机铺数据约一半失败的根因，单独立 spec 经业主审批（`2026-09-11-tx-leak-fix-design.md`）

## 9. 验收口径（全部满足才算完成）

1. 开服完成；`cloud:deploy` 一条命令部署成功，§5 全绿；记录实测用时（常规更新目标 ≤ 5 分钟，超了记录原因并上报，不算失败）。
2. §5 的故意破坏均能让命令变红。
3. `cloud:reset` 后数据是新的（单号变了），§5 全绿。
4. 执行者用浏览器打开两个网址：管理台 Quick Login、客户端 Demo quick login、点一个复制按钮成功，截图。
5. 业主或迪拜同事确认能打开（最终验收）。
6. 本机闸门：CLAUDE.md §7 ①②③；`demo-lib` 改动 → ⑥ `on-stack.sh main demo:all` 仍全绿，且 main 上 `data.md` 生成区照常更新。
7. 收尾：CLAUDE.md §10 补"云端演示环境"运维事实（地址 + 三条命令）；`CHANGELOG` 一行；TOOLING-DEBT 划掉 §7 那条；`demo/script.md` 环境行补云端入口。

## 10. 风险与已知限制

- **公网可达、无门锁**：任何拿到网址的人都能一键登超管、改数据；数据全假，重铺即恢复（业主已接受）。
- **单人顺序操作假设**（CLAUDE.md §3）：多名同事同时处理同一张单可能互相冲突；某人处置掉的演示场景，别人再看就是处置后的样子——需要时重铺。
- **服务器重启 = 新数据**（§1-4 的直接后果）。
- **软件装在系统里**：不像容器那样一删就干净；恢复手段是在控制台重装系统后重跑开服脚本。
- **Node 20 已于 2026-04-30 停止维护**：项目锁定 20（`.nvmrc`），服务器与本机保持一致；升级不在本任务。
- **8 GB 内存**：账本进程 1.44 GiB + 账本内存盘文件 1.1 GB + API 与铺数据进程。2026-09-11 升级到 Starter 2 核 8 GB（每月 $10，只能升不能降）时的依据"账本落盘拖出失败"事后被证伪——真因是事务漏传 + 制裁广播那一步多条连接抢 SQLite 写锁（见 tx-leak spec §0 更正）；账本放内存盘开机更快，保持现状。
- **Ubuntu 26.04 较新**：开服若遇 Node / Prisma / Caddy 不兼容，改 24.04 需在控制台重装系统（Lighthouse 支持）。
- **平台内容政策**：新加坡地域无备案要求；演示内容是虚拟资产交易所（假数据、无真实交易）。
