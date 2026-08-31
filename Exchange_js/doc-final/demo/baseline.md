# 基线（Phase 4 收官重钉）

> 钉定时点：2026-09-01 ｜ 代码基准：三支合流后的 main ｜ 环境：main 栈经 `db:base:sync` → 重启 → `verify:rbac` → `stack.sh reset main` → `up` 后实测
> **判据铁律：一切验证以「全绿」为准。** 2026-08-31 环境收口把红名单清零后，判据从
> 「净新失败 = 0」（相对，需人工比对上一轮数字）升级为「全绿」（绝对，机器可判：
> `npx jest` 退出码 0）。**任何红都是事故**，没有"这条是旧账"的退路；真有一时修不了的，
> 须当场决定修或由业主正式豁免并记入 `TOOLING-DEBT.md`，不得默留。
> 重钉纪律：只在业主批准的行为变化后重钉；每次重钉记 CHANGELOG 一行。
> 重钉历史：2026-08-26 Step 0 首钉（7c53afd4）→ 2026-08-27 Phase 4 收官重钉（45a4f1a8）→ **2026-09-01 三支合流重钉（本版）**。
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
| 对账 | recon:demo:pass ｜ **recon:demo:break 15/15 场景 + 10/10 钱包桶 + `casesOpened` 完整性断言**（2026-08-30 按成因铺全，答案键拆两级）｜ verify:demo-data。⚠️ **必须走整库重铺验证**：场景 ⑦ 真写账本、`recon:demo:reset` 不回滚账本，轻量重跑会让 ⑦ 假性 MISSED |
| 账本 | verify:coa —— 两恒等式 + 负余额断言（49 科目全部 ≥ 0）。收官多轮实测重铺后与 demo:all 后均全绿；历史上个别含 break 注入的运行轮见过公司 AED 负余额（浮存时序）。**2026-09-01 三支合流后在 main 栈两轮独立实测：57 科目全部 ≥ 0，全绿**（此前 08-31 的负余额红已定位为资本注入被跳过的假红，见上方\"已结\"节）|
| 审计 | verify:audit 恒绿七项：Q2 按单据查 ｜ Q4 按客户查 ｜ 不变量①②③（PRIMARY 至多一 / INHERIT 必有旅程号 / 退役码零写入）——三查合同七站换装后的固定资产 |
| 封册 | audit-vocabulary-closure.spec 四条：平面表归籍 / 六册互斥 / V3 附册冻结快照 / 写点闭合退役词零引用 |
| 单测 | `npx jest` **全绿**（156 套，退出码 0——2026-08-31 环境收口验收实测；此前"162 套"是 test-cases 封箱前的旧值，套件数下降是封箱导致、非回归）｜ `npm run test:client`（vitest 4 套 83 例） |
| 栈 | `bash scripts/stack-env.test.sh`（`ensure_env_files` 权威重写的 11 项断言） |

> ⚠️ **重铺前必须先 `stack.sh down <栈>` 停栈，否则 TigerBeetle 清不掉。** `reset-stack.sh` 的 `rm -f` 对运行中进程持有的文件只是 unlink，旧 tigerbeetle 仍在旧 inode 上服务 → SQLite 重铺了、TB 没有 → 客户 UUID 全新使 `CLIENT_PAYABLE` 读 0 而 SYSTEM 口径 `CLIENT_ASSET` 留旧余额（恒等式假红），多轮提现累积还会把公司 AED 打成负数（负余额假红）。2026-08-28 平账一期实测定位——正确顺序：`down` → `reset` → `up`。⚠️ `stack.sh reset` 自己会拉起 TigerBeetle，`up` 之前要先把它 kill 掉，否则 `up` 在 TB 端口上撞车。

> 💡 **`verify:coa` 建议在 `test:e2e recon-adjustment-money-arcs` 之后再跑一次。** 调账单的四种分录组合里，`FIRM`+`REDUCE`（银行杂费）与 `FIRM`+`INCREASE`（银行利息）**只有这支 e2e 会真落账**——`demo:all` 不碰调账。在 e2e 之后跑 `verify:coa`，四种组合各自落账后的恒等式与负余额就都被覆盖了。2026-08-28 实测：e2e 后 ALL INVARIANTS PASS。

## demo:all 操作约束（演示装备一期，2026-08-29 起）

