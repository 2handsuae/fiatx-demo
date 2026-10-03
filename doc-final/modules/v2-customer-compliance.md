# V2 · 客户与合规（开户 / 生命周期 / 限制 / 持续尽调）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-10-03（战役丙波四：新增 §8——资料请求 DSR 工单主体（查 / 改 / 删三型，DPO 独办，30 自然日单钟，上闹钟墙第四类灯）+ 改档案 admin 通道（`PATCH /customers/:customerNo/profile`，填 `CUSTOMER_WRITE` 孤儿桶）+ phone 自助改（`PATCH /client/me/phone`）；`Compliance Office` 域 +1 桶，15 域 82→83 桶、90→92 组；V2 客户册现役码 29→31；见 §8）；此前 2026-10-03（战役丙波三：新增「客户协议」一节 §7——协议版本主体 + 合规官提高管批的发布链 + 通知 + 客户表态 + DEPOSIT/SWAP 能力闸新条件，零新增生命周期边，见 §7）；此前 2026-09-26（战役甲波三：制裁定性裁决三出口联动限制账与报送台、限制因由扩至 8 条、⚡ EOCN 存量客户命中入口，见 §1/§3/§5；此前 2026-09-08 第二幕客户域波三「档位升级」后逐段核对）
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

客户协议（战役丙波三，§7）不在第二幕演——它要把全库客户快进到"新版生效"，会让后续幕的充值/兑换当场被拦，所以单开**第十一幕 · 场景 35**（战役丙波三交付时原为第十幕·场景 33，波四插入新第十幕后顺延）排整场最后、演完重铺，见 `demo/script.md`；注册那一步的条款同意（落库 + 审计）在第二幕「现场开户」自然经过，不另设步骤。

## 5. 关键技术节点（≤30 行）

