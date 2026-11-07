# 战役戊 · 波二 spec —— 新账本才有的能力

> 日期 2026-11-07 ｜ 状态：**已实施并合 main（2026-11-07 ff `dbfbd59d`，25 个提交；plan 同名，同在 archive）**
> 总纲：`2026-11-06-campaign-e-ledger-by-location-charter.md` §3 波二行 ｜ 科目表 = 总纲附录 A ｜ 分录 = 总纲附录 B「波二」列（本文只写附录 B 没写细的部分）｜ 骨架：`2026-11-06-campaign-e-wave2-skeleton.md`（承接波一、已定事实、悬挂项，本文不重抄）
> 收尾对照 `rules/delivery-checklist.md`；评审按 `rules/review-rubric.md`。本波**动钱 + 新单据 + 新科目码 + 动对账引擎，评审升档**（总纲 §7 点名）。
> 一句话定位：**账本按钱包开户之后，才做得对的四件事**——认损补缺不再动客户余额、公司钱包之间能挪钱、LP 欠的货挂在账上、每个钱包自己的两本账也要对。业主 2026-11-07 定调：**本波按真实运营逻辑裁定，不按演示顺手来定**；剧本随之改写，但不驱动设计。

## §0 脑暴裁定台账（2026-11-07）

| # | 岔口 | 裁定 | 谁定 |
|---|---|---|---|
| 1 | 认损补缺一张单还是两张 | **甲：一张单、一个人一次决定**。金库从案件页开「认损补缺」单，CFO 批一次；批的那一刻记短缺，系统自动生成公司转钱的腿，钱到客户钱包短缺归零。今天「认损调账单 + 补款划转单」两张单两次批的走法退役 | 业主 |
| 2 | 公司钱包间挪钱是不是新单 | **是，新单「公司调拨单」**。单据按「钱从谁到谁」分，公司的钱只有五种走法（外→公司注资单、公司→外付款单、公司⇄LP 兑换单、公司→客户划转单、**公司→公司调拨单**），不会有第六张；**用途是单上的一个标签**，波二只放「扫费」一个值，以后加用途 = 下拉加一个值 | 业主（担心一个用途一张单，要简单办法） |
| 3 | 付款单 from | **不固定，由人选** | 业主 |
| 4 | 调拨单 from / to | 由人选，与付款单同规矩；**可选范围只有运营户、手续费户**。结算户里的钱正在往客户走、LP 前厅里的钱是 LP 刚交来还没验收，这两个口袋不许挪作他用 | 作者（业主已知） |
| 5 | 扫费同额结转 | **做，且只在「手续费户 → 运营户」这条路上做**：借 收入 / 贷 公司权益，同额。理由见总纲附录 A「不变量」：手续费扫进运营户后运营户的钱比公司权益多，卖光运营户会把公司权益减成负数、TB 报错。从手续费户直接付供应商不结转（钱没进运营户）。金额默认整扫、可少扫；少扫时结转按码序 210 → 211 扣到够为止 | 作者设计；业主 2026-11-07 听完解释未反对，**施工检查后请业主再核一眼** |
| 6 | 银行自己扣的服务费怎么平 | **补记，不补单**（没人发起、没有后续）。**波一已有**：RECORD 家族 `BANK_CHARGE_UNBOOKED`（公司池、REDUCE）落 300 银行与托管费用（`adjustment-rules.ts:86, 116`）。本波零改动。作者 2026-11-07 在讨论里说「要加一个原因」是记错了，这里更正 | 作者更正 |
| 7 | 对内差额开案 / 结案口径 | **≠ 0 即开案**（对外差额为 0 也开）；**归零才结案**，没有「解释掉」这条路。对内不平只可能是记账出错或多腿单记了一半，不是时间差。只对客户钱包算（公司本没有逐钱包恒等式） | 作者 |
| 8 | 调账行怎么跟外部行配对 | **显式锚配对**：调账单 / 认损补缺单落账时已经记着「它解释的是哪条内部行 / 哪条外部行」（`explainedFlowId` / `explainedExternalLineId`），匹配器第 0 轮先按锚把它们配成一对或一组；波一「按 `sourceType` 整体排除调账行」退役。这是裁定 1 的必需配套：认损补缺单的记短缺分录 `sourceType` 是 `INTERNAL_TRANSFER`，旧排除法罩不住它 | 作者 |
| 9 | 看板 | 应收 LP 单独一格 | 作者 |
| 10 | 案件页 Balance Explained | Internal 格下加一行副行「现金 + 短缺待补 vs 应付 + 暂扣」 | 作者 |
| 11 | 两个「钱包→现金户」解析器 | **合一**：对账读端改调 `AccountingService.resolveCashAccountId`，ledger 由 `ledgerForNetwork(wallet.network)` 给。码 2 按钱包开户后，解析器必须只有一个 | 作者（骨架悬挂项） |
| 12 | NLA 算术门 | 付款单与调拨单 **from = 运营户时过门**（照 2026-09-30「NLA 事前算术门」裁定）；from = 手续费户不过（运营户不动） | 作者 |

翻案记录（本波改掉的旧裁定，收官时随总纲 §6 第 3 条一并写进 `decisions.md`）：2026-09-05「平账二期内部划转单只做公司 → 客户两条路；公司池调拨不做，手续费归集留 BACKLOG」（`decisions.md:59`）→ 公司调拨单；2026-09-05「客户池核销 = 认损调账 + 补款划转两步」（`:61`）→ 一张单；2026-09-07 客户措辞「Credit from FiatX · balance restoration」（`:91`）→ 认损补缺客户端零行，该措辞随 `CLIENT_COMPENSATION` 退役（垫款的「· advance」保留）。`BACKLOG.md:188`「手续费归集不做」本波销账。

### §0.1 施工检查后的作者裁定（2026-11-07，opus 施工检查 8 问 + 9 处与代码不符；无一需业主答，业主看 spec 时核）

