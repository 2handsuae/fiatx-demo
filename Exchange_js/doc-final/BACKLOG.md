# 业务缺口台账

> **只登记业务缺口**：某流程 / 某页面 / 某状态在演示里缺、讲不圆、显示错。
> 技术待办（兜底 / 故障 / 并发 / 幂等 / 命名 / 死码 / 工具 / 测试基建 / 前端观感）一律记 `PRODUCTION-NOTES.md`，**不在此处**。
>
> **分诊判据**（`rules/review-rubric.md`）——
> 业务：显示的内容错了 ｜ 该有的信息没有 ｜ 结局不完整（某条业务出路没有）｜ 留痕缺业务动作 ｜ PRD/modules 说的和代码不一样。
> 技术：只有攻击者 / 故障 / 并发 / 重复回调才触发 ｜ 长得不一样但内容都对 ｜ 纯内部（命名、死码、类型、schema 残列、存储单位）｜ 工具与测试基建。
> 边界一条：挡住**开演**（铺不出数据、剧本讲错）算业务，记 BACKLOG；挡住**开发**（端口、PATH、worktree）算技术，进 PRODUCTION-NOTES。
>

> **⭐ = 带同事走七幕时会当场看到或讲不圆的**，共 16 条。一行四要素：是什么 ｜ 哪来的 ｜ 落点 / 状态。做完就勾掉，重排 / 分诊时统一归档到文末销账。
> 分诊历史：2026-08-26 首次分流（加固类迁出）；2026-08-28 二次分诊——业务/技术彻底分家：8 条已完成或已作废销账、45 条迁 `PRODUCTION-NOTES`、4 条从 `PRODUCTION-NOTES` 判回业务；同日「演示装备」A 档 8 条逐条实跑复核，6 条实证已修当场销账。**2026-08-29 演示装备一期收官**——A 档剩下的 2 条（造数花名册、补料回炉）做完销账，A 档 8/8 全部完成、整节退役删除（原文见「本轮销账」章节与 git 历史）；导语并入 §B。分诊前全文见 git 历史（`649b4e88`）。
> **2026-09-08 按演示动线重排**——章节改为七幕行进顺序（幕内按站 / 场景），43 条已勾条目整批归档文末「本轮销账」；「Material Refresh 状态名」1 条作废（所指代码已随子系统退役，`grep -rln "NUDGE_ONLY" src admin-web/src client-web/src` 零命中）。重排前全文见 git 历史（`f27e8312`）。

Last Updated: 2026-09-08

## A. 开演前（重铺 + 造数判据）

> 还没开讲就可能踩的：开演前重铺（`reset-main` → `demo:all`）与造数判据网、答案键、铺场工具的缺口。

- [ ] 🔴 **`demo:all` 偶发客户侧记账失衡（约 1/13，触碰铁律⑤「钱动必过账」）**：全新库上跑 `reset self` → `demo:all`，29 笔订单全部走到预期终态、**花名册断言全绿**，但 COA 客户侧两条恒等式静默不平——实测 `CLIENT_ASSET(AED) 12346594 ≠ CLIENT_PAYABLE+DEPOSIT_SUSPENSE 4266547`（差 80,800.47 AED），`USDT` 同向差 8,992.57 USDT，**两个币种资产 side 均约为负债 side 的 2.88 倍**；公司侧两条恒等式同时全绿。**非确定性**：同一提交同一命令连跑 13 次，12 次干净、1 次失衡。已用实证排除"本批引入"——在 `git merge-base main HEAD`、在新增客户提交的前一刻、在该提交本身、在 HEAD 上分别跑过，且逐提交核对确认 `demo:all` 实际执行到的 `demo-lib.ts`/`demo-roster.ts` 在这些提交间**逐字节相同**。花名册从 21 行加到 29 行只是把单次记账笔数从 ~14 提到 ~21，**提高了撞上的概率、不是原因**。

  **头号怀疑（未坐实，把握中等偏低）**：`src/modules/trading/swap-transactions/swap-workflow.service.ts:1529` 的 `handleFundsOrderChanged()` 在腿失败/超时时走 `:1636` 的 `onLegFailedSelfHeal`——void 当前 attempt、重建 attempt+1。而 `swap-leg-accounting.ts` 的 `deterministicTransferId(..., attempt)` 把 attempt 编进转账 ID，**TigerBeetle 的 ID 去重因此只挡得住同一 attempt 内的重复，挡不住"这一 attempt 其实已经落账成功却被误判 FAILED/TIMEOUT"**；且 `postLeg`/`advance`/`createLeg` 整套包在 SQL `$transaction` 里，**TigerBeetle 的落账不受该事务回滚保护**。已排查并排除：充值 SUCCESS 路径（成对转账，重复调用不破坏恒等式）、几个 SLA 类 `@Cron`（阈值 30 秒~5 分钟，远长于 demo:all 实测 ~18 秒全程）。

  🔴 **2026-08-31 订正：此前把"单个客户钱包净额变 0"记成本条的第二个症状，是并错了。** 那个现象读的是另一条代码路径（对账引擎的 `WalletBalanceCheckerService`），而本条 COA 断言走的是 `demo-lib.ts` 的 `buildCoaBalanceMap`（遍历注册表 → `lookupBalance`），两者不共享出错点。**"钱包净额变 0"已另有更好的解释**：`PRODUCTION-NOTES.md` 那条「`WalletBalanceCheckerService` 查注册表未套用十六进制补零，随机丢一笔分录」——概率约 1/16、症状正是"少算一整条 PAYABLE 分录"、且一旦命中会在该 reset 周期内**稳定**复现。

  ⚠️ **但这条 COA 失衡本身仍未销账**，而且新线索提高了它的嫌疑度：那个补零缺陷丢的是**负债侧**分录，方向与本条实测的"资产 side 约为负债 side 的 2.88 倍"**一致**。下次取证时值得先排除它——如果 `buildCoaBalanceMap` 那条路上也有类似的 id 匹配（而不是纯 registry 遍历），两条可能就是同一个根因。

  **下次取证的正确姿势（关键，别错过现场）**：判红后**先别 reset**，在失衡的库上按 `sourceType/sourceNo` 分组，数 `account_flows` 里每个 `swapNo`/`depositNo` 名下 `CLIENT_ASSET` 方向的转账笔数是否 >1（正常恒为 1）——比继续读代码猜更快锁到是哪类单、第几次 attempt。

  ⚠️ **归 BACKLOG 不归 PRODUCTION-NOTES**：它动的是「钱动必过账」这条不可违反规则，一旦坐实会动摇账本可信度，不是纯技术兜底 ｜来源: 2026-08-30 破口场景批次 Task 5 收尾时撞见，专项调查报告见 `.superpowers/sdd/coa-imbalance-report.md`

- [ ] **`demo:all` 花名册断言只看订单终态，不校验命中费率档——Grace 命中 VIP 档还是回落 STD 档，花名册分不出**：`demo-lib.ts` 的花名册比对逐笔只断言"预期终态 == 实到状态"（如 SUCCESS/FROZEN），不读订单实际结算用的费率等级或费用金额。VIP 与交易档位解绑后（2026-09-06 客户域波一，VIP 改手打 STATIC 标签），Grace 的 VIP 标签是否真的命中 `VIP-USDT-AED` 费率档、还是意外回落到 `STD-USDT-AED` 默认档，两种结局订单终态都是 SUCCESS——花名册测不出区别，是判据网缺口，不是已知业务功能缺失 ｜来源: 2026-09-06 第二幕客户域波一评审发现

- [ ] **答案键的 `expectedLines[].amount` 是装饰性的、没人读**（2026-08-31 终审）：`verifyManifest` 的 select 和匹配谓词都不碰它，且语义在场景间不统一（有的存注入后的新值、有的存差额）。升级方向是把它变成载荷（谓词里断言外部金额），这样"注入跑了但 delta 算错"也能被抓到——现在的钉行只能抓"整条没了"。⚠️ 终审的判断是**这条优先级低于已完成的完整性断言**（`casesOpened == manifest.wallets.length`，已于 `2e74d6d4` 落地）：金额算错已被 `bumpClosing` 连到桶断言上，而"多报破口"那一侧才是当时完全没人看的 ｜来源: 2026-08-31 整支终审

- [ ] **`recon-demo.ts` 报错文案里的钱包 UUID 至少 5 处**（`:727/831/898/947/1295` + ⑫⑬ 两处同形）：commit `7aeeec7d` 专门为前置闸做过"报错改用钱包号 + 客户号"的清扫，同形的兄弟没跟上。**开发者面报错、不是管理台，不破铁律⑥**，纯可读性 ｜来源: 2026-08-31 整支终审

- [ ] **`recon-demo.ts` 报错文案里的钱包 UUID：根治办法是给 `WalletPlan` 加 `walletNo` 字段**（Task 11 评审顺带发现）：上一条「至少 5 处」逐处手改治标不治本——`WalletPlan`（本文件 `planWallets` 的返回类型）从来没有 `walletNo` 这个字段，只有内部 `walletRef`（UUID），所以每处新写的报错都只能选 UUID 或者改用 `currency`/`coaCode` 之类的替代信息绕开（T11 场景 10 的报错就是这么绕的）。根治：`planWallets` 查询 `wallet` 表时顺手 `select` 上 `walletNo`（真实值例如公司运营户 `WA2601017168`），`WalletPlan` 接口加一个 `walletNo: string` 字段，那样「至少 5 处」+ 本轮新绕开的这处能一次性全部改成 `${plan.walletNo}`，之后也不会再有人被迫在两个坏选项（UUID / 绕着说）里选 ｜来源: 2026-09-02 平账一期半 Task 11 评审顺带发现

- [ ] **几处注释与实现对不上**（2026-08-31 终审，同属"脚本不消费、没有机制会发现它错"那一类）：① `wallet-recon-run.service.ts:824-826` 称已解释差异行"标成 EXPLAINED，仍在案件页上看得见"——**案件页读的是 `flowComparison[].explainedByAdjustmentNo`，全仓没有任何一处读 `ReconciliationLineItem.status === 'EXPLAINED'`**（除 e2e 断言外无消费者），注释把展示来源说反了；② `adjustment.service.ts:368` 注释错引行号（说 `:181`，实为 `:323`），单测用例名抄了同一个错；③ `adjustment.service.spec.ts:46/57` 说走 `customerLabel`、实现走 `internalLabel`（对该成因恰好同值，所以断言绿着、描述是错的）；④ `adjustment-approval.service.ts:2` 与 `reconciliation.module.ts:23,26` 还写着"onApproved 本任务只留桩"，早已落地 ｜来源: 2026-08-31 整支终审

## B. 第一幕 · 开业（V1 治理底座 ｜ V3 财务配置 ｜ 账本）

> 讲「谁能做什么是拼包拼出来的、改任何配置都过审批」这一幕时会露的馅，按站排。

**站 2 · 一笔配置要过门（费率）**

