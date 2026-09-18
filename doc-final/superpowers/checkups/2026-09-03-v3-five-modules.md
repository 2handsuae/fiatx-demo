# V3 财务配置 · 五块体检（主会话判读版）

2026-09-03 ｜ 体检对象 main `b3870559`（走查期间 main 又前进到 `13e3dcd1`，见 X2）｜ 方法：三名 sonnet 取数员交「数字 + 复现命令」（资产 A 42 题 / 限额 L 40 题 / 费率 F 40 题），钱包 W / 地址 D 是上一轮旧式带结论报告——**其判色已作废、只用其证据由主会话重判**；主会话浏览器真机走查（R）贯穿站 2 / 4 / 5；所有否定性结论由主会话两种搜法复现后才采信（见附）。

判色口径：**红** = 违反铁律或命中评审三判据（业务逻辑不符 / 演示不出来·讲不圆 / 代码读不懂）且有 file:line 或真机证据 ｜ **黄** = 漂移、死码、不一致，不挡演示 ｜ **绿** = 逐项核过有证据。

## 一、五块 × 九维

| 维 | 资产 A | 钱包 W | 地址 D | 限额 L | 费率 F |
|---|---|---|---|---|---|
| ① 留痕 | 红 | 红 | 红 | 黄 | 黄 |
| ② 流程可用 | 红 | 红 | 红 | 红 | 绿 |
| ③ 代码清晰 | 黄 | 黄 | 黄 | 黄 | 黄 |
| ④ 前端完好 | 黄 | 红 | 黄 | 黄 | 黄 |
| ⑤ 权限分组 | 绿 | 红 | 绿 | 绿 | 绿 |
| ⑥ 超时门 | 黄 | 绿 | 黄 | 绿 | 绿 |
| ⑦ 状态沿边走 | 绿 | 黄 | 黄 | 黄 | 黄 |
| ⑧ 钱动过账 | 绿 | 红 | 绿 | 绿 | 绿 |
| ⑨ 业务键 | 黄 | 黄 | 黄 | 绿 | 黄 |

一句话：**法三（业务键）在 V3 基本落实，法一（留痕）在"被拦下"那一半普遍缺席，法二（迁移表）只有资产做实；五块共用的病是"种子配置零身世"和"判据网几乎为空"。**

## 二、红项（按块）

### 资产 A

- **A-R1 ①** 就绪检查拒绝不留痕。`asset-activation-workflow.service.ts:141-176 checkReadiness` 三处 `throw BadRequestException` 都在 `createAndSubmit`(:85) 与 `recordByActor`(:115) 之前。真机：点激活 → 400 "No active wallet configured for this asset"，主库该资产审计只有创建一行。**这正是站 4 的高光台词，第七幕拉不出来。** 分流：业务缺口。
- **A15 ②** 资产自带的四个限额字段是死配置。`Asset.minDepositAmount/maxDepositAmount/minWithdrawAmount/maxWithdrawAmount`：DTO 必填（`submit-asset-listing.dto.ts:67-83`）、表单必填、落库；全仓（src / admin-web / client-web / scripts，两种搜法）**零读取方**；真正的单笔门读 `transaction_limit_rules`（`transaction-limit-gate.service.ts:44-52`）。09-02 补的四个输入框让演示者现填四个不起作用的数。站 4 讲"上架有门槛"时这四格是假门槛。分流：业务缺口（二选一：删字段或让门读它）。
- **A5 ⑩** 种子资产零身世：AED/USDT 由 `seed.business.ts:111` `upsert` 直写 `status:'ACTIVE'`，主库 `approval_cases` 无任一 ASSET 案、审计仅本次新建一行。v3 §4 第 2 条"看 USDT / AED 的状态与身世"——身世为空。归 X1。

### 钱包 W

