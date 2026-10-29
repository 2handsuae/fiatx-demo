# LP 兑换台（找 LP 平盘：库存见底怎么补货）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-10-29（甲波六·服务商与 LP 的背调与审批：LP 准入第一步由「建档 + mock 实体背调 + CFO」改为「尽调申请 → 合规评估 → CFO / 高管审批」——档案 4 态 4 边 → 6 态 9 边，申请表扩成 12 个新字段 + 六份文件上传（系统首次存文件，业务号 `DOC…`），合规官逐名登记筛查并定风险档（新主体「尽调评估」`DDA…` / 筛查记录 `SCR…`，住 Compliance Office 域，见 `modules/compliance-office.md` §3.3），高风险档走 CFO → 高管两步审批（新策略 `LP_PROFILE_HIGH_RISK_APPROVAL`）；mock `screenLpEntityName`、档案上的 `screeningAnswer` / `screenedAt` 两列与自由文本尽调引用号列、审计码 `LP_PROFILE_SCREENED` 退役；LP 审计码 24 → 27；本篇 §1 §2.1 §3 §5 §6 已按代码重写，打款地址簿与兑换单部分未动）；此前 2026-10-24（LP 两步准入与打款地址簿：建档背调 + LPA 地址簿先筛后批 + 开单选地址抄单 + 到货来源筛查拦人不拦状态 + 改结算流程退役）；2026-09-29（战役乙波一：LP 地基与调拨落地）；2026-09-30 战役乙波三随第九幕定稿（导航组迁 Treasury）
> 演示幕次：第九幕「公司的钱」场景 26 / 27 / 36 / 37 / 38 ｜ 验收：`demo/script.md` 场景 26/27/36/37/38 + 本篇 §4

## 0. 一句话定位

管**运营户见底之后去哪补货**这件事。客户兑换天天消耗库存（USDT→AED 或反向），运营户迟早撑不住；这时金库向一家签了约的场外流动性提供商（LP）开一张**兑换单**——卖出一种资产、买入另一种，先款后货：我方先出钱，等 LP 把货打进一间"在途验收前厅"（`FIRM_LIQ` 科目复活），金库清点核对后才正式转入运营户。是 V7 财资域下的第二类新订单（第一类是内部划转单，见 `v7-treasury.md`）；LP 兑换见本篇。**运营户见底的水位线、以及公司自己的注资/付款单**在 `modules/company-funds.md`（战役乙波二，2026-09-29）——库存水位那格看板就是"该找 LP 了"的信号来源，两篇互为因果。

## 1. 业务叙事

**LP 是签了协议的外部对手方，不是客户，也不入账本科目；准入分两步，各裁一件事。** 第一步裁「**跟不跟这家做生意**」——甲波六起这一步是一次完整的**尽调**：金库在 Treasury → LP Register →「Register LP」填**尽调申请**并上传最多六份文件，合规官做**合规评估**（逐名登记筛查、定风险档、写意见），再由 CFO（高风险档加高管第二步）批准，批了才 ACTIVE。第二步裁「**钱打到哪条路上**」（未变）：档案生效后，金库按资产登记**打款地址**，登记即筛（归因 + 风险筛查）、先筛后批，CFO 批了才可被兑换单选用。启停两态只需留痕不需要审批（收紧动作不设门）。种子预铺三家：Falcon Liquidity FZE（ACTIVE，主用，带一条 AED IBAN + 两条 USDT-TRON 打款地址）与 Dune OTC DMCC（SUSPENDED，零地址，示范停用后开单被拒）——这两家都按「已走完全流程」补齐了尽调评估（Falcon 低风险、Dune 中风险，公司与 1 位实际控制人各一条绿色记录）、六份占位 PDF 和已批的审批单；另有 Sable Crest Trading FZCO（PENDING_ASSESSMENT，六份文件已传、1 位实际控制人 Marwan Al-Sable、一条筛查都没做），专供场景 38「红灯」一幕。

**尽调申请（金库）。** 申请页 `/admin/lp-profiles/new`（列表页「Register LP」按钮进入，提交按钮 Submit application），后端必填：法定名称、注册地（国家 / 辖区）、注册号、发牌机构 + 牌照号、交易类型（Spot exchange / OTC block trade，至少选一）、预计月交易量 + 币种、申请理由、协议编号（Agreement reference）、联系人 + 邮箱；选填：协议起始日、实际控制人（0 到多位，每位一个序号 `#seq` + 姓名 + 国籍）。实际控制人的序号是筛查记录指认某一位的依据：新申请里删人会重排，**被退回后重提时既有序号绝不重排、新增的取最大序号 + 1**。六份文件都可缺（缺了合规官可退回补料）：注册证书、股东 / 实际控制人名册、牌照副本、反洗钱制度或问卷、最近财报、授权签字人名单；PDF / PNG / JPG，单份 ≤ 10 MB，档案建好后逐份上传，**只在「待评估 / 已退回」两态可传**。提交即建档为 `PENDING_ASSESSMENT`（页面叫 Pending assessment），同一动作里自动开一份空的尽调评估 `DDA…`。**LP 不设交易额度上限**（业主 2026-10-28 否决：批准时填额度、开单时拦额度的方案不做，走审批即可）。已退役：自由文本的尽调档案引用号（旧 Due Diligence Ref 必填项及其档案列；尽调档案现在是系统内主体，详情页直接展示）、mock 实体背调（含 `sanction` 当场拒）、独立的 `reason` 字段（并入申请理由）。

