# 平账收尾 · 界面收口轮（调账单菜单 / 两详情页重排 / 全站英文化 / 客户流水页重做）

> 状态：设计定稿（业主 2026-09-07 逐屏过设计稿三轮拍板）｜ 设计稿：https://claude.ai/code/artifact/6eca8c74-0b66-4b43-b210-c9e15a8c606e（4 画板 + 改动点便签）
> 波次：单波收口，不设总纲 ｜ plan 待 writing-plans 产出

## 0. 本任务做 / 不做

**做**：① 调账单独立菜单（后端列表端点 + 前端列表页 + 侧栏项）② Run / Case 详情页按定稿设计重排 ③ 管理台 + 客户端全站英文化（含后端吐到界面的显示串）④ Demo Compare 页整体退役 ⑤ 客户端 Transaction History 页重做（入口 / 读模型 / 行格式）⑥ `SOFT_FLAG → COMPENSATING` 改名 ⑦ 对账其余页面轻整理（列表溢出 / 默认日期 / 事故页英文化）

**不做**（对照 CLAUDE.md §2 与 BACKLOG 既有裁定）：i18n 框架与语言切换 ｜ 对账复核签核（maker-checker）｜ `treasury/` 路由前缀 IA 债（BACKLOG 保留：连动四处链接，单独一次收）｜ 推单页划转腿方向标签 ｜ 案件级复观察计数器修复（恒 0 的 BACKLOG bug——本轮**改为不展示该数字**绕开，不修计数）｜ 客户流水行点击下钻（业主明确不要）｜ 中文注释翻译（注释不是演示可见物）｜ 通知、性能、防御性校验

## 1. 调账单独立菜单

现状实证：调账单只有 `GET :adjustmentNo` 详情端点（权限 `RECON_CASE_READ`）、详情页与详情路由；无列表端点、无列表页、无菜单项，案子关了单就只能靠审批回链找——业主判定要独立菜单。

- **后端**：`adjustment.controller.ts` 新增 `GET /admin/reconciliation/adjustments`（列表）。行字段：`adjustmentNo / caseNo / ownerNo / assetCode / decimals / reasonCode / direction / amount / status / effectiveDate / createdAt`。过滤：`status`、日期区间；分页与 Runs/Cases 列表同款。**不暴露 UUID**（铁律⑥）。
- **RBAC**：`rbac.catalog.ts` 加 `route('GET', '/admin/reconciliation/adjustments', 'List Recon Adjustments', ['RECON_CASE_READ'])`——与详情读同门，不新造权限组、不动权限桶。落地后必须 `db:base:sync` + **重启后端**（判例：内存权限表不重启 = 403）。
- **前端**：新建 `ReconciliationAdjustmentListPage.tsx`，列 = Adjustment No ｜ Case No（链接）｜ Customer ｜ Asset ｜ Reason ｜ Dir ｜ Amount ｜ Status ｜ Effective Date；路由 `reconciliation/adjustments` **注册在 `:adjustmentNo` 动态段之前**（契约：静态先于动态）；侧栏 Reconciliation 组加 `Adjustments` 项（第四项，排 Cases 之后）。

## 2. Run 详情页重排（设计稿画板 "Run Detail — redesigned"）

甲版式骨架不动（判词横幅 → Health Check → Case Flow → 快照表），五处改动：

1. 全页英文化；判词横幅一句人话：`BREAK — 19 wallets checked: 7 matched, 1 in transit, 11 need attention`
2. `SOFT_FLAG → COMPENSATING`：改 `bucket-classifier.ts` 的 `ReconBucket`、`reconciliation.dto.ts` 的 `ReconWalletBucket`/`ReconCaseQuery`、前端 `reconBucketMap`（词表 `Compensating`）及全部引用。bucket 在 `schema.prisma` 是 **String 列非 enum**（`:1496` / `:1693` 实证）——**无 schema 变更、不新增迁移文件**，执行者不得自作主张写迁移；但那两行列注释里的 `SOFT_FLAG` 字样同步改词防漂移。存量值不写兼容层——改完靠 reset 重铺（§9 闸⑧）
3. Demo Compare 按钮删除（随 §4 整页退役）
4. Case Flow 三张大卡压成一条细条（Opened / Re-observed / Closed 三个内联数字 + 右侧 "View all cases for this run"）
5. 快照表 Flows 列废除 `✓3 OI1 MM1 ⧖1` 密码缩写，改人话短语只列非零项：`12 matched · 2 mismatch · 1 in-transit`；表头 Account→Wallet、在途列 In-Transit

