# Specs Docs

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-19
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/README.md`, `docs/constraints/README.md`
Source of Truth Level: specs

## Purpose
- Use specs for durable system meaning:
1. entity semantics
2. workflow semantics
3. state and field definitions
4. read/write ownership boundaries

## Subfolders
- `entities/`: field-level and model-level semantics
- `workflows/`: actor/state/transition semantics
- `modules/`: bounded module behavior and subsystem design notes

## Update When
- A workflow meaning changes.
- A field meaning changes.
- A canonical source-of-truth model changes.
