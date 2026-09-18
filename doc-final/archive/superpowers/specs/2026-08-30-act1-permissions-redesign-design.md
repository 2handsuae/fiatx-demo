# 第一幕 · 开业：职权重划与退役

> 范围：V1 治理底座 + V3 财务配置 ｜ 起因：第一幕的台词「谁能做什么是拼包拼出来的」在管理台上兑现不了
> 业主批注：2026-08-30 五轮 ｜ 现状取自 `rbac.catalog.ts` / `approval.constants.ts` / `sumsub-ingestion.service.ts` 实证

## 0. 决策记录

| # | 决定 | 谁定 |
|---|---|---|
| D1 | 铺满空权限域 **并且** 重定 8 职务开箱权限（不走「只铺 UI」的窄档） | 业主 |
| D2 | 五本档案簿 + 监管闸门 + 对手方（LP／流动性配置）**整块退役，删代码**；「需要时候再说」 | 业主 |
| D3 | `config` / `clearing` 两个空域一并退役 | 业主 |
| D4 | 第一幕保持 **5 站**，档案簿不进演示 | 业主 |
| D5 | 管理台首页 `Wave8OpsDashboardPage` 退役 → **空白占位页**，「这页以后再优化」 | 业主 |
| D6 | 价格配置中心 = 现有两个费率页（甲），**不新建价源／点差管理面** | 业主 |
| D7 | 提审批单 / 裁决审批单 **不设权限包**——提单权跟具体功能走，裁决权跟审批策略走 | 业主 |
| D8 | 开账本科目不给任何职务，走开发流程 | 业主 |
| D9 | 投资者分类覆写退役；`RISK_DECISION_RECORD_*` 名不副实，**页面留下瘦成只读** | 业主提出退役，实证后收窄 |
| D10 | 交易域按**具体动作**拆包，不用笼统的「处置」 | 业主 |
| D11 | 解冻 = **合规官提 → MLRO 批**；没收 = **运营提 → 财务负责人批** | 业主 |
| D12 | 限额（`/admin/assets/transaction-limits`）**归运营**；裁决人随之改高管 | 业主定归属，裁决人为本稿建议 |
| D13 | 金库专员职务保留 | 业主 |
| D14 | 平账调账单本轮不放权限包（代码尚不存在） | 本稿建议 |

**不翻案**：合规官在管理台**不推动任何交易单据**——单据的合规裁决全部来自 Sumsub 回调（⚡ 面板即其模拟器）。

---

## 1. 定位与边界

### 1.1 病根

第一幕两句台词：① 谁能做什么是拼包拼出来的；② 改任何配置都过审批门。第 ② 句成立，第 ① 句在数据和界面上双双落空：

- **数据层**：`RBAC_ROLE_GROUP_BINDINGS`（`rbac.catalog.ts:875`）里 8 个职务**无一持有** `TRADING_*` / `CUSTOMER_RESTRICTION_WRITE` / `RECON_RUN_WRITE`。三条交易流程、客户限制、对账跑批**只有超管能操作**。
- **界面层**：`ACTION_BUCKET_CATALOG`（`:671`）15 域中 9 域 `buckets: []`，前端 `RoleDetailPage.tsx:228` 过滤掉无包域——这 9 类**根本不出现**，统计还写着「可见域 / 6」。

### 1.2 三处会咬人的结构缺陷（本轮必须一起修）

| # | 缺陷 | 证据 | 后果 |
|---|---|---|---|
| B1 | **15 个权限组有绑定、无桶** | `RoleDetailPage.tsx:271-276` 提交时只从「有包的域」收集权限组 | 改一次角色即**静默丢弃**这些组。含 `GOV_APPROVAL_DECIDE`——站 1 演完「改角色包→审批→生效」，该角色的裁决权当场消失 |
| B2 | **裁决权双闸会漂** | `approvals.service.ts:701-705`（approve）/`:817-821`（reject）已按 policy `step.roles` 校验并抛错 | 策略点名某职务、它却没 `GOV_APPROVAL_DECIDE` 包 → 批不了且查不出原因 |
| B3 | **资金单看与推同一个包** | `rbac.catalog.ts:639-644`：list／detail／advance／push-sync／push-manual 全挂 `INTERNAL_FUND_READ` | `v1-governance.md` 讲 SoD 的原话「看得到资金单 ≠ 推得动资金单」今天是假的 |

