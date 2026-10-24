# LP 兑换台（找 LP 平盘：库存见底怎么补货）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-10-24（LP 两步准入与打款地址簿：建档背调 + LPA 地址簿先筛后批 + 开单选地址抄单 + 到货来源筛查拦人不拦状态 + 改结算流程退役）；2026-09-29（战役乙波一：LP 地基与调拨落地）；2026-09-30 战役乙波三随第九幕定稿（导航组迁 Treasury）
> 演示幕次：第九幕「公司的钱」场景 26 / 27 / 36 ｜ 验收：`demo/script.md` 场景 26/27/36 + 本篇 §4

## 0. 一句话定位

管**运营户见底之后去哪补货**这件事。客户兑换天天消耗库存（USDT→AED 或反向），运营户迟早撑不住；这时金库向一家签了约的场外流动性提供商（LP）开一张**兑换单**——卖出一种资产、买入另一种，先款后货：我方先出钱，等 LP 把货打进一间"在途验收前厅"（`FIRM_LIQ` 科目复活），金库清点核对后才正式转入运营户。是 V7 财资域下的第二类新订单（第一类是内部划转单，见 `v7-treasury.md`）；LP 兑换见本篇。**运营户见底的水位线、以及公司自己的注资/付款单**在 `modules/company-funds.md`（战役乙波二，2026-09-29）——库存水位那格看板就是"该找 LP 了"的信号来源，两篇互为因果。

## 1. 业务叙事

**LP 是签了协议的外部对手方，不是客户，也不入账本科目；准入分两步，各裁一件事。** 第一步裁「**跟不跟这家做生意**」：金库建档（名称 + `agreementRef` 协议锚 + `dueDiligenceRef` 尽调档案引用号，三件必填），提交瞬间跑**实体背调**（mock 三档，见下），GREEN / YELLOW 才进 CFO 单步批。第二步裁「**钱打到哪条路上**」：档案生效后，金库按资产登记**打款地址**，登记即筛（归因 + 风险筛查）、先筛后批，CFO 批了才可被兑换单选用。启停两态只需留痕不需要审批（收紧动作不设门）。种子预铺两家：Falcon Liquidity FZE（ACTIVE，主用，带一条 AED IBAN + 两条 USDT-TRON 打款地址）与 Dune OTC DMCC（SUSPENDED，零地址，示范停用后开单被拒）；两家都带背调结论 GREEN 与尽调引用号。

**实体背调是我方的对手方尽调，不是 VASP 资质。** 背调 mock 是纯函数 `screenLpEntityName`（站在 Sumsub 一侧的能力，登记于 `reference/sumsub-mock-touchpoints.md`「实体背调」行）：LP 名称（大小写不敏感）含 `sanction` → RED，含 `offshore` → YELLOW，其余 GREEN；两词并存 RED 压过 YELLOW。**RED 一票否决**——建档当场落 `REJECTED`（落点计算，不是迁移表的边），不开审批单，连 CFO 队列都进不去；YELLOW 放行留痕。结论与 `dueDiligenceRef` 随建档落档案行，并写进审批载荷快照（CFO 批的不是盲盒）。背调只在建档时刻跑一次，没有 ⚡ 覆写（档案级的人工杠杆已有启停）。讲解口径：系统里的三档是线下尽调（对手方问卷 → 自取证与制裁/PEP/负面筛查 → 合规官一页风险评估定档 → CFO 批准建立关系）的**输出抽象**，材料柜留线下，系统只收结论 + 引用号 + 留痕。VASP 资质（EEC 状态 / 风险分 / 持牌）是另一顶帽子：它住 Sumsub 名录，只在 crypto 地址归因出 VASP 时引用（见下）。

