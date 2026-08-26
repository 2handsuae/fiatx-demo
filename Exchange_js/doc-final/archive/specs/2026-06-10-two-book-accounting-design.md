# 两本账记账体系 — 设计 spec

日期:2026-06-10(2026-06-11 科目改名:CLIENT_CREDIT→CLIENT_PAYABLE、CLIENT_AUDIT→DEPOSIT_SUSPENSE、FIRM_OPS→FIRM_TREASURY,编码不变)
状态:已与产品对齐(脑暴五节逐节确认),待实施
前置:Model A 法币净额结算(spec 2026-06-09,已落地 commit 2144d84)

> **⚠️ 实现漂移修正(2026-06-21,以 live code 为准)**:本 spec 写定后落地代码有 4 处偏离,讲解/实现以此为准——
> 1. **结算/费用路由钱包 = `F_OPS`(非 `F_LIQ`)**:法币本金 `C_VIBAN↔F_SET↔F_OPS`、crypto 本金 `C_MAIN↔F_OPS`、swap 费 `F_OPS→F_FEE`;`F_LIQ` 退出结算路径(仍是 FIRM_TREASURY 名下钱包,§2 COA 合并视角不变)。源 `internal-transfer-paths.constant.ts`。下文 §4 `F_LIQ→F_FEE` 即 `F_OPS→F_FEE`。
> 2. **结算批 6 型 `settlementType`**:`{FIAT|CRYPTO}_{PRINCIPAL|WITHDRAW|SWAP}`(本金/提现费/兑换费),兑换费 accrual 拆 `SERVICE_FEE+SPREAD`。源 `settlement-type.constant.ts`。
> 3. **§7 每日对账 I1–I5 已被取代**:对账重构(spec `2026-06-20-reconciliation-redesign-design.md`)用 **credit-net 五公式**(客户/桥/公司三块,贷正借负 Σ=0)替代 I1–I5;其中 **式2 客户勾稽加项** `= OPEN Outstanding net − 未去混同提现费`。
> 4. **LP 平盘(§6.2,FX_REALIZED_PNL)本期不做**:头寸保持开口、只留 FX_UNREALIZED 浮盈。

---

## 1. 背景与目标

现有 TB 账本只有资产/负债两类科目,公司收入全部挂在 `FEE_RECEIVABLE` 临时负债上,靠 drain 逻辑搬运;swap 的跨币种清算没有归宿,`TRADE_CLEARING` 永远清不干净;公司的 FX 头寸、浮动损益、已实现损益在账上完全不可见。

本设计把账本重定为**两本账**:

- **客户账本(safeguarding)**:每币种 native 记账,严格 A=L,只反映"客户的钱在哪、欠客户多少"。
- **公司账本**:公司自有资金、FX 头寸、三桶损益(做市收入 / FX 浮动 / FX 已实现)、资本与留存收益。

三个已对齐的顶层决策:

| 决策 | 结论 |
|---|---|
| 公司账本载体 | **同一个 TigerBeetle,扩 E/R 编码段**(单一事实源,linked-transfer 原子,无双写) |
| FX 范围 | **全套三桶**:换汇户+清桥、每日重估、已实现科目与平盘规则一次定死 |
| 实施策略 | **一刀换血**:零兼容层,FEE_RECEIVABLE 直接删,重建 DB + reseed 验收 |

记账总原则:

1. **native 记账**:每个科目按 `(code, ledger)` 每币种独立,记什么币用什么币,**逐笔不折算**。
2. **折算只发生在两处**:EOD 重估(给 FX 头寸标市值)和报表层(折 AED 出净值)。
3. **唯一跨币点**:EOD 清桥(`TRADE_CLEARING → FX_POSITION`),每笔 swap 自带成交价 r₀,清桥是"加总",不挑任何汇率。
4. **利润 T1 确认**:fee 和 spread 在成交/锁定时刻进收入科目(swap 直接 posted;提现走 two-phase pending,成功才 post)。
5. **结算腿只搬实物**:客户池 ↔ 公司池,不碰桥;桥的清算独立在 EOD。

---

## 2. COA 重定(科目总表)

编码段按 class 划死:**A 资产 1–99 / L 负债 100–199 / E 权益 200–299 / R 损益 300–399**。
A 段内子段:1–49 客户资金形态、50–99 公司自有。
COA 字符串沿用 `<CLASS>.<KEY>`(如 `A.FIRM_TREASURY`、`R.FEE_INCOME`),`COA_TO_TB_CODE` 同步重写。

