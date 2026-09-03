# V3 财务配置治愈 · 波一「结构与退役」设计稿

> 2026-09-03 ｜ 底料：`doc-final/superpowers/checkups/2026-09-03-v3-five-modules.md`（五块 4×9 体检）｜ 决定：`decisions.md` 2026-09-03 四条 ｜ 本文按总纲 §6「多波只写细当前波」写：§0 是两波总纲，§1 起只写波一；波二开工前由波一收尾在其 spec 开头写「承接上一波」并展开。

## 0. 总纲（两波）

**目标**：第一幕后半三站（站 2 费率、站 4 资产、站 5 限额 / 钱包 / 地址）所用的五块配置，在**正确的数据结构**上演得出来、留得下痕、判得住。正确 = 地址属于链不属于币、钱包行是地址不是资产账户、账本按资产、管理台只有真能演的动作。

**拆两波**（边界 = 改的是"数据是什么"还是"行为对不对"）：

| 波 | 做什么 | 出口（验收口径） |
|---|---|---|
| **波一 · 结构与退役**（本篇） | 网络注册表；资产 / 钱包 / 提现地址 / 限额 / 费率五张表收正、状态集与迁移表；退役新资产上线整条路、平台钱包增删改、限额新建、退役角色与死路由；客户充值地址按网络的唯一写路径；入金信号改钥匙；地址簿增删改查；费率退役动作与 VIP 种子；职务 / 策略 / 权限随之改；种子写身世；文档与剧本重写 | 重铺后 `demo:all`、三域 e2e、`recon:demo` 双态、`verify:rbac` / `verify:act1` / `verify:coa` 全绿；站 2 / 4 / 5 在新结构上真机走通并截图 |
| **波二 · 行为与判据** | 法一补全（被拦下留痕、客户动作 actor、requestId 17 处、落地行 from/to）；治疗单（按钮权限门控、倒计时走秒、客户端提现页假规则文案、`/dashboard` 旧树、死 import）；`verify:act1` 扩 V3 行为判据；站 2 / 4 / 5 定稿；「合并进 main 必重启 + sync」入章程 | 第七幕能拉出第一幕后半每个动作的证据；判据网对 V3 全绿 |

波二的 spec 由波一收尾时展开，开头写承接记录（实际偏差 / 新事实 / 前提变化），不留在本篇。

**本波做**：上表波一那一格。**本波不做**（对照总纲 §2）：幂等 / 去重 / 重试回放 / 补偿 / 并发锁 / 兼容层与 backfill（schema 与状态值直接按终态改，`reset` 重铺）/ 输入防御校验 / 性能 / 管理 API 加固；另两条业务上明确延后——**新资产上线整条流程**（建资产、上架 workflow、激活与就绪检查、上币包装载工具）与**平台钱包的任何增删改**，将来要上币再做，本波只把它们的遗留清干净。

## 1. 业主已拍板（不翻案）

1. 资产模型**网络优先**：网络是一等实体；资产 = 币种 × 网络 × 合约地址；充值地址与提现地址簿按客户 × 网络；钱包行 = 一个地址；账本科目按资产（`decisions.md` 2026-09-03）。
2. 上币走开发流程，运营只暂停 / 恢复；种子随版本上架并写发布标记审计。**本波不做新资产上线**——资产只有 AED 与 USDT-TRON。
3. 定价不建管理面；报价归交易域，本波不动。
4. 暂停 / 恢复的提单人 = **运营**（OPS_OFFICER），裁决人仍 CISO。
5. 四处读法已确认：提现地址"改" = 标签与收款人可改、地址本身不可改；费率"删" = 退役等级（进终态，不物理删）；限额"按资产" = 规则从种子铺好、只改金额；种子发布标记保留在本波。
6. HexTrust 现实是设计锚：vault 是用途容器，地址按链（同 family 可能共用）、每 vault 每链一个；托管方按 `chainID_ticker` 维护支持列表，我们的资产码 = 币种 + 链，合约地址必须与其一致。

