# 系统一页纸（overview）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-09-26（战役甲波二：报送台骨架落地，14 域 68 桶）；此前 2026-09-25（战役甲波一：事故分类十类终盘，13 域 66 桶）；此前 2026-09-14（波五「订单可见面」：swap FROZEN 5 态 7 边、13 域 62 桶）｜ agent 首读文档

## 0. 这是什么系统

虚拟币 / 法币 broker-dealer 演示系统：客户完成开户合规后，**充值 → 兑换 → 提现**，全程被合规筛查（Sumsub）、审批治理（maker/checker）、复式账本（实时 1:1 记账）和对账覆盖。三个使用面：客户端（3002）、管理台（3001）、后端 API（3000）。外部依赖——Sumsub 合规、链上、银行——**全部是模拟的**（详见 `demo/simulated-externals.md`）。

## 1. 十个模块与依赖

| 模块 | 管什么 | 一句话 |
|---|---|---|
| V1 治理底座 | 审批 / 审计 / RBAC / 管理员生命周期 / 事故登记 | 谁能做什么、做过什么都查得到；出了大事怎么登记、怎么担、怎么报 |
| V2 客户与合规 | 客户档案 / 生命周期轴 / 限制与标签 / 材料账 | 客户是谁、能不能交易（开户/风评一期已拆待重做） |
| V3 财务配置 | 资产 / 网络 / 钱包地址行 / 提现地址簿 / 费率 / 限额 | 交易的静态参数从哪来（上币随版本装载） |
| V4 充值 | 客户入金全流程（KYT 筛查、冻结处置、没收/退回/上缴） | 钱怎么进来 |
| V5 提现 | 客户出金全流程（10 态状态机、审批门、补料） | 钱怎么出去 |
| V6 兑换 | 币币/法币兑换（四腿记账、合规裁决） | 钱怎么换 |
| V7 财资 | 公司自有资金 + 内部划转单（公司 → 客户补款 / 垫款，2026-09-05） | 公司的钱怎么给客户 |
| V8 对账 | 账本 vs 外部余额核对、破口分案处置、补单回业务域 | 账对不对得上 |
| V9 监管报送 | 事故通报 / 监管来函应答 / 重大变更等对外报送单据，六态状态机 + 高管签发 | 跟监管交差记录在哪（2026-09-26 战役甲波二） |
| 共享域 | 账本（TigerBeetle 复式记账）/ 资金单（物理转账镜像）/ Sumsub 接入 | 三条交易流程共用的地基 |

依赖：V1+V2+V3 是地基；V4/V5/V6 是三条平行的交易流程；V8 在事后核对；V9 挂在 V1 治理域的事故登记之后（一码一单自动开）；账本与资金单被三条流程共用。

## 2. 资金从入到出（全景）

```
客户充值（链上/法币） ──► 客户钱包（账本贷记客户应付）
                              │
                              ▼ 兑换（卖出腿+买入腿+费腿，四腿就地记账）
                              │
                              ▼ 提现（本金腿+费腿）──► 客户收款地址/账户
公司收入：各流程费腿 ──► 公司费用户（FIRM）
```

每一步都是同一个节拍：**状态机推进 + 资金单（物理转账 1:1 镜像）+ 账本记账（实时、逐腿）+ 审计留痕**。异常结局（冻结、没收、退回、上缴、解冻）走 maker/checker 审批后同样记账、同样留痕。对账引擎（V8）事后核对账本与外部余额，破口开案。

## 3. 四类业务键

| 类 | 键 | 用途 |
|---|---|---|
| 客户 | `customerNo` | 客户对外唯一识别 |
| 订单 | `depositNo` / `withdrawNo` / `swapNo` | 三域交易单号 |
| 资金单 | `fundsOrderNo` | 物理转账镜像单号 |
| 治理 | `approvalNo` / `caseNo`（对账另有 `runNo`） | 审批单与案件号 |

铁律：对外识别一律用业务键，不用内部 id；管理台不暴露 UUID。

## 4. 权限包拆分（14 域 68 桶）

