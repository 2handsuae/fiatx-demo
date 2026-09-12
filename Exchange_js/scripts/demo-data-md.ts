// scripts/demo-data-md.ts — data.md 生成区写入（demo:all 收尾调用）。
// doc-final/demo/data.md:3 声明它的生成区由 demo:all 写入；这里只动 GENERATED 标记之间的文字，
// 其余是手写内容、原样保留。标记缺失（有人手改删掉了）时不写，免得把文件写坏——
// data.md 自己的 git 历史才是恢复手段。
// 从 demo-lib.ts 拆出来的原因：demo-lib 一被 import 就跑 requireStackEnv，单测没法加载它。
// 云端服务器不带 doc-final（spec 2026-09-11 §8）：文件不存在时打印一行并跳过，不让 demo:all 收尾崩。
import * as fs from 'fs';
import * as path from 'path';

export const DATA_MD_PATH = path.resolve(__dirname, '../doc-final/demo/data.md');
export const GENERATED_BEGIN = '<!-- GENERATED:BEGIN -->';
export const GENERATED_END = '<!-- GENERATED:END -->';

export type DataMdWriteResult = 'written' | 'skipped-missing' | 'skipped-no-markers';

export function writeDataMdSnapshot(body: string, mdPath: string = DATA_MD_PATH): DataMdWriteResult {
  if (!fs.existsSync(mdPath)) {
    console.log(`  ⤷ 没有 data.md（${mdPath}）——云端部署不带 doc-final，跳过生成区写入`);
    return 'skipped-missing';
  }
  const original = fs.readFileSync(mdPath, 'utf8');
  const beginIdx = original.indexOf(GENERATED_BEGIN);
  const endIdx = original.indexOf(GENERATED_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    console.warn(`  ⚠ data.md 缺 GENERATED 标记，跳过生成区写入（${mdPath}）`);
    return 'skipped-no-markers';
  }
  const before = original.slice(0, beginIdx + GENERATED_BEGIN.length);
  const after = original.slice(endIdx);
  fs.writeFileSync(mdPath, `${before}\n${body}\n${after}`, 'utf8');
  console.log(`  ✓ data.md 生成区已更新`);
  return 'written';
}
