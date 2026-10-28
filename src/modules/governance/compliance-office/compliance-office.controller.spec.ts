// 甲波六 T6 · 服务商路由表：控制器上 Nest 实际登记的路由元数据（框架据此挂路由 / 守卫据此放行），不读源码文本。
// 控制器是空前缀的（四个资源共一个文件），这里只看 admin/outsourcing-vendors 这一族。
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ComplianceOfficeController } from './compliance-office.controller';
import { REQUIRE_PERMISSIONS_KEY } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { RBAC_PERMISSION_DEFINITIONS } from '../../identity/access-control/rbac.catalog';

describe('ComplianceOfficeController — admin/outsourcing-vendors route table', () => {
  const proto = ComplianceOfficeController.prototype as unknown as Record<string, unknown>;
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
    .filter((r): r is { name: string; verb: string; path: string; permissions: string[] } => r !== null && r.path.startsWith('admin/outsourcing-vendors'));
  const keyOf = (r: { verb: string; path: string }) => `${r.verb} /${r.path}`;

  const EXPECTED: Array<[string, string]> = [
    ['GET /admin/outsourcing-vendors', 'VENDOR_READ'],
    ['GET /admin/outsourcing-vendors/:vendorNo', 'VENDOR_READ'],
    ['GET /admin/outsourcing-vendors/:vendorNo/documents', 'VENDOR_READ'],
    ['GET /admin/outsourcing-vendors/:vendorNo/assessment', 'VENDOR_READ'],
    ['POST /admin/outsourcing-vendors', 'VENDOR_APPLY'],
    ['POST /admin/outsourcing-vendors/:vendorNo/resubmit', 'VENDOR_APPLY'],
    ['POST /admin/outsourcing-vendors/:vendorNo/documents', 'VENDOR_APPLY'],
    ['POST /admin/outsourcing-vendors/:vendorNo/assessment/screening-records', 'DUE_DILIGENCE_WRITE'],
    ['POST /admin/outsourcing-vendors/:vendorNo/assessment/screening-records/:recordNo/evidence', 'DUE_DILIGENCE_WRITE'],
    ['PATCH /admin/outsourcing-vendors/:vendorNo/assessment', 'DUE_DILIGENCE_WRITE'],
    ['POST /admin/outsourcing-vendors/:vendorNo/assessment/conclude', 'DUE_DILIGENCE_WRITE'],
    ['POST /admin/outsourcing-vendors/:vendorNo/assessment/upgrade-materiality', 'DUE_DILIGENCE_WRITE'],
    ['POST /admin/outsourcing-vendors/:vendorNo/assessment/infosec', 'INFOSEC_ASSESSMENT_WRITE'],
    ['POST /admin/outsourcing-vendors/:vendorNo/terminate', 'VENDOR_REGISTER_WRITE'],
  ];

  it('serves exactly the fourteen live service-provider routes — and no PATCH :vendorNo (the compliance officer can no longer edit a vendor row)', () => {
    expect(routes.map(keyOf).sort()).toEqual(EXPECTED.map(([k]) => k).sort());
    expect(routes.filter((r) => r.verb === 'PATCH' && r.path === 'admin/outsourcing-vendors/:vendorNo')).toEqual([]);
  });

  it('every route is guarded by the permission code of its own method + path, and that code is registered in the RBAC catalog under exactly the right group (unregistered = 403 for everyone)', () => {
    for (const route of routes) {
      const code = buildPermissionCode(route.verb, `/${route.path}`);
      expect({ route: keyOf(route), permissions: route.permissions }).toEqual({ route: keyOf(route), permissions: [code] });
      const def = RBAC_PERMISSION_DEFINITIONS.find((d) => d.code === code);
      const wantGroup = EXPECTED.find(([k]) => k === keyOf(route))![1];
      expect({ route: keyOf(route), groups: def?.groups }).toEqual({ route: keyOf(route), groups: [wantGroup] });
    }
  });

  it('the retired PATCH route is gone from the RBAC catalog too (a dead row would keep a permission code nobody can exercise)', () => {
    expect(RBAC_PERMISSION_DEFINITIONS.find((d) => d.code === buildPermissionCode('PATCH', '/admin/outsourcing-vendors/:vendorNo'))).toBeUndefined();
  });
});
