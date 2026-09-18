// scripts/require-stack-env.ts
//
// 副作用模块：import 即执行。缺栈环境变量时 fail-fast。
//
// 为什么：本仓库有多套并行的栈（main + 每个 worktree 一套），各有各的 DB 和账本。
// 此前 12 个 npm 脚本写着 DATABASE_URL="${DATABASE_URL:-file:./dev.db}" 与
// TB_ADDRESS="${TB_ADDRESS:-127.0.0.1:3003}" —— 后者是 **main 的 TigerBeetle**。
// 于是在 worktree 里漏套 on-stack.sh 直接跑造数，结果是"读自己的空库、
// 写 main 的账本"，而且**不报错**。那些默认值已于 2026-08-31 全部剥除，
// 这个守卫负责把"没设置"变成一句能看懂的话。
//
// 不做自动推断：猜错栈比报错更糟。

function fail(missing: string[]): never {
  const script = process.argv[1]?.split('/').pop() ?? '(unknown)';
  console.error(
    [
      '',
      `✗ ${script} 缺少栈环境变量: ${missing.join(', ')}`,
      '',
      '  这些脚本必须绑定到某一个栈的 DB + TigerBeetle 上跑。正确用法：',
      '',
      '    bash scripts/on-stack.sh main <npm-script>    # 主工作树',
      '    bash scripts/on-stack.sh self <npm-script>    # worktree 内',
      '',
      '  包装器会解析该栈的 DATABASE_URL / TB_ADDRESS / TB_DATA_FILE 再执行。',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

export function requireStackEnv(opts: { requireTb: boolean }): void {
  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (opts.requireTb && !process.env.TB_ADDRESS) missing.push('TB_ADDRESS');
  if (missing.length > 0) fail(missing);
}
