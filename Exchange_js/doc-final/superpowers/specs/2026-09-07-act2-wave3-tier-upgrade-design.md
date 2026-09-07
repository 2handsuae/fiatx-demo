# 第二幕客户域 · 波三「交易档位升级」spec

- 日期：2026-09-07 ｜ 总纲：`2026-09-06-act2-customer-waves-outline.md`（跨波口径直接引用，不重议）｜ 本文吸收并取代同名骨架（承接波二见下节）
- 性质：多波之波三（最后一波）。业主脑暴收口 2026-09-07：投资者分类不进本波 / 申请人级 level 非动作级 / 不做降级 / 审批高管单步 / 入口 Profile 卡片 / 无次数冷却 / TB 运行时开户进本波——七条裁定已录 `decisions.md`
- 模拟基调沿波二：演示主线走模拟分支（⚡ 喂 webhook，零外部依赖），webhook 形状按真 Sumsub 契约保真，真接只换开关不改形状
- 行业口径：这是**合规档位**升级（多交尽调材料换更高限额，FATF EDD 级材料 + 高级管理层批准同一挂钩点），不是商务 VIP（费率已彻底解绑，总纲裁定）

## 本波做 / 不做

**做**：TB 账本户运行时开户钩子（波二 ⭐ 缺口销账，首次 ACTIVE 时挂）；升级申请单主体（新表 + 4 态 4 边状态机 + 业务键 `upgradeNo`）；PREMIUM 申请人级 level 常量与上传模板；摄取分发器按在审申请单开升档路；⚡ 升档模拟端点与面板按钮；审批新类型 `CUSTOMER_TIER_UPGRADE`（运营提 / 高管单步批）；`tradingTier` 唯一写口收编；客户端 Profile 档位卡片 + 两档限额对照 + 升档补料会话页 + 限额错误页内提示条带升级 CTA；管理台客户详情升级申请区块；审计 V2 域 22→28 码；RBAC 新组新桶；第二幕剧本加升档景 + funding beat 复活；文档收口。

**不做**（对照 §2 与总纲 + 本波脑暴）：降级（PREMIUM→BASIC 无边，迁移表天然拒）、撤回升级申请（入驻做撤回因客户可能不想开户，升档无同等动机，关单走被拒/否决两条路）、次数/冷却限制（单人顺序演示永不触发，防御性兜底；波二对重申已有同款裁定）、投资者分类（Retail/Qualified/Institutional 是另一根轴，roadmap :158 原地不动）、费率联动、材料清单数据结构（零存储推论，见 §3）、升档 SLA 计时（等的是客户自己和演示者的手）、`tradingTier` 独立迁移表（就一条边，申请单状态机代管）、真接 Sumsub 联调、webhook 签名校验/幂等去重（技术兜底）。

## 承接波二（2026-09-07 收尾填，原骨架内容压缩保留）

- **实证可直接复用**：同一客户 reject-retry 与 reapply 之间 `sumsubApplicantId` 原样不变——升档放心复用同一 applicant，不重建 ✓｜`customer_main` 已有 `tradingTier`（String，默认 BASIC）与 `riskRating` 列，目标列存在，**本波客户主表零新列** ✓｜准入审批 maker(运营)→checker(高管) 单步结构经 `ApprovalHandlerBase` 机制技术可扩 ✓（岔口①已拍板沿用，见 §5）
- **走查工具**：`demo-shot.js` 已带 `--cookie key=value`（`shared_simulation_mode` cookie 是 host-only，headless 必须显式传）、`--prompt-text`、`--click "文本::idx"`、`--type` 三击清空——升档走查直接复用｜审计断言标准姿势：`sqlite3 -header -column <db> "SELECT eventNo, action, actorNo, outcome, occurredAt FROM audit_log_events WHERE ownerCustomerNo='CUxxx' ORDER BY occurredAt;"`
- **报价对照口径**：1000 USDT 档 NEWCUST flat 16 vs STD flat 20（业主更正版），后端 `GET /swap-transactions/rate` 与 UI 同路由可绕余额验证费率
- **两个已知钳制（本波解因）**：现场注册客户 TB 账本户从未运行时开户，充值正路卡死 `PAYIN_PENDING`（BACKLOG :155 ⭐，→ §7 钩子）；客户端 Swap「You Sell」受持仓钳制，零余额打不出超限预览（→ §12 剧本先铺真实充值，随 §7 自然解）
- **杂项**：`invite-expiry.service.spec.ts` 真实路径在 `identity/users/`，需 self 栈 TB 真连上才转绿（预置环境依赖，非回归）
- **level 常量分裂「统一看」结论（波二偏差① 收口）**：`ONBOARDING_LEVELS` 是申请人级（整个人的认证档），`material-policy.ts` 的 `sumsubActionLevelName` 是动作级（交易侧单笔补料）——Sumsub 两个不同概念，**不合并**；本波只在申请人级表加一行，动作级原样不动

