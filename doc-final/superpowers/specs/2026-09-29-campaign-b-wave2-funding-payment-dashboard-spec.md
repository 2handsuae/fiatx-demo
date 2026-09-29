# 战役乙 · 波二 spec —— 注资单 + 供应商付款单 + 公司资金全景看板

> 总纲：`2026-09-28-campaign-b-company-funds-charter.md` §3 波二行 ｜ 骨架：`2026-09-29-campaign-b-wave2-skeleton.md`（承接波一，已定事实不重查）｜ 体检：`checkups/2026-09-28-campaign-b-treasury-checkup.md`
> 收尾对照 `rules/delivery-checklist.md`；评审按 `rules/review-rubric.md`。本波**动钱（两类新资金单据 + 新转账码 + 种子基线变动），评审升档**（总纲 §8 点名）。

## §0 脑暴裁定台账（2026-09-29，业主已拍板）

| # | 岔口 | 裁定 | 依据一句话 |
|---|---|---|---|
| 1 | 看板见底阈值怎么配 | **写死常量**（每币种一条，admin-web 单处常量表），不建配置面、不复用限额族 | 演示无「现场改阈值」的戏；限额是客户交易语义，硬套库存水位不通 |
| 2 | 注资转账码 | **复用 70 `CAPITAL_INJECTION`**，不新开 | 种子原型与运行时单据是同一记账语义（DR FIRM_ASSET / CR FIRM_OPS），一语义一码；87 段留给真正的新语义 |
| 3 | 付款单审批 | **照抄 LP 模板**：金库提 / CFO 单步 / 48h / 可撤 | 付款与 LP 兑换同属「公司的钱出门」，同一套门 |
| 4 | B2（波三）挂点 | **不预留** | 波三红线=读同一份水位数据画线+发事件，天然可接；纯投机挂点违反纪律 12 |
| 5 | 付款收款方 | **从外包商登记册下拉选**（存 `vendorNo` 业务键引用，详情可点回名册），不做自由填 | 甲波四立的名册被真的用来付钱，跨战役打通；演示代表 HexTrust 恰在册。**边界注记**：⑫⑬（监管费/工资房租）名义并入付款单类型，但收款方不在册即付不出——演示不演它们，无实际损失；将来要演须先把收款方登册或另议放开，此为故意收窄非遗漏 |
| 6 | 看板可见职务 | **金库 / CFO / 高管 / 内审四职务**（照甲波四闹钟墙「干活的能看、监督的也能看」先例） | 看板是给管理层看家底的一屏；内审只读符合零 Act 人设 |
| 7 | 六节设计整体 | 2026-09-29 业主过目通过（注资单 / 付款单 / 看板 / 权限登记 / 种子场景 / 不做清单） | 本 spec 即该设计的落笔 |

另：⑳ 无主资金销账口径已与业主对齐——不建，且结构上不会产生：临时认不出主的钱一律以对账案件形态存在并强制闭环（客户侧补单三路 + 改记；公司侧查无果→核销），无挂账通道。收官销账表照此措辞。

## §1 已核事实（spec 起草时实测，plan 不必重查；重查命令附）

- **单号前缀 `CIN`（注资）/ `PAY`（付款）不撞**：`grep -oE "generateReferenceNo\('[A-Z]+'\)" src -rn` 现役 31 前缀无 CIN/PAY（PWR 在役但非 PAY）。
- **转账码一次列全：本波仅 87 `VENDOR_PAYMENT` 一枚**（§4 表定死，plan 不得追加）；注资复用 70。无 pending/void 形态——照划转单/LP 先例「腿确认才落账」，失败即不落账。
- **看板数据端点零改动**：`GET /admin/tb/accounts`（rbac.catalog.ts:613）由 `LEDGER_ACCOUNT_READ` 把门，实测持有职务=高管/内审/CFO/金库/技术官/运营六职务——四个目标观众全已在内；流水区复用 `LEDGER_FLOW_READ`（同六职务持有）。看板页本身的可见性由新组 `FUNDING_DASHBOARD_VIEW` 门控（§7）。
- **外包商登记册无收款坐标**：`OutsourcingVendor`（schema:1825）只有 vendorNo/name/serviceDescription/criticality/contract/status——付款单必须自带收款坐标字段（§3.1 `payeeAccountRef`）；开单守卫=vendor `status='ACTIVE'`。
- **审批基数权威值：波前 49 → 终态 51**（骨架订正在案，不沿用总纲旧估计）。
- **审慎管理目的字段**：两张新单据均必填（总纲 §2 拍板）。
- **金额铁律**：最小单位存、展示层换算（骨架开工核对项；看板每格适用）。
- **F_LIQ 已活、对账真直比**（骨架已定事实）：看板在途格直接读 203 余额，零新对账逻辑。

