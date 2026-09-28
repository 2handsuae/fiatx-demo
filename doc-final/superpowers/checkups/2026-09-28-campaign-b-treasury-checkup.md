# 战役乙体检：「公司的钱」代码现状摸底

> 2026-09-28 ｜ 三路只读扫描（sonnet 降档取数）+ 主会话（Fable 5）抽查复现与判读
> 服务对象：战役乙「公司的钱」总纲（B1 资金调度 / B2 资金合规 两分已定调）
> 范围：main @ b1146d5f；运行库 `/tmp/exchange_js_main/dev.db`（⚠️ 仓库内 `prisma/dev.db` 是 TB 化之前的孤立遗留文件，勿用它核对家底——迁移记录停在 2026-02，比 `prisma/migrations/` 最新条目早 7 个月）

## §0 四个反差（推翻讨论前认知的发现）

1. **「费钱包」科目已死，费直落三个收入科目。** `FIRM_FEE`(202)/`FIRM_LIQ`(203)/`FIRM_SEIZED`(204) 于 2026-08-13 COA v2 退役，由 `INCOME_SWAP_FEE`(210)/`INCOME_WITHDRAW_FEE`(211)/`INCOME_OTHER`(212) 接班，且有 spec 锁死禁复活（`tb-account-codes.constant.spec.ts:21-24`）。→「利润体现」应呈现为**三收入科目余额**，分业务线可讲，比旧「费钱包」更好。
2. **没有独立库存钱包，库存 = 运营户 `FIRM_OPS`(200) 兼任。** 兑换四腿只在 `FIRM_ASSET/FIRM_OPS/FIRM_SET` 之间打转（`swap-leg-plan.constant.ts:11-45`）。`F_LIQ` 钱包是**有壳无肉**：地址行在（vaults.manifest + 种子 2 行 + 托管钱包页会显示），但科目已退役、对账映射注明「期望恒 0」（`wallet-recon-run.service.ts:783`），运行库 `tb_transfer_evidence`/`account_flows` 关联查询均为 0 条——从未动过账。
3. **⑲ 没收/上缴不是断链，是两条并行的完整弧**（主会话已抽查复现）：
   - below-min **没收**：`OPERATION_PENDING→CONFISCATING→CONFISCATED`，CFO 单步批，钱落 `INCOME_OTHER`，资金腿挂充值单 legSeq=2；
   - FROZEN **上缴**（政府令）：`SEIZING→SEIZED`，高管→MLRO 两步批（`approval.constants.ts:333-337`），码 8/9/20，目的账户**刻意不建模**（政府令文书号嵌 memo 作 8 年追溯锚，`deposit-workflow.service.ts:2524-2529`）；
   - 演示库各有 1 单实据（`SELECT status,count(*) FROM deposit_transactions WHERE status LIKE 'SEIZ%' OR status LIKE 'CONFISCAT%' GROUP BY status` → CONFISCATED|1, SEIZED|1）。两终态零出边，互不衔接——**B1 零活**。
4. **LP 是预留过的空插座**（主会话已抽查复现）：`TbAccountRegistry.ownerType` 注释含 `LP`（schema:1220）、`accounting.types.ts:4` 类型并集含 `'LP'`、充值/提现/兑换三个 DTO 枚举各有 `LP` 位；但全仓无任何写入/分支代码（`grep "OwnerType.LP|ownerType.*'LP'"` 落空，运行库 `DISTINCT ownerType` 只有 SYSTEM/CUSTOMER）。B1 可直接占位，无旧设计要打架。

## §1 公司侧家底

**COA 9 码终盘（FIRM 侧 6 个）**：`FIRM_ASSET`(50 聚合)、`FIRM_OPS`(200 运营/兑换对手盘)、`FIRM_SET`(201 法币结算在途，仅 AED ledger)、`INCOME_SWAP_FEE`(210)、`INCOME_WITHDRAW_FEE`(211)、`INCOME_OTHER`(212)。锁死测试：`tb-account-codes.constant.spec.ts:6-19`「exposes exactly the 9 codes」。→ **B1 若想不推翻 COA v2 终盘决议，须在 9 码内做完**（LP 单/注资/付款都可只动 FIRM_OPS/FIRM_SET/FIRM_ASSET）。

**平台钱包 7 行**（`seed.business.ts:169-193`，`ownerType='PLATFORM'`）：F_OPS×2（AED/TRON）、F_SET×1（仅 AED）、F_FEE×2、F_LIQ×2（空壳）。复现：`sqlite3 -readonly /tmp/exchange_js_main/dev.db "SELECT walletNo,vaultCode,network FROM wallets WHERE ownerType='PLATFORM'"`。