**打款地址簿是独立主体**（`lp_payout_addresses`，业务键 `LPA…`），不写进客户提现地址表——客户簿的自助语义（验签 / 冷却 / 名额 / 客户面投影）LP 全用不上，复用的是对手方**套件**：归因 + 筛查同一个 mock adapter（同一 DI token、同一套尾号约定，`lp-desk` 模块自行 provide）、管理台筛查区块同款组件。**只做打款方向**（我方付给 LP 的坐标）；LP 打给我们的来源动态，不预存。一个 LP 在一种资产上可登记多条地址（组别由资产类型定：crypto 资产 → 网络 + 地址组，其余 → IBAN 组；带错组 `COORDINATE_GROUP_MISMATCH`），**不设名额上限，多条可同时 ACTIVE**，登记守卫是档案必须 ACTIVE（`LP_PROFILE_NOT_ACTIVE`）。每条登记必带 `evidenceRef`（协议锚：合同附件 / 条款引用号——LP 没有客户端入口，验签档走不通，这是客户簿「第三方申报书」档的 LP 对应物）；crypto 地址另由金库替 LP 自报托管方式（Self-Custody / VASP），与系统归因不一致即升 `hostingMismatch` 红旗，**只留痕不拦截**。

**登记即筛，先筛后批；无冷却、无验签。** 登记瞬间归因 + 筛查（尾号约定同客户簿：`1111` 归因 Mock VASP Exchange、`4444` 归因 Grey Harbor Exchange、`2222` YELLOW、`3333` RED，其余自托管 GREEN；IBAN 只筛不归因）。RED 当场 `REJECTED`（落点计算，无审批单，审计 `LP_ADDRESS_REGISTERED` + `LP_ADDRESS_SCREENED` + `LP_ADDRESS_REJECTED`〔系统，固定拒因 `Screening returned RED at registration`〕）；GREEN / YELLOW 才提 `LP_ADDRESS_APPROVAL`（载荷快照带坐标 + 归因 + 筛查结论 + 协议锚），CFO 单步批了才 `ACTIVE`。归因出 VASP 时，条目详情读**现拼**名录资质三行（VASP EEC Status / Risk Score / Licence，不落库，同充值 / 提现两域先例；名录只有两条：Mock VASP Exchange = COMPLETED / 3 / LICENSED，Grey Harbor Exchange = PENDING / 42 / UNLICENSED；政策口径只是展示文案，代码不据此判）。**坐标与自报登记后冻结，改只改 `label`**；改坐标 = 新登记，换地址 = 登新、生效后把旧的 Retire（永久退役；Suspend 是可恢复的暂停）。同一 (LP, 资产, 坐标) 已有**非终态**条目 → 409 `ADDRESS_ALREADY_REGISTERED`（占坑）；条目落入终态（REJECTED / CANCELLED / DEACTIVATED）后同坐标可重登。

**⚡筛查覆写**（合规官 `DEMO_VERDICT_WRITE`，金库喂不了）**只对 `PENDING_APPROVAL` 条目有效**：喂 GREEN / YELLOW 只改筛查结论、不迁移；喂 RED 走 REJECT 边进 `REJECTED`。已批准（ACTIVE）及以后的地址再喂一律 409、不写审计——⚡不是绕迁移表的直写通道。⚡喂红后那张 `LP_ADDRESS_APPROVAL` **仍留在 CFO 队列**（不自动撤：审批引擎只许提单人或超管撤单，合规官不是提单人；审计 metadata 记下被晾下的 `openApprovalNo`），此后到达的裁决由守卫吞掉、地址不会复活；演示口径是 CFO 以 Reject 把它清出队列（债登 `PRODUCTION-NOTES.md`）。

**一张兑换单，两个方向共用同一套状态机同一套码——没有 IN/OUT 枚举。** 每张单只是"卖出一种资产的金额 + 买入另一种资产的金额"，两边手填（成交价不接真实价源，业主拍板）。同一状态机既能演"库存见底找 LP 补货"（卖 AED 买 USDT），也能演"USDT 积压向 LP 回吐"（卖 USDT 买 AED）——方向由哪边是 sell、哪边是 buy 决定，不是两种订单类型。

