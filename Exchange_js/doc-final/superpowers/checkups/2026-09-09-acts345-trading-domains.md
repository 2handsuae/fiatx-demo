# 三四五幕（V4 充值 / V6 兑换 / V5 提现）· 查缺补漏前体检（主会话判读版）

2026-09-09 ｜ 体检对象 main `909340a8` ｜ 业主目标五轴：**业务逻辑清晰合理 / 无冗余代码 / 无老旧文档和注释 / 三工作流共享模块抽离干净 / 前端页面合理且无中文** ｜ 方法：五名 sonnet 取数员交「数字 + 复现命令」（A 三域结构与共享面 / B 死码冗余 / C 文档 64 断言 / D 前端中文与页面清册 / E 注释陈旧 + BACKLOG §D/E/F/§I 22 条静态复核），关键否定性与翻案结论由主会话独立复现后才采信（复现记录见附录）。

判色口径同前两次体检：**红** = 违反铁律或命中评审三判据 ｜ **黄** = 漂移、死码、不一致，不挡演示 ｜ **绿** = 逐项核过有证据。已在 BACKLOG 的旧账标「已在账」，不重复立案。

**一句话总评：三域的骨架是健康的——状态机数字与守则单测全对、铁律③（各管各的）零违例、funds-orders 零直写、UI 可见中文为零；病灶集中在三处：① 充值域冻结留痕缺口一族（铁律①，五条已在账全部复核仍真，第七幕拉链当场露馅）与提现域 tipping-off 洞（第五幕卖点本身没落实）；② 文档与注释的系统性陈旧——三域审计码数四处文档全线过期（实数 47/30/22 vs 文档 31/25/18）、注释抽查 12 条 4 条失真（写着 stub 的早已落地、引用行号漂移 130-190 行）；③ 共享面欠账清晰可数——deposit/withdraw 两域是注释明示的逐字镜像（SLA / webhook / verdict-handler / demo 四件套），fee-level 两棵 1700 行的近同构树，外加一处跨域 import 的归位问题。BACKLOG 三至五幕 22 条复核：2 条已腐烂（已修未销）、2 条支撑细节过期、18 条仍真。**

## 五轴判色

| 轴 | 判色 | 一句话 |
|---|---|---|
| ① 业务逻辑清晰合理 | **红**（集中在两处，均已在账） | 充值冻结留痕五连缺（铁律①）+ 提现 tipping-off 三处裸奔（幕五卖点）；状态机/门/记账链本身全绿 |
| ② 无冗余代码 | 黄 | 18 零调用导出 + 15 死审计码 + 6 死列 + 前端渲染不存在字段 2 处 + 孤儿 spec 1 份 + 孤儿路由页 1 个，合计数百行级可清 |
| ③ 无老旧文档和注释 | **红**（就本轮目标而言） | 四处文档共享同一套过期审计码数；注释抽查 1/3 失真；v4 §6 一条缺口断言定位失败存疑 |
| ④ 共享模块抽离干净 | 黄 | 已共享的（L1 门/verdict-buttons/funds-orders）质量好；欠的账集中在 deposit↔withdraw 镜像四件套与 fee-level 双树，证据充分、边界清楚 |
| ⑤ 前端合理且无中文 | 绿偏黄 | UI 中文 0（双重验证）、同责组件共享有 parity spec 守护；尾巴 = 三域详情路由仍用 UUID（铁律⑥）+ 1 个孤儿路由 + 分页组件分裂 |

---

## 一、业务逻辑（轴①）

**绿——骨架逐项核过**：
- 状态机数字与文档、守则单测三方一致：充值 15 态/16 动作/29 边（spec:1287 锁边）、提现 10 态/13 动作/23 边（spec:1432）、兑换 7 枚举 5 可达/5 动作/5 边（FAILED/REVERSED 死枚举与文档口径一致）；funds-orders 四套走法逐条相符
- 铁律③零违例：三域 Prisma 表零跨域读写、三域对 `prisma.fundsOrder` 零直写（grep 全部无输出，取数员 A 附命令）
- L1 门共享求值器三域各一调用点；swap 域审计名册 33 码零死码（唯一没经历改名断裂的域）
- deposit 零调用 TransactionLimitGateService **判为设计而非缺陷**：档位限额（DAILY/MONTHLY）业务上只辖 SWAP/WITHDRAWAL（第二幕 Profile 限额表即此口径），充值只有单笔下限（BELOW_MIN 走自己的挂起闸）——不立案

