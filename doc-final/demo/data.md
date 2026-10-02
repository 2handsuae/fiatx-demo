# 演示数据字典（data）

> 上半篇（管理员/客户矩阵/资产钱包/各脚本）手写，2026-08-26 实测盘点后维护。下半篇「本批数据」由 `demo:all` 收尾自动写入生成区（防漂移），别手改那一段。
> 重铺入口：`bash scripts/stack.sh reset [main|self]`（含 TigerBeetle 清理重建）；全量造数：`bash scripts/on-stack.sh main demo:all`（worktree 内用 self）。基线见 [baseline.md](baseline.md)。

## 管理员（base seed，11 职务各一人，密码 123456）

admin@fiatx.com 超管 ｜ sm@ 高管(SMO) ｜ ciso@ ｜ mlro@ ｜ dpo@ ｜ compliance_lead@ ｜ tech_admin@ ｜ ops_officer@ ｜ auditor@ 内审 ｜ cfo@ 财务负责人 ｜ treasury@ 金库专员 —— 一人一角色，SoD 演示直接换人登录。

## 站 0 演示装置（进人）

邀请新成员时的四个演示细节：邮箱现场编一个，不必真实可达；MFA 绑定用任意 TOTP 认证器 App 扫码，不挑牌子；新人视角必须开一个浏览器隐身窗，与批准人的会话分开；邀请没有真发信——激活链接不走邮件，直接显示在管理台「成员详情」卡片上，复制过去就是新人要点的那个链接（通知本就是空壳，这是演示装置，讲清）。

## 客户矩阵（business seed，13 位，覆盖 10 种状态位）

11 位 ACTIVE 客户开户日已回填 `onboardingApprovedAt = 2026-06-15T09:00:00Z`、CDD 五列（生日/国籍/证件类型/证件号/住址）已铺——早出新客窗（NEW_CUSTOMER 衍生标签 30 天窗）。Carol、Frank、Leo、Mona 落 `edd-sof-sow-level`（EDD 档）；其余 7 位 ACTIVE 客户落 `basic-cdd-level`（CDD 档）。Dave（认证中）、Eve（刚注册）本身就是"开户流程中段/起点"的演示位，故意不回填。第二幕②③现场开户走查用的是当场新注册客户，不是这张表；现场注册客户即用即弃，重演换一个新邮箱，不依赖 reset。Leo、Mona 两位是战役甲波三 Task 10 新增（报文族种子锚点，见下方「报文族种子」节）。

| 客户 | 状态位 | 用来演什么 |
|---|---|---|
| Alice Happy | 快乐路径（真 Sumsub 沙盒 applicant） | 三条交易流程的主角 |
| Bob Happy | 快乐路径（mock applicant） | 备用主角/并行单 |
| Carol Silent | **制裁便签 · 静默**（lifecycle 仍 ACTIVE） | 零痕迹：管理台可见、客户端无感（横幅矩阵下四页零横幅=tipping-off 反证位，2026-09-13 波三）；三/五幕站 3.4/5.4 演"创建即冻"——种子即受限，充值/提现建单入库那一刻就是 FROZEN（2026-09-14 波五T11） |
| Dave Pending | 认证中 | 开户流程中段 |
| Eve New | 刚注册未认证 | 开户起点 |
| Frank HighRisk | 高风险 | 风险分层 |
| Grace Premium | VIP 费率标签（手打 STATIC，与 PREMIUM 交易档位解绑，2026-09-06） | 费率受众谓词（命中 VIP-USDT-AED） |
| Henry Acme | 企业客户 | 企业形态占位 |
| Ivy Restricted | **材料过期 · 明示受限**（scopes 仅 WITHDRAW/SWAP，不含 DEPOSIT） | 与 Carol 对照：明示 vs 静默；横幅矩阵下提现/兑换页出条子形态合并横幅、充值页不出（按域过滤演示位，2026-09-13 波三；充值页横幅走第三幕⑥现场限制） |
| Leo Confirmed | **制裁定性 · 确认命中**（`SANCTION_CONFIRMED`，DISCLOSED，scope=ALL） | 战役甲波三 Task 10：CNMR 已提交样例锚点——客户端 Profile 页横幅可演（`RestrictionBanner` 走既有 DISCLOSED 机制，零代码生效）；与 Ivy 对照：Leo 是全阻（ALL，充值也挡），Ivy 是半阻（WITHDRAW/SWAP，充值不挡） |
| Mona Partial | **制裁定性 · 部分命中在途**（`SANCTION` SILENT，OPEN；PNMR 挂钟 + 补料在途） | 战役甲波三 Task 10：PNMR 5 工作日钟种子锚点——与 Carol 对照：Carol 是命中待裁（定性之前），Mona 是已出 PARTIAL 结果（定性之后：PNMR 已开、EMIRATES_ID 补料已发，便签仍 SILENT/OPEN 等 EOCN 回指令） |
| Jack Trader | 快乐路径（对账素材） | 第六幕破口场景的钱包与流水素材 |
| Kate Trader | 快乐路径（对账素材） | 同上——MATCHED 桶的干净代表 |

客户密码统一 123456；客户端登录页 Quick login 面板列全 11 位、点击一键登录（2026-09-08 第二幕收尾轮，演示选角不再手输邮箱）。

## 资产、网络与钱包地址行

**网络注册表**（代码，不建表）：`TRON`（链，HexTrust，地址 `T` + 33 位 Base58，19 个确认）｜ `AED_ZAND`（银行通道，Zand，IBAN `AE` + 21 位数字）。

**资产**（随版本装载，审计 `ASSET_SEEDED`）：`AED`（法币，AED_ZAND）｜ `USDT-TRON`（TRC-20，合约 `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`，6 位小数，托管键 `tron_USDT`）。上币不在管理台。

