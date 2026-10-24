import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { LpExchangeController } from './lp-exchange.controller';
import { SimulateLpDeliveryDto } from './dto/lp-exchange.dto';

/** 控制器是薄层（同 lp-profile.controller 先例：写动作全在 workflow）——这里只钉 ⚡到货端点把请求体与 actor 原样转给 workflow。 */
describe('LpExchangeController.simulateDelivery (LP 两步准入 Task 6)', () => {
  const req = { user: { userId: 'uuid-tre', userNo: 'ADM-TRE', role: 'TREASURY_OFFICER', roleCodes: ['TREASURY_OFFICER'] } };

  it('forwards exchangeNo + the actor + the body DTO to the workflow, and returns its result', async () => {
    const workflow: any = { simulateDelivery: jest.fn(async () => ({ exchangeNo: 'LPX1', status: 'DELIVERED' })) };
    const controller = new LpExchangeController(workflow, {} as any);
    const dto: SimulateLpDeliveryDto = { fromSource: 'AE000000000000000003333' };
    const r = await controller.simulateDelivery('LPX1', dto, req);
    expect(r).toEqual({ exchangeNo: 'LPX1', status: 'DELIVERED' });
    expect(workflow.simulateDelivery).toHaveBeenCalledWith(
      'LPX1',
      { actorType: 'ADMIN', userId: 'uuid-tre', userNo: 'ADM-TRE', role: 'TREASURY_OFFICER', roleCodes: ['TREASURY_OFFICER'] },
      dto,
    );
  });

  it('the body parameter is typed as the DTO class, so the class-level ValidationPipe validates it (non-string source → 400)', async () => {
    const paramTypes: unknown[] = Reflect.getMetadata('design:paramtypes', LpExchangeController.prototype, 'simulateDelivery');
    expect(paramTypes[1]).toBe(SimulateLpDeliveryDto);
    const pipe = new ValidationPipe({ transform: true, whitelist: true });
    await expect(pipe.transform({ fromSource: 123 }, { type: 'body', metatype: paramTypes[1] as any })).rejects.toThrow(BadRequestException);
    await expect(pipe.transform({}, { type: 'body', metatype: paramTypes[1] as any })).resolves.toMatchObject({});
  });
});
