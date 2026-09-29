# LP 兑换台（找 LP 平盘：库存见底怎么补货）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-09-29（战役乙波一：LP 地基与调拨落地）
> 演示幕次：场景 26 / 27（暂编，战役乙收官定稿）｜ 验收：`demo/script.md` 场景 26/27 + 本篇 §4

## 0. 一句话定位

管**运营户见底之后去哪补货**这件事。客户兑换天天消耗库存（USDT→AED 或反向），运营户迟早撑不住；这时金库向一家签了约的场外流动性提供商（LP）开一张**兑换单**——卖出一种资产、买入另一种，先款后货：我方先出钱，等 LP 把货打进一间"在途验收前厅"（`FIRM_LIQ` 科目复活），金库清点核对后才正式转入运营户。是 V7 财资域下的第二类新订单（第一类是内部划转单，见 `v7-treasury.md`）；LP 兑换见本篇。

## 1. 业务叙事

**LP 是签了协议的外部对手方，不是客户,也不入账本科目。** 建档需要 CFO 单步审批（结算坐标定义了钱往哪打，铁律②在公司资金侧首次亮相）；启停两态只需留痕不需要审批（收紧动作不设门）。种子预铺两家：Falcon Liquidity FZE（ACTIVE，主用）与 Dune OTC DMCC（SUSPENDED，示范停用后开单被拒）。

**一张兑换单，两个方向共用同一套状态机同一套码——没有 IN/OUT 枚举。** 每张单只是"卖出一种资产的金额 + 买入另一种资产的金额"，两边手填（成交价不接真实价源，业主拍板）。同一状态机既能演"库存见底找 LP 补货"（卖 AED 买 USDT），也能演"USDT 积压向 LP 回吐"（卖 USDT 买 AED）——方向由哪边是 sell、哪边是 buy 决定，不是两种订单类型。

**先款后货，悬空期看板可见。** CFO 批准后，我方卖出腿从运营户直出（不过前厅——前厅语义只收 LP 来的钱）；随即进入"等 LP 发货"的悬空期：运营户已经变瘪，在途验收前厅还空着，账实两头都能在账本页看到这个中间态。LP 把货打进前厅（`FIRM_LIQ`）后，单据转"已到货待验收"；金库点一下"验收"——纯展示的核数动作（应收 vs 实到并排），不做"不符"分支（业主拍板：不为想象中的分支写代码）——验收即触发第三条腿，把前厅的钱转进运营户，单据终态 `SUCCESS`。

**F_LIQ 是本波复活的老科目。** 2026-08-13 COA v2 时因为零活体代码被退役（"期望恒 0"），本波因为 LP 在途验收这个真实需求而复活——科目码 203 原名原码不变，注释改写身世；对账映射从"恒 0"改成真 1:1 直比。这是本波唯一动 COA 的地方，其余记账都发生在既有 10 码之间。

## 2. 状态机

### 2.1 LP 档案（LiquidityProvider）—— 四态四边

```
PENDING_APPROVAL ──approve(CFO)──▶ ACTIVE ⇄ suspend/reactivate ⇄ SUSPENDED
PENDING_APPROVAL ──reject/timeout──▶ REJECTED（终态）
```

建档（金库提 → CFO 单步批）与改结算账户（`proposeSettlementChange` → CFO 批 → `applySettlementChange`，档案全程保持 ACTIVE，不因改坐标而下线）都走审批；启停两边是金库直接操作，只留痕不经门。

### 2.2 LP 兑换单（LpExchange）—— 八态八边

```
PENDING_APPROVAL ──approve+余额闸过──▶ EXECUTING（卖出腿建资金单并推进）
PENDING_APPROVAL ──approve+运营户卖出资产不足──▶ FAILED（不建资金单）
PENDING_APPROVAL ──reject/timeout──▶ REJECTED ｜ ──cancel(金库,待批时)──▶ CANCELLED
EXECUTING ──卖出腿清算──▶ AWAITING_DELIVERY（悬空期：等 LP 发货）
EXECUTING ──腿失败──▶ FAILED
AWAITING_DELIVERY ──⚡LP 打款落前厅──▶ DELIVERED（待验收）
DELIVERED ──accept(金库,验收=核数)──▶ SUCCESS（落验收转腿入运营户）
```

八态：`PENDING_APPROVAL / EXECUTING / AWAITING_DELIVERY / DELIVERED / SUCCESS / FAILED / REJECTED / CANCELLED`。三条腿各建一张资金单（第五父键 `lpExchangeId`）：腿 1（卖出，运营户直出）DR FIRM_OPS/CR FIRM_ASSET、腿 2（LP 打款进前厅）DR FIRM_ASSET/CR FIRM_LIQ、腿 3（验收转腿）DR FIRM_LIQ/CR FIRM_OPS——腿 3 外穿写两侧回单（内转腿同划转单先例，账实一致优先于"内转不外穿"的旧直觉）。

