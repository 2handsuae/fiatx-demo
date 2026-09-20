# 第六幕清残留 · 波三「主体分层」—— 设计稿

> 总纲：`superpowers/specs/2026-09-19-act6-recon-cleanup-charter.md` §3 波三行 ｜ 基线 main `f0ba4cd4`（波二合并点）
> 业主核准：2026-09-20 脑暴逐节过，七节设计无异议；待定岔口「26 处非 prisma `as any` 归宿」当场拍板**甲案·全收进波三**（销 `TOOLING-DEBT.md:143`）。
> 本文件吸收并取代 `2026-09-20-act6-wave3-skeleton.md`（承接记录全文并入 §A，骨架随本 commit 删除）。

## A. 承接上一波（波二「清死物」，2026-09-20 收官——自骨架原文并入）

- **实际偏差**：
  - Task 4「去 export」计划 30 个候选、实交 **29** 个：`WalletReconRunResult`（`wallet-recon-run.service.ts`）被 `ReconciliationAdminController.createWalletRun` 一个未标注返回类型的方法结构化推断消费（`tsc` 报 TS4053），去掉 `export` 会闸①红；按任务书铁规「闸红 = 有活消费者 → 加回、不许为过闸删使用方」，把 `export` 加回、从名单剔除。**判例**：字面 `grep -rlw` 重扫脚本抓不到「返回类型靠调用方结构化推断」这类消费，是扫描方法学的已知盲区，不是扫描数字错。
  - Task 8 `verify:rbac` 收尾**非全绿**：2 条 FAIL 经独立复核坐实为波前既有债——`TOOLING-DEBT.md:137`（S7 静态扫描器不认共用基类 `DemoScenarioControllerBase` 上的路由装饰器，三域 demo 裁决按钮共 4 条误判死行）+ `BACKLOG.md:228`（`CUSTOMER_WRITE` 权限组随裸 CRUD 端点整体删除后已零路由，但仍被两处角色绑定引用，变成空壳）。两条在 `git diff ac33c002 HEAD` 上与波二改动无关，main 分支原样复现同一对失败——波二零触碰，commit 文案（`28a410dc`）已如实标注。
  - Task 3/4/8 三处任务书笔误已在执行中消化，未产生实际影响（`IncidentListPage` 真名、"COA 5/5" 实为总断言数）。
- **执行中发现的新事实**：
  - 「去 export」重扫脚本的 `refs` 检索范围只覆盖 `src` + `admin-web`，`client-web` 与 `test/` 不在内——波二靠闸①②③ + jest 兜底过关，**不是脚本覆盖了这两侧**；未来对某符号下"零消费者"结论前必须先确认是否要补扫这两侧。
  - **写行防线已就位并通过三向变异实证**：`wallet-flow-matcher.service.spec.ts` 的值断言（matcher 层 `take()` push 携带 `externalTimestamp`）+ `wallet-recon-run.service.spec.ts` 的值透传断言与 **13 键白名单**（`Object.keys(payload).sort()` 逐键相等）——不携带 / 不落列 / 多一键三种变异各自独立触红，物证在 `checkups/2026-09-20-act6-wave2-evidence/mutation-{a,b,c}.txt`。
  - 对账三域 jest 基线现为 **28 suites / 556 tests**（波一 553 → 波二 +4 −1）。
- **波二交棒的三条新地基事实**（本波动手前提）：
  1. **死列已清**——11 根死列（含 `Incident.walletRef` 恒空管线）已随一次迁移出清，本波重构不会再遇到它们，也不需要为它们兼容。
  2. **export 面已收窄**——对账域 29 个符号已摘 `export`。本波拆大方法、抽 helper 时，新导出的符号**必须先有真实消费者才 `export`**，否则又长出下一批死导出。
  3. **写行防线会咬**——本波若动 `writeLineItems` 的位置或载荷形状，13 键白名单会红；键集合变更须同步更新白名单并补一次变异实证，**不许因闸红放宽断言**。
