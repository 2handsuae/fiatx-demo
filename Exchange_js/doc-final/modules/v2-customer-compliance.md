# V2 · 客户与合规（开户 / 生命周期 / 限制 / 持续尽调）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-09-06（第二幕客户域波一「清地基」后逐段核对）
> 演示幕次：第二幕「迎客」 ｜ 验收：第二幕走查（`demo/script.md`）+ 本篇 §4
> 范围：仅个人客户；机构客户显式禁用（`CorporateProfile`/`UboProfile` 表已随站6拆除，customerType 仍可选 CORPORATE 但零配套数据模型，入口禁用）。

## 0. 一句话定位

管**客户是谁、能不能干事**：开户准入（Sumsub 尽调 + MLRO 终审，本波未接，重建见总纲 `superpowers/specs/2026-09-06-act2-customer-waves-outline.md` 波二）、客户关系生命周期、限制管控（冻结/解冻）、持续尽调（材料请求 + 便签；定期风评 CRA / 材料时效巡查 2026-09-06 业主拍板永久不做）。V4–V6 每一笔交易动手前，都要先过这里的**能力门**。

## 1. 业务叙事

最重要的一件事：**"客户关系"和"能不能干事"是两根轴，分开管。** 关系轴（lifecycle）记录这个人和我们走到了哪一步——申请中、已开户、已离场；限制账（restrictions）记录他此刻被摁住了什么。制裁命中的客户关系仍是"已开户"——变的不是关系，是能力。这一分离是整个模块的地基。

**开户之路。** 申请人 → 发起认证（Sumsub 采集证件与人脸）→ 认证通过进待批 → **MLRO 终审**放行 → 正式客户。被拒和主动撤回可以重新申请；已开户的客户不会"退回申请中"——要么被限制账摁住，要么走离场终态。

**便签机制（限制账的白话名）。** 摁住一个客户 = 给他贴一张便签。便签的三个属性——**摁住哪些能力、客户自己看不看得见、谁有权撕**——不由操作员填写，由"原因"查表决定：制裁命中 → 静默便签（客户无感）、只有 MLRO 能撕；材料过期 → 明示便签（客户看得见提示）、运营能撕。**贴不用批、撕必须批**：贴是保护动作，制裁 24 小时上报窗口等不起审批，立即生效；撕是解除保护，必须过审批门。同一客户可以同时挂多张便签，各撕各的、互不牵连。

**全域联动。** 贴一张"全能力"便签的瞬间：他名下所有在途充值、提现单立即冻结，兑换单拦住推进——先冻人，单只是载体。

**持续尽调。** 材料账（material-requests）按需下发——Sumsub 推送 / 运营手发，客户端出现补料入口，提交后审核通过自动松绑；**材料账与限制账互补**——限制账说"你现在不能做什么"，材料账说"交什么材料才能松开"。

> **站6（2026-08-27，业主方案2）→ 2026-09-06 总纲推翻**：一期的入驻流程 / 定期风评（CRA）/ 高风险升级案曾整体拆除；业主 2026-09-06 拍板推翻"开户流程不演"口径，按总纲 `superpowers/specs/2026-09-06-act2-customer-waves-outline.md` 分波二（入驻重建）/ 波三（档位升级）接回，本波（波一）只清地基。本篇现只描述存活面：客户主档、生命周期轴、限制账、材料账。客户的 lifecycle 状态位与风险等级仍是种子铺设的演示事实，驱动待波二接上。

## 2. 状态机

| 主体 | 状态流 |
|---|---|
| 关系轴 lifecycle | `PROSPECT → IN_VERIFICATION → PENDING_APPROVAL → ACTIVE`；旁支 `REJECTED / WITHDRAWN`（可重新申请）；终态 `OFFBOARDED`。**不变量：不存在 ACTIVE 回头边**——已开户只能离场或被便签摁住 |
| 限制账（便签） | `OPEN → RELEASED`（撕签经审批；同便签多能力多行、按便签号整撕） |
| 材料请求 | `PENDING_SUBMISSION → SUBMITTED → APPROVED / REJECTED / CANCELLED`（被打回 RETRY 回到待提交，FINAL 拒绝进终态） |

## 3. 决策点与角色

| 动作 | 谁发起 | 谁裁决 | 要点 |
|---|---|---|---|
| 贴便签（冻结） | 合规 / 系统（材料请求下发按因由自动贴、交易域制裁命中自动贴） | **无审批，立即生效** | 保护动作等不起；理由与痕迹全留 |
| 撕便签（解冻） | 运营发起 | 按原因分流：制裁/硬拒 → **MLRO**；其余 → **运营主管** | MLRO 类必须关联依据单据，缺了直接拒 |
| 材料请求下发 | Sumsub 推送 / 运营手发 | — | 一次下发一行账，打回可重交 |