**开单必选一条该 LP、该卖出资产下 ACTIVE 的打款地址，抄进单据（单据即快照）。** 弹窗选定 LP 与卖出资产后列出候选，唯一一条自动选中、多条留空逼着点选；绕过界面直接传任意地址号的，后端守卫同样拒，四道各一码：`PAYOUT_ADDRESS_NOT_FOUND`（查无）/ `PAYOUT_ADDRESS_WRONG_LP`（不是该 LP 的）/ `PAYOUT_ADDRESS_ASSET_MISMATCH`（登记资产 ≠ 卖出资产）/ `PAYOUT_ADDRESS_INACTIVE`（非 ACTIVE：待批 / 暂停 / 退役 / 被拒 / 撤回都算）。通过后 `payoutAddressNo` + 坐标（链上卖出币抄 `payoutAddress`、法币抄 `payoutIban`）落单据，之后**不回读地址簿**；腿 1 的收款坐标读单据列。**批准那一刻再复查**所选地址仍 ACTIVE——开单到批准之间被停用 / 退役的，单据落 `FAILED`（`failureReasonCode=PAYOUT_ADDRESS_INACTIVE`，走迁移表既有 PENDING_APPROVAL→FAILED 边，不建资金单、一分钱没付）。

**先款后货，悬空期看板可见。** CFO 批准后，我方卖出腿从运营户直出（不过前厅——前厅语义只收 LP 来的钱）；随即进入"等 LP 发货"的悬空期：运营户已经变瘪，在途验收前厅还空着，账实两头都能在账本页看到这个中间态。LP 把货打进前厅（`FIRM_LIQ`）后，单据转"已到货待验收"；金库点一下"验收"——纯展示的核数动作（应收 vs 实到并排），不做"不符"分支（业主拍板：不为想象中的分支写代码）——验收即触发第三条腿，把前厅的钱转进运营户，单据终态 `SUCCESS`。

**到货来源筛查——拦人不拦状态。** 腿 2 是全系统唯一「外部资金直进公司科目」的口子（前厅 + 人工验收的隔离仓结构本就在），本刀补的是「检查站有情报」。⚡Simulate LP delivery 弹层多一栏可选的来源坐标（链上买入币填地址、法币买入填 IBAN；留空 = 干净占位串，常量 `DEFAULT_DELIVERY_SOURCE`，值见 `demo/data.md`）：来源落腿 2 资金单的 from 与单据快照（`deliveryFromAddress` / `deliveryFromIban`），并同步过同一个 mock 筛查（`2222` YELLOW / `3333` RED，其余 GREEN；到货**不做归因**），结论与筛查时刻落单据（`deliveryScreeningAnswer` / `deliveryScreenedAt`），记 `LP_EXCHANGE_DELIVERY_SCREENED`（系统主体，非状态变更）。详情页出 Delivery screening 区块，非 GREEN 时亮琥珀（YELLOW）/ 红色（RED）横幅「flagged for review. Acceptance is not blocked.」。**筛查是监控标记，不是门**：RED 单照常 `DELIVERED`，验收照常可点、可走到 `SUCCESS`——`accept` 不读结论、迁移表零改动（铁律④不破；`lp-exchange-workflow.service.spec.ts` 有行为测试守这一条）。人看见红不点是业务纪律，同「验收是核数不是审批」口径；红旗之后的正式「拒收 / 退回」分支演示不做（登 `BACKLOG.md`）。

**F_LIQ 是本波复活的老科目。** 2026-08-13 COA v2 时因为零活体代码被退役（"期望恒 0"），本波因为 LP 在途验收这个真实需求而复活——科目码 203 原名原码不变，注释改写身世；对账映射从"恒 0"改成真 1:1 直比。这是战役乙波一唯一动 COA 的地方，其余记账都发生在既有 10 码之间；两步准入这一轮不动账本分录。

