# 平账三期 · 事故登记（治理件）

- 日期：2026-09-03 立骨架；**2026-09-06 展开成 spec**（业主逐岔拍板，本文取代骨架）
- 性质：本波 spec。总纲：`2026-09-03-recon-settlement-waves-outline.md`（本波边界与验收口径以总纲为准）；素材取自 313c60a1 全文版草稿，已按拍板口径修订
- 前序：一期 → 一期半 → A 批 → B 批 → 二期，**全部已合 main**——两个前置依赖（B 批补录 / 认领原语、二期补款划转原语）成立，演示闭环不拆

## 承接上一波（二期）

二期（内部划转单：认损补款 / 退汇垫款）16 任务已在 worktree 分支 `worktree-recon-wave2` 执行完毕，待合 main（本轮不展开三期，只写承接）。

### 实际偏差（对照 plan 逐任务）

- **Task 3（审计合同接线）**：plan 原指向 `audit-actions.constant.ts` 内一个 spread 合并点登记七个新审计码；复核后该文件内并无这样的合并点——真正要接线的地方是 `audit-logs.service.ts` 里 `assertActionSpec()` 的 `??` 判空链（V1→…→V8→V2）。第一轮实现漏接，评审当场判 Critical：若不修，七码在 `if (!spec) return` 处静默放行、全部免检。修复接上 `?? V7_TREASURY_AUDIT_ACTIONS[input.action]`（挂在 V8 之后、V2 之前）。
- **Task 2 / Task 10（建表与重铺脚本）**：plan 的 Task 2 只交代新建 `internal_transfers` 表，未提示同步登记进 `scripts/reset-business-data.ts` 的删表顺序；Task 9 的 e2e 造出划转单后，`stack.sh reset self` 在 `asset.deleteMany()` 上撞 FK 约束（`internal_transfers.assetId` RESTRICT）中止——Task 9 之前因表还空未曾撞到，Task 10 才补上登记（独立提交）。
- **Task 9（新 e2e 截止时间）**：截止用真实"现在"而非固定种子时刻，且必须保证不跨 UTC 午夜——这是执行时定的实现约束，不是 plan 原文写明的；記入本节而非 `decisions.md`（不构成业主级业务裁决，是技术实现约束）。
- **Task 11（demo 脚本重排 + 场景 17 金额）**：plan 估计场景 17 的退汇差额约 4800，实测种子铺出的差额是 3200（Grace 铺场时可用余额 3300）——`recon-demo.ts` 注释与 baseline 文档已按实测改口，不影响判据（判据看案件页当场显示值，不是硬编码金额）。
- **Task 12（走查截图）**：评审补上两处 brief 未点名的旧口径：认损锁定视图仍沿用旧「核销」家族前缀常量（需按 `reasonCode` 改成「认损」）；处置弹层里退汇认领的说明文字仍写着"客户池待二期划转"（需改成认损 / 补录口径）——与 Task 4 发现的手册旧口径同一类缺陷：功能上线后没人回头改写死的旧状态文案。

### 执行中发现的新事实

- `cases.book` 落库存的是 `'CUSTOMER'`，而 `adjustments.book` 存的是 `'CLIENT'|'FIRM'`——两张表口径不同，判断账簿归属统一按 `=== 'FIRM'`。
- 模拟托管方对账单镜像行在腿 **SUBMITTED** 时写入，账本在腿 **CONFIRMED** 时落账——两者不是同一时点，且互不重复计数（评审专门核对过）。
- 加密币路径只有一条腿（直达），法币路径两条腿（经结算户，串行——腿 1 CLEAR 后腿 2 才诞生）。
- `verify:coa` 在 e2e 挪动真钱之后仍全绿——两恒等式 + 负余额断言未被内部划转破坏。
- **「批准时运营户余额不足 → FAILED 且无资金单无分录」是单测级承诺，不是 e2e 级**（终审留档）：唯一覆盖在 `internal-transfer-workflow.service.spec.ts`（mock 断言 FAILED(INSUFFICIENT_FIRM_BALANCE) 且未建资金单），变异删掉余额闸时红的是它；e2e 没测是因为真库要把运营户抽干、成本不成比例。三期若动 `onDecided` 的余额复核，记得这条防线只有单测形状。
- demo 判据终态：17/17 场景 / 11/11 钱包（破口 8 / 软标记 2 / 在途 1）/ `casesOpened` 11/11 / `demo:all` 29/29；`recon:demo:break` 若只轻量重跑不整库重铺，场景 6（重复入账真写账本）会假性 MISSED（显示 16/17）——既有现象、baseline 已登记，非本波引入，但两个新场景加入后更容易被误读成检出退化，验收时须走整库重铺。

