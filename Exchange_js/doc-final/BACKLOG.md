# 业务缺口台账

> **只登记业务缺口**：某流程 / 某页面 / 某状态在演示里缺、讲不圆、显示错。
> 技术待办（兜底 / 故障 / 并发 / 幂等 / 命名 / 死码 / 工具 / 测试基建 / 前端观感）一律记 `PRODUCTION-NOTES.md`，**不在此处**。
>
> **分诊判据**（`rules/review-rubric.md`）——
> 业务：显示的内容错了 ｜ 该有的信息没有 ｜ 结局不完整（某条业务出路没有）｜ 留痕缺业务动作 ｜ PRD/modules 说的和代码不一样。
> 技术：只有攻击者 / 故障 / 并发 / 重复回调才触发 ｜ 长得不一样但内容都对 ｜ 纯内部（命名、死码、类型、schema 残列、存储单位）｜ 工具与测试基建。
> 边界一条：挡住**开演**（铺不出数据、剧本讲错）算业务，记 BACKLOG；挡住**开发**（端口、PATH、worktree）算技术，进 PRODUCTION-NOTES。
>
> **⭐ = 带同事走七幕时会当场看到或讲不圆的**，共 31 条。一行四要素：是什么 ｜ 哪来的 ｜ 落点 / 状态。做完就勾掉。
> 分诊历史：2026-08-26 首次分流（加固类迁出）；2026-08-28 二次分诊——业务/技术彻底分家：8 条已完成或已作废销账、45 条迁 `PRODUCTION-NOTES`、4 条从 `PRODUCTION-NOTES` 判回业务；同日「演示装备」A 档 8 条逐条实跑复核，6 条实证已修当场销账。**2026-08-29 演示装备一期收官**——A 档剩下的 2 条（造数花名册、补料回炉）做完销账，A 档 8/8 全部完成、整节退役删除（原文见「本轮销账」章节与 git 历史）；导语并入 §B。分诊前全文见 git 历史（`649b4e88`）。

Last Updated: 2026-09-02


## B. 第一幕 · 开业（V1 治理底座 ｜ V3 财务配置 ｜ 账本）

> （原「A. 演示装备」档——开演前铺不出数据、⚡ 模拟面板一按就 500——2026-08-29 演示装备一期收官后 8/8 全部修完，整节退役；这类"挡住开演"的问题以后按内容归进对应幕次，不再单独设档。原文见文末「本轮销账」与 git 历史。）
> 讲「谁能做什么是拼包拼出来的、改任何配置都过审批」这一幕时会露的馅，加上账本/财务口径。

- [x] **管理台「新建资产」表单完全打不通——四个必填金额字段全仓没有任何输入框** —— 已解（2026-09-02，四模块治愈 走查修复）：`AssetCreate.tsx` 补 `minDepositAmount`/`maxDepositAmount`/`minWithdrawAmount`/`maxWithdrawAmount` 四个数值输入（新增 Trading Limits 分组，required，无预填默认值，演示者现填）；`AssetEdit.tsx` 同补（编辑回显现值，非必填，对齐 `update-asset.dto.ts` 中同名字段的 optional 语义）；两处提交 payload 补齐四字段，数值转换沿用既有 `parseFloat` 逻辑，未改后端。真机验证（tech_admin@ 登录）：Assets → New Asset → 填 ETH/ERC20 + 四限额（0.01/100/0.01/50）→ `POST /admin/assets/listing` 201，资产落 `PROVISIONING`（`ETH-ERC20` / `AS260902664545`）；打开 Edit 页正常回显四值不炸，改 Max Deposit Amount→150 后 `PATCH` 200 且持久化 ｜来源: 2026-09-02 Task 31 站 4 真机走查 ｜ 2026-09-04 V3 财务配置治愈波一：建资产 / 编辑 / 激活整条路退役，此条随之作废

- [x] **权限包目录三动词标准化 + 铺满 9 空域** —— 已解（2026-08-31，第一幕职权重划 Task 8）：`ACTION_BUCKET_CATALOG` 收敛为 **12 域 50 桶，零空域**（原 15 域 9 空壳全部铺满或整域退役）；桶命名统一 view_/manage_/act_ 三动词前缀；新增 `funds` 域（`FUNDS_ORDER_VIEW`/`FUNDS_ORDER_ACT` 拆分入桶）。管理台改角色弹窗实测 50 个复选框、12 域全在场 ｜来源: 2026-07-11 权限包集中化 brainstorm（甲·三动词）

- [x] **Q3 `expirePendingApprovals()` 全仓无 @Cron 调用方，`timeoutHours` 是展示字段** —— 已解（2026-09-01，四模块治愈 Task 1）：新增 `ApprovalExpiryService`（`governance/approvals/approval-expiry.service.ts`），`@Cron('*/1 * * * *', { timeZone: 'Asia/Dubai' })` 接 `handleCron()` → `sweep()` → 既有的 `ApprovalsService.expirePendingApprovals()`（状态机/审计/事件均已完整，本次只补调用方），注入 `ApprovalsModule` providers。e2e 实测：`timeoutAt` 已过的 PENDING 单扫一轮变 EXPIRED，未到期单不受影响 ｜来源: 2026-08-15 设计稿 §8 Q3

- [x] `CustodianWalletDetail.tsx:182` 用 `INTERNAL_COLLECTIONS_RECONCILE` 权限控制按钮，指向已删端点 —— 已解（第一幕退役段 Task 3）：整段幽灵按钮连带 `handleCreateCollection`/两对 useState/`CollectionActionResult`/结果展示块一并拆除，实测全仓零残余引用 ｜来源: 2026-07-03 死码体检

- [x] Wave8OpsDashboardPage 首页调已删 `/admin/reimbursement-obligations`（404 空转）—— 已解（第一幕退役段 Task 3）：整页退役为 `AdminHomePlaceholder`（纯静态占位，零 fetch）；浏览器实测登录后 31 条请求全部 200/204、零 404

- [x] **`/admin/pricing/policies*` 幽灵路由 + `CUSTOMER_RATE_READ/WRITE` 死权限组** —— 已解（第一幕退役段 Task 4）：4 条 `/admin/pricing/policies*` + `/admin/pricing/simulator/swap` 路由与 `CUSTOMER_RATE_READ/WRITE` 权限组一并退役；实测 `rbac.catalog.ts`/`admin-web` 全仓零命中 ｜来源: 2026-08-26 分流迁入 PRODUCTION-NOTES，2026-08-28 判为业务缺口迁回

- [x] **新增 CFO 角色** —— 已解（第一幕职权重划 Task 9/10）：`RBAC_ROLE_DEFINITIONS` 注册 `CFO`（财务负责人），种子账号 `cfo@fiatx.com`；现为费率写权限（提现/兑换两族）与充值没收审批的唯一持有者 ｜来源: 2026-07-12 PRD 重写 Q2

- [ ] **托管钱包页分组只按当前页数据分、非全量**：`CustodianWalletList.tsx` 把返回结果按 vault（F_OPS/F_SET/F_FEE/F_LIQ/CLIENT_DEPOSIT）在前端分组，只覆盖当次抓取的这一页；钱包总数一旦超过页大小，同一 vault 的行会跨页断开，出现重复或不完整的分组表头且不报错。页大小已从 20 提到 200（现状 19 个钱包：7 个平台位 + 每客户每网络一行 CLIENT_DEPOSIT，随客户增长自然涨，远低于 200）；钱包总数超过 200 时问题会复现 ｜来源: V3 财务配置治愈波一 Task 7 评审修复轮

- [x] **角色绑定变更审批 `ADMIN_ROLE_BINDING_CHANGE_APPROVAL` 结构性自批死锁——提单权限组与裁决人全系统唯一都是 CISO**：谁能提交"改某管理员的角色绑定"这个审批案（`POST /admin/iam/role-change-requests`）与谁能裁决它，恒为同一个人——`approvals.service.ts` 的同用户 SoD 会当场拒绝自批，这条治理流程在当前配置下结构性走不通、从未真正跑通过一次。**2026-09-04 已由业主拍板修复**（方案甲，见本条末尾「已解」段）——以下「两个事实」「姊妹对照」「溯源」三段记录的是修复前的诊断状态，不代表现状。

  **两个事实**（修复前均可直接复现）：`approval.constants.ts:182` 该策略 `steps = [{ stepNo: 1, roles: ['CISO'] }]`（裁决人唯一）；`rbac.catalog.ts:863` 提单所需的 `IAM_ROLE_ASSIGN` 组全系统只在 CISO 的绑定列表里出现过一次（该权限组名在文件里共 4 处命中，只有这一处是角色绑定表，见 `grep -n "IAM_ROLE_ASSIGN" rbac.catalog.ts`）。`prisma/seed.base.ts:30` 只种了一个 CISO 账号，不是"理论上可能有第二个缓解"。

  **姊妹对照，暴露了不对称是 bug 本体**：形状一样的 `ADMIN_INVITE_APPROVAL`（提单组也挂 CISO、裁决人也是 CISO）不会死锁，因为它的提单组 `IAM_MEMBER_MANAGE` 被 `TECH_OFFICER` 双持——TECH_OFFICER 走正常提单，CISO 只有自己提时才撞 SoD（站 0 的刻意演示装置）。修复前 `TECH_OFFICER` 持有 IAM 域另外三个组（`IAM_MEMBER_MANAGE`/`IAM_ROLE_DEFINE`/`IAM_CREDENTIAL_RESET`）唯独不持 `IAM_ROLE_ASSIGN`，这一个组的缺口就是问题所在。

  **溯源**：2026-04-30 Wave 1 治理重设计遗留的配置缺陷；V3 财务配置治愈波一 Task 13 新增 S8（"策略全集必须被 S5 的保护表或豁免表覆盖"）后第一次被纳入判据范围才照见——此前这条策略从未受 S5 或任何其它判据保护。`doc-final/demo/` 全文检索 "role-change|角色变更" 零命中，不在七幕演示脚本上；但对应 4 条管理端路由是真实存在的功能面（未被排过、不是虚设）。

  **已解（2026-09-04，业主拍板方案甲）**：给 `TECH_OFFICER` 也加 `IAM_ROLE_ASSIGN` 组（`rbac.catalog.ts`）——技术官提交、CISO 审批；未采用方案乙（把裁决人从 CISO 改成 `SENIOR_MANAGEMENT_OFFICER`，复刻 `ADMIN_SUSPENSION_APPROVAL`/`ADMIN_REACTIVATION_APPROVAL`）。**理由**：复刻本域其它每一条身份管理动作已有的模式（技术官操作、CISO 审批），与姊妹邀请流程 `ADMIN_INVITE_APPROVAL` 形状完全一致，且不下放任何单方面权力——每一次角色变更仍须经 CISO 审批。**实测**：`tech_admin@` 登录后 `POST /admin/iam/role-change-requests` → 201（新建待批请求）；未持该权限组的角色（如 `ops_officer@`）同请求仍 403，证明门不是 fail-open。**判据**：`scripts/verify-rbac.ts` 把这条从"已知死锁"清单 `S5_KNOWN_DEADLOCKS` 删除（现为空表，正常终态）、转登记进"双持豁免"表 `MAKER_CHECKER_OVERLAP_EXEMPT`（与 `ADMIN_INVITE_APPROVAL` 同款理由：CISO 双持是刻意设计，`TECH_OFFICER` 是安全 maker，S5c 继续守），`verify:rbac` 那行专门的已登记死锁 `⚠` 提示随之消失 ｜来源: 2026-09-04 业主拍板落地，commits `7dd26103`/`35184742`（原登记见 2026-09-04 V3 财务配置治愈波一 Task 13，S8 覆盖判据首次照见）

- [ ] **报价落"资格快照"**：现 quote 仅存 `policyRef=LEVEL:code`；V3 要求成交时落 命中集合 + 选中级 + 选中理由(最低费) + 客户此刻标签快照（可解释/可申诉）｜来源: 2026-07-11 费率 V3 §4.4/§5.5

- [ ] **费率变更 30 日历日生效闸 + 通知客户**：现即改即生效；与提现/兑换 backlog 的 30 日闸同源（MC II.A.7/8），费率治理统一落 ｜来源: 2026-07-11 费率 V3 §1.2

- [ ] 资本注入流水缺 evidence 行（`FIRM_ASSET` 流水缺资本那笔）｜来源: V8 redesign 遗留

- [ ] **资本注入 evidence 待核**：CAPITAL_INJECTION seed transfer 在，FIRM_ASSET 流水是否有对应 evidence/account_flow 行待确认（roadmap 记为欠，agent 称已有——需查 seed 是否走 writeEvidence）｜来源: 2026-07-04 V8 体检

- [ ] **业务日期按 UTC 切、非迪拜 COB(2026-08-13，财务硬需求)**：`src/modules/accounting/tigerbeetle/utils/business-date.util.ts:2` 的 `toBusinessDate` = `toISOString().slice(0,10)`（UTC 日历日 = 迪拜凌晨 4 点切日），迪拜时间 1 月 5 日 02:00 的交易记成 1 月 4 日的账。业务方邮件明确要求"固定迪拜 close-of-business 截止、对前一日收盘位"。须定义迪拜 COB 时点并改切日逻辑，影响 effectiveDate 盖章与对账截止过滤（`effective-cutoff.ts`）；历史 effectiveDate 存量口径切换需评估。不依赖 COA v2，可单独先修 ｜来源: 2026-08-13 COA v2 设计对话中代码实证（spec §7）

