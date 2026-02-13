# Template Traceability Enhancement Plan

## 1. Analysis
The user wants to know if `Journal` (Header) and `JournalLine` should reference their source Templates (`JournalHeaderTemplate` and `JournalLineTemplate`).

**Current State:**
*   Journal is linked to `eventCode`.
*   Journal Lines are linked to Journal.
*   Templates are versioned (implied by `version` field in HeaderTemplate, though currently `templateCode` is unique which might limit versioning unless templateCode includes version).

**Problem:**
*   If a Template is updated (new version created), it's hard to tell which Journal was created by which Template version solely by `eventCode`.
*   Debugging accounting errors is difficult without knowing the exact rule (Template Line) that generated a Journal Line.

**Decision:**
*   **Journal Header**: MUST have `templateId` (FK to `JournalHeaderTemplate`). This provides version-specific traceability.
*   **Journal Line**: SHOULD have `templateId` (FK to `JournalLineTemplate`). This provides granular traceability to the specific rule. While `Header -> Template -> LineTemplate` can theoretically derive this, explicit linking is safer against Template changes and easier for query/debug.

## 2. Schema Changes

### Journal Header (`journals`)
*   Add `journalHeaderTemplateId` (String, Nullable).
*   Add Foreign Key relation to `JournalHeaderTemplate`.

### Journal Line (`journal_lines`)
*   Add `journalLineTemplateId` (String, Nullable).
*   Add Foreign Key relation to `JournalLineTemplate`.

*Note: Fields are Nullable to support manual journal entries that don't come from a template.*

## 3. Implementation Steps

1.  **Update `prisma/schema.prisma`**:
    *   Add relations to `Journal` and `JournalLine`.
2.  **Generate Migration**:
    *   `npx prisma migrate dev --name add_template_traceability`
3.  **Update `JournalsService`**:
    *   When creating a journal from a template, populate `journalHeaderTemplateId`.
    *   When creating lines, populate `journalLineTemplateId`.
4.  **Verification**:
    *   Run a test flow to ensure IDs are populated.

## 4. Proposed Schema Diff

```prisma
model Journal {
  // ... existing fields
  
  // Traceability
  journalHeaderTemplateId String?
  journalHeaderTemplate   JournalHeaderTemplate? @relation(fields: [journalHeaderTemplateId], references: [id])

  @@index([journalHeaderTemplateId])
}

model JournalLine {
  // ... existing fields

  // Traceability
  journalLineTemplateId String?
  journalLineTemplate   JournalLineTemplate? @relation(fields: [journalLineTemplateId], references: [id])

  @@index([journalLineTemplateId])
}
```