- 关系轴 `identity/customers/customer-lifecycle.service.ts → applyAction()`（**驱动已接（波二 2026-09-07）**，唯一写入口；套 `identity/constants/customer-lifecycle.constant.ts → nextLifecycle()`，9 动作 10 边，非法边显式抛；新增低风险直通边 `CDD_CLEARED`）
- 入驻编排 `identity/onboarding/onboarding-workflow.service.ts`（发起认证 / CDD·EDD 提交 / 裁决落轴 / 撤回 / 重申，`REAPPLY` 被 `onboardingFinalRejectedAt` 堵死）；client 五端点 `onboarding.client.controller.ts → /client/me/onboarding/{start,session,submit,withdraw,reapply}`；admin 提单 `onboarding.admin.controller.ts → POST /admin/customers/:customerNo/onboarding-acceptance`（策略 `CUSTOMER_ONBOARDING_ACCEPTANCE`，单步高管批，`onboarding-acceptance-approval.service.ts` 落轴 FINAL_APPROVED/FINAL_REJECTED）
- 限制账 `identity/customers/`：`customer-restrictions.service.ts`（实体不变量：幂等键 customerId×cause×caseRef）｜ `customer-restriction-workflow.service.ts → openRestriction()/initiateRelease()/onReleaseDecided()`（贴即生效；撕按 releasePolicy 分流两条审批门）｜ 原因注册表 `constants/restriction-cause.constant.ts → RESTRICTION_CAUSE_POLICY`（范围/可见性/解除路径查表，人工不可填；**8 条因由**，战役甲波三新增 `SANCTION_CONFIRMED` DISCLOSED/customerLevel=true）
- 制裁定性裁决 `identity/customers/sanction-disposition-workflow.service.ts`（战役甲波三 2026-09-26 新增，`initiateDisposition()`/`onDecided()`；三出口各写各的：CLEARED 直调 `restrictions.release()`、PARTIAL/CONFIRMED 横向调 `RegulatoryFilingService.openForSanction()` 开单——铁律③，不直写报送表）+ `sanction-disposition-approval.service.ts`；审批类型 `SANCTION_DISPOSITION`（`approval.constants.ts`，单步 MLRO，maker 组复用 `CUSTOMER_RESTRICTION_RELEASE`）；⚠️ CONFIRMED 出口的两便签翻牌在一个事务里、CNMR 开单在事务外，非单一事务原子落地，见 `modules/v9-regulatory-filing.md` §4.1「事实订正」
- **能力门（V4–V6 都调）** `customer-access.service.ts → resolve()`：唯一执法依据 = lifecycle 为 ACTIVE + 能力不在被摁清单；**`blocked`（含静默，服务端执法）与 `disclosedBlocked`（仅明示，客户面）分列是 tipping-off 命门**，客户面 DTO 禁止出现前者（契约测试逐文件扫描守着）；并入交易起始门（须有 ACTIVE 法币提现地址）
- 材料账 `material-requests/`（一行=一次下发；`externalActionId` 全表唯一、绝不下发客户面）；状态变更唯一入口 `nextMaterialRequestStatus()`（非法边显式抛）
- 客户端资料投影 `customers/customer-profile.controller.ts → GET /onboarding/me`（站6 自一期迁入，URL 保持不动；tipping-off 红线：响应只许 lifecycle/disclosedBlocked/disclosed）
- 留痕（V2_CUSTOMER_AUDIT_ACTIONS **14 → 22 → 28 → 26 → 29 → 31 码**——28 码基数含 `CUSTOMER_UPDATED`/`CUSTOMER_DELETED` 两码，2026-09-15 随管理台裸建/改/删客户三端点下线而退役，主档剩 `CUSTOMER_CREATED` 一码、总数落到 26；**制裁定性裁决（3，战役甲波三 2026-09-26）**——`SANCTION_DISPOSITION_REQUESTED`/`DECIDED`/`LANDED`，均带 `approvalNo`，26→29；**改档案 2（战役丙波四，2026-10-03）**——`CUSTOMER_PROFILE_UPDATED` 运营经 PATCH 通道改档案 / `CUSTOMER_PHONE_UPDATED` 客户自助改 phone，均带 `customerNo`，29→31，见 §8）：主档 1 / 便签 4 / 材料请求 7 / 入驻族 8 / 档位升级族 6（波三：发起+换档 `TIER_UPGRADE_APPLIED` / 提交 `SUBMITTED` / 裁决落轴 `VERDICT_APPLIED` / 运营提单 `ACCEPTANCE_SUBMITTED` / 高管裁决 `ACCEPTANCE_DECIDED` + 账本开户 `CUSTOMER_LEDGER_PROVISIONED`，均带 `fromStatus`/`toStatus`）/ 制裁定性裁决 3；全部落子表行——按单据查/按客户查自此对身份域成立
- Sumsub 翻译层 `sumsub-ingestion/sumsub-ingestion.service.ts → ingest()/dispatch()`（webhook 统一入口；路由面现三路 = 三域 KYT 级联 + 材料请求裁决 + 申请人级入驻路由，材料刷新监控随波一退役，未命中三路的事件落 `unrouted_*` 警告；**`applicantReviewed` 波三起再分两线**——先问该客户有无在审升级申请单，有则路由 `tierUpgradeWorkflow.applyReviewVerdict`，无则落回入驻既有路径，入驻的 `IN_VERIFICATION` 守卫原样不动，`applicantLevelChanged` 不受影响）；⚡ 模拟端点 `admin-sumsub-simulation.controller.ts → POST onboarding-review-result|onboarding-level-change|tier-upgrade-review-result|eocn-sanctions-hit`（战役甲波三新增第四条：EOCN 名单更新命中存量 ACTIVE 客户，直调 `CustomerRestrictionWorkflowService.openRestriction()` 贴 `SANCTION` 便签，不经 `ingest()`——不是 Sumsub webhook 翻译，权限挂 `DEMO_VERDICT_WRITE`）
- 档位升级模块 `identity/tier-upgrade/`（与 onboarding 平级）：`tier-upgrade-workflow.service.ts`（状态机 + `apply/getOverview/getSession/submitMaterials/submitAcceptance/onAcceptanceDecided`）+ `tier-upgrade-approval.service.ts`（16 行 handler，接 `workflow.customer-tier-upgrade.decided`）+ `tier-upgrade.client.controller.ts → /client/me/tier-upgrade/{apply,'',session,submit}` + `tier-upgrade.admin.controller.ts → POST/GET /admin/customers/:customerNo/tier-upgrade{-acceptance,}`；新表 `tier_upgrade_applications`（`tier-upgrade.constant.ts → assertTierUpgradeTransition()`，非法边显式抛）
- `tradingTier` 改写收口于裁决处理器 `onAcceptanceDecided`（同事务：申请单终态 + `customers.service.ts → applyTierUpgrade()`——非 BASIC 显式拒 + 审计 before/after 带 `fromStatus`/`toStatus`）——业务动作只此一条路；**措辞留白**：既有泛化端点 `PATCH /admin/customers/:customerNo` 收裸 `Prisma.CustomerMainUpdateInput`，理论上仍可绕过审批直写该列，属既有已在案的绕行口（`PRODUCTION-NOTES.md:524`，管理员善意假设下不算演示缺口）
- TB 客户账本户运行时开户钩子（BACKLOG :159 ⭐ 销账，见 §6）：`onboarding-workflow.service.ts → provisionLedgerIfFirstActive()`，挂在 `applyReviewVerdict` 的 CDD_CLEARED 分支与 `onAcceptanceDecided` 的 FINAL_APPROVED 分支，以 `onboardingApprovedAt` 是否为 null 判首次进 ACTIVE；调 `accounting/tigerbeetle/customer-ledger-provisioning.service.ts` 按 ACTIVE 资产 × [CLIENT_PAYABLE, DEPOSIT_SUSPENSE] 建账，TB 不可达当场抛错（不吞）；审计 `CUSTOMER_LEDGER_PROVISIONED`（`recordSystem`）

