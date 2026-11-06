# 战役戊 · 波一 spec —— 账本地基 + 等价接线

> 总纲：`2026-11-06-campaign-e-ledger-by-location-charter.md` §3 波一行 ｜ 科目表 = 总纲附录 A ｜ 记账总表 = 总纲附录 B「波一」列（本文不重抄分录）
> 收尾对照 `rules/delivery-checklist.md`；评审按 `rules/review-rubric.md`。本波**动钱 + 动 COA + 动对账引擎，评审升档**（总纲 §7 点名）。
> 一句话定位：**今天能演的一切，在新账本上照常演。** 不加功能、不改流程、不改页面布局；改的只有「记到哪个户」和「对账引擎读哪些行」。

## §0 脑暴裁定台账（2026-11-05～06，业主已拍板；细节见总纲 §2）

| # | 岔口 | 裁定 | 对本波的含义 |
|---|---|---|---|
| 1 | 资产按位置开户 | 是 | 码 1 / 50 从「每币种合计户」变「每钱包一户」，归属 WALLET |
| 2 | 本钱放哪 | 留在公司权益（码 200），不设实收资本 | 注资贷 200；公司权益不会负，由现金闸保住 |
| 3 | 法币粒度 | 每 vIBAN 一户（Zand 可查子账户余额） | 客户现金户数 = 客户钱包数，法币链上同构 |
| 4 | 入账追回链 | 整条挂起 | 码 21、81–83 垫款路径接线到新户**但保持 UI 置灰**，不演、不测新行为 |
| 5 | 等价迁移 | 行为不变 | 认损、补款、LP 三腿、对账余额口径全按今天形状接到新户；新能力一律波二 |
| 6 | 常量改名 | **甲套，业主 2026-11-06 拍板** | CLIENT_ASSET→CLIENT_CASH、FIRM_ASSET→FIRM_CASH、FIRM_OPS→FIRM_EQUITY，码不变；库里存的助记码字面、`COA_PHRASE` 键、凭证 debit/credit 码全换新名；走最低档机械替换，改前后 grep 清点 |
| 7 | Henry 无钱包 | **铺两条钱包行，业主 2026-11-06 拍板** | 他的账单腿才有现金户可记；连带：受检钱包 19→21、baseline 数字改、`verify:demo-data` R5 要他的钱包带 DEMO_SEED 审计行、客户端快速登录点充值会拿到种子地址 |
| 8 | 改记连现金户 | 一张凭证四腿（总纲 §4 岔口 6，业主 2026-11-06 认可） | `resolveReattributionLegs` 加两条现金腿；场景 8 两案同愈不变；`test/recon-reattribution.e2e-spec.ts:699-713` 断言不改、剧本 `script.md:222` 措辞改 |
| 9 | 公司池核销多钱方向 | 贷 212 其他收入（总纲 §4 岔口 7，我定） | `adjustment-rules.ts:55` 两方向都保留 |

## §1 本波做 / 不做

**做**：科目码表与名称 ｜ 注册表 WALLET 归属 + 开户标志位 ｜ 开户责任拆分（上币开类户 / 钱包建行开现金户）｜ 投影方向按类别 ｜ 钱包标签与 R2 守卫退役、跨外部标记退役 ｜ 七单 + 调账单今天有的形状全部接到新户 ｜ 对账引擎最小适配让现有对账全绿 ｜ 种子、铺场脚本、模拟回单 ｜ `verify:coa` 新公式 ｜ 测试与基线 ｜ 波二骨架的「承接波一」

**不做**（对照项目总纲 §2 与战役总纲 §5）：托管短缺待补（码 2）、应收 LP（码 51）、应付供应商（150）——本波不进常量表、不开户 ｜ 公司钱包间调拨 ｜ 对内差额 ｜ 案件页 / 跑批页任何布局改动（只换科目名字面）｜ 公司侧余额闸、NLA、看板、账本列表页改动（波三；本波只保证它们**读得到数**，见 §6.5）｜ 文档整篇重写（波三；本波只改 `baseline.md` 判据与 `data.md` 钱包表）｜ 幂等 / 并发 / 兼容层 / backfill

## §2 科目、注册表、标志位

### 2.1 码表终盘（`constants/tb-account-codes.constant.ts`）

