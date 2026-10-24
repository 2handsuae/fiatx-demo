# LP 两步准入与打款地址簿 — 设计文档

> 2026-10-23 业主脑暴定稿 ｜ 轮次定位：战役乙（公司的钱）收官后的 LP 对手方改造独立轮——战役丁总纲 §4 明文留的「LP 侧地址/尽调改造（另轮）」即本轮 ｜ 单波 SDD，动钱动状态机，**评审升档**（plan 点名）

## §0 意图与为什么

现状：LP 档案把结算坐标（一条法币 IBAN + 一条链上地址）焊死在档案字段里，建档一步到位；没有对手方背调，坐标没有任何风控动作。战役丁把客户提现地址簿重造成「受益人 / 托管 / 筛查 / 归因」的对手方层之后，LP 侧成了对手方管理的洼地——跟 LP 动的钱比单笔客户提现大得多，打款坐标却是裸的。

目标：把 LP 准入拆成两步，演示叙事 = **公司侧的对手方尽调与支付坐标治理**：

- **第一步裁「跟不跟这家做生意」**：建档 + 实体背调 + CFO 审批；
- **第二步裁「钱打到哪条路上」**：按资产登记打款地址，归因 + 筛查 + CFO 审批，生效才能开单用。

### 本任务做
两步准入流程 ｜ LP 打款地址簿新主体 ｜ 开单守卫与资金单坐标来源改造 ｜ **到货来源筛查** ｜ 改结算流程退役 ｜ 种子、剧本、文档同步

### 本任务不做（对照根纲 §2 禁做清单）
- LP 来源（收款）地址**登记**与到货**归因**（「真是 Falcon 打来的吗」）→ BACKLOG（来源动态不预存——业主拍板；归因依赖的独立接口 403 未开通）。到货**筛查**（脏不脏）**进本轮**，见 §4
- LP 腿的 KYT 报文提交 / Travel Rule 报文义务 → BACKLOG（真集成件，house applicant 路线已定档见 §1 拍板 7；mock 下报文无可见落点）
- 到货筛查红旗后的「拒收 / 退回」正式分支 → BACKLOG（演示讲到「红旗拦住验收的人」为止）
- LP 定期复审 / 年审重筛 → BACKLOG（既有行已登：2026-10-09「LP 对手方尽调定期复审——做时脑暴」，本轮落地建档尽调正好补齐其前置，不另立新行）
- Sumsub 侧任何真调用、任何预留字段（如 sumsubPaymentMethodId）——沿用战役丁 YAGNI 拍板；KYT 按单筛报文、地址内联，不需要预登记（2026-10-22/23 讨论结论）
- 背调材料上传 / 尽调册实体（丁拍板②精神：数据住 Sumsub 侧，我方只留结论与留痕）
- 名额上限、24h 冷却、钱包验签——这些是客户自助语义的机制，LP 侧有 CFO 真门与协议锚，不适用
- 幂等 / 并发 / 重试等技术兜底（根纲 §2）

## §1 拍板记录（业主 2026-10-22/23 逐条定的）