**合规评估（合规官，LP 详情页 Due Diligence 区，`DUE_DILIGENCE_WRITE`）。** ①**逐名筛查记录**：公司名 + 每位实际控制人各至少一条；每条登记 Subject（Company / Beneficial owner，后者另选 `#seq · 姓名`）、Name screened、Lists checked（UN / OFAC / EU / UAE local / PEP / Adverse media 多选，页面要求至少勾一项）、Result（Green / Yellow / Red）、Screened at（默认当下可改）、Evidence screenshot（可缺，每条最多一张）。筛查是**合规官人工登记，系统不自动筛**（业主 2026-10-28 乙案，见 `decisions.md`），系统只收结果。②**评估**：Risk tier（Low / Medium / High）、Assessment opinion（必填）、Conditions（选填，如「仅限 USDT/AED 现货」），Save assessment 落库。③**三个互斥动作写入结论**：Return for documents（原因必填 → `RETURNED`，金库可改申请、补文件后 Edit & resubmit 回待评估，评估与筛查记录保留；有红灯时不提供，见下）、Reject（原因必填 → `REJECTED` 终态）、Send for approval（→ `PENDING_APPROVAL` 并开审批单）。结论是**覆盖**存最新一轮，往轮历史看审计时间线（每次落结论都有 `DD_ASSESSMENT_CONCLUDED`，metadata 带结论、原因、风险档）。

**送审的硬规则（后端 `DueDiligenceService#assertSendable`，页面同口径）。** 按顺序，第一道不过就拒：①评估下**任一条**筛查记录为 Red → 只能 Reject，「Return for documents」与「Send for approval」两个按钮都不出现（后端同拒：送审被 `assertSendable` 拒，退回被 `DueDiligenceService#assertReturnable` 拒，文案同为 `Screening hit (RED) — only REJECT is allowed`）；②公司与**现有**每位实际控制人都得有一条「**身份对得上**」的记录——公司：同类（Company）且名字相同；实际控制人：序号相同且名字相同；名字比对首尾去空白、大小写不敏感。所以**改名、换人都要补一条新的筛查记录**，被删者的记录留着但不再计入（它若是红，仍会按第①道挡住送审——红灯是字面规则），缺名时按钮置灰并点名「Screening missing for: …」；③风险档未定（Save a risk tier and opinion first）。（服务商线另有第④⑤道 CISO 评估，见 `modules/compliance-office.md` §3.3。）**退回补料只过第①道**（LP 线没有 CISO 评估，故只此一道）：缺名 / 未定档不拦退回，Reject 不经任何前置检查。**Return / Reject / Send 三个动作只在「待评估」态可下**：被退回（`RETURNED`）的申请必须先由金库重提，合规官才能再下结论——退回期间筛查记录、评估表单仍可编辑（为重提后的评估备料），页面提示「back with Treasury for resubmission」。

**审批按风险档分流，提单人是合规官。** Low / Medium → `LP_PROFILE_APPROVAL`（既有，CFO 单步）；High → `LP_PROFILE_HIGH_RISK_APPROVAL`（新，CFO 第一步 → 高管 `SENIOR_MANAGEMENT_OFFICER` 第二步；两步先例同 `DEPOSIT_SEIZE`）。点「Send for approval」的合规官就是审批单的提单人（requester），审批理由取评估意见，载荷快照 `{lpNo, name, registeredIn, licensingAuthority, riskTier, conditions, assessmentNo}`（批准人批的不是盲盒）；两步审批单只在末票发 APPROVED。批准 → `ACTIVE`；驳回或 48h 超时 → `REJECTED`；撤单（只有提单人合规官或超管能撤）→ **回 `PENDING_ASSESSMENT` 重新评估**，评估壳与结论原样保留。**评估的可写窗口完全跟着档案状态走**（评估本身不设状态列、不另立迁移表）：待评估 / 已退回态，文件、筛查记录、评估表单可写；送审后（`PENDING_APPROVAL`）及终态一律锁（`Assessment is locked`），撤单回待评估即重新解锁。黄色记录不自动绑任何东西：它只是合规官定档、写附加条件的依据，不强制档位、不改审批路线。VASP 资质（EEC 状态 / 风险分 / 持牌）是另一顶帽子：它住 Sumsub 名录，只在 crypto 地址归因出 VASP 时引用（见下）。

