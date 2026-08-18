import { ForbiddenException } from '@nestjs/common';
import { MaterialRequestsClientController } from './material-requests.client.controller';

const CUSTOMER_REQ = { user: { type: 'CUSTOMER', userId: 'c1', userNo: 'CUS-001' } };
const ADMIN_REQ = { user: { type: 'ADMIN', userId: 'admin-1' } };

function row(over: Record<string, any> = {}) {
  return {
    requestNo: 'MRQ1', customerId: 'c1', materialType: 'PROOF_OF_ADDRESS',
    levelName: 'wave3-action-poa-refresh', applicantActionId: 'act-1', externalActionId: 'ext-1',
    orderDomain: null, orderRef: null, restrictionNo: null, origin: 'OPERATOR_ISSUED',
    status: 'PENDING_SUBMISSION', reason: 'Address on file is stale', issuedBy: 'ADM001',
    issuedAt: new Date('2026-08-17T00:00:00Z'), submittedAt: null, reviewedAt: null,
    reviewAnswer: null, reviewRejectType: null, cancelledAt: null, cancelReason: null,
    traceId: 't1', ...over,
  };
}

function build(found: any = row()) {
  const prisma = {
    customerMain: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', sumsubApplicantId: 'app-1' }) },
  } as any;
  const requests = {
    listLiveByCustomer: jest.fn().mockResolvedValue([row()]),
    findByNo: jest.fn().mockResolvedValue(found),
    markSubmitted: jest.fn().mockResolvedValue(true),
  } as any;
  const sumsub = { createActionSdkToken: jest.fn().mockResolvedValue({ token: 'tok-1' }) } as any;
  const controller = new MaterialRequestsClientController(prisma, requests, sumsub);
  return { controller, prisma, requests, sumsub };
}

describe('客户端端点鉴权', () => {
  it('非 CUSTOMER 一律 Forbidden', async () => {
    const { controller } = build();
    await expect(controller.listMine(ADMIN_REQ)).rejects.toThrow(ForbiddenException);
    await expect(controller.getSession(ADMIN_REQ, 'MRQ1')).rejects.toThrow(ForbiddenException);
    await expect(controller.submit(ADMIN_REQ, 'MRQ1')).rejects.toThrow(ForbiddenException);
  });
});

describe('GET /client/me/material-requests', () => {
  it('只回活行，且回包里没有任何 Sumsub 侧 id（G5）', async () => {
    const { controller } = build();
    const out = await controller.listMine(CUSTOMER_REQ);
    expect(JSON.stringify(out)).not.toContain('act-1');
    expect(JSON.stringify(out)).not.toContain('ext-1');
    expect(out[0]).toMatchObject({ requestNo: 'MRQ1', blocking: false, materialLabel: 'Proof of Address' });
  });

  it('挂了限制的行 blocking=true（横幅据此分红黄两档）', async () => {
    const { controller, requests } = build();
    requests.listLiveByCustomer.mockResolvedValue([row({ restrictionNo: 'RST1' })]);
    const out = await controller.listMine(CUSTOMER_REQ);
    expect(out[0].blocking).toBe(true);
  });
});

describe('GET /client/me/material-requests/:requestNo/session', () => {
  it('正常行 → 铸 token，externalActionId 作为钥匙传给 Sumsub', async () => {
    const { controller, sumsub } = build();
    const out = await controller.getSession(CUSTOMER_REQ, 'MRQ1');
    expect(out).toEqual({ submitted: false, sdkToken: 'tok-1' });
    expect(sumsub.createActionSdkToken).toHaveBeenCalledWith(
      expect.objectContaining({
        applicantId: 'app-1', levelName: 'wave3-action-poa-refresh', externalActionId: 'ext-1',
      }),
    );
  });

  it('已提交 → {submitted:true, sdkToken:null}，不铸 token', async () => {
    const { controller, sumsub } = build(row({ status: 'SUBMITTED', submittedAt: new Date() }));
    await expect(controller.getSession(CUSTOMER_REQ, 'MRQ1'))
      .resolves.toEqual({ submitted: true, sdkToken: null });
    expect(sumsub.createActionSdkToken).not.toHaveBeenCalled();
  });

  it('别人的 requestNo → 与「不存在」逐字相同的响应，不是 403（403 本身就是信息泄漏）', async () => {
    const notMine = build(row({ customerId: 'someone-else' }));
    const missing = build(null);
    const a = await notMine.controller.getSession(CUSTOMER_REQ, 'MRQ1');
    const b = await missing.controller.getSession(CUSTOMER_REQ, 'MRQ-NOPE');
    expect(a).toEqual(b);
    expect(a).toEqual({ submitted: true, sdkToken: null });
  });

  it('终态行 → 同样按「没什么可做」回，不铸 token', async () => {
    const { controller, sumsub } = build(row({ status: 'REJECTED' }));
    await expect(controller.getSession(CUSTOMER_REQ, 'MRQ1'))
      .resolves.toEqual({ submitted: true, sdkToken: null });
    expect(sumsub.createActionSdkToken).not.toHaveBeenCalled();
  });
});

describe('POST /client/me/material-requests/:requestNo/submit', () => {
  it('幂等恒 2xx，不吐状态机信息', async () => {
    const { controller, requests } = build();
    await expect(controller.submit(CUSTOMER_REQ, 'MRQ1')).resolves.toEqual({ ok: true });
    requests.markSubmitted.mockResolvedValue(false);
    await expect(controller.submit(CUSTOMER_REQ, 'MRQ1')).resolves.toEqual({ ok: true });
  });

  it('别人的 requestNo → 同样 {ok:true}，但不真的落章', async () => {
    const { controller, requests } = build(row({ customerId: 'someone-else' }));
    await expect(controller.submit(CUSTOMER_REQ, 'MRQ1')).resolves.toEqual({ ok: true });
    expect(requests.markSubmitted).not.toHaveBeenCalled();
  });
});