| # | 施工检查问的 | 裁定 |
|---|---|---|
| 13 | 手续费户里不全是 210/211 的钱（没收入账贷 212 也落手续费户；补记利息贷 212；本波允许的 运营户 → 手续费户 调拨），整扫时结转扣不到 TB 会拒 | **结转额 = min(调拨金额, Σ(210..212) 该 ledger 余额)，按码序 210 → 211 → 212 扣到够为止**；超出收入总额的那部分钱本就是公司权益背书的（从运营户挪过来的），不需要再结转，不变量照样成立。三笔各自 eventCode（`FEE_INCOME_CLOSE_SWAP / _WITHDRAW / _OTHER`，转账号按 eventCode 哈希，同码两笔会撞） |
| 14 | 客户现金户带「贷不得超借」标志，TB 判标志时把挂起的贷方也算进去；钱包上挂着待批提现锁定（第 31 场 Bob 的 250,000）时，码 91 必被拒 | **认损前要求该钱包「现金 posted − 挂起贷方 ≥ 短缺额」**，开单与批准各查一次，不够就拒并指路「先处理该钱包的在途出款」（金库把待批提现拒掉 / 撤回）。真实运营里本就如此：托管少了钱，这只钱包的出款先停。第 31 场顺序改为「拒 #18 大额待批提现 → 认损补缺」。短缺窗口内客户再提现，TB 拒锁 = 建单失败，沿用既有报错不另做提示（§2 禁做边界防御；PRODUCTION-NOTES 一行） |
| 15 | 91 已落账、腿却 FAILED / TIMEOUT：能不能再开一张？再开会记两次短缺 | **不做重补**（项目总纲 §2：不做补偿 / repair）。带 `recognizedTbTransferId` 的 FAILED 单计入阻塞集，同一行开不出第二张；行标签「Shortfall recognised · top-up failed ITR…」，短缺户挂着等人工；PRODUCTION-NOTES 一行。e2e C2 改为断言「腿失败 → 单 FAILED、入口不回来、短缺户不归零」 |
| 16 | 调账单两个锚都是可选的，退役整体排除后无锚调账流水会变成永远配不上的孤儿 | **第 0 轮只处理有锚的调账 / 认损流水；无锚的调账流水不参与匹配（只进余额）**，排除条件从「sourceType = RECON_ADJUSTMENT」收窄为「调账流水且两锚皆空」。锚仍不强制（余额只差、没有对应外部行的破口真实存在） |
| 17 | 91 生效日取什么？案件页 Re-reconcile 按案件业务日重跑，事后分录只有生效日等于那天才看得见 | **生效日 = 案件业务日**（同调账单核销 `effectiveDate = kase.businessDate`），存 `InternalTransfer.effectiveDate`，弹层只读显示；事故路老案同规则 |
| 18 | 对内差额 e2e 用跨本分录造不平会先撞预门 `computeInternalIdentity`（整轮 INTERNAL_BREAK，逐钱包根本不跑） | **预门不动，造数改同本跨客户**：借 1·A 钱包 / 贷 100·B 客户 → 两张 INVARIANT 案（A +X、B −X），反向记回 → 两案自愈。这也说清了对内差额在生产上逮的是什么：同一本账内跨客户记了一半的错（改记两笔只落一笔之类） |
| 19 | 认损补缺单什么时候挂到差异行、挂成什么 | **照核销先例：开单即挂**（`transferNo` 落处置记录、行锁定），驳回 / 撤回 / 超时 / `RECOGNITION_FAILED` 时解开；**outlet 不改写**（仍 HOLD_INVESTIGATING / INCIDENT），只加 `transferNo`——**不加 DispositionKind**（加了会进 `disposition.dto.ts:13` 白名单，变成可直接 record 的后门） |
| 20 | 应收 LP 的 e2e 放哪（仓库没有 LP 兑换 e2e，私库种子停在 LP 台之前） | **新写 `lp-receivable.e2e-spec.ts`，夹具用 prisma 直造 ACTIVE 的 LP 档案 + 打款地址并调 `ensureForLp`**（同夹具直造钱包要调 `ensureForWallet` 的规矩，R15）；私库隔离仍是 TOOLING-DEBT，本波不修。付款单同样没有 e2e，§8.5 新写 |
| 21 | 码 2 的户归属 WALLET，投影器按 `ownerType === 'WALLET'` 给流水打 `walletRef`，短缺待补的流水会混进钱包流水与钱包对账单累加 | **投影器打 `walletRef` 的判据改为 `ownerType === 'WALLET' && isCashCode(code)`**；码 2 流水不带 walletRef，不进钱包对账单、不进 `account-flows?walletRef=`。对内差额取码 2 余额走注册表（`ownerUuid = wallet.id`），不靠 walletRef |
| 22 | `recon:demo` 铺场的取行条件（`scripts/recon-demo.ts:457-463`）不是匹配过滤，是模拟托管方「按现金户行生成对账单行」的取数（总纲假设②） | **保留并扩大**：模拟对账单不回写调账流水，也**不回写码 91 记短缺流水**（按 eventCode 排除）。§1 把它说成「同款过滤」是错的，已改 |

## §1 已核事实（2026-11-07 两只 sonnet 扫描 + 主会话抽查；plan 不必重查，重查命令见扫描交付）

