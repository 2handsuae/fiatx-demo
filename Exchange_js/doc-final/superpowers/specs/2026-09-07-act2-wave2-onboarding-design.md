# 第二幕客户域 · 波二「入驻重建」spec

- 日期：2026-09-07 ｜ 总纲：`2026-09-06-act2-customer-waves-outline.md`（跨波口径直接引用，不重议）｜ 本文吸收并取代同名骨架（承接波一见下节）
- 性质：多波之波二。业主脑暴收口 2026-09-07：CDD 直通 / EDD 设我方准入门（高管批）/ 材料零存储 / 新客 = 首次 ACTIVE / 演示客户现场注册——五条裁定已录 `decisions.md`
- 模拟基调：**演示主线走模拟分支**（⚡ 喂 webhook，零外部依赖）；webhook 形状、externalUserId、level 概念全部按真 Sumsub 契约保真（`sumsub-integrate-websdk` skill 口径），真接时只换 `SUMSUB_MOCK_MODE`，不改形状

## 本波做 / 不做

**做**：注册 → 发起认证 → CDD 表单 → 裁决 → ACTIVE 直通；EDD 换档旁支（SoF/SoW → 裁决 → 运营提单 → 高管准入批）；被拒（RETRY/FINAL 分治）/ 撤回 / 重申；生命周期状态机接上驱动 + 一条新边；客户主表加 7 列并回填种子；摄取分发器申请人级开路；⚡ 入驻模拟；准入审批新动作类型；客户端认证页与 gate 页接线；新客费率档种子；入驻族审计码；第二幕剧本重写。

**不做**（对照 §2 与总纲）：销户清退（OFFBOARDED 仍只留边）、定期风评、机构客户、档位升级（波三）、重申次数/冷却限制、真接 Sumsub 联调（形状保真但不联）、webhook 签名校验/幂等去重（技术兜底）、认证中途自由切换 level（业主明确只模拟 CDD→EDD 一条换档路径）。

## 承接波一（2026-09-06 收尾填，原骨架内容）

- **偏差①** 材料策略加载器现居 `material-requests/material-policy.ts`，每材料只剩 `sumsubActionLevelName`——那是**动作级** level；本波入驻用的是**申请人级** level，另立常量（§3），互不相扰，波三扩档位时再统一看
- **偏差②** Sumsub 摄取现状两路（三域 KYT 级联 + 材料请求裁决），申请人级事件落 unrouted warn——本波开路位置即 `sumsub-ingestion.service.ts` Clues 4&5 段（:206 附近，注释自证"一期重做在此重新开路"）
- **偏差③** `MATERIAL_REQUEST_TERMINAL` 保留在册（状态机不变量断言消费）——本波不动材料请求状态机，仅备忘
- **新事实**：三域列表 `ownerNo` 过滤已通｜verify:act1 现 24 判据｜V2 审计码 14｜demo:all 花名册只断终态不校验费率档（→ §11 验收须直接断言报价）｜`demo-shot.js` 支持 `--select`/`--type` 有序交互
- **前提确认**：`customer-lifecycle.constant.ts` 状态表在册零调用待接✓；`onboardingApprovedAt`/`sumsubApplicantId`/`sumsubCurrentLevelName` 接线点健在✓；客户表 24 字段口径已落✓；终拒徽标已在客户详情✓
- **本会话新核实**：client `AuthGuard.tsx` 生命周期四步 gate 页**活着且文案齐全**（PROSPECT/IN_VERIFICATION/PENDING_APPROVAL/REJECTED/WITHDRAWN 各有其屏），站6 只摘了 CTA（:207 注释"重做接真 Sumsub 后再开门"）——本波开门即可，不重建；受众谓词已有 VIP 一档实例（`seed.business.ts:309`），新客档照抄先例
- **收尾闸残留**：verify:act1 B6 → verify:demo-data R5 顺序敏感缺陷已在 TOOLING-DEBT（预置，非本波回归）