**平台钱包地址行**（7 行，审计 `CUSTODIAN_WALLET_SEEDED`，管理台只读）：

| vault | TRON | AED_ZAND |
|---|---|---|
| F_OPS 运营 | ✓ 地址 | ✓ IBAN |
| F_SET 结算 | —（只走法币通道） | ✓ IBAN |
| F_FEE 手续费 | ✓ 地址 | ✓ IBAN |
| F_LIQ 流动性 | ✓ 地址 | ✓ IBAN |

**客户收款地址行**（`demo:setup`，审计 `CUSTOMER_DEPOSIT_ADDRESS_SEEDED`）：alice / bob / grace / jack / kate / frank 各一条 TRON（C_DEP）+ 一条 AED_ZAND（C_VIBAN），vault `CLIENT_DEPOSIT`；账本科目仍按资产。

**地址簿种子**（审计 `WITHDRAWAL_ADDRESS_SEEDED`）：六位客户（alice/bob/grace/jack/kate/frank）各一条 ACTIVE 银行账户（AED_ZAND，即本人 vIBAN）；alice / bob 各再一条 ACTIVE 的 TRON 地址。**尚无法币账户的种子客户**：Henry Acme（`demo_acme@example.com`，企业客户）——不在 `demo:setup` 那六人名单内，没有走地址簿种子；站 5 ④c 用他演"首个法币账户即时生效"。

**费率**：`STD-USDT-AED` / `STD-AED-USDT`（默认档）+ `VIP-USDT-AED`（requiredTags `["VIP"]`，各档比 STD 便宜；Grace 带 VIP 标签命中它）+ `NEWCUST-USDT-AED`（requiredTags `["NEW_CUSTOMER"]`，各档比 STD 便宜、比 VIP 贵；开户 30 天内的客户命中它——种子客户开户日已回填 2026-06-15、早出新客窗，只有第二幕②③现场开户的新客户能命中）；demo:all 会把 `STD-USDT-AED` Tier 1 平费改成 10（`demo-lib.ts` FEE_PLAN，造数取整），所以舞台上对照用 1000 USDT（Tier 2：VIP 12 < NEWCUST 16 < STD 20）；提现 `STD-AED-AED_ZAND` / `STD-USDT-TRON`。**限额**：15 条（单笔 6 / 累计 8 / 大额 1）。

