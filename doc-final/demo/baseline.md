# 基线（Phase 4 收官重钉）

> 钉定时点：2026-09-01 ｜ 代码基准：三支合流后的 main ｜ 环境：main 栈经 `db:base:sync` → 重启 → `verify:rbac` → `stack.sh reset main` → `up` 后实测
> **判据铁律：一切验证以「全绿」为准。** 2026-08-31 环境收口把红名单清零后，判据从
> 「净新失败 = 0」（相对，需人工比对上一轮数字）升级为「全绿」（绝对，机器可判：
> `npx jest` 退出码 0）。**任何红都是事故**，没有"这条是旧账"的退路；真有一时修不了的，
> 须当场决定修或由业主正式豁免并记入 `TOOLING-DEBT.md`，不得默留。
> 重钉纪律：只在业主批准的行为变化后重钉；每次重钉记 CHANGELOG 一行。
> 重钉历史：2026-08-26 Step 0 首钉（7c53afd4）→ 2026-08-27 Phase 4 收官重钉（45a4f1a8）→ 2026-09-01 三支合流重钉 → 2026-09-02 平账一期半重钉（本版：对账行 15/15→14/14 + 10/10→11/11）→ 2026-09-03 平账 B 批重钉（对账行 14/14→15/15 + 11/11→10/10）→ 2026-09-05 平账二期重钉（对账行 15/15→17/17 + 10/10→11/11）→ **2026-09-06 平账三期重钉（本版：对账行 17/17→18/18 + 11/11→12/12，break 8→9，casesOpened 11/11→12/12）**。
> **2026-09-01 三支合流后重钉（本版为当前生效基线）**：第一幕职权重划 + 环境与工具债收口 + 平账
> （调账单 / 处置动作 / 破口按成因铺全）三个分支全部并入 main，在 main 栈从零重铺后按新判据「全绿」
> 实跑通过。env-debt 于 2026-08-31 报的 `verify:coa` 负余额已定位为资本注入被静默跳过造成的假红，
> 详见下方"已结"节——**该条不再是未决项**。

## 已结：`verify:coa` 负余额 —— 根因是资本注入被静默跳过（2026-09-01 定位并销账）

**结论：不是记账 bug，是那条已登记在 `TOOLING-DEBT.md` 的工具坑造成的假红。**

2026-09-01 三支合流（第一幕 + 环境与工具债 + 平账）后在 main 栈从零重铺实跑，
**两轮独立 `verify:coa` 均全绿：57 个科目全部 ≥ 0**，两恒等式亦全过。

根因（算术即证据）：

| | AED `FIRM_ASSET` |
|---|---|
| env-debt Task 11 报的红 | **−63,647** |
| 2026-09-01 main 实测 | **+10,016,353** |
| 差额 | **10,080,000** |

`SEED_FIRM_CAPITAL.AED = '100000'`（AED decimals=2）→ 注资 **10,000,000 分**，与差额的整数部分逐位吻合；
余下 80,000 是平账那批新增 8 张素材单（Jack/Kate）带来的手续费收入。

机制：`prisma/seed.business.ts` 的 `seedCapitalInjection()` 头一句就是
`if (!tbAddress) { console.log('⚠ TB_ADDRESS not set, skipping capital injection'); return; }`
——**静默跳过、退出码仍是 0**。env-debt 在自己 worktree 的 self 栈上跑 Task 11 验收，
`.env` 未就位时 `reset` 不把 `TB_ADDRESS` 传给四个子进程，注资整笔没做，公司户从 0 起步、
付完款自然为负。**这正是该分支自己在两小时前登记进 `TOOLING-DEBT.md` 的那条坑**
（"`stack.sh reset` 在全新 worktree 首跑会静默跳过 TigerBeetle 建户与资本注入"），
当时没把两件事联系起来——因为失败点离根因很远，正是那条记录自己预言的后果。

**教训**：注资缺失表现为"账本恒等式全过、只有负余额断言红"——恒等式对**差额**成立，
不管起点是不是 0。所以负余额断言是这类"起点缺一笔"事故的**唯一**探针，不能因为
恒等式绿就放行。

**残留**：工具坑本身仍未修（在 `TOOLING-DEBT.md`，业主定本轮不修）。规避照旧：
新 worktree 先 `stack.sh up` 让 `.env` 落地，再 `reset`；或看 `reset` 输出里有没有
`✔ Capital injection: 2 transfer(s)` 这一行——没有就是踩了。


## 绿名单（全绿）

| 类 | 项 |
|---|---|
| 编译 | tsc 后端（src / test / scripts / prisma 四目录）｜ tsc 管理台（含 .spec.ts）｜ tsc 客户端 |
| 重铺 | `stack.sh reset main`（含 TigerBeetle 清理重建，全链实跑） |
| 演示 | demo:setup ｜ demo:deposit ｜ demo:swap ｜ demo:withdraw ｜ demo:in-transit ｜ demo:all（**花名册 29/29 逐条符合预期 + COA 四恒等式**——演示装备一期改判据，见下方操作约束） |
| 对账 | recon:demo:pass ｜ **recon:demo:break 18/18 场景 + 12/12 钱包桶 + `casesOpened` 完整性断言**（2026-09-06 平账三期加 18（Jack USDT-TRON 未授权转出 → 事故登记）后实测：`scenarios 18/18 DETECTED` / `wallets 12/12 bucket OK`（break 9 / softFlag 2 / inTransit 1）/ `casesOpened 12/12`，答案键 `rootCause` 用注册表成因码）｜ verify:demo-data。⚠️ **铺场前不得有在途划转**（待批 / 执行中的内部划转单会让脚本前置闸当场报错——先 ⚡ 推到确认或撤回）。⚠️ **必须走整库重铺验证**：**场景 6（重复入账）真写账本**、`recon:demo:reset` 不回滚账本，轻量重跑会让场景 6 假性 MISSED（显示 17/18）|
| 账本 | verify:coa —— 两恒等式 + 负余额断言（49 科目全部 ≥ 0）。收官多轮实测重铺后与 demo:all 后均全绿；历史上个别含 break 注入的运行轮见过公司 AED 负余额（浮存时序）。**2026-09-01 三支合流后在 main 栈两轮独立实测：57 科目全部 ≥ 0，全绿**（此前 08-31 的负余额红已定位为资本注入被跳过的假红，见上方\"已结\"节）。**2026-09-05 起注资那笔已在流水里**（种子写凭证 + 两行流水），运营户对账起点为正 |
| 审计 | verify:audit 恒绿七项：Q2 按单据查 ｜ Q4 按客户查 ｜ 不变量①②③（PRIMARY 至多一 / INHERIT 必有旅程号 / 退役码零写入）——三查合同七站换装后的固定资产 |
| 封册 | audit-vocabulary-closure.spec 四条：平面表归籍 / 六册互斥 / 写点闭合退役词零引用 / 码全局唯一禁裸名 |
| 单测 | `npx jest` **全绿**（**163 套 / 2067 例通过 + 2 skipped + 4 todo，退出码 0——2026-09-02 平账一期半 Task 12 实测**。⚠️ 此前记的"156 套 / 2026-08-31 实测"在 2026-09-01 之后有一段时间是**过期依据**：`c7bc7e3f` 改了单号随机位宽（4→6 位）但只跑了工具自己的新 spec，`no-generator.util.spec.ts` 那条「1000 次不撞号」按生日问题约 39% 必红，另有两处 `\d{10}` 位宽断言没跟着改——三处已于 2026-09-02 修好，本行数字即当次实测）｜ `npm run test:client`（vitest 4 套 83 例） |
| 栈 | `bash scripts/stack-env.test.sh`（`ensure_env_files` 权威重写的 11 项断言） |

> 💡 **A 批（账龄线 + 公司池核销）在 worktree 内验证走自己的栈**：`bash scripts/stack.sh reset self` → `bash scripts/stack.sh up self` → `bash scripts/on-stack.sh self demo:all`（与 main 栈 `reset main` → `up main` 同构，仅栈名不同；worktree 内不得碰 main 栈，见 CLAUDE.md §10）。`recon:demo:break` 的检出判据现为 **18/18 场景 + 12/12 钱包桶**（2026-09-06 平账三期加场景 18 后的现行值；二期为 17/17 + 11/11，A 批当时为 15/15 + 10/10）——账龄与核销只改变案子「能不能平」，不改变检出与分桶。

> 💡 **严重度分级按币种拆线（波五 T5，2026-09-21 起生效）**：`computeSeverity(currency, delta)` 改按 `recon-thresholds.constant.ts` 的 `SEVERITY_LINES_MINOR` 索引——AED `med=10,000n`(100.00 AED) / `high=1,000,000n`(10,000.00 AED)，USDT `med=30,000,000n`(30 USDT) / `high=3,000,000,000n`(3,000 USDT)，锚定既有小额线 100 AED ↔ 30 USDT 等值惯例。种子 12 案实测分布：**AED LOW=1 / MEDIUM=4 / HIGH=1**，**USDT LOW=5 / MEDIUM=1 / HIGH=0**（均未全塌单档，未触发整体下移，系数 ×1；取数过程见 `superpowers/checkups/2026-09-21-act6-wave5-evidence/severity-lines-decision.txt`）。案件页严重度徽章随之改变属**预期行为变化**——波前/波后截图对照见同一物证目录。注记为取数轮参考值，随铺场时刻可有 ±1 案跨币种漂移（2026-09-21 T11 铺场恰跨迪拜零点前 58 秒实测到一例）。

> 🔴 **V3 波一合并到 main 之后，第一次重铺前必须先 `rm -f /tmp/exchange_js_main/dev.db`——否则 `stack.sh reset main` 会中途失败。** 迁移 `20260903125954_v3w1_wallet_address_rows` 走 SQLite 建新表再 `INSERT…SELECT` 的模式，而新表的 `vaultCode` / `network` 是 NOT NULL、老 `wallets` 行没有这两列的值（Prisma 自己在该文件第 10–11 行就警告过「表非空则不可能」）。`apply-local-migrations.sh` 是**就地**升级现有库、`set -euo pipefail` + 事务，`db:biz:reset` 排在迁移之后、根本走不到。main 上现有 19 行 wallet，实测在隔离副本上复现：`NOT NULL constraint failed: new_wallets.vaultCode`，退出码 1；同一副本先清空 wallets 再跑则退出码 0（对照组）。按 §3「数据随时可重铺、不写兼容层」，正解是删库重建、不是给迁移打补丁。
> 同一个 `rm` 顺带解决第二个合并后必红：`scripts/reset-business-data.ts` 不清 `audit_log_events`，而 main 的审计表里已有 5 行携带本波新退役的码（`ASSET_ACTIVATED` / `ASSET_ACTIVATION_REQUESTED` / `ASSET_CREATED_AND_PROVISIONED` / `CUSTODIAN_WALLET_CREATED` / `CUSTODIAN_WALLET_CREATE_REQUESTED`），不删库的话 `verify:audit` 不变量③「退役码零写入」会在 main 上恒红。**一条 `rm`，两个问题**（2026-09-04 波一终审实证，含对照组）。