角色可随时在管理台创建，所以**不做角色矩阵**；稳定的是**权限包**（PermissionGroup）——角色由包组合出来，SoD（职责分离）靠包的边界演示。2026-08-31 第一幕职权重划后，权限包目录按**域**（Domain）组织，**14 域、68 桶、零空域**（每个域至少一个桶——此前 15 域仅 6 域有桶，9 个空壳域已铺满或整域退役；2026-09-06 平账三期新增 `Incident Register` 域，12→13 域、56→58 桶；58→60 桶为第二幕客户域波二「入驻准入核准」、波三「档位升级准入」两波各加一桶；60→62 桶为波五 swap FROZEN 中间态翻案新增「提解冻」「提拒退」两桶，Trading 域 17→19 桶；62→66 桶为 2026-09-25 战役甲波一事故分类十类终盘——`Incident Register` 域从 2 桶拆到 6 桶：原「登记与处置事故」一桶按事故所属族拆成四桶「登记与管理 FUNDS/TECH_SECURITY/DATA/OPERATIONS/FINANCIAL 族事故」各自独立经办组，事故类型从四类（含人工登记 `MANUAL`）扩到十类，`MANUAL` 退役、新增 `CYBER_BCDR`/`DATA_BREACH`/`OUTSOURCING_FAILURE`/`ASSET_NONCOMPLIANCE`/`STUCK_TRANSACTION_MAJOR`/`PRUDENTIAL_BREACH`/`COMPLAINT_ESCALATION`（后者未启用，波五占位）；结案审批由两条链扩到四条链（安全 SECURITY / 财务 FINANCIAL / 技安 TECHSEC / 审慎 PRUDENTIAL）；**66→68 桶为 2026-09-26 战役甲波二报送台骨架**——新增 `Regulatory Filings` 域两桶（`filings.view`/`filings.desk`），13→14 域；事故通报单槽退役，六个过程列改由报送台新主体接手，详见下方「Regulatory Filings」行）：

| 域 | 桶 | 说明 |
|---|---|---|
| Auth | Base Access（强制开，不可关） | 登录管理台的底权，1 桶 |
| Identity & Access（IAM） | 查成员 / 查角色与目录 / 管成员 / 授角色 / 管凭据 / 定义角色 | 6 桶；「授角色」由 CISO 与技术官双持（2026-09-04 业主拍板加授技术官，解开角色绑定变更的自批死锁），但**裁决人仍唯 CISO**——技术官能提不能批 |
| Approval Center | 查审批 / 查审批策略 / 改审批策略 | 3 桶；「改审批策略」标 `restricted`，**高管与 CISO 两人持有**（`GOV_APPROVAL_POLICY_WRITE`）——高管提、CISO 批，两人分立才有 maker≠checker |
| Audit Center | 查日志 / 查证据包 / 建证据包 | 3 桶 |
| Accounting | 查科目 / 查凭证 / 查流水 | 3 桶，全只读；手工开账本科目已退役（业主定「账本没有手动配置这回事」），开户随资产随版本装载时自动建（`prisma/seed.business.ts` 的 `seedAssets` 逐资产调 `ensureTbAccountRegistry`；资产上架那条路 2026-09-04 V3 波一已退役） |
| Treasury | 查资产 / 暂停恢复资产 ｜ 查钱包地址行 ｜ 查/管提现地址 ｜ 查/管限额 ｜ 查内部划转 / 发起补款 · 垫款 | 9 桶；「暂停 / 恢复资产」独属运营，「管提现地址」独属金库专员；钱包地址行只从种子来、管理台只读 |
| Customer Management | 查客户 / 改档案与标签 / 开限制 / 解限制 / 提准入核准 / 提档位升级准入 | 6 桶；开/解限制故意分离两个包；后两桶均是运营发起、高管单步批的准入类审批（2026-09-07 波二「提准入核准」、2026-09-08 波三「提档位升级准入」） |
| Trading | 查充值/提现/兑换/Sumsub 回调（4）｜ 充值：放行低于下限/提没收/提退回/提上缴/提解冻（5）｜ 提现：建单与报价/退票/提裁决退款/提解冻（4）｜ 兑换：处理兑换/提解冻/提拒退（3，后两桶 2026-09-14 波五新增，见下）｜ 平账补单三路：充值补录/退汇认领/退回认领（3，2026-09-03 平账 B 批） | 19 桶，按具体动作拆到底，不用笼统的"处置"——提没收与提解冻不是同一件事，更不该同属一包 |
| Funds Orders | 看资金单 / 推资金单 | 2 桶；看得到 ≠ 推得动，这条 SoD 靠 VIEW/ACT 分家 |
| Reconciliation | 看跑批/案件/外部余额 / 触发跑批 | 2 桶 |
| Incident Register | 看事故 / 登记与管理 FUNDS 族 / TECH_SECURITY 族 / DATA 族 / OPERATIONS 族 / FINANCIAL 族事故（各族独立经办组，动作均含登记 / 调查 / 定损 / 通报 / 挂善后单 / 提结案 / 撤回）| 6 桶（2026-09-06 平账三期新增，原 2 桶；2026-09-25 战役甲波一按族拆到 6 桶）；十类登记（`UNAUTHORIZED_OUTFLOW`/`LARGE_UNEXPLAINED`/`CLIENT_SHORTFALL`→FUNDS 族 ｜ `CYBER_BCDR`/`OUTSOURCING_FAILURE`→TECH_SECURITY 族 ｜ `DATA_BREACH`→DATA 族 ｜ `ASSET_NONCOMPLIANCE`/`STUCK_TRANSACTION_MAJOR`→OPERATIONS 族 ｜ `PRUDENTIAL_BREACH`→FINANCIAL 族 ｜ `COMPLAINT_ESCALATION` 未启用，波五占位；原人工登记 `MANUAL` 已退役），全程零账务，结案走四条审批链（见 `modules/v1-governance.md` §7）；「该不该通报」判定仍在这里，通报的过程搬去下一行 |
| Regulatory Filings | 看报送单 / 经办报送台（开单 / 起草 / 送签 / 标已提交 / 往来记录 / 办结 / 作废） | 2 桶（`filings.view`/`filings.desk`，2026-09-26 战役甲波二新增）；单经办组（合规官独占写权），对外提交前必经高管单步签发（`REG_FILING_SUBMIT`）；事故 `reportRequired=true` 时按依据码自动开单，一码一单，详见 `modules/v9-regulatory-filing.md` |
| Pricing | 查费率 / 改费率 | 2 桶；「改费率」现独属财务负责人（原运营持有，2026-08-30 起改判防自批死锁；2026-09-04 起涵盖创建 / 变更 / 退役三种单） |
| Demo Instruments | 喂裁决 ⚡ / 拨钟 ⚡ | 2 桶；站在 Sumsub 那一侧的模拟能力，不是我方职务的业务能力，单独成域 |

