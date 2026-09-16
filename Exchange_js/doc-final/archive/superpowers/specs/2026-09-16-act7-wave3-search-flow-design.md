# 第七幕波三 · 检索动线 + 收口 —— 设计稿

> 总纲：`2026-09-15-act7-audit-campaign-charter.md`（§3 波三节 = 范围权威）｜ 基线 main `5d6b7ed0`
> 业主 2026-09-16 两拍板：① Related Subjects 展示区**收进本波**（原骨架待定项）② 资金单详情审计栏取数走**甲案·前端直调审计接口**（乙案后端内嵌否决，已登 `decisions.md`）。
> 业主口径入册：**Raw Record 区管完整性**（日志表全量展示，乙案 id 过滤照旧不翻案），**结构化区管可读性**——两者分工，详情页可读性收口按此定位。
> 本文行号/计数均为 2026-09-16 主会话实测（grep 复现命令见各节）；执行时以当场重扫为准。

## 0. 本波做 / 不做

**做**：① 后端检索三小改（keyword 补 eventNo / DTO 补 action 过滤 / subjectNo 语义扩 OR）② 审计列表页 URL 参数收口 + 筛选补栏（actionDomain 下拉、action/workflowType/correlationId）+ 套 ListFooter ③ 审计详情页可读性收口（Related Subjects 区 / correlationId·causationId 渲染 + View journey / 人话标签）④ 六个实体详情页「View audit trail」深链 ⑤ 资金单详情审计栏改读中央审计日志（甲案），InternalFundAuditLog 读取链摘除 ⑥ 跳转映射补费率两族 + FUNDS_ORDER 收编 + 15 孤儿键清理 ⑦ 文档收口 + 词表导出脚本入库重出最全版（判据 6）。

**不做**（对照总纲 §2 与 CLAUDE.md §2）：审计→账本凭证跳转（岔口③，2026-09-15 拍板不做）｜ 无详情页的主体类型硬造跳转（甲案「不硬造」口径不变）｜ InternalFundAuditLog **删表**（读写双死后删表留给下次动 schema）｜ 检索性能 / 索引 / 分页优化 ｜ 登录留痕 ｜ 客户面任何审计可见性（tipping-off）｜ 死权限常量 `AUDIT_EVIDENCE_EXPORT_DETAIL_READ` 删除——**波一 `6f9919c3` 已连带删除**（`grep -rn "AUDIT_EVIDENCE_EXPORT_DETAIL_READ" src admin-web/src` 零命中），总纲此项销账不重做 ｜ schema / seed 零触碰（⑧ 不触发）。

**验收** = 战役判据 3（第七幕五步走查全程从实体页一键进审计、零人肉抄号切页，⑤ 全程截图）+ 判据 6（词表最全版交业主放 `lark/`）。

## 1. 后端检索三小改（其余能力已现成）

**现状实测**：`findAll`（`audit-logs.service.ts:1012-1066`）已支持 `actionDomain` / `correlationId` / `causationId` / `ownerCustomerNo` / `primarySubjectType` / `primarySubjectNo` / `isReadOnly` / `subjectNo`+`subjectRole` 全套过滤——筛选补栏的后端**几乎零活**，本节只有三处真改动：

1. **keyword 补 `eventNo`**：`buildWhere` 的 keyword OR 列表（`audit-logs.service.ts:480-488`，现为 action / primarySubjectType / primarySubjectNo / actorNo / ownerCustomerNo / traceId / reason 七列）加 `{ eventNo: { contains } }`。前端 placeholder「Audit No / Keyword」的假承诺（输 AUD 号零命中）自此坐实为真。连带：DTO keyword 注释改真——`audit-log.dto.ts` 声明「匹配 action/module/entity/reason」，`module` 列根本不存在，改成实际八列清单。
2. **DTO 补 `action` 精确过滤**：`AuditLogQueryDto` 无 `action` 字段（实测 :275-357 全清单），补 `@IsOptional() @IsString() action?: string`，`findAll` 消费一行（精确匹配，与 `actionDomain` 同款写法）。
3. **`subjectNo`（Related No）语义扩 OR**：现 `findAll:1031-1036` 纯子表 `subjects: { some: { subjectNo } }`。但 subjects 子表只覆盖 47/263 码（`SUBJECTS_COVERED_ACTIONS` 名册）；交易域订单的主链事件只落主表 `primarySubjectNo` 列——从提现单深链过来只能拉到审批那几条，主链一条没有，判据 3 立不住。改法：
   - `subjectNo` 单给（无 `subjectRole`）→ `OR: [{ primarySubjectNo: X }, { subjects: { some: { subjectNo: X } } }]`（作为一条 AND 子句 push，与既有 andClauses 组合方式一致）；
   - `subjectNo` + `subjectRole` 同给 → 维持纯子表语义（主表没有角色概念）；
   - DTO `subjectNo` 描述同步改写（「按主体业务键检索——命中主对象或任一相关主体，监管索档的主入口」）。
   - **不影响 `verify:audit`**：Q2/Q4 名册断言直查子表、不经 `findAll`（plan 时复核一遍 import 面）。

