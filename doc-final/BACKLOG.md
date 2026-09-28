# 业务缺口台账

> **只登记业务缺口**：某流程 / 某页面 / 某状态在演示里缺、讲不圆、显示错。
> 技术待办（兜底 / 故障 / 并发 / 幂等 / 命名 / 死码 / 工具 / 测试基建 / 前端观感）一律记 `PRODUCTION-NOTES.md`，**不在此处**。
>
> **分诊判据**（`rules/review-rubric.md`）——
> 业务：显示的内容错了 ｜ 该有的信息没有 ｜ 结局不完整（某条业务出路没有）｜ 留痕缺业务动作 ｜ PRD/modules 说的和代码不一样。
> 技术：只有攻击者 / 故障 / 并发 / 重复回调才触发 ｜ 长得不一样但内容都对 ｜ 纯内部（命名、死码、类型、schema 残列、存储单位）｜ 工具与测试基建。
> 边界一条：挡住**开演**（铺不出数据、剧本讲错）算业务，记 BACKLOG；挡住**开发**（端口、PATH、worktree）算技术，进 PRODUCTION-NOTES。
>

> **⭐ = 带同事走七幕时会当场看到或讲不圆的**，共 8 条。一行四要素：是什么 ｜ 哪来的 ｜ 落点 / 状态。做完就勾掉，重排 / 分诊时统一归档到文末销账。
> 分诊历史：2026-08-26 首次分流（加固类迁出）；2026-08-28 二次分诊——业务/技术彻底分家：8 条已完成或已作废销账、45 条迁 `PRODUCTION-NOTES`、4 条从 `PRODUCTION-NOTES` 判回业务；同日「演示装备」A 档 8 条逐条实跑复核，6 条实证已修当场销账。**2026-08-29 演示装备一期收官**——A 档剩下的 2 条（造数花名册、补料回炉）做完销账，A 档 8/8 全部完成、整节退役删除（原文见「本轮销账」章节与 git 历史）；导语并入 §B。分诊前全文见 git 历史（`649b4e88`）。
> **2026-09-08 按演示动线重排**——章节改为七幕行进顺序（幕内按站 / 场景），43 条已勾条目整批归档文末「本轮销账」；「Material Refresh 状态名」1 条作废（所指代码已随子系统退役，`grep -rln "NUDGE_ONLY" src admin-web/src client-web/src` 零命中）。重排前全文见 git 历史（`f27e8312`）。

Last Updated: 2026-09-28（战役甲波五投诉工作流文档收口：扫账 `grep -in "投诉|complaint|COMPLAINT_ESCALATION" BACKLOG.md`——本文件此前零命中，扫一遍无本波可销账行、也无新登业务缺口；波二遗留的 `:467` FILING_OVERDUE_MARKED metadata 不对称行与本波无关，不销不改，非本波范围）；此前 2026-09-27（战役甲波四闹钟墙/合规日历/登记册文档收口：扫一遍无本波可销账行；新登 1（`FILING_OVERDUE_MARKED` deadlineAt extra-only 与 R5 修后写点不对称，T8 评审发现，见末尾）——依据本文件末尾内联订正，物证见 `superpowers/checkups/2026-09-27-act-a-wave4-evidence/`）；此前 2026-09-26（战役甲波二报送台骨架文档收口：销 1（:156「事故通报超时无持久软标与审计」——钟随岔口②搬到报送台单据，超时软标+审计随 T7 落地，见新篇 `modules/v9-regulatory-filing.md`）——依据 `superpowers/specs/2026-09-26-campaign-a-wave2-regulatory-filing-spec.md` §12，物证见 `superpowers/checkups/2026-09-26-act-a-wave2-evidence/`）；此前 2026-09-21（第六幕波五文档收口：销 6（:128 划转腿推单显式拒 / :136 业务日迪拜午夜切 / :180 划转路由前缀统一 custody / :194 严重度按币种拆线 / :198 开案审计 metadata 换业务键，均随波五 T1-T9 代码落地；另一条财务查证手册附录落后三波，随本轮 §四附录重排一并销账）+ :192 改写为余项（INTERNAL_BREAK 明细呈现，空表危险已随 T6 除、摘 ⭐）+ 新登 1（调账弹窗残存 side 锚推导是否收编后端，波四/波五两波均判不收，留档）——依据本文件各条内联订正，物证见 `superpowers/checkups/2026-09-21-act6-wave5-evidence/`）；此前 2026-09-16（审计两页按后端真实字段重设计·文档收口：§H 销 2（invite 派发失败分支漏 INSTRUMENT 行 / UUID 过滤两残口）+ 新登 2（列表页 Actor 列客户自助动作暴露裸 UUID / 状态迁移类审计事件不带 amount）——依据本文件 §H 各条内联订正，物证见 `superpowers/checkups/2026-09-16-audit-pages-walkthrough/`；此前同日第七幕波三收官记账：§H 销 6（InternalFundAuditLog 有读无写 / Audit No 假承诺 / Related Subjects 观察 / correlationId 旅程入口 / 一行级小账三件全销）+ §H 跳转映射条订正未全销（18/27→20/27，剩 7 类）+ §I ListFooter 清单划掉 AuditLogsPage（13→12）+ §K ⑥⑦ 数字销账（②script.md 兑换码数同销）+ 新登 1 行（InternalFundAuditLog 读写双死留删表）——依据本文件 §H/§I/§K 各条内联订正，物证见 `superpowers/checkups/act7-wave3-walkthrough/`；此前同日第七幕波二收官记账：§H 销 2（subjects 覆盖面 / 审计有痕无人）+ Q4 条重锚 + 新登 5 行观察——依据 `superpowers/specs/2026-09-16-act7-wave2-audit-attribution-design.md`；此前同日第七幕波一收官记账：§H 销 4 + 小账①划去、§B 账本域条补 actorId 落屏一笔——依据 `superpowers/specs/2026-09-15-act7-audit-campaign-charter.md` 波一节；此前 2026-09-15：战役收官后复检销 3 订正 5 新登记 6 + 第七幕体检 §H 订正 1 新登记 7）

## A. 开演前（重铺 + 造数判据）

> 还没开讲就可能踩的：开演前重铺（`reset-main` → `demo:all`）与造数判据网、答案键、铺场工具的缺口。

- [ ] **`demo:all` 花名册断言只看订单终态，不校验命中费率档——Grace 命中 VIP 档还是回落 STD 档，花名册分不出**：`demo-lib.ts` 的花名册比对逐笔只断言"预期终态 == 实到状态"（如 SUCCESS/FROZEN），不读订单实际结算用的费率等级或费用金额。VIP 与交易档位解绑后（2026-09-06 客户域波一，VIP 改手打 STATIC 标签），Grace 的 VIP 标签是否真的命中 `VIP-USDT-AED` 费率档、还是意外回落到 `STD-USDT-AED` 默认档，两种结局订单终态都是 SUCCESS——花名册测不出区别，是判据网缺口，不是已知业务功能缺失 ｜来源: 2026-09-06 第二幕客户域波一评审发现

- [ ] **答案键的 `expectedLines[].amount` 是装饰性的、没人读**（2026-08-31 终审）：`verifyManifest` 的 select 和匹配谓词都不碰它，且语义在场景间不统一（有的存注入后的新值、有的存差额）。升级方向是把它变成载荷（谓词里断言外部金额），这样"注入跑了但 delta 算错"也能被抓到——现在的钉行只能抓"整条没了"。⚠️ 终审的判断是**这条优先级低于已完成的完整性断言**（`casesOpened == manifest.wallets.length`，已于 `2e74d6d4` 落地）：金额算错已被 `bumpClosing` 连到桶断言上，而"多报破口"那一侧才是当时完全没人看的 ｜来源: 2026-08-31 整支终审

- [ ] **`recon-demo.ts` 报错文案里的钱包 UUID 现存 8 处**（2026-09-15 复检订正行号：`:759/880/947/998/1189/1419/1461/1683`，原 5 行号仅 947 仍命中）：commit `7aeeec7d` 专门为前置闸做过"报错改用钱包号 + 客户号"的清扫，同形的兄弟没跟上。**开发者面报错、不是管理台，不破铁律⑥**，纯可读性 ｜来源: 2026-08-31 整支终审 ｜ 2026-09-15 复检重锚

- [ ] **`recon-demo.ts` 报错文案里的钱包 UUID：根治办法是给 `WalletPlan` 加 `walletNo` 字段**（Task 11 评审顺带发现）：上一条「至少 5 处」逐处手改治标不治本——`WalletPlan`（本文件 `planWallets` 的返回类型）从来没有 `walletNo` 这个字段，只有内部 `walletRef`（UUID），所以每处新写的报错都只能选 UUID 或者改用 `currency`/`coaCode` 之类的替代信息绕开（T11 场景 10 的报错就是这么绕的）。根治：`planWallets` 查询 `wallet` 表时顺手 `select` 上 `walletNo`（真实值例如公司运营户 `WA2601017168`），`WalletPlan` 接口加一个 `walletNo: string` 字段，那样「至少 5 处」+ 本轮新绕开的这处能一次性全部改成 `${plan.walletNo}`，之后也不会再有人被迫在两个坏选项（UUID / 绕着说）里选 ｜来源: 2026-09-02 平账一期半 Task 11 评审顺带发现

- [ ] **几处注释与实现对不上**（2026-08-31 终审，同属"脚本不消费、没有机制会发现它错"那一类；2026-09-15 复检重锚：③已修销账，①②④仍真）：① `clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts:838` 一带（文件已迁目录）称已解释差异行"标成 EXPLAINED，仍在案件页上看得见"——**案件页读的是 `flowComparison[].explainedByAdjustmentNo`，全仓零处读 `status === 'EXPLAINED'`**（`grep -rn "'EXPLAINED'" src/` 仅此一处写），注释把展示来源说反了；② 错引行号问题已搬家：`adjustment.service.ts:842` 注释写"evidence.traceId（上面 :181）"，实际落点在 `:793`（`:978` 同款注释已被清过行号、这处漏了）；④ `adjustment-approval.service.ts:2` 与 `reconciliation.module.ts:23` 还写着"onApproved 本任务只留桩"，实际早已是完整落账方法（spec 里有成套 onApproved posting 测试）｜来源: 2026-08-31 整支终审 ｜ 2026-09-15 复检重锚

## B. 第一幕 · 开业（V1 治理底座 ｜ V3 财务配置 ｜ 账本）

> 讲「谁能做什么是拼包拼出来的、改任何配置都过审批」这一幕时会露的馅，按站排。

**站 2 · 一笔配置要过门（费率）**

- [ ] **报价落"资格快照"**：现 quote 仅存 `policyRef=LEVEL:code`；V3 要求成交时落 命中集合 + 选中级 + 选中理由(最低费) + 客户此刻标签快照（可解释/可申诉）｜来源: 2026-07-11 费率 V3 §4.4/§5.5

- [ ] **费率两族现网创建/落地审计的 afterData 仍写裸资产 UUID（种子三块 2026-09-06 小轮已换业务键，这两处是残余的另一半）**（2026-09-15 复检重锚：原两个 workflow 文件已被波四收编，问题现住共享基类）：`trading/shared/fee-level-workflow.base.ts:268/:354` 的 afterData 经 `assetShape` 参数带入 `{assetId}` 或 `{fromAssetId,toAssetId}` 裸 UUID——管理台审计页按字面量渲染，触铁律⑥。修法同种子侧：落 afterData 前把资产 id 映射成 currency（基类单点改、两族同愈）｜来源: 2026-09-06 第一幕小轮 Task 6 复查 ｜ 2026-09-15 复检重锚

**站 3 · 门自己也要过门（审批策略）**

- [ ] **`DEPOSIT_SUPPLEMENT`/`DEPOSIT_CLAWBACK`/`WITHDRAW_RETURN_CLAIM` 三类型是否该进 `V1_APPROVAL_ACTION_TYPES` 白名单，业主未定**：三者标签已备好（2026-09-07 界面收口轮补齐，见文末销账）但不在白名单里，审批策略管理页看不到这三行策略——是刻意（策略本身不需要在此页展示/编辑）还是遗漏，需业主拍板 ｜来源: 2026-09-07 界面收口轮 Task 16 收尾闸考古

- [ ] **治理域两个策略变更查询端点零前端消费方**：`approval-policy.controller.ts:80`（`GET .../approval-policies/change-requests` 列表）与 `:99`（`GET .../change-requests/:id` 详情）在删除 `/dashboard` 旧树与两张策略变更页后没有任何前端调用方——`admin-web` 全仓搜 `governance/approval-policies/change-requests` 零命中；现在提交变更走 `:61` 的 `POST :actionType/change-requests`（`ApprovalPoliciesPage.tsx` 在用），裁决走通用审批中心，这两个 GET 端点悬空。留作 API 或退役，待定 ｜来源: 2026-09-05 波二终审

**站 4 · 资产管控**

- [ ] 🎯 **新资产上线整条流程（未来）**：上币走开发流程——上币包配置（资产身份对齐 HexTrust 支持列表 + 账本科目 + 默认费率档 + 默认限额 + 价源）随版本装载并写发布标记审计；就绪检查（账本户 / 该链地址 / 费率档 / 限额四件齐）→ 运营提激活 → CISO 批；上新链时金库专员开该链地址（vault × 网络），上已有链的币零地址工作。2026-09-03 业主定本轮不做，V3 治愈波一把旧的建资产 / 上架 / 激活代码清干净 ｜来源: 2026-09-03 V3 体检讨论 + decisions 第四条

**站 5 · 三种门与容器（限额 / 托管钱包 / 提现地址）**

- [ ] **托管钱包页分组只按当前页数据分、非全量**：`CustodianWalletList.tsx` 把返回结果按 vault（F_OPS/F_SET/F_FEE/F_LIQ/CLIENT_DEPOSIT）在前端分组，只覆盖当次抓取的这一页；钱包总数一旦超过页大小，同一 vault 的行会跨页断开，出现重复或不完整的分组表头且不报错。页大小已从 20 提到 200（现状 19 个钱包：7 个平台位 + 每客户每网络一行 CLIENT_DEPOSIT，随客户增长自然涨，远低于 200）；钱包总数超过 200 时问题会复现 ｜来源: V3 财务配置治愈波一 Task 7 评审修复轮

- [ ] **`activateAddress` 是 `COOLING_PERIOD_NOT_EXPIRED` 唯一抛点，未来手动激活入口须补 DENIED 留痕**：`withdrawal-address-workflow.service.ts` 的 `activateAddress()` 直调主体层 `activate()`、没套 `recordDeniedAndRethrow`——今天仅有的两条调用方（cron 扫描 `WithdrawalAddressSweepService`、懒激活 `batchActivateExpired`）都已按 `activatesAt` 到期时间预过滤，撞不上这个五门码；但它是全仓唯一会命中 `COOLING_PERIOD_NOT_EXPIRED` 的调用路径，将来一旦加手动激活入口（如管理台按钮），必须仿照 `suspendAddress`/`skipCoolingPeriod` 套一层 `recordDeniedAndRethrow`，否则被拒的手动操作不会留痕，犯铁律①（见该方法上的注释）｜来源: 2026-09-05 波二终审

