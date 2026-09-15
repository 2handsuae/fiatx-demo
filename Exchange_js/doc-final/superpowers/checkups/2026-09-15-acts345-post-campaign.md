# 三四五幕（V4 充值 / V6 兑换 / V5 提现）· 战役收官后复检（主会话判读版）

2026-09-15 ｜ 体检对象 main `5855a9da` ｜ 目的：对照 2026-09-09 战役前体检（`archive/superpowers/checkups/2026-09-09-acts345-trading-domains.md`）逐项验「问题是否都解决」+ 扫当下新问题 + BACKLOG 台账腐烂检测 ｜ 方法：六名 sonnet 取数员交「数字 + 复现命令」（A 共享面与结构 / B 死码 / C 文档注释 / D 前端 / E 上轮红黄项验修 / F BACKLOG 全台账），红级指控与否定性结论由主会话逐条复现后才采信（复现记录见附录）。随手闸 tsc ①②③ 当日全绿（Node 20）。

判色口径同前：**红** = 违反铁律或命中评审三判据 ｜ **黄** = 漂移、死码、不一致，不挡演示 ｜ **绿** = 逐项核过有证据。

**一句话总评：五波战役的账基本清了——上轮两族红项（充值冻结留痕五连缺、提现 tipping-off 三处）与 D6/E1 全部已修实证，死码七类清单 7/7 清零，共享面承诺件全兑现（未抽的四处全有 decisions 定案兜底），波五四件承诺（创建即冻 / swap FROZEN 中间态 / 词表收敛 / D10 因由）逐一验码属实，§A 幻影失衡悬案已根修。当下新病灶两处红：① 客户端兑换页「Matched」行把 `${fromAssetId}_${toAssetId}` UUID 拼串和 tierId 渲染给客户看（铁律⑥客户屏首犯，且同名字段两条路径语义不一致）；② 划转工作流一处 `as any` 直写 `fundsOrder` 表（铁律③，平账二期存量、划转域）。其余是黄级尾巴：管理台三处屏上内部 ID、审计/账本域 4 条路由没换业务号、文档对波五两件新功能零覆盖 + 4 处一行级过期、1 条新失真注释、3 个死导出。BACKLOG 复核 70 条：腐烂 3、表述过期 5、其余仍真，两条已勾条目实证支持勾选。**

## 五轴判色对比

| 轴 | 2026-09-09 | 本次 | 一句话 |
|---|---|---|---|
| ① 业务逻辑清晰合理 | 红 | **绿** | 上轮两族红全部修复实证；状态机/门/记账链仍全绿；新增铁律③违例 1 处在划转域（第六幕），不折三四五幕 |
| ② 无冗余代码 | 黄 | **绿** | 七类死码清单 7/7 清；波三~五零新增孤儿；剩 3 个战役前老死导出（pricing.types.ts）+ 2 个已在账孤儿 |
| ③ 无老旧文档和注释 | 红 | **绿偏黄** | 审计码数/状态机数字/overview 全对齐，4 条旧失真注释全清；剩 4 处一行级过期 + 1 条新失真注释 + 波五两件功能文档零覆盖 |
| ④ 共享模块抽离干净 | 黄 | **绿** | freeze-scan / fee-level 双树 / kyt-txn-type 归位 / resolveSlaFields / asset 投影全兑现；四处「未抽」全部是 decisions.md 2026-09-13 定案（兑换零接入 / webhook router 不值得 / 客户可见性常量不抽 / 薄封装不收敛），不是欠账 |
| ⑤ 前端合理且无中文 | 绿偏黄 | **绿偏黄** | UI 中文 0、路由三域换装、quoteId 三处修、/wallet 删净、横幅补齐、孤儿 0；剩客户屏 Matched 行 UUID（红）+ 管理台 3 处屏上 ID + 域外 4 条 UUID 路由 |

