# 第六幕（V8 对账 ｜ 平账处置）· 全方面代码体检（主会话判读版）

2026-09-19 ｜ 体检对象 main `8d7bd7d6`｜ 目的：为「第六幕优化」这一轮摸底——代码结构 / 六条铁律 / 死码 / 文档腐烂 / BACKLOG §G 台账真伪，并给出优化路线 ｜ 方法与可信度分层见文末附录

> **基线说明（重要，关系到本报告能不能复现）**：取数跨了仓库压平那一刀。体检开工时 HEAD 是 `4c133c27`（旧布局，全部源码在 `Exchange_js/` 下），收尾时 HEAD 已是 `8d7bd7d6`（压平后，源码在仓库根）。**本报告一律按压平后的路径书写**——在 `4c133c27` 上这些路径要加 `Exchange_js/` 前缀才存在。已实证两段基线的代码内容等同：`git diff -M --numstat 4c133c27..HEAD` 在对账 / 事故 / 划转 / 管理台对账页 / `rbac.catalog` / `schema.prisma` / 相关文档这 105 个文件上**全为纯改名（0 增 0 删）**，唯二内容变更是 `BACKLOG.md` 与 `recon-cause-handbook.md` 各一行 spec 路径改指 `archive/`（不碰任何结论）；本报告引用最密的 6 个文件（`bucket-classifier.ts` / `reconciliation-query.service.ts` / `wallet-recon-run.service.ts` / `cause-registry.ts` / `ReconciliationCasesDetailPage.tsx` / `v8-recon.md`）经 `git rev-parse` 比对**旧新路径 blob 哈希逐个相同**。故所有结论在 `8d7bd7d6` 上原样成立。路径层级本身的来历见 `CHANGELOG.md` 压平那几条。

判色口径：**红** = 违反铁律或命中评审三判据 ｜ **黄** = 漂移、死码、不一致，不挡演示 ｜ **绿** = 逐项核过有证据。

**一句话总评：第六幕业务侧扎实，病灶全部挂在同一条因果链上。** 五桶判定 / 账龄 3 天 / 小额线按币种 / 三轮匹配 / 内部恒等预门 / 审批链 / 记账边界（调账三四族无资金单、划转与补单三路有）逐项核过属实；31 条端点**零死路由**；铁律 ①②⑤⑥ 无违例——记账调用零 `.catch`，失败会传播；对账域 jest **29 suites / 555 tests 全绿**，随手闸 tsc ①全绿。问题是这条链：**对账域没有主体服务层** → Case 的状态写点散在 3 个文件、无迁移表 → `getCase()` 涨到 414 行、`run()` 329 行、案件页 1893 行 → **137 处 `as any` 让闸①对整个数据层失明** → 域内唯一该兜底的那条网格断言在 TypeScript 下**恒真** → 于是一根**全仓零写入**的列（`externalTimestamp`）一路走到屏幕上，让每条在途差异行的 Time 列恒显 `01-01 04:00`，18 场景演了 10 波无人发现。**三条红全在这条链上，链头（`as any` + 恒真断言）是闸门失效、不是洁癖。**

## 底数