- [ ] **账本报表层四张视图待落地(2026-08-13，设计已定稿业主缓做)**：spec 见 `superpowers/specs/2026-08-13-ledger-reports-design.md`（暂扣构成日报/收入分类日报/在途冻结登记簿/VARA 收盘快照 + 通用快照表 + 对账 cron 前置步 + `LEDGER_REPORT_READ/WRITE` 权限）。业主 2026-08-13 拍板本轮只做 COA 更新（plan `superpowers/plans/2026-08-13-coa-v2-rollout.md`），报表层整体缓做；其中 B2 依赖 COA v2 先落、B4 依赖下条迪拜 COB 修正 ｜来源: 2026-08-13 账务深化脑暴，业主二次收窄

- [ ] **effectiveDate 语义待核**：应 date(价值日) + 独立 createdAt(datetime) 两字段两用途；需核 `effectiveDate` 是否 date-only、截止边界卡点是否用 createdAt ｜来源: spec §2.4

- [ ] 🎯 **新资产上线整条流程（未来）**：上币走开发流程——上币包配置（资产身份对齐 HexTrust 支持列表 + 账本科目 + 默认费率档 + 默认限额 + 价源）随版本装载并写发布标记审计；就绪检查（账本户 / 该链地址 / 费率档 / 限额四件齐）→ 运营提激活 → CISO 批；上新链时金库专员开该链地址（vault × 网络），上已有链的币零地址工作。2026-09-03 业主定本轮不做，V3 治愈波一把旧的建资产 / 上架 / 激活代码清干净 ｜来源: 2026-09-03 V3 体检讨论 + decisions 第四条


- [ ] 🔴 **`demo:all` 偶发客户侧记账失衡（约 1/13，触碰铁律⑤「钱动必过账」）**：全新库上跑 `reset self` → `demo:all`，29 笔订单全部走到预期终态、**花名册断言全绿**，但 COA 客户侧两条恒等式静默不平——实测 `CLIENT_ASSET(AED) 12346594 ≠ CLIENT_PAYABLE+DEPOSIT_SUSPENSE 4266547`（差 80,800.47 AED），`USDT` 同向差 8,992.57 USDT，**两个币种资产 side 均约为负债 side 的 2.88 倍**；公司侧两条恒等式同时全绿。**非确定性**：同一提交同一命令连跑 13 次，12 次干净、1 次失衡。已用实证排除"本批引入"——在 `git merge-base main HEAD`、在新增客户提交的前一刻、在该提交本身、在 HEAD 上分别跑过，且逐提交核对确认 `demo:all` 实际执行到的 `demo-lib.ts`/`demo-roster.ts` 在这些提交间**逐字节相同**。花名册从 21 行加到 29 行只是把单次记账笔数从 ~14 提到 ~21，**提高了撞上的概率、不是原因**。

  **头号怀疑（未坐实，把握中等偏低）**：`src/modules/trading/swap-transactions/swap-workflow.service.ts:1529` 的 `handleFundsOrderChanged()` 在腿失败/超时时走 `:1636` 的 `onLegFailedSelfHeal`——void 当前 attempt、重建 attempt+1。而 `swap-leg-accounting.ts` 的 `deterministicTransferId(..., attempt)` 把 attempt 编进转账 ID，**TigerBeetle 的 ID 去重因此只挡得住同一 attempt 内的重复，挡不住"这一 attempt 其实已经落账成功却被误判 FAILED/TIMEOUT"**；且 `postLeg`/`advance`/`createLeg` 整套包在 SQL `$transaction` 里，**TigerBeetle 的落账不受该事务回滚保护**。已排查并排除：充值 SUCCESS 路径（成对转账，重复调用不破坏恒等式）、几个 SLA 类 `@Cron`（阈值 30 秒~5 分钟，远长于 demo:all 实测 ~18 秒全程）。

  🔴 **2026-08-31 订正：此前把"单个客户钱包净额变 0"记成本条的第二个症状，是并错了。** 那个现象读的是另一条代码路径（对账引擎的 `WalletBalanceCheckerService`），而本条 COA 断言走的是 `demo-lib.ts` 的 `buildCoaBalanceMap`（遍历注册表 → `lookupBalance`），两者不共享出错点。**"钱包净额变 0"已另有更好的解释**：`PRODUCTION-NOTES.md` 那条「`WalletBalanceCheckerService` 查注册表未套用十六进制补零，随机丢一笔分录」——概率约 1/16、症状正是"少算一整条 PAYABLE 分录"、且一旦命中会在该 reset 周期内**稳定**复现。

  ⚠️ **但这条 COA 失衡本身仍未销账**，而且新线索提高了它的嫌疑度：那个补零缺陷丢的是**负债侧**分录，方向与本条实测的"资产 side 约为负债 side 的 2.88 倍"**一致**。下次取证时值得先排除它——如果 `buildCoaBalanceMap` 那条路上也有类似的 id 匹配（而不是纯 registry 遍历），两条可能就是同一个根因。

  **下次取证的正确姿势（关键，别错过现场）**：判红后**先别 reset**，在失衡的库上按 `sourceType/sourceNo` 分组，数 `account_flows` 里每个 `swapNo`/`depositNo` 名下 `CLIENT_ASSET` 方向的转账笔数是否 >1（正常恒为 1）——比继续读代码猜更快锁到是哪类单、第几次 attempt。

  ⚠️ **归 BACKLOG 不归 PRODUCTION-NOTES**：它动的是「钱动必过账」这条不可违反规则，一旦坐实会动摇账本可信度，不是纯技术兜底 ｜来源: 2026-08-30 破口场景批次 Task 5 收尾时撞见，专项调查报告见 `.superpowers/sdd/coa-imbalance-report.md`

- [ ] **`TransactionLimitRule.ruleNo` 随机铸造，重铺一次孤儿 15 条 `TRANSACTION_LIMIT_SEEDED` 审计行——现存 45 条只有 15 条对应活着的规则**：`prisma/seed.business.ts:433-435` 的 `no()` 用 `generateReferenceNo('TLR')` 随机铸造 `ruleNo`，不像其余四块种子配置（资产 `assetNo`、托管钱包 `walletNo`、两族费率 `levelCode`）都用确定性业务号；`stack.sh reset` 清业务表但不清 `audit_log_events`，每次重铺 `ruleNo` 换一批新值，旧一批的 15 条 `TRANSACTION_LIMIT_SEEDED` 行找不到对应的活规则、变孤儿，净增不清零。实测现状：45 条里只有 15 条 `primarySubjectNo` 命中当前活着的规则，另外 30 条指向已不存在的规则号。演示者若按 `TRANSACTION_LIMIT_SEEDED` 过滤审计日志会直接看到这批孤儿。这是业务键不跨重铺稳定的一致性问题，不是技术兜底，故不进 `PRODUCTION-NOTES.md`。`ruleNo` 全仓只当查找键用（`transaction-limit-rules.service.ts:79` 的 `findByNo()` 纯 `findUnique({where:{ruleNo}})`，不解析格式），以后改成确定性生成是安全的 ｜来源: 2026-09-04 V3 财务配置治愈波一 Task 14 评审修复轮，R5 由计数改 join 后实证

- [ ] **限额与费率两族 `*_SEEDED` 审计行的 `afterData` 里塞的是原始 UUID（`fromAssetId`/`toAssetId`/`assetId`），管理台按字面量渲染，犯铁律⑥**：`admin-web/src/pages/AuditLogDetailPage.tsx:242` 把 `detail.afterData` 整体交给 `JsonBlock`（`admin-web/src/components/compliance/DetailPageComponents.tsx:200` 的 `JSON.stringify(value, null, 2)`——同名组件另有一个在 `admin-web/src/components/governance/GovernanceUi.tsx:99`，这里指的是 `AuditLogDetailPage.tsx:8` 实际导入的 compliance 版），零字段翻译；`TRANSACTION_LIMIT_SEEDED`/`SWAP_FEE_LEVEL_SEEDED`/`WITHDRAWAL_FEE_LEVEL_SEEDED` 三块种子把 `Asset.id`（UUID 内部键）原样写进 `afterData` 的 `assetId`/`fromAssetId`/`toAssetId`，演示者点开详情看到的是 `fromAssetId: e8594fa7-…` 而不是 `USDT-TRON`。这不是本任务新引入的孤例——库里已有 40 条历史 `SWAP_FEE_LEVEL_CREATION_REQUESTED`/`SWAP_FEE_LEVEL_CREATION_APPLIED`（各 20 条）同样把裸 UUID 写进 `afterData` 的 `fromAssetId`/`toAssetId`。登记覆盖两处：新的三块种子 + 这 40 条历史行；只改新种子会在同一份日志里留下两种形状（有的行是业务号、有的行是 UUID），半修比不修更糟 ｜来源: 2026-09-04 V3 财务配置治愈波一 Task 14 评审修复轮

- [ ] **`CUSTOMER_DEPOSIT_ADDRESS_SEEDED`/`WITHDRAWAL_ADDRESS_SEEDED` 两码没有自动化判据兜底——`verify:demo-data` 的 R5 只查了另外五块**：这两码目前唯一的写入路径是 `scripts/demo-lib.ts` 的四处 `writeSeedAudit`（:337/:353 写 `CUSTOMER_DEPOSIT_ADDRESS_SEEDED`，:378/:403 写 `WITHDRAWAL_ADDRESS_SEEDED`，均 `actorNo: 'DEMO_SEED'`），但 `scripts/verify-demo-data.ts` 的 `scanR5()` 只 join 另外五块（`actorNo: 'RELEASE'` 的资产/托管钱包/限额/两族费率）。若有人重构 `ensureSetup` 时顺手删掉这四处写点，所有闸门原样全绿，缺口只会在演示者点开某客户的收款地址、发现没有身世行时才被人肉发现。

  **自然的修法（把这两码也收进 R5）会撞上 Fix 1（本轮，见上）刚纠正过的同一个坑**：`CUSTOMER_DEPOSIT_ADDRESS_SEEDED` 对应的 `wallets` 表，客户自己也有一条活的运行时创建路径——`customer-deposit-wallet.service.ts:60` 的 `createOrReturn()` 经 `wallets.service.ts:35` 的 `createWalletRecord()`（全仓唯一调用方）建 `ownerType: 'CUSTOMER'` 钱包；`demo-lib.ts:328/:344` 的种子写同样落 `ownerType: 'CUSTOMER'`，两边不可区分——照搬 `CUSTODIAN_WALLET_SEEDED` 那种"按 `ownerType` 全量要求"的写法会把每个客户自己开的收款地址也一并要求有 `*_SEEDED` 行，重演假红；且 `Wallet` 表本身没有 `createdByUserId` 一类字段可用，判别式待补（`prisma/schema.prisma` 的 `Wallet` model 无 actor 字段）。`WITHDRAWAL_ADDRESS_SEEDED` 对应的 `withdrawal_addresses` 表情况稍好——目前看到的种子写（`demo-lib.ts:372/:397`）落 `ownershipProofType: 'DEMO_FIXTURE'`，运行时写（`withdrawal-address-workflow.service.ts:67/:108`）落 `'DECLARATION'`，**已复核确认可用**（2026-09-04 波一 T14 第三轮评审）：该表的生产写入路径只有两条——`withdrawal-address.service.ts:83` 的 `create()` 与 `:139` 的 `createBankAccount()`，两者都是参数化的，而各自唯一调用方 `withdrawal-address-workflow.service.ts:55/:99` 分别在 `:67/:108` 传字面量 `'DECLARATION'`；种子写 `'DEMO_FIXTURE'`，另有五个 e2e spec 写 `'E2E_FIXTURE'`。故按 `ownershipProofType='DEMO_FIXTURE'` 过滤是成立的判别式，且顺带把 e2e 造的行也正确排除在外。只剩接入 R5 这一步。任何未来延伸都必须先分别给两类实体确认好种子/运行时判别式，再动 R5 ｜来源: 2026-09-04 V3 财务配置治愈波一 Task 14 评审修复轮二

- [ ] **`admin-web/tailwind.config.js` 的 `adm-*` 色系没有走 Tailwind 的透明度修饰符格式，全站 `bg-adm-*/N` 与 `border-adm-*/N` 类名不产生任何 CSS 规则**：`tailwind.config.js:28-41` 把每个 `adm-*` 颜色直接定义成裸的 `var(--adm-xxx)` 字符串，不是 Tailwind 需要的 `rgb(var(--x) / <alpha-value>)` 函数形式；而 `admin-web/src/index.css:9-24`（亮色 `:root`）/`:26-41`（暗色 `.dark`）里 `--adm-*` 变量本身存的又是十六进制字面量（如 `--adm-green: #059669`），不是"R G B" 三元组——即便日后补上 `rgb(...)` 包裹也还差一步。后果是应用级、无声的：Tailwind 对"颜色值是纯字符串"的工具类叠加透明度修饰符时不知道怎么混合，直接不生成该条规则——`bg-adm-green/10`、`border-adm-green/25` 这类类名在产物 CSS 里查无此类。最典型的受害者是全站状态徽章组件 `admin-web/src/components/ui/AdminBadge.tsx`（`BADGE_CLS`:31-38、`TRIGGER_CLS`:61-70）：圆点用 `bg-current`（继承不带修饰符的 `text-adm-*`，正常显色）、文字用 `text-adm-*`（同样正常），唯独该有的浅色底与描边（`bg-adm-green/10`、`border-adm-green/25` 等）整条规则都不存在——徽章视觉上只靠文字和圆点区分状态，源代码里"这个状态该有底色/描边"这件事完全落空且不报错。全仓 `grep -rEo "(bg|border|text)-adm-[a-zA-Z0-9]+/[0-9]+" admin-web/src` 命中 583 处、分布在 77 个文件，非孤例。修法两步都要做：CSS 变量改存 "R G B" 三元组（如 `--adm-green: 5 150 105`），`tailwind.config.js` 的每个 `adm-*` 条目改成 `rgb(var(--adm-xxx) / <alpha-value>)`。预先存在于本仓库、非本轮引入 ｜来源: 2026-09-04 V3 财务配置治愈波一 Task 12 评审时对照实际计算样式发现（走查费率退役徽章时顺带撞见，与限额/费率任务本身无关）