## 6. 演示缺口（BACKLOG 有账）

- **制裁客户的订单级折叠未做**：贴签冻单后，管理台没有"这个客户名下全部被冻单"的聚合视图
- **销户只落了轴上位置**：OFFBOARDED 态在，完整销户流程（余额清退等）没做；高管拒收滞留 REJECTED（客户未再重申）的清退承接同归此缺口
- **材料终拒 → 离场清退流程未接**（原「REJECTED 便签长挂无人清理」缺口并入）：材料请求终拒后管理台已展示「尽调未完成 · 待离场处理」，但没有实际的销户清退动作承接，归 BACKLOG 销户缺口一并解决
- **机构客户全线 stub**：`CorporateProfile`/`UboProfile` 表已随站6拆除（非本波动作），customerType 仍可选 CORPORATE 但零配套数据模型，入口禁用

## 7. 客户协议（战役丙波三，2026-10-03）

> 总纲 `archive/superpowers/specs/2026-09-30-campaign-c-outreach-disclosure-charter.md`（已归档） §1.1/§2 波三行；spec 随合并归档（含执行订正 9 条）。管客户签的条款**有版本可查、变更有人批、客户有得选、选了留痕**。与上文 lifecycle / 限制账**正交**：不新增 lifecycle 边、不贴便签，只是 DEPOSIT / SWAP 两个能力门多一个条件。

**为什么有这一节。** 现行条款末节原承诺"重大变更至少提前 14 天通知"，系统无版本概念、无从兑现，条款同意还是纯前端闸（注册页自认）。2026-10-02 核 VARA Market Conduct Rulebook **II.A.7** 原文：协议任何变更须提前 **30 个日历日**通知客户（同节 II.A.8 保留单方变更权须写明、II.A.9 须保留历次版本、II.A.5/6 提供服务前取得接受并给客户副本）——14 天本身不合规。于是：协议成为**有版本的登记物**，发布走审批，通知期系统强制 ≥ 30 天。

**两表**（迁移 + reset 登记）：

| 表 | 内容 |
|---|---|
| `customer_agreement_versions` | `versionKey` @unique（`v1`/`v2`；**版本非单据，破例不走单号惯例**）+ `status` + `summary`（一句话摘要，通知/弹窗引用，随种子预置、无编辑入口）+ `effectiveAt` + `publishedAt`（= 批准时刻）+ `pendingApprovalNo`。**正文不落库**，住代码登记处 `identity/agreements/agreement-versions.constant.ts`（单一来源：注册页、阅读页、管理台三处同源取接口，客户端零正文硬编码）。v1 = 原七节 + 两处 14→30 天订正，**以订正后文案收录为基线、"不可变"自入库起算**；v2 = v1 + 第 V 节追加一段投诉时限（确认 ≤7 天、裁决 ≤28 天可延一次至 56 天，与投诉双钟逐字对齐）。管理台**不做正文编辑器**（改字 = 改代码 + 新增一版） |
| `customer_agreement_consents` | `customerId` / `customerNo` / `versionKey` / `action`（`ACCEPTED`｜`DECLINED`）/ `actedAt`。**只追加不改写**：同一客户对同一版本可先拒后同意，各一行；判定一律取"该客户对**当前生效版**是否有 ACCEPTED 行" |

**版本状态机**（`DRAFT → PENDING_APPROVAL → PUBLISHED → EFFECTIVE → SUPERSEDED`，**五态五边**，每条边 `updateMany({ where: { versionKey, status: <出发态> } })`，非法跃迁 0 行即显式抛）：

| 边 | 触发 |
|---|---|
| DRAFT → PENDING_APPROVAL | 合规官提交发布（填生效日，预检 ≥ 提交时刻 +30 天） |
| PENDING_APPROVAL → PUBLISHED | 高管单步批准，**批准时刻复核**生效日 ≥ 批准时刻 +30 天；批准即发布即通知 |
| PENDING_APPROVAL → DRAFT | 驳回 / 撤单 / 过期，或批准时 30 天复核不过（记 `AGREEMENT_PUBLISH_REJECTED`，`decision` 带 `NOTICE_PERIOD_SHORTFALL` 与审批裁决原值并列） |
| PUBLISHED → EFFECTIVE | 到点懒翻（读"当前生效版"的路径发现 `effectiveAt<=now` 即翻，actor=system），或 ⚡快进；同事务把旧 EFFECTIVE 翻 SUPERSEDED |
| EFFECTIVE → SUPERSEDED | 随新版进 EFFECTIVE |