## §2 注资单主体（CapitalInjection）

### 2.1 表 `capital_injections`

| 字段 | 说明 |
|---|---|
| cinNo | `CIN` 族业务键，unique，对外唯一识别（铁律⑥） |
| contributorName | 出资方名称（一行文本，不立主体——设计 §6 不做） |
| assetId / amount | 注入币种与金额（最小单位），单币种单笔 |
| prudentialPurpose | 审慎管理目的，必填 |
| currentStatus | 六态枚举，见 2.2 |
| approvalNo? / requestedBy + 各态时间戳 | 留痕惯例 |

### 2.2 状态机（六态五边，显式迁移表，铁律④）

```
PENDING_APPROVAL ──approve(CFO)──▶ AWAITING_FUNDS（等出资方打款）
PENDING_APPROVAL ──reject/timeout──▶ REJECTED ｜ ──cancel(金库,待批时)──▶ CANCELLED
AWAITING_FUNDS ──⚡模拟出资方打款(写回单)──▶ RECEIVED（已到款待确认）
RECEIVED ──confirm(金库,确认入账)──▶ SUCCESS（落账码 70，运营户直进，不过前厅——前厅是 LP 专用）
```

- 无余额闸（钱是进项）、无 FAILED 态（进项 ⚡到款在演示里不会失败；审批过期归 REJECTED，照 LP reject/timeout 同边）。
- 确认边是显式动作：金库操作、界面并排「应到（amount）vs 实到（回单金额）」（照 LP 验收=核数先例，纯展示零逻辑）、审计打点、系统随之落账。
- 审批类型 `CAPITAL_INJECTION_APPROVAL`：金库提 / CFO 单步 / 48h / 可撤（照 `INTERNAL_TRANSFER_APPROVAL` 同参）；白名单表勿漏（甲教训）。

## §3 供应商付款单主体（VendorPayment）

### 3.1 表 `vendor_payments`

| 字段 | 说明 |
|---|---|
| payNo | `PAY` 族业务键 |
| vendorNo（内联外键 vendorId，投影零 UUID） | 收款方=在册外包商（裁定 5）；开单守卫=vendor ACTIVE |
| payeeAccountRef | 收款账户坐标（一行文本，金库填；资金单 to 侧记录——名册无坐标，§1） |
| assetId / amount | 付款币种与金额（最小单位），单币种单笔 |
| purposeNote / prudentialPurpose | 付款事由（如「HexTrust 2026-09 月费」）；审慎管理目的，必填 |
| currentStatus | 六态枚举，见 3.2 |
| approvalNo? / failureReason? / requestedBy + 各态时间戳 | 留痕惯例 |

### 3.2 状态机（六态六边，照划转单骨架）

```
PENDING_APPROVAL ──approve+余额闸过──▶ EXECUTING（建出款资金单）
PENDING_APPROVAL ──approve+运营户余额不足──▶ FAILED（不建资金单，照 LP/划转单先例）
PENDING_APPROVAL ──reject/timeout──▶ REJECTED ｜ ──cancel(金库,待批时)──▶ CANCELLED
EXECUTING ──⚡推出款确认(回单先于落账)──▶ SUCCESS（落账码 87） ｜ ──腿失败──▶ FAILED
```

- 审批类型 `VENDOR_PAYMENT_APPROVAL`：金库提 / CFO 单步 / 48h / 可撤（裁定 3）；白名单表勿漏。

## §4 记账与资金单（全部在 10 码 COA 内；转账码就此定死）

| 单据 | 腿 | 分录 | 转账码 | 物理钱包对 | 资金单方向 |
|---|---|---|---|---|---|
| 注资单 | 进项单腿 | DR FIRM_ASSET / CR FIRM_OPS | **70 `CAPITAL_INJECTION`（复用）** | 出资方外部 → F_OPS | IN，第六父键 `capitalInjectionId` |
| 付款单 | 出项单腿 | DR FIRM_OPS / CR FIRM_ASSET | **87 `VENDOR_PAYMENT`（新开，本波唯一）** | F_OPS → 收款坐标（payeeAccountRef，资金单 to 侧记录） | OUT，第七父键 `vendorPaymentId` |