- **W1 ⑧** `Balance (mock)` 列是恒为 0 的假余额。`schema.prisma:717 mockBalance`，唯一写方 `wallet-balance.service.ts adjust()` 零调用（已复现），读方 `wallet-query.service.ts:35-42`，列表 `CustodianWalletList.tsx:271/353`、详情 `:305-312`。真机 20 行全 0（含 Alice 有真实入金的 C_DEP）。与 §1"余额的唯一真相在账本、钱包表上没有余额"直接矛盾；站 5 ③ 讲不圆。
- **W2 ②/④** 建钱包弹窗角色表错位。`walletRole.util.tsx:1-9,34` + `CustodianWalletCreateModal.tsx:15-23,94-96`：可选已退役的 C_MAIN/C_OUT/C_CMA，选不到在册的 F_SET/F_FEE；C_VIBAN 走 `:127` 一条不存在的 GET 路由 + 后端 `custodian-wallet-create-workflow.service.ts:132-149` 恒抛 CMA_NOT_FOUND。真机下拉即此清单。§1 讲的四个系统钱包里"结算/手续费"建不出来。
- **W3 ⑤** 裁决人看不到自己批的钱包。CISO 组无 `WALLET_READ`（`rbac.catalog.ts:867-874`）；审批单 entityRef 链到 `/admin/custody/wallets/:walletNo`，路由要 `WALLETS_READ`。真机：ciso@ 批准后点回链 → 403，侧栏也无 Custodian Wallets。站 4 ② 只能换回 treasury@ 看结果。
- **W4 ①** 系统钱包保护与非法跃迁被拒不留痕。`wallets.service.ts:49-60` 两处 `BadRequestException` 均在唯一的 `recordByActor`(:66) 之前；详情页对 F_* 照显 `Disable Wallet`（`CustodianWalletDetail.tsx:219-221,389-396`）。§3 明写"系统钱包拒绝停用"是规则，第七幕查不到那次拒绝。
- **W6 ④** C_DEP 详情挂着退役概念整节：`CustodianWalletDetail.tsx:343-359` "Deposit Collection / Create full-balance DEPOSIT_COLLECTION when triggered"，`DEPOSIT_COLLECTION` 全仓仅此一处文案（已复现）。观众问"什么是全额归集"答不上。
- **W5 ②（判色待业主）** 客户收款账户被停用后，客户端下次即自动再开一个：`customer-deposit-wallet.service.ts:76-103` 只按 ACTIVE 查重。§1"恒只有一个"与 §3"停用"合起来演不圆——停用的业务语义（拒开 / 允许换址）文档没写。

### 地址 D

- **D1 ①** 五类自动拦截零留痕：法币前置门 `NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS`（wf:46-51）、`LAST_ACTIVE_FIAT_ADDRESS`（svc:254）、`ADDRESS_HAS_INFLIGHT_WITHDRAWAL`（svc:272）、`COOLING_PERIOD_NOT_EXPIRED`（svc:187）、`ADDRESS_LIMIT_REACHED`（svc:62,123）——全在主体层抛，wf 不接不记。§1 那两句"最后一个法币地址和有在途提现的地址停不掉"是台词，第七幕零证据。
- **D2 ②** 冷却内取消：后端有 `DELETE /client/withdrawal-addresses/:addressNo`（cli-ctl:61-66）+ `cancelAddress`，客户端零调用（已复现）；真机新地址详情只有 Close。§2 承诺的 `CANCELLED` 到不了——登记错地址只能等 24h 再停用。
- **D3 ①** 客户动作记成 SYSTEM：REGISTERED/CANCELLED/DEACTIVATED 用 `recordSystem`（wf:75,131,154,177）。真机新登记审计 `actorType=SYSTEM / actorNo=SYSTEM`。第七幕"谁登记了这个地址"答 SYSTEM——审计是业务可见物，这是判据 1。

### 限额 L

- **L-R1 ②** 没有"新建规则"入口。catalog 有 `POST /admin/transaction-limit-rules`（:460）+ `TRANSACTION_LIMIT_CREATION` 策略 + 运营持 WRITE，admin-web 零处 POST 该路径（`TransactionLimitList.tsx:132` 是 GET）。运营只能改种子规则，给新上架的 ETH 建不了限额；`TRANSACTION_LIMIT_CREATION` 这条审批策略从来没人能触发。交付清单"新增业务动作前端要有入口"。
- **L-Q3 ⑩** 15 条规则全由 `seed.business.ts:442-486` 直插 ACTIVE，主库 0 条限额审计、0 条限额审批案。归 X1。

