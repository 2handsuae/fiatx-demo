# 第六幕清残留 · 波四「前端拆分」—— 设计稿

> 立于 2026-09-20 ｜ 基线 main `9cdbbacc` ｜ 总纲：`superpowers/specs/2026-09-19-act6-recon-cleanup-charter.md`（本文件只写细波四，波次边界以总纲为准，「3 组重复块」所指订正见 §4 并已回写总纲）
> 依据：`superpowers/checkups/2026-09-19-act6-recon-checkup.md` + 波三承接（原骨架 `2026-09-20-act6-wave4-skeleton.md` 已整体吸收进下节，文件随本稿删除）
> 基线有效性：`git diff --name-only 912ebefe..9cdbbacc` 只命中两份归档文档、src / admin-web 零命中——波三收官时的全部结论在本基线原样成立。

## A. 承接上一波（波三「主体分层」，2026-09-20 收官——自骨架原文并入）

- **后端读面契约波三零变更（本波前提）**：T6 的 `getCase()` 拆分与 `buildFlowComparison()` 挪件逐字段核实返回 DTO 不变，两份归一 diff（`demoall-diff.txt` / `break-diff.txt`）逐字节为空（物证 `checkups/2026-09-20-act6-wave3-evidence/`）。本波可以放心假设当前接口契约稳定。**本波自己会打破这个「零变更」——以受控加法的方式**（§2.1，只加字段不改既有字段，预期 diff 白名单见 §6）。
- **波三实际偏差**（与本波直接相关的两条）：① `run()` 拆分后余 190 行，评审认可「编排层本身的解释」——本波行数目标同一口径，是预期不是硬闸；② `" as any"` grep 照不到的类型逃逸残留形态已登记 `TOOLING-DEBT.md`（`const subjects: any[]` 三处 + `as unknown as string[]` 一处），纯后端内部债，不影响本波。
- **新事实**（骨架原文照录）：`recon-demo.ts` 的 break 清单落盘路径写死 `/tmp/exchange_js_main/recon-demo-manifest.json`（self 栈跑批也写 main 路径，既有行为，已登记 `TOOLING-DEBT.md`）——本波 T0 对照组若用该产物做物证，注意它落在 main 路径。`recon-run` 顶部 `AuditActions` 死 import 系波前既有，留终审分诊。
- **判据达成事实（本波开工的干净地基）**：Case 写点全仓唯一文件（5 处）；三域非 prisma `as any` 归零；jest 对账三域基线 **29 suites / 561 tests**；`verify:coa` 全绿（4 恒等式 + 57 科目负余额）。
- **骨架预告的核对已做**：波四范围与代码现状**确有出入**——总纲「3 组重复块」中两组（`walletRef→walletNo`、`decimals` Map）是后端件、已被波三收走；波四真实面对的重复块按 §1.2 重扫清册为准（§4 订正）。
- **骨架点名的「前端是否有自己一份按钮启用逻辑」已核**：没有——处置按钮矩阵渲染自后端下发的 `row.dispositions`（`ReconciliationCasesDetailPage.tsx:1542`），前端不重算启用性。波三 `dispositionsFor()` 补的 `AMOUNT_MISMATCH×FIRM` 硬边界对前端是透明的。

## 0. 本波做 / 不做

**做**（六件）：