| 项 | 数 | 复现命令 |
|---|---|---|
| 闸①后端 tsc | 绿 exit 0 | `npx tsc --noEmit -p tsconfig.json` |
| 闸④对账域 jest | **29 suites / 555 tests 全绿** | `DATABASE_URL="file:/tmp/exchange_js_main/dev.db" npx jest src/modules/clearing-settle src/modules/governance/incidents src/modules/asset-treasury/internal-transfers` |
| 后端代码 | 54 文件（32 非 spec）/ 13864 行 | `find src/modules/clearing-settle -name '*.ts' \| wc -l` |
| 三个千行 service | query 1161 ｜ recon-run 1058 ｜ adjustment 1004 | `wc -l` |
| 最大单方法 | **`getCase()` 414 行**（373–786）｜`run()` 329 ｜`buildFlowComparison()` 198 ｜`listCases()` 160 ｜`createDraft()` 154 ｜`onApproved()` 157 | `grep -n 'async \|private ' <file>` 取行号差，四个最大的逐个 `sed -n` 核过真实收尾行 |
| 管理台 | 7 页 + 3 弹窗 = 5606 行，**`ReconciliationCasesDetailPage.tsx` 1893 行**、`AdjustmentCreateModal` 821；事故 2 页 894 行 | `wc -l admin-web/src/pages/Reconciliation*.tsx …` |
| 演示 | **18 场景 / 12 案**（manifest `scenarioId` 实为 1–18）｜剧本 **57 行，七幕最长**（其余 6/37/38/29/31/6） | `grep -oE "scenarioId: [0-9]+" scripts/recon-demo.ts \| sort -u`；`grep -n '^## 第' doc-final/demo/script.md` |
| 成因码 | **20 + `OTHER`**（`CAUSE_REGISTRY` 21 键）｜`DispositionKind` 8 种 | 逐键数 `CAUSE_REGISTRY` 块 |
| 审计码 | `V8_RECON_AUDIT_ACTIONS` **9 码** ✓ 与文档一致 | `awk 'NR>=858 && /^};/{exit} NR>=858' src/modules/audit-logging/constants/audit-actions.constant.ts \| grep -cE "^  [A-Z_]+:"` |

## 六轴判色

| 轴 | 判色 | 一句话 |
|---|---|---|
| ① 业务逻辑对不对 | **绿偏黄** | 状态机 / 桶 / 账龄 / 小额线 / 审批链 / 记账边界全核过属实；一处矩阵漏硬边界（黄1） |
| ② 铁律六条 | **绿偏黄** | ③ 一处直写（黄2）、④ Case 无迁移表（黄3）；①⑤⑥ 核过无违例 |
| ③ 代码读得懂吗 | **红** | 414 行单方法、1893 行单页、Case 主体无服务层写点散 3 文件 |
| ④ 闸门咬得动吗 | **红** | 137 处 `as any` + **3 条恒真断言**（见「测试的绿从哪来」） |
| ⑤ 前端 | **绿** | UI 中文 **0**（扫出的全是注释）；文件过大归轴③ |
| ⑥ 文档对不对 | **黄** | 5 处数字腐烂 |

## 🔴 红 1 —— 137 处 `as any` 让闸①对整个对账域数据层失明

证据三段，自己接得上：

1. `PrismaService extends PrismaClient`（`src/core/prisma/prisma.service.ts:5`）——类型是全的
2. 8 个对账域模型**全在生成的 client 类型里**：`for m in reconciliationCase reconciliationAdjustment reconciliationDisposition externalStatementLine incident internalTransfer reconciliationLineItem reconciliationRunWallet; do grep -c "get ${m}()" node_modules/.prisma/client/index.d.ts; done` → 逐个为 1
3. **同一个文件里两种写法并存**：`reconciliation-query.service.ts:96` 写 `this.prisma.reconciliationCase.findMany`（有类型）、`:374` 写 `(this.prisma as any).reconciliationCase`（无类型）——同一模型、同一文件、两副面孔

分布（`grep -rn "this\.prisma as any" src --include='*.ts' | grep -v '\.spec\.ts'`）：**clearing-settle 137**（全仓最高）｜trading 116｜identity 29｜accounting 29｜governance 25｜asset-treasury 24 = **全仓 360**，对照有类型的 `this.prisma.<model>` 只有 **274**。

**不是洁癖**：`TOOLING-DEBT.md:97` 已有同病判例在账——Wallet 砍掉 `assetId` 列后 `demo-in-transit.ts` 照旧查它，**tsc 全绿、一跑就炸**，原文根因写的就是「`any` 让 tsc 拦不住」。对账域是全仓最大的同款盲区，且是动钱的域；红 3 就是它的直接产物。