**红——两族已在账缺口，本轮复核全部仍真，是三至五幕成色的主矛盾**：
- **充值冻结留痕五连缺（铁律①）**：D1 `findNonTerminalByOwner` select 缺 `correlationId`（deposit `:1409`/withdraw `:1109`，主会话复现仍缺；swap `:945` 已修的对照仍准）→ D2 INHERIT 校验拒收 → D5 `.catch` 吞错；D3/D4 `evaluateL1` enforcement 分支（现 `:249-256`）零审计调用，与 `markL1Hold` 不对称。第七幕按单号拉链，冻结那一步查不到
- **提现 tipping-off 三处裸奔（幕五卖点）**：`toCustomerWithdrawView` 裸传 status/completedAt（`:382/:391`）、`findAllForCustomer` status 直传（`:351`）、client `Withdraw.tsx:108` 裸 FROZEN 筛选——充值域的白名单防线提现域一处没抄
- 另两条红级已在账仍真：D6 `linkedFundOrders` 三弧全标 CONFISCATION（判据现 `deposit-transactions.service.ts:501`，行号漂移 ~300 行）；E1 兑换 PROCESSING 冻人广播与技术卡单共用 needsReview 旗

**⚠️ 悬案（不在本轮立案但必须带着走）**：BACKLOG §A 🔴 `demo:all` 偶发客户侧记账失衡（约 1/13，铁律⑤），头号嫌疑正是 `swap-workflow` 腿失败自愈 attempt 重建 + TB 落账不受 SQL 事务回滚保护。凡本轮动 swap workflow，判红时**先别 reset**，按 BACKLOG §A 写明的取证姿势抓现场。

## 二、冗余代码（轴②——清单，全部附命令于取数员 B 报告）

| 类 | 项 | 数量 |
|---|---|---|
| 零调用导出 | `pricing-center` 的 6 个 type/常量 + `SwapSimulatorDto`/`AdminPricingQuoteQueryDto`（该目录无 controller）、`SwapSide`、`SwapQuoteComputationResult`、withdraw DTO 的 `ComplianceStatus`/`KytStatus`/`TravelRuleStatus`、`SumsubVerificationSubstatus`、两组同名双定义（`SwapFeeItemCode`/`WithdrawalFeeItemCode`） | 18 |
| 死审计码（旧 AuditActions 扁平对象，改名断裂遗留） | `DEPOSIT_*_APPROVAL_REQUESTED` 三条、`WITHDRAW_APPROVAL_GRANTED/DECLINED`、`DEPOSIT_GATE0_PASSED`（主会话复现：全仓零引用——BACKLOG D4 提到的「放行分支写 GATE0_PASSED」亦已不是现状）、`DEPOSIT_CONFISCATION_UNLOCK_FAILED`（注释自认待清）等 | 15 全零 + 8 仅 spec |
| 死 schema 列 | `DepositTransaction.travelRuleCheckedAt/aggregatedAt/aggregatedTransferId/sumsubExternalActionId`、两费率表 `updatedByUserId` 全零；`travelRuleTransferId`/`SwapTransaction.failureCode/riskDecisionRef` 仅 spec；3 只写不读 | 12 |
| 前端渲染后端不写 | `DepositTransactionDetail.tsx:99,601` 渲染 **表里根本不存在的 `confirmations` 列**；`:117,669` "Applicant Action ID" 恒空；`FundsOrderDetail.tsx` 7 个链上字段（sentAt/nonce/blockNo…）后端零赋值恒空/默认 | 2 处页面 |
| 前端死 util | `getPayinSimActionsForStatus`/`getPayinStatusBadgeClass`、三个 `ALL_*_STATUSES`（仅 spec 用） | 5 |
| 孤儿 | `withdraw-fee-income.service.spec.ts`（607 行，同名生产文件全 git 历史不存在，实测对象 WithdrawWorkflowService——主会话复现）；client `/wallet` 路由页零入口链接（`/transactions` 经 DashboardOverview:303 模板串可达，取数员 D 假阴性已纠，见勘误） | 2 |
| 零消费端点 | **勘误后实为 3 条**（2026-09-09 主会话复查，见勘误）：`GET deposit-transactions/export`（脚手架期占位，take:10000 返 JSON，注释仍是生成器自言自语）、`GET client/withdraw-transactions/:id`（按内部 id 查的旧路，客户端现走 my/:withdrawNo）、`POST withdraw-transactions/quotes/:id/cancel`（兑换页有同款取消调用、提现页从不调，报价靠 TTL 懒过期）；**保留勿删**：swap leg resume（业主 2026-08-22 裁定留命令行路，注释自证）、`POST admin/swap-transactions` 恒 403 stub（verify-rbac 在用） | 3 |