## §1 流程主线

**路径一 · CDD 直通**（低风险，全程零我方人工——行业标准直通处理）

```
注册(已有,落PROSPECT) → 客户端"开始认证" → 后端mock建applicant、绑id+CDD档名
  → START_VERIFICATION → IN_VERIFICATION
  → 客户端CDD表单(五项基础信息) → 提交(五列入主表,落onboardingSubmittedAt)
  → ⚡喂 applicantReviewed GREEN → CDD_CLEARED → ACTIVE、onboardingApprovedAt落值(新客标签亮)
  → 既有交易起始门衔接:登记首个法币账户(即时生效) → 拿兑换报价见新客价
```

**路径二 · EDD 换档**（CDD 提交后，⚡ 喂的不是裁决而是换档）

```
…CDD提交后 → ⚡喂 applicantLevelChanged(EDD) → eddRequired=true、档名切EDD、
  清onboardingSubmittedAt(状态轴不动,仍IN_VERIFICATION)
  → 客户端切EDD模板(SoF+SoW上传位,零存储) → 提交(只落onboardingSubmittedAt)
  → ⚡喂 GREEN(=MLRO在Sumsub完成的裁决) → VERIFICATION_PASSED → PENDING_APPROVAL
  → 运营在客户详情"提请准入核准" → 审批中心单 → 高管批 → FINAL_APPROVED → ACTIVE(同落onboardingApprovedAt)
```

**旁支**：RED+RETRY → REJECTED，可重申（REAPPLY → IN_VERIFICATION，同一 externalUserId 续用同一 applicant，不重建）；RED+FINAL → REJECTED 且 `onboardingFinalRejectedAt` 落值，REAPPLY 守卫拒绝，客户端只给中性文案；高管拒单 → FINAL_REJECTED → REJECTED，**可重申**（尽调终拒才堵死，商务拒收允许再来）；IN_VERIFICATION 可撤回（WITHDRAW_APPLICATION → WITHDRAWN，可重申）。

## §2 状态机改动（`customer-lifecycle.constant.ts`）

- **新增动作 `CDD_CLEARED`**：边 IN_VERIFICATION → ACTIVE（铁律④加边；语义 = 低风险直通，Sumsub GREEN 即终点）
- 既有边语义钉死：VERIFICATION_PASSED = EDD GREEN（KYC 完成，待我方准入）；FINAL_APPROVED = **高管准入批准**；FINAL_REJECTED = 高管拒收
- REAPPLY 加守卫：`onboardingFinalRejectedAt` 非空 → 显式拒（BadRequest，语义"尽调终拒不可重申"）
- 驱动接线：所有迁移经 `nextLifecycle()` 唯一入口（非法边显式抛，波一保留的地基自此有调用方）；ACTIVE 无回头边不变（INV-1）
- `onboardingApprovedAt` 写入纪律：**仅当为 null 时落值，永不覆盖**——新客窗口只开一次，将来任何加边都不重开

## §3 字段账（24 → 31，个个有主）

| 新列 | 类型 | 写方 | 读方 |
|---|---|---|---|
| `dateOfBirth` | DateTime? | CDD 表单提交 | 客户详情、准入核准单快照 |
| `nationality` | String? | 同上 | 同上 |
| `idDocType` / `idDocNumber` | String? | 同上 | 同上 |
| `residentialAddress` | String? | 同上 | 同上 |
| `onboardingSubmittedAt` | DateTime? | CDD/EDD 提交端点；换档与重申时**清空** | 客户端会话端点（渲染表单 vs 等待态，防刷新丢态）、客户详情 |
| `onboardingFinalRejectedAt` | DateTime? | RED+FINAL 裁决处理器 | REAPPLY 守卫、客户详情终拒徽标、客户端中性文案分支 |

