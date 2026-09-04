# V3 财务配置治愈 · 波二「行为与判据」—— spec

- 日期：2026-09-05（09-03 立骨架；09-04 波一收尾写入承接；09-05 新会话读总纲 + 承接 + 骨架后与业主脑暴展开成本文）
- 性质：**spec，只写细本波**。总纲：`2026-09-03-v3-config-cure-waves-outline.md`（边界与出口以总纲为准）。本波合并后本文归档。
- 素材：`checkups/2026-09-03-v3-five-modules.md` 划给波二的项——其中近半已被波一顺手治好，§0.3 逐条核销，**不要照体检报告排活**
- 核对基线：所有 file:line 在 main `49fdfa6e` 上现场复现；plan 前按当时 HEAD 重核（波一三次栽在过期行号上）

## 承接上一波（波一）

波一 16 个任务全部完成，2026-09-04 快进合并进 main（46 commit，184 文件，+5716/−6830）。合并后 main 上闸门全绿：`verify:rbac` / `verify:act1` 14+1 / `demo:all` asserts 5/5 / `verify:coa` 57 科目无负余额 / `verify:audit` / `verify:demo-data`。

**实际偏差（计划与现实不符，共 6 处，全部当场订正）**
1. plan 的闸门顺序把 e2e 排在 `demo:all` 之后同库跑——`demo:all` 花名册会永久制裁 `withdraw-money-arcs` 的夹具客户，该套件必红。`demo/baseline.md` 本就要求 e2e 干净态起跑，是 plan 写错。已改为 e2e 前单独 reset。
2. plan 的 Task 8 指错文件（写 `withdraw-transactions.service.ts`，实际在 `withdraw-workflow.service.ts`）；同一个错在 `PRODUCTION-NOTES:49` 也有一份，一并订正。
3. plan 的「最后一个默认档」退役守卫只在请求时查，两步操作可绕（非并发问题）。已改为落地时复检。
4. plan 说桶数 50→49，实际 **52→51**（对账域在波一开工前就从 2 桶涨到 4 桶、无人记录；波一自己只退役 1 桶）。
5. plan 说本波新增退役审计码 20 个，实际 **16 个**（6 资产 + 6 钱包 + 4 限额）。
6. plan 要求把体检标签下本波已做的六项在 BACKLOG 标结案，实际全文件只有 1 条带该标签、且是业主定的"本轮不做"项，正确保持开着。

**执行中发现的新事实**
- **资产暂停的后端硬门根本不存在**（业主已拍板划给波二，见 §1 第 4 条）：spec 与模块篇都写「暂停 = 三条路的资产门当场关」，但 16 个任务没有任何一个任务点去建它。三处实证：`swap-transactions.service.ts:159-168` / `withdraw-workflow.service.ts:257-258` / `inbound-transfer-signals.service.ts:582` 均只判资产存在不判 `status`。唯一生效机制是三个客户端页面共读 `GET /assets?status=ACTIVE`，故 UI 走查演得通、绕过前端打 API 畅通。模块篇已按实况订正。
- **这类缺陷逐任务评审天然抓不到**：14 轮任务评审逮出十几个真缺陷，全是"写了但写错"，没有一个是"该写没写"——承诺没有代码就不产生 diff。终审专门按这条去找，又逮到 3 个同类（站 4 审计搜索、审批策略标签表、费率两族差异未入册）。**波二收尾的终审应保留这一问。**
- **`verify:rbac` 从 1 条自批判据长成 4 条**：S5（无永久死锁，28 条策略）/ S5b（登记项仍是真死锁）/ S5c（maker≠checker，22 查 + 6 豁免）/ S5d（豁免项仍真实重叠），另有 S8（表↔策略一一对应）、S9（裁决人持详情页读权限）。**判例：每张手工维护的豁免表都必须配伴生断言**——本文件三张表全是漏了才被评审补上的。
- **七个 `*_SEEDED` 审计码上岗**，业务种子 actor `RELEASE` / 演示造数 `DEMO_SEED`；`verify:demo-data` 新增 R5 按业务键 join（非计数），对重铺漂移免疫、空块也报违规。
- **业主中途拍板修掉一条既有治理死锁**：`ADMIN_ROLE_BINDING_CHANGE_APPROVAL` 曾因 `IAM_ROLE_ASSIGN` 与裁决人同为 CISO 而永远走不完；选甲案给 TECH_OFFICER 加该权限组，实证技术官提单 201、无权限角色仍 403。该策略随之登记进 P2 豁免表（同 `ADMIN_INVITE_APPROVAL` 理由）。
- **合并进 main 的两条运维硬前提**（已写进 `demo/baseline.md`）：① 首次重铺前必须 `rm -f /tmp/exchange_js_main/dev.db`，否则迁移 `20260903125954` 在非空 wallets 上撞 NOT NULL 而中止（终审带对照组证过）；同一条 rm 顺带让 main 上恒红的 `verify:audit` 不变量③ 转绿。② 主工作树的 Prisma client 是旧 schema 生成的，重铺前须先 `npm run prisma:generate`，否则种子类型检查崩（本次实际撞上）。

