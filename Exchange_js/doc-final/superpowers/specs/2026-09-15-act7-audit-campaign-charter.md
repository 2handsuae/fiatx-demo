# 第七幕「事后说得清」审计追溯战役 · 总纲

> 立于 2026-09-15 ｜ 基线 main `8a6390fa` ｜ 依据：`superpowers/checkups/2026-09-15-act7-audit-traceability.md`（主检 + 二问补检，红级与否定性结论均经主会话复现）
> **本文件活到最后一波**；各波 spec 逐波归档，回看以此为锚。每波收尾按 `rules/delivery-checklist.md` 往下一波 spec 骨架写承接记录，并回写本文件状态行。

**状态**：波一 **已完成**（2026-09-16，分支 worktree-act7-wave1，7463a48e..5999512b，SDD 7 任务+终审修复波，闸全绿+剧本预演实证）｜ 波二 **已完成**（2026-09-16，分支 worktree-act7_wave2，82abd83c..ab541734，SDD 10 任务，闸全绿+判据2/5 走查实证：真实 API 驱动一个 ADM 邀请→首登→停用→恢复全弧线，Related No 一次拉出 19 条事件全链，`verify:audit` 全绿含 Q5）｜ 波三 **spec 已定稿**（2026-09-16 脑暴展开：`2026-09-16-act7-wave3-search-flow-design.md`，骨架已原地展开；两拍板见 `decisions.md` 2026-09-16；执行未开）

## 0. 目标

让第七幕的三句话真正立住：**证据链拉得出**（证据包对真实单据产出非空链）、**人和事都查得到**（"发生过什么"已齐，把"是谁干的、和谁有关"补到同档）、**检索一键可达**（从单据页一键进它的证据链）——并把审计域自己变成铁律⑥的守法者（现在它是全站 UUID 重灾区）。

**战役级成功判据**（末波收尾逐条验）：
1. 对一张走完流程的真实充值单建证据包 → 包内充值证据链非空（对照：swap 链已好）
2. 审计页 Related No 输一个 ADM 号 → 拉出该管理员 邀请→首登→停用→恢复 一生全链
3. 第七幕五步走查全程「从实体页一键进审计」，零人肉抄号切页
4. 审计四页（列表/详情/证据包列表/详情）零内部 UUID 落屏与落 URL（Raw Record 按乙案过滤后）
5. `verify:audit` 升级判据（名册断言版）全绿
6. 词表全量导出重出**最全版**交业主（业主 2026-09-15 明示，放 `lark/`）

## 1. 已定事实与岔口（不翻案）

- **2026-09-13 业主拍板**：证据包充值/提现证据链（5 幽灵模型 + id/业务号错配）归第七幕轮修
- **2026-09-15 业主三岔口拍板**（同日已登 `decisions.md`）：
  - ① Raw Record 区 = **乙案**：区块保留（排障价值真实），渲染前过滤内部 id 字段（`id`/`actorId`/`entityOwnerId` 等），Copy 一并只复制过滤后内容
  - ② 客户主表裸 CRUD 三端点（`POST/PATCH/DELETE /customers*`）= **删除**：管理台零消费、不做"手动建客户"；删前按零引用纪律全仓（含 client-web / scripts / test）复核
  - ③ 审计 → 账本凭证跳转 = **本战役不做**：现行剧本"切账本页"讲得通，属锦上添花，留观察项
- **登录留痕不做**：`/auth/login`、`/auth/customer/login` 零审计是既定口径（`auth.service.ts:38` 注释自认「归安全日志，本项目不做」）——不是缺口，不修不提
- **修法先例在库**：证据链照 `resolveSwapExportSelectionContext`（业务号→内部 id 解析）；subjects 照 `approvals.service.ts:193-196` 样板
- **全战役不动 schema / seed** → 不触 ⑧ 重铺闸；`InternalFundAuditLog` 死表保留在账（读面改造后连读取链也死透，删表留给下次动 schema 顺手清，BACKLOG 在案）

## 2. 不做清单（对照 CLAUDE.md §2，看到别顺手补）

登录/登出留痕 ｜ 审计→账本跳转（岔口③）｜ 通知本体（§I 横切）｜ 客户面任何审计可见性（tipping-off，零泄漏面已证实是对的）｜ 检索性能/索引/分页优化 ｜ 无详情页的主体类型硬造跳转（甲案「不硬造」口径不变）｜ InternalFundAuditLog 删表 ｜ ADVANCED 8 项 ｜ 审计导出格式增强

## 3. 三波拆分

### 波一 · 证据链修复 + 业务键换装（后端查询层 + 审计域自身前端）

**做**：
1. 证据包充值/提现证据链修复：`buildDepositSnapshots`/`buildWithdrawSnapshots` 照 swap 先例加业务号→id 解析；5 个幽灵模型（`kytCase`/`travelRuleCase`/`workflowDecisionRecord`/`complianceAlert`/`complianceIncident`）分支整段退役——这 5 张表本系统不存在也不立，证据链 = 审计事件 + 交易快照（`audit-logs.service.ts:1342-1916`）
2. 审计域业务键换装：`audit/logs/:id`→`:eventNo`、`audit/evidence-packages/:id`→`:packageNo`（后端两详情端点 + 前端两条路由 + 两处行点击 + RBAC catalog 连动登记）
3. UUID 卫生：详情页 Owner ID 字段删（`AuditLogDetailPage.tsx:362`）；actorId 兜底渲染清两处（:313、列表 :551）；证据包 Selected Event IDs 改渲染 eventNo（:441-457）；Raw Record 两页按岔口①乙案过滤
4. 证据包详情页补渲染审批背书（Approval No / Status / 裁决角色——接口里 `approvalCase` 字段已回传未渲染）