侧栏三块（Actions / Identity Summary / Lifecycle）结构不变，只英文化。

## 3. Case 详情页重排（设计稿画板 "Case Detail — redesigned"，本轮最重一页）

内容一件不丢（六态动作梯、四个弹窗、⚡拨钟、划转回挂、事故入口全保留），排法七处改动：

1. **Hero 减负**：只留案号 + 徽标（bucket / severity / OVERDUE nD / status）+ 一句结论（如 `External balance is 735.50 AED short of our books — no in-transit cover; 228.00 explained, awaiting re-reconcile.`，`buildCaseConclusion` 重写为英文且要覆盖"已解释部分"的口径，不许出现"全额待排查"与已解释行打架）
2. **Account 独立成节**：钱包 / 客户（链接到客户详情）/ 科目 / 资产·账簿 / 业务日五字段，宽松五列网格；科目显示短语标签（如 `Client payable + Deposit suspense`），不显示 `L.CLIENT_PAYABLE+L.DEPOSIT_SUSPENSE` 技术串
3. **Observation 改 Case History 三格**（业主两轮收敛后的终稿）：`OPENED BY`（RUN 号 + 时间）｜ `LAST RE-CHECKED`（RUN 号 + 时间 + `still unmatched`；已销案显示 `closed by RUNxxx`）｜ `AGING`（`Overdue by N days` 红格 + 原截止时间；未超期显示 `day N of 3-day SLA` 中性格）。**复观察次数刻意不展示**（计数器恒 0 是 BACKLOG 在案 bug）
4. **Balance Explained 五格**保留：Internal / External / Difference / In-Transit / Unexplained（`needs investigation` 尾注）
5. **差异表（Differences）治横滚**：列 = Type ｜ Dir ｜ Amount ｜ Reference ｜ Source ｜ Time ｜ Disposition。外部参考号截断展示（首 10…末 4）+ 复制按钮、全文进 title；Source 列直接显示业务单号（DEP/WD/SWP，可点进原单），`eventCode · sourceType/uuid` 技术串废除；**Disposition 列固定约 250px、1280 视口内无横向滚动**（验收判据）
6. 六态动作梯词表英文化：`处置→Record finding`｜`开单→Open adjustment`｜`已定性→Finding: <cause> → <outlet>`｜`已解释→Explained · ADJxxx`｜`发起补录/认领退汇/认领退回→Record missed deposit / Claim recall / Claim return`｜`核销/认损→Write off / Recognize loss`｜`登记事故/升级事故/登记欠款→Register incident / Escalate to incident / Register shortfall`｜`发起补款/垫款→Initiate compensation / Initiate advance`｜`去推单→Push order`；四个弹窗（Disposition / AdjustmentCreate / Supplement / InternalTransferInitiate）随词表同步英文化
7. 侧栏不变：Actions（Re-reconcile ／ ⚡ Fast-forward aging）+ Identity Summary + Lifecycle

## 4. Demo Compare 页退役（业主拍板：直接删）

- 前端：`ReconciliationDemoComparePage.tsx` 删；`App.tsx` 路由 `reconciliation/demo-compare/:runNo` 删；Run 详情 `hasDemoManifest` 按钮块删
- 后端：`reconciliation-admin.controller.ts` 的 `GET demo/compare` 端点 + `reconciliation-query.service.ts` 对应读块（含读 `.breaks` 恒空的孤儿逻辑）删；`rbac.catalog.ts` 若有对应 route 登记一并退役；DTO 里 `hasDemoManifest` 投影删
- **manifest 本身不动**：`recon:demo` 的答案键打印是演示讲解工具，与该页无关
- 退役纪律（判例）：现场逐键 grep 零残余引用后才算删干净；BACKLOG「Demo Compare 页恒空」条销账