> ⚠️ **重铺前必须先 `stack.sh down <栈>` 停栈，否则 TigerBeetle 清不掉。** `reset-stack.sh` 的 `rm -f` 对运行中进程持有的文件只是 unlink，旧 tigerbeetle 仍在旧 inode 上服务 → SQLite 重铺了、TB 没有 → 客户 UUID 全新使 `CLIENT_PAYABLE` 读 0 而 SYSTEM 口径 `CLIENT_ASSET` 留旧余额（恒等式假红），多轮提现累积还会把公司 AED 打成负数（负余额假红）。2026-08-28 平账一期实测定位——正确顺序：`down` → `reset` → `up`。⚠️ `stack.sh reset` 自己会拉起 TigerBeetle，`up` 之前要先把它 kill 掉，否则 `up` 在 TB 端口上撞车。

> 💡 **`verify:coa` 建议在 `test:e2e recon-adjustment-money-arcs` 之后再跑一次。** 调账单的四种分录组合里，`FIRM`+`REDUCE`（银行杂费）与 `FIRM`+`INCREASE`（银行利息）**只有这支 e2e 会真落账**——`demo:all` 不碰调账。在 e2e 之后跑 `verify:coa`，四种组合各自落账后的恒等式与负余额就都被覆盖了。2026-08-28 实测：e2e 后 ALL INVARIANTS PASS。

## demo:all 操作约束（演示装备一期，2026-08-29 起）

`demo:all` 的判据从「8 场景全 SUCCESS」改成了「花名册 29 笔逐条比对预期终态 + COA 四恒等式」——一份丰富的演示数据本来就该有冻结的、没收的、退回的、上缴的、卡在半路的，不是清一色 SUCCESS（详见 `data.md`）。

**由此带出一条硬约束：`demo:all` 必须在全新库上跑，不能在同一个库上连跑两次。** 花名册第 #7/#10/#13 行故意把第四人设 FRANK 造成一个**永久被制裁**的客户（customer-level ALL-scope 限制，本仓库没有任何流程会解开它——这也是刻意的，交易三人组 Alice/Bob/Grace 必须全程可交易，冻结这个不可逆动作只能落在专门"报废"的第四个人身上）。第二次在同一个库上跑 `demo:all`，L1 会（正确地）拒绝 FRANK 的新充值，`runFrankPreStage` 因此卡住直到超时——**这是闸门在正确工作，不是 bug**。正确姿势：`bash scripts/stack.sh reset [main|self]` 重铺出全新库后再跑一次。

> 💡 **`demo:all` 打印的那四个 COA 恒等数值会随花名册变化，数字变了不等于账错了。**
> `verify:coa` 与 `demo:all` 验的都是**等式两边相等**，不验具体数值——所以花名册加了行、
> 客户多了两个之后，这四个数必然变，这是正常的。
> ⚠️ 它们会落在 `doc-final/demo/data.md` 的 `<!-- GENERATED:BEGIN -->` 区块里，
> **那段是 `demo:all` 收尾自己写的，不要手改**——手改会被下一次 `demo:all` 整段覆盖，白费。

> ⚠️ **`recon:demo:break` 的场景 6（重复入账）会写账本**，是 17 条里唯一一条（重编号前是 ⑦）。它用固定 sourceNo 保证重跑幂等（TB 判为已存在直接跳过），但 **`recon:demo:reset` 不回滚账本**——它只清外部数据与 WALLET_V1 的 run/case。要把账本也归零，走 `stack.sh reset [main|self]`（含 TigerBeetle 重建）。

## verify:rbac 操作约束（第一幕职权重划，2026-08-30 起）

`npm run verify:rbac` **会写数据**——V2 判据对 10 个内建角色各跑一次真实的「改角色定义→审批」往返，每轮留 10 张角色修改审批单；V3 判据用一次真实的 CFO 建费率等级请求当燃料，每轮留 1 条费率等级 + 1 张审批单。这些记录的 markup 均为 999999bps、**永不被真实报价选中**（`resolveBestLevel()` 恒选最便宜档，无害），但**第一幕站 2 正是打开费率页改一档**——观众会看到大半是探针行，踩评审判据②「显示的内容错了」。实测：跑完 4 轮后费率等级从 2 条（`STD-AED-USDT`/`STD-USDT-AED`）涨到 **8 条**。

**裁决**：不给脚本加清理逻辑（费率等级是受治理对象、本无删除端点，造一个属扩范围）。改为**钉死运行顺序**——

`verify:rbac` → `verify:act1` → `stack.sh reset [main|self]` → `demo:all`

重铺会把探针痕迹一并冲掉：实测重铺后费率等级从 8 条回落到 **2 条**。**`verify:rbac` / `verify:act1` 绝不能在演示前跑**，必须排在重铺之前；`demo:all` 的收尾闸判据（花名册 21/21 + COA 四恒等式）与本条对同一份"全新库"负责，三条约束并列、不可颠倒顺序。

## verify:act1 操作约束（四模块治愈 · 判据收口，2026-09-02 起）

`npm run verify:act1`（24 条行为判据：B0–B14〈无 B13，2026-09-06 随材料管理路由族退役摘除〉+ 波二新增 V1–V10，见 `scripts/verify-act1.ts`）**会写数据**——每轮实测留下：

- 3 张 `VERIFY_ACT1_TIMEOUT_PROBE` / `VERIFY_ACT1_KEY_PROBE` 探针审批单（B0–B5 夹具，其中一张真被 cron 判 `EXPIRED`，其余永久停在 `PENDING`——没有对应正门能推它们往前走，纯探针留档）
- 1 个 `ADM-ACT1-B6-*` 探针成员 + 1 个 `WA-ACT1-B6-*` 探针钱包（B6，静态数据，无副作用）
- 1 张 `DEPOSIT_SEIZE` 形状的两步审批单（B9/B14 共用夹具，`entityRef` 是占位字符串、不对应真实存款单，两票 `APPROVAL_GRANTED` 留痕后案子 `APPROVED`，`workflow.deposit-seize.decided` 的下游被 `deposit-workflow.service.ts#onSeizeDecided` 的 `NotFoundException` 分支静默吞掉，不触发任何资金动作）
- 1 个 `VERIFY_ACT1_ROLE_*` 探针角色 + 1 张已 `REJECTED` 的角色定义修改申请单（B10）
- 1 个 `ADM-ACT1-B12-*` 探针成员（B12，全程 `ACTIVE`，reactivate 被拒不改变状态）
- 若干条 `ADMIN_ACCESS_DENIED` 审计行（B11 打 `/admin/reconciliation/runs/wallet`，actorNo 均为 `auditor@` 的 ADM 号）

以上记录均带 `verify-act1` / `ACT1-*` 前缀或探针专属 actionType，不进任何真实报价/风控/推单路径，**但会在角色页、审批中心列表里以探针行形式可见**——同 `verify:rbac` 的风险，一并交给同一条重铺约束收口，不单独加清理逻辑。

**B13（收编生效，业主裁决5，Task 24）已于 2026-09-06 随材料管理路由族整体退役摘除**（路由 `/admin/material-management/holdings/:id/simulate-stage` 已删，判据主体不存在）——历史上 B13 依赖库里存在至少一条真实 `CustomerMaterialHolding`、缺失时自动 SKIP 的机制随之一并退役，不再出现在判据编号或计数里。

**裁决**：与 `verify:rbac` 同一条运行顺序——`verify:rbac` → `verify:act1` → `stack.sh reset [main|self]` → `demo:all`，重铺把探针痕迹一并冲掉。

**波一起**：B6 夹具按 (vaultCode, network, ownerNo) 建平台行、B7 改为对 ACTIVE 资产提恢复（运营 token）→ 409。

**波二起（2026-09-05）**：新增 **V1–V10** 共 10 条（资产暂停 L1 十项硬门在兑换 / 提现两域的 BLOCK 行为、充值域挂起证据链、提现地址登记 actor 与四道拒绝门之一、VIP 客户报价预览价=确认价、按资产业务号取证），基数由 15 升为 25（含 B13）。V7/V8 会真注册 alice 的提现地址（逼近 `MAX_ADDRESSES_PER_NETWORK=3` 上限）——同一个库里连跑两次，第二轮的 V7/V8 会因残留地址判错，**V 组同样只能在全新库上跑一次**，跑完直接进下面的重铺，不必再单独多铺一次库；**2026-09-06 B13 摘除后基数改为 24**，实测（全新库）：**24/24 PASS**。

**改过 `rbac.catalog.ts` 就必须重启后端再跑**：本波把 TECH_OFFICER 加了 `IAM_ROLE_ASSIGN`（见 `overview.md` §4）。`verify:act1` 真登录真 HTTP，后端进程按内存里的 `RBAC_PERMISSION_DEFINITIONS` 判权限——只 `db:base:sync` 不重启后端，权限判断仍是改之前那份，`verify:act1` / `verify:rbac` 都会读到假结果（不是判据本身错，是跑的时候后端还没换脑子）。

## 红名单 —— 已于 2026-08-31 清零并退役

原有 4 条，实为四种互不相干的成因，被"净新失败 0"的判据一并豁免了最久 64 天：

| 原条目 | 真实成因 | 处置 |
|---|---|---|
| `role-definition-create-workflow.service.spec.ts` | Node 18 缺 `globalThis.crypto` | Node 20 归一后自动转绿，零代码改动 |
| `system-wallet.util.spec.ts` | 断言仍期望 790a6685 退役的 `C_MAIN`/`C_OUT` | 改断言（代码是对的），并补三个退役角色的反向断言 |
| `wallets.service.spec.ts` | 同上 | fixture 换成仍受保护的 `F_LIQ` |
| `client-web/.../restrictedCapabilities.spec.ts` | vitest 文件被 jest 捡起 | `client-web/src` 从 jest `roots` 摘除；vitest 下本来就 83/83 全绿 |

