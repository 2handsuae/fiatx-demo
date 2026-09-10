# 演示总剧本（script）

> 七幕主线：**开店 → 迎客 → 钱进 → 钱换 → 钱出 → 账对 → 事后说得清**。
> 本文件是**人读的剧本，不是测试**——永远不会"挂"。
> 运行三原则：① 剧本不跑，造数脚本只在模块收尾闸跑；② 脚本挂了 = 代码删多了 → 改代码，**禁止改脚本迁就**；③ 造数一律走真实流程重放（模拟按钮同一套端点），**禁止直接插表**——直插中间态会把账本扣负、对账全是假破口（实证教训）。

**环境**：main 栈（API 3000 ｜ 管理台 3001 ｜ 客户端 3002）。开演前重铺：`bash scripts/stack.sh reset-main` → `bash scripts/on-stack.sh main demo:all`。管理台 admin@fiatx.com / 123456（登录页 Quick Login 面板可一键切 8 职务）；客户端用 demo_* 种子客户（见 data.md）——客户端登录页同样有 Quick login 面板，11 位种子客户一键登录，剧本里所有「切客户端 demo_*」步骤都可走它。

---

## 第一幕 · 开业（V1 治理 + V3 财务配置）

**讲什么**：客户来之前，这家店先立起来——而且每一步都有人批、有痕迹、每个人只能动自己那一块。
**造数**：base seed 自带 11 个职务管理员（超管/高管/CISO/MLRO/DPO/内审/合规官/财务负责人/金库专员/技术官/运营，一人一角色，密码统一 123456，名册见 data.md）+ 资产/费率/限额/交易对已配、权限包目录 **12 域 51 桶、零空域**。
**收敛为 6 站**，每站定人定页定预期，maker（提单）与 checker（批准）分别标出：

**站 0 · 进人**（先有人，再有权——管理员的一生）
账号：`tech_admin@`（技术官，maker，邀请阶段）→ `ciso@`（CISO，checker）；停用/恢复换 `ciso@`（CISO，maker）→ `sm@`（高管，checker）；新人视角用浏览器隐身窗
走查：① `tech_admin@` 成员页 Invite Member（角色选 OPS_OFFICER，邮箱现编）→ 审批中心出现邀请审批 → ② 换 `ciso@` 批准 → entityRef 直接点回新人的成员详情页（不用去列表翻）→ ③ 复制激活链接（通知是空壳，链接就在卡片上——这是演示装置，讲清）→ 隐身窗打开：确认身份 → 扫 QR 绑 TOTP（任意认证器 App）→ 首登完成上岗 → ④ 回 `ciso@` 原窗口提停用 → `sm@` 批准 → 新人刷新页面即被登出（下次请求失效）→ ⑤ `ciso@` 再提恢复 → `sm@` 批准 → 复活
期望：邀请/停用/恢复三案全是 maker/checker（邀请是技术官/CISO 一对，停用恢复是 CISO/高管另一对，没人自批自己那单）；管理员的一生五步连贯；第一幕开场审计页就有货（站 0 自己产证据）

**站 1 · 谁能动手**（权力是拼出来的，拼权力本身也过门）
账号：`tech_admin@`（技术官，maker）→ `ciso@`（CISO，checker）
走查：① 成员页看 11 个职务账号 → ② 角色页点开一个角色，看它由哪些**权限包**拼成（12 域 51 桶全在场）→ ③ 技术官给运营（`ops_officer@`）加一个它没有的包（如"查看证据包"）→ 提交角色定义修改审批单（侧栏 Identity & Access 下也有「Role Requests」页，两个 tab 分装绑定变更与定义修改两类申请单，被拒会标 REJECTED 徽章）→ ④ 换 CISO 登录批准 → 生效，运营刷新后新能力立刻出现 → ⑤ 换 `auditor@`（内审）跑一次对账批次 → **403**（内审 28 组里零 Manage、零业务 Act，这就是它存在的意义）→ ⑥ 切审计页按 actorNo 查内审账号 → 那条 `ADMIN_ACCESS_DENIED` 查得到——『默默拦下也是被禁止的』当场兑现。⚠️ **别用"建证据包"当例子**——那一个接口内审是有权限的（`AUDIT_EXPORT_CREATE`，刻意给的：监管上门他得能打包，且导出仍要 MLRO 背书），拿它演会当场绿给观众看
期望：能力从"干不了"变"干得了"；改权限自己也是一张单；只读角色天生碰不到写接口；拦下的动作本身也留痕（403 不是日志真空）

**站 2 · 一笔配置要过门**（配置有身世）
账号：`cfo@`（财务负责人，maker）→ `ops_officer@`（运营，checker）；切客户端 `demo_grace`（VIP）与 `demo_alice`
走查：① 费率页给兑换费改一档 → 财务负责人提交（费率写权限现为财务独有）→ ② 换运营账号登录批准 → ③ 切客户端拿一次报价 → ④ 对照：Grace 与 Alice 各输入 **1000 USDT**（金额要 ≥ 500——选档只比平费不比点差，`demo:all` 造数把 STD Tier 1 平费压到 10，100 USDT 时 Grace 也会落 STD 档）拿一次 USDT→AED 报价——Grace 命中 `VIP-USDT-AED`（VIP 标签），Alice 命中 `STD-USDT-AED`（默认档）：够格的档里选最便宜（预览即对照：预览区 `Matched:` 行已把档位代码与分层号一起显示——Grace `VIP-USDT-AED / VIP-USDT-AED-TIER-002`、Alice `STD-USDT-AED / STD-USDT-AED-TIER-002`；2026-09-05 修复前预览拿不到身份，两人都先显示 STD 档；确认页的报价响应才刻意不带档位代码，看的是费用与点差数字）→ ⑤ 财务对某档点 Retire（理由）→ 运营批准 → 列表筛 RETIRED 看得到它；对 `STD-USDT-AED` 点 Retire 会被拒（最后一个默认档不可退）
期望：报价当场变（直通第四幕）；受众档与默认档同屏对照；"删" = 退役终态不是消失；提单人是财务、批的人是运营，两条线不落一人

