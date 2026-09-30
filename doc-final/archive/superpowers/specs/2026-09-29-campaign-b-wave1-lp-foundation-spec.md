# 战役乙 · 波一 spec —— LP 地基与调拨（LP 档案 + LP 兑换单 + F_LIQ 复活）

> 总纲：`2026-09-28-campaign-b-company-funds-charter.md` §3 波一行 ｜ 骨架：`2026-09-29-campaign-b-wave1-skeleton.md` ｜ 体检：`checkups/2026-09-28-campaign-b-treasury-checkup.md`（下称「体检」，file:line 与复现命令都在那边）
> 收尾对照 `rules/delivery-checklist.md`；评审按 `rules/review-rubric.md`。本波**动钱 + 动 COA + 动对账映射，评审升档**（总纲 §8 点名）。

## §0 脑暴裁定台账（2026-09-29，业主已拍板）

| # | 岔口 | 裁定 | 依据一句话 |
|---|---|---|---|
| 1 | IN/OUT 双向还是单一类型 | **单一「LP 兑换单」**，无方向枚举——卖出资产+金额 ｜ 买入资产+金额两边手填 | 业主发现：系统仅两资产互为对方的货，IN/OUT 是立场不是类型；roadmap 旧词表作废（总纲 §0 订正在案） |
| 2 | 交易时序 | **先款后货**：CFO 批 → 我方卖出腿先出 → 等 LP 发货 → 买入腿落前厅 → 验收入库 | 悬空期看板可见「运营户瘪下去、前厅还空着」——前厅与验收的存在理由自己演自己 |
| 3 | 卖出腿走法 | **运营户直出，不过前厅** | 前厅语义单一（只收来自 LP 的钱）；圈货防抢是并发兜底（§2 禁做）；少态少码 |
| 4 | LP 档案准入 | **建档 / 改结算账户 → CFO 单步审批；启停 → 留痕不批**；种子预铺两家（一 ACTIVE 一 SUSPENDED） | 档案里的结算坐标定义卖出腿的钱打到哪——钱的去向要设门（铁律②在公司资金侧首亮相）；启停是收紧动作无需门 |
| 5 | 验收含义 | **验收 = 核数**（应收 vs 实到并排展示，纯展示零逻辑）；「不符」分支不做面 | ⚡ 到账按单推、不符无法自然发生；不为想象中的分支写代码（纪律 12） |
| 6 | TB 注册表 `ownerType='LP'` 插座 | **本波不占用**——LP 是外部对手方不入账本，三腿全在公司科目间（同提现外部侧先例）；三 DTO 的 LP 枚举位维持不动 | 体检发现的插座经设计推演实际用不上；占了反而要造 LP 科目与余额语义，纯负担 |
| 7 | 六节设计整体 | 2026-09-29 业主过目通过（档案主体 / 八态状态机 / 三腿记账 / F_LIQ 连带 / RBAC·审计·页面 / 种子·场景） | 本 spec 即该设计的落笔 |

## §1 已核事实（骨架「spec 开工核对项」完成情况）

- **腿计划模板缺口已认**：单据/审批照划转单抄（6 态先例、CFO 单步 48h、审计七码模板），记账走法照 swap 跨 ledger 先例——本 spec §4 把每腿 DR/CR 与码写死。
- **转账码一次列全**：84/85/86 三枚（§4 表），无 pending/void 形态——照划转单先例「腿确认才落账」，失败即不落账无需反冲码。u16 一经分配不可改，plan 不得追加。
- **科目码复用 203/FIRM_LIQ 原名原码**（骨架倾向落定）：演示库整库重铺、`tb_transfer_evidence` 等表中无 203 历史行（体检 §0-2：F_LIQ 关联查询 0 条）。
- **COA 改基线与首条 F_LIQ 记账同 commit**：锁死测试 9→10 码新基线、退役名黑名单移除 FIRM_LIQ（FIRM_FEE/FIRM_SEIZED 仍锁），随手闸①③中间不红。
- **销户校验自然排除**：`countNonTerminalByCustomer` 按客户父键计数，LP 兑换单无 ownerCustomerNo——不入销户前置；测试断言之，不靠「应该没事」。
- **单号前缀候选定案**：兑换单 `LPX`、档案 `LPP`——plan 开工 grep `generateReferenceNo(` 全量调用清单确认不撞（现役 ITR/CMP/RI/VEN/OBL/FIL 等族）。
- **审慎管理目的字段**：LP 兑换单必填（总纲 §2 拍板「每张新单据带」）；档案不是资金动作，不带。

## §2 LP 档案主体（LiquidityProvider）

### 2.1 表 `liquidity_providers`