**初始余额唯一来源**：种子期资本注入 `CAPITAL_INJECTION=70`（DR FIRM_ASSET / CR FIRM_OPS），AED 1,000,000 / USDT 100,000 硬编码于 `seed.business.ts:1926-1929`。→ ②注资单的账务动作已有种子原型，差的是运行时单据。

**手续费落点**：提现 `WITHDRAW_FEE_FIRM=16`→211；兑换两方向第 4 腿 `SWAP_FEE_FIRM=36`→210；充值无常规费腿，唯 below-min 没收 `DEPOSIT_CONFISCATE_INCOME_OTHER=4`→212。演示库已各有 3/3/1 条实据。

## §2 既有动作链（照抄模板）

**内部划转单模板卡**（新单据照此抄）：6 态 6 边显式迁移表 ｜ 审批 `INTERNAL_TRANSFER_APPROVAL` CFO 单步 48h 可撤 ｜ 单号前缀 `ITR` ｜ 法币两腿经结算户（81/82）+ 加密一腿（82/83）｜ 审计七码 + 字段级契约表 ｜ RBAC `INTERNAL_TRANSFER_READ/WRITE` 两组 5 路由 ｜ 用途枚举 `CLIENT_COMPENSATION`/`CLIENT_ADVANCE`。核心文件：`src/modules/asset-treasury/internal-transfers/`。

**结算户「过渡户」实证**：兑换两方向各 2/4 腿 touch `F_SET` 且进出同额（单笔净流恒零）；提现完全不经公司户（`grep FIRM_SET withdraw-workflow.service.ts` 零命中），客户钱包直接对外。

**「案件→挂资金动作」先例**（⑰触发链参考）：对账案件详情页差异行 `nextStep.kind ∈ {COMPENSATION, ADVANCE}` → 按钮 → `InternalTransferInitiateModal` → `POST /admin/internal-transfers/*`。入口挂在**差异行**不在案件顶层（`CaseFlowTable.tsx:94-105`）。

## §3 扩展点登记清单

**新订单类型（如 LP 单）改动面 11 处**：① schema 新父主体表 + `FundsOrder` 第五父键列/唯一约束/索引（模板 `InternalTransfer` schema:868-901）② `funds-order.dto.ts` 新字段 ③ `funds-order.service.ts` 8 个方法点（parentOf/create/directionOf/findByParent/countNonTerminalByCustomer/parentFkWhere/findAllForAdmin/findOneByNoForAdmin，:27-374）④ 转账码新段——**已用号段：充值 1-9 满、提现 10-17、上缴续段 20-21、兑换 30-38、注资 70、调账 80、划转 81-83；84+ 空闲**，u16 一经分配不可改 ⑤ 走法（LP 单贴近划转单形状，硬编码式 workflow.service）⑥ 审批三件套（`ApprovalActionTypes` 现 35 类 + `DEFAULT_APPROVAL_POLICIES` + `V1_APPROVAL_ACTION_TYPES` 白名单——**漏第三张表 = UI 永不渲染**，486 行注释是活教材）⑦ 审批 handler（17 行模板文件）+ module providers ⑧ RBAC 组 + route() + 角色绑定 ⑨ 审计实体码/工作流码/动作集/契约表 ⑩ 单号前缀（无中心表，自选不撞即可）⑪ admin-web 页面/路由/导航/`approvalEntityRoutes`/`ACTION_TYPE_LABELS`。

**事件善后单机制**（⑰挂接口）：`IncidentRemediationKinds` 现 6 种（SUPPLEMENT/CLAIM/ADJUSTMENT/**TRANSFER**/ASSET_SUSPENSION_REF/CUSTOMER_NOTICE_LOGGED）；FUNDS 族三类型白名单 = 前四种，**TRANSFER（挂划转单）已在册**——「托管失窃事件→定损→挂划转单补款」今天就能走。存在性校验按 kind 分派查真实主体表（`incident.service.ts:523-551`）；`linkRemediation` 只挂引用不落账。新增 kind 改动面 4 处 + admin 下拉核查。

**看板地基**：「账本三列表」在（`LedgerAccountList` 科目余额可筛 SYSTEM/code ｜ `TransferEvidenceList` 分录 ｜ `AccountFlowList` 流水含逐笔余额）；托管钱包页是地址簿无余额。**公司资金全景/水位页不存在**，但 TB 余额读取端点 `GET /admin/tb/accounts` 现成，看板是纯前端组装 + 阈值线。client-web 零公司资金面（两种搜法 + 目录清点核验，准确）。

