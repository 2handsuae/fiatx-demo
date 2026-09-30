# 演示总剧本（script）

> 八幕主线：**开店 → 迎客 → 钱进 → 钱换 → 钱出 → 账对 → 事后说得清 → 异常与监管**（第八幕 2026-09-28 战役甲收官定稿，收编场景 19–25，零改号、零动既有七幕——业主拍板岔口③，见 `decisions.md`）。
> 本文件是**人读的剧本，不是测试**——永远不会"挂"。
> 运行三原则：① 剧本不跑，造数脚本只在模块收尾闸跑；② 脚本挂了 = 代码删多了 → 改代码，**禁止改脚本迁就**；③ 造数一律走真实流程重放（模拟按钮同一套端点），**禁止直接插表**——直插中间态会把账本扣负、对账全是假破口（实证教训）。

**环境**：main 栈（API 3000 ｜ 管理台 3001 ｜ 客户端 3002）；或云端演示环境（同事自助，数据同样由 `demo:all` + `recon:demo:break` 铺好）：管理台 `https://admin-fiatx-demo.duckdns.org`、客户端 `https://fiatx-demo.duckdns.org`，重铺一套新数据 `npm run cloud:reset`（或双击仓库根「重铺数据.command」）。开演前重铺：`bash scripts/stack.sh reset-main` → `bash scripts/on-stack.sh main demo:all`。管理台 admin@fiatx.com / 123456（登录页 Quick Login 面板可一键切 8 职务）；客户端用 demo_* 种子客户（见 data.md）——客户端登录页同样有 Quick login 面板，11 位种子客户一键登录，剧本里所有「切客户端 demo_*」步骤都可走它。

---

## 第一幕 · 开业（V1 治理 + V3 财务配置）

**讲什么**：客户来之前，这家店先立起来——而且每一步都有人批、有痕迹、每个人只能动自己那一块。
**造数**：base seed 自带 11 个职务管理员（超管/高管/CISO/MLRO/DPO/内审/合规官/财务负责人/金库专员/技术官/运营，一人一角色，密码统一 123456，名册见 data.md）+ 资产/费率/限额/交易对已配、权限包目录 **14 域 68 桶、零空域**。
**收敛为 6 站**，每站定人定页定预期，maker（提单）与 checker（批准）分别标出：

**站 0 · 进人**（先有人，再有权——管理员的一生）
账号：`tech_admin@`（技术官，maker，邀请阶段）→ `ciso@`（CISO，checker）；停用/恢复换 `ciso@`（CISO，maker）→ `sm@`（高管，checker）；新人视角用浏览器隐身窗
走查：① `tech_admin@` 成员页 Invite Member（角色选 OPS_OFFICER，邮箱现编）→ 审批中心出现邀请审批 → ② 换 `ciso@` 批准 → entityRef 直接点回新人的成员详情页（不用去列表翻）→ ③ 复制激活链接（通知是空壳，链接就在卡片上——这是演示装置，讲清）→ 隐身窗打开：确认身份 → 扫 QR 绑 TOTP（任意认证器 App）→ 首登完成上岗 → ④ 回 `ciso@` 原窗口提停用 → `sm@` 批准 → 新人刷新页面即被登出（下次请求失效）→ ⑤ `ciso@` 再提恢复 → `sm@` 批准 → 复活
期望：邀请/停用/恢复三案全是 maker/checker（邀请是技术官/CISO 一对，停用恢复是 CISO/高管另一对，没人自批自己那单）；管理员的一生五步连贯；第一幕开场审计页就有货（站 0 自己产证据）

**站 1 · 谁能动手**（权力是拼出来的，拼权力本身也过门）
账号：`tech_admin@`（技术官，maker）→ `ciso@`（CISO，checker）
走查：① 成员页看 11 个职务账号 → ② 角色页点开一个角色，看它由哪些**权限包**拼成（14 域 68 桶全在场）→ ③ 技术官给运营（`ops_officer@`）加一个它没有的包（如"查看证据包"）→ 提交角色定义修改审批单（侧栏 Identity & Access 下也有「Role Requests」页，两个 tab 分装绑定变更与定义修改两类申请单，被拒会标 REJECTED 徽章）→ ④ 换 CISO 登录批准 → 生效，运营刷新后新能力立刻出现 → ⑤ 换 `auditor@`（内审）跑一次对账批次 → **403**（内审 28 组里零 Manage、零业务 Act，这就是它存在的意义）→ ⑥ 切审计页按 actorNo 查内审账号 → 那条 `ADMIN_ACCESS_DENIED` 查得到——『默默拦下也是被禁止的』当场兑现。⚠️ **别用"建证据包"当例子**——那一个接口内审是有权限的（`AUDIT_EXPORT_CREATE`，刻意给的：监管上门他得能打包，且导出仍要 MLRO 背书），拿它演会当场绿给观众看
期望：能力从"干不了"变"干得了"；改权限自己也是一张单；只读角色天生碰不到写接口；拦下的动作本身也留痕（403 不是日志真空）

**站 2 · 一笔配置要过门**（配置有身世）
账号：`cfo@`（财务负责人，maker）→ `ops_officer@`（运营，checker）；切客户端 `demo_grace`（VIP）与 `demo_alice`
走查：① 费率页给兑换费改一档 → 财务负责人提交（费率写权限现为财务独有）→ ② 换运营账号登录批准 → ③ 切客户端拿一次报价 → ④ 对照：Grace 与 Alice 各输入 **1000 USDT**（金额要 ≥ 500——选档只比平费不比点差，`demo:all` 造数把 STD Tier 1 平费压到 10，100 USDT 时 Grace 也会落 STD 档）拿一次 USDT→AED 报价——Grace 命中 `VIP-USDT-AED`（VIP 标签），Alice 命中 `STD-USDT-AED`（默认档）：够格的档里选最便宜（预览即对照：预览区 `Matched:` 行已把档位代码与分层号一起显示——Grace `VIP-USDT-AED / VIP-USDT-AED-TIER-002`、Alice `STD-USDT-AED / STD-USDT-AED-TIER-002`；2026-09-05 修复前预览拿不到身份，两人都先显示 STD 档；确认页的报价响应才刻意不带档位代码，看的是费用与点差数字）→ ⑤ 财务对某档点 Retire（理由）→ 运营批准 → 列表筛 RETIRED 看得到它；对 `STD-USDT-AED` 点 Retire 会被拒（最后一个默认档不可退）
期望：报价当场变（直通第四幕）；受众档与默认档同屏对照；"删" = 退役终态不是消失；提单人是财务、批的人是运营，两条线不落一人

**站 3 · 门自己也要过门**（规则不能被规则的管理员悄悄改）
账号：`sm@`（高管，maker）→ `ciso@`（CISO，checker）；硬互斥与自批环节单用 `ciso@`；超时演示换 `treasury@`（评审修复后 ⚡ 按钮已挂 `DEMO_CLOCK_WRITE` 门控——后端 `simulate-timeout` 真要这个权限码，11 个职务里独此一家，2026-09-10 对账平账两角色定案后归金库；`sm@` 等其余职务详情页直接看不到这颗按钮，不是点了才 403）
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

**站 3.1 · 充值起步**（进 KYT 筛查）
账号：客户端 `demo_alice`
走查：客户端发起充值 → 切管理台看单
判据：单据进入 KYT 筛查态（COMPLIANCE_PENDING）

**站 3.2 · 裁决通过入账**
走查：⚡ 按钮喂「① Approved」
判据：单转 SUCCESS，客户余额同步变化

**站 3.3 · 制裁命中**（先冻人再冻单）
账号：切客户端登录 `demo_jack@example.com`（此前完全无限制的种子客户；**不用 frank**——frank 在 base seed 里已经是永久 SANCTION 客户，拿他做本站只会复现"创建即冻"，验证不了本站要的"先正常入 KYT 排队、再被裁决打回"这段两截式因果）
走查：充值页现场 Simulate Deposit（资产 USDT-TRON，金额随意）→ 链上确认后单据正常进 COMPLIANCE_PENDING → ⚡ 按钮喂「⑦ Rejected · Sanctions（客户本人）」
判据：客户先被打上制裁限制、单据随之冻结（FROZEN）——人和单是两笔账，先后可见

**站 3.4 · Carol（SILENT）创建即冻**
账号：切客户端登录 Carol（`demo_carol@example.com`，种子即 ACTIVE + SANCTION SILENT）
走查：充值页 ⚡ Simulate Deposit（资产选 USDT-TRON，Unhosted wallet，金额随意）→ Confirm Simulation → 切管理台 Funds Orders 该笔资金单，模拟面板 ⚡ Seen in Mempool → ⚡ Confirm
判据：客户端历史列表该笔充值显示 **PROCESSING**（与旁边 SUCCESS/其它单据观感一致，无横幅——SILENT 零痕迹）；切管理台该充值详情，状态已是 **FROZEN**，审计页查得到成对 `DEPOSIT_PAYIN_COMPLETED` → `DEPOSIT_FROZEN`——走的是充值域既有 L1 FREEZE 分支（未新增代码），Carol 建单入库那一刻就已经是冻的，客户面看不出来

**站 3.5 · 没收与原路退回**（另外两条弧）
走查：冻结单走 MLRO 审批处置——**上缴**（政府移交）或**解冻**（平反回炉，被制裁的钱不能没收进公司、不能退回给被制裁者）；**没收**在小额挂起单上演（豁免/没收二选一）、**原路退回**在人工复核单上演（目的地锁死原发款方）
判据：四条弧各自终态在资金单 + 账本逐腿可查

**站 3.6 · 账本物理位置**
走查：每一步切账本页看钱的物理位置
判据：账本余额随每一步实时同步变化

**站 3.7 · 受限客户充值横幅**（不拦动作）
账号：切客户端第二幕④"现场开限制"那位客户
走查：打开充值页
判据：顶部出现受限横幅，但**不拦动作**——措辞"钱仍会到账，收下后按受限处置"，与提现/兑换页"动作被禁"话术刻意不同（该限制 scope=ALL 才会在充值页出现；Ivy 的材料过期便签 scope 只含 WITHDRAW/SWAP，充值页不显示；Carol/Frank 的制裁冻结是 SILENT，横幅同样不出现，tipping-off 不受影响，见 `decisions.md` 2026-09-12 条与 `modules/v4-deposit.md` §4）

**期望**：观众看懂"状态机每条边都是业务决定；钱的每一步都有账"。

## 第四幕 · 钱换（V6 兑换）

**讲什么**：客户拿报价换币，平台四条腿记账，大额过合规。
**造数**：`demo:swap` + ⚡模拟面板。

**站 4.1 · 拿报价下单即上锁**
账号：客户端 `demo_alice`
走查：Swap 页拿一次报价（费率来自第一幕配的等级）→ Confirm
判据：卖出金额下单瞬间即上锁——切账本页看画圈（与提现同律）

**站 4.2 · 管理台看单**（四腿资金单）
走查：切管理台该笔换汇详情
判据：单据与四条腿资金单（卖出/买入/费用等）逐腿可见

**站 4.3 · 合规裁决冻结**（押锁待处置）
走查：⚡ 模拟面板喂「⑦ Rejected · Sanctions（客户本人）」
判据：单转 **FROZEN**——2026-09-14 裁定翻案后，FROZEN 是**押锁待处置的中间态**，不再是"零出边终态、冻结当场擦锁退回余额"：切该客户 Overview，卖出金额仍算 locked（出生锁没放），要等解冻续走或拒退才真正动锁

**站 4.4 · ⑨ 调查扣审 vs ⑦ 制裁冻结**（两制度讲词）
走查：对照本幕站 4.3 用的「⑦ Rejected · Sanctions」与第五幕站 5.3（Grace 提现）用的「⑨ Rejected · MLRO freeze」两个按钮，分别打开各自客户的详情页
判据：⑦ 命中会连带开客户级 SANCTION 限制——人被冻，名下所有域在途单一并连坐（如站 4.3 这张单）；⑨ 只冻这一张单——Grace 的客户详情没有任何限制标签，她的其它单据、其它域照常能走。这是"调查扣审"（三域冻单不冻人）与"制裁冻结"（唯一动人）两种制度的分野，讲词不能混着说

**站 4.5 · 兑换解冻审批闭环**
账号：`compliance_lead@`（合规主管，maker）→ `mlro@`（checker）
走查：承接站 4.3 冻住的那张单 → 详情页侧栏「Frozen Disposition」点「Initiate Unfreeze」，填关联单号与理由 → 提交 → 切 `mlro@` 审批中心批准 → **批准后 5 分钟内**回到该单详情页 ⚡ 喂新裁决（如「① Approved」）收尾——这一步不是顺带可选，是明确要做的下一步
判据：批准那一刻单转回 **COMPLIANCE_PENDING**（RESUME），出生锁原封不动仍押着（该客户 Overview locked 金额不变）；侧栏 SLA 区块同步重新起计时——5 分钟窗口、后端每 30 秒一轮 cron 扫描，倒计时现场肉眼可见。5 分钟内喂裁决收尾即正常结算；讲一句兜底：若窗口到点还没人喂裁决，下一轮 cron 自动把单判 **REJECTED**、出生锁这才放回余额——这正是"解冻回到正常审核轨道，就要过正常审核的时限"这条制度的体现，不是特赦，钱退回客户，不算事故。另一条出边「Reject & Refund」（`ops_officer@` 提、`mlro@` 批）直接转 **REJECTED**，同样这一刻锁才真正放回余额——"解冻续走"不动锁、"拒退"（无论人工提的还是 SLA 超时判的）才动锁，两条出边处置口径不同

**期望**：观众看懂"一次兑换 = 卖出腿+买入腿+费腿的原子记账；报价费率与客户等级挂钩"。

## 第五幕 · 钱出（V5 提现）

**讲什么**：钱出去的门最多——地址白名单、限额、审批、补料。
**造数**：`demo:withdraw` + ⚡模拟面板。

**站 5.1 · 正常提现放行到账**
账号：客户端 `demo_bob`（⚠️ alice 在本幕站 4.3 已被「⑦ Rejected · Sanctions」连坐打上客户级 SANCTION 限制，她的新提现会被同一限制折叠冻结、演不出"正常放行"——勿用 alice，换 bob）
走查：提现到已绑定地址
判据：单正常放行、余额到账