| 字段 | 说明 |
|---|---|
| lpNo | `LPP` 族业务键，unique，对外唯一识别（铁律⑥） |
| name | LP 名称 |
| fiatBankName / fiatIban | 法币结算坐标（收 AED 的银行账户） |
| cryptoNetwork / cryptoAddress | 加密结算坐标（收 USDT 的链上地址） |
| agreementRef | 协议引用号（文本，「签了约才有档案」的叙事锚） |
| currentStatus | 四态枚举，见 2.2 |
| approvalNo? | 建档审批单号 |

### 2.2 状态机（显式迁移表，铁律④）

```
PENDING_APPROVAL ──approve(CFO)──▶ ACTIVE ⇄ suspend/reactivate ⇄ SUSPENDED
PENDING_APPROVAL ──reject/timeout──▶ REJECTED（终态）
```

四态四边。启停两边金库操作、留痕不批（裁定 4）。

### 2.3 改结算账户（动作不是状态，照甲波四 RI 换人先例）

`proposeSettlementChange`（金库提，新坐标快照进审批单 objectSnapshot）→ CFO 批 → `applySettlementChange`（从载荷读值落地，档案保持 ACTIVE）/ 拒 → 原值不动。审批载荷时序拆三步（甲判例）。workflow 只编排零审计写入，落地审计收在档案服务内（甲先例同款）。

## §3 LP 兑换单主体（LpExchange）

### 3.1 表 `lp_exchanges`

| 字段 | 说明 |
|---|---|
| exchangeNo | `LPX` 族业务键 |
| lpNo（内联外键 lpId，投影零 UUID） | 对手方档案；开单守卫=档案 ACTIVE |
| sellAssetId / sellAmount | 我方付出（卖出）边，手填 |
| buyAssetId / buyAmount | 我方收进（买入）边，手填；守卫=两边资产不同、金额>0 |
| prudentialPurpose | 审慎管理目的，必填（§1） |
| currentStatus | 八态枚举，见 3.2 |
| approvalNo? / failureReason? | 审批单号；失败原因码 |
| requestedBy + 各态时间戳 | 留痕惯例 |

### 3.2 状态机（八态八边，显式迁移表）

```
PENDING_APPROVAL ──approve+余额闸过──▶ EXECUTING（卖出腿建资金单并推进）
PENDING_APPROVAL ──approve+运营户卖出资产不足──▶ FAILED（不建资金单，照划转单先例）
PENDING_APPROVAL ──reject/timeout──▶ REJECTED ｜ ──cancel(金库,待批时)──▶ CANCELLED
EXECUTING ──卖出腿清算──▶ AWAITING_DELIVERY（等 LP 发货；悬空期）
EXECUTING ──腿失败──▶ FAILED
AWAITING_DELIVERY ──⚡LP 打款落前厅──▶ DELIVERED（待验收）
DELIVERED ──accept(金库,验收=核数)──▶ SUCCESS（落验收转腿入运营户）
```

- 验收边（DELIVERED→SUCCESS）是显式动作：金库操作、界面并排「应收（buyAmount）vs 实到（买入腿金额）」（裁定 5）、审计打点、系统随之落第三腿。
- 审批类型 `LP_EXCHANGE_APPROVAL`：金库提 / CFO 单步 / 48h / 可撤（照 `INTERNAL_TRANSFER_APPROVAL` 同参）。
- 两个资产方向（卖 AED 买 USDT ｜ 卖 USDT 买 AED）走**同一状态机同一套腿**，仅 ledger 对调。

## §4 三条腿与记账（全部在 10 码 COA 内；转账码就此定死）

| 腿 | 触发 | 分录 | 账本 | 转账码（新段） | 物理钱包对 |
|---|---|---|---|---|---|
| 1 卖出腿（直出） | 批准+余额闸过 → 建单，⚡推提交/确认，确认落账 | DR FIRM_OPS / CR FIRM_ASSET | 卖出币 | **84 `LP_EXCHANGE_PAY`** | F_OPS → LP 外部坐标（档案结算坐标，资金单记 to 地址/IBAN） |
| 2 买入腿（进前厅） | ⚡「模拟 LP 打款」→ 建单落账 | DR FIRM_ASSET / CR FIRM_LIQ | 买入币 | **85 `LP_EXCHANGE_RECEIVE`** | LP 外部 → F_LIQ |
| 3 验收转腿 | 验收确认 → 建单落账 | DR FIRM_LIQ / CR FIRM_OPS | 买入币 | **86 `LP_EXCHANGE_ACCEPT`** | F_LIQ → F_OPS（**外穿+两侧回单**——订正 2026-09-29 T5 评审：原「内转不外穿」违反逐钱包对账模型，验收后 F_LIQ/F_OPS 双破口；划转单内转腿 81 本就外穿写两侧回单，铁律⑤账实一致为权威） |

