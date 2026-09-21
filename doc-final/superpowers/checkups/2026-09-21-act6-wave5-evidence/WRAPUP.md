# 第六幕波五「业务日迪拜午夜切 + 演示面清点 + 文档收口」· WRAPUP

> spec: `doc-final/superpowers/specs/2026-09-21-act6-wave5-cob-closeout-design.md`
> plan: `doc-final/superpowers/plans/2026-09-21-act6-wave5-cob-closeout.md`
> 台账: `.superpowers/sdd/2026-09-21-act6-wave5-cob-closeout/progress.md`（Ruling R0-R7 全文）
> commit 链：`4d963c75`(T1) → `18f1b5fa`(T2) → `3d2e66f2`(T3) → `a14a19f3`(T4) → `93e002a1`(T5) → `9d8a23ff`(T6) → `228f31ca`(T9) → `355d9fd1`(T7) → `2e7eccae`(T8) → `1203b007`(T10)（执行顺序按 Ruling R0 调整为 0,1,2,3,4,5,6,9,7,8,10）

## 一、spec §1-§3 承诺逐条对代码

### §1 业务日迪拜午夜切

| 承诺 | 落地位置 | commit |
|---|---|---|
| 1.1 唯一真源 `toBusinessDate`/`endOfBusinessDate`/`startOfBusinessDate`/`DUBAI_UTC_OFFSET_MS` | `src/modules/accounting/tigerbeetle/utils/business-date.util.ts` | 4d963c75 (T1) |
| 1.2-#1 `business-date.util.ts:2` 重写 | 同上 | 4d963c75 (T1) |
| 1.2-#2 `wallet-recon-run.service.ts` 私有重复件删除、改 import 共享 util | `src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts` | 18f1b5fa (T2) |
| 1.2-#3 `recon-thresholds.constant.ts:26` 账龄起算改 `endOfBusinessDate` | 同名文件 | 18f1b5fa (T2) |
| 1.2-#4 `effective-cutoff.ts:23` 回填判定改 `endOfBusinessDate` | `src/modules/clearing-settle/reconciliation/engine/v2/effective-cutoff.ts` | 18f1b5fa (T2) |
| 1.2-#5 `reconciliation-query.service.ts:532` 回落截止改 `endOfBusinessDate` | `src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts` | 3d2e66f2 (T3) |
| 1.2-#6 同文件 :1009-1010 日窗改 `startOfBusinessDate`/`endOfBusinessDate` | 同上 | 3d2e66f2 (T3) |
| 1.2-#7 `push-order.service.ts:204,206`「今天/创建日」改走 `toBusinessDate` | `src/modules/clearing-settle/reconciliation/disposition/push-order.service.ts` | 3d2e66f2 (T3) |
| 1.2-#8 `supplement-evidence.service.ts:125` 兜底业务日改走 `toBusinessDate` | `src/modules/clearing-settle/reconciliation/disposition/supplement-evidence.service.ts` | 3d2e66f2 (T3) |
| 1.2-#9 `reconRunTrigger.ts:34` 前端硬拼日终收回后端 | `admin-web/src/utils/reconRunTrigger.ts` | a14a19f3 (T4) |
| 1.3 `runs/wallet` DTO 改 `{cutoff?, businessDate?}` 二选一 | `src/modules/clearing-settle/reconciliation/dto/reconciliation.dto.ts` + controller | a14a19f3 (T4) |
| 1.4 新增 `business-date.util.spec.ts` + 既有 6 个 spec 随位点更新 | 各同名 `.spec.ts` | 4d963c75/18f1b5fa/3d2e66f2 (T1-T3) |
| 1.4 变异实证（偏移常数改 0 必红） | `evidence/mutation-business-date.txt` / `mutation-effective-cutoff.txt` | T1/T2 报告 |
| 1.5 `script.md:193`／`v8-recon.md`／`BACKLOG.md:136`／`decisions.md` 连带文档 | 对应文档 | 1203b007 (T10) |

### §2 演示可见五条