**站 5.2 · 补料闭环**
走查：⚡ 喂"要求补材料" → 客户端出现补料入口（Sumsub 内嵌）→ 交齐续走
判据：补料交齐后单据续走出补料态

**站 5.3 · 冻结中性文案**
账号：客户端 `demo_grace`
走查：提现页现场新建一笔提现（Fiat → AED → 选她已绑定的银行账户，金额随意）→ 提交 → 切管理台该笔详情（此时仍 COMPLIANCE_PENDING）→ ⚡ 喂「⑨ Rejected · MLRO freeze」→ 切客户端看该单
判据：单转 **FROZEN** 后，客户端列表仍只显示"处理中"（PROCESSING）中性文案（tipping-off 双防），看不出被冻结、也看不出在被调查——与她其它正常单据观感一致
（⚠️ 不要点 demo:all 预铺的 #19——那张单 `demo:all` 铺场时已经被驱到 **FROZEN** 终态，SimulationPanel 对 FROZEN 单据的裁决按钮会置灰点不动；#19 留着当"现成的冻结单+审计链"范例翻给观众看即可，现场喂裁决要用本站新建的这张）

**站 5.4 · Frank（SANCTION）创建即冻**
账号：切客户端登录 Frank（`demo_frank@example.com`）（⚠️ **不用 Carol**——她种子即 SANCTION、充值恒被"创建即冻"折叠、从不进可用余额，标准预铺态下她两种资产可用余额永远是 0，提现表单填额度点提交会静默无网络请求、演不出本站；Frank 走的是花名册自己的模式：`demo:setup` 种子表 #21 在他被制裁**前**先垫了本金、#7 才把他打成 SANCTION，所以预铺完他仍有约 1,400 AED 可用余额）
走查：提现页拿报价 → 提交（金额约 200 AED 级，地址用他已登记的一条）
判据：客户端列表该单立即显示 **PROCESSING**（无横幅，与正常单据观感一致）；切管理台该提现详情，状态已是 **FROZEN**，L1 GATE 面板如实记 `CUSTOMER_RESTRICTION FAIL`（其余项 PASS）——建单入库即冻，不是先放行再追冻；讲一句：Frank 的钱是制裁前存入的（#21），制裁后新提现照收即冻——这正是"资产冻结"（人被冻、钱冻在账上）的真实形态，跟"从未有过钱"不是一回事

**站 5.5 · 大额审批门**
走查：大额单过 SMO 审批门
判据：待批单出现在审批中心，SMO 批准后放行

**期望**：观众看懂"出金的每道门；客户永远看不到调查原因"。

## 第六幕 · 账对（V8 对账）

**讲什么**：内部账和外部世界对不对得上；对不上的**怎么查、怎么处置**。
**造数**：pass 场景 `recon:demo:pass`；break 场景 `recon:demo:break`（**18 个场景 / 12 张案子** + **答案键**——脚本铺完打印每条的钱包、成因码、预期桶，你手里有标准答案）。

**开场先立公理（一句话，别跳）**：**外部资料是权威。** 银行对账单、托管方余额说是多少就是多少——所以**没有「对方错了」这一档**，一切不平只有三种性质：我方账**错了** / 我方账**缺了** / **时机没到**。
**第二句（2026-09-08 处置改版，责任模型翻转）**：屏幕上能看见的只有 6 个格子（三种不平形状 × 客户/公司两个池子），**差异行上直接长着处置按钮**——按格出、按记账事实过滤（账务上开不出单的选项按钮天生不出现，比如兑换来源的行没有冲正 / 冲销按钮）。**错误责任归财务，系统流程不担责**：点按钮出一个弹窗，原因码 + 单据字段 + 查证说明一次填完；20 个成因里机器只认得出一个（重复入账的同参考号双胞胎），其余全靠人判断，但**判断的是财务，不是系统替他判**。
**第三句（过渡语）**：冲正 / 冲销 / 补记 / 改记 / 补单三路 / 挂起两种——这些处置本身现在是**金库一人一窗完成**（选按钮、选原因码、填说明，动钱的一次提交即原子开单）；送 **CFO** 单步复核，挂起零账务不送审。**2026-09-10 对账平账两角色定案**（业主裁定：对账平账只留金库与 CFO，运营整组清零、不拆组不双持）：账龄 ⚡ 拨钟、资金单页 ⚡ 推腿、本幕这条 FUNDS 族事故（未授权转出）登记连同登记之后的调查 / 升级 / 定损 / 通报 / 结案前全部步骤，此前部分留在运营手里，现在整组一并迁金库——运营在对账域彻底清零，侧栏 Reconciliation 组不再出现，只剩 Funds Orders 一个只读列表页；结案两步门（`mlro@` → `cfo@`）不变。⚠️ **2026-09-25 战役甲波一起「运营在事故域彻底清零」这句只对写权成立**——运营新持 `INCIDENT_OPS_WRITE`（OPERATIONS 族独占，管 `ASSET_NONCOMPLIANCE`/`STUCK_TRANSACTION_MAJOR` 两类，本幕不演），侧栏 **Incident Register 会重新出现**、列表与详情页也能打开（读面 `getView()` 不分族，任何持有列表路由权限的角色都能看见任意事故——族门只挡在写动作上）；运营点开本幕这条 Jack 破口（FUNDS 族）详情页能看，但「开始调查」「提结案」等写按钮会被服务层族门 403 挡住（前端按 `cap.incident.<family>` 收起按钮，不会白点）。

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
| 18 | 未授权转出：钱包被幽灵转出，无任何单据（三期开门） | `treasury@` Jack USDT 案那行 OUT 点「**Register incident**」按钮 → 选「Unauthorized outflow」→ 填查证说明 → 提交 → **自动跳转事故登记表单**（类型 / 来源案号 / 定性行号 / 客户 / 资产 / 金额已预填）→ 同一账号「登记」→ 事故详情页「开始调查」→ 添加两条调查记录 → 「记录升级」选 MLRO → 提交定损（口径选**认损**、勾"需要监管通报"、依据勾 TIR Rulebook K+H——提交即联动自动开出对应报送单，72 小时倒计时随之出现）→ 切 `compliance_lead@` 报送台打开该单起草正文 → 送签（Request sign-off）→ 切 `sm@` 审批中心批准（`SIGNED_OFF`）→ 切回 `compliance_lead@` 该单标已提交（填对外编号）→ 切回 `treasury@` 回**案件页**，该行变回「**Recognize loss**」按钮（同 ⑯ 手法，金额锁定 = 定损额）→ 点开（成因 / 方向 / 金额只读）→ 提审 → 切 `cfo@` 批 → 切回 `treasury@` 回案件页「Re-reconcile」→ 案子自愈 **Resolved** → 回事故详情页「**Initiate compensation**」（认损单已落账，按钮自动出现）→ 跳回案件页点开（客户 / 钱包 / 金额全预填、不可改）→ 提交 → 切 `cfo@` 批 → 切回 `treasury@` 资金单页找那张腿 ⚡ **SUBMIT** → 回案件页「Re-reconcile」→ Jack USDT 与运营户 TRON 各开一张**在途**案（琥珀，不红）→ 同一账号 ⚡ OBSERVE_CONFIRMING → ⚡ CONFIRM → 划转单 SUCCESS →「Re-reconcile」两张在途案自愈、Jack 余额复位 → 回事故详情页把两张单挂上去（先挂认损调账单——状态自动转「处置中」；再挂补款划转单）→ 右栏「**提结案**」→ 两步审批：`mlro@` 先批 → `cfo@` 终批 → 事故 **CLOSED**（2026-09-10 对账平账两角色定案：事故登记到结案前的全部步骤——登记 / 调查 / 升级 / 定损 / 挂载单据——与差异行处置同归金库一手，运营在这条 FUNDS 族事故的写权上已彻底清零（2026-09-25 起运营改持 OPERATIONS 族独占写权，本场景不涉及、也读得到列表与详情）；2026-09-26 战役甲波二起**通报环节**改走报送台三方签发链——起草送签 / 标已提交切 `compliance_lead@`、签发批准切 `sm@`，其余步骤全程 `treasury@`）| 事故走完一生六步——登记 / 调查 / 定损 / 通报 / 善后 / 结案；除通报环节转手合规官起草送签、高管批准外，这一整条链归金库一人（与其它处置同律）；认损让账跟着外面走（案子愈），补款是对客户的交代（余额复位，客户没错、公司担责）；结案是两个人的审批（MLRO + CFO），不是一人拍板 |
| 18 续 | 误登记也要走门：登记 → 撤回 | `treasury@` 事故列表页「**登记事故**」→ 类型选「**Client shortfall**」（2026-09-25 战役甲波一起「人工登记」`MANUAL` 已退役，十类终盘不再有不锚任何案子的自由文本类型；改用最简单的存量类型，只需顶层客户号 / 金额两个锚，动态锚表单自动只出现这两格）→ 客户号 / 金额随手填 → 查证说明填"以为是差异其实是正常波动" → 提交 → 事故详情页右栏「**撤回（误登记）**」→ 弹窗必填理由 → 提交 | 撤回不是删除：状态变 **已撤回**、理由留痕在基本信息卡「撤回理由」——误登记也是走门，不能悄悄消失 |
| 收尾 | 三笔补单批完后重对账 | `treasury@` 回任一案件页点「Re-reconcile」 | Bob USDT 案（场景 13）整案 **Resolved**；Kate AED、Grace AED 两案各自那一行差异都已匹配消失（补单确认生效），但两案还挂着本幕其它未处置的场景（8、2·3·4），**整案仍 Open**——不是补单没生效，是同一张案子还有别的差异没处置完，这正是"逐钱包逐笔看、不看总数"的活教材 |

⚠️ **场景 9 必须排在当天任何「Re-reconcile」之前演**：案件页「Re-reconcile」按当天日终截止重跑，会把 Grace USDT 那条跨账期的外部行收回窗口内、案子直接自愈——这正是场景 9 讲的"下期自然平"的真实触发机制。所以场景 9 的「Hold · Next period」定性要排在步骤 5 续的冲正闭环重对账、步骤 10 的核销闭环重对账、以及步骤 13-15 补单批完后的重对账**之前**演；顺序乱了也没关系，照实讲——"这条差异刚才被重对账自愈了，这就是下期自然平"。种子须在**迪拜 18:00（UTC 14:00）前铺**；否则场景 9 外部行（截止点 +6h）落到迪拜次日，日终重跑收不回来，案子照旧红——照实讲。

⚠️ **注①：场景 13 的补录常撞金额下限门**：漏记入金往往是零头小额，容易落在该资产 DEPOSIT 单笔下限（AED / USDT 现都是 100）以下——CFO 批完补录后，新充值单不会直接到 SUCCESS，会先停在「小额挂起」，需要 `ops_officer@` 在充值详情页再点一次既有的「放行下限挂起」（PASS · Waive Min-Limit）才继续走完。这不是缺陷：低于下限的钱本来就该过这道门，补录不享有绕开它的特权。

⚠️ **注②：⚡ 裁决按钮要切账号**：场景 13 补录出来的新充值单若还要现场喂 KYT 裁决，用的 ⚡ 面板需要切到 `compliance_lead@fiatx.com`（持 `DEMO_VERDICT_WRITE`）——`ops_officer@` / `treasury@` / `cfo@` 都没有这个权限，用它们点会被 403 拒绝。

⚠️ **注③：全幕账号切换总表（2026-09-10 对账平账两角色定案，取代 2026-09-08 处置改版那版总表）**：本幕几乎全程一个账号——案件页**全部处置类按钮**（Correction / Reversal / Record entry / Reattribute / Supplement / Register incident / Hold · Next period / Hold · Investigating）、**Re-reconcile / 一键重对账**、⚡ Fast-forward aging（账龄拨钟）、资金单页 ⚡ 推腿（SUBMIT / CONFIRM / OBSERVE_CONFIRMING）、核销 / 认损开单（Write off / Recognize loss）、发起补款 / 发起垫款（Initiate compensation / Initiate advance），以及事故域从登记到结案前的全部步骤，**通报环节例外**（2026-09-26 战役甲波二起：提交定损联动自动开单后，起草送签 / 标已提交转手 `compliance_lead@`，签发批准转手 `sm@`，详见场景 18）——其余步骤（登记 / 调查 / 升级 / 定损 / 挂载 / 撤回）= **全部 `treasury@`**；处置类审批批准 = `cfo@`（报送签发的批准例外，裁决人是 `sm@`）；事故**提结案**是新加的两步门 = `mlro@` 先批 → `cfo@` 终批。运营（`ops_officer@`）本幕对账动作彻底退场——侧栏 Reconciliation 组（Runs / Cases / External Balances / Adjustments）不再出现，直接改地址栏硬闯也是 403（对账三读面清零），只剩 Funds Orders 一个只读列表页。⚠️ **Incident Register 侧栏本身不算在"退场"里**（2026-09-25 战役甲波一起运营改持 OPERATIONS 族独占写权，列表与任意事故详情页读面对运营开放）——退场的是本幕这条 FUNDS 族事故的写权，运营点得开 Jack 那张事故的详情页，但写按钮不出现 / 硬点也是 403。

⚠️ **注④：铺场前不得有在途划转**：`recon:demo:break` 会先清空全部外部账单再从账本流水重铸，划转结清后的流水会被一并重铸；但一张还在路上的划转（待批 / 执行中）铺场会当场报错——先 ⚡ 推到确认或撤回。演划转在途的那几分钟里不要去重对账公司池的案子（在途会把同钱包的抵销案暂判为破口，结清即回）。同一天内演完 16 / 17 / 18；跨日照实讲，次日 cron 会把两侧一起收进去。

