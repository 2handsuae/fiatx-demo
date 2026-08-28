import { Test } from '@nestjs/testing';
import { EventEmitterModule, EventEmitter2 } from '@nestjs/event-emitter';
import { AdjustmentApprovalService } from './adjustment-approval.service';
import { AdjustmentService } from './adjustment.service';
import {
  ApprovalActionTypes,
  ApprovalDecisionEvent,
  ApprovalEvents,
  DEFAULT_APPROVAL_POLICIES,
} from '../../../governance/approvals/constants/approval.constants';

describe('AdjustmentApprovalService', () => {
  it('只认领 RECON_ADJUSTMENT_POST', () => {
    const svc = new AdjustmentApprovalService(null as any, null as any);
    expect(svc.actionType).toBe('RECON_ADJUSTMENT_POST');
    expect(svc.workflowType).toBe('RECON');
  });

  it('批准事件转调 onApproved（单号取自 entityRef）', async () => {
    const adjustments = { onApproved: jest.fn(), onRejected: jest.fn() };
    const svc = new AdjustmentApprovalService(adjustments as any, null as any);
    await svc.handleApproved({
      // 真实字段名是 decisionByUserId（ApprovalDecisionEvent，approval.constants.ts:135），
      // 不是 decidedByUserId——brief 草稿这里手误，已按真实源码订正，否则生产环境永远落 'SYSTEM'。
      actionType: 'RECON_ADJUSTMENT_POST', entityRef: 'ADJ2608280001', decisionByUserId: 'U_OPS',
    } as any);
    expect(adjustments.onApproved).toHaveBeenCalledWith('ADJ2608280001', 'U_OPS');
  });

  it('驳回事件转调 onRejected', async () => {
    const adjustments = { onApproved: jest.fn(), onRejected: jest.fn() };
    const svc = new AdjustmentApprovalService(adjustments as any, null as any);
    await svc.handleRejected({
      actionType: 'RECON_ADJUSTMENT_POST', entityRef: 'ADJ2608280001', decisionByUserId: 'U_OPS',
    } as any);
    expect(adjustments.onRejected).toHaveBeenCalledWith('ADJ2608280001', 'U_OPS');
  });

  it('不是自己的 actionType 就不动手', async () => {
    const adjustments = { onApproved: jest.fn(), onRejected: jest.fn() };
    const svc = new AdjustmentApprovalService(adjustments as any, null as any);
    await svc.handleApproved({ actionType: 'SOMETHING_ELSE', entityRef: 'X' } as any);
    expect(adjustments.onApproved).not.toHaveBeenCalled();
  });

  // Minor 3 —— 上面那条守卫只测了 handleApproved，handleRejected 那条没人测过：
  // 删掉 handleRejected/handleCancelled/handleExpired 共用的 routeToRejected 里的
  // actionType 判断，整套测试照样绿。镜像一条堵上。
  it('不是自己的 actionType 就不动手（handleRejected）', async () => {
    const adjustments = { onApproved: jest.fn(), onRejected: jest.fn() };
    const svc = new AdjustmentApprovalService(adjustments as any, null as any);
    await svc.handleRejected({ actionType: 'SOMETHING_ELSE', entityRef: 'X' } as any);
    expect(adjustments.onRejected).not.toHaveBeenCalled();
  });
});

// Important 1 —— 取消/超时不能让调账单永久卡在 PENDING_APPROVAL。基类默认把这两个
// 事件发到 workflow.recon.decided，全仓没人监听那个频道；不接管的话，运营在审批页
// 点取消、或审批 48 小时超时，调账单就卡死——PENDING_APPROVAL 的出边只有
// POSTED/REJECTED，没有回 DRAFT 的边，再也批不了、驳不了、关不掉。
// 对调账单业务上，驳回/取消/超时是同一个结局：这张单不会落账，统一转 onRejected。
describe('AdjustmentApprovalService —— 取消/超时同归 onRejected（Important 1）', () => {
  it('取消事件转调 onRejected（单号取自 entityRef，裁决人取自 decisionByUserId）', async () => {
    const adjustments = { onApproved: jest.fn(), onRejected: jest.fn() };
    const svc = new AdjustmentApprovalService(adjustments as any, null as any);
    await svc.handleCancelled({
      actionType: 'RECON_ADJUSTMENT_POST', entityRef: 'ADJ2608280002', decisionByUserId: 'U_OPS_2',
    } as any);
    expect(adjustments.onRejected).toHaveBeenCalledWith('ADJ2608280002', 'U_OPS_2');
  });

  it('不是自己的 actionType 就不动手（handleCancelled）', async () => {
    const adjustments = { onApproved: jest.fn(), onRejected: jest.fn() };
    const svc = new AdjustmentApprovalService(adjustments as any, null as any);
    await svc.handleCancelled({ actionType: 'SOMETHING_ELSE', entityRef: 'X' } as any);
    expect(adjustments.onRejected).not.toHaveBeenCalled();
  });

  it('超时事件转调 onRejected；超时没有裁决人，decisionByUserId 缺省回落 SYSTEM', async () => {
    const adjustments = { onApproved: jest.fn(), onRejected: jest.fn() };
    const svc = new AdjustmentApprovalService(adjustments as any, null as any);
    await svc.handleExpired({
      actionType: 'RECON_ADJUSTMENT_POST', entityRef: 'ADJ2608280003',
      // 故意不给 decisionByUserId —— 真实超时事件里就没有这个字段。
    } as any);
    expect(adjustments.onRejected).toHaveBeenCalledWith('ADJ2608280003', 'SYSTEM');
  });

  it('不是自己的 actionType 就不动手（handleExpired）', async () => {
    const adjustments = { onApproved: jest.fn(), onRejected: jest.fn() };
    const svc = new AdjustmentApprovalService(adjustments as any, null as any);
    await svc.handleExpired({ actionType: 'SOMETHING_ELSE', entityRef: 'X' } as any);
    expect(adjustments.onRejected).not.toHaveBeenCalled();
  });
});

