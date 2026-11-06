# 戊波二 · 新账本才有的能力 · 骨架

> 总纲：`2026-11-06-campaign-e-ledger-by-location-charter.md` §3 波二「新账本才有的能力」；波一 spec：`2026-11-06-campaign-e-wave1-ledger-foundation-spec.md`
> 本文件只是**骨架**——链总纲 + 承接波一 + 已定事实 + 待定岔口，**不展开波二 spec**（项目总纲 §6：展开是波二新会话读总纲 + 本骨架后跟业主脑暴的活，波一收尾会话不代做）。

## 承接波一（波一收尾任务填写）

- 合并基线：**波一未合并**（收尾会话不合）。分支 `claude/campaign-e-wave1-4a558e`（worktree `.claude/worktrees/campaign-e-wave1-4a558e`），任务 12 终点 `a35a04f1`，其上两个收尾提交（Sumsub 两支 e2e 夹具对齐 `84970d02` + 收尾 docs）；基点 `0cef9af5`（= 波一开工时 main），共 23 个提交。合并时要做：快进 → build → `stack.sh reset main`（schema 动过：新迁移删 `account_flows.isExternalCrossing`、凭证表 `debitWalletRef / creditWalletRef` 两列 + 2 索引）→ 重启后端 + `db:base:sync`。验证物证见 `checkups/2026-11-06-campaign-e-wave1-evidence/README.md`（客户侧 diff 为空、转账码抽核表、e2e 前后对照、截图）。
- 实际交付（含全部订正）：
  - **科目与开户**：码表 v3 十一码 + 类别函数（`isDebitNormalCode` / `accountFlagsFor` / `cashAccountName`）；注册表 `WALLET` 归属 + 唯一四元组；标志位按类别（借方户贷不得超借、贷方户借不得超贷）；**取现金户只经 `AccountingService.resolveCashAccountId(walletId, ledger, tx?)`**；开户 `WalletCashAccountService.ensureForWallet`。订正：开户**挪到「开客户收款地址」流程**（`CustomerDepositWalletService.createOrReturn` 在 →ACTIVE 之后），不放 `WalletsService`——铁律③压过 spec §2.3 的文件位置（R11）；归属→科目码 / 网络→ledger 各收成单一 helper（R12）。
  - **七单 + 调账单接线**（码一个没改号）：兑换四腿含反向（30–38，T4）、充值五条弧（1–9 / 20，T5）、提现（10–17，T6）、划转 / LP / 注资 / 支出（70 / 81–87，T7）。订正：POST 行**保留 `eventCode` / `memo`**，不只传 `externalRef`——onBounce / onReturnAfterSuccess / 付款核对都按 `WITHDRAW_*_POST` 反查凭证（R21）；提现锁定（10 / 13）建单时就经 `resolveCustomer` 解出源钱包（R22）；e2e 夹具改走真实充值形状预充（R15）。
  - **调账单（80，T9）**：按「处置家族 × 方向」落现金户；**改记 = 一张凭证两笔码 80、四条腿**（应付对 + 现金对），现金对用新 eventCode `RECON_ADJUSTMENT_POSTED_CASH`（否则 TB 凭证号哈希相撞）；调账单详情页多一行现金对 + 十六进制凭证链接（R24，spec 未列的一行前端改动）；认损 / 核销文案订正（R25）。
  - **读面保活（T8）**：余额闸三处 + NLA（审慎）+ 公司资金看板改读现金户，公式翻成借方口径。
  - **投影（T10）**：方向**按「本行自己的科目类别」逐行定**（借方户的借方行 = IN；贷方户的贷方行 = IN）——这是 spec §3 的原意，plan 接口一行写的「只看 debitCode」是错的（R27）；钱包标签由现金户归属派生；**跨外部标记整体退役**：`account_flows.isExternalCrossing` + 凭证表两列钱包标签 + 2 索引，同一个新迁移里删（R28）；回填脚本按新方向重写。
  - **对账（T11）**：余额检查器单一查找现金户；匹配器 / 案件流水对照按现金户取行（只取 POSTED，R30）；预门恒等换新天平；`recon:demo` 铺场与模拟回单随之，18 场景 / 12 桶 / 12 案不变；对账六支 e2e 随新账本对齐（分 T11a 引擎 / T11b 夹具两半，R29）；**`provisionTbAccounts` 分批 100/批**——现金户一钱包一户，注册表一涨 TB 单批拒收 ≥254 个（R31，波一自己造成的工具缺口）。
  - **收尾（T12）**：201 / 203 退役（常量 / 词表 / 种子 / 脚本一律清，R5）；账本三列表户名取注册表 description（现金户按模式命名）；`baseline.md` / `data.md` / `script.md` 关键行数字、`v8-recon.md` 两处事实订正（整篇重写留波三）。
  - **证据（T0 / T13）**：`client:snapshot` 客户侧对照（改前改后逐字相同）；`verify:coa` 失效验证；转账码抽核表直接向 TigerBeetle 取实记 `code` / 借贷科目码，不信 evidence 自述。
