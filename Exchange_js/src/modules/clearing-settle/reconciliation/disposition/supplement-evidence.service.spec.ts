import { BadRequestException } from '@nestjs/common';
import { SupplementEvidenceService, minorToMajor } from './supplement-evidence.service';

const prisma: any = {
  reconciliationCase: { findUnique: jest.fn() },
  externalStatementLine: { findUnique: jest.fn() },
  // findFirst 补进：listCandidates 用它找定性行；brief 原始铺法只给了 findUnique，
  // 不补会在 listCandidates 测试里当场抛「不是函数」——不是改断言，是补全 fixture。
  reconciliationDisposition: { findUnique: jest.fn(), findFirst: jest.fn() },
  wallet: { findUnique: jest.fn() },
  // asset 补进：合并 main（V3 波一 T5）后 Wallet 已无 asset 关联，loadLine() 改按
  // 案子的 assetId 取资产（见该文件同处注释），mock 要跟着提供这个模型。
  asset: { findUnique: jest.fn() },
  customerMain: { findUnique: jest.fn() },
  inboundTransferSignal: { findFirst: jest.fn() },
  depositTransaction: { findFirst: jest.fn(), findMany: jest.fn() },
  withdrawTransaction: { findFirst: jest.fn(), findMany: jest.fn() },
  // describeLine 用（本轮测试未覆盖 describeLine，按裁定预先补全）。
  reconciliationLineItem: { findFirst: jest.fn() },
};
const service = new SupplementEvidenceService(prisma);

const kase = { id: 'case-1', caseNo: 'REC1', status: 'OPEN', book: 'CLIENT', walletRef: 'w1', businessDate: '2026-09-01', ownerNo: 'CUS1',
  assetId: 'a1', assetCode: 'AED',
  lineItems: [{ externalTxId: 'line-1', matchStatus: 'ORPHAN_EXTERNAL' }] };
const line = { id: 'line-1', direction: 'IN', amount: '120000', currency: 'AED', externalRef: 'REF-1', channelRef: null, datetime: new Date('2026-09-01T10:00:00Z'), description: 'Incoming', source: 'ZAND' };
// asset.code 补进（AED 法币 code===currency，与真实种子数据同形）——loadLine() 的
// 币种校验改比 asset.code 不改 asset.currency 后（Task 8 e2e 用真实 USDT 案子跑通
// ①a 时发现的字段级笔误，见该文件改动处的注释），mock 若只给 currency 不给 code，
// code 读出 undefined，法币这个原本该过的场景也会被判「币种不符」。
// 钱包不再带资产（波一 T5 砍了 Wallet.assetId 与 asset 关联，钱包是「网络上的地址行」）；
// 资产独立一份，由 loadLine 按 kase.assetId 取。
const wallet = { id: 'w1', walletNo: 'W-1', address: null, iban: 'AE00', ownerId: 'cust-1', network: 'AED_ZAND', vaultCode: 'CLIENT_DEPOSIT' };
const aedAsset = { id: 'a1', code: 'AED', currency: 'AED', type: 'FIAT', decimals: 2 };
const disposition = { dispositionNo: 'RCD1', caseNo: 'REC1', explainedExternalLineId: 'line-1', outlet: 'SUPPLEMENT', deferredTarget: 'SUPPLEMENT_DEPOSIT', supplementNo: null };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.reconciliationCase.findUnique.mockResolvedValue(kase);
  prisma.externalStatementLine.findUnique.mockResolvedValue(line);
  prisma.wallet.findUnique.mockResolvedValue(wallet);
  prisma.asset.findUnique.mockResolvedValue(aedAsset);
  prisma.customerMain.findUnique.mockResolvedValue({ customerNo: 'CUS1' });
  prisma.reconciliationDisposition.findUnique.mockResolvedValue(disposition);
  prisma.inboundTransferSignal.findFirst.mockResolvedValue(null);
  prisma.depositTransaction.findFirst.mockResolvedValue(null);
  prisma.withdrawTransaction.findFirst.mockResolvedValue(null);
});

describe('minorToMajor', () => {
  it('120000 minor → 1200.00; 4700 → 0.004700 (6 decimals)', () => {
    expect(minorToMajor('120000', 2)).toBe('1200.00');
    expect(minorToMajor('4700', 6)).toBe('0.004700');
  });
});