同一时刻至多一版在途（PENDING_APPROVAL / PUBLISHED）。

**发布链**（铁律②③）：合规官（`AGREEMENT_WRITE`，**合规官独占**）在管理台 Compliance Office → Customer Agreements 提交 → 审批策略 `AGREEMENT_PUBLISH`（高管单步、48h 超时可撤，照 `RI_REPLACEMENT` 先例）→ 批准落地漏斗（波一三原则：版本行翻转 → 审计 → 全员通知；通知在事务 resolve 后调、边界吞错）。**30 天锚的是批准时刻，不是提交时刻**：监管的钟从"通知客户"起算，本系统批准即通知，所以"生效 ≥ 批准 +30 天"一条校验即可；业主曾提议另设"通知时间"字段（三时刻），agent 建议合并、业主采纳，决策见 `decisions.md`。**⚡快进到生效**挂 `DEMO_CLOCK_WRITE` + Simulation 开关（金库/超管持有，合规官看得见页面点不动，与投诉拨钟同款 RBAC 交叉，非缺陷），审计 `AGREEMENT_FASTFORWARDED`（actor=操作者）与生效事实 `AGREEMENT_EFFECTIVE`（actor=system）分记——⚡是模拟器动作，生效是业务事实。

**通知。** `customer_notifications.relatedOrderType` 扩第五值 `AGREEMENT`（`relatedOrderNo` = versionKey），模板登记处第 17 条 "Customer agreement update"（email 模拟留痕），深链 → `/agreement`。**只发一条**（批准时）；生效时零通知——生效日的告知就是强制弹窗本身。日期口径是服务进程本地日（云端钉 `TZ=Asia/Dubai`）。（战役丙波四另增 `STATEMENT` / `DSR` 两值与两条模板，现模板登记处共 **19** 条、`relatedOrderType` 共 **7** 值，见 §8 与 `modules/v7-treasury.md` §7。）

**客户表态与能力闸**（客户端 `GET /client/agreements/{current,me}` + `POST /client/agreements/:versionKey/consent`；`me` 返回 `{ current, pending, previous, consent }` 四键，`previous` = 最近一版 SUPERSEDED 全文，使生效后仍可读旧版）：

| 时段 | 触点 | 行为 |
|---|---|---|
| 通知期（PUBLISHED 未生效） | **可关弹窗**（Accept / View full terms / Remind me later） | 可提前同意（落 ACCEPTED 新版行，生效后静默）；"稍后再说"不落库，仅本次会话不再弹 |
| 生效后未对生效版 ACCEPTED | **强制弹窗**（不可关，Accept / Not now + View full terms 链） | 同意 → 落 ACCEPTED 解锁；暂不同意 → 落 DECLINED、弹窗收起、**横幅常驻**；在 `/agreement` 页弹窗让位（先读后表态） |
| 已 DECLINED | 横幅常驻（"查看并同意"链 `/agreement`） | 页面照常浏览 |

能力闸接在既有 `CustomerAccessService`（`assertCapability` + `assertTradingIntake` 前置，六个调用文件零改动）：未同意现行协议 → **拦 DEPOSIT、拦 SWAP、放行 WITHDRAW**（硬拦提现等于锁住客户的钱——条款给 30 天正是留出走的时间；软处理"继续使用视为同意"则无同意记录）。**拒绝是显式的**：403 `code=AGREEMENT_NOT_ACCEPTED` + 人话 message，**不用 `NEUTRAL_DENIAL`**——这是客户自己的选择、零合规信息，不属 tipping-off（与钱的去向无关）；客户端拦截引导链到 `/agreement`（`customerFetch` 对该一码不再当会话过期踢登录，其余 403 旧行为不变）。充值入口的链上语义：demo 里入金一律经客户信号口 `createForCustomer`，拦截在信号提交口即生效、显式报错，不存在"已到账再处置"分支；兑换在**报价步**即被拦，提交步 403 仅在"拿着生效前的报价"时可达。**注册**时勾选即落 ACCEPTED（source=REGISTER，版本 = 注册时刻的生效版；注册时有在途新版也只同意生效版，登录后由弹窗引导）。**种子**：13 位 demo 客户各一行 ACCEPTED v1（actedAt = 各自注册时间），v1 EFFECTIVE、v2 DRAFT；**`demo:all` 零协议动作**（发布→审批→通知→快进→表态整条链是第十一幕现场戏，v2 全程保持 DRAFT，前十幕客户闸零影响）。

