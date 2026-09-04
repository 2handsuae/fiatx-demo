# V3 · 财务配置（资产 / 钱包地址 / 提现地址簿 / 费率 / 限额 / 定价）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-09-04（V3 治愈波一「结构与退役」收尾走查）
> 演示幕次：第一幕「开业」后半 ｜ 验收：第一幕后半走查（`demo/script.md` 站 2 / 4 / 5）+ 本篇 §4
> 两波总纲：`superpowers/specs/2026-09-03-v3-config-cure-waves-outline.md`；波二（法一留痕全域推广 / 判据扩容）另起会话脑暴。

## 0. 一句话定位

管**交易的静态参数**：上什么资产（在哪条网络、什么合约）、钱放在哪个容器（vault × 网络的地址行）、客户往哪提（按网络登记的地址簿）、收多少费、限多少额。不管单据怎么流转（V4–V6）、不管客户是谁（V2）。**上币不在管理台**——走开发流程随版本装载，"先有账后有货"发生在装载时。

## 1. 业务叙事

**网络是一等实体。** 资产 = 币种 × 网络 × 合约地址；`USDT-TRON` 的合约地址是防诈骗字段——入金信号的合约对不上任何资产直接拒收留痕（`DEPOSIT_SIGNAL_REJECTED`）。网络（`TRON` / `AED_ZAND`）是代码注册表（`config/manifests/networks.manifest.ts`），不建表、不做管理面；托管方（HexTrust / Zand）按网络给地址。

**资产只有开关。** 两个资产随版本装载（审计第一行 `ASSET_SEEDED`，actor `RELEASE`）；运营提暂停 / 恢复，CISO 批（12h）；暂停 = 三条路的**客户端选择面**当场关（三个页面都读 `GET /assets?status=ACTIVE`，暂停后该资产不再出现在下拉里）。⚠️ **后端目前没有资产状态门**：兑换 `swap-transactions.service.ts:159-168`、提现 `withdraw-workflow.service.ts:257-258`、充值信号匹配 `inbound-transfer-signals.service.ts:582` 三处都只判「资产存在」不判 `status`，绕过前端直接打 API 仍可交易已暂停资产。设计口径本来要求这是一道硬门，代码没有——已登记 BACKLOG。上架 / 激活 / 编辑整条路已退役——将来上币见 BACKLOG「新资产上线整条流程」。

**钱包行 = 一个地址。** 平台侧 4 个 vault（F_OPS / F_SET / F_FEE / F_LIQ）× 网络 = 7 行只从种子来（`CUSTODIAN_WALLET_SEEDED`），管理台只读，余额一律看账本（钱包表上没有余额）。客户侧唯一写路径是"客户在某网络上要一个收款地址"（`POST /client/deposit-wallets { network }`）：同网络第二次直接复用——一 vault 一链一地址（HexTrust 语义），将来上第二个 TRC-20 币零地址工作。

**提现地址簿按网络。** 登记选网络不选资产；24h 冷却、首个法币账户即时生效、每网络最多 3 条不变；改只改标签与收款人（改地址 = 新登记，冷却闸才有意义）；冷却期内可取消、自助可停用（最后一个法币账户与有在途提现的地址停不掉）、管理员可暂停 / 恢复 / 跳过冷却（⚡ 后门必留痕）；五条边写在迁移表里，非法跃迁 409。

**限额从种子来、只改不建不删。** 15 条规则（单笔 6 / 累计 8 / 大额 1）随版本铺好（`TRANSACTION_LIMIT_SEEDED`）；运营提改金额、高管批；落地前 before-vs-current 冲突守卫；规则没有生命周期——`approvalCaseNo` 非空即"变更中"，一条规则同时只能有一张待批单。

**费率增删改查齐。** 等级 `PENDING_APPROVAL → ACTIVE | REJECTED | CANCELLED`、`ACTIVE → RETIRED`（"删" = 退役终态；该币对 / 资产最后一个 ACTIVE 默认档不可退）；创建被拒不再消失，列表筛 REJECTED 是真的；变更走独立请求单（`SFC…` / `WFC…`，configHash 快照守卫，`EXPIRED` 单独终态）；受众谓词（默认档 / 标签 + 时间窗）——Grace（VIP）命中 `VIP-USDT-AED`、Alice 命中默认档，报价在够格的档里选最便宜。

## 2. 状态机

