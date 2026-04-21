> **PARTIALLY OUTDATED** — Some sections of this document no longer match the current code.
> Last verified: 2026-04-11. See notes below for specific outdated sections.
>
> Updated specs: `docs/specs/wave3-layer2-risk-assessment.md`, `docs/specs/wave3-layer3-material-refresh.md`, `docs/specs/wave3-onboarding-integration.md`
>
> **Note:** Draft status, SLA scope decision completed

Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-04-02
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/cleanup/2026-04-wave1-foundation-reset/README.md`, `docs/roadmap/project-version-plan.md`
Source of Truth Level: review-note

# Wave Boundary SLA / Governance Realignment

## Purpose
- 记录本轮关于 `SLA / obligation / breach / escalation` 的波次边界调整。
- 避免后续继续把治理旁支能力误塞回 onboarding、treasury、client money 等业务主流程。

## Final Decision
- 通用 `obligation / SLA / breach / escalation` 治理能力整体后移到 `Wave 9`。
- `Wave 1` 保留的 `WF-04` 只按“历史最小 timer/notifier kernel”理解，不再继续扩展成平台级治理产品。
- `Wave 2-8` 可以保留业务必需的时间事实、局部控制结果、case-local overdue facts，但不再把它们抽象成统一治理引擎。

## Boundary Clarifications

### 1. Why `Wave 9`
- 这些能力本质上是治理层，而不是客户认证、充值、兑换、提现、treasury 的业务主干。
- 它们大多数是旁挂流程：挂在 case、incident、complaint、reporting obligation 上，而不是业务主状态机的一部分。
- 如果过早通用化，容易把前面 waves 的主流程重新搞复杂。

### 2. What Stays In Earlier Waves
- earlier waves 仍然可以保留：
  - `receivedAt`
  - `dueAt`
  - `completedAt`
  - `effectiveAt`
  - 局部 owner / status / control result
- 这些字段只是业务事实，不等于已经落地通用 `SLA / obligation` 产品。

### 3. `Wave 8` Clarification
- `Client Money` 日对账、safeguarding batch、break register、internal treasury、fee/reimbursement coverage 都仍然属于 `Wave 8`。
- `Wave 8` 负责的是财务运营业务本体。
- 如果未来需要统一的 overdue / breach / escalation 治理壳，再由 `Wave 9` 承接。

## Product Interpretation
- `Case`：事情本身。
- `Obligation`：挂在事情上的必须完成动作。
- `SLA`：这项动作的时限规则。
- `Escalation`：这项动作超时后的治理动作。

## Practical Rule For Agents
- 如果需求是在推进客户认证、交易、资金、对账主链，优先留在对应业务 wave。
- 如果需求是在做：
  - overdue
  - breach
  - escalation
  - regulatory response timer
  - complaint timelines
  - prior notice / periodic obligation
  则默认属于 `Wave 9`，除非用户明确要求提前前移。
