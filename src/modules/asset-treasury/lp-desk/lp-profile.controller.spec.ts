import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { LpProfileController } from './lp-profile.controller';

/** LP 两步准入 Task 9 · 改结算坐标端点退役（spec §5「退役的改结算端点不复存在」）：读控制器上 Nest 实际登记的
 *  路由元数据（框架据此挂路由），不读源码文本。 */
describe('LpProfileController route table', () => {
  const proto = LpProfileController.prototype as unknown as Record<string, unknown>;
  const routes = Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name) => {
      const handler = proto[name] as object;
      const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
      if (method === undefined) return null;
      return `${RequestMethod[method]} ${Reflect.getMetadata(PATH_METADATA, handler)}`;
    })
    .filter((r): r is string => r !== null);

  it('still serves the five live LP profile routes (create / suspend / reactivate / list / detail)', () => {
    expect(routes).toEqual(expect.arrayContaining([
      'POST /', 'POST :lpNo/suspend', 'POST :lpNo/reactivate', 'GET /', 'GET :lpNo',
    ]));
  });

  it('serves no settlement-change route any more — profile coordinates are gone, a payout address change is a new registration', () => {
    expect(routes.filter((r) => /settlement/i.test(r))).toEqual([]);
  });
});