**现场登记用的合法 TRON 样例地址**：`bash -c 'npx ts-node -e "import(\"./src/common/utils/tron-address.util\").then(m=>console.log(m.fakeTronAddress(\"demo-register-1\")))"' 生成一枚（形态合法、不做校验和）。

**档位升级站（第二幕⑤，波三新增）参数**：客户沿用②CDD 直通那位现场客户，不额外注册；充值 40000 USDT，卖出 30000 USDT→AED 撞 `BASIC · SWAP · DAILY` 上限 100000 AED（`GET /swap-transactions/rate` 实测 30000 USDT→AED 净额 ≈109944.65 AED，落在 BASIC 上限 100000 AED 之上、PREMIUM 上限 1000000 AED 之下，撞限不空转；充值量 = 卖出量 + 10000 缓冲）。两档限额对照（AED，Profile 页四行表）：SWAP DAILY 100000/1000000、SWAP MONTHLY 1000000/10000000、WITHDRAWAL DAILY 50000/500000、WITHDRAWAL MONTHLY 500000/5000000（BASIC/PREMIUM）。

## 事故种子（business seed，五条非初始态样例，2026-09-25 战役甲波一，终审补第五条）

`seedIncidents()`（`prisma/seed.business.ts`）直接铺终态数据（不走 `IncidentService`，没有 operator、没有审批案、不写审计——与限制账 / 材料请求两组 fixture 同一性质），`incidentNo` 用 `buildDeterministicNo` 派生、reset 重铺后逐字不变。十类终盘里五个族各挑一个非初始态样例，覆盖 IMPACT/MONETARY/SHORTFALL 三档口径与 REGISTERED/INVESTIGATING/ASSESSED/RESOLVING 四个状态；**`CYBER_BCDR`（TECH_SECURITY 族）故意不进种子**，留给演示脚本现场走一遍完整登记流程，演"登记会留痕"这件事（见 `demo/script.md` 第八幕场景 25，2026-09-28 战役甲收官补齐）。

| 类型 | 状态 | 族 | 关键字段 |
|---|---|---|---|
| `DATA_BREACH` | ASSESSED | DATA | `subjectRefs`（受影响客户数 46 / 数据类别 `CONTACT,ID_DOCUMENT`）+ `impactSummary`；双通报依据码已勾（`PDPL_ART_9`+`TIR_II_C_24H`），战役甲波二 T10 起两张 filing 已归位（`seedRegulatoryFilings`，见下方「报送台种子」节）——`PDPL_ART_9` 单 `SUBMITTED`（无钟，已挂一条 `RECEIPT_ACK` 往来记录）、`TIR_II_C_24H` 链单 `SIGNED_OFF` 待提交（deadline=PDPL submittedAt+24h，还剩约 4 小时在跑）。Request Close 仍灰态——**按 `closeGateReason` 真实判断顺序**：先命中"该类型白名单非空（`CUSTOMER_NOTICE_LOGGED`）且未挂载善后单，须先进 Resolving"（`IncidentDetailPage.tsx:134-135`），报送单未全部提交的检查（:144-151）排在其后、这次仍未触发到——即便 TIR 那张已提交也一样，灰态 tooltip 显示的照样是前一条 |
| `OUTSOURCING_FAILURE` | INVESTIGATING | TECH_SECURITY | `subjectRefs`（vendor=`SUMSUB` + serviceImpact，登记时必填的两个锚）——还没定损 |
| `ASSET_NONCOMPLIANCE` | RESOLVING | OPERATIONS | 顶层 `assetCode=USDT-TRON`（唯一必填锚，命中顶层锚分流规则、不进 `subjectRefs`）+ 已挂一条 `ASSET_SUSPENSION_REF` 善后单——结案前只差提结案这一步 |
| `STUCK_TRANSACTION_MAJOR` | REGISTERED | OPERATIONS | 顶层 `customerNo`（Alice）+ `amount=15000.00` + `subjectRefs.orderNo`（动态锚）——刚登记，四态里最早的一态 |
| `PRUDENTIAL_BREACH` | INVESTIGATING | FINANCIAL | `subjectRefs`（metric=`NLA` / shortfallAmount=`250000`，SHORTFALL 口径登记时必填的两个锚）——CFO 经办、还没定损；结案要走 `INCIDENT_CLOSE_PRUDENTIAL`（`SENIOR_MANAGEMENT_OFFICER` 一步核准），十类终盘里**高管单步结案链的唯一演示位**（其余族结案链要么两步 MLRO→CFO，要么单步 CFO/CISO） |

## 报送台种子（business seed，两样例，2026-09-26 战役甲波二 Task 10）

`seedRegulatoryFilings()`（`prisma/seed.business.ts`，紧随 `seedIncidents()` 之后）同样直铺快照数据（不走 `RegulatoryFilingService`/`RegulatoryFilingWorkflowService`，没有 operator、没有审批案、不写审计——「登记会留痕」由 e2e 证），`filingNo` 用 `buildDeterministicNo('FIL', seedKey)` 派生、reset 重铺后逐字不变。

| 样例 | filingNo | type / basisCode | authority | 状态 | 关键字段 |
|---|---|---|---|---|---|
| 一 · 事故通报双钟链（挂 `data-breach-crm-export`，`incidentNo=INC2601011480`） | `FIL2601016500` | `INCIDENT_REPORT` / `PDPL_ART_9` | `UAE_DATA_OFFICE` | `SUBMITTED` | statute 无钟（`deadlineAt=null`）；`externalRef=DATAOFFICE-ACK-2026-0001`；`submittedAt`=铺场时刻−20h；挂一条 `RECEIPT_ACK` 往来记录 |
| 一（续）· 同一事故的链单 | `FIL2601013167` | `INCIDENT_REPORT` / `TIR_II_C_24H` | `VARA` | `SIGNED_OFF` | `deadlineAt`=PDPL `submittedAt`+24h（≈铺场时刻+4h）——钟链起点是 PDPL 那次「通知发出」，不是登记/定损时刻，照真实 `markSubmitted` 落定兄弟单 deadline 的算法（`regulatory-filing.service.ts:300-314`）；签发已批、待标已提交，演示"还剩不到 4 小时"的紧迫感 |
| 二 · 入站来函 | `FIL2601010266` | `REG_INFO_REQUEST_RESPONSE`（无 basisCode） | `VARA` | `DRAFT` | `direction=INBOUND`；`receivedAt`=铺场时刻−6h；`deadlineAt`=`receivedAt`+48h（≈铺场时刻+42h）；标题「VARA information request — Q3 liquidity reporting follow-up」 |

⚠️ 三行 `deadlineAt`/`submittedAt`/`receivedAt` 都锚在**铺场时刻**（`seedRegulatoryFilings` 运行那一刻的 `Date.now()`），不是固定日期——每次 `stack.sh reset` 重铺，剩余时长会重新从 20h/4h/6h/42h 起算，但 `filingNo` 逐字不变（`buildDeterministicNo` 只吃 seedKey，不吃时间）。

## 报文族种子（business seed，三样例，2026-09-26 战役甲波三 Task 10）

`seedAmlFilingFamily()`（`prisma/seed.business.ts`，紧随 `seedRegulatoryFilings()` 之后）同样直铺快照数据（不走 `RegulatoryFilingService`/`SanctionDispositionWorkflowService`，没有 operator、没有审批案、不写审计——「留痕」由 e2e 证，同报送台种子节先例），`filingNo` 用 `buildDeterministicNo('FIL', seedKey)` 派生、reset 重铺后逐字不变。**三处 actor 改用 MLRO 的真实 `userNo`**（`ADM2501010004`，见 `seed.base.ts`）而非其余种子惯用的 `'SEED'` 占位——本组种子的讲法就是「MLRO 亲办 / MLRO 放行」，报送台页面要认得出办的人是谁。SAR/HRC/HRCA 不铺种子，现场手工开单讲解（照波二三类先例）。

| 样例 | filingNo | type | authority | 状态 | 关键字段 |
|---|---|---|---|---|---|
| STR 已提交（锚 Frank HighRisk） | `FIL2601017376` | `STR` | `UAE_FIU` | `SUBMITTED` | `externalCaseRef`=Sumsub 案件引用样式（`SUMSUB-CASE-313b8a36`）；`externalRef`=goAML 回执样式（`GOAML-ACK-2026-45740`）；`submittedAt`=铺场时刻−30h；无钟（`deadlineAt=null`——形成怀疑即报，法定不杜撰时限）；title 锚一个样式提现单号（纯叙事引用，不对应真实建单，同 `seedIncidents` STUCK_TRANSACTION_MAJOR 样例手法）；挂一条 `CUSTOMER_COMM`（`commDraftedBy` 拟稿文本 + MLRO 放行）+ 一条 `RECEIPT_ACK` |
| PNMR 在途（锚 Mona Partial 的 SILENT SANCTION 便签） | `FIL2601012321` | `PNMR` | `EOCN` | `DRAFT` | 锚=Mona 便签 `openedAt`（铺场时刻回拨 3 个工作日——穷举验证过全部 7 个铺场星期几，唯此取值恒落在"还剩约 2-3 个工作日"区间，回拨 2 个工作日周末铺场会漂到 4）；`deadlineAt`=锚+5 工作日；`externalCaseRef`=EOCN 名单条目引用样式（`EOCN-2026-59206`）；挂一条 `AUTHORITY_INSTRUCTION`（EOCN 指令待决文本——要求核实姓名/出生日期，MLRO 尚未据此二次定性） |
| CNMR 已提交（锚 Leo Confirmed 的 `SANCTION_CONFIRMED` 便签） | `FIL2601015358` | `CNMR` | `EOCN` | `SUBMITTED` | 锚=Leo 便签 `openedAt`（铺场时刻回拨 1 个工作日）；`deadlineAt`=锚+5 工作日；`submittedAt`=锚+3h；`externalCaseRef`（`EOCN-2026-73267`）/`externalRef`（`EOCN-ACK-2026-36526`）均 EOCN 样式；挂一条 `RECEIPT_ACK`；客户端 Profile 页横幅可演（`SANCTION_CONFIRMED` DISCLOSED，`RestrictionBanner` 走既有机制零代码生效） |

⚠️ 三行 `deadlineAt` 与 PNMR/CNMR 的锚 `openedAt` 都相对**铺场时刻**回拨/前推（`businessDaysBefore`/`addBusinessDays`，迪拜日历工作日），不是固定日期——每次 `stack.sh reset` 重铺，剩余工作日会重新起算，但 `filingNo`/`externalCaseRef`/`externalRef` 逐字不变（确定性哈希派生，只吃 seedKey，不吃时间）。

Mona 的 EMIRATES_ID 补料请求（`requestNo=MRQ2601019867`，PENDING_SUBMISSION）在上方「材料请求账」种子同批铺出（`DEMO_MATERIAL_REQUESTS` 新增一行，不挂 `restrictionCause`——`restrictionNo` 恒 `null`，即「blocking:false」：她已有的 SILENT SANCTION 便签 scope=ALL 早已卡住全部能力，这条补料只是发一份中性话术，照 `sanction-disposition-workflow.service.ts#landPartial` 落地口径 `origin='OPERATOR_ISSUED'`、`issuedBy`=MLRO userNo）。

