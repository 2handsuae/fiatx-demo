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
  const requests = {
    listLiveByCustomer: jest.fn().mockResolvedValue([row()]),
    findByNo: jest.fn().mockResolvedValue(found),
    markSubmitted: jest.fn().mockResolvedValue(true),
    mintSessionToken: jest.fn().mockResolvedValue('tok-1'),
  } as any;
  const controller = new MaterialRequestsClientController(requests);
  return { controller, requests };
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

/**
 * 归属 / 状态 / 客户是否有 sumsubApplicantId 的判定全在
 * `MaterialRequestsService.mintSessionToken()` 里（见 material-requests.service.spec.ts
 * 的「别人的号」「已提交」「终态行」等场景）。controller 这一层只剩一件事：
 * 把 service 回的 token/null 映射成响应体，别人的号也不能是 403。
 */
describe('GET /client/me/material-requests/:requestNo/session', () => {
  it('service 铸出 token → {submitted:false, sdkToken}，且把 requestNo/customerId 原样递给 service', async () => {
    const { controller, requests } = build();
    const out = await controller.getSession(CUSTOMER_REQ, 'MRQ1');
    expect(out).toEqual({ submitted: false, sdkToken: 'tok-1' });
    expect(requests.mintSessionToken).toHaveBeenCalledWith('MRQ1', 'c1');
  });

  it('service 回 null（别人的号 / 不存在 / 已提交 / 终态，均由 service 内部判定）→ {submitted:true, sdkToken:null}，不是 403', async () => {
    const { controller, requests } = build();
    requests.mintSessionToken.mockResolvedValue(null);
    await expect(controller.getSession(CUSTOMER_REQ, 'MRQ1'))
      .resolves.toEqual({ submitted: true, sdkToken: null });
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
