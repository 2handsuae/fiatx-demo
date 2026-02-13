import { Test, TestingModule } from '@nestjs/testing';
import { CustomersService, KycStatus } from './customers.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { NotificationsGateway } from '../../../core/notifications/notifications.gateway';

const mockPrismaService = {
  customerMain: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  customerAuditLog: {
    create: jest.fn(),
  },
  $transaction: jest.fn((promises) => Promise.all(promises)),
};

const mockNotificationsGateway = {
  notifyStatusChange: jest.fn(),
};

describe('CustomersService', () => {
  let service: CustomersService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: NotificationsGateway, useValue: mockNotificationsGateway },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('changeStatus', () => {
    it('should allow transition from EXPIRED to STANDARD_VERIFYING', async () => {
      const customerId = '123';
      const operatorId = 'op1';
      const mockCustomer = {
        id: customerId,
        authStatus: KycStatus.EXPIRED,
        authLevel: 'NONE',
        statusHistory: '[]',
        kycRecords: [],
        eddRecords: [],
      };

      mockPrismaService.customerMain.findUnique.mockResolvedValue(mockCustomer);
      mockPrismaService.customerMain.update.mockResolvedValue({
        ...mockCustomer,
        authStatus: KycStatus.STANDARD_VERIFYING,
      });

      const result = await service.changeStatus(
        customerId,
        KycStatus.STANDARD_VERIFYING,
        operatorId,
      );

      expect(result.authStatus).toBe(KycStatus.STANDARD_VERIFYING);
      expect(mockPrismaService.customerMain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: customerId },
          data: expect.objectContaining({
            authStatus: KycStatus.STANDARD_VERIFYING,
            authLevel: 'NONE',
          }),
        }),
      );
    });

    it('should allow transition from ENHANCED_REJECTED to ENHANCED_VERIFYING', async () => {
      const customerId = '123';
      const operatorId = 'op1';
      const mockCustomer = {
        id: customerId,
        authStatus: KycStatus.ENHANCED_REJECTED,
        authLevel: 'ENHANCED',
        statusHistory: '[]',
        kycRecords: [],
        eddRecords: [],
      };

      mockPrismaService.customerMain.findUnique.mockResolvedValue(mockCustomer);
      mockPrismaService.customerMain.update.mockResolvedValue({
        ...mockCustomer,
        authStatus: KycStatus.ENHANCED_VERIFYING,
      });

      const result = await service.changeStatus(
        customerId,
        KycStatus.ENHANCED_VERIFYING,
        operatorId,
      );

      expect(result.authStatus).toBe(KycStatus.ENHANCED_VERIFYING);
      expect(mockPrismaService.customerMain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: customerId },
          data: expect.objectContaining({
            authStatus: KycStatus.ENHANCED_VERIFYING,
            authLevel: 'ENHANCED',
          }),
        }),
      );
    });

    it('should throw error for invalid transition', async () => {
      const customerId = '123';
      const operatorId = 'op1';
      const mockCustomer = {
        id: customerId,
        authStatus: KycStatus.EXPIRED,
        authLevel: 'NONE',
        statusHistory: '[]',
        kycRecords: [],
        eddRecords: [],
      };

      mockPrismaService.customerMain.findUnique.mockResolvedValue(mockCustomer);

      await expect(
        service.changeStatus(
          customerId,
          KycStatus.STANDARD_APPROVED,
          operatorId,
        ),
      ).rejects.toThrow('Invalid transition from EXPIRED to STANDARD_APPROVED');
    });
  });
});