**此后本节不再接受新条目。** 工具/环境类的已知问题去 `doc-final/TOOLING-DEBT.md`。

## verify:audit 两项已知波动（非红名单条目，不受本次判据升级影响）

`verify:audit` 恒绿七项之外，另有两项检查按设计随 demo 运行窗口 / 审计页查看状态波动，红绿皆属预期——不是尚待清零的旧账，也不属于上面已退役的红名单，判据升级为「全绿」不要求把它们锁死为绿：

```
Q5 拒绝有痕 ｜ V1 词表已被使用：取决于 demo 运行窗口内是否触发重复制裁命中 /
  治理动作，红绿都属正常（收官同一天两轮实测一红一绿）
Q6 谁查过审计日志：重铺后恒红，管理员真查一次审计页当场转绿（活体已证）——
  演示剧本第七幕含此动作，正式走查时自然绿
```

## e2e（单独口径，收官起入基线）

> ⚠️ **2026-10-03 起本节口径在本机不可复现**——审批事件监听器数超过 e2e 文件里的 `setMaxListeners(50)`，起 `AppModule` 即抛，详见 `TOOLING-DEBT.md` 同日条目与本文末「同日订正（e2e 口径）」；下文三要素与 83/83 是收官当时（Node 与监听器数更少时）的实测，修好前不得援引为现状。

全量 11 套件 **83/83**（收官在 main 实测）。跑法三要素，缺一必假红：

1. **私库先铺**：六个自带独立库的套件（kyt-verdict-landing / sanction-subject-split / deposit-sumsub-verdicts / material-requests / customer-restrictions / sla）在每次 `stack.sh reset` 后库被清空，须逐库 `DATABASE_URL=file:/tmp/exchange_js_main/<e2e-库名>.db` 依次 `prisma migrate deploy` + `db:base:sync` + `db:biz:init`；
2. **串行跑**：`bash scripts/on-stack.sh main test:e2e --runInBand <下列 11 个文件>`（**不要**在文件列表前多写 `--`，会被 jest 当路径模式吞掉 runInBand）；并行会互踩栈库出假红。**这 11 个就是基线口径的全集，逐字写在这里**（2026-09-04 补：此前这里只写「11 个文件」四个字、正文只点名了自带私库的 6 个，另外 5 个从没落过纸，波一收尾时只能靠 `git log --diff-filter=A` 的加入日期对着 CHANGELOG「45a4f1a8 e2e 11 套 83/83 首次入基线」那条考据出来——闸门的定义必须自己写得清，不能靠考据）：

```
test/deposit-money-arcs.e2e-spec.ts          # 共用 dev.db
test/withdraw-money-arcs.e2e-spec.ts         # 共用 dev.db
test/swap-money-arc.e2e-spec.ts              # 共用 dev.db
test/deposit-sumsub-verdicts.e2e-spec.ts     # 私库
test/withdraw-sumsub-scenarios.e2e-spec.ts   # 共用 dev.db
test/swap-sumsub-scenarios.e2e-spec.ts       # 共用 dev.db
test/kyt-verdict-landing.e2e-spec.ts         # 私库
test/sanction-subject-split.e2e-spec.ts      # 私库
test/material-requests.e2e-spec.ts           # 私库
test/customer-restrictions.e2e-spec.ts       # 私库
test/sla.e2e-spec.ts                         # 私库
```

   **recon 组另列，不入上面 83/83 的口径**（五份，全部共用 `dev.db`，跑前先 `demo:setup`；2026-09-05 平账二期实测五份 26/26）：`test/recon-adjustment-money-arcs.e2e-spec.ts`、`test/recon-aging-write-off.e2e-spec.ts`、`test/recon-reattribution.e2e-spec.ts`、`test/recon-supplement.e2e-spec.ts`、`test/recon-internal-transfer.e2e-spec.ts`（最后这份截止用「现在」，不跨 UTC 零点跑）。跑法：`bash scripts/on-stack.sh <stack> test:e2e test/recon-`。

3. **干净态起跑**：栈库残留多轮数据会触发日累计限额假红；`reset` + 重铺私库后一次跑完。
4. **共用库那 5 个还要先 `demo:setup`**（2026-09-04 波一收尾实测补）：裸 `reset` 只铺业务种子，建出客户花名册但**一条客户钱包行都没有**；5 个共用 `dev.db` 的套件里有 4 个自带 `ensureCustomerWallet` 自助开钱包，`deposit-money-arcs` 没有，缺钱包时直接抛 `"...has no ACTIVE C_VIBAN wallet on AED_ZAND — run demo:setup first"`。所以 `reset` 之后、跑 e2e 之前要补一句 `bash scripts/on-stack.sh <stack> demo:setup`。**它不等于 `demo:all`**：`demo:setup` 只跑 `ensureSetup`（铺钱包与地址），不跑 `runFrankPreStage`（广播制裁那步），所以不会把 `demo_frank` 连坐冻结、不违反上面 💡 那条「`demo:all` 不能与 e2e 共用同一个库」。实测确认：`demo:setup` 后 `demo_frank` 的 `customer_restrictions` 行数为 0。

> 💡 **`demo:all` 不能与 e2e 共用同一个库——`withdraw-money-arcs` × `demo_frank` 是实测坐实的一例。** 该 spec 的夹具客户 `demo_frank@example.com` 会被 `demo:all` 花名册 #7 行的广播制裁连坐永久冻结（`CAPABILITY_RESTRICTED`）；若在跑过 `demo:all` 的同一个库上接着跑 `withdraw-money-arcs.e2e-spec.ts`，7 个场景会全部卡在 `CustomerAccessService.assertCapability` 抛 `ForbiddenException`——这正是上面第 3 条「干净态起跑」的具体反例，不是 suite 本身的缺陷。2026-09-03 V3 波一 Task 6 修复轮在干净库上复测：`withdraw-money-arcs` 7/7 全绿。不改夹具客户，按三要素跑即可。

~~已知 flake：`fundsOrderNo` 撞号（P2002）~~ → **2026-09-01 已修，本条销账**：
根因是熵不够——`generateReferenceNo()` 原为 前缀+`YYMMDD`+`Math.random()*10000`，同一天同一前缀只有 1 万个坑，一次 `demo:all` 造几十张资金单按生日问题约 **7–20%** 撞（当天连撞两次实测）。
业主 2026-09-01 定：改用 `randomUUID` 取 **6 位**（100 万个坑，同量级撞号率降到约 0.2%）。加守则性单测 `no-generator.util.spec.ts` 锁住位宽。⚠️ 其中「1000 次不撞号」那条原写 `expect(seen.size).toBe(1000)`，**本身是自相矛盾的**——6 位随机抽 1000 次，按生日问题碰撞期望 λ≈0.5，「一次不撞」概率仅 e^(−0.5)≈61%，即约 39% 会随机变红。2026-09-02（Task 12，业主裁定「改断言」）改为对碰撞数设上界 ≤8：6 位下假阳性率约 6×10⁻⁸，4 位下碰撞约 48 必然超界——判别力不变、不再 flaky。实测 200 轮：6 位均值 0.42/最大 3，4 位均值 49.19/200 轮全部超界；该 spec 连跑 5 次全绿。实测：修复后连续 2 轮重铺 + `demo:all` 全过。`buildDeterministicNo`（种子幂等靠它）刻意不动。

## 2026-08-31 环境收口验收 —— 终审后复测：11/11 全过

首次验收报 10/11（`verify:coa` 负余额两项 FAIL），并归因为"并入 main 那 39 个提交引入的记账回归"。
**这个归因是错的**，终审补正：

- **真因仍是孤儿 TigerBeetle。** `reset-stack.sh:31` 把 `load_stack_config` 解析后的 `${STACK}`
  （self 栈是 `wt_<名>`）传给只认 `main|self` 的 `stack-stop.sh`，整个停止链一行没跑；
  而 `reset-stack.sh` 又没有 `ensure_port_free` 兜底。于是 `reset self` 留下抱着已 unlink
  旧文件的旧 TB，`demo:all` 写进了带着上一轮全部转账的账本 —— 负余额由此而来。
- 归因当时做的核查是"本分支的记账代码与 main 逐字节相同"（这条独立成立），
  但**同时接受了"两轮数字一致 ⇒ 确定性"**，而那两轮共用同一个坏掉的 reset。
  **控制变量之前不下结论** —— 这是本仓库最高频的失误形态，本轮又栽了一次。
- 参数改传原始入参后实测：起栈 → reset，TB pid 真的换了（65714→66004），
  磁盘 inode 与进程持有的 inode 一致；`demo:all` 花名册 **21/21** + COA **5/5 PASS**；
  `verify:coa` 四恒等式全过 + **负余额检查通过（49 个科目全部 ≥ 0）**，`FIRM(AED) = 9936353`
  —— 与合并前的数字一致。

**结论：11 条判据全过。此前记录的"main 记账回归"不存在，特此撤销。**

## 战役甲波四合规办公室三表种子断言（reset 判据，2026-09-27 Task 7 起）

`bash scripts/stack.sh reset self` 从零建库重铺后（`seedBusiness()` 随 `db:seed:business` 落地，先于 `demo:all`），三张新表应各自恰好这些行，连跑两次 reset 结果逐字一致（`obligationNo`/`vendorNo`/`riNo` 用 `buildDeterministicNo` 派生，`upsert` 保幂等；已实测两轮独立 reset 数字完全相同）：

| 表 | 行数 | 关键行 |
|---|---|---|
| `compliance_obligations` | **3** | `OBL2601015484`（MONTHLY/VARA/ACTIVE）／`OBL2601011955`（QUARTERLY/VARA/ACTIVE）／`OBL2601017307`（ANNUAL/VARA/ACTIVE） |
| `outsourcing_vendors` | **3** | `VEN2601019644`（Sumsub/MATERIAL/ACTIVE）／`VEN2601017083`（HexTrust/MATERIAL/ACTIVE）／`VEN2601019912`（Gulf Office Systems/NON_MATERIAL/ACTIVE） |
| `responsible_individuals` | **4** | `RI2601011344`（MLRO）／`RI2601013891`（Compliance Officer）／`RI2601015148`（CFO）／`RI2601019215`（CISO），均 `status=ACTIVE`、`pendingApprovalNo=NULL` |

