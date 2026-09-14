# 波五 · 订单可见面 + 前端收口 + 三幕走查 · Spec

> 总纲：`2026-09-09-acts345-trading-campaign-charter.md` §2 波五 ｜ 骨架 2026-09-13 立，2026-09-14 脑暴定稿展开为本 spec ｜ 全部岔口已与业主逐条拍板（§1 台账），执行按本文，不再回读总纲原文的波五段（其中"折叠语义待定"等表述已被本文取代）。

## 承接上一波（波四共享抽离收尾时填写，2026-09-13）

- 波四合并基线 commit：`fbff6669`（波五开工会话 2026-09-14 核实补记——波四收尾会话立档时合并尚未发生，未及回填）
- **实际偏差四条**（波四执行期相对 spec 骨架/总纲原始设想的勘误，波五排期时按现状读，不按总纲原文读）：
  1. 三份"逐字函数"收编，实测只有 asset 投影块真字节级相同，`resolveSlaFields` 只差各域时长表常量，`findNonTerminalByOwner` 非逐字（swap select 多 `fromAmount`，三域终态排除集/单号字段名不同）——改按**甲案信封式**收编：共享 helper 只锁死审计信封必带键，各域自传终态集/单号字段名/额外列（spec §4 勘误）
  2. deposit 无 `ownerNo` 列（withdraw/swap 有且全填充）——甲案信封新增必选参数 `ownerNoSource: 'column' | 'customerRelation'`，deposit 走 `customer.customerNo` 关系取号（§4 执行期勘误，栈级检查逮回一次真实回归——`(findMany as any)` 骗过 tsc、workflow mock 骗过 jest，只有栈上跑一轮看 `Invalid prisma invocation` 计数才逮住）
  3. fee-level 双树"24 同名同序方法"体检数字系近似，真逐字可收编 14 族（=18 个具体方法），8 个真分叉（单资产列 `assetId` vs 资产对双列 `fromAssetId`+`toAssetId` 贯穿查询与建档校验、`findActiveByAsset` vs `findActiveByPair`、`validateTiersJson` 校验规则本身不同）留域内子类，分叉计数口径 = 并集 8 / 每域 7（§5 勘误）
  4. webhook router（充↔提相似度体检 74%）实测只有 ~10 行真实码、两域间真正逐字可共享不到 10 行，抽基类净得行数比引入的泛型/抽象层样板还少——**保持两份、不抽基类**（deposit-webhook.router.ts / withdraw-webhook.router.ts 各自独立，头注写明判断依据）
- **新判例三条**（波四沉淀，波五写 plan/派 subagent 时用）：
  1. 底层 `select`/schema 咬合的改动，jest 全绿不算数——必须栈上真跑一轮看 `Invalid prisma invocation` 计数
  2. E2E 查询必须能区分同名事件的不同产生路径（只按事件名断言会被"路径A失效但路径B顶着"的假绿蒙混）
  3. 实现者报"等我的后台循环"就意味着它有脱缰进程——控制者接管前必须 `ps` 确认对方进程死透
- **测试网警示两条**（波五若动到以下文件，先补测试再改）：
  1. `trading/shared/fee-level.base.ts`/`fee-level-workflow.base.ts` 两基类的审批接线与事务路径零行为测试覆盖——动这两个基类的事务分支前必须先补 `executeChange`/`createAndSubmit` 行为测试
  2. 同一张单在不同裁决槽位铸出的 `txnId` 缺专门断言——波五若动交易单铸号逻辑需留意
- **波五前提核对**（2026-09-13 已逐条确认仍真）：号规波二定妥（`WDR`/`FDO`/`WQT`/`SQT`）｜波四零路由变动、三域 API 契约字节级不变｜F 死枚举清除与本波互不相交｜admin 兑换筛选 Exception 组已只剩 `REJECTED`

## 0. 本波做 / 不做

**做**（六块，详见 §2–§7）：
A. Tipping-off 收口（新单创建即冻 + swap FROZEN 中间态 + swap 硬/软线便签退役 + 裁定入档销案）
B. 客户端状态词表统一 + 共享徽章组件
C. D10 管理台挂起因由展示
D. 三域详情路由换业务号 + 审计跳转升直达
E. 前端收口杂项（分页统一 / 恒空展示位 / 顺手项）
F. 剧本站级细化 + 三幕完整走查截图收官