**站 3 · 门自己也要过门**（规则不能被规则的管理员悄悄改）
账号：`sm@`（高管，maker）→ `ciso@`（CISO，checker）；硬互斥与自批环节单用 `ciso@`；超时演示换 `treasury@`（⚡ 按钮不挂 RBAC 判断、任何人都点得到，但后端 `simulate-timeout` 真要 `DEMO_CLOCK_WRITE`——11 个职务里独此一家，2026-09-10 对账平账两角色定案后归金库，sm@ 点会当场 403）
走查：① 高管提交一条审批策略变更 → ② 换 CISO 登录批准，生效 → ③ 换 CISO 自己提一条策略变更 → 自己审批 → 当场被拒（同一账号不能既提又批）→ ④ 给已持 CISO 的成员加 MLRO → 拒绝（三对硬互斥之一：CISO⊥MLRO）→ ⑤ `sm@` 再提一张策略变更 → 换 `treasury@` 登录，详情页点 ⚡ 模拟超时 → 一分钟内刷新 → 状态 EXPIRED，审计按该单号查得到 APPROVAL_EXPIRED（谁都没批，时间到了）；顺带看策略页——刚被改过的那条 Source 徽章已从 DEFAULT 翻成 CUSTOMIZED
期望：批准 / 当场拒绝 / 超时作废三种结局都演到

**站 4 · 资产管控**（暂停就是总开关；上币不在这页）
账号：`ops_officer@`（运营，maker）→ `ciso@`（CISO，checker）；切客户端 `demo_alice`
走查：① 资产页打开 USDT-TRON——身份字段一屏看全：网络 TRON、合约 `TR7N…`（防诈骗字段）、TRC-20、19 个确认、托管方资产键 → ② 点 Suspend 填理由提交 → 详情出现待批徽章 + 审批单号 → ③ 换 `ciso@` 批准 → 状态 SUSPENDED → ④ 切客户端 alice：充值 / 兑换 / 提现三个页面的下拉里 USDT 同时消失（三页共读 `GET /assets?status=ACTIVE`）；**而且绕过界面直接打接口也做不成新交易**——资产可用性是 L1 第十项，兑换 / 提现建单当场 403 并留 `SWAP_/WITHDRAW_L1_BLOCKED` 痕；已经在路上的单照走完，已经到账的钱照收（见 ⑤） → ⑤ ⚡ 暂停期间喂 150 USDT：客户端 alice 充值页 ⚡ Simulate Deposit（不用先选资产）→ 弹窗资产选 `USDT-TRON · TRON — SUSPENDED` → 金额 150 → Confirm Simulation → 管理台 Funds Orders 里 ⚡ 链上可见 → ⚡ 确认到账 → 管理台充值列表看单 COMPLIANCE_PENDING，详情 L1 十项面板资产格红、挂起原因 ASSET_SUSPENDED（**先合规后挂起**：L2 照筛）、已送检 → ⚡ 喂「① Approved」→ 单子转 OPERATION_PENDING 等运营（Release Hold 按钮出现） → ⑥ 回 `ops_officer@` 提恢复 → `ciso@` 批 → ACTIVE → USDT 重新出现在三个下拉里 → ⑦ 运营 Release Hold → SUCCESS，账本页看客户应付 → ⑧ 审计页**按资产业务号 `AS2601012024` 查**（这个号就在第 ① 步那张详情页上，对外识别一律用业务号——铁律⑥）：USDT-TRON 的一生五行同屏。审计页默认按时间**倒序**，所以 `ASSET_SEEDED`（actor `RELEASE`，metadata 带版本与 commit）是**最下面那一行**——它是这个资产履历的起点（actor `RELEASE`，metadata 带版本与 commit），随后是刚做的两条人的戏（`ASSET_SUSPENSION_REQUESTED` → `ASSET_SUSPENDED` → `ASSET_REACTIVATION_REQUESTED` → `ASSET_REACTIVATED`）。**关键词搜索只覆盖主字段**——同一个号换填 **Advanced ▾ 展开后的 Related No 栏**（后端 `subjectNo` 过滤：查次主体，不是 Entity No）（次主体专用）再查一次，除资产自己的履历外，还能看到被它拦下的单（`SWAP_L1_BLOCKED` / `DEPOSIT_L1_HELD` / `DEPOSIT_HELD`）——上币走开发流程随版本上架，管理台没有"新建资产"。⚠️ **不要按 `USDT` 搜**：审计关键词只覆盖 action / 主体类型 / 主体号 / 操作人 / 归属客户 / traceId / 理由，`USDT-TRON` 只存在于 `afterData` 里，搜不到（2026-09-04 波一终审实证）
期望：两个人的戏（运营提、CISO 批）；暂停当场让三条路都选不到 USDT、新单 403，但在途的单照走完、已到账的钱照收；配置的身世从装载那一刻就有

**站 5 · 三种门与容器**（钱放在哪、拦在哪一刻）
账号：`ops_officer@`（运营，maker）→ `sm@`（高管，checker）；钱包与地址环节 `treasury@`（金库专员）；切客户端 `demo_alice`；首个法币账户用尚无法币地址的种子客户（见 data.md「地址簿种子」）
走查：① 限额页按类型筛选（单笔／累计／大额）各看一眼，说清三种门在哪一刻拦人 → ② 改一条单笔限额 → 运营提交 → 详情待批徽章 → 换高管账号批准（限额裁决人是高管，非运营自批；规则从种子来，这页没有新建）→ ③ 托管钱包页（`treasury@`）只读看容器：按 vault 分五组，每行 = 一个网络上的一个地址（7 行平台 + 客户地址行），余额去账本页看 → ④ 切客户端登记一个 TRON 地址（选网络不选资产）→ 24h 冷却倒计时（走秒；到期那一秒列表自动刷新为 ACTIVE）→ 三拍：a) 冷却期内 Cancel registration；b) 再登记一条 → `treasury@` 详情 ⚡ Skip Cooling Period（理由必填，后门留痕）→ ACTIVE → Force Suspend → Unsuspend；c) 用尚无法币账户的种子客户登记首个银行账户 → 即时生效
期望：三种门各在哪一刻拦人；容器是 vault × 网络不是资产；冷却闸的例外规则与后门都有痕