**闹钟墙开箱判据（Ruling R2 核实结论）**：重铺后 `regulatory_filings` 里已有 3 行落在 `FILING_CLOCK_WALL_STATUSES`（DRAFT/PENDING_SIGNOFF/SIGNED_OFF 且 `deadlineAt` 非空）——`FIL2601010266`（`INFO_REQUEST_RESPONSE`/DRAFT，波二种子）、`FIL2601012321`（`PNMR`/DRAFT，波三种子）、`FIL2601013167`（`INCIDENT_REPORT`/SIGNED_OFF，波二种子），叠加 `compliance_obligations` 三行（`status=ACTIVE` 恒上墙）——闹钟墙聚合端点开箱即非空、且已有 `DRAFT` 态带钟报送单在墙上，无需本任务再补报送单样例。

⚠️ **已发现并修复的重铺闸缺口**：`scripts/reset-business-data.ts` 的 FK-safe 清单原漏登记这三张新表（与 2026-09-26 战役甲波二 T10 补登记 `regulatoryFiling` 那次同款遗漏形态——见该脚本对应注释），导致 `verify:rbac` 的 `OBLIGATION`/`RI` 探针夹具在 `reset self` 后原样留存（首次重铺实测多出 3 条 `OBL260927*` 探针义务行 + 3 条 `RI260927*` 探针席位行）。已在本任务补登记三行 `deleteManyIfDelegateExists`，修复后连跑两次 reset 行数稳定为上表的 3/3/4，不再随 `verify:rbac` 是否跑过而漂移。

**实测口径**：`bash scripts/stack.sh reset self` → 全绿（无失败步骤，`verify:demo-data ALL PASS`）→ `bash scripts/on-stack.sh self demo:all` → 花名册 29/29 + COA 4/4 恒等式全过、`data.md` 生成区零 diff → `bash scripts/on-stack.sh self verify:rbac` → 新增判据（合规办公室四组门 / 合规义务写权 / ⚡拨钟唯金库 / RI 换人审批链）全绿，仅剩两条与本任务无关的既有红（`S7 catalog 字典真实性`——`TOOLING-DEBT.md` 已登记的三域 demo 裁决按钮扫描器盲区；`V2 改角色不丢权限 · COMPLIANCE_OFFICER`——`BACKLOG.md` 已登记的 `CUSTOMER_WRITE` 孤儿权限组），红集与波前基线恒等、无新增。

## 战役甲波五投诉种子断言（reset 判据，2026-09-28 Task 7 起）

`bash scripts/stack.sh reset self` 从零建库重铺后（`seedBusiness()` 随 `db:seed:business` 落地，`seedComplaints()` 紧随 `seedResponsibleIndividuals()` 之后），两张新表应各自恰好这些行，连跑两次 reset 结果逐字一致（`complaintNo` 用 `buildDeterministicNo('CMP', seedKey)` 派生，幂等重铺先删 entries 再删 complaint；已实测两轮独立 reset 数字与单号完全相同）：

| 表 | 行数 | 关键行 |
|---|---|---|
| `complaints` | **3** | `CMP2601014294`（FEES/RECEIVED，Bob，submittedAt=铺场−1天，零 entries）／`CMP2601017476`（SERVICE/INVESTIGATING，Bob，submittedAt=铺场−26天，`acknowledgedAt` 非空，1 条 entry）／`CMP2601012261`（ORDER_EXECUTION/RESOLVED，Bob，submittedAt=铺场−40天，`extendedAt`/`resolvedAt`/`resolutionOutcome=PARTIALLY_UPHELD` 均非空，4 条 entries） |
| `complaint_entries` | **5** | `CMP2601017476` 1 条（CLIENT_MESSAGE/ACK）；`CMP2601012261` 4 条（CLIENT_MESSAGE/ACK → INTERNAL_NOTE → CLIENT_MESSAGE/EXTENSION_NOTICE → CLIENT_MESSAGE/FINAL_RESPONSE，`createdAt` 严格递增）；`CMP2601014294` 零条 |

**实测口径**：`bash scripts/stack.sh reset self` → 全绿（`verify:demo-data ALL PASS`）→ 直查库：3 complaints / 5 entries，字段与上表逐字相符 → 再次 `reset self` → `complaintNo` 三个值逐字不变（`CMP2601012261`/`CMP2601014294`/`CMP2601017476`），行数仍 3/5 → `bash scripts/on-stack.sh self demo:all`（demo:all 不碰投诉两表）→ 花名册 29/29 + COA 4/4 恒等式全过，`data.md` 生成区零 diff（生成区只收录 DEPOSIT/SWAP/WITHDRAW 花名册 + COA 恒等式，`renderDataMdSnapshot()` 不涉投诉表，本任务未改 `scripts/demo-data-md.ts`）→ `npx tsc --noEmit -p tsconfig.json` 全绿 → `DATABASE_URL=file:/tmp/exchange_js_wt_act_a_wave5/dev.db npx jest src/modules/governance/complaints --silent`：**5 套件 / 58 例全绿**。

⚠️ **环境闸口已知缺口（与本任务无关，未修）**：`admin-web/node_modules` 在本 worktree 为空目录（0 个包），`npx tsc -b --noEmit`/`vite` 均不可执行——`stack.sh up self` 因此起不来 admin 前端（backend 仍正常起、demo:all 走后端直调不受影响）。本任务未改动任何 `admin-web`/`client-web` 文件，`client-web` 侧 `npx tsc -b --noEmit` 已单独实测通过；`admin-web` 侧的 tsc 门槛本任务未能过（环境缺口，非代码红），建议下一次涉及 admin-web 的任务先 `cd admin-web && npm install` 补齐。

## 战役乙波一 LP 地基种子断言 + F_LIQ/F_OPS 余额判据 + F_LIQ 对账直比判据（reset 判据，2026-09-29 Task 9 起，评审修复轮 R15/R16 订正）

`bash scripts/stack.sh reset self` 从零建库重铺后（`seedLpDesk()` 随 `db:seed:business` 落地，紧随 `seedCapitalInjection()` 之后），下列表应各自恰好这些行，连跑两次 reset 结果逐字一致（`lpNo`/`exchangeNo`/`approvalNo`/`fundsOrderNo` 均用 `buildDeterministicNo` 派生，`upsert` 保幂等；已实测两轮独立 reset 数字完全相同）：

| 表 | 行数 | 关键行 |
|---|---|---|
| `liquidity_providers` | **2** | `LPP2601010183`（Falcon Liquidity FZE，ACTIVE，`approvalNo=APR2601015507`）／`LPP2601017193`（Dune OTC DMCC，SUSPENDED，无 approvalNo） |
| `lp_exchanges` | **1** | `LPX2601016429`（挂 Falcon，卖 50,000 AED 买 13,600 USDT，SUCCESS，`approvalNo=APR2601015999`） |
| `funds_orders`（`lpExchangeId` 非空） | **3** | `FDO2601017173`（腿1卖出，AED 50,000，CLEARED，`referenceNo=ZB20260101043095EE71`）／`FDO2601017269`（腿2买入，USDT 13,600，CLEARED，`txHash=0x2000fe...`）／`FDO2601015607`（腿3验收，USDT 13,600，CLEARED，`txHash=0x50ac04...`） |
| `tb_transfer_evidence`（`sourceType='LP_EXCHANGE'`） | **3** | 84/85/86 各一条，`sourceNo=LPX2601016429` |
| `account_flows`（`sourceType='LP_EXCHANGE'`） | **6** | 三腿各 2 行（debit→OUT / credit→IN），逐行对齐 `AccountFlowProjectorService` 的真实投影行为——**这是「六行回单」在库里的实际形态**；托管回单（`external_statement_lines`/`external_balances`）不预铺，见下方 F_LIQ 对账直比判据 |
| `approval_cases`（`approvalNo` 属本任务两值） | **2** | `APR2601015507`（`LP_PROFILE_APPROVAL`，entityRef=`LPP2601010183`，APPROVED）／`APR2601015999`（`LP_EXCHANGE_APPROVAL`，entityRef=`LPX2601016429`，APPROVED）——评审 R15 补种，替换此前无案背书的占位号 |
| `approval_steps`（属上两案） | **2** | 各一条 stepNo=1，status=APPROVED，`decidedByRole=CFO`，`decidedByUserNo=ADM2501010010` |

**F_LIQ/F_OPS 余额判据**（原「F_LIQ 直比判据」改名——**它是 TigerBeetle 余额直读，不是对账引擎判据**；reset 后、`demo:all` 之前的独立实测，不受花名册流水影响；**乙波二 Task 9 起 F_OPS(AED) 判据改口径**，见下方新判据）：`ledger=1(AED) code=203(E.FIRM_LIQ) balance=0` ／ `ledger=2(USDT) code=203(E.FIRM_LIQ) balance=0`（85 进 86 出，净 0）；~~`ledger=1 code=200(E.FIRM_OPS) balance=95000000`（= 注资起点 100,000,000 分 − 腿1 5,000,000 分 = 950,000.00 AED，**F_OPS(AED) 减 5 万**）~~ → **`ledger=1 code=200(E.FIRM_OPS) balance=94750000`**（= LP 卖出腿后 95,000,000 分 − PAY 历史单码 87 2,500.00 AED（250,000 分）= 947,500.00 AED，**F_OPS(AED) 再减 2,500**——见下方「乙波二种子断言」节）；`ledger=2 code=200(E.FIRM_OPS) balance=113600000000`（= 注资起点 100,000,000,000 分 + 腿3 13,600,000,000 分 = 113,600.000000 USDT，**F_OPS(USDT) 加 1.36 万，本任务不动**）——四项与 spec/plan 的期望值逐位吻合。

**F_LIQ 对账直比判据（新增，评审 R16）**——真正走对账引擎（`WalletReconRunService`，非 TB 直读）验证这笔历史单的账实一致，`reset self` → `up self` → `demo:all` 之后跑：