**打款地址簿是独立主体**（`lp_payout_addresses`，业务键 `LPA…`），不写进客户提现地址表——客户簿的自助语义（验签 / 冷却 / 名额 / 客户面投影）LP 全用不上，复用的是对手方**套件**：归因 + 筛查同一个 mock adapter（同一 DI token、同一套尾号约定，`lp-desk` 模块自行 provide）、管理台筛查区块同款组件。**只做打款方向**（我方付给 LP 的坐标）；LP 打给我们的来源动态，不预存。一个 LP 在一种资产上可登记多条地址（组别由资产类型定：crypto 资产 → 网络 + 地址组，其余 → IBAN 组；带错组 `COORDINATE_GROUP_MISMATCH`），**不设名额上限，多条可同时 ACTIVE**，登记守卫是档案必须 ACTIVE（`LP_PROFILE_NOT_ACTIVE`）。每条登记必带 `evidenceRef`（协议锚：合同附件 / 条款引用号——LP 没有客户端入口，验签档走不通，这是客户簿「第三方申报书」档的 LP 对应物）；crypto 地址另由金库替 LP 自报托管方式（Self-Custody / VASP），与系统归因不一致即升 `hostingMismatch` 红旗，**只留痕不拦截**。

**登记即筛，先筛后批；无冷却、无验签。** 登记瞬间归因 + 筛查（尾号约定同客户簿：`1111` 归因 Mock VASP Exchange、`4444` 归因 Grey Harbor Exchange、`2222` YELLOW、`3333` RED，其余自托管 GREEN；IBAN 只筛不归因）。RED 当场 `REJECTED`（落点计算，无审批单，审计 `LP_ADDRESS_REGISTERED` + `LP_ADDRESS_SCREENED` + `LP_ADDRESS_REJECTED`〔系统，固定拒因 `Screening returned RED at registration`〕）；GREEN / YELLOW 才提 `LP_ADDRESS_APPROVAL`（载荷快照带坐标 + 归因 + 筛查结论 + 协议锚），CFO 单步批了才 `ACTIVE`。归因出 VASP 时，条目详情读**现拼**名录资质三行（VASP EEC Status / Risk Score / Licence，不落库，同充值 / 提现两域先例；名录只有两条：Mock VASP Exchange = COMPLETED / 3 / LICENSED，Grey Harbor Exchange = PENDING / 42 / UNLICENSED；政策口径只是展示文案，代码不据此判）。**坐标与自报登记后冻结，改只改 `label`**；改坐标 = 新登记，换地址 = 登新、生效后把旧的 Retire（永久退役；Suspend 是可恢复的暂停）。同一 (LP, 资产, 坐标) 已有**非终态**条目 → 409 `ADDRESS_ALREADY_REGISTERED`（占坑）；条目落入终态（REJECTED / CANCELLED / DEACTIVATED）后同坐标可重登。

**⚡筛查覆写**（合规官 `DEMO_VERDICT_WRITE`，金库喂不了）**只对 `PENDING_APPROVAL` 条目有效**：喂 GREEN / YELLOW 只改筛查结论、不迁移；喂 RED 走 REJECT 边进 `REJECTED`。已批准（ACTIVE）及以后的地址再喂一律 409、不写审计——⚡不是绕迁移表的直写通道。⚡喂红后那张 `LP_ADDRESS_APPROVAL` **仍留在 CFO 队列**（不自动撤：审批引擎只许提单人或超管撤单，合规官不是提单人；审计 metadata 记下被晾下的 `openApprovalNo`），此后到达的裁决由守卫吞掉、地址不会复活；演示口径是 CFO 以 Reject 把它清出队列（这是业务缺口，已登 `BACKLOG.md`：规则草案「地址被筛查拒掉时在途审批单同步作废」）。

**一张兑换单，两个方向共用同一套状态机同一套码——没有 IN/OUT 枚举。** 每张单只是"卖出一种资产的金额 + 买入另一种资产的金额"，两边手填（成交价不接真实价源，业主拍板）。同一状态机既能演"库存见底找 LP 补货"（卖 AED 买 USDT），也能演"USDT 积压向 LP 回吐"（卖 USDT 买 AED）——方向由哪边是 sell、哪边是 buy 决定，不是两种订单类型。