- **划转单**：`InternalTransfer`（`schema.prisma:888-921`）六态六边（`internal-transfer-transitions.constant.ts:4-14`）；用途 `CLIENT_COMPENSATION | CLIENT_ADVANCE`（`dto:15`）；腿规划 `resolveRoute`（`workflow:108-112`，法币经 F_SET 两腿、加密币一腿）；分录 81（`:292-300`）、82 + 83 同一步两笔（`:303-319`，83 的 eventCode 按用途分 `INTERNAL_TRANSFER_COMPENSATION_IN | ADVANCE_IN`）；余额闸 `assertFirmOpsBalance`（`internal-transfer.service.ts:77-94`）；审批 `INTERNAL_TRANSFER_APPROVAL` CFO 单步 48h 可撤（`approval.constants.ts:416`）；审计七码 `V7_TREASURY_AUDIT_ACTIONS`（`audit-actions.constant.ts:1159-1167`），键集被 `internal-transfer-audit-codes.spec.ts:10-13` 锁死；前缀 `ITR`；权限组 `INTERNAL_TRANSFER_READ / WRITE`（`rbac.catalog.ts:512-516`），WRITE 仅金库。
- **补款入口链**（要退役的）：`deriveFundingNextStep`（`funding-next-step.ts:16-24`，条件 = 客户池 + 调账单 POSTED + `UNEXPLAINED_CLIENT_LOSS` + 无活划转单）→ `CaseFlowTable.tsx:388-399`「Initiate compensation」→ `InternalTransferInitiateModal.tsx:24-27` `POST /admin/internal-transfers/compensation {adjustmentNo, reason}` → `workflow.initiateCompensation:56-79`。事故页补款入口 `IncidentDetailPage.tsx:328-332, 650`。
- **认损出现条件**：账龄路 `reconciliation-query.service.ts:765-780`（OPEN + 超期 + HOLD_INVESTIGATING + 无调账单；客户池 INCREASE → `CLIENT_SURPLUS`，大额 → `INCIDENT_DEFERRED`，否则 `WRITE_OFF`），事故路 `:795-813`（ASSESSED/RESOLVING + `FIRM_LOSS` + 金额锁定）；写面守卫 `adjustment.service.ts:177-211`（账龄）、`:247-276`（事故）。
- **调账单分录**：`resolvePostingLegs`（`adjustment-rules.ts:131-139`），客户池恒「借 100 / 贷 1」或反向；公司池对手科目按家族（`:111-124`）：CORRECT / REVERSE → 200，RECORD → 300 / 212，WRITE_OFF → 301 / 212。锚 `explainedFlowId / explainedExternalLineId`（`schema.prisma:1777-1778`），处置单同款锚 + `adjustmentNo / supplementNo / incidentNo`（`:1817-1828`）。
- **匹配器**：`MatcherInput`（`wallet-flow-matcher.service.ts:63-72`）；内部行按 `sourceType ≠ RECON_ADJUSTMENT` 排除（`:158-176`），同款过滤在 `flow-comparison.builder.ts:96-101`；`scripts/recon-demo.ts:457-463` **不是**匹配过滤，是铺场时模拟托管方「按现金户行生成对账单行」的取数条件（裁定 22）；三轮：Pass 1 按 `externalRef`（`:198-223`）、Pass 2 金额 + 方向 + 60 分钟（`:226-240`）、Pass 3 在途（`:242-277`）。已解释索引 `ExplainedDifferenceService.indexForWallet`（`explained-difference.service.ts:67-84`）有三个用处：喂 `anomalyCount` 抑制（`run.service:392-398`）、把已解释差异行写成 `status=EXPLAINED / resolution=ADJ 号`（`:878-887`）、读面下发 `explainedByAdjustmentNo` 供行锁定判断（`flow-comparison.builder.ts:146/191/208/237` → `CaseFlowTable.tsx:388`）；读面规定 MATCHED 行不挂注解（`reconciliation.dto.ts:160-173`）。调账单的两个锚都是可选的（`adjustment.dto.ts:14-15`），只有核销路强制。
- **跑批**：快照行 `ReconciliationRunWallet`（`schema.prisma:2088-2112`）**没有**未解释字段，Unexplained 是读面现算 `delta − inTransitSigned`（`reconciliation-query.service.ts:481`）；案件 `ReconciliationCase`（`:1681-1735`）；分桶 `bucket-classifier.ts:17-23`（残差 ≠ 0 → BREAK → 在途 → COMPENSATING → MATCHED）；差异行 `matchStatus` 已含 `INVARIANT` 值（`:1742` 注释），今天没人写；账簿天平 `computeInternalIdentity`（`run.service:641-692`）硬编码码集合，`scripts/verify-realtime-coa.ts:33-39` 同款。
- **对账读端解析器**：`wallet-balance-checker.service.ts:69-97` 自己查注册表（码按 ownerType、ledger 按 network），与写端 `AccountingService.resolveCashAccountId(walletId, ledger)`（`accounting.service.ts:419-430`）并存。
- **付款单**：`VendorPayment`（`schema.prisma:1066-1095`）已有 `fromWalletId` 列，建单固定 F_OPS（`vendor-payment-workflow.service.ts:90`）；NLA 门在 `:86`，余额闸 `vendor-payment.service.ts:99-118`；87 借 300 / 贷 现金·`fromWalletId`（`:260-275`）；表单 `VendorPaymentList.tsx:49-172`。
- **LP 兑换单**：84 / 85 / 86 在 `lp-exchange-workflow.service.ts:430-477`（85 今天贷公司权益）；三钱包 `:125-127`；LP 档案 →ACTIVE 两条边 `lp-profile-workflow.service.ts:181`（批准）、`:170`（复活）；注册表 `ownerType='LP'` 今天**零开户路径**（在 `src/modules/accounting`、`prisma`、`scripts` 内用字面量 / 正则 / 关联文件三种搜法未找到；`cashAccountCodeFor('LP')` 必须抛错由 `tb-account-codes.constant.spec.ts:111` 锁）。
- **注册表与计数基线**：审批策略 55（`DEFAULT_APPROVAL_POLICIES :227-509`）、`MAKER_GROUP_BY_POLICY` 54 + 豁免 1（`scripts/verify-rbac.ts:254-350`）、S9 表 45（`verify-rbac.tables.ts:6`）、路由表 45（`approvalEntityRoutes.ts:18`，与 S9 键集相等由 `approvalEntityRoutes.spec.ts:6-10` 锁）、`ApprovalPoliciesPage.tsx:37` 标签表；审计现役码 **378**（18 本名册，`audit-vocabulary-closure.spec.ts:52-71` 列名册；`baseline.md:432` 与 `lark/…catalog-full.md:4` 的 360 已过时）；转账码最大 87，**没有**锁整表的 spec（逐码断言散在 9 个 spec）；业务号前缀没有登记表，现役前缀由各服务 `generateReferenceNo('…')` 字面量构成（按口径不同数得 39～44 个，不记数），`HTR` 未占（`rg "generateReferenceNo\('HTR'"` 零命中）。
- **科目码加码要改的位置**：`tb-account-codes.constant.ts` 的码表 `:11-28`、名表 `:46-58`、`COA_TO_TB_CODE :83-95`、`DEBIT_NORMAL_TB_CODES :110`、`CASH_TB_CODES :121`（不动）、`cashAccountName :154-160`；spec `tb-account-codes.constant.spec.ts:23-37`（恰 11 码）、`:67-69`、`:82`、`:151`、`:169-177`；`asset-provisioning.service.ts:8-18`（每资产 7 个系统户）；`WalletCashAccountService.ensureForWallet`（`wallet-cash-account.service.ts:36`，唯一运行时调用点 `customer-deposit-wallet.service.ts:101`）；种子 `seed-tb.helper.ts:92 ensureWalletCashAccount`（`seed.business.ts:234, 3632-3633`、`demo-lib.ts:354`）。
- **看板**：`CompanyFundsDashboard.tsx` 读 `GET /admin/tb/accounts?ownerType=SYSTEM` 与 `?ownerType=WALLET&code=50`（`:286-291`），格子按 `walletRole` 分（`:353-360`），端点返回 `walletRole / walletNo / balance / accountName`（`tb-account-registry.service.ts:135-200`）。
- **客户侧**：对账单与月结单只读 100（`customer-portfolio.controller.ts:75-86`、`monthly-statement.service.ts:143-146`）；白名单 `customer-statement.service.ts:181-190` 登记 `INTERNAL_TRANSFER_COMPENSATION_IN / ADVANCE_IN`；认损那行客户端标题实际是「Balance adjustment」（`adjustment-rules.ts:72`，`customer-statement.service.spec.ts:178-194` 锁死），`script.md:230 / :232` 写的「Balance correction · Client loss recognition」与代码不符。
- **NLA**：只读 F_OPS 现金户（`prudential.service.ts:94-103`），内部划转与注资不过门（`:126-131`）。
- **种子**：LP 历史兑换单三腿 `seed.business.ts:2802-2821`（85 借 F_LIQ 现金 / 贷 FIRM_EQUITY）；没有种子化的划转单 / 调账单；`seedCapitalInjection :2225`。
- **e2e**：对账五支 `recon-*` + `incident-register`；涉及认损 / 补款的用例：`recon-internal-transfer.e2e-spec.ts:557（A）, 684（C1）, 698（C2）, 718（C3）, 737（P2）`、`incident-register.e2e-spec.ts:536（5）`、`recon-aging-write-off.e2e-spec.ts:523（反例③）`；`recon-reattribution:442` 的四腿同愈。

## §2 本波做 / 不做

**做**：① 认损补缺一张单（划转单新用途 `SHORTFALL_TOPUP`，码 2 托管短缺待补开户与分录）；② 公司调拨单（新主体、新审批、新审计码、扫费结转）；③ 付款单 from 可选；④ 应收 LP（码 51 开户、88 新码、85 改贷方）；⑤ 对内差额进跑批与案件；⑥ 匹配器第 0 轮锚配对，退役 `sourceType` 排除；⑦ 解析器合一；⑧ 读面：案件页 / 跑批页 / 看板 / 调拨单两页 / 付款单表单；⑨ 种子、剧本、基线、e2e 随之。

**不做**（对照项目总纲 §2 与总纲 §5）：入账追回与垫款链（`CLIENT_ADVANCE` 用途原样留着、入口照旧置灰）｜ 对内差额的业务处置菜单（归零只能靠技术更正，见 §4.3）｜ 扫费定时任务 ｜ LP 到货多于 / 少于合同数的分支（乙波一裁定 5）｜ 应付供应商（150）开户 ｜ 调拨单 / 付款单 from 开放到结算户、LP 前厅 ｜ NLA 公式改口径（仍只算运营户；手续费户、应收 LP 不计入——记 BACKLOG，波三或后续裁）｜ 收入报表视图（扫费后收入户余额只剩未扫的费，本期收入看流水；BACKLOG 既有「财务四张报表视图」）｜ 新演示幕次（新场景进既有幕）｜ 认损补缺单与划转腿的原子性（PRODUCTION-NOTES 既有一行）。

