# 戊波三 · 公司侧读面闸门 + 收官 · 骨架

> 总纲：`2026-11-06-campaign-e-ledger-by-location-charter.md` §3 波三「公司侧读面闸门 + 收官」；波二 spec：`2026-11-07-campaign-e-wave2-new-capabilities-spec.md`（已归档至 `archive/superpowers/specs/`，plan 同名在 `archive/superpowers/plans/`）
> 本文件只是**骨架**——链总纲 + 承接波二 + 已定事实 + 待定岔口，**不展开波三 spec**。

## 承接波二（波二收尾任务填写）

- 合并基线：**已合 main，ff `dbfbd59d`（2026-11-07，25 个提交；基点 `5ff65ef5`；任务 11 终点 `8b40965d`，其后收尾 docs `e04fb30c`、终审小项 `dbfbd59d`）**，归档提交紧随其后（本骨架改记合并基线的那一个）；`git log main -1` 在归档提交之后即可开工。合并后主目录已做（2026-11-07）：build → `stack.sh reset main`（schema 动过：三个新迁移——`house_transfers` 表 + `funds_orders` 加调拨单回链；`internal_transfers` 重建（用途改名 `SHORTFALL_TOPUP`，加 `explainedFlowId / explainedExternalLineId / recognizedTbTransferId / recognizedAt / effectiveDate / lossSource / sourceIncidentNo`，删 `sourceAdjustmentNo`）+ `reconciliation_dispositions.transferNo`；`reconciliation_cases` / `reconciliation_run_wallets` 各加 `internalDeltaAmount`）→ `up main` + `db:base:sync`（新审批策略 `HOUSE_TRANSFER_APPROVAL`、4 条新路由、2 个新动作桶、改名的权限常量）→ `demo:all` 花名册 35/35、asserts 5/5 → `verify:coa` 105 户全 ≥ 0、`data.md` 零 diff，全绿；已推送 GitHub（`origin/main`）；**云端 `cloud:deploy` 未跑**（连欠含波一与本波，业主定时机）。验证物证：`checkups/2026-11-07-campaign-e-wave2-evidence/README.md`（闸表、计数前后表、客户侧 diff 为空、转账码抽核、e2e 对照、截图索引）。
- 实际交付（含全部订正）：
  - **科目与码**：科目码 11 → 13（`2` 托管短缺待补、`51` 应收 LP 交货，均借方户、不进 `CASH_TB_CODES`）；转账码最大 87 → 91（88 `LP_EXCHANGE_RECEIVABLE`｜89 `HOUSE_TRANSFER`｜90 `FEE_INCOME_CLOSE_*` 三 eventCode｜91 `CLIENT_SHORTFALL_RECOGNIZED`）；83 按用途分两形态（`SHORTFALL_TOPUP` 借 1 / 贷 2，`CLIENT_ADVANCE` 原样借 1 / 贷 100）、85 改贷 51；天平改成 Σ(1)+Σ(2) = Σ(100)+Σ(101) 与 Σ(50)+Σ(51)+Σ(300..302) = Σ(200)+Σ(210..212)。订正：spec 说「三处同改」，实际 `verify:coa` 就是 `scripts/verify-realtime-coa.ts`（两处），另在 `scripts/demo-lib.ts` 找到第四处硬编码并改（T1）。投影器 walletRef 判据加 `isCashCode`，码 2 流水零 walletRef。
  - **开户与种子**：`WalletCashAccountService.ensureForWallet` 对客户钱包一次开 1 + 2；`LpReceivableAccountService.ensureForLp` 挂在 LP 档案 →ACTIVE 的两条边（审批批准、金库复活）；种子给 Falcon / Dune 各开 51 × 2，LP 历史兑换单变四腿（84→88→85→86）。演示库科目数 87 → 105（重铺后 81 户，demo:all 之后 105）。
  - **应收 LP（T2 / T10）**：88 紧随 84（卖出腿确认那一步）、85 贷 51 消应收；公司资金看板新格「Due from LP — Pending Delivery」。订正：看板这格在**卖出腿确认**时才有数（不是 CFO 批准时），剧本措辞随之。
  - **共用件（T3）**：余额闸三份 `assertFirmOpsBalance`（spec 只点名两份，LP 兑换单里还有第三份，R12）收成 `AccountingService.assertWalletBalance(walletId, ledger, amountMinor)`（签名多一个 ledger，R5）；`FirmWalletPickerService.assertEligible` 管 from 钱包资格。
  - **付款单 from 可选（T4）**：Pay From = 运营户 / 手续费户，from = 手续费户不过 NLA 门；付款单第一次有 e2e。
  - **公司调拨单（T5 / T6）**：`HTR` 单号、`HOUSE_TRANSFER_APPROVAL`、六态显式迁移表、审计 +7（新名册 `CAMPAIGN_E_HOUSE_TRANSFER_AUDIT_ACTIONS`）；腿 = 一条资金单（照付款单腿）；手续费户 → 运营户整扫时同一步落 89 + 至多三笔 90，结转额封顶 min(调拨额, Σ(210..212))（R16），运营户 → 手续费户那一向过 NLA 门；两页 + 建单弹层 + 资金单回链。
  - **认损补缺一张单（T7 / T8）**：用途 `CLIENT_COMPENSATION` → `SHORTFALL_TOPUP`，批准那一步先落 91、再建腿（82 + 83 贷 2），客户应付与客户端流水全程不动；开单即挂、行锁定；钱包挂着出款锁定时开单被拒并指路；腿失败 → FAILED、不回头重补；入口在案件页菜单与事故页，权限 `INTERNAL_TRANSFER_SHORTFALL_TOPUP_WRITE`（改名，T7 连带改全部 admin-web 用处，R6）。退役四件套全走完：`CLIENT_COMPENSATION` 用途名、`/compensation` 端点与 `COMPENSATION` nextStep、`UNEXPLAINED_CLIENT_LOSS` 退出 `REASON_SPECS`（码 80 与常量留作认损补缺的固定成因）、`sourceAdjustmentNo` 列。V7 审计 +1（`INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED`）。
  - **对账（T9 / T10）**：读端解析器与写端合一（`AccountingService.resolveCashAccountId`）；客户钱包「现金 + 短缺 vs 应付 + 暂扣」的对内差额进跑批与案件（`internalDeltaAmount` 两列、INVARIANT 行，≠0 即开案、算到 0 自愈）；匹配器第 0 轮锚配对取代「按 `sourceType` 整体排除」，已落账的更正分录按锚把原行转 MATCHED。读面：案件页副行与 INVARIANT 行、跑批页对内列、看板应收 LP 格、账本科目页 Owner = LP 过滤与 2 / 51 码过滤项、凭证页 88–91。
  - **文档与剧本（T11）**：剧本场景 16 / 18 / 26 / 31 / 32 重写、新增场景 41「扫费」；`data.md`、`baseline.md` 数字、`v7-treasury / company-funds / lp-desk / v8-recon / accounting-coa` 事实句（整篇重写仍留本波）、BACKLOG 销账（手续费归集）、BACKLOG 另记「NLA 仍只算运营户」一条，PRODUCTION-NOTES +4 行、TOOLING-DEBT +3 行。
  - **证据（T0 / T12）**：改前对照（e2e 基线、客户侧快照、计数）→ 改后同命令重跑；转账码抽核表直接向 TigerBeetle 取实记 `code` 与借贷科目码；客户侧快照改前改后 `diff` 为空。