**分诊**：过 CLAUDE.md §1 三问（攻击者？故障？并发？）**一条不占** → 不是技术兜底、不进 `PRODUCTION-NOTES.md`；它是**闸门失效** → 归 `TOOLING-DEBT.md`（该桶规矩是「要读要清」）。

## 🔴 红 2 —— 测试的绿从哪来：3 条恒真断言

| # | 位置 | 为什么不可能红 |
|---|---|---|
| 1 | `engine/v2/bucket-classifier.spec.ts:17-30`「180 组网格」 | 只断言 `expect(buckets.has(b)).toBe(true)`，而 `computeBucket` 的返回类型**就是**那 4 个字面量的联合、每条分支都返回字面量 → TypeScript 下恒真。`v8-recon.md:38` 拿它当「验证互斥」的判据 |
| 2 | `domain/reconciliation-case-idempotent-fields.spec.ts` 用例 1 | `grep -c "^import"` = **0**。自建 `prisma: any`，`create` mock 用 `{ id: 'c-new', ...data }` **原样回显**，再断言回显值等于自己刚塞进去的值 |
| 3 | 同文件用例 2 | 自建 `stored` 数组 + 自建 `findMany` mock 在里面做 `filter`，再断言 filter 生效 |

后两条整个文件 67 行、**零生产代码执行**，却被根 jest 实跑（`jest.config.js` 的 `roots` 含 `src`），计入那 555 个绿。照 `review-rubric.md`「测试的绿必须来自行为；发现『扫源码文本』型断言按第 3 条立缺陷」——这比扫文本更弱。

## 🔴 红 3 —— 在途行的时间列恒显 `01-01 04:00`（演示场景 1 第一眼）

读写断链，三层各有证据：

| 层 | 证据 |
|---|---|
| 写 | `ReconciliationLineItem.externalTimestamp` **全仓零写入**。`grep -rn "externalTimestamp" src --include='*.ts' \| grep -v spec` → **只 1 处命中且是读端**；`grep -c externalTimestamp <(sed -n '825,912p' src/.../wallet-recon-run.service.ts)` → **0**（`writeLineItems()` 四个 create 块都没设） |
| 读 | `domain/reconciliation-query.service.ts:703`（`getCase()` 的 **IN_TRANSIT 行**分支）`li.externalTimestamp ? li.externalTimestamp.toISOString() : new Date(0).toISOString()` → 永远走 fallback 到 epoch |
| 屏 | `ReconciliationCasesDetailPage.tsx:1390` `const timestamp = ext?.timestamp ?? intl?.timestamp ?? null`（在途行的 `internalFlow` 后端显式 = `null`）；`:1467` `{timestamp ? shortTimestamp(timestamp) : '—'}` —— epoch 字符串 truthy 故照渲染。`shortTimestamp`（`:282`）**不输出年份**，实算 → **`01-01 04:00`**：不是一眼可辨的 1970，而是一个看着挺真的「1 月 1 日」 |

**打到哪**：剧本**场景 1**（Alice AED 在途案，全幕开场「钱在路上，不是差异」）+ 场景 16/17/18 的补款 / 垫款在途案（琥珀）。连带 `rowTimestamp()`（`:303-306`）拿它排序，在途行恒排最旧。

判据②「显示的内容错了」。修法二选一（不要都做、不写兼容层）：甲 = `writeLineItems()` 在途分支把外部行真实时间戳写进该列；乙 = 该列退役，读端不再 fallback、如实下发 `null`，前端落既有 `'—'` 分支。

## 🟡 黄

