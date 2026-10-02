# 系统一页纸（overview）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-10-02（战役丙波二：成交前披露 + 成交确认单上线，兑换成交后出具并留存一张不可改的确认单（`trade_confirmations`，新增一表、新增主体），客户端详情页出示并可打印；零新权限桶/组（15 域 81 桶 89 组不动）；审计现役码 327→**328**，新增 `CONFIRMATION_ISSUED`）；此前 2026-10-01（战役丙波一：客户触达通知上线，`core/notifications/` 站内消息中心 + 16 发信点（充值/提现/兑换/投诉）+ email 模拟留痕，零新权限桶/组（15 域 81 桶 89 组不动）；审计现役码 326→327）；此前 2026-09-30（战役乙波三：审慎红线与巡检 + 穿底主线收官，`Treasury` 域再加一桶，15 域 80→**81** 桶、88→**89** 组；审计现役码 324→326；兑换腿丙案端点重挂，权限包不增不减）；此前 2026-09-29（战役乙波二：注资·付款·全景看板，`Treasury` 域再加三桶，15 域 77→80 桶、85→88 组；审计现役码 312→324）；此前 2026-09-29（战役乙波一：LP 地基与调拨，`Treasury` 域加两桶，15 域 75→77 桶、83→85 组；审计现役码 296→312）；此前 2026-09-28（战役甲波五：投诉工作流上线，`Incident Register` 域加两桶，15 域 73→75 桶、81→83 组；审计现役码 286→296）；此前 2026-09-27（战役甲波四：闹钟墙 / 合规日历 / 登记册两本，新增 `Compliance Office` 域，15 域 73 桶 81 组）；此前 2026-09-26（战役甲波三：报文族台账与联动，14 域 69 桶 77 组）；此前 2026-09-26（战役甲波二：报送台骨架落地，14 域 68 桶）；此前 2026-09-25（战役甲波一：事故分类十类终盘，13 域 66 桶）；此前 2026-09-14（波五「订单可见面」：swap FROZEN 5 态 7 边、13 域 62 桶）｜ agent 首读文档

## 0. 这是什么系统

虚拟币 / 法币 broker-dealer 演示系统：客户完成开户合规后，**充值 → 兑换 → 提现**，全程被合规筛查（Sumsub）、审批治理（maker/checker）、复式账本（实时 1:1 记账）和对账覆盖。三个使用面：客户端（3002）、管理台（3001）、后端 API（3000）。外部依赖——Sumsub 合规、链上、银行——**全部是模拟的**（详见 `demo/simulated-externals.md`）。

## 1. 十个模块与依赖

| 模块 | 管什么 | 一句话 |
|---|---|---|
| V1 治理底座 | 审批 / 审计 / RBAC / 管理员生命周期 / 事故登记 / 投诉工作流 | 谁能做什么、做过什么都查得到；出了大事怎么登记、怎么担、怎么报；客户投诉怎么受理、怎么裁决、超时怎么升级 |
| V2 客户与合规 | 客户档案 / 生命周期轴 / 限制与标签 / 材料账 | 客户是谁、能不能交易（开户/风评一期已拆待重做） |
| V3 财务配置 | 资产 / 网络 / 钱包地址行 / 提现地址簿 / 费率 / 限额 | 交易的静态参数从哪来（上币随版本装载） |
| V4 充值 | 客户入金全流程（KYT 筛查、冻结处置、没收/退回/上缴） | 钱怎么进来 |
| V5 提现 | 客户出金全流程（10 态状态机、审批门、补料） | 钱怎么出去 |
| V6 兑换 | 币币/法币兑换（四腿记账、合规裁决） | 钱怎么换 |
| V7 财资 | 公司自有资金 + 内部划转单（公司 → 客户补款 / 垫款，2026-09-05）+ LP 档案与兑换台（公司 ↔ 场外流动性提供商补货 / 回吐，2026-09-29） | 公司的钱怎么给客户、库存见底怎么找 LP 补货 |
| V8 对账 | 账本 vs 外部余额核对、破口分案处置、补单回业务域 | 账对不对得上 |
| V9 监管报送 | 事故通报 / 监管来函应答 / 重大变更等对外报送单据（GENERAL 族，六态六边+高管签发）＋ STR/SAR/CNMR/PNMR/HRC/HRCA 反洗钱报文（AML 族，四边+MLRO 无签发链亲办）＋ 周期申报（`PERIODIC_RETURN`，义务到期自动开单） | 跟监管交差记录在哪（2026-09-26 战役甲波二骨架 + 战役甲波三报文族 + 2026-09-27 战役甲波四挂合规办公室闹钟墙/日历，见 `modules/compliance-office.md`） |
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

## 4. 权限包拆分（15 域 81 桶）