### 三期前提有无变化

- **补款划转已是一个可复用的赔付原语**：内部划转单今天只有两种诞生方式——补款（`initiateCompensation`，源 = 已过账的认损调账单 `adjustmentNo`）与垫款（`initiateAdvance`，源 = 案子 + 退汇账单行 `externalLineId`）。三期做「未授权转出事故认损后的赔付」时，需要给补款再加一条来源（`sourceIncidentNo`，指向三期的事故登记单），不是重新发明一条赔付通道。
- `SimulatedCustodianStatementService`（模拟托管方回单）可以被三期直接复用——它只认"资金单腿提交"这个触发点，不关心资金单挂在哪个父类型下面，接线点已经通用。
- 成因表现为 **20 码**（`FIRM_TRANSFER_UNTRACKED` 已退役），`UNAUTHORIZED_OUTFLOW` 仍然留档（出口"留档 · 事故升级（三期）"未变）——三期设计时这两点都是既定起点，不用重新盘点。
- 复核人口径不变：三期涉及资金的动作（追索、赔付）复核人仍是 CFO；`UNAUTHORIZED_OUTFLOW` 定性时的上报留痕（对象 / 时限 / 依据）需求点依旧待三期设计补齐，本波未涉及。
- 追索的入口已经确定：`purpose=CLIENT_ADVANCE` 的垫款单是它的锚点（客户欠公司的钱来自哪一张垫款单），但追索本身（客户 → 公司反向）**只登记不入账**——三期落地时这条已是既定事实，不必重新讨论账务模型。

## 0. 拍板记录（2026-09-06 脑暴，业主逐岔）

| # | 岔口 | 拍板 |
|---|---|---|
| G1 | 模块归属 | **甲：独立治理件** `governance/incidents`，与审批中心平级。事故可不来自对账（人工登记），挂对账下名不正；decisions 已写清与已删 `incidents`（合规筛查信号，归 Sumsub）的区别 |
| G2 | 首批类型 | **四个**：未授权转出 / 大额查不出 / 退汇欠款 / 人工登记；漏记提现、恒等破裂留 BACKLOG |
| G3 | 状态机 | 五态（已登记→调查中→已定损→处置中→已结案）；**升级是动作 + 记录，不是状态** |
| G4 | 谁裁决 | 登记：运营 / 金库；结案按性质分链：安全类两步 MLRO→CFO、资金类单步 CFO（§3） |
| G5 | 通报 | 只留痕不真发；**依据条款做成常量目录，时限跟条款走**（§4）——应然依据：真实世界上报是人工经门户 / 邮件，系统本分 = 证据、计时、留痕 |
| G6 | 冻结 | 不自动；事故页只放「去冻结」指路链接（冻结是合规动作，有自己的门） |
| G7 | 账务 | 事故零账务；善后走既有原语（补录 / 认领 / 认损调账 / 补款划转）；追索只登记不入账、不设应收科目 |
| G8 | 演示 | 新增破口场景「未授权转出」（场景 18），从登记走到结案 + 通报草案；另演一笔人工登记 + 撤回 |
| G9 | 大额到线 | 案子上「超期 · 待升级事故」文案变可点按钮，预填金额 / 钱包 / 案号 |

骨架「展开时要核的事实」三件的结论：① 审批框架按动作类型一对一取策略（`approval.constants.ts` 的 `POLICY` 表），不支持同一类型内按条件分流 → 结案拆两个动作类型（§3）；② 二期已合 main（f4611e05），无需降级方案；③ 通报时限已按 roadmap 一手核（业主指路核数）：**72h 只属网安 / BCDR 线**（TIR Rulebook Section K + H；roadmap 2026-07-04 纠偏明确"72h 归网安 / BCDR，旧版误挂'重大事件上报'"），CRM 未平差异线（IV.E.5 / V.D.2）一手核**未载时限数字**——不杜撰，该依据不带倒计时。

## 1. 定位与边界

