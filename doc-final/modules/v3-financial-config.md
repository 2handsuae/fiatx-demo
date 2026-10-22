# V3 · 财务配置（资产 / 钱包地址 / 提现地址簿 / 费率 / 限额 / 定价）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-10-22（对手方波一：提现地址簿长出受益人三档 / 托管自报 / 筛查 / 签名验证，状态机 5→7 态 9 边；此前 2026-09-04 V3 治愈波一「结构与退役」收尾走查）
> 演示幕次：第一幕「开业」后半 ｜ 验收：第一幕后半走查（`demo/script.md` 站 2 / 4 / 5）+ 本篇 §4
> 两波总纲：`superpowers/specs/2026-09-03-v3-config-cure-waves-outline.md`；波二（法一留痕全域推广 / 判据扩容）另起会话脑暴。

## 0. 一句话定位

管**交易的静态参数**：上什么资产（在哪条网络、什么合约）、钱放在哪个容器（vault × 网络的地址行）、客户往哪提（按网络登记的地址簿）、收多少费、限多少额。不管单据怎么流转（V4–V6）、不管客户是谁（V2）。**上币不在管理台**——走开发流程随版本装载，"先有账后有货"发生在装载时。

## 1. 业务叙事

**网络是一等实体。** 资产 = 币种 × 网络 × 合约地址；`USDT-TRON` 的合约地址是防诈骗字段——入金信号的合约对不上任何资产直接拒收留痕（`DEPOSIT_SIGNAL_REJECTED`）。网络（`TRON` / `AED_ZAND`）是代码注册表（`config/manifests/networks.manifest.ts`），不建表、不做管理面；托管方（HexTrust / Zand）按网络给地址。

**资产只有开关。** 两个资产随版本装载（审计第一行 `ASSET_SEEDED`，actor `RELEASE`）；运营提暂停 / 恢复，CISO 批（12h）；暂停 = 三条路的**客户端选择面**当场关（三个页面都读 `GET /assets?status=ACTIVE`，暂停后该资产不再出现在下拉里）。暂停 = L1 第十项 `ASSET_AVAILABILITY`：提现 / 兑换建单 BLOCK（403 + `*_L1_BLOCKED` 审计），充值照建单、打标、送检、合规通过后挂给运营（`DEPOSIT_L1_HELD` → `DEPOSIT_HELD`）；在途单不受影响；入金识别不判状态。上架 / 激活 / 编辑整条路已退役——将来上币见 BACKLOG「新资产上线整条流程」。

**钱包行 = 一个地址。** 平台侧 4 个 vault（F_OPS / F_SET / F_FEE / F_LIQ）× 网络 = 7 行只从种子来（`CUSTODIAN_WALLET_SEEDED`），管理台只读，余额一律看账本（钱包表上没有余额）。客户侧唯一写路径是"客户在某网络上要一个收款地址"（`POST /client/deposit-wallets { network }`）：同网络第二次直接复用——一 vault 一链一地址（HexTrust 语义），将来上第二个 TRC-20 币零地址工作。

