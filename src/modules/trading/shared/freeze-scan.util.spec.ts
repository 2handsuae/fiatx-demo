import { freezeScanQueryArgs } from './freeze-scan.util';

it('column 模式：envelope 带 ownerNo 列 + 其余审计必带键', () => {
  const { select } = freezeScanQueryArgs({
    ownerId: 'o1',
    noField: 'withdrawNo',
    terminalStatuses: ['SUCCESS'],
    ownerNoSource: 'column',
  });
  expect((select as any).ownerNo).toBe(true);
  for (const k of ['id', 'withdrawNo', 'ownerType', 'ownerId', 'status', 'traceId', 'correlationId'])
    expect((select as any)[k]).toBe(true);
});
it('customerRelation 模式：envelope 走 customer.select.customerNo 取客户号 + 其余审计必带键', () => {
  const { select } = freezeScanQueryArgs({
    ownerId: 'o1',
    noField: 'depositNo',
    terminalStatuses: ['SUCCESS'],
    ownerNoSource: 'customerRelation',
  });
  expect((select as any).customer).toEqual({ select: { customerNo: true } });
  expect((select as any).ownerNo).toBeUndefined();
  for (const k of ['id', 'depositNo', 'ownerType', 'ownerId', 'status', 'traceId', 'correlationId'])
    expect((select as any)[k]).toBe(true);
});
it('extraSelect merges without displacing envelope keys', () => {
  const { select } = freezeScanQueryArgs({
    ownerId: 'o1',
    noField: 'swapNo',
    terminalStatuses: [],
    ownerNoSource: 'column',
    extraSelect: { fromAmount: true },
  });
  expect((select as any).fromAmount).toBe(true);
  expect((select as any).correlationId).toBe(true);
});