**例外（有路由、不进桶目录）**：`TRADING_DEPOSIT_WRITE` 挂在客户端 `/deposit-transactions/my/inbound-signals*` 两个 URL 上（客户信号入口，非管理端能力，故意不进目录、不绑任何角色）。

### 十一个职务与其独有动作

| 职务 | 独有动作（该桶所需权限组全系统仅此职务持有）|
|---|---|
| SUPER_ADMIN（超管） | 全部——应急账号，不用于日常演示 |
| SENIOR_MANAGEMENT_OFFICER（高管） | 无独有权限包——身份体现在**裁决人**位：限额规则创建/变更、大额提现放行、管理员停用/恢复、上缴第一步、**事故结案审慎类（`PRUDENTIAL_BREACH`）单步裁决人**（2026-09-25 战役甲波一新增，见 `modules/v1-governance.md` §7）、**报送台对外提交前的单步签发裁决人**（`REG_FILING_SUBMIT`，2026-09-26 战役甲波二新增，随之持 `REG_FILING_READ`，见 `modules/v9-regulatory-filing.md`）。⚠️ 审批策略变更他是**提单人**（持 `GOV_APPROVAL_POLICY_WRITE`），裁决人是 CISO |
| CISO | 授角色（`IAM_ROLE_ASSIGN`）——2026-09-04 起与技术官双持，但**裁决人仍唯 CISO**；另是角色定义创建/修改、成员邀请、资产暂停/恢复、**审批策略变更**的裁决人（资产上架与托管钱包创建两条路 2026-09-04 V3 波一已退役，CISO 不再有这两个裁决位）；**事故结案技安类（`INCIDENT_CLOSE_TECHSEC`）单步裁决人**（2026-09-25 战役甲波一新增），随之持 `INCIDENT_READ`（裁决人要看得见事故留痕才能批）。⚠️ 管理员停用/恢复的裁决人是**高管**，不是 CISO |
| MLRO | 无独有权限包——身份体现在充值/提现解冻、部分限制解除的**裁决人**位；事故结案安全类审批两步（`INCIDENT_CLOSE_SECURITY`，2026-09-06 平账三期新增）的**第一步裁决人** |
| DPO | **事故 DATA 族经办组独持**（`INCIDENT_DATA_WRITE`，2026-09-25 战役甲波一新增）——登记 / 调查 / 定损 / 挂客户通知留痕 / 提结案 `DATA_BREACH`（个人数据泄露）事故；此外数据保护监督，读权限与内审/合规重叠 |
| INTERNAL_AUDITOR（内审） | 无独有权限包——**28 组里零 Manage、零业务 Act**；唯一的写是「建证据包」（`AUDIT_EXPORT_CREATE`，监管上门他得能打包），且导出仍要 MLRO 背书。独有性正是"不能动手"；2026-09-26 战役甲波二起补持 `REG_FILING_READ`（要看得见报送台，见 `modules/v9-regulatory-filing.md`），仍是只读 |
| COMPLIANCE_OFFICER（合规官） | 改客户档案与标签、提充值解冻、提提现解冻、**提兑换解冻**（2026-09-14 波五新增）、⚡ 喂裁决（4 项）——管理台里推不动任何交易单，但持 ⚡；**报送台唯一经办人**（`REG_FILING_WRITE`，2026-09-26 战役甲波二新增：开单/起草/送签/标已提交/往来记录/办结/作废全在他手上，对外提交须高管另批），随之补持 `INCIDENT_READ`（起草通报须读得到事故详情，见 `modules/v9-regulatory-filing.md`） |
| CFO（财务负责人） | 改费率（提现/兑换两族费率写权限，全系统唯一）；充值没收的裁决人；**平账一切审批的裁决人**（调账单四族 + 核销 + **补单三路复核** + **补款 / 垫款划转**，2026-09-02 起，原运营；补单三路为 2026-09-03 平账 B 批新增，补款 / 垫款划转为 2026-09-05 平账二期新增）；事故结案审批**安全类两步的第二步 + 财务类单步**裁决人（`INCIDENT_CLOSE_SECURITY`/`INCIDENT_CLOSE_FINANCIAL`，2026-09-06 平账三期新增；⚠️ 2026-09-25 战役甲波一新增技安/审慎两条链后，CFO **不再是事故结案唯一裁决人**，见 CISO/高管两行）；**事故 FINANCIAL 族经办组独持**（`INCIDENT_FIN_WRITE`，2026-09-25 战役甲波一新增）——登记 / 调查 / 定损 / 提结案 `PRUDENTIAL_BREACH`（审慎/NLA 缺口）事故（自己开、高管批，不自批） |
| TREASURY_OFFICER（金库专员） | 管提现地址（暂停 / 恢复 / 跳过冷却）——钱往哪提归他；钱包地址行只读；**发起补款 / 垫款**（案子上，2026-09-05 平账二期）；**事故 FUNDS 族经办组独持**（`INCIDENT_WRITE`，2026-09-10 对账平账两角色定案起独持、运营清零）——登记 / 调查 / 定损 / 通报 / 挂善后单 / 提结案 `UNAUTHORIZED_OUTFLOW`/`LARGE_UNEXPLAINED`/`CLIENT_SHORTFALL` 三类事故，不再借道认损开单 / 发起补款两个既有通道旁敲；**⚠️ 2026-09-25 战役甲波一起该组只是十类里的一族**——事故域整体已按五族经办组（FUNDS/TECH_SECURITY/DATA/OPERATIONS/FINANCIAL）拆到金库 / 技术官 / DPO / 运营 / CFO 五个职务各管一族，不再是金库独占整个事故域 |
| TECH_OFFICER（技术官） | 无独有权限包——资产管控 2026-09-04 起划归运营，此前唯一的独有包随之退役；IAM 侧仍是邀请成员 / 定义角色 / 重置凭据的提单人，2026-09-04 起加授角色（`IAM_ROLE_ASSIGN`），但四项均与 CISO 双持、CISO 才是裁决人——加授角色正是为解开角色绑定变更审批曾经的自批死锁；**事故 TECH_SECURITY 族经办组独持**（`INCIDENT_TECH_WRITE`，2026-09-25 战役甲波一新增）——登记 / 调查 / 定损 / 通报 / 提结案 `CYBER_BCDR`/`OUTSOURCING_FAILURE` 两类事故，结案裁决人是 CISO，不自批 |
| OPS_OFFICER（运营） | 管限额、暂停/恢复资产、放行/没收/退回/上缴充值、建提现单与退票/裁决退款、处理兑换、**提兑换拒退**（`SWAP_REFUND_WRITE`，2026-09-14 波五新增）、**发起补单**（三路：充值补录 / 退汇认领 / 退回认领，2026-09-03 平账 B 批）、**提准入核准**（EDD 高风险客户入驻放行，2026-09-07 波二新增，此前遗漏未记入本行）、**提档位升级准入**（BASIC→PREMIUM，2026-09-08 波三新增）——日常动钱的手，唯独没有任何 `*_UNFREEZE_WRITE`；不再是平账审批的裁决人（改 CFO）；推资金单 / 跑对账批次 / ⚡ 拨钟（`DEMO_CLOCK_WRITE` 等，2026-09-08 起分批迁出、2026-09-10 对账平账两角色定案收官）整组归金库，运营只留 `FUNDS_ORDER_VIEW` 只读；**⚠️ 2026-09-25 战役甲波一新增事故 OPERATIONS 族经办组独持**（`INCIDENT_OPS_WRITE`）——登记 / 调查 / 定损 / 挂资产暂停引用 / 提结案 `ASSET_NONCOMPLIANCE`/`STUCK_TRANSACTION_MAJOR` 两类事故，事故域运营不再是整体归零，而是拆出这一族重新持有 |