**是什么。** 一张事故单：谁登记、什么类型、涉及哪个钱包 / 客户 / 多少钱、从哪张案子来、调查记录、升级给了谁、定损多少、善后走了哪些单（补录 / 认领 / 调账 / 划转）、有没有通报监管、谁结的案。零账务。

**不是什么。** 不是合规筛查——Sumsub 的 case 管"这个人 / 这笔钱可不可疑"（合规调查台，decisions [合规承接]），事故簿管"出了事怎么交代"；不是 STR / goAML——可疑交易报告是 MLRO 经 goAML 的合规线（roadmap 纠偏④：Sumsub 报不了、无固定天数），不进本模块；不是通知中心；不是对外通报系统（G5：不真发）；不是恒等破裂的收敛流程（BACKLOG 既定缓做）。

**为什么单独一个主体。** 调账单和划转单都是「钱怎么改」，事故单是「事情怎么交代」：谁知道、何时知道、上报没有。两条硬理由：① 事故可以不来自对账（人工登记：托管方安全通告、钓鱼中招、服务中断、监管问询引发内查），挂对账下这些事没门进来；② 退汇欠款那根刺——公司垫款的损失在落账那刻已全额入账，客户欠的债**在账上故意无处安身**（不设应收科目），案子关了、划转单完结了，不登记就彻底隐形。**欠条得有个家。**

**案子与事故的关系。** 案子是「账不平」的载体，事故单是「要交代」的载体；差异只有严重到要对外或对上交代的程度，才从前者升格出后者。案子不因事故登记而愈——账实仍不符直到善后落账。

## 2. 主体与状态机

主体 `Incident`（单号 `INC…`）。

| 状态 | 含义 | 出边 |
|---|---|---|
| `REGISTERED` 已登记 | 有类型、金额、来源；从案子一键登记或人工登记 | `START_INVESTIGATION → INVESTIGATING`；`WITHDRAW → WITHDRAWN`（误登记，必填说明，留审计——登记簿上没有橡皮擦） |
| `INVESTIGATING` 调查中 | 记录调查条目（时间、人、发现）；可做「升级」动作 | `ASSESS → ASSESSED` |
| `ASSESSED` 已定损 | 定损金额、定损口径（RECOVERED 追回 / FIRM_LOSS 认损 / CLIENT_COLLECTION 追索 / NO_LOSS 无损失）、是否需通报 + 依据 | `START_RESOLUTION → RESOLVING`；`CLOSE_NO_ACTION → CLOSED`（无损失、无善后，仍走结案审批） |
| `RESOLVING` 处置中 | 善后单挂上来：补录 / 认领 / 调账 / 划转，各自在自己域走完 | `CLOSE → CLOSED`（结案审批批准后） |
| `CLOSED` / `WITHDRAWN` | 终态 | — |

- 显式迁移表；`ASSESSED` 之前不能结案（G3）
- **计时：通报时限一只钟。** 起算点 = **事故登记时刻**（TIR 条款措辞是"检测后 72h"，登记就是系统的检测记录，不从定损起算）；`reportDeadlineAt` 在定损勾选带钟依据时计算落库；超时只软标 + 审计，不推状态。其余不计时
- 升级动作：`ESCALATE { to: MLRO | CFO | SENIOR_MANAGEMENT, note }`，可多次，每次一条记录 + 审计；升级是留痕不是审批，硬门只有结案审批一道

## 3. 审批（结案拆两个动作类型）

框架按动作类型一对一取审批链（§0 实证），不为单用例加分支能力——拆两个类型，各绑各的链：

| 动作类型 | 审批链 | 哪些事故走它 |
|---|---|---|
| `INCIDENT_CLOSE_SECURITY` 事故结案·安全类 | 两步 `[MLRO] → [CFO]` | 未授权转出 |
| `INCIDENT_CLOSE_FINANCIAL` 事故结案·资金类 | 单步 `[CFO]` | 大额查不出 / 退汇欠款 / 人工登记 |

- **提单人无感知**：一个「提结案」按钮，系统按事故类型自动挑动作类型开审批单；两步链先例 = `DEPOSIT_SEIZE`，框架零改动、纯登记两行策略
- 两步分工：MLRO 把合规 / 安全关（调查全不全、升级到位没有、通报留痕齐不齐、要不要另走 STR），CFO 把钱关（定损金额、善后单都落账了、公司损失口径）；任一步拒绝 = 整单拒绝，事故留在处置中，可补可重提
- 结案审批单摘要：类型、金额、定损口径、善后单号清单、是否已通报
- maker≠checker 照旧：`MAKER_GROUP_BY_POLICY` 两行都指 `INCIDENT_WRITE`；MLRO / CFO 不持 `INCIDENT_WRITE`，自批死锁不存在；48h 时效、批前可撤，与其他审批单同款
- ⚠️ 二期承接教训：**审批类型三处同加**（routes + detail-read + maker），漏一处就是 403 或摘要空白