| 承诺 | 落地位置 | commit |
|---|---|---|
| 2.1 `invariantStatus` 写入修正（`INTERNAL_BREAK`→FAIL，其余→PASS） | `wallet-recon-run.service.ts` finalize | 9d8a23ff (T6) |
| 2.1 详情页三态（FAIL 红横幅隐藏 Health Check / PASS 正常 / 旧两态兜底） | `admin-web/src/pages/ReconciliationRunsDetailPage.tsx` | 9d8a23ff (T6) |
| 2.1 连带修复 legacy 判定误遮新横幅（R3） | `reconciliation-query.service.ts` | 9d8a23ff (T6) |
| 2.1 `BACKLOG:192` 改写为余项（R4） | `doc-final/BACKLOG.md` | 1203b007 (T10) |
| 2.1 pre-Round3 legacy 组合不可达一行（R5） | `doc-final/PRODUCTION-NOTES.md` | 1203b007 (T10) |
| 2.2 `computeSeverity(currency, delta)` + `SEVERITY_LINES_MINOR` 注册表 | `recon-thresholds.constant.ts` | 93e002a1 (T5) |
| 2.2 `openCase` 入参补 `currency`，调用侧 `asset.currency` select | `wallet-recon-run.service.ts` | 93e002a1 (T5) |
| 2.2 `BACKLOG:194` 销账 | `doc-final/BACKLOG.md` | 1203b007 (T10) |
| 2.3 后端 `loadPushable()` 显式拒斥划转腿 | `push-order.service.ts` | 355d9fd1 (T7) |
| 2.3 前端 `CaseFlowTable.tsx` 在途分支改「Transfer leg →」链接 | `admin-web/src/components/reconciliation/CaseFlowTable.tsx` | 355d9fd1 (T7) |
| 2.3 前端 `FundsOrderDetail.tsx` 隐藏推单动作块 | `admin-web/src/pages/FundsOrderDetail.tsx` | 355d9fd1 (T7) |
| 2.3 R7 连带：`appendInTransitRows` 补 internalTransfer join | `reconciliation-query.service.ts` | 355d9fd1 (T7) |
| 2.3 `BACKLOG:128` 销账 | `doc-final/BACKLOG.md` | 1203b007 (T10) |
| 2.4 `auditCaseOpened`/`auditCaseAutoHealed` metadata `walletRef`→`walletNo` | `reconciliation-case.service.ts` | 2e7eccae (T8) |
| 2.4 `BACKLOG:198` 销账 | `doc-final/BACKLOG.md` | 1203b007 (T10) |
| 2.5 划转路由前缀统一 `custody/`（13 处/10 文件，R6 订正） | `App.tsx` + 9 个前端文件字面路径 | 228f31ca (T9) |
| 2.5 `BACKLOG:180` 销账 | `doc-final/BACKLOG.md` | 1203b007 (T10) |

### §3 文档收口

| 承诺 | 落地位置 | commit |
|---|---|---|
| `bucket-classifier.ts:1` 注释「五桶」→4 桶 | 同名文件 | 1203b007 (T10) |
| `modules/v8-recon.md` 多处订正 + 业务日口径段同步 | 同名文件 | 1203b007 (T10) |
| `scripts/recon-demo.ts:133` 15→18 | 同名文件 | 1203b007 (T10) |
| `reference/recon-cause-handbook.md` §四附录重排 18 场景 12 案 | 同名文件 | 1203b007 (T10) |
| `CHANGELOG.md` 字节级重复删一行 | 同名文件 | 1203b007 (T10) |
| `demo/script.md:193` 迪拜口径改写 | 同名文件 | 1203b007 (T10) |
| `demo/baseline.md` 严重度分布 + `invariantStatus` 修订 | 同名文件 | 93e002a1 (T5) 起草 / 1203b007 (T10) 收口 |
| `BACKLOG.md` 五销一改一新登 | 同名文件 | 1203b007 (T10) |
| `decisions.md` 2026-09-21 三条拍板入册 | 同名文件 | 1203b007 (T10) |

### 本任务（Task 11）自身产出

| 项 | 落地位置 |
|---|---|
| 收尾闸全绿物证 | `checkups/2026-09-21-act6-wave5-evidence/gates-final.txt` |
| 场景 9 剧本实走 + 时间戳算式 | `checkups/2026-09-21-act6-wave5-evidence/scenario9-timestamps.txt` + `after/scenario9-{1,2}-*.png` |
| after 对位截图集 + 差异说明 | `checkups/2026-09-21-act6-wave5-evidence/after/*.png` + `after/COMPARISON.md` |
| 战役级六判据复验表 | `checkups/2026-09-21-act6-wave5-evidence/campaign-final-audit.md` |
| 本文件 | `checkups/2026-09-21-act6-wave5-evidence/WRAPUP.md` |

## 二、偏差登记（从台账 Ruling 逐条收录，如实记录不粉饰）