## §1 流程主线

```
现场客户(ACTIVE·BASIC) → Profile 档位卡片「申请升级」
  → 后端建申请单(upgradeNo, IN_REVIEW) + applicant 换档 PREMIUM 档(我方主动换,见§4) + 审计
  → 客户端升档补料会话(地址证明 + 资金来源两个上传位,零存储) → 提交(落 materialsSubmittedAt)
  → ⚡喂 applicantReviewed GREEN → 申请单 MATERIALS_CLEARED
  → 运营在客户详情「提交准入审批」 → 审批中心单 → 高管批
  → 申请单 APPROVED + 同事务写 tradingTier=PREMIUM → 限额门当场变(实时读,零改动,见§6)
  → 客户端重试此前被拒的兑换/提现,通过
```

**旁支**：RED-RETRY → 申请单停留 `IN_REVIEW`，会话内重交（沿波二分治）；RED-FINAL → 申请单 `REJECTED`；高管否单 → 申请单 `REJECTED`。被拒后随时可开新单（同一 applicant）。**全程 lifecycle 不动**——客户始终 ACTIVE，升档被拒（含终拒）只是「敞口没批下来、关系照常」，与入驻终拒「关系被拒待离场」后果不同，演示话术按此口径。

## §2 升级申请单（新主体 + 显式状态机）

新表 `tier_upgrade_applications`：`id / upgradeNo（业务键，生成照既有单号惯例）/ customerId / status / fromTier / toTier / materialsSubmittedAt / decidedAt / createdAt / updatedAt`。fromTier/toTier 本波恒 BASIC→PREMIUM，落列为审计真相（将来加档不改表）。

**4 态 4 边显式迁移表**（铁律④，非法跃迁显式拒）：

| 边 | 触发 |
|---|---|
| IN_REVIEW → MATERIALS_CLEARED | GREEN 裁决 |
| IN_REVIEW → REJECTED | RED-FINAL 裁决 |
| MATERIALS_CLEARED → APPROVED | 高管批 |
| MATERIALS_CLEARED → REJECTED | 高管否 |

RED-RETRY 不迁移（停留 IN_REVIEW）。「审批中」不是状态：提没提从关联审批单推导展示（波二教义）。守卫：同客户同时至多一张非终态申请单（IN_REVIEW / MATERIALS_CLEARED），有在途单时申请端点显式拒；仅 ACTIVE 且 tradingTier=BASIC 的客户可申请。

新模块 `src/modules/identity/tier-upgrade/`（与 onboarding 平级，铁律③各管各的）：workflow service（状态机唯一写入口）+ 审批 handler + 客户面 controller + admin controller。

**迁移**：照常新增迁移文件（保证空库能建起；不写 backfill / 兼容层，改完 = reset 重铺闸⑧）。客户主表零新列（承接实证）。

## §3 Sumsub 侧：level 加一行 + 零材料清单