## 5. 全站英文化（管理台 + 客户端 + 后端显示串）

**方式（业主拍板）**：无 i18n、无词表切换——中文串原地改英文字面量；`'English / 中文'` 双拼串保留英文半边。**注释不动**（管理台 1537 行含中文里约 694 行是注释）。

**规模与复现**（2026-09-07 扫描，命令：`grep -rlP '[\x{4e00}-\x{9fff}]' <dir> --include='*.tsx' --include='*.ts'` 配合逐文件计数）：

| 范围 | 含中文文件 | 中文行 | 其中代码/JSX（要改的） |
|---|---|---|---|
| admin-web/src | 73/129 | 1537 | ≈913 |
| client-web/src | 27/46 | 324 | ≈88 |

大头：`ReconciliationCasesDetailPage` 223 ｜ `module-parity.spec.ts` 153（断言跟改）｜ `ReconciliationAdjustmentCreateModal` 148 ｜ `IncidentDetailPage` 92 ｜ `SwapTransactionDetail` 72 ｜ `DepositTransactionDetail` 63 ｜ 事故三件套与各状态词表 utils。

**后端吐界面的显示串同轮转英**（同扫描口径，非注释中文行）：`cause-registry.ts` 58（20 成因的 label / clue / outletLabel / 客户词）｜ `adjustment.service.ts` 56（`reasonInternal`/`reasonCustomer` 模板 + 管理台可见报错）｜ `incident.service.ts` 32 + `incident-close-workflow.service.ts` 19 ｜ `internal-transfer-workflow.service.ts` 28 ｜ `disposition.service.ts` 20 ｜ `supplement-evidence.service.ts` 17（候选行 `describeLine`）｜ `adjustment-rules.ts` 14 ｜ 各 controller 报错串。`reasonCustomer` 等落库值由创建时模板生成——改模板即可，旧数据靠 reset 重铺，**不做存量清洗**。

**连带**：① 各 `.spec.ts` 里断言中文标签的期望值随词表更新（行为断言不变绿法：改词表必须让旧断言先红再绿）② `ApprovalPoliciesPage` 的 `ACTION_TYPE_LABELS` 转英时**补上缺失的 4 个键**（`DEPOSIT_SUPPLEMENT` / `DEPOSIT_CLAWBACK` / `WITHDRAW_RETURN_CLAIM` / `INTERNAL_TRANSFER_APPROVAL`，BACKLOG 销账）③ `scripts/**` 与 `demo:all` 若有断言 UI 中文文案的判据，随词表改（plan 阶段先 grep 圈定，不许漏到闸⑥才发现）④ 管理台首页占位（`FiatX 管理台/请从左侧菜单开始`）与 Quick Login 弹层一并转英 ⑤ **三域对称核对**（交付清单触发行）：充值 / 提现 / 兑换三域的详情页结构词汇与状态词表（`depositStatusView` / `swapStatusMap` / withdraw 同族）转英时逐词对照，同一语义三域同一个词——tipping-off 防线只落一域的教训在案。

## 6. 客户端 Transaction History 页重做（设计稿画板 "Client · Transaction History" + "Client · Overview entry"）

**入口（业主拍板）**：不进侧栏菜单。Overview 资产行末尾既有的 History 图标由「打开对账单弹层」改为**跳转本页**（带 assetId）；对账单弹层退役（组件 + Overview 内弹层状态删）。页面标题左侧返回箭头回 Overview。

**数据**：复用并扩展既有 `GET /client/portfolio/statement` 读端点（现为弹层供数）；旧页面打的 `/journal-lines/customer-balance-history` 后端不存在（页面恒空的根因，BACKLOG 在案），随旧页面代码一并消失。读模型口径：**账本分录按订单聚合**，每行 = `{时间, 类型, 客户可见单号, 总额(净), 费用合计, 行尾余额}`；分页 + 日期区间过滤；新→旧排序。三原则（decisions.md 2026-08-28）落实为验收判据：保净额 ／ 保余额（Balance 列自上而下用 Amount 能加出来）／ 可追溯（读模型每行带构成分录引用，**仅供后台核对，客户面不展示**）。

