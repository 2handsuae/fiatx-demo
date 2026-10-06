# 事件中心表单应然重设计（一揽子）· Spec

> 2026-10-07 ｜ 来源：甲段验收·事件中心走查三轮讨论，业主逐项定稿（BACKLOG 对应行同日销账时删除）
> 状态：待业主过目 → 开 worktree 施工

## 0. 背景与目标

事件中心（Incident Register）的登记弹窗与定损表单在甲段验收走查中暴露四类问题：登记表单三层字段混杂、与类型无关的字段制造语义噪音；两个对账族类型留在通用下拉里是 400 陷阱；定损表单"结论可选集"存在语义漏洞且钱口径无处写依据；依据码选项以法条全文呈现、认不出是码。本任务一揽子修正，**只动表单层与校验层，不动状态机、不动审批链、不动数据库结构**。

## 1. 本任务做 / 不做

**做**：①登记弹窗两段化重排；②手动登记下拉 9→7；③定损表单五处改（含后端真门）；④依据码选项加短码前缀；⑤详情页两卡同口径重排；⑥受影响单测与文档同步。

**不做**（对照 CLAUDE.md §2 与业主明确放下的项）：损失分解明细 ｜ 证据附件 ｜ 多币种拆分 ｜ 善后单自动回挂（业主 2026-10-07 放下）｜ 重定损边（业主放下）｜ 管理台侧升级通知（悬案另议）｜ 任何 schema 迁移。

## 2. 登记弹窗重设计（两段结构）

**Common details**（九类一致）：`Type`（下拉）｜ `Title`*｜ `Description`*。没有第四个字段。

**Type-specific details**（全部随类型渲染，`*` = 必填；必填口径与现状完全一致，只动分组与显隐）：

| 类型 | 字段 |
|---|---|
| 未授权转出 | Source Case No* ｜ Source Disposition Line No* ｜ Asset ｜ Amount |
| 大额查不出 | Source Case No* ｜ Asset ｜ Amount（**砍 Customer No**——查出归属就不叫 unexplained） |
| 客户欠款 | Customer No* ｜ Amount* ｜ Asset ｜ Source Advance Transfer No |
| 网安 | Affected system*（受控下拉）｜ BCDR triggered（勾选） |
| 数据泄露 | Affected customer count* ｜ Data categories*（多选） |
| 外包故障 | Vendor*（受控下拉）｜ Service impact* |
| 资产不合规 | Asset* |
| 大额卡单 | Order No* ｜ Customer No* ｜ Amount* ｜ Asset |
| 审慎穿底 | Metric (NLA)* ｜ Shortfall amount* |

**payload 分流不变**：`customerNo`/`assetCode`/`amount` 仍落顶层键（`TOP_LEVEL_ANCHOR_KEYS` 分流规则原样），其余进 `subjectRefs`——展示分组与落库分流解耦，后端零改动。

**详情页同口径**：`IncidentDetailPage.tsx` 的 Basic Info 卡收缩为 Common 三件 + 登记人/时间/状态等元信息；来路字段（案件号/定性行/垫款单号）搬进 Type-Specific Details 卡，与 `subjectRefs` 锚同屏。

## 3. 手动登记下拉 9→7

- 无 `prefill` 打开弹窗时，Type 下拉只列 **7 类**（去掉未授权转出、大额查不出）。理由：这两类的锚只能从对账流程长出（定性行出口=INCIDENT / 案件超账龄线），对账案件页的条件按钮才是自然入口；通用下拉里是 400 陷阱；与投诉升级"只能从源头进"同一哲学。
- **prefill 例外（实勘确认的硬约束）**：案件页三入口经同一个弹窗组件传 `prefill.type`。带 `prefill.type` 时，Type 控件**锁定为该类型只读显示**（不渲染下拉）——两个被砍类型经此路照常登记，且顺带消灭"从案件页进来还能手滑换类型"的既有隐患。
- **后端不动**：`POST /admin/incidents` 维持接受九类（案件页与通用弹窗共用端点；锚校验已是真门，手搓请求缺合格锚照样 400）。

## 4. 定损表单重设计

统一骨架四段：**结论 + 数字 + 说明 + 通报判定**。

### 4.1 结论按类型收窄（真门——业主拍板）

- 注册表 `incident-type-registry.ts` 新增列 `allowedAssessmentBases: readonly string[]`（八格一行变九格）：资金族三类 = 四选原样；大额卡单 = 四选原样；网安/外包故障/资产不合规/投诉升级 = `['SERVICE_IMPACT']`；数据泄露 = `['DATA_IMPACT']`；审慎穿底 = `['SHORTFALL']`。
- **服务层**：`IncidentService.assess()` 的合法结论校验从"按口径查 `ASSESSMENT_BASIS_BY_SCHEME`"改为"按类型查 `cfg.allowedAssessmentBases`"，越集 400——前端收后端放是假门，此处封死。
- **前端**：镜像常量同步；合法集只有 1 个值的类型，结论控件渲染为固定值文本（不渲染下拉）。