⚠️ **注⑤：三期事故登记，登记到定损全程一个账号，通报环节改走报送台三方签发链（2026-09-26 战役甲波二起）**：差异行上点「Register incident」按钮、选「Unauthorized outflow」成因、填查证说明提交，到提交后自动跳转的登记表单起——登记 / 开始调查 / 添加记录 / 记录升级 / 提交定损 = **全部 `treasury@`**（`INCIDENT_WRITE` 已整组从运营迁金库，本条 FUNDS 族事故不存在"谁做都行"的选择；⚠️ 2026-09-25 战役甲波一起运营对事故域整体已不是零权限——改持 `INCIDENT_OPS_WRITE` 管 OPERATIONS 族两类，且任何角色都读得到任意事故详情，本条只是说这一类的写权不在运营手上）；提交定损勾"需要监管通报"联动自动开出的报送单——起草正文 / 送签 / 标已提交 = `compliance_lead@`（`REG_FILING_WRITE`，报送台经办唯一持有人）、签发批准 = `sm@`（`REG_FILING_READ`，唯一裁决人）；挂载善后单 / 提结案回到 `treasury@`；案件页认损开单 / 发起补款也是 `treasury@`；认损与补款的批准 = `cfo@`；**唯独结案是新的两步门**——`mlro@` 先批、`cfo@` 终批，`treasury@` 自己提的结案单自己批不了（拿 `GOV_APPROVAL_READ` 能点到按钮，角色不在候选人里，403）。「撤回（误登记）」也是 `treasury@`——撤回权与登记权是同一把钥匙，不是额外授权。

④ 案件**列表页**扫一眼「**Disposition**」列（`3/5` = 已定性差异行 / 总差异行）——一屏就能看出哪些案子查过了、哪些还没人碰
⑤ 顺带讲内部恒等预门："对外之前先自证"，`verify:coa` 现场跑一遍全绿

**期望**：观众看懂三件事——① 对账不是对总数，是逐钱包逐笔找破口、开案、有下文；② **同一个形状底下成因可以完全相反，机器分不出、必须人去查**，所以按钮弹出的是"选原因码"不是系统自己判死；③ **查完不一定就能平**——挂起和留档同样是正经交付物（结论、查证说明、谁查的、什么时候），案子照旧红着；查完悬着的也不会永远悬着，账龄到线后系统逼出一个结论。

**已知缺口**：本轮做到**十件处置**（推单 / 冲正 / 冲销 / 补记 / 改记 / 挂起 / 核销 / 补单 / 划转 / **事故登记**）；豁免 / 容差不做（精度一致）；SWAP 来源的行没有冲正 / 冲销按钮（A1b 甲，账务上开不出单，BACKLOG 在案）。18 条里能平 **17** 条，场景 9 长红——**不许粉饰**。⚠️ 2026-08-31 那版剧本里「不该动账的行会显示一个错误按钮、正确演法是指出来别点」的警告早已作废；**2026-09-08 处置改版起「Record finding」两屏定性弹窗也退役**——现在每条差异行上直接是按格 × 记账事实过滤过的处置按钮组，点哪个按钮就是选哪个处置，不存在"先选成因再等系统判"这一步。

## 第七幕 · 事后说得清（V1 审计追溯）

**讲什么**：监管最爱问的一句——"这笔事，谁批的、依据什么、钱去哪了？"
**走查**：本幕全程零抄号——每次进审计页都是从单据页一键深链（波三，判据 3）。① 挑第三幕那笔被冻结→处置的充值，充值单**详情页点 View audit trail** → 直接落到审计列表且 Related No 已自动带该充值单号，全链拉出（发起/筛查/冻结/审批/处置，每步谁、何时、结果）——**这条链现在完整包含 `DEPOSIT_FROZEN` 那一步**（2026-09-12 波三红项修复前查不到，见 BACKLOG 销账）；点开其中一条事件详情，除 Entity No（`DEP…`）是蓝字可点链接、直接跳回该充值单的列表页并预填单号（审计跳转甲案，2026-09-12）外，还看得到按角色分组的 **Related Subjects**（命中即可点）与 Action 下方的人话标签（如 "Deposit Seize Requested"）；② **客户详情页（Carol）点 View audit trail** → 她名下所有被动过的事一次拉出，不用回头去审计页手输客户号；③ 点进账本凭证核对钱的最终去向；④ 按 actorNo 查第一幕站 1 那位内审账号（`auditor@`）→ 拉出它当场触发的那条 `ADMIN_ACCESS_DENIED` 越权记录；⑤ 回到第五幕那笔大额待审批的提现，提现单**详情页点 View audit trail** → 捞出的不只是提现自己那条链，连它闯过的那张大额审批单也一起进画面——同一单号跨主体全链一屏可见（Related No 的 OR 语义：主表 primarySubjectNo ∨ 子表 subjectNo，第七幕自此没有查不到的码）。
**期望**：观众看懂"留痕不是日志文件，是能按人、按单、按旅程检索的证据链"。
**已知缺口**：三域交易日志**已全部换装新审计合同**（站1b-β/2-β/3-β，充值 47 码 / 提现 33 码 / 兑换 26 码，三查按单号·按客户·按旅程对三域均成立），链不再断在交易域；**V3 配置域词汇（限额/费率/资产/托管钱包/提现地址/客户标签）也已随四模块治愈换名册四批入册**，第一幕改的费率/限额那笔配置变更第七幕按单号查得到（此前"未入册"的缺口已解，见 `modules/v1-governance.md` §5）。剩一处：重铺后 `Q6 谁查过审计日志` 恒红，**管理员现场真查一次审计页当场转绿**——本幕走查①即含此动作，正常走就绿。

---

## 第八幕 · 异常与监管（V9 事件中心扩景 + 合规办公室/监管报送台 + 投诉工作流）

**讲什么**：前七幕讲的是"店怎么正常开、正常做生意"；这一幕讲**计划外的事**——网络被攻、数据泄露、外包商断供、客户被制裁名单命中、客户投诉——回答"出事之后怎么办"：登记 → 调查 → 定损 → 该不该报监管 → 报了留痕 → 结案，一条看得见的路；监管来的信，回得上也留得下痕；决定不报，也要留痕。
**造数**：`demo:all` 铺齐事件族谱种子（五族非初始态样例，`CYBER_BCDR` 故意不进种子，留场景 25 现场登记）+ 报文族种子（Leo Confirmed / Mona Partial / Frank HighRisk）+ 闹钟墙义务与登记册种子 + 三张投诉种子（Bob 名下），详见各场景「造数」小节与 `demo/data.md`。
**范围**：场景 19–25，横跨战役甲波一至波五（2026-09-25～09-28 分批交付、分批实走），幕次编号与场景内容于波五收官（2026-09-28）一次性定稿——本幕零改动第一至七幕的既有场景编号。场景 19/20 对应总闸主线②③、场景 24 对应主线④、场景 25（本次新补）对应主线①，详见各场景末尾「判据」与总纲 `superpowers/specs/2026-09-25-campaign-a-incident-regulatory-charter.md` §7。

## 场景 19 · B 线 · 制裁定性两分支（V9 报文族 + V2 客户限制联动）

> 战役甲波三交付（2026-09-26），2026-09-28 战役甲收官随第八幕定稿；本节步骤 2026-09-28 T11 终闸现场复走一遍（分支一全新命中 `demo_bob@example.com`，分支二对 Mona Partial 现成状态）核对无误，措辞未改。

**讲什么**：⚡ 命中只是"待裁"，不是终点——合规官提、MLRO 单步批，三选一出口自动联动限制账（翻牌/维持）与报送台（自动开单），同一个 workflow 两个主体各写各的（铁律③）。

**造数**：种子已铺两个"已经走过这条路"的终态样例可直接翻给观众看——Leo Confirmed（CNMR 已提交、客户端横幅可见）、Mona Partial（PNMR 挂钟在跑、EMIRATES_ID 补料在途、一条 AUTHORITY_INSTRUCTION 待决）；本场景现场再活走一遍两条分支：分支一用 ⚡ 现场命中一位新客户走到"确认"，分支二直接对着 Mona 现成的 PARTIAL 状态走"据指令排除"，不必再等一轮新的 5 工作日钟。

**⚡ EOCN 现场触发**（分支一起点）
账号：`compliance_lead@`（合规官）；目标客户用一位**当前无任何限制**的 ACTIVE 客户（如 `demo_bob@example.com`——⚠️ 不要用 Carol/Mona/Leo/Frank，他们种子即带便签，命中会撞后端「已有 OPEN 的 SANCTION 便签」闸 409）
走查：客户详情页「⚡ EOCN Sanctions List Simulation」区，填一个 EOCN 名单条目引用（占位样式如 `EOCN-2026-04213`，随手编）→ Simulate EOCN Hit
判据：命中即经 `CustomerRestrictionWorkflowService.openRestriction()` 贴一张 SILENT SANCTION 便签（`CUSTOMER_RESTRICTION_ADDED`/`CUSTOMER_FROZEN` 审计，⚡ actor 留痕）——管理台客户详情 Restrictions 区多一行、客户端零痕迹（复用既有三层防线，零新代码）

**分支一 · 确认命中 → 横幅 + CNMR**（对照 Leo 那张现成的）
账号：`compliance_lead@`（提单）→ `mlro@`（批准）
走查：① 该客户详情页「Sanction disposition →」→ 弹窗三选一选 **Confirmed match**（后果说明已读："SILENT restriction is replaced with a disclosed one…opens a CNMR filing"）→ 填 Summary（判断依据摘要）+ External Case Reference（EOCN 名单条目引用）→ Submit for MLRO Approval → ② 切 `mlro@` 审批中心批准 → ③ 回该客户详情：SILENT 便签解列、新开一张 `SANCTION_CONFIRMED` 便签（DISCLOSED）→ ④ 切客户端登录该客户：Profile 页出现横幅「Account restricted — confirmed sanctions match」（第一次对他可见——对照 Leo 的种子横幅，长相逐字一致）→ ⑤ 切回管理台报送台：一张 CNMR 单已自动开（同 Leo 那张的形状，锚=便签 `openedAt`、5 工作日钟）→ Mark Submitted（填 externalRef）→ 加一条 RECEIPT_ACK 收尾
判据：确认命中才翻明示（DISCLOSED）——横幅从无到有那一刻就是分界线；CNMR 单开单/锚定/钟全部自动、无需另外手工建单

**分支二 · 部分命中 → 补料 + 指令 → 二次定性排除**（直接接 Mona 现成状态，不用再等一轮钟）
账号：`compliance_lead@`（提单）→ `mlro@`（批准）
走查：① 打开 Mona Partial 客户详情——Restrictions 区能看到她那张仍 OPEN 的 SILENT SANCTION 便签、Verification Requests 区能看到那条 EMIRATES_ID 补料请求（PENDING_SUBMISSION，阻断态 `restrict:false`——讲一句："这条补料不新增限制，便签早已卡住她的全部能力，这只是发一份中性话术"）→ 切报送台打开她那张 PNMR 单，指着那条 `AUTHORITY_INSTRUCTION` 往来记录念一遍——EOCN 已回指令，要求核实姓名/出生日期 → ② 回 Mona 客户详情「Sanction disposition →」（**二次定性**——同一张便签第二次提单）→ 选 **Cleared — false positive**（据 EOCN 指令判定排除）→ 填 Summary（引这条指令的核实结论）+ External Case Reference → Submit → ③ 切 `mlro@` 批准 → ④ 回客户详情：SILENT 便签当场解除，客户全程无感（同一次 maker/checker，不叠第二道解冻审批）
判据：部分命中全程 SILENT，翻不了明示；PNMR 单本身不因二次定性而改动（钟仍按原锚走完，报送台自己的记录不因限制解除而消失——报送与限制账各管各的状态）

**期望**：观众看懂三件事——① 三出口分别联动限制账与报送台，同一个 workflow 两个主体各写各的；② 确认命中才翻明示、部分命中维持静默，tipping-off 两防不混；③ AML 报文族（CNMR/PNMR）无签发链，MLRO/合规官走完全程零高管审批——与通用族"高管签发"同屏对照，接场景 20。

## 场景 20 · A 线 · STR/SAR 与 tipping-off 登记本（V9 报文族）

> 战役甲波三交付（2026-09-26），2026-09-28 战役甲收官随第八幕定稿；本节步骤 2026-09-28 T11 终闸现场复走一遍（站 A 全链、站 B 决定不报、站 C SAR）核对无误，措辞未改。

**讲什么**：MLRO 报文族全程亲办、无签发链——与通用族（如第七幕事故通报那条链）"高管签发"同屏对比是本场景的演示点；决定不报也要留痕；客户来问，话术中性但留痕，不泄密。

**造数**：种子已铺 STR 已提交样例（锚 Frank HighRisk，见 `demo/data.md`「报文族种子」）——直接打开即可看"已提交"终态、一条 CUSTOMER_COMM（拟稿×MLRO 放行两签一行）、一条 RECEIPT_ACK。本场景现场再开一张新 STR 走"起草→标已提交→往来"全链，一张"决定不报"独立小单，SAR 现场开一张讲透"锚客户不锚交易"。

**站 A · STR 全链**（对照通用族的高管签发）
账号：`mlro@`（MLRO，全程一人；对照第七幕事故通报那条链 `compliance_lead@`→`sm@` 的两人两步）
走查：① 报送台 Open Filing → 类型选 STR → 填 External Case Reference（Sumsub 案件引用样式）→ 提交 → 详情页**没有 Request sign-off 按钮**（AML 族无签发链，直接看到 Mark Submitted）→ ② 填 externalRef（goAML 回执号样式）→ Mark Submitted → 单转 SUBMITTED → ③ 往来记录选 RECEIPT_ACK，记一条回执 → ④ 对照打开种子那张已提交 STR（Frank 那张），往来记录区能看到一条 CUSTOMER_COMM——两签一行「Drafted … · Cleared ADM2501010004」，讲词："拟稿是自由文本、放行是 MLRO 本人实名，两签不装作两个账号，因为这类单法律上就该 MLRO 一人经办"
判据：全程零 `PENDING_SIGNOFF`/`SIGNED_OFF` 两态、零审批单——`verify:rbac` 的"AML 单全生命周期零签发链"断言就是这条

**站 B · 决定不报**（no-file decision 留痕）
走查：另开一张 STR → 详情页「Close — No Filing Decision」按钮（仅 STR/SAR、仅 DRAFT 态可点）→ 弹窗必填理由（如"排查后确认为客户本人正常操作，非结构化拆分"）→ 提交 → 单转 CLOSED，详情页 No-Filing Reason 字段可查
判据：决定不报不是"删除"或"放弃"，是走了 `DRAFT→CLOSED` 这条新边、理由必填留痕——法定可辩护记录