**审计不设站**（业主口径）：第一幕负责**产证据**，第七幕负责取证——本幕的每个动作都是第七幕要拉出来的证据链。

## 第二幕 · 迎客（V2 客户与合规）

**讲什么**：客户是谁、能不能交易，由合规说了算；开户全程可以现场走一遍——不是种子摆拍；被调查的人自己不知道。
**造数**：种子 11 位客户覆盖 8 种状态位（快乐×2/制裁静默/认证中/新注册/高风险/VIP/企业/明示受限/对账素材×2——名册见 data.md；9 位 ACTIVE 客户开户日已回填 2026-06-15、CDD 五列已铺、早出新客窗）。客户端与管理台共享一个 Simulation 开关（管理台顶栏「Simulation」，cookie 跨端口共享）：本幕全程要开着——关着的话认证页会去接真 Sumsub SDK，打不通。
**走查**：① **静态矩阵**：客户列表看状态与标签，11 位客户逐条对上 data.md 名册的状态位与便签；② **现场开户 · CDD 直通**（低风险客户全程一次过，不经人审）：客户端 `/register` 注册（邮箱现编 `demo_live1_<当天日期>@example.com`，一次性——重演换个新邮箱，不依赖 reset；条款抽屉须拉到底才能勾）→ 提交后跳登录页登录 → 未 ACTIVE 客户落 gate 页 Start verification → 认证页 `/onboarding/verify` 五字段 CDD 表单（姓名预填、其余必填）→ Submit → 切 `compliance_lead@` 该客户详情「⚡ Onboarding Simulation」区 Approve (GREEN) → 客户端刷新：gate 直接消失、进主界面（低风险 GREEN 一步到 ACTIVE，不经审批）→ 客户详情 Tags 区新增一枚「新客」标签（NEW_CUSTOMER，衍生标签，开户 30 天内自动带）→ 客户端 `/withdrawal-addresses` 登记首个法币账户（即时生效，解交易起始门）→ 回管理台该客户详情，Tags 区「新客」标签仍在 → 切 Swap Fee Levels 页打开 `NEWCUST-USDT-AED` 档详情，侧栏 Audience 读到「新客」——讲一句"他 30 天内的报价按这档计费，比默认档便宜"→ 对照拍沿用第一幕站 2 惯例：切客户端 Alice 与 Grace 各输入 1000 USDT（USDT→AED，同一金额，避开被 demo:all 压过的 STD Tier 1）——Alice 命中 `STD-USDT-AED / STD-USDT-AED-TIER-002`（flat 20），Grace 命中 `VIP-USDT-AED / VIP-USDT-AED-TIER-002`（flat 12）——讲词收在"这位现场客户的新客档（flat 16）正好卡在两者中间"（现场客户此刻零余额，Swap 页「You Sell」输入框被余额钳制，UI 上当场看不到他自己的报价预览——第⑤拍他现场入金回来再看，就是这份预览的完整版，现场自见）；旁支 RED-RETRY：第二位现场客户同样注册、登录、提交 CDD → `compliance_lead@` 改点 Reject – Retry → 客户端刷新 gate 页 "Application declined."／Retry verification → 点击直接回认证页续走（之前填的资料还在，原样重交即可）；③ **现场开户 · EDD 高风险**（第三位现场客户）：注册 → 登录 → Start verification → CDD 表单提交 → `compliance_lead@` 该客户详情 Escalate to EDD（仅 basic-cdd-level 且已提交材料时可点）→ 客户端刷新页面：gate 页仍是 Continue verification（lifecycle 没变，只是认证模板换了）→ 认证页模板已切 EDD_UPLOAD：Source of Funds (SoF) / Source of Wealth (SoW) 两个虚线占位框 → Submit documents → `compliance_lead@` Approve (GREEN)——这次 GREEN 落 PENDING_APPROVAL，不直通 ACTIVE（EDD 客户要过人审）→ 切 `ops_officer@` 该客户详情 Submit for Approval → 填理由 → 出准入审批单号 → 切 `sm@` 审批中心批准（后果原话读得到 customerNo：「高风险客户准入核准：CUxxx（EDD 尽调已在 Sumsub 完成，GREEN）——批准即开户 ACTIVE，限额与费率按默认档生效」）→ 客户端刷新：ACTIVE 进主界面；一句讲词——"MLRO 的审在 Sumsub 完成，我方批的是接不接这个客户关系"，这一单不是重审尽调；④ **便签联动**（原②③④保留 + 材料请求站）：Carol（制裁静默）——管理台看得到便签，**切客户端登录 Carol：什么都看不出来**（零痕迹）；Ivy（明示受限）——客户端能看到受限提示；现场给一位客户开限制 → 三个交易域的动作立刻停；材料请求站：切 `compliance_lead@` 一位已 ACTIVE 客户详情「Verification Requests」区 Request Documents → 发一条材料请求（如 Proof of Address）→ 客户端 Profile 页出现横幅（阻断态标题"… required"／提醒态"… needs refreshing"，CTA Verify now）→ 点开 `/verification/:requestNo` 假上传提交 → 管理台那一行转 SUBMITTED，Approve／Reject · Retry／Reject · Final 三个裁决按钮现身，同一套 GREEN/RED 语义；⑤ **档位升级**（承接②那位现场客户，此刻仍是 `BASIC`、零余额）：客户端充值页 ⚡ Simulate Deposit（不用先选资产）→ 弹窗资产选 `USDT-TRON` → 金额 40000 → Confirm Simulation → 切管理台 Funds Orders 该单 ⚡ OBSERVE_CONFIRMING → ⚡ CONFIRM → ⚡ CLEAR → 充值单自动转 COMPLIANCE_PENDING 走 KYT 筛查 → 切 `compliance_lead@` ⚡ 喂裁决 Approved → SUCCESS，客户端余额到账 40000 USDT（讲一句：他②那一刻 GREEN 转 ACTIVE 时，TB 账本户已经在后台被静默开好——审计页按他的客户号查得到一条 `CUSTOMER_LEDGER_PROVISIONED`，波二"现场注册客户演不了入金"那道钳制到这一步解除，这是他第一次真的往里面存钱）→ 客户端 Swap 页卖 30000 USDT→AED，Swap Now → Confirm and Swap——**不再弹浏览器 alert**，确认框里直接冒出一条红框提示「Daily limit exceeded — remaining 100000 AED」+「Need more headroom? Upgrade your tier」，确认框本身不关（限额闸拦在记账之前，没钱动、没账动）→ 点 `Upgrade your tier` 跳 Profile 页「Trading tier」节：Current tier `BASIC` + 四行两档限额对照表（SWAP／WITHDRAWAL 各按 DAILY／MONTHLY，Basic、Premium 两列都有数）——讲一句"刚才那道红线，就是这张表的第一行"→ 点 `Upgrade to Premium →` → 建单跳补料页 `/tier-upgrade/verify`：两个虚线占位框 Proof of Address (PoA) / Source of Funds (SoF) → `Submit documents` → 回 Profile 卡片文案已翻「UPGRADE STARTED — SUBMIT YOUR DOCUMENTS」→ 切管理台该客户详情「Tier Upgrade」卡：Application 行读到单号与 `IN_REVIEW` → 「⚡ Tier Upgrade Simulation」区 Approve (GREEN) → 单转 `MATERIALS_CLEARED`，卡片下方 `Submit for Approval` 按钮现身 → 点开填理由 → 出验收审批单号 → 切 `sm@` 审批中心批准 → 回详情页：Current Tier 翻 `PREMIUM`、Acceptance approval 行读到批准单号与 `APPROVED` → 回客户端 Profile：Current tier 已是 `PREMIUM` → 回 Swap 页重新走一遍同样的 30000 USDT→AED 报价 → Confirm and Swap，这次直接成交，账本页看得到钱真的动了——讲一句"限额门是实时按档位判的，同一笔生意，人升级了它就放行"；旁支一句：管理台若刚才喂的是 ⚡ Reject – Retry（RED-RETRY），申请单打回补料、会话原地重开（不迁移状态、不终止申请），客户端 Profile 卡片显示「UPGRADE STARTED — SUBMIT YOUR DOCUMENTS」与 `Continue` 按钮，客户当场续交材料即可，不用重新登录、也不用重新申请。
**期望**：观众看懂四件事——① 限制是人的属性，静默与明示是两种合规姿态（tipping-off）；② 开户全程可以现场走完，不靠种子摆拍；③ CDD 直通与 EDD 人审是同一条状态机上的两条真实路径——低风险一步到 ACTIVE，高风险多一道人审，不是两套系统；④ 交易限额按档位实时生效，升级不是客户自己点一下就翻牌——材料要过合规、单子要过高管核准，跟开户一样是两道真人门。

