# V5 · 提现（钱怎么出去）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-10-22（对手方波二：建单从地址簿带出受益人与对手方 VASP、提交 Sumsub 时落 Travel Rule 报文快照三档、客户面 +2 键且 Address label 改业务键回链、⚡V12 对手方 VASP 不合格落复核台；审计 33→34 码，见 §1/§3/§5）；此前 2026-09-14（波五：SILENT 客户新单创建即冻，报价/建单闸从中性拒绝改放行，见 §1/§5）
> 演示幕次：第五幕「钱出」 ｜ 验收：第五幕走查（`demo/script.md`）+ 本篇 §4

## 0. 一句话定位

管**钱怎么出去**。资金流出是全系统风险最高的动作，所以提现是**门最多的一域**（资格、地址、限额、大额审批、合规筛查五道全有），也是 L1 十项资格快照**全部适用**的唯一一域。虚拟币和法币共用同一条工作流。

## 1. 业务叙事

最重要的一件事：**钱一旦出门就追不回来，所以所有的门都开在出门之前；而客户的钱在等待期间始终锁着、不少一分。** 提现建单的瞬间，客户余额里对应的金额（本金+费）就被锁定；此后无论走到哪条结局，钱的去向都有确定答案——成功 = 锁定金额划走；拒绝 / 退款 = **全额解锁退回**；技术失败 = 全额解锁退回。"拒绝即解锁"是不变量：正因如此，管理台连"直接拒绝"的侧门都被物理删除了——绕过解锁的拒绝会把客户的钱永久锁死。

**建单前先拿报价。** 报价号（`WQT…`）锁的是**费用快照**，不是汇率——300 秒有效期（波二 2026-09-09 由 30 秒调宽，理由：费率会被管理台随时改，报价没有时限会砸配置演示口径；30 秒又太短，容易在客户端确认框里犹豫一下就撞过期）。报价一次性：提交提现即消费作废；客户在确认框里直接关闭（含点外部区域），报价同样立即取消——与兑换报价同律。过期报价不设定时清扫，靠下次请求时懒判定。三个动作（创建 / 消费 / 取消）逐一留痕，第七幕按 `WQT…` 号能查到全链。

**出生就分流。** 普通单出生落合规筛查；**大额单出生直接落审批门**——高管点头之前，连筛查都不进。

**裁决四分支**（与充值同构）：通过 → 两腿并行结算（本金腿 + 费腿）；要求补料 → 等客户（独立补料页）；拒绝无标签 → 人工复核（翻案、转补料、退款拒绝都在这站可走；复核台的处置在 Sumsub 控制台做，演示里由 ⚡ 替它按——退款拒绝＝复核态经 ⚡⑩ 直接执行退款〔无审批〕，管理台 UI 无手动按钮）；制裁命中 → **先冻人再冻单**。

**钱付给谁，建单那一刻就抄进单据（2026-10-22 对手方波二）。** 提现的收款地址来自地址簿（`modules/v3-financial-config.md`），地址簿每条带着“受益人（本人 / 第三方）+ 托管（自托管 / 对手方 VASP）+ 筛查结论”；建单时把地址簿号 `withdrawalAddressNo`、受益人姓名 / 类型、对手方 VASP 名称与 DID 一并抄到单上（法币单只抄前三项，VASP 两项恒空）——单据即快照，之后不回头读地址簿。提交 Sumsub 时（travelRule 型，也就是 crypto 单）再**一次性**落一份 Travel Rule 报文快照，分三档如实：**低于阈值**（USDT 1000 / AED 3500，`>=`，恰好 1000 USDT 过线）→ `NOT_APPLICABLE`（照常报送，没有 TR 报文可交换）；**过线且对手方是 VASP** → `EXCHANGED`（受益人随报文交换给对方）；**过线但自托管** → `SELF_HOSTED_NO_EXCHANGE`（无对手方可交换，所有权已在地址登记时验过签名）。三档由“金额过不过线 × 地址有没有对手方 VASP”两个条件决定；阈值判定归 Sumsub 一侧的 TR 规则（mock：`MockTrRulesService`）。**VASP 资质不在提现建单时拦截**——资质判据住 Sumsub 名录，不合格的由 Sumsub 一侧 ⚡V12 裁决把单送进人工复核台（`manualReason=vasp_unqualified`，**不直通退款**），出口 = 在复核态再喂 ⚡⑩（Final rejected，演示里替 Sumsub 控制台上的处置动作；管理台复核态没有手动退款按钮）→ 系统直接 `REJECT_REFUND` + 全额解锁退回，**无审批**（复核态本就是退款拒绝可直接执行的唯一态）→ `REJECTED`。

