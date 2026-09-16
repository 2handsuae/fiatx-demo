# 第七幕波三 · 检索动线 + 收口 —— 骨架

> 总纲：`2026-09-15-act7-audit-campaign-charter.md`（§3「波三 · 检索动线 + 收口」= 范围权威，本骨架不重抄范围，只记承接）
> 本文件是骨架，不是波三 spec——波三 spec 的展开是下一波新会话读总纲 + 本骨架后跟业主脑暴的活，本骨架不代做。

## 承接上一波（波二，2026-09-16 收官）

**实际偏差**：
- 清册计数 48 → 49 处（34 码不变）：`admin-password-reset-workflow.service.ts:105` 的 `recordConsumeOutcome` 写点，其 `action` 是运行时变量（`OFFICER_APPLIED`/`SELF_COMPLETED` 二选一），字面 `grep "action: '"` 逃了这一处——九文件逐处复扫对账时被实现者逮回，是"零引用/漏点 grep"的又一形态（字面量断言漏运行时变量），波三改查找键/清点范围前先留意这类假阴性
- `admin-invite-workflow.service.ts:138` 一带的 SoD 硬互斥分支：`approvalCase` 变量在该分支恒为 `null`（异常发生在 `approvalsService.createAndSubmit` 之前），故该分支写审计时只传 `inviteSubjects(user.userNo)` 单参、不传凭据行（无 approvalNo 可镜像）——不是漏写，是这条路径结构性没有凭据可传，波三如果扩展该文件不要误判为遗漏
- `audit-evidence-export-workflow.service.ts` 的 `DOWNLOADED` 码处：`approvalCaseNo` 在当前作用域顶层变量里已经在手（评审逮回的判例，见 Task 6 review），补 subjects 时直接复用、未新查库——提醒波三补跳转映射时，凡涉及"审批单号是否在手"的判断，先看顶层变量再决定要不要新查询

**执行中发现的新事实（波三可直接用）**：
1. **`SUBJECTS_COVERED_ACTIONS`（47 码）已 export**（`src/modules/audit-logging/constants/audit-actions.constant.ts`，紧邻 `DEPRECATED_AUDIT_ACTIONS` 之后），`scripts/verify-audit.ts` 已 import 消费——波三如果要给"按域浏览"筛选栏或跳转映射表按码族分组，这份名册是现成的按码清单来源，不必重新枚举
2. **`MIN_EXERCISED_ROSTER_ACTIONS` 阈值 N=2 及其环境原因**：`demo:all` 全系脚本都是交易域路径，47 码名册里只有 2 个横切审批码（`APPROVAL_SUBMITTED`/`APPROVAL_GRANTED`）会被交易域场景（confiscation/大额提现等 maker-checker）带到；45 个治理域码（邀请/MFA/角色/证据导出等）纯 `demo:all` 摸不到，阈值钉在实测上限 2，非放水（BACKLOG §H「治理域 demo 脚本缺位」条详述）
3. **判据 5（`verify:audit` 全绿含 Q5）的 runbook 固定为**：`stack.sh reset self` → `stack.sh up self` → `on-stack self demo:all` → 人工 API 走查补齐治理域事件（本波 Task 10 示范：真实邀请→首登→停用→恢复一个 ADM + 故意错码一次 + 发一次带 `ownerCustomerNo` 的查询）→ 复跑 `verify:audit` 全绿。这不是一次性动作，是本闸此后的标准复现步骤——波三如果继续动 `verify:audit` 判据，验证要按这个 runbook 走，不能只跑纯 `demo:all` 就下结论
4. **`new XxxService(...)` 直接构造调用是"零引用 grep"预检的第三种假阴性形态**（继波一 `findEvidencePackage` 隐藏调用点判例之后）：波二 Task 8 删 `customers.service.ts` 三方法前的零引用预检只覆盖了"方法调用"（`xxxService.method(`）与"HTTP 路由"（`POST|PATCH|DELETE '/customers'`）两种形态，漏了 `swap-transactions/swap-workflow.service.spec.ts:1614` 里 `new CustomersService(pendingActionPrisma, {...} as any)` 这种绕开 Nest DI 直接 `new` 出真实实例的第三种引用形态。波三如果要删/改任何服务的方法签名或构造函数，零引用预检除了 grep 方法调用和 HTTP 路由，还要加一条 `grep "new <ServiceName>("`
5. **`verify:audit` 的变异测试标准手法**：对 self 栈 `dev.db` **副本**（不动原库）执行一次目标性破坏性 SQL（如删掉某条名册码事件的全部子表行），`DATABASE_URL` 指向副本重跑脚本验证转红，再对原库重跑一次验证仍绿——红绿双证；副本操作后立即删除，不留痕迹。波三升级任何 `verify:*` 判据时可复用同一手法自证"闸能咬人"

**已定事实（波三范围不变，照总纲原样）**：
- 总纲 §3「波三 · 检索动线 + 收口」列的 7 项工作范围（keyword 补 eventNo / 深链最小集 / 筛选补栏 correlationId / 跳转映射补齐孤儿类型 / 资金单审计栏改读中央日志 / `AuditLogsPage` 套 `ListFooter` / 文档收口 + 词表最全版）照总纲原样，本骨架不改动、不裁剪
- 波三是本战役收尾波，验收判据 3（"从实体页一键进审计"零人肉抄号切页）+ 判据 6（词表最全版交业主）落在这一波

**波二 Task 10 走查顺手发现、供波三评估纳入范围（非强制，脑暴现场定）**：
- 审计详情页目前没有"Related Subjects"展示区——后端 `findOne()` 已把 `subjects` 数组塞进响应，但 `AuditLogDetailPage.tsx` 从未声明/渲染这个字段，子表数据只能在 Raw Record 的 JSON dump 里肉眼找到（BACKLOG §H 已登记该观察，含走查截图路径）；波三如果做深链/UX 收口，这是个自然的顺手项，但不在总纲字面范围内，需业主/脑暴现场确认要不要收进本波

**待定岔口**：无——总纲范围明确，具体任务拆分与执行顺序留给波三新会话现场跟业主脑暴展开，本骨架不预判。
