# 第二幕客户域 · 波二「入驻重建」骨架

- 总纲：`2026-09-06-act2-customer-waves-outline.md`（跨波口径直接引用）｜ 性质：骨架——只记已定事实与待定岔口，**展开是波二新会话读总纲 + 承接后跟业主脑暴的活**

## 承接波一（2026-09-06 波一收尾填）

- **偏差① 策略加载器搬家不退役**：材料请求建单要按材料类型查 Sumsub 认证等级名——现居 `material-requests/material-policy.ts`（`MaterialPolicyLoader.getMaterialConfig()`），策略 JSON 已修剪到每材料只剩 `sumsubActionLevelName`；波二/波三要扩 level 概念在此基础上加
- **偏差② doc-monitoring 摄取路由随巡查摘除**：Sumsub 摄取现状**两路**（三域 KYT 级联 + 材料请求裁决），ongoingDocExpired 与申请人级事件一样落 unrouted warn——波二开申请人级路由时，unrouted warn 处即开路位置
- **偏差③ `MATERIAL_REQUEST_TERMINAL` 保留**：被状态机不变量断言（终态集合×迁移表一致性）消费，体检误判死码——波二动材料请求状态机时它是现成守卫
- **新事实**：三域列表后端 `ownerNo` 过滤已通（治好历史死过滤框，客户详情三域跳转在用）｜ verify:act1 现 24 判据（B13 随材料路由族退役）｜ V2 审计码 14 ｜ demo:all 花名册只断言终态、不校验命中费率档（BACKLOG 已记）——波二若铺新客受众档，验收别只靠花名册 ｜ `demo-shot.js` 支持 `--select`/`--type` 有序交互步骤（站2 档位对照截图即出自它）
- **前提确认（无变化）**：`customer-lifecycle.constant.ts` 状态表在册零调用待接；`onboardingApprovedAt` / `sumsubApplicantId` / `sumsubCurrentLevelName` 接线点健在；客户表 24 字段口径已落（波二新增字段按自己的 spec 走迁移）；终拒「尽调未完成 · 待离场处理」徽标已在客户详情
- **收尾闸残留**：verify:act1 B6 夹具污染 verify:demo-data R5 的顺序敏感缺陷已记 TOOLING-DEBT（预置、非波一回归）

## 已定事实

- **入驻要演示**（业主 2026-09-06，推翻站6「不演」）；流程主线：注册 → 发起认证（建 Sumsub applicant 绑 `sumsubApplicantId`/`sumsubCurrentLevelName`）→ 模拟认证 → 裁决 → **MLRO 终审** → ACTIVE；旁支被拒 / 撤回可重申；终态 OFFBOARDED 不在本波（销户 BACKLOG）
- **Sumsub 当合规台不自建审核台**（decisions 2026-07-14）：采集与裁决在 Sumsub（模拟），我方只做终审与状态轴
- 状态机地基 = 波一保留的 `constants/customer-lifecycle.constant.ts`（7 态 8 动作，铁律④沿边走）；本波把驱动接上
- `onboardingApprovedAt` = MLRO 放行落值 → NEW_CUSTOMER 派生标签自此激活（费率侧联动见岔口）
- EDD 分支用 `eddRequired`；AML/制裁命中走限制账（贴静默签），不另设字段
- 摄取分发器 `sumsub-ingestion.service.ts` 的 unrouted 警告处（Clues 4&5）= 申请人级路由重新开路的位置
- 新审计合同出生（BACKLOG:99 口径：词表 / 子表 / 旅程号第一天就对）；审批线新增遵守「审批类型三处同加」判例（routes + detail-read + maker，2026-09-05）
- 建充值地址时复用入驻建的同一 applicant，不再另注册（TR 集成点，2026-07-14）
- 终拒客户的「尽调未完成 · 待离场处理」文字位波一已建，本波接入驻语境核对口径

## 待定岔口（脑暴时与业主对）

1. Sumsub 模拟形态：⚡喂裁决面板 vs 复用补料页的 WebSDK 会话模式 vs 两者并用（三域 KYT 现状是前者、补料是后者）
2. MLRO 终审的审批线形态：走审批中心新动作类型？maker 是谁（系统提单 or 运营）？
3. 被拒重申的次数 / 冷却，与硬线沉默标记（hardLineDispositionedAt）在入驻语境的关系
4. 九位种子客户的静态状态位与活流程怎么共存：Dave（认证中）/ Eve（新注册）现场走，还是新开一位演示客户走全程
5. 新客费率档要不要本波铺（与 V3 体检 F-R1「受众谓词无实例」联动治愈的时机）
6. verification 类字段按新 spec 要不要加回（波一删的事件回声组，只加真展示的）
7. `demo/script.md` 第二幕重写幅度与走查顺序