**开单必选一条该 LP、该卖出资产下 ACTIVE 的打款地址，抄进单据（单据即快照）。** 弹窗选定 LP 与卖出资产后列出候选，唯一一条自动选中、多条留空逼着点选；绕过界面直接传任意地址号的，后端守卫同样拒，四道各一码：`PAYOUT_ADDRESS_NOT_FOUND`（查无）/ `PAYOUT_ADDRESS_WRONG_LP`（不是该 LP 的）/ `PAYOUT_ADDRESS_ASSET_MISMATCH`（登记资产 ≠ 卖出资产）/ `PAYOUT_ADDRESS_INACTIVE`（非 ACTIVE：待批 / 暂停 / 退役 / 被拒 / 撤回都算）。通过后 `payoutAddressNo` + 坐标（链上卖出币抄 `payoutAddress`、法币抄 `payoutIban`）落单据，之后**不回读地址簿**；腿 1 的收款坐标读单据列。**批准那一刻再复查**所选地址仍 ACTIVE——开单到批准之间被停用 / 退役的，单据落 `FAILED`（`failureReasonCode=PAYOUT_ADDRESS_INACTIVE`，走迁移表既有 PENDING_APPROVAL→FAILED 边，不建资金单、一分钱没付）。

**先款后货，悬空期看板可见。** CFO 批准后，我方卖出腿从运营户直出（不过前厅——前厅语义只收 LP 来的钱）；随即进入"等 LP 发货"的悬空期：运营户已经变瘪，在途验收前厅还空着，账实两头都能在账本页看到这个中间态。LP 把货打进前厅（`FIRM_LIQ`）后，单据转"已到货待验收"；金库点一下"验收"——纯展示的核数动作（应收 vs 实到并排），不做"不符"分支（业主拍板：不为想象中的分支写代码）——验收即触发第三条腿，把前厅的钱转进运营户，单据终态 `SUCCESS`。

**到货来源筛查——拦人不拦状态。** 腿 2 是全系统唯一「外部资金直进公司科目」的口子（前厅 + 人工验收的隔离仓结构本就在），本刀补的是「检查站有情报」。⚡Simulate LP delivery 弹层多一栏可选的来源坐标（链上买入币填地址、法币买入填 IBAN；留空 = 干净占位串，常量 `DEFAULT_DELIVERY_SOURCE`，值见 `demo/data.md`）：来源落腿 2 资金单的 from 与单据快照（`deliveryFromAddress` / `deliveryFromIban`），并同步过同一个 mock 筛查（`2222` YELLOW / `3333` RED，其余 GREEN；到货**不做归因**），结论与筛查时刻落单据（`deliveryScreeningAnswer` / `deliveryScreenedAt`），记 `LP_EXCHANGE_DELIVERY_SCREENED`（系统主体，非状态变更）。详情页出 Delivery screening 区块，非 GREEN 时亮琥珀（YELLOW）/ 红色（RED）横幅「flagged for review. Acceptance is not blocked.」。**筛查是监控标记，不是门**：RED 单照常 `DELIVERED`，验收照常可点、可走到 `SUCCESS`——`accept` 不读结论、迁移表零改动（铁律④不破；`lp-exchange-workflow.service.spec.ts` 有行为测试守这一条）。人看见红不点是业务纪律，同「验收是核数不是审批」口径；红旗之后的正式「拒收 / 退回」分支演示不做（登 `BACKLOG.md`）。

**F_LIQ 是本波复活的老科目。** 2026-08-13 COA v2 时因为零活体代码被退役（"期望恒 0"），本波因为 LP 在途验收这个真实需求而复活——科目码 203 原名原码不变，注释改写身世；对账映射从"恒 0"改成真 1:1 直比。这是战役乙波一唯一动 COA 的地方，其余记账都发生在既有 10 码之间；两步准入这一轮不动账本分录。

## 2. 状态机

### 2.1 LP 档案（LiquidityProvider）—— 六态九边

```
Register LP（金库提交尽调申请 + 材料）──▶ PENDING_ASSESSMENT（待评估；同一动作自动开尽调评估 DDA）
PENDING_ASSESSMENT ──Return for documents(合规官，原因必填)──▶ RETURNED ──Edit & resubmit(金库)──▶ PENDING_ASSESSMENT
PENDING_ASSESSMENT ──Reject(合规官，原因必填)──▶ REJECTED（终态）
PENDING_ASSESSMENT ──Send for approval(合规官，硬规则全过)──▶ PENDING_APPROVAL
PENDING_APPROVAL ──approve(Low/Medium: CFO；High: CFO→高管)──▶ ACTIVE ⇄ suspend/reactivate ⇄ SUSPENDED
PENDING_APPROVAL ──reject/timeout──▶ REJECTED（终态） ｜ ──cancel(提单人合规官 / 超管)──▶ PENDING_ASSESSMENT
```

