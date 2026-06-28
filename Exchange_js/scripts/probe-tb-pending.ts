// scripts/probe-tb-pending.ts — read the TB transfer the failing post is looking for
import { createClient as tbCreateClient } from 'tigerbeetle-node';
import { createHash } from 'crypto';

function deterministicTransferId(sourceType: string, sourceNo: string, eventCode: string, legIndex: number): bigint {
  const input = `${sourceType}:${sourceNo}:${eventCode}:${legIndex}`;
  const hash = createHash('sha256').update(input).digest();
  return BigInt('0x' + hash.subarray(0, 16).toString('hex'));
}

async function main() {
  const tb = tbCreateClient({ cluster_id: 0n, replica_addresses: [process.env.TB_ADDRESS || '127.0.0.1:3003'] });
  try {
    const ids = ['SWAP_SELL_CLIENT', 'SWAP_SELL_FIRM'].map((ec) => deterministicTransferId('SWAP', 'SWP2606286633', ec, 1));
    console.log('Looking up TB transfers:');
    for (const id of ids) console.log('  ', id.toString());
    const transfers = await tb.lookupTransfers(ids);
    console.log(`Found ${transfers.length} transfer(s)`);
    for (const t of transfers) {
      console.log(`  id=${t.id} debit=${t.debit_account_id} credit=${t.credit_account_id} amount=${t.amount} flags=${t.flags} pending_id=${t.pending_id} timeout=${t.timeout}`);
    }
  } finally {
    tb.destroy();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
