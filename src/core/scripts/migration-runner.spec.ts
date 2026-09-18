import { execFileSync, spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, closeSync, openSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

const APP_DIR = path.resolve(__dirname, '../../..');
const APPLY_LOCAL_MIGRATIONS = path.join(APP_DIR, 'scripts', 'apply-local-migrations.sh');
const RUNTIME_DIAGNOSE = path.join(APP_DIR, 'scripts', 'runtime-diagnose.sh');
const MIGRATIONS_DIR = path.join(APP_DIR, 'prisma', 'migrations');
const TARGET_MIGRATION = '20260319193000_wave2_phase12_mlro_gate';

function getRealSqlite3Path() {
  return execFileSync('bash', ['-lc', 'command -v sqlite3'], {
    cwd: APP_DIR,
    encoding: 'utf8',
  }).trim();
}

function sha256(filePath: string) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function createMigrationTableSql() {
  return `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "checksum" TEXT NOT NULL,
  "finished_at" DATETIME,
  "migration_name" TEXT NOT NULL UNIQUE,
  "logs" TEXT,
  "rolled_back_at" DATETIME,
  "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);
`.trim();
}

function seedAppliedMigrations(dbFile: string, migrationNames: string[]) {
  const inserts = migrationNames
    .map((migrationName) => {
      const migrationFile = path.join(MIGRATIONS_DIR, migrationName, 'migration.sql');
      const checksum = sha256(migrationFile);
      return `
INSERT INTO "_prisma_migrations" (
  "id",
  "checksum",
  "finished_at",
  "migration_name",
  "logs",
  "rolled_back_at",
  "started_at",
  "applied_steps_count"
) VALUES (
  '${migrationName}',
  '${checksum}',
  CURRENT_TIMESTAMP,
  '${migrationName}',
  '',
  NULL,
  CURRENT_TIMESTAMP,
  1
);`.trim();
    })
    .join('\n');

  execFileSync(getRealSqlite3Path(), [dbFile, `${createMigrationTableSql()}\n${inserts}`], {
    cwd: APP_DIR,
    encoding: 'utf8',
  });
}

function createFakeSqliteWrapper(tempDir: string) {
  const wrapperPath = path.join(tempDir, 'sqlite3');
  const realSqlite3 = getRealSqlite3Path();

  writeFileSync(
    wrapperPath,
    `#!/usr/bin/env bash
set -euo pipefail
real_sqlite3=${JSON.stringify(realSqlite3)}
joined="$*"
mode="\${FAKE_SQLITE_MODE:-}"
target=${JSON.stringify(TARGET_MIGRATION)}

if [[ "$mode" == "target-metadata-failure" && "$joined" == *"_prisma_migrations"* && "$joined" == *"$target"* ]]; then
  echo "simulated sqlite metadata read failure for $target" >&2
  exit 1
fi

if [[ "$mode" == "all-metadata-failure" && "$joined" == *"_prisma_migrations"* ]]; then
  echo "simulated sqlite metadata read failure" >&2
  exit 1
fi

exec "$real_sqlite3" "$@"
`,
    { mode: 0o755 },
  );

  return wrapperPath;
}

describe('migration runner scripts', () => {
  it('fails fast on migration metadata read failure instead of replaying an applied migration', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'exchange-js-migration-runner-'));
    const dbFile = path.join(tempDir, 'dev.db');
    const allMigrations = readdirSync(MIGRATIONS_DIR)
      .filter((entry) => entry !== '.DS_Store')
      .sort();
    const appliedMigrations = allMigrations.filter(
      (migrationName) => migrationName <= TARGET_MIGRATION,
    );

    seedAppliedMigrations(dbFile, appliedMigrations);
    execFileSync(
      getRealSqlite3Path(),
      [
        dbFile,
        'CREATE TABLE IF NOT EXISTS "compliance_incidents" ("id" TEXT NOT NULL PRIMARY KEY, "proposedWorkflowDecision" TEXT);',
      ],
      {
        cwd: APP_DIR,
        encoding: 'utf8',
      },
    );

    const fakeSqliteDir = mkdtempSync(path.join(tempDir, 'fake-sqlite-bin-'));
    createFakeSqliteWrapper(fakeSqliteDir);

    const result = spawnSync('bash', [APPLY_LOCAL_MIGRATIONS, APP_DIR, 'main'], {
      cwd: APP_DIR,
      env: {
        ...process.env,
        DATABASE_URL: `file:${dbFile}`,
        PATH: `${fakeSqliteDir}:${process.env.PATH || ''}`,
        FAKE_SQLITE_MODE: 'target-metadata-failure',
      },
      encoding: 'utf8',
    });

    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toContain(
      `[migrate] ERROR ${TARGET_MIGRATION}: migration metadata read failed`,
    );
    expect(output).not.toContain(`[migrate] apply ${TARGET_MIGRATION}`);
    expect(output).not.toContain('duplicate column name');
  });

  it('reports migration metadata read errors explicitly in runtime diagnose output', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'exchange-js-runtime-diagnose-'));
    const dbFile = path.join(tempDir, 'dev.db');
    closeSync(openSync(dbFile, 'w'));

    const fakeSqliteDir = mkdtempSync(path.join(tempDir, 'fake-sqlite-bin-'));
    createFakeSqliteWrapper(fakeSqliteDir);

    const result = spawnSync('bash', [RUNTIME_DIAGNOSE, 'main'], {
      cwd: APP_DIR,
      env: {
        ...process.env,
        DATABASE_URL: `file:${dbFile}`,
        PATH: `${fakeSqliteDir}:${process.env.PATH || ''}`,
        FAKE_SQLITE_MODE: 'all-metadata-failure',
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);

    expect(payload.migration.metadataReadError).toContain(
      'failed to read migration metadata',
    );
    expect(payload.migration.driftDetected).toBe(true);
  });
});