### 1.2.1 B1 那 15 个组的去向（本轮全部落地）

| 组 | 去向 |
|---|---|
| `GOV_APPROVAL_DECIDE` `GOV_APPROVAL_WRITE` | 退役（D7） |
| `GOV_REGISTRY_READ/WRITE` `GOV_REGULATORY_GATE_READ/WRITE` | 随模块退役（D2） |
| `MLRO_REVIEW_WRITE` | 退役（零路由） |
| `RISK_DECISION_RECORD_WRITE` | 退役（D9） |
| `RISK_DECISION_RECORD_READ` | 改名 `SUMSUB_EVENT_VIEW`，进 trading 域「看 Sumsub 回调事件」桶 |
| `SWAP_FEE_LEVEL_READ/WRITE` `WITHDRAWAL_FEE_LEVEL_READ/WRITE` | 进新建 pricing 域两个桶 |
| `IAM_READ` `IAM_ASSIGN` | 退役（历史别名，见 §2.3） |

**验收 V2 的判据即此表**：改完后「有绑定无桶」的组必须为 **0**。

### 1.3 三处自批死锁（业主未察觉，本轮实证发现）

| 动作 | 裁决人（策略） | 唯一可能的提单人 | 结果 |
|---|---|---|---|
| 费率等级变更 | `OPS_OFFICER` | 运营（唯一持费率写权限者） | 自批被拒，**第一幕走查②今天跑不通** |
| 充值没收 | `OPS_OFFICER` | 运营 | 同上（`demo-lib.ts:692` 用两个合成演员绕过） |
| 限额规则创建／变更 | `OPS_OFFICER` | 按 D12 归运营后即撞 | 同上 |

### 1.4 本轮做 / 不做

**做**：退役四块 + 权限域重划 + 11 职务矩阵 + 两条审批策略改裁决人 + 第一幕 5 站剧本落文档 + 管理台首页占位。

**不做**（对照 CLAUDE.md §2 与业主口径）：
- V3 配置域审计词汇入册（第七幕断点，约 60 写点的改名工程）→ 单独排一站
- 平账调账单权限包 → 代码不存在，等其落地那轮
- 价源／点差管理面 → D6 明确不建
- 任何幂等／重试／并发／兼容层

---

## 2. A 部分 · 退役

### 2.1 三块业务模块（约 1 万行 + 9 表）

| 块 | 后端 | 前端 | 表 |
|---|---|---|---|
| 五本档案簿 | `src/modules/governance/registries/`（2512 行） | `GovernanceRegistry{List,Detail,Create,Edit,Form}Page.tsx` + `governanceRegistry{,Form}Config.ts`（1600 行） | `ShareholdingRegistryVersion` `ShareholdingRegistryParticipant` `AppointmentRecord` `TrainingRecord` `ConflictDisclosure` `WindDownMaterialRecord` |
| 监管闸门 | `src/modules/governance/regulatory-gates/`（1810 行） | `RegulatoryGate{List,Detail,Create}Page.tsx`（1359 行） | `RegulatoryGateItem` |
| 对手方 | `src/modules/counterparty/`（1027 行） | `LiquidityProvider{List,Create}.tsx` `LiquidityConfig{List,Create,Edit}.tsx`（1267 行） | `LiquidityProvider` `LiquidityConfiguration` |

**外部依赖仅 7 处注册点**：`governance.module.ts` ｜ `app.module.ts` ｜ `rbac.catalog.ts`(+spec) ｜ `audit-actions.constant.ts` ｜ `App.tsx`（lazy import + 24 条路由，`:343-546` / `:685-714`）｜ `DashboardLayout.tsx`（`:355-410` 注释块）｜ `Wave8OpsDashboardPage.tsx`。

**审批策略零引用、seed 零种子**——演示里本来就是空的，退役对现有六幕零影响。

⚠️ **「对手方」一词有两义，只退一个**：要退的是流动性提供商 / LP 报价配置。三条交易流程里的 `SANCTION_COUNTERPARTY`、KYT 对手方地址、制裁分主体那套是第三幕正题，**一行不动**。

### 2.2 管理台首页（D5）

