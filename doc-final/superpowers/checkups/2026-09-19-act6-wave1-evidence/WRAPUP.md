# 波一「闸门复位」收尾记录（对照 plan 收尾检查表逐段）

2026-09-19 ｜ 基线 `1ca13cfa`（BASELINE_SHA 在案）｜ 分支 worktree-act6-wave1 ｜ 栈 self（/tmp/exchange_js_wt_act6_wave1）

## A. 物证清单（四类全齐，本目录内）

| 物证 | 判据 | 结果 |
|---|---|---|
| `gate-before.txt` | 改错 Prisma 列名（slaBreached→slaBreachedTYPO），闸① 仍绿 | **波前 EXIT=0、零错误行** ✅（这就是本波消灭的状态） |
| `gate-after.txt` | 同一个改法，闸① 必红 | **波后 EXIT=2**，第一条即 `error TS2561: 'slaBreachedTYPO' does not exist in type 'ReconciliationCaseWhereInput'. Did you mean to write 'slaBreached'?` ✅ |
| `demoall-diff.txt` / `break-diff.txt` | 归一后逐字节 diff = 空 | **两份均空（diff EXIT=0）** ✅ |
| `grid-mutation-before.txt` / `-after.txt` | 改坏 COMPENSATING 分支：改断言前网格用例绿、改后红 | 前=`compensating` 红而网格用例绿（1 failed/7 passed）；后=网格用例也红（`Expected: "COMPENSATING" Received: "MATCHED"`）✅ |

**归一规则**（`normalize-rules.sh`，只归一两次同代码重铺之间天然会变的六类值，金额/状态/场景名/断言行一律不动）：①Node 与 Nest 进程号 ②UUID ③业务单号（前缀+日期+随机尾）④人读时间戳与 ISO 串 ⑤`wallet=` 8 位 hex id。裸 diff 178+134 行经归一后全部消失，未归一掉任何金额、状态或文本行。

**采样序**：before 与 after 均为同一 self 栈上的完整重铺标准序（reset → up → 等就绪 → demo:all → recon:demo:break），非同库重跑（旧库重跑 demo:all 必红，判例在案）。

## B. 四条硬判据（spec §5）

1. **逃逸归零** ✅：`grep -rn "this\.prisma as any" src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers --include='*.ts' | grep -v '\.spec\.ts' | wc -l` → 在 c48a9fe0 上 **0**（Task 8 评审独立复现）；在最终 HEAD 上命令字面返回 **1**——那一行是 394b9f59 **还原的历史注释**（`supplement-evidence.service.ts` 前人事故记录里引用的 `(this.prisma as any)` 字面，见 D 段），**代码逃逸 = 0**（终审逐行核实）
2. **闸门能咬人** ✅：gate-before（绿）vs gate-after（红），见上
3. **网格断言能咬人** ✅：grid-mutation 两份物证，见上
4. **行为零变更** ✅：两份归一化 diff 为空

## C. 闸门（随手闸；收尾闸按条件全未触发）

- ① 后端 tsc EXIT=0 ｜ ② admin-web tsc -b EXIT=0 ｜ ③ client-web tsc -b EXIT=0（②③零改动，确认无误伤）
- ④ 对账三域 jest：**28 suites / 553 tests 全绿**（基线 29/555，Task 2 删 1 孤儿 suite / 2 恒真用例）；库 = 本树 self 栈 `file:/tmp/exchange_js_wt_act6_wave1/dev.db`
- ⑤截图/⑥demo:all（由判据④两次实跑覆盖）/⑦coa/⑧重铺闸：未触发（零前端/零钱/零 schema 改动）

## D. E 段禁令复查（基线 1ca13cfa..HEAD，src/ 的 + 行）

- `as any`：**恰 1 处命中** = `supplement-evidence.service.ts` 前人事故注释的还原行（Task 8 全文件 sed 误伤历史引用，394b9f59 还原并补注「波一已摘净」）——纯注释文本，非代码逃逸；除此零新增
- `@ts-ignore` / `@ts-expect-error`：0
- `!` 非空断言：0（命中两行分别是逻辑非 `!kase` 与「不用 `!`」的注释）
- spec 文件改动：恰 Task 1（网格换真断言）+ Task 2（删孤儿）两处，其余 spec 零改动；无任何 mock 造型修改
- 零行为变更自述：无 schema 列删除、无 UI 改动、无业务分支变动、无状态/边增减；仅有的运行期新路径是 5 条显式守卫（Task 6/7/8），全部落在此前会运行期炸或不可达的分支上，18 场景 + 断言输出 diff 为空佐证

## F. 新发现的去处

- Task 6：跨钱包合成案件（walletRef 空）无处置出口 → 已记 `BACKLOG.md` §G
- Task 5：:305/:366 快照字段经 schema 逐键核对无问题 → 无需登记
- 新守卫分支无专测（观察级）+ Task 8 sed 咬注释判例 → 已写进波二骨架「承接上一波」

## 对 plan 的操作性偏差（如实记录）

1. jest 全程用本树 self 栈库，非 plan 原文的 main 库（端口隔离铁律优先）
2. plan 内 `cd 主仓路径` 与 for 循环命令，因 worktree 隔离护栏改为 worktree 根内逐条单纯命令，效果等同
3. Task 8 之后主会话追加一个注释还原 commit（394b9f59），非 plan 九任务内，理由见 D 段
