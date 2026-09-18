# 第二幕客户域 · 波一「清地基」spec

- 日期：2026-09-06 ｜ 总纲：`2026-09-06-act2-customer-waves-outline.md` ｜ 体检底稿：`superpowers/checkups/2026-09-06-v2-customer-domain.md`（证据与复现命令都在那里，本文不重抄）
- 性质：多波之波一，纯清扫 + 小修，不建任何新流程。业主裁定见总纲「跨波口径」，本文直接引用不重议

## 本波做 / 不做

**做**：删空转字段、退役 material-refresh、清死码、VIP 解绑、修前端死读与 UUID 展示、补客户详情 → 交易跳转、终拒文字展示、文档收口。
**不做**（对照 §2 与总纲）：入驻流程、档位升级、销户清退、任何新状态机 / 新审计码 / 新审批线；不动能力门、限制账、材料请求主线（体检绿区）；技术兜底一律不碰（PRODUCTION-NOTES 已记两条，禁读它找活）。

## 执行纪律（先于任务）

1. **退役前现场逐键 grep**（判例 2026-09-02：体检快照会过期，且并行会话在 main 上高频推进）——每个删除项动手前重跑零引用验证，两种搜法（符号名 + 文件路径），命中了先停下判读，不硬删
2. 一会话 = 一 worktree = 一分支（§10）；合并后重启 + `db:base:sync` + `stack.sh reset main`（动了 schema/seed/rbac.catalog）
3. 任务收尾对照 `rules/delivery-checklist.md`，不重抄

## 任务分解

### T1 · CustomerMain 删 24 字段（48 → 24）

删：`riskLevel`、`investorTier`、`investorTierUpdatedAt`（双胞胎死半边）｜`latestRiskApprovalId`、`latestRiskApprovalStatus`、`latestRiskAssessmentId`、`nextReviewAt`（旧风评指针；连带删 relation `latestRiskApproval` 及 ApprovalCase 侧反向关系）｜`verificationSubstatus`、`verificationCustomerActionRequired`、`verificationCanContinue`、`verificationLatestEventType`、`verificationLatestEventAt`、`sumsubLatestReviewId`、`sumsubLatestAttemptId`、`sumsubExperiencedLevel2`（Sumsub 事件回声，波二按新 spec 需要再加）｜`pepStatus`、`pepConfirmedAt`（PEP 的演示表达 = 静默便签 + eddRequired）｜`emailVerifiedAt`、`phoneVerifiedAt`、`locale`、`timezone`、`lastLoginIp`、`termsAcceptedAt`（讲不到）｜`cddDocumentExpiresAt`（材料到期归材料账按份管）。

留 24 个，个个有主：身份 8（id/customerNo/customerType/email/phone/firstName/lastName/companyName）+ 认证 5（passwordHash/passwordUpdatedAt/failedLoginCount/lockedUntil/lastLoginAt）+ 轴 3（lifecycle/onboardingApprovedAt/hardLineDispositionedAt）+ 业务 4（tradingTier/riskRating/riskRatingUpdatedAt/eddRequired）+ Sumsub 接线对 2（sumsubApplicantId/sumsubCurrentLevelName，波二绑定）+ 时间戳 2。

迁移照常新增（内容不必兼容已有行，§3）；改完走 reset 重铺闸⑧。后端凡 select/透传这些列的位置同步清（`customers.service.ts` 的裸 `findUnique/findMany` 不加 select——那属输入输出防御收口，禁做清单；列删了自然不再出现）。

### T2 · material-refresh 子系统退役

- 后端：`src/modules/identity/material-refresh/` 整目录（service/cron/listener/policy/admin controller，~1741 行含 spec）；`app.module.ts` 摘 `MaterialRefreshModule`
- schema：`CustomerMaterialHolding`、`MaterialRefreshCycle` 两表及 CustomerMain 侧 relations（两张表的死列 `sumsubDocId`/`sumsubIdDocSetType` 随表走）；MaterialRequest 若有指向 cycle 的引用执行时核验处置
- 权限目录：`rbac.catalog.ts` 6 条路由（cycles×2 / holdings×2 / simulate-stage / simulate-tier-change）
- 审计词表：`CUSTOMER_TIER_CHANGE_SIMULATED` 退役（V2 码 15 → 14；唯一写入方随 controller 死）
- admin-web：`MaterialManagementPage` / `MaterialHoldingDetailPage` / `RefreshCyclesPage` / `RefreshCycleDetailPage` 四页 + `App.tsx` 路由 + 侧栏入口 + `CustomerDetail.tsx` 的 Material Holdings 卡片与「View All →」死链（riskTier 恒空 3 处、complianceStatus 2 处随删页自愈）
- 连带口径（写进文档，不是本波要修的活）：`riskRating` 唯一逻辑读取随巡查死，降级为种子展示字段，波二 EDD/入驻重新消费；⚡模拟档位按钮死，波三真流程取代