**账本与报表**

- [ ] **账本域两条详情路由仍用内部 id**（铁律⑥尾巴，三域交易 + 其余 8 模块共 42 条已换装后的残余）：`ledger/accounts/:id` 与 `ledger/transfer-evidence/:tbTransferId`（后者是 TB u128 hex、非 DB UUID，是否算暴露可议）。**补（2026-09-16 波一终审 D）**：同域 `TransferEvidenceList.tsx`/`TransferEvidenceDetail.tsx` 屏上仍渲 `actorId`（UUID 落屏，与路由同族另一件），收本条时一并 ｜来源: 2026-09-15 战役收官后复检（取数员 D 全量路由清点）｜ 2026-09-16 波一终审补

- [ ] **账本报表层四张视图待落地(2026-08-13，设计已定稿业主缓做)**：spec 见 `archive/specs/2026-08-13-ledger-reports-design.md`（2026-09-15 复检订正：已归档）（暂扣构成日报/收入分类日报/在途冻结登记簿/VARA 收盘快照 + 通用快照表 + 对账 cron 前置步 + `LEDGER_REPORT_READ/WRITE` 权限）。业主 2026-08-13 拍板本轮只做 COA 更新（plan `superpowers/plans/2026-08-13-coa-v2-rollout.md`），报表层整体缓做；其中 B2 依赖 COA v2 先落、B4 依赖下条迪拜 COB 修正 ｜来源: 2026-08-13 账务深化脑暴，业主二次收窄

## C. 第二幕 · 迎客（V2 客户与合规）

> 讲「客户是谁、能不能交易由合规说了算」这一幕的缺口。入驻（波二）与档位升级（波三）已重建完成销账；2026-09-08 收尾轮清掉客户可见面小账（快捷登录上线、横幅重复实证已修、坏路由删除），两条挂起可见性缺口归订单域（§D/§F）。剩销户清退挂账（业主裁定暂不做）。

**① 静态矩阵（客户列表）**

- [ ] **机构客户 stub（现状口径已更正，非本波动作）**：`CorporateProfile`/`UboProfile` 两表已随站6（2026-08-27 一期拆除）整体删除——不是"表在逻辑无"，是表已不存在；`customerType='CORPORATE'` 现仅剩 `CustomerManagement.tsx` 筛选下拉与 `CustomerDetail.tsx` 两处死注释占位（`⑫ Corporate Profile`/`⑪ UBO List`，无渲染内容），入口仍是禁用状态。若要支持机构客户需从零设计数据模型，不是"接回"旧表 ｜来源: 2026-07-04 V2 体检 ｜ 2026-09-06 波一复核现状口径更正

**销户与材料（材料请求站）**

- [ ] ⭐ **Q2 销户流程只落了轴上位置**（`assertOffboardable()` 三条不变量断言已随 2026-09-06 波一死码清扫删除——零调用方死码，重建销户时按新 spec 立）：`OFFBOARDED` 是 `lifecycle` 终态。真正的销户流程——余额清退、材料归档留存期、审批链、客户侧发起入口——全部未做；管理台 Offboard 按钮当前是 disabled 占位（与下方「材料终拒 → 离场清退流程未接」并链——材料终拒是触发销户清退的另一条路径；波二（2026-09-07）新增第三条触发路径——高管拒收（`FINAL_REJECTED`）后客户滞留 `REJECTED` 未再重申，清退承接同归此缺口，三条记录指向同一个未做的销户流程）｜来源: 2026-08-15 设计稿 §8 Q2 ｜ 2026-09-07 波二追加高管拒收触发路径

- [ ] ⭐ **材料终拒 → 离场清退流程未接**（原「REJECTED 材料请求便签长期无人清理」缺口并入，背景见下）：2026-09-06 业主拍板"材料终拒出口 = 离场"（decisions.md 同日，行业口径 FATF 建议10——无法完成尽调即退出客户关系，条子挂着不处理本身是合规瑕疵）；本轮（波一）管理台客户详情页已展示待离场文字提示（`CustomerDetail.tsx`，现为英文 "Due diligence incomplete · pending offboarding"——2026-09-15 复检订正：原中文文案已随全站英文化改英文；走查已验：Bob 的 EMIRATES_ID 材料请求打到终拒后文字出现），但实际的销户清退动作（余额清退 / 材料归档留存期 / 审批链）未做——与上方「Q2 销户流程只落了轴上位置」并链，是同一个未做缺口的两条触发路径（一条走 `OFFBOARD` 边、一条走材料终拒）。**背景（原条目内容）**：材料请求走到 `REJECTED`（RED·FINAL）是终态，但它挂着的便签不会自动撕（`MaterialRequestReviewService.applyReview()` 只有 GREEN 才 `autoRelease()`，两种 RED 都不撕是设计刻意），FINAL 是死路——客户唯一解法是靠运营再下发一次新材料请求或手工去限制账页面撕票，此前无 SLA/看板提醒运营处理 ｜来源: 设计稿 `superpowers/specs/2026-08-17-material-request-ledger-design.md` §9 Q3 ｜ 2026-09-06 波一并入销户缺口，管理台文字展示已补

## D. 第三幕 · 钱进（V4 充值）

> 讲「钱进来要闯几道门、闯不过去有四种下场」这一幕的缺口。最大一族是冻结动作的审计留痕——第七幕按单号拉链会当场露馅。

**四条弧与详情页**

- [ ] **`LIFECYCLE_NOT_ACTIVE` 挂起的单，若客户还没有 `sumsubApplicantId`，永远等不到裁决**：`submitSumsubTxns()`（`deposit-workflow.service.ts:345-351`）在 `deposit.customer?.sumsubApplicantId` 为空时直接 `logger.warn` 后 `return`——单子留在 `COMPLIANCE_PENDING`，但从未真正提交 Sumsub，也就永远不会收到裁决 webhook。这类单唯一的出路是运营在详情页用 ⚡ 面板对着 `COMPLIANCE_PENDING` 的单直接喂一个「① Approved」裁决（`decideVerdictLanding`/`applyKytApproved` 只按当前状态判定是否派发，不检查是否真的送过检）——裁决落地时 `limitHoldReason` 仍是 `LIFECYCLE_NOT_ACTIVE`（行政级，在 `ADMINISTRATIVE_HOLD_REASONS` 里），经 `holdIfHeld` 转 `OPERATION_PENDING`、挂起原样保留，交还运营再处置。"客户还没在 Sumsub 开户"不是刁钻边界，是会正常发生的客户状态，值得配一条脚本或至少讲清"这条路只能靠运营手动喂裁决" ｜来源: 2026-09-05 V3 财务配置治愈波二 Task 13 文档收口核对 L1 挂起链路时发现

- [x] ~~`CAPABILITY_RESTRICTED` 挂起原因区分不出 SANCTION 与 ADMIN_SUSPENSION，客户面一律藏~~ —— **管理台侧已解**（2026-09-14 波五 D10）：`L1GateService` ②格 detail 从"holds down X capability"升级为带具体因由 + 限制便签号（`l1-gate.service.ts:115` `restrictionNotes` 携带 `{cause, restrictionNo}`），管理台按此渲染因由与便签号（文本展示；终审 2026-09-15 勘误：便签号链接到客户详情为 spec 撰写期外延，业主裁定「只做展示」，不建链接）；**客户面部分维持刻意藏**——2026-09-14 业主裁定「D10 只做展示」，客户面继续不区分 SANCTION 与 ADMIN_SUSPENSION（tipping-off 代价不对称：藏错了客户少看见一条记录，露错了是刑事风险），不再是待办、是设计决定，见 `decisions.md` 2026-09-14 条 ｜来源: 2026-08-22 第四批 B4；2026-09-08 业主裁定归订单域；2026-09-14 波五销账

- [ ] **TR 适用判定未自动计算**：充值 PRD 定义 Travel Rule 适用 = 虚拟币 且 来源地址为 VASP 托管 且 单笔 ≥ 3,500 AED（三条件 AND，否则 NOT_REQUIRED）；现状条件①法币→NOT_REQUIRED 已落地，条件③金额阈值已实现（`kyt-txn-type.resolver.ts` `TR_THRESHOLD_BY_CURRENCY`，USDT 1000 / AED 3500，边界取 ≥）；仅剩条件②（对手方 VASP 打标靠 DTO 自报）未自动化 ｜来源: 2026-07-11 充值 PRD v2

**没做的自动化（现全靠人工）**

- [ ] **BELOW_MIN 计次自动冻结未做**：同客户多次触发 below-min 挂起累计到阈值后自动转 FROZEN（防试探式小额充值绕限额）未实现，本轮只做单笔挂起+人工处置 ｜来源: 2026-07-16 deposit-min spec §8（deferred）

- [ ] **自动没收 cron 未做**：BELOW_MIN 挂起超时后自动发起没收（现只能 ops 手动点 Confiscate）未实现 ｜来源: 2026-07-16 deposit-min spec §8（deferred）

- [ ] 充值挂起（`DEPOSIT_HELD_NOT_TRADING_READY`）无自动重驱：客户补齐法币地址后，挂 COMPLIANCE_PENDING 的充值不会自动重跑 checkAutoApproval → 需 hook `ADDRESS_ACTIVATED` 重驱该客户挂起充值，否则要人工 ｜来源: 2026-07-11 Task 4b

## E. 第四幕 · 钱换（V6 兑换）

> 讲「一次兑换四条腿原子记账」这一幕的缺口。

- [x] ~~🔴 客户端兑换页「Matched」行渲染内部 UUID（铁律⑥客户屏首犯）~~ —— **已修**（2026-09-15 复检当日）：两处渲染改 `pairName / tierName`（`Swap.tsx:738/:1047`），payload/报价快照形状不动（`matched` 里的 id 只存证不落屏，admin 侧本就只读 tierName）。走查实证：预览行显 `STD-USDT-AED / Tier 1 (0-500)`，firm quote 确认框零 UUID（其 `matched` 响应本为空、该行系防御性条件渲染）；vitest 87/87 绿。两条路径 `pairId` 语义不一致随字段停用而失效 ｜来源: 2026-09-15 战役收官后复检，当日销账

- [ ] 无自动 FAILED 状态机：腿失败走自愈→STUCK(needsReview)+手动 resume，swap 留 PROCESSING，无终态失败（设计 deferred）｜来源: 2026-07-04 V6 体检

- [ ] 兑换成功通知未接（SUCCESS 时不调 Notification）｜来源: 2026-07-04 V6 体检

- [ ] **兑换域规则清单与阈值**：另起规则目录文档，含排雷（含 rejected 计数 / 缺 .notRejected 的聚合规则会造成
      「被拒→加分→再被拒」死循环）｜来源: 同上 §7
> 注：swap 腿 InternalFund 命名债已并入下方「平账处置」的 funds-orders 域 RBAC 命名债条目，不重复登记。

## F. 第五幕 · 钱出（V5 提现）

> 讲「出金门最多、客户永远看不到调查原因」这一幕的缺口。tipping-off 三防线已于 2026-09-12 波三红项修复补齐（status/completedAt 白名单 + customerScope 忽略 status 改走 bucket + 客户端筛选改 bucket 间接式，见文末销账）；剩订单级折叠（Q1）待波五。

- [x] ~~Q1 制裁客户的订单级折叠未做~~ —— **已实现**（2026-09-14 波五「创建即冻」）：提现/兑换报价与建单从中性 403 改为对 SILENT-only 客户放行，建单入库后立即走既有 FREEZE 边转 FROZEN，客户面收敛成 `COMPLIANCE_PENDING`／`PROCESSING`（`toCustomerWithdrawStatus`/`toCustomerSwapStatus` 白名单收敛）；充值域 `detected()` 链路本就零改动（早已是"收进来即冻、显示 PROCESSING"），客户自报入口随本轮统一 fold。「收单后一律挂 PROCESSING、连状态变化都不产生」的订单级折叠三域自此一致落地；DISCLOSED 客户维持中性拒绝不受影响。见 `decisions.md` 2026-09-14 条 1 ｜来源: 2026-08-15 设计稿 §8 Q1；2026-09-08 业主裁定归订单域；2026-09-14 波五销账

- [ ] 提现成功通知未接：SUCCESS 时不调 `NotificationsGateway`（基础设施在、workflow 没调）｜来源: 2026-07-03 V5 体检

## G. 第六幕 · 账对（V8 对账 ｜ 平账处置）

> 讲「对不上的怎么处置」这一幕的缺口，按演示场景号排；底盘与留痕类殿后。

**场景 1 · 推单**

- [ ] **swap 腿推单未支持**：通用推单按钮（`/admin/funds-orders/:no/push/sync|manual`）明确排除 swap 腿——`advanceByNo`/编排服务见 `swapTransactionId` 非空即拒（现有先卖后买顺序守卫防线），且回填 effectiveDate 需再穿透 swap 4 腿两阶段记账链（工作量≈deposit+withdraw 之和）。swap 腿卡单本期走 **Swap 详情页 `advanceLeg` 专用推进**（带顺序守卫），但该路径**暂无 effectiveDate 回填** → 推完历史那天快照修不平 ｜来源: 2026-07-03 推单 plan 落地发现（spec §2/§8）｜下期：swap workflow 记账链穿透 effectiveDate + 推单接 swap 腿

- [x] **推单页对内部划转腿要么显式拒、要么修方向标签**（2026-09-05 平账二期终审裁定）：在途案「去推单」链接对划转腿可达，`push-order.service.ts` 只拒兑换父单；推它不会重复落账（落账单点在划转工作流的 CONFIRMED 事件处理，与推单驱动已有 already-terminal 容忍），但回执视图会把划转腿方向误标成 IN——沿兑换先例显式拒（"划转腿资金单请走划转单详情页"）或补方向分支 ｜来源: 平账二期 Task 2 评审发现、终审裁定 BACKLOG ｜ **2026-09-21 波五 T7 销账**：取甲案（显式拒）——后端 `loadPushable` 照 swap 先例加 `internalTransferId` 拒斥；前端双入口连动（案件页在途行改渲染「Transfer leg →」直指划转单详情、资金单详情页对划转腿隐藏推单动作块）

**场景 8 · 改记**

- [ ] **改记换主后，对正主方没有合规复核**（2026-09-02 平账一期半新增）：改记（`CUSTOMER_REATTRIBUTION`）把一笔钱从错记方名下改到正主方名下，**放行依据是「记在错记方名下的那张原始充值单 KYT 已经跑过」**（与一期调账单边界线同源——有原单 ⇒ KYT 对这笔钱跑过），本轮**不重跑 KYT**。但那次 KYT 跑的是**错记方的身份**：真正持有这笔钱的正主方，从来没有被就这笔资金筛查过。业主 2026-09-01 拍板本轮这么放行、缺口登记在案。修法方向（下一轮/合规域定）：换主落账后对正主方补一次 KYT/制裁筛查，或至少在正主方的合规档上留一条「因改记获得资金 X，原单 KYT 结论沿用自客户 Y」的可追溯记录 ｜来源: 2026-09-01 平账一期半 spec §6 合规口径