describe('assertClaimable (spec §2.1)', () => {
  const ok = { caseNo: 'REC1', externalLineId: 'line-1', dispositionNo: 'RCD1', kind: 'SUPPLEMENT_DEPOSIT' as const };
  it('all conditions met → returns line facts (minor unit + major unit + business date)', async () => {
    const r = await service.assertClaimable(ok);
    expect(r.amountMinor).toBe('120000'); expect(r.amountMajor).toBe('1200.00'); expect(r.businessDate).toBe('2026-09-01');
    expect(r.ownerNo).toBe('CUS1'); expect(r.assetType).toBe('FIAT');
  });
  it('case is not OPEN / not a client-book case → 400', async () => {
    prisma.reconciliationCase.findUnique.mockResolvedValueOnce({ ...kase, status: 'RESOLVED' });
    await expect(service.assertClaimable(ok)).rejects.toThrow(BadRequestException);
    prisma.reconciliationCase.findUnique.mockResolvedValueOnce({ ...kase, book: 'FIRM' });
    await expect(service.assertClaimable(ok)).rejects.toThrow(/client-book/);
  });
  it('line is not in the latest run\'s difference lines / not external-only → 400', async () => {
    prisma.reconciliationCase.findUnique.mockResolvedValueOnce({ ...kase, lineItems: [{ externalTxId: 'line-1', matchStatus: 'MATCHED' }] });
    await expect(service.assertClaimable(ok)).rejects.toThrow(/external only/);
  });
  it('direction does not match the path → 400 (① wants IN, given OUT)', async () => {
    prisma.externalStatementLine.findUnique.mockResolvedValueOnce({ ...line, direction: 'OUT' });
    await expect(service.assertClaimable(ok)).rejects.toThrow(/direction/);
  });
  it('already claimed (by a signal / deposit / withdrawal) → 400', async () => {
    prisma.inboundTransferSignal.findFirst.mockResolvedValueOnce({ signalNo: 'SIG9' });
    await expect(service.assertClaimable(ok)).rejects.toThrow(/SIG9/);
  });
  it('finding is not for this line / outlet is not SUPPLEMENT / target mismatch / already linked to a supplement → 400', async () => {
    prisma.reconciliationDisposition.findUnique.mockResolvedValueOnce({ ...disposition, deferredTarget: 'SUPPLEMENT_BOUNCE' });
    await expect(service.assertClaimable(ok)).rejects.toThrow(/target/);
    prisma.reconciliationDisposition.findUnique.mockResolvedValueOnce({ ...disposition, supplementNo: 'SIG1' });
    await expect(service.assertClaimable(ok)).rejects.toThrow(/already linked to supplement/);
  });
});

describe('loadLine currency validation (review Minor 4): repo-wide convention — external_statement_lines.currency stores asset.code, not asset.currency', () => {
  // The AED mock on `wallet` above is a fiat asset where code===currency ('AED'==='AED') — no
  // matter which field loadLine compares, it passes, i.e. no real guardrail (verified in review:
  // reverting the src to wallet.asset.currency, this AED group still passes 9/9). This block adds
  // a crypto scenario that actually diverges: USDT's code is 'USDT-TRON', different from its
  // currency 'USDT'.
  const cryptoAsset = { id: 'a2', code: 'USDT-TRON', currency: 'USDT', type: 'CRYPTO', decimals: 6 };
  const ok = { caseNo: 'REC1', externalLineId: 'line-1', dispositionNo: 'RCD1', kind: 'SUPPLEMENT_DEPOSIT' as const };
  it('statement line currency is asset.code (USDT-TRON) → allowed', async () => {
    prisma.asset.findUnique.mockResolvedValueOnce(cryptoAsset);
    prisma.externalStatementLine.findUnique.mockResolvedValueOnce({ ...line, currency: 'USDT-TRON' });
    const r = await service.assertClaimable(ok);
    expect(r.assetType).toBe('CRYPTO');
    expect(r.currency).toBe('USDT'); // return value is for human-readable audit copy, still the bare currency, not the code
  });
  it('statement line currency is the bare currency (USDT, not asset.code) → 400', async () => {
    prisma.asset.findUnique.mockResolvedValueOnce(cryptoAsset);
    prisma.externalStatementLine.findUnique.mockResolvedValueOnce({ ...line, currency: 'USDT' });
    await expect(service.assertClaimable(ok)).rejects.toThrow(/currency.*does not match/);
  });
});

describe('listCandidates', () => {
  it('② recall: SUCCESS deposits on the same wallet with the same amount, newest first', async () => {
    prisma.externalStatementLine.findUnique.mockResolvedValueOnce({ ...line, direction: 'OUT' });
    prisma.reconciliationDisposition.findUnique.mockResolvedValue(null);
    prisma.depositTransaction.findMany.mockResolvedValueOnce([
      { id: 'd1', depositNo: 'DEP1', amount: '1200', status: 'SUCCESS', createdAt: new Date('2026-08-30') },
      { id: 'd2', depositNo: 'DEP2', amount: '4000', status: 'SUCCESS', createdAt: new Date('2026-08-31') },
    ]);
    const r = await service.listCandidates('REC1', 'line-1');
    expect(r.kind).toBe('SUPPLEMENT_BOUNCE');
    expect(r.candidates.map((c) => c.orderNo)).toEqual(['DEP1']);
  });

  it('external projection carries no internal UUID (principle ⑥): line has no internal id / minor amount, candidates carry no id', async () => {
    prisma.externalStatementLine.findUnique.mockResolvedValueOnce({ ...line, direction: 'OUT' });
    prisma.reconciliationDisposition.findUnique.mockResolvedValue(null);
    prisma.depositTransaction.findMany.mockResolvedValueOnce([
      { id: 'd1', depositNo: 'DEP1', amount: '1200', status: 'SUCCESS', createdAt: new Date('2026-08-30') },
    ]);
    const r = await service.listCandidates('REC1', 'line-1');
    // Kept: externalLineId is the supplement form's hidden anchor (explicitly kept per spec §2.1), walletNo is a business key.
    expect(r.line.externalLineId).toBe('line-1');
    expect(r.line.walletNo).toBe('W-1');
    // Dropped: internal ids and minor-unit amounts never leave this object.
    expect(r.line).not.toHaveProperty('caseId');
    expect(r.line).not.toHaveProperty('walletId');
    expect(r.line).not.toHaveProperty('ownerId');
    expect(r.line).not.toHaveProperty('assetId');
    expect(r.line).not.toHaveProperty('amountMinor');
    expect(r.line).not.toHaveProperty('walletAddress');
    expect(r.line).not.toHaveProperty('walletIban');
    expect(r.candidates.length).toBeGreaterThan(0);
    r.candidates.forEach((c: any) => expect(c).not.toHaveProperty('id'));
  });
});
