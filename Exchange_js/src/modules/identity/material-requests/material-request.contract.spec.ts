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
 * 命门条款管的是「客户面**响应**」，这个值去向第三方 API，从不回到客户手上。
 * TS 里 `createActionSdkToken({ externalActionId })` 的键名是接口字段名，
 * 写法上躲不开字面量 `externalActionId:`。
 *
 * 早先的白名单按「这一行文本长什么样」豁免（一条形状固定的正则），结果对抗性
 * 变异测试证明：把同样这行文本原样搬进 `toClientRow()` 的客户面投影里——也就是
 * 真把铸 token 的钥匙塞进给客户的响应体——扫描照样放行。豁免管的是「值往哪去」，
 * 不该靠「字面量长什么样」代理，必须靠「这行代码在文件的什么位置」来判：
 * 只有落在 `createActionSdkToken(...)` 这个调用的实参块内部才算数。
 *
 * 做法：扫描前先用括号配对（非贪婪正则）把 `createActionSdkToken(` 到其配对 `)`
 * 之间的实参文本整段挖空（用空格占位、保留换行以维持行号），再对剩下的源码跑
 * 原来的探测器。挖空之后，出现在调用实参块内的合法用法天然扫不到；换个位置——
 * 哪怕是逐字相同的一行——照样会被逮住。
 */
function stripCallArgs(source: string, callName: string): string {
  const marker = `${callName}(`;
  let out = '';
  let pos = 0;
  for (;;) {
    const start = source.indexOf(marker, pos);
    if (start === -1) {
      out += source.slice(pos);
      return out;
    }
    const openParen = start + callName.length; // 指向 marker 末尾的 '('
    out += source.slice(pos, openParen + 1); // 保留 "callName(" 本身，不挖这段

    let depth = 1;
    let i = openParen + 1;
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth++;
      else if (source[i] === ')') depth--;
      i++;
    }
    if (depth !== 0) {
      // 括号不配对（不该在合法源码里发生）——剩余部分原样保留，不再挖空
      out += source.slice(openParen + 1);
      return out;
    }

    const argBlock = source.slice(openParen + 1, i - 1); // '(' 与其配对 ')' 之间
    out += argBlock.replace(/[^\n]/g, ' '); // 挖空实参，换行留着保行号
    out += ')'; // 补回配对的右括号
    pos = i;
  }
}

/** 扫描逻辑的纯函数版本：接受源码字符串，返回违规命中列表（`行号 → 字段名`）。 */
function findForbiddenInSource(source: string): string[] {
  const scannable = stripCallArgs(source, 'createActionSdkToken');
  const hits: string[] = [];
  scannable.split('\n').forEach((line, i) => {
    findForbiddenFields(line).forEach((f) => hits.push(`${i + 1} → ${f}`));
  });
  return hits;
}

describe('豁免按「位置」不按「行形状」：对抗性变异测试', () => {
  it('createActionSdkToken 实参块里的 externalActionId 合法透传 —— 不算违规', () => {
    const source = `
      async getSession() {
        const { token } = await this.sumsubClient.createActionSdkToken({
          applicantId: customer.sumsubApplicantId,
          levelName: row.levelName,
          externalActionId: row.externalActionId,
          ttlInSecs: 600,
        });
        return { submitted: false, sdkToken: token };
      }
    `;
    expect(findForbiddenInSource(source)).toEqual([]);
  });

  it('同一行文本一旦挪出实参块（如混进客户面投影对象字面量）—— 必须判违规', () => {
    // 这就是被打出来的窟窿：早先按「行形状」的白名单对这行文本本身放行，
    // 不管它出现在文件的什么位置——包括这里，真把钥匙塞进客户响应体。
    const source = `
      private toClientRow(r: MaterialRequestRow) {
        return {
          requestNo: r.requestNo,
          externalActionId: row.externalActionId,
        };
      }
    `;
    const hits = findForbiddenInSource(source);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('externalActionId');
  });

  it('applicantActionId 出现在任何位置都判违规（实参块内也不豁免）', () => {
    const source = `
      private toClientRow(r: MaterialRequestRow) {
        return {
          applicantActionId: r.applicantActionId,
        };
      }
    `;
    const hits = findForbiddenInSource(source);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('applicantActionId');
  });

  it('同一段源码里合法调用与违规投影并存时，只逮住违规那一处', () => {
    const source = `
      class X {
        async getSession() {
          const { token } = await this.sumsubClient.createActionSdkToken({
            externalActionId: row.externalActionId,
          });
          return token;
        }

        private toClientRow(r: MaterialRequestRow) {
          return { externalActionId: row.externalActionId };
        }
      }
    `;
    const hits = findForbiddenInSource(source);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain('externalActionId');
  });
});

describe('G5 / spec I2：客户面源码不得出现 Sumsub 侧 id', () => {
  for (const file of CLIENT_SURFACE_FILES) {
    const rel = path.relative(path.resolve(__dirname, '../../../..'), file);
    const runner = fs.existsSync(file) ? it : it.skip;
    runner(`${rel} 干净`, () => {
      const hits = findForbiddenInSource(fs.readFileSync(file, 'utf8'));
      expect(hits.map((h) => `${rel}:${h}`)).toEqual([]);
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
