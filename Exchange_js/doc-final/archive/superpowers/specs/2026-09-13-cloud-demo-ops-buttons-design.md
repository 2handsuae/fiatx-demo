# 云端演示自助还原按钮（Demo Ops 面板）· Spec

> 2026-09-13 立（业主脑暴闭环：原始诉求三按钮 → 定案两按钮）｜ 独立小轮，不挂交易战役总纲 ｜ 基线 main `b2160ece`（开工以现场 HEAD 为准）

## 0. 本任务做 / 不做

**做**：后端 demo-ops 模块（环境变量门控，仅云端注册）三接口 ｜ admin 前端 Simulation 门控下的 Demo Data 面板两按钮（重铺数据 / 重摆对账场景）｜ `deploy/demo.env.template` 加门控变量 ｜ 文档收口（CLAUDE.md §10 云端段 + `deploy/colleague-message.txt` 同步）

**不做**（对照项目总纲 §2）：并发锁 / 双击防抖（单人顺序操作假设）｜ 按钮权限细分（登录即可用，管理 API 权限加固在禁做清单）｜ 重铺失败自动补救（FAILED 停驻排查走 boot.log，现状同款）｜ **demo:all 单独按钮**（定案 ②）｜ **本地主栈按钮**（定案 ①）｜ 重铺触发的审计留痕（重铺本身会清掉审计表，留痕无意义；操作痕迹在 journal）｜ RBAC catalog 登记与权限组绑定（勘误，见 §3 登记条）

## 1. 背景事实（2026-09-13 现场查实）

- 云端开机序列 `deploy/demo-run.sh`：清空 → 账本 → 建表 → 底座 → 业务种子 → 起接口 → **demo:all → recon:demo:break** → READY，状态写 `/opt/exchange-demo/run/status`（STARTING:步骤 / READY / FAILED:步骤），实测重铺约 47 秒。
- systemd `exchange-demo.service`：`Restart=on-failure`；demo-run.sh 尾部守护 `wait -n TB API` → 任一进程退出即整服务 exit 1 → systemd 自动重启并从零重铺。**即：API 进程自杀 = 全量重铺**，这是现成机制，`cloud:reset` 就是这么干的（SSH 重启服务）。
- `recon:demo:break` 是锚自由脚本：跑之前先清掉自己上一轮全部足迹（WALLET_V1 run / case / 外部流水 / 外部余额 / demo 标记资金单），再按**当前** account_flows 快照给每个钱包镜像外部对账单、注入 18 个破口场景。同事手动创建的流水会被如实镜像（那些钱包平），破口只有注入的 18 个。前提（人设钱包有跨外部流水）由 demo:all 保证，云端开机自带，恒成立。
- `demo:all` 不自带 reset、setup 幂等，但在已有数据上重跑 = 花名册翻倍 + 前置状态被改过时收尾断言假红——这是 demo:all 不单设按钮的技术依据。
- admin 前端已有 Simulation 开关（`DashboardLayout` 顶栏 toggle + `useSimulationMode`，门控全部 ⚡ 模拟按钮），本面板同属演示操纵性质，挂同一门控。

## 2. 业主定案（2026-09-13，收尾进 decisions.md）

1. **只云端**：按钮仅在云端演示机（101.32.141.97）出现，环境变量门控；本地主栈照旧用命令行（本地重置需停栈重启后端，接口无法自我编排，不做降级形态）。
2. **重置终态 = 满数据态**：重铺一步到位（种子 + 一天交易 + 18 对账破口），demo:all 不单设按钮——重铺已包含它，单独再按只有翻倍与假红两种结局。
3. **两按钮定形**：重铺数据（全桌重摆，约 1 分钟，期间系统不可用）＋ 重摆对账场景（秒级局部还原，只动对账足迹不动其他数据）。

## 3. 后端 · demo-ops 模块

- **门控**：`deploy/demo.env.template` 加 `DEMO_OPS=1` 与 `DEMO_STATUS_PATH=/opt/exchange-demo/run/status`。模块在 `DEMO_OPS` 缺失时不注册路由（本地天然 404，前端据此隐藏入口）。
- **三接口**：
  1. `POST /demo-ops/reset`——先把状态文件覆写为 `STARTING:reset-requested`（消除「点击后 status 仍是 READY」的窗口期），应答 202，随后 `process.exit(1)` → systemd 全量重铺。零编排代码，复用开机序列。
  2. `POST /demo-ops/recon-break`——子进程 `npm run recon:demo:break`（云端有 ts-node，开机序列本就在用；环境变量继承主进程 demo.env）。返回 202；进程态记内存（idle / running / done / fail + 输出尾巴），单人假设下不做排队与去重。
  3. `GET /demo-ops/status`——合并两个状态源返回：status 文件内容（重铺进度；`DEMO_STATUS_PATH` 未设或文件缺失时返回 `UNKNOWN`，本地验收即此形态）+ recon-break 内存态。**免登录**：重铺会重建用户表、旧 token 失效，轮询必须跨越登录态；泄露面只有启动步骤名，演示系统可接受。