## §3 科目、转账码、天平（一次列全，plan 不得追加）

### 3.1 新科目码（总纲附录 A 已定，本波进代码）

| 码 | 常量 | 中文 / 英文 | 归属 | 借贷 | 开户时机 |
|---|---|---|---|---|---|
| 2 | `CLIENT_SHORTFALL` | 托管短缺待补 / Custody Shortfall Receivable | WALLET（每个客户钱包一户，`ownerUuid` = wallet.id） | 借 | 与码 1 同时：`WalletCashAccountService.ensureForWallet` 对 CUSTOMER 钱包一次开 1 + 2；种子 `ensureWalletCashAccount` 同款；平台钱包不开 |
| 51 | `LP_RECEIVABLE` | 应收 LP 交货 / Due from LP | LP（`ownerUuid` = LiquidityProvider.id，`ownerNo` = lpNo，每 LP 每 ledger 一户，AED + USDT 各一） | 借 | LP 档案 →ACTIVE 的两条边（`lp-profile-workflow.service.ts:181, :170`）调 `LpReceivableAccountService.ensureForLp(lpId)`；已存在直接返回（照 `ensureForWallet:41-42` 先例）；种子对 Falcon、Dune 两家开 |

- `DEBIT_NORMAL_TB_CODES` 加 2、51；`CASH_TB_CODES` **不动**（仍 {1, 50}，短缺待补与应收 LP 不是现金户，对账不读它们的流水当钱包流水）；`cashAccountCodeFor('LP')` 仍抛错。户名：码 2 `Custody Shortfall · <客户号> · <角色>`（照 `cashAccountName` 模式，存注册表 `description`）；码 51 `Due from LP · <LP 名称>`。
- 标志位按类别：两者都是借方户 → `credits_must_not_exceed_debits`（`accountFlagsFor` 不改，自然落）。
- 天平（`computeInternalIdentity`、`scripts/verify-realtime-coa.ts`、`verify:coa` 三处同改）：客户本 Σ(1) + Σ(2) = Σ(100) + Σ(101)；公司本 Σ(50) + Σ(51) + Σ(300..302) = Σ(200) + Σ(210..212)。

### 3.2 新转账码（从 88 起，u16 一经分配不可改）

| 码 | 常量 | 借 | 贷 | 时刻 | eventCode / sourceType |
|---|---|---|---|---|---|
| 88 | `LP_EXCHANGE_RECEIVABLE` | 51·该 LP（买入币 ledger） | 200（买入币 ledger） | LP 兑换单卖出腿确认，与 84 同一步、紧随其后 | `LP_EXCHANGE_RECEIVABLE` / `LP_EXCHANGE` |
| 89 | `HOUSE_TRANSFER` | 50·to 钱包 | 50·from 钱包 | 公司调拨单腿确认 | `HOUSE_TRANSFER` / `HOUSE_TRANSFER` |
| 90 | `FEE_INCOME_CLOSE` | 210 → 211 → 212（码序，每户至多一笔，扣到够为止） | 200 | 同上一步，**仅当 from.vaultCode = F_FEE 且 to.vaultCode = F_OPS**；总额 = min(调拨金额, Σ(210..212) 余额)（裁定 13） | `FEE_INCOME_CLOSE_SWAP / FEE_INCOME_CLOSE_WITHDRAW / FEE_INCOME_CLOSE_OTHER` / `HOUSE_TRANSFER` |
| 91 | `CLIENT_SHORTFALL_RECOGNIZED` | 2·客户钱包 | 1·客户钱包 | 认损补缺单 CFO 批准那一步，先于建腿 | `INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED` / `INTERNAL_TRANSFER` |

码不改号、语义改写（注释改写 + evidence 的借贷码随之）：

| 码 | 今天 | 本波起 |
|---|---|---|
| 83 `INTERNAL_TRANSFER_CLIENT_IN` | 借 1·客户钱包 / 贷 100 | 用途 `SHORTFALL_TOPUP`：**借 1·客户钱包 / 贷 2·客户钱包**，eventCode `INTERNAL_TRANSFER_SHORTFALL_TOPUP_IN`（不碰应付，客户端零行）。用途 `CLIENT_ADVANCE`：原样（借 1 / 贷 100，`ADVANCE_IN`） |
| 85 `LP_EXCHANGE_RECEIVE` | 借 50·F_LIQ / 贷 200 | **借 50·F_LIQ / 贷 51·该 LP** |
| 80 `RECON_ADJUSTMENT` | 客户池 WRITE_OFF（`UNEXPLAINED_CLIENT_LOSS`）借 100 / 贷 1 | **客户池认损从调账单退役**：`UNEXPLAINED_CLIENT_LOSS` 从 `REASON_SPECS`（`adjustment-rules.ts:72`）删，调账单写面不再接受它；码本身保留，改作认损补缺单的固定成因常量，`resolveWriteOff`（`cause-registry.ts:206-209`）客户池分支仍产出它、`nextStep.kind` 改 `SHORTFALL_TOPUP`；其余引用点（`reconciliation.dto.ts:214`、`reconciliation-query.service.ts:809`、`adjustment.service.ts:91/220/307/553`、`internal-transfer-workflow.service.ts:60`）逐处按新归属改或删，退役以 grep 清点为准。公司池 `UNEXPLAINED_WRITE_OFF` 不动 |

- 90 的 TB 拒绝 = 落账失败 = 这一步失败，照划转单 `POSTING_FAILED` 先例写审计、单停在 EXECUTING（铁律⑤，不做补偿）。裁定 13 的封顶让「钱不是收入」不再触发拒绝；仍会拒的只剩真异常。
- 抽核表（波一 T13 的 `a4-table.js`）：新码四条加期望；83 按 eventCode 分两行期望；85 改期望。

## §4 四件新事怎么做

### 4.1 认损补缺一张单（划转单用途 `SHORTFALL_TOPUP`）

**主体**：复用 `InternalTransfer`。用途枚举 `['SHORTFALL_TOPUP', 'CLIENT_ADVANCE']`（`CLIENT_COMPENSATION` 改名为 `SHORTFALL_TOPUP`，非新增）。字段增减（迁移一份，无 backfill）：
- 加 `explainedFlowId String?`、`explainedExternalLineId String?`（锚，语义同调账单 `schema.prisma:1773-1778`：锚真实证据 id，不锚每轮重建的差异行）；加 `recognizedTbTransferId String?`、`recognizedAt DateTime?`（记短缺那笔的回执）；加 `effectiveDate DateTime`（= 案件业务日，裁定 17）；加 `lossSource String`（`'AGING' | 'INCIDENT'`）与 `sourceIncidentNo String?`（事故路带来路）。
- 删 `sourceAdjustmentNo`（唯一写入方是退役的补款路，`CLIENT_ADVANCE` 用 `sourceExternalLineId`）。
- 状态机六态六边**不加边**：批准那一步「记短缺失败」走既有 PENDING_APPROVAL → FAILED（`failureReasonCode` 新增值 `RECOGNITION_FAILED`）。

