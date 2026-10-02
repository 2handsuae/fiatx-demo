# 战役丙波二「讲清楚、给凭据」spec

> 总纲：`2026-09-30-campaign-c-outreach-disclosure-charter.md` §2 波二行（2026-10-02 改四波后口径）｜ 骨架：`2026-09-30-campaign-c-wave2-skeleton.md`（含"脑暴已拍"节）｜ 脑暴拍板 2026-10-02 ｜ 状态：**待业主过目 → plan**
> **本任务做**：兑换确认弹窗三句话 +「平台留存」行 ｜ 成交确认单主体（`trade_confirmations` 表 + `CONFIRMATION_ISSUED` 审计 + 详情页区块 + 打印）｜ 报价响应补点差金额（公共函数与建单同源）｜ 充值/提现风险提示 ｜ 披露文案登记处 ｜ 剧本与文档同步。
> **本任务不做**（对照 CLAUDE.md §2 与总纲）：报价成交链行为改动（出具是 SUCCESS 后置副作用，照波一通知先例）｜ best-exec 比价闸 ｜ 冷静期 ｜ 充值/提现确认单 ｜ "确认单已出"独立通知 ｜ 条款同意（移丙波三）｜ 真 PDF 生成（浏览器打印即够）｜ 确认单补发/重出/修正流（生产债登 PRODUCTION-NOTES）｜ 管理台新页。

## 执行订正（2026-10-02，T8 文档收口，spec 原文不改只追记）

1. **§2.1 字段表漏列 `toAssetCode`，已补列**：原表只列 `fromAssetCode`，买入侧币种没有落列，确认单页面就得回读兑换单才知道「You received」是什么币——违背本 spec 自己立的「确认单是自包含原件、页面不再现拼订单字段」原则。T3 评审逮到，裁决补列（修复提交 `64b1e627`）：schema 加 `toAssetCode String`、本波新建的迁移 `20261002122630_wave2_trade_confirmations` 同步补该列（未另开迁移）、出具服务 `issueForSwapIfSuccess` 写入、详情响应白名单与客户端区块读它。落地后 `trade_confirmations` = id + 21 业务列，客户详情 `confirmation` 子对象 19 键（比表少 `swapNo` / `ownerCustomerNo` 两个内部列，`id` 本就不外露）。字段表其余各列、`@unique` 约束与「只写一次」语义不变。
2. **§2.1 `confirmationNo` 的 `CNF-…` 写法，实际形态是 `CNF` + 12 位数字、无连字符**（如 `CNF261002576568`）：`generateReferenceNo('CNF')` 沿用系统全部单号的既有形态（`SWP…`、`WDR…`、`SQT…` 同款），裁决：以系统惯例为准，不为确认单单开连字符特例。凡文档与剧本里的示例一律按无连字符写；审计中心关键字框按 CNF 号可检索，Entity / Related No 筛选框不认 CNF 号。

## §0 脑暴裁定台账（2026-10-02）

**五拍板**（岔口编号对应骨架）：
1. **冷静期不做**（岔口 1）：实价成交即过账，冷静期=撤销已成交单，撞"成交链不改"；反悔窗口已有报价 TTL 300s。
2. **确认单只做兑换**（岔口 2）：充提无成交价概念；SEC 10b-10/FCA COBS 16A 同样只管"交易"，充提回执属 VA T&S 牌照义务（本司仅 BD 牌照）。
3. **风险提示一行小字**（岔口 3）：提现放确认按钮上方；充值页客户无提交按钮（唯一按钮是 ⚡模拟到账），放收款信息下方；**仅 crypto 语境**（法币充值页不放"虚拟资产波动"句，钱仍是法币；波动风险在兑换披露点覆盖）。
4. **确认单不另发通知**（岔口 5）：波一"兑换成功"通知深链已达详情页，确认单住详情页即一笔一条。
5. **确认单新增主体**（追加岔口，两改终判）：首判"不新增"（价/费建单定格实测成立），业主以行业标准质疑后推翻——SEC 10b-10"give or send 书面通知"/FCA COBS 16A.3.1R 次一营业日送达/VARA T&S II.F.2-3 回执留存 8 年，口径一致：确认单是**发出并留存的文件**，须有①出具时刻②原件留存③发出证据，页面现拼三者皆无；"种子缺单"旧顾虑被实证推翻（种子/演示兑换全走 `initiateSwap` 真实流程：`scripts/demo-lib.ts:476/946`、`demo-fixtures.ts:319`，`prisma/`+`scripts/` 零直写兑换表）。**改口判例：把"数字不可变"当成了"单据不可变"，两者在行业标准里不是一回事。**