## 第三幕 · 钱进（V4 充值）

**讲什么**：一笔钱从链上/银行进来，要闯几道门；闯不过去的钱有四种下场。
**造数**：`demo:deposit`（各结局单）+ ⚡模拟面板现推。
**走查**：① Alice 客户端发起充值 → 管理台看单进 KYT 筛查；② ⚡按钮喂裁决：通过 → 入账，客户余额变；③ 喂"制裁命中" → 先冻人再冻单 → 冻结单走 MLRO 审批处置：**上缴**（政府移交）或**解冻**（平反回炉）——被制裁的钱**不能没收进公司、不能退回给被制裁者**；④ **没收**在小额挂起单上演（豁免/没收二选一）、**原路退回**在人工复核单上演（目的地锁死原发款方）——四条弧各有各的舞台（资金单 + 账本逐腿可见）；⑤ 每一步切账本页看钱的物理位置。
**期望**：观众看懂"状态机每条边都是业务决定；钱的每一步都有账"。

## 第四幕 · 钱换（V6 兑换）

**讲什么**：客户拿报价换币，平台四条腿记账，大额过合规。
**造数**：`demo:swap` + ⚡模拟面板。
**走查**：① Alice 客户端拿报价（费率来自第一幕配的等级）→ 确认——**下单瞬间卖出金额即上锁**（切账本看画圈，与提现同律）；② 管理台看单与四腿资金单；③ ⚡喂合规裁决演冻结终态（FROZEN 零出边，**锁当场擦除退回余额**——终态不押钱，押人靠限制账）。
**期望**：观众看懂"一次兑换 = 卖出腿+买入腿+费腿的原子记账；报价费率与客户等级挂钩"。

## 第五幕 · 钱出（V5 提现）

**讲什么**：钱出去的门最多——地址白名单、限额、审批、补料。
**造数**：`demo:withdraw` + ⚡模拟面板。
**走查**：① Alice 提现到已绑定地址 → 正常放行到账；② 演补料：喂"要求补材料" → 客户端出现补料入口（Sumsub 内嵌）→ 交齐续走；③ 演冻结：**切客户端看——只显示"处理中"中性文案**（tipping-off 双防）；④ 大额单过 SMO 审批门。
**期望**：观众看懂"出金的每道门；客户永远看不到调查原因"。

## 第六幕 · 账对（V8 对账）

**讲什么**：内部账和外部世界对不对得上；对不上的**怎么查、怎么处置**。
**造数**：pass 场景 `recon:demo:pass`；break 场景 `recon:demo:break`（**18 个场景 / 12 张案子** + **答案键**——脚本铺完打印每条的钱包、成因码、预期桶，你手里有标准答案）。