## 合规办公室种子（business seed，三义务 + 三供应商 + 四 RI 席位，2026-09-27 战役甲波四 Task 7）

`seedComplianceObligations()` / `seedOutsourcingVendors()` / `seedResponsibleIndividuals()`（`prisma/seed.business.ts`，紧随 `seedAmlFilingFamily()` 之后）同样直铺快照数据（不走各自 Service，没有 operator、不写审计——「留痕」由 e2e 证，同上方两个报送台种子节先例）。三张表互不依赖，也不依赖客户/事件/报送单种子行（spec §10：两册与义务台账均无横向外键）。单号用 `buildDeterministicNo('OBL'|'VEN'|'RI', seedKey)` 派生、`upsert` 保幂等，reset 重铺后逐字不变。

### 合规日历义务台账（三行，全部对外申报）

| 义务 | obligationNo | frequency | authority | basisNote | nextDueAt |
|---|---|---|---|---|---|
| VARA Monthly Regulatory Return | `OBL2601015484` | MONTHLY | VARA | CRM Rulebook Part I, Rule I.H.1 | 铺场时刻起下一个自然月末 |
| VARA Quarterly Report | `OBL2601011955` | QUARTERLY | VARA | CRM Rulebook Part I, Rule I.H.2 | 铺场时刻起下一个自然季末 |
| VARA Annual Report incl. audited financials | `OBL2601017307` | ANNUAL | VARA | CRM Rulebook Part I, Rule I.H.3 + I.G.1 | 铺场时刻起下一个自然年末 |

⚠️ `nextDueAt` 相对**铺场时刻**取下一自然期末（`nextPeriodEnd()`，`prisma/seed.business.ts`）——不是固定日期，每次 `stack.sh reset` 重铺都保证落在未来（闹钟墙开箱即非空、不会因久未 reset 而集体显示成"已超期"）；`obligationNo` 逐字不变（只吃 seedKey，不吃时间）。MLRO 季报／EWRA（内部风险自评）／牌照年费三条经 spec §9 二手多源交叉调研后判组织件不建（裁定 10，收件方非监管，与内幕名单同判），不铺种子；截止天数一手条文未规定的行，`basisNote` 只写查实的条款号，不补想象中的宽限天数。

### 外包商登记册（三行）

| 供应商 | vendorNo | 外包内容 | criticality | contractStart |
|---|---|---|---|---|
| Sumsub | `VEN2601019644` | KYC/AML 身份核验与筛查 | MATERIAL | 2025-01-01 |
| HexTrust | `VEN2601017083` | 数字资产托管（TRON 网络钱包基础设施） | MATERIAL | 2025-01-01 |
| Gulf Office Systems | `VEN2601019912` | 办公室 IT 支持 | NON_MATERIAL | 2025-06-01 |

与波一「外包商断供」事件（`outsourcing-kyc-relay-degraded`，`subjectRefs.vendor=SUMSUB`）的呼应是纯叙事，不建外键、不建联动（spec §4.1，YAGNI）。

### RI（受托责任人）登记册（四席位，零在途换人）

| 岗位 | riNo | 现任人 | varaRef | effectiveFrom |
|---|---|---|---|---|
| MLRO | `RI2601011344` | Farah Al Mansoori | VARA-RI-001 | 2025-01-01 |
| Compliance Officer | `RI2601013891` | Youssef Haddad | VARA-RI-002 | 2025-01-01 |
| CFO | `RI2601015148` | Elena Novak | VARA-RI-003 | 2025-01-01 |
| CISO | `RI2601019215` | Marcus Tan | VARA-RI-004 | 2025-01-01 |