## 三、文档与注释（轴③）

**文档（取数员 C 64 断言，相符率约 80-87%）——最重的五处**：
1. **三域审计码数四处全线过期**：v4:63「31 码封闭」/ v5:64「25 码」/ v6:61「18 码」/ script.md:139 同套数字——**主会话复现实数 47/30/22**（B 批补单 + 站 7 收编 + 波二 L1_BLOCKED 扩容后没人回填；文档其它段落自己提到新码，总数没人改）
2. v4 §3 PATCH 侧门「黑名单拒绝」描述过期——端点已物理删除（00b0eb83）
3. 函数归属错/不清 3 处：`resolveBestLevel()` 实在 `swap-quote.service.ts:59` 非 fee-audience.util；`getWithdrawStatusView()` 是 client-web 前端函数；`directionOf()` 在 funds-order.service.ts:36
4. v4:85「三条弧在客户流水里都误标成没收」**判已过时（2026-09-09 主会话人工走查闭环，业主直觉正确）**：该行写于 2026-08-26；客户流水页（client `/transactions`，2026-09-07 界面收口轮改接 statement 读模型）现只读 CLIENT_PAYABLE 流水（customer-statement.service.ts:13,103 自述），而没收/退回/上缴三弧动的全是暂扣户、从未触及客户应付——**这三笔在客户流水里根本不出现，谈不上误标**；客户端订单徽章侧 RETURNED 显 "RETURNED"、SEIZED 刻意显 "PROCESSING"（tipping-off）、CONFISCATED 走防御 fallback（depositStatusView.ts 文件头自述），亦无"没收"字样。kind 未分弧的病根仍在，但唯一露脸处是**管理台**充值详情 Linked Funds Orders 卡 = BACKLOG D6 那条（仍真）。治愈波应删/改写 v4:85 并入 D6
5. v5「权限包仍用旧名 INTERNAL_FUND_*」半句未证实：rbac.catalog.ts 零匹配（代码层残留属实）

**注释——本轮目标的正面对象**：
- 范围内 402 行带日期/任务号注释，抽查 12 条 **4 条失真**：`swap-workflow.service.ts:1101-1119` 四个行号引用漂移 130-190 行；`deposit-workflow.service.ts:2174/2443/2700` 写着「stub（real settlement lands in A3/A4/A5）」的三个方法早已完整落地；`swap-workflow.service.ts:624`「Task 7 打桩」已落地；`swap-kyt-verdict.handler.ts:33-42`「只定契约+打桩」已落地
- 中文注释体量：后端 2312 行（deposit-workflow 404 / swap-workflow 285 / withdraw-workflow 232…）、前端 1436 行——**是否属于清理范围需业主定**（见待拍板）
- 唯一 TODO：`sumsub-ingestion.service.ts:279`（Wave 9 dead events 告警）；零 @deprecated

## 四、共享面（轴④——抽离候选清单）

**已共享、质量好（保持）**：l1-gate（三域各 1 调用点）、sumsub-shared 的 verdict-buttons.shared（2026-08-29 已合并，三域只剩 6-24 行胶水）、funds-orders（零直写）、pricing-center、fee-audience.util、fee-level-transitions。

**方向合规性**：`decisions.md:16`（2026-08-24）前端已裁「同一职责同一组件，取代刻意分叉」；后端 deliberate fork 只是 2026-08 批次的工作注释、非 decisions 级否决——本轮抽离**不构成翻案**。