- `ONBOARDING_LEVELS` 加 `PREMIUM: 'premium-tier-level'`；`ONBOARDING_LEVEL_TEMPLATES` 加对应上传模板（`PROOF_OF_ADDRESS` + `SOURCE_OF_FUNDS` 两个上传槽，照 EDD 模板样式）
- **换档是我方主动动作**（与波二 EDD 换档的 Sumsub 主动方向相反）：申请端点内直接完成换档——`sumsubCurrentLevelName` 写 PREMIUM 档 + 审计（真接时此处调 Sumsub move-applicant-to-level API，模拟时 mock no-op）；**不复用**入驻的 `applyLevelChange()`（守卫死在 IN_VERIFICATION，语义也不同），升档 workflow 自带换档逻辑
- 档名**形状保真**：申请即换档、被拒不回退（真 Sumsub 里 applicant 确实在 premium 档上被 RED）；管理台展示口径「档名 = 当前认证会话档，tradingTier = 生效档位」，两者分开标注
- **材料零存储（业主 2026-09-07 已点名「波三补高级材料照此办理」）**：地址证明 / 资金来源一个字节不落、连名录不记；我方不存在「PREMIUM 材料清单」数据结构——清单真身是 Sumsub 侧 level 定义（模拟），客户端卡片上「需要提交：地址证明、资金来源」是静态展示文案

## §4 摄取分发与 ⚡ 模拟

- **分发开路**（`sumsub-ingestion.service.ts` 的 `applicantReviewed` 分支）：applicantId 反查客户后，**先查该客户有无 `IN_REVIEW` 升级申请单**——有则路由 `tierUpgradeWorkflow.applyReviewVerdict`，无则走既有入驻路径。入驻处理器的 lifecycle 守卫（`IN_VERIFICATION`）原样不动，两线用申请单存在性隔离（比按档名判稳）。`applicantLevelChanged` 分支不动（升档换档不经 webhook）。既有两路（三域 KYT 级联、材料请求裁决）与放行顺序原样
- 升档裁决守卫：未提交（materialsSubmittedAt 空）或申请单非 IN_REVIEW 时到达的裁决显式拒；RED 必带 rejectType（缺了显式拒，波二判例）
- **RED-RETRY 清 `materialsSubmittedAt`**（照波二换档清 `onboardingSubmittedAt` 先例）：会话重新开放提交，客户端从「等待审核」屏回到上传表单；rejectType 不下发客户面（白名单构造，§8），客户只见「请重新提交材料」中性文案
- **⚡ 端点**（`admin-sumsub-simulation.controller.ts` 加一枚，与既有逐字同款语法：拼真形状 payload → `ingest(payload, {isSimulated: true, ...})`）：`POST tier-upgrade-review-result` {customerNo, reviewAnswer, reviewRejectType?}
- **⚡ 面板**：admin 客户详情升级申请区块内三按钮（通过 / 拒绝-可重试 / 拒绝-终拒），模拟模式门控，仅申请单 IN_REVIEW 且已提交时亮

## §5 审批线（岔口①落地：与入驻 EDD 准入同语法）

- 类型 `CUSTOMER_TIER_UPGRADE`，策略照抄准入：`steps: [{stepNo:1, roles:['SENIOR_MANAGEMENT_OFFICER']}]`、48h、allowCancel。审的是**接不接更大的敞口**，不是重审材料（材料裁决在 Sumsub，MLRO 100% 留在 Sumsub 侧——波二讲法不破）
- handler 照 `OnboardingAcceptanceApprovalService` 16 行范式继承 `ApprovalHandlerBase`，注册进 tier-upgrade module providers
- maker = 运营：`POST /admin/customers/:customerNo/tier-upgrade-acceptance`（铁律⑥业务键），守卫 = 存在 MATERIALS_CLEARED 申请单且无在批审批单；单据快照：customerNo、upgradeNo、fromTier→toTier、档名、Sumsub 裁决摘要、riskRating
- 裁决处理器（`workflow.customer-tier-upgrade.decided`）：APPROVED → 申请单沿边 APPROVED + **同事务** `tradingTier=PREMIUM` + 审计；DECLINED → 申请单 REJECTED
- **三处同加判例照办**：`approvalEntityRoutes.ts` 回链客户详情 + `scripts/verify-rbac.ts` `MAKER_GROUP_BY_POLICY` 加行（新组见 §10）+ 详情页走 generic `objectSnapshot.impact` 路径（入驻类型实证零专属分支，快照按该形状落）