1. **`dispositionsFor()` 六格里有一格漏了硬边界** —— `disposition/cause-registry.ts:122`：`AMOUNT_MISMATCH×CLIENT` 查 `sourceAdjustable`、`ORPHAN_INTERNAL` 两个 book 都查，唯独 `else out.push('RECORD','REVERSE')`（即 `AMOUNT_MISMATCH×FIRM`）**不查**——而它上方 3 行的注释正写着「冲正/冲销只对 DEPOSIT/WITHDRAW 系来源开放」（decisions 2026-09-08 A1b 甲）。现种子铺不到该组合，故不挡演示；真实数据凑出即悄悄给出账务上开不出的按钮。
2. **铁律③ 同款违例漏网一处** —— `asset-treasury/internal-transfers/internal-transfer-workflow.service.ts:130` `(this.prisma as any).internalTransfer.update` 直接盖 `approvalNo`，而 `InternalTransferService` 已注入（`:47`）。**同文件 `:220` 的 `fundsOrder` 直写已于 2026-09-15 加 `FundsOrderService.stampExternalRef()` 修掉（本次复现，BACKLOG 那条 `[x]` 站得住）**，`:130` 这条同形态没人动。写的是自己主体的表，故判黄不判红。
3. **Case 主体没有服务层、没有迁移表** —— `status` 写点散在 `wallet-recon-run.service.ts:799`（create OPEN）/`:960`（update RESOLVED）+ `case-aging.service.ts:36`/`:57`；`:957` 是裸 `(this.prisma as any).reconciliationCase.update({ status: 'RESOLVED' … })`。对照 Adjustment 有 `constants/adjustment-transitions.constant.ts` 4 态 3 边且被 `assertTransition`（`adjustment.service.ts:45`）真调。**这是 `run()` 329 行、文件 1058 行的结构根因。**
4. **运营侧栏不止一个页** —— 运营持 `INTERNAL_TRANSFER_READ`（`rbac.catalog.ts:1127`）→ `GET /admin/internal-transfers`（`:435`）→ 前端 `PERMISSIONS.INTERNAL_TRANSFERS_READ = 'api.get.admin_internal_transfers'` → 侧栏 Custody 组 **Internal Transfers**（`DashboardLayout.tsx:270`），即场景 16/17 的划转单页。剧本注③写死「运营只剩 Funds Orders 一个只读列表页」，**讲不圆**。decisions 2026-09-10 那条只点了六个组，没点这个。
5. **两个幽灵入口**（`delivery-checklist` 点名的「点得到、点了没反应」）—— `ReconciliationCasesListPage.tsx:74` `STATUS_OPTIONS` 有 `WAIVED`「Waived」筛选项 + `:97`/`:105` 配了徽章文案，后端**从不产生**（对账域 `'WAIVED'` 零命中；全仓那几个 `DEPOSIT_LIMIT_WAIVED` 是充值域审计码，不相干）→ **点了必空列表**；同文件 `:95`/`:106` 还有 `PENDING_RECHECK` 死分支（后端只有 `OPEN`/`RESOLVED` 两态）。

## 文档数字腐烂 5 处

| 处 | 写的 | 实际 |
|---|---|---|
| `modules/v8-recon.md` :16/:36/:38/:110 **+ `bucket-classifier.ts:1` 注释** | **五桶** | **4 桶**：`ReconBucket = 'MATCHED'\|'IN_TRANSIT'\|'COMPENSATING'\|'BREAK'`。`INTERNAL_BREAK` 是 **run 状态**不是桶（`wallet-recon-run.service.ts:76`）。错误源头在代码注释里、被文档抄了 4 遍 |
| `modules/v8-recon.md:113` | 21 个成因码 + `OTHER` | **20 + `OTHER`**。同一文件的划转段已写「成因表 21 → 20（`FIRM_TRANSFER_UNTRACKED` 退役）」，`decisions.md:65` 同——**现状唯一真相的文件内部自相矛盾**。（退役本身干净：该码仅 3 处命中 = 1 条退役注释 + 2 条 spec 反向断言） |
| `scripts/recon-demo.ts:133` | `15-scenario model` | 18（同文件 `:13` 写的就是 18） |
| `reference/recon-cause-handbook.md` §四附录（`:306-332`） | 15 场景 10 案 | 18 场景 12 案——**演示者按号索引会翻错页**（BACKLOG 已在案，本次实证仍真） |
| `CHANGELOG.md` :41 与 :43 | — | **字节级重复**（`sed -n '41p' \| md5` 与 `43p` 同值），平账一期半那条记了两遍 |