## C. 第二幕 · 迎客（V2 客户与合规）

> 讲「客户是谁、能不能交易由合规说了算」这一幕的缺口。最大一件是开户流程重做（站6 整体拆除后待接真 Sumsub 申请人侧）。

- [ ] **一期客户流程重做（接真 Sumsub 申请人侧）**：入驻流程 / 定期风评（CRA）/ 高风险升级案已于站6 整体拆除（业主 2026-08-27 方案2：演示零损失、免去"翻新旧的再推倒"双份工）。重做落点：申请人侧 Sumsub 集成（建充值地址时同步注册 applicant 绑定已是既定集成点）、开户 happy path、AML 命中走限制账、EDD 走审批。重建时直接在新审计合同上出生（词表/子表/旅程号第一天就对）；摄取分发器的 unrouted 警告处即重新开路的位置 ｜ 来源: 站6 业主拍板

- [ ] **若做 onboarding 风险审批展示，先接 `latestRiskApprovalId` 写入方**：该列全仓零生产写入方（2026-09-02 实证），CustomerDetail 靠它渲染的「Risk Approval」区块从来出不来，2026-09-03 客户域业务号化轮已把该死 UI 段退役（业主拍板：不在演示故事里）。回接位置就在上一条「一期客户流程重做」的 MLRO 终审落列处——先有写入方，再回接展示 ｜ 来源: 2026-09-03 客户域业务键收口

- [ ] **Tier Upgrade ⛔ 缺客户端 UI**：后端全建（createFromCra→Level2→MLRO+SMO 审批），缺客户材料提交前端（真实卡点，roadmap 已标 BLOCKED）｜来源: 2026-07-04 V2 体检

- [ ] **Corporate/机构客户 stub**：CorporateProfile/UboProfile 表+关系连但无业务逻辑，onboarding 两处显式 disabled；机构客户全 ADVANCED ｜来源: 2026-07-04 V2 体检

- [ ] ⭐ **Q2 销户流程只落了轴上位置 + 三条断言**：`OFFBOARDED` 是 `lifecycle` 终态，`CustomerAccessService.assertOffboardable()` 只实现三条不变量（`OFFBOARD_BLOCKED_BY_SANCTION` / `_BY_BALANCE` / `_BY_INFLIGHT`）。真正的销户流程——余额清退、材料归档留存期、审批链、客户侧发起入口——全部未做；管理台 Offboard 按钮当前是 disabled 占位 ｜来源: 2026-08-15 设计稿 §8 Q2

- [ ] ⭐ **六个 admin 页仍读已删的 `customer.complianceStatus`，客户级合规信号退化成 N/A(2026-08-16)**：三轴收敛后 `CustomerMain.complianceStatus` 列已删，但 `DepositTransactionDetail.tsx:401`、`WithdrawTransactionDetail.tsx:345`、`SwapTransactionDetail.tsx:284`（三张交易详情的**合规 L1「客户级」层**）与 `RiskAssessmentDetailPage.tsx:390`、`MaterialHoldingDetailPage.tsx:339/503`、`RefreshCycleDetailPage.tsx:350`（三张详情页的"客户被冻结"徽章）仍读该字段。降级是温和的——`getComplianceLayerStyle(undefined)` 返回灰底 `N/A`、徽章条件不成立直接不渲染，**不报错、不白屏**，但这些位置从此永远显示"没信号"，等于悄悄少了一层合规提示。新模型下这个信号的正确来源是限制账（"这个客户身上有没有开着的便签"），admin 侧可以连 SILENT 一起看（不涉 tipping-off）。要做的是：六个页面各自的后端 `customer` include 补一个限制摘要（`openRestrictionCount` / `hasSanction`，或直接复用 `CustomerAccessService.resolve()`），前端把 L1 层与徽章改读它。本轮 Task 12 只负责客户详情/列表两页，这六页无任务归属，故登记 ｜来源: 2026-08-16 Task 12 收尾时全仓 grep 发现

- [ ] ⭐ **材料到期 cron 的扫描筛选值与 `customerMaterialHolding.status` 实际写入值对不上，`REFRESH_IN_PROGRESS` 之后的 holding 永远不再被任何一次扫描捡到(既有缺陷，非本轮引入)**：`material-freshness-cron.service.ts:31`（`scanHoldingsForStageTransitions()`）的筛选是 `status: { in: ['FRESH', 'NOTIFIED', 'URGENT', 'BLOCKING'] }`，但全仓 grep `customerMaterialHolding.update/create` 证实该字段实际只会被写成四个值：`FRESH`（`material-refresh.service.ts:323/452/555`、`admin-material-management.controller.ts:222`）、`REFRESH_IN_PROGRESS`（`material-refresh.service.ts:108/499`）、`EXPIRED`（`material-refresh.service.ts:168/200`）、`MISSING`（`material-refresh.service.ts:452`）——`NOTIFIED`/`URGENT`/`BLOCKING` 从未出现在任何写入点，它们是 `computeStage()`（`policy/compute-stage.ts`）的返回值，是 **cycle 的 `stage` 字段**取值，不是 holding.status 的取值。后果：holding 一旦被 `enterNotifiedStage()` 置成 `REFRESH_IN_PROGRESS`（T-30 就会发生），就**永远不再出现在任何一次 cron 扫描的候选集**里——`escalateToUrgent()`/`enterBlockingStage()` 这两个自动升档动作，生产环境里除了 admin 后台手动 `simulate-stage` 之外可能从未被自动触发过。连带：`handleSumsubDocMonitoringFire()` 也会被自己的 `if (holding.activeRefreshCycleId) continue` 挡住——T-30 建过 cycle 后这个条件恒真，Sumsub 主动上报证件过期同样叫不醒它。**已核实是既有缺陷**：`git show 71483d0d:...material-freshness-cron.service.ts` 基线上就是这个筛选条件（`git log 71483d0d..HEAD -- .../material-freshness-cron.service.ts` 零提交），本分支（材料请求账 Task 11）对该文件零改动；holding.status 实际取值只有那四个也已现场 grep 核实，非猜测。修法二选一，需先确认设计意图：① 筛选改成 `['FRESH', 'REFRESH_IN_PROGRESS']`（cron 应该关心的是"还没到终态"的 holding，不该按 cycle 的 stage 词汇筛 holding 表）；② 让 `holding.status` 真的跟着 stage 走（`enterNotifiedStage`/`escalateToUrgent`/`enterBlockingStage` 各自把 holding.status 同步写成 `NOTIFIED`/`URGENT`/`BLOCKING`，筛选条件不用改，但要评估这四个新状态值对其它读 `holding.status` 的地方——如 admin 列表页/客户端 profile-banners——是否会产生连带展示影响）｜来源: 2026-08-18 材料请求账 Task 11 评审核实（既存缺陷，登记不改代码）

- [ ] ⭐ **被 `REJECTED` 的材料请求，其便签长期挂着无人清理，无 SLA 提醒（设计稿 §9 Q3）**：材料请求行走到 `REJECTED`（RED·FINAL）是终态，但它挂着的便签（`restrictionNo` 指向的 `customer_restrictions` 行）不会跟着自动撕——两种 RED 都不撕便签是本设计刻意的（`MaterialRequestReviewService.applyReview()`：只有 GREEN 才 `autoRelease()`），但 FINAL 与 RETRY 不同：RETRY 客户还能再交、有机会转 GREEN 自动解开；FINAL 是死路，客户唯一的解法是靠运营再下发一次新的材料请求（走 `restrict:true` 挂到同一张便签或开新的），或运营手工去限制账页面撕票——现设计没有任何 SLA/看板提醒运营"这张便签背后的材料请求已经死路一条，光等客户自己不会有下文"。本轮不做，登记 BACKLOG ｜来源: 设计稿 `doc-final/superpowers/specs/2026-08-17-material-request-ledger-design.md` §9 Q3

- [ ] **Q1 制裁客户的订单级折叠未做**：本轮贴 `scope=ALL` 便签只把在途单打成 `FROZEN`，客户面靠服务端脱敏白名单收敛成 `COMPLIANCE_PENDING`；设计稿讨论过的「收单后一律挂 `PROCESSING`、连状态变化都不产生」的订单级折叠没做。与「提现域 tipping-off 未对齐」同源，一并排期 ｜来源: 2026-08-15 设计稿 §8 Q1

- [ ] **`CAPABILITY_RESTRICTED` 挂起原因区分不出 SANCTION 与 ADMIN_SUSPENSION，客户面一律藏**：`holdReasonOf()` 只按**哪一格 FAIL** 映射原因，拿不到便签的 `cause`；而客户面的可见性判据是「`limitHoldReason` 非空即整单不可见」，于是行政级挂起在**挂着的时候**对客户是零记录（退回落地才清、才可见，见 `modules/v4-deposit.md` §4.8）。保守是刻意的——tipping-off 的代价不对称（藏错了客户少看见一条记录，露错了是刑事风险）。要精确区分需让 `holdReasonOf()` 带上 `cause`，并给客户面定一套「哪些 cause 可见」的白名单 ｜来源: 2026-08-22 第四批 B4

- [ ] **Swap/Withdraw 页 `PendingActionBanner` 与 `RestrictionBanner` 对同一条挂限制的材料请求各显示一张卡，重复(2026-08-18 Task 14 真机截图发现)**：`PendingActionBanner.tsx`（本轮改读 `/client/me/material-requests`，按 G6 显示「挂了限制的」∪「没绑单的」）与 `RestrictionBanner.tsx`（读 `/client/me/restrictions`，显示所有 `visibility=DISCLOSED` 的 OPEN 限制便签，含 `PENDING_DOCUMENT`/`MATERIAL_EXPIRED` 因由）两个组件都挂在 Swap.tsx/Withdraw.tsx 顶部，对**同一张**挂了限制的材料请求各自渲染一张卡（真机截图实测：demo_alice 挂 `Source of Wealth`/`Liveness` 两条 BLOCKING 材料请求时，Withdraw 页顶部先出现 PendingActionBanner 的两张卡，紧接着 RestrictionBanner 又各出一张「DOCUMENT REQUIRED」卡，共四张卡描述两件事）。CustomerProfile.tsx 一侧的同类重复（`ProfileBannerStack` vs 旧 `PendingActionBanner`）已在本轮直接摘掉 Profile 页的 `<PendingActionBanner />`（该页material request 覆盖已在 Task 11 并入 `ProfileBannerStack`）；但 Swap/Withdraw 页没有 `ProfileBannerStack`，`PendingActionBanner` 仍是这两页材料请求的唯一入口，不能照样摘掉。`RestrictionBanner.tsx` 文件头注释明确写着"本组件只做一件事……禁止在这里补任何……推导逻辑"，本轮未touch该文件。修法待定，需要业主拍板：①`RestrictionBanner` 增加"跳过 cause∈{PENDING_DOCUMENT,MATERIAL_EXPIRED} 且已被材料请求覆盖"的过滤（对称于 Task 11 给 `profile-banners.service.ts` 加的 `claimedRestrictionNos` 去重，但这次要挪到 client 组件或后端 `/client/me/restrictions` 端点)；②或反过来让 `PendingActionBanner` 只处理未绑限制的提醒行，把"挂了限制"的展示职责完全交给 `RestrictionBanner` ｜来源: 2026-08-18 材料请求账 Task 14 真机截图验收发现

- [ ] **客户列表的「限制」筛选只作用于当前页(2026-08-16，设计已知取舍)**：`CustomerManagement.tsx` 的 Restrictions 列与 `Restricted/Unrestricted/Sanction only` 筛选，数据来自当页 20 行各拉一次 `GET /admin/customers/:customerNo/restrictions`（服务端列表 `GET /customers` 没有限制聚合字段，也没有批量端点）。因此筛选是**客户端**过滤，只筛当前页；翻页会得到"每页筛出的条数不一"的观感，footer 已明写 `(restriction filter applies to this page)`。真做法二选一：① `GET /customers` 的返回体加 `openRestrictionCount` / `hasSanction` 两个聚合字段并支持 `restriction=` 服务端筛选；② 加一个批量摘要端点 `POST /admin/customers/restrictions/summary` 收 customerNo 数组。demo 规模（8 客户）下当前实现够用，登记为账 ｜来源: 2026-08-16 客户生命周期轴+限制账 Task 12

- [ ] **豁免位有效期**：poa/questionnaires 字段是否含提交时间戳待验；无时间戳则该档退回 tag + 我方管期限｜来源: 同上


## D. 第三幕 · 钱进（V4 充值）

> 讲「钱进来要闯几道门、闯不过去有四种下场」这一幕的缺口。⭐ 那条是四条弧里唯一走不通的一条。

- [ ] 🔴 **制裁冻结那笔充值的 `DEPOSIT_FROZEN` 审计写入失败（铁律①）**（2026-09-03 平账 A 批合并前跑 `demo:all` 逮到，main 四模块治愈批之后的现状）：Nest 日志 `ERROR [DepositWorkflowService] Failed to write DEPOSIT_FROZEN audit for DEP…（restriction RST…）: Audit action DEPOSIT_FROZEN is INHERIT and must inherit an existing correlationId`——`deposit-workflow.service.ts` 冻结分支（约 :2842 一带）的审计信封没带 `correlationId`，四模块批把 INHERIT 码的合同收紧后这条写入当场被拒；业务终态仍对（花名册 29/29 过），但"人被冻了、单被冻了，审计里查不到冻结"。**复现**：`reset self → up → on-stack self demo:all`，看后端日志或 demo:all 输出里的 ERROR 行；修法 = 冻结分支把 deposit 的 correlationId（同一文件其他 DEPOSIT_* 写点的取法）带进信封 ｜来源: 2026-09-03 平账 A 批收尾闸门（非本批引入，登记不修）

