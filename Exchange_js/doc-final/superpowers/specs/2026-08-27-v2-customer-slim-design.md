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