**行格式（业主逐列拍板）**：日期 ｜ 描述（主行业务话术 + **副行只放客户自己可见的订单号**，费用不进副行）｜ 金额（**主行总额 + 副行费用** `fee 3.50`，无费则无副行）｜ 余额。**无任何行展开 / 下钻**——2026-08-27 BACKLOG 里的「详情十格」设计被本裁定取代。

**行类型词表**（补款 / 垫款措辞按业主授权由 agent 定稿）：

| 类型 | 主行 | 副行 | 方向 |
|---|---|---|---|
| 充值 | `Deposit · bank transfer` / `Deposit · crypto` | DEP 单号 | + |
| 提现 | `Withdrawal to bank account` 等 | WD 单号（费用进金额副行） | − |
| 兑换卖出腿 | `Swap AED → USDT` | SWP 单号（费用进金额副行） | − |
| 兑换买入腿 | `Swap AED → USDT` | SWP 单号 | + |
| 调账（四族含核销 / 认损落客户账的） | `Balance correction · <reasonCustomer 英文话术>` | 有关联原单则 `Original order <单号>`，否则无副行；**不显示 ADJ 单号** | ± |
| 改记错记方 | `Balance correction · account correction` | 原单号（原单本属错记方） | − |
| 改记正主方 | `Balance correction · account correction` | 无副行（对方的单号不给看，两侧互不见） | + |
| 退汇 | `Deposit recalled by bank` | 原 DEP 单号 | − |
| 退票回补 | `Withdrawal returned` | WD 单号 | + |
| 补款划转 | `Credit from FiatX · balance restoration` | 无副行 | + |
| 垫款划转 | `Credit from FiatX · advance` | 无副行 | + |

**异常结局行与 tipping-off 白名单**（交付清单「新内容到客户面」触发行，本节是本轮最重的合规判断）：读模型落地前必须**逐事件码盘点**哪些账本事件会触到客户应付并因此出现在流水里（没收 / 上缴 / 冻结相关腿是重点），每类行**当场决定客户看不看得到、用什么词**。口径先例已在册：`client-web/src/utils/depositStatusView.ts` **刻意**不给 `CONFISCATING/CONFISCATED` 客户话术、走中性兜底（文件头注释言明）——流水行沿同一教义：涉制裁 / 没收 / 上缴的行若确实触到客户可见余额，主行用中性 `Balance adjustment`、**绝不出现 confiscate / sanction / surrender 字样**；若这些流程的钱从未进过客户可用余额（一直在暂扣户）则天然无行——但这要在任务里**实证**（跑出没收场景看流水），不许假设。各域状态话术表本轮转英时，流水行与详情页共用同一份词。

**金额契约**：读模型金额一律最小单位（分）出、展示层按资产 `decimals` 换算——「分」当「元」显示的判例就发生在对账 Cases 页，不许重演。

**退役纪律**（同 §4）：对账单弹层、旧 TransactionHistory 页替换后，现场逐键 grep 零残余引用才算删净——弹层的连带死码（`statementSourceLabel` 等 util、Overview 里的弹层 state）一并清，不留幽灵。

**样式**：整页从旧白底 gray 迁到现行 fx-* 暖黑系（照设计稿画板）；资产切换 chips + 日期区间过滤保留。

## 7. 其余对账页轻整理（无画板，判据从紧）

- **Cases 列表**：1280 视口不横滚（现状最右列被切）。COA 列改短语标签（同 §3.2 口径）；First/Last Run 两列并一列（`RUNxxx-1 → -2`）
- **External Balances**：默认日期改为**最近一个有数据的账单日**（现状默认今天 = 打开即空页）；空态文案保留
- **事故登记两页**（IncidentListPage / IncidentDetailPage / incidentStatusMap / NewIncidentModal）：随 §5 英文化，排版沿用现有结构不重排
- Runs / 划转 / 资金单 / 账本各页：仅英文化，不动排版

## 8. 需随交付落 decisions.md 的业主裁定（2026-09-07）