- **已定事实**：战役判据 1/2/3 已分别在波一、波二验收通过；**判据 4（Case 有自己的服务与显式迁移表、`status` 写点收敛、对账域 workflow 零直写表）是本波本体判据**。`verify:coa` 全绿、`verify:rbac` 仅余上述 2 条既有债 FAIL 是本波开工的干净基线。

## 0. 本波做 / 不做

**做**（总纲 §3 波三行 + 2026-09-20 甲案拍板）：

1. Case 立主体服务 + 显式迁移表，`status` 与全部 Case 表写点收敛
2. 拆 `getCase()` / `run()` / `buildFlowComparison()` 三个大方法
3. 铁律③ 直写一处修复（`internal-transfer-workflow.service.ts` 的 `approvalNo` 直写）
4. `dispositionsFor()` 六格补齐硬边界（`AMOUNT_MISMATCH×FIRM` 漏查 `sourceAdjustable`）
5. 抽 `walletRef→walletNo`、`decimals` Map 两个重复 helper
6. **26 处非 prisma `as any` 全清**（甲案），销 `TOOLING-DEBT.md:143`

**不做**（对照总纲 §1/§3 与 CLAUDE.md §2）：不动前端（admin-web 零 diff）｜不动业务日口径（波五）｜**不新增任何状态或边**（迁移表只登记现存的 `OPEN→RESOLVED`）｜不加新业务出路｜`RECON_CASE_OPENED` metadata 带 UUID 是波五的活，本波审计调用**只搬不改 payload**｜幂等 / 并发锁 / 防御性校验等 §2 清单一律不做。

## 1. 关键实测（2026-09-20 落笔当日全部在 HEAD `f0ba4cd4` 复现，数字不是估的）

### 1.1 Case 写点清册：全仓 5 处、2 个文件（比体检"散在 3 文件"还少）

```
grep -rn "reconciliationCase\.\(create\|update\|updateMany\|upsert\|delete\)" src --include='*.ts' | grep -v '\.spec\.ts'
```

| # | 位置 | 干什么 | status 语义 |
|---|---|---|---|
| 1 | `wallet-recon-run.service.ts:788` | 建案 | 初始 `OPEN`（入口态，不走迁移表） |
| 2 | `wallet-recon-run.service.ts:750` | 跨日复观察 update | 不碰 status |
| 3 | `wallet-recon-run.service.ts:960` | 自愈结案 | **`OPEN→RESOLVED`，唯一真实迁移** |
| 4 | `case-aging.service.ts:39` | SLA 破线置标 | 只置 `slaBreached`，不碰 status（decisions 2026-08-21 软破线） |
| 5 | `case-aging.service.ts:60` | ⚡拨钟 | 只改 `slaDeadline` |

代码中 Case 的 status 字面量只有 `OPEN` / `RESOLVED` 两个；raw SQL 零命中；`scripts/recon-demo.ts` 另有 2 处（`deleteMany` 清场 + `findMany` 读）是铺场夹具，不在"workflow 零直写"判据范围内（判据范围 = `src/` 运行时代码）。

### 1.2 三个大方法跨度（awk 按方法首行向下找 `^  }$` 收尾行）

| 方法 | 跨度 | 行数 | 所在文件 |
|---|---|---|---|
| `run()` | 112–442 | 331 | `workflow/wallet-recon-run.service.ts`（全文 1061） |
| `getCase()` | 373–786 | 414 | `domain/reconciliation-query.service.ts`（全文 1161） |
| `buildFlowComparison()` | 963–1160 | 198 | 同上 |

### 1.3 26 处非 prisma `as any` 分布（甲案范围，与 `TOOLING-DEBT.md:143` 逐族对上）

```
grep -rn " as any" src/modules/clearing-settle src/modules/governance/incidents \
  src/modules/asset-treasury/internal-transfers --include='*.ts' \
  | grep -v '\.spec\.ts' | grep -v "this\.prisma as any"     # → 27 行（26 实 + adjustment.service.ts:334 注释 1 行）
```