**本波前提有无变化**
- 骨架 0.1 第 2 条「波二在波一的新结构上做，不回头改结构」**成立**：五块结构已落终态，三条退役路径在代码层真的没了（`WALLET_WRITE` / `ASSETS_CREATE` 全仓零命中，退役端点在任何控制器上都不存在）。
- 骨架 0.1 第 1 条的波二范围**新增一项**：资产暂停硬门（业主 2026-09-04 拍板划入）。

## 0. 本波做 / 不做

### 0.1 出口（一句话，验收就按这句）

**重铺后走一遍站 2 / 4 / 5，再到第七幕审计页把刚才做的每个动作——包括被拦下的——都查出来；`verify:act1` 对 V3 的行为判据全绿。**

### 0.2 切分逻辑

一波 = 一个能一句话说清的出口 + 一套统一的验收口径。骨架那张病灶清单混了三种东西，按这把尺子分档：

| 档 | 判据 | 归宿 |
|---|---|---|
| ① 证据链 | 第七幕审计页上拉不拉得出来 | 进波二（§2–§3） |
| ② 站上看得见 | 演示当天观众 / 演示者会不会看到不对 | 进波二（§4） |
| ③ 看不见的卫生 | 关掉演示也一样存在 | 死 import 与 `/dashboard` 旧树**搭车**（业主 09-05 拍板，§5）；徽章色板与 e2e 闸门扩面**出去**——各有自己的出口，回 BACKLOG / TOOLING-DEBT，**不是波三** |

①②合起来是一件事：站在第七幕审计页上，第一幕后半每个动作都查得到；三站从头演到尾没有一句讲解词跟屏幕对不上。个个零碎，加起来不零碎。

### 0.3 骨架清单在 HEAD `49fdfa6e` 上的逐条核销

| 骨架项 | HEAD 现状（现场复现） | 处理 |
|---|---|---|
| A-R1 资产就绪拒绝不留痕 | 激活整条路已退役，`asset-activation-workflow*` 文件不存在 | 销 |
| W1 `mockBalance` 假余额 | schema + 全仓零命中 | 销 |
| W3 / W4 / W6 / W13 钱包四项 | 平台钱包只读，管理台写路径退役；`wallets.service.ts` 只剩内部方法 | 销（W6 幽灵节 plan 前在 `CustodianWalletDetail` 复核一眼） |
| D2 冷却内取消入口 | 客户端已建：`WithdrawalAddresses.tsx:366-398,672` Cancel registration + 理由 | 销 |
| X3 自批闸表缺资产策略 | `verify-rbac.ts:243-244` 已含 `ASSET_SUSPENSION / ASSET_REACTIVATION` | 销 |
| X5 裁决人读权判据 | 已成 `verify:rbac` S9 | 销 |
| X6 三处提交后无待批态 | `AssetDetail` / `TransactionLimitDetail` / `SwapFeeLevelDetail` 均渲染 approvalCase（8 / 11 / 12 处） | 销，plan 截图复核 |
| 费率审计主体 `SFLC-###` | 已改 `primarySubjectNo: level.levelCode`，`SFLC` 全仓零命中 | 销 |
| D7 后门未标 ⚡ | Skip Cooling 已在 Manual Simulation ⚡ 区（`WithdrawalAddressDetail.tsx:481-491`） | 销；**按钮权限门控仍缺** → §4.3 |
| D6 侧栏项权限错位 | 侧栏项已要求 `WITHDRAWAL_ADDRESSES_READ`（`DashboardLayout.tsx:237-241`） | 销 |
| 费率列表筛选含不存在的 REJECTED | 状态集含 REJECTED（`shared/fee-level-transitions.constant.ts:11`） | 销；**中文夹英文仍在** → §4.4 |
| 客户端提现页假规则 | "Min: 0.001 BTC" 已无；"24 hours" 句仍在 `Withdraw.tsx:928` | → §4.2 |
| 限额：充值 BELOW_MIN 无限额域留痕 | 出生时 `deposit-transactions.service.ts:1117` 直写 `'BELOW_MIN'`，绕过 `TransactionLimitGateService.reject()` | → §3.1（并入 L1 留痕） |
| 资产暂停硬门 | 三处只判存在不判 `status`（承接节三处行号仍准） | → §2 |
| D1 地址五门拒绝零留痕 | `withdrawal-address.service.ts:63/111/164/214/228` + `-workflow.service.ts:45`，全在主体层抛 | → §3.2 |
| D3 客户动作记成 SYSTEM | `withdrawal-address-workflow.service.ts` 6 处 `recordSystem`（+3 处 `recordByActor` 是管理员动作） | → §3.3 |
| X7 requestId 17 处 | 资产 6/6、钱包 2/2、限额 6/7、费率两族 16/17 + 13/14 已齐；**地址 9 处全缺** | → §3.4 |
| X9 落地行无 from/to | 资产 `ASSET_SUSPENDED / REACTIVATED`、地址五条落地行、费率 `*_CREATION_APPLIED` 均无 `fromStatus`（费率只有 RETIRED 带） | → §3.5 |
| D17 倒计时不走秒 | `formatCountdown()` 无 tick，只在拉数据时算一次 | → §4.1 |
| 兑换报价拿不到客户身份（岔口 4） | `getRate` 是控制器里唯一无 `@Request()` 的端点 | → §4.5 |
| X10 `/dashboard` 旧树 | `App.tsx:182-409` 整棵树 **零入站链接**（唯二入站是树内 `PolicyChangeRequestDetailPage` 自指）；`/admin` 树 50 条路由是活树 | → §5.2 |
| X11 死 import | `AuditBusinessWorkflowTypes` 只 import 不用 **21 文件**（定义处除外） | → §5.1 |
| `AssetProvisioningService.provision()` | 零调用方，仍注册为 provider（`assets.module.ts:20`）；种子只 import 纯函数 `systemAccountCodesFor` | → §5.3 |
| `verify:audit` 手抄退役码 | `scripts/verify-audit.ts:82-99` 未 import `DEPRECATED_AUDIT_ACTIONS` | → §5.4 |
| S9 手抄前端路由表 | `verify-rbac.ts:506` 镜像 `ApprovalDetailPage.tsx:86`，无伴生断言 | → §5.5 |
| 「合并进 main 必重启 + sync」入章程 | `TOOLING-DEBT:114` 开着；`CLAUDE.md §10` 无此行 | → §7 |