- 偏差：
  - 全程 SDD 串行（R1）；T7、T9 各拆两半一任务多一提交（R20 / R31）；T0 基线在本 worktree 的 `0c6eb7b0` 上采（代码 ≡ main `5ff65ef5`，R2）。
  - 对 spec / plan 字面的订正：天平不止三处（见上）；余额闸是三份不是两份（R12）；`assertWalletBalance` 多 ledger 参数（R5）；spec 裁定 14「CFO 拒掉 #18」——产品里 #18 的裁决人是高管（`sm@`），剧本按产品写；plan 的「客户端 Alice 少两行」对比不适用于 `demo:all` 快照（补缺单不进种子，R42）；case Hero / 看板副标题 / 行标签随 T9 退役 explained 索引有读面回归，收尾前在代码里修掉了（R41，`575c6281`）。
  - 超出 spec 字面但随波必需：`recon-reattribution` 场景 A 的中间断言按第 0 轮语义改写、愈合断言原样（R36）；重摆对账场景前置闸（R37）；案件列表 Δ 单元格与 INVARIANT 行的读面纠偏（R34 / R38）、case-opened 审计元数据加 `internalDeltaAmount`（R35）；账本科目页 2 / 51 过滤项（R11）。
  - 评审升档的几条 security-review 提示按禁做清单不修并留痕：调拨单 89 / 90 非原子（R17，已入 PRODUCTION-NOTES）、客户给的两个锚可指向不同行（R27）、开单并发窗（R28）、取消不查 maker（R29）；唯一一条按业务门回归处理的（R26，事故路少了客户池 REDUCE 配对检查）经 opus 评审证伪，不修。
