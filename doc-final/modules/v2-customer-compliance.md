# V2 · 客户与合规（开户 / 生命周期 / 限制 / 持续尽调）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-09-26（战役甲波三：制裁定性裁决三出口联动限制账与报送台、限制因由扩至 8 条、⚡ EOCN 存量客户命中入口，见 §1/§3/§5；此前 2026-09-08 第二幕客户域波三「档位升级」后逐段核对）
> 演示幕次：第二幕「迎客」 ｜ 验收：第二幕走查（`demo/script.md`）+ 本篇 §4
> 范围：仅个人客户；机构客户显式禁用（`CorporateProfile`/`UboProfile` 表已随站6拆除，customerType 仍可选 CORPORATE 但零配套数据模型，入口禁用）。

## 0. 一句话定位

管**客户是谁、能不能干事**：开户准入（Sumsub 尽调 + 高管准入核准，**已接（波二 2026-09-07）**，归档见 `superpowers/specs/2026-09-07-act2-wave2-onboarding-design.md`）、客户关系生命周期、限制管控（冻结/解冻）、持续尽调（材料请求 + 便签；定期风评 CRA / 材料时效巡查 2026-09-06 业主拍板永久不做）。V4–V6 每一笔交易动手前，都要先过这里的**能力门**。

## 1. 业务叙事

最重要的一件事：**"客户关系"和"能不能干事"是两根轴，分开管。** 关系轴（lifecycle）记录这个人和我们走到了哪一步——申请中、已开户、已离场；限制账（restrictions）记录他此刻被摁住了什么。制裁命中的客户关系仍是"已开户"——变的不是关系，是能力。这一分离是整个模块的地基。

**开户之路。** 两条路径，岔口在 Sumsub 给出的裁决。**CDD 直通**（低风险）：注册 → 发起认证（Sumsub mock 建 applicant）→ 填 CDD 五字段表单 → 裁决 GREEN → 当场 ACTIVE，全程零我方人工。**EDD 换档**（高风险）：CDD 提交后 Sumsub 把档位升到 EDD → 补交 SoF/SoW → 裁决 GREEN（**MLRO 的尽调在 Sumsub 内完成**，不进我方管理台）→ 转我方**准入核准**——运营提单、**高管**单步批，批的是"接不接这个高风险客户关系"、不是重审尽调 → ACTIVE。裁决 RED 分两档：可重试（能重新申请）与终拒（`onboardingFinalRejectedAt` 落值，堵死重申）；高管拒收同样可重申，只有尽调终拒才封死。主动撤回也可重新申请；已开户的客户不会"退回申请中"——要么被限制账摁住，要么走离场终态。**材料零存储规矩**：凡经 Sumsub 采集的材料（含 EDD 的 SoF/SoW），我方一个字节不落、连名录不记，真身在 Sumsub、我方只认 webhook 结果；CDD 五字段是唯一例外——那是客户主数据，落在我方主表。

**升档之路（波三 2026-09-08）。** 开户只是起点，档位（`tradingTier`）决定限额门放多宽。BASIC 客户在 Swap/Withdraw 撞限额（`ABOVE_MAX`/`CUMULATIVE_EXCEEDED`）时，页内提示条带一条「Upgrade your tier」链接——客户主动点，跳 Profile 档位卡片「申请升级」。**申请即换档**：Sumsub 侧 `sumsubCurrentLevelName` 当场写成 PREMIUM 档（我方主动动作，与 EDD 换档方向相反），同时开一张独立主体「升级申请单」（`IN_REVIEW`）。客户端补料会话页收两份材料——地址证明（PoA）、资金来源（SoF）——**材料零存储**，一个字节不落、连名录不记，真身在 Sumsub；提交只落一个时间戳 `materialsSubmittedAt`。GREEN 裁决落 `MATERIALS_CLEARED`；运营在客户详情提「档位升级准入」（语法沿用 EDD 入驻准入），高管单步批——批的是接不接更大的资金敞口，不是重审材料（材料裁决 100% 在 Sumsub，MLRO 不进这条线）。批准的瞬间，同一事务里申请单沿边 `APPROVED` + `tradingTier` 从 `BASIC` 翻 `PREMIUM`；限额门（`TransactionLimitGateService`）每次建单都是实时读这一列，翻转即刻生效，客户回头重试刚才被拒的那笔单当场就能通过。RED 分两档：可重试（打回补料、会话原地重开，不迁移状态）与终拒（`REJECTED`）；被拒随时可重新申请，无次数/冷却限制（单人顺序演示裁定，与入驻重申同款）。**升档全程不碰客户 lifecycle**——客户从申请到批准始终 `ACTIVE`，与开户 EDD 终拒「关系被拒待离场」的后果不同；也不做降级（迁移表只此一条边，材料时效巡查等触发器均已裁掉，合规恶化改走限制便签）。