1. **调账预填收回后端**：`FlowComparisonRow` DTO 加 `adjustmentPrefill`（后端按 `signedDeltaSign` 同一份公式算，出账翻符号的修复随收编到位）；case 级读面加归一化 `adjustmentBook`
2. **前端三处方向/预填推导退役**：页面 `rowAdjustmentPrefill` 删、弹窗 `deriveKindDirection` 删、`buildAdjustLocked` 的 side 镜像改读下发字段；`explainedSumMinor` 与 `adjustmentBook` 镜像同步改读
3. **拆 `ReconciliationCasesDetailPage.tsx` 1893 行**：共享类型 / bigint-safe 金额工具 / 色调词表抽到 utils 层（解掉 6 处反向 import），5 个内联组件外迁，Differences 大表拆独立组件
4. **拆 `ReconciliationAdjustmentCreateModal.tsx` 821 行**：按锁定视图 / kind 模式的缝拆子区块，金额工具改用共享件；**顺手删结构性不可达的「自由选择」分支与 `REASON_META` 空表**（翻案点，见 §2.3，业主对本稿点头即视为认可）
5. **重复块收敛**：分→元换算对账域 4 处收 1、`TONE_CLASSES` 2 处收 1（方向推导由第 1-2 件收编，不在前端收敛）
6. **顺手摘**：页面 `MATCH_LABEL` 零外部消费，摘 `export` 保常量

**不做**（对照 CLAUDE.md §2 与总纲 §1、§3 波四行）：

- **不改任何交互与文案、不改按钮矩阵的业务含义**——拆分只搬代码不改 JSX 语义，类名逐字保留（截图像素同构是闸）
- **账本域 2 处金额换算 fork 不动**（`LedgerAccountList.tsx:63` / `AccountFlowList.tsx:77`，§1.2 复现命令扫出的同款，非第六幕文件，动它就要多验两页，收益配不上验收面扩张）
- **`utils/number-format.ts` 浮点家族不合并**——其他域在用的展示格式化，与对账域 bigint-safe 字符串家族语义不同（浮点会丢 USDT 6dp 大数精度），只在共享件注释里划清边界
- **「读行上已有字段 / 纯展示」的前端逻辑不算自算判断，不收编**：`openWriteOff` 的事故/账龄来源判定（读 `disposition.incidentNo`，注释明言「同一份判据前端不重算」）、`sortedFlows` 排序与 `MATCH_RANK`、`caseConclusion.ts` 文案组装、「升级事故」防重复入口（读 `kase.incidents`，注释明言是设计决定）
- 不动业务日（波五）、不加新业务出路（下周新功能轮）、不做幂等 / 防御性校验 / 性能优化（§2）

## 1. 关键实测（2026-09-20 落笔当日全部在 HEAD `9cdbbacc` 复现，数字不是估的）

### 1.1 方向推导：同一公式三份，前端两份一对一错

| 份 | 现场 | 出账翻符号 |
|---|---|---|
| 后端真相 | `disposition/cause-registry.ts:162` `signedDeltaSign()`（`:155-161` 注释即推导：提现内部记 90 银行实扣 100，原始差 +10 是客户余额多出来的，得减） | ✅ |
| 弹窗镜像 | `ReconciliationAdjustmentCreateModal.tsx:130-140` `deriveKindDirection()`，注释自述「镜像后端 cause-registry.ts」 | ✅ |
| 页面预填 | `ReconciliationCasesDetailPage.tsx:318-356` `rowAdjustmentPrefill()`，AMOUNT_MISMATCH 分支（`:330-337`）裸符号推导 | ❌ = `BACKLOG.md:176` |

同一条提现类 AMOUNT_MISMATCH 行，走 kind 按钮方向对、走预填方向错。种子铺不到该组合（BACKLOG 原文「非结构性排除」），演示不可见，但两条路径互相矛盾本身就是收编的铁证。**后端已有收编先例**：`FlowComparisonRow.nextStep`（`dto/reconciliation.dto.ts:202-214`）注释明言「服务端算（前端不自己拼真相）：WRITE_OFF 带开单预填四项」，实现即 `cause-registry.ts:178` `resolveWriteOff()`——本波的 `adjustmentPrefill` 照此先例。

`rowAdjustmentPrefill` 全部消费点（4 处，届时全部改读下发字段）：`:871` openAdjustKind、`:900` REATTRIBUTE 交接、`:381` buildAdjustLocked 取金额拼候选 URL、`:1100-1103` Hero 结论句 `explainedSumMinor` 求和。另 `buildAdjustLocked:380` 自算改记 side（`ORPHAN_INTERNAL→FROM 其余→TO`，注释自认「与 disposition.service.ts listReattributionCandidates 的约定同源」）；`:1091` `adjustmentBook` 归一化镜像（注释自认「两边归一化写法必须一致，否则……提交却 400」）。

