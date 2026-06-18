import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CustomersService } from './customers.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';

const mockPrismaService = {
  customerMain: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

const auditLogsServiceMock = {
  recordSystem: jest.fn(),
};

describe('CustomersService', () => {
  let service: CustomersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AuditLogsService, useValue: auditLogsServiceMock },
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('findOne should query supported relations without wallets include', async () => {
    mockPrismaService.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
    });

    const customer = await service.findOne('c1');

    expect(mockPrismaService.customerMain.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        include: expect.objectContaining({
          corporateProfile: true,
          uboProfiles: expect.any(Object),
        }),
      }),
    );

    const query = mockPrismaService.customerMain.findUnique.mock.calls[0][0];
    expect(query.include.wallets).toBeUndefined();
    expect(query.include.onboardingAuditLogs).toBeUndefined();
    expect(query.include.cddResponses).toBeUndefined();
    expect((customer as any)?.id).toBe('c1');
  });
});