**场景 9 · 跨日切（业务日口径）**

- [x] **业务日期按 UTC 切、非迪拜 COB(2026-08-13，财务硬需求)**：`src/modules/accounting/tigerbeetle/utils/business-date.util.ts:2` 的 `toBusinessDate` = `toISOString().slice(0,10)`（UTC 日历日 = 迪拜凌晨 4 点切日），迪拜时间 1 月 5 日 02:00 的交易记成 1 月 4 日的账。业务方邮件明确要求"固定迪拜 close-of-business 截止、对前一日收盘位"。**业主 2026-09-19 拍板：做，改按迪拜 COB 切**（`decisions.md` 同日条目）。**存量不评估**——§3 数据随时可重铺，改完 reset 重铺、不写 backfill（原「历史 effectiveDate 存量口径切换需评估」作废）。**改动面实测 7 处**（2026-09-19 体检实扫）：`toBusinessDate` 有**两份实现**——共享 util `business-date.util.ts:2` ＋ 对账编排私有重复件 `wallet-recon-run.service.ts:1055`，**只改前者会留下「引擎仍按 UTC 切」的暗坑**；另四处硬写 UTC 日终：`recon-thresholds.constant.ts:26`（账龄起算）/ `effective-cutoff.ts:23`（生效日过滤）/ `reconciliation-query.service.ts:923` / `push-order.service.ts:204,206`（「今天」判断）。对照：cron 早已跑 `Asia/Dubai`（对账 02:30、账龄每分钟），只有算出来的日期还是 UTC。不依赖 COA v2，可单独先修 ｜来源: 2026-08-13 COA v2 设计对话中代码实证（spec §7）｜ **2026-09-21 波五 T1-T4 销账**：切点钉死迪拜午夜（自然日历日，`D T19:59:59.999Z` 日终），`business-date.util.ts` 重写 + 新增 `endOfBusinessDate`/`startOfBusinessDate` 唯一真源；改动面订正为 **9 位点 / 8 文件**（体检 7 处之外新扫出 `supplement-evidence.service.ts:125` 兜底业务日与前端 `reconRunTrigger.ts:34` 日终硬拼，`runs/wallet` 契约改收 `businessDate` 把日终换算收回后端）

- [ ] **effectiveDate 语义待核**：应 date(价值日) + 独立 createdAt(datetime) 两字段两用途；需核 `effectiveDate` 是否 date-only、截止边界卡点是否用 createdAt ｜来源: spec §2.4

**场景 13 · 补录**

- [ ] **① 漏记入金补录：小额（低于该资产 DEPOSIT 单笔下限）CFO 批完不会自动到 SUCCESS，案子这一轮愈不了**（2026-09-04 平账 B 批 Task 8 e2e 实证）：`prisma/seed.business.ts` 给每个资产的 DEPOSIT `SINGLE_LIMIT` 都挂了下限（AED/USDT 现为 100）；补录信号建单时（`detected()`）金额低于这条线会带上 `limitHoldReason=BELOW_MIN`，即便运营发起补录、CFO 也在 `DEPOSIT_SUPPLEMENT` 审批里批准了，充值单入账唯一出口 `approveDeposit()` 仍会照下限单的老规矩把它按到 `OPERATION_PENDING`（不是 `SUCCESS`）——这一路的「重对账后案子愈」因此不成立，得再等运营在充值详情页点一次既有的「放行下限挂起」（`waiveLimitHold`）才走完。不是死路、也不是新缺口（下限闸是既有设计，补录只是撞上了它），但"漏记的往往是零头"——这正是"漏记入金"补录场景最典型的金额区间，补录闭环的演示脚本/文档若不点名这个额外步骤，讲这一幕时会卡在"怎么案子没愈"｜来源: 2026-09-04 Task 8 e2e 用真实 61 USDT 金额跑通 ①a 时当场复现（改用 150 USDT 绕开，未改代码）｜2026-09-08 平账处置改版 Task 9 核对：`ReconciliationSupplementModal.tsx` 补录表单区已加提示行"Amounts below this asset's single-deposit minimum will pause at OPERATION_PENDING after approval — release it on the deposit detail page."（先预警、不消缺口——运营仍要多点一步「放行下限挂起」，本条不销）

- [ ] **补录被拒后，客户自己重新申报同一笔汇款会被系统默默吞掉**（2026-09-03 平账 B 批 Task 5 评审发现）：运营发起的漏记入金补录若被 CFO 拒绝，那条差异行对应的申报记录会留在「已拒绝」状态占着这笔汇款的登记位；此后如果客户自己在客户端就同一笔汇款重新提交「我打了这笔钱」，系统会把它当成重复申报直接忽略——界面显示提交成功，但既不会新建记录、钱也不会入账，客户和运营都不会收到任何失败提示，只会看到钱一直没到账却查不出原因。控制方裁定本批不修（超出补单三入口半径） ｜来源: 2026-09-03 平账 B 批 Task 5 评审发现

**场景 16 / 17 · 补款与垫款**

- [ ] **法币补款腿 2 失败后款项停在结算户**（2026-09-05）：腿 1 已落账、账与钱一致，订单 FAILED，人工处理，不做自动退回 ｜来源: 平账二期 spec §3

- [x] ~~🔴 划转工作流一处绕过 FundsOrderService 直写 `fundsOrder` 表（铁律③）~~ —— **已修**（2026-09-15 复检当日）：`FundsOrderService` 新增 `stampExternalRef(id)`（铸法/幂等委托既有 `buildExternalRefPatch`，SUBMITTED 期预铸语义不变），workflow `onLegSubmitted` 改调、`as any` 直写与本地重复铸号逻辑删除（连 `fakeChainTxHash/fakeBankRef` 孤儿 import 一并摘）。全仓 `fundsOrder` 写点复归 funds-layer 独占。闸：jest 77/77（SUBMITTED 铸号用例改断言服务方法）+ 重铺闸 demo:all 29/29 + verify:coa 全绿 ｜来源: 2026-09-15 战役收官后复检，当日销账

**场景 18 · 事故登记**

- ~~**大额查不出（LARGE_UNEXPLAINED）事故定损后，钱这条腿没有出口——事故永远关不了**~~ —— 已解（2026-09-08 平账处置改版 Task 4，commit `aad897a2`）：写闸判据从「定性行 outlet==='INCIDENT'」改成「行挂着 `incidentNo`」（`adjustment.service.ts → assertWriteOffAllowed`），读面 `nextStep` 同款改判（`reconciliation-query.service.ts`）；升级路（LARGE_UNEXPLAINED）事故定损（`FIRM_LOSS`）后，案件行重新出现「Recognize loss / Write off」按钮，金额锁定 = 定损额、跳过小额线，走通认损/核销 → CFO 批 → Re-reconcile → 案子自愈 → 事故页可挂载、可提结案；见文末销账「死胡同修复」，走查实证：case REC20260908-010 / INC260908635950 ｜来源: 2026-09-08 平账走查模拟

- ~~**事故通报超时无持久软标与审计**：spec §2 曾承诺超时软标+审计，实现为界面倒计时徽标（前端算），十一码名册（业主拍板）无超时码位，补齐须业主扩名册；演示不演超时，缺口不影响本波验收~~ —— **已解**（2026-09-26 战役甲波二 T7）：钟随岔口②搬到报送台单据（`RegulatoryFiling.deadlineAt`），超时持久软标 + 审计落地于 `regulatory-filing-sweep.service.ts`（@Cron 每 30 秒；`overdueMarkedAt` 字段 + 系统审计码 `FILING_OVERDUE_MARKED`，见新主体十码名册 `REG_FILING_AUDIT_ACTIONS`）；事故侧原十一码名册随通报字段退役收缩为九码（两码 `INCIDENT_REGULATOR_REPORT_DRAFTED`/`INCIDENT_REGULATOR_REPORTED` 退役），详见 `modules/v9-regulatory-filing.md` §2/§3 ｜来源: 2026-09-06 平账三期终审 → 2026-09-26 战役甲波二 T7/T11 销账

- [ ] **incidents 表三根低写入列**：customerId / sourceExternalLineId 零写入方、walletRef 仅 DTO 通道，下次动 incidents schema 时清理或接上真实写入 ｜来源: 2026-09-06 平账三期终审

- [ ] **STUCK_TRANSACTION_MAJOR（大额卡单）乙案定损后可认损（`FIRM_LOSS`）直接结案，但没有处置动作可挂——认损这个结论没有记账路径**（甲波一 T8 业主留意项，T11 登记）：十类终盘里 `STUCK_TRANSACTION_MAJOR` 的 `allowedRemediationKinds` 是空集（`incident-type-registry.ts`）——按 Ruling-10 乙案，定损口径不是 `NO_LOSS` 时本该先进 `RESOLVING` 挂处置动作（如 `ADJUSTMENT`/`TRANSFER`）才能结案，但这一类压根挂不了任何善后单（白名单为空），于是"定损结论是 `FIRM_LOSS`（公司承损）"与"没有任何单据把这笔损失记进账本"两件事同时成立——事故可以从 `ASSESSED` 直接结案（乙案对空白名单类型放行），账却没有跟着动，铁律⑤（钱动必过账）在这里出现张力：不是"钱动了没记账"，而是"认了损、却没有钱动的动作可选"。`UNAUTHORIZED_OUTFLOW`/`LARGE_UNEXPLAINED`/`CLIENT_SHORTFALL` 三个 FUNDS 族类型有 `ADJUSTMENT`/`TRANSFER` 等挂载可用（e2e 用例⑤示范了完整的认损调账 + 补款链路），但 `STUCK_TRANSACTION_MAJOR`（`OPERATIONS` 族，MONETARY 口径）没有对应的记账通道——这是注册表设计层的缺口，不是某个入口漏挂，需要业主定夺是否要给这一类补一条走 `ADJUSTMENT`/写核销的路，还是接受"卡单类事故的资金损失走账本外的其它记录方式" ｜来源: 2026-09-25 甲波一 T8 报告"业主留意项"，T11 登记

**无主入金（成因菜单上有、出口没有）**

- [ ] **无主入金查不出归属，超期没有退回付款方的出路**（2026-09-03 平账 B 批）：`UNCLAIMED_INFLOW`（外有我无 × 公司格）成因菜单查证结论是"归属排查中"——查出是客户的转补单、查出是公司的走补记，但排查不出来时（既不是任何客户、也不是公司已知收支）行业惯例是账龄到期后原路退回付款方，本系统今天没有这个出口，只能停在「挂起·调查中」，无自动 / 半自动的退回操作 ｜来源: 2026-09-03 平账 B 批 spec §10

- [ ] **兑换（SWAP）来源行没有冲正 / 冲销码，只剩挂起（A1b 甲，2026-09-08 处置改版拍板）**：`dispositionsFor()` 的乙档硬边界按内部流水 `sourceType` 过滤——只有 DEPOSIT / WITHDRAW 系来源开放冲正 / 冲销按钮，SWAP 差异行天生没有这两个按钮（不是点了报错，是从头不给选项），只能走挂起两种。行业惯例是给兑换单独立一套冲正 / 冲销成因码（如"汇率算错""兑换费轧差"），本系统未建；本轮为演示铺不到的场景不立码，业主拍板明确不做。若未来 break 造数或真实数据出现 SWAP 差异行需要动账，需先补齐 `cause-registry.ts`/`adjustment-rules.ts` 的兑换专属成因码与 `dispositionsFor` 分支 ｜来源: 2026-09-08 处置改版 spec §1-8/§9

**处置面还欠的**

- [ ] ⭐ **真差异(BREAK)处置闭环：十件处置全部交付**（2026-09-06 平账三期：事故登记补齐最后一件）
  - **已交付**：推单 ｜ 冲正 ｜ 冲销 ｜ 补记（一期，2026-08-31）｜ 改记（第四族，借错记方应付 / 贷正主方应付、资产腿不动、一单双案同愈）｜ 挂起（等下期 / 调查中，零账务，案子仍红）｜ 核销（公司池；四前提 + CFO）｜ 补单（三入口：充值补录 / 退汇认领 / 退回认领，案子上发起、CFO 单步复核、业务域执行、重对账自愈，2026-09-03 平账 B 批）｜ **划转**（认损补款 / 退汇垫款，第四类订单，法币两腿经结算户 / 加密币一腿，2026-09-05 平账二期）｜ **事故登记**（未授权转出出口 / 大额到线升级 / 退汇欠款登记三类入口，五态生命周期 + 双类型结案审批，全程零账务，2026-09-06 平账三期）。入口 2026-09-08 处置改版起统一为「差异行直接按钮（按格 × 记账事实硬边界过滤）→ 一个弹窗选原因码 + 填字段 + 查证说明 → 原子开单」，取代此前「先定性、注册表判出口」的两层机制；**「不该动账的行显示错误按钮」那个缺陷随之消失**——2026-08-31 记的「指出来、不点」演法已作废
  - 豁免 / 容差 **不做**（decisions 2026-09-02，精度一致）；aging 已做（3 天，标记 + 审计 + 解锁）
  - ~~**三期**：事故升级（`UNAUTHORIZED_OUTFLOW` 本轮只能留档）~~ —— 已解（2026-09-06 平账三期）：见文末销账「三期 · 事故登记」
  - **仍 deferred**：COMPENSATING 里"真两侧对冲错"的调账（matcher 调优部分不算）；Finance 人工核实 → 结案 ｜来源: spec §9，2026-09-05 平账二期收尾更新

- [x] ~~⭐ **对账复核签核未做**：应干净 run 自动认证 + 人工平账动作走复核签核(maker-checker 推≠批，可按 severity 分级)~~ —— **业主裁定不做**（2026-09-19 第六幕体检后拍板，`decisions.md` 同日条目）：人手就这些，不再往流程里加人。**现状即终态**——动钱的八类处置（冲正/冲销/补记/改记/核销/认损/补单三路/划转）本就是金库开单 → CFO 批两个人，事故结案是 MLRO → CFO 两步；本条要加的是在这之上再挂一层。**推单与挂起两种维持一人完成、不送审**（挂起零账务；推单只推状态机不直写账）。捆绑的「干净 run 自动认证」一并不做。⚠️ 别再当待办翻出来 ｜来源: spec §6

- [x] ~~**`rowAdjustmentPrefill().direction` 提现类 AMOUNT_MISMATCH 缺翻符号**：`ReconciliationCasesDetailPage.tsx:327` 的 AMOUNT_MISMATCH 分支按「符号即答案」的固定惯例推方向（`deltaAmount` 为负→REDUCE、为正→INCREASE），这条惯例只按存款语义推导，没有为提现类流水的方向语义翻符号；现状下当前种子数据未产出该组合（非结构性排除——`ADJUSTABLE_SOURCES` 收提现来源、差异行生成也不挑方向，真实数据可能凑出），先记一行留档，防止日后这个组合被激活时悄悄预填错方向~~ —— **已修**（2026-09-21 第六幕波四）：波四收编修复：方向公式收回后端 cause-registry，出账翻符号用例入 cause-registry.spec（`cause-registry.spec.ts:178` "AMOUNT_MISMATCH 出账翻符号：内部 OUT、原始差 +10 → REDUCE（BACKLOG:176 组合首次入网）"）；前端 `rowAdjustmentPrefill`/`deriveKindDirection` 两处本地推导随之退役，改读后端下发的 `row.adjustmentPrefill.direction` ｜来源: 2026-09-08 平账处置改版终审