- 分录方向与既有先例同款：出=划转单出腿形状（DR 源科目/CR FIRM_ASSET）、进=资本注入形状（DR FIRM_ASSET/CR 目标科目）、内转=兑换腿 2 形状。客户侧科目零触碰，`verify:coa` 两恒等式不受扰。
- 三腿各一张资金单，第五父键 `lpExchangeId`（`@@unique([lpExchangeId, legSeq, attempt])` + index，照 internalTransferId 模板）；funds-order.service 8 个方法点照体检 §3 清单逐一接入，`directionOf`：腿 1=OUT、腿 2=IN、腿 3=INTERNAL。
- 三腿全部写模拟托管回单（对账吃进，LP 仓位对账被动达成——总纲 §4 收编口径；腿 3 两侧回单照划转单内转腿惯例）；**回单一律先于落账**（划转单 SUBMITTED 时写回单的既有纪律——订正 2026-09-29 T5 评审：后置会使「当日无余额行」基准含已落账流水，外部余额双计）。
- ⚡ 门控：推腿与「模拟 LP 打款」挂既有 simulation 门控惯例（useSimulationMode），操作人照资金单页惯例。

## §5 F_LIQ 科目复活连带（与腿 2 首条记账同 commit）

1. `tb-account-codes.constant.ts`：FIRM_LIQ=203 回表，注释改「LP 在途验收户（2026-09-29 战役乙复活，原 2026-08-13 COA v2 退役）」。
2. 锁死测试：9→10 码新基线；退役黑名单剩 FIRM_FEE/FIRM_SEIZED 两名。
3. `asset-provisioning.service.ts` `systemAccountCodesFor`：两资产均注册 FIRM_LIQ 科目（AED/USDT 各一行，tb_account_registry +2 行）。
4. 对账映射 `wallet-recon-run.service.ts`：F_LIQ 行从「退役科目,期望恒 0」改真 1:1 直比（E.FIRM_LIQ）。
5. `demo/baseline.md` 判据同步；重铺闸⑧必跑。
6. `decisions.md` 落翻案条（总纲 §7 第 5 条的波一份额可先落或收官统一落——plan 定，倾向收官统一）。

## §6 管理台（admin-web，Treasury 导航组）

- **LP 档案 List/Detail**：列表（lpNo/名称/状态/协议号）；详情=基本信息 + 结算坐标 + 状态操作（启停）+ 改结算入口（modal 提审批）+ 审计区惯例。
- **LP 兑换单 List/Detail**：列表（exchangeNo/LP/卖买两边/状态）；详情=两边金额卡 + 状态时间线 + 资金单腿区（跳资金单详情）+ 动作按钮（撤回/验收/⚡模拟 LP 打款）——可见性=**状态 × 持码**双维（波二判例，禁加第三维）。
- 开单 modal：选 ACTIVE 档案 + 卖买两边 + 审慎目的必填。
- 审批联动：`approvalEntityRoutes` 加三类型跳转；`ACTION_TYPE_LABELS` 加人话标签。
- 路由全量进 RBAC catalog（`route()` + db:base:sync + 重启惯例）。

## §7 权限、审计、审批（预期终态数量——改完必须对上，纪律 5）