- **本波常量表 = 附录 A 中「开户时机」为「钱包建行 / 上币 / 不变」的码**：1、50、100、101、200、210、211、212、300、301、302（11 码）。2 / 51 / 150 **不进常量表**（附录 A 只预留号；谁用谁加，纪律 12）。
- 退役 201 FIRM_SET、203 FIRM_LIQ：从主表删除，加入退役名黑名单断言（与 FIRM_FEE / FIRM_SEIZED 同列）。钱包 F_SET / F_LIQ 不动，它们的钱以后住在 50 类现金户里。
- 助记码：`A.CLIENT_CASH` / `A.FIRM_CASH` / `L.CLIENT_PAYABLE` / `L.DEPOSIT_SUSPENSE` / `E.FIRM_EQUITY` / `E.INCOME_*` / **`X.EXPENSE_*`**（开支新前缀 X）。若裁定 6 定「不改名」，助记码仍保留旧字面，但 §2.2 的名称必须改——名字不能再叫「资产合计」「运营户」。
- `isAssetCode` 改为 `isDebitNormalCode`，集合 = {1, 50, 300, 301, 302}；**全部**「类别感知」计算改用它，清单（改前再 grep 一次核数，纪律 5）：`tb-account-registry.service.ts:14`、`tb-admin.controller.ts:66`、`tb-evidence.service.ts:423,585`、**`tb-evidence.service.ts:62`（现用 `coaCode.startsWith('A.')`，开支 `X.` 前缀会算反）**、`wallet-recon-run.service.ts:662`（直接用 `ASSET_TB_CODES`）、`scripts/verify-realtime-coa.ts:6`（自带一份资产码集合）、`scripts/backfill-account-flow-balance.ts:17`。
- `TB_ACCOUNT_NAMES`：码 1 / 50 的名字是**类名**（Client Cash / Company Cash）；现金户的**户名**在开户时拼好写进注册表 `description`（模式见附录 A：`类名 · 钱包名`），读面对 ownerType = WALLET 的户显示 `description`，其余户照今天 `accountNameOf(code)`。前端不得再造映射（2026-08-13 业主规则不变）。

### 2.2 注册表（`tb-account-registry.service.ts` / `TbAccountRegistry`）

- ownerType 新增 `WALLET`（现有 SYSTEM / CUSTOMER / LP 不动）；现金户四元组 = (1|50, ledger, 'WALLET', wallet.id)，`ownerNo` = `walletNo`，`description` = 户名。schema 无改动（三列都是 String）。
- `AccountingService` 新增一个解析入口（名字执行者定，下称 `resolveCashAccountId(walletId, ledger)`）：按 `wallets.ownerType`（CUSTOMER → 1，PLATFORM → 50）落四元组。**所有记账调用点取现金户只走这一个入口**，不得各自拼四元组。
- **标志位**：开户按类别写——借方户（1 / 50 / 300–302）`credits_must_not_exceed_debits`，贷方户（100 / 101 / 200 / 210–212）`debits_must_not_exceed_credits`。执行者先核 `accounting.service.ts:44,106` 现状（讨论会话读到默认 0），核实 tigerbeetle-node 的 `AccountFlags` 常量名后落；演示库整库重铺，不需要给已有户改标志。**失效验证**：在测试里对一个贷方户做超额借记，TB 必须拒绝（纪律 2）。

### 2.3 开户责任

| 谁 | 开什么 | 在哪 |
|---|---|---|
| 上币（`asset-provisioning.service.ts:8-15`） | 该币种的 200、210、211、212、300、301、302 | 现有列表改：去掉 1 / 50 / 201 / 203，加 300–302 |
| 钱包建行成功（ACTIVE） | 该钱包的现金户（1 或 50，ledger 按钱包所在网络对应的资产） | 三个建行路径汇到一个开户函数：`wallets.service.ts`、`deposit-transactions.service.ts` 的运行时建行；`prisma/seed.business.ts` 的平台 7 槽位；`demo:setup` 的客户钱包种子（`scripts/demo-lib.ts`） |
| 客户入驻激活（`onboarding-workflow.service.ts:67`） | 100 / 101（每客户每币种） | 不变 |

- 钱包没到 ACTIVE 没有现金户，`resolveCashAccountId` 找不到即抛——记账失败 = 流程失败（铁律⑤），不另加守卫。
- 网络 → ledger：TRON → USDT(2)，AED_ZAND → AED(1)。今天一网络一资产，直接按 `assets.manifest` 查；不预做多资产。