**测试**：`audit-logs.service.spec.ts` 用波一留下的顶层 `mockFindManyByWhere` 行为化 mock（禁止回退 `mockResolvedValue` 无视 where 的假绿形态）补三组用例：keyword 命中 eventNo；action 精确过滤生效；subjectNo 单给时主表命中（无子表行的事件）能查到、带 subjectRole 时不 OR 主表。

## 2. 审计列表页：URL 参数 + 筛选补栏 + ListFooter

文件：`admin-web/src/pages/AuditLogsPage.tsx`。

1. **URL 参数收口**：进页用 `useSearchParams` 读全部筛选字段（现有 keyword / outcome / actorNo / traceId / primarySubjectNo / subjectNo / ownerCustomerNo / startAt / endAt / includeArchived + 新增 actionDomain / action / workflowType / correlationId），任一参数在场即预填 `FilterState` 并自动查询；点搜索时把当前筛选**回写 URL**（replace，不压历史栈）——深链可分享、后退可回。
2. **筛选补栏**：主栏（:271-319）加 `actionDomain` 下拉——选项前端写死 11 域 + UNCLASSIFIED（APPROVAL / IAM / CONFIG / AUDIT / CUSTOMER / DEPOSIT / WITHDRAW / SWAP / TREASURY / RECON / GOVERNANCE，与词表 11 域一致；域清单几年不变一次，不值得建接口）；高级栏（:322-365）加 `action`、`workflowType`、`correlationId` 三个文本输入框。
3. **套 `ListFooter`**：换掉现在的 `Pagination`（:560-567），照 `FundsOrderList` 等 13 页现成用法；BACKLOG §I 清单同步减一。

## 3. 审计详情页可读性收口

文件：`admin-web/src/pages/AuditLogDetailPage.tsx`。三处新增，Raw Record 区（:137-167，乙案过滤）零改动。

1. **旅程渲染 + View journey**：FE `AuditLogDetail` interface 补 `correlationId` / `causationId`（后端 `findOne` 经 `mapEvent:289-290` 已回传，前端从未声明）；Workflow 区（:370-380）补两个 Field；correlationId 值旁挂「View journey →」→ `/admin/audit/logs?correlationId=<值>`（吃 §2 的 URL 参数）。这就是 `v1-governance.md` §4「按旅程看邀请」承诺的兑现。
2. **Related Subjects 区**（业主拍板收进）：位置在 Entity 区（:328-365）之后、Workflow 区之前。数据源 `detail.subjects`（`findOne:1067-1090` 已回传 `[{subjectType, subjectNo, subjectRole}]`，前端从未声明/渲染，此前只能在 Raw Record 的 JSON 里肉眼扒）。渲染规则：
   - **滤掉 `subjectRole === 'PRIMARY'` 镜像行**（与上方 Entity 区重复）；
   - 余下按角色分组，顺序 OWNER → INSTRUMENT → RELATED → COUNTERPARTY；
   - 每行 = 角色 badge + subjectType 小字 + subjectNo 等宽字体；`AUDIT_ENTITY_ROUTE_BY_SUBJECT_TYPE` 命中的号可点跳转，未命中纯文本（甲案不硬造）；
   - 过滤后为空时整区不渲染。
3. **人话标签**：Hero 区 Action 码（:268-271）下方加一行小字 `userActionLabel`（· 分隔 `businessWorkflowLabel`）——`mapEvent:278-283` 早已回传，前端从未用；null 时不渲染。列表页不动（列宽紧张，详情页够用）。