角色可随时在管理台创建，所以**不做角色矩阵**；稳定的是**权限包**（PermissionGroup）——角色由包组合出来，SoD（职责分离）靠包的边界演示。2026-08-31 第一幕职权重划后，权限包目录按**域**（Domain）组织，**15 域、81 桶、零空域**（每个域至少一个桶——此前 15 域仅 6 域有桶，9 个空壳域已铺满或整域退役；2026-09-06 平账三期新增 `Incident Register` 域，12→13 域、56→58 桶；58→60 桶为第二幕客户域波二「入驻准入核准」、波三「档位升级准入」两波各加一桶；60→62 桶为波五 swap FROZEN 中间态翻案新增「提解冻」「提拒退」两桶，Trading 域 17→19 桶；62→66 桶为 2026-09-25 战役甲波一事故分类十类终盘——`Incident Register` 域从 2 桶拆到 6 桶：原「登记与处置事故」一桶按事故所属族拆成四桶「登记与管理 FUNDS/TECH_SECURITY/DATA/OPERATIONS/FINANCIAL 族事故」各自独立经办组，事故类型从四类（含人工登记 `MANUAL`）扩到十类，`MANUAL` 退役、新增 `CYBER_BCDR`/`DATA_BREACH`/`OUTSOURCING_FAILURE`/`ASSET_NONCOMPLIANCE`/`STUCK_TRANSACTION_MAJOR`/`PRUDENTIAL_BREACH`/`COMPLAINT_ESCALATION`（后者未启用，波五占位）；结案审批由两条链扩到四条链（安全 SECURITY / 财务 FINANCIAL / 技安 TECHSEC / 审慎 PRUDENTIAL）；**66→68 桶为 2026-09-26 战役甲波二报送台骨架**——新增 `Regulatory Filings` 域两桶（`filings.view`/`filings.desk`），13→14 域；事故通报单槽退役，六个过程列改由报送台新主体接手；**68→69 桶为 2026-09-26 战役甲波三报文族台账与联动**——`Regulatory Filings` 域加第三桶 `filings.aml-desk`（`REG_FILING_AML_WRITE`，MLRO 独占，STR/SAR/CNMR/PNMR/HRC/HRCA 六类型无签发链亲办），域数不变仍 14；权限组同批 76→77（仅新增这一个组，`REG_FILING_READ` 是既有组新增 MLRO 持有，不算新组）；**69→73 桶为 2026-09-27 战役甲波四闹钟墙/合规日历/登记册**——新增 `Compliance Office` 域四桶（`compliance-office.view`/`.obligations`/`.vendors`/`.ri`），14→15 域；权限组同批 77→81（新增 `COMPLIANCE_OFFICE_VIEW`/`OBLIGATION_WRITE`/`VENDOR_REGISTER_WRITE`/`RI_REGISTER_WRITE` 四组），详见下方「Compliance Office」行；**73→75 桶为 2026-09-28 战役甲波五投诉工作流**——`Incident Register` 域从 6 桶扩到 8 桶（新增 `complaints.view`/`complaints.manage`，桶挂事件登记域、不新增域，骨架岔口 4 裁定），域数不变仍 15；权限组同批 81→83（新增 `COMPLAINT_READ`/`COMPLAINT_WRITE` 两组，`COMPLAINT_WRITE` 唯运营持有、`COMPLAINT_READ` 恰为合规官/MLRO/内审三职务），详见下方「Incident Register」行与 `modules/complaints.md`）；**75→77 桶为 2026-09-29 战役乙波一 LP 地基与调拨**——`Treasury` 域从 9 桶扩到 11 桶（新增 `treasury.view_lp`/`treasury.act_lp`，桶挂财资域、不新增域），域数不变仍 15；权限组同批 83→85（新增 `LP_READ`/`LP_WRITE` 两组，`LP_WRITE` 唯金库持有、`LP_READ` 恰为金库/CFO/内审三职务），详见下方「Treasury」行与 `modules/lp-desk.md`）；**77→80 桶为 2026-09-29 战役乙波二注资·付款·全景看板**——`Treasury` 域从 11 桶扩到 14 桶（新增 `treasury.view_dashboard`/`treasury.view_funding`/`treasury.act_funding`，桶挂财资域、不新增域），域数不变仍 15；权限组同批 85→88（新增 `FUNDING_DASHBOARD_VIEW`/`FUNDING_READ`/`FUNDING_WRITE` 三组，`FUNDING_DASHBOARD_VIEW` 恰为金库/CFO/高管/内审四职务、`FUNDING_READ` 恰为金库/CFO/内审三职务、`FUNDING_WRITE` 唯金库持有），详见下方「Treasury」行与 `modules/company-funds.md`）；**80→81 桶为 2026-09-30 战役乙波三审慎红线与巡检**——`Treasury` 域从 14 桶扩到 15 桶（新增 `treasury.prudential_check`，桶挂财资域、不新增域），域数不变仍 15；权限组同批 88→89（新增 `PRUDENTIAL_CHECK_WRITE` 一组，唯金库持有；`GET /admin/prudential/status` 挂既有桶 `treasury.view_dashboard` 不增桶）；同批兑换腿丙案——`rbac.catalog.ts:435` 该路由 groups 从 `TRADING_SWAP_WRITE` 改挂 `FUNDS_ORDER_ACT`（端点重挂、不给任何职务发新权，权限包不增不减），详见下方「Treasury」行与 `modules/company-funds.md` §7）：