六态九边（表里的边，`constants/lp-profile-transitions.constant.ts`）：`PENDING_ASSESSMENT→RETURNED / REJECTED / PENDING_APPROVAL`、`RETURNED→PENDING_ASSESSMENT`、`PENDING_APPROVAL→ACTIVE / REJECTED / PENDING_ASSESSMENT`、`ACTIVE→SUSPENDED`、`SUSPENDED→ACTIVE`；`REJECTED` 零出边。每条边在服务里有一条边→审计码映射（`ACTION_BY_EDGE`，九条一一对应，缺码抛 500 的完整性闸）；审批驱动的边（批准 / 驳回 / 撤单）带 `approvalNo` + `causationId`，`LP_PROFILE_REJECTED` 同时覆盖「合规官不通过」与「审批驳回」两条边（看 `fromStatus` 区分）。不再有「登记即拒」的落点计算——RED 实体背调已退役，档案的 `REJECTED` 只由合规官 Reject 或审批驳回走边到达（地址簿 §2.2 的登记即拒落点计算不受影响）。**三条出发态钉死**（共享迁移表里 `PENDING_APPROVAL→ACTIVE` / `PENDING_APPROVAL→PENDING_ASSESSMENT` 是可被借用的边）：`resubmit` 只收 `RETURNED`、`conclude` 只收 `PENDING_ASSESSMENT`、`reactivate` 只收 `SUSPENDED`，否则 400，状态与审计都不动。启停两边是金库直接操作，只留痕不经门。改结算坐标的流程（`proposeSettlementChange` → `applySettlementChange`）与档案上的四坐标列**已退役**（收款坐标改由 §2.2 地址簿承载）。
**SLA 答复：档案各态不计时。** `PENDING_ASSESSMENT` / `RETURNED` 没有时限（复审、到期提醒另立战役，不在本波）；`PENDING_APPROVAL` 的超时只靠审批单自身的 48h 兜底（到点审批侧 REJECT → `REJECTED`）。

### 2.2 LP 打款地址（LpPayoutAddress）—— 六态六边六动作

```
登记 + 筛查 ── RED ──落点计算──▶ REJECTED（终态，无审批单）
            ── GREEN/YELLOW ──▶ PENDING_APPROVAL
PENDING_APPROVAL ──APPROVE(CFO)──▶ ACTIVE ⇄ SUSPEND / REACTIVATE ⇄ SUSPENDED
PENDING_APPROVAL ──REJECT(CFO 驳回 / 48h 超时 / ⚡喂 RED)──▶ REJECTED ｜ ──CANCEL(金库撤回)──▶ CANCELLED
ACTIVE ──DEACTIVATE(金库退役)──▶ DEACTIVATED（永久）
```

六态：`PENDING_APPROVAL / ACTIVE / SUSPENDED / DEACTIVATED / REJECTED / CANCELLED`；六动作 = 六条边（`PENDING_APPROVAL` 出 APPROVE / REJECT / CANCEL，`ACTIVE` 出 SUSPEND / DEACTIVATE，`SUSPENDED` 出 REACTIVATE），迁移表在 `constants/lp-payout-address-transitions.constant.ts`，穷举 6×6 = 36 个 (态, 动作) 组合恰好 6 个合法（`…transitions.constant.spec.ts`）。三个终态（REJECTED / CANCELLED / DEACTIVATED）零出边；`SUSPENDED` 不能直接退役，须先恢复。启停退与撤回都是金库直接操作、留痕不批；审批驱动的边（APPROVE / 审批侧 REJECT）带 `approvalNo` + `causationId`。**审批载荷是送审那一刻的快照**：送审后合规官 ⚡喂 GREEN / YELLOW 只改地址行上的筛查结论，CFO 审批页看到的载荷仍是旧结论（剧本只喂 RED，不触发这个差异；喂 RED 走 REJECT 边，不再有后续）。
**SLA 答复：地址各态不计时。** 没有冷却期、没有扫描任务、不接 SLA 计时器；`PENDING_APPROVAL` 的超时只靠审批单自身的 48h 兜底（到点审批侧 REJECT → `REJECTED`），其余五态停多久都不会被系统自动动。

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
| 提交 LP 尽调申请 | 金库（LP Register 页 Register LP → 申请页：字段 + 六份文件，Submit application） | — （提交即进待评估） | `LP_WRITE`；建档 `PENDING_ASSESSMENT` 并自动开 DDA；没有 mock 背调、没有 RED 自动拒；协议编号必填，无额度上限 |
| 补材料 / 退回后重提 | 金库（详情页 Edit & resubmit；待评估 / 已退回态还可在详情页补传文件） | — | 重提仅限 `RETURNED`，整张申请表覆盖；实际控制人序号不重排；`LP_PROFILE_RESUBMITTED` |
| 逐名登记筛查、定档、写意见 | 合规官（详情页 Due Diligence 区，`DUE_DILIGENCE_WRITE`） | — | 待评估 / 已退回态可写，送审后锁；人工登记、系统不自动筛 |
| Return for documents / Reject / Send for approval | 合规官（Due Diligence 区 Conclusion 三按钮，只在 Pending assessment 态出现） | 送审 → CFO（Low/Medium 单步；High 加高管第二步） | 退回 / 不通过原因必填；任一红则只剩 Reject（Return 与 Send 按钮都不出现，后端同拒），缺名或未定档则 Send 置灰；审批提单人 = 合规官、理由 = 评估意见 |
| 撤销送审 | 合规官（提单人）或超管，在审批中心撤 | — | 回 Pending assessment 重评，评估壳保留并重新解锁 |
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

