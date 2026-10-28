// 甲波六 T6 · 服务商申请表 DTO：控制器上挂的就是这条 ValidationPipe（transform + whitelist），
// 这里直接用同一条管道过 body，验的是表单的必填 / 多值结构 / 重大性字段运营写不进来。
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ApplyVendorBodyDto, ResubmitVendorBodyDto, UpgradeMaterialityDto, VendorBeneficialOwnerDto } from './compliance-office.dto';

const pipe = new ValidationPipe({ transform: true, whitelist: true });
const run = <T>(metatype: new () => T, body: unknown): Promise<T> => pipe.transform(body, { type: 'body', metatype }) as Promise<T>;

const valid = () => ({
  name: 'Nimbus Cloud Hosting LLC',
  registeredIn: 'United Arab Emirates (Dubai)',
  registrationNo: 'DED-778812',
  deliveryLocations: ['AE', 'IE'],
  contactName: 'Sara Khan',
  contactEmail: 'sara@nimbus.example',
  beneficialOwners: [{ seq: 1, name: 'Omar Nasser', nationality: 'AE' }],
  serviceDescription: 'Managed cloud hosting',
  regulatedFunction: false,
  contractStart: '2026-11-01',
  involvesPersonalData: true,
  involvesConfidentialInfo: false,
  applicationReason: 'Move hosting',
  impactLicence: false,
  impactLegal: false,
  impactFinancial: false,
  impactContinuity: false,
  replaceability: 'EASY',
});

describe('ApplyVendorBodyDto (服务商申请表)', () => {
  it('accepts the full application; UBO rows become instances of the owner DTO', async () => {
    const out = await run(ApplyVendorBodyDto, valid());
    expect(out.beneficialOwners![0]).toBeInstanceOf(VendorBeneficialOwnerDto);
    expect(out).toMatchObject({ deliveryLocations: ['AE', 'IE'], replaceability: 'EASY', impactLicence: false });
  });

  it('the optional parts really are optional (UBOs, licence, contract end, fee, subcontracting)', async () => {
    const { beneficialOwners: _b, ...rest } = valid();
    await expect(run(ApplyVendorBodyDto, rest)).resolves.toBeDefined();
    await expect(run(ApplyVendorBodyDto, {
      ...valid(), licensingAuthority: 'VARA', licenceNo: 'VL/1', contractEnd: '2027-10-31',
      annualFee: '120000.50', feeCurrency: 'AED', subcontracts: true, subcontractorNames: 'Azure ME',
    })).resolves.toBeDefined();
  });

  it.each([
    'name', 'registeredIn', 'registrationNo', 'deliveryLocations', 'contactName', 'contactEmail', 'serviceDescription',
    'regulatedFunction', 'contractStart', 'involvesPersonalData', 'involvesConfidentialInfo', 'applicationReason',
    'impactLicence', 'impactLegal', 'impactFinancial', 'impactContinuity', 'replaceability',
  ])('%s is required', async (field) => {
    const body: Record<string, unknown> = valid();
    delete body[field];
    await expect(run(ApplyVendorBodyDto, body)).rejects.toThrow(BadRequestException);
  });

  it('at least one delivery / data location, and the four materiality answers must be real booleans (not "yes")', async () => {
    await expect(run(ApplyVendorBodyDto, { ...valid(), deliveryLocations: [] })).rejects.toThrow(BadRequestException);
    await expect(run(ApplyVendorBodyDto, { ...valid(), impactLegal: 'yes' })).rejects.toThrow(BadRequestException);
  });

  it('replaceability is EASY or HARD only', async () => {
    await expect(run(ApplyVendorBodyDto, { ...valid(), replaceability: 'HARD' })).resolves.toBeDefined();
    await expect(run(ApplyVendorBodyDto, { ...valid(), replaceability: 'MEDIUM' })).rejects.toThrow(BadRequestException);
  });

  it('the system judges materiality: a client-supplied criticality is stripped, never reaches the service', async () => {
    const out = await run(ApplyVendorBodyDto, { ...valid(), criticality: 'NON_MATERIAL', status: 'ACTIVE', approvalNo: 'APR1' });
    expect(out).not.toHaveProperty('criticality');
    expect(out).not.toHaveProperty('status');
    expect(out).not.toHaveProperty('approvalNo');
  });

  it('a UBO needs a name', async () => {
    await expect(run(ApplyVendorBodyDto, { ...valid(), beneficialOwners: [{ seq: 1, name: '' }] })).rejects.toThrow(BadRequestException);
  });

  it('the annual fee, when given, is a plain decimal string', async () => {
    await expect(run(ApplyVendorBodyDto, { ...valid(), annualFee: 'a lot' })).rejects.toThrow(BadRequestException);
  });
});

describe('ResubmitVendorBodyDto / UpgradeMaterialityDto', () => {
  it('a resubmission carries the same whole form', async () => {
    await expect(run(ResubmitVendorBodyDto, valid())).resolves.toBeDefined();
    const { name: _n, ...rest } = valid();
    await expect(run(ResubmitVendorBodyDto, rest)).rejects.toThrow(BadRequestException);
  });

  it('the upgrade reason is required', async () => {
    await expect(run(UpgradeMaterialityDto, { reason: 'Hosts customer PII' })).resolves.toBeDefined();
    await expect(run(UpgradeMaterialityDto, {})).rejects.toThrow(BadRequestException);
    await expect(run(UpgradeMaterialityDto, { reason: '' })).rejects.toThrow(BadRequestException);
  });
});