- [ ] ⭐ 🔴 **行政级挂起的单没有任何入账路径，`waiveLimitHold` 承诺的「重走合规」是空的（待业主拍板）**：`holdAtGate0()` 那条分支**刻意不送 Sumsub**（注释说「与紧邻的 FROZEN 分支同形状」）。但那个类比**只对 `FROZEN` 成立**——`FROZEN` 的出口 `resume` 回 `COMPLIANCE_PENDING`，会重新武装 Gate 0；而 `OPERATION_PENDING` **没有回 `COMPLIANCE_PENDING` 的边**，`runGate0` 只在进入 `COMPLIANCE_PENDING` 时触发。于是：运营看到「Account suspended」、停用解除后点 **Release Hold** → `clearLimitHold` 跑 → `checkAutoApproval` 读到 `sumsubVerdict === null` **提前 return** → 单子停在 `OPERATION_PENDING`、无挂起、无 KYT 案；此时 waive 再点会抛（挂起已清）、`initiateConfiscation` 硬钉 `BELOW_MIN`、详情页没有 Approve 按钮（全仓唯一的 `Approve` 字串是 demo 模拟 fixture）——**实际只剩「原路退回汇款人」一条出路**，否则钱无限期压在 `DEPOSIT_SUSPENSE`、客户面看到一笔永远「处理中」的单。**三个候选解法**：①挂起分支也送 Sumsub（挂起时就起 KYT 案，waive 后自动续跑）；②补 `OPERATION_PENDING --resume--> COMPLIANCE_PENDING` 边（waive 走它，重新武装 Gate 0）；③维持现状但把文案说清。**本批不改行为**，只做了如实化：`waiveLimitHold` 的 JSDoc（此前明确承诺「re-runs checkAutoApproval so the deposit proceeds through the normal L2 compliance gates」，是假话）与 admin 详情页 Release Hold 的按钮文案 / confirm / notice / 按钮下方提示已全部订正 ｜来源: 2026-08-22 终审 Important I1

- [ ] **`waiveLimitHold` 对"KYT 先批复、`BELOW_MIN` 挂起后落地"这条顺序的处理，本轮复审判定有问题、待核实**（与上一条区分：上一条讲的是 Gate 0 级挂起、`sumsubVerdict===null`，KYT 从没跑过；这一条 KYT **已经批复**）：`holdIfHeld()`（`deposit-workflow.service.ts:728`）证实 `BELOW_MIN` 挂起目前**只会**在 KYT 批复之后才落地——`approveDeposit()` 内部先过合规、再判金额是否低于下限才转 `OPERATION_PENDING`，其 JSDoc 自述"compliance approved but amount below configured minimum"；Gate 0 本身不判金额，这是**目前唯一**能走到 `BELOW_MIN` 挂起的顺序，运营正常顺序操作就会走到，不是刁钻边界或并发场景。花名册 #6/#8 两行就是这条顺序的日常样本——**#8（低于下限→没收→MLRO 批）本轮实测确实走通到 `CONFISCATED`**（`initiateConfiscation:1307`/`onConfiscationDecided:1389` 未见明显问题）；但**没有花名册样本覆盖 `waiveLimitHold`**（豁免直接入账，`:1267`）在这条顺序上的表现——本轮复审给出的判断是它"处理不了"，但本条登记时未能独立复现具体失败点（`checkAutoApproval:1051` 表面上会重查已缓存的 `sumsubVerdict`，理论上不会因为已批复而卡住）。如实登记，留给下一轮专门核实 ｜来源: 2026-08-29 演示装备一期复审，本条描述未经独立复现，见 `task-C56-report.md`

- [ ] ⭐ **`linkedFundOrders` 的 `kind` 把没收/退回/上缴三条弧全部误标成同一个 `CONFISCATION`（Task 8 真机渲染发现的真 bug）**：`deposit-transactions.service.ts`（约 L201）`isConfiscation = fo.legSeq != null && fo.legSeq > 1` 只按"是否 legSeq>1"二分，把 legSeq=2（没收动腿）/legSeq=3（**计划2·A3 退回**动腿）/legSeq=4（**计划2·A4 上缴**动腿）全部归为 `kind: 'CONFISCATION'`；前端 `DepositTransactionDetail.tsx:543` 相应把三者的 "Linked Funds Orders" 卡片全部渲染成 `Fee · Confiscation`。Task 8 真机渲染验证时在一笔真实 SEIZE（政府上缴）流程里截图证实：legSeq=4 的资金单被标成"Fee · Confiscation"，对 operator 是误导性文案（这是政府移交，不是没收手续费）。**渲染层已把关的其它维度不受影响**（状态徽章/门控/Sumsub 引用区/演示面板均正确，只有这一处 kind 标签是历史遗留，早于本轮但被本轮新增的 legSeq=3/4 弧放大暴露）。修法：`LinkedFundOrder.kind` 类型 + 后端判定逻辑改按 legSeq 精确映射（2→CONFISCATION，3→RETURN，4→SEIZE），前端 `cap` 文案随之加 `RETURN`/`SEIZE` 两个新分支 ｜来源: 2026-07-29 Task 8 真机渲染验证发现，按硬约束未修（渲染暴露的真 bug，停手报告）

- [ ] **运营补录入站信号（漏监听的充值）无入口** —— 外部账单上真有一笔客户入金、我方监听漏了，今天没有任何运营侧手段把它补回来：`InboundTransferSignalsService.createForCustomer/scanForCustomer` 只挂在**客户端**控制器上（`deposit-transactions.controller.ts:85/96`，userId 取自客户 token），是演示用的“我打了一笔钱进来”，不是带证据的运营动作。缺的是**运营入口**，不是流程——`processSignal → depositService.detected()` 这条通道现成，补录后充值单照常建、KYT 照跑、合规闸照过、客户在自己的记录里看得到。做法：admin 侧新增“凭外部流水行补录入站信号”端点（证据 = 该条 `external_statement_lines` 行 + 原因）+ 双人复核，复用同一条通道。**归属裁定（2026-08-27 业主定）：此事属交易三域（V4 充值），不属平账**——平账的调账单**不得**用于补记真实资金流入流出（那等于绕过 KYT 与合规闸凭空给客户加钱，踩铁律②）。对账侧只负责开案并指出“这条差异该走充值域补录”。两个边角一并记：① 认不到主人的进账（demo 破口 #9 孤儿充值）补录也建不了单，需“待认领”挂账口径；② 漏记的提现（钱出去了但客户没提过）是事故不是差异，不做自动处置、只开案升级 ｜来源: 2026-08-27 平账模块脑暴（业主判定归属并要求以后做）

- [ ] ⭐ **`runGate0` 冻单零审计**：`deposit-workflow.service.ts → runGate0()` 命中限制账（`customerAccessService.resolve().blocked.has('DEPOSIT')`）直接 `updateStatus(FREEZE)`，只有 `logger.warn`，全程无 `auditLogsService` 调用——无论是否存在并发竞态都不写。与同一文件的 `onCustomerRestrictionOpened()`（批量冻单广播，本批已补审计）和提现域对应的 `assertCustomerComplianceOrFreeze()`（三处调用点均写 `WITHDRAW_FROZEN`）不对称，是充值域独有的缺口。**非本批引入**，实证发现于本批 ｜来源: 2026-08-20 制裁分主体批次

- [ ] ⭐ **Gate 0 的 `FROZEN` 分支不写审计，与本批新增的挂起分支不对称**：`runGate0()` 的执法级分支（`releasePolicy === 'MLRO_APPROVAL'`）只有 `logger.warn` + `updateStatus(FREEZE)`，无 `auditLogsService` 调用；而本批新增的 `holdAtGate0()` 走 `recordStateTransitionAudit()`、放行分支写 `DEPOSIT_GATE0_PASSED`——三条分支里**只有冻结这条没有审计**。**非本批引入**（既有缺口已登记在上方「制裁命中分主体」节的「`runGate0` 冻单零审计」条），但本批把不对称放得更明显了，一并在此交叉引用，归审计专项那一轮统一清 ｜来源: 2026-08-22 第四批 B4

- [ ] **上面两条记的是「压根没调审计」，这条是「调了但静默写失败」——同样查不到，根因不同**：`onCustomerRestrictionOpened()`（`deposit-workflow.service.ts:2812`，批量冻单广播）**确实**调用了 `depositAudit({action:'DEPOSIT_FROZEN', ...})`（:2841），但那次调用被自己的 `.catch()`（:2848-2854）单独包住，失败只打 `logger.error`、不抛出、不影响主流程——2026-08-20 的记录把这条算作"本批已补审计"，实际只是"补了调用点"，**没有验证过这次调用真的成功落库**。2026-09-02 `demo:all` 花名册 #7（充值·制裁冻结）真机实测复现：backend 日志一条 `ERROR [DepositWorkflowService] Failed to write DEPOSIT_FROZEN audit for DEP...: Audit action DEPOSIT_FROZEN is INHERIT and must inherit an existing correlationId`——`depositAudit()`（:1889）把 `correlationId` 直接读自传入的 deposit 行对象 `deposit.correlationId`，这次为空，撞上 `audit-logs.service.ts:933-937` 的 INHERIT 校验直接 400，被外层 `.catch` 吞掉。后果：这笔冻结审计页按单号查不到 `DEPOSIT_FROZEN` 记录（状态确实是 FROZEN，只是留痕断了）。**复现**：`bash scripts/on-stack.sh self demo:all` 后 grep 后端日志 `Failed to write DEPOSIT_FROZEN audit`，或按 `depositNo` 查审计页确认该记录缺失 ｜来源: 2026-09-02 Task 31 收尾闸/走查前置的 `demo:all` 基线跑批实测

- [ ] ⭐ **充值详情页通用 Actions 组在终态仍全显（pre-existing）**：`DepositTransactionDetail.tsx` 的通用 Approve/Freeze/Resume/Expire/Reject/Confiscate 组当前仅对 below-min 挂起 + 没收生命周期(CONFISCATING/CONFISCATED)隐藏；**SUCCESS/FROZEN/REJECTED 等其它终态仍全显 6 个按钮且可点**（点了会被后端状态机/治理守卫拒，非资金安全问题，纯 UX 误导）。根因=该组无"终态即隐藏"门控（D8 只加了 `!isBelowMinPending`，2026-07-17 没收轮补了 `!isConfiscationLifecycle`）。彻底修=按 deposit 是否终态统一门控通用组 ｜来源: 2026-07-17 没收异步 C5 实景截图发现（pre-existing，早于本分支）

- [ ] **Internal Approvals 深链只到列表页（新，2026-07-30）**：详情页 "Internal Approvals" 块点击只跳审批列表 `/admin/governance/approvals`，无法深链到具体审批单——因 `findOneForAdmin` 的 `approvals[]` 投影只 pick `{approvalNo,actionType,status,createdAt}`（业主定"仅单头"），丢了审批 case `id`；审批详情路由/列表筛选又都按 `id`/不读 `approvalNo` query。修法：投影补回 `id`（`id` 是 case 主键、非 step，不违背"仅单头不含 step"），前端深链 `/admin/governance/approvals/<id>`｜来源: 2026-07-30 Sumsub 详情增强 Task 6 review

- [ ] **TR 适用判定未自动计算**：充值 PRD 定义 Travel Rule 适用 = 虚拟币 且 来源地址为 VASP 托管 且 单笔 ≥ 3,500 AED（三条件 AND，否则 NOT_REQUIRED）；现状仅条件①法币→NOT_REQUIRED 落地，条件②(hosted/unhosted VASP 分类，依赖 roadmap V3 地址打标)+③(3,500 阈值判定)**代码未自动计算** → crypto TR 结果当前由 demo 模拟端点注入 ｜来源: 2026-07-11 充值 PRD v2

- [ ] **DEPOSIT 累计限额（CUMULATIVE gateType B）仍未接**：本轮只接了 SINGLE 单笔下限，`transaction_limit_rules` 的 B 档（tradingTier×period 累计）尚未对 DEPOSIT operationType 消费 ｜来源: 2026-07-17 deposit-min 收口复核

- [ ] **BELOW_MIN 计次自动冻结未做**：同客户多次触发 below-min 挂起累计到阈值后自动转 FROZEN（防试探式小额充值绕限额）未实现，本轮只做单笔挂起+人工处置 ｜来源: 2026-07-16 deposit-min spec §8（deferred）

- [ ] **自动没收 cron 未做**：BELOW_MIN 挂起超时后自动发起没收（现只能 ops 手动点 Confiscate）未实现 ｜来源: 2026-07-16 deposit-min spec §8（deferred）

- [ ] 充值挂起（`DEPOSIT_HELD_NOT_TRADING_READY`）无自动重驱：客户补齐法币地址后，挂 COMPLIANCE_PENDING 的充值不会自动重跑 checkAutoApproval → 需 hook `ADDRESS_ACTIVATED` 重驱该客户挂起充值，否则要人工 ｜来源: 2026-07-11 Task 4b


## E. 第四幕 · 钱换（V6 兑换）

> 讲「一次兑换四条腿原子记账」这一幕的缺口。