**提现地址簿按网络，且每条地址带着「谁的钱、谁托管、筛没筛过」。** 登记选网络不选资产，登记时问三件事：① **受益人**——本人（Myself）或第三方（Third party，须填姓名与关系）；② **托管**（链上必选）——自托管或交易所（VASP），这是客户**自报**，系统另按归因给结论（mock：地址尾号 `1111` → Mock VASP Exchange，其余自托管），**自报 ≠ 归因即红旗（`hostingMismatch`）——只留痕、不拦截**（业主拍板：演示留痕不拦；生产应阻断或升合规复核，记在 `PRODUCTION-NOTES.md`）；③ **筛查**——登记时 mock 按尾号出结论（`2222` → YELLOW 放行、`3333` → RED、其余 GREEN）。所有权证据按「受益人 × 托管」分三档：**自托管 × 本人 = 签名**（登记后先停 `PENDING_VERIFICATION`，客户在客户端点 Verify wallet signature，mock 点即过；通过后才进冷却，**冷却自验签那一刻起算**，不是登记时刻）；**托管 × 本人 / 银行 × 本人 = 自声明**；**第三方 = 声明书**（姓名 + 关系即证据）——后两档登记即落定、直接进 24h 冷却。**两绿汇合**才进冷却（证据落定 + 筛查不红），**RED 一票否决**：登记时 RED（尾号 `3333`）当场 `REJECTED`——这是登记时的落点计算而非迁移表的边，且优先级压过「首个法币账户即时生效」（首个 IBAN 撞 3333 也照拒）；在待验签 / 冷却期间被 ⚡ 喂 RED 则走 `REJECT` 边进 `REJECTED`。**`REJECTED` 是终态：占着 `(客户, 网络, 地址)` 唯一键即封禁，不可复活，也不占每网络 3 条的名额**。首个法币账户即时生效、每网络最多 3 条（等签名 / 冷却中 / 已生效都占名额）不变；申报证据（受益人、关系、托管）登记后冻结，**改只改标签**（改归属 = 新登记，冷却闸才有意义）；冷却期内可取消、自助可停用（最后一个法币账户与有在途提现的地址停不掉）、管理员可暂停 / 恢复 / 跳过冷却（⚡ 后门必留痕）、合规官可 ⚡ 喂筛查（覆写，必留痕）；七态九边写在迁移表里，非法跃迁 409。**客户面投影**：client 接口只回 24 键白名单（筛查结论、红旗、停用理由等内部判断一概不出），客户只读得到 `Pending verification` / `Not approved` 这类结果、读不到原因——tipping-off 遮蔽由后端执行，不靠前端；管理台全量可见（Attribution / Self-declaration & Red Flag / Beneficiary / Screening 四个区块 + ⚡ Screening Simulation）。

**限额从种子来、只改不建不删。** 15 条规则（单笔 6 / 累计 8 / 大额 1）随版本铺好（`TRANSACTION_LIMIT_SEEDED`）；运营提改金额、高管批；落地前 before-vs-current 冲突守卫；规则没有生命周期——`approvalCaseNo` 非空即"变更中"，一条规则同时只能有一张待批单。

**费率增删改查齐。** 等级 `PENDING_APPROVAL → ACTIVE | REJECTED | CANCELLED`、`ACTIVE → RETIRED`（"删" = 退役终态；该币对 / 资产最后一个 ACTIVE 默认档不可退）；创建被拒不再消失，列表筛 REJECTED 是真的；变更走独立请求单（`SFC…` / `WFC…`，configHash 快照守卫，`EXPIRED` 单独终态）；受众谓词（默认档 / 标签 + 时间窗）——Grace（VIP）命中 `VIP-USDT-AED`、Alice 命中默认档，报价在够格的档里选最便宜。

## 2. 状态机

| 主体 | 迁移表 | 边 |
|---|---|---|
| 资产 | `assets/constants/asset-transitions.constant.ts` | `ACTIVE --SUSPEND--> SUSPENDED --REACTIVATE--> ACTIVE`（请求层也走表：对 ACTIVE 提恢复 → 409） |
| 钱包行 | `wallets/wallets.service.ts#WALLET_STATUS_TRANSITIONS` | `CREATING → ACTIVE`｜`CREATING → FAILED`；两者终态（DISABLED / FROZEN 已退役——停入金靠 V2 限制账） |
| 提现地址（7 态 9 边 7 动作） | `withdrawal-addresses/constants/withdrawal-address-transitions.constant.ts` | `PENDING_VERIFICATION --RELEASE--> PENDING_ACTIVATION`｜`--REJECT--> REJECTED`｜`--CANCEL--> CANCELLED`；`PENDING_ACTIVATION --ACTIVATE--> ACTIVE`｜`--CANCEL--> CANCELLED`｜`--REJECT--> REJECTED`；`ACTIVE --SUSPEND--> SUSPENDED --UNSUSPEND--> ACTIVE`｜`ACTIVE --DEACTIVATE--> DEACTIVATED`；`CANCELLED` / `DEACTIVATED` / `REJECTED` 终态。**首法币直落 `ACTIVE`、尾号 3333「登记即拒」直落 `REJECTED` 都是插入时的落点计算，不是边** |
| 费率等级（两族） | `trading/shared/fee-level-transitions.constant.ts` | `PENDING_APPROVAL --APPROVE--> ACTIVE`｜`--DECLINE--> REJECTED`｜`--CANCEL--> CANCELLED`｜`ACTIVE --RETIRE--> RETIRED` |
| 费率变更单 | 同上 | `PENDING_APPROVAL → APPROVED ｜ REJECTED ｜ CANCELLED ｜ EXPIRED` |
| 限额规则 | — | 无生命周期（恒生效）；`approvalCaseNo` 非空 = 变更中 |

