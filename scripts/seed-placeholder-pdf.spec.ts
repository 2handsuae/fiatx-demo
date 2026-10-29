import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildPlaceholderPdf, writePlaceholderPdf } from '../prisma/seed-placeholder-pdf.helper';

// 放在 scripts/ 而不是 prisma/：jest 只在 roots（src / admin-web/src / scripts）里发现测试，见 jest.config.js。

describe('占位 PDF：最小合法文档', () => {
  it('头尾标记齐、体积几百字节', () => {
    const pdf = buildPlaceholderPdf('PLACEHOLDER - Certificate of Incorporation - Falcon Liquidity FZE').toString('latin1');
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true);
    expect(pdf.endsWith('%%EOF\n')).toBe(true);
    expect(pdf.length).toBeLessThan(1024);
  });

  it('startxref 与 xref 表的每个偏移都落在真实对象起点上（读取器靠它定位）', () => {
    const buf = buildPlaceholderPdf('PLACEHOLDER');
    const pdf = buf.toString('latin1');
    const startxref = Number(/startxref\n(\d+)\n/.exec(pdf)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');

    const entries = pdf.slice(startxref).split('\n').filter((l) => /^\d{10} \d{5} [nf] $/.test(l));
    expect(entries).toHaveLength(6); // 空闲头 + 五个对象
    entries.slice(1).forEach((line, i) => {
      const offset = Number(line.slice(0, 10));
      expect(pdf.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
    expect(buf.length).toBe(pdf.length); // 全 ASCII：字符数即字节数，偏移才算得对
  });

  it('标题里的括号与反斜杠被转义，非 ASCII 降级成 ?，不会提前闭合字符串', () => {
    const pdf = buildPlaceholderPdf('A (b) \\ c é').toString('latin1');
    expect(pdf).toContain('(A \\(b\\) \\\\ c ?)');
  });

  it('writePlaceholderPdf 建父目录、落盘，返回字节数', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'pdd-pdf-'));
    try {
      const file = path.join(dir, 'LIQUIDITY_PROVIDER', 'LPP1', 'DOC1.pdf');
      const size = await writePlaceholderPdf(file, 'PLACEHOLDER - x');
      const onDisk = await fsp.readFile(file);
      expect(onDisk.length).toBe(size);
      expect(onDisk.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