## §6 tradingTier 写入收口与生效链

- **唯一运行时写口** = §5 裁决处理器（同事务：申请单终态 + 列翻转 + 审计 before/after 带 fromStatus/toStatus，三期判例）。裸列直写从此绝迹（种子 fixture 与 `demo-lib.ts` 的 PREMIUM knob 是铺数据，不算运行时写方，原样保留）
- **生效链零改动（扫描实证）**：`TransactionLimitGateService.evaluate()` 每次建单实时 `findUnique` 读 `customer_main.tradingTier`（无快照/缓存），`transaction_limit_rules` 种子已分 BASIC/PREMIUM 两档——列翻转即刻生效
- **撞限拒单只在兑换/提现**（充值 L1 走 HOLD 不抛错，扫描实证）——剧本与场景 CTA 都按这两域做（§8/§12）

## §7 TB 账本户运行时开户钩子（BACKLOG :155 ⭐ 销账）

- **挂点**：入驻 workflow 驱动客户**首次进 ACTIVE** 的两处（`applyReviewVerdict` CDD_CLEARED 路径、`onAcceptanceDecided` FINAL_APPROVED 路径）——以「applyAction 前 `onboardingApprovedAt` 为 null」判首次，跨主体协作在 workflow 层（铁律③）
- **动作**：按全部 ACTIVE 资产 × [CLIENT_PAYABLE, DEPOSIT_SUSPENSE]（与种子 `seed.business.ts:849-859` 同款行形状）建 `tb_account_registry` 行 + 真实 TB 账户；建 TB 户走既有 `AccountingService.createAccounts`（运行时零调用方，本波启用）
- **与种子的一致性在行形状与查键，不在 id 派生**（写 plan 时按代码实况修正原「抽共享 id 派生 helper」预案）：解析（`resolveTbAccountId`）只按 `(code, ledger, ownerType, ownerUuid)` 查 registry、不重算 id，运行时走既有 `AccountingService.createAccounts` 整条路径（`tbId()` 随机 + registry 登记）即可；已存在行跳过，语义与种子 `ensureTbAccountRegistry` 的 findFirst 一致
- **失败即流程失败**：TB 不可达时激活当场抛错，不 graceful skip（总纲级假设——外部系统总在（CLAUDE.md §3）；吞错正是 :155 卡单的病根）
- 审计：`CUSTOMER_LEDGER_PROVISIONED`（recordSystem，afterData 带资产×科目行数）——「账户开好了」在审计里讲得出
- 种子客户 `onboardingApprovedAt` 已回填 → 首次判定恒假，天然不重复开户；升档**不需要**新开户（账户按资产开，与档位无关）；现场客户即用即弃 + reset 重铺，无「后加资产补开户」缺口

## §8 客户端（岔口③落地）

- **Profile 档位卡片**：当前档位 + BASIC/PREMIUM 两档限额对照表 + 「申请升级」按钮（仅 BASIC 且无在途单时亮）；在途时变「升级审核中 · <推导自申请单/审批单>」；被拒显示「可重新申请」。`/onboarding/me` 补下发 `tradingTier`；新客户面端点族（照 onboarding 客户面语法，不进 rbac 目录）：概览（档位 + 两档限额对照 + 在途申请投影）/ 发起申请 / 会话查询 / 提交
- **补料会话页**（新路由，整体照 `OnboardingVerification.tsx` 语法）：simulation 渲染两个虚线占位上传框（Proof of Address / Source of Funds，与 EDD 假上传同构，不做真文件处理），Submit → 提交端点落 materialsSubmittedAt + 客户 actor 审计；加载态先拦、提交必查 `r.ok`（两判例）；已提交 → 「资料已提交，等待审核」屏；真接分支照抄 snsWebSdk 容器语法
- **限额错误页内提示条**（外科手术）：`Swap.tsx` / `Withdraw.tsx` 现用原生 `alert()` 展示 `resolveSubmitErrorMessage` 文案——alert 放不了链接，本波把**限额四码**（BELOW_MIN / ABOVE_MAX / CUMULATIVE_EXCEEDED / UNPRICEABLE）的展示改为页内提示条，其中超限两码（ABOVE_MAX / CUMULATIVE_EXCEEDED）附「Upgrade your tier」链接 → Profile；其余错误路径维持 alert 原样不动
- 客户面白名单：申请单只下发 `upgradeNo / status 派生布尔 / materialsSubmittedAt 派生 submitted`；内部 id 与审批单内部结构不出客户面

