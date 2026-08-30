// scripts/sumsub-deposit-smoke.ts
//
// 沙盒冒烟(手动跑,不进 CI):真 submit 一笔 finance 交易 → 轮询 getTxn 直到出现 verdict → 打印结果。
//
// 用法:
//   source /tmp/sumsub-sandbox.env
//   npx ts-node scripts/sumsub-deposit-smoke.ts

import { HttpSumsubTxnClient } from '../src/modules/sumsub-shared/sumsub-txn-client.http';

const APPLICANT_ID = '6a5dd88f07d9bbd981a22fc9'; // sandbox 真 applicant:Alice(CU2601019430)
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 15;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  if (!process.env.SUMSUB_APP_TOKEN || !process.env.SUMSUB_SECRET_KEY) {
    console.error('缺 SUMSUB_APP_TOKEN/SUMSUB_SECRET_KEY,先 source /tmp/sumsub-sandbox.env');
    process.exitCode = 1;
    return;
  }

  const client = new HttpSumsubTxnClient();
  const clientTxnId = `deposit-smoke-${Date.now()}`;

  console.log(`[submitTxn] applicantId=${APPLICANT_ID} clientTxnId=${clientTxnId}`);
  const { txnId } = await client.submitTxn({
    applicantId: APPLICANT_ID,
    clientTxnId,
    type: 'finance',
    direction: 'in',
    amount: 100,
    currencyCode: 'USD',
    currencyType: 'fiat',
  });
  console.log(`[submitTxn] 返回 txnId=${txnId}`);

  for (let attempt = 1; attempt <= MAX_POLLS; attempt += 1) {
    const detail = await client.getTxn(txnId);
    console.log(`[getTxn attempt=${attempt}]`, JSON.stringify(detail));

    if (detail.verdict) {
      console.log('[result] 拿到 verdict,冒烟结束:', JSON.stringify(detail, null, 2));
      return;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  console.error(`[result] 轮询 ${MAX_POLLS} 次仍无 verdict`);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error('[error]', error);
  process.exitCode = 1;
});
