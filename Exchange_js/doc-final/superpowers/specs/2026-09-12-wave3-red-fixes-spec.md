# 波三 · 业务红项修复 · Spec

> 总纲：`2026-09-09-acts345-trading-campaign-charter.md` §2 波三 ｜ 2026-09-12 立（骨架展开，业主脑暴四岔口全闭环）｜ 基线 main `4c78c3ff` ｜ 本波涉码事实已于 2026-09-12 主会话逐处复现（行号为当日实测，plan 时以现场为准）

## 0. 本任务做 / 不做

**做**：A 充值冻结留痕五连缺 ｜ B 提现 tipping-off 三处 ｜ C D6 三弧 kind 分弧 ｜ D E1 冻人 vs 技术卡单（原地冻定案）｜ E 小真账四条（E3/E5/D8/I2）｜ F 审计页实体跳转（业主拍甲案）｜ G 客户端横幅重排（业主五规则定案）｜ 三个波二顺手项

**不做**（对照项目总纲 §2 与战役总纲 §3）：幂等/去重/重试/并发锁/防御校验等 §2 全清单 ｜ F2 订单级折叠（波五）｜ D10 管理台侧原因说明（波五）｜ 通知本体 I1 ｜ 兑换 FAILED/退回终态与处置弧 ｜ H1 审计子表覆盖面（F 只用主表 primarySubject）｜ 三域详情路由 `:id`→业务号（波五；F 经「列表页+keyword」绕开）｜ CU/WA/AS 换号 ｜ 悬案 §A 不主动追（纪律见 §11）

## 1. 承接上一波（波二收尾填写，原文保留）

- 波二合并基线 commit：`6c473e47`；审计名册基线 V4/V5/V6 = **47/33/22**；单号 `WDR`/`FDO`/`WQT`/`SQT` 已统一，报价详情路由已 `:quoteNo`
- 波二顺手修掉两报价详情页白屏（前端期望嵌套、后端返扁平，tsc 恒绿运行必崩）——「⑤号渲染闸真有判别力」再添实证
- **plan 前提被实测推翻三处判例**（写 plan 时对"我记得的先例"先复现）：①「审计不进事务」错（swap 真先例传 tx 第三参）②「兑换响应缺 quoteNo」错 ③「审计页主体可点进详情」错（生态级不存在——正是本波 F 要补的）
- **假阴性判例两条**：带省略号的 `WD…` 提法躲得过三形态 grep；引号字面交替组要写全
- 环境判例：worktree jest 须 `export DATABASE_URL`；Node 20 显式切；jest 不接管道尾

## 2. A · 充值冻结留痕五连缺（铁律①，BACKLOG §D 冻结留痕族五条一次清）

三个修复点收束五条 BACKLOG：

1. **select 补 `correlationId` ×2**：`findNonTerminalByOwner()` 的 select（deposit 现 `:1406`、withdraw 现 `:1112`）各加 `correlationId: true`，对齐 swap 域同名方法已修对的写法。这让路径一（`onCustomerRestrictionOpened` 广播冻单）里已存在的 `depositAudit`/`withdrawAudit` 调用不再被 INHERIT 校验拒收。
2. **`evaluateL1()` FREEZE 分支补审计**：deposit-workflow.service.ts 执法级分支（现 `:245-258`）目前只有 `logger.warn` + `updateStatus(FREEZE)`，零审计调用。照同文件 `markL1Hold()` 的写法补一次 `depositAudit({action:'DEPOSIT_FROZEN', ...})`，correlationId 取自 deposit 行（INHERIT）。**不扩审计名册**——`DEPOSIT_FROZEN` 是 47 码里的现役码。
3. **验证 `.catch` 链路真落库**：路径一的审计调用被自己的 `.catch` 包住、失败只打 error。修完 1 后必须实证「调用真的成功」而不是「不再报错」——验收见 §10 拉链判据。

**销账**：BACKLOG §D「冻结留痕（同族五条）」全部五条（⭐两路径总条 / 🔴制裁冻结写入失败 / ⭐evaluateL1 零审计 / ⭐L1 FROZEN 分支不对称 / 「调了但静默写失败」）。

## 3. B · 提现 tipping-off 三处（照充值域抄，BACKLOG §F ⭐）

充值域已有的防线（`modules/v4-deposit.md` §4.6）在提现域逐处复刻：