**不做**（对照项目总纲 §2 与战役总纲 §3）：
- 通知本体 I1 ｜ TR 对手方 VASP 自动打标 ｜ 小额计次自动冻结、自动没收 cron ｜ SLA 管理台可配 ｜ 兑换自动 FAILED 状态机 ｜ D10 客户面细分（保持藏是刻意）｜ D9 无 applicantId 卡单 ｜ 全站 CU/WA/AS 换号 ｜ swap 腿推单 effectiveDate
- **G1 向上补齐**（充提两域做人级软/硬线三分）——2026-09-14 裁定向下拉平（见 §2.3），本波只做 swap 侧退役，不给充提加任何人级处置
- swap PROCESSING 停腿机制（`assertSwapCustomerAccessOrHalt` + needsReview）——现状即正解，一行不动
- 兑换软线补料闭环（②③⑤ await-user → 材料请求 → MaterialRequestPanel）——不动；退役的只是"拒绝处置顺手开 SOFT/HARD 便签"那两路 `open()`
- 后端状态枚举命名（OPERATION_PENDING/REJECTED 等）——语义无失真，不动
- 幂等 / 并发锁 / 重试回放 / 防御性校验（项目总纲 §2 全清单）
- D10 运营话术细化——只做展示，话术不管（业主 2026-09-14 拍板）

## 1. 脑暴裁定台账（2026-09-14，业主逐条拍板；收口时按此写 decisions.md）

1. **Tipping-off 两问定案**：客户被冻结（SILENT 便签）后——①在途单全冻（现状已如此：腿未跑 FROZEN、腿已跑停腿）；②**新单允许创建、创建即冻**（业主收回此前"报错拦截"提法：持续中性报错本身就是信号，收单折叠才算不通风报信）。
2. **Tipping-off 达标原则**：客户可见状态**跟着钱走**（钱押着→显示处理中；钱退回→显示终局），无声性靠**与普通业务结局不可区分**保障，不靠"没有结局"。行业锚：确认制裁=冻资产+全服务停摆（客户终将察觉，法律只禁事前通风与调查细节）；调查中=限时挂起（英 DAML 7+31 天式）或中性拒绝，无人做"永远处理中"。
3. **swap FROZEN 终态→中间态**：押锁不放、两条出边（RESUME/REJECT_REFUND）、解冻审批照充提抄。**"兑换冻结终态不押钱"（2026-08-20 裁定）正式翻案**，翻案新事实=裁定 1 的创建即冻（终态放钱的前提不复存在）+ 行业锚（调查扣审天然限时、有两种结局，零出边死冻结哪种制度都对不上）。
4. **swap 硬/软线便签退役**：三域对同一套裁决按钮的行为统一为"**只有 ⑦（制裁·客户本人）动人**"——⑨ MLRO freeze = 调查扣审，三域冻单不冻人；⑪ no tag = 普通拒绝只动单（充值因钱已入库落人工复核队列，系资金方向物理差异非语义分歧）。硬线便签**能力保留**（注册表、管理台手工开单下拉、MLRO+政府文书号解除），交易域不再自动调用；软线便签 `open()` 一并撤（实证：面板无任何按钮可达软线分支，撤=零行为变化+清死分支）；**硬线 sticky 标记与补料入口永久静默逻辑保留**（`applicant-action.handler.ts:65` 在补料路径上真实生效），维持 swap 独有不扩散。G1 不对称按向下拉平消解。
5. **客户端词表统一**：`PROCESSING` / `ACTION REQUIRED` / `SUCCESS` / `DECLINED`（合规、业务拒绝）/ `FAILED`（技术性失败）/ `RETURNED` 等，大写徽章样式向充提看齐；swap 的 `Completed`→`SUCCESS`、`Unsuccessful`→`DECLINED`。admin 侧 `ACTION_PENDING` 标签统一为 `AWAITING CUSTOMER`。
6. **D10 只做展示**：管理台 L1 快照 `CUSTOMER_RESTRICTION` 格带具体因由+限制便签号；客户面保持藏；运营话术不做。
7. **岔口三**：审计跳转表三域交易单升直达详情页。**岔口四**：走查剧本细化到**站级**。