- `bash scripts/on-stack.sh self recon:demo:pass`：F_LIQ(USDT) 钱包（`walletRef=c1191e9f-81c3-42cc-9551-a57c1b0db2f5`）**在检查范围内**（19 个受检钱包之一，`internal=0 lines=2 coa=E.FIRM_LIQ`），`reconciliation_run_wallets` 表直查该行 `bucket=MATCHED matchedCount=2 orphanInternal=0 orphanExternal=0 mismatchCount=0`——**两行流水（腿2 IN + 腿3 OUT）配对成功，零孤儿零错配**；整体 `status=PASS walletsChecked=19 casesOpened=0`，五条 pass-mode 断言（`status==PASS`/`casesOpened==0`/`orphanInternal==0`/`orphanExternal==0`/`mismatch==0`）全 OK。**这就是 spec §8 承诺的"重铺后对账全绿的活证据"**——回单本身不预铺，靠 `recon:demo` 把 `account_flows` 镜像成外部对账单再判过（`simulated-custodian-statement.service.ts` 头注释所述机制），F_LIQ 是这套机制第一次真正吃进一笔 LP 兑换单流水的实证。
- `bash scripts/on-stack.sh self recon:demo:break`：18 个破口场景 `scenarios: 18/18 DETECTED`，`wallets: 12/12 bucket OK`，`casesOpened 12/12`，两条身份恒等式 OK——LP 两笔历史流水（F_LIQ/F_OPS）不在这 18 个注入场景名单内，不干扰既有判据。

**reset 登记表缺口顺带补齐**（Task 9 Step 2）：`scripts/reset-business-data.ts` 的 `BUSINESS_DELEGATES_FK_SAFE` 补 `lpExchange`/`liquidityProvider`（排在 `asset` 之前，`lpExchange` 排在 `liquidityProvider` 之前）；核实 T7 修主张的「`approvalCase`/`approvalStep` 也缺席清单」为真（该两表从建库起就不在清单里，DB 层 `approval_steps → approval_cases` 雖有 `ON DELETE CASCADE`，但从未有任何脚本对 `approval_cases` 本身发起过删除，此前全靠各主体表级联"看起来清了"），已一并补齐两行（`approvalStep` 在 `approvalCase` 之前）。首次实测坐实缺口存在：第一轮 `reset self` 的清理阶段打印 `Deleted 4 from approvalStep` / `Deleted 4 from approvalCase` / `Deleted 1 from lpExchange` / `Deleted 1 from liquidityProvider`——这些正是本任务开工前、T3/T5/T7/T8 各任务人工走查/截图验收残留在库里的探针数据，补登记前 reset 从未清过它们；第二轮 `reset self` 复测四行全部归零（`Deleted 0 from approvalStep` / `Deleted 0 from approvalCase` / `Deleted 1 from lpExchange` / `Deleted 2 from liquidityProvider`——后两个稳定在"本次种子刚写入的量"，不再是历史残留）。**已修范围仅 `approvalCase`/`approvalStep` + LP 两表**，另有四张表带 `approvalCaseId` 列未覆盖（`role` 按设计不碰、`adminRoleChangeRequest`/`approvalPolicyChangeRequest`/`roleDefinitionModifyRequest` 三张业务表本轮未补），详见 `doc-final/TOOLING-DEBT.md` 该行「已修范围/未覆盖范围」注记。

**两张 APPROVED 审批单补种（评审 R15 甲案）**：详情页 `approvalNo` 非空即渲染链接，占位号此前点进去是 `Approval not found` 死链——补种 `ApprovalCase`×2 + 各自 `ApprovalStep`（CFO 单步已批），`objectSnapshot` 逐字对齐 `lp-profile-workflow.service.ts#initiateCreate`/`lp-exchange-workflow.service.ts#initiate` 的真实快照形状（零 UUID）。**实测已点开验证**：管理台 `treasury@fiatx.com` 登录，LP Register → Falcon Liquidity FZE 详情页点 `APPROVAL: APR2601015507` → 跳到 `/admin/governance/approvals/APR2601015507`，显示 `STATUS APPROVED`／`ACTION TYPE LP_PROFILE_APPROVAL`／`Step 1 APPROVED CFO`／`DECIDED BY ADM2501010010`，非死链；LP Exchanges → LPX2601016429 详情页点 `APPROVAL: APR2601015999` → 跳到 `/admin/governance/approvals/APR2601015999`，显示 `STATUS APPROVED`／`ACTION TYPE LP_EXCHANGE_APPROVAL`／`IMPACT` 一句话叙事／`Step 1 APPROVED CFO`，非死链。

**实测口径（重铺闸全序，2026-09-29 评审修复轮）**：`bash scripts/stack.sh reset self` → 全绿（`verify:demo-data ALL PASS`，打印 `Seeded 2 LP profile rows ... + 1 APPROVED profile-registration approval case` / `Seeded 1 LP exchange (LPX2601016429, SUCCESS) + 1 APPROVED exchange approval case + 3 funds orders` / `LP exchange evidence: 3 evidence row(s) + 6 flow row(s)`）→ 直查库 `approval_cases`/`approval_steps` 两表行数与上表逐字相符 → `bash scripts/stack.sh up self` → `bash scripts/on-stack.sh self demo:all` → 花名册 29/29 + COA 4/4 恒等式全过（`COA FIRM(AED)`/`COA FIRM(USDT)` 恒等式公式已带 `FIRM_LIQ` 项，`data.md` 生成区随之改写为新数值，非代码红）→ `bash scripts/on-stack.sh self recon:demo:pass` → `status=PASS casesOpened=0`，F_LIQ(USDT) `bucket=MATCHED matchedCount=2` → `bash scripts/on-stack.sh self recon:demo:break` → `scenarios 18/18` `wallets 12/12` `casesOpened 12/12` → `bash scripts/on-stack.sh self verify:coa` → `ALL INVARIANTS PASS`（两恒等式 + 负余额检查 67 个科目全部 ≥ 0，`recon:demo:break` 场景 6 会真写账本使 `ledger 1 CLIENT` 数值较 demo:all 后变化，恒等式仍两边相等、非红）→ `npx tsc --noEmit -p tsconfig.json` + `admin-web`/`client-web` 两侧 `tsc -b --noEmit` 全绿 → `npx jest scripts/seed-audit-helper.spec.ts src/modules/asset-treasury/lp-desk src/modules/funds-orders`：9 套件/187 例全绿 → 管理台实点两个 approvalNo 链接均非死链（见上一条）。⚠️ **demo:all 前必须先 `stack.sh up self`**——`demo:all` 的 `runFrankPreStage`/`makerCheckerApprove` 走真实 HTTP 登录（`demo-mlro.ts#loginAs`），栈未起会在此处 `FATAL TypeError: fetch failed / ECONNREFUSED`；若已误跑过一次半截的 `demo:all`（Frank 已被制裁广播连坐冻结），必须先 `stack.sh reset self` 重铺出全新库才能重跑，不能在同一库上接着 `up` 后再跑（同上方"`demo:all` 必须在全新库上跑"约束）。

## 战役乙波二公司资金种子断言 + F_OPS(AED) 新判据（reset 判据，2026-09-29 Task 9 起）

`bash scripts/stack.sh reset self` 从零建库重铺后（`seedCompanyFunding()` 随 `db:seed:business` 落地，紧随 `seedLpDesk()` 之后），下列表应各自恰好这些行，连跑两次 reset 结果逐字一致（`cinNo`/`payNo`/`approvalNo`/`fundsOrderNo` 均用 `buildDeterministicNo` 派生，`upsert` 保幂等；已实测坐实）：

| 表 | 行数 | 关键行 |
|---|---|---|
| `capital_injections` | **2** | `CIN2601011488`（AED 1,000,000，SUCCESS，`approvalNo=APR2601011192`）／`CIN2601013475`（USDT 100,000，SUCCESS，`approvalNo=APR2601015426`）——壳单，复用 `seedCapitalInjection()` 已写的码 70 账，**账本零新增** |
| `vendor_payments` | **1** | `PAY2601015456`（HexTrust，AED 2,500，SUCCESS，`approvalNo=APR2601011194`） |
| `funds_orders`（`capitalInjectionId`/`vendorPaymentId` 非空） | **3** | `FDO2601018332`（CIN AED 壳单腿，CLEARED，`referenceNo=SEED-CAPITAL-AED`）／`FDO2601013407`（CIN USDT 壳单腿，CLEARED，`txHash=SEED-CAPITAL-USDT`）／`FDO2601011571`（PAY 腿，CLEARED，`referenceNo=ZB202608317AB0AB0088`） |
| `approval_cases`（`approvalNo` 属本任务三值） | **3** | `APR2601011192`（`CAPITAL_INJECTION_APPROVAL`，entityRef=`CIN2601011488`，APPROVED）／`APR2601015426`（`CAPITAL_INJECTION_APPROVAL`，entityRef=`CIN2601013475`，APPROVED）／`APR2601011194`（`VENDOR_PAYMENT_APPROVAL`，entityRef=`PAY2601015456`，APPROVED） |
| `approval_steps`（属上三案） | **3** | 各一条 stepNo=1，status=APPROVED，`decidedByRole=CFO`，`decidedByUserNo=ADM2501010010` |
| `tb_transfer_evidence`（`sourceType='VENDOR_PAYMENT'`） | **1** | 码 87 一条，`sourceNo=PAY2601015456`（CIN 两张壳单零新增，复用既有 `sourceType='SEED_CAPITAL'` 两行） |
| `account_flows`（`sourceType='VENDOR_PAYMENT'`） | **2** | debit(`E.FIRM_OPS`)→OUT / credit(`A.FIRM_ASSET`)→IN 各一行 |

**F_OPS(AED) 新判据**（TigerBeetle 余额直读，reset 后、`demo:all` 之前的独立实测，不受花名册流水影响——实测口径见下）：`ledger=1 code=200(E.FIRM_OPS) balance=94750000`（= LP 卖出腿后 95,000,000 分 − 码 87 一笔 2,500.00 AED（250,000 分）= 947,500.00 AED）。F_OPS(USDT)/F_LIQ 两行本任务不动（分别仍为 113,600,000,000 分 / 0）。可复现命令（`reset self` 之后、`up self`/`demo:all` 之前跑，取的正是这个数）：