**监管依据（2026-10-02 一手核实，rulebooks.vara.ae 现行版 2025-06-19）**：VARA 无单独"必须出具确认单"条款（搜索边界见骨架），但 **BD II.A.6** 要求"客户应付金额中由 VASP 留存为 fees or commission 的部分"**成交前与 trade confirmation 中各披露一次**——本 spec 的"平台留存"行在弹窗与确认单各出现一次即此条的落地（点差算不算 fees/commission 原文未明说，保守起见手续费+点差都披露）。传统证券业确认单为法定义务（对照项）。

## §1 成交前披露：兑换确认弹窗（`client-web/src/pages/Swap.tsx` Confirmation Modal）

现有明细（Fee/Exchange Rate/Market·Spread%/Quote No/定价公式）不动，**加一行 + 加一块**：

1. **Retained by FIATX 行**：`Fee {feeTotal} {feeCurrency} · Spread {spreadAmount} {currencyOut}`。数据来自报价响应新增字段 `spreadAmount`（§4）。spread=0 或取整残差为负时**按原值显示不截断**（诚实优先），测试覆盖 0 点差。
2. **Before you confirm 三句话**（Confirm and Swap 按钮上方，固定文案带占位，登记处见 §5）：
   - `FIATX acts as principal — you are trading directly with FIATX, not with another client.`
   - `Your rate is the market reference rate ({rateSource}, {fetchedAt}) adjusted by our {spreadPercent}% spread.`
   - `FIATX earns the spread and fee on this trade, so our interests may differ from yours.`
   占位全部取当前报价真实值，不写死。

## §2 成交确认单主体

### 2.1 表 `trade_confirmations`（新迁移 + reset 登记，甲波二判例"加表必配 reset 登记"）

| 字段 | 说明 |
|---|---|
| id / `confirmationNo` | uuid / 业务键 `CNF-…`（铁律⑥，沿用既有单号生成器模式；对外一律用 confirmationNo） |
| `swapNo` **@unique** | 一单一张，结构保证（schema 约束，非幂等工程）；`quoteNo`、`ownerCustomerNo` 一并落列 |
| 成交事实定格 | fromAmount/fromAssetCode、toAmount、netToAmount、feeAmount/feeCurrency、feeLines(JSON，沿 `toCustomerPricingFacts` 口径)、exchangeRate、marketRate、rateSource、fetchedAt、spreadPercent、spreadAmount |
| 三时刻 | `tradedAt`（=兑换单 createdAt）、`settledAt`（=completedAt）、`issuedAt`（=出具时刻，default now） |

**只写一次，无任何 update 入口**（service 层不提供方法，不靠 DB 触发器）。本金声明与"数字已定格"句是固定文案住登记处（§5），不逐行入库——定格对象是数字事实，版式与措辞随代码版本，此为 demo 口径（生产的"整版留存"记 PRODUCTION-NOTES 一行）。

### 2.2 出具时机与次序

挂 `SwapWorkflowService.notifySwapStatusChange` 同一事务后置序列（9 调用点已收口，波一判例三原则全继承）：to-status 落 `SUCCESS` 时**先建确认单 → 再记审计 → 再发通知**（三原则①"持久物先于信号"的延伸：客户点开通知时确认单必须已存在）。非 SUCCESS（REJECTED/FROZEN/过程态）零出具。出具失败同通知口径边界吞错（demo 尽力而为，不阻断成交；生产债与 PRODUCTION-NOTES 2026-10-01"通知投递语义"行同族，§7 追加时并入）。

### 2.3 审计

`CONFIRMATION_ISSUED`（327→**328**）：actor=system（`recordSystem`，显式 requestId），domain 对齐兑换域既有口径，metadata 带 confirmationNo/swapNo。出生即冻结四属性 + `assertActionSpec`；五处登记齐（实体类型/工作流类型/平面码/契约册/写点，乙波三判例）；`audit:vocab` 入库 328。管理台**零新页**（波一甲案同款）：审计中心按单号/客户号检索即见。

### 2.4 客户端

- **详情接口**：客户兑换**详情**响应（不含列表）当确认单存在时附 `confirmation` 子对象（字段=2.1 成交事实+三时刻+confirmationNo）——经 `toCustomerSwapView` 白名单路径显式扩展，列表响应不带。tipping-off 复核已过：仅 SUCCESS 有单，FROZEN 收敛态=COMPLIANCE_PENDING 同样无单、不可区分；子对象全部是定价事实与时刻，零合规信息。
- **`SwapDetail.tsx`**：SUCCESS 单将现有 Amounts/Pricing 两区块合并升级为 **Trade Confirmation** 区块，**读 confirmation 子对象**（不再现拼订单字段——演示话术"你看到的是出具当时留存的原件"）；含本金声明句、"Figures were fixed when you confirmed and will not change."、`[Print / Save as PDF]` 按钮（`window.print` + 打印样式**翻浅色**，深色主题直接打印不可读）。非 SUCCESS 单页面一字不变。
- 显示条件抽纯函数供 vitest（客户端测不了渲染，页面靠截图闸）。