### 费率 F

- **F-R1 ⑩** 受众谓词全链路无实例：主库两族各只有 STD-* 默认档（`requiredTagsJson=[]`、`isDefault=1`）；种子 `seed.business.ts:245-439` 只建 `isDefault:true` 档、从不设 `requiredTags`；`demo/data.md:24` 写 "Grace Premium｜VIP 费率等级｜费率受众谓词"，Grace 的 PREMIUM 档位会派生 VIP 标签（`customer-tag.service.ts:110`），却没有任何等级要求 VIP；`demo/script.md` 站 2 全文不提 VIP/受众/Grace。§1"客户在够格的档里选最便宜的"没有第二档可选——这是费率一节唯一的业务亮点，今天演不出。

## 三、黄项（浓缩）

**资产**：建资产 3 处审计无 `requestId`（`asset-listing-workflow.service.ts:68/100/148`，其余 9 处有但模板无随机位）｜三条 workflow 对 DECLINED/CANCELLED/EXPIRED 零处理（:178-183 只比 `'APPROVED'`），被拒/过期只在审批域留痕，资产域时间线断（限额/钱包/费率都记 CANCELLED，资产是例外）｜提交激活后资产页无待批态、`Activate Asset` 照旧可点（`AssetDetail.tsx` 零处 approvalCase 渲染）｜`contractAddress` DTO 有、两表单无（A10）｜4 个 workflow 死 import `AuditBusinessWorkflowTypes`（A6）｜11 个文件无 spec（A7）｜前端只有 `ASSETS_READ/ASSETS_CREATE` 两个权限码，详情/编辑/三动作零专属码，按钮不看权限（A8/A9）｜`assetNo String?` 可空（库零 NULL）｜种子单号 `AS260101+hash` 与真实 `AS+YYMMDD+随机` 两套生成器｜`GET /assets/:id` 参数名仍叫 id（服务双查）｜`updateProvisioningFields` 的 PROVISIONING 判断在迁移表外（A14）｜落地行 `ASSET_ACTIVATED` 无 from/to。

**钱包**：文档漏 PENDING_APPROVAL、代码多无写方的 FROZEN（W7）｜退役角色 C_MAIN/C_OUT/C_CMA 散 9 处半退役（W8）｜死件：`WalletBalanceService`+spec、`system-wallet.util` 四件、`SYSTEM_ACTOR`、`GET /wallets/:walletNo/balance`、`/dashboard/treasury/custodian-wallets(/:id)`（W9，均已复现零引用）｜`WALLET_STATUS_UPDATED` 写在主体层 + 7 处无 requestId（W10）｜mock adapter 无失败开关，FAILED/Retry 演不到，retry 对客户路径 FAILED 空引用（W11）｜workflow 直读 approval_cases（W12）｜停用按钮不看 `WALLET_WRITE`（W13）｜`walletNo String?` 可空 + UUID 兜底（W14）｜列表状态/角色筛选含死项｜落地行无 from/to｜**walletNo 与种子地址号共用 `WA` 前缀**。

**地址**：7 处 record 全无 requestId（真机确认）｜`SUSPENDED` 无出边、冷却中地址管理员拦不住（D5）｜侧栏项要求 `BASE_ACCESS` 而路由要 `WITHDRAWAL_ADDRESSES_READ`——真机 CISO 看得见入口点进 403（D6）｜详情动作不看权限、后门 Skip Cooling 未标 ⚡——真机 sm@ 看到 Force Suspend（D7）｜列表筛选缺 DEACTIVATED、客户端文案让客户去 Suspend（D8）｜死码 6 处 + `as any` 直读两主体 + 17 行重复 + 停用守卫直读 funds_orders（D9/D10）｜Mock TR 暗号 `1111` 无文档（D16）｜倒计时静态不走秒（D17，真机确认）｜剧本：无后门加速步骤、无样例 TRON 地址、"首法币即时生效"在 alice 上演不出（D11）｜两处文档仍说"建单不校验地址状态"，代码 08-04 起已校验（D12）｜无迁移表、§2 漏四条边（D13）｜服务生成 `WAD…` 而种子 `WA…`（真机确认）｜种子地址 `PROOF TYPE: DEMO_FIXTURE` 上屏。D14（客户链接 UUID）已随 `13e3dcd1` 变 `customerNo`，销。

