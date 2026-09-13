# 波五 · 订单可见面 + 前端收口 + 三幕走查 · Spec 骨架

> 总纲：`2026-09-09-acts345-trading-campaign-charter.md` §2 波五。本文件是骨架——波五新会话读总纲 + 下方承接记录后与业主脑暴展开，勿直接当 spec 执行。

## 承接上一波（波四共享抽离收尾时填写，2026-09-13）

- 波四合并基线 commit：`<待收尾会话补——本文件在波四合并进 main 之前立档，收尾会话请把 main 上的合并基线 commit 号填在这里>`
- **实际偏差四条**（波四执行期相对 spec 骨架/总纲原始设想的勘误，波五排期时按现状读，不按总纲原文读）：
  1. 三份"逐字函数"收编，实测只有 asset 投影块真字节级相同，`resolveSlaFields` 只差各域时长表常量，`findNonTerminalByOwner` 非逐字（swap select 多 `fromAmount`，三域终态排除集/单号字段名不同）——改按**甲案信封式**收编：共享 helper 只锁死审计信封必带键，各域自传终态集/单号字段名/额外列（spec §4 勘误）
  2. deposit 无 `ownerNo` 列（withdraw/swap 有且全填充）——甲案信封新增必选参数 `ownerNoSource: 'column' | 'customerRelation'`，deposit 走 `customer.customerNo` 关系取号（§4 执行期勘误，栈级检查逮回一次真实回归——`(findMany as any)` 骗过 tsc、workflow mock 骗过 jest，只有栈上跑一轮看 `Invalid prisma invocation` 计数才逮住）
  3. fee-level 双树"24 同名同序方法"体检数字系近似，真逐字可收编 14 族（=18 个具体方法），8 个真分叉（单资产列 `assetId` vs 资产对双列 `fromAssetId`+`toAssetId` 贯穿查询与建档校验、`findActiveByAsset` vs `findActiveByPair`、`validateTiersJson` 校验规则本身不同）留域内子类，分叉计数口径 = 并集 8 / 每域 7（§5 勘误）
  4. webhook router（充↔提相似度体检 74%）实测只有 ~10 行真实码、两域间真正逐字可共享不到 10 行，抽基类净得行数比引入的泛型/抽象层样板还少——**保持两份、不抽基类**（deposit-webhook.router.ts / withdraw-webhook.router.ts 各自独立，头注写明判断依据）
- **新判例三条**（波四沉淀，波五写 plan/派 subagent 时用）：
  1. 底层 `select`/schema 咬合的改动，jest 全绿不算数——必须栈上真跑一轮看 `Invalid prisma invocation` 计数（Task 4 回归：deposit 信封固定 `select.ownerNo=true` 但该域无此列，运行时抛错被广播监听器 `.catch` 吞成 ERROR 日志，比修前更糟，粗粒度 e2e 被裁决路径同名行冒充蒙混过关）
  2. E2E 查询必须能区分同名事件的不同产生路径（同一条审计事件可能来自不同触发点，只按事件名断言会被"路径A失效但路径B顶着"的假绿蒙混）
  3. 实现者报"等我的后台循环"就意味着它有脱缰进程——控制者接管前必须 `ps` 确认对方进程死透，"找不到它的日志"不等于"它没在跑"（Task 1 期间事故：两个循环双控制者抢同一套 self 栈，挂死 100 分钟，最终查明是并发污染非真回归）
- **测试网警示两条**（波五若动到以下文件，先补测试再改，两位 opus 评审独立给出同款警示）：
  1. `trading/shared/fee-level.base.ts`/`fee-level-workflow.base.ts` 两基类的审批接线（`createAndSubmit`）与事务路径（`executeChange`/delegate 透传）零行为测试覆盖——基类 payload 写入脱离 Prisma 编译期校验（`delegate: any`），唯一的网是收编时做过的一次性逐字/逐方法等价证明，不是持续测试；后人动这两个基类的事务分支前必须先补 `executeChange`/`createAndSubmit` 行为测试，否则变异测试能把 `actionType` 全掏空还全绿
  2. 同一张单在不同裁决槽位铸出的 `txnId` 缺专门断言（Task 8 评审变异测试额外逮到的既有缺口，非本波引入，波五若动交易单铸号逻辑需留意）