1. **两步制**：第一步档案 + 背调 + CFO 单步；第二步按资产登记打款地址，独立生效流程（先筛后批）。
2. **背调两顶帽子分清**：实体背调（这家公司是谁、制裁、负面）是**我方的**对手方尽调，mock 三档；VASP 资质（EEC / 持牌 / 风险分）住 Sumsub 名录，只在 crypto 地址归因出 VASP 时引用（同 V12 判据先例的展示口径）。
3. **LP 不建成 Sumsub applicant**（无需 KYB——KYB 是「不必」而非「不能」）；打款地址**独立地址簿**，不写进客户 `withdrawal_addresses` 表——客户簿的自助语义（验签 / 冷却 / 名额 / 客户面投影）LP 全用不上，硬塞违反铁律③④。复用的是**套件**：归因 + 筛查同一个 mock adapter（同一 DI token、同一套尾号约定）、管理台筛查区块同款组件（同一职责同一组件判例）。
4. **只做打款方向**：LP 打给我们的来源地址动态、不存。
5. **Sumsub 侧零动作**：地址不进 Sumsub 的收付方式（预登记买到的两样——事前筛查、所有权验证——LP 场景分别由我方地址簿流程和协议锚覆盖）。
6. **多条 ACTIVE 打款地址，开单时选一条抄进单据**（单据即快照；2026-10-23 拍板）。
7. **KYT 真集成路线定档（2026-10-24 业主认可乙案，落 BACKLOG 不进本轮）**：Sumsub KYT 不要求 applicant 是客户——我方立一个公司型 house applicant（如 `FIATX-TREASURY`，一次性建），自营对外转移挂它名下，LP 作为 counterparty 内联在每笔报文里（对手方 AML 筛查沙箱已实证零配置命中；LP 当 applicant 的甲案被否：筛查位错、direction 语义拧）。不变量是「**一次对外资金移动一笔 KYT**」而非「一单一笔」——LP 兑换单两条对外腿 = 两笔（腿 1 `out` / 腿 2 `in`，`txnId` 按单号派生、`props` 带 lpxNo），腿 3 内部划转不送；判型沿丁拍板①一行逻辑（crypto → travelRule、法币 → finance）；**监控不设门**——门已前置于背调 / 地址 / 开单三道审批，状态机零新边。
8. **到货来源筛查进本轮（2026-10-24 拍板）**：LP 打给我们的钱落前厅时对来源坐标跑筛查（脏不脏），结论亮在验收停点——**拦人不拦状态**。腿 2 是全系统唯一「外部资金直进公司科目」的口子，前厅 + 人工验收的隔离仓结构已有，本刀补的是「检查站有情报」。

## §2 第一步：档案与背调

### 2.1 表 `liquidity_providers` 改造

- **退役四列**：`fiatBankName` / `fiatIban` / `cryptoNetwork` / `cryptoAddress`（坐标搬进地址簿）。schema 改动按目标终态做，reset 重铺，禁 backfill（根纲 §3）。
- **新增背调三列**：`screeningAnswer`（GREEN / YELLOW / RED）、`screenedAt`、`dueDiligenceRef`（**尽调档案引用号**，必填文本——锚线下尽调档案，照 `agreementRef` 的叙事锚模式〔我的落法，承 2026-10-24 业主「LP 背调实操落 spec」拍板〕）。不建材料柜、不加红旗位（实体背调没有「自报 vs 归因」的比对轴）。
- `agreementRef` 保留——「签了约才有档案」的叙事锚不动。

### 2.2 建档即筛（mock 约定）

建档提交瞬间同步跑实体背调（mock，站在 Sumsub 一侧的能力，**登 mock 触点册**）：

- LP 名称（大小写不敏感）含 **`sanction`** → RED，含 **`offshore`** → YELLOW，其余 GREEN。〔我的落法：与地址尾号约定同精神——演示者输入已知名称得到已知结局；словarь写进 `demo/data.md` mock 速查〕
- **RED 一票否决**：建档当场落 `REJECTED`（落点计算不是边，同地址 3333 先例；`LPP_CREATED` + `LPP_SCREENED` + `LPP_REJECTED` 留痕，拒因固定文案）。连 CFO 审批队列都进不去。
- GREEN / YELLOW → `PENDING_APPROVAL` 照常提审；YELLOW 放行留痕（同客户地址 2222 口径）。
- 审批载荷 `objectSnapshot` **必须带背调结论**（审批载荷快照三步判例）——CFO 批的不是盲盒。
- ⚡覆写背调：**不做**——档案级的人工杠杆已有启停；背调只在建档时刻跑一次。〔我的落法〕
- **mock 落点与切真口径**〔我的落法，答施工检查问题 1〕：实体背调 mock 放 **lp-desk 本地**服务方法，**不扩**共享 `TRAVEL_RULE_ADAPTER`（公司名筛查与地址筛查语义不同，扩共享接口会牵连 deposit / withdraw / withdrawal-addresses 三个 provide 模块陪跑）；mock 触点册新增一行，「真集成对应」列写 **Sumsub KYB（给 LP 建公司型 applicant + applicant 级 AML/制裁筛查）**——与拍板 3 相容：拍板 3 裁的是**本轮**不建 Sumsub 主体（不必 ≠ 不能），真要留尽调证据时 KYB-on-对手方是正路（2026-10-22 讨论口径：尽调义务在我方，筛查引擎可外包）；KYB 未开通 → 本轮顺手在 `reference/sumsub-services-needed.md` 候补一行（只登清单，不动集成）。**KYB 是候选而非必购**（2026-10-24 业主问询后补记）：对手方数量少时，人工尽调（注册文件 + 牌照公示核验 + 制裁名单筛查）即可履约，KYB 产品的真正购买触发点是「公司型客户上线」或对手方规模大到人工复审追不动；触点册该行据此措辞——真集成对应写「KYB（若外包给 Sumsub）/ 人工尽调流程（不经 Sumsub）二选一，届时定」。