**限额**：充值 BELOW_MIN 绕过 gate 的 `reject()`，不产生 `TRANSACTION_LIMIT_REJECTED`（`deposit-transactions.service.ts:1120`；累计门未接已有账 BACKLOG:120）｜三种门两处实现：LARGE_APPROVAL 不在 `gate.service.ts`（`withdraw-workflow.service.ts:671`）｜两份原生币→AED 换算（`gate.service.ts:83-91` vs `withdraw-workflow.service.ts:686-704`）｜`gateType×operationType` 无交叉校验（L-Q9）｜CUMULATIVE 表单缺 `cap`（L-Q5）｜`TRANSACTION_LIMIT_WRITE` 前端零引用、按钮只看状态（L-Q7）｜提交变更后规则页无待批态｜`/dashboard` 旧树死路由（L-Q6）｜死 import（L-Q4）｜剧本"三个 tab"实为下拉筛选（L-Q8）｜两态无迁移表、变更期间 status 恒 ACTIVE、§2 只一句｜requestId 模板无随机位。

**费率**：变更单号 `SFLC-001` 是 `SFLC-`+3 位顺序号（`swap-fee-level.service.ts:229-234`），自成一套｜审计 `primarySubjectType=SWAP_FEE_LEVEL` 但 `primarySubjectNo=SFLC-001`（按 levelCode 查不到这次变更）｜审批 entityRef 纯文本无回链、objectSnapshot 是整段转义 JSON、露 `requestId`/`levelId` UUID｜`approvalNo` 一半放 metadata 一半放顶层字段（F-Q5）；workflow 四文件 requestId 无随机位而 quote 服务带（F-Q4）｜变更单 DECLINED→REJECTED，CANCELLED 与 EXPIRED 共用 status=CANCELLED（F-Q6）｜受众校验只许 1 个标签而 `matchesAudience` 支持多个（F-Q7）｜两族同构：change-approval/change-workflow/creation-approval 归一化零差异；service 层 swap 允许 spread-only 档、withdrawal 强制至少一个 feeItem（F-Q14）；withdrawal 侧 quote 管理端点 `as any` 直查 prisma、swap 侧经 service（F-Q11）；两族 quote 端点权限装饰器写法不一（F-Q12）｜列表状态筛选含不存在的 REJECTED、缺 CANCELLED/FAILED｜详情侧栏 `全体客户（everyone）`/`长期有效` 中文夹英文页｜提交后无待批态｜变更路径落库 `amountMin/Max` 数字、种子路径字符串｜客户端报价预览露 `Source: BINANCE / Order Book / Formula / 档位编号`｜无迁移表、CANCELLED/FAILED 文档未写｜两族 service spec 各 6 用例全在受众校验，`executeChange`/configHash 冲突/`activateLevel`/`deleteRejectedLevel` 零覆盖（F-Q15）｜quotes 详情路由仍 `:id`（F-Q13，芯片在飞）。

## 四、跨模块（三部法在 V3 的落地度）