### T3 · 死码清扫（体检轴③清单，全部已主会话复现零引用）

`customer-lifecycle.util.ts` + 其 spec（~291 行；**`constants/customer-lifecycle.constant.ts` 保留**——波二状态机地基）｜`review-response-compat.util.ts`｜`CustomerAccessService.assertOffboardable`（连带解掉 `customers.module.ts` 仅为它存在的 TigerBeetleModule / FundsOrdersModule 两个 import，注释自证 :20-22）｜`MATERIAL_REQUEST_TERMINAL`｜`ALL_CAPABILITIES` 去 export（文件内自用）｜`isDerivedTag` / `staticTagCodes`。

### T4 · VIP 解绑（总纲裁定落地）

- `customer-tag.constant.ts`：VIP `DERIVED` → `STATIC`；`customer-tag.service.ts effectiveTags()` 删 tradingTier→VIP 派生（NEW_CUSTOMER 派生逻辑**原样保留**，恒空到波二接线，不算缺陷）
- `CustomerExplicitTag.assignedByUserId` 列删——贴/撤已有 `recordByActor` 审计双留痕（2026-09-06 已验，`customer-tag.service.ts:51,81`），列是重复记录
- 种子：Grace 手打 explicit VIP 标签（`seed.business.ts`；她的 PREMIUM 只管限额）；`demo/data.md` Grace 行口径同步「VIP=手打标签」

### T5 · 前端死读与 UUID 修复

- `admin-web/src/components/L1GateCard.tsx` 删 `complianceStatus` 死读（共享组件，三张交易详情页一处修同愈）；`depositActionMap.spec.ts` 同步；BACKLOG:109 六处全清（2 处随 T2 删页、RiskAssessmentDetailPage 已不存在——2026-09-06 已验 find 零命中，销账时注明）
- client-web `/profile`「Member identifier」改展示 `customerNo`（铁律⑥）；后端 `customer-profile.controller.ts` select 的 `id` 换 `customerNo`（tipping-off 契约测试只扫 blocked/openCount，不受影响）
- `CustomerDetail.tsx` 僵尸展示区随 T1 字段删除撤（verification 卡、Next Review×2、investorTier 等 12 个展示位）；client `useCustomerProfile.ts` 的 `nextReviewAt` 同步

### T6 · 客户详情 → 三域交易跳转

`CustomerDetail.tsx` 加三个入口：充值 / 提现 / 兑换列表按此客户过滤（参数用 `customerNo`，铁律⑥）。执行时核验三张列表页是否支持从 URL 参数初始化客户筛选，不支持则补（列表页已有按客户过滤能力，只差入口）。第二幕③「贴签看联动」自此可一路点过去。

### T7 · 终拒文字展示

`CustomerDetail.tsx` 顶部状态区：客户存在终态 REJECTED 的材料请求时显示「尽调未完成 · 待离场处理」。数据源是已有的材料请求列表接口，不新增后端。只做管理台，客户端不加（客户看到的是自己的明示受限，够了）。

### T8 · 文档收口

- `modules/v2-customer-compliance.md`：§0 范围行（「开户流程不演」口径撤，改指总纲）；§2 删材料时效行；§5 修死引用（resolveCustomerCanonicalState）、nextLifecycle 口径改「状态表在册，驱动待波二」、15→14 码、删材料时效/cron 两行；§6 缺口表重排（cron 失配条销、终拒→离场条新记指 BACKLOG）
- `BACKLOG.md`：:99 重写引总纲（入驻要演）；:101 销（latestRiskApprovalId 已删，由波二承接）；:103 重写指波三（「后端全建」前提已亡）；:105 重写（ubo_profiles 表已 DROP 的现状口径）；:111 销（病人没了）；新记「材料终拒 → 离场清退流程」并与 :107 销户缺口并链
- `decisions.md` 五条 2026-09-06 裁定（本 spec 立案当日已录，执行时核对在场）
- `CHANGELOG.md` 合并时一行

## 验收口径

1. schema：CustomerMain 恰 24 个标量字段；抽查每个留存字段能指出写入方或「种子铺设 + 展示位」
2. 退役零引用：spec 附录清单执行末尾统一逐键 grep 一遍（两种搜法），全空
3. 闸门：①②③④ + ⑤前端截图 + ⑥`demo:all` 终态断言 + ⑧reset 重铺（动 schema/seed）+ `verify:rbac`（catalog 减 6 路由）+ `verify:audit`（词表减 1 码，执行时跑通核对判据）
4. 走查四景截图：CustomerDetail 无恒空区｜三跳转点到对应过滤列表｜把 Bob 的 EMIRATES_ID 材料请求打到终拒后文字出现｜Grace 标签区显手打 VIP、client `/profile` 显 customerNo
5. 合并后：重启 + `db:base:sync` + `stack.sh reset main`；承接记录写入波二骨架，本 spec 归档
