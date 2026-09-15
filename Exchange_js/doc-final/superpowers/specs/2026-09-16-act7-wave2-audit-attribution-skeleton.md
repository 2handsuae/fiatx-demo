# 第七幕波二 · 留痕补齐与归因 —— spec 骨架

> 总纲：`2026-09-15-act7-audit-campaign-charter.md`（波二节=范围权威）。本文件只是骨架：承接记录 + 已定事实；spec 的展开是波二新会话读总纲 + 本承接后**跟业主脑暴**的活，波一收尾会话不代写。

## 承接上一波（波一，2026-09-16 收官）

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

**下一波前提有无变化**：无。总纲波二范围照旧：V1 ~29 码补 subjects（样板 `approvals.service.ts:193-196`）｜证据包导出族补 subjects ｜ `MATERIAL_REQUEST_ISSUED` 改 recordByActor 归因 ｜ `verifyMfaCode` 锁定路径补打点 ｜ 删 customers CRUD 三死端点 ｜ `verify:audit` Q2/Q4 升级名册断言。

## 已定事实（不翻案）

- 岔口②（decisions.md 2026-09-15）：customers 裸 CRUD 三端点**删除**，不做"手动建客户"
- BACKLOG §H 权威清单：仍零 subjects = users/ 六 workflow（37 处）+ role-definition-create（4）+ approval-policy-change（3）+ 证据包导出族 + ADMIN_ACCESS_DENIED（guard 不补，actorNo 已可查，总纲明文）
- 全波不动 schema/seed；不动前端（纯后端写入面）

## 待定岔口

无（总纲未留波二岔口；脑暴若冒出新岔口按惯例现场摊给业主）。
