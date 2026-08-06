import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DepositVerificationSessionService } from './deposit-verification-session.service';
import { DepositApplicantActionsService } from './deposit-applicant-actions.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { SumsubClient } from '../../identity/onboarding/providers/sumsub/sumsub.client';

const ROW = (over: any = {}) => ({
  id: 'd-1', depositNo: 'DEP1', ownerType: 'CUSTOMER', ownerId: 'cust-1',
  traceId: 't-1', status: 'ACTION_PENDING', slaBreached: false,
  customer: { sumsubApplicantId: 'appl-1' }, ...over,
});
const ACTION = (over: any = {}) => ({
  id: 'a-1', seq: 1, applicantActionId: 'aa-edd-0002',
  externalActionId: 'EXT-EDD-0002', submittedAt: null, ...over,
});

describe('DepositVerificationSessionService', () => {
  let svc: DepositVerificationSessionService;
  let prisma: any; let actions: any; let audit: any; let sumsub: any;

  beforeEach(async () => {
    prisma = { depositTransaction: { findFirst: jest.fn().mockResolvedValue(ROW()) } };
    actions = { findBySeq: jest.fn().mockResolvedValue(ACTION()), submitBySeq: jest.fn().mockResolvedValue({ changed: true, allSubmitted: false }) };
    audit = { recordByActor: jest.fn() };
    sumsub = { createActionSdkToken: jest.fn().mockResolvedValue({ token: 'tok-abc' }) };
    const mod = await Test.createTestingModule({
      providers: [
        DepositVerificationSessionService,
        { provide: PrismaService, useValue: prisma },
        { provide: DepositApplicantActionsService, useValue: actions },
        { provide: AuditLogsService, useValue: audit },
        { provide: SumsubClient, useValue: sumsub },
      ],
    }).compile();
    svc = mod.get(DepositVerificationSessionService);
  });

  it('未提交 → 给 sdkToken；响应体只有两个键', async () => {
    const r = await svc.getSession('cust-1', 'DEP1', 1);
    expect(r).toEqual({ submitted: false, sdkToken: 'tok-abc' });
    expect(Object.keys(r).sort()).toEqual(['sdkToken', 'submitted']);
  });

  // 上一轮的 Critical：actionId 曾出现在响应体里，而 fixture 的 id 是
  // aa-edd-0002——edd = enhanced due diligence，客户开 DevTools 就能反推
  // PEP 判定。这里刻意用那个真实高危 id 造数据，断言它不出现在序列化结果里。
  it('响应体不含任何 action id（用真实高危 id 造数据）', async () => {
    const r = await svc.getSession('cust-1', 'DEP1', 1);
    expect(JSON.stringify(r)).not.toMatch(/aa-edd|EXT-EDD|edd/i);
  });

  it('已提交 → submitted:true 且不再给 token', async () => {
    actions.findBySeq.mockResolvedValue(ACTION({ submittedAt: new Date('2026-08-06') }));
    const r = await svc.getSession('cust-1', 'DEP1', 1);
    expect(r).toEqual({ submitted: true, sdkToken: null });
  });

  // 接口层不可区分规则（粒度从整单降到这一条）：同一条 action，充值单为
  // ACTION_PENDING 与 FROZEN 时响应体必须全等。若不成立，客户开 DevTools
  // 就能问出自己那单被冻了，渲染层防线归零。
  it.each([null, new Date('2026-08-06')])(
    '逐条不可区分：ACTION_PENDING 与 FROZEN 响应体全等（submittedAt=%s）',
    async (submittedAt) => {
      actions.findBySeq.mockResolvedValue(ACTION({ submittedAt }));
      prisma.depositTransaction.findFirst.mockResolvedValue(ROW({ status: 'ACTION_PENDING' }));
      const a = await svc.getSession('cust-1', 'DEP1', 1);
      prisma.depositTransaction.findFirst.mockResolvedValue(ROW({ status: 'FROZEN' }));
      const b = await svc.getSession('cust-1', 'DEP1', 1);
      expect(b).toEqual(a);
    },
  );

  it('seq 不存在 → 与「单子不存在」完全相同的 404', async () => {
    actions.findBySeq.mockResolvedValue(null);
    await expect(svc.getSession('cust-1', 'DEP1', 9)).rejects.toThrow(NotFoundException);
    prisma.depositTransaction.findFirst.mockResolvedValue(null);
    await expect(svc.getSession('cust-1', 'NOPE', 1)).rejects.toThrow(NotFoundException);
  });

  // 806812d3 整体替换本文件时连带删掉的回归覆盖，评审补回：BELOW_MIN
  // 隐藏单的存在性预言机。findAll 的 customerScope 与 findOneForCustomer
  // 都把这类单当不存在处理（limitHoldReason != null → 404），本端点必须
  // 对齐——否则客户能借此探出"我有一笔列表里看不到的单"，而单号
  // `DEP+YYMMDD+4位随机` 一天空间只有 1 万、又没有限流，枚举成本很低。
  it('mustFindOwn 的查询条件带 limitHoldReason:null，与客户面其它两条口子对齐', async () => {
    await svc.getSession('cust-1', 'DEP1', 1);

    expect(prisma.depositTransaction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { depositNo: 'DEP1', ownerId: 'cust-1', limitHoldReason: null },
      }),
    );
  });

  // 806812d3 整体替换本文件时连带删掉的回归覆盖，评审补回：客户一次提交
  // 不能单方面抹掉 operator 可见的 SLA 违约旗——该状态不在 SLA 扫描范围内，
  // 抹掉后永远发现不了。判据是 status === ACTION_PENDING && !slaBreached。
  describe('submit 对 SLA 字段的重置——只在仍是 ACTION_PENDING 且未违约时才重置', () => {
    it('ACTION_PENDING 且 slaBreached=false → submitBySeq 收到 resetSla=true', async () => {
      prisma.depositTransaction.findFirst.mockResolvedValue(
        ROW({ status: 'ACTION_PENDING', slaBreached: false }),
      );

      await svc.submit('cust-1', 'DEP1', 1);

      expect(actions.submitBySeq).toHaveBeenCalledWith('d-1', 1, expect.any(Date), true);
    });

    it('ACTION_PENDING 但 slaBreached=true → submitBySeq 收到 resetSla=false（不抹违约旗）', async () => {
      prisma.depositTransaction.findFirst.mockResolvedValue(
        ROW({ status: 'ACTION_PENDING', slaBreached: true }),
      );

      await svc.submit('cust-1', 'DEP1', 1);

      expect(actions.submitBySeq).toHaveBeenCalledWith('d-1', 1, expect.any(Date), false);
    });

    it('FROZEN → submitBySeq 收到 resetSla=false（同上，冻结态同样不许被客户提交清旗）', async () => {
      prisma.depositTransaction.findFirst.mockResolvedValue(ROW({ status: 'FROZEN' }));

      await svc.submit('cust-1', 'DEP1', 1);

      expect(actions.submitBySeq).toHaveBeenCalledWith('d-1', 1, expect.any(Date), false);
    });
  });

  it('submit 恒返 {ok:true}，冻结单也照收', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(ROW({ status: 'FROZEN' }));
    await expect(svc.submit('cust-1', 'DEP1', 1)).resolves.toEqual({ ok: true });
  });

  it('真落库那次记审计，actor 为 CUSTOMER，metadata 带 seq 与真 id', async () => {
    await svc.submit('cust-1', 'DEP1', 1);
    expect(audit.recordByActor).toHaveBeenCalledTimes(1);
    const [payload, actor] = audit.recordByActor.mock.calls[0];
    expect(actor).toEqual(expect.objectContaining({ actorType: 'CUSTOMER', actorId: 'cust-1' }));
    expect(payload.metadata).toEqual(expect.objectContaining({ seq: 1, actionId: 'aa-edd-0002' }));
  });

  it('幂等重复提交不重复记审计', async () => {
    actions.submitBySeq.mockResolvedValue({ changed: false, allSubmitted: false });
    await svc.submit('cust-1', 'DEP1', 1);
    expect(audit.recordByActor).not.toHaveBeenCalled();
  });
});
