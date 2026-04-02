import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { GovernanceRegistriesController } from './governance-registries.controller';
import { GovernanceRegistriesService } from './governance-registries.service';

describe('GovernanceRegistriesController', () => {
  let controller: GovernanceRegistriesController;

  const governanceRegistriesService = {
    createShareholdingVersion: jest.fn(),
    listShareholdingVersions: jest.fn(),
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
      controllers: [GovernanceRegistriesController],
      providers: [
        {
          provide: GovernanceRegistriesService,
          useValue: governanceRegistriesService,
        },
      ],
    }).compile();

    controller = module.get<GovernanceRegistriesController>(
      GovernanceRegistriesController,
    );
    jest.clearAllMocks();
  });

  it('delegates shareholding creation with admin actor context', async () => {
    governanceRegistriesService.createShareholdingVersion.mockResolvedValue({
      id: 'shr-1',
    });

    await controller.createShareholdingVersion(adminReq, {
      versionLabel: '2026-Q2',
    } as any);

    expect(
      governanceRegistriesService.createShareholdingVersion,
    ).toHaveBeenCalledWith(
      { versionLabel: '2026-Q2' },
      {
        actorType: 'ADMIN',
        userId: 'admin-1',
        userNo: 'ADM-001',
        role: 'SUPER_ADMIN',
        roleCodes: ['SUPER_ADMIN'],
      },
    );
  });

  it('rejects non-admin governance registry access', () => {
    expect(() => controller.listShareholdingVersions(customerReq, {} as any)).toThrow(
      ForbiddenException,
    );
  });
});