- 偏差：
  - plan T7 / T9 要求自己名下的 e2e 转绿，但引擎未迁前对账步骤不可能绿 → **绿的义务挪给 T11 / T13**（R20 / R23）。
  - T4–T7 plan 写「可并行」，实际串行（SDD 不许同树并行实现，R2）。
  - R27、R21、R11 三处是对 plan / spec 字面的**订正**（见上），其余按 spec 走。
  - 超出 spec 字面但随波必需：删凭证表孤儿列（R28）、详情页现金对（R24）、开户分批（R31）。
  - 收尾时 e2e 多出 22 例非基线红 → R33：补两支 Sumsub 夹具（见悬挂项）、工具债入 `TOOLING-DEBT.md`，重跑全量到「基线 20 名 + 2 连带名」才收（R19 / R33）。
  - 分支 / worktree 名按实际而非 plan 里的（R1）；对照组 e2e 基线在隔离 worktree 的 `0cef9af5` 上采（`e2e-baseline-0cef9af5.md`，冷缓存才可比，R19）。
- 悬挂项：
  - **业主裁定挂起、波一没动**：码 21（入账后被银行追回）UI 置灰、无 live 行；垫款腿（81–83 的垫款路径）保持「垫款记 `X.EXPENSE_RECON_LOSS`、应收垫款挂起」，`INTERNAL_TRANSFER_ADVANCE_IN` 事件只有单测覆盖。
  - **两个钱包→现金户解析器**：写端（ledger 由调用方币种定）与读端（ledger 由钱包 network 定），一资产一网络时等价；波二若出现同币多网络（或新增码 2 / 51 按钱包 / LP 开户）要先合一。
  - **PRODUCTION-NOTES 本波追加 2 行**（2026-11-06，已放下不修）：开客户收款地址时钱包 ACTIVE 先于现金户、开户失败无补偿；改记的两笔码 80 非原子。
  - **e2e 基线债原样带着**（红名单 20 例，非本波引入）：13 例 `AGREEMENT_NOT_ACCEPTED`（recon-supplement ②③ + 拒绝路径 / recon-internal-transfer B / incident-register / swap-sumsub 7 / customer-restrictions ⑥）、recon-aging slaDeadline 时区、recon-adjustment 用例 9、swap-money-arc 用例 2 陈旧断言、customer-restrictions ②、demo-roster 3 例顺序超时。**波一收尾最终全量（冷缓存串行）= `9 failed / 18 passed / 27 套`、`22 failed / 153 passed / 175 例` = 基线 20 名一名不少 + 2 例 demo-roster 连带**（账本不得透支后，充值没落地 → 后面提现锁定被拒；干净重铺单跑 5/5，已登记 `TOOLING-DEBT.md`）。波二跑 e2e 要冷缓存（`--cacheDirectory=<新目录>`），否则 demo-roster 先跑把 `demo_frank` 冻住、withdraw-money-arcs 连带红。`deposit-money-arcs` 用例 1 偶发红（状态翻了才写审计，测试读早了；顺序基点即如此）也在 `TOOLING-DEBT.md`。
  - **私库种子停点前移（波一造成，已登记 `TOOLING-DEBT.md`）**：7 个私有 e2e 库的 `db:biz:init` 一直 exit 1（既有债），改前停在末尾 `seedStatementHistoryLegs`，现在停在 `seedCapitalInjection`（TB `exists_with_different_debit_account_id`：注资借方换成各库自己钱包的现金户、账户 id 因库而异，转账号却由 (sourceType, sourceNo, eventCode) 确定性生成、各库共用一个 TB 集群）。后果：私库里不铺 LP 台 / 合作方证据 / 公司资金 / Henry 月结单历史腿 / Grace DSR 单；**目前没有私库套件因此红**。波二若要给私库种子 LP 台 / 应收 LP 之类，得先定私库隔离方案（独占 TB 或种子遇 37/38/46 视为已有）。
  - **夹具要跟账本走（波一收尾补了两支）**：`withdraw-sumsub-scenarios`（`fundCustomer` 直接 `executeTransfer` 暂扣→应付）与 `deposit-sumsub-verdicts`（`prisma.wallet.create` 不开现金户；直接造 `COMPLIANCE_PENDING` 单、跳过 `detected()` 不记 Step 1）已对齐——真实充值形状（码 1 借客户钱包现金户 / 贷暂扣，再码 2）+ `WalletCashAccountService.ensureForWallet`。波二新增账户码 2 / 51 与转账码 88+ 的 e2e 夹具同理：暂扣户、短缺待补户、应收 LP 户都是不得透支的类，夹具先按真实形状进钱。
  - **终审分诊项（逐任务评审遗留，未清；按名字找，行号已漂）**：`prisma/seed.business.ts` 的 `findWalletCashAccount` 手搭 (code, ledger, 'WALLET', walletId) 元组（GC 说取户只经 `resolveCashAccountId` / 开户返回值）；Henry 钱包形状在 `scripts/demo-lib.ts` 与种子各一份；`withdraw-workflow.service.ts#sourceWalletId` 的 null 守卫（不可达状态，违禁做清单「边界防御」，评审建议删）；`scripts/verify-act1.ts` 的 B6 钱包没开现金户（`prisma.wallet.create` 绕过开户）；`deposit-transactions.service.ts#createRandom` 死码（只提不删，R10）；`tb-account-codes.constant.spec.ts` 的 `REGISTRATION_SOURCES` 源码文本扫描断言（既有，违 rubric #3，已被行为断言覆盖）；`system-wallet-resolver.service.ts#resolveCustomer` 的报错文本带客户 UUID。
  - **读面文案小尾巴**：`script.md:607 / :652` 旁白残留旧数字；`baseline.md:244`「逐位吻合」与「两项权益新增」自相矛盾；`AccountFlowList` 户名放开后整表横向滚动、TYPE 列在视口外；调账单详情页改记行 Direction 仍显示 REDUCE、无 to-wallet 字段（波前既有）。
  - **对波二的前提影响**：`RECON_ADJUSTMENT_SOURCE_TYPE` 住在 `adjustment-rules.ts`（岔口 3 调账行匹配要改它）；改记四腿结案要两钱包同归零；码 2 / 51 / 150 仍**不在**码表与 `isDebitNormalCode` 集合里（开工核对项第一条）；`on-stack.sh` 栈脚本波一零改动。