| Code | 科目 | Class | 账本 | Owner | Ledger | 说明 |
|--:|---|:-:|---|---|---|---|
| 1 | `CLIENT_BANK`(原 BANK 改名) | A | 客户 | SYSTEM | 法币 | 客户资金池·银行侧 |
| 10 | `CLIENT_CUSTODY`(原 CUSTODY 改名) | A | 客户 | SYSTEM | 虚拟币 | 客户资金池·托管侧 |
| 50 | `FIRM_TREASURY` 新增 | A | 公司 | SYSTEM | 全部 | 公司自有资金(物理 F_OPS/F_LIQ/F_SET/F_FEE 的合并视角) |
| 60 | `FX_POSITION` 新增 | A·双向 | 公司 | SYSTEM | 全部 | 换汇户:FX 头寸,每币种一条腿,native 挂账,LP 平盘时清 |
| 100 | `CLIENT_PAYABLE` | L | 客户 | CUSTOMER | 全部 | 客户 claim(不动) |
| 101 | `DEPOSIT_SUSPENSE` | L | 客户 | CUSTOMER | 全部 | 充值两步审计户(不动) |
| 110 | `TRADE_CLEARING` | L·双向 | 桥 | SYSTEM | 全部 | swap 桥,EOD 清(科目不动,清算规则重做) |
| ~~120~~ | ~~`FEE_RECEIVABLE`~~ | — | — | — | — | **删除** |
| 200 | `PAID_IN_CAPITAL` 新增 | E | 公司 | SYSTEM | 全部 | 实收资本,seed 注资时贷 |
| 210 | `RETAINED_EARNINGS` 新增 | E | 公司 | SYSTEM | 全部 | 留存收益:期末结转归宿。本期只建科目,不做自动结转,报表层算累计 |
| 300 | `FEE_INCOME` 新增 | R | 公司 | SYSTEM | 全部 | 手续费收入,native(收什么币记什么币) |
| 310 | `SPREAD_INCOME` 新增 | R | 公司 | SYSTEM | 全部 | 点差收入,native,T1 认 |
| 320 | `FX_UNREALIZED_PNL` 新增 | R·双向 | 公司 | SYSTEM | 全部 | FX 浮动损益:每日 EOD 整仓重标,昨日 mark 被覆盖,可负 |
| 330 | `FX_REALIZED_PNL` 新增 | R·双向 | 公司 | SYSTEM | 全部 | LP 平盘已实现损益:平盘锁定,永不回转 |

**三个利润侧科目的语义**(对齐记录):

- `RETAINED_EARNINGS`:R 科目是"今年的流水账",它是"历年的存折"。期末结转 `借 各R科目 / 贷 RETAINED_EARNINGS`,本期不自动化。
- `FX_UNREALIZED_PNL`:囤的币纸面盈亏,每天重算、会回转、没平盘前不算数。
- `FX_REALIZED_PNL`:卖给 LP 那刻锁定的真实盈亏,永久。

**配套规则**:

- 两本账隔离:safeguarding 报表 = {1,10,100,101,110};公司报表 = {50,60,200段,300段}。同一 TB cluster,按 code 段过滤。
- TB flags:`FX_POSITION`、`TRADE_CLEARING`、`FX_UNREALIZED_PNL` 不设借贷方向约束;其余沿用现有约束。
- 期初 bootstrap:seed 时每币种 `借 FIRM_TREASURY / 贷 PAID_IN_CAPITAL`,金额与 funds-layer 系统钱包(F_OPS/F_LIQ)的 seed 余额对齐——物理钱包与 TB 第一天就账实相符。

---

## 3. 充值记账(语义不动,只改名)

充值是**纯客户账本事件**,公司账本零参与。

```
T0 入账侦测(链上确认/银行到账,放行前):
   借 CLIENT_CUSTODY|CLIENT_BANK / 贷 DEPOSIT_SUSPENSE(CUSTOMER)
T1 合规放行:
   借 DEPOSIT_SUSPENSE / 贷 CLIENT_PAYABLE
```

- 每步客户账本 A=L 严格成立。
- 物理归集 `AGGREGATE C_DEP→C_MAIN` 不触 TB(同池内倒手)。
- 改动量:仅科目改名映射(`BANK→CLIENT_BANK`、`CUSTODY→CLIENT_CUSTODY`)。
- 将来加充值费 → 复用提现 fee 模式,COA 不动。

---

## 4. 提现 + 提现结算记账(fee 侧重做)

核心变化:fee 不再挂 FEE_RECEIVABLE,改走 **TB two-phase pending 直通 `FEE_INCOME`**。