矩阵头条（机器验证 + 行为探针双证，判据在 `scripts/verify-rbac.ts`——S1/S2 静态、S5 家族守自批死锁与 maker≠checker、47 条行为探针逐条打真端点）：解冻只在合规官提、**MLRO 裁决**（与财务无关；财务的裁决位是充值没收） ｜ 费率改动只在财务 ｜ 提现地址只在金库专员 ｜ 资产暂停 / 恢复只在运营 ｜ 授予角色提单在 CISO 与技术官、**裁决唯 CISO** ｜ 内审 28 组零 Manage、零业务 Act（唯一的写是建证据包）｜ 合规官推不动任何交易单但持 ⚡ ｜ 推资金单与跑对账批次只在金库 ｜ 平账审批只在 CFO（金库开单 / CFO 裁决两角色分立）｜ 事故登记按族分权，五族各一名独占经办人（金库/技术官/DPO/运营/CFO），跨族既登不了也批不了（路由层五桶 OR 是粗门，服务层按族独占能力码 `cap.incident.*` 才是真正把关，2026-09-25 战役甲波一）｜ **报送台经办唯合规官、对外提交前签发唯高管**（`REG_FILING_WRITE`/`REG_FILING_SUBMIT`，maker≠checker 两角色天然分立，2026-09-26 战役甲波二）。