**入口**：案件页差异行 Resolve 菜单「Fix the books」组的「Recognize loss」改为 **「Recognize loss & top up」**，出现条件 = 今天 `nextStep.kind === 'WRITE_OFF'` 的客户池分支（`reconciliation-query.service.ts:765-780` 的账龄路，小额、REDUCE）与事故路（`:795-813`，`FIRM_LOSS` 定损、金额锁定）两条，`nextStep.kind` 改名 `SHORTFALL_TOPUP`（客户池）；公司池仍 `WRITE_OFF` 走调账单。弹层：成因固定 `UNEXPLAINED_CLIENT_LOSS`（只读）、金额锁定（差额或定损额）、生效日只读、**from 钱包下拉**（该币种的运营户 / 手续费户，默认运营户，显示余额）、理由必填。提交 `POST /admin/internal-transfers/shortfall-topup {caseNo, flowId?, externalLineId?, fromWalletId, reason}`（至少一个锚，照 `adjustment.dto.ts:14-15` 的隐锚写法；案件页行没有 lineNo）；「Initiate compensation」按钮、`/compensation` 端点、`InternalTransferInitiateModal` 的补款分支、`deriveFundingNextStep` 的 `COMPENSATION` 分支整条退役（前端入口同步删，交付清单「退役业务动作」）。

**写面守卫**（搬自 `adjustment.service.ts:177-211 / :247-276`，调账单那两段只留公司池用）：账龄路 = 案 OPEN + `slaBreached` + 该行定性 `HOLD_INVESTIGATING` + 小额 + 客户池 REDUCE；事故路 = 事故 ASSESSED/RESOLVING + `FIRM_LOSS` + 金额 = `assessedAmount`；两路都要求该行没挂过认损补缺单（活单阻塞照 `INTERNAL_TRANSFER_BLOCKING_STATUSES`，**外加带 `recognizedTbTransferId` 的 FAILED 单**，裁定 15）；**该客户钱包现金户「posted − 挂起贷方 ≥ 短缺额」**（裁定 14：TB 判「贷不得超借」把挂起贷方算在内，待批提现的锁定会让码 91 被拒；不够就拒并指路「先处理该钱包的在途出款」）；from 钱包 ∈ {F_OPS, F_FEE} × 该币种网络；from 余额 ≥ 金额（§5.4 共用闸）；**NLA 门不过**（义务性付款，照 `prudential.service.ts:126-131` 既有口径）。

**流程**：提交 → `PENDING_APPROVAL`（`INTERNAL_TRANSFER_APPROVAL`，CFO 单步，快照加 `fromWalletNo / lossSource / effectiveDate`，impact 文案：「Recognize custody shortfall of <amt> on wallet <walletNo> for customer <CU…> and top it up from <from wallet>; customer balance unchanged」），**提交即挂**：处置记录落 `transferNo`、差异行锁定（裁定 19；驳回 / 撤回 / 超时 / 记短缺失败时解开）→ CFO 批 → `onDecided` APPROVED：① from 余额与客户钱包「posted − 挂起 ≥ 短缺额」复查；② **记短缺**：码 91 借 2·客户钱包 / 贷 1·客户钱包，`effectiveDate` = 案件业务日，写审计 `INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED`，回执落 `recognizedTbTransferId / recognizedAt`；失败 → FAILED(`RECOGNITION_FAILED`) 并解开行锁；③ → EXECUTING，建腿 1（路线照旧：法币 from → F_SET → 客户 vIBAN 两腿，加密币 from → 客户地址一腿；`resolveRoute` 的 from 改为单上的 `fromWalletId`）→ 金库 ⚡ 推腿 → 最后一腿确认：82 借 301 / 贷 50·公司钱包（法币 = 结算户，加密币 = from）+ 83 借 1·客户钱包 / 贷 2·客户钱包 → SUCCESS。短缺户回零，客户应付全程未动。

**与对账的接口**：记短缺那笔是客户现金户上的一条 OUT 流水（sourceType `INTERNAL_TRANSFER`），靠 §4.5 第 0 轮与锚配对后案子自愈（账龄路：锚 = 金额不对那条内部行 + 外部行；事故路：锚 = 幽灵转出那条外部行）；补款到账那笔走 Pass 1（模拟托管方照 2026-09-05 裁定在腿提交时写外部行）。对内差额：记短缺后 现金 + 短缺 = 应付 + 暂扣 仍成立。

**处置记录**：`ReconciliationDisposition` 加 `transferNo String?`；**不加 `DispositionKind`、不改写 outlet**（裁定 19）；行「已锁定」的判定从「有 `adjustmentNo`」扩为「有 `adjustmentNo` 或 `transferNo`」；Status 标签按单状态：`Pending CFO · ITR…` → `Shortfall recognised · topping up ITR…` → `Explained · ITR…`；腿失败：`Shortfall recognised · top-up failed ITR…`（不回入口，裁定 15）。

**事故路**：`IncidentDetailPage` 的补款入口（`:328-332, 650`）改为跳案件页并自动开「Recognize loss & top up」弹层（金额锁定为定损额，`lossSource='INCIDENT'`）；事故 Remediation 挂载一条 `TRANSFER`（认损补缺单号）即可满足「善后已挂」，不再要求先挂 ADJUSTMENT（`incident.service.ts:489-527` 存在性校验照旧查 `internalTransfer`）。

**客户侧**：零行。`INTERNAL_TRANSFER_COMPENSATION_IN` 从 `customer-statement.service.ts:181-185` 白名单删，`customer-statement.service.spec.ts:178-194` 认损那条「Balance adjustment」用例改为「认损补缺不出现在客户对账单」。`client:snapshot` 对该客户改前后对照：改前两行（−7.5 / +7.5）、改后零行——这是**预期差异**，证据目录记清。

### 4.2 公司调拨单（HouseTransfer）

**表 `house_transfers`**：`id`、`transferNo`（前缀 `HTR`，`@unique`）、`purpose`（本波只有 `'FEE_SWEEP'`，字符串列不做枚举约束）、`assetId`、`amount Decimal`（元）、`fromWalletId`、`toWalletId`、`reason`、`status`、`approvalNo?`、`fundsOrderNo?`（唯一一条腿）、`closeTbTransferIds String?`（90 的回执，JSON 数组，可能两笔）、`failureReasonCode?`（`INSUFFICIENT_FIRM_BALANCE | LEG_FAILED | POSTING_FAILED`）、`failureNote?`、`executedAt?`、`settledAt?`、`traceId`、`createdByUserId`、时间戳；`FundsOrder.houseTransferId String?` 父键（照 `internalTransferId :1103` 同款，Cascade）。

**状态机**：抄划转单六态六边原样（`PENDING_APPROVAL → EXECUTING | FAILED | REJECTED | CANCELLED`，`EXECUTING → SUCCESS | FAILED`），显式迁移表 `house-transfer-transitions.constant.ts`。

**建单**（金库）：DTO `{purpose, assetId, amount, fromWalletId, toWalletId, reason}`。守卫：from ≠ to；两只都是 PLATFORM 钱包、network = 该资产网络、`vaultCode ∈ {F_OPS, F_FEE}`；from 余额 ≥ 金额（§5.4 共用闸）；from.vaultCode = F_OPS 时过 NLA 算术门（`orderKind: 'HOUSE_TRANSFER'`）。表单：用途下拉（只 Fee sweep）、币种、from / to 下拉（该币种的运营户与手续费户，各带余额）、金额（选了 from 后**默认填 from 的全额**，可改小）、理由。

