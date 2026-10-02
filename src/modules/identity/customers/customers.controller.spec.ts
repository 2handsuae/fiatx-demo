import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AgreementsReadService } from '../agreements/agreements-read.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

describe('CustomersController', () => {
  let controller: CustomersController;
  const customersServiceMock = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findByCustomerNo: jest.fn(),
  };
  const agreementsReadMock = {
    consentStateFor: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomersController],
      providers: [
        {
          provide: CustomersService,
          useValue: customersServiceMock,
        },
        {
          provide: AgreementsReadService,
          useValue: agreementsReadMock,
        },
      ],
    }).compile();

    controller = module.get<CustomersController>(CustomersController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should map legacy ACTIVE filter to canonical active conditions', () => {
    controller.findAll({ user: { type: 'ADMIN' } }, undefined, undefined, undefined, 'ACTIVE');

    expect(customersServiceMock.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              lifecycle: 'ACTIVE',
            }),
          ]),
        }),
      }),
    );
  });

  it('passes a canonical lifecycle value straight through', () => {
    controller.findAll(
      { user: { type: 'ADMIN' } },
      undefined,
      undefined,
      undefined,
      'PENDING_APPROVAL',
    );

    expect(customersServiceMock.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              lifecycle: 'PENDING_APPROVAL',
            }),
          ]),
        }),
      }),
    );
  });

  it('normalises case and whitespace before matching lifecycle', () => {
    controller.findAll(
      { user: { type: 'ADMIN' } },
      undefined,
      undefined,
      undefined,
      '  in_verification  ',
    );

    expect(customersServiceMock.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              lifecycle: 'IN_VERIFICATION',
            }),
          ]),
        }),
      }),
    );
  });

  it('applies no lifecycle condition when the filter is absent', () => {
    controller.findAll({ user: { type: 'ADMIN' } }, undefined, undefined, undefined, undefined);

    const [arg] = customersServiceMock.findAll.mock.calls[0];
    const conditions = arg.where?.AND ?? [];
    expect(
      conditions.some((c: Record<string, unknown>) => 'lifecycle' in c),
    ).toBe(false);
  });

  // 战役丙波三 T9：管理台客户详情加 agreement 子对象 = consentStateFor(customerId) 五键直通。
  describe('GET :customerNo（详情）agreement 行', () => {
    const ADMIN_REQ = { user: { type: 'ADMIN' } };
    const ROW = { id: 'cust-uuid-1', customerNo: 'CU250907001', email: 'a@example.com', lifecycle: 'ACTIVE', firstName: 'Alice' };
    const ACCEPTED_AT = new Date('2026-10-01T08:00:00.000Z');
    const CONSENT = {
      acceptedVersionKey: 'v1',
      acceptedAt: ACCEPTED_AT,
      acceptedCurrent: true,
      acceptedPending: false,
      declinedCurrentAt: null,
    };

    beforeEach(() => {
      customersServiceMock.findByCustomerNo.mockResolvedValue(ROW);
      customersServiceMock.findOne.mockResolvedValue(ROW);
      agreementsReadMock.consentStateFor.mockResolvedValue(CONSENT);
    });

    it('其余键零变化 + 恰多一个 agreement 键；agreement 五键直通，且按内部 id 取（不是业务号）', async () => {
      const out: any = await controller.findOne(ADMIN_REQ, 'CU250907001');

      // 白名单：详情响应键集 = 原主档行键集 + agreement，一个不多一个不少。
      expect(Object.keys(out).sort()).toEqual([...Object.keys(ROW), 'agreement'].sort());
      for (const key of Object.keys(ROW)) expect(out[key]).toBe((ROW as any)[key]);

      expect(Object.keys(out.agreement).sort()).toEqual(
        ['acceptedAt', 'acceptedCurrent', 'acceptedPending', 'acceptedVersionKey', 'declinedCurrentAt'],
      );
      expect(out.agreement).toEqual(CONSENT);
      expect(agreementsReadMock.consentStateFor).toHaveBeenCalledTimes(1);
      expect(agreementsReadMock.consentStateFor).toHaveBeenCalledWith('cust-uuid-1');
    });

    it('declined 态直通：acceptedCurrent=false + declinedCurrentAt 有值，原样透传', async () => {
      const declinedAt = new Date('2026-10-02T09:00:00.000Z');
      agreementsReadMock.consentStateFor.mockResolvedValue({
        acceptedVersionKey: 'v1', acceptedAt: ACCEPTED_AT, acceptedCurrent: false, acceptedPending: false, declinedCurrentAt: declinedAt,
      });

      const out: any = await controller.findOne(ADMIN_REQ, 'CU250907001');

      expect(out.agreement).toMatchObject({ acceptedCurrent: false, declinedCurrentAt: declinedAt });
    });

    it('客户不存在 → 404，且不查协议台账', async () => {
      customersServiceMock.findByCustomerNo.mockResolvedValue(null);

      await expect(controller.findOne(ADMIN_REQ, 'CU-NOPE')).rejects.toBeInstanceOf(NotFoundException);

      expect(agreementsReadMock.consentStateFor).not.toHaveBeenCalled();
    });

    it('非 ADMIN token → 403，且不查任何东西', async () => {
      await expect(controller.findOne({ user: { type: 'CUSTOMER' } }, 'CU250907001')).rejects.toBeInstanceOf(ForbiddenException);

      expect(customersServiceMock.findByCustomerNo).not.toHaveBeenCalled();
      expect(agreementsReadMock.consentStateFor).not.toHaveBeenCalled();
    });
  });
});