## 死码底数

| 类 | 数 | 备注 |
|---|---|---|
| 零消费端点 | **0 / 31 条路由** | 本次唯一全绿类别（5 个 controller 逐条在 admin-web 找到调用方） |
| 死 schema 列 | **12** | 主会话逐根复现 6 根：`reimbursementObligationId`（特性已删）/ `internalTxHash` / `externalSource` / `resolutionMemo` / `statementId` / `rawRef` —— schema 各声明 1 次，`src`(非 spec) 与 `admin-web` **双侧零引用**。另 `externalTimestamp`（= 红 3 根因）、`Incident` 三根（`customerId` / `sourceExternalLineId` 零读零写；`walletRef` 结构上可写但登记表单没这个输入框，故恒空——`IncidentDetailPage.tsx:271` 的 Wallet 字段永不出现） |
| 不可达枚举 | 4 组 6 值 | 含上面两个幽灵；另 `resolutionReason` 声明 3 值只产生 `AUTO_HEALED`（`MANUAL_RESOLVED` 对应「人工核实路径未做」，与文档一致不算缺陷）；`ReconciliationLineItem.matchStatus` 注释声明的 `MATCHED`/`INVARIANT` 从不产生，而真实产生的 `IN_TRANSIT` 反而不在注释里 |
| 零调用导出 | 38（**3 个彻底死**：`InternalTransferFailureReason` / `AdjustmentStatusValue` / `IncidentStatusType`） | 余 35 是 `export` 多余、逻辑活着——建议去 `export`，不删函数体 |
| 孤儿 spec | 1（67 行） | = 红 2 的后两条 |
| 重复块 | 3 组 | `walletRef→walletNo` 单行查询 **6 文件 8 处**无 helper；`asset.decimals` Map 6 处（`reconciliation-query.service.ts` 自身内部就重复 3 次）；金额 minor→major 换算算法重写一遍（`AdjustmentCreateModal.tsx:178-186`，而该文件 `:36` 已 `import { formatAmount }`） |

估可删 ≈ 130 行。对账域此前已自主清理 5 轮（`cause-registry.ts` 头注释自述 2026-09-02/03/05/06/08），底子干净，新债集中在「字段声明了但从未接线」。

## BACKLOG §G 逐条复现（抽查 12 条）

| 判定 | 条 | 实证 |
|---|---|---|
| **仍真** | 8 | UTC 切日（`business-date.util.ts:2` 仍 `toISOString().slice(0,10)`）｜`computeSeverity` 单阈值 `10_000n`/`100n` 跨币种不可比（AED 100 与 USDT 0.01 同判 HIGH）｜`RECON_CASE_OPENED` metadata 仍带 `walletRef` UUID（`wallet-recon-run.service.ts:986`）｜钱包枚举仍由 `externalBalance.findMany({where:{cutoffDate}})` 驱动（`:152`），缺外部快照的内部钱包静默漏对｜`push-order.service.ts:105` 只拒 `swapTransactionId`，划转腿可达（全文零 `internalTransfer` 判断）｜SWAP 无冲正/冲销码｜`treasury/` vs `custody/` 前缀（同组三页两前缀，`DashboardLayout.tsx:257/263/270`）｜手册附录落后三波 |
| **表述过期** | 1 | `rowAdjustmentPrefill().direction` 仍真，但在 **`:330-337`** 不是原文的 `:327`（函数起 `:318`）；确认是纯符号推导、无提现语义翻符号 |
| **已绕开未修** | 1 | case 级 `reObservedCount` 恒 0 仍在算（`:758`）、仍在 DTO 里下发（`:768`），前端已不渲染（decisions 2026-09-07）。**注意别误判**：run 级那个 `reObservedCount` = `casesReObserved` = `casesUpdated`（`:411/423/434`）是另一个数、真会自增，Runs 详情页渲染它**不是 bug** |
| **勾选站得住** | 1 | `fundsOrder` 直写已修 ✓（`FundsOrderService.stampExternalRef` 在 `funds-order.service.ts:205`，workflow `:220` 真调、`:219` 带铁律③注释） |
| **未深挖** | 1 | `incidents` 三根低写入列（与原文一致，B 员补了「walletRef 无调用方填」这一层） |