## 2. 网络注册表

代码配置，不建表、不做管理面：`src/config/manifests/networks.manifest.ts`，字段对齐 HexTrust 链字段：

| 字段 | 含义 | TRON | AED_ZAND |
|---|---|---|---|
| `code` | 我方网络码，资产 / 钱包 / 地址的 `network` 列只许取此值 | `TRON` | `AED_ZAND` |
| `kind` | `CHAIN` / `BANK_RAIL` | CHAIN | BANK_RAIL |
| `chainId` / `chainName` / `family` | HexTrust `chainID` / `chainName` / `family`（银行通道 family=`BANK`） | 按 HexTrust 列表填，沙盒阶段允许占位 | — / Zand / BANK |
| `custodian` | `HEXTRUST` / `ZAND` | HEXTRUST | ZAND |
| `addressPattern` | 登记校验正则（取代 `address-validator.util.ts` 里按资产网络字符串挑正则） | `^T[1-9A-HJ-NP-Za-km-z]{33}$` | IBAN `^AE\d{21}$` |
| `minConfirmations` | 入金确认数（HexTrust `minBlockConfirmation`） | 19 | 0 |
| `explorerUrl` | 详情页链接前缀 | tronscan | — |

服务层统一 `assertNetwork(code)`；`Asset.network`、`Wallet.network`、`WithdrawalAddress.network` 三列写入前都过它。

## 3. 资产

**表（`Asset`）终态**：`assetNo`（改非空）、`code`、`currency`、`network`、`type`（CRYPTO / FIAT）、`decimals`、`description`、`contractAddress`（原生币与法币为空）、`isNative`、`standard`（`TRC-20` / 空）、`minConfirmations`、`custodianAssetKey`（HexTrust `assetKey`，法币为空，沙盒占位）、`status`、`tbLedgerId`、`approvalCaseNo`（待批的暂停 / 恢复单）、`suspendedAt`、`suspendReason`、时间戳。**删**：`minDepositAmount / maxDepositAmount / minWithdrawAmount / maxWithdrawAmount`（体检 A15，全仓零读取）、`depositEnabled / withdrawalEnabled / preSuspendDepositEnabled / preSuspendWithdrawalEnabled`（暂停就是总开关）、`approvalCaseId`。种子来源仍是 `src/config/manifests/assets.manifest.ts`，两条按上表补齐字段（USDT-TRON 的合约地址填 TRC-20 USDT 真实合约）。

**状态机**（`asset-transitions.constant.ts` 改成两边）：`ACTIVE --SUSPEND--> SUSPENDED --REACTIVATE--> ACTIVE`。`PROVISIONING` 与 `ACTIVATE` 删。暂停对交易面的效果沿用现状：三域建单前的资产状态门只认 ACTIVE，不新加逻辑。

**动作与审批**：保留 `POST /admin/assets/:assetNo/suspend`、`/reactivate`（提单人运营，见 §8），策略 `ASSET_SUSPENSION` / `ASSET_REACTIVATION`（CISO 单步、12h）不动。`GET /assets/:id` 参数改名 `:assetNo`、服务里双查改单查。

**退役**（代码 + 路由 + 权限 + 审计码 + 页面一次拔干净，退役前逐键 `git grep` 现场核）：`asset-listing-workflow.service` / `asset-listing.controller` / `submit-asset-listing.dto` / `update-asset.dto`；`asset-activation-workflow.service`（含 `checkReadiness`）/ `asset-activation-approval.service` / `ASSET_ACTIVATION` 策略；`POST /admin/assets/listing`、`PATCH /admin/assets/:assetNo`、`POST …/activate` 三条路由；管理台 `AssetCreate.tsx` / `AssetEdit.tsx`、活树与 `/dashboard` 旧树的对应路由、`ASSETS_CREATE` 权限码、列表页「New Asset」按钮、详情页 Edit / Activate 按钮；审计码 `ASSET_CREATED_AND_PROVISIONED / ASSET_CREATION_FAILED / ASSET_PROVISIONING_UPDATED / ASSET_ACTIVATION_REQUESTED / ASSET_ACTIVATED / ASSET_ACTIVATION_FAILED` 进拒写名册。`asset-provisioning.service`（同事务开 TB 系统科目）**保留**，改为只被种子调用——"先有账后有货"仍成立，只是发生在装载时。