`App.tsx:196` 与 `:602` 两处 index 路由指向 `Wave8OpsDashboardPage`，该页两块面板：一块打已删的 `/admin/reimbursement-obligations`（当前即 404），一块是本轮退役的监管闸门。整页退役，`/admin` 换成空白占位页（一句「请从左侧菜单开始」），前端权限常量 `REIMBURSEMENT_OBLIGATIONS_READ` 一并清。

### 2.3 权限组退役（30 组）

**零路由注册（16）**：`CDD_REVIEW_WRITE` `CLEARING_READ` `CLEARING_WRITE` `JOURNAL_READ` `MLRO_REVIEW_WRITE` `ONBOARDING_READ` `PAYIN_READ` `PAYIN_WRITE` `PAYOUT_READ` `PAYOUT_WRITE` `RECON_OUTSTANDING_READ` `SETTLEMENT_READ` `SETTLEMENT_WRITE` `TX_COMPLIANCE_READ` `TX_COMPLIANCE_WRITE` `CUSTOMER_RATE_WRITE`

> `MLRO_REVIEW_WRITE` 现挂在 MLRO 身上却零路由——**MLRO 的「专属权限」什么也不管**，他真正的裁决权来自 `approval.constants.ts` 点名 `roles: ['MLRO']` 的审批步骤。

**幽灵路由组（1）**：`CUSTOMER_RATE_READ` —— 5 条 `/admin/pricing/policies*` + `/admin/pricing/simulator/swap`（`rbac.catalog.ts:252-261`），pricing-center 只剩引擎，端点不存在。路由一并删。

**随模块退役（6）**：`GOV_REGISTRY_READ/WRITE` `GOV_REGULATORY_GATE_READ/WRITE` `COUNTERPARTY_READ/WRITE`

**按 D7 退役（2）**：`GOV_APPROVAL_WRITE` `GOV_APPROVAL_DECIDE`
- `GOV_APPROVAL_WRITE` 守 `/admin/control-gates/approvals` 建案／提交／取消三条**通用**端点，前端全仓零调用（功能性 workflow 各自建案）→ 三条路由一并删
- `GOV_APPROVAL_DECIDE` 守 approve／reject 两条 → 改挂 `GOV_APPROVAL_READ`，谁能批完全交给策略（B2）

**按 D8 / D9 退役（3）**：`LEDGER_ACCOUNT_WRITE`（+`POST /admin/tb/accounts`）｜ `INVESTOR_OVERRIDE_WRITE`（+`PATCH /admin/compliance/customers/:id/investor-classification`）｜ `RISK_DECISION_RECORD_WRITE`

**遗留别名（2）**：`IAM_READ` `IAM_ASSIGN` —— 实证 15 条路由上**每一条都与细粒度组成对出现**（`rbac.catalog.ts:202-221`），无任何路由以它们为唯一守卫，是纯历史别名。从路由与 bindings 一并摘除，B1 的 15 个「有绑定无桶」组由此清零。

### 2.4 Sumsub 事件页：留页面、瘦成只读（D9 收窄）

**业主原假设「只服务客户入驻」不成立**。`sumsub-ingestion.service.ts:134-163` 实证：全部 `KYT_VERDICT_TYPES` 回调先落 `SumsubWebhookEvent`，再级联分发 deposit → withdraw → swap，`dispatchedTo` 记录归属；材料请求审核（`applicantActionReviewed`）亦走此表。**随一期客户流程拆掉的恰恰是申请人级入驻分支**（Clue 4/4.5/5，现只落 `unrouted_sumsub_webhook` 警告）。

它是三域「外面回调了什么进来、分给了谁」的唯一窗口——⚡ 按一下即多一行。

| 路由 | 处置 | 理由 |
|---|---|---|
| `GET /admin/sumsub-events` | **留**，权限组改名 `SUMSUB_EVENT_VIEW`，归 trading 域 | 页面唯一活的读端点 |
| `POST /admin/sumsub-events/:id/replay` | 退役 | 「重试与回放」在 CLAUDE.md §2 禁做清单 |
| `POST /admin/sumsub-events/simulate` | 退役 | 前端零调用 |
| `GET /admin/sumsub-events/:id` | 退役 | 前端零调用 |

前端 `SumsubEventsPage.tsx` 去掉重放按钮（`:118`）。

### 2.5 其余幽灵