| 主体 | 迁移表 | 边 |
|---|---|---|
| 资产 | `assets/constants/asset-transitions.constant.ts` | `ACTIVE --SUSPEND--> SUSPENDED --REACTIVATE--> ACTIVE`（请求层也走表：对 ACTIVE 提恢复 → 409） |
| 钱包行 | `wallets/wallets.service.ts#WALLET_STATUS_TRANSITIONS` | `CREATING → ACTIVE`｜`CREATING → FAILED`；两者终态（DISABLED / FROZEN 已退役——停入金靠 V2 限制账） |
| 提现地址 | `withdrawal-addresses/constants/withdrawal-address-transitions.constant.ts` | `PENDING_ACTIVATION --ACTIVATE--> ACTIVE`｜`--CANCEL--> CANCELLED`｜`ACTIVE --SUSPEND--> SUSPENDED --UNSUSPEND--> ACTIVE`｜`ACTIVE --DEACTIVATE--> DEACTIVATED` |
| 费率等级（两族） | `trading/shared/fee-level-transitions.constant.ts` | `PENDING_APPROVAL --APPROVE--> ACTIVE`｜`--DECLINE--> REJECTED`｜`--CANCEL--> CANCELLED`｜`ACTIVE --RETIRE--> RETIRED` |
| 费率变更单 | 同上 | `PENDING_APPROVAL → APPROVED ｜ REJECTED ｜ CANCELLED ｜ EXPIRED` |
| 限额规则 | — | 无生命周期（恒生效）；`approvalCaseNo` 非空 = 变更中 |

## 3. 决策点与角色

| 动作 | 谁发起（权限组） | 谁裁决（策略） | 要点 |
|---|---|---|---|
| 资产暂停 / 恢复 | **OPS_OFFICER**（`ASSET_CONFIG_WRITE`，运营独有；技术官只剩 IAM） | **CISO** 12h（`ASSET_SUSPENSION` / `ASSET_REACTIVATION`） | 有待批单时详情显示徽章 + 单号，动作按钮隐去 |
| 客户收款地址 | 客户本人（客户端） | 无审批 | 交易就绪门只在开新地址时过；同网络复用 |
| 提现地址登记 / 改标签 / 取消 / 停用 | 客户本人 | 无审批 | 24h 冷却；首个法币账户即时生效 |
| 提现地址暂停 / 恢复 / 跳过冷却 | **TREASURY_OFFICER**（`WITHDRAWAL_ADDRESS_WRITE`，金库独有） | 直接执行，必留痕 | 跳过冷却是 ⚡ 后门（Manual Simulation 区） |
| 限额改金额 | **OPS_OFFICER**（`TRANSACTION_LIMIT_WRITE`） | **SENIOR_MANAGEMENT_OFFICER** 48h | 一条规则同时只能有一张待批单；落地前冲突守卫 |
| 费率创建 / 变更 / 退役 | **CFO**（`*_FEE_LEVEL_WRITE`，财务独有） | **OPS_OFFICER** 48h（`*_CREATION` / `*_CHANGE` / `*_RETIRE`） | maker≠checker（`verify:rbac` S5c 守，本域零豁免）；最后一个默认档不可退 |
| 上币 / 建平台钱包 / 建限额 | 开发（随版本装载） | 无——发布标记审计 `*_SEEDED` | 管理台无入口 |

## 4. 演示脚本（第一幕 · 后半）

管理台 `P+1`，11 职务账号见 `demo/data.md`；完整 6 站剧本见 `demo/script.md`，本篇只补技术细节：

1. **站 2 · 费率页**：`cfo@` 改一档兑换费 → `ops_officer@` 批 → 客户端报价立刻变；对照：Grace（VIP 标签）与 Alice 各拿一次 USDT→AED 报价——Grace 命中 `VIP-USDT-AED`、Alice 命中 `STD-USDT-AED`（受众谓词 + 最便宜档）；退役：`cfo@` 对某档点 Retire → `ops_officer@` 批 → 列表筛 RETIRED；对 `STD-USDT-AED` 点 Retire 会被 `LAST_ACTIVE_DEFAULT` 拒
2. **站 4 · 资产管控**：`ops_officer@` 对 USDT-TRON 提暂停 → `ciso@` 批 → 切客户端 alice：充值 / 兑换 / 提现三条路的 USDT 当场不可用 → `ops_officer@` 提恢复 → `ciso@` 批；讲清：上币不在这页——审计页**按资产业务号查**（`AS2601012024`，详情页上就有；铁律⑥ 对外用业务键），第一行 `ASSET_SEEDED`（随版本上架）。⚠️ 不要按 `USDT` 搜：审计关键词不覆盖 `afterData`，而 `USDT-TRON` 只存在于那里（`audit-logs.service.ts:530-539`，2026-09-04 终审实证命中 0 行）
3. **站 5 · 限额页**：按类型筛选三种门各看一眼 → `ops_officer@` 改一条单笔限额 → 详情待批徽章 → `sm@` 批
4. **站 5 · 托管钱包页**（`treasury@`）：只读看容器——5 组（4 平台 vault + CLIENT_DEPOSIT）按 vault 分组，每行 = 一个网络上的一个地址；余额引导去账本页
5. **站 5 · 提现地址簿**（客户端 alice + 管理台 `treasury@`）三拍：① 登记一条 TRON 地址（选网络）→ 冷却倒计时 → Cancel registration；② 再登记一条 → `treasury@` 详情 ⚡ Skip Cooling → ACTIVE → Force Suspend → Unsuspend；③ 用尚无法币账户的种子客户登记首个银行账户 → 即时 ACTIVE
6. **收款地址复用**（补充走查）：对同一网络重复点开地址 → 返回同一行，总数不变

