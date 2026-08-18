import { SwapApplicantActionHandler } from './applicant-action.handler';
import { CustomerPendingActionService } from '../identity/customers/customer-pending-action.service';
import { MaterialRequestsService } from '../identity/material-requests/material-requests.service';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import { AuditActions } from '../audit-logging/constants/audit-actions.constant';

/**
 * 2026-08-17 材料请求账（Task 10）：GREEN/RED 的处置（清指针、resetSubmission、
 * autoRelease）搬去 MaterialRequestReviewService（Task 4）统一管，三个域一套
 * 逻辑。本 handler 只剩一件兑换域独有的事——「GREEN 到过但被刻意不解锁」那条
 * 审计，由 MaterialRequestReviewService.applyReview 在 GREEN 落地后回调
 * noteHardLineHeld(requestNo)。旧版四条 handle() 用例（GREEN 清限制 / RED 升级 /
 * 认领不到 / 真实字段名兜底）随处置逻辑一起搬走，不在本文件重复断言。
 */
function build() {
  const prisma: any = {
    customerMain: {
      findUnique: jest.fn().mockResolvedValue({ customerNo: 'C-001' }),
    },
  };
  const audit = {
    recordSystem: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditLogsService>;
  const pending = {
    hasHardLineDisposition: jest.fn(),
  } as unknown as jest.Mocked<CustomerPendingActionService>;
  const requests = {
    findByNo: jest.fn(),
  } as unknown as jest.Mocked<MaterialRequestsService>;

  const handler = new SwapApplicantActionHandler(prisma, audit, pending, requests);
  return { handler, prisma, audit, pending, requests };
}

describe('SwapApplicantActionHandler.noteHardLineHeld', () => {
  it('非 SWAP 域的行直接返回，不写审计', async () => {
    const { handler, audit, requests } = build();
    requests.findByNo.mockResolvedValue({ requestNo: 'M1', customerId: 'c1', orderDomain: 'DEPOSIT' } as any);

    await handler.noteHardLineHeld('M1');

    expect(audit.recordSystem).not.toHaveBeenCalled();
  });

  it('SWAP 域但没被硬线过 → 不写审计（正常放行，没什么可记的）', async () => {
    const { handler, audit, requests, pending } = build();
    requests.findByNo.mockResolvedValue({ requestNo: 'M1', customerId: 'c1', orderDomain: 'SWAP' } as any);
    pending.hasHardLineDisposition.mockResolvedValue(false);

    await handler.noteHardLineHeld('M1');

    expect(audit.recordSystem).not.toHaveBeenCalled();
  });

  it('SWAP 域且被硬线过 → 写一条 GREEN_HARDLINE_HELD，供调查员核实', async () => {
    const { handler, audit, requests, pending } = build();
    requests.findByNo.mockResolvedValue({
      requestNo: 'M1',
      customerId: 'c1',
      orderDomain: 'SWAP',
      orderRef: 'SWP0001',
    } as any);
    pending.hasHardLineDisposition.mockResolvedValue(true);

    await handler.noteHardLineHeld('M1');

    expect(audit.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditActions.SWAP_ACTION_GREEN_HARDLINE_HELD }),
    );
  });

  it('查不到这条材料请求（requestNo 不存在）→ 直接返回，不写审计', async () => {
    const { handler, audit, requests } = build();
    requests.findByNo.mockResolvedValue(null);

    await handler.noteHardLineHeld('NOPE');

    expect(audit.recordSystem).not.toHaveBeenCalled();
  });
});