## 4. 实体页深链（判据 3 主体）

1. **共享组件**：`admin-web/src/components/common/ViewAuditTrailButton.tsx`（同一职责同一组件，判例在案），props = 一组查询参数，内部拼 `/admin/audit/logs?<params>` navigate。
2. **接入七页**（六页头部按钮 + 资金单走栏内入口，与 §0「六个实体详情页」口径一致）：

| 入口页 | 深链参数 |
|---|---|
| `DepositTransactionDetail` / `WithdrawTransactionDetail` / `SwapTransactionDetail` / `ApprovalDetailPage` / `AssetDetail` | `?subjectNo=<本页单号>`（吃 §1.3 OR 语义：主链 + 牵连一次拉全） |
| `CustomerDetail` | `?ownerCustomerNo=<客户号>`——owner 列全域事件都写，比 subjects（47/263 码）覆盖全，客户全轨迹靠它 |
| `FundsOrderDetail` | 不加头部按钮，走 §5 审计栏内「View full trail →」（同一参数 `?subjectNo=<fundsOrderNo>`），一页一个入口 |

按钮统一放各详情页头部动作区（`PageTitleBar` / `DetailPageHeader` 一带，plan 时逐页对位）。看审计页需要审计读权限，无权限点过去 403——演示单人操作，接受，不做权限预判。

## 5. 资金单审计栏改读中央审计日志（岔口甲）

**现状**：栏读死表 `InternalFundAuditLog`——后端 `funds-order.service.ts:363` detail include `auditLogs`，前端 `FundsOrderDetail.tsx:99` `FoAuditLog` 类型 / `:578` 渲染 / `:784` `AuditLogList` 组件。该表 2026-09 起零写入，栏内容恒旧。

**改法（甲案，业主拍板）**：
- **后端**：`funds-order.service.ts:363` 的 `auditLogs` include 删；DTO / 响应类型里 `auditLogs` 字段连带摘除（全量 grep 消费方）。资金单接口从此不带任何审计数据。
- **前端**：`FoAuditLog` 类型、`AuditLogList` 组件、`:578` 渲染整段删；新审计栏 = 页内直调 `GET /admin/audit-logs?subjectNo=<fundsOrderNo>&take=10`，渲染最近 10 条（时间 / 动作 / actor / 结果，行点击进审计详情页）+「View full trail →」深链；请求 403 时栏内中性提示（无审计读权限），不炸页。
- `InternalFundAuditLog` 自此**读写双死**；删表留给下次动 schema 的任务顺手清（BACKLOG 在案，重锚一句「读取链已摘」）。

## 6. 跳转映射与常量收口

文件：`admin-web/src/pages/auditEntityRoutes.ts` + `src/modules/audit-logging/constants/audit-actions.constant.ts`。

1. **映射补费率两族**（有页可落，实证闭环）：写点 `fee-level-workflow.base.ts:83` 等处 `primarySubjectNo = levelCode`，路由 `App.tsx:238/:240` 收 `:levelCode`——加两行：`WITHDRAWAL_FEE_LEVEL: (no) => /admin/pricing/withdrawal-fee-levels/${no}`、`SWAP_FEE_LEVEL: (no) => /admin/pricing/swap-fee-levels/${no}`。
2. **FUNDS_ORDER 收编**：`AuditEntityTypes` 加 `FUNDS_ORDER` 键；9 处审计字面量替换（`grep -rn "'FUNDS_ORDER'" src --include='*.ts' | grep -v spec` 实测 10 处，其中 `wallet-recon-run.service.ts:901` 是 `internalSourceType` 业务字段**非审计主体类型，不动**）：push-order.service.ts :242/:250、funds-order-advance-workflow.service.ts :47/:50、internal-transfer-workflow.service.ts :338、deposit-workflow.service.ts :1807、deposit-transactions.service.ts :1316、withdraw-workflow.service.ts :1940、swap-workflow.service.ts :1457。`auditEntityRoutes.ts` 头注释「FUNDS_ORDER 不在常量里」一句连带改掉。
3. **15 孤儿键删除**（实测清单，双形态均零命中）：`SHAREHOLDING_REGISTRY_VERSION`、`APPOINTMENT_RECORD`、`REGULATORY_GATE_ITEM`、`TRAINING_RECORD`、`CONFLICT_DISCLOSURE`、`WIND_DOWN_MATERIAL`、`ONBOARDING`、`PAYIN`、`PAYOUT`、`INTERNAL_FUND`、`AUTH`、`CONFIG`、`LIQUIDITY_CONFIG`、`COA`、`TB_ACCOUNT`。
   - 复现：逐键 `grep -rl "AuditEntityTypes\.<KEY>\b" src --include='*.ts'`（排除常量文件自身）与 `grep -rE "(subjectType|primarySubjectType|SubjectType)\s*[:=]+\s*'<KEY>'" src admin-web/src scripts` 均 0。
   - 执行时按零引用纪律当场重扫（含 admin-web / client-web / scripts / test 全仓字面量），再动手；
   - ⚠️ `ONBOARDING` / `CONFIG` 等键名与 `AuditWorkflowTypes` 同名成员并存——删的是 `AuditEntityTypes` 的键，勿误伤 WorkflowTypes / actionDomain 字符串。

