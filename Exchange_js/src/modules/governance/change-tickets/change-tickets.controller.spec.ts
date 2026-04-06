import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ChangeTicketsController } from './change-tickets.controller';
import { ChangeTicketsService } from './change-tickets.service';

describe('ChangeTicketsController Task 2', () => {
  let controller: ChangeTicketsController;

  const changeTicketsService = {
    create: jest.fn(),
    list: jest.fn(),
    getById: jest.fn(),
    submit: jest.fn(),
    consume: jest.fn(),
  };

  const adminReq = {
    user: {
      type: 'ADMIN',
      userId: 'tech-admin-1',
      userNo: 'ADM-001',
      role: 'TECH_OFFICER',
      roleCodes: ['TECH_OFFICER'],
    },
  };
  const customerReq = { user: { type: 'CUSTOMER', userId: 'cust-1' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChangeTicketsController],
      providers: [{ provide: ChangeTicketsService, useValue: changeTicketsService }],
    }).compile();

    controller = module.get<ChangeTicketsController>(ChangeTicketsController);
    jest.clearAllMocks();
  });

  it('delegates consume with admin actor context', async () => {
    changeTicketsService.consume.mockResolvedValue({ id: 'ticket-1', status: 'DONE' });

    await controller.consume(
      adminReq,
      'ticket-1',
      {
        success: true,
        note: 'Applied successfully',
      },
    );

    expect(changeTicketsService.consume).toHaveBeenCalledWith(
      'ticket-1',
      {
        success: true,
        note: 'Applied successfully',
      },
      {
        actorType: 'ADMIN',
        userId: 'tech-admin-1',
        userNo: 'ADM-001',
        role: 'TECH_OFFICER',
        roleCodes: ['TECH_OFFICER'],
      },
    );
  });

  it('keeps list protected for admins', () => {
    expect(() => controller.list(customerReq, {} as any)).toThrow(ForbiddenException);
  });

  it('only exposes create, list, getById, submit, and consume handlers', () => {
    const prototype = Object.getPrototypeOf(controller) as Record<string, unknown>;

    expect(typeof prototype.create).toBe('function');
    expect(typeof prototype.list).toBe('function');
    expect(typeof prototype.getById).toBe('function');
    expect(typeof prototype.submit).toBe('function');
    expect(typeof prototype.consume).toBe('function');
    expect('resubmit' in prototype).toBe(false);
    expect('listGateRuns' in prototype).toBe(false);
    expect('runGateCheck' in prototype).toBe(false);
    expect('markDeployStatus' in prototype).toBe(false);
    expect('close' in prototype).toBe(false);
  });
});