演示合理集、非法定名录（spec §4.2 钉死）；`incumbentName` 是自然人姓名，与 IAM 账号无外键、无联动——岗位对齐本仓既有角色管理员人设（`seed.base.ts` `ROLE_SEED_ACCOUNTS` 同角色代码：MLRO/COMPLIANCE_OFFICER/CFO/CISO），人名避开与既有客户演示人名（Alice…Mona）及迪拜团队真实超管人名（Roger…Rhea）撞号。四席全 `ACTIVE`、`pendingApprovalNo` 恒 `null`——换人全弧（提案→高管批→落地）由 e2e 现场演（spec 场景 22），不预铺在途态。

⚠️ 闹钟墙开箱判据（Ruling R2）：核实波三 `seedAmlFilingFamily()` 的 PNMR 样例（`FIL2601012321`，见上「报文族种子」表）本身即 `DRAFT` 态、`deadlineAt` 非空——落在 `FILING_CLOCK_WALL_STATUSES`（DRAFT/PENDING_SIGNOFF/SIGNED_OFF）内，重铺后即在墙上；本任务未额外补报送单样例。

## 投诉种子（business seed，三样例，2026-09-28 战役甲波五 Task 7）

`seedComplaints()`（`prisma/seed.business.ts`，紧随 `seedResponsibleIndividuals()` 之后）同样直铺快照数据（不走 `ComplaintsService`，没有 operator、不写审计——「留痕」由 e2e 证，同上方各种子节先例）。三张单全挂在 **Bob Happy**（既有 happy 客户，唯一另挂的演示位是材料请求黄档提醒，域不重叠）名下，演一位客户在三个不同投诉阶段的剧本；`complaintNo` 用 `buildDeterministicNo('CMP', seedKey)` 派生、reset 重铺后逐字不变；时间戳全部相对**铺场时刻**取（同义务台账 `nextDueAt` 先例），不锚死日历日期。

| 样例 | complaintNo | category | 状态 | submittedAt | 关键字段 |
|---|---|---|---|---|---|
| ① 新到 | `CMP2601014294` | FEES | RECEIVED | 铺场时刻−1 天 | 确认钟（7 天）在跑；零 entries（照 `submit()` 真实行为） |
| ② 临近死线 | `CMP2601017476` | SERVICE | INVESTIGATING | 铺场时刻−26 天 | 已确认（`acknowledgedAt`=submittedAt+1 天）已立案；裁决钟（submittedAt+28 天）还剩 2 天——⚡/延期演示起点；一条 ACK entry |
| ③ 全档 | `CMP2601012261` | ORDER_EXECUTION | RESOLVED | 铺场时刻−40 天 | 确认（+2 天）→内部备注（+10 天）→延期（+21 天，钟改判 submittedAt+56 天）→裁决 `PARTIALLY_UPHELD`（+34 天，在延期后 56 天窗口内）；entries 三类 CLIENT_MESSAGE（ACK/EXTENSION_NOTICE/FINAL_RESPONSE）齐 + 一条 INTERNAL_NOTE |

⚠️ 三行 `submittedAt`/`ackDeadlineAt`/`resolveDeadlineAt`/`acknowledgedAt`/`extendedAt`/`resolvedAt` 都相对**铺场时刻**回拨，不是固定日期——每次 `stack.sh reset` 重铺，②的"还剩 2 天"效果会重新从铺场当下起算，但 `complaintNo` 逐字不变（`buildDeterministicNo` 只吃 seedKey，不吃时间）。entries 的 `actorNo`：ACK/EXTENSION_NOTICE/INTERNAL_NOTE 落 `ops_officer@fiatx.com` 的固定 `userNo`（`ADM2501010008`，rbac.catalog.ts `COMPLAINT_WRITE` 唯一持有职务）；FINAL_RESPONSE 落 `'SYSTEM'` 字面量，同 `applyResolution()` 真实行为（裁决生效是系统动作，无 actor）。

## LP 兑换台种子（business seed，两档案 + 一张历史单，2026-09-29 战役乙波一 Task 9）

`seedLpDesk()`（`prisma/seed.business.ts`，紧随 `seedCapitalInjection()` 之后——历史单卖出腿要扣公司 AED 起始余额，注资必须先落地）照该函数的直写形态铺快照数据：不走 `LpProfileService`/`LpExchangeWorkflowService`（链路长、依赖 Nest DI/事件总线/审批服务，seed 脚本走裸 `PrismaClient`+`tigerbeetle-node`，服务直调铺数走不通），手写镜像并逐行对齐 `lp-exchange-workflow.service.ts` 的真实记账/回单形态。`lpNo`/`exchangeNo`/`approvalNo`/资金单号均用 `buildDeterministicNo` 派生，reset 重铺后逐字不变。

### 两档案

| LP | lpNo | 状态 | 结算坐标 | approvalNo |
|---|---|---|---|---|
| Falcon Liquidity FZE | `LPP2601010183` | ACTIVE | Mashreq Bank PJSC（AED IBAN）+ TRON 地址 | `APR2601015507`（真实 `ApprovalCase`+`ApprovalStep` 背书，CFO 单步 APPROVED——评审 R15 补种，见下方「审批背书」段） |
| Dune OTC DMCC | `LPP2601017193` | SUSPENDED | RAKBANK（AED IBAN）+ TRON 地址 | 无（种子直落 SUSPENDED，不经历"先批准再停用"的迁移路径） |

Falcon 建档写一条 `LP_PROFILE_CREATED` 审计（`actionDomain=TREASURY`，`reason` 非空——契约 `requiredFields=['reason']`，`writeSeedAudit` 2026-09-29 起支持覆盖默认 CONFIG 域 + 传 `reason`，见 `prisma/seed-audit.helper.ts`）；Dune 不写审计（同其余种子表"没有 operator、不写审计"先例）。