## 2. 状态机

### 2.1 LP 档案（LiquidityProvider）—— 四态四边

```
建档 + 实体背调 ── RED ──落点计算──▶ REJECTED（终态，无审批单）
                ── GREEN/YELLOW ──▶ PENDING_APPROVAL ──approve(CFO)──▶ ACTIVE ⇄ suspend/reactivate ⇄ SUSPENDED
PENDING_APPROVAL ──reject/timeout──▶ REJECTED（终态）
```

四态四边（表里的边）：`PENDING_APPROVAL→ACTIVE / REJECTED`、`ACTIVE→SUSPENDED`、`SUSPENDED→ACTIVE`——**背调 RED 的 REJECTED 不是边**，是建档时的落点计算（同客户地址 3333 先例）。建档（金库提 → 背调 → CFO 批）走审批；启停两边是金库直接操作，只留痕不经门。改结算坐标的流程（`proposeSettlementChange` → `applySettlementChange`）与档案上的四坐标列**已退役**（收款坐标改由 §2.2 地址簿承载）。

### 2.2 LP 打款地址（LpPayoutAddress）—— 六态六边六动作

```
登记 + 筛查 ── RED ──落点计算──▶ REJECTED（终态，无审批单）
            ── GREEN/YELLOW ──▶ PENDING_APPROVAL
PENDING_APPROVAL ──APPROVE(CFO)──▶ ACTIVE ⇄ SUSPEND / REACTIVATE ⇄ SUSPENDED
PENDING_APPROVAL ──REJECT(CFO 驳回 / 48h 超时 / ⚡喂 RED)──▶ REJECTED ｜ ──CANCEL(金库撤回)──▶ CANCELLED
ACTIVE ──DEACTIVATE(金库退役)──▶ DEACTIVATED（永久）
```

六态：`PENDING_APPROVAL / ACTIVE / SUSPENDED / DEACTIVATED / REJECTED / CANCELLED`；六动作 = 六条边（`PENDING_APPROVAL` 出 APPROVE / REJECT / CANCEL，`ACTIVE` 出 SUSPEND / DEACTIVATE，`SUSPENDED` 出 REACTIVATE），迁移表在 `constants/lp-payout-address-transitions.constant.ts`，穷举 6×6 = 36 个 (态, 动作) 组合恰好 6 个合法（`…transitions.constant.spec.ts`）。三个终态（REJECTED / CANCELLED / DEACTIVATED）零出边；`SUSPENDED` 不能直接退役，须先恢复。启停退与撤回都是金库直接操作、留痕不批；审批驱动的边（APPROVE / 审批侧 REJECT）带 `approvalNo` + `causationId`。

### 2.3 LP 兑换单（LpExchange）—— 八态八边

```
PENDING_APPROVAL ──approve+余额闸过+所选打款地址仍 ACTIVE──▶ EXECUTING（卖出腿建资金单并推进）
PENDING_APPROVAL ──approve+运营户卖出资产不足 / 所选打款地址已非 ACTIVE──▶ FAILED（不建资金单）
PENDING_APPROVAL ──reject/timeout──▶ REJECTED ｜ ──cancel(金库,待批时)──▶ CANCELLED
EXECUTING ──卖出腿清算──▶ AWAITING_DELIVERY（悬空期：等 LP 发货）
EXECUTING ──腿失败──▶ FAILED
AWAITING_DELIVERY ──⚡LP 打款落前厅（可带来源坐标，过来源筛查，结论只标记）──▶ DELIVERED（待验收）
DELIVERED ──accept(金库,验收=核数，RED 来源照样可点)──▶ SUCCESS（落验收转腿入运营户）
```