## 2. A · Tipping-off 收口

### 2.1 新单创建即冻（三域）

**触发判据**（全波统一，写成一处共享判定，勿三域各抄一遍字面）：客户命中**SILENT 便签且该便签卡本域能力**。现状下自动产生的 SILENT 便签只剩 `SANCTION`（scope=ALL）；管理台手工开的 `KYT_REJECTED_HARD`（SWAP+WITHDRAW）同样兜进。客户同时有 DISCLOSED 便签卡本域的 → 维持今天的中性拒绝（客户已被横幅告知，报错无泄密）。

| 域 | 现状 | 改动 |
|---|---|---|
| 充值 | 收进来→L1 FREEZE 分支入冻，展示 PROCESSING | 客户自报进单口 fold（见下方 2026-09-14 勘误；detected() 链路零改动） |
| 提现 | 报价/建单在 `assertTradingEligibility` 抛中性 403（`withdraw-quote-customer.controller.ts:42` / `customer-withdraw.controller.ts:46`）；workflow L1 BLOCK 再拦一道（`withdraw-workflow.service.ts:384`） | SILENT-only 客户放行报价与建单；建单照常压 TB pending 锁；入库后立即走既有 FREEZE 边转 FROZEN（提现冻结不放锁=现状，`releaseLock` 只在拒/败/退终态路径）；原 `WITHDRAW_L1_BLOCKED` 审计对该客户不再发生，改为建单+`WITHDRAW_FROZEN` 两条审计，L1 快照照记 `CUSTOMER_RESTRICTION FAIL`（供 §4 展示） |
| 兑换 | 同提现，报价闸 `swap-transactions-customer.controller.ts:46` | 同提现：放行报价与建单；`initiateSwap` 建单（COMPLIANCE_PENDING+出生锁）后立即 FREEZE（既有唯一入边）；建单响应给客户的是收敛后视图（FROZEN→COMPLIANCE_PENDING→Processing） |

2026-09-14 执行期勘误（Task 4 评审）：充值"零改动"前提失准——客户自报入口 inbound-signals 也是进单口（Deposit.tsx Simulate 按钮），已按裁定 1 统一 fold；detected() 链路零改动的判断仍真。（补充：客户自助入口实为两步连打——`createForCustomer`(:138，改动后行号) 自报预通知 + `scanForCustomer`(:478，同一份 Deposit.tsx 点击链路自动跟着打) 落地扫描；两处 `assertTradingEligibility` 都换成了 `assertTradingIntake`，否则第一步放行、第二步仍照旧拒的话，信号会卡在 IGNORED，永远到不了 `detected()`。）

- 建单与冻结**两步落库、审计各写各的**（镜像既有冻人广播路径的形状），不追求同事务原子——中途崩溃留下"已建未冻"的单会被下一次广播/L1 补冻（技术兜底不做，语义上先建后冻即可）。
- 提现建单余额不足 → TB 拒绝报普通错误，与普通客户同款，无泄密，不特殊处理。
- 各域 FREEZE 入边从哪些状态可达，plan 时逐域核迁移表；缺边则照铁律④显式加边，不绕表直写。

### 2.2 swap FROZEN 中间态改造（本波最重一块，动钱动状态机）

**现状**（2026-09-14 逐处实证）：FROZEN 零出边终态；两个冻结点（本单裁决落地 `swap-workflow.service.ts:1156`、冻人广播 `:1846`）冻单后当场 `releaseBirthLock` 放锁回余额；客户面 `toCustomerSwapStatus` FROZEN→REJECTED（`swap-transactions.service.ts:633`）显示 Unsuccessful；管理台 FROZEN 行零动作。

**目标终态**：