- [ ] **报价落"资格快照"**：现 quote 仅存 `policyRef=LEVEL:code`；V3 要求成交时落 命中集合 + 选中级 + 选中理由(最低费) + 客户此刻标签快照（可解释/可申诉）｜来源: 2026-07-11 费率 V3 §4.4/§5.5

- [ ] **费率两族现网创建/落地审计的 afterData 仍写裸资产 UUID（种子三块 2026-09-06 小轮已换业务键，这两处是残余的另一半）**：`swap-fee-level-creation-workflow.service.ts:103-111`（CREATION_REQUESTED 与 :191 APPLIED 的 afterData 带 `fromAssetId/toAssetId`）、`withdrawal-fee-level-creation-workflow.service.ts:100-108` 同款带 `assetId`——管理台审计页按字面量渲染，触铁律⑥。修法同种子侧：落 afterData 前把资产 id 映射成 currency ｜来源: 2026-09-06 第一幕小轮 Task 6 复查（原合并条目销账时拆出）

**站 3 · 门自己也要过门（审批策略）**

- [ ] **`DEPOSIT_SUPPLEMENT`/`DEPOSIT_CLAWBACK`/`WITHDRAW_RETURN_CLAIM` 三类型是否该进 `V1_APPROVAL_ACTION_TYPES` 白名单，业主未定**：三者标签已备好（2026-09-07 界面收口轮补齐，见文末销账）但不在白名单里，审批策略管理页看不到这三行策略——是刻意（策略本身不需要在此页展示/编辑）还是遗漏，需业主拍板 ｜来源: 2026-09-07 界面收口轮 Task 16 收尾闸考古

- [ ] **治理域两个策略变更查询端点零前端消费方**：`approval-policy.controller.ts:80`（`GET .../approval-policies/change-requests` 列表）与 `:99`（`GET .../change-requests/:id` 详情）在删除 `/dashboard` 旧树与两张策略变更页后没有任何前端调用方——`admin-web` 全仓搜 `governance/approval-policies/change-requests` 零命中；现在提交变更走 `:61` 的 `POST :actionType/change-requests`（`ApprovalPoliciesPage.tsx` 在用），裁决走通用审批中心，这两个 GET 端点悬空。留作 API 或退役，待定 ｜来源: 2026-09-05 波二终审

**站 4 · 资产管控**

- [ ] 🎯 **新资产上线整条流程（未来）**：上币走开发流程——上币包配置（资产身份对齐 HexTrust 支持列表 + 账本科目 + 默认费率档 + 默认限额 + 价源）随版本装载并写发布标记审计；就绪检查（账本户 / 该链地址 / 费率档 / 限额四件齐）→ 运营提激活 → CISO 批；上新链时金库专员开该链地址（vault × 网络），上已有链的币零地址工作。2026-09-03 业主定本轮不做，V3 治愈波一把旧的建资产 / 上架 / 激活代码清干净 ｜来源: 2026-09-03 V3 体检讨论 + decisions 第四条

**站 5 · 三种门与容器（限额 / 托管钱包 / 提现地址）**

- [ ] **托管钱包页分组只按当前页数据分、非全量**：`CustodianWalletList.tsx` 把返回结果按 vault（F_OPS/F_SET/F_FEE/F_LIQ/CLIENT_DEPOSIT）在前端分组，只覆盖当次抓取的这一页；钱包总数一旦超过页大小，同一 vault 的行会跨页断开，出现重复或不完整的分组表头且不报错。页大小已从 20 提到 200（现状 19 个钱包：7 个平台位 + 每客户每网络一行 CLIENT_DEPOSIT，随客户增长自然涨，远低于 200）；钱包总数超过 200 时问题会复现 ｜来源: V3 财务配置治愈波一 Task 7 评审修复轮

- [ ] **`activateAddress` 是 `COOLING_PERIOD_NOT_EXPIRED` 唯一抛点，未来手动激活入口须补 DENIED 留痕**：`withdrawal-address-workflow.service.ts` 的 `activateAddress()` 直调主体层 `activate()`、没套 `recordDeniedAndRethrow`——今天仅有的两条调用方（cron 扫描 `WithdrawalAddressSweepService`、懒激活 `batchActivateExpired`）都已按 `activatesAt` 到期时间预过滤，撞不上这个五门码；但它是全仓唯一会命中 `COOLING_PERIOD_NOT_EXPIRED` 的调用路径，将来一旦加手动激活入口（如管理台按钮），必须仿照 `suspendAddress`/`skipCoolingPeriod` 套一层 `recordDeniedAndRethrow`，否则被拒的手动操作不会留痕，犯铁律①（见该方法上的注释）｜来源: 2026-09-05 波二终审

**账本与报表**

- [ ] **账本报表层四张视图待落地(2026-08-13，设计已定稿业主缓做)**：spec 见 `superpowers/specs/2026-08-13-ledger-reports-design.md`（暂扣构成日报/收入分类日报/在途冻结登记簿/VARA 收盘快照 + 通用快照表 + 对账 cron 前置步 + `LEDGER_REPORT_READ/WRITE` 权限）。业主 2026-08-13 拍板本轮只做 COA 更新（plan `superpowers/plans/2026-08-13-coa-v2-rollout.md`），报表层整体缓做；其中 B2 依赖 COA v2 先落、B4 依赖下条迪拜 COB 修正 ｜来源: 2026-08-13 账务深化脑暴，业主二次收窄

## C. 第二幕 · 迎客（V2 客户与合规）

> 讲「客户是谁、能不能交易由合规说了算」这一幕的缺口。入驻（波二）与档位升级（波三）已重建完成销账；剩销户清退与客户可见面。

**① 静态矩阵（客户列表）**

- [ ] **客户列表的「限制」筛选只作用于当前页(2026-08-16，设计已知取舍)**：`CustomerManagement.tsx` 的 Restrictions 列与 `Restricted/Unrestricted/Sanction only` 筛选，数据来自当页 20 行各拉一次 `GET /admin/customers/:customerNo/restrictions`（服务端列表 `GET /customers` 没有限制聚合字段，也没有批量端点）。因此筛选是**客户端**过滤，只筛当前页；翻页会得到"每页筛出的条数不一"的观感，footer 已明写 `(restriction filter applies to this page)`。真做法二选一：① `GET /customers` 的返回体加 `openRestrictionCount` / `hasSanction` 两个聚合字段并支持 `restriction=` 服务端筛选；② 加一个批量摘要端点 `POST /admin/customers/restrictions/summary` 收 customerNo 数组。demo 规模（8 客户）下当前实现够用，登记为账 ｜来源: 2026-08-16 客户生命周期轴+限制账 Task 12

- [ ] **机构客户 stub（现状口径已更正，非本波动作）**：`CorporateProfile`/`UboProfile` 两表已随站6（2026-08-27 一期拆除）整体删除——不是"表在逻辑无"，是表已不存在；`customerType='CORPORATE'` 现仅剩 `CustomerManagement.tsx` 筛选下拉与 `CustomerDetail.tsx` 两处死注释占位（`⑫ Corporate Profile`/`⑪ UBO List`，无渲染内容），入口仍是禁用状态。若要支持机构客户需从零设计数据模型，不是"接回"旧表 ｜来源: 2026-07-04 V2 体检 ｜ 2026-09-06 波一复核现状口径更正

**销户与材料（材料请求站）**

- [ ] ⭐ **Q2 销户流程只落了轴上位置**（`assertOffboardable()` 三条不变量断言已随 2026-09-06 波一死码清扫删除——零调用方死码，重建销户时按新 spec 立）：`OFFBOARDED` 是 `lifecycle` 终态。真正的销户流程——余额清退、材料归档留存期、审批链、客户侧发起入口——全部未做；管理台 Offboard 按钮当前是 disabled 占位（与下方「材料终拒 → 离场清退流程未接」并链——材料终拒是触发销户清退的另一条路径；波二（2026-09-07）新增第三条触发路径——高管拒收（`FINAL_REJECTED`）后客户滞留 `REJECTED` 未再重申，清退承接同归此缺口，三条记录指向同一个未做的销户流程）｜来源: 2026-08-15 设计稿 §8 Q2 ｜ 2026-09-07 波二追加高管拒收触发路径

- [ ] ⭐ **材料终拒 → 离场清退流程未接**（原「REJECTED 材料请求便签长期无人清理」缺口并入，背景见下）：2026-09-06 业主拍板"材料终拒出口 = 离场"（decisions.md 同日，行业口径 FATF 建议10——无法完成尽调即退出客户关系，条子挂着不处理本身是合规瑕疵）；本轮（波一）管理台客户详情页已展示「尽调未完成 · 待离场处理」文字提示（`CustomerDetail.tsx`，走查已验：Bob 的 EMIRATES_ID 材料请求打到终拒后文字出现），但实际的销户清退动作（余额清退 / 材料归档留存期 / 审批链）未做——与上方「Q2 销户流程只落了轴上位置」并链，是同一个未做缺口的两条触发路径（一条走 `OFFBOARD` 边、一条走材料终拒）。**背景（原条目内容）**：材料请求走到 `REJECTED`（RED·FINAL）是终态，但它挂着的便签不会自动撕（`MaterialRequestReviewService.applyReview()` 只有 GREEN 才 `autoRelease()`，两种 RED 都不撕是设计刻意），FINAL 是死路——客户唯一解法是靠运营再下发一次新材料请求或手工去限制账页面撕票，此前无 SLA/看板提醒运营处理 ｜来源: 设计稿 `superpowers/specs/2026-08-17-material-request-ledger-design.md` §9 Q3 ｜ 2026-09-06 波一并入销户缺口，管理台文字展示已补

- [ ] **Swap/Withdraw 页 `PendingActionBanner` 与 `RestrictionBanner` 对同一条挂限制的材料请求各显示一张卡，重复(2026-08-18 Task 14 真机截图发现)**：`PendingActionBanner.tsx`（本轮改读 `/client/me/material-requests`，按 G6 显示「挂了限制的」∪「没绑单的」）与 `RestrictionBanner.tsx`（读 `/client/me/restrictions`，显示所有 `visibility=DISCLOSED` 的 OPEN 限制便签，含 `PENDING_DOCUMENT`/`MATERIAL_EXPIRED` 因由）两个组件都挂在 Swap.tsx/Withdraw.tsx 顶部，对**同一张**挂了限制的材料请求各自渲染一张卡（真机截图实测：demo_alice 挂 `Source of Wealth`/`Liveness` 两条 BLOCKING 材料请求时，Withdraw 页顶部先出现 PendingActionBanner 的两张卡，紧接着 RestrictionBanner 又各出一张「DOCUMENT REQUIRED」卡，共四张卡描述两件事）。CustomerProfile.tsx 一侧的同类重复（`ProfileBannerStack` vs 旧 `PendingActionBanner`）已在本轮直接摘掉 Profile 页的 `<PendingActionBanner />`（该页material request 覆盖已在 Task 11 并入 `ProfileBannerStack`）；但 Swap/Withdraw 页没有 `ProfileBannerStack`，`PendingActionBanner` 仍是这两页材料请求的唯一入口，不能照样摘掉。`RestrictionBanner.tsx` 文件头注释明确写着"本组件只做一件事……禁止在这里补任何……推导逻辑"，本轮未touch该文件。修法待定，需要业主拍板：①`RestrictionBanner` 增加"跳过 cause∈{PENDING_DOCUMENT,MATERIAL_EXPIRED} 且已被材料请求覆盖"的过滤（对称于 Task 11 给 `profile-banners.service.ts` 加的 `claimedRestrictionNos` 去重，但这次要挪到 client 组件或后端 `/client/me/restrictions` 端点)；②或反过来让 `PendingActionBanner` 只处理未绑限制的提醒行，把"挂了限制"的展示职责完全交给 `RestrictionBanner` ｜来源: 2026-08-18 材料请求账 Task 14 真机截图验收发现