场景 26（正向全弧：卖 AED 买 USDT，含悬空期停点 + 验收；开单选 Falcon 唯一的 AED IBAN 地址）、场景 27（反向快演：卖 USDT 买 AED；Falcon 有两条 USDT 地址须点选）、场景 36（LP 打款地址治理：地址登记先筛后批 → ⚡喂 RED → 换地址 → 开单选地址 → ⚡到货红旗、验收仍可点；从一家已 ACTIVE 的 LP 起，用场景 37 刚批好的 Oryx Digital Markets Ltd）与场景 37 / 38（LP 尽调准入：37 顺路——金库申请「Oryx Digital Markets Ltd」传齐六份文件 → 合规官公司 + 实控人全绿、定低风险送审 → CFO 批 → ACTIVE；38 红灯——合规官打开 Sable Crest Trading FZCO，给实控人记一条 OFAC 红 → 「Send for approval」消失 → 只能 Reject → REJECTED）——步骤在 `demo/script.md` 第九幕「公司的钱」。

## 5. 关键技术节点

- 主体 `src/modules/asset-treasury/lp-desk/`：`lp-profile.service.ts`（六态九边迁移表 / 申请与重提 / 零 UUID 投影 / 边→审计码完整性闸）、`lp-payout-address.service.ts`（六态迁移表 / 登记即筛落点计算 / 零 UUID 投影 / 详情读现拼名录资质）、`lp-exchange.service.ts`（八态迁移表 / 余额闸 / 三腿计划）；工作流 `lp-profile-workflow.service.ts`（申请 / 重提 / 传文件 / 合规评估编排——**先让尽调评估记结论、再让档案沿迁移表走一步、需要时开审批单**，workflow 不直写任何表 / 审批裁决回流 `onDecided` / 启停）、`lp-profile-high-risk-approval.service.ts`（高风险档审批 handler）、`lp-payout-address-workflow.service.ts`（登记 / 审批裁决 / 撤回 / 启停退 / 改标签 / ⚡筛查覆写）、`lp-exchange-workflow.service.ts`（发起 / ⚡推腿 / ⚡模拟到货 + 来源筛查 / 验收）。尽调评估（`DDA` / `SCR`）住 `src/modules/governance/compliance-office/due-diligence.service.ts`，文件住 `src/core/documents/`（见 `modules/compliance-office.md` §3.3）；原实体背调 mock `lp-entity-screening.mock.ts` 已删
- 审批类型四条：`LP_PROFILE_APPROVAL`（合规官提 / CFO 单步 / 48h / 可撤，Low/Medium 档）、`LP_PROFILE_HIGH_RISK_APPROVAL`（合规官提 / CFO → 高管两步 / 48h / 可撤，High 档，甲波六新增）、`LP_ADDRESS_APPROVAL` / `LP_EXCHANGE_APPROVAL`（金库提 / CFO 单步 / 48h / 可撤），均已进白名单表；`MAKER_GROUP_BY_POLICY` 前两条挂 `DUE_DILIGENCE_WRITE`（提单人改成合规官，原挂 `LP_WRITE`）、后两条仍挂 `LP_WRITE`；`LP_PROFILE_CHANGE` 已随改结算流程退役。裁决回流事件 `workflow.lp-profile.decided`（两个 handler 共用，workflow 按 `actionType` 分流）
- 转账码新段 84/85/86（`LP_EXCHANGE_PAY` / `LP_EXCHANGE_RECEIVE` / `LP_EXCHANGE_ACCEPT`）；资金单第五父键 `lpExchangeId`
- COA：`FIRM_LIQ`=203 复活（`tb-account-codes.constant.ts`）；对账映射 `wallet-recon-run.service.ts` 从"退役科目期望恒 0"改真 1:1 直比（`wallet-balance-checker.service.ts` 同款）
- 对手方套件复用：`lp-desk.module.ts` 自行 provide `TRAVEL_RULE_ADAPTER` → `MockTravelRuleAdapter`（`attributeAddress` / `screenAddress` / `getVaspProfile`），是该 token 的第四个 provide 点；到货来源筛查走 `screenAddress`（法币来源传银行通道 `BANK_RAIL_NETWORK`）
- 审计：TREASURY 域 LP 现役 **27 码**——档案族 9（`LP_PROFILE_CREATED / RETURNED / RESUBMITTED / SENT_FOR_APPROVAL / APPROVED / REJECTED / APPROVAL_CANCELLED / SUSPENDED / REACTIVATED`；`CREATED` 必填 `reason` + `registeredIn`；`APPROVED` 必填 `approvalNo` 且要因果链；`REJECTED` / `SUSPENDED` / `REACTIVATED` 必填 `reason`；甲波六新增的 `RETURNED / RESUBMITTED / SENT_FOR_APPROVAL / APPROVAL_CANCELLED` 四码必填 `fromStatus` / `toStatus`）、地址族 9（`LP_ADDRESS_REGISTERED / SCREENED / APPROVED / REJECTED / CANCELLED / SUSPENDED / REACTIVATED / DEACTIVATED / LABEL_UPDATED`）、兑换族 9（`LP_EXCHANGE_REQUESTED / CANCELLED / REJECTED / EXECUTION_STARTED / PAY_LEG_POSTED / DELIVERED / DELIVERY_SCREENED / ACCEPTED / FAILED`）；退役 `LP_PROFILE_CHANGE_PROPOSED / APPLIED / REJECTED` 三码与 `LP_PROFILE_SCREENED` 已入 `DEPRECATED_AUDIT_ACTIONS`（退役四件套）。尽调评估与文件的审计（`DD_ASSESSMENT_OPENED / SCREENING_RECORDED / ASSESSMENT_SAVED / INFOSEC_RECORDED / ASSESSMENT_CONCLUDED`、`DOCUMENT_UPLOADED`）在合规办公室名册，见 `modules/compliance-office.md` §4。全库现役 **378 码**（2026-10-29 取自 `audit-actions.constant.ts` 各名册并集；`npm run audit:vocab` 因说明种子未补 21 个新码而 exit 1，属 `TOOLING-DEBT.md` 既有条目，故不写盘；TREASURY 域 48）
- 权限：`treasury.view_lp`（`LP_READ`，金库 / CFO / 内审 / 合规官 / **高管**五职务——合规官是 LP 两步准入 T4 评审加的（⚡筛查覆写的持有者得能打开 LP 页面），高管是甲波六加的（高风险档第二步批准人得读得到详情）；只读，不持 `LP_WRITE`）、`treasury.act_lp`（`LP_WRITE`，金库独持：申请 / 重提 / 传申请文件 / 启停 / 地址登记·撤回·启停退·改标签 / 开单 / ⚡到货 / 验收）、`compliance-office.due_diligence`（`DUE_DILIGENCE_WRITE`，合规官独占，LP 与服务商共用：登记筛查 / 传证据 / 保存评估 / 下结论，评估视图与文件列表则归 `LP_READ`）；⚡`simulate-screening` 端点挂 `DEMO_VERDICT_WRITE`（合规官持，零新权限组）；`GET /admin/documents/:docNo/content` 门为 `LP_READ` 或 `VENDOR_READ` 任一（OR 粗门，登 `PRODUCTION-NOTES.md`）。`verify:rbac` S13 守 LP 两组的四处齐、`LP_WRITE` 金库独持与 `LP_READ` 持有者集合，判据数字以脚本实跑为准
- 端点：`admin/lp-profiles`（list / 提交申请 / detail / suspend / reactivate / `POST :lpNo/resubmit` / `POST|GET :lpNo/documents`〔multipart，字段 `file` + `docType`〕/ `GET :lpNo/assessment` / `POST :lpNo/assessment/screening-records` / `POST …/screening-records/:recordNo/evidence` / `PATCH :lpNo/assessment` / `POST :lpNo/assessment/conclude`，共 13 条）、`admin/lp-profiles/:lpNo/payout-addresses`（POST 登记 / GET 列表）、`admin/lp-payout-addresses/:addressNo`（GET 详情 + `POST cancel / suspend / reactivate / deactivate / simulate-screening` + `PATCH label`）、`admin/lp-exchanges`（list/create/detail/cancel/simulate-delivery/accept；`simulate-delivery` 收可选 `fromSource`）、`GET admin/documents/:docNo/content`（流式下载，见 `modules/compliance-office.md` §3.3）；`settlement-change` 端点已不存在（`lp-profile.controller.spec.ts` 读 Nest 路由元数据断言）
- 表 `liquidity_providers`（甲波六起加 12 个申请列：`registeredIn / registrationNo / licensingAuthority / licenceNo / beneficialOwners`（JSON 数组 `[{seq,name,nationality?}]`）`/ tradingTypes`（CSV）`/ expectedMonthlyVolume / volumeCurrency / applicationReason / agreementStart? / contactName / contactEmail`，退役 `screeningAnswer / screenedAt` 与尽调引用号三列，默认状态改 `PENDING_ASSESSMENT`；此前 2026-10-24 已退役 `fiatBankName / fiatIban / cryptoNetwork / cryptoAddress` 四列）／`lp_payout_addresses`／`lp_exchanges`（加 `payoutAddressNo` / `payoutAddress` / `payoutIban` 与 `deliveryFromAddress` / `deliveryFromIban` / `deliveryScreeningAnswer` / `deliveryScreenedAt`）；尽调评估 / 筛查 / 文件三表（`due_diligence_assessments` / `screening_records` / `stored_documents`）见合规办公室篇；`reset` 登记顺序 `storedDocument` → `screeningRecord` → `dueDiligenceAssessment` → … → `lpPayoutAddress` → `liquidityProvider`；迁移 `20261024072146_lp_two_step_additive` + `20261024100112_retire_lp_profile_coordinates` + `20261029050000_lp_profile_due_diligence`（甲波六：重建 `liquidity_providers`）
- admin-web：`LpProfileList`（状态列 + 状态筛选，合规官拿它当待评估队列；Register LP 按钮跳申请页）、`LpProfileApplyPage`（新申请与被退回后重提共用一页，`/admin/lp-profiles/new` 与 `/:lpNo/resubmit`）、`LpProfileDetail`（Liquidity Provider / Application / Beneficial Owners / Documents / Due Diligence / Approval 六块 + Payout Addresses 区块与 Register address 弹层，**地址簿不另立导航项**）、`LpPayoutAddressDetail`（Attribution / Self-declaration & Red Flag / Screening 区块同款组件，操作段排信息段前）、`LpExchangeList/Detail`（开单弹层 Payout Address 选择；详情 Payout Address 回链 + Delivery Screening 区块 + ⚡到货弹层）；Documents / Due Diligence 两块是 LP 与服务商两条线**共用**的组件（`components/compliance/DocumentsCard.tsx` / `DueDiligencePanel.tsx`，另有 `BeneficialOwnersField` / `StagedDocumentSlots` / `ResubmitGuard`），状态与词表走 `utils/partnerStatusMap.ts`（员工看不到 `PENDING_ASSESSMENT` 之类内部枚举）；**Treasury 导航组**「LP Register」/「LP Exchanges」（战役乙波三导航归并）

