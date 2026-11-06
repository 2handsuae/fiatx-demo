import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HouseTransferService } from './house-transfer.service';
import { HouseTransferStatus as S } from './dto/house-transfer.dto';
import { HOUSE_TRANSFER_TRANSITIONS } from './constants/house-transfer-transitions.constant';

const ASSET = { id: 'a-aed', code: 'AED', currency: 'AED', decimals: 2, type: 'FIAT' };
const FEE = { id: 'w-fee', walletNo: 'WA-FEE', vaultCode: 'F_FEE', address: null, iban: 'AE-FEE' };
const OPS = { id: 'w-ops', walletNo: 'WA-OPS', vaultCode: 'F_OPS', address: null, iban: 'AE-OPS' };

function makeService(row: any = null) {
  const store: { row: any } = { row };
  const prisma: any = {
    houseTransfer: {
      create: jest.fn(async ({ data }: any) => { store.row = { id: 'uuid-htr', createdAt: new Date('2026-11-07T00:00:00Z'), ...data, asset: ASSET }; return store.row; }),
      findUnique: jest.fn(async ({ where }: any) => (store.row && (where.transferNo ? store.row.transferNo === where.transferNo : store.row.id === where.id) ? store.row : null)),
      update: jest.fn(async ({ data }: any) => { store.row = { ...store.row, ...data }; return store.row; }),
      findMany: jest.fn(async () => (store.row ? [store.row] : [])),
      count: jest.fn(async () => (store.row ? 1 : 0)),
    },
    wallet: { findMany: jest.fn(async () => [FEE, OPS]) },
    fundsOrder: { findMany: jest.fn(async () => []) },
  };
  return { svc: new HouseTransferService(prisma), prisma, store };
}

const baseRow = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 'uuid-htr', transferNo: 'HTR1', purpose: 'FEE_SWEEP', assetId: ASSET.id, asset: ASSET, amount: new Prisma.Decimal('12.5'),
  fromWalletId: FEE.id, toWalletId: OPS.id, reason: 'sweep', status, approvalNo: 'APR1', fundsOrderNo: null, closeTbTransferIds: null,
  failureReasonCode: null, failureNote: null, executedAt: null, settledAt: null, traceId: 't1', createdByUserId: 'u1', createdAt: new Date('2026-11-07T00:00:00Z'), ...extra,
});