**本稿新坐实：该函数的 IN_TRANSIT 分支（`:346-353`，含 `relatedOrderNo` 预填）与 MATCHED 兜底（`:354-355`）都是不可达死支**——4 个消费点全部只能在三类异常行上触发：开单/定性按钮唯一渲染入口是 `row.dispositions!.map`（`:1561-1565`），而 `dispositions` 只挂三类异常行（后端 `:651` 守卫跳过 MATCHED/IN_TRANSIT，IN_TRANSIT 行在注解段之后才追加）；`explainedByAdjustmentNo` 亦「三类异常行才有」（DTO `:158-160` 注释）。`relatedOrderNo` 的活消费只有弹窗 `:307` 的 kind 模式（读 `row.internalFlow.sourceNo`，不经预填）与锁定路径恒 `''`。故后端 prefill **不需要 relatedOrderNo 字段**，两条死支随函数删除一并消失。

### 1.2 重复块清册（三组之外无第四组，搜法见各行）

| 组 | 处数 | 现场 | 复现命令 |
|---|---|---|---|
| 分→元换算（bigint-safe padStart 同核） | 对账域 **4**（另有账本域 2 处不做，见 §0） | 页面 `formatAmount`（`:251`，千分位展示版，被 4 文件 import）｜`ReconciliationAdjustmentDetailPage.tsx:61` fork（注释自认「同款一致写法」）｜`ReconciliationRunsDetailPage.tsx:131` fork｜弹窗 `minorToDisplay`（`:178`，无千分位回填变体，语义确实不同但同核，共享件里做两个导出） | `grep -rn "padStart(decimals + 1" admin-web/src --include='*.tsx' --include='*.ts'` → 6 行 |
| `TONE_CLASSES` 色调映射 | **2** | `ReconciliationCasesDetailPage.tsx:397` + `ReconciliationRunsDetailPage.tsx:147`，前者注释自认 mirror、且点名共享件该在 `reconBucketMap`（"not exported from the shared util"） | `grep -rn "const TONE_CLASSES" admin-web/src` → 2 行 |
| 方向/预填推导 | 前端 **2**（+后端真相 1） | §1.1 | 同上 |

弹窗 `displayToMinor`（`:192`，元→分反向）全仓唯一一份，不是重复，但与正向换算同家族，随共享件同住。

### 1.3 反向 import 与死导出

页面具名导出的消费图（**6 个文件反向 import 一个页面组件**，弹窗 `:34-36` 注释自认循环 import）：

```
grep -rn "from '.*ReconciliationCasesDetailPage'" admin-web/src --include='*.tsx' --include='*.ts'   # → 6 行
```

| 导出 | 消费方 |
|---|---|
| `FlowComparisonRow`（type） | `utils/causeRegistry.ts:6`、`InternalTransferInitiateModal.tsx:7`、`ReconciliationHoldModal.tsx:14`、`ReconciliationAdjustmentCreateModal.tsx:36` |
| `formatAmount` | 上述弹窗 2 + `ReconciliationCasesListPage.tsx:28`、`ReconciliationAdjustmentListPage.tsx:19` |
| `COA_PHRASE` | `ReconciliationCasesListPage.tsx:28` |
| `MATCH_LABEL` | **零外部消费**（`grep -rn "MATCH_LABEL" admin-web/src \| grep -v ReconciliationCasesDetailPage.tsx` → 0 行；文件内 2 命中 = 定义 + 1 内用）→ 摘 export 保常量。标识符类搜索无动态拼接形态，单一搜法即覆盖 |

### 1.4 两个大文件的解剖（拆分落点依据）