### 2.2b 背调的业务口径（演示讲解词，2026-10-24 业主拍板收录）

系统里的「三档结论」是线下尽调流程的**输出抽象**，讲解时按真流程说：① 对手方填**尽调问卷（DDQ）**——Wolfsberg 式对手方问卷的 VASP 变体（实体信息 / UBO 结构 / 持牌 / AML 制度 / 制裁管控 / 财报）；② 我方自取证——注册文件、VARA 公示名录核牌照、公司与 UBO 名单过制裁 / PEP / 负面筛查（全流程唯一必须买工具的环节）；③ 合规官一页风险评估定档；④ CFO 批准建立关系。材料柜留线下（丁拍板②精神），系统只收**三档结论 + `dueDiligenceRef` 锚 + 审批留痕**；建档表单字段即 名称 + `agreementRef` + `dueDiligenceRef`。年度复审走 BACKLOG 既有行（2026-10-09「做时脑暴」）。

### 2.3 状态机

**四态四边原样保留**：`PENDING_APPROVAL ─approve(CFO)→ ACTIVE ⇄ suspend/reactivate ⇄ SUSPENDED`；`PENDING_APPROVAL ─reject/timeout→ REJECTED`。启停留痕不批不变。审批类型 `LP_PROFILE_APPROVAL` 保留。

## §3 第二步：LP 打款地址簿（新主体）

### 3.1 表 `lp_payout_addresses`

| 字段 | 说明 |
|---|---|
| addressNo | `LPA` 族业务键，unique（plan 开工 grep `generateReferenceNo(` 确认不撞现役族） |
| lpId / lpNo | 归属档案（投影零 UUID，对外用 lpNo 内联） |
| assetId | 按资产挂（业主拍板「按 asset 创建」）；法币资产 → IBAN 组字段，crypto 资产 → 网络 + 地址组字段 |
| iban / bankName / swiftBic | 法币组 |
| network / address | 链上组 |
| declaredHosting | crypto 必选（金库替 LP 自报：SELF_CUSTODY / VASP）；法币恒 null |
| addressType | 归因结论（同客户簿语义） |
| hostingMismatch | 自报 ≠ 归因 → 红旗，留痕不拦截（同客户簿） |
| counterpartyVaspName / Did | 归因出 VASP 时落；详情页按 Did 现拼名录资质三行（`getVaspProfile`，不落库，同两域先例） |
| screeningAnswer / screenedAt | 三档筛查结论 |
| evidenceRef | **协议锚，必填**——所有权证据 = 合同附件 / 条款引用号（LP 无客户端入口，验签档走不通，这是第三方申报书档的 LP 对应物） |
| approvalNo | 生效审批单号 |
| label? / status / 时间戳族 / traceId | 惯例 |

唯一键：`(lpId, network, address)`（crypto）/ `(lpId, iban)`（法币）——以一个 `(lpId, assetId, 坐标)` 复合唯一的具体落法交给 builder。

### 3.2 状态机（六态，显式迁移表，铁律④）

```
PENDING_APPROVAL ──approve(CFO)──▶ ACTIVE ⇄ suspend/reactivate ⇄ SUSPENDED
PENDING_APPROVAL ──reject(CFO) / cancel(金库,待批时)──▶ REJECTED / CANCELLED
ACTIVE ──deactivate(金库)──▶ DEACTIVATED（永久退役；换地址 = 登新生效后停旧）
```