**开场先立公理（一句话，别跳）**：**外部资料是权威。** 银行对账单、托管方余额说是多少就是多少——所以**没有「对方错了」这一档**，一切不平只有三种性质：我方账**错了** / 我方账**缺了** / **时机没到**。
**第二句（2026-09-08 处置改版，责任模型翻转）**：屏幕上能看见的只有 6 个格子（三种不平形状 × 客户/公司两个池子），**差异行上直接长着处置按钮**——按格出、按记账事实过滤（账务上开不出单的选项按钮天生不出现，比如兑换来源的行没有冲正 / 冲销按钮）。**错误责任归财务，系统流程不担责**：点按钮出一个弹窗，原因码 + 单据字段 + 查证说明一次填完；20 个成因里机器只认得出一个（重复入账的同参考号双胞胎），其余全靠人判断，但**判断的是财务，不是系统替他判**。
**第三句（过渡语）**：冲正 / 冲销 / 补记 / 改记 / 补单三路 / 挂起两种——这些处置本身现在是**金库一人一窗完成**（选按钮、选原因码、填说明，动钱的一次提交即原子开单）；送 **CFO** 单步复核，挂起零账务不送审。**2026-09-10 对账平账两角色定案**（业主裁定：对账平账只留金库与 CFO，运营整组清零、不拆组不双持）：账龄 ⚡ 拨钟、资金单页 ⚡ 推腿、事故登记连同登记之后的调查 / 升级 / 定损 / 通报 / 结案前全部步骤，此前部分留在运营手里，现在整组一并迁金库——运营在本幕彻底清零——侧栏连 Reconciliation 组 / Incident Register 都不再出现，只剩 Funds Orders 一个只读列表页；结案两步门（`mlro@` → `cfo@`）不变。

**走查步骤**：
① `recon:demo:pass` 跑一遍 → 记分牌全绿，先让观众看到"平"长什么样
② `recon:demo:break` 跑一遍 → 记分牌红：12 张案子（破口 9 ｜ 抵销 2 ｜ 在途 1）；案件**列表页**先扫一眼 **⚡ 场景气泡**——Disposition 列尾徽标悬浮出该案全部演示场景（场景号 + 成因 + 一句话 + 预期处置），仅模拟模式答案键在场时可见，讲的人手里那张标准答案就长在界面上
③ **按场景号 1→18 顺着走**——编号顺序就是处置家族顺序，一路走下来正好把本轮的处置全集演一遍：

