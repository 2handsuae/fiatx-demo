import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GENERATED_BEGIN, GENERATED_END, writeDataMdSnapshot } from './demo-data-md';

describe('writeDataMdSnapshot', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-md-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('data.md 不存在时跳过、不抛错、不创建文件（云端服务器不带 doc-final）', () => {
    const missing = path.join(dir, 'doc-final', 'demo', 'data.md');
    expect(writeDataMdSnapshot('body', missing)).toBe('skipped-missing');
    expect(fs.existsSync(missing)).toBe(false);
  });

  it('只替换 GENERATED 标记之间的内容', () => {
    const md = path.join(dir, 'data.md');
    fs.writeFileSync(md, `head\n${GENERATED_BEGIN}\nold\n${GENERATED_END}\ntail\n`, 'utf8');
    expect(writeDataMdSnapshot('NEW', md)).toBe('written');
    expect(fs.readFileSync(md, 'utf8')).toBe(`head\n${GENERATED_BEGIN}\nNEW\n${GENERATED_END}\ntail\n`);
  });

  it('缺标记时原样保留文件', () => {
    const md = path.join(dir, 'data.md');
    fs.writeFileSync(md, 'hand-written only\n', 'utf8');
    expect(writeDataMdSnapshot('NEW', md)).toBe('skipped-no-markers');
    expect(fs.readFileSync(md, 'utf8')).toBe('hand-written only\n');
  });
});