**便签机制（限制账的白话名）。** 摁住一个客户 = 给他贴一张便签。便签的三个属性——**摁住哪些能力、客户自己看不看得见、谁有权撕**——不由操作员填写，由"原因"查表决定：制裁命中 → 静默便签（客户无感）、只有 MLRO 能撕；材料过期 → 明示便签（客户看得见提示）、运营能撕。**贴不用批、撕必须批**：贴是保护动作，制裁 24 小时上报窗口等不起审批，立即生效；撕是解除保护，必须过审批门。同一客户可以同时挂多张便签，各撕各的、互不牵连。

**制裁定性裁决（战役甲波三 2026-09-26 新增）。** 制裁命中只是"待裁"——命中当下先贴一张 SILENT 便签（保护动作，立即生效，不用批），随后走一道独立的裁决审批（`SANCTION_DISPOSITION`，合规官提、MLRO 单步批）判定排除 / 部分命中 / 确认命中三选一：**排除**直接撕签、客户全程无感；**部分命中**维持静默、联动开一张 PNMR 报送单 + 一份中性补料请求；**确认命中**把 SILENT 便签换成一张新的**明示**便签（限制因由从 7 条扩到 8 条，新增 `SANCTION_CONFIRMED`——首次出现横幅、客户能看到依据），联动开一张 CNMR 报送单。二次定性（部分命中后据后续指令再定）仍锚首次命中时刻，不因裁决拖延而顺延钟——审批与报送两个主体各写各的（铁律③），完整机制、报送单钟锚、审批快照人话见 `modules/v9-regulatory-filing.md` §4.1。

**全域联动。** 贴一张"全能力"便签的瞬间：他名下所有在途充值、提现单立即冻结，兑换单拦住推进——先冻人，单只是载体。

**持续尽调。** 材料账（material-requests）按需下发——Sumsub 推送 / 运营手发，客户端出现补料入口，提交后审核通过自动松绑；**材料账与限制账互补**——限制账说"你现在不能做什么"，材料账说"交什么材料才能松开"。

> **站6（2026-08-27，业主方案2）→ 2026-09-06 总纲推翻 → 波二（2026-09-07）入驻重建落地 → 波三（2026-09-08）档位升级落地**：一期的入驻流程 / 定期风评（CRA）/ 高风险升级案曾于站6 整体拆除；业主 2026-09-06 拍板推翻"开户流程不演"口径，按总纲 `superpowers/specs/2026-09-06-act2-customer-waves-outline.md` 分波二（入驻重建）/ 波三（档位升级）接回，两波均已合并。波二（归档 `superpowers/specs/2026-09-07-act2-wave2-onboarding-design.md`）：开户流程见 §1/§2，驱动经 `CustomerLifecycleService.applyAction` 唯一写入口接上；定期风评 / 高风险升级案仍不演（CRA 业主拍板永久不做，见 §0）。波三（`superpowers/specs/2026-09-07-act2-wave3-tier-upgrade-design.md`）：升档之路见本节新增段，申请单状态机见 §2，审批准入行见 §3。

## 2. 状态机

| 主体 | 状态流 |
|---|---|
| 关系轴 lifecycle | `PROSPECT → IN_VERIFICATION → PENDING_APPROVAL → ACTIVE`；低风险直通边 `CDD_CLEARED`（IN_VERIFICATION → ACTIVE，跳过 PENDING_APPROVAL）；旁支 `REJECTED / WITHDRAWN`（可重新申请）；终态 `OFFBOARDED`。9 动作 10 边，`nextLifecycle()` 唯一入口。**不变量：不存在 ACTIVE 回头边**——已开户只能离场或被便签摁住 |
| 限制账（便签） | `OPEN → RELEASED`（撕签经审批；同便签多能力多行、按便签号整撕） |
| 材料请求 | `PENDING_SUBMISSION → SUBMITTED → APPROVED / REJECTED / CANCELLED`（被打回 RETRY 回到待提交，FINAL 拒绝进终态） |

**升级申请单**（`tier_upgrade_applications`，波三 2026-09-08 新增，独立主体，与关系轴解耦）——4 态 4 边显式迁移表：