**审批背书（评审 R15 甲案，2026-09-29 修复轮）**：Falcon 建档（`APR2601015507`，`LP_PROFILE_APPROVAL`）与历史单（`APR2601015999`，`LP_EXCHANGE_APPROVAL`）各配一条真实 `ApprovalCase`+`ApprovalStep`（CFO 单步，status=APPROVED），`objectSnapshot` 逐字对齐 `lp-profile-workflow.service.ts#initiateCreate`/`lp-exchange-workflow.service.ts#initiate` 的真实快照形状（零 UUID）。补种原因：详情页 `approvalNo` 非空即渲染链接，占位号此前点进去是 `Approval not found` 死链——演示者最可能点开的两个页面（Falcon 档案 / LPX 历史单）都会撞上，故补真实背书替换占位值。

### 一张 SUCCESS 历史单

`LPX2601016429`（挂 Falcon）：卖 50,000 AED 买 13,600 USDT（示例价 3.6765，手填口径，非实时行情）。三腿资金单全部终态 `CLEARED`：

| 腿 | fundsOrderNo | 资产 | 金额 | 账本分录（code） | 借/贷 | 外部参考 |
|---|---|---|---|---|---|---|
| 1 卖出 | `FDO2601017173` | AED | 50,000 | 84 `LP_EXCHANGE_PAY` | DR `E.FIRM_OPS` / CR `A.FIRM_ASSET` | `referenceNo`（FIAT，`fakeBankRef`） |
| 2 买入落前厅 | `FDO2601017269` | USDT | 13,600 | 85 `LP_EXCHANGE_RECEIVE` | DR `A.FIRM_ASSET` / CR `E.FIRM_LIQ` | `txHash`（CRYPTO，`fakeChainTxHash`） |
| 3 验收转 | `FDO2601015607` | USDT | 13,600 | 86 `LP_EXCHANGE_ACCEPT` | DR `E.FIRM_LIQ` / CR `E.FIRM_OPS` | `txHash`（CRYPTO） |

三腿各配 1 条 `tbTransferEvidence` + 2 条 `accountFlow` 镜像（`AccountFlowProjectorService` 的真实行为：debit→OUT / credit→IN）——**3 条 evidence + 6 行 account_flows**（这是三腿的真实记账镜像；真实 workflow 的托管回单本身是 4 行非 6 行，见下一句）。托管回单（`external_statement_lines`/`external_balances`）不铺：`seedCapitalInjection` 模板本身也不写它，且 `recon:demo` 铺场脚本每次都会把外部账单从 `account_flows` 重铸一遍（`simulated-custodian-statement.service.ts` 头注释），本笔的 `account_flows` 镜像已经在库里，无需预先复制——**重铺后对账活证据见 `baseline.md`「F_LIQ 对账直比判据」节**：`recon:demo:pass` 实测 F_LIQ(USDT) 钱包在检且 `bucket=MATCHED matchedCount=2`（腿2 IN + 腿3 OUT 两行配对），`recon:demo:break` 18/18 场景不受干扰。

**种子后（`stack.sh reset self`，`demo:all` 跑之前）的期望余额**（实测坐实）：F_LIQ（USDT）归零（85 进 86 出，净 0）；F_OPS(AED) 从注资起点 1,000,000 减至 **950,000**（−50,000）；F_OPS(USDT) 从注资起点 100,000 加至 **113,600**（+13,600）。三个时间戳字段（`executedAt`/`deliveredAt`/`settledAt`）相对**铺场时刻**回拨 3/2/1 天，不锚死日历日期（同上方各种子节先例）。

## 公司资金种子（business seed，两张 CIN 壳单 + 一张 PAY 历史单，2026-09-29 战役乙波二 Task 9）

`seedCompanyFunding()`（`prisma/seed.business.ts`，紧随 `seedLpDesk()` 之后）照该函数的直写形态铺快照数据：不走 `CapitalInjectionWorkflowService`/`VendorPaymentWorkflowService`（同 LP 的理由——链路长，seed 脚本走裸 `PrismaClient`+`tigerbeetle-node`，服务直调铺数走不通）。`cinNo`/`payNo`/`approvalNo`/资金单号均用 `buildDeterministicNo` 派生，reset 重铺后逐字不变。

### 两张 CIN 壳单（复用既有账，账本零新增）

