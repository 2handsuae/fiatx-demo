# 第七幕波二 · 留痕补齐与归因 —— 设计稿

> 总纲：`2026-09-15-act7-audit-campaign-charter.md`（波二节=范围权威）｜ 基线 main `429e1689`
> 岔口②已拍板在案（`decisions.md` 2026-09-15）：customers 裸 CRUD 三端点删除、不做"手动建客户"。
> 业主 2026-09-16 确认：照总纲原样全做，不加不减；本波无新岔口。
> 本文所有行号/计数均为 2026-09-16 主会话实测（grep 复现命令见各节）。

## 0. 本波做 / 不做

**做**：① V1 治理域 9 个 workflow 文件 48 处审计调用补 `subjects:`（33 码）② `MATERIAL_REQUEST_ISSUED` 改带操作人 ③ `verifyMfaCode` 锁定路径补 `ADMIN_ACCOUNT_LOCK_*` 打点 ④ 删 customers 裸 CRUD 三端点 + 三服务方法（含 RBAC 三连动、词表退役连带）⑤ `verify:audit` Q2/Q4 升级名册断言。

**不做**（对照总纲 §2 与 CLAUDE.md §2）：前端页面零改动（仅 `admin-web/src/rbac/permissions.ts` 权限键随端点删除机械连动，承接记录第 3 条明文的三连动之一）｜ schema / seed 零触碰（⑧ 不触发）｜ `ADMIN_ACCESS_DENIED` 不加 subjects（总纲明文：按 actorNo 已可查）｜ 登录留痕 ｜ 审计→账本跳转 ｜ 检索前端与深链（波三）｜ InternalFundAuditLog。

## 1. subjects 补齐（9 文件 48 处 33 码）

### 1.1 关键设计事实：PRIMARY 必须镜像进子表

列表查询的 `subjectNo` 过滤（前端 Advanced · Related No）**只查子表**：`audit-logs.service.ts:1031-1036` 是 `subjects: { some: { subjectNo } }`，不 OR 主表 `primarySubjectNo`；`verify-audit.ts` Q2 同样只查子表。所以战役判据 2「输 ADM 号拉一生」成立的前提，是把主表 primary **镜像**成一条子表行。

在库两个先例打架：`approvals.service.ts:131-144`（`approvalSubjects`）镜像 PRIMARY 行；`role-definition-modify-workflow.service.ts:50-53` 注释明言「PRIMARY 已在主表两列上，只补 RELATED 不重复传」。**本波按总纲钉死的 approvals 先例 = 镜像**。modify 那套导致它的 primary（requestNo）按 Related No 查不到——既有事实、不在本波 33 码清单内，不回改，登记 BACKLOG 观察一行。

### 1.2 统一构造规则（每处调用）

```
subjects = ① 镜像行：{ subjectType: 该调用 primarySubjectType 原值, subjectNo: primarySubjectNo, PRIMARY }
         + ② 被动目标行（仅当目标号 ≠ primaryNo）：approval-policy-change 补 { APPROVAL_POLICY, actionType, RELATED }；
             其余 8 文件目标即 primary，无②
         + ③ 凭据行（该调用点已有 approvalNo 在手/已写进 metadata 时）：{ APPROVAL_CASE, approvalNo, INSTRUMENT }
             ——只用现成变量，不为凑行数去查库
```

- 每文件立一个私有 helper（照同域先例 `admin-role-binding-change-workflow.service.ts` 的 `roleRelatedSubjects` 形状），48 处调用每处 diff 压到 1 行。
- 不变量①（每事件至多一个 PRIMARY）不许破——helper 保证镜像行是唯一 PRIMARY。
- **invite 家族遗留**：其主表 `primarySubjectType` 是 `ACCESS_CONTROL` 而号是 userNo（其余五家均 `ADMIN_USER`，`admin-invite-workflow.service.ts:413` 注释自认"对齐同旅程"）。镜像**按主表原值**，主表类型不动——改类型是展示面/跳转面变化，越出纯写入面边界；登记 BACKLOG 小账观察。判据 2 按 subjectNo 匹配，不受类型影响。

### 1.3 清册（grep 实测 2026-09-16；总纲「~29 码」为约数，以本表为准）