### 4.2 定损说明（三口径必填）

- **复用现有 `impactSummary` 列**，零迁移。钱/缺口口径从"无处写依据"改为必填。
- 展示名按口径区分：IMPACT 口径维持 **"Impact summary"**（场景 25 剧本措辞零改动）；MONETARY/SHORTFALL 口径显示 **"Assessment note"**。
- 服务层：`assess()` 三口径均必填该字段（现状仅 IMPACT 必填）。

### 4.3 金额带币种（业主拍板细则）

- 仅钱/缺口口径适用。登记时 `assetCode` 有值 → 定损页只读显示，不可改；登记时为空 → 定损时**必填补**，`assess()` 落 `assetCode` 列。
- DTO 新增可选 `assetCode`；服务层：行上已有值时忽略传入值（以行值为准，防前后不一致），为空且口径要求时必填强制。

### 4.4 登记锚 → 定损预填打通（纯前端）

- 数据泄露：`impactCount` 预填登记锚 `affectedCustomerCount`（查实可改）。
- 审慎穿底：`assessedAmount` 预填登记锚 `shortfallAmount`（查实可改）。
- 外包故障：说明字段预填登记锚 `serviceImpact`（查实可改）。
- 语义：登记=初判、定损=查实，两次留痕、第二次可改。

### 4.5 零候选类型的通报区

- 资产不合规 / 投诉升级：撤掉置灰勾选框，换一行静态说明——资产不合规："No reporting obligation — the duty is immediate asset suspension, not reporting"；投诉升级："No complaint-specific reporting obligation under VARA Market Conduct"。

## 5. 依据码短码前缀

- 定损表单的依据码复选项、Regulatory Filings 卡的 Basis 列，渲染为 `` `TIR_K_H` — <法条全文> `` 形态（渲染处拼接，镜像常量 `INCIDENT_REPORT_BASES` 本体不动）。

## 6. 触点清单

| 文件 | 改什么 |
|---|---|
| `admin-web/src/pages/IncidentListPage.tsx` | §2 弹窗两段化、§3 下拉 7 类 + prefill 锁定 |
| `admin-web/src/pages/IncidentDetailPage.tsx` | §2 两卡重排、§4 定损表单四项、§4.5 静态说明、§5 前缀 |
| `admin-web/src/utils/incidentStatusMap.ts` | §4.1 合法结论集镜像、标签补充 |
| `src/modules/governance/incidents/incident-type-registry.ts` | §4.1 `allowedAssessmentBases` 列 |
| `src/modules/governance/incidents/incident.service.ts` | §4.1 按类型校验、§4.2 三口径必填、§4.3 币种落列 |
| `src/modules/governance/incidents/incident.constants.ts` | `AssessIncidentDto` 加 `assetCode?` |
| `src/modules/governance/incidents/*.spec.ts` | 定损校验用例随 §4.1/4.2/4.3 更新 |
| `doc-final/modules/v1-governance.md` §7 | 表单与定损口径两段描述同步 |
| `doc-final/demo/script.md` 场景 25 | 核对即可（实勘：措辞与新方案兼容，预期零改动） |
| `doc-final/BACKLOG.md` | 对应行销账 |

## 7. 验收判据

1. 闸门①②③（三栈 tsc）全绿；事件目录 jest 全绿（含按 §4 更新后的用例）。
2. **真门行为证据**：对数据泄露类事件直接调 `POST /:no/assess` 传 `SERVICE_IMPACT` → 400（绕过前端被拦）；钱口径缺说明 → 400；登记无币种且定损未补 → 400。
3. **preview 截图**（闸⑤）：九类登记弹窗各一张（Common 段逐张一致、专属段各异、网安等四类零钱味字段）；prefill 锁定态一张（案件页入口类型只读）；定损表单四形态各一张（钱带说明+币种 / 缺口预填 / 影响 / 零候选静态说明行）；依据码前缀一张。
4. **回归**：对账案件页三入口照常可登记两个被砍类型（prefill 路）；场景 25 全弧照剧本重走一遍通过。
5. 重铺闸⑧：`stack.sh reset main` + `demo:all` 全绿（种子定损值均在新合法集内——施工首任务先实勘种子与 demo 脚本的 `assess` 调用点清单，若有越集值按目标终态改种子，不做兼容层）。

## 8. 风险与边界

- **种子/演示脚本兼容**：§4.1 收窄与 §4.2 必填可能命中种子或 demo 脚本里的既有 `assess` 调用——施工首任务全量 grep 清点（`assess(` 调用方 + 种子事件定损值），越集/缺字段的按目标终态改数据侧，禁止在校验里开后门（CLAUDE.md §3：数据可重铺）。
- **prefill 回归**是本次唯一可能破坏既有演示主线（第六幕场景 18、场景 31）的点，判据 7.4 钉死。
- 展示名"Assessment note"只进钱/缺口口径，IMPACT 口径文案不动——场景 25 剧本零 churn 是刻意选择。