- [ ] **豁免位有效期**：poa/questionnaires 字段是否含提交时间戳待验；无时间戳则该档退回 tag + 我方管期限｜来源: 同上

**便签联动（tipping-off）**

- [ ] **Q1 制裁客户的订单级折叠未做**：本轮贴 `scope=ALL` 便签只把在途单打成 `FROZEN`，客户面靠服务端脱敏白名单收敛成 `COMPLIANCE_PENDING`；设计稿讨论过的「收单后一律挂 `PROCESSING`、连状态变化都不产生」的订单级折叠没做。与「提现域 tipping-off 未对齐」同源，一并排期 ｜来源: 2026-08-15 设计稿 §8 Q1

- [ ] **`CAPABILITY_RESTRICTED` 挂起原因区分不出 SANCTION 与 ADMIN_SUSPENSION，客户面一律藏**：`holdReasonOf()` 只按**哪一格 FAIL** 映射原因，拿不到便签的 `cause`；而客户面的可见性判据是「`limitHoldReason` 非空即整单不可见」，于是行政级挂起在**挂着的时候**对客户是零记录（退回落地才清、才可见，见 `modules/v4-deposit.md` §4.8）。保守是刻意的——tipping-off 的代价不对称（藏错了客户少看见一条记录，露错了是刑事风险）。要精确区分需让 `holdReasonOf()` 带上 `cause`，并给客户面定一套「哪些 cause 可见」的白名单 ｜来源: 2026-08-22 第四批 B4

- [ ] ⭐ **`AuthGuard` 里 `/wallet/send` 的受限重定向守着一条不存在的路由**：`client-web/src/components/AuthGuard.tsx` 有一段「WITHDRAW 受限时把 `/wallet/send` 重定向到 `/profile`」，但 `/wallet/send` 这条路由全仓不存在——受限客户真走到这一步会落到空路由。演示第二幕「现场给一位客户开限制」时是可能被点到的 ｜来源: 2026-08-16；2026-08-26 分流迁入 PRODUCTION-NOTES，2026-08-28 判为业务缺口迁回

## D. 第三幕 · 钱进（V4 充值）

> 讲「钱进来要闯几道门、闯不过去有四种下场」这一幕的缺口。最大一族是冻结动作的审计留痕——第七幕按单号拉链会当场露馅。

**冻结留痕（同族五条）**

- [ ] ⭐ **客户级冻结不留痕：两条独立路径都会漏审计，补 `select` 字段只治得了一条**：`findNonTerminalByOwner()`（`deposit-transactions.service.ts:1279`、`withdraw-transactions.service.ts:1053`，同一提交 `e198d11d7` 引入）供 `onCustomerRestrictionOpened()` 批量扫描客户名下在途单用，其 `select` 只挑了 `{id, xxxNo, ownerType, ownerId, status, traceId}`——**没选 `correlationId`**。这批对象随后原样传进 `depositAudit()`/`withdrawAudit()`，两者都读 `xxx.correlationId ?? undefined`（恒 undefined）；而 `DEPOSIT_FROZEN`/`WITHDRAW_FROZEN` 在名册里都注册成 `correlationMode: I`（INHERIT，必须继承旅程号），校验命中就抛 `BadRequestException`。**本轮 `demo:all` 实跑（2026-08-29）当场复现**：花名册 #7 制裁冻结那笔（`DEP2608292314`）被 `onCustomerRestrictionOpened` 扫到时，日志原样是 `Failed to write DEPOSIT_FROZEN audit for DEP2608292314 (restriction RST2608297325): Audit action DEPOSIT_FROZEN is INHERIT and must inherit an existing correlationId`——订单本身照常冻上（FREEZE 与审计各自独立 catch，冻结动作不受影响），但**这一冻结动作在审计链上永久查不到**。`withdraw-transactions.service.ts` 的同名方法字面同一个坑（同一提交引入），只是花名册没有任何一行经 `onCustomerRestrictionOpened` 批量扫到提现单（#19 MLRO 冻结是单笔 `dispoTag` 直冻，不走这条广播），所以本轮没有实跑复现，判定为静态确认。**对照**：`swap-transactions.service.ts:942` 的同名方法 `select` 里明确带了 `correlationId`，注释直接写"SWAP_FROZEN 是 INHERIT 码，信封不带旅程号会被机器闸拒收"——三域里唯一修对的是兑换域，充值/提现两个原地留坑。**后果**：任何客户级 ALL-scope 限制（制裁、行政停用……）广播冻单时，只要 `onCustomerRestrictionOpened` 扫到非终态单去执行 FREEZE，对应的 `DEPOSIT_FROZEN`/`WITHDRAW_FROZEN` 事件就写不进审计表——踩铁律①（操作必留痕），第七幕按单号拉全链会当场露馅（这一步"谁冻的、依据什么"查不到）。**路径一修法**：两处 `select` 各加一个 `correlationId: true`（对齐 swap 域已有的写法）。**路径二 · L1 单笔判定直接冻结时压根没调审计（静默，连 error 日志都没有，2026-08-29 合并前终审新查出）**：`deposit-workflow.service.ts` 的 `evaluateL1()`（由 `deposit.status.changed` 事件驱动，每笔充值单进入 `COMPLIANCE_PENDING` 时跑一次的客户级闸）判定客户命中执法级限制（`enforcement` 分支）后，直接 `updateStatus(FREEZE)`（`:292-299`），**全程没有任何 `depositAudit()` 调用**——不是调了失败，是压根没写这行代码；同一文件里结构对称的 `markL1Hold()`（行政级 `OPERATION_PENDING` 分支）就有配套的 `depositAudit({action:'DEPOSIT_HELD', ...})`，两个分支待遇不对称，独漏 FREEZE 这半边。**路径一的修法对路径二零作用**——给 `select` 加 `correlationId` 只能让路径一里已经存在的 `depositAudit()` 调用不再抛错，路径二从未走到 `depositAudit()` 这一步，没有调用可失败，必须在 `evaluateL1()` 的 FREEZE 分支单独补一次 `depositAudit()`（可照抄 `markL1Hold()` 的写法）。**比路径一更难发现**：路径一好歹在日志里留了一条 `Failed to write ... audit` 的 error，路径二连这行都没有——`FREEZE` 状态跃迁本身成功、`statusHistory` 正常记录，唯独审计表那一步凭空消失，日志层面没有任何异常信号。**本轮花名册 #10 实跑复现**（`DEP2608295862`）：`statusHistory` 能看到 `COMPLIANCE_PENDING → FROZEN`（operator `L1_GATE`），但按该单号查 `audit_log_events`，事件链从 `DEPOSIT_PAYIN_COMPLETED` 直接跳到 `DEPOSIT_SEIZE_REQUESTED`——中间这次冻结完全不在审计链上。**两条都是既有缺陷，本分支（`feat/demo-kit-sumsub-panel`）均未引入**：路径一根因 `e198d11d7`（2026-08-16）+ 审计调用 `250ec138e`/`a9c723d5e`（2026-08-20）；路径二根因 `1b06ed36d`（2026-08-22）；`git blame` 确认本分支在这些位置一行未碰——花名册 #10 只是第一次让路径二在标准演示动线里被真实触发（此前没有花名册用例走到"客户已被限制、新单进 L1 直接判 enforcement 冻结"这个分支）。**后果**：任何客户级 ALL-scope 限制（制裁、行政停用……）触发的冻结，不管是广播扫在途单（路径一）还是单笔 L1 直判（路径二），审计链都可能缺这一步——踩铁律①（操作必留痕）。第七幕按单号拉全链会当场露馅：花名册 #10 这条线是"客户被制裁冻结、资金随后上缴"，主持人讲完冻结接着讲上缴，中间那步冻结在审计链上直接跳过去。 ｜来源: 2026-08-29 演示装备一期复审 + `demo:all` 实跑复现（路径一）；路径二为 2026-08-29 合并前终审新查出、静态确认

- [ ] 🔴 **制裁冻结那笔充值的 `DEPOSIT_FROZEN` 审计写入失败（铁律①）**（2026-09-03 平账 A 批合并前跑 `demo:all` 逮到，main 四模块治愈批之后的现状）：Nest 日志 `ERROR [DepositWorkflowService] Failed to write DEPOSIT_FROZEN audit for DEP…（restriction RST…）: Audit action DEPOSIT_FROZEN is INHERIT and must inherit an existing correlationId`——`deposit-workflow.service.ts` 冻结分支（约 :2842 一带）的审计信封没带 `correlationId`，四模块批把 INHERIT 码的合同收紧后这条写入当场被拒；业务终态仍对（花名册 29/29 过），但"人被冻了、单被冻了，审计里查不到冻结"。**复现**：`reset self → up → on-stack self demo:all`，看后端日志或 demo:all 输出里的 ERROR 行；修法 = 冻结分支把 deposit 的 correlationId（同一文件其他 DEPOSIT_* 写点的取法）带进信封 ｜来源: 2026-09-03 平账 A 批收尾闸门（非本批引入，登记不修）

- [ ] ⭐ **`evaluateL1` 冻单零审计**：`deposit-workflow.service.ts → evaluateL1()` 命中限制账（`customerAccessService.resolve().blocked.has('DEPOSIT')`）直接 `updateStatus(FREEZE)`，只有 `logger.warn`，全程无 `auditLogsService` 调用——无论是否存在并发竞态都不写。与同一文件的 `onCustomerRestrictionOpened()`（批量冻单广播，本批已补审计）和提现域对应的 `assertCustomerComplianceOrFreeze()`（三处调用点均写 `WITHDRAW_FROZEN`）不对称，是充值域独有的缺口。**非本批引入**，实证发现于本批 ｜来源: 2026-08-20 制裁分主体批次