**页面**：列表无新建；详情 Hero 补网络 / 合约地址 / 代币标准 / 确认数 / 托管方资产键；动作只剩 Suspend / Reactivate；有待批单时显示待批徽章 + 审批单号（读 `approvalCaseNo`）。

## 4. 钱包（地址行）

**vault 注册表**：`src/config/manifests/vaults.manifest.ts`，五个：`F_OPS`（运营）、`F_SET`（结算，仅法币通道）、`F_FEE`（手续费）、`F_LIQ`（流动性）、`CLIENT_DEPOSIT`（客户充值池）。代码配置，不建表。

**表（`Wallet`）终态 = 一个地址一行**：`walletNo`（改非空）、`ownerType`（PLATFORM / CUSTOMER）、`ownerNo`（客户号；平台行填 `PLATFORM`，列非空以便唯一键生效）、`vaultCode`、`walletRole`（平台行 = vaultCode；客户行 `C_DEP` 链上 / `C_VIBAN` 法币通道）、`network`、`address`（链上）、`iban`（法币通道）、`custodianRef`（托管方返回的钱包 id，取代 `vaultId`）、`status`、时间戳。唯一键 `(vaultCode, network, ownerNo)`。**删**：`assetId`（及 `asset` 关系）、`mockBalance`、`type`、`accountName`、`bankName`。状态集 `CREATING → ACTIVE`、`CREATING → FAILED`（托管方开地址失败），迁移表留在 `wallets.service.ts`；`DISABLED` / `FROZEN` 删——客户侧要停入金靠 V2 限制账（"限制是人的属性"），平台侧从不停。

**平台侧全部来自种子、管理台只读**：4 个 vault × 2 个网络去掉 F_SET 的 TRON = **7 行**（与今天 7 个平台钱包一一对应，只是钥匙从资产换成网络）。管理台托管钱包页：列表按 vault 分组，列 = 钱包号 / 网络 / 地址或 IBAN / 归属人 / 状态；详情去掉 mock 余额节、"Deposit Collection" 节、Disable 按钮，加网络与托管方引用；余额一律引导去账本页。

**唯一保留的写路径——客户充值地址**（`customer-deposit-wallet.service.ts` 改签名 `createOrReturn(customerNo, network)`）：客户在充值页选资产 → 前端取该资产的 `network` → `POST /client/deposit-wallets { network }` → 找（CLIENT_DEPOSIT, network, customerNo）的行，没有就经 mock 托管方开一条（链上给地址、银行通道给虚拟 IBAN），role 按网络 kind 定；同网络第二次直接复用。审计 `CUSTOMER_DEPOSIT_ADDRESS_CREATED`（新码，actor=客户）。

**入金信号改钥匙**（V4 触点）：`POST /deposit-transactions/my/inbound-signals` 的 DTO 去掉 `walletId`，改为 `network` + `toAddress`（或 `iban`）+ `contractAddress`（原生币 / 法币为空）+ `amount` + `txHash` + `fromAddress`；后端按（network, toAddress/iban）找钱包行得客户，按（network, contractAddress）找资产得 `assetId`，再走今天的充值流程。合约对不上任何资产的信号**拒收并留痕**（V4 合同新码 `DEPOSIT_SIGNAL_REJECTED`，correlationMode NONE，reasonCode `UNKNOWN_ASSET`）——合约地址防诈骗落在这里。⚡ 模拟面板与 `demo-lib.ts` 造数同步改传参。

