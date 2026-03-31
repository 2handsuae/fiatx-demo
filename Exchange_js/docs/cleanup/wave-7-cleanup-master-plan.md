# Wave 7 Cleanup Master Plan

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-28
Applies To: `Exchange_js`
Supersedes: none
Depends On:
- `docs/roadmap/wave-7-withdraw-payout-phase-plan.md`
- `docs/roadmap/project-version-plan.md`
- `docs/constraints/customer-transaction-flow-constraints.md`
- `docs/constraints/posting-clearing-balance-projection-constraints.md`
- `docs/constraints/safeguarding-reconciliation-constraints.md`
- `docs/constraints/audit-logging-constraints.md`
- `docs/specs/workflows/withdraw-payout-canonical-workflow.md`
- `docs/specs/workflows/payin-deposit-canonical-workflow.md`
- `docs/specs/workflows/safeguarding-reconciliation-workflow.md`
- `docs/specs/entities/withdraw-transaction-entity.md`
- `docs/specs/entities/payout-entity.md`
- `docs/specs/entities/reconciliation-break-entity.md`
- `docs/acceptance/wave-7-withdraw-payout-final-acceptance-checklist.md`
- `docs/acceptance/wave-7-withdraw-accounting-blocked-runbook.md`
- `docs/acceptance/wave-7-withdraw-evidence-export-runbook.md`
- `docs/acceptance/wave-7-minimum-daily-reconciliation-runbook.md`
Source of Truth Level: cleanup

## Current Position
- 以 `2026-03-28` 当前仓库状态看，`Wave 7` 的客户主流程已可运行并已完成主链验收：
  - `fiat payin -> deposit`
  - `crypto payin -> deposit`
  - `fiat withdraw -> payout`
  - `crypto withdraw -> payout`
  - `TX_DEPOSIT_FINAL / TX_WITHDRAW_FINAL`
  - `alert / case -> canonical workflow callback`
  - `withdraw evidence export`
  - `minimum daily reconciliation`
- 当前 durable truth 已收口到：
  - `docs/constraints/**`
  - `docs/specs/**`
  - `docs/acceptance/**`
- cleanup 层当前不再负责定义新的 `Wave 7` runtime feature；本文件只用于记录：
  - `deposit/withdraw` 与 `payin/payout` 的对称性收口计划
  - response container、risk adapter、read model 的兼容壳整理顺序
  - 高频分支验收与 evidence closeout 的补齐范围
  - `Wave 8` 的明确 handoff 边界
- 当前判断基线不是“主流程还能不能跑”，而是：
  - 相似主体是否使用了尽可能一致的语言与字段表达
  - compatibility shell 是否仍占据 active truth 主位
  - canonical audit trail / evidence read model 是否已经镜像收口
  - 高频分支是否已进入正式 acceptance baseline

## Current Debt
- 当前 `Wave 7` 的主要 debt 不是新功能缺口，而是以下 4 类 cleanup debt：
  - transaction root 命名、字段和状态词不对称
  - response container 语义已部分收口，但旧语义 adapter 仍广泛存在
  - payin/payout rail vocabulary 与详情审计读取不对称
  - 高频分支验收、evidence closeout 与 closure record 尚未补齐
- 当前 debt 的典型表现包括：
  - `COMPLIANCE_PENDING` 与 `PENDING_COMPLIANCE` 并存
  - `CLEAR` 与 `CLEARED` 并存
  - `PayinType=crypto/fiat` 与 `PayoutType=CRYPTO/FIAT` 并存
  - response lifecycle 已转向 `CREATED / RECEIVED / FINAL`，但 bridge / mock helper / snapshot 仍保留 `PASS / ACCEPTED / NOT_REQUIRED`
  - `withdraw` 已切到 canonical audit trail，而 `deposit/payin` 详情仍依赖 legacy audit relation
  - `TX_WITHDRAW_PRECHECK / REVIEW_WITHDRAW_PRECHECK` 仍存在于 workflow 与 risk bridge 的兼容壳中

## Target End State
- `deposit/withdraw` 作为 transaction root，使用尽可能一致的字段语义、状态词、派生读模型和 compatibility inventory 表达。
- `payin/payout` 作为 rail root，使用尽可能一致的 rail vocabulary、receipt 字段、detail read model 和 canonical audit trail。
- `Pre-KYT / Travel Rule / KYT` 统一退回 evidence container 语义：
  - lifecycle 只认 `CREATED / RECEIVED / FINAL`
  - 不再承载 risk disposition
- 风险真相统一只认：
  - `decision record`
  - `alert`
  - `case`
  - canonical workflow callback
