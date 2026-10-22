# 波二 · 交易接线 骨架（待展开）

> 总纲：`2026-10-22-counterparty-layer-charter.md`｜展开时机：波一收尾写完承接记录后，新会话读总纲+本骨架跟业主脑暴

## 承接上一波（波一收尾 2026-10-22 填写）

**实落字段**（`withdrawal_addresses` 表，波二建单/判型直接可读）：`ownerType`（`SELF`/`THIRD_PARTY`，默认 SELF）｜`beneficiaryRelationship?`｜`declaredHosting?`（`SELF_CUSTODY`/`VASP`，法币恒 null）｜`hostingMismatch`（默认 false）｜`screeningAnswer?`（`GREEN`/`YELLOW`/`RED`）+`screenedAt?`｜`ownershipVerifiedAt?`；`ownershipProofType` 真值集 `SIGNATURE`/`DECLARATION`/`ATTESTATION`（`DEMO_FIXTURE` 已退场，R5 判别式改 traceId 前缀 `demo-setup-withdrawal-address`）。

**状态机终形**：7 态 9 边 7 动作——新 `PENDING_VERIFICATION`（落点：自托管×本人等签名）/`REJECTED`（终态，封禁语义：unique 占坑不可复活、不占 3 条名额）；新动作 `RELEASE`（签名触发，activatesAt=release 时刻+24h 重算）/`REJECT`。首法币直落 ACTIVE 与尾号 3333 登记即 REJECTED 都是**登记落点计算不是边**（RED 压过首法币）。

**mock 刀口**（波二判型/归因复用，登记册 `reference/sumsub-mock-touchpoints.md` 续登）：`TRAVEL_RULE_ADAPTER` token 下两方法——`attributeAddress`（尾号 1111→Mock VASP Exchange/did:mock:vasp-exchange-001）+ `screenAddress`（2222→YELLOW、3333→RED、默认 GREEN）；测试串速查表在 `demo/data.md`（含两枚过 mod-97 的魔法 IBAN）。⚡`POST /admin/withdrawal-addresses/:addressNo/simulate-screening` 挂 `DEMO_VERDICT_WRITE`。

**审计 5 新码**（现役 348）：`WITHDRAWAL_ADDRESS_SCREENED`（⚡覆写 operator）/`REJECTED`（⚡RED operator 或登记即拒 recordSystem，reason 'Screening returned RED at registration'）/`OWNERSHIP_VERIFIED`（客户）/`THIRD_PARTY_DECLARED`（客户，申报快照）/`HOSTING_MISMATCH_FLAGGED`（recordSystem）。

**客户面投影判例**（波二订单 VASP 区块照此口径）：client API 一律 24 键白名单（`withdrawal-address-customer-view.ts`），`screeningAnswer/screenedAt/hostingMismatch/suspendReason/suspendedBy` 永不出客户面——tipping-off 遮蔽在后端不靠前端；admin 全量。波二给充值/提现单加 VASP 展示区块时先定客户可见集。

**种子 11 条**：六人 bank（SELF+DECLARATION+GREEN）｜alice/bob TRON（已签名 SIGNATURE）｜grace 尾号1111 本人×托管｜kate 尾号1111 第三方（Li Hua/Spouse）｜jack 尾号3333 REJECTED 展品。剧本站 5 ④ 五拍（d=第三方申报、e=红旗/3333 即拒/签名/⚡RED 四看点，e 拍演员 demo_bob、名额未满才演 3333）。

**波二前提已核**：`withdraw-workflow.service.ts:296-315` 已有 `counterpartyIsVasp = registeredAddress.addressType==='VASP'`（建单读地址簿的锚点就在这）；kyt-txn-type.resolver 的 `∧VASP ∧阈值` 删除是波二的活，波一零触碰交易域。

**判例（执行中挣来的）**：①jest `-t transitions` 过滤假绿（spec 名不含该词，8 测全跳 exit 0）——闸命令禁 `-t`；②`verify-act1.ts` 的 `.stackports` 路径残留两级爬升（仓库压平前遗留），裸跑悄悄打 main 栈 3000——已根修对齐 verify-rbac；③verify:demo-data 必须在 demo:all 刚铺完的干净库跑（verify:act1 探针造的 WA-ACT1-B6 钱包会假红 R5）；④upsert update 分支不补新字段（项目 §3 禁 backfill，升级走 reset）；⑤S7 四行 sumsub demo 死行为既有基线红集（TOOLING-DEBT 在案），verify:rbac 判据=红集恒等；⑥Profile「Continue verification」死链为存量（BACKLOG 已登），认证正门=gate 页 Start verification。

## 已定事实（总纲裁定，不再翻案）

- 判型一行：对外 crypto → `travelRule`，swap/法币 → `finance`；resolver 删 `∧VASP ∧阈值`（阈值语义归 Sumsub 配置，mock 同口径）
- 充值 unhosted：≤3,500 AED 等值免认领走监控；超线挂认领 → **复用补料机制**（ACTION_PENDING + 材料账回炉，不开新页）；认领成功沉淀"已知来源"（下次同源免问）
- VASP 尽调三薄件：裁决分支"对手方 VASP 不合格"（⚡喂，同制裁命中形状）+ 订单详情 VASP 区块（名称/EEC/风险标/评分，mock）+ 政策口径一行进文档
- 提现：建单时 counterparty 从地址簿条目带出（受益人姓名随 mock 报文可见）；VASP 不合格分支同款
- 受益方义务口径：姓名缺失在 ≤3,500 为合法缺席；检测缺失 + 风险政策，不硬凑

## 待定岔口（展开时脑暴）

1. 充值/提现单上落哪些 TR mock 字段（来源托管/归因结果/VASP 名称/认领状态/TR 状态——落单表还是展示层拼装）
2. 认领表单的具体字段形状（复用材料请求的哪种材料类型；"是我的"分支要不要 mock 签名动作）
3. "已知来源"沉淀的载体（地址簿同表加方向标 vs 独立小表）与客户详情展示
4. ⚡归因喂放哪个面板（充值单详情 vs 既有 demo 面板）；VASP 不合格的处置出口（退回 vs 人工复核案）
5. 提现 TR 状态展示位置与文案（详情新区块 vs 时间线事件）
6. 判型改造对既有 jest 基线的冲击面（kyt-txn-type.resolver 消费方清点）