**提现付款腿**（V5 触点）：`system-wallet.util.ts` 的解析从"按资产找 F_* 钱包"改为"按（资产的 network, vaultCode）找地址行"，`withdraw-workflow.service.ts` 六处调用跟改；资金单 from/to 仍指钱包行 id，资产在单上。对账引擎不动（它认账本科目与币种，钱包只是引用）。

**退役**：`custodian-wallet-create-workflow.service` / `custodian-wallet-create-approval.service` / `custodian-wallet-create.controller`、`CUSTODIAN_WALLET_CREATE` 策略、`POST /admin/custodian-wallets`、`/retry`、`PATCH /wallets/:walletNo/status`、`GET /wallets/:walletNo/balance`、`WalletBalanceService`（+spec）、`CustodianWalletCreateModal.tsx`、`WALLET_WRITE` 权限组（及桶、绑定、前端常量）、角色 `C_MAIN / C_OUT / C_CMA` 与状态 `FROZEN / DISABLED` 的全部残留（`wallet.dto.ts` 枚举、`wallet-role-policies.constant.ts`、`system-wallet.util.ts` 的 `CUSTOMER_POOL_ROLES / PLATFORM_POOL_ROLES / classifyWalletSurface`、`walletRole.util.tsx`、列表筛选项）、审计码 `CUSTODIAN_WALLET_CREATE_* / CUSTODIAN_WALLET_CREATED / WALLET_STATUS_UPDATED` 进拒写名册。`treasury/customer-portfolio.*` 仍有客户端消费方，保留。

## 5. 提现地址簿

**表（`WithdrawalAddress`）**：删 `assetId`（及关系）；`network` 成为归属键；唯一键改 `(customerId, network, address)`；索引 `(customerId, network, status)`；其余列保留。

**增删改查**：
- 增：客户登记链上地址——选**网络**（不再选资产）、地址、标签、收款人、备注；银行账户不变。规则不变：法币前置门、24h 冷却、首个法币账户即时生效、每网络最多 3 条。
- 改：`PATCH /client/withdrawal-addresses/:addressNo` 只收 `label` / `beneficiaryName`；地址 / IBAN 不可改（改地址 = 新登记，冷却闸才有意义）。
- 删：冷却期内取消（`DELETE` 已有，客户端补入口——待激活卡片加 "Cancel registration"）；自助停用（现有，两道守卫不变）。
- 查：客户端按网络分组；管理台列表补 `DEACTIVATED` 筛选；详情把 Skip Cooling 挪进「Manual Simulation」区并标 ⚡。
- 管理员：暂停 / **恢复**（新增 `POST …/:addressNo/unsuspend`，补 D5 的出边）/ 跳过冷却。
- 新端点（客户端 `PATCH`、管理端 `unsuspend`）照既有方式在 `rbac.catalog.ts` 登记；管理端的挂 `WITHDRAWAL_ADDRESS_WRITE`。

**状态机**（新建 `withdrawal-address-transitions.constant.ts`，`withdrawal-address.service.ts` 五处直写全经它）：
`PENDING_ACTIVATION --ACTIVATE--> ACTIVE`（冷却到期扫描 / 懒激活 / 后门）｜`PENDING_ACTIVATION --CANCEL--> CANCELLED`｜`ACTIVE --SUSPEND--> SUSPENDED --UNSUSPEND--> ACTIVE`｜`ACTIVE --DEACTIVATE--> DEACTIVATED`。CANCELLED / DEACTIVATED 终态；非法跃迁 409。

**审计**：现有 `WITHDRAWAL_ADDRESS_*` 码保留，新增 `WITHDRAWAL_ADDRESS_UPDATED`（改标签）与 `WITHDRAWAL_ADDRESS_UNSUSPENDED`；两码出生即定四属性。被守卫拦下留痕、客户动作 actor 改 CUSTOMER 属波二法一，本波不做。

