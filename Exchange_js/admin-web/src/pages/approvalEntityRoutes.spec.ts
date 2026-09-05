// 守则性测试：S9 表（scripts）与审批详情页路由表（admin-web）必须键集相等。
// 跨包相对 import 是刻意的，只发生在 spec 里（先例 utils/restrictionCauseMeta.spec.ts）。
import { ENTITY_ROUTE_BY_ACTION } from './approvalEntityRoutes';
import { DETAIL_READ_GROUP_BY_POLICY } from '../../../scripts/verify-rbac.tables';

describe('S9 表 ↔ 审批详情页路由表', () => {
  it('两边键集相等（新增审批策略要两边同时加）', () => {
    const page = Object.keys(ENTITY_ROUTE_BY_ACTION).sort();
    const gate = Object.keys(DETAIL_READ_GROUP_BY_POLICY).sort();
    expect(gate).toEqual(page);
  });
});
