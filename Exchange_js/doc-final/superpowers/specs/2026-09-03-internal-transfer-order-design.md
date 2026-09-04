# 平账二期 · 内部划转单（第四类订单）—— 骨架

- 日期：2026-09-03
- 性质：**骨架，不是 spec**。按 `CLAUDE.md §6`，spec 只写细当前波（现在是 B 批）；本文只留「已经定了的事实」和「还没定的岔口」，B 批收尾时由那一波**只**把「承接 B 批」写进本文开头；展开写细由二期开工的新会话读总纲 + 承接 + 本骨架后跟业主脑暴完成，再进 writing-plans
- 总纲：`2026-09-03-recon-settlement-waves-outline.md`（本波边界与验收口径以总纲为准，不在此重抄）
- 展开时的素材：提交 `313c60a1` 里本文的全文版（状态机 / 资金单在途 / 分录形状 / 页面 / 演示 / 验收草案），未经业主拍板，取材不照抄

## 承接上一波（B 批）

**实际偏差**（对照 B 批 spec / plan 的字面）：
- Task 4：铁律⑥优先于 plan 的接口字面量——`SupplementCandidate` 去掉 `id`、`listCandidates` 出口投影成 `SupplementCandidatesView`（对外无 caseId/walletId/ownerId/assetId，只留 `externalLineId` 一个表单锚）
- Task 4：真库冒烟逮到真 bug——`reconciliation_cases.book` 实际落库值是 `'CUSTOMER'` 不是 `'CLIENT'`（同目录既有惯例是「`=== 'FIRM'` 才算公司账簿，否则客户」），守卫原写 `!== 'CLIENT'` 对任何真实客户案件都必拒，已改 `=== 'FIRM'`。**二期任何涉及 book 判断的新代码都照此写，不要再写 `'CLIENT'` 比较**
- Task 5：批准分支的实现与 plan 不同——不再预翻 `PENDING_SCAN`，`processSignal` 自己无条件收尾且全程不读 `signal.status`；`dedupeKey` 占死问题（拒绝后客户自助补报被静默吞掉）plan 预期修、控制方裁定本批不修，已登记 `BACKLOG.md` §G
- Task 6：`getNextStatus` 的终态前置守卫会挡住新加的边（`SUCCESS` 本就在终态集里，查表前就被拒），修法是把终态检查挪到查表未命中之后——**二期给提现/充值状态机加新边时先查有没有同款前置守卫**
- Task 7：实现者正确顶掉了 brief「把 SUCCESS 移出零出边终态集」的指令——`WITHDRAW_TERMINAL_STATUSES` 有两个外部读者（材料请求作废监听、在途 notIn 查询），移出会让成功单的材料请求永不作废
- Task 8：Critical——spec 明写「拒绝后可再次发起」，但②③拒绝时清了认领列、①不释放 `supplementOfExternalLineId`；已修（复用被拒的信号行，新增状态边 `SUPPLEMENT_REJECTED → SUPPLEMENT_PENDING`）
- Task 11：plan 的一个事实错——花名册 #16 提现的 900 是毛额，净额 898（费 2），外部穿越的出款腿走净额；已改按净额匹配。**实测数字与 plan 预测不同**：`recon:demo:break` 现为 `scenarios 15/15、wallets 10/10、casesOpened 10/10`（不是 plan 写的 11/11），因为场景 14/15 都叠在已计数的钱包上、没有各开一个新钱包
- Task 12：plan 给的两条变异靶子都指错了位置——① 命中的是 `initiateClawback`（发起时点）不是 `executeClawback`（批准时点，全仓曾经零覆盖，本批已补单测）；② 资金单 CONFIRM 步的 `effectiveDate` 参数对充值补录这条路径其实是死代码，真正生效的是充值单自己的 `effectiveDate` 列（列优先、事件参数只是兜底）