1. **Ruling R0**：执行顺序由 0,1,...,7,8,9,10 调整为 0,1,2,3,4,5,6,**9,7**,8,10,11——T9（前缀统一）提前到 T7（划转腿显式拒）之前执行，避免 T7 新增的「Transfer leg →」链接在 T9 改路由前出现短暂 404 窗口期。两任务产物互不依赖，对调零成本。
2. **Ruling R1**：plan Task 0 Step 4①「案件列表页（严重度徽章可见）」与实现不符——实测列表页不渲染 severity，徽章只在案件详情页。裁定为 plan 措辞笔误，严重度对照锚点改为**案件详情页**；本任务 Step 4①同步改口径为「案件详情严重度徽章」（brief 原文已按此口径写）。不开新任务给列表页补徽章（超出 spec 范围的新功能）。
3. **Ruling R2**：spec §2.1 取证法「停 TigerBeetle 触发 `TB_UNREACHABLE`」实测不可行（`tigerbeetle-node` 客户端无 RPC 超时，请求挂死 15+ 分钟）。接受 T6 实现者的替代真实触发方案（临时恒等破坏条件），判据不变——截图必须来自真实代码路径产出的 `INTERNAL_BREAK` run（已核实 `run-internal-break.png` 满足）。spec 原描述作废，本条即完整记录。
4. **Ruling R3**：T6 brief 外连带修复 `reconciliation-query.service.ts` 的 legacy 判定（`runWallets.length===0` 同时命中真 `INTERNAL_BREAK` run，灰色 Legacy 提示会遮住新横幅）——按「实现它所必需的配套」收进 T6，评审专核该改动不伤真 legacy run 语义（四场景中三个实证通过，第四个历史组合按 R5 处置）。
5. **Ruling R4**：T6 commit message 称「销 BACKLOG:192」但当时 diff 未动 `BACKLOG.md`——因 commit message 系 plan 逐字给定，`BACKLOG.md` 全部销/改写在 plan 中明文排在 T10。裁定不 amend 历史 commit，T10 按期兑现（改写文案含「空表危险已除（波五 T6）」，使 T6 commit 声称在波级收尾时点为真）。此为 **commit 措辞与其提交瞬时状态不完全一致的已知窗口期**，合并前（T10 完成时）已闭合。
6. **Ruling R5**：T6 评审发现「pre-Round3 legacy run 若带旧语义 FAIL 会误显红横幅」——该组合只存在于未重铺旧库，按 §3 数据随时可重铺 + §2 禁向后兼容，重铺库中真 legacy 行不可能存在。裁定不写兼容代码，按 §4 出口表在 `PRODUCTION-NOTES.md` 追加一行（T10 落地），不修不讨论。
7. **Ruling R6**：T9 实扫坐实 spec/plan「15 处」为算术笔误（`App.tsx` 两条路由定义被重复计入「其余 13 字面」）——真值 **13 处 / 10 文件**。T9 commit message 沿用「15 处」措辞不改历史；文档三处复述（spec §2.5、总纲 §5、`decisions.md`）由 T10 订正为 13。**代码侧终态判据（`grep "treasury/" = 0`）不受计数表述影响**，属纯文档措辞偏差。
8. **Ruling R7**：T7 brief 外连带修复 `reconciliation-query.service.ts` 的 `appendInTransitRows` 补 `internalTransfer` join——spec §2.3 前端方案（在途行 `row.transfer` 优先渲染「Transfer leg →」链接）在后端不下发该字段时是死代码。按「实现它所必需的配套」收进 T7，评审专核 join 形状与既有 `row.transfer` 消费契约一致（读面契约非破坏性新增）。
9. **T4「201」口径差异**：brief 收尾过检写「确认 200」，实际观察是 Nest POST 默认创建语义的 `201 Created`（此前改动前同样是 201，非本次改动引入的差异）。按「请求成功、无 4xx/5xx」判读为通过，未额外改动 `@HttpCode` 装饰器（brief 未要求，超出本任务改动范围）。
10. **T3「四 spec 只需改一」**：brief Step 5 措辞写「四个 spec」，实际需要修改的 spec 文件数为 1 个文件 / 2 处断言——另外两个 spec 文件的既有夹具本就不落在被迪拜偏移影响的边界窗口内，实跑验证过、非漏改。评审独立复跑逐字节确认。
11. **T10 CHANGELOG 行号漂移**：`CHANGELOG.md` 字节级重复对经 T10 复核，实际漂移落在 `:48`/`:50`（而非最初怀疑的 `:41`/`:43`），已用 md5 双证确认改前改后内容一致性。
12. **T10 复核清单 minor 偏差**：#24 记「五桶残留注释 3 文件」实为 4 文件（`wallet-recon-run.service.ts:382,601` 漏计）——残留注释本身超出 T10 brief 改动范围，未强改，终审 triage 后留档。
13. **T10 minor 偏差**：`v8-recon.md`「第 8 码 CUSTOMER_REATTRIBUTION」序数与声明顺序不符——「第8码」或指历史新增序而非声明序，待业主释义，正文未加行内旗标（不影响判据，纯文档表述存疑）。
14. **本任务（T11）自身偏差**：`demo/baseline.md` 💡 注记的严重度分布（T5/T10 取数轮：AED 1/4/1、USDT 5/1/0）与本任务重铺后实测（AED 2/4/1、USDT 4/1/0）存在一案跨币种边界偏移（总案数一致均为 12，`recon:demo:break` 自身硬判据 18/18+12/12+casesOpened 12/12 不受影响）——已在 `gates-final.txt` §3 如实记录，未回改 `demo/baseline.md`（该数字为参考性 💡 注记，非自动化断言判据）。
15. **波五终审逮回的第 10 位点**：`reconciliation-sweep.service.ts:17-24` 的 `cutoffForYesterday()` 手拼 `d.setUTCHours(23, 59, 59, 999)`（Date-mutator 形态），T9 的两条字面 grep（`treasury/` 前缀 + 迪拜口径关键字）均未覆盖此形态，T10 文档收口也未捕获——本波内部评审链条漏检，由波五终审（whole-branch review）逮回。修复见本 commit：改走 `toBusinessDate`/`endOfBusinessDate`，新增聚焦 RED/GREEN 用例 `reconciliation-sweep.service.spec.ts`，`grep -rn "setUTCHours" src/ --include="*.ts" | grep -v spec` 终态 0。