| 件 | 内容 |
|---|---|
| 迁移表 | FROZEN 加两条出边：`RESUME → COMPLIANCE_PENDING`（解冻审批通过后系统驱动）、`REJECT_REFUND → REJECTED`（拒了退钱）。入边维持唯一 `COMPLIANCE_PENDING --freeze-->` 不变；PROCESSING 仍无冻结入边（停腿路线不动） |
| 钱 | 两个冻结点撤 `releaseBirthLock` 调用（含审计 reason 里 "birth lock released to balance" 措辞同步改写）；`REJECT_REFUND` 边落地时放锁回余额；`RESUME` 不放锁，押着走完后续流程 |
| 解冻审批 | 新审批类型（命名照充提解冻先例），合规官提（新权限码进 Trading 域"兑换"桶，对齐充提"提解冻"两桶的持有人口径）、**MLRO 裁决**；批准→RESUME 落地→照提现 resume 后的既有样子重新过一轮 KYT 裁决（`withdraw-workflow.service.ts:2218` rescore 同构）。判例「审批类型三处同加」（2026-09-05）适用；**新审批策略必须往 `scripts/verify-rbac.ts` 的 `MAKER_GROUP_BY_POLICY` 加一行**（delivery-checklist：表外策略不受自批死锁闸保护）；**新权限组四处同时出现**（`PermissionGroup` 联合类型 / 至少一条 `route()` / `ACTION_BUCKET_CATALOG` 桶 / 至少一个职务持有） |
| SLA 计时 | FROZEN 从终态变活态，按 delivery-checklist"新结局要回答要不要计时"：**对齐充提两域 FROZEN 的现状口径**（充提冻结态是否计 SLA，plan 时核对后 swap 照抄，不自创） |
| REJECT_REFUND | 与提现域 FROZEN 的同名出边同构；发起面/权限码/是否免审批，plan 阶段逐字核对提现实现后照抄，不自创 |
| 客户面 | `toCustomerSwapStatus`：FROZEN→`COMPLIANCE_PENDING`（替换现在的→REJECTED）；`toCustomerSwapView` 补 `completedAt` 显式白名单（现状靠"只有 SUCCESS 写它"的结构性偶然） |
| 管理台 | `swapStatusMap.ts`：FROZEN 移出 `SWAP_TERMINAL_STATUSES`、动作行从 `{}` 补 Resume（发起解冻审批）/Reject 两动作；详情页接按钮 |
| "FROZEN=终态"假设清理 | 枚举注释（`swap-transaction.dto.ts:17-21`"零出边终态"）、`decideVerdictLanding` 的 FROZEN 幂等闸注释、freeze-scan 排除集注释（FROZEN 仍排除，语义不变、理由变为"已冻无需再冻"）、既有 jest/e2e 里断言冻结放锁与零出边的用例全数排查改写——plan 列清单逐个点名 |
| 客户端 | `SWAP_TERMINAL_STATUSES`（`Swap.tsx:35`）不动（FROZEN 收敛后吐 COMPLIANCE_PENDING，自然非终态，history 自刷继续轮询——挂着的单轮询属正常"慢单"行为，不做轮询上限之类兜底） |

### 2.3 swap 硬/软线便签退役

`handleRejectDisposition` 里 `restrictionCause` 三分（`swap-workflow.service.ts:1078-1096`）改为：`hasSanction → open('SANCTION')`；否则**不开任何人级便签**。即删除 `KYT_REJECTED_SOFT` / `KYT_REJECTED_HARD` 两路 `open()`（软线实证面板无按钮可达=零行为变化）。保留：
- `markHardLineDisposition` sticky 标记照写（硬线判定逻辑 `isHardLineThisVerdict` 不动）、`applicant-action.handler.ts:65` 的补料静默照旧——退役的是便签，不是静默机制；
- 注册表两因由、管理台手工开单下拉、`customer-restriction-workflow.service.ts:143` 的 MLRO+文书号解除流程；
- 充值域"消费外来硬线便签按 scope 判定"的既有行为与其测试（`deposit-workflow.service.spec.ts:406`）。

改后逐字验收口径：⑨/⑪ 按钮按下，三域除单据状态外**客户维度零写入**（限制账、材料请求皆无新行）。

### 2.4 文档裁定与销案（收口时随 delivery-checklist 做）