- `CustodianWalletDetail.tsx:182` 按钮挂 `INTERNAL_COLLECTIONS_RECONCILE`，端点已删 → 删按钮与前端常量
- `PATCH /deposit-transactions/:id/status`、`PATCH /admin/swap-transactions/:id/status` 前端／脚本／测试三处零调用 → **任务内复核零调用后退役**（若 `demo-lib.ts` 实跑依赖则保留，不得为退役改造数脚本）

### 2.6 审计词条

约 44 处相关词条（`SHAREHOLDING_REGISTRY_*` `APPOINTMENT_RECORD_*` `REGULATORY_GATE_*` `TRAINING_RECORD_*` `CONFLICT_DISCLOSURE_*` `WIND_DOWN_MATERIAL_*` `LIQUIDITY_CONFIG` 等）。**走站 7 既有的「退役拒写」名册，不直接删**——保持封册守则「平面表每键有籍」成立，`audit-vocabulary-closure.spec` 必须仍绿。

---

## 3. B 部分 · 权限域重划

**终盘：12 域 / 50 包 / 权限组 80 → 60**（退 30、新增 11、改名 2——`RISK_DECISION_RECORD_READ` → `SUMSUB_EVENT_VIEW`，`SIMULATE_EXPIRED_WRITE` → `DEMO_CLOCK_WRITE`；再退 1——`INTERNAL_FUND_READ` 被 `FUNDS_ORDER_VIEW/ACT` 完全取代后成孤儿，实施期发现并补退，见执行台账 [R3]）。

### 3.1 域与桶

| 域 | 桶 | 变化 |
|---|---|---|
| **auth** 登录 | base_access〔必选〕 | 不变（1） |
| **iam** 身份与访问 | view_members ｜ view_roles ｜ manage_members ｜ assign_roles ｜ define_roles ｜ manage_credentials〔CISO 限〕 | 不变（6） |
| **gov_approvals** 审批中心 | view ｜ policies.view ｜ policies.manage〔限〕 | 不变（3）；**裁决与提单不设包**（D7） |
| **audit** 审计中心 | view ｜ view_exports ｜ create_exports | 不变（3） |
| **accounting** 账本 | view_accounts ｜ view_evidence ｜ view_flows | **−1**（开科目退役，D8） |
| **treasury** 金库与配置 | view/manage × 资产·钱包·地址·限额 | 不变（8） |
| **customer** 客户 | view ｜ manage_profile ｜ **act_restrict** ｜ **act_release** | 新域（4） |
| **trading** 交易 | 见 §3.2 | 新域（14） |
| **funds** 资金单 | view ｜ **act_push** | 新域（2），解 B3 |
| **recon** 对账 | view ｜ **act_run** | 新域（2） |
| **pricing** 费率 | view ｜ manage | 新域（2） |
| **demo** 演示装置 | **act_verdict**（⚡）｜ **act_clock**（拨 SLA／材料过期） | 新域（2） |

**退役域（4）**：`config`（无任何权限组归属）｜`clearing`（四个组零路由）｜`gov_registry` / `counterparty`（随模块走）。

### 3.2 交易域按动作拆到底（D10）

路由本就按动作分好，一条路由一个包：

| 桶 | 路由 | 性质 | 新权限组 |
|---|---|---|---|
| 看充值单 | — | View | `TRADING_DEPOSIT_READ` |
| 看提现单 | — | View | `TRADING_WITHDRAW_READ` |
| 看兑换单 | — | View | `TRADING_SWAP_READ` |
| 看 Sumsub 回调事件 | `GET /admin/sumsub-events` | View | `SUMSUB_EVENT_VIEW`（改名） |
| 放行小额挂起 | `POST /deposit-transactions/:id/waive-limit` | 直接执行 | `DEPOSIT_WAIVE_WRITE` |
| 提没收 | `POST .../:id/confiscate` | 开审批 → **财务** | `DEPOSIT_CONFISCATE_WRITE` |
| 提退回原发款方 | `POST .../:id/return` | 开审批 → MLRO | `DEPOSIT_RETURN_WRITE` |
| 提上缴 | `POST .../:id/seize` | 开审批 → 高管+MLRO | `DEPOSIT_SEIZE_WRITE` |
| **提充值解冻** | `POST .../:id/unfreeze` | 开审批 → MLRO | `DEPOSIT_UNFREEZE_WRITE` |
| 建提现单与报价 | `POST /withdraw-transactions{,/quotes,/mock}` | 直接执行 | `TRADING_WITHDRAW_WRITE`（留名） |
| 提现退票 | `POST .../:id/bounce` | 直接执行 | `WITHDRAW_BOUNCE_WRITE` |
| 提制裁退款 | `POST .../:id/refund` | 开审批 → MLRO | `WITHDRAW_REFUND_WRITE` |
| **提提现解冻** | `POST .../:id/unfreeze` | 开审批 → MLRO | `WITHDRAW_UNFREEZE_WRITE` |
| 处置兑换单 | `POST /admin/swap-transactions` | 直接执行 | `TRADING_SWAP_WRITE` |