> 包与桶的权威清单在代码 `src/modules/identity/access-control/rbac.catalog.ts`（`PermissionGroup` 类型 76 个、`ACTION_BUCKET_CATALOG` 14 域 68 桶、`RBAC_ROLE_GROUP_BINDINGS` 11 职务）；本节是其业务口径快照，权限点变动时由 agent 同步。

## 5. 关键技术节点（overview 级）

- 后端模块根 `src/modules/`：trading（三域交易，`trading/shared/` 存三域公共纯函数工具 + fee-level 公共基类，2026-09-13 波四共享抽离）、identity（客户+IAM）、governance（审批 / 事故登记 `governance/incidents/`，2026-09-06 平账三期 / 监管报送 `governance/regulatory-filings/`，2026-09-26 战役甲波二——新主体 `RegulatoryFiling`，横向只读事故域、事故域横向只读它，两域各自唯一写点）、asset-treasury（资产钱包）、accounting（账本）、clearing-settle（对账）、audit-logging、funds-orders、deposit/swap/withdraw-sumsub + sumsub-ingestion（合规接入）+ sumsub-shared（充提两域 SLA/KYT裁决落地/demo 场景公共基类，兑换域独立演进不参与，2026-09-13 波四共享抽离）
- 内部划转 `asset-treasury/internal-transfers/`（第四类订单，2026-09-05 平账二期，详见 `modules/v7-treasury.md`）
- 客户档位升级 `identity/tier-upgrade/`（2026-09-08 第二幕客户域波三，详见 `modules/v2-customer-compliance.md`）：申请→补料→高管准入核准→`tradingTier` BASIC→PREMIUM 单向翻转；同批接上 TB 客户账本户运行时开户钩子（挂客户首次进 ACTIVE，此前只有种子脚本会开户）
- 状态机：各域 service 内显式迁移表（如 `withdraw-transactions.service.ts` 的 10 态 23 边、`swap-transactions.service.ts` 的 5 态 7 边——2026-09-13 波四共享抽离清除 `FAILED`/`REVERSED` 两个不可达死枚举后，兑换域枚举与可达状态数首次一致；2026-09-14 波五 FROZEN 从零出边终态翻案为押锁不放的中间态，补 `RESUME`/`REJECT_REFUND` 两条出边，5 边→7 边，见 `modules/v6-swap.md` §2）；工作流（`*-workflow.service.ts`）串主体
- 账本：TigerBeetle 复式记账，9 码科目表，实时 1:1 逐腿 post；对账引擎在 `clearing-settle`
- 权限：`rbac.catalog.ts` 集中登记端点 × 权限包
- 两级门：**L1** = 平台内所有限制条件的判断（`L1GateService` 十项，三域共用），**L2** = Sumsub 合规判断；`OPERATION_PENDING` 只能从 L2 通过进入

## 6. 演示缺口

待 Phase 3 各模块文档就位后按模块汇总；当前看 `BACKLOG.md`。