// 补测 A —— 铁律②「门不可绕」的落点：默认策略被删掉、被改成两步、或角色被换掉，
// 必须有测试当场变红；运行时不报错要等到真提交审批才会炸（"No steps configured"），那是事故现场。
describe('RECON_ADJUSTMENT_POST 默认审批策略', () => {
  it('单步、角色恰好是 OPS_OFFICER', () => {
    const policy = DEFAULT_APPROVAL_POLICIES[ApprovalActionTypes.RECON_ADJUSTMENT_POST];
    expect(policy).toBeDefined();
    expect(policy.steps).toEqual([{ stepNo: 1, roles: ['OPS_OFFICER'] }]);
  });
});

// Important 2 —— 上面所有测试都是直接调 svc.handleApproved({...})，加不加 @OnEvent
// 都一样绿；这条不一样：真起一个 Nest 测试模块 + 真实 EventEmitterModule，让
// EventSubscribersLoader 走一遍真实的“扫描原型链 → 取函数对象 → 查装饰器元数据 →
// 注册监听器”流程，再用真实 EventEmitter2 派发事件——四个 @OnEvent 有一个漏挂，
// 这条测试就会真的收不到调用，永久锁住覆写后必须重新装饰这件事。
describe('AdjustmentApprovalService —— 真实事件系统接线（Important 2，锁住 4 个 @OnEvent 装饰器）', () => {
  const buildEvent = (overrides: Partial<ApprovalDecisionEvent>): ApprovalDecisionEvent => ({
    approvalId: 'AC_WIRE_1',
    approvalNo: 'AC_WIRE_1',
    actionType: ApprovalActionTypes.RECON_ADJUSTMENT_POST,
    entityRef: 'ADJ2608280009',
    traceId: 'TRACE_WIRE_1',
    status: 'APPROVED',
    decisionByUserId: 'U_OPS_WIRE',
    ...overrides,
  });

  it.each([
    [ApprovalEvents.APPROVED, 'onApproved'],
    [ApprovalEvents.REJECTED, 'onRejected'],
    [ApprovalEvents.CANCELLED, 'onRejected'],
    [ApprovalEvents.EXPIRED, 'onRejected'],
  ] as const)('真实派发 %s，%s 真的被调用（不是靠直接调方法）', async (eventName, hookName) => {
    const onApproved = jest.fn();
    const onRejected = jest.fn();
    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        AdjustmentApprovalService,
        { provide: AdjustmentService, useValue: { onApproved, onRejected } },
      ],
    }).compile();

    // .compile() 只建好 DI 容器，不会跑生命周期钩子；EventSubscribersLoader 的
    // 监听器注册挂在 onApplicationBootstrap 上，必须 .init() 才会真的执行。
    await moduleRef.init();
    try {
      const emitter = moduleRef.get(EventEmitter2);
      await emitter.emitAsync(eventName, buildEvent({}));

      // 排查过的坑：EventSubscribersLoader 给 { async: true } 钩子包的是一个普通箭头
      // 函数（不是 async 语法），eventemitter2 的 promisify 判定认 listener.constructor.name
      // === 'AsyncFunction'，箭头函数过不了这个判定，于是走 _setImmediate(...) 分支——
      // 真正调用被排到下一个宏任务，emitAsync 拿到的是 setImmediate 返回的 Immediate 句柄
      // 而不是 Promise，await 在那一刻就已经"结束"了，但监听器其实还没跑。这不是我代码的
      // bug，是 @nestjs/event-emitter@3.0.1 + eventemitter2@6.4.9 这对组合本身的固有行为
      // （全仓所有 { async: true } handler 概莫能外），测试要等一拍再断言。
      await new Promise((resolve) => setImmediate(resolve));

      const mocks = { onApproved, onRejected };
      expect(mocks[hookName]).toHaveBeenCalledWith('ADJ2608280009', 'U_OPS_WIRE');
    } finally {
      await moduleRef.close();
    }
  });
});
