import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WalletsController } from './wallets.controller';
import { WalletsService } from './wallets.service';
import { WalletQueryService } from './wallet-query.service';
import {
  CreateWalletDto,
  OwnerType,
  WalletDirection,
  WalletRole,
  WalletStatus,
  WalletType,
} from './dto/wallet.dto';

describe('WalletsController', () => {
  let controller: WalletsController;
  const serviceMock = {
    create: jest.fn(),
    changeStatus: jest.fn(),
  };
  const queryServiceMock = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findBalance: jest.fn(),
  };

  const customerReq = { user: { type: 'CUSTOMER', userId: 'cust-1' } };
  const adminReq = { user: { type: 'ADMIN', userId: 'admin-1' } };

  const createDto: CreateWalletDto = {
    ownerType: OwnerType.CUSTOMER,
    ownerId: 'cust-1',
    type: WalletType.CRYPTO_ADDRESS,
    direction: WalletDirection.INBOUND,
    assetId: 'asset-1',
  };

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

  it('should reject CUSTOMER creating PLATFORM wallet', () => {
    expect(() =>
      controller.create(customerReq, {
        ...createDto,
        ownerType: OwnerType.PLATFORM,
        ownerId: undefined,
      }),
    ).toThrow(ForbiddenException);
  });

  it('should reject CUSTOMER creating wallet for another ownerId', () => {
    expect(() =>
      controller.create(customerReq, {
        ...createDto,
        ownerId: 'cust-2',
      }),
    ).toThrow(ForbiddenException);
  });

  it('should reject CUSTOMER creating BIDIRECTIONAL wallet', () => {
    expect(() =>
      controller.create(customerReq, {
        ...createDto,
        direction: WalletDirection.BIDIRECTIONAL,
      }),
    ).toThrow(ForbiddenException);
  });

  it('should normalize CUSTOMER inbound create to undefined role (service resolves)', async () => {
    serviceMock.create.mockResolvedValue({ id: 'wallet-1' });

    await controller.create(customerReq, createDto);

    expect(serviceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        walletRole: undefined,
      }),
    );
  });

  it('should normalize CUSTOMER outbound create to C_OUT role', async () => {
    serviceMock.create.mockResolvedValue({ id: 'wallet-1' });

    await controller.create(customerReq, {
      ...createDto,
      direction: WalletDirection.OUTBOUND,
    });

    expect(serviceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        walletRole: WalletRole.C_OUT,
      }),
    );
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

  it('should allow ADMIN creating PLATFORM and LIQUIDITY_PROVIDER wallets', () => {
    serviceMock.create.mockResolvedValue({ id: 'wallet-1' });

    controller.create(adminReq, {
      ...createDto,
      ownerType: OwnerType.PLATFORM,
      ownerId: undefined,
    });
    controller.create(adminReq, {
      ...createDto,
      ownerType: OwnerType.LIQUIDITY_PROVIDER,
      ownerId: 'lp-1',
    });

    expect(serviceMock.create).toHaveBeenCalledTimes(2);
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