- [ ] ⭐ **L1 的 `FROZEN` 分支不写审计，与本批新增的挂起分支不对称**：`evaluateL1()` 的执法级分支（`releasePolicy === 'MLRO_APPROVAL'`）只有 `logger.warn` + `updateStatus(FREEZE)`，无 `auditLogsService` 调用；而本批新增的 `markL1Hold()` 走 `recordStateTransitionAudit()`、放行分支写 `DEPOSIT_GATE0_PASSED`——三条分支里**只有冻结这条没有审计**。**非本批引入**（既有缺口已登记在上方「制裁命中分主体」节的「`evaluateL1` 冻单零审计」条），但本批把不对称放得更明显了，一并在此交叉引用，归审计专项那一轮统一清 ｜来源: 2026-08-22 第四批 B4

- [ ] **上面两条记的是「压根没调审计」，这条是「调了但静默写失败」——同样查不到，根因不同**：`onCustomerRestrictionOpened()`（`deposit-workflow.service.ts:2812`，批量冻单广播）**确实**调用了 `depositAudit({action:'DEPOSIT_FROZEN', ...})`（:2841），但那次调用被自己的 `.catch()`（:2848-2854）单独包住，失败只打 `logger.error`、不抛出、不影响主流程——2026-08-20 的记录把这条算作"本批已补审计"，实际只是"补了调用点"，**没有验证过这次调用真的成功落库**。2026-09-02 `demo:all` 花名册 #7（充值·制裁冻结）真机实测复现：backend 日志一条 `ERROR [DepositWorkflowService] Failed to write DEPOSIT_FROZEN audit for DEP...: Audit action DEPOSIT_FROZEN is INHERIT and must inherit an existing correlationId`——`depositAudit()`（:1889）把 `correlationId` 直接读自传入的 deposit 行对象 `deposit.correlationId`，这次为空，撞上 `audit-logs.service.ts:933-937` 的 INHERIT 校验直接 400，被外层 `.catch` 吞掉。后果：这笔冻结审计页按单号查不到 `DEPOSIT_FROZEN` 记录（状态确实是 FROZEN，只是留痕断了）。**复现**：`bash scripts/on-stack.sh self demo:all` 后 grep 后端日志 `Failed to write DEPOSIT_FROZEN audit`，或按 `depositNo` 查审计页确认该记录缺失 ｜来源: 2026-09-02 Task 31 收尾闸/走查前置的 `demo:all` 基线跑批实测

**四条弧与详情页**

- [ ] ⭐ **`linkedFundOrders` 的 `kind` 把没收/退回/上缴三条弧全部误标成同一个 `CONFISCATION`（Task 8 真机渲染发现的真 bug）**：`deposit-transactions.service.ts`（约 L201）`isConfiscation = fo.legSeq != null && fo.legSeq > 1` 只按"是否 legSeq>1"二分，把 legSeq=2（没收动腿）/legSeq=3（**计划2·A3 退回**动腿）/legSeq=4（**计划2·A4 上缴**动腿）全部归为 `kind: 'CONFISCATION'`；前端 `DepositTransactionDetail.tsx:543` 相应把三者的 "Linked Funds Orders" 卡片全部渲染成 `Fee · Confiscation`。Task 8 真机渲染验证时在一笔真实 SEIZE（政府上缴）流程里截图证实：legSeq=4 的资金单被标成"Fee · Confiscation"，对 operator 是误导性文案（这是政府移交，不是没收手续费）。**渲染层已把关的其它维度不受影响**（状态徽章/门控/Sumsub 引用区/演示面板均正确，只有这一处 kind 标签是历史遗留，早于本轮但被本轮新增的 legSeq=3/4 弧放大暴露）。修法：`LinkedFundOrder.kind` 类型 + 后端判定逻辑改按 legSeq 精确映射（2→CONFISCATION，3→RETURN，4→SEIZE），前端 `cap` 文案随之加 `RETURN`/`SEIZE` 两个新分支 ｜来源: 2026-07-29 Task 8 真机渲染验证发现，按硬约束未修（渲染暴露的真 bug，停手报告）

- [ ] ⭐ **充值详情页通用 Actions 组在终态仍全显（pre-existing）**：`DepositTransactionDetail.tsx` 的通用 Approve/Freeze/Resume/Expire/Reject/Confiscate 组当前仅对 below-min 挂起 + 没收生命周期(CONFISCATING/CONFISCATED)隐藏；**SUCCESS/FROZEN/REJECTED 等其它终态仍全显 6 个按钮且可点**（点了会被后端状态机/治理守卫拒，非资金安全问题，纯 UX 误导）。根因=该组无"终态即隐藏"门控（D8 只加了 `!isBelowMinPending`，2026-07-17 没收轮补了 `!isConfiscationLifecycle`）。彻底修=按 deposit 是否终态统一门控通用组 ｜来源: 2026-07-17 没收异步 C5 实景截图发现（pre-existing，早于本分支）

- [ ] **Internal Approvals 深链只到列表页（新，2026-07-30）**：详情页 "Internal Approvals" 块点击只跳审批列表 `/admin/governance/approvals`，无法深链到具体审批单——因 `findOneForAdmin` 的 `approvals[]` 投影只 pick `{approvalNo,actionType,status,createdAt}`（业主定"仅单头"），丢了审批 case `id`；审批详情路由/列表筛选又都按 `id`/不读 `approvalNo` query。修法：投影补回 `id`（`id` 是 case 主键、非 step，不违背"仅单头不含 step"），前端深链 `/admin/governance/approvals/<id>`｜来源: 2026-07-30 Sumsub 详情增强 Task 6 review

- [ ] **`LIFECYCLE_NOT_ACTIVE` 挂起的单，若客户还没有 `sumsubApplicantId`，永远等不到裁决**：`submitSumsubTxns()`（`deposit-workflow.service.ts:345-351`）在 `deposit.customer?.sumsubApplicantId` 为空时直接 `logger.warn` 后 `return`——单子留在 `COMPLIANCE_PENDING`，但从未真正提交 Sumsub，也就永远不会收到裁决 webhook。这类单唯一的出路是运营在详情页用 ⚡ 面板对着 `COMPLIANCE_PENDING` 的单直接喂一个「① Approved」裁决（`decideVerdictLanding`/`applyKytApproved` 只按当前状态判定是否派发，不检查是否真的送过检）——裁决落地时 `limitHoldReason` 仍是 `LIFECYCLE_NOT_ACTIVE`（行政级，在 `ADMINISTRATIVE_HOLD_REASONS` 里），经 `holdIfHeld` 转 `OPERATION_PENDING`、挂起原样保留，交还运营再处置。"客户还没在 Sumsub 开户"不是刁钻边界，是会正常发生的客户状态，值得配一条脚本或至少讲清"这条路只能靠运营手动喂裁决" ｜来源: 2026-09-05 V3 财务配置治愈波二 Task 13 文档收口核对 L1 挂起链路时发现

- [ ] **TR 适用判定未自动计算**：充值 PRD 定义 Travel Rule 适用 = 虚拟币 且 来源地址为 VASP 托管 且 单笔 ≥ 3,500 AED（三条件 AND，否则 NOT_REQUIRED）；现状仅条件①法币→NOT_REQUIRED 落地，条件②(hosted/unhosted VASP 分类，依赖 roadmap V3 地址打标)+③(3,500 阈值判定)**代码未自动计算** → crypto TR 结果当前由 demo 模拟端点注入 ｜来源: 2026-07-11 充值 PRD v2

**没做的自动化（现全靠人工）**

- [ ] **BELOW_MIN 计次自动冻结未做**：同客户多次触发 below-min 挂起累计到阈值后自动转 FROZEN（防试探式小额充值绕限额）未实现，本轮只做单笔挂起+人工处置 ｜来源: 2026-07-16 deposit-min spec §8（deferred）

- [ ] **自动没收 cron 未做**：BELOW_MIN 挂起超时后自动发起没收（现只能 ops 手动点 Confiscate）未实现 ｜来源: 2026-07-16 deposit-min spec §8（deferred）

- [ ] 充值挂起（`DEPOSIT_HELD_NOT_TRADING_READY`）无自动重驱：客户补齐法币地址后，挂 COMPLIANCE_PENDING 的充值不会自动重跑 checkAutoApproval → 需 hook `ADDRESS_ACTIVATED` 重驱该客户挂起充值，否则要人工 ｜来源: 2026-07-11 Task 4b

## E. 第四幕 · 钱换（V6 兑换）

> 讲「一次兑换四条腿原子记账」这一幕的缺口。

- [ ] ⭐ **兑换 `PROCESSING` 在途单碰冻人广播仍走 `needsReview` 旗，运营分不出"技术卡单"与"人被冻结"**：`onCustomerRestrictionOpened()` 对处于 `PROCESSING`（腿已开跑）的兑换单只调用 `assertSwapCustomerAccessOrHalt()` 停腿 + 打 `needsReview`，与腿失败自愈耗尽的 STUCK 单共用同一面旗子、混在同一个卡单堆里，旁边挂的还是同一个 Resume 按钮——运营在列表页无法区分"这单是技术卡住待人工重试"还是"这个人被制裁冻结了，Resume 是错误动作" ｜来源: 2026-08-20 制裁分主体批次

- [ ] 无自动 FAILED 状态机：腿失败走自愈→STUCK(needsReview)+手动 resume，swap 留 PROCESSING，无终态失败（设计 deferred）｜来源: 2026-07-04 V6 体检

- [ ] **兑换时间线 `operator` 恒为 `'SYSTEM'` 字面量**（`swap-transactions.service.ts` 的 statusHistory 写入点硬编码），时间线永远看不到是谁操作的 ｜来源: 2026-08-23 第五批 Task 3

- [ ] 兑换成功通知未接（SUCCESS 时不调 Notification）｜来源: 2026-07-04 V6 体检

- [ ] **兑换 resubmit 分支给重提的单子近乎零宽限（唯一没遵守"计的是在这个状态待了多久"的地方）**：`swap-sla.service.ts:73-78`——`sumsubTxnIdOut` 为空时补提交一次然后 `continue`，**不动 `slaDeadline`**（此刻它已经是过去时刻）。下一轮 sweep（30 秒后）看到 `sumsubTxnIdOut` 已有值，直接判超时拒单——Sumsub 实际只拿到 30 秒而不是 5 分钟。旧的 `createdAt` 口径下形态相同，**不是本批引入的回归**；但本批刚立了"deadline 计的是在这个状态待了多久"的模型，这个分支是三域里唯一没遵守它的地方。修法一行：补提交成功后顺手把 `slaDeadline` 往后推一个完整窗口（`resolveSlaFields(COMPLIANCE_PENDING)` 或等价写法）｜来源: 2026-08-21 SLA 批次

- [ ] **兑换域规则清单与阈值**：另起规则目录文档，含排雷（含 rejected 计数 / 缺 .notRejected 的聚合规则会造成
      「被拒→加分→再被拒」死循环）｜来源: 同上 §7
> 注：swap 腿 InternalFund 命名债已并入下方「平账处置」的 funds-orders 域 RBAC 命名债条目，不重复登记。