- 所有 legacy / compatibility / deprecated 字段都被明确归类为：
  - `active truth`
  - `retained compatibility shell`
  - `retirement candidate`
- `Wave 7 cleanup` 完成时，主流程不变，但相似主体会形成单一、可解释、可审美地对称的实现语言。

## Scope
- 只做 `Wave 7` post-implementation cleanup / convergence 规划。
- 只记录 stage 目标、债务边界、退役顺序和验证标准。
- 允许把 `deposit/withdraw`、`payin/payout`、response container、risk adapter、audit/evidence、acceptance baseline 的不对称性纳入 cleanup backlog。
- 允许把 `Wave 8` handoff 作为 cleanup 输出的一部分固定下来。

## Out Of Scope
- 不新增新的 `Wave 7` runtime feature。
- 不改变已经通过验收的主流程路径。
- 不把 cleanup 文档改写成新的行为真相文档。
- 不在本文直接执行 schema 删除、route 删除、breaking API change 或 UI 重构。
- 不把 `Wave 8` 的 full safeguarding reconciliation、threshold / escalation、funding / treasury coverage 提前塞回 `Wave 7 cleanup`。

## Cleanup Does Not Change Main Execution Surface
- 本 cleanup master 明确不改变以下主执行面语义：
  - `POST /withdraw-transactions`
  - `PATCH /payouts/:id/status`
  - `payin` 现有确认执行面
  - `alert` 操作面
- cleanup 允许描述的范围只包括：
  - 命名与字段语义如何收口
  - compatibility shell 如何退出 active truth
  - read model、canonical audit、evidence 如何镜像对齐
  - acceptance baseline 如何从主流程扩展到高频分支
- cleanup 不允许把“重新设计主流程”写回本文件。

## Stages
### Stage 1: Transaction Root Vocabulary And Field Convergence
- 当前状态：
  - `DepositTransaction` 与 `WithdrawTransaction` 都已成为正式主交易主体
  - 但字段、状态词、兼容列和派生读模型仍未镜像收口
- `2026-03-28` 执行说明：
  - Stage 1 采用“读模型优先”的方式推进
  - 不做 Prisma schema migration
  - 不物理改名数据库状态值
  - 不改变已经通过验收的主流程路径
- 目标：
  - 对齐 `DepositTransaction` 与 `WithdrawTransaction` 的字段语义、状态词、派生读模型和 compatibility inventory
- 主要任务：
  - 固定一张 `DepositTransaction vs WithdrawTransaction` 对照矩阵，至少覆盖：
    - `deposit.status` vs `withdraw.status`
    - `payinId` vs `payoutId`
    - `kytStatus / preKytStatus / travelRuleStatus`
    - `complianceStatus` vs `derivedComplianceStatus`
    - `approvedAt / payoutRequestedAt / completedAt` 与 deposit 侧对应时间字段
  - 把差异明确分成 3 类：
    - `true domain asymmetry`
    - `cleanup-needed naming drift`
    - `retained compatibility shell`
  - 固定 `deposit list/detail` 与 `withdraw list/detail` 的读模型对齐原则：
    - 哪些字段必须同时暴露
    - 哪些字段只保留在兼容层
    - 哪些字段必须由派生读模型承载，不再以物理列为主真相
  - 审计并分类以下典型遗留项：
    - `COMPLIANCE_PENDING` vs `PENDING_COMPLIANCE`
    - `WithdrawTransactionStatus.CREATED / APPROVED / HELD`
    - `WithdrawTransactionAction.CHECK / APPROVE / CANCEL / RETURN`
    - `withdraw.complianceStatus`
- 退出标准：
  - implementer 能一眼看出哪些字段必须最终对齐，哪些字段只是暂时兼容保留
  - `deposit` 与 `withdraw` 的读模型边界不再靠实现线程临时猜测

### Stage 2: Response Container Contract Convergence
- 当前状态：
  - response 容器已经在主流程中回到 evidence container 语义
  - 但 `deposit` / `withdraw`、`payin` / `payout` 的创建时机、快照字段和旧语义 adapter 仍未彻底收口
- `2026-03-28` 执行说明：
  - Stage 2 已完成主 surface 收口
  - 新路径创建时机已固定为：
    - `fiat withdraw` 不创建 response
    - `crypto withdraw`：create 时 `Pre-KYT + Travel Rule`，`payout CONFIRM` 时 `KYT`
    - `fiat payin` 不创建 response
    - `crypto payin`：`payin CONFIRM` 时 `KYT + Travel Rule`
  - admin 主界面、transaction root detail、`tx-cases` 聚合、response list/detail 已统一显示 `CREATED / RECEIVED / FINAL`
  - 旧 `PASS / ACCEPTED / NOT_REQUIRED / REVIEW / FAIL` 已退出 active truth，只保留在内部兼容 adapter / historical raw payload 中