| 域 | 桶 | 说明 |
|---|---|---|
| Auth | Base Access（强制开，不可关） | 登录管理台的底权，1 桶 |
| Identity & Access（IAM） | 查成员 / 查角色与目录 / 管成员 / 授角色 / 管凭据 / 定义角色 | 6 桶；「授角色」由 CISO 与技术官双持（2026-09-04 业主拍板加授技术官，解开角色绑定变更的自批死锁），但**裁决人仍唯 CISO**——技术官能提不能批 |
| Approval Center | 查审批 / 查审批策略 / 改审批策略 | 3 桶；「改审批策略」标 `restricted`，**高管与 CISO 两人持有**（`GOV_APPROVAL_POLICY_WRITE`）——高管提、CISO 批，两人分立才有 maker≠checker |
| Audit Center | 查日志 / 查证据包 / 建证据包 | 3 桶 |
| Accounting | 查科目 / 查凭证 / 查流水 | 3 桶，全只读；手工开账本科目已退役（业主定「账本没有手动配置这回事」），开户随资产随版本装载时自动建（`prisma/seed.business.ts` 的 `seedAssets` 逐资产调 `ensureTbAccountRegistry`；资产上架那条路 2026-09-04 V3 波一已退役） |
| Treasury | 查资产 / 暂停恢复资产 ｜ 查钱包地址行 ｜ 查/管提现地址 ｜ 查/管限额 ｜ 查内部划转 / 发起补款 · 垫款 ｜ 查 LP 档案与兑换单 / 建档 · 开单 · 启停 · 验收（2026-09-29 战役乙波一新增） ｜ 查公司资金全景看板 / 查注资单与付款单 / 发起注资与付款（2026-09-29 战役乙波二新增） ｜ 触发审慎巡检（`treasury.prudential_check`，2026-09-30 战役乙波三新增） | 15 桶；「暂停 / 恢复资产」独属运营，「管提现地址」独属金库专员；钱包地址行只从种子来、管理台只读；`treasury.act_lp`（`LP_WRITE`）唯金库持有，`treasury.act_funding`（`FUNDING_WRITE`）唯金库持有，`treasury.prudential_check`（`PRUDENTIAL_CHECK_WRITE`）唯金库持有，CFO 裁决均走审批角色路由不占桶；`treasury.view_dashboard`（`FUNDING_DASHBOARD_VIEW`）恰金库/CFO/高管/内审四职务持有，`GET /admin/prudential/status` 挂此桶不增桶；兑换腿丙案（`rbac.catalog.ts:435` 该路由 groups 改挂 `FUNDS_ORDER_ACT`）是端点重挂非新增桶/组，详见 `modules/company-funds.md` §7 |
| Customer Management | 查客户 / 改档案与标签 / 开限制 / 解限制 / 提准入核准 / 提档位升级准入 | 6 桶；开/解限制故意分离两个包；后两桶均是运营发起、高管单步批的准入类审批（2026-09-07 波二「提准入核准」、2026-09-08 波三「提档位升级准入」） |
| Trading | 查充值/提现/兑换/Sumsub 回调（4）｜ 充值：放行低于下限/提没收/提退回/提上缴/提解冻（5）｜ 提现：建单与报价/退票/提裁决退款/提解冻（4）｜ 兑换：处理兑换/提解冻/提拒退（3，后两桶 2026-09-14 波五新增，见下）｜ 平账补单三路：充值补录/退汇认领/退回认领（3，2026-09-03 平账 B 批） | 19 桶，按具体动作拆到底，不用笼统的"处置"——提没收与提解冻不是同一件事，更不该同属一包 |
| Funds Orders | 看资金单 / 推资金单 | 2 桶；看得到 ≠ 推得动，这条 SoD 靠 VIEW/ACT 分家 |
| Reconciliation | 看跑批/案件/外部余额（`recon.view`）／触发跑批（`recon.act_run`）／开调账单（`recon.act_adjust`，maker，裁决人 CFO）／记处置结论（`recon.act_dispose`） | 4 桶，全归金库专员（2026-09-27 甲波四收口订正：原行漏记 `recon.act_adjust`/`recon.act_dispose` 两桶，陈旧自仓库压平提交起未同步，与本战役无关） |
| Incident Register | 看事故 / 登记与管理 FUNDS 族 / TECH_SECURITY 族 / DATA 族 / OPERATIONS 族 / FINANCIAL 族事故（各族独立经办组，动作均含登记 / 调查 / 定损 / 通报 / 挂善后单 / 提结案 / 撤回）｜ 看投诉 / 受理调查投诉（确认 / 立案 / 备注 / 延期 / 提裁决 / 升级） | 8 桶（2026-09-06 平账三期新增，原 2 桶；2026-09-25 战役甲波一按族拆到 6 桶；2026-09-28 战役甲波五加 `complaints.view`/`complaints.manage` 两桶，6→8 桶）；十类登记（`UNAUTHORIZED_OUTFLOW`/`LARGE_UNEXPLAINED`/`CLIENT_SHORTFALL`→FUNDS 族 ｜ `CYBER_BCDR`/`OUTSOURCING_FAILURE`→TECH_SECURITY 族 ｜ `DATA_BREACH`→DATA 族 ｜ `ASSET_NONCOMPLIANCE`/`STUCK_TRANSACTION_MAJOR`→OPERATIONS 族 ｜ `PRUDENTIAL_BREACH`→FINANCIAL 族 ｜ `COMPLAINT_ESCALATION`→CUSTOMER 族，2026-09-28 战役甲波五通电启用，只经投诉升级生成、手工登记仍拒；原人工登记 `MANUAL` 已退役），全程零账务，结案走五条审批链（新增 `INCIDENT_CLOSE_CUSTOMER` 合规官单步，见 `modules/v1-governance.md` §7）；「该不该通报」判定仍在这里，通报的过程搬去下一行；**投诉本身**（`Complaint` 主体，`complaints`/`complaint_entries` 两表）是本域新挂的独立主体，非事故子类——双钟（1 周确认 / 4 周裁决可延一次到 8 周）、六态迁移表、运营受理调查 + 合规官裁决（maker-checker，走审批角色路由不占额外权限桶），详见 `modules/complaints.md` |
| Regulatory Filings | 看报送单 / 经办 GENERAL 族报送台（开单 / 起草 / 送签 / 标已提交 / 往来记录 / 办结 / 作废）/ 经办 AML 报文族报送台（STR/SAR/CNMR/PNMR/HRC/HRCA：开单 / 正文 / 标已提交 / 往来 / 决定不报 / 办结 / 作废，无签发链） | 3 桶（`filings.view`/`filings.desk`，2026-09-26 战役甲波二新增；`filings.aml-desk`，2026-09-26 战役甲波三新增）；GENERAL 族合规官独占写权，对外提交前必经高管单步签发（`REG_FILING_SUBMIT`）；AML 族 MLRO 独占写权，法定无签发链；两族共享写路由（OR 粗门），服务层按 `cap.filing.general`/`cap.filing.aml` 精确分权（照 `cap.incident.*` 先例）；事故 `reportRequired=true` 时按依据码自动开单，一码一单，详见 `modules/v9-regulatory-filing.md` |
| Compliance Office | 看闹钟墙 / 合规日历 / 两本登记册 ｜ 管周期义务台账 ｜ 管外包商登记册 ｜ 管 RI（受托责任人）登记册 + 提换人 | 4 桶（`compliance-office.view`/`.obligations`/`.vendors`/`.ri`，2026-09-27 战役甲波四新增）；`.view` 合规官/MLRO/高管/内审/CISO 五职务共持，其余三桶合规官独占；三个写面各自单一经办人，路由门即精确门，不需要 `cap.*` 服务层族独占；RI 换人走事前审批（合规官提、高管单步批），详见 `modules/compliance-office.md` |
| Pricing | 查费率 / 改费率 | 2 桶；「改费率」现独属财务负责人（原运营持有，2026-08-30 起改判防自批死锁；2026-09-04 起涵盖创建 / 变更 / 退役三种单） |
| Demo Instruments | 喂裁决 ⚡ / 拨钟 ⚡ | 2 桶；站在 Sumsub 那一侧的模拟能力，不是我方职务的业务能力，单独成域 |