### 0.4 本波不做（对照 `CLAUDE.md §2` + 业主裁定）

- 徽章色板（岔口 3，全站视觉，验收口径不同）｜ e2e 闸门扩到 18 套（岔口 2，闸门自己的债）——两者原地留在 BACKLOG / TOOLING-DEBT
- L1 冻结分支零审计（BACKLOG:137/139）——V4 客户制裁那条线，只改名不改行为
- 客户限制解除后重触发挂起单放行：运营 waive 时客户仍受限 → `checkAutoApproval` 原地不动，是既有缺口，不在本波
- 幂等 / 去重 / 并发（§2 禁做）：同旅程重发的审计去重只靠 requestId 随机位，不另做
- 给 `OPERATION_PENDING` 加迟到裁决的边——按 §1 第 2 条该场景不存在
- 新资产上线、平台钱包增删改、限额新建（波一已退役，不回头）

## 1. 本次脑暴的业主裁定（2026-09-05，已落 `decisions.md`）

1. **L1 / L2 定义与「Gate 0」退役**：L1 = 平台内所有限制条件的判断（`L1GateService` 九项 + 本波的资产可用性）；L2 = Sumsub 合规判断。「Gate 0」是 L1 建成前的旧名（`runGate0` 原先只读 `CustomerMain.complianceStatus`），提现 / 兑换从没用过，全仓无 Gate 1/2/3。退役：方法名、日志、JSDoc、actorId `COMPLIANCE_GATE_0`、管理台注释与提示、e2e 哈希种子、文档四处。
2. **`OPERATION_PENDING` 只能从合规通过进入，没有后悔药**：L1 行政级问题一律「打标记、不换状态、照常送检」，合规通过后由 `holdIfHeld`（`deposit-workflow.service.ts:728`）推进 OPERATION_PENDING。这是 2026-07-31「先合规后判金额」口径的恢复——BELOW_MIN 一直这么走（出生打标 `:1117`，状态留 COMPLIANCE_PENDING）；08-22 `holdAtGate0` 在 KYT 之前直推 OPERATION_PENDING 是反向，本波纠正。**BACKLOG:129 由此销账**：那个死单（waive 后无裁决走不动）正是反向造成的，三个候选解法的前提消失。
3. **挂起分支也送检**——第 2 条的直接推论，不是独立决定。
4. **资产暂停是 L1 硬门**（翻案 2026-08-22「资产状态闸不做」，`decisions.md:21` 已注）：落法见 §2。
5. **站 4 加一拍**「暂停期间打进来一笔 USDT」（§7）。
6. **范围**：岔口 2 / 3 出去；③ 档死 import 与 `/dashboard` 旧树搭车。

## 2. 资产可用性成为 L1 第十项

### 2.1 求值器（`src/modules/trading/shared/l1-gate/`）

