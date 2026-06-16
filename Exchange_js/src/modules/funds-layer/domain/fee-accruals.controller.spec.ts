import { Test, TestingModule } from '@nestjs/testing';
import { FeeAccrualsController } from './fee-accruals.controller';
import { FeeAccrualService } from './fee-accrual.service';

describe('FeeAccrualsController', () => {
  let controller: FeeAccrualsController;
  let serviceMock: { findAllForAdmin: jest.Mock; findOneForAdmin: jest.Mock };

  beforeEach(async () => {
    serviceMock = {
      findAllForAdmin: jest.fn(),
      findOneForAdmin: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeeAccrualsController],
      providers: [{ provide: FeeAccrualService, useValue: serviceMock }],
    }).compile();
    controller = module.get(FeeAccrualsController);
  });

  it('findAll forwards query to service', async () => {
    serviceMock.findAllForAdmin.mockResolvedValue({ items: [], total: 0 });
    const result = await controller.findAll({
      status: 'ACCRUED',
      page: 1,
      pageSize: 20,
    } as any);
    expect(serviceMock.findAllForAdmin).toHaveBeenCalledWith({
      status: 'ACCRUED',
      page: 1,
      pageSize: 20,
    });
    expect(result).toEqual({ items: [], total: 0 });
  });

  it('findOne returns service result including siblings', async () => {
    serviceMock.findOneForAdmin.mockResolvedValue({
      id: 'fa-1',
      feeAccrualNo: 'FAC2606160001',
      siblings: [{ id: 'fa-2', feeAccrualNo: 'FAC2606160002' }],
    });
    const result = await controller.findOne('fa-1');
    expect(serviceMock.findOneForAdmin).toHaveBeenCalledWith('fa-1');
    expect(result.siblings).toHaveLength(1);
  });
});