**阅读页与打印。** `/agreement`（通知深链与横幅落点）：版本状态头（你同意的版本与时刻 / 在途新版与生效日 / 待表态状态与同意按钮）+ 正文（V1·SUPERSEDED / V2·IN EFFECT / Upcoming 三态切换对照）+ 打印。同意动作弹窗与本页同走一个端点，同意后壳层 Gate 事件重取、横幅不刷新即消。打印走流式分页（七节远超一页，波二 `fixed` 版式只出一页），且必须在「背景图形」**开/关两态**真实渲染验证——关态是 Chrome 默认，T11 逮到颗粒叠层盖白整页（已修）。

**管理台可见面**：Compliance Office → Customer Agreements（版本列表 + 详情只读正文 + 提交发布弹窗 + ⚡快进钮 + 审批单链）；客户详情页一行 `Agreement`（"Accepted vX · 时刻"；生效版未同意时旁标 `declined`（有拒绝记录）/ `pending response`（尚未表态）徽章）；明细走审计中心按客户号 / 版本号检索。**不做**同意率计数与未同意名单（登 BACKLOG）。

**审计**（328 → **335**，+7，入"触达册"）：发布链五码域 GOVERNANCE（`AGREEMENT_PUBLISH_SUBMITTED` 合规官 / `AGREEMENT_PUBLISHED` 批准落地 / `AGREEMENT_PUBLISH_REJECTED` system / `AGREEMENT_FASTFORWARDED` ⚡操作者 / `AGREEMENT_EFFECTIVE` system）+ 客户表态两码域 CUSTOMER（`AGREEMENT_ACCEPTED` / `AGREEMENT_DECLINED`，metadata 带 source = REGISTER｜MODAL｜PAGE）；全部单步动作 `correlationMode=N`，主体信封 = 版本（`AGREEMENT_VERSION`·versionKey），表态两码另带 OWNER=客户。

**权限与判据**：Compliance Office 域 4→**5** 桶（`compliance-office.agreements` / `AGREEMENT_WRITE`，15 域 81→**82** 桶、89→**90** 组）；读挂既有 `compliance-office.view`（零新增读组）；`verify:rbac` S16a/b/c 钉死"提单权唯合规官 / 桶 groups 精确 / 两写路由分挂"，S5 的 `MAKER_GROUP_BY_POLICY` 加 `AGREEMENT_PUBLISH` 一行。

**与费率零联动**（防翻案，见 `decisions.md`）：日常调费率、限时活动费率动的是费率表，协议正文第 IV 节本就是引用式条款（"fees … are published on our fee schedule"）——协议只在**条款本身**变更时发布，该判断是法务人工判断，不是系统逻辑；费率模块与协议模块互不认识。

**关键技术节点**：`identity/agreements/`（`agreements-read.service.ts` 读 + 懒翻 + `recordConsent` 唯一表态写点 + 状态读；`agreement-publish-workflow.service.ts` 提交/批准落地/⚡快进三动作；`agreement-publish-approval.service.ts` 薄 handler（约 20 行）接 `workflow.customer-agreement.decided`；两个 controller 薄壳）；客户端 `AgreementGate.tsx`（弹窗/横幅）+ `agreementGate.ts` / `agreementView.ts`（四态纯函数，vitest）+ `AgreementPage.tsx` + 注册页条款抽屉取接口；管理台 `CustomerAgreementsPage.tsx`。

## 8. 资料请求 DSR · 改档案通道 · phone 自助改（战役丙波四，2026-10-03）

> 总纲 `archive/superpowers/specs/2026-09-30-campaign-c-outreach-disclosure-charter.md`（已归档） §1 岔口 1 / §2 波四行；spec 随合并归档（含执行订正）。管客户**要自己的资料有门可走**：查 / 改 / 删三种请求一张工单、一个 30 天的钟、DPO 一个人办、全程留痕。与 §7 协议同属"客户触达与披露"战役，同样**不动 lifecycle、不贴便签**。

**为什么有这一节。** 条款第 VI 节（Privacy & Data Protection）早已向客户承诺"DPO 30 天内答复数据请求"，系统却没有任何受理这类请求的主体——客户无处提、DPO 无处办、30 天钟无处挂。同时，原计划"改"的出口"合规官人工落档"缺落点：管理台裸 CRUD 客户端点 2026-09-16 已整体删除，`CUSTOMER_WRITE` 权限组与 `customer.manage_profile` 桶成了**零路由孤儿**（BACKLOG 旧账）。于是：新建 DSR 工单主体 + 新开"改档案"admin 通道（顺手把孤儿桶填实、销账）+ 客户自助改 phone。

