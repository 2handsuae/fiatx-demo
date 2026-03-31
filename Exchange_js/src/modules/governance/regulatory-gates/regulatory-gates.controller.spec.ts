import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RegulatoryGatesController } from './regulatory-gates.controller';
import { RegulatoryGatesService } from './regulatory-gates.service';

describe('RegulatoryGatesController', () => {
  let controller: RegulatoryGatesController;

  const regulatoryGatesService = {
    create: jest.fn(),
    list: jest.fn(),
  };

  const adminReq = {
    user: {
      type: 'ADMIN',
      userId: 'admin-1',
      userNo: 'ADM-001',
      role: 'SUPER_ADMIN',
      roleCodes: ['SUPER_ADMIN'],
    },
  };
  const customerReq = { user: { type: 'CUSTOMER', userId: 'cust-1' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RegulatoryGatesController],
      providers: [
        {
          provide: RegulatoryGatesService,
          useValue: regulatoryGatesService,
        },
      ],
    }).compile();

    controller = module.get<RegulatoryGatesController>(RegulatoryGatesController);
    jest.clearAllMocks();
  });

  it('delegates create with admin actor context', async () => {
    regulatoryGatesService.create.mockResolvedValue({ id: 'gate-1' });

    await controller.create(adminReq, {
      gateType: 'CONTROL_CHANGE',
      shareholdingRegistryVersionId: 'shr-1',
    } as any);

    expect(regulatoryGatesService.create).toHaveBeenCalledWith(
      {
        gateType: 'CONTROL_CHANGE',
        shareholdingRegistryVersionId: 'shr-1',
      },
      {
        actorType: 'ADMIN',
        userId: 'admin-1',
        userNo: 'ADM-001',
        role: 'SUPER_ADMIN',
        roleCodes: ['SUPER_ADMIN'],
      },
    );
  });

  it('rejects non-admin regulatory gate access', () => {
    expect(() => controller.list(customerReq, {} as any)).toThrow(ForbiddenException);
  });
});
