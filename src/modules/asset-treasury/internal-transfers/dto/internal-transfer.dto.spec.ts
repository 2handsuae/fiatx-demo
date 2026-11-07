import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InitiateShortfallTopupDto } from './internal-transfer.dto';

// 戊波二 T7a：认损补缺的请求体恰是 {caseNo, flowId?, externalLineId?, fromWalletId, reason}——
// 金额、成因、生效日、来路都由服务端算（金额锁定），客户端想传也传不进来（控制器的 ValidationPipe 是 whitelist: true）。
describe('InitiateShortfallTopupDto', () => {
  const ok = { caseNo: 'REC1', flowId: 'flow-1', fromWalletId: 'w-ops', reason: '公司认赔' };
  const check = (plain: object) => validate(plainToInstance(InitiateShortfallTopupDto, plain), { whitelist: true });

  it('caseNo / fromWalletId / reason are required; both anchors are optional (the "at least one anchor" rule is a service guard, like the adjustment DTO)', async () => {
    expect(await check(ok)).toHaveLength(0);
    expect(await check({ caseNo: 'REC1', externalLineId: 'line-1', fromWalletId: 'w-ops', reason: 'r' })).toHaveLength(0);
    for (const missing of ['caseNo', 'fromWalletId', 'reason'] as const) {
      const { [missing]: _drop, ...rest } = ok as any;
      expect((await check(rest)).map((e) => e.property)).toContain(missing);
    }
    expect((await check({ ...ok, reason: '' })).map((e) => e.property)).toContain('reason');
  });

  it('whitelisting strips what the server decides: amount / reasonCode / effectiveDate / lossSource never reach the workflow', async () => {
    const dto = plainToInstance(InitiateShortfallTopupDto, { ...ok, amount: '999999', reasonCode: 'UNEXPLAINED_CLIENT_LOSS', effectiveDate: '2099-01-01', lossSource: 'INCIDENT' });
    await validate(dto, { whitelist: true });
    expect(Object.keys(dto).sort()).toEqual(['caseNo', 'flowId', 'fromWalletId', 'reason']);
  });
});