## 4. 通报留痕（只留痕不真发）

**依据条款目录**（常量表 `INCIDENT_REPORT_BASES`，roadmap 一手核，数字不杜撰）：

| 依据码 | 条款 | 义务 | 法定钟 |
|---|---|---|---|
| `TIR_K_H` | TIR Rulebook Section K + H | 材料性网安 / BCDR 事件报 VARA：性质 / 范围 / 影响 + 缓解 + 是否已报他机关 | **72h，检测起算** |
| `CRM_IV_E_5` | CRM IV.E.5（Client Money） | 重大未平差异未纠正 → 通报 VARA | 无（条款一手核未载数字） |
| `CRM_V_D_2` | CRM V.D.2（Client VAs） | 同上，客户虚拟资产侧 | 无 |

- 定损时勾「需通报」并**多选依据**（未授权转出并引 TIR + CRM 是常态：既是安全事件又是客户资产差异）；`reportDeadlineAt` = 登记时刻 + 所选依据中最紧的钟；只选无钟依据则不设倒计时，界面显式显示「未设时限」
- 事故单下挂通报子记录：`required`、`basisCodes`、`deadlineAt?`、`draft`（通报草案正文）、`reportedAt?` / `reportedByUserId?`（人工点「已通报」）、`reference?`（对外编号）。**三要素必须留痕：对象（VARA）、时限（含"未设时限"这个显式状态）、依据**
- **不做泛化的"重大事件一律 72h"**——72h 常量只绑 `TIR_K_H` 一条依据（roadmap 纠偏①正是旧版把它挂错的教训）
- **重要性阈值立场（写明，防止被当漏做）**：低于账龄线金额的查不出差异走核销、不单独通报 VARA——实务里这是客户资金政策的重要性门槛，门槛下差异内部处置留痕即可

## 5. 事故类型、入口与善后

**首批四类**：

| 类型 | 从哪来 | 通常通报姿态 | 善后口径 |
|---|---|---|---|
| `UNAUTHORIZED_OUTFLOW` 未授权转出 | 案子定性（查出来了：这笔转出不是我们发起的——钥匙泄露 / 内部人 / 银行误划） | 需通报，TIR + CRM 并引，72h 倒计时 | 认损调账 + 补款划转（客户余额复位） |
| `LARGE_UNEXPLAINED` 大额查不出 | 挂起·调查中 → 账龄到线 → 大额（查不出：悬而未决本身升格为事故） | 需通报，CRM 依据，无法定钟 | 后续查明则按查明结果走；仍不明则认损 / 核销口径 |
| `CLIENT_SHORTFALL` 退汇欠款 | 退汇认领余额不足 → 垫款之后，客户欠公司 | 通常不通报（催收事务） | 追回（钱进来时按进账落账）或放弃追索（无分录——损失早在垫款落账时入账） |
| `MANUAL` 人工登记 | 治理台空表单（型录外其他事件兜底） | 定损时从依据目录选 | 视事而定，可零善后 |

**四个入口**：

| 入口 | 位置 | 预填 |
|---|---|---|
| 案子定性 `UNAUTHORIZED_OUTFLOW` → 「登记事故」 | 对账案子详情定性行出口 | 类型、钱包、客户、金额、案号、账单行参考号 |
| 公司池大额到线 → 「升级事故」 | 案子详情 A 批「超期 · 待升级事故」处（文案变按钮，G9） | 类型 `LARGE_UNEXPLAINED`、金额、钱包、案号 |
| 退汇认领余额不足 → 「登记欠款」 | B 批认领拒绝提示处（垫款按钮旁） | 类型 `CLIENT_SHORTFALL`、客户、差额、垫款单号（存在时锚定） |
| 人工登记 | 治理台「事故登记」列表新建 | 空表单，类型手选，来源案号为空 |