- `decisions.md` 五条：裁定台账 §1 之 1/2/3/4/6（翻案条必须写明被翻案的 2026-08-20 原裁定与新事实）
- `BACKLOG.md`：§F Q1 订单级折叠——**以"已实现"销**（创建即冻+统一 processing 展示即折叠的落地形态）；§D `CAPABILITY_RESTRICTED` 原因不可辨条——管理台侧随 §4 解决后改写该条（客户面细分部分保留为"刻意不做"表述）；G1 相关表述按向下拉平改写
- `modules/` v4/v5/v6 三篇：状态机图（swap 5 态 5 边→5 态 7 边）、客户可见性节、模拟面板按钮语义（⑨ 写实为"调查扣审（非制裁）"与 ⑦"制裁冻结"分讲两种制度）
- 审计码计数同步（新增解冻审批族、退役无、文档 4 处计数位）；新增审计码出生即四属性齐全、过 `assertActionSpec`
- `CHANGELOG.md` 一合并一行
- **战役收官归档**（波五是末波，无下一波承接）：合并后本波 spec 与总纲 `2026-09-09-acts345-trading-campaign-charter.md` 及历波 spec 一并移 `doc-final/archive/`（总纲 §5）；worktree+分支清理

## 3. B · 客户端词表统一

- 新建共享 `StatusBadge` 组件（client-web 今天三页各写各的徽章 span），三域词表收敛：

| 语义 | 统一词 | 现状偏差 |
|---|---|---|
| 处理中（含一切收敛态） | `PROCESSING` | swap 是 Title Case "Processing"、无 uppercase 样式、font-medium（`Swap.tsx:578` vs `Deposit.tsx:373`） |
| 待客户补料 | `ACTION REQUIRED` | 已一致 |
| 成功终态 | `SUCCESS` | swap 是 "Completed" |
| 合规/业务拒绝 | `DECLINED` | swap 是 "Unsuccessful"；withdraw 已是 DECLINED |
| 技术性失败 | `FAILED` | 已一致 |
| 退回类 | `RETURNED` / `RETURNING` / `CLAWED BACK` | 已一致（充值独有后两个） |

- 三份 `*StatusView.ts` 的 tipping-off 头注规则（"冻结必须与合规审查不可区分"）逐字保留并随 swap 映射改动更新；其 spec 守护用例同步。
- admin：`depositStatusMap.ts` 的 `AWAITING CUSTOMER` 为准，`withdrawStatusMap.ts` 的 `ACTION PENDING` 标签改齐；其余 admin 原样回显不动。
- 词表变更连坐排查：demo/script.md 截图判据、walkthrough 断言里出现旧词（Completed/Unsuccessful）之处全量 grep。

## 4. C · D10 管理台挂起因由

- `CustomerAccessService.resolve` 的 `blocked` 今天是 `Set<Capability>`，拿不到因由——扩展返回结构，携带每个被卡能力的 `{cause, restrictionNo}`（SILENT/DISCLOSED 都带；这是服务端内部结构，客户面序列化仍只走 `disclosed`，铁律不破）。
- `L1GateService` ②格 detail（`l1-gate.service.ts:114` 附近）从"holds down X capability (N item(s))"升级为带具体因由+限制便签号；便签号照铁律⑥用业务号。
- 管理台 L1 快照面板渲染因由+便签号，便签号链接到客户详情限制区块。（2026-09-15 终审勘误：便签号为**文本展示**，"链接到客户详情"系 spec 撰写期外延、非业主裁定内容——业主原话「只做展示」，不建链接，BACKLOG 措辞已同步改实。）
- 客户面：L1 快照本就不出客户端（字段白名单已挡），验证即可；`holdReasonOf()` 客户面行为不动。

## 5. D · 三域详情路由换业务号 + 审计直达

- 管理台三域详情路由 `:id`（UUID）→ `:depositNo/:withdrawNo/:swapNo`，照客户域 `:customerNo` 前例（后端 admin 详情端点按业务号查、admin-web 路由定义/列表 navigate/详情 fetch 全链换键）。
- 波二判例连坐清单：**权限码随路由参数连动**（RBAC catalog 里按 URL 登记的端点同步）；**全量 grep 入站链接**——模板串 URL 字面 grep 必假阴性，按路径段拆词扫（`scripts/**`、docs、demo 生成器、两个前端一起）；报价详情两路由（波二已换业务号）不动。
- `auditEntityRoutes.ts:8-10` 三行由"列表+`?keyword=`"升直达详情（`I2 keyword` 列表搜索能力保留不删）；文件头注"波五换键"注释随之收尾。
- 数据重铺零兼容层（项目总纲 §3）。