1. `toCustomerWithdrawView()`（现 `:380`）：status 走 `CUSTOMER_STATUS_PASSTHROUGH` 同款白名单收敛、completedAt 走 completed 独立白名单——FROZEN 对客户面显示中性状态。
2. `findAllForCustomer()`：customerScope 下静默忽略客户传入的 `status` 参数（现状直传 = `?status=FROZEN` 是可用的冻结预言机）。
3. client `Withdraw.tsx` `HISTORY_STATUS_FILTERS`（现 `:108`）：裸 status 列表改 bucket 补集式（照充值域 §4.6 设计）。

**边界**：只抄防线，不动提现状态机；F2 订单级折叠留波五（本白名单是纵深防线，总纲已注明）。**销账**：§F ⭐ tipping-off 条。

## 4. C · D6 三弧 kind 分弧（BACKLOG §D ⭐）

- 后端 `deposit-transactions.service.ts` linkedFundOrders 的 `isConfiscation = legSeq > 1` 二分（现 `:501` 一带）改按 legSeq 精确映射：**2→CONFISCATION ／ 3→RETURN ／ 4→SEIZE**；`LinkedFundOrder.kind` 类型随之扩。
- 前端 `DepositTransactionDetail.tsx` Linked Funds Orders 卡（现 `:543` 一带）cap 文案加 RETURN / SEIZE 两分支——政府上缴不再显示成 "Fee · Confiscation"。

**销账**：§D ⭐ 三弧误标条（v4:85 文档行波一已删，本条是病根本体）。

## 5. D · E1 兑换「冻人」vs「技术卡单」（业主定案：原地冻是正解）

**定案记录（进 decisions.md）**：兑换在途单碰客户冻结，三条出路里取第三条——**原地冻住等人的结论**。继续跑完 = 替被冻客户动钱（冻结禁止的正是这个）；全部退回 = 兑换域无逆向引擎且总纲明确不做 FAILED 终态。人放出来 → Resume 恢复（现成路径）；人实锤 → 一直冻着（处置弧域外）。

实现两件事，**不落新旗、不动状态机、不动 schema**：

1. **读时派生标识**：admin 兑换列表/详情 DTO 派生 `ownerRestricted`（该单 owner 当下 `blocked` 是否含 SWAP/ALL——管理台看执法层 blocked，无 tipping-off 顾虑）。前端卡单堆里「Customer frozen」徽章与 needsReview 技术卡单区分展示。客户解冻的瞬间派生值自动翻回，零状态同步。
2. **Resume 门控**：`resumeLeg()` 入口（现 `:1723`，实测只查 SWAP_NOT_PROCESSING / SWAP_LEG_NOT_STUCK 两件事，**不查客户限制——现状点 Resume 会真动一腿钱**）补客户限制断言：owner 受限即拒绝，错误文案说明「客户受限中，解除后可恢复」；前端按钮同判置灰 + tooltip。needsReview 旗本体不动。

**销账**：§E ⭐ E1 条。

## 6. E · 小真账四条

| 条 | 修法 | 销账 |
|---|---|---|
| E3 兑换时间线 operator 恒 'SYSTEM' | `swap-transactions.service.ts` statusHistory 写入点接真实 actor（调用链带 actor 的传 actor，系统动作留 SYSTEM） | §E E3 条 |
| E5 兑换 resubmit 不推死线 | `swap-sla.service.ts:73-78` 补提交成功后 `slaDeadline` 推一个完整窗口（`resolveSlaFields(COMPLIANCE_PENDING)` 或等价），Sumsub 拿回完整 5 分钟 | §E E5 条 |
| D8 审批深链只到列表页 | `findOneForAdmin` 的 `approvals[]` 投影补回 `id`（case 主键、不含 step，不违背「仅单头」），前端深链 `/admin/governance/approvals/<id>`。**充值域为准，withdraw/swap 详情页同款问题 plan 时 grep 收齐同修**（判例：同款收齐以 grep 兜底） | §D 深链条 |
| I2 `?keyword=` 死参数 | `DepositTransactionList` / `WithdrawTransactionList` 读 `keyword` query 参数预填单号筛选并生效——审批回链从「落对页面」变「定位到那笔单」 | §I keyword 条 |

## 7. F · 审计页实体跳转（业主拍甲案）