## 7. 文档收口 + 词表最全版（判据 6）

1. **词表导出脚本入库**：`scripts/` 下没有 catalog 生成器（实测；2026-09-15 那份 lark 导出自称「程序化导出」但脚本没留下）。本波新建 `scripts/export-audit-vocab.ts`：从 `audit-actions.constant.ts` 的 8 份名册程序化生成按域 × 按工作流的 markdown（含旅程 S/I/N、必填字段、异步列、退役附录，格式对齐 9-15 版），输出 `doc-final/lark/2026-09-16-audit-actions-catalog-full.md` 交业主。脚本入库后「重跑」才成立；9-15 旧版不动（lark/ 业主维护，新旧并排由业主取舍）。
2. **数字收口**（以执行时重扫为准，总纲给的期望值括注）：`modules/v1-governance.md` §5/§6（101→102、97→113、7/101 分母连动）；`audit-actions.constant.ts` 三块头注释（31/25/18 → 47/33/26）；`demo/script.md:217` 兑换 22→26。
3. **第七幕剧本升级深链版**（`script.md:214` 五步走查）：① 充值单详情页点「View audit trail」直达全链（不再抄单号）；② 客户详情页深链看 Carol 全轨迹；④ actorNo 查内审账号（不变）；⑤ 提现单详情页深链，一屏见提现链 + 大额审批单（不再手输关联单号）——**全程零抄号切页**，判据 3 的验收动作即照此走查 + ⑤ 截图。
4. `demo/data.md` 若涉审计页描述连带核一遍（预计零改动，收尾时确认）。

## 8. 测试与闸

- **①②③ tsc**：后端 + 管理台 + 客户端三闸照常（客户端本波零改动，跑闸兜底）。
- **④ jest**：`src/modules/audit-logging`（§1 三改的行为化用例）+ `src/modules/funds-orders`（include 摘除后既有用例过）；admin-web 无组件单测能力（.spec.tsx 静默不跑，判例在案），前端全靠 ⑤。
- **⑤ preview 截图**（改了前端，必过）：审计列表新筛选栏 + URL 深链预填、详情页 Related Subjects / 旅程 / 人话标签、六页深链按钮各一张、资金单新审计栏、View journey 落地页。
- **⑥ `bash scripts/on-stack.sh self demo:all`** 走通断言终态；随后按判据 3 走查（§7.3 深链版五步）全程截图。
- 不动钱 → ⑦ 不触；不动 schema / seed → ⑧ 不触。`verify:audit` 判据不动（§1.3 已论证不经 findAll；若 plan 复核发现受影响，按波二骨架的 runbook 走：reset → up → demo:all → 人工 API 走查补治理域事件 → 复跑全绿）。

## 9. 收尾（对照 `rules/delivery-checklist.md`，不重抄）

- **BACKLOG 销账**：§H correlationId 条、跳转映射条、InternalFundAuditLog 条、小账条（含 DTO keyword 注释、FUNDS_ORDER 字面量）、Audit No 假承诺条、Related Subjects 观察条（波二 Task 10 登记）；§K ⑥⑦ 审计子集。总纲「销账清单」逐条对号。
- **战役收官**（本波是末波）：总纲六条战役判据逐条验收记录；总纲状态行回写「三波全收官」；各波 spec / plan 移 `archive/`（总纲活到最后随本波一起归档）；CHANGELOG 一行；词表最全版交业主。
- 合 main 后重启后端 +（若 RBAC catalog 有变——本波预计**无**新端点，深链全走既有权限）`db:base:sync` 照惯例跑一遍不亏。