按文件：adjustment.service 8（7 实 + 1 注释）｜ wallet-recon-run 5 ｜ incidents.controller 4 ｜ reconciliation-query 3 ｜ internal-transfer-workflow 2 ｜ case-aging / case-aging-sweep / push-order / disposition / reconciliation-admin.controller 各 1。
按形态与修法（签名已核，全部有界）：

| 族 | 处数 | 修法（已对签名核实） |
|---|---|---|
| 审计写入 envelope `} as any` | 12 | `recordByActor`/`recordSystem` 的入参就是 `CreateAuditLogEventDto`（`audit-logs.service.ts:882/:984`），逐处对齐字段；不改 DTO 语义 |
| 记账边界 `resolveTbAccountId({...} as any)` | 4 | 真实入参是四字段小对象 `{code, ledger, ownerType, ownerUuid?}`（`accounting.service.ts:399`），补齐类型即可 |
| incidents controller `dto as any` | 4 | dto class 与 service 方法签名对齐 |
| 查询投影 | 3 | 全在 `getCase()` 内（:476/:605/:643），随 §2.2 拆分一起补类型 |
| 划转 workflow | 2 | :133/:143，随 §2.3 铁律③修复同方法顺手清 |
| TigerBeetle 返回值 | 1 | `wallet-recon-run.service.ts:539`，按 TB client 真实返回类型标注 |

### 1.4 重复 helper 底数

- **walletNo 反查**：裸 `wallet.findUnique(... select: { walletNo: true })` 纯反查 **5 处**（`disposition.service.ts:110/:248`、`adjustment.service.ts:544/:669`、`case-aging.service.ts:45`）；另有 2 处**混合 select**（`reconciliation-query.service.ts:460` 带 `ownerId`、`supplement-evidence.service.ts:150` 整行取用 `ownerId`/`walletNo`）——同款判定以 **select 集合相同**为准，纯反查 5 处必收敛，混合 2 处是否并入 plan 落地时定，不硬并。
- **decimals Map**：内联 `new Map(assets.map(a => [a.code, a.decimals]))` **5 处**（`reconciliation-query.service.ts:158/:260/:900`、`wallet-recon-run.service.ts:178`、`adjustment.service.ts:633`）。体检记 6，当日复扫现值 5（体检未逐处列名单，以本复扫为准；复现命令 `grep -rn "\.decimals\]" src/modules/clearing-settle --include='*.ts' | grep -v spec`）。

### 1.5 `dispositionsFor()` 现场（`disposition/cause-registry.ts:121-134`）

`AMOUNT_MISMATCH` 分支：`CLIENT` 侧查 `sourceAdjustable(facts.internalSourceType)` 才给 `CORRECT`；`FIRM` 侧 `else out.push('RECORD', 'REVERSE')` **不查**——而注册表注释（:114）明写"冲正/冲销只对 DEPOSIT/WITHDRAW 系来源开放"（decisions 2026-09-08 A1b 甲）。现种子铺不到 `AMOUNT_MISMATCH×FIRM` 组合，不挡演示，但真实数据凑出即给出账务上开不出的按钮（体检黄 1）。

## 2. 设计

### 2.1 Case 主体化（战役判据 4 本体）