八态：`PENDING_APPROVAL / EXECUTING / AWAITING_DELIVERY / DELIVERED / SUCCESS / FAILED / REJECTED / CANCELLED`；边数不变（两种 FAILED 原因共用 `PENDING_APPROVAL→FAILED` 这一条边，失败码分 `INSUFFICIENT_FIRM_BALANCE` / `PAYOUT_ADDRESS_INACTIVE`）。三条腿各建一张资金单（第五父键 `lpExchangeId`）：腿 1（卖出，运营户直出，收款坐标 = 单据开单时抄下的 `payoutAddress` / `payoutIban`）DR FIRM_OPS/CR FIRM_ASSET、腿 2（LP 打款进前厅，from = ⚡入参来源或占位串）DR FIRM_ASSET/CR FIRM_LIQ、腿 3（验收转腿）DR FIRM_LIQ/CR FIRM_OPS——腿 3 外穿写两侧回单（内转腿同划转单先例，账实一致优先于"内转不外穿"的旧直觉）。

## 3. 决策点与角色

| 动作 | 谁发起 | 谁裁决 | 要点 |
|---|---|---|---|
| 建 LP 档案 | 金库（LP Register 页 Register LP：名称 + Agreement Ref + Due Diligence Ref + Reason 必填） | 背调 mock 先行；GREEN / YELLOW → CFO 单步 | RED 当场 REJECTED、不开审批单；审批载荷快照带背调结论与尽调引用 |
| 启停 LP | 金库 | — | 留痕不批，收紧动作 |
| 登记打款地址 | 金库（LP 详情页 Payout Addresses 区 Register address，档案 ACTIVE 才可登记） | 登记即筛；GREEN / YELLOW → CFO 单步 | 按资产挂；`evidenceRef` 必填；RED 当场 REJECTED、不开审批单；先筛后批、无冷却无验签 |
| 撤回登记 | 金库（条目详情 Withdraw Registration，待批时） | — | 先撤审批单再翻 CANCELLED（提单人或超管才撤得动审批单） |
| 停用 / 恢复 / 退役地址 | 金库（条目详情 Suspend / Reactivate / Retire） | — | 留痕不批；Retire 永久；换地址 = 登新批准后停旧 |
| 改标签 | 金库（条目详情 Rename Label） | — | 坐标与自报冻结，唯一可改的字段，留痕 `LP_ADDRESS_LABEL_UPDATED` |
| ⚡ 筛查覆写 | 合规官（条目详情 Screening Simulation ⚡） | — | `DEMO_VERDICT_WRITE`；**仅待批态**；喂 RED → REJECTED；在途审批单留队列，CFO Reject 清队 |
| 开 LP 兑换单 | 金库（LP Exchanges 页，守卫 = 档案 ACTIVE ∧ 所选地址属该 LP、匹配卖出资产、ACTIVE） | CFO 单步 | 卖出/买入两边金额手填 + 审慎管理目的必填 + 必选一条打款地址（抄单） |
| ⚡ 推卖出腿 | 金库（资金单页，模拟门控） | — | 运营户直出，走既有资金单 Submit/Settle（法币腿）或 Broadcast/Mempool/Confirm（加密腿） |
| ⚡ 模拟 LP 打款 | 金库（兑换单详情页，弹层可填来源 Address / IBAN） | — | AWAITING_DELIVERY → DELIVERED，前厅落钱；来源过筛查，结论标在单据上 |
| 验收 | 金库（DELIVERED 态详情页） | — | 应收（buyAmount）vs 实到（腿 2 资金单金额）并排展示，纯核数零逻辑；**不读到货筛查结论**；确认即触发第三腿 |
| 撤回兑换单 | 金库（待批时） | — | 执行中不许撤 |

## 4. 演示脚本

场景 26（正向全弧：卖 AED 买 USDT，含悬空期停点 + 验收；开单选 Falcon 唯一的 AED IBAN 地址）、场景 27（反向快演：卖 USDT 买 AED；Falcon 有两条 USDT 地址须点选）与场景 36（LP 两步准入与地址治理：建档背调三档 → 地址登记先筛后批 → ⚡喂 RED → 换地址 → 开单选地址 → ⚡到货红旗、验收仍可点）——步骤在 `demo/script.md` 第九幕「公司的钱」。