**主体 `data_subject_requests`**（`identity/dsr-requests/`，迁移 + `reset-business-data.ts` 登记）：业务键 `DSR` + 12 位（`generateReferenceNo('DSR')`，铁律⑥）；`type` ∈ `ACCESS`（查）｜`RECTIFICATION`（改）｜`ERASURE`（删）；`detail`（客户自述，必填）；`status` **三态两边** `SUBMITTED → IN_REVIEW → RESOLVED`（显式迁移表 `DSR_STATUS_TRANSITIONS`，RESOLVED 终态，非法跃迁 400 `INVALID_TRANSITION`）；`dueAt` = `submittedAt + 30 自然日`（**自然日**，锚提交时刻、提交时一次算定——同投诉三常量与协议 `NOTICE_PERIOD_DAYS` 两处先例，条款原文 "within 30 days" 无业务日语义）；`resolutionCode` / `resolutionNote`（DPO 答复正文，客户可见）/ `clauseRef`（JSON `{versionKey, section:'VI'}`）/ `summary`（JSON 资料摘要，只写一次）/ `materialRequestNo`（连带开出的材料请求号，叙事互链）。**不走审批链**（审批策略仍 51 条、监听器仍 52——不再推高既有超限债只是顺带效果，业务理由是：DSR 处置 = 答复客户，不动钱、不动状态机；决策见 `decisions.md`）。

**四个结局码与类型匹配**（`DSR_RESOLUTION_BY_TYPE`，不匹配 400）：

| 类型 | 结局码 | 含义 / 连带动作 |
|---|---|---|
| ACCESS | `ACCESS_SUMMARY_PROVIDED` | 先「生成资料摘要」（仅 IN_REVIEW、只写一次）再办结；无摘要不许办结 |
| RECTIFICATION | `RECTIFICATION_REVERIFY` | 连带开一张材料请求让客户重验证件（见下「改」） |
| RECTIFICATION | `RECTIFICATION_SELF_SERVICE` | 指路客户去 Profile 自己改 phone（联系方式的出口） |
| ERASURE | `ERASURE_REFUSED_RETENTION` | 因监管留存义务有据拒绝，结构化引条款（见下「删」），**零删除动作** |

**资料摘要（查）。** DPO 在 IN_REVIEW 的 ACCESS 单上点「Generate summary」，把三块固化进工单（`DsrSummarySnapshot` 四键 `generatedAt` / `profile` / `agreementConsents` / `kycMaterials`）：① **档案白名单 14 键**（`DSR_SUMMARY_PROFILE_FIELDS` 显式枚举：customerNo、姓名 / 公司名、email、phone、dateOfBirth、nationality、idDocType、idDocNumber、residentialAddress、tradingTier、lifecycle、onboardingApprovedAt）——**不入摘要**：riskRating、eddRequired、hardLineDispositionedAt、限制、标签，内部合规判断一概不外露（tipping-off 红线，`decisions.md:65`；单测用反向断言钉死）；② 协议同意史全量 `{versionKey, actedAt, decision}`；③ KYC 材料清单 `{materialType, status, issuedAt}`（不带 `reason` 原文与 Sumsub 动作号），**含已结束的终态行**（APPROVED / REJECTED / CANCELLED 与订单绑定行一并列出——比客户活页面只见待办的范围宽，状态措辞中性，不构成 tipping-off）。摘要内证件号 / 出生日期**不打码**——它是"我们持有什么"的如实副本，客户本人可见。与 Profile 页的区别 = 范围（含客户平时看不到的协议史与材料清单）+ 形态（固化副本 vs 活页面）。

**改（两分流，零新改数据通道）。** ① KYC 字段 → `RECTIFICATION_REVERIFY`：办结的跨主体编排住 `dsr-resolution-workflow.service.ts`（铁律③跨主体协作只在 workflow，DSR 主体服务 `resolve` 只做本主体的事：校验 + 状态迁移 + 写 resolution 字段 + 审计）——workflow 先调 DSR 主体服务的 `assertResolvable` 判完办结前置，再调既有 `MaterialRequestIssuerService.issue()` 开一张 `EMIRATES_ID` 材料请求（`origin=OPERATOR_ISSUED`、`orderDomain=null`、**不挂限制**、话术中性只引 DSR 单号），然后调主体服务 `resolve`（带回 `materialRequestNo`）、最后发办结通知；**先开单取号、再落 resolve**——开单失败（如客户无 Sumsub applicant → 400）则整个办结失败、不落 resolve、不审计、不通知，单据仍 IN_REVIEW，保证 `materialRequestNo` 不悬空。客户发现途径**零新代码**：`orderDomain` 为空的材料请求自动进 Overview / Profile 横幅堆（`Verify now` 直达补交页）。⚠️ 材料 **GREEN 后没有任何自动落档分支**（`MATERIAL_REQUEST_REVIEWED` 三个监听者全按订单域过滤、空域直接返回）——**落档是人做**：合规官经下方"改档案通道"。（原脑暴拟"转合规官处理"分支取消——phone 自助改落地后无此需求。）② 联系方式 → `RECTIFICATION_SELF_SERVICE`：答复里指路 phone 自助改。