既有字段接上写方：`sumsubApplicantId` + `sumsubCurrentLevelName`（发起认证时绑，换档时改档名）、`eddRequired`（applicantLevelChanged 落 true）、`onboardingApprovedAt`（CDD_CLEARED / FINAL_APPROVED 两处，null 时一次性）、`lifecycle`（全部经状态机）。**不复用 `hardLineDispositionedAt`**（那是交易硬线 sticky，各管各的）。

**材料零存储规矩（统一，写进 v2 篇）**：凡经 Sumsub 采集的材料（EDD 的 SoF/SoW 含在内），我方一个字节不落、连名录不记——真身在 Sumsub，我方只认 webhook 结果。与交易侧补料同律；波三补高级材料照此办理。

**申请人级 level 常量**（新建 `identity/constants/onboarding-level.constant.ts`）：CDD 档 `basic-cdd-level`、EDD 档 `edd-sof-sow-level`（Sumsub 风格命名，值存 `sumsubCurrentLevelName`）；每档带前端模板描述符（CDD = 五字段表单；EDD = 两个上传位），客户端会话端点下发。

**种子回填**（九位客户矩阵零增减，`demo/data.md` 同步）：7 位 ACTIVE 客户补齐 CDD 五列（可信值）+ `sumsubApplicantId`（缺的补 mock id）+ `sumsubCurrentLevelName`（Carol/Frank = EDD 档，其余 CDD 档）+ `onboardingApprovedAt` **回填数月前**（数据齐全且天然出新客窗口，30 天窗见 `NEW_CUSTOMER_DAYS`，花名册费率不受扰）；Dave（IN_VERIFICATION）补 applicant id + CDD 档名、五列与 submittedAt 留空（"还没交表"）；Eve（PROSPECT）全空。

## §4 Sumsub 模拟与摄取开路

**webhook 形状**（照真，字段名与真 Sumsub 一致）：
- `applicantReviewed`：`reviewResult.reviewAnswer` GREEN/RED + `reviewRejectType` RETRY/FINAL
- `applicantLevelChanged`：目标档名（本波只认 CDD→EDD 一条）

**摄取分发器**（`sumsub-ingestion.service.ts` Clues 4&5 处开路）：按 applicantId 反查客户（现成代码）后——`applicantLevelChanged` → 换档处理（eddRequired/档名/清 submittedAt + 审计）；`applicantReviewed` → 按客户当前档名分流：CDD 档 GREEN → CDD_CLEARED；EDD 档 GREEN → VERIFICATION_PASSED；RED → VERIFICATION_REJECTED（FINAL 加落 `onboardingFinalRejectedAt`）。仍未命中的照旧落 unrouted warn。守卫：客户不在 IN_VERIFICATION 或未提交（submittedAt 空）时到达的裁决/换档事件，显式拒并警告；换档事件另须客户当前在 CDD 档——非法迁移不静默。

**⚡ 模拟端点**（`admin-sumsub-simulation.controller.ts` 加两枚，与既有 applicant-action-result 同款：拼合成 payload → `ingest()`，isSimulated）：
- `POST onboarding-review-result`：{customerNo, answer, rejectType?}
- `POST onboarding-level-change`：{customerNo}（固定升 EDD）

**⚡ 前端面板**：admin 客户详情加"入驻模拟"区（模拟模式门控，同三域 ⚡ 惯例），四按钮：认证通过 / 拒绝-可重试 / 拒绝-终拒 / 升级 EDD；按钮可用性跟客户状态走（仅 IN_VERIFICATION 且已提交时亮裁决钮；升 EDD 仅 CDD 档已提交时亮）。

## §5 准入审批线（审批中心新动作类型）

