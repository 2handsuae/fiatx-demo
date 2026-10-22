# 对手方层（归因 · VASP 尽调 · 认领/申报）总纲

> 2026-10-22 立纲（业主脑暴收口于 2026-10-21/22 会话）｜两波｜波一 spec 同日落档
> 研究底座：`doc-final/reference/sumsub-services-needed.md` + 2026-10-19~22 Sumsub 真实沙箱实证（见 §5）

## §0 这是什么

把**对手方处置层**——来源/去向地址的归因、对手方 VASP 尽调、认领/申报、KYT 判型——在演示系统里演出来。观众看点（业主口述）：**提现地址簿动最大，充值交易其次，提现交易收尾**；必须让人看见"VASP 尽调和认领/申报这件事在系统里长什么样"。

演示形态（业主拍板）：**Sumsub 真实后台是第二块演示屏**——尽调数据（VASP 名录 637 家、EEC 状态、评分）由业主现场打开 Sumsub 展示；我们系统里只演自己该有的那部分。

## §1 分工定调（业主拍板，2026-10-21）

**Sumsub 管尽调数据与闸，我们管订单分支、档案字段、政策口径。**

我们系统里的"尽调体现"只有三样薄件：
1. **裁决分支**：充值/提现合规链多一个"对手方 VASP 不合格"分支（⚡喂，与制裁命中同形状）；
2. **订单详情 VASP 区块**：对手方 VASP 名称 + EEC 状态 + 风险标 + 评分（mock 数据展示）；
3. **政策口径一行**（进 PRD/文档，不建东西）：如"EEC 完成 ∧ 评分<10 ∧ licensed = 通过"。

**不建**：VASP 尽调册实体、管理台 VASP 名录页。

## §2 裁定清单（业主拍板，2026-10-21/22；详细论证见会话，关键依据见 §5）

1. **判型一行逻辑**：有对外链上转移 → `travelRule`；站内 swap / 法币 → `finance`。**金额不进判型**——阈值属 Sumsub TR 配置（低于自动 Not Applicable），演示 mock 的判型函数同口径。现 resolver 的 `∧VASP ∧阈值` 两条件删除。
2. **尽调不建实体**：见 §1。
3. **认领复用补料机制**：充值来源无主且超线 → 订单挂起（ACTION_PENDING 槽），客户在**现有补料入口**完成认领/申报，提交即回炉——不开新页面。
4. **提现地址允许第三方 + 申报**（法币加密两轨都放开）：登记时选受益人=第三方，填姓名+关系。**受益人不建主体**——只是条目字段 + 申报快照；其在 Sumsub 侧的唯一出现点是交易层 counterparty（波二）。
5. **unhosted 小额免认领线 = 3,500 AED 等值**；**关联累计升格不演**（业务缺口登 BACKLOG；Sumsub 按单笔判阈值的缝已登缺口清单 #5）。
6. 承接前轮已定（2026-10-19~21 讨论钉死）：所有权 2×2（签名/声明/申报）；地址**不可改只增/停/启**，放松动作（新增/启用）先过验证闸、收紧动作（停用）免门直执行；认领载体是交易、不可前置，仅沉淀可复用。**措辞澄清（评审后钉死）**："先筛后批"中的"批"在**客户自助地址簿语境下不是 maker-checker 审批**——客户地址的闸 = 筛查∥所有权两绿汇合 + 冷却，全程无审批单（与现状一致，冷却即人闸替身）；真 CFO 审批只存在于 LP 地址语境（另轮）。

## §3 波次划分

**波一 · 提现地址簿重造（地基）**
- 边界：`asset-treasury/withdrawal-addresses` 模块 + client-web 登记表单/详情 + admin 展示与 ⚡模拟面板 + 种子 + 剧本（V3 站 5 地址簿拍扩充）
- 交付物：ownerType 三档落库、第三方申报、托管自报×归因交叉红旗、筛查态 + 签名验证（mock）、两绿才冷却
- 验收口径：新场景走查（登记第三方地址申报 → ⚡筛查 → 签名验证 → 冷却 → ACTIVE；外加一条筛查命中 REJECTED 展品）+ 动 schema 走重铺闸全绿
- spec：`2026-10-22-counterparty-wave1-withdrawal-address-spec.md`（同日落档）

**波二 · 交易接线（消费波一字段）**
- 边界：充值（resolver 判型改造、归因⚡喂、VASP 区块与不合格分支、认领走补料回炉、"已知来源"沉淀）+ 提现（建单 counterparty 从地址簿条目带出、TR 状态展示、VASP 不合格分支同款）
- 验收口径：充值 unhosted 认领一幕（挂起→补料认领→回炉入账）+ VASP 不合格拒绝一幕 + 提现单详情可见受益人随报文（mock）
- 骨架：`2026-10-22-counterparty-wave2-skeleton.md`（已立）；展开 = 波一收尾写承接记录后，新会话读总纲+骨架跟业主脑暴

依赖顺序固定：波二消费波一的受益人/托管/归因字段，不可倒置。

## §4 本战役不做（对照根纲 §2 禁做清单）

- 关联累计监视器与升格剧目（业务缺口 → BACKLOG 已登）
- 真实 Sumsub 集成（全 mock；真集成差距见缺口清单）
- LP 侧地址/尽调改造（另轮；此前 LP 讨论的"尽调材料化"也被本总纲 §1 重切——届时直接引用 Sumsub 数据）
- VASP 名录页 / 尽调册实体 / webhook 真接 / PMC 真调
- 不为真实集成预留字段（如 sumsubPaymentMethodId）——YAGNI

## §5 研究底座（判断依据，已实证）

- **缺口清单**：`reference/sumsub-services-needed.md`（standalone 归因 403 / ownership 链支持缺配 / TR 规则未配 / 筛查触发待确认 / 累计口径待确认）
- **mock 触点登记册**：`reference/sumsub-mock-touchpoints.md`（本战役所有「站在 Sumsub 一侧」的 mock 触点——代码位置 / mock 行为 / 真 Sumsub 对应物 / 切换刀口；业主做 mock↔sandbox 切换的地图，波二新增触点续登）
- **判型依据**：Sumsub TR FAQ 原文三句——阈值客户自配、"only attempts data exchange above the threshold"、低于阈值自动 Not Applicable 且建议照常提交
- **认领机制**：挂起位 `needApplicantOwnershipConfirmation` 由 TR 规则 `Awaiting user` 动作驱动；webhook `applicantKytTxnAwaitingUser`；解锁接口 `POST /kyt/txns/{id}/travelRuleOwnership`
- **沙箱实证**：payment method 登记 200 + 筛查 YELLOW 落库；travelRule 型交易 200（强制申请人钱包+链上哈希）、零配置命中 Counterparty AML Screening 规则；VASP 名录实拉 637 家（EEC/风险标/监管登记行可读）
- **监管锚**：VARA CRM III.G.2（3,500 单笔或关联累计）/ III.G.6（对手方 VASP 尽调，关系级）/ III.G.7（unhosted 风险为本）；受益方义务 = 检测缺失 + 风险政策（一手研究：`reference/research/2026-07-04-v5-withdraw-compliance-research.md`、`2026-07-06-v4-deposit-research.md`）

## §6 收尾义务

- 每波按 `rules/delivery-checklist.md`；裁定已合并落 `decisions.md`（2026-10-22 对手方层六拍板条目）
- 波一收尾：往波二骨架写承接记录；本总纲活到波二收官后随批归档
