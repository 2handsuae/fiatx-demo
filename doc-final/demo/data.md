# 演示数据字典（data）

> 上半篇（管理员/客户矩阵/资产钱包/各脚本）手写，2026-08-26 实测盘点后维护。下半篇「本批数据」由 `demo:all` 收尾自动写入生成区（防漂移），别手改那一段。
> 重铺入口：`bash scripts/stack.sh reset [main|self]`（含 TigerBeetle 清理重建）；全量造数：`bash scripts/on-stack.sh main demo:all`（worktree 内用 self）。基线见 [baseline.md](baseline.md)。

## 管理员（base seed，11 职务各一人，密码 123456）

admin@fiatx.com 超管 ｜ sm@ 高管(SMO) ｜ ciso@ ｜ mlro@ ｜ dpo@ ｜ compliance_lead@ ｜ tech_admin@ ｜ ops_officer@ ｜ auditor@ 内审 ｜ cfo@ 财务负责人 ｜ treasury@ 金库专员 —— 一人一角色，SoD 演示直接换人登录。

## 站 0 演示装置（进人）

邀请新成员时的四个演示细节：邮箱现场编一个，不必真实可达；MFA 绑定用任意 TOTP 认证器 App 扫码，不挑牌子；新人视角必须开一个浏览器隐身窗，与批准人的会话分开；邀请没有真发信——激活链接不走邮件，直接显示在管理台「成员详情」卡片上，复制过去就是新人要点的那个链接（通知本就是空壳，这是演示装置，讲清）。

## 客户矩阵（business seed，11 位，覆盖 8 种状态位）

9 位 ACTIVE 客户开户日已回填 `onboardingApprovedAt = 2026-06-15T09:00:00Z`、CDD 五列（生日/国籍/证件类型/证件号/住址）已铺——早出新客窗（NEW_CUSTOMER 衍生标签 30 天窗）。Carol、Frank 落 `edd-sof-sow-level`（EDD 档）；其余 7 位 ACTIVE 客户落 `basic-cdd-level`（CDD 档）。Dave（认证中）、Eve（刚注册）本身就是"开户流程中段/起点"的演示位，故意不回填。第二幕②③现场开户走查用的是当场新注册客户，不是这张表；现场注册客户即用即弃，重演换一个新邮箱，不依赖 reset。

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

## 事故种子（business seed，四条非初始态样例，2026-09-25 战役甲波一）

`seedIncidents()`（`prisma/seed.business.ts`）直接铺终态数据（不走 `IncidentService`，没有 operator、没有审批案、不写审计——与限制账 / 材料请求两组 fixture 同一性质），`incidentNo` 用 `buildDeterministicNo` 派生、reset 重铺后逐字不变。十类终盘里四个族各挑一个非初始态样例，覆盖 IMPACT/MONETARY 两档口径与 REGISTERED/INVESTIGATING/ASSESSED/RESOLVING 四个状态；**`CYBER_BCDR`（TECH_SECURITY 族）故意不进种子**，留给演示脚本现场走一遍完整登记流程，演"登记会留痕"这件事（见 `demo/script.md`）。

| 类型 | 状态 | 族 | 关键字段 |
|---|---|---|---|
| `DATA_BREACH` | ASSESSED | DATA | `subjectRefs`（受影响客户数 46 / 数据类别 Contact info,ID document）+ `impactSummary`；双通报依据码已勾（`PDPL_ART_9`+`TIR_II_C_24H`）但未标记已通报——Request Close 因通报未完成仍灰态 |
| `OUTSOURCING_FAILURE` | INVESTIGATING | TECH_SECURITY | `subjectRefs`（vendor + serviceImpact，登记时必填的两个锚）——还没定损 |
| `ASSET_NONCOMPLIANCE` | RESOLVING | OPERATIONS | 顶层 `assetCode=USDT-TRON`（唯一必填锚，命中顶层锚分流规则、不进 `subjectRefs`）+ 已挂一条 `ASSET_SUSPENSION_REF` 善后单——结案前只差提结案这一步 |
| `STUCK_TRANSACTION_MAJOR` | REGISTERED | OPERATIONS | 顶层 `customerNo`（Alice）+ `amount=15000.00` + `subjectRefs.orderNo`（动态锚）——刚登记，四态里最早的一态 |

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
| COA FIRM(AED): FIRM_ASSET == Σ(FIRM_OPS+FIRM_SET+INCOME_SWAP_FEE+INCOME_WITHDRAW_FEE+INCOME_OTHER) | ✓ 99870335 == 99870335 |
| COA CLIENT(USDT): CLIENT_ASSET == Σ(CLIENT_PAYABLE+DEPOSIT_SUSPENSE) | ✓ 4392571811 == 4392571811 |
| COA FIRM(USDT): FIRM_ASSET == Σ(FIRM_OPS+FIRM_SET+INCOME_SWAP_FEE+INCOME_WITHDRAW_FEE+INCOME_OTHER) | ✓ 100413428189 == 100413428189 |
<!-- GENERATED:END -->