- **X1 种子配置零身世（红，⑩）**：资产 2 / 限额 15 / 费率 4 / 地址 8 / 钱包 19 全部由 seed 直插终态，主库 V3 五块审计与审批案（本次走查前）合计 0 行。v3 §1 头条"每一个参数都有身世——谁配的、谁批的、什么时候生效，都答得上来"对全部种子配置都答不上。业主定机制：seed 走真实 workflow，或 seed 写一行 `*_SEEDED` 审计。
- **X2 主栈落后于合并（红，工具 → TOOLING-DEBT）**：走查前 main 后端 pid 6908 启动于 09-01 10:53，早于 09-02 20:17 的合并；主库 `permissions` 字典 206 行 = 93 条死码 + 缺 25 条新码（`db:base:sync` 从未在合并后跑；且 `seed.base.ts:139` 只 upsert 不删）。表现是金库专员开钱包详情 403、后端按 UUID 查 walletNo 404。我已 down/sync/up 修复；**走查期间 main 又并入 `13e3dcd1`（客户域业务键），后端再次落后**。主库同样没跟上：`approval_cases` 里两条 09-01 的 `SWAP_FEE_LEVEL_CREATION` 历史行 entityRef 还是 UUID、配套 3 行审计用的是已退役裸名 `CREATION_REQUESTED/APPLIED`，对应等级早已不在表里（F-Q10）——合并后既没重启也没 reset。缺一条"合并进 main → 重启 + db:base:sync（+ 视情况 reset）"的硬章程。
- **X3 自批死锁闸表缺 4 条（⑪）**：`scripts/verify-rbac.ts:217-231 MAKER_GROUP_BY_POLICY` 不含 ASSET_ACTIVATION/SUSPENSION/REACTIVATION 与 CUSTODIAN_WALLET_CREATE（交付清单：新增 maker-checker 策略必须加一行）。四条今天不死锁（TECH≠CISO、TREASURY≠CISO），但闸不守。
- **X4 判据网对 V3 近空（⑪ 红）**：`verify:act1` 15 条里 V3 只有 B6（钱包业务号）、B7（资产 409）；`verify:rbac` 对 V3 只有方向探针（ALLOW = 非 403，不真建）；五块主旅程"建→批→落地"零闸门，五块 workflow 大多零 spec。今天站 2/4/5 能演是因为我真人走了一遍。
- **X5 "裁决人看不到裁决对象"是一类**：W3（CISO×钱包）真机 403；D6 同型（CISO×地址）。建议立判据："每条审批策略的 checker 必须持该 entityRef 详情页的读权限"。
- **X6 三处主体页无待批态**：资产 / 限额 / 费率提交审批后页面无任何 pending 标识、按钮照旧可点（费率详情有 approvalCaseNo 位但变更流不写）。
- **X7 requestId 纪律未到 V3**：资产 listing 3 处缺、钱包 7 处缺、地址 7 处缺；其余模板 `<码>_<单号>` 无随机位（靠 correlationId 区分，同旅程重发会去重）。
- **X8 单号体系四处漂移**：钱包 `WA` 与种子地址 `WA` 撞前缀；地址服务 `WAD` vs 种子 `WA`；费率变更单 `SFLC-###`；种子资产 `AS260101` 固定日。
- **X9 审计落地行不带 from/to**：`ASSET_ACTIVATED`、`CUSTODIAN_WALLET_CREATED` 无 fromStatus/toStatus（对照 `APPROVAL_GRANTED` 有 PENDING→APPROVED）。
- **X10 `/dashboard` 旧路由树**：assets ×4、transaction-limits ×2、treasury/custodian-wallets ×2 均无入站链接（已复现）。
- **X11 死 import `AuditBusinessWorkflowTypes`**：资产 4 / 限额 1 / 钱包 3 / 地址 1 / 费率 4，共 13 个文件只 import 不用（`tsc` 不查未用 import，所以一直活着）。

## 五、⑩ 演得出来（站 2 / 4 / 5 真机结论）

| 站 | 结论 | 演示者要避开 / 观众会看到 |
|---|---|---|
| 站 2 费率 | ✓ 直通报价：Tier1 费 10→25、加价 100→150bps，批准即生效，Alice 报价 Fee 25.00 AED / Spread 1.5% | 受众谓词无第二档（F-R1）；审批页要读 JSON 才知道改了什么；报价预览把内部公式/价源/档位编号全给客户看 |
| 站 4 货架 | ✓ 全程走通：建资产 → 缺钱包 400 → 建 F_OPS 钱包 → CISO 批 → 再激活 → CISO 批 → ACTIVE，客户端兑换下拉出现 ETH | 就绪拒绝无审计（A-R1）；四个限额输入是死配置（A15）；钱包角色下拉三颗雷（W2）；CISO 点钱包回链 403（W3） |
| 站 5 ①② 限额 | ✓ 改单笔上限 → 高管批 → 当场 500,000 | "三个 tab"是下拉；不能新建规则（L-R1） |
| 站 5 ③ 容器 | 弱 | Balance (mock) 全 0（W1）；VAULT 列种子全 "—"；C_DEP 详情幽灵"全额归集"节（W6） |
| 站 5 ④ 地址 | ✓ 登记 TRON 地址 → "23h 59m Cooling" | 无取消（D2）；倒计时不走秒；"首法币即时生效"alice 演不出；后门加速不在剧本；审计 actor=SYSTEM |

