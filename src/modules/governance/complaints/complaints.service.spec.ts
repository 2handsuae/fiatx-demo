import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ComplaintsService } from './complaints.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalActorContext } from '../approvals/constants/approval.constants';
import { ComplaintStatus } from './complaint.constants';

const ops: ApprovalActorContext = { actorType: 'ADMIN', userId: 'uuid-ops', userNo: 'ADM-OPS', roleCodes: ['COMPLIANCE_OFFICER'] };

describe('ComplaintsService (Task 2)', () => {
  let prisma: PrismaService;
  let service: ComplaintsService;
  let auditLogs: { recordByActor: jest.Mock; recordSystem: jest.Mock };
  const createdComplaintNos: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    if (createdComplaintNos.length) {
      await prisma.auditLogEvent.deleteMany({ where: { primarySubjectType: 'COMPLAINT', primarySubjectNo: { in: createdComplaintNos } } });
      await prisma.complaintEntry.deleteMany({ where: { complaintNo: { in: createdComplaintNos } } });
      await prisma.complaint.deleteMany({ where: { complaintNo: { in: createdComplaintNos } } });
    }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    auditLogs = { recordByActor: jest.fn(async () => ({})), recordSystem: jest.fn(async () => ({})) };
    const mod = await Test.createTestingModule({
      providers: [
        ComplaintsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();
    service = mod.get(ComplaintsService);
  });

  function actionsOf(): string[] {
    return [...auditLogs.recordByActor.mock.calls, ...auditLogs.recordSystem.mock.calls].map((c) => c[0].action);
  }

  async function submitComplaint(customerNo = `CU_T2_${randomUUID().slice(0, 8)}`): Promise<{ complaintNo: string; customerNo: string }> {
    const { complaintNo } = await service.submit(customerNo, {
      category: 'SERVICE', subject: 'Slow support response', description: 'Waited three days for a reply',
    });
    createdComplaintNos.push(complaintNo);
    return { complaintNo, customerNo };
  }

  async function toInvestigating(): Promise<{ complaintNo: string; customerNo: string }> {
    const ctx = await submitComplaint();
    await service.acknowledge(ops, ctx.complaintNo, { message: 'We have received your complaint' });
    await service.startInvestigation(ops, ctx.complaintNo);
    return ctx;
  }

  async function toResolutionPending(): Promise<{ complaintNo: string; customerNo: string; approvalNo: string }> {
    const ctx = await toInvestigating();
    const approvalNo = `APR_${ctx.complaintNo}`;
    await service.proposeResolution(ops, ctx.complaintNo, { outcome: 'UPHELD', resolutionText: 'We will refund the fee' }, approvalNo);
    return { ...ctx, approvalNo };
  }

  // ── submit：两钟算对 ──────────────────────────────────────────────
  describe('submit', () => {
    it('opens RECEIVED with ackDeadlineAt=submittedAt+7d and resolveDeadlineAt=submittedAt+28d, and mints a CMP business key', async () => {
      const customerNo = `CU_T2_${randomUUID().slice(0, 8)}`;
      const { complaintNo } = await service.submit(customerNo, {
        category: 'FEES', subject: 'Overcharged fee', description: 'Charged twice for the same withdrawal',
      });
      createdComplaintNos.push(complaintNo);
      expect(complaintNo).toMatch(/^CMP\d{12}$/);

      const row = await service.findByNo(complaintNo);
      expect(row.currentStatus).toBe('RECEIVED');
      expect(row.ownerCustomerNo).toBe(customerNo);
      expect(row.ackDeadlineAt.getTime()).toBe(row.submittedAt.getTime() + 7 * 86400000);
      expect(row.resolveDeadlineAt.getTime()).toBe(row.submittedAt.getTime() + 28 * 86400000);

      expect(actionsOf()).toEqual(['COMPLAINT_SUBMITTED']);
      const call = auditLogs.recordByActor.mock.calls[0][0];
      expect(call).toMatchObject({ actionDomain: 'GOVERNANCE', primarySubjectType: 'COMPLAINT', primarySubjectNo: complaintNo });
      expect(call.requestId).toEqual(expect.stringContaining('COMPLAINT_SUBMITTED'));
      const actorArg = auditLogs.recordByActor.mock.calls[0][1];
      expect(actorArg).toMatchObject({ actorType: 'CUSTOMER', actorNo: customerNo });
    });
  });

  // ── acknowledge：停确认钟 + CLIENT_MESSAGE/ACK 落 entry ──────────────
  describe('acknowledge', () => {
    it('moves RECEIVED→ACKNOWLEDGED, stamps acknowledgedAt, and logs a CLIENT_MESSAGE/ACK entry', async () => {
      const { complaintNo } = await submitComplaint();
      const r = await service.acknowledge(ops, complaintNo, { message: 'Thanks for reaching out, we are on it' });
      expect(r.complaintNo).toBe(complaintNo);

      const row = await service.findByNo(complaintNo);
      expect(row.currentStatus).toBe('ACKNOWLEDGED');
      expect(row.acknowledgedAt).not.toBeNull();

      const view = await service.getAdmin(complaintNo);
      expect(view.entries).toHaveLength(1);
      expect(view.entries[0]).toMatchObject({ kind: 'CLIENT_MESSAGE', messageType: 'ACK', body: 'Thanks for reaching out, we are on it' });

      const call = auditLogs.recordByActor.mock.calls.find((c) => c[0].action === 'COMPLAINT_ACKNOWLEDGED')[0];
      expect(call).toMatchObject({ fromStatus: 'RECEIVED', toStatus: 'ACKNOWLEDGED' });
    });

    it('rejects acknowledging a complaint that is not RECEIVED (illegal transition, explicit 400)', async () => {
      const { complaintNo } = await submitComplaint();
      await service.acknowledge(ops, complaintNo, { message: 'first' });
      await expect(service.acknowledge(ops, complaintNo, { message: 'second' })).rejects.toThrow(BadRequestException);
      await expect(service.acknowledge(ops, complaintNo, { message: 'second' })).rejects.toThrow(/Invalid complaint transition/);
    });
  });

  // ── startInvestigation ────────────────────────────────────────────
  describe('startInvestigation', () => {
    it('moves ACKNOWLEDGED→INVESTIGATING', async () => {
      const { complaintNo } = await submitComplaint();
      await service.acknowledge(ops, complaintNo, { message: 'ack' });
      const r = await service.startInvestigation(ops, complaintNo);
      expect(r.complaintNo).toBe(complaintNo);
      const row = await service.findByNo(complaintNo);
      expect(row.currentStatus).toBe('INVESTIGATING');
    });

    it('rejects starting investigation on a RECEIVED (not yet acknowledged) complaint', async () => {
      const { complaintNo } = await submitComplaint();
      await expect(service.startInvestigation(ops, complaintNo)).rejects.toThrow(BadRequestException);
    });
  });

  // ── addNote：INTERNAL_NOTE，任意非终态可加 ────────────────────────────
  describe('addNote', () => {
    it('logs an INTERNAL_NOTE entry without changing currentStatus', async () => {
      const { complaintNo } = await submitComplaint();
      const r = await service.addNote(ops, complaintNo, 'Called the customer, awaiting callback');
      expect(r.complaintNo).toBe(complaintNo);
      const row = await service.findByNo(complaintNo);
      expect(row.currentStatus).toBe('RECEIVED');
      const view = await service.getAdmin(complaintNo);
      expect(view.entries).toHaveLength(1);
      expect(view.entries[0]).toMatchObject({ kind: 'INTERNAL_NOTE', body: 'Called the customer, awaiting callback' });
    });

    it('rejects adding a note to a RESOLVED (terminal) complaint', async () => {
      const ctx = await toResolutionPending();
      await service.applyResolution(ctx.complaintNo, ctx.approvalNo, { outcome: 'UPHELD', resolutionText: 'Refunded' });
      await expect(service.addNote(ops, ctx.complaintNo, 'too late')).rejects.toThrow(BadRequestException);
    });
  });

  // ── extend：一次性守卫 + 死线改 56d ────────────────────────────────
  describe('extend', () => {
    it('moves INVESTIGATING→INVESTIGATING_EXTENDED, resets resolveDeadlineAt to submittedAt+56d, and logs CLIENT_MESSAGE/EXTENSION_NOTICE', async () => {
      const ctx = await toInvestigating();
      const before = await service.findByNo(ctx.complaintNo);
      const r = await service.extend(ops, ctx.complaintNo, { explanation: 'Case requires additional time to investigate' });
      expect(r.complaintNo).toBe(ctx.complaintNo);

      const row = await service.findByNo(ctx.complaintNo);
      expect(row.currentStatus).toBe('INVESTIGATING_EXTENDED');
      expect(row.extendedAt).not.toBeNull();
      expect(row.resolveDeadlineAt.getTime()).toBe(before.submittedAt.getTime() + 56 * 86400000);

      const view = await service.getAdmin(ctx.complaintNo);
      expect(view.entries.find((e) => e.messageType === 'EXTENSION_NOTICE')).toMatchObject({
        kind: 'CLIENT_MESSAGE', body: 'Case requires additional time to investigate',
      });

      const call = auditLogs.recordByActor.mock.calls.find((c) => c[0].action === 'COMPLAINT_EXTENDED')[0];
      expect(call.newResolveDeadlineAt).toBe(row.resolveDeadlineAt.toISOString());
    });

    it('rejects a second extend on the same complaint (one-time guard, 400)', async () => {
      const ctx = await toInvestigating();
      await service.extend(ops, ctx.complaintNo, { explanation: 'first extension' });
      await expect(service.extend(ops, ctx.complaintNo, { explanation: 'second extension' })).rejects.toThrow(BadRequestException);
      await expect(service.extend(ops, ctx.complaintNo, { explanation: 'second extension' })).rejects.toThrow(/already been extended/);
    });

    it('rejects extending a complaint that is not INVESTIGATING (e.g. still RECEIVED)', async () => {
      const { complaintNo } = await submitComplaint();
      await expect(service.extend(ops, complaintNo, { explanation: 'too early' })).rejects.toThrow(BadRequestException);
    });
  });

  // ── propose/apply/reject 三步 + 两条驳回边 ────────────────────────────
  describe('proposeResolution / applyResolution / rejectResolution (ri-replacement 三步先例)', () => {
    it('proposeResolution moves INVESTIGATING→RESOLUTION_PENDING, records pendingApprovalNo, and does NOT persist outcome/resolutionText on the row', async () => {
      const ctx = await toInvestigating();
      const approvalNo = `APR_${ctx.complaintNo}`;
      const r = await service.proposeResolution(ops, ctx.complaintNo, { outcome: 'PARTIALLY_UPHELD', resolutionText: 'Partial refund' }, approvalNo);
      expect(r.complaintNo).toBe(ctx.complaintNo);

      const row = await service.findByNo(ctx.complaintNo);
      expect(row.currentStatus).toBe('RESOLUTION_PENDING');
      expect(row.pendingApprovalNo).toBe(approvalNo);
      expect(row.resolutionOutcome).toBeNull();
      expect(row.resolutionText).toBeNull();

      const call = auditLogs.recordByActor.mock.calls.find((c) => c[0].action === 'COMPLAINT_RESOLUTION_PROPOSED')[0];
      // 必填闸改咬 resolutionOutcome（业务真值，控制器裁定修正——原 outcome 与审计信封
      // 保留字段撞名，见 audit-actions.constant.ts 头注释）；outcome 顶层不再显式传
      // （undefined 走默认成功分支）；展示级镜像仍落 metadata.outcome。
      expect(call.outcome).toBeUndefined();
      expect(call.resolutionOutcome).toBe('PARTIALLY_UPHELD');
      expect(call.metadata.outcome).toBe('PARTIALLY_UPHELD');
    });

    it('proposeResolution on an already-RESOLUTION_PENDING complaint is rejected (state machine blocks re-entry, no separate pending guard needed)', async () => {
      const ctx = await toResolutionPending();
      await expect(service.proposeResolution(ops, ctx.complaintNo, { outcome: 'UPHELD', resolutionText: 'x' }, 'APR_2')).rejects.toThrow(BadRequestException);
    });

    it('applyResolution moves RESOLUTION_PENDING→RESOLVED, persists outcome/resolutionText/resolvedAt, logs CLIENT_MESSAGE/FINAL_RESPONSE, clears pending, and records via recordSystem (no actor)', async () => {
      const ctx = await toResolutionPending();
      auditLogs.recordByActor.mockClear();
      auditLogs.recordSystem.mockClear();
      const r = await service.applyResolution(ctx.complaintNo, ctx.approvalNo, { outcome: 'UPHELD', resolutionText: 'We will refund the fee' });
      expect(r.complaintNo).toBe(ctx.complaintNo);

      const row = await service.findByNo(ctx.complaintNo);
      expect(row.currentStatus).toBe('RESOLVED');
      expect(row.resolutionOutcome).toBe('UPHELD');
      expect(row.resolutionText).toBe('We will refund the fee');
      expect(row.resolvedAt).not.toBeNull();
      expect(row.pendingApprovalNo).toBeNull();

      const view = await service.getAdmin(ctx.complaintNo);
      expect(view.entries.find((e) => e.messageType === 'FINAL_RESPONSE')).toMatchObject({ kind: 'CLIENT_MESSAGE', body: 'We will refund the fee' });

      expect(auditLogs.recordByActor).not.toHaveBeenCalled();
      expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
      const call = auditLogs.recordSystem.mock.calls[0][0];
      expect(call.action).toBe('COMPLAINT_RESOLUTION_APPLIED');
      expect(call.outcome).toBeUndefined();
      expect(call.resolutionOutcome).toBe('UPHELD');
      expect(call.metadata.outcome).toBe('UPHELD');
    });

    it('rejectResolution with no prior extend bounces RESOLUTION_PENDING→INVESTIGATING and clears pending (system, no actor)', async () => {
      const ctx = await toResolutionPending();
      auditLogs.recordSystem.mockClear();
      const r = await service.rejectResolution(ctx.complaintNo, ctx.approvalNo, 'REJECTED');
      expect(r.complaintNo).toBe(ctx.complaintNo);
      const row = await service.findByNo(ctx.complaintNo);
      expect(row.currentStatus).toBe('INVESTIGATING');
      expect(row.pendingApprovalNo).toBeNull();
      expect(auditLogs.recordSystem).toHaveBeenCalledTimes(1);
      expect(auditLogs.recordSystem.mock.calls[0][0].action).toBe('COMPLAINT_RESOLUTION_REJECTED');
    });

    it('rejectResolution after a prior extend bounces back to INVESTIGATING_EXTENDED instead (extendedAt-driven edge)', async () => {
      const ctx = await toInvestigating();
      await service.extend(ops, ctx.complaintNo, { explanation: 'need more time' });
      const approvalNo = `APR_EXT_${ctx.complaintNo}`;
      await service.proposeResolution(ops, ctx.complaintNo, { outcome: 'REJECTED', resolutionText: 'No grounds' }, approvalNo);
      const r = await service.rejectResolution(ctx.complaintNo, approvalNo, 'CANCELLED');
      expect(r.complaintNo).toBe(ctx.complaintNo);
      const row = await service.findByNo(ctx.complaintNo);
      expect(row.currentStatus).toBe('INVESTIGATING_EXTENDED');
      expect(row.pendingApprovalNo).toBeNull();
    });
  });

  // ── markEscalated：守卫三连 ────────────────────────────────────────
  describe('markEscalated', () => {
    it('records escalatedIncidentNo without changing currentStatus', async () => {
      const ctx = await toInvestigating();
      const r = await service.markEscalated(ops, ctx.complaintNo, 'INC_FROM_CMP_1');
      expect(r.complaintNo).toBe(ctx.complaintNo);
      const row = await service.findByNo(ctx.complaintNo);
      expect(row.escalatedIncidentNo).toBe('INC_FROM_CMP_1');
      expect(row.currentStatus).toBe('INVESTIGATING');
      const call = auditLogs.recordByActor.mock.calls.find((c) => c[0].action === 'COMPLAINT_ESCALATED')[0];
      expect(call.escalatedIncidentNo).toBe('INC_FROM_CMP_1');
    });

    it('rejects escalating a complaint that is not in an investigating status (e.g. RECEIVED)', async () => {
      const { complaintNo } = await submitComplaint();
      await expect(service.markEscalated(ops, complaintNo, 'INC_X')).rejects.toThrow(BadRequestException);
    });

    it('rejects escalating twice (already escalated)', async () => {
      const ctx = await toInvestigating();
      await service.markEscalated(ops, ctx.complaintNo, 'INC_FIRST');
      await expect(service.markEscalated(ops, ctx.complaintNo, 'INC_SECOND')).rejects.toThrow(BadRequestException);
      await expect(service.markEscalated(ops, ctx.complaintNo, 'INC_SECOND')).rejects.toThrow(/already been escalated/);
    });

    it('rejects escalating a RESOLVED (terminal) complaint', async () => {
      const ctx = await toResolutionPending();
      await service.applyResolution(ctx.complaintNo, ctx.approvalNo, { outcome: 'UPHELD', resolutionText: 'Refunded' });
      await expect(service.markEscalated(ops, ctx.complaintNo, 'INC_TOO_LATE')).rejects.toThrow(BadRequestException);
    });
  });

  // ── simulateTimeout：⚡ 拨钟；终态 400 ─────────────────────────────
  describe('simulateTimeout', () => {
    it('fast-forwards ackDeadlineAt to now-1h for target=ACK', async () => {
      const { complaintNo } = await submitComplaint();
      const before = Date.now();
      const r = await service.simulateTimeout(ops, complaintNo, 'ACK');
      expect(r.complaintNo).toBe(complaintNo);
      const row = await service.findByNo(complaintNo);
      expect(row.ackDeadlineAt.getTime()).toBeLessThan(before);
      const call = auditLogs.recordByActor.mock.calls.find((c) => c[0].action === 'COMPLAINT_DEADLINE_FASTFORWARDED')[0];
      expect(call.target).toBe('ACK');
      expect(call.metadata).toMatchObject({ target: 'ACK', deadlineAt: row.ackDeadlineAt.toISOString() });
    });

    it('fast-forwards resolveDeadlineAt to now-1h for target=RESOLVE', async () => {
      const { complaintNo } = await submitComplaint();
      const before = Date.now();
      await service.simulateTimeout(ops, complaintNo, 'RESOLVE');
      const row = await service.findByNo(complaintNo);
      expect(row.resolveDeadlineAt.getTime()).toBeLessThan(before);
    });

    it('rejects fast-forwarding a RESOLVED (terminal) complaint', async () => {
      const ctx = await toResolutionPending();
      await service.applyResolution(ctx.complaintNo, ctx.approvalNo, { outcome: 'UPHELD', resolutionText: 'Refunded' });
      await expect(service.simulateTimeout(ops, ctx.complaintNo, 'RESOLVE')).rejects.toThrow(BadRequestException);
    });
  });

  // ── 客户读面：看不到 INTERNAL_NOTE；别人的号「查无」不回 403 ────────────
  describe('客户读面 (getForCustomer / listForCustomer)', () => {
    it('getForCustomer projects only CLIENT_MESSAGE entries, hiding INTERNAL_NOTE', async () => {
      const { complaintNo, customerNo } = await submitComplaint();
      await service.acknowledge(ops, complaintNo, { message: 'We got it' });
      await service.addNote(ops, complaintNo, 'internal-only note');
      const view = await service.getForCustomer(customerNo, complaintNo);
      expect(view.entries).toHaveLength(1);
      expect(view.entries[0]).toMatchObject({ kind: 'CLIENT_MESSAGE', messageType: 'ACK' });
      expect(view.entries.some((e) => e.kind === 'INTERNAL_NOTE')).toBe(false);
    });

    it('getForCustomer with another customer\'s complaintNo throws NotFoundException — same as an unknown number ("查无", not 403)', async () => {
      const { complaintNo } = await submitComplaint();
      await expect(service.getForCustomer('CU_SOMEONE_ELSE', complaintNo)).rejects.toThrow(NotFoundException);
      await expect(service.getForCustomer('CU_SOMEONE_ELSE', 'CMP_DOES_NOT_EXIST')).rejects.toThrow(NotFoundException);
    });

    it('listForCustomer only returns complaints owned by that customer', async () => {
      const mine = await submitComplaint();
      const theirs = await submitComplaint();
      const rows = await service.listForCustomer(mine.customerNo);
      expect(rows.map((r) => r.complaintNo)).toEqual([mine.complaintNo]);
      expect(rows.map((r) => r.complaintNo)).not.toContain(theirs.complaintNo);
    });
  });

  // ── 管理台读面 ──────────────────────────────────────────────────
  describe('listAdmin / getAdmin', () => {
    it('getAdmin projects all entry kinds (INTERNAL_NOTE + CLIENT_MESSAGE)', async () => {
      const { complaintNo } = await submitComplaint();
      await service.acknowledge(ops, complaintNo, { message: 'ack' });
      await service.addNote(ops, complaintNo, 'internal note');
      const view = await service.getAdmin(complaintNo);
      expect(view.entries.map((e) => e.kind).sort()).toEqual(['CLIENT_MESSAGE', 'INTERNAL_NOTE']);
    });

    it('findByNo/getAdmin throw NotFoundException for an unknown complaintNo', async () => {
      await expect(service.findByNo('CMP_DOES_NOT_EXIST')).rejects.toThrow(NotFoundException);
      await expect(service.getAdmin('CMP_DOES_NOT_EXIST')).rejects.toThrow(NotFoundException);
    });
  });

  // ── 审计信封真实过闸（真 AuditLogsService，不 mock）：COMPLAINT_AUDIT_ACTIONS 的
  // requiredFields 声明是否真的被本服务的调用点喂对，只有让真校验跑一遍才知道
  // （第 2 条纪律：报绿之前先确认检查真的会红——若某码漏了必填字段，这里会抛 400）。
  describe('audit envelope satisfies the real COMPLAINT_AUDIT_ACTIONS contract (real AuditLogsService, no mock)', () => {
    let realService: ComplaintsService;

    beforeEach(async () => {
      const mod = await Test.createTestingModule({
        providers: [ComplaintsService, { provide: PrismaService, useValue: prisma }, AuditLogsService],
      }).compile();
      realService = mod.get(ComplaintsService);
    });

    it('walks the full happy path (submit→acknowledge→startInvestigation→extend→propose→apply) without the real assertActionSpec rejecting any of the six codes', async () => {
      const customerNo = `CU_REAL_${randomUUID().slice(0, 8)}`;
      const { complaintNo } = await realService.submit(customerNo, { category: 'SERVICE', subject: 'Real-audit lifecycle', description: 'd' });
      createdComplaintNos.push(complaintNo);
      await realService.acknowledge(ops, complaintNo, { message: 'ack' });
      await realService.startInvestigation(ops, complaintNo);
      await realService.extend(ops, complaintNo, { explanation: 'need more time' });
      const approvalNo = `APR_REAL_${complaintNo}`;
      await realService.proposeResolution(ops, complaintNo, { outcome: 'UPHELD', resolutionText: 'Refunded' }, approvalNo);
      await realService.applyResolution(complaintNo, approvalNo, { outcome: 'UPHELD', resolutionText: 'Refunded' });

      const events = await prisma.auditLogEvent.findMany({ where: { primarySubjectType: 'COMPLAINT', primarySubjectNo: complaintNo }, orderBy: { seq: 'asc' } });
      expect(events.map((e) => e.action)).toEqual([
        'COMPLAINT_SUBMITTED', 'COMPLAINT_ACKNOWLEDGED', 'COMPLAINT_INVESTIGATION_STARTED',
        'COMPLAINT_EXTENDED', 'COMPLAINT_RESOLUTION_PROPOSED', 'COMPLAINT_RESOLUTION_APPLIED',
      ]);
      const correlationIds = new Set(events.map((e) => e.correlationId));
      expect(correlationIds.size).toBe(1);
    });

    it('walks addNote + markEscalated + simulateTimeout + rejectResolution without the real assertActionSpec rejecting any code', async () => {
      const customerNo = `CU_REAL_${randomUUID().slice(0, 8)}`;
      const { complaintNo } = await realService.submit(customerNo, { category: 'OTHER', subject: 'Real-audit side paths', description: 'd' });
      createdComplaintNos.push(complaintNo);
      await realService.acknowledge(ops, complaintNo, { message: 'ack' });
      await realService.addNote(ops, complaintNo, 'note');
      await realService.startInvestigation(ops, complaintNo);
      await realService.markEscalated(ops, complaintNo, 'INC_REAL_1');
      await realService.simulateTimeout(ops, complaintNo, 'RESOLVE');
      const approvalNo = `APR_REAL2_${complaintNo}`;
      await realService.proposeResolution(ops, complaintNo, { outcome: 'REJECTED', resolutionText: 'No grounds' }, approvalNo);
      await realService.rejectResolution(complaintNo, approvalNo, 'EXPIRED');

      const events = await prisma.auditLogEvent.findMany({ where: { primarySubjectType: 'COMPLAINT', primarySubjectNo: complaintNo }, orderBy: { seq: 'asc' } });
      expect(events.map((e) => e.action)).toEqual([
        'COMPLAINT_SUBMITTED', 'COMPLAINT_ACKNOWLEDGED', 'COMPLAINT_NOTE_ADDED', 'COMPLAINT_INVESTIGATION_STARTED',
        'COMPLAINT_ESCALATED', 'COMPLAINT_DEADLINE_FASTFORWARDED', 'COMPLAINT_RESOLUTION_PROPOSED', 'COMPLAINT_RESOLUTION_REJECTED',
      ]);
    });
  });
});