> 客户侧 `POST /deposit-transactions/my/inbound-signals{,/scan}` 保留 `TRADING_DEPOSIT_WRITE`。该组**不进桶目录、不进任何角色 bindings**（它不是管理端能力）——这不违反 B1，B1 禁的是「有绑定无桶」。

### 3.3 ⚡ 归合规官

`SimulationPanel.tsx:24-27` 自述两组按钮：「Sumsub 规则引擎自动命中」/「合规官在 Sumsub 台上手工处置」。面板模拟的是外部系统，不是我方后台能力。现挂 `TRADING_*_WRITE`（`:310,336,363`）等于把两件事混成一份权限。

改为 `DEMO_VERDICT_WRITE`，**归合规官**——合规官在我们后台没有任何交易包，于是「合规官推动单据」**只能**经 ⚡（= Sumsub 回调）发生，与 D-不翻案条严丝合缝。拨时钟（`SIMULATE_EXPIRED_WRITE` + 三域 `simulate-sla-timeout`）合成 `DEMO_CLOCK_WRITE`，归运营（运维性质）。

---

## 4. C 部分 · 十一个职务

筛选标准：**每个职务必须能干一件别人干不了的事**，否则是摆设。

| 职务 | 层 | 独有动作 |
|---|---|---|
| `SUPER_ADMIN` 超级管理员 | 应急 | 绕过一切（生产须移除） |
| `SENIOR_MANAGEMENT_OFFICER` 高级管理层 | 监管问责 | 裁决大额提现、**限额规则**、上缴、管理员停用／恢复 |
| `CISO` 首席信息安全官 | 监管问责 | 授予角色；裁决角色定义、资产上架、托管钱包创建 |
| `MLRO` 反洗钱报告官 | 监管问责 | 裁决解冻／退回／上缴／制裁退款／制裁类解限制／审计导出 |
| `DPO` 数据保护官 | 监管问责 | 案件证据包导出第一步裁决 |
| **`INTERNAL_AUDITOR` 内审** ★ | 独立监督 | 唯一持全部 View 包却零 Act 包者——监管上门给这个账号 |
| `COMPLIANCE_OFFICER` 合规官 | 合规运作 | 开／解客户限制；**提充值与提现解冻**；按 ⚡ 扮演 Sumsub 台 |
| **`CFO` 财务负责人** ★ | 财务 | 唯一持费率修改包；**裁决充值没收** |
| **`TREASURY_OFFICER` 金库专员** ★ | 业务运作 | 创建／停用托管钱包、管理提现地址 |
| `TECH_OFFICER` 技术官 | 技术 | 创建与上架资产；提角色定义与管理员邀请 |
| `OPS_OFFICER` 运营专员 | 业务运作 | 放行小额挂起、改限额、推资金单、跑对账批次；裁决费率变更 |

★ = 新增。完整 50×10 矩阵见《职权分工册》：https://claude.ai/code/artifact/096b5ec1-32b5-44db-b3df-a3b9696b7e85

**运营手里没有任何解冻包**——D11 在矩阵上是硬的。

---

## 5. D 部分 · 审批策略改两处

`approval.constants.ts`：

| 策略 | 现裁决人 | 改为 | 理由 |
|---|---|---|---|
| `DEPOSIT_CONFISCATION` | `OPS_OFFICER` | **`CFO`** | 没收 = 客户的钱变公司收入，财务复核；且解开运营自批 |
| `TRANSACTION_LIMIT_CREATION` / `TRANSACTION_LIMIT_CHANGE` | `OPS_OFFICER` | **`SENIOR_MANAGEMENT_OFFICER`** | 限额 = 这家店愿担多大敞口，是高管决定；且高管已批大额提现，定阈值与放超额单归同一人 |

