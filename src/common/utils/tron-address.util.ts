import { createHash } from 'crypto';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** 演示用：从任意种子确定性导出一枚符合 TRON Base58 形态（T + 33 位）的地址，不做 checksum。
 *  种子 / demo-lib / e2e 夹具 / mock 托管方共用这一处——此前四处各写一套、有的还是 0x 形态。 */
export function fakeTronAddress(seed: string): string {
  const bytes = createHash('sha256').update(seed).digest();
  let body = '';
  for (let i = 0; body.length < 33; i += 1) {
    body += BASE58[bytes[i % bytes.length] % BASE58.length];
  }
  return `T${body}`;
}