---

## 承接上一波（波二，2026-09-16 收官）——原骨架记录保留

**实际偏差**：
- 清册计数两次订正后终值 = 存量 48 处 34 码（+§3 两新打点，现况 50 处带 subjects）：一漏——`admin-password-reset-workflow.service.ts:105` 的 `recordConsumeOutcome` 写点 `action` 是运行时变量（`OFFICER_APPLIED`/`SELF_COMPLETED` 二选一），字面 `grep "action: '"` 逃了这一处（假阴性，实现者逮回）；一多——mfa-binding `:657` 的 where 查询字面量被同一把 grep 误计为调用（假阳性，终审逮回，曾误记 49）。**同一把字面 grep 一漏一多两种形态都要防**：清点写点以 `grep -c "recordByActor(\|recordSystem("` 的调用形态为准，别数 action 字面量
- `admin-invite-workflow.service.ts:138` 一带的 SoD 硬互斥分支：`approvalCase` 变量在该分支恒为 `null`（异常发生在 `approvalsService.createAndSubmit` 之前），故该分支写审计时只传 `inviteSubjects(user.userNo)` 单参、不传凭据行（无 approvalNo 可镜像）——不是漏写，是这条路径结构性没有凭据可传，波三如果扩展该文件不要误判为遗漏
- `audit-evidence-export-workflow.service.ts` 的 `DOWNLOADED` 码处：`approvalCaseNo` 在当前作用域顶层变量里已经在手（评审逮回的判例，见 Task 6 review）——提醒波三补跳转映射时，凡涉及"审批单号是否在手"的判断，先看顶层变量再决定要不要新查询

**执行中发现的新事实（波三可直接用）**：
1. **`SUBJECTS_COVERED_ACTIONS`（47 码）已 export**（`src/modules/audit-logging/constants/audit-actions.constant.ts`，紧邻 `DEPRECATED_AUDIT_ACTIONS` 之后），`scripts/verify-audit.ts` 已 import 消费——按域浏览筛选栏或跳转映射表按码族分组时，这份名册是现成的按码清单来源，不必重新枚举
2. **`MIN_EXERCISED_ROSTER_ACTIONS` 阈值 N=2 及其环境原因**：`demo:all` 全系脚本都是交易域路径，47 码名册里只有 2 个横切审批码（`APPROVAL_SUBMITTED`/`APPROVAL_GRANTED`）会被交易域场景带到；45 个治理域码纯 `demo:all` 摸不到，阈值钉在实测上限 2，非放水（BACKLOG §H「治理域 demo 脚本缺位」条详述）
3. **判据 5（`verify:audit` 全绿含 Q5）的 runbook 固定为**：`stack.sh reset self` → `stack.sh up self` → `on-stack self demo:all` → 人工 API 走查补齐治理域事件 → 复跑 `verify:audit` 全绿。这是本闸此后的标准复现步骤——波三如果继续动 `verify:audit` 判据，验证要按这个 runbook 走，不能只跑纯 `demo:all` 就下结论
4. **`new XxxService(...)` 直接构造调用是"零引用 grep"预检的第三种假阴性形态**（继波一 `findEvidencePackage` 隐藏调用点判例之后）：删/改任何服务的方法签名或构造函数，零引用预检除了 grep 方法调用和 HTTP 路由，还要加一条 `grep "new <ServiceName>("`
5. **`verify:audit` 的变异测试标准手法**：对 self 栈 `dev.db` **副本**（不动原库）执行一次目标性破坏性 SQL，`DATABASE_URL` 指向副本重跑脚本验证转红，再对原库重跑一次验证仍绿——红绿双证；副本操作后立即删除。波三升级任何 `verify:*` 判据时可复用同一手法自证"闸能咬人"

**已定事实**：波三范围照总纲原样（本 spec §0-§7 即其展开）；波三是本战役收尾波，判据 3 + 判据 6 落在这一波。

**骨架待定岔口的处置**：「Related Subjects 展示区」业主 2026-09-16 拍板收进（§3.2）；其余无岔口。
