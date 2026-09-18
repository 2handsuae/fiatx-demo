// admin-web/src/utils/restrictionCauseMeta.spec.ts
//
// 守则性测试：admin-web 的 cause 策略回显表是后端常量的镜像，一旦后端改了
// scope/可见性/解除方式而前端没跟，这里必须红。相对路径 import 后端常量是
// 刻意的——它只发生在 spec 里（tsconfig.app.json 排除 *.spec.ts，后端
// tsconfig.json 排除 admin-web），生产 bundle 不会跨端拉后端代码。

import { RESTRICTION_CAUSE_POLICY as BACKEND_POLICY } from '../../../src/modules/identity/customers/constants/restriction-cause.constant';
import {
  RESTRICTION_CAUSES,
  RESTRICTION_CAUSE_POLICY,
  SELECTABLE_SCOPES,
  scopeLabel,
} from './restrictionCauseMeta';

describe('restrictionCauseMeta (admin mirror of RESTRICTION_CAUSE_POLICY)', () => {
  it('covers exactly the backend cause set (no more, no less)', () => {
    expect([...RESTRICTION_CAUSES].sort()).toEqual(Object.keys(BACKEND_POLICY).sort());
    expect(RESTRICTION_CAUSES).toHaveLength(7);
  });

  it('mirrors every backend policy field verbatim', () => {
    expect(RESTRICTION_CAUSE_POLICY).toEqual(BACKEND_POLICY);
  });

  it('marks PENDING_DOCUMENT as the only scope-selectable cause', () => {
    const selectable = RESTRICTION_CAUSES.filter(
      (cause) => RESTRICTION_CAUSE_POLICY[cause].scopeSelectable,
    );
    expect(selectable).toEqual(['PENDING_DOCUMENT']);
  });

  it('keeps customerLabel empty for every SILENT cause (nothing to disclose)', () => {
    RESTRICTION_CAUSES.forEach((cause) => {
      const policy = RESTRICTION_CAUSE_POLICY[cause];
      if (policy.visibility === 'SILENT') {
        expect(policy.customerLabel).toBe('');
      } else {
        expect(policy.customerLabel.length).toBeGreaterThan(0);
      }
    });
  });

  it('offers only the three capability scopes for manual selection (never ALL)', () => {
    expect(SELECTABLE_SCOPES).toEqual(['DEPOSIT', 'WITHDRAW', 'SWAP']);
  });

  it('renders scope lists as dot-joined text and falls back to the em dash', () => {
    expect(scopeLabel(['WITHDRAW', 'SWAP'])).toBe('WITHDRAW·SWAP');
    expect(scopeLabel(['ALL'])).toBe('ALL');
    expect(scopeLabel([])).toBe('—');
  });
});