**执行中发现的新事实**：
- `AccountingService.createAccounts()` 写 `tb_account_registry` 时 `bigintToHex()` 不补零，u128 账户 id 十六进制首位为 0 时写出 31 字符行，与已知的「读侧未补零」缺陷同源但根因在写侧——已在测试夹具内规避（未改 `src`），登记 `BACKLOG.md` §G。**二期开新账户（内部划转单同样要走 `createAccounts()`）时会撞上同一个坑**，命中率约 1/16
- 批准时点（`executeClawback`）的余额闸此前全仓零测试覆盖，本批变异测试证实这条闸有真实杀伤力（注掉守卫会真落一笔不该落的反向分录）——二期任何「提交时查一次、执行时再查一次」的双重前置条件都要照此补批准时点的单测，不能只测提交时点
- e2e 与 `demo:all` 存在执行顺序耦合：花名册会给种子客户铺一些非零余额/在途锁定，测试套件若依赖种子客户的可用余额，必须改用测试自建的独立客户（本批「② 退汇」的收口轮已示范这个模式）——二期写自己的 e2e 时直接抄这个先例，别再踩一次
- 走查中撞见的两条真实操作事实（与代码/文档一致性无关，纯粹是"演示会卡在这里"）：补录出来的充值单会撞金额下限门，需要运营多点一次「放行下限挂起」；⚡ 裁决按钮要切 `compliance_lead@fiatx.com`（`ops_officer@`/`cfo@` 都没有 `DEMO_VERDICT_WRITE`）——已写进 `demo/script.md` 第六幕，二期若也有类似的隐藏操作步骤，提前想着写脚本

**二期前提有无变化**：
- `SupplementEvidenceService` 与 `DispositionService` 已从 `ReconciliationModule` 的 `exports` 数组导出（`reconciliation.module.ts:59`：`exports: [WalletReconRunService, CaseAgingService, DispositionService, SupplementEvidenceService]`），二期若要复用这两个服务（如内部划转单也要走证据校验或定性联动），直接 import 即可，不需要再改模块声明
- 生效日管道已通到充值两步：`deposit_transactions.effectiveDate` 新列，`executeDepositAccounting` 的 STEP_1/STEP_2 都优先读它（资金单 CONFIRM 步的同名参数是兜底，充值补录这条路径从不用到兜底分支）——二期内部划转单若也要挂业务日，参考这个「列优先、事件兜底」的模式
- `assertWriteOffAllowed` 仍然锁死公司池（`adjustment.service.ts:129-130`：`book !== 'FIRM'` 即拒，错误文案原文就是「客户池的查无果差异不能一笔核销：托管里真少了钱，要先认损再由公司补款（二期划转）」）——客户池核销继续等二期的认损调账 + 补款两步，B 批未动这道守卫
- Alice USDT 钱包位已真空出：场景 14（入金被退汇）从 Alice USDT 搬到 Kate AED（与场景 8 共案），Alice USDT 不再承载任何 B 批场景，可以给二期新场景 16（客户池小额查不出）用，不需要另开钱包
- `reconciliation_cases.book` 真实值是 `'CUSTOMER'` 不是 `'CLIENT'`（见上「实际偏差」Task 4）——0.1 已定事实第 6 条「纯资金动作复核人 = CFO」不受影响，但二期任何新写的 book 判断代码都要按 `=== 'FIRM'` 写，不要重蹈覆辙

## 0.1 已经定了的（有出处，不翻案）

