import { InternalTransferService } from './internal-transfer.service';
import { InternalTransferStatus as S } from './dto/internal-transfer.dto';

describe('InternalTransferService (Task 5)', () => {
  const svc = (prisma: any = {}) => new InternalTransferService(prisma);

  describe('six states, six edges', () => {
    it.each([
      [S.PENDING_APPROVAL, S.EXECUTING], [S.PENDING_APPROVAL, S.FAILED], [S.PENDING_APPROVAL, S.REJECTED], [S.PENDING_APPROVAL, S.CANCELLED],
      [S.EXECUTING, S.SUCCESS], [S.EXECUTING, S.FAILED],
    ])('%s → %s allowed', (from, to) => { expect(() => svc().assertTransition(from, to)).not.toThrow(); });
    it.each([
      [S.EXECUTING, S.CANCELLED], [S.EXECUTING, S.REJECTED], [S.PENDING_APPROVAL, S.SUCCESS],
      [S.SUCCESS, S.FAILED], [S.FAILED, S.EXECUTING], [S.REJECTED, S.EXECUTING], [S.CANCELLED, S.PENDING_APPROVAL],
    ])('%s → %s rejected', (from, to) => { expect(() => svc().assertTransition(from, to)).toThrow(/Illegal internal transfer status transition/); });
  });

  describe('findBlockingBySource（垫款：按被退汇账单行）— blocks anything not yet finished or already succeeded; failed / rejected / cancelled do not block', () => {
    it('the query condition includes exactly these three statuses', async () => {
      const prisma = { internalTransfer: { findFirst: jest.fn(async ({ where }: any) => where) } };
      const where = await svc(prisma).findBlockingBySource({ sourceExternalLineId: 'line-1' });
      expect(where).toEqual({ sourceExternalLineId: 'line-1', status: { in: ['PENDING_APPROVAL', 'EXECUTING', 'SUCCESS'] } });
    });
  });

  // 戊波二 T7a（裁定 15）：认损补缺版——活单 / 已成功的单挡新单；「已记短缺却 FAILED」的单也挡（再开会记两次短缺）；
  // 记短缺前就失败 / 拒绝 / 撤回的单不挡。where 的形状是这条规矩在单测层唯一能锁的东西（真库行为归 e2e）。
  describe('findBlockingShortfallTopup — the blocking set for one difference row', () => {
    const whereOf = async (anchors: any) => {
      const prisma = { internalTransfer: { findFirst: jest.fn(async ({ where }: any) => where) } };
      return svc(prisma).findBlockingShortfallTopup(anchors);
    };
    it('matches either anchor of the row, only shortfall top-ups, and blocks on (live or succeeded) OR (FAILED with a recognition receipt)', async () => {
      const where: any = await whereOf({ explainedFlowId: 'flow-1', explainedExternalLineId: 'line-1' });
      expect(where.purpose).toBe('SHORTFALL_TOPUP');
      expect(where.OR).toEqual([{ explainedFlowId: 'flow-1' }, { explainedExternalLineId: 'line-1' }]);
      expect(where.AND).toEqual([{ OR: [
        { status: { in: ['PENDING_APPROVAL', 'EXECUTING', 'SUCCESS'] } },
        { status: 'FAILED', recognizedTbTransferId: { not: null } },
      ] }]);
    });
    it('a single anchor is enough; no anchor at all blocks nothing (and never queries)', async () => {
      expect(((await whereOf({ explainedFlowId: 'flow-1' })) as any).OR).toEqual([{ explainedFlowId: 'flow-1' }]);
      const prisma = { internalTransfer: { findFirst: jest.fn() } };
      expect(await svc(prisma).findBlockingShortfallTopup({})).toBeNull();
      expect(prisma.internalTransfer.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('create / stampRecognized', () => {
    it('create persists the shortfall anchors / loss source / business-day effective date and no longer has any sourceAdjustmentNo', async () => {
      const prisma = { internalTransfer: { create: jest.fn(async ({ data }: any) => ({ ...data, asset: {} })) } };
      const effectiveDate = new Date('2026-11-04T20:00:00.000Z');
      await svc(prisma).create({
        purpose: 'SHORTFALL_TOPUP', assetId: 'a-usdt', amountMajor: '7.5', fromWalletId: 'w-ops', viaWalletId: null, toWalletId: 'w-cust',
        customerId: 'uuid-cu', customerNo: 'CU1', reason: 'r', sourceCaseNo: 'REC1',
        explainedFlowId: 'flow-1', explainedExternalLineId: 'line-1', lossSource: 'AGING', sourceIncidentNo: null, effectiveDate,
        createdByUserId: 'ADM1',
      });
      const data = prisma.internalTransfer.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ purpose: 'SHORTFALL_TOPUP', explainedFlowId: 'flow-1', explainedExternalLineId: 'line-1', lossSource: 'AGING', sourceIncidentNo: null, effectiveDate, status: 'PENDING_APPROVAL' });
      expect(data).not.toHaveProperty('sourceAdjustmentNo');
    });
    it('stampRecognized writes the receipt id and the time on the transfer row', async () => {
      const prisma = { internalTransfer: { update: jest.fn(async () => ({})) } };
      await svc(prisma).stampRecognized('ITR1', 'abc123');
      expect(prisma.internalTransfer.update).toHaveBeenCalledWith({ where: { transferNo: 'ITR1' }, data: { recognizedTbTransferId: 'abc123', recognizedAt: expect.any(Date) } });
    });
  });

  describe('getView — Rule 6', () => {
    it('the projection carries no internal ids; the amount is formatted to precision; leg reference numbers are picked by asset type', async () => {
      const row = {
        id: 'uuid-itr', transferNo: 'ITR1', purpose: 'SHORTFALL_TOPUP', status: 'SUCCESS', customerId: 'uuid-cu', customerNo: 'CU1',
        asset: { code: 'USDT-TRON', currency: 'USDT', decimals: 6 }, amount: '7.5', reason: 'r', sourceCaseNo: 'REC1',
        sourceExternalLineId: 'uuid-line', explainedFlowId: 'uuid-flow', explainedExternalLineId: 'uuid-eline', recognizedTbTransferId: 'tb-hex', recognizedAt: new Date('2026-11-05T01:00:00Z'),
        effectiveDate: new Date('2026-11-04T20:00:00.000Z'), lossSource: 'INCIDENT', sourceIncidentNo: 'INC1',
        approvalNo: 'APR1', failureReasonCode: null, failureNote: null,
        fromWalletId: 'uuid-w1', viaWalletId: null, toWalletId: 'uuid-w2', createdByUserId: 'ADM1',
        createdAt: new Date('2026-09-05T00:00:00Z'), executedAt: null, settledAt: null,
      };
      const prisma = {
        internalTransfer: { findUnique: jest.fn(async () => row) },
        fundsOrder: { findMany: jest.fn(async () => [{ fundsOrderNo: 'FO1', legSeq: 1, status: 'CLEARED', txHash: '0xabc', referenceNo: null, fromWallet: { walletNo: 'WA1' }, toWallet: { walletNo: 'WA2' }, asset: { type: 'CRYPTO' } }]) },
        wallet: { findMany: jest.fn(async () => [{ id: 'uuid-w1', walletNo: 'WA1' }, { id: 'uuid-w2', walletNo: 'WA2' }]) },
        externalStatementLine: { findUnique: jest.fn(async () => ({ externalRef: 'BANK-REF-9' })) },
      };
      const view = await svc(prisma).getView('ITR1');
      const json = JSON.stringify(view);
      for (const forbidden of ['uuid-itr', 'uuid-cu', 'uuid-line', 'uuid-w1', 'uuid-w2', 'uuid-flow', 'uuid-eline', 'tb-hex']) expect(json).not.toContain(forbidden);
      expect(view).toMatchObject({
        transferNo: 'ITR1', amount: '7.500000', fromWalletNo: 'WA1', viaWalletNo: null, toWalletNo: 'WA2', sourceExternalRef: 'BANK-REF-9', legs: [{ fundsOrderNo: 'FO1', externalRef: '0xabc' }],
        // 戊波二：生效日是案件业务日（迪拜日），lossSource / 事故号 / 记短缺时刻随单下发（有 recognizedAt = 短缺已记）
        effectiveDate: '2026-11-05', lossSource: 'INCIDENT', sourceIncidentNo: 'INC1', recognizedAt: '2026-11-05T01:00:00.000Z',
      });
      expect(view).not.toHaveProperty('sourceAdjustmentNo');
    });
  });
});