**页面 1893 行**：`:71-243` 类型块（FlowComparisonRow 一族 + 页面私有 DTO）｜`:251-306` 金额/时间 helper｜`:318-392` 预填/handoff（§1.1 待退役区）｜`:397-430` TONE/词表｜`:432-578` 四个内联小件（ShortRef / IncidentBadge / MatchChip / CaseHistory+Cell）｜`:580-726` 内联 `DispositionFindingModal`（147 行，六个非挂起处置共用的「选成因+查证说明」弹层）｜`:727-1110` 主组件状态与 handlers｜`:1111-1893` JSX：Hero `:1126` / Account `:1181` / Balance Explained `:1223` / Case History `:1331` / **Differences 大表 `:1337-1759`（约 420 行，大头）** / Bottom `:1759` / Sidebar `:1780` / 五个弹窗挂载 `:1825-1888`。

**弹窗 821 行**：模式判定与状态 `:285` 起｜改记候选拉取 useEffect `:332-370`｜**结构性空表 `REASON_META`（`:59`）与自由选择分支（`:366-377` reasonOptions/directionOptions/pickReason）**——头注释自述 Task 13 起「现存调用点已无人传空 locked+空 kind 打开这条分支」，本稿复核属实：弹窗仅在 `createPrefill` 非空时挂载（页面 `:1829`），而 `setCreatePrefill` 全部 4 个调用点（`:871` kind / `:900`、`:952` locked / `:857` 置空收尾）无一以「双空」打开｜submit `:409`｜JSX 证据区 / 核销前提区 / 表单区 `:502-821`。

## 2. 设计

### 2.1 `adjustmentPrefill` 收回后端（照 `nextStep` 先例，本波唯一动后端处）

- `cause-registry.ts` 新增 `resolveAdjustmentPrefill(facts)`（与 `signedDeltaSign` / `resolveWriteOff` 同住同源）：AMOUNT_MISMATCH → `|delta|` + `signedDeltaSign` 定向；ORPHAN_INTERNAL → 内部金额 + 方向取反；ORPHAN_EXTERNAL → 外部金额 + 方向照搬；另给 `reattributionSide`（`ORPHAN_INTERNAL→'FROM'` 其余 `'TO'`，与 `listReattributionCandidates` 约定同源同住）。
- `reconciliation-query.service.ts` 挂行：**只挂三类异常行**，在既有行注解段（`:651` 跳过守卫之后、`:691` `dispositions` 旁）。MATCHED / IN_TRANSIT 行不挂——§1.1 已坐实这两类行开不了调账弹窗，挂了就是造死字段。
- DTO：`FlowComparisonRow.adjustmentPrefill?: { amountMinor: string; direction: 'REDUCE'|'INCREASE'; reattributionSide: 'FROM'|'TO' }`；case 级 `adjustmentBook: 'CLIENT'|'FIRM'`（`createDraft` 同一句归一化的下发版）。
- 前端：`rowAdjustmentPrefill` / `deriveKindDirection` 整体删除，四个消费点 + kind 模式方向改读 `row.adjustmentPrefill`；锚字段（`explainedFlowId` / `explainedExternalLineId` = 行上 id 原样搬运，非判断）留前端拼装不变。
- **行为差异恰一处且演示不可达**：提现类 AMOUNT_MISMATCH 预填方向由错变对 → `BACKLOG.md:176` 随本波销账。
- jest：`resolveAdjustmentPrefill` 行为用例落 cause-registry 既有 spec 旁，**必含「内部 OUT + delta 为正 → REDUCE」翻符号用例**——该组合第一次进测试网。

### 2.2 拆案件详情页

抽出去的（照 `components/` 已有域子目录惯例，新建 `components/reconciliation/`；纯逻辑落 `utils/`）：