```bash
DATABASE_URL="file:/tmp/exchange_js_wt_campaign_b_wave2_funding/dev.db" TB_ADDRESS="127.0.0.1:3123" node -e "const{PrismaClient}=require('@prisma/client');const{createClient}=require('tigerbeetle-node');(async()=>{const p=new PrismaClient();const reg=await p.tbAccountRegistry.findFirst({where:{code:200,ledger:1,ownerType:'SYSTEM'},select:{tbAccountId:true}});const c=createClient({cluster_id:0n,replica_addresses:[process.env.TB_ADDRESS]});const[a]=await c.lookupAccounts([BigInt('0x'+reg.tbAccountId)]);console.log((a.credits_posted-a.debits_posted).toString());c.destroy();await p.\$disconnect();})();"
```

**recon 判据（评审纪律：恒等式绿不等于放行，负余额断言才是「期初/种子缺一笔」事故的唯一探针）**：`demo:all` 之后 `bash scripts/on-stack.sh self recon:demo:pass` 直查 F_OPS(AED) 钱包（`walletRef=425b4769-bdda-4c79-b933-5593d4535074`）——`internal=94608935 lines=6`（较波一基线多 1 行，新增的码 87 OUT 流水被 `recon:demo` 重铸回单吃进）；整体 `status=PASS walletsChecked=19 casesOpened=0`，五条 pass-mode 断言全 OK——**新增流水仍 MATCHED，未产生孤儿/错配**。`recon:demo:break`：`scenarios 18/18 DETECTED`、`wallets 12/12 bucket OK`、`casesOpened 12/12`；场景 ⑩「查无果」候选钱包检查（spec §4 承诺）——候选逻辑（`recon-demo.ts` 按 `walletRef` 字典序取 `firmCandidates` 里第一个满足条件的 FIRM 钱包）**依赖 reset 时新生成的钱包 UUID 排序，非固定**：三次独立 `reset self` 实测分别选中 F_OPS(USDT)、F_OPS(USDT)、`E.INCOME_SWAP_FEE`(USDT)，三次都**不是**本任务新增流水所在的 F_OPS(AED) 钱包，但这不是一条恒定判据——候选池成员本身未变（本波零新增钱包），只是哪个钱包被挑中会随每次 reset 的 UUID 排序漂移，评审勿把这个易变量当字面判据。

**实测口径（重铺闸全序，2026-09-29 Task 9）**：`bash scripts/stack.sh reset self` → 全绿（`verify:demo-data ALL PASS`，打印 `Seeded 2 capital injection rows (SUCCESS) + 2 APPROVED approval cases + 2 funds orders (CLEARED, zero new ledger entries...)` / `Seeded 1 vendor payment (PAY2601015456, SUCCESS) + 1 APPROVED payment approval case + 1 funds order (CLEARED)` / `Vendor payment evidence: 1 evidence row + 2 flow row(s) (code 87, DR E.FIRM_OPS / CR A.FIRM_ASSET, AED 2500.00)`）→ 独立查 TB：`ledger=1 code=200 balance=94750000`（demo:all 前）→ `bash scripts/stack.sh up self` → `bash scripts/on-stack.sh self demo:all` → 花名册 29/29 + COA 4/4 恒等式全过（`COA FIRM(AED)` 94620335==94620335，`data.md` 生成区随之改写，非代码红）→ `bash scripts/on-stack.sh self recon:demo:pass` → `status=PASS casesOpened=0`，F_OPS(AED) `lines=6` MATCHED → `bash scripts/on-stack.sh self recon:demo:break` → `scenarios 18/18` `wallets 12/12` `casesOpened 12/12`，场景⑩候选钱包随 UUID 排序漂移（见上段，三跑均未落在 F_OPS(AED)）→ `bash scripts/on-stack.sh self verify:coa` → `ALL INVARIANTS PASS`（两恒等式 + 负余额检查 **67 个科目全部 ≥ 0**——本任务未触发负余额红，见函数头注释「事故唯一探针」纪律）→ `npx tsc --noEmit -p tsconfig.json` + `admin-web`/`client-web` 两侧 `tsc -b --noEmit` 全绿。词表 `npm run audit:vocab` **已实跑**：`EXIT=1`，报「有码没说明 12 个」（`CAPITAL_INJECTION_*` ×6 + `VENDOR_PAYMENT_*` ×6），与预告一致——CIN/PAY 词表入库属 Task 10 范围，本任务未修。

**评审修复轮追记（Imp#1，2026-09-29）**：初版 `payAt`/`effectiveDate` 按「种子运行时刻的上月末」动态算（`new Date(now.getFullYear(), now.getMonth(), 0, ...)`，绕开了项目明令业务日边界只许经过的 `business-date.util`），而 `purposeNote` 是写死的 `'HexTrust 2026-08 custody fee'`——两者本该同源却各走各的，2026-10-01 起重铺会让 `referenceNo`/`effectiveDate` 漂到 9 月而事由仍停在 8 月，本节上表的 `ZB202608317AB0AB0088`/`2026-08-31` 两天后就会与实跑结果脱钩。已改判：`payAt` 钉死常量 `new Date('2026-08-31T08:00:00Z')`（照 LP 腿 1 先例），`effectiveDate`/`referenceNo`/`executedAt`/`settledAt` 全部由它推导，不再依赖种子运行时刻。修复后重跑 `reset self`（第三次独立重铺）实测：`ledger=1 code=200 balance=94750000` 不变；`demo:all` 后 `COA FIRM(AED) 94620335==94620335` 不变；`referenceNo`/`effectiveDate` 仍是 `ZB202608317AB0AB0088`/`2026-08-31`（与钉死前巧合相同，因为本次改动发生在 2026-09-29，钉死值与当时的"上月末"恰好重合；但从此不再随重铺月份漂移）；`recon:demo:pass`/`recon:demo:break`/`verify:coa` 三闸全绿（同上表数字）。

## 战役乙波三 NLA 静态判据（reset 判据，2026-09-30 Task 6 起）

由 `prudential.constants.ts` 代码常量 + 上两节已登记的 F_OPS 余额推得，零新表零新种子——三行全部可由 `GET /admin/prudential/status` 或 TB 直读复现：

- **NLA 合计（reset 后、demo:all 之前，TB 直读，同上两节口径）**：AED 腿 `F_OPS(AED)=94,750,000` 分 + USDT 腿 `usdtMinorToAedMinor(113,600,000,000)=41,719,600` 分（×3.6725 系数向下取整）= **136,469,600 分 = 1,364,696.00 AED**。demo:all 后（花名册流水落账）实测漂到 `136,475,225` 分 `=1,364,752.25`（`GET /admin/prudential/status` 2026-09-30 实测，`perAsset`/`nlaAedMinor` 与本公式逐位互证）。
- **红线**：`NLA_FLOOR_AED_MINOR = 1.2 × MONTHLY_OPEX_BASE_AED_MINOR(100,000,000 分)` = **120,000,000 分 = 1,200,000.00 AED**（reset 后 headroom 16,469,600 分 = 164,696.00，恒不破线）。
- **crisis（场景 31）+ 补款划转后期望**：`recon:demo:crisis` 本身只写外部账单幽灵行，不动 TB/`F_OPS`——crisis 后 `nlaAedMinor=136475225`（1,364,752.25 AED）、`breached=false`（demo:all 后数值不变，2026-09-30 T6 实测）。场景 31 步骤 7 补款划转落地后（F_OPS(AED) 真实出 250,000.00 = `CRISIS_THEFT_AED_MINOR`，`scripts/recon-demo.ts`）NLA 实测降至 **1,114,752.25 AED < 红线 1,200,000.00** → `breached=true`（T8 场景 31 实测坐实）；场景 32 注资 300,000.00 落账后回升至 **1,414,752.25 AED**、`breached=false`（T9 场景 32 实测坐实）。

## 战役丙波三客户协议种子断言（reset 判据，2026-10-03 Task 12 起）

`bash scripts/stack.sh reset self` 从零建库重铺后（`seedBusiness()` 随 `db:seed:business` 落地，打印 `Seeded customer agreements: v1 EFFECTIVE + v2 DRAFT + 13 ACCEPTED-v1 consent rows.`），**三条断言**，`demo:all` 跑完后**原样不变**（`demo:all` 零协议动作，v2 全程保持 DRAFT——协议整条链是第十一幕现场戏，见 `demo/script.md` 场景 35；该幕战役丙波三交付时原为第十幕·场景 33，波四插幕后顺延）：

1. **版本两行**：`customer_agreement_versions` 恰 2 行——v1 `EFFECTIVE`、v2 `DRAFT`。
2. **同意 13 行**：`customer_agreement_consents` 恰 **13** 行，全为 v1 `ACCEPTED`（13 位 demo 客户各一行，actedAt = 各自注册时间；**不是 11**——Quick login 子集数是笔误源，库内 demo 客户实为 13）。
3. **demo:all 后不变**：版本两行同 1、consents 仍 13、`customer_notifications` 里 `relatedOrderType='AGREEMENT'` 为 0、`audit_log_events` 里 `action like 'AGREEMENT_%'` 为 0。

查法（`<栈库>` = self 栈 `DATABASE_URL` 指向的 `dev.db`；审计列名是 `action`，不是 `actionCode`）：

```bash
sqlite3 <栈库> "select versionKey, status from customer_agreement_versions order by versionKey;"            # v1|EFFECTIVE  v2|DRAFT
sqlite3 <栈库> "select count(*), sum(versionKey='v1' and action='ACCEPTED') from customer_agreement_consents;"  # 13|13
sqlite3 <栈库> "select count(*) from customer_notifications where relatedOrderType='AGREEMENT';"             # 0（demo:all 后）
sqlite3 <栈库> "select count(*) from audit_log_events where \"action\" like 'AGREEMENT_%';"                    # 0（demo:all 后，干净库）
```

⚠️ 审计表判据要**干净库**：`stack.sh reset` 不清 `audit_log_events`（`TOOLING-DEBT.md` 第 89 行），手驱过第十一幕（协议幕）后审计表留有 `AGREEMENT_*` 孤行——跑第 3 条前先 `rm -f <栈库>` 再 reset。