## 已定事实（总纲 §2 已拍板，波二可直接假设成立）

- **托管短缺待补走甲案**：客户本资产户，码 2，按钱包开，只在短缺期间有余额；客户余额全程不动；认损补缺仍等账龄到线三天。分录见总纲附录 B 内部转账表「波二」行。
- **应收 LP 交货**：码 51，占用注册表 `ownerType='LP'` 插座，每 LP 每币种，LP 档案 ACTIVE 时开；按合同数记在买入币种；到货多于合同不做。分录见附录 B LP 表「波二」行。
- **公司钱包间调拨**：内部划转单第三条路（公司 → 公司），新转账码从 88 起；**扫费必须同额结转**（借 收入 ／ 贷 公司权益），理由见总纲 §4 岔口 5；需要审批策略与审计码（审批类型三处同加）。
- **对内差额不单独开案**：并进该钱包的案子作第二个差额；跑批快照行与案件主体各加一列。
- **调账行与匹配**：波一按 `sourceType` 把调账行排除出匹配；是否改成「挂到所平外部行」见岔口 3。
- 波一已把方向按类别投影：现金户上 IN = 钱进这个钱包；读面不必再翻。

## 待定岔口（波二 spec 脑暴先决）

1. **对内差额的开案 / 结案口径**：对外差额 0、对内差额 ≠ 0 的钱包，开案还是只在跑批页标信号？结案是否要求对内归零？
2. **认损补缺是一张单还是两张**：今天认损（调账单）与补款（划转单）是两张单两次 CFO 批；甲案下「记短缺」与「公司补进」是否合成一张单一次批？倾向合一（客户没错、公司补，是一个决定）。
3. **调账行匹配规则**：维持按 `sourceType` 排除，还是做「原分录 + 更正分录合起来对一行」的分组匹配？前者零改动、后者更像真系统。
4. **扫费的触发与粒度**：手动开单（金库发起、CFO 批）还是按月定时？演示倾向手动一张单。
5. **LP 悬空期看板**：应收 LP 要不要在公司资金看板上单独一格？
6. **案件页 Balance Explained**：对内差额是加第六格，还是 Internal 格下加副行「应付 + 暂扣」？

## spec 开工核对项

- 新码 2 / 51 加入常量表时同步整表 `toEqual` 断言与 `isDebitNormalCode` 集合（两个都是借方户）。
- 新转账码从 88 起一次列全（扫费至少两枚：现金挪动 + 收入结转），u16 一经分配不可改。
- 新审批类型：`MAKER_GROUP_BY_POLICY` 加行、白名单表、审计码四属性冻结（delivery-checklist 三行）。
- 动钱动状态机，评审升档。
- 场景 16 剧本步骤随新流程改写；`recon:demo` 场景 16 的答案键处置家族随之改。