**审批**：新类型 `HOUSE_TRANSFER_APPROVAL`，金库提 / CFO 单步 / 48h / 可撤（照 `INTERNAL_TRANSFER_APPROVAL` 同参）。四处同加：`approval.constants.ts` 三处（类型、策略行、V1 白名单）、`verify-rbac.ts` `MAKER_GROUP_BY_POLICY`（提单组 `FUNDING_WRITE`）、`verify-rbac.tables.ts` S9（裁决人持 `FUNDING_READ`）、`approvalEntityRoutes.ts`、`ApprovalPoliciesPage.tsx` 标签。

**执行**：APPROVED → from 余额复查 → EXECUTING → 建一条腿（from → to，资金单 `sourceType 'HOUSE_TRANSFER'`；模拟托管方在腿提交时写两侧外部行，照划转腿先例）→ 金库 ⚡ Submit / Settle → 腿确认：89，再（仅 F_FEE → F_OPS）90 → 资金单 CLEAR → SUCCESS。腿 FAILED/TIMEOUT → FAILED(`LEG_FAILED`)。

**审计七码**（新名册 `CAMPAIGN_E_HOUSE_TRANSFER_AUDIT_ACTIONS`，`audit-vocabulary-closure.spec.ts:52-71` 名册清单 18 → 19）：`HOUSE_TRANSFER_REQUESTED / CANCELLED / REJECTED / EXECUTION_STARTED / LEG_POSTED / SETTLED / FAILED`，四属性照 V7 同名码抄；`actionDomain 'TREASURY'`，`AuditEntityTypes` 加 `HOUSE_TRANSFER`，`AuditBusinessWorkflowTypes` 加 `HOUSE_TRANSFER`。

**权限**：不开新组，复用 `FUNDING_READ / FUNDING_WRITE`（与注资单、付款单同组）；`rbac.catalog.ts` `route()` 登记 `POST /admin/house-transfers`、`POST /admin/house-transfers/:transferNo/cancel`（WRITE）、`GET /admin/house-transfers`、`GET /admin/house-transfers/:transferNo`（READ）；动作桶照 `treasury.view_*/act_*` 命名各加一个；前端 `permissions.ts` 加四个常量。

**管理台**：Treasury 导航组（与 Vendor Payments 同组）两页：`HouseTransferList`（含建单弹层）、`HouseTransferDetail`（路线 `fromWalletNo → toWalletNo`、状态、审批号、腿、分录两行：挪钱 89 与结转 90 各一行、撤回）。

### 4.3 付款单 from 可选

- DTO `InitiateVendorPaymentDto` 加 `fromWalletId`（必填）；守卫同 §4.2（PLATFORM、同网络、`vaultCode ∈ {F_OPS, F_FEE}`）；余额闸改查该钱包（§5.4）；**NLA 门只在 from.vaultCode = F_OPS 时调**（手续费户出钱运营户不动）。
- 分录 87 形状不变（贷方本来就是 `resolveCashAccountId(row.fromWalletId)`），从手续费户付时**不结转**（裁定 5）。
- 审批快照加 `fromWalletNo`；表单（`VendorPaymentList.tsx:160-172` 币种下拉之后）加 from 下拉，默认运营户，带余额；详情页显示 from 钱包号。

### 4.4 应收 LP

- 开户见 §3.1；服务 `LpReceivableAccountService`（lp-desk 内，各管各的：LP 主体自己的开户责任）。
- `lp-exchange-workflow.service.ts`：`onSellLegConfirmed` 在 84 之后加 88（金额 = 买入合同数，买入币 ledger，借 51·该 LP / 贷 200）；`postBuyLeg` 的贷方从 `equityAccount` 改为 51·该 LP（`resolveTbAccountId({code: 51, ledger, ownerType: 'LP', ownerUuid: row.lpId})`）；86 不动。
- LP 不交货：应收挂着不动（真实应收），本波无新结局；兑换单既有状态机不加边。
- 看板：`CompanyFundsDashboard.tsx` 新格「Due from LP — Pending Delivery」，读 `GET /admin/tb/accounts?ownerType=LP&code=51&take=100`，每行 LP 名 × 币种 × 余额，空时「No LP delivery outstanding.」；端点对 ownerType LP 返回 `ownerName`（LP 名称）照 CUSTOMER 的 `ownerName` 同款（`tb-account-registry.service.ts:135`）。
- 种子：LP 历史兑换单（`seed.business.ts:2802-2821`）三腿改四腿：84 → 88 → 85（贷 51）→ 86，期末 51 余额 0；账本科目页因此多 4 户（Falcon / Dune × AED / USDT）。

### 4.5 对账引擎

**对内差额**（只对 `walletKind === 'CUSTOMER'`）：
- `WalletBalanceCheckerService.checkBalance` 扩为同时算四个户在截止点的 posted 流水和（同一个 `effectiveCutoffFilter`）：现金（1·钱包）、短缺待补（2·钱包）、应付（100·该客户·该 ledger）、暂扣（101·该客户·该 ledger）；`internalDelta = (cash + shortfall) − (payable + suspense)`，公司钱包为 `null`。四个户都经 `AccountingService.resolveCashAccountId`（1）/ `resolveTbAccountId`（2、100、101）取，读端自建的 `resolveCashAccount:69-97` 删（裁定 11）。
- 落库：`ReconciliationRunWallet.internalDeltaAmount Decimal?`、`ReconciliationCase.internalDeltaAmount Decimal?`（分，签名）。
- 分桶 `bucket-classifier.ts` 加第 0 条：`internalDelta ≠ 0 → BREAK`。差异行写一条 `matchStatus 'INVARIANT'`（`internalAmount` = internalDelta，`internalDirection` 按符号，外部侧空）；该行**没有 Resolve 菜单**，Status 标签「Books out of balance · needs correction」；它不参与锚配对、不被解释；下一轮算到 0 才随钱包一起自愈（`autoHealCases` 口径不变：钱包不在 breaking 集合即愈）。
- 修法不在本波：对内不平只能由技术更正分录（不是业务处置）归零，`PRODUCTION-NOTES.md` 追加一行后放下。
- 验证用的「造不平」只在 e2e 里做，且必须**同本跨客户**（裁定 18，跨本会先撞预门 `computeInternalIdentity` 整轮 INTERNAL_BREAK）：直接 `AccountingService.executeTransfer` 记一笔借 1·A 钱包 / 贷 100·B 客户，跑批 → A、B 两张 INVARIANT 案；反向记回 → 跑批 → 两案自愈。