- [ ] ⭐ **兑换 `PROCESSING` 在途单碰冻人广播仍走 `needsReview` 旗，运营分不出"技术卡单"与"人被冻结"**：`onCustomerRestrictionOpened()` 对处于 `PROCESSING`（腿已开跑）的兑换单只调用 `assertSwapCustomerAccessOrHalt()` 停腿 + 打 `needsReview`，与腿失败自愈耗尽的 STUCK 单共用同一面旗子、混在同一个卡单堆里，旁边挂的还是同一个 Resume 按钮——运营在列表页无法区分"这单是技术卡住待人工重试"还是"这个人被制裁冻结了，Resume 是错误动作" ｜来源: 2026-08-20 制裁分主体批次

- [ ] 无自动 FAILED 状态机：腿失败走自愈→STUCK(needsReview)+手动 resume，swap 留 PROCESSING，无终态失败（设计 deferred）｜来源: 2026-07-04 V6 体检

- [ ] **兑换时间线 `operator` 恒为 `'SYSTEM'` 字面量**（`swap-transactions.service.ts` 的 statusHistory 写入点硬编码），时间线永远看不到是谁操作的 ｜来源: 2026-08-23 第五批 Task 3

- [ ] **兑换域规则清单与阈值**：另起规则目录文档，含排雷（含 rejected 计数 / 缺 .notRejected 的聚合规则会造成
      「被拒→加分→再被拒」死循环）｜来源: 同上 §7
> 注：swap 腿 InternalFund 命名债已并入下方「平账处置」的 funds-orders 域 RBAC 命名债条目，不重复登记。


## F. 第五幕 · 钱出（V5 提现）

> 讲「出金门最多、客户永远看不到调查原因」这一幕的缺口。⭐ 那条正是这一幕的卖点本身在提现域没落实。

- [ ] ⭐ **规则 A（tipping-off 防线）只在充值域落实，提现域有一模一样的洞未堵**：`withdraw-transactions.service.ts → toCustomerWithdrawView()`（约 L357-380）原样返回 `status: item.status`/`completedAt: item.completedAt`——一笔被 `adminFreeze` 打成 `FROZEN` 的提现，客户端 DevTools → Network 面板可直接读到裸 `'FROZEN'` 字符串（对照充值域 `deposit-transactions.service.ts → toCustomerDepositView()` 已有的 `CUSTOMER_STATUS_PASSTHROUGH` 白名单收敛 + `CUSTOMER_COMPLETED_STATUSES` completedAt 独立白名单，见 modules/v4-deposit.md §4.6）；`findAllForCustomer()`（约 L333-339）把客户传入的 `query.status` 直接转发进 `findAll()` 的 where 条件，无 customerScope 收窄——`GET /client/withdraw-transactions?status=FROZEN` 本身就是一个可用的冻结预言机（对照充值域 `findAll()` 在 `customerScope` 下已静默忽略原始 `status` 参数）；前端 `client-web/src/pages/Withdraw.tsx → HISTORY_STATUS_FILTERS`（约 L105-115）仍是裸 status 列表式筛选（`statuses: ['PENDING_APPROVAL','COMPLIANCE_PENDING','MANUAL_CHECKING','FROZEN','PAYOUT_PENDING']`），未跟进充值域已切换的 `bucket` 补集式设计（§4.6）。本条不是回归——提现域这套字段白名单本就早于充值域上线（Task 11 只做了字段裁剪，未含 status/completedAt 收敛），deposit-action-embed 分支只是把充值域这道防线补完，两域因此出现不对称：modules/v4-deposit.md 与代码注释里写的"规则 A"读起来像平台级不变量，实际只在充值域落实。仅登记，本分支未改提现代码 ｜来源: 2026-08-05 deposit-action-embed 分支终审 Important 3

- [ ] **提现报价审计未落地**：报价流程（`WithdrawQuoteService.createQuote/consumeQuote/cancelQuote`）零打点——常量 `WITHDRAW_PRICING_QUOTE_CREATED/_USED/_CANCELLED`（entityType `WITHDRAW_PRICING_QUOTE`）已定义但 `withdraw-quote.service.ts` 从不调用（grep 实证 0 命中，该文件无任何 audit 引用）；对比兑换 `SWAP_QUOTE_CREATED/USED/CANCELLED` 已在 `swap-quote.service.ts:249/319/364` 落地。应补打 QUOTE_CREATED/USED/CANCELLED（workflowType `WITHDRAW_QUOTE`），与兑换对齐 ｜来源: 2026-07-11 提现报价单文档 v2 §4.1.3


## G. 第六幕 · 账对（V8 对账 ｜ 平账二期/三期）

> 讲「对不上的怎么处置」这一幕的缺口。一期调账单（spec + 8 任务计划已定稿）落地后回来更新前三条。

- [ ] ⭐ **真差异(BREAK)处置闭环：十件处置已交付七件，余三件按轮排**（2026-09-02 平账 A 批后更新）
  - **已交付**：推单 ｜ 冲正 ｜ 冲销 ｜ 补记（一期，2026-08-31）｜ 改记（第四族，借错记方应付 / 贷正主方应付、资产腿不动、一单双案同愈）｜ 挂起（等下期 / 调查中，零账务，案子仍红）｜ **核销**（公司池；四前提 + CFO）。入口统一为「先定性（从该格成因菜单选查证结论）→ 注册表判出口」，**「不该动账的行显示错误按钮」那个缺陷随之消失**——2026-08-31 记的「指出来、不点」演法已作废
  - **后半批**：补单两入口（外面真有钱进出、我方没记的，回业务域把流程补跑一遍——进 → 充值域补录、出 → 退汇认领；**不许用调账凭空给客户加钱**，decisions.md 2026-08-28）
  - 豁免 / 容差 **不做**（decisions 2026-09-02，精度一致）；aging 已做（3 天，标记 + 审计 + 解锁）
  - **三期**：事故升级（`UNAUTHORIZED_OUTFLOW` 本轮只能留档）
  - **仍 deferred**：SOFT_FLAG 里"真两侧对冲错"的调账（matcher 调优部分不算）；Finance 人工核实 → 结案 ｜来源: spec §9，2026-09-02 平账一期半收尾更新

- [ ] **改记换主后，对正主方没有合规复核**（2026-09-02 平账一期半新增）：改记（`CUSTOMER_REATTRIBUTION`）把一笔钱从错记方名下改到正主方名下，**放行依据是「记在错记方名下的那张原始充值单 KYT 已经跑过」**（与一期调账单边界线同源——有原单 ⇒ KYT 对这笔钱跑过），本轮**不重跑 KYT**。但那次 KYT 跑的是**错记方的身份**：真正持有这笔钱的正主方，从来没有被就这笔资金筛查过。业主 2026-09-01 拍板本轮这么放行、缺口登记在案。修法方向（下一轮/合规域定）：换主落账后对正主方补一次 KYT/制裁筛查，或至少在正主方的合规档上留一条「因改记获得资金 X，原单 KYT 结论沿用自客户 Y」的可追溯记录 ｜来源: 2026-09-01 平账一期半 spec §6 合规口径

- [x] ~~跨日切场景在案件页无可处置行~~ —— 已解（2026-09-02 平账 A 批 Task 6）：run 记 cutoffAt，案件页按它重建 ｜来源: 2026-09-02 平账一期半 Task 14 收尾走查实证

- [ ] ⭐ **对账复核签核未做**：应干净 run 自动认证 + 人工平账动作走复核签核(maker-checker 推≠批，可按 severity 分级)；复核挂"人工干预动作"、非挂"run 变 pass"。与「平账处置」推单读权限门控债协同(那条=权限粒度、本条=两人复核)｜来源: spec §6

- [x] ⭐ ~~aging + SLA + 超期升级未做~~ —— 已解（2026-09-02 平账 A 批 Task 4/5/8）：账龄 3 天、到线标记 + 审计、⚡拨钟、按状态解锁；**升级 MLRO/CFO 通知不做**（无通知中心，业主定）；in-transit 死结由超期标记兜住 ｜来源: spec §5/§6

- [ ] ⭐ **INTERNAL_BREAK run 详情误显示空表**：预门破时 `walletCount=0`/空表 → UI 显示成空/像干净(危险)；应专门呈现恒等破裂明细(按币种 资产合计/负债合计/差额) + "逐钱包未执行"提示；数据已被预门 breaks[] + 审计捕获，缺前端呈现 ｜来源: spec §1.4

- [ ] ⭐ **数据完整性闸 + HELD 态未做**：无"数据到齐才对"闸、无 `HELD`(待外部数据)态；即时轨道周末结算 / 账单延迟会被误判假 BREAK（结算轴 ≠ 上报轴）。与 2026-07-06「external_balances 驱动静默漏对」同源（该条=现状症状、HELD=应然解）：应以内部钱包名册枚举、缺外部数据标 HELD 而非跳过/硬对 ｜来源: spec §2.6

- [ ] **对账钱包枚举由 external_balances 驱动、缺外部快照的客户钱包静默漏对** — `wallet-recon-run.service.ts` 的 run 钱包遍历以 external_balances 行为键；某客户钱包当天缺外部快照即被**静默跳过**、不进对账也不报异常，"full list" 完整性靠外部数据源自觉而非内部账户名册驱动。修法：以内部客户钱包名册为枚举源、外部缺行标 MISSING_EXTERNAL 而非跳过 ｜来源: 2026-07-06 V8 遗漏审计（对抗核验读代码逮到）

- [ ] **流水 match tag 结转未做**：行项每 run delete-then-insert 全量重配、无持久行状态；应 Reconciled 冻结踢出、只对未决+新增。上文「reObservedCount 恒为 0」是无持久行状态的同源症状。⚠ **落地时字段名用 `reconciliationStatus`（Reconciliation Status，业主定名），枚举 `Open / Reconciled / In-transit / Exception`**（PRD §5.2 已定，勿再叫 tag / UNRECONCILED / OPEN_EXCEPTION）｜来源: spec §0.5/§3.2 + 2026-07-13 PRD 命名

- [x] ⭐ ~~对账 Cases 列表页 Δ 显示的是原始「分」整数、未按 decimals 分→元~~ —— 已解（2026-09-02，平账一期半 Task 10）：后端 `listCases` 已在 Task 7 随行下发 `decimals`；列表页改用 `ReconciliationCasesDetailPage.tsx` 既有导出的 `formatAmount`（Task 8 导出，带千分位的展示格式化）按行缩放，不新增第三个金额格式化函数。同族的 DemoCompare 页 `AmountCell`（manifest 口径答案键，属另一比对面）仍未动 ｜来源: 2026-07-04 canon2 T4 冰山排查（T4 只改两详情页，列表页超范围）

- [ ] **canonical-minor 展示层 re-pairing 未传 decimals**：`reconciliation-query.service.ts` `buildFlowComparison()` 的 `matchFlows` 调用暂传 `decimals: 0`（identity 换算，保持 Case 详情流水比对页现状不变），TODO 标记待 Task B 补该 case 资产 `asset.decimals`｜来源: 2026-07-04 canonical-minor Task A（Task B 收口）

- [ ] 🐛 **`reObservedCount` 恒为 0**：line item 每 run delete-then-insert，`foundByRunId` distinct 恒 1 → 观察历史"复观察次数"永远 0；正确修法需 `reconciliation_cases` 加专用计数列（`upsertCaseForWallet` existing 分支 +1）；代码已加 KNOWN LIMITATION 注释（`reconciliation-query.service.ts`）｜来源: 2026-07-04 V8 体检（Round3 遗留）

- [ ] **swap 腿推单未支持**：通用推单按钮（`/admin/funds-orders/:no/push/sync|manual`）明确排除 swap 腿——`advanceByNo`/编排服务见 `swapTransactionId` 非空即拒（现有先卖后买顺序守卫防线），且回填 effectiveDate 需再穿透 swap 4 腿两阶段记账链（工作量≈deposit+withdraw 之和）。swap 腿卡单本期走 **Swap 详情页 `advanceLeg` 专用推进**（带顺序守卫），但该路径**暂无 effectiveDate 回填** → 推完历史那天快照修不平 ｜来源: 2026-07-03 推单 plan 落地发现（spec §2/§8）｜下期：swap workflow 记账链穿透 effectiveDate + 推单接 swap 腿

- [ ] **SUCCESS 后退汇无处理**：`onBounce()` 硬性要求 `PAYOUT_PENDING`，一笔已 `SUCCESS` 的提现若数日后被银行/链上退汇，本域没有对应入口，应走对账（recon）子系统匹配外部退汇流水而非 withdraw workflow 自身处理 ｜来源: 2026-08-04 Task 12 truth 核对

- [ ] **五桶命名 `SOFT_FLAG`→`COMPENSATING` 代码改名**：PRD 已改用专业名 `COMPENSATING`（抵销错误）；代码仍 `SOFT_FLAG`（`engine/v2/bucket-classifier.ts` 的 `ReconBucket`、`dto/reconciliation.dto.ts` 的 `ReconWalletBucket` + `ReconCaseQuery`），第六幕记分牌上观众看到的桶名与 PRD 对不上 ｜来源: 2026-08-26 分流迁入 PRODUCTION-NOTES，2026-08-28 判为业务缺口迁回（rubric #1 业务逻辑不符：PRD 说应该这样，页面不是这样）