**善后回挂**：事故单上「善后单」列表，登记时选类型（补录 / 认领 / 调账 / 划转）+ 单号，系统只校验单号存在与归属同一客户或钱包；单子在各自域走完自己的审批与记账，事故页只读它们的状态。

**未授权转出的善后两步**（不发明新通道）：① 认损调账——沿用二期认损家族（金库开单、`reasonCode = UNEXPLAINED_CLIENT_LOSS`、CFO 批），把客户应付减掉、账实归一；开单门槛为事故路新开分支：定性行出口 = `INCIDENT` 且事故已定损（口径认损）、金额锁定 = 定损额，**不要求账龄到线、不受小额线约束**（大额正是走事故的理由——今日小额线守卫的报错文案就写着"走事故登记"）；② 补款划转——**复用既有补款通道原样**（源 = 已落账认损单 `adjustmentNo`，金额锁定 = 认损额 = 定损额，CFO 批）。plan 前实证：`initiateCompensation` 守卫链（POSTED + `UNEXPLAINED_CLIENT_LOSS` + CLIENT 池 + 防重开）对事故路成立，事故页「发起补款」按钮带认损单号调既有端点即可，**不加 `sourceIncidentNo` 列**（承接预判修正——追溯链 = 事故善后挂载 + 划转单自带 `sourceAdjustmentNo`，已闭合）。落账后重对账，案子自愈。

**案子侧**：成因表 `UNAUTHORIZED_OUTFLOW` 出口从「留档 · 事故升级（三期）」改为 `INCIDENT`（新 `StoredOutlet` 值），定性行显示「事故 · 已登记 INC…」可点；案子不因登记而愈。

## 6. 页面

- 管理台治理：「事故登记」列表（类型 / 状态 / 金额 / 来源案号 / 通报状态 / 时限倒计时）、详情（基本信息、调查记录时间线、升级记录、定损、善后单、通报留痕、审批、「去冻结」指路链接）、新建表单
- 对账案子详情：三处入口按钮（§5）
- 审批中心：通用（两个新动作类型天生分列，"安全类结案谁签的字"一个筛选就出来）
- 客户端：**无**。事故信息一律不出客户面（未授权转出可能涉刑事调查，tipping-off 同款谨慎；客户看到的只是善后落账后的余额变化）

**截图六张**：登记表单｜调查中详情（含升级记录）｜定损 + 通报草案（72h 倒计时在画面里）｜善后单挂载｜两步结案审批｜案子上的三处入口。

## 7. 审计与权限

- 审计码 11 个（domain `GOVERNANCE`）：`INCIDENT_REGISTERED` / `_INVESTIGATION_STARTED` / `_NOTE_ADDED` / `_ESCALATED` / `_ASSESSED` / `_REMEDIATION_LINKED` / `_REGULATOR_REPORT_DRAFTED` / `_REGULATOR_REPORTED` / `_CLOSE_REQUESTED` / `_CLOSED` / `_WITHDRAWN`；`_ESCALATED` 必填 `escalatedTo`，`_REGULATOR_REPORTED` 必填 `basisCodes`。四属性（含义 / actionDomain / correlationMode / 特有必填）出生即冻结、plan 逐码定——单步动作 `correlationMode=N` 不伪造关联（二期判例）
- ⚠️ **接线点 = `audit-logs.service.ts` 里 `assertActionSpec()` 的 `??` 判空链**（二期 Task 3 的 Critical 教训：接在常量文件里没用，漏接这条链 = 11 码全部免检静默放行）
- 权限组 2 个：`INCIDENT_WRITE`（运营 + 金库：登记、调查、定损、挂善后、提结案、撤回）｜ `INCIDENT_READ`（MLRO、CFO、内审、高管：看）。不设单独复核组——裁决走审批中心策略角色，与其他审批同款；四处齐（`PermissionGroup` 联合类型 / 职务 bindings / `route()` / 桶目录）。**桶落位**：桶目录新增「事故登记」域两桶（查事故 = `INCIDENT_READ`、管事故 = `INCIDENT_WRITE`）——G1 独立治理件在目录上的映射，维持零空域；12 域 56 桶 → 13 域 58 桶，`overview.md` §4 收尾同步
- 端点 11 个：`POST /admin/incidents`（登记）、`GET` 列表 / 详情、`POST …/:incidentNo/notes`、`…/escalate`、`…/assess`、`…/remediations`、`…/regulator-report`（存草案）、`…/regulator-report/mark`（标已通报 + 编号）、`…/close`（开审批）、`…/withdraw`；`route()` 登记 + `db:base:sync` + 重启