**例外（有路由、不进桶目录）**：`TRADING_DEPOSIT_WRITE` 挂在客户端 `/deposit-transactions/my/inbound-signals*` 两个 URL 上（客户信号入口，非管理端能力，故意不进目录、不绑任何角色）。

### 十一个职务与其独有动作

| 职务 | 独有动作（该桶所需权限组全系统仅此职务持有）|
|---|---|
| SUPER_ADMIN（超管） | 全部——应急账号，不用于日常演示 |
| SENIOR_MANAGEMENT_OFFICER（高管） | 无独有权限包——身份体现在**裁决人**位：限额规则创建/变更、大额提现放行、管理员停用/恢复、上缴第一步、**事故结案审慎类（`PRUDENTIAL_BREACH`）单步裁决人**（2026-09-25 战役甲波一新增，见 `modules/v1-governance.md` §7）、**报送台对外提交前的单步签发裁决人**（`REG_FILING_SUBMIT`，2026-09-26 战役甲波二新增，随之持 `REG_FILING_READ`，见 `modules/v9-regulatory-filing.md`）、**RI 换人事前审批单步裁决人**（`RI_REPLACEMENT`，2026-09-27 战役甲波四新增，合规官提、随之持 `COMPLIANCE_OFFICE_VIEW`，见 `modules/compliance-office.md`）；2026-09-29 战役乙波二起补持 `FUNDING_DASHBOARD_VIEW`（看得见公司资金全景看板，看板本身不设操作按钮）。⚠️ 审批策略变更他是**提单人**（持 `GOV_APPROVAL_POLICY_WRITE`），裁决人是 CISO |
| CISO | 授角色（`IAM_ROLE_ASSIGN`）——2026-09-04 起与技术官双持，但**裁决人仍唯 CISO**；另是角色定义创建/修改、成员邀请、资产暂停/恢复、**审批策略变更**的裁决人（资产上架与托管钱包创建两条路 2026-09-04 V3 波一已退役，CISO 不再有这两个裁决位）；**事故结案技安类（`INCIDENT_CLOSE_TECHSEC`）单步裁决人**（2026-09-25 战役甲波一新增），随之持 `INCIDENT_READ`（裁决人要看得见事故留痕才能批）；2026-09-27 战役甲波四起补持 `COMPLIANCE_OFFICE_VIEW`（看闹钟墙/日历/两册，只读）。⚠️ 管理员停用/恢复的裁决人是**高管**，不是 CISO |
| MLRO | **AML 报文族经办组独持**（`REG_FILING_AML_WRITE`，2026-09-26 战役甲波三新增）——STR/SAR/CNMR/PNMR/HRC/HRCA 六类型开单/正文/标已提交/往来/决定不报/办结/作废全程亲办、法定无签发链，随之补持 `REG_FILING_READ`。此外无独有 Manage 类权限包，身份另体现在**裁决人**位：充值/提现解冻、部分限制解除、**制裁定性裁决**（`SANCTION_DISPOSITION` 单步，2026-09-26 战役甲波三新增，合规官提、排除/部分/确认三选一）、事故结案安全类审批两步（`INCIDENT_CLOSE_SECURITY`，2026-09-06 平账三期新增）的**第一步裁决人**；2026-09-27 战役甲波四起补持 `COMPLIANCE_OFFICE_VIEW`（只读） |
| DPO | **事故 DATA 族经办组独持**（`INCIDENT_DATA_WRITE`，2026-09-25 战役甲波一新增）——登记 / 调查 / 定损 / 挂客户通知留痕 / 提结案 `DATA_BREACH`（个人数据泄露）事故；此外数据保护监督，读权限与内审/合规重叠 |
| INTERNAL_AUDITOR（内审） | 无独有权限包——**28 组里零 Manage、零业务 Act**；唯一的写是「建证据包」（`AUDIT_EXPORT_CREATE`，监管上门他得能打包），且导出仍要 MLRO 背书。独有性正是"不能动手"；2026-09-26 战役甲波二起补持 `REG_FILING_READ`（要看得见报送台，见 `modules/v9-regulatory-filing.md`），2026-09-27 战役甲波四起再补 `COMPLIANCE_OFFICE_VIEW`，2026-09-29 战役乙波二起再补 `FUNDING_DASHBOARD_VIEW`（看得见公司资金全景看板），仍全部只读 |
| COMPLIANCE_OFFICER（合规官） | 改客户档案与标签、提充值解冻、提提现解冻、**提兑换解冻**（2026-09-14 波五新增）、⚡ 喂裁决（5 项，2026-09-26 战役甲波三新增「EOCN 名单更新命中」）——管理台里推不动任何交易单，但持 ⚡；**GENERAL 族报送台唯一经办人**（`REG_FILING_WRITE`，2026-09-26 战役甲波二新增：开单/起草/送签/标已提交/往来记录/办结/作废全在他手上，对外提交须高管另批），随之补持 `INCIDENT_READ`（起草通报须读得到事故详情）；**提制裁定性裁决**（`SANCTION_DISPOSITION`，2026-09-26 战役甲波三新增，MLRO 单步批，排除/部分/确认三选一出口）；**合规办公室三写面独占**（`OBLIGATION_WRITE`/`VENDOR_REGISTER_WRITE`/`RI_REGISTER_WRITE`，2026-09-27 战役甲波四新增：周期义务台账建/改/停用复用、外包商登记/修改/终止、RI 建席位 + 提换人，随之持 `COMPLIANCE_OFFICE_VIEW`）；**投诉裁决人**（`COMPLAINT_RESOLUTION` 单步批、升级出的事件结案 `INCIDENT_CLOSE_CUSTOMER` 单步批，2026-09-28 战役甲波五新增，均走审批角色路由不占权限组，随之持 `COMPLAINT_READ` 看得见列表/详情，不持 `COMPLAINT_WRITE`——不是受理调查的经办人）；⚠️ **AML 报文族（STR/SAR/CNMR/PNMR/HRC/HRCA）该职务零角色**——报文族全程归 MLRO 独办（见上方 MLRO 行，见 `modules/v9-regulatory-filing.md`） |
| CFO（财务负责人） | 改费率（提现/兑换两族费率写权限，全系统唯一）；充值没收的裁决人；**平账一切审批的裁决人**（调账单四族 + 核销 + **补单三路复核** + **补款 / 垫款划转**，2026-09-02 起，原运营；补单三路为 2026-09-03 平账 B 批新增，补款 / 垫款划转为 2026-09-05 平账二期新增）；**LP 建档与开单的唯一裁决人**（`LP_PROFILE_APPROVAL`/`LP_PROFILE_CHANGE`/`LP_EXCHANGE_APPROVAL` 三条单步 48h 可撤，2026-09-29 战役乙波一新增，金库提），随之持 `LP_READ`（验收动作本身不经审批，金库自行核数）；**注资单与供应商付款单的唯一裁决人**（`CAPITAL_INJECTION_APPROVAL`/`VENDOR_PAYMENT_APPROVAL` 两条单步 48h 可撤，2026-09-29 战役乙波二新增，金库提），随之持 `FUNDING_READ`/`FUNDING_DASHBOARD_VIEW`（确认入账动作本身不经审批，金库自行核数）；事故结案审批**安全类两步的第二步 + 财务类单步**裁决人（`INCIDENT_CLOSE_SECURITY`/`INCIDENT_CLOSE_FINANCIAL`，2026-09-06 平账三期新增；⚠️ 2026-09-25 战役甲波一新增技安/审慎两条链后，CFO **不再是事故结案唯一裁决人**，见 CISO/高管两行）；**事故 FINANCIAL 族经办组独持**（`INCIDENT_FIN_WRITE`，2026-09-25 战役甲波一新增）——登记 / 调查 / 定损 / 提结案 `PRUDENTIAL_BREACH`（审慎/NLA 缺口）事故（自己开、高管批，不自批） |
| TREASURY_OFFICER（金库专员） | 管提现地址（暂停 / 恢复 / 跳过冷却）——钱往哪提归他；钱包地址行只读；**发起补款 / 垫款**（案子上，2026-09-05 平账二期）；**LP 档案与兑换单独持写权**（`LP_WRITE`，2026-09-29 战役乙波一新增）——建档 / 改结算 / 启停 / 开兑换单 / ⚡推卖出腿 / ⚡模拟 LP 打款 / 验收全在他手上，CFO 是建档与开单两条审批的唯一裁决人；**注资单与供应商付款单独持写权**（`FUNDING_WRITE`，2026-09-29 战役乙波二新增）——开注资单 / ⚡模拟出资方打款 / 确认入账 / 开付款单 / ⚡推出款全在他手上，CFO 是两条审批的唯一裁决人；随之持公司资金全景看板（`FUNDING_DASHBOARD_VIEW`，与 CFO/高管/内审三职务同持）；**审慎巡检独持写权**（`PRUDENTIAL_CHECK_WRITE`，2026-09-30 战役乙波三新增）——看板点「Run prudential check」实算 + 留痕全在他手上，零审批（巡检是查询式动作非资金动作）；**事故 FUNDS 族经办组独持**（`INCIDENT_WRITE`，2026-09-10 对账平账两角色定案起独持、运营清零）——登记 / 调查 / 定损 / 通报 / 挂善后单 / 提结案 `UNAUTHORIZED_OUTFLOW`/`LARGE_UNEXPLAINED`/`CLIENT_SHORTFALL` 三类事故，不再借道认损开单 / 发起补款两个既有通道旁敲；**⚠️ 2026-09-25 战役甲波一起该组只是十类里的一族**——事故域整体已按五族经办组（FUNDS/TECH_SECURITY/DATA/OPERATIONS/FINANCIAL）拆到金库 / 技术官 / DPO / 运营 / CFO 五个职务各管一族，不再是金库独占整个事故域 |
| TECH_OFFICER（技术官） | 无独有权限包——资产管控 2026-09-04 起划归运营，此前唯一的独有包随之退役；IAM 侧仍是邀请成员 / 定义角色 / 重置凭据的提单人，2026-09-04 起加授角色（`IAM_ROLE_ASSIGN`），但四项均与 CISO 双持、CISO 才是裁决人——加授角色正是为解开角色绑定变更审批曾经的自批死锁；**事故 TECH_SECURITY 族经办组独持**（`INCIDENT_TECH_WRITE`，2026-09-25 战役甲波一新增）——登记 / 调查 / 定损 / 通报 / 提结案 `CYBER_BCDR`/`OUTSOURCING_FAILURE` 两类事故，结案裁决人是 CISO，不自批 |
| OPS_OFFICER（运营） | 管限额、暂停/恢复资产、放行/没收/退回/上缴充值、建提现单与退票/裁决退款、处理兑换、**提兑换拒退**（`SWAP_REFUND_WRITE`，2026-09-14 波五新增）、**发起补单**（三路：充值补录 / 退汇认领 / 退回认领，2026-09-03 平账 B 批）、**提准入核准**（EDD 高风险客户入驻放行，2026-09-07 波二新增，此前遗漏未记入本行）、**提档位升级准入**（BASIC→PREMIUM，2026-09-08 波三新增）——日常动钱的手，唯独没有任何 `*_UNFREEZE_WRITE`；不再是平账审批的裁决人（改 CFO）；推资金单 / 跑对账批次 / ⚡ 拨钟（`DEMO_CLOCK_WRITE` 等，2026-09-08 起分批迁出、2026-09-10 对账平账两角色定案收官）整组归金库，运营只留 `FUNDS_ORDER_VIEW` 只读；**⚠️ 2026-09-25 战役甲波一新增事故 OPERATIONS 族经办组独持**（`INCIDENT_OPS_WRITE`）——登记 / 调查 / 定损 / 挂资产暂停引用 / 提结案 `ASSET_NONCOMPLIANCE`/`STUCK_TRANSACTION_MAJOR` 两类事故，事故域运营不再是整体归零，而是拆出这一族重新持有；**投诉受理调查唯一经办人**（`COMPLAINT_WRITE`，2026-09-28 战役甲波五新增，绑 `INCIDENT_OPS_WRITE` 现持有职务）——确认收悉 / 立案 / 加备注 / 延期 / 提裁决 / 升级全靠这个组，裁决人是合规官，不自批死锁；⚡ 拨快投诉双钟不在此列——运营不持 `DEMO_CLOCK_WRITE`，同报送单/义务台账既有交叉 |