- [ ] 🎯 **二期 · 内部划转单（第四类订单）** —— 公司池的资金移动今天完全没有建模（V7 瘦身时 `InternalTransferWorkflowService` 已删）。两个用例合用一条通道、开两个入口：① **公司池内部调度**（`F_SET`→`F_OPS` 归集、给兑换对手盘补头寸、冷热钱包调拨——财资日常，今天一笔都没有）② **公司补款给客户**（C3 认损后的赔付；客户钱包与公司钱包是两组物理钱包，没有账面捷径，见 decisions.md 2026-08-28）。**必须是订单，不能只有资金单**：调拨要审批，审批期间钱还没动、按系统规矩此时不该有资金单（提现 `withdraw-workflow.service.ts:938` 注释：资金单在 PAYOUT_PENDING 才诞生，合规/审批被拒的单从不产生资金单），故「待审批」只能挂订单层；且 `FundsOrderService.create` 硬要求资金单必须挂父单。状态机与提现同构（草稿→待审批→已批准→执行中→完成/失败，执行中罩住资金单生命周期）。**在途必须有资金单**否则调拨在途期间转出钱包已少、转入钱包未多，对账两边各爆一个假 BREAK（在途识别正是靠翻非终态资金单认领）。⚠ **前置地基**：`F_LIQ` 流动性钱包的科目 `E.FIRM_LIQ` 已退役、账上期望恒 0（`wallet-recon-run.service.ts:631` 注释），真做调度时它没有落脚点，须先定 F_LIQ 在 COA 里怎么安置（注意 decisions.md [2026-08-13] COA 终盘 9 码、不预留号段） ｜来源: 2026-08-28 平账三期切分脑暴
  ⤷ 落地时同批加 `recon.act_adjust` 权限包（2026-08-30 第一幕职权重划时预留，当时代码尚不存在故未建组）

- [ ] 🎯 **三期 · 事故登记** —— C3（未授权转出：钥匙泄露 / 内部人作案 / 银行误划）业主定性为**事故**，不是普通差异。补款只是善后，事故本身要：登记、定性、升级（MLRO / 管理层）、通报监管（VARA 重大差异通报，roadmap ⚖️ ADVANCED 在案）。一期二期做完后 C3 能走到「认损 → case 关掉 → 赔付到账」，但**事故这一层仍是空的**。⚠ **抽不抽成独立模块，三期到了再定，现在不预设**：今天只有两个用例（C3 + INTERNAL_BREAK 恒等破裂），且都还在纸上，形状没长出来，按「不为单次使用建抽象」先别抽。**若要建，必须先在 decisions.md 写清它跟已删的 `incidents` 的区别**——decisions.md [合规承接] 明确「不重建内部合规信号管道（compliance-alerts / incidents 已删）」；区别在于被删的是**合规筛查信号**（那活归 Sumsub），而这里是**运营/安全事件**（Sumsub 管不着），但这个区分不写进 decisions 就不算数。⚠ **上报留痕要求待设计**（2026-09-02 平账查证手册 T13 评审补记）：`UNAUTHORIZED_OUTFLOW`（未授权转出）这类原因查证时"该上报给谁、什么时候上报、依据是什么"——手册一度写了一句操作要求，评审裁定这是抢先替三期预设口径，已从手册删掉；这个真实需求点留在这里，事故登记正式设计时要把上报留痕（对象/时限/依据）定清楚 ｜来源: 2026-08-28 平账三期切分脑暴（业主提出抽模块的可能，我方建议缓到三期再定）

- [ ] **调账单的边界线守卫只查原单「存在」，不查「归属」** —— `adjustment.service.ts` 的 `relatedOrderExists()` 按单号在充值/提现/兑换三表查存在性即放行，**不校验这张单是不是本案客户的**。刻意划在这儿：spec §4 立的规则是「有原单 ⇒ KYT 已对它跑过」，存在性就是这条规则的字面内容；要「引错别人的单」成为问题，前提是操作员恶意，那落在 CLAUDE.md §3「管理员都是善意的」与禁做清单「边界防御」里。存在性检查已堵死 spec 点名的「凭空造钱」，剩下的是引错凭证的数据质量问题、不是闸门被绕。**留此一行是为了日后评 PRD 时不被当成遗漏** ｜来源: 2026-08-28 平账一期末站评审
- [x] ~~对账案件详情页把 walletRef（内部 UUID）挂在 tooltip 上~~ —— 已解（2026-09-02，平账一期半 Task 10）：直接删除该 `title` 属性，可见文本本就正确用了 `walletNo` ｜来源: 2026-08-28 平账一期 Task 7 评审顺带发现

- [x] ~~对账模块还有 3 处同型 tooltip 漏 UUID~~ —— 已解（2026-09-02 平账 A 批 Task 10）：三处 title 一并删 ｜来源: 2026-09-02 平账一期半 Task 10 实现者 + 评审各发现一半（均超出该任务范围，未修）

- [x] ~~**开调账单（DRAFT）这一步零审计**（2026-08-31 终审）：`adjustment.service.ts` 的 `createDraft` 全程没有 `recordByActor`，整个文件只有落账那一处有。运营开一张带金额、成因、关联原单的单，**只要不提审，审计就查不到**~~ —— **已解**（2026-09-02，平账一期半 Task 5）：新铸审计码 `RECON_ADJUSTMENT_DRAFTED`（**四族通用**，domain RECON ｜ correlationMode NONE ｜ requiredFields `reasonCode`+`amount` ｜ 主对象 = adjustmentNo），在 `createDraft` 落库后 `recordByActor`（`adjustment.service.ts:244`），并带**显式 `requestId`**——漏了会被静默去重、这条日志直接消失。两个新码（连同定性的 `RECON_DISPOSITION_RECORDED`）均已入 `V8_RECON_AUDIT_ACTIONS` 与封册名册 ｜来源: 2026-08-31 整支终审

- [ ] **管理台 Demo Compare 页读到的期望破口恒为空**（既有孤儿，非本批引入）：`reconciliation-query.service.ts:640-641` 解析 `demoManifest` 时取 `.breaks`，而写方从来没写过这个键——旧 `ManifestV2` 写 `injections`，现 `ManifestV3` 写 `scenarios`/`wallets`（终审 checkout 到分支起点核对过）。于是 `?? []` 恒生效，页面把**所有**检出都渲染成 "extra"，且因为 `hasDemoManifest === true` 连"无答案键"的提示都不显示。应是 `recon:gen` 退役时留下的孤儿。`demo/script.md` 没提这个页面 → **要么修、要么直接删页，业主定** ｜来源: 2026-08-31 整支终审

- [ ] **答案键的 `expectedLines[].amount` 是装饰性的、没人读**（2026-08-31 终审）：`verifyManifest` 的 select 和匹配谓词都不碰它，且语义在场景间不统一（有的存注入后的新值、有的存差额）。升级方向是把它变成载荷（谓词里断言外部金额），这样"注入跑了但 delta 算错"也能被抓到——现在的钉行只能抓"整条没了"。⚠️ 终审的判断是**这条优先级低于已完成的完整性断言**（`casesOpened == manifest.wallets.length`，已于 `2e74d6d4` 落地）：金额算错已被 `bumpClosing` 连到桶断言上，而"多报破口"那一侧才是当时完全没人看的 ｜来源: 2026-08-31 整支终审

- [x] ~~`recon-demo.ts` 三处 `dedupKey` 里的场景号是旧的~~ —— 已解（2026-09-02，平账一期半 Task 11）：14 场景整体重编号本身就要求一次整库重铺（场景 6 真写 TB 账本，验证只能靠重铺），拿到了这条债一直在等的窗口——`dedupKey` 全部 `-sN-` 段随新 scenarioId 重写（原文点名的三处 `-s5-bank-charge`→`-s11-bank-charge`、`-s6-missed-deposit`→`-s13-missed-deposit`、`-s7-bank-interest`→`-s12-bank-interest`，连同其余各处一并核对，现在每个 `-sN-` 都等于其 scenarioId）｜来源: 2026-08-31 整支终审

- [ ] **`recon-demo.ts` 报错文案里的钱包 UUID 至少 5 处**（`:727/831/898/947/1295` + ⑫⑬ 两处同形）：commit `7aeeec7d` 专门为前置闸做过"报错改用钱包号 + 客户号"的清扫，同形的兄弟没跟上。**开发者面报错、不是管理台，不破铁律⑥**，纯可读性 ｜来源: 2026-08-31 整支终审

- [ ] **`recon-demo.ts` 报错文案里的钱包 UUID：根治办法是给 `WalletPlan` 加 `walletNo` 字段**（Task 11 评审顺带发现）：上一条「至少 5 处」逐处手改治标不治本——`WalletPlan`（本文件 `planWallets` 的返回类型）从来没有 `walletNo` 这个字段，只有内部 `walletRef`（UUID），所以每处新写的报错都只能选 UUID 或者改用 `currency`/`coaCode` 之类的替代信息绕开（T11 场景 10 的报错就是这么绕的）。根治：`planWallets` 查询 `wallet` 表时顺手 `select` 上 `walletNo`（真实值例如公司运营户 `WA2601017168`），`WalletPlan` 接口加一个 `walletNo: string` 字段，那样「至少 5 处」+ 本轮新绕开的这处能一次性全部改成 `${plan.walletNo}`，之后也不会再有人被迫在两个坏选项（UUID / 绕着说）里选 ｜来源: 2026-09-02 平账一期半 Task 11 评审顺带发现

- [ ] **几处注释与实现对不上**（2026-08-31 终审，同属"脚本不消费、没有机制会发现它错"那一类）：① `wallet-recon-run.service.ts:824-826` 称已解释差异行"标成 EXPLAINED，仍在案件页上看得见"——**案件页读的是 `flowComparison[].explainedByAdjustmentNo`，全仓没有任何一处读 `ReconciliationLineItem.status === 'EXPLAINED'`**（除 e2e 断言外无消费者），注释把展示来源说反了；② `adjustment.service.ts:368` 注释错引行号（说 `:181`，实为 `:323`），单测用例名抄了同一个错；③ `adjustment.service.spec.ts:46/57` 说走 `customerLabel`、实现走 `internalLabel`（对该成因恰好同值，所以断言绿着、描述是错的）；④ `adjustment-approval.service.ts:2` 与 `reconciliation.module.ts:23,26` 还写着"onApproved 本任务只留桩"，早已落地 ｜来源: 2026-08-31 整支终审

- [x] ⭐ **对账余额校验器按未补零的 tbAccountId 连注册表，命中首位为 0 的账户就把该户流水整体丢掉、内部余额算成 0**：`engine/v2/wallet-balance-checker.service.ts` 用 `regById.get(f.tbAccountId)` 直接连 `tb_account_registry`，`!reg` 就 `continue`；但 `tb_account_registry.tbAccountId` 存的是 32 位补零形式，`account_flows.tbAccountId` 存的是 TB u128 的十六进制**未补零**形式——账户号首位是 0 时两边差一位，join 落空，那个账户的全部流水被静默跳过。同目录的 `wallet-flow-matcher.service.ts` 早就发现过这件事并加了 `padTbId`（它的注释原话就是"Without this ... flows silently drop and surface as bogus orphan"），**校验器这一半没跟上**。后果不是"少算一点"，而是该钱包内部余额直接变 0 → 差额 = 外部收盘全额 → 凭空造出破口，或反过来把真破口抹平；对账是演示的收口环节，这里算错等于整幕结论不可信。命中率 ≈ 1/16（十六进制首位随机），**取决于每次 `stack.sh reset` 重铺时随机生成的账户号，所以它是"按种子随机发作"的**——2026-09-02 重铺后 57 个账户里 5 个首位为 0，`demo_carol` 的 AED 客户应付户 `0d1f22c2...` 正在其中，两份 recon e2e 当场各红一条（`money-arcs` 场景 1 期望 delta `-20000` 得到 `20000`、场景 10 案件为 null；`recon-reattribution` 场景 A 期望 `-87500` 得到 `0`），重铺前同样的代码全绿。**修法**（4 处，与 matcher 同款）：`const padTbId = (id) => id.length < 32 ? id.padStart(32,'0') : id`，然后 `accountIds` 映射、`regById` 建键、`regById.get()`、`balanceByAccount` 建键四处一律走补零 ｜ **复现**：`bash scripts/stack.sh reset self` 后跑 `node -e` 比对两表 id 长度（重铺后 132 条 `account_flows` 里 12 条不补零查不到、补零后 0 条），或直接 `bash scripts/on-stack.sh self test:e2e -- --testPathPattern 'test/recon-'`；打上补零补丁后同一命令 13/13 全绿（Task 12 已实验证实，补丁未提交——该任务明令零引擎改动）｜**2026-09-02 已解**（Task 12 Commit 1）：四处连接键（`accountIds` 映射 / `regById` 建键 / `regById.get()` / `balanceByAccount` 建键）统一走 `padTbId`，写法照兄弟件 `wallet-flow-matcher.service.ts:203`。**改判依据**：此前 `PRODUCTION-NOTES.md` 把它归为「边界防御」故不修——业主 2026-09-02 裁定那个归类是错的，它不防畸形/恶意输入，是连接键写错，正常路径正常数据即发作，按 CLAUDE.md §1 判据不占技术兜底任何一条，且登记原文自己就写着「属于铁律⑤『账实一致』的静默破口」。实证：修前 `--testPathPattern 'test/recon-'` 3 红，修后 13/13 全绿 ｜来源: 2026-09-02 平账一期半 Task 12 评审收口时实测发现

- [ ] **严重度分级跨资产不可比**（2026-09-02 平账 A 批发现）：`wallet-recon-run.service.ts` `computeSeverity` 用「最小单位 1 万」一个数——AED 是 100 元、USDT 是 0.01 元。本批「金额小」另立小额线（`recon-thresholds.constant.ts` 按币种），未借用严重度；修法：severity 阈值按币种进同一张常量表 ｜来源: 2026-09-02 平账 A 批 spec §0-12
- [ ] **`RECON_CASE_OPENED` 审计 metadata 仍带 `walletRef`（内部 UUID）**（2026-09-03 平账 A 批终审）：`wallet-recon-run.service.ts` 开案审计的 metadata 直接放 walletRef；本批新增的两条账龄审计已改用 `walletNo` 业务键，开案这条应对齐（子主体已是业务键，只是 metadata 漏了）｜来源: 平账 A 批终审 triage