## 5. 关键技术节点（≤30 行）

- 注册表 `config/manifests/{networks,vaults,assets}.manifest.ts`：`assertNetwork()`（三列写入前都过）｜ `validateAddressForNetwork()` ｜ `platformWalletSlots()`（恒 7）｜ `DEFAULT_ASSETS`（含合约 / 标准 / 确认数 / 托管键）
- 资产 `asset-treasury/assets/`：`assets.service.ts`（`suspendAsset / reactivateAsset / linkApprovalCase / clearApprovalCase`）｜ `asset-admin.controller.ts`（suspend / reactivate）｜ `asset-{suspension,reactivation}-workflow`（请求层走 `assertAssetTransition`）｜ `asset-provisioning.service.ts#systemAccountCodesFor`（种子开系统科目）
- 钱包 `asset-treasury/wallets/`：`wallets.service.ts`（迁移表 + `createWalletRecord` 校验 vault × 网络槽位）｜ `customer-deposit-wallet.service.ts#createOrReturn(customerId, network)` ｜ `mock-custodian.adapter.ts#createAddress`（TRON 形态地址 / AE IBAN）｜ `wallet-query.service.ts`（挂 `networkInfo`，无余额）｜ `funds-layer/domain/system-wallet-resolver.service.ts`（按资产网络找 `PLATFORM` / `CLIENT_DEPOSIT` 行）
- 入金信号 `trading/deposit-transactions/inbound-transfer-signals.service.ts`：钥匙①（network, address｜iban）→ 客户收款行，找不到 404（`DEPOSIT_WALLET_NOT_FOUND`）；钥匙②（network, contractAddress）→ 资产，对不上留痕拒收（`DEPOSIT_SIGNAL_REJECTED`，DENIED / `UNKNOWN_ASSET`）
- 提现地址 `asset-treasury/withdrawal-addresses/`：迁移表常量 ｜ `withdrawal-address.service.ts`（`MAX_ADDRESSES_PER_NETWORK=3` / `COOLING_PERIOD_HOURS=24` / `BANK_RAIL_NETWORK` / `createBankAccount` 首法币免冷却 / `deactivate` 两道守卫 / `unsuspend` / `updateDetails`）｜ workflow（`updateAddress` / `unsuspendAddress`）｜ sweep（@Cron */5 + 查询前懒激活）
- 限额 `asset-treasury/transaction-limits/`：`rules.service`（只改：`attachApprovalCase / clearApprovalCase / applyAmountChange`）｜ `gate.service#evaluate`（L1）｜ `rule-workflow`（变更审批 + 冲突守卫）｜ 种子 `seedTransactionLimitRules`（15 条）
- 费率 `trading/{swap,withdrawal}-fee-level/`：`*-fee-level.service`（`declineLevel / cancelLevel / retireLevel / assertNotLastActiveDefault / expireChangeRequest`；`findByLevelCode` 带 `pendingChangeRequest`）｜ `*-creation / *-change / *-retire-workflow`（+ approval 发射器）｜ `trading/shared/fee-level-transitions.constant.ts` ｜ 受众 `trading/shared/fee-audience.util.ts` ｜ 报价 `swap-quote` / `withdraw-quote`（交易域，未动）
- 种子身世 `prisma/seed-audit.helper.ts`：`*_SEEDED` ×7，actorNo `RELEASE`（业务种子）/ `DEMO_SEED`（演示夹具），metadata `{ seedVersion, commit }`；`verify:demo-data` R5 按业务键逐行核验留痕（非计数，不怕 reset 遗留孤儿行），覆盖 RELEASE 的五块，两块费率过滤到 `createdByUserId='SYSTEM'`（运营经审批建的等级本就没有 `*_SEEDED` 行，不算漏留痕）
- 判据：`verify:act1` B6（钱包业务键）/ B7（对 ACTIVE 资产提恢复 409，运营 token）｜ `verify:rbac` 自批死锁闸 S5/S5b（28 条策略逐一验安全 maker 非空，已登记死锁表现空）+ maker≠checker 闸 S5c/S5d（本域零豁免）+ S8（MAKER 表与策略一一对应）/ S9（裁决人持详情页读权限）+ 资产 / 地址 / 费率退役探针
- 审计：本域全部写点在 `audit-actions.constant.ts` 合同（CONFIG / DEPOSIT 域，四属性齐）；波一退役码 16 个入 `DEPRECATED_AUDIT_ACTIONS`（资产六 / 钱包六 / 限额四），`verify:audit` 不变量③守零写入

## 6. 演示缺口（BACKLOG 有账）

- **新资产上线整条流程**（未来：上币包装载 + 就绪检查 + 运营提激活）
- **充值累计限额未接**；充值下限拦截不经 gate 留痕、被守卫拦下留痕、客户动作 actor=CUSTOMER 全域推广、行为判据扩容 —— 波二
- **报价未落资格快照 / 费率 30 日历日生效闸未做**
- 只有 TRON 一条链、一个链上资产："同链共用地址"没有第二个币可演——结构对了即可