`demo:all` 的判据从「8 场景全 SUCCESS」改成了「花名册 29 笔逐条比对预期终态 + COA 四恒等式」——一份丰富的演示数据本来就该有冻结的、没收的、退回的、上缴的、卡在半路的，不是清一色 SUCCESS（详见 `data.md`）。

**由此带出一条硬约束：`demo:all` 必须在全新库上跑，不能在同一个库上连跑两次。** 花名册第 #7/#10/#13 行故意把第四人设 FRANK 造成一个**永久被制裁**的客户（customer-level ALL-scope 限制，本仓库没有任何流程会解开它——这也是刻意的，交易三人组 Alice/Bob/Grace 必须全程可交易，冻结这个不可逆动作只能落在专门"报废"的第四个人身上）。第二次在同一个库上跑 `demo:all`，Gate 0 会（正确地）拒绝 FRANK 的新充值，`runFrankPreStage` 因此卡住直到超时——**这是闸门在正确工作，不是 bug**。正确姿势：`bash scripts/stack.sh reset [main|self]` 重铺出全新库后再跑一次。

> 💡 **`demo:all` 打印的那四个 COA 恒等数值会随花名册变化，数字变了不等于账错了。**
> `verify:coa` 与 `demo:all` 验的都是**等式两边相等**，不验具体数值——所以花名册加了行、
> 客户多了两个之后，这四个数必然变，这是正常的。
> ⚠️ 它们会落在 `doc-final/demo/data.md` 的 `<!-- GENERATED:BEGIN -->` 区块里，
> **那段是 `demo:all` 收尾自己写的，不要手改**——手改会被下一次 `demo:all` 整段覆盖，白费。

> ⚠️ **`recon:demo:break` 的场景 ⑦（重复入账）会写账本**，是 15 条里唯一一条。它用固定 sourceNo 保证重跑幂等（TB 判为已存在直接跳过），但 **`recon:demo:reset` 不回滚账本**——它只清外部数据与 WALLET_V1 的 run/case。要把账本也归零，走 `stack.sh reset self`（含 TigerBeetle 重建）。

## verify:rbac 操作约束（第一幕职权重划，2026-08-30 起）

`npm run verify:rbac` **会写数据**——V2 判据对 10 个内建角色各跑一次真实的「改角色定义→审批」往返，每轮留 10 张角色修改审批单；V3 判据用一次真实的 CFO 建费率等级请求当燃料，每轮留 1 条费率等级 + 1 张审批单。这些记录的 markup 均为 999999bps、**永不被真实报价选中**（`resolveBestLevel()` 恒选最便宜档，无害），但**第一幕站 2 正是打开费率页改一档**——观众会看到大半是探针行，踩评审判据②「显示的内容错了」。实测：跑完 4 轮后费率等级从 2 条（`STD-AED-USDT`/`STD-USDT-AED`）涨到 **8 条**。

**裁决**：不给脚本加清理逻辑（费率等级是受治理对象、本无删除端点，造一个属扩范围）。改为**钉死运行顺序**——

`verify:rbac` → `stack.sh reset [main|self]` → `demo:all`

重铺会把探针痕迹一并冲掉：实测重铺后费率等级从 8 条回落到 **2 条**。**`verify:rbac` 绝不能在演示前跑**，必须排在重铺之前；`demo:all` 的收尾闸判据（花名册 21/21 + COA 四恒等式）与本条对同一份"全新库"负责，两条约束并列、不可颠倒顺序。

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

全量 11 套件 **83/83**（收官在 main 实测）。跑法三要素，缺一必假红：

1. **私库先铺**：六个自带独立库的套件（kyt-verdict-landing / sanction-subject-split / deposit-verdicts / material-requests / customer-restrictions / sla）在每次 `stack.sh reset` 后库被清空，须逐库 `DATABASE_URL=file:/tmp/exchange_js_main/<e2e-库名>.db` 依次 `prisma migrate deploy` + `db:base:sync` + `db:biz:init`；
2. **串行跑**：`bash scripts/on-stack.sh main test:e2e --runInBand <11 个文件>`（**不要**在文件列表前多写 `--`，会被 jest 当路径模式吞掉 runInBand）；并行会互踩栈库出假红；
3. **干净态起跑**：栈库残留多轮数据会触发日累计限额假红；`reset` + 重铺私库后一次跑完。

已知偶发：funds_orderNo 时间戳撞号极低概率 flake（生成器熵，非行为红），重跑即绿。

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

