import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FeedAttributionDto } from './feed-attribution.dto';

/** 与 main.ts 全局 ValidationPipe 同口径：transform + whitelist（未装饰的字段会被剥掉——vasp 漏装饰 = Grey Harbor 永远喂不进去） */
async function check(plain: Record<string, unknown>) {
  const inst = plainToInstance(FeedAttributionDto, plain);
  const errors = await validate(inst as object, { whitelist: true });
  return { inst, failedProps: errors.map((e) => e.property).sort() };
}

describe('FeedAttributionDto', () => {
  it('VASP + 指定名录样本：vasp 经白名单后仍在', async () => {
    const r = await check({ depositNo: 'DP1', attribution: 'VASP', vasp: 'GREY_HARBOR' });
    expect(r.failedProps).toEqual([]);
    expect(r.inst.vasp).toBe('GREY_HARBOR');
  });

  it('vasp 可缺省（默认 Mock VASP Exchange 由 workflow 定）；UNHOSTED 不带 vasp 通过', async () => {
    expect((await check({ depositNo: 'DP1', attribution: 'VASP' })).failedProps).toEqual([]);
    expect((await check({ depositNo: 'DP1', attribution: 'UNHOSTED' })).failedProps).toEqual([]);
  });

  it('depositNo 必填；attribution / vasp 限值域', async () => {
    expect((await check({ attribution: 'VASP' })).failedProps).toEqual(['depositNo']);
    expect((await check({ depositNo: 'DP1', attribution: 'MAYBE' })).failedProps).toEqual(['attribution']);
    expect((await check({ depositNo: 'DP1', attribution: 'VASP', vasp: 'ACME' })).failedProps).toEqual(['vasp']);
  });
});