## §3 投影与标签（`projector/account-flow-projector.service.ts`）

- **方向按类别**：借方户上的借方行 = `IN`、贷方行 = `OUT`；贷方户维持今天（贷 = IN、借 = OUT）。类别从凭证自带的助记码（`debitCode` / `creditCode` 的前缀）判，不查注册表。**含义统一为「钱进这个户 = IN」**。
- `walletRef`：列保留当索引；写入值改为派生——该行账户若 ownerType = WALLET 则填其 `ownerUuid`，否则 `null`。凭证参数里的 `debitWalletRef` / `creditWalletRef` 删除，所有调用方的「算钱包标签」代码随之删（最大一块是 `swap-leg-accounting.ts` 的 `walletRefForCode` / `resolveLegWalletRefs`；充值 / 提现 workflow 里为了贴标签去解析 F_FEE 钱包的代码改为解析现金户）。
- `isExternalCrossing`：凭证参数删除、投影不再写、`account_flows` 列删除（迁移文件照常新增，无 backfill）。
- R2 守卫（`assertWalletRefMatchesTbAccount`）整段删；`scripts/verify-demo-data.ts` 的 R2 规则随之删，R1 保留。
- `balanceAfter` 逻辑不变，只换判类函数。

## §4 七单 + 调账单接线（分录以总纲附录 B「波一」列为准）

| 单 | 改哪里 | 改法要点 |
|---|---|---|
| 充值 | `trading/deposit-transactions/deposit-workflow.service.ts`、`funds-orders/disposition.service.ts`（没收 / 退回 / 上缴三弧） | 码 1–9 / 20 的「CLIENT_ASSET」侧换成该充值落地钱包的现金户；码 4 的「FIRM_ASSET」侧换成 F_FEE 现金户；码 21 同法接线但 UI 维持置灰 |
| 提现 | `trading/withdraw-transactions/withdraw-workflow.service.ts` | 码 10–17 同法；码 16 的 FIRM_ASSET 侧换 F_FEE 现金户 |
| 兑换 | `funds-layer/constants/swap-leg-plan.constant.ts`（表）、`swap-leg-accounting.ts`（解析） | 表里 debit/credit 码换成新码；`resolveAcct` 对 1 / 50 走 `resolveCashAccountId(按腿的 fromRole/toRole 解析出的钱包)`；FIRM_SET / FIRM_LIQ 码的腿（32 / 33 / 37）两侧都变成现金户之间的挪动；`walletRefForCode` 删除 |
| 内部划转 | `asset-treasury/internal-transfers/internal-transfer-workflow.service.ts` | 81 = 公司现金·结算 ← 公司现金·运营；82 补款 = 借 301 对账核销损失 ／ 贷 公司现金·结算（加密币贷 公司现金·运营）；83 = 借 客户现金·X ／ 贷 应付·X。垫款路径同法接线、维持置灰 |
| LP 兑换 | `asset-treasury/lp-desk/lp-exchange-workflow.service.ts` | 84 = 借 公司权益 ／ 贷 公司现金·运营；85 = 借 公司现金·LP 前厅 ／ 贷 公司权益（**波一形状，无应收**）；86 = 借 公司现金·运营 ／ 贷 公司现金·LP 前厅 |
| 注资 | `asset-treasury/company-funding/capital-injection-workflow.service.ts` | 70 = 借 公司现金·运营 ／ 贷 公司权益 |
| 支出 | `asset-treasury/company-funding/vendor-payment-workflow.service.ts` | 87 = 借 300 银行与托管费用 ／ 贷 公司现金·运营 |
| 调账单 | `clearing-settle/reconciliation/disposition/adjustment-rules.ts → resolvePostingLegs`、`adjustment.service.ts` | 签名改为「按案子的钱包 + 处置家族 + 方向」：现金腿 = 案子钱包的现金户；对手腿：客户池 → 应付·该客户；公司池 CORRECT / REVERSE → 公司权益；RECORD 出账 → 300；RECORD 进账 → 212；WRITE_OFF 公司池少钱 → 301、多钱 → 212（裁定 9）；UNEXPLAINED_CLIENT_LOSS → 应付·该客户（波一形状）；**改记四腿**（裁定 8：`resolveReattributionLegs` 加 借 客户现金·正主 ／ 贷 客户现金·错记方）。凭证不再带 walletRef / isExternalCrossing |
| 种子与脚本 | `prisma/seed.business.ts`（注资 70、LP 历史 84–86、HexTrust 付款 87、**Henry 账单腿 `seedStatementHistoryLegs` 约 3518-3770 行**）、`scripts/demo-lib.ts`（demo:all 造数）、`scripts/recon-demo.ts:1112-1152`（重复入账场景直记） | 全部改走新户；Henry 按裁定 7 |