## 一、上轮问题清偿对照（问题 → 现状，全部主会话或 E 员当前 HEAD 实测）

**红项 4 族——全部已修实证**：
1. 充值冻结留痕五连缺：`freeze-scan.util.ts:40` 信封恒带 `correlationId`，`ownerNoSource` 三域分支如实（deposit 走 customer 关系）；`deposit-workflow.service.ts:245-269` enforcement 分支已补 `depositAudit`，与 `markL1Hold` 对称；`.catch` 仍在但 INHERIT 拒收根因已消；三域 audit 方法均带 OWNER subject
2. 提现 tipping-off 三处：`toCustomerWithdrawView`（:438-463）白名单收敛；`findAllForCustomer:349` customerScope 屏蔽裸 status 走 bucket；client `Withdraw.tsx:226` bucket 参数、零裸 FROZEN
3. D6 三弧误标：`KIND_BY_LEG_SEQ`（deposit-transactions.service.ts:490）按 legSeq 2/3/4 分 CONFISCATION/RETURN/SEIZE，详情页 cap 文案三分支对应
4. E1 冻人 vs 卡单：`ownerRestricted` 与 `needsReview` 脱钩，`SwapTransactionList.tsx:418-420` 两枚徽章独立渲染

**死码七类——7/7 清零**（波一 `4151ea91` + 波三顺手 + 波五 T10；逐类复现命令见取数员 B 报告）：18 零调用导出、23 死审计码（码名在 `DEPRECATED_AUDIT_ACTIONS` 治理清单里以字符串活着，是运行时校验用，不是复发）、8 死 schema 列、恒空渲染字段（confirmations 删 / Applicant Action ID 换真实 `applicantActionIds` / FundsOrder 7 链上字段删）、5 死 util、孤儿 spec 改名收编（`withdraw-workflow.fee-income.spec.ts`）、3 零消费端点（export 删 / 旧 `client/:id` 删 / quote cancel 已被 `Withdraw.tsx:261` 真调）。

**文档 5 处失真——修 3、部分 1、漏 1**：②v4:85 删 ✓、③函数归属 3 处 ✓、④v5 INTERNAL_FUND_* 清 ✓；①v4:75 详情已更新但 **v4:54 表格摘要仍留「黑名单直接拒绝」旧措辞**；⑤ **script.md:217 仍写「兑换 22 码」**（波五已加到 26，v4/v5/v6 三篇 modules 的 47/33/26 全对）。**4 条失真注释 4/4 全清**。overview.md 三域行全对（提现边数已修）。

**波五四件承诺——全实证**：①创建即冻由 `customer-access.service.ts:204-242` `assertTradingIntake` 统一驱动三域（deposit 走既有 L1 分支是设计不是漏）②swap FROZEN 进 1 出 2 边 + `onUnfreezeApproved/onRefundApproved` 审批驱动 ③两域词表 FROZEN 收敛 COMPLIANCE_PENDING ④`l1-gate.service.ts:106-124` cause+restrictionNo 编入 detail、`L1GateCard.tsx:95` 渲染。时间线 operator 9 处全语义化。三域详情路由与后端端点均业务号（动作类 POST 仍 `:id`，屏上不可见，不判缺陷）。

**悬案清偿**：§A 🔴 幻影失衡（≈1/13 记账失衡）已于波四根修（id 补零，重铺闸 10 连跑全绿，BACKLOG 2026-09-13 销账在案）。

## 二、当下新发现