**第 0 轮锚配对**（裁定 8）：
- 匹配器输入加 `explainedAnchors: Array<{ flowId: string; anchorFlowId?: string; anchorExternalLineId?: string; byNo: string }>`，由 `ExplainedDifferenceService.indexForWallet` 改供（来源：该钱包 POSTED 调账单的落账流水 + `recognizedTbTransferId` 已落的认损补缺单的记短缺流水；改记单两侧钱包都认，照 `:59-66` 注释）。
- Pass 0（在 Pass 1 之前）：有 `anchorExternalLineId` 的 → 组 = {该调账流水} ∪ {anchorFlow（若有）}，与那条外部行比：签名和相等 → 一条 MATCHED（`resolution` 记 `byNo`），不等 → AMOUNT_MISMATCH 照旧；只有 `anchorFlowId` 的 → 组 = {anchorFlow} ∪ {该调账流水}，净额为 0 → 组内消化（MATCHED，内部对内部），净额 ≠ 0 → 以净额、净方向、anchorFlow 的 externalRef 作为一条合成内部行进 Pass 1 / 2。**两锚皆空的调账流水不参与匹配、只进余额**（裁定 16，取数条件从「sourceType ≠ RECON_ADJUSTMENT」收窄为「非（调账流水 ∧ 两锚皆空）」）。
- 退役与改口：`wallet-flow-matcher.service.ts:158-176` 与 `flow-comparison.builder.ts:96-101` 的过滤按上一条收窄；`scripts/recon-demo.ts:457-463` 的模拟对账单取数**保留并加排除码 91 的记短缺流水**（裁定 22）；`run.service:392-398` 用已解释索引抑制 `anomalyCount` 的逻辑删（Pass 0 已把它们配成 MATCHED）；`:878-887` 写 `EXPLAINED` 状态的逻辑改为：Pass 0 配成的 MATCHED 行 `resolution = byNo`；读面「Explained · ADJ… / ITR…」标签与行锁定判断改读 `resolution` 与处置记录的 `adjustmentNo / transferNo`，`reconciliation.dto.ts:160-173`「MATCHED 行不挂注解」为 `explainedBy` 开一个口子。
- 投影器 `account-flow-projector.service.ts:150-153` 打 `walletRef` 的判据改为 `ownerType === 'WALLET' && isCashCode(code)`（裁定 21），码 2 流水不带 walletRef。
- 改记四腿（场景 8）：Jack 钱包 {幽灵 IN 流水, 改记 OUT 流水} 净 0 → 消化；Kate 钱包 改记 IN 流水 ↔ 锚外部行 → MATCHED；一次重对账两案齐愈不变（`recon-reattribution.e2e-spec.ts:442` 断言不变）。

**天平**：`computeInternalIdentity` 与 `verify-realtime-coa.ts` 按 §3.1 加 2、51。

**读面**：案件页 Balance Explained Internal 格下副行（客户案）：`Cash <x> + Shortfall <y> ｜ Payable <p> + Held <q> ｜ Δ <internalDelta>`，Δ ≠ 0 红；跑批详情钱包表加列「Internal check」（✓ / Δ）；案件列表不动。

## §5 跨单据共用件

- **5.1 解析器合一**：读端删 `resolveCashAccount` 自查注册表；`walletKind / coaCode / ownerNo` 由 `wallet` 行 + `cashAccountCodeFor` 给。
- **5.2 from 钱包守卫**：`FirmWalletPicker.assertEligible(walletId, assetId)`（funds-layer，与 `SystemWalletResolver` 同处）：PLATFORM、network 匹配、`vaultCode ∈ {F_OPS, F_FEE}`；付款单、调拨单、认损补缺单三处同调。
- **5.3 from 钱包下拉数据**：`GET /admin/tb/accounts?ownerType=WALLET&code=50&assetCurrency=<ccy>` 已能给 `walletRole / walletNo / balance`，前端过滤 `walletRole ∈ {F_OPS, F_FEE}`，不加端点。
- **5.4 余额闸**：划转单 `assertFirmOpsBalance`（`internal-transfer.service.ts:77-94`）与付款单 `assertFirmOpsBalance`（`vendor-payment.service.ts:99-118`）两份收成一个 `assertWalletBalance(walletId, amountMinor)`（放 accounting，读该钱包现金户 posted − pending credits），三张单（划转 / 付款 / 调拨）同调；注资单无闸照旧。
- **5.5 NLA 门**：`assertPostOutflowCompliant` 的 `orderKind` 联合类型加 `'HOUSE_TRANSFER'`；调用规则见裁定 12。

## §6 权限、审计、审批（预期终态数量——改完必须对上，纪律 5）

| 项 | 波前 | 本波 | 终态 |
|---|---|---|---|
| 审批策略（`DEFAULT_APPROVAL_POLICIES`） | 55 | +1 `HOUSE_TRANSFER_APPROVAL` | **56** |
| `MAKER_GROUP_BY_POLICY` / 豁免 | 54 / 1 | +1 | 55 / 1（S8 恒等 56 = 55 + 1） |
| S9 表 = 路由表 | 45 | +1 | 46（键集相等 spec 自证） |
| 审计现役码 | 378 | +1 V7（`INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED`）+7 新名册 | **386**；名册 18 → 19；`internal-transfer-audit-codes.spec.ts` 键集 7 → 8 |
| 权限组 | — | 不加（复用 FUNDING_* / INTERNAL_TRANSFER_*） | 不变 |
| 动作桶 | — | +2（调拨单 view / act） | 执行时记前后数 |
| 转账码 | 1–87 | +4（88–91） | 最大 91 |
| 科目码 | 11 | +2 | **13**；`tb-account-codes.constant.spec.ts` 五处断言随改 |
| 演示库科目数（demo:all 后） | 87 | +14 客户钱包码 2 +4 LP 码 51 | **105**（执行时核） |
| 业务号前缀 | 不记数 | +1 `HTR` | `rg "generateReferenceNo\('HTR'"` 恰 1 处 |
| 投影器 walletRef 判据 | `ownerType === 'WALLET'` | 加 `isCashCode(code)` | 码 2 流水零 walletRef（`account_flows` 按码 2 查 `walletRef IS NULL` 全命中） |
| 退役 | — | `CLIENT_COMPENSATION` 用途名、`/compensation` 端点、`COMPENSATION` nextStep、`UNEXPLAINED_CLIENT_LOSS` 成因、`sourceAdjustmentNo` 列、读端解析器、三处 sourceType 过滤、两份余额闸 | 四件套各走一遍（常量 / 守卫 / 前端入口 / 测试） |

## §7 种子、剧本、基线

- **种子**：客户钱包开 1 + 2（14 个客户钱包 → 14 个码 2 户，Henry 两条钱包行在内）；Falcon、Dune 各开 51 × 2；LP 历史兑换单四腿（§4.4）；**不**种子化调拨单 / 认损补缺单（今天也没有）。`demo:all` 不动；`recon:demo` 场景 16 铺场不动（仍是 Alice USDT 外部行少 7.5），文件头注释 ⑯ 改「认损补缺一张单」，答案键不动（无处置家族字段）。
- **剧本 `script.md`**：场景 16（`:230`）按 §4.1 重写（一张单、一次批、客户端零行、Alice 余额全程不动）；场景 18（`:232`）与第 31 场（`:565-612`）事故路按 §4.1 事故段重写，**第 31 场在认损补缺之前加一拍「CFO 拒掉 #18 那笔 250,000 AED 待批提现」**（裁定 14：钱包挂着出款锁定时记不了短缺），**删掉「Bob 负可用窗口」剧本纪律（`:597`）**——甲案下窗口不存在；第 32 场引用处（`:618-659`）改单号称呼；第 26 场 LP 一步加一句「CFO 批后看板 Due from LP 显示 13,600 USDT，验收后归零」；公司的钱那一幕末尾新增**场景 41「扫费」**（金库开调拨单 手续费户 → 运营户 整扫 → CFO 批 → ⚡ 腿 → 账本凭证页看 89 + 90 两笔、收入户归零、公司权益增加）；场景 10 不动。`:230 / :232` 里「Balance correction · Client loss recognition」这句本就与代码不符，随重写消失。
- **`data.md:350`** 三句改一句；**`baseline.md`**：`:432` 审计码 360 → 386（顺带纠正已过时的 360）；`:484` 审批 55 → 56；`:534-545` 科目数 87 → 105；`:538` 对账 21 钱包 / 18 场景 / 12 案不变；`modules/v7-treasury.md §2` 用途与分录句、`company-funds.md §2` 加调拨单状态机与看板新格、`lp-desk.md §2.3` 加应收、`v8-recon.md §1/§5` 对内差额与第 0 轮、`accounting-coa.md §2` 天平——**本波只改事实句，整篇重写留波三**（总纲 §6 第 2 条）。
- **TOOLING-DEBT / PRODUCTION-NOTES**：对内不平无业务修法（PRODUCTION-NOTES 一行）；e2e 冷缓存协议与私库种子停点照波一承接。