## 3. 决策点与角色

| 动作 | 谁发起（权限组） | 谁裁决（策略） | 要点 |
|---|---|---|---|
| 资产暂停 / 恢复 | **OPS_OFFICER**（`ASSET_CONFIG_WRITE`，运营独有；技术官只剩 IAM） | **CISO** 12h（`ASSET_SUSPENSION` / `ASSET_REACTIVATION`） | 有待批单时详情显示徽章 + 单号，动作按钮隐去 |
| 客户收款地址 | 客户本人（客户端） | 无审批 | 交易就绪门只在开新地址时过；同网络复用 |
| 提现地址登记 / 验签 / 改标签 / 取消 / 停用 | 客户本人 | 无审批（地址簿不进 maker-checker） | 24h 冷却；首个法币账户即时生效；自托管 × 本人先验签再冷却；改只收标签 |
| 提现地址暂停 / 恢复 / 跳过冷却 | **TREASURY_OFFICER**（`WITHDRAWAL_ADDRESS_WRITE`，金库独有） | 直接执行，必留痕 | 跳过冷却是 ⚡ 后门（Manual Simulation 区） |
| ⚡喂筛查 | **COMPLIANCE_OFFICER**（`DEMO_VERDICT_WRITE`，合规官；金库不可） | 直接执行，必留痕 | 理由必填；仅对待验签 / 冷却中的条目：GREEN / YELLOW 覆写结论（`WITHDRAWAL_ADDRESS_SCREENED`），RED 走 `REJECT` 边进 `REJECTED`（`WITHDRAWAL_ADDRESS_REJECTED`）；其余态 409——⚡ 不是绕迁移表的直写通道。筛查站在 Sumsub 一侧，与喂裁决同义，故挂 `DEMO_VERDICT_WRITE` 而非金库的写权限 |
| 限额改金额 | **OPS_OFFICER**（`TRANSACTION_LIMIT_WRITE`） | **SENIOR_MANAGEMENT_OFFICER** 48h | 一条规则同时只能有一张待批单；落地前冲突守卫 |
| 费率创建 / 变更 / 退役 | **CFO**（`*_FEE_LEVEL_WRITE`，财务独有） | **OPS_OFFICER** 48h（`*_CREATION` / `*_CHANGE` / `*_RETIRE`） | maker≠checker（`verify:rbac` S5c 守，本域零豁免）；最后一个默认档不可退 |
| 上币 / 建平台钱包 / 建限额 | 开发（随版本装载） | 无——发布标记审计 `*_SEEDED` | 管理台无入口 |

## 4. 演示脚本（第一幕 · 后半）

管理台 `P+1`，11 职务账号见 `demo/data.md`；完整 6 站剧本见 `demo/script.md`，本篇只补技术细节：

1. **站 2 · 费率页**：`cfo@` 改一档兑换费 → `ops_officer@` 批 → 客户端报价立刻变；对照：Grace（VIP 标签）与 Alice 各拿一次 USDT→AED 报价——Grace 命中 `VIP-USDT-AED`、Alice 命中 `STD-USDT-AED`（受众谓词 + 最便宜档）；退役：`cfo@` 对某档点 Retire → `ops_officer@` 批 → 列表筛 RETIRED；对 `STD-USDT-AED` 点 Retire 会被 `LAST_ACTIVE_DEFAULT` 拒
2. **站 4 · 资产管控**：`ops_officer@` 对 USDT-TRON 提暂停 → `ciso@` 批 → 切客户端 alice：充值 / 兑换 / 提现三条路的 USDT 当场不可用 → `ops_officer@` 提恢复 → `ciso@` 批；讲清：上币不在这页——审计页**按资产业务号查**（`AS2601012024`，详情页上就有；铁律⑥ 对外用业务键），履历最早的一行是 `ASSET_SEEDED`（随版本上架；审计页倒序，故它显示在最下面）。⚠️ 不要按 `USDT` 搜：审计关键词不覆盖 `afterData`，而 `USDT-TRON` 只存在于那里（`audit-logs.service.ts:530-539`，2026-09-04 终审实证命中 0 行）
3. **站 5 · 限额页**：按类型筛选三种门各看一眼 → `ops_officer@` 改一条单笔限额 → 详情待批徽章 → `sm@` 批
4. **站 5 · 托管钱包页**（`treasury@`）：只读看容器——5 组（4 平台 vault + CLIENT_DEPOSIT）按 vault 分组，每行 = 一个网络上的一个地址；余额引导去账本页
5. **站 5 · 提现地址簿**（客户端 alice / bob + 管理台 `treasury@`、`compliance_lead@`）五拍（逐拍口径见 `demo/script.md` 站 5 ④，测试串见 `demo/data.md`「mock 测试地址速查」）：a) 登记一条 TRON 地址（选网络、本人、自托管）→ Verify wallet signature → 冷却倒计时 → Cancel registration；b) 再登记一条 → `treasury@` 详情 ⚡ Skip Cooling → ACTIVE → Force Suspend → Unsuspend；c) 用尚无法币账户的种子客户登记首个银行账户 → 即时 ACTIVE（第二幕回归拍）；d) alice 登记第三方申报地址（姓名 + 关系）→ ATTESTATION 登记即落定、直接进冷却，`treasury@` 详情 Beneficiary 区可见；e) bob 登记尾号 `1111` 自报自托管 → 管理台红旗；登记尾号 `3333` → 当场 Not approved；登记普通自托管 → Pending verification → 验签 → 冷却 → `compliance_lead@` ⚡ 喂 RED → REJECTED（3333 须在该网络名额未满时演）
6. **收款地址复用**（补充走查）：对同一网络重复点开地址 → 返回同一行，总数不变