## §9 管理台

- 客户详情加「升级申请」区块：upgradeNo / 状态 / 提交时间 / 关联审批单推导展示（「未提请 / 审批中 APR-xxx / 已批 / 已拒」）+ ⚡ 三按钮（§4）+ 运营「提交准入审批」按钮（按权限显隐，MATERIALS_CLEARED 且无在批单时亮）；档位与档名分开标注（§3 口径）
- 不建独立申请列表页——申请挂客户详情看，审批在审批中心走 generic 路径，回链跳客户详情
- 新增 admin 路由全部登记 `rbac.catalog.ts`（提单 1 + ⚡ 1 + 区块读若干），读路径优先挂既有客户域读组，⚡ 挂 Demo Instruments 喂裁决组

## §10 审计合同（V2 域 22 → 28）与 RBAC

新增 6 码（domain CUSTOMER、correlationMode 客户级 N、主对象 customerNo；出生即冻结四属性，过 `audit-vocabulary-closure.spec.ts` 封册守则；每次显式 `requestId`——静默去重判例）：

| 码 | 触发 | actor |
|---|---|---|
| TIER_UPGRADE_APPLIED | 发起（建单 + 换档，afterData: upgradeNo/from/to/档名） | 客户 |
| TIER_UPGRADE_SUBMITTED | 材料提交 | 客户 |
| TIER_UPGRADE_VERDICT_APPLIED | GREEN/RED 落轴（answer/rejectType + fromStatus/toStatus） | SYSTEM |
| TIER_UPGRADE_ACCEPTANCE_SUBMITTED | 运营提单（审批单号入 afterData） | 运营 |
| TIER_UPGRADE_ACCEPTANCE_DECIDED | 高管裁决 + 档位翻转（decision + before/after tier + fromStatus/toStatus） | 高管 |
| CUSTOMER_LEDGER_PROVISIONED | TB 开户钩子（§7） | SYSTEM |

RBAC：新权限组 `CUSTOMER_TIER_UPGRADE_WRITE`（运营持），Customer Management 域加一桶「提档位升级准入」；按清单四处同现（`PermissionGroup` 联合类型 / `route()` / `ACTION_BUCKET_CATALOG` 桶 / 职务绑定）；合并后 `db:base:sync` + 重启（老坑）；`verify:rbac` 加判据：maker 组映射行（S5 家族自动守自批死锁——maker 运营 / checker 高管天然分立）+ 新路由行为探针。

## §11 剧本与演示数据

`demo/script.md` 第二幕加第 5 段「档位升级」（前四段波二版保留），弧线：

1. 现场注册客户走 CDD 直通至 ACTIVE（复用第 2 段，TB 钩子在此静默开户）
2. **funding beat 复活**：客户端 Simulate Deposit + 管理台资金单三段推进全套走完 → 余额真实到账（波二只能演到 ACTIVE 的钳制解除；报价拍从「后台对照」升回「现场自见」）——充值金额压过 BASIC 兑换累计限额线（具体数值 plan 时按 `transaction_limit_rules` 种子核定，记入 `demo/data.md`）
3. 兑换卖出撞 BASIC 累计限额 → 页内错误条 + 升级链接 → Profile 档位卡片（两档对照表讲一句）→ 申请 → 补料 → ⚡GREEN → 切运营提单 → 切高管批 → 档位翻 PREMIUM
4. 回客户端重试同参数兑换 → 通过；讲一句「限额门实时读档位，批完即生效」

