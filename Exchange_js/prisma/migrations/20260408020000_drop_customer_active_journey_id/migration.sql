-- Drop customer_main.activeJourneyId.
-- Uses SQLite 3.35+ native ALTER TABLE DROP COLUMN support to avoid the
-- table-recreate pattern's pitfalls (loses PK/UNIQUE constraints, breaks
-- foreign key resolution, trigger dependencies, etc.).
-- The column was a free-floating trace identifier overloaded for three
-- different jobs (audit trace, CDD/EDD response grouping, workflow handle).
-- Those jobs now use customer.id (for sequence grouping) and
-- customer.onboardingTraceId (for audit traces).
ALTER TABLE "customer_main" DROP COLUMN "activeJourneyId";