## 4. 演示脚本（第二幕 · 迎客）

1. **客户列表**：9 位种子客户的状态矩阵一屏看全（谁在申请、谁被摁住、谁高风险——见 demo/data.md）
2. **静默 vs 明示对照**（本幕高光）：管理台看 Carol 的制裁便签 → **切客户端登录 Carol：一切如常、按钮可点**（点了被中性文案拒绝，与普通受限响应逐字相同）；再看 Ivy：客户端明确显示受限提示——**同是被摁住，一个蒙在鼓里一个明白告知，这就是 tipping-off**
3. **现场贴签看联动**：给 Bob 贴"全能力"便签 → 他的在途充值/提现单当场全冻、兑换拦腿 → 三域列表逐一看
4. **撕签走门**：对 Bob 的便签发起解除 → 运营主管审批 → 恢复；对照 Carol 的制裁便签——只有 MLRO 能撕且要附依据
5. **材料请求**：给某客户手发一张材料请求 → 客户端出现补料入口 → 提交 → 审核通过自动松绑

演示口径两条：**开户流程本波仍不演，但已排入重建**（一期已拆，重建规划见总纲 `superpowers/specs/2026-09-06-act2-customer-waves-outline.md` 波二——种子客户直接处于各生命周期状态位，"认证中/新注册"是状态展示不是流程走查）；机构客户入口是禁用的（讲"当前版本只服务个人客户"）。

## 5. 关键技术节点（≤30 行）

- 关系轴 `identity/constants/customer-lifecycle.constant.ts → nextLifecycle()`（8 动作，非法边显式抛；状态表在册，驱动待波二接上——当前无生产调用方，客户 lifecycle 由种子直接铺设）
- 限制账 `identity/customers/`：`customer-restrictions.service.ts`（实体不变量：幂等键 customerId×cause×caseRef）｜ `customer-restriction-workflow.service.ts → openRestriction()/initiateRelease()/onReleaseDecided()`（贴即生效；撕按 releasePolicy 分流两条审批门）｜ 原因注册表 `constants/restriction-cause.constant.ts → RESTRICTION_CAUSE_POLICY`（范围/可见性/解除路径查表，人工不可填）
- **能力门（V4–V6 都调）** `customer-access.service.ts → resolve()`：唯一执法依据 = lifecycle 为 ACTIVE + 能力不在被摁清单；**`blocked`（含静默，服务端执法）与 `disclosedBlocked`（仅明示，客户面）分列是 tipping-off 命门**，客户面 DTO 禁止出现前者（契约测试逐文件扫描守着）；并入交易起始门（须有 ACTIVE 法币提现地址）
- 材料账 `material-requests/`（一行=一次下发；`externalActionId` 全表唯一、绝不下发客户面）；状态变更唯一入口 `nextMaterialRequestStatus()`（非法边显式抛）
- 客户端资料投影 `customers/customer-profile.controller.ts → GET /onboarding/me`（站6 自一期迁入，URL 保持不动；tipping-off 红线：响应只许 lifecycle/disclosedBlocked/disclosed）
- 留痕（站6-β，V2_CUSTOMER_AUDIT_ACTIONS 14 码）：主档 3 / 便签 4（双通道：系统命中 recordSystem、运营贴撕 recordByActor 且主对象=customerNo）/ 材料请求 7（绑单请求机会性携带父单旅程号）；全部落子表行——按单据查（材料请求号）/按客户查自此对身份域成立
- Sumsub 翻译层 `sumsub-ingestion/sumsub-ingestion.service.ts → ingest()/dispatch()`（webhook 统一入口；路由面两路=三域 KYT 级联 + 材料请求裁决，材料刷新监控随波一退役、申请人级入驻/风评/升级路由随一期拆除，未命中两路的事件落 `unrouted_*` 警告）

## 6. 演示缺口（BACKLOG 有账）

- **一期重做（已排波次）**：入驻流程 / 定期风评 / 高风险升级案已拆除；2026-09-06 业主拍板推翻"不演"口径，按 `superpowers/specs/2026-09-06-act2-customer-waves-outline.md` 分波二（入驻重建）/ 波三（档位升级）接回
- **制裁客户的订单级折叠未做**：贴签冻单后，管理台没有"这个客户名下全部被冻单"的聚合视图
- **销户只落了轴上位置**：OFFBOARDED 态在，完整销户流程（余额清退等）没做
- **材料终拒 → 离场清退流程未接**（原「REJECTED 便签长挂无人清理」缺口并入）：材料请求终拒后管理台已展示「尽调未完成 · 待离场处理」，但没有实际的销户清退动作承接，归 BACKLOG 销户缺口一并解决
- **机构客户全线 stub**：`CorporateProfile`/`UboProfile` 表已随站6拆除（非本波动作），customerType 仍可选 CORPORATE 但零配套数据模型，入口禁用