- 类型 `CUSTOMER_ONBOARDING_ACCEPTANCE`（高风险客户准入核准），**单步高管批**（checker 与站4/5 高管同一角色码，执行时以 rbac 为准）；按判例（2026-09-05）**三处同加**：routes + detail-read + maker
- maker = 运营：`POST /admin/customers/:customerNo/onboarding-acceptance` 提单（铁律⑥业务键），守卫 = 客户在 PENDING_APPROVAL 且无在批单；单据快照：customerNo、riskRating、eddRequired、档名、submittedAt、Sumsub 裁决摘要——**审的是"接不接这个高风险客户"，不是重审尽调**（MLRO 的活 100% 在 Sumsub，不碰管理台）
- 裁决处理器：批准 → FINAL_APPROVED（→ ACTIVE、onboardingApprovedAt）；拒绝 → FINAL_REJECTED（→ REJECTED）
- **不加"待提交"状态**：PENDING_APPROVAL 本身就是等待位，"单子提了没"从关联审批单推导展示（"准入核准：未提请 / 审批中 APR-xxx"）——"单子在批不是状态"，与便签教义同构

## §6 客户端

- **gate 页开门**（`AuthGuard.tsx`）：四步拦截页文案原样保留，把站6摘掉的 CTA 接回——PROSPECT"开始认证"/ IN_VERIFICATION"继续认证"→ 认证页；REJECTED"重新申请"→ 触发 REAPPLY 后进认证页（`onboardingFinalRejectedAt` 非空时**不渲染 CTA**，只给中性文案，不泄露 FINAL 语义细节）；WITHDRAWN 同 REJECTED；PENDING_APPROVAL 维持"等待终审"陈述屏
- **认证页**（新页，路由仿 `MaterialVerification.tsx` 双分支惯例）：模拟分支按档名渲染我方模板（CDD 五字段表单，姓名自注册预填可改 / EDD 两个上传位，选了文件只在页内展示不上传）；已提交（submittedAt 非空）→ "资料已提交，等待审核"屏；真接分支保留 WebSDK 容器路（`getSdkToken` + snsWebSdk，形状同补料页）
- **撤回入口**：认证页/gate 页在 IN_VERIFICATION 时给"撤回申请"（打 WITHDRAW_APPLICATION）
- **后端客户面端点**（照 `/onboarding/me` 惯例不进 rbac 目录；tipping-off 红线：响应不出现 blocked 类字段）：发起认证（建 applicant + START_VERIFICATION）/ 会话查询（档名 + 模板描述符 + submitted 态）/ 提交（CDD 落五列，EDD 零存储，均落 submittedAt）/ 撤回 / 重申

## §7 管理台

- 客户详情：CDD 五列展示进基本信息区；档名 + eddRequired + submittedAt 展示；PENDING_APPROVAL 时运营见"提请准入核准"按钮与关联单状态；`onboardingFinalRejectedAt` 非空复用波一终拒文字位口径（入驻语境文案："尽调终拒 · 不可重新申请"）；⚡ 入驻模拟区（§4）
- 客户列表：lifecycle 筛选已支持（波一核过），PENDING_APPROVAL 即运营工作队列，不另建页
- 新增 admin 路由全部登记 `rbac.catalog.ts`（提单 1 + ⚡ 2）

## §8 新客费率档

照 VIP 受众档先例（`seed.business.ts:309`）：种一档 USDT→AED 兑换费率，`requiredTagsJson=['NEW_CUSTOMER']`，费率低于 STD 对应档（cheapest-wins 保证新客命中）。种子客户全部出窗（§3 回填），花名册与站2对照不受扰。演示拍：现场客户 ACTIVE → 管理台标签区见 NEW_CUSTOMER → 客户端报价费率栏见新客价——第二幕与第一幕当场握手，V3 体检 F-R1 的标签侧病根同波痊愈。

## §9 审计合同（V2 域 14 → 22 码，出生第一天就对）

新增 8 码（domain CUSTOMER、客户级 correlationMode N，同册惯例；主对象一律 customerNo；requiredFields 执行时按词表家风定，下列为语义要求）：

