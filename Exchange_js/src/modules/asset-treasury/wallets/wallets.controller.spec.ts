import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { WalletQueryService } from './wallet-query.service';
import {
  OwnerType,
  WalletStatus,
} from './dto/wallet.dto';

describe('WalletsController', () => {
  let controller: WalletsController;
  const serviceMock = {
    changeStatus: jest.fn(),
  };
  const queryServiceMock = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findBalance: jest.fn(),
  };

  const customerReq = { user: { type: 'CUSTOMER', userId: 'cust-1' } };
  const adminReq = { user: { type: 'ADMIN', userId: 'admin-1' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WalletsController],
      providers: [
        { provide: WalletsService, useValue: serviceMock },
        { provide: WalletQueryService, useValue: queryServiceMock },
      ],
    }).compile();

    controller = module.get<WalletsController>(WalletsController);
    jest.clearAllMocks();
  });

  it('should force CUSTOMER list query to self owner', async () => {
    queryServiceMock.findAll.mockResolvedValue({ items: [], total: 0 });

    await controller.findAll(
      customerReq,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(queryServiceMock.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerType: OwnerType.CUSTOMER,
          ownerId: 'cust-1',
        }),
      }),
    );
  });

  it('q → OR[walletNo/iban/address contains](三合一搜索)', async () => {
    queryServiceMock.findAll.mockResolvedValue({ items: [], total: 0 });

    await controller.findAll(
      adminReq,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'AE07',
    );

    expect(queryServiceMock.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { walletNo: { contains: 'AE07' } },
            { iban: { contains: 'AE07' } },
            { address: { contains: 'AE07' } },
          ],
        }),
      }),
    );
  });

  it('should reject CUSTOMER querying other ownerId', () => {
    expect(() =>
      controller.findAll(
        customerReq,
        undefined,
        undefined,
        undefined,
        'cust-2',
        undefined,
        undefined,
        undefined,
      ),
    ).toThrow(ForbiddenException);
  });

  it('should reject CUSTOMER querying non-CUSTOMER ownerType', () => {
    expect(() =>
      controller.findAll(
        customerReq,
        undefined,
        undefined,
        OwnerType.PLATFORM,
        undefined,
        undefined,
        undefined,
        undefined,
      ),
    ).toThrow(ForbiddenException);
  });

  it('should reject CUSTOMER changing wallet status', () => {
    expect(() =>
      controller.changeStatus(customerReq, 'wallet-1', {
        status: WalletStatus.DISABLED,
      }),
    ).toThrow(ForbiddenException);
  });

  it('should reject CUSTOMER reading wallet not owned by self', async () => {
    queryServiceMock.findOne.mockResolvedValue({
      id: 'wallet-2',
      ownerType: OwnerType.CUSTOMER,
      ownerId: 'cust-2',
    });

    await expect(controller.findOne(customerReq, 'wallet-2')).rejects.toThrow(
      ForbiddenException,
    );
  });
});