## 5. 关键技术节点（≤30 行）

- 注册表 `config/manifests/{networks,vaults,assets}.manifest.ts`：`assertNetwork()`（三列写入前都过）｜ `validateAddressForNetwork()` ｜ `platformWalletSlots()`（恒 7）｜ `DEFAULT_ASSETS`（含合约 / 标准 / 确认数 / 托管键）
- 资产 `asset-treasury/assets/`：`assets.service.ts`（`suspendAsset / reactivateAsset / linkApprovalCase / clearApprovalCase`）｜ `asset-admin.controller.ts`（suspend / reactivate）｜ `asset-{suspension,reactivation}-workflow`（请求层走 `assertAssetTransition`）｜ `asset-provisioning.service.ts#systemAccountCodesFor`（种子开系统科目）
- 钱包 `asset-treasury/wallets/`：`wallets.service.ts`（迁移表 + `createWalletRecord` 校验 vault × 网络槽位）｜ `customer-deposit-wallet.service.ts#createOrReturn(customerId, network)` ｜ `mock-custodian.adapter.ts#createAddress`（TRON 形态地址 / AE IBAN）｜ `wallet-query.service.ts`（挂 `networkInfo`，无余额）｜ `funds-layer/domain/system-wallet-resolver.service.ts`（按资产网络找 `PLATFORM` / `CLIENT_DEPOSIT` 行）
- 入金信号 `trading/deposit-transactions/inbound-transfer-signals.service.ts`：钥匙①（network, address｜iban）→ 客户收款行，找不到 404（`DEPOSIT_WALLET_NOT_FOUND`）；钥匙②（network, contractAddress）→ 资产，对不上留痕拒收（`DEPOSIT_SIGNAL_REJECTED`，DENIED / `UNKNOWN_ASSET`）
- 提现地址 `asset-treasury/withdrawal-addresses/`：迁移表常量（7 态 9 边 7 动作）｜ `withdrawal-address.service.ts`（`MAX_ADDRESSES_PER_NETWORK=3`〔`SLOT_HOLDING_STATUSES` = 待验签 / 冷却中 / 已生效〕/ `COOLING_PERIOD_HOURS=24` / `BANK_RAIL_NETWORK` / `create` 与 `createBankAccount` 在插入时一次算出落点：2×2 证据档 + RED 压过一切，`createBankAccount` 首法币免冷却 / **`releaseToCooling`**〔RELEASE 边，冷却自此重算〕/ **`rejectByScreening`**〔REJECT 边〕/ **`recordScreening`**〔⚡GREEN·YELLOW 覆写，只写字段〕/ **`verifyOwnershipSignature`**〔写 `ownershipVerifiedAt` 再走 RELEASE〕/ `deactivate` 两道守卫 / `unsuspend` / `updateDetails` 只收 label）｜ workflow（`registerAddress` 先调 adapter 归因 + 筛查再落库、比对出 `hostingMismatch`；`registerBankAccount`；`verifyOwnershipSignature` / **`feedScreening`**；`updateAddress` / `unsuspendAddress`）｜ **adapter** `mock-travel-rule.adapter.ts`（`attributeAddress` + `screenAddress` 两方法，同一个 DI token `TRAVEL_RULE_ADAPTER`；mock 触点登记于 `reference/sumsub-mock-touchpoints.md`）｜ **客户面投影** `withdrawal-address-customer-view.ts#toCustomerView`（24 键白名单、默认拒绝；admin 控制器照旧全量）｜ **新端点 2 个**：client `POST /client/withdrawal-addresses/:addressNo/verify-signature`（mock 即过）、admin `POST /admin/withdrawal-addresses/:addressNo/simulate-screening`（body `{answer, reason}`，rbac 挂 `DEMO_VERDICT_WRITE`）｜ sweep（@Cron */5 + 查询前懒激活，只处理 `PENDING_ACTIVATION`，不碰待验签）
- 限额 `asset-treasury/transaction-limits/`：`rules.service`（只改：`attachApprovalCase / clearApprovalCase / applyAmountChange`）｜ `gate.service#evaluate`（L1）｜ `rule-workflow`（变更审批 + 冲突守卫）｜ 种子 `seedTransactionLimitRules`（15 条）
- 费率 `trading/{swap,withdrawal}-fee-level/`：`*-fee-level.service`（`declineLevel / cancelLevel / retireLevel / assertNotLastActiveDefault / expireChangeRequest`；`findByLevelCode` 带 `pendingChangeRequest`）｜ `*-creation / *-change / *-retire-workflow`（+ approval 发射器）｜ `trading/shared/fee-level-transitions.constant.ts` ｜ 受众 `trading/shared/fee-audience.util.ts` ｜ 报价 `swap-quote` / `withdraw-quote`（交易域，未动）
- 种子身世 `prisma/seed-audit.helper.ts`：`*_SEEDED` ×7，actorNo `RELEASE`（业务种子）/ `DEMO_SEED`（演示夹具），metadata `{ seedVersion, commit }`；`verify:demo-data` R5 按业务键逐行核验留痕（非计数，不怕 reset 遗留孤儿行），覆盖 RELEASE 的五块，两块费率过滤到 `createdByUserId='SYSTEM'`（运营经审批建的等级本就没有 `*_SEEDED` 行，不算漏留痕）
- 判据：`verify:act1` B6（钱包业务键）/ B7（对 ACTIVE 资产提恢复 409，运营 token）｜ `verify:rbac` 自批死锁闸 S5/S5b（28 条策略逐一验安全 maker 非空，已登记死锁表现空）+ maker≠checker 闸 S5c/S5d（本域零豁免）+ S8（MAKER 表与策略一一对应）/ S9（裁决人持详情页读权限）+ 资产 / 地址 / 费率退役探针
- 审计：本域全部写点在 `audit-actions.constant.ts` 合同（CONFIG / DEPOSIT 域，四属性齐）；波一退役码 16 个入 `DEPRECATED_AUDIT_ACTIONS`（资产六 / 钱包六 / 限额四），`verify:audit` 不变量③守零写入。2026-10-22 对手方波一新增 5 码（现役 343→**348**）：`WITHDRAWAL_ADDRESS_SCREENED`（⚡喂 GREEN/YELLOW）｜ `_REJECTED`（⚡喂 RED，或登记即拒由系统主体记，reason 固定 `Screening returned RED at registration`）｜ `_OWNERSHIP_VERIFIED`（客户验签，带 fromStatus/toStatus）｜ `_THIRD_PARTY_DECLARED`（登记第三方地址时随 REGISTERED 加记申报快照）｜ `_HOSTING_MISMATCH_FLAGGED`（自报 ≠ 归因，系统主体）

## 6. 演示缺口（BACKLOG 有账）

- **新资产上线整条流程**（未来：上币包装载 + 就绪检查 + 运营提激活）
- **充值累计限额未接**；充值下限拦截不经 gate 留痕、被守卫拦下留痕、客户动作 actor=CUSTOMER 全域推广、行为判据扩容 —— 波二
- **报价未落资格快照 / 费率 30 日历日生效闸未做**
- 只有 TRON 一条链、一个链上资产："同链共用地址"没有第二个币可演——结构对了即可