- `L1CheckCode` 加 `'ASSET_AVAILABILITY'`，`CHECK_ORDER` 末尾；三域都适用（`NOT_APPLICABLE` 表不动）
- 进 `SELF_OWNED_CHECKS`：本 service 亲自查、调用方 preChecks 里同名码一律丢弃（同客户资格 / 客户限制的理由：覆盖成 PASS = 闸门被静默绕过）
- `L1GateInput` 加 `assetIds: string[]`（充值 1、提现 1、兑换 2）；任一资产 `status !== 'ACTIVE'` → FAIL，`detail` 写资产业务号与状态
- `holdReasonOf`：`ASSET_AVAILABILITY` → `'ASSET_SUSPENDED'`
- 判定结果照旧整包落 `l1Snapshot`；管理台 `L1GateCard`（三域详情共用，`components/L1GateCard.tsx`）按 checks 数组通用渲染，第十格自动出现，不改组件

### 2.2 三域接入

**提现 / 兑换**（`withdraw-workflow.service.ts:368`、`swap-workflow.service.ts:316`）：evaluate 传 `assetIds`；`verdict === 'BLOCK'` → 抛 `L1_GATE_BLOCKED` 中性文案的逻辑不变；**抛之前留痕**（§3.1）。

**充值**（`deposit-workflow.service.ts:212-335`，现名 `runGate0`）：
- 改名 `evaluateL1`；`holdAtGate0` 改名 `markL1Hold`
- 分流改为：执法级限制（`releasePolicy === 'MLRO_APPROVAL'`）→ FREEZE（不变）｜ `l1.verdict === 'HOLD'` → **只写 `limitHoldReason`（「已有挂起原因优先」保留）、状态留 `COMPLIANCE_PENDING`、继续 `submitSumsubTxns`** ｜ PASS → 送检（不变）。今天两条 `holdAtGate0` 分支各自 `return` 在送检之前，是本波要改的那两行
- `markL1Hold` 不再 `updateStatus`、不再写 `DEPOSIT_HELD`——那条由 `holdIfHeld` 在合规通过后写（§3.1）。L1 快照仍在分流前落库（三条分支都留证据）
- 现有 `CAPABILITY_RESTRICTED / LIFECYCLE_NOT_ACTIVE` 两种行政级挂起走同一条路，**不单独处理**——它们和资产暂停是同一个形状
- 入金识别 `resolveAssetOrReject`（`inbound-transfer-signals.service.ts:576-596`）**不判 status**：按（网络, 合约）能识别就建单——钱已经在链上到了，这是 L1 打标的事，不是入口拒收的事；`UNKNOWN_ASSET` 拒收只针对不认识的币

**在途单不受影响**：暂停不碰已建的单（同 V6「`PROCESSING` 刻意无冻结入边、中途拦会造半截账」）。

**恢复之后**：运营对 OPERATION_PENDING 的单点 Release Hold（`waiveLimitHold` 已泛化到任何非空原因）→ `checkAutoApproval`（已接受 OPERATION_PENDING）→ 入账。暂停未解除时运营也能 waive——那是运营的裁量，不加规则。

**客户端**：三个页面 ACTIVE-only 下拉不变（暂停资产继续从下拉消失）。⚡ 入金模拟面板的资产来源改为**按当前充值地址所在网络列出全部状态的资产**（SUSPENDED 带标记）——它模拟的是链上世界，链上不认我方开关；今天 `Deposit.tsx:203` 只拉 ACTIVE、`:344` 从同一列表取 `selectedAsset`，暂停后面板里选不到 USDT，站 4 新一拍演不了。⚡ 面板取数直接打 `GET /assets`（不带 `status`，`assets.controller.ts:30-50` 的 `status` 本就是可选过滤）——**不新增端点**；资产状态是公开信息，暴露给客户端不触 tipping-off。

**SLA 口径不变**（交付清单「新状态要回答要不要计时」）：打了标的单仍在 `COMPLIANCE_PENDING` 计 5 分钟硬 SLA（等 Sumsub，超时转人工复核照旧）；合规通过进 `OPERATION_PENDING` 后计 24h 软 SLA（只置 `slaBreached`）。本波不新增任何状态，所以不新增任何计时格。

**钱**：本波不新增任何记账路径。V5 那笔入账仍走 `approveDeposit` 唯一出口（暂扣户 → 客户应付两步记账、资金单镜像，全是现成的），`verify:coa` 在收尾闸兜底。

### 2.3 状态机零改动

28 边守则单测不动；`OPERATION_PENDING` 的入边只经 `holdIfHeld`（合规通过后）；不给迟到裁决加边（按 §1 第 2 条该场景不存在）；`decideVerdictLanding` 不动。

## 3. 留痕补全（法一）

### 3.1 L1 拦下 / 挂起留痕