1. 管理台 + 客户端全量英文化，不建 i18n；中文注释不动
2. Demo Compare 页直接删（不修）
3. 客户流水：不做更正详情下钻、不显示 ADJ 内部单号——**取代** 2026-08-27 BACKLOG「详情十格 + 行可点开」的已定稿设计
4. 客户流水入口 = Overview 资产行尾图标跳转，不进侧栏菜单；对账单弹层退役
5. 金额列两行制：主行总额、副行费用
6. Case History 不展示复观察次数（绕开恒 0 计数器，不修）
7. 补款 / 垫款客户措辞 `Credit from FiatX · balance restoration / advance`（业主授权 agent 定，业主可后改一词）

## 9. 验收口径

- **随手闸**：tsc 三连 ①②③ ｜ ④ jest 相关目录全绿（含被词表连带的 spec）｜ ⑤ 前端改动全部 preview 渲染 + 截图
- **收尾闸**：⑥ `on-stack demo:all` 走通断言终态 ｜ ⑧ **必须 reset 重铺**（bucket 枚举值与 reasonCustomer 落库值都变了；判据对照 `demo/baseline.md` 全绿）｜ 本轮不动钱不触发 ⑦，但 §6 读模型上线后跑一次 `verify:coa` 兜底确认零影响
- **英文化闸**（负向判据带复现命令，与本轮摸底扫描同一套启发式）：`grep -rP '[\x{4e00}-\x{9fff}]' admin-web/src client-web/src --include='*.tsx' --include='*.ts' | grep -v '//' | grep -vE '^\S+:\s*\*'` 命中 = 0（排除行内含 `//` 与块注释续行；残余中文若确属注释，逐条人判后放行）；`grep -rn 'SOFT_FLAG' src admin-web/src` = 0
- **RBAC 闸**：动了 `rbac.catalog.ts`（§1 新端点 + §4 退役登记）→ 跑一遍 `on-stack main verify:rbac` 全绿（判例：会写数据的判据须排在 reset 前）
- **走查**：第六幕按 `demo/script.md` 主线过一遍（重点：处置动作列 1280 无横滚、六态梯全英文可讲）；客户端造一条充值→兑换→提现后打开流水页截图（余额列逐行可加）；**没收场景跑一条后看流水页**（§6 tipping-off 实证）；调账单菜单从列表点进详情回案件闭环截图
- **文档收口**（对照 `rules/delivery-checklist.md`，plan 引用不重抄）：`modules/v8-recon.md` §4/§5 前端节 ｜ `demo/script.md` 涉及按钮词的步骤 + `demo/data.md` 如涉及（生成区由 demo:all 自写、不手改）｜ BACKLOG 销账（№87 标签缺失 / №200 死端点页 / №232 SOFT_FLAG 改名 / №246 Demo Compare / №290 客户流水加工层——注明十格设计被 §8.3 取代）｜ decisions.md §8 七条 ｜ CHANGELOG 一行

## 10. 交付清单触发对照（plan 落任务时逐条写死，不许现场再判）

按 `rules/delivery-checklist.md` 左列逐行扫过（2026-09-07，业主点名复查）：

**命中的行**：新增 admin 端点（§1：route + sync + 重启）｜ 新增业务动作前端入口（§1 菜单项）｜ 退役业务动作删前端入口（§4 Demo Compare ×1 + §6 弹层与旧页 ×2，逐键 grep）｜ 改交易三域 → 三域对称（§5 连带⑤）｜ 新内容到客户面 → tipping-off 当场决定（§6 异常结局行节）｜ 涉及金额 → 分存元显（§6 金额契约）｜ 对外识别业务键（§1/§6）｜ 改页面 → 同步 demo 两文档（§9）｜ 改前端 → 截图（§9，永不豁免①）｜ 每轮收尾三件套（§9）

**明确不触发的行**（写死防执行者自作主张）：写审计（本轮零新持久化动作，全是读面 / 文案 / 改名）｜ 新审计码 ｜ 新状态新结局（无新边）｜ 动了钱（无记账变更；verify:coa 仍兜底跑一次，永不豁免②按"未动钱"口径）｜ maker-checker 与 `MAKER_GROUP_BY_POLICY`（无新审批策略）｜ 新增权限组四处齐（复用 `RECON_CASE_READ`，零新组）｜ 新事件 ｜ 改 schema 迁移文件（bucket 是 String 列，§2.2 已钉死）｜ 多波承接（单波）