## 六、⑪ 判据候选（真登录真 HTTP / 真状态迁移，禁扫源码）

- **资产**：① PROVISIONING 资产无钱包打 activate → 400 且审计出现 `ASSET_ACTIVATION_*` outcome=DENIED（今缺）；② tech_admin 建资产 → 审计行 requestId 非空、correlationId 非空；③ 建→批→ACTIVE 主旅程：REQUESTED/GRANTED/ACTIVATED 同 correlationId、ACTIVATED 带 causation、from/to=PROVISIONING→ACTIVE（今缺 from/to）；④ CISO 拒绝激活 → 资产域出现 CANCELLED/DECLINED 行（今缺）；⑤ `MAKER_GROUP_BY_POLICY` 含三条资产策略（静态）。
- **钱包**：① treasury 建 F_OPS → PENDING_APPROVAL → CISO 批 → ACTIVE，审计三行链齐；② ciso GET `/wallets/:walletNo` → 200（今 403）；③ PATCH F_OPS status → 400 且 outcome=DENIED 审计行（今缺）；④ POST role=C_MAIN → 400、role=F_SET 可建（今相反）；⑤ 客户 POST deposit-wallets ×2 同号；停用后再 POST 按业主定的语义断言。
- **地址**：① 客户登记链上地址 → PENDING_ACTIVATION、activatesAt≈+24h、审计 actorType=CUSTOMER（今 SYSTEM）；② 无 BANK 客户登记银行账户 → 即时 ACTIVE，第二个 → PENDING；③ treasury skip-cooling → ACTIVE + `COOLING_SKIPPED` 审计带 reason，ops 同请求 → 403 + ADMIN_ACCESS_DENIED；④ 仅一个法币地址的客户 deactivate → 400 + DENIED 审计（今缺）；⑤ 客户 DELETE 冷却中地址 → CANCELLED（今无入口）。
- **限额**：① ops POST 建 SINGLE 规则 → PENDING_APPROVAL → sm 批 → ACTIVE（今无入口，先补入口）；② 变更 → 批 → 金额变、APPLIED 带 causation；③ 变更审批期间他人改了金额 → APPLY_FAILED reasonCode=CONFLICT；④ 超单笔上限提现 → 400 + `TRANSACTION_LIMIT_REJECTED` DENIED 行；⑤ 充值低于下限 → 挂起且有本域可查的拒绝痕（今绕过 gate）。
- **费率**：① cfo 改档 → ops 批 → 客户报价费用当场变（今天真机成立，进判据固化）；② 变更审计能按 levelCode 检索到（今 subject 是 SFLC-001）；③ 创建被拒 → 行删除 + CANCELLED 审计；④ 带受众谓词的第二档存在且 Grace 报价命中它、Alice 命中默认档（今无第二档）；⑤ `SFLC` 单号改统一体系后按新格式断言。

## 七、技术兜底（不治，一行一条）

- `wallets.service.ts:145-178` walletNo 唯一冲突 3 次重试；`assets.service.ts:255` assetNo 同款。
- `customer-deposit-wallet.service.ts:89-103` 事务内二次查重（并发）。
- `custodian-wallet-create-workflow.service.ts:188-191` 审批创建抛错回滚删行不留痕（故障路径）。
- `withdrawal-address.service.ts:173-175` 首法币计数 + create 包事务（并发首登记）。
- `activate()` 对 ACTIVE 幂等返回；sweep 逐条 try/catch 续跑。
- P2002 → 409 去重（`ADDRESS_ALREADY_REGISTERED` 等）。
- `AdminPermissionGuard` 对非 ADMIN 令牌放行（既有 G1 登记）。
- 限额 `initiateCreate/initiateChange` 早期输入校验失败不留痕（reason 缺失 / 无字段变化）——输入校验，不算。
- 费率两族 `executeCancellation`/`cancelChange` 外层 catch 只 `logger.error`（`swap-fee-level-creation-workflow.service.ts:255-257` 等 4 处）——取消动作自身执行失败的故障路径。
- 两族 `getActiveQuoteOrThrow` 报价过期分支不留痕（`swap-quote.service.ts:291-294`、`withdraw-quote.service.ts:165-170`）——报价域，且过期是时间自然结局。

