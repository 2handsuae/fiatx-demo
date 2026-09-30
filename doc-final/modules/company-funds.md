# 公司资金（注资 · 供应商付款 · 全景看板）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-09-30（战役乙波三：审慎红线与巡检 + 穿底主线收口，随第九幕定稿）
> 演示幕次：第九幕「公司的钱」场景 28-32 ｜ 验收：`demo/script.md` 场景 28-32 + 本篇 §4

## 0. 一句话定位

管**公司自己的钱从哪来、怎么花、家底怎么一屏看清**这三件事。迄今所有戏都围着客户资金转（客户充值、客户提现、客户兑换）；本篇回答「公司自己的钱进门（注资单）、公司自己的钱出门（供应商付款单）、公司资金全景（看板五区）」——是 V7 财资域下的第三、第四类订单（第一类是内部划转单、第二类是 LP 兑换单，见 `v7-treasury.md`、`lp-desk.md`）。三者同属公司资金域，注资/付款/看板是本篇；LP 兑换是找场外对手方补货，另篇。

## 1. 业务叙事

**注资单把「开张那笔钱」变成一张能反复开的运行时单据。** 种子铺过一次资本注入原型（DR FIRM_ASSET / CR FIRM_OPS，码 70），这是"公司刚开业时账上已经有钱"的既成事实；注资单让这件事可以在演示当场再发生一次——金库填出资方名称、币种金额、审慎管理目的，CFO 单步批，出资方把钱打进来，金库核对「应到 vs 实到」后确认，运营户余额才真的涨。**先批不等于钱到，钱到不等于账落**——批准（`AWAITING_FUNDS`）与到款（`RECEIVED`）与确认（`SUCCESS`）是三个不同的时点，看板在这几个时点之间的数字变化，就是这条业务规则最直观的证据。

**供应商付款单是公司花钱的另一面。** HexTrust 的托管月费是演示代表——公司→外部单腿出，同样金库开单、CFO 批。收款方**只能从外包商登记册（甲波四立的那本册）下拉选**，不接受自由填地址；选不到在册且 `ACTIVE` 的供应商，单据开不出来。这条边把"两个战役的活真的接上了"这句话坐实：付款单不是凭空造一个收款方，是真的去读甲波四那本册。批准之后钱不会立刻走，要等金库把出款资金单推完（`⚡ Submit → ⚡ Settle`），付款单才转 `SUCCESS`、落账码 87。

**看板是给管理层看家底的一屏。** 运营户各币种水位（带见底阈值线——水位跌破这条线，就是"该去找 LP 补货"的信号，串到 `lp-desk.md` 的动机）、LP 在途待验收（读 `FIRM_LIQ` 科目）、结算在途（读 `FIRM_SET` 科目）、三收入格（210/211/212，即"利润体现"——客户每兑一笔、每提一笔、每享受一次其他服务，这三格就实时涨一点）、最近资金动态（最近 10 条账本流水，人话事件标签）。**看板不是另建一套真相，是把既有账本端点（`GET /admin/tb/accounts`、`GET /admin/tb/account-flows`）换了个一屏能看完的排版**——零新增后端聚合逻辑，数字与账本三列表（科目/凭证/流水）同源同值。

**审慎管理目的字段是 8 年安全港记录的地基。** 注资单、付款单都必填这个字段——不是装饰性文本框，是 VARA 场景下的合规叙事起点，B2（波三）只做叙事收口，不需要返工建表。

## 2. 状态机

### 2.1 注资单（CapitalInjection）—— 六态五边

```
PENDING_APPROVAL ──approve(CFO)──▶ AWAITING_FUNDS（等出资方打款）
PENDING_APPROVAL ──reject/timeout──▶ REJECTED ｜ ──cancel(金库,待批时)──▶ CANCELLED
AWAITING_FUNDS ──⚡模拟出资方打款(写回单)──▶ RECEIVED（已到款待确认）
RECEIVED ──confirm(金库,确认入账)──▶ SUCCESS（落账码 70，运营户直进，不过前厅——前厅是 LP 专用）
```

