# 波一 · 提现地址簿重造 spec

> 总纲：`2026-10-22-counterparty-layer-charter.md`（裁定与不做清单以总纲 §2/§4 为准）
> 现状实查日期：2026-10-22（schema + workflow 服务逐行核过）

## §0 本任务做 / 不做

**做**：提现地址簿的受益人三档模型、第三方申报、托管自报×归因交叉、筛查态与签名验证（全 mock）、状态机扩边、两端前端、审计码、种子与剧本。

**不做**（对照根纲 §2 + 总纲 §4）：交易侧任何改动（判型/充值/提现单——波二）｜真实 Sumsub 调用｜LP 侧｜累计监视器｜为真集成预留字段｜幂等/重试/并发锁等技术兜底。

## §1 现状（实查，别按旧文档想象）

地基比模块文档描述的多，**本波是改造不是新建**：

- schema `WithdrawalAddress` 已有：`addressNo`（业务键 ✓）、`addressType`（`VASP`/`SELF_CUSTODY`/`BANK`，注册时由 mock 归因写入）、`beneficiaryName`（可选，**且 `updateAddress` 允许事后 patch——本波要冻结**）、`counterpartyVaspName/Did`（归因产物）、`ownershipProofType`（**恒写 `'DECLARATION'`，本波升级为真枚举**）、`ownershipDeclaredAt`
- 归因已存在：`mock-travel-rule.adapter.ts#attributeAddress`（尾号 `1111` = Mock VASP）——沿用扩展，不重写
- 状态机五态（`withdrawal-address-transitions.constant.ts`）：`PENDING_ACTIVATION --ACTIVATE--> ACTIVE`｜`--CANCEL--> CANCELLED`｜`ACTIVE ⇄ SUSPENDED`｜`--DEACTIVATE--> DEACTIVATED`
- 规则保留：24h 冷却、每网络 3 条、首法币账户免冷却、金库 ⚡暂停/恢复/跳过冷却、sweep 懒激活
- 法币与加密是两条注册路径（`createBankAccount` / crypto 注册），两条都要改

## §2 目标终态

### 2.1 字段（新增/改造）

| 字段 | 取值 | 说明 |
|---|---|---|
| `ownerType`（新） | `SELF` / `THIRD_PARTY` | 受益人是否客户本人 |
| `beneficiaryRelationship`（新） | 自由文本 | 第三方时必填（如"配偶"） |
| `declaredHosting`（新） | `SELF_CUSTODY` / `VASP` | 客户自报托管类型（crypto 路径；法币不问） |
| `hostingMismatch`（新） | bool | 自报 ≠ 归因（`addressType`）时置真——**红旗留痕不拦截** |
| `screeningAnswer`（新） | `GREEN` / `YELLOW` / `RED` + `screenedAt` | 地址风险筛查结论（⚡喂） |
| `ownershipProofType`（升级） | `SIGNATURE` / `DECLARATION` / `ATTESTATION` | 2×2 的证据档（见 2.3）；现状恒 DECLARATION 改为按路由写 |
| `ownershipVerifiedAt`（新） | 时间 | 签名验证完成时刻（仅 SIGNATURE 路径） |

**我的裁定（可否）**：①不加 `sumsubPaymentMethodId`（mock 世界无意义，YAGNI）；②`beneficiaryName`/`ownerType`/`beneficiaryRelationship`/`declaredHosting` 登记后**冻结**——它们是申报证据，`updateAddress` 收窄为仅 `label`；改受益人 = 停旧条目 + **登记另一个地址**。③（评审后钉死）`@@unique([customerId, network, address])` **原样保留**：同一客户×网络×地址串一生一条，REJECTED/DEACTIVATED 占坑即**封禁语义**（打过红的地址这辈子进不来，合理政策不是缺陷）；不撤约束、不做应用层活态查重；REJECTED 不可复活（§5 原默认升为定案）。

### 2.2 状态机（扩一态两边，余者保留）

```
（登记）→ PENDING_VERIFICATION（新·落点）
   --两绿（筛查 GREEN/YELLOW ∧ 所有权证据落定）--> PENDING_ACTIVATION（冷却，沿既有）
   --筛查 RED--> REJECTED（新·终态）
   --CANCEL--> CANCELLED（既有边延伸到新态）
PENDING_ACTIVATION 及之后：全部沿既有边不动
```