## 八、已有账（不重报）

BACKLOG:22（资产四限额输入已补——本篇 A15 说明它补的是死配置）｜:28 幽灵按钮已拆（W6 同页幽灵节不在其范围）｜:36 报价资格快照｜:38 费率 30 日闸｜:120 充值累计限额未接｜:122 BELOW_MIN 计次｜:146 提现报价审计｜:187 F_LIQ 无 COA 落脚点｜:225/229 子表覆盖面（W10c / D 六码不传 subjects 归此）｜:271 金额闸门矩阵｜:271/273 受众变更口径 / cheapest 待决策｜PRODUCTION-NOTES:49"建单不校验地址状态"**已过期应划掉**（代码 08-04 起校验）｜TOOLING-DEBT 无 V3 相关行。

## 九、讨论后补录（2026-09-03，业主与主会话）

体检交付后讨论出的、不在上面任何一节的项：

- **上币没有清单，激活门只查了一半**：就绪检查只看账本户 + 钱包，不看费率档与限额规则；资产一激活客户端立刻可选，但报价报 "No applicable fee level found"（`swap-quote.service.ts:146`）。价源不用配——Binance 有 `币USDT` 市场即可报价（`binance-rate.provider.ts:29-36`，AED 钉 3.6725）。
- **V3 第六块"定价"没有管理面也没体检**：价源、钉住汇率、缓存都写死在 `binance-rate.provider.ts`；v3 §6 自陈待补。
- **客户端一套写死的假规则**：提现页 "Min: 0.001 BTC / 0.01 ETH" 与 "改安全设置后首次提现延迟 24 小时"（`client-web/src/pages/Withdraw.tsx:911-925`），与限额规则表、24h 地址冷却规则都对不上。
- **暂停 / 恢复资产没有戏份**：三条独立审批剧本只演激活；暂停对充值/提现开关的影响（`preSuspend*` 字段）没人讲。演示内容取舍。
- **角色目录要随上币分工变**：技术官"管资产生命周期"独有动作的含义从"建资产"缩成"激活/暂停/恢复"，`overview.md` §4 与 12 域 50 桶随之改。
- **报价页归交易域**：Swap/Withdraw Quotes（`:id` 路由、过期不留痕、提现报价零审计 BACKLOG:146）不进 V3 治愈。
- 主库在走查后已被另一会话重铺（HEAD 至 `bb6f2572`），本次走查留下的 ETH 资产 / 钱包 / 限额与费率改动已消失；客户域业务键合入后 D14 / W14 客户链接 UUID 两条销账。

**业主当日拍板三条**（已录 `decisions.md` 2026-09-03）：① 资产模型改网络优先；② 上币走开发流程、运营只开启/暂停、种子随版本上架并写发布标记审计；③ 定价不建管理面、报价归交易域不动。

## 十、治愈路线（业主已定：两波）

> 2026-09-03 晚业主二次收窄（`decisions.md` 第四条）：新资产上线整条流程延后、平台钱包只读、限额只改不建、费率增删改查、资产只留暂停 / 恢复且运营提单。**以 `superpowers/specs/2026-09-03-v3-config-cure-wave1-design.md` §0 总纲为准**；下文"上币包 / 就绪四件套 / 激活"表述已过时，只留作讨论记录。

切法依据一条：**地基先换，再治病**——钱包与地址两块的红项都长在"按币"模型上，先修再换模型等于做两遍。

**波一 · 换地基（模型 + 上币包 + 种子身世）**——改的是"数据是什么"

