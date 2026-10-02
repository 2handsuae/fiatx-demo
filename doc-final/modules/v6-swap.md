# V6 · 兑换（钱怎么换）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-10-02（战役丙波二：成交前披露 + 成交后确认单上线，见 §1「披露与确认单」/§4 第 9–11 步/§5 确认单条）；此前 2026-09-14（波五：FROZEN 终态→中间态 + 新单创建即冻 + 硬/软线便签退役，见 §2/§3/§6 与 `decisions.md` 2026-09-14 条）
> 演示幕次：第四幕「钱换」 ｜ 验收：第四幕走查（`demo/script.md`）+ 本篇 §4

## 0. 一句话定位

管**平台内的余额交换**（虚拟币 ⇄ 法币）。哲学与充值相反：充值是被动收钱、先收下再处置；兑换是主动交易、**合规点头之前一分钱不动**——建单零记账，拒绝和冻结都不留任何资金痕迹。

## 1. 业务叙事

最重要的一件事：**先问、再动钱。** 客户确认兑换的那一刻，系统只记下"他想换"，不碰任何账；只有合规裁决"通过"落地了，四条腿（卖出、买入、双向费）才一次性实时入账。被拒绝的单、被冻结的单，账本上零痕迹——没发生的交易就该像没发生过。

**报价只活 30 秒。** 实时汇率 + 点差 + 服务费，按客户的费率等级取**最便宜的档**（V3 的费率受众在这里兑现）。报价一经使用即作废——哪怕这笔单随后被合规拒了，报价也不能复用（防止拿旧价反复试探）。

**四道门都在建单前。** 资格门（客户能力没被摁住）→ 限额门（单笔 + 周期累计，AED 口径）→ 余额门（卖出侧够不够——这道是后补的：早先要等合规通过、建腿时才发现钱不够，单子会永久卡死在中途）→ 双边收款账户门（买卖两侧都得有收款账户，缺哪侧提示先去开）。四道全过才建单、才耗报价。

**裁决三分支。** 通过 → 四腿记账 → 成功；拒绝 → 终态（**2026-09-14 裁定收窄**：只有客户本人命中制裁才顺带给**客户**开便签，限制的是人不是单；MLRO 手工冻结与普通拒绝均**不再**开人级便签，见下）；**客户本人命中制裁 / MLRO 手工冻结**（合规官在 Sumsub 台上手工判定，不依赖自动命中，判定为"调查扣审"而非制裁）→ 冻结（**中间态**，押锁不放，两条出边见 §2）——注意判据只认"申请人命中"：兑换是平台内交换，没有真正的对手方，对手方命中不冻单。

**冻结对客户必须零痕迹。** 客户端把冻结显示成"Processing"（2026-09-14 翻案：此前收敛成与 KYT 拒绝逐字相同的"未成功"；FROZEN 改判押锁不放的中间态后，钱还押着、结局未定，"处理中"才是诚实的说法，也与充值/提现"状态跟钱走"的口径对齐）；连筛选器都按"客户看到的值"展开查询——客户拿 `?status=FROZEN` 探测不到自己被冻（tipping-off 三层防线）。

**超时不迁怒客户。** 兑换只有一格 SLA：等裁决 5 分钟。超时单转"未成功"，但**不做客户处置**——超时说明 Sumsub 没回话，不说明客户可疑；把平台的技术问题算到客户头上是被明令禁止的。

