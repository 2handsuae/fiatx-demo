import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  ValidationPipe,
} from '@nestjs/common';
import { CustomerRestrictionsAdminController } from './customer-restrictions.admin.controller';
import { CustomerRestrictionsService } from './customer-restrictions.service';
import { CustomerRestrictionWorkflowService } from './customer-restriction-workflow.service';
import { SanctionDispositionWorkflowService } from './sanction-disposition-workflow.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { OpenRestrictionDto } from './dto/customer-restriction.dto';

const ADMIN_REQ = {
  user: { type: 'ADMIN', userId: 'admin-1', userNo: 'U0001', role: 'MLRO', roleCodes: ['MLRO'] },
};
const CUSTOMER_REQ = { user: { type: 'CUSTOMER', userId: 'cust-1' } };

describe('CustomerRestrictionsAdminController', () => {
  let controller: CustomerRestrictionsAdminController;
  let restrictions: { listAll: jest.Mock; findByNo: jest.Mock };
  let workflow: { openRestriction: jest.Mock; initiateRelease: jest.Mock };
  let dispositionWorkflow: { initiateDisposition: jest.Mock };
  let prisma: { customerMain: { findFirst: jest.Mock } };

  beforeEach(async () => {
    restrictions = {
      listAll: jest.fn().mockResolvedValue([]),
      findByNo: jest.fn().mockResolvedValue({ restrictionNo: 'RST-1', customerId: 'cust-1' }),
    };
    workflow = {
      openRestriction: jest.fn().mockResolvedValue({ restrictionNo: 'RST-1', created: true }),
      initiateRelease: jest.fn().mockResolvedValue({ approvalNo: 'APR-1' }),
    };
    dispositionWorkflow = {
      initiateDisposition: jest.fn().mockResolvedValue({ approvalNo: 'APR-SD-1', restrictionNo: 'RST-1' }),
    };
    prisma = { customerMain: { findFirst: jest.fn().mockResolvedValue({ id: 'cust-1' }) } };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomerRestrictionsAdminController],
      providers: [
        { provide: CustomerRestrictionsService, useValue: restrictions },
        { provide: CustomerRestrictionWorkflowService, useValue: workflow },
        { provide: SanctionDispositionWorkflowService, useValue: dispositionWorkflow },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    controller = module.get(CustomerRestrictionsAdminController);
  });

  afterEach(() => jest.clearAllMocks());

  // ── 防 fail-open 回归 ──────────────────────────────
  // AdminPermissionGuard 对非 ADMIN token 直接 return true
  // (admin-permission.guard.ts:61)，客户 JWT 打 admin 路由靠 guard 是拦不住的。
  // 三个 handler 各自 assertAdmin，且必须发生在任何 DB 读之前。
  describe('non-ADMIN token 打 admin 端点', () => {
    it('GET 列表 → 403，且不落任何 DB 查询', async () => {
      await expect(controller.list(CUSTOMER_REQ, 'C0001')).rejects.toThrow(ForbiddenException);
      expect(prisma.customerMain.findFirst).not.toHaveBeenCalled();
      expect(restrictions.listAll).not.toHaveBeenCalled();
    });

    it('POST 建限制 → 403，且不进 workflow', async () => {
      await expect(
        controller.open(CUSTOMER_REQ, 'C0001', {
          cause: 'ADMIN_SUSPENSION',
          reason: 'x',
        } as OpenRestrictionDto),
      ).rejects.toThrow(ForbiddenException);
      expect(workflow.openRestriction).not.toHaveBeenCalled();
    });

    it('POST 解除 → 403，且不开审批案', async () => {
      await expect(
        controller.release(CUSTOMER_REQ, 'C0001', 'RST-1', { reason: 'x' }),
      ).rejects.toThrow(ForbiddenException);
      expect(workflow.initiateRelease).not.toHaveBeenCalled();
    });

    it('POST 制裁定性 → 403，且不进 workflow', async () => {
      await expect(
        controller.submitSanctionDisposition(CUSTOMER_REQ, 'C0001', {
          outcome: 'CLEARED',
          summary: 'x',
          externalCaseRef: 'EOCN_1',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(dispositionWorkflow.initiateDisposition).not.toHaveBeenCalled();
    });
  });

  describe('制裁定性提单', () => {
    it('转发 outcome/summary/externalCaseRef 与 actor，回传 workflow 的结果', async () => {
      const result = await controller.submitSanctionDisposition(ADMIN_REQ, 'C0001', {
        outcome: 'PARTIAL',
        summary: 'partial match, needs ID',
        externalCaseRef: 'EOCN_ENTRY_1',
      });

      expect(result).toEqual({ approvalNo: 'APR-SD-1', restrictionNo: 'RST-1' });
      expect(dispositionWorkflow.initiateDisposition).toHaveBeenCalledWith(
        'C0001',
        'PARTIAL',
        'partial match, needs ID',
        'EOCN_ENTRY_1',
        expect.objectContaining({ actorType: 'ADMIN', userId: 'admin-1', roleCodes: ['MLRO'] }),
      );
    });
  });

  // ── 入参校验 ──────────────────────────────────────
  // 全局 ValidationPipe(main.ts:38) 只有 whitelist，多余键被静默剥掉而非 400；
  // 这两个 POST 单独挂 forbidNonWhitelisted 的管子，这里直接对管子断言。
  describe('body 校验（forbidNonWhitelisted 管子）', () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const meta = { type: 'body' as const, metatype: OpenRestrictionDto, data: '' };

    it('body 带 visibility → 400（策略表说了算，不许调用方指定）', async () => {
      await expect(
        pipe.transform(
          { cause: 'ADMIN_SUSPENSION', reason: 'x', visibility: 'DISCLOSED' },
          meta,
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('body 带 releasePolicy → 400', async () => {
      await expect(
        pipe.transform(
          { cause: 'ADMIN_SUSPENSION', reason: 'x', releasePolicy: 'OPS_APPROVAL' },
          meta,
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('干净 body 过管子', async () => {
      await expect(
        pipe.transform({ cause: 'PENDING_DOCUMENT', reason: 'x', scopes: ['WITHDRAW'] }, meta),
      ).resolves.toMatchObject({ cause: 'PENDING_DOCUMENT', scopes: ['WITHDRAW'] });
    });
  });

  describe('scopes 只在 scopeSelectable 的 cause 上接受', () => {
    it('cause=SANCTION 带 scopes → 400（scopeSelectable=false）', async () => {
      await expect(
        controller.open(ADMIN_REQ, 'C0001', {
          cause: 'SANCTION',
          scopes: ['WITHDRAW'],
          reason: 'OFAC hit',
        } as OpenRestrictionDto),
      ).rejects.toThrow(BadRequestException);
      expect(workflow.openRestriction).not.toHaveBeenCalled();
    });

    it('cause=PENDING_DOCUMENT 带 scopes → 放行，原样透传给 workflow', async () => {
      const result = await controller.open(ADMIN_REQ, 'C0001', {
        cause: 'PENDING_DOCUMENT',
        scopes: ['WITHDRAW'],
        reason: 'passport expired',
      } as OpenRestrictionDto);

      expect(result).toEqual({ restrictionNo: 'RST-1', created: true });
      expect(workflow.openRestriction).toHaveBeenCalledWith(
        {
          customerId: 'cust-1',
          cause: 'PENDING_DOCUMENT',
          scopes: ['WITHDRAW'],
          reason: 'passport expired',
          caseRef: null,
          openedBy: 'U0001',
        },
        expect.objectContaining({ actorType: 'ADMIN', userId: 'admin-1', roleCodes: ['MLRO'] }),
      );
    });

    it('cause=SANCTION 不带 scopes → 放行，scopes 传 undefined 由策略表兜底', async () => {
      await controller.open(ADMIN_REQ, 'C0001', {
        cause: 'SANCTION',
        reason: 'OFAC hit',
      } as OpenRestrictionDto);

      expect(workflow.openRestriction).toHaveBeenCalledWith(
        expect.objectContaining({ cause: 'SANCTION', scopes: undefined }),
        expect.anything(),
      );
    });
  });

  describe('路径参数用业务键', () => {
    it('GET 用 customerNo 解析出 customerId 再查 domain service', async () => {
      await controller.list(ADMIN_REQ, 'C0001');
      expect(prisma.customerMain.findFirst).toHaveBeenCalledWith({
        where: { customerNo: 'C0001' },
        select: { id: true },
      });
      expect(restrictions.listAll).toHaveBeenCalledWith('cust-1');
    });

    it('release 拒绝张冠李戴的 restrictionNo（不属于该客户 → 404）', async () => {
      restrictions.findByNo.mockResolvedValue({ restrictionNo: 'RST-9', customerId: 'other' });
      await expect(
        controller.release(ADMIN_REQ, 'C0001', 'RST-9', { reason: 'cleared' }),
      ).rejects.toThrow(/not found/);
      expect(workflow.initiateRelease).not.toHaveBeenCalled();
    });

    it('release 校验通过 → 开审批案，返回 approvalNo', async () => {
      const result = await controller.release(ADMIN_REQ, 'C0001', 'RST-1', {
        reason: 'cleared',
        releaseOrderRef: 'MLRO-ORDER-7',
      });
      expect(result).toEqual({ approvalNo: 'APR-1' });
      expect(workflow.initiateRelease).toHaveBeenCalledWith(
        'RST-1',
        { reason: 'cleared', releaseOrderRef: 'MLRO-ORDER-7' },
        expect.objectContaining({ actorType: 'ADMIN', userId: 'admin-1' }),
      );
    });
  });
});
