Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-03
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/cleanup/2026-04-wave1-foundation-reset/wave-1-foundation-tightening-bcd-design.md`, `docs/cleanup/2026-04-wave1-foundation-reset/wave-1-foundation-tightening-bcd-implementation-plan.md`
Source of Truth Level: cleanup

# Wave 1 Foundation Tightening BCD Acceptance Notes

## Purpose
- 记录 `BCD` 本轮收口后的验收结果与回归证据。
- 这里只记录已经跑过的验证结果，不替代 design / implementation plan，也不扩散到更大范围的 cleanup 结论。

## Stage D: Runtime Leakage / Cross-Wave Trim
- 本次 focused regression 覆盖了 `approvals`、`users`、`admin invitations`、`customers` 和 `audit logs` 的关键回归面。
- 结果显示这些已纳入的 Stage D 运行时路径保持稳定，相关 suite 全部通过。
- `admin-web` 构建也通过，说明 Stage D 相关的 primary view / projection surface 在当前状态下没有阻断前端发布。
- 这次验证没有暴露新的 cross-wave leak 回归点。

## Stage C: Audit Contract Tightening
- `src/modules/risk-engine/audit-logs/audit-logs.service.spec.ts` 通过。
- 这说明当前 audit logs 的 contract 收口在本次回归面上是稳定的，未出现新的服务级断裂。
- `admin-web` build 通过，意味着 audit 相关页面 projection 在当前状态下仍可正常编译。

## Stage B: Entity / UI Convergence
- `src/modules/identity/users/users.service.spec.ts`、`src/modules/identity/customers/customers.service.spec.ts`、`src/modules/governance/approvals/approvals.controller.spec.ts`、`src/modules/governance/approvals/approvals.service.spec.ts` 全部通过。
- 这些回归结果支持当前 `Wave 1` 实体服务与 UI 投影之间的收敛状态是稳定的。
- `admin-web` build 通过，也说明当前实体到页面的编译链路没有出现新的断裂。

## Verification
- 回归命令 1：
  - `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/governance/approvals/approvals.service.spec.ts src/modules/governance/approvals/approvals.controller.spec.ts src/modules/identity/users/users.service.spec.ts src/modules/identity/users/admin-invitations.service.spec.ts src/modules/identity/customers/customers.service.spec.ts src/modules/risk-engine/audit-logs/audit-logs.service.spec.ts --runInBand`
  - 结果：PASS
  - 汇总：`6` 个 suite 通过，`58` 个测试通过
- 回归命令 2：
  - `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npm run build`
  - 结果：PASS
- 回归命令 3：
  - `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm run build`
  - 结果：FAIL
  - 失败点：`src/app.module.ts` 与 `src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-scheduler.service.ts`
  - 失败原因：`Cannot find module '@nestjs/schedule' or its corresponding type declarations`

## Backend Build State
- `npm run build` 失败，失败点位于 `@nestjs/schedule` 的模块解析 / 类型声明缺失。
- 这属于与当前任务无关的既有问题。
- 本次 acceptance notes 只如实记录该失败，不对其做额外归因。

## Closeout
- 已完成本轮要求的 focused regression 与双 build 记录。
- 当前可以确认的结论是：回归命令通过，`admin-web` build 通过，backend build 仍受既有依赖问题阻断。
