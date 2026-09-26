import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AdminSumsubSimulationController } from './admin-sumsub-simulation.controller';
import { SumsubIngestionService } from './sumsub-ingestion.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { MaterialRequestsService } from '../identity/material-requests/material-requests.service';
import { CustomerRestrictionWorkflowService } from '../identity/customers/customer-restriction-workflow.service';
import { CustomerRestrictionsService } from '../identity/customers/customer-restrictions.service';

const ADMIN_REQ = {
  user: { type: 'ADMIN', userId: 'admin-1', userNo: 'U0001', role: 'COMPLIANCE_OFFICER', roleCodes: ['COMPLIANCE_OFFICER'] },
};
const CUSTOMER_REQ = { user: { type: 'CUSTOMER', userId: 'cust-1' } };

/**
 * 战役甲波三 T7：⚡ EOCN 存量命中端点。只测新端点 simulateEocnSanctionsHit——
 * 文件内其余四个端点（applicant-action-result 等）已在集成/走查里覆盖,本任务不重测。
 */
describe('AdminSumsubSimulationController — EOCN 存量命中 (T7)', () => {
  let controller: AdminSumsubSimulationController;
  let prisma: { customerMain: { findFirst: jest.Mock } };
  let restrictions: { findOpenByCause: jest.Mock };
  let restrictionWorkflow: { openRestriction: jest.Mock };

  beforeEach(async () => {
    prisma = {
      customerMain: {
        findFirst: jest.fn().mockResolvedValue({ id: 'cust-uuid-1', lifecycle: 'ACTIVE' }),
      },
    };
    restrictions = {
      findOpenByCause: jest.fn().mockResolvedValue(null),
    };
    restrictionWorkflow = {
      openRestriction: jest.fn().mockResolvedValue({ restrictionNo: 'RST-1', created: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminSumsubSimulationController],
      providers: [
        { provide: SumsubIngestionService, useValue: { ingest: jest.fn() } },
        { provide: PrismaService, useValue: prisma },
        { provide: MaterialRequestsService, useValue: { findByNo: jest.fn() } },
        { provide: CustomerRestrictionWorkflowService, useValue: restrictionWorkflow },
        { provide: CustomerRestrictionsService, useValue: restrictions },
      ],
    }).compile();

    controller = module.get(AdminSumsubSimulationController);
  });

  afterEach(() => jest.clearAllMocks());

  it('命中成功：ACTIVE 客户、无重复便签 → 经 openRestriction() 贴 SANCTION 便签,reason 带 listRef,actor 为真实点击者', async () => {
    const result = await controller.simulateEocnSanctionsHit(ADMIN_REQ, {
      customerNo: 'C0001',
      listRef: 'EOCN-ENTRY-42',
    });

    expect(result).toEqual({
      restrictionNo: 'RST-1',
      created: true,
      customerNo: 'C0001',
      cause: 'SANCTION',
      listRef: 'EOCN-ENTRY-42',
    });

    expect(prisma.customerMain.findFirst).toHaveBeenCalledWith({
      where: { customerNo: 'C0001' },
      select: { id: true, lifecycle: true },
    });
    expect(restrictions.findOpenByCause).toHaveBeenCalledWith('cust-uuid-1', 'SANCTION', null);

    // 经 openRestriction() 正门，不是裸 open()；cause/reason 携带 listRef 供后续
    // 定性开单人工抄作 externalCaseRef。
    expect(restrictionWorkflow.openRestriction).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust-uuid-1',
        cause: 'SANCTION',
        reason: expect.stringContaining('EOCN-ENTRY-42'),
        caseRef: 'EOCN-ENTRY-42',
      }),
      // ⚡ actor 惯例：actor 是真实点击 ⚡ 按钮的 admin（req.user 投影），不是
      // SYSTEM/KYT_VERDICT 之类的内部占位符 —— openRestriction() 的
      // CUSTOMER_RESTRICTION_ADDED/CUSTOMER_FROZEN 审计据此落到这个 actor 头上。
      expect.objectContaining({
        actorType: 'ADMIN',
        userId: 'admin-1',
        userNo: 'U0001',
        role: 'COMPLIANCE_OFFICER',
        roleCodes: ['COMPLIANCE_OFFICER'],
      }),
    );
  });

  it('客户不 ACTIVE → 400,且不进 workflow', async () => {
    prisma.customerMain.findFirst.mockResolvedValue({ id: 'cust-uuid-1', lifecycle: 'IN_VERIFICATION' });

    await expect(
      controller.simulateEocnSanctionsHit(ADMIN_REQ, { customerNo: 'C0002', listRef: 'EOCN-1' }),
    ).rejects.toThrow(BadRequestException);
    expect(restrictions.findOpenByCause).not.toHaveBeenCalled();
    expect(restrictionWorkflow.openRestriction).not.toHaveBeenCalled();
  });

  it('客户不存在 → 404', async () => {
    prisma.customerMain.findFirst.mockResolvedValue(null);

    await expect(
      controller.simulateEocnSanctionsHit(ADMIN_REQ, { customerNo: 'C-GHOST', listRef: 'EOCN-1' }),
    ).rejects.toThrow(NotFoundException);
    expect(restrictionWorkflow.openRestriction).not.toHaveBeenCalled();
  });

  it('已有 OPEN 的 SANCTION 便签 → 409 明确拒绝（不是 open() 的静默幂等）,不进 workflow', async () => {
    restrictions.findOpenByCause.mockResolvedValue({ restrictionNo: 'RST-EXISTING' });

    await expect(
      controller.simulateEocnSanctionsHit(ADMIN_REQ, { customerNo: 'C0001', listRef: 'EOCN-2' }),
    ).rejects.toThrow(ConflictException);
    expect(restrictionWorkflow.openRestriction).not.toHaveBeenCalled();
  });

  it('缺 listRef → 400,且不查客户', async () => {
    await expect(
      controller.simulateEocnSanctionsHit(ADMIN_REQ, { customerNo: 'C0001', listRef: '' }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.customerMain.findFirst).not.toHaveBeenCalled();
  });

  it('非 ADMIN token → 403,且不落任何 DB 查询/workflow 调用（防 fail-open 回归）', async () => {
    await expect(
      controller.simulateEocnSanctionsHit(CUSTOMER_REQ, { customerNo: 'C0001', listRef: 'EOCN-1' }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.customerMain.findFirst).not.toHaveBeenCalled();
    expect(restrictionWorkflow.openRestriction).not.toHaveBeenCalled();
  });
});