## 6. E · 前端收口杂项

- **分页统一**：三域交易 List 之外 6 个裸用 `Pagination` 的域内列表换 `ListFooter`（`ListFooter.tsx:7-12` 注释自述的分裂收口）。
- **恒空展示位**（2026-09-14 plan 前复核勘误：体检 :43 行把字段误记在 `DepositTransactionDetail.tsx`，实测该页已无 `confirmations`/"Applicant Action ID"，复现 `grep -n "Applicant Action\|confirmations" admin-web/src/pages/DepositTransactionDetail.tsx` 零命中）：真实恒空面只有 `FundsOrderDetail.tsx` 7 个链上字段（confirmations/blockNo/nonce/gasUsed/effectiveGasPrice/sentAt/confirmedAt，类型 :82-91、渲染 :550-570 与 :675-682，后端零赋值）——**删展示**；执行时若发现某字段存在真实赋值路径则保留并在评审报告点名。
- **顺手项**："0m"→"<1m" 等展示零头，plan 时枚举成清单逐项销。

## 7. F · 站级剧本 + 三幕走查

- `demo/script.md` 三幕（充值/兑换/提现）细化到**站级**（业主 2026-09-14 拍板）：每站=一屏动作+截图判据；本波新行为（制裁客户创建即冻、swap 解冻审批、⑨ 调查扣审讲词）写进对应站。
- `demo/data.md` 同步：核对种子客户里有无制裁在身的 persona（快捷登录 11 客户中查），缺则定一个"现场喂 ⑦ 制造"的标准步骤写进剧本，不新增种子。
- 三幕完整走查截图收官：按站级剧本逐站截图，产物随 delivery-checklist 归档。

## 8. 验收与闸

- 随手闸：①②③ tsc 三件套 ｜ ④ jest 本任务目录全绿 ｜ ⑤ 前端改动必 preview 渲染+截图
- 收尾闸：⑥ `on-stack.sh main demo:all` 全绿并断言终态 ｜ ⑦ **verify:coa 必跑**（动钱：swap 冻结押锁、解冻/拒退放锁路径）｜ ⑧ **重铺闸必跑**（权限字典/审批类型/种子牵动；判据对照 `demo/baseline.md` 全绿）
- 行为专项：
  - 创建即冻：制裁客户三域下单/收款→单据 FROZEN+审计成对（建单+FROZEN），客户端全程 PROCESSING、余额扣减自洽、横幅不亮；DISCLOSED 客户维持中性拒绝
  - swap 解冻闭环：⑦ 冻单→合规官提解冻→MLRO 批→RESUME→重过 KYT→终局；REJECT_REFUND→退款回余额（verify:coa 前后各跑）
  - 便签退役：⑨/⑪ 按下，客户维度零新行（限制账/材料请求表前后 diff）
  - E2E 断言区分同路径同名事件（波四判例 2）；底层 select 改动跑栈上 `Invalid prisma invocation` 计数（波四判例 1）
- 测试的绿必须来自行为，禁止"扫源码文本"型断言（项目总纲 §7）
- 合并后：重启后端 + `db:base:sync`（新权限码/审批类型）；动 seed 则 `stack.sh reset main`

## 9. 派工与评审口径

- 按项目总纲 §6 分层：任务执行/随码测试/走查截图/文档收口 → `sonnet`；§2.2（swap 状态机+钱）与 §2.1（建单链路）两块**点名升档评审 → `opus`**；spec 评审、终审、变异测试 → 主会话模型继承（省略 model 字段）
- 派 subagent 一律带项目总纲 §0–§5 要点
- 悬案纪律更新：BACKLOG §A 记账幻影失衡已于波四修复，demo:all 判红**不再默认按此条秒诊**，按常规流程排查（先取证再 reset 仍适用）
