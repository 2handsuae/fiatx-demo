import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateWithdrawalAddressDto } from './create-withdrawal-address.dto';
import { CreateBankAccountDto } from './create-bank-account.dto';
import { UpdateWithdrawalAddressDto } from './update-withdrawal-address.dto';
import { SimulateScreeningDto } from './simulate-screening.dto';

/** 与 main.ts 全局 ValidationPipe 同口径：transform + whitelist */
async function check<T extends object>(cls: new () => T, plain: Record<string, unknown>) {
  const inst = plainToInstance(cls, plain);
  const errors = await validate(inst as object, { whitelist: true });
  return { inst, failedProps: errors.map((e) => e.property).sort() };
}

const cryptoBase = { network: 'TRON', address: 'TXabc', ownershipDeclaration: true, ownerType: 'SELF', declaredHosting: 'SELF_CUSTODY' };
const bankBase = { beneficiaryName: 'John Doe', bankName: 'B', iban: 'AE07', swiftBic: 'TESTBIC', ownershipDeclaration: true, ownerType: 'SELF' };

describe('CreateWithdrawalAddressDto', () => {
  it('本人登记：无 beneficiaryName / beneficiaryRelationship 也通过', async () => {
    expect((await check(CreateWithdrawalAddressDto, cryptoBase)).failedProps).toEqual([]);
  });

  it('第三方登记：缺 beneficiaryRelationship → 只该字段 400', async () => {
    const r = await check(CreateWithdrawalAddressDto, { ...cryptoBase, ownerType: 'THIRD_PARTY', beneficiaryName: 'Li Hua' });
    expect(r.failedProps).toEqual(['beneficiaryRelationship']);
  });

  it('第三方登记：缺 beneficiaryName → 只该字段 400', async () => {
    const r = await check(CreateWithdrawalAddressDto, { ...cryptoBase, ownerType: 'THIRD_PARTY', beneficiaryRelationship: 'Spouse' });
    expect(r.failedProps).toEqual(['beneficiaryName']);
  });

  it('第三方登记：姓名 + 关系齐 → 通过', async () => {
    const r = await check(CreateWithdrawalAddressDto, { ...cryptoBase, ownerType: 'THIRD_PARTY', beneficiaryName: 'Li Hua', beneficiaryRelationship: 'Spouse' });
    expect(r.failedProps).toEqual([]);
  });

  it('ownerType / declaredHosting 必填且限值域', async () => {
    expect((await check(CreateWithdrawalAddressDto, { ...cryptoBase, ownerType: undefined })).failedProps).toEqual(['ownerType']);
    expect((await check(CreateWithdrawalAddressDto, { ...cryptoBase, ownerType: 'COMPANY' })).failedProps).toEqual(['ownerType']);
    expect((await check(CreateWithdrawalAddressDto, { ...cryptoBase, declaredHosting: undefined })).failedProps).toEqual(['declaredHosting']);
    expect((await check(CreateWithdrawalAddressDto, { ...cryptoBase, declaredHosting: 'EXCHANGE' })).failedProps).toEqual(['declaredHosting']);
  });
});

describe('CreateBankAccountDto', () => {
  it('本人：不带 beneficiaryRelationship 通过', async () => {
    expect((await check(CreateBankAccountDto, bankBase)).failedProps).toEqual([]);
  });

  it('第三方：缺 beneficiaryRelationship → 400；带上 → 通过', async () => {
    expect((await check(CreateBankAccountDto, { ...bankBase, ownerType: 'THIRD_PARTY' })).failedProps).toEqual(['beneficiaryRelationship']);
    expect((await check(CreateBankAccountDto, { ...bankBase, ownerType: 'THIRD_PARTY', beneficiaryRelationship: 'Spouse' })).failedProps).toEqual([]);
  });

  it('ownerType 必填且限值域', async () => {
    expect((await check(CreateBankAccountDto, { ...bankBase, ownerType: undefined })).failedProps).toEqual(['ownerType']);
    expect((await check(CreateBankAccountDto, { ...bankBase, ownerType: 'COMPANY' })).failedProps).toEqual(['ownerType']);
  });
});

describe('SimulateScreeningDto（⚡筛查喂：answer + reason 缺一 400）', () => {
  it('answer + reason 齐 → 通过', async () => {
    expect((await check(SimulateScreeningDto, { answer: 'RED', reason: 'Sanctions exposure' })).failedProps).toEqual([]);
  });

  it('缺 reason → 400；空串 reason → 400', async () => {
    expect((await check(SimulateScreeningDto, { answer: 'GREEN' })).failedProps).toEqual(['reason']);
    expect((await check(SimulateScreeningDto, { answer: 'GREEN', reason: '' })).failedProps).toEqual(['reason']);
  });

  it('缺 answer / 越值域 → 400', async () => {
    expect((await check(SimulateScreeningDto, { reason: 'x' })).failedProps).toEqual(['answer']);
    expect((await check(SimulateScreeningDto, { answer: 'ORANGE', reason: 'x' })).failedProps).toEqual(['answer']);
  });
});

describe('UpdateWithdrawalAddressDto（编辑收窄为仅 label）', () => {
  it('whitelist 剥掉 beneficiaryName 等申报证据字段，只剩 label', async () => {
    const inst = plainToInstance(UpdateWithdrawalAddressDto, { label: 'new', beneficiaryName: 'Evil', ownerType: 'THIRD_PARTY' });
    await validate(inst as object, { whitelist: true });
    expect(Object.keys(inst)).toEqual(['label']);
  });
});