**成交前讲明利益，成交后给凭据（2026-10-02 丙波二）。** 平台在兑换里是**本金方**（客户直接和 FIATX 对手交易，不是和另一位客户撮合），且点差与手续费就是平台的收入——所以客户点 Confirm 之前，弹窗明细多一行「Retained by FIATX」（手续费+点差的绝对金额，点差金额由报价响应带出、与建单同一个公共函数算，两处不会不一致）和一块「Before you confirm」三句话：本金声明、定价来源（汇率源与取价时刻、点差百分比取当前报价真值）、利益冲突声明。成交（SUCCESS）之后，系统**出具一张成交确认单并留存**：不是详情页现拼的订单字段，而是成交那一刻定格入库的原件（`trade_confirmations`，一单一张、只写一次、无任何修改入口）；客户在兑换详情页看到的 Trade Confirmation 区块读的就是这份原件，同样带一行「Retained by FIATX」（留存金额在成交前弹窗与成交后确认单各披露一次，落 VARA Market Conduct Rulebook BD II.A.6「成交前与 trade confirmation 中各披露一次」；点差算不算 fees/commission 原文未明说，保守起见手续费+点差都披露），并附本金声明、「Figures were fixed when you confirmed and will not change.」与 Print / Save as PDF 按钮（浏览器打印，打印样式自动翻浅色）。**确认单只给成交单**：冻结单对客户收敛成「处理中」，同样没有确认单、与普通在途单不可区分——有没有确认单反推不出冻结（tipping-off 同一道防线）；拒绝/超时单也没有。确认单不另发通知——波一的「兑换成功」通知深链已直达详情页，一笔一条。

**卡住是旗不是状态。** 记账腿失败自动重试，耗尽后单子留在"处理中"+ 红旗（needsReview）等运营 resume；兑换刻意没有"失败"终态。

## 2. 状态机（5 态 / 7 动作 / 7 边）

```
COMPLIANCE_PENDING（出生态，零记账；SILENT-only 客户新单也从这里出生，见 §1「创建即冻」）
  ├─ 裁决通过 ──→ PROCESSING ──四腿全清──→ SUCCESS
  │                └─ 腿失败 → 自愈重试 → 耗尽 = 红旗留 PROCESSING（人工 resume）
  ├─ 裁决拒绝 / SLA 超时 ──→ REJECTED（终态，零记账）
  └─ 客户本人命中制裁 / MLRO 手工冻结 / 创建即冻 ──→ FROZEN（中间态，押锁不放，2026-09-14 翻案）
       ├─ 解冻审批通过 RESUME ──→ COMPLIANCE_PENDING（清 rejectReason，重新过一轮 KYT 裁决）
       └─ 拒退审批通过 REJECT_REFUND ──→ REJECTED（出生锁放锁回可用余额）
```

- `PROCESSING` **刻意没有冻结入边**：钱已经在动，中途冻结会造半截账。冻人广播碰到在途单只落旗与审计，不打断结算
- **FROZEN 不再是零出边终态**（2026-09-14 裁定翻案，覆盖 2026-08-20「兑换加 FROZEN 零出边终态」）：押锁不放，两条出边——`RESUME` 解冻续审（合规官提、**MLRO 单步批**，48h）回 `COMPLIANCE_PENDING`；`REJECT_REFUND` 拒退（运营提、**MLRO 单步批**，48h）落 `REJECTED`、放锁回余额。翻案依据见 `decisions.md` 2026-09-14 条（新事实=「创建即冻」落地后终态放钱的前提不复存在 + 行业锚：调查扣审天然限时、有两种结局）
- 迟到的裁决（单已进 PROCESSING 才收到）**不驱动状态机**，只留证据与红旗——但拒绝类照样跑客户处置
- `FAILED` / `REVERSED` 两个不可达死枚举值已随波四共享抽离清除（2026-09-13，实扫零写入点、零入边）：后端 4 处读面（本域终态集与迁移表空行、swap-workflow 终态集、`transaction-limit-gate` 排除集）+ admin-web 2 处（`swapStatusMap.ts` 映射条目 + Exception 筛选组两项）+ client-web 1 处（`Swap.tsx` 终态集）一并摘除；管理台兑换筛选 Exception 组自此少两个永远筛不到的选项

## 3. 决策点与角色