**抽离候选（按证据强度排）**：
1. **deposit↔withdraw 镜像四件套**：SLA service（159/157 行，全文对齐仅 token 差）、webhook router（route() 仅 warn 文案差）、kyt-verdict handler（同名表逐字）、demo-scenario + admin-demo-controller（DemoScenarioActor/VERDICT_OF 逐字）——swap 同构但有结构分叉（无软 SLA、applicant-action 方法名完全不同），抽两域共底、swap 视情况
2. **fee-level 双树**（withdraw 1673 行 / swap 1844 行）：24 同名同序方法、`moveLevel` 仅 model 名不同、3 对 approval 文件归一化 diff=0、三对 workflow diff 仅 16-45 行
3. **三份逐字函数**：`resolveSlaFields`（归一化 diff=0）、`toCustomer*View` asset 投影块（字节级相同）、`findNonTerminalByOwner`（顺手补 correlationId，与轴①红项一石二鸟）
4. **归位**：`kyt-txn-type.resolver.ts` 住 deposit-sumsub 却被 withdraw 跨域 import（唯一跨域耦合点）→ 迁 trading/shared 或 sumsub-shared
5. **16 个 `*-approval.service.ts` 薄封装家族**（15-17 行/个）——可收敛为工厂/泛型，收益小、顺手做

**明确不动**：workflow 本体三份（业务分叉真实：swap 无 decideVerdictLanding、冻结语义三域三样）；SwapLegAccounting ↔ DispositionService 双胞胎引擎（注释明示业主已裁「合并=对钱核心行为等价重写，演示零收益」）。

## 五、前端（轴⑤）

**绿**：UI 可见中文 **0**（1687 处中文全在注释/spec；「引号内中文」94 条逐条复核 + 中文标点补扫净增 6 条全在注释；主会话 JSX 文本正则复现零命中）；admin 63 页/client 17 页零未注册孤儿组件；三域同责组件（StatusTimeline/GateTile/SumsubDetailSection/NeedsReviewBanner/SimulationPanel/L1GateCard/ListFooter）全共享且有 `module-parity.spec.ts` 守护。

**黄**：
- **三域交易详情路由仍用内部 UUID**（`trading/{deposits,withdrawals,swaps}/:id`，App.tsx:206,208,210 + 三个 List 页 navigate `${item.id}` + FundsOrderDetail 三处拼链）——铁律⑥最后一批尾巴，客户域 2026-09-03 已按 `:customerNo` 换装完毕，approvalEntityRoutes.ts:1-16 注释自认。⚠️「屏上可见文本零 UUID」的原结论**已于 2026-09-09 报价单专查中证伪**：`SwapTransactionDetail.tsx:442` 渲染 "Quote ID"（UUID）、client `Swap.tsx:1049` 与 `Withdraw.tsx:841` 给客户渲染 `quoteId`（UUID）——原扫描只匹配 `.id` 命名，`quoteId` 漏网（勘误第 4 行）；两个报价单模块的完整问题清单见战役总纲「报价单收口」
- client `/wallet`（WalletManagement 260 行）注册了路由但全站无入口链接（原报告连 `/transactions` 一并判孤儿系取数员 D 假阴性——DashboardOverview.tsx:303 以模板串 `navigate(\`/transactions?assetId=…\`)` 可达，主会话复查纠正）
- 分页组件分裂：三域交易 List 用 ListFooter，其余 6 个域内列表裸用 Pagination（ListFooter.tsx:7-12 注释自述）
- client `Deposit.tsx` 未导入 RestrictionBanner/PendingActionBanner（Withdraw/Swap 均有）——是否刻意待判（第二幕「Ivy 明示受限客户端能看到提示」的覆盖面问题）

## 六、BACKLOG §D/E/F/§I 复核结论（22 条）

- **已腐烂 2 条（已修未销，建议销账）**：D7 ⭐「充值详情页终态全显 6 按钮」——通用 ACTIONS 组 2026-07-30（9b391f19）整体删除，主会话 grep 复现零命中；I7 前半「兑换 ①Approved 过度点亮」——2026-08-24 已改只在 COMPLIANCE_PENDING 高亮（注释载业主裁定），主会话复现
- **支撑细节过期 2 条（缺口本体仍真，行文要改）**：D11 TR 判定条件③金额阈值**已实现**（resolver 有 TR_THRESHOLD_BY_CURRENCY，主会话复现），只剩条件② VASP 打标靠自报；F3 提现报价零审计仍真，但「常量已定义没人调」说法不成立——`WITHDRAW_PRICING_QUOTE_*` 全仓不存在（主会话复现 withdraw-quote.service.ts 零 audit 引用）
- **仍成立 18 条**：行号普遍漂移 20-300 行（文件在长），实质未修——清单见取数员 E 报告（scratchpad 归档）