## F. 第五幕 · 钱出（V5 提现）

> 讲「出金门最多、客户永远看不到调查原因」这一幕的缺口。⭐ 那条正是这一幕的卖点本身在提现域没落实。

- [ ] ⭐ **规则 A（tipping-off 防线）只在充值域落实，提现域有一模一样的洞未堵**：`withdraw-transactions.service.ts → toCustomerWithdrawView()`（约 L357-380）原样返回 `status: item.status`/`completedAt: item.completedAt`——一笔被 `adminFreeze` 打成 `FROZEN` 的提现，客户端 DevTools → Network 面板可直接读到裸 `'FROZEN'` 字符串（对照充值域 `deposit-transactions.service.ts → toCustomerDepositView()` 已有的 `CUSTOMER_STATUS_PASSTHROUGH` 白名单收敛 + `CUSTOMER_COMPLETED_STATUSES` completedAt 独立白名单，见 modules/v4-deposit.md §4.6）；`findAllForCustomer()`（约 L333-339）把客户传入的 `query.status` 直接转发进 `findAll()` 的 where 条件，无 customerScope 收窄——`GET /client/withdraw-transactions?status=FROZEN` 本身就是一个可用的冻结预言机（对照充值域 `findAll()` 在 `customerScope` 下已静默忽略原始 `status` 参数）；前端 `client-web/src/pages/Withdraw.tsx → HISTORY_STATUS_FILTERS`（约 L105-115）仍是裸 status 列表式筛选（`statuses: ['PENDING_APPROVAL','COMPLIANCE_PENDING','MANUAL_CHECKING','FROZEN','PAYOUT_PENDING']`），未跟进充值域已切换的 `bucket` 补集式设计（§4.6）。本条不是回归——提现域这套字段白名单本就早于充值域上线（Task 11 只做了字段裁剪，未含 status/completedAt 收敛），deposit-action-embed 分支只是把充值域这道防线补完，两域因此出现不对称：modules/v4-deposit.md 与代码注释里写的"规则 A"读起来像平台级不变量，实际只在充值域落实。仅登记，本分支未改提现代码 ｜来源: 2026-08-05 deposit-action-embed 分支终审 Important 3

- [ ] **提现报价审计未落地**：报价流程（`WithdrawQuoteService.createQuote/consumeQuote/cancelQuote`）零打点——常量 `WITHDRAW_PRICING_QUOTE_CREATED/_USED/_CANCELLED`（entityType `WITHDRAW_PRICING_QUOTE`）已定义但 `withdraw-quote.service.ts` 从不调用（grep 实证 0 命中，该文件无任何 audit 引用）；对比兑换 `SWAP_QUOTE_CREATED/USED/CANCELLED` 已在 `swap-quote.service.ts:249/319/364` 落地。应补打 QUOTE_CREATED/USED/CANCELLED（workflowType `WITHDRAW_QUOTE`），与兑换对齐 ｜来源: 2026-07-11 提现报价单文档 v2 §4.1.3

- [ ] 提现成功通知未接：SUCCESS 时不调 `NotificationsGateway`（基础设施在、workflow 没调）｜来源: 2026-07-03 V5 体检

## G. 第六幕 · 账对（V8 对账 ｜ 平账处置）

> 讲「对不上的怎么处置」这一幕的缺口，按演示场景号排；底盘与留痕类殿后。

**场景 1 · 推单**

- [ ] **swap 腿推单未支持**：通用推单按钮（`/admin/funds-orders/:no/push/sync|manual`）明确排除 swap 腿——`advanceByNo`/编排服务见 `swapTransactionId` 非空即拒（现有先卖后买顺序守卫防线），且回填 effectiveDate 需再穿透 swap 4 腿两阶段记账链（工作量≈deposit+withdraw 之和）。swap 腿卡单本期走 **Swap 详情页 `advanceLeg` 专用推进**（带顺序守卫），但该路径**暂无 effectiveDate 回填** → 推完历史那天快照修不平 ｜来源: 2026-07-03 推单 plan 落地发现（spec §2/§8）｜下期：swap workflow 记账链穿透 effectiveDate + 推单接 swap 腿

- [ ] **推单页对内部划转腿要么显式拒、要么修方向标签**（2026-09-05 平账二期终审裁定）：在途案「去推单」链接对划转腿可达，`push-order.service.ts` 只拒兑换父单；推它不会重复落账（落账单点在划转工作流的 CONFIRMED 事件处理，与推单驱动已有 already-terminal 容忍），但回执视图会把划转腿方向误标成 IN——沿兑换先例显式拒（"划转腿资金单请走划转单详情页"）或补方向分支 ｜来源: 平账二期 Task 2 评审发现、终审裁定 BACKLOG

**场景 8 · 改记**

- [ ] **改记换主后，对正主方没有合规复核**（2026-09-02 平账一期半新增）：改记（`CUSTOMER_REATTRIBUTION`）把一笔钱从错记方名下改到正主方名下，**放行依据是「记在错记方名下的那张原始充值单 KYT 已经跑过」**（与一期调账单边界线同源——有原单 ⇒ KYT 对这笔钱跑过），本轮**不重跑 KYT**。但那次 KYT 跑的是**错记方的身份**：真正持有这笔钱的正主方，从来没有被就这笔资金筛查过。业主 2026-09-01 拍板本轮这么放行、缺口登记在案。修法方向（下一轮/合规域定）：换主落账后对正主方补一次 KYT/制裁筛查，或至少在正主方的合规档上留一条「因改记获得资金 X，原单 KYT 结论沿用自客户 Y」的可追溯记录 ｜来源: 2026-09-01 平账一期半 spec §6 合规口径

**场景 9 · 跨日切（业务日口径）**

- [ ] **业务日期按 UTC 切、非迪拜 COB(2026-08-13，财务硬需求)**：`src/modules/accounting/tigerbeetle/utils/business-date.util.ts:2` 的 `toBusinessDate` = `toISOString().slice(0,10)`（UTC 日历日 = 迪拜凌晨 4 点切日），迪拜时间 1 月 5 日 02:00 的交易记成 1 月 4 日的账。业务方邮件明确要求"固定迪拜 close-of-business 截止、对前一日收盘位"。须定义迪拜 COB 时点并改切日逻辑，影响 effectiveDate 盖章与对账截止过滤（`effective-cutoff.ts`）；历史 effectiveDate 存量口径切换需评估。不依赖 COA v2，可单独先修 ｜来源: 2026-08-13 COA v2 设计对话中代码实证（spec §7）

- [ ] **effectiveDate 语义待核**：应 date(价值日) + 独立 createdAt(datetime) 两字段两用途；需核 `effectiveDate` 是否 date-only、截止边界卡点是否用 createdAt ｜来源: spec §2.4

**场景 13 · 补录**

- [ ] **① 漏记入金补录：小额（低于该资产 DEPOSIT 单笔下限）CFO 批完不会自动到 SUCCESS，案子这一轮愈不了**（2026-09-04 平账 B 批 Task 8 e2e 实证）：`prisma/seed.business.ts` 给每个资产的 DEPOSIT `SINGLE_LIMIT` 都挂了下限（AED/USDT 现为 100）；补录信号建单时（`detected()`）金额低于这条线会带上 `limitHoldReason=BELOW_MIN`，即便运营发起补录、CFO 也在 `DEPOSIT_SUPPLEMENT` 审批里批准了，充值单入账唯一出口 `approveDeposit()` 仍会照下限单的老规矩把它按到 `OPERATION_PENDING`（不是 `SUCCESS`）——这一路的「重对账后案子愈」因此不成立，得再等运营在充值详情页点一次既有的「放行下限挂起」（`waiveLimitHold`）才走完。不是死路、也不是新缺口（下限闸是既有设计，补录只是撞上了它），但"漏记的往往是零头"——这正是"漏记入金"补录场景最典型的金额区间，补录闭环的演示脚本/文档若不点名这个额外步骤，讲这一幕时会卡在"怎么案子没愈"｜来源: 2026-09-04 Task 8 e2e 用真实 61 USDT 金额跑通 ①a 时当场复现（改用 150 USDT 绕开，未改代码）

- [ ] **补录被拒后，客户自己重新申报同一笔汇款会被系统默默吞掉**（2026-09-03 平账 B 批 Task 5 评审发现）：运营发起的漏记入金补录若被 CFO 拒绝，那条差异行对应的申报记录会留在「已拒绝」状态占着这笔汇款的登记位；此后如果客户自己在客户端就同一笔汇款重新提交「我打了这笔钱」，系统会把它当成重复申报直接忽略——界面显示提交成功，但既不会新建记录、钱也不会入账，客户和运营都不会收到任何失败提示，只会看到钱一直没到账却查不出原因。控制方裁定本批不修（超出补单三入口半径） ｜来源: 2026-09-03 平账 B 批 Task 5 评审发现

**场景 16 / 17 · 补款与垫款**

- [ ] **法币补款腿 2 失败后款项停在结算户**（2026-09-05）：腿 1 已落账、账与钱一致，订单 FAILED，人工处理，不做自动退回 ｜来源: 平账二期 spec §3

**场景 18 · 事故登记**

- [ ] **大额查不出（LARGE_UNEXPLAINED）事故定损后，钱这条腿没有出口——事故永远关不了**：查不出的差异超小额线 → 升级事故 → 调查 → 定损（口径=公司承损）都通，但之后开不出认损/核销调账单：案件行 `nextStep` 恒为 `INCIDENT_DEFERRED`（只渲染事故徽章，`reconciliation-query.service.ts:513`），后端两道闸也都拒——普通核销路卡小额线（`adjustment.service.ts:164` 报错还指路"register an incident instead"，成环）、事故路只认定性行出口 = `INCIDENT`（即只有未授权转出，`adjustment.service.ts:146`）；于是善后单挂不上、事故到不了 RESOLVING、结不了案，对账案子长红且无出路。spec 承诺的善后口径是"仍不明则认损 / 核销"（`archive/superpowers/specs/2026-09-03-incident-register-design.md` §型录表），机制没人建；18 个演示场景没有一个走这条路（10=公司池小额、16=客户池小额、18=未授权转出），故三期验收没照到。复现：main 上任一客户/公司钱包铺一条超线查不出差异 → 挂起 → ⚡拨钟超期 → Escalate to incident → 定损 FIRM_LOSS → 回案件页无「Recognize loss/Write off」按钮，事故页 Request Close 恒灰（2026-09-08 实跑 REC20260908-001 / INC260908436826 实证）｜来源: 2026-09-08 平账走查模拟

- [ ] **事故通报超时无持久软标与审计**：spec §2 曾承诺超时软标+审计，实现为界面倒计时徽标（前端算），十一码名册（业主拍板）无超时码位，补齐须业主扩名册；演示不演超时，缺口不影响本波验收 ｜来源: 2026-09-06 平账三期终审