| 边 | 触发 |
|---|---|
| IN_REVIEW → MATERIALS_CLEARED | GREEN 裁决 |
| IN_REVIEW → REJECTED | RED-FINAL 裁决 |
| MATERIALS_CLEARED → APPROVED | 高管批 |
| MATERIALS_CLEARED → REJECTED | 高管否 |

RED-RETRY 不算边——停留 `IN_REVIEW`，清 `materialsSubmittedAt` 重开补料会话（照 EDD 换档清 `onboardingSubmittedAt` 先例）。「审批中」不是状态，从关联审批单推导展示（波二教义延伸）。**升档全程不碰上表的客户 lifecycle**：客户从申请到批准（或被拒）始终 `ACTIVE`，不迁移关系轴的任何一格。

## 3. 决策点与角色

| 动作 | 谁发起 | 谁裁决 | 要点 |
|---|---|---|---|
| 贴便签（冻结） | 合规 / 系统（材料请求下发按因由自动贴、交易域制裁命中自动贴） | **无审批，立即生效** | 保护动作等不起；理由与痕迹全留 |
| 撕便签（解冻） | 运营发起 | 按原因分流：制裁/硬拒 → **MLRO**；其余 → **运营主管** | MLRO 类必须关联依据单据，缺了直接拒 |
| 材料请求下发 | Sumsub 推送 / 运营手发 | — | 一次下发一行账，打回可重交 |
| 提请准入核准 | 运营 | 高管（单步） | 审的是接不接客户关系，不是重审尽调 |
| 提请档位升级准入（波三 2026-09-08） | 运营 | 高管（单步，48h 超时） | 审的是接不接更大的资金敞口，不是重审材料（材料裁决 100% 在 Sumsub） |
| 制裁定性裁决（战役甲波三 2026-09-26） | 合规官 | MLRO（单步，48h 超时） | 三选一出口（排除/部分/确认）落地联动限制账与报送台；不等价于撕签——只有 CLEARED 出口才解除限制 |

## 4. 演示脚本（第二幕 · 迎客）

1. **静态矩阵**：9 位种子客户的状态矩阵一屏看全（谁在申请、谁被摁住、谁高风险——见 demo/data.md）
2. **现场开户 · CDD 直通**（本幕新高光）：现场注册新客户 → 发起认证 → 填 CDD 五字段表单 → ⚡ 裁决 GREEN → 当场 ACTIVE、新客标签亮、登记法币账户即时解交易起始门 → 管理台看 NEWCUST 费率档 Audience，对照客户端 Alice（STD）/Grace（VIP）报价见新客档介于两者之间（比 STD 便宜、比 VIP 贵；此刻零余额、Swap「You Sell」被余额钳制看不到完整预览——第 5 拍现场入金回来再看，就是这份预览的完整版，现场自见）；旁支 RED-RETRY：同一 applicant 续走重申
3. **现场开户 · EDD 高风险**：现场注册新客户 → CDD 提交 → ⚡ 升 EDD 档 → 传 SoF/SoW（零存储）→ ⚡ 裁决 GREEN（MLRO 的尽调在 Sumsub 内完成）→ 运营提"准入核准" → 高管单步批 → ACTIVE——批的是接不接客户关系，不是重审尽调
4. **便签联动**：Carol 静默 vs Ivy 明示对照（管理台看得到 Carol 的制裁便签，切客户端登录一切如常；Ivy 客户端明确显示受限提示）→ 给 Bob 贴"全能力"便签看三域在途单当场联动 → 撕签走门（Bob 走运营主管、Carol 制裁类只有 MLRO 能撕且要附依据）→ 材料请求补料闭环（手发一张 → 客户端补料入口 → 提交 → 审核通过自动松绑）
5. **档位升级**（波三 2026-09-08，承接②那位现场客户）：客户端现场充值到账 → Swap 卖出撞 `CUMULATIVE_EXCEEDED` → 页内红框提示条「Upgrade your tier」链接 → Profile 档位卡片（两档限额对照表）→ 申请升级建单 → 补料页 PoA/SoF 两个上传位提交 → `compliance_lead@` ⚡ 裁决 GREEN → `MATERIALS_CLEARED` → 运营提「档位升级准入」→ 高管单步批 → `tradingTier` 翻 `PREMIUM` → 回客户端重试同一笔兑换，当场通过（限额门实时读档位）；旁支 RED-RETRY：打回补料、会话原地重开。完整逐步走查见 `demo/script.md` 第二幕⑤，不在此重复抄录