```
T0 申请(锁定,两笔 PENDING):
   Pending① net:借 CLIENT_PAYABLE / 贷 CLIENT_BANK|CLIENT_CUSTODY
   Pending② fee:借 CLIENT_PAYABLE / 贷 FEE_INCOME

T1a 打款成功:POST ①② —— net 实物出池;fee 收入此刻正式确认
T1b 失败/退回:VOID ①② —— 客户余额原样恢复,收入从未存在,零冲销代码

T2 去混同(fee 实物从客户池搬公司池):
   借 FIRM_TREASURY / 贷 CLIENT_BANK|CLIENT_CUSTODY(金额 = fee)
   · 法币:提现成功即时,FIAT_FEE_COLLECT C_VIBAN→F_FEE,funds-flow CLEAR 时记
   · 虚拟币:EOD/CRON 批量,FEE_COLLECT C_MAIN→F_OPS,Σ未归集 fee 轧差一笔,CLEAR 时记
```

**配套规则**:

- 混同窗口不变量:T1a→T2 之间,每币种 `客户池实物 − Σ客户claim = 未归集 fee`;归集后回落 0。
- 归集金额口径:**Σ已成功、未归集的提现 fee(Prisma 查询 + sourceId 幂等标记)**,不再读 TB 挂账余额。drain-FEE_RECEIVABLE 逻辑整体删除。
- 公司内部物理倒手(`F_LIQ→F_FEE`、`F_SET` 中转)两端都是 FIRM_TREASURY,**TB no-op**,对应 drain 钩子删除;InternalTransaction 保留物理审计轨迹。
- 提现物理路径(FUND_OUT/FUND_RETURN/fiat 两跳 route)全部不动,只动 TB 记账层。

---

## 5. 兑换 + 兑换结算记账

### 5.1 计价口径(成交时快照锁死在 swap 行)

```
mid 值 = fromAmount × r₀(成交参考中间价)
gross  = fromAmount × 报价率(r₀ × markup)
spread = mid 值 − gross          ← 底数是 mid
fee    = gross × fee%(取 min)    ← 底数是 gross
net    = gross − fee
恒等式:net + fee = gross;gross + spread = mid 值
```

(spread 与 fee 底数不同,即使同为 2% 也不相等。)

### 5.2 T1 成交(4 笔,原子 linked transfers,直接 posted)

swap 无退路(from 币已锁死),无需 pending。

| # | 分录 | 金额 | 对比现状 |
|--|---|---|---|
| ① | 借 `CLIENT_PAYABLE(from)` / 贷 `TRADE_CLEARING(from)` | fromAmount | SWAP_LOCK_FROM 不变 |
| ② | 借 `TRADE_CLEARING(to)` / 贷 `CLIENT_PAYABLE(to)` | gross | SWAP_CREDIT_TO 不变 |
| ③ | 借 `CLIENT_PAYABLE(to)` / 贷 `FEE_INCOME(to)` | fee | 原去 FEE_RECEIVABLE |
| ④ | 借 `TRADE_CLEARING(to)` / 贷 `SPREAD_INCOME(to)` | spread | 原去 FEE_RECEIVABLE |

T1 后:`TRADE_CLEARING(from) = +fromAmount`、`TRADE_CLEARING(to) = −mid值`(②+④ 自动累加,EOD 不需再算汇率)。利润 T1 锁定。

### 5.3 T2/T3 结算腿(物理资金流 TB 镜像,不碰桥)

科目只涉及 `CLIENT_BANK/CLIENT_CUSTODY ↔ FIRM_TREASURY`,挂 funds-flow CLEAR 钩子:

| 方向 | 法币腿(实时,FIAT_SETTLE_*) | 链上腿(EOD 轧差,INTERNAL_OUT/IN) |
|---|---|---|
| 卖币买法币 | 借 CLIENT_BANK / 贷 FIRM_TREASURY = **net** | 借 FIRM_TREASURY / 贷 CLIENT_CUSTODY = **fromAmount** |
| 卖法币买币 | 借 FIRM_TREASURY / 贷 CLIENT_BANK = **fromAmount** | 借 CLIENT_CUSTODY / 贷 FIRM_TREASURY = **net** |

- 方向规律:**from 侧全额、to 侧净额**(fee+spread 是公司少付的,从不进客户池 → swap 无去混同,对齐 Model A)。
- 链上腿沿用 EOD 轧差:每币种一笔净物理转账,TB 镜像按轧差净额记。
- **现有结算腿 drain-TRADE_CLEARING 逻辑删除**,桥清算移到 5.4。
- crypto↔crypto:两腿都走 EOD,模型对称适用。