| # | 事实 | 出处 |
|---|---|---|
| 1 | 订单 = 意图 ｜ 资金单 = 物理转账的镜像 ｜ 账本 = 记账。四类订单：充值 / 提现 / 兑换 / **内部划转**；调账不是订单 | decisions 2026-08-28 |
| 2 | 资金单只在「有在途要追」时诞生；审批期间钱没动，只能挂订单层 | decisions 2026-08-28；提现代码注释 |
| 3 | 客户侧「公司承担」没有账面捷径：两组物理钱包，托管里少了 15 只有真放 15 进去才变回来。完整表达两步：**调账认损** + **内部划转补款** | decisions 2026-08-28 |
| 4 | 两个用例合用一条通道、开两个入口：① 公司池内部调度 ② 公司补款给客户 | BACKLOG §G 二期条 |
| 5 | 必须是订单（`FundsOrderService.create` 硬要求父单）；状态机与提现同构；**在途必须有资金单**否则划转期间两钱包各爆假 BREAK | BACKLOG §G 二期条 |
| 6 | 纯资金动作复核人 = CFO | 业主 2026-09-03 |
| 7 | 公司侧恒等：公司资产 = 运营 + 结算中转 + 三收入户；COA 九码不预留 | `modules/accounting-coa.md`；decisions 2026-08-13 |
| 8 | 钱包级对账：公司钱包内部余额 = 该 walletRef 上权益 / 收入码流水之和；在途识别第三轮按钱包的非终态资金单认领外部行 | `wallet-balance-checker.service.ts`、`wallet-flow-matcher.service.ts` 头注释 |
| 9 | 公司钱包角色→科目：`F_OPS→E.FIRM_OPS`（链上 + 法币，兑换对手盘）｜ `F_SET→E.FIRM_SET`（法币结算户）｜ `F_FEE→三收入户` ｜ `F_LIQ→E.FIRM_LIQ`（**科目已退役、钱包仍在、期望恒 0**） | `wallet-recon-run.service.ts` `COA_BY_ROLE` |
| 10 | 资金单迁移表四套，头注释写明 crypto OUT 与 INTERNAL 共用；资金单父键今天只有充值 / 兑换 / 提现 | `funds-order-transitions.constant.ts`；schema `FundsOrder` |
| 11 | 三个后续用例已交给本波：客户池核销（A 批 `assertWriteOffAllowed` 前提 3 锁公司池）、退汇余额不足的公司垫款（B 批）、事故赔付（三期） | A 批 spec §3.2；B 批 spec §4；BACKLOG 三期条 |
| 12 | 同池两个钱包共用一个 TB 科目账户，TigerBeetle 一笔转账借贷不能是同一账户 → 同池搬家记不了账 | 代码事实（2026-09-03 摸底） |

## 0.2 待拍板（开工先过；每条带建议）

| # | 岔口 | 选项 | 建议 |
|---|---|---|---|
| F1 | 同池物理搬家（冷热钱包、两个 F_OPS 之间）怎么记账 | 甲 本波只做跨池（F_SET↔F_OPS、F_FEE→F_OPS）｜ 乙 新增「划转在途」科目（破九码不预留）｜ 丙 每钱包一个 TB 账户 | **甲**。今天没有冷钱包角色 |
| F2 | F_LIQ 去留 | 甲 退役钱包角色（职能与 F_OPS 重叠）｜ 乙 挂 FIRM_OPS 码（撞 F1） | **甲**，本波第一个任务 |
| F3 | 补款给客户走什么账 | 甲 履约：公司侧缩 + 客户侧涨两条分录，不过充值合规闸 ｜ 乙 走充值域 | **甲**，decisions 记一句 |
| F4 | 客户看到什么 | 甲 「平台调整入账」+ 单号 ｜ 乙 显示认损案号 | **甲** |
| F5 | 谁发起 | 甲 金库（`INTERNAL_TRANSFER_WRITE`），案子上的按钮对运营只读指路 ｜ 乙 运营也持有 | **甲** |
| F6 | 大额双签 | 做 / 不做 | **不做** |
| F7 | 执行中计时 | 软标 / 不计时 | **不计时**，对账在途桶 + 推单已覆盖卡单 |
| F8 | 演示摆法 | 归集放第六幕开头；补款闭环放第六幕；新增客户池小额查不出场景 16（B 批搬走场景 14 后 Alice USDT 位空出） | 采纳 |

## 展开时要核的代码事实（写 plan 前抽查复现）

- 匹配器第三轮在途候选是否同时按 `fromWalletId` 与 `toWalletId` 取（今天提现只用 from、充值只用 to），缺则补
- `directionOf()` 加内部划转父键分支后，`getTransitionMap('INTERNAL', assetType)` 是否真落到 OUT 那套
- 补款两条分录（借 `FIRM_OPS` / 贷 `FIRM_ASSET` @F_OPS 钱包；借 `CLIENT_ASSET` / 贷 `CLIENT_PAYABLE` @客户钱包）落账后两条恒等式各自平；公司损失体现为 FIRM_OPS 减少，COA 无损失科目
- 客户池核销解锁形状：调账单 `WRITE_OFF` 对客户池放行、分录改认损（借应付 / 贷资产），POSTED 回调自动生成补款划转草稿