**这是本轮仅有的两处业务口径改动**，其余全靠权限包重排解决。

### 自批验算（18 条，全部成立）

| 动作 | 谁能提 | 谁来批 |
|---|---|---|
| 改角色权限包 / 邀请管理员 | 技术官 · CISO | CISO |
| 停用／恢复管理员 | 技术官 · CISO | 高级管理层 |
| 改审批策略 | 高级管理层 · CISO | CISO |
| 资产激活／暂停／恢复 | 技术官 | CISO |
| 创建托管钱包 | 金库专员 | CISO |
| **改限额规则** | **运营** | **高级管理层**〔策略需改〕 |
| 改费率等级 | 财务负责人 | 运营 |
| 大额提现放行 | 运营 | 高级管理层 |
| **充值没收** | **运营** | **财务负责人**〔策略需改〕 |
| 充值退回 / 提现制裁退款 | 运营 | MLRO |
| 充值上缴 | 运营 | 高管 → MLRO |
| **充值解冻 / 提现解冻** | **合规官** | MLRO |
| 解限制 · 制裁类 | 合规官 | MLRO |
| 解限制 · 行政类 | 合规官 · MLRO | 运营 |
| 审计证据包导出 | DPO · 合规官 · 内审 | MLRO |

### 种子账号

`prisma/seed.base.ts:27-36` 由 8 个扩到 **11 个**（新增 `auditor@` / `cfo@` / `treasury@`，密码沿用 `123456`），一人一角色不变。

---

## 6. E 部分 · 第一幕 5 站剧本

现 `demo/script.md` 第一幕只有 3 步走查，②「现场改一条费率或限额」不指人不指页且**今天跑不通**；而 `v1-governance.md §4` + `v3-financial-config.md §4` 已有 10 步好戏一步未进主线。收敛为 5 站，每站定人定页定预期：

| 站 | 讲什么 | 谁登录 | 动作 | 期望看到 |
|---|---|---|---|---|
| 1 · 谁能动手 | 权力是拼出来的，拼权力本身也过门 | 技术官 → CISO | 成员页 → 角色页看包 → 给运营加一个包 → 提交变审批单 → 换 CISO 批 → 生效 | 能力从「干不了」变「干得了」；改权限自己也是一张单 |
| 2 · 一笔配置要过门 | 配置有身世 | 财务 → 运营 | 费率页改一档 → 换运营批 → 切客户端拿报价 | 报价当场变（直通第四幕） |
| 3 · 门自己也要过门 | 规则不能被规则的管理员悄悄改 | 高管 → CISO；再用同一账号自批 | 改审批策略走审批；自批当场被拒；给 CISO 加 MLRO 被硬互斥拒绝 | SoD 与硬互斥的三次现场拒绝 |
| 4 · 货架 | 上架是有门槛的，不是填个表 | 技术官 → CISO | 资产页新建资产 → 停在 PROVISIONING → 点激活 → 就绪检查报「缺钱包」→ 金库专员建钱包 → CISO 批 → 再激活 | 两道就绪检查；两个人的戏 |
| 5 · 三种门与容器 | 钱放在哪、拦在哪一刻 | 运营 → 高管；切客户端 | 限额三 tab（单笔／累计／大额）→ 改一条走审批；托管钱包页；客户端登记新链上地址看 24h 冷却 vs 首个法币账户即时生效 | 三种门各在哪一刻拦人；冷却闸 |

**审计不设站**（业主口径）：第一幕负责**产证据**，第七幕负责取证。且重铺后新词表零写入，第一幕开演那刻审计页本就是空的。

连带文档：`demo/script.md` 第一幕整段重写；`demo/data.md` 管理员名册 8 → 11；`modules/overview.md` §4 权限包表整节重写；`modules/v1-governance.md` §3/§4/§5、`modules/v3-financial-config.md` §3/§4/§5 同步。

---

## 7. 验收

### 硬闸（CLAUDE.md §7）