- 两腿形状均有先例：进=码 70 既有语义原样；出=LP 卖出腿（84）同形。客户侧科目零触碰，F_LIQ/F_SET 零触碰，`verify:coa` 两恒等式不受扰。
- FundsOrder +2 列（`capitalInjectionId` / `vendorPaymentId`，各 `@@unique([<父键>, legSeq, attempt])` + index，照 `lpExchangeId` 模板）；funds-order.service 各方法点照体检 §3 清单逐一接入。
- **回单一律先于落账**（波一 T5 订正纪律）：两腿都是外穿，各写模拟托管回单，对账吃进；F_OPS 真直比不受扰的判据进验收。
- ⚡ 门控：「模拟出资方打款」「推出款」挂既有 useSimulationMode 惯例，操作人照资金单页惯例（金库）。
- recon-demo 场景⑩候选钱包检查（骨架告诫）：本波零新科目、零新钱包，F_OPS 本就在检——plan 落地时跑一遍确认即可，无需排除项。

## §5 公司资金全景看板（admin-web 新页，纯前端组装）

- **五个区**：① 运营户水位——F_OPS 每币种余额 + 见底阈值线（写死常量，裁定 1）；② F_LIQ 在途待验收格；③ F_SET 结算在途格；④ 三收入格（210/211/212，利润体现=总纲 ⑨ 收编口径）；⑤ 最近资金动态——账本流水最近 N 条（复用流水端点，四职务均持 `LEDGER_FLOW_READ`，§1）。
- **数据源**：全部读既有 `GET /admin/tb/accounts` 与账本流水端点，**不建新后端聚合**（总纲 §1 地基条兑现）；金额最小单位→展示换算。
- **阈值常量**：admin-web 单处常量表（如 `companyFundsThresholds.ts`），每币种一条；候选 AED 50,000 / USDT 50,000，**plan 开工对 `demo/baseline.md` 实测后钉死**，唯一取值判据=基线在线上方、且一笔演示级客户兑换能可见地拉近水位与线的距离（「见底→找 LP」的动机信号演得出来）。
- **可见性**：页面/导航由新组 `FUNDING_DASHBOARD_VIEW` 门控（四职务，裁定 6）；数据端点零改动（§1）。
- 波三接线声明：本波看板只展示，零事件、零推送（承袭总纲假设①）、零预留挂点（裁定 4）。

## §6 管理台其余页面（Treasury 导航组）

- **注资单 List/Detail**：列表（cinNo/出资方/币种金额/状态）；详情=金额卡 + 状态时间线 + 资金单腿区 + 动作按钮（撤回/确认入账/⚡模拟打款）——可见性=**状态 × 持码**双维（甲波二判例，禁加第三维）。
- **付款单 List/Detail**：列表（payNo/收款方/币种金额/状态）；详情=同款 + 收款方点回外包商登记册（横向只读，铁律③放行）。
- 开单 modal 各一：注资=出资方+币种金额+审慎目的；付款=下拉选 ACTIVE 外包商+收款坐标+币种金额+事由+审慎目的。
- 审批联动：`approvalEntityRoutes` 加两类型跳转；`ACTION_TYPE_LABELS` 加人话标签。
- 路由全量进 RBAC catalog（`route()` + db:base:sync + 重启惯例）。

## §7 权限、审计、审批（预期终态数量——改完必须对上，纪律 5）

| 计数 | 波前 | 预期终态 | 增量内容 |
|---|---|---|---|
| RBAC 域 | 15 | **15** | 不新增域，桶挂 Treasury 域（11→14 桶） |
| RBAC 桶 | 77 | **80** | `treasury.view_dashboard` / `treasury.view_funding` / `treasury.act_funding` |
| RBAC 组 | 85 | **88** | `FUNDING_DASHBOARD_VIEW`（金库/CFO/高管/内审四职务）/ `FUNDING_READ`（金库/CFO/内审，照 LP_READ 先例）/ `FUNDING_WRITE`（唯金库）；CFO 裁决走审批角色路由不占桶；`FUNDING_DASHBOARD_VIEW` 同时以 OR 挂上 `GET /admin/tb/accounts` 两路由作路由锚（持有者本就可达，零权限扩张） |
| 审批类型 | 49 | **51** | `CAPITAL_INJECTION_APPROVAL` / `VENDOR_PAYMENT_APPROVAL`（均金库提/CFO 单步/48h/可撤）；三件套含白名单表勿漏 |
| 审计现役码 | 312 | **324** | 注资族 6：CIN_ `REQUESTED/APPROVED/FUNDS_RECEIVED/CONFIRMED/REJECTED/CANCELLED`；付款族 6：PAY_ `REQUESTED/EXECUTION_STARTED/EXECUTED/FAILED/REJECTED/CANCELLED`（命名照 LPX 族体例；域 TREASURY；词表入库 lark 目录并重导全量册，照波一惯例） |
| 转账码 | 86 止 | **+1（87）** | §4 表定死，plan 不得追加 |
| COA 科目 | 10 | **10** | 零增删（总纲 §2「COA 内做完」） |
| prisma 表 | — | **+2** | capital_injections / vendor_payments；FundsOrder +2 列；**加表必配 reset 登记表**（波二判例） |

