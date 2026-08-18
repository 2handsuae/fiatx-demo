import * as fs from 'fs';
import * as path from 'path';

const FORBIDDEN = ['applicantActionId', 'externalActionId'];

/** 客户面源码 —— 这些文件里出现上面两个字段名即违规 */
const CLIENT_SURFACE_FILES = [
  path.resolve(__dirname, './material-requests.client.controller.ts'),
];

/** 只认「真的字段声明或对象字面量键」，注释与同前缀标识符不算 */
function findForbiddenFields(line: string): string[] {
  const withoutComments = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
  return FORBIDDEN.filter((f) =>
    new RegExp(`(^|[^A-Za-z0-9_])${f}\\s*[!?]?\\s*[:.]`).test(withoutComments) ||
    new RegExp(`(^|[^A-Za-z0-9_])${f}\\s*,`).test(withoutComments),
  );
}

describe('客户面字段守则：探测器自检', () => {
  it('命中真正的字段声明与对象字面量键', () => {
    expect(findForbiddenFields('  applicantActionId!: string;')).toEqual(['applicantActionId']);
    expect(findForbiddenFields('  return { externalActionId: row.externalActionId };'))
      .toEqual(['externalActionId']);
    expect(findForbiddenFields('    externalActionId,')).toEqual(['externalActionId']);
  });

  it('注释里的字段名不算违规', () => {
    expect(findForbiddenFields('// 绝不下发 applicantActionId')).toEqual([]);
    expect(findForbiddenFields('/* externalActionId 只留在服务端 */')).toEqual([]);
  });

  it('不误伤同前缀标识符', () => {
    expect(findForbiddenFields('  applicantActionIdList: string[];')).toEqual([]);
    expect(findForbiddenFields('  myExternalActionIdx = 1;')).toEqual([]);
  });
});

/**
 * 唯一合法例外：铸 token 时把 `externalActionId` 原样递给 Sumsub 当钥匙——
 * 命门条款管的是「客户面**响应**」（见 task-7-brief.md「命门 1」），这一行的值
 * 去向第三方 API，从不回到客户手上。TS 里 `createActionSdkToken({ externalActionId })`
 * 的键名是接口字段名，写法上躲不开字面量 `externalActionId:`（改用 computed key
 * 绕开纯属混淆代码，不采用）。故用精确形状白名单这一行，不放宽到其它任何写法——
 * 换一种拼法（比如把值挪进客户响应对象）照样会被下面的扫描逮住。
 */
const SUMSUB_OUTBOUND_EXEMPT_LINE = /^\s*externalActionId:\s*row\.externalActionId,?\s*$/;

describe('G5 / spec I2：客户面源码不得出现 Sumsub 侧 id', () => {
  for (const file of CLIENT_SURFACE_FILES) {
    const rel = path.relative(path.resolve(__dirname, '../../../..'), file);
    const runner = fs.existsSync(file) ? it : it.skip;
    runner(`${rel} 干净`, () => {
      const hits: string[] = [];
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (SUMSUB_OUTBOUND_EXEMPT_LINE.test(line)) return;
        findForbiddenFields(line).forEach((f) => hits.push(`${rel}:${i + 1} → ${f}`));
      });
      expect(hits).toEqual([]);
    });
  }
});

describe('ClientMaterialRequestRow 类型本身也装不下这两个字段', () => {
  it('dto 文件里 ClientMaterialRequestRow 的字段清单是白名单', () => {
    const dto = fs.readFileSync(path.resolve(__dirname, './dto/material-request.dto.ts'), 'utf8');
    const block = dto.split('export interface ClientMaterialRequestRow')[1]?.split('}')[0] ?? '';
    expect(block).not.toContain('applicantActionId');
    expect(block).not.toContain('externalActionId');
    expect(block).toContain('requestNo');
    expect(block).toContain('blocking');
  });
});
