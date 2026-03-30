# ADR Docs

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-23
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/README.md`
Source of Truth Level: adr

## Purpose
- Record major architecture or product decisions and the reasons behind them.
- ADRs prevent design intent from being lost in chat history or commit diffs.
- ADRs are intentionally sparse in this repo.
- ADR count by itself is not a quality metric.

## Filing Rule
- Read `docs/constraints/documentation-filing-and-adr-constraints.md` before deciding whether a new thread needs an ADR.
- `constraints/specs` remain the default home for most new truth.
- ADR is reserved for major cross-domain or platform-level decisions whose rationale must remain durable.

## Recommended Topics
- context
- decision
- consequences
- alternatives considered

## Backfill Policy
- Do not backfill ADRs just to make the folder look complete.
- Backfill an older decision only when:
1. the decision is foundational
2. the rationale is still recoverable
3. lack of ADR keeps causing repeated confusion

## Current ADRs
- `docs/adr/business-base-config-release-model.md`
  - Locks the Wave 4 `config-as-code + item revision + subject release` governance model.