`seedCapitalInjection()`（1936 行起）早就把两条 CAPITAL_INJECTION（码 70）分录 + evidence + accountFlow 写进库了（`sourceType='SEED_CAPITAL'`，`externalRef='SEED-CAPITAL-<CUR>'）。本函数只补上那两条分录本该配的 `CapitalInjection` 壳单行 + 一张 APPROVED 审批单 + 一张 CLEARED 资金单壳——**不新开分录**，壳单与既有账的关联纯靠 `externalRef` 复用同一个值（spec §8「plan 实测」定案）：

| 币种 | cinNo | 金额 | approvalNo | fundsOrderNo | 资金单外部参考 |
|---|---|---|---|---|---|
| AED | `CIN2601011488` | 1,000,000 | `APR2601011192`（`CAPITAL_INJECTION_APPROVAL`，CFO 单步 APPROVED） | `FDO2601018332` | `referenceNo=SEED-CAPITAL-AED` |
| USDT | `CIN2601013475` | 100,000 | `APR2601015426`（`CAPITAL_INJECTION_APPROVAL`，CFO 单步 APPROVED） | `FDO2601013407` | `txHash=SEED-CAPITAL-USDT` |

出资方统一 `FiatX Holdings Ltd (founding shareholder)`，`prudentialPurpose='Initial operating capital under prudential capital plan'`，`status=SUCCESS`，`receivedAt=settledAt=` 种子运行时刻。资金单终态 `CLEARED`（`FundsOrderStatus` 现名，非 `CapitalInjection.status` 的 `SUCCESS`），`legSeq=1`，`fromWalletId=null`（外部出资方无坐标，坐标落 `fromAddress`/`fromIban` 一行文本）。

### 一张 PAY 历史单（HexTrust，AED 2,500，新增码 87 一条分录）

`payNo=PAY2601015456`：挂 `vendor-hextrust`（`vendorNo=VEN2601017083`），`payeeAccountRef='AE07 0331 2345 6789 0123 456 (HexTrust AED settlement)'`，`purposeNote='HexTrust 2026-08 custody fee'`，`prudentialPurpose='Discharge outsourced custody service fee obligation'`，`status=SUCCESS`。审批单 `APR2601011194`（`VENDOR_PAYMENT_APPROVAL`，CFO 单步 APPROVED）。资金单 `FDO2601011571`（direction OUT，终态 `CLEARED`，`referenceNo=ZB202608317AB0AB0088`，`fakeBankRef` 派生）。`effectiveDate`/`executedAt`/`settledAt` 钉死常量 `2026-08-31T08:00:00Z`（评审 Imp#1 修复轮：初版按「种子运行时刻的上月末」动态算，与写死的 `purposeNote` 叙事月份必然脱钩、且绕开了 `business-date.util`——改钉固定时刻后 `effectiveDate=2026-08-31`，与 `purposeNote` 逐字对应，不再随重铺月份漂移）。

账本新增一条：code 87 `VENDOR_PAYMENT`，DR `E.FIRM_OPS` / CR `A.FIRM_ASSET`，AED ledger，2,500.00 元（250,000 分）——`deterministicTransferId('SEED_VENDOR_PAYMENT', 'AED', 'VENDOR_PAYMENT', 0)`；配 1 条 `tbTransferEvidence` + 2 条 `accountFlow` 镜像（debit→OUT / credit→IN，同 LP 卖出腿 84 先例）。

**种子后（`stack.sh reset self`，`demo:all` 跑之前）的期望余额**（实测坐实）：F_OPS(AED) 从 LP 卖出腿之后的 950,000 再减至 **947,500**（−2,500，即码 87 一条出账）；F_OPS(USDT) 不动（本任务零 USDT 出账）。三张种子表没有 operator，不写审计（同其余种子表先例——LP 兑换单本身也是零审计，仅 LP 档案登记写审计）。

## 客户协议种子（business seed，两版本 + 13 条同意，2026-10-03 战役丙波三 Task 1）

`seedCustomerAgreements()`（`prisma/seed.business.ts`）直铺，不经 `AgreementsReadService`（没有 operator、不写审计，同上方各种子节先例）。正文**不落库**，住代码登记处 `src/modules/identity/agreements/agreement-versions.constant.ts`。

| 表 | 行数 | 内容 |
|---|---|---|
| `customer_agreement_versions` | **2** | `v1` = `EFFECTIVE`（`effectiveAt` 取早于最早种子客户注册日的固定日，不相对运行时；原七节 + 两处 14→30 天订正）／`v2` = `DRAFT`（v1 + 第 V 节追加投诉时限 7/28/56 天；第十幕现场由合规官提交发布） |
| `customer_agreement_consents` | **13** | 13 位 demo 客户（上方客户矩阵全员）各一行 `ACCEPTED v1`，`actedAt` = 各自注册时间——**种子客户全部只同意过 v1**，所以第十幕⚡快进 v2 后全库被拦 DEPOSIT/SWAP（演完须重铺，见 `script.md` 第十幕） |

`demo:all` **零协议动作**，v2 全程 DRAFT；`customer_notifications` 无 `AGREEMENT` 行、审计无 `AGREEMENT_*` 行。判据见 `baseline.md` 协议种子三断言。第十幕演员 Kate Trader（`demo_kate@`）的点名依据见 `script.md` 场景 33。

## 各脚本造什么

| 命令 | 产出 |
|---|---|
| demo:setup | 基础演示位（客户便签/材料请求账等） |
| demo:deposit / swap / withdraw | 各域多结局单（走真实流程推进） |
| demo:in-transit | 在途单（演示"正在发生"） |
| demo:all | 一键全量（花名册 29 笔逐条比对预期终态 + COA 四恒等式）——开演前跑这个 |
| recon:demo:pass / break | 对账 pass ／ **18 个破口场景 / 12 张案子** + 答案键（按处置家族排号 1→18 = 第六幕走查顺序；`rootCause` 用成因注册表的码，与财务手册、界面菜单、审计四处同词。**18/18 全检出**）；账龄线 3 天（⚡拨钟）；小额线 AED 100 / USDT 30；场景 10 处置 = 挂起·调查中 → 超期 → 核销（金库开单、CFO 批）；场景 16 处置 = 认损（金库开单、CFO 批）→ 补款划转（金库发起、CFO 批、⚡ 一腿）；场景 17 = 垫款划转（法币两腿经结算户）→ 认领退汇；场景 18 = 事故登记（Jack USDT-TRON 钱包当刻全部余额 400 USDT 幽灵 OUT，无任何单据；登记→调查→定损→通报→善后→结案六步，认损后金库补款划转复位余额） |

⚠️ 造数铁律：一律走真实流程/模拟端点重放，**禁止直插表**（直插中间态 → 账本负余额 → 假破口，实证教训）。

## 本批数据（`demo:all` 最近一次实到结果）

<!-- GENERATED:BEGIN -->
> 本段由 `demo:all` 收尾自动写入（`scripts/demo-lib.ts → renderDataMdSnapshot`），别手改——下次跑会整段覆盖。
> **只收录跨重铺稳定的列**：单号（`DEP…`/`SWP…`/`WDR…`）内嵌日期+随机后缀、每次跑都变，收录进来会让 `git diff data.md` 永远有噪音、失去"行为有没有变"的判据作用（也让工作树无故变脏）。**要当次的真实单号，看 `demo:all` 运行时打印的花名册**——那份是当场的、准的。

### 充值（18 笔）

| # | 场景 | 客户 | 金额 | 预期终态 | 实到状态 | 结果 |
|---|---|---|---|---|---|---|
| 1 | 充值 · 正常入账 USDT | demo_alice@example.com | 3000 USDT | SUCCESS | SUCCESS | ✓ |
| 2 | 充值 · 正常入账 AED | demo_bob@example.com | 260000 AED | SUCCESS | SUCCESS | ✓ |
| 3 | 充值 · 正常入账 AED（二） | demo_grace@example.com | 6500 AED | SUCCESS | SUCCESS | ✓ |
| 4 | 充值 · 等客户补料 | demo_alice@example.com | 4200 AED | ACTION_PENDING | ACTION_PENDING | ✓ |
| 5 | 充值 · 转人工复核 | demo_bob@example.com | 5100 AED | MANUAL_CHECKING | MANUAL_CHECKING | ✓ |
| 6 | 充值 · 小额挂起 | demo_grace@example.com | 35 AED | OPERATION_PENDING | OPERATION_PENDING | ✓ |
| 7 | 充值 · 制裁冻结 | demo_frank@example.com | 7300 AED | FROZEN | FROZEN | ✓ |
| 8 | 充值 · 没收（钱进公司） | demo_grace@example.com | 42 AED | CONFISCATED | CONFISCATED | ✓ |
| 9 | 充值 · 退回原发款方 | demo_alice@example.com | 2600 AED | RETURNED | RETURNED | ✓ |
| 10 | 充值 · 上缴（政府移交） | demo_frank@example.com | 9100 AED | SEIZED | SEIZED | ✓ |
| 21 | 充值 · FRANK 本金（供 #13 建单垫资） | demo_frank@example.com | 2000 AED | SUCCESS | SUCCESS | ✓ |
| 22 | 充值 · 素材（Grace USDT） | demo_grace@example.com | 1200 USDT | SUCCESS | SUCCESS | ✓ |
| 24 | 充值 · 素材（Jack AED 大额） | demo_jack@example.com | 5000 AED | SUCCESS | SUCCESS | ✓ |
| 25 | 充值 · 素材（Jack AED 小额） | demo_jack@example.com | 1500 AED | SUCCESS | SUCCESS | ✓ |
| 26 | 充值 · 素材（Jack USDT） | demo_jack@example.com | 400 USDT | SUCCESS | SUCCESS | ✓ |
| 27 | 充值 · 素材（Kate AED 大额） | demo_kate@example.com | 4000 AED | SUCCESS | SUCCESS | ✓ |
| 28 | 充值 · 素材（Kate AED 小额） | demo_kate@example.com | 1200 AED | SUCCESS | SUCCESS | ✓ |
| 29 | 充值 · 素材（Kate USDT） | demo_kate@example.com | 350 USDT | SUCCESS | SUCCESS | ✓ |

### 兑换（4 笔）

| # | 场景 | 客户 | 金额 | 预期终态 | 实到状态 | 结果 |
|---|---|---|---|---|---|---|
| 11 | 兑换 · USDT→AED 成功 | demo_alice@example.com | 1400 USDT | SUCCESS | SUCCESS | ✓ |
| 12 | 兑换 · AED→USDT 成功 | demo_bob@example.com | 2900 AED | SUCCESS | SUCCESS | ✓ |
| 13 | 兑换 · 制裁冻结（押锁待处置） | demo_frank@example.com | 600 AED | FROZEN | FROZEN | ✓ |
| 23 | 兑换 · 素材（Grace AED→USDT） | demo_grace@example.com | 800 AED | SUCCESS | SUCCESS | ✓ |

### 提现（7 笔）

| # | 场景 | 客户 | 金额 | 预期终态 | 实到状态 | 结果 |
|---|---|---|---|---|---|---|
| 14 | 提现 · 法币成功 | demo_alice@example.com | 1200 AED | SUCCESS | SUCCESS | ✓ |
| 15 | 提现 · 虚拟币成功 | demo_bob@example.com | 150 USDT | SUCCESS | SUCCESS | ✓ |
| 16 | 提现 · 法币成功（二） | demo_grace@example.com | 900 AED | SUCCESS | SUCCESS | ✓ |
| 17 | 提现 · 等客户补料 | demo_alice@example.com | 1800 AED | ACTION_PENDING | ACTION_PENDING | ✓ |
| 18 | 提现 · 大额待审批 | demo_bob@example.com | 250000 AED | PENDING_APPROVAL | PENDING_APPROVAL | ✓ |
| 19 | 提现 · MLRO 冻结 | demo_grace@example.com | 1500 AED | FROZEN | FROZEN | ✓ |
| 20 | 提现 · 卡在半路（对账用） | demo_alice@example.com | 500 AED | PAYOUT_PENDING | PAYOUT_PENDING | ✓ |

**花名册：29/29 符合预期**

### 账本恒等式（COA）

| 恒等式 | 结果 |
|---|---|
| COA CLIENT(AED): CLIENT_ASSET == Σ(CLIENT_PAYABLE+DEPOSIT_SUSPENSE) | ✓ 29612565 == 29612565 |
| COA FIRM(AED): FIRM_ASSET == Σ(FIRM_OPS+FIRM_SET+FIRM_LIQ+INCOME_SWAP_FEE+INCOME_WITHDRAW_FEE+INCOME_OTHER) | ✓ 94620335 == 94620335 |
| COA CLIENT(USDT): CLIENT_ASSET == Σ(CLIENT_PAYABLE+DEPOSIT_SUSPENSE) | ✓ 4392571811 == 4392571811 |
| COA FIRM(USDT): FIRM_ASSET == Σ(FIRM_OPS+FIRM_SET+FIRM_LIQ+INCOME_SWAP_FEE+INCOME_WITHDRAW_FEE+INCOME_OTHER) | ✓ 114013428189 == 114013428189 |
<!-- GENERATED:END -->