### §G 全 26 条未闭条目分诊（为优化路线服务）

§G 实为 **28 条顶层条目**：26 条未闭（`- [ ]`）+ 1 条 `- [x]`（`fundsOrder` 直写，本次复现勾选站得住）+ 1 条删除线（大额查不出死胡同，2026-09-08 已解）。下表分诊的是那 **26 条未闭**的。其中带 ⭐（业主标「带同事走七幕时会当场看到或讲不圆」）共 **4 条**，逐条落点：

| ⭐ 条目 | 本次判定 |
|---|---|
| `INTERNAL_BREAK` run 详情误显示空表 | **该做·演示可见**——预门破时 `walletCount=0` 渲染成空表，看着像干净，是本幕最危险的一条 |
| 对账复核签核未做（平账动作 maker-checker） | **待业主拍板**——动审批链 |
| 数据完整性闸 + `HELD` 态未做 | **缓**——要真实账单摄入管道才触发得到，模拟件演不出（§1） |
| 真差异处置闭环：十件处置全部交付 | **该销账**——非待办。`modules/v8-recon.md` §6 已列十件全覆盖（推单/冲正/冲销/补记/改记/挂起/核销/补单/划转/事故登记），条目内文也逐件标了「已交付」；只剩两项 deferred（COMPENSATING 真两侧对冲错的调账、Finance 人工核实结案）。建议下一轮把这条拆成「已交付部分销账 + deferred 两项另立一行」 |

| 判定 | 条数 | 代表 |
|---|---|---|
| **该做·演示可见** | **7** | ⭐ `INTERNAL_BREAK` run 详情**显示成空表、看着像干净**（危险）｜严重度跨资产不可比（案件页徽章可见）｜推单页对划转腿方向误标 IN｜手册附录落后三波｜`RECON_CASE_OPENED` 留痕带 UUID（铁律⑥）｜`treasury/`vs`custody/`｜无主入金无退回出口（判据①「结局不完整」） |
| **归清地基波顺手清** | 3 | `incidents` 三根死列｜`reObservedCount` 死计算 + 死 DTO 字段｜（红 3 的 `externalTimestamp`） |
| **缓·演示触发不到** | 9 | ⭐ HELD 态与数据完整性闸｜枚举源静默漏对｜match tag 结转｜`effectiveDate` 语义｜swap 腿推单｜补录被拒客户重报被吞｜事故通报超时软标 等。**理由：CLAUDE.md §1「演示者带同事走一遍流程时看不到、讲不到的东西，不做」**——这类要真实账单摄入管道才触发得到，而外部账单本身就是脚本铸的模拟件。要做需业主给新事实（如「要接真账单」） |
| **不做·已定案或撞 §2** | 5 | SWAP 冲正码（业主拍板）｜手续费归集（等报表层）｜法币腿 2 失败（故障场景）｜边界线守卫只查存在（明文留档不修）｜豁免容差 |
| **待业主拍板** | 2 | **业务日 UTC → 迪拜 COB**（财务硬需求，演示只在场景 9 擦边）｜⭐ **对账复核签核**（平账动作要不要 maker-checker 两人门）。两条都动状态机 / 审批链，一旦要做波次划分需重做 |

## 优化路线（四波总纲雏形，尚未定稿）