**站 C · SAR**（锚客户不锚交易）
走查：Open Filing → 类型选 SAR → 同样填 External Case Reference → 讲一句差异："STR 锚的是具体交易单号，SAR 没有交易，锚的是客户本人——这就是为什么台账要分两行，不是同一个类型改个名字"
判据：SAR 与 STR 同构（同一套状态机/字段），叙事口径不同即可

**⚠️ tipping-off 讲法**（收尾）：全程话术示范——客户来问被冻/被拒的原因，永远不提"报告""调查""合规审查"以外的字眼，不确认也不否认涉及监管报告；CUSTOMER_COMM 记录的正是这句中性话术本身。这是给人看的"怎么说"，客户面 DTO 契约测试断言的是零 `filingNo`/STR 引用泄露到客户可见接口，两层防线不是一回事，讲清不要混。

**期望**：观众看懂两件事——① STR/SAR 是 MLRO 一个人从头到尾的单人链条，唯一在系统里能连高管都拦不住的单据类型；② "决定不报"和"报了"一样要留痕，都是可辩护记录，不是消失。

---

## 场景 21 · 闹钟墙与合规日历（V9 周期申报 + 合规办公室）

> 战役甲波四交付（2026-09-27），2026-09-28 战役甲收官随第八幕定稿。主篇文档 `modules/compliance-office.md`。

**讲什么**：闹钟墙把"对监管的死限期"聚合到一张表，红/黄/绿一眼看出谁快到期；周期义务到期自动开报送单（一期一单，翻期在生成时），走的还是既有六态六边全弧——高管照样要签发。超时不会自动升级成事故，只会标红留痕，升级出口是演示者人工去事故中心登记（不实际登记，只指给观众看入口）。

**造数**：种子已铺三条 VARA 周期义务（月/季/年，见 `demo/data.md`「合规办公室种子」）与既有报送单（波二三种子）。铺场当日若恰好月末/季末落在 `leadBusinessDays`（默认 5 个工作日）以内，Monthly/Quarterly 两条义务会在后端启动后 30 秒内自动开出 `PERIODIC_RETURN` 单——不用等演示者动手，这正是「合规日历不是靠人盯着，是靠钟」的活教材；本节以 Annual（次年到期，远超提前量）现场演示 ⚡ 快进机制。

**账号**：`compliance_lead@`（合规官，看墙/管日历）→ `admin@`（超管，⚡ 快进——金库 `treasury@` 持 `DEMO_CLOCK_WRITE` 但不持 `COMPLIANCE_OFFICE_VIEW`，进不了这几页；合规官持 `COMPLIANCE_OFFICE_VIEW` 但不持 `DEMO_CLOCK_WRITE`，页面上看不到 ⚡ 按钮——现场演示 ⚡ 只能切超管，口播这是本波真实的 RBAC 交叉产物）→ `sm@`（高管，签发）→ 回 `compliance_lead@`（标已提交）。

**走查**：
① `compliance_lead@` 打开侧栏 Compliance Office → Clock Wall——一屏看到报送单钟（含 PNMR，几天几小时倒计时）与三条义务倒计时（月/季/年），红/黄/绿三色徽标可见。
② 切 `admin@`，打开 Compliance Office → Obligations，Annual 那行点「Fast-forward due」→ `Next Due` 立刻拉近到当前时刻附近 → 等约 30 秒（后台 sweep）→ 刷新页面：`Last Filing` 列出现新工单号，`Next Due` 已翻到下一自然年末——义务翻期在生成时完成，无需去重机制。
③ 打开 Regulatory Filings 列表，找到新生成的 `PERIODIC_RETURN` 单（标题含期别，如 "VARA Annual Report incl. audited financials — due 2026-09-27"）→ 点进详情，`Deadline` 徽标可能已经是 Overdue（若义务原定到期日已过，锚点即该期 `dueAt`，属真实行为不是 bug）。
④ 切回 `compliance_lead@`：填 Filing Draft 正文 → Save Draft → Submit for Sign-off。
⑤ 切 `sm@`：审批中心打开对应审批单（`REG_FILING_SUBMIT`），Impact 摘要一句话讲清"提交周期报送、法定截止 XXX"→ Approve。
⑥ 切回 `compliance_lead@`：详情页 Mark Submitted，填 External Reference（如 `VARA-REG-2026-ANNUAL-0027`）→ 单转 Submitted；回 Obligations 页确认该条 `Next Due` 仍是翻期后的下一年，未受本次签发影响。
⑦ 切 `admin@`：回 Clock Wall，挑一张仍在墙上的 FILING 行（如 PNMR）点「Fast-forward deadline」→ 约 30 秒后刷新，该行变红 Overdue。打开 Audit Log 按 `subjectNo=<该单号>` 搜索——两条审计一屏可见：`Filing Deadline Fastforwarded`（actor=操作人）→ `Filing Overdue Marked`（actor=SYSTEM）。
⑧ 口播升级出口：指向侧栏 Incident Register「Register Incident」入口——"墙红了，真要升级成事故，走这里人工登记；系统不会替你自动开"（不实际点，只是指给观众看）。

**判据**：⚡ 义务快进 30 秒内 sweep 开单、`type=PERIODIC_RETURN`、`deadlineAt=` 该期 `dueAt`、`authority`/`title` 从义务行带出；义务 `nextDueAt` 已翻下一期、`lastFilingNo` 回填；工单走完六态全弧（起草→送签→签发→标已提交）零新边零新审批类型；⚡ 报送单快进 30 秒内 `overdueMarkedAt` 落值 + `FILING_OVERDUE_MARKED` 审计 + 墙上该行变红。走查截图入 `doc-final/superpowers/checkups/2026-09-27-act-a-wave4-evidence/`（`21-01` 看墙 ～ `21-06` 超时审计）。

**期望**：观众看懂三件事——① 闹钟墙不是新账本，是把两张表（报送单 `deadlineAt`、义务 `nextDueAt`）聚合读出来的一张只读视图；② 周期申报照样要走高管签发，不因为"是自动开的单"就降级；③ 超时止步于标红+留痕，升级成事故永远是人的决定，不是系统自动升级。

## 场景 22 · 登记册（V9 外包商 / RI 两本册）

> 战役甲波四交付（2026-09-27），2026-09-28 战役甲收官随第八幕定稿。主篇文档 `modules/compliance-office.md`。

**讲什么**：两本法定登记册——外包商（谁在替我们干活、算不算 Material Outsourcing）与 RI（受托责任人，谁在这个岗位上）。RI 换人不是改个名字就完事，是一次事前审批：合规官提、高管批，换人史靠审计链的 from/to 字段可查，不用另建历史表。

**造数**：种子已铺三家外包商（Sumsub/HexTrust 两家 Material，Gulf Office Systems 一家 Non-material 对照）与四个 RI 席位（MLRO/Compliance Officer/CFO/CISO，全 ACTIVE、零在途换人，见 `demo/data.md`）。

**账号**：`compliance_lead@`（合规官，全程登记/提单）→ `sm@`（高管，批换人）。

**站 A · 外包商册增改止**
走查：Compliance Office → Registers → Outsourcing Vendors tab → 「Register Vendor」填名称/服务描述/Criticality/Contract Start → Register（新行出现）→ 点该行「Edit」补一句 Notes → Save → 挑另一张 Non-material 行点「Terminate」→ 二次确认弹窗（"This cannot be undone — there is no path back to ACTIVE"）填理由 → Confirm Termination → 该行状态变 Terminated、Terminate 按钮消失（终态零出边）。
判据：登记/修改/终止逐动作各有一条审计（`VENDOR_REGISTERED`/`VENDOR_UPDATED`/`VENDOR_TERMINATED`）；终止不可逆，界面上不再提供任何回到 ACTIVE 的路径。

**站 B · RI 换人事前审批全弧**
走查：① Registers → Responsible Individuals tab → 挑一个席位（如 CISO）点「Propose replacement」→ 填 New Incumbent Name / Effective From / Reason（可选 VARA Ref）→ 提交（弹窗提示"This opens an approval — senior management decides"）→ 该席位行 Pending Replacement 列出现审批单号链接 → ② 切 `sm@`，打开审批中心对应 `RI_REPLACEMENT` 单，ObjectSnapshot 里能看到 newIncumbentName/effectiveFrom/reason/varaRef 全量字段 → Approve → ③ 回 Registers 页：该席位 Incumbent 已换成新名字、Effective From 已更新、Pending Replacement 清空。
判据：在途重复提单 400（一席一在途）；换人全弧四码审计（`RI_REPLACEMENT_PROPOSED`→`Approval Granted`→`RI_REPLACEMENT_APPLIED`）+ 建席位那次的 `RI_SEAT_REGISTERED`，一屏可见。

**站 C · 审计链回查 from/to**
走查：打开 Audit Log，按 `subjectNo=<该 RI 席位号>` 搜索 → 四条记录从上到下：Submitted（审批开单）→ Ri Replacement Proposed → Approval Granted → Ri Replacement Applied → 点进最后一条详情页，Metadata 区直接看到 `"fromIncumbent": "<旧姓名>"`、`"toIncumbent": "<新姓名>"`——不用去翻审批单或猜，审计行本身就查得到「谁换了谁」（T8 评审修复：此前这两个字段只在写入时校验、不落库，现已镜像进 metadata）。
判据：`RI_REPLACEMENT_APPLIED` 审计的 `metadata.fromIncumbent`/`toIncumbent` 与实际换人前后姓名逐字一致。走查截图入 `doc-final/superpowers/checkups/2026-09-27-act-a-wave4-evidence/`（`22-01` 外包商增改止 ～ `22-04` 审计 from/to）。

**期望**：观众看懂两件事——① 两本登记册各管各的，互不联动，闹钟墙是唯一跨表读点；② RI 换人是任命权在高管、提名权在合规官的事前审批，不是改字段——换人史留在审计链，不需要另开一张历史表。

---

## 场景 23 · 投诉全弧含延期（V1 治理域 · 投诉工作流）

> 战役甲波五交付，2026-09-28 战役甲收官随第八幕定稿。主篇文档 `modules/complaints.md`。本场景全程实走（真提交/真点击，非种子摆拍），2026-09-28 T10 已在 self 栈跑通一遍并截图留证。

**讲什么**：客户能自己提交投诉、看进展，但来回聊天/传附件/撤回都不做——只给三类正式书面（确认函/延期说明/最终答复）。受理调查是运营，裁决是合规官，两人分立，maker≠checker；延期只许一次、必须写清理由（VARA 条文强制要求），死线 4→8 周。

**造数**：不用种子，现场客户端提交一张全新投诉，走完整条弧线（种子②留给场景 24 专用）。

**账号**：客户端 `demo_bob@`（或任一种子客户）→ `ops_officer@`（运营，maker：确认/立案/延期/提裁决）→ `admin@`（超管，⚡ 拨钟——见下方换号话术）→ `compliance_lead@`（合规官，checker：批裁决）→ 回客户端核验三类书面。

**走查**：
① 客户端登录 → 侧栏 Complaints → New Complaint → 填 Category（如 Order execution）/ Subject / 可选 Related Order No. / Description → Submit Complaint → 跳详情页，状态 `Received`，Progress 只有一步「Complaint submitted」。
② 切 `ops_officer@` → 管理台侧栏 Governance → Complaints → 点开刚提交那张（客户号能对上）→ Workflow 区点 Acknowledge → 填确认函文本 → 提交 → 状态转 `Acknowledged`、确认钟显示 Stopped、裁决钟（4 周）开始倒计时、Correspondence 出现一条「Acknowledgement · visible to customer」。
③ 仍是 `ops_officer@`：点 Start Investigation → 状态转 `Investigating`，Workflow 按钮变成 Extend / Propose Resolution / Escalate to Incident 三枚。
④ **⚡ 换号**：切 `admin@`（超管——运营不持 `DEMO_CLOCK_WRITE`，详情页看不到 Fast-forward 按钮）→ 打开同一张投诉详情 → 裁决钟卡片点「⚡ Fast-forward」→ 裁决钟立即变 Overdue。
⑤ 切回 `ops_officer@` → 点 Extend → 弹窗强制填 Explanation（如「需要更多时间核对成交回执」）→ Extend Deadline → 状态转 `Investigating Extended`，裁决钟改判 8 周、Correspondence 新增一条「Extension notice」。
⑥ 仍是 `ops_officer@`：点 Propose Resolution → 选 Outcome（如 Partially upheld）+ 填 Final Response Text（写清结论与补偿）→ Propose Resolution → 开出 `COMPLAINT_RESOLUTION` 审批单，Workflow 区显示「Pending compliance officer decision」。
⑦ 切 `compliance_lead@` → 审批中心打开该单（`ACTION TYPE: COMPLAINT_RESOLUTION`，Entity Ref 链回投诉详情，ObjectSnapshot 能看到 outcome/resolutionText 全量字段）→ Approve → 投诉状态转 `Resolved`，裁决钟 Stopped、Correspondence 新增「Final response」。
⑧ 回客户端该投诉详情：Progress 四步全人话（Submitted/Acknowledged/Extended/Resolved）、Outcome 卡片显示结论、Correspondence 区三类书面（Acknowledgement / Extension notice / Final response）齐全，无任何内部备注/审批过程痕迹。

**判据**：确认钟 = submittedAt+7d、裁决钟 = submittedAt+28d，延期后改 submittedAt+56d（自然日）；三个动作（acknowledge/extend/applyResolution）各自强制落一条 `CLIENT_MESSAGE` entry；裁决走 `COMPLAINT_RESOLUTION` maker-checker（运营提、合规官批），运营批自己那单会被拒（403，SoD）；客户端读面 entries 只含三类 `CLIENT_MESSAGE`，零 `INTERNAL_NOTE`、零 `pendingApprovalNo`/`escalatedIncidentNo`。走查截图入 `doc-final/superpowers/checkups/2026-09-28-act-a-wave5-evidence/`（`08`~`10`）。

**期望**：观众看懂三件事——① 投诉客户端能自己提、能自己看，但书面往来仍由运营/合规官走正式流程产出，不是聊天框；② 延期是受监管条文强制的动作，不是随便拖时间——必须写理由、只许一次、有硬性死线；③ 裁决走 maker-checker，运营提合规官批，两人分立不能自批。

## 场景 24 · 投诉超时升级转事件（V1 治理域 · 投诉工作流 + 事件登记）