describe('HouseTransferService（戊波二 T5）', () => {
  describe('迁移表：六态六边（抄划转单原样）', () => {
    it('表本身锁死：待批 → 执行中 / 失败 / 拒绝 / 撤回，执行中 → 成功 / 失败，四个终态零出边', () => {
      expect(HOUSE_TRANSFER_TRANSITIONS).toEqual({
        PENDING_APPROVAL: ['EXECUTING', 'FAILED', 'REJECTED', 'CANCELLED'],
        EXECUTING: ['SUCCESS', 'FAILED'],
        SUCCESS: [], FAILED: [], REJECTED: [], CANCELLED: [],
      });
    });
    it.each([
      [S.PENDING_APPROVAL, S.EXECUTING], [S.PENDING_APPROVAL, S.FAILED], [S.PENDING_APPROVAL, S.REJECTED], [S.PENDING_APPROVAL, S.CANCELLED],
      [S.EXECUTING, S.SUCCESS], [S.EXECUTING, S.FAILED],
    ])('合法边 %s → %s 放行', (from, to) => {
      expect(() => makeService().svc.assertTransition(from, to)).not.toThrow();
    });
    it.each([
      [S.PENDING_APPROVAL, S.SUCCESS], // 不能跳过执行
      [S.EXECUTING, S.CANCELLED], // 执行中钱已在路上，不许撤回
      [S.EXECUTING, S.REJECTED],
      [S.EXECUTING, S.PENDING_APPROVAL],
      [S.SUCCESS, S.EXECUTING], [S.SUCCESS, S.FAILED], [S.FAILED, S.EXECUTING], [S.REJECTED, S.EXECUTING], [S.CANCELLED, S.PENDING_APPROVAL],
    ])('非法边 %s → %s 显式拒绝', (from, to) => {
      expect(() => makeService().svc.assertTransition(from, to)).toThrow(BadRequestException);
      expect(() => makeService().svc.assertTransition(from, to)).toThrow(/Illegal house transfer status transition/);
    });
    it('transition() 先过迁移表再写库：非法边不落库', async () => {
      const { svc, prisma } = makeService(baseRow(S.SUCCESS));
      await expect(svc.transition('HTR1', S.EXECUTING)).rejects.toThrow(/Illegal house transfer status transition: SUCCESS → EXECUTING/);
      expect(prisma.houseTransfer.update).not.toHaveBeenCalled();
    });
    it('transition() 合法边：写新状态 + patch，返回带资产与两只钱包的行', async () => {
      const { svc, prisma } = makeService(baseRow(S.EXECUTING));
      const out = await svc.transition('HTR1', S.SUCCESS, { settledAt: new Date('2026-11-07T01:00:00Z'), closeTbTransferIds: '["aa"]' });
      expect(prisma.houseTransfer.update).toHaveBeenCalledWith(expect.objectContaining({ where: { transferNo: 'HTR1' }, data: expect.objectContaining({ status: 'SUCCESS', closeTbTransferIds: '["aa"]' }) }));
      expect(out.status).toBe('SUCCESS');
      expect(out.fromWallet?.walletNo).toBe('WA-FEE');
      expect(out.toWallet?.vaultCode).toBe('F_OPS');
    });
  });

  describe('stampFailure（落账失败：状态不动，只记原因）', () => {
    it('只写 failureReasonCode / failureNote，不改 status', async () => {
      const { svc, prisma } = makeService(baseRow(S.EXECUTING));
      await svc.stampFailure('HTR1', 'POSTING_FAILED', 'rejected by ledger');
      expect(prisma.houseTransfer.update).toHaveBeenCalledWith({ where: { transferNo: 'HTR1' }, data: { failureReasonCode: 'POSTING_FAILED', failureNote: 'rejected by ledger' } });
    });
  });

  describe('create', () => {
    const input = { purpose: 'FEE_SWEEP', assetId: ASSET.id, amount: '12.5', fromWalletId: FEE.id, toWalletId: OPS.id, reason: 'sweep fees', createdByUserId: 'ADM-TRE' };
    it('单号前缀 HTR、出生即待审批、金额存 Decimal（元）、traceId 自铸', async () => {
      const { svc, prisma } = makeService();
      const row = await svc.create(input);
      const data = prisma.houseTransfer.create.mock.calls[0][0].data;
      expect(data.transferNo).toMatch(/^HTR\d{12}$/);
      expect(data.status).toBe('PENDING_APPROVAL');
      expect(new Prisma.Decimal(data.amount).toFixed(2)).toBe('12.50');
      expect(data).toMatchObject({ purpose: 'FEE_SWEEP', assetId: ASSET.id, fromWalletId: FEE.id, toWalletId: OPS.id, createdByUserId: 'ADM-TRE' });
      expect(typeof data.traceId).toBe('string');
      expect(row.fromWallet?.walletNo).toBe('WA-FEE');
    });
    it('金额必须大于 0（挪 0 块钱不是业务）', async () => {
      const { svc, prisma } = makeService();
      await expect(svc.create({ ...input, amount: '0' })).rejects.toThrow(/amount must be greater than zero/);
      expect(prisma.houseTransfer.create).not.toHaveBeenCalled();
    });
  });

  describe('读', () => {
    it('findByNo 找不到 → 404', async () => {
      await expect(makeService().svc.findByNo('HTR404')).rejects.toBeInstanceOf(NotFoundException);
    });
    it('getView：投影只有业务键（无 id / walletId / assetId），closeTbTransferIds 解成数组，腿带 walletNo', async () => {
      const row = baseRow(S.SUCCESS, { fundsOrderNo: 'FDO1', closeTbTransferIds: JSON.stringify(['aa', 'bb']), settledAt: new Date('2026-11-07T01:00:00Z') });
      const { svc, prisma } = makeService(row);
      prisma.fundsOrder.findMany.mockResolvedValueOnce([{ fundsOrderNo: 'FDO1', legSeq: 1, status: 'CLEARED', fromWallet: { walletNo: 'WA-FEE' }, toWallet: { walletNo: 'WA-OPS' }, asset: { type: 'FIAT' }, txHash: null, referenceNo: 'BANKREF' }]);
      const view = await svc.getView('HTR1');
      expect(view).toMatchObject({
        transferNo: 'HTR1', purpose: 'FEE_SWEEP', amount: '12.50', currency: 'AED', status: 'SUCCESS', approvalNo: 'APR1',
        fromWalletNo: 'WA-FEE', fromVaultCode: 'F_FEE', toWalletNo: 'WA-OPS', toVaultCode: 'F_OPS',
        fundsOrderNo: 'FDO1', closeTbTransferIds: ['aa', 'bb'], failureReasonCode: null,
      });
      expect(view.legs).toEqual([{ fundsOrderNo: 'FDO1', legSeq: 1, status: 'CLEARED', fromWalletNo: 'WA-FEE', toWalletNo: 'WA-OPS', externalRef: 'BANKREF' }]);
      const json = JSON.stringify(view);
      for (const forbidden of ['uuid-htr', 'w-fee', 'w-ops', 'a-aed']) expect(json).not.toContain(forbidden);
    });
    it('没结转的单：closeTbTransferIds 是空数组', async () => {
      const { svc } = makeService(baseRow(S.PENDING_APPROVAL));
      expect((await svc.getView('HTR1')).closeTbTransferIds).toEqual([]);
    });
    it('list：按状态 / 用途过滤，分页，返回投影', async () => {
      const { svc, prisma } = makeService(baseRow(S.PENDING_APPROVAL));
      const out = await svc.list({ status: S.PENDING_APPROVAL, purpose: 'FEE_SWEEP', skip: 5, take: 10 });
      expect(prisma.houseTransfer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'PENDING_APPROVAL', purpose: 'FEE_SWEEP' }, skip: 5, take: 10 }));
      expect(out.total).toBe(1);
      expect(out.items[0].transferNo).toBe('HTR1');
    });
  });
});