**提现 / 兑换 BLOCK**：两条新审计码 `WITHDRAW_L1_BLOCKED` / `SWAP_L1_BLOCKED`——出生即冻结四属性（domain 各自域、`correlationMode: N`、`requiredFields: ['reasonCode']`、`requiresCausation: false`），`assertActionSpec` 校验。写在 workflow 抛 `ForbiddenException` 之前：`outcome: DENIED`、`recordByActor` actorType `CUSTOMER`、主体 = 客户（单未建、无单号）、`reasonCode` = 第一条 FAIL 的 code、metadata 带全部 FAIL 项、**subjects 带 `RELATED` = 资产业务号、`INSTRUMENT` = 命中的限额规则号**、requestId 带随机位。今天两处 BLOCK **零审计**（`grep -n L1_GATE_BLOCKED -A8` 两个 workflow 均无 record 调用）——不只资产，九项任一项拦下都没痕，本条按「L1 拦下」整体补。

**充值挂起**：证据三段，对应三个持久化动作（交付清单「任何持久状态变化必写审计」——打标虽不换状态，`limitHoldReason` 与 `l1Snapshot` 都是落库的）：
1. **打标当刻**：新码 `DEPOSIT_L1_HELD`（DEPOSIT 域、`correlationMode: I`、`requiredFields: ['reasonCode']`、`requiresCausation: false`），`recordSystem`、无 from/to（状态没变）、`reasonCode` = 挂起原因、**subjects `RELATED` 资产号 / `INSTRUMENT` 规则号**、reason 写明「等合规」。KYT 若拒绝，这一行就是「暂停曾拦下它」的唯一审计证据
2. **合规通过后**：`holdIfHeld` 写的 `DEPOSIT_HELD`（已有）补 `fromStatus: COMPLIANCE_PENDING / toStatus: OPERATION_PENDING`、`reasonCode`、同一组 subjects
3. **运营放行**：`waiveLimitHold` 现有审计不动

现有 `CAPABILITY_RESTRICTED / LIFECYCLE_NOT_ACTIVE` 两种行政级挂起同样走这三段。充值 BELOW_MIN 从此也有按规则号可查的痕——规则号在 L1 评估时从限额门取（`gate.service.ts:46` 已有 `single.ruleNo`，出生打标处 `deposit-transactions.service.ts:1117` 今天不存规则号）；不再单写 `TRANSACTION_LIMIT_REJECTED`（那是拒绝语义，提现 / 兑换的 `gate.service.ts:108-120` 继续用）。

**第七幕怎么取证**：审计页的 **Subject No** 筛选（`AuditLogsPage.tsx:53`，服务端 `subjects.some`，`audit-logs.service.ts:1082`）按资产号 / 规则号能拉出被它拦下的单——站 4 ⑥ 的第六行。关键词搜索只覆盖主字段（`:530-539`），剧本必须写明用 Subject No 栏。

### 3.2 地址五门 DENIED 留痕

（本波新审计码合计 **4 条**：`WITHDRAW_L1_BLOCKED` / `SWAP_L1_BLOCKED` / `DEPOSIT_L1_HELD` / 本条。）一条新码 `WITHDRAWAL_ADDRESS_REQUEST_DENIED`（地址域、`N`、`requiredFields: ['reasonCode']`），`reasonCode` ∈ {`ADDRESS_LIMIT_REACHED`, `COOLING_PERIOD_NOT_EXPIRED`, `LAST_ACTIVE_FIAT_ADDRESS`, `ADDRESS_HAS_INFLIGHT_WITHDRAWAL`, `NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS`}。**写在 workflow 层**：主体层照抛（铁律③ 主体不写审计），workflow 捕获这五个 code 的 `BadRequestException` → 记 DENIED → 重抛；actor 按发起人（客户 `CUSTOMER` / 管理员）。`NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS` 在 `customer-access.service.ts:148` 那份是 L1 的 `TRADING_READINESS`，走 §3.1；`-workflow.service.ts:45` 那份是登记链上地址前的法币前置，走本条。

### 3.3 客户动作的 actor

地址 workflow 6 处 `recordSystem`（`withdrawal-address-workflow.service.ts:71/117/140/163/186/274`）中凡客户发起的（登记 / 取消 / 停用）改 `recordByActor({ actorType: 'CUSTOMER', actorNo: customerNo })`——先例 `swap-workflow.service.ts:448`、`customer-deposit-wallet.service.ts:80`；冷却到期扫描激活仍 `SYSTEM`。第七幕「谁登记了这个地址」不再答 SYSTEM。

### 3.4 requestId

地址 9 处补齐，模板 `<码>_<地址号>_<随机位>`（同 `DEPOSIT_SIGNAL_REJECTED_${randomUUID()}` 范式）；其余四块已齐，不动。

### 3.5 落地行 from/to