| 文件 | 调用 | 码 |
|---|---|---|
| `identity/users/admin-invite-workflow.service.ts` | 9 | INVITE_REQUESTED / DISPATCHED / CANCELLED / ACCEPTED / EXPIRED（5） |
| `identity/users/admin-suspension-workflow.service.ts` | 3 | SUSPENSION_REQUESTED / APPLIED（2） |
| `identity/users/admin-reactivation-workflow.service.ts` | 3 | REACTIVATION_REQUESTED / APPLIED（2） |
| `identity/users/admin-password-reset-workflow.service.ts` | 6 | SELF_REQUESTED / OFFICER_REQUESTED / OFFICER_APPLIED / CANCELLED / SELF_TOKEN_ISSUED（5） |
| `identity/users/admin-mfa-reset-workflow.service.ts` | 4 | MFA_RESET_REQUESTED / APPLIED / CANCELLED（3） |
| `identity/users/mfa-binding-workflow.service.ts` | 12 | FIRST_LOGIN_IDENTITY_CONFIRMED / MFA_INITIATED / MFA_BOUND / COMPLETED、MFA_LOGIN_VERIFY_FAILED / VERIFIED、ACCOUNT_LOCK_APPLIED / RELEASED（8） |
| `identity/access-control/role-definition-create-workflow.service.ts` | 4 | CREATE_REQUESTED / APPLIED / CANCELLED（3） |
| `governance/approvals/approval-policy-change-workflow.service.ts` | 3 | POLICY_CHANGE_REQUESTED / APPLIED（2） |
| `audit-logging/audit-evidence-export-workflow.service.ts` | 4 | EXPORT_REQUESTED / GENERATED / DOWNLOADED（3） |
| **合计** | **48** | **33** |

复现：六 users/ 文件 `grep -c "subjects"` 全 0；后三文件同 0；各文件 `grep -n "action: '"` 得上表码。

### 1.4 测试

各文件既有 spec 补断言：record 调用携带 `subjects` 且含镜像 PRIMARY 行（断言到 subjectNo 具体值，不许 `expect.anything()`）。涉 audit-logging 查询侧的用例一律用波一留下的 `mockFindManyByWhere` 行为化 mock（`audit-logs.service.spec.ts` 顶层），禁止回退 `mockResolvedValue` 无视 where 的假绿形态（承接记录第 1 条）。

## 2. 材料下发归因（`MATERIAL_REQUEST_ISSUED` 改带操作人）

**现状实测**（比 BACKLOG 记的轻）：`actor: ApprovalActorContext` 在 `issue()`/`register()` 两径都是**必传**（`material-request-issuer.service.ts:28/:41`），穿进 `persist(:120-126)` 只用于开限制；审计写点在 `material-requests.service.ts:146` 的 `recordSystem`——subjects / ownerCustomerNo / correlationId 都齐，**唯独没人**。

**修法**：把 actor 穿进 `requests.create(...)`（签名加参），`MATERIAL_REQUEST_ISSUED` 由 `recordSystem` 改 `recordByActor(actor, {...})`；其余字段（含 `sourcePlatform: 'SYSTEM'`）一律不动——本条修的是"没人"，不动来源语义。两径（合规官手发 / 处置流程连带下发）actor 都是真实裁决人，无系统径兜底问题。

## 3. `verifyMfaCode` 锁定路径补打点

**现状**：`mfa-binding-workflow.service.ts:240-275` 通体零审计调用；唯一调用方 `password-reset.controller.ts:43`（自助密码重置的 MFA 校验步）。同文件姊妹 `verifyMfaLogin` 有完整对照：锁定 `ADMIN_ACCOUNT_LOCK_APPLIED`（:561）、到期惰性解封 `ADMIN_ACCOUNT_LOCK_RELEASED`（:609）。

**修法**（对齐姊妹的两个打点时机，不多不少）：
1. `incrementMfaVerifyFail` 返回 `locked=true` → 落 `ADMIN_ACCOUNT_LOCK_APPLIED`；
2. 锁已到期后的首次尝试 → 惰性解封并落 `ADMIN_ACCOUNT_LOCK_RELEASED`（verifyMfaCode 现在对过期锁静默放行、无解封步，补打点时把解封步一并对齐姊妹形状 :288 一带）。