- 悬挂项：
  - **业主动作**：8 条新审计码（V7 +1、调拨单名册 +7）需要在业主维护的 lark 种子里补描述——`audit:vocab` 因此 exit 1（29 码缺描述 = 本波 8 + 既有 21），agent 不读 `lark/`，不代填（R40）。
  - **要业主知道的裁定**：R19——`treasury.view_house_transfers / act_house_transfers` 的组集与 `view_funding / act_funding` 完全相同（spec「动作桶各加一个」），角色编辑器里这两个开关无法单独撤销，要合并就是后续裁；R37——**带锚处置（调账单 / 认损补缺）落账之后，对账场景不能再摆**（`recon:demo` / `pass` / `break` / `reset` / `crisis` 都被拒并指路「重铺数据」，约 1 分钟），同事演完场景 8 / 16 再想重摆要走重铺；R39 见下条。
  - **`delivery/` 触碰检查命中（R39，本波一行没改）**：新 HTR 状态机、审计 +8、HTR 业务键、认损补缺金额语义（短缺 / 补缺 / 应付三者关系）→ 波三**先改 `delivery/` 语义合同**，再改其他文档；`delivery/decision-log.md` D-10 仍写「认损调账 + 补款划转两步」，`reference/roadmap.md`（业主维护，agent 不动）的 V7 行与 :431 / :442 / :452 仍写旧补款路径。
  - **`decisions.md` 收官条目（只记不写，spec §10）**：COA v3（总纲 §6 第 3 条既有）｜托管短缺待补甲案 + 认损补缺一张单（翻 2026-09-05 :61；:27 / :63 / :65 同样仍按旧补款路径写，收官时一并核）｜公司调拨单（翻 2026-09-05 :59，用途是标签、from / to 限运营户与手续费户）｜付款单 from 可选｜扫费同额结转（含「收入户余额 = 未扫的费」的代价）｜对内差额开案 / 结案口径｜匹配器第 0 轮锚配对取代 `sourceType` 排除｜NLA 仍只算运营户（BACKLOG 已记）。
  - **读面小尾巴（评审留的，均不阻塞）**：被锚定的调账单少付（pass 0 判 AMOUNT_MISMATCH，只有操作员改了预填金额才到）行上仍读「Explained · ADJ…」；案件列表「books Δ ±x」在 ≤1280px 可能被截断；账本科目页有一列十六进制 TB 账户「ID」（既有，对照铁律⑥）；付款单详情「Paid From」落在 Payee 卡内；国库详情页沿用兄弟页布局而非 `frontend-admin.md` 的 Hero 版式（该域既有）；码 2 户名字面「Custody Shortfall」vs 常量表英文名「Custody Shortfall Receivable」留业主看科目页截图时定；云端 DEMO_OPS 面板对拒绝行的渲染没验（拒绝文案与面板按钮「Reset all demo data…」的措辞已在终审修复轮对齐）；`prudential.service.ts:110` 另有一份可用现金公式（既有）；垫款路径只有单测，其 e2e 在基线就死于 `AGREEMENT_NOT_ACCEPTED`；`cashAccountName` / `ensureWalletCashAccount` / `WalletCashAccountService` 的名字现在也开非现金户码 2（可选改名）；调拨单卡在 EXECUTING 时详情页失败原因栏原样显示 TB 状态 JSON。
  - **走查未覆盖**：场景 18（与 31 同一条事故路代码，未单独走）、场景 32（只验了 ⑩ 的挂载一步）、场景 29 Pay From（有 T4 证据，T11 未重走）、场景 37 的真实 LP 批准开 51 户（T11 用的是种子 LP）——最后一项由 T12 在 self 栈用真 HTTP 走完 LP 申请 → 评估 → 送审 → CFO 批准，注册表 4 → 6 个 51 户、TB 里两户 flags = 4，见证据目录 README。
  - **工具债 / 技术兜底（已按出口登记）**：`TOOLING-DEBT.md`——`stack.sh reset` 不清 `reconciliation_dispositions`（重铺后案件列表「Disposition」列带陈年计数）｜recon 相关 e2e 夹具用 UTC 日写外部余额、产品读迪拜业务日，UTC 20:00–24:00 窗口内跑 e2e 会多出约 10 红（拨钟配方在 `e2e-baseline-0c6eb7b0.md` §4）｜`lp-receivable` e2e 夹具直造 ACTIVE LP（私库种子停在 LP 台之前）；`PRODUCTION-NOTES.md` 本波追加 4 行（对内不平无业务修法｜出款锁定拒开单｜记短缺后腿失败不重补｜调拨单 89 / 90 非原子）。**T12 新见一个偶发**：`customer-restrictions` ⑤ 在全量里红过一次（`waitUntil` 兑换单 FROZEN 之后立刻数 `SWAP_FROZEN` 审计行、不轮询——与 `deposit-money-arcs` 用例 1 同款读早），单文件干净重铺绿；已登记 `TOOLING-DEBT.md`。
  - **e2e 基线债原样带着**：B 集 22 名（13 例 `AGREEMENT_NOT_ACCEPTED`、`swap-money-arc` 用例 2、`recon-aging` 主链路时区、`recon-adjustment` 用例 9、`customer-restrictions` ②、`demo-roster` 3 + 2 连带）一名不多不少；本波新增 4 个 e2e 文件（`lp-receivable`、`vendor-payment-from-wallet`、`house-transfer`、`recon-internal-delta`）全绿。冷缓存协议、私库每轮重铺、`db:biz:init` 恒 exit 1 照旧。
  - **波一遗留的终审分诊项**（`findWalletCashAccount` 手搭元组、Henry 钱包形状两份、`sourceWalletId` null 守卫、`verify-act1` B6 钱包没开现金户、`createRandom` 死码等）与读面文案小尾巴：波二没有专门清理，是否随触碰消失未逐条核。
  - **`scripts/recon-demo.ts:495` 排除码 91 的那段当前走不到（终审 M2，裁定 22 的代码实际未生效）**：裁定 22 要求铺场时模拟的外部对账单取数排除码 91 的「认损记短缺」流水（`INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED`），但 R37 前置闸 `assertNoAnchoredExplanations` 在 pass / break / crisis / reset 四种模式入口先跑，库里一有已记短缺的认损补缺单整个铺场就被拒，这行排除永远执行不到；代码保留未删，是否保留由波三定。