- [ ] **incidents 表三根低写入列**：customerId / sourceExternalLineId 零写入方、walletRef 仅 DTO 通道，下次动 incidents schema 时清理或接上真实写入 ｜来源: 2026-09-06 平账三期终审

**无主入金（成因菜单上有、出口没有）**

- [ ] **无主入金查不出归属，超期没有退回付款方的出路**（2026-09-03 平账 B 批）：`UNCLAIMED_INFLOW`（外有我无 × 公司格）成因菜单查证结论是"归属排查中"——查出是客户的转补单、查出是公司的走补记，但排查不出来时（既不是任何客户、也不是公司已知收支）行业惯例是账龄到期后原路退回付款方，本系统今天没有这个出口，只能停在「挂起·调查中」，无自动 / 半自动的退回操作 ｜来源: 2026-09-03 平账 B 批 spec §10

**处置面还欠的**

- [ ] ⭐ **真差异(BREAK)处置闭环：十件处置全部交付**（2026-09-06 平账三期：事故登记补齐最后一件）
  - **已交付**：推单 ｜ 冲正 ｜ 冲销 ｜ 补记（一期，2026-08-31）｜ 改记（第四族，借错记方应付 / 贷正主方应付、资产腿不动、一单双案同愈）｜ 挂起（等下期 / 调查中，零账务，案子仍红）｜ 核销（公司池；四前提 + CFO）｜ 补单（三入口：充值补录 / 退汇认领 / 退回认领，案子上发起、CFO 单步复核、业务域执行、重对账自愈，2026-09-03 平账 B 批）｜ **划转**（认损补款 / 退汇垫款，第四类订单，法币两腿经结算户 / 加密币一腿，2026-09-05 平账二期）｜ **事故登记**（未授权转出出口 / 大额到线升级 / 退汇欠款登记三类入口，五态生命周期 + 双类型结案审批，全程零账务，2026-09-06 平账三期）。入口统一为「先定性（从该格成因菜单选查证结论）→ 注册表判出口」，**「不该动账的行显示错误按钮」那个缺陷随之消失**——2026-08-31 记的「指出来、不点」演法已作废
  - 豁免 / 容差 **不做**（decisions 2026-09-02，精度一致）；aging 已做（3 天，标记 + 审计 + 解锁）
  - ~~**三期**：事故升级（`UNAUTHORIZED_OUTFLOW` 本轮只能留档）~~ —— 已解（2026-09-06 平账三期）：见文末销账「三期 · 事故登记」
  - **仍 deferred**：COMPENSATING 里"真两侧对冲错"的调账（matcher 调优部分不算）；Finance 人工核实 → 结案 ｜来源: spec §9，2026-09-05 平账二期收尾更新

- [ ] ⭐ **对账复核签核未做**：应干净 run 自动认证 + 人工平账动作走复核签核(maker-checker 推≠批，可按 severity 分级)；复核挂"人工干预动作"、非挂"run 变 pass"。与「平账处置」推单读权限门控债协同(那条=权限粒度、本条=两人复核)｜来源: spec §6

- [ ] **手续费归集不做，等报表层**（2026-09-05 平账二期 F1'）：账上等于收入结转进运营户，可做；但收入户兼作钱包位置，归集后余额清零，没有报表层时观众读不出本期收入 ｜来源: 平账二期 spec §0

- [ ] **内部划转单路由前缀 `treasury/` 与 Custody 组其它页 `custody/` 不一致**（2026-09-05）：侧栏同组、路径两个前缀，纯 IA 债；改动要连动案件页 / 审批回链 / 资金单回链四处写死的链接，单独一次收 ｜来源: 平账二期 Task 13 评审、终审裁定 BACKLOG

**对账底盘**

- [ ] ⭐ **数据完整性闸 + HELD 态未做**：无"数据到齐才对"闸、无 `HELD`(待外部数据)态；即时轨道周末结算 / 账单延迟会被误判假 BREAK（结算轴 ≠ 上报轴）。与 2026-07-06「external_balances 驱动静默漏对」同源（该条=现状症状、HELD=应然解）：应以内部钱包名册枚举、缺外部数据标 HELD 而非跳过/硬对 ｜来源: spec §2.6

- [ ] **对账钱包枚举由 external_balances 驱动、缺外部快照的客户钱包静默漏对** — `wallet-recon-run.service.ts` 的 run 钱包遍历以 external_balances 行为键；某客户钱包当天缺外部快照即被**静默跳过**、不进对账也不报异常，"full list" 完整性靠外部数据源自觉而非内部账户名册驱动。修法：以内部客户钱包名册为枚举源、外部缺行标 MISSING_EXTERNAL 而非跳过 ｜来源: 2026-07-06 V8 遗漏审计（对抗核验读代码逮到）

- [ ] **流水 match tag 结转未做**：行项每 run delete-then-insert 全量重配、无持久行状态；应 Reconciled 冻结踢出、只对未决+新增。上文「reObservedCount 恒为 0」是无持久行状态的同源症状。⚠ **落地时字段名用 `reconciliationStatus`（Reconciliation Status，业主定名），枚举 `Open / Reconciled / In-transit / Exception`**（PRD §5.2 已定，勿再叫 tag / UNRECONCILED / OPEN_EXCEPTION）｜来源: spec §0.5/§3.2 + 2026-07-13 PRD 命名

- [ ] 🐛 **`reObservedCount` 恒为 0**：line item 每 run delete-then-insert，`foundByRunId` distinct 恒 1 → 观察历史"复观察次数"永远 0；正确修法需 `reconciliation_cases` 加专用计数列（`upsertCaseForWallet` existing 分支 +1）；代码已加 KNOWN LIMITATION 注释（`reconciliation-query.service.ts`）｜来源: 2026-07-04 V8 体检（Round3 遗留）

- [ ] ⭐ **INTERNAL_BREAK run 详情误显示空表**：预门破时 `walletCount=0`/空表 → UI 显示成空/像干净(危险)；应专门呈现恒等破裂明细(按币种 资产合计/负债合计/差额) + "逐钱包未执行"提示；数据已被预门 breaks[] + 审计捕获，缺前端呈现 ｜来源: spec §1.4

- [ ] **严重度分级跨资产不可比**（2026-09-02 平账 A 批发现）：`wallet-recon-run.service.ts` `computeSeverity` 用「最小单位 1 万」一个数——AED 是 100 元、USDT 是 0.01 元。本批「金额小」另立小额线（`recon-thresholds.constant.ts` 按币种），未借用严重度；修法：severity 阈值按币种进同一张常量表 ｜来源: 2026-09-02 平账 A 批 spec §0-12

- [ ] **canonical-minor 展示层 re-pairing 未传 decimals**：`reconciliation-query.service.ts` `buildFlowComparison()` 的 `matchFlows` 调用暂传 `decimals: 0`（identity 换算，保持 Case 详情流水比对页现状不变），TODO 标记待 Task B 补该 case 资产 `asset.decimals`｜来源: 2026-07-04 canonical-minor Task A（Task B 收口）

**留痕与手册**

- [ ] **`RECON_CASE_OPENED` 审计 metadata 仍带 `walletRef`（内部 UUID）**（2026-09-03 平账 A 批终审）：`wallet-recon-run.service.ts` 开案审计的 metadata 直接放 walletRef；本批新增的两条账龄审计已改用 `walletNo` 业务键，开案这条应对齐（子主体已是业务键，只是 metadata 漏了）｜来源: 平账 A 批终审 triage

- [ ] **财务查证手册「§四 附：演示场景对照」落后三波**：附录仍写 15 场景 10 案（一期半时代），现状是 **18 场景 12 案**（A 批 +账龄核销、B 批 +13/14/15、二期 +16/17、三期 +18 未授权转出）；场景号-成因码-处置-能不能平四列都要按 `scripts/recon-demo.ts` 现行 manifest 重排——演示者按号索引会翻错页。手册正文各节已随波收口，唯此附录三波没人回头 ｜来源: 2026-09-06 平账三期终审建议单独清理

- [ ] **调账单的边界线守卫只查原单「存在」，不查「归属」** —— `adjustment.service.ts` 的 `relatedOrderExists()` 按单号在充值/提现/兑换三表查存在性即放行，**不校验这张单是不是本案客户的**。刻意划在这儿：spec §4 立的规则是「有原单 ⇒ KYT 已对它跑过」，存在性就是这条规则的字面内容；要「引错别人的单」成为问题，前提是操作员恶意，那落在 CLAUDE.md §3「管理员都是善意的」与禁做清单「边界防御」里。存在性检查已堵死 spec 点名的「凭空造钱」，剩下的是引错凭证的数据质量问题、不是闸门被绕。**留此一行是为了日后评 PRD 时不被当成遗漏** ｜来源: 2026-08-28 平账一期末站评审

## H. 第七幕 · 事后说得清（审计追溯）

> 讲「这笔事谁批的、依据什么、钱去哪了」这一幕的缺口。三域词表已换装，剩子表覆盖面与资金单审计栏。

- [ ] ⭐ 🔴 **`audit_log_subjects` 子表覆盖面远小于设计前提，45 码里只有 ~7 码真正在用子表**：设计稿 §5.1 的立论前提是"一对 primarySubjectType+primarySubjectNo 装不下多主体，需要子表"，但 Task 11 端到端实测（真实 API 驱动 admin 停用/恢复/角色定义创建等流程）坐实：只有横切的 6 个 `APPROVAL_*` 码（经 `approvals.service.ts`）与 `AUDIT_LOG_QUERIED`（且仅当查询带 `ownerCustomerNo` 参数时）会调用 `persistSubjects` 写子表；其余 IAM（`ADMIN_INVITE_*`/`ADMIN_FIRST_LOGIN_*`/`ADMIN_ROLE_CHANGE_*`/`ADMIN_SUSPENSION_*`/`ADMIN_REACTIVATION_*`/`ADMIN_PASSWORD_RESET_*`/`ADMIN_MFA_RESET_*`/`ADMIN_ACCOUNT_LOCK_*`，共 25 码）与 CONFIG（`ROLE_DEFINITION_*`/`APPROVAL_POLICY_CHANGE_*`，共 8 码）、以及 `AUDIT_EVIDENCE_EXPORT_*`（3 码）在各自的 workflow service 里 `recordByActor`/`recordSystem` 调用**从不传 `subjects:` 数组**——只设置主表扁平字段。实测复现：`admin-suspension-workflow.service.ts` 让 `ADM2501010008` 挂了 4 条事件（`ADMIN_SUSPENSION_REQUESTED`/`APPLIED`、`ADMIN_REACTIVATION_REQUESTED`/`APPLIED`）的 `primarySubjectNo`，但 `SELECT COUNT(*) FROM audit_log_subjects WHERE subjectNo='ADM2501010008'` = 0，`GET /admin/audit-logs?subjectNo=ADM2501010008` 实测返回 `total:0`（必须改用 `primarySubjectNo=` 才能查到同样 4 条）。**验收标准 #6"按依据查得到"字面上仍算通过**（该标准原文限定的是"按审批单号"，approvals.service.ts 那 7 个码确实覆盖了），但设计稿 §5.1 举的例子（"充值单"为 PRIMARY、审批单只是其中一个 INSTRUMENT）说明子表原意是覆盖**所有** V1 主体，不是只覆盖审批单号——按这个更完整的意图，"某个 admin 用户/某条角色定义从生到死被谁碰过"这条监管索档能力目前并不成立。修法：把这 36 个码所在的 8 个 workflow service 补上 `subjects:` 数组（多数只需 1-2 行，模式已有 `approvals.service.ts` 可抄）｜Task 11 端到端验收实测新发现，无历史来源

