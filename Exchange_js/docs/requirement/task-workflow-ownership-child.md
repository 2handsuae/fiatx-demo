Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-01
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/README.md`
Source of Truth Level: requirement-reference

# Task Workflow Ownership Snapshot

## Purpose
- This document is a Markdown snapshot converted from `Workflow_Task_Mapping_MVP_CN_v2_clean.xlsx` sheet `Task_Workflow_Ownership_Child`.
- It preserves imported requirement / control-matrix input for project planning and review.
- It does not override `docs/constraints/**`, `docs/specs/**`, or active runtime truth.

## Source
- Workbook: `/Users/songshengwei/Downloads/原始表格/Workflow_Task_Mapping_MVP_CN_v2_clean.xlsx`
- Sheet: `Task_Workflow_Ownership_Child`
- Data Rows: `301`
- Columns: `15`

## Columns
- `Master_Task_ID`
- `Parent_Task_ID`
- `Related_Master_Control_ID`
- `Task_Title`
- `Priority`
- `Mode`
- `Owner`
- `Workflow_ID`
- `Workflow_Name`
- `MVP_Status`
- `Included_In_Workflow_Summary`
- `Exclusion_Reason`
- `V1_Decision`
- `V1_Notes`
- `Included_In_Execution_V1`

## Data

| Master_Task_ID | Parent_Task_ID | Related_Master_Control_ID | Task_Title | Priority | Mode | Owner | Workflow_ID | Workflow_Name | MVP_Status | Included_In_Workflow_Summary | Exclusion_Reason | V1_Decision | V1_Notes | Included_In_Execution_V1 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MTASK-082 | MTASK-004 | MCTRL-004 | Define audit trail schema for tx/order/ledger events | P0 | Online | Finance/Compliance/Tech | WF-01 | Audit Events + Evidence Export | Must | 1 |  | Keep |  | 1 |
| MTASK-083 | MTASK-004 | MCTRL-004 | Emit and store end-to-end audit events for deposit/swap/withdraw/journal | P0 | Online | Tech | WF-01 | Audit Events + Evidence Export | Must | 1 |  | Keep |  | 1 |
| MTASK-084 | MTASK-004 | MCTRL-004 | Build audit trail export with filters (client/currency/date/module/status) | P0 | Online | Tech | WF-01 | Audit Events + Evidence Export | Must | 1 |  | Keep |  | 1 |
| MTASK-085 | MTASK-004 | MCTRL-004 | QA validate audit trail completeness and export filters | P0 | Online | QA | WF-01 | Audit Events + Evidence Export | Must | 1 |  | Keep |  | 1 |
| MTASK-086 | MTASK-005 | MCTRL-005 | Implement export package generator with export_hash | P0 | Online | Tech | WF-01 | Audit Events + Evidence Export | Must | 1 |  | Keep |  | 1 |
| MTASK-087 | MTASK-005 | MCTRL-005 | Implement sensitive export approval (Compliance/RI) | P0 | Online | Tech/Compliance | WF-01 | Audit Events + Evidence Export | Must | 1 |  | Keep |  | 1 |
| MTASK-088 | MTASK-005 | MCTRL-005 | Record delivery receipt and VARA request metadata | P0 | Online | Ops/Compliance | WF-01 | Audit Events + Evidence Export | Must | 1 |  | Keep |  | 1 |
| MTASK-089 | MTASK-005 | MCTRL-005 | QA validate sensitive export gate and receipt logging | P0 | Online | QA | WF-01 | Audit Events + Evidence Export | Must | 1 |  | Keep |  | 1 |
| MTASK-303 | MTASK-004 | MCTRL-004 | Enforce unified write path via AuditLogsService | P0 | Online | Tech Lead | WF-01 | Audit Events + Evidence Export | Must | 1 |  | Keep |  | 1 |
| MTASK-305 | MTASK-005 | MCTRL-005 | Build evidence package export (JSON manifest + SHA256) | P0 | Online | Compliance Ops | WF-01 | Audit Events + Evidence Export | Must | 1 |  | Keep |  | 1 |
| MTASK-306 | MTASK-005 | MCTRL-005 | QA masking/digest/idempotency constraints | P0 | Online | QA | WF-01 | Audit Events + Evidence Export | Must | 1 |  | Keep |  | 1 |
| MTASK-070 | MTASK-001 | MCTRL-001 | Implement IAM grant/revoke logging (user/role/permission) | P0 | Online | Tech/CISO | WF-02 | RBAC + Break-glass + Auth Boundary | Must | 1 |  | Keep |  | 1 |
| MTASK-071 | MTASK-001 | MCTRL-001 | Implement break-glass access workflow with expiry and full audit | P0 | Online | Tech/CISO | WF-02 | RBAC + Break-glass + Auth Boundary | Must | 1 | Deferred in v1 (e.g., break-glass) | Defer (break-glass) | V1 暂不实现应急权限流程；保留 RBAC/审计日志/季度导出。 | 0 |
| MTASK-072 | MTASK-001 | MCTRL-001 | Generate quarterly access review report and sign-off record | P0 | Online | Ops/CISO/HR | WF-02 | RBAC + Break-glass + Auth Boundary | Must | 1 |  | Keep |  | 1 |
| MTASK-073 | MTASK-001 | MCTRL-001 | QA validate IAM logs, break-glass, and quarterly report | P0 | Online | QA | WF-02 | RBAC + Break-glass + Auth Boundary | Must | 1 | Deferred in v1 (e.g., break-glass) | Defer (break-glass) | V1 暂不实现应急权限流程；保留 RBAC/审计日志/季度导出。 | 0 |
| MTASK-304 | MTASK-001 | MCTRL-001 | Implement No-first admin query filters & subjectNos[] | P0 | Online | Compliance Ops | WF-02 | RBAC + Break-glass + Auth Boundary | Must | 1 |  | Keep |  | 1 |
| MTASK-311 | MTASK-056 | MCTRL-056 | Enforce customer/admin token separation on routes | P0 | Online | Tech | WF-02 | RBAC + Break-glass + Auth Boundary | Must | 1 |  | Keep |  | 1 |
| MTASK-312 | MTASK-056 | MCTRL-056 | Harden RBAC catalog for config/treasury/accounting modules | P0 | Online | CISO | WF-02 | RBAC + Break-glass + Auth Boundary | Must | 1 |  | Keep |  | 1 |
| MTASK-313 | MTASK-056 | MCTRL-056 | Add maker-checker coverage for sensitive admin actions (hook only) | P0 | Online | CISO | WF-02 | RBAC + Break-glass + Auth Boundary | Must | 1 |  | Keep |  | 1 |
| MTASK-314 | MTASK-056 | MCTRL-056 | QA: boundary & RBAC matrix | P0 | Online | QA | WF-02 | RBAC + Break-glass + Auth Boundary | Must | 1 |  | Keep |  | 1 |
| MTASK-149 | MTASK-020 | MCTRL-020 | Configure SoD conflict pairs and sensitive operations list | P0 | Online | Compliance/Tech | WF-03 | SoD Block + Maker-Checker | Must | 1 |  | Keep |  | 1 |
| MTASK-150 | MTASK-020 | MCTRL-020 | Implement permission grant validation to block SoD conflicts | P0 | Online | Tech | WF-03 | SoD Block + Maker-Checker | Must | 1 |  | Keep |  | 1 |
| MTASK-151 | MTASK-020 | MCTRL-020 | Implement maker-checker for sensitive operations | P0 | Online | Tech/SM | WF-03 | SoD Block + Maker-Checker | Must | 1 |  | Keep |  | 1 |
| MTASK-152 | MTASK-020 | MCTRL-020 | Generate quarterly access review export and sign-off record | P0 | Online | Ops/Compliance | WF-03 | SoD Block + Maker-Checker | Must | 1 |  | Keep |  | 1 |
| MTASK-153 | MTASK-020 | MCTRL-020 | QA validate SoD block + maker-checker flow | P0 | Online | QA | WF-03 | SoD Block + Maker-Checker | Must | 1 |  | Keep |  | 1 |
| MTASK-094 | MTASK-007 | MCTRL-007 | Build regulatory notifications registry (notice_type, triggered_at, sent_at, receipt) | P0 | Online | Tech/Compliance | WF-04 | Notice Registry + SLA Timers | Must | 1 |  | Keep |  | 1 |
| MTASK-095 | MTASK-007 | MCTRL-007 | Implement SLA timers (Immediate 4h / 24h / 72h) and notice pack generator | P0 | Online | Tech/Ops | WF-04 | Notice Registry + SLA Timers | Must | 1 |  | Keep |  | 1 |
| MTASK-096 | MTASK-007 | MCTRL-007 | QA validate timers and registry export | P0 | Online | QA | WF-04 | Notice Registry + SLA Timers | Must | 1 |  | Keep |  | 1 |
| MTASK-127 | MTASK-015 | MCTRL-015 | Implement VARA notice pack generator and receipt logging | P0 | Online | Tech/Compliance | WF-04 | Notice Registry + SLA Timers | Must | 1 |  | Keep |  | 1 |
| MTASK-128 | MTASK-015 | MCTRL-015 | Implement CAPA tracker workflow with owner/due/close/approver and escalations | P0 | Online | Tech/Compliance | WF-04 | Notice Registry + SLA Timers | Must | 1 |  | Keep |  | 1 |
| MTASK-129 | MTASK-015 | MCTRL-015 | QA validate notice receipt capture and CAPA escalation | P0 | Online | QA | WF-04 | Notice Registry + SLA Timers | Must | 1 |  | Keep |  | 1 |
| MTASK-209 | MTASK-033 | MCTRL-033 | Implement agreement version archive and diff generation | P0 | Online | Tech/Legal | WF-04 | Notice Registry + SLA Timers | Must | 1 |  | Keep |  | 1 |
| MTASK-210 | MTASK-033 | MCTRL-033 | Implement client acceptance logging and pre-service enforcement | P0 | Online | Tech/Ops | WF-04 | Notice Registry + SLA Timers | Must | 1 |  | Keep |  | 1 |
| MTASK-211 | MTASK-033 | MCTRL-033 | Implement 30-day change notice workflow and announcement templates (fork/airdrop/delist) | P0 | Online | Ops/Legal/Compliance | WF-04 | Notice Registry + SLA Timers | Must | 1 |  | Keep |  | 1 |
| MTASK-212 | MTASK-033 | MCTRL-033 | QA validate acceptance gate and 30-day notice rule | P0 | Online | QA | WF-04 | Notice Registry + SLA Timers | Must | 1 |  | Keep |  | 1 |
| MTASK-078 | MTASK-003 | MCTRL-003 | Draft Records Retention Policy and record_type inventory | P0 | Offline | Compliance | WF-05 | Retention + Delete Gate | Must | 1 |  | Keep (soft-delete) | V1 删除采用 soft-delete（deleted_at），仍需审批与DeletionLog；硬删后置。 | 1 |
| MTASK-079 | MTASK-003 | MCTRL-003 | Implement retention_years config per record_type (no auto-delete) | P0 | Online | Tech/Compliance | WF-05 | Retention + Delete Gate | Must | 1 |  | Keep (soft-delete) | V1 删除采用 soft-delete（deleted_at），仍需审批与DeletionLog；硬删后置。 | 1 |
| MTASK-080 | MTASK-003 | MCTRL-003 | Implement deletion approval workflow and audit trail | P0 | Online | Tech | WF-05 | Retention + Delete Gate | Must | 1 |  | Keep (soft-delete) | V1 删除采用 soft-delete（deleted_at），仍需审批与DeletionLog；硬删后置。 | 1 |
| MTASK-081 | MTASK-003 | MCTRL-003 | QA validate retention config and deletion gate | P0 | Online | QA | WF-05 | Retention + Delete Gate | Must | 1 |  | Keep (soft-delete) | V1 删除采用 soft-delete（deleted_at），仍需审批与DeletionLog；硬删后置。 | 1 |
| MTASK-260 | MTASK-043 | MCTRL-043 | Implement change ticket workflow (approval, testing, rollback) for production changes | P0 | Online | Tech/CISO | WF-06 | Change Ticket + Release Gate (TGRAF) + Link Integrity | Must | 1 |  | Keep |  | 1 |
| MTASK-261 | MTASK-043 | MCTRL-043 | Implement release gate to block deployments with incomplete TGRAF checklist | P0 | Online | Tech | WF-06 | Change Ticket + Release Gate (TGRAF) + Link Integrity | Must | 1 |  | Keep |  | 1 |
| MTASK-262 | MTASK-043 | MCTRL-043 | Implement emergency change post-approval SLA (T+2 working days) and overdue alerts | P0 | Online | Ops/CISO | WF-06 | Change Ticket + Release Gate (TGRAF) + Link Integrity | Must | 1 |  | Keep |  | 1 |
| MTASK-263 | MTASK-043 | MCTRL-043 | QA validate change gates and emergency post-approval timers | P0 | Online | QA | WF-06 | Change Ticket + Release Gate (TGRAF) + Link Integrity | Must | 1 |  | Keep |  | 1 |
| MTASK-101 | MTASK-009 | MCTRL-009 | Create runbook for responding to link integrity failures | P2 | Offline | Ops/Tech/Compliance | WF-06 | Change Ticket + Release Gate (TGRAF) + Link Integrity | Must | 1 |  | Keep |  | 1 |
| MTASK-102 | MTASK-009 | MCTRL-009 | Maintain critical link registry (agreements/disclosures) with expected approval/hash | P2 | Online | Ops/Tech/Compliance | WF-06 | Change Ticket + Release Gate (TGRAF) + Link Integrity | Must | 1 |  | Keep |  | 1 |
| MTASK-103 | MTASK-009 | MCTRL-009 | Run daily link health check job and generate report | P2 | Online | Ops/Tech/Compliance | WF-06 | Change Ticket + Release Gate (TGRAF) + Link Integrity | Must | 1 |  | Keep |  | 1 |
| MTASK-104 | MTASK-009 | MCTRL-009 | Block publish when critical link broken or unapproved content change detected | P2 | Online | Ops/Tech/Compliance | WF-06 | Change Ticket + Release Gate (TGRAF) + Link Integrity | Must | 1 |  | Keep |  | 1 |
| MTASK-105 | MTASK-009 | MCTRL-009 | Implement exports: link health report by page/day | P2 | Online | Ops/Tech/Compliance | WF-06 | Change Ticket + Release Gate (TGRAF) + Link Integrity | Must | 1 |  | Keep |  | 1 |
| MTASK-106 | MTASK-009 | MCTRL-009 | QA validate detection of broken links and unapproved changes, and publish blocking | P2 | Online | QA | WF-06 | Change Ticket + Release Gate (TGRAF) + Link Integrity | Must | 1 |  | Keep |  | 1 |
| MTASK-323 | MTASK-059 | MCTRL-059 | Enforce canonical entry: payin status confirm endpoint | P0 | Online | Tech | WF-07 | PayIn→Deposit (Business) + Provider Connectors v1 | Must | 1 |  | Keep |  | 1 |
| MTASK-324 | MTASK-059 | MCTRL-059 | Add idempotency key for payin ingestion & deposit mapping | P0 | Online | Tech | WF-07 | PayIn→Deposit (Business) + Provider Connectors v1 | Must | 1 |  | Keep |  | 1 |
| MTASK-325 | MTASK-059 | MCTRL-059 | Integrate transaction compliance case creation timing (crypto only) | P0 | Online | MLRO | WF-07 | PayIn→Deposit (Business) + Provider Connectors v1 | Must | 1 |  | Keep |  | 1 |
| MTASK-326 | MTASK-059 | MCTRL-059 | QA deposit workflow ordering + posting gate | P0 | Online | QA | WF-07 | PayIn→Deposit (Business) + Provider Connectors v1 | Must | 1 |  | Keep |  | 1 |
| MTASK-369 | MTASK-067 | MCTRL-067 | Define outsourcing materiality rubric for connectors (default rule: material/critical only) | P0 | Offline | Compliance + Ops | WF-07 | PayIn→Deposit (Business) + Provider Connectors v1 | Must | 1 |  | Keep |  | 1 |
| MTASK-370 | MTASK-067 | MCTRL-067 | Add outsourcing_in_scope flag + provider_id link fields to Connector Inventory | P0 | Online | Tech Lead | WF-07 | PayIn→Deposit (Business) + Provider Connectors v1 | Must | 1 |  | Keep |  | 1 |
| MTASK-371 | MTASK-067 | MCTRL-067 | Enforce activation gate for in-scope connectors (require active outsourcing provider + contract_ref) | P0 | Online | Tech Lead + Compliance | WF-07 | PayIn→Deposit (Business) + Provider Connectors v1 | Must | 1 |  | Keep |  | 1 |
| MTASK-355 | MTASK-067 | MCTRL-067 | Bank statement import (CSV v1) for payin/payout matching (offline SOP/evidence handling) | P1 | Offline | Treasury Ops | WF-07 | PayIn→Deposit (Business) + Provider Connectors v1 | Must | 1 |  | Keep |  | 1 |
| MTASK-356 | MTASK-067 | MCTRL-067 | Custody connector v1 (manual signing/broadcast receipt) (offline SOP/evidence handling) | P1 | Offline | Treasury Ops | WF-07 | PayIn→Deposit (Business) + Provider Connectors v1 | Must | 1 |  | Keep |  | 1 |
| MTASK-357 | MTASK-067 | MCTRL-067 | Bank statement import (CSV v1) for payin/payout matching | P1 | Online | Treasury Ops | WF-07 | PayIn→Deposit (Business) + Provider Connectors v1 | Must | 1 |  | Keep |  | 1 |
| MTASK-358 | MTASK-067 | MCTRL-067 | Custody connector v1 (manual signing/broadcast receipt) | P1 | Online | Treasury Ops | WF-07 | PayIn→Deposit (Business) + Provider Connectors v1 | Must | 1 |  | Keep |  | 1 |
| MTASK-359 | MTASK-067 | MCTRL-067 | TRON address validation service (TronWeb) shared module | P1 | Online | Tech | WF-07 | PayIn→Deposit (Business) + Provider Connectors v1 | Must | 1 |  | Keep |  | 1 |
| MTASK-360 | MTASK-067 | MCTRL-067 | Compliance provider connector v1 (from MANUAL to API-ready) | P1 | Online | MLRO | WF-07 | PayIn→Deposit (Business) + Provider Connectors v1 | Must | 1 |  | Keep |  | 1 |
| MTASK-219 | MTASK-035 | MCTRL-035 | Implement quote capture (source, bid/ask, mid, fee) with TTL=30s and slippage_band=1% | P0 | Online | Tech/Product | WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | 1 |  | Keep |  | 1 |
| MTASK-220 | MTASK-035 | MCTRL-035 | Implement tiered spread configuration and enforce payment_for_order_flow=false | P0 | Online | Product/Compliance/Tech | WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | 1 |  | Keep |  | 1 |
| MTASK-221 | MTASK-035 | MCTRL-035 | Generate quarterly execution quality review report (slippage/latency/fill_rate) | P0 | Online | Ops/Product | WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | 1 |  | Keep |  | 1 |
| MTASK-222 | MTASK-035 | MCTRL-035 | QA validate TTL/slippage defaults and report generation | P0 | Online | QA | WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | 1 |  | Keep |  | 1 |
| MTASK-223 | MTASK-035 | MCTRL-035 | Add market rate cache + fallback policy | P0 | Online | Tech | WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | 1 |  | Keep |  | 1 |
| MTASK-224 | MTASK-035 | MCTRL-035 | Implement customer swap rate config (spread) audit & export | P0 | Online | Product | WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | 1 |  | Keep |  | 1 |
| MTASK-225 | MTASK-035 | MCTRL-035 | Implement firm quote snapshot: source/spread/fee/decimals | P0 | Online | Tech | WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | 1 |  | Keep |  | 1 |
| MTASK-226 | MTASK-035 | MCTRL-035 | QA quote single-use + decimals contract | P0 | Online | QA | WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | 1 |  | Keep |  | 1 |
| MTASK-230 | MTASK-036 | MCTRL-036 | Tag principal trades and validate funding source is not Client Money/VA | P0 | Online | Tech/Finance | WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | 1 |  | Keep |  | 1 |
| MTASK-231 | MTASK-036 | MCTRL-036 | Auto-create case on violation and block execution | P0 | Online | Tech/Compliance | WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | 1 |  | Keep |  | 1 |
| MTASK-232 | MTASK-036 | MCTRL-036 | QA validate principal misuse block and case creation | P0 | Online | QA | WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | 1 |  | Keep |  | 1 |
| MTASK-253 | MTASK-041 | MCTRL-041 | Hardcode margin_trading_enabled=false and hide/disable admin controls | P0 | Online | Product/Tech | WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | 1 |  | Keep |  | 1 |
| MTASK-254 | MTASK-041 | MCTRL-041 | Block any enable attempt and require VARA authorization dossier to proceed | P0 | Online | Tech/Compliance | WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | 1 |  | Keep |  | 1 |
| MTASK-255 | MTASK-041 | MCTRL-041 | QA validate flag immutability and blocked attempts | P0 | Online | QA | WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | 1 |  | Keep |  | 1 |
| MTASK-327 | MTASK-060 | MCTRL-060 | Enforce quote-driven swap path (no direct rate swap) | P0 | Online | Tech | WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | 1 |  | Keep |  | 1 |
| MTASK-328 | MTASK-060 | MCTRL-060 | Implement dual outstandings creation & linkage | P0 | Online | Finance | WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | 1 |  | Keep |  | 1 |
| MTASK-329 | MTASK-060 | MCTRL-060 | Ensure API returns asset relation (decimals) for swap/outstanding | P0 | Online | Tech | WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | 1 |  | Keep |  | 1 |
| MTASK-330 | MTASK-060 | MCTRL-060 | QA precision gate (check:asset:decimals) + swap regressions | P0 | Online | QA | WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | 1 |  | Keep |  | 1 |
| MTASK-227 | MTASK-368 | MCTRL-070 | Implement LP quote fan-out interface (n providers) | P2 | Online | Tech | WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | 1 |  | Keep |  | 1 |
| MTASK-228 | MTASK-368 | MCTRL-070 | Store routing decision record (inputs, chosen, reasons) | P2 | Online | Compliance | WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | 1 |  | Keep |  | 1 |
| MTASK-229 | MTASK-368 | MCTRL-070 | Export best execution metrics (quarterly) | P2 | Online | Compliance | WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | 1 |  | Keep |  | 1 |
| MTASK-250 | MTASK-040 | MCTRL-040 | Implement withdraw_pause trigger gates (only security_incident or chain_congestion) | P0 | Online | Tech/Ops | WF-09 | Withdraw→Payout + Volatility Policy | Must | 1 |  | Keep |  | 1 |
| MTASK-251 | MTASK-040 | MCTRL-040 | Implement RI/SM approval, default duration<=24h, extensions and RCA record | P0 | Online | Tech/Compliance | WF-09 | Withdraw→Payout + Volatility Policy | Must | 1 |  | Keep |  | 1 |
| MTASK-252 | MTASK-040 | MCTRL-040 | QA validate pause/resume flows and approvals | P0 | Online | QA | WF-09 | Withdraw→Payout + Volatility Policy | Must | 1 |  | Keep |  | 1 |
| MTASK-331 | MTASK-061 | MCTRL-061 | Add withdraw create validations (wallet, address/iban, balance) | P0 | Online | Tech | WF-09 | Withdraw→Payout + Volatility Policy | Must | 1 |  | Keep |  | 1 |
| MTASK-332 | MTASK-061 | MCTRL-061 | Enforce orchestration idempotency markers | P0 | Online | Tech | WF-09 | Withdraw→Payout + Volatility Policy | Must | 1 |  | Keep |  | 1 |
| MTASK-333 | MTASK-061 | MCTRL-061 | Implement bulk reversal by source for FAILED/RETURNED | P0 | Online | Finance | WF-09 | Withdraw→Payout + Volatility Policy | Must | 1 |  | Keep |  | 1 |
| MTASK-334 | MTASK-061 | MCTRL-061 | QA withdraw success/fail/return E2E | P0 | Online | QA | WF-09 | Withdraw→Payout + Volatility Policy | Must | 1 |  | Keep |  | 1 |
| MTASK-178 | MTASK-026 | MCTRL-026 | Implement CDD completion status and pre-activity gate | P0 | Online | Tech | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-179 | MTASK-026 | MCTRL-026 | Implement AED 3,500 threshold check (single + rolling 24h aggregation) | P0 | Online | Tech | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-180 | MTASK-026 | MCTRL-026 | Implement trigger/block export reports by trigger and period | P0 | Online | Tech | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-181 | MTASK-026 | MCTRL-026 | QA validate gate behavior across channels | P0 | Online | QA | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-182 | MTASK-026 | MCTRL-026 | Define gate points for deposit/swap/withdraw | P0 | Online | Product | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-183 | MTASK-026 | MCTRL-026 | Implement block log schema & export | P0 | Online | Compliance Ops | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-184 | MTASK-026 | MCTRL-026 | Hook gate into swap/withdraw entry APIs | P0 | Online | Tech | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-185 | MTASK-026 | MCTRL-026 | QA: gate side-effect free | P0 | Online | QA | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-186 | MTASK-027 | MCTRL-027 | Prepare KYB dossier checklist and agent authorization template | P0 | Offline | Ops/MLRO/Compliance | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-187 | MTASK-027 | MCTRL-027 | Implement KYB dossier storage and UBO structure graph in system | P0 | Online | Tech | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-188 | MTASK-027 | MCTRL-027 | Enable additional due diligence tasks for high-risk B2B | P0 | Online | Ops/Compliance | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-189 | MTASK-027 | MCTRL-027 | QA validate KYB/agent binding and exports | P0 | Online | QA | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-190 | MTASK-028 | MCTRL-028 | Implement EDD trigger (PEP/high-risk) with SoF/SoW upload requirements | P0 | Online | Tech/MLRO | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-191 | MTASK-028 | MCTRL-028 | Enforce Senior Management approval gate before trading | P0 | Online | Tech/SM | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-192 | MTASK-028 | MCTRL-028 | QA validate EDD flow and restrictions | P0 | Online | QA | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-307 | MTASK-055 | MCTRL-055 | Implement customer CRUD with No strategy | P0 | Online | Tech | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-308 | MTASK-055 | MCTRL-055 | Implement corporate prerequisites (profile + ≥1 UBO) | P0 | Online | Compliance | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-309 | MTASK-055 | MCTRL-055 | Add export: customer list + KYB graph summary | P0 | Online | Ops | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-310 | MTASK-055 | MCTRL-055 | QA: customer/corporate/UBO regression | P0 | Online | QA | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-315 | MTASK-057 | MCTRL-057 | Enforce single-source getNextStep contract | P0 | Online | Tech | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-316 | MTASK-057 | MCTRL-057 | Implement CDD bootstrap/submit/review transitions | P0 | Online | Compliance | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-317 | MTASK-057 | MCTRL-057 | Implement EDD start/submit/MLRO review + upgrade from CDD | P0 | Online | MLRO | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-318 | MTASK-057 | MCTRL-057 | QA reinitiate + role boundary + snapshot recompute | P0 | Online | QA | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-233 | MTASK-037 | MCTRL-037 | Configure investor category as Retail-only (immutable) | P1 | Online | Compliance/Product | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-234 | MTASK-037 | MCTRL-037 | Block creation of Qualified/Institutional entitlements and log attempts | P1 | Online | Compliance/Product | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-235 | MTASK-037 | MCTRL-037 | Add Retail-only statement into disclosures/agreements render | P1 | Online | Compliance/Product | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-236 | MTASK-037 | MCTRL-037 | Implement export: blocked investor category attempts by period | P1 | Online | Compliance/Product | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-237 | MTASK-037 | MCTRL-037 | QA validate Retail-only enforcement and statements across channels | P1 | Online | QA | WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | 1 |  | Keep |  | 1 |
| MTASK-120 | MTASK-013 | MCTRL-013 | Implement key/signatory change logging and staff offboarding trigger | P0 | Online | Tech/CISO | WF-11 | Wallet Binding + VA Standards + Key Safeguarding | Must | 1 |  | Keep |  | 1 |
| MTASK-121 | MTASK-013 | MCTRL-013 | Generate quarterly key access audit export | P0 | Online | Ops/CISO | WF-11 | Wallet Binding + VA Standards + Key Safeguarding | Must | 1 |  | Keep |  | 1 |
| MTASK-122 | MTASK-013 | MCTRL-013 | QA validate key change logging and quarterly report | P0 | Online | QA | WF-11 | Wallet Binding + VA Standards + Key Safeguarding | Must | 1 |  | Keep |  | 1 |
| MTASK-319 | MTASK-058 | MCTRL-058 | Replace mock address generation with TRON validation/generation | P0 | Online | Tech | WF-11 | Wallet Binding + VA Standards + Key Safeguarding | Must | 1 |  | Keep |  | 1 |
| MTASK-320 | MTASK-058 | MCTRL-058 | Enforce FIAT bank wallet required fields | P0 | Online | Tech | WF-11 | Wallet Binding + VA Standards + Key Safeguarding | Must | 1 |  | Keep |  | 1 |
| MTASK-321 | MTASK-058 | MCTRL-058 | Implement wallet freeze/disable enforcement hooks in all flows | P0 | Online | Treasury Ops | WF-11 | Wallet Binding + VA Standards + Key Safeguarding | Must | 1 |  | Keep |  | 1 |
| MTASK-322 | MTASK-058 | MCTRL-058 | QA wallet validation + freeze regression | P0 | Online | QA | WF-11 | Wallet Binding + VA Standards + Key Safeguarding | Must | 1 |  | Keep |  | 1 |
| MTASK-244 | MTASK-039 | MCTRL-039 | Register offline supporting evidence (legal opinion / issuer docs) | P1 | Offline | Product/Risk/Compliance | WF-11 | Wallet Binding + VA Standards + Key Safeguarding | Must | 1 |  | Keep |  | 1 |
| MTASK-245 | MTASK-039 | MCTRL-039 | Maintain VA standard card per assetcode (USDT_TRON) | P1 | Online | Product/Risk/Compliance | WF-11 | Wallet Binding + VA Standards + Key Safeguarding | Must | 1 |  | Keep |  | 1 |
| MTASK-246 | MTASK-039 | MCTRL-039 | Create annual review task (365 days) and review log for USDT standards | P1 | Online | Product/Risk/Compliance | WF-11 | Wallet Binding + VA Standards + Key Safeguarding | Must | 1 |  | Keep |  | 1 |
| MTASK-247 | MTASK-039 | MCTRL-039 | Implement restriction/suspend workflow if standards not met | P1 | Online | Product/Risk/Compliance | WF-11 | Wallet Binding + VA Standards + Key Safeguarding | Must | 1 |  | Keep |  | 1 |
| MTASK-248 | MTASK-039 | MCTRL-039 | Implement export: VA standards, annual review outcomes, and restrictions by period | P1 | Online | Product/Risk/Compliance | WF-11 | Wallet Binding + VA Standards + Key Safeguarding | Must | 1 |  | Keep |  | 1 |
| MTASK-249 | MTASK-039 | MCTRL-039 | QA validate standard card versioning, annual scheduling, and restriction flow | P1 | Online | QA | WF-11 | Wallet Binding + VA Standards + Key Safeguarding | Must | 1 |  | Keep |  | 1 |
| MTASK-193 | MTASK-029 | MCTRL-029 | Implement KYT ruleset versioning with SM approval and effective_at | P0 | Online | Tech/MLRO/SM | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-194 | MTASK-029 | MCTRL-029 | Generate quarterly review tasks and archive outcomes | P0 | Online | Ops/Compliance | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-195 | MTASK-029 | MCTRL-029 | QA validate ruleset publish gate and quarterly task | P0 | Online | QA | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-196 | MTASK-062 | MCTRL-062 | Implement suspicious alert → STR case workflow and MLRO assignment | P0 | Online | Tech/MLRO | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-197 | MTASK-062 | MCTRL-062 | Capture GoAML receipt and implement 48h timer for FIU/VARA info requests | P0 | Online | Tech/MLRO | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-198 | MTASK-062 | MCTRL-062 | Add enhanced monitoring list for STR subjects | P0 | Online | Compliance/MLRO | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-199 | MTASK-062 | MCTRL-062 | QA validate STR workflow, timers, and enhanced monitoring | P0 | Online | QA | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-206 | MTASK-062 | MCTRL-062 | Implement Travel Rule packet requirement for >=AED 3,500 transfers (single/24h) | P0 | Online | Tech/MLRO | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-207 | MTASK-062 | MCTRL-062 | Implement unhosted wallet whitelist with signature proof and 24h cooldown | P0 | Online | Tech/Ops | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-208 | MTASK-062 | MCTRL-062 | QA validate Travel Rule hold and whitelist cooldown | P0 | Online | QA | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-256 | MTASK-062 | MCTRL-062 | Integrate sanctions list provider updates and log success/failure | P0 | Online | Tech/MLRO | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-257 | MTASK-062 | MCTRL-062 | Implement screening for client/UBO/wallet/tx and freeze/block actions on hit | P0 | Online | Tech/Compliance | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-258 | MTASK-062 | MCTRL-062 | Implement unfreeze workflow with approvals and audit trail | P0 | Online | Tech/Compliance | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-259 | MTASK-062 | MCTRL-062 | QA validate list update, hit handling, and freeze/unfreeze flow | P0 | Online | QA | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-335 | MTASK-062 | MCTRL-062 | Enforce provider mode rules (no long-term MOCK in prod) | P0 | Online | Tech | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-336 | MTASK-062 | MCTRL-062 | Implement callback upsert endpoints & idempotency keys | P0 | Online | Tech | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-337 | MTASK-062 | MCTRL-062 | Build aggregated read model /admin/compliance/tx-cases/:sourceType/:sourceId | P0 | Online | Compliance Ops | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-338 | MTASK-062 | MCTRL-062 | QA auto-case timing and withdraw gate (crypto only) | P0 | Online | QA | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-200 | MTASK-031 | MCTRL-031 | Register offline vendor assessment evidence (weakness analysis / comp controls) | P1 | Offline | MLRO/Risk/Tech | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-201 | MTASK-031 | MCTRL-031 | Implement DLT tool registry and scorecard model | P1 | Online | MLRO/Risk/Tech | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-202 | MTASK-031 | MCTRL-031 | Enforce approval rule (total≥18 and critical items≥3) and block use if not approved | P1 | Online | MLRO/Risk/Tech | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-203 | MTASK-031 | MCTRL-031 | Schedule quarterly re-review and record weaknesses and compensating controls | P1 | Online | MLRO/Risk/Tech | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-204 | MTASK-031 | MCTRL-031 | Implement export: tool scorecards and quarterly reviews by tool/period | P1 | Online | MLRO/Risk/Tech | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-205 | MTASK-031 | MCTRL-031 | QA validate scoring, approval gate, quarterly scheduling, and exports | P1 | Online | QA | WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | 1 |  | Keep |  | 1 |
| MTASK-272 | MTASK-046 | MCTRL-046 | Implement incident case model with material criteria flags | P0 | Online | Tech/CISO | WF-14 | Alerts→Incidents + Incident Mgmt | Must | 1 |  | Keep |  | 1 |
| MTASK-273 | MTASK-046 | MCTRL-046 | Implement 72h VARA report timer and 24h data incident timer with notice pack generation | P0 | Online | Tech/Compliance | WF-14 | Alerts→Incidents + Incident Mgmt | Must | 1 |  | Keep |  | 1 |
| MTASK-274 | MTASK-046 | MCTRL-046 | Configure incident response SOP hooks and escalation matrix | P0 | Online | Ops/CISO | WF-14 | Alerts→Incidents + Incident Mgmt | Must | 1 |  | Keep |  | 1 |
| MTASK-275 | MTASK-046 | MCTRL-046 | QA validate material criteria, timers, and notice packs | P0 | Online | QA | WF-14 | Alerts→Incidents + Incident Mgmt | Must | 1 |  | Keep |  | 1 |
| MTASK-295 | MTASK-052 | MCTRL-052 | Implement outsourcing incident case with material_flag and vendor linkage | P0 | Online | Tech/Compliance | WF-14 | Alerts→Incidents + Incident Mgmt | Must | 1 |  | Keep |  | 1 |
| MTASK-296 | MTASK-052 | MCTRL-052 | Implement 4h timer for VARA notice pack and receipt capture | P0 | Online | Tech/Ops | WF-14 | Alerts→Incidents + Incident Mgmt | Must | 1 |  | Keep |  | 1 |
| MTASK-297 | MTASK-052 | MCTRL-052 | Configure remediation tracker and change freeze rules | P0 | Online | Compliance/Ops | WF-14 | Alerts→Incidents + Incident Mgmt | Must | 1 |  | Keep |  | 1 |
| MTASK-298 | MTASK-052 | MCTRL-052 | QA validate 4h notice SLA and change freeze | P0 | Online | QA | WF-14 | Alerts→Incidents + Incident Mgmt | Must | 1 |  | Keep |  | 1 |
| MTASK-339 | MTASK-063 | MCTRL-063 | Define SLA map by severity and enforce dueAt | P0 | Online | Compliance Ops | WF-14 | Alerts→Incidents + Incident Mgmt | Must | 1 |  | Keep |  | 1 |
| MTASK-340 | MTASK-063 | MCTRL-063 | Add incident create-from-alert and multi-link support | P0 | Online | Compliance Ops | WF-14 | Alerts→Incidents + Incident Mgmt | Must | 1 |  | Keep |  | 1 |
| MTASK-341 | MTASK-063 | MCTRL-063 | Implement exports for alerts/incidents | P0 | Online | Compliance Ops | WF-14 | Alerts→Incidents + Incident Mgmt | Must | 1 |  | Keep |  | 1 |
| MTASK-342 | MTASK-063 | MCTRL-063 | QA alerts/incidents SLA + export | P0 | Online | QA | WF-14 | Alerts→Incidents + Incident Mgmt | Must | 1 |  | Keep |  | 1 |
| MTASK-299 | MTASK-053 | MCTRL-053 | Implement “base config sync” command & idempotency | P0 | Online | Tech Lead | WF-15 | Posting Engine + Base Config Center (Assets/COA/Events/Templates) | Must | 1 |  | Keep |  | 1 |
| MTASK-300 | MTASK-053 | MCTRL-053 | Add template existence gate for critical EVT_* states | P0 | Online | Finance+Tech | WF-15 | Posting Engine + Base Config Center (Assets/COA/Events/Templates) | Must | 1 |  | Keep |  | 1 |
| MTASK-301 | MTASK-053 | MCTRL-053 | Provide exports for Assets/COA/AcctEvents/Templates | P0 | Online | Finance Ops | WF-15 | Posting Engine + Base Config Center (Assets/COA/Events/Templates) | Must | 1 |  | Keep |  | 1 |
| MTASK-302 | MTASK-053 | MCTRL-053 | QA base config reset invariants (dev:reset) | P0 | Online | QA | WF-15 | Posting Engine + Base Config Center (Assets/COA/Events/Templates) | Must | 1 |  | Keep |  | 1 |
| MTASK-343 | MTASK-064 | MCTRL-064 | Ensure AcctEvents + JournalTemplates coverage for critical states | P0 | Online | Finance | WF-15 | Posting Engine + Base Config Center (Assets/COA/Events/Templates) | Must | 1 |  | Keep |  | 1 |
| MTASK-344 | MTASK-064 | MCTRL-064 | Implement posting integrity checks (balanced, required accounts) | P0 | Online | Finance | WF-15 | Posting Engine + Base Config Center (Assets/COA/Events/Templates) | Must | 1 |  | Keep |  | 1 |
| MTASK-345 | MTASK-064 | MCTRL-064 | Implement clearing trigger hooks in withdraw approve/success | P0 | Online | Treasury | WF-15 | Posting Engine + Base Config Center (Assets/COA/Events/Templates) | Must | 1 |  | Keep |  | 1 |
| MTASK-346 | MTASK-064 | MCTRL-064 | QA posting + reversal + clearing regression | P0 | Online | QA | WF-15 | Posting Engine + Base Config Center (Assets/COA/Events/Templates) | Must | 1 |  | Keep |  | 1 |
| MTASK-107 | MTASK-010 | MCTRL-010 | Implement client account register and segregation tagging | P0 | Online | Tech/Finance | WF-16 | Safeguarding Reconciliation (Client Money/VA) + Funding SLA | Must | 1 |  | Keep |  | 1 |
| MTASK-108 | MTASK-010 | MCTRL-010 | Track funding SLA (confirmed_at→posted_at <=24h) and alert on breaches | P0 | Online | Tech/Ops | WF-16 | Safeguarding Reconciliation (Client Money/VA) + Funding SLA | Must | 1 |  | Keep |  | 1 |
| MTASK-109 | MTASK-010 | MCTRL-010 | Enforce dual-approval for payouts and freeze negative/offset balances with case | P0 | Online | Tech/Compliance | WF-16 | Safeguarding Reconciliation (Client Money/VA) + Funding SLA | Must | 1 |  | Keep |  | 1 |
| MTASK-110 | MTASK-010 | MCTRL-010 | QA validate segregation, SLA alerts, and payout approvals | P0 | Online | QA | WF-16 | Safeguarding Reconciliation (Client Money/VA) + Funding SLA | Must | 1 |  | Keep |  | 1 |
| MTASK-111 | MTASK-011 | MCTRL-011 | Implement daily client money reconciliation job and report | P0 | Online | Tech/Finance | WF-16 | Safeguarding Reconciliation (Client Money/VA) + Funding SLA | Must | 1 |  | Keep |  | 1 |
| MTASK-112 | MTASK-011 | MCTRL-011 | Implement threshold logic to create Alert/Material cases with SLA timers and VARA notice task | P0 | Online | Tech/Compliance | WF-16 | Safeguarding Reconciliation (Client Money/VA) + Funding SLA | Must | 1 |  | Keep |  | 1 |
| MTASK-113 | MTASK-011 | MCTRL-011 | QA validate thresholds, timers, and notice task creation | P0 | Online | QA | WF-16 | Safeguarding Reconciliation (Client Money/VA) + Funding SLA | Must | 1 |  | Keep |  | 1 |
| MTASK-123 | MTASK-014 | MCTRL-014 | Implement daily client VA reconciliation job with AED equivalent using cutoff_rate | P0 | Online | Tech/Finance | WF-16 | Safeguarding Reconciliation (Client Money/VA) + Funding SLA | Must | 1 |  | Keep |  | 1 |
| MTASK-124 | MTASK-014 | MCTRL-014 | Generate quarterly PoR snapshot pack at Dubai 23:59:59 cutoffs | P0 | Online | Tech/Finance | WF-16 | Safeguarding Reconciliation (Client Money/VA) + Funding SLA | Must | 1 |  | Keep |  | 1 |
| MTASK-125 | MTASK-014 | MCTRL-014 | Capture RI + Finance Head e-sign sign-off for PoR pack | P0 | Online | Ops/RI/Finance | WF-16 | Safeguarding Reconciliation (Client Money/VA) + Funding SLA | Must | 1 |  | Keep |  | 1 |
| MTASK-126 | MTASK-014 | MCTRL-014 | QA validate PoR generation, timestamps, and sign-off lock | P0 | Online | QA | WF-16 | Safeguarding Reconciliation (Client Money/VA) + Funding SLA | Must | 1 |  | Keep |  | 1 |
| MTASK-361 | MTASK-011 | MCTRL-011 | Daily wallet/ledger reconciliation batch & break case | P1 | Online | Finance | WF-16 | Safeguarding Reconciliation (Client Money/VA) + Funding SLA | Must | 1 |  | Keep |  | 1 |
| MTASK-364 | MTASK-011 | MCTRL-011 | QA recon + statements E2E | P1 | Online | QA | WF-16 | Safeguarding Reconciliation (Client Money/VA) + Funding SLA | Must | 1 |  | Keep |  | 1 |
| MTASK-174 | MTASK-025 | MCTRL-025 | Implement client risk rating storage (risk_rating, model_version) | P0 | Online | Tech/MLRO | WF-17 | Periodic Risk Review (90d/1y) | Must | 1 |  | Keep |  | 1 |
| MTASK-175 | MTASK-025 | MCTRL-025 | Implement refresh scheduler and enforcement (90/180 days) | P0 | Online | Tech | WF-17 | Periodic Risk Review (90d/1y) | Must | 1 |  | Keep |  | 1 |
| MTASK-176 | MTASK-025 | MCTRL-025 | Configure refresh intervals and restriction actions | P0 | Online | Compliance/Ops | WF-17 | Periodic Risk Review (90d/1y) | Must | 1 |  | Keep |  | 1 |
| MTASK-177 | MTASK-025 | MCTRL-025 | QA validate refresh overdue restriction and exports | P0 | Online | QA | WF-17 | Periodic Risk Review (90d/1y) | Must | 1 |  | Keep |  | 1 |
| MTASK-114 | MTASK-012 | MCTRL-012 | Document SOP for delivery channel management and register reference | P1 | Offline | Finance/Ops | WF-18 | Monthly Statements (T+25) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-115 | MTASK-012 | MCTRL-012 | Generate monthly client money statement artifact (statement_id/date/balance/entries/interest) | P1 | Online | Finance/Ops | WF-18 | Monthly Statements (T+25) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-116 | MTASK-012 | MCTRL-012 | Record delivery and download logs for monthly statements | P1 | Online | Finance/Ops | WF-18 | Monthly Statements (T+25) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-117 | MTASK-012 | MCTRL-012 | Implement T+25 overdue alerting and escalation task | P1 | Online | Finance/Ops | WF-18 | Monthly Statements (T+25) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-118 | MTASK-012 | MCTRL-012 | Implement export: monthly statements by client and month | P1 | Online | Finance/Ops | WF-18 | Monthly Statements (T+25) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-119 | MTASK-012 | MCTRL-012 | QA validate statement generation, delivery/download logs, and T+25 alerts | P1 | Online | QA | WF-18 | Monthly Statements (T+25) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-362 | MTASK-012 | MCTRL-012 | Monthly statements generator (T+25 config) | P1 | Online | Finance | WF-18 | Monthly Statements (T+25) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-363 | MTASK-012 | MCTRL-012 | Statement delivery & download logs (in-app + email notify) | P1 | Online | Ops | WF-18 | Monthly Statements (T+25) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-351 | MTASK-066 | MCTRL-066 | Create fee config model (percent/fixed/tier) for swap & withdraw | P1 | Online | Finance | WF-19 | Splitting Items + Fee Engine | Must | 1 |  | Keep |  | 1 |
| MTASK-352 | MTASK-066 | MCTRL-066 | Compute withdraw feeAmount/netAmount using fee config | P1 | Online | Tech | WF-19 | Splitting Items + Fee Engine | Must | 1 |  | Keep |  | 1 |
| MTASK-353 | MTASK-066 | MCTRL-066 | Implement split items & link to journal posting | P1 | Online | Finance | WF-19 | Splitting Items + Fee Engine | Must | 1 |  | Keep |  | 1 |
| MTASK-354 | MTASK-066 | MCTRL-066 | QA fee/split correctness across three flows | P1 | Online | QA | WF-19 | Splitting Items + Fee Engine | Must | 1 |  | Keep |  | 1 |
| MTASK-347 | MTASK-065 | MCTRL-065 | Implement dryRun/onlyMissing reconcile endpoints | P0 | Online | Tech | WF-21 | Internal Treasury (Internal Tx/Fund/Collection) | Must | 1 |  | Keep |  | 1 |
| MTASK-348 | MTASK-065 | MCTRL-065 | Add idempotency keys for internal collection actions | P0 | Online | Tech | WF-21 | Internal Treasury (Internal Tx/Fund/Collection) | Must | 1 |  | Keep |  | 1 |
| MTASK-349 | MTASK-065 | MCTRL-065 | Implement retry/backoff for insufficient system wallet balance | P0 | Online | Treasury Ops | WF-21 | Internal Treasury (Internal Tx/Fund/Collection) | Must | 1 |  | Keep |  | 1 |
| MTASK-350 | MTASK-065 | MCTRL-065 | QA internal collection idempotency | P0 | Online | QA | WF-21 | Internal Treasury (Internal Tx/Fund/Collection) | Must | 1 |  | Keep |  | 1 |
| MTASK-238 | MTASK-038 | MCTRL-038 | Document SOP for treasury approvals and post-trade review | P1 | Offline | Finance/Compliance | WF-21 | Internal Treasury (Internal Tx/Fund/Collection) | Must | 1 |  | Keep |  | 1 |
| MTASK-239 | MTASK-038 | MCTRL-038 | Require purpose_code on treasury trades and validate against permitted list | P1 | Online | Finance/Compliance | WF-21 | Internal Treasury (Internal Tx/Fund/Collection) | Must | 1 |  | Keep |  | 1 |
| MTASK-240 | MTASK-038 | MCTRL-038 | Block any purpose=ProfitTrading and log blocked attempts | P1 | Online | Finance/Compliance | WF-21 | Internal Treasury (Internal Tx/Fund/Collection) | Must | 1 |  | Keep |  | 1 |
| MTASK-241 | MTASK-038 | MCTRL-038 | Implement dual-approval workflow for treasury trades (two-person) | P1 | Online | Finance/Compliance | WF-21 | Internal Treasury (Internal Tx/Fund/Collection) | Must | 1 |  | Keep |  | 1 |
| MTASK-242 | MTASK-038 | MCTRL-038 | Implement export: treasury trades by purpose and period | P1 | Online | Finance/Compliance | WF-21 | Internal Treasury (Internal Tx/Fund/Collection) | Must | 1 |  | Keep |  | 1 |
| MTASK-243 | MTASK-038 | MCTRL-038 | QA validate permitted purpose enforcement, dual approval, and exports | P1 | Online | QA | WF-21 | Internal Treasury (Internal Tx/Fund/Collection) | Must | 1 |  | Keep |  | 1 |
| MTASK-284 | MTASK-049 | MCTRL-049 | Draft outsourcing policy and due diligence checklist | P0 | Offline | Ops/Compliance/Legal | WF-22 | Outsourcing Governance (Register/Clauses/Cross-border) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-285 | MTASK-049 | MCTRL-049 | Build Outsourcing Register with Draft→Active DD gate | P0 | Online | Tech | WF-22 | Outsourcing Governance (Register/Clauses/Cross-border) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-286 | MTASK-049 | MCTRL-049 | Implement annual vendor review task scheduler and archive | P0 | Online | Ops/Compliance | WF-22 | Outsourcing Governance (Register/Clauses/Cross-border) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-287 | MTASK-049 | MCTRL-049 | QA validate register activation gate and exports | P0 | Online | QA | WF-22 | Outsourcing Governance (Register/Clauses/Cross-border) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-288 | MTASK-050 | MCTRL-050 | Create mandatory contract clause checklist template | P0 | Offline | Legal/Compliance/RI | WF-22 | Outsourcing Governance (Register/Clauses/Cross-border) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-289 | MTASK-050 | MCTRL-050 | Implement contract clause gate in system (block Approved if missing) | P0 | Online | Tech | WF-22 | Outsourcing Governance (Register/Clauses/Cross-border) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-290 | MTASK-050 | MCTRL-050 | Store signed agreement version metadata and clause diff record | P0 | Online | Tech/Legal | WF-22 | Outsourcing Governance (Register/Clauses/Cross-border) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-291 | MTASK-050 | MCTRL-050 | QA validate missing clause blocks and diff generation | P0 | Online | QA | WF-22 | Outsourcing Governance (Register/Clauses/Cross-border) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-292 | MTASK-051 | MCTRL-051 | Define cross-border assessment form and VARA notification SOP | P0 | Offline | Compliance/Ops/RI | WF-22 | Outsourcing Governance (Register/Clauses/Cross-border) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-293 | MTASK-051 | MCTRL-051 | Add cross_border_flag & enhanced DD fields; block activation without VARA receipt | P0 | Online | Tech | WF-22 | Outsourcing Governance (Register/Clauses/Cross-border) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-294 | MTASK-051 | MCTRL-051 | QA validate cross-border activation gate | P0 | Online | QA | WF-22 | Outsourcing Governance (Register/Clauses/Cross-border) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-130 | MTASK-016 | MCTRL-016 | Implement complaints intake across channels with complaint_id and fee=0 enforcement | P0 | Online | Tech/Ops | WF-23 | Complaints + Disputes/Refunds + RCA/CAPA | Must | 1 |  | Keep |  | 1 |
| MTASK-131 | MTASK-016 | MCTRL-016 | Implement SLA timers: ack<=7d; resolve<=4w (or 8w w/ extraordinary reason) | P0 | Online | Tech/Compliance | WF-23 | Complaints + Disputes/Refunds + RCA/CAPA | Must | 1 |  | Keep |  | 1 |
| MTASK-132 | MTASK-016 | MCTRL-016 | Configure complaint template and assignment rules (non-involved staff) | P0 | Online | Ops/Compliance | WF-23 | Complaints + Disputes/Refunds + RCA/CAPA | Must | 1 |  | Keep |  | 1 |
| MTASK-133 | MTASK-016 | MCTRL-016 | QA validate intake, SLA, and closure paths | P0 | Online | QA | WF-23 | Complaints + Disputes/Refunds + RCA/CAPA | Must | 1 |  | Keep |  | 1 |
| MTASK-134 | MTASK-017 | MCTRL-017 | Document monthly complaints review SOP and register reference | P1 | Offline | Ops/Compliance/Product | WF-23 | Complaints + Disputes/Refunds + RCA/CAPA | Must | 1 |  | Keep |  | 1 |
| MTASK-135 | MTASK-017 | MCTRL-017 | Add root cause tagging to complaints and enforce controlled taxonomy | P1 | Online | Ops/Compliance/Product | WF-23 | Complaints + Disputes/Refunds + RCA/CAPA | Must | 1 |  | Keep |  | 1 |
| MTASK-136 | MTASK-017 | MCTRL-017 | Generate RCA clustering report monthly (cluster_id/count/period) | P1 | Online | Ops/Compliance/Product | WF-23 | Complaints + Disputes/Refunds + RCA/CAPA | Must | 1 |  | Keep |  | 1 |
| MTASK-137 | MTASK-017 | MCTRL-017 | Trigger CAPA when same root_cause ≥5 within rolling 30 days | P1 | Online | Ops/Compliance/Product | WF-23 | Complaints + Disputes/Refunds + RCA/CAPA | Must | 1 |  | Keep |  | 1 |
| MTASK-138 | MTASK-017 | MCTRL-017 | Implement CAPA tracker workflow (actions/owner/due/status/closed_at) | P1 | Online | Ops/Compliance/Product | WF-23 | Complaints + Disputes/Refunds + RCA/CAPA | Must | 1 |  | Keep |  | 1 |
| MTASK-139 | MTASK-017 | MCTRL-017 | Implement exports: RCA clusters and CAPA register by root cause/period | P1 | Online | Ops/Compliance/Product | WF-23 | Complaints + Disputes/Refunds + RCA/CAPA | Must | 1 |  | Keep |  | 1 |
| MTASK-140 | MTASK-017 | MCTRL-017 | QA validate RCA tagging, rolling 30d threshold, CAPA creation, and exports | P1 | Online | QA | WF-23 | Complaints + Disputes/Refunds + RCA/CAPA | Must | 1 |  | Keep |  | 1 |
| MTASK-365 | MTASK-069 | MCTRL-069 | Define refund/reversal policy matrix (fiat/crypto) | P2 | Offline | Ops+Finance | WF-23 | Complaints + Disputes/Refunds + RCA/CAPA | Must | 1 |  | Keep |  | 1 |
| MTASK-366 | MTASK-069 | MCTRL-069 | Build support ticket entity & linkage to tx/alerts | P2 | Online | Ops | WF-23 | Complaints + Disputes/Refunds + RCA/CAPA | Must | 1 |  | Keep |  | 1 |
| MTASK-367 | MTASK-069 | MCTRL-069 | QA disputes + reversal linkage | P2 | Online | QA | WF-23 | Complaints + Disputes/Refunds + RCA/CAPA | Must | 1 |  | Keep |  | 1 |
| MTASK-090 | MTASK-006 | MCTRL-006 | Define VARA report catalogue and reporting field dictionary | P0 | Online | Compliance/Finance/RI | WF-24 | Regulatory Reporting Calendar + Production Packs + Agreements | Deferred | 1 |  | Keep |  | 1 |
| MTASK-091 | MTASK-006 | MCTRL-006 | Implement reporting scheduler tasks and submission checklist + receipt archive | P0 | Online | Tech | WF-24 | Regulatory Reporting Calendar + Production Packs + Agreements | Deferred | 1 |  | Keep |  | 1 |
| MTASK-092 | MTASK-006 | MCTRL-006 | Configure overdue escalation to RI | P0 | Online | Ops/Compliance | WF-24 | Regulatory Reporting Calendar + Production Packs + Agreements | Deferred | 1 |  | Keep |  | 1 |
| MTASK-093 | MTASK-006 | MCTRL-006 | QA validate scheduler, submission, and receipt archive | P0 | Online | QA | WF-24 | Regulatory Reporting Calendar + Production Packs + Agreements | Deferred | 1 |  | Keep |  | 1 |
| MTASK-074 | MTASK-002 | MCTRL-002 | Prepare insider acknowledgement template and onboarding SOP | P0 | Offline | Compliance/CompanySec | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-075 | MTASK-002 | MCTRL-002 | Build Insider List register with required fields and exports | P0 | Online | Tech/Compliance | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-076 | MTASK-002 | MCTRL-002 | Track acknowledgement collection status and reminders | P0 | Online | Ops/CompanySec | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-077 | MTASK-002 | MCTRL-002 | QA validate insider list lifecycle and acknowledgements | P0 | Online | QA | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-141 | MTASK-018 | MCTRL-018 | Define offline company structure evidence pack & storage rules | P0 | Offline | Legal/RI/Compliance | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-142 | MTASK-018 | MCTRL-018 | Build Company Structure Register (entity/UBO/control chain) | P0 | Online | Tech | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-143 | MTASK-018 | MCTRL-018 | Implement material change approval gate for UBO/control changes | P0 | Online | Tech/RI | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-144 | MTASK-018 | MCTRL-018 | QA dry-run for structure register & export | P0 | Online | QA | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-145 | MTASK-019 | MCTRL-019 | Prepare fit&proper evidence checklist per key function role | P0 | Offline | HR/Compliance/RI | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-146 | MTASK-019 | MCTRL-019 | Build Key Function Register (appointments, changes, reviews) | P0 | Online | Tech | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-147 | MTASK-019 | MCTRL-019 | Schedule annual fit&proper validation tasks and overdue alerts | P0 | Online | Ops/Compliance | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-148 | MTASK-019 | MCTRL-019 | QA validate role register, annual task, and export | P0 | Online | QA | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-154 | MTASK-021 | MCTRL-021 | Draft conflicts policy, mitigation options, and disclosure triggers | P0 | Offline | Compliance/Legal/CompanySec | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-155 | MTASK-021 | MCTRL-021 | Build Conflicts Register (create/mitigate/close) | P0 | Online | Tech | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-156 | MTASK-021 | MCTRL-021 | Add information barrier and disclosure record fields | P0 | Online | Tech/Compliance | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-157 | MTASK-021 | MCTRL-021 | QA validate conflicts register lifecycle & export | P0 | Online | QA | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-163 | MTASK-023 | MCTRL-023 | Prepare wind-down plan & weekly report template (offline pack) | P0 | Offline | RI/SM/Legal/Compliance | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-164 | MTASK-023 | MCTRL-023 | Implement Wind-down Plan Archive record (version/sign-off) | P0 | Online | Tech | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-165 | MTASK-023 | MCTRL-023 | Implement cessation trigger to generate VARA notice pack and weekly reports | P0 | Online | Tech/Ops | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-166 | MTASK-023 | MCTRL-023 | Implement insolvency case workflow (administrator requests/responses) | P0 | Online | Tech/Legal | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-167 | MTASK-023 | MCTRL-023 | QA validate cessation notice + weekly report scheduling | P0 | Online | QA | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-158 | MTASK-022 | MCTRL-022 | Register signed minutes file reference and hash | P1 | Offline | CompanySec/Board | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-159 | MTASK-022 | MCTRL-022 | Create board meeting register and decision tracker fields | P1 | Online | CompanySec/Board | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-160 | MTASK-022 | MCTRL-022 | Auto-create follow-up tasks for decisions (outsourcing/reporting/material change) | P1 | Online | CompanySec/Board | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-161 | MTASK-022 | MCTRL-022 | Implement export: Board minutes archive and decision tracker | P1 | Online | CompanySec/Board | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-162 | MTASK-022 | MCTRL-022 | QA validate meeting register, task automation, and exports | P1 | Online | QA | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-168 | MTASK-024 | MCTRL-024 | Document SOP for training plan and access linkage | P1 | Offline | HR/Compliance | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-169 | MTASK-024 | MCTRL-024 | Run offline confidentiality training sessions and record completion | P1 | Online | HR/Compliance | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-170 | MTASK-024 | MCTRL-024 | Implement annual staff certification cycle (365 days) with reminders and overdue alerts | P1 | Online | HR/Compliance | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-171 | MTASK-024 | MCTRL-024 | Create access review ticket when certification overdue | P1 | Online | HR/Compliance | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-172 | MTASK-024 | MCTRL-024 | Implement export: training/certification compliance by team and period | P1 | Online | HR/Compliance | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-173 | MTASK-024 | MCTRL-024 | QA validate training assignment, annual cycle, overdue ticket, and exports | P1 | Online | QA | WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | 1 |  | Keep |  | 1 |
| MTASK-213 | MTASK-034 | MCTRL-034 | Document disclosure review SOP and register reference | P1 | Offline | Compliance/Ops/Tech | WF-GOV-02 | Regulatory Filing + Receipt + Effectiveness Gate + Public Disclosures | Must | 1 |  | Keep |  | 1 |
| MTASK-214 | MTASK-034 | MCTRL-034 | Implement disclosure registry with machine-readable publishing and snapshots | P1 | Online | Compliance/Ops/Tech | WF-GOV-02 | Regulatory Filing + Receipt + Effectiveness Gate + Public Disclosures | Must | 1 |  | Keep |  | 1 |
| MTASK-215 | MTASK-034 | MCTRL-034 | Implement publish approval workflow and publish gate | P1 | Online | Compliance/Ops/Tech | WF-GOV-02 | Regulatory Filing + Receipt + Effectiveness Gate + Public Disclosures | Must | 1 |  | Keep |  | 1 |
| MTASK-216 | MTASK-034 | MCTRL-034 | Maintain disclosure field dictionary (field_name/definition/source/owner/update_rule) | P1 | Online | Compliance/Ops/Tech | WF-GOV-02 | Regulatory Filing + Receipt + Effectiveness Gate + Public Disclosures | Must | 1 |  | Keep |  | 1 |
| MTASK-217 | MTASK-034 | MCTRL-034 | Implement exports: disclosure snapshots by page/period and field dictionary | P1 | Online | Compliance/Ops/Tech | WF-GOV-02 | Regulatory Filing + Receipt + Effectiveness Gate + Public Disclosures | Must | 1 |  | Keep |  | 1 |
| MTASK-218 | MTASK-034 | MCTRL-034 | QA validate machine-readable publishing, snapshot integrity, and exports | P1 | Online | QA | WF-GOV-02 | Regulatory Filing + Receipt + Effectiveness Gate + Public Disclosures | Must | 1 |  | Keep |  | 1 |
| MTASK-264 | MTASK-044 | MCTRL-044 | Maintain Cybersecurity Policy document and annual review record | P0 | Offline | CISO/Compliance | WF-GOV-03 | Security/Privacy Programme Evidence Factory (Cyber/DLP/TLPT) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-265 | MTASK-044 | MCTRL-044 | Register policy version and VARA submission receipt in system | P0 | Online | Ops/CISO | WF-GOV-03 | Security/Privacy Programme Evidence Factory (Cyber/DLP/TLPT) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-266 | MTASK-044 | MCTRL-044 | Configure annual update reminder and overdue alert | P0 | Online | Ops/CISO | WF-GOV-03 | Security/Privacy Programme Evidence Factory (Cyber/DLP/TLPT) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-267 | MTASK-044 | MCTRL-044 | QA validate policy registry and reminders | P0 | Online | QA | WF-GOV-03 | Security/Privacy Programme Evidence Factory (Cyber/DLP/TLPT) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-268 | MTASK-045 | MCTRL-045 | Engage external tester and store pen test/TLPT report packages offline | P0 | Offline | CISO/Tech | WF-GOV-03 | Security/Privacy Programme Evidence Factory (Cyber/DLP/TLPT) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-269 | MTASK-045 | MCTRL-045 | Implement release gate: no report → no go-live | P0 | Online | Tech/CISO | WF-GOV-03 | Security/Privacy Programme Evidence Factory (Cyber/DLP/TLPT) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-270 | MTASK-045 | MCTRL-045 | Implement TLPT dossier record and VARA submission tracking | P0 | Online | Tech/Compliance | WF-GOV-03 | Security/Privacy Programme Evidence Factory (Cyber/DLP/TLPT) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-271 | MTASK-045 | MCTRL-045 | QA validate release gates and TLPT pack records | P0 | Online | QA | WF-GOV-03 | Security/Privacy Programme Evidence Factory (Cyber/DLP/TLPT) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-276 | MTASK-047 | MCTRL-047 | Implement confidential data export approval workflow (recipient & reason required) | P0 | Online | Tech/Compliance | WF-GOV-03 | Security/Privacy Programme Evidence Factory (Cyber/DLP/TLPT) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-277 | MTASK-047 | MCTRL-047 | Ingest DLP alerts and auto-create investigation cases with disposition tracking | P0 | Online | Tech/CISO | WF-GOV-03 | Security/Privacy Programme Evidence Factory (Cyber/DLP/TLPT) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-278 | MTASK-047 | MCTRL-047 | QA validate export approvals and DLP auto-case flow | P0 | Online | QA | WF-GOV-03 | Security/Privacy Programme Evidence Factory (Cyber/DLP/TLPT) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-279 | MTASK-048 | MCTRL-048 | Define RoPA, cross-border data register, and DSAR SOP (offline templates) | P0 | Offline | DPO/Legal/Compliance | WF-GOV-03 | Security/Privacy Programme Evidence Factory (Cyber/DLP/TLPT) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-280 | MTASK-048 | MCTRL-048 | Implement RoPA register and cross-border data register in system | P0 | Online | Tech/DPO | WF-GOV-03 | Security/Privacy Programme Evidence Factory (Cyber/DLP/TLPT) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-281 | MTASK-048 | MCTRL-048 | Implement DSAR case workflow with 30-day SLA | P0 | Online | Tech/DPO | WF-GOV-03 | Security/Privacy Programme Evidence Factory (Cyber/DLP/TLPT) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-282 | MTASK-048 | MCTRL-048 | Map vendors processing personal data and link to outsourcing contracts | P0 | Online | Tech/Compliance | WF-GOV-03 | Security/Privacy Programme Evidence Factory (Cyber/DLP/TLPT) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-283 | MTASK-048 | MCTRL-048 | QA validate RoPA exports, DSAR SLA, and vendor linkage | P0 | Online | QA | WF-GOV-03 | Security/Privacy Programme Evidence Factory (Cyber/DLP/TLPT) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-097 | MTASK-008 | MCTRL-008 | Obtain third-party AML policy attestation (offline file) | P0 | Offline | MLRO/Compliance | WF-GOV-04 | Policy & Attestation Lifecycle (incl resubmission timers) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-098 | MTASK-008 | MCTRL-008 | Implement AML policy version archive with attestation required pre-effective | P0 | Online | Tech/MLRO | WF-GOV-04 | Policy & Attestation Lifecycle (incl resubmission timers) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-099 | MTASK-008 | MCTRL-008 | Implement 21-day submission task to VARA with RI escalation | P0 | Online | Ops/Compliance/RI | WF-GOV-04 | Policy & Attestation Lifecycle (incl resubmission timers) | Deferred | 1 |  | Keep |  | 1 |
| MTASK-100 | MTASK-008 | MCTRL-008 | QA validate attestation gate and 21-day scheduler | P0 | Online | QA | WF-GOV-04 | Policy & Attestation Lifecycle (incl resubmission timers) | Deferred | 1 |  | Keep |  | 1 |
