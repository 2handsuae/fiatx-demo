-- Rename makerUserId -> createdByUserId on approval_cases
-- Using RENAME COLUMN (SQLite 3.25+) to preserve existing camelCase column naming convention
ALTER TABLE "approval_cases" RENAME COLUMN "makerUserId" TO "createdByUserId";
ALTER TABLE "approval_cases" RENAME COLUMN "makerUserNo" TO "createdByUserNo";