**冻结只有两条出口，都要 MLRO 审批**：**解冻**——必须附解冻令文书号，批准后零记账回炉重新筛查（钱从未离开锁，无账可退；从未送检的冻结单（如创建即冻）解冻后 rescore 会跳过、无自动重提——兑换域 SLA 扫描有 missing-txnId 重提而提现域没有，这类单 5 分钟 SLA 到点落 MANUAL_CHECKING 由人工续走，⚡ 面板可现铸 txnId 喂裁决，非死路）；**退款**——拒绝处置，批准后全额解锁退回客户。两条弧发起侧只开案不动单，执行侧等审批落地才动——开案的人碰不到钱。

**制裁客户新单创建即冻（2026-09-14 波五）**：SILENT 便签客户报价与建单不再被拦截——`assertTradingIntake` 放行，建单照常压 TB pending 锁；入库后立即走既有 FREEZE 边转 FROZEN（提现冻结不放锁，钱始终押着）。原 `WITHDRAW_L1_BLOCKED` 审计对该客户不再发生，改为建单 + `WITHDRAW_FROZEN` 两条审计成对留痕。DISCLOSED 客户（已被横幅告知）维持中性 403 拒绝不变——持续报错本身就是信号，不算通风报信；收单后折叠成 PROCESSING 才是防线所在，见 `decisions.md` 2026-09-14 条 1。

**出了门之后。** 本金腿失败 → 终态失败 + 全额解锁（客户看得见钱回来了）；银行 / 链上**退汇（bounce）** → 反向分录入账、单落"已退回"终态（只有本金确实出过账才能走这条）；**费腿失败不拖累本金**——本金照常到账，费腿自己重试三级梯，耗尽后标红旗等运营，不动客户的钱。

**客户永远看不到调查。** 冻结、人工复核、待审批在客户端全部收敛成同一个"处理中"，无任何备注；调查性字段（裁决报文、人工原因、SLA、状态历史）被白名单整体裁掉——渲染层与字段层双防，有违禁词单测守着。`status`/`completedAt` 两个字段本身也已收敛（2026-09-12 波三红项修复，此前原样透传，DevTools 能读到裸 `FROZEN`）：客户面 `status` 先经白名单收敛（不在白名单内一律映射成 `COMPLIANCE_PENDING`），`completedAt` 只在收敛后落在终态集合才原样输出；客户身份下 `?status=` 查询参数被忽略（改走 `bucket` 补集），客户端筛选器同步改成 bucket 间接式——DOM 里不再出现任何原始状态码，与充值域已有防线对齐。

**SLA 四格，两硬两软。** 等 Sumsub 裁决 5 分钟、等客户补料 7 天——到点硬转人工复核；人工复核 3 天、大额待审批 1 天——**到点只标红不推状态**："等自己人"的单不该被系统自动毙掉，红标是给运营看的催办信号。

## 2. 状态机（10 状态 / 13 动作 / 23 边，3 个零出边终态）

```
（大额）→ PENDING_APPROVAL ──批准──→ COMPLIANCE_PENDING（普通单出生态）
                └─拒绝→ REJECTED            ├─ 通过 → PAYOUT_PENDING ──两腿清算──→ SUCCESS ──退回(B 批)──→ RETURNED
                                            │            ├─ 本金失败 → FAILED（全额解锁）
                                            │            └─ 退汇 bounce → RETURNED（反向分录，出款广播中途被打回）
                                            ├─ 补料 ⇄ ACTION_PENDING（材料审过 GREEN 自动回炉，2026-08-29 补边）
                                            ├─ 拒绝无标签 / SLA 超时 → MANUAL_CHECKING（翻案/转补料/退款/冻结四出口）
                                            └─ 制裁 / MLRO → FROZEN ──解冻→ 回炉 ｜ ──退款→ REJECTED
```