**提现建单**（V5 触点）：地址下拉改为"该资产 network 下 ACTIVE 的地址"，手输路径不变。

## 6. 限额

**规则从种子来、只改不建不删**：15 条（单笔按资产 × 三操作 6、累计按档位 × 操作 × 周期 8、大额提现 1）由 `seedTransactionLimitRules()` 铺好；运营改金额走现有变更流（运营提、高管批、落地前 before-vs-current 冲突守卫）。

**表（`TransactionLimitRule`）**：`ruleNo`、`gateType`、`operationType`、`assetId`、`tradingTier`、`period`、`minAmount / maxAmount / defaultLimit / threshold`、`approvalCaseNo`（待批变更单；非空即"变更中"）、时间戳。**删**：`status`（规则无生命周期，恒生效）、`cap`（自陈占位）、`approvalCaseId`。

**退役**：`POST /admin/transaction-limit-rules`、`initiateCreate / onCreationDecided`、`TransactionLimitCreationApprovalService`、`TRANSACTION_LIMIT_CREATION` 策略、`createPending / activate / deletePending`、四个 `TRANSACTION_LIMIT_CREATION_*` 审计码进拒写名册、`validateShape` 里只服务创建的分支。保留 `TRANSACTION_LIMIT_REJECTED` 门拦截审计与 L1 引擎（充值下限拦截不经 gate 留痕属波二）。

**页面**：列表 TYPE 下拉不变（剧本措辞改"按类型筛选"）；详情变更弹窗去掉 `cap`；有待批变更时显示待批徽章 + 审批单号。

## 7. 费率（两族，增删改查）

**等级状态集**（两族同一张迁移表常量）：`PENDING_APPROVAL --APPROVE--> ACTIVE`｜`PENDING_APPROVAL --DECLINE--> REJECTED`｜`PENDING_APPROVAL --CANCEL/EXPIRE--> CANCELLED`｜`ACTIVE --RETIRE--> RETIRED`。创建被拒**不再物理删行**（`deleteRejectedLevel` 退役，改写 REJECTED），列表筛选里的 REJECTED 从此是真的。**删** `FAILED` 状态（落地失败是故障路径：只留 `*_APPLY_FAILED` 审计，行停在 PENDING_APPROVAL，不做 repair——总纲 §2）与 `enabled` 列（状态是唯一真相；报价只匹配 ACTIVE）。

**变更请求单**：状态 `PENDING_APPROVAL → APPROVED | REJECTED | CANCELLED | EXPIRED`（EXPIRED 单独终态）；单号改走 `generateReferenceNo`，前缀 `SFC`（兑换）/ `WFC`（提现），废 `SFLC-###` 顺序号；审计 `primarySubjectNo` 一律 `levelCode`，变更单号进子表 INSTRUMENT。

**新增"退役等级"**：`POST /admin/{swap,withdrawal}-fee-levels/:levelCode/retire`，CFO 提（`*_FEE_LEVEL_WRITE`）、运营批，策略 `SWAP_FEE_LEVEL_RETIRE` / `WITHDRAWAL_FEE_LEVEL_RETIRE`（单步 OPS_OFFICER、48h，与创建 / 变更同一对）；守卫：该币对 / 资产最后一个 ACTIVE 默认档不可退役；审计 `*_FEE_LEVEL_RETIRE_REQUESTED / RETIRED / RETIRE_CANCELLED`（两族六码，四属性齐）。

**种子加受众档**：`VIP-USDT-AED`（兑换，requiredTags `['VIP']`，各档比 STD 便宜）；Grace（PREMIUM 档位派生 VIP 标签）命中它、Alice 命中默认档——站 2 从此能演"够格的档里选最便宜"。受众校验单标签限制保持。

**两族同构**：change-approval / change-workflow / creation-approval 已零差异；withdrawal 强制至少一个 feeItem、swap 允许纯点差档这一处差异**保留并写进 v3 §5**；quote 服务与端点属交易域，本波不动。