- [ ] **手续费归集不做，等报表层**（2026-09-05 平账二期 F1'）：账上等于收入结转进运营户，可做；但收入户兼作钱包位置，归集后余额清零，没有报表层时观众读不出本期收入 ｜来源: 平账二期 spec §0

- [x] **内部划转单路由前缀 `treasury/` 与 Custody 组其它页 `custody/` 不一致**（2026-09-05）：侧栏同组、路径两个前缀，纯 IA 债；改动要连动案件页 / 审批回链 / 资金单回链四处写死的链接，单独一次收 ｜来源: 平账二期 Task 13 评审、终审裁定 BACKLOG ｜ **2026-09-21 波五 T9 销账**：取甲案（统一 `custody/`）——App.tsx 2 路由定义 + 11 字面 = 13 处一次收齐，`grep "treasury/"` 路由义命中归零；RBAC 零改动（权限码挂后端路由，前端路径非权限载体）

**对账底盘**

- [ ] ⭐ **数据完整性闸 + HELD 态未做**：无"数据到齐才对"闸、无 `HELD`(待外部数据)态；即时轨道周末结算 / 账单延迟会被误判假 BREAK（结算轴 ≠ 上报轴）。与 2026-07-06「external_balances 驱动静默漏对」同源（该条=现状症状、HELD=应然解）：应以内部钱包名册枚举、缺外部数据标 HELD 而非跳过/硬对 ｜来源: spec §2.6

- [ ] **对账钱包枚举由 external_balances 驱动、缺外部快照的客户钱包静默漏对** — `wallet-recon-run.service.ts` 的 run 钱包遍历以 external_balances 行为键；某客户钱包当天缺外部快照即被**静默跳过**、不进对账也不报异常，"full list" 完整性靠外部数据源自觉而非内部账户名册驱动。修法：以内部客户钱包名册为枚举源、外部缺行标 MISSING_EXTERNAL 而非跳过 ｜来源: 2026-07-06 V8 遗漏审计（对抗核验读代码逮到）

- [ ] **流水 match tag 结转未做**：行项每 run delete-then-insert 全量重配、无持久行状态；应 Reconciled 冻结踢出、只对未决+新增。上文「reObservedCount 恒为 0」是无持久行状态的同源症状。⚠ **落地时字段名用 `reconciliationStatus`（Reconciliation Status，业主定名），枚举 `Open / Reconciled / In-transit / Exception`**（PRD §5.2 已定，勿再叫 tag / UNRECONCILED / OPEN_EXCEPTION）｜来源: spec §0.5/§3.2 + 2026-07-13 PRD 命名

- [ ] 🐛 **`reObservedCount` 恒为 0**：line item 每 run delete-then-insert，`foundByRunId` distinct 恒 1 → 观察历史"复观察次数"永远 0；正确修法需 `reconciliation_cases` 加专用计数列（`upsertCaseForWallet` existing 分支 +1）；代码已加 KNOWN LIMITATION 注释（`reconciliation-query.service.ts`）｜来源: 2026-07-04 V8 体检（Round3 遗留）

- [ ] **INTERNAL_BREAK 恒等破裂明细呈现**（2026-09-21 波五 T6 改写为余项）：**空表危险已除**（波五 T6：写入语义修正+三态呈现——`invariantStatus` 此前把普通 BREAK 也误记成恒等 FAIL，预门破时 `walletCount=0` 会渲染成「BREAK — 0 wallets checked」+ 全零卡片，看着像干净；现改为红色专用横幅+隐藏健康检查卡与钱包表，不再有「假干净」）。余项：**按币种呈现资产合计/负债合计/差额明细**——**方案已定（业主 2026-09-22 拍板甲案，排下周新功能轮）**：`ReconciliationRun` 加列 `invariantBreaks Json?`（一次迁移，重铺教义零兼容负担）→ INTERNAL_BREAK 收尾把 `computeInternalIdentity()` 的 `breaks[]`（账本/侧/资产合计/负债合计/差额五元组）原样落库 → `getRun` 下发 → 前端红横幅下渲染小表；只做呈现，不碰 BACKLOG:308 defer 的告警/收敛冻结/受控更正链。已否决丙案「详情页实时重算」——恒等是时点函数，事后重算随账本变动漂移，拿"现在算的"冒充"当时破的"（`decisions.md` 2026-09-22 条目）｜来源: spec §1.4 ｜ 2026-09-21 波五 T6 评审裁定（明细呈现本波不做）→ 2026-09-22 业主定甲案排期

- [x] **严重度分级跨资产不可比**（2026-09-02 平账 A 批发现）：`wallet-recon-run.service.ts` `computeSeverity` 用「最小单位 1 万」一个数——AED 是 100 元、USDT 是 0.01 元。本批「金额小」另立小额线（`recon-thresholds.constant.ts` 按币种），未借用严重度；修法：severity 阈值按币种进同一张常量表 ｜来源: 2026-09-02 平账 A 批 spec §0-12 ｜ **2026-09-21 波五 T5 销账**：`computeSeverity(currency, delta)` 改按 `SEVERITY_LINES_MINOR`（与小额线同居）索引，缺币种 fail-fast；终值 AED med=100/high=10,000（元）、USDT med=30/high=3,000（元），锚定既有小额线等值惯例，种子 12 案分布 AED L1/M4/H1、USDT L5/M1/H0，未触发整体下移

**留痕与手册**

- [x] **`RECON_CASE_OPENED` 审计 metadata 仍带 `walletRef`（内部 UUID）**（2026-09-03 平账 A 批终审）：`wallet-recon-run.service.ts` 开案审计的 metadata 直接放 walletRef；本批新增的两条账龄审计已改用 `walletNo` 业务键，开案这条应对齐（子主体已是业务键，只是 metadata 漏了）｜来源: 平账 A 批终审 triage ｜ **2026-09-21 波五 T8 销账**：`auditCaseOpened`/`auditCaseAutoHealed` 两处 metadata 的 `walletRef` 改 `walletNo`（业务号，`resolveWalletNo` 现成），铁律⑥对齐账龄两条审计既有口径

- [x] **财务查证手册「§四 附：演示场景对照」落后三波**：附录仍写 15 场景 10 案（一期半时代），现状是 **18 场景 12 案**（A 批 +账龄核销、B 批 +13/14/15、二期 +16/17、三期 +18 未授权转出）；场景号-成因码-处置-能不能平四列都要按 `scripts/recon-demo.ts` 现行 manifest 重排——演示者按号索引会翻错页。手册正文各节已随波收口，唯此附录三波没人回头 ｜来源: 2026-09-06 平账三期终审建议单独清理 ｜ **2026-09-21 波五 T10 销账**：`recon-cause-handbook.md` §四附录按现行 `demo/script.md` 18 场景重排，新增 16/17/18 三行成因码与处置，索引号与剧本一致

- [ ] **调账弹窗残存 side 锚推导（`prefill.explainedFlowId ? 'FROM' : 'TO'`）是否收编后端**：`ReconciliationAdjustmentCreateModal.tsx:221` 这一行是改记候选确认屏的「提交体锚字段」推导——判断这条差异是错记方（FROM）还是正主方（TO），只用于决定 `explainedFlowId`/`explainedExternalLineId` 两个锚字段该填哪个，不是展示业务判断（后端 `resolveAdjustmentPrefill` 已给出权威的 `reattributionSide`，前端这一行只是把它落到提交体的哪个字段名上）。波四评审、波五评审（2026-09-21）两波均判**不收编**——收编成本大于收益，留档供日后再议 ｜来源: 波四终审 + 波五 T10 文档收口复核

- [ ] **调账单的边界线守卫只查原单「存在」，不查「归属」** —— `adjustment.service.ts` 的 `relatedOrderExists()` 按单号在充值/提现/兑换三表查存在性即放行，**不校验这张单是不是本案客户的**。刻意划在这儿：spec §4 立的规则是「有原单 ⇒ KYT 已对它跑过」，存在性就是这条规则的字面内容；要「引错别人的单」成为问题，前提是操作员恶意，那落在 CLAUDE.md §3「管理员都是善意的」与禁做清单「边界防御」里。存在性检查已堵死 spec 点名的「凭空造钱」，剩下的是引错凭证的数据质量问题、不是闸门被绕。**留此一行是为了日后评 PRD 时不被当成遗漏** ｜来源: 2026-08-28 平账一期末站评审

- [ ] **跨钱包合成案件（`walletRef` 为空）不能记定性、不能开调账单**：`ReconciliationCase.walletRef` 可空，但 `ReconciliationDisposition` / `ReconciliationAdjustment` 的同名列不可空——波一摘类型逃逸时暴露（此前由 `(this.prisma as any)` 盖住，真撞上会在运行期炸成 Prisma 校验错）。波一已补显式 400 拒绝，**但"这类案子该怎么处置"业务上没有答案**：现状是开了案子却一个处置都点不了。需业主定：① 这类案子本来就不该开？② 还是该给它一套自己的处置？｜来源: 2026-09-19 清残留波一 Task 6

- [x] ~~**场景 9 正向分支（自愈）本波未实走，只走了负向分支**：场景 9 完整剧本是 UTC 14:00 / 迪拜 18:00 前铺场 → Hold·Next period → Re-reconcile → 外部行被迪拜日终收回、案子自愈；本波（波五）铺场时刻只覆盖了负向分支的实测截图，正向分支因铺场时刻错过迪拜日终窗口未能实走。合并后在 main 栈任一上午（迪拜日终窗口内）补走一次场景 9 正向分支并截图归档 evidence ｜来源: 波五终审 Important #2~~ —— **已补走**（2026-09-22 主栈合并后复位）：UTC 03:44 铺场（未过 14:00 门槛）→ REC20260922-007（Grace USDT）Hold·Next period（Cross-period timing）→ Re-reconcile（RUN20260922-2，cutoffAt 实测=业务日日终 2026-09-22T19:59:59.999Z）→ 案子唯一地从 OPEN 转 RESOLVED（matchedCount 7→8、softFlagCount 2→1，reconciliation_cases 全表核对仅此一条转出 OPEN）；证据 `doc-final/superpowers/checkups/2026-09-21-act6-wave5-evidence/after/scenario9-positive-{1-hold,2-resolved}.png` + `scenario9-positive-timestamps.txt`

## H. 第七幕 · 事后说得清（审计追溯）

> 讲「这笔事谁批的、依据什么、钱去哪了」这一幕的缺口。三域词表已换装，剩子表覆盖面与资金单审计栏。

- [x] ~~⭐ 🔴 **`audit_log_subjects` 子表覆盖面远小于设计前提，45 码里只有 ~7 码真正在用子表**：设计稿 §5.1 的立论前提是"一对 primarySubjectType+primarySubjectNo 装不下多主体，需要子表"，但 Task 11 端到端实测（真实 API 驱动 admin 停用/恢复/角色定义创建等流程）坐实：只有横切的 6 个 `APPROVAL_*` 码（经 `approvals.service.ts`）与 `AUDIT_LOG_QUERIED`（且仅当查询带 `ownerCustomerNo` 参数时）会调用 `persistSubjects` 写子表；其余 IAM（`ADMIN_INVITE_*`/`ADMIN_FIRST_LOGIN_*`/`ADMIN_ROLE_CHANGE_*`/`ADMIN_SUSPENSION_*`/`ADMIN_REACTIVATION_*`/`ADMIN_PASSWORD_RESET_*`/`ADMIN_MFA_RESET_*`/`ADMIN_ACCOUNT_LOCK_*`，共 25 码）与 CONFIG（`ROLE_DEFINITION_*`/`APPROVAL_POLICY_CHANGE_*`，共 8 码）、以及 `AUDIT_EVIDENCE_EXPORT_*`（3 码）在各自的 workflow service 里 `recordByActor`/`recordSystem` 调用**从不传 `subjects:` 数组**——只设置主表扁平字段。实测复现：`admin-suspension-workflow.service.ts` 让 `ADM2501010008` 挂了 4 条事件（`ADMIN_SUSPENSION_REQUESTED`/`APPLIED`、`ADMIN_REACTIVATION_REQUESTED`/`APPLIED`）的 `primarySubjectNo`，但 `SELECT COUNT(*) FROM audit_log_subjects WHERE subjectNo='ADM2501010008'` = 0，`GET /admin/audit-logs?subjectNo=ADM2501010008` 实测返回 `total:0`（必须改用 `primarySubjectNo=` 才能查到同样 4 条）。**验收标准 #6"按依据查得到"字面上仍算通过**（该标准原文限定的是"按审批单号"，approvals.service.ts 那 7 个码确实覆盖了），但设计稿 §5.1 举的例子（"充值单"为 PRIMARY、审批单只是其中一个 INSTRUMENT）说明子表原意是覆盖**所有** V1 主体，不是只覆盖审批单号——按这个更完整的意图，"某个 admin 用户/某条角色定义从生到死被谁碰过"这条监管索档能力目前并不成立。修法：把这 36 个码所在的 8 个 workflow service 补上 `subjects:` 数组（多数只需 1-2 行，模式已有 `approvals.service.ts` 可抄）。**澄清（2026-09-15 复检）**：波三~五给交易域新补的审计（冻结留痕 / 广播 OWNER subject / 报价三码）全在 V4/V5/V6 交易域，不在本条圈定的 V1 治理域 36 码范围内——本条数字不因此变化，勿误读为"已部分修复"。**订正（2026-09-15 第七幕体检）**：「ROLE_DEFINITION_*/APPROVAL_POLICY_CHANGE_* 共 8 码从不传」已不全对——`role-definition-modify-workflow.service.ts`（:246 等 4 处 `subjects: this.roleRelatedSubject(role.code)`）与 `admin-role-binding-change-workflow.service.ts`（:139 等 4 处）**已带 subjects**（主会话贴码复现）；仍零 subjects 的实测清单 = users/ 六个 workflow（invite/suspension/reactivation/password-reset/mfa-reset/mfa-binding，共 37 处调用，六文件 `grep -c "subjects"` 全 0）+ `role-definition-create-workflow`（4 处）+ `approval-policy-change-workflow`（3 处）+ 证据包导出族（`audit-evidence-export-workflow.service.ts` 零命中）+ `ADMIN_ACCESS_DENIED`（guard 无 subjects），约 29 码。修法样板不变（`approvals.service.ts:193-196`）｜Task 11 端到端验收实测新发现，无历史来源 ｜ 2026-09-15 第七幕体检订正数字~~ —— **已修**（2026-09-16 第七幕波二）：9 文件存量 48 处调用补 `subjects:`（实测 34 码，非约数"~29"——执行中订正：`admin-password-reset-workflow.service.ts:105` 的 action 是运行时变量 `recordConsumeOutcome`，字面 `grep "action: '"` 漏网，实现者逮回）——`identity/users` 六个 workflow（invite/suspension/reactivation/password-reset/mfa-reset/mfa-binding，37 处）+ `role-definition-create-workflow`（4 处）+ `approval-policy-change-workflow`（3 处）+ `audit-evidence-export-workflow`（4 处 3 码），逐处按镜像 PRIMARY 行 + 视情况补 RELATED/INSTRUMENT 行的统一规则（helper 化，样板照 `approvals.service.ts:193-196`），存量 48 处 + 新打点 2 处 = 50 处调用带 subjects、34 码 + 名册 47 码（`SUBJECTS_COVERED_ACTIONS`）同步落 `audit-actions.constant.ts` 供 `verify:audit` Q2 逐码断言全覆盖（波二 Task 9，变异测试红绿双证）；另 `MATERIAL_REQUEST_ISSUED` 改 `recordByActor` 带操作人 + `verifyMfaCode` 锁定/解封补 `ADMIN_ACCOUNT_LOCK_APPLIED`/`RELEASED`（同波，与下条"审计有痕无人"共享交付，避免重复记账）。走查实证（Task 10）：真实 API 驱动一个 ADM 邀请→首登→停用→恢复全弧线，审计页 Advanced·Related No 输该 ADM 号一次拉出 19 条事件全链（含 `APPROVAL_SUBMITTED`/`GRANTED` INSTRUMENT 行）。设计与逐文件清册见 `superpowers/specs/2026-09-16-act7-wave2-audit-attribution-design.md` §1；invite 家族 `primarySubjectType=ACCESS_CONTROL` 遗留、`role-definition-modify` 的 requestNo 不镜像 PRIMARY 两点不在本次修复范围内，另登记观察（见下）。