| 动作 | 谁发起 | 谁裁决 | 要点 |
|---|---|---|---|
| KYT 裁决 | Sumsub（演示=⚡按钮） | 合规规则 / 合规官 | 唯一的门；兑换没有人工复核态、没有审批门——三域里最自动化的一条 |
| 拒绝后的客户处置 | 系统自动 | 按处置标签开客户便签 | **2026-09-14 裁定收窄**：只有客户本人命中制裁（⑦）才开便签（`SANCTION`）；⑨ MLRO freeze 改判"调查扣审"——落 FROZEN 但不再开人级便签（三域冻单不冻人）；⑪ no tag 普通拒绝只动单（不开便签），硬/软线便签退役，详见 `decisions.md` 2026-09-14 条 4 |
| FROZEN 解冻（RESUME） | 合规官（`SWAP_UNFREEZE_WRITE`） | **MLRO 单步批（48h）** | 批准后回 `COMPLIANCE_PENDING`、清 `rejectReason`、重新过一轮 KYT 裁决（同构提现 `resume` 后 rescore） |
| FROZEN 拒退（REJECT_REFUND） | 运营（`SWAP_REFUND_WRITE`） | **MLRO 单步批（48h）** | 批准后落 `REJECTED`，出生锁放锁回可用余额 |
| SLA 超时 | 系统扫描 | 无人裁决 | 只关单，不动客户；FROZEN 不计时（对齐充提两域 FROZEN 现状口径） |
| 卡单恢复 resume | 运营 | 直接执行 | 对红旗单重推腿；2026-09-12 起冻人期间调用直接 400（`SWAP_CUSTOMER_RESTRICTED`）——原地冻定案，命令行路与界面同一道闸（与「FROZEN 解冻 RESUME」是两件事：一个是单据卡在结算中途的腿推进，一个是被冻单据走出 FROZEN） |
| 模拟超时 | 管理员按钮 | — | 演示加速用 |

## 4. 演示脚本（第四幕 · 钱换）

1. Alice 客户端拿报价 → 看 30 秒倒计时、点差与费（若第一幕改过费率，这里当场兑现）→ 确认
2. 管理台看单：`COMPLIANCE_PENDING`，**账本上卖出侧已画圈锁定全额**（出生锁：下单即锁，与提现同律；可用余额当场减少——再想拿同一笔钱发提现会被挡）
3. ⚡喂"通过" → 看四条腿依次清算 → SUCCESS → 账本页看四腿分录、客户两侧余额变
4. 再来一笔，⚡喂"拒绝" → REJECTED，**出生圈擦除、金额退回可用余额**（账本留圈+擦圈两笔痕，净额归零）；客户端显示"未成功"
5. 再来一笔，⚡喂"制裁命中（申请人）" → 管理台红色 FROZEN + 客户被冻（V2 便签）；**出生圈押着不擦**（2026-09-14 翻案：FROZEN 从零出边终态改成押锁不放的中间态——钱还押着、结局未定，"没收/退回哪种都不做"的原判不再适用）；**切客户端：显示与第 2/3 步一致的 PROCESSING**——不再是"未成功"，钱押着就显示处理中，与充值/提现"状态跟钱走"的口径对齐；第二幕 tipping-off 的交易域版本
6. FROZEN 两出口各演一笔：**解冻**（合规官发起 → 换 MLRO 账号批准 → 单回炉 `COMPLIANCE_PENDING`，重新过一轮 KYT 裁决）；**拒退**（运营发起 → 换 MLRO 账号批准 → 出生圈擦除、金额退回可用余额、单落 `REJECTED`）——两条弧的开案人碰不到钱，与充值/提现冻结处置同律
7. 缺收款账户预检：用没有买入侧账户的客户试兑换 → 提交被禁 + 引导去开户
8. 制裁客户（SILENT 便签）试兑换：报价与建单均放行 → 建单入库后立即转 FROZEN（不再是中性 403 拦截）；客户端全程只见 PROCESSING，横幅不亮——「新单创建即冻」，见 `decisions.md` 2026-09-14 条 1
9. **成交前披露**（丙波二）：第 1 步拿报价后、点 Confirm 之前，指读弹窗——明细里的「Retained by FIATX」行（`Fee … · Spread …`，手续费+点差各一笔绝对数）与按钮上方的「Before you confirm」三句话（本金声明 / 定价来源与取价时刻 / 利益冲突），占位值全部是这张报价的真值
10. **成交确认单**（丙波二）：第 3 步成交后，客户端进该单详情页 → Trade Confirmation 区块（Confirmation No `CNF…` + 成交事实 + 三个时刻 + 本金声明 + 「数字已定格」句）→ 点 Print / Save as PDF，预览是浅色单页只含确认单；管理台审计中心按该兑换单号检索可见一条 `CONFIRMATION_ISSUED`（系统动作，metadata 带 confirmationNo）
11. **反面：冻结单没有确认单**（丙波二）：第 5 步被冻结的单，客户端详情页与「审核中」的普通单同样只显示处理中的样子，**没有** Trade Confirmation 区块——不可区分是设计，不是漏了