## 三、对照 `rules/delivery-checklist.md` 逐触发条件核

| 触发 | 是否命中本波 | 本波怎么过的 |
|---|---|---|
| 任何持久状态变化→写审计 | 否（T8 改的是既有动作的 metadata 键名，非新增状态变化） | — |
| 新增审计动作码 | 否 | — |
| 新状态/新结局 | 否（无新状态机边） | — |
| 动了钱 | 间接（COB 边界影响 Re-reconcile 时点） | `verify:coa` 全绿（Step 2） |
| 该走 maker-checker | 否 | — |
| 新增 maker-checker 审批策略 | 否 | — |
| 新增权限组 | 否（RBAC 零改动，spec 已声明） | — |
| 新增 admin 端点 | 否（`runs/wallet` 是既有端点改 DTO，非新端点） | — |
| 新增业务动作 | 否 | — |
| **退役业务动作→前端入口同步删** | **是**（T7：划转腿推单动作退役） | `CaseFlowTable.tsx` 改渲染「Transfer leg →」、`FundsOrderDetail.tsx` 隐藏 Sync/Manual 推单动作块，两处同波改（前端双入口连动，波二判例的幽灵入口纪律） |
| 改了交易三域任一 | 否 | — |
| 新字段/新状态到客户面 | 否 | — |
| 涉及金额 | 否 | — |
| **对外识别用业务键** | **是**（T8：`walletRef`→`walletNo`） | `resolveWalletNo` 现成方法换键，判据=新审计事件 metadata 零 UUID（T8 报告实证 ≥1 条） |
| 新事件 | 否 | — |
| 改 schema | 否（本波无新迁移文件） | — |
| **改页面或种子** | **是**（多处前端改动） | `demo/script.md:193`、`demo/baseline.md` 同步（T10） |
| **改了前端** | **是**（T6/T7/T9） | 每任务各自 preview 渲染 + 截图（T0 before 集 + T6/T7 自带 after 集）；本任务 Step 4 补齐五页对位 + 差异说明 |
| 本任务是多波中的一波 | 否（本波是末波，无下一波） | 改为总纲状态行收官 + spec/plan 归档，属 Step 8（控制会话执行，不归本任务） |
| 每轮收尾（CHANGELOG + BACKLOG 销账） | 是 | `BACKLOG.md` 五销一改一新登（T10）；波级 CHANGELOG 一行留给 Step 8 汇总收口 |

**两条永不豁免**：
1. 改了前端 → 必须截图：**满足**（T0/T6/T7/T9 各自物证 + 本任务 Step 4 after 集）。
2. 动了钱 → `verify:coa`：**满足**（本任务 Step 2，`gates-final.txt` §2）。