**页面**：状态筛选 `PENDING_APPROVAL / ACTIVE / REJECTED / CANCELLED / RETIRED`；侧栏 Audience / Valid Window 值改英文；详情加 Retire 按钮（CFO 可见）；有待批创建 / 变更 / 退役单时显示待批徽章 + 审批单号。

## 8. 治理面

**职务与权限**：`ASSET_CONFIG_WRITE` 持有人 TECH_OFFICER → **OPS_OFFICER**，桶 `treasury.manage_assets` 改名"Suspend / reactivate assets"；技术官只剩 IAM 那摊（站 0 / 站 1 不变）；`WALLET_WRITE` 退役（组 / 桶 / 绑定 / 前端常量四处同删，零孤儿组）；金库专员保留 `WALLET_READ` + `WITHDRAWAL_ADDRESS_WRITE`；侧栏 Withdrawal Addresses 入口权限改 `WITHDRAWAL_ADDRESSES_READ`（D6）；前端 `ASSETS_CREATE` 删。

**审批策略**：退 `ASSET_ACTIVATION`、`CUSTODIAN_WALLET_CREATE`、`TRANSACTION_LIMIT_CREATION`；增 `SWAP_FEE_LEVEL_RETIRE`、`WITHDRAWAL_FEE_LEVEL_RETIRE`（进 `V1_APPROVAL_ACTION_TYPES` 白名单）。`scripts/verify-rbac.ts` 的 `MAKER_GROUP_BY_POLICY` 补 `ASSET_SUSPENSION / ASSET_REACTIVATION`（maker `ASSET_CONFIG_WRITE`）与两条退役策略、删三条退役项——**从此表与策略一一对应**（交付清单要求）。审批详情回链映射（`ApprovalDetailPage.tsx`）补两条退役策略 → levelCode，删三条退役项。

**种子身世**：`db:base:sync` / `seed.business.ts` 装载每条配置时写审计行——`ASSET_SEEDED`、`CUSTODIAN_WALLET_SEEDED`、`TRANSACTION_LIMIT_SEEDED`、`SWAP_FEE_LEVEL_SEEDED`、`WITHDRAWAL_FEE_LEVEL_SEEDED`（actorType SYSTEM、actorNo `RELEASE`，metadata `{ seedVersion, commit }`，correlationMode START，requiredFields `['afterData']`）；演示客户的充值地址 / 提现地址 `*_SEEDED` 同型但 actorNo `DEMO_SEED`。第七幕按 USDT 查，第一行是"随版本上架"。

**审计词表**：新码（`CUSTOMER_DEPOSIT_ADDRESS_CREATED`、`DEPOSIT_SIGNAL_REJECTED`、`WITHDRAWAL_ADDRESS_UPDATED / UNSUSPENDED`、费率退役六码、七个 `*_SEEDED`）出生即定四属性进合同；退役码（资产六、钱包三、限额四、`SWAP/WITHDRAWAL_FEE_LEVEL_*` 中因删行语义作废的码）进 `DEPRECATED_AUDIT_ACTIONS`；`audit-vocabulary-closure.spec` 常绿。

**剧本与数据**：站 4 改"资产管控"——运营提暂停 USDT → CISO 批 → 客户端充值 / 兑换 / 提现三条路当场停 → 运营提恢复 → CISO 批；站 5 ③ 托管钱包页只读看容器（vault × 网络）；站 5 ④ 补三拍：冷却期内取消、`treasury@` 跳过冷却（⚡ 区）、用 `demo_acme` 演首个法币账户即时生效；站 2 补 Grace VIP 档与 Alice 默认档的报价对照。`demo/data.md` 补：7 行平台地址、地址簿种子清单、VIP 档、一条合法 TRON 样例地址。