- **登记（2026-09-13 写 plan 时勘误）**：demo-ops **不进 RBAC catalog、不挂 AdminPermissionGuard**——两个 POST 只挂 `AuthGuard('jwt')`（登录即可用），status 无守卫。原文「照 admin demo 控制器门径 route() 登记」在查实角色绑定后推翻：同事按 `colleague-message.txt` 用 Quick Login 在 7 个角色间随意切换，而现有 DEMO_* 权限组都是单角色绑定（DEMO_VERDICT_WRITE→合规、DEMO_CLOCK_WRITE→金库），任何权限组绑定都会让部分角色按不了还原按钮，与定案「登录即可用」矛盾；绑全部角色则要动 10+ 处角色绑定清单，为一个反特性买单。且舞台机械进权限目录会污染 RBAC 演示本身（action-bucket 目录冒出与业务无关条目）。`rules/backend.md` 第 45 行「新增 admin 端点必须登记」的立法目的是防 AdminPermissionGuard 的 403 陷阱——本控制器不挂该 guard，陷阱不存在；rules 与总纲冲突以总纲为准，总纲 §2 禁做「管理 API 权限加固」。

## 4. 前端 · Demo Data 面板

- **入口**：`DashboardLayout` 顶栏 Simulation 开关旁；仅当 Simulation 开启 **且** `GET /demo-ops/status` 可达（非 404）时显示「Demo Data」按钮。不进侧边栏——运维面板不混业务导航。
- **面板**（弹层）：两个按钮 + 状态区。
  - **重铺数据**：二次确认，文案说清「全部数据回到标准演示态、约 1 分钟、期间系统不可用、需重新登录」。点击后进入轮询：网络错误视为重铺中忽略；status 回到 READY 后提示完成并引导回登录页（token 已随重建的用户表失效，与现状 SSH 重铺后的体验一致）。status 出现 FAILED:步骤 则原样展示（排查走 boot.log，现状同款）。
  - **重摆对账场景**：点击后轮询 recon-break 态至 done（提示「18 个对账场景已还原」）或 fail（展示输出尾巴）。
- 文案对齐仓内英文管理台惯例（面板标题 / 按钮 / 确认文案均英文）。

## 5. 验收（演得出来 = 过）

- **本地**（DEMO_OPS=1 起主栈，仅验 UI 与 recon-break 全链）：① Simulation 关 → 无入口；开 → 入口出现；② 点重摆对账 → 轮询到 done，对账页 18 案件回到待处置开场（主栈有 demo:all 数据，前提成立）；③ 未设 DEMO_OPS 时接口 404、入口隐藏。截图为证（闸⑤）。重铺按钮本地不实按（本地无 systemd 守护，按了 = 栈死需手动拉起，属预期内不可用而非缺陷）。
- **云端**（`npm run cloud:deploy` 后实测）：④ 点重铺 → 面板显示进度 → 约 1 分钟后 READY → 重新登录 → 数据回满数据态；⑤ 手动做几笔操作 + 处置几个对账案件后点重摆对账 → 18 案件复位、手动数据仍在。
- 常规闸：三 tsc + 本任务相关 jest 目录全绿；动了前端 → 截图。

## 6. 文档收口

- `CLAUDE.md` §10 云端段补一句（同事可在管理台 Simulation → Demo Data 自助重铺 / 重摆对账）。
- `deploy/colleague-message.txt` 同步：告诉同事两个按钮是什么、什么时候按哪个。
- `decisions.md`：定案 ①②（只云端 / 满数据态、demo:all 不单设按钮，防后人重提三按钮）。
- 收尾对照 `doc-final/rules/delivery-checklist.md`。

## 7. 风险与边界（知情即可，不做处理）

- 重铺期间其他同事若正在使用会被打断——单人演示假设，面板确认文案已提示。
- recon-break 运行中（十余秒）用户手动刷新页面丢轮询——重进面板看 status 即可。
- 重铺后 boot.log 被覆写、上一轮日志只在 journal——现状同款。
