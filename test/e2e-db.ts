import * as fs from 'fs';
import * as path from 'path';

/**
 * 为破坏性 e2e suite 解析一个「跟当前栈同目录、但绝不是栈库」的专用库路径。
 *
 * 为什么不直接硬编码：`deposit-sumsub-verdicts.e2e-spec.ts` 原先写死
 * `/tmp/exchange_js_wt_deposit_arcs/e2e-deposit-verdicts.db` —— 那个 worktree 早已
 * 删除，目录却留在 /tmp 里，库停在删除当天的 schema。于是这支 suite 一直跑在一个
 * 谁也不会迁移的僵尸库上：平时看着绿，等主干加了一列（本轮的 lifecycle）就整支炸，
 * 而且报错指向一个已经不存在的 worktree，非常难认。BACKLOG 已就此记过账。
 *
 * 现在改成从当前 worktree 的 `.env` 取栈库所在目录，同目录另起一个 `e2e-` 库：
 * 跟着 worktree 走，不会指向别人的地盘，也不会随 worktree 删除而变成孤儿路径。
 * 库名必须含 `e2e-` —— 两支 suite 各自的 fail-closed 断言就是认这个子串。
 *
 * 必须在任何读 DATABASE_URL 的 import 之前调用（dotenv 此时还没跑，所以这里
 * 自己读 .env，不依赖 ConfigModule）。
 */
export function resolveE2eDatabaseUrl(fileName: string): string {
  if (!fileName.includes('e2e-')) {
    throw new Error(`e2e 专用库文件名必须含 "e2e-"，收到 ${fileName}`);
  }

  const envPath = path.resolve(__dirname, '..', '.env');
  const stackUrl = fs
    .readFileSync(envPath, 'utf8')
    .split('\n')
    .find((line) => line.startsWith('DATABASE_URL='))
    ?.split('=')
    .slice(1)
    .join('=')
    .trim()
    .replace(/^["']|["']$/g, '');

  if (!stackUrl?.startsWith('file:')) {
    throw new Error(
      `无法从 ${envPath} 解析 DATABASE_URL —— 先在本 worktree 里跑一次 \`bash scripts/stack.sh up\` 生成 .env。`,
    );
  }

  return `file:${path.join(path.dirname(stackUrl.slice('file:'.length)), fileName)}`;
}