- `PAYOUT_PENDING` **刻意没有冻结入边**：指令已广播，冻不回来——迟到裁决只留证据与红旗
- 大额单的出生落点是一条**钦定的"出生路由"写**，不在迁移表内——铁律"状态只能沿边走"的已知豁免之一，Phase 4 补边转正或点名豁免
- 迁移表逐边穷举 + 守则单测锁边数（23，2026-09-03 平账 B 批补 `SUCCESS --RETURN--> RETURNED` 一条前是 22——出款成功后被银行退回的认领，对账案子上发起、CFO 批），漂移当场被抓
- **`SUCCESS` 不再是严格零出边终态**：`transitions[SUCCESS]` 现有唯一一条 `RETURN → RETURNED` 出边；终态集合 `{SUCCESS, REJECTED, FAILED, RETURNED}` 成员未变，只是 `REJECTED`/`FAILED`/`RETURNED` 三个才是真正零出边终态

## 3. 决策点与角色

| 动作 | 谁发起 | 谁裁决 | 要点 |
|---|---|---|---|
| 大额放行 | 系统（超阈值自动开案） | **高管审批** | 批准前不进筛查；期间客户被冻单也冻得住 |
| KYT 裁决 | Sumsub（演示=⚡按钮） | 合规 | 四分支驱动全部后续 |
| **⚡V12 对手方 VASP 不合格**（2026-10-22 对手方波二） | 合规官 ⚡（替 Sumsub 一侧下裁决） | 落复核台后：在复核态再喂 ⚡⑩（Final rejected）→ 系统直接执行退款（`REJECT_REFUND`，无审批） | 沿 `decideVerdictLanding` 三档：`FROZEN` 一律 IGNORE、`PAYOUT_PENDING` 只留证据、终态不动、可派发态经既有 `KYT_REJECTED` 边进 `MANUAL_CHECKING` 并记 `manualReason=vasp_unqualified`；已在复核态再打 V12 是 no-op，**不直通退款 / 放锁**；零新边零新审批 |
| 人工复核处置 | 运营（演示由 ⚡ 替复核台按） | 翻案 / 转补料直接执行；退款拒绝**仅此态可直接执行**——复核态经 ⚡⑩ 直接执行退款（无审批），UI 无手动按钮 | 翻案批准才记账 |
| 解冻 | 运营开案 | **MLRO（48h）** | 必附解冻令文书号；零记账回炉 |
| 退款 | 运营开案 | **MLRO（48h）** | 全额解锁退回；"拒绝即解锁"不变量 |
| 退汇登记 bounce | 管理员专用端点 | 直接执行（先账后状态） | 仅本金已出账可用；这是出款广播中途被打回，与下一行"已成功后才被退回"是两回事 |
| **出金退回认领**（2026-09-03 平账 B 批） | 金库专员（对账案子上「认领退回」，选候选原提现单，2026-09-08 平账处置改版起改金库——此前误记运营，本次一并补记）| **CFO 单步审批（48h，可撤）** | `SUCCESS → RETURNED`；复用 `onBounce()` 重记分录（本金加回、手续费不退，跳过费腿分支）；不建资金单；入口在案子上，见 `modules/v8-recon.md` §3 |

## 4. 演示脚本（第五幕 · 钱出）