- 资产：`ASSET_SUSPENDED`（ACTIVE→SUSPENDED）、`ASSET_REACTIVATED`（SUSPENDED→ACTIVE）——今天只有 `beforeData`
- 地址：`WITHDRAWAL_ADDRESS_ACTIVATED / CANCELLED / SUSPENDED / UNSUSPENDED / DEACTIVATED` 按迁移表（`withdrawal-address-transitions.constant.ts`）填 from/to
- 费率：`SWAP_ / WITHDRAWAL_FEE_LEVEL_CREATION_APPLIED`（PENDING_APPROVAL→ACTIVE）；`*_RETIRED` 已带
- 值变更行（限额 `TRANSACTION_LIMIT_CHANGE_APPLIED`、费率 `*_CHANGE_APPLIED`）已带 before/after，不动——它们不换状态，没有 from/to

### 3.6 退役

actorId `COMPLIANCE_GATE_0` → `L1_GATE`（数据重铺，不留兼容）；`DEPOSIT_GATE0_PASSED` 已在 `DEPRECATED_AUDIT_ACTIONS`，退役码不改名。

## 4. 治疗单（② 档，站上看得见）

1. **冷却倒计时走秒**：`client-web/src/pages/WithdrawalAddresses.tsx` `formatCountdown()` 加 1s tick，到期后自动刷新一次列表（懒激活在查询时发生）
2. **提现页假规则句删**：`client-web/src/pages/Withdraw.tsx:928` "first withdrawal after changing security settings will be delayed by 24 hours"——本系统没有这条规则；规则来自限额表与地址簿冷却，页面不写死。三域对照：充值 / 兑换页 `grep "24 hours\|Min:\|delayed"` 无命中，假规则只在提现页这一处（`:917-928` 那块里 `:919`「follow the platform limits」是真话，留）
3. **地址详情动作按钮门控**：Force Suspend / Unsuspend / ⚡ Skip Cooling 按 `hasPermission(PERMISSIONS.WITHDRAWAL_ADDRESS_WRITE)` 显隐（先例 `RoleDetailPage.tsx:144`；钩子 `contexts/AdminSessionContext.tsx:123`）；今天 sm@ 看得到 Force Suspend、点了 403
4. **费率表单中文夹英文**：`SwapFeeLevelList.tsx:609/623`、`WithdrawalFeeLevelList.tsx:563/577` "全体客户（everyone）" → 英文
5. **兑换实时报价带客户身份**：`swap-transactions-customer.controller.ts:129-146` `getRate` 补 `@Request()`，把 `req.user.userId` 作 `ownerId` 传 `getExecutableRate`；等价性已证——`create`（`:151-152`）就是用 `req.user.userId` 建单，确认页价是对的。配一条行为测试：Grace 预览费用 = 确认页费用。全仓 `getExecutableRate` 只有定义与这一处调用，下单路径不走它
6. **管理台充值详情 Release Hold 提示重写**：`DepositTransactionDetail.tsx:244-258, 460-470, 762-765` 那句「This deposit was never submitted to Sumsub…」在送检之后是假话；按新流程写：合规已过、挂起原因 X、Release 即入账
7. **Gate 0 → L1 改名**：`deposit-workflow.service.ts`（36 处）、其 spec（43 处）、`DepositTransactionDetail.tsx` / `DepositTransactionList.tsx` 注释、`deposit-transactions.service.ts`、`demo-lib.ts`、三个 e2e 注释与 `gate0:` 哈希种子、`withdraw-workflow.service.ts:2261`；文档 `v4-deposit.md:64`、`PRODUCTION-NOTES:111/360`、`BACKLOG:137/139`（只改措辞）

## 5. 搭车（③ 档）

1. **死 import**：`AuditBusinessWorkflowTypes` 只 import 不用的 21 个文件全删该行（定义处 `audit-actions.constant.ts:89` 除外）；plan 按 HEAD 重数——波一期间从 13 长到 21，说明还在长
2. **`/dashboard` 旧树整棵删**：`admin-web/src/App.tsx:182-409`（含 `index` 与 `AdminHomePlaceholder` 的这一份挂载）；随之只被这棵树引用的 `PolicyChangeRequestsPage` / `PolicyChangeRequestDetailPage` 删（plan 前 grep 其他文件的引用与它们消费的 API 是否另有页面）；`/admin` 树 50 条路由与侧栏（92 处 `/admin` 跳转）不动
3. **`AssetProvisioningService`**：类、`assets.module.ts:20` 的 provider 注册、其 spec 删；`systemAccountCodesFor()` 纯函数留在原文件（种子唯一消费方）
4. **`verify:audit` 退役名单改 import 源常量**：`scripts/verify-audit.ts:82-99` 手抄 → `DEPRECATED_AUDIT_ACTIONS`，与 `verify-rbac.ts` / `verify-act1.ts` 同款
5. **S9 表伴生断言**：`verify-rbac.ts:506` `DETAIL_READ_GROUP_BY_POLICY` 与 `ApprovalDetailPage.tsx:86` `ENTITY_ROUTE_BY_ACTION` 键集相等（判例：手工维护的表必须配伴生断言）；机制 plan 定——admin-web 的 vitest 已有跨包 import 先例（`utils/restrictionCauseMeta.spec.ts:8` 直接 import 后端常量），把脚本里那张表抽成可 import 的 `.ts` 即可