### 5.4 EOD 清桥(桥 → 换汇户,整日唯一跨币点)

EOD 在当日物理结算完成后,每币种一笔:

```
桥为贷方余额:借 TRADE_CLEARING / 贷 FX_POSITION
桥为借方余额:借 FX_POSITION / 贷 TRADE_CLEARING
```

- **清桥金额 = 当日已完成结算(两腿 Outstanding 均 SETTLED)的 swap 集合聚合**:每笔 swap 的 from 币贡献 `+fromAmount`、to 币贡献 `−(gross+spread)`,按币种求和。全部读自 swap 行,不挑汇率,加总天然归零。
- **部分结算的 swap 整笔不清**:其桥贡献(两个币种)全部留在桥上,次日随结算完成再清。
- 残余桥额按币种 = 未完全结算 swap 的桥贡献聚合(可由 open Outstanding 关联的 swap 推导)——桥余额是天然对账指标。
- 清桥后 `FX_POSITION` 各币种腿 = 公司 FX 头寸的 native 成本账(三桶第一桶)。
- 清桥是纯 TB 操作(无物理转账),transfer code `BRIDGE_SWEEP`,关联 EOD batch。

---

## 6. EOD 重估 + FX 三桶闭环

### 6.1 每日重估(FX_UNREALIZED_PNL)

清桥后,对每个有 `FX_POSITION` 余额的非 AED 币种:

```
fixing:EOD 运行时刻从 pricing-center 取 mid(与报价同源、固定切点),快照存 EOD batch 元数据
市值 = 头寸数量 × fixing;重标差额 = 市值 − 当前账面
跌:借 FX_UNREALIZED_PNL / 贷 FX_POSITION;涨:反向
```

- 整仓重标,昨日 mark 被覆盖(浮动不累计,每天作废重算)。
- 恒等式:**成本基础 = FX_POSITION 账面 − FX_UNREALIZED_PNL 余额**,成本永远可还原。

### 6.2 LP 平盘(FX_REALIZED_PNL)

示例:卖 1000 USDT @3.62 收 3620,成本 3672.50、已浮亏 22.50(账面 3650):

```
① 币出库:借 FX_POSITION(USDT) 1000 / 贷 FIRM_TREASURY(USDT) 1000
② 钱入库:借 FIRM_TREASURY(AED) 3620 / 借 FX_REALIZED_PNL 30 / 贷 FX_POSITION(AED) 3650
③ 浮动转已实现:借 FX_REALIZED_PNL 22.50 / 贷 FX_UNREALIZED_PNL 22.50
→ 已实现合计 −52.50 = 3620 − 3672.50;浮动归零;头寸两腿清光
```

- 部分平盘:按加权平均成本比例分摊成本与浮动。
- 本期范围:LP 真实交易入口不存在 → 落科目 + 记账服务方法 + demo/管理台模拟触发;真实 LP 通道接上时直接调用,记账规则零返工。

### 6.3 EOD 运行顺序(在现有 EOD 工作流上扩)

```
1. 链上净额结算(现有 INTERNAL_OUT/IN)      → TB 镜像:池 ↔ FIRM_TREASURY
2. 虚拟币提现 fee 去混同归集(FEE_COLLECT)   → TB 镜像:池 → FIRM_TREASURY
3. 清桥(当日已结算 swap 聚合)               → TRADE_CLEARING → FX_POSITION
4. FX 重估(fixing 快照 + 重标分录)          → FX_UNREALIZED_PNL
5. 对账校验(第 7 节全部不变量)+ 三桶日报
```

---

## 7. 每日对账不变量(EOD 第 5 步,任何一条破 = 告警)

| # | 不变量 | 含义 |
|--|---|---|
| I1 | 每币种 `CLIENT_BANK/CUSTODY = ΣCLIENT_PAYABLE + ΣDEPOSIT_SUSPENSE` | 客户账本 A=L(归集后混同额=0) |
| I2 | `TRADE_CLEARING 残余 = 未完全结算 swap 的桥贡献聚合` | 桥上挂的就是未结算义务 |
| I3 | `FX_POSITION − FX_UNREALIZED = 成本基础`,且可由 swap 聚合推演 | 头寸账可回溯到每笔成交 |
| I4 | 公司净值(折AED)= 资本 + 留存 + 三桶损益 | 公司账本 A=L+E |
| I5 | TB 池余额 ≟ funds-layer 物理钱包余额(Prisma) | 账实相符,记账层与物理层不漂移 |

三桶日报:做市毛利(fee+spread,铁的)/ FX 浮动(纸面,会晃)/ FX 已实现(锁定)。三桶分开,不混。

