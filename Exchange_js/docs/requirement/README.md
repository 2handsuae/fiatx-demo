Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-01
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/README.md`, `docs/constraints/documentation-filing-and-adr-constraints.md`
Source of Truth Level: requirement-reference-index

# Requirement Directory

## Purpose
- This directory stores imported business requirement material converted from external Excel workbooks.
- It is intended for requirement review, gap analysis, and planning traceability.
- It does not replace or override `docs/constraints/**`, `docs/specs/**`, `docs/roadmap/**`, or `docs/acceptance/**`.

## Source Files
- `/Users/songshengwei/Downloads/原始表格/Master_Control_Task_Merge_v3_clean.xlsx`
- `/Users/songshengwei/Downloads/原始表格/Workflow_Task_Mapping_MVP_CN_v2_clean.xlsx`

## Included Markdown Snapshots
- `master-controls.md`: `Master Controls Requirement Snapshot` from `Master_Control_Task_Merge_v3_clean.xlsx` / `A_MasterControls` (`65` rows)
- `master-tasks.md`: `Master Tasks Requirement Snapshot` from `Master_Control_Task_Merge_v3_clean.xlsx` / `D_MasterTasks` (`366` rows)
- `workflows.md`: `Workflow Requirement Snapshot` from `Workflow_Task_Mapping_MVP_CN_v2_clean.xlsx` / `Workflows` (`26` rows)
- `deprecated-workflows.md`: `Deprecated Workflow Snapshot` from `Workflow_Task_Mapping_MVP_CN_v2_clean.xlsx` / `Deprecated_Workflows` (`2` rows)
- `control-to-workflow.md`: `Control To Workflow Mapping Snapshot` from `Workflow_Task_Mapping_MVP_CN_v2_clean.xlsx` / `Control_to_Workflow` (`65` rows)
- `task-to-workflow.md`: `Task To Workflow Mapping Snapshot` from `Workflow_Task_Mapping_MVP_CN_v2_clean.xlsx` / `Task_to_Workflow` (`366` rows)
- `coverage-summary-child.md`: `Workflow Coverage Summary Snapshot` from `Workflow_Task_Mapping_MVP_CN_v2_clean.xlsx` / `Coverage_Summary_Child` (`26` rows)
- `task-workflow-ownership-child.md`: `Task Workflow Ownership Snapshot` from `Workflow_Task_Mapping_MVP_CN_v2_clean.xlsx` / `Task_Workflow_Ownership_Child` (`301` rows)

## Filing Rule
- `docs/requirement/**` is an imported reference layer for external requirement inputs.
- New runtime truth must still be filed into the normal documentation system:
  - `docs/constraints/**` for hard rules
  - `docs/specs/**` for durable entity/workflow/module meaning
  - `docs/roadmap/**` for wave scope and sequencing
  - `docs/acceptance/**` for runbooks and validation

## Usage
- Use these files when aligning external control matrices with implemented wave scope.
- Use these files when doing requirement coverage or gap analysis against the product demo.