- [ ] **Q4 已升级为全称断言，但素材来源仍单一**（2026-09-16 第七幕波二重锚）：`verify:audit` 的 Q4 判据已从"任取一条 OWNER=CUSTOMER 自证"（Task 9 前）升级为"带 `ownerCustomerNo` 参数的 `AUDIT_LOG_QUERIED` 事件**全部**携带 OWNER=CUSTOMER 子表行"（`M>0 且 missing===0`，全称量化，不再是存在性判据），并经变异测试证明能咬人（抽掉任一这类事件的 subjects 行，判据即转红）——原"查询动作自证"的判据缺陷已解。**结构性限制仍在**：V1 治理域现实中仍然没有任何其它场景会把 CUSTOMER 设为某条治理事件的 OWNER（V1 域本身不直接操作客户实体），所以这条判据的素材来源依旧只有"审计查询动作自身"这一种场景，不是判据设计缺陷，是域内当前只有这一种素材。等三个交易域（充值/提现/兑换，这些才会有 `ownerCustomerNo` 意义下的客户关联事件）接入 `subjects` 后，Q4 才会有更多真实素材验证。判据代码见 `scripts/verify-audit.ts`，升级设计见 `superpowers/specs/2026-09-16-act7-wave2-audit-attribution-design.md` §5 ｜来源: Task 11 端到端验收实测新发现，无历史来源 ｜ 2026-09-16 第七幕波二升级重锚

- [x] ~~审计域两条详情路由仍用数据库 UUID，且两表明明有业务号没用~~ —— **已修**（2026-09-16 第七幕波一）：`audit/logs/:eventNo`、`audit/evidence-packages/:packageNo`（+download）前后端换装齐（controller/service findUnique 换业务号列 + App.tsx 路由 + 两处行点击 + RBAC 三码连动 `…_eventno`/`…_packageno`/`…_packageno_download`）；Owner ID 冗余渲染同波删除；隐藏调用点 `audit-evidence-export-workflow.service.ts:145` 传 `.id` 的 404 级潜伏 bug 顺带逮修。⚠️ 合并 main 后必重启后端 + `db:base:sync`（权限码变了）。原文：（铁律⑥正犯）：`audit/logs/:id`（表有 `eventNo`）与 `audit/evidence-packages/:id`（表有 `packageNo`）；另 `AuditLogDetailPage.tsx:362` 在 Owner No 旁冗余渲染 Owner ID（内部 UUID）。换装照三域交易前例 ｜来源: 2026-09-15 战役收官后复检（取数员 D 全量路由清点）

- [x] ~~`InternalFundAuditLog` 有读无写 → 资金单详情页审计列表永远空~~ —— **已修（2026-09-16 第七幕波三 Task 5）**：资金单详情页审计栏改甲案——直接读中央审计日志（`subjectNo=单号`（OR 语义命中主表∨子表），最近 10 条 + `View full trail →` 深链），`InternalFundAuditLog` 的读取链摘除；运营点开任何一张资金单，审计栏现在有真实事件。原文：Round 2 后零写入方，读取链还在——运营点开任何一张资金单，审计栏都是空的（踩铁律①「操作必留痕」的可见面）。补写状态变更 or 改读中央审计日志 ｜来源: 2026-07-03 死码 D6 改判（勿删表，有活读取链）；2026-08-26 分流迁入 PRODUCTION-NOTES，2026-08-28 判为业务缺口迁回

- [ ] **`InternalFundAuditLog` 表读写双死，留待下次动 schema 时删**（2026-09-16 第七幕波三）：读取链已随上条甲案摘除，写入方本来就没有过——`grep -rn "InternalFundAuditLog" src prisma` 只命中 `schema.prisma` 的模型声明与 `FundsOrder.auditLogs` 关系字段，`src/` 零引用。零引用纪律先登记，不单独为它开一次 migration，下次动 funds-layer schema 时顺手删表 ｜来源: 2026-09-16 第七幕波三 Task 9

- [x] ~~审计列表「Audit No / Keyword」检索框是假承诺——keyword 不搜 eventNo~~ —— **已修（2026-09-16 第七幕波三 Task 1）**：后端 keyword 的 OR 补第 8 列 `eventNo`（`audit-logs.service.ts:481`，落点自带注释"Audit No 假承诺修复（波三）"），DTO 说明同步改真；列表「Audit No」列显示的号原样粘回检索框，现在真能命中。原文：`AuditLogsPage.tsx:276` 占位文案承诺按 Audit No 检索，但后端 keyword 的 OR 恰好 7 列（action/primarySubjectType/primarySubjectNo/actorNo/ownerCustomerNo/traceId/reason，`audit-logs.service.ts:525-537`），不含 `eventNo`——把列表「Audit No」列显示的号原样粘回检索框，零结果。修法二选一：后端 OR 补一列 `eventNo`，或改占位文案 ｜来源: 2026-09-15 第七幕体检二问补检（主会话复现）

- [x] ~~**审计有痕无人：材料请求下发（在用）+ 客户 CRUD 三端点（零前端消费）的审计不带操作人**（2026-09-15 第七幕体检二问补检）：① `MATERIAL_REQUEST_ISSUED` 走 `recordSystem`——actor 已传进 `issue()` 却只用于开限制，下发这条审计查不到是哪位合规官干的（`material-request-issuer.service.ts:63-102` → `material-requests.service.ts:146`），这是在用链路（客户详情 Request Documents 按钮）；② `POST/PATCH/DELETE /customers*` 三端点同款 `recordSystem` 无 actor（`customers.service.ts:24/87/130`），且 controller 未把 `req.user` 传给 service——但管理台对裸 `/customers` 仅两处 GET（`CustomerDetail.tsx:252`、`CustomerManagement.tsx:175`），三个写端点零前端消费，属潜在死端点+潜伏归因缺口，动它前先定去留；③ 附：`verifyMfaCode`（密码重置 MFA 校验计数/锁定，`mfa-binding-workflow.service.ts:240-275`）零审计，姊妹方法都有——同族一并收 ｜来源: 2026-09-15 第七幕体检二问补检~~ —— **已修**（2026-09-16 第七幕波二）：① `MATERIAL_REQUEST_ISSUED` 改 `recordByActor` 带操作人——actor 已从 `issue()`/`register()` 两径穿进 `requests.create(...)`，不再是"传了没人用"；② 客户主表裸 CRUD 三端点（`POST/PATCH/DELETE /customers*`）连同 `CustomersService.create/update/remove` 三方法整体删除（岔口②业主拍板：管理台零消费、不做"手动建客户"），删前全仓（含 client-web/scripts/test）复核零引用；`rbac.catalog.ts` 三条 route 连动删除，`CUSTOMER_UPDATED`/`CUSTOMER_DELETED` 两码随之退役（`CUSTOMER_CREATED` 保留——真实写点在注册链 `customer-auth.service.ts`，未误伤）；③ `verifyMfaCode` 锁定/解封路径补 `ADMIN_ACCOUNT_LOCK_APPLIED`/`RELEASED` 两个打点，对齐姊妹方法 `verifyMfaLogin` 的既有形状。九文件 50 处（存量 48+新打点 2）调用清册、删除清单见 `superpowers/specs/2026-09-16-act7-wave2-audit-attribution-design.md` §2-§4（与上条"subjects 覆盖面"同轮交付，物证共享）。

- [ ] **invite 家族 `primarySubjectType=ACCESS_CONTROL` 遗留，与其余五个 users/ workflow（均 `ADMIN_USER`）不一致**（2026-09-16 第七幕波二观察）：`admin-invite-workflow.service.ts` 五个码（REQUESTED/DISPATCHED/CANCELLED/ACCEPTED/EXPIRED）的主表 `primarySubjectType` 历史上定的是 `ACCESS_CONTROL` 而号是 userNo（该文件 :434-435 注释自认"对齐同旅程"），波二补 subjects 时按总纲钉死"镜像主表原值、不改型"（改型是展示面/跳转面变化，越出本波纯写入面边界）——判据 2（按 Related No 查一生全链）按 subjectNo 匹配、不受类型影响，已实测不受影响；但类型不一致本身是既有的展示口径瑕疵，留给波三"跳转映射轮"顺手评估要不要统一改 `ADMIN_USER` ｜来源: 2026-09-16 第七幕波二 spec §1.2

- [ ] **`role-definition-modify-workflow.service.ts` 的 PRIMARY（requestNo）不镜像进子表，按 Related No 查不到该审批请求号本身**（2026-09-16 第七幕波二观察）：该文件 :50-53 注释明言"PRIMARY 已在主表两列上，只补 RELATED 不重复传"，与波二钉死的 `approvals.service.ts` 镜像先例口径不同（两先例在库打架，波二选了后者）；本波未回改前者（越出"纯留痕补齐"范围，且改动会牵动既有测试断言），按 Related No 搜这条修改请求自己的 requestNo 查不到（搜它关联的 role code 仍查得到），是既有口径的已知局限，非本波引入 ｜来源: 2026-09-16 第七幕波二 spec §1.1

- [ ] **`CUSTOMER_WRITE` 权限组随裸 CRUD 三端点删除后已零路由，但仍被两处角色绑定引用——已实证会真的挡住 COMPLIANCE_OFFICER 的角色改权流程，不是"尚未影响实际操作"**（2026-09-16 第七幕波二观察，2026-09-25 甲波一 T9 修复轮 1 核实升级）：`rbac.catalog.ts:847`（`ACTION_BUCKET_CATALOG` 的 `customer.manage_profile` 桶 groups）与 `:1060`（`RBAC_ROLE_GROUP_BINDINGS.COMPLIANCE_OFFICER` 绑定列表）两处仍引用 `CUSTOMER_WRITE`（行号随后续任务改动漂移，本次核实当日行号），但该权限组挂靠的三条路由（`POST/PATCH/DELETE /customers*`）已随岔口②整体删除——`role-definition-modify-workflow.service.ts:19-21`/`role-definition-create-workflow.service.ts` 的 `VALID_PERMISSION_GROUPS` 都是从 `RBAC_PERMISSION_DEFINITIONS.flatMap(p => p.groups)`（即"真实挂着路由的组"）派生，`CUSTOMER_WRITE` 零路由后已不在这张合法集里；COMPLIANCE_OFFICER 的绑定列表原样带着 `CUSTOMER_WRITE`，导致对该角色发起 modify 请求（哪怕只是原样重提当前 groups，不新增不删减）必然 400——**这不是"空壳、暂不影响"，是 COMPLIANCE_OFFICER 角色改权流程当前整个不可用**。复现：`bash scripts/on-stack.sh self verify:rbac` → `✗ V2 改角色不丢权限 · COMPLIANCE_OFFICER —— 技术官提交 modify 失败: 400 {"message":"Invalid permission groups: CUSTOMER_WRITE",...}`。修法：从 `:1060` 的 COMPLIANCE_OFFICER 绑定列表删掉 `CUSTOMER_WRITE`（连带核实 `:847` 桶是否也该退役或换绑真实存在的组）；下次动权限包/RBAC catalog 时一并处理，别只查 bindings 就放行。**影响面扩注（2026-09-25 甲波一 T11）**：`role-definition-create-workflow.service.ts` 的 `VALID_PERMISSION_GROUPS` 与 modify 是同一份派生逻辑（`RBAC_PERMISSION_DEFINITIONS.flatMap(p => p.groups)`），且 `customer.manage_profile` 桶在 `/admin/iam/action-buckets`（`RolesPage.tsx` 建角色弹窗的桶数据源）里没有 `restricted`/`forcedOn` 标记、是一颗正常可勾选框——新建角色时勾了这个桶同样会把 `CUSTOMER_WRITE` 塞进 `permissionGroupCodes` 提交，命中一模一样的 400，不只是"改已有角色"才炸。**复现（create 路径，已实测）**：`curl -s -X POST http://localhost:3100/admin/iam/role-definitions -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"roleCode":"PROBE_ROLE","roleName":"probe","permissionGroupCodes":["CUSTOMER_WRITE"],"changeReason":"repro"}'`（`$TOKEN` 为任意持 `IAM_ROLE_DEFINE` 的管理员登录后的 access_token，如 `admin@fiatx.com`）→ `400 {"message":"Invalid permission groups: CUSTOMER_WRITE","error":"Bad Request","statusCode":400}`，未落库、无需清理 ｜来源: 2026-09-16 第七幕波二 spec §4；2026-09-25 甲波一 T9 修复轮 1 评审 I2 核实升级；甲波一 T11 影响面扩注 + 复现命令实测

