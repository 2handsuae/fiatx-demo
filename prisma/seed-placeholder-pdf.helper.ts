// 甲波六 T9：种子用的占位 PDF——几百字节的最小合法文档，由代码当场生成，仓库不放任何二进制（spec §6）。
// 一页 A4，页上一行标题文字；xref 偏移按实际字节位置算（全 ASCII，字符数 = 字节数），能被正常 PDF 阅读器打开。
import { promises as fsp } from 'fs';
import * as path from 'path';

/** 标题落进 PDF 字符串字面量：非可见 ASCII 换成 `?`，括号与反斜杠转义（否则字符串会提前闭合）。 */
function pdfText(title: string): string {
  return title.replace(/[^\x20-\x7E]/g, '?').replace(/([\\()])/g, '\\$1');
}

export function buildPlaceholderPdf(title: string): Buffer {
  const stream = `BT /F1 14 Tf 56 780 Td (${pdfText(title)}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** 写占位 PDF 到 filePath（父目录不存在就建），返回写入的字节数（stored_documents.sizeBytes 要如实）。 */
export async function writePlaceholderPdf(filePath: string, title: string): Promise<number> {
  const buf = buildPlaceholderPdf(title);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, buf);
  return buf.length;
}