- 转账码**一个不改号**，注释改写分录（纪律：u16 一经分配不可改）。
- 每个调用点改完，**在 `tb_transfer_evidence` 里按码抽一条核**：借贷助记码是不是附录 B 写的那两个（纪律 1：证据在断言的位置取）。
- 「改了交易三域任一 → 问另外两个域一不一样」：充值 / 提现 / 兑换三处换户的写法要一致（同一个解析入口）。

## §5 对账引擎最小适配（让现有对账在新账本上全绿；语义改动留波二）

- **余额检查器**（`engine/v2/wallet-balance-checker.service.ts`）：内部余额 = 该钱包现金户上 POSTED、≤ cutoff 的行按方向加总（IN 加、OUT 减）；`walletKind` 按码（1 客户、50 公司）；`coaCode` = 现金户助记码；`internal.payable / suspense / firmEquity` 三个拆分字段删除（波二的对内差额另起）。两个码集常量删除。
- **匹配器**（`engine/v2/wallet-flow-matcher.service.ts`）：纳入 = 现金户上的行，**排除 `sourceType = 'RECON_ADJUSTMENT'`**（调账行只进余额不进匹配，等价于今天靠标记排除的效果；是否改成「挂到所平外部行」留波二岔口）。三轮匹配不动。
- **预门**（`workflow/wallet-recon-run.service.ts → computeInternalIdentity`）：公式换附录 A 两条天平；INTERNAL_BREAK 语义不变。
- **跑批**：`wallet-recon-run.service.ts:782-788` 映射表删除；快照行 `coaCode` 存现金户助记码、`book` 按码；未归属外部余额（walletRef 空 → BREAK）保留。
- **外部数据**：`external_balances.coaCode` / `reconciliation_cases.coaCode` 写新助记码；admin-web `COA_PHRASE` 词表换键（`A.CLIENT_CASH` → 「Client cash」等），页面布局零改动。
- **铺场与模拟回单**：`scripts/recon-demo.ts` 从现金户的行重铸外部账单（排除调账行），场景注入改记到现金户，公司池落点挑公司现金户；`simulation/simulated-custodian-statement.service.ts` 同法。**18 个场景、成因码、预期桶一个不改。**
- **案件页流水对照**（`domain/flow-comparison.builder.ts:86-88`）：今天也按 `isExternalCrossing` 过滤，改为同样排除 `sourceType = 'RECON_ADJUSTMENT'`，否则调账行会显示成「只有内部」的孤儿。
- **铺场脚本的 LP 前厅排除**（`scripts/recon-demo.ts:926`）：今天靠 `coaCode !== 'E.FIRM_LIQ'` 把前厅钱包排除出场景 10；改后所有公司钱包的助记码相同，这道排除会悄悄失效——改按钱包角色 `F_LIQ` 排除。
- 处置读面（`domain/reconciliation-query.service.ts`）：`book` 从案子取不变；`internalDirection` 读现金户行——投影已按类别翻，「IN = 钱进这个钱包」与今天负债户上的含义一致，`rowDirection` / `causesFor` / `dispositionsFor` **零改动**。

## §6 校验、测试、基线、读面保活

