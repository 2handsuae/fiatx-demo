# V2 客户站设计稿（Phase 4 · 站6，2026-08-27 α 盘点）

范围＝身份真环六模块（客户主档 / 限制便签 / 材料请求 / 入职 / 风评 / 升级案）。users 与 access-control 归 V1 治理站，不在此列。

## α 发现（按严重度）

1. **全域零子表行**：六模块所有审计写点都不传 subjects——按单据查（输材料请求号/风评号/升级案号）与按客户查（OWNER）对身份域**全体失明**。与对账站同病，这是本站主刀。
2. **三处 UUID 键法**（铁律⑥）：升级案两处（创建用 caseNo、完成/拒绝用 upgradeCase.id）、风评一处（开始用 assessmentNo、后续用 assessment.id）。
3. **铁律④缺口**：材料请求的状态迁移表 `MATERIAL_REQUEST_TRANSITIONS` 导出后零引用——状态变更实际走 WHERE 乐观锁直更，迁移表纯摆设。表要么接线要么是谎言。
4. **风评主对象类型是驼峰字符串** `'ClientRiskAssessment'`——全仓唯一不走 SCREAMING 注册类型的。
5. **死出口 13 具**：入职 DTO 尸体 8 具 + ALL_CAPABILITIES + MATERIAL_TYPE_LABELS + 迁移表两具（第 3 条改判接线,不删）+ ONBOARDING_MOCK_DATA_TYPES。
6. requestId 全域零处——同名同对象重复事件会被幂等键静默去重（8/20 已定式的坑,全域裸奔）。

## 现役词census（32 码六家族,全部有写方）

| 家族 | 码 | 现状 |
|---|---|---|
| 客户主档(3) | CUSTOMER_CREATED / UPDATED / DELETED | customerNo ✓,系统通道 |
| 限制便签(4) | CUSTOMER_RESTRICTION_ADDED / CLEARED ｜ CUSTOMER_FROZEN / UNFROZEN | customerNo ✓,双通道已分（系统命中 recordSystem / 运营贴撕 recordByActor）|
| 材料请求(7) | MATERIAL_REQUEST_ISSUED / SUBMITTED / APPROVED / RETRY_REQUESTED / REJECTED / CANCELLED / ORDER_UNBOUND | requestNo ✓ |
| 入职(9) | FINAL_APPROVAL_SUBMITTED / RESUBMITTED / APPROVED / REJECTED / CANCELLED / EXPIRED ＋ ENTITY_UPSERT / INVESTOR_CLASSIFICATION_UPDATED / SIMULATE_EXPIRED | 键法待逐点核 |
| 风评(6) | RISK_ASSESSMENT_STARTED / AUTO_SIGNED / MLRO_SIGNED / MLRO_DISMISSED / MLRO_FALSE_POSITIVE / ESCALATED_SANCTIONS | 键法混用+类型驼峰 |
| 升级案(3) | TIER_UPGRADE_CASE_CREATED / COMPLETED / REJECTED | 键法混用 |

命名对照既有裁决：无 *_FAILED（无并名需求）；无同动作拆名嫌疑；**32 码现名全保守,零改名零退役**——本站不动名字,只入册换合同。

## β 四刀

- **刀A 名册**：V2_CUSTOMER_AUDIT_ACTIONS 32 码注册,域 'CUSTOMER' 入 CONTRACT_ACTION_DOMAINS,机器闸六表查找。correlation 全 NONE（客户级件无订单旅程）;材料请求例外——有 orderRef 的请求把父单旅程号带上（机会性携带,不设 INHERIT 硬闸:请求可无单发起,码的模式是固有属性不能看场景）。
- **刀B 三查修复**（主刀）：六模块全部写点补 subjects（PRIMARY=自身业务号 / OWNER=客户号 / RELATED=orderRef 所指父单）+ ownerCustomerNo + requestId(randomUUID) ;三处 UUID 键法改业务号;风评类型归一 SCREAMING（挂 AuditEntityTypes 注册名）。
- **刀C 铁律④**：材料请求状态变更接迁移表——非法跃迁显式拒绝,乐观锁保留（防并发,不是防跃迁）。
- **刀D 死码**：11 具删除（迁移表两具改判接线）。

## 不做

身份环手术（站4 已留档,16 张 forwardRef 是真环）｜ 客户生命周期机重设计 ｜ material-refresh 新增词（今日零写点,其动作经材料请求发声）｜ 入职验证流程改动 ｜ V1 地盘（users/access-control）

## 变更记（业主改判，2026-08-27）

设计稿原案（六模块全量入册）被业主否，改**方案2**：保留客户表+二期内容，一期（入驻流程/风评/升级案）整体删除、回头接真 Sumsub 重做。理由：总剧本第二幕只讲二期内容（一期流程零戏份，删了演示零损失）；给要拆的房子贴瓷砖不值；重做在新合同上出生更干净。

## 竣工记（As-built，2026-08-27）

- **拆除**：三模块整删（onboarding 含终审与两控制器 / CRA 含 cra-demo / tier-upgrade）；摄取分发器切五支路（ONBOARDING/TIER_UPGRADE/AML×2/CASE_DECISION）+ scenario 式模拟链整删；模拟面板拆半（留补料裁决+文档监控）；前端 client Verification.tsx 整页与 admin 风评两页/模拟弹窗/CustomerDetail 一期段全清；schema DROP 4 表 + customer_main 4 死列（有活读者的 onboardingApprovedAt→新客标签、sumsubExperiencedLevel2→档位模拟、verificationCanContinue 保留）。
- **两面承重墙先搬**：SumsubClient（申请人侧）抽成零依赖叶子 SumsubApplicantClientModule（它早是全域共享件）；交易前置门 assertTradingEligibility/Ready 迁 CustomerAccessService（七调用点换注入）。
- **抢救性迁址**：`/onboarding/me` 是客户端全局资料钩子唯一数据源（二期活件寄居一期路由）——重建为 customers/CustomerProfileController，URL 不动客户端零改。
- **β**：V2_CUSTOMER_AUDIT_ACTIONS 15 码（14 现役+档位模拟 1 新铸）；全域子表修复；铁律⑥修（运营贴撕便签主对象 UUID→customerNo，活体探针实证）；材料请求机会性携带父单旅程号；打点位置守则撞了一次（审计调用误落 controller，守卫测试当场逮住，下沉 service）。
- **α 误判认账 ×2**：材料请求迁移表经同文件函数 nextMaterialRequestStatus() 活着（刀C 归零）；ALL_CAPABILITIES/MATERIAL_TYPE_LABELS 同为同文件内用（死出口扫描盲区：只数跨文件引用）。
- **既有观察（未动）**：运营贴一次便签落系统+操作员两条 ADDED（restrictions.open 与 workflow.audit 双写，站前如此）。
- 终局记分：真环 6→3 模块（客户↔材料请求↔材料刷新）、forwardRef 全仓 16→5；词表-6（FINAL_APPROVAL 家族，其余 12 一期词从未入表）。
- 证据：tsc×4 ｜ 全量 jest 净新 0 ｜ 重铺→demo:all 8/8 ｜ verify:audit 不变量三绿 ｜ e2e 全量 11 套件 83/83（兑换套件 CUSTOMER 分支随新合同同步）｜ 活体探针（贴便签→业务键+域+子表+操作员归属全中）｜ verify:coa 出现基线成文的 post-demo 公司 AED 负余额（"不算净新红"口径，站4/5 的全绿属超基线 bonus 态）。