1. Alice 提现到已生效地址 → ⚡通过 → 看两腿并行清算 → 到账；账本页看本金与费各自的分录
2. 建单瞬间切客户端看**可用余额立减**（锁定），成功后锁定转划走——"钱始终有着落"用余额讲
3. 演补料：⚡要求补料 → 客户端补料入口 → 交齐回炉
4. 演冻结（高光）：⚡制裁命中 → 管理台 FROZEN + 客户被冻；**切客户端：只见"处理中"**——把 DevTools 关掉讲这页（见 §6 第一条）
5. 冻结两出口各演一笔：解冻（填文书号 → MLRO 批 → 回炉重查）；退款（MLRO 批 → 看客户余额**全额回来**）
6. 制裁客户（SILENT 便签）试提现：报价与建单均放行 → 建单入库后立即转 FROZEN（不再是中性 403 拦截）；客户端全程只见 PROCESSING，横幅不亮——「新单创建即冻」，见 `decisions.md` 2026-09-14 条 1
7. 大额：发一笔超阈值提现 → 出生即落审批 → 高管批准才进筛查
8. 退汇：⚡触发 bounce → 单落 RETURNED → 账本看反向分录（这是出款广播中途被打回；**SUCCESS 之后才发生的退回见第六幕场景 15**——对账案子上「认领退回」，同样落 RETURNED）
9. 全程任一步，审计页按单号查——留痕词表 34 码（=V5_WITHDRAW_AUDIT_ACTIONS 名册键数，波二 30→33 新增报价三码；对手方波二 33→34 新增 `WITHDRAW_TRAVEL_RULE_SNAPSHOTTED`）（站2-β）：建单铸「旅程号」全链继承，按单号/按客户/按旅程三查成立；失败进 outcome+原因码，状态变化写从/到两列（垫第七幕）
10. Travel Rule 三档对照（2026-10-22 对手方波二）：翻三张种子展品的管理台详情，主栏 Counterparty / Travel Rule 区块——#15（150 USDT → 自己的自托管地址）`NOT_APPLICABLE`、#34（grace 1200 USDT → 她的 VASP 地址）`EXCHANGED`、#35（alice 1500 USDT → 她的已签名自托管地址）`SELF_HOSTED_NO_EXCHANGE`；受益人姓名 / 类型与对手方 VASP 随报文；客户端同一张单有值才渲染：种子展品（自己的地址、无姓名、无 label）实际只读到 Beneficiary type: Myself 一行，Beneficiary 姓名只有第三方地址才有、Address label 只有登记时填过 label 才有；读不到报文状态与 VASP 名称（逐拍口径见 `demo/script.md` 站 5.1 加一拍）

## 5. 关键技术节点（≤30 行）