| 计数 | 波前 | 预期终态 | 增量内容 |
|---|---|---|---|
| RBAC 域 | 15 | **15**（T10 实测：`ACTION_BUCKET_CATALOG.length` 恰 15，与波前一致） | 不新增域，桶挂 Treasury 域 |
| RBAC 桶 | 75 | **77**（T10 实测：`ACTION_BUCKET_CATALOG` 总桶数恰 77，命中预期） | `treasury.view_lp` / `treasury.act_lp` |
| RBAC 组 | 83 | **85**（T10 实测：`PermissionGroup` 联合类型成员数恰 85，命中预期，无偏差） | `LP_READ`（金库/CFO/内审）/ `LP_WRITE`（金库独持）；CFO 裁决走审批角色路由不占桶 |
| 审批类型 | ~~35~~ **46**（本行波前基数系 plan 拟定时的估计值，T10 实测纠偏：`git show 5cd8856d:src/modules/governance/approvals/constants/approval.constants.ts \| node -e "..."` 抽取 `DEFAULT_APPROVAL_POLICIES` 的 `[ApprovalActionTypes.X]:` 键恰 46 个，非 35；5cd8856d 是波一 plan 落地那一笔，早于 T1，即真实波前基线） | ~~38~~ **49**（T10 实测：现有 `DEFAULT_APPROVAL_POLICIES` 同法数恰 49 个 = 46+3，新增三条 key 与预期完全一致，唯波前/终态两个绝对数需订正） | `LP_PROFILE_APPROVAL` / `LP_PROFILE_CHANGE` / `LP_EXCHANGE_APPROVAL`（均金库提/CFO 单步/48h/可撤）；三件套含白名单表勿漏（甲教训）——**增量口径 +3 本身没错，错在两个绝对基数**，`scripts/verify-rbac.ts` 的 S8「MAKER 表与策略一一对应」判据已逐条钉住这三条，不受本行文字纠偏影响 |
| 审计现役码 | 296 | **312**（T10 实测：`npm run audit:vocab` 分域计数合计恰 312，命中预期，无偏差） | 档案族 8：LPP_ `CREATED/APPROVED/REJECTED/CHANGE_PROPOSED/CHANGE_APPLIED/CHANGE_REJECTED/SUSPENDED/REACTIVATED`；兑换族 8：LPX_ `REQUESTED/CANCELLED/REJECTED/EXECUTION_STARTED/PAY_LEG_POSTED/DELIVERED/ACCEPTED/FAILED`（命名维持 plan 定稿原样，数量口径 16；域 TREASURY，词表已入 `doc-final/lark/2026-09-15-audit-actions-catalog-by-domain-workflow.md` TREASURY 域两个新分组并重新导出 `2026-09-16-audit-actions-catalog-full.md`） |
| 转账码 | 83 止 | **+3（84/85/86）** | §4 表定死，plan 不得追加 |
| COA 科目 | 9 | **10** | FIRM_LIQ=203 复活（§5） |
| prisma 表 | — | **+2** | liquidity_providers / lp_exchanges；FundsOrder +1 列；**加表必配 reset 登记表**（波二判例） |

审计通则：每条状态边写 fromStatus/toStatus；展示级字段（两边金额、LP 名、验收数）镜像 metadata（甲 R5 判例）。

## §8 种子与演示同步

- 种子：LP 两家——`Falcon Liquidity FZE`（ACTIVE，主用）/ `Dune OTC DMCC`（SUSPENDED，示范停用拒开单）；一张 SUCCESS 历史兑换单垫底（三腿资金单+账务镜像；回单由 recon:demo 从流水重铸——订正 2026-09-29 T9 评审：真实 workflow 回单为 4 行非 6 行、种子不铺回单照注资先例；重铺后对账活证据=recon:demo:pass 断言 F_LIQ 在检且 MATCHED + break 18/18，判据入 baseline）。
- 同步 `demo/data.md` 生成区、`demo/baseline.md`（F_LIQ/F_OPS 余额判据 + F_LIQ 对账直比判据 + 历史单）、`demo/script.md` 场景 26/27（暂编，波三收官定稿）：26=正向全弧（USDT 见底 → 卖 AED 买 USDT：开单→CFO 批→⚡付款→悬空期看板讲解→⚡LP 打款→验收→落库存）；27=反向快演。
- 数据 reset 重铺，不写兼容（总纲 §3 假设）。

## §9 验收判据（可执行口径）

1. **场景 26 全弧实走**：含悬空期（AWAITING_DELIVERY 时运营户已减、前厅仍空）与验收两数并排；截图物证入 `checkups/2026-09-29-campaign-b-wave1-evidence/` 惯例目录。
2. **场景 27 反向实走**：资产对调、同状态机同码。
3. **状态机变异测试**（绿必须来自行为，禁扫源码文本）：未批推腿拒 ｜ 未到货验收拒 ｜ 二次验收拒 ｜ SUSPENDED 档案开单拒 ｜ 档案未批先开单拒 ｜ 改结算未批不生效 ｜ 卖出资产=买入资产拒 ｜ 余额不足批准落 FAILED 且零资金单。
4. **`verify:coa` 全绿**（收尾闸⑦，动钱必跑）：两恒等式 + 负余额，含 F_LIQ 在途中间态时点。
5. **重铺闸⑧**：`stack.sh reset` 从零建库重铺 → `demo:all` 全绿，F_LIQ 直比判据对 baseline。
6. verify:rbac 扩判据全绿，既有红集与波前基线恒等口径（甲判例）。
7. 审计行为探针：每边 from/to 齐；审批三步齐；⚡动作也留痕（铁律①）。
8. 闸门：随手闸①—⑤（动 admin-web → 截图）；jest 本任务目录全绿。

## §10 波二承接（收尾时按 delivery-checklist 填写）

收尾会话往 `2026-09-XX-campaign-b-wave2-skeleton.md` 写承接：合并基线 / 实际交付 / 偏差 / 悬挂项。波二已定内容见总纲 §3（注资单+付款单+全景看板——看板的在途格即读本波复活的 FIRM_LIQ 余额）。