## §3 风险提示（各一行小字，文案见 §5）

| 页 | 位置 | 文案 |
|---|---|---|
| Withdraw 确认弹窗 | 确认按钮上方 | 链上资产：`Blockchain transfers are irreversible — funds sent to a wrong address or network cannot be recovered.`；法币：`Bank transfers cannot be recalled once sent.`（按所选资产类型二择一） |
| Deposit crypto 标签页 | 收款信息下方 | `Virtual assets are volatile and can lose part or all of their value.` |
| Deposit fiat 标签页 | 不放 | 见 §0 拍板 3 |

## §4 后端：点差金额同源

**正式报价（firm quote）响应**新增 `spreadAmount`（live rate 预估响应不动——确认弹窗只消费 firm quote）。算法与建单处（`swap-workflow.service.ts:459-462`：`fromAmount×marketRate` 按 toAsset.decimals 取整后减 toAmount）**抽同一公共函数**，建单改为调它（行为零变化，jest 钉住：同输入下报价算出值 === 建单落库 `spreadAmount`）。客户面无需另扩字段：成交前数据全在报价响应，成交后全在 confirmation 子对象（此设计取代脑暴期"客户视图加三字段"的草案）。

## §5 披露文案登记处

`client-web/src/constants/disclosure-copy.ts`（名从执行，模式照波一 `notification-templates.constant.ts`：写死代码、无编辑面、集中登记）：三句话模板、Retained by FIATX 标签、本金声明句、定格声明句、风险提示 3 条。后端不需要镜像（文案全是客户端展示物；确认单落库的是数字事实）。

## §6 测试与闸

- **jest**（兑换域相关目录）：①spread 同源（报价=建单，含 0 点差）；②SUCCESS 出具恰一张/REJECTED·FROZEN 零出具；③确认单字段=成交时事实；④审计 328 四属性；⑤详情响应 confirmation 子对象白名单断言 + FROZEN 反面（无 confirmation、无 completedAt，既有测延伸）。
- **vitest**：确认单显示条件纯函数。
- **闸**：tsc×3 ｜ 相关 jest + `npm run test:client` 全绿 ｜ `audit:vocab` 328 ｜ ⑤preview 截图 ≥6（弹窗含三句话与留存行 / 确认单区块 / 打印预览浅色 / 提现链上提示 / 充值 crypto 提示 / **反面：冻结兑换单详情无确认单**）｜ **动 schema → 收尾重铺闸⑧**（`stack.sh reset` 从零建库 + `demo:all` 全绿，确认单随真实流程自然生成，对照 `demo/baseline.md`）｜ 不动钱→⑦ `verify:coa` 不触发 ｜ 禁文本扫描型断言。

## §7 文档与剧本同步（收尾按 `rules/delivery-checklist.md` 逐触发行过）

- `modules/`：兑换篇确认单主体与出具链一节 + overview 审计码 328 行；`demo/script.md`：四幕 Confirm and Swap 步补"指读三句话与留存行"、成交后补"开详情看确认单+打印"、既有兑换冻结场景补反面步（详情无确认单、与审核中不可区分）、三幕/五幕各指一句风险提示；`demo/data.md` 生成区由 `demo:all` 自写不手改。
- CHANGELOG 一行；BACKLOG 无对应行可销（roadmap:367 双点披露+确认单属业主维护层，不代改）；PRODUCTION-NOTES 追加：确认单真 PDF/整版留存/补发修正流。
- 收尾写"承接记录"进丙波三骨架（`2026-10-02-campaign-c-wave3-agreement-skeleton.md`"承接上一波"节）。

## §8 数量表（终审逐条可点）

新表 1（迁移 +1，reset 登记 +1）｜ 审计现役码 327→**328** ｜ 权限桶/组 **+0**（15 域 81 桶 89 组不动；客户端点照波一先例不进 catalog）｜ 审批策略 **+0** ｜ 通知模板 **+0** ｜ 客户端新常量文件 1 ｜ 改动页面 4（Swap 弹窗/SwapDetail/Withdraw/Deposit）。

## §9 验收口径

四幕现场走通：报价弹窗见三句话+留存行（数字与报价一致）→ 成交 → 详情见确认单（confirmationNo/出具时刻/留存行与弹窗一致）→ 打印预览可读；审计中心按 swapNo 查到 `CONFIRMATION_ISSUED`；冻结单反面成立；重铺后以上全部复现。
