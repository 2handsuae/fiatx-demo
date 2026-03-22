Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/roadmap/project-version-plan.md`, `docs/constraints/governance-approval-constraints.md`, `docs/constraints/governance-change-ticket-constraints.md`, `docs/constraints/governance-delete-request-constraints.md`, `docs/constraints/governance-sla-timer-constraints.md`, `docs/constraints/audit-logging-constraints.md`, `docs/constraints/rbac-member-management-constraints.md`, `docs/specs/workflows/audit-evidence-export-approval-workflow.md`, `docs/specs/workflows/change-ticket-release-gate-workflow.md`, `docs/specs/workflows/delete-request-soft-delete-workflow.md`, `docs/specs/workflows/governance-sla-timer-workflow.md`, `docs/specs/workflows/admin-member-auth-boundary-workflow.md`, `docs/specs/entities/audit-evidence-package-entity.md`, `docs/specs/entities/change-ticket-entity.md`, `docs/specs/entities/delete-request-entity.md`, `docs/specs/entities/governance-sla-timer-entity.md`, `docs/specs/entities/admin-user-entity.md`, `docs/specs/modules/governance-control-foundation-module.md`, `docs/specs/modules/rbac-member-management-module.md`, `docs/acceptance/governance-e2e-acceptance-checklist.md`, `docs/acceptance/local-main-runtime-runbook.md`, `docs/cleanup/wave-1-governance-audit-cleanup-master-plan.md`
Source of Truth Level: acceptance

# Wave 1 Foundation Final Acceptance

## Purpose
- 本文档是 `Wave 1` governance / audit foundation 的最终验收结论页。
- 它不替代现有 checklist 或 runbook，而是汇总当前已经通过的 runtime 与 regression evidence。
- 它回答 4 个问题：
1. `Wave 1` 基座是否已经验收通过
2. 当前通过了哪些能力域
3. 如何快速复核
4. 本轮明确不做什么

## Audience
- project owner
- QA / UAT operator
- runtime smoke owner
- future agent / maintainer

## Required Companion Docs
- Roadmap completion note:
  - `docs/roadmap/project-version-plan.md`
- Constraints:
  - `docs/constraints/governance-approval-constraints.md`
  - `docs/constraints/governance-change-ticket-constraints.md`
  - `docs/constraints/governance-delete-request-constraints.md`
  - `docs/constraints/governance-sla-timer-constraints.md`
  - `docs/constraints/audit-logging-constraints.md`
  - `docs/constraints/rbac-member-management-constraints.md`
- Durable specs:
  - `docs/specs/workflows/audit-evidence-export-approval-workflow.md`
  - `docs/specs/workflows/change-ticket-release-gate-workflow.md`
  - `docs/specs/workflows/delete-request-soft-delete-workflow.md`
  - `docs/specs/workflows/governance-sla-timer-workflow.md`
  - `docs/specs/workflows/admin-member-auth-boundary-workflow.md`
  - `docs/specs/entities/audit-evidence-package-entity.md`
  - `docs/specs/entities/change-ticket-entity.md`
  - `docs/specs/entities/delete-request-entity.md`
  - `docs/specs/entities/governance-sla-timer-entity.md`
  - `docs/specs/entities/admin-user-entity.md`
  - `docs/specs/modules/governance-control-foundation-module.md`
  - `docs/specs/modules/rbac-member-management-module.md`
- Acceptance / runbook:
  - `docs/acceptance/governance-e2e-acceptance-checklist.md`
  - `docs/acceptance/local-main-runtime-runbook.md`
- Cleanup closure context:
  - `docs/cleanup/wave-1-governance-audit-cleanup-master-plan.md`

## Accepted Scope
- approval canonical taxonomy
- change ticket canonical taxonomy
- delete request canonical taxonomy
- SLA taxonomy freeze
- approval-backed audit evidence export
- approval-backed case evidence export
- onboarding / periodic review `case-only` contract
- admin user soft delete governance behavior
- canonical case runtime surface

## Acceptance Evidence Summary
- 验收日期：`2026-03-22`
- 定点回归：
  - `19` 个 suite 通过
  - `200` 个测试通过
- 构建：
  - backend `npm run build` 通过
  - admin-web `npm run build` 通过
- 运行时诊断：
  - `npm run dev:rebuild` 通过
  - `npm run runtime:diagnose`
  - `migration.driftDetected=false`
  - `dbFile=/tmp/exchange_js_main/dev.db`
- 主栈可用性：
  - `npm run dev:start` 通过
  - `curl http://localhost:3000/api` 返回 `200`