- [ ] **Q4"按客户查全部"目前唯一的数据来源是查询动作自证**：`verify:audit` 的 Q4 判据（`M>0`）能通过，靠的是 `GET /admin/audit-logs?ownerCustomerNo=X` 这个查询动作自己把 `AUDIT_LOG_QUERIED` 记成 `OWNER=CUSTOMER`，即"查询这个动作本身构成了它所验证的证据"。这不是 `verify-audit.ts` 脚本的缺陷（脚本按 brief 逐字实现，且经变异测试证明能正确识别数据缺陷），而是**V1 治理域现实中没有任何其它场景会把 CUSTOMER 设为某条治理事件的 OWNER**（V1 域本身不直接操作客户实体，客户只会通过"查询时按客户号过滤"这一条路径进子表）。换言之，Q4 目前只证明了"查询行为自身可追溯"，不能证明"客户被牵连在其他 V1 治理动作里时可追溯"——因为 V1 域里后一种场景目前不存在，等三个交易域（充值/提现/兑换，这些才会有 `ownerCustomerNo` 意义下的客户关联事件）接入 `subjects` 后，Q4 式的验证才有更丰富的场景可测｜Task 11 端到端验收实测新发现，无历史来源

- [ ] **`InternalFundAuditLog` 有读无写 → 资金单详情页审计列表永远空**：Round 2 后零写入方，读取链还在——运营点开任何一张资金单，审计栏都是空的（踩铁律①「操作必留痕」的可见面）。补写状态变更 or 改读中央审计日志 ｜来源: 2026-07-03 死码 D6 改判（勿删表，有活读取链）；2026-08-26 分流迁入 PRODUCTION-NOTES，2026-08-28 判为业务缺口迁回

## I. 贯穿多幕（通知 ｜ SLA ｜ 杂项）

> 多幕都会碰到的横切项——改一处多幕同时受益。

- [ ] ⭐ 🔴 **通知 send/retry = STUB**：`core/notifications/` 只有 WebSocket `NotificationsGateway`，无 email/webhook/失败重试实现——roadmap 标 Notification send/retry ✅ MVP 为过度声明；这是 V4-V6 各版本"通知未接"的根因（本体没做，不是没调）｜来源: 2026-07-04 V1 体检

- [ ] **`approvalEntityRoutes.ts` 的 `?keyword=` 查询参数是死参数**：交易域（deposit/withdraw）entityRef 回链落地到 `/admin/trading/deposits?keyword=<entityRef>` / `.../withdrawals?keyword=...`，但 `DepositTransactionList.tsx`/`WithdrawTransactionList.tsx` 只读 `ownerNo`/`depositNo`/`withdrawNo` 三个查询参数、从不读 `keyword`（`grep -n "searchParams.get" 两文件`核对）——链接落地到正确页面，但不会自动预填任何筛选框，审批回链点不到具体那一笔单。Task 8 当轮只修了 Case 详情三链，此为既有债、非本轮引入 ｜来源: 2026-09-07 界面收口轮 Task 16 收尾闸考古

- [ ] **列表页「仅看已超时」是前端过滤，只对当前页生效**：三域 `{Deposit,Withdraw,Swap}TransactionList.tsx` 的「仅看已超时」复选框均在 `useMemo` 里对当前页 `items` 客户端过滤（`formatSlaRemaining(...).tone === 'breached'`），后端列表查询无对应的 `slaBreached`/`slaBreachedOnly` 参数——勾选后只在当前分页内筛选，翻页/换页大小会丢失筛选效果，与既有 `needsReviewOnly` 同款局限（三域列表页均有——充值列表页 `DepositTransactionList.tsx:242` 的注释就自述"与下方 needsReviewOnly 同类局限"）。代码注释已自述该限制（"Backend has no slaBreached query filter yet; apply client-side over the current page only"）｜来源: 2026-08-21 SLA 批次

- [ ] **软破线后 `slaBreached` 会一直为 true 直到状态变化**：`markSlaBreached(id)`/等价方法只做单字段更新，`resolveSlaFields()` 是唯一能把它归 `false` 的路径，只在下一次状态迁移时触发。若运营处理了软破线单但没有推动状态（例如只加了备注、或问题本身要等外部条件成熟），红标不会自动消——UI 上看起来"一直超时"，即便运营已经在处理｜来源: 2026-08-21 SLA 批次

- [ ] **时长是硬编码常量，无 admin 配置界面**：`DEPOSIT_SLA_MINUTES_BY_STATUS`/`WITHDRAW_SLA_MINUTES_BY_STATUS`/`SWAP_SLA_MINUTES_BY_STATUS` 均是各自 service 文件里的 TS 字面量常量，改时长需改代码重新部署；三域此前各有一套不同的可配置性历史（兑换曾经有 `SWAP_COMPLIANCE_TIMEOUT_MS` env 覆盖，本批已删除该开关，统一成与另外两域同款的纯代码常量），现状是**三域一致地**没有任何 env/DB 层面的运行时可配置项。BACKLOG 旧条目「60 秒合规超时未经真实 Sumsub 延迟校准」的具体诉求②（"改成可配置项"）实质上仍未完成，只是数字来源换成了业主裁定的业务口径而非未标定的技术猜测 ｜来源: 2026-08-21 SLA 批次

- [ ] **`formatSlaRemaining` 对不足 1 分钟显示 `"0m"` 而非 `"<1m"`**：`admin-web/src/utils/slaDisplay.ts` 的分级逻辑（`days>0`/`hours>0`/否则 `${minutes}m`）在剩余时间落在 0-59 秒区间时 `totalMinutes=Math.floor(ms/60_000)=0`，直接显示 `"0m"`——对运营而言"0m"容易误读成"已经到期"（虽然 tone 仍是 `normal` 不是 `breached`），比显示 `"<1m"` 更容易造成误判 ｜来源: 2026-08-21 SLA 批次

- [ ] **「按键 × 按状态」置灰精度**（两条同族，合并登记）：① 兑换 ①Approved 在 SUCCESS/REJECTED 上确是真 no-op 却没被灰（8 键里 1 个过度点亮）；② 充值/提现的 ⑧ On hold 在非 `COMPLIANCE_PENDING` 上是纯 no-op（后端 `decideVerdictLanding` 有 `verdict==='onHold' && status!==COMPLIANCE_PENDING → IGNORE`）却仍可点。两者方向都安全（不误灰），修法都需要引入「按键 × 按状态」矩阵 ｜来源: 2026-08-23 第五批 Task 7 审查

- [ ] **`tags: string[]` 三域 Sumsub DTO 都声明、全 admin-web 零渲染**（后端 `parseDetail` 确实在填）｜来源: 2026-08-23 第五批 Task 2 审查

## J. 待业主拍板（是问题不是任务，定了才排期）

> 这些不是任务，是问题。业主不定口径就不该排期，定了才拆任务。

- [ ] **金额闸门矩阵**：tier 限额 + 大额审批 20 万 + TR 阈值 3,500 三线合一后再统一接入 L1（避免接完旧表又改）｜来源: 限额重设计 + TR 调研（roadmap V3 ADVANCED）

- [ ] **单笔金额级冻结原语（交易风控 L3 前置依赖）**：已终态充值/兑换订单命中行为监测（L3）需冻结"对应金额"，现仅有客户级整体冻结（V2 冻结流），无 TB 层单笔金额锁定/冻结子账户原语；交易风控 L3 落地前须先建（提现无此需求——钱已出只管人）。设计见 `superpowers/specs/2026-07-12-transaction-risk-gates-design.md` §5/§7 ｜来源: 2026-07-12 交易风控三闸门 spec（业主定 deferred，不纳入本 spec）

- [ ] **翻案（MANUAL_CHECKING→approved）/below-min 放行（waive）后，原命中证据被最新报文覆写，无历史留档**：`sumsubTxnDetailJson`/`sumsubVerdict`/`sumsubScore` 是单列"最新一次"存证（乙口径，后盖前，见 `modules/v4-deposit.md` §4.4 历史记录），一笔曾被 `rejected`（如命中 PEP/制裁 tag）过、后来翻案/补料通过的单，一旦收到新的 `approved` 裁决，旧的命中证据（`matchedRules`/`typedTags`/`score`）整份被覆盖——仅从当前状态/报文看不出这笔单历史上曾命中过什么规则，对事后合规复盘/审计取证不利。业主未给口径（要不要留历史版本、还是只留最新一份即可），暂不处理 ｜来源: 2026-07-31 Task 4/Task 9 code 走查

- [ ] **对手方恰好是我的客户（交叉场景）——本批不考虑**：一笔交易的对手方地址如果恰好也是本平台的客户，`SANCTION_COUNTERPARTY` 命中理论上应该同时触发对该"对手方客户"的复核，当前实现只处置发起方，不追溯对手方身份 ｜来源: 2026-08-20 制裁分主体批次

- [ ] 法币轨道是否即时到账（决定非营业日走 HELD 等账单 vs 结转收盘判 MATCHED）｜来源: spec §10

- [ ] aging SLA 阈值（法币 ≥1 银行日 / 链按确认窗口）具体数值 ｜来源: spec §10

- [ ] 人工平账 maker-checker 是否按 severity 分级审批人（v1 可扁平：一律一道复核）｜来源: spec §10

- [ ] **INTERNAL_BREAK 全链本期不做**：内部恒等检测+中止代码已在（`wallet-recon-run.service.ts → computeInternalIdentity()` 预门），但事故界面（见上「INTERNAL_BREAK run 详情误显示空表」）/ 实时告警 / 收敛冻结 / 受控更正 workflow / 恒等左移 全部 defer；**对账 PRD 显式不体现 INTERNAL_BREAK 作为 run 结果**（run 结论只留 对平 / 有差异两态）｜来源: 2026-07-12 PRD 重写 Q3

- [ ] **人工腿推单 + BREAK/异常处置 = 本期非目标**：本期只交付**同步腿推单**（外部回执验证、免审批）；人工强推腿（`push/manual` + `ManualPushDto`，代码已在）、真差异/异常处置本期不作为交付/验收范围 ｜来源: 2026-07-12 PRD 重写 Q1

## K. 文档

> 文档与验收依据。验收口径已改七幕走查（TC 用例封箱），本节只剩文档整理。

