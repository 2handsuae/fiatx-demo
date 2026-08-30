/*
  Warnings:

  - You are about to drop the `appointment_records` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `conflict_disclosures` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `regulatory_gate_items` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `shareholding_registry_participants` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `shareholding_registry_versions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `training_records` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `wind_down_material_records` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "appointment_records";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "conflict_disclosures";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "regulatory_gate_items";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "shareholding_registry_participants";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "shareholding_registry_versions";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "training_records";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "wind_down_material_records";
PRAGMA foreign_keys=on;
