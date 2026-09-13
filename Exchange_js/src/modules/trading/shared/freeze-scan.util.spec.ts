import { freezeScanQueryArgs } from './freeze-scan.util';

it('envelope always carries the audit-required keys', () => {
  const { select } = freezeScanQueryArgs({ ownerId: 'o1', noField: 'depositNo', terminalStatuses: ['SUCCESS'] });
  for (const k of ['id', 'depositNo', 'ownerType', 'ownerId', 'ownerNo', 'status', 'traceId', 'correlationId'])
    expect(select[k]).toBe(true);
});
it('extraSelect merges without displacing envelope keys', () => {
  const { select } = freezeScanQueryArgs({ ownerId: 'o1', noField: 'swapNo', terminalStatuses: [], extraSelect: { fromAmount: true } });
  expect(select.fromAmount).toBe(true);
  expect(select.correlationId).toBe(true);
});