---

## 8. 数字推演锚点(验收对表用)

**方向一:卖 1000 USDT 买 AED**(mid 3.6725,markup ×0.98,fee 2%):
gross 3599.05、fee 71.98、net 3527.07、spread 73.45、mid 值 3672.50。
终态:客户 `CLIENT_PAYABLE(AED)=CLIENT_BANK(AED)=3527.07`;公司 `FIRM_TREASURY(AED)=期初−3527.07`、`FIRM_TREASURY(USDT)=期初+1000`、`FX_POSITION:USDT 腿 1000(贷方)、AED 腿 3672.50(借方)`(清桥后)、`FEE 71.98 + SPREAD 73.45 = 145.43`。EOD fixing 3.65 → AED 腿重估为 3650,`FX_UNREALIZED = −22.50`。

**方向二:卖 10,000 AED 买 USDT**(同参数,基准率 1/3.6725 × 0.98):
gross 2668.48、fee 53.37、net 2615.11、spread 54.46、mid 值 2722.94。
终态:客户 `CLIENT_PAYABLE(USDT)=CLIENT_CUSTODY(USDT)=2615.11`;公司 `FIRM_TREASURY(AED)=期初+10,000`、`FIRM_TREASURY(USDT)=期初−2615.11`、利润 `107.83 USDT`(native)。

两方向每个 T 时刻的逐笔分录与余额表已在脑暴记录中逐步验证(每步 A=L+E、每币种守恒、无凭空)。

---

## 9. 实施策略与改动面

**一刀换血**:零兼容层、零过渡态。实施计划内部按以下顺序切任务,每任务独立验证:

```
COA → 兑换 → 提现 → 充值 → EOD/FX → seed/demo → 全链验收
```

已知改动面(plan 阶段细化):

| 模块 | 改动 |
|---|---|
| `accounting/tigerbeetle/constants/tb-account-codes.constant.ts` | COA 重写(改名/删/增 + code 段) |
| `accounting/tigerbeetle/*`(账户 bootstrap/registry) | E/R 科目创建 + 双向科目 flags;新增 transfer codes(`BRIDGE_SWEEP`/`FX_REVAL`/`FX_REALIZE`/`FEE_DECOMMINGLE` 等) |
| `trading/deposit-transactions/deposit-workflow.service.ts` | 科目映射改名 |
| `trading/withdraw-transactions/withdraw-transactions.service.ts` | Pending② fee 改贷 `FEE_INCOME` |
| `trading/swap-transactions/swap-workflow.service.ts` | ③④ 腿改贷 `FEE_INCOME`/`SPREAD_INCOME` |
| `funds-layer/accounting/funds-accounting.service.ts` | drain 体系重做:删 FEE_RECEIVABLE/TRADE_CLEARING drain;新增池↔FIRM_TREASURY 镜像、去混同镜像 |
| `funds-layer/workflow/fee-collection-workflow.service.ts` | 归集额改 Prisma 口径(Σ未归集 fee),不读 TB 余额 |
| `funds-layer/workflow/fiat-fee-collection-workflow.service.ts` | 提现 fee 去混同镜像;swap fee 物理路径保留但 TB no-op |
| EOD workflow | 扩 3 步:清桥、重估、对账校验+三桶日报 |
| `internal-transfer-paths.constant.ts` | `drain` 字段语义重定/移除 |
| seed(`seed.business.ts` 等) | 资本注入 bootstrap;删 FEE_RECEIVABLE 引用 |
| 受影响 spec/test + demo 脚本 | 同步重写,TDD 先行 |

预期无 Prisma schema 变更(mid/gross 可由现有 `feeAmount`/`spreadAmount`/金额字段推导);若 plan 阶段发现缺字段,补迁移。

---

## 10. 验收标准

1. 单测:计价口径恒等式、T1 四笔原子性、pending/post/void、清桥聚合(含部分结算排除)、重估/平盘分录、加权平均成本。
2. 集成 demo(reseed 后全链):充值 → 兑换(双向)→ 提现 → EOD,每步断言 I1–I5 全绿,终态对第 8 节数字锚点。
3. `npm run build` + 全量测试通过;`dev:rebuild` 后全链可重放。

## 11. 范围外(明确不做)

- 期末结转自动化(RETAINED_EARNINGS 只建科目)。
- LP 真实交易通道(只落记账规则+模拟触发)。
- 管理台报表/三桶可视化页面(日报先以日志/接口形式输出)。
- 历史数据迁移(未上线,DB 重建)。