- 新建 `constants/case-transitions.constant.ts`：照 `adjustment-transitions.constant.ts` 先例——`CaseStatus = { OPEN, RESOLVED }`，`CASE_TRANSITIONS = { OPEN: [RESOLVED], RESOLVED: [] }`。**只登记现存边，不新增**。
- 新建 `domain/reconciliation-case.service.ts`（注册进 clearing-settle module providers），§1.1 五个写点一对一收敛：`openCase()`（建案，入口态 OPEN）｜`reObserve()`（跨日复观察）｜`resolveAutoHealed()`（唯一迁移，进方法先 `assertTransition(row.status, RESOLVED)`，非法跃迁显式抛——照 `adjustment.service.ts:44` 先例）｜`markSlaBreached()`｜`rewindSlaDeadline()`（⚡拨钟）。
- **审计跟写点走**（铁律①）：`auditCaseOpened` / `auditCaseAutoHealed` 从 recon-run 搬进 Case 服务对应方法；拨钟留痕（`case-aging.service.ts:77`）随 `rewindSlaDeadline()` 搬。三处 **payload 一字不改**（UUID 问题归波五）。sweep 批次级留痕（`case-aging-sweep.service.ts:62`）是批次的痕不是单案的痕，留在原位。
- 收敛后终态：`grep reconciliationCase\.\(create\|update\|...\)` 在 `src/` 非 spec 范围内**只命中 `reconciliation-case.service.ts` 一个文件**（预期 5 处），workflow 与 aging 全走服务方法——判据 4 的"零直写"由此可机器复核。

### 2.2 拆三个大方法（行为零差异的机械拆分）

- `run()`：拆成有名步骤的编排（取钱包 / 跑匹配 / 聚桶 / 案件生命周期 / 落库），案件生命周期段自然被 §2.1 抽走。
- `getCase()`：就地拆私有方法，按现有段落切（案头组装 / 行明细 / 在途行 / 处置菜单 / 流向比对调用），主方法退化为编排。**不定行数硬指标**——切面跟业务段落走，可读性由评审判，行为由栈级 diff 判。
- `buildFlowComparison()` + 其私有配件：挪独立 injectable（`domain/flow-comparison.builder.ts`），query service 是它的真实消费者（满足"先有消费者才 export"）。
- `writeLineItems` 若随拆分挪位置：13 键白名单与值断言原样跟随；键集合不变则不需新变异实证，变了按波二规矩补，不许放宽。

### 2.3 铁律③ 直写修复（划转 workflow）

`internal-transfer-workflow.service.ts:130` 直接 `prisma.internalTransfer.update` 盖 `approvalNo`，而 `this.transfers`（`InternalTransferService`）就注入在旁——照 2026-09-15 `FundsOrderService.stampExternalRef()` 先例，`InternalTransferService` 加 `stampApprovalNo(transferNo, approvalNo)`，workflow 改调服务方法；同方法 2 处 `as any`（:133/:143）顺手清。

### 2.4 `dispositionsFor()` 硬边界

`AMOUNT_MISMATCH×FIRM` 分支改为：`RECORD` 无条件给（补记不是冲销），`REVERSE` 补 `sourceAdjustable(facts.internalSourceType)` 门。种子铺不到该组合 → 栈级 diff 仍应为空；行为由单测盯住（可及组合矩阵断言）+ 一次变异实证（拆门必红）。

### 2.5 两个 helper

- `walletNo` 纯反查 5 处收敛为一个小查询件（落点 plan 定，倾向 `domain/` 下独立 injectable 或 Case 服务同侧工具）；混合 select 2 处按 §1.4 口径处理。预期终态：裸 `select: { walletNo: true }` 的 `wallet.findUnique` 在三域归零。
- `decimals` Map 5 处收敛为纯函数 util（入参 assets 数组、出参 Map）。预期终态：内联构造归零。

### 2.6 26 处 `as any` 清法（甲案）

按 §1.3 六族逐族修；`adjustment.service.ts:334` 那行注释是**反对** `as any` 的说理（"人话 400，而不是靠 as any 掩盖类型缺口"），内容不过时、只是撞了复现命令的字面——微调措辞（如 `as any` → "`any` 断言"）保住原意，让复现命令**归零**（不留"预期 1 行"的尾巴）。
**熔断条款**：若某处摘除后暴露的类型冲突必须改行为才能解——停手报业主，不许为过闸改行为（行为零差异是本波唯一硬判据）；也不许把 `as any` 换成 `as unknown as X` 之类的等价逃逸糊过闸。