actor = 被锁定管理员本人（`recordByActor`）；subjects 按 §1.2 镜像（该文件本就在 §1 清册内，两处新打点生而合规）。验证码对错本身不打点——总纲只圈 `ADMIN_ACCOUNT_LOCK_*`。

## 4. 删 customers 裸 CRUD（岔口②执行）

**删除清册**（全部实测）：

| 层 | 位置 | 动作 |
|---|---|---|
| controller | `identity/customers/customers.controller.ts` `@Post`(:56) / `@Patch(':customerNo')`(:137) / `@Delete(':customerNo')`(:152) | 删三 handler；两条 GET(:63/:129) 保留 |
| service | `customers.service.ts` `create`(:19) / `update`(:76) / `remove`(:124) | 删三方法；`updateOnboardingData` / `applyTierUpgrade` / `markHardLineDisposition` / `hasHardLineDisposition` / `find*` 保留 |
| RBAC 三连动 | `rbac.catalog.ts:236/:239/:240` 三条 route 删登记 → `admin-web/src/rbac/permissions.ts` 对应键删 → 合 main 后重启 + `db:base:sync` | 承接记录第 3 条流程 |
| 词表连带 | `CUSTOMER_UPDATED` / `CUSTOMER_DELETED` 全仓唯一写点即上述两方法 → 按退役协议迁 `DEPRECATED_AUDIT_ACTIONS`（不变量③自动看守零新写入）。**`CUSTOMER_CREATED` 保留**——真实写点在注册链 `customer-auth.service.ts:64`，勿误伤（总纲明文） | |
| 测试/DTO 孤儿 | controller.spec / service.spec 对应用例删；create/update DTO 零其余引用则一并删（删前复核） | 连带孤儿判例 |

**零引用证据**（404 判例防线，plan 执行前须原样重跑一遍）：
- 服务方法调用方：`grep -rn "customersService\.\(create\|update\|remove\)" src admin-web/src client-web/src scripts test` → 仅 controller 本身；其余 `CustomersService` 引用均为保留方法（hasHardLineDisposition / markHardLineDisposition / find* / applyTierUpgrade）。
- HTTP 调用方：admin-web / client-web / scripts / test 全仓对 `POST|PATCH|DELETE /customers` 零命中；`verify-rbac.ts:1204` 只引用 `GET /customers`（保留）。

## 5. `verify:audit` Q2/Q4 升级名册断言

**病灶**：Q2 `findFirst` 任取一条 PRIMARY 自证（`verify-audit.ts:14-23`）；Q4 任取一条 OWNER=CUSTOMER，而其唯一来源就是查询动作自证（:26-39）。两条都咬不了"某个 workflow 忘了写 subjects"。

**升级设计**：
1. **名册常量**：`SUBJECTS_COVERED_ACTIONS` 落 `audit-actions.constant.ts`，脚本 import（照 `DEPRECATED_AUDIT_ACTIONS` 先例，`verify-audit.ts:2`）。内容 = §1.3 的 33 码 **+ 既有覆盖一并锁进闸**：`APPROVAL_*` 7 码、`ROLE_DEFINITION_MODIFY_*` 族 3 码、`ADMIN_ROLE_CHANGE_*` 族 3 码——防已修的复发。三族入册前提已实测：调用数 = 带 subjects 数（approvals 7/7、modify 4/4、role-binding 4/4），入册不会误红（§H 记"6 个 APPROVAL_*"为旧数，实测 7）。
2. **Q2 新形态（按码断言覆盖面）**：对名册内每码，库中该码事件数 N>0 时断言「该码全部事件都有 ≥1 子表行」（violations=0 才绿）；逐码输出 checked / 库中未见事件 两个清单。另设前置硬断言「名册中有事件的码数 ≥ 阈值」防空库假绿——阈值由 plan 阶段对重铺后 `demo:all` 库实测定数。
3. **Q4 新形态**：改为「`AUDIT_LOG_QUERIED` 且带 ownerCustomerNo 参数的事件**全部**携带 OWNER=CUSTOMER 子表行」；"V1 域无其他 OWNER=CUSTOMER 场景"的结构性说明降为脚本注释保留（BACKLOG Q4 条按此重锚）。
4. **变异测试（防新自证）**：临时抽掉任一 workflow 的 subjects → `verify:audit` 必须转红；恢复转绿。红/绿双证进物证。