| # | 讲什么 | 点什么 | 观众看到什么 |
|---|---|---|---|
| 1 | 钱在路上，不是差异 | `treasury@` Alice AED 案 → 资金单详情页「Push order」→ 回案件页「Re-reconcile」（2026-09-10 起推单与案件处置同一账号，不用切人）| 差额归零、案子自愈——处置闭环的实感 |
| 2 | 小数点错位：我方录错了 | `treasury@` Grace AED 案（展示位甲）那行点「**Correction**」按钮 → 原因单选 | 单选第一条「Amount misbooked」（方向/金额/生效日只读推导）→ 填 Investigation note → **Submit for CFO review** |
| 3 | 我方少记：形状和 2 一模一样 | 甲位第二行点「**Correction**」按钮 | **同一份原因单选**——机器分不出 2 和 3，是人查出来的 |
| 4 | 舍入精度差：钱其实已经到位 | 甲位第三行点「**Correction**」按钮 | 还是同一份原因单选；选「Rounding difference」→ Submit for CFO review（外部说 35.02 就是 35.02） |
| 5 | 手续费轧差：银行按净额入账 | **Bob AED 案（最干净，只挂这一条）**：`treasury@` 点「**Correction**」按钮 → 选「Bank fee netted」 | **原子一窗**：证据区只读（行金额/参考号/原单号）→ 方向/金额/生效日只读推导（附依据一句）→ Investigation note + Customer-facing note（已按成因预填，可改）→ **Submit for CFO review** |
| 5 续 | **冲正闭环走完** | `cfo@` 审批中心批准（单步，审批页显示的是后果原话）→ 切回 `treasury@` 回案件页「Re-reconcile」（⚠️ 若场景 9 还没演过，这次重对账会把它一并自愈——先演步骤 9 再点这里）| 案子 **Resolved**、那行变成「**Explained · ADJxxx**」链接 |
| 6 | 重复入账：唯一一条机器认得出的 | `treasury@` Frank AED 案（展示位乙）那行点「**Reversal**」按钮 → 选「Duplicate posting (twin)」 | 选中该项时下方多出 💡 **机器线索**：「The matched list has a twin entry with the same reference number and amount.」→ Submit for CFO review |
| 7 | 假信号入账：形状和 6 一模一样，**但一条线索都没有** | 乙位第二行点「**Reversal**」按钮 | **同格同形状、原因单选相同、线索区空白**——这一对是整幕最值钱的对照：证据有就给，没有就不编 |
| 8 | 记错客户：钱没动，主人记错了 | `treasury@` Jack AED 案那条「External only」行点「**Reattribute**」按钮 → 系统给出**对端候选**（同业务日 · 同资产 · 同金额 · 反向孤儿）→ 确认 Kate → 填查证说明 → 开单送审 → `cfo@` 批准 → 切回 `treasury@`「Re-reconcile」 | **一张单、两个案子同时 Resolved**；账上是两个客户的**应付对转**，**客户资产腿一分没动**——因为钱在托管里根本没动过 |
| 9 | 跨日切：时机没到 | `treasury@` Grace USDT 案那行点「**Hold · Next period**」按钮 → 选「Cross-period timing」→ 填查证说明 → 确认 | 徽标「Finding: Cross-period timing → Hold · Next period」；**不送审，零账务**，案子仍红。可顺带点「Re-reconcile」：日终截止把那条外部行收进来 → 案子自愈，这就是"下期自然平" |
| 10 | 查不出：已穷尽调查 → 账龄到线 → 核销 | `treasury@` 公司池那张案子（钱包号看脚本打印）那行点「**Hold · Investigating**」按钮 → 选「Unexplained (exhausted)」→ 填查证说明 → 确认 → 徽标「Finding: Unexplained (exhausted) → Hold · Investigating」，案子仍红 → 同一账号侧栏 **⚡ 「Fast-forward aging」**（模拟模式，2026-09-10 起拨钟与案件处置同一账号，不用切人）→ 一分钟后刷新，hero「Overdue by 1 day」、列表红标「Overdue」→ 同一行出现「**Write off**」→ 锁定视图（成因固定、方向 / 金额 / 生效日只读）→ 开单并提审 → 切 `cfo@`，审批页读后果原话「Firm-pool unexplained write-off: wallet … 差额 0.07 认损进运营资金；案件 … 已超期 1 天；查证结论：…」→ 批准 → 切回 `treasury@` 回案件页「Re-reconcile」（⚠️ 若场景 9 还没演过，这次重对账会把它一并自愈——先演步骤 9 再点这里）→ Resolved，那行「Explained · ADJxxx」 | **讲三道锁**：账龄 / 小额线 / CFO，少一道就是抹差异的后门 |
| 11 | 银行杂费：外面真扣了、我方没记 | `treasury@` 公司池费用那张案子那行点「**Record entry**」按钮 → 选「Bank charges unbooked」 | 公司自己的真实收支，只落账本分录、**不建资金单**——已完成的转账没有在途可追 |
| 12 | 银行利息：同一张案子的另一条 | 同案第二行点「**Record entry**」按钮 → 选「Bank interest unbooked」 | 两条补记把这张案子的异常全解释掉 → 直接回**已匹配**（11 与 12 在收盘上本来就对冲，残差是 0） |
| 13 | 漏监听的客户入金 | `treasury@` Bob USDT 案那行点「**Supplement**」按钮 → 选「Missed customer deposit」→ 填来源地址（链上格式）与理由 → 提交给 CFO | 徽标「Supplement · Deposit backfill · SIG…（pending CFO review）」；`cfo@` 批 → 充值列表多一张带「补录」小标的单，照常过 KYT / 合规筛查（⚠️ 这笔金额往往落在下限以下，会多一步 `ops_officer@` 在充值详情页「PASS · Waive Min-Limit」才到 SUCCESS——见下方注①）|
| 14 | 入金被退汇（法币） | `treasury@` Kate AED 案那行 OUT 点「**Supplement**」按钮 → 选「Deposit recalled」→「Claim recall」候选原单唯一命中（自动选中）→ 理由 → 提交给 CFO | 徽标「Supplement · Recall claim · DEP…（pending CFO review）」；`cfo@` 批 → Kate 那笔充值变「CLAWED BACK」，客户余额减；余额不够时系统直接拒、指路「Initiate advance」（场景 17 演）|
| 15 | 出金被银行退回（法币） | `treasury@` Grace AED 案第四行 IN 点「**Supplement**」按钮 → 选「Payout returned by bank」→「Claim return」候选原单唯一命中 → 理由 → 提交给 CFO | 徽标「Supplement · Return claim · WDR…（pending CFO review）」；`cfo@` 批 → Grace 那笔提现变「RETURNED」，本金 898（净额；毛额 900、手续费 2）重新记入余额，手续费不退（承接第五幕「钱出去了还能被银行退回来」那句话头）|
| 16 | 客户池小额查不出：认损 + 补款（二期） | `treasury@` Alice USDT 案那行点「**Hold · Investigating**」按钮 → 选「Unexplained (exhausted)」→ 填查证说明 → 确认 → 徽标「Finding: Unexplained (exhausted) → Hold · Investigating」→ 同一账号 ⚡「Fast-forward aging」→ 一分钟后刷新「Overdue」→ 同一行「**Recognize loss**」→ 锁定视图（成因固定「Client loss recognition」、方向 / 金额 7.5 / 生效日只读）→ 提审 → 切 `cfo@` 批（后果原话「Client-pool unexplained loss: customer CU… 差额 7.5 USDT 认损，客户余额相应减少……认损后由公司补款划转补齐」）→ 切回 `treasury@` 回案件页「Re-reconcile」→ **Resolved**，那行「Explained · ADJ…」旁出现「**Initiate compensation 7.5 USDT**」→ 点开（客户 / 钱包 / 金额全预填、不可改）→ 填理由 → 提交 → `cfo@` 批 → 切回 `treasury@` 资金单页找那张腿 ⚡ **SUBMIT** → 回案件页「Re-reconcile」→ Alice USDT 与运营户 TRON 各开一张**在途**案（琥珀，不红）→ 同一账号 ⚡ OBSERVE_CONFIRMING → ⚡ CONFIRM → 划转单 SUCCESS →「Re-reconcile」两张在途案自愈 → 客户端登 Alice 看 USDT 流水（2026-09-10 起拨钟与资金单推腿同归金库，本场景全程一个账号，不用切人）| **两步都有单、都有人批**：认损让账跟着外面走（案子愈），补款是对客户的交代（余额复位）。客户端两行：−7.5「Balance correction · Client loss recognition」、+7.5「Credit from FiatX · balance restoration」 |
| 17 | 入金被退汇、余额不足：垫款 + 认领（二期，法币两腿） | `treasury@` Grace AED 案第五行 OUT 6500 点「**Supplement**」按钮 → 选「Deposit recalled」→ 提交 → 行上显示「**Insufficient balance ≈X — Initiate advance**」（不是「Claim recall」）→ 点开（差额预填、不可改）→ 提交 → `cfo@` 批 → 切回 `treasury@` 资金单页：腿 1（运营户 → 结算户）⚡ SUBMIT / CONFIRM → 腿 2 自动出现（结算户 → Grace vIBAN）⚡ SUBMIT / CONFIRM → 划转单 SUCCESS，Grace 余额 = 6500（2026-09-10 起资金单推腿归金库，本场景全程一个账号）→ 回案件页，那行「Claim recall」回来 → 认领（候选原单唯一命中）→ `cfo@` 批 → 充值单 CLAWED BACK，Grace AED 归零 → `treasury@`「Re-reconcile」那行已匹配，整案看其它行 | **先垫后扣**：银行扣走的是 6500，她账上只剩几千（铺场时点约 3300，演到时以案件页显示为准），差额公司先垫、她欠公司（三期追索）。法币必须经结算户，所以是两腿；讲一句「结算户是过渡户，兑换的钱也这么走」 |
| 18 | 未授权转出：钱包被幽灵转出，无任何单据（三期开门） | `treasury@` Jack USDT 案那行 OUT 点「**Register incident**」按钮 → 选「Unauthorized outflow」→ 填查证说明 → 提交 → **自动跳转事故登记表单**（类型 / 来源案号 / 定性行号 / 客户 / 资产 / 金额已预填）→ 同一账号「登记」→ 事故详情页「开始调查」→ 添加两条调查记录 → 「记录升级」选 MLRO → 提交定损（口径选**认损**、勾"需要监管通报"、依据勾 TIR Rulebook K+H，72 小时倒计时随之出现）→ 保存草案 → 「已通报」填对外编号 → 回**案件页**，该行变回「**Recognize loss**」按钮（同 ⑯ 手法，金额锁定 = 定损额）→ 点开（成因 / 方向 / 金额只读）→ 提审 → 切 `cfo@` 批 → 切回 `treasury@` 回案件页「Re-reconcile」→ 案子自愈 **Resolved** → 回事故详情页「**Initiate compensation**」（认损单已落账，按钮自动出现）→ 跳回案件页点开（客户 / 钱包 / 金额全预填、不可改）→ 提交 → 切 `cfo@` 批 → 切回 `treasury@` 资金单页找那张腿 ⚡ **SUBMIT** → 回案件页「Re-reconcile」→ Jack USDT 与运营户 TRON 各开一张**在途**案（琥珀，不红）→ 同一账号 ⚡ OBSERVE_CONFIRMING → ⚡ CONFIRM → 划转单 SUCCESS →「Re-reconcile」两张在途案自愈、Jack 余额复位 → 回事故详情页把两张单挂上去（先挂认损调账单——状态自动转「处置中」；再挂补款划转单）→ 右栏「**提结案**」→ 两步审批：`mlro@` 先批 → `cfo@` 终批 → 事故 **CLOSED**（2026-09-10 对账平账两角色定案：事故登记到结案前的全部步骤——登记 / 调查 / 升级 / 定损 / 通报 / 挂载单据——与差异行处置同归金库一手，运营在事故域已彻底清零、连只读都没有，本场景全程不用切账号）| 事故走完一生六步——登记 / 调查 / 定损 / 通报 / 善后 / 结案；这一整条链现在全归金库一人（与其它处置同律）；认损让账跟着外面走（案子愈），补款是对客户的交代（余额复位，客户没错、公司担责）；结案是两个人的审批（MLRO + CFO），不是一人拍板 |
| 18 续 | 误登记也要走门：登记 → 撤回 | `treasury@` 事故列表页「**登记事故**」→ 类型选「人工登记」→ 随手填一条"以为是差异其实是正常波动" → 提交 → 事故详情页右栏「**撤回（误登记）**」→ 弹窗必填理由 → 提交 | 撤回不是删除：状态变 **已撤回**、理由留痕在基本信息卡「撤回理由」——误登记也是走门，不能悄悄消失 |
| 收尾 | 三笔补单批完后重对账 | `treasury@` 回任一案件页点「Re-reconcile」 | Bob USDT 案（场景 13）整案 **Resolved**；Kate AED、Grace AED 两案各自那一行差异都已匹配消失（补单确认生效），但两案还挂着本幕其它未处置的场景（8、2·3·4），**整案仍 Open**——不是补单没生效，是同一张案子还有别的差异没处置完，这正是"逐钱包逐笔看、不看总数"的活教材 |