## 3. 任务分解（plan 细化，此处只定波次内顺序）

1. Case 迁移表 + 主体服务 + 五写点收敛 + 迁移表变异实证（判据 4 本体，最先——后面拆方法都踩在它上面）
2. 拆 `run()`（案件生命周期段已被 1 抽走，剩余机械拆）
3. 拆 `getCase()` + `buildFlowComparison()` 挪件 + 3 处查询投影 `as any`（同文件一次动完）
4. 铁律③ + 划转 2 处 `as any`
5. `dispositionsFor()` 硬边界 + 变异实证
6. 两个 helper 收敛
7. 其余 `as any` 扫尾（审计 12 − 已随 1–4 清掉的部分、记账边界 4、incidents controller 4、TB 返回值 1）+ 复现命令归零 + 销 `TOOLING-DEBT.md:143`
8. 收尾闸全套 + 承接记录写波四骨架

## 4. 交付清单命中行（对照 `rules/delivery-checklist.md`）

- 多波战役行：承接记录写进**波四 spec 骨架**开头（实际偏差 / 新事实 / 波四前提有无变化），回写总纲状态行，本 spec 归档
- 动了钱的域：`verify:coa` 照跑（虽零行为，记账边界调用点被动过）
- 测试新增：迁移表断言 + 处置门断言，各带一次变异实证入物证目录
- `TOOLING-DEBT.md:143` 销账（划掉并注明销账 commit）
- 不触发：前端截图闸（admin-web 零 diff）、重铺闸（不动 schema/seed）、权限三件套（不动 RBAC）

## 5. 闸与验收

| # | 闸 | 判据 |
|---|---|---|
| 1 | **栈级输出 diff**（唯一硬判据） | 波前基线跑 `demo:all` + `recon:demo:break` 存档，波后同跑，归一后逐字节 diff = **空**（归一规则沿用波一入档的六类天然变动值清单） |
| 2 | 闸①②③ | 全绿 |
| 3 | jest 对账三域 | 全绿；基线 28 suites / 556 tests + 本波新增，收尾报实数与归因 |
| 4 | 迁移表真实调用 | 变异实证：对已 `RESOLVED` 案再 resolve 被显式拒（测试红）；拆掉 `assertTransition` 该测试必红，还原复绿 |
| 5 | 处置门 | 变异实证：拆掉 `sourceAdjustable` 门，矩阵断言必红，还原复绿 |
| 6 | `as any` 归零 | §1.3 复现命令输出 **0 行**（含注释订正） |
| 7 | Case 直写归零 | §1.1 复现命令只命中 `reconciliation-case.service.ts`（5 处） |
| 8 | `verify:coa` | 恒等式 + 负余额全绿 |
| 9 | `verify:rbac`（若跑） | 预期仍是既有 2 条 FAIL（`TOOLING-DEBT:137` + `BACKLOG:228`）、其余全绿——多一条即本波回归 |

## 6. 风险与开口

- **审计 envelope 对齐可能牵出 DTO 面**：12 处对齐过程中若发现 `CreateAuditLogEventDto` 本身字段类型与真实用法冲突（而非调用方写错），只允许**收窄调用方**，不允许放宽 DTO；拿不准 → 熔断条款。
- **`reObserve` / 建案载荷形状**：Case 写点搬家时载荷必须逐字段等价搬运，禁止顺手"规整"字段——在途行 13 键白名单只护 line item，Case 行没有同款防线，本波搬运以栈级 diff 兜底（这正是把它列为唯一硬判据的原因）。
- **混合 select 的 2 处 walletNo 查询**：并入 helper 与否由 plan 定，判定标准已写死（select 集合相同才并），不留自由裁量。
- 波四前提：本波收尾后后端读面契约冻结，波四前端拆分踩在其上；若本波对任何 DTO 出参形状有非预期变更（不应有），必须在承接记录里点名。
