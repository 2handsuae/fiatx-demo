import * as fs from 'fs';
import * as path from 'path';

/**
 * tipping-off 结构性保证的守则性测试。
 *
 * `blocked` 含 SILENT 限制的贡献，`openCount` 含 SILENT 的计数 —— 两者一旦出现在
 * 客户面响应里，被制裁客户的按钮就会置灰 / 计数就会 +1，置灰与计数本身即是信号，
 * 等于告知调查。客户面只允许出现 `disclosedBlocked` 与 `disclosed`。
 *
 * 本测试扫源码文本而非运行时对象：字段是否泄露在写代码那一刻就该被逮住，
 * 而不是等某条运行路径恰好被覆盖到。
 */

const FORBIDDEN_FIELDS = ['blocked', 'openCount'] as const;

/** 去掉注释，免得正文里解释「不许出现 blocked」的注释把自己打成违规。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 标识符边界匹配：`blockedReason` / `disclosedBlocked` 不算命中，`blocked!:` 算。 */
function findForbiddenFields(source: string): string[] {
  const body = stripComments(source);
  return FORBIDDEN_FIELDS.filter((field) =>
    new RegExp(`(?<![A-Za-z0-9_$])${field}(?![A-Za-z0-9_$])`).test(body),
  );
}

/**
 * 扫描目标 = 客户面 DTO / 响应构造代码。
 * customer-restrictions.client.controller.ts 由 Task 9 建；在它落地之前本行用
 * fs.existsSync 跳过（跳过而不是删掉，是为了它一出生就自动进扫描范围）。
 */
const CLIENT_SURFACE_FILES = [
  path.resolve(__dirname, '../onboarding/dto/onboarding.dto.ts'),
  path.resolve(__dirname, './customer-restrictions.client.controller.ts'),
];

describe('客户面字段守则：探测器自检', () => {
  it('命中真正的字段声明', () => {
    expect(findForbiddenFields('  blocked!: Set<Capability>;')).toEqual(['blocked']);
    expect(findForbiddenFields('  openCount!: number;')).toEqual(['openCount']);
    expect(findForbiddenFields("  return { blocked: [...access.blocked] };")).toEqual(['blocked']);
  });

  it('不误伤同前缀 / 同后缀的合法标识符', () => {
    expect(findForbiddenFields('  blockedReason: string | null;')).toEqual([]);
    expect(findForbiddenFields('  disclosedBlocked!: Capability[];')).toEqual([]);
    expect(findForbiddenFields('  openCounter = 1;')).toEqual([]);
  });

  it('注释里的字段名不算违规', () => {
    expect(findForbiddenFields('// 禁止出现 blocked / openCount')).toEqual([]);
    expect(findForbiddenFields('/* blocked 只允许留在服务端 */')).toEqual([]);
  });
});

describe('客户面 DTO / 响应构造不得出现 blocked 与 openCount', () => {
  for (const file of CLIENT_SURFACE_FILES) {
    const rel = path.relative(path.resolve(__dirname, '../../../..'), file);
    const runner = fs.existsSync(file) ? it : it.skip;
    runner(`${rel} 干净`, () => {
      const hits = findForbiddenFields(fs.readFileSync(file, 'utf8'));
      expect(hits).toEqual([]);
    });
  }
});