> 战役甲波五交付，2026-09-28 战役甲收官随第八幕定稿，本节即终闸主线四「投诉→超时→升级事件」。主篇文档 `modules/complaints.md` §3、`modules/v1-governance.md` §7。2026-09-28 T10 已在 self 栈跑通一遍并截图留证；T11 终闸复走一遍（种子②延期→拨钟→升级→事件定损结案全链）核对无误，措辞未改，新增截图 `22`~`23`。

**讲什么**：投诉超时不会自动变成事件——闹钟墙只标红留痕，升级永远是运营人工点一下；点了之后是**真事件**，走标准调查/定损/结案三步，结案裁决人是合规官（不是财务，新开的第五条结案链）。升级不等于投诉结束——8 周条文义务照样跑，投诉与事件各自独立收尾、双向可点回查。

**造数**：种子②（`CMP2601017476`，INVESTIGATING，已确认、裁决钟原本临近 4 周）——本场景现场先延期一次拉满到 8 周，再 ⚡ 拨过，制造「延期也救不回来、只能升级」的叙事。

**账号**：`ops_officer@`（运营，延期 + 立案调查 + 升级 + 事件调查/定损/提结案）→ `admin@`（超管，⚡ 拨钟——见下方换号话术）→ `compliance_lead@`（合规官，批事件结案）。

**走查**：
① `ops_officer@` 打开 Governance → Complaints → 种子②（`CMP2601017476`，Investigating）→ 点 Extend → 填理由 → 状态转 `Investigating Extended`，裁决钟改判 8 周。
② **⚡ 换号**：切 `admin@` → 打开合规办公室 Clock Wall（或直接回投诉详情页）→ 该投诉裁决钟点「⚡ Fast-forward」→ 裁决钟变 Overdue。
③ 仍是 `admin@`：Clock Wall 页勾选「Only overdue」→ 一屏只剩这一条 `Complaint` 行，红色 Overdue——与 FILING/OBLIGATION 两类行同一张墙、同一套红黄绿三色语义。
④ 切回 `ops_officer@` → 回该投诉详情 → Workflow 区点 Escalate to Incident → **单击即生成事件**（无二次确认弹窗）→ 右栏出现「Escalated Incident」链接（`INC…`），投诉状态仍是 `Investigating Extended`（升级不改投诉状态，8 周义务继续跑）。
⑤ 点「Escalated Incident」链接跳事件详情：类型 `Complaint escalation`，Type-Specific Details 卡片「Complaint No」回链投诉详情（双向验证）。
⑥ 仍是 `ops_officer@`：点 Start Investigation → 加一条调查笔记 → Assessment 区选 Service impact assessed、填 Impact summary（Regulatory report required 不勾——该类型 `reportBasisCandidates` 为空，页面提示「no statutory reporting basis to select」）→ Submit Assessment → 状态转 `Assessed`，Remediation 卡片提示「no remediation actions to attach — it can be closed directly once assessed」（`allowedRemediationKinds` 空集，Ruling-10 乙案，无需先挂善后单）。
⑦ 点 Request Close → 直接开出 `INCIDENT_CLOSE_CUSTOMER` 审批单（无需二次表单）。
⑧ 切 `compliance_lead@` → 审批中心打开该单（`ACTION TYPE: INCIDENT_CLOSE_CUSTOMER`，Entity Ref 链回事件详情）→ Approve → 事件状态转 `Closed`。
⑨ 回投诉详情（`compliance_lead@` 只读，或切回 `ops_officer@`）：右栏「Escalated Incident」链接仍在，点开确认事件已 `Closed`；投诉本身仍是 `Investigating Extended`——升级出的事件结案不等于投诉结案，两条生命周期各走各的。
⑩ 口播补一句：事件列表页「Register Incident」的类型下拉里**没有** `Complaint escalation` 选项——手工登记这类事件后端显式拒绝（`cannot be registered manually`），唯一入口就是刚才那次点击（不实际去点手工登记验证 400，指给观众看下拉里确实没有这一项即可）。

**判据**：延期后裁决钟 = submittedAt+56d；⚡ 拨钟只有金库/超管能点（运营/合规官 403，T6 行为探针已实证）；Escalate 守卫 = 两调查态之一 + `escalatedIncidentNo` 为空，二次点击 400；事件 `subjectRefs.complaintNo` 与 anchors 齐；事件结案走 `INCIDENT_CLOSE_CUSTOMER`（合规官单步，第五条结案链）；投诉/事件详情页双向链接可点；手工登记入口对 `COMPLAINT_ESCALATION` 仍显式拒绝（门语义保留）。走查截图入 `doc-final/superpowers/checkups/2026-09-28-act-a-wave5-evidence/`（`11`~`13`）。

**⚡ 换号话术（场景 23/24 通用）**：运营是投诉受理调查的唯一经办人，但**不持 `DEMO_CLOCK_WRITE`**——投诉详情页 / 闹钟墙上看不到 Fast-forward 按钮（不是点了才 403，是压根不渲染）；能拨钟的是持有 `DEMO_CLOCK_WRITE` 的金库或超管，但金库不持 `COMPLAINT_READ`/`COMPLAINT_WRITE`、进不了投诉列表/详情页；实测能同时看到页面又点得动 ⚡ 按钮的只有超管（`admin@fiatx.com`）——与场景 21 闹钟墙 ⚡ 同款 RBAC 交叉现象（T6 探针：金库 simulate-timeout 201、运营 403）。剧本口径：运营做完调查动作 → 切超管拨钟 → 切回运营继续走后续步骤，不临场现编理由。

**期望**：观众看懂三件事——① 超时不会自动变事件，闹钟墙只标红，升级永远是人工决定；② 升级出的事件走完整调查/定损/结案生命周期，跟原生事件类型没有区别，只是结案裁决人换成合规官；③ 升级不是投诉的终点——两条生命周期分开收尾，双向可查。

## 场景 25 · 网安事件登记 → 72h 上报 → 回执 → 结案（V9 事件中心 + 报送台，`CYBER_BCDR` 类型）

> 战役甲波一新增事件类型（2026-09-25），但种子故意不铺、留给演示现场走（见 `demo/data.md`「事故种子」头注）；本节呼应终闸主线一「网安事件→72h→上报工单→回执→结案」。2026-09-28 T11 终闸首次在 self 栈现场跑通全链并截图留证（此前只有类型定义与 spec 承诺，`demo/script.md` 一直缺这段走查——本次补齐）。⚠️ 措辞订正：总纲 §7 原写"网安事件→72h **双钟**"，实测 `CYBER_BCDR` 唯一依据码 `TIR_K_H` 只挂一只 72h 钟（"双钟"是 `DATA_BREACH` 类型 `PDPL_ART_9`+`TIR_II_C_24H` 两码两钟的专属叙事，2026-09-26 波二 spec 已用"双钟链"一词指代它，非本类型）——本场景准确讲法是**单钟 72h**，观众问起可对照场景 21 闹钟墙上 FILING 行的倒计时。

**讲什么**：网络安全 / BCDR 事件走的是与投诉族（合规官单步）、财务族（CFO 单步）都不同的第三条结案链——技安族由 CISO 守门；登记即起算 72h 法定上报钟，钟不是装饰，报送台的 deadline 就是从事件锚点算出来的。

**造数**：不用种子，现场登记一条全新 `CYBER_BCDR` 事件，走完整条弧线。

**账号**：`tech_admin@`（技术官，唯一 `INCIDENT_TECH_WRITE` 持有人：登记 / 调查 / 定损 / 请求结案）→ `compliance_lead@`（合规官，起草报送单）→ `sm@`（高管，GENERAL 族通用签发链批准）→ 回 `compliance_lead@`（标已提交 + 记回执）→ `ciso@`（CISO，批技安族结案，单步）。

**走查**：
① `tech_admin@` → Governance → Incident Register → Register Incident → Type 选 `Cyber / BCDR incident`（选中后表单动态长出 Type-specific 区）→ 填 Title/Description → Type-specific 区选 Affected system（如 Backend API）、勾 BCDR triggered → Register → 状态 `Registered`。
② 仍是 `tech_admin@`：Start Investigation → 加一条调查笔记（讲清排查结论：影响范围、是否波及客户资金/数据）→ 状态转 `Investigating`。
③ Assessment 区：Impact summary 必填 + 勾 Regulatory report required → Report Basis 只有一个候选可勾——**「TIR Rulebook Section K + H … reporting to VARA within 72 hours — Report within 72h」**（`reportBasisCandidates=['TIR_K_H']`，单选不是多选，这就是"单钟"的字面证据）→ Submit Assessment → 状态转 `Assessed`，页面顶部弹出「Regulatory filing opened: FIL…」，下方 Regulatory Filings 卡片新增一行——Authority `VARA`、Deadline 倒计时约 `2d 23h`（从登记时刻起 72h）、状态 `Draft`。
④ 切 `compliance_lead@` → 打开该报送单详情 → Filing Draft 填正文（事件摘要 + 已采取的处置）→ Save Draft → Sign-off 区点 Submit for Sign-off → 状态转 `Pending Signoff`，开出一张 `REG_FILING_SUBMIT` 审批单（GENERAL 族通用签发链，与场景 19/20 的 AML 族"零签发"刻意对照）。
⑤ 切 `sm@` → 审批中心打开该单（Impact 摘要一句话读到"statutory deadline …"）→ Approve → 报送单转 `Signed Off — to submit`。
⑥ 切回 `compliance_lead@` → Mark Submitted → 填 External Reference（对外编号，如 `VARA-REG-2026-…` 样式，留痕不真发）→ 报送单转 `Submitted`。
⑦ 仍是 `compliance_lead@`：Correspondence 区选 Receipt acknowledged → 填监管方回执摘要 → Log Entry → 一条回执记录入账。
⑧ 切回 `tech_admin@` → 回事件详情 → Request Close（此刻已可点——该类型 `allowedRemediationKinds` 为空集，定损后不需要先挂善后单，直接可结案）→ 开出 `INCIDENT_CLOSE_TECHSEC` 审批单。
⑨ 切 `ciso@` → 审批中心打开该单（单步，Step 1 = CISO）→ Approve → 事件状态转 `Closed`。

**判据**：`CYBER_BCDR` 依据码集合固定为 `['TIR_K_H']`（单钟，非双钟）；报送单 `deadlineAt` = 事件 `registeredAt`+72h，与审批单 Impact 摘要里的 statutory deadline 逐字一致；GENERAL 族报送单必经签发（`Pending Signoff`→`Signed Off`两态，与 AML 族"直接 Mark Submitted、零签发"对照）；结案走 `INCIDENT_CLOSE_TECHSEC`（CISO 单步，事故域五条结案链之一，与投诉族 `INCIDENT_CLOSE_CUSTOMER`（合规官单步）、FUNDS 族 `INCIDENT_CLOSE_SECURITY`（MLRO+CFO 两步）、`INCIDENT_CLOSE_FINANCIAL`（CFO 单步）、审慎族 `INCIDENT_CLOSE_PRUDENTIAL`（高管单步）并列）；结案前事件详情 Actions 区 Request Close 按钮禁用文案为「Not yet assessed / 对应报送单未提交」，报送单标已提交后才放行——报送闭环是结案的前置门。走查截图入 `doc-final/superpowers/checkups/2026-09-28-act-a-wave5-evidence/`（`14`~`17`）。

**期望**：观众看懂两件事——① 法定钟不是摆设，登记那一刻起 72h 就在跑，报送单详情页的 deadline 读得到具体到期时刻；② 通用报送族（GENERAL）与反洗钱报文族（AML，场景 19/20）刻意用两套签发规则同屏对比——网安事件这类"谁都要审"，STR/CNMR 这类"法定谁也批不得"，两种监管治理姿态本身就是演示点。

---

## 场景 26（暂编）· 库存见底找 LP 补货：LP 兑换单正向全弧（V7 财资 · LP 兑换台）

> 战役乙波一交付（2026-09-29）——幕次归属（是否独立成第九幕、或并入既有幕）留战役乙收官统一定稿，本节先把走查步骤钉住，不占用第几幕的编号位。主篇文档 `modules/lp-desk.md`。本场景 2026-09-29 T11 在 self 栈全程实走一遍（真提交/真点击，非种子摆拍），十二张截图留证。

**讲什么**：客户天天兑换消耗库存，运营户迟早见底——这时金库向签了约的场外流动性提供商（LP）开一张兑换单：卖出一种资产、买入另一种，两边金额手填。先款后货：我方先出钱（卖出腿运营户直出），等 LP 把货打进一间在途验收前厅（`FIRM_LIQ` 复活，2026-08-13 因零活体退役、本波因这个真实需求复活），金库清点核对（应收 vs 实到并排，纯展示零逻辑）后才正式转进运营户——悬空期里运营户已经瘪下去、前厅还空着，这个中间态账本页看得见。

**造数**：不用种子，现场金库对 LP 名册里 ACTIVE 的 Falcon Liquidity FZE 开一张全新兑换单，走完整条弧线（种子已铺一张历史 SUCCESS 单垫底，同名册可直接打开对照）。

**账号**：`treasury@fiatx.com`（金库，开单/⚡推腿/⚡模拟到货/验收全程）→ `cfo@fiatx.com`（CFO，建档与开单两条审批的唯一裁决人）。

