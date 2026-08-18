import * as fs from 'fs';
import * as path from 'path';

/**
 * G5 / spec I2 命门条款：客户面 controller 源码里不得出现 Sumsub 侧 id ——
 * `applicantActionId`（服务端专用）与 `externalActionId`（铸 token 的钥匙）。
 *
 * 2026-08-18 起铸 token 已挪进 `MaterialRequestsService.mintSessionToken()`
 * （见 material-requests.service.ts），controller 不再需要拼出站给 Sumsub 的
 * 对象字面量，这两个字段名不再有任何合法理由出现在客户面源码里。
 * 因此扫描器**不再有豁免** —— 出现即违规，纯标识符边界匹配，判定口径照抄
 * customer-access.contract.spec.ts（`findForbiddenFields` 那份模板），不再要求
 * 「后面紧跟 `:`/`.`/`,`」这种更弱的形状条件（旧条件曾放过裸读改名的绕过）。
 */

const FORBIDDEN = ['applicantActionId', 'externalActionId'];

/** 客户面源码 —— 这些文件里出现上面两个字段名即违规 */
const CLIENT_SURFACE_FILES = [
  path.resolve(__dirname, './material-requests.client.controller.ts'),
];

/** 去掉注释，免得解释「不许出现这两个字段」的注释把自己打成违规。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * 纯标识符边界匹配：只要该标识符作为完整词出现（前后都不是标识符字符）就算命中，
 * 不管它前后跟的是冒号、点、逗号、分号，还是别的什么——不再靠「长得像字段声明 /
 * 对象字面量键」这种形状代理，因为形状条件天然漏掉裸读（`const k = r.foo;`）
 * 这类改名绕过。同前缀/同后缀标识符（`fooList` / `myFooIdx`）不误伤。
 */
function findForbiddenInSource(source: string): string[] {
  const body = stripComments(source);
  return FORBIDDEN.filter((field) =>
    new RegExp(`(?<![A-Za-z0-9_$])${field}(?![A-Za-z0-9_$])`).test(body),
  );
}

describe('客户面字段守则：探测器自检', () => {
  it('命中真正的字段声明与对象字面量键', () => {
    expect(findForbiddenInSource('  applicantActionId!: string;')).toEqual(['applicantActionId']);
    expect(findForbiddenInSource('  return { externalActionId: row.externalActionId };'))
      .toEqual(['externalActionId']);
    expect(findForbiddenInSource('    externalActionId,')).toEqual(['externalActionId']);
  });

  it('注释里的字段名不算违规', () => {
    expect(findForbiddenInSource('// 绝不下发 applicantActionId')).toEqual([]);
    expect(findForbiddenInSource('/* externalActionId 只留在服务端 */')).toEqual([]);
  });

  it('不误伤同前缀标识符', () => {
    expect(findForbiddenInSource('  applicantActionIdList: string[];')).toEqual([]);
    expect(findForbiddenInSource('  myExternalActionIdx = 1;')).toEqual([]);
  });
});

/**
 * 对抗性变异测试：锁死此前那两个真被打出来的窟窿。
 *
 * 1）旧版按「括号配对」把 `createActionSdkToken(...)` 的实参块整段挖空再扫描
 *    ——合法字符串实参里多一个 `(`、加上下游任意一处注释里的 `)`，就会让"挖空"
 *    吞掉中间一整段真代码（含真泄漏行），扫描器对后续内容失明。
 * 2）旧版豁免只认函数名字面量 `createActionSdkToken`，不校验调用方——文件里
 *    另定义一个同名函数包一层就能继承豁免。
 *
 * 现在两个洞的共同根因已经拔除：controller 源码里压根不该再出现这两个字段名
 * （铸 token 挪去了 service 层），所以扫描器不再需要任何豁免逻辑，也就不存在
 * 「豁免被绕过」这回事——下面用内联字符串把当初的绕过手法喂给
 * `findForbiddenInSource`，逐条锁死「零豁免」这件事本身。
 */
describe('零豁免：没有任何位置能让这两个字段名逃过扫描', () => {
  it('对象字面量键出现在源码任何位置 → 违规', () => {
    const source = `
      private toClientRow(r: MaterialRequestRow) {
        return {
          requestNo: r.requestNo,
          externalActionId: row.externalActionId,
        };
      }
    `;
    expect(findForbiddenInSource(source)).toEqual(['externalActionId']);
  });

  it('裸读改名（局部变量 / 解构）依然判违规 —— 旧版「后面须紧跟 :/./,」的形状条件漏掉了这种写法', () => {
    const source = `
      function leak(r: MaterialRequestRow) {
        const k = r.externalActionId;
        return k;
      }
    `;
    expect(findForbiddenInSource(source)).toEqual(['externalActionId']);
  });

  it('括号构造攻击：字符串实参里含未闭合 "("，下游注释里含 ")"，中间夹一行真泄漏 —— 旧版会被整段挖空吞掉，现在没有"挖空"这道工序', () => {
    const source = `
      async getSession() {
        const reason = "see spec (section 2 for details";
        const leak = row.externalActionId;
        // closing note: )
        return reason;
      }
    `;
    expect(findForbiddenInSource(source)).toEqual(['externalActionId']);
  });

  it('同名函数包一层也判违规 —— 旧版豁免只认函数名字面量，不校验调用方', () => {
    const source = `
      function createActionSdkToken(x: any) {
        return { externalActionId: x.externalActionId };
      }
    `;
    expect(findForbiddenInSource(source)).toEqual(['externalActionId']);
  });

  it('哪怕是真的 sumsubClient.createActionSdkToken(...) 出站调用也判违规 —— 铸 token 已挪到 service 层，controller 源码里不该再有这个字面量存在的理由', () => {
    const source = `
      await this.sumsubClient.createActionSdkToken({
        applicantId: customer.sumsubApplicantId,
        levelName: row.levelName,
        externalActionId: row.externalActionId,
        ttlInSecs: 600,
      });
    `;
    expect(findForbiddenInSource(source)).toEqual(['externalActionId']);
  });

  it('applicantActionId 与 externalActionId 同时出现 → 两个都命中', () => {
    const source = `
      return { applicantActionId: r.applicantActionId, externalActionId: r.externalActionId };
    `;
    expect(findForbiddenInSource(source).sort()).toEqual(['applicantActionId', 'externalActionId']);
  });
});

describe('G5 / spec I2：客户面源码不得出现 Sumsub 侧 id', () => {
  for (const file of CLIENT_SURFACE_FILES) {
    const rel = path.relative(path.resolve(__dirname, '../../../..'), file);
    const runner = fs.existsSync(file) ? it : it.skip;
    runner(`${rel} 干净`, () => {
      const hits = findForbiddenInSource(fs.readFileSync(file, 'utf8'));
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