演示口径：机构客户入口仍是禁用的（讲"当前版本只服务个人客户"）；定期风评（CRA）/ 高风险升级案不演（业主拍板永久不做，见 §0）。

## 5. 关键技术节点（≤30 行）

- 关系轴 `identity/customers/customer-lifecycle.service.ts → applyAction()`（**驱动已接（波二 2026-09-07）**，唯一写入口；套 `identity/constants/customer-lifecycle.constant.ts → nextLifecycle()`，9 动作 10 边，非法边显式抛；新增低风险直通边 `CDD_CLEARED`）
- 入驻编排 `identity/onboarding/onboarding-workflow.service.ts`（发起认证 / CDD·EDD 提交 / 裁决落轴 / 撤回 / 重申，`REAPPLY` 被 `onboardingFinalRejectedAt` 堵死）；client 五端点 `onboarding.client.controller.ts → /client/me/onboarding/{start,session,submit,withdraw,reapply}`；admin 提单 `onboarding.admin.controller.ts → POST /admin/customers/:customerNo/onboarding-acceptance`（策略 `CUSTOMER_ONBOARDING_ACCEPTANCE`，单步高管批，`onboarding-acceptance-approval.service.ts` 落轴 FINAL_APPROVED/FINAL_REJECTED）
- 限制账 `identity/customers/`：`customer-restrictions.service.ts`（实体不变量：幂等键 customerId×cause×caseRef）｜ `customer-restriction-workflow.service.ts → openRestriction()/initiateRelease()/onReleaseDecided()`（贴即生效；撕按 releasePolicy 分流两条审批门）｜ 原因注册表 `constants/restriction-cause.constant.ts → RESTRICTION_CAUSE_POLICY`（范围/可见性/解除路径查表，人工不可填；**8 条因由**，战役甲波三新增 `SANCTION_CONFIRMED` DISCLOSED/customerLevel=true）
- 制裁定性裁决 `identity/customers/sanction-disposition-workflow.service.ts`（战役甲波三 2026-09-26 新增，`initiateDisposition()`/`onDecided()`；三出口各写各的：CLEARED 直调 `restrictions.release()`、PARTIAL/CONFIRMED 横向调 `RegulatoryFilingService.openForSanction()` 开单——铁律③，不直写报送表）+ `sanction-disposition-approval.service.ts`；审批类型 `SANCTION_DISPOSITION`（`approval.constants.ts`，单步 MLRO，maker 组复用 `CUSTOMER_RESTRICTION_RELEASE`）；⚠️ CONFIRMED 出口的两便签翻牌在一个事务里、CNMR 开单在事务外，非单一事务原子落地，见 `modules/v9-regulatory-filing.md` §4.1「事实订正」
- **能力门（V4–V6 都调）** `customer-access.service.ts → resolve()`：唯一执法依据 = lifecycle 为 ACTIVE + 能力不在被摁清单；**`blocked`（含静默，服务端执法）与 `disclosedBlocked`（仅明示，客户面）分列是 tipping-off 命门**，客户面 DTO 禁止出现前者（契约测试逐文件扫描守着）；并入交易起始门（须有 ACTIVE 法币提现地址）
- 材料账 `material-requests/`（一行=一次下发；`externalActionId` 全表唯一、绝不下发客户面）；状态变更唯一入口 `nextMaterialRequestStatus()`（非法边显式抛）
- 客户端资料投影 `customers/customer-profile.controller.ts → GET /onboarding/me`（站6 自一期迁入，URL 保持不动；tipping-off 红线：响应只许 lifecycle/disclosedBlocked/disclosed）
- 留痕（V2_CUSTOMER_AUDIT_ACTIONS **14 → 22 → 28 → 26 → 29 码**——28 码基数含 `CUSTOMER_UPDATED`/`CUSTOMER_DELETED` 两码，2026-09-15 随管理台裸建/改/删客户三端点下线而退役，主档剩 `CUSTOMER_CREATED` 一码、总数落到 26；**制裁定性裁决（3，战役甲波三 2026-09-26）**——`SANCTION_DISPOSITION_REQUESTED`/`DECIDED`/`LANDED`，均带 `approvalNo`，26→29）：主档 1 / 便签 4 / 材料请求 7 / 入驻族 8 / 档位升级族 6（波三：发起+换档 `TIER_UPGRADE_APPLIED` / 提交 `SUBMITTED` / 裁决落轴 `VERDICT_APPLIED` / 运营提单 `ACCEPTANCE_SUBMITTED` / 高管裁决 `ACCEPTANCE_DECIDED` + 账本开户 `CUSTOMER_LEDGER_PROVISIONED`，均带 `fromStatus`/`toStatus`）/ 制裁定性裁决 3；全部落子表行——按单据查/按客户查自此对身份域成立
- Sumsub 翻译层 `sumsub-ingestion/sumsub-ingestion.service.ts → ingest()/dispatch()`（webhook 统一入口；路由面现三路 = 三域 KYT 级联 + 材料请求裁决 + 申请人级入驻路由，材料刷新监控随波一退役，未命中三路的事件落 `unrouted_*` 警告；**`applicantReviewed` 波三起再分两线**——先问该客户有无在审升级申请单，有则路由 `tierUpgradeWorkflow.applyReviewVerdict`，无则落回入驻既有路径，入驻的 `IN_VERIFICATION` 守卫原样不动，`applicantLevelChanged` 不受影响）；⚡ 模拟端点 `admin-sumsub-simulation.controller.ts → POST onboarding-review-result|onboarding-level-change|tier-upgrade-review-result|eocn-sanctions-hit`（战役甲波三新增第四条：EOCN 名单更新命中存量 ACTIVE 客户，直调 `CustomerRestrictionWorkflowService.openRestriction()` 贴 `SANCTION` 便签，不经 `ingest()`——不是 Sumsub webhook 翻译，权限挂 `DEMO_VERDICT_WRITE`）
- 档位升级模块 `identity/tier-upgrade/`（与 onboarding 平级）：`tier-upgrade-workflow.service.ts`（状态机 + `apply/getOverview/getSession/submitMaterials/submitAcceptance/onAcceptanceDecided`）+ `tier-upgrade-approval.service.ts`（16 行 handler，接 `workflow.customer-tier-upgrade.decided`）+ `tier-upgrade.client.controller.ts → /client/me/tier-upgrade/{apply,'',session,submit}` + `tier-upgrade.admin.controller.ts → POST/GET /admin/customers/:customerNo/tier-upgrade{-acceptance,}`；新表 `tier_upgrade_applications`（`tier-upgrade.constant.ts → assertTierUpgradeTransition()`，非法边显式抛）
- `tradingTier` 改写收口于裁决处理器 `onAcceptanceDecided`（同事务：申请单终态 + `customers.service.ts → applyTierUpgrade()`——非 BASIC 显式拒 + 审计 before/after 带 `fromStatus`/`toStatus`）——业务动作只此一条路；**措辞留白**：既有泛化端点 `PATCH /admin/customers/:customerNo` 收裸 `Prisma.CustomerMainUpdateInput`，理论上仍可绕过审批直写该列，属既有已在案的绕行口（`PRODUCTION-NOTES.md:524`，管理员善意假设下不算演示缺口）
- TB 客户账本户运行时开户钩子（BACKLOG :159 ⭐ 销账，见 §6）：`onboarding-workflow.service.ts → provisionLedgerIfFirstActive()`，挂在 `applyReviewVerdict` 的 CDD_CLEARED 分支与 `onAcceptanceDecided` 的 FINAL_APPROVED 分支，以 `onboardingApprovedAt` 是否为 null 判首次进 ACTIVE；调 `accounting/tigerbeetle/customer-ledger-provisioning.service.ts` 按 ACTIVE 资产 × [CLIENT_PAYABLE, DEPOSIT_SUSPENSE] 建账，TB 不可达当场抛错（不吞）；审计 `CUSTOMER_LEDGER_PROVISIONED`（`recordSystem`）

## 6. 演示缺口（BACKLOG 有账）

- **制裁客户的订单级折叠未做**：贴签冻单后，管理台没有"这个客户名下全部被冻单"的聚合视图
- **销户只落了轴上位置**：OFFBOARDED 态在，完整销户流程（余额清退等）没做；高管拒收滞留 REJECTED（客户未再重申）的清退承接同归此缺口
- **材料终拒 → 离场清退流程未接**（原「REJECTED 便签长挂无人清理」缺口并入）：材料请求终拒后管理台已展示「尽调未完成 · 待离场处理」，但没有实际的销户清退动作承接，归 BACKLOG 销户缺口一并解决
- **机构客户全线 stub**：`CorporateProfile`/`UboProfile` 表已随站6拆除（非本波动作），customerType 仍可选 CORPORATE 但零配套数据模型，入口禁用