- 对波三的前提：
  - **数字基线（波三文档清册引用，均为本波收尾实跑）**：审批策略 56｜MAKER 55 + 豁免 1｜S9 表 = 路由表 46｜审计现役码 386（19 册）｜TB 科目码 13｜转账码最大 91｜演示库科目 105｜花名册 35 / asserts 5｜对账 21 钱包、18 场景、12 桶、12 案｜全量 jest 288 套 / 4862 例。
  - **波三岔口的现状**：岔口 1「账本三列表分组呈现」未动（本波只加了 2 / 51 过滤项与 Owner = LP 户名）；岔口 2「看板加开支格」未动（应收 LP 格已做）；NLA 公式文档要如实写「只算运营户，手续费户与应收 LP 不计入」（BACKLOG 已记待业主拍）；`accounting-coa.md` 整篇重写要含码 2 / 51、转账码 88–91 与新天平；**科目表导出**的码表是 13 个码；小数位债（BACKLOG §M）未动。
  - 新演示约束 R37 与「重铺数据」要写进波三的七幕走查口径；七幕走查里，场景 16 / 31 / 41 是本波新流程，场景 8 的 Kate 案在场景 14 那行没处理前保持 Open（剧本已去掉「两案都已解决」）。
  - `delivery/` 语义合同先于其他文档改（见悬挂项 R39）；收官 `cloud:deploy`。

## 下一轮讨论议题（业主 2026-11-07：「把遗留问题写入波三骨架，我下一轮讨论」；细节都在上面「悬挂项」里，这里只列要拍板的）

1. **R37 重摆对账场景被拒**：库里一有落账的调账单或记过短缺的认损补缺单，`recon:demo` 系列与云端「重摆对账场景」按钮都被拒、只能整库重铺（约 1 分钟）。接受，还是改成重摆时连带清掉带锚处置？
2. **R19 两个重复动作桶**：`treasury.view_house_transfers / act_house_transfers` 与 funding 两桶组集完全相同，角色编辑页多两个不能单独收回的开关。删还是留？
3. **R40 八个新审计码缺说明**：说明住业主维护的 `lark/` 种子，agent 不填；`audit:vocab` 在补齐前 exit 1。
4. **R39 交付文档滞后**：`delivery/` 语义合同、`decision-log` D-10、`reference/roadmap.md` 三处仍写旧的两步补款路。波三先改 `delivery/`。
5. **NLA 口径**：仍只算运营户，手续费户与应收 LP 不计（BACKLOG 已记）。波三要不要改公式？
6. **e2e 迪拜 0–4 点窗口**：夹具按 UTC 写外部余额、产品按迪拜业务日读，窗口内多红约 10 例（TOOLING-DEBT）。修夹具还是接受拨钟配方？
7. **停放小项**（R43 / R44）：`BACKLOG.md:220` 末句说反；截止过滤第三支无 e2e；to 钱包报错文案写成 from；对内不平案侧栏 Δ 显示 0.00；`recon-demo.ts:495` 排除码 91 那段因 R37 前置闸走不到（留或删）；码 2 户名字面「Custody Shortfall」与常量英文名不一致。
8. **decisions.md 收官条目**与波三岔口 1–4（见下两节）。