**走查**：
① 金库登录 → 侧栏 Custody → LP Exchanges → 「Initiate exchange」→ 弹窗选 Falcon Liquidity FZE（ACTIVE）+ Sell Asset=AED、Sell Amount（如 10000）+ Buy Asset=USDT-TRON、Buy Amount（如 2720）+ Prudential Purpose（必填，8 年安全港记录）+ Reason（必填）→ Initiate → 单据转 `PENDING_APPROVAL`，横幅带 approval 号。
② 切 `cfo@` → 审批中心打开该单（`ACTION TYPE: LP_EXCHANGE_APPROVAL`，Impact 摘要一句话读到"the firm's AED operating balance decreases once the sell leg clears, and its USDT operating balance increases once the delivery is accepted"）→ Approve（二次确认弹层，同一按钮打开确认层再点一次同名按钮，本弧两处 CFO 批准均如此）→ 单据转 `EXECUTING`，卖出腿资金单已建。
③ 切回 `treasury@` → 打开卖出腿资金单详情（AED 法币腿）→ ⚡ Submit → ⚡ Settle → 腿转 `CLEARED`，兑换单转 `AWAITING_DELIVERY`——详情页蓝色横幅明写"Sell leg cleared, waiting for the LP to deliver the buy leg to the front desk — the firm's AED operating balance has already decreased."，八态时间线停在「Awaiting LP delivery」。
④ 打开 Ledger Accounts，按 Code 筛 `203 · FIRM_LIQ`：两条资产行（AED/USDT-TRON）余额均 `0.00`——前厅还空着；再筛 `200 · FIRM_OPS`：AED 行已比开单前少了卖出金额——运营户已经瘪。悬空期账实两头都能在账本页对照给观众看。
⑤ 回兑换单详情，点「⚡ Simulate LP delivery」→ 单据转 `DELIVERED`，买入腿资金单已建并 `CLEARED`（模拟 LP 打款一步到位落前厅）。**此刻是 F_LIQ 真正持有非零余额的唯一窗口**——回 Ledger Accounts 按 `203 · FIRM_LIQ` 再筛一次，买入资产那一行余额已变成买入金额（非零）；这正是 spec 要求「在途中间态」的取证时点，运营侧此刻现场跑一次 `bash scripts/on-stack.sh self verify:coa`，两恒等式 + 负余额检查全绿——账实在这个中间态依然一致，不是等到终态才平。
⑥ 详情页「Accept delivery」→ 验收弹层：Expected（应收，来自单据 buyAmount）与 Received（实到，腿 2 资金单自己的金额）并排展示 → 数字一致 → Accept delivery 确认 → 单据转 `SUCCESS`，八态时间线全绿，验收转腿（腿 3）自动建并清算——买入资产从前厅转进运营户，`203 · FIRM_LIQ` 两资产行回落 `0.00`。
⑦ 收尾核对：现场跑一次 `bash scripts/on-stack.sh self recon:demo:pass`（或点 Reconciliation Runs 页 Re-reconcile）——`status=PASS`、`casesOpened=0`，F_LIQ 钱包在检查范围内且 `MATCHED`——终态平，本弧对账机制吃进了这三腿流水，不需要额外收编。

**判据**：八态八边（`PENDING_APPROVAL→EXECUTING→AWAITING_DELIVERY→DELIVERED→SUCCESS`，另三条负向分支 `FAILED`/`REJECTED`/`CANCELLED`）；三腿转账码 84/85/86 固定；F_LIQ 中间态非零、终态归零两个时点都过 `verify:coa`；`recon:demo:break` 的场景⑩「查无果」候选钱包已显式排除 `E.FIRM_LIQ`（本场景 T11 走查时实测撞见并修，见 `scripts/recon-demo.ts` 注释——避免同一钱包里混进一条注入的「解释不了的差额」，与本场景「终态平」的叙事打架），排除后重跑仍 18/18 全检出。走查截图（`23`~`34`）入 `doc-final/superpowers/checkups/2026-09-29-campaign-b-wave1-evidence/`。

**期望**：观众看懂三件事——① 一张兑换单打通"库存见底→找 LP 补货"整条弧，单据/审批/资金单/账本分录/对账全程留痕；② 悬空期不是黑箱——运营户已减、前厅未到，账本页当场看得见这个"钱在路上"的中间态，且这个中间态账实仍然一致；③ 验收是核数不是审批——CFO 已经批过单，前厅不做成第二道 maker-checker。

## 场景 27（暂编）· 反向快演：USDT 积压回吐（V7 财资 · LP 兑换台）

> 战役乙波一交付（2026-09-29），幕次归属同场景 26 留收官定稿。

**讲什么**：同一张单据、同一套状态机、同一组转账码——只是卖出/买入两边资产对调（卖 USDT-TRON 买 AED）。没有 IN/OUT 两种订单类型，方向只是同一张单的两个立场。

**造数**：不用种子，现场对同一家 Falcon 开一张反向单，快演全弧（步骤与场景 26 逐一对应，不重复展开逻辑，只点差异）。

**账号**：`treasury@fiatx.com` → `cfo@fiatx.com`（同场景 26）。

**走查**：① Initiate exchange → Sell Asset=USDT-TRON（如 3000）、Buy Asset=AED（如 11030）→ CFO 批 → ② ⚡ 推卖出腿——这次是加密币腿，走 `⚡ Broadcast → ⚡ Seen in Mempool → ⚡ Confirm` 三步（法币腿场景 26 是 `⚡ Submit → ⚡ Settle` 两步，两族资金单推进节奏本就不同，对照着讲）→ `AWAITING_DELIVERY` → ③ ⚡ Simulate LP delivery → `DELIVERED` → ④ Accept delivery：Expected/Received 并排（本弧 11030.00 AED 对 11,030.00 AED）→ Accept → `SUCCESS`，八态时间线全绿。

**判据**：与场景 26 完全同一状态机、同一组转账码（84/85/86，只是 ledger 对调）；验收并排数字一致。走查截图（`35`~`39`）入同一 evidence 目录。

**期望**：观众看懂一件事——LP 兑换台不是两套系统各管一个方向，是一张单、一套状态机，方向只是填哪边资产的问题。

## 场景 28（暂编）· 公司开张的钱从哪来：注资单全弧（V7 财资 · 公司资金）

> 战役乙波二交付（2026-09-29）——幕次归属留战役乙收官统一定稿，本节先把走查步骤钉住。主篇文档 `modules/company-funds.md`。本场景 2026-09-29 T11 在 self 栈全程实走一遍（真提交/真点击，非种子摆拍），截图 `29`~`36`。**本场景与场景 29 在全新 `reset` 后、`demo:all` 之前的种子态上走**（先 28 后 29，中间不夹带其他开单动作）——场景 30 的「造数」才轮到 `demo:all`，30 之前 28/29 的 F_OPS 数字才精确可复现。

**讲什么**：种子资本注入原型（码 70，DR FIRM_ASSET / CR FIRM_OPS）只是开张时铺好的账，注资单把它做成一张能反复开的运行时单据——金库填出资方、币种金额、审慎管理目的，CFO 单步批，等出资方把钱打进运营户，金库核对「应到 vs 实到」后确认入账，运营户余额才真的涨。确认前后是两个不同的时点，看板 F_OPS 格子在这两个时点之间不动——先批不等于钱到，钱到不等于账落。

**造数**：不用种子，现场金库对一家新出资方（如 Sequoia Bridge Fund）开一张全新 AED 注资单，走完整条弧线（种子已铺两张 SUCCESS 壳单垫底——AED/USDT 各一张，出资方 `FiatX Holdings Ltd (founding shareholder)`，讲一句"公司开张那笔注资在册可查"）。

**账号**：`treasury@fiatx.com`（金库，开单 / ⚡模拟出资方打款 / 确认入账全程）→ `cfo@fiatx.com`（CFO，唯一裁决人）。

**走查**：
① 金库登录 → 侧栏 Treasury → Capital Injections →「Initiate injection」→ 弹窗填 Contributor Name（如 Sequoia Bridge Fund）+ Asset=AED + Amount（如 150000）+ Prudential Purpose（必填，8 年安全港记录）+ Reason（必填）→ Initiate → 单据转 `PENDING_APPROVAL`，横幅带 approval 号。
② 切 `cfo@` → 审批中心打开该单（`ACTION TYPE: CAPITAL_INJECTION_APPROVAL`，Impact 摘要一句话读到"Contribute 150000.00 AED into the firm's operating account...the firm's AED operating balance increases once the contribution is confirmed"）→ Approve → 单据转 `AWAITING_FUNDS`。
③ 切回 `treasury@` → 打开详情页 →「⚡ Simulate contributor payment」→ 单据转 `RECEIVED`，详情页蓝色横幅明写"Funds have landed in the operating account but are not yet posted — confirm receipt to book the entries."。
④ **此刻切 Company Funds 看板拍一帧**：运营户 AED 水位与确认前一致（重铺后本弧首笔注资，确认前维持种子基线 947,500.00 AED，见 `demo/baseline.md`）——钱已经到托管、账还没落，这正是"先到款、后落账"的中间态，看板当场证明这句话。
⑤ 回注资单详情，点「Confirm receipt」→ 弹层 Expected（应到，来自单据 amount）与 Received（实到，⚡模拟打款回单金额）并排展示，纯核数零逻辑，两数一致 → Confirm receipt → 单据转 `SUCCESS`，落账码 70（复用种子既有语义），时间线四步全绿。
⑥ 再切看板拍一帧：运营户 AED 水位应声上涨（确认后 947,500.00 → **1,097,500.00** AED，涨幅精确等于注资金额 150,000.00；本弧实测取自 2026-09-29 T11 走查，重铺后按同样金额复现同样数字）。

**判据**：六态五边（`PENDING_APPROVAL→AWAITING_FUNDS→RECEIVED→SUCCESS`，另两条负向分支 `REJECTED`/`CANCELLED`）；确认前后看板 F_OPS 对照帧数字精确对得上注资金额；Expected/Received 并排核数、非二次审批（CFO 已批过单，前厅不做第二道 maker-checker）。

**期望**：观众看懂两件事——① 公司自己的钱进门跟客户充值一样，有单有审批有账本分录；② 到款与落账是两个动作，看板能当场演出这中间那一拍。

## 场景 29（暂编）· 公司的钱怎么花：供应商付款单全弧（V7 财资 · 公司资金）

> 战役乙波二交付（2026-09-29），幕次归属同场景 28 留收官定稿。本场景 2026-09-29 T11 在 self 栈全程实走一遍，截图 `37`~`42`。

**讲什么**：公司也要给外部供应商付钱——HexTrust 的托管月费是演示代表，收款方只能从外包商登记册（甲波四立的那本册）下拉选，选不到自由填的地址，这条边把"甲乙两个战役的东西真的接上了"这句话坐实。付款单是公司→外部单腿出，批完钱不会立刻动，要等金库把出款资金单推完才真正扣款。

**造数**：不用种子，现场金库对 HexTrust 开一张全新月费付款单（种子已铺一张 SUCCESS 历史付款——2026-08 月费 AED 2,500，讲一句"上个月的账在册可查，这个月现开一张"）。

**账号**：`treasury@fiatx.com`（金库，开单 / ⚡推出款全程）→ `cfo@fiatx.com`（CFO，唯一裁决人）。

**走查**：
① 金库登录 → 侧栏 Treasury → Vendor Payments →「Initiate payment」→ 弹窗下拉选 HexTrust（ACTIVE 外包商，vendorNo 显式带出）+ Payee Account Reference（收款坐标，一行文本）+ Asset=AED + Amount（如 3200）+ Purpose（如 HexTrust 2026-09 custody fee）+ Prudential Purpose（必填）+ Reason（必填）→ Initiate → 单据转 `PENDING_APPROVAL`。
② 切 `cfo@` → 审批中心打开该单（`ACTION TYPE: VENDOR_PAYMENT_APPROVAL`，Impact 摘要读到"Pay 3200.00 AED to outsourcing vendor VEN...(HexTrust)...the firm's AED operating balance decreases once the payment clears"）→ Approve → 单据转 `EXECUTING`，出款资金单已建，详情页横幅"Approved, the payout leg is in flight — advance it from the funds order page."。
③ **此刻切看板拍一帧**：运营户 AED 水位维持批准前数字不变（批完不等于扣完）。
④ 从付款单详情点开出款资金单（法币腿）→ ⚡ Submit → ⚡ Settle，腿转 `Settled`。
⑤ 回付款单详情，单据已自动转 `SUCCESS`，落账码 87（`VENDOR_PAYMENT`，本波唯一新码）。
⑥ 再切看板拍一帧：运营户 AED 水位应声下降，跌幅精确等于付款金额（承接场景 28 之后 1,097,500.00 → **1,094,300.00** AED，跌 3,200.00；本弧实测取自 2026-09-29 T11 走查）。

**判据**：六态六边（`PENDING_APPROVAL→EXECUTING→SUCCESS`，另 `FAILED`「批了运营户没钱」/`REJECTED`/`CANCELLED` 三条负向）；付款后看板下降帧数字精确对得上付款金额；收款方点回外包商登记册真实路由（横向只读，铁律③放行）。

**期望**：观众看懂两件事——① 公司花钱跟收钱同一套门（金库开、CFO 批），批完不是扣完；② 收款方来自甲波四那本登记册，两个战役的活真的接上了，不是各画各的。

## 场景 30（暂编）· 公司资金全景看板：五区巡览 + 利润体现（V7 财资 · 公司资金）

> 战役乙波二交付（2026-09-29），幕次归属留战役乙收官统一定稿。本场景 2026-09-29 T11 在 self 栈全程实走一遍（含一笔现场客户兑换，非种子摆拍），截图 `43`~`47`。

**讲什么**：看板是给管理层看家底的一屏——运营户各币种水位（见底阈值线，见了这条线就该找 LP 补货）、LP 在途待验收、结算在途、三收入格（利润体现）、最近资金动态，五个区一屏读完，全部读既有账本端点，零新聚合逻辑。看板每一格与账本三列表（科目/凭证/流水）同源同值，这不是两套数字各算各的。

**造数**：`bash scripts/on-stack.sh self demo:all`（铺齐三域 29 笔标准场景数据，含若干笔真实客户兑换，先把三收入格垫上非零基线）+ 现场一笔客户兑换（Alice USDT→AED 300，看三收入格实时再涨一格）。

**账号**：`treasury@fiatx.com`（看板 / 账本三列表）→ 客户端 `demo_alice`（现场兑换）→ `compliance_lead@`（KYT 裁决）→ 推资金单一步（见判据说明，本弧走 `admin@fiatx.com` 超管，非常规演示角色，缘由见判据）。