## 6. 判据（真登录真 HTTP / 真状态迁移，禁扫源码文本）

`verify:act1` 接在 B14 之后加 V 组（约 10 条，25 条候选里只取本波改动触及的）：

| # | 判据 |
|---|---|
| V1 | 运营提暂停 USDT-TRON、CISO 批 → 客户 POST 兑换建单 → **403 `L1_GATE_BLOCKED`**；审计出现 `SWAP_L1_BLOCKED`（DENIED，reasonCode `ASSET_SUSPENDED`，subjects 含该资产号） |
| V2 | 同上 POST 提现建单 → 403 + `WITHDRAW_L1_BLOCKED` |
| V3 | 暂停期间喂入金信号 → 单建成、状态 **COMPLIANCE_PENDING**、`limitHoldReason = ASSET_SUSPENDED`、`l1Snapshot` 含 `ASSET_AVAILABILITY: FAIL`、`sumsubTxnId` 非空（已送检）；审计出现 `DEPOSIT_L1_HELD`（reasonCode `ASSET_SUSPENDED`，subjects 含资产号，无 from/to） |
| V4 | 喂「通过」裁决 → **OPERATION_PENDING**；`DEPOSIT_HELD` 带 from/to、reasonCode、subjects 资产号 |
| V5 | 提恢复、CISO 批 → 运营 Release Hold → **SUCCESS**，账本客户应付贷记（`verify:coa` 兜底） |
| V6 | 对照：恢复后同一客户建兑换单 → 201（防「门永远关」的伪绿） |
| V7 | 客户登记链上地址 → 审计 `actorType = CUSTOMER`、`requestId` 非空、PENDING_ACTIVATION |
| V8 | 同网络第 4 条地址 → 400 `ADDRESS_LIMIT_REACHED` + `WITHDRAWAL_ADDRESS_REQUEST_DENIED` 行 |
| V9 | Grace 报价预览费用 = 确认页费用（VIP 档）；Alice 命中默认档 |
| V10 | 审计 `subjectNo = <资产号>` 查询 → 能拉出 V1 / V4 的行（取证路径本身进判据） |

静态：`verify:audit` 退役名单来自源常量（S）；S9 伴生断言（vitest）。`verify:rbac`：确认 V3 端点探针已覆盖「提现地址写只金库、资产写只运营」，缺则补。运行顺序照 `demo/baseline.md`：`verify:rbac` → `verify:act1` → reset → `demo:all`。

## 7. 剧本与文档

- **站 2 ④**：报价预览即对照（§4.5 修后讲解词成立），不改结构
- **站 4**：④ 讲解词改成完整句——「暂停之后，客户选不到它，绕过界面直接打接口也做不成新交易；已经在路上的钱照走完，已经到账的钱照收」；⑥ 取证改用 **Subject No** 栏；新 **⑦**：暂停中切客户端 alice ⚡ 喂一笔 USDT 入金 → 管理台看单 COMPLIANCE_PENDING、L1 十项面板资产格红 → ⚡ 喂通过 → OPERATION_PENDING（挂起原因 ASSET_SUSPENDED）→ 运营提恢复、CISO 批 → Release Hold → 入账，账本页看客户应付
- **站 5 ④**：倒计时走秒
- **modules**：`v3-financial-config.md` §1 资产段重写（硬门在 L1，不再写「后端没有资产状态门」）；`v4-deposit.md` §1「进门三步」改口（L1 打标不换状态、L2 照筛、合规通过后才挂起）、§2 表、§5 缺口销；`v5` / `v6` 措辞统一 L1；`overview.md` 加 L1 / L2 定义一句
- **decisions**：本 spec §1 四条已落；`:21` 已注翻案
- **BACKLOG 销账**：`:20`（报价身份）、`:23`（资产硬门）、`:129`（行政挂起入账路径）、`:131`（随 129）
- **TOOLING-DEBT:114 销** + 规则写进 `CLAUDE.md §10` 一行：合并进 main → 重启后端 + `db:base:sync`；改了 schema / seed 再 reset
- `demo/data.md` 种子无改动不动；`CHANGELOG` 一行

## 8. 闸门与收尾（对照 `rules/delivery-checklist.md`，全部适用）