## 已定事实

- 波一已让公司侧读面「读得到数」（四处余额闸、NLA、看板、账本列表改读现金户，等价迁移）；波三做的是**逻辑与布局**：闸门口径、NLA 公式文档、看板格子（应收 LP、开支）、账本三列表按类分组 / 按钱包筛、小数位债（BACKLOG §M）。
- 收官清册在总纲 §6：七幕走查、文档清册、decisions 三条、常规收尾闸 ⑥⑦⑧、**科目表导出**、CHANGELOG。
- `delivery/` 语义合同先于其他文档改（它是给开发的目标）。

## 待定岔口

1. 账本三列表的分组呈现：按类折叠还是按钱包分页？
2. 看板是否加「开支」格（三收入格之外）？
3. decisions COA v3 条目的措辞：取代哪几条旧决定逐条点名（总纲 §6 第 3 条给了清单）。
4. 科目表导出的落点：`doc-final/reference/` 还是随交付合同进 `delivery/`？

## spec 开工核对项

- 文档清册逐篇核对（总纲 §6 第 2 条），一篇不漏；`modules/accounting-coa.md` 整篇重写。
- 前端改动必截图；看板数字与科目页同源同值。
- 收官 `cloud:deploy`。

## 收尾记录（2026-11-08 执行会话填写）

- 合并基线（主会话 2026-11-08 填）：**已合 main，ff `fda02779`（21 个提交；基点 `365da391`）**，归档提交紧随其后（本骨架连同总纲、波二骨架、波三 spec / plan 一起移入 archive 的那一个）。合并后主目录已做：`prisma generate` → `npm run build` → `stack.sh reset main` → `up main` → `db:base:sync` → `demo:all`（花名册 35/35、asserts 5/5）→ `verify:coa`（四恒等式过、105 户全 ≥ 0），全部 exit 0。

### 实际交付（`git log --oneline 365da391..HEAD`）

- T0 对照组与基线复用：`0effbdd0`（NLA 状态、计数、四张改前截图）；spec + plan：`dc94f70c`
- T1 NLA 三算两不算 + 门只在钱离开公司时过：`8f5fa0ad`
- T2 看板四钱包一格 + NLA 三小格 + 开支格：`72a657f8`
- T3 云端面板只留重铺、`/demo-ops/recon-break` 退役、`recon-demo` 死段删除：`e946e7de`
- T4 审计词表归 agent 维护（搬至 `reference/`，补 29 码，`audit:vocab` 绿）：`1b099b77`
- T5 删两个重复动作桶（S13d 89 → 87）：`c85e8300`
- T6 e2e 夹具按迪拜业务日、场景 9 钉住截止过滤：`3466c330`、`c3e4f5ca`（证据前置条件如实改写）
- T7 to 钱包 `TO_WALLET_NOT_ELIGIBLE`、码 2 户名对齐：`a239ab18`
- T8 案件侧栏 Books Δ、科目页与流水页小数位：`8b530aaa`、`a437c45a`（BACKLOG 小数位条销账）
- T9 文档清册 1–6（交付合同、decisions 11 条、科目篇、coa-v3 + 记账总表、模块分录句、成因手册）：`f3cab756`
- T10 剧本 / 基线 / data / CLAUDE.md / 三桶债务 + 走查：`1cfefd65`、`00a89e2f`（修复轮）
- T11a 收尾闸、全量 e2e、计数终态取数：`76601146`、`618e6c13`（第二轮全量与新基线 20 名）
- T11b 证据 README、CHANGELOG、本节、小修：`81436379`、`6fb3ea92`
- 终审修复（付款单门注释、decisions 署名、CHANGELOG / 剧本场景 30 订正、funding 桶描述、证据措辞）：终审修复提交