**删（有据地拒绝）。** `ERASURE_REFUSED_RETENTION`：**不删任何字段、不做字段级分析**，结论只有一个——因监管留存义务拒绝，并**结构化引协议**：`clauseRef = {versionKey, section:'VI'}`，`versionKey` 自动取该客户**最新已同意（ACCEPTED）**的协议版本（DECLINED 不算同意；无任何 ACCEPTED 行则 resolve 400）。客户端渲染"CLAUSE WE ARE RELYING ON — Customer Agreement v1 · §VI + 固定摘录 `erasure (subject to retention obligations)` + Read the full agreement"（链 `/agreement`，可在协议原文里找到那句——这是 §7 协议做成有版本可引的登记物才有的戏）。

**改档案 admin 通道（销 BACKLOG 孤儿桶旧账）。** `PATCH /customers/:customerNo/profile`：字段白名单 = **CDD 七字段**（`firstName` / `lastName` / `dateOfBirth` / `nationality` / `idDocType` / `idDocNumber` / `residentialAddress`），白名单外的键**整单 400**（`PROFILE_FIELD_NOT_EDITABLE`，不静默剥掉）；只写与现值真不同的字段，什么都没变 = 无持久动作 = 200 空操作、不留痕；审计新码 `CUSTOMER_PROFILE_UPDATED`（CUSTOMER 册，旧 `CUSTOMER_UPDATED` 在退役拒写闸，不复活）：`metadata.changedFields` + `metadata.before` / `metadata.after` 逐字段差异经 `audit-mask.util.ts` 打码（证件号 / 住址）。权限：`CUSTOMER_WRITE` 组 + `customer.manage_profile` 桶——**零新桶零新组**，合规官原本就绑着，BACKLOG 孤儿条随波销账（同时 `verify:rbac` 基线红集 2→1：COMPLIANCE_OFFICER "Invalid permission groups: CUSTOMER_WRITE" 一条自愈）。管理台：客户详情 Profile 节「Edit profile」弹窗（仅持 `CUSTOMER_WRITE` 者可见；公司客户无姓名栏；Save 后绿条 `Profile updated (…) — recorded in the audit log.`）。

**phone 自助改。** `PATCH /client/me/phone`（实际路由；spec §4.3 曾写 `/client/me/profile/phone`，零行为差异、命名不翻工）：客户端点、**零权限码**；只开 phone 一个字段（email 是登录凭据不碰，其余全是 KYC / CDD 字段，走重核验 / 运营改档案）；phone 不许清空（400 `PHONE_REQUIRED`——它同时是登录标识之一）；撞别的客户的号 → 显式 **409 `PHONE_ALREADY_IN_USE`**（`phone @unique`，是业务规则，不是防御校验）；与现值相同 = 无留痕；改后用新号登录属正常语义。审计 `CUSTOMER_PHONE_UPDATED`（actor=客户本人，metadata 掩码 before / after；掩码保留尾 4 位，末 4 位相同的新旧号在审计里看起来一样——既有 PHONE 规则的固有性质）。客户端 `CustomerProfile.tsx` Identity 节 phone 行内编辑（保存后刷新 hook）。同批为让路由前缀与 `client/me/*` 一致，`customer-profile.controller.ts` 改为方法级全路径，`GET onboarding/me` 的 URL **未变**。

**客户端。** 页 `/data-requests`（**侧栏无入口**，Profile → Audit & retention 节「Submit a data request」或 `DSR_RESOLVED` 通知深链进入）：三选一卡（Access / Correct / Delete my data，删的提示明说"部分记录依法必须保留"）+ 自述 + Submit；列表卡：类型 / 单号 / 提交日 / 状态徽章、办结后答复标题（四结局码各一句人话）+ DPO 答复正文 + 摘要三区折叠（ACCESS）或条款引用卡（ERASURE）。三路由 `client/me/dsr-requests`（POST 提交 / GET 列表 / GET `:requestNo`），客户面零权限码，别人的号与不存在的号统一同一句 404。**客户面投影真相 = 10 键**（`requestNo` / `type` / `detail` / `status` / `submittedAt` / `resolvedAt` / `resolutionCode` / `resolutionNote` / `clauseRef` / `summary`），**不下发** `dueAt` / `materialRequestNo` / `customerNo` / 任何内部 id——客户面只说"30 天内答复"，**零倒计时、零截止日**（单测有负面清单 + 正面全集双向断言）。提交与受理**不发通知**（提交是客户自己的动作，收敛判据不触发）；办结发一条（模板 `DSR_RESOLVED`，email 模拟留痕，`relatedOrderType='DSR'`，深链 `/data-requests`）。