- [~] roadmap **V3/V4 已按三层新格式重排 + truth 外置**（2026-07-03）；V1/V2/V5-V9 待同款处理

---

## 本轮销账（2026-09-08 按演示动线重排，已勾条目整批归档）

> 重排时把主台账里全部已勾条目归档至此，一条一行；完整「已解」说明见重排前全文（git 历史 `f27e8312`）。

- [x] 兑换页实时报价预览拿不到客户身份（VIP 预览显默认档价）—— 2026-09-05 波二销（cd55eae3）
- [x] 资产暂停只关前端下拉、后端三条交易路无资产门 —— 2026-09-05 波二销（L1 第十项）
- [x] 管理台「新建资产」表单四个必填金额字段缺输入框 —— 2026-09-02 修复，后随 V3 波一建资产路径退役作废
- [x] 权限包目录三动词标准化 + 铺满空域 —— 2026-08-31 第一幕职权重划
- [x] `expirePendingApprovals()` 全仓无 @Cron 调用方 —— 2026-09-01 四模块治愈 Task 1
- [x] `INTERNAL_COLLECTIONS_RECONCILE` 幽灵按钮 —— 第一幕退役段 Task 3
- [x] Wave8OpsDashboardPage 首页调已删端点 404 空转 —— 第一幕退役段 Task 3
- [x] `/admin/pricing/policies*` 幽灵路由 + `CUSTOMER_RATE_READ/WRITE` 死权限组 —— 第一幕退役段 Task 4
- [x] 新增 CFO 角色 —— 第一幕职权重划 Task 9/10
- [x] 角色绑定变更审批结构性自批死锁 —— 2026-09-04 业主拍板方案甲（TECH_OFFICER 加 `IAM_ROLE_ASSIGN`）
- [x] 资本注入流水缺 evidence 行 —— 2026-09-05 平账二期 Task 10
- [x] 资本注入 evidence 待核 —— 同上，已确认随种子装载
- [x] 审批策略页 `ACTION_TYPE_LABELS` 漏 4 类型标签 —— 2026-09-07 界面收口轮补齐
- [x] 一期客户流程重做（接真 Sumsub 申请人侧）—— 入驻 2026-09-07 波二销；档位升级 2026-09-08 波三销
- [x] `latestRiskApprovalId` 写入方 —— 2026-09-06 波一随 48→24 字段治理删列作废
- [x] Tier Upgrade（BASIC→PREMIUM 档位升级）—— 2026-09-08 波三全弧线交付（申请 → 补料 → 高管批 → 限额即刻生效）
- [x] 六个 admin 页读已删 `complianceStatus` —— 2026-09-06 波一核清销账
- [x] 材料到期 cron 筛选值失配 —— 2026-09-06 波一随 material-refresh 子系统整体退役
- [x] 行政级挂起单无入账路径、waive 承诺落空 —— 2026-09-05 波二销（结构性：先合规后挂起）
- [x] `waiveLimitHold`「KYT 先批复后挂起」顺序待核 —— 2026-09-05 波二销（该顺序即唯一顺序）
- [x] 运营补录入站信号（漏监听充值）无入口 —— 2026-09-03 平账 B 批（案子详情页发起补录）
- [x] ⭐ 现场注册客户无 TB 账本户、真充值永久卡单 —— 2026-09-08 波三销（首次 ACTIVE 运行时开户钩子，`task-15a-report.md` 翻绿证据）
- [x] 退汇认领·客户余额不足直接拒 —— 2026-09-05 二期垫款 + 2026-09-06 三期欠款登记
- [x] 客户流水页打不存在端点恒空 —— 2026-09-07 界面收口轮改接 statement 读模型
- [x] 跨日切场景案件页无可处置行 —— 2026-09-02 平账 A 批 Task 6
- [x] ⭐ aging + SLA + 超期升级 —— 2026-09-02 平账 A 批（升级通知不做，业主定）
- [x] ⭐ 对账 Cases 列表页 Δ 未按 decimals 缩放 —— 2026-09-02 平账一期半 Task 10
- [x] SUCCESS 后退汇无处理 —— 2026-09-03 平账 B 批（出金退回认领）
- [x] `SOFT_FLAG`→`COMPENSATING` 全仓改名 —— 2026-09-07 界面收口轮 Task 1
- [x] 🎯 二期·内部划转单（第四类订单）—— 2026-09-05 平账二期交付（认损补款 / 退汇垫款两条路）
- [x] 🎯 三期·事故登记 —— 2026-09-06 平账三期交付（五态生命周期 + 双链结案审批）
- [x] 案件详情页 walletRef tooltip 暴露 UUID —— 2026-09-02 删
- [x] 对账模块另 3 处同型 tooltip —— 2026-09-02 平账 A 批 Task 10
- [x] 开调账单（DRAFT）零审计 —— 2026-09-02 新铸 `RECON_ADJUSTMENT_DRAFTED`
- [x] Demo Compare 页期望破口恒空 —— 2026-09-07 业主拍板整页退役删除
- [x] `recon-demo.ts` dedupKey 旧场景号 —— 2026-09-02 重编号窗口一并重写
- [x] ⭐ 对账余额校验器未补零静默丢流水 —— 2026-09-02 四处连接键统一 padTbId
- [x] `createAccounts()` 写注册表不补零 —— 2026-09-05 平账二期 Task 1
- [x] ⭐ V3 财务配置域审计词汇入册 —— 2026-09-02 四模块治愈换名册四批
- [x] 客户流水直读账本分录缺加工层 —— 2026-09-07 界面收口轮（statement 读模型；业主裁定不做更正详情下钻）
- [x] 三域 Owner 按客户号搜索全坏 —— 2026-09-06 波一 Task 6
- [x] 审批流与审计检索无专属验收用例（TC-10）—— 2026-08-31 验收口径改七幕走查销账
- [x] 客户与合规无专属验收用例（TC-11）—— 同上
- [x] Material Refresh 状态名订正 —— 2026-09-08 作废：所指代码已随 material-refresh 子系统退役删除，订正对象不存在

## 本轮销账（2026-08-28 二次分诊）

> 已完成或已被业主裁定作废，不再占台账。原文见 git 历史（`649b4e88`）。

- [x] `db:biz:reset` 不重置 TigerBeetle → 重铺后 COA 恒等式必然破 —— 已解：`stack.sh reset [main|self]` 补齐 TB 清理重建（2026-08-26 Step 0，main 栈全链实跑、verify:coa 全绿）
- [x] KYT 超时转人工未做 —— 已由 SLA 批次实现——deposit COMPLIANCE_PENDING 5 分钟硬破线 → hardBreach → MANUAL_CHECKING（deposit-sla.service.ts:109）
- [x] 制裁没收（sanctions-confiscation）不在本轮范围 —— 业主已裁定禁行——冻结单只有上缴/解冻两条路，不能没收不能退回（modules/v4-deposit.md §1、CHANGELOG 2026-08-26）
- [x] 补料 CTA 降级（F5） —— 已做——DepositDetail.tsx:143 深链 /verification/<requestNo>，2026-08-07 deposit-action-embed 落地
- [x] 三个交易域（充值/提现/兑换）的日志梳理 —— 已拆三条按域登记，三条本轮同时销账（见下）
- [x] 充值域审计日志切新词表 —— 已切——V4_DEPOSIT_AUDIT_ACTIONS 31 码在册（站1b-β）
- [x] 提现域审计日志切新词表 —— 已切——V5_WITHDRAW_AUDIT_ACTIONS 25 码在册（站2-β）
- [x] 兑换域审计日志切新词表 —— 已切——V6_SWAP_AUDIT_ACTIONS 18 码在册（站3-β）

## 本轮销账（2026-08-29 演示装备一期收官，A 档整节退役）

> 「A. 演示装备」8 条本轮全部完成，整节删除（导语并入 §B）。前 6 条已于 2026-08-28 实跑复核销账，本轮只新做了后 2 条（造数花名册、补料回炉）；8 条一并归档于此，原文见 git 历史（本次改动前的 HEAD）。

- [x] 全新栈跑 `demo:all` 缺提现地址前置 —— 已解（2026-08-28）：`demo-lib.ts` 显式建 BANK + crypto 提现地址，`demo:setup` 建出 5 条 ACTIVE 地址
- [x] `demo:all` 充值 5/6（trading-ready 门后遗留卡单）—— 已解（2026-08-28）：全新库充值 6/6 SUCCESS
- [x] `demo:deposit`/`demo:withdraw` 在全新 worktree 上必炸（缺提现地址种子）—— 已解（2026-08-28）：全新库 `demo:deposit` 6/6、`demo:withdraw` 5/5，无超时无 400
- [x] `scripts/verify-demo-data.ts` 读已删的 `internalFund` 表，打断 `reset-main` —— 已解（2026-08-28）：口径已改读现存表，`reset` 收尾打印 `verify:demo-data ALL PASS` + `business reset complete`
- [x] **A5**：`demo:all` 全 SUCCESS 断言与 `demo:in-transit` 故意留的在途单结构性冲突，结果不稳定 —— 已解（2026-08-29）：断言改花名册逐条比对预期终态（不再要求清一色 SUCCESS），在途单并入花名册第 20 行（`demo:in-transit` 是它的 driver，预期 `PAYOUT_PENDING`）；实证：本轮 `demo:all` 干净重铺后实跑 **21/21 符合预期 + COA 四恒等式全绿**（见 `data.md` 生成区）
- [x] 兑换域 V7/V8 demo 按钮缺"先交材料"前置，真按会 500 —— 已解（2026-08-28 打过前置补丁；2026-08-29 整个按钮删除）：材料审核（原⑦⑧）移出交易面板，改走客户详情页 Verification Requests 区块的独立入口（三域共用，见 `modules/v6-swap.md` §5）
- [x] **A7**：充值/提现域不监听 `MATERIAL_REQUEST_REVIEWED`，材料审过、便签已撕，但订单不回炉，永久停 `ACTION_PENDING` —— 已解（2026-08-29）：两域各补 `@OnEvent(MATERIAL_REQUEST_REVIEWED)` 监听器（只认 GREEN → RESUME 回 `COMPLIANCE_PENDING`）；提现转移表补齐 `ACTION_PENDING --RESUME--> COMPLIANCE_PENDING`（充值侧这条边一直有，21→22 边）；新增审计码 `DEPOSIT_MATERIAL_APPROVED_RESUMED`/`WITHDRAW_MATERIAL_APPROVED_RESUMED`；实证：单测 `deposit-workflow.service.spec.ts`「`onMaterialRequestReviewed` — 材料审过后充值单回炉 (A7)」与 `withdraw-workflow.service.spec.ts`「同 (B3)」均绿（`npx jest ... -t 回炉` 10 例通过）
- [x] 材料账 `externalActionId` 全表 `@unique`，demo fixture 固定字面量两次点同按钮撞 P2002 —— 已解（2026-08-28）：三域 fixture 均改 `randomUUID()` 动态生成