**实测口径**（2026-10-03，self 栈 `c3_agreement`，Node 20.20.2）：`bash scripts/stack.sh down` → `rm -f /tmp/exchange_js_wt_c3_agreement/dev.db` → `bash scripts/stack.sh reset`（exit 0，`verify:demo-data ALL PASS`）→ 断言 1、2 实测 `v1|EFFECTIVE` / `v2|DRAFT`、`13|13` → `bash scripts/stack.sh up`（exit 0，`GET /client/agreements/current` 200）→ `bash scripts/on-stack.sh self demo:all`（exit 0：花名册 29/29、`asserts: 5/5 PASS`、`demo:all DONE`；`git status` 仅有本任务改动，`data.md` 生成区零 diff）→ 断言 3 实测版本两行不变、consents 13、`AGREEMENT` 通知 0、`AGREEMENT_*` 审计 0 → `API_BASE=http://localhost:3100 bash scripts/on-stack.sh self verify:rbac`：**2 FAIL，均为波前既有红、红集与甲波四基线恒等**——`S7 catalog 字典真实性`（`TOOLING-DEBT.md` 已登记的三域 demo 裁决按钮 4 行扫描器盲区）+ `V2 改角色不丢权限 · COMPLIANCE_OFFICER`（`BACKLOG.md` 已登记的 `CUSTOMER_WRITE` 孤儿权限组）；**本波新增判据全绿**：S5（51 条策略无未登记自批死锁）/S5b-d/S9（42 条带回链策略）/S13d（15 域、**82 桶**、**90 组**）/S16a·b·c（`AGREEMENT_WRITE` 唯合规官、桶 groups 精确、两写路由分挂）；`verify:rbac` 共 161 项 ✓。`verify:coa` 不触发（本波不动钱）。

**同日订正（e2e 口径）**：本机 Node 20.20.2 下，起完整 `AppModule` 的 jest 在 `app.init()` 即抛 `TypeError`——审批事件监听器 52 个 > 各文件 `setMaxListeners(50)`（`test/` 下 25 个 e2e 文件全带这行上限，`customer-restrictions` / `incident-register` 两份实测同红，其余按机理同红未逐个跑；`invite-expiry.service.spec.ts` 同红，基线 `8e9e2ed2` 上同命令同红，监听器当时 51 个），下方 e2e 节的 83/83 口径当前**不可复现**；另有三份 e2e 的直插客户夹具缺协议同意行。两条均已登 `TOOLING-DEBT.md`，修好前 e2e 不得称绿。

## 战役丙波四种子断言：Henry 历史腿 + 月结单出具 + Grace 已办结 ACCESS 单（reset 判据，2026-10-03 Task 11 起）

`bash scripts/stack.sh reset self` 从零建库重铺后（`seedBusiness()` 末尾追加 `seedStatementHistoryLegs()` + `seedGraceAccessRequest()`，紧随 `seedCompanyFunding()` 之后；打印 `Seeded Henry (CU2601012635) statement history: 9 TB transfers, 9 evidence row(s) + 18 flow row(s) …` / `Seeded 1 data subject request for Grace (DSR2601016750 …)`），`stack.sh up` 后端起稳、**≤60 秒内**出具 sweep 跑完（实测 ≤5 秒即齐），下列判据成立。**月结单一律由 sweep 经真实生成器出具，种子不直插 `customer_monthly_statements`**；两轮独立 reset 单号与数字逐字一致（`buildDeterministicNo` 派生）。

**Henry（`demo_acme`，CU2601012635）历史腿**——只铺客户域（`CLIENT_PAYABLE`/`DEPOSIT_SUSPENSE` ↔ `CLIENT_ASSET`），腿的 `createdAt` 回拨到相对月份（`businessMonthOf(now)` 推：上月 = 刚结束的迪拜业务月，上上月再往前一月），`walletRef=null`/非外部穿越（Henry 无钱包行，不进 recon 钱包桶）；公司侧对手腿不铺（理由：会漂移 F_OPS/NLA 等场景 31/32 钉死数字，见种子函数头注释）：

| 业务月 | 日 | 腿（evidence `eventCode`，客户侧借贷） | 金额 |
|---|---|---|---|
| 上上月（2026-08） | 15 | `DEPOSIT_ASSET_TO_SUSPENSE`（DR CLIENT_ASSET / CR DEPOSIT_SUSPENSE）+ `DEPOSIT_SUSPENSE_TO_PAYABLE`（DR DEPOSIT_SUSPENSE / CR CLIENT_PAYABLE），单号 `DEP2601014127` | AED 50,000.00 |
| 上月（2026-09） | 2 | 同上两腿，单号 `DEP2601017605` | AED 10,000.00 |
| 上月 | 5 | `SWAP_SELL_CLIENT`（AED，DR CLIENT_PAYABLE / CR CLIENT_ASSET）+ `SWAP_BUY_CLIENT`（USDT 毛额，DR CLIENT_ASSET / CR CLIENT_PAYABLE）+ `SWAP_FEE_CLIENT`（USDT，DR CLIENT_PAYABLE / CR CLIENT_ASSET），单号 `SWP2601010349`（另有一行极薄 `swap_transactions` 壳，仅供月结单兑换行标题反查 `AED → USDT`） | 卖 AED 10,000.00 → 毛 USDT 2,712.049000，费 USDT 3.000000 |
| 上月 | 20 | `WITHDRAW_NET_POST` + `WITHDRAW_FEE_POST`（均 DR CLIENT_PAYABLE / CR CLIENT_ASSET），单号 `WDR2601019900` | 到账 AED 5,000.00 + 费 AED 50.00（申请额 5,050.00，STD-AED 第 2 档服务费 50） |

兑换毛额口径（示例价，同 LP 种子手填先例）：`round8(1/3.6725) × (1 − 40bps)` = 0.27120490 USDT/AED（STD-AED-USDT 第 3 档：加价 40bps、固定费 3 USDT），× 10,000 向下取 6 位 = 2,712.049000。

**判据（公式 + 当日快照值；当日 = 2026-10-03，当前业务月 2026-10）**

| # | 判据 | 公式 | 当日快照值 |
|---|---|---|---|
| 1 | `customer_monthly_statements` 行数 | Σ 客户（`onboardingApprovedAt` 非空）[ `businessMonthOf(now)` − `businessMonthOf(onboardingApprovedAt)` ] 个月（当月不出，已完整月数）；11 位客户开户批准均为 2026-06-15（迪拜 2026-06） | 11 × 4（2026-06/07/08/09）= **44** 行，每人恰 4 张（`STM-<customerNo>-<YYYYMM>`）；下月 1 日（迪拜）起每人 +1 |
| 2 | Henry 上月单（`STM-CU2601012635-202609`）AED 节 | rows ≥ 3；期初 = 上上月末余额；期末 = 50,000 + 10,000 − 10,000 − 5,000 − 50 | **rows = 3**（Withdrawal −5,050.00〔fee 50.00〕/ Swap AED → USDT −10,000.00 / Deposit +10,000.00），期初 **5,000,000**（50,000.00），期末 **4,495,000**（**44,950.00**） |
| 2b | Henry 上月单 USDT 节 | 期末 = 毛额 − 兑换费 | rows = 1（Swap AED → USDT，amount 2,709.049000、fee 3.000000），期初 0，期末 **2,709,049,000**（**2,709.049000 USDT**） |
| 2c | Henry 上上月单（`…202608`）与更早 | 上上月有一笔充值；之前无流水 | 2026-08：AED rows=1，期初 0、期末 5,000,000；USDT rows=0；2026-06/07 两币种皆空（期初=期末=0） |
| 3 | `customer_notifications` 里 `relatedOrderType='STATEMENT'` | 每客户仅最新月一条（sweep 补发多月只通知最末月） | **11** 条（每条 `relatedOrderNo=STM-<customerNo>-202609`） |
| 4 | `data_subject_requests` | 种子恰一张 | **1**：`DSR2601016750`（Grace，ACCESS，RESOLVED，`resolutionCode=ACCESS_SUMMARY_PROVIDED`，submittedAt = 铺场 −10 天、reviewStartedAt = +1 天、resolvedAt = submittedAt + 3 天、dueAt = submittedAt + 30 天；summary 四键 `generatedAt/profile/agreementConsents/kycMaterials`，profile 14 键白名单，无 riskRating/eddRequired/hardLine*；同意史 `v1 ACCEPTED` 按注册批准时点封顶，`kycMaterials=[]`） |
| 5 | 账本（`verify:coa`，reset 后、`up` 前后均可测） | 客户域净增 = Henry 期末；公司域零变化 | `ledger 1 CLIENT 恒等 4495000`（= Henry AED 44,950.00）/ `ledger 1 FIRM 恒等 94750000`（= 波二 F_OPS(AED) 基线，**不变**）/ `ledger 2 CLIENT 恒等 2709049000`（= Henry USDT）/ `ledger 2 FIRM 恒等 113600000000`（**不变**）/ `负余额检查 通过 (67 个科目全部 ≥ 0)` |

查法（`<栈库>` = self 栈 `DATABASE_URL` 指向的 `dev.db`，只读；statements 行数与期末值查 payload JSON）：

```bash
sqlite3 -readonly <栈库> "select count(*), count(distinct customerId) from customer_monthly_statements;"                         # 44|11
sqlite3 -readonly <栈库> "select s.periodMonth, json_extract(j.value,'$.assetCode'), json_extract(j.value,'$.openingBalance'), json_extract(j.value,'$.closingBalance'), json_array_length(json_extract(j.value,'$.rows')) from customer_monthly_statements s join customer_main m on m.id=s.customerId, json_each(s.payload,'$.sections') j where m.email='demo_acme@example.com' and s.periodMonth>='2026-08' order by 1,2;"
                                                                                                                                  # 2026-08|AED|0|5000000|1 / 2026-08|USDT|0|0|0 / 2026-09|AED|5000000|4495000|3 / 2026-09|USDT|0|2709049000|1
sqlite3 -readonly <栈库> "select count(*) from customer_notifications where relatedOrderType='STATEMENT';"                         # 11
sqlite3 -readonly <栈库> "select count(*) from data_subject_requests;"                                                            # 1
```

**与既有判据的衔接（实测，2026-10-03，self 栈 `c_wave4`，Node 20.20.2）**：