| 去处 | 内容 | 连动 |
|---|---|---|
| `utils/reconTypes.ts`（纯类型） | `FlowComparisonRow` 一族（含嵌套 side/disposition/nextStep 形状）、`FlowMatchType` | §1.3 的 6 处反向 import 全部改指 utils 层（类型走此处、`formatAmount`/`COA_PHRASE` 走下两行的去处，各取所需），循环断根 |
| `utils/reconAmount.ts` | `formatAmount`（千分位）＋ `minorToMajorPlain` ＋ 弹窗的 `minorToDisplay` / `displayToMinor` ＋ `isZeroAmount` / `deltaSign`——bigint-safe 家族单一来源；文件头注释与 `number-format.ts` 浮点家族划界 | `ReconciliationAdjustmentDetailPage` / `RunsDetailPage` 两份 fork 删除改 import |
| `utils/reconBucketMap.ts`（既有共享件） | `TONE_CLASSES` 补进去导出（两页注释本就自认它该住这里）；`MATCH_TONE` / `MATCH_LABEL` / `COA_PHRASE` 随迁（具体归档 plan 定，判据=同一职责同一文件） | RunsDetailPage 本地副本删除 |
| `components/reconciliation/DispositionFindingModal.tsx` | `:580-726` 原样外迁 | — |
| `components/reconciliation/CaseHistory.tsx` ＋ 小件文件 | CaseHistory+Cell、MatchChip、ShortRef、IncidentBadge（小件可并一文件，plan 定） | — |
| `components/reconciliation/CaseFlowTable.tsx` | Differences 区 `:1337-1759` 整段（行渲染、按钮组、处置徽章）——**只搬 JSX 与所需 props，类名与结构逐字保留** | 页面主体只剩挂载 |

页面主文件预期终态：状态编排 + 版面组装，**目标 ≤ 650 行**（照波三 `run()` 190 行先例，编排层解释得通的超出以 WRAPUP 说明，不硬闸）。

### 2.3 拆调账弹窗（含翻案点）

- 子区块外迁（同目录）：改记候选选择器（拉取 + 列表 + 选中回填）、核销/认损前提清单区（M10-M12 文案区）；表单主干与 submit 留主文件。金额换算改用 `utils/reconAmount.ts`。预期终态 **≤ 450 行**。
- **翻案点——删自由选择分支**：`REASON_META` 空表（`:59`）+ `reasonOptions` / `directionOptions` / `pickReason`（`:366-377`）及对应 JSX 分支整体删除。Task 13 当时「留」的理由是**波次越界**（「不越界删掉一整个表单模式"），不是业务需要；本波边界恰是这个文件的结构，且判死双证在案（§1.4：挂载条件 + 4 个调用点全数落 kind/locked）。删后 `locked/kind` 两模式的行为面一根头发不动。`REASON_LABEL`（15 码展示词表，`:66`）是活的回显来源，**不动**。

### 2.4 摘 export

`MATCH_LABEL` 摘 `export`（§1.3 零外部消费）——若随 §2.2 词表迁移则以「迁移后新位置不加多余 export」落地，同一判据。

## 3. 任务分解（波内顺序，plan 细化）

1. **T0 对照组先行**：波前基线起 self 栈跑 `demo:all` + `recon:demo:break` 存档（归一规则沿用波一 `normalize-rules.sh`），五页 + 弹窗清单截图存档（§6 清单）
2. 后端 prefill（§2.1）+ jest（含翻符号用例）——先落后端，前端拆分才有字段可读
3. 前端推导退役 + 消费点切换（§2.1 前端半）
4. utils 层抽离与两份 fork 收敛（§2.2 上半 + §2.4）——纯搬运，先于组件拆，让组件拆时 import 已就位
5. 页面组件外迁 + Differences 大表拆（§2.2 下半）
6. 弹窗拆分 + 自由选择分支删除（§2.3）
7. 收尾复采：同栈同剧本重跑 diff + 截图比对 + 全量闸

## 4. 总纲订正（随本稿回写）