## 8. 演示脚本变化

新增破口场景「未授权转出」（**场景 18**，编号接二期之后）：客户钱包幽灵 OUT、无任何单据 → 第六幕末段：定性「未授权转出」→ 登记事故 → 调查记录两条（查托管流水、查内部操作日志，结论：API 钥匙泄露）→ 升级 MLRO → 定损「认损，需通报」（并引 TIR + CRM，72h 倒计时起走）→ 通报草案 → 善后：认损调账 + 补款划转（客户余额复位）→ 结案两步审批 → 案子重对账愈。顺带演一笔 `MANUAL` 人工登记并撤回，讲「误登记怎么收」。

花名册不动；`recon:demo:break` 场景数 **18/18**；钱包位与金额、`casesOpened` / 钱包数 / `demo:all` 判据数 plan 时定（承接：Alice USDT 已被场景 16 占用则叠 Bob USDT）；`demo/script.md` 第六幕末段新增步骤、`demo/data.md`（生成区由 `demo:all` 自写、手写区如需）与 `baseline.md` 同步。验收必须**整库重铺**（承接：轻量重跑会让场景 6 假性 MISSED，误读成检出退化）。

## 9. 验收标准

- 随手闸三处；jest：`governance/incidents/`（新）、`reconciliation/`、`approvals/` 全绿
- e2e `test/incident-register.e2e-spec.ts`：从案子登记 → 调查 → 升级 → 定损 → 善后挂载（引用真调账单 / 划转单）→ 两步结案 → 终态；通报留痕三要素齐（含无钟依据的「未设时限」显式态）；`ASSESSED` 前结案 400；人工登记 + 撤回；权限：运营能登记不能裁决、CFO 不能自批、两步链 MLRO 未批时 CFO 批不动
- 收尾闸：`reset` 整库重铺 → `demo:all` → `recon:demo:break` 18/18 → 第六幕末段走查 → `verify:coa`（事故零账务；善后落账后恒等仍平）→ `verify:audit`（11 新码）→ `verify:rbac` → 截图六张
- 变异测试：删「定损前不许结案」守卫 → 对应 e2e 必红；删通报时限计算 → 倒计时断言必红
- 新表登记 `scripts/reset-business-data.ts` 删表顺序（二期 Task 2/10 的 FK 教训，随建表同一提交做）

## 10. 明确不做

真实对外通报 ｜ 自动冻结 ｜ 恒等破裂收敛全链 ｜ 漏记提现类型（BACKLOG）｜ STR / goAML（MLRO 合规线，不进本模块）｜ 泛化「重大事件 72h」钟（72h 只绑网安依据）｜ 低于账龄线差异的单独通报（重要性阈值立场，§4）｜ 通知中心 ｜ 事故 SLA 硬推状态 ｜ 应收科目 ｜ 客户端可见 ｜ 与 Sumsub 的信号联动 ｜ 幂等 / 并发 / 重试

## 11. 依赖与顺序

前提全部成立：B 批已合 main（2ee61e2a 收口，补录 / 认领原语）、二期已合 main（f4611e05，补款划转原语）。骨架里的降级拆分方案作废，演示闭环完整演。

## 12. decisions.md 条目（2026-09-06 已落档，此处存目）

- 事故登记是治理件、独立主体 `Incident`（`governance/incidents`），与已删 `incidents` 的区别写清
- 事故零账务；善后走既有原语（补款复用 `adjustmentNo` 通道、不加 `sourceIncidentNo`——实证守卫链后修正承接预判）；追索只登记不入账、不设应收科目
- 结案裁决按类型拆两个审批动作类型（安全类两步 / 资金类单步）；升级是动作不是状态
- 监管通报只留痕；依据条款目录 + 时限跟条款走（72h 只属网安线；CRM 线无钟不杜撰；小额不单独通报）

## 附录 A · 数据模型（一个迁移）