| 码 | 触发 | actor |
|---|---|---|
| ONBOARDING_VERIFICATION_STARTED | 发起认证（绑 applicant + 档名入 afterData） | 客户 |
| ONBOARDING_SUBMITTED | CDD/EDD 提交（档名入 afterData） | 客户 |
| ONBOARDING_LEVEL_CHANGED | 换档（before/after 档名） | SYSTEM（webhook 驱动，recordSystem） |
| ONBOARDING_VERDICT_APPLIED | 裁决落轴（answer/rejectType/档名/目标态） | SYSTEM |
| ONBOARDING_WITHDRAWN | 客户撤回 | 客户 |
| ONBOARDING_REAPPLIED | 重申 | 客户 |
| ONBOARDING_ACCEPTANCE_SUBMITTED | 运营提准入单（单号入 afterData） | 运营（recordByActor） |
| ONBOARDING_ACCEPTANCE_DECIDED | 高管批/拒落轴（decision + 单号） | 高管（recordByActor） |

注册沿用既有 CUSTOMER_CREATED（执行时核对注册路径确已写入，缺则补调用）。审批中心自身的 governance.approval.* 事件照框架自动留痕，不重复记。

## §10 剧本与演示数据

`demo/script.md` 第二幕重写为四段（重写幅度 = 整幕替换，走查顺序如下）：
1. **静态矩阵**：9 位种子状态一屏（原①保留）
2. **现场开户 · CDD 直通**（新高光）：现场注册客户 A → 发起认证 → 填 CDD 表单 → ⚡GREEN → 当场 ACTIVE → 标签区新客亮 → 登记首个法币账户（即时生效）→ 客户端拿报价见新客价；顺手演旁支：⚡RED-RETRY → 客户端重申（同一 applicant 续）
3. **现场开户 · EDD 高风险**：现场注册客户 B → CDD 提交 → ⚡升 EDD → 传 SoF/SoW → ⚡GREEN → 切运营提准入单 → 切高管批 → ACTIVE；讲一句"MLRO 的审在 Sumsub 完成，我方批的是接不接这个客户"
4. **便签联动**（原②③④⑤保留）：Carol 静默 / Ivy 明示 / Bob 贴签三域联动 / 撕签走门 / 材料请求

现场注册客户即用即弃（重演再注册新邮箱，不依赖 reset）；`demo/data.md` 同步：种子回填口径（§3）+ 新客费率档条目 + 现场注册客户命名约定。

## §11 验收口径

1. **走查五景**（截图，`demo-shot.js`）：CDD 全程直通（注册→ACTIVE→新客标签→报价新客价）｜EDD 全程（换档→上传→提单→高管批→ACTIVE）｜RED-RETRY 重申走通（同 applicant）｜RED-FINAL 客户端中性文案 + gate 页无重申 CTA + 管理台终拒徽标｜撤回→重申
2. **铁律**：④每次迁移经 `nextLifecycle()`，非法喂 ⚡（如未提交先裁决、FINAL 后重申）显式拒；①走查每步在审计日志按 customerNo 查得到对应码；⑥全程业务键无 UUID 外露
3. **报价直接断言**：现场客户新客价 ≠ STD 价（花名册不校验费率，不许只靠花名册）；种子客户报价不受扰（出窗验证）
4. **闸门**：①–⑤随手（含前端截图）；随码测试全绿（状态机新边与守卫 / 分发器路由 / REAPPLY 堵死 / 标签窗口 / 审批 handler）；收尾 ⑥demo:all 终态全绿 + ⑧reset 重铺（动 schema/seed）+ verify:rbac（+3 路由）+ verify:audit（词表 +8）
5. 合并后：重启 + `db:base:sync` + `stack.sh reset main`；按 `rules/delivery-checklist.md` 收尾；承接记录写入波三骨架，本 spec 归档

## 债务登记（执行中如证实则记，不在本波修）

- 真接 Sumsub 时的 webhook 签名校验、事件幂等 → PRODUCTION-NOTES（技术兜底）
- 高管拒收后客户长期滞留 REJECTED 的清退承接 → 并入 BACKLOG 既有销户缺口链