- 目标：
  - 把 `Pre-KYT / Travel Rule / KYT` 的 lifecycle 与创建时机写成唯一真相，并统一 `deposit` 与 `withdraw`
- 主要任务：
  - 固定 `Wave 7` response creation truth：
    - `fiat withdraw` 不创建 response
    - `crypto withdraw`：create 时 `Pre-KYT + Travel Rule`，`payout CONFIRM` 时 `KYT`
    - `fiat payin` 不创建 response
    - `crypto payin`：`payin CONFIRM` 时 `KYT + Travel Rule`
  - 固定 response lifecycle：
    - 只认 `CREATED / RECEIVED / FINAL`
    - 不再表达 `PASS / ACCEPTED / NOT_REQUIRED`
  - 单独列出仍存在旧语义 adapter 的区域：
    - bridge 内部映射
    - snapshot compatibility 列
    - mock-complete helper
    - old alert/rule wording
  - 固定 response detail/list/read-model 的展示原则：
    - response 只作为证据容器
    - 风险结论统一由 decision record / alert / case callback 呈现
- 退出标准：
  - response 的产品真相、兼容壳范围、以及后续 retirement 顺序全部清晰
  - implementer 不再需要自行决定哪些 response 是“风险状态”，哪些只是 evidence container

### Stage 3: Workflow / Risk Compatibility Shell Cleanup
- 当前状态：
  - `deposit` 主链已较接近单阶段 final review
  - `withdraw` 的 `PRECHECK` 兼容壳已降为 historical read-only：
    - 新单不再创建、执行或模拟 `TX_WITHDRAW_PRECHECK`
    - historical PRECHECK record 仍可在 audit / evidence / detail 中查看
    - PRECHECK alert / case / workflow action 已退出 live surface
- 目标：
  - 清掉 `deposit/withdraw` workflow 和 risk bridge 中仍挂着的旧 stage、旧 transition code、旧 decision context 心智
- 主要任务：
  - 明确将以下项目定义为 cleanup target：
    - `TX_WITHDRAW_PRECHECK`
    - `REVIEW_WITHDRAW_PRECHECK`
    - withdraw workflow 的 `CREATED -> PRECHECK` 残留
    - bridge 中 `FINAL -> PASS/ACCEPTED` 的兼容映射
    - transaction root 上不再作为主真相的 `complianceStatus`
  - 固定 cleanup 规则：
    - 这些对象短期可能仍物理存在
    - 但必须退出 active truth、active acceptance、active UI wording
  - 审计 `deposit` 与 `withdraw` workflow service 的 trace root、transition code、workflowType、detail summary 是否仍存在跨领域或旧时代 alias
  - 明确 risk bridge 中哪些内容属于：
    - active runtime logic
    - retained compatibility adapter
    - retirement candidate
- 退出标准：
  - `deposit` 与 `withdraw` 都只剩 1 套当前真相
  - legacy shell 只作为 compatibility inventory 出现，不再继续渗透到主 UI、主文档、主 acceptance

### Stage 4: Payin / Payout Rail And Read-model Convergence
- 当前状态：
  - `payin` 与 `payout` 都已形成可运行 rail
  - admin read model 现已统一补齐：
    - `ownerNo`
    - `transactionType / transactionId / transactionNo`
    - `displayStatus`
  - admin payload 的 `type` 已统一为 `CRYPTO / FIAT`
  - `payin` 与 `payout` detail 都已读取 canonical audit trail
  - `CLEAR` 与 `CLEARED` 的差异已降到 display/read-model 层，不再作为 rail 语义分歧
- 目标：
  - 对齐 `payin` 与 `payout` 的 rail vocabulary、type casing、receipt 语义、detail read model、canonical audit trail