## 5. 关键技术节点（≤30 行）

- 工作流 `trading/swap-transactions/swap-workflow.service.ts`：`initiateSwap()`（四道门 → `assertTradingIntake` 判 SILENT-only 放行/DISCLOSED 中性拒绝 → 耗报价 → 建单**同事务画出生圈**（腿1/attempt1 预占卖出全额）→ SILENT-only 客户建单后立即转 FROZEN（创建即冻，跳过提交 Sumsub）→ 否则同步铸 Sumsub 出账交易号；旅程号 correlationId 在此铸造全链继承）｜`swapAudit()`（域信封助手：PRIMARY=兑换单号/OWNER=客户号/RELATED=资金单号，26 码（=V6_SWAP_AUDIT_ACTIONS 名册键数，波五 Task 3 新增 4 码 22→26：`SWAP_UNFREEZE_REQUESTED`/`SWAP_UNFROZEN`/`SWAP_REFUND_REQUESTED`/`SWAP_REFUNDED`）见 audit-actions.constant.ts V6 段）｜`releaseBirthLock()`（擦圈三出口：KYT 拒绝/SLA 破线拒单/拒退 REJECT_REFUND 落地——2026-09-14 起制裁冻单与批量冻单广播**不再**调用它，押锁不放，出边改走 RESUME/REJECT_REFUND）｜ `applyKytVerdict()`（三分支落地；顶部终态守卫，兑换**没有** decideVerdictLanding，勿照抄充值写法）｜ `handleRejectDisposition()`（2026-09-14 改判：只有客户本人命中制裁 ⑦ 才开 `SANCTION` 便签，⑨ MLRO freeze/⑪ no tag 均不再开人级便签，硬/软线 `open()` 退役见 `decisions.md` 2026-09-14 条 4）｜ `initiateUnfreeze()`/`initiateRefund()`（Task 3，双弧开案）+ `onUnfreezeApproved()`/`onRefundApproved()`（执行：前者清 `rejectReason`+触发 KYT rescore，后者放锁回余额）
- 状态机 `swap-transactions.service.ts → transitions`（7 边穷举，FROZEN 两条出边 `RESUME`/`REJECT_REFUND`）；四个 FROZEN 判据常量**答案刻意不同**（2026-09-14 起 FROZEN 从零出边终态改押锁不放的中间态，四处各自随之调整，"同一问题四处四答"结构不变）：迁移表里 FROZEN **不再零出边**（新增两条出边）；材料请求终态集合仍**不含** FROZEN（防撕材料卡片=tipping-off，未变）；冻结扫描排除集仍**含** FROZEN（理由从"零出边终态"改成"已冻无需再捞"，答案不变理由变了）；客户面白名单仍**不含** FROZEN，但收敛目标从 REJECTED 改成 **COMPLIANCE_PENDING**（钱押着显示处理中，不再是"未成功"）——是本域最易做错处
- 客户面防线 `toCustomerSwapStatus()` 白名单收敛 + 筛选按收敛值反向展开（派生自收敛函数，无平行表）
- **客户端详情页**（`SwapDetail.tsx`，2026-09-15 详情增强）：Amounts 区块按 `status===SUCCESS` 切换标签措辞——成交单用断言句 You sold/Gross receive/Net received，未成交（处理中/冻结/拒绝）单一律降级中性词 Sell amount/Quoted gross/Quoted amount（钱没到账不能断言"已收到"）+ Exchange rate/Market·Spread/Submitted/Completed；Pricing 区块 Quote No(SQT) + `feeLines` 费用明细行（服务端 `toCustomerPricingFacts()` 已拆净 fx 技术字段，见文件头白名单注释）；Timeline 走三域共用机制——`buildCustomerTimeline()` 服务端收敛去重 + 客户端展示层 `timelineDisplay.ts` 同词连续去重。**FROZEN 先经上面 §1 的白名单收敛成与 PROCESSING 逐字相同的值，两层去重叠加下，冻结单与普通在途单在客户面时间线上完全不可区分**——这是本域 tipping-off 三层防线（渲染层/字段层/时间线）里对时间线的延伸，充值/提现详情页复用同一套时间线机制（见 `modules/v4-deposit.md`/`v5-withdraw.md` 各 §5）
- **成交确认单与披露（丙波二，2026-10-02）**：主体表 `trade_confirmations`（迁移 `20261002122630_wave2_trade_confirmations`；id + 21 业务列，含 `toAssetCode`——确认单自包含原件，不回读兑换单拼卖/买两侧币种；`confirmationNo`（`CNF`+12 位数字，无连字符，系统单号惯例）与 `swapNo` 各自唯一，一单恰一张是 schema 结构保证、非去重逻辑；无 FK，swapNo 是业务键；`reset-business-data.ts` 已登记）。**只写一次**：`TradeConfirmationsService` 只有 `issueForSwapIfSuccess()` 一个写方法、零 update 入口。**出具链**：挂 `SwapWorkflowService.notifySwapStatusChange` 事务后置漏斗（9 个事务后置调用点的唯一汇合处，调用点零改动）——to-status 落 `SUCCESS` 时 **先落确认单 → 再记审计 `CONFIRMATION_ISSUED` → 再发「兑换成功」通知**（丙波一三原则①持久物先于信号的延伸：客户点开通知时确认单已在）；出具在 `$transaction` 之外、整体吞错（demo 尽力而为，不阻断已提交的成交，生产债见 `PRODUCTION-NOTES.md`）。**审计码**：`CONFIRMATION_ISSUED`（域 SWAP，actor=system，`correlationMode=N`，必填 `confirmationNo`，`requestId`=确认单行 id）入册 `CAMPAIGN_C_NOTIFICATION_AUDIT_ACTIONS`（与 `NOTIFICATION_SENT` 同册，三处登记点零新增），现役码 327→**328**；管理台零新页，审计中心按兑换单号或 CNF 号关键字可检索（Entity/Related No 筛选不中 CNF 号，别用）。**客户面**：`findOneForCustomer` 响应附 `confirmation` 子对象——`toCustomerConfirmation()` 逐键显式映射 **19 键白名单**（去掉内部列 `swapNo`/`ownerCustomerNo`/`id`，全是定价事实与时刻，零合规信息），判据用 `toCustomerSwapView` 收敛后的 status === SUCCESS（FROZEN 收敛成 COMPLIANCE_PENDING，恒为 null），列表响应不带。**报价响应** `spreadAmount` 由 `trading/shared/spread-amount.util.ts → computeSpreadAmount()`（四参）算，报价响应与 `initiateSwap` 建单两处同源。**客户端**：披露文案集中登记 `client-web/src/utils/disclosureCopy.ts`（九键 + `fillRateDisclosure()`，页面禁散写 JSX 句子）；`Swap.tsx` 确认弹窗加留存行与三句话；`SwapDetail.tsx` SUCCESS 单 Trade Confirmation 区块读 `confirmation` 原件（显示条件抽纯函数 `confirmationDisplay.ts`），打印样式 `index.css` `@media print` 用 `position: fixed` + 页底翻白（`color-scheme: light`）——`absolute` 在 `relative`+`overflow` 壳层里打印会偏移，真实打印渲染逮到、纯 CSS 也必须真打印预览验证；`Withdraw.tsx` 确认弹窗按资产类型二择一显示链上不可逆/银行不可召回提示，`Deposit.tsx` 仅 crypto 语境显示波动提示（法币充值页刻意不放）。文档订正：spec §2.1 字段表原漏列 `toAssetCode`，见 spec 头部「执行订正」
- FROZEN 解冻 / 拒退审批（Task 3，2026-09-14）：`SWAP_UNFREEZE`（合规官提，权限 `SWAP_UNFREEZE_WRITE`）/`SWAP_SANCTION_REFUND`（运营提，权限 `SWAP_REFUND_WRITE`）两条策略，`approval.constants.ts` 均 `steps:[{roles:['MLRO']}]`、`timeoutHours:48`、`allowCancel:true`，镜像提现同名先例；`scripts/verify-rbac.ts` 的 `MAKER_GROUP_BY_POLICY` 已补两行；`rbac.catalog.ts`：`PermissionGroup` 联合类型新增两个键、两条 `route()`（`POST /admin/swap-transactions/:id/unfreeze`/`:id/refund`）、`ACTION_BUCKET_CATALOG` Trading 域新增两桶（`Request swap unfreeze`/`Request swap sanction refund`）、`COMPLIANCE_OFFICER`/`OPS_OFFICER` 两职务各持一组
- ⚡ 模拟裁决按钮：三域共享表 `sumsub-shared/verdict-buttons.shared.ts`（11 键）的 8 键子集（`swap-sumsub/fixtures/verdict-buttons.ts`）；缺的三键各有真实理由——④/⑧ PEP·Sanctions 对手方（兑换是账内换币，没有对手方）、⑩ 处置标签（驱动的是 KYT 拒绝落地时**自动**附带的处置标签，如充值 `RETURN_TO_SENDER`／提现 `FINAL_REJECTED`；兑换的解冻/拒退是冻结**之后**单独发起的 maker-checker 审批，不是拒绝裁决自带的标签，两者不是一回事，⑩ 依旧不适用（该 fixture 头注理由已随 2026-09-14 翻案同步订正））。**材料审核（认证复核 GREEN/RED）不在这张表里**：那是另一个 webhook（`applicantActionReviewed`），入口在客户详情页 Verification Requests 区块，收 `requestNo` 不收订单 id，三域共用同一入口，不属交易面板——2026-08-29 前兑换域曾在这张表里另开⑦⑧两键直接投材料复核（缺"先交材料"前置，真按会 500），本轮已删
- 记账 `swap-leg-accounting.ts`（四腿实时逐腿 post）；腿=挂 swapTransactionId 的资金单（见 funds-orders 篇）；腿 1 特殊：圈在下单时已画（createLeg 对 legSeq=1&attempt=1 跳过画圈只落笔），重试 attempt≥2 恢复按次画圈
- 报价 `swap-fee-level/swap-quote.service.ts`（TTL 30s 懒过期）+ `pricing-center/pricing-engine.service.ts` + Binance 价源（3s 缓存，AED 钉 3.6725）+ `swap-quote.service.ts → resolveBestLevel()`（内部调 `fee-audience.util.ts → matchesAudience()`）
- SLA `swap-sumsub/swap-sla.service.ts → sweep()`（30s cron；超时推 REJECTED、不做客户处置；txnId 为空的单是漏提交，重提不判死——2026-09-12 起重提成功即调 `extendComplianceSla()` 把 `slaDeadline` 拉满一个完整窗口，此前不推死线，下一轮 sweep 30 秒内就会误判超时）
- 冻人标识（2026-09-12 波三红项修复，E1 原地冻定案）：`SwapTransactionsService` 按 `customerAccessService.resolve().blocked.has('SWAP')` 派生 `ownerRestricted`（只在 admin 侧计算，列表批量查、详情单笔查；customerScope 一律不带，tipping-off）；管理台列表 / 详情页据此渲染独立的 `CUSTOMER_FROZEN` 徽章，与 `needsReview`（技术卡单）分开——不落库，随解冻自动消失
- 时间线 operator 语义化（2026-09-12，六个 `markStatus()` 写点）：`SUMSUB_KYT`（KYT 通过 / 拒绝 / 制裁裁决冻结三处）、`LEG_SETTLEMENT`（四腿清算成功）、`RESTRICTION_BROADCAST`（客户级限制广播冻单）、`SLA_SWEEP`（超时拒单）——此前全部硬编码 `'SYSTEM'` 字面量，时间线看不出是哪条机制在动单
- L1 `L1GateService`（十项，含资产可用性；BLOCK 留 `*_L1_BLOCKED` 痕）／限额 `TransactionLimitGateService.evaluate()`（建单前；AED 估值快照落单供累计取数）
- **共享层现状（波四共享抽离，2026-09-13，行为零变化）**：`sumsub-shared/` 的三个公共基类（`SlaSweepBase`/`KytVerdictHandlerBase`/`DemoScenarioControllerBase`）+ demo-scenario 一份共享函数/常量（`VERDICT_OF`/`mintDemoTxnId`/`DemoScenarioActor`，充提两域仅 import 不继承）只服务充值↔提现镜像对，**兑换零接入、五件套全部独立演进**（SLA `swap-sla.service.ts`、webhook router、KYT 裁决落地、demo 场景仿真、admin demo 控制器均不继承任何基类）；`swap-webhook.router.ts` 头注已改口径为"充提共底座、兑换独立演进"。但 `trading/shared/` 的三个纯函数工具本域**照常复用**：资产投影 `toCustomerAssetView()`（from/to 两资产各调一次）、SLA 字段计算 `resolveSlaFields()`（域内私有同名方法薄壳委托共享泛型）、客户级限制冻结扫描信封 `freezeScanQueryArgs()`（本域走 `ownerNoSource: 'column'` + `extraSelect: { fromAmount: true }`——出生锁退还金额需要这一列，是甲案信封里唯一的域专属额外列）。**fee-level 双树合一本域全程参与**：`swap-fee-level.service.ts`/`*-change-workflow.service.ts`/`*-retire-workflow.service.ts`/`*-creation-workflow.service.ts` 分别继承 `trading/shared/fee-level.base.ts`（`FeeLevelServiceBase`）与 `fee-level-workflow.base.ts`（`FeeLevelCreationWorkflowBase<TDto>`/`FeeLevelChangeWorkflowBase`/`FeeLevelRetireWorkflowBase`）——14 族逐字同方法（=18 个具体方法）收进基类，8 个真分叉（资产对双列 `fromAssetId`+`toAssetId` 贯穿查询/建档校验、`findActiveByPair` 命名与入参、`validateTiersJson` 校验规则本身不同）留域内子类；与 `withdrawal-fee-level`（见 `modules/v5-withdraw.md` §5）对称的 3 个审批薄壳文件因 `actionType`/`workflowType` 不同**不合并**、原样两份

## 6. 演示缺口（BACKLOG 有账）

- **KYT 规则自动裁决未真机验证**（命门）：无人工介入时 Sumsub 会不会自动发裁决 webhook 未实测——不发则真集成下每笔兑换都会超时死
- **报价过期无定时清扫**（只懒过期）：列表里可能躺着过期报价，讲解时说明
- 命名债：代码里 swap 腿仍用旧名 InternalFund*（不影响演示，Phase 4 清）