**管理台。** Compliance Office → Data Requests：列表（type / status / 逾期过滤，Response clock 倒计时列）+ 详情（`/admin/governance/compliance-office/dsr-requests/:requestNo`：Request / Progress 三态 / Response clock / Data summary / Resolution / Clause reference）；三枚写钮（Start Review / Generate summary / Resolve）仅 `DSR_WRITE`（**DPO 独占**）可见，合规官与内审只读（"Read-only — only the Data Protection Officer can work this request"）；⚡ `simulate-timeout`（`dueAt → now−1h`，终态 400，照投诉同款）挂既有 `DEMO_CLOCK_WRITE`——**DPO 是经办人但拨不动钟**（与投诉"运营拨不动"同款 RBAC 交叉，是演示点不是缺陷）；详情页的 ⚡ 实际唯超管可见（`DSR_READ` ∩ `DEMO_CLOCK_WRITE`）。

**闹钟墙第四类灯。** `compliance-clock-wall.service.ts` 加 `kind:'DSR'`（逾期 = 读时现算 `dueAt < now`，已办结单永不逾期）；前端 `ComplianceClockWallPage.tsx` 五处联动（类型 / 徽章 / 行点击显式分支——else 兜底会错跳义务页 / ⚡ 走 DSR 端点 / `canFastForward`）。墙读挂既有 `COMPLIANCE_OFFICE_VIEW`——**DPO 不持有也不补发**（墙是合规官督办视角；DPO 看自己列表页的倒计时列），故"DPO 的钟挂在一面 DPO 看不见的墙上"是 RBAC 事实，剧本台词按督办视角讲。

**审计**（335 → **343**，+8，入"触达册"，`audit:vocab` 机器数）：`DSR_SUBMITTED`（客户）/ `DSR_REVIEW_STARTED` / `DSR_SUMMARY_GENERATED` / `DSR_RESOLVED`（DPO）/ `DSR_DEADLINE_FASTFORWARDED`（超管 / 金库，`requestId` 带随机后缀以便对同单重拨）五码域 GOVERNANCE，主体信封 = DSR 单（`DSR_REQUEST` · requestNo）+ OWNER=客户；`CUSTOMER_PROFILE_UPDATED` / `CUSTOMER_PHONE_UPDATED` 两码域 CUSTOMER（**V2 客户册现役码 29 → 31**）；另 1 码 `STATEMENT_ISSUED` 属月结单，见 `modules/v7-treasury.md` §7。新主体不加 workflowType（无审批链）。

**权限与判据。** Compliance Office 域 5→**6** 桶（`compliance-office.dsr`，**15 域 82→83 桶**）；新组 `DSR_WRITE`（**DPO 独占**——他的第一个经办面）/ `DSR_READ`（DPO / 合规官 / 内审三职务，照 `COMPLAINT_READ` 三读者先例），**90→92 组**，DPO 现 15 组；`verify:rbac` S13d 预期数 83 / 92、S16d–g 四条静态判据（两组四处齐 / `DSR_WRITE` 唯 DPO / `DSR_READ` 恰三职务 / 桶 + 六路由挂组精确）+ 行为探针（DPO resolve ALLOW、合规官 resolve DENY、运营 list DENY、DPO ⚡ DENY；改档案另三条——T8 补合规官 PATCH profile ALLOW、DPO PATCH profile DENY，终审修补运营 PATCH profile DENY）。**审批策略 +0**（监听器维持 52）。

**不做**：DSR 真删数据；审批链；客户撤回 / 附件 / 多轮对话；摘要脱敏（PRD 若要求另裁，登 BACKLOG）；全局演示时钟（实扫证实系统无全局钟，⚡"拨钟"全是逐单改写截止列，见 `decisions.md`）。

**演示**：第十幕·场景 34（演员 Henry，改 → 删 → 查对照 → tipping-off 反面步），见 `demo/script.md`。**关键技术节点**：`identity/dsr-requests/`（`dsr-requests.service.ts` 主体 + 三态 + 办结落库；`dsr-resolution-workflow.service.ts` 办结编排（开材料单 + 通知）；`dsr-requests.admin.controller.ts` 六路由；`dsr-requests.client.controller.ts` 三路由；`dsr.constants.ts` 常量与类型）；`customers.service.ts` `updateProfileFields()` / `updatePhoneSelf()`；管理台 `DsrRequestListPage.tsx` / `DsrRequestDetailPage.tsx` / `CustomerProfileEditModal.tsx` + `utils/dsrMap.ts`（本地镜像，不跨端 import）；客户端 `DataRequests.tsx` + `utils/dsrView.ts`。