无余额闸（钱是进项）、无 `FAILED` 态（进项 ⚡到款在演示里不会失败；审批过期归 `REJECTED`，照 LP 档案 reject/timeout 同边）。确认边是显式动作：界面并排「Expected（应到）vs Received（实到）」，纯展示核数、零逻辑分支（不为想象中的"金额不符"分支写代码）。

### 2.2 供应商付款单（VendorPayment）—— 六态六边

```
PENDING_APPROVAL ──approve+余额闸过──▶ EXECUTING（建出款资金单）
PENDING_APPROVAL ──approve+运营户余额不足──▶ FAILED（不建资金单，照 LP/划转单先例）
PENDING_APPROVAL ──reject/timeout──▶ REJECTED ｜ ──cancel(金库,待批时)──▶ CANCELLED
EXECUTING ──⚡推出款确认(回单先于落账)──▶ SUCCESS（落账码 87） ｜ ──腿失败──▶ FAILED
```

单腿出（`DR FIRM_OPS / CR FIRM_ASSET`），照 LP 兑换单卖出腿同形；回单一律先于落账（波一 T5 订正纪律的延续）。开单守卫=外包商 `status='ACTIVE'`。

## 3. 决策点与角色

| 动作 | 谁发起 | 谁裁决 | 要点 |
|---|---|---|---|
| 开注资单 | 金库（Capital Injections 页） | CFO 单步 | 出资方名称一行文本，不立主体（设计 §6 不做） |
| ⚡ 模拟出资方打款 | 金库（详情页） | — | `AWAITING_FUNDS → RECEIVED`，写模拟托管回单 |
| 确认入账 | 金库（`RECEIVED` 态详情页） | — | Expected/Received 并排，纯核数；确认即触发落账，不是第二道审批 |
| 撤回 | 金库（待批时） | — | 执行中不许撤 |
| 开付款单 | 金库（Vendor Payments 页，守卫=收款供应商 `ACTIVE`） | CFO 单步 | 下拉选供应商 + 收款账户坐标 + 事由 + 审慎目的 |
| ⚡ 推出款 | 金库（资金单页，模拟门控） | — | 法币两步 `Submit → Settle` |
| 看看板 | 金库 / CFO / 高管 / 内审（四职务） | — | 一屏家底；金库视角另有巡检按钮（见 §7），对 CFO/高管/内审纯只读 |

## 4. 演示脚本

场景 28（注资全弧：开单→CFO 批→⚡模拟打款→确认入账→看板 F_OPS 涨）、场景 29（付款全弧：选 HexTrust→CFO 批→⚡推出款→看板 F_OPS 降）、场景 30（看板五区巡览 + 账本三列表同源同值对照 + 现场客户兑换看三收入格实时涨）、场景 31（⚡穿底：托管失窃→定性→定损→认损调账→补款划转→客户池复原，收尾双线齐红）、场景 32（审慎红线：巡检抓红→门拒付款单三个数→CFO 登记审慎事故→定损→报送 VARA→注资复原→巡检转绿→两事故结案→两报送单提交）——步骤在 `demo/script.md` 第九幕「公司的钱」，均已在 self 栈全程实走并留证。

## 5. 关键技术节点