**走查**：
① 金库登录 Company Funds 看板，从上到下巡览五区：运营户水位（AED/USDT 两卡，阈值线 900,000 AED / 100,000 USDT，余额高于线显绿、低于线转红）；LP 在途待验收（读 F_LIQ 科目 203）；结算在途（读 F_SET 科目 201，仅法币有行）；三收入格（210/211/212，AED/USDT 分列，标题直读 API 下发的 `accountName`）；最近资金动态（最近 10 条流水，人话事件标签，场景 28/29 刚做的注资/付款两笔当场就在列表里）——`demo:all` 已铺过若干笔标准兑换，此刻 Trading Fee Income AED 格读到 20.00（非零基线）。
② 客户端登录 Alice（余额来自 `demo:all` 铺的花名册）→ Swap 页卖 300 USDT 买 AED（手续费 10.00 AED），Confirm and Swap → 单转 `PROCESSING`（COMPLIANCE_PENDING，等 KYT）。
③ 切 `compliance_lead@` → Swap Transactions 该单详情 → 下拉到「⚡ Simulation」区 →「① Approved」→ 单转 `PROCESSING · SELL`（等卖出腿清算）。
④ 卖出腿（USDT）资金单 ⚡ Broadcast → ⚡ Seen in Mempool → ⚡ Confirm；买入腿（AED）资金单 ⚡ Submit → ⚡ Settle；费腿（AED，收款方 F_FEE）⚡ Submit → ⚡ Settle——三腿逐一推进后单转 `SUCCESS`。
⑤ **三收入格前后对照帧**：推腿前后各切一次看板，Trading Fee Income AED 格从 20.00 涨到 30.00（涨幅精确等于本笔兑换手续费 10.00 AED）——利润体现的正戏当场演给观众看。
⑥ **同源同值收尾核对**：切 Ledger Accounts 页，Owner 筛 SYSTEM →「Company Operating Funds – AED」余额与看板运营户 AED 格逐位一致（判据是两页相等，不是某个固定数——具体数值随当次重铺后场景 28/29 的实际走法变化；2026-09-29 T11 干净重走一遍，从 reset 后一路只做场景 28→29→30、零练手单据，实测样例为两处均 1,091,798.62 AED，恰等于场景 29 收尾的 1,094,300.00 经 `demo:all`（−1,410.65）与本笔现场兑换（−1,090.73）两次真实扣减后的结果，链路可复算）；「Trading/Withdrawal/Other Service Income – AED」三行与看板三收入格 AED 三格逐位一致（同一逻辑，T11 实测样例 30.00 / 52.00 / 42.00，其中三收入格不受注资/付款单据影响，凡重铺后只做过场景 28/29/30 全弧、未额外多开单，此三数可复现）——讲词收在"刚才看板上跳的那一格，账本页查一下，是同一个数字，不是看板另算的"。USDT 侧因既有 `LedgerAccountList` 小数位显示错（`code≠currency` 资产键不一致，`BACKLOG.md` §M 已登记更深根因），走查现场能看见新旧两页数字不一致（看板 8.000000 USDT vs 老账本页 80,000.00），讲词收在"看板这张新页已经修了这个换算坑，旧的账本科目页还没排到"，不是本波复发。

**判据**：看板五区数字与账本三列表 AED 侧逐位同源同值；USDT 侧继承既有显示缺口（非本波复发，已有 BACKLOG 记录）；三收入格随现场客户兑换实时上涨，涨幅等于该笔手续费。

**走查中发现的一处新账（未修，已登记）**：步骤④推腿动作，管理台「⚡ Simulation」面板对兑换单挂的资金单腿统一按 `FUNDS_ORDER_PUSH_WRITE` 权限门控面板可见性，但兑换单腿的真实推进端点（`POST /admin/swap-transactions/:swapNo/legs/:legSeq/advance`）挂的是 `TRADING_SWAP_WRITE`——金库持前者不持后者（面板看得见、点了 403），运营持后者不持前者（面板本身不出现）：本仓现状下，兑换单的资金单腿在管理台没有任何非超管角色能推完整套。本弧为了拿到「利润体现」的真实截图借道 `admin@fiatx.com`（超管跳过 RBAC），非常规演示路径，已登记 `BACKLOG.md` §E，业主定谁来兜底这条腿（金库补 `TRADING_SWAP_WRITE`，还是运营补 `FUNDS_ORDER_ACT`）后再改本节讲词。

**期望**：观众看懂两件事——① 看板不是另建的一套真相，是既有账本数据换了个一屏能看完的排版；② 利润不是财务报表里的抽象数字，客户兑一笔、看板上那一格就当场跳一下。

## 场景 31（暂编，归第九幕「公司的钱」，幕号 T10 统一定稿）· ⚡穿底：托管失窃与客户复原（V7 财资 · 公司资金 + V9 事件中心）

> 战役乙波三交付（2026-09-30），衔接甲战役已建的事故通用机制（登记/调查/定损/善后/结案）与本波新立的 NLA 红线——场景本身不新增机制，只是把两条战线（客户资金安全、公司审慎合规）在同一条剧情里对撞一次。主篇文档 `modules/company-funds.md`、`modules/v9-incident-center.md`（若已建，未建则见事件中心相关篇）。本场景 2026-09-30 T8 在 self 栈全程实走一遍（真提交/真点击，非种子摆拍，金库/CFO 两账号来回切换），十八张截图留证。

**造数（必须，不可省略/不可复用现场）**：本场景**不承接场景 28-30 留下的现场**——场景 28 那笔 150,000 注资会把 NLA 垫得更高，反而把失窃打不穿红线（判据前提，不是可选项）。开场必须从全新 `reset` 起跑：

```bash
bash scripts/stack.sh reset self && bash scripts/stack.sh up self && bash scripts/on-stack.sh self demo:all && bash scripts/on-stack.sh self recon:demo:crisis
```

（主树演出时把上面四条命令里的 `self` 全部换成 `main`。）`recon:demo:crisis` 只铺一条 AED 大额未授权转出外部账单行——不入 18 场景常规破口集，`recon:demo:break`/`pass` 与既有 baseline 零变动，重铺即消。

**讲什么**：客户的钱从托管钱包里凭空少了一笔，没有任何我方单据、客户也没有发起——这是"未授权转出"事故的教科书形态。金库沿着甲战役已建的事故一生走一遍：差异行定性登记→调查→定损（公司认损）→认损调账（客户侧账先跟着外部账单走平）→补款划转（公司真金白银把客户的钱补回去）。客户池复原的同时，公司自己的运营户被这笔"先垫后追"的补款划穿了——运营户 AED 见底线、全公司 NLA 红线，两条线在同一个动作里一起被打穿，看板双线齐红。客户复原了，公司自己却撞了监管线——这正是场景 32 的钩子。

**账号**：`treasury@fiatx.com`（金库，差异定性/事故登记/调查/定损/认损开单/发起补款/推资金单腿/重对账全程）→ `cfo@fiatx.com`（CFO，认损调账与补款划转两笔审批的唯一裁决人）。

**走查**（case `REC20260930-001`，客户 Bob `CU2601017625`，AED 托管钱包 `WA2601014725`，失窃 250,000.00 AED）：

① ⚡ 造数已在开场命令跑完——差异注入 `externalRef=CRISIS-2026-09-30-UNAUTHORIZED-OUTFLOW`，此刻 `GET /admin/prudential/status` 仍 `breached=false`（NLA 1,364,752.25 > 红线 1,200,000.00）：crisis 只动外部账单，账本/TB 尚未变化。

② 金库登录 → 侧栏 Reconciliation → Cases → 打开 `REC20260930-001` → 案件页「BALANCE EXPLAINED」四格：INTERNAL 262,200.00 / EXTERNAL 12,200.00 / DIFFERENCE −250,000.00 / UNEXPLAINED −250,000.00（needs investigation）→「DIFFERENCES · 1 OPEN ROW」表格：External only / OUT / 250,000.00 / `CRISIS-202…FLOW`，行上处置按钮组 Supplement / Reattribute / **Register incident** / Hold · Next period / Hold · Investigating（新案已开，差异行等待定性）。

③ 差异行点「Register incident」→ 弹层「Register incident · What caused this difference?」，唯一成因选项「Unauthorized outflow」（Clue: We hold no order for it, and the customer did not initiate it，单选已默认命中）→ 填 Finding note（查证说明：核对内部单据/提现/兑换记录，均无匹配，确系未授权转出）→「Continue」→ 定性落库（`sourceDispositionNo` 自动生成），差异行成因回填「Unauthorized outflow」。

④ 提交后自动跳转事故登记表单 `/admin/governance/incidents?type=UNAUTHORIZED_OUTFLOW&…`——类型/标题/说明/来源案号/**定性行号**/客户号/资产/金额（250000.00）全部预填、`sourceDispositionNo` 已带上 → 同一账号点「Register」→ 事故 `INC260930949208` 落库，状态 `Registered`，右栏提示「Freeze via Customer page (not automatic — freezing goes through the separate customer restriction gate)」（登记不等于自动冻户）；差异行下方随即出现「Incident · INC260930949208」徽标。

⑤ 事故详情页「Start Investigation」→ 状态转 `Investigating` → 「Add Investigation Note」填查证记录（钱包地址史/充值-提现-兑换日志核对无匹配单据，提现地址簿也查不到该目的地，未触发任何限额或 KYT 拦截，结论：外部幽灵转出）→「Add Note」→ 下滑到「Assessment」区：Assessed amount 填 `250000.00`、Assessment basis 选 **Loss recognized**（=`FIRM_LOSS`，公司认损）、勾选「Regulatory report required」→ 报送依据自动展开两个候选，勾 **CRM IV.E.5 — Material Client Money discrepancy**（唯一勾选，`CRM V.D.2` 不勾）→「Submit Assessment」→ 状态转 `Assessed`，页面顶部横幅「Regulatory filing opened: `FIL260930017382`」——提交定损联动自动开出的 `INCIDENT_REPORT` 报送单，本场景不展开、留到场景 32 起草送签。

⑥ **认损调账**：回案件页，差异行按钮组收窄为一个「Recognize loss」（金额已被事故定损锁死）→ 点开「Recognize loss · Match the books to custody, firm compensates after」锁定视图——「Unlocked by」三行只读依据（Incident `INC260930949208` · loss assessed (FIRM_LOSS) / Amount locked = 250,000.00 AED / Small-amount threshold not applicable）、Reason 固定「[Recognize loss] Client loss recognition」、Direction `Reduce`、Amount 250,000.00 AED（锁定不可改）、Effective date 当日（免账龄线，不用等超期）→「Open & Submit」→ 调账单 `ADJ260930497277` 落 `Pending Approval`，Posting Preview：`DR L.CLIENT_PAYABLE / CR A.CLIENT_ASSET 250,000.00 AED` → 切 `cfo@` 打开审批 `APR260930081440`，Impact 摘要一句话读到"Client loss recognition (incident INC260930949208 assessed 250000.00 AED): debit client payable, credit client asset pool; customer CU2601017625 wallet WA2601014725 difference 250000.00 recognized as loss, customer balance reduced accordingly; … a compensation transfer will follow to restore the balance."→ Approve（二次确认）→ 调账单转 `Posted`，落账。

⑦ **回事故详情页挂载认损单**（解锁补款入口的前置动作）：Remediation 区 Type 选 `Adjustment`、Reference No 填 `ADJ260930497277` →「Link」→ 事故状态转 `Resolving`，「Initiate Compensation」按钮出现 → 点开，跳回案件页并自动弹出「Initiate compensation · Firm compensates the customer after loss recognition」锁定视图：Customer/Wallet `CU2601017625 · WA2601014725`、Amount（locked）250,000.00 AED、Source loss recognition no `ADJ260930497277`、Route「Operating account → Settlement account → Customer vIBAN (2 flat legs)」→ 填 Reason → 「Submit to CFO」→ 补款划转单 `ITR260930393123` 落 `Pending Approval`（关联审批 `APR260930960724`）。

> ⚠️ **剧本纪律（Bob 负可用窗口，纯讲台约束，系统不拦）**：从本帧（认损调账 ⑥ 已落账，Bob 客户侧余额已被扣减 250,000.00）到下一帧补款划转第二腿真正到账为止，Bob 的客户侧**可用余额在系统里为负**（认损已扣、补款未到）——这段窗口内**不展示 Bob 的客户余额页**、**也不批准他在册的 250,000 AED 在途提现单**（`WDR260930768402`，`#18 大额待审批`）。系统层面没有任何校验挡住这两个动作，纯粹是讲台纪律：观众此刻若看见负数或批出一笔提现，画面会失真。

⑧ 切 `cfo@` 打开审批 `APR260930960724`，Impact 摘要「Pay customer CU2601017625 compensation of 250000.00 AED (adjustment ADJ260930497277, case REC20260930-001); the firm operating account decreases accordingly」→ Approve → 划转单转 `Executing`，腿 1 资金单自动建（`FDO260930636278`，F_OPS→结算户）→ 切回 `treasury@` 打开该腿 ⚡ **Submit** → ⚡ **Settle**（码 81 落账，运营户 AED 已减）→ 划转单自动建腿 2（`FDO260930667965`，结算户→Bob 钱包）→ 打开该腿 ⚡ **Submit** → ⚡ **Settle**（码 82+83 落账，客户侧复位——Bob 的 AED 托管余额补回 250,000.00）→ 划转单转 **`Success`**，两腿状态均 `Cleared`。

⑨ 回案件页点「Re-reconcile」→ 案子转 **`Resolved`**（`RUN20260930-2 · closed`），差异行下方新增「Compensation `ITR260930393123` · Received」——案件愈合关闭。**收尾镜头**：切 Company Funds 看板——「Net Liquid Assets (Regulatory)」整区转红，红横幅「NLA below regulatory floor — shortfall AED 85,247.75. A prudential incident must be registered (Incident Register, CFO).」，三个数 NLA AED 1,114,752.25 / Floor AED 1,200,000.00 / Headroom **AED −85,247.75**；下方运营户水位卡 AED 696,089.35（低于见底线 900,000，转红）+ USDT 113,999.428189（未跌破）— 两条线（公司运营户见底线、全公司 NLA 红线）在同一笔补款划转里一起被打穿，红横幅在场——客户池已复原，公司自己撞了监管线，场景 32 的钩子在此挂上。

**判据**：事故一生六步（登记/调查/定损/认损/补款/结案前挂载）除结案与通报（留场景 32）外全程 `treasury@` 一手完成，审批均 `cfo@` 单人；认损调账与补款划转两张单金额均锁死于定损额 250,000.00、不可编辑；补款划转在 NLA 已跌破的窗口内（划转发起时 NLA 尚未跌破，划完才跌破）照常发起成功——豁免生效的行为证明（裁定 1）；客户池 AED 复原到失窃前值、F_OPS(AED) 差额精确等于失窃额；收尾帧双线齐红（AED 见底线 + 全公司 NLA 红线）、红横幅在场。