- 审计列表页（`AuditLogsPage.tsx:522`）与详情页（`AuditLogDetailPage.tsx:335`）的 `primarySubjectNo` 从纯文本变链接；新建**按 primarySubjectType 键**的前端路由映射，照 `approvalEntityRoutes.ts` 前例与纪律：**逐条核对现状路由实证后才映射；映射缺席 = 保持纯文本，不硬造**。
- 交易域三单（详情路由仍 UUID，波五才换业务键）走「列表页 + `?keyword=`」——与 §6 I2 咬合；`SwapTransactionList` 的 keyword 支持随本项一并补（甲案要跳兑换单）。有业务键详情路由的域（客户/资产/审批等）直跳详情。
- 铁律⑥：一律业务号，不带 UUID。
- 承接观察 2 的 `AuditModules` 常量：其「路由映射零消费」的说法 plan 时按否定性结论纪律先复现再定去留（2026-09-12 grep 见它在 5 个后端文件出现，与骨架说法存疑）——它是后端 module 路径表，与本项前端映射本就是两回事，不混。

## 8. G · 客户端横幅重排（业主五规则定案，2026-09-12）

**数据关系**：材料请求可绑订单或不绑、可绑限制条子或不绑（2×2 四组合）；条子不看订单，只看客户 + 封禁域（scopes）。SILENT/DISCLOSED 两层不变式**不动**：SILENT（制裁类）永不下发，横幅缺席即正常页面。

**合并形态（推翻 2026-08-18「留材料那条」的让位方向，业主 2026-09-12 定案）**：条子+材料 → 展示**条子形态**（先说「你受限了」+ 原因），CTA 从「联系客服」换成跳 `/verification/:requestNo`；绑定材料 `SUBMITTED` 时 CTA 换「审核中」。理由记录：限制是因、材料是解法，材料形态标题读不出「被封了什么」。

**展示矩阵（业主五规则 + 2026-09-12 确认兑换订单详情页不展示）**：

| | Overview / Profile | 充值页 | 提现页 | 兑换页 | 充/提订单详情 | 兑换订单详情 |
|---|---|---|---|---|---|---|
| 单独条子 | ✓ | 封该域才✓ | 封该域才✓ | 封该域才✓ | — | — |
| 条子+材料（条子形态） | ✓ | 按域✓ | 按域✓ | 按域✓ | 绑此单则材料入口✓ | ✗ |
| 材料+订单（无条子） | ✓ | 该域订单✓ | 该域订单✓ | ✗ | 材料入口✓ | ✗ |
| 单独材料 | ✓ | ✗ | ✗ | ✗ | — | — |

已接受的后果（业主确认）：无条子的兑换材料，客户唯一发现入口是 Overview/Profile。

**实现面**（`scopes` 已在 `DisclosedRestrictionView` 下发，按域过滤不需要新后端字段；合并形态需要 restrictions 响应补绑定材料的 status 一枚字段供「审核中」判断）：

- **Overview**：`RestrictionBanner` 换成 `ProfileBannerStack`（合成端点天然「条子+材料全量」，与 Profile 统一，单独材料从此在 Overview 可见——现状缺）。
- **profile-banners 合成端点**：让位方向翻面——条子被材料认领时发条子形态行（带材料 CTA/审核中），材料行只发无条子的。
- **充值页（新挂）/ 提现页 / 兑换页**：`RestrictionBanner` 加按域过滤（scopes 含本域或 ALL 才渲染）；充值页横幅按 2026-09-09 拍板加补充行「入金仍会到账、到账后按受限处置」，**不拦任何按钮**；`PendingActionBanner` 改为只显示「无条子且绑本域订单」的材料行——充值页新挂、提现页收窄、**兑换页摘除**。
- **订单详情页**：零改动（充/提已有材料入口、兑换无——现状即规则）。
- **G6 注释与文档连带更新**：两处旧规被推翻（绑单无条子材料上列表页；单独材料撤出交易页），`PendingActionBanner.tsx`/`RestrictionBanner.tsx`/`CustomerProfile.tsx` 的 G6 注释与 modules 相应节同步改，防「注释还在讲旧规」成为下一轮体检的失真注释。

**销账**：§D 充值横幅条。**定案进 decisions.md**：五规则矩阵 + 合并形态翻面 + 推翻 G6 两点。

## 9. 顺手项（波二承接）

