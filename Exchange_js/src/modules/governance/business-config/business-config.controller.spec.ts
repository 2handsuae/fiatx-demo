import { Test, TestingModule } from '@nestjs/testing';
import { BusinessConfigController } from './business-config.controller';
import { BusinessConfigService } from './business-config.service';

describe('BusinessConfigController', () => {
  let controller: BusinessConfigController;

  const businessConfigService = {
    listReleases: jest.fn(),
    getReleaseByNo: jest.fn(),
    getReleaseDiff: jest.fn(),
    listRevisions: jest.fn(),
    getRevisionById: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BusinessConfigController],
      providers: [{ provide: BusinessConfigService, useValue: businessConfigService }],
    }).compile();

    controller = module.get<BusinessConfigController>(BusinessConfigController);
    jest.clearAllMocks();
  });

  it('delegates release and revision read-only queries', async () => {
    businessConfigService.listReleases.mockResolvedValue({ items: [], total: 0 });
    businessConfigService.getReleaseByNo.mockResolvedValue({ releaseNo: 'COA-REL-001' });
    businessConfigService.getReleaseDiff.mockResolvedValue({ items: [] });
    businessConfigService.listRevisions.mockResolvedValue({ items: [], total: 0 });
    businessConfigService.getRevisionById.mockResolvedValue({ id: 'revision-1' });

    await controller.listReleases({ subjectType: 'COA', take: 20 } as any);
    await controller.getRelease('COA-REL-001');
    await controller.getReleaseDiff('COA-REL-001');
    await controller.listRevisions({ subjectType: 'COA', businessKey: 'A.CUSTODY' } as any);
    await controller.getRevision('revision-1');

    expect(businessConfigService.listReleases).toHaveBeenCalledWith({
      subjectType: 'COA',
      take: 20,
    });
    expect(businessConfigService.getReleaseByNo).toHaveBeenCalledWith('COA-REL-001');
    expect(businessConfigService.getReleaseDiff).toHaveBeenCalledWith('COA-REL-001');
    expect(businessConfigService.listRevisions).toHaveBeenCalledWith({
      subjectType: 'COA',
      businessKey: 'A.CUSTODY',
    });
    expect(businessConfigService.getRevisionById).toHaveBeenCalledWith('revision-1');
  });
});
