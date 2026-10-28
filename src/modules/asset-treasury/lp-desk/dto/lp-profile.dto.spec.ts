// 甲波六 T4 · LP 申请表 DTO：控制器上挂的就是这条 ValidationPipe（transform + whitelist），
// 这里直接用同一条管道过 body，验的是表单的必填 / 多值结构 / 旧字段被剥掉。
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { BeneficialOwnerDto, CreateLpProfileDto, ResubmitLpProfileDto } from './lp-profile.dto';

const pipe = new ValidationPipe({ transform: true, whitelist: true });
const run = <T>(metatype: new () => T, body: unknown): Promise<T> => pipe.transform(body, { type: 'body', metatype }) as Promise<T>;

const valid = () => ({
  name: 'Falcon Liquidity FZE',
  registeredIn: 'United Arab Emirates (DMCC)',
  registrationNo: 'DMCC-123456',
  licensingAuthority: 'VARA',
  licenceNo: 'VL/24/001',
  beneficialOwners: [{ seq: 1, name: 'Khalid Al Mansoori', nationality: 'AE' }],
  tradingTypes: ['SPOT_EXCHANGE', 'OTC_BLOCK'],
  expectedMonthlyVolume: '5000000',
  volumeCurrency: 'USD',
  applicationReason: 'Onboarding a new corridor',
  agreementRef: 'AGR-2026-LP-001',
  agreementStart: '2026-11-01',
  contactName: 'Layla Hassan',
  contactEmail: 'layla@falcon.example',
});

describe('CreateLpProfileDto (LP 申请表)', () => {
  it('accepts the full application; UBO rows become BeneficialOwnerDto instances', async () => {
    const out = await run(CreateLpProfileDto, valid());
    expect(out.beneficialOwners![0]).toBeInstanceOf(BeneficialOwnerDto);
    expect(out).toMatchObject({ registeredIn: 'United Arab Emirates (DMCC)', tradingTypes: ['SPOT_EXCHANGE', 'OTC_BLOCK'], expectedMonthlyVolume: '5000000' });
  });

  it('the optional parts really are optional: no beneficial owners, no agreement start, no UBO nationality', async () => {
    const { beneficialOwners: _b, agreementStart: _a, ...rest } = valid();
    await expect(run(CreateLpProfileDto, rest)).resolves.toBeDefined();
    await expect(run(CreateLpProfileDto, { ...valid(), beneficialOwners: [{ seq: 1, name: 'Mei Lin Tan' }] })).resolves.toBeDefined();
  });

  it.each([
    'name', 'registeredIn', 'registrationNo', 'licensingAuthority', 'licenceNo',
    'tradingTypes', 'expectedMonthlyVolume', 'volumeCurrency', 'applicationReason', 'agreementRef', 'contactName', 'contactEmail',
  ])('%s is required', async (field) => {
    const body: Record<string, unknown> = valid();
    delete body[field];
    await expect(run(CreateLpProfileDto, body)).rejects.toThrow(BadRequestException);
  });

  it('at least one trading type must be picked', async () => {
    await expect(run(CreateLpProfileDto, { ...valid(), tradingTypes: [] })).rejects.toThrow(BadRequestException);
  });

  it('a beneficial-owner row needs a seq and a name (screening records point at them by seq + name)', async () => {
    await expect(run(CreateLpProfileDto, { ...valid(), beneficialOwners: [{ name: 'No Seq' }] })).rejects.toThrow(BadRequestException);
    await expect(run(CreateLpProfileDto, { ...valid(), beneficialOwners: [{ seq: 1 }] })).rejects.toThrow(BadRequestException);
    await expect(run(CreateLpProfileDto, { ...valid(), beneficialOwners: [{ seq: 1, name: '   ' }] })).rejects.toThrow(BadRequestException);
  });

  it('fields the form no longer has are stripped, not carried — including the old separate reason (it is applicationReason now) and the free-text due-diligence reference', async () => {
    const out = await run(CreateLpProfileDto, { ...valid(), reason: 'old', diligenceReference: 'DD-2026-LP-001' });
    expect('reason' in out).toBe(false);
    expect('diligenceReference' in out).toBe(false);
  });

  it('ResubmitLpProfileDto takes the same form', async () => {
    await expect(run(ResubmitLpProfileDto, valid())).resolves.toBeInstanceOf(ResubmitLpProfileDto);
    const { registeredIn: _r, ...bad } = valid();
    await expect(run(ResubmitLpProfileDto, bad)).rejects.toThrow(BadRequestException);
  });
});
