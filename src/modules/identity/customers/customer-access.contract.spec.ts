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

/**
 * 战役甲波三 T5（spec §5）：tipping-off 命门的第二层——即便 blocked/openCount 那层
 * （上方）没被绕过，报送族的单号/类型词根本身就是「你被报了」的信号：客户面出现
 * `filingNo` / `STR` / `SAR` / `CNMR` / `PNMR` / `goAML` 字样，等同于告知调查，与
 * 泄露 `blocked` 布尔值是同一等级的命门破防。判定口径照抄上方 findForbiddenFields
 * 的标识符边界匹配（不发明新机制），独立一份 FORBIDDEN_FILING_TERMS + 扫描目标，
 * 两组关注点分列，互不牵连。
 */
const FORBIDDEN_FILING_TERMS = ['filingNo', 'filing', 'STR', 'SAR', 'CNMR', 'PNMR', 'goAML'] as const;

function findForbiddenFilingTerms(source: string): string[] {
  const body = stripComments(source);
  return FORBIDDEN_FILING_TERMS.filter((term) =>
    new RegExp(`(?<![A-Za-z0-9_$])${term}(?![A-Za-z0-9_$])`).test(body),
  );
}

/**
 * 报送族客户面暴露面全集：入驻客户端入口（`onboarding.client.controller.ts`——真实
 * 文件名；上方 blocked/openCount 那组 `CLIENT_SURFACE_FILES` 里写的
 * `onboarding/dto/onboarding.dto.ts` 路径本身不存在——该模块从没拆过 `dto/` 子目录，
 * 常年靠 `it.skip` 跳过，是本任务发现但不在本任务范围内修的既有缺口，非本次引入）
 * ＋ 制裁限制客户端读面（`SANCTION_CONFIRMED` 横幅的数据源，tipping-off 红线的正
 * 门）＋ 材料请求客户端入口与其 DTO（PARTIAL 定性出口自动发的补料请求就走这条面，
 * spec §4——报文引用最可能借道这里溜进客户视野）。
 */
const FILING_CLIENT_SURFACE_FILES = [
  path.resolve(__dirname, '../onboarding/onboarding.client.controller.ts'),
  path.resolve(__dirname, './customer-restrictions.client.controller.ts'),
  path.resolve(__dirname, '../material-requests/material-requests.client.controller.ts'),
  path.resolve(__dirname, '../material-requests/dto/material-request.dto.ts'),
];

describe('报送族词根探测器自检', () => {
  it('命中真正的字段声明 / 字面量', () => {
    expect(findForbiddenFilingTerms('  filingNo: string | null;')).toEqual(['filingNo']);
    expect(findForbiddenFilingTerms("  return { type: 'STR' };")).toEqual(['STR']);
    expect(findForbiddenFilingTerms("  authority: 'goAML case ref',")).toEqual(['goAML']);
  });

  it('不误伤同前缀 / 同后缀 / 内嵌子串的合法标识符', () => {
    expect(findForbiddenFilingTerms('  restriction: string;')).toEqual([]); // "str" 只是小写子串，非命中（大小写敏感）
    expect(findForbiddenFilingTerms('  filingNoLookup: string;')).toEqual([]);
    expect(findForbiddenFilingTerms('  profilingEnabled: boolean;')).toEqual([]);
  });

  it('注释里的词根不算违规', () => {
    expect(findForbiddenFilingTerms('// 客户面禁止出现 STR/SAR/filingNo')).toEqual([]);
  });
});

describe('客户面 DTO / 客户端 controller 响应字段全集不得出现报送词根（tipping-off 第二层，spec §5）', () => {
  for (const file of FILING_CLIENT_SURFACE_FILES) {
    const rel = path.relative(path.resolve(__dirname, '../../../..'), file);
    const runner = fs.existsSync(file) ? it : it.skip;
    runner(`${rel} 零 filingNo/filing/STR/SAR/CNMR/PNMR/goAML 引用`, () => {
      const hits = findForbiddenFilingTerms(fs.readFileSync(file, 'utf8'));
      expect(hits).toEqual([]);
    });
  }
});

/**
 * 报送模块（regulatory-filings）本就无客户端 controller——这条结构性断言把「零客户
 * 面入口」这件事钉死：谁在该目录下新建一个 `*.client.controller.ts` 就当场变红，
 * 不必等它的响应字段被逐个扫描到才发现。仓内暂无同类「模块零客户路由」断言先例
 * （已查 `*.client.controller.ts` 命名惯例 4 例，均是「文件存在则扫内容」型，没有
 * 「目录下不该存在此文件」型），故按 plan 就地在本契约测试里覆盖，不发明新机制——
 * 复用本文件已经在用的 `fs`/`path`，不引入路由反射等新工具。
 */
describe('报送模块（regulatory-filings）结构性断言：零客户端路由', () => {
  it('governance/regulatory-filings 目录下没有任何 *.client.controller.ts', () => {
    const dir = path.resolve(__dirname, '../../governance/regulatory-filings');
    const hits = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.endsWith('.client.controller.ts'))
      : [];
    expect(hits).toEqual([]);
  });
});