⚠️ **场景 9 必须排在当天任何「Re-reconcile」之前演**：案件页「Re-reconcile」按当天日终截止重跑，会把 Grace USDT 那条跨账期的外部行收回窗口内、案子直接自愈——这正是场景 9 讲的"下期自然平"的真实触发机制。所以场景 9 的「Hold · Next period」定性要排在步骤 5 续的冲正闭环重对账、步骤 10 的核销闭环重对账、以及步骤 13-15 补单批完后的重对账**之前**演；顺序乱了也没关系，照实讲——"这条差异刚才被重对账自愈了，这就是下期自然平"。种子须在当天 UTC 18:00（迪拜 22:00）前铺；否则那条外部行落到次日，日终重跑收不回来，案子照旧红——照实讲。

⚠️ **注①：场景 13 的补录常撞金额下限门**：漏记入金往往是零头小额，容易落在该资产 DEPOSIT 单笔下限（AED / USDT 现都是 100）以下——CFO 批完补录后，新充值单不会直接到 SUCCESS，会先停在「小额挂起」，需要 `ops_officer@` 在充值详情页再点一次既有的「放行下限挂起」（PASS · Waive Min-Limit）才继续走完。这不是缺陷：低于下限的钱本来就该过这道门，补录不享有绕开它的特权。

⚠️ **注②：⚡ 裁决按钮要切账号**：场景 13 补录出来的新充值单若还要现场喂 KYT 裁决，用的 ⚡ 面板需要切到 `compliance_lead@fiatx.com`（持 `DEMO_VERDICT_WRITE`）——`ops_officer@` / `treasury@` / `cfo@` 都没有这个权限，用它们点会被 403 拒绝。