## 5. 关键技术节点

- 主体 `src/modules/asset-treasury/lp-desk/`：`lp-profile.service.ts`（四态迁移表 / 建档背调落点 / 零 UUID 投影）、`lp-payout-address.service.ts`（六态迁移表 / 登记即筛落点计算 / 零 UUID 投影 / 详情读现拼名录资质）、`lp-exchange.service.ts`（八态迁移表 / 余额闸 / 三腿计划）；工作流 `lp-profile-workflow.service.ts`（建档 / 启停）、`lp-payout-address-workflow.service.ts`（登记 / 审批裁决 / 撤回 / 启停退 / 改标签 / ⚡筛查覆写）、`lp-exchange-workflow.service.ts`（发起 / ⚡推腿 / ⚡模拟到货 + 来源筛查 / 验收）；实体背调 mock `lp-entity-screening.mock.ts`（纯函数 `screenLpEntityName`，不扩共享 `TRAVEL_RULE_ADAPTER`）
- 审批类型 `LP_PROFILE_APPROVAL` / `LP_ADDRESS_APPROVAL` / `LP_EXCHANGE_APPROVAL`（均金库提 / CFO 单步 / 48h / 可撤，白名单表已登记；`MAKER_GROUP_BY_POLICY` 三条均挂 `LP_WRITE`）；`LP_PROFILE_CHANGE` 已随改结算流程退役
- 转账码新段 84/85/86（`LP_EXCHANGE_PAY` / `LP_EXCHANGE_RECEIVE` / `LP_EXCHANGE_ACCEPT`）；资金单第五父键 `lpExchangeId`
- COA：`FIRM_LIQ`=203 复活（`tb-account-codes.constant.ts`）；对账映射 `wallet-recon-run.service.ts` 从"退役科目期望恒 0"改真 1:1 直比（`wallet-balance-checker.service.ts` 同款）
- 对手方套件复用：`lp-desk.module.ts` 自行 provide `TRAVEL_RULE_ADAPTER` → `MockTravelRuleAdapter`（`attributeAddress` / `screenAddress` / `getVaspProfile`），是该 token 的第四个 provide 点；到货来源筛查走 `screenAddress`（法币来源传银行通道 `BANK_RAIL_NETWORK`）
- 审计：TREASURY 域 LP 现役 **24 码**——档案族 6（`LP_PROFILE_CREATED / SCREENED / APPROVED / REJECTED / SUSPENDED / REACTIVATED`）、地址族 9（`LP_ADDRESS_REGISTERED / SCREENED / APPROVED / REJECTED / CANCELLED / SUSPENDED / REACTIVATED / DEACTIVATED / LABEL_UPDATED`）、兑换族 9（`LP_EXCHANGE_REQUESTED / CANCELLED / REJECTED / EXECUTION_STARTED / PAY_LEG_POSTED / DELIVERED / DELIVERY_SCREENED / ACCEPTED / FAILED`）；退役 `LP_PROFILE_CHANGE_PROPOSED / APPLIED / REJECTED` 三码已入 `DEPRECATED_AUDIT_ACTIONS`（退役四件套）。全库现役 **360 码**（`npm run audit:vocab`，2026-10-24 实跑，TREASURY 域 45）
- 权限：`treasury.view_lp`（`LP_READ`，金库 / CFO / 内审 / **合规官**四职务——合规官是 LP 两步准入 T4 评审裁定新加的：⚡筛查覆写的持有者得能打开 LP 页面，只读、不持 `LP_WRITE`）、`treasury.act_lp`（`LP_WRITE`，金库独持：建档 / 启停 / 地址登记·撤回·启停退·改标签 / 开单 / ⚡到货 / 验收）；⚡`simulate-screening` 端点挂 `DEMO_VERDICT_WRITE`（合规官持，零新权限组）。`verify:rbac` S13 守这三条（LP 两组四处齐 / LP_WRITE 金库独持 / LP_READ 恰四者）
- 端点：`admin/lp-profiles`（list/create/detail/suspend/reactivate）、`admin/lp-profiles/:lpNo/payout-addresses`（POST 登记 / GET 列表）、`admin/lp-payout-addresses/:addressNo`（GET 详情 + `POST cancel / suspend / reactivate / deactivate / simulate-screening` + `PATCH label`）、`admin/lp-exchanges`（list/create/detail/cancel/simulate-delivery/accept；`simulate-delivery` 收可选 `fromSource`）；`settlement-change` 端点已不存在（`lp-profile.controller.spec.ts` 读 Nest 路由元数据断言）
- 表 `liquidity_providers`（加 `screeningAnswer` / `screenedAt` / `dueDiligenceRef`，退役 `fiatBankName` / `fiatIban` / `cryptoNetwork` / `cryptoAddress` 四列）／`lp_payout_addresses`（新）／`lp_exchanges`（加 `payoutAddressNo` / `payoutAddress` / `payoutIban` 与 `deliveryFromAddress` / `deliveryFromIban` / `deliveryScreeningAnswer` / `deliveryScreenedAt`）；三表 reset 登记已补（`lpPayoutAddress` 排在 `liquidityProvider` 之前）；迁移 `20261024072146_lp_two_step_additive`（加法）+ `20261024100112_retire_lp_profile_coordinates`（退役四列）
- admin-web：`LpProfileList/Detail`（Detail 内含 Entity Screening 区与 Payout Addresses 区块 + Register 弹层，**地址簿不另立导航项**）、`LpPayoutAddressDetail`（Attribution / Self-declaration & Red Flag / Screening 区块同款组件，操作段排信息段前）、`LpExchangeList/Detail`（开单弹层 Payout Address 选择；详情 Payout Address 回链 + Delivery Screening 区块 + ⚡到货弹层）；**Treasury 导航组**「LP Register」/「LP Exchanges」（战役乙波三导航归并：与注资/付款/看板同属 V7 财资域，原挂 Custody 组已迁出）