**文档**：`modules/v3-financial-config.md` §0–§6 按本篇重写（§2 状态机四张表、§3 决策点表按新 maker/checker）；`modules/overview.md` §1 与 §4（技术官 / 运营 / 金库专员独有动作、桶数）；`BACKLOG.md` 销账体检对应项并登记未来项「新资产上线流程」；`PRODUCTION-NOTES.md:49` 划掉（代码 08-04 起已校验地址状态）；`TOOLING-DEBT.md` 登记 X2；`CHANGELOG` 一行。

## 9. 判据（本波范围）

- 现有跟改：`verify:act1` B6 不变；B7 改"对 ACTIVE 资产打 reactivate → 409 + Invalid transition"（用运营 token）；B13 等不受影响。`verify:rbac` 删打退役端点的探针、S5 表按 §8 更新。
- 新增静态判据（`verify:rbac`）：**S8** `MAKER_GROUP_BY_POLICY` 与 `DEFAULT_APPROVAL_POLICIES` 里有 maker-checker 的策略集合相等；**S9** 每条策略的 checker 职务持有该策略 entityRef 详情页所需的读权限（按 `ApprovalDetailPage` 回链映射反查）。
- 行为判据扩容（资产暂停生效 / 地址五条 / 限额冲突 / 费率四条 / VIP 命中）属波二；本波只保证三域 e2e 与 `demo:all` 在新结构上全绿。

## 10. 收尾闸与验收

- 随手闸：tsc ①②③；jest 跑 `asset-treasury/**`、`trading/{swap,withdrawal}-fee-level`、`deposit-transactions`、`withdraw-transactions`、`audit-logging`、`identity/access-control` 相关目录，全绿；改了前端必截图。
- 收尾闸（worktree 内 `self`）：`stack.sh reset self` → `demo:all`（花名册全绿）→ `verify:coa`（提现付款腿动过钱）→ `verify:rbac` → `verify:act1` → `verify:audit` → `recon:demo:pass` + `recon:demo:break` → `test:e2e` 三域；判据对照 `demo/baseline.md` 全绿。
- 真机走查：站 2 / 4 / 5 逐站三查（走通没有 / 页面对不对 / 审计查得到吗）+ 截图；主库重铺后 `audit_log_events` 里五块配置各有 `*_SEEDED` 行。
- 合并前 merge main 复跑判据（rbac.catalog / approval.constants / 审计合同三处冲突高发）；合并后主栈 **重启 + `db:base:sync`**（体检 X2 两次撞上）。

## 11. 风险与执行注意

1. **入金信号改钥匙是全链改动**：DTO、`inbound-transfer-signals.service`、`deposit-transactions.service`、⚡ 面板、`demo-lib.ts`、`recon-demo.ts`、三域 e2e 夹具都造信号——漏一处 `demo:all` 当场红，这是想要的。
2. **提现付款腿改解析**：`system-wallet.util.ts` + `withdraw-workflow.service.ts` 六处；改完必跑 `verify:coa` 与提现 e2e。
3. **退役前逐键 `git grep`**（体检快照会过期，上一轮三次撞上）；退役审计码只进拒写名册不删。
4. **RBAC / 策略改动后必须 `db:base:sync` + 重启后端**（内存定义，只 seed 白做）；S6 前端权限码差集会当场抓抄串。
5. **schema 改动一律新增迁移、不写兼容层**，改完 `reset self` 重铺；`walletNo` / `assetNo` 改非空后，种子与 `demo-lib` 里所有建行点必须赋值（体检已核 `createRandom` 零调用，可一并删）。
6. **并行会话在动 main**：worktree 施工、命令一律 `on-stack.sh self`；本波动 `rbac.catalog.ts`、`approval.constants.ts`、`audit-actions.constant.ts` 三份共享文件，合并前必 merge main。
7. 只有 TRON 一条链、一个链上资产，"同链共用地址"没有第二个币可演——结构对了即可，判据只断言（客户 × 网络）唯一；将来上第二个 TRC-20 币时零地址工作是这条结构的回报。
