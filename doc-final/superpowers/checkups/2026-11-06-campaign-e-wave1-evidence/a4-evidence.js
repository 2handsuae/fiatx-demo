// A4: per transfer code, sample evidence rows from a DB and resolve the REAL transfer in TigerBeetle.
// usage (repo root, Node 20): node doc-final/superpowers/checkups/2026-11-06-campaign-e-wave1-evidence/a4-evidence.js <dbPath> <tbAddress> <outJson>
// The u16 transfer code is NOT stored on tb_transfer_evidence, so it is read from TigerBeetle itself
// (lookup_transfers by the evidence id). Debit/credit account codes come from the TB accounts' own `code`.
const { execFileSync } = require('child_process');
const fs = require('fs');
const ROOT = process.cwd(); // run from the repo root
const { createClient } = require(ROOT + '/node_modules/tigerbeetle-node');

const [, , dbPath, tbAddr, outJson] = process.argv;
const q = (sql) => JSON.parse(execFileSync('sqlite3', ['-json', dbPath, sql], { maxBuffer: 1 << 28 }).toString() || '[]');

const MN = { 1: 'A.CLIENT_CASH', 50: 'A.FIRM_CASH', 100: 'L.CLIENT_PAYABLE', 101: 'L.DEPOSIT_SUSPENSE', 200: 'E.FIRM_EQUITY',
  210: 'E.INCOME_SWAP_FEE', 211: 'E.INCOME_WITHDRAW_FEE', 212: 'E.INCOME_OTHER', 300: 'X.EXPENSE_BANK_CUSTODY', 301: 'X.EXPENSE_RECON_LOSS', 302: 'X.EXPENSE_OTHER' };
const FLAG = { 1: 'linked', 2: 'pending', 4: 'post_pending', 8: 'void_pending' };

(async () => {
  const client = createClient({ cluster_id: 0n, replica_addresses: [tbAddr] });
  const ev = q('select tbTransferId,sourceType,sourceNo,eventCode,debitCode,creditCode,amount,assetCode,transferType,pendingId,debitTbAccountId,creditTbAccountId,createdAt from tb_transfer_evidence order by createdAt, tbTransferId');
  const reg = q('select tbAccountId,code,ledger,ownerType,ownerNo,description from tb_account_registry');
  const regById = new Map(reg.map((r) => [r.tbAccountId, r]));
  const rows = [];
  for (let i = 0; i < ev.length; i += 100) {
    const chunk = ev.slice(i, i + 100);
    const ts = await client.lookupTransfers(chunk.map((e) => BigInt('0x' + e.tbTransferId)));
    const byId = new Map(ts.map((t) => [t.id.toString(16).padStart(32, '0'), t]));
    const accIds = new Set();
    for (const t of ts) { accIds.add(t.debit_account_id); accIds.add(t.credit_account_id); }
    const accs = await client.lookupAccounts([...accIds]);
    const accById = new Map(accs.map((a) => [a.id.toString(16).padStart(32, '0'), a]));
    for (const e of chunk) {
      const t = byId.get(e.tbTransferId);
      if (!t) { rows.push({ ...e, tb: null }); continue; }
      const dKey = t.debit_account_id.toString(16).padStart(32, '0');
      const cKey = t.credit_account_id.toString(16).padStart(32, '0');
      const da = accById.get(dKey), ca = accById.get(cKey);
      rows.push({
        ...e,
        tb: {
          code: t.code, ledger: t.ledger, flags: t.flags, flagNames: Object.entries(FLAG).filter(([b]) => (t.flags & Number(b)) !== 0).map(([, n]) => n),
          debitAcc: dKey, creditAcc: cKey, debitAccCode: da && da.code, creditAccCode: ca && ca.code,
          debitDesc: (regById.get(dKey) || {}).description || null, creditDesc: (regById.get(cKey) || {}).description || null,
          debitOwnerType: (regById.get(dKey) || {}).ownerType || null, creditOwnerType: (regById.get(cKey) || {}).ownerType || null,
          amount: t.amount.toString(),
        },
      });
    }
  }
  // stage records: for two-phase rows evidence.pendingId holds the post/void transfer id (evidence tbTransferId = the PENDING transfer)
  const stageRows = rows.filter((r) => r.tb && r.pendingId);
  for (let i = 0; i < stageRows.length; i += 100) {
    const chunk = stageRows.slice(i, i + 100);
    const ts = await client.lookupTransfers(chunk.map((e) => BigInt('0x' + e.pendingId)));
    const byId = new Map(ts.map((t) => [t.id.toString(16).padStart(32, '0'), t]));
    for (const e of chunk) {
      const t = byId.get(e.pendingId);
      e.stage = t ? { found: true, code: t.code, flags: t.flags, flagNames: Object.entries(FLAG).filter(([b]) => (t.flags & Number(b)) !== 0).map(([, n]) => n),
        refsPending: t.pending_id.toString(16).padStart(32, '0') === e.tbTransferId, amount: t.amount.toString() } : { found: false };
    }
  }
  // evidence rows still PENDING: best-effort voids (withdraw releaseLock) skip the evidence update, so ask TigerBeetle whether a
  // post/void transfer already references the pending id (walk the debit account's transfers, index by pending_id).
  const { AccountFilterFlags } = require(ROOT + '/node_modules/tigerbeetle-node');
  const openRows = rows.filter((r) => r.tb && r.transferType === 'PENDING');
  const accsDone = new Map();
  for (const r of openRows) {
    const acc = BigInt('0x' + r.tb.debitAcc);
    const key = r.tb.debitAcc;
    if (!accsDone.has(key)) {
      const list = await client.getAccountTransfers({ account_id: acc, user_data_128: 0n, user_data_64: 0n, user_data_32: 0, code: 0, timestamp_min: 0n, timestamp_max: 0n, limit: 1000, flags: AccountFilterFlags.debits | AccountFilterFlags.credits });
      const byPending = new Map();
      for (const t of list) if (t.pending_id !== 0n) byPending.set(t.pending_id.toString(16).padStart(32, '0'), t);
      accsDone.set(key, byPending);
    }
    const t = accsDone.get(key).get(r.tbTransferId);
    r.openStage = t ? { found: true, id: t.id.toString(16).padStart(32, '0'), code: t.code, flags: t.flags, flagNames: Object.entries(FLAG).filter(([b]) => (t.flags & Number(b)) !== 0).map(([, n]) => n) } : { found: false };
  }
  client.destroy();
  fs.writeFileSync(outJson, JSON.stringify({ dbPath, tbAddr, total: rows.length, mn: MN, rows }, null, 1));
  const missing = rows.filter((r) => !r.tb).length;
  const byCode = {};
  for (const r of rows) if (r.tb) { byCode[r.tb.code] = (byCode[r.tb.code] || 0) + 1; }
  console.log('evidence rows', rows.length, 'not found in TB', missing);
  console.log('by TB transfer code', JSON.stringify(byCode));
})().catch((e) => { console.error(e); process.exit(1); });