**账实证据**（走查后，self 栈，2026-09-30）：

- `bash scripts/on-stack.sh self verify:coa` — 退出码 `0`，关键行：`✓ ledger 1 CLIENT 恒等 29612565` / `✓ ledger 1 FIRM 恒等 69620335` / `✓ ledger 2 CLIENT 恒等 4392571811` / `✓ ledger 2 FIRM 恒等 114013428189` / `✓ 负余额检查 通过 (67 个科目全部 ≥ 0)` / `ALL INVARIANTS PASS`（划转后时点，两恒等式 + 负余额全绿）。
- TB 直读两数（`tigerbeetle-node` 直连账户，非 Prisma 镜像表）：Bob AED 托管两科目（`CLIENT_PAYABLE` + `DEPOSIT_SUSPENSE`）合计 `creditsPosted−debitsPosted` = 25,710,000 + 510,000 = **26,220,000 分（262,200.00 AED）**，回到失窃前值（`available` 口径此刻 710,000+510,000=1,220,000 分，因 Bob 在册的 250,000 提现单仍押着 `debitsPending`，与本场景无关，纯属该客户自身在途单）；F_OPS(AED) 科目 `creditsPosted−debitsPosted` = **69,608,935 分（696,089.35 AED）**，与看板运营户卡、`GET /admin/prudential/status` 的 `perAsset[0].balanceMinor` 逐位一致，差额 94,608,935−69,608,935=25,000,000 分，精确等于失窃额 250,000.00 AED。

走查截图 `t8-01`～`t8-18` 入 `doc-final/superpowers/checkups/2026-09-30-campaign-b-wave3-evidence/`。

**期望**：观众看懂三件事——① 事故一生（登记→调查→定损→善后→结案）不是抽象流程图，是同一个客户、同一笔钱，从"少了"到"补回来"全程留痕可查；② 认损与补款是两个不同的动作——认损让账跟着外部事实走平（公司认了这笔损失），补款才是对客户的实际交代（钱真的补回卡里），中间隔着一张锁死金额的调账单和一次 CFO 审批；③ 审慎红线不是纸面数字——客户资金安全事件真实发生时，补偿客户的义务优先于公司自己的流动性缓冲（豁免生效），但公司自己也会因此撞线，看板红横幅当场证明这不是走过场。

## 场景 32（暂编，归第九幕「公司的钱」，幕号 T10 统一定稿）· 审慎红线：跌破 → 报监管 → 注资复原（V7 财资 · 公司资金 + V9 事件中心 + 报送台）

> 战役乙波三交付（2026-09-30），承接场景 31 穿底主线的收官——事故 `INC260930949208` 留在 RESOLVING、报送单 `FIL260930017382` 留在 DRAFT、公司自己的 NLA 撞穿监管红线，均是场景 31 刻意留下的钩子。本场景演完，第九幕「公司的钱」落幕。主篇文档 `modules/company-funds.md`、事件中心/报送台相关篇。本场景 2026-09-30 T9 在 self 栈全程实走一遍（真提交/真点击，非种子摆拍，金库/CFO/合规官/高管/MLRO 五账号轮转），二十七张截图留证。

**造数**：**承接场景 31 现场，连场演出**——不 reset、不重铺、不重复造数。开场即是场景 31 收尾时点：`GET /admin/prudential/status` `breached=true`（NLA AED 1,114,752.25 / 红线 AED 1,200,000.00 / 缺口 AED −85,247.75）；事故 `INC260930949208` 状态 `RESOLVING`（认损调账已挂，补款划转尚未挂）；报送单 `FIL260930017382` 状态 `DRAFT`（CRM IV.E.5，场景 31 提交定损时自动开出，尚未起草送签）。

**讲什么**：公司自己撞穿了监管红线——不是纸面数字，是金库真开不出付款单的现场演给你看。金库巡检抓红、CFO 登记一起新的审慎事故（跟场景 31 那起客户资金事故是两回事：一个管别人的钱，一个管自己的钱）、报送 VARA、股东注资补回、复原。同一时间把场景 31 留的那张报送单和那起事故一并收尾——两条监管义务、两起事故，同一场戏收官。

**账号**：`treasury@fiatx.com`（金库，巡检 / 试开付款单 / 注资单开单兑现 / 挂载补款划转引用全程）→ `cfo@fiatx.com`（CFO，登记/调查/定损/结案请求审慎事故 + 批注资单 + 安全事故结案终批）→ `compliance_lead@fiatx.com`（合规官，两张报送单起草/送签/标已提交）→ `sm@fiatx.com`（高管/高级管理层，报送签发批准 + 审慎事故结案单步裁决）→ `mlro@fiatx.com`（MLRO，安全事故结案两步门第一步）。

**走查**：

① 金库登录 Company Funds 看板，「Net Liquid Assets (regulatory)」区点「Run prudential check」→ 结果卡当场转红：`NLA_BREACH — shortfall AED 85,247.75`，与持续显示的红横幅（NLA AED 1,114,752.25 / Floor AED 1,200,000.00 / Headroom AED −85,247.75）互为印证——巡检审计 `PRUDENTIAL_CHECK_PERFORMED`（`reasonCode=NLA_BREACH`）落痕。

② **门的现场证明**：金库切 Vendor Payments →「Initiate payment」→ 随手选一家在册 ACTIVE 供应商（Gulf Office Systems）+ 5,000.00 AED + 例行文案 →「Initiate」→ 400 拒单，弹层内联红字三个数在屏：「Blocked by prudential floor (Company Rulebook VI.C): this payment would take Net Liquid Assets below the regulatory floor — NLA now 1114752.25 AED, after 1109752.25 AED, floor 1200000.00 AED.」——单未建、无单号，`PRUDENTIAL_GATE_BLOCKED` 审计落 `outcome=DENIED`，metadata 三个数俱全。跌破期间一切裁量出款被拦，客户资金事故留下的补款/注资两个豁免口子在④/⑦当场验证仍然放行。

③ 切 `cfo@` → 事件中心「Register Incident」→ Type 选 **Prudential (NLA) breach**（FINANCIAL 族，CFO 独占经办）→ Title/Description 引用①的巡检结果 → 类型专属锚字段 Metric (NLA)=`NLA`、Shortfall amount=`85247.75`（两枚必填锚，落 `subjectRefs`）→ Register → 事故 **`INC260930508979`** 落库，状态 `Registered`。

④ 同一账号「Start Investigation」→ 状态转 `Investigating` → 下滑 Assessment 区：Assessed amount `85247.75`、Assessment basis 唯一可选 **Shortfall assessed**、勾 **Regulatory report required**、报送依据唯一候选 **Company Rulebook VI.C / VI.F — NLA prudential breach, notify VARA immediately; daily updates until VARA is satisfied**（即时义务，界面不设小时倒计时）→「Submit Assessment」→ 状态转 `Assessed`，页面横幅「Regulatory filing opened: **`FIL260930300016`**」——定损联动自动开单，本类型 `allowedRemediationKinds` 空集，右栏提示「it can be closed directly once assessed」（不必先进 Resolving）。

⑤ 合规官打开 `FIL260930300016` → Filing Draft 填正文（引用巡检数字、根因、注资补救计划、「daily updates until VARA is satisfied」叙事）→「Save Draft」→「Submit for Sign-off」→ 状态转 `Pending Signoff`，审批 `APR260930889609` 开 → 切 `sm@` 审批中心 Approve（单步 SENIOR_MANAGEMENT_OFFICER）→ 状态转 `Signed Off` → 切回 `compliance_lead@`「Mark Submitted」填对外编号 `VARA-PRU-2026-09-30-01` → 状态转 **`Submitted`**。

⑥ **顺手收场景 31 那张**：合规官打开 `FIL260930017382`（CRM IV.E.5，场景 31 提交定损时自动开出、留在 `Draft`）→ 填正文（引用场景 31 的事故细节：未授权转出 250,000.00 AED、认损、全额补偿）→「Save Draft」→「Submit for Sign-off」→ 审批 `APR260930902092` 开 → `sm@` Approve → 状态转 `Signed Off` → `compliance_lead@`「Mark Submitted」填 `VARA-SEC-2026-09-30-01` → 状态转 **`Submitted`**——四帧快速带过，只为闭合场景 31 事故结案前置门②。

⑦ 金库切 Capital Injections →「Initiate injection」→ Contributor Name `FiatX Holdings Ltd (founding shareholder)`（照场景 28 股东叙事名）+ Asset=AED + Amount **300,000.00**（≥缺口 85,247.75 取整）+ Prudential Purpose 引用本次缺口与事故/报送单号 + Reason → Initiate → 单据 **`CIN260930345280`** 转 `Pending Approval`，审批 `APR260930321132` 开（Impact 摘要读到「the firm's AED operating balance increases once the contribution is confirmed」）→ 切 `cfo@` Approve → 单据转 `Awaiting Contributor Payment` → 切回 `treasury@` →「⚡ Simulate contributor payment」→ 转 `Received`（蓝色横幅「Funds have landed...not yet posted」）→「Confirm receipt」→ Expected/Received 并排核数一致 → Confirm → 单据转 **`Success`**，落账——**跌破窗口内发起成功**：注资单从发起到批准到确认全程都在 `breached=true` 期间完成，豁免生效的行为证明。

⑧ 切 Company Funds 看板：红横幅消失，「Net Liquid Assets (regulatory)」区转绿，NLA **AED 1,414,752.25**（1,114,752.25 + 300,000.00）、Floor AED 1,200,000.00、Headroom **AED 214,752.25**；运营户 AED 水位 996,089.35（696,089.35 + 300,000.00），回到见底线 900,000 上方转绿——再点「Run prudential check」→ 结果卡转绿：「NLA_OK — NLA AED 1,414,752.25, Floor AED 1,200,000.00, Headroom AED 214,752.25. Logged to audit trail.」，与①的红卡成对照，`PRUDENTIAL_CHECK_PERFORMED`（`reasonCode=NLA_OK`）第二条审计落痕。

⑨ 切 `cfo@` 回 `INC260930508979` 详情页「Request Close」→ 结案审批 `APR260930835666` 开（`INCIDENT_CLOSE_PRUDENTIAL`，单步）→ 切 `sm@` 审批中心 Approve（Impact 摘要「Closing incident INC260930508979 (Prudential (NLA) breach): Assessment: shortfall assessed 85247.75, no remediation, reported to VARA」）→ 事故转 **`Closed`**——高管单步结案，前置门二证齐全：定损✓（SHORTFALL 85,247.75）+ 名下报送单已提交✓（`FIL260930300016` Submitted）。

⑩ 场景 31 事故收尾：金库回 `INC260930949208` 详情页 Remediation 区 Type 选 **Transfer**、Reference No 填补款划转单号 `ITR260930393123` →「Link」→ 挂载成功（认损 `ADJUSTMENT`／补款 `TRANSFER` 两条引用齐全，均在 Remediation 表）→「Request Close」→ 结案审批 `APR260930277119` 开（`INCIDENT_CLOSE_SECURITY`，两步）→ 切 `mlro@` Approve（Step 1）→ 切 `cfo@` Approve（Step 2，终批）→ 事故转 **`Closed`**。

⑪ **尾帧**：Incident Register 列表——`INC260930508979`（Prudential breach）与 `INC260930949208`（Unauthorized outflow）均 `Closed`；Regulatory Filings 列表——`FIL260930300016`/`FIL260930017382` 均 `Submitted`，各自 Incident 列回链两起事故；看板复原帧（⑧已拍）——两事故一并收官，公司的钱从穿底到复原、从秘密到通报，第九幕「公司的钱」落幕。

**判据**：门拒 400 三个数在屏（NLA/动后 NLA/红线）且单未建；补款划转（场景 31 帧⑦）与本场景注资单均在跌破窗口内真实发起成功——豁免生效的行为证明（裁定 1）在案；巡检红/绿两条审计各落一条（`NLA_BREACH`/`NLA_OK`）；两起事故均 `Closed`，两张报送单均 `Submitted`；`GET /admin/prudential/status` 终态 `breached=false`、`nlaAedMinor=141475225`（AED 1,414,752.25）；`verify:coa` 全程（含注资后时点）两恒等式 + 负余额全绿。

**账实证据**（走查后，self 栈，2026-09-30）：

- `bash scripts/on-stack.sh self verify:coa` — 退出码 `0`，关键行：`✓ ledger 1 CLIENT 恒等 29612565` / `✓ ledger 1 FIRM 恒等 99620335` / `✓ ledger 2 CLIENT 恒等 4392571811` / `✓ ledger 2 FIRM 恒等 114013428189` / `✓ 负余额检查 通过 (67 个科目全部 ≥ 0)` / `ALL INVARIANTS PASS`（注资落账后时点；`ledger 1 FIRM` 从场景 31 收尾的 69620335 涨到 99620335，涨幅精确等于注资额 30000000 分=300,000.00 AED）。
- 终态 `GET /admin/prudential/status`：`breached=false`、`nlaAedMinor=141475225`、`floorAedMinor=120000000`、`headroomAedMinor=21475225`（AED 1,414,752.25 / 1,200,000.00 / 214,752.25），与看板逐位一致。
- 两起事故终态：`INC260930508979`（本场景新登记的审慎事故）与 `INC260930949208`（场景 31 的未授权转出事故）均 `status=CLOSED`。
- 两张报送单终态：`FIL260930300016`（COMPANY_VI_C_F，本场景开）与 `FIL260930017382`（CRM_IV_E_5，场景 31 开）均 `status=SUBMITTED`。

走查截图 `t9-01`～`t9-27` 入 `doc-final/superpowers/checkups/2026-09-30-campaign-b-wave3-evidence/`。

**期望**：观众看懂三件事——① 审慎红线不是报表脚注，是金库真的开不出付款单的现场（门拒三个数在屏）；② 客户资金安全与公司自身审慎合规是两条不同的监管义务、两起独立的事故，但共享同一套登记/调查/定损/报送/结案机制，同一场戏里两条线各走各的门（CFO 单步 vs MLRO→CFO 两步）却收在同一次复原里；③ 补偿客户与补充公司自己的流动性，两者都不受跌破红线阻拦——义务优先于自身缓冲的豁免不是纸面条款，是补款划转与注资单在跌破窗口内真实发起成功这件事本身。