⚠️ **注③：全幕账号切换总表（2026-09-10 对账平账两角色定案，取代 2026-09-08 处置改版那版总表）**：本幕几乎全程一个账号——案件页**全部处置类按钮**（Correction / Reversal / Record entry / Reattribute / Supplement / Register incident / Hold · Next period / Hold · Investigating）、**Re-reconcile / 一键重对账**、⚡ Fast-forward aging（账龄拨钟）、资金单页 ⚡ 推腿（SUBMIT / CONFIRM / OBSERVE_CONFIRMING）、核销 / 认损开单（Write off / Recognize loss）、发起补款 / 发起垫款（Initiate compensation / Initiate advance），以及事故域从登记到结案前的全部步骤（登记 / 调查 / 升级 / 定损 / 通报 / 挂载 / 撤回）= **全部 `treasury@`**；所有审批批准 = `cfo@`；事故**提结案**是新加的两步门 = `mlro@` 先批 → `cfo@` 终批。运营（`ops_officer@`）本幕彻底退场——侧栏 Reconciliation 组（Runs / Cases / External Balances / Adjustments）与 Incident Register 都不再出现，直接改地址栏硬闯也是 403（对账三读面、事故域连只读都没了），只剩 Funds Orders 一个只读列表页。

⚠️ **注④：铺场前不得有在途划转**：`recon:demo:break` 会先清空全部外部账单再从账本流水重铸，划转结清后的流水会被一并重铸；但一张还在路上的划转（待批 / 执行中）铺场会当场报错——先 ⚡ 推到确认或撤回。演划转在途的那几分钟里不要去重对账公司池的案子（在途会把同钱包的抵销案暂判为破口，结清即回）。同一天内演完 16 / 17 / 18；跨日照实讲，次日 cron 会把两侧一起收进去。

⚠️ **注⑤：三期事故登记，2026-09-10 起全程一个账号**：差异行上点「Register incident」按钮、选「Unauthorized outflow」成因、填查证说明提交，到提交后自动跳转的登记表单起——登记 / 开始调查 / 添加记录 / 记录升级 / 提交定损 / 保存草案 / 标记已通报 / 挂载善后单 / 提结案 = **全部 `treasury@`**（`INCIDENT_WRITE` 已整组从运营迁金库，运营连事故域只读都不再持有，不存在"谁做都行"的选择）；案件页认损开单 / 发起补款也是 `treasury@`；认损与补款的批准 = `cfo@`；**唯独结案是新的两步门**——`mlro@` 先批、`cfo@` 终批，`treasury@` 自己提的结案单自己批不了（拿 `GOV_APPROVAL_READ` 能点到按钮，角色不在候选人里，403）。「撤回（误登记）」也是 `treasury@`——撤回权与登记权是同一把钥匙，不是额外授权。

④ 案件**列表页**扫一眼「**Disposition**」列（`3/5` = 已定性差异行 / 总差异行）——一屏就能看出哪些案子查过了、哪些还没人碰
⑤ 顺带讲内部恒等预门："对外之前先自证"，`verify:coa` 现场跑一遍全绿

**期望**：观众看懂三件事——① 对账不是对总数，是逐钱包逐笔找破口、开案、有下文；② **同一个形状底下成因可以完全相反，机器分不出、必须人去查**，所以按钮弹出的是"选原因码"不是系统自己判死；③ **查完不一定就能平**——挂起和留档同样是正经交付物（结论、查证说明、谁查的、什么时候），案子照旧红着；查完悬着的也不会永远悬着，账龄到线后系统逼出一个结论。

**已知缺口**：本轮做到**十件处置**（推单 / 冲正 / 冲销 / 补记 / 改记 / 挂起 / 核销 / 补单 / 划转 / **事故登记**）；豁免 / 容差不做（精度一致）；SWAP 来源的行没有冲正 / 冲销按钮（A1b 甲，账务上开不出单，BACKLOG 在案）。18 条里能平 **17** 条，场景 9 长红——**不许粉饰**。⚠️ 2026-08-31 那版剧本里「不该动账的行会显示一个错误按钮、正确演法是指出来别点」的警告早已作废；**2026-09-08 处置改版起「Record finding」两屏定性弹窗也退役**——现在每条差异行上直接是按格 × 记账事实过滤过的处置按钮组，点哪个按钮就是选哪个处置，不存在"先选成因再等系统判"这一步。

## 第七幕 · 事后说得清（V1 审计追溯）

**讲什么**：监管最爱问的一句——"这笔事，谁批的、依据什么、钱去哪了？"
**走查**：① 挑第三幕那笔被冻结→处置的充值，审计日志页按**单号**查 → 全链拉出（发起/筛查/冻结/审批/处置，每步谁、何时、结果）；② 按**客户号**查 Carol → 她名下所有被动过的事；③ 点进账本凭证核对钱的最终去向；④ 按 actorNo 查第一幕站 1 那位内审账号（`auditor@`）→ 拉出它当场触发的那条 `ADMIN_ACCESS_DENIED` 越权记录；⑤ 回到第五幕那笔大额待审批的提现，审计页用「关联单号」筛选输它的单号 → 捞出的不只是提现自己那条链，连它闯过的那张大额审批单也一起进画面——同一单号跨主体全链一屏可见。
**期望**：观众看懂"留痕不是日志文件，是能按人、按单、按旅程检索的证据链"。
**已知缺口**：三域交易日志**已全部换装新审计合同**（站1b-β/2-β/3-β，充值 47 码 / 提现 33 码 / 兑换 22 码，三查按单号·按客户·按旅程对三域均成立），链不再断在交易域；**V3 配置域词汇（限额/费率/资产/托管钱包/提现地址/客户标签）也已随四模块治愈换名册四批入册**，第一幕改的费率/限额那笔配置变更第七幕按单号查得到（此前"未入册"的缺口已解，见 `modules/v1-governance.md` §5）。剩一处：重铺后 `Q6 谁查过审计日志` 恒红，**管理员现场真查一次审计页当场转绿**——本幕走查①即含此动作，正常走就绿。