- 随手闸 ①②③④⑤；**改了前端必截图**：站 4 新一拍全程、站 5 倒计时、报价预览对照
- jest：`deposit-transactions` 目录全绿（28 边守则单测）、`l1-gate.service.spec`、地址 workflow spec、`swap-transactions-customer` 报价测试
- e2e：`deposit-sumsub-verdicts`（驱动 L1 的套件，改分流后必跑）、`withdraw-money-arcs`、兑换相关；11 套照 baseline 顺序，e2e 前单独 reset
- 收尾闸 ⑥ `demo:all` + `verify:act1` + `verify:rbac` + `verify:audit` + `verify:demo-data`；⑦ `verify:coa`（V5 入账动了钱）；⑧ 本波不动 schema / 迁移 / seed（新审计码不是 schema）——仍在干净库跑一次 `demo:all`
- **终审必问「每条承诺的代码在哪」**（波一判例）：本 spec §2–§5 每条在 plan 里都要有任务号，终审逐条对
- 合并后：重启主栈 + `db:base:sync`——本波把它写进章程，自己先遵守
- 本任务是多波中的最后一波：合并后总纲与本文一起归档，`CHANGELOG` 一行

## 9. 假设与开放（业主可推翻）

- **客户面对挂起单不可见沿用现状**：任何 `limitHoldReason` 非空的单客户端 404（`deposit-transactions.service.ts:606-616`），直到处置完成。暂停期间打进来的钱在客户端看不见，站 4 ⑦ 只从管理台讲
- 运营 waive 时客户仍受限 → 原地不动（既有，§0.4）
- 暂停未解除时运营可 waive（裁量，不加规则）
- L1 冻结分支零审计不在本波（§0.4）

## 10. 交付清单命中表（`rules/delivery-checklist.md` 逐行过；plan 的每个任务从这里抄「本任务过哪几条」）

| 清单触发 | 本波命中？ | 落在哪 |
|---|---|---|
| 任何持久状态变化 → 写审计（编排层、显式 requestId） | **命中** | §3.1 三段（含打标当刻的 `DEPOSIT_L1_HELD`）、§3.2、§3.4 地址 9 处 requestId 补齐 |
| 新增审计动作码 → 出生冻结四属性 + `assertActionSpec` | **命中，4 条** | §3.1 / §3.2 逐条写了 domain / correlationMode / requiredFields / requiresCausation |
| 新状态 / 新结局 → 迁移表加边 + 要不要计时 | **不命中**（零新状态） | §2.3 零改动；§2.2「SLA 口径不变」回答了计时 |
| 动了钱 → 同步直调记账、资金单 1:1、不新增科目 | **不新增**（复用 `approveDeposit`） | §2.2「钱」；收尾闸 ⑦ `verify:coa` 仍跑 |
| 该走 maker-checker → `ApprovalsService` 正门 | **不新增**（暂停 / 恢复审批现成；Release Hold 是既有单人动作） | §2.2 |
| 新增审批策略 → `MAKER_GROUP_BY_POLICY` 加行 | 不命中 | — |
| 新增权限组 → 四处齐 | 不命中 | — |
| 新增 admin 端点 → `route()` + sync + 重启 | 不命中（⚡ 面板复用 `GET /assets`） | §2.2；本波反倒把「合并后重启 + sync」写进章程（§7） |
| 新增业务动作 → 前端要有入口 | **命中** | ⚡ 面板列全部状态资产（§2.2）；Release Hold 对任意挂起原因可用（既有） |
| 退役业务动作 → 前端入口同步删 | **命中** | `/dashboard` 树与两张死页同删（§5.2）；Gate 0 只是改名不是动作 |
| 改了交易三域任一 → 问另外两个 | **命中，已问** | L1 留痕三域对称（两条 BLOCK 码 + 充值三段）；假规则文案只在提现页（§4.2） |
| 新字段 / 新状态到客户面 → 当场决定看不看得到 | **命中，已决** | 暂停资产在 ⚡ 面板可见（公开信息）；L1 BLOCK 对客户仍是中性文案；挂起单对客户不可见沿用现状（§9） |
| 涉及金额 → 最小单位存 | 不命中 | — |
| 对外识别 → 业务键 | **命中** | 审计 subjects 用资产业务号 / 规则号（§3.1）；`assetIds` 只在服务内部 |
| 新事件 → 先登记 | 不命中（零新事件） | — |
| 改 schema → 迁移文件 | 不命中（新审计码不是 schema） | §8 |
| 改页面或种子 → 同步 `demo/data.md` + `demo/script.md` | **命中** | 站 2 / 4 / 5 改写（§7）；种子不动，`data.md` 不动 |
| 改了前端 → preview + 截图 | **命中** | §8：站 4 ⑦ 全程、站 5 倒计时、报价预览、地址详情按钮显隐 |
| 多波中的一波 → 承接写进下一波 | **末波** | 无下一波；合并后总纲与本文归档，`CHANGELOG` 一行（§8） |
| 每轮收尾 → 文档分层 + `CHANGELOG` + `BACKLOG` 销账 | **命中** | §7 |
| 永不豁免 ①截图 ②`verify:coa` | **两条都过** | §8 |

