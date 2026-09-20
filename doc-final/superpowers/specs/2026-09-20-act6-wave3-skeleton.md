# 第六幕清残留 · 波三「主体分层」—— 骨架

> 总纲：`superpowers/specs/2026-09-19-act6-recon-cleanup-charter.md` §3 波三行
> 本文件是骨架，**不是 spec**。波三 spec 的展开是下一个新会话读总纲 + 本承接后跟业主脑暴的活，收尾会话不代做。

## 承接上一波（波二「清死物」，2026-09-20 收官）

- **实际偏差**：
  - Task 4「去 export」计划 30 个候选、实交 **29** 个：`WalletReconRunResult`（`wallet-recon-run.service.ts`）被 `ReconciliationAdminController.createWalletRun` 一个未标注返回类型的方法结构化推断消费（`tsc` 报 TS4053），去掉 `export` 会闸①红；按任务书铁规「闸红 = 有活消费者 → 加回、不许为过闸删使用方」，把 `export` 加回、从名单剔除。**判例**：字面 `grep -rlw` 重扫脚本抓不到「返回类型靠调用方结构化推断」这类消费，是扫描方法学的已知盲区，不是扫描数字错。
  - Task 8 `verify:rbac` 收尾**非全绿**：2 条 FAIL 经独立复核坐实为波前既有债——`TOOLING-DEBT.md:137`（S7 静态扫描器不认共用基类 `DemoScenarioControllerBase` 上的路由装饰器，三域 demo 裁决按钮共 4 条误判死行）+ `BACKLOG.md:228`（`CUSTOMER_WRITE` 权限组随裸 CRUD 端点整体删除后已零路由，但仍被两处角色绑定引用，变成空壳）。两条在 `git diff ac33c002 HEAD` 上与本波改动（只有 Task 6 摘 `INTERNAL_TRANSFER_READ` 4 行）无关，main 分支原样复现同一对失败——本波零触碰，commit 文案（`28a410dc`）已如实标注，未回改判据或代码。
  - Task 3/4/8 三处任务书笔误已在执行中消化，未产生实际影响：① Step 4 扫尾 grep 的文件名任务书写 `IncidentsListPage`，代码里实际是 `IncidentListPage`（已按 `modules/v1-governance.md:104` 核实真名）；② 任务书行文"COA 5/5"实为总断言数（花名册 1 条「ALL INVARIANTS PASS」+ 恒等式 4 条），不是 5 个独立场景。
- **执行中发现的新事实**：
  - 重扫「去 export」候选用的 `grep -rlw` 检索脚本，`refs` 检索范围只覆盖 `src` + `admin-web`，`client-web` 与 `test/` 目录不在扫描范围内——本波靠闸①②③ + jest 三域兜底验证零漏网（tsc 编译期会咬到跨包引用），但**这只是本波幸运过关，不是脚本本身覆盖了这两侧**；未来若要单独拿这套脚本对某个符号下"零消费者"结论，必须先确认是否需要补测这两侧，否则是覆盖不到的盲区，不能写成"零引用"。
  - 写行防线已就位并通过三向变异实证：`wallet-flow-matcher.service.spec.ts` 的值断言（matcher 层 `take()` push 携带 `externalTimestamp`）+ `wallet-recon-run.service.spec.ts` 的值透传断言与 **13 键白名单**（`Object.keys(payload).sort()` 逐键相等）——不携带 / 不落列 / 多一键三种变异各自独立触红，还原后复绿，物证在 `checkups/2026-09-20-act6-wave2-evidence/mutation-{a,b,c}.txt`。
  - 对账三域 jest 基线现为 **28 suites / 556 tests**（波一收官时 553 → 波二净变化 +4 新增（Task 1 两条写行防线测试 + Task 2 两条读端测试）−1 删（Task 3 清 `incident.service.spec.ts` 里「walletRef → walletNo 翻译」整条已退役测试））。

- **波三前提有无变化**：总纲 §3 波三行范围本身不变——Case 立主体服务 + 显式迁移表、拆 `getCase()` 414 行 / `run()` 329 行 / `buildFlowComparison()` 198 行、铁律③ 直写一处（`internal-transfer-workflow.service.ts:130`）、`dispositionsFor()` 六格补齐硬边界（`AMOUNT_MISMATCH×FIRM` 漏查 `sourceAdjustable`）、抽 `walletRef→walletNo` / `decimals` Map 两个重复 helper。但波二交棒三条新地基事实，波三动手前必须知道：
  1. **死列已清**——11 根死列（含 `Incident.walletRef` 恒空管线）已随一次迁移出清，波三重构 Case / Incident 相关代码时不会再遇到它们，也不需要为它们兼容。
  2. **export 面已收窄**——对账域 29 个符号已摘 `export`，只剩真正跨文件消费的符号保留。波三拆大方法、抽 helper 时，新导出的符号**必须先确认有真实消费者才 `export`**，否则又会长出下一批死导出。
  3. **写行防线已就位**——在途行写点的键集合白名单（13 键，`wallet-recon-run.service.spec.ts`）已经能咬「省略字段 / 多写字段」两类缺陷。波三如果动 `writeLineItems` 的结构（比如把这段逻辑挪进 Case 主体服务、或改变载荷形状），这道防线会红；键集合变更时必须同步更新白名单，并像波二一样留一次变异实证，不能因为闸红就把断言放宽。

## 已定事实（波二带过来的）

- 战役级判据 1/2（闸门能咬人 / 测试的绿来自行为）已在波一验收通过；判据 3（屏上无假数据）本波已达标（红 3 真实时间 + 幽灵筛选摘净 + External Balances 证伪）；**判据 4（主体边界立起来：Case 有自己的服务与显式迁移表，`status` 写点收敛；对账域 workflow 零直写表）是波三本体判据**，波三收尾时逐条验。
- `verify:coa` 全绿（两个账本各 CLIENT/FIRM 两条恒等式 + 57 个科目负余额检查），`verify:rbac` 除上述 2 条既有债外全绿（含本波新增的 `ops_officer` 提交→批准往返 77 项 permissionCodes 无丢失探针）——这是波三开工前的干净基线，波三收尾复跑这道闸时，预期仍是"同样这 2 条 FAIL、其余全绿"，不是回归。
- 对账三域非 prisma 的 `as any` 仍残留 **26 处**（审计写入 12 / 记账边界 4 / controller 入参 4 / 查询投影 3 / 划转 workflow 2 / TigerBeetle 返回值 1，`TOOLING-DEBT.md:143` 登记），波一波二均未触碰。该条目本身注明"候选归宿：波三『主体分层』顺路收，或单独开一个小轮"——**是否顺路收进波三属待定岔口**（见下），不是已定范围。

## 待定岔口

- **三域残留 26 处非 prisma 的 `as any`（`TOOLING-DEBT.md:143`）要不要并入波三顺手收，还是单独开一个小轮**：总纲 §3 波三行本身没有把它列进波三边界（波三边界是 Case 主体化 + 拆大方法 + 直写 + `dispositionsFor` + 两个重复 helper），但这批 `as any` 分布里有一部分（审计写入 12 处、划转 workflow 2 处）与波三要动的文件（`internal-transfer-workflow.service.ts`）及事件流有重叠，波三如果重构这些文件时顺手清掉同函数内的 `as any` 成本很低；但若要系统性清完 26 处，工作量与波三本体（Case 主体分层）不是一回事，值得单独立项。这是一个真岔口——两种理解会导出完全不同的任务范围——留给波三新会话开工时先问业主或按"顺手清同函数内的、不为此单开任务"的默认口径处理，写进波三 spec 时明确二选一。