- 主体 `src/modules/asset-treasury/company-funding/`：注资单主体（六态迁移表）、付款单主体（六态迁移表）；工作流层各自的发起 / ⚡模拟到款 / 确认（注资）与发起 / ⚡推出款（付款）
- 审批类型 `CAPITAL_INJECTION_APPROVAL` / `VENDOR_PAYMENT_APPROVAL`（均金库提 / CFO 单步 / 48h / 可撤，白名单表已登记）
- 转账码：注资复用既有 70（`CAPITAL_INJECTION`）；付款新开 87（`VENDOR_PAYMENT`，本波唯一新码）；资金单第六父键 `capitalInjectionId`、第七父键 `vendorPaymentId`
- COA：零增删（10 码内做完，铁律⑤），注资 `DR FIRM_ASSET/CR FIRM_OPS`、付款 `DR FIRM_OPS/CR FIRM_ASSET`
- 审计：TREASURY 域新增 12 码——注资族 6（`CAPITAL_INJECTION_{REQUESTED,APPROVED,FUNDS_RECEIVED,CONFIRMED,REJECTED,CANCELLED}`）、付款族 6（`VENDOR_PAYMENT_{REQUESTED,EXECUTION_STARTED,EXECUTED,FAILED,REJECTED,CANCELLED}`）
- 权限：`treasury.view_dashboard`（`FUNDING_DASHBOARD_VIEW`，金库/CFO/高管/内审四职务，另以 OR 挂 `GET /admin/tb/accounts` 两路由作路由锚）、`treasury.view_funding`（`FUNDING_READ`，金库/CFO/内审三职务，照 `LP_READ` 先例）、`treasury.act_funding`（`FUNDING_WRITE`，唯金库）；前端另有一枚 `MARKER` 型标记码 `cap.treasury.funding_dashboard`（仿 `cap.incident.*` 先例，零真实路由，纯前端路由/导航门控——因 `GET /admin/tb/accounts` 本身被 `LEDGER_ACCOUNT_READ` 覆盖、持有者含技术官/运营，若看板直接借道这个既有码会把非目标职务一并放行，故新增专属标记码）
- 端点：`admin/capital-injections`（list/create/detail/cancel/simulate-contribution/confirm）、`admin/vendor-payments`（list/create/detail/cancel）；看板零新端点，纯前端组装既有 `GET /admin/tb/accounts`、`GET /admin/tb/account-flows`
- 表 `capital_injections` / `vendor_payments`（reset 登记已补）；admin-web 三页 `CapitalInjectionList/Detail`、`VendorPaymentList/Detail`（Treasury 导航组）、`CompanyFundsDashboard`（阈值常量单独文件 `companyFundsThresholds.ts`，AED 900,000 / USDT 100,000，实测线上方钉死）
- 金额换算：看板独立实现 `companyFundsFormat.ts`（`currencyOf()` 统一收敛 `asset.code`/`asset.currency` 两种键形态，`formatMinorToMajor`/`isBelowThresholdMinor` 均 BigInt-safe，不经 `Number()`）——不复用、不复发 `LedgerAccountList.tsx` 的既有 decimals 显示缺口（见 §6 与 `BACKLOG.md` §M）
- **审慎模块（战役乙波三）** `src/modules/asset-treasury/prudential/`（constants + service + controller）：`prudential.constants.ts` 定义 `MONTHLY_OPEX_BASE_MINOR`（月开支基数，1,000,000.00 AED）+ `NLA_FLOOR_COEFFICIENT=1.2`（不可配）；汇率单源 `binance-rate.provider.ts` 导出命名常量 `AED_USD_PEG_RATE=3.6725`，provider 原逻辑与审慎服务同源引用；`PrudentialService.computeStatus()` 纯读、`assertPostOutflowCompliant()` 供两个提单口调用
- 审计：TREASURY 域再新增 2 码——`PRUDENTIAL_CHECK_PERFORMED`（巡检，PASS/BREACH 同码以 `reasonCode` 区分——`NLA_OK`/`NLA_BREACH`，`outcome` 恒 `SUCCESS`）、`PRUDENTIAL_GATE_BLOCKED`（门拒，outcome=DENIED，metadata 记三个数）
- 权限：`treasury.prudential_check`（`PRUDENTIAL_CHECK_WRITE`，唯金库，Treasury 域 14→15 桶）；`GET /admin/prudential/status` 挂既有桶 `treasury.view_dashboard`，零权限扩张
- 端点：`GET /admin/prudential/status`（只读，看板取数）、`POST /admin/prudential/check`（巡检，写审计+返回 status）
- **兑换腿修复（丙案）**：`rbac.catalog.ts:435` 该路由 `groups` 从 `['TRADING_SWAP_WRITE']` 改挂 `['FUNDS_ORDER_ACT']`——「推资金单腿归金库」2026-09-10 定案的顺延，端点挂错组才是病根；面板可见性（`FUNDS_ORDER_PUSH_WRITE`）与端点权限自此同源，`BACKLOG.md` §E 该条销账

## 6. 演示缺口（BACKLOG 有账）