## 3. 决策点与角色

| 动作 | 谁发起 | 谁裁决 | 要点 |
|---|---|---|---|
| 建 LP 档案 | 金库（LP Register 页） | CFO 单步 | 结算坐标（法币 IBAN + 加密地址）定义卖出腿钱打到哪 |
| 改结算账户 | 金库（详情页 Propose settlement change） | CFO 单步 | 档案保持 ACTIVE 不下线；`approvalNo` 字段只记建档那次，变更审批号不回写主体行 |
| 启停 LP | 金库 | — | 留痕不批，收紧动作 |
| 开 LP 兑换单 | 金库（LP Exchanges 页，守卫=档案 ACTIVE） | CFO 单步 | 卖出/买入两边金额手填 + 审慎管理目的必填 |
| ⚡ 推卖出腿 | 金库（资金单页，模拟门控） | — | 运营户直出，走既有资金单 Submit/Settle |
| ⚡ 模拟 LP 打款 | 金库（兑换单详情页） | — | AWAITING_DELIVERY → DELIVERED，前厅落钱 |
| 验收 | 金库（DELIVERED 态详情页） | — | 应收（buyAmount）vs 实到（腿 2 资金单金额）并排展示，纯核数零逻辑；确认即触发第三腿 |
| 撤回 | 金库（待批时） | — | 执行中不许撤 |

## 4. 演示脚本

场景 26（正向全弧：卖 AED 买 USDT，含悬空期停点 + 验收）与场景 27（反向快演：卖 USDT 买 AED）——步骤在 `demo/script.md`（暂编，战役乙收官定稿）。

## 5. 关键技术节点

- 主体 `src/modules/asset-treasury/lp-desk/`：`lp-profile.service.ts`（四态迁移表 / 零 UUID 投影）、`lp-exchange.service.ts`（八态迁移表 / 余额闸 / 三腿计划）；工作流 `lp-profile-workflow.service.ts`（建档 / 改结算 / 启停）、`lp-exchange-workflow.service.ts`（发起 / ⚡推腿 / ⚡模拟到货 / 验收）
- 审批类型 `LP_PROFILE_APPROVAL` / `LP_PROFILE_CHANGE` / `LP_EXCHANGE_APPROVAL`（均金库提 / CFO 单步 / 48h / 可撤，白名单表已登记）
- 转账码新段 84/85/86（`LP_EXCHANGE_PAY` / `LP_EXCHANGE_RECEIVE` / `LP_EXCHANGE_ACCEPT`）；资金单第五父键 `lpExchangeId`
- COA：`FIRM_LIQ`=203 复活（`tb-account-codes.constant.ts`）；对账映射 `wallet-recon-run.service.ts` 从"退役科目期望恒 0"改真 1:1 直比（`wallet-balance-checker.service.ts` 同款）
- 审计：TREASURY 域新增 16 码——档案族 8（`LPP_CREATED/APPROVED/REJECTED/CHANGE_PROPOSED/CHANGE_APPLIED/CHANGE_REJECTED/SUSPENDED/REACTIVATED`）、兑换族 8（`LPX_REQUESTED/CANCELLED/REJECTED/EXECUTION_STARTED/PAY_LEG_POSTED/DELIVERED/ACCEPTED/FAILED`）
- 权限：`treasury.view_lp`（`LP_READ`，金库/CFO/内审三职务）、`treasury.act_lp`（`LP_WRITE`，金库独持）
- 端点：`admin/lp-profiles`（list/create/detail/settlement-change/suspend/reactivate）、`admin/lp-exchanges`（list/create/detail/cancel/simulate-delivery/accept）
- 表 `liquidity_providers` / `lp_exchanges`（reset 登记已补，见 `TOOLING-DEBT.md` 销账行）；admin-web 两组页面 `LpProfileList/Detail`、`LpExchangeList/Detail`（Custody 导航组，「LP Register」/「LP Exchanges」）

## 6. 演示缺口（BACKLOG 有账）

- 验收弹层 Received 现取（腿 2 资金单详情）失败时静默呈 `—`，不拦确认——演示 RBAC 下不触发，登 `PRODUCTION-NOTES.md`
- LP 档案变更审批在途时，详情页不展示"有一张变更在途"的持久提示（只在提交当次给一次性横幅）——T2 设计的自然结果，走审批列表仍可查到，登 `BACKLOG.md`
- 账本科目页 USDT-TRON 类资产（code≠currency）小数位显示错位，LP 兑换台相关数字（前厅/运营户 USDT 余额）在这类账本视图里显示成十倍数——既有 admin 前端 bug（非 LP 专属），已挂业主任务 `task_475851be`，登 `BACKLOG.md`