旁支顺手演：⚡RED-RETRY 重交。`demo/data.md` 同步：剧本参数（充值金额 / 撞限金额）+ 现场客户命名约定沿波二。

## §12 文档收口（清单「每轮收尾」行，plan 落成任务）

- `modules/v2-customer-compliance.md`：§1 加「升档之路」段；§2 加申请单状态机表（客户 lifecycle 表不动，注明升档不碰 lifecycle）；§3 决策表加升档准入行（运营提 / 高管批）；§4 演示脚本同步；§5 技术节点（tier-upgrade 模块 / 唯一写口 / TB 钩子 / ⚡ 端点 / 审计 28 码 / 审批类型）；§6 销「档位升级待波三」条
- `modules/overview.md`：Customer Management 域桶数、职务表运营行 +1 项、技术节点补 TB 钩子一句
- `BACKLOG.md`：:155 ⭐ TB 开户条销账（附走查复现翻绿证据）；:97 Tier Upgrade 条销账；波二承接钳制随 :155 连带销
- `decisions.md` 已录（本次脑暴七条）；`CHANGELOG.md` 合并时一行；Thread 收尾按 `CLAUDE.md §9` 报层
- **总纲归档**：波三是最后一波，合并后总纲随本 spec 一起移 `archive/`（总纲自定的生命周期）
- 域事件：本波不新增（编排直调；审批 decided 二级事件走既有框架）
- 清单触发行：动钱/金额——**本波不改任何记账代码、不新增科目**（TB 钩子用既有科目码开户，无分录），但钩子首次让现场客户充值记账真实走通 → 收尾闸加跑 `verify:coa`（⑦）；交易三域改动——只动 Swap/Withdraw 错误展示层与分发器升档分支，交易状态机零改动，充值域不改有实证理由（L1 HOLD 无拒单错误路径，§6）；退役业务动作——无；新事件——无

## §13 验收口径

1. **走查全弧线**（截图，`demo-shot.js` 带 `--cookie` 等承接 flags）：§11 五拍逐拍 + RED-RETRY 旁支 + 被拒后重新申请
2. **TB 钩子直接断言**（:155 复现命令翻绿）：现场注册客户 ACTIVE 后 `sqlite3 dev.db "SELECT count(*) FROM tb_account_registry WHERE ownerUuid='<id>'"` = ACTIVE 资产数 × 2；同客户充值单推进到 `SUCCESS`、资金单 `CLEARED`、余额到账；后端日志无 `TB Step 1 failed`
3. **限额生效直接断言**：升档前同参数兑换建单被拒（读错误码 CUMULATIVE_EXCEEDED），升档后通过——不许只靠花名册（花名册不校验限额/费率，波二承接）
4. **铁律**：④非法喂显式拒（未提交先裁决 / 终态单再裁决 / BASIC 以外申请 / 在途单重复申请）；①走查每步按 customerNo 在审计查得到对应码（sqlite 姿势）；⑥客户面与管理台全程 upgradeNo/customerNo 无 UUID 外露
5. **闸门**：随手闸①–⑤（含前端截图）；随码测试全绿（申请单状态机与守卫 / 分发路由两线隔离 / 审批 handler / tradingTier 同事务写入 / TB 钩子首次判定与共享派生等价）；收尾闸⑥ `demo:all` 全绿（种子花名册不受扰）+ ⑦ `verify:coa` + ⑧ reset 重铺（动 schema：新表 + 迁移；判据对照 `demo/baseline.md` 全绿）+ `verify:rbac`（新判据）+ `verify:audit`（词表 +6）
6. 合并后：重启 + `db:base:sync` + `stack.sh reset main`；按 `rules/delivery-checklist.md` 收尾；总纲与本 spec 一起归档

## 债务登记（执行中如证实则记，不在本波修）

- 真接 Sumsub 时 move-applicant-to-level API 的错误处理与重试 → PRODUCTION-NOTES（技术兜底）
- 限额四码之外的错误仍走 alert 的体验统一 → 如业主提及记 BACKLOG，本波不扩