2026-09-19 业主已勾定范围 = **甲结构治理 + 乙台账清账 + 丙演示密度**三项全要。但两件事**当时未回、总纲不能定稿**：① 上面「§G 全 26 条未闭条目分诊」里「缓 9 条」这一刀业主认不认；② 「待业主拍板 2 条」（业务日改迪拜 COB / 平账动作加两人复核门）要不要做——这两条都动状态机与审批链，一旦要做，下表波次划分需重做。**正式总纲另立文件（`specs/`），本节只是体检给出的雏形。**

| 波 | 做什么 | 为什么这个顺序 | 验收 |
|---|---|---|---|
| **一 · 闸门复位 + 清地基** | 摘 137 处 `as any`｜删 12 死列 / 3 彻底死导出 / 1 孤儿 spec / 2 幽灵入口｜3 条恒真断言换真断言｜顺手收红 3 与 3 条死码型 §G | **必须第一**：给后面每一波装上「改错了会红」的安全网。现在没有这张网，后面每一波都是蒙眼动刀 | tsc 全绿 **且变异测试证明它能红**（故意改个列名必须红） |
| **二 · 主体分层** | 给 Case 立主体服务 + 显式迁移表（照 Adjustment 先例）｜拆 `getCase()` 414 行、`run()` 329 行｜抽 `walletRef→walletNo`、`decimals` Map 两个 helper | 依赖波一的网 | `demo:all` + `verify:coa` **零行为差异** |
| **三 · 前端拆分 + 判断收回后端** | `CasesDetailPage` 1893 行、`AdjustmentCreateModal` 821 行｜前端自算业务判断（含 `rowAdjustmentPrefill` 翻符号、黄1 的矩阵不对称）收回后端 | 依赖波二定下的读面契约 | 截图逐页零差异 |
| **四 · 演示面收口** | §G 的 7 条演示可见项 + 主线/深潜分档 + 5 处文档数字 + `CHANGELOG` 去重 | 前三波把地基弄对了才谈得上重排怎么演；主线该留哪几场取决于修完后哪些场景讲得圆 | 按新剧本实走一遍 |

## 附录 · 方法与可信度分层

派 6 名 sonnet 取数员（业务逻辑 / 死码 / 文档 / 前端 / BACKLOG 腐烂 / 六条铁律）。**A 员（业务逻辑）交回；4 名同批撞 `ConnectionRefused` API 错误挂掉；B 员（死码）重派后交回。** 挂掉的四块（文档腐烂 / 前端 / BACKLOG 腐烂 / 六条铁律）**由主会话用 bash 直接取数**，未再赌子代理。

- **主会话亲自复现过**（可直接采信）：全部三条红的每一层 ｜ 全部黄 1–5 ｜ 全部 5 处文档腐烂 ｜ §G 抽查的 12 条 ｜ 6 根死列 ｜ 孤儿 spec 两个用例全文 ｜ 桶数 / 成因码数 / 场景数 / 审计码数 / RBAC 绑定 / 方法行号 / 文件行数 ｜ 铁律 ①③④⑤ 的写点与审计点清册 ｜ UI 中文 = 0
- **取数员交回、主会话未逐条复现**（引用前请自验）：「零消费端点 0 / 31」（正向结论，误报风险低）｜38 个零调用导出的完整名单 ｜12 根死列里未抽查的那 6 根 ｜3 组重复块的精确行数
- **本次纠正的自身失误**：① 主会话初读误报对账域 56 文件，实为 **54**（A 员纠回）；② 首轮中文扫描只排了行首 `//`，尾注与 JSX `{/* */}` 漏进来造成 66 处假阳性——实为 **0**
- **判例（供后续轮次）**：`(this.prisma as any)` 是本仓库最大的闸门盲区形态，判「某列死/活」必须同时搜 `src`(非 spec) 与 `admin-web` **两侧**，因为 tsc 不会替你发现断链 ｜ 恒真断言有两种形态——**返回类型即断言集合**（桶网格）与 **mock 原样回显**（孤儿 spec），两者都能在 555 个绿里藏住 ｜ 同名字段可能有两个语义（`reObservedCount` 的 run 级真、case 级恒 0），判 bug 前先分清是哪一个
