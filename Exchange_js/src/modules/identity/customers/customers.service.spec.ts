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

  it('findOne queries the plain row without relation includes', async () => {
    // 2026-09-03 客户域业务号化：latestRiskApproval include 随死 UI 段退役摘除，
    // 详情就是主档一行。
    mockPrismaService.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
    });

    const customer = await service.findOne('c1');

    expect(mockPrismaService.customerMain.findUnique).toHaveBeenCalledWith({
      where: { id: 'c1' },
    });
    expect((customer as any)?.id).toBe('c1');
  });

  it('findByCustomerNo resolves by the business key (铁律⑥ controller 换号入口)', async () => {
    mockPrismaService.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      customerNo: 'CUS-0001',
    });

    const customer = await service.findByCustomerNo('CUS-0001');

    expect(mockPrismaService.customerMain.findUnique).toHaveBeenCalledWith({
      where: { customerNo: 'CUS-0001' },
    });
    expect((customer as any)?.id).toBe('c1');
  });
});