- 账本科目页（`LedgerAccountList.tsx`）`code≠currency` 资产（USDT-TRON 类）小数位显示错，根因是服务层接口命名误导（`assetCurrency` 参数实际收的是 `asset.code`）——本波新页 `CompanyFundsDashboard` 已自保不复发，旧页仍受影响，走查现场两页数字不一致可当场对照，登 `BACKLOG.md` §M
- ~~兑换单资金单腿在管理台没有任何非超管角色能完整推完~~——**已修（战役乙波三丙案，见 §5）**，`BACKLOG.md` §E 该条已销账

## 7. 审慎红线与巡检（战役乙波三，2026-09-30）

**口径公式**：`NLA = F_OPS(AED) + F_OPS(USDT) × AED_USD_PEG_RATE 折 AED`；`红线 = NLA_FLOOR_COEFFICIENT(1.2) × MONTHLY_OPEX_BASE_MINOR`（候选月开支基数 1,000,000.00 AED → 红线 1,200,000.00 AED，写死常量，不建配置面）。`FIRM_SET`/`FIRM_LIQ` 在途**不计入 NLA**——保守口径：未验收落定的钱不算流动，LP 悬空期、结算在途期 NLA 会因此下探，这是真实的审慎细节而非疏漏；三收入科目**不计入**——损益口径不是钱包水位。这份公式照 Company Rulebook VI.C.1/C.2/C.4 一手核（`reference/research/2026-07-06-v7-treasury-research.md:16`）：NLA ≥ 1.2×月开支、只准现金等价物+锚定 VA。

**门（算术门，L1 式拒建单+留痕）**：付款单发起、LP 兑换单发起两个提单口，创建时算「动后 NLA 还达标吗」，不达标 400 拒建单（单未建、无单号），拒单话术明说三个数——当前 NLA / 动后 NLA / 红线——并落 `PRUDENTIAL_GATE_BLOCKED` 审计。检查只在发起时算一次（单人顺序假设，审批时不复检）。

**豁免立场（业务立场，非遗漏）**：内部划转（补款/垫款——对客户的义务性动作）与注资（进项）**刻意不插门**；既有余额闸各管各的、不叠加。这是场景 31/32 全程的成立前提——客户资金事故的补款划转、审慎事故自己的注资复原，均需要能在 NLA 已跌破红线的窗口内照常发起成功，"补偿客户的义务优先于公司自己的流动性缓冲"不是纸面条款，是这两笔单据在跌破窗口内真实发起成功这件事本身。

**巡检（跌破检测形态）**：「每日核对」的演示替身——金库在看板点「Run prudential check」，`POST /admin/prudential/check` 实算 + 写 `PRUDENTIAL_CHECK_PERFORMED` 审计（PASS/BREACH 同码，以 `reasonCode`（`NLA_OK`/`NLA_BREACH`）区分，`outcome` 恒 `SUCCESS`），零新表，「每日核对有据可查」由审计日志承担。看板另有被动红横幅（全员可见，读 `GET /admin/prudential/status`，不依赖巡检按钮）。**事故不自动生成**——巡检抓红后由 CFO 亲手登记 `PRUDENTIAL_BREACH`，操作人留痕（铁律①）。

**按钮修订注记**：波二 §5「看板本身不设操作按钮」的陈述本波修订——巡检按钮是真实业务动作（每日核对的替身），不挂 ⚡ simulation 门控。甲战役 E5 判语否决的是「NLA 每日核对 cron 引擎」本体，不是巡检本身；巡检按钮归属**金库**（新桶新组唯金库持有），形成「金库巡检发现红 → CFO 登记审慎事故」两人接力。

**8 年安全港叙事收口**：注资单、付款单、LP 兑换单三类新单据（波一波二建表即带）的「审慎管理目的」字段 + 巡检审计记录，共同构成审慎管理决策留痕链——8 年留存本身是组织制度层（系统外，业主判定），系统面只负责产生这些可留存的记录，不建独立的留存/归档机制。

**穿底主线（场景 31/32）**：见 §4；账实证据见 `demo/script.md` 场景 31/32 尾注（`verify:coa` 全程绿、TB 直读互证）。