1. `pricing-engine.service.ts` `buildWithdrawalQuote` 死码删（2026-09-12 全仓 grep 复核仅剩定义）。
2. `BACKLOG.md` 头部「⭐ 共 15 条」实数对账。
3. `SwapQuoteDetail.tsx`「Linked Swap Transaction」卡 SWP 号改链接（补 swapTransaction DTO 的定位键，与提现侧对称）。

## 10. 验收（对照总纲波三验收行）

- **随手闸**：三闸 tsc + 本波相关 jest 全绿；改 client-web 另跑 `npm run test:client`。
- **⑥⑦**：`demo:all` 全绿 + `verify:coa`（动了 swap workflow 路径）。
- **第七幕拉链到底（岔口④定案）**：demo:all 后取花名册走冻结的两笔（#7 广播路径、#10 L1 直判路径）单号，管理台审计页按单号实查——`DEPOSIT_FROZEN` 在链上、与该单其余事件同一 correlation 旅程；**查不到即不过**。截图归档。
- **⑤ 渲染闸**：preview 截图——充值页受限横幅（含补充行）／条子+材料合并形态（含审核中态）／Overview 统一栈／E1「Customer frozen」徽章与 Resume 置灰／审计页链接跳转落点／D6 三弧文案。**tipping-off 反证**：制裁客户（SILENT）的客户端各页与普通客户逐字相同、零横幅。
- **重铺闸**：预期不动 schema/seed，不触发；若 plan 中破例动了则按总纲跑 `stack.sh reset` + demo:all。
- 测试的绿必须来自行为，禁止「扫源码文本」型断言。

## 11. 悬案纪律（贯穿）

动 swap workflow 期间（§5、§6-E3/E5）`demo:all` 判红**先按 BACKLOG §A 取证姿势抓现场再 reset**——1/13 记账失衡悬案头号嫌疑就在 swap 腿路径上。

## 12. Plan 阶段勘误（2026-09-12 现场取证，三处修正 + 两处新发现）

1. **§5 E1「前端按钮同判置灰 + tooltip」作废**：SwapTransactionDetail 无 Resume 按钮——业主 2026-08-22 已裁定「兑换单不给修复入口，后端 resume 端点留命令行路」（该页 :690-693 注释自证），不翻案不重造按钮。Resume 门控只落后端 `resumeLeg` 入口断言（命令行路同样被挡，铁律②）；前端交付改为「Customer frozen」标识。
2. **§6 D8「投影补 id」过时**：审批详情路由已按业务号收参（App.tsx `governance/approvals/:approvalNo`，客户域业务键收口后换的），投影现有的 `approvalNo` 即够——修法降级为纯前端深链（deposit/withdraw 两详情页 navigate 补 `${a.approvalNo}`），零后端改动。
3. **§7 `AuditModules` 死码坐实**：`grep -rn "AuditModules\." src scripts test` 零命中——5 处引用 = 1 定义 + 4 个未使用 import，随 F 任务删除。
4. **新发现 · 审计页幽灵字段**：`audit_log_events` 表 2026-08-25 重建后只有 `primarySubjectType/No`，但 DTO/mapEvent 仍拼 `entityType/entityId/entityNo`（恒 undefined、JSON 序列化即丢），前端两页渲染的正是 `entityType`——**审计页 Entity Type 列在生产恒空**。F 任务顺带：前端切 `primarySubjectType`、DTO/mapEvent 三死字段删除。
5. **新发现 · profile-banners 死路由 CTA**：`profile-banners.service.ts` 对 `DOCUMENT_CTA_CAUSES` 类未认领条子下发 `ctaPath: '/verification'`，而客户端只有 `/verification/:requestNo` 路由（点击落空白页）——G 任务合并形态翻面时该分支整体退役，bug 随之消亡。

## 13. 文档交付（对照 `rules/delivery-checklist.md` 触发项）

- `modules/v4-deposit.md`（冻结留痕、横幅）、`v5-withdraw.md`（tipping-off 三处）、`v6-swap.md`（E1 定案、operator、SLA resubmit）、审计篇（实体跳转）相应节
- `decisions.md`：横幅五规则定案（含推翻 G6 两点与合并形态翻面）｜ E1 原地冻定案 ｜ 审计跳转甲案
- `demo/script.md` + `demo/data.md`：横幅新可见物涉及的幕步（受限客户走查步骤）；第七幕拉链步骤补冻结链
- BACKLOG：销账清单见各节；头部计数对账（§9）
- CHANGELOG 一行（合并时）