- **先筛后批**：登记即筛（见 3.3），RED 当场 `REJECTED`（落点计算）；GREEN / YELLOW 才进 `PENDING_APPROVAL` 提审。
- **无冷却、无验签**：CFO 审批是真门，不叠客户自助机制。
- 启停（suspend / reactivate / deactivate）金库操作、留痕不批——收紧动作免门，同档案先例。
- 坐标与申报（declaredHosting / evidenceRef）登记后冻结，**改只改 label**；改坐标 = 新登记。
- 多条 ACTIVE 允许，**不设名额上限**〔我的落法：名额是客户侧防滥用机制，LP 地址是金库自己登的〕。
- 登记守卫：档案必须 `ACTIVE`。

### 3.3 登记即筛（复用对手方套件）

- 复用 `TRAVEL_RULE_ADAPTER`（`attributeAddress` + `screenAddress`）——**同一 DI token，`lp-desk` 模块自行 provide**（第四个 provide 点，mock 触点册 ① 行「切换刀口」清单 +1）。
- **尾号约定全套直接复用**：`1111` → Mock VASP Exchange、`4444` → Grey Harbor（名录资质不合格，详情页三行可见）、`2222` → YELLOW、`3333` → RED 登记即拒、其余自托管 GREEN。法币 IBAN 只筛不归因（同客户先例）。
- ⚡筛查覆写后门：照客户簿 `simulate-screening` 同款模式（合规官 `DEMO_VERDICT_WRITE`，对 `PENDING_APPROVAL` 条目覆写，喂 RED 走 REJECT 边）。〔我的落法：同一职责同一后门〕

### 3.4 新审批类型

`LP_ADDRESS_APPROVAL`：金库提 / CFO 单步 / 48h / 可撤；**白名单表登记**（审批三件套判例——漏登 = UI 永不渲染）；载荷快照带坐标 + 归因 + 筛查结论。

## §4 消费侧改造

- **开单**：modal 选定卖出资产后，列该 LP 该资产的全部 `ACTIVE` 地址供选（必选一条）。守卫升级：**档案 ACTIVE ∧ 所选地址存在、属于该 LP、匹配卖出资产、ACTIVE**；直接传任意地址号绕 UI 的，守卫同样拒。
- **抄单**：`lp_exchanges` 新列 `payoutAddressNo` + 坐标快照（单据即快照，之后不回读地址簿——快照原则：坐标必抄，展示可按业务键回链）；卖出腿资金单的 to 坐标来源从档案字段改为所选地址条目。
- **到货来源筛查（拍板 8）**：⚡ Simulate LP delivery 增加**可选来源坐标参数**（crypto 地址 / 法币 IBAN，不填用干净占位串）——现状腿 2 的 `fromAddress`/`fromIban` 抄档案坐标（`lp-exchange-workflow.service.ts:278`，档案坐标字段退役后此处必改），顺势改为「⚡入参 → 落腿 2 资金单 + 单据快照」；落账同时调同一 adapter 的 `screenAddress`（尾号约定直接复用：`2222` YELLOW / `3333` RED），结论与来源坐标落单据新列（`deliveryFromAddress` / `deliveryScreeningAnswer` / `deliveryScreenedAt`，列名 builder 定）并记审计新码（入 LPX 族）；**验收区块**渲染来源坐标 + 筛查三档徽章，RED 醒目——**拦人不拦状态**：不加边、不禁用 Accept 按钮（人看见红不点是业务纪律，同「验收是核数不是审批」口径）；归因（VASP 归属）不做。
- **退役**（退役码四件套判例：现场逐键 grep 后删干净）：
  - `proposeSettlementChange` / `applySettlementChange` 流程与端点；
  - 审批类型 `LP_PROFILE_CHANGE`（白名单表同步摘除）；
  - 审计码 `LPP_CHANGE_PROPOSED` / `LPP_CHANGE_APPLIED` / `LPP_CHANGE_REJECTED` 三码（名册 / exporter / 词表 / lark 导出四点齐）；
  - admin 档案详情页「Propose settlement change」入口与相关展示。