- Demo / smoke：
  - `API_BASE_URL=http://localhost:3000 npm run governance:demo:seed` 通过
  - `API_BASE_URL=http://localhost:3000 npm run sla:demo:smoke` 通过
  - `API_BASE_URL=http://localhost:3000 npm run wave1:foundation:smoke` 通过

## Final Acceptance Verdict
- `Approval`: `PASSED`
- `Change Ticket`: `PASSED`
- `Delete Request`: `PASSED`
- `SLA`: `PASSED`
- `Audit Logging`: `PASSED`
- `Audit Evidence Export`: `PASSED`
- `Case Evidence Export`: `PASSED`
- `Admin User Soft Delete`: `PASSED`
- `Case-only Contract`: `PASSED`

## Closure Status
- `Wave 1`: `IMPLEMENTATION_COMPLETE`
- `Wave 1`: `DOCUMENTATION_COMPLETE`

## Re-run Command Set
在 `Exchange_js` 工作目录下执行：

```bash
npm run prisma:generate
npm run test -- src/modules/governance/approvals/approvals.service.spec.ts src/modules/governance/approvals/audit-evidence-export-approval.service.spec.ts src/modules/governance/change-tickets/change-tickets.service.spec.ts src/modules/governance/delete-requests/delete-requests.service.spec.ts src/modules/governance/sla-timers/sla-timers.service.spec.ts src/modules/risk-engine/audit-logs/audit-logs.service.spec.ts src/modules/risk-engine/compliance-alerts/compliance-alerts.service.spec.ts src/modules/risk-engine/compliance-incidents/compliance-incidents.service.spec.ts src/modules/identity/onboarding/onboarding-admin.controller.spec.ts src/modules/identity/onboarding/onboarding.service.spec.ts src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts src/modules/identity/periodic-review/periodic-review-admin.controller.spec.ts src/modules/identity/periodic-review/periodic-review.service.spec.ts src/modules/identity/users/users.service.spec.ts src/modules/identity/users/users.controller.spec.ts src/modules/identity/auth/auth.service.spec.ts src/modules/identity/users/admin-invitations.service.spec.ts src/modules/identity/access-control/access-control.service.spec.ts src/modules/risk-engine/compliance-incidents/compliance-case-evidence-packages.service.spec.ts
npm run build
cd admin-web && npm run build && cd ..
npm run dev:rebuild
npm run runtime:diagnose
npm run dev:start
curl http://localhost:3000/api
API_BASE_URL=http://localhost:3000 npm run governance:demo:seed
API_BASE_URL=http://localhost:3000 npm run sla:demo:smoke
API_BASE_URL=http://localhost:3000 npm run wave1:foundation:smoke
```

## Pass Criteria
- 当前 `main` stack 端口固定为：
  - backend `3000`
  - admin-web `3001`
  - client-web `3002`
- stack-managed 命令默认落到：
  - `/tmp/exchange_js_main/dev.db`
- `runtime:diagnose` 返回：
  - `migration.driftDetected=false`
  - `dbFile=/tmp/exchange_js_main/dev.db`
- `curl http://localhost:3000/api` 返回 `200`
- onboarding / periodic review case decision 响应只暴露 `case`，不再暴露 `incident`
- `Approval Detail` 同时支持：
  - audit evidence package summary
  - case evidence package summary
- 已软删 admin user 在以下链路统一被隐藏或拒绝：
  - platform members list
  - admin login
  - invitation preview
  - invitation accept
  - invitation resend
  - role replace

## Out Of Scope / Residual Debt
- 本轮不做 physical rename。
- 本轮不做 physical model merge。
- 历史 internal naming 只允许作为存量实现细节存在，不再视为 runtime compat debt。
- 当前长期口径：
  - `runtime compat debt = 0`
  - Wave 1 长期真相位于 `docs/constraints/**`、`docs/specs/**`、`docs/acceptance/**`
- 当前文档矩阵已覆盖：
  - roadmap completion note
  - constraints final-state check
  - workflow specs
  - entity specs
  - module specs
  - acceptance conclusion
- `docs/cleanup/**` 仅保留 staged cleanup 和退役历史，不再承担长期语义真相。