1. `scripts/verify-realtime-coa.ts`：两恒等换附录 A 公式；负余额遍历用 `isDebitNormalCode`；四元组唯一含 WALLET。**失效验证**：手工往一个客户现金户记一笔无对手的借方，恒等必须红（纪律 2）。
2. 测试：`tb-account-codes.constant.spec.ts`（整表 `toEqual` 换 11 码 + 退役名黑名单加 201 / 203）；投影 spec 加「借方户借方行 = IN」；注册表 spec 加 WALLET 四元组；`swap-leg-plan` 相关 spec；`verify-demo-data.ts` R2 删；对账引擎三件 spec 按 §5 改；module-parity。
3. 端到端：对账六支、money-arcs（8 支断言了旧助记码的 e2e 随改，改过的测试证明不了「没动」）。**客户侧「一行没动」的证据另立一个任务**：开工前在 main 上 `reset` + `demo:all`，对全部种子客户采一份对照——客户端余额、客户流水、月结单、资产组合四个接口的输出，去掉 id 与时间戳落成文件；波一收尾在新账本上同样重铺、同样采样，逐字 diff 必须为空。对照组先采（纪律：对照组必最先采）。
4. `demo/baseline.md`：期望余额按现金户改写（F_OPS AED 947,500 / USDT 113,600 / F_LIQ 0 等原判据搬到「公司现金 · 运营 AED」等户名下；增加公司权益两户的期望值）；`demo/data.md` 平台钱包表加「现金户」列；`demo/script.md` 账本视角步骤只换科目名。
5. **读面保活**（波三才改逻辑，本波只保证不炸、数对）：余额闸三处 `lp-exchange.service.ts:96` / `internal-transfer.service.ts:79` / `vendor-payment.service.ts:101` + `prudential.service.ts:98`、公司资金看板、账本三列表——凡读 FIRM_OPS 余额当「运营户现金」的，本波改读「公司现金 · 运营」现金户（否则读到公司权益、数字不对），**且公式从贷方口径（贷 − 借 − 借挂起）翻成借方口径**；凡读 FIRM_SET / FIRM_LIQ 的改读对应现金户。这是等价迁移的一部分，不是波三的功能改动。

## §7 验收口径（本波收尾一次过）

1. 随手闸 ①②③④ 全绿；jest 跑 accounting / clearing-settle / trading / asset-treasury / funds-* 五目录。
2. `stack.sh reset self` 从零重铺 → `on-stack.sh self demo:all` 全绿 → `verify:coa` 全绿 → `recon:demo:pass` 绿 → `recon:demo:break` 18/18 场景、12/12 案子。
3. 客户侧 e2e 全绿；对账六支 e2e 基线不劣于今天（7 红基线：5 协议未签 / 1 时区 / 1 money-arcs 用例 9，见记忆与 BACKLOG）。
4. 管理台走查截图：账本三列表（科目页能看到 7 个公司现金户 + 客户现金户、名字按模式）、对账跑批详情、一张客户案 + 一张公司案、公司资金看板（数字与科目页同源）。
5. 抽核：每个转账码在 `tb_transfer_evidence` 取一条，借贷助记码与附录 B 一致（附在 plan 收尾报告里，列码 → 凭证号 → 两侧助记码）。

## §8 本波不做（再列一遍，防顺手）

托管短缺待补 ｜ 应收 LP ｜ 公司钱包间调拨 ｜ 对内差额 ｜ 处置链接匹配 ｜ 案件页 / 跑批页布局 ｜ 公司侧闸门与看板逻辑 ｜ 文档整篇重写 ｜ decisions（波三统一落）｜ 追回链任何新行为 ｜ 兼容层、backfill、幂等、并发

## §9 交付清单触发项（plan 写死）

- 动了钱 → `verify:coa` 每任务必跑；记账同步直调不挂事件（本波不改这条，只换户）。
- 改 schema → 迁移文件（删 `account_flows.isExternalCrossing`），无 backfill；改完 reset 重铺。
- 改页面 / 种子 → `data.md`、`script.md`、`baseline.md` 同步（§6.4）。
- 改了前端（`COA_PHRASE` 词表、科目名显示）→ 截图。
- 多波中的一波 → 承接写进 `2026-11-06-campaign-e-wave2-skeleton.md` 开头，不展开波二。
- 每轮收尾 → CHANGELOG 一行；文档分层报告。
- 评审升档（opus）；常量改名机械替换走最低档，改前后 grep 清点数量对账（纪律 5）。

## §10 留给执行者的

开户函数的名字与归属模块 ｜ `resolveCashAccountId` 的签名细节 ｜ 迁移文件顺序 ｜ 户名拼接的字面（附录 A 模式内）｜ 网络 → 资产 → ledger 的查法 ｜ 测试文件的拆分 ｜ 七单接线的任务切分（建议按单切，兑换单独一任务）