审计通则：每条状态边写 fromStatus/toStatus；展示级字段（金额、出资方/收款方名、确认数）镜像 metadata（甲 R5 判例）；`verify:rbac` 扩判据、既有红集与波前基线恒等口径（甲判例）。

## §8 种子与演示同步

- **开张注资补单据壳**：种子既有资本注入（码 70、SEED_CAPITAL，AED/USDT 各一笔）包装为**两张 SUCCESS 注资单**（AED 一张、USDT 一张，出资方=创始股东叙事名），资金单镜像补齐（种子既有行则挂父键；plan 实测无行则照真实 workflow 形状补建 SUCCESS 资金单）、**账本零新增分录**（复用既有 code-70 行）——注资列表开局不空，故事=「公司开张的注资在册可查」，运营户基线一分不动。
- **一张 SUCCESS 历史付款单**：HexTrust 上月月费（AED，小额，金额 plan 定），账本落一条码 87 分录——F_OPS AED 基线随之下调，`demo/baseline.md` 同步；回单照波一 T9 先例（种子不铺回单，recon:demo 从流水重铸）。
- 同步 `demo/data.md` 生成区、`demo/script.md` 场景 28/29/30（**暂编**，幕次归属照旧留战役收官定稿）：28=注资全弧（开单→CFO 批→⚡出资方打款→确认入账→看板 F_OPS 涨）；29=付款全弧（选 HexTrust→CFO 批→⚡推出款→看板 F_OPS 降）；30=看板巡览+做一笔客户兑换看三收入格实时涨（验收口径「利润体现」的正戏）。
- 数据 reset 重铺，不写兼容（总纲 §3 假设）。

## §9 验收判据（可执行口径）

1. **场景 28/29/30 全程实走**：截图物证入 `checkups/2026-09-XX-campaign-b-wave2-evidence/` 惯例目录；30 含「兑换前后三收入格数字变化」对照帧。
2. **看板口径一致**：看板每格数字与账本三列表同源同值（走查对照，含最小单位换算正确——decimals 显示错是波一已登记的既有缺口，本波新页不得复发）。
3. **状态机变异测试**（绿必须来自行为，禁扫源码文本）：未批不能标到款/不能推出款 ｜ 二次确认入账拒 ｜ TERMINATED 外包商开单拒 ｜ 金额≤0 拒 ｜ 审慎目的空拒 ｜ 付款余额不足批准落 FAILED 且零资金单 ｜ 注资确认前 F_OPS 不涨。
4. **`verify:coa` 全绿**（收尾闸⑦，动钱必跑）：两恒等式 + 负余额。
5. **重铺闸⑧**：`stack.sh reset` 从零建库重铺 → `demo:all` 全绿；两张 CIN 壳单 + 一张 PAY 历史单 + F_OPS 新基线对 `baseline.md`；`recon:demo:pass` F_OPS 仍 MATCHED。
6. `verify:rbac` 扩判据全绿（含：FUNDING_DASHBOARD_VIEW 恰四职务持有 ｜ FUNDING_WRITE 唯金库 ｜ maker≠checker）。
7. 审计行为探针：每边 from/to 齐；审批三步齐；⚡动作也留痕（铁律①）。
8. 闸门：随手闸①—⑤（动 admin-web → 截图）；jest 本任务目录全绿。

## §10 波三承接（收尾时按 delivery-checklist 填写）

收尾会话立 `2026-09-XX-campaign-b-wave3-skeleton.md` 并写承接：合并基线 / 实际交付 / 偏差 / 悬挂项。波三已定内容见总纲 §3（NLA 红线读本波看板同源数据；穿底补救串联本波注资单；收官统一落 decisions 三条 + §4 销账——⑳ 无主资金销账措辞见本 spec §0 尾注）。