- 主要任务：
  - 新增一张 `Payin vs Payout` 对照矩阵，至少覆盖：
    - `type` casing
    - status 命名
    - rail step naming
    - `txHash / referenceNo / providerTxnId / confirmations`
    - detail API 是否读 canonical audit
    - repair / retry surface
  - 明确哪些差异必须保留：
    - inbound 与 outbound 的业务步骤天然不同
    - crypto inbound 与 crypto outbound 不应被强行压成同一 rail
  - 明确哪些差异属于 cleanup debt：
    - `crypto/fiat` casing 不统一
    - `CLEAR` vs `CLEARED`
    - payin 详情仍读 legacy audit，而 payout 已读 canonical audit
    - `BLOCK` 等旧 rail naming 是否仍需保留
  - 固定 payin/payout detail、audit panel、evidence summary 的镜像原则：
    - 相似字段要用相似名字
    - 相似证据要用相似入口
    - 相似 rail 状态要用相似视觉语法
  - 固定当前已实现的 Stage 4 真相：
    - raw `status` 保持 rail truth
    - `displayStatus` 作为 admin 展示真相
    - raw `type` 查询兼容旧枚举，admin payload 统一输出大写
    - `payin` 无 repair surface，`payout` 保留 `re-closeout / re-compensate`
- 退出标准：
  - `payin/payout` 在 UI、API、证据链上的表达方式达到镜像对称，而不是两套语言
  - “必须保留的业务差异”和“只是命名漂移”被明确分开

### Stage 5: Branch Acceptance / Evidence / Final Closeout
- 当前状态：
  - `Wave 7` 目前主流程已经过验收
  - 高频分支、evidence export 对称性、canonical audit trail 完整性尚未形成 closeout baseline
- `2026-03-28` 执行说明：
  - Stage 5 按“先修真问题，再清审美 debt”的顺序推进：
    1. `5A Current UX / Read-model Defects`
    2. `5B Workflow Truth And Doc Truth Re-sync`
    3. `5C Withdraw PRECHECK Deep Retirement`
    4. `5D Response Adapter Semantic Convergence`
    5. `5E Vocabulary / Enum / Branch Acceptance / Closeout`
  - 当前已固定的 Stage 5 收口结论：
    - `PayinList` 等 admin surface 不再依赖旧 `fiat/crypto` casing 判断 Stage 4 读模型
    - entity / constraints / acceptance 文档已回到当前 lifecycle truth
    - `TX_WITHDRAW_PRECHECK` 进一步退为 historical compatibility only，不再保留深层 live execution
    - response lifecycle 继续以 `CREATED / RECEIVED / FINAL` 为唯一 active truth
    - raw `PayinType/PayoutType` 与 `CLEAR/CLEARED` 差异被明确冻结在 compatibility/public-contract 边界，不再作为 admin display truth
    - closeout baseline 固定在 `docs/acceptance/wave-7-cleanup-closeout-baseline.md`
- 目标：
  - 把当前只验过主流程的状态，扩成覆盖高频分支的 `Wave 7` closeout baseline
- 主要任务：
  - 固定一组 acceptance buckets：
    - `deposit`: `LOW / MEDIUM / HIGH / REJECT / FREEZE / FAIL`
    - `withdraw`: `LOW / MEDIUM / HIGH / FALSE_POSITIVE / REJECT / PAYOUT_FAIL / TIMEOUT / RETURNED`
    - `payin`: `fiat / crypto confirm paths`, `fail paths`, `cleared paths`
    - `payout`: `fiat / crypto confirm paths`, `fail paths`, `re-closeout`, `re-compensate`
    - evidence export: `SUCCESS / UNDER_REVIEW / REJECTED / RETURNED / FAILED`
  - 固定 canonical audit trail 的 closeout baseline：
    - transaction detail
    - rail detail
    - Audit Center
    - evidence package
  - 明确 `Wave 7 cleanup complete` 之后的 handoff：
    - `Wave 8` owns `full safeguarding reconciliation`
    - `Wave 8` owns `threshold / escalation`
    - `Wave 8` owns `funding / treasury coverage`
    - `Wave 8` owns更完整的 treasury / safeguarding operator tooling
    - `Wave 9` owns `governance registries`
    - `Wave 9` owns `filing receipt effectiveness 与 governance registry 运营化联动`
- 退出标准：
  - `Wave 7 cleanup master` 可以从 active plan 退成 closure record
  - 剩余问题不再挂在 `Wave 7`，而是明确移交到 `Wave 8 / Wave 9` 或独立 remediation thread

## Stage Ordering Rationale
- 先做 `Stage 1`，因为如果 transaction root 的词汇、字段和兼容列都还没收口，后续 response / rail cleanup 没有稳定坐标系。
- 再做 `Stage 2`，因为 response container 是 `deposit/withdraw` 与 `payin/payout` 最容易再次长回旧语义的地方；如果 response contract 不先统一，risk shell 无法安全裁剪。
- 然后做 `Stage 3`，因为 workflow / risk compatibility shell 是当前最深的双轨来源，必须在 vocabulary 与 response contract 固定之后再清。
- 再做 `Stage 4`，因为 payin/payout rail 与 canonical audit trail 属于对外呈现面；只有在 transaction root 和 risk shell 已稳定后，rail vocabulary 才能收口。
- 最后做 `Stage 5`，把 cleanup 后的真实实现扩成高频分支 acceptance baseline，并形成 final closeout audit，避免边验边改语义。
- 这套顺序的目标是：
  - 先收口“语言和坐标系”
  - 再收口“兼容壳和呈现面”
  - 最后收口“验收和 closure record”