## H. 第七幕 · 事后说得清（审计追溯）

> 讲「这笔事谁批的、依据什么、钱去哪了」这一幕的缺口。三域词表已换装，剩配置域与子表覆盖面。

- [ ] ⭐ 🔴 **`audit_log_subjects` 子表覆盖面远小于设计前提，45 码里只有 ~7 码真正在用子表**：设计稿 §5.1 的立论前提是"一对 primarySubjectType+primarySubjectNo 装不下多主体，需要子表"，但 Task 11 端到端实测（真实 API 驱动 admin 停用/恢复/角色定义创建等流程）坐实：只有横切的 6 个 `APPROVAL_*` 码（经 `approvals.service.ts`）与 `AUDIT_LOG_QUERIED`（且仅当查询带 `ownerCustomerNo` 参数时）会调用 `persistSubjects` 写子表；其余 IAM（`ADMIN_INVITE_*`/`ADMIN_FIRST_LOGIN_*`/`ADMIN_ROLE_CHANGE_*`/`ADMIN_SUSPENSION_*`/`ADMIN_REACTIVATION_*`/`ADMIN_PASSWORD_RESET_*`/`ADMIN_MFA_RESET_*`/`ADMIN_ACCOUNT_LOCK_*`，共 25 码）与 CONFIG（`ROLE_DEFINITION_*`/`APPROVAL_POLICY_CHANGE_*`，共 8 码）、以及 `AUDIT_EVIDENCE_EXPORT_*`（3 码）在各自的 workflow service 里 `recordByActor`/`recordSystem` 调用**从不传 `subjects:` 数组**——只设置主表扁平字段。实测复现：`admin-suspension-workflow.service.ts` 让 `ADM2501010008` 挂了 4 条事件（`ADMIN_SUSPENSION_REQUESTED`/`APPLIED`、`ADMIN_REACTIVATION_REQUESTED`/`APPLIED`）的 `primarySubjectNo`，但 `SELECT COUNT(*) FROM audit_log_subjects WHERE subjectNo='ADM2501010008'` = 0，`GET /admin/audit-logs?subjectNo=ADM2501010008` 实测返回 `total:0`（必须改用 `primarySubjectNo=` 才能查到同样 4 条）。**验收标准 #6"按依据查得到"字面上仍算通过**（该标准原文限定的是"按审批单号"，approvals.service.ts 那 7 个码确实覆盖了），但设计稿 §5.1 举的例子（"充值单"为 PRIMARY、审批单只是其中一个 INSTRUMENT）说明子表原意是覆盖**所有** V1 主体，不是只覆盖审批单号——按这个更完整的意图，"某个 admin 用户/某条角色定义从生到死被谁碰过"这条监管索档能力目前并不成立。修法：把这 36 个码所在的 8 个 workflow service 补上 `subjects:` 数组（多数只需 1-2 行，模式已有 `approvals.service.ts` 可抄）｜Task 11 端到端验收实测新发现，无历史来源

- [ ] **Q4"按客户查全部"目前唯一的数据来源是查询动作自证**：`verify:audit` 的 Q4 判据（`M>0`）能通过，靠的是 `GET /admin/audit-logs?ownerCustomerNo=X` 这个查询动作自己把 `AUDIT_LOG_QUERIED` 记成 `OWNER=CUSTOMER`，即"查询这个动作本身构成了它所验证的证据"。这不是 `verify-audit.ts` 脚本的缺陷（脚本按 brief 逐字实现，且经变异测试证明能正确识别数据缺陷），而是**V1 治理域现实中没有任何其它场景会把 CUSTOMER 设为某条治理事件的 OWNER**（V1 域本身不直接操作客户实体，客户只会通过"查询时按客户号过滤"这一条路径进子表）。换言之，Q4 目前只证明了"查询行为自身可追溯"，不能证明"客户被牵连在其他 V1 治理动作里时可追溯"——因为 V1 域里后一种场景目前不存在，等三个交易域（充值/提现/兑换，这些才会有 `ownerCustomerNo` 意义下的客户关联事件）接入 `subjects` 后，Q4 式的验证才有更丰富的场景可测｜Task 11 端到端验收实测新发现，无历史来源

- [x] ~~⭐ **V3 财务配置域词汇正式入册（撞名族改名）**：AuditGovernanceActions 嵌套组（限额/费率/资产/托管钱包/提现地址/客户标签，约 60 写点）是最后一块未入新审计合同的词汇。值为跨族撞名裸词（CREATION_REQUESTED/CHANGE_APPLIED 等三族共用、MFA_LOGIN_VERIFY_FAILED 失败单独起名）——入册须按既有裁决改名＋四属性＋子表。站7 已将整册快照冻结（audit-vocabulary-closure.spec 附册条,只出不进），入册前无人能塞新词 ｜ 来源: 站7 封册 census~~ → **已解（2026-09-02，四模块治愈 换名册四批）**：撞名裸词按域分批改名入 `V1_AUDIT_ACTIONS` 合同（`domain: 'CONFIG'`，四属性齐备）——`ASSET_*`/`CUSTODIAN_WALLET_*`/`WITHDRAWAL_ADDRESS_*`/`TRANSACTION_LIMIT_*`/`SWAP_FEE_LEVEL_*`/`WITHDRAWAL_FEE_LEVEL_*`/`CUSTOMER_TAG_*` 全部改用不撞名的专属前缀；原撞名嵌套结构 `AuditGovernanceActions` 已全仓清零（grep 0 命中）；V1 合同终盘 101 码、退役 97 码进拒写闸。子表覆盖面仍是独立缺口，未随本条销账（见本节上方「`audit_log_subjects` 子表覆盖面远小于设计前提」）

- [ ] **`InternalFundAuditLog` 有读无写 → 资金单详情页审计列表永远空**：Round 2 后零写入方，读取链还在——运营点开任何一张资金单，审计栏都是空的（踩铁律①「操作必留痕」的可见面）。补写状态变更 or 改读中央审计日志 ｜来源: 2026-07-03 死码 D6 改判（勿删表，有活读取链）；2026-08-26 分流迁入 PRODUCTION-NOTES，2026-08-28 判为业务缺口迁回


## I. 贯穿三域（三条交易流程共有 ｜ 客户可见面）

> 三条交易流程共有的，以及客户端那几页 —— 改一处三幕同时受益。

- [ ] ⭐ **客户级冻结不留痕：两条独立路径都会漏审计，补 `select` 字段只治得了一条**：`findNonTerminalByOwner()`（`deposit-transactions.service.ts:1279`、`withdraw-transactions.service.ts:1053`，同一提交 `e198d11d7` 引入）供 `onCustomerRestrictionOpened()` 批量扫描客户名下在途单用，其 `select` 只挑了 `{id, xxxNo, ownerType, ownerId, status, traceId}`——**没选 `correlationId`**。这批对象随后原样传进 `depositAudit()`/`withdrawAudit()`，两者都读 `xxx.correlationId ?? undefined`（恒 undefined）；而 `DEPOSIT_FROZEN`/`WITHDRAW_FROZEN` 在名册里都注册成 `correlationMode: I`（INHERIT，必须继承旅程号），校验命中就抛 `BadRequestException`。**本轮 `demo:all` 实跑（2026-08-29）当场复现**：花名册 #7 制裁冻结那笔（`DEP2608292314`）被 `onCustomerRestrictionOpened` 扫到时，日志原样是 `Failed to write DEPOSIT_FROZEN audit for DEP2608292314 (restriction RST2608297325): Audit action DEPOSIT_FROZEN is INHERIT and must inherit an existing correlationId`——订单本身照常冻上（FREEZE 与审计各自独立 catch，冻结动作不受影响），但**这一冻结动作在审计链上永久查不到**。`withdraw-transactions.service.ts` 的同名方法字面同一个坑（同一提交引入），只是花名册没有任何一行经 `onCustomerRestrictionOpened` 批量扫到提现单（#19 MLRO 冻结是单笔 `dispoTag` 直冻，不走这条广播），所以本轮没有实跑复现，判定为静态确认。**对照**：`swap-transactions.service.ts:942` 的同名方法 `select` 里明确带了 `correlationId`，注释直接写"SWAP_FROZEN 是 INHERIT 码，信封不带旅程号会被机器闸拒收"——三域里唯一修对的是兑换域，充值/提现两个原地留坑。**后果**：任何客户级 ALL-scope 限制（制裁、行政停用……）广播冻单时，只要 `onCustomerRestrictionOpened` 扫到非终态单去执行 FREEZE，对应的 `DEPOSIT_FROZEN`/`WITHDRAW_FROZEN` 事件就写不进审计表——踩铁律①（操作必留痕），第七幕按单号拉全链会当场露馅（这一步"谁冻的、依据什么"查不到）。**路径一修法**：两处 `select` 各加一个 `correlationId: true`（对齐 swap 域已有的写法）。**路径二 · Gate 0 单笔判定直接冻结时压根没调审计（静默，连 error 日志都没有，2026-08-29 合并前终审新查出）**：`deposit-workflow.service.ts` 的 `runGate0()`（由 `deposit.status.changed` 事件驱动，每笔充值单进入 `COMPLIANCE_PENDING` 时跑一次的客户级闸）判定客户命中执法级限制（`enforcement` 分支）后，直接 `updateStatus(FREEZE)`（`:292-299`），**全程没有任何 `depositAudit()` 调用**——不是调了失败，是压根没写这行代码；同一文件里结构对称的 `holdAtGate0()`（行政级 `OPERATION_PENDING` 分支）就有配套的 `depositAudit({action:'DEPOSIT_HELD', ...})`，两个分支待遇不对称，独漏 FREEZE 这半边。**路径一的修法对路径二零作用**——给 `select` 加 `correlationId` 只能让路径一里已经存在的 `depositAudit()` 调用不再抛错，路径二从未走到 `depositAudit()` 这一步，没有调用可失败，必须在 `runGate0()` 的 FREEZE 分支单独补一次 `depositAudit()`（可照抄 `holdAtGate0()` 的写法）。**比路径一更难发现**：路径一好歹在日志里留了一条 `Failed to write ... audit` 的 error，路径二连这行都没有——`FREEZE` 状态跃迁本身成功、`statusHistory` 正常记录，唯独审计表那一步凭空消失，日志层面没有任何异常信号。**本轮花名册 #10 实跑复现**（`DEP2608295862`）：`statusHistory` 能看到 `COMPLIANCE_PENDING → FROZEN`（operator `COMPLIANCE_GATE_0`），但按该单号查 `audit_log_events`，事件链从 `DEPOSIT_PAYIN_COMPLETED` 直接跳到 `DEPOSIT_SEIZE_REQUESTED`——中间这次冻结完全不在审计链上。**两条都是既有缺陷，本分支（`feat/demo-kit-sumsub-panel`）均未引入**：路径一根因 `e198d11d7`（2026-08-16）+ 审计调用 `250ec138e`/`a9c723d5e`（2026-08-20）；路径二根因 `1b06ed36d`（2026-08-22）；`git blame` 确认本分支在这些位置一行未碰——花名册 #10 只是第一次让路径二在标准演示动线里被真实触发（此前没有花名册用例走到"客户已被限制、新单进 Gate 0 直接判 enforcement 冻结"这个分支）。**后果**：任何客户级 ALL-scope 限制（制裁、行政停用……）触发的冻结，不管是广播扫在途单（路径一）还是单笔 Gate 0 直判（路径二），审计链都可能缺这一步——踩铁律①（操作必留痕）。第七幕按单号拉全链会当场露馅：花名册 #10 这条线是"客户被制裁冻结、资金随后上缴"，主持人讲完冻结接着讲上缴，中间那步冻结在审计链上直接跳过去。 ｜来源: 2026-08-29 演示装备一期复审 + `demo:all` 实跑复现（路径一）；路径二为 2026-08-29 合并前终审新查出、静态确认

- [ ] ⭐ **客户流水直读账本分录，缺加工层（业主 2026-08-27 要求登记）** —— `client-web/src/pages/TransactionHistory.tsx` 每一行 = 一条 journal line（四列 Date / Description / Amount / Balance），字段直取 `journal.eventCode`、`journal.sourceType`、`journal.sourceId`。**与 decisions.md [2026-07-07] 已定口径相悖**："客户看到的流水在展示层按订单聚合 ｜ 记账粒度服务对账，阅读体验交给读模型"——该决策至今未落地。两个可见症状：① 描述兜底显示的是内部事件码（`eventCode` 去掉 `EVT_` 前缀），客户看到的是系统词不是业务话；② **Ref 小字 = `sourceType` + 内部 UUID 前 8 位（如 `DEPOSIT-a1b2c3d4`），踩「对外识别一律用业务单号、不暴露 UUID」铁律⑥**。修法：建客户流水读模型（按订单聚合 + 业务单号 + 业务口径文案），客户端改读它、不再直读 journal line。⚠ **平账调账单落账后会自动出现在这一页**（因为直读账本），业主 2026-08-28 定：**调账的客户可见面并入本任务，不在一期做**——一期落地后客户流水会短暂出现天书行（描述兜底成 `RECON_ADJUSTMENT_POSTED`、Ref 是 UUID 前 8 位），已知并接受。本任务落地时的调账行设计（已定稿，直接用）：列表行沿用四列，Description 主行 `账务更正 · <成因客户词>`、副行 `<adjustmentNo> · 原单 <relatedOrderNo>`（业务单号，不用 UUID）；行可点开，详情十格 = 更正单号 / 更正类型 / 关联原单（可点进去）/ 更正原因（客户版文案）/ 更正前→更正后 / 本次调整 / 调整后余额 / 生效日期 / 入账时间 / 资产；**不显示经办人与审批人姓名**。**⚠ 2026-09-02 平账一期半追加：改记（第四族）的客户可见面同批做，且它是两侧的**——一笔改记同时动两个客户的应付：**错记方少一笔（余额下降）、正主方多一笔（余额上升）**，两侧都必须对各自客户可见、且**都要能追溯回那条账本分录**（错记方的余额下跌若被藏掉，事后无法举证，VARA 场景下站不住——这正是 decisions.md [2026-08-28] 三原则第③条管的事）。两行沿用上面同一套设计：Description 主行 `账务更正 · 账户更正划转`、副行 `<adjustmentNo> · 原单 <relatedOrderNo>`；详情十格里的「更正类型」显示改记，**两侧都不显示对方客户是谁**（一个客户的账目不该向另一个客户暴露）。合并加工须守 decisions.md [2026-08-28] 三原则（保净额 / 保余额 / 可追溯回分录，且不合并客户实际经历过的余额变动） ｜来源: 2026-08-27 平账调账单脑暴（查客户流水现状时发现）

