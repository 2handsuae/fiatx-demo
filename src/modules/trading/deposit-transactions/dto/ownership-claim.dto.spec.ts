import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OwnershipClaimDto } from './ownership-claim.dto';

/** 与 main.ts 全局 ValidationPipe 同口径：transform + whitelist（未装饰的字段会被剥掉——name / relationship 漏装饰 = 第三方分支永远缺 name）。 */
async function check(plain: Record<string, unknown>) {
  const inst = plainToInstance(OwnershipClaimDto, plain);
  const errors = await validate(inst as object, { whitelist: true });
  return { inst, failedProps: errors.map((e) => e.property).sort() };
}

describe('OwnershipClaimDto', () => {
  it('三个 claimType 都过；name / relationship 经白名单后仍在（装饰没漏）', async () => {
    const person = await check({ claimType: 'THIRD_PARTY_PERSON', name: 'Alice Wong', relationship: 'Friend' });
    expect(person.failedProps).toEqual([]);
    expect(person.inst.name).toBe('Alice Wong');
    expect(person.inst.relationship).toBe('Friend');

    const vasp = await check({ claimType: 'THIRD_PARTY_VASP', name: 'Binance' });
    expect(vasp.failedProps).toEqual([]);
    expect(vasp.inst.name).toBe('Binance');

    expect((await check({ claimType: 'SELF' })).failedProps).toEqual([]);
  });

  it('claimType 必填且限值域', async () => {
    expect((await check({})).failedProps).toEqual(['claimType']);
    expect((await check({ claimType: 'MAYBE' })).failedProps).toEqual(['claimType']);
  });

  it('name / relationship 给了就得是字符串', async () => {
    expect((await check({ claimType: 'THIRD_PARTY_PERSON', name: 42, relationship: 'x' })).failedProps).toEqual(['name']);
    expect((await check({ claimType: 'THIRD_PARTY_PERSON', name: 'x', relationship: {} })).failedProps).toEqual(['relationship']);
  });
});