- "两绿"是**字段级 AND 判定**，不拆成两个串行态（筛查与所有权并行等待，谁后到谁触发推进）——对应前轮结论"并行出结果，闸设在汇合点"
- **筛查默认即时 GREEN**（评审后钉死）：登记时筛查结论自动落 `GREEN`——依据项目允许假设"外部系统（mock）总是准时回调且只回一次"；"筛查人人过"语义不变（过 = 有结论，默认绿）。由此**第二幕"首法币即时生效"链路零改动**（法币登记 → GREEN 自动 + DECLARATION/ATTESTATION 即落 → 两绿 → 免冷却 → 即时 ACTIVE），`hasActiveFiatWithdrawalAddress` 交易起始门不受影响——此回归点列入验收
- **确定性测试地址**（业主 2026-10-22 补拍，于 plan 落档日）：mock 的筛查结论由**地址串本身**确定性驱动（同 Sumsub 沙箱 test values 套路）——否则演示者无法预知推进结局、验收没有判据。规则：地址/IBAN 尾号 `2222` → `YELLOW`（中风险放行进冷却留痕）；尾号 `3333` → `RED`（**登记即 REJECTED**——插入即终态，同首法币直落 ACTIVE 一样属登记落点计算、不是边）；其余 → `GREEN`。归因规则沿用不变（尾号 `1111` → VASP）；组合位不配（VASP×RED 波一用不上，对手方 VASP 不合格是波二订单裁决分支）。⚡面板由"演异常唯一通道"降为**覆写后门**（对已登记的 pending 条目改判）。测试地址完整串（魔法 IBAN 须预算过 mod-97 校验）固化进 `demo/data.md` 速查表
- ⚡喂 RED 可作用于两个 pending 态（PENDING_VERIFICATION / PENDING_ACTIVATION）→ REJECTED；展品拍的自然载体 = 一条"自托管×本人、尚未签名"的条目（它天然停在 PENDING_VERIFICATION 等签名，⚡喂 RED 正好演筛查拒绝）
- YELLOW 放行进冷却（政策：中风险收下留痕）；RED 即 REJECTED，留筛查结论可查
- 首法币免冷却规则保留：两绿后直接 ACTIVE（跳过 PENDING_ACTIVATION）
- **客户地址簿无 maker-checker 审批**（总纲 §2.6 措辞澄清）：闸 = 两绿汇合 + 冷却，不新增审批类型、不接审批中心
- 非法跃迁 409，迁移表 spec 断言照既有模式补

### 2.3 所有权 2×2 落位（托管 × 受益人 → 证据档与动作）

| | 本人 | 第三方 |
|---|---|---|
| **SELF_CUSTODY** | `SIGNATURE`：登记后需**签名验证**（客户端按钮，mock 即点即过，落 `ownershipVerifiedAt`）——验证前所有权不算落定 | `ATTESTATION`：登记表单的姓名+关系即证据，登记即落定 |
| **VASP 托管** | `DECLARATION`：登记即落定（强闭环留给波二的 TR 报文比对） | `ATTESTATION`：同上 |

### 2.4 ⚡模拟控制面

- **admin 地址详情**加 ⚡区（demo controller 既有模式）：喂筛查结论（GREEN / YELLOW / RED 三按钮）
- **client-web 地址详情**：`SELF_CUSTODY × SELF` 且未验证的条目显示"钱包签名验证"按钮（mock 即过）——签名是客户动作，放客户端才像真的
- 归因在登记时同步跑（沿用 mock adapter），无需 ⚡

### 2.5 前端

- **client-web 登记表单**（crypto + bank 两式都改）：受益人选择（本人/第三方→姓名+关系必填）；crypto 式加托管自报单选
- **client-web 列表/详情**：显示 ownerType 徽标、第三方受益人信息、验证状态（待筛查/待签名/生效）
- **admin 详情**：新区块——归因结果（VASP 名称/自托管）、自报与红旗（`hostingMismatch` 醒目标识）、受益人档、筛查结论、所有权证据档；admin 列表加 ownerType 列
- UI 契约对照 `ui-contract/`；客户面不泄调查性字段（筛查 RED 的内部理由不外显，客户端只见"未通过"）

### 2.6 审计（名册五处登记——判例在案，一处别漏 exporter）

新码约 5 个（命名 builder 定）：筛查结论落地、签名验证完成、第三方申报落档、托管自报不一致红旗、筛查拒绝。全走既有审计管道，operator 动作（⚡喂筛查）记操作人，客户动作记客户主体。

### 2.7 种子与剧本

- 种子地址样本覆盖四格：本人×自托管（已签名 ACTIVE）、本人×托管（声明 ACTIVE）、第三方×托管（配偶 Li Hua，ACTIVE）、一条 REJECTED 展品（筛查 RED）
- ⚠️ 判例在案：`demo:withdraw` / `demo:all` 依赖种子地址——**`demo-lib.ts` 建地址路径必须同步新必填字段**，否则全新树必炸
- 剧本：V3 站 5 地址簿三拍扩为五拍（新增：第三方申报登记一拍；筛查+签名验证+红旗一拍——异常主通道走确定性测试地址，⚡作覆写后门另演一手）；`demo/data.md` 手写区加「mock 测试地址速查」（完整可复制串 + 各自的确定性结局），生成区同步

## §3 铁律对照

状态只沿边（迁移表 + 409 + spec 断言）｜操作必留痕（新码五处登记）｜对外业务键（addressNo 已有，前端继续用它）｜各管各的（本波零交易侧改动）｜不动钱（无记账）。

## §4 验收口径

- 走查：扩充后的站 5 五拍完整走通 + 客户端/管理台截图（前端改动必 preview 渲染验证）
- **第二幕回归点**：现场注册客户 → 登记首个法币账户仍**即时生效**、交易起始门照常解锁（`demo:all` 覆盖 + 走查第二幕②单拍复核一次）——筛查默认 GREEN 的设计就是为保这条链，专项验证防无声埋雷
- 闸：随手闸三件 + jest 本目录全绿 + client-web vitest（动了客户端）；**动 schema → 收尾重铺闸**：`stack.sh reset` 从零重铺 + `demo:all` 全绿对 baseline
- 数字判据：迁移表边数、审计码数、种子地址数——plan 阶段钉死预期终态数，改完复核

## §5 留给 builder

枚举具体命名与迁移文件写法｜前端组件拆分｜审计 metadata 形状｜五拍剧本的具体文案｜REJECTED 态是否允许金库 ⚡复活（我的默认：不允许，重登记）。