**红 2 项**：
1. **铁律⑥客户屏——兑换页「Matched」行渲染内部 UUID**：client `Swap.tsx:738`（rateMeta.matched）与 `:1047`（firmQuote.matched「Matched Pair / Tier」行）mono 渲染 `pairId / tierId`。firm quote 路径 `swap-quote.service.ts:172` 造的 `pairId` = `${fromAssetId}_${toAssetId}`（两个资产 UUID 拼串）、`tierId` = 费率档 tier 行 id；预览路径 `swap-transactions.service.ts:245-253` 的 `pairId` 却 = `feeLevelCode`（业务码）——**同名字段两条路径语义不一致**，客户屏上时而业务码时而 UUID 串。修法：两路统一成业务语义（feeLevelCode + tierName），或整行只显 `pairName / tierName`
2. **铁律③——划转工作流直写 `fundsOrder` 表**：`asset-treasury/internal-transfers/internal-transfer-workflow.service.ts:223` `(this.prisma as any).fundsOrder.update(...)` 给腿补写 txHash/referenceNo，绕过已注入的 `FundsOrderService`（该 service 无对应方法），还带 `as any` 逃逸类型检查。引入于平账二期 Task 7（`ddf23e91`，2026-09-05），属第六幕划转域存量、非本战役新造，按「pre-existing 不豁免」判例照登。全仓其余 `fundsOrder` 写点全在 funds-layer 正主。修法：`FundsOrderService` 补一个 stampExternalRef 类方法，workflow 改调

**黄**：
3. 管理台屏上内部 ID 3 处：`SwapTransactionDetail.tsx:537-539` Trace ID / From Asset ID / To Asset ID 三个 InfoField；`AuditLogDetailPage.tsx:362` Owner ID（Owner No 旁冗余展示）
4. 域外路由 UUID 尾巴 4 条（第七幕/账本域，非三四五幕）：`audit/logs/:id`、`audit/evidence-packages/:id`（两表已有 `eventNo`/`packageNo` 业务号未用——铁律⑥正犯）；`ledger/accounts/:id`、`ledger/transfer-evidence/:tbTransferId`（TB u128 hex，非 DB UUID，可议）。三域交易 + 其余 8 模块共 42 条路由已换装
5. 文档零覆盖 2 件：波五「客户面词表 SUCCESS/DECLINED」与「D10 L1②格因由+便签号」在 modules 三篇 + script.md 全零命中（grep DECLINED / restrictionNo 均空）
6. 新失真注释 1 条：`swap-kyt-verdict.handler.ts:15-19` 仍写「兑换 FROZEN 是零出边终态 `[FROZEN]: {}`」——与波五 FROZEN 中间态（迁移表注释自证 2026-09-14 起出 2 边）直接矛盾。行为本身大概率仍对（解冻走管理台审批不走 KYT tag），判失真注释改写、不判行为缺陷
7. 其它一行级过期：`funds-orders.md:62` 残留 INTERNAL_FUND_* 旧名句；`audit-actions.constant.ts` V4/V5/V6 三块头注释仍写 31/25/18（源码注释，非 doc-final）
8. 死导出 3 个（战役前老残留）：`pricing.types.ts` 的 `SwapPairEntry`/`WithdrawalAssetEntry`/`WithdrawalPolicyRestrictions`——声明后全仓零引用（含本文件），主会话复现
9. 观察项（不立案）：client 三域筛选手法不统一（Deposit/Withdraw 走 bucket、Swap 直传 status 但选项收窄，结果都不泄 FROZEN）；client 三域详情页 Field/goBack 小组件三份重复（订单详情重设计专项顺手收）；approval 薄壳家族全仓实数 38 个（决案口径 36），不收敛系 decisions.md 2026-09-13 定案

## 三、BACKLOG 台账复核（70 条未勾 + 2 条已勾）

计数：**仍真 ~62 ｜ 腐烂（已修未销）3 ｜ 表述过期 5 ｜ 无法验证 0**。两条 [x]（D10 因由 / Q1 创建即冻）代码实证支持勾选。台账已随本次体检当场记账（销 3、订正 5、§H 加澄清句、新发现登记），详见 BACKLOG.md 本轮销账段。

