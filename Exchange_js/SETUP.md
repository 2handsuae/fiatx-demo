# Exchange_js — Setup Guide

This package is a NestJS + Prisma (SQLite) backend with a React admin and client.

## Prerequisites

- Node.js 20+
- `npm`
- `sqlite3` CLI (for diagnostics; optional)
- TigerBeetle binary (the ledger — balances live here, **not** in SQLite)

## What's in the box

- Full source for `Exchange_js/` (backend), `admin-web/`, `client-web/`
- `.env.example` — copy to `.env`
- **`prisma/dev.db`** — a ready-to-use database, pre-seeded with base IAM data
  and governance demo data. You can run it as-is.

## Option 1 — Use the included database (fastest)

```bash
npm install
cp .env.example .env          # DATABASE_URL already points at prisma/dev.db
npm run prisma:generate

# Ledger (required for balance/trade operations):
npm run dev:tb:format
npm run dev:tb:start

npm run start:dev             # backend on http://localhost:3000
```

Admin / client web apps:

```bash
cd admin-web  && npm install && npm run dev   # http://localhost:3001
cd client-web && npm install && npm run dev   # http://localhost:3002
```

> **Governance demo data** is seeded over the API, so it requires the backend
> to be running. The shipped `prisma/dev.db` has base data only. To add the
> governance demo set, start the backend (above) and then run:
> ```bash
> npm run db:seed:demo
> ```

## Option 2 — Recreate the database from scratch

The database is fully reproducible from the versioned migrations + seeds:

```bash
npm install
npm run db:setup
```

`db:setup` will:
1. create `.env` from `.env.example` if missing,
2. apply every migration in `prisma/migrations/` (builds the schema),
3. seed base IAM data, then governance demo data.

Override the target location if you want:

```bash
DATABASE_URL="file:/abs/path/dev.db" npm run db:setup
```

## Important: TigerBeetle vs SQLite

This system splits state across two stores:

- **SQLite (`prisma/dev.db`)** — entities, configs, transaction records,
  audit logs. This is what the package ships and what `db:setup` rebuilds.
- **TigerBeetle** — the double-entry ledger holding all account balances.
  This is a separate process and is **not** part of the SQLite snapshot.
  Format + start it with `npm run dev:tb:format` / `npm run dev:tb:start`.

A swap/withdraw/deposit needs both running. The shipped `dev.db` gives you a
working app with seeded config and demo governance data; ledger balances start
empty until you format TigerBeetle and create activity.

## Default ports

| Service | Port |
|---|---|
| Backend API | 3000 |
| Admin web | 3001 |
| Client web | 3002 |
| TigerBeetle | 3003 |

Change them in `.env` (and `admin-web/.env.local` / `client-web/.env.local`
`VITE_API_URL`) if they clash.