矩阵头条（机器验证 + 行为探针双证，判据在 `scripts/verify-rbac.ts`——S1/S2 静态、S5 家族守自批死锁与 maker≠checker、47 条行为探针逐条打真端点）：解冻只在合规官提、**MLRO 裁决**（与财务无关；财务的裁决位是充值没收） ｜ 费率改动只在财务 ｜ 提现地址只在金库专员 ｜ 资产暂停 / 恢复只在运营 ｜ 授予角色提单在 CISO 与技术官、**裁决唯 CISO** ｜ 内审 28 组零 Manage、零业务 Act（唯一的写是建证据包）｜ 合规官推不动任何交易单但持 ⚡ ｜ 推资金单与跑对账批次只在金库 ｜ 平账审批只在 CFO（金库开单 / CFO 裁决两角色分立）｜ 事故登记按族分权，五族各一名独占经办人（金库/技术官/DPO/运营/CFO），跨族既登不了也批不了（路由层五桶 OR 是粗门，服务层按族独占能力码 `cap.incident.*` 才是真正把关，2026-09-25 战役甲波一）｜ **报送台经办唯合规官、对外提交前签发唯高管**（`REG_FILING_WRITE`/`REG_FILING_SUBMIT`，maker≠checker 两角色天然分立，2026-09-26 战役甲波二）｜ **AML 报文族经办唯 MLRO、法定无签发链**（`REG_FILING_AML_WRITE`，服务层 `cap.filing.aml` 独占，2026-09-26 战役甲波三；与 GENERAL 族「高管签发」刻意同屏对比）｜ **合规办公室三写面唯合规官、⚡ 拨钟唯金库/超管**（`OBLIGATION_WRITE`/`VENDOR_REGISTER_WRITE`/`RI_REGISTER_WRITE` 三组恰合规官一人持有，`COMPLIANCE_OFFICE_VIEW` 恰合规官/MLRO/高管/内审/CISO 五职务持有，2026-09-27 战役甲波四；两组交集为空——没有单一非超管职务能同时看到闹钟墙⚡按钮又点得动，是真实 RBAC 交叉产物，非缺陷）｜ **RI 换人事前审批唯高管裁决、maker≠checker**（合规官提、高管批，2026-09-27 战役甲波四）｜ **投诉受理唯运营、裁决唯合规官，maker≠checker**（`COMPLAINT_WRITE` 恰运营一人持有，`COMPLAINT_RESOLUTION`/升级事件结案 `INCIDENT_CLOSE_CUSTOMER` 均合规官单步批，走审批角色路由不占权限组，2026-09-28 战役甲波五）｜ **投诉拨钟门控交叉同报送单/义务台账**（`DEMO_CLOCK_WRITE` 唯金库+超管，运营/合规官均不持——运营是经办人但拨不了钟，合规官持 `COMPLAINT_READ` 但同样不持 `DEMO_CLOCK_WRITE`，能同时看到页面又点得动 ⚡ 按钮的只有超管，2026-09-28 战役甲波五 T6 行为探针实证）｜ **审慎巡检唯金库、跌破期算术门放行补款与注资**（`PRUDENTIAL_CHECK_WRITE` 恰金库一人持有，运营/合规官 POST check 均 403；付款单/LP 兑换单跌破期开单 400，内部划转/注资单跌破期照常发起成功——豁免生效的行为证明，2026-09-30 战役乙波三 S15 行为探针实证）；兑换腿丙案后金库 POST 推腿端点 ALLOW、运营 DENY，与面板可见性同源（S15c 静态判据钉死 route groups）。