- 腐烂 3：§A5③ spec 注释矛盾已消 ｜ §I formatSlaRemaining 已显 `<1m`（slaDisplay.ts:27）｜ §G canonical-minor 已真传 `asset.decimals`（reconciliation-query.service.ts:147-165，TODO 已清）
- 表述过期 5：§A3 recon-demo UUID 报错行号（5 处旧号仅 1 命中，现 8 处）｜ §A5② 行号错引搬家（:842 应引 :793）｜ §B 费率族 afterData 文件被波四收编进 `fee-level-workflow.base.ts` ｜ §B 账本报表 spec 已移 archive ｜ §C 离场提示文案已英文化
- §H「45 码仅 ~7 码用子表」重数确认**数字不用改**：波三~五新增审计全在交易域（V4/V5/V6），不在该条圈定的 V1 治理域 36 码内；已加澄清句防误读

## 勘误（本轮取数假阴性/误报，主会话复查订正）

| 原结论（错） | 实情 | 判例 |
|---|---|---|
| `AudienceInput`/`L1Outcome` 零引用死导出 | 本文件内被函数签名/兄弟接口结构性消费，是活类型 | **「零外部 import ≠ 零消费」**——类型可经签名隐式消费，判死导出前先查本文件 |
| `InternalFundAuditLog` 零读取（F 员初扫） | 读取走 schema 关系字段名 `auditLogs`，delegate 名 grep 假阴性 | 查 Prisma 消费面要同时搜 delegate 名与关系字段名 |
| B 员初筛 20 死码候选中 17 个误报 | 本文件内部消费 + `grep -v spec` 误伤含 "spec" 变量名的活代码行 | 排除词条要精确到路径不裁行内容 |

## 附录：主会话抽查复现记录

```bash
# 铁律③直写（红2）
grep -rn "fundsOrder.update" src --include='*.ts' | grep -v spec   # 正主两处 + internal-transfer-workflow.service.ts:223
git log --oneline -S "fundsOrder.update({ where: { id: leg.id }" -- src/modules/asset-treasury/internal-transfers/internal-transfer-workflow.service.ts   # ddf23e91 平账二期
# 客户屏 UUID（红1）：两条路径 pairId 语义
sed -n '733,742p;1043,1050p' client-web/src/pages/Swap.tsx
grep -n "pairId" src/modules/trading/swap-fee-level/swap-quote.service.ts    # :172 = ${fromAssetId}_${toAssetId}
sed -n '240,256p' src/modules/trading/swap-transactions/swap-transactions.service.ts   # pairId = feeLevelCode
# swap FROZEN 已非终态（坐实 handler 注释失真）
grep -n "FROZEN" src/modules/trading/swap-transactions/swap-transactions.service.ts | head   # :116 自证 2026-09-14 起出边
# 文档零覆盖
grep -rn "DECLINED" doc-final/modules/ doc-final/demo/script.md   # 空
grep -rn "restrictionNo" doc-final/modules/v4-deposit.md doc-final/modules/v5-withdraw.md doc-final/modules/v6-swap.md doc-final/demo/script.md   # 空
# script.md 兑换码数漏更
sed -n '217p' doc-final/demo/script.md   # 「兑换 22 码」，实数 26
# 死导出 3（含本文件零消费）
grep -rn "\bSwapPairEntry\b|\bWithdrawalAssetEntry\b|\bWithdrawalPolicyRestrictions\b" src admin-web/src client-web/src scripts test   # 仅声明行
# BACKLOG 腐烂抽查
grep -n "1m" admin-web/src/utils/slaDisplay.ts   # :27 '<1m'
grep -n "decimals" src/modules/clearing-settle/reconciliation/domain/reconciliation-query.service.ts | head   # 真传 asset.decimals
# 随手闸（2026-09-15）
npx tsc --noEmit -p tsconfig.json && (cd admin-web && npx tsc -b --noEmit) && (cd client-web && npx tsc -b --noEmit)   # 三闸全绿
```

六份取数员完整报告归档：会话 scratchpad `checkup2-{A,B,C,D,E,F}-*.md`。