- [ ] **IAM 角色 Modify"原样重提"不保原样——View 类多组桶按桶展开授组/收组，客户域仍在（事故域已修）**（2026-09-25 甲波一 T9/T11）：Modify 弹窗把"桶已持有"（OR 语义：桶内任一组在当前角色码集里即算持有）与"提交时展开哪些组"（桶内**全部**组都会进 `proposedPermissionGroups`）混成一件事——同一个组被多个桶共享、角色只实际持有其中的窄组时，原样重提会把宽组一并带出。事故域的 `incidents.view` 桶同款问题已在 2026-09-25 甲波一 T9 修复轮 2（Ruling-13，commit `0abaf132`）改成只挂 `INCIDENT_READ` 单组堵死；客户域的 `customer.view` 桶（`rbac.catalog.ts:841` 附近，`groups: ['CUSTOMER_READ','CUSTOMER_RESTRICTION_READ','CUSTOMER_TAG_VIEW']`）是同一形状的另一实例，未修：CFO 只持 `CUSTOMER_TAG_VIEW`（该文件 CFO 绑定列表旁有设计注释"不带 CUSTOMER_READ——CFO 不查客户资料"），但该桶因 OR 语义展示为"已持有"，一次原样重提 Modify 会把 `CUSTOMER_READ`/`CUSTOMER_RESTRICTION_READ` 一并授出（模拟脚本实测 `gainedCodes=7`，见 T9 报告"顺带发现"节）。另需业主定夺一点（同批观察，未判定是否为缺陷）：`gov_approval_policies.manage` 桶标了 `restricted: true`，受限桶设计上不进入 Modify 的预选/提交，导致 SENIOR_MANAGEMENT_OFFICER/CISO 这两个当前持有 `GOV_APPROVAL_POLICY_WRITE` 的角色，只要提交一次原样重提 Modify（哪怕不碰任何复选框），实际提交的 `proposedPermissionGroups` 里就不含这个组——按"受限桶需要每次自觉重新授予"理解是设计意图，按"Modify 不该在没人碰复选框时悄悄收权"理解是缺陷，两种读法都成立，需要业主拍板哪个是对的。复现（customer.view 一侧，仿 T9 报告"提交组列表实证"手法）：交互式登录 CFO 角色管理员 → 打开 CFO 角色页 Modify → 不改复选框，只填 Change Reason → Submit Request → 查 `role_definition_modify_requests` 表新行的 `proposedPermissionGroups` 列，会看到 `CUSTOMER_READ`/`CUSTOMER_RESTRICTION_READ` 出现在其中（`RBAC_ROLE_GROUP_BINDINGS.CFO` 源定义里没有这两个组）｜来源: 2026-09-25 甲波一 T9 报告"顺带发现"节（commit 0abaf132 附近，实现者已 spawn_task 一条重复建议，无需重复处理）；T11 登记

- [ ] **治理域 demo 脚本缺位——`verify:audit` 名册阈值只能钉 2/47，`demo:all`/`verify:audit` 的 Q4/Q5/Q6 全靠人工走查补事件才转绿**（2026-09-16 第七幕波二 Task 9/10 实测）：`demo:*` 全系脚本（`setup/deposit/swap/withdraw/in-transit/all`）都是交易域，没有一个会走管理台登录/邀请/角色变更/MFA/审计查询等治理域 HTTP 路径——47 码名册里 45 个治理域码（`ADMIN_INVITE_*`/`ADMIN_SUSPENSION_*`/`ROLE_DEFINITION_*`/`ADMIN_MFA_RESET_*`/`AUDIT_EVIDENCE_EXPORT_*` 等）`demo:all` 永远摸不到，`MIN_EXERCISED_ROSTER_ACTIONS` 只能钉在实测上限 2（横切审批码）；Q4（带 owner 参数查询）、Q5（拒绝有痕）、Q6（谁查过审计日志）三条判据在纯 `demo:all` 库上全部是"0 条、无法判断"，必须靠 Task 10 这类人工 runbook（真实 API 走一遍 ADM 生命周期 + 故意错码一次 + 发一次 `ownerCustomerNo` 查询）才能把三条判据喂出真实素材、转绿。这不是判据代码的缺陷（Task 9 变异测试已证明能咬人），是"防复发闸"的实际保护面小于名册字面覆盖——是否需要一个治理域专属的 demo/e2e 脚本把 45 码常态化纳入自动化验证，建议登记为独立任务评估，本波不做 ｜来源: 2026-09-16 第七幕波二 Task 9 report + Task 10 runbook 实测

- [x] ~~**invite 派发失败分支漏 INSTRUMENT 行——`event.approvalNo` 在手却只传单参**~~ —— **已修**（2026-09-16 本轮）：`:276` 补 `event.approvalNo`，同处 actorNo/actorDisplayName 由 `decisionByUserId` 改 `decisionByUserNo`（顺手同族，spec §2.3）；jest 红绿双证。原文（2026-09-16 波二终审滚存②）：`admin-invite-workflow.service.ts:276`（executeInviteDispatch 失败径）的 subjects 只有 PRIMARY 镜像行，而同文件 CANCELLED（:310）同款 `event.approvalNo` 都带了 INSTRUMENT——spec §1.2 规则③的字面违约。仅技术失败径触发、演示不可见，按 review-rubric 不构成本波缺陷；1 行修，波三动该文件时顺手收 ｜来源: 2026-09-16 波二终审

- [x] ~~**审计详情页对内部 UUID 的过滤有两个已证/待核的残口，总纲判据 4（零 UUID 落屏）末波收口前须评估**~~ —— **已修**（2026-09-16 本轮）：残口① causationId 摘出 `stripInternalIds` 放行名单 + 详情页展示摘除；残口②"待核"定案——直因是 Payload 区 JsonBlock 从不经 strip（Raw Record 才 strip），已改为三块统一过 strip；探针截图 `04-detail-strip-probe.png`。原文（2026-09-16 波二终审顺手观察）：已证——`causationId` 在 `stripInternalIds` 放行名单内（`admin-web/src/utils/stripInternalIds.ts:4`，波一岔口①设计如此），但其**值**常是审批内部 UUID（approvalId 作 causation），Raw Record 屏上可见；待核——终审称 METADATA 区亦落屏 `approvalId`/`suspendedByUserId` 等键，与正则过滤（`/^id$|Id$|Ids$/` 应剔除这些键）矛盾，直因未查（可能是该区未过 strip、或另一渲染路径），波三未做该核实（末波范围外），留独立评估 ｜来源: 2026-09-16 波二终审（机制表述经主会话核订）

- [x] ~~审计详情页没有"Related Subjects"展示区，PRIMARY/RELATED/INSTRUMENT 子表数据只能在 Raw Record 的 JSON dump 里肉眼找~~ —— **已修（2026-09-16 第七幕波三 Task 3）**：详情页新增 Related Subjects 分组展示区（按角色分组、映射命中即可点跳转）+ Action 下方人话标签（如 "Deposit Seize Requested"），不用再去 Raw Record 里肉眼扒 JSON；走查截图 `06-detail-subjects.png` 实证。原文（2026-09-16 第七幕波二 Task 10 走查发现）：后端 `audit-logs.service.ts → findOne()` 早已把 `subjects` 数组塞进详情接口响应（:1084-1088），但 `admin-web/src/pages/AuditLogDetailPage.tsx` 的 `AuditLogDetail` 接口从未声明 `subjects` 字段，正文也没有任何一处读取/渲染它——子表数据唯一的可见途径是"Raw Record"区块把整个 detail 对象原样 `JSON.stringify` 出来，`subjects` 恰好作为其中一个 key 出现在那坨 JSON 末尾（Task 10 走查截图 `2026-09-16-W2-suspension-applied-detail.png` 实测坐实）。战役总纲判据 2 的字面"输 ADM 号拉一生全链"在**列表页**（Related No 搜索）是真正做到的（逐行看得到每个事件），但**详情页**看不到"这一条事件挂了哪些相关主体"这个结构化视图——不算判据 2 的验收失败（列表页已经够用），但审计域自己作为"演示内容"时这处观感缺口值得记一笔，波三如果要做检索/UX 收口，建议顺手补一个 Related Subjects 小节（PRIMARY/RELATED/INSTRUMENT 分组展示） ｜来源: 2026-09-16 第七幕波二 Task 10 走查截图实测

- [x] ~~correlationId 旅程检索前端无入口，v1-governance §4 承诺讲不出~~ —— **已修（2026-09-16 第七幕波三 Task 3）**：列表页新增 Correlation ID 筛选栏，详情页新增 `Correlation ID (Journey)` 字段 + `View journey →` 按钮（点击即按 `?correlationId=` 深链过滤同旅程全部事件）——`v1-governance.md` §4 那句承诺现在演得出，同批已补一句"已兑现"。原文：后端 DTO 支持 `correlationId` 过滤（`audit-log.dto.ts:314-315`），但管理台审计列表页筛选无此栏、详情页接口与渲染均无此字段（`grep -n "correlationId" admin-web/src/pages/AuditLogsPage.tsx AuditLogDetailPage.tsx` 零命中，主会话复现）——`modules/v1-governance.md` §4 第七幕段承诺「按 correlationId 看『一次邀请』的完整旅程」演不出。修法二选一：补前端筛栏（后端现成），或改文档措辞 ｜来源: 2026-09-15 第七幕体检

- [ ] **审计跳转甲案映射覆盖 18/27——9 类真实落库主体未映射，详情页显纯文本**（2026-09-15 第七幕体检；**订正 2026-09-16 第七幕波三 Task 6**：`WITHDRAWAL_FEE_LEVEL`/`SWAP_FEE_LEVEL` 两族已补映射；`AuditEntityTypes` 15 个孤儿键已同批清零，常量收窄到 27 键（清孤儿后再加新收编的 `FUNDS_ORDER`，净 27）——覆盖率现为 **20/27**，其余 7 类仍未映射，未全销）：`auditEntityRoutes.ts` 映射 18 类之外，ACCESS_CONTROL（22 写点，最大头）、AUDIT_EVIDENCE_PACKAGE、INBOUND_TRANSFER_SIGNAL、APPROVAL_POLICY、RECON_DISPOSITION、CUSTOMER_TAG、MATERIAL_REQUEST 七类有真实审计记录但仍点不动。AUDIT_EVIDENCE_PACKAGE 详情路由本身是 UUID（属甲案「映射了也 404、不硬造」既定口径，先修下条路由再谈映射）｜来源: 2026-09-15 第七幕体检 ｜ 2026-09-16 波三 Task 6 订正（主会话 `auditEntityRoutes.ts`/`AuditEntityTypes` 复现）

- [x] ~~审计可见面三处 UUID 落屏（Owner ID 之外的同族补充）~~ —— **已修**（2026-09-16 第七幕波一）：actorId 兜底两处改显 `—`；Selected Events 改渲 `manifest.recordDigests[].eventNo` 业务号 chips；Raw Record/Filter Snapshot/Manifest/Package Body 统一过 `stripInternalIds()`（岔口①乙案：渲染与 Copy 过滤、下载文件全量保真——已实测下载 JSON 含内部 id 而屏上零 `"id":` 键）。原文：（2026-09-15 第七幕体检）：① actorNo 缺失时兜底渲 `actorId`——详情页 `{detail.actorNo ?? detail.actorId}`（`AuditLogDetailPage.tsx:313`）、列表页 `item.actorId.slice(0,8)+'…'`（`AuditLogsPage.tsx:551`）；② `EvidenceExportDetailPage.tsx:441-457`「Selected Event IDs」逐个渲染内部事件 UUID 数组；③ 审计详情与证据包详情两页 Raw Record 区整条 JSON dump 含 `id`/`actorId`/`entityOwnerId` 且带 Copy 按钮（`AuditLogDetailPage.tsx:138-168/420`）——与「审计域两条详情路由」条同轮收 ｜来源: 2026-09-15 第七幕体检

- [x] ~~证据包详情页零渲染审批背书~~ —— **已修**（2026-09-16 第七幕波一）：详情页新增 Approval 区四件（Approval No 蓝链跳审批中心 + 状态徽章 + 裁决角色 + 时间），走查实证 PENDING→APPROVED 全程可见。原文：（2026-09-15 第七幕体检）：`EvidenceExportDetailPage.tsx` 的 `approvalCase` 字段接口声明（:24-35）但正文零引用，MLRO 在审计四页 grep 零命中——「导出要 MLRO 背书」这句详情页讲不出，只能靠列表页 Approval No/Status 两列 ｜来源: 2026-09-15 第七幕体检

- [x] ~~第七幕一行级小账（原三件，①已随波一销）~~（2026-09-15 第七幕体检）：~~① `AUDIT_EVIDENCE_EXPORT_DETAIL_READ` 前端权限常量零引用~~——已删（2026-09-16 波一 Task 4 连带清理）；~~② `audit-log.dto.ts:348-351` keyword 注释写「action/module/entity/reason」，实现是 7 列且无 module/entity 字段~~——**已修（2026-09-16 波三 Task 1）**：注释已改真为 8 列 OR（含新补 `eventNo`，见上条「Audit No 假承诺」）；~~③ FUNDS_ORDER 作 `primarySubjectType` 是字面量未入 `AuditEntityTypes`（`push-order.service.ts:250`、`funds-order-advance-workflow.service.ts:47`）~~——**已修（2026-09-16 波三 Task 6）**：9 处字面量全部换成 `AuditEntityTypes.FUNDS_ORDER` 常量 ｜来源: 2026-09-15 第七幕体检 —— **三件全销（2026-09-16 第七幕波三）**

- [x] ~~审计证据包导出的 deposit/withdraw 证据链构建函数引用 5 个不存在的 Prisma 模型，从出生起未工作~~ —— **已修**（2026-09-16 第七幕波一，业主 2026-09-13 拍板归此轮）：三域 builder 改业务号直查真实表（deposit/withdraw 主查询 `depositNo`/`withdrawNo` in、swap 沿既有解析步且链改宽查询同源）；幽灵段**全退役**（实际比本条记的更大：5 模型外加 `journal`/`clearing` 幽灵与 `payouts` 死键，snapshots 从 20 键收敛到 7 个真键）；测试反转为行为化 mock（按 where 真过滤，假绿根因"mock 无视 where"根治）。走查实证：真实包 EVP260915143063 下载后 deposits 2 + withdraws 1 非空。原文：`audit-logs.service.ts → buildDepositSnapshots()`/`buildWithdrawSnapshots()`（约多处）调用 `db.kytCase?.findMany`/`db.travelRuleCase?.findMany`/`db.workflowDecisionRecord?.findMany`/`db.complianceAlert?.findMany`/`db.complianceIncident?.findMany`——这 5 个模型在 `schema.prisma` 里根本不存在，`?.findMany` 恒为 `undefined`，三元表达式恒走 fallback 空数组分支，从未真正查询过。**波三 Task 9（审计跳转甲案）把这两个函数的 `workflowIds` 输入从已删除的幽灵字段 `entityId` 切到真实存在的 `primarySubjectNo` 后**，`workflowIds` 从近乎恒空变成真的装着业务号，随后 `db.depositTransaction.findMany({where:{id:{in: workflowIds}}})`/`db.withdrawTransaction.findMany({...})` 这两条查询**会真执行**（不再被 `!workflowIds.length` 短路），但 `where` 按的是内部 `id`（UUID）列，`workflowIds` 装的却是业务号字符串（如 `DEP2601011234`），永远匹配不上——**最终可见结果仍是空**，只是从查询从未执行变成查询执行了但按业务号匹配内部 id 列而落空。**不是完全死代码，勿写成可放心大改**——将来要修，除了给 5 个 ghost 模型立表（或整段退役），`depositTransaction`/`withdrawTransaction` 两处 `where` 也得从 `id` 改成 `depositNo`/`withdrawNo`。**对照**：`buildSwapSnapshots()` 走 `resolveSwapExportSelectionContext()` 先把业务号解析成真实内部 id 再查询，SWAP 链已随 Task 9 真修复，充值/提现两域未跟进这层转换 ｜来源: 2026-09-13 波三 Task 9；同日业主拍板归第七幕（审计追溯）轮修