## 体检岔口——业主四裁定（2026-09-09 当日回复，全部闭环）

1. **中文注释可以留**：「无中文」只辖 UI 可见面；清理对象是陈旧失真注释，不是中文（已入 decisions.md 2026-09-09）
2. **v4:85 三弧误标客户流水**：业主判「应已修复」，主会话走查证实——已过时，见轴③第 4 条，治愈波删/改写该行并入 D6
3. **零消费端点**：主会话复查后实为 3 条（另 6 条系扫描假阴性，实际有消费者，见勘误）；3 条去留待治愈波内与死码一并处置（推荐删）
4. **充值页补受限横幅**：拍板补充；口径「兑换/提现事前可拦、充值本质不可拦」已入 decisions.md，任务已登 BACKLOG §D

## 勘误（2026-09-09 主会话复查，三处扫描假阴性）

**同一根因：模板串拼接的 URL/路由，按字面量 grep 必假阴性。**本轮连逮三处，后续扫描凡查「端点/路由零消费」必须加搜 `${` 拼接形态：

| 原结论（错） | 实情 | 证据 |
|---|---|---|
| 3×`GET admin/*-sumsub/demo/verdict-buttons` 零前端消费 | 三条全活 | `useVerdictButtons.ts:17` 以 `admin/${domain}-sumsub/demo/verdict-buttons` 动态拼域名，三域详情页共用 |
| 3×`POST admin/*-sumsub/demo/run-verdict` 仅脚本消费 | 三条全活 | `SimulationPanel.tsx:52` 同款模板串，⚡ 面板即它 |
| client `/transactions` 孤儿路由 | 可达 | `DashboardOverview.tsx:303` `navigate(\`/transactions?assetId=…\`)` |
| 屏上可见文本零 UUID | 假阴性 | 扫描正则只匹配 `.id`；`quoteId` 字段漏网——`SwapTransactionDetail.tsx:442`（admin）、client `Swap.tsx:1049`/`Withdraw.tsx:841` 三处屏上渲染报价 UUID（2026-09-09 报价单专查逮到） |

## 附录：主会话抽查复现记录

```bash
# 审计码实数（47/30/22，文档 31/25/18 证伪）
sed -n '769,839p' src/modules/audit-logging/constants/audit-actions.constant.ts | grep -cE '^\s*[A-Z][A-Z_0-9]*:'   # 47
sed -n '840,892p'  ... # 30 ｜ sed -n '893,925p' ... # 22（V6 块至 :925 止，勿数进 V8_RECON）
# D7 腐烂：六按钮零命中
grep -cE "'Approve'|>Approve<|'Expire'|>Expire<" admin-web/src/pages/DepositTransactionDetail.tsx   # 0
# D1 仍真：两处 select 无 correlationId
sed -n '1398,1412p' src/modules/trading/deposit-transactions/deposit-transactions.service.ts
sed -n '1105,1112p' src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts
# 孤儿 spec：生产文件不存在
ls src/modules/trading/withdraw-transactions/withdraw-fee-income.service.{spec.ts,ts}   # spec 在、本体 No such file
# 提现报价零审计
grep -ci "audit" src/modules/trading/withdrawal-fee-level/withdraw-quote.service.ts   # 0
# TR 阈值已实现
grep -n "TR_THRESHOLD" src/modules/deposit-sumsub/kyt-txn-type.resolver.ts
# UI 中文零（JSX 文本节点）
grep -rnP '>[^<{]*[\x{4e00}-\x{9fff}][^<{]*<' admin-web/src client-web/src --include='*.tsx' | grep -v '{/\*'   # 空
# GATE0_PASSED 死码
grep -rn "DEPOSIT_GATE0_PASSED" src scripts test --include='*.ts' | grep -v audit-actions.constant   # 空
```

五份取数员完整报告归档：会话 scratchpad `checkup-{A,B,C,D,E}-*.md`。