- `demo:all`：花名册 **29/29**、`asserts: 5/5 PASS`——Henry 不在花名册，终态比对不受扰；COA 恒等式四行：`CLIENT(AED) 34107565 == 34107565`（= 旧值 29,612,565 + Henry 4,495,000）、`CLIENT(USDT) 7101620811 == 7101620811`（= 旧值 4,392,571,811 + Henry 2,709,049,000）、`FIRM(AED) 94620335`、`FIRM(USDT) 114013428189`（**两条公司域与旧值逐位相同**）。`data.md` 生成区因此改写**恰两行**（上两条 CLIENT 数字），花名册区零 diff——这是 Henry 余额的必然后果，不是花名册漂移。
- `recon:demo:pass`：`status=PASS walletsChecked=19 casesOpened=0`，五条断言全 OK（与乙波二基线 19 个受检钱包一致，Henry 无钱包不新增受检对象）；`recon:demo:break`：`scenarios 18/18 DETECTED`、`wallets 12/12 bucket OK`、`casesOpened 12/12`——**零新破口**。
- `verify:coa`：reset 后 / `up` 后 / `demo:all`+`recon:demo:break` 后三个时点均 `ALL INVARIANTS PASS`（末点 `ledger 1 CLIENT 34307565` = `demo:all` 后的 34107565 + `recon:demo:break` 场景 6 真写账本的 200000，恒等式两边相等，67 科目 ≥ 0）。
- **失效验证**（判据不是自证绿）：对 self 栈账本分别注入 ① 只铺 `DEPOSIT_SUSPENSE_TO_PAYABLE`、缺 STEP_1（DR 暂扣 / CR 应付 各 1.00 AED）→ 恒等式仍绿、`✗ 负余额 L.DEPOSIT_SUSPENSE ledger=1 CUSTOMER:CU2601012635 balance=-100`，`verify:coa` 退出码 1（**负余额断言是「起点缺一笔」的唯一探针，恒等式绿不豁免它**）；② 只贷客户应付、借公司 `FIRM_OPS`（DR FIRM_OPS / CR Henry CLIENT_PAYABLE）→ `✗ ledger 1 CLIENT: asset=4495000 liab=4495100`、`✗ ledger 1 FIRM: asset=94750000 equity=94749900`，退出码 1。变异后已 `reset self` 重铺还原。
- `swap-money-arc.e2e-spec.ts`（取 `demo_acme`）**只读核查**：断言全为相对差值（`before`/`after` 余额，`availableBalances()` 前后比）、证据行按本单 `swapNo` 取（`findBySource('SWAP', swap.swapNo)`，7 行），`beforeAll` 自己 `fundCustomer` 预充 1,000,000——不依赖 Henry 期初为零，**无需改断言**；且该文件在本机当前起不来（`app.init()` 抛监听器 52 > 50 的 `TypeError`，见上节同日订正与 `TOOLING-DEBT.md`），故未实跑，不得称绿。
- **费腿不对称（有意，勿「修平」）**：Henry 的兑换费（`SWAP_FEE_CLIENT` USDT 3.000000）与提现费（`WITHDRAW_FEE_POST` AED 50.00）只铺了**客户侧**一条腿（DR `CLIENT_PAYABLE` / CR `CLIENT_ASSET`），没有真流程里对应的公司侧收入腿（`SWAP_FEE_FIRM` / `WITHDRAW_FEE_FIRM` → `INCOME_SWAP_FEE` / `INCOME_WITHDRAW_FEE`）；同理兑换卖出腿 / 买入腿的公司侧 `F_SET` / `F_OPS` 对手腿也不铺。后果：两恒等式按账本各自守恒（客户账本净增 = Henry 期末余额，公司账本零变化），但 Henry 的历史手续费**不进公司收入科目**——这一笔笔小账在演示叙事里不可见。若有人想把公司侧对手腿「补齐」，会立刻漂移 `F_OPS(AED)` 947,500.00、NLA 1,364,752.25 / 1,114,752.25 / 1,414,752.25、运营户 696,089.35 / 996,089.35 等场景 31/32 钉死的一串数；现状（不补）公司域四个数与旧值逐位相同（T11 实测，T12 重铺后 `demo:all` 复核同值）——不补。
- 下游钉死数字的漂移清单（T11 出具，**T12 已于 2026-10-03 处理完毕**）：`script.md` 场景 31 / 32 的 `✓ ledger 1 CLIENT 恒等 29612565` → **34107565**、`✓ ledger 2 CLIENT 恒等 4392571811` → **7101620811**（已改并在原行标注"推导值、未重走场景 31/32 复读"；漂移量恒为 Henry 余额 +4495000 / +2709049000，FIRM 两数不变）；`script.md` 协议幕演员点名里的「Henry Acme 无便签但余额 0」已删（改为"自波四起有种子历史余额，但他是第十幕主角，不借"）；`data.md` 生成区两行 CLIENT 数字随 `demo:all` 自动改写（T11 已入库，T12 重铺后 `demo:all` 复跑 **零 diff**）。

**判据 6（干净库审计，T12 补）**：`rm -f <栈库>` → `stack.sh reset self` → `up` 后 ≤60 秒，`audit_log_events` 里 `action='STATEMENT_ISSUED'` = **44** 条（= statements 行数，requestId = statementNo；`stack.sh reset` 不清审计表，脏库上同 statementNo 的新写会被审计幂等键静默吞掉，故这一条与协议种子第 3 条同样要**先 rm 库**）、`action like 'AGREEMENT_%'` = 0、`like 'DSR_%'` = 0。

**T12 收尾闸实测（2026-10-03，self 栈 `c_wave4`，Node 20.20.2；干净库重铺 → `up` → 全序）**：
- **重铺 + 起栈**：`down` → `rm -f /tmp/exchange_js_wt_c_wave4/dev.db` → `bash scripts/stack.sh reset self`（exit 0，`verify:demo-data ALL PASS`，打印 `Seeded Henry (CU2601012635) statement history …` / `Seeded 1 data subject request for Grace (DSR2601016750 …)`）→ `bash scripts/stack.sh up`（exit 0）。起栈后约 30 秒内（一个 tick）sweep 出齐：`customer_monthly_statements` **44 | 11 客户**、`relatedOrderType='STATEMENT'` 通知 **11**、`data_subject_requests` **1**（`DSR2601016750|ACCESS|RESOLVED|ACCESS_SUMMARY_PROVIDED`）、`STATEMENT_ISSUED` 审计 **44**、`AGREEMENT_%` 审计 0、协议种子三断言（v1 EFFECTIVE / v2 DRAFT、consents 13|13、`AGREEMENT` 通知 0）；Henry 九月单 AED 节 `5000000|4495000|rows 3`、USDT 节 `0|2709049000|rows 1`，八月 AED `0|5000000|rows 1`（与上表判据 1–4 逐位吻合）。
- `verify:coa`（reset+up 后、`demo:all` 前）：exit 0，`ledger 1 CLIENT 恒等 4495000` / `ledger 1 FIRM 94750000` / `ledger 2 CLIENT 2709049000` / `ledger 2 FIRM 113600000000` / 负余额检查 67 个科目全部 ≥ 0 / `ALL INVARIANTS PASS`。
- `bash scripts/on-stack.sh self demo:all`：exit 0，`花名册：29/29 符合预期`、COA 四行 `34107565 / 94620335 / 7101620811 / 114013428189` 两两相等、`asserts: 5/5 PASS`、`demo:all DONE`；`data.md` 生成区（`GENERATED:BEGIN`～`END` 共 59 行）与 HEAD **逐行零 diff**（`diff` exit 0）。
- `recon:demo:pass`：exit 0，`status=PASS walletsChecked=19 casesOpened=0`；`recon:demo:break`：exit 0，`scenarios 18/18` / `wallets 12/12` / `casesOpened 12/12`、`ALL 18 SCENARIOS DETECTED PER MANIFEST`——零新破口；其后 `verify:coa` exit 0：`ledger 1 CLIENT 34307565`（= `demo:all` 后 34107565 + 场景 6 真写账本 200000）/ FIRM 两数 `94620335`、`114013428189` 不变 / 负余额 67 科目 ≥ 0。
- `API_BASE=http://localhost:3100 npx ts-node scripts/verify-rbac.ts`（显式 API_BASE，全段）：exit 1，**173 项 ✓、仅 1 条 ✗ = `S7`（4 行 sumsub demo 死行，`TOOLING-DEBT.md` 在册基线红）**（终审修 `2d7c20ac` 后复测；T12 当时 172 项，差额 = 终审补的运营 PATCH profile 探针）；S13d `域 15 / 83 桶 / 92 组`、S5 51 条策略（S8 策略全集 52 含 1 条显式豁免）、S16d–g 四条 DSR 判据、行为探针（DPO resolve 404≠403 / 合规官 resolve 403 / 运营 list 403 / DPO ⚡ 403 / 合规官 PATCH profile 404≠403 / DPO PATCH profile 403 / 运营 PATCH profile 403）全 ✓；`V2 改角色不丢权限 · COMPLIANCE_OFFICER` 已转 ✓（孤儿组销账）。
- jest 六目录（`src/core/notifications`、`src/modules/asset-treasury/treasury`、`src/modules/identity/dsr-requests`、`src/modules/identity/customers`、`src/modules/governance/compliance-office`、`src/modules/audit-logging`）：exit 0，**33 suites / 471 passed / 1 skipped（既有 skip）**；同机 `npx jest src/modules/identity`（含 `users/invite-expiry.service.spec.ts`）：`1 failed suite`（即 `invite-expiry`，审批监听器 52 > 50 的既有债，`TOOLING-DEBT.md` 在册），其余 55 suites / 679 tests 全绿——**`invite-expiry` 红按既有债交代，不称全绿**；e2e 同机理不得援引为绿。
- 闸①②③：`npx tsc --noEmit -p tsconfig.json`、`cd admin-web && npx tsc -b --noEmit`、`cd client-web && npx tsc -b --noEmit` 均 exit 0。`npm run audit:vocab` exit 0，合计 **343 码**（失效验证：临时删掉种子里 `DSR_RESOLVED` 一行 → exit 1，报"有码没说明 … DSR_RESOLVED"，不写盘；还原后 exit 0）。
- 走查证据（第十幕场景 33–34 全程真点击，干净库）：`superpowers/checkups/2026-10-03-campaign-c-wave4-evidence/35`–`71` 共 37 张。**同日快照不漂实验**（对 Henry 2026-09 单出具后往 `tb_transfer_evidence` 插一条落在 9 月的 AED 腿 +777.00）：活水页 `total` 4→5、`currentBalance` 4495000→4572700，而月结单 JSON 逐字节不变——实验数据随重铺清除，不入库。