- 网络成一等实体；资产 = 币种 × 网络 × 合约地址；充值地址按客户 × 网络，提现地址簿按客户 × 网络；托管钱包按网络，账本仍按资产；入金识别按（网络、地址、合约）反查。
- 上币包走开发流程：一个配置条目 = 资产身份 + 账本科目 + 默认费率档 + 默认限额规则 + 价源/钉住汇率；就绪检查扩成"账本户、钱包、费率档、限额四件齐"；运营对费率/限额只改不建（限额"新建入口"不做）。
- 管理台退役"新建资产 / 编辑资产"两页、四个死限额字段（A15）、合约地址表单（A10）；资产页只剩激活 / 暂停 / 恢复；技术官"管资产"桶改为"资产生命周期"。
- 种子全部随版本上架：装载时写 `*_MANIFEST_APPLIED` 审计行（actor=RELEASE，metadata 记版本），解 X1；VIP 受众档作为默认配置进来，解 F-R1。
- 顺手：退役钱包角色 9 处（W8）、WA/WAD 单号前缀与 `SFLC-###`（X8）、`/dashboard` 旧树（X10）。
- 文档：decisions 三条已录；v3 §1–§3 按新模型重写；data.md 种子清单（含样例 TRON 地址）；剧本站 4/5 改写。
- 收尾闸：重铺 + demo:all + 三域 e2e。**出口：第一幕站 2/4/5 在新模型上演得出来。**

**波二 · 治病（三部法铺完 + 治疗单 + 判据）**——改的是"行为对不对"，plan 在波一合并后再写（file:line 会漂）

- 法一：被拦下留痕（A-R1 资产就绪、W4 钱包保护、D1 地址五门、限额充值下限 REJECTED）；客户动作 actor 改 CUSTOMER（D3）；requestId 补 17 处（X7）；落地行带 from/to（X9）；费率审计主体归 levelCode。
- 法二：地址 / 费率 / 限额三张迁移表（D13、F、L ⑦）。
- 治疗单：W1 mock 余额、W3 CISO 读权、W6 幽灵节、W13/D7 按钮门控与后门入 ⚡ 区、D2 取消入口、D6 侧栏权限、D17 倒计时、三处"提交后无待批态"（X6）、费率 REJECTED 筛选与中文侧栏、客户端提现页假规则文案、W5 语义（业主定）。
- 判据与剧本：`verify:act1` 扩 V3 判据（§六 25 条择要）、`MAKER_GROUP_BY_POLICY` 补四条（X3）、"裁决人必须能读裁决对象"静态判据（X5）、`verify:rbac` V3 端点探针；站 2/4/5 定稿；"合并进 main 必须重启 + sync"入章程（X2 → TOOLING-DEBT）。**出口：第七幕能拉出第一幕后半每个动作，判据网对 V3 全绿。**

## 附 · 否定结论复核记录

主会话用两种搜法复现并采信：W1 `adjust()` 零调用｜W6 `DEPOSIT_COLLECTION` 仅一处文案｜W9 `/balance` 端点前端零调用、`/dashboard/treasury` 零指向、`SYSTEM_ACTOR` 单定义｜D2 客户端零 DELETE｜D5 零 reactivate/unsuspend｜D11 剧本零"跳过/冷却"、data.md 零地址种子｜D 退役候选 `lazyActivateForCustomer` 仅定义｜A15 四字段零读取（两种搜法）｜A `.catch(`/`forwardRef` 零、`contractAddress` 表单零｜A5/L-Q3 种子直写 `status:'ACTIVE'`（`seed.business.ts:124,135,190,203,218`）｜L-R1 admin-web 零 POST 建规则｜F-Q8 `seed.business.ts` 零处 `requiredTags`｜F-Q10 主库 3 条 `SWAP_FEE_LEVEL_CREATION` 残留行（两条 UUID entityRef、一条 verify:rbac 探针）+ 3 行退役裸名审计。未复现即不采信的：W11/W12、D9/D10/D16、F-Q1/F-Q2/F-Q11/F-Q12/F-Q14（代码卫生级，判色未依赖它们）。