- 工作流 `trading/withdraw-transactions/withdraw-workflow.service.ts`：`createWithdrawal()`（2026-09-14 波五：`assertCapability` 改 `assertTradingIntake` 取 `fold` 标志；L1 BLOCK 分支加 `isFoldOnlyRestriction` 判据——`fold && failed.length===1 && failed[0].code==='CUSTOMER_RESTRICTION'` 才放行继续建单，别的 FAIL 仍真 BLOCK；建单事务提交后、`emit(WITHDRAWAL_CREATED)` 之前，`fold` 为真时调 `updateStatus(FREEZE)` + `withdrawAudit({action:'WITHDRAW_FROZEN', ...})`）｜ `initiatePayoutPhase()`（两腿创建：本金 legSeq=1 / 费 legSeq=2）｜ `decideVerdictLanding()` 三档（IGNORE / EVIDENCE_ONLY / DISPATCH——FROZEN 一律 IGNORE 保护制裁证据；PAYOUT_PENDING 只留证据）｜ `initiateUnfreeze()/initiateRefund()`（双弧开案）+ `on*Approved()`（执行）｜ `onBounce()`（退汇，先账后状态）｜ `assertCustomerComplianceOrFreeze()`（客户级合规闸，三处接入）｜ `withdrawAudit()`（站2-β 统一留痕信封：34 码名册见 audit-actions.constant V5 表，波二新增报价三码、对手方波二新增 `WITHDRAW_TRAVEL_RULE_SNAPSHOTTED`；波五无新增码——创建即冻复用既有 `WITHDRAW_FROZEN`）；`applyKytRejected()` 的 `VASP_UNQUALIFIED` 分支（冻结分支之后、`FINAL_REJECTED` 之前）：`KYT_REJECTED` → `MANUAL_CHECKING` + `manualReason='vasp_unqualified'` + `WITHDRAW_MANUAL_CHECKING`，已在复核态 no-op（不直通 `REJECT_REFUND` / `releaseLock`）
- 报价 `withdrawal-fee-level/withdraw-quote.service.ts`（`generateReferenceNo('WQT')`；TTL 300s 懒过期）：`createQuote()/consumeQuote()/cancelQuote()` 三动作对应 `WITHDRAW_QUOTE_{CREATED,USED,CANCELLED}` 三码（波二 2026-09-09，对齐 `swap-quote.service.ts` 写法，均带显式 `requestId`）；客户端确认框关闭即调用取消端点（`POST withdraw-transactions/quotes/:id/cancel`）
- 状态机 `withdraw-transactions.service.ts → transitions`（23 边 + 守则单测）；大额出生路由是表外钦定写（注释成文）
- 解锁原语 `releaseLock()`（净额+费两笔 pending 一起 void——"拒绝即解锁"的物理形态，提现/退款/失败三处共用）
- 客户面防线（2026-09-12 波三红项修复补齐三道，与充值域 `modules/v4-deposit.md` §4.6 镜像达成）：`getWithdrawStatusView()`（client-web 前端函数，`client-web/src/utils/withdrawStatusView.ts`；FROZEN/MANUAL_CHECKING/PENDING_APPROVAL 逐字段收敛成 PROCESSING）+ 后端 `toCustomerWithdrawView()`（`status` 白名单收敛 + `completedAt` 独立终态白名单，镜像 `toCustomerDepositView`）+ `findAll(..., {customerScope:true})` 下忽略原始 `status` 查询参数、改走 `bucket` 补集筛选（`WITHDRAW_CUSTOMER_BUCKETS`，`PROCESSING` 是补集档）+ 客户端 `Withdraw.tsx` 筛选器改发 bucket 名，DOM 里不再出现原始状态码 + 违禁词单测全态零命中
- **客户端详情页**（`WithdrawDetail.tsx`，2026-09-15 详情增强）：Amounts（Submitted/Fee/Net amount/Completed）+ Route（Destination address·IBAN/Address label/Reference/Transaction hash）+ Pricing（报价号 `quote.quoteNo`(WQT) + `feeLevelCode`·`tierName` 费率档）+ Timeline；Timeline 走三域共用机制（`buildCustomerTimeline()` 收敛去重 + 客户端展示层 `timelineDisplay.ts` 同词连续去重）——FROZEN 先经上面 §1 的白名单收敛成 PROCESSING，两层去重叠加下冻结单与普通在途单时间线不可区分，同 §1 tipping-off 口径（详述见 `modules/v6-swap.md` §5）
- SLA `WITHDRAW_SLA_MINUTES_BY_STATUS` 四格（5 分钟/7 天硬；3 天/1 天软）｜ `withdraw-sumsub/withdraw-sla.service.ts`
- 资金腿迁移表 `funds-order-transitions.constant.ts → FIAT_OUT/CRYPTO_OUT_TRANSITIONS`；费腿三级梯 `onFeeLegFailed()`
- L1 `L1GateService`（提现十项全适用，含资产可用性；BLOCK 留 `*_L1_BLOCKED` 痕）；限额/大额阈值读 `transaction_limit_rules`（V3 篇）
- 补单（B 批，2026-09-03）：`withdraw-workflow.service.ts → initiateReturnClaim()+onReturnAfterSuccess()`（复用 `onBounce()` 的重记分录，evidence 的 `externalRef`/`effectiveDate` 改用传入值，**跳过**费腿分支——SUCCESS 时费腿早已结清、手续费不退）｜ 新列 `returnExternalLineId String? @unique`/`returnReconCaseNo String?`｜ 入口、审批与守卫见 `modules/v8-recon.md` §3/§5
- **建单带出与 Travel Rule 快照**（2026-10-22 对手方波二）：`withdraw-workflow.service.ts` 建单守卫段把已查到的地址簿行抄进局部 `counterpartyCopy`，经 `insertRecord` 落单（新列 `withdrawalAddressNo` / `beneficiaryName` / `beneficiaryType`〔抄自地址簿 `ownerType`；订单自身 `ownerType` 已被占用，刻意改名〕/ `counterpartyVaspName` / `counterpartyVaspDid`）｜ `submitSumsubTxn()` 在 `setSumsubTxn` + `WITHDRAW_SUMSUB_SUBMITTED` 之后、`submitType==='travelRule'` 时调私有 `snapshotTravelRule(w, amount)`：状态 = `!isTrApplicable ? NOT_APPLICABLE : (counterpartyVaspName ? EXCHANGED : SELF_HOSTED_NO_EXCHANGE)`，JSON 五键 `{status, beneficiaryName, beneficiaryType, counterpartyVaspName, counterpartyVaspDid}` 经主体写 `withdraw-transactions.service.ts → saveTravelRuleSnapshot()` 落 `travelRuleSnapshotJson`，并记 `WITHDRAW_TRAVEL_RULE_SNAPSHOTTED`（系统主体，afterData = 快照本体）；法币单 / 开关关闭被强制 finance 的 crypto 单 / 幂等跳过都走不到。`findOneForAdmin` 带 `vaspProfile`（按单上 DID 现拼，不落单）
- **mock 件与判型**（同批）：`isTrApplicable()` 来自 `sumsub-shared/travel-rule/mock-tr-rules.service.ts`（阈值表 USDT 1000 / AED 3500 自旧判型 resolver 搬入，与充值域同一份）；`resolveKytTxnType()` 一行化（crypto → travelRule、法币 → finance，对手方与金额不再参与）；`TRAVEL_RULE_ADAPTER` 与 `MockTrRulesService` 由 `withdraw-transactions.module.ts` 自行 provide。登记于 `reference/sumsub-mock-touchpoints.md` ⑥⑦
- **客户面投影**（同批）：`toCustomerWithdrawView` 白名单净增 `beneficiaryName` / `beneficiaryType` 两键；详情页 `addressLabel` 由“按收款地址值反查”改为按 `withdrawalAddressNo` 业务键回链地址簿（无键 → 不查、`null`）；泄漏断言的敏感键集 `SENSITIVE_KEYS`（spec）加 `travelRuleSnapshotJson` / `counterpartyVaspDid`，`counterpartyVaspName` 与 `withdrawalAddressNo` 不进客户白名单——客户读得到受益人与 label，读不到报文状态与对手方 VASP；客户端 `WithdrawDetail.tsx` 在 Address label 之后多 Beneficiary / Beneficiary type 两行（各自有值才渲染）
- 对手方 VASP 合格判据（政策口径，数据住 Sumsub）：EEC 完成 ∧ 风险评分 <10 ∧ 持牌 → 通过；演示中名录两条样本一过一不过（Mock VASP Exchange / Grey Harbor Exchange）
- 补料与材料账、Sumsub 接入同充值（V4 篇 §5），两域同构
- **共享层现状（波四共享抽离，2026-09-13，行为零变化）**：`withdraw-sla.service.ts`/`withdraw-kyt-verdict.handler.ts`/`admin-withdraw-demo.controller.ts` 分别继承 `sumsub-shared/` 的公共基类 `SlaSweepBase`/`KytVerdictHandlerBase`/`DemoScenarioControllerBase`（与充值域同构镜像，**兑换域不参与、独立演进**，见 `modules/v6-swap.md` §5）；三域共用的资产投影 `toCustomerAssetView()`、SLA 字段计算 `resolveSlaFields()` 薄壳委托、客户级限制冻结扫描信封 `freezeScanQueryArgs()` 均收进 `trading/shared/`——本域走 `ownerNoSource: 'column'`（`WithdrawTransaction` 自带 `ownerNo` 列，与 deposit 走 customer 关系不同）。`withdrawal-fee-level/` 与 `swap-fee-level/`（V6 篇 §5）双树同期合一：本域 `withdrawal-fee-level.service.ts`/`*-change-workflow.service.ts`/`*-retire-workflow.service.ts`/`*-creation-workflow.service.ts` 均改继承 `trading/shared/fee-level.base.ts`/`fee-level-workflow.base.ts`——14 族逐字同方法进基类，单资产列（`assetId`）贯穿的查询与建档校验等 8 个真分叉留域内子类；3 个审批薄壳文件因 `actionType`/`workflowType` 与兑换域不同，不合并、原样保留两份

## 6. 演示缺口（BACKLOG 有账）

- **建单接口（`POST /client/withdraw-transactions`）的响应仍原样返回内部实体、未过白名单**——2026-09-12 已把列表 / 详情两个读面（`findAllForCustomer`/`findOneForCustomer`/`findOneForCustomerByWithdrawNo`）的 `status`/`completedAt` 收敛，建单响应这条独立路径未跟进（新建单不可能立即是 FROZEN，风险面小于读面，未在本轮范围内）——演示时讲页面不讲网络面板
- **热钱包余额不查**：公司侧没钱也放行出金指令——演示别构造这个场景
- **费腿卡死后的视图残留**（Linked 卡片看着像在途，红旗只在单上）
- **全新 worktree 跑 demo:withdraw 会炸**（seed 无提现地址种子；main 栈已种好不受影响）