- [ ] **列表页 Actor 列对客户自助操作暴露裸 UUID**（2026-09-16 审计两页重设计走查）：写入侧问题——交易域客户自助动作（如 `WITHDRAW_CREATED`）的审计 `actorNo`/`actorDisplayName` 落的是客户内部 UUID 而非 customerNo（管理台审计列表 Actor 列直接渲染，铁律⑥）；admin 操作与 SYSTEM 均正常业务号，仅客户 actor 写歪。物证：`superpowers/checkups/2026-09-16-audit-pages-walkthrough/01-list.png`（两行 `WITHDRAW_CREATED` 的 Actor 列裸 UUID，评审放大坐实）。修法方向：交易域审计写入点把 customer id 换 customerNo（同族先例：波四广播冻结 OWNER subject 的 ownerNoSource 处理）｜来源: 2026-09-16 审计两页重设计走查

- [ ] **状态迁移类审计事件不带 amount/currency**（2026-09-16 审计两页重设计走查）：全库只有 `*_CREATED` 三码写金额（旧主库 187/1198），`DEPOSIT_APPROVED` 等状态边审计恒 null，详情页金额行条件不渲染（行为正确）；若要"这笔批了多少钱"在审计详情直读，需状态边写入点补 amount。观察级，演示可从 Entity 蓝链跳单据详情看金额，不急｜来源: 2026-09-16 审计两页重设计走查

- [ ] **波二遗留：`FILING_SUBMITTED` 的 `externalRef`、`FILING_ENTRY_LOGGED` 的 `kind` 只进审计 `extra` 顶层、不落库**（2026-09-26 战役甲波三 T3 升档评审白2）：`audit-logs.service.ts#recordByActor` 建 `AuditLogEvent` 行时只认一份白名单已知列（`reason`/`fromStatus`/`toStatus`/`metadata`/`approvalNo`/...），调用点塞进 `extra` 顶层的键只用来过 `assertActionSpec` 的必填字段检查，不在白名单里的键（如 `externalRef`、`kind`）不会写进任何真实列——审计详情页这两条事件本身查不到该值（数据没丢：`externalRef`/`kind` 各自落在 `RegulatoryFiling.externalRef`/`RegulatoryFilingEntry.kind` 主表列，只是这一条审计事件自己没有）。波三 T3 修 1 已把同族新码 `FILING_CLOSED_NO_FILING` 的 `noFilingReason` 改成两条腿都走（`extra` 顶层过闸 + `reason` 真实列落库），波二这两处原样未动，非本波引入、也未在本波修 ｜ **复现**：`prisma.auditLogEvent.findMany({ where: { action: 'FILING_SUBMITTED' } })` 任取一条，`metadata` 里没有 `externalRef` 键（metadata 本身非空，形如 `{filingNo, type, chainDeadlineSetFor}`），即便调用点当时传了 `externalRef`——复审实查订正，原稿"reason/metadata 均为空"不准 ｜来源: 2026-09-26 战役甲波三 T3 升档评审白2

- [ ] **制裁定性 CLEARED/CONFIRMED 落地后，PARTIAL 期发出的补料请求仍悬置 `PENDING_SUBMISSION` 无人收口**（2026-09-26 战役甲波三 T4 升档评审 P3 实证）：PARTIAL 出口落地时经 `material-request-issuer` 自动发一条中性补料请求（身份证件复核，`restrict:false`，不挂新便签）；若该客户之后二次定性为 CLEARED（排除）或 CONFIRMED（确认），`SanctionDispositionWorkflowService` 只处理限制便签与报文单，从不触碰这条材料请求行——它不会被作废（`MATERIAL_REQUEST_CANCELLED`）也不会被标记无关，客户端「去交材料」入口继续挂着，客户可能还在为一个已经有结论的排查交材料。业主未给口径（CLEARED 时该不该自动 CANCEL 这条请求、CONFIRMED 时又如何，还是留给人工判断），暂不处理 ｜来源: 2026-09-26 战役甲波三 T4 升档评审 P3

## I. 贯穿多幕（通知 ｜ SLA ｜ 杂项）

- [ ] **处置标签（dispoTag）无优先级表，多标签同发时"数组最后一个赢"**：`kyt-verdict-handler.base.ts:120` 与 swap 侧同款循环均为纯赋值覆盖——同一条拒绝裁决同时带 FROZEN_BY_MLRO 与 RETURN_TO_SENDER（充值）/ FINAL_REJECTED（提现）时，单据结局取决于 Sumsub 发送数组的顺序。业主 2026-09-13 已裁定**要给优先级表**，内容待定（建议照场景标签"收紧方向优先"先例：冻结 > 退回 / 终局拒绝）；《交易合规裁决》v2.0 §4.2 与 §10 Q1 在引 ｜来源: 2026-09-13 业主 webhook 四规则会话裁定⑦
- [ ] **`assertTradingEligibility` 生产码零调用方**（波五创建即冻把三处入口换成 `assertTradingIntake` 后成孤儿，仅 e2e 与注释引用）：零引用纪律先登记不删 ｜来源: 2026-09-15 波五终审 Minor#3
- [ ] **订单列表页去轮询、改"信号+拉取"推送（小专项，脑暴已完成待立 spec）**：现症=Frank 兑换历史每 3 秒闪一次（`Swap.tsx:913` 后台刷新把表体换成 Loading 行；`:554` 自刷对波五后永久非终态的冻结单永不停，10 秒 4 次 GET 实测复现）。业主 2026-09-15 拍板方案=三页统一"进页拉一次 + 手动刷新 + 订单状态更新信号触发拉"，Swap 3 秒定时器整段退役。已定设计三点：①信号零内容、数据永远走既有客户面白名单 REST（invalidate-on-signal，推送通道零新增 tipping-off 面）；②**只在客户面收敛后状态变化时发信号**（判据 `toCustomerXStatus(from)≠toCustomerXStatus(to)`——冻结落地收敛前后都是"处理中"不发，信号时序也不泄露执法动作）；③握手验 JWT 按 token 身份入房（门不可绕，现孤儿 gateway 是客户端自报 customerId），断线交 socket.io 自带重连不加兜底。地基现成：三域 `*_STATUS_CHANGED` 域事件字段对称（`domain-events.constants.ts:11-64`）+ 孤儿 `notifications.gateway.ts`（socket.io 房间机制，零调用方零消费，接活它）。附带收益=走查"⚡喂完切客户端看"各站三域客户屏自动翻页。边界：I1 通知本体（消息中心）仍不做，这是传输层信号 ｜来源: 2026-09-15 Frank 兑换列表闪烁排查（根因三段链：FROZEN 收敛"处理中"永非终态 × 3 秒自刷 × loading 换表），业主裁定不做止血直接专项

> 多幕都会碰到的横切项——改一处多幕同时受益。

- [ ] ⭐ 🔴 **通知 send/retry = STUB**：`core/notifications/` 只有 WebSocket `NotificationsGateway`，无 email/webhook/失败重试实现——roadmap 标 Notification send/retry ✅ MVP 为过度声明；这是 V4-V6 各版本"通知未接"的根因（本体没做，不是没调）｜来源: 2026-07-04 V1 体检

- [ ] **列表页「仅看已超时」是前端过滤，只对当前页生效**：三域 `{Deposit,Withdraw,Swap}TransactionList.tsx` 的「仅看已超时」复选框均在 `useMemo` 里对当前页 `items` 客户端过滤（`formatSlaRemaining(...).tone === 'breached'`），后端列表查询无对应的 `slaBreached`/`slaBreachedOnly` 参数——勾选后只在当前分页内筛选，翻页/换页大小会丢失筛选效果，与既有 `needsReviewOnly` 同款局限（三域列表页均有——充值列表页 `DepositTransactionList.tsx:242` 的注释就自述"与下方 needsReviewOnly 同类局限"）。代码注释已自述该限制（"Backend has no slaBreached query filter yet; apply client-side over the current page only"）｜来源: 2026-08-21 SLA 批次

- [ ] **软破线后 `slaBreached` 会一直为 true 直到状态变化**：`markSlaBreached(id)`/等价方法只做单字段更新，`resolveSlaFields()` 是唯一能把它归 `false` 的路径，只在下一次状态迁移时触发。若运营处理了软破线单但没有推动状态（例如只加了备注、或问题本身要等外部条件成熟），红标不会自动消——UI 上看起来"一直超时"，即便运营已经在处理｜来源: 2026-08-21 SLA 批次

- [ ] **时长是硬编码常量，无 admin 配置界面**：`DEPOSIT_SLA_MINUTES_BY_STATUS`/`WITHDRAW_SLA_MINUTES_BY_STATUS`/`SWAP_SLA_MINUTES_BY_STATUS` 均是各自 service 文件里的 TS 字面量常量，改时长需改代码重新部署；三域此前各有一套不同的可配置性历史（兑换曾经有 `SWAP_COMPLIANCE_TIMEOUT_MS` env 覆盖，本批已删除该开关，统一成与另外两域同款的纯代码常量），现状是**三域一致地**没有任何 env/DB 层面的运行时可配置项。BACKLOG 旧条目「60 秒合规超时未经真实 Sumsub 延迟校准」的具体诉求②（"改成可配置项"）实质上仍未完成，只是数字来源换成了业主裁定的业务口径而非未标定的技术猜测 ｜来源: 2026-08-21 SLA 批次

- [ ] **「按键 × 按状态」置灰精度**：充值/提现的 ⑧ On hold 在非 `COMPLIANCE_PENDING` 上是纯 no-op（后端 `decideVerdictLanding` 有 `verdict==='onHold' && status!==COMPLIANCE_PENDING → IGNORE`）却仍可点。方向安全（不误灰），修法需要引入「按键 × 按状态」矩阵 ｜来源: 2026-08-23 第五批 Task 7 审查

- [ ] **`tags: string[]` 三域 Sumsub DTO 都声明、全 admin-web 零渲染**（后端 `parseDetail` 确实在填）｜来源: 2026-08-23 第五批 Task 2 审查

- [ ] **管理台兑换详情屏上三处内部 ID**：`SwapTransactionDetail.tsx:537-539` 三个 InfoField 渲染 Trace ID / From Asset ID / To Asset ID（均内部 id，mono 直显）——资产该显 currency，traceId 是否保留待业主定（排障用 vs 铁律⑥）｜来源: 2026-09-15 战役收官后复检

- [ ] **`pricing.types.ts` 三个零引用死接口**：`SwapPairEntry`/`WithdrawalAssetEntry`/`WithdrawalPolicyRestrictions` 声明后全仓零引用（含本文件；`grep -rn "\bSwapPairEntry\b" src admin-web/src client-web/src scripts test` 仅声明行）——战役前老残留，零引用纪律先登记，下次动 pricing-center 顺手清 ｜来源: 2026-09-15 战役收官后复检（取数员 B，主会话复现）

- [ ] **`fx-rule-strong` 从未注册进 tailwind 具名色，两处工具类靠兜底渲染**（预存量，黑白模式终审机制订正后表述）：`CustomerDashboardLayout.tsx:259` 面包屑 `text-fx-rule-strong` 靠 currentColor 兜底（观感可用）；`CustomerRegister.tsx:647` 未勾选框 `border-fx-rule-strong` 兜的是 preflight `#e5e7eb`——**浅色白底上近乎隐形**（黑白模式上线后该影响从理论变实际）。修法：tailwind colors 注册 `'fx-rule-strong': 'var(--fx-rule-strong)'`（变量双色板已备好）｜来源: 2026-09-15 黑白模式 T1 评审发现、终审机制订正

- [ ] **滚动条 thumb 常态色未 token 化**：`client-web/src/index.css` `::-webkit-scrollbar-thumb` 常态 `rgba(245,237,224,0.1)` 是深色板暖白值——浅色下近不可见（功能可用，观感不完整）。收进 `--fx-*` 双色板 ｜来源: 2026-09-15 黑白模式 T1 评审

- [ ] **客户端日期走浏览器 locale 渲染，中文系统上 UI 出中文**（如 Profile 页 "Member since 2026年9月15日"）：`toLocaleDateString/toLocaleString` 无显式 locale，演示机中文 macOS 即显年月日——源码中文扫描抓不到的形态，历代英文化轮全部漏网。如需恒英文须全站钉 `'en-US'`/`'en-GB'`（涉及三端多处调用点，单独一次收）｜来源: 2026-09-15 黑白模式走查顺带发现

- [ ] **三域客户面 payload 仍带内部 `id` 键**（铁律⑥尾巴·payload 层，屏上不渲染）：`toCustomerDepositView`/`toCustomerWithdrawView`/`toCustomerSwapView` 首键均为 `id: item.id`——客户端三个列表页仍拿它当 React row key（`Withdraw.tsx:588`/`Deposit.tsx:885` 等），摘除需前后端双改（key 换业务号）。2026-09-15 详情增强终审裁定本支不修留账：DevTools 可见但屏上零渲染，演示零收益；下次动客户面契约时连坐收掉 ｜来源: 2026-09-15 详情增强 Task 7 评审发现、终审裁量

- [ ] **`UpdateInternalFundStatusDto` 零引用死 DTO**：`src/modules/funds-layer/dto/internal-fund.dto.ts:82` 声明的 DTO 全仓零消费方（`grep -rn "UpdateInternalFundStatusDto" src admin-web/src client-web/src` 仅命中声明本身一处）；波五 Task 10（前端收口）扫描资金单详情页字段时顺带发现，本波未删——零引用纪律先登记，下次动 funds-layer/`InternalFund*` 命名债（见 `modules/v6-swap.md` §6）时一并清理 ｜来源: 2026-09-14 波五 Task 10

- [ ] **列表页分页收口后仍有 12 个未套 `ListFooter`**（2026-09-16 第七幕波三 Task 1 订正：`AuditLogsPage` 已收口，13→12）：波五 Task 10 把 10 个"重影"（手写 Showing 计数 + 裸 `Pagination` 自带计数打架）形状的列表页换成 `ListFooter`（全仓累计 13 个在用）后，另有 12 个维持原状——8 个本身不是重影形状（裸 `Pagination`、无手写计数打架：`WithdrawQuoteList`/`SumsubEventsPage`/`SwapQuoteList`/`InternalTransferList`/`ReconciliationCasesListPage`/`ReconciliationRunsListPage`/`IncidentListPage`/`ReconciliationAdjustmentListPage`）、4 个有重影但 props 映不上现有模板（`SwapFeeLevelList`/`WithdrawalFeeLevelList`：`defaultOnly` 筛选态总数改口径、整页隐藏分页；`CustomerManagement`：命中 `restriction` 筛选带额外提示后缀；`WithdrawalAddressList`：address→addresses 不规则复数，模板计数文案固定只加一个 `s`）——后 4 个要收口须先扩展 `ListFooter` 模板（后缀槽位 / 不规则复数 / 子集总数口径）。清单详见 `admin-web/src/components/common/ListFooter.tsx` 头注 ｜来源: 2026-09-14 波五 Task 10

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

