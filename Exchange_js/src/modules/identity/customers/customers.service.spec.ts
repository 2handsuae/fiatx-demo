import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CustomersService } from './customers.service';

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
      ],
    }).compile();

    service = module.get<CustomersService>(CustomersService);
    (service as any).auditLogsService = auditLogsServiceMock;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('findOne should query supported relations without wallets include', async () => {
    mockPrismaService.customerMain.findUnique.mockResolvedValue({ id: 'c1' });

    await service.findOne('c1');

    expect(mockPrismaService.customerMain.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        include: expect.objectContaining({
          corporateProfile: true,
          uboProfiles: expect.any(Object),
          cddResponses: expect.any(Object),
          eddResponses: expect.any(Object),
          onboardingAuditLogs: expect.any(Object),
        }),
      }),
    );

    const query = mockPrismaService.customerMain.findUnique.mock.calls[0][0];
    expect(query.include.wallets).toBeUndefined();
  });
});