- ① `npx tsc --noEmit -p tsconfig.json`
- ②③ `admin-web` / `client-web` `npx tsc -b --noEmit`
- ④ jest：`identity/access-control`、`governance/approvals`、`audit-logging`、三域 trading —— 净新失败 0
- ⑤ 前端起 preview 渲染 + 截图：角色详情页（新域出现）、自定义角色 UI、管理台首页占位、Sumsub 事件页（无重放按钮）
- ⑥ `bash scripts/on-stack.sh main demo:all` 走通并对花名册终态
- ⑦ `verify:coa` —— 本轮不动钱，作回归
- ⑧ **重铺闸**：动了 schema（9 表 drop）→ `bash scripts/stack.sh reset main` 从零建库重铺 → 再跑 ⑥，判据对照 `demo/baseline.md`，净新失败 = 0
- `npm run verify:audit` 恒绿七项不退步；`audit-vocabulary-closure.spec` 绿

### 行为验收（禁止扫源码文本型断言）

| # | 判据 | 怎么验 |
|---|---|---|
| V1 | 8→11 个职务真能各干各的活 | 逐个真登录，调其独有动作的端点得 2xx；调不属于它的 Act 端点得 403 |
| V2 | **B1 已堵** | 对每个内建角色跑一次「改角色」提交并批准，前后 `permissionCodes` 集合**逐一比对无丢失** |
| V3 | **B2 已堵** | 拿一个持 `GOV_APPROVAL_READ` 但策略未点名的职务调 approve → 403/拒；策略点名者 → 通过 |
| V4 | **B3 已堵** | 只持 `FUNDS_ORDER_VIEW` 的角色 GET 资金单 200、POST push → 403 |
| V5 | 三处自批死锁已解 | 真登录跑：财务提费率→运营批；运营提没收→财务批；运营提限额→高管批；合规官提解冻→MLRO 批 —— 四条全通 |
| V6 | 运营碰不到解冻 | 运营账号 POST `/deposit-transactions/:id/unfreeze` → 403 |
| V7 | 合规官推不动交易单 | 合规官调三域任一 Act 端点 → 403；但按 ⚡ 投递裁决 → 单据推进 |
| V8 | 退役彻底 | 全仓 grep 三块模块符号零命中；`/admin` 首页与 Sumsub 事件页无 404（读 network 面板）；自定义角色 UI 中无空域、无死组 |
| V9 | 内审真的只读 | 内审账号遍历所有 View 端点 200，任一 Manage／Act 端点 403 |

---

## 8. 风险与已知代价

- **退役 1 万行不可逆**：要回来就是重写（git 历史仍在）。业主 2026-08-30 明确「现在不知道做什么，需要时候再说」。
- **昨日精修被覆盖**：`6a91a486` 刚退役 `CLIENT_BANK_ACCOUNT_ENABLEMENT`、保留另两种闸门类型；本轮整块退役覆盖该 commit 的精细工作。业主已知悉。
- **`RegulatoryGateItem.walletId` 死列**的 PRODUCTION-NOTES 记录随整表退役销账。
- **三个新职务无历史演示素材**：内审／财务／金库的动作在 `demo:all` 花名册里没有对应笔数，第一幕现场演即可，不改造数脚本。

## 9. 分期建议

三段，段与段之间可停可验，**不建议并段**（后段依赖前段的权限组终盘）：

| 段 | 内容 | 为什么可以独立收尾 |
|---|---|---|
| **一 · 退役** | §2 全部（三块模块 + 首页 + 30 组 + 幽灵路由 + 审计词条退役名册） | 纯删除，删完跑重铺闸⑧即可验；此时权限只减不增，演示画面除首页外零变化 |
| **二 · 权限重建** | §3 + §4 + §5（域与桶、11 职务矩阵、两条审批策略、种子 11 账号） | 段一把地基清干净后一次落定；验收 V1–V7、V9 全在这段 |
| **三 · 剧本与文档** | §6（`demo/script.md` 第一幕 + `data.md` 名册 + `overview.md` §4 + V1/V3 模块文档） | 纯文档，跟着段二的实际终态写，避免写完又改 |

段一若单独合入，`BACKLOG.md` 对应缺口条同批销账；段二合入时 `CHANGELOG.md` 记一行业务口径。

## 10. 待决（不阻塞本轮）

- 限额裁决人定为高管系本稿建议（备选 CISO），业主未明确表态 → 按本稿执行，异议则改一行常量
- `PATCH /deposit-transactions/:id/status` 与 `PATCH /admin/swap-transactions/:id/status` 退役需任务内复核零调用
- 平账调账单落地时同批加 `recon.act_adjust` → 在 `BACKLOG.md` §G 对应条目注一行