- [ ] **战役收官后复检攒下的文档/注释小账（一次收口，全部一行级；剩①③④⑤未销）**：① 波五两件功能文档零覆盖——「客户面词表 SUCCESS/DECLINED」与「D10 L1②格因由+便签号」在 modules 三篇 + script.md 全零命中（grep DECLINED / restrictionNo 均空）；~~② `demo/script.md:217` 仍写「兑换 22 码」，实数 26（v4/v5/v6 三篇的 47/33/26 已对）~~——**已修（2026-09-16 波三 Task 9）**；③ `modules/v4-deposit.md:54` 表格摘要仍留「黑名单直接拒绝」旧措辞（:75 详情行已更新）；④ `modules/funds-orders.md:62` 残留 INTERNAL_FUND_* 旧名句（代码已无此名）；⑤ 失真注释 1 条：`swap-kyt-verdict.handler.ts:15-19` 仍写「兑换 FROZEN 是零出边终态」，与波五 FROZEN 中间态矛盾（行为本身仍对，解冻走管理台审批不走 KYT tag）；~~⑥ `audit-actions.constant.ts` V4/V5/V6 三块头注释仍写 31/25/18（实数 47/33/26）~~——**已修（2026-09-16 波三 Task 9）**：三块头注释各加订正注，改真 47/33/26；~~⑦ 审计码总数两处过期（2026-09-15 词表导出程序化实测）：`modules/v1-governance.md` §5 写「V1 合同 101 码 / 退役 97 码」，名册实测 V1 102 码、退役 113 码（`V1_AUDIT_ACTIONS` 键数 + `DEPRECATED_AUDIT_ACTIONS.length`，脚本 import 真名册数出）；同文件 §6 的「7/101」分母连动~~——**已修（2026-09-16 波三 Task 9）**：§5 改「V1 合同 102 码 / 退役 115 码」（113 之上又加波二新退役 `CUSTOMER_UPDATED`/`CUSTOMER_DELETED` 2 码）；§6「7/101」整句改写为 Related No 的 OR 语义、全码覆盖 ｜来源: 2026-09-15 战役收官后复检（取数员 C，主会话逐条复现）+ 同日第七幕词表导出

---

## 本轮销账（2026-09-15 战役收官后复检）

> 六取数员全台账腐烂检测 + 主会话逐条复现，报告见 `superpowers/checkups/2026-09-15-acts345-post-campaign.md`。70 条未勾里腐烂 3、表述过期 5（过期 5 条已原地重锚，见各条「2026-09-15 复检重锚/订正」标记）；两条已勾（D10 因由 / Q1 创建即冻）实证支持勾选。

- [x] **`formatSlaRemaining` 不足 1 分钟显 "0m"** —— 已修未销，本轮销账：`admin-web/src/utils/slaDisplay.ts:27` 现返回 `'<1m'`
- [x] **canonical-minor 展示层 re-pairing 未传 decimals** —— 已修未销，本轮销账：`clearing-settle/reconciliation/domain/reconciliation-query.service.ts:147-165` 已真查 `asset.decimals` 逐行下发，TODO 注释已清
- [x] **§A5③ `adjustment.service.spec.ts` 描述走 customerLabel 实为 internalLabel** —— 已修未销，本轮销账：spec :61-80 注释与断言已对齐（明写 generic branch 恒用 internalLabel），矛盾不存在；母条目 ①②④ 仍真已原地重锚

## 本轮销账（2026-09-13 波四共享抽离）

> 十二任务 subagent-driven（充提镜像五件抽公共底座 / 三份函数甲案收编 + 广播冻结审计补 OWNER / fee-level 双树合一 / kyt-txn-type 归位 / §A 幻影失衡修复 / 兑换死枚举清除，行为零变化），spec/plan 见 `superpowers/specs/2026-09-13-wave4-shared-extraction-*`；五项定案见 `decisions.md` 同日条。

- [x] 🔴 **`demo:all` 偶发客户侧记账失衡（§A 幻影失衡，约 1/13，触碰铁律⑤）** —— 已修：根因是 `account_flows` 落行 id 十六进制拼写未补零（约 1/16 概率丢前导零）导致按字符串比对的读面把该行判成孤儿、丢出恒等式（幻影失衡，非真丢账，TB 与镜像双边齐全）；落行处统一 `id.padStart(32,'0')`，连带排查 `tbTransferId` 同病 + `buildCoaBalanceMap`/`WalletBalanceCheckerService`/对账引擎三处按字符串比对 id 的读面；重铺闸 10 连跑全绿验证，历史库不管（重铺解决存量）
- [x] **广播路径冻结审计（`DEPOSIT_FROZEN`/`WITHDRAW_FROZEN`）无 OWNER subject——按客户号查不到，按单号可查** —— 已修：`findNonTerminalByOwner()` 甲案信封收编进 `trading/shared/freeze-scan.util.ts`，新增必选参数 `ownerNoSource: 'column' | 'customerRelation'`——执行期实测 `DepositTransaction` 无 `ownerNo` 列（withdraw/swap 有），deposit 走 `customer.customerNo` 关系取号、withdraw/swap 走原生列（对齐既有 swap 写法）；两域广播冻结审计自此按客户号可查
- [x] ~~**V6 兑换 FAILED/REVERSED 死枚举**~~ —— 核实：本台账从未登记过此条目（全文 grep 零命中），说法只出现在 swap dto 头注释里、从未入账；随死枚举本体清除（后端 4 处 + admin-web 2 处 + client-web 1 处引用一并摘除，见 `decisions.md` 2026-09-13 条）一并了结，此处记一笔备查，不造假行

## 本轮销账（2026-09-13 波三红项修复）

> 十三任务 subagent-driven（冻结留痕 / tipping-off / 徽章标识 / 深链跳转 / 审计跳转甲案 / 横幅矩阵 / 本文档收口），spec/plan 见 `superpowers/specs/2026-09-12-wave3-red-fixes-*`。BACKLOG §A COA 悬案条目现场取证坐实根因（未修，见该条）。

- [x] ⭐ 客户级冻结不留痕（两条独立路径：广播扫描 `select` 漏 `correlationId` / `evaluateL1()` FREEZE 分支零审计）—— 已修：两处 `select` 各补 `correlationId: true`（对齐 swap 域写法）+ `evaluateL1()` FREEZE 分支补 `depositAudit({action:'DEPOSIT_FROZEN', ...})`；commit `9fca16e0`
- [x] 🔴 制裁冻结那笔充值的 `DEPOSIT_FROZEN` 审计写入失败 —— 已修：与上条同一修法根治（`select` 补 `correlationId` 消除 INHERIT 校验拒收）；commit `9fca16e0`
- [x] ⭐ `evaluateL1` 冻单零审计 —— 已修：FREEZE 分支补 `depositAudit()` 调用；commit `9fca16e0`
- [x] ⭐ L1 的 `FROZEN` 分支不写审计，与挂起分支不对称 —— 已修：冻/标/放行三分支审计对齐；commit `9fca16e0`
- [x] `onCustomerRestrictionOpened()` 调了审计但被 `.catch` 静默吞掉写入失败 —— 已修：`select` 补 `correlationId` 后 INHERIT 校验不再拒收，调用真正落库；commit `9fca16e0`
- [x] ⭐ `linkedFundOrders` 的 `kind` 把没收/退回/上缴三条弧全部误标成 `CONFISCATION` —— 已修：按 `legSeq` 精确映射（2→CONFISCATION/3→RETURN/4→SEIZE），详情页 `cap` 文案加 RETURN/SEIZE 两分支；commit `acd4c72c`
- [x] Internal Approvals 深链只到列表页 —— 已修：审批卡片深链改跳 `/admin/governance/approvals/:approvalNo`；commit `78ff7642`
- [x] 客户端充值页缺受限横幅 —— 已修：`Deposit.tsx` 挂 `RestrictionBanner(capability=DEPOSIT)` + `PendingActionBanner(domain=DEPOSIT)`，措辞「钱仍会到账，收下后处置」；commit `e8598ab6`
- [x] ⭐ 兑换 `PROCESSING` 在途单碰冻人广播仍走 `needsReview` 旗，运营分不出「技术卡单」与「人被冻结」—— 已修：管理台按 `blocked.has('SWAP')` 派生 `ownerRestricted` 标识 + 独立 `CUSTOMER_FROZEN` 徽章，与 `needsReview` 分开展示；commit `705fca3b` + `e1566a8c`
- [x] 兑换时间线 `operator` 恒为 `'SYSTEM'` 字面量 —— 已修：六个 `markStatus()` 写点语义化（`SUMSUB_KYT`/`LEG_SETTLEMENT`/`RESTRICTION_BROADCAST`/`SLA_SWEEP`）；commit `7a89a103`
- [x] 兑换 resubmit 分支给重提的单子近乎零宽限 —— 已修：补提交成功后调 `extendComplianceSla()` 把 `slaDeadline` 拉满一个完整窗口；commit `7a89a103`
- [x] ⭐ 规则 A（tipping-off 防线）只在充值域落实，提现域有一模一样的洞未堵 —— 已修：`status`/`completedAt` 白名单收敛（镜像 `toCustomerDepositView`）+ `customerScope` 下忽略 `status` 查询参数改走 `bucket` 补集 + 客户端 `Withdraw.tsx` 筛选改 bucket 间接式；commit `7567e2c5` + `8d2f395d`
- [x] `approvalEntityRoutes.ts` 的 `?keyword=` 查询参数是死参数 —— 已修：三张列表页（deposit/withdraw/swap）接住 `keyword` 参数预填筛选框；commit `78ff7642`

## 本轮销账（2026-09-09 波二报价单收口）

- [x] F3 提现报价审计未落地（`WithdrawQuoteService.createQuote/consumeQuote/cancelQuote` 零打点）—— 已销账：`WITHDRAW_QUOTE_CREATED/USED/CANCELLED` 三码接入（对齐兑换侧写法，均带显式 requestId），V5 名册 30→33；commit `8cf7d41d`（三码落地）+ `f12b644c`（评审修正 consume/cancel 审计传 tx，对齐 swap 先例）
- [x] 零消费端点第 3 条 `POST withdraw-transactions/quotes/:id/cancel`（体检 2026-09-09-acts345-trading-domains.md「零消费端点」清单：兑换页有同款取消调用、提现页从不调）—— 已销账：提现确认框关闭即调用该端点取消报价，对齐兑换页流程；commit `21b929e4`

## 本轮销账（2026-09-09 三四五幕波一）

- [x] ⭐ 充值详情页终态仍全显 6 按钮 —— 已腐烂销账：通用 ACTIONS 组早在 2026-07-30（9b391f19）整体删除，现为按状态门控的 Ops/Frozen Disposition + SimulationPanel；体检复现 grep 'Approve'|>Expire< 零命中
- [x] 兑换 ①Approved 在 SUCCESS/REJECTED 过度点亮 —— 已腐烂销账：2026-08-24 业主裁定只在 COMPLIANCE_PENDING 高亮（SwapTransactionDetail.tsx:34 isSwapVerdictActionable，注释载裁定），修复晚于登记日

## 本轮销账（2026-09-08 第二幕收尾轮）

- [x] ⭐ `AuthGuard` 里 `/wallet/send` 的受限重定向守着一条不存在的路由 —— 死代码随本轮删除；实证：路由表无注册、全仓无入口（`grep -rn "wallet/send" client-web/src` 仅 AuthGuard 一处命中）
- [x] Swap/Withdraw 页 `PendingActionBanner` 与 `RestrictionBanner` 重复卡 —— 陈账：实际早已修复于 `f67a9629`（RestrictionBanner 按 `claimedByMaterialRequestNo` 过滤被材料请求认领的便签，余下行一律 Contact support），本轮 Ivy 走查截图复证后销账
- [x] 豁免位有效期（poa/questionnaires 提交时间戳待验）—— 2026-09-08 业主裁定作废：材料收取与画像评分都在 Sumsub 侧，豁免机制不归我方系统
- [x] 客户列表「限制」筛选只作用于当前页 —— 2026-09-08 业主裁定清理：demo 规模下的已知取舍成立（footer 已明示范围），不再挂账

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

## 本轮销账（2026-09-08 平账处置改版收官）

> 处置入口翻转（行上直接按钮）/ 单码制 / 金库全线开单 CFO 复核 / 死胡同修复 / 列表页场景气泡，14 任务 subagent-driven，spec/plan 见 `archive/superpowers/specs/2026-09-08-recon-disposition-redesign-design.md`。

- [x] **死胡同修复**：大额查不出（LARGE_UNEXPLAINED）事故定损后认损 / 核销开不出单，事故永远关不了 —— 2026-09-08 Task 4（commit `aad897a2`），闸改挂事故定损判定（`incidentNo` 而非静态 `outlet`），金额锁定 = 定损额、跳过小额线；原条目改判见上方「场景 18」小节的划线记录

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
- [ ] 报送单结构化正文表单（按报文类型）：现行通用形式 = `body` 自由文本快照 + 外部引用号（Sumsub 报告号 / goAML 回执号），2026-09-27 波四脑暴业主定调「等合规同事提各报文具体字段需求后按类型追加」——届时逐类型加表单，不改台账骨架（波四 spec §10）
- [ ] HRC/HRCA 报后 3 工作日 FIU 不反对窗上闹钟墙：随交易 HOLD 边（三域细化总纲范围）一起做——波四裁定不单独上墙（光挂倒计时、窗口到期无动作演不圆，波四 spec §0 裁定 8）；波三移交时称登 BACKLOG 但未落行，本行补登
- [ ] **`FILING_OVERDUE_MARKED` 的 `deadlineAt` 仍 `extra`-only、不落 `metadata`，审计详情页查不到拨到了哪个时刻**：`regulatory-filing-sweep.service.ts`（波二遗留写点）把 `deadlineAt` 放进 `recordAudit` 的 `extra` 顶层展开，只供 `assertActionSpec` 必填校验、不落任何持久化列；本波 T8 评审把波四新写点（`OBLIGATION_DUE_FASTFORWARDED`/`RI_REPLACEMENT_APPLIED` 等）的同类展示级字段全部镜像进 `metadata`（见 `modules/compliance-office.md` §4「R5 修复」），但波二这个既有写点未同步修，与本波新写点处理方式不对称——同一份报送台主体的两个超时相关审计码（`FILING_OVERDUE_MARKED` vs `FILING_DEADLINE_FASTFORWARDED`），前者查不到具体拨到了哪个时刻、后者查得到 ｜来源: 2026-09-27 战役甲波四 T8 评审发现，T10 文档收口登记