证据索引与闸表、计数前后、清册 ✓ 表见 `checkups/2026-11-07-campaign-e-wave3-evidence/README.md`。

### 偏差

- T0 e2e 基线复用波二 B 集，尽管 `scripts/recon-demo.ts` 自 `8b40965d` 起有差异（注释 + 一条拒绝文案字符串；e2e 不执行该脚本）。
- 全量词表 `lark/…-catalog-full.md` 重新生成时少了 3 个退役码（spec 写的是只增不减；这 3 个在 `DEPRECATED_AUDIT_ACTIONS` 里，不属现役）。
- 场景 9 的尾部改写为第 0 轮锚配对语义（spec 以为它的红只是时区问题；同波二 R36 先例）。
- 七幕走查：第一至五幕、第七幕各用 `demo:all` 状态下的一张关键截图佐证，未逐步重走；场景 16 / 18 / 29 / 31 / 32 / 37 / 41 经管理台同一批 HTTP 端点驱动并截图，不是点按钮（场景 29 的发起弹层除外）。
- plan 的 Task 11 拆成 11a（取数）/ 11b（文档）两步。
- R37 拒绝现场证据沿用 T10 的，T11a 未重走场景 16。
- 删桶只需重启后端（spec §13 写的是 `db:base:sync`；§0.1 第 16 行订正为只重启）。
- Task 5 顺带把 `overview.md` Treasury 的「17 桶」订正为 15。
- `reference/coa-v3.md` §2 记账总表以代码为准，与总纲附录 B 有 9 处不同（清单见 Task 9 报告；主要是以实际落地的转账码、借贷科目与 eventCode 为准）。
- `recon-cause-handbook` §5「改记」一句改为四腿实际（原写「客户资产这条腿完全不动」，与 v3 实现相反）。
- 流水页小数位：行里本就带 `USDT` 币种，原先显示已对；本次改动是防御性对齐（与科目页同一查法）。
- BACKLOG「改」条数 2 而非 spec 的 1：多出的是 1440px 条在 T10 评审要求下改记为推迟；TOOLING-DEBT 另有两处超 spec 字面（`:207` 加注、`:218` 新开 e2e 同次调用耦合条）。
- Task 1 的两条评审小项并入 Task 7 处理。
- 全量 e2e 两轮（Run 1 / Run 2，均在迪拜窗口内）都多出 `vendor-onboarding ①`（单跑绿）：主会话裁定记偶发，新基线 20 名（`618e6c13`，见 `e2e-after-00a89e2f.md`）；已登记 TOOLING-DEBT。
- 自动安全评审提出「已结案案件的 Books Δ 显示破口那一轮的值」：按 spec 保留（§0.1 第 18 行、Review Focus 4），报业主知悉。

### 归档待办

> 2026-11-08 主会话：下列前五项已办（归档、`coa-v3.md:4` 链接、业主 BACKLOG 两行补回、重启 + sync + reset main）；仍待业主的只剩 `cloud:deploy` 与 `reference/roadmap.md` 两项。

- 合并后由主会话归档：总纲 + 本骨架 + 波三 spec / plan → `archive/superpowers/{specs,plans}/`；归档后跑 `grep -rn "campaign-e" doc-final --exclude-dir=archive`，应只剩 CHANGELOG / decisions / 证据目录，以及 TOOLING-DEBT / BACKLOG / `demo/script.md` / `demo/baseline.md` / `reference/coa-v3.md` 对证据目录或战役名的引用（合法命中）。
- 同时归档 `specs/2026-11-06-campaign-e-wave2-skeleton.md`；总纲归档后，`doc-final/reference/coa-v3.md:4` 指向总纲的路径改到 `archive/superpowers/specs/…`。
- 合并须知（给主会话）：主工作树 `doc-final/BACKLOG.md` 有业主未提交 2 行（2026-10-29「登记欠款入口」），另有未跟踪的本波 spec / plan 两份（与分支版逐字相同）——ff 前要先挪开，合并后把业主那 2 行补回并提交；不要用 git stash。
- `cloud:deploy`：连欠波一至波三，`npm run cloud:deploy`，业主触发（本波不跑）。
- 合并后主会话按 `CLAUDE.md §10`：重启后端 + `npm run db:base:sync`（删桶本身只需重启；词表 / 权限字典同步仍照 §10 做）+ `bash scripts/stack.sh reset main`。
- 业主维护项（spec §2：agent 不碰 `reference/roadmap.md`）：V7 行，以及 `:431` / `:442` / `:452` 的旧充值路径表述，待业主更新。