## 6. 验收与闸

**判据 2 走查**（demo 数据不含管理员生命周期——实测 demo 脚本零 invite/suspension 命中，故**现场实走**）：起栈 → 管理台完整走 邀请→首登→停用→恢复 一个真实 ADM → 审计页 Advanced · Related No 输该 ADM 号 → 一生全链拉出（沿波一「按 Related No 查审批链」同款走查手法）；截图落盘 `doc-final/superpowers/...`（物证写明落盘路径）。
**判据 5**：升级版 `verify:audit` 全绿，含变异测试红/绿双证。

**闸**：① 后端 tsc + ② admin-web tsc（permissions.ts 连带）+ ④ jest（identity/users、identity/access-control、identity/customers、identity/material-requests、governance/approvals、audit-logging）+ `npm run verify:audit`（升级版，经包装器对栈库跑）+ ⑥ `on-stack demo:all`。不动 schema/seed，⑧ 不触发；⑤ 截图仅判据 2 走查件。

**收尾**（对照 `rules/delivery-checklist.md`）：BACKLOG §H 销「⭐🔴 subjects 覆盖」「有痕无人」两条、Q4 条重锚、invite 类型遗留 + modify 不镜像观察各登记一行；波三骨架立 + 承接记录；总纲状态行回写；CHANGELOG 一行；合 main 后重启 + `db:base:sync`（权限字典变了）。

## 7. 风险与开口

- 最大工作量 = 48 处调用逐处补行，机械但量大——helper 化后评审重点收敛到"每文件 helper 正确 + 33 码无漏"，名册断言当场兜底漏网。
- customers 删除唯一暴露面是隐藏调用方（波一 `findEvidencePackage` 判例）——§4 零引用证据在 plan 执行前原样重跑，绿了才动手。
- 名册阈值依赖 demo:all 实测：plan 第一个任务先重铺定基数，防"名册全空也绿"；未被 demo 演到的码（如 CANCELLED/EXPIRED/LOCK 族）走条件断言，不硬造场景。
- `requests.create` 签名加参波及其 spec 与两个调用方（issue/register 同穿），范围小且 tsc 兜底。

## 承接上一波（波一，2026-09-16 收官）——原骨架记录保留

**实际偏差**：
- plan 对 spec 的声明性简化落地：deposit/withdraw 无独立 resolver，主查询直接按业务号 where（swap 保持两步因 quote 联动）
- 终审修复波（5999512b）：swapEvidenceChain 改以宽查询返回数组为源（与 deposit/withdraw 同构）；恒真断言 `swapQuotes.length>=0` 改 `toHaveLength(1)`；deposit 用例幽灵禁键回扩六键

**执行中发现的新事实（波二直接可用）**：
1. `audit-logs.service.spec.ts` 顶层已有 **`mockFindManyByWhere(rows)` 行为化 mock**（按 where 的 in/等值/OR 真过滤）——波二给 8 个 workflow 补 subjects 的测试、以及 verify:audit 升级判据，测 mock 一律用它，禁止回退"mockResolvedValue 无视 where"的假绿形态（波一根治的正是这个）
2. 审计 spec 文件与 service 已零幽灵模型引用——波二动这两个文件不会再撞历史残留
3. **RBAC 路由变更三连动已有波一先例**：删端点/改参数名 → `rbac.catalog.ts` route() 连动 → 前端 `permissions.ts` 同步 → 合并 main 后重启 + `db:base:sync`。波二删 customers CRUD 三端点（岔口②已拍板）走同一套，别漏 catalog 的三条 route 登记删除
4. 波一遗留一个 404 级判例：**改查找键/删端点时必须全量 grep 服务方法的所有调用方**（波一 `findEvidencePackage` 就藏了一个计划外调用点）——删 `CustomersService.create/update/remove` 前同样全仓清调用方（含 scripts/test）
5. 终审 C2 顺手项：`audit-logs.service.spec.ts` 的 `'pkg-deleted'`/workflow spec 的 `'pkg-1'` 字面量语义已过时（现在传的是 packageNo）——波二动这些 spec 文件时顺手更名，不动就留着
6. 波一预演实证了「按 Related No 查审批链」好使——波二验收判据"输 ADM 号拉管理员一生"可沿同一走查手法（审计页 Advanced·Related No）
