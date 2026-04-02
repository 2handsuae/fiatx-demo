Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-01
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/README.md`
Source of Truth Level: requirement-reference

# Deprecated Workflow Snapshot

## Purpose
- This document is a Markdown snapshot converted from `Workflow_Task_Mapping_MVP_CN_v2_clean.xlsx` sheet `Deprecated_Workflows`.
- It preserves imported requirement / control-matrix input for project planning and review.
- It does not override `docs/constraints/**`, `docs/specs/**`, or active runtime truth.

## Source
- Workbook: `/Users/songshengwei/Downloads/原始表格/Workflow_Task_Mapping_MVP_CN_v2_clean.xlsx`
- Sheet: `Deprecated_Workflows`
- Data Rows: `2`
- Columns: `4`

## Columns
- `Deprecated_Workflow_ID`
- `Deprecated_Name`
- `Merged_Into`
- `Note`

## Data

| Deprecated_Workflow_ID | Deprecated_Name | Merged_Into | Note |
| --- | --- | --- | --- |
| WF-13 | Sanctions Screening + Freeze/Release | WF-12 | Sanctions treated as case_type=SANCTIONS within Risk Engine (WF-12). |
| WF-20 | Clearing & Settlement | WF-15/WF-08 | MVP uses splitting items + posting; clearing triggers live in posting/withdraw/swap workflows. Dedicated netting batch deferred. |