- **审计**：新码族 `LPA_` 8 码（REGISTERED / SCREENED / APPROVED / REJECTED / CANCELLED / SUSPENDED / REACTIVATED / DEACTIVATED）+ 档案族新增 `LPP_SCREENED` + 兑换族新增 `LPX_DELIVERY_SCREENED`（到货来源筛查）；净变动 = +10 −3，terminal 数以 `npm run audit:vocab` 分域实测为准（审计名册三点齐判例）。
- **RBAC**：复用 `treasury.view_lp` / `treasury.act_lp`，不新开权限〔我的落法：地址属 LP 域〕；合并后必做 `db:base:sync` + 重启。
- **管理台**：地址簿挂档案详情页内区块（列表 + 登记 modal + 条目详情），不另立导航项〔我的落法〕；条目详情复用 Attribution / Red Flag / Screening / ⚡模拟 四区块同款组件（同一职责同一组件判例，操作段排信息段前——module-parity 规则 3）。
- **种子与剧本**：
  - Falcon（ACTIVE）：背调 GREEN 回填；AED 一条 IBAN + USDT 两条 TRON 地址（两条为演开单多选），全 ACTIVE；
  - Dune（SUSPENDED）：背调 GREEN 回填，地址可不铺〔builder 定〕；
  - **种子历史 SUCCESS 兑换单**（场景 26 的垫底对照物，`seed.business.ts` 既有）：`payoutAddressNo` 回填指向种子 AED 地址条目；到货筛查三列铺**干净占位来源 + GREEN**〔我的落法，答施工检查问题 2——口径 = reset 世界里每笔到货都有筛查结论，详情区块不出空洞，也不造「功能前旧单」这种兼容层叙事〕；
  - 场景 26 / 27 回归改造：开单多一步选地址；
  - 新场景一组：建档背调三档（现场输入含 `Sanction` 名称演当场拒）→ 地址登记（尾号 1111 看归因与名录资质 / 2222 黄放行 / 3333 当场拒）→ CFO 批 → 生效 → ⚡喂 RED 演覆写；换地址 = 登新停旧一拍；**到货红旗一拍**（⚡到货带尾号 `3333` 来源 → 验收区 RED 徽章，讲「检查站有情报了，人不点收」）；
  - `demo/data.md`（mock 速查 + 种子）、`demo/script.md`、`demo/baseline.md`、`modules/lp-desk.md`、CHANGELOG 同步；加表必配 reset 登记表（波二判例）。

## §5 验收口径与闸门

- 两个方向全弧（场景 26 / 27）在新守卫下照常可演；开单选地址一拍可见。
- 新场景组可演：背调红当场拒 ｜ 地址先筛后批全链 ｜ 1111 地址详情见 VASP 归因 + 名录资质三行 ｜ ⚡喂 RED。
- 状态机变异测试（绿必须来自行为，禁扫源码文本）：档案非 ACTIVE 登记地址拒 ｜ 名称含 sanction 建档即 REJECTED ｜ 3333 地址登记即 REJECTED ｜ 未批地址开单拒 ｜ SUSPENDED / DEACTIVATED 地址开单拒 ｜ 他家 LP 的地址号开单拒 ｜ 地址资产 ≠ 卖出资产拒 ｜ 改坐标拒（只收 label）｜ 退役的改结算端点不复存在 ｜ ⚡到货带 3333 来源 → 单据筛查结论 RED + 审计留痕，且验收**仍可执行**（「拦人不拦状态」的行为判据）。
- 收尾闸：随手闸三连 + 相关 jest 全绿 ｜ `demo:all` 走通 ｜ 动钱 → `verify:coa` ｜ 动 schema / seed → `stack.sh reset` 重铺闸全绿，判据对照 `demo/baseline.md`。

## §6 留给 builder 的

- `LPA` 前缀撞族核查、复合唯一键具体建法、6 态迁移表边数的最终清点（含 cancel / reject 的归属边）。
- 开单 modal 的地址选择交互细节；多条 ACTIVE 时默认选中策略。
- Dune 要不要铺地址、新场景的站位编号与逐拍文案（随 `demo/script.md` 惯例走）。
- 审计码 terminal 计数、RBAC 探针（`verify:rbac`）是否需要新判据行。
- 种子回填两家背调结论的具体写法（种子直接铺终态，不走流程重放）。
- 到货筛查三个单据列的最终命名、干净占位来源串的取值（入 `demo/data.md` mock 速查）。
