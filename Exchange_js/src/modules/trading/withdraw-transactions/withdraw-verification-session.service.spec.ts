import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { WithdrawVerificationSessionService } from './withdraw-verification-session.service';
import { WithdrawApplicantActionsService } from './withdraw-applicant-actions.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { SumsubClient } from '../../identity/onboarding/providers/sumsub/sumsub.client';

const ROW = (over: any = {}) => ({
  id: 'w-1', withdrawNo: 'WDR1', ownerType: 'CUSTOMER', ownerId: 'cust-1',
  traceId: 't-1', status: 'ACTION_PENDING', slaBreached: false,
  customer: { sumsubApplicantId: 'appl-1' }, ...over,
});
const ACTION = (over: any = {}) => ({
  id: 'a-1', seq: 1, applicantActionId: 'aa-edd-0002',
  externalActionId: 'EXT-EDD-0002', submittedAt: null, ...over,
});

describe('WithdrawVerificationSessionService', () => {
  let svc: WithdrawVerificationSessionService;
  let prisma: any; let actions: any; let audit: any; let sumsub: any;

  beforeEach(async () => {
    prisma = { withdrawTransaction: { findFirst: jest.fn().mockResolvedValue(ROW()) } };
    actions = { findBySeq: jest.fn().mockResolvedValue(ACTION()), submitBySeq: jest.fn().mockResolvedValue({ changed: true, allSubmitted: false }) };
    audit = { recordByActor: jest.fn() };
    sumsub = { createActionSdkToken: jest.fn().mockResolvedValue({ token: 'tok-abc' }) };
    const mod = await Test.createTestingModule({
      providers: [
        WithdrawVerificationSessionService,
        { provide: PrismaService, useValue: prisma },
        { provide: WithdrawApplicantActionsService, useValue: actions },
        { provide: AuditLogsService, useValue: audit },
        { provide: SumsubClient, useValue: sumsub },
      ],
    }).compile();
    svc = mod.get(WithdrawVerificationSessionService);
  });

  it('未提交 → 给 sdkToken；响应体只有两个键', async () => {
    const r = await svc.getSession('cust-1', 'WDR1', 1);
    expect(r).toEqual({ submitted: false, sdkToken: 'tok-abc' });
    expect(Object.keys(r).sort()).toEqual(['sdkToken', 'submitted']);
  });

  it('铸 token 参数：applicantId 取客户的 sumsubApplicantId，非提现单 id；levelName/externalActionId 透传', async () => {
    await svc.getSession('cust-1', 'WDR1', 1);
    expect(sumsub.createActionSdkToken).toHaveBeenCalledWith({
      applicantId: 'appl-1',
      levelName: expect.any(String),
      externalActionId: 'EXT-EDD-0002',
    });
  });

  it('客户无 sumsubApplicantId → sdkToken:null，不调用铸 token', async () => {
    prisma.withdrawTransaction.findFirst.mockResolvedValue(ROW({ customer: { sumsubApplicantId: null } }));
    const r = await svc.getSession('cust-1', 'WDR1', 1);
    expect(r).toEqual({ submitted: false, sdkToken: null });
    expect(sumsub.createActionSdkToken).not.toHaveBeenCalled();
  });

  // 上一轮充值的 Critical：actionId 曾出现在响应体里，而 fixture 的 id 是
  // aa-edd-0002——edd = enhanced due diligence，客户开 DevTools 就能反推
  // PEP 判定。这里刻意用那个真实高危 id 造数据，断言它不出现在序列化结果里。
  it('响应体不含任何 action id（用真实高危 id 造数据）', async () => {
    const r = await svc.getSession('cust-1', 'WDR1', 1);
    expect(JSON.stringify(r)).not.toMatch(/aa-edd|EXT-EDD|edd/i);
  });

  it('已提交 → submitted:true 且不再给 token', async () => {
    actions.findBySeq.mockResolvedValue(ACTION({ submittedAt: new Date('2026-08-06') }));
    const r = await svc.getSession('cust-1', 'WDR1', 1);
    expect(r).toEqual({ submitted: true, sdkToken: null });
  });

  // 接口层不可区分规则：同一条 action，提现单为 ACTION_PENDING 与 FROZEN 时
  // 响应体必须逐字段全等。若不成立，客户开 DevTools 就能问出自己那单被冻了。
  it.each([null, new Date('2026-08-06')])(
    '逐条不可区分：ACTION_PENDING 与 FROZEN 响应体全等（submittedAt=%s）',
    async (submittedAt) => {
      actions.findBySeq.mockResolvedValue(ACTION({ submittedAt }));
      prisma.withdrawTransaction.findFirst.mockResolvedValue(ROW({ status: 'ACTION_PENDING' }));
      const a = await svc.getSession('cust-1', 'WDR1', 1);
      prisma.withdrawTransaction.findFirst.mockResolvedValue(ROW({ status: 'FROZEN' }));
      const b = await svc.getSession('cust-1', 'WDR1', 1);
      expect(b).toEqual(a);
    },
  );

  it('IDOR：单号存在但不属于该客户 → 404（与「单子不存在」同款）', async () => {
    prisma.withdrawTransaction.findFirst.mockResolvedValue(null);
    await expect(svc.getSession('cust-1', 'WDR1', 1)).rejects.toThrow(NotFoundException);
  });

  it('seq 不存在 → 与「单子不存在」完全相同的 404', async () => {
    actions.findBySeq.mockResolvedValue(null);
    await expect(svc.getSession('cust-1', 'WDR1', 9)).rejects.toThrow(NotFoundException);
    prisma.withdrawTransaction.findFirst.mockResolvedValue(null);
    await expect(svc.getSession('cust-1', 'NOPE', 1)).rejects.toThrow(NotFoundException);
  });

  // 提现无 limitHoldReason 列（无 below-min 隐藏单），mustFindOwn 的查询条件
  // 不应带这一项——与充值 mustFindOwn 唯一的差异点。
  it('mustFindOwn 查询条件为 {withdrawNo, ownerId}，不带 limitHoldReason', async () => {
    await svc.getSession('cust-1', 'WDR1', 1);

    expect(prisma.withdrawTransaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { withdrawNo: 'WDR1', ownerId: 'cust-1' },
      }),
    );
  });

  describe('submit 对 SLA 字段的重置——只在仍是 ACTION_PENDING 且未违约时才重置', () => {
    it('ACTION_PENDING 且 slaBreached=false → submitBySeq 收到 resetSla=true', async () => {
      prisma.withdrawTransaction.findFirst.mockResolvedValue(
        ROW({ status: 'ACTION_PENDING', slaBreached: false }),
      );

      await svc.submit('cust-1', 'WDR1', 1);

      expect(actions.submitBySeq).toHaveBeenCalledWith('w-1', 1, expect.any(Date), true);
    });

    it('ACTION_PENDING 但 slaBreached=true → submitBySeq 收到 resetSla=false（不抹违约旗）', async () => {
      prisma.withdrawTransaction.findFirst.mockResolvedValue(
        ROW({ status: 'ACTION_PENDING', slaBreached: true }),
      );

      await svc.submit('cust-1', 'WDR1', 1);

      expect(actions.submitBySeq).toHaveBeenCalledWith('w-1', 1, expect.any(Date), false);
    });

    it('FROZEN → submitBySeq 收到 resetSla=false（同上，冻结态同样不许被客户提交清旗）', async () => {
      prisma.withdrawTransaction.findFirst.mockResolvedValue(ROW({ status: 'FROZEN' }));

      await svc.submit('cust-1', 'WDR1', 1);

      expect(actions.submitBySeq).toHaveBeenCalledWith('w-1', 1, expect.any(Date), false);
    });
  });

  it('submit 恒返 {ok:true}，冻结单也照收，不碰状态机', async () => {
    prisma.withdrawTransaction.findFirst.mockResolvedValue(ROW({ status: 'FROZEN' }));
    await expect(svc.submit('cust-1', 'WDR1', 1)).resolves.toEqual({ ok: true });
  });

  it('真落库那次记审计，actor 为 CUSTOMER，metadata 带 seq 与真 id', async () => {
    await svc.submit('cust-1', 'WDR1', 1);
    expect(audit.recordByActor).toHaveBeenCalledTimes(1);
    const [payload, actor] = audit.recordByActor.mock.calls[0];
    expect(actor).toEqual(expect.objectContaining({ actorType: 'CUSTOMER', actorId: 'cust-1' }));
    expect(payload.metadata).toEqual(expect.objectContaining({ seq: 1, actionId: 'aa-edd-0002' }));
  });

  it('幂等重复提交（changed:false）不重复记审计', async () => {
    actions.submitBySeq.mockResolvedValue({ changed: false, allSubmitted: false });
    await svc.submit('cust-1', 'WDR1', 1);
    expect(audit.recordByActor).not.toHaveBeenCalled();
  });
});