## §8 验收口径（本波收尾一次过；失败名集合协议照波一）

1. 随手闸 ①②③ 零输出；本波相关 jest 全绿；`client-web` 零改动则 `test:client` 免。
2. 重铺闸 ⑧：`stack.sh reset self` → `demo:all` 花名册 35/35、asserts 5/5 → `verify:coa` 新天平全过、105 户全 ≥ 0 → `recon:demo:pass` 21 钱包 0 案 → `recon:demo:break` 18/18、12/12、12/12 → `verify:coa` 再过。
3. **认损补缺 e2e**（改写 `recon-internal-transfer.e2e-spec.ts` A / C1 / C2 / P2 与 `incident-register.e2e-spec.ts` 用例 5、`recon-aging-write-off` 反例③）：账龄路与事故路各一条全弧：开单（断言提交即挂、行锁定）→ CFO 批 → 断言码 91 借 2 / 贷 1、生效日 = 案件业务日、应付不动、审计码 → 按案件业务日重对账案愈（第 0 轮配对，原行 MATCHED、resolution = ITR 号）→ ⚡ 推腿 → 82 + 83（贷 2）→ 短缺户 0、现金户复位 → 客户对账单该客户零新行。另两条：钱包挂着待批提现锁定时开单被拒并指路（裁定 14）；C2 腿失败 → 单 FAILED、入口不回来、短缺户不归零（裁定 15）。
4. **扫费 e2e**（新 `house-transfer.e2e-spec.ts`）：先往手续费户铺一笔没收（贷 212）再 F_FEE → F_OPS 整扫 → CFO 批 → ⚡ 腿 → 89 + 三笔 90（eventCode 各异）、210/211/212 归零、200 增 Σ收入、`verify:coa` 过；「扫一半」一笔断言按 210 → 211 顺序只扣到够；手续费户里有一截非收入的钱（先 F_OPS → F_FEE 调一笔）再整扫，断言结转封顶在 Σ(210..212)、90 不被拒；F_OPS → F_FEE 一笔断言不结转且 NLA 门被调用（spy，放行不写审计）。
5. **付款单 from = F_FEE e2e**（新 `vendor-payment-from-wallet.e2e-spec.ts`，付款单今天没有 e2e）：87 贷手续费户现金、无 90、NLA 门未调（spy）；from = F_OPS 一笔断言 NLA 门被调用。
6. **应收 LP**（改 `lp-exchange-workflow.service.spec.ts:328-383` 单测 + 新 `lp-receivable.e2e-spec.ts`，夹具直造 ACTIVE LP + 打款地址并调 `ensureForLp`，裁定 20）：批准后 51·Falcon USDT = 13,600、200 USDT +13,600、200 AED −50,000；交货后 51 = 0、F_LIQ +13,600；看板端点返回该行。
7. **对内差额 e2e**：§4.5 同本跨客户造不平 → A、B 两张 BREAK 案各带 INVARIANT 行与 `internalDeltaAmount`（+X / −X）；反向记回 → 两案自愈。
8. **第 0 轮**：`recon-reattribution:442` 两案齐愈不变；场景 16 认损后原「金额不对」行变 MATCHED（resolution = ITR 号）；`recon:demo:break` 18/18 不变。
9. 读面截图：案件页（副行 + 新菜单项 + 锁定标签三态）、跑批详情新列、看板新格、调拨单列表 / 建单 / 详情、付款单 from 下拉、事故页改后入口、账本科目页 Owner=LP 过滤、凭证页 89 / 90 / 91 三码。
10. 计数终态（§6 表）逐项实跑核对；e2e 全量冷缓存失败名 ⊆ 波一基线 ∪ 已登记连带。

## §9 交付清单触发项（plan 写死）

任何持久状态变化写审计（新码 8 个四属性冻结）｜ 新状态机（调拨单）显式迁移表 ｜ 动了钱（同步直调 `AccountingService`，失败即流程失败）｜ maker-checker 走 `ApprovalsService` 正门 ｜ 新审批策略四处同加 ｜ 新 admin 端点 `route()` 登记 + `db:base:sync` + 重启 ｜ 新业务动作前端有入口、退役动作前端入口同步删 ｜ 改 schema 新迁移无 backfill ｜ 改页面与种子同步 `demo/data.md`、`demo/script.md` ｜ 改前端 preview 截图 ｜ 多波之一：承接写进波三骨架 ｜ 收尾 CHANGELOG 一行 + BACKLOG 销账（:188）+ `CLAUDE.md §9` 报告。

## §10 波三承接（收尾时按 delivery-checklist 填进 `2026-11-06-campaign-e-wave3-skeleton.md`）

收官要落的 `decisions.md` 条目（本波只记不写）：COA v3（总纲 §6 第 3 条既有）｜ 托管短缺待补甲案 + 认损补缺一张单（翻 2026-09-05 :61）｜ 公司调拨单（翻 2026-09-05 :59，用途是标签、from/to 限运营户与手续费户）｜ 付款单 from 可选 ｜ 扫费同额结转（含「收入户余额 = 未扫的费」的代价）｜ 对内差额开案 / 结案口径 ｜ 匹配器第 0 轮锚配对取代 sourceType 排除 ｜ NLA 仍只算运营户（BACKLOG）。

## §11 留给执行者

- 调拨单的腿怎么被 ⚡ 推：照付款单腿（`vendor-payment-workflow.service.ts:178-190` 建腿 + 资金单页 Submit / Settle）而不是划转腿；`push-order.service.ts loadPushable` 对新父键照 2026-09-21 甲案「显式拒」加一条。
- 第 0 轮的合成内部行（净额 ≠ 0 的 anchorFlow 组）只在金额更正场景出现；实现时以 `recon:demo:break` 18/18 与 `recon-adjustment-money-arcs` 11 例为回归闸。
- `resolveRoute` 的 from 改读单上的 `fromWalletId` 后，`CLIENT_ADVANCE` 路（置灰但代码在）仍固定 F_OPS——建单时写死，不开放选择。
- NLA 门的 `PrudentialOrderKind` 加 `'HOUSE_TRANSFER'` 后，`prudential.service.ts:43-47` 的对手方主体与单据标签要给它一个分支：调拨单没有外部对手方，审计里对手方子主体写 to 钱包（`WALLET` 实体）或不写，执行者定、评审认。
- 动作桶命名照既有 `treasury.view_transfers`（`rbac.catalog.ts:1087`）/ `treasury.act_client_funding`（`:1093`）的样式：`treasury.view_house_transfers` / `treasury.act_house_transfers`。
- 码 2 户名与码 51 户名的字面由执行者按 `cashAccountName` 模式定，业主核科目页截图时一并核。
- 所有数量以执行时实跑为准，§6 表的「终态」列是预期，对不上就停。
