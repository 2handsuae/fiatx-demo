// 平账三期 · 事故登记（Task 8）：controller 薄测——路由→服务转发 + 权限守卫存在。
// 不重测业务规则（服务层 Task 5-7 已覆盖）。
import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '@nestjs/passport';
import { IncidentsController } from './incidents.controller';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';

describe('IncidentsController（Task 8：薄转发）', () => {
  const incidents: any = {
    list: jest.fn(),
    getView: jest.fn(),
    startInvestigation: jest.fn(),
    addNote: jest.fn(),
    escalate: jest.fn(),
    assess: jest.fn(),
    linkRemediation: jest.fn(),
    saveReportDraft: jest.fn(),
    markReported: jest.fn(),
    withdraw: jest.fn(),
  };
  const registrationWorkflow: any = { register: jest.fn() };
  const closeWorkflow: any = { requestClose: jest.fn() };

  const adminReq = {
    user: { type: 'ADMIN', userId: 'uuid-ops', userNo: 'ADM-OPS', role: 'OPS_OFFICER', roleCodes: ['OPS_OFFICER'] },
  };
  const customerReq = { user: { type: 'CUSTOMER', userId: 'cust-1' } };
  const expectedActor = { actorType: 'ADMIN', userId: 'uuid-ops', userNo: 'ADM-OPS', role: 'OPS_OFFICER', roleCodes: ['OPS_OFFICER'] };

  let controller: IncidentsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new IncidentsController(incidents, registrationWorkflow, closeWorkflow);
  });

  it('权限守卫存在：AuthGuard(jwt) + AdminPermissionGuard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, IncidentsController) || [];
    expect(guards).toContainEqual(AuthGuard('jwt'));
    expect(guards).toContain(AdminPermissionGuard);
  });

  it('register：转发 IncidentRegistrationWorkflowService.register（不是 IncidentService.register）', async () => {
    registrationWorkflow.register.mockResolvedValue({ incidentNo: 'INC1' });
    const dto = { type: 'MANUAL', title: 't', description: 'd' } as any;
    const r = await controller.register(dto, adminReq);
    expect(registrationWorkflow.register).toHaveBeenCalledWith(dto, expectedActor);
    expect(r).toEqual({ incidentNo: 'INC1' });
  });

  it('register：非 ADMIN token → 403，未转发', () => {
    expect(() => controller.register({} as any, customerReq)).toThrow(ForbiddenException);
    expect(registrationWorkflow.register).not.toHaveBeenCalled();
  });

  it('list：转发 IncidentService.list', () => {
    const q = { status: 'REGISTERED' } as any;
    controller.list(q);
    expect(incidents.list).toHaveBeenCalledWith(q);
  });

  it('detail：转发 IncidentService.getView', () => {
    controller.detail('INC1');
    expect(incidents.getView).toHaveBeenCalledWith('INC1');
  });

  it('startInvestigation：转发 + actor', () => {
    controller.startInvestigation('INC1', adminReq);
    expect(incidents.startInvestigation).toHaveBeenCalledWith('INC1', expectedActor);
  });

  it('addNote：转发 body 字段 + actor', () => {
    controller.addNote('INC1', { body: '记录' } as any, adminReq);
    expect(incidents.addNote).toHaveBeenCalledWith('INC1', '记录', expectedActor);
  });

  it('escalate：转发 dto + actor', () => {
    const dto = { to: 'MLRO', note: 'n' } as any;
    controller.escalate('INC1', dto, adminReq);
    expect(incidents.escalate).toHaveBeenCalledWith('INC1', dto, expectedActor);
  });

  it('assess：转发 dto + actor', () => {
    const dto = { assessedAmount: '100', assessmentBasis: 'NO_LOSS', reportRequired: false } as any;
    controller.assess('INC1', dto, adminReq);
    expect(incidents.assess).toHaveBeenCalledWith('INC1', dto, expectedActor);
  });

  it('linkRemediation：转发 dto + actor', () => {
    const dto = { kind: 'ADJUSTMENT', referenceNo: 'ADJ1' } as any;
    controller.linkRemediation('INC1', dto, adminReq);
    expect(incidents.linkRemediation).toHaveBeenCalledWith('INC1', dto, expectedActor);
  });

  it('saveReportDraft：转发 draft 字段 + actor', () => {
    controller.saveReportDraft('INC1', { draft: '草稿内容' } as any, adminReq);
    expect(incidents.saveReportDraft).toHaveBeenCalledWith('INC1', '草稿内容', expectedActor);
  });

  it('markReported：转发 dto + actor', () => {
    const dto = { reference: 'REF1' } as any;
    controller.markReported('INC1', dto, adminReq);
    expect(incidents.markReported).toHaveBeenCalledWith('INC1', dto, expectedActor);
  });

  it('requestClose：转发 IncidentCloseWorkflowService.requestClose + actor', () => {
    controller.requestClose('INC1', adminReq);
    expect(closeWorkflow.requestClose).toHaveBeenCalledWith('INC1', expectedActor);
  });

  it('withdraw：转发 reason 字段 + actor', () => {
    controller.withdraw('INC1', { reason: '误登记' } as any, adminReq);
    expect(incidents.withdraw).toHaveBeenCalledWith('INC1', '误登记', expectedActor);
  });

  it.each([
    ['startInvestigation', () => controller.startInvestigation('INC1', customerReq)],
    ['addNote', () => controller.addNote('INC1', { body: 'x' } as any, customerReq)],
    ['escalate', () => controller.escalate('INC1', { to: 'MLRO', note: 'n' } as any, customerReq)],
    ['assess', () => controller.assess('INC1', { assessedAmount: '1', assessmentBasis: 'NO_LOSS', reportRequired: false } as any, customerReq)],
    ['linkRemediation', () => controller.linkRemediation('INC1', { kind: 'ADJUSTMENT', referenceNo: 'A1' } as any, customerReq)],
    ['saveReportDraft', () => controller.saveReportDraft('INC1', { draft: 'd' } as any, customerReq)],
    ['markReported', () => controller.markReported('INC1', {} as any, customerReq)],
    ['requestClose', () => controller.requestClose('INC1', customerReq)],
    ['withdraw', () => controller.withdraw('INC1', { reason: 'r' } as any, customerReq)],
  ])('%s：非 ADMIN token → 403（assertAdmin 补 AdminPermissionGuard 的 fail-open）', (_name, invoke) => {
    expect(invoke).toThrow(ForbiddenException);
  });
});