**不做**：不碰任何写入面（subjects/归因归波二）、不碰筛选与深链（归波三）。
**验收**：战役判据 1 + 4；⑤ 截图（审计四页 + 证据包非空链）。
**闸**：①②③ tsc + ④ jest（audit-logging 目录，`buildEvidencePackageArtifacts` 三域用例须覆盖非空路径——现测的是 fallback 空数组，改完要能咬人）+ ⑤ 截图 + ⑥ demo:all。
**销账**：BACKLOG §H 幽灵模型条、UUID 路由条、UUID 落屏三处条、证据包背书条。

### 波二 · 留痕补齐与归因（纯后端写入面）

**做**：
1. V1 治理域 ~29 码补 `subjects:`：users/ 六 workflow（37 处调用）+ `role-definition-create`（4）+ `approval-policy-change`（3），样板照抄（目标主体 = 被动的那个管理员/角色/策略，OWNER/PRIMARY 角色按 approvals 先例）
2. 证据包导出族补 subjects（`audit-evidence-export-workflow.service.ts`）
3. `MATERIAL_REQUEST_ISSUED` 改 `recordByActor` 带操作人（actor 已传到 `issue()`，只是没用上）
4. `verifyMfaCode` 锁定路径补 `ADMIN_ACCOUNT_LOCK_*` 打点（`mfa-binding-workflow.service.ts:240-275`，对齐同文件姊妹方法）
5. 岔口②执行：删客户主表裸 CRUD 三端点 + `CustomersService.create/update/remove`（删前全仓零引用复核；`CUSTOMER_CREATED` 真实写点在注册链 `customer-auth.service.ts`，勿误伤）
6. `verify:audit` Q2/Q4 从「任取一条自证」升级为**名册断言**（按码族断言子表覆盖面，修完当场能咬人的防复发闸）

**不做**：不动前端；不给 `ADMIN_ACCESS_DENIED` 强加 subjects（按 actorNo 已可查，剧本走查④足够）。
**验收**：战役判据 2 + 5。
**闸**：① tsc + ④ jest（identity/users、access-control、governance/approvals、audit-logging）+ `npm run verify:audit`（升级版）+ ⑥ demo:all。
**销账**：§H ⭐🔴 subjects 覆盖条、有痕无人条；Q4 自证条按升级结果重锚（V1 域无 OWNER=CUSTOMER 场景的结构性说明保留）。

### 波三 · 检索动线 + 收口（前端 UX + 文档，收尾波）

**做**：
1. keyword 后端 OR 补 `eventNo` 列（Audit No 假承诺修复，`audit-logs.service.ts:525-537`）
2. 审计列表页收 URL 参数（筛选态可预填）+ 实体页「View audit trail」深链最小集：三域订单详情、客户详情、审批单详情、资产详情、资金单详情 → 带单号跳审计页
3. 筛选补栏：`actionDomain`（按域浏览下拉）+ `action`/`workflowType` + `correlationId`；详情页渲染 correlationId/causationId（v1-governance §4「按旅程看邀请」承诺兑现）
4. 跳转映射补费率两族（`WITHDRAWAL_FEE_LEVEL`/`SWAP_FEE_LEVEL`，有页可落）；15 个孤儿 `AuditEntityTypes` 键清理；FUNDS_ORDER 字面量入常量；死权限常量 `AUDIT_EVIDENCE_EXPORT_DETAIL_READ` 删；DTO keyword 注释改真
5. 资金单详情审计栏改读中央审计日志（按 FUNDS_ORDER subject / fundsOrderNo 查），死读取链摘除
6. `AuditLogsPage` 顺手套 `ListFooter`（§I 13 页清单同步减一）
7. 文档收口：`v1-governance.md` §5/§6 数字（101→102、97→113、7/101 分母连动）、`audit-actions.constant.ts` 三块头注释（31/25/18→47/33/26）、`script.md:217` 兑换 22→26、第七幕剧本走查升级为深链版；**词表导出脚本重跑出最全版放 `lark/` 交业主**（战役判据 6）
**不做**：岔口③账本跳转；无页主体不硬造映射。
**验收**：战役判据 3 + 6；第七幕五步走查深链版全程 ⑤ 截图。
**闸**：①②③ tsc + ④ jest + ⑤ 截图 + ⑥ demo:all（收尾闸全套）。
**销账**：§H correlationId 条、跳转映射条、InternalFundAuditLog 条、小账条、Audit No 条；§K ⑥⑦ 审计子集。

## 4. 波间顺序与流程约定

- **顺序理由**：波一是业主拍板的锚且路由换装是波三深链/映射的前置；波二纯后端独立、其产出（管理员/资金单 subjects）被波三读面消费；文档与词表最全版必须收在最后。
- 一波 = 一 worktree = 一会话；spec 只写细当前波；波一收尾当场立波二骨架（链本总纲 + 承接记录节），依次类推。
- 评审档位：全战役不动钱、不动状态机（查询/展示/打点层）→ 任务执行与任务级评审 `sonnet`，终审主会话 Fable（派发省略 model 走继承）。
- 每波收尾：对照 `rules/delivery-checklist.md`；BACKLOG 按上述销账清单当场记账；本文件状态行回写。