## 6. 演示缺口（BACKLOG 有账）

- 验收弹层 Received 现取（腿 2 资金单详情）失败时静默呈 `—`，不拦确认——演示 RBAC 下不触发，登 `PRODUCTION-NOTES.md`
- 账本科目页 USDT-TRON 类资产（code≠currency）小数位显示错位，LP 兑换台相关数字（前厅/运营户 USDT 余额）在这类账本视图里显示成十倍数——既有 admin 前端 bug（非 LP 专属），已挂业主任务 `task_475851be`，登 `BACKLOG.md`
- ⚡喂 RED 后，被晾下的 `LP_ADDRESS_APPROVAL` 滞留 CFO 审批队列直到被裁决或 48h 超时（迟到裁决有守卫吃掉，地址不复活）——演示口径是 CFO 以 Reject 清队；真集成需「审批单随主体失效」机制，登 `PRODUCTION-NOTES.md`
- 到货来源筛查红旗后无「拒收 / 退回」正式分支（演示讲到「红旗拦住验收的人」为止）；LP 来源（收款）地址的登记与到货**归因**（「真是 Falcon 打来的吗」，依赖的独立归因接口租户 403 未开通）；LP 腿的 KYT / Travel Rule 报文提交——均登 `BACKLOG.md`
- 地址簿与档案的 DB 级约束 / 格式校验（坐标唯一键、IBAN / 链地址格式与归一化、筛查列正断言门）按根纲禁做，登 `PRODUCTION-NOTES.md`
- LP 簿的条目详情有名录资质三行，客户提现地址详情页没有——两簿口径差异，登 `BACKLOG.md` 待业主斟酌