> 包与桶的权威清单在代码 `src/modules/identity/access-control/rbac.catalog.ts`（`PermissionGroup` 类型 89 个、`ACTION_BUCKET_CATALOG` 15 域 81 桶、`RBAC_ROLE_GROUP_BINDINGS` 11 职务——2026-09-30 战役乙波三 T10 收口实测：`ACTION_BUCKET_CATALOG.length` = 81；三源运行时并集（路由挂载∪职务持有∪桶挂载）= 89；域数 = 15，详见 `scripts/verify-rbac.ts` S15）；本节是其业务口径快照，权限点变动时由 agent 同步。

## 5. 关键技术节点（overview 级）

- 后端模块根 `src/modules/`：trading（三域交易，`trading/shared/` 存三域公共纯函数工具 + fee-level 公共基类，2026-09-13 波四共享抽离）、identity（客户+IAM）、governance（审批 / 事故登记 `governance/incidents/`，2026-09-06 平账三期 / 监管报送 `governance/regulatory-filings/`，2026-09-26 战役甲波二——新主体 `RegulatoryFiling`，横向只读事故域、事故域横向只读它，两域各自唯一写点 / 合规办公室 `governance/compliance-office/`，2026-09-27 战役甲波四——闹钟墙聚合端点 + 义务台账 + 两本登记册，三新表互无外键、无横向联动，详见 `modules/compliance-office.md` / 投诉 `governance/complaints/`，2026-09-28 战役甲波五——独立主体 `Complaint`（双钟六态）+ 裁决/升级两条 workflow，两新表互无外键、无横向联动，client-web 首触，详见 `modules/complaints.md`）、asset-treasury（资产钱包）、accounting（账本）、clearing-settle（对账）、audit-logging、funds-orders、deposit/swap/withdraw-sumsub + sumsub-ingestion（合规接入）+ sumsub-shared（充提两域 SLA/KYT裁决落地/demo 场景公共基类，兑换域独立演进不参与，2026-09-13 波四共享抽离）
- 内部划转 `asset-treasury/internal-transfers/`（第四类订单，2026-09-05 平账二期，详见 `modules/v7-treasury.md`）
- 客户档位升级 `identity/tier-upgrade/`（2026-09-08 第二幕客户域波三，详见 `modules/v2-customer-compliance.md`）：申请→补料→高管准入核准→`tradingTier` BASIC→PREMIUM 单向翻转；同批接上 TB 客户账本户运行时开户钩子（挂客户首次进 ACTIVE，此前只有种子脚本会开户）
- 制裁定性裁决 `identity/customers/sanction-disposition-workflow.service.ts`（2026-09-26 战役甲波三）：合规官提、MLRO 单步批，排除/部分/确认三选一出口横向联动限制账（`CustomerRestrictionsService`）与报送台 AML 族（`RegulatoryFilingService.openForSanction()`），铁律③各写各的；详见 `modules/v2-customer-compliance.md`/`modules/v9-regulatory-filing.md`
- 状态机：各域 service 内显式迁移表（如 `withdraw-transactions.service.ts` 的 10 态 23 边、`swap-transactions.service.ts` 的 5 态 7 边——2026-09-13 波四共享抽离清除 `FAILED`/`REVERSED` 两个不可达死枚举后，兑换域枚举与可达状态数首次一致；2026-09-14 波五 FROZEN 从零出边终态翻案为押锁不放的中间态，补 `RESUME`/`REJECT_REFUND` 两条出边，5 边→7 边，见 `modules/v6-swap.md` §2）；工作流（`*-workflow.service.ts`）串主体
- 账本：TigerBeetle 复式记账，10 码科目表，实时 1:1 逐腿 post；对账引擎在 `clearing-settle`
- 权限：`rbac.catalog.ts` 集中登记端点 × 权限包
- 两级门：**L1** = 平台内所有限制条件的判断（`L1GateService` 十项，三域共用），**L2** = Sumsub 合规判断；`OPERATION_PENDING` 只能从 L2 通过进入
- 通知本体 `core/notifications/`（2026-10-01 战役丙波一）：站内消息中心（铃铛 + `/messages` + 已读）+ 16 个发信点（充值 6/提现 5/兑换 2/投诉 3，`toCustomerXStatus(from)≠toCustomerXStatus(to)` 收敛判据触发）+ email 模拟留痕（`EMAIL_SIMULATED` 徽章不真发）；详见 `modules/v1-governance.md` §5/§6

## 6. 演示缺口

待 Phase 3 各模块文档就位后按模块汇总；当前看 `BACKLOG.md`。