- 总纲 §3 波四行「3 组重复块收敛」的所指订正为 §1.2 清册：原体检 3 组中 `walletRef→walletNo`、`decimals` Map 两组已被波三收走，波四真实面对的是**金额换算（对账域 4 处）/ TONE_CLASSES（2 处）/ 方向推导（前端 2 处，以收回后端方式收敛）**。
- 波四行「前端自算业务判断收回后端」的清单落定为：`rowAdjustmentPrefill`（含总纲点名的翻符号）、`deriveKindDirection`、改记 side、`adjustmentBook` 归一化镜像——第 4 项是本稿新发现（同「两边必须一致否则 400」的镜像脆弱性），超出总纲「含」字列举，一并收编。

## 5. 交付清单命中行（对照 `rules/delivery-checklist.md`）

- **改了前端** → preview 渲染 + 截图闸（永不豁免）；截图逐张与 T0 基线比对
- **动了后端读面** → 栈级输出 diff（§6 白名单口径）+ 对账域 jest 全绿
- **删代码**（自由选择分支 / 两份 fork / MATCH_LABEL export）→ 判死复现命令已入 §1，收尾在 HEAD 复跑
- **BACKLOG 连动**：`BACKLOG.md:176`（翻符号）销账，注明波四收编修复
- **多波战役** → 收尾把「承接本波」写进波五 spec 骨架（届时新立），回写总纲状态行；本 spec 随合并归档
- 合并进 main 后：重启后端前先 build（主栈跑 dist）；无新端点无权限变更，**不需要** `db:base:sync`

## 6. 闸与验收

| # | 闸 | 判据 |
|---|---|---|
| 1 | 闸①②③ | 全绿（后端动了 DTO，闸① 必跑） |
| 2 | jest 对账域 | 全绿；基线 29/561 起算，新增 prefill 用例后计数增量在 WRAPUP 记账 |
| 3 | **栈级输出 diff** | T0 与收尾同栈同剧本，归一后 diff **仅允许命中新增字段行**（`adjustmentPrefill` / `adjustmentBook`，以一次性白名单 grep 剔除并连同未剔除的原始 diff 一起入档），其余逐字节为空。若 demo 输出不含 case 读面 JSON、diff 天然为空，如实记录「白名单未启用」 |
| 4 | **截图像素同构** | 第六幕五页（波二证据 p1-p5 同一套）+ 弹窗清单：调账弹窗 kind 模式、REATTRIBUTE 锁定、核销锁定（⚡拨钟解锁后可达）、Hold、Supplement、DispositionFinding——波前波后同预铺态逐张比对，文案 / 列 / 按钮组一个不差 |
| 5 | 复现命令归零复跑 | §1.2 padStart 命令对账域文件 → 仅共享件 1 处；TONE_CLASSES → 1 处；反向 import 命令 → 0 行 |
| 6 | 行数终态 | 页面 ≤ 650 / 弹窗 ≤ 450 / 新拆文件各 ≤ 500，实测数字入 WRAPUP（超出需结构性解释，照波三先例） |

## 7. 风险与开口

- **像素同构 vs 拆分的张力**：Tailwind 类名串是行为面——搬 JSX 时任何「顺手规整」都会被截图闸咬。纪律：搬运任务里禁止改动 className 与文案字面（评审逐段比对）。
- **循环 import 解除后的构建面**：Vite 对既有循环「模块顶层不互相求值」是容忍的，解除只会更安全；但 `admin-web` 构建产物无自动比对闸，靠闸② + 截图兜。
- **弹窗自由选择分支删除**是对 Task 13 保留决定的翻案，依据与双证在 §1.4 / §2.3——业主对本稿的认可即为拍板记录；若执行中发现该分支存在暗调用点（判死错误），按纪律停手回报，不硬删。
- **`adjustmentBook` 收编**改的是 case 级 DTO——消费点只有弹窗 `book` prop 一处传入链，连动面小，但 T0 diff 白名单要同时覆盖它。
- 波五骨架届时新立；本波不预写波五内容（总纲 §6：收尾只写承接）。