## Residual Inventory

| Object | Current Truth | Asymmetry / Debt | Cleanup Position | Target State |
| --- | --- | --- | --- | --- |
| `DepositTransaction` | canonical inbound transaction root | status 词汇、compat 字段、detail audit 与 withdraw 不完全对齐 | stage 1 owner | 与 `WithdrawTransaction` 形成镜像字段与读模型 |
| `WithdrawTransaction` | canonical outbound transaction root | `CREATED / APPROVED / HELD`、`complianceStatus`、precheck shell 仍然存在 | stage 1 + stage 3 owner | 只保留当前真相 + 明确兼容壳 |
| `Payin` | canonical inbound rail root | raw `type/action` 仍是小写 public contract，但 admin read model 已收口；与 payout 的 raw enum 仍不对称 | stage 4 + stage 5 owner | 与 `Payout` 在 vocabulary 与 read model 上镜像对齐，raw enum 差异只留在兼容边界 |
| `Payout` | canonical outbound rail root | raw `CLEAR` vs `CLEARED`、uppercase type/action 仍存在 public-contract asymmetry | stage 4 + stage 5 owner | 与 `Payin` 使用尽可能一致的 rail language，raw 差异不再渗透到 admin surface |
| `Response Containers` | 已回到 evidence container 语义 | bridge/mock/snapshot 中旧 `PASS / ACCEPTED / NOT_REQUIRED` 仍存在 | stage 2 owner | 只认 `CREATED / RECEIVED / FINAL` |
| `Risk / Alert / Case Adapter` | `TX_DEPOSIT_FINAL / TX_WITHDRAW_FINAL` 已是当前真相 | `TX_WITHDRAW_PRECHECK` 与旧 trigger stage 仍留在 compatibility shell | stage 3 owner | 只保留单阶段 active truth，旧 context 降为兼容 |
| `Audit / Evidence / Reconciliation` | withdraw/payout 已接 canonical audit 与 evidence export | deposit/payin 详情与 evidence 叙事仍未完全镜像收口 | stage 4 + stage 5 owner | 审计与 evidence 以 root 对称方式暴露 |

## Verification Baseline
- 当前已确认的 baseline：
  - 主流程已验收
  - withdraw evidence export 已进入 Wave 7 主链
  - minimum daily reconciliation 已形成 runtime 面
- cleanup 视角下仍待补齐的 baseline：
  - 高频分支 acceptance 尚未形成完整 bucket
  - canonical audit trail 尚未在四类主体上完全统一
  - evidence package 仍需按 `deposit/withdraw` 与 `payin/payout` 的镜像方式验收
- 后续 cleanup 验收矩阵至少要覆盖：
  - transaction root symmetry
  - response contract symmetry
  - workflow / risk shell retirement boundary
  - rail/read-model symmetry
  - branch/evidence closeout

## Exit Criteria
- `Wave 7 cleanup` 完成时，至少应满足：
  - `deposit/withdraw` 的字段语义、状态词和派生读模型已形成单一坐标系
  - response container 已统一为 evidence container，不再在 active path 中承担 risk disposition 语义
  - `TX_WITHDRAW_PRECHECK` 与旧 response 状态语义不再占据 active truth
  - `payin/payout` 在 vocabulary、type casing、receipt 语义、detail audit 上达到镜像收口
  - 主流程之外的高频分支已进入 acceptance baseline
  - `Wave 7` 与 `Wave 8` 的边界已稳定，cleanup master 可以退为 closure record

## Rollback / Compatibility Note
- 本计划是 cleanup backlog，不是新的产品波次。
- cleanup 执行时应遵守：
  - 先统一 vocabulary / field semantics
  - 再统一 response contract
  - 再裁剪 workflow / risk compatibility shell
  - 然后收口 rail / read model / audit language
  - 最后补 branch acceptance 与 closeout
- 若在任一阶段发现 active caller 仍依赖兼容层：
  - 优先回退到“保留兼容壳并明确标记 retained compatibility”
  - 不得为了完成 cleanup 而破坏当前 Wave 7 主链