- [ ] ⭐ 🔴 **通知 send/retry = STUB**：`core/notifications/` 只有 WebSocket `NotificationsGateway`，无 email/webhook/失败重试实现——roadmap 标 Notification send/retry ✅ MVP 为过度声明；这是 V4-V6 各版本"通知未接"的根因（本体没做，不是没调）｜来源: 2026-07-04 V1 体检

- [ ] ⭐ **三域 Owner 按客户号搜索全是坏的（实证）**：三个列表页输入框都写 `Owner No`，但充值/提现发 `ownerNo`（后端 QueryDto 只有 `ownerId`）→ `main.ts` 的 `ValidationPipe({whitelist:true})` **静默丢弃** → **输什么都返回全量**；兑换把客户号塞进 `ownerId` → 拿客户号比 UUID → **恒 0 行**。实测 `30/30/0`、`83/83/0`、`59/59/0`。修法：三个 QueryDto 加 `ownerNo`，service 穿 `customer: { customerNo }` 关系过滤（**充值表没有 ownerNo 冗余列**，三域要一致只能走关系）；⚠️ 三域 `findAllForCustomer` 都是 `{ ...query, ownerId: customerId }` 的 spread，必须 AND 语义 + 显式剥掉，否则客户传别人客户号能跨客户读单 ｜来源: 2026-08-23 第五批设计期实证（本批「严格只做前端」故未修）

- [ ] ⭐ **`AuthGuard` 里 `/wallet/send` 的受限重定向守着一条不存在的路由**：`client-web/src/components/AuthGuard.tsx` 有一段「WITHDRAW 受限时把 `/wallet/send` 重定向到 `/profile`」，但 `/wallet/send` 这条路由全仓不存在——受限客户真走到这一步会落到空路由。演示第二幕「现场给一位客户开限制」时是可能被点到的 ｜来源: 2026-08-16；2026-08-26 分流迁入 PRODUCTION-NOTES，2026-08-28 判为业务缺口迁回

- [ ] 提现成功通知未接：SUCCESS 时不调 `NotificationsGateway`（基础设施在、workflow 没调）｜来源: 2026-07-03 V5 体检

- [ ] 兑换成功通知未接（SUCCESS 时不调 Notification）｜来源: 2026-07-04 V6 体检

- [ ] **列表页「仅看已超时」是前端过滤，只对当前页生效**：三域 `{Deposit,Withdraw,Swap}TransactionList.tsx` 的「仅看已超时」复选框均在 `useMemo` 里对当前页 `items` 客户端过滤（`formatSlaRemaining(...).tone === 'breached'`），后端列表查询无对应的 `slaBreached`/`slaBreachedOnly` 参数——勾选后只在当前分页内筛选，翻页/换页大小会丢失筛选效果，与既有 `needsReviewOnly` 同款局限（三域列表页均有——充值列表页 `DepositTransactionList.tsx:242` 的注释就自述"与下方 needsReviewOnly 同类局限"）。代码注释已自述该限制（"Backend has no slaBreached query filter yet; apply client-side over the current page only"）｜来源: 2026-08-21 SLA 批次

- [ ] **软破线后 `slaBreached` 会一直为 true 直到状态变化**：`markSlaBreached(id)`/等价方法只做单字段更新，`resolveSlaFields()` 是唯一能把它归 `false` 的路径，只在下一次状态迁移时触发。若运营处理了软破线单但没有推动状态（例如只加了备注、或问题本身要等外部条件成熟），红标不会自动消——UI 上看起来"一直超时"，即便运营已经在处理｜来源: 2026-08-21 SLA 批次

- [ ] **时长是硬编码常量，无 admin 配置界面**：`DEPOSIT_SLA_MINUTES_BY_STATUS`/`WITHDRAW_SLA_MINUTES_BY_STATUS`/`SWAP_SLA_MINUTES_BY_STATUS` 均是各自 service 文件里的 TS 字面量常量，改时长需改代码重新部署；三域此前各有一套不同的可配置性历史（兑换曾经有 `SWAP_COMPLIANCE_TIMEOUT_MS` env 覆盖，本批已删除该开关，统一成与另外两域同款的纯代码常量），现状是**三域一致地**没有任何 env/DB 层面的运行时可配置项。BACKLOG 旧条目「60 秒合规超时未经真实 Sumsub 延迟校准」的具体诉求②（"改成可配置项"）实质上仍未完成，只是数字来源换成了业主裁定的业务口径而非未标定的技术猜测 ｜来源: 2026-08-21 SLA 批次

- [ ] **`formatSlaRemaining` 对不足 1 分钟显示 `"0m"` 而非 `"<1m"`**：`admin-web/src/utils/slaDisplay.ts` 的分级逻辑（`days>0`/`hours>0`/否则 `${minutes}m`）在剩余时间落在 0-59 秒区间时 `totalMinutes=Math.floor(ms/60_000)=0`，直接显示 `"0m"`——对运营而言"0m"容易误读成"已经到期"（虽然 tone 仍是 `normal` 不是 `breached`），比显示 `"<1m"` 更容易造成误判 ｜来源: 2026-08-21 SLA 批次

- [ ] **兑换 resubmit 分支给重提的单子近乎零宽限（唯一没遵守"计的是在这个状态待了多久"的地方）**：`swap-sla.service.ts:73-78`——`sumsubTxnIdOut` 为空时补提交一次然后 `continue`，**不动 `slaDeadline`**（此刻它已经是过去时刻）。下一轮 sweep（30 秒后）看到 `sumsubTxnIdOut` 已有值，直接判超时拒单——Sumsub 实际只拿到 30 秒而不是 5 分钟。旧的 `createdAt` 口径下形态相同，**不是本批引入的回归**；但本批刚立了"deadline 计的是在这个状态待了多久"的模型，这个分支是三域里唯一没遵守它的地方。修法一行：补提交成功后顺手把 `slaDeadline` 往后推一个完整窗口（`resolveSlaFields(COMPLIANCE_PENDING)` 或等价写法）｜来源: 2026-08-21 SLA 批次

- [ ] **「按键 × 按状态」置灰精度**（两条同族，合并登记）：① 兑换 ①Approved 在 SUCCESS/REJECTED 上确是真 no-op 却没被灰（8 键里 1 个过度点亮）；② 充值/提现的 ⑧ On hold 在非 `COMPLIANCE_PENDING` 上是纯 no-op（后端 `decideVerdictLanding` 有 `verdict==='onHold' && status!==COMPLIANCE_PENDING → IGNORE`）却仍可点。两者方向都安全（不误灰），修法都需要引入「按键 × 按状态」矩阵 ｜来源: 2026-08-23 第五批 Task 7 审查

- [ ] **`tags: string[]` 三域 Sumsub DTO 都声明、全 admin-web 零渲染**（后端 `parseDetail` 确实在填）｜来源: 2026-08-23 第五批 Task 2 审查


## J. 待业主拍板（是问题不是任务，定了才排期）

> 这些不是任务，是问题。业主不定口径就不该排期，定了才拆任务。

- [ ] **金额闸门矩阵**：tier 限额 + 大额审批 20 万 + TR 阈值 3,500 三线合一后再统一接入 L1（避免接完旧表又改）｜来源: 限额重设计 + TR 调研（roadmap V3 ADVANCED）

- [ ] **单笔金额级冻结原语（交易风控 L3 前置依赖）**：已终态充值/兑换订单命中行为监测（L3）需冻结"对应金额"，现仅有客户级整体冻结（V2 冻结流），无 TB 层单笔金额锁定/冻结子账户原语；交易风控 L3 落地前须先建（提现无此需求——钱已出只管人）。设计见 `superpowers/specs/2026-07-12-transaction-risk-gates-design.md` §5/§7 ｜来源: 2026-07-12 交易风控三闸门 spec（业主定 deferred，不纳入本 spec）

- [ ] **⚠待定：受众（requiredTags/window）变更口径**：现变更流只覆盖 `tiersJson`（configHash 保护费率本身）；受众字段变更是否也走 configHash + 审批链未定 ｜来源: 2026-07-11 费率 V3 §4.2

- [ ] **待决策：cheapest 只减免不加价**：命中集合取最低费 → 更贵的级永不胜出；若将来要"VIP 必走 VIP（即便更贵）"或高风险客户加附加费，须改**优先级选级引擎**（V3 明确不做，留此账）｜来源: 2026-07-11 费率 V3 §5.5

- [ ] **翻案（MANUAL_CHECKING→approved）/below-min 放行（waive）后，原命中证据被最新报文覆写，无历史留档**：`sumsubTxnDetailJson`/`sumsubVerdict`/`sumsubScore` 是单列"最新一次"存证（乙口径，后盖前，见 `modules/v4-deposit.md` §4.4 历史记录），一笔曾被 `rejected`（如命中 PEP/制裁 tag）过、后来翻案/补料通过的单，一旦收到新的 `approved` 裁决，旧的命中证据（`matchedRules`/`typedTags`/`score`）整份被覆盖——仅从当前状态/报文看不出这笔单历史上曾命中过什么规则，对事后合规复盘/审计取证不利。业主未给口径（要不要留历史版本、还是只留最新一份即可），暂不处理 ｜来源: 2026-07-31 Task 4/Task 9 code 走查

- [ ] **对手方恰好是我的客户（交叉场景）——本批不考虑**：一笔交易的对手方地址如果恰好也是本平台的客户，`SANCTION_COUNTERPARTY` 命中理论上应该同时触发对该"对手方客户"的复核，当前实现只处置发起方，不追溯对手方身份 ｜来源: 2026-08-20 制裁分主体批次

- [ ] 法币轨道是否即时到账（决定非营业日走 HELD 等账单 vs 结转收盘判 MATCHED）｜来源: spec §10

- [ ] aging SLA 阈值（法币 ≥1 银行日 / 链按确认窗口）具体数值 ｜来源: spec §10

- [ ] 人工平账 maker-checker 是否按 severity 分级审批人（v1 可扁平：一律一道复核）｜来源: spec §10

- [ ] **INTERNAL_BREAK 全链本期不做**：内部恒等检测+中止代码已在（`wallet-recon-run.service.ts → computeInternalIdentity()` 预门），但事故界面（见上「INTERNAL_BREAK run 详情误显示空表」）/ 实时告警 / 收敛冻结 / 受控更正 workflow / 恒等左移 全部 defer；**对账 PRD 显式不体现 INTERNAL_BREAK 作为 run 结果**（run 结论只留 对平 / 有差异两态）｜来源: 2026-07-12 PRD 重写 Q3

- [ ] **人工腿推单 + BREAK/异常处置 = 本期非目标**：本期只交付**同步腿推单**（外部回执验证、免审批）；人工强推腿（`push/manual` + `ManualPushDto`，代码已在）、真差异/异常处置本期不作为交付/验收范围 ｜来源: 2026-07-12 PRD 重写 Q1


## K. 文档与验收用例

> 文档与验收依据。前两条是第一幕/第二幕的验收没有依据。

- [x] ~~审批流与审计检索无专属验收用例（待补 TC-10）~~ **2026-08-31 销账**：验收口径改为七幕走查（业主裁定走乙、`test-cases/` 整体封箱），第一幕与第七幕在 `demo/script.md` 均有剧本，本条前提不再成立

- [x] ~~客户与合规无专属验收用例（待补 TC-11）~~ **2026-08-31 销账**：同上——第二幕在 `demo/script.md` 有剧本，验收依据成立

- [ ] **Material Refresh 状态名不符**：代码 NUDGE_ONLY/CLEARED vs roadmap NUDGE/RESOLVED（文档订正即可）｜来源: 2026-07-04 V2 体检

- [~] roadmap **V3/V4 已按三层新格式重排 + truth 外置**（2026-07-03）；V1/V2/V5-V9 待同款处理


---

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
- [ ] **邀请自然过期与管理员撤销共用 revokedAt 列，管理台把超时邀请显示成 REVOKED** —— `sweepExpiredInvites()` 打 `revokedAt`（既有设计），`UsersService.mapInvitationStatus()` 先查 revokedAt 后查 expiresAt，语义撞车。2026-09-01 邀请清扫接上 @Cron 后此现象从理论变每小时真发生。修法方向：sweep 不写 revokedAt（展示层本可从 expiresAt 派生 EXPIRED），或状态派生改判定序 ｜来源: 四模块治愈 Task 3 实施发现