## §4 业主 20 条枚举 × 代码现状判读（主会话不降档）

| # | 项 | 代码现状 | B1 判定 |
|---|---|---|---|
| 1 | 实缴资本锁定户 | 无 | 不建（业主判：系统外指定账户） |
| 2 | 运营资金注入 | 种子有码 70 原型，无运行时单据 | **新建：注资单** ★重点 |
| 3 | 增资补缴 | — | 不另建（②变体） |
| 4 | 初始库存铺底 | 种子已铺（AED 100 万/USDT 10 万） | 收编叙事（②+⑤串出「开张」） |
| 5/6 | LP 补货/回吐 | 类型壳预留、零活体 | **新建：LP 档案 + LP 调拨单** ★重中之重 |
| 7 | 跨网络搬家 | 无 | 不建（2026-09-05 否决维持，业主本轮同判） |
| 8 | 公司户间调度 | 兑换/划转腿天然经 F_SET 过渡 | 收编叙事，不另建 |
| 9 | 手续费归集 | 费直落三收入科目，无归集动作 | 不建归集；利润体现=看板三收入格 |
| 10 | 点差 | 无（单独记账已永久否决） | 不建 |
| 11 | 供应商付款 | 无 | **新建：付款单**（代表：HexTrust 月费）★重点 |
| 12/13 | 监管费/工资房租 | 无 | 并入⑪一个类型，不另建 |
| 14 | Gas | 决议：不进账本 | 维持 |
| 15 | 认损补款 | ✅ 完整（划转单） | 收编 |
| 16 | 退汇垫款 | ✅ 完整（划转单） | 收编 |
| 17 | 储备穿底补救 | 触发链大半在：FUNDS 族事件善后已可挂 TRANSFER | **做**，方案见 §5 岔口 A |
| 18 | 利润分红 | 无 | 不建（业主判：暂用不上） |
| 19 | 没收/上缴 | ✅ **两条弧完整**，演示库各 1 单实据 | 零活，收编叙事 |
| 20 | 无主资金 | 无 | 不建（业主判：没有无主资金） |

## §5 待定岔口（交业主）

- **岔口 A（⑰的形态）**：甲案=**串联既有件**——穿底补救 = 「⚡托管失窃事件 → 定损 → ②注资单补运营户 → ⑮补款划转进客户池」，零或极少新建（至多加一个善后 kind 引用注资单）；乙案=独立「储备注资单」直通客户池（新订单类型全套 11 处）。**推荐甲案**：故事完整、复用两件反正要建的东西。
- **岔口 B（F_LIQ 空壳处置）**：~~甲案=留着不动，水位看板不显示；乙案=物理退役。推荐甲案~~ → **2026-09-28 业主裁定丙案：留着且复活科目**——F_LIQ 定性为「LP 在途验收户」：LP 打来的钱先落此户，清点确认后再转运营户（F_SET 过渡户模式的同款先例）。连带：COA 9 码→10 码（锁死测试改基线）、decisions.md 记翻案（新事实=LP 在途验收需求，COA v2 当年不存在）、对账映射从「期望恒 0」改真 1:1 直比、看板加「在途待验收」格。原推荐的两案作废。
- **已定不推翻**：COA 9 码终盘不动（B1 全部动作在现有科目内记账）；转账码新开 84+ 段；每张新单据带「审慎管理目的」字段（B2 合规叙事的地基，B1 建表就带）。

## §6 B1 建造清单（草案，待总纲定波次）

1. **LP 档案**：名册主体（名称/结算账户/状态启停），LP 交易的前置；
2. **LP 调拨单**：LP-IN/LP-OUT 双向，成交价手填，金库开单 + CFO 单步（照划转单抄），码 84+ 段，占用预留的 `ownerType='LP'` 插座；
3. **注资单**：运行时资本注入（复用/延伸码 70 语义），同审批惯例；
4. **供应商付款单**：公司→外部，HexTrust 月费为演示代表；
5. **公司资金全景/水位看板**：FIRM_OPS 各币种余额 + 见底阈值线（LP-IN 的动机信号）+ F_SET + 三收入科目（利润格）；地基 = 既有 `GET /admin/tb/accounts`。

抽查记录：§0-3/§0-4（LP 空插座）、⑲双弧（状态/审批/码/库内实据）由主会话复现；其余扫描结论带 file:line 与复现命令，未逐条重跑。