## 6. 演示缺口（BACKLOG 有账）

- 验收弹层 Received 现取（腿 2 资金单详情）失败时静默呈 `—`，不拦确认——演示 RBAC 下不触发，登 `PRODUCTION-NOTES.md`
- 账本科目页 USDT-TRON 类资产（code≠currency）小数位显示错位，LP 兑换台相关数字（前厅/运营户 USDT 余额）在这类账本视图里显示成十倍数——既有 admin 前端 bug（非 LP 专属），已挂业主任务 `task_475851be`，登 `BACKLOG.md`
- ⚡喂 RED 后，被晾下的 `LP_ADDRESS_APPROVAL` 滞留 CFO 审批队列直到被裁决或 48h 超时（迟到裁决有守卫吃掉，地址不复活）——演示口径是 CFO 以 Reject 清队；若 CFO 不清而直接点 Approve，会出现「审批单 APPROVED 而地址 REJECTED」——规则草案「地址被筛查拒掉时在途审批单同步作废」，单人正常路径可触发，属业务缺口，登 `BACKLOG.md`（终审 I1 自 `PRODUCTION-NOTES.md` 移出）
- 到货来源筛查红旗后无「拒收 / 退回」正式分支（演示讲到「红旗拦住验收的人」为止）；LP 来源（收款）地址的登记与到货**归因**（「真是 Falcon 打来的吗」，依赖的独立归因接口租户 403 未开通）；LP 腿的 KYT / Travel Rule 报文提交——均登 `BACKLOG.md`
- 地址簿与档案的 DB 级约束 / 格式校验（坐标唯一键、IBAN / 链地址格式与归一化、筛查列正断言门）按根纲禁做，登 `PRODUCTION-NOTES.md`
- LP 簿的条目详情有名录资质三行，客户提现地址详情页没有——两簿口径差异，登 `BACKLOG.md` 待业主斟酌
- 甲波六边界：**LP 不设交易额度上限**（业主否决，`decisions.md` 2026-10-28）；**定期复审**（下次复审日 / 到期提醒 / 重评 / 过期拦截）整体不进本波，另立「合作方复审专项战役」，`BACKLOG.md` 已登；筛查是人工登记、无自动筛查（乙案）；风险档由合规官手选，不由黄 / 红记录自动推出
- 甲波六遗留的技术兜底已登 `PRODUCTION-NOTES.md`（2026-10-29）：文件下载 OR 粗门使仅持 `VENDOR_READ` 的 CISO / 运营凭 docNo 可读 LP 文件；筛查证据上传不核对记录归属（伪造请求可往已锁定的评估挂证据）
