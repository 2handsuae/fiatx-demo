import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { LpProfileController } from './lp-profile.controller';
import { REQUIRE_PERMISSIONS_KEY } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { RBAC_PERMISSION_DEFINITIONS } from '../../identity/access-control/rbac.catalog';

/** 读控制器上 Nest 实际登记的路由元数据（框架据此挂路由 / 守卫据此放行），不读源码文本。 */
describe('LpProfileController route table', () => {
  const proto = LpProfileController.prototype as unknown as Record<string, unknown>;
  const routes = Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name) => {
      const handler = proto[name] as object;
      const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
      if (method === undefined) return null;
      const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
      const permissions = (Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler) ?? []) as string[];
      return { name, verb: RequestMethod[method], path, permissions };
    })
    .filter((r): r is { name: string; verb: string; path: string; permissions: string[] } => r !== null);
  const keyOf = (r: { verb: string; path: string }) => `${r.verb} ${r.path}`;

  // 控制器前缀 admin/lp-profiles；各路由的权限组由 rbac.catalog 的 route() 登记决定（未登记 = 全员 403）。
  const EXPECTED: Array<[string, string]> = [
    ['POST /', 'LP_WRITE'],
    ['GET /', 'LP_READ'],
    ['GET :lpNo', 'LP_READ'],
    ['POST :lpNo/suspend', 'LP_WRITE'],
    ['POST :lpNo/reactivate', 'LP_WRITE'],
    ['POST :lpNo/resubmit', 'LP_WRITE'],
    ['POST :lpNo/documents', 'LP_WRITE'],
    ['GET :lpNo/documents', 'LP_READ'],
    ['GET :lpNo/assessment', 'LP_READ'],
    ['POST :lpNo/assessment/screening-records', 'DUE_DILIGENCE_WRITE'],
    ['POST :lpNo/assessment/screening-records/:recordNo/evidence', 'DUE_DILIGENCE_WRITE'],
    ['PATCH :lpNo/assessment', 'DUE_DILIGENCE_WRITE'],
    ['POST :lpNo/assessment/conclude', 'DUE_DILIGENCE_WRITE'],
  ];

  it('serves exactly the thirteen live LP profile routes — the application, document, assessment and lifecycle surface', () => {
    expect(routes.map(keyOf).sort()).toEqual(EXPECTED.map(([k]) => k).sort());
  });

  it('every route is guarded by the permission code of its own method + path, and that code is registered in the RBAC catalog under the right group (unregistered = 403 for everyone)', () => {
    for (const route of routes) {
      const fullPath = route.path === '/' ? '/admin/lp-profiles' : `/admin/lp-profiles/${route.path}`;
      const code = buildPermissionCode(route.verb, fullPath);
      expect({ route: keyOf(route), permissions: route.permissions }).toEqual({ route: keyOf(route), permissions: [code] });
      const def = RBAC_PERMISSION_DEFINITIONS.find((d) => d.code === code);
      const wantGroup = EXPECTED.find(([k]) => k === keyOf(route))![1];
      expect({ route: keyOf(route), groups: def?.groups }).toEqual({ route: keyOf(route), groups: [wantGroup] });
    }
  });

  it('serves no settlement-change route any more — profile coordinates are gone, a payout address change is a new registration', () => {
    expect(routes.filter((r) => /settlement/i.test(r.path))).toEqual([]);
  });
});