| 表 | 字段 |
|---|---|
| `incidents`（新） | `id`、`incidentNo @unique`、`type`、`status`、`sourceCaseNo?`、`sourceDispositionNo?`、`sourceExternalLineId?`、`sourceAdvanceTransferNo?`（退汇欠款锚定的垫款单）、`walletRef?`、`customerId?`、`assetCode?`、`amount Decimal?`、`title`、`description`、`assessedAmount?`、`assessmentBasis?`（RECOVERED / FIRM_LOSS / CLIENT_COLLECTION / NO_LOSS）、`reportRequired Boolean`、`reportBasisCodes?`（依据码列表）、`reportDeadlineAt?`、`reportDraft?`、`reportedAt?`、`reportedByUserId?`、`reportReference?`、`registeredByUserId`、`closedAt?`、`withdrawnReason?`、`traceId`、时间戳 |
| `incident_notes`（新） | `incidentId`、`kind`（NOTE / ESCALATION）、`escalatedTo?`、`body`、`authorUserId`、`createdAt` |
| `incident_remediations`（新） | `incidentId`、`kind`（SUPPLEMENT / CLAIM / ADJUSTMENT / TRANSFER）、`referenceNo`、`linkedByUserId`、`createdAt` |
| `reconciliation_dispositions` | + `incidentNo String?`（与 `adjustmentNo` / `supplementNo` 平行） |

（`internal_transfers` 不加列——补款复用 `sourceAdjustmentNo` 既有通道，§5。）

常量：`INCIDENT_REPORT_BASES` 依据目录（3 条，§4）；`ApprovalActionTypes` +2、策略 +2、`MAKER_GROUP_BY_POLICY` +2；`AuditActions` +11、工作流类型 +1；`PermissionGroup` +2、`route()` +11；成因表 `UNAUTHORIZED_OUTFLOW` 出口 `DEFERRED/INCIDENT` → `INCIDENT`（新 `StoredOutlet` 值）；A 批账龄「待升级事故」文案改按钮。

## 附录 B · 交付清单行（`rules/delivery-checklist.md` 对照）

任何持久状态变化 ｜ 新增审计动作码（11，接 `assertActionSpec` 链）｜ 新状态 / 新结局（一整套迁移表；计时：通报时限一只钟、登记起算、软标）｜ 该走 maker-checker（结案，两类型）｜ 新增审批策略（+2，三处同加）｜ 新增权限组（2）｜ 新增 admin 端点（11）｜ 新增业务动作（前端入口四处）｜ 对外识别（`incidentNo`）｜ 改 schema（三新表 + 两加列，登记 reset 删表顺序）｜ 改页面与种子（破口场景 +1，`demo/script.md` + `demo/data.md` 同步）｜ 改了前端（截图六张）｜ 每轮收尾（modules：`v1-governance.md` 加事故一节或新篇 plan 定；`v8-recon.md` §5 三处「三期」句改现状；手册 `UNAUTHORIZED_OUTFLOW` 行；`overview.md` 含 §4 桶目录数；`decisions.md` 已落；`CHANGELOG.md`；`BACKLOG.md` 销 §G 三期条 + 上报留痕待设计 + B 批留下的追索行；roadmap 461 行部分兑现提醒业主自更）｜ **多波收官**（三期是最后一波：「承接下一波」行不触发——无下一波；取而代之，本波合并后**总纲随之归档 `archive/`**，总纲第 4 行自定的生命周期）

不触发：动了钱（事故零账务；善后在各自域已各自过闸）｜ 改了交易三域（无）｜ 新字段到客户面（无，刻意）｜ 新事件（无）

## 进 plan 前要核（2026-09-06 已核毕，结论如下）

- ~~认损调账门槛~~：实证绑死「`slaBreached` 账龄到线 + 定性行 `HOLD_INVESTIGATING` + 小额线」（`adjustment.service.ts` `assertWriteOffAllowed` 四前提）——事故路按 §5 开 `INCIDENT` 分支（定损锁额，免账龄线与小额线）
- ~~补款来源~~：不加 `sourceIncidentNo`（§5，实证守卫链后修正承接预判）
- ~~场景 18 判据~~：钱包位选当前不在 break 桶的客户钱包（优先 Bob USDT-TRON，铺场任务先打印钱包桶现状再定）；判据 17/17→**18/18** 场景、11/11→**12/12** 钱包桶（break 8→9）、`casesOpened` 11/11→**12/12**、`demo:all` 29/29 花名册不动
- ~~`_REGULATOR_REPORT_DRAFTED` 时机~~：只在首次落草案时记一次，后续改稿不另记（改稿留在草案字段的最后版本，审计只证"何时开始起草"与"何时通报"两个时点）
