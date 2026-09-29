# 公司资金（注资 · 供应商付款 · 全景看板）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-09-29（战役乙波二：注资·付款·全景看板落地）
> 演示幕次：场景 28 / 29 / 30（暂编，战役乙收官定稿）｜ 验收：`demo/script.md` 场景 28/29/30 + 本篇 §4

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
| 看看板 | 金库 / CFO / 高管 / 内审（四职务） | — | 纯只读一屏，无任何操作按钮 |

## 4. 演示脚本

场景 28（注资全弧：开单→CFO 批→⚡模拟打款→确认入账→看板 F_OPS 涨）、场景 29（付款全弧：选 HexTrust→CFO 批→⚡推出款→看板 F_OPS 降）、场景 30（看板五区巡览 + 账本三列表同源同值对照 + 现场客户兑换看三收入格实时涨）——步骤在 `demo/script.md`（暂编，战役乙收官定稿）。

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

## 6. 演示缺口（BACKLOG 有账）

- 账本科目页（`LedgerAccountList.tsx`）`code≠currency` 资产（USDT-TRON 类）小数位显示错，根因是服务层接口命名误导（`assetCurrency` 参数实际收的是 `asset.code`）——本波新页 `CompanyFundsDashboard` 已自保不复发，旧页仍受影响，走查现场两页数字不一致可当场对照，登 `BACKLOG.md` §M
- 兑换单资金单腿在管理台没有任何非超管角色能完整推完（前端面板门控组 `FUNDS_ORDER_PUSH_WRITE` 与后端真实端点所需 `TRADING_SWAP_WRITE` 不是同一组，金库/运营各持一半）——本波场景 30 走查现场实测发现，借道超管取证，登 `BACKLOG.md` §E，业主定谁来补齐