- **波五前提核对**（总纲写这几条时基于波三末的现状，波五开工前需在新现状上逐条确认）：
  - 号规已在波二定妥（`2026-09-09-acts345-trading-quote-refno-*`，四个新前缀 `WDR`/`FDO`/`WQT`/`SQT`）——**仍真**，波四未触碰单号生成逻辑
  - 共享抽离未动任何路由——**已核实**：波四全程 controller 装饰器零变动（Task 6/8 读 NestJS 源码坐实 `MetadataScanner` 沿原型链上溯、父类方法照样被扫描到；Task 7/9 未改任何 controller/路由文件，git diff 零命中、无需验证），三域 API 契约字节级不变，波五要动的"三域详情路由改业务号"面前不存在波四遗留的路由层改动需要先梳理
  - F 死枚举清除（`SwapTransactionStatus.FAILED`/`REVERSED`）对波五"三域详情路由改业务号"**零影响**——两者互不相交：死枚举清除只动了终态集合与两处前端筛选映射，不涉及路由参数从 UUID 换成业务号这条改动面
  - admin 兑换筛选 Exception 组已只剩 `REJECTED`（`admin-web/src/utils/swapStatusMap.ts:77`，死枚举清除后 `FAILED`/`REVERSED` 两项已摘除）——波五若要改这张筛选映射表，从这个新现状起改，不要再对着旧的三项列表写 diff

## 已定事实（总纲阶段，来自 `campaign-charter` §2 波五原文）

- **订单级折叠**（F2，裁定 5）：制裁客户收单后连状态变化都不产生——折叠语义是设计岔口，波内 spec 脑暴（波三快修的白名单留作纵深防线）
- **L1/挂起原因说明**（D10 管理台侧）：`CUSTOMER_RESTRICTION` 格带具体因由 + 限制便签号（现只说"被限制"不说为什么，`l1-gate.service.ts:114` detail 无 cause）；客户面保持藏
- 三域详情路由 `:id` → 业务号（照客户域前例，号规已在波二定妥，见上方前提核对）；分页组件统一；恒空展示位清理（confirmations / sumsubActionId / FundsOrder 7 链上字段——删展示或模拟器补写，现场判）；顺手项（"0m"→"<1m" 等）
- **三幕完整走查截图收官**；剧本细化到站级与否 = 业主偏好（体检时留的岔口，波五 spec 时再问一次）
- **验收**：preview 截图比对 + 三幕走查 + 重铺闸
- **明确不做**（总纲 §3，防范围爬）：通知本体 I1（横切件）｜ TR 对手方 VASP 自动打标（依赖 V3 地址打标）｜ 小额计次自动冻结、自动没收 cron ｜ SLA 管理台可配 ｜ 兑换无自动 FAILED 状态机（腿失败走自愈+人工 resume 的既有设计，与本波四已清除的 `FAILED`/`REVERSED` 死枚举是两回事——死枚举是零写入的不可达值，这条是"要不要新建一条自动转失败终态的路径"，两者互不相干）｜ D10 客户面细分（tipping-off 保守是刻意）｜ D9 无 applicantId 卡单（讲词覆盖）｜ 全站 CU/WA/AS 换号（另立专项）｜ swap 腿推单 effectiveDate（对账域）
- **悬案纪律**（贯穿全战役，总纲 §4）：BACKLOG §A 🔴 记账幻影失衡**已于波四修复**（id 十六进制补零归一，见 `decisions.md`/`CHANGELOG.md` 2026-09-13 条）——总纲原文"不排波、不主动追"的悬案状态已解除，波五若跑 `demo:all` 判红不再默认按此条秒诊，需重新按常规流程排查

## 待定岔口（脑暴时与业主定）

1. 订单级折叠（F2）的具体语义：制裁客户收单后"连状态变化都不产生"落地到什么颗粒度——客户端完全冻结轮询、还是服务端吞掉状态变化事件但仍记审计？与波三已上线的白名单纵深防线如何分层
2. L1/挂起原因说明（D10）要不要连带给客户面开一条更细的白名单缝——业主口径是"客户面保持藏"，但管理台露出因由后，运营话术要不要跟着细化
3. 三域详情路由换业务号的路由参数改造范围：只换 URL 参数还是连带审计页 `auditEntityRoutes.ts`（2026-09-12 定案，目前交易域三单详情落地到"列表页 + `?keyword=`"）也一并升级为直达详情页
4. 剧本细化到站级与否——业主偏好，体检时留的岔口，本波再问一次
