-- Drop orphaned SLA timer subsystem (governance/sla-timers module removed; no live references).
PRAGMA foreign_keys=off;
DROP TABLE "sla_notifications";
DROP TABLE "sla_timers";
PRAGMA foreign_keys=on;
